import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";

import { InputManager } from "../input/InputManager";
import { Track } from "../track/Track";
import { Ship } from "../ship/Ship";
import { ChaseCamera } from "../camera/ChaseCamera";
import { SpeedLines } from "../effects/SpeedLines";
import { HUD } from "../ui/HUD";
import { Menu } from "../ui/Menu";
import { Splash } from "../ui/Splash";
import { getTrackById } from "../config/tracks";
import type { ShipSpec } from "../config/ships";

type GameMode = "menu" | "racing";

const PAD_TRIGGER_RADIUS = 8;
const PAD_COOLDOWN = 1.5;

export class Game {
  private engine: Engine;
  private scene: Scene;
  private input: InputManager;
  private camera: ChaseCamera;
  private speedLines: SpeedLines;
  private hud: HUD;
  private menu: Menu;

  private track: Track;
  private ship: Ship | null = null;

  private mode: GameMode = "menu";
  private lastSteer = 0;

  constructor(canvas: HTMLCanvasElement, private container: HTMLElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.02, 0.02, 0.06, 1);

    this.setupEnvironment();
    this.track = new Track(this.scene, getTrackById("neon-circuit"));

    this.camera = new ChaseCamera(this.scene);
    this.scene.activeCamera = this.camera.camera;

    this.input = new InputManager(this.container);
    this.speedLines = new SpeedLines(this.container);
    this.hud = new HUD(this.container);
    this.hud.show(false);

    this.menu = new Menu(this.container, this.input.isTouchDevice, (ship, useGyro) =>
      this.startRace(ship, useGyro)
    );
    this.menu.show(false); // hidden until PLAY is clicked on the title screen

    // Title screen first. Clicking PLAY enters fullscreen (the required user
    // gesture), then reveals the ship-select menu — already fullscreen.
    new Splash(this.container, () => {
      void this.enterFullscreen();
      this.menu.show(true);
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

  private startRace(spec: ShipSpec, useGyro: boolean): void {
    if (this.ship) {
      this.ship.root.dispose();
      this.ship = null;
    }
    this.ship = new Ship(this.scene, spec);
    this.ship.placeAtStart(this.track.startPosition, this.track.startForward);
    this.camera.snapTo(this.ship);

    void this.enterFullscreen();

    if (useGyro) {
      // Must run from this user gesture (the RACE tap) for iOS permission.
      void this.input.enableGyro();
    } else {
      this.input.setSteerMode("touch");
    }

    this.menu.show(false);
    this.hud.show(true);
    this.mode = "racing";
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
      steer: this.lastSteer,
      pos: { x: this.ship.position.x, y: this.ship.position.y, z: this.ship.position.z },
    };
  }

  private returnToMenu(): void {
    this.mode = "menu";
    this.hud.show(false);
    this.menu.show(true);
  }

  private frame(): void {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    const ctrl = this.input.update(dt);
    this.lastSteer = ctrl.steer;

    if (this.mode === "racing" && this.ship) {
      if (ctrl.boost) this.ship.applyBoostPad();
      this.ship.update(dt, ctrl, this.track);
      this.checkPads(dt);
      this.camera.update(dt, this.ship);
      this.hud.update(this.ship);
      this.speedLines.render(dt, this.ship.speedRatio, this.ship.drifting ? this.ship.driftDir : 0);

      if (ctrl.pause) this.returnToMenu();
    } else {
      // Slowly orbit-ish idle: keep the scene alive behind the menu.
      this.speedLines.render(dt, 0, 0);
    }

    this.scene.render();
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
        if (pad.kind === "boost") this.ship.applyBoostPad();
        else this.ship.applyJumpPad(pad.power);
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
