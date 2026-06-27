import { Curve3 } from "@babylonjs/core/Maths/math.path";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { PadKind, TrackSpec } from "../config/tracks";

/** Result of locating a world position relative to the track loop. */
export interface TrackSample {
  /** 0..1 progress around the loop. */
  t: number;
  /** Signed lateral distance from centre line (+ = right of travel). */
  lateral: number;
  /** Road surface height at this point. */
  height: number;
  /** Unit forward (direction of travel) on the XZ plane. */
  forward: Vector3;
  /** Centre-line point at this location. */
  center: Vector3;
}

export interface Pad {
  kind: PadKind;
  position: Vector3;
  forward: Vector3;
  mesh: Mesh;
  /** Cooldown timer so a pad doesn't re-trigger every frame. */
  cooldown: number;
}

const SAMPLES_PER_SEGMENT = 24;

export class Track {
  readonly spec: TrackSpec;
  readonly halfWidth: number;

  /** Dense centre-line samples (closed loop; last != first). */
  private centers: Vector3[] = [];
  private tangents: Vector3[] = [];
  private rights: Vector3[] = [];
  private cumLen: number[] = [];
  private totalLen = 0;

  readonly pads: Pad[] = [];
  readonly startPosition = new Vector3();
  readonly startForward = new Vector3(0, 0, 1);

  road!: Mesh;

  constructor(scene: Scene, spec: TrackSpec) {
    this.spec = spec;
    this.halfWidth = spec.roadHalfWidth;
    this.buildCenterline(spec);
    this.buildRoadMesh(scene);
    this.buildPads(scene, spec);

    const s0 = this.sampleAtIndex(0);
    this.startPosition.copyFrom(s0.center);
    this.startForward.copyFrom(s0.forward);
  }

  // ---- geometry construction ------------------------------------------------

  private buildCenterline(spec: TrackSpec): void {
    const ctrl = spec.points.map((p) => new Vector3(p[0], p[1], p[2]));
    const curve = Curve3.CreateCatmullRomSpline(ctrl, SAMPLES_PER_SEGMENT, true);
    const pts = curve.getPoints();
    // CreateCatmullRomSpline(closed) repeats the first point at the end; drop it.
    this.centers = pts.slice(0, pts.length - 1);

    const n = this.centers.length;
    for (let i = 0; i < n; i++) {
      const next = this.centers[(i + 1) % n];
      const prev = this.centers[(i - 1 + n) % n];
      const tangent = next.subtract(prev);
      tangent.y = 0;
      tangent.normalize();
      this.tangents.push(tangent);
      // right = tangent x up
      this.rights.push(new Vector3(tangent.z, 0, -tangent.x));
    }

    this.cumLen = [0];
    for (let i = 1; i < n; i++) {
      this.totalLen += Vector3.Distance(this.centers[i], this.centers[i - 1]);
      this.cumLen.push(this.totalLen);
    }
    // close the loop length
    this.totalLen += Vector3.Distance(this.centers[n - 1], this.centers[0]);
  }

  private buildRoadMesh(scene: Scene): void {
    const left: Vector3[] = [];
    const right: Vector3[] = [];
    const n = this.centers.length;
    for (let i = 0; i <= n; i++) {
      const c = this.centers[i % n];
      const r = this.rights[i % n];
      left.push(c.add(r.scale(-this.halfWidth)).add(new Vector3(0, 0.02, 0)));
      right.push(c.add(r.scale(this.halfWidth)).add(new Vector3(0, 0.02, 0)));
    }

    this.road = MeshBuilder.CreateRibbon(
      "road",
      { pathArray: [left, right], closeArray: false, closePath: false },
      scene
    );
    const mat = new StandardMaterial("roadMat", scene);
    mat.diffuseTexture = this.makeRoadTexture(scene);
    mat.specularColor = new Color3(0.05, 0.05, 0.08);
    mat.emissiveColor = new Color3(0.02, 0.02, 0.05);
    this.road.material = mat;

    this.buildEdgeRails(scene);
    this.buildStartLine(scene);
  }

  /** Procedural road texture: dark tarmac with a glowing centre stripe and rungs. */
  private makeRoadTexture(scene: Scene): DynamicTexture {
    const w = 256;
    const h = 1024;
    const tex = new DynamicTexture("roadTex", { width: w, height: h }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#0c0e1a";
    ctx.fillRect(0, 0, w, h);
    // edge lines
    ctx.fillStyle = "#1c2340";
    ctx.fillRect(0, 0, 10, h);
    ctx.fillRect(w - 10, 0, 10, h);
    // centre stripe
    ctx.fillStyle = "#16e0ff";
    ctx.globalAlpha = 0.5;
    ctx.fillRect(w / 2 - 2, 0, 4, h);
    ctx.globalAlpha = 1;
    // dashes for speed reference
    ctx.fillStyle = "#33406b";
    for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 30, y, 60, 18);
    tex.update();
    tex.wrapV = 1; // WRAP
    return tex;
  }

