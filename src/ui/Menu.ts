import { SHIPS, getShipById, type ShipSpec } from "../config/ships";
import { TRACKS } from "../config/tracks";
import { logoMark, ICONS, shipIcon, trackThumb } from "./marks";
import { ShipPreview } from "./ShipPreview";
import type { AudioManager, Pool } from "../audio/AudioManager";
import { schemeLabel, type Scheme } from "../input/PlayerInput";
import { isGameCube, readGameCube } from "../input/gamecube";

type Screen = "main" | "garage" | "tracks" | "music" | "local" | "mp" | "solo";

interface GameMode {
  id: string;
  name: string;
  jp: string;
  icon: string;
  /** false = placeholder (Grand Prix / Multiplayer aren't built yet). */
  playable: boolean;
}

/** Condensed top-level menu. SOLO + MULTIPLAYER open submenus. */
const MODES: GameMode[] = [
  { id: "solo", name: "SOLO", jp: "ソロ", icon: ICONS.quick, playable: true },
  { id: "mp", name: "MULTIPLAYER", jp: "マルチプレイヤー", icon: ICONS.mp, playable: true },
  { id: "garage", name: "GARAGE", jp: "ガレージ", icon: ICONS.garage, playable: true },
  { id: "editor", name: "TRACK EDITOR", jp: "エディター", icon: ICONS.editor, playable: true },
  { id: "music", name: "MUSIC", jp: "ミュージック", icon: ICONS.music, playable: true },
];

