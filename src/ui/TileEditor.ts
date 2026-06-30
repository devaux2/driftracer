import type { ControlPoint, PadSpec, TrackSpec } from "../config/tracks";
import { saveCustomTrack } from "../track/customTrack";
import { EditorPreview3D } from "./EditorPreview3D";
import { logoMark } from "./marks";

/**
 * TRACK BUILDER · TILES — a Tony-Hawk-Create-A-Park-style placer. A cursor roams
 * a grid; you hold a premade part (straight / corner), cycle the part with the
 * bumpers, rotate it in 90° steps with the triggers, and place/remove with A/B.
 * Parts snap to the grid; when they link edge-to-edge into one closed loop the
 * track is raceable. The drivable line is traced through the connected parts and
 * smoothed by the Catmull-Rom spline.
 *
 * Edge indices: 0=N 1=E 2=S 3=W. A part's two connection edges are its base
 * edges rotated by `rot` quarter-turns.
 */

type PartType = "straight" | "corner";
interface Tile {
  type: PartType;
  rot: number; // 0..3 quarter-turns
  pad?: "boost" | "jump";
}

const GRID = 15;
const CELL = 240;
const HALF_WIDTH = 44;
const TYPES: PartType[] = ["straight", "corner"];
const BASE_EDGES: Record<PartType, [number, number]> = {
  straight: [0, 2], // N–S
  corner: [0, 1], // N–E
};
const EDGE_D: [number, number][] = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
];
const key = (c: number, r: number) => `${c},${r}`;

export class TileEditor {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private info: HTMLDivElement;
  private hold: HTMLDivElement;
  private preview3d: EditorPreview3D;

  private tiles = new Map<string, Tile>();
  private cur = { c: (GRID - 1) / 2, r: (GRID - 1) / 2 };
  private current: { type: PartType; rot: number } = { type: "straight", rot: 0 };
  private spec: TrackSpec = this.emptySpec();
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
            <span class="vd-brand-jp">タイル · TILES</span>
          </span>
        </div>
        <p class="vd-mm-hint">Move the cursor with <b>↑↓←→ / D-pad</b>. <b>LB/RB</b> cycle the part · <b>LT/RT</b> rotate 90° · <b>A</b> place · <b>B</b> remove · <b>X/Y</b> boost/jump · <b>START</b> test. Link parts edge-to-edge into one closed loop.</p>
      </header>

      <div class="vd-mm-body">
        <div class="vd-mm-plan">
          <span class="vd-mm-label">PARK ▸ place parts</span>
          <canvas class="vd-mm-canvas"></canvas>
          <div class="vd-mm-hold"></div>
        </div>
        <div class="vd-mm-3d">
          <span class="vd-mm-label">LIVE 3D ▸ drag to orbit</span>
          <canvas class="vd-mm-3dcanvas"></canvas>
        </div>
      </div>

      <footer class="vd-mm-bar">
        <div class="vd-mm-actions-l">
          <button class="vd-mm-btn vd-mm-part">⇄ PART</button>
          <button class="vd-mm-btn vd-mm-rot">⟳ ROTATE</button>
          <button class="vd-mm-btn vd-mm-place">＋ PLACE</button>
          <button class="vd-mm-btn vd-mm-remove">✕ REMOVE</button>
          <button class="vd-mm-btn vd-mm-boost">● BOOST</button>
          <button class="vd-mm-btn vd-mm-jump">▲ JUMP</button>
          <button class="vd-mm-btn vd-mm-clear">CLEAR</button>
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
    this.hold = this.root.querySelector(".vd-mm-hold")!;
    const c3d = this.root.querySelector<HTMLCanvasElement>(".vd-mm-3dcanvas")!;
    this.preview3d = new EditorPreview3D(c3d);

    this.canvas.addEventListener("pointerdown", (e) => this.onCanvasClick(e));
    this.root.querySelector(".vd-mm-part")!.addEventListener("click", () => this.cycleType(1));
    this.root.querySelector(".vd-mm-rot")!.addEventListener("click", () => this.rotate(1));
    this.root.querySelector(".vd-mm-place")!.addEventListener("click", () => this.place());
    this.root.querySelector(".vd-mm-remove")!.addEventListener("click", () => this.remove());
    this.root.querySelector(".vd-mm-boost")!.addEventListener("click", () => this.tag("boost"));
    this.root.querySelector(".vd-mm-jump")!.addEventListener("click", () => this.tag("jump"));
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

  // ---- editing -------------------------------------------------------------

  private moveCursor(dc: number, dr: number): void {
    this.cur.c = Math.max(0, Math.min(GRID - 1, this.cur.c + dc));
    this.cur.r = Math.max(0, Math.min(GRID - 1, this.cur.r + dr));
    this.draw();
  }

