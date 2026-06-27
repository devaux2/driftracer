import { SHIPS, getShipById, type ShipSpec } from "../config/ships";

type Screen = "main" | "garage";

interface GameMode {
  id: string;
  name: string;
  desc: string;
  playable: boolean;
}

const MODES: GameMode[] = [
  { id: "quick", name: "QUICK RACE", desc: "Single race vs 11 rivals on Neon Circuit", playable: true },
  { id: "time", name: "TIME ATTACK", desc: "Beat the clock, chase your ghost", playable: true },
  { id: "gp", name: "GRAND PRIX", desc: "A championship cup of races", playable: false },
  { id: "mp", name: "MULTIPLAYER", desc: "Race friends online", playable: false },
];

/**
 * Front-end menu controller. Two screens:
 *  - main: pick a game mode (only Quick Race is wired up; the rest are
 *    placeholders) and jump into the Garage.
 *  - garage: choose your ship from the roster (with its stat trade-offs).
 * The chosen ship + control prefs persist across screens.
 */
export class Menu {
  private root: HTMLDivElement;
  private screen: Screen = "main";
  private selectedShipId = SHIPS[0].id;
  private useGyro = false;

  constructor(
    container: HTMLElement,
    private isTouchDevice: boolean,
    private onStart: (ship: ShipSpec, mode: string, useGyro: boolean) => void
  ) {
    this.root = document.createElement("div");
    this.root.className = "menu overlay";
    container.appendChild(this.root);
    this.render();
  }

  private statBar(label: string, value: number): string {
    return `<div class="stat"><span>${label}</span><div class="bar"><div style="width:${value * 100}%"></div></div></div>`;
  }

  private render(): void {
    if (this.screen === "main") this.renderMain();
    else this.renderGarage();
  }

  // ---- main: game modes ----------------------------------------------------

  private renderMain(): void {
    this.root.className = "menu overlay menu--main";
    const ship = getShipById(this.selectedShipId);
    const modes = MODES.map(
      (m) => `
      <button class="mode-card ${m.playable ? "" : "disabled"} ${m.id === "quick" ? "primary" : ""}" data-mode="${m.id}">
        <span class="mode-name">${m.name}</span>
        <span class="mode-desc">${m.desc}</span>
        ${m.playable ? "" : `<span class="mode-soon">SOON</span>`}
      </button>`
    ).join("");

    this.root.innerHTML = `
      <div class="menu-inner">
        <h1 class="logo">DRIFT<span>RACER</span></h1>
        <div class="mode-list">${modes}</div>
        <button class="garage-btn">
          <span class="garage-label">GARAGE</span>
          <span class="garage-ship" style="color:${ship.color.toHexString()}">${ship.name} ›</span>
        </button>
        ${
          this.isTouchDevice
            ? `<label class="gyro-toggle"><input type="checkbox" ${this.useGyro ? "checked" : ""}/> Gyro / tilt steering</label>`
            : ""
        }
        <p class="controls-hint">${this.hint()}</p>
      </div>`;

    this.root.querySelectorAll<HTMLButtonElement>(".mode-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = MODES.find((m) => m.id === btn.dataset.mode);
        if (mode?.playable) this.onStart(getShipById(this.selectedShipId), mode.id, this.useGyro);
      });
    });
    this.root
      .querySelector<HTMLButtonElement>(".garage-btn")!
      .addEventListener("click", () => this.goto("garage"));
    const gyro = this.root.querySelector<HTMLInputElement>(".gyro-toggle input");
    gyro?.addEventListener("change", () => (this.useGyro = gyro.checked));
  }

  // ---- garage: ship select -------------------------------------------------

  private renderGarage(): void {
    this.root.className = "menu overlay menu--garage";
    const ship = getShipById(this.selectedShipId);
    const cards = SHIPS.map(
      (s) => `
      <button class="ship-card ${s.id === this.selectedShipId ? "selected" : ""}" data-id="${s.id}">
        <span class="ship-swatch" style="background:${s.color.toHexString()}"></span>
        <span class="ship-name">${s.name}</span>
      </button>`
    ).join("");

    this.root.innerHTML = `
      <div class="menu-inner">
        <div class="garage-head">
          <button class="back-btn">‹ BACK</button>
          <h2 class="garage-title">GARAGE</h2>
          <span></span>
        </div>
        <div class="ship-roster">${cards}</div>
        <div class="ship-detail">
          <h2>${ship.name}</h2>
          <p class="blurb">${ship.blurb}</p>
          ${this.statBar("ACCEL", ship.acceleration)}
          ${this.statBar("TOP SPEED", ship.topSpeed)}
          ${this.statBar("CORNERING", ship.cornering)}
          ${this.statBar("WEIGHT", ship.weight)}
        </div>
        <button class="start-btn select-btn">SELECT</button>
      </div>`;

    this.root.querySelectorAll<HTMLButtonElement>(".ship-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedShipId = btn.dataset.id!;
        this.renderGarage();
      });
    });
    this.root.querySelector<HTMLButtonElement>(".back-btn")!.addEventListener("click", () => this.goto("main"));
    this.root.querySelector<HTMLButtonElement>(".select-btn")!.addEventListener("click", () => this.goto("main"));
  }

  private goto(screen: Screen): void {
    this.screen = screen;
    this.render();
  }

  private hint(): string {
    return this.isTouchDevice
      ? "Steer with the stick, hold BRAKE and steer to drift. Hit the pads."
      : "Steer: A/D or ◄►  ·  Brake/Drift: SPACE  ·  Gamepad supported";
  }

  show(v: boolean): void {
    if (v) this.screen = "main";
    this.root.style.display = v ? "" : "none";
    if (v) this.render();
  }
}
