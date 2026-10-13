import { ShapeUtils, Vector2 } from "three";
import type { ScannedElement } from "@/lib/spec/types";
import type { ObservedMesh } from "@/lib/native/mesh-archive";
import type { ScannedObjectPresentation } from "./scanned-object-layout";

type V = [number, number, number];
type P = [number, number];
type Triangle = { id: number; p: V[]; center: V; normal: V; area: number };
type Plane = {
  kind: "body" | "countertop";
  n: V;
  offset: number;
  triangles: Triangle[];
  origin: V;
  u: V;
  v: V;
};
export interface ScannedIslandPanel {
  id: string;
  objectId: string;
  slot: "island_cabinets" | "island_countertop";
  kind: Plane["kind"];
  /** Derived positions in the captured object's local frame. */
  positions: Float32Array;
  /** Camera appearance uses this same face in world coordinates. */
  origin: V;
  unitU: V;
  unitV: V;
  widthMeters: number;
  heightMeters: number;
  sourceTriangleIndices: Uint32Array;
  observedArea: number;
  inferredFillArea: number;
  /** Source winding evidence, used only to distinguish paired slab faces. */
  sourceFacingY?: number;
}
export interface ScannedIslandShell {
  panels: ScannedIslandPanel[];
  partial: true;
  resolutionMeters: number;
  maximumPlaneFitMeters: number;
  inferredFillArea: number;
  sourceTriangles: number;
  inferredFloorSupportArea?: number;
  inferredWorkingCap?: true;
  maximumEndpointCompletionMeters?: number;
  maximumCornerDistanceMeters?: number;
}
const GRID = 0.02,
  FIT = 0.02,
  MAX_CANDIDATES = 60_000,
  MAX_CELLS = 60_000,
  MAX_WORK = 1_500_000;
const minimum = (values: number[]) =>
  values.reduce((a, b) => Math.min(a, b), Infinity);
const maximum = (values: number[]) =>
  values.reduce((a, b) => Math.max(a, b), -Infinity);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const minus = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const point = (t: number[], p: V): V =>
  [0, 1, 2].map(
    (a) => t[12 + a] + t[a] * p[0] + t[4 + a] * p[1] + t[8 + a] * p[2],
  ) as V;
const direction = (t: number[], p: V): V =>
  [0, 1, 2].map((a) => t[a] * p[0] + t[4 + a] * p[1] + t[8 + a] * p[2]) as V;
