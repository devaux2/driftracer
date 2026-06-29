import { SHIPS, getShipById, type ShipSpec } from "../config/ships";
import { TRACKS } from "../config/tracks";
import { logoMark, ICONS, shipIcon, trackThumb } from "./marks";
import { ShipPreview } from "./ShipPreview";
import type { AudioManager, Pool } from "../audio/AudioManager";
import { assignSchemes, schemeLabel } from "../input/PlayerInput";

type Screen = "main" | "garage" | "tracks" | "music" | "local";

interface GameMode {
  id: string;
  name: string;
  jp: string;
  icon: string;
  /** false = placeholder (Grand Prix / Multiplayer aren't built yet). */
  playable: boolean;
}

const MODES: GameMode[] = [
  { id: "quick", name: "QUICK RACE", jp: "クイックレース", icon: ICONS.quick, playable: true },
  { id: "time", name: "TIME ATTACK", jp: "タイムアタック", icon: ICONS.time, playable: true },
  { id: "tracks", name: "SELECT TRACK", jp: "コース選択", icon: ICONS.track, playable: true },
  { id: "gp", name: "GRAND PRIX", jp: "グランプリ", icon: ICONS.gp, playable: false },
  { id: "local", name: "LOCAL RACE", jp: "ローカル対戦", icon: ICONS.mp, playable: true },
  { id: "mp", name: "ONLINE", jp: "オンライン", icon: ICONS.mp, playable: false },
  { id: "garage", name: "GARAGE", jp: "ガレージ", icon: ICONS.garage, playable: true },
  { id: "editor", name: "TRACK EDITOR", jp: "エディター", icon: ICONS.editor, playable: true },
  { id: "music", name: "MUSIC", jp: "ミュージック", icon: ICONS.music, playable: true },
];

function hex(c: ShipSpec): string {
  return c.color.toHexString();
}

/**
 * VECTOR DRIFT front-end. Two screens:
 *  - main: a vertical list of game modes + a 3D hero ship.
 *  - garage: ship roster carousel + stat readout + 3D ship on a neon stage.
 * The chosen ship + control prefs persist across screens. A persistent preview
 * canvas (its own little Babylon view) is overlaid on the hero region of
 * whichever screen is up, so re-rendering the DOM never tears down the 3D view.
 */
export class Menu {
  private root: HTMLDivElement;
  private content: HTMLDivElement;
  private stage: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private preview: ShipPreview;

  private screen: Screen = "main";
  private selectedShipId = SHIPS[0].id;
  private selectedTrackId = TRACKS[0].id;
  /** Currently focused main-menu row (keyboard/gamepad cursor). */
  private focus = "quick";
  private useGyro = false;
  /** Gamepad cursor on the music screen (0 = skip button, 1.. = track rows). */
  private musicFocus = 0;
  /** Local split-screen player count (desktop only). */
  private localCount = 2;

  constructor(
    container: HTMLElement,
    private isTouchDevice: boolean,
    private onStart: (ship: ShipSpec, mode: string, useGyro: boolean, trackId: string) => void,
    private onEditor: () => void,
    private audio: AudioManager,
    private onStartLocal: (count: number, trackId: string) => void
  ) {
    this.root = document.createElement("div");
    this.root.className = "vd-menu overlay";

    this.stage = document.createElement("div");
    this.stage.className = "vd-stage";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "vd-preview";
    this.stage.appendChild(this.canvas);

    this.content = document.createElement("div");
    this.content.className = "vd-content";

    this.root.append(this.stage, this.content);
    container.appendChild(this.root);

    this.preview = new ShipPreview(this.canvas);
    window.addEventListener("resize", () => this.positionPreview());

    this.render();
  }

  private render(): void {
    if (this.screen === "main") this.renderMain();
    else if (this.screen === "garage") this.renderGarage();
    else if (this.screen === "tracks") this.renderTracks();
    else if (this.screen === "music") this.renderMusic();
    else this.renderLocal();
    // Main menu is a live autopilot flythrough; garage/tracks spin the model.
    this.preview.setMode(this.screen === "main" ? "drive" : "showcase");
    this.preview.setShip(getShipById(this.selectedShipId));
    this.preview.setRing(this.screen === "garage");
    this.positionPreview();
  }

