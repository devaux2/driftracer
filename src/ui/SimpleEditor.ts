import type { ControlPoint, PadSpec, TrackSpec } from "../config/tracks";
import { saveCustomTrack } from "../track/customTrack";
import { EditorPreview3D } from "./EditorPreview3D";
import { logoMark } from "./marks";

/**
 * TRACK BUILDER · SIMPLE — a grid track painter, the controller-first companion
 * to the freeform point editor (TRACK BUILDER · COMPLEX). You grow the track one
 * cell at a time on a grid: move N/E/S/W (D-pad / arrows / click) and the track
 * follows, auto-rounding corners through the Catmull-Rom spline. Return to the
 * start cell to close the loop. Always a single, non-crossing connected path, so
 * it's hard to make an invalid track. Per-cell elevation gives hills; a cell can
 * carry a boost or jump pad.
 */

interface Cell {
  c: number; // column
  r: number; // row
  y: number; // elevation (world units)
  pad?: "boost" | "jump";
}

const GRID = 15; // cells per side (odd → integer centre)
const CELL = 240; // world units per cell
const LIFT = 90; // elevation step per raise/lower
const HALF_WIDTH = 44;

export class SimpleEditor {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private info: HTMLDivElement;
  private preview3d: EditorPreview3D;

  private path: Cell[] = [];
  private spec: TrackSpec = this.emptySpec();
  // grid→canvas mapping from the last draw (for click hit-testing)
  private fit = { ox: 0, oy: 0, cw: 1 };

  private padPrev = new Map<number, Record<string, boolean>>();