function local(t: number[], p: V): V {
  const d: V = [p[0] - t[12], p[1] - t[13], p[2] - t[14]];
  return [
    dot(d, [t[0], t[1], t[2]]),
    dot(d, [t[4], t[5], t[6]]),
    dot(d, [t[8], t[9], t[10]]),
  ];
}
function median(values: Array<{ value: number; weight: number }>): number {
  values.sort((a, b) => a.value - b.value);
  let sum = 0;
  const half = values.reduce((n, p) => n + p.weight, 0) / 2;
  for (const p of values) {
    sum += p.weight;
    if (sum >= half) return p.value;
  }
  return values.at(-1)?.value ?? 0;
}
function area(p: P[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const b = p[(i + 1) % p.length];
    a += p[i][0] * b[1] - b[0] * p[i][1];
  }
  return a / 2;
}
function half(subject: P[], a: P, b: P, sign: number): P[] {
  const output: P[] = [];
  const distance = (p: P) =>
    ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * sign;
  for (let i = 0; i < subject.length; i++) {
    const p = subject[i],
      q = subject[(i + 1) % subject.length],
      dp = distance(p),
      dq = distance(q);
    if (dp >= -1e-12) output.push(p);
    if ((dp > 1e-12 && dq < -1e-12) || (dp < -1e-12 && dq > 1e-12)) {
      const t = dp / (dp - dq);
      output.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return output;
}
function subtract(subject: P[], triangle: P[]): P[][] {
  const clip = area(triangle) >= 0 ? triangle : [...triangle].reverse(),
    outside: P[][] = [];
  let remaining = subject;
  for (let i = 0; i < 3 && remaining.length >= 3; i++) {
    const part = half(remaining, clip[i], clip[(i + 1) % 3], -1);
    if (part.length >= 3 && Math.abs(area(part)) > 1e-12) outside.push(part);
    remaining = half(remaining, clip[i], clip[(i + 1) % 3], 1);
  }
  return outside;
}
function fittedPlane(
  seed: Triangle[],
  kind: Plane["kind"],
): { n: V; offset: number } {
  if (kind === "countertop")
    return {
      n: [0, 1, 0],
      offset: median(seed.map((t) => ({ value: t.center[1], weight: t.area }))),
    };
  const reference = seed[0].normal;
  let nx = 0,
    nz = 0;
  for (const t of seed) {
    const sign = dot(t.normal, reference) < 0 ? -1 : 1;
    nx += t.normal[0] * sign * t.area;
    nz += t.normal[2] * sign * t.area;
  }
  const length = Math.hypot(nx, nz);
  let n: V = [nx / length, 0, nz / length];
  // Fit the horizontal line to source vertices. Its smallest principal axis is
  // a plane normal; separate planes are never averaged into a hull.
  if (seed.length > 2) {
    let total = 0,
      cx = 0,
      cz = 0;
    for (const t of seed)
      for (const p of t.p) {
        total += t.area;
        cx += p[0] * t.area;
        cz += p[2] * t.area;
      }
    cx /= total;
    cz /= total;
    let xx = 0,
      xz = 0,
      zz = 0;
    for (const t of seed)
      for (const p of t.p) {
        xx += (p[0] - cx) ** 2 * t.area;
        xz += (p[0] - cx) * (p[2] - cz) * t.area;
        zz += (p[2] - cz) ** 2 * t.area;
      }
    const angle = 0.5 * Math.atan2(2 * xz, xx - zz),
      candidate: V = [-Math.sin(angle), 0, Math.cos(angle)];
    if (Math.abs(dot(candidate, n)) > 0.96)
      n = dot(candidate, n) < 0 ? (candidate.map((x) => -x) as V) : candidate;
  }
  return {
    n,
    offset: median(
      seed.map((t) => ({ value: dot(n, t.center), weight: t.area })),
    ),
  };
}
function findPlanes(triangles: Triangle[], kind: Plane["kind"]): Plane[] {
  const remaining = new Set(triangles),
    out: Plane[] = [];
  for (
    let pass = 0;
    pass < 18 && out.length < (kind === "body" ? 10 : 4);
    pass++
  ) {
    const buckets = new Map<string, Triangle[]>();
    for (const t of remaining) {
      if (kind === "body" && Math.abs(t.normal[1]) > 0.2) continue;
      let key: string;
      if (kind === "countertop") key = String(Math.round(t.center[1] / 0.01));
      else {
        let a = Math.atan2(t.normal[2], t.normal[0]);
        if (a < 0) a += Math.PI;
        if (a >= Math.PI) a -= Math.PI;
        const bin = Math.round(a / (Math.PI / 36));
        const n: V = [
          Math.cos((bin * Math.PI) / 36),
          0,
          Math.sin((bin * Math.PI) / 36),
        ];
        key = `${bin}:${Math.round(dot(n, t.center) / 0.02)}`;
      }
      const bucket = buckets.get(key) ?? [];
      bucket.push(t);
      buckets.set(key, bucket);
    }
    const seed = [...buckets.values()].sort(
      (a, b) =>
        b.reduce((s, t) => s + t.area, 0) - a.reduce((s, t) => s + t.area, 0),
    )[0];
    if (!seed) break;
    let fit = fittedPlane(seed, kind),
      admitted: Triangle[] = [];
    for (let iteration = 0; iteration < 2; iteration++) {
      admitted = [...remaining].filter(
        (t) =>
          Math.abs(dot(t.normal, fit.n)) > (kind === "body" ? 0.94 : 0.8) &&
          t.p.every((p) => Math.abs(dot(fit.n, p) - fit.offset) <= FIT),
      );
      if (admitted.length < 2) break;
      fit = fittedPlane(admitted, kind);
    }
    admitted = [...remaining].filter(
      (t) =>
        Math.abs(dot(t.normal, fit.n)) > (kind === "body" ? 0.5 : 0.8) &&
        t.p.every((p) => Math.abs(dot(fit.n, p) - fit.offset) <= FIT),
    );
    seed.forEach((t) => remaining.delete(t));
    if (admitted.reduce((s, t) => s + t.area, 0) < 0.09) continue;
    if (kind === "body") {
      const ys = admitted.flatMap((t) => t.p.map((p) => p[1]));
      if (maximum(ys) - minimum(ys) < 0.4) continue;
    }
    admitted.forEach((t) => remaining.delete(t));
    const u: V = kind === "body" ? [fit.n[2], 0, -fit.n[0]] : [1, 0, 0],
      v: V = kind === "body" ? [0, 1, 0] : [0, 0, 1];
    out.push({
      kind,
      ...fit,
      triangles: admitted,
      origin: fit.n.map((x) => x * fit.offset) as V,
      u,
      v,
    });
  }
  return out;
}
const key = (x: number, y: number) => `${x},${y}`;
function coveredGrid(
  plane: Plane,
  budget: { work: number },
): { cells: Map<string, P>; fill: number } | null {
  const uncovered = new Map<string, P[][]>(),
    covered = new Map<string, P>(),
    blocked = new Set<string>();
  for (const triangle of plane.triangles) {
    const p = triangle.p.map((p) => {
      const d = minus(p, plane.origin);
      return [dot(d, plane.u), dot(d, plane.v)] as P;
    });
    if (Math.abs(area(p)) < 1e-10) continue;
    const x0 = Math.floor(Math.min(...p.map((p) => p[0])) / GRID),
      x1 = Math.floor(Math.max(...p.map((p) => p[0])) / GRID),
      y0 = Math.floor(Math.min(...p.map((p) => p[1])) / GRID),
      y1 = Math.floor(Math.max(...p.map((p) => p[1])) / GRID);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) return null;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (++budget.work > MAX_WORK) return null;
        const id = key(x, y);
        if (covered.has(id) || blocked.has(id)) continue;
        if (uncovered.size + covered.size > MAX_CELLS) return null;
        const square: P[] = [
          [x * GRID, y * GRID],
          [(x + 1) * GRID, y * GRID],
          [(x + 1) * GRID, (y + 1) * GRID],
          [x * GRID, (y + 1) * GRID],
        ];
        const rest = (uncovered.get(id) ?? [square]).flatMap((poly) =>
          subtract(poly, p),
        );
        if (!rest.length) {
          covered.set(id, [x, y]);
          uncovered.delete(id);
        } else if (rest.length > 24) {
          blocked.add(id);
          uncovered.delete(id);
        } else uncovered.set(id, rest);
      }
  }
  if (covered.size * GRID * GRID < 0.08) return null;
  // Evidence area counts only fully observed cells. All later face/cap
  // completion is accounted separately as inferred area.
  return { cells: covered, fill: 0 };
}
/** A clean vertical face needs the same continuous section at seven of nine
 * independent heights. Only2cm section seams may join; persistent open gaps
 * split the face. The surface between those observations is explicit inference. */
