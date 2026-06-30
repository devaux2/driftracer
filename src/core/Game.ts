import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";

import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { InputManager } from "../input/InputManager";
import { PlayerInput, type Scheme } from "../input/PlayerInput";
import { neutralControl, type ControlState } from "../input/types";
import { Track } from "../track/Track";
import { Ship } from "../ship/Ship";
import { preloadShipModel } from "../ship/shipModel";
import { ChaseCamera } from "../camera/ChaseCamera";
import { SplitHud } from "../ui/SplitHud";
import { SpeedLines } from "../effects/SpeedLines";
import { HUD } from "../ui/HUD";
import { DesktopHud, type StandingRow } from "../ui/DesktopHud";
import { Menu } from "../ui/Menu";
import { Splash } from "../ui/Splash";
import { Boot } from "../ui/Boot";
import { Bot, randomBotProfile } from "../race/Bot";
import { Minimap } from "../race/Minimap";
import { Ghost } from "../race/Ghost";
import { loadRecord, saveRecord, type GhostFrame } from "../race/records";
import { Results } from "../ui/Results";
import { Editor } from "../ui/Editor";
import { SimpleEditor } from "../ui/SimpleEditor";
import { TileEditor } from "../ui/TileEditor";
import { AudioManager } from "../audio/AudioManager";
import { NowPlaying } from "../ui/NowPlaying";
import { PauseMenu } from "../ui/PauseMenu";
import { getTrackById, type TrackSpec } from "../config/tracks";
import { RACER_NAMES, SHIPS, getShipById, type ShipSpec } from "../config/ships";

const RACER_COUNT = 12; // player + 11 bots (quick race)
const RACE_LAPS = 3;
const COUNTDOWN = 3; // seconds (3-2-1)
const GHOST_SAMPLE = 0.033; // ~30 fps recording

type RaceMode = "quick" | "time";
type GameMode = "menu" | "racing" | "editor";
type RacePhase = "countdown" | "running" | "finished";

/** One human in a local split-screen race: own craft, camera, input + HUD. */
interface LocalPlayer {
  ship: Ship;
  camera: ChaseCamera;
  input: PlayerInput;
  hud: SplitHud;
  ctrl: ControlState;
  finished: boolean;
  finishMs: number | null;
  finishPos: number;
}

/** Per-player accent colours (P1..P4): lime, cyan, orange, pink. */
const PLAYER_ACCENTS = ["#d8f600", "#00d7f2", "#ff5a1f", "#f4044e"];

const PAD_TRIGGER_RADIUS = 8;
const PAD_COOLDOWN = 1.5;