  constructor(
    container: HTMLElement,
    private onTest: (spec: TrackSpec) => void,
    private onExit: () => void
  ) {
    this.root = document.createElement("div");
    this.root.className = "vd-mm overlay";
    this.root.style.display = "none";

    this.root.innerHTML = `
      <header class="vd-mm-top">
        <div class="vd-brand vd-brand--garage">
          <span class="vd-badge">${logoMark()}</span>
          <span>
            <span class="vd-brand-name">TRACK BUILDER</span>
            <span class="vd-brand-jp">シンプル · SIMPLE</span>
          </span>
        </div>
        <p class="vd-mm-hint">Grow the track on the grid: <b>↑ ↓ ← →</b> (or click a neighbouring cell) lays the next piece; head back over the last cell to undo. Return to the <b>start</b> to close the loop. <b>RB/LB</b> raise/lower · <b>X</b> boost · <b>Y</b> jump · <b>START</b> test.</p>
      </header>

      <div class="vd-mm-body">
        <div class="vd-mm-plan">
          <span class="vd-mm-label">GRID ▸ build here</span>
          <canvas class="vd-mm-canvas"></canvas>
        </div>
        <div class="vd-mm-3d">
          <span class="vd-mm-label">LIVE 3D ▸ drag to orbit</span>
          <canvas class="vd-mm-3dcanvas"></canvas>
        </div>
      </div>

      <footer class="vd-mm-bar">
        <div class="vd-mm-actions-l">
          <button class="vd-mm-btn vd-mm-undo">↶ UNDO</button>
          <button class="vd-mm-btn vd-mm-up">⤒ RAISE</button>
          <button class="vd-mm-btn vd-mm-down">⤓ LOWER</button>
          <button class="vd-mm-btn vd-mm-boost">● BOOST</button>
          <button class="vd-mm-btn vd-mm-jump">▲ JUMP</button>
          <button class="vd-mm-btn vd-mm-clear">✕ CLEAR</button>
        </div>
        <div class="vd-mm-info"></div>
        <div class="vd-mm-actions-r">
          <button class="vd-mm-btn vd-mm-test">▶ TEST DRIVE</button>
          <button class="vd-mm-btn vd-mm-save">SAVE</button>
          <button class="vd-mm-btn vd-mm-back">‹ BACK</button>
        </div>
      </footer>`;

    container.appendChild(this.root);

    this.canvas = this.root.querySelector(".vd-mm-canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.info = this.root.querySelector(".vd-mm-info")!;
    const c3d = this.root.querySelector<HTMLCanvasElement>(".vd-mm-3dcanvas")!;
    this.preview3d = new EditorPreview3D(c3d);

    this.canvas.addEventListener("pointerdown", (e) => this.onCanvasClick(e));
    this.root.querySelector(".vd-mm-undo")!.addEventListener("click", () => this.undo());
    this.root.querySelector(".vd-mm-up")!.addEventListener("click", () => this.lift(1));
    this.root.querySelector(".vd-mm-down")!.addEventListener("click", () => this.lift(-1));
    this.root.querySelector(".vd-mm-boost")!.addEventListener("click", () => this.tagHead("boost"));
    this.root.querySelector(".vd-mm-jump")!.addEventListener("click", () => this.tagHead("jump"));
    this.root.querySelector(".vd-mm-clear")!.addEventListener("click", () => this.clear());
    this.root.querySelector(".vd-mm-test")!.addEventListener("click", () => this.test());
    this.root.querySelector(".vd-mm-save")!.addEventListener("click", () => this.save());
    this.root.querySelector(".vd-mm-back")!.addEventListener("click", () => this.onExit());

    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("resize", () => {
      if (this.root.style.display !== "none") this.resize();
    });
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        if (this.root.style.display !== "none") this.resize();
      });
      ro.observe(this.root);
    }
  }

  // ---- lifecycle -----------------------------------------------------------

  open(): void {
    if (this.path.length === 0) this.path = [{ c: (GRID - 1) / 2, r: (GRID - 1) / 2, y: 0 }];
    this.root.style.display = "";
    this.preview3d.setActive(true);
    this.preview3d.resetFraming();
    this.refresh();
    this.resize();
  }

  close(): void {
    this.root.style.display = "none";
    this.preview3d.setActive(false);
  }

  resume(): void {
    this.open();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor((this.canvas.clientWidth || 1) * dpr));
    this.canvas.height = Math.max(1, Math.floor((this.canvas.clientHeight || 1) * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.preview3d.resize();
    this.draw();
  }

  // ---- path ops ------------------------------------------------------------

  private head(): Cell {
    return this.path[this.path.length - 1];
  }

  private indexOf(c: number, r: number): number {
    return this.path.findIndex((p) => p.c === c && p.r === r);
  }

  private closed(): boolean {
    if (this.path.length < 4) return false;
    const h = this.head();
    const s = this.path[0];
    return Math.abs(h.c - s.c) + Math.abs(h.r - s.r) === 1;
  }

  /** Grow toward an orthogonally-adjacent cell: extend, undo (back over the
   * previous cell), or close (onto the start). */
  private step(c: number, r: number): void {
    const h = this.head();
    if (Math.abs(c - h.c) + Math.abs(r - h.r) !== 1) return; // not a neighbour
    if (c < 0 || r < 0 || c >= GRID || r >= GRID) return;
    // backing onto the previous cell undoes
    if (this.path.length >= 2) {
      const prev = this.path[this.path.length - 2];
      if (prev.c === c && prev.r === r) {
        this.path.pop();
        this.refresh();
        return;
      }
    }
    const existing = this.indexOf(c, r);
    if (existing === 0 && this.path.length >= 3) {
      // returning to start closes the loop (head ends adjacent to start)
      this.refresh();
      return;
    }
    if (existing !== -1) return; // can't cross the track
    this.path.push({ c, r, y: h.y });
    this.refresh();
  }

  private undo(): void {
    if (this.path.length > 1) this.path.pop();
    this.refresh();
  }

  private clear(): void {
    this.path = [{ c: (GRID - 1) / 2, r: (GRID - 1) / 2, y: 0 }];
    this.refresh();
  }

  private lift(dir: number): void {
    this.head().y += dir * LIFT;
    this.refresh();
  }

  private tagHead(pad: "boost" | "jump"): void {
    const h = this.head();
    h.pad = h.pad === pad ? undefined : pad;
    this.refresh();
  }

  private test(): void {
    if (!this.closed()) return;
    this.onTest(this.spec);
  }

  private save(): void {
    if (!this.closed()) return;
    saveCustomTrack(this.spec);
    const el = this.root.querySelector<HTMLButtonElement>(".vd-mm-save")!;
    const prev = el.textContent;
    el.textContent = "SAVED ✓";
    window.setTimeout(() => (el.textContent = prev), 1100);
  }

  // ---- track generation ----------------------------------------------------

  private cellWorld(cell: Cell): { x: number; z: number } {
    return { x: (cell.c - (GRID - 1) / 2) * CELL, z: (cell.r - (GRID - 1) / 2) * CELL };
  }

  private generate(): TrackSpec {
    const pts: ControlPoint[] = [];
    const pads: PadSpec[] = [];
    this.path.forEach((cell, i) => {
      const w = this.cellWorld(cell);
      pts.push([Math.round(w.x), Math.round(cell.y), Math.round(w.z)]);
      if (cell.pad) {
        const t = i / this.path.length;
        pads.push(
          cell.pad === "jump"
            ? { kind: "jump", t, offset: 0, power: 1.4 }
            : { kind: "boost", t, offset: 0 }
        );
      }
    });
    return { id: "custom", name: "CUSTOM TRACK", roadHalfWidth: HALF_WIDTH, points: pts, pads };
  }

  private emptySpec(): TrackSpec {
    return { id: "custom", name: "CUSTOM TRACK", roadHalfWidth: HALF_WIDTH, points: [], pads: [] };
  }

  private refresh(): void {
    this.spec = this.generate();
    this.preview3d.setSpec(this.spec);
    const closed = this.closed();
    const pads = this.spec.pads.length;
    this.info.innerHTML =
      `${this.path.length} CELLS${pads ? ` · ${pads} PADS` : ""} · ` +
      (closed ? `<span class="vd-mm-ok">LOOP CLOSED ✓</span>` : `<span class="vd-mm-warn">return to start to close</span>`);
    this.root.querySelector(".vd-mm-test")!.classList.toggle("disabled", !closed);
    this.root.querySelector(".vd-mm-save")!.classList.toggle("disabled", !closed);
    this.draw();
  }

  // ---- 2D grid -------------------------------------------------------------

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    ctx.clearRect(0, 0, w, h);

    const pad = 24;
    const cw = (Math.min(w, h) - pad * 2) / GRID;
    const ox = (w - cw * GRID) / 2;
    const oy = (h - cw * GRID) / 2;
    this.fit = { ox, oy, cw };
    const cx = (c: number) => ox + (c + 0.5) * cw;
    const cy = (r: number) => oy + (r + 0.5) * cw;

    // grid dots
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++) {
        ctx.beginPath();
        ctx.arc(cx(c), cy(r), 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

    // highlight the cells you could grow into next
    const hd = this.head();
    if (hd) {
      ctx.fillStyle = "rgba(0,215,242,0.10)";
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const nc = hd.c + dc,
          nr = hd.r + dr;
        if (nc < 0 || nr < 0 || nc >= GRID || nr >= GRID) continue;
        if (this.indexOf(nc, nr) !== -1 && !(nc === this.path[0].c && nr === this.path[0].r)) continue;
        ctx.fillRect(ox + nc * cw + 2, oy + nr * cw + 2, cw - 4, cw - 4);
      }
    }

    // the track ribbon through cell centres (closed if the loop is closed)
    if (this.path.length >= 2) {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = Math.max(6, cw * 0.5);
      ctx.beginPath();
      ctx.moveTo(cx(this.path[0].c), cy(this.path[0].r));
      for (let i = 1; i < this.path.length; i++) ctx.lineTo(cx(this.path[i].c), cy(this.path[i].r));
      if (this.closed()) ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,215,242,0.75)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // elevation tags
    ctx.font = `${Math.max(8, cw * 0.3)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const cell of this.path) {
      if (cell.y === 0) continue;
      ctx.fillStyle = cell.y > 0 ? "rgba(0,215,242,0.9)" : "rgba(255,90,31,0.9)";
      ctx.fillText(cell.y > 0 ? "▲" : "▼", cx(cell.c), cy(cell.r));
    }

    // pads
    for (const cell of this.path) {
      if (!cell.pad) continue;
      ctx.fillStyle = cell.pad === "boost" ? "#ffcf3d" : "#3dff84";
      ctx.beginPath();
      ctx.arc(cx(cell.c), cy(cell.r), cw * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }

    // start (lime) + head (pink)
    const s = this.path[0];
    ctx.fillStyle = "#d8f600";
    ctx.beginPath();
    ctx.arc(cx(s.c), cy(s.r), cw * 0.22, 0, Math.PI * 2);
    ctx.fill();
    if (this.path.length > 1) {
      ctx.fillStyle = "#f4044e";
      ctx.beginPath();
      ctx.arc(cx(hd.c), cy(hd.r), cw * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- input ---------------------------------------------------------------

  private onCanvasClick(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left - this.fit.ox) / this.fit.cw);
    const r = Math.floor((e.clientY - rect.top - this.fit.oy) / this.fit.cw);
    if (c < 0 || r < 0 || c >= GRID || r >= GRID) return;
    this.step(c, r);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.root.style.display === "none") return;
    const h = this.head();
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        return this.step(h.c, h.r - 1);
      case "ArrowDown":
        e.preventDefault();
        return this.step(h.c, h.r + 1);
      case "ArrowLeft":
        e.preventDefault();
        return this.step(h.c - 1, h.r);
      case "ArrowRight":
        e.preventDefault();
        return this.step(h.c + 1, h.r);
      case "Backspace":
        e.preventDefault();
        return this.undo();
      case "Enter":
        e.preventDefault();
        return this.test();
    }
    if (e.code === "KeyB") return this.tagHead("boost");
    if (e.code === "KeyJ") return this.tagHead("jump");
    if (e.code === "BracketRight") return this.lift(1);
    if (e.code === "BracketLeft") return this.lift(-1);
  }

  /** Polled from Game while open: D-pad grows the track, bumpers change height,
   * X/Y tag pads, START test-drives. */
  tickPad(): void {
    if (this.root.style.display === "none") return;
    const pads = navigator.getGamepads?.() ?? [];
    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (!gp) continue;
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      const now: Record<string, boolean> = {
        up: !!gp.buttons[12]?.pressed || ay < -0.5,
        down: !!gp.buttons[13]?.pressed || ay > 0.5,
        left: !!gp.buttons[14]?.pressed || ax < -0.5,
        right: !!gp.buttons[15]?.pressed || ax > 0.5,
        lb: !!gp.buttons[4]?.pressed,
        rb: !!gp.buttons[5]?.pressed,
        x: !!gp.buttons[2]?.pressed,
        y: !!gp.buttons[3]?.pressed,
        start: !!gp.buttons[9]?.pressed,
        b: !!gp.buttons[1]?.pressed,
      };
      const prev = this.padPrev.get(i) ?? {};
      const edge = (k: string) => now[k] && !prev[k];
      const h = this.head();
      if (edge("up")) this.step(h.c, h.r - 1);
      if (edge("down")) this.step(h.c, h.r + 1);
      if (edge("left")) this.step(h.c - 1, h.r);
      if (edge("right")) this.step(h.c + 1, h.r);
      if (edge("rb")) this.lift(1);
      if (edge("lb")) this.lift(-1);
      if (edge("x")) this.tagHead("boost");
      if (edge("y")) this.tagHead("jump");
      if (edge("start")) this.test();
      if (edge("b")) this.undo();
      this.padPrev.set(i, now);
    }
  }
}
