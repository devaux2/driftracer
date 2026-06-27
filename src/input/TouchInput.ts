import type { ControlState, InputSource } from "./types";

/**
 * Touch controls for mobile, rendered as a DOM overlay so they stay crisp and
 * cost nothing on the GPU.
 *
 * Layout (landscape):
 *   - Left half: a FLOATING analog joystick. Touch anywhere in the zone and the
 *     stick spawns under your thumb; drag left/right to steer (analog, so you
 *     get fine control, not just full-lock).
 *   - Bottom-right: BRAKE (large — the primary action; hold + steer to drift).
 *   - Above brake: BOOST.
 *
 * When gyro steering is enabled the joystick zone is disabled (tilt steers
 * instead); BRAKE/BOOST stay as touch buttons.
 */
export class TouchInput implements InputSource {
  readonly id = "touch";

  private root: HTMLDivElement;
  private stickZone: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickThumb: HTMLDivElement;
  private brakeBtn: HTMLButtonElement;
  private boostBtn: HTMLButtonElement;

  private steer = 0;
  private brakeHeld = false;
  private boostEdge = false;
  private active = false;
  private steeringEnabled = true;

  private stickPointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  /** Max thumb travel / full-lock distance, in px. */
  private static readonly RADIUS = 52;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "touch-controls";

    this.stickZone = document.createElement("div");
    this.stickZone.className = "stick-zone";

    this.stickBase = document.createElement("div");
    this.stickBase.className = "stick-base";
    this.stickThumb = document.createElement("div");
    this.stickThumb.className = "stick-thumb";
    this.stickBase.appendChild(this.stickThumb);

    this.brakeBtn = this.makeButton("action-btn brake", "BRAKE");
    this.boostBtn = this.makeButton("action-btn boost", "BOOST");

    this.bindStick();
    this.bindHold(this.brakeBtn, (down) => (this.brakeHeld = down));
    this.boostBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.boostEdge = true;
      this.active = true;
    });

    this.root.append(this.stickZone, this.stickBase, this.brakeBtn, this.boostBtn);
    container.appendChild(this.root);
  }

  private makeButton(className: string, label: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `touch-pad ${className}`;
    b.textContent = label;
    return b;
  }

  // ---- floating joystick ----------------------------------------------------

  private bindStick(): void {
    const zone = this.stickZone;

    const down = (e: PointerEvent) => {
      if (!this.steeringEnabled || this.stickPointerId !== null) return;
      e.preventDefault();
      this.stickPointerId = e.pointerId;
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.stickBase.style.left = `${this.originX}px`;
      this.stickBase.style.top = `${this.originY}px`;
      this.stickBase.classList.add("visible");
      this.moveThumb(0, 0);
      this.active = true;
      zone.setPointerCapture?.(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointerId) return;
      e.preventDefault();
      const R = TouchInput.RADIUS;
      let dx = e.clientX - this.originX;
      let dy = e.clientY - this.originY;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      this.moveThumb(dx, dy);
      this.steer = dx / R; // analog, -1..1
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointerId) return;
      this.stickPointerId = null;
      this.steer = 0;
      this.stickBase.classList.remove("visible");
    };

    zone.addEventListener("pointerdown", down);
    zone.addEventListener("pointermove", move);
    zone.addEventListener("pointerup", up);
    zone.addEventListener("pointercancel", up);
    zone.addEventListener("lostpointercapture", up);
  }

  private moveThumb(dx: number, dy: number): void {
    this.stickThumb.style.transform = `translate(${dx}px, ${dy}px)`;
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

  // ---- InputSource ----------------------------------------------------------

  /** Disable the joystick when gyro takes over steering. */
  setSteeringEnabled(enabled: boolean): void {
    this.steeringEnabled = enabled;
    this.stickZone.style.display = enabled ? "" : "none";
    if (!enabled) {
      this.steer = 0;
      this.stickPointerId = null;
      this.stickBase.classList.remove("visible");
    }
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? "" : "none";
  }

  sample(): void {
    /* event-driven */
  }

  contribute(out: ControlState): void {
    if (this.steeringEnabled && Math.abs(this.steer) > 0.03) out.steer = this.steer;
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
