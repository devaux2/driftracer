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
  private started = false;

  musicVolume = 0.6;
  sfxVolume = 0.7;

  /** Called when a new track begins playing. */
  onTrack: ((t: MusicTrack) => void) | null = null;

  constructor() {
    this.musicVolume = this.load("driftracer.vol.music", 0.6);
    this.sfxVolume = this.load("driftracer.vol.sfx", 0.7);
    this.music.volume = this.musicVolume;
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
    if (this.started && ctx === this.context) return; // already playing this pool
    this.context = ctx;
    this.started = true;
    this.playRandom();
  }

  private playRandom(): void {
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
    if (this.started) this.playRandom();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.min(1, Math.max(0, v));
    this.music.volume = this.musicVolume;
    this.save("driftracer.vol.music", this.musicVolume);
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.min(1, Math.max(0, v));
    this.save("driftracer.vol.sfx", this.sfxVolume);
  }
}
