# VECTOR DRIFT — Visual System

The house style for the whole game. Match it when adding or changing any UI.
Tokens live in `src/ui/vd-theme.css` (`:root`); use the CSS variables, never raw
hex.

## Palette & colour semantics

| Token | Hex | Meaning — use it ONLY for this |
| --- | --- | --- |
| `--vd-black` | `#050507` | Background. |
| `--vd-graphite` | `#141417` | Panels / inactive blocks. |
| `--vd-white` | `#f2f0ea` | Primary cards & text (warm off-white, not pure white). |
| `--vd-pink` | `#f4044e` | **Brand / primary energy.** Logo, headers, hero accents, key actions. |
| `--vd-lime` | `#d8f600` | **Active selection / confirmation ONLY.** The current/focused item. Never decorative. |
| `--vd-cyan` | `#00d7f2` | Secondary system accent — editor/3D, info, "in-progress" states (e.g. lobby SELECT-CRAFT). |
| `--vd-orange` | `#ff5a1f` | Warning / heat / boost / over-limit. |
| `--vd-grey` | `#66666a` | Secondary text / inactive lines. |

Rules of thumb:
- **Lime means "this is selected right now."** If it's not a live selection/confirm, it's not lime.
- **Pink is the brand.** One pink focal point per screen; don't compete with lime.
- Cyan is the editor's colour and for secondary/transitional UI.
- Keep surfaces dark; let one accent carry each screen.

## Typography

- Display face: `--vd-display` (Chakra Petch). UPPERCASE, wide letter-spacing
  (~0.08–0.14em) for labels, headers, buttons.
- Japanese face: `--vd-jp` (Noto Sans JP). Katakana/kanji **subtitles** sit under
  the English label as a secondary, lower-contrast line (e.g. `SOLO` / `ソロ`).
- Numerals (speed, timers, stats) are display-face, often lime/pink for emphasis.

## Layout & framing

Every full-screen menu shares the same furniture so negative space reads as
deliberate, not empty:
- **Vertical edge rails** (`.vd-side-label`, `writing-mode: vertical-rl`) on
  left + right. Left = contextual label (e.g. `SELECT MODE`), right is the
  constant `VECTOR DRIFT SYSTEM`.
- **Corner accent** (`.vd-corner`) top-left.
- **Scattered "+" marks** (`.vd-plus`) in the corners.
- Header: hexagon brand badge + name/JP subtitle. Footer: action hints with the
  ✕-in-ring glyph (`.ring`) as the button marker.
- The main menu runs a **full-bleed** 3D autopilot flythrough behind everything;
  content-heavy screens (garage, music) fill the frame with real content instead.

## Shapes & components

- Buttons/rows are **chevron/arrow-clipped** via `clip-path` polygons — never
  plain rectangles. Mode rows point right.
- Stats render as **segmented bars** (`.vd-seg`), not smooth fills.
- Selected card: lime border + subtle lime glow + slight scale-up.
- "Coming soon" items: dimmed with a `SOON` tag, not hidden.

## Motion

- Screen changes play a one-shot enter animation: shell fade+rise, then primary
  rows/cards **stagger in** from the left (`.vd-enter`). It fires only on actual
  screen changes, never on in-screen re-renders.
- Always wrap motion in `@media (prefers-reduced-motion: reduce)` resets.
- Easing: `cubic-bezier(0.2, 0.9, 0.2, 1)`, ~0.26–0.3s.

## Responsive

- Device divergence via an `is-desktop` / `is-touch` class on the root. Desktop
  gets richer layouts (e.g. hero stat panels); touch gets larger hit targets and
  drops sublabels when space is tight.
- Split-screen multiplayer is desktop-only.

## Sizing

Prefer viewport units (`vh`/`vw`) with `clamp()` for type and spacing so layouts
scale across phone → desktop without breakpoint soup.
