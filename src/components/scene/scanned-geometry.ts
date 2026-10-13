/** Pure measured-surface builders. No four-wall, right-angle, or shared-ceiling assumption. */
import * as THREE from 'three';
import type { ScannedElement, ScannedRoomGeometry } from '@/lib/spec/types';
import { applyWorldUVs } from './geometry';

type Point2 = { x: number; y: number };
type Point3 = { x: number; y: number; z: number };
const EPS = 1e-7;
const cross = (a: Point2, b: Point2, p: Point2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const area = (p: Point2[]) => p.reduce((sum, q, i) => sum + q.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * q.y, 0) / 2;

function cleanPolygon<T extends Point2>(points: T[]): T[] {
  const clean = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > EPS);
  if (clean.length > 1 && Math.hypot(clean[0].x - clean.at(-1)!.x, clean[0].y - clean.at(-1)!.y) <= EPS) clean.pop();
  return clean;
}

/** Reject a bow-tie/backtracking outline; never fill its convex hull or a bounding rectangle. */
export function isSimpleScanPolygon(points: Point2[]): boolean {
  const p = cleanPolygon(points);
  if (p.length < 3 || p.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y)) || Math.abs(area(p)) < 0.0001) return false;
  const onSegment = (a: Point2, b: Point2, q: Point2) => Math.abs(cross(a, b, q)) < EPS
    && q.x >= Math.min(a.x, b.x) - EPS && q.x <= Math.max(a.x, b.x) + EPS
    && q.y >= Math.min(a.y, b.y) - EPS && q.y <= Math.max(a.y, b.y) + EPS;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], prev = p[(i - 1 + p.length) % p.length];
    if (Math.abs(cross(prev, a, b)) < EPS && (a.x - prev.x) * (b.x - a.x) + (a.y - prev.y) * (b.y - a.y) < -EPS) return false;
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
      const c = p[j], d = p[(j + 1) % p.length];
      if ((cross(a, b, c) * cross(a, b, d) < -EPS && cross(c, d, a) * cross(c, d, b) < -EPS)
        || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return false;
    }
  }
  return true;
}

