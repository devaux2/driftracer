import type { ControlState, InputSource } from "./types";

/**
 * Desktop keyboard input.
 *   Steer:  A/D or Left/Right arrows
 *   Brake:  Space (the air-brake; turn while held to drift)
 *   Boost:  Shift
 *   Pause:  Esc / Enter
 */
export class KeyboardInput implements InputSource {
  readonly id = "keyboard";
  private keys = new Set<string>();
  private boostEdge = false;
  private pauseEdge = false;
  private active = false;

  private readonly onDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!this.keys.has(k)) {
      // rising edges for momentary actions
      if (k === "shift") this.boostEdge = true;
      if (k === "escape" || k === "enter") this.pauseEdge = true;
    }
    this.keys.add(k);
    this.active = true;
    if (k === " " || k.startsWith("arrow")) e.preventDefault();
  };

  private readonly onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  constructor() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
  }

  sample(): void {
    /* keyboard is event-driven; nothing to poll */
  }

  contribute(out: ControlState): void {
    let steer = 0;
    if (this.keys.has("a") || this.keys.has("arrowleft")) steer -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) steer += 1;
    if (steer !== 0) out.steer = steer;

    if (this.keys.has(" ")) out.brake = 1;
    if (this.boostEdge) out.boost = true;
    if (this.pauseEdge) out.pause = true;

    this.boostEdge = false;
    this.pauseEdge = false;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
  }
}
