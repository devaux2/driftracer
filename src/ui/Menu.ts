import { SHIPS, resolveShipStats, type ShipSpec } from "../config/ships";

/**
 * Ship-select / start menu. Renders the roster from config so adding a ship is
 * a data change only. Returns the chosen ship and steering preference to the
 * caller via {@link onStart}.
 */
export class Menu {
  private root: HTMLDivElement;
  private selectedIndex = 0;
  private useGyro = false;

  constructor(
    container: HTMLElement,
    private isTouchDevice: boolean,
    private onStart: (ship: ShipSpec, useGyro: boolean) => void
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
    const ship = SHIPS[this.selectedIndex];
    const resolved = resolveShipStats(ship);
    void resolved;
    const cards = SHIPS.map(
      (s, i) => `
      <button class="ship-card ${i === this.selectedIndex ? "selected" : ""}" data-i="${i}">
        <span class="ship-swatch" style="background:${s.color.toHexString()}"></span>
        <span class="ship-name">${s.name}</span>
      </button>`
    ).join("");

    this.root.innerHTML = `
      <div class="menu-inner">
        <h1 class="logo">DRIFT<span>RACER</span></h1>
        <div class="ship-roster">${cards}</div>
        <div class="ship-detail">
          <h2>${ship.name}</h2>
          <p class="blurb">${ship.blurb}</p>
          ${this.statBar("ACCEL", ship.acceleration)}
          ${this.statBar("TOP SPEED", ship.topSpeed)}
          ${this.statBar("CORNERING", ship.cornering)}
          ${this.statBar("WEIGHT", ship.weight)}
        </div>
        ${
          this.isTouchDevice
            ? `<label class="gyro-toggle"><input type="checkbox" ${this.useGyro ? "checked" : ""}/> Gyro / tilt steering</label>`
            : ""
        }
        <button class="start-btn">RACE</button>
        <p class="controls-hint">${this.hint()}</p>
      </div>`;

    this.root.querySelectorAll<HTMLButtonElement>(".ship-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedIndex = Number(btn.dataset.i);
        this.render();
      });
    });
    const gyro = this.root.querySelector<HTMLInputElement>(".gyro-toggle input");
    gyro?.addEventListener("change", () => (this.useGyro = gyro.checked));

    this.root
      .querySelector<HTMLButtonElement>(".start-btn")!
      .addEventListener("click", () => this.onStart(SHIPS[this.selectedIndex], this.useGyro));
  }

  private hint(): string {
    return this.isTouchDevice
      ? "Hold BRAKE and steer to drift. Tap BOOST. Hit the pads."
      : "Steer: A/D or ◄►  ·  Brake/Drift: SPACE  ·  Boost: SHIFT  ·  Gamepad supported";
  }

  show(v: boolean): void {
    this.root.style.display = v ? "" : "none";
  }
}
