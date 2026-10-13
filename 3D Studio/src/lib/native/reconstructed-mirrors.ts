import type { ScannedElement, ScannedRoomGeometry } from '../spec/types';
import { capturedPixelOnWall, projectCapturedPoint, uprightToRawUV, type CapturedCameraProjection, type CapturedImageRotation } from './camera-projection';

export interface MirrorMask {
  frameIndex: number; width: number; height: number; rotation: CapturedImageRotation;
  /** Probability only where mirror is the winning semantic class. */
  probabilities: Float32Array;
}
export interface ReconstructedMirror {
  id: string; wallId: string; center: [number, number, number]; width: number; height: number;
  transform: number[]; source: 'camera-semantic-inference'; confidence: 'low'; extentVerified: false; evidenceFrames: number[];
}
type Candidate = { frame: number; wall: ScannedElement; x0: number; x1: number; y0: number; y1: number; weight: number };
const MAX_RAY_INTERSECTIONS = 350_000;
const quantile = (values: number[], q: number) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
const local = (wall: ScannedElement, p: [number, number, number]) => {
  const t = wall.transform, x = p[0] - t[12], y = p[1] - t[13], z = p[2] - t[14];
  return [x * t[0] + y * t[1] + z * t[2], x * t[4] + y * t[5] + z * t[6]];
};
function overlap(a: Candidate, b: Candidate) {
  const intersection = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return intersection / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - intersection);
}
/** Exact union area seen by at least two different frames. Candidates already
 * contain at most one component per frame, so duplicate pixels cannot improve
 * consensus. Unsupported parts of a bounding union do not increase its rank. */
