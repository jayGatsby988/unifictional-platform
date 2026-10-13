import { Matrix4, Vector3 } from 'three';
import type { ScannedElement } from '@/lib/spec/types';
import { scannedWallOutline, openingOnScannedWall } from '@/components/scene/scanned-geometry';

type P = { x: number; y: number };
type Interval = [number, number];
const cross = (a: P, b: P) => a.x * b.y - a.y * b.x;
function merge(intervals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && interval[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], interval[1]);
    else out.push([...interval]);
  }
  return out;
}
function slices(polygons: P[][], x: number): Interval[] {
  return merge(polygons.flatMap(polygon => {
    const ys: number[] = [];
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) ys.push(a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
    });
    ys.sort((a, b) => a - b);
    const intervals: Interval[] = [];
    for (let i = 0; i + 1 < ys.length; i += 2) intervals.push([ys[i], ys[i + 1]]);
    return intervals;
  }));
}
const length = (intervals: Interval[]) => intervals.reduce((sum, [lo, hi]) => sum + Math.max(0, hi - lo), 0);
/** Exact piecewise-linear vertical sweep: union wall pieces before subtracting
 * the union of openings. Repeated/split captures never multiply paint area. */
export function unionPolygonArea(polygons: P[][], holes: P[][] = []): { gross: number; net: number; incomplete: boolean } {
  const all = [...polygons, ...holes];
  const edges = all.flatMap(polygon => polygon.map((a, i) => ({ a, b: polygon[(i + 1) % polygon.length] })));
  // Strict import bounds still allow thousands of polygon corners. Exclude
  // an over-complex takeoff for review rather than freezing the mobile thread.
  if (edges.length > 2048) return { gross: 0, net: 0, incomplete: true };
  const events = edges.flatMap(edge => [edge.a.x, edge.b.x]);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const { a, b } = edges[i], { a: c, b: d } = edges[j];
    if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) continue;
    const ab = { x: b.x - a.x, y: b.y - a.y }, cd = { x: d.x - c.x, y: d.y - c.y }, ac = { x: c.x - a.x, y: c.y - a.y };
    const determinant = cross(ab, cd);
    if (Math.abs(determinant) < 1e-12) continue;
    const t = cross(ac, cd) / determinant, u = cross(ac, ab) / determinant;
    if (t > 0 && t < 1 && u > 0 && u < 1) { events.push(a.x + t * ab.x); if (events.length > 16384) return { gross: 0, net: 0, incomplete: true }; }
  }
  if (events.length > 16384) return { gross: 0, net: 0, incomplete: true };
  const xs = [...new Set(events)].sort((a, b) => a - b);
  let gross = 0, net = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const dx = xs[i + 1] - xs[i];
    if (dx < 1e-12) continue;
    const x = (xs[i + 1] + xs[i]) / 2, walls = slices(polygons, x), openings = slices(holes, x);
    const area = length(walls);
    const cut = walls.reduce((sum, wall) => sum + openings.reduce((n, hole) => n + Math.max(0, Math.min(wall[1], hole[1]) - Math.max(wall[0], hole[0])), 0), 0);
    gross += area * dx; net += Math.max(0, area - cut) * dx;
  }
  return { gross, net, incomplete: false };
}
export function scannedWallQuantities(walls: ScannedElement[], openings: ScannedElement[]) {
  const groups: Array<{ reference: ScannedElement; walls: ScannedElement[]; inverse: Matrix4; normal: Vector3; origin: Vector3 }> = [];
  for (const wall of walls) {
    const m = new Matrix4().fromArray(wall.transform), normal = new Vector3(0, 0, 1).transformDirection(m), origin = new Vector3().setFromMatrixPosition(m);
    const group = groups.find(group => Math.abs(group.normal.dot(normal)) > 0.99999 && Math.abs(origin.clone().sub(group.origin).dot(group.normal)) <= 0.005);
    if (group) group.walls.push(wall); else groups.push({ reference: wall, walls: [wall], inverse: m.clone().invert(), normal, origin });
  }
  // Retained metadata must not silently turn a cut-off or curved wall's
  // rectangular preview into a complete, measured wall takeoff. Old captures
  // without this channel retain their existing provisional quantities.
  let wallAreaSquareMeters = 0, netWallAreaSquareMeters = 0, perimeterMeters = 0;
  let incompleteWallCoverage = walls.some(wall => !!wall.curve || (wall.completedEdges !== undefined
    && !(['top', 'right', 'bottom', 'left'] as const).every(edge => wall.completedEdges!.includes(edge))));
  for (const group of groups) {
    const polygons = group.walls.map(wall => {
      const map = group.inverse.clone().multiply(new Matrix4().fromArray(wall.transform));
      return scannedWallOutline(wall).map(p => new Vector3(p.x, p.y, p.z).applyMatrix4(map)).map(p => ({ x: p.x, y: p.y }));
    });
    const holes = group.walls.flatMap(wall => {
      const map = group.inverse.clone().multiply(new Matrix4().fromArray(wall.transform));
      return openings.flatMap(opening => {
        const points = openingOnScannedWall(wall, opening);
        return points ? [points.map(p => new Vector3(p.x, p.y, 0).applyMatrix4(map)).map(p => ({ x: p.x, y: p.y }))] : [];
      });
    });
    const area = unionPolygonArea(polygons, holes);
    incompleteWallCoverage ||= area.incomplete;
    wallAreaSquareMeters += area.gross; netWallAreaSquareMeters += area.net;
    perimeterMeters += length(merge(polygons.map(p => [Math.min(...p.map(v => v.x)), Math.max(...p.map(v => v.x))])));
  }
  return { wallAreaSquareMeters, netWallAreaSquareMeters, perimeterMeters, incompleteWallCoverage };
}
