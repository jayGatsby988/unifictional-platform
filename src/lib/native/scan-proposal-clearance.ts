import { Matrix4, Vector3 } from 'three';
import type { ScannedRoomGeometry } from '@/lib/spec/types';
import { cleanObservedFootprintSurface } from '@/components/scene/scanned-object-profile';
import type { ScannedObjectPresentation } from '@/components/scene/scanned-object-layout';
import { cleanCountertopRing, countertopSurfaceIssue } from './countertop-surfaces';
import { reviewScanBoundary, usableFloorPolygon } from './scan-geometry';

type P = { x: number; z: number };
type Region = { outer: P[]; holes: P[][] };
type Footprint = { regions: Region[]; minY: number; maxY: number; profile: boolean; center: P };
export interface ScanClearanceObject {
  object: ScannedObjectPresentation; label: string; delta: number[]; hidden: boolean; assemblyId: string;
}
export interface ScanClearanceIssue { severity: 'error' | 'warning'; code: string; message: string; objectIds?: string[] }
type Budget = { remaining: number; limited: boolean };
type Interval = [number, number];
const EPS = 1e-9, AREA_REVIEW = .0025, DISTANCE_CHANGE = .03;
/** A review trigger chosen by the product, not a measured aisle or code rule. */
export const SCAN_CLEARANCE_REVIEW_METERS = .9;
const cross = (a: P, b: P) => a.x * b.z - a.z * b.x;
const edges = (regions: Region[]) => regions.flatMap(r => [r.outer, ...r.holes].flatMap(ring => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] }))));
function merge(items: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const item of items.sort((a, b) => a[0] - b[0])) {
    const prior = result.at(-1);
    if (prior && item[0] <= prior[1] + EPS) prior[1] = Math.max(prior[1], item[1]); else result.push([...item]);
  }
  return result;
}
function slice(regions: Region[], x: number): Interval[] {
  return merge(regions.flatMap(region => {
    const hits: number[] = [];
    for (const ring of [region.outer, ...region.holes]) ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) hits.push(a.z + (b.z - a.z) * (x - a.x) / (b.x - a.x));
    });
    hits.sort((a, b) => a - b);
    return hits.flatMap((z, i) => i % 2 || i + 1 === hits.length ? [] : [[z, hits[i + 1]] as Interval]);
  }));
}
const intervalLength = (items: Interval[]) => items.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);
/** Exact piecewise-linear planar union/intersection. Rings remain concave;
 * holes remain empty. No hull or raster fill is applied to captured profiles. */