  private cycleType(dir: number): void {
    const i = TYPES.indexOf(this.current.type);
    this.current.type = TYPES[(i + dir + TYPES.length) % TYPES.length];
    this.refresh();
  }

  private rotate(dir: number): void {
    this.current.rot = (this.current.rot + dir + 4) % 4;
    this.refresh();
  }

  private place(): void {
    this.tiles.set(key(this.cur.c, this.cur.r), { type: this.current.type, rot: this.current.rot });
    this.refresh();
  }

  private remove(): void {
    this.tiles.delete(key(this.cur.c, this.cur.r));
    this.refresh();
  }

  private tag(pad: "boost" | "jump"): void {
    const t = this.tiles.get(key(this.cur.c, this.cur.r));
    if (!t) return;
    t.pad = t.pad === pad ? undefined : pad;
    this.refresh();
  }

  private clear(): void {
    this.tiles.clear();
    this.refresh();
  }

  private test(): void {
    if (this.spec.points.length >= 4) this.onTest(this.spec);
  }

  private save(): void {
    if (this.spec.points.length < 4) return;
    saveCustomTrack(this.spec);
    const el = this.root.querySelector<HTMLButtonElement>(".vd-mm-save")!;
    const prev = el.textContent;
    el.textContent = "SAVED ✓";
    window.setTimeout(() => (el.textContent = prev), 1100);
  }

  // ---- connectivity --------------------------------------------------------

  private edgesOf(t: Tile): [number, number] {
    const [a, b] = BASE_EDGES[t.type];
    return [(a + t.rot) % 4, (b + t.rot) % 4];
  }

  /** Trace the parts as a single closed loop; returns the ordered cells or null
   * if they don't form exactly one connected cycle covering every part. */
  private loop(): { c: number; r: number; pad?: "boost" | "jump" }[] | null {
    if (this.tiles.size < 4) return null;
    const firstKey = this.tiles.keys().next().value as string;
    const [sc0, sr0] = firstKey.split(",").map(Number);
    const start = this.tiles.get(firstKey)!;
    const order: { c: number; r: number; pad?: "boost" | "jump" }[] = [];
    let c = sc0,
      r = sr0,
      outEdge = this.edgesOf(start)[0];

    for (let step = 0; step < this.tiles.size + 1; step++) {
      const t = this.tiles.get(key(c, r));
      if (!t) return null;
      order.push({ c, r, pad: t.pad });
      const [dc, dr] = EDGE_D[outEdge];
      const nc = c + dc,
        nr = r + dr;
      const nt = this.tiles.get(key(nc, nr));
      if (!nt) return null; // dead end
      const inEdge = (outEdge + 2) % 4;
      const ne = this.edgesOf(nt);
      if (ne[0] !== inEdge && ne[1] !== inEdge) return null; // not linked
      const nOut = ne[0] === inEdge ? ne[1] : ne[0];
      c = nc;
      r = nr;
      outEdge = nOut;
      if (c === sc0 && r === sr0) {
        return order.length === this.tiles.size ? order : null; // single full loop
      }
    }
    return null;
  }

  private cellWorld(c: number, r: number): { x: number; z: number } {
    return { x: (c - (GRID - 1) / 2) * CELL, z: (r - (GRID - 1) / 2) * CELL };
  }

