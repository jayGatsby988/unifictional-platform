import type { ScannedCountertopSurface } from '@/lib/spec/types';

export type CountertopPoint = { x: number; y: number; z: number };
const EPS = 1e-8;
const cross = (a: CountertopPoint, b: CountertopPoint, c: CountertopPoint) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** Work on copies; validation and rendering never rewrite the captured rings. */
export function cleanCountertopRing(points: readonly CountertopPoint[]): CountertopPoint[] {
  const ring = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y, p.z - points[i - 1].z) > EPS).map(p => ({ ...p }));
  if (ring.length > 1 && Math.hypot(ring[0].x - ring.at(-1)!.x, ring[0].y - ring.at(-1)!.y, ring[0].z - ring.at(-1)!.z) <= EPS) ring.pop();
  return ring;
}
export function countertopSignedArea(ring: readonly CountertopPoint[]): number {
  const origin = ring[0];
  return !origin ? 0 : ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + (p.x - origin.x) * (q.z - origin.z) - (q.x - origin.x) * (p.z - origin.z); }, 0) / 2;
}
function onSegment(a: CountertopPoint, b: CountertopPoint, p: CountertopPoint): boolean {
  return Math.abs(cross(a, b, p)) <= EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.z >= Math.min(a.z, b.z) - EPS && p.z <= Math.max(a.z, b.z) + EPS;
}
function intersects(a: CountertopPoint, b: CountertopPoint, c: CountertopPoint, d: CountertopPoint): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPS || Math.max(a.z, b.z) < Math.min(c.z, d.z) - EPS || Math.max(c.z, d.z) < Math.min(a.z, b.z) - EPS) return false;
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
  return (ac * ad < 0 && ca * cb < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
/** Boundary points are deliberately outside, so touching holes cannot pass validation. */
export function insideCountertopRing(point: CountertopPoint, ring: readonly CountertopPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (onSegment(a, b, point)) return false;
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
export function countertopRingsIntersect(a: readonly CountertopPoint[], b: readonly CountertopPoint[]): boolean {
  return a.some((p, i) => b.some((q, j) => intersects(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));
}
function simpleRing(ring: readonly CountertopPoint[]): boolean {
  if (ring.length < 3 || Math.abs(countertopSignedArea(ring)) < 0.001) return false;
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i + ring.length - 1) % ring.length], a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.hypot(b.x - a.x, b.z - a.z) <= EPS) return false;
    if (Math.abs(cross(prev, a, b)) <= EPS && (a.x - prev.x) * (b.x - a.x) + (a.z - prev.z) * (b.z - a.z) < -EPS) return false;
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) return false;
    }
  }
  return true;
}

/** Bounded simple planar rings, with disjoint holes wholly inside the outer ring. */
export function countertopSurfaceIssue(surface: ScannedCountertopSurface): string | null {
  if (surface.source !== 'lidar-mesh' || !Number.isFinite(surface.resolutionMeters) || surface.resolutionMeters <= 0 || surface.resolutionMeters > 0.25) return 'A countertop must identify its LiDAR mesh source and a positive grid interval of at most 25 cm.';
  const inputs = [surface.polygonCorners, ...(surface.holes ?? [])];
  if (inputs.length > 9 || inputs.some(ring => ring.length < 3 || ring.length > 256 || ring.some(p => ![p.x, p.y, p.z].every(n => Number.isFinite(n) && Math.abs(n) <= 1000)))) return 'Countertop rings must contain 3–256 finite world points, with at most eight holes.';
  const rings = inputs.map(cleanCountertopRing), outer = rings[0], holes = rings.slice(1);
  if (rings.some(ring => !simpleRing(ring))) return 'A countertop boundary crosses itself, backtracks, or has no usable area.';
  const heights = rings.flat().map(p => p.y);
  if (Math.max(...heights) - Math.min(...heights) > 0.005) return 'Each countertop level and its holes must be horizontal within 5 mm.';
  const origin = outer[0];
  let nx = 0, ny = 0, nz = 0;
  for (let i = 1; i < outer.length - 1; i++) {
    const a = outer[i], b = outer[i + 1];
    nx += (a.y - origin.y) * (b.z - origin.z) - (a.z - origin.z) * (b.y - origin.y);
    ny += (a.z - origin.z) * (b.x - origin.x) - (a.x - origin.x) * (b.z - origin.z);
    nz += (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < EPS || Math.abs(ny) / length < 0.9) return 'A countertop must be a near-horizontal planar surface.';
  if (rings.some(ring => ring.some(p => Math.abs(nx * (p.x - origin.x) + ny * (p.y - origin.y) + nz * (p.z - origin.z)) / length > 0.005))) return 'Countertop points and holes must lie on the same plane within 5 mm.';
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    if (hole.some(p => !insideCountertopRing(p, outer)) || countertopRingsIntersect(hole, outer)) return 'A countertop hole must be strictly inside its outer boundary.';
    for (let j = 0; j < i; j++) {
      if (countertopRingsIntersect(hole, holes[j]) || insideCountertopRing(hole[0], holes[j]) || insideCountertopRing(holes[j][0], hole)) return 'Countertop holes may not overlap, touch, or contain each other.';
    }
  }
  return null;
}