function areas(a: Region[], b: Region[], budget: Budget): { first: number; overlap: number } | null {
  const lines = edges([...a, ...b]), cost = lines.length ** 2;
  if (lines.length > 512 || cost > budget.remaining) { budget.limited = true; return null; }
  budget.remaining -= cost;
  const events = lines.flatMap(e => [e.a.x, e.b.x]);
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const { a, b } = lines[i], { a: c, b: d } = lines[j];
    if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.max(a.z, b.z) < Math.min(c.z, d.z) || Math.max(c.z, d.z) < Math.min(a.z, b.z)) continue;
    const ab = { x: b.x - a.x, z: b.z - a.z }, cd = { x: d.x - c.x, z: d.z - c.z }, ac = { x: c.x - a.x, z: c.z - a.z }, determinant = cross(ab, cd);
    if (Math.abs(determinant) < EPS) continue;
    const t = cross(ac, cd) / determinant, u = cross(ac, ab) / determinant;
    if (t > 0 && t < 1 && u > 0 && u < 1) events.push(a.x + t * ab.x);
    if (events.length > 8192) { budget.limited = true; return null; }
  }
  const xs = [...new Set(events)].sort((a, b) => a - b);
  let first = 0, overlap = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const width = xs[i + 1] - xs[i]; if (width < EPS) continue;
    const x = (xs[i] + xs[i + 1]) / 2, aa = slice(a, x), bb = slice(b, x);
    first += width * intervalLength(aa);
    overlap += width * aa.reduce((sum, left) => sum + bb.reduce((n, right) => n + Math.max(0, Math.min(left[1], right[1]) - Math.max(left[0], right[0])), 0), 0);
  }
  return { first, overlap };
}
function pointSegment(p: P, a: P, b: P): number {
  const x = b.x - a.x, z = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.z - a.z) * z) / Math.max(EPS, x * x + z * z)));
  return Math.hypot(p.x - a.x - t * x, p.z - a.z - t * z);
}
function boundaryDistance(a: Region[], b: Region[]): number {
  let gap = Infinity;
  for (const first of edges(a)) for (const second of edges(b)) gap = Math.min(gap, pointSegment(first.a, second.a, second.b), pointSegment(first.b, second.a, second.b), pointSegment(second.a, first.a, first.b), pointSegment(second.b, first.a, first.b));
  return gap;
}
function ringContains(p: P, ring: P[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]; if (pointSegment(p, a, b) <= EPS) return true;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const contains = (p: P, regions: Region[]) => regions.some(r => ringContains(p, r.outer) && !r.holes.some(hole => ringContains(p, hole)));
function extendsPastBoundary(regions: Region[], boundary: Region[], budget: Budget): boolean {
  const a = edges(regions), b = edges(boundary);
  if (a.length * b.length > budget.remaining) { budget.limited = true; return false; }
  budget.remaining -= a.length * b.length;
  for (const edge of a) {
    const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z, cuts = [0, 1];
    for (const line of b) {
      const ex = line.b.x - line.a.x, ez = line.b.z - line.a.z, determinant = dx * ez - dz * ex;
      if (Math.abs(determinant) < EPS) continue;
      const x = line.a.x - edge.a.x, z = line.a.z - edge.a.z, t = (x * ez - z * ex) / determinant, u = (x * dz - z * dx) / determinant;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    for (const t of [...cuts, ...cuts.slice(1).map((next, i) => (next + cuts[i]) / 2)]) {
      const p = { x: edge.a.x + dx * t, z: edge.a.z + dz * t };
      if (!contains(p, boundary) && b.every(e => pointSegment(p, e.a, e.b) > .03)) return true;
    }
  }
  return false;
}
const bounds = (regions: Region[]) => {
  const points = regions.flatMap(r => r.outer);
  return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z)) };
};
function boxGap(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>): number {
  return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
}
function hull(points: P[]): P[] {
  const ordered = [...points].sort((a, b) => a.x - b.x || a.z - b.z), half = (items: P[]) => {
    const out: P[] = [];
    for (const p of items) { while (out.length >= 2) { const a = out[out.length - 2], b = out[out.length - 1]; if (cross({ x: b.x - a.x, z: b.z - a.z }, { x: p.x - b.x, z: p.z - b.z }) > EPS) break; out.pop(); } out.push(p); }
    return out.slice(0, -1);
  };
  return [...half(ordered), ...half([...ordered].reverse())];
}
function footprint(object: ScannedObjectPresentation, budget: Budget): Footprint | null {
  if (object.transform.length !== 16 || !object.transform.every(Number.isFinite) || !Object.values(object.dimensions).every(n => Number.isFinite(n) && n > 0)) return null;
  const frame = new Matrix4().fromArray(object.transform), d = object.dimensions;
  const corners = [-.5, .5].flatMap(x => [-.5, .5].flatMap(y => [-.5, .5].map(z => new Vector3(d.x * x, d.y * y, d.z * z).applyMatrix4(frame))));
  const clean = cleanObservedFootprintSurface(object), world = (p: { x: number; y: number; z: number }) => new Vector3(p.x, p.y, p.z).applyMatrix4(frame);
  const regions: Region[] = clean ? [{ outer: clean.polygonCorners.map(world), holes: (clean.holes ?? []).map(ring => ring.map(world)) }] : [{ outer: hull(corners), holes: [] }];
  if (!clean) for (const surface of object.countertopSurfaces ?? []) {
    if (countertopSurfaceIssue(surface)) continue;
    if (edges(regions).length + surface.polygonCorners.length + (surface.holes ?? []).flat().length > 256) { budget.limited = true; break; }
    // Observed overhangs must not disappear into a smaller detection box.
    regions.push({ outer: cleanCountertopRing(surface.polygonCorners), holes: (surface.holes ?? []).map(cleanCountertopRing) });
  }
  return { regions, minY: Math.min(...corners.map(p => p.y)), maxY: Math.max(...corners.map(p => p.y), ...(object.countertopSurfaces ?? []).flatMap(surface => surface.polygonCorners.map(p => p.y))), profile: !!clean, center: { x: object.position.x, z: object.position.z } };
}
function transformed(source: Footprint, delta: Matrix4): Footprint {
  const point = (p: P) => { const v = new Vector3(p.x, 0, p.z).applyMatrix4(delta); return { x: v.x, z: v.z }; };
  return { ...source, center: point(source.center), regions: source.regions.map(r => ({ outer: r.outer.map(point), holes: r.holes.map(hole => hole.map(point)) })) };
}
function roomRegions(scan: ScannedRoomGeometry, fallback: { width: number; depth: number }): { regions: Region[]; captured: boolean; boundsOnly: boolean } {
  const floors = scan.surfaces.filter(s => s.kind === 'floor'), rings = floors.map(s => usableFloorPolygon(s.polygonCorners));
  if (floors.length && rings.every(Boolean)) return { regions: rings.map(ring => ({ outer: ring!, holes: [] })), captured: floors.every(floor => !floor.id.startsWith('inferred-floor-outline') && ['high', 'medium'].includes(floor.confidence)), boundsOnly: false };
  const wallReview = reviewScanBoundary(scan.surfaces.filter(s => s.kind === 'wall'));
  if (!floors.length && wallReview.outline) return { regions: [{ outer: wallReview.outline, holes: [] }], captured: wallReview.maximumJoinGapMeters <= .03, boundsOnly: false };
  return { regions: [{ outer: [{ x: -fallback.width / 2, z: -fallback.depth / 2 }, { x: fallback.width / 2, z: -fallback.depth / 2 }, { x: fallback.width / 2, z: fallback.depth / 2 }, { x: -fallback.width / 2, z: fallback.depth / 2 }], holes: [] }], captured: false, boundsOnly: true };
}

