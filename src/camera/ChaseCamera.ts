import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Ship } from "../ship/Ship";

/** How fast the camera yaw catches up to the travel direction (per second).
 * Smooths the swing when grip re-engages and the velocity snaps to the heading. */
const CAM_YAW_EASE = 5;

/** Fixed amount the look-target sits below the camera, giving a constant gentle
 * downward pitch (so vertical tilt never swings with speed or elevation). */
const LOOK_DROP = 1.2;

/**
 * A chase cam that sells speed. As the ship goes faster the camera pulls back
 * slightly and the FOV widens — the classic Wipeout/F-Zero rush. It also leans
 * into drifts so you can see where you're actually heading.
 */
export class ChaseCamera {
  readonly camera: UniversalCamera;

  private readonly baseDistance = 4.5;
  private readonly baseHeight = 2.6;
  private readonly baseFov = 0.9;
  // Only a slight widening at speed — a big FOV jump (esp. on boost) shrinks the
  // ship into the distance. Speed reads from the close camera + grid + streaks.
  private readonly maxFov = 1.04;

  private readonly smoothedPos = new Vector3();
  private readonly smoothedTarget = new Vector3();
  private camYaw = 0;
  private initialized = false;

  constructor(scene: Scene) {
    this.camera = new UniversalCamera("chase", new Vector3(0, 10, -20), scene);
    this.camera.fov = this.baseFov;
    this.camera.minZ = 0.3;
    this.camera.maxZ = 2000;
    // We drive it manually; detach default controls.
    this.camera.inputs.clear();
  }

  update(dt: number, ship: Ship): void {
    const ratio = ship.speedRatio;
    const speed = ship.velocity.length();

    // The camera follows your DIRECTION OF TRAVEL (velocity), not the ship's
    // heading. That's the whole point: in a drift the ship can be fully sideways
    // while the camera stays pointed where you're actually going, so the ship
    // just slides across the frame. Fall back to heading when nearly stopped
    // (velocity direction is meaningless at rest). velYaw is wrapped to (-pi,pi],
    // so ease along the shortest arc.
    const targetYaw =
      speed > 4 ? Math.atan2(ship.velocity.x, ship.velocity.z) : ship.yaw;
    if (!this.initialized) {
      this.camYaw = targetYaw;
    } else {
      let d = targetYaw - this.camYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.camYaw += d * Math.min(1, CAM_YAW_EASE * dt);
    }

    // Position close behind + just above, along the travel direction. Pull IN
    // slightly with speed (not out) so the ground rushes past faster.
    const back = this.baseDistance - ratio * 1.5;
    const forward = new Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const desired = ship.position
      .subtract(forward.scale(back))
      .add(new Vector3(0, this.baseHeight, 0));

    // Look ahead along the travel direction (horizontal only — vertical is
    // handled below).
    const lookAhead = forward.scale(7 + ratio * 2);
    const target = ship.position.add(lookAhead);

    if (!this.initialized) {
      this.smoothedPos.copyFrom(desired);
      this.smoothedTarget.copyFrom(target);
      this.initialized = true;
    } else {
      // Catch-up at speed keeps the ship from sliding out of frame; the target's
      // horizontal position is smoothed too so the camera angle never jumps.
      const k = Math.min(1, (6 + ratio * 6) * dt);
      this.smoothedPos.addInPlace(desired.subtract(this.smoothedPos).scale(k));
      const tk = Math.min(1, 7 * dt);
      this.smoothedTarget.x += (target.x - this.smoothedTarget.x) * tk;
      this.smoothedTarget.z += (target.z - this.smoothedTarget.z) * tk;
    }
    // Never let the camera sink to/under the deck — e.g. when it lags behind a
    // fast boost up a rise. Keep it clearly above the ship.
    const minY = ship.position.y + 1.5;
    if (this.smoothedPos.y < minY) this.smoothedPos.y = minY;

    // Lock the vertical look angle: the target's height tracks the CAMERA's
    // height (minus a fixed gentle drop), so the camera always looks the same
    // small amount downward regardless of speed/boost/elevation — no vertical
    // tilt swings.
    this.smoothedTarget.y = this.smoothedPos.y - LOOK_DROP;

    this.camera.position.copyFrom(this.smoothedPos);
    this.camera.setTarget(this.smoothedTarget);

    // FOV ramps with speed for the tunnel-vision rush.
    const targetFov = this.baseFov + (this.maxFov - this.baseFov) * Math.min(1, ratio);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 5 * dt);
  }

  snapTo(ship: Ship): void {
    this.initialized = false;
    this.update(0.016, ship);
  }
}