  private trackName(id: string): string {
    return TRACKS.find((t) => t.id === id)?.name ?? "—";
  }

  /** Overlay the preview canvas on the current screen's hero element — or, on the
   * main menu, full-bleed behind everything so the autopilot flythrough is an
   * immersive backdrop rather than a boxed-in panel. */
  private positionPreview(): void {
    if (this.root.style.display === "none") {
      this.canvas.style.display = "none";
      return;
    }
    if (this.screen === "main") {
      this.canvas.style.display = "";
      this.canvas.style.left = "0";
      this.canvas.style.top = "0";
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      this.preview.resize();
      return;
    }
    const sel = this.screen === "garage" ? ".vd-garage-hero" : null;
    const hero = sel ? (this.content.querySelector(sel) as HTMLElement | null) : null;
    if (!hero) {
      this.canvas.style.display = "none";
      return;
    }
    const r = hero.getBoundingClientRect();
    const base = this.root.getBoundingClientRect();
    this.canvas.style.display = "";
    this.canvas.style.left = `${r.left - base.left}px`;
    this.canvas.style.top = `${r.top - base.top}px`;
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.preview.resize();
  }

  private plusMarks(): string {
    return `
      <span class="vd-plus vd-p1">+</span>
      <span class="vd-plus vd-p2">+</span>
      <span class="vd-plus vd-p3">+</span>
      <span class="vd-plus vd-p4">+</span>`;
  }

  // ---- main: game modes ----------------------------------------------------

  /** Compact segmented stat bars (shared by garage + desktop hero info). */
  private miniStats(ship: ShipSpec): string {
    const seg = (v: number) => {
      const on = Math.round(v * 8);
      let o = "";
      for (let i = 0; i < 8; i++) o += `<i class="${i < on ? "on" : ""}"></i>`;
      return `<div class="vd-seg">${o}</div>`;
    };
    const row = (l: string, v: number) => `<div class="vd-hi-stat"><span>${l}</span>${seg(v)}</div>`;
    return (
      row("TRN", ship.cornering) +
      row("ACC", ship.acceleration) +
      row("TOP", ship.topSpeed) +
      row("WGT", ship.weight)
    );
  }

  private renderMain(): void {
    this.root.className = "vd-menu overlay vd-screen-main";
    const ship = getShipById(this.selectedShipId);

    const modes = this.visibleModes().map((m) => {
      const sel = m.id === this.focus;
      const sub = m.id === "tracks" ? `${m.jp} · ${this.trackName(this.selectedTrackId)}` : m.jp;
      return `
      <button class="vd-mode ${sel ? "sel" : ""} ${m.playable ? "" : "soon"}" data-mode="${m.id}">
        <span class="vd-ic">${m.icon}</span>
        <span>
          <span class="vd-mode-name">${m.name}</span>
          <span class="vd-mode-jp">${sub}</span>
        </span>
        ${m.playable ? "" : `<span class="soon-tag">SOON</span>`}
      </button>`;
    }).join("");

    this.content.innerHTML = `
      <div class="vd-shell">
        <span class="vd-side-label" style="top:30vh;left:1.6vh">ENTER MENU</span>
        <span class="vd-side-label" style="top:30vh;right:1.6vh">VECTOR DRIFT SYSTEM</span>
        ${this.plusMarks()}
        <div class="vd-corner tl"></div>

        <header class="vd-topbar">
          <div class="vd-brand">
            <span class="vd-badge">${logoMark()}</span>
            <span>
              <span class="vd-brand-name">VECTOR DRIFT</span>
              <span class="vd-brand-jp">ベクタードリフト</span>
            </span>
          </div>
          <div class="vd-meta">
            <span class="vd-meta-txt">
              <span class="vd-meta-label">PILOT ID</span>
              <span class="vd-meta-val">VD-01</span>
            </span>
            <span class="vd-plusbox">+</span>
            <span class="tag vd-hatch-pink"></span>
          </div>
        </header>

        <div class="vd-menu-body">
          <nav class="vd-modes">
            <div class="vd-modes-bracket"></div>
            ${modes}
          </nav>
          <div class="vd-hero">
            <div class="vd-hero-info">
              <div class="vd-hi-name">${ship.code} <span>${ship.name}</span></div>
              ${this.miniStats(ship)}
            </div>
          </div>
        </div>

        <footer class="vd-botbar">
          <button class="vd-act select-act"><span class="ring">✕</span> SELECT</button>
          <div class="vd-status">
            ${this.isTouchDevice ? `<button class="vd-gyro ${this.useGyro ? "on" : ""}">TILT ${this.useGyro ? "ON" : "OFF"}</button>` : ""}
            <span><span class="dot"></span>ONLINE</span><span>REGION // ASIA »</span>
          </div>
        </footer>
      </div>`;

    this.content.querySelectorAll<HTMLButtonElement>(".vd-mode").forEach((btn) => {
      btn.addEventListener("click", () => this.pickMode(btn.dataset.mode!));
    });
    this.content
      .querySelector<HTMLButtonElement>(".select-act")!
      .addEventListener("click", () => this.activate(this.focus));
    this.content.querySelector<HTMLButtonElement>(".vd-gyro")?.addEventListener("click", () => {
      this.useGyro = !this.useGyro;
      this.render();
    });
  }

