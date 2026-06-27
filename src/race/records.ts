/**
 * Persistent best-lap records + ghost data, stored in localStorage so they
 * survive reloads. Keyed by track + ship (a record belongs to a specific
 * craft on a specific course).
 */

/** A ghost frame: [t(ms since lap start), x, y, z, yaw]. Flat arrays keep the
 * JSON compact. */
export type GhostFrame = [number, number, number, number, number];

export interface RaceRecord {
  bestMs: number;
  frames: GhostFrame[];
}

const key = (trackId: string, shipId: string) => `driftracer.rec.${trackId}.${shipId}`;

export function loadRecord(trackId: string, shipId: string): RaceRecord | null {
  try {
    const raw = localStorage.getItem(key(trackId, shipId));
    if (!raw) return null;
    const data = JSON.parse(raw) as RaceRecord;
    if (typeof data.bestMs === "number" && Array.isArray(data.frames)) return data;
  } catch {
    /* ignore corrupt/blocked storage */
  }
  return null;
}

export function saveRecord(trackId: string, shipId: string, rec: RaceRecord): void {
  try {
    localStorage.setItem(key(trackId, shipId), JSON.stringify(rec));
  } catch {
    /* storage full/blocked — non-fatal */
  }
}
