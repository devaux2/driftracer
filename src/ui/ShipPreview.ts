import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import type { ShipSpec } from "../config/ships";

/**
 * A small, self-contained Babylon view that shows a single slowly-rotating ship
 * on a transparent canvas — used as the hero in the menu and garage. Kept
 * isolated from the main game scene (its own engine) so it can be mounted,
 * resized and recoloured independently. The hull is the same placeholder craft
 * the race uses; real models can be swapped in later.
 */
export class ShipPreview {
  private engine: Engine;
  private scene: Scene;
  private hull: TransformNode | null = null;
  private active = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { alpha: true, antialias: true, premultipliedAlpha: false });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);

    const cam = new ArcRotateCamera("preview", -Math.PI / 2.6, Math.PI / 2.35, 14, new Vector3(0, 0.1, 0.3), this.scene);
    cam.fov = 0.62;

    const hemi = new HemisphericLight("ph", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.85;
    hemi.groundColor = new Color3(0.1, 0.1, 0.16);
    const dir = new DirectionalLight("pd", new Vector3(-0.5, -0.6, 0.6), this.scene);
    dir.intensity = 0.9;

    this.engine.runRenderLoop(() => {
      if (!this.active) return;
      if (this.hull) this.hull.rotation.y += 0.006;
      this.scene.render();
    });
  }

  /** Build (or rebuild) the hull in the given ship's accent colour. */
  setShip(spec: ShipSpec): void {
    this.hull?.dispose(false, true);
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
    root.rotation.y = -0.5;
    this.hull = root;
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
