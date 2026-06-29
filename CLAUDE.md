# VECTOR DRIFT

A mobile-first landscape drift racer built with Babylon.js (Vite + TypeScript).

## Stack & layout
- Rendering: `@babylonjs/core` (+ `/materials`, `/loaders`, `/serializers`). Single Engine/Scene.
- `src/core/Game.ts` — orchestrator (modes: menu / racing / editor).
- `src/ship/` — `Ship` physics; `src/camera/ChaseCamera.ts` — chase cam.
- `src/track/` — Catmull-Rom `Track` (per-sample banks + half-widths); `customTrack.ts` storage.
- `src/ui/` — `Menu`, `Editor`, HUDs, splash; styles in `vd-theme.css` + `styles.css`.
- `src/input/` — `InputManager` aggregates keyboard / gamepad / gyro / touch; `PlayerInput` per-player for split-screen.
- `src/config/` — `tracks.ts`, `ships.ts`.

## Commands
- `npm run dev` — local dev server.
- `npm run build` — typecheck (`tsc --noEmit`) + production build. Run before considering a change done.
- `npm run typecheck` — types only.

## Deploy
- GitHub Pages from `main` via `.github/workflows/deploy.yml`. Vite `base: "./"`.
- The splash shows `build <short-git-sha>` (stamped in `vite.config.ts`).

## Conventions
- TypeScript strict — no `any`, no unused vars (the build fails on them).
- Use the design tokens, never raw hex (see below).
- Match the surrounding code's terseness and comment density.

## Design system
@DESIGN.md
