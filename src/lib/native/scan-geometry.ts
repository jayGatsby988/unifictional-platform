import type { ScannedElement, ScannedRoomGeometry } from '@/lib/spec/types';
import { scannedWallQuantities } from './scan-wall-quantities';

type Point = { x: number; y: number; z: number };
/** Review tolerance for connecting an approximate floor, never a wall correction. */
export const SCAN_JOIN_TOLERANCE_M = 0.12;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

export function scanPoint(e: ScannedElement, x: number, y: number, z = 0): Point {
  const t = e.transform;
  return { x: t[0] * x + t[4] * y + t[8] * z + t[12], y: t[1] * x + t[5] * y + t[9] * z + t[13], z: t[2] * x + t[6] * y + t[10] * z + t[14] };
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.abs(cross(a, b, p)) < 1e-8 && p.x >= Math.min(a.x, b.x) - 1e-8 && p.x <= Math.max(a.x, b.x) + 1e-8 && p.z >= Math.min(a.z, b.z) - 1e-8 && p.z <= Math.max(a.z, b.z) + 1e-8;
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
export function polygonAreaXZ(points: readonly Point[]): number {
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.z - q.x * p.z; }, 0)) / 2;
}

/** Retain concavity and collinear vertices, reject bow ties and backtracking. */
export function usableFloorPolygon(points: readonly Point[] | null | undefined): Point[] | null {
  if (!points || points.length < 3 || points.some(p => ![p.x, p.y, p.z].every(Number.isFinite))) return null;
  const ring = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 1e-7).map(p => ({ ...p }));
  if (ring.length > 1 && distance(ring[0], ring[ring.length - 1]) < 1e-7) ring.pop();
  if (ring.length < 3 || polygonAreaXZ(ring) < 0.01) return null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
    if (Math.abs(cross(a, b, c)) < 1e-8 && (a.x - b.x) * (c.x - b.x) + (a.z - b.z) * (c.z - b.z) > 1e-8) return null;
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      if (intersects(b, c, ring[j], ring[(j + 1) % ring.length])) return null;
    }
  }
  return ring;
}

export interface ScanBoundaryReview { outline: Point[] | null; openEndpointCount: number; maximumJoinGapMeters: number }
/** A single degree-two loop is required. No convex hull, nearest-neighbour tour,
 * or bounding box may fill a missing wall or bridge two separate rooms. */
export function reviewScanBoundary(walls: readonly ScannedElement[]): ScanBoundaryReview {
  const endpoints = walls.flatMap(w => [scanPoint(w, -w.dimensions.x / 2, -w.dimensions.y / 2), scanPoint(w, w.dimensions.x / 2, -w.dimensions.y / 2)]);
  const choices = endpoints.map((p, i) => endpoints.map((q, j) => ({ j, d: distance(p, q) })).filter(c => Math.floor(c.j / 2) !== Math.floor(i / 2) && c.d <= SCAN_JOIN_TOLERANCE_M).sort((a, b) => a.d - b.d));
  const partners = choices.map(c => c.length && (c.length === 1 || c[1].d - c[0].d > 0.01) ? c[0].j : -1);
  const unmatched = partners.filter((j, i) => j < 0 || partners[j] !== i).length;
  const maximumJoinGapMeters = Math.max(0, ...partners.map((j, i) => j >= 0 && partners[j] === i ? distance(endpoints[i], endpoints[j]) : 0));
  const result = { outline: null as Point[] | null, openEndpointCount: unmatched, maximumJoinGapMeters };
  if (walls.length < 3 || unmatched) return result;
  const visited = new Set<number>(), outline: Point[] = [];
  let cursor = 0;
  do {
    const wall = Math.floor(cursor / 2);
    if (visited.has(wall)) return result;
    visited.add(wall);
    const exit = cursor ^ 1, next = partners[exit], a = endpoints[exit], b = endpoints[next];
    outline.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    cursor = next;
  } while (cursor !== 0 && visited.size <= walls.length);
  // Differing floor levels are not evidence of a continuous ramp.
  if (visited.size === walls.length && Math.max(...outline.map(p => p.y)) - Math.min(...outline.map(p => p.y)) <= 0.05) result.outline = usableFloorPolygon(outline);
  return result;
}

