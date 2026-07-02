import type { ControlPoint, PadSpec, TrackSpec } from "../config/tracks";
import { saveCustomTrack } from "../track/customTrack";
import { EditorPreview3D } from "./EditorPreview3D";
import { logoMark } from "./marks";

/**
 * TRACK BUILDER · TILES — a Tony-Hawk-Create-A-Park-style placer. A cursor roams
 * a grid; you hold a premade part, cycle it with the bumpers, rotate it in 90°
 * steps with the triggers, and place/remove with A/B. Parts link edge-to-edge;
 * the drivable line is traced through the connected parts and, once they form one
 * closed loop, smoothed by the Catmull-Rom spline.
 *
 * Parts:
 *  - STRAIGHT / CORNER — flat shapes.
 *  - RAMP — an elevation connector: it climbs one level toward its arrow (the
 *    "high" edge). Travel the other way and it descends. Levels propagate around
 *    the loop, so the loop must return to its start height to close.
 *  - JUMP — a launch kicker (bakes a jump pad).
 *  - BOOST — a boost strip (bakes a boost pad).
 *
 * Edge indices: 0=N 1=E 2=S 3=W. A part's two connection edges are its base
 * edges rotated by `rot` quarter-turns; a RAMP's uphill ("high") edge is 0 (N)
 * rotated likewise.
 */

type PartType = "straight" | "corner" | "ramp" | "jump" | "boost";
interface Tile {
  type: PartType;
  rot: number; // 0..3 quarter-turns
}
interface Step {
  c: number;
  r: number;
  type: PartType;
  rot: number;
  outEdge: number; // edge we leave this tile through, in travel order
}

