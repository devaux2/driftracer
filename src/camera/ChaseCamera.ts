import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Ship } from "../ship/Ship";

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
  private readonly maxFov = 1.3;

  private readonly smoothedPos = new Vector3();
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

    // Desired camera position: close behind + just above the ship. We pull IN
    // slightly with speed (not out) so the ground rushes past faster — moving
    // the camera away at speed kills the sense of speed.
    const back = this.baseDistance - ratio * 1.5;
    const forward = new Vector3(Math.sin(ship.yaw), 0, Math.cos(ship.yaw));
    const desired = ship.position
      .subtract(forward.scale(back))
      .add(new Vector3(0, this.baseHeight, 0));

    if (!this.initialized) {
      this.smoothedPos.copyFrom(desired);
      this.initialized = true;
    } else {
      // Faster catch-up at speed keeps the ship from sliding out of frame.
      const k = Math.min(1, (6 + ratio * 6) * dt);
      this.smoothedPos.addInPlace(desired.subtract(this.smoothedPos).scale(k));
    }
    this.camera.position.copyFrom(this.smoothedPos);

    // Look a bit ahead of the ship, biased toward drift direction.
    const lookAhead = forward.scale(8 + ratio * 6);
    const driftBias = new Vector3(Math.cos(ship.yaw), 0, -Math.sin(ship.yaw)).scale(
      ship.drifting ? ship.driftDir * 5 : 0
    );
    const target = ship.position.add(lookAhead).add(driftBias).add(new Vector3(0, 1.5, 0));
    this.camera.setTarget(target);

    // FOV ramps with speed for the tunnel-vision rush.
    const targetFov = this.baseFov + (this.maxFov - this.baseFov) * Math.min(1, ratio);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 5 * dt);
  }

  snapTo(ship: Ship): void {
    this.initialized = false;
    this.update(0.016, ship);
  }
}
