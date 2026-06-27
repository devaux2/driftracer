import type { ControlState, InputSource } from "./types";

/**
 * Gyro / tilt steering via the DeviceOrientation API.
 *
 * In landscape, tilting the device left/right (roll, the `gamma` axis) steers.
 * We capture a neutral baseline on first reading so the player can hold the
 * phone at whatever angle is comfortable. Only steering comes from gyro;
 * braking/boost stay on touch (see TouchInput).
 *
 * iOS 13+ gates this behind a permission prompt that must be triggered from a
 * user gesture — see {@link requestPermission}.
 */
export class GyroInput implements InputSource {
  readonly id = "gyro";
  private steer = 0;
  private baseline: number | null = null;
  private enabled = false;
  private active = false;

  /** Degrees of roll for full lock. */
  private static readonly RANGE = 35;

  private readonly onOrient = (e: DeviceOrientationEvent) => {
    if (!this.enabled || e.gamma == null || e.beta == null) return;
    // In landscape, screen.orientation tells us which way is "up".
    const angle = this.landscapeRoll(e);
    if (this.baseline === null) this.baseline = angle;
    const delta = angle - this.baseline;
    this.steer = clamp(delta / GyroInput.RANGE, -1, 1);
    this.active = true;
  };

  /** Map device orientation to a single roll value that works in either landscape. */
  private landscapeRoll(e: DeviceOrientationEvent): number {
    const type = screen.orientation?.type ?? "landscape-primary";
    // beta is front/back tilt, gamma is left/right; they swap roles in landscape.
    const beta = e.beta ?? 0;
    return type === "landscape-secondary" ? -beta : beta;
  }

  /** Must be called from a user gesture on iOS. Returns whether gyro is usable. */
  async requestPermission(): Promise<boolean> {
    const anyOrient = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    try {
      if (typeof anyOrient.requestPermission === "function") {
        const res = await anyOrient.requestPermission();
        if (res !== "granted") return false;
      }
    } catch {
      return false;
    }
    window.addEventListener("deviceorientation", this.onOrient);
    this.enabled = true;
    this.recenter();
    return true;
  }

  /** Re-capture the neutral hold angle. */
  recenter(): void {
    this.baseline = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.steer = 0;
    else this.recenter();
  }

  sample(): void {
    /* event-driven */
  }

  contribute(out: ControlState): void {
    if (this.enabled && Math.abs(this.steer) > 0.04) out.steer = this.steer;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    window.removeEventListener("deviceorientation", this.onOrient);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
