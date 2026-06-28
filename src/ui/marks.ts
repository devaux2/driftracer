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
  editor: `<svg viewBox="0 0 24 24" class="vd-ic" aria-hidden="true"><path d="M4 20 L4 16 L14.5 5.5 L18.5 9.5 L8 20 Z M14.5 5.5 L17 3 L21 7 L18.5 9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
  track: `<svg viewBox="0 0 24 24" class="vd-ic" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="6" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="5" cy="12" r="1.7" fill="currentColor"/></svg>`,
};

/** Mini top-down outline of a track's centre-line, for the map picker. */
export function trackThumb(points: [number, number, number][]): string {
  const n = points.length;
  const cr = (a: number, b: number, c: number, d: number, t: number) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push({ x: cr(p0[0], p1[0], p2[0], p3[0], t), z: cr(p0[2], p1[2], p2[2], p3[2], t) });
    }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const W = 120, H = 80, pad = 8;
  const sc = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxZ - minZ || 1));
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxZ - minZ) * sc) / 2;
  const coords = pts
    .map((p) => `${(ox + (p.x - minX) * sc).toFixed(1)},${(H - (oy + (p.z - minZ) * sc)).toFixed(1)}`)
    .join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" class="vd-track-thumb" aria-hidden="true"><polygon points="${coords}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>`;
}

/**
 * Per-ship brand emblems — minimalist geometric monograms (fake-corporate /
 * Japanese-logo vibe), not literal ship silhouettes. Each mark riffs on its
 * craft's name: HAYATE (falcon → ascending chevrons), KAMUI (spirit → framed
 * core), REIKA (radiance → burst), SHINOBI (ninja → shuriken), RAIDEN
 * (thunder → bolt). Single-colour, like a logo.
 */
const EMBLEM_BODIES: Record<string, (a: string) => string> = {
  // HAYATE — stacked ascending chevrons
  "vd-01": (a) => `
    <path fill="${a}" d="M50 40 L74 64 L66 64 L50 48 L34 64 L26 64 Z"/>
    <path fill="${a}" d="M50 22 L74 46 L66 46 L50 30 L34 46 L26 46 Z"/>`,
  // KAMUI — framed diamond with a core
  "vd-02": (a) => `
    <path fill="${a}" fill-rule="evenodd" d="M50 14 L86 50 L50 86 L14 50 Z M50 32 L68 50 L50 68 L32 50 Z"/>
    <circle cx="50" cy="50" r="6" fill="${a}"/>`,
  // REIKA — four-point radiant burst
  "vd-03": (a) => `
    <path fill="${a}" d="M50 12 L58 42 L88 50 L58 58 L50 88 L42 58 L12 50 L42 42 Z"/>`,
  // SHINOBI — shuriken pinwheel
  "vd-04": (a) => `
    <g fill="${a}">
      <path d="M50 50 L50 16 L64 30 Z"/>
      <path d="M50 50 L84 50 L70 64 Z"/>
      <path d="M50 50 L50 84 L36 70 Z"/>
      <path d="M50 50 L16 50 L30 36 Z"/>
    </g>
    <circle cx="50" cy="50" r="4.5" fill="${a}"/>`,
  // RAIDEN — lightning bolt
  "vd-05": (a) => `
    <path fill="${a}" d="M58 12 L30 54 L46 54 L40 88 L72 42 L54 42 Z"/>`,
};

/** A ship's brand emblem SVG (falls back to the first mark). */
export function shipIcon(id: string, accent = "#ff2e6a"): string {
  const body = (EMBLEM_BODIES[id] ?? EMBLEM_BODIES["vd-01"])(accent);
  return `<svg class="vd-emblem" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
}
