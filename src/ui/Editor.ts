import type { TrackSpec, PadSpec } from "../config/tracks";
import { baseSpec, cloneSpec, loadCustomTrack, saveCustomTrack } from "../track/customTrack";
import { EditorPreview3D } from "./EditorPreview3D";

type Tool = "select" | "point" | "boost" | "jump";
type Sel = { type: "point" | "pad"; index: number } | null;

interface Pt {
  x: number;
  z: number;
}

/**
 * Top-down track editor. Edits a {@link TrackSpec} directly: drag the
 * Catmull-Rom control points, set per-point elevation + road width, and
 * add/move/delete boost & jump pads (with launch power). Persists to
 * localStorage and can launch a live test drive on the edited track.
 */
export class Editor {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private side: HTMLCanvasElement;
  private sideCtx: CanvasRenderingContext2D;
  private panel: HTMLDivElement;
  private preview3d: EditorPreview3D;

  private spec: TrackSpec = baseSpec();
  private tool: Tool = "select";
  private sel: Sel = null;

  // undo / redo (spec snapshots)
  private history: TrackSpec[] = [];
  private redoStack: TrackSpec[] = [];
  /** Set once per drag gesture so we only snapshot the pre-drag state. */
  private gestureSaved = false;

  // world→screen transform (recomputed each render to keep the track in view)
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private dragging = false;
  private vDragging = false;

  private fileInput: HTMLInputElement;

