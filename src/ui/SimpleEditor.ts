import type { ControlPoint, PadSpec, TrackSpec } from "../config/tracks";
import { saveCustomTrack } from "../track/customTrack";
import { EditorPreview3D } from "./EditorPreview3D";
import { logoMark } from "./marks";

/**
 * MAP MAKER — a block/piece track builder, the controller-first counterpart to
 * the freeform point editor. You "drive" the track into existence: each piece
 * appends to the end of the last one, auto-connecting, so the result is always a
 * valid connected ribbon. The loop closes through the Catmull-Rom spline.
 *
 * Core input is directional — Up = straight, Left/Right = curve, Down = undo —
 * which maps cleanly onto a D-pad/stick. Hills and pads are extra buttons. A
 * live 2D plan + 3D preview update as you lay pieces.
 */

type PieceType = "straight" | "left" | "right" | "sharpL" | "sharpR" | "hillUp" | "hillDown";
interface Piece {
  type: PieceType;
  pad?: "boost" | "jump";
}

// Geometry tunables (world units).
const STRAIGHT = 240;
const TURN_STEP = 150; // chord per arc sub-step
const HILL = 110; // elevation delta per hill piece
const HALF_WIDTH = 44;

const PALETTE: { type: PieceType; label: string; key: string }[] = [
  { type: "straight", label: "▲ STRAIGHT", key: "ArrowUp" },
  { type: "left", label: "◀ CURVE L", key: "ArrowLeft" },
  { type: "right", label: "CURVE R ▶", key: "ArrowRight" },
  { type: "sharpL", label: "◀◀ SHARP L", key: "KeyQ" },
  { type: "sharpR", label: "SHARP R ▶▶", key: "KeyE" },
  { type: "hillUp", label: "⤒ HILL UP", key: "KeyW" },
  { type: "hillDown", label: "⤓ HILL DOWN", key: "KeyS" },
];

export class SimpleEditor {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private info: HTMLDivElement;
  private preview3d: EditorPreview3D;

  private pieces: Piece[] = [];
  private spec: TrackSpec = this.emptySpec();

  // Controller edge-detection state.
  private padPrev = new Map<number, Record<string, boolean>>();