  /** Modes shown on this device (local split-screen is desktop-only). */
  private visibleModes(): GameMode[] {
    return MODES.filter((m) => !(m.id === "local" && this.isTouchDevice));
  }

  /** IDs the cursor can land on (playable rows, incl. Garage). */
  private navIds(): string[] {
    return this.visibleModes().filter((m) => m.playable).map((m) => m.id);
  }

  /** Click a row: focus it and act immediately. */
  private pickMode(id: string): void {
    if (!this.navIds().includes(id)) return;
    this.focus = id;
    this.activate(id);
  }

  /** Act on a row: open the garage/editor, or start a playable mode. */
  private activate(id: string): void {
    if (id === "garage") {
      this.goto("garage");
      return;
    }
    if (id === "editor") {
      this.onEditor();
      return;
    }
    if (id === "tracks") {
      this.goto("tracks");
      return;
    }
    if (id === "music") {
      this.musicFocus = 0;
      this.goto("music");
      return;
    }
    if (id === "local") {
      this.goto("local");
      return;
    }
    const mode = MODES.find((m) => m.id === id);
    if (mode?.playable) {
      this.onStart(getShipById(this.selectedShipId), id, this.useGyro, this.selectedTrackId);
    }
  }

  /** Move the main-menu cursor by `dir` (-1 up / +1 down), wrapping. */
  private moveFocus(dir: number): void {
    const ids = this.navIds();
    const i = ids.indexOf(this.focus);
    this.focus = ids[(i + dir + ids.length) % ids.length] ?? ids[0];
    this.renderMain();
  }

  /** Drive the menu from a gamepad (or other) navigation event. */
  handlePad(nav: { up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; back: boolean }): void {
    if (this.screen === "main") {
      if (nav.up) this.moveFocus(-1);
      if (nav.down) this.moveFocus(1);
      if (nav.confirm) this.activate(this.focus);
    } else if (this.screen === "garage") {
      if (nav.left) this.cycle(-1);
      if (nav.right) this.cycle(1);
      if (nav.confirm || nav.back) this.goto("main");
    } else if (this.screen === "tracks") {
      if (nav.left) this.cycleTrack(-1);
      if (nav.right) this.cycleTrack(1);
      if (nav.confirm || nav.back) this.goto("main");
    } else if (this.screen === "local") {
      if (nav.left) this.setLocalCount(this.localCount - 1);
      if (nav.right) this.setLocalCount(this.localCount + 1);
      if (nav.confirm) this.onStartLocal(this.localCount, this.selectedTrackId);
      if (nav.back) this.goto("main");
    } else {
      this.handleMusicPad(nav);
    }
  }

  // ---- local split-screen setup (desktop only) -----------------------------

  private setLocalCount(n: number): void {
    this.localCount = Math.max(2, Math.min(4, n));
    this.renderLocal();
  }

