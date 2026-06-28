import type { UiNav } from "../input/GamepadInput";

interface PauseCallbacks {
  onResume: () => void;
  onQuit: () => void;
  onFullscreen: () => void;
  onMusicVol: (v: number) => void;
  onSfxVol: (v: number) => void;
}

type Row = "resume" | "music" | "sfx" | "fullscreen" | "quit";
const ROWS: Row[] = ["resume", "music", "sfx", "fullscreen", "quit"];

/** In-race pause overlay: resume, audio settings, fullscreen, quit to menu.
 * Works with mouse, keyboard and gamepad. */
export class PauseMenu {
  private root: HTMLDivElement;
  private focus = 0;
  private music = 0.6;
  private sfx = 0.7;

  constructor(container: HTMLElement, private cb: PauseCallbacks) {
    this.root = document.createElement("div");
    this.root.className = "pause overlay";
    this.root.style.display = "none";
    container.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  show(musicVol: number, sfxVol: number): void {
    this.music = musicVol;
    this.sfx = sfxVol;
    this.focus = 0;
    this.root.style.display = "";
    this.render();
  }

  hide(): void {
    this.root.style.display = "none";
  }

  private pct(v: number): string {
    return `${Math.round(v * 100)}`;
  }

  private render(): void {
    const f = (r: Row) => (ROWS[this.focus] === r ? "focus" : "");
    this.root.innerHTML = `
      <div class="pause-inner">
        <h1 class="pause-title">PAUSED</h1>
        <button class="pause-btn ${f("resume")}" data-row="resume">▶ RESUME</button>
        <div class="pause-row ${f("music")}" data-row="music">
          <span>MUSIC</span>
          <input type="range" class="pm-music" min="0" max="1" step="0.05" value="${this.music}">
          <b>${this.pct(this.music)}</b>
        </div>
        <div class="pause-row ${f("sfx")}" data-row="sfx">
          <span>GAME AUDIO</span>
          <input type="range" class="pm-sfx" min="0" max="1" step="0.05" value="${this.sfx}">
          <b>${this.pct(this.sfx)}</b>
        </div>
        <button class="pause-btn ${f("fullscreen")}" data-row="fullscreen">⛶ FULLSCREEN</button>
        <button class="pause-btn quit ${f("quit")}" data-row="quit">QUIT TO MENU</button>
        <p class="pause-hint">ESC / START to resume</p>
      </div>`;

    this.root.querySelector<HTMLButtonElement>('[data-row="resume"]')!.onclick = () => this.cb.onResume();
    this.root.querySelector<HTMLButtonElement>('[data-row="fullscreen"]')!.onclick = () => this.cb.onFullscreen();
    this.root.querySelector<HTMLButtonElement>('[data-row="quit"]')!.onclick = () => this.cb.onQuit();
    const m = this.root.querySelector<HTMLInputElement>(".pm-music")!;
    m.oninput = () => this.setMusic(parseFloat(m.value));
    const s = this.root.querySelector<HTMLInputElement>(".pm-sfx")!;
    s.oninput = () => this.setSfx(parseFloat(s.value));
  }

  private setMusic(v: number): void {
    this.music = v;
    this.cb.onMusicVol(v);
    const b = this.root.querySelector(".pause-row[data-row='music'] b");
    if (b) b.textContent = this.pct(v);
    const inp = this.root.querySelector<HTMLInputElement>(".pm-music");
    if (inp) inp.value = String(v);
  }
  private setSfx(v: number): void {
    this.sfx = v;
    this.cb.onSfxVol(v);
    const b = this.root.querySelector(".pause-row[data-row='sfx'] b");
    if (b) b.textContent = this.pct(v);
    const inp = this.root.querySelector<HTMLInputElement>(".pm-sfx");
    if (inp) inp.value = String(v);
  }

  /** Drive the pause menu from a gamepad nav event. */
  handlePad(nav: UiNav): void {
    if (nav.up) {
      this.focus = (this.focus - 1 + ROWS.length) % ROWS.length;
      this.render();
    }
    if (nav.down) {
      this.focus = (this.focus + 1) % ROWS.length;
      this.render();
    }
    const row = ROWS[this.focus];
    if (nav.left || nav.right) {
      const d = nav.right ? 0.05 : -0.05;
      if (row === "music") this.setMusic(Math.min(1, Math.max(0, this.music + d)));
      if (row === "sfx") this.setSfx(Math.min(1, Math.max(0, this.sfx + d)));
    }
    if (nav.confirm) {
      if (row === "resume") this.cb.onResume();
      else if (row === "fullscreen") this.cb.onFullscreen();
      else if (row === "quit") this.cb.onQuit();
    }
    if (nav.back) this.cb.onResume();
  }
}