function bodySections(
  plane: Plane,
  source: Triangle[] = plane.triangles,
): Array<[number, number, number, number]> {
  const candidates = source.filter(
    (t) =>
      Math.min(...t.p.map((p) => dot(plane.n, p) - plane.offset)) <= FIT &&
      Math.max(...t.p.map((p) => dot(plane.n, p) - plane.offset)) >= -FIT,
  );
  const projected = candidates.map((t) =>
    t.p.map((p) => {
      const d = minus(p, plane.origin);
      return [
        dot(d, plane.u),
        dot(d, plane.v),
        dot(plane.n, p) - plane.offset,
      ] as [number, number, number];
    }),
  );
  if (!projected.length) return [];
  const ys = projected
    .flat()
    .map((p) => p[1])
    .sort((a, b) => a - b);
  const intervalsAt = (y: number): Array<[number, number]> => {
    const intervals: Array<[number, number]> = [];
    for (const triangle of projected) {
      const hits: number[] = [];
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge],
          b = triangle[(edge + 1) % 3];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const f = (y - a[1]) / (b[1] - a[1]);
          if (Math.abs(a[2] + (b[2] - a[2]) * f) <= FIT)
            hits.push(a[0] + (b[0] - a[0]) * f);
        }
      }
      if (hits.length === 2)
        intervals.push([Math.min(...hits), Math.max(...hits)]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const interval of intervals) {
      const prior = merged.at(-1);
      if (prior && interval[0] - prior[1] <= 0.02)
        prior[1] = Math.max(prior[1], interval[1]);
      else merged.push([...interval]);
    }
    return merged;
  };
  const bottom = ys[0],
    top = ys.at(-1)!;
  if (top - bottom < 0.4) return [];
  const step = 0.04,
    levels: Array<{ y: number; width: number }> = [];
  for (let y = bottom + step / 2; y < top; y += step)
    levels.push({
      y,
      width: Math.max(0, ...intervalsAt(y).map((p) => p[1] - p[0])),
    });
  const maximum = Math.max(...levels.map((p) => p.width)),
    threshold = Math.max(0.2, maximum * 0.4);
  let bestStart = -1,
    bestEnd = -1,
    bandStart = -1;
  for (let i = 0; i <= levels.length; i++) {
    if (i < levels.length && levels[i].width >= threshold) {
      if (bandStart < 0) bandStart = i;
    } else if (bandStart >= 0) {
      if (i - bandStart > bestEnd - bestStart) {
        bestStart = bandStart;
        bestEnd = i;
      }
      bandStart = -1;
    }
  }
  if (bestStart < 0) return [];
  // Dense clutter above a cabinet cannot stretch the whole clean face upward.
  const low = Math.max(bottom, levels[bestStart].y - step / 2),
    high = Math.min(top, levels[bestEnd - 1].y + step / 2);
  if (high - low < 0.4) return [];
  const events: Array<{ x: number; level: number; delta: number }> = [];
  for (let level = 0; level < 9; level++) {
    const y = low + ((high - low) * (level + 1)) / 10;
    for (const [a, b] of intervalsAt(y))
      events.push({ x: a, level, delta: 1 }, { x: b, level, delta: -1 });
  }
  events.sort((a, b) => a.x - b.x);
  const count = new Array<number>(9).fill(0),
    intervals: Array<[number, number, number, number]> = [];
  let start: number | null = null;
  for (let i = 0; i < events.length;) {
    const x = events[i].x;
    while (i < events.length && Math.abs(events[i].x - x) < 1e-10) {
      count[events[i].level] += events[i].delta;
      i++;
    }
    const supported = count.filter((c) => c > 0).length >= 7;
    if (supported && start === null) start = x;
    if (!supported && start !== null) {
      if (x - start >= 0.2) intervals.push([start, low, x, high]);
      start = null;
    }
  }
  return intervals;
}
function rectangles(
  cells: Map<string, P>,
): Array<[number, number, number, number]> {
  const rows = new Map<number, number[]>();
  for (const [x, y] of cells.values()) {
    const row = rows.get(y) ?? [];
    row.push(x);
    rows.set(y, row);
  }
  const done: Array<[number, number, number, number]> = [],
    active = new Map<string, [number, number, number, number]>();
  let previous = -Infinity;
  for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
    if (y !== previous + 1) {
      done.push(...active.values());
      active.clear();
    }
    previous = y;
    xs.sort((a, b) => a - b);
    const runs: Array<[number, number]> = [];
    for (let i = 0; i < xs.length;) {
      const start = xs[i];
      let end = start;
      while (++i < xs.length && xs[i] === end + 1) end = xs[i];
      runs.push([start, end + 1]);
    }
    const found = new Set<string>();
    for (const [x0, x1] of runs) {
      const k = `${x0}:${x1}`;
      found.add(k);
      const prior = active.get(k);
      if (prior) prior[3] = y + 1;
      else active.set(k, [x0, y, x1, y + 1]);
    }
    for (const [k, r] of active)
      if (!found.has(k)) {
        done.push(r);
        active.delete(k);
      }
  }
  done.push(...active.values());
  return done;
}
/** Intersect adjacent fitted body planes only with multi-height source support.
 * End completion is bounded to25cm along each plane, and every corner must lie
 * within3.5cm of observed cross sections at four of five heights. Persistent
 * openings, disconnected shells and opposing parallel faces cannot close a cap. */