  private renderLocal(): void {
    this.root.className = "vd-menu overlay vd-screen-local";
    const schemes = assignSchemes(this.localCount);
    const accents = ["#d8f600", "#00d7f2", "#ff5a1f", "#f4044e"];

    const players = Array.from({ length: this.localCount }, (_, i) => {
      const s = SHIPS[i % SHIPS.length];
      const ctl = schemes[i] ? schemeLabel(schemes[i]) : "—";
      return `
        <div class="vd-lc-player">
          <span class="vd-lc-tag" style="color:${accents[i]}">P${i + 1}</span>
          <span class="vd-lc-craft">${s.code} <b>${s.name}</b></span>
          <span class="vd-lc-ctl">${ctl}</span>
        </div>`;
    }).join("");

    const counts = [2, 3, 4]
      .map((n) => `<button class="vd-lc-count ${n === this.localCount ? "sel" : ""}" data-n="${n}">${n}P</button>`)
      .join("");

    this.content.innerHTML = `
      <div class="vd-shell">
        ${this.plusMarks()}
        <header class="vd-topbar">
          <div class="vd-brand vd-brand--garage">
            <span class="vd-badge">${logoMark()}</span>
            <span>
              <span class="vd-brand-name">LOCAL RACE</span>
              <span class="vd-brand-jp">ローカル対戦</span>
            </span>
          </div>
        </header>

        <div class="vd-lc-body">
          <div class="vd-lc-counts"><span class="vd-lc-label">PLAYERS</span>${counts}</div>
          <div class="vd-lc-players">${players}</div>
          <p class="vd-lc-hint">Split-screen on this screen · course: ${this.trackName(this.selectedTrackId)}. Gamepads are assigned first, then the keyboard splits into ARROW KEYS + WASD.</p>
        </div>

        <footer class="vd-botbar">
          <button class="vd-act back-act"><span class="ring">✕</span> BACK</button>
          <button class="vd-act start-local"><span class="ring">▶</span> START</button>
        </footer>
      </div>`;

    this.content.querySelectorAll<HTMLButtonElement>(".vd-lc-count").forEach((b) => {
      b.addEventListener("click", () => this.setLocalCount(parseInt(b.dataset.n!, 10)));
    });
    this.content
      .querySelector<HTMLButtonElement>(".start-local")!
      .addEventListener("click", () => this.onStartLocal(this.localCount, this.selectedTrackId));
    this.content.querySelector<HTMLButtonElement>(".back-act")!.addEventListener("click", () => this.goto("main"));
  }

  // ---- garage: ship select -------------------------------------------------