/** Review changes against the immutable capture. Supported clean profiles keep
 * bends and holes; other objects use conservative detection bounds, explicitly
 * labeled as risks. Partial top patches never establish a complete perimeter.
 * Vertical separation and shared ownership exclude stacked/attached fixtures.
 * These comparisons are not surveyed aisle widths or collision certificates. */
export function scanProposalClearanceIssues(scan: ScannedRoomGeometry, objects: ScanClearanceObject[], fallback: { width: number; depth: number }): ScanClearanceIssue[] {
  const issues: ScanClearanceIssue[] = [], budget: Budget = { remaining: 500_000, limited: objects.length > 128 };
  const items = objects.slice(0, 128).flatMap(item => {
    if (item.hidden) return [];
    const original = footprint(item.object, budget); if (!original) { budget.limited = true; return []; }
    const delta = new Matrix4().fromArray(item.delta), changed = !delta.equals(new Matrix4());
    return [{ ...item, original, proposed: transformed(original, delta), changed }];
  });
  const room = roomRegions(scan, fallback);
  for (const item of items.filter(item => item.changed)) {
    const before = areas(item.original.regions, room.regions, budget), after = areas(item.proposed.regions, room.regions, budget);
    const oldOutside = before ? Math.max(0, before.first - before.overlap) : 0, newOutside = after ? Math.max(0, after.first - after.overlap) : 0;
    const centerOutside = !contains(item.proposed.center, room.regions) && contains(item.original.center, room.regions)
      && edges(room.regions).every(e => pointSegment(item.proposed.center, e.a, e.b) > .05);
    if (centerOutside || (before && after && newOutside > oldOutside + AREA_REVIEW)) {
      const definite = (centerOutside && (room.captured || room.boundsOnly)) || (room.captured && item.original.profile && oldOutside < AREA_REVIEW && extendsPastBoundary(item.proposed.regions, room.regions, budget));
      issues.push({ severity: definite ? 'error' : 'warning', code: definite ? 'scan-object-outside-room' : 'scan-room-boundary-risk', objectIds: [item.object.id], message: `${item.label}: this proposal extends beyond the ${room.captured ? 'captured floor outline' : 'available room outline'}${!item.original.profile && !centerOutside ? ' based on detection bounds' : ''}. Move it inward or reduce its size; review the room edge on site.` });
    }
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if ((!a.changed && !b.changed) || a.assemblyId === b.assemblyId || Math.min(a.original.maxY, b.original.maxY) - Math.max(a.original.minY, b.original.minY) < -.02) continue;
    if (boxGap(bounds(a.proposed.regions), bounds(b.proposed.regions)) > SCAN_CLEARANCE_REVIEW_METERS) continue;
    const prior = areas(a.original.regions, b.original.regions, budget), next = areas(a.proposed.regions, b.proposed.regions, budget);
    if (!prior || !next) continue;
    // Sink/cooktop overlap already in the capture is an attachment review,
    // handled separately; do not manufacture a new collision from that nesting.
    if (prior.overlap > AREA_REVIEW && [a.object.role, b.object.role].some(role => role === 'sink' || role === 'cooktop')) continue;
    const basis = a.original.profile && b.original.profile ? 'rendered captured profiles' : 'detection bounds and available surface evidence';
    if (next.overlap > prior.overlap + Math.max(AREA_REVIEW, prior.overlap * .02)) {
      issues.push({ severity: 'warning', code: 'scan-fixture-overlap-risk', objectIds: [a.object.id, b.object.id], message: `${a.label} and ${b.label}: the proposal increases overlap in ${basis}. Move them apart or reduce the proposed size; confirm actual outlines and connections on site.` });
    } else if (prior.overlap < AREA_REVIEW && next.overlap < AREA_REVIEW) {
      const before = boundaryDistance(a.original.regions, b.original.regions), after = boundaryDistance(a.proposed.regions, b.proposed.regions);
      if (after < SCAN_CLEARANCE_REVIEW_METERS && after + DISTANCE_CHANGE < before) issues.push({ severity: 'warning', code: 'scan-clearance-reduced', objectIds: [a.object.id, b.object.id], message: `${a.label} is closer to ${b.label} within the 0.9 m layout review zone, using ${basis}. Leave more space or check the aisle on site. This is a model risk check, not a measured clear aisle.` });
    }
  }
  if (budget.limited) issues.push({ severity: 'warning', code: 'scan-clearance-incomplete', message: 'Some fixture or boundary geometry exceeds the bounded layout check. Review those clearances on site; unchecked geometry is not confirmed clear.' });
  if (issues.length > 32) return [...issues.slice(0, 31), { severity: 'warning', code: 'scan-clearance-more-issues', message: 'Additional layout risks remain. Review the listed proposals first, then check the remaining fixtures on site.' }];
  return issues;
}
