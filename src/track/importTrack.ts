import "@babylonjs/loaders/OBJ";
import "@babylonjs/loaders/glTF";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TrackSpec, ControlPoint, PadSpec } from "../config/tracks";

/**
 * Import a track mesh (.obj / .glb / .gltf) back into a playable {@link TrackSpec}.
 *
 * Physics is driven by the surface materials baked on export: meshes tagged
 * `vd_boost` / `vd_jump` become boost / jump pads, and the `vd_road` ribbon is
 * turned back into the drivable centre-line + width. The centre-line is rebuilt
 * from the road's two boundary rails (order-independent, so it survives the
 * vertex re-ordering of an OBJ/GLB round-trip and light DCC edits).
 */
export async function importTrackFile(scene: Scene, file: File): Promise<TrackSpec | null> {
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
  const res = await SceneLoader.ImportMeshAsync("", "", file, scene, null, ext);
  const meshes = res.meshes.filter((m) => m.getTotalVertices() > 0);
  if (!meshes.length) return null;

  const tag = (m: AbstractMesh) => `${m.material?.name ?? ""} ${m.name}`.toLowerCase();
  const isBoost = (m: AbstractMesh) => /vd_boost|boost/.test(tag(m));
  const isJump = (m: AbstractMesh) => /vd_jump|jump/.test(tag(m));
  const isEdge = (m: AbstractMesh) => /vd_edge|rail/.test(tag(m));
  const isRoad = (m: AbstractMesh) =>
    /vd_road|(^|[^a-z])road/.test(tag(m)) && !isBoost(m) && !isJump(m) && !isEdge(m);

  let road = meshes.find(isRoad);
  if (!road) {
    road = meshes
      .filter((m) => !isBoost(m) && !isJump(m) && !isEdge(m))
      .reduce((a, b) => (b.getTotalVertices() > a.getTotalVertices() ? b : a), meshes[0]);
  }

  const recon = reconstructCenterline(road);
  if (!recon) return null;
  const { points, roadHalfWidth } = recon;

  const locate = (p: Vector3): { t: number; offset: number } => {
    const n = points.length;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (points[i][0] - p.x) ** 2 + (points[i][2] - p.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const a = points[(best - 1 + n) % n];
    const b = points[(best + 1) % n];
    let tx = b[0] - a[0], tz = b[2] - a[2];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    const off = ((p.x - points[best][0]) * tz + (p.z - points[best][2]) * -tx) / roadHalfWidth;
    return { t: best / n, offset: Math.max(-1, Math.min(1, off)) };
  };

  const pads: PadSpec[] = [];
  for (const m of meshes) {
    const kind = isBoost(m) ? "boost" : isJump(m) ? "jump" : null;
    if (!kind) continue;
    m.computeWorldMatrix(true);
    const c = m.getBoundingInfo().boundingBox.centerWorld;
    const { t, offset } = locate(c);
    const pad: PadSpec = { kind, t, offset };
    if (kind === "jump") pad.power = 1;
    pads.push(pad);
  }
  pads.sort((a, b) => a.t - b.t);

  return { id: "custom", name: "IMPORTED TRACK", roadHalfWidth, points, pads };
}

/** World-space vertices of a mesh. */
function worldVerts(m: AbstractMesh): Vector3[] {
  m.computeWorldMatrix(true);
  const wm = m.getWorldMatrix();
  const data = m.getVerticesData(VertexBuffer.PositionKind);
  if (!data) return [];
  const out: Vector3[] = [];
  for (let i = 0; i < data.length; i += 3) {
    out.push(Vector3.TransformCoordinates(new Vector3(data[i], data[i + 1], data[i + 2]), wm));
  }
  return out;
}

/**
 * Rebuild an ordered centre-line from a road ribbon mesh by finding its two
 * boundary rails (edges used by a single triangle) and pairing them. Works
 * regardless of vertex order (welds coincident verts first).
 */
function reconstructCenterline(road: AbstractMesh): { points: ControlPoint[]; roadHalfWidth: number } | null {
  const verts = worldVerts(road);
  const indices = road.getIndices();
  if (!indices || verts.length < 6) return null;

  // Weld coincident vertices (de-indexed/round-tripped meshes duplicate them).
  const key = (v: Vector3) => `${Math.round(v.x)}|${Math.round(v.y)}|${Math.round(v.z)}`;
  const idOf = new Map<string, number>();
  const uniq: Vector3[] = [];
  const remap = new Int32Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const k = key(verts[i]);
    let id = idOf.get(k);
    if (id === undefined) { id = uniq.length; idOf.set(k, id); uniq.push(verts[i]); }
    remap[i] = id;
  }

  // Boundary edges = used by exactly one triangle.
  const ek = (a: number, b: number) => (a < b ? a * uniq.length + b : b * uniq.length + a);
  const count = new Map<number, number>();
  for (let i = 0; i < indices.length; i += 3) {
    const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
    for (const [x, y] of [[a, b], [b, c], [c, a]]) count.set(ek(x, y), (count.get(ek(x, y)) ?? 0) + 1);
  }
  const adj = new Map<number, number[]>();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [remap[indices[i]], remap[indices[i + 1]], remap[indices[i + 2]]];
    for (const [x, y] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
      if (count.get(ek(x, y)) === 1) {
        (adj.get(x) ?? adj.set(x, []).get(x)!).push(y);
        (adj.get(y) ?? adj.set(y, []).get(y)!).push(x);
      }
    }
  }

  // Walk boundary edges into closed loops.
  const seen = new Set<number>();
  const loops: Vector3[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let cur = start;
    let prev = -1;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(cur);
      const ns: number[] = adj.get(cur) ?? [];
      const next = ns.find((x: number) => x !== prev && !seen.has(x));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (loop.length > 3) loops.push(loop.map((i) => uniq[i]));
  }
  loops.sort((a, b) => b.length - a.length);
  if (loops.length < 2) return null;

  // Resample both rails by arc-length, pair nearest, midpoint = centre-line.
  const K = 96;
  const a = resample(loops[0], K);
  const b = resample(loops[1], K);
  const mids: Vector3[] = [];
  let widthSum = 0;
  for (const pa of a) {
    let nearest = b[0], bd = Infinity;
    for (const pb of b) {
      const d = Vector3.DistanceSquared(pa, pb);
      if (d < bd) { bd = d; nearest = pb; }
    }
    mids.push(Vector3.Center(pa, nearest));
    widthSum += Vector3.Distance(pa, nearest);
  }
  const roadHalfWidth = Math.max(8, Math.round(widthSum / K / 2));

  // Downsample to a sane control-point count.
  const target = 40;
  const step = Math.max(1, Math.floor(mids.length / target));
  const points: ControlPoint[] = [];
  for (let i = 0; i < mids.length; i += step) {
    points.push([Math.round(mids[i].x), Math.round(mids[i].y), Math.round(mids[i].z)]);
  }
  return points.length >= 4 ? { points, roadHalfWidth } : null;
}

/** Resample a closed polyline into k points evenly by arc length. */
function resample(loop: Vector3[], k: number): Vector3[] {
  const n = loop.length;
  const cum = [0];
  let total = 0;
  for (let i = 1; i <= n; i++) {
    total += Vector3.Distance(loop[i % n], loop[i - 1]);
    cum.push(total);
  }
  const out: Vector3[] = [];
  for (let s = 0; s < k; s++) {
    const d = (s / k) * total;
    let i = 1;
    while (i < cum.length && cum[i] < d) i++;
    const segLen = (cum[i] - cum[i - 1]) || 1;
    const f = (d - cum[i - 1]) / segLen;
    out.push(Vector3.Lerp(loop[(i - 1) % n], loop[i % n], f));
  }
  return out;
}
