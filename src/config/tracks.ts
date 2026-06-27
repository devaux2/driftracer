/**
 * Track definitions.
 *
 * A track is just data: a closed loop of control points plus the props
 * (boost / jump pads) scattered along it. The {@link Track} class turns this
 * into geometry at runtime. This separation is deliberate — the future level
 * editor will produce and consume exactly this shape, and multiplayer will
 * sync it by id.
 */

export type PadKind = "boost" | "jump";

export interface PadSpec {
  kind: PadKind;
  /** 0..1 position along the track loop. */
  t: number;
  /** -1..1 lateral offset across the road (0 = centre line). */
  offset: number;
}

export interface TrackSpec {
  id: string;
  name: string;
  /** Road half-width in world units. */
  roadHalfWidth: number;
  /** Control points of the centre-line loop, in XZ. Y is height (banking/hills). */
  points: [number, number, number][];
  pads: PadSpec[];
}

export const TRACKS: TrackSpec[] = [
  {
    id: "neon-circuit",
    name: "Neon Circuit",
    roadHalfWidth: 14,
    points: [
      [0, 0, 0],
      [120, 0, 40],
      [220, 0, 10],
      [300, 2, -80],
      [280, 4, -200],
      [180, 2, -260],
      [40, 0, -250],
      [-80, 0, -190],
      [-160, 0, -90],
      [-180, 2, 40],
      [-120, 1, 150],
      [0, 0, 180],
      [100, 0, 150],
    ],
    pads: [
      { kind: "boost", t: 0.08, offset: 0 },
      { kind: "boost", t: 0.27, offset: -0.4 },
      { kind: "jump", t: 0.42, offset: 0 },
      { kind: "boost", t: 0.6, offset: 0.4 },
      { kind: "jump", t: 0.78, offset: 0 },
      { kind: "boost", t: 0.92, offset: 0 },
    ],
  },
];

export function getTrackById(id: string): TrackSpec {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
