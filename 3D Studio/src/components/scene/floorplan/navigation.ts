/** Fixed-floor walkthrough constraints. Floor switching is explicit; this is not stair physics. */
import { ShapeUtils, Vector2 } from 'three';
import { floorHoles, planOrigin, planPolygonCentroid, planToScene, stairSweptCorners } from '@/lib/spec/floorplan';
import type { FloorPlanSpec, PlanPoint } from '@/lib/spec/types';
import { ft, inch } from '@/lib/units';

export type NavPoint = [number, number]; // scene x,z in metres
export interface NavSegment { a: NavPoint; b: NavPoint; halfThickness: number }
export interface FloorPlanNavigation {
  levelIndex: number;
  floorY: number;
  radiusM: number;
  spawn: NavPoint;
  rooms: NavPoint[][];
  boundaries: NavSegment[];
  walls: NavSegment[];
  /** Open shafts and the lower flight's solid steps; use the floor picker to change level. */
  voids: NavPoint[][];
}

const EPS = 1e-7;
const cross = (a: NavPoint, b: NavPoint) => a[0] * b[1] - a[1] * b[0];
const sub = (a: NavPoint, b: NavPoint): NavPoint => [a[0] - b[0], a[1] - b[1]];
const dot = (a: NavPoint, b: NavPoint) => a[0] * b[0] + a[1] * b[1];
const lerp = (a: NavPoint, b: NavPoint, t: number): NavPoint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function distanceToNavSegment(p: NavPoint, a: NavPoint, b: NavPoint): number {
  const d = sub(b, a), q = sub(p, a), len = dot(d, d);
  const t = len > EPS * EPS ? Math.max(0, Math.min(1, dot(q, d) / len)) : 0;
  const at = lerp(a, b, t);
  return Math.hypot(p[0] - at[0], p[1] - at[1]);
}

/** Includes the boundary so a shared room edge does not become an invisible barrier. */
function inside(p: NavPoint, ring: NavPoint[]): boolean {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (distanceToNavSegment(p, a, b) < EPS) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}

const edges = (ring: NavPoint[]): NavSegment[] => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length], halfThickness: 0 }));

/** Distance to the actual wall rectangle: thickness must not narrow its door jamb sideways. */
function wallClearance(p: NavPoint, wall: NavSegment): number {
  const d = sub(wall.b, wall.a), length = Math.hypot(...d);
  if (length < EPS) return distanceToNavSegment(p, wall.a, wall.b);
  const q = sub(p, wall.a), along = dot(q, d) / length, across = Math.abs(cross(q, d) / length);
  return Math.hypot(Math.max(0, -along, along - length), Math.max(0, across - wall.halfThickness));
}

/**
 * Boundary of the room union, split at every crossing and overlap. Shared
 * boundaries are not obstacles: the dividing wall controls its own doors.
 * This also handles non-identical collinear room edges and concave polygons.
 */
function roomBoundaries(rooms: NavPoint[][]): NavSegment[] {
  const all = rooms.flatMap(edges), out: NavSegment[] = [];
  const covered = (p: NavPoint) => rooms.some((r) => inside(p, r));
  const seen = new Set<string>();
  for (const e of all) {
    const d = sub(e.b, e.a), len2 = dot(d, d), len = Math.sqrt(len2);
    if (len < EPS) continue;
    const cuts = [0, 1];
    for (const f of all) {
      const v = sub(f.b, f.a), q = sub(f.a, e.a), det = cross(d, v);
      if (Math.abs(det) > EPS) {
        const t = cross(q, v) / det, u = cross(q, d) / det;
        if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) cuts.push(t);
      } else if (Math.abs(cross(q, d)) < EPS) {
        for (const p of [f.a, f.b]) { const t = dot(sub(p, e.a), d) / len2; if (t > EPS && t < 1 - EPS) cuts.push(t); }
      }
    }
    const ts = [...new Set(cuts.map((t) => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      const a = lerp(e.a, e.b, ts[i - 1]), b = lerp(e.a, e.b, ts[i]);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < EPS) continue;
      const m = lerp(a, b, 0.5), nx = -d[1] / len * 1e-5, nz = d[0] / len * 1e-5;
      if (covered([m[0] + nx, m[1] + nz]) === covered([m[0] - nx, m[1] - nz])) continue;
      const key = [a.map((x) => x.toFixed(6)).join(','), b.map((x) => x.toFixed(6)).join(',')].sort().join('|');
      if (!seen.has(key)) { seen.add(key); out.push({ a, b, halfThickness: 0 }); }
    }
  }
  return out;
}

