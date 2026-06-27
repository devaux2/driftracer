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
const JUMP_VELOCITY = 42; // base launch speed; ramps scale this by their power
const DRIFT_REWARD_TIME = 1.1; // seconds of drift to earn a mini-boost
const WALL_RESTITUTION = 0.3;
/** How quickly raw steer input eases toward the target (per second). Lower =
 * softer, more progressive turn-in; this is what stops side-to-side snapping. */
const STEER_EASE = 8;
/** How quickly the drift state blends in/out (grip, rotation, slip). */
const DRIFT_EASE = 6;
/** How quickly the visual slip/yaw kick eases in/out. */
const SLIP_EASE = 7;
/** How far below the road surface counts as "fallen off" → respawn. */
const FALL_LIMIT = 16;

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
  /** Flashes briefly after a respawn so the HUD/effects can react. */
  respawnFlash = 0;
  /** Eased steer input (-1..1) — the actual value the physics steers with. */
  private steerInput = 0;
  /** Eased 0..1 drift blend, so traction/rotation/slip transition smoothly.
   * Public so the camera can lean with it smoothly instead of snapping. */
  driftAmount = 0;
  /** Visual slip (yaw kick) of the hull during a drift, smoothed. */
  private slip = 0;
  /** Visual bank/roll, smoothed. */
  private bank = 0;

  // Last spot the ship was safely on the road — where a fall respawns it.
  private readonly lastSafe = new Vector3();
  private readonly lastSafeForward = new Vector3(0, 0, 1);

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
    this.airborne = false;
    this.speed = 0;
    this.steerInput = 0;
    this.driftAmount = 0;
    this.slip = 0;
    this.bank = 0;
    this.lap = 0;
    this.currentLapMs = 0;
    this.lastT = 0;
    this.lastSafe.copyFrom(position);
    this.lastSafeForward.copyFrom(forward);
    this.syncTransform();
  }

  // ---- physics --------------------------------------------------------------

  update(dt: number, ctrl: ControlState, track: Track): void {
    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Ease the raw steer toward its target. Digital inputs (keyboard, d-pad)
    // snap to ±1; easing them in/out is what stops the ship flicking between
    // the edges of the screen and makes turn-in (and drifts) feel progressive.
    this.steerInput += (ctrl.steer - this.steerInput) * Math.min(1, STEER_EASE * dt);
    const steer = this.steerInput;

    const braking = ctrl.brake > 0.1;
    const speed = this.velocity.length();

    // Drift = braking + meaningful steer while moving. The air-brake breaks
    // rear traction; steering then rotates the nose faster than the velocity.
    const wantDrift =
      braking && Math.abs(steer) > DRIFT_STEER_THRESHOLD && speed > DRIFT_MIN_SPEED;
    this.drifting = wantDrift;
    if (wantDrift) this.driftDir = Math.sign(steer);
    // Blend the drift state in/out so grip and rotation ramp rather than snap.
    this.driftAmount += ((wantDrift ? 1 : 0) - this.driftAmount) * Math.min(1, DRIFT_EASE * dt);

    // --- steering (yaw) ---
    // Turn authority scales up a touch with speed so it feels planted, and
    // gains a multiplier as the drift blends in for that tail-out rotation.
    const speedFactor = Math.min(1, 0.4 + speed / this.stats.maxSpeed);
    const turnMul = 1 + (this.stats.driftTurnMultiplier - 1) * this.driftAmount;
    const yawRate = steer * this.stats.turnRate * speedFactor * turnMul;
    this.yaw += yawRate * dt;

    // --- decompose velocity into forward / lateral ---
    let vF = Vector3.Dot(this.velocity, forward);
    let vR = Vector3.Dot(this.velocity, right);

    // Auto-acceleration toward (possibly boosted) top speed. Boost only bites
    // on the ground; in the air you coast (with only token thrust) so a jump's
    // distance stays predictable rather than ballooning out under boost.
    const boosting = this.boostTimer > 0 && !this.airborne;
    const targetSpeed = boosting ? BOOST_PAD_SPEED : this.stats.maxSpeed;
    let thrust = boosting ? this.stats.thrust * 3 : this.stats.thrust;
    if (this.airborne) thrust *= 0.15;
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
    // Blends with the drift amount so traction is released/regained smoothly.
    const grip = this.stats.grip + (this.stats.driftGrip - this.stats.grip) * this.driftAmount;
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

    // --- vertical (jumps / gravity / verticality) ---
    const sample = track.locate(this.position);
    const overRoad = Math.abs(sample.lateral) <= track.halfWidth + 1;
    const groundY = sample.height + HOVER_HEIGHT;
    if (this.airborne) {
      this.verticalVel -= GRAVITY * dt;
      this.position.y += this.verticalVel * dt;
      // You only land if you come down *over the road*. Sail past its edge and
      // there's nothing to catch you — that's the gamble on a shortcut jump.
      if (this.verticalVel <= 0 && overRoad && this.position.y <= groundY) {
        this.position.y = groundY;
        this.verticalVel = 0;
        this.airborne = false;
      }
    } else {
      // Hover: ease toward surface height so the ship hugs hills and dips.
      this.position.y += (groundY - this.position.y) * Math.min(1, 10 * dt);
    }

    // Fell off the course (missed a jump / launched off the side): respawn.
    if (this.position.y < sample.height - FALL_LIMIT) {
      this.respawn();
      return;
    }

    // --- soft walls: only bite when grounded, so jumps can fly off-track ---
    if (!this.airborne) {
      const limit = track.halfWidth - 1.5;
      if (Math.abs(sample.lateral) > limit) {
        const over = Math.abs(sample.lateral) - limit;
        const inward = -Math.sign(sample.lateral);
        const wallRight = new Vector3(sample.forward.z, 0, -sample.forward.x);
        this.position.addInPlace(wallRight.scale(inward * over));
        // bounce lateral velocity inward, scrub speed
        const intoWall = Vector3.Dot(this.velocity, wallRight) * Math.sign(sample.lateral);
        if (intoWall > 0) {
          this.velocity.addInPlace(
            wallRight.scale(-Math.sign(sample.lateral) * intoWall * (1 + WALL_RESTITUTION))
          );
          this.velocity.scaleInPlace(0.9);
        }
      }
      // Grounded and on the road → this is a safe place to respawn back to.
      if (overRoad) {
        this.lastSafe.copyFrom(sample.center);
        this.lastSafeForward.copyFrom(sample.forward);
      }
    }

    if (this.respawnFlash > 0) this.respawnFlash -= dt;
    this.speed = this.velocity.length();
    this.updateProgress(sample, dt);
    this.updateVisuals(dt);
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

  private updateVisuals(dt: number): void {
    // Bank into turns; exaggerate as the drift blends in. Driven by the eased
    // steer/drift so the hull leans smoothly instead of snapping.
    const targetBank = -this.steerInput * (0.3 + 0.25 * this.driftAmount);
    this.bank += (targetBank - this.bank) * Math.min(1, 8 * dt);
    // Slip: the nose kicks out in the drift direction, eased in/out.
    const targetSlip = this.driftDir * 0.4 * this.driftAmount;
    this.slip += (targetSlip - this.slip) * Math.min(1, SLIP_EASE * dt);
    // Engine glow pulses with boost / speed.
    const intensity = this.boostTimer > 0 ? 2.2 : 0.6 + (this.speed / this.stats.maxSpeed) * 0.8;
    this.glowMat.emissiveColor.set(0.4 * intensity, 0.9 * intensity, 1.0 * intensity);
  }

  private syncTransform(): void {
    this.root.position.copyFrom(this.position);
    this.root.rotation.set(0, this.yaw + this.slip, this.bank);
  }

  // ---- pad / power-up hooks (called by Game) --------------------------------

  /** Boost from a track pad. */
  applyBoostPad(): void {
    this.boostTimer = BOOST_DURATION;
  }

  /**
   * Launch off a ramp/jump pad. `power` scales the vertical kick (and thus the
   * hang time and distance covered). We also top up forward momentum so a
   * shortcut jump actually carries the ship across a gap — but the player still
   * has to bring enough speed in, and steers in the air to nail the landing.
   */
  applyJumpPad(power = 1): void {
    if (this.airborne) return;
    this.airborne = true;
    this.verticalVel = JUMP_VELOCITY * power;

    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const vF = Vector3.Dot(this.velocity, forward);
    const target = Math.max(vF, this.stats.maxSpeed * 0.9);
    this.velocity.addInPlace(forward.scale(target - vF));
  }

  private respawn(): void {
    this.position.copyFrom(this.lastSafe);
    this.position.y += HOVER_HEIGHT;
    this.airborne = false;
    this.verticalVel = 0;
    this.yaw = Math.atan2(this.lastSafeForward.x, this.lastSafeForward.z);
    // Drop back in slow — losing your speed is the cost of missing the gap.
    this.velocity.copyFrom(this.lastSafeForward.scale(this.stats.maxSpeed * 0.2));
    this.speed = this.velocity.length();
    this.drifting = false;
    this.driftCharge = 0;
    this.boostTimer = 0;
    this.respawnFlash = 1;
    this.syncTransform();
  }

  get speedKph(): number {
    // Cosmetic scaling for the HUD: maps cruising/boost into a believable
    // arcade range (~0..1000, boost spiking toward the top).
    return Math.round(this.speed * 5);
  }

  get speedRatio(): number {
    return Math.min(1.2, this.speed / this.stats.maxSpeed);
  }
}
