import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Track } from "../track/Track";
import type { ControlPoint, TrackSpec } from "../config/tracks";

/** Drag phase reported to the editor as the user moves a 3D handle. */
export type DragPhase = "start" | "move" | "end";
export type PointDragCb = (index: number, x: number, y: number, z: number, phase: DragPhase) => void;

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

  // draggable control-point handles
  private canvas: HTMLCanvasElement;
  private handles: Mesh[] = [];
  private handleMat: StandardMaterial;
  private startMat: StandardMaterial;
  private dragIdx: number | null = null;
  private dragShift = false;
  private dragStartY = 0;
  private dragStartPointerY = 0;

  // in-editor autopilot test-drive
  private driveShip: Mesh | null = null;
  private driving = false;
  private driveT = 0;

  constructor(canvas: HTMLCanvasElement, private onPointDrag?: PointDragCb) {
    this.canvas = canvas;
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

    // control-point handle materials (cyan; start point lime)
    this.handleMat = new StandardMaterial("ed-h", this.scene);
    this.handleMat.emissiveColor = new Color3(0, 0.84, 0.95);
    this.handleMat.disableLighting = true;
    this.startMat = new StandardMaterial("ed-h0", this.scene);
    this.startMat.emissiveColor = new Color3(0.85, 1, 0.13);
    this.startMat.disableLighting = true;

    if (this.onPointDrag) this.bindHandleDrag();

    this.engine.runRenderLoop(() => {
      if (!this.active) return;
      if (this.pending && performance.now() - this.lastBuild > 120) this.rebuild();
      if (this.driving) this.tickDrive();
      this.scene.render();
    });
  }

  /** Toggle an autopilot craft lapping the track in the preview (a quick test
   * drive without leaving the editor). */
  setDriving(on: boolean): void {
    this.driving = on;
    if (on && !this.driveShip) {
      const body = MeshBuilder.CreateBox("drive-ship", { width: 14, height: 5, depth: 26 }, this.scene);
      const m = new StandardMaterial("drive-ship-mat", this.scene);
      m.emissiveColor = new Color3(0.85, 1, 0.13);
      m.disableLighting = true;
      body.material = m;
      body.isPickable = false;
      this.driveShip = body;
    }
    this.driveShip?.setEnabled(on);
    if (on) this.driveT = 0;
  }

  private tickDrive(): void {
    if (!this.track || !this.driveShip) return;
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    this.driveT = (this.driveT + dt / 22) % 1; // ~22s lap
    const p = this.track.pointAt(this.driveT);
    const a = this.track.pointAt((this.driveT + 0.004) % 1);
    this.driveShip.position.set(p.x, p.y + 3, p.z);
    this.driveShip.rotation.set(0, Math.atan2(a.x - p.x, a.z - p.z), 0);
  }

  /** Pick + drag the control-point handle spheres: ground-plane move for X/Z,
   * Shift-drag for height. Orbit is suspended while a handle is held. */
  private bindHandleDrag(): void {
    this.scene.onPointerObservable.add((pi) => {
      if (!this.active) return;
      if (pi.type === PointerEventTypes.POINTERDOWN) {
        const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m.name.startsWith("h"));
        if (pick?.hit && pick.pickedMesh) {
          this.dragIdx = parseInt(pick.pickedMesh.name.slice(1), 10);
          this.dragShift = !!(pi.event as PointerEvent).shiftKey;
          this.dragStartY = this.handles[this.dragIdx].position.y;
          this.dragStartPointerY = this.scene.pointerY;
          this.cam.detachControl();
          this.onPointDrag?.(this.dragIdx, 0, 0, 0, "start");
        }
      } else if (pi.type === PointerEventTypes.POINTERMOVE && this.dragIdx != null) {
        const h = this.handles[this.dragIdx];
        if (this.dragShift) {
          const newY = this.dragStartY + (this.dragStartPointerY - this.scene.pointerY) * 1.5;
          h.position.y = newY;
          this.onPointDrag?.(this.dragIdx, h.position.x, newY - 3, h.position.z, "move");
        } else {
          const ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.cam);
          if (Math.abs(ray.direction.y) > 1e-4) {
            const t = (h.position.y - ray.origin.y) / ray.direction.y;
            if (t > 0) {
              const pt = ray.origin.add(ray.direction.scale(t));
              h.position.x = pt.x;
              h.position.z = pt.z;
              this.onPointDrag?.(this.dragIdx, pt.x, h.position.y - 3, pt.z, "move");
            }
          }
        }
      } else if (pi.type === PointerEventTypes.POINTERUP && this.dragIdx != null) {
        this.onPointDrag?.(this.dragIdx, 0, 0, 0, "end");
        this.dragIdx = null;
        this.cam.attachControl(this.canvas, true);
      }
    });
  }

  /** Sync the handle spheres to the spec's control points (creating/removing). */
  private syncHandles(spec: TrackSpec): void {
    while (this.handles.length > spec.points.length) this.handles.pop()?.dispose();
    while (this.handles.length < spec.points.length) {
      const s = MeshBuilder.CreateSphere(`h${this.handles.length}`, { diameter: 11, segments: 10 }, this.scene);
      this.handles.push(s);
    }
    spec.points.forEach((p, i) => {
      const h = this.handles[i];
      if (this.dragIdx === i) return; // don't yank the handle being dragged
      h.name = `h${i}`;
      h.material = i === 0 ? this.startMat : this.handleMat;
      h.position.set(p[0], p[1] + 3, p[2]);
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
    this.syncHandles(spec);
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
  setSelection(point: ControlPoint | null): void {
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
    for (const h of this.handles) h.dispose();
    this.track?.dispose();
    this.engine.dispose();
  }
}