function clippedHalfPlane(subject: Point2[], a: Point2, b: Point2, inside: boolean): Point2[] {
  const result: Point2[] = [];
  const sign = inside ? 1 : -1;
  for (let i = 0; i < subject.length; i++) {
    const p = subject[i], q = subject[(i + 1) % subject.length];
    const dp = cross(a, b, p) * sign, dq = cross(a, b, q) * sign;
    if (dp >= -EPS) result.push(p);
    if ((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS)) {
      const t = dp / (dp - dq);
      result.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return cleanPolygon(result);
}

/** Convex subtraction also works when an opening crosses a wall edge or overlaps another opening. */
function subtractConvex(subject: Point2[], opening: Point2[]): Point2[][] {
  const clip = area(opening) >= 0 ? opening : [...opening].reverse();
  let remaining = subject;
  const out: Point2[][] = [];
  for (let i = 0; i < clip.length && remaining.length >= 3; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const outside = clippedHalfPlane(remaining, a, b, false);
    if (outside.length >= 3 && Math.abs(area(outside)) > EPS) out.push(outside);
    remaining = clippedHalfPlane(remaining, a, b, true);
  }
  return out;
}

function triangleMesh(points: Point3[], triangles: number[][], upward = false): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const tri of triangles) {
    const [a, b, c] = tri.map((i) => points[i]);
    if (!a || !b || !c) continue;
    const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const ordered = upward && normalY < 0 ? [a, c, b] : [a, b, c];
    for (const p of ordered) positions.push(p.x, p.y, p.z);
    // Scan faces have no measured thickness. Both sides are visible; orbit cutaways are handled by the renderer.
    if (!upward) for (const p of [...ordered].reverse()) positions.push(p.x, p.y, p.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return applyWorldUVs(geometry);
}

export function scannedFloorGeometry(surface: ScannedElement): THREE.BufferGeometry | null {
  const points = cleanPolygon((surface.polygonCorners ?? []).map((p) => ({ x: p.x, y: p.z, height: p.y })));
  if (!isSimpleScanPolygon(points)) return null;
  const indices = THREE.ShapeUtils.triangulateShape(points.map((p) => new THREE.Vector2(p.x, p.y)), []);
  return triangleMesh(points.map((p) => ({ x: p.x, y: p.height, z: p.y })), indices, true);
}

function cornersXY(element: ScannedElement): THREE.Vector3[] {
  const x = element.dimensions.x / 2, y = element.dimensions.y / 2;
  return [new THREE.Vector3(-x, -y, 0), new THREE.Vector3(x, -y, 0), new THREE.Vector3(x, y, 0), new THREE.Vector3(-x, y, 0)];
}

/** An opening can cut two adjoining segments of the same physical wall. The tolerances associate planes only. */
export function openingOnScannedWall(wall: ScannedElement, opening: ScannedElement): Point2[] | null {
  if (wall.dimensions.x <= 0 || wall.dimensions.y <= 0 || opening.dimensions.x <= 0 || opening.dimensions.y <= 0) return null;
  const wallMatrix = new THREE.Matrix4().fromArray(wall.transform);
  const openingMatrix = new THREE.Matrix4().fromArray(opening.transform);
  const wallNormal = new THREE.Vector3(0, 0, 1).transformDirection(wallMatrix);
  const openingNormal = new THREE.Vector3(0, 0, 1).transformDirection(openingMatrix);
  if (Math.abs(wallNormal.dot(openingNormal)) < 0.96) return null;
  const local = wallMatrix.invert().multiply(openingMatrix);
  const corners = cornersXY(opening).map((p) => p.applyMatrix4(local));
  if (corners.some((p) => Math.abs(p.z) > 0.12)) return null;
  const points = corners.map((p) => ({ x: p.x, y: p.y }));
  if (Math.max(...points.map((p) => p.x)) <= -wall.dimensions.x / 2
    || Math.min(...points.map((p) => p.x)) >= wall.dimensions.x / 2
    || Math.max(...points.map((p) => p.y)) <= -wall.dimensions.y / 2
    || Math.min(...points.map((p) => p.y)) >= wall.dimensions.y / 2) return null;
  return points;
}

/** Only the observed perimeter, with no mesh triangulation diagonals or opening subdivisions. */
export function scannedWallOutline(wall: ScannedElement): Point3[] {
  const inverse = new THREE.Matrix4().fromArray(wall.transform).invert();
  const measured = wall.polygonCorners?.map((p) => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(inverse));
  const validMeasured = measured && measured.every((p) => Math.abs(p.z) < 0.02) && isSimpleScanPolygon(measured);
  return cleanPolygon((validMeasured ? measured : cornersXY(wall)).map((p) => ({ x: p.x, y: p.y, z: p.z })));
}

function scannedWallPieces(wall: ScannedElement, openings: ScannedElement[]): Point2[][] {
  const outline = scannedWallOutline(wall);
  let parts: Point2[][] = THREE.ShapeUtils.triangulateShape(outline.map((p) => new THREE.Vector2(p.x, p.y)), []).map((tri) => tri.map((i) => outline[i]));
  for (const opening of openings) {
    const hole = openingOnScannedWall(wall, opening);
    if (hole) parts = parts.flatMap((piece) => subtractConvex(piece, hole));
  }
  return parts;
}

/** Net one-sided square meters, sharing the renderer's clipping and overlap treatment. */
export function scannedWallArea(wall: ScannedElement, openings: ScannedElement[]): number {
  return scannedWallPieces(wall, openings).reduce((sum, piece) => sum + Math.abs(area(piece)), 0);
}

export function scannedWallGeometry(wall: ScannedElement, openings: ScannedElement[]): THREE.BufferGeometry {
  const parts = scannedWallPieces(wall, openings);
  const points: Point3[] = [], triangles: number[][] = [];
  for (const piece of parts) {
    const offset = points.length;
    points.push(...piece.map((p) => ({ x: p.x, y: p.y, z: 0 })));
    for (let i = 1; i < piece.length - 1; i++) triangles.push([offset, offset + i, offset + i + 1]);
  }
  return triangleMesh(points, triangles);
}

function pointInside(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Determine the interior side from the actual floor, including concave rooms. */
export function scannedWallInteriorSign(wall: ScannedElement, geometry: ScannedRoomGeometry): 1 | -1 {
  const m = wall.transform;
  const floors = geometry.surfaces.filter((s) => s.kind === 'floor').map((s) => (s.polygonCorners ?? []).map((p) => ({ x: p.x, y: p.z }))).filter(isSimpleScanPolygon);
  for (const offset of [0.08, 0.25]) {
    const plus = { x: m[12] + m[8] * offset, y: m[14] + m[10] * offset };
    const minus = { x: m[12] - m[8] * offset, y: m[14] - m[10] * offset };
    const a = floors.some((floor) => pointInside(plus, floor)), b = floors.some((floor) => pointInside(minus, floor));
    if (a !== b) return a ? 1 : -1;
  }
  // In a partial scan there may be no floor yet. Keep the side facing the normalized room centre.
  return -m[12] * m[8] - m[14] * m[10] >= 0 ? 1 : -1;
}
