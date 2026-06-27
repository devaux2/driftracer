import { SHIPS, getShipById, type ShipSpec } from "../config/ships";
import { logoMark, ICONS, shipIcon } from "./marks";
import { ShipPreview } from "./ShipPreview";

type Screen = "main" | "garage";

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
  { id: "gp", name: "GRAND PRIX", jp: "グランプリ", icon: ICONS.gp, playable: false },
  { id: "mp", name: "MULTIPLAYER", jp: "マルチプレイヤー", icon: ICONS.mp, playable: false },
  { id: "garage", name: "GARAGE", jp: "ガレージ", icon: ICONS.garage, playable: true },
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
  private selectedMode = "quick";
  private useGyro = false;

  constructor(
    container: HTMLElement,
    private isTouchDevice: boolean,
    private onStart: (ship: ShipSpec, mode: string, useGyro: boolean) => void
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
    else this.renderGarage();
    this.preview.setShip(getShipById(this.selectedShipId));
    this.positionPreview();
  }

  /** Overlay the preview canvas exactly on the current screen's hero element. */
  private positionPreview(): void {
    const sel = this.screen === "main" ? ".vd-hero" : ".vd-garage-hero";
    const hero = this.content.querySelector(sel) as HTMLElement | null;
    if (!hero || this.root.style.display === "none") {
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

  private renderMain(): void {
    this.root.className = "vd-menu overlay vd-screen-main";

    const modes = MODES.map((m) => {
      const sel = m.id === this.selectedMode && m.playable;
      return `
      <button class="vd-mode ${sel ? "sel" : ""} ${m.playable ? "" : "soon"}" data-mode="${m.id}">
        <span class="vd-ic">${m.icon}</span>
        <span>
          <span class="vd-mode-name">${m.name}</span>
          <span class="vd-mode-jp">${m.jp}</span>
        </span>
        ${m.playable ? "" : `<span class="soon-tag">SOON</span>`}
      </button>`;
    }).join("");

    this.content.innerHTML = `
      <div class="vd-shell">
        <span class="vd-side-label" style="top:30vh;left:0.8vh">ENTER MENU</span>
        <span class="vd-side-label" style="top:34vh;right:0.8vh">VECTOR DRIFT SYSTEM</span>
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
          <div class="vd-hero"></div>
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
      .addEventListener("click", () => this.confirmMode(this.selectedMode));
    this.content.querySelector<HTMLButtonElement>(".vd-gyro")?.addEventListener("click", () => {
      this.useGyro = !this.useGyro;
      this.render();
    });
  }

  private pickMode(id: string): void {
    if (id === "garage") {
      this.goto("garage");
      return;
    }
    const mode = MODES.find((m) => m.id === id);
    if (!mode?.playable) return;
    // First tap highlights; a tap on the already-selected row launches it.
    if (this.selectedMode === id) this.confirmMode(id);
    else {
      this.selectedMode = id;
      this.render();
    }
  }

  private confirmMode(id: string): void {
    const mode = MODES.find((m) => m.id === id);
    if (mode?.playable && id !== "garage") {
      this.onStart(getShipById(this.selectedShipId), id, this.useGyro);
    }
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

          <div class="vd-garage-hero">
            <div class="vd-ring"></div>
          </div>

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
