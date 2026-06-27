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

/** Simple placeholder hero craft (top-down dart, nose right). Deliberately
 * minimal — real ship models get swapped in later. Accent colour per ship. */
export function shipArt(accent = "#ff2e6a"): string {
  return `
  <svg class="vd-ship" viewBox="0 0 480 240" aria-hidden="true">
    <path d="M120 60 L250 110 L130 124 Z" fill="${accent}" opacity="0.85"/>
    <path d="M120 180 L250 130 L130 116 Z" fill="${accent}" opacity="0.85"/>
    <path d="M60 120 L240 96 L450 120 L240 144 Z" fill="#eceef2"/>
    <path d="M450 120 L300 100 L300 140 Z" fill="${accent}"/>
    <path d="M300 110 L250 106 L250 134 L300 130 Z" fill="#0b0c12"/>
  </svg>`;
}
