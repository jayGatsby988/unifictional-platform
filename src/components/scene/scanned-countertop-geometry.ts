import * as THREE from 'three';
import type { ScannedCountertopSurface } from '@/lib/spec/types';
import { cleanCountertopRing, countertopSignedArea, countertopSurfaceIssue, type CountertopPoint } from '@/lib/native/countertop-surfaces';
import { applyWorldUVs } from './geometry';
import type { ScannedObjectPresentation } from './scanned-object-layout';
import type { ScannedObjectPart } from './scanned-object-parts';

/** With no depth request, render observed coverage only; gaps are not established cutouts. */
export function measuredCountertopGeometry(surface: ScannedCountertopSurface, bottom?: { depth: number } | { height: number }): THREE.BufferGeometry | null {
  if (countertopSurfaceIssue(surface)) return null;
  const rings = [surface.polygonCorners, ...(surface.holes ?? [])].map(cleanCountertopRing);
  const points = rings.flat();
  const triangles = THREE.ShapeUtils.triangulateShape(rings[0].map(p => new THREE.Vector2(p.x, p.z)), rings.slice(1).map(ring => ring.map(p => new THREE.Vector2(p.x, p.z))));
  if (!triangles.length) return null;
  const lower = (p: CountertopPoint) => ({ x: p.x, y: bottom && 'depth' in bottom ? p.y - bottom.depth : bottom?.height ?? p.y, z: p.z });
  if (bottom && points.some(p => !Number.isFinite(lower(p).y) || lower(p).y >= p.y)) return null;
  const positions: number[] = [];
  const triangle = (a: CountertopPoint, b: CountertopPoint, c: CountertopPoint) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (const face of triangles) {
    const a = points[face[0]];
    let [b, c] = [points[face[1]], points[face[2]]];
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
    triangle(a, b, c); if (bottom) triangle(lower(c), lower(b), lower(a));
  }
  if (bottom) rings.forEach((ring, index) => {
    const direction = countertopSignedArea(ring) > 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
      let a = ring[i], b = ring[(i + 1) % ring.length];
      if ((index === 0 && direction < 0) || (index > 0 && direction > 0)) [a, b] = [b, a];
      triangle(a, b, lower(a)); triangle(b, lower(b), lower(a));
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.userData = { measuredCountertop: true, source: surface.source, resolutionMeters: surface.resolutionMeters, inferredThickness: Boolean(bottom), observedCoverageOnly: !bottom };
  return applyWorldUVs(geometry);
}

const cache = new WeakMap<ScannedObjectPresentation, ScannedObjectPart[]>();
/** Parts are converted to the object's local frame exactly once; the scene reapplies that frame. */
export function scannedCountertopParts(object: ScannedObjectPresentation): ScannedObjectPart[] | null {
  if (!object.countertopSurfaces?.length || !['island', 'base-cabinet', 'tall-cabinet', 'dishwasher', 'table', 'other'].includes(object.role)) return null;
  const existing = cache.get(object);
  if (existing) return existing;
  if (object.transform.length !== 16 || object.transform.some(value => !Number.isFinite(value))) return null;
  const frame = new THREE.Matrix4().fromArray(object.transform);
  if (Math.abs(frame.determinant()) < 1e-8) return null;
  const inverse = frame.invert();
  const parts: ScannedObjectPart[] = [];
  const island = object.role === 'island';
  const add = (geometry: THREE.BufferGeometry | null, name: string, slot: string) => {
    if (!geometry) return;
    geometry.applyMatrix4(inverse);
    geometry.userData.inferredSupport = false;
    parts.push({ geometry, name, slot });
  };
  object.countertopSurfaces.forEach((surface, index) => {
    if (countertopSurfaceIssue(surface)) return;
    // A coverage patch can end at an occlusion. Extruding its boundary would
    // turn missing observations into invented cabinet walls and sink cutouts.
    add(measuredCountertopGeometry(surface), `measured-countertop-${index}`, island ? 'island_countertop' : 'countertop');
  });
  cache.set(object, parts);
  return parts;
}
