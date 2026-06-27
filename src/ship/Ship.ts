import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { resolveShipStats, type ResolvedShipStats, type ShipSpec } from "../config/ships";
import type { ControlState } from "../input/types";
import type { Track } from "../track/Track";

const HOVER_HEIGHT = 1.2;
const GRAVITY = 80;
const DRIFT_STEER_THRESHOLD = 0.25;
const DRIFT_MIN_SPEED = 12;
const BOOST_PAD_SPEED = 200; // target speed while a boost is active
const BOOST_DURATION = 1.4;
const JUMP_VELOCITY = 34;
const DRIFT_REWARD_TIME = 1.1; // seconds of drift to earn a mini-boost
const WALL_RESTITUTION = 0.3;

export class Ship {
  readonly root: TransformNode;
  readonly stats: ResolvedShipStats;
  readonly spec: ShipSpec;

  // --- kinematic state ---
  readonly position = new Vector3();
  yaw = 0;
  /** Horizontal velocity (XZ). */
  readonly velocity = new Vector3();
  verticalVel = 0;
  airborne = false;

  // --- feel state (read by HUD / effects) ---
  speed = 0;
  drifting = false;
  driftDir = 0;
  driftCharge = 0;
  boostTimer = 0;
  /** Visual bank/roll, smoothed. */
  private bank = 0;

  // --- progress ---
  lap = 0;
  private lastT = 0;
  bestLapMs: number | null = null;
  currentLapMs = 0;

  constructor(scene: Scene, spec: ShipSpec) {
    this.spec = spec;
    this.stats = resolveShipStats(spec);
    this.root = this.buildModel(scene, spec);
  }

  private buildModel(scene: Scene, spec: ShipSpec): TransformNode {
    const root = new TransformNode(`ship-${spec.id}`, scene);

    const body = MeshBuilder.CreateBox("hull", { width: 2.2, height: 0.7, depth: 4.2 }, scene);
    const nose = MeshBuilder.CreateCylinder(
      "nose",
      { diameterTop: 0, diameterBottom: 1.6, height: 2.4, tessellation: 4 },
      scene
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 3;
    nose.position.y = 0;
    const fin = MeshBuilder.CreateBox("fin", { width: 0.2, height: 1.0, depth: 1.6 }, scene);
    fin.position.set(0, 0.7, -1.6);

    const hullMat = new StandardMaterial("hullMat", scene);
    hullMat.diffuseColor = spec.color.scale(0.6);
    hullMat.emissiveColor = spec.color.scale(0.35);
    hullMat.specularColor = new Color3(1, 1, 1);
    body.material = hullMat;
    nose.material = hullMat;
    fin.material = hullMat;

    // Engine glow plate at the back, brightens with boost via emissive scaling.
    const glow = MeshBuilder.CreateBox("glow", { width: 1.8, height: 0.4, depth: 0.3 }, scene);
    glow.position.set(0, 0, -2.2);
    const glowMat = new StandardMaterial("glowMat", scene);
    glowMat.emissiveColor = new Color3(0.4, 0.9, 1);
    glow.material = glowMat;
    this.glowMat = glowMat;

    for (const m of [body, nose, fin, glow]) m.parent = root;
    return root;
  }

  private glowMat!: StandardMaterial;

  placeAtStart(position: Vector3, forward: Vector3): void {
    this.position.copyFrom(position);
    this.position.y += HOVER_HEIGHT;
    this.yaw = Math.atan2(forward.x, forward.z);
    this.velocity.setAll(0);
    this.verticalVel = 0;
    this.speed = 0;
    this.lap = 0;
    this.currentLapMs = 0;
    this.lastT = 0;
    this.syncTransform();
  }

  // ---- physics --------------------------------------------------------------

  update(dt: number, ctrl: ControlState, track: Track): void {
    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const braking = ctrl.brake > 0.1;
    const speed = this.velocity.length();

    // Drift = braking + meaningful steer while moving. The air-brake breaks
    // rear traction; steering then rotates the nose faster than the velocity.
    this.drifting =
      braking && Math.abs(ctrl.steer) > DRIFT_STEER_THRESHOLD && speed > DRIFT_MIN_SPEED;
    if (this.drifting) this.driftDir = Math.sign(ctrl.steer);

    // --- steering (yaw) ---
    // Turn authority scales up a touch with speed so it feels planted, and
    // gets a big multiplier while drifting for that tail-out rotation.
    const speedFactor = Math.min(1, 0.4 + speed / this.stats.maxSpeed);
    let yawRate = ctrl.steer * this.stats.turnRate * speedFactor;
    if (this.drifting) yawRate *= this.stats.driftTurnMultiplier;
    this.yaw += yawRate * dt;

    // --- decompose velocity into forward / lateral ---
    let vF = Vector3.Dot(this.velocity, forward);
    let vR = Vector3.Dot(this.velocity, right);

    // Auto-acceleration toward (possibly boosted) top speed.
    const boosting = this.boostTimer > 0;
    const targetSpeed = boosting ? BOOST_PAD_SPEED : this.stats.maxSpeed;
    const thrust = boosting ? this.stats.thrust * 3 : this.stats.thrust;
    if (vF < targetSpeed) vF = Math.min(targetSpeed, vF + thrust * dt);

    // Air-brake scrubs forward speed. While drifting it bites far less — the
    // drift is what lets you carry speed through a corner instead of braking
    // straight, so it should feel like a reward, not a stop.
    if (braking && !boosting) {
      const bite = this.drifting ? 0.4 : 1;
      vF = Math.max(0, vF - this.stats.brakeForce * ctrl.brake * bite * dt);
    }

    // Forward drag.
    vF -= vF * this.stats.drag * dt;

    // Lateral grip: high when gripping (kills slide), low when drifting (slides).
    const grip = this.drifting ? this.stats.driftGrip : this.stats.grip;
    vR *= Math.max(0, 1 - grip * dt);

    // Recombine.
    this.velocity.copyFrom(forward.scale(vF).add(right.scale(vR)));

    // --- drift reward: bank time drifting into a short boost on release ---
    if (this.drifting) {
      this.driftCharge += dt;
    } else if (this.driftCharge > 0) {
      if (this.driftCharge >= DRIFT_REWARD_TIME && this.boostTimer <= 0) {
        this.boostTimer = 0.6;
      }
      this.driftCharge = 0;
    }
    if (this.boostTimer > 0) this.boostTimer -= dt;

    // --- integrate horizontal position ---
    this.position.addInPlace(this.velocity.scale(dt));

    // --- vertical (jumps / gravity) ---
    const sample = track.locate(this.position);
    const groundY = sample.height + HOVER_HEIGHT;
    if (this.airborne) {
      this.verticalVel -= GRAVITY * dt;
      this.position.y += this.verticalVel * dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.verticalVel = 0;
        this.airborne = false;
      }
    } else {
      // Hover: ease toward surface height (handles gentle hills/banking).
      this.position.y += (groundY - this.position.y) * Math.min(1, 10 * dt);
    }

    // --- soft walls: keep the ship on the road ---
    const limit = track.halfWidth - 1.5;
    if (Math.abs(sample.lateral) > limit) {
      const over = Math.abs(sample.lateral) - limit;
      const inward = -Math.sign(sample.lateral);
      const wallRight = new Vector3(sample.forward.z, 0, -sample.forward.x);
      this.position.addInPlace(wallRight.scale(inward * over));
      // bounce lateral velocity inward, scrub speed
      const intoWall = Vector3.Dot(this.velocity, wallRight) * Math.sign(sample.lateral);
      if (intoWall > 0) {
        this.velocity.addInPlace(wallRight.scale(-Math.sign(sample.lateral) * intoWall * (1 + WALL_RESTITUTION)));
        this.velocity.scaleInPlace(0.9);
      }
    }

    this.speed = this.velocity.length();
    this.updateProgress(sample, dt);
    this.updateVisuals(dt, ctrl);
    this.syncTransform();
  }

