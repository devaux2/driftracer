import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { preloadShipModel, buildShipModel, shipModelReady } from "../ship/shipModel";
import { Track } from "../track/Track";
import { TRACKS } from "../config/tracks";
import type { ShipSpec } from "../config/ships";

export type PreviewMode = "showcase" | "drive";

const HOVER = 1.8;
/** Seconds for the autopilot ship to complete one lap of the demo circuit. */
const LAP_SECONDS = 26;
/** Broadcast "perspective cam" boom, in the ship's local frame: ahead of the
 * craft (so we see its front), out to its right, and up high — an F1-style
 * trackside/T-cam framing that tracks the car as it drives. Kept tight so the
 * craft fills most of the viewport. */
const CAM_FWD = 6.4; // ahead of the nose
const CAM_RIGHT = 5; // off the right flank
const CAM_UP = 3.6; // raised above
/** Drive-mode model size (bigger than race scale so it dominates the window). */
const DRIVE_SHIP_LEN = 6.5;
/** Lateral camera pan (world units) to bias the craft right-of-centre on the
 * full-bleed menu backdrop, clear of the menu list on the left. */
const CAM_PAN = 5;

/**
 * A small, self-contained Babylon view used as the hero in the menu and garage.
 * Two modes:
 *  - "showcase" (garage / track select): a slowly-rotating ship on a transparent
 *    canvas, optionally on a neon platform ring.
 *  - "drive" (main menu): the ship runs the demo circuit on autopilot with a
 *    chase camera, so the front-end is a live track flythrough rather than a
 *    spinning model.
 * Kept isolated from the main game scene (its own engine) so it can be mounted,
 * resized and recoloured independently.
 */
export class ShipPreview {
  private engine: Engine;
  private scene: Scene;
  private cam: ArcRotateCamera;
  private chase: UniversalCamera;
  private hull: TransformNode | null = null;
  private ring: TransformNode;
  private active = false;
  private lastSpec: ShipSpec | null = null;
  private mode: PreviewMode = "showcase";

  /** Whether the current hull is the GLB model (nose +Z at yaw=π) or the box
   * fallback (nose +Z at yaw=0). Drives the heading offset in drive mode. */
  private usingModel = false;