function completeWorkingCap(
  panels: ScannedIslandPanel[],
  object: ScannedObjectPresentation,
  source: Triangle[],
  otherObjects: readonly ScannedObjectPresentation[],
): boolean {
  const body = panels.filter((p) => p.kind === "body");
  if (
    body.length < 3 ||
    body.length > 12 ||
    body.some((p) => p.positions.length % 18 !== 0)
  )
    return false;
  const cornerSupported = (p: P, low: number, high: number) => {
    if (high - low < 0.4) return false;
    const candidates = source.filter(
      (t) =>
        p[0] >= Math.min(...t.p.map((p) => p[0])) - 0.035 &&
        p[0] <= Math.max(...t.p.map((p) => p[0])) + 0.035 &&
        p[1] >= Math.min(...t.p.map((p) => p[2])) - 0.035 &&
        p[1] <= Math.max(...t.p.map((p) => p[2])) + 0.035,
    );
    let supported = 0;
    for (let level = 0; level < 5; level++) {
      const y = low + (high - low) * (0.2 + level * 0.15);
      let closest = Infinity;
      for (const triangle of candidates) {
        const hits: P[] = [];
        for (let edge = 0; edge < 3; edge++) {
          const a = triangle.p[edge],
            b = triangle.p[(edge + 1) % 3];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
            const t = (y - a[1]) / (b[1] - a[1]);
            hits.push([a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t]);
          }
        }
        if (hits.length === 2) {
          const [a, b] = hits,
            u: P = [b[0] - a[0], b[1] - a[1]],
            t = Math.max(
              0,
              Math.min(
                1,
                ((p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]) /
                  (u[0] * u[0] + u[1] * u[1] + 1e-20),
              ),
            );
          closest = Math.min(
            closest,
            Math.hypot(p[0] - a[0] - t * u[0], p[1] - a[1] - t * u[1]),
          );
        }
      }
      if (closest <= 0.035) supported++;
    }
    return supported >= 4;
  };
  for (const panel of body)
    if (panel.positions.length > 18) {
      const faces: Array<{ a: V; b: V }> = [];
      for (let at = 0; at < panel.positions.length; at += 18)
        faces.push({
          a: [
            panel.positions[at],
            panel.positions[at + 1],
            panel.positions[at + 2],
          ],
          b: [
            panel.positions[at + 3],
            panel.positions[at + 4],
            panel.positions[at + 5],
          ],
        });
      const along = minus(faces[0].b, faces[0].a),
        length = Math.hypot(...along),
        unit = along.map((n) => n / length) as V;
      faces.sort((a, b) => dot(a.a, unit) - dot(b.a, unit));
      const low = panel.positions[1],
        high = panel.positions[7];
      for (let i = 1; i < faces.length; i++) {
        const a = faces[i - 1].b,
          b = faces[i].a,
          gap = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (gap > 0.25) return false;
        for (let n = 0; n <= Math.ceil(gap / 0.02); n++) {
          const f = n / Math.max(1, Math.ceil(gap / 0.02));
          if (
            !cornerSupported(
              [a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f],
              low,
              high,
            )
          )
            return false;
        }
      }
      const a = faces[0].a,
        b = faces.at(-1)!.b;
      panel.positions = new Float32Array([
        ...a,
        ...b,
        b[0],
        high,
        b[2],
        ...a,
        b[0],
        high,
        b[2],
        a[0],
        high,
        a[2],
      ]);
      panel.inferredFillArea = Math.max(
        panel.inferredFillArea,
        Math.hypot(b[0] - a[0], b[2] - a[2]) * (high - low) -
          panel.observedArea,
      );
    }
  const endpoints = body.flatMap((panel, face) =>
    [0, 3].map((at, end) => ({
      face,
      end,
      p: [panel.positions[at], panel.positions[at + 2]] as P,
    })),
  );
  const joins = new Map<number, { other: number; p: P }>();
  for (let i = 0; i < endpoints.length; i++) {
    const a = endpoints[i],
      pa = body[a.face],
      a0: P = [pa.positions[0], pa.positions[2]],
      a1: P = [pa.positions[3], pa.positions[5]],
      u: P = [a1[0] - a0[0], a1[1] - a0[1]];
    let best: { other: number; p: P; distance: number } | null = null;
    for (let j = 0; j < endpoints.length; j++) {
      const b = endpoints[j];
      if (a.face === b.face) continue;
      const pb = body[b.face],
        b0: P = [pb.positions[0], pb.positions[2]],
        b1: P = [pb.positions[3], pb.positions[5]],
        v: P = [b1[0] - b0[0], b1[1] - b0[1]];
      const determinant = u[0] * v[1] - u[1] * v[0];
      if (Math.abs(determinant) / (Math.hypot(...u) * Math.hypot(...v)) < 0.2)
        continue;
      const delta: P = [b0[0] - a0[0], b0[1] - a0[1]],
        along = (delta[0] * v[1] - delta[1] * v[0]) / determinant,
        p: P = [a0[0] + along * u[0], a0[1] + along * u[1]];
      const da = Math.hypot(p[0] - a.p[0], p[1] - a.p[1]),
        db = Math.hypot(p[0] - b.p[0], p[1] - b.p[1]);
      if (da > 0.25 || db > 0.25) continue;
      const low = Math.max(pa.positions[1], pb.positions[1]),
        high = Math.min(pa.positions[7], pb.positions[7]);
      if (!cornerSupported(p, low, high)) continue;
      if (!best || da + db < best.distance)
        best = { other: j, p, distance: da + db };
    }
    if (best) joins.set(i, best);
  }
  if (
    joins.size !== endpoints.length ||
    [...joins].some(([i, j]) => joins.get(j.other)?.other !== i)
  )
    return false;
  const ring: P[] = [],
    used = new Set<number>();
  let current = 0;
  for (let step = 0; step < body.length; step++) {
    const face = Math.floor(current / 2);
    if (used.has(face)) return false;
    used.add(face);
    ring.push(joins.get(current)!.p);
    const otherEnd = current % 2 === 0 ? current + 1 : current - 1;
    current = joins.get(otherEnd)!.other;
  }
  if (
    current !== 0 ||
    used.size !== body.length ||
    Math.abs(area(ring)) < 0.25 ||
    Math.abs(area(ring)) > object.dimensions.x * object.dimensions.z * 1.2
  )
    return false;
  const orientation = (a: P, b: P, c: P) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < ring.length; i++)
    for (let j = i + 2; j < ring.length; j++) {
      if ((j + 1) % ring.length === i) continue;
      const a = ring[i],
        b = ring[(i + 1) % ring.length],
        c = ring[j],
        d = ring[(j + 1) % ring.length];
      if (
        orientation(a, b, c) * orientation(a, b, d) < 0 &&
        orientation(c, d, a) * orientation(c, d, b) < 0
      )
        return false;
    }
  const countertopPanels = panels.filter((p) => p.kind === "countertop");
  // Oppositely oriented, overlapping nearby planes are the two observed faces
  // of a slab. Its lower face cannot establish the working height. Reversed
  // archive winding is supported; the relative signs, not a global sign, matter.
  let pairingWork = 0;
  const pairedUnderside = (lower: ScannedIslandPanel) =>
    countertopPanels.some((upper) => {
      const dy = upper.origin[1] - lower.origin[1];
      if (
        dy < 0.015 ||
        dy > 0.08 ||
        (upper.sourceFacingY ?? 0) * (lower.sourceFacingY ?? 0) > -0.49
      )
        return false;
      let covered = 0,
        total = 0;
      for (let at = 0; at < lower.positions.length; at += 9) {
        const p = lower.positions,
          a: P = [p[at], p[at + 2]],
          b: P = [p[at + 3], p[at + 5]],
          c: P = [p[at + 6], p[at + 8]],
          weight = Math.abs(area([a, b, c]));
        const center: P = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
        total += weight;
        for (let offset = 0; offset < upper.positions.length; offset += 9) {
          if (++pairingWork > 100_000) return false;
          const q = upper.positions,
            r: P[] = [
              [q[offset], q[offset + 2]],
              [q[offset + 3], q[offset + 5]],
              [q[offset + 6], q[offset + 8]],
            ],
            signs = r.map((v, i) => orientation(v, r[(i + 1) % 3], center));
          if (signs.every((n) => n >= -1e-8) || signs.every((n) => n <= 1e-8)) {
            covered += weight;
            break;
          }
        }
      }
      return total > 0 && covered / total >= 0.7;
    });
  const low = countertopPanels
    .filter((p) => p.observedArea >= 0.18 && !pairedUnderside(p))
    .sort((a, b) => a.origin[1] - b.origin[1])[0];
  if (!low || pairingWork > 100_000) return false;
  const height = local(object.transform, low.origin)[1];
  const holes: P[][] = [];
  for (const surface of object.countertopSurfaces ?? []) {
    if (
      surface.polygonCorners.some(
        (p) =>
          Math.abs(local(object.transform, [p.x, p.y, p.z])[1] - height) > 0.03,
      )
    )
      continue;
    for (const sourceHole of surface.holes ?? []) {
      if (holes.length >= 8 || sourceHole.length < 3 || sourceHole.length > 256)
        return false;
      const hole = sourceHole
        .map((p) => local(object.transform, [p.x, p.y, p.z]))
        .map((p) => [p[0], p[2]] as P);
      if (hole.some((p) => !p.every(Number.isFinite))) return false;
      holes.push(hole);
    }
  }
  const inside = (p: P, polygon: P[]) => {
    let contains = false;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        contains = !contains;
    }
    return contains;
  };
  // A detected sink is independent evidence of an opening. If no captured
  // opening boundary describes it, keep partial coverage rather than cap its bowl.
  for (const sink of otherObjects.filter((o) => o.role === "sink")) {
    if (sink.transform.length !== 16 || !sink.transform.every(Number.isFinite))
      continue;
    const rim = local(
      object.transform,
      point(sink.transform, [0, sink.dimensions.y / 2, 0]),
    );
    if (
      Math.abs(rim[1] - height) <= 0.08 &&
      inside([rim[0], rim[2]], ring) &&
      !holes.some((hole) => inside([rim[0], rim[2]], hole))
    )
      return false;
  }
  const holeTriangles = holes.flatMap((hole) =>
    ShapeUtils.triangulateShape(
      hole.map((p) => new Vector2(...p)),
      [],
    ).map((face) => face.map((i) => hole[i])),
  );
  const faces = ShapeUtils.triangulateShape(
    ring.map((p) => new Vector2(...p)),
    [],
  );
  if (faces.length !== ring.length - 2) return false;
  const capTriangles = faces.map((f) => f.map((i) => ring[i]));
  const positions: number[] = [];
  let clippingWork = 0;
  const add = (a: P, b: P, c: P) => {
    let pieces: P[][] = [[a, b, c]];
    // Explicitly recorded countertop holes take precedence over inferred fill.
    for (const hole of holeTriangles) {
      clippingWork += pieces.length;
      if (clippingWork > 100_000) return;
      pieces = pieces.flatMap((piece) => subtract(piece, hole));
    }
    for (const piece of pieces)
      for (let i = 1; i + 1 < piece.length; i++) {
        const a = piece[0];
        let [b, c] = [piece[i], piece[i + 1]];
        if (area([a, b, c]) > 0) [b, c] = [c, b];
        positions.push(
          a[0],
          height,
          a[1],
          b[0],
          height,
          b[1],
          c[0],
          height,
          c[1],
        );
      }
  };
  for (const [a, b, c] of capTriangles) add(a, b, c);
  // Preserve measured overhang outside the completed body loop without stacking
  // overlapping triangles at the working plane.
  for (let at = 0; at < low.positions.length; at += 9) {
    let pieces: P[][] = [
      [0, 3, 6].map(
        (i) => [low.positions[at + i], low.positions[at + i + 2]] as P,
      ),
    ];
    for (const triangle of capTriangles)
      pieces = pieces.flatMap((piece) => subtract(piece, triangle));
    for (const piece of pieces)
      for (let i = 1; i + 1 < piece.length; i++)
        add(piece[0], piece[i], piece[i + 1]);
  }
  if (clippingWork > 100_000 || !positions.length) return false;
  const all: Array<P> = [];
  for (let i = 0; i < positions.length; i += 3)
    all.push([positions[i], positions[i + 2]]);
  const x0 = minimum(all.map((p) => p[0])),
    x1 = maximum(all.map((p) => p[0])),
    z0 = minimum(all.map((p) => p[1])),
    z1 = maximum(all.map((p) => p[1]));
  let totalArea = 0;
  for (let i = 0; i < positions.length; i += 9)
    totalArea += Math.abs(
      area([
        [positions[i], positions[i + 2]],
        [positions[i + 3], positions[i + 5]],
        [positions[i + 6], positions[i + 8]],
      ]),
    );
  low.positions = new Float32Array(positions);
  low.origin = point(object.transform, [x0, height, z0]);
  low.unitU = direction(object.transform, [1, 0, 0]);
  low.unitV = direction(object.transform, [0, 0, 1]);
  low.widthMeters = x1 - x0;
  low.heightMeters = z1 - z0;
  low.inferredFillArea = Math.max(0, totalArea - low.observedArea);
  low.id = `${object.id}:inferred-working-cap`;
  for (let face = 0; face < body.length; face++) {
    const panel = body[face],
      a = joins.get(face * 2)!.p,
      b = joins.get(face * 2 + 1)!.p,
      y0 = panel.positions[1],
      y1 = panel.positions[7],
      localOrigin: V = [a[0], y0, a[1]],
      localU: V = [b[0] - a[0], 0, b[1] - a[1]],
      length = Math.hypot(...localU);
    panel.positions = new Float32Array([
      a[0],
      y0,
      a[1],
      b[0],
      y0,
      b[1],
      b[0],
      y1,
      b[1],
      a[0],
      y0,
      a[1],
      b[0],
      y1,
      b[1],
      a[0],
      y1,
      a[1],
    ]);
    panel.origin = point(object.transform, localOrigin);
    panel.unitU = direction(
      object.transform,
      localU.map((n) => n / length) as V,
    );
    panel.widthMeters = length;
    panel.inferredFillArea = Math.max(
      panel.inferredFillArea,
      length * panel.heightMeters - panel.observedArea,
    );
  }
  return true;
}
/** Continue an existing fitted face to a compatible measured support plane.
 * This closes only a short vertical sampling gap, not an unobserved footprint. */
