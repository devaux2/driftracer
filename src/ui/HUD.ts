import type { Ship } from "../ship/Ship";

function fmtTime(ms: number | null): string {
  if (ms == null) return "--:--.--";
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total * 100) % 100);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

/** Lightweight DOM HUD: speed, lap, lap times, drift/boost indicators. */
export class HUD {
  private root: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private speedBar: HTMLDivElement;
  private lapEl: HTMLDivElement;
  private timeEl: HTMLDivElement;
  private bestEl: HTMLDivElement;
  private driftEl: HTMLDivElement;
  private boostEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-lap">LAP <span class="lap-num">1</span></div>
        <div class="hud-time">--:--.--</div>
        <div class="hud-best">BEST --:--.--</div>
      </div>
      <div class="hud-bottom-right">
        <div class="hud-indicators">
          <div class="ind drift">DRIFT</div>
          <div class="ind boost">BOOST</div>
        </div>
        <div class="hud-speed">
          <span class="kph">0</span><span class="unit">KPH</span>
        </div>
        <div class="speed-bar"><div class="speed-fill"></div></div>
      </div>`;
    container.appendChild(this.root);

    this.speedEl = this.root.querySelector(".kph")!;
    this.speedBar = this.root.querySelector(".speed-fill")!;
    this.lapEl = this.root.querySelector(".lap-num")!;
    this.timeEl = this.root.querySelector(".hud-time")!;
    this.bestEl = this.root.querySelector(".hud-best")!;
    this.driftEl = this.root.querySelector(".ind.drift")!;
    this.boostEl = this.root.querySelector(".ind.boost")!;
  }

  update(ship: Ship): void {
    this.speedEl.textContent = String(ship.speedKph);
    this.speedBar.style.width = `${Math.min(100, ship.speedRatio * 100)}%`;
    this.lapEl.textContent = String(Math.max(1, ship.lap));
    this.timeEl.textContent = fmtTime(ship.currentLapMs);
    this.bestEl.textContent = `BEST ${fmtTime(ship.bestLapMs)}`;
    this.driftEl.classList.toggle("active", ship.drifting);
    this.boostEl.classList.toggle("active", ship.boostTimer > 0);
  }

  show(v: boolean): void {
    this.root.style.display = v ? "" : "none";
  }
}