  private renderGarage(): void {
    this.root.className = "vd-menu overlay vd-screen-garage";
    const ship = getShipById(this.selectedShipId);

    const seg = (value: number): string => {
      const on = Math.round(value * 8);
      let out = "";
      for (let i = 0; i < 8; i++) out += `<i class="${i < on ? "on" : ""}"></i>`;
      return `<div class="vd-seg">${out}</div>`;
    };
    const stat = (label: string, jp: string, value: number): string => `
      <div class="vd-stat">
        <div><span class="vd-stat-label">${label}</span><span class="vd-stat-jp">${jp}</span></div>
        ${seg(value)}
      </div>`;

    const cards = SHIPS.map(
      (s) => `
      <button class="vd-card ${s.id === this.selectedShipId ? "sel" : ""}" data-id="${s.id}">
        ${shipIcon(s.id, hex(s))}
        <span class="vd-card-name">${s.code} // ${s.name}</span>
      </button>`
    ).join("");

    this.content.innerHTML = `
      <div class="vd-shell">
        ${this.plusMarks()}

        <header class="vd-topbar">
          <div class="vd-brand vd-brand--garage">
            <span class="vd-badge">${logoMark()}</span>
            <span>
              <span class="vd-brand-name">GARAGE<span class="vd-hatch-pink" style="width:18vh;max-width:24vw;height:1.3vh;display:inline-block"></span></span>
              <span class="vd-brand-jp">ガレージ</span>
            </span>
          </div>
          <div class="vd-meta">
            <span class="vd-meta-txt">
              <span class="vd-meta-label">CREDITS</span>
              <span class="vd-meta-val">12,450</span>
            </span>
            <span class="vd-plusbox">+</span>
          </div>
        </header>

        <div class="vd-garage-body">
          <aside class="vd-statcard">
            <span class="arrow">↗</span>
            <div class="vd-sc-name">${ship.code} // ${ship.name}</div>
            <div class="vd-sc-jp">${ship.jp}</div>
            ${stat("TURNING", "旋回性能", ship.cornering)}
            ${stat("ACCELERATION", "加速", ship.acceleration)}
            ${stat("TOP SPEED", "最高速度", ship.topSpeed)}
            ${stat("WEIGHT", "重量", ship.weight)}
            <span class="corner"></span>
          </aside>

          <div class="vd-garage-hero"></div>

          <div class="vd-sidenav">
            <span class="tab">${ship.code}</span>
            <span class="num">20</span>
            <span class="ico vd-ic">${ICONS.mp}</span>
            <span class="vd-plus" style="position:static">◆</span>
          </div>
        </div>

        <div class="vd-roster">
          <button class="nav prev">‹</button>
          <div class="vd-cards">${cards}</div>
          <button class="nav next">›</button>
        </div>

        <footer class="vd-botbar">
          <button class="vd-act back-act"><span class="ring">✕</span> BACK</button>
          <button class="vd-act select-act">SELECT <span class="ring">✕</span></button>
        </footer>
      </div>`;

    this.content.querySelectorAll<HTMLButtonElement>(".vd-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedShipId = btn.dataset.id!;
        this.render();
      });
    });
    this.content.querySelector<HTMLButtonElement>(".prev")!.addEventListener("click", () => this.cycle(-1));
    this.content.querySelector<HTMLButtonElement>(".next")!.addEventListener("click", () => this.cycle(1));
    this.content.querySelector<HTMLButtonElement>(".back-act")!.addEventListener("click", () => this.goto("main"));
    this.content.querySelector<HTMLButtonElement>(".select-act")!.addEventListener("click", () => this.goto("main"));
  }

  private cycle(dir: number): void {
    const idx = SHIPS.findIndex((s) => s.id === this.selectedShipId);
    const next = (idx + dir + SHIPS.length) % SHIPS.length;
    this.selectedShipId = SHIPS[next].id;
    this.render();
  }

  // ---- tracks: curated map picker (approved tracks only) -------------------

  private renderTracks(): void {
    this.root.className = "vd-menu overlay vd-screen-tracks";

    const cards = TRACKS.map(
      (t) => `
      <button class="vd-track-card ${t.id === this.selectedTrackId ? "sel" : ""}" data-id="${t.id}">
        ${trackThumb(t.points)}
        <span class="vd-track-name">${t.name}</span>
      </button>`
    ).join("");

    this.content.innerHTML = `
      <div class="vd-shell">
        ${this.plusMarks()}
        <header class="vd-topbar">
          <div class="vd-brand vd-brand--garage">
            <span class="vd-badge">${logoMark()}</span>
            <span>
              <span class="vd-brand-name">SELECT TRACK</span>
              <span class="vd-brand-jp">コース選択</span>
            </span>
          </div>
        </header>

        <div class="vd-track-grid">${cards}</div>

        <footer class="vd-botbar">
          <button class="vd-act back-act"><span class="ring">✕</span> BACK</button>
          <button class="vd-act select-act">SELECT <span class="ring">✕</span></button>
        </footer>
      </div>`;

    this.content.querySelectorAll<HTMLButtonElement>(".vd-track-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedTrackId = btn.dataset.id!;
        this.goto("main");
      });
    });
    this.content.querySelector<HTMLButtonElement>(".back-act")!.addEventListener("click", () => this.goto("main"));
    this.content.querySelector<HTMLButtonElement>(".select-act")!.addEventListener("click", () => this.goto("main"));
  }

  private cycleTrack(dir: number): void {
    const idx = TRACKS.findIndex((t) => t.id === this.selectedTrackId);
    const next = (idx + dir + TRACKS.length) % TRACKS.length;
    this.selectedTrackId = TRACKS[next].id;
    this.render();
  }

  // ---- music: per-track pool curation --------------------------------------

  private renderMusic(): void {
    this.root.className = "vd-menu overlay vd-screen-music";
    const tracks = this.audio.tracks();
    const np = this.audio.currentTrack;

    const rows = tracks
      .map((t, i) => {
        const menuOn = this.audio.isEnabled(t, "menu");
        const raceOn = this.audio.isEnabled(t, "race");
        const foc = this.musicFocus === i + 1 ? "foc" : "";
        return `
        <div class="vd-mus-row ${foc}" data-i="${i}">
          <span class="vd-mus-kind k-${t.kind}">${t.kind}</span>
          <span class="vd-mus-meta"><b>${t.title}</b><span>${t.artist}</span></span>
          <button class="vd-mus-tog ${menuOn ? "on" : ""}" data-i="${i}" data-pool="menu">MENU</button>
          <button class="vd-mus-tog ${raceOn ? "on" : ""}" data-i="${i}" data-pool="race">RACE</button>
        </div>`;
      })
      .join("");

    this.content.innerHTML = `
      <div class="vd-shell">
        ${this.plusMarks()}
        <header class="vd-topbar">
          <div class="vd-brand vd-brand--garage">
            <span class="vd-badge">${logoMark()}</span>
            <span>
              <span class="vd-brand-name">MUSIC</span>
              <span class="vd-brand-jp">ミュージック</span>
            </span>
          </div>
          <div class="vd-mus-now">
            <span class="vd-mus-now-k">NOW PLAYING <i>再生中</i></span>
            <span class="vd-mus-now-t">${np ? `${np.title} — ${np.artist}` : "—"}</span>
            <button class="vd-mus-skip ${this.musicFocus === 0 ? "foc" : ""}">⏭ SKIP</button>
          </div>
        </header>

        <p class="vd-mus-hint">Choose which tracks play in the MENU pool and the RACE pool. Disabled tracks are skipped in that context.</p>
        <div class="vd-mus-list">${rows}</div>

        <footer class="vd-botbar">
          <button class="vd-act back-act"><span class="ring">✕</span> BACK</button>
        </footer>
      </div>`;

    this.content.querySelectorAll<HTMLButtonElement>(".vd-mus-tog").forEach((b) => {
      b.addEventListener("click", () => {
        const i = parseInt(b.dataset.i!, 10);
        const pool = b.dataset.pool as Pool;
        const on = !this.audio.isEnabled(tracks[i], pool);
        this.audio.setEnabled(tracks[i], pool, on);
        b.classList.toggle("on", on);
      });
    });
    this.content.querySelector<HTMLButtonElement>(".vd-mus-skip")!.addEventListener("click", () => {
      this.audio.skip();
      this.refreshNowPlaying();
    });
    this.content.querySelector<HTMLButtonElement>(".back-act")!.addEventListener("click", () => this.goto("main"));
  }

  private refreshNowPlaying(): void {
    const el = this.content.querySelector(".vd-mus-now-t");
    const np = this.audio.currentTrack;
    if (el) el.textContent = np ? `${np.title} — ${np.artist}` : "—";
  }

  private scrollMusicFocus(): void {
    const el = this.content.querySelector(".vd-mus-row.foc, .vd-mus-skip.foc");
    el?.scrollIntoView({ block: "nearest" });
  }

  private handleMusicPad(nav: { up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; back: boolean }): void {
    if (nav.back) {
      this.goto("main");
      return;
    }
    const n = this.audio.tracks().length;
    if (nav.up || nav.down) {
      const slots = n + 1; // skip button + one per track
      this.musicFocus = (this.musicFocus + (nav.down ? 1 : -1) + slots) % slots;
      this.renderMusic();
      this.scrollMusicFocus();
      return;
    }
    if (this.musicFocus === 0) {
      if (nav.confirm) {
        this.audio.skip();
        this.refreshNowPlaying();
      }
      return;
    }
    const t = this.audio.tracks()[this.musicFocus - 1];
    if (nav.left || nav.confirm) {
      this.audio.setEnabled(t, "menu", !this.audio.isEnabled(t, "menu"));
      this.renderMusic();
      this.scrollMusicFocus();
    } else if (nav.right) {
      this.audio.setEnabled(t, "race", !this.audio.isEnabled(t, "race"));
      this.renderMusic();
      this.scrollMusicFocus();
    }
  }

  private goto(screen: Screen): void {
    this.screen = screen;
    this.render();
  }

  show(v: boolean): void {
    if (v) this.screen = "main";
    this.root.style.display = v ? "" : "none";
    this.preview.setActive(v);
    if (v) this.render();
  }
}
