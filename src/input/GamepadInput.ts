import type { ControlState, InputSource } from "./types";

/**
 * Standard-mapping gamepad (Xbox / DualShock / generic) via the Gamepad API.
 *   Steer:  left stick X, or D-pad left/right
 *   Brake:  A / Cross (button 0), or right trigger (button 7)
 *   Boost:  B / Circle (button 1), or left trigger (button 6)
 *   Pause:  Start (button 9)
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

  private static readonly DEADZONE = 0.15;

  sample(): void {
    const pads = navigator.getGamepads?.() ?? [];
    // Pick the first connected pad if we don't have one yet.
    if (this.index === null) {
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) {
          this.index = i;
          break;
        }
      }
    }
    const pad = this.index !== null ? pads[this.index] : null;
    if (!pad) {
      this.index = null;
      this.steer = 0;
      this.brake = 0;
      return;
    }

    const axis = pad.axes[0] ?? 0;
    let steer = Math.abs(axis) > GamepadInput.DEADZONE ? axis : 0;
    if (pad.buttons[14]?.pressed) steer = -1; // dpad left
    if (pad.buttons[15]?.pressed) steer = 1; // dpad right
    this.steer = steer;

    const brakeBtn = pad.buttons[0]?.value ?? 0;
    const brakeTrig = pad.buttons[7]?.value ?? 0;
    this.brake = Math.max(brakeBtn, brakeTrig);

    const boost = !!pad.buttons[1]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.5;
    this.boostEdge = boost && !this.prevBoost;
    this.prevBoost = boost;

    const pause = !!pad.buttons[9]?.pressed;
    this.pauseEdge = pause && !this.prevPause;
    this.prevPause = pause;

    if (Math.abs(this.steer) > 0.01 || this.brake > 0.01 || boost) {
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
    /* no listeners to remove */
  }
}
