# DRIFTRACER

A mobile-first, landscape **drift racer** in the spirit of *Wipeout 64* and
*F-Zero GX*, built entirely with [Babylon.js](https://www.babylonjs.com/) +
TypeScript + Vite.

The ship **auto-accelerates**. Your job is to **brake** — and braking mid-turn
breaks traction into a **drift**. Hit boost and jump pads, chain drifts for a
mini-boost, and chase the lap clock.

## Controls

| Action | Desktop | Mobile (touch) | Mobile (gyro) | Gamepad |
| --- | --- | --- | --- | --- |
| Steer | `A`/`D` or `←`/`→` | on-screen pads | tilt device | left stick / d-pad |
| Brake / Drift | `Space` | **BRAKE** button | **BRAKE** button | `A` / right trigger |
| Boost | `Shift` | **BOOST** button | **BOOST** button | `B` / left trigger |
| Pause → menu | `Esc` | — | — | Start |

Gyro steering is opt-in from the menu (iOS asks permission on the RACE tap).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (open on your phone via the LAN URL)
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the production build
```

Open the dev URL on a phone (same network) in **landscape** to test touch/gyro.

## How it's put together

Everything is data-driven so the planned features (level editor, multiplayer,
time attack, larger roster) are additive rather than rewrites.

```
src/
  main.ts                 entry point
  core/Game.ts            engine + scene, state machine (menu ⇄ racing), pad checks, render loop
  config/
    ships.ts              ship roster as normalized stats → resolved physics values
    tracks.ts             tracks as control points + pad placements (the editor's data format)
  input/
    types.ts              ControlState — the one normalized signal the game acts on
    InputManager.ts       merges all active devices each frame
    KeyboardInput / GamepadInput / TouchInput / GyroInput
  track/Track.ts          Catmull-Rom spline → ribbon road, rails, pads, spatial queries
  ship/Ship.ts            hover physics: auto-accel, air-brake, traction-break drift, jumps
  camera/ChaseCamera.ts   speed-scaled FOV + pull-back + drift lean
  effects/SpeedLines.ts   GPU-free radial speed streaks overlay
  ui/HUD.ts               speed / lap / time / drift+boost indicators (DOM)
  ui/Menu.ts              ship select + steering mode (reads the roster from config)
```

### The drift model (ship/Ship.ts)

Velocity is split into **forward** and **lateral** components relative to the
ship's heading each frame. Normally lateral grip is high, so the ship sticks to
its line. Holding the air-brake while steering drops lateral grip and boosts
yaw rate — the nose rotates faster than the velocity vector, so the tail slides:
a drift. Per-ship `grip` / `driftGrip` / `weight` stats make each ship slide
differently. Hold a drift long enough and you bank a mini-boost on release.

### Sense of speed

Three layers stack: chase-camera **FOV widening + pull-back** with speed, a
2D **radial speed-streak** overlay, and **distance fog** so the track rushes out
of the haze.

## Roadmap

- [x] Core loop: auto-accel, air-brake drift, boost/jump pads, sense of speed
- [x] Multi-platform input (keyboard, gamepad, touch, gyro)
- [x] Ship roster with trade-off stats + select menu
- [ ] **Time attack**: ghost replays, leaderboard, countdown/start sequence
- [ ] **Level editor**: author `TrackSpec` visually, save/load JSON
- [ ] **Multiplayer**: netcode over the shared `ControlState` + track id
- [ ] Track props, hazards, multiple environments, audio + music
- [ ] AI opponents
```
