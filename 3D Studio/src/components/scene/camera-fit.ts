import type { CameraRig } from './SceneCanvas';

type Vec3 = [number, number, number];
export interface CameraFitBounds { min: Vec3; max: Vec3 }

/** Fit every corner of a world-space box inside both camera fields of view.
 * Preserve the chosen viewing direction; account for each corner's depth,
 * rather than fitting a flat width at the target plane. */
export function fitCameraRig(rig: CameraRig, aspect: number): CameraRig {
  if (!rig.fitBounds) return rig;
  const { min, max } = rig.fitBounds;
  if (![...min, ...max, ...rig.position, ...rig.target].every(Number.isFinite)) return rig;
  const delta = rig.position.map((v, i) => v - rig.target[i]) as Vec3;
  const magnitude = Math.hypot(...delta);
  const back: Vec3 = magnitude > 1e-6 ? delta.map((v) => v / magnitude) as Vec3 : [0, 0.7, 0.7141428429];
  const horizontal = Math.hypot(back[0], back[2]);
  const right: Vec3 = horizontal > 1e-6 ? [back[2] / horizontal, 0, -back[0] / horizontal] : [1, 0, 0];
  const up: Vec3 = [back[1] * right[2], back[2] * right[0] - back[0] * right[2], -back[1] * right[0]];
  const tanV = Math.tan((rig.fov ?? 55) * Math.PI / 360);
  const tanH = tanV * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);
  const margin = 0.88;
  let distance = rig.minDistance ?? 0.1;
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    const p: Vec3 = [x - rig.target[0], y - rig.target[1], z - rig.target[2]];
    const dot = (axis: Vec3) => p.reduce((n, v, i) => n + v * axis[i], 0);
    const depth = dot(back);
    distance = Math.max(distance, depth + Math.abs(dot(right)) / (tanH * margin), depth + Math.abs(dot(up)) / (tanV * margin), depth + 0.1);
  }
  return {
    ...rig,
    position: rig.target.map((v, i) => v + back[i] * distance) as Vec3,
    // OrbitControls must never clamp the fitted pose back into the building.
    maxDistance: Math.max(rig.maxDistance ?? 0, distance * 3),
  };
}
