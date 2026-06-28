import type { ControlState, InputSource } from "./types";

/**
 * Standard-mapping gamepad (Xbox / DualShock / generic) via the Gamepad API.
 *
 * The ship auto-accelerates, so there's no throttle — the whole control surface
 * is steer + air-brake (hold to drift):
 *   Steer:  left stick X (analog, dead-zoned) or D-pad ◄ ►
 *   Brake:  Right Trigger or Left Trigger (analog) — or A / Cross
 *   Boost:  Right Bumper or B / Circle
 *   Pause:  Start / Options
 *
 * Either trigger brakes so it's comfortable in either hand; the brake is analog
 * (squeeze for a gentler drift). Standard-mapping button indices:
 *   0 A   1 B   4 LB   5 RB   6 LT   7 RT   9 Start   14 ◄   15 ►
 */
export class GamepadInput implements InputSource {
  readonly id = "gamepad";

  private index: number | null = null;
  private steer = 0;
  private brake = 0;
  private boostEdge = false;
  private pauseEdge = false;
  private prevBoost = false;
  private prevPause = false;
  private active = false;

  private static readonly DEADZONE = 0.18;

  private readonly onConnect = (e: GamepadEvent) => {
    this.index = e.gamepad.index;
    this.active = true;
  };
  private readonly onDisconnect = (e: GamepadEvent) => {
    if (e.gamepad.index === this.index) this.index = null;
  };

  constructor() {
    window.addEventListener("gamepadconnected", this.onConnect);
    window.addEventListener("gamepaddisconnected", this.onDisconnect);
  }

  /** Map a raw stick axis through a rescaled dead-zone so there's no jump at the
   * edge of the dead-zone and small inputs are honoured. */
  private static curve(v: number): number {
    const dz = GamepadInput.DEADZONE;
    const m = (Math.abs(v) - dz) / (1 - dz);
    return m > 0 ? Math.sign(v) * Math.min(1, m) : 0;
  }

  sample(): void {
    const pads = navigator.getGamepads?.() ?? [];
    if (this.index === null || !pads[this.index]) {
      this.index = null;
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) {
          this.index = i;
          break;
        }
      }
    }
    const pad = this.index !== null ? pads[this.index] : null;
    if (!pad) {
      this.steer = 0;
      this.brake = 0;
      this.prevBoost = false;
      this.prevPause = false;
      return;
    }

    const b = (i: number) => pad.buttons[i]?.value ?? 0;
    const pressed = (i: number) => !!pad.buttons[i]?.pressed;

    // Steer: stick first, D-pad as a digital fallback/override.
    let steer = GamepadInput.curve(pad.axes[0] ?? 0);
    if (pressed(14)) steer = -1;
    if (pressed(15)) steer = 1;
    this.steer = steer;

    // Brake/air-brake: either trigger (analog) or A. Take the strongest.
    this.brake = Math.max(b(7), b(6), b(0));

    // Boost: RB or B (momentary).
    const boost = pressed(5) || pressed(1);
    this.boostEdge = boost && !this.prevBoost;
    this.prevBoost = boost;

    // Pause / back to menu: Start.
    const pause = pressed(9);
    this.pauseEdge = pause && !this.prevPause;
    this.prevPause = pause;

    if (Math.abs(this.steer) > 0.01 || this.brake > 0.01 || boost || pause) {
      this.active = true;
    }
  }

  contribute(out: ControlState): void {
    if (Math.abs(this.steer) > 0.01) out.steer = this.steer;
    if (this.brake > 0.01) out.brake = Math.max(out.brake, this.brake);
    if (this.boostEdge) out.boost = true;
    if (this.pauseEdge) out.pause = true;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    window.removeEventListener("gamepadconnected", this.onConnect);
    window.removeEventListener("gamepaddisconnected", this.onDisconnect);
  }
}
