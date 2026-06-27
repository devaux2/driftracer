import type { Ship } from "../ship/Ship";

function fmtTime(ms: number | null): string {
  if (ms == null) return "--:--.--";
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total * 100) % 100);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

/** Wrap each digit in a fixed-width slot so the clock doesn't jitter as it ticks
 * (separators keep their natural width but sit at fixed positions). */
function digitize(s: string): string {
  let out = "";
  for (const ch of s) out += ch >= "0" && ch <= "9" ? `<span class="dig">${ch}</span>` : ch;
  return out;
}

/**
 * In-game HUD, Wipeout-style: angled/skewed chrome panels. Lap + lap times sit
 * top-left; the big speedometer + drift/boost indicators sit bottom-centre
 * (clear of the on-screen joystick and brake/boost buttons on mobile).
 */
export class HUD {
  private root: HTMLDivElement;
  private speedEl: HTMLElement;
  private speedBar: HTMLElement;
  private lapEl: HTMLElement;
  private timeEl: HTMLElement;
  private bestEl: HTMLElement;
  private driftEl: HTMLElement;
  private boostEl: HTMLElement;
  private posNumEl: HTMLElement;
  private posTotalEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hud-panel pos-panel">
        <div class="panel-skew">
          <span class="pos-num">1</span><span class="pos-total">/12</span>
        </div>
      </div>

      <div class="hud-panel lap-panel">
        <div class="panel-skew">
          <div class="lap-row"><span class="lap-label">LAP</span><span class="lap-num">01</span></div>
          <div class="time-cur">0:00.00</div>
          <div class="time-best">BEST --:--.--</div>
        </div>
      </div>

      <div class="hud-panel speed-panel">
        <div class="panel-skew">
          <div class="indicators">
            <span class="ind drift">DRIFT</span>
            <span class="ind boost">BOOST</span>
          </div>
          <div class="speed-readout">
            <span class="kph">0</span><span class="unit">KPH</span>
          </div>
          <div class="speed-bar"><div class="speed-fill"></div></div>
        </div>
      </div>`;
    container.appendChild(this.root);

    this.speedEl = this.root.querySelector(".kph")!;
    this.speedBar = this.root.querySelector(".speed-fill")!;
    this.lapEl = this.root.querySelector(".lap-num")!;
    this.timeEl = this.root.querySelector(".time-cur")!;
    this.bestEl = this.root.querySelector(".time-best")!;
    this.driftEl = this.root.querySelector(".ind.drift")!;
    this.boostEl = this.root.querySelector(".ind.boost")!;
    this.posNumEl = this.root.querySelector(".pos-num")!;
    this.posTotalEl = this.root.querySelector(".pos-total")!;
  }

  update(ship: Ship): void {
    this.speedEl.textContent = String(ship.speedKph);
    // speedRatio caps at 1.2 (boost headroom); normalise so the bar tops out then.
    this.speedBar.style.width = `${Math.min(100, (ship.speedRatio / 1.2) * 100)}%`;
    this.lapEl.textContent = String(Math.max(1, ship.lap)).padStart(2, "0");
    this.timeEl.innerHTML = digitize(fmtTime(ship.currentLapMs));
    this.bestEl.innerHTML = `BEST ${digitize(fmtTime(ship.bestLapMs))}`;
    this.driftEl.classList.toggle("active", ship.drifting);
    this.boostEl.classList.toggle("active", ship.boostTimer > 0);
  }

  setPosition(position: number, total: number): void {
    this.posNumEl.textContent = String(position);
    this.posTotalEl.textContent = `/${total}`;
  }

  show(v: boolean): void {
    this.root.style.display = v ? "" : "none";
  }
}
