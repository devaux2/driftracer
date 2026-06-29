import type { Ship } from "../ship/Ship";

const BOOST_SEG = 14;

/**
 * Compact per-player HUD for local split-screen, positioned into one viewport
 * rectangle. Shows the player tag + craft, live position, lap, speed and a
 * boost bar, plus the shared countdown and a finish banner — all scaled to sit
 * cleanly inside a half or quarter of the screen.
 */
export class SplitHud {
  private root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private totalLaps = 3;

  constructor(container: HTMLElement, tag: string, craft: string, accentHex: string) {
    this.root = document.createElement("div");
    this.root.className = "split-hud";
    this.root.innerHTML = `
      <div class="sh-corner tl"></div><div class="sh-corner br"></div>
      <div class="sh-top">
        <span class="sh-tag" style="color:${accentHex}">${tag}</span>
        <span class="sh-craft">${craft}</span>
        <span class="sh-pos"><b class="sh-pos-n">1</b><span class="sh-pos-t">/12</span></span>
      </div>
      <div class="sh-bottom">
        <div class="sh-lap">LAP <b class="sh-lap-n">1</b><span class="sh-lap-t">/3</span></div>
        <div class="sh-speed"><b class="sh-kph">0</b><span class="sh-u">KPH</span></div>
        <div class="sh-boost"></div>
      </div>
      <div class="sh-cd"></div>
      <div class="sh-finish"></div>`;
    container.appendChild(this.root);
    const q = (s: string) => this.root.querySelector<HTMLElement>(s)!;
    for (const k of ["sh-pos-n", "sh-pos-t", "sh-lap-n", "sh-lap-t", "sh-kph", "sh-boost", "sh-cd", "sh-finish"]) {
      this.el[k] = q(`.${k}`);
    }
    this.el["sh-boost"].innerHTML = Array.from({ length: BOOST_SEG }, () => "<i></i>").join("");
    this.root.style.setProperty("--sh-accent", accentHex);
  }

  /** Place this HUD into a screen rectangle (percentages, origin top-left). */
  setRect(x: number, y: number, w: number, h: number): void {
    this.root.style.left = `${x}%`;
    this.root.style.top = `${y}%`;
    this.root.style.width = `${w}%`;
    this.root.style.height = `${h}%`;
    // Quarter-screen viewports get smaller type than half-screen ones.
    this.root.classList.toggle("quarter", w <= 50 && h <= 50);
  }

  setTotalLaps(n: number): void {
    this.totalLaps = n;
    this.el["sh-lap-t"].textContent = `/${n}`;
  }

  setPosition(pos: number, total: number): void {
    this.el["sh-pos-n"].textContent = String(pos);
    this.el["sh-pos-t"].textContent = `/${total}`;
  }

  setCountdown(text: string | null): void {
    const c = this.el["sh-cd"];
    if (text == null) {
      c.style.display = "none";
      return;
    }
    if (c.textContent === text && c.style.display !== "none") return;
    c.textContent = text;
    c.style.display = "flex";
    c.classList.toggle("go", text === "GO");
    c.classList.remove("pop");
    void c.offsetWidth;
    c.classList.add("pop");
  }

  setFinish(text: string | null): void {
    const f = this.el["sh-finish"];
    f.textContent = text ?? "";
    f.classList.toggle("show", !!text);
  }

  update(ship: Ship): void {
    this.el["sh-kph"].textContent = String(ship.speedKph);
    const lap = Math.min(ship.lap + 1, this.totalLaps);
    this.el["sh-lap-n"].textContent = String(lap);
    const fill = Math.round(ship.boostMeter * BOOST_SEG);
    const segs = this.el["sh-boost"].children;
    for (let i = 0; i < segs.length; i++) segs[i].classList.toggle("on", i < fill);
    this.el["sh-boost"].classList.toggle("max", ship.boostMeter >= 1);
  }

  show(v: boolean): void {
    this.root.style.display = v ? "" : "none";
  }

  dispose(): void {
    this.root.remove();
  }
}