/** Solo submenu modes. */
const SOLO_MODES: GameMode[] = [
  { id: "quick", name: "QUICK RACE", jp: "クイックレース", icon: ICONS.quick, playable: true },
  { id: "time", name: "TIME ATTACK", jp: "タイムアタック", icon: ICONS.time, playable: true },
  { id: "tracks", name: "SELECT TRACK", jp: "コース選択", icon: ICONS.track, playable: true },
  { id: "gp", name: "GRAND PRIX", jp: "グランプリ", icon: ICONS.gp, playable: false },
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
  private focus = "solo";
  /** Cursor on the SOLO submenu (index into SOLO_MODES). */
  private soloFocus = 0;
  private useGyro = false;
  /** Gamepad cursor on the music screen (0 = skip button, 1.. = track rows). */
  private musicFocus = 0;
  /** Local split-screen join lobby: each slot is a device that claimed it, the
   * craft it's chosen, and whether it has confirmed (ready). Join order = P1.. */
  private lobby: { scheme: Scheme; shipId: string; ready: boolean }[] = [];
  /** Per-gamepad previous button state for edge detection. */
  private padPrev = new Map<number, { a: boolean; b: boolean; start: boolean; left: boolean; right: boolean }>();
  /** Cursor on the multiplayer submenu (0 = local, 1 = online). */
  private mpFocus = 0;
  /** Set on a screen change so render() plays the enter animation once. */
  private entering = false;

  constructor(
    container: HTMLElement,
    private isTouchDevice: boolean,
    private onStart: (ship: ShipSpec, mode: string, useGyro: boolean, trackId: string) => void,
    private onEditor: () => void,
    private audio: AudioManager,
    private onStartLocal: (entries: { scheme: Scheme; shipId: string }[], trackId: string) => void
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
    // Keyboard join/start for the split-screen lobby (only acts on that screen).
    window.addEventListener("keydown", (e) => this.lobbyKey(e));

    this.render();
  }

  private render(): void {
    if (this.screen === "main") this.renderMain();
    else if (this.screen === "garage") this.renderGarage();
    else if (this.screen === "tracks") this.renderTracks();
    else if (this.screen === "music") this.renderMusic();
    else if (this.screen === "local") this.renderLocal();
    else if (this.screen === "mp") this.renderMp();
    else this.renderSolo();
    // Play the screen-enter animation only on an actual screen change, not on
    // the frequent in-screen re-renders (cursor moves, ship cycles, lobby ticks).
    if (this.entering) {
      this.content.querySelector(".vd-shell")?.classList.add("vd-enter");
      this.entering = false;
    }
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

  /** The vertical edge rails + corner accent the main menu carries, so the
   * submenu screens read as intentionally airy rather than empty. */
  private edgeRails(left: string): string {
    return `
      <span class="vd-side-label" style="top:30vh;left:1.6vh">${left}</span>
      <span class="vd-side-label" style="top:30vh;right:1.6vh">VECTOR DRIFT SYSTEM</span>
      <div class="vd-corner tl"></div>`;
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

  /** Top-level modes (all shown — split-screen works wherever there's a
   * keyboard/gamepad, and `isTouchDevice` over-reports on touchscreen laptops). */
  private visibleModes(): GameMode[] {
    return MODES;
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

  /** Act on a top-level row: open the matching submenu / garage / editor. */
  private activate(id: string): void {
    if (id === "solo") {
      this.soloFocus = 0;
      this.goto("solo");
    } else if (id === "mp") {
      this.mpFocus = 0;
      this.goto("mp");
    } else if (id === "garage") {
      this.goto("garage");
    } else if (id === "editor") {
      this.onEditor();
    } else if (id === "music") {
      this.musicFocus = 0;
      this.goto("music");
    }
  }

  /** Act on a SOLO submenu row: start a race, pick a track, or ignore SOON. */
  private soloActivate(id: string): void {
    if (id === "tracks") this.goto("tracks");
    else if (id === "quick" || id === "time") {
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
    } else if (this.screen === "solo") {
      if (nav.up) {
        this.soloFocus = (this.soloFocus - 1 + SOLO_MODES.length) % SOLO_MODES.length;
        this.renderSolo();
      }
      if (nav.down) {
        this.soloFocus = (this.soloFocus + 1) % SOLO_MODES.length;
        this.renderSolo();
      }
      if (nav.confirm) this.soloActivate(SOLO_MODES[this.soloFocus].id);
      if (nav.back) this.goto("main");
    } else if (this.screen === "tracks") {
      if (nav.left) this.cycleTrack(-1);
      if (nav.right) this.cycleTrack(1);
      if (nav.confirm || nav.back) this.goto("solo");
    } else if (this.screen === "mp") {
      if (nav.up || nav.down) {
        this.mpFocus = this.mpFocus === 0 ? 1 : 0;
        this.renderMp();
      }
      if (nav.confirm && this.mpFocus === 0) this.goto("local");
      if (nav.back) this.goto("main");
    } else if (this.screen === "local") {
      // join/leave/start are handled per-device in tick()/lobbyKey(); only the
      // shared "back" comes through the aggregated nav.
      if (nav.back) this.goto("mp");
    } else {
      this.handleMusicPad(nav);
    }
  }

  // ---- solo submenu --------------------------------------------------------

  private renderSolo(): void {
    this.root.className = "vd-menu overlay vd-screen-solo";
    const rows = SOLO_MODES.map((m, i) => {
      const sub = m.id === "tracks" ? `${m.jp} · ${this.trackName(this.selectedTrackId)}` : m.jp;
      return `
        <button class="vd-mode ${this.soloFocus === i ? "sel" : ""} ${m.playable ? "" : "soon"}" data-solo="${m.id}">
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
        ${this.plusMarks()}
        ${this.edgeRails("SELECT MODE")}
        <header class="vd-topbar">
          <div class="vd-brand vd-brand--garage">
            <span class="vd-badge">${logoMark()}</span>
            <span>
              <span class="vd-brand-name">SOLO</span>
              <span class="vd-brand-jp">ソロ</span>
            </span>
          </div>
        </header>

        <div class="vd-mp-body">${rows}</div>

        <footer class="vd-botbar">
          <button class="vd-act back-act"><span class="ring">✕</span> BACK</button>
        </footer>
      </div>`;

    this.content.querySelectorAll<HTMLButtonElement>(".vd-mode").forEach((b) => {
      b.addEventListener("click", () => this.soloActivate(b.dataset.solo!));
    });
    this.content.querySelector<HTMLButtonElement>(".back-act")!.addEventListener("click", () => this.goto("main"));
  }

  // ---- multiplayer submenu -------------------------------------------------

  private renderMp(): void {
    this.root.className = "vd-menu overlay vd-screen-mp";
    const opt = (idx: number, id: string, name: string, jp: string, soon: boolean) => `
      <button class="vd-mode ${this.mpFocus === idx ? "sel" : ""} ${soon ? "soon" : ""}" data-opt="${id}">
        <span class="vd-ic">${ICONS.mp}</span>
        <span>
          <span class="vd-mode-name">${name}</span>
          <span class="vd-mode-jp">${jp}</span>
        </span>
        ${soon ? `<span class="soon-tag">SOON</span>` : ""}
      </button>`;

    this.content.innerHTML = `
      <div class="vd-shell">
        ${this.plusMarks()}
        ${this.edgeRails("SELECT MODE")}
        <header class="vd-topbar">
          <div class="vd-brand vd-brand--garage">
            <span class="vd-badge">${logoMark()}</span>
            <span>
              <span class="vd-brand-name">MULTIPLAYER</span>
              <span class="vd-brand-jp">マルチプレイヤー</span>
            </span>
          </div>
        </header>

        <div class="vd-mp-body">
          ${opt(0, "local", "LOCAL · SPLIT SCREEN", "ローカル対戦 · 2-4 プレイヤー", false)}
          ${opt(1, "online", "ONLINE", "オンライン", true)}
        </div>

        <footer class="vd-botbar">
          <button class="vd-act back-act"><span class="ring">✕</span> BACK</button>
        </footer>
      </div>`;

    this.content.querySelector<HTMLButtonElement>('[data-opt="local"]')!.addEventListener("click", () => this.goto("local"));
    this.content.querySelector<HTMLButtonElement>(".back-act")!.addEventListener("click", () => this.goto("main"));
  }

  // ---- local split-screen join lobby ---------------------------------------

  private static readonly LC_ACCENTS = ["#d8f600", "#00d7f2", "#ff5a1f", "#f4044e"];

  private sameScheme(a: Scheme, b: Scheme): boolean {
    if (a.kind !== b.kind) return false;
    return a.kind !== "gamepad" || a.index === (b as { index: number }).index;
  }
  private slotFor(s: Scheme) {
    return this.lobby.find((x) => this.sameScheme(x.scheme, s));
  }

  /** Advance a device's state: not joined → join (ship-select); selecting →
   * confirm (ready). */
  private lobbyAdvance(s: Scheme): void {
    if (this.screen !== "local") return;
    const slot = this.slotFor(s);
    if (!slot) {
      if (this.lobby.length >= 4) return;
      this.lobby.push({ scheme: s, shipId: SHIPS[this.lobby.length % SHIPS.length].id, ready: false });
    } else if (!slot.ready) {
      slot.ready = true;
    }
    this.renderLocal();
  }

  /** Step a device back: ready → selecting; selecting → leave the slot. */
  private lobbyBack(s: Scheme): void {
    const i = this.lobby.findIndex((x) => this.sameScheme(x.scheme, s));
    if (i < 0) return;
    const slot = this.lobby[i];
    if (slot.ready) slot.ready = false;
    else this.lobby.splice(i, 1);
    this.renderLocal();
  }

  /** Cycle the craft for a device that's still choosing. */
  private lobbyCycle(s: Scheme, dir: number): void {
    const slot = this.slotFor(s);
    if (!slot || slot.ready) return;
    const idx = SHIPS.findIndex((sh) => sh.id === slot.shipId);
    slot.shipId = SHIPS[(idx + dir + SHIPS.length) % SHIPS.length].id;
    this.renderLocal();
  }

  private lobbyCanStart(): boolean {
    return this.lobby.length >= 2 && this.lobby.every((s) => s.ready);
  }
  private beginLocal(): void {
    if (this.screen === "local" && this.lobbyCanStart()) {
      this.onStartLocal(this.lobby.map((s) => ({ scheme: s.scheme, shipId: s.shipId })), this.selectedTrackId);
    }
  }

  /** Keyboard lobby control. P1 = Arrows + Enter (back: Backspace); P2 = A/D +
   * Right-Shift (back: Left-Shift). SPACE starts, ESC exits. */
  private lobbyKey(e: KeyboardEvent): void {
    if (this.screen !== "local") return;
    const arrows: Scheme = { kind: "kbd-arrows" };
    const wasd: Scheme = { kind: "kbd-wasd" };
    switch (e.code) {
      case "Enter": e.preventDefault(); this.lobbyAdvance(arrows); break;
      case "Backspace": e.preventDefault(); this.lobbyBack(arrows); break;
      case "ArrowLeft": e.preventDefault(); this.lobbyCycle(arrows, -1); break;
      case "ArrowRight": e.preventDefault(); this.lobbyCycle(arrows, 1); break;
      case "ShiftRight": e.preventDefault(); this.lobbyAdvance(wasd); break;
      case "ShiftLeft": e.preventDefault(); this.lobbyBack(wasd); break;
      case "KeyA": this.lobbyCycle(wasd, -1); break;
      case "KeyD": this.lobbyCycle(wasd, 1); break;
      case "Space": e.preventDefault(); this.beginLocal(); break;
      case "Escape": this.goto("mp"); break;
    }
  }

  /** Polled each frame (from Game) so every gamepad is read individually:
   * A = join/confirm, B = back/leave, D-pad/stick = pick craft, START = begin
   * once all are ready (else join). */
  tick(): void {
    if (this.screen !== "local") return;
    const pads = navigator.getGamepads?.() ?? [];
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) continue;
      const gp: Scheme = { kind: "gamepad", index: i };
      let a: boolean, b: boolean, start: boolean, left: boolean, right: boolean;
      if (isGameCube(pad)) {
        const gc = readGameCube(pad);
        a = gc.confirm; b = gc.back; start = gc.start; left = gc.left; right = gc.right;
      } else {
        const ax = pad.axes[0] ?? 0;
        a = !!pad.buttons[0]?.pressed;
        b = !!pad.buttons[1]?.pressed;
        start = !!pad.buttons[9]?.pressed;
        left = !!pad.buttons[14]?.pressed || ax < -0.5;
        right = !!pad.buttons[15]?.pressed || ax > 0.5;
      }
      const prev = this.padPrev.get(i) ?? { a: false, b: false, start: false, left: false, right: false };
      if (a && !prev.a) this.lobbyAdvance(gp);
      if (b && !prev.b) this.lobbyBack(gp);
      if (left && !prev.left) this.lobbyCycle(gp, -1);
      if (right && !prev.right) this.lobbyCycle(gp, 1);
      if (start && !prev.start) {
        if (this.lobbyCanStart()) this.beginLocal();
        else this.lobbyAdvance(gp);
      }
      this.padPrev.set(i, { a, b, start, left, right });
    }
  }

  private renderLocal(): void {
    this.root.className = "vd-menu overlay vd-screen-local";
    const canStart = this.lobbyCanStart();

    const slots = Array.from({ length: 4 }, (_, i) => {
      const s = this.lobby[i];
      if (!s) {
        return `
          <div class="vd-lc-player open">
            <span class="vd-lc-tag" style="color:rgba(255,255,255,0.3)">P${i + 1}</span>
            <span class="vd-lc-open">OPEN — press to join</span>
          </div>`;
      }
      const ship = getShipById(s.shipId);
      const name = s.ready ? `${ship.code} <b>${ship.name}</b>` : `◄ ${ship.code} <b>${ship.name}</b> ►`;
      return `
        <div class="vd-lc-player ${s.ready ? "ready" : "select"}">
          <span class="vd-lc-tag" style="color:${Menu.LC_ACCENTS[i]}">P${i + 1}</span>
          <span class="vd-lc-emblem">${shipIcon(ship.id, ship.color.toHexString())}</span>
          <span class="vd-lc-craft">${name}</span>
          <span class="vd-lc-ctl">${schemeLabel(s.scheme)}</span>
          <span class="vd-lc-ready">${s.ready ? "● READY" : "SELECT CRAFT"}</span>
        </div>`;
    }).join("");

    this.content.innerHTML = `
      <div class="vd-shell">
        ${this.plusMarks()}
        ${this.edgeRails("ASSIGN PLAYERS")}
        <header class="vd-topbar">
          <div class="vd-brand vd-brand--garage">
            <span class="vd-badge">${logoMark()}</span>
            <span>
              <span class="vd-brand-name">LOCAL RACE</span>
              <span class="vd-brand-jp">ローカル対戦 · ${this.trackName(this.selectedTrackId)}</span>
            </span>
          </div>
        </header>

        <div class="vd-lc-body">
          <div class="vd-lc-players">${slots}</div>
          <p class="vd-lc-hint">Join, pick your craft with <b>◄ ►</b>, then confirm. Controller: <b>A</b> join/confirm · <b>B</b> back · <b>D-pad</b> craft · <b>START</b> race. Keyboard: P1 <b>Arrows + Enter</b>, P2 <b>A/D + R-Shift</b>. ${canStart ? "Press <b>START</b> / <b>SPACE</b> to race." : "All players must be READY (min 2)."}</p>
        </div>

        <footer class="vd-botbar">
          <button class="vd-act back-act"><span class="ring">✕</span> BACK</button>
          <button class="vd-act start-local ${canStart ? "" : "disabled"}"><span class="ring">▶</span> START</button>
        </footer>
      </div>`;

    this.content.querySelector<HTMLButtonElement>(".start-local")!.addEventListener("click", () => this.beginLocal());
    this.content.querySelector<HTMLButtonElement>(".back-act")!.addEventListener("click", () => this.goto("mp"));
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
        ${this.edgeRails("CHOOSE COURSE")}
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
        this.goto("solo");
      });
    });
    this.content.querySelector<HTMLButtonElement>(".back-act")!.addEventListener("click", () => this.goto("solo"));
    this.content.querySelector<HTMLButtonElement>(".select-act")!.addEventListener("click", () => this.goto("solo"));
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

        <div class="vd-mus-vol">
          <label>MUSIC <input type="range" class="vd-musvol" min="0" max="1" step="0.05" value="${this.audio.musicVolume}"><b class="vd-musvol-v">${Math.round(this.audio.musicVolume * 100)}</b></label>
          <label>GAME AUDIO <input type="range" class="vd-sfxvol" min="0" max="1" step="0.05" value="${this.audio.sfxVolume}"><b class="vd-sfxvol-v">${Math.round(this.audio.sfxVolume * 100)}</b></label>
        </div>
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
    const mv = this.content.querySelector<HTMLInputElement>(".vd-musvol");
    mv?.addEventListener("input", () => {
      const v = parseFloat(mv.value);
      this.audio.setMusicVolume(v);
      const b = this.content.querySelector(".vd-musvol-v");
      if (b) b.textContent = String(Math.round(v * 100));
    });
    const sv = this.content.querySelector<HTMLInputElement>(".vd-sfxvol");
    sv?.addEventListener("input", () => {
      const v = parseFloat(sv.value);
      this.audio.setSfxVolume(v);
      const b = this.content.querySelector(".vd-sfxvol-v");
      if (b) b.textContent = String(Math.round(v * 100));
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
    if (screen === "local") {
      this.lobby = [];
      this.padPrev.clear();
    }
    this.screen = screen;
    this.entering = true;
    this.render();
  }

  show(v: boolean): void {
    if (v) {
      this.screen = "main";
      this.entering = true;
    }
    this.root.style.display = v ? "" : "none";
    this.preview.setActive(v);
    if (v) this.render();
  }
}
