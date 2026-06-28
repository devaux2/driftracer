import "@babylonjs/loaders/glTF";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Material } from "@babylonjs/core/Materials/material";
import shipUrl from "../assets/testship.glb";

/**
 * Per-ship craft model.
 *
 * There's one shared GLB ("test ship", a near-white hull). Each roster ship is
 * an instance of it tinted toward its accent colour (the hull is recoloured by
 * its albedo; the model is forced dielectric so the colour actually reads).
 * VD-01 keeps the native look. Real per-ship GLBs can replace this later.
 */

const containers = new WeakMap<Scene, AssetContainer | null>();
const loadingP = new WeakMap<Scene, Promise<void>>();

/** Load the GLB into a scene once. Safe to call repeatedly. */
export function preloadShipModel(scene: Scene): Promise<void> {
  const existing = loadingP.get(scene);
  if (existing) return existing;
  const p = SceneLoader.LoadAssetContainerAsync("", shipUrl, scene)
    .then((container) => {
      containers.set(scene, container);
    })
    .catch((e) => {
      console.warn("ship model load failed", e);
      containers.set(scene, null);
    });
  loadingP.set(scene, p);
  return p;
}

export function shipModelReady(scene: Scene): boolean {
  return !!containers.get(scene);
}

/** Recolour one material toward `color` (skips the emissive engine glow). */
function tintInPlace(mat: Material, color: Color3, amount: number): void {
  if (amount <= 0 || /glow/i.test(mat.name)) return;
  const tint = Color3.Lerp(new Color3(1, 1, 1), color, amount);
  if (mat instanceof PBRMaterial) {
    // Force dielectric so the albedo colour shows (the model is metallic by
    // default, which would swallow the tint); keep the albedo texture for
    // surface detail; a little emissive so it reads on the dark stage.
    mat.albedoColor = tint;
    mat.metallic = 0;
    mat.roughness = 0.55;
    mat.metallicTexture = null;
    mat.emissiveTexture = null;
    mat.emissiveColor = tint.scale(0.12);
  } else if (mat instanceof StandardMaterial) {
    mat.diffuseColor = tint;
  }
}

/**
 * Instantiate the ship model, tinted toward `color` by `amount` (0 = native
 * look), normalised so its longest dimension is `targetLength` and it's centred
 * on the origin. Returns a parent TransformNode (rotate/position it however you
 * like) or null if the model isn't loaded yet.
 */
export function buildShipModel(
  scene: Scene,
  color: Color3,
  amount: number,
  targetLength: number
): TransformNode | null {
  const container = containers.get(scene);
  if (!container) return null;

  // cloneMaterials=true → this instance gets its own materials, safe to tint.
  const entries = container.instantiateModelsToScene((n) => n, true);
  const root = entries.rootNodes[0] as TransformNode | undefined;
  if (!root) return null;
  root.setEnabled(true);

  const seen = new Set<number>();
  for (const m of root.getChildMeshes(false)) {
    const mat = m.material;
    if (!mat || seen.has(mat.uniqueId)) continue;
    seen.add(mat.uniqueId);
    tintInPlace(mat, color, amount);
  }

  // Normalise size + centre.
  root.computeWorldMatrix(true);
  let b = root.getHierarchyBoundingVectors(true);
  const longest = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
  root.scaling.scaleInPlace(targetLength / longest);
  root.computeWorldMatrix(true);
  b = root.getHierarchyBoundingVectors(true);
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  const cz = (b.min.z + b.max.z) / 2;

  const wrap = new TransformNode(`shipModel_${color.toHexString()}`, scene);
  root.parent = wrap;
  root.position.set(-cx, -cy, -cz);
  return wrap;
}
