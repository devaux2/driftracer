import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Ship } from "../ship/Ship";

/** How fast the camera yaw catches up to the ship heading (per second). Lower =
 * the ship slides more within the frame during a drift before the camera follows. */
const CAM_YAW_EASE = 5;

/**
 * A chase cam that sells speed. As the ship goes faster the camera pulls back
 * slightly and the FOV widens — the classic Wipeout/F-Zero rush. It also leans
 * into drifts so you can see where you're actually heading.
 */
export class ChaseCamera {
  readonly camera: UniversalCamera;

  private readonly baseDistance = 8;
  private readonly baseHeight = 3.6;
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

    // The camera's own yaw LAGS the ship's heading. This is the key to drifts
    // not whipping the camera: during a drift the ship's nose swings fast, but
    // the camera holds roughly behind your line of travel, so the ship visibly
    // slides within the frame instead of dragging the view around. (ship.yaw is
    // a continuous accumulating angle, so a plain lerp is safe — no wrapping.)
    if (!this.initialized) this.camYaw = ship.yaw;
    else this.camYaw += (ship.yaw - this.camYaw) * Math.min(1, CAM_YAW_EASE * dt);

    // Desired camera position: close behind + just above, along the camera yaw.
    // Pull IN slightly with speed (not out) so the ground rushes past faster.
    const back = this.baseDistance - ratio * 1.5;
    const forward = new Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const right = new Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const desired = ship.position
      .subtract(forward.scale(back))
      .add(new Vector3(0, this.baseHeight, 0));

    // Look a bit ahead, leaning toward the drift via the EASED drift amount.
    const lookAhead = forward.scale(7 + ratio * 2);
    const driftBias = right.scale(ship.driftDir * 5 * ship.driftAmount);
    const target = ship.position.add(lookAhead).add(driftBias).add(new Vector3(0, 1.5, 0));

    if (!this.initialized) {
      this.smoothedPos.copyFrom(desired);
      this.smoothedTarget.copyFrom(target);
      this.initialized = true;
    } else {
      // Catch-up at speed keeps the ship from sliding out of frame; the target
      // is smoothed too so the camera angle never jumps.
      const k = Math.min(1, (6 + ratio * 6) * dt);
      this.smoothedPos.addInPlace(desired.subtract(this.smoothedPos).scale(k));
      this.smoothedTarget.addInPlace(target.subtract(this.smoothedTarget).scale(Math.min(1, 7 * dt)));
    }
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