  private generate(loop: { c: number; r: number; pad?: "boost" | "jump" }[] | null): TrackSpec {
    const cells = loop ?? [...this.tiles.keys()].map((k) => {
      const [c, r] = k.split(",").map(Number);
      return { c, r, pad: this.tiles.get(k)!.pad };
    });
    const pts: ControlPoint[] = [];
    const pads: PadSpec[] = [];
    cells.forEach((cell, i) => {
      const w = this.cellWorld(cell.c, cell.r);
      pts.push([Math.round(w.x), 0, Math.round(w.z)]);
      if (cell.pad) {
        const t = i / cells.length;
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
    const loop = this.loop();
    this.spec = loop ? this.generate(loop) : this.emptySpec();
    if (this.spec.points.length >= 4) this.preview3d.setSpec(this.spec);
    const valid = !!loop;
    this.info.innerHTML =
      `${this.tiles.size} PARTS · ` +
      (valid ? `<span class="vd-mm-ok">LOOP OK ✓</span>` : `<span class="vd-mm-warn">link into one closed loop</span>`);
    this.root.querySelector(".vd-mm-test")!.classList.toggle("disabled", !valid);
    this.root.querySelector(".vd-mm-save")!.classList.toggle("disabled", !valid);
    this.hold.innerHTML = `HOLDING: <b>${this.current.type.toUpperCase()}</b> · ${this.current.rot * 90}°`;
    this.draw();
  }

  // ---- drawing -------------------------------------------------------------

  /** Edge-midpoint offsets (in cell-widths) for drawing a part's two arms. */
  private armEnds(edges: [number, number]): [number, number][] {
    return edges.map((e) => [EDGE_D[e][0] * 0.5, EDGE_D[e][1] * 0.5]);
  }

  private drawPart(cx: number, cy: number, cw: number, edges: [number, number], color: string, lw: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const arms = this.armEnds(edges);
    ctx.beginPath();
    ctx.moveTo(cx + arms[0][0] * cw, cy + arms[0][1] * cw);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + arms[1][0] * cw, cy + arms[1][1] * cw);
    ctx.stroke();
  }

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

    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++) {
        ctx.beginPath();
        ctx.arc(cx(c), cy(r), 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

    // placed parts (ribbon + cyan centre)
    for (const [k, t] of this.tiles) {
      const [c, r] = k.split(",").map(Number);
      const edges = this.edgesOf(t);
      this.drawPart(cx(c), cy(r), cw, edges, "rgba(255,255,255,0.18)", Math.max(6, cw * 0.5));
      this.drawPart(cx(c), cy(r), cw, edges, "rgba(0,215,242,0.75)", 1.5);
      if (t.pad) {
        ctx.fillStyle = t.pad === "boost" ? "#ffcf3d" : "#3dff84";
        ctx.beginPath();
        ctx.arc(cx(c), cy(r), cw * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ghost of the held part at the cursor
    const ghostEdges = this.edgesOf({ type: this.current.type, rot: this.current.rot });
    this.drawPart(cx(this.cur.c), cy(this.cur.r), cw, ghostEdges, "rgba(244,4,78,0.7)", Math.max(3, cw * 0.22));

    // cursor box
    ctx.strokeStyle = "var(--vd-pink)";
    ctx.strokeStyle = "#f4044e";
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + this.cur.c * cw + 1.5, oy + this.cur.r * cw + 1.5, cw - 3, cw - 3);
  }

  // ---- input ---------------------------------------------------------------

  private onCanvasClick(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left - this.fit.ox) / this.fit.cw);
    const r = Math.floor((e.clientY - rect.top - this.fit.oy) / this.fit.cw);
    if (c < 0 || r < 0 || c >= GRID || r >= GRID) return;
    this.cur.c = c;
    this.cur.r = r;
    // click an empty cell to place; click an occupied cell to remove
    if (this.tiles.has(key(c, r))) this.remove();
    else this.place();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.root.style.display === "none") return;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        return this.moveCursor(0, -1);
      case "ArrowDown":
        e.preventDefault();
        return this.moveCursor(0, 1);
      case "ArrowLeft":
        e.preventDefault();
        return this.moveCursor(-1, 0);
      case "ArrowRight":
        e.preventDefault();
        return this.moveCursor(1, 0);
      case "Enter":
        e.preventDefault();
        return this.place();
      case "Backspace":
        e.preventDefault();
        return this.remove();
    }
    if (e.code === "KeyQ") return this.cycleType(-1);
    if (e.code === "KeyE") return this.cycleType(1);
    if (e.code === "KeyZ") return this.rotate(-1);
    if (e.code === "KeyX") return this.rotate(1);
    if (e.code === "KeyB") return this.tag("boost");
    if (e.code === "KeyJ") return this.tag("jump");
    if (e.code === "Space") {
      e.preventDefault();
      this.test();
    }
  }

  /** Polled from Game while open: D-pad moves cursor, bumpers cycle part,
   * triggers rotate, A place, B remove, X/Y pads, START test. */
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
        lt: (gp.buttons[6]?.value ?? 0) > 0.5,
        rt: (gp.buttons[7]?.value ?? 0) > 0.5,
        a: !!gp.buttons[0]?.pressed,
        b: !!gp.buttons[1]?.pressed,
        x: !!gp.buttons[2]?.pressed,
        y: !!gp.buttons[3]?.pressed,
        start: !!gp.buttons[9]?.pressed,
      };
      const prev = this.padPrev.get(i) ?? {};
      const edge = (k: string) => now[k] && !prev[k];
      if (edge("up")) this.moveCursor(0, -1);
      if (edge("down")) this.moveCursor(0, 1);
      if (edge("left")) this.moveCursor(-1, 0);
      if (edge("right")) this.moveCursor(1, 0);
      if (edge("lb")) this.cycleType(-1);
      if (edge("rb")) this.cycleType(1);
      if (edge("lt")) this.rotate(-1);
      if (edge("rt")) this.rotate(1);
      if (edge("a")) this.place();
      if (edge("b")) this.remove();
      if (edge("x")) this.tag("boost");
      if (edge("y")) this.tag("jump");
      if (edge("start")) this.test();
      this.padPrev.set(i, now);
    }
  }
}
