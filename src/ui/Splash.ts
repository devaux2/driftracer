import { logoMark } from "./marks";

/**
 * Title / boot screen (VECTOR DRIFT). Styled as a red "initialising systems"
 * loader. A tap anywhere is the user gesture we use to enter fullscreen before
 * handing off to the menu — which therefore opens already in fullscreen.
 */
export class Splash {
  private root: HTMLDivElement;
  private gone = false;

  constructor(container: HTMLElement, private onPlay: () => void) {
    this.root = document.createElement("div");
    this.root.className = "vd-splash overlay";
    this.root.innerHTML = `
      <div class="vd-splash-tag">
        <div class="id">⊢ VD_88</div>
        <div class="bars vd-hatch-lime"></div>
      </div>
      <div class="vd-splash-flag"></div>
      <span class="vd-side-label" style="top:18vh;right:2.4vh">SYSTEMS · ONLINE</span>
      <span class="vd-plus" style="top:7vh;left:38%">+</span>
      <span class="vd-plus" style="bottom:30vh;right:8%">+</span>
      <span class="vd-plus" style="top:42vh;left:6%">+</span>

      <div class="vd-splash-center">
        ${logoMark()}
        <h1 class="vd-wordmark">VECTOR DRIFT</h1>
        <p class="vd-jp">ベクタードリフト</p>
        <p class="vd-tapstart">▶ PRESS TO START</p>
      </div>

      <div class="vd-splash-foot">
        <div class="vd-init">
          <div class="glyph"></div>
          <div>
            <span class="en">INITIALIZING SYSTEMS</span>
            <span class="jp">システムを初期化しています</span>
          </div>
        </div>
        <div class="vd-progress">
          <span class="chev">▶▶ ›</span>
          <div class="vd-bar"><i></i></div>
          <span class="vd-pct">100%</span>
        </div>
      </div>
      <div class="vd-build">build ${__BUILD_ID__}</div>`;
    container.appendChild(this.root);

    // The whole screen is the start button.
    this.root.addEventListener("click", () => this.play());
  }

  /** Proceed programmatically (e.g. from a gamepad confirm). */
  trigger(): void {
    this.play();
  }

  private play(): void {
    if (this.gone) return;
    this.gone = true;
    this.root.classList.add("fade-out");
    setTimeout(() => this.root.remove(), 350);
    this.onPlay();
  }
}