  private updateProgress(sample: { t: number }, dt: number): void {
    this.currentLapMs += dt * 1000;
    // crossing the start line (t wraps from ~1 back to ~0) counts a lap
    if (this.lastT > 0.8 && sample.t < 0.2) {
      if (this.lap > 0) {
        if (this.bestLapMs == null || this.currentLapMs < this.bestLapMs) {
          this.bestLapMs = this.currentLapMs;
        }
      }
      this.lap++;
      this.currentLapMs = 0;
    }
    this.lastT = sample.t;
  }

  private updateVisuals(dt: number, ctrl: ControlState): void {
    // Bank into turns; exaggerate while drifting.
    const targetBank = -ctrl.steer * (this.drifting ? 0.5 : 0.3);
    this.bank += (targetBank - this.bank) * Math.min(1, 8 * dt);
    // Engine glow pulses with boost / speed.
    const intensity = this.boostTimer > 0 ? 2.2 : 0.6 + (this.speed / this.stats.maxSpeed) * 0.8;
    this.glowMat.emissiveColor.set(0.4 * intensity, 0.9 * intensity, 1.0 * intensity);
  }

  private syncTransform(): void {
    this.root.position.copyFrom(this.position);
    // Yaw to face heading; add drift slip angle so the nose visibly kicks out.
    const slip = this.drifting ? this.driftDir * 0.35 : 0;
    this.root.rotation.set(0, this.yaw + slip, this.bank);
  }

  // ---- pad / power-up hooks (called by Game) --------------------------------

  applyBoostPad(): void {
    this.boostTimer = BOOST_DURATION;
  }

  applyJumpPad(): void {
    if (!this.airborne) {
      this.airborne = true;
      this.verticalVel = JUMP_VELOCITY;
    }
  }

  get speedKph(): number {
    // purely cosmetic scaling for the HUD readout
    return Math.round(this.speed * 12);
  }

  get speedRatio(): number {
    return Math.min(1.2, this.speed / this.stats.maxSpeed);
  }
}
