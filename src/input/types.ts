/**
 * The single normalized control signal the game acts on each frame.
 * Every input device (keyboard, touch, gyro, gamepad) reduces to this.
 *
 * Note there is intentionally no "accelerate" — the ship auto-accelerates.
 * The player's job is to brake (which, mid-turn, becomes a drift) and steer.
 */
export interface ControlState {
  /** -1 (full left) .. +1 (full right). */
  steer: number;
  /** 0 .. 1 — air-brake amount. Held while braking/drifting. */
  brake: number;
  /** Momentary: true on the frame boost is requested. */
  boost: boolean;
  /** Momentary: true on the frame a UI "confirm"/pause is requested. */
  pause: boolean;
}

export function neutralControl(): ControlState {
  return { steer: 0, brake: 0, boost: false, pause: false };
}

/**
 * An input device. Each source writes its contribution into the shared state.
 * Multiple sources can be active at once (e.g. keyboard + gamepad on desktop);
 * the InputManager merges them.
 */
export interface InputSource {
  readonly id: string;
  /** Called once per frame to refresh internal device state. */
  sample(dt: number): void;
  /** Merge this device's contribution into the aggregate control state. */
  contribute(out: ControlState): void;
  /** Whether this device currently has the player's attention (any activity). */
  isActive(): boolean;
  dispose(): void;
}
