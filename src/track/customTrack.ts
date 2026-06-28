import type { TrackSpec } from "../config/tracks";

/** Persistent storage for a player-authored track (the editor's output). */
const KEY = "driftracer.customtrack";

/** Deep-clone a TrackSpec so edits never mutate the shared config object. */
export function cloneSpec(spec: TrackSpec): TrackSpec {
  return {
    id: spec.id,
    name: spec.name,
    roadHalfWidth: spec.roadHalfWidth,
    points: spec.points.map((p) => [p[0], p[1], p[2]] as [number, number, number]),
    pads: spec.pads.map((p) => ({ kind: p.kind, t: p.t, offset: p.offset, power: p.power })),
  };
}

/** The starting point for a new custom track: a dead-simple 4-point oval with
 * no pads — an easy canvas to explore from. */
export function baseSpec(): TrackSpec {
  return {
    id: "custom",
    name: "CUSTOM TRACK",
    roadHalfWidth: 44,
    points: [
      [0, 0, -520],
      [360, 0, 0],
      [0, 0, 520],
      [-360, 0, 0],
    ],
    pads: [],
  };
}

export function loadCustomTrack(): TrackSpec | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as TrackSpec;
    if (Array.isArray(data.points) && data.points.length >= 4 && Array.isArray(data.pads)) {
      return data;
    }
  } catch {
    /* ignore corrupt/blocked storage */
  }
  return null;
}

export function saveCustomTrack(spec: TrackSpec): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cloneSpec(spec)));
  } catch {
    /* storage full/blocked — non-fatal */
  }
}
