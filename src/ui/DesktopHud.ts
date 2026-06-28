import { logoMark } from "./marks";
import type { Ship } from "../ship/Ship";

export interface StandingRow {
  pos: number;
  name: string;
  you: boolean;
  /** Metres ahead(-) / behind(+) of the player. */
  gap: number;
}

function fmt3(ms: number | null): string {
  if (ms == null) return "--:--.---";
  const t = ms / 1000;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const mil = Math.floor(ms % 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(mil).padStart(3, "0")}`;
}
function digits(s: string): string {
  let out = "";
  for (const ch of s) out += ch >= "0" && ch <= "9" ? `<span class="dig">${ch}</span>` : ch;
  return out;
}

const BOOST_SEGMENTS = 22;

/**
 * Desktop in-race HUD — the VECTOR DRIFT FUI dashboard: position/lap (top-left),
 * time + best/last (top-right), nearby-rivals board (right), track minimap card
 * (bottom-left, populated by Minimap), and speed + boost (bottom-right), with a
 * centre brand bar. Mobile uses the simpler touch HUD instead.
 */
export class DesktopHud {
  private root: HTMLDivElement;
  /** Slot the Minimap canvas mounts into (bottom-left track card). */
  readonly minimapMount: HTMLDivElement;

  private totalLaps = 3;
  private standingsSig = "";

  private el: Record<string, HTMLElement> = {};

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "dhud";
    this.root.innerHTML = `
      <header class="dhud-ticker">
        <span class="dhud-eq"><i></i><i></i><i></i><i></i></span>
        <span class="dhud-tick">
          <b class="dhud-tick-k">NOW PLAYING <i>再生中</i></b>
          <span class="d-now">—</span>
        </span>
      </header>

      <div class="dhud-panel dhud-pos">
        <span class="dhud-corner tl"></span><span class="dhud-corner br"></span>
        <div class="dhud-k">POSITION <i>順位</i></div>
        <div class="dhud-pos-v"><b class="d-pos">11</b><span class="d-pos-tot">/12</span></div>
        <div class="dhud-k lap">LAP <i>ラップ</i></div>
        <div class="dhud-lap-v"><b class="d-lap">1</b><span class="d-lap-tot">/3</span></div>
      </div>

      <div class="dhud-panel dhud-time">
        <span class="dhud-corner tl"></span><span class="dhud-corner br"></span>
        <div class="dhud-k">TIME <i>タイム</i></div>
        <div class="dhud-time-v d-time">00:00.000</div>
        <div class="dhud-sub"><span>BEST <i>ベスト</i></span><b class="d-best">--:--.---</b></div>
        <div class="dhud-sub"><span>LAST <i>ラスト</i></span><b class="d-last">--:--.---</b></div>
      </div>

      <div class="dhud-nearby">
        <div class="dhud-k">NEARBY <i>近接ライバル</i></div>
        <div class="d-nearby-list"></div>
      </div>

      <div class="dhud-panel dhud-mini">
        <span class="dhud-corner tl"></span><span class="dhud-corner br"></span>
        <div class="dhud-mini-head"><b class="d-track">—</b><span class="d-track-km"></span></div>
        <div class="dhud-mini-jp d-track-jp"></div>
        <div class="dhud-mini-map"></div>
      </div>

      <div class="dhud-speed">
        <div class="dhud-boost-head">// MAX BOOST <i>最大ブースト</i></div>
        <div class="dhud-panel dhud-speed-row">
          <span class="dhud-corner tl"></span><span class="dhud-corner br"></span>
          <span class="dhud-spd-ico">${logoMark()}</span>
          <span class="d-speed">0000</span><span class="dhud-spd-u">KPH<i>速度</i></span>
        </div>
        <div class="dhud-boost"><span class="dhud-k">BOOST <i>ブースト</i></span><div class="d-boost-bar"></div></div>
      </div>

      <div class="dhud-countdown"></div>
      <div class="dhud-wrong">▲ WRONG WAY ▲</div>`;
    container.appendChild(this.root);

    const q = (s: string) => this.root.querySelector<HTMLElement>(s)!;
    for (const k of [
      "d-pos", "d-pos-tot", "d-lap", "d-lap-tot", "d-time", "d-best", "d-last",
      "d-nearby-list", "d-track", "d-track-km", "d-track-jp", "d-speed",
      "d-boost-bar", "dhud-countdown", "dhud-wrong", "d-now",
    ]) {
      this.el[k] = q(`.${k}`);
    }
    this.minimapMount = q(".dhud-mini-map") as HTMLDivElement;

    // build boost segments
    this.el["d-boost-bar"].innerHTML = Array.from({ length: BOOST_SEGMENTS }, () => "<i></i>").join("");
  }

  show(v: boolean): void {
    this.root.style.display = v ? "" : "none";
  }

  setTotalLaps(n: number): void {
    this.totalLaps = n;
    this.root.querySelector(".d-pos-tot");
  }

  /** Update the top now-playing ticker with the current track. */
  setNowPlaying(title: string, artist: string): void {
    this.el["d-now"].textContent = `${title} — ${artist}`;
  }

  setTrackInfo(name: string, km: string): void {
    this.el["d-track"].textContent = name.toUpperCase();
    this.el["d-track-km"].textContent = km;
  }

  setPosition(position: number, total: number): void {
    this.el["d-pos"].textContent = String(position);
    this.el["d-pos-tot"].textContent = `/${total}`;
  }

  setCountdown(text: string | null): void {
    const c = this.el["dhud-countdown"];
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

  setWrongWay(on: boolean): void {
    this.el["dhud-wrong"].classList.toggle("show", on);
  }

  /** Position panel doubles as the visibility toggle in solo modes. */
  showPosition(visible: boolean): void {
    (this.root.querySelector(".dhud-pos") as HTMLElement).style.opacity = visible ? "1" : "0.55";
    (this.root.querySelector(".dhud-nearby") as HTMLElement).style.display = visible ? "" : "none";
  }

  update(ship: Ship): void {
    this.el["d-speed"].textContent = String(Math.min(9999, ship.speedKph)).padStart(4, "0");
    const lap = Math.min(ship.lap + 1, this.totalLaps);
    this.el["d-lap"].textContent = String(lap);
    this.el["d-lap-tot"].textContent = `/${this.totalLaps}`;
    this.el["d-time"].innerHTML = digits(fmt3(ship.currentLapMs));
    this.el["d-best"].innerHTML = digits(fmt3(ship.bestLapMs));
    this.el["d-last"].innerHTML = digits(fmt3(ship.lastLapMs));

    const fill = Math.round(ship.boostMeter * BOOST_SEGMENTS);
    const segs = this.el["d-boost-bar"].children;
    for (let i = 0; i < segs.length; i++) segs[i].classList.toggle("on", i < fill);
    this.el["d-boost-bar"].classList.toggle("max", ship.boostMeter >= 1);
  }

  setStandings(rows: StandingRow[]): void {
    if (!rows.length) return;
    // window of ±2 around the player
    const me = rows.findIndex((r) => r.you);
    const lo = Math.max(0, Math.min(me - 2, rows.length - 5));
    const view = rows.slice(lo, lo + 5);
    const sig = view.map((r) => `${r.pos}${r.name}${Math.round(r.gap)}`).join("|");
    if (sig === this.standingsSig) return;
    this.standingsSig = sig;
    this.el["d-nearby-list"].innerHTML = view
      .map((r) => {
        const g = r.you ? "" : `<span class="d-gap">${r.gap < 0 ? "" : "+"}${Math.round(r.gap)}m</span>`;
        return `<div class="d-near ${r.you ? "you" : ""}"><span class="d-near-pos">${String(r.pos).padStart(2, "0")}</span><span class="d-near-name">${r.name}</span>${g}</div>`;
      })
      .join("");
  }
}
