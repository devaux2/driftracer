import type { Track } from "../track/Track";

interface Pt {
  x: number;
  z: number;
}

/**
 * Top-right minimap: a flat outline of the track with a bright-blue dot for the
 * player and red dots for opponents. Drawn on a 2D canvas overlay (no GPU cost).
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly size = 168;
  private readonly pad = 16;

  // world→map transform (computed once from the track)
  private minX = 0;
  private minZ = 0;
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private trackPath: { x: number; y: number }[] = [];

  constructor(container: HTMLElement, track: Track) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "minimap";
    container.appendChild(this.canvas);

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.size * dpr;
    this.canvas.height = this.size * dpr;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.scale(dpr, dpr);

    this.fit(track.centerlineXZ());
  }

  private fit(pts: Pt[]): void {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    const inner = this.size - this.pad * 2;
    this.scale = inner / Math.max(rangeX, rangeZ);
    this.minX = minX;
    this.minZ = minZ;
    this.offX = this.pad + (inner - rangeX * this.scale) / 2;
    this.offY = this.pad + (inner - rangeZ * this.scale) / 2;
    this.trackPath = pts.map((p) => this.toMap(p.x, p.z));
  }

  private toMap(x: number, z: number): { x: number; y: number } {
    return {
      x: this.offX + (x - this.minX) * this.scale,
      // flip Z so +Z (track "forward") reads as up on the map
      y: this.size - (this.offY + (z - this.minZ) * this.scale),
    };
  }

  private dot(p: Pt, color: string, r: number): void {
    const m = this.toMap(p.x, p.z);
    this.ctx.fillStyle = color;
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = 8;
    this.ctx.beginPath();
    this.ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.shadowBlur = 0;
  }

  render(player: Pt, opponents: Pt[]): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);

    // track outline
    ctx.strokeStyle = "rgba(90, 170, 230, 0.55)";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.beginPath();
    this.trackPath.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();

    for (const o of opponents) this.dot(o, "#ff3b5c", 3);
    this.dot(player, "#36c6ff", 4.5);
  }

  show(v: boolean): void {
    this.canvas.style.display = v ? "" : "none";
  }
}