export function prepareScanFloors(geometry: ScannedRoomGeometry): { geometry: ScannedRoomGeometry; notices: string[]; boundary: ScanBoundaryReview } {
  const notices: string[] = [], boundary = reviewScanBoundary(geometry.surfaces.filter(e => e.kind === 'wall'));
  const floors = geometry.surfaces.filter(e => e.kind === 'floor');
  const valid = floors.filter(e => usableFloorPolygon(e.polygonCorners));
  if (valid.length < floors.length) notices.push('A floor outline is incomplete or crosses itself. Its fill was omitted; the scanned walls and original capture are retained.');
  const surfaces = geometry.surfaces.filter(e => e.kind !== 'floor' || valid.includes(e));
  // An explicitly invalid floor is evidence of ambiguity. Do not silently
  // substitute a more convenient perimeter for it.
  if (!floors.length && boundary.outline) {
    const ids = new Set([...surfaces, ...geometry.objects].map(e => e.id));
    let inferredId = 'inferred-floor-outline';
    while (ids.has(inferredId)) inferredId += '-derived';
    surfaces.push({ id: inferredId, kind: 'floor', confidence: 'low', dimensions: { x: 0, y: 0, z: 0 }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], polygonCorners: boundary.outline });
    notices.push('The floor is a provisional outline traced from the wall ends. It is not a measured floor surface; verify its area before ordering.');
  }
  if (boundary.openEndpointCount) notices.push(`${boundary.openEndpointCount} wall ends have an open or ambiguous join. The 3D scan remains usable; inspect the gaps and capture the missing corners before relying on area or clearances.`);
  if (boundary.maximumJoinGapMeters > 0.005) notices.push(`Nearby wall ends differ by up to ${(boundary.maximumJoinGapMeters * 100).toFixed(1)} cm. Scanned walls keep their original positions; any provisional floor connections are approximate.`);
  if (!surfaces.some(e => e.kind === 'floor')) notices.push('No reliable closed floor outline is available. Floor and ceiling quantities are excluded until the perimeter is captured.');
  return { geometry: { ...geometry, surfaces }, notices, boundary };
}

function contains(p: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Quantities come from the scan, never width × depth for an irregular room.
 * Ambiguous overlapping floor surfaces remain unpriced until reviewed. */
export function scannedRoomQuantities(geometry: ScannedRoomGeometry) {
  const walls = geometry.surfaces.filter(e => e.kind === 'wall'), floors = geometry.surfaces.filter(e => e.kind === 'floor');
  const polygons = floors.map(e => usableFloorPolygon(e.polygonCorners));
  let ambiguous = polygons.some(p => !p);
  for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) {
    const a = polygons[i], b = polygons[j];
    if (!a || !b) continue;
    if (a.some(p => contains(p, b)) || b.some(p => contains(p, a)) || a.some((p, k) => b.some((q, l) => intersects(p, a[(k + 1) % a.length], q, b[(l + 1) % b.length])))) ambiguous = true;
  }
  const openings = geometry.surfaces.filter(e => ['window', 'door', 'opening'].includes(e.kind));
  const { wallAreaSquareMeters, netWallAreaSquareMeters, perimeterMeters, incompleteWallCoverage } = scannedWallQuantities(walls, openings);
  return {
    floorAreaSquareMeters: !floors.length || ambiguous ? null : polygons.reduce((sum, p) => sum + polygonAreaXZ(p!), 0),
    perimeterMeters,
    wallAreaSquareMeters, netWallAreaSquareMeters, incompleteWallCoverage,
    openingAreaSquareMeters: Math.max(0, wallAreaSquareMeters - netWallAreaSquareMeters),
    provisionalFloor: floors.some(e => e.id.startsWith('inferred-floor-outline')),
  };
}
