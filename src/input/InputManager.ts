import { KeyboardInput } from "./KeyboardInput";
import { GamepadInput } from "./GamepadInput";
import { TouchInput } from "./TouchInput";
import { GyroInput } from "./GyroInput";
import { neutralControl, type ControlState, type InputSource } from "./types";

export type SteerMode = "touch" | "gyro";

/**
 * Aggregates every input device into one {@link ControlState} per frame.
 *
 * Desktop and mobile sources coexist; whichever the player actually touches
 * wins for that frame (later contributors in the list override earlier ones for
 * any axis they're driving). This means a player can switch between keyboard
 * and pad mid-session without any mode toggle.
 */
export class InputManager {
  private sources: InputSource[] = [];
  private state: ControlState = neutralControl();

  readonly keyboard = new KeyboardInput();
  readonly gamepad = new GamepadInput();
  readonly touch: TouchInput;
  readonly gyro = new GyroInput();

  readonly isTouchDevice: boolean;

  constructor(touchContainer: HTMLElement) {
    this.touch = new TouchInput(touchContainer);
    this.isTouchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;

    // Order matters: later sources win an axis if they're driving it.
    this.sources = [this.keyboard, this.gamepad, this.gyro, this.touch];

    // On a pure-desktop session, the touch overlay just stays hidden.
    this.touch.show(this.isTouchDevice);
    this.setSteerMode("touch");
  }

  /** Switch mobile steering between on-screen pads and device tilt. */
  setSteerMode(mode: SteerMode): void {
    const gyro = mode === "gyro";
    this.gyro.setEnabled(gyro);
    this.touch.setSteeringEnabled(!gyro);
  }

  /** Triggers the iOS gyro permission prompt; call from a tap handler. */
  async enableGyro(): Promise<boolean> {
    const ok = await this.gyro.requestPermission();
    if (ok) this.setSteerMode("gyro");
    return ok;
  }

  update(dt: number): ControlState {
    const s = this.state;
    s.steer = 0;
    s.brake = 0;
    s.boost = false;
    s.pause = false;
    for (const src of this.sources) {
      src.sample(dt);
      src.contribute(s);
    }
    s.steer = Math.max(-1, Math.min(1, s.steer));
    s.brake = Math.max(0, Math.min(1, s.brake));
    return s;
  }

  dispose(): void {
    for (const src of this.sources) src.dispose();
  }
}
