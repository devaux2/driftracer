import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Ship } from "../ship/Ship";
import type { Track } from "../track/Track";

/** Time constant (s) for the camera yaw chasing the travel direction. Small =
 * snappy/responsive in corners; just enough to smooth the grip-catch swing. */
const YAW_TAU = 0.09;
/** Fixed amount the look-target sits below the camera — sets a constant downward
 * pitch (never swings with speed/elevation). Tuned so the craft sits in the
 * lower third with track visible below it, F-Zero-GX style. */
const LOOK_DROP = 3.3;
/** Minimum camera height above the track surface beneath it (anti clip-through). */
const GROUND_CLEARANCE = 1.6;
/** How much of the road's surface bank the camera rolls with — a cinematic
 * horizon tilt on banked sections without being nauseating (0 = none, 1 = full). */
const ROLL_FACTOR = 0.7;
/** Time constant (s) for the camera roll easing toward the surface bank. */
const ROLL_TAU = 0.16;

/**
 * F-Zero-GX-style chase cam: a tight, RIGID offset behind the craft (constant
 * distance, so framing never changes and it reacts instantly — no speed lag),
 * oriented to the direction of travel (so a sideways drift slides across the
 * frame), held above the track so it never sinks into hills. Speed is sold by
 * FOV + the grid/streaks, never by moving the camera.
 */
export class ChaseCamera {
  readonly camera: UniversalCamera;

  private readonly distance = 7;
  private readonly height = 3.5;
  private readonly baseFov = 0.9;
  private readonly maxFov = 1.04;

  private camYaw = 0;
  private camRoll = 0;
  private initialized = false;

  constructor(scene: Scene) {
    this.camera = new UniversalCamera("chase", new Vector3(0, 10, -20), scene);
    this.camera.fov = this.baseFov;
    this.camera.minZ = 0.3;
    this.camera.maxZ = 2000;
    this.camera.inputs.clear(); // driven manually
  }

  update(dt: number, ship: Ship, track: Track): void {
    const ratio = ship.speedRatio;
    const speed = ship.velocity.length();

    // Orient to the DIRECTION OF TRAVEL (velocity), falling back to heading when
    // nearly stopped. This is what lets the ship sit sideways in a drift while
    // the view stays pointed where you're going. Only the yaw is smoothed —
    // position is rigid — so there's no distance lag and it snaps to corners.
    const targetYaw = speed > 4 ? Math.atan2(ship.velocity.x, ship.velocity.z) : ship.yaw;
    if (!this.initialized) {
      this.camYaw = targetYaw;
      this.initialized = true;
    } else {
      let d = targetYaw - this.camYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest arc
      this.camYaw += d * (1 - Math.exp(-dt / YAW_TAU));
    }

    const forward = new Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));

    // Rigid offset behind + above the ship — constant distance at all speeds.
    const pos = ship.position.subtract(forward.scale(this.distance));
    pos.y = ship.position.y + this.height;

    // Keep clear of the track surface beneath the camera (handles hills/boost so
    // it can never clip through the floor), and never below the ship either.
    const groundUnderCam = track.locate(pos).height;
    const minY = Math.max(groundUnderCam, ship.position.y) + GROUND_CLEARANCE;
    if (pos.y < minY) pos.y = minY;
    this.camera.position.copyFrom(pos);

    // Look ahead along travel, at a fixed gentle downward pitch (target height
    // tied to the camera height) so the view never tilts up/down on its own.
    const target = ship.position.add(forward.scale(7 + ratio * 2));
    target.y = pos.y - LOOK_DROP;
    this.camera.setTarget(target);

    // Roll the camera with the banked surface so the horizon tilts through
    // banked, winding sections (cinematic). setTarget zeroes roll, so apply it
    // after as rotation.z — eased so it blends smoothly into and out of banks.
    const targetRoll = ship.surfaceRoll * ROLL_FACTOR;
    this.camRoll += (targetRoll - this.camRoll) * (1 - Math.exp(-dt / ROLL_TAU));
    this.camera.rotation.z = this.camRoll;

    // FOV nudges up with speed for the rush, without shrinking the ship.
    const targetFov = this.baseFov + (this.maxFov - this.baseFov) * Math.min(1, ratio);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 5 * dt);
  }

  snapTo(ship: Ship, track: Track): void {
    this.initialized = false;
    this.update(0.016, ship, track);
  }
}
