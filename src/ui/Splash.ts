/**
 * Title screen. Shows the game title and a PLAY button. Clicking PLAY is the
 * user gesture we use to enter fullscreen, and then we hand off to the
 * ship-select menu — which therefore opens already in fullscreen.
 */
export class Splash {
  private root: HTMLDivElement;

  constructor(container: HTMLElement, private onPlay: () => void) {
    this.root = document.createElement("div");
    this.root.className = "splash overlay";
    this.root.innerHTML = `
      <div class="splash-inner">
        <h1 class="logo big">DRIFT<span>RACER</span></h1>
        <p class="tagline">anti-grav drift racing</p>
        <button class="splash-start">PLAY</button>
        <p class="splash-hint">best in landscape · headphones recommended</p>
      </div>`;
    container.appendChild(this.root);

    this.root
      .querySelector<HTMLButtonElement>(".splash-start")!
      .addEventListener("click", () => this.play());
  }

  private play(): void {
    this.root.classList.add("fade-out");
    setTimeout(() => this.root.remove(), 350);
    this.onPlay();
  }
}
