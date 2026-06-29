/**
 * GameCube controller support.
 *
 * GC pads reach the browser through USB adapters (the official Nintendo
 * WUP-028, Mayflash, DragonRise clones, …) that report a NON-standard
 * `Gamepad.mapping` with their own button/axis order — so the Xbox/standard
 * indices the rest of the game uses don't line up. We detect those adapters by
 * id and translate them through this dedicated profile; every other pad stays on
 * the untouched standard path.
 *
 * Layout used (the official Nintendo adapter / Mayflash in the same firmware
 * family, as Chrome exposes them):
 *   axes[0] main stick X · axes[1] main stick Y
 *   0 A · 1 B · 2 X · 3 Y · 4 ◄ · 5 ► · 6 ▼ · 7 ▲ · 8 Start · 9 Z · 10 R · 11 L
 */

const GC = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  DLEFT: 4,
  DRIGHT: 5,
  DDOWN: 6,
  DUP: 7,
  START: 8,
  Z: 9,
  R: 10,
  L: 11,
} as const;

const DEAD = 0.18;
function curve(v: number): number {
  const m = (Math.abs(v) - DEAD) / (1 - DEAD);
  return m > 0 ? Math.sign(v) * Math.min(1, m) : 0;
}

/** True if this pad is a GameCube controller behind a known USB adapter. */
export function isGameCube(pad: Gamepad): boolean {
  const id = pad.id.toLowerCase();
  return (
    id.includes("gamecube") ||
    id.includes("wup-028") ||
    id.includes("wup_028") ||
    id.includes("mayflash") ||
    id.includes("0337") || // official Nintendo adapter product id (057e:0337)
    (id.includes("0079") && (id.includes("1843") || id.includes("1844"))) // Mayflash/DragonRise GC adapters
  );
}

/** Normalised read of a GameCube pad — same shape the standard sites expect. */
export interface GcReading {
  steer: number; // -1..1
  brake: number; // 0..1
  boost: boolean; // held this frame
  pause: boolean; // Start held
  // menu / lobby navigation (held this frame; callers compute their own edges)
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  start: boolean;
}

/** Translate a GameCube pad into the game's normalised control reading. */
export function readGameCube(pad: Gamepad): GcReading {
  const pressed = (i: number) => !!pad.buttons[i]?.pressed;
  const value = (i: number) => pad.buttons[i]?.value ?? 0;
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;

  let steer = curve(ax);
  if (pressed(GC.DLEFT)) steer = -1;
  if (pressed(GC.DRIGHT)) steer = 1;

  return {
    steer,
    // Air-brake / drift: L trigger (left hand) or A — strongest wins.
    brake: Math.max(value(GC.L), value(GC.A)),
    // Boost: R trigger or Z (both right-hand, so you can hold a drift and boost).
    boost: pressed(GC.R) || pressed(GC.Z),
    pause: pressed(GC.START),
    up: pressed(GC.DUP) || ay < -0.5,
    down: pressed(GC.DDOWN) || ay > 0.5,
    left: pressed(GC.DLEFT) || ax < -0.5,
    right: pressed(GC.DRIGHT) || ax > 0.5,
    confirm: pressed(GC.A) || pressed(GC.START),
    back: pressed(GC.B),
    start: pressed(GC.START),
  };
}