function fmtTime(ms: number | null): string {
  if (ms == null) return "--:--.--";
  const t = ms / 1000;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export class Game {
  private engine: Engine;
  private scene: Scene;
  private input: InputManager;
  private camera: ChaseCamera;
  private speedLines: SpeedLines;
  private hud: HUD | DesktopHud;
  private menu: Menu;
  private boot: Boot | null = null;
  private splash: Splash | null = null;
  private minimap: Minimap;
  private results: Results;
  private ghost: Ghost;
  private editor: Editor;
  private simpleEditor: SimpleEditor;
  private tileEditor: TileEditor;
  /** Which editor is currently open (so frame/exit/test route to the right one). */
  private activeEditor: "pro" | "simple" | "tiles" = "pro";
  private audio: AudioManager;
  private nowPlaying: NowPlaying;
  private pauseMenu: PauseMenu;
  private paused = false;
  /** True while test-driving a track from the editor, so exits return there
   * (preserving the in-progress map) instead of going to the main menu. */
  private testDriving = false;
  private editBackBtn: HTMLButtonElement | null = null;

  private track: Track;
  private ship: Ship | null = null;
  private bots: Bot[] = [];
  /** Non-empty only during a local split-screen race. */
  private localPlayers: LocalPlayer[] = [];

  private mode: GameMode = "menu";
  private phase: RacePhase = "countdown";
  private raceMode: RaceMode = "quick";
  private countdownT = 0;
  private goFlashT = 0;
  private raceTimeMs = 0;
  private prevLap = 0;
  private wrongWayT = 0;

  // ghost recording (time attack)
  private ghostBuffer: GhostFrame[] = [];
  private ghostSampleT = 0;
  private recordBestMs: number | null = null;
  private recordBeaten = false;

  // for the Retry button
  private lastSpec: ShipSpec = SHIPS[0];
  private lastUseGyro = false;

  private lastSteer = 0;

  constructor(canvas: HTMLCanvasElement, private container: HTMLElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.02, 0.02, 0.06, 1);

    this.setupEnvironment();
    void preloadShipModel(this.scene); // warm the GLB so race ships use it
    this.track = new Track(this.scene, getTrackById("neon-circuit"));

    this.camera = new ChaseCamera(this.scene);
    this.scene.activeCamera = this.camera.camera;

    this.input = new InputManager(this.container);
    // Tag the app by device so the UI can diverge (mobile stays touch-first;
    // desktop gets a roomier layout + richer HUD).
    this.container.classList.add(this.input.isTouchDevice ? "is-touch" : "is-desktop");
    this.speedLines = new SpeedLines(this.container);
    // Desktop gets the full FUI dashboard; mobile keeps the touch-first HUD.
    const desktop = !this.input.isTouchDevice;
    this.hud = desktop ? new DesktopHud(this.container) : new HUD(this.container);
    this.hud.show(false);
    const minimapParent = desktop ? (this.hud as DesktopHud).minimapMount : this.container;
    this.minimap = new Minimap(minimapParent, this.track);
    this.minimap.show(false);
    this.results = new Results(this.container);
    this.ghost = new Ghost(this.scene);

    this.audio = new AudioManager();
    this.menu = new Menu(
      this.container,
      this.input.isTouchDevice,
      (ship, mode, useGyro, trackId) =>
        this.startRace(ship, mode === "time" ? "time" : "quick", useGyro, trackId),
      () => this.openEditor(),
      () => this.openSimpleEditor(),
      () => this.openTileEditor(),
      this.audio,
      (entries, trackId) => this.startLocalRace(entries, trackId)
    );

    this.editor = new Editor(
      this.container,
      (spec) => this.testTrack(spec),
      () => this.exitEditor(),
      (spec) => void this.exportTrack(spec),
      (file) => this.importTrackFromFile(file)
    );

    this.simpleEditor = new SimpleEditor(
      this.container,
      (spec) => this.testTrack(spec),
      () => this.exitEditor()
    );

    this.tileEditor = new TileEditor(
      this.container,
      (spec) => this.testTrack(spec),
      () => this.exitEditor()
    );

    this.nowPlaying = new NowPlaying(this.container);
    this.audio.onTrack = (t) => {
      // Desktop shows the track in the HUD ticker / music screen, so the
      // slide-in popup is mobile-only (avoids overlapping the desktop ticker,
      // minimap card and footers). It's also hidden in the editor, where it
      // would cover the elevation strip.
      if (this.input.isTouchDevice && this.mode !== "editor") this.nowPlaying.show(t);
      this.hud.setNowPlaying(t.title, t.artist);
    };
    this.pauseMenu = new PauseMenu(this.container, {
      onResume: () => this.resumeRace(),
      onQuit: () => {
        this.resumeRace();
        if (this.testDriving) this.returnToEditor();
        else this.returnToMenu();
      },
      onFullscreen: () => void this.enterFullscreen(),
      onMusicVol: (v) => this.audio.setMusicVolume(v),
      onSfxVol: (v) => this.audio.setSfxVolume(v),
      onSkip: () => {
        this.audio.skip();
        const t = this.audio.currentTrack;
        this.pauseMenu.setNowPlaying(t ? `${t.title} — ${t.artist}` : "");
      },
    });
    // Quick "back to editor" button — only visible while test-driving a track,
    // so you never lose the in-progress map by exiting through the menu.
    this.editBackBtn = document.createElement("button");
    this.editBackBtn.className = "vd-testdrive-back";
    this.editBackBtn.textContent = "◄ EDITOR";
    this.editBackBtn.style.display = "none";
    this.editBackBtn.addEventListener("click", () => this.returnToEditor());
    this.container.appendChild(this.editBackBtn);

    this.menu.show(false); // hidden until PLAY is clicked on the title screen

    // Boot gate first: it captures the first user gesture so we can go
    // fullscreen *before* showing the splash (so the splash is fullscreen).
    // Splash → menu, both already fullscreen. Refs kept so a gamepad can
    // advance them (full controller playability).
    this.boot = new Boot(this.container, () => {
      this.boot = null;
      void this.enterFullscreen();
      this.splash = new Splash(this.container, () => {
        this.splash = null;
        void this.enterFullscreen();
        this.audio.playMenu(); // begin menu music (this click is the required gesture)
        this.menu.show(true);
      });
    });

    this.engine.runRenderLoop(() => this.frame());
    window.addEventListener("resize", () => this.engine.resize());
    this.handleOrientation();
    window.addEventListener("orientationchange", () => this.handleOrientation());
    window.addEventListener("resize", () => this.handleOrientation());
  }

  /** Fullscreen the whole app (so HUD/touch overlays come along) and, on mobile,
   * lock to landscape. Both are best-effort — unsupported browsers no-op. */
  private async enterFullscreen(): Promise<void> {
    const el = this.container as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (!document.fullscreenElement) {
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.() ?? Promise.resolve());
      }
    } catch {
      /* denied / unsupported — fine */
    }
    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      await orientation?.lock?.("landscape");
    } catch {
      /* lock unsupported (most desktops, iOS Safari) — fine */
    }
  }

  private setupEnvironment(): void {
    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.6;
    hemi.groundColor = new Color3(0.1, 0.1, 0.2);

    const dir = new DirectionalLight("dir", new Vector3(-0.4, -1, 0.6), this.scene);
    dir.intensity = 0.8;

    // Distance fog gives depth and reinforces speed.
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = new Color3(0.02, 0.02, 0.08);
    // Lighter on the big circuit so you can read the long straights ahead.
    this.scene.fogDensity = 0.001;

    // A vast neon grid floor far below for parallax / sense of motion, and so
    // the chasm under the shortcut ramp reads as a real drop.
    const floor = MeshBuilder.CreateGround("floor", { width: 6000, height: 6000 }, this.scene);
    floor.position.y = -28;
    const grid = new GridMaterial("grid", this.scene);
    grid.gridRatio = 12;
    grid.majorUnitFrequency = 5;
    grid.mainColor = new Color3(0.02, 0.02, 0.08);
    // Dim + faint so the background reads as distant depth, not the main grid —
    // the crosshatch on the track itself is the one that should stand out.
    grid.lineColor = new Color3(0.05, 0.12, 0.24);
    grid.opacity = 0.25;
    floor.material = grid;
  }

  private startRace(spec: ShipSpec, raceMode: RaceMode, useGyro: boolean, trackId?: string): void {
    // Switch to the chosen approved track if it isn't already active.
    if (trackId && this.track.spec.id !== trackId) {
      this.loadTrackSpec(getTrackById(trackId));
    }

    if (this.ship) this.ship.root.dispose();
    for (const b of this.bots) b.dispose();
    this.bots = [];

    this.raceMode = raceMode;
    this.lastSpec = spec;
    this.lastUseGyro = useGyro;
    this.results.hide();
    this.paused = false;
    this.pauseMenu.hide();
    // A fresh race is not a test drive until testTrack() flags it.
    this.testDriving = false;
    if (this.editBackBtn) this.editBackBtn.style.display = "none";

    const fwd = this.track.startForward;
    const right = new Vector3(fwd.z, 0, -fwd.x);
    const isTime = raceMode === "time";

    this.ship = new Ship(this.scene, spec);

    if (isTime) {
      // Solo run: start just ahead of the line, centred — no pack.
      this.ship.placeAtStart(this.track.startPosition.add(fwd.scale(6)), fwd);
    } else {
      // Build a starting grid AHEAD of the line (so no one falsely crosses it on
      // frame 1). Slot 0 is furthest ahead (pole); the player takes the last slot
      // so there's a pack to overtake. Bots get random ships + unique names.
      const names = [...RACER_NAMES].sort(() => Math.random() - 0.5);
      const gridPos = (slot: number): Vector3 => {
        const row = Math.floor(slot / 2);
        const col = slot % 2;
        const ahead = 10 + (RACER_COUNT / 2 - 1 - row) * 16;
        const lateral = (col === 0 ? -1 : 1) * 18;
        return this.track.startPosition.add(fwd.scale(ahead)).add(right.scale(lateral));
      };
      this.ship.placeAtStart(gridPos(RACER_COUNT - 1), fwd);
      for (let i = 0; i < RACER_COUNT - 1; i++) {
        const botSpec = SHIPS[Math.floor(Math.random() * SHIPS.length)];
        const profile = randomBotProfile(this.track.halfWidth);
        const bot = new Bot(this.scene, botSpec, names[i] ?? `CPU ${i + 1}`, profile);
        bot.placeAtStart(gridPos(i), fwd);
        this.bots.push(bot);
      }
    }

    // Load any persisted best lap + ghost for this craft/course (Time Attack).
    this.recordBestMs = null;
    this.recordBeaten = false;
    this.ghostBuffer = [];
    this.ghostSampleT = 0;
    this.ghost.hide();
    if (isTime) {
      const rec = loadRecord(this.track.spec.id, spec.id);
      if (rec) {
        this.recordBestMs = rec.bestMs;
        this.ship.bestLapMs = rec.bestMs;
        this.ghost.setFrames(rec.frames);
      } else {
        this.ghost.setFrames([]);
      }
    }

    this.camera.snapTo(this.ship, this.track);

    void this.enterFullscreen();

    if (useGyro) {
      // Must run from this user gesture (the RACE tap) for iOS permission.
      void this.input.enableGyro();
    } else {
      this.input.setSteerMode("touch");
    }

    // Race flow: 3-2-1 countdown, then GO.
    this.phase = "countdown";
    this.countdownT = COUNTDOWN;
    this.goFlashT = 0;
    this.raceTimeMs = 0;
    this.prevLap = this.ship.lap;
    this.hud.setTotalLaps(RACE_LAPS);
    this.hud.showPosition(!isTime);
    this.hud.setCountdown(String(COUNTDOWN));

    this.menu.show(false);
    this.hud.show(true);
    this.hud.setTrackInfo(this.track.spec.name, `${(this.track.length / 1000).toFixed(1)} KM`);
    this.minimap.show(!isTime);
    this.input.setTouchControlsVisible(true);
    this.audio.playRace(); // shuffle the aggro/chill pool while racing
    this.mode = "racing";
  }

  // ---- local split-screen race (desktop only) ------------------------------

  /** Start a local split-screen race for `count` players (2-4). Single-player
   * state is left untouched; this drives a parallel N-player path. */
  private startLocalRace(entries: { scheme: Scheme; shipId: string }[], trackId?: string): void {
    const count = Math.max(2, Math.min(4, entries.length));
    if (trackId && this.track.spec.id !== trackId) this.loadTrackSpec(getTrackById(trackId));

    // tear down any previous race (single or local)
    this.disposeLocalPlayers();
    if (this.ship) {
      this.ship.root.dispose();
      this.ship = null;
    }

    this.raceMode = "quick";
    this.results.hide();
    this.paused = false;
    this.pauseMenu.hide();

    const fwd = this.track.startForward;
    const right = new Vector3(fwd.z, 0, -fwd.x);
    const gridPos = (slot: number): Vector3 => {
      const row = Math.floor(slot / 2);
      const col = slot % 2;
      const ahead = 10 + (RACER_COUNT / 2 - 1 - row) * 16;
      const lateral = (col === 0 ? -1 : 1) * 18;
      return this.track.startPosition.add(fwd.scale(ahead)).add(right.scale(lateral));
    };

    for (let i = 0; i < count; i++) {
      const spec = getShipById(entries[i].shipId);
      const ship = new Ship(this.scene, spec);
      ship.placeAtStart(gridPos(i), fwd); // humans take the front grid slots
      const camera = new ChaseCamera(this.scene);
      camera.snapTo(ship, this.track);
      const input = new PlayerInput(entries[i].scheme);
      const hud = new SplitHud(this.container, `P${i + 1}`, spec.code, PLAYER_ACCENTS[i] ?? "#fff");
      hud.setTotalLaps(RACE_LAPS);
      hud.setCountdown(String(COUNTDOWN));
      this.localPlayers.push({
        ship,
        camera,
        input,
        hud,
        ctrl: neutralControl(),
        finished: false,
        finishMs: null,
        finishPos: 0,
      });
    }

    // Bots fill the rest of the grid, behind the human pack.
    const names = [...RACER_NAMES].sort(() => Math.random() - 0.5);
    for (let i = count; i < RACER_COUNT; i++) {
      const botSpec = SHIPS[Math.floor(Math.random() * SHIPS.length)];
      const bot = new Bot(this.scene, botSpec, names[i - count] ?? `CPU ${i}`, randomBotProfile(this.track.halfWidth));
      bot.placeAtStart(gridPos(i), fwd);
      this.bots.push(bot);
    }

    this.setSplitLayout(count);
    this.scene.activeCameras = this.localPlayers.map((p) => p.camera.camera);

    // hide single-player chrome
    this.hud.show(false);
    this.minimap.show(false);
    this.ghost.hide();

    this.phase = "countdown";
    this.countdownT = COUNTDOWN;
    this.goFlashT = 0;
    this.raceTimeMs = 0;

    this.menu.show(false);
    void this.enterFullscreen();
    this.audio.playRace();
    this.mode = "racing";
  }

  /** Lay out cameras (Babylon viewports, origin bottom-left) + HUD rects (CSS,
   * origin top-left): 2 = stacked halves, 3-4 = quadrants. */
  private setSplitLayout(count: number): void {
    const place = (i: number, v: [number, number, number, number], r: [number, number, number, number]) => {
      const p = this.localPlayers[i];
      if (!p) return;
      p.camera.camera.viewport = new Viewport(v[0], v[1], v[2], v[3]);
      p.hud.setRect(r[0], r[1], r[2], r[3]);
    };
    if (count === 2) {
      place(0, [0, 0.5, 1, 0.5], [0, 0, 100, 50]);
      place(1, [0, 0, 1, 0.5], [0, 50, 100, 50]);
    } else {
      place(0, [0, 0.5, 0.5, 0.5], [0, 0, 50, 50]);
      place(1, [0.5, 0.5, 0.5, 0.5], [50, 0, 50, 50]);
      place(2, [0, 0, 0.5, 0.5], [0, 50, 50, 50]);
      place(3, [0.5, 0, 0.5, 0.5], [50, 50, 50, 50]);
    }
  }

  /** Tear down a local race: ships, cameras, inputs, HUDs, bots; restore the
   * single full-screen camera. Safe to call when no local race is active. */
  private disposeLocalPlayers(): void {
    for (const p of this.localPlayers) {
      p.ship.root.dispose();
      p.camera.camera.dispose();
      p.input.dispose();
      p.hud.dispose();
    }
    this.localPlayers = [];
    for (const b of this.bots) b.dispose();
    this.bots = [];
    this.scene.activeCameras = null;
    this.scene.activeCamera = this.camera.camera;
  }

  /** Overall race position of a ship among every racer (humans + bots). */
  private rankOf(ship: Ship): number {
    const me = ship.progress;
    let ahead = 0;
    for (const p of this.localPlayers) if (p.ship !== ship && p.ship.progress > me) ahead++;
    for (const b of this.bots) if (b.ship.progress > me) ahead++;
    return ahead + 1;
  }

  private tickLocalCountdown(dt: number): void {
    this.countdownT -= dt;
    const label = this.countdownT <= 0 ? "GO" : String(Math.ceil(this.countdownT));
    for (const p of this.localPlayers) {
      p.hud.setCountdown(label);
      p.camera.update(dt, p.ship, this.track);
      p.hud.update(p.ship);
    }
    if (this.countdownT <= 0) {
      this.phase = "running";
      this.goFlashT = 0.9;
    }
  }

  private tickLocalRunning(dt: number, ctrl: ControlState): void {
    if (this.goFlashT > 0) {
      this.goFlashT -= dt;
      if (this.goFlashT <= 0) for (const p of this.localPlayers) p.hud.setCountdown(null);
    }

    for (const p of this.localPlayers) {
      if (!p.finished) p.input.read(p.ctrl);
      else {
        p.ctrl.steer = 0;
        p.ctrl.brake = 0;
        p.ctrl.boost = false;
      }
      p.ship.update(dt, p.ctrl, this.track);
    }
    for (const b of this.bots) b.update(dt, this.track);
    this.checkPadsLocal(dt);
    this.raceTimeMs += dt * 1000;

    for (const p of this.localPlayers) {
      p.camera.update(dt, p.ship, this.track);
      p.hud.update(p.ship);
      p.hud.setPosition(this.rankOf(p.ship), RACER_COUNT);
      if (!p.finished && p.ship.lap >= RACE_LAPS) {
        p.finished = true;
        p.finishMs = this.raceTimeMs;
        p.finishPos = this.rankOf(p.ship);
        p.hud.setFinish(`FINISH · POS ${p.finishPos}`);
        p.hud.setCountdown(null);
      }
    }

    if (this.localPlayers.every((p) => p.finished)) {
      this.finishLocalRace();
      return;
    }
    if (ctrl.pause) this.openPause();
  }

  /** Pads for a local race: one cooldown per pad, first overlapping player wins
   * the trigger that frame. */
  private checkPadsLocal(dt: number): void {
    for (const pad of this.track.pads) {
      if (pad.cooldown > 0) {
        pad.cooldown -= dt;
        continue;
      }
      for (const p of this.localPlayers) {
        const dx = p.ship.position.x - pad.position.x;
        const dz = p.ship.position.z - pad.position.z;
        if (dx * dx + dz * dz < PAD_TRIGGER_RADIUS * PAD_TRIGGER_RADIUS) {
          if (pad.kind === "boost") p.ship.applyBoostPad(pad.forward);
          else p.ship.applyJumpPad(pad.power, pad.forward);
          pad.cooldown = PAD_COOLDOWN;
          break;
        }
      }
    }
  }

  private finishLocalRace(): void {
    this.phase = "finished";
    const count = this.localPlayers.length;
    const lines = this.localPlayers.map((p, i) => ({
      label: `P${i + 1} · ${p.ship.spec.code}`,
      value: `POS ${p.finishPos} · ${fmtTime(p.finishMs)}`,
      highlight: p.finishPos === 1,
    }));
    const trackId = this.track.spec.id;
    // retry with the same devices + craft
    const entries = this.localPlayers.map((p) => ({ scheme: p.input.scheme, shipId: p.ship.spec.id }));
    this.results.show(
      "RACE COMPLETE",
      `LOCAL · ${count}P`,
      lines,
      () => this.startLocalRace(entries, trackId),
      () => this.returnToMenu()
    );
  }

  /** Exposed for debugging / smoke tests (e.g. injecting a test track). */
  get audioManager(): AudioManager {
    return this.audio;
  }

  /** Read-only telemetry for debugging / automated smoke tests. */
  get telemetry() {
    if (!this.ship) return null;
    return {
      speed: this.ship.speed,
      speedRatio: this.ship.speedRatio,
      drifting: this.ship.drifting,
      boosting: this.ship.boostTimer > 0,
      airborne: this.ship.airborne,
      respawnFlash: this.ship.respawnFlash,
      lap: this.ship.lap,
      yaw: this.ship.yaw,
      velYaw: Math.atan2(this.ship.velocity.x, this.ship.velocity.z),
      steer: this.lastSteer,
      pos: { x: this.ship.position.x, y: this.ship.position.y, z: this.ship.position.z },
    };
  }

  private returnToMenu(): void {
    this.mode = "menu";
    this.paused = false;
    this.testDriving = false;
    if (this.editBackBtn) this.editBackBtn.style.display = "none";
    this.disposeLocalPlayers(); // no-op outside a local race; restores the camera
    this.pauseMenu.hide();
    this.hud.show(false);
    this.hud.setCountdown(null);
    this.hud.setWrongWay(false);
    this.minimap.show(false);
    this.results.hide();
    this.ghost.hide();
    this.input.setTouchControlsVisible(false);
    this.audio.playMenu(); // back to menu themes
    this.menu.show(true);
  }

  // ---- track editor --------------------------------------------------------

  private openEditor(): void {
    this.menu.show(false);
    this.activeEditor = "pro";
    this.editor.open();
    this.mode = "editor";
  }

  /** Grid path-painter builder (TRACK BUILDER · SIMPLE). */
  private openSimpleEditor(): void {
    this.menu.show(false);
    this.activeEditor = "simple";
    this.simpleEditor.open();
    this.mode = "editor";
  }

  /** Tony-Hawk-style tile placer (TRACK BUILDER · TILES). */
  private openTileEditor(): void {
    this.menu.show(false);
    this.activeEditor = "tiles";
    this.tileEditor.open();
    this.mode = "editor";
  }

  private exitEditor(): void {
    if (this.activeEditor === "simple") this.simpleEditor.close();
    else if (this.activeEditor === "tiles") this.tileEditor.close();
    else this.editor.close();
    this.returnToMenu();
  }

  /** Rebuild the active track from a spec (editor swap / custom track). */
  private loadTrackSpec(spec: TrackSpec): void {
    this.track.dispose();
    this.track = new Track(this.scene, spec);
    this.minimap.setTrack(this.track);
  }

  /** Test-drive the track currently in the editor: load it and run a solo lap.
   * Stays flagged as a test drive so every exit returns to the editor. */
  private testTrack(spec: TrackSpec): void {
    if (this.activeEditor === "simple") this.simpleEditor.close();
    else if (this.activeEditor === "tiles") this.tileEditor.close();
    else this.editor.close();
    this.loadTrackSpec(spec);
    this.startRace(this.lastSpec, "time", this.lastUseGyro);
    this.testDriving = true;
    if (this.editBackBtn) this.editBackBtn.style.display = "";
  }

  /** Return from a test drive straight back into the editor, preserving the
   * (possibly unsaved) in-progress track. */
  private returnToEditor(): void {
    this.mode = "editor";
    this.paused = false;
    this.testDriving = false;
    if (this.editBackBtn) this.editBackBtn.style.display = "none";
    this.disposeLocalPlayers();
    this.pauseMenu.hide();
    this.hud.show(false);
    this.hud.setCountdown(null);
    this.hud.setWrongWay(false);
    this.minimap.show(false);
    this.results.hide();
    this.ghost.hide();
    this.input.setTouchControlsVisible(false);
    if (this.activeEditor === "simple") this.simpleEditor.resume();
    else if (this.activeEditor === "tiles") this.tileEditor.resume();
    else this.editor.resume();
  }

  /**
   * Export the edited track as a Wavefront .OBJ (+ .mtl) for building out in
   * C4D / Blender. Each surface type gets a distinctly-named material —
   * `vd_road`, `vd_edge`, `vd_boost`, `vd_jump`, `vd_start` — so the
   * road-vs-boost-vs-jump distinction is preserved through a DCC round-trip and
   * can be read back on import (via `usemtl`). OBJ over glTF for DCC reach.
   */
  private async exportTrack(spec: TrackSpec): Promise<void> {
    const tmp = new Scene(this.engine);
    const track = new Track(tmp, spec);
    try {
      const { OBJExport } = await import("@babylonjs/serializers/OBJ");

      // Type-tag materials so the pad types survive the round-trip.
      const mk = (name: string, r: number, g: number, b: number): StandardMaterial => {
        const m = new StandardMaterial(name, tmp);
        m.diffuseColor = new Color3(r, g, b);
        m.emissiveColor = new Color3(r * 0.5, g * 0.5, b * 0.5);
        return m;
      };
      const mats = {
        road: mk("vd_road", 0.12, 0.14, 0.2),
        edge: mk("vd_edge", 0.1, 0.6, 1.0),
        boost: mk("vd_boost", 1.0, 0.8, 0.1),
        jump: mk("vd_jump", 0.3, 1.0, 0.5),
        start: mk("vd_start", 0.9, 0.9, 0.9),
      };
      for (const m of tmp.meshes) {
        if (!(m instanceof Mesh)) continue;
        const n = m.name;
        m.material = n.startsWith("pad-boost")
          ? mats.boost
          : n.startsWith("pad-jump")
            ? mats.jump
            : n.startsWith("rail")
              ? mats.edge
              : n === "startLine"
                ? mats.start
                : mats.road;
      }

      const meshes = tmp.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
      const base = `vector-drift-${spec.id || "track"}`;
      const obj = OBJExport.OBJ(meshes, true, `${base}.mtl`, true);
      const mtl = Object.values(mats)
        .map((m) => {
          const c = m.diffuseColor;
          return `newmtl ${m.name}\nKa 0 0 0\nKd ${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)}\nKs 0.1 0.1 0.1\nd 1.0\nillum 2\n`;
        })
        .join("\n");
      this.downloadText(`${base}.obj`, obj);
      this.downloadText(`${base}.mtl`, mtl);
    } catch (e) {
      console.warn("track export failed", e);
    } finally {
      track.dispose();
      tmp.dispose();
    }
  }

  /** Parse an imported track mesh (.obj/.glb) into a TrackSpec for the editor. */
  private async importTrackFromFile(file: File): Promise<TrackSpec | null> {
    const tmp = new Scene(this.engine);
    try {
      const { importTrackFile } = await import("../track/importTrack");
      return await importTrackFile(tmp, file);
    } catch (e) {
      console.warn("track import failed", e);
      return null;
    } finally {
      tmp.dispose();
    }
  }

  private downloadText(filename: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Feed the standings / nearby board: racers by progress, with metre gaps. */
  private updateStandings(): void {
    if (!this.ship) return;
    const me = this.ship.progress;
    const len = this.track.length;
    const rows = [
      { name: "YOU", progress: me, you: true },
      ...this.bots.map((b) => ({ name: b.name, progress: b.ship.progress, you: false })),
    ];
    rows.sort((a, b) => b.progress - a.progress);
    const out: StandingRow[] = rows.map((r, i) => ({
      pos: i + 1,
      name: r.name,
      you: r.you,
      gap: (me - r.progress) * len,
    }));
    this.hud.setStandings(out);
  }

  /** Race position = 1 + the number of racers further around the track. */
  private playerPosition(): number {
    if (!this.ship) return 1;
    const me = this.ship.progress;
    let ahead = 0;
    for (const b of this.bots) if (b.ship.progress > me) ahead++;
    return ahead + 1;
  }

  private frame(): void {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    const ctrl = this.input.update(dt);
    this.lastSteer = ctrl.steer;

    if (this.mode === "racing" && this.localPlayers.length) {
      if (this.paused) {
        this.tickLocalPaused(dt, ctrl);
      } else if (this.phase === "countdown") {
        this.tickLocalCountdown(dt);
      } else if (this.phase === "running") {
        this.tickLocalRunning(dt, ctrl);
      } else {
        for (const p of this.localPlayers) p.camera.update(dt, p.ship, this.track);
      }
    } else if (this.mode === "racing" && this.ship) {
      if (this.paused) {
        this.tickPaused(dt, ctrl);
      } else if (this.phase === "countdown") {
        this.tickCountdown(dt);
      } else if (this.phase === "running") {
        this.tickRunning(dt, ctrl);
      } else {
        // finished: hold the wheel, keep the scene alive behind the results.
        this.camera.update(dt, this.ship, this.track);
        this.speedLines.render(dt, 0, 0);
      }
    } else {
      if (this.mode === "menu") {
        this.handleMenuPad();
        this.menu.tick(); // per-device polling for the split-screen join lobby
      } else if (this.mode === "editor" && this.activeEditor === "simple") {
        this.simpleEditor.tickPad(); // controller lays track in the grid builder
      } else if (this.mode === "editor" && this.activeEditor === "tiles") {
        this.tileEditor.tickPad(); // controller places parts in the tile builder
      }
      // Keep the scene alive behind the menu. The editor draws its own opaque
      // overlay (with its OWN 3D engine), so the main scene there is invisible —
      // skip it so two WebGL contexts aren't rendering full-res at once, which
      // stalls the GPU in fullscreen (the editor would appear to freeze).
      if (this.mode !== "editor") this.speedLines.render(dt, 0, 0);
    }

    // Don't render the (hidden) main scene while the editor overlay is up.
    if (this.mode !== "editor") this.scene.render();
  }

  /** Let a gamepad drive the boot gate, splash and menus (full controller
   * playability). Pointer/keyboard still work as before. */
  private handleMenuPad(): void {
    const nav = this.input.gamepad.getNav();
    if (!(nav.up || nav.down || nav.left || nav.right || nav.confirm || nav.back)) return;
    if (this.boot) {
      if (nav.confirm) this.boot.trigger();
      return;
    }
    if (this.splash) {
      if (nav.confirm) this.splash.trigger();
      return;
    }
    this.menu.handlePad(nav);
  }

  /** 3-2-1-GO. The ship is frozen (we don't tick physics) so the timer and
   * position stay put until GO. */
  private tickCountdown(dt: number): void {
    if (!this.ship) return;
    this.countdownT -= dt;
    if (this.countdownT <= 0) {
      this.phase = "running";
      this.goFlashT = 0.9;
      this.hud.setCountdown("GO");
    } else {
      this.hud.setCountdown(String(Math.ceil(this.countdownT)));
    }
    this.camera.update(dt, this.ship, this.track);
    this.hud.update(this.ship);
    this.speedLines.render(dt, 0, 0);
  }

  private openPause(): void {
    this.paused = true;
    this.hud.setWrongWay(false);
    this.audio.pause(); // pausing the game pauses the music
    const np = this.audio.currentTrack;
    this.pauseMenu.show(
      this.audio.musicVolume,
      this.audio.sfxVolume,
      np ? `${np.title} — ${np.artist}` : ""
    );
  }

  private resumeRace(): void {
    this.paused = false;
    this.audio.resume();
    this.pauseMenu.hide();
  }

  /** Paused during a local race (no single `this.ship`): keep every player's
   * camera alive and let the pause menu be driven by pad/keyboard. */
  private tickLocalPaused(dt: number, ctrl: ControlState): void {
    if (ctrl.pause) {
      this.resumeRace();
      return;
    }
    const nav = this.input.gamepad.getNav();
    if (nav.up || nav.down || nav.left || nav.right || nav.confirm || nav.back) {
      this.pauseMenu.handlePad(nav);
    }
    for (const p of this.localPlayers) p.camera.update(dt, p.ship, this.track);
  }

  /** While paused: freeze physics, keep the scene/camera alive, and let the
   * pause menu be driven by gamepad (mouse/keyboard work via the DOM). */
  private tickPaused(dt: number, ctrl: ReturnType<InputManager["update"]>): void {
    if (!this.ship) return;
    if (ctrl.pause) {
      this.resumeRace();
      return;
    }
    const nav = this.input.gamepad.getNav();
    if (nav.up || nav.down || nav.left || nav.right || nav.confirm || nav.back) {
      this.pauseMenu.handlePad(nav);
    }
    this.camera.update(dt, this.ship, this.track);
    this.speedLines.render(dt, 0, 0);
  }

  /** Flash WRONG WAY when the player's actual motion opposes track travel. */
  private updateWrongWay(dt: number): void {
    if (!this.ship) return;
    const fwd = this.track.locate(this.ship.position).forward;
    const v = this.ship.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed > 8 && (v.x * fwd.x + v.z * fwd.z) / speed < -0.35) {
      this.wrongWayT += dt;
    } else {
      this.wrongWayT = 0;
    }
    this.hud.setWrongWay(this.wrongWayT > 0.5);
  }

  private tickRunning(dt: number, ctrl: ReturnType<InputManager["update"]>): void {
    if (!this.ship) return;

    if (this.goFlashT > 0) {
      this.goFlashT -= dt;
      if (this.goFlashT <= 0) this.hud.setCountdown(null);
    }

    this.ship.update(dt, ctrl, this.track);
    for (const b of this.bots) b.update(dt, this.track);
    this.checkPads(dt);
    this.raceTimeMs += dt * 1000;

    // Lap boundary: capture/save the ghost and roll the buffer over.
    if (this.ship.lap !== this.prevLap) this.onLapComplete();

    if (this.raceMode === "time") {
      this.ghostSampleT += dt;
      if (this.ghostSampleT >= GHOST_SAMPLE) {
        this.ghostSampleT -= GHOST_SAMPLE;
        this.ghostBuffer.push([
          this.ship.currentLapMs,
          this.ship.position.x,
          this.ship.position.y,
          this.ship.position.z,
          this.ship.yaw,
        ]);
      }
      this.ghost.update(this.ship.currentLapMs);
    }

    this.updateWrongWay(dt);

    this.camera.update(dt, this.ship, this.track);
    this.hud.update(this.ship);
    if (this.raceMode === "quick") {
      this.hud.setPosition(this.playerPosition(), RACER_COUNT);
      this.updateStandings();
    } else {
      this.hud.setStandings([]);
    }
    this.minimap.render(
      this.ship.position,
      this.bots.map((b) => b.ship.position)
    );
    this.speedLines.render(dt, this.ship.speedRatio, this.ship.drifting ? this.ship.driftDir : 0);

    if (this.ship.lap >= RACE_LAPS) {
      this.finishRace();
      return;
    }
    if (ctrl.pause) this.openPause();
  }

  /** Called the frame a lap counter ticks over. Persists a new ghost/best-lap
   * for Time Attack, then starts a fresh recording buffer. */
  private onLapComplete(): void {
    if (!this.ship) return;
    const lapMs = this.ship.lastLapMs;
    if (this.raceMode === "time" && lapMs != null) {
      if (this.recordBestMs == null || lapMs < this.recordBestMs) {
        this.recordBestMs = lapMs;
        this.recordBeaten = true;
        saveRecord(this.track.spec.id, this.lastSpec.id, { bestMs: lapMs, frames: this.ghostBuffer });
        this.ghost.setFrames(this.ghostBuffer);
      }
    }
    this.prevLap = this.ship.lap;
    this.ghostBuffer = [];
    this.ghostSampleT = 0;
  }

  private finishRace(): void {
    if (!this.ship) return;
    this.phase = "finished";
    this.hud.setCountdown(null);
    this.hud.setWrongWay(false);
    this.wrongWayT = 0;
    this.input.setTouchControlsVisible(false);

    const wasTestDrive = this.testDriving;
    const onRetry = () => {
      this.startRace(this.lastSpec, this.raceMode, this.lastUseGyro);
      if (wasTestDrive) {
        this.testDriving = true;
        if (this.editBackBtn) this.editBackBtn.style.display = "";
      }
    };
    const onMenu = () => (wasTestDrive ? this.returnToEditor() : this.returnToMenu());

    if (this.raceMode === "time") {
      const lines = [
        { label: "BEST LAP", value: fmtTime(this.recordBestMs), highlight: true },
        { label: "TOTAL TIME", value: fmtTime(this.raceTimeMs) },
      ];
      this.results.show(
        "TIME ATTACK",
        this.recordBeaten ? "NEW RECORD!" : "RUN COMPLETE",
        lines,
        onRetry,
        onMenu
      );
    } else {
      const pos = this.playerPosition();
      const lines = [
        { label: "POSITION", value: `${pos} / ${RACER_COUNT}`, highlight: pos === 1 },
        { label: "TOTAL TIME", value: fmtTime(this.raceTimeMs) },
        { label: "BEST LAP", value: fmtTime(this.ship.bestLapMs) },
      ];
      this.results.show(
        pos === 1 ? "WINNER" : "FINISH",
        `${pos === 1 ? "P1" : "P" + pos} of ${RACER_COUNT}`,
        lines,
        onRetry,
        onMenu
      );
    }
  }

  private checkPads(dt: number): void {
    if (!this.ship) return;
    for (const pad of this.track.pads) {
      if (pad.cooldown > 0) {
        pad.cooldown -= dt;
        continue;
      }
      const dx = this.ship.position.x - pad.position.x;
      const dz = this.ship.position.z - pad.position.z;
      if (dx * dx + dz * dz < PAD_TRIGGER_RADIUS * PAD_TRIGGER_RADIUS) {
        if (pad.kind === "boost") this.ship.applyBoostPad(pad.forward);
        else this.ship.applyJumpPad(pad.power, pad.forward);
        pad.cooldown = PAD_COOLDOWN;
      }
    }
  }

  private handleOrientation(): void {
    const prompt = document.getElementById("rotate-prompt");
    if (!prompt) return;
    const portrait = window.innerHeight > window.innerWidth;
    const showPrompt = portrait && this.input?.isTouchDevice;
    prompt.classList.toggle("hidden", !showPrompt);
  }

  dispose(): void {
    this.input.dispose();
    this.engine.dispose();
  }
}