const GRID = 15;
const CELL = 240;
const LEVEL_H = 150; // world height per elevation level
const HALF_WIDTH = 44;
const TYPES: PartType[] = ["straight", "corner", "ramp", "jump", "boost"];
const LABELS: Record<PartType, string> = {
  straight: "STRAIGHT",
  corner: "CORNER",
  ramp: "RAMP",
  jump: "JUMP",
  boost: "BOOST",
};
const BASE_EDGES: Record<PartType, [number, number]> = {
  straight: [0, 2],
  corner: [0, 1],
  ramp: [0, 2],
  jump: [0, 2],
  boost: [0, 2],
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
  private current: Tile = { type: "straight", rot: 0 };
  private spec: TrackSpec = this.emptySpec();
  private levelOf = new Map<string, number>(); // centre level per tile when the loop is valid
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
        <p class="vd-mm-hint">Move the cursor <b>↑↓←→ / D-pad</b>. <b>LB/RB</b> cycle part · <b>LT/RT</b> rotate 90° · <b>A</b> place · <b>B</b> remove · <b>START</b> test. Link parts into one closed loop; <b>RAMP</b> climbs toward its arrow, so ramps must return to the start height.</p>
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

  // ---- connectivity + elevation --------------------------------------------

  private edgesOf(t: Tile): [number, number] {
    const [a, b] = BASE_EDGES[t.type];
    return [(a + t.rot) % 4, (b + t.rot) % 4];
  }

  /** A ramp's uphill edge (base N=0, rotated). */
  private highEdge(t: Tile): number {
    return t.rot % 4;
  }

  /** Trace the parts as a single closed loop; returns the ordered steps (with
   * the exit edge of each) or null if they don't form one connected cycle
   * covering every part. */
  private loop(): Step[] | null {
    if (this.tiles.size < 4) return null;
    const firstKey = this.tiles.keys().next().value as string;
    const [sc0, sr0] = firstKey.split(",").map(Number);
    const start = this.tiles.get(firstKey)!;
    const order: Step[] = [];
    let c = sc0,
      r = sr0,
      outEdge = this.edgesOf(start)[0];

    for (let step = 0; step < this.tiles.size + 1; step++) {
      const t = this.tiles.get(key(c, r));
      if (!t) return null;
      order.push({ c, r, type: t.type, rot: t.rot, outEdge });
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

  /** Propagate elevation levels around the loop. A ramp exiting toward its high
   * edge climbs +1, otherwise descends -1; its centre sits at the mid-level.
   * `net` is the level after the whole loop — it must be 0 to close cleanly. */
  private levels(order: Step[]): { centre: number[]; net: number } {
    let level = 0;
    const centre: number[] = [];
    for (const s of order) {
      if (s.type === "ramp") {
        const high = s.rot % 4;
        const exit = level + (s.outEdge === high ? 1 : -1);
        centre.push((level + exit) / 2);
        level = exit;
      } else {
        centre.push(level);
      }
    }
    return { centre, net: level };
  }

  private cellWorld(c: number, r: number): { x: number; z: number } {
    return { x: (c - (GRID - 1) / 2) * CELL, z: (r - (GRID - 1) / 2) * CELL };
  }

  private emptySpec(): TrackSpec {
    return { id: "custom", name: "CUSTOM TRACK", roadHalfWidth: HALF_WIDTH, points: [], pads: [] };
  }

  private refresh(): void {
    const order = this.loop();
    this.levelOf.clear();
    let valid = false;
    let netMsg = "";
    if (order) {
      const { centre, net } = this.levels(order);
      if (net === 0) {
        valid = true;
        const pts: ControlPoint[] = [];
        const pads: PadSpec[] = [];
        order.forEach((s, i) => {
          const w = this.cellWorld(s.c, s.r);
          pts.push([Math.round(w.x), Math.round(centre[i] * LEVEL_H), Math.round(w.z)]);
          this.levelOf.set(key(s.c, s.r), centre[i]);
          const t = i / order.length;
          if (s.type === "jump") pads.push({ kind: "jump", t, offset: 0, power: 1.5 });
          else if (s.type === "boost") pads.push({ kind: "boost", t, offset: 0 });
        });
        this.spec = { id: "custom", name: "CUSTOM TRACK", roadHalfWidth: HALF_WIDTH, points: pts, pads };
        this.preview3d.setSpec(this.spec);
      } else {
        this.spec = this.emptySpec();
        netMsg = ` · <span class="vd-mm-warn">ramps off by ${net > 0 ? "+" : ""}${net} level — return to start height</span>`;
      }
    } else {
      this.spec = this.emptySpec();
    }

    this.info.innerHTML =
      `${this.tiles.size} PARTS · ` +
      (valid ? `<span class="vd-mm-ok">LOOP OK ✓</span>` : `<span class="vd-mm-warn">link into one closed loop</span>${netMsg}`);
    this.root.querySelector(".vd-mm-test")!.classList.toggle("disabled", !valid);
    this.root.querySelector(".vd-mm-save")!.classList.toggle("disabled", !valid);
    this.hold.innerHTML = `HOLDING: <b>${LABELS[this.current.type]}</b> · ${this.current.rot * 90}°`;
    this.draw();
  }

  // ---- drawing -------------------------------------------------------------

  private drawPart(cx: number, cy: number, cw: number, edges: [number, number], color: string, lw: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx + EDGE_D[edges[0]][0] * 0.5 * cw, cy + EDGE_D[edges[0]][1] * 0.5 * cw);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + EDGE_D[edges[1]][0] * 0.5 * cw, cy + EDGE_D[edges[1]][1] * 0.5 * cw);
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

    for (const [k, t] of this.tiles) {
      const [c, r] = k.split(",").map(Number);
      const edges = this.edgesOf(t);
      // tint higher tiles cyan-ward when the loop's levels are known
      const lvl = this.levelOf.get(k);
      const base = lvl !== undefined && lvl > 0 ? `rgba(0,215,242,${Math.min(0.4, 0.14 + lvl * 0.12)})` : "rgba(255,255,255,0.18)";
      this.drawPart(cx(c), cy(r), cw, edges, base, Math.max(6, cw * 0.5));
      this.drawPart(cx(c), cy(r), cw, edges, "rgba(0,215,242,0.75)", 1.5);

      if (t.type === "ramp") {
        // uphill arrow toward the high edge
        const hi = this.highEdge(t);
        const dx = EDGE_D[hi][0],
          dy = EDGE_D[hi][1];
        const tx = cx(c) + dx * cw * 0.34,
          ty = cy(r) + dy * cw * 0.34;
        ctx.strokeStyle = "#d8f600";
        ctx.fillStyle = "#d8f600";
        ctx.lineWidth = 2;
        const ah = cw * 0.14;
        const ang = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - ah * Math.cos(ang - 0.5), ty - ah * Math.sin(ang - 0.5));
        ctx.lineTo(tx - ah * Math.cos(ang + 0.5), ty - ah * Math.sin(ang + 0.5));
        ctx.closePath();
        ctx.fill();
      } else if (t.type === "jump" || t.type === "boost") {
        ctx.fillStyle = t.type === "jump" ? "#3dff84" : "#ffcf3d";
        ctx.beginPath();
        ctx.arc(cx(c), cy(r), cw * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      if (lvl !== undefined && lvl !== 0) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = `${Math.max(8, cw * 0.26)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${lvl > 0 ? "+" : ""}${lvl}`, cx(c), cy(r) + cw * 0.3);
      }
    }

    // ghost of the held part
    const ghostEdges = this.edgesOf(this.current);
    this.drawPart(cx(this.cur.c), cy(this.cur.r), cw, ghostEdges, "rgba(244,4,78,0.7)", Math.max(3, cw * 0.22));

    // cursor box
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
    if (e.code === "Space") {
      e.preventDefault();
      this.test();
    }
  }

  /** Polled from Game while open. */
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
      if (edge("start")) this.test();
      this.padPrev.set(i, now);
    }
  }
}