/** Full body radius, not just camera centre: keep away from edges and wall faces. */
export function canOccupyFloorPlan(nav: FloorPlanNavigation, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const p: NavPoint = [x, z], r = nav.radiusM;
  if (!nav.rooms.some((room) => inside(p, room))) return false;
  if (nav.boundaries.some((e) => distanceToNavSegment(p, e.a, e.b) < r - EPS)) return false;
  if (nav.walls.some((e) => wallClearance(p, e) < r - EPS)) return false;
  return !nav.voids.some((ring) => inside(p, ring) || edges(ring).some((e) => distanceToNavSegment(p, e.a, e.b) < r - EPS));
}

/** Build once per edited plan. All returned fields are serializable. Null means no safe floor area. */
export function buildFloorPlanNavigation(spec: FloorPlanSpec, levelIndex: number | null): FloorPlanNavigation | null {
  const level = spec.levels.find((l) => l.index === levelIndex) ?? spec.levels[0];
  if (!level?.rooms.length) return null;
  const origin = planOrigin(spec);
  const toScene = (p: PlanPoint): NavPoint => { const q = planToScene(p, origin); return [q.x, q.z]; };
  const rooms = level.rooms.map((r) => r.polygon.map(toScene));
  const walls: NavSegment[] = [];
  for (const w of level.walls) {
    const a = toScene({ x: w.x1, y: w.y1 }), b = toScene({ x: w.x2, y: w.y2 });
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < EPS) continue;
    const cuts = level.doors.filter((d) => d.wallId === w.id && inch(d.heightIn) >= 1.75 && d.kind !== 'garage')
      .map((d) => [Math.max(0, d.t * length - inch(d.widthIn) / 2 + inch(0.75)), Math.min(length, d.t * length + inch(d.widthIn) / 2 - inch(0.75))])
      .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    const add = (from: number, to: number) => { if (to > from + EPS) walls.push({ a: lerp(a, b, from / length), b: lerp(a, b, to / length), halfThickness: inch(w.thicknessIn) / 2 }); };
    for (const [start, end] of cuts) { if (start > cursor) add(cursor, start); cursor = Math.max(cursor, end); }
    add(cursor, length);
  }
  const nav: FloorPlanNavigation = {
    levelIndex: level.index, floorY: ft(level.elevationFt), radiusM: 0.20, spawn: [0, 0], rooms, walls,
    boundaries: roomBoundaries(rooms),
    voids: [...floorHoles(spec, level.index), ...spec.levels.flatMap((sheet) => sheet.stairs)
      .filter((s) => Math.min(s.connects.fromLevel, s.connects.toLevel) === level.index).map(stairSweptCorners)].map((r) => r.map(toScene)),
  };
  const candidates: NavPoint[] = level.rooms.map((r) => toScene(planPolygonCentroid(r.polygon)));
  for (const ring of rooms) {
    const indices = ShapeUtils.triangulateShape(ring.map(([x, z]) => new Vector2(x, z)), []);
    for (const ids of indices) {
      const [a, b, c] = ids.map((i) => ring[i]);
      for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) {
        candidates.push([a[0] * wa + b[0] * wb + c[0] * wc, a[1] * wa + b[1] * wb + c[1] * wc]);
      }
    }
  }
  const obstacleEdges = [...nav.boundaries, ...nav.walls, ...nav.voids.flatMap(edges)];
  let best = -Infinity, spawn: NavPoint | null = null;
  for (const p of candidates) {
    if (!canOccupyFloorPlan(nav, ...p)) continue;
    const clearance = Math.min(...obstacleEdges.map((e) => e.halfThickness > 0 ? wallClearance(p, e) : distanceToNavSegment(p, e.a, e.b)));
    if (clearance > best) { best = clearance; spawn = p; }
  }
  if (!spawn) return null;
  nav.spawn = spawn;
  return nav;
}

/** Swept substeps prevent fast motion tunnelling; axis sliding avoids sticky walls. */
export function moveFloorPlanPosition(nav: FloorPlanNavigation, from: NavPoint, desired: NavPoint): NavPoint {
  if (!canOccupyFloorPlan(nav, ...from)) return [...nav.spawn];
  if (!desired.every(Number.isFinite)) return [...from];
  const dx = desired[0] - from[0], dz = desired[1] - from[1], distance = Math.hypot(dx, dz);
  if (distance < EPS) return [...from];
  const step = nav.radiusM * 0.45, count = Math.min(4096, Math.ceil(distance / step));
  const fraction = Math.min(1, count * step / distance);
  const vx = dx * fraction / count, vz = dz * fraction / count;
  let p: NavPoint = [...from];
  for (let i = 0; i < count; i++) {
    if (canOccupyFloorPlan(nav, p[0] + vx, p[1] + vz)) { p = [p[0] + vx, p[1] + vz]; continue; }
    const axes = Math.abs(vx) >= Math.abs(vz) ? [0, 1] : [1, 0];
    for (const axis of axes) {
      const next: NavPoint = axis === 0 ? [p[0] + vx, p[1]] : [p[0], p[1] + vz];
      if (canOccupyFloorPlan(nav, ...next)) p = next;
    }
  }
  return p;
}
