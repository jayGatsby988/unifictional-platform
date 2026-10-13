import type { MeshBounds } from '@/lib/native/mesh-archive';
import type { CameraRig } from './SceneCanvas';

/** Fit observed vertices, including disjoint patches, without inventing a floor. */
export function observedMeshRig(bounds: MeshBounds, heading?: CameraRig): CameraRig {
  const target = bounds.min.map((n, i) => (n + bounds.max[i]) / 2) as [number, number, number];
  const span = Math.max(0.3, ...bounds.max.map((n, i) => n - bounds.min[i]));
  const dx = heading ? heading.position[0] - heading.target[0] : 0.55;
  const dz = heading ? heading.position[2] - heading.target[2] : 0.83;
  const horizontal = Math.hypot(dx, dz) || 1, elevation = Math.PI / 6, distance = span * 1.8;
  return { target, position: [target[0] + dx / horizontal * Math.cos(elevation) * distance, target[1] + Math.sin(elevation) * distance, target[2] + dz / horizontal * Math.cos(elevation) * distance],
    fitBounds: bounds, minDistance: 0.15, maxDistance: span * 6, minPolar: 0.05, maxPolar: Math.PI - 0.05, fov: 46,
    eyeHeight: Math.max(bounds.min[1], Math.min(bounds.max[1], 1.6)),
    bounds: { minX: bounds.min[0], maxX: bounds.max[0], minZ: bounds.min[2], maxZ: bounds.max[2] } };
}
