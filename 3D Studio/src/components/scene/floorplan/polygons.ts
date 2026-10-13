import { ShapeUtils, Vector2 } from 'three';
import type { Vec2 } from './layout';

const EPS = 1e-8;
export function polygonArea(ring: Vec2[]): number {
  return ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
}

function triangles(ring: Vec2[]): Vec2[][] {
  return ShapeUtils.triangulateShape(ring.map(([x, y]) => new Vector2(x, y)), []).map((ids) => {
    const t = ids.map((i) => ring[i]);
    return polygonArea(t) < 0 ? t.reverse() : t;
  });
}

/** Clip a convex polygon to one half-plane, preserving exact edge intersections. */
function halfPlane(ring: Vec2[], a: Vec2, b: Vec2, inside: boolean): Vec2[] {
  const side = (p: Vec2) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (inside ? 1 : -1);
  const out: Vec2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const sp = side(p), sq = side(q);
    if (sp >= -EPS) out.push(p);
    if ((sp > EPS && sq < -EPS) || (sp < -EPS && sq > EPS)) {
      const t = sp / (sp - sq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out.filter((p, i) => {
    const prev = out[(i + out.length - 1) % out.length];
    return Math.hypot(p[0] - prev[0], p[1] - prev[1]) > EPS;
  });
}

function subtractTriangle(subject: Vec2[], cut: Vec2[]): Vec2[][] {
  const xs = subject.map((p) => p[0]), ys = subject.map((p) => p[1]);
  const cx = cut.map((p) => p[0]), cy = cut.map((p) => p[1]);
  if (Math.max(...xs) <= Math.min(...cx) + EPS || Math.min(...xs) >= Math.max(...cx) - EPS
    || Math.max(...ys) <= Math.min(...cy) + EPS || Math.min(...ys) >= Math.max(...cy) - EPS) return [subject];
  let remainder = subject;
  const outside: Vec2[][] = [];
  for (let i = 0; i < 3 && remainder.length >= 3; i++) {
    const a = cut[i], b = cut[(i + 1) % 3];
    const piece = halfPlane(remainder, a, b, false);
    if (piece.length >= 3 && Math.abs(polygonArea(piece)) > EPS) outside.push(piece);
    remainder = halfPlane(remainder, a, b, true);
  }
  return outside;
}

/**
 * Floor minus stair shafts, including concave rooms, rotated shafts, and shafts
 * crossing the room boundary. Clamping hole vertices to a room's bounding box
 * both filled real stair openings and removed floor outside concave rooms.
 * Triangulation makes both rings convex pieces; exact half-plane subtraction
 * gives disjoint polygons without inventing a lip across an open stairwell.
 */
export function floorSurfacePolygons(ring: Vec2[], holes: Vec2[][]): Vec2[][] {
  let pieces = triangles(ring);
  for (const hole of holes) {
    for (const cut of triangles(hole)) {
      pieces = pieces.flatMap((piece) => subtractTriangle(piece, cut));
    }
  }
  return pieces;
}