function extendToMeasuredFloor(
  panels: ScannedIslandPanel[],
  object: ScannedObjectPresentation,
  floors: readonly ScannedElement[],
): number {
  if (floors.length > 32) return 0;
  const objectBottom = object.transform[13] - object.dimensions.y / 2;
  const supported = floors.flatMap((floor) => {
    const ring = floor.polygonCorners;
    if (
      floor.kind !== "floor" ||
      !ring ||
      ring.length < 3 ||
      ring.length > 256 ||
      ring.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
    )
      return [];
    const y = ring.reduce((sum, p) => sum + p.y, 0) / ring.length;
    if (
      Math.abs(y - objectBottom) > 0.025 ||
      ring.some((p) => Math.abs(p.y - y) > 0.005)
    )
      return [];
    const inside = (p: V) => {
      let inside = false;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          dx = b.x - a.x,
          dz = b.z - a.z;
        const f = Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a.x) * dx + (p[2] - a.z) * dz) /
              (dx * dx + dz * dz + 1e-20),
          ),
        );
        if (Math.hypot(p[0] - a.x - f * dx, p[2] - a.z - f * dz) < 1e-6)
          return true;
        if (
          a.z > p[2] !== b.z > p[2] &&
          p[0] < ((b.x - a.x) * (p[2] - a.z)) / (b.z - a.z) + a.x
        )
          inside = !inside;
      }
      return inside;
    };
    return [{ y, inside }];
  });
  let added = 0;
  for (const panel of panels) {
    if (panel.kind !== "body" || panel.positions.length !== 18) continue;
    const positions = panel.positions,
      bottom = positions[1],
      top = positions[7];
    const a: V = [positions[0], bottom, positions[2]],
      b: V = [positions[3], bottom, positions[5]];
    const floor = supported.find((f) => {
      const gap = point(object.transform, a)[1] - f.y;
      if (gap <= 0.002 || gap > 0.1) return false;
      const divisions = Math.max(1, Math.ceil(panel.widthMeters / 0.05));
      for (let i = 0; i <= divisions; i++)
        if (
          !f.inside(
            point(object.transform, [
              a[0] + ((b[0] - a[0]) * i) / divisions,
              bottom,
              a[2] + ((b[2] - a[2]) * i) / divisions,
            ]),
          )
        )
          return false;
      return true;
    });
    if (!floor) continue;
    const localBottom = floor.y - object.transform[13],
      extra = (bottom - localBottom) * panel.widthMeters;
    const next = positions.slice();
    for (let i = 1; i < next.length; i += 3)
      if (Math.abs(next[i] - bottom) < 1e-6) next[i] = localBottom;
    panel.positions = next;
    panel.origin = point(object.transform, [a[0], localBottom, a[2]]);
    panel.heightMeters = top - localBottom;
    panel.inferredFillArea += extra;
    added += extra;
  }
  return added;
}
const cache = new WeakMap<
  ObservedMesh,
  Map<string, { signature: string; result: ScannedIslandShell | null }>
