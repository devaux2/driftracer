/**
 * A cheap, GPU-free "sense of speed" layer: radial speed streaks drawn on a 2D
 * canvas overlay, intensity tied to velocity, plus a subtle vignette pulse.
 * Runs on top of the Babylon canvas so it never touches the 3D pipeline.
 */
export class SpeedLines {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private streaks: { a: number; r: number; len: number; speed: number }[] = [];

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "speedlines";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());

    for (let i = 0; i < 80; i++) {
      this.streaks.push({
        a: Math.random() * Math.PI * 2,
        r: 0.3 + Math.random() * 0.9,
        len: 0.05 + Math.random() * 0.12,
        speed: 0.6 + Math.random() * 0.8,
      });
    }
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /** @param ratio 0..1+ speed ratio, @param drift -1..1 drift direction */
  render(dt: number, ratio: number, drift: number): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (ratio < 0.15) return;

    const cx = canvas.width / 2 + drift * canvas.width * 0.12;
    const cy = canvas.height / 2;
    const maxR = Math.hypot(canvas.width, canvas.height) * 0.6;
    const intensity = Math.min(1, (ratio - 0.15) / 0.85);

    ctx.strokeStyle = `rgba(150,220,255,${0.25 * intensity})`;
    ctx.lineWidth = 2;
    for (const s of this.streaks) {
      s.r += s.speed * intensity * dt * 1.6;
      if (s.r > 1.3) s.r -= 1.0;
      const inner = s.r * maxR;
      const outer = (s.r + s.len * (0.5 + intensity)) * maxR;
      const x1 = cx + Math.cos(s.a) * inner;
      const y1 = cy + Math.sin(s.a) * inner;
      const x2 = cx + Math.cos(s.a) * outer;
      const y2 = cy + Math.sin(s.a) * outer;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
}
