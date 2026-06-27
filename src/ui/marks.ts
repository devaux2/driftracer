/**
 * Reusable inline SVG art for the VECTOR DRIFT front-end: the brand mark, the
 * menu icons and a stylised hero ship. Inline SVG keeps everything crisp at any
 * size and lets us recolour via `currentColor` / CSS.
 */

/** The brand emblem: a forward "»" arrow with speed trails and a leading dot. */
export function logoMark(): string {
  return `
  <svg class="vd-mark" viewBox="0 0 120 100" aria-hidden="true">
    <g fill="currentColor">
      <circle cx="104" cy="19" r="9"/>
      <path d="M44 32 H62 L86 56 L62 80 H44 L68 56 Z"/>
      <path d="M72 32 H90 L114 56 L90 80 H72 L96 56 Z"/>
      <rect x="8" y="39" width="34" height="6.5" rx="3.25"/>
      <rect x="0" y="52.5" width="48" height="6.5" rx="3.25"/>
      <rect x="12" y="66" width="27" height="6.5" rx="3.25"/>
    </g>
  </svg>`;
}

/** Mode-row icons (stroke-based, inherit colour from the row). */
export const ICONS: Record<string, string> = {
  quick: `<svg viewBox="0 0 24 24" class="vd-ic" aria-hidden="true"><path d="M7 17 L17 7 M9.5 7 H17 V14.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>`,
  time: `<svg viewBox="0 0 24 24" class="vd-ic" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 13 V8 M12 13 L15.5 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M9 2.5 H15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  gp: `<svg viewBox="0 0 24 24" class="vd-ic" aria-hidden="true"><path d="M6 3 H18 V8 A6 6 0 0 1 6 8 Z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M6 5 H3 V7 A3 3 0 0 0 6 10 M18 5 H21 V7 A3 3 0 0 1 18 10" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 14 V18 M8 21 H16 M9.5 18 H14.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>`,
  mp: `<svg viewBox="0 0 24 24" class="vd-ic" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M3 12 H21 M12 3 C7 7 7 17 12 21 C17 17 17 7 12 3" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`,
  garage: `<svg viewBox="0 0 24 24" class="vd-ic" aria-hidden="true"><path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="miter"/></svg>`,
};

/** Build a flat top-down ship icon (nose right) from per-ship geometry, in the
 * shared VECTOR DRIFT style: white hull, accent wings + nose wedge, dark
 * canopy. Each roster craft gets a distinct silhouette. */
function ship(accent: string, parts: { wing: string; hull: string; nose: string; canopy: string; extra?: string }): string {
  const mirror = (pts: string) =>
    pts
      .trim()
      .split(/\s+/)
      .map((p) => {
        const [x, y] = p.split(",");
        return `${x},${240 - Number(y)}`;
      })
      .join(" ");
  return `
  <svg class="vd-ship" viewBox="0 0 480 240" aria-hidden="true">
    <polygon points="${parts.wing}" fill="${accent}" opacity="0.9"/>
    <polygon points="${mirror(parts.wing)}" fill="${accent}" opacity="0.9"/>
    <polygon points="${parts.hull}" fill="#eceef2"/>
    <polygon points="${parts.nose}" fill="${accent}"/>
    <polygon points="${parts.canopy}" fill="#0b0c12"/>
    ${parts.extra ?? ""}
  </svg>`;
}

/** Per-ship stylised icons (keyed by ship id). Each has a distinct planform
 * hinting at its character — needle/nimble, stubby/accel, flared/drift, etc. */
export const SHIP_ICONS: Record<string, (accent: string) => string> = {
  // HAYATE — balanced dart, mid-swept wings
  "vd-01": (a) =>
    ship(a, {
      wing: "250,104 160,50 122,66 240,116",
      hull: "70,120 150,100 320,96 460,120 320,144 150,140",
      nose: "460,120 322,98 322,142",
      canopy: "300,110 250,106 250,134 300,130",
    }),
  // KAMUI — long needle, small far-back deltas (featherweight cornerer)
  "vd-02": (a) =>
    ship(a, {
      wing: "205,113 150,58 128,66 220,117",
      hull: "80,120 175,112 345,114 472,120 345,126 175,128",
      nose: "472,120 360,113 360,127",
      canopy: "320,116 270,113 270,127 320,124",
    }),
  // REIKA — stubby body, forward-swept wings + intakes (quick off the line)
  "vd-03": (a) =>
    ship(a, {
      wing: "232,100 308,54 338,68 252,112",
      hull: "92,120 160,98 300,94 434,120 300,146 160,142",
      nose: "434,120 308,98 308,142",
      canopy: "286,110 240,106 240,134 286,130",
      extra:
        '<rect x="120" y="110" width="44" height="8" rx="2" fill="#0b0c12" opacity="0.5"/><rect x="120" y="122" width="44" height="8" rx="2" fill="#0b0c12" opacity="0.5"/>',
    }),
  // SHINOBI — big rear-flared swept wings, twin tail (drift specialist)
  "vd-04": (a) =>
    ship(a, {
      wing: "175,112 70,52 116,58 215,116",
      hull: "78,120 165,104 330,98 458,120 330,142 165,136",
      nose: "458,120 322,100 322,140",
      canopy: "298,110 250,107 250,133 298,130",
      extra:
        `<polygon points="92,120 60,92 78,96 120,118" fill="${a}"/><polygon points="92,120 60,148 78,144 120,122" fill="${a}"/>`,
    }),
  // RAIDEN — broad heavy hull, large swept-back wings (heavy top speed)
  "vd-05": (a) =>
    ship(a, {
      wing: "238,96 118,34 80,56 230,116",
      hull: "58,120 150,90 300,86 450,120 300,154 150,150",
      nose: "450,120 300,94 300,146",
      canopy: "300,108 244,104 244,136 300,132",
    }),
};

/** Stylised icon for a ship id (falls back to a generic dart). */
export function shipIcon(id: string, accent = "#ff2e6a"): string {
  return (SHIP_ICONS[id] ?? SHIP_ICONS["vd-01"])(accent);
}
