import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { Ship } from "../ship/Ship";
import type { ShipSpec } from "../config/ships";
import type { Track } from "../track/Track";
import { neutralControl, type ControlState } from "../input/types";

/** How far ahead (as a fraction of the lap) the bot aims — bigger = smoother
 * lines / more corner-cutting, smaller = hugs the centre line. */
const LOOKAHEAD_T = 0.014;
/** Converts heading error (radians) into steer input. */
const STEER_GAIN = 2.4;

/**
 * A basic AI opponent: a {@link Ship} steered to follow the track's racing line.
 * It aims at a point a little way ahead on the centre line (offset into its own
 * lane so the pack fans out) and steers toward it; auto-accel handles speed. No
 * drifting — that's the player's edge.
 */
export class Bot {
  readonly ship: Ship;
  readonly name: string;
  /** Preferred lane offset from centre, world units. */
  private readonly lane: number;
  private readonly ctrl: ControlState = neutralControl();

  constructor(scene: Scene, spec: ShipSpec, name: string, lane: number) {
    this.ship = new Ship(scene, spec);
    this.name = name;
    this.lane = lane;
  }

  placeAtStart(pos: Vector3, forward: Vector3): void {
    this.ship.placeAtStart(pos, forward);
  }

  update(dt: number, track: Track): void {
    const here = track.locate(this.ship.position);
    const aim = track.pointAt(here.t + LOOKAHEAD_T, this.lane);

    const desiredYaw = Math.atan2(aim.x - this.ship.position.x, aim.z - this.ship.position.z);
    let dYaw = desiredYaw - this.ship.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw)); // shortest arc

    this.ctrl.steer = Math.max(-1, Math.min(1, dYaw * STEER_GAIN));
    this.ctrl.brake = 0;
    this.ctrl.boost = false;
    this.ctrl.pause = false;
    this.ship.update(dt, this.ctrl, track);
  }

  dispose(): void {
    this.ship.root.dispose();
  }
}