function supportedArea(candidates: Candidate[]): number {
  const xs = [...new Set(candidates.flatMap(c => [c.x0, c.x1]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1], right = xs[i], middle = (left + right) / 2;
    const events = candidates.filter(c => c.x0 <= middle && c.x1 >= middle).flatMap(c => [{ y: c.y0, delta: 1 }, { y: c.y1, delta: -1 }]).sort((a, b) => a.y - b.y);
    let count = 0, previous = 0, length = 0;
    for (const event of events) { if (count >= 2) length += event.y - previous; count += event.delta; previous = event.y; }
    area += (right - left) * length;
  }
  return area;
}
function validElement(element: ScannedElement): boolean {
  const t = element.transform, d = element.dimensions;
  if (!Array.isArray(t) || t.length !== 16 || !t.every(n => Number.isFinite(n) && Math.abs(n) <= 1000)
    || !d || ![d.x, d.y, d.z].every(n => Number.isFinite(n) && n >= 0 && n <= 100) || d.x <= .01 || d.y <= .01) return false;
  const x = t.slice(0, 3), y = t.slice(4, 7), z = t.slice(8, 11), dot = (a: number[], b: number[]) => a.reduce((s, n, i) => s + n * b[i], 0);
  const determinant = x[0] * (y[1] * z[2] - y[2] * z[1]) + x[1] * (y[2] * z[0] - y[0] * z[2]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
  return [x, y, z].every(a => Math.abs(Math.hypot(...a) - 1) < 1e-4) && Math.max(Math.abs(dot(x, y)), Math.abs(dot(x, z)), Math.abs(dot(y, z)), Math.abs(determinant - 1), Math.abs(t[3]), Math.abs(t[7]), Math.abs(t[11]), Math.abs(t[15] - 1)) < 1e-4;
}
function validCamera(camera: CapturedCameraProjection | null | undefined, frame: number): camera is CapturedCameraProjection {
  return !!camera && camera.frameIndex === frame && Number.isInteger(frame) && frame >= 0 && frame < 48
    && Number.isFinite(camera.maximumUVError) && camera.maximumUVError >= 0 && camera.maximumUVError <= .002
    && Array.isArray(camera.rows) && camera.rows.length === 3 && camera.rows.every(row => Array.isArray(row) && row.length === 4 && row.every(n => Number.isFinite(n) && Math.abs(n) <= 10000));
}
function cameraCenter(camera: CapturedCameraProjection): [number, number, number] | null {
  const [a, b, c] = camera.rows;
  const cross = (x: number[], y: number[]) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b), determinant = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null;
  const center = [0, 1, 2].map(i => (-a[3] * bc[i] - b[3] * ca[i] - c[3] * ab[i]) / determinant) as [number, number, number];
  return center.every(n => Number.isFinite(n) && Math.abs(n) <= 1000) ? center : null;
}
function occludedBySolid(origin: [number, number, number], point: [number, number, number], object: ScannedElement): boolean {
  const t = object.transform, from = origin.map((n, i) => n - t[12 + i]), delta = point.map((n, i) => n - origin[i]);
  const half = [object.dimensions.x, object.dimensions.y, object.dimensions.z].map(n => Math.max(0, n / 2 - .015));
  let enter = 0, leave = 1, startsInside = true;
  for (let axis = 0; axis < 3; axis++) {
    const start = from[0] * t[axis * 4] + from[1] * t[axis * 4 + 1] + from[2] * t[axis * 4 + 2];
    const direction = delta[0] * t[axis * 4] + delta[1] * t[axis * 4 + 1] + delta[2] * t[axis * 4 + 2];
    if (Math.abs(start) > half[axis]) startsInside = false;
    if (Math.abs(direction) < 1e-9) { if (Math.abs(start) > half[axis]) return false; continue; }
    const a = (-half[axis] - start) / direction, b = (half[axis] - start) / direction;
    enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  // Bounds are approximate; a camera inside a reported solid makes that
  // obstruction unreliable. Otherwise only hits before the wall can block it.
  return !startsInside && leave > .005 && enter < .995;
}
function intersectsOpening(candidate: Pick<Candidate, 'wall' | 'x0' | 'x1' | 'y0' | 'y1'>, openings: ScannedElement[]): boolean {
  const wall = candidate.wall, w = wall.transform;
  return openings.some(opening => {
    const t = opening.transform;
    const distance = Math.abs((t[12] - w[12]) * w[8] + (t[13] - w[13]) * w[9] + (t[14] - w[14]) * w[10]);
    if (distance >= .1 || Math.abs(t[8] * w[8] + t[9] * w[9] + t[10] * w[10]) < .99) return false;
    const corners = [-1, 1].flatMap(x => [-1, 1].map(y => local(wall, [0, 1, 2].map(axis => t[12 + axis] + x * opening.dimensions.x / 2 * t[axis] + y * opening.dimensions.y / 2 * t[4 + axis]) as [number, number, number])));
    return Math.min(candidate.x1, Math.max(...corners.map(p => p[0]))) - Math.max(candidate.x0, Math.min(...corners.map(p => p[0]))) > .005
      && Math.min(candidate.y1, Math.max(...corners.map(p => p[1]))) - Math.max(candidate.y0, Math.min(...corners.map(p => p[1]))) > .005;
  });
}

/** Project independently detected mirror pixels onto the first captured wall
 * on each camera ray. Reflected LiDAR depths never become mirror geometry.
 * At least two agreeing views are required; bounds remain an inferred extent.
 * No RoomPlan geometry, catalog selection or estimate quantity is modified. */
export function reconstructMirrors(scan: ScannedRoomGeometry, cameras: Array<CapturedCameraProjection | null>, masks: MirrorMask[]): ReconstructedMirror[] {
  if (masks.length > 48 || cameras.length > 48 || scan.surfaces.length > 512 || scan.objects.length > 512) return [];
  const walls = scan.surfaces.filter(s => s.kind === 'wall' && validElement(s) && s.dimensions.x > .2 && s.dimensions.y > .2);
  const openings = scan.surfaces.filter(s => ['window', 'door', 'opening'].includes(s.kind) && validElement(s));
  const solids = scan.objects.filter(s => ['storage', 'refrigerator', 'oven', 'dishwasher', 'washer', 'dryer', 'stove'].includes(s.kind) && validElement(s) && s.dimensions.z > .05);
  const candidates: Candidate[] = [];
  const seen = new Set<number>(); let rayIntersections = 0;
  for (const mask of masks) {
    const camera = cameras[mask.frameIndex];
    if (!validCamera(camera, mask.frameIndex) || seen.has(mask.frameIndex) || ![0, 90, 180, 270].includes(mask.rotation) || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width < 1 || mask.height < 1 || mask.width * mask.height > 65536 || mask.probabilities.length !== mask.width * mask.height) continue;
    const origin = cameraCenter(camera); if (!origin) continue;
    seen.add(mask.frameIndex);
    const visited = new Uint8Array(mask.probabilities.length), queue = new Int32Array(mask.probabilities.length);
    const eligible = (index: number) => Number.isFinite(mask.probabilities[index]) && mask.probabilities[index] >= .5 && mask.probabilities[index] <= 1;
    // Independent semantic components must stay independent even on one wall.
    // A feature cannot span the empty image gap between two separate mirrors.
    for (let start = 0; start < visited.length; start++) {
      if (visited[start] || !eligible(start)) continue;
      let head = 0, tail = 1; queue[0] = start; visited[start] = 1;
      while (head < tail) {
        const pixel = queue[head++], x = pixel % mask.width, y = Math.floor(pixel / mask.width);
        const neighbors = [x > 0 ? pixel - 1 : -1, x + 1 < mask.width ? pixel + 1 : -1, y > 0 ? pixel - mask.width : -1, y + 1 < mask.height ? pixel + mask.width : -1];
        for (const next of neighbors) if (next >= 0 && !visited[next] && eligible(next)) { visited[next] = 1; queue[tail++] = next; }
      }
      if (tail < Math.max(24, mask.width * mask.height * .012)) continue;
      const hits = new Map<ScannedElement, { x: number[]; y: number[]; weight: number }>();
      for (let pixel = 0; pixel < tail; pixel++) {
        const index = queue[pixel], i = index % mask.width, j = Math.floor(index / mask.width), probability = mask.probabilities[index];
        const uv = uprightToRawUV((i + .5) / mask.width, (j + .5) / mask.height, mask.rotation);
        let nearest: { wall: ScannedElement; p: [number, number, number]; xy: number[]; q: number } | null = null;
        for (const wall of walls) {
          if (++rayIntersections > MAX_RAY_INTERSECTIONS) return [];
          const p = capturedPixelOnWall(camera, uv.u, uv.v, wall); if (!p) continue;
          const xy = local(wall, p), projected = projectCapturedPoint(camera, p);
          if (!projected || Math.abs(xy[0]) > wall.dimensions.x / 2 + .015 || Math.abs(xy[1]) > wall.dimensions.y / 2 + .015) continue;
          if (!nearest || projected.q < nearest.q) nearest = { wall, p, xy, q: projected.q };
        }
        if (!nearest || solids.some(solid => {
          if (++rayIntersections > MAX_RAY_INTERSECTIONS) return true;
          return occludedBySolid(origin, nearest!.p, solid);
        }) || openings.some(opening => {
          const t = opening.transform;
          const dx = nearest!.p[0] - t[12], dy = nearest!.p[1] - t[13], dz = nearest!.p[2] - t[14];
          const distance = Math.abs(dx * t[8] + dy * t[9] + dz * t[10]);
          const xy = local(opening, nearest!.p);
          return distance < .10 && Math.abs(xy[0]) < opening.dimensions.x / 2 && Math.abs(xy[1]) < opening.dimensions.y / 2;
        })) { if (rayIntersections > MAX_RAY_INTERSECTIONS) return []; continue; }
        let hit = hits.get(nearest.wall); if (!hit) { hit = { x: [], y: [], weight: 0 }; hits.set(nearest.wall, hit); }
        hit.x.push(nearest.xy[0]); hit.y.push(nearest.xy[1]); hit.weight += probability;
      }
      for (const [wall, hit] of hits) {
        if (hit.x.length < Math.max(24, mask.width * mask.height * .012)) continue;
        const x0 = quantile(hit.x, .02), x1 = quantile(hit.x, .98), y0 = quantile(hit.y, .02), y1 = quantile(hit.y, .98);
        if (x1 - x0 < .20 || y1 - y0 < .20 || (x1 - x0) * (y1 - y0) < .08) continue;
        const candidate = { frame: mask.frameIndex, wall, x0, x1, y0, y1, weight: hit.weight / hit.x.length };
        if (!intersectsOpening(candidate, openings)) candidates.push(candidate);
        if (candidates.length > 512) return [];
      }
    }
  }
  const clusters: { wall: ScannedElement; matches: Candidate[]; x0: number; x1: number; y0: number; y1: number; area: number; score: number; probability: number }[] = [];
  // Evaluate every independently supported extent before suppressing overlaps.
  // A confident crop must not consume views belonging to a fuller observation.
  for (const seed of candidates) {
    const byFrame = new Map<number, Candidate>([[seed.frame, seed]]);
    for (const candidate of candidates) if (candidate.wall === seed.wall && candidate.frame !== seed.frame && overlap(candidate, seed) > .45) {
      const previous = byFrame.get(candidate.frame);
      if (!previous || overlap(candidate, seed) > overlap(previous, seed)) byFrame.set(candidate.frame, candidate);
    }
    const matches = [...byFrame.values()];
    if (new Set(matches.map(c => c.frame)).size < 2) continue;
    const wall = seed.wall, x0 = Math.max(-wall.dimensions.x / 2, Math.min(...matches.map(c => c.x0)) - .025), x1 = Math.min(wall.dimensions.x / 2, Math.max(...matches.map(c => c.x1)) + .025);
    const y0 = Math.max(-wall.dimensions.y / 2, Math.min(...matches.map(c => c.y0)) - .025), y1 = Math.min(wall.dimensions.y / 2, Math.max(...matches.map(c => c.y1)) + .025);
    if (intersectsOpening({ wall, x0, x1, y0, y1 }, openings)) continue;
    const area = supportedArea(matches);
    clusters.push({ wall, matches, x0, x1, y0, y1, area, score: area * (1 + Math.log2(matches.length)), probability: matches.reduce((n, c) => n + c.weight, 0) / matches.length });
  }
  clusters.sort((a, b) => b.score - a.score || b.area - a.area || b.matches.length - a.matches.length || b.probability - a.probability || a.wall.id.localeCompare(b.wall.id) || a.x0 - b.x0 || a.y0 - b.y0);
  const result: ReconstructedMirror[] = [];
  for (const { wall, matches, x0, x1, y0, y1 } of clusters) {
    // Partial views can independently confirm overlapping portions of one
    // feature. Keep the stronger supported extent; neither stack duplicates
    // nor enlarge the rectangle through weaker, disagreeing observations.
    if (result.some(previous => {
      if (previous.wallId !== wall.id) return false;
      const [x, y] = local(wall, previous.center);
      const intersection = Math.max(0, Math.min(x1, x + previous.width / 2) - Math.max(x0, x - previous.width / 2)) * Math.max(0, Math.min(y1, y + previous.height / 2) - Math.max(y0, y - previous.height / 2));
      return intersection / Math.min((x1 - x0) * (y1 - y0), previous.width * previous.height) > .45;
    })) continue;
    const x = (x0 + x1) / 2, y = (y0 + y1) / 2, t = wall.transform;
    const center: [number, number, number] = [t[12] + x * t[0] + y * t[4], t[13] + x * t[1] + y * t[5], t[14] + x * t[2] + y * t[6]];
    const transform = [...t]; transform.splice(12, 3, ...center);
    result.push({ id: `inferred-mirror:${wall.id}:${result.length}`, wallId: wall.id, center, width: x1 - x0, height: y1 - y0, transform, source: 'camera-semantic-inference', confidence: 'low', extentVerified: false, evidenceFrames: matches.map(c => c.frame).sort((a, b) => a - b) });
    if (result.length >= 8) break;
  }
  return result;
}