>();
/** Clean display inference from observed surfaces. A source-supported closed
 * body loop can justify an explicitly inferred working cap; an open loop cannot.
 * No cabinet doors, source positions or estimator dimensions are changed.
 * Independent raised surfaces keep their observed coverage and heights. */
export function deriveScannedIslandShell(
  mesh: ObservedMesh,
  object: ScannedObjectPresentation,
  others: readonly ScannedObjectPresentation[] = [],
  floors: readonly ScannedElement[] = [],
): ScannedIslandShell | null {
  if (
    object.role !== "island" ||
    mesh.triangleCount < 1 ||
    mesh.triangleCount > 320_000 ||
    mesh.positions.length !== mesh.triangleCount * 9
  )
    return null;
  const d = object.dimensions,
    t = object.transform;
  if (
    t.length !== 16 ||
    !t.every(Number.isFinite) ||
    ![d.x, d.y, d.z].every((n) => Number.isFinite(n) && n > 0.1 && n < 8) ||
    Math.abs(t[5] - 1) > 0.001 ||
    Math.abs(t[1]) + Math.abs(t[4]) + Math.abs(t[6]) + Math.abs(t[9]) > 0.0001
  )
    return null;
  const axes: V[] = [
    [t[0], t[1], t[2]],
    [t[4], t[5], t[6]],
    [t[8], t[9], t[10]],
  ];
  if (
    axes.some((a) => Math.abs(dot(a, a) - 1) > 0.001) ||
    Math.abs(dot(axes[0], axes[1])) > 0.001 ||
    Math.abs(dot(axes[0], axes[2])) > 0.001 ||
    Math.abs(dot(axes[1], axes[2])) > 0.001 ||
    Math.abs(dot(cross(axes[0], axes[1]), axes[2]) - 1) > 0.001 ||
    Math.abs(t[3]) + Math.abs(t[7]) + Math.abs(t[11]) + Math.abs(t[15] - 1) >
      0.0001
  )
    return null;
  const blockers = others
    .filter(
      (o) =>
        o.id !== object.id &&
        o.transform.length === 16 &&
        o.transform.every(Number.isFinite),
    )
    .filter((o) => {
      const p = local(t, [o.transform[12], o.transform[13], o.transform[14]]),
        radius = Math.hypot(o.dimensions.x, o.dimensions.z) / 2;
      return (
        Math.abs(p[0]) <= d.x / 2 + 0.35 + radius &&
        Math.abs(p[2]) <= d.z / 2 + 0.35 + radius
      );
    });
  if (blockers.length > 64) return null;
  const signature = JSON.stringify([
    t,
    d,
    object.countertopSurfaces,
    blockers.map((o) => [o.id, o.transform, o.dimensions]),
    floors.map((f) => [f.id, f.transform, f.polygonCorners]),
  ]);
  let entries = cache.get(mesh);
  if (!entries) {
    entries = new Map();
    cache.set(mesh, entries);
  }
  const prior = entries.get(object.id);
  if (prior?.signature === signature) return prior.result;
  const body: Triangle[] = [],
    tops: Triangle[] = [];
  let limited = false;
  for (let id = 0; id < mesh.triangleCount; id++) {
    const at = id * 9;
    const center: V = [
      (mesh.positions[at] + mesh.positions[at + 3] + mesh.positions[at + 6]) /
        3,
      (mesh.positions[at + 1] +
        mesh.positions[at + 4] +
        mesh.positions[at + 7]) /
        3,
      (mesh.positions[at + 2] +
        mesh.positions[at + 5] +
        mesh.positions[at + 8]) /
        3,
    ];
    const c = local(t, center);
    if (
      Math.abs(c[0]) > d.x / 2 + 0.35 ||
      Math.abs(c[2]) > d.z / 2 + 0.35 ||
      c[1] < -d.y / 2 + 0.015 ||
      c[1] > d.y / 2 + 0.06
    )
      continue;
    if (
      blockers.some((o) => {
        const p = local(o.transform, center);
        return (
          Math.abs(p[0]) <= o.dimensions.x / 2 + 1e-5 &&
          Math.abs(p[1]) <= o.dimensions.y / 2 + 1e-5 &&
          Math.abs(p[2]) <= o.dimensions.z / 2 + 1e-5
        );
      })
    )
      continue;
    const p = [0, 3, 6].map((v) =>
      local(t, [
        mesh.positions[at + v],
        mesh.positions[at + v + 1],
        mesh.positions[at + v + 2],
      ]),
    );
    if (
      p.some(
        (p) =>
          !p.every(Number.isFinite) ||
          Math.abs(p[0]) > d.x / 2 + 0.35 ||
          Math.abs(p[2]) > d.z / 2 + 0.35 ||
          Math.abs(p[1]) > d.y / 2 + 0.06,
      )
    )
      continue;
    const n = cross(minus(p[1], p[0]), minus(p[2], p[0])),
      length = Math.hypot(...n);
    if (length < 1e-9) continue;
    const normal = n.map((x) => x / length) as V;
    const triangle = { id, p, center: c, normal, area: length / 2 };
    if (c[1] < d.y / 2 - 0.03) body.push(triangle);
    if (Math.abs(normal[1]) > 0.8 && c[1] > -d.y / 2 + Math.max(0.6, d.y * 0.6))
      tops.push(triangle);
    if (body.length + tops.length > MAX_CANDIDATES) {
      limited = true;
      break;
    }
  }
  let result: ScannedIslandShell | null = null;
  if (!limited) {
    const planes = [
        ...findPlanes(body, "body"),
        ...findPlanes(tops, "countertop"),
      ],
      panels: ScannedIslandPanel[] = [],
      budget = { work: 0 };
    for (const plane of planes) {
      const grid = coveredGrid(plane, budget);
      if (!grid) continue;
      const cells = [...grid.cells.values()],
        minX = minimum(cells.map((p) => p[0])),
        maxX = maximum(cells.map((p) => p[0])) + 1,
        minY = minimum(cells.map((p) => p[1])),
        maxY = maximum(cells.map((p) => p[1])) + 1;
      if (
        plane.kind === "body" &&
        ((maxY - minY) * GRID < 0.4 || (maxX - minX) * GRID < 0.2)
      )
        continue;
      const positions: number[] = [];
      const at = (x: number, y: number): V =>
        [0, 1, 2].map(
          (a) => plane.origin[a] + plane.u[a] * x + plane.v[a] * y,
        ) as V;
      const faces =
        plane.kind === "body"
          ? bodySections(plane, body)
          : rectangles(grid.cells).map(
              (r) => r.map((x) => x * GRID) as [number, number, number, number],
            );
      if (!faces.length) continue;
      const x0 = minimum(faces.map((r) => r[0])),
        x1 = maximum(faces.map((r) => r[2])),
        y0 = minimum(faces.map((r) => r[1])),
        y1 = maximum(faces.map((r) => r[3]));
      for (const [a0, b0, a1, b1] of faces) {
        const a = at(a0, b0),
          b = at(a1, b0),
          c = at(a1, b1),
          e = at(a0, b1);
        if (plane.kind === "countertop")
          positions.push(...a, ...c, ...b, ...a, ...e, ...c);
        else positions.push(...a, ...b, ...c, ...a, ...c, ...e);
      }
      let observedArea = 0;
      for (const [x, y] of grid.cells.values())
        for (const [a, b, c, d] of faces)
          observedArea +=
            Math.max(0, Math.min((x + 1) * GRID, c) - Math.max(x * GRID, a)) *
            Math.max(0, Math.min((y + 1) * GRID, d) - Math.max(y * GRID, b));
      const faceArea = faces.reduce(
          (sum, r) => sum + (r[2] - r[0]) * (r[3] - r[1]),
          0,
        ),
        origin = at(x0, y0),
        id = `${object.id}:supported-${plane.kind}:${panels.length}`;
      panels.push({
        id,
        objectId: object.id,
        slot: plane.kind === "body" ? "island_cabinets" : "island_countertop",
        kind: plane.kind,
        positions: new Float32Array(positions),
        origin: point(t, origin),
        unitU: direction(t, plane.u),
        unitV: direction(t, plane.v),
        widthMeters: x1 - x0,
        heightMeters: y1 - y0,
        sourceTriangleIndices: new Uint32Array(
          plane.triangles.map((t) => t.id),
        ),
        observedArea,
        inferredFillArea: Math.max(0, faceArea - observedArea),
        sourceFacingY:
          plane.triangles.reduce((sum, t) => sum + t.normal[1] * t.area, 0) /
          plane.triangles.reduce((sum, t) => sum + t.area, 0),
      });
    }
    const bodies = panels.filter((p) => p.kind === "body"),
      countertops = panels.filter((p) => p.kind === "countertop");
    if (
      budget.work <= MAX_WORK &&
      bodies.length >= 3 &&
      bodies.reduce((s, p) => s + p.observedArea, 0) >
        Math.max(0.6, d.y * (d.x + d.z) * 0.3) &&
      countertops.reduce((s, p) => s + p.observedArea, 0) > 0.12
    ) {
      const completed = completeWorkingCap(panels, object, body, others);
      const floorSupport = extendToMeasuredFloor(panels, object, floors);
      result = {
        panels,
        partial: true,
        resolutionMeters: GRID,
        maximumPlaneFitMeters: FIT,
        inferredFillArea: panels.reduce((s, p) => s + p.inferredFillArea, 0),
        sourceTriangles: body.length + tops.length,
        ...(floorSupport > 0 ? { inferredFloorSupportArea: floorSupport } : {}),
        ...(completed
          ? {
              inferredWorkingCap: true,
              maximumEndpointCompletionMeters: 0.25,
              maximumCornerDistanceMeters: 0.035,
            }
          : {}),
      };
    }
  }
  if (entries.size < 16) entries.set(object.id, { signature, result });
  return result;
}
