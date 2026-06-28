import type { MusicTrack } from "../audio/tracks";

/**
 * Slick "now playing" mini-player that slides in when a new track starts and
 * auto-dismisses. VECTOR DRIFT styled: animated EQ bars + track title/artist.
 */
export class NowPlaying {
  private root: HTMLDivElement;
  private titleEl: HTMLElement;
  private artistEl: HTMLElement;
  private timer = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "now-playing";
    this.root.innerHTML = `
      <div class="np-eq"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="np-text">
        <div class="np-label">♪ NOW PLAYING</div>
        <div class="np-title"></div>
        <div class="np-artist"></div>
      </div>`;
    container.appendChild(this.root);
    this.titleEl = this.root.querySelector(".np-title")!;
    this.artistEl = this.root.querySelector(".np-artist")!;
  }

  show(track: MusicTrack): void {
    this.titleEl.textContent = track.title;
    this.artistEl.textContent = track.artist;
    this.root.classList.add("show");
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.root.classList.remove("show"), 5200);
  }

  hide(): void {
    this.root.classList.remove("show");
  }
}
