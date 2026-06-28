import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { resolveShipStats, type ResolvedShipStats, type ShipSpec } from "../config/ships";
import { buildShipModel } from "./shipModel";
import type { ControlState } from "../input/types";
import type { Track } from "../track/Track";

const HOVER_HEIGHT = 1.2;
const GRAVITY = 80;
const DRIFT_MIN_SPEED = 12;
const BOOST_PAD_SPEED = 280; // target speed while a boost is active
const BOOST_DURATION = 1.4;
const JUMP_VELOCITY = 42; // base launch speed; ramps scale this by their power
const DRIFT_REWARD_TIME = 1.1; // seconds of drift to earn a mini-boost
const WALL_RESTITUTION = 0.3;
/** How quickly raw steer input eases toward the target (per second). Lower =
 * softer, more progressive turn-in; this is what stops side-to-side snapping. */
const STEER_EASE = 8;
/** How quickly the drift state blends in/out (grip, rotation, slip). */
const DRIFT_EASE = 6;
/** Seconds of held drift to ramp from 0% up to the max drift turn. */
const DRIFT_RAMP_TIME = 2.0;
/** Drift turn sharpness at the very start of a drift (fraction of max). */
const DRIFT_SHARP_MIN = 0;
/** Seconds to bleed off drift sharpness after releasing, so each drift earns it. */
const DRIFT_SHARP_DECAY = 0.4;
/** Velocity-realign rate (rad/s) while fully sliding — near zero so momentum is
 * held like a trolley (vs the ship's `grip` rate when traction is engaged). */
