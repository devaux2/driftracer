import { logoMark } from "./marks";

/**
 * Pre-splash boot gate. Its only job is to capture the first user gesture
 * (Enter / click / tap) so we can go fullscreen *before* revealing the splash —
 * that way the splash itself is shown full-screen. Fires `onEnter` once.
 */
export class Boot {
  private root: HTMLDivElement;
  private done = false;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") this.go();
  };

  constructor(container: HTMLElement, private onEnter: () => void) {
    this.root = document.createElement("div");
    this.root.className = "vd-boot overlay";
    this.root.innerHTML = `
      <div class="vd-boot-inner">
        <span class="vd-boot-mark">${logoMark()}</span>
        <p class="vd-boot-sys">VECTOR DRIFT // SYSTEM READY</p>
        <p class="vd-boot-enter">▶ PRESS ENTER</p>
        <p class="vd-boot-hint">tap / click anywhere to load fullscreen</p>
      </div>`;
    container.appendChild(this.root);

    this.root.addEventListener("click", () => this.go());
    window.addEventListener("keydown", this.onKey);
  }

  private go(): void {
    if (this.done) return;
    this.done = true;
    window.removeEventListener("keydown", this.onKey);
    this.root.classList.add("fade-out");
    setTimeout(() => this.root.remove(), 350);
    this.onEnter();
  }
}
