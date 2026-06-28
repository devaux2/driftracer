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
  private lastEl: HTMLElement;
  private standingsEl: HTMLElement;
  private standingsPanel: HTMLElement;
  private standingsSig = "";
  private driftEl: HTMLElement;
  private boostEl: HTMLElement;
  private posNumEl: HTMLElement;
  private posTotalEl: HTMLElement;
  private posPanel: HTMLElement;
  private countdownEl: HTMLElement;
  private countdownText: string | null = null;
  private wrongEl: HTMLElement;
  private totalLaps = 3;

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
          <div class="time-last">LAST --:--.--</div>
        </div>
      </div>

      <div class="hud-panel standings">
        <div class="panel-skew"><div class="standings-list"></div></div>
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
      </div>

      <div class="countdown"></div>
      <div class="wrong-way">▲ WRONG WAY ▲</div>`;
    container.appendChild(this.root);

    this.speedEl = this.root.querySelector(".kph")!;
    this.speedBar = this.root.querySelector(".speed-fill")!;
    this.lapEl = this.root.querySelector(".lap-num")!;
    this.timeEl = this.root.querySelector(".time-cur")!;
    this.bestEl = this.root.querySelector(".time-best")!;
    this.lastEl = this.root.querySelector(".time-last")!;
    this.standingsEl = this.root.querySelector(".standings-list")!;
    this.standingsPanel = this.root.querySelector(".standings")!;
    this.driftEl = this.root.querySelector(".ind.drift")!;
    this.boostEl = this.root.querySelector(".ind.boost")!;
    this.posNumEl = this.root.querySelector(".pos-num")!;
    this.posTotalEl = this.root.querySelector(".pos-total")!;
    this.posPanel = this.root.querySelector(".pos-panel")!;
    this.countdownEl = this.root.querySelector(".countdown")!;
    this.wrongEl = this.root.querySelector(".wrong-way")!;
  }

  /** Flash the big red WRONG WAY warning (driving the course backwards). */
  setWrongWay(on: boolean): void {
    this.wrongEl.classList.toggle("show", on);
  }

  setTotalLaps(n: number): void {
    this.totalLaps = n;
  }

  /** Show a countdown string (e.g. "3", "GO"), or null to clear it. Called every
   * frame during the count, so it no-ops when the value is unchanged — otherwise
   * the pop animation would restart each frame and never play. */
  setCountdown(text: string | null): void {
    if (text === this.countdownText) return;
    this.countdownText = text;
    if (text == null) {
      this.countdownEl.style.display = "none";
      return;
    }
    this.countdownEl.textContent = text;
    this.countdownEl.style.display = "flex";
    this.countdownEl.classList.toggle("go", text === "GO");
    // restart the pop animation
    this.countdownEl.classList.remove("pop");
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add("pop");
  }

  showPosition(visible: boolean): void {
    this.posPanel.style.display = visible ? "" : "none";
  }

  /** Desktop standings board. Empty list hides it (e.g. Time Attack). CSS only
   * shows it on desktop, so mobile is unaffected. */
  /** No-op on the touch HUD (desktop HUD shows the track card). */
  setTrackInfo(_name: string, _km: string): void {
    /* mobile HUD has no track card */
  }

  /** No-op on the touch HUD (desktop HUD has the now-playing ticker). */
  setNowPlaying(_title: string, _artist: string): void {
    /* mobile shows the slide-in now-playing popup instead */
  }

  setStandings(rows: { pos: number; name: string; you: boolean; gap?: number }[]): void {
    if (!rows.length) {
      this.standingsPanel.classList.remove("on");
      this.standingsSig = "";
      return;
    }
    this.standingsPanel.classList.add("on"); // CSS only reveals it on desktop
    const sig = rows.map((r) => `${r.pos}${r.name}`).join("|");
    if (sig === this.standingsSig) return; // only re-render when the order changes
    this.standingsSig = sig;
    this.standingsEl.innerHTML = rows
      .map(
        (r) =>
          `<div class="standing-row ${r.you ? "you" : ""}"><span class="st-pos">${r.pos}</span><span class="st-name">${r.name}</span></div>`
      )
      .join("");
  }

  update(ship: Ship): void {
    this.speedEl.textContent = String(ship.speedKph);
    // speedRatio caps at 1.2 (boost headroom); normalise so the bar tops out then.
    this.speedBar.style.width = `${Math.min(100, (ship.speedRatio / 1.2) * 100)}%`;
    const lap = Math.min(ship.lap + 1, this.totalLaps);
    this.lapEl.textContent = `${lap}/${this.totalLaps}`;
    this.timeEl.innerHTML = digitize(fmtTime(ship.currentLapMs));
    this.bestEl.innerHTML = `BEST ${digitize(fmtTime(ship.bestLapMs))}`;
    this.lastEl.innerHTML = `LAST ${digitize(fmtTime(ship.lastLapMs))}`;
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
