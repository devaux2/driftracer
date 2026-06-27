import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { Ship } from "../ship/Ship";
import type { ShipSpec } from "../config/ships";
import type { Track } from "../track/Track";
import { neutralControl, type ControlState } from "../input/types";

/** Per-bot driving personality. Combined with the random ship choice, this is
 * what gives each opponent a recognisable, signature feel over a race. */
export interface BotProfile {
  /** How far ahead it aims (fraction of lap): low = hugs the line, high = cuts
   * corners on a smooth racing line. */
  lookahead: number;
  /** Steering sharpness — high = darty/precise, low = lazy/wide. */
  steerGain: number;
  /** Preferred lane offset from centre (world units). */
  lane: number;
  /** Amplitude of a slow lane weave (world units) — sloppier bots wander. */
  weaveAmp: number;
  /** Weave frequency (Hz). */
  weaveFreq: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Roll a random signature profile within sensible ranges. */
export function randomBotProfile(halfWidth: number): BotProfile {
  const sloppy = Math.random() < 0.5;
  return {
    lookahead: rand(0.009, 0.022),
    steerGain: rand(1.8, 3.4),
    lane: rand(-1, 1) * (halfWidth - 8),
    weaveAmp: sloppy ? rand(3, 11) : 0,
    weaveFreq: rand(0.4, 1.4),
  };
}

/**
 * A basic AI opponent: a {@link Ship} steered to follow the racing line, with a
 * per-bot {@link BotProfile} so each one drives with its own character — how much
 * it cuts corners, how sharply it steers, and how much it wanders. Pace comes
 * from its (random) ship's real stats, same balance as the player.
 */
export class Bot {
  readonly ship: Ship;
  readonly name: string;
  readonly profile: BotProfile;
  private readonly ctrl: ControlState = neutralControl();
  private t = 0;

  constructor(scene: Scene, spec: ShipSpec, name: string, profile: BotProfile) {
    this.ship = new Ship(scene, spec);
    this.name = name;
    this.profile = profile;
  }

  placeAtStart(pos: Vector3, forward: Vector3): void {
    this.ship.placeAtStart(pos, forward);
  }

  update(dt: number, track: Track): void {
    this.t += dt;
    const p = this.profile;
    const lane = p.lane + p.weaveAmp * Math.sin(this.t * p.weaveFreq * Math.PI * 2);

    const here = track.locate(this.ship.position);
    const aim = track.pointAt(here.t + p.lookahead, lane);

    const desiredYaw = Math.atan2(aim.x - this.ship.position.x, aim.z - this.ship.position.z);
    let dYaw = desiredYaw - this.ship.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw)); // shortest arc

    this.ctrl.steer = Math.max(-1, Math.min(1, dYaw * p.steerGain));
    this.ctrl.brake = 0;
    this.ctrl.boost = false;
    this.ctrl.pause = false;
    this.ship.update(dt, this.ctrl, track);
  }

  dispose(): void {
    this.ship.root.dispose();
  }
}
