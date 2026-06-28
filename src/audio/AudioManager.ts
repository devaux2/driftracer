import { OST, type MusicTrack } from "./tracks";

type Context = "menu" | "race";

/**
 * Music + SFX volume manager. Plays the OST with context routing — "menu"
 * themes on the front-end, "aggro"/"chill" tracks while racing — picking
 * randomly within the pool and avoiding immediate repeats. Fires `onTrack` when
 * a new track starts (drives the now-playing mini-player). Volumes persist.
 */
export class AudioManager {
  private music = new Audio();
  private menuPool: MusicTrack[] = OST.filter((t) => t.kind === "menu");
  private racePool: MusicTrack[] = OST.filter((t) => t.kind !== "menu");
  private context: Context = "menu";
  private current: MusicTrack | null = null;
  private ready = false; // first track has started
  private deferred = false; // first load scheduled

  musicVolume = 0.7;
  sfxVolume = 0.7;

  /** Called when a new track begins playing. */
  onTrack: ((t: MusicTrack) => void) | null = null;

  constructor() {
    this.musicVolume = this.load("driftracer.vol.music", 0.7);
    this.sfxVolume = this.load("driftracer.vol.sfx", 0.7);
    this.music.volume = this.musicVolume;
    // Never prefetch audio — tracks load one at a time, only when played, so the
    // 150 MB OST can't hog bandwidth from the game on a slow connection.
    this.music.preload = "none";
    this.music.addEventListener("ended", () => this.playRandom());
  }

  private load(key: string, def: number): number {
    try {
      const v = parseFloat(localStorage.getItem(key) ?? "");
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def;
    } catch {
      return def;
    }
  }
  private save(key: string, v: number): void {
    try {
      localStorage.setItem(key, String(v));
    } catch {
      /* ignore */
    }
  }

  /** Switch to menu music (call from a user gesture the first time). */
  playMenu(): void {
    this.setContext("menu");
  }
  /** Switch to race music. */
  playRace(): void {
    this.setContext("race");
  }

  private setContext(ctx: Context): void {
    if (this.ready && ctx === this.context) return; // already playing this pool
    this.context = ctx;
    if (this.ready) {
      this.playRandom();
      return;
    }
    // First track: wait for the browser to go idle (game/menu assets first), so
    // music never competes with the initial load. Fires within ~3s regardless.
    if (!this.deferred) {
      this.deferred = true;
      const fire = () => {
        this.ready = true;
        this.playRandom();
      };
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
        .requestIdleCallback;
      if (ric) ric(fire, { timeout: 3000 });
      else window.setTimeout(fire, 1500);
    }
  }

  private playRandom(): void {
    if (this.musicVolume <= 0) return; // muted → don't fetch any track at all
    const pool = this.context === "menu" ? this.menuPool : this.racePool;
    if (!pool.length) return;
    let track = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1) {
      let guard = 0;
      while (track === this.current && guard++ < 8) {
        track = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    this.current = track;
    this.music.src = track.src;
    this.music.volume = this.musicVolume;
    void this.music.play().catch(() => {});
    this.onTrack?.(track);
  }

  /** Skip to the next track in the current pool. */
  skip(): void {
    if (this.ready) this.playRandom();
  }

  setMusicVolume(v: number): void {
    const wasMuted = this.musicVolume <= 0;
    this.musicVolume = Math.min(1, Math.max(0, v));
    this.music.volume = this.musicVolume;
    this.save("driftracer.vol.music", this.musicVolume);
    // Unmuting after a muted start: kick off a track now (none was fetched).
    if (wasMuted && this.musicVolume > 0 && this.ready && (this.music.paused || !this.music.src)) {
      this.playRandom();
    }
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.min(1, Math.max(0, v));
    this.save("driftracer.vol.sfx", this.sfxVolume);
  }
}
