import * as THREE from 'three';
import type { ScannedObjectPresentation } from './scanned-object-layout';
import { countertopSignedArea, countertopSurfaceIssue } from '@/lib/native/countertop-surfaces';

/** Only two independently supported height bands justify automatic split levels.
 * Completed rectangular extents remain a representative design, not a measured perimeter. */
export function capturedIslandLevels(object: ScannedObjectPresentation) {
  if (object.role !== 'island' || !object.countertopSurfaces?.length) return null;
  const inverse = new THREE.Matrix4().fromArray(object.transform).invert();
  const groups: Array<{ y: number; area: number; z: number }> = [];
  for (const surface of object.countertopSurfaces) {
    if (countertopSurfaceIssue(surface)) continue;
    const points = surface.polygonCorners.map(p => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(inverse));
    if (Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) > 0.01) continue;
    const area = Math.abs(countertopSignedArea(points)) - (surface.holes ?? []).reduce((sum, ring) => sum + Math.abs(countertopSignedArea(ring.map(p => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(inverse)))), 0);
    if (area <= 0) continue;
    const y = points[0].y, z = points.reduce((sum, p) => sum + p.z, 0) / points.length;
    const group = groups.find(g => Math.abs(g.y - y) < 0.01);
    if (group) { group.z = (group.z * group.area + z * area) / (group.area + area); group.area += area; }
    else groups.push({ y, z, area });
  }
  const supported = groups.filter(g => g.area >= Math.max(0.06, object.dimensions.x * object.dimensions.z * 0.015)).sort((a, b) => a.y - b.y);
  if (supported.length !== 2) return null;
  const [low, high] = supported, h = object.dimensions.y, d = object.dimensions.z;
  if (high.y - low.y < 0.08 || high.y - low.y > 0.35 || low.y + h / 2 < h * 0.55 || high.y > h / 2 + 0.01 || low.z - high.z < 0.12 || high.z >= 0) return null;
  return { workingHeight: low.y + h / 2, barHeight: Math.min(h, high.y + h / 2), barDepth: Math.max(d * 0.15, Math.min(d * 0.5, d / 2 + (low.z + high.z) / 2)) };
}

/** A single broad, simple observed perimeter can drive a clean slab/support.
 * This does not qualify fragmented coverage as a complete footprint. The vertical
 * cabinet support is explicitly inferred; holes and concavities are never filled. */
export function cleanObservedFootprintSurface(object: ScannedObjectPresentation) {
  if (!['island', 'base-cabinet'].includes(object.role) || object.countertopSurfaces?.length !== 1) return null;
  const source = object.countertopSurfaces[0];
  if (countertopSurfaceIssue(source)) return null;
  const inverse = new THREE.Matrix4().fromArray(object.transform).invert();
  const point = (p: { x: number; y: number; z: number }) => {
    const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(inverse); return { x: v.x, y: v.y, z: v.z };
  };
  const surface = { ...source, polygonCorners: source.polygonCorners.map(point), holes: (source.holes ?? []).map(ring => ring.map(point)) };
  const outer = surface.polygonCorners, all = [outer, ...surface.holes].flat();
  const { x: w, y: h, z: d } = object.dimensions;
  if (all.length > 64 || countertopSurfaceIssue(surface) || all.some(p => Math.abs(p.x) > w / 2 + 1e-6 || Math.abs(p.z) > d / 2 + 1e-6 || p.y > h / 2 + 1e-6 || p.y < h * 0.1)) return null;
  const area = Math.abs(countertopSignedArea(outer)) - surface.holes.reduce((sum, hole) => sum + Math.abs(countertopSignedArea(hole)), 0);
  if (area < w * d * 0.65 || Math.max(...outer.map(p => p.x)) - Math.min(...outer.map(p => p.x)) < w * 0.85 || Math.max(...outer.map(p => p.z)) - Math.min(...outer.map(p => p.z)) < d * 0.85) return null;
  // A short curved polygon is usable; a sawtooth raster boundary is not a clean
  // perimeter merely because its area is large. No smoothing adds missing area.
  const sharpTurns = outer.filter((p, index) => {
    const before = outer[(index + outer.length - 1) % outer.length], after = outer[(index + 1) % outer.length];
    const a = new THREE.Vector2(p.x - before.x, p.z - before.z).normalize(), b = new THREE.Vector2(after.x - p.x, after.z - p.z).normalize();
    return a.dot(b) < 0.5;
  }).length;
  if (sharpTurns > 12) return null;
  return surface;
}

/** Read-only control eligibility, sharing the exact clean profile qualification.
 * Clean mode excludes all old photo-assisted style overrides. */
export function scannedObjectHasHardware(object: ScannedObjectPresentation, { clean = true }: { clean?: boolean } = {}): boolean {
  const { x: w, y: h, z: d } = object.dimensions;
  if (!['base-cabinet','upper-cabinet','tall-cabinet','island'].includes(object.role) || ![w,h,d].every(v => Number.isFinite(v) && v > 0) || Math.min(w,h,d) < 0.05 || w < 0.15 || d < 0.12 || h < 0.15) return false;
  if (clean && cleanObservedFootprintSurface(object)) return false;
  const upper = object.role === 'upper-cabinet', tall = object.role === 'tall-cabinet';
  const reveal = Math.min(0.004, w * 0.01, h * 0.01);
  const counter = !upper && !tall ? Math.min(0.032, h * 0.05) : 0;
  const toe = upper ? 0 : Math.min(0.105, h * 0.13);
  const height = (clean ? capturedIslandLevels(object)?.workingHeight : undefined) ?? h;
  const body = height - counter - toe;
  const drawer = !upper && !tall ? Math.min(0.18, body * 0.24) : 0;
  const columns = Math.max(1, Math.min(tall ? 3 : 4, Math.ceil(w / 0.62)));
  const doorWidth = w * 0.98 / columns - reveal, doorHeight = body - drawer - 2 * reveal;
  return (drawer > 0 && doorWidth > 0.13) || (doorWidth > 0.15 && doorHeight > 0.2);
}