  constructor(
    container: HTMLElement,
    private onTest: (spec: TrackSpec) => void,
    private onExit: () => void,
    private onExport: (spec: TrackSpec) => void,
    private onImport: (file: File) => Promise<TrackSpec | null>
  ) {
    this.root = document.createElement("div");
    this.root.className = "vd-editor overlay";
    this.root.style.display = "none";

    const main = document.createElement("div");
    main.className = "vd-ed-main";

    const views = document.createElement("div");
    views.className = "vd-ed-views";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "vd-ed-canvas";
    const sideWrap = document.createElement("div");
    sideWrap.className = "vd-ed-side-wrap";
    sideWrap.innerHTML = `<span class="vd-ed-side-label">ELEVATION ▸ drag points to set height</span>`;
    this.side = document.createElement("canvas");
    this.side.className = "vd-ed-side";
    sideWrap.appendChild(this.side);
    views.append(this.canvas, sideWrap);

    // Live, orbitable 3D preview of the real track (rebuilt as you edit).
    const p3dWrap = document.createElement("div");
    p3dWrap.className = "vd-ed-3d-wrap";
    p3dWrap.innerHTML = `<span class="vd-ed-3d-label">LIVE 3D ▸ drag to orbit · scroll to zoom</span>`;
    const p3d = document.createElement("canvas");
    p3d.className = "vd-ed-3d";
    p3dWrap.appendChild(p3d);

    main.append(views, p3dWrap);

    this.panel = document.createElement("div");
    this.panel.className = "vd-ed-panel";

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".obj,.glb,.gltf";
    this.fileInput.style.display = "none";
    this.fileInput.addEventListener("change", () => void this.handleImport());

    this.root.append(main, this.panel, this.fileInput);
    container.appendChild(this.root);
    this.ctx = this.canvas.getContext("2d")!;
    this.sideCtx = this.side.getContext("2d")!;
    this.preview3d = new EditorPreview3D(p3d);

    this.bindCanvas();
    this.bindSide();
    window.addEventListener("resize", () => {
      if (this.root.style.display !== "none") this.resize();
    });
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  // ---- lifecycle -----------------------------------------------------------

  open(): void {
    this.spec = loadCustomTrack() ?? baseSpec();
    this.tool = "select";
    this.sel = null;
    this.history = [];
    this.redoStack = [];
    this.root.style.display = "";
    this.preview3d.setActive(true);
    this.preview3d.resetFraming();
    this.preview3d.setSpec(this.spec);
    this.resize();
    this.renderPanel();
  }

  close(): void {
    this.root.style.display = "none";
    this.preview3d.setActive(false);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    for (const [cv, cx] of [
      [this.canvas, this.ctx],
      [this.side, this.sideCtx],
    ] as const) {
      cv.width = Math.max(1, Math.floor((cv.clientWidth || 1) * dpr));
      cv.height = Math.max(1, Math.floor((cv.clientHeight || 1) * dpr));
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.preview3d.resize();
    this.draw();
  }

  // ---- geometry helpers ----------------------------------------------------

  /** Catmull-Rom sample of the control loop (closed) for a smooth preview. */
  private sampleLoop(perSeg = 16): Pt[] {
    const p = this.spec.points;
    const n = p.length;
    const out: Pt[] = [];
    const cr = (a: number, b: number, c: number, d: number, t: number) => {
      const t2 = t * t;
      const t3 = t2 * t;
      return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    };
    for (let i = 0; i < n; i++) {
      const p0 = p[(i - 1 + n) % n];
      const p1 = p[i];
      const p2 = p[(i + 1) % n];
      const p3 = p[(i + 2) % n];
      for (let s = 0; s < perSeg; s++) {
        const t = s / perSeg;
        out.push({ x: cr(p0[0], p1[0], p2[0], p3[0], t), z: cr(p0[2], p1[2], p2[2], p3[2], t) });
      }
    }
    return out;
  }

  private fit(): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.spec.points) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    const margin = this.spec.roadHalfWidth + 80;
    minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.scale = Math.min(w / (maxX - minX), h / (maxZ - minZ));
    this.offX = (w - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    // flip Z so +Z reads upward
    this.offY = h - ((h - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale);
  }

  private toScreen(x: number, z: number): Pt {
    return { x: this.offX + x * this.scale, z: this.offY - z * this.scale };
  }
  private toWorld(sx: number, sz: number): Pt {
    return { x: (sx - this.offX) / this.scale, z: (this.offY - sz) / this.scale };
  }

  /** Locate a world point on the road: nearest position along the loop (t) and
   * its lateral offset across the road (-1..1), so pads land where you click. */
  private locate(world: Pt): { t: number; offset: number } {
    const pts = this.sampleLoop(8);
    const n = pts.length;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (pts[i].x - world.x) ** 2 + (pts[i].z - world.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const a = pts[(best - 1 + n) % n];
    const b = pts[(best + 1) % n];
    let tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    const nx = tz, nz = -tx; // right-hand normal (matches Track's "right")
    const c = pts[best];
    const off = ((world.x - c.x) * nx + (world.z - c.z) * nz) / this.spec.roadHalfWidth;
    return { t: best / n, offset: Math.max(-1, Math.min(1, off)) };
  }

  /** World position of a pad, accounting for its lateral offset on the road. */
  private padPos(pad: PadSpec, loop: Pt[]): Pt {
    const n = loop.length;
    const idx = Math.floor(pad.t * n) % n;
    const a = loop[(idx - 1 + n) % n];
    const b = loop[(idx + 1) % n];
    let tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    const c = loop[idx];
    return { x: c.x + tz * pad.offset * this.spec.roadHalfWidth, z: c.z - tx * pad.offset * this.spec.roadHalfWidth };
  }

  // ---- rendering -----------------------------------------------------------

  private draw(): void {
    this.drawTop();
    this.drawSide();
    // keep the live 3D preview + selection marker in sync
    this.preview3d.setSpec(this.spec);
    this.preview3d.setSelection(this.sel?.type === "point" ? this.spec.points[this.sel.index] : null);
  }

  // ---- undo / redo ---------------------------------------------------------

  private pushHistory(): void {
    this.history.push(cloneSpec(this.spec));
    if (this.history.length > 60) this.history.shift();
    this.redoStack = [];
  }
  private undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.redoStack.push(cloneSpec(this.spec));
    this.spec = prev;
    this.sel = null;
    this.renderPanel();
    this.draw();
  }
  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.history.push(cloneSpec(this.spec));
    this.spec = next;
    this.sel = null;
    this.renderPanel();
    this.draw();
  }

  private drawTop(): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    this.fit();

    const wl = this.sampleLoop(18);
    const loop = wl.map((p) => this.toScreen(p.x, p.z));

    // road band (thick translucent stroke of the centre-line)
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(120, 150, 200, 0.18)";
    ctx.lineWidth = Math.max(2, this.spec.roadHalfWidth * 2 * this.scale);
    this.strokeClosed(loop);

    // centre line
    ctx.strokeStyle = "rgba(120, 200, 255, 0.7)";
    ctx.lineWidth = 1.5;
    this.strokeClosed(loop);

    // pads — drawn at their actual spot on the road (t + lateral offset), with a
    // direction arrow pointing the way they shoot you (along track travel).
    const np = wl.length;
    this.spec.pads.forEach((pad, i) => {
      const wp = this.padPos(pad, wl);
      const at = this.toScreen(wp.x, wp.z);
      const selected = this.sel?.type === "pad" && this.sel.index === i;
      const color = pad.kind === "boost" ? "#ffcf3d" : "#3dff84";

      // shoot direction = track forward at this pad (screen space)
      const idx = Math.floor(pad.t * np) % np;
      const sa = this.toScreen(wl[(idx - 1 + np) % np].x, wl[(idx - 1 + np) % np].z);
      const sb = this.toScreen(wl[(idx + 1) % np].x, wl[(idx + 1) % np].z);
      let dx = sb.x - sa.x, dy = sb.z - sa.z;
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      const len = selected ? 30 : 24;
      const tx = at.x + dx * len, ty = at.z + dy * len;
      ctx.strokeStyle = color;
      ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(at.x, at.z);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const ang = Math.atan2(dy, dx);
      const ah = selected ? 9 : 7;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ah * Math.cos(ang - 0.5), ty - ah * Math.sin(ang - 0.5));
      ctx.lineTo(tx - ah * Math.cos(ang + 0.5), ty - ah * Math.sin(ang + 0.5));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      // pad dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(at.x, at.z, selected ? 9 : 6, 0, Math.PI * 2);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    // control points
    this.spec.points.forEach((p, i) => {
      const s = this.toScreen(p[0], p[2]);
      const selected = this.sel?.type === "point" && this.sel.index === i;
      ctx.fillStyle = i === 0 ? "#d7ff37" : selected ? "#ff1e5a" : "#ffffff";
      ctx.beginPath();
      ctx.arc(s.x, s.z, selected ? 8 : 5.5, 0, Math.PI * 2);
      ctx.fill();
      if (i === 0) {
        ctx.fillStyle = "#0a0a0c";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("S", s.x, s.z);
      }
    });
  }

  private strokeClosed(pts: Pt[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
    ctx.closePath();
    ctx.stroke();
  }

  // ---- side-on elevation view ---------------------------------------------

  // Big vertical range so authored hills/drops actually read as dramatic
  // elevation changes (the old ±30 made even a full-range drop feel tiny next to
  // the track's huge horizontal scale).
  private static readonly Y_MIN = -160;
  private static readonly Y_MAX = 160;

  /** Cumulative XZ distance to each control point, normalised 0..1 over the
   * full closed loop — the x-axis of the elevation profile. */
  private progressX(): number[] {
    const p = this.spec.points;
    const n = p.length;
    const cum = [0];
    let total = 0;
    for (let i = 1; i < n; i++) {
      total += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]);
      cum.push(total);
    }
    total += Math.hypot(p[0][0] - p[n - 1][0], p[0][2] - p[n - 1][2]) || 1;
    return cum.map((c) => c / total);
  }