  private buildEdgeRails(scene: Scene): void {
    const n = this.centers.length;
    const mat = new StandardMaterial("railMat", scene);
    mat.emissiveColor = new Color3(0.1, 0.6, 1.0);
    mat.diffuseColor = new Color3(0.05, 0.1, 0.2);

    for (const side of [-1, 1]) {
      const path: Vector3[] = [];
      for (let i = 0; i <= n; i++) {
        const c = this.centers[i % n];
        const r = this.rights[i % n];
        path.push(c.add(r.scale(side * (this.halfWidth + 0.5))).add(new Vector3(0, 1.2, 0)));
      }
      const rail = MeshBuilder.CreateTube(
        `rail${side}`,
        { path, radius: 0.35, tessellation: 6, cap: Mesh.NO_CAP },
        scene
      );
      rail.material = mat;
    }
  }

  private buildStartLine(scene: Scene): void {
    const c = this.centers[0];
    const r = this.rights[0];
    const f = this.tangents[0];
    const plane = MeshBuilder.CreateGround(
      "startLine",
      { width: this.halfWidth * 2, height: 4 },
      scene
    );
    plane.position = c.add(f.scale(0)).add(new Vector3(0, 0.05, 0));
    plane.lookAt(c.add(f));
    const mat = new StandardMaterial("startMat", scene);
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.diffuseColor = new Color3(0.8, 0.8, 0.8);
    plane.material = mat;
    // suppress unused-var lint on r in case future banking uses it
    void r;
  }

  private buildPads(scene: Scene, spec: TrackSpec): void {
    for (const p of spec.pads) {
      const idx = Math.floor(p.t * this.centers.length) % this.centers.length;
      const c = this.centers[idx];
      const r = this.rights[idx];
      const f = this.tangents[idx];
      const pos = c
        .add(r.scale(p.offset * (this.halfWidth - 3)))
        .add(new Vector3(0, 0.1, 0));

      const mesh = MeshBuilder.CreateGround(
        `pad-${p.kind}-${idx}`,
        { width: 8, height: p.kind === "boost" ? 12 : 8 },
        scene
      );
      mesh.position = pos.clone();
      mesh.lookAt(pos.add(f));
      const mat = new StandardMaterial(`padMat-${idx}`, scene);
      mat.emissiveColor =
        p.kind === "boost" ? new Color3(1, 0.8, 0.1) : new Color3(0.3, 1, 0.5);
      mat.diffuseColor = mat.emissiveColor.scale(0.4);
      mesh.material = mat;

      this.pads.push({ kind: p.kind, position: pos, forward: f.clone(), mesh, cooldown: 0 });
    }
  }

  // ---- queries --------------------------------------------------------------

  private sampleAtIndex(i: number): TrackSample {
    return {
      t: i / this.centers.length,
      lateral: 0,
      height: this.centers[i].y,
      forward: this.tangents[i].clone(),
      center: this.centers[i].clone(),
    };
  }

  /**
   * Find where a world position sits relative to the track. Brute-force nearest
   * segment — the loop is only a few hundred samples, this is cheap and exact.
   */
  locate(pos: Vector3): TrackSample {
    const n = this.centers.length;
    let bestDist = Infinity;
    let bestI = 0;
    let bestProj = 0;

    for (let i = 0; i < n; i++) {
      const a = this.centers[i];
      const b = this.centers[(i + 1) % n];
      const ab = b.subtract(a);
      const abLen2 = ab.lengthSquared() || 1e-6;
      let tt = Vector3.Dot(pos.subtract(a), ab) / abLen2;
      tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
      const proj = a.add(ab.scale(tt));
      const d = (pos.x - proj.x) ** 2 + (pos.z - proj.z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestI = i;
        bestProj = tt;
      }
    }

    const a = this.centers[bestI];
    const b = this.centers[(bestI + 1) % n];
    const center = Vector3.Lerp(a, b, bestProj);
    const forward = Vector3.Lerp(this.tangents[bestI], this.tangents[(bestI + 1) % n], bestProj);
    forward.y = 0;
    forward.normalize();
    const right = new Vector3(forward.z, 0, -forward.x);
    const lateral = Vector3.Dot(pos.subtract(center), right);

    return {
      t: (bestI + bestProj) / n,
      lateral,
      height: center.y,
      forward,
      center,
    };
  }

  get length(): number {
    return this.totalLen;
  }
}
