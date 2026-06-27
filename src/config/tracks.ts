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
    // Wide road (Wipeout/F-Zero scale) so high speed reads well and turns
    // aren't claustrophobic.
    roadHalfWidth: 26,
    // A big, fast stadium loop built for speed:
    //  - a very long start straight (x=0, +Z) to wind it out, with a CHASM
    //    shortcut partway: the road bulges right around a ~150u gap and the ramp
    //    at the lip lets you fly straight across (risk: come up short and you
    //    fall in). The straight CONTINUES well past the rejoin, so overshooting
    //    the jump is safe — only undershooting punishes you.
    //  - sweeping, large-radius turns at each end (no brutal hairpins).
    //  - a HILL (Y up to 10) on the top sweeper and a VALLEY (Y −4) on the long
    //    back straight for verticality.
    points: [
      [0, 0, -450], // 0  start / finish, heading +Z (long main straight)
      [0, 0, -180], // 1
      [0, 5, 80], // 2  road rises into the launch lip
      [0, 7, 200], // 3  RAMP lip — chasm ahead (x=0, z 200..350)
      [140, 3, 250], // 4  main road bulges right around the chasm...
      [200, 0, 300], // 5  bulge apex (far right)
      [120, 3, 340], // 6
      [0, 7, 350], // 7  ...rejoins the +Z line past the ~150u gap (landing zone)
      [0, 3, 480], // 8  main straight continues (overshoot lands safely here)
      [0, 0, 640], // 9  top of the main straight
      [90, 3, 740], // 10 sweeping right turn begins, climbing
      [240, 8, 800], // 11 hill climb
      [410, 10, 780], // 12 hill crest (highest point)
      [520, 7, 670], // 13 descend
      [560, 3, 520], // 14 now heading -Z onto the back straight
      [560, 0, 360], // 15 long back straight
      [560, -4, 140], // 16 valley dip (lowest point)
      [560, 0, -100], // 17
      [550, 0, -280], // 18
      [500, 2, -420], // 19 sweeping left turn back toward start
      [370, 4, -520], // 20
      [200, 2, -560], // 21
      [60, 0, -540], // 22
      [0, 0, -500], // 23 straighten onto x=0 before the start line
    ],
    // NOTE: pad `t` values are calibrated to the actual arc of this spline
    // (Catmull-Rom samples aren't evenly spaced), verified against the
    // centre-line dump.
    pads: [
      { kind: "boost", t: 0.03, offset: 0 }, // wind up the main straight
      // Shortcut ramp dead-centre at the lip (t≈0.083) — clear the ~150u chasm
      // to skip the bulge and rejoin at t≈0.25. Overshoot is safe (the straight
      // continues); undershoot drops you in.
      { kind: "jump", t: 0.083, offset: 0, power: 1.5 },
      { kind: "boost", t: 0.17, offset: 0 }, // reward for the safe bulge route
      { kind: "boost", t: 0.4, offset: 0 }, // up the hill sweeper
      { kind: "boost", t: 0.52, offset: 0 }, // over the crest
      { kind: "jump", t: 0.61, offset: 0, power: 0.7 }, // hop on the back straight
      { kind: "boost", t: 0.78, offset: 0 }, // out of the bottom sweeper
      { kind: "boost", t: 0.92, offset: 0 }, // onto the start straight
    ],
  },
];

export function getTrackById(id: string): TrackSpec {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