  private sideX(frac: number): number {
    const pad = 18;
    return pad + frac * (this.side.clientWidth - pad * 2);
  }
  private sideY(height: number): number {
    const pad = 14;
    const h = this.side.clientHeight;
    const t = (height - Editor.Y_MIN) / (Editor.Y_MAX - Editor.Y_MIN);
    return h - pad - t * (h - pad * 2); // higher Y = higher on screen
  }
  private sideToHeight(sy: number): number {
    const pad = 14;
    const h = this.side.clientHeight;
    const t = (h - pad - sy) / (h - pad * 2);
    return Math.max(Editor.Y_MIN, Math.min(Editor.Y_MAX, Editor.Y_MIN + t * (Editor.Y_MAX - Editor.Y_MIN)));
  }

  private drawSide(): void {
    const ctx = this.sideCtx;
    const w = this.side.clientWidth;
    const h = this.side.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // zero baseline
    const zeroY = this.sideY(0);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();

    const fx = this.progressX();
    const pts = this.spec.points.map((p, i) => ({ x: this.sideX(fx[i]), y: this.sideY(p[1]) }));

    // profile line
    ctx.strokeStyle = "rgba(120,200,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();

    // handles
    pts.forEach((p, i) => {
      const selected = this.sel?.type === "point" && this.sel.index === i;
      ctx.fillStyle = i === 0 ? "#d7ff37" : selected ? "#ff1e5a" : "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, selected ? 7 : 4.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private bindSide(): void {
    const hit = (sx: number, sy: number): number => {
      const fx = this.progressX();
      for (let i = 0; i < this.spec.points.length; i++) {
        const hx = this.sideX(fx[i]);
        const hy = this.sideY(this.spec.points[i][1]);
        if ((hx - sx) ** 2 + (hy - sy) ** 2 < 169) return i;
      }
      return -1;
    };
    this.side.addEventListener("pointerdown", (e) => {
      const rect = this.side.getBoundingClientRect();
      const i = hit(e.clientX - rect.left, e.clientY - rect.top);
      if (i < 0) return;
      this.sel = { type: "point", index: i };
      this.vDragging = true;
      this.side.setPointerCapture(e.pointerId);
      this.renderPanel();
      this.draw();
    });
    this.side.addEventListener("pointermove", (e) => {
      if (!this.vDragging || this.sel?.type !== "point") return;
      if (!this.gestureSaved) {
        this.pushHistory();
        this.gestureSaved = true;
      }
      const rect = this.side.getBoundingClientRect();
      this.spec.points[this.sel.index][1] = Math.round(this.sideToHeight(e.clientY - rect.top));
      this.draw();
      // keep the height slider in sync if it's showing
      const hv = this.panel.querySelector("#ed-hv");
      const hs = this.panel.querySelector<HTMLInputElement>("#ed-h");
      if (hv) hv.textContent = String(this.spec.points[this.sel.index][1]);
      if (hs) hs.value = String(this.spec.points[this.sel.index][1]);
    });
    const end = (e: PointerEvent) => {
      if (this.vDragging) {
        this.vDragging = false;
        this.gestureSaved = false;
        this.side.releasePointerCapture?.(e.pointerId);
      }
    };
    this.side.addEventListener("pointerup", end);
    this.side.addEventListener("pointercancel", end);
  }

  // ---- interaction ---------------------------------------------------------

  private bindCanvas(): void {
    const hitPoint = (sx: number, sy: number): number => {
      for (let i = 0; i < this.spec.points.length; i++) {
        const s = this.toScreen(this.spec.points[i][0], this.spec.points[i][2]);
        if ((s.x - sx) ** 2 + (s.z - sy) ** 2 < 144) return i;
      }
      return -1;
    };
    const hitPad = (sx: number, sy: number): number => {
      const wl = this.sampleLoop(18);
      for (let i = 0; i < this.spec.pads.length; i++) {
        const wp = this.padPos(this.spec.pads[i], wl);
        const at = this.toScreen(wp.x, wp.z);
        if ((at.x - sx) ** 2 + (at.z - sy) ** 2 < 169) return i;
      }
      return -1;
    };

    this.canvas.addEventListener("pointerdown", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = this.toWorld(sx, sy);

      if (this.tool === "point") {
        this.insertPoint(world);
        return;
      }
      if (this.tool === "boost" || this.tool === "jump") {
        this.addPad(this.tool, world);
        this.tool = "select";
        this.renderPanel();
        return;
      }
      // select tool: points take priority, then pads. Both are draggable.
      const pi = hitPoint(sx, sy);
      if (pi >= 0) {
        this.sel = { type: "point", index: pi };
        this.dragging = true;
        this.canvas.setPointerCapture(e.pointerId);
      } else {
        const di = hitPad(sx, sy);
        this.sel = di >= 0 ? { type: "pad", index: di } : null;
        if (di >= 0) {
          this.dragging = true;
          this.canvas.setPointerCapture(e.pointerId);
        }
      }
      this.renderPanel();
      this.draw();
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging || !this.sel) return;
      if (!this.gestureSaved) {
        this.pushHistory();
        this.gestureSaved = true;
      }
      const rect = this.canvas.getBoundingClientRect();
      const world = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (this.sel.type === "point") {
        const p = this.spec.points[this.sel.index];
        p[0] = Math.round(world.x);
        p[2] = Math.round(world.z);
      } else {
        // drag the pad anywhere on the road: update both t and lateral offset
        const { t, offset } = this.locate(world);
        const pad = this.spec.pads[this.sel.index];
        pad.t = t;
        pad.offset = offset;
      }
      this.draw();
    });

    const endDrag = (e: PointerEvent) => {
      if (this.dragging) {
        this.dragging = false;
        this.gestureSaved = false;
        this.canvas.releasePointerCapture?.(e.pointerId);
        if (this.sel?.type === "pad") this.renderPanel(); // sync offset slider
      }
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  }

  private insertPoint(world: Pt): void {
    this.pushHistory();
    // insert after the control point nearest the click
    const p = this.spec.points;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < p.length; i++) {
      const d = (p[i][0] - world.x) ** 2 + (p[i][2] - world.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    p.splice(best + 1, 0, [Math.round(world.x), p[best][1], Math.round(world.z)]);
    this.sel = { type: "point", index: best + 1 };
    this.tool = "select";
    this.renderPanel();
    this.draw();
  }

  private addPad(kind: "boost" | "jump", world: Pt): void {
    this.pushHistory();
    const { t, offset } = this.locate(world);
    const pad: PadSpec = { kind, t, offset };
    if (kind === "jump") pad.power = 1;
    this.spec.pads.push(pad);
    this.sel = { type: "pad", index: this.spec.pads.length - 1 };
    this.draw();
  }

  private deleteSelected(): void {
    if (!this.sel) return;
    if (this.sel.type === "point") {
      if (this.spec.points.length <= 4) return; // need a valid loop
      this.pushHistory();
      this.spec.points.splice(this.sel.index, 1);
    } else {
      this.pushHistory();
      this.spec.pads.splice(this.sel.index, 1);
    }
    this.sel = null;
    this.renderPanel();
    this.draw();
  }

  // ---- side panel ----------------------------------------------------------

  private renderPanel(): void {
    const toolBtn = (id: Tool, label: string) =>
      `<button class="vd-ed-tool ${this.tool === id ? "on" : ""}" data-tool="${id}">${label}</button>`;

    let selHtml = `<p class="vd-ed-hint">Select a point or pad to edit it.</p>`;
    if (this.sel?.type === "point") {
      const p = this.spec.points[this.sel.index];
      selHtml = `
        <div class="vd-ed-sel">
          <div class="vd-ed-row"><span>POINT ${this.sel.index}${this.sel.index === 0 ? " (START)" : ""}</span></div>
          <label>HEIGHT <input type="range" id="ed-h" min="-160" max="160" step="2" value="${p[1]}"><b id="ed-hv">${p[1]}</b></label>
          <label>TILT <input type="range" id="ed-b" min="-45" max="45" step="1" value="${p[3] ?? 0}"><b id="ed-bv">${p[3] ?? 0}°</b></label>
          <button class="vd-ed-del">DELETE POINT</button>
        </div>`;
    } else if (this.sel?.type === "pad") {
      const pad = this.spec.pads[this.sel.index];
      selHtml = `
        <div class="vd-ed-sel">
          <div class="vd-ed-row"><span>${pad.kind.toUpperCase()} PAD</span></div>
          <label>OFFSET <input type="range" id="ed-o" min="-1" max="1" step="0.05" value="${pad.offset}"><b id="ed-ov">${pad.offset.toFixed(2)}</b></label>
          ${pad.kind === "jump" ? `<label>POWER <input type="range" id="ed-p" min="0.3" max="3" step="0.1" value="${pad.power ?? 1}"><b id="ed-pv">${(pad.power ?? 1).toFixed(1)}</b></label>` : ""}
          <button class="vd-ed-del">DELETE PAD</button>
        </div>`;
    }

    this.panel.innerHTML = `
      <h2 class="vd-ed-title">TRACK EDITOR</h2>
      <div class="vd-ed-tools">
        ${toolBtn("select", "✋ Select")}
        ${toolBtn("point", "＋ Point")}
        ${toolBtn("boost", "● Boost")}
        ${toolBtn("jump", "▲ Jump")}
      </div>
      <label class="vd-ed-width">ROAD WIDTH <input type="range" id="ed-w" min="20" max="120" step="2" value="${this.spec.roadHalfWidth}"><b id="ed-wv">${this.spec.roadHalfWidth}</b></label>
      <p class="vd-ed-keys">P add point · B boost · J jump · V select · Del remove · Ctrl+Z undo</p>
      ${selHtml}
      <div class="vd-ed-actions">
        <button class="vd-ed-test start-btn">▶ TEST DRIVE</button>
        <div class="vd-ed-actions-row">
          <button class="vd-ed-save">SAVE</button>
          <button class="vd-ed-load">LOAD</button>
          <button class="vd-ed-reset">RESET</button>
        </div>
        <div class="vd-ed-actions-row">
          <button class="vd-ed-export">⬇ EXPORT</button>
          <button class="vd-ed-import">⬆ IMPORT</button>
        </div>
        <button class="vd-ed-back back-btn">‹ BACK TO MENU</button>
      </div>`;

    this.panel.querySelectorAll<HTMLButtonElement>(".vd-ed-tool").forEach((b) =>
      b.addEventListener("click", () => {
        this.tool = b.dataset.tool as Tool;
        if (this.tool !== "select") this.sel = null;
        this.renderPanel();
        this.draw();
      })
    );
    const wire = (id: string, valId: string, fn: (v: number) => void, fmt: (v: number) => string) => {
      const el = this.panel.querySelector<HTMLInputElement>(id);
      // snapshot once when the slider is grabbed, so undo restores the pre-drag value
      el?.addEventListener("pointerdown", () => this.pushHistory());
      el?.addEventListener("input", () => {
        const v = parseFloat(el.value);
        fn(v);
        const out = this.panel.querySelector(valId);
        if (out) out.textContent = fmt(v);
        this.draw();
      });
    };
    wire("#ed-w", "#ed-wv", (v) => (this.spec.roadHalfWidth = v), (v) => String(v));
    if (this.sel?.type === "point") {
      wire("#ed-h", "#ed-hv", (v) => (this.spec.points[this.sel!.index][1] = v), (v) => String(v));
      wire("#ed-b", "#ed-bv", (v) => (this.spec.points[this.sel!.index][3] = v), (v) => `${v}°`);
    }
    if (this.sel?.type === "pad") {
      wire("#ed-o", "#ed-ov", (v) => (this.spec.pads[this.sel!.index].offset = v), (v) => v.toFixed(2));
      wire("#ed-p", "#ed-pv", (v) => (this.spec.pads[this.sel!.index].power = v), (v) => v.toFixed(1));
    }
    this.panel.querySelector(".vd-ed-del")?.addEventListener("click", () => this.deleteSelected());
    this.panel.querySelector(".vd-ed-test")!.addEventListener("click", () => this.onTest(cloneSpec(this.spec)));
    this.panel.querySelector(".vd-ed-save")!.addEventListener("click", () => {
      saveCustomTrack(this.spec);
      this.flash(".vd-ed-save", "SAVED");
    });
    this.panel.querySelector(".vd-ed-load")!.addEventListener("click", () => {
      this.pushHistory();
      this.spec = loadCustomTrack() ?? baseSpec();
      this.sel = null;
      this.preview3d.resetFraming();
      this.renderPanel();
      this.draw();
    });
    this.panel.querySelector(".vd-ed-reset")!.addEventListener("click", () => {
      this.pushHistory();
      this.spec = baseSpec();
      this.sel = null;
      this.preview3d.resetFraming();
      this.renderPanel();
      this.draw();
    });
    this.panel.querySelector(".vd-ed-export")!.addEventListener("click", () => {
      this.onExport(cloneSpec(this.spec));
      this.flash(".vd-ed-export", "EXPORTED");
    });
    this.panel.querySelector(".vd-ed-import")!.addEventListener("click", () => this.fileInput.click());
    this.panel.querySelector(".vd-ed-back")!.addEventListener("click", () => this.onExit());
  }

  /** Editor keyboard shortcuts (only while the editor is open). */
  private onKey(e: KeyboardEvent): void {
    if (this.root.style.display === "none") return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === "y") {
      e.preventDefault();
      this.redo();
      return;
    }
    if (e.ctrlKey || e.metaKey) return; // leave other Ctrl combos to the browser
    if (k === "delete" || k === "backspace") {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    const tools: Record<string, Tool> = { p: "point", b: "boost", j: "jump", v: "select", escape: "select" };
    const t = tools[k];
    if (t) {
      this.tool = t;
      if (t !== "select") this.sel = null;
      this.renderPanel();
      this.draw();
    }
  }

  private async handleImport(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = ""; // allow re-importing the same file
    if (!file) return;
    const spec = await this.onImport(file);
    if (spec) {
      this.pushHistory();
      this.spec = spec;
      this.sel = null;
      this.tool = "select";
      this.preview3d.resetFraming();
      this.renderPanel();
      this.draw();
    } else {
      this.flash(".vd-ed-import", "FAILED");
    }
  }

  private flash(sel: string, text: string): void {
    const b = this.panel.querySelector<HTMLButtonElement>(sel);
    if (!b) return;
    const prev = b.textContent;
    b.textContent = text;
    setTimeout(() => {
      if (b.textContent === text) b.textContent = prev;
    }, 900);
  }
}