  constructor(
    container: HTMLElement,
    private onTest: (spec: TrackSpec) => void,
    private onExit: () => void
  ) {
    this.root = document.createElement("div");
    this.root.className = "vd-mm overlay";
    this.root.style.display = "none";

    const palette = PALETTE.map(
      (p) => `<button class="vd-mm-piece" data-type="${p.type}">${p.label}</button>`
    ).join("");

    this.root.innerHTML = `
      <header class="vd-mm-top">
        <div class="vd-brand vd-brand--garage">
          <span class="vd-badge">${logoMark()}</span>
          <span>
            <span class="vd-brand-name">MAP MAKER</span>
            <span class="vd-brand-jp">マップメーカー · ブロック</span>
          </span>
        </div>
        <p class="vd-mm-hint">Lay the track piece by piece — each one snaps onto the last. <b>↑</b> straight · <b>← →</b> curve · <b>↓</b> undo. Controller: <b>D-pad</b> to lay · <b>LB/RB</b> hills · <b>X</b> boost · <b>Y</b> jump · <b>START</b> test.</p>
      </header>

      <div class="vd-mm-body">
        <div class="vd-mm-plan">
          <span class="vd-mm-label">PLAN ▸ top-down</span>
          <canvas class="vd-mm-canvas"></canvas>
        </div>
        <div class="vd-mm-3d">
          <span class="vd-mm-label">LIVE 3D ▸ drag to orbit</span>
          <canvas class="vd-mm-3dcanvas"></canvas>
        </div>
      </div>

      <div class="vd-mm-palette">${palette}</div>

      <footer class="vd-mm-bar">
        <div class="vd-mm-actions-l">
          <button class="vd-mm-btn vd-mm-undo">↶ UNDO</button>
          <button class="vd-mm-btn vd-mm-boost">● +BOOST</button>
          <button class="vd-mm-btn vd-mm-jump">▲ +JUMP</button>
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

    this.root.querySelectorAll<HTMLButtonElement>(".vd-mm-piece").forEach((b) => {
      b.addEventListener("click", () => this.add(b.dataset.type as PieceType));
    });
    this.root.querySelector(".vd-mm-undo")!.addEventListener("click", () => this.undo());
    this.root.querySelector(".vd-mm-boost")!.addEventListener("click", () => this.tagLast("boost"));
    this.root.querySelector(".vd-mm-jump")!.addEventListener("click", () => this.tagLast("jump"));
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
    if (this.pieces.length === 0) this.pieces = SimpleEditor.defaultLoop();
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

  // ---- piece ops -----------------------------------------------------------

  private add(type: PieceType): void {
    this.pieces.push({ type });
    this.refresh();
  }

  private undo(): void {
    this.pieces.pop();
    this.refresh();
  }

  private clear(): void {
    this.pieces = SimpleEditor.defaultLoop();
    this.refresh();
  }

  /** Drop a boost/jump pad on the most recent piece (toggles off if same). */
  private tagLast(pad: "boost" | "jump"): void {
    const last = this.pieces[this.pieces.length - 1];
    if (!last) return;
    last.pad = last.pad === pad ? undefined : pad;
    this.refresh();
  }

  private test(): void {
    if (this.spec.points.length < 4) return;
    this.onTest(this.spec);
  }

  private save(): void {
    if (this.spec.points.length < 4) return;
    saveCustomTrack(this.spec);
    const el = this.root.querySelector<HTMLButtonElement>(".vd-mm-save")!;
    const prev = el.textContent;
    el.textContent = "SAVED ✓";
    window.setTimeout(() => (el.textContent = prev), 1100);
  }

  // ---- track generation ----------------------------------------------------

  /** Walk the piece chain from the origin, emitting control points + pads. */
  private generate(): TrackSpec {
    const pts: ControlPoint[] = [];
    const pieceIdx: number[] = []; // representative point index per piece
    let x = 0,
      z = 0,
      y = 0,
      yaw = 0;
    const push = (bank?: number): void => {
      const cp: number[] = [Math.round(x), Math.round(y), Math.round(z)];
      if (bank) cp[3] = bank;
      pts.push(cp as ControlPoint);
    };
    push(); // start point

    for (const piece of this.pieces) {
      switch (piece.type) {
        case "straight": {
          x += Math.sin(yaw) * STRAIGHT;
          z += Math.cos(yaw) * STRAIGHT;
          push();
          break;
        }
        case "hillUp":
        case "hillDown": {
          y += piece.type === "hillUp" ? HILL : -HILL;
          x += Math.sin(yaw) * STRAIGHT;
          z += Math.cos(yaw) * STRAIGHT;
          push();
          break;
        }
        default: {
          // curves: gentle 45 deg over 2 steps, sharp 90 deg over 3 steps.
          const sharp = piece.type === "sharpL" || piece.type === "sharpR";
          const left = piece.type === "left" || piece.type === "sharpL";
          const sign = left ? -1 : 1;
          const deg = sharp ? 90 : 45;
          const steps = sharp ? 3 : 2;
          const dr = ((sign * deg) / steps) * (Math.PI / 180);
          const bank = sign * (sharp ? 22 : 13);
          for (let k = 0; k < steps; k++) {
            yaw += dr;
            x += Math.sin(yaw) * TURN_STEP;
            z += Math.cos(yaw) * TURN_STEP;
            push(bank);
          }
        }
      }
      pieceIdx.push(pts.length - 1);
    }

    const pads: PadSpec[] = [];
    this.pieces.forEach((piece, i) => {
      if (!piece.pad) return;
      const t = pieceIdx[i] / pts.length;
      pads.push(
        piece.pad === "jump"
          ? { kind: "jump", t, offset: 0, power: 1.4 }
          : { kind: "boost", t, offset: 0 }
      );
    });

    return { id: "custom", name: "CUSTOM TRACK", roadHalfWidth: HALF_WIDTH, points: pts, pads };
  }

  private emptySpec(): TrackSpec {
    return { id: "custom", name: "CUSTOM TRACK", roadHalfWidth: HALF_WIDTH, points: [], pads: [] };
  }

  /** A friendly starting loop (rounded rectangle) so it's never empty. */
  private static defaultLoop(): Piece[] {
    const out: Piece[] = [];
    for (let i = 0; i < 4; i++) {
      out.push({ type: "straight" }, { type: "straight" }, { type: "sharpR" });
    }
    return out;
  }

  private refresh(): void {
    this.spec = this.generate();
    this.preview3d.setSpec(this.spec);
    const valid = this.spec.points.length >= 4;
    const pads = this.spec.pads.length;
    this.info.innerHTML = `${this.pieces.length} PIECES · ${this.spec.points.length} PTS${pads ? ` · ${pads} PADS` : ""}${valid ? "" : ` · <span class="vd-mm-warn">add more</span>`}`;
    this.root.querySelector(".vd-mm-test")!.classList.toggle("disabled", !valid);
    this.draw();
  }

  // ---- 2D plan -------------------------------------------------------------

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    ctx.clearRect(0, 0, w, h);
    const pts = this.spec.points;
    if (pts.length < 2) return;

    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    const pad = 36;
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const scale = (Math.min(w, h) - pad * 2) / span;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const sx = (px: number) => w / 2 + (px - cx) * scale;
    const sy = (pz: number) => h / 2 + (pz - cz) * scale;

    // closed ribbon outline
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = Math.max(6, HALF_WIDTH * 2 * scale);
    ctx.beginPath();
    ctx.moveTo(sx(pts[0][0]), sy(pts[0][2]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][2]));
    ctx.closePath();
    ctx.stroke();

    // centre line
    ctx.strokeStyle = "rgba(0,215,242,0.7)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // pads
    for (const padSpec of this.spec.pads) {
      const idx = Math.min(pts.length - 1, Math.floor(padSpec.t * pts.length));
      const p = pts[idx];
      ctx.fillStyle = padSpec.kind === "boost" ? "#ffcf3d" : "#3dff84";
      ctx.beginPath();
      ctx.arc(sx(p[0]), sy(p[2]), 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // start (lime) + end/cursor (pink)
    ctx.fillStyle = "#d8f600";
    ctx.beginPath();
    ctx.arc(sx(pts[0][0]), sy(pts[0][2]), 7, 0, Math.PI * 2);
    ctx.fill();
    const last = pts[pts.length - 1];
    ctx.fillStyle = "#f4044e";
    ctx.beginPath();
    ctx.arc(sx(last[0]), sy(last[2]), 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- input ---------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (this.root.style.display === "none") return;
    if (e.key === "Backspace" || e.key === "ArrowDown") {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this.test();
      return;
    }
    if (e.code === "KeyB") return void this.tagLast("boost");
    if (e.code === "KeyJ") return void this.tagLast("jump");
    const hit = PALETTE.find((p) => p.key === e.code || p.key === e.key);
    if (hit) {
      e.preventDefault();
      this.add(hit.type);
    }
  }

  /** Polled from Game while this editor is open, so a controller can lay track:
   * D-pad lays pieces, bumpers do hills, X/Y tag pads, START test-drives. */
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
      if (edge("up")) this.add("straight");
      if (edge("left")) this.add("left");
      if (edge("right")) this.add("right");
      if (edge("down")) this.undo();
      if (edge("rb")) this.add("hillUp");
      if (edge("lb")) this.add("hillDown");
      if (edge("x")) this.tagLast("boost");
      if (edge("y")) this.tagLast("jump");
      if (edge("start")) this.test();
      if (edge("b")) this.onExit();
      this.padPrev.set(i, now);
    }
  }
}
