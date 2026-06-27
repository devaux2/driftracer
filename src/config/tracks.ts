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
  /**
   * For `jump` pads: how hard it launches you (1 = a small hop). Crank it up to
   * turn a pad into a ramp that can clear a gap for a risk shortcut.
   */
  power?: number;
}

/** A control point. X/Z position plus **Y elevation** — the road follows Y, so
 * raising/lowering Y between points gives hills, dips, drops and crests. The
 * editor edits exactly this. */
export type ControlPoint = [x: number, y: number, z: number];

export interface TrackSpec {
  id: string;
  name: string;
  /** Road half-width in world units. */
  roadHalfWidth: number;
  /** Control points of the centre-line loop, in XZ with Y as elevation. */
  points: ControlPoint[];
  pads: PadSpec[];
}

export const TRACKS: TrackSpec[] = [
  {
    id: "neon-circuit",
    name: "Neon Circuit",
    roadHalfWidth: 14,
    // The layout deliberately uses verticality:
    //  - a flat launch straight heading +Z toward a CHASM (no road along x≈0
    //    between z≈130 and z≈250); the main road bulges out to the right around
    //    it, so the ramp at the lip is a *risk shortcut* — clear the gap and you
    //    skip the bulge; come up short and you fall in and respawn.
    //  - a big banked HILL climb/crest (Y up to 14) and a VALLEY dip (Y −4) on
    //    the back half for elevation change.
    points: [
      [0, 0, -120], // start / finish, heading +Z
      [0, 0, -20],
      [0, 4, 80], // road rises into the launch lip
      [0, 6, 130], // RAMP lip — chasm begins straight ahead (+Z)
      [60, 2, 150], // main road bulges right around the chasm...
      [95, 0, 190],
      [60, 2, 230],
      [0, 6, 250], // ...and rejoins the +Z line past the gap (landing zone)
      [0, 4, 340],
      [-70, 2, 390],
      [-150, 10, 360], // hill climb
      [-180, 14, 250], // hill crest (highest point)
      [-160, 8, 130], // descent
      [-110, 2, 10],
      [-60, -4, -90], // valley dip (lowest point)
      [0, 0, -140], // on the x=0 line so the start straight launches dead ahead
    ],
    pads: [
      // The shortcut ramp, dead centre at the lip (t≈0.125). Approach at cruise
      // speed and clear the 120u chasm to land at the rejoin (t≈0.375), skipping
      // the right-hand bulge. Hug an edge to avoid it and take the safe way round.
      { kind: "jump", t: 0.125, offset: 0, power: 1.3 },
      { kind: "boost", t: 0.28, offset: 0 }, // reward for the safe bulge route
      { kind: "boost", t: 0.45, offset: 0 },
      { kind: "boost", t: 0.55, offset: -0.3 }, // into the hill climb
      { kind: "jump", t: 0.62, offset: 0, power: 0.8 }, // crest hop
      { kind: "boost", t: 0.88, offset: 0 },
    ],
  },
];

export function getTrackById(id: string): TrackSpec {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
