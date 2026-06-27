import { SHIPS, getShipById, type ShipSpec } from "../config/ships";
import { logoMark, ICONS, shipArt } from "./marks";

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
 *  - main: a vertical list of game modes + a hero ship.
 *  - garage: ship roster carousel + stat readout.
 * The chosen ship + control prefs persist across screens.
 */
export class Menu {
  private root: HTMLDivElement;
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
    container.appendChild(this.root);
    this.render();
  }

  private render(): void {
    if (this.screen === "main") this.renderMain();
    else this.renderGarage();
  }

  // ---- shared chrome -------------------------------------------------------

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
    const ship = getShipById(this.selectedShipId);

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

    this.root.innerHTML = `
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
          <div class="vd-hero">${shipArt(hex(ship))}</div>
        </div>

        <footer class="vd-botbar">
          <button class="vd-act select-act"><span class="ring">✕</span> SELECT</button>
          <div class="vd-status">
            ${this.isTouchDevice ? `<button class="vd-gyro ${this.useGyro ? "on" : ""}">TILT ${this.useGyro ? "ON" : "OFF"}</button>` : ""}
            <span><span class="dot"></span>ONLINE</span><span>REGION // ASIA »</span>
          </div>
        </footer>
      </div>`;

    this.root.querySelectorAll<HTMLButtonElement>(".vd-mode").forEach((btn) => {
      btn.addEventListener("click", () => this.pickMode(btn.dataset.mode!));
    });
    // SELECT confirms the currently highlighted mode.
    this.root
      .querySelector<HTMLButtonElement>(".select-act")!
      .addEventListener("click", () => this.confirmMode(this.selectedMode));
    this.root.querySelector<HTMLButtonElement>(".vd-gyro")?.addEventListener("click", () => {
      this.useGyro = !this.useGyro;
      this.renderMain();
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
      this.renderMain();
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
        ${shipArt(hex(s))}
        <span class="vd-card-name">${s.code} // ${s.name}</span>
      </button>`
    ).join("");

    this.root.innerHTML = `
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
            ${shipArt(hex(ship))}
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

    this.root.querySelectorAll<HTMLButtonElement>(".vd-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedShipId = btn.dataset.id!;
        this.renderGarage();
      });
    });
    this.root.querySelector<HTMLButtonElement>(".prev")!.addEventListener("click", () => this.cycle(-1));
    this.root.querySelector<HTMLButtonElement>(".next")!.addEventListener("click", () => this.cycle(1));
    this.root.querySelector<HTMLButtonElement>(".back-act")!.addEventListener("click", () => this.goto("main"));
    this.root.querySelector<HTMLButtonElement>(".select-act")!.addEventListener("click", () => this.goto("main"));
  }

  private cycle(dir: number): void {
    const idx = SHIPS.findIndex((s) => s.id === this.selectedShipId);
    const next = (idx + dir + SHIPS.length) % SHIPS.length;
    this.selectedShipId = SHIPS[next].id;
    this.renderGarage();
  }

  private goto(screen: Screen): void {
    this.screen = screen;
    this.render();
  }

  show(v: boolean): void {
    if (v) this.screen = "main";
    this.root.style.display = v ? "" : "none";
    if (v) this.render();
  }
}
