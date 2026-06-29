import type { ControlState } from "./types";
import { isGameCube, readGameCube } from "./gamecube";

/**
 * A single player's control scheme for local split-screen. Each player owns
 * exactly one: a specific gamepad, or one half of the shared keyboard.
 */
export type Scheme =
  | { kind: "gamepad"; index: number }
  | { kind: "kbd-arrows" }
  | { kind: "kbd-wasd" };

const DEAD = 0.18;
function curve(v: number): number {
  const m = (Math.abs(v) - DEAD) / (1 - DEAD);
  return m > 0 ? Math.sign(v) * Math.min(1, m) : 0;
}

/** Human-readable label for the setup screen. */
export function schemeLabel(s: Scheme): string {
  if (s.kind === "gamepad") return `GAMEPAD ${s.index + 1}`;
  if (s.kind === "kbd-arrows") return "ARROW KEYS";
  return "W A S D";
}

/**
 * Build control schemes for `count` local players. Gamepads are assigned first
 * (one per player), then the keyboard is split (arrows, then WASD) so two
 * players can share one keyboard when there aren't enough pads.
 */
export function assignSchemes(count: number): Scheme[] {
  const pads = (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p);
  const all: Scheme[] = [
    ...pads.map((p) => ({ kind: "gamepad", index: p.index }) as Scheme),
    { kind: "kbd-arrows" },
    { kind: "kbd-wasd" },
  ];
  return all.slice(0, count);
}

/**
 * Per-player control reader. Produces a {@link ControlState} each frame from
 * its assigned scheme, independent of the global InputManager (which still
 * drives menus, pause and single-player). Keyboard schemes use `event.code` so
 * the two halves never collide.
 */
export class PlayerInput {
  private keys = new Set<string>();
  private boostPrev = false;
  private readonly isKbd: boolean;

  private readonly onDown = (e: KeyboardEvent) => {
    if (!this.cares(e.code)) return;
    this.keys.add(e.code);
    e.preventDefault();
  };
  private readonly onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  constructor(readonly scheme: Scheme) {
    this.isKbd = scheme.kind !== "gamepad";
    if (this.isKbd) {
      window.addEventListener("keydown", this.onDown);
      window.addEventListener("keyup", this.onUp);
    }
  }

  private cares(code: string): boolean {
    if (this.scheme.kind === "kbd-arrows")
      return code === "ArrowLeft" || code === "ArrowRight" || code === "ArrowDown" || code === "ShiftRight";
    if (this.scheme.kind === "kbd-wasd")
      return code === "KeyA" || code === "KeyD" || code === "KeyS" || code === "ShiftLeft";
    return false;
  }

  /** Fill `out` with this player's control state for the frame. */
  read(out: ControlState): void {
    out.steer = 0;
    out.brake = 0;
    out.boost = false;
    out.pause = false;

    if (this.scheme.kind === "gamepad") {
      const pad = (navigator.getGamepads?.() ?? [])[this.scheme.index];
      if (!pad) return;
      if (isGameCube(pad)) {
        const gc = readGameCube(pad);
        out.steer = gc.steer;
        out.brake = gc.brake;
        out.boost = gc.boost && !this.boostPrev;
        this.boostPrev = gc.boost;
        return;
      }
      const b = (i: number) => pad.buttons[i]?.value ?? 0;
      const pressed = (i: number) => !!pad.buttons[i]?.pressed;
      let steer = curve(pad.axes[0] ?? 0);
      if (pressed(14)) steer = -1;
      if (pressed(15)) steer = 1;
      out.steer = steer;
      out.brake = Math.max(b(7), b(6), b(0));
      const boost = pressed(5) || pressed(1);
      out.boost = boost && !this.boostPrev;
      this.boostPrev = boost;
      return;
    }

    const k = this.keys;
    if (this.scheme.kind === "kbd-arrows") {
      if (k.has("ArrowLeft")) out.steer -= 1;
      if (k.has("ArrowRight")) out.steer += 1;
      if (k.has("ArrowDown")) out.brake = 1;
      const boost = k.has("ShiftRight");
      out.boost = boost && !this.boostPrev;
      this.boostPrev = boost;
    } else {
      if (k.has("KeyA")) out.steer -= 1;
      if (k.has("KeyD")) out.steer += 1;
      if (k.has("KeyS")) out.brake = 1;
      const boost = k.has("ShiftLeft");
      out.boost = boost && !this.boostPrev;
      this.boostPrev = boost;
    }
  }

  dispose(): void {
    if (this.isKbd) {
      window.removeEventListener("keydown", this.onDown);
      window.removeEventListener("keyup", this.onUp);
    }
  }
}
