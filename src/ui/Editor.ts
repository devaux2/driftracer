import type { TrackSpec, PadSpec } from "../config/tracks";
import { baseSpec, cloneSpec, loadCustomTrack, saveCustomTrack } from "../track/customTrack";

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

  private spec: TrackSpec = baseSpec();
  private tool: Tool = "select";
  private sel: Sel = null;

  // world→screen transform (recomputed each render to keep the track in view)
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private dragging = false;
  private vDragging = false;

  constructor(
    container: HTMLElement,
    private onTest: (spec: TrackSpec) => void,
    private onExit: () => void,
    private onExport: (spec: TrackSpec) => void
  ) {
    this.root = document.createElement("div");
    this.root.className = "vd-editor overlay";
    this.root.style.display = "none";

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

    this.panel = document.createElement("div");
    this.panel.className = "vd-ed-panel";

    this.root.append(views, this.panel);
    container.appendChild(this.root);
    this.ctx = this.canvas.getContext("2d")!;
    this.sideCtx = this.side.getContext("2d")!;

    this.bindCanvas();
    this.bindSide();
    window.addEventListener("resize", () => {
      if (this.root.style.display !== "none") this.resize();
    });
  }

  // ---- lifecycle -----------------------------------------------------------

  open(): void {
    this.spec = loadCustomTrack() ?? baseSpec();
    this.tool = "select";
    this.sel = null;
    this.root.style.display = "";
    this.resize();
    this.renderPanel();
  }

  close(): void {
    this.root.style.display = "none";
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

  /** Nearest parameter t (0..1) on the sampled loop to a world point. */
  private nearestT(world: Pt): number {
    const pts = this.sampleLoop(8);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i].x - world.x) ** 2 + (pts[i].z - world.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best / pts.length;
  }

  // ---- rendering -----------------------------------------------------------

  private draw(): void {
    this.drawTop();
    this.drawSide();
  }

  private drawTop(): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    this.fit();

    const loop = this.sampleLoop(18).map((p) => this.toScreen(p.x, p.z));

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

    // pads
    this.spec.pads.forEach((pad, i) => {
      const idx = Math.floor(pad.t * loop.length) % loop.length;
      const at = loop[idx];
      const selected = this.sel?.type === "pad" && this.sel.index === i;
      ctx.fillStyle = pad.kind === "boost" ? "#ffcf3d" : "#3dff84";
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

  private static readonly Y_MIN = -30;
  private static readonly Y_MAX = 30;

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
      const loop = this.sampleLoop(18).map((p) => this.toScreen(p.x, p.z));
      for (let i = 0; i < this.spec.pads.length; i++) {
        const idx = Math.floor(this.spec.pads[i].t * loop.length) % loop.length;
        const at = loop[idx];
        if ((at.x - sx) ** 2 + (at.z - sy) ** 2 < 144) return i;
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
        this.addPad(this.tool, this.nearestT(world));
        this.tool = "select";
        this.renderPanel();
        return;
      }
      // select tool: points take priority, then pads
      const pi = hitPoint(sx, sy);
      if (pi >= 0) {
        this.sel = { type: "point", index: pi };
        this.dragging = true;
        this.canvas.setPointerCapture(e.pointerId);
      } else {
        const di = hitPad(sx, sy);
        this.sel = di >= 0 ? { type: "pad", index: di } : null;
      }
      this.renderPanel();
      this.draw();
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging || this.sel?.type !== "point") return;
      const rect = this.canvas.getBoundingClientRect();
      const world = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      const p = this.spec.points[this.sel.index];
      p[0] = Math.round(world.x);
      p[2] = Math.round(world.z);
      this.draw();
    });

    const endDrag = (e: PointerEvent) => {
      if (this.dragging) {
        this.dragging = false;
        this.canvas.releasePointerCapture?.(e.pointerId);
      }
    };
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  }

  private insertPoint(world: Pt): void {
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

  private addPad(kind: "boost" | "jump", t: number): void {
    const pad: PadSpec = { kind, t, offset: 0 };
    if (kind === "jump") pad.power = 1;
    this.spec.pads.push(pad);
    this.sel = { type: "pad", index: this.spec.pads.length - 1 };
    this.draw();
  }

  private deleteSelected(): void {
    if (!this.sel) return;
    if (this.sel.type === "point") {
      if (this.spec.points.length <= 4) return; // need a valid loop
      this.spec.points.splice(this.sel.index, 1);
    } else {
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
          <label>HEIGHT <input type="range" id="ed-h" min="-30" max="30" step="1" value="${p[1]}"><b id="ed-hv">${p[1]}</b></label>
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
      ${selHtml}
      <div class="vd-ed-actions">
        <button class="vd-ed-test start-btn">▶ TEST DRIVE</button>
        <div class="vd-ed-actions-row">
          <button class="vd-ed-save">SAVE</button>
          <button class="vd-ed-load">LOAD</button>
          <button class="vd-ed-reset">RESET</button>
        </div>
        <button class="vd-ed-export">⬇ EXPORT .OBJ</button>
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
      el?.addEventListener("input", () => {
        const v = parseFloat(el.value);
        fn(v);
        const out = this.panel.querySelector(valId);
        if (out) out.textContent = fmt(v);
        this.draw();
      });
    };
    wire("#ed-w", "#ed-wv", (v) => (this.spec.roadHalfWidth = v), (v) => String(v));
    if (this.sel?.type === "point")
      wire("#ed-h", "#ed-hv", (v) => (this.spec.points[this.sel!.index][1] = v), (v) => String(v));
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
      this.spec = loadCustomTrack() ?? baseSpec();
      this.sel = null;
      this.renderPanel();
      this.draw();
    });
    this.panel.querySelector(".vd-ed-reset")!.addEventListener("click", () => {
      this.spec = baseSpec();
      this.sel = null;
      this.renderPanel();
      this.draw();
    });
    this.panel.querySelector(".vd-ed-export")!.addEventListener("click", () => {
      this.onExport(cloneSpec(this.spec));
      this.flash(".vd-ed-export", "EXPORTED");
    });
    this.panel.querySelector(".vd-ed-back")!.addEventListener("click", () => this.onExit());
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
