import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { GhostFrame } from "./records";

/**
 * A translucent replay of the best lap, played back in sync with the player's
 * current lap time so you can race your own ghost (Time Attack).
 */
export class Ghost {
  private root: TransformNode;
  private frames: GhostFrame[] = [];

  constructor(scene: Scene) {
    this.root = new TransformNode("ghost", scene);

    const mat = new StandardMaterial("ghostMat", scene);
    mat.emissiveColor = new Color3(0.4, 0.95, 1);
    mat.alpha = 0.32;
    mat.disableLighting = true;

    const body = MeshBuilder.CreateBox("ghostHull", { width: 2.2, height: 0.7, depth: 4.2 }, scene);
    const nose = MeshBuilder.CreateCylinder(
      "ghostNose",
      { diameterTop: 0, diameterBottom: 1.6, height: 2.4, tessellation: 4 },
      scene
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 3;
    for (const m of [body, nose]) {
      m.material = mat;
      m.parent = this.root;
      m.isPickable = false;
    }
    this.root.setEnabled(false);
  }

  setFrames(frames: GhostFrame[]): void {
    this.frames = frames;
  }

  hasData(): boolean {
    return this.frames.length > 1;
  }

  /** Pose the ghost at the given lap time (ms). Hidden if there's no data or the
   * ghost has already finished its lap. */
  update(lapMs: number): void {
    const f = this.frames;
    if (f.length < 2 || lapMs > f[f.length - 1][0]) {
      this.root.setEnabled(false);
      return;
    }
    // find the segment containing lapMs (linear scan from the start is fine for
    // a single lap of ~30fps samples)
    let i = 0;
    while (i < f.length - 1 && f[i + 1][0] < lapMs) i++;
    const a = f[i];
    const b = f[Math.min(i + 1, f.length - 1)];
    const span = b[0] - a[0] || 1;
    const u = Math.min(1, Math.max(0, (lapMs - a[0]) / span));

    this.root.position.set(
      a[1] + (b[1] - a[1]) * u,
      a[2] + (b[2] - a[2]) * u,
      a[3] + (b[3] - a[3]) * u
    );
    // shortest-arc yaw lerp
    let dyaw = b[4] - a[4];
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.root.rotation.set(0, a[4] + dyaw * u, 0);
    this.root.setEnabled(true);
  }

  hide(): void {
    this.root.setEnabled(false);
  }

  dispose(): void {
    this.root.dispose();
  }
}