  // --- drive-mode state ---
  private track: Track | null = null;
  private driveT = 0;
  private prevYaw = 0;
  private bank = 0;
  private driftKick = 0;
  /** Smoothed heading the broadcast boom rides on (pans through corners). */
  private readonly camFwd = new Vector3(0, 0, 1);
  private readonly camTarget = new Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { alpha: true, antialias: true, premultipliedAlpha: false });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);

    this.cam = new ArcRotateCamera("preview", -Math.PI / 2.6, Math.PI / 2.35, 14, new Vector3(0, 0.1, 0.3), this.scene);
    this.cam.fov = 0.62;

    this.chase = new UniversalCamera("chase", new Vector3(0, CAM_UP, CAM_FWD), this.scene);
    this.chase.fov = 0.9;
    this.chase.minZ = 0.5;
    this.chase.maxZ = 6000;

    this.scene.activeCamera = this.cam;

    const hemi = new HemisphericLight("ph", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.85;
    hemi.groundColor = new Color3(0.1, 0.1, 0.16);
    const dir = new DirectionalLight("pd", new Vector3(-0.5, -0.6, 0.6), this.scene);
    dir.intensity = 0.9;

    // Neon platform ring beneath the ship (garage). A *broken* segmented ring
    // (per the visual system: clean gaps, no full glowing circle). Part of the
    // 3D scene so it always sits correctly *behind* the craft.
    this.ring = new TransformNode("ringGroup", this.scene);
    this.ring.position.y = -1.4;
    const ringMat = new StandardMaterial("ringMat", this.scene);
    ringMat.emissiveColor = new Color3(0.96, 0.02, 0.31); // VD_PINK
    ringMat.disableLighting = true;
    const R = 5;
    const SEGS = 5;
    const span = ((Math.PI * 2) / SEGS) * 0.62; // 62% arc, 38% gap
    for (let s = 0; s < SEGS; s++) {
      const a0 = (s / SEGS) * Math.PI * 2;
      const path: Vector3[] = [];
      for (let i = 0; i <= 18; i++) {
        const a = a0 + (i / 18) * span;
        path.push(new Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
      }
      const seg = MeshBuilder.CreateTube(`ringSeg${s}`, { path, radius: 0.13, tessellation: 8, cap: 3 }, this.scene);
      seg.material = ringMat;
      seg.parent = this.ring;
    }
    this.ring.setEnabled(false);

    // Load the shared GLB into this scene; rebuild the current ship once ready.
    void preloadShipModel(this.scene).then(() => {
      if (this.lastSpec) this.setShip(this.lastSpec);
    });

    this.engine.runRenderLoop(() => {
      if (!this.active) return;
      if (this.mode === "drive") this.tickDrive();
      else if (this.hull) this.hull.rotation.y += 0.006;
      this.scene.render();
    });
  }

  /** Switch between the spinning showcase and the autopilot flythrough. */
  setMode(mode: PreviewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === "drive") {
      this.ring.setEnabled(false);
      if (!this.track) this.track = new Track(this.scene, TRACKS[0]);
      // Drop the ship onto the circuit and prime the chase camera so it doesn't
      // whip in from the old arc position on the first frame.
      this.driveT = 0;
      this.bank = 0;
      this.driftKick = 0;
      const p = this.track.pointAt(0);
      const ahead = this.track.pointAt(0.004);
      this.prevYaw = Math.atan2(ahead.x - p.x, ahead.z - p.z);
      const fwd = ahead.subtract(p);
      fwd.y = 0;
      fwd.normalize();
      this.camFwd.copyFrom(fwd);
      // prime the boom so it doesn't whip in from the old arc position
      const rx0 = fwd.z, rz0 = -fwd.x;
      this.chase.position.set(
        p.x + fwd.x * CAM_FWD + rx0 * CAM_RIGHT,
        p.y + CAM_UP,
        p.z + fwd.z * CAM_FWD + rz0 * CAM_RIGHT
      );
      this.camTarget.copyFrom(p).addInPlaceFromFloats(0, 1.6, 0);
      this.scene.activeCamera = this.chase;
    } else {
      this.scene.activeCamera = this.cam;
      this.track?.dispose();
      this.track = null;
    }
  }

  /** Build (or rebuild) the craft for the given ship (tinted GLB, or a simple
   * box hull until the model has loaded). */
  setShip(spec: ShipSpec): void {
    this.lastSpec = spec;
    this.hull?.dispose(false, true);

    // Drive mode frames the ship close-up; showcase shows it large.
    const targetLength = this.mode === "drive" ? DRIVE_SHIP_LEN : 7;

    if (shipModelReady(this.scene)) {
      const model = buildShipModel(this.scene, spec.color, spec.tintStrength, targetLength);
      if (model) {
        this.usingModel = true;
        if (this.mode === "showcase") model.rotation.y = Math.PI + 0.5; // 3/4 hero angle
        this.hull = model;
        return;
      }
    }

    this.usingModel = false;
    const root = new TransformNode(`preview-${spec.id}`, this.scene);
    const body = MeshBuilder.CreateBox("hull", { width: 2.2, height: 0.7, depth: 4.2 }, this.scene);
    const nose = MeshBuilder.CreateCylinder(
      "nose",
      { diameterTop: 0, diameterBottom: 1.6, height: 2.4, tessellation: 4 },
      this.scene
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 3;
    const fin = MeshBuilder.CreateBox("fin", { width: 0.2, height: 1.0, depth: 1.6 }, this.scene);
    fin.position.set(0, 0.7, -1.6);

    const hullMat = new StandardMaterial("pHull", this.scene);
    hullMat.diffuseColor = spec.color.scale(0.6);
    hullMat.emissiveColor = spec.color.scale(0.35);
    hullMat.specularColor = new Color3(1, 1, 1);
    body.material = hullMat;
    nose.material = hullMat;
    fin.material = hullMat;

    const glow = MeshBuilder.CreateBox("glow", { width: 1.8, height: 0.4, depth: 0.3 }, this.scene);
    glow.position.set(0, 0, -2.2);
    const glowMat = new StandardMaterial("pGlow", this.scene);
    glowMat.emissiveColor = new Color3(0.4, 0.9, 1);
    glow.material = glowMat;

    for (const m of [body, nose, fin, glow]) m.parent = root;
    if (this.mode === "showcase") root.rotation.y = -0.5;
    this.hull = root;
  }

  /** Advance the autopilot ship around the demo circuit + chase it. */
  private tickDrive(): void {
    if (!this.track || !this.hull) return;
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    this.driveT = (this.driveT + dt / LAP_SECONDS) % 1;

    const p = this.track.pointAt(this.driveT);
    const ahead = this.track.pointAt(this.driveT + 0.004);
    const fwd = ahead.subtract(p);
    const flat = Math.hypot(fwd.x, fwd.z) || 1e-3;
    const yaw = Math.atan2(fwd.x, fwd.z);
    const pitch = -Math.atan2(fwd.y, flat);

    // Turn rate → lean + a touch of drift attitude through the corners.
    let dyaw = yaw - this.prevYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.prevYaw = yaw;
    const turnRate = dyaw / dt; // rad/s
    const targetBank = Math.max(-0.5, Math.min(0.5, -turnRate * 0.55));
    const targetKick = Math.max(-0.55, Math.min(0.55, turnRate * 0.3));
    this.bank += (targetBank - this.bank) * Math.min(1, 5 * dt);
    this.driftKick += (targetKick - this.driftKick) * Math.min(1, 6 * dt);

    const noseOffset = this.usingModel ? Math.PI : 0;
    this.hull.position.set(p.x, p.y + HOVER, p.z);
    this.hull.rotation.set(pitch, yaw + noseOffset + this.driftKick, this.bank);

    // Broadcast boom: a fixed rig in the car's frame — ahead, right and high, so
    // it frames the front of the racer F1-perspective-cam style. The heading it
    // rides on is smoothed so the rig pans smoothly through corners instead of
    // snapping, but its offset to the car stays fixed.
    const fx = fwd.x / flat;
    const fz = fwd.z / flat;
    const ce = Math.min(1, 4 * dt);
    this.camFwd.set(this.camFwd.x + (fx - this.camFwd.x) * ce, 0, this.camFwd.z + (fz - this.camFwd.z) * ce);
    const cl = Math.hypot(this.camFwd.x, this.camFwd.z) || 1;
    const cfx = this.camFwd.x / cl;
    const cfz = this.camFwd.z / cl;
    const rx = cfz; // car's right (right-hand normal of the heading)
    const rz = -cfx;
    const camX = p.x + cfx * CAM_FWD + rx * CAM_RIGHT;
    const camY = p.y + CAM_UP;
    const camZ = p.z + cfz * CAM_FWD + rz * CAM_RIGHT;
    // Horizontal pan so the craft sits right-of-centre, clear of the menu list
    // that floats over the left of the full-bleed backdrop.
    const vx = p.x - camX;
    const vz = p.z - camZ;
    const vl = Math.hypot(vx, vz) || 1;
    const hx = -vz / vl; // screen-horizontal (perp to view, in XZ)
    const hz = vx / vl;
    this.chase.position.set(camX + hx * CAM_PAN, camY, camZ + hz * CAM_PAN);
    this.camTarget.set(p.x + hx * CAM_PAN, p.y + 1.6, p.z + hz * CAM_PAN);
    this.chase.setTarget(this.camTarget);
  }

  /** Show/hide the neon platform ring (garage only). */
  setRing(on: boolean): void {
    this.ring.setEnabled(on && this.mode === "showcase");
  }

  /** Start/stop rendering (saves the GPU while the preview is off-screen). */
  setActive(on: boolean): void {
    this.active = on;
    this.canvas.style.display = on ? "" : "none";
    if (on) this.engine.resize();
  }

  /** Match the canvas drawing buffer to its current CSS size. */
  resize(): void {
    if (this.active) this.engine.resize();
  }

  dispose(): void {
    this.engine.dispose();
  }
}
