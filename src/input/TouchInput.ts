import type { ControlState, InputSource } from "./types";

/**
 * Touch controls for mobile, rendered as a DOM overlay so they stay crisp and
 * cost nothing on the GPU.
 *
 * Layout (landscape):
 *   - Left third / right third: STEER LEFT / STEER RIGHT hold pads.
 *   - Bottom-right: BRAKE (large, the primary action — "touch to brake/drift").
 *   - Above brake: BOOST.
 *
 * When gyro steering is enabled the two steer pads hide themselves and the
 * whole left area becomes an additional brake target, matching the brief's
 * "touch the screen to brake".
 */
export class TouchInput implements InputSource {
  readonly id = "touch";

  private root: HTMLDivElement;
  private steerPadL: HTMLButtonElement;
  private steerPadR: HTMLButtonElement;
  private brakeBtn: HTMLButtonElement;
  private boostBtn: HTMLButtonElement;

  private steer = 0;
  private brakeHeld = false;
  private boostEdge = false;
  private active = false;
  private steeringEnabled = true;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "touch-controls";

    this.steerPadL = this.makePad("steer-pad left", "‹");
    this.steerPadR = this.makePad("steer-pad right", "›");
    this.brakeBtn = this.makePad("action-btn brake", "BRAKE");
    this.boostBtn = this.makePad("action-btn boost", "BOOST");

    this.bindHold(this.steerPadL, (down) => (this.steer = down ? -1 : 0));
    this.bindHold(this.steerPadR, (down) => (this.steer = down ? 1 : 0));
    this.bindHold(this.brakeBtn, (down) => (this.brakeHeld = down));
    this.boostBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.boostEdge = true;
      this.active = true;
    });

    this.root.append(this.steerPadL, this.steerPadR, this.brakeBtn, this.boostBtn);
    container.appendChild(this.root);
  }

  private makePad(className: string, label: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `touch-pad ${className}`;
    b.textContent = label;
    return b;
  }

  private bindHold(el: HTMLElement, set: (down: boolean) => void) {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      set(true);
      this.active = true;
      el.classList.add("pressed");
      el.setPointerCapture?.(e.pointerId);
    };
    const up = (e: PointerEvent) => {
      e.preventDefault();
      set(false);
      el.classList.remove("pressed");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", () => {
      set(false);
      el.classList.remove("pressed");
    });
  }

  /** Hide/show the steer pads (used when gyro takes over steering). */
  setSteeringEnabled(enabled: boolean): void {
    this.steeringEnabled = enabled;
    this.steerPadL.style.display = enabled ? "" : "none";
    this.steerPadR.style.display = enabled ? "" : "none";
    if (!enabled) this.steer = 0;
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? "" : "none";
  }

  sample(): void {
    /* event-driven */
  }

  contribute(out: ControlState): void {
    if (this.steeringEnabled && this.steer !== 0) out.steer = this.steer;
    if (this.brakeHeld) out.brake = 1;
    if (this.boostEdge) out.boost = true;
    this.boostEdge = false;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.root.remove();
  }
}
