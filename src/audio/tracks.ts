/**
 * OST track list. Drop the renamed soundtrack files into `public/audio/` and
 * list them here — title/artist show in the now-playing mini-player. The game
 * plays this as a continuous shuffled playlist.
 */
export interface MusicTrack {
  title: string;
  artist: string;
  src: string;
}

const base = import.meta.env.BASE_URL;
/** Helper so entries stay short once the OST is in. */
const t = (title: string, artist: string, file: string): MusicTrack => ({
  title,
  artist,
  src: `${base}audio/${file}`,
});

export const OST: MusicTrack[] = [
  // Populated once the OST is renamed, e.g.:
  // t("Neon Velocity", "VECTOR DRIFT", "01-neon-velocity.mp3"),
];

// keep `t` referenced even while OST is empty
void t;
