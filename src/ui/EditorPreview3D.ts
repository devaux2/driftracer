import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Track } from "../track/Track";
import type { TrackSpec } from "../config/tracks";

/**
 * Live orbitable 3D preview of the track being edited. Builds the real
 * {@link Track} (banking, hills, pads and all) from the current spec and
 * rebuilds it, throttled, as the spec changes — so the author edits in the 2D
 * plan/elevation views and watches the actual circuit update in 3D. A highlight
 * marker tracks the selected control point.
 */
export class EditorPreview3D {
  private engine: Engine;
  private scene: Scene;
  private cam: ArcRotateCamera;
  private track: Track | null = null;
  private marker: Mesh;
  private active = false;
  private framed = false;

  private pending: TrackSpec | null = null;
  private lastBuild = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.02, 0.02, 0.05, 1);

    this.cam = new ArcRotateCamera("ed3d", -Math.PI / 2, 0.85, 1200, new Vector3(0, 0, 0), this.scene);
    this.cam.wheelPrecision = 0.4;
    this.cam.panningSensibility = 12;
    this.cam.lowerBetaLimit = 0.05;
    this.cam.upperBetaLimit = Math.PI / 2.05;
    this.cam.minZ = 1;
    this.cam.maxZ = 12000;
    this.cam.attachControl(canvas, true);

    const hemi = new HemisphericLight("e3h", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.8;
    hemi.groundColor = new Color3(0.08, 0.08, 0.14);
    const dir = new DirectionalLight("e3d", new Vector3(-0.4, -1, 0.5), this.scene);
    dir.intensity = 0.7;

    this.marker = MeshBuilder.CreateSphere("ed-marker", { diameter: 14, segments: 12 }, this.scene);
    const mm = new StandardMaterial("ed-marker-mat", this.scene);
    mm.emissiveColor = new Color3(0.85, 1, 0.2);
    mm.disableLighting = true;
    this.marker.material = mm;
    this.marker.setEnabled(false);

    this.engine.runRenderLoop(() => {
      if (!this.active) return;
      if (this.pending && performance.now() - this.lastBuild > 120) this.rebuild();
      this.scene.render();
    });
  }

  /** Queue a spec to render. Cheap — the actual (re)build is throttled. */
  setSpec(spec: TrackSpec): void {
    this.pending = spec;
  }

  private rebuild(): void {
    if (!this.pending) return;
    const spec = this.pending;
    this.pending = null;
    this.lastBuild = performance.now();
    this.track?.dispose();
    this.track = new Track(this.scene, spec);
    if (!this.framed) {
      this.frameCamera(spec);
      this.framed = true;
    }
  }

  /** Aim the orbit camera at the whole circuit (first build only). */
  private frameCamera(spec: TrackSpec): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of spec.points) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
    this.cam.setTarget(new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2));
    this.cam.radius = Math.max(maxX - minX, maxZ - minZ) * 1.25 + 300;
  }

  /** Highlight the selected control point (or hide the marker). */
  setSelection(point: [number, number, number, number?] | null): void {
    if (!point) {
      this.marker.setEnabled(false);
      return;
    }
    this.marker.setEnabled(true);
    this.marker.position.set(point[0], point[1] + 4, point[2]);
  }

  /** Re-frame the camera on the next build (e.g. after loading a new track). */
  resetFraming(): void {
    this.framed = false;
  }

  setActive(on: boolean): void {
    this.active = on;
    if (on) this.engine.resize();
  }

  resize(): void {
    if (this.active) this.engine.resize();
  }

  dispose(): void {
    this.track?.dispose();
    this.engine.dispose();
  }
}
