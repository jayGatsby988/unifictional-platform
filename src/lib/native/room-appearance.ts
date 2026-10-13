import type { ScannedElement, ScannedRoomGeometry } from '../spec/types';
import type { ObservedMesh } from './mesh-archive';

type Vec = [number, number, number];
type UV = [number, number];
export interface RoomSurfaceAppearance {
  status: 'supported' | 'unknown';
  source: 'camera-sampled-inference';
  /** Already linear RGB, for THREE.Color.setRGB(...), never a material ID. */
  colorLinear?: Vec;
  /** sRGB display value; do not convert colorLinear from sRGB a second time. */
  colorHex?: string;
  confidence: 'low' | 'medium' | 'high';
  reason?: 'invalid-surface' | 'no-camera-evidence' | 'insufficient-spatial-coverage' | 'mixed-appearance' | 'resource-limit';
  acceptedTriangleCount: number;
  spatialCellCount: number;
  /** Conservative area proxy, capped per spatial cell; not a measured finish quantity. */
  coveredAreaMeters2: number;
  coverageFraction: number;
  /** 75th-percentile linear RGB distance from the spatially weighted median. */
  colorSpread: number;
  /** Chromaticity spread separates lighting/grain brightness from conflicting hues. */
  chromaticSpread: number;
  rejectedObjectTriangleCount: number;
  rejectedBrightnessTriangleCount: number;
}
type Cell = { area: number; sum: Vec; u: number; v: number };
type Plane = { id: string; origin: Vec; u: Vec; v: Vec; normal: Vec; ring: UV[]; area: number; width: number; height: number; cells: Map<string, Cell>; evidence: RoomSurfaceAppearance };
type Box = { origin: Vec; axes: Vec[]; half: Vec };
const GRID = 0.2, CELL_AREA = GRID * GRID, MAX_CELLS = 8_192;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const finite = (p: Vec) => p.every(n => Number.isFinite(n) && Math.abs(n) <= 1000);
const unit = (a: Vec): Vec | null => { const n = Math.hypot(...a); return n > 1e-8 && Number.isFinite(n) ? a.map(x => x / n) as Vec : null; };
const coordinates = (p: { x: number; y: number; z: number }): Vec => [p.x, p.y, p.z];
const empty = (): RoomSurfaceAppearance => ({ status: 'unknown', source: 'camera-sampled-inference', confidence: 'low', acceptedTriangleCount: 0, spatialCellCount: 0, coveredAreaMeters2: 0, coverageFraction: 0, colorSpread: 0, chromaticSpread: 0, rejectedObjectTriangleCount: 0, rejectedBrightnessTriangleCount: 0 });
const ringArea = (p: UV[]) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
function inside([x, y]: UV, ring: UV[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    if (Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < 1e-8 && x >= Math.min(ax, bx) - 1e-8 && x <= Math.max(ax, bx) + 1e-8 && y >= Math.min(ay, by) - 1e-8 && y <= Math.max(ay, by) + 1e-8) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result;
  }
  return result;
}
function frame(element: ScannedElement): Box | null {
  const t = element.transform;
  if (t.length !== 16 || !t.every(Number.isFinite)) return null;
  const axes: Vec[] = [[t[0], t[1], t[2]], [t[4], t[5], t[6]], [t[8], t[9], t[10]]];
  if (axes.some(a => Math.abs(Math.hypot(...a) - 1) > 0.002) || Math.abs(dot(axes[0], axes[1])) > 0.002 || Math.abs(dot(axes[0], axes[2])) > 0.002 || Math.abs(dot(axes[1], axes[2])) > 0.002) return null;
  const origin: Vec = [t[12], t[13], t[14]], half = coordinates(element.dimensions).map(n => n / 2) as Vec;
  return finite(origin) && half.every(n => Number.isFinite(n) && n >= 0 && n <= 50) ? { origin, axes, half } : null;
}
function plane(element: ScannedElement): Plane | null {
  const f = frame(element); if (!f) return null;
  const isFloor = element.kind === 'floor';
  let origin = f.origin, u = f.axes[0], v = f.axes[1], normal = f.axes[2], ring: UV[];
  if (isFloor) {
    const points = element.polygonCorners?.map(coordinates);
    if (!points || points.length < 3 || points.length > 256 || !points.every(finite)) return null;
    const y = points.reduce((n, p) => n + p[1], 0) / points.length;
    if (points.some(p => Math.abs(p[1] - y) > 0.01)) return null;
    origin = [0, y, 0]; u = [1, 0, 0]; v = [0, 0, 1]; normal = [0, 1, 0];
    ring = points.map(p => [p[0], p[2]]);
  } else {
    if (Math.abs(normal[1]) > 0.2) return null;
    const points = element.polygonCorners?.map(coordinates);
    if (points?.length) {
      if (points.length < 3 || points.length > 256 || !points.every(finite) || points.some(p => Math.abs(dot(sub(p, origin), normal)) > 0.05)) return null;
      ring = points.map(p => { const d = sub(p, origin); return [dot(d, u), dot(d, v)]; });
    } else ring = [[-f.half[0], -f.half[1]], [f.half[0], -f.half[1]], [f.half[0], f.half[1]], [-f.half[0], f.half[1]]];
  }
  const area = ringArea(ring), xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  if (area < 0.1 || area > 1000) return null;
  return { id: element.id, origin, u, v, normal, ring, area, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), cells: new Map(), evidence: empty() };
}
function inBox(point: Vec, box: Box, margin: number): boolean {
  const p = sub(point, box.origin);
  return box.axes.every((axis, i) => Math.abs(dot(p, axis)) <= box.half[i] + margin);
}
function quantile(samples: { value: number; weight: number }[], fraction = 0.5): number {
  samples.sort((a, b) => a.value - b.value);
  const half = samples.reduce((n, s) => n + s.weight, 0) * fraction;
  let sum = 0;
  for (const s of samples) { sum += s.weight; if (sum >= half) return s.value; }
  return samples[samples.length - 1]?.value ?? 0;
}
function hex(color: Vec): string {
  return '#' + color.map(c => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0')).join('');
}

/**
 * Inferred room-surface appearance for an explicitly derived model underlay.
 * Never use this as captured pixels, a finish/material identification, or a
 * Source scan replacement. Brightness remains camera-observed illumination;
 * this routine cannot recover calibrated reflectance from the mesh colors.
 * Spatial caps prevent dense/repeated facets from dominating a room-wide tint.
 */
export function deriveRoomAppearance(mesh: ObservedMesh, scan: ScannedRoomGeometry): Record<string, RoomSurfaceAppearance> {
  const result: Record<string, RoomSurfaceAppearance> = {}, planes: Plane[] = [];
  for (const surface of scan.surfaces.filter(s => s.kind === 'wall' || s.kind === 'floor').slice(0, 128)) {
    const p = plane(surface);
    if (p) { planes.push(p); result[surface.id] = p.evidence; }
    else result[surface.id] = { ...empty(), reason: 'invalid-surface' };
  }
  if (!Number.isInteger(mesh.triangleCount) || mesh.triangleCount <= 0 || mesh.triangleCount > 320_000 || mesh.positions.length !== mesh.triangleCount * 9 || mesh.colors.length !== mesh.positions.length || mesh.captured.length !== mesh.triangleCount * 3) {
    for (const p of planes) p.evidence.reason = 'no-camera-evidence';
    return result;
  }
  const boxes = scan.objects.slice(0, 256).map(frame).filter((x): x is Box => x !== null);
  const openings = scan.surfaces.filter(s => ['window', 'door', 'opening'].includes(s.kind)).slice(0, 128).map(frame).filter((x): x is Box => x !== null);
  let cellCount = 0;
  for (let t = 0; t < mesh.triangleCount; t++) {
    if (mesh.captured[t * 3] !== 1 || mesh.captured[t * 3 + 1] !== 1 || mesh.captured[t * 3 + 2] !== 1) continue;
    const offset = t * 9;
    const points: Vec[] = [0, 3, 6].map(i => [mesh.positions[offset + i], mesh.positions[offset + i + 1], mesh.positions[offset + i + 2]]);
    if (!points.every(finite)) continue;
    const crossProduct = cross(sub(points[1], points[0]), sub(points[2], points[0])), normal = unit(crossProduct);
    if (!normal) continue;
    const center: Vec = [0, 1, 2].map(i => (points[0][i] + points[1][i] + points[2][i]) / 3) as Vec;
    const color: Vec = [0, 1, 2].map(i => (mesh.colors[offset + i] + mesh.colors[offset + 3 + i] + mesh.colors[offset + 6 + i]) / 3) as Vec;
    const values = mesh.colors.subarray(offset, offset + 9);
    const luminance = dot(color, [0.2126, 0.7152, 0.0722]);
    const validColor = values.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && luminance >= 0.01 && luminance <= 0.95 && values.filter(n => n >= 0.995).length < 3;
    for (const p of planes) {
      if (Math.abs(dot(normal, p.normal)) < 0.9 || points.some(q => Math.abs(dot(sub(q, p.origin), p.normal)) > 0.05)) continue;
      const uv = points.map(q => { const d = sub(q, p.origin); return [dot(d, p.u), dot(d, p.v)] as UV; });
      if (!uv.every(q => inside(q, p.ring))) continue;
      if (!validColor) { p.evidence.rejectedBrightnessTriangleCount++; continue; }
      if ([...points, center].some(q => boxes.some(box => inBox(q, box, 0.05)) || openings.some(box => inBox(q, box, 0.08)))) { p.evidence.rejectedObjectTriangleCount++; continue; }
      const d = sub(center, p.origin), cu = Math.floor(dot(d, p.u) / GRID), cv = Math.floor(dot(d, p.v) / GRID), key = `${cu},${cv}`;
      let cell = p.cells.get(key);
      if (!cell) {
        if (cellCount >= MAX_CELLS) { p.evidence.reason = 'resource-limit'; continue; }
        cell = { area: 0, sum: [0, 0, 0], u: cu, v: cv }; p.cells.set(key, cell); cellCount++;
      }
      const weight = Math.min(CELL_AREA - cell.area, Math.abs(dot(crossProduct, p.normal)) / 2);
      if (weight > 0) { cell.area += weight; for (let i = 0; i < 3; i++) cell.sum[i] += color[i] * weight; }
      p.evidence.acceptedTriangleCount++;
    }
  }
  for (const p of planes) {
    const evidence = p.evidence, cells = [...p.cells.values()].filter(c => c.area > 1e-8);
    evidence.spatialCellCount = cells.length;
    evidence.coveredAreaMeters2 = cells.reduce((n, c) => n + c.area, 0);
    evidence.coverageFraction = Math.min(1, evidence.coveredAreaMeters2 / p.area);
    if (!cells.length) { evidence.reason ??= 'no-camera-evidence'; continue; }
    const spanU = (Math.max(...cells.map(c => c.u)) - Math.min(...cells.map(c => c.u))) * GRID;
    const spanV = (Math.max(...cells.map(c => c.v)) - Math.min(...cells.map(c => c.v))) * GRID;
    if (cells.length < 8 || evidence.acceptedTriangleCount < 12 || evidence.coveredAreaMeters2 < Math.max(0.15, Math.min(0.3, p.area * 0.05)) || evidence.coverageFraction < 0.025 || spanU < Math.min(0.6, p.width * 0.25) || spanV < Math.min(0.6, p.height * 0.25)) {
      evidence.reason ??= 'insufficient-spatial-coverage'; continue;
    }
    const color = [0, 1, 2].map(i => quantile(cells.map(c => ({ value: c.sum[i] / c.area, weight: c.area })))) as Vec;
    // A 50/50 split of different wall finishes must not report zero spread
    // simply because half the cells exactly match the channel median.
    evidence.colorSpread = quantile(cells.map(c => ({ value: Math.hypot(...c.sum.map((n, i) => n / c.area - color[i])), weight: c.area })), 0.75);
    const colorSum = color.reduce((sum, n) => sum + n, 0);
    evidence.chromaticSpread = quantile(cells.map(c => {
      const sum = c.sum.reduce((n, value) => n + value, 0);
      return { value: Math.hypot(...c.sum.map((n, i) => n / sum - color[i] / colorSum)), weight: c.area };
    }), 0.75);
    // Camera illumination and wood grain can vary strongly in brightness.
    // Do not call them different finishes solely because linear intensity
    // varies; only conflicting hue plus large color spread blocks a tint.
    if (evidence.colorSpread > 0.3 && evidence.chromaticSpread > 0.18) { evidence.reason = 'mixed-appearance'; continue; }
    if (evidence.reason === 'resource-limit') continue;
    evidence.status = 'supported'; evidence.colorLinear = color; evidence.colorHex = hex(color);
    evidence.confidence = evidence.coverageFraction >= 0.3 && evidence.colorSpread < 0.08 ? 'high' : evidence.coverageFraction >= 0.1 && evidence.colorSpread < 0.15 ? 'medium' : 'low';
  }
  return result;
}
