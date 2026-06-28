import { Color3 } from "@babylonjs/core/Maths/math.color";

/**
 * Ship roster.
 *
 * Stats are expressed on a normalized 0..1 scale (like F-Zero GX's letter
 * grades) and are resolved into concrete physics quantities in
 * {@link resolveShipStats}. Keeping the tunables abstract here means the
 * future ship-select menu, the balancing pass, and any "tune your ship"
 * sliders all talk in the same currency.
 *
 * Design intent: the three headline stats trade off against each other so no
 * single ship dominates. A heavy ship corners poorly but holds a high top
 * speed; a nimble ship turns on a dime but tops out lower; etc.
 */
export interface ShipSpec {
  id: string;
  /** Hull designation, e.g. "VD-01". */
  code: string;
  /** Model name, e.g. "HAYATE". */
  name: string;
  /** Japanese model name shown under the designation. */
  jp: string;
  /** Short flavour line shown in the select screen. */
  blurb: string;
  /** Hull accent colour (UI: emblem, HUD, model tint). */
  color: Color3;
  /** How strongly to tint the shared craft model toward `color` (0..1). VD-01
   * is 0 — the model's native look; others recolour to read as distinct cars. */
  tintStrength: number;

  /** 0..1 — how fast it reaches top speed. */
  acceleration: number;
  /** 0..1 — maximum cruising speed. */
  topSpeed: number;
  /** 0..1 — turn rate + how well it holds a line through corners. */
  cornering: number;
  /** 0..1 — how readily it breaks traction into a drift, and how controllable. */
  weight: number;
}

/**
 * Concrete, physics-ready values derived from a {@link ShipSpec}.
 * The physics step (see ship/ShipPhysics.ts) only ever reads these.
 */
export interface ResolvedShipStats {
  /** Forward acceleration in world units / s^2. */
  thrust: number;
  /** Top cruising speed in world units / s. */
  maxSpeed: number;
  /** Base yaw rate in rad/s at full steer. */
  turnRate: number;
  /** Extra yaw rate multiplier while drifting. */
  driftTurnMultiplier: number;
  /** Lateral grip when gripping (higher = sticks to its line). */
  grip: number;
  /** Lateral grip when drifting (lower = slides more). */
  driftGrip: number;
  /** How hard the air-brake scrubs speed, units/s^2. */
  brakeForce: number;
  /** Linear drag applied to forward speed. */
  drag: number;
}

// Tuning anchors: a stat of 0 maps to MIN, a stat of 1 maps to MAX.
const SPEED_MIN = 70;
const SPEED_MAX = 130;
const THRUST_MIN = 28;
const THRUST_MAX = 70;
// Grip (non-drift) turn rate, deliberately low so tight corners require a
// drift rather than just steering through them.
const TURN_MIN = 0.8;
const TURN_MAX = 1.45;

export function resolveShipStats(spec: ShipSpec): ResolvedShipStats {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const maxSpeed = lerp(SPEED_MIN, SPEED_MAX, spec.topSpeed);
  const thrust = lerp(THRUST_MIN, THRUST_MAX, spec.acceleration);
  const turnRate = lerp(TURN_MIN, TURN_MAX, spec.cornering);

  // Heavier ships break traction less easily but, once drifting, slide more
  // and need more room. Lighter ships snap into drifts and recover faster.
  const grip = lerp(3.2, 5.0, spec.cornering);
  const driftGrip = lerp(0.5, 1.3, spec.weight);
  // Drifting turns ~3x sharper than gripping (base turn was halved, so this is
  // doubled to keep drift turning strong) — that's what makes drift necessary.
  const driftTurnMultiplier = lerp(3.4, 2.5, spec.weight);

  return {
    thrust,
    maxSpeed,
    turnRate,
    driftTurnMultiplier,
    grip,
    driftGrip,
    brakeForce: lerp(45, 30, spec.weight),
    drag: 0.35,
  };
}

export const SHIPS: ShipSpec[] = [
  {
    id: "vd-01",
    code: "VD-01",
    name: "HAYATE",
    jp: "ハヤテ",
    blurb: "Balanced all-rounder. A safe first ride.",
    color: new Color3(1.0, 0.18, 0.38),
    acceleration: 0.6,
    topSpeed: 0.68,
    cornering: 0.72,
    weight: 0.35,
    tintStrength: 0,
  },
  {
    id: "vd-02",
    code: "VD-02",
    name: "KAMUI",
    jp: "カムイ",
    blurb: "Featherweight. Razor cornering, modest top end.",
    color: new Color3(0.16, 0.82, 0.5),
    acceleration: 0.7,
    topSpeed: 0.45,
    cornering: 0.9,
    weight: 0.25,
    tintStrength: 0.85,
  },
  {
    id: "vd-03",
    code: "VD-03",
    name: "REIKA",
    jp: "レイカ",
    blurb: "Quick off the line. Strong acceleration, even keel.",
    color: new Color3(0.96, 0.85, 0.2),
    acceleration: 0.88,
    topSpeed: 0.6,
    cornering: 0.55,
    weight: 0.5,
    tintStrength: 0.85,
  },
  {
    id: "vd-04",
    code: "VD-04",
    name: "SHINOBI",
    jp: "シノビ",
    blurb: "Drift specialist. Loose tail, huge slides.",
    color: new Color3(0.6, 0.35, 0.95),
    acceleration: 0.55,
    topSpeed: 0.72,
    cornering: 0.6,
    weight: 0.72,
    tintStrength: 0.85,
  },
  {
    id: "vd-05",
    code: "VD-05",
    name: "RAIDEN",
    jp: "ライデン",
    blurb: "Heavy hitter. Blistering top speed, wide turns.",
    color: new Color3(1.0, 0.45, 0.15),
    acceleration: 0.4,
    topSpeed: 0.98,
    cornering: 0.35,
    weight: 0.9,
    tintStrength: 0.85,
  },
];

export function getShipById(id: string): ShipSpec {
  return SHIPS.find((s) => s.id === id) ?? SHIPS[0];
}

/** Pool of opponent racer names (bots pick random unique ones). */
export const RACER_NAMES: string[] = [
  "NOVA",
  "RAZE",
  "VOLT",
  "ZephyR",
  "HEX",
  "ONYX",
  "BLAZE",
  "KILO",
  "DRIFT KING",
  "MAVERICK",
  "GHOST",
  "TALON",
  "VIPER",
  "ECHO",
  "CIPHER",
  "ROGUE",
];