const GRIP_SLIDE = 0.2;
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
  /** 0..1 skill ramp — climbs while a drift is held, so longer drifts turn
   * sharper (up to the ship's max drift turn). */
  private driftSharp = 0;
  /** Visual bank/roll, smoothed. */
  private bank = 0;

  // Last spot the ship was safely on the road — where a fall respawns it.
  private readonly lastSafe = new Vector3();
  private readonly lastSafeForward = new Vector3(0, 0, 1);

  // --- progress ---
  lap = 0;
  private lastT = 0;
  /** Normalized progress around the loop (0..1) at the last sample. */
  trackT = 0;
  bestLapMs: number | null = null;
  currentLapMs = 0;
  /** Time of the most recently completed lap (ms), or null. */
  lastLapMs: number | null = null;

  /** Total race progress (lap + position around the loop) for ranking racers. */
  get progress(): number {
    return this.lap + this.trackT;
  }

  constructor(scene: Scene, spec: ShipSpec) {
    this.spec = spec;
    this.stats = resolveShipStats(spec);
    this.root = this.buildModel(scene, spec);
  }

  private buildModel(scene: Scene, spec: ShipSpec): TransformNode {
    // Preferred: the shared GLB craft, hue-rotated for this ship. Falls back to
    // the simple box hull if the model isn't loaded yet.
    const model = buildShipModel(scene, spec.color, spec.tintStrength, 4.6);
    if (model) {
      const mroot = new TransformNode(`ship-${spec.id}`, scene);
      model.parent = mroot;
      model.rotation.y = Math.PI; // orient nose to +Z (travel direction)
      // GLB carries its own engine glow; give the boost-glow hook a no-op target.
      this.glowMat = { emissiveColor: new Color3() };
      return mroot;
    }

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

  private glowMat!: { emissiveColor: Color3 };

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
    this.driftSharp = 0;
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
    // Ease the raw steer toward its target. Digital inputs (keyboard, d-pad)
    // snap to ±1; easing them in/out is what stops the ship flicking between
    // the edges of the screen and makes turn-in (and drifts) feel progressive.
    this.steerInput += (ctrl.steer - this.steerInput) * Math.min(1, STEER_EASE * dt);
    const steer = this.steerInput;

    const braking = ctrl.brake > 0.1;
    let speed = this.velocity.length();

    // Air-brake = release traction. Holding it lets the ship keep sliding on its
    // current momentum (like a shopping trolley) while you rotate the body with
    // steering; releasing re-engages grip, which swings the velocity round to
    // face where the ship now points and carries you off that way. It's purely a
    // traction toggle — no braking, no speed loss.
    const sliding = braking && speed > DRIFT_MIN_SPEED;
    this.drifting = sliding;
    if (sliding && Math.abs(steer) > 0.05) this.driftDir = Math.sign(steer);
    // Release traction smoothly, but re-engage grip FAST so letting go snaps the
    // velocity round to the facing direction (the "catch" that fires you off).
    const driftEase = sliding ? DRIFT_EASE : DRIFT_EASE * 3;
    this.driftAmount += ((sliding ? 1 : 0) - this.driftAmount) * Math.min(1, driftEase * dt);

    // Skill ramp: the longer the slide is held, the harder you can rotate it
    // (0 -> max over DRIFT_RAMP_TIME), bleeding off after release.
    if (sliding) this.driftSharp = Math.min(1, this.driftSharp + dt / DRIFT_RAMP_TIME);
    else this.driftSharp = Math.max(0, this.driftSharp - dt / DRIFT_SHARP_DECAY);
    const sharp = DRIFT_SHARP_MIN + (1 - DRIFT_SHARP_MIN) * this.driftSharp;

    // --- steering rotates the heading (the body), independent of momentum ---
    const speedFactor = Math.min(1, 0.4 + speed / this.stats.maxSpeed);
    const turnMul = 1 + (this.stats.driftTurnMultiplier - 1) * this.driftAmount * sharp;
    this.yaw += steer * this.stats.turnRate * speedFactor * turnMul * dt;

    const headingDir = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // --- traction: rotate the velocity DIRECTION toward the heading, preserving
    // speed. Full grip normally (you go where you point); eased to ~frozen while
    // sliding (momentum held). On release this swing is the "catch" that fires
    // you off in the facing direction. ---
    if (speed > 0.5) {
      const velYaw = Math.atan2(this.velocity.x, this.velocity.z);
      let dYaw = this.yaw - velYaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw)); // shortest arc
      const gripRate = this.stats.grip + (GRIP_SLIDE - this.stats.grip) * this.driftAmount;
      const stepAng = Math.max(-gripRate * dt, Math.min(gripRate * dt, dYaw));
      const cs = Math.cos(stepAng);
      const sn = Math.sin(stepAng);
      const vx = this.velocity.x;
      const vz = this.velocity.z;
      this.velocity.x = vx * cs + vz * sn;
      this.velocity.z = -vx * sn + vz * cs;
    } else {
      this.velocity.copyFrom(headingDir.scale(speed));
    }

    // --- speed magnitude: auto-accel toward (boosted) top speed + light drag.
    // No brake scrub anywhere; direction is untouched here, so this just keeps
    // up the speed you carry through a slide. ---
    speed = this.velocity.length();
    const boosting = this.boostTimer > 0 && !this.airborne;
    const targetSpeed = boosting ? BOOST_PAD_SPEED : this.stats.maxSpeed;
    let thrust = boosting ? this.stats.thrust * 3 : this.stats.thrust;
    if (this.airborne) thrust *= 0.15;
    let newSpeed = speed;
    if (newSpeed < targetSpeed) newSpeed = Math.min(targetSpeed, newSpeed + thrust * dt);
    newSpeed -= newSpeed * this.stats.drag * dt;
    if (speed > 0.001) this.velocity.scaleInPlace(newSpeed / speed);
    else this.velocity.copyFrom(headingDir.scale(newSpeed));

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
    this.trackT = sample.t;
    this.currentLapMs += dt * 1000;
    // crossing the start line (t wraps from ~1 back to ~0) counts a lap
    if (this.lastT > 0.8 && sample.t < 0.2) {
      if (this.lap > 0) {
        this.lastLapMs = this.currentLapMs;
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
    // Engine glow pulses with boost / speed.
    const intensity = this.boostTimer > 0 ? 2.2 : 0.6 + (this.speed / this.stats.maxSpeed) * 0.8;
    this.glowMat.emissiveColor.set(0.4 * intensity, 0.9 * intensity, 1.0 * intensity);
  }

  private syncTransform(): void {
    this.root.position.copyFrom(this.position);
    this.root.rotation.set(0, this.yaw, this.bank);
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
