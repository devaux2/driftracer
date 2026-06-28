import { OST, type MusicTrack } from "./tracks";

type Context = "menu" | "race";
/** Which pool a track is allowed to play in. A track can be in both. */
export type Pool = "menu" | "race";

interface Pools {
  menu: string[];
  race: string[];
}

/**
 * Music + SFX volume manager. Plays the OST with context routing — the menu pool
 * on the front-end, the race pool while racing — picking randomly within the
 * active pool and avoiding immediate repeats. Which tracks belong to each pool
 * is user-curable (see the MUSIC settings screen) and persists, as do volumes.
 * Pausing the game pauses the music; `skip()` jumps to another track.
 * Fires `onTrack` when a new track starts (drives the now-playing UI).
 */
export class AudioManager {
  private music = new Audio();
  private context: Context = "menu";
  private current: MusicTrack | null = null;
  private ready = false; // first track has started
  private deferred = false; // first load scheduled
  private gamePaused = false; // music paused because the game is paused

  /** Track ids allowed in each pool. */
  private menuOn: Set<string>;
  private raceOn: Set<string>;

  musicVolume = 0.7;
  sfxVolume = 0.7;

  /** Called when a new track begins (or is queued while paused). */
  onTrack: ((t: MusicTrack) => void) | null = null;
  /** Called when the enabled-pool state changes (so settings UI can refresh). */
  onPoolsChange: (() => void) | null = null;

  constructor() {
    this.musicVolume = this.load("driftracer.vol.music", 0.7);
    this.sfxVolume = this.load("driftracer.vol.sfx", 0.7);
    const pools = this.loadPools();
    this.menuOn = new Set(pools.menu);
    this.raceOn = new Set(pools.race);
    this.music.volume = this.musicVolume;
    // Never prefetch audio — tracks load one at a time, only when played, so the
    // 150 MB OST can't hog bandwidth from the game on a slow connection.
    this.music.preload = "none";
    this.music.addEventListener("ended", () => {
      if (!this.gamePaused) this.playRandom();
    });
  }

  // ---- track id + pool membership ------------------------------------------

  /** Stable id for a track (its file name, base-path independent). */
  trackId(t: MusicTrack): string {
    return t.src.split("/").pop() ?? t.src;
  }

  /** All OST tracks (for the settings screen). */
  tracks(): readonly MusicTrack[] {
    return OST;
  }

  isEnabled(t: MusicTrack, pool: Pool): boolean {
    return (pool === "menu" ? this.menuOn : this.raceOn).has(this.trackId(t));
  }

  /** Allow/disallow a track in a pool. Keeps playback sensible: if the current
   * track gets disabled in the active context it skips on; if a pool that had
   * gone silent gains a track, it kicks off. */
  setEnabled(t: MusicTrack, pool: Pool, on: boolean): void {
    const set = pool === "menu" ? this.menuOn : this.raceOn;
    const id = this.trackId(t);
    if (on) set.add(id);
    else set.delete(id);
    this.savePools();
    this.onPoolsChange?.();

    if (!this.ready) return;
    const activePool: Pool = this.context === "menu" ? "menu" : "race";
    if (pool !== activePool) return;
    if (!on && this.current && this.trackId(this.current) === id) {
      // disabled what's playing → move on (or fall silent if pool now empty)
      this.playRandom();
    } else if (on && (!this.current || !this.isEnabled(this.current, activePool)) && !this.gamePaused) {
      // pool was silent/empty and just gained a track → start it
      this.playRandom();
    }
  }

  private currentPool(): MusicTrack[] {
    const set = this.context === "menu" ? this.menuOn : this.raceOn;
    return OST.filter((t) => set.has(this.trackId(t)));
  }

  // ---- persistence ----------------------------------------------------------

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

  private loadPools(): Pools {
    // Default: menu-kind tracks in the menu pool, everything else in races.
    const def: Pools = {
      menu: OST.filter((t) => t.kind === "menu").map((t) => this.trackId(t)),
      race: OST.filter((t) => t.kind !== "menu").map((t) => this.trackId(t)),
    };
    try {
      const raw = localStorage.getItem("driftracer.music.pools");
      if (!raw) return def;
      const p = JSON.parse(raw) as Partial<Pools>;
      return {
        menu: Array.isArray(p.menu) ? p.menu : def.menu,
        race: Array.isArray(p.race) ? p.race : def.race,
      };
    } catch {
      return def;
    }
  }
  private savePools(): void {
    try {
      localStorage.setItem(
        "driftracer.music.pools",
        JSON.stringify({ menu: [...this.menuOn], race: [...this.raceOn] })
      );
    } catch {
      /* ignore */
    }
  }

  // ---- context / playback ---------------------------------------------------

  /** Switch to menu music (call from a user gesture the first time). */
  playMenu(): void {
    this.setContext("menu");
  }
  /** Switch to race music. */
  playRace(): void {
    this.setContext("race");
  }

  private setContext(ctx: Context): void {
    this.gamePaused = false;
    if (this.ready && ctx === this.context) {
      // already in this context; make sure something is playing
      if (this.music.paused && this.musicVolume > 0) this.playRandom();
      return;
    }
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
    const pool = this.currentPool();
    if (!pool.length) {
      // every track in this context is disabled — fall silent.
      this.current = null;
      this.music.pause();
      return;
    }
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
    if (!this.gamePaused) void this.music.play().catch(() => {});
    this.onTrack?.(track);
  }

  /** The track currently playing (or queued while paused). */
  get currentTrack(): MusicTrack | null {
    return this.current;
  }

  /** Skip to another track in the current pool (explicit user action). */
  skip(): void {
    this.gamePaused = false;
    if (!this.ready) {
      // not started yet (deferred) — start now since this is a user gesture
      this.ready = true;
    }
    this.playRandom();
  }

  /** Pause the music because the game is paused. */
  pause(): void {
    this.gamePaused = true;
    if (!this.music.paused) this.music.pause();
  }

  /** Resume after an in-game pause. */
  resume(): void {
    this.gamePaused = false;
    if (this.music.src && this.music.paused && this.musicVolume > 0) {
      void this.music.play().catch(() => {});
    }
  }

  setMusicVolume(v: number): void {
    const wasMuted = this.musicVolume <= 0;
    this.musicVolume = Math.min(1, Math.max(0, v));
    this.music.volume = this.musicVolume;
    this.save("driftracer.vol.music", this.musicVolume);
    // Unmuting after a muted start: kick off a track now (none was fetched).
    if (wasMuted && this.musicVolume > 0 && this.ready && !this.gamePaused && (this.music.paused || !this.music.src)) {
      this.playRandom();
    }
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.min(1, Math.max(0, v));
    this.save("driftracer.vol.sfx", this.sfxVolume);
  }
}
