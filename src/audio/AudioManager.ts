import { OST, type MusicTrack } from "./tracks";

/**
 * Music + SFX volume manager. Plays the OST as a continuous shuffled playlist
 * and fires `onTrack` whenever a new track starts (drives the now-playing
 * mini-player). Volumes persist to localStorage. SFX volume is exposed for
 * future in-game sounds.
 */
export class AudioManager {
  private music = new Audio();
  private playlist: MusicTrack[] = [];
  private order: number[] = [];
  private cursor = -1;
  private started = false;

  musicVolume = 0.6;
  sfxVolume = 0.7;

  /** Called when a new track begins playing. */
  onTrack: ((t: MusicTrack) => void) | null = null;

  constructor() {
    this.musicVolume = this.load("driftracer.vol.music", 0.6);
    this.sfxVolume = this.load("driftracer.vol.sfx", 0.7);
    this.music.volume = this.musicVolume;
    this.music.addEventListener("ended", () => this.next());
    this.setPlaylist(OST);
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

  setPlaylist(tracks: MusicTrack[]): void {
    this.playlist = tracks;
    // shuffled play order
    this.order = tracks.map((_, i) => i);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.cursor = -1;
  }

  /** Begin playback (call from a user gesture). No-op if the OST is empty. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.playlist.length) this.next();
  }

  next(): void {
    if (!this.playlist.length) return;
    this.cursor = (this.cursor + 1) % this.order.length;
    const track = this.playlist[this.order[this.cursor]];
    this.music.src = track.src;
    this.music.volume = this.musicVolume;
    void this.music.play().catch(() => {});
    this.onTrack?.(track);
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
