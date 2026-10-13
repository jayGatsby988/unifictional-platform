import type { ScannedElement, ScannedRoomGeometry } from '../spec/types';
import type { ObservedMesh } from './mesh-archive';
import { observedMeshLayout, type ObservedSceneLayout } from '@/components/scene/observed-mesh-layout';

type Vec = [number, number, number];
export interface ReconstructedColor {
  status: 'supported' | 'unknown';
  source: 'camera-sampled-inference';
  confidence: 'low' | 'medium' | 'high';
  /** Linear RGB for a derived model material, not calibrated reflectance. */
  colorLinear?: Vec;
  colorHex?: string;
  reason?: 'no-camera-evidence' | 'insufficient-spatial-coverage' | 'mixed-appearance' | 'resource-limit';
  spatialCellCount: number;
  /** Fraction of accepted, spatially capped evidence in the chosen cluster. */
  supportFraction: number;
}
export interface ReconstructedAppearance {
  slots: Record<string, ReconstructedColor>;
  objects: Record<string, Record<string, ReconstructedColor>>;
  surfaces: Record<string, ReconstructedColor>;
}
type Cell = { key: string; area: number; sum: Vec; position: Vec; height: number; border: boolean };
type Sample = { color: Vec; feature: Vec; weight: number; position: Vec; height: number; border: boolean };
type Bucket = { slot: string; kind: 'floor' | 'wall' | 'object'; cells: Map<string, Cell>; objectId?: string; surfaceId?: string };
const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const GRID = .12, MAX_CELLS = 32_768;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unknown = (reason: ReconstructedColor['reason'] = 'no-camera-evidence', count = 0): ReconstructedColor => ({ status: 'unknown', source: 'camera-sampled-inference', confidence: 'low', reason, spatialCellCount: count, supportFraction: 0 });
const toSRGB = (x: number) => x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055;
const hex = (c: Vec) => '#' + c.map(x => Math.round(255 * Math.max(0, Math.min(1, toSRGB(x)))).toString(16).padStart(2, '0')).join('');
function feature(c: Vec): Vec {
  // Oklab separates chromatic differences from lightness without baking a
  // preference for pale, warm, wood, stone or any catalog material into inference.
  const l = Math.cbrt(.4122214708 * c[0] + .5363325363 * c[1] + .0514459929 * c[2]);
  const m = Math.cbrt(.2119034982 * c[0] + .6806995451 * c[1] + .1073969566 * c[2]);
  const s = Math.cbrt(.0883024619 * c[0] + .2817188376 * c[1] + .6299787005 * c[2]);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}
const distance = (a: Vec, b: Vec) => Math.hypot((a[0] - b[0]) * .7, (a[1] - b[1]) * 2, (a[2] - b[2]) * 2);
function median(samples: Sample[], value: (s: Sample) => number): number {
  const ordered = samples.map(s => ({ value: value(s), weight: s.weight })).sort((a, b) => a.value - b.value);
  const half = ordered.reduce((n, s) => n + s.weight, 0) / 2;
  let sum = 0;
  for (const s of ordered) { sum += s.weight; if (sum >= half) return s.value; }
  return 0;
}
function pointInRing(x: number, z: number, ring: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function boundaryDistance(x: number, z: number, ring: { x: number; z: number }[]): number {
  let closest = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / Math.max(1e-12, dx * dx + dz * dz)));
    closest = Math.min(closest, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return closest;
}
function local(element: ScannedElement, p: Vec): Vec {
  const t = element.transform, d = sub(p, [t[12], t[13], t[14]]);
  return [dot(d, [t[0], t[1], t[2]]), dot(d, [t[4], t[5], t[6]]), dot(d, [t[8], t[9], t[10]])];
}
function clusters(samples: Sample[]): Sample[][] {
  const ordered = [...samples].sort((a, b) => b.weight - a.weight || a.feature[0] - b.feature[0] || a.feature[1] - b.feature[1] || a.feature[2] - b.feature[2]);
  const centers: Vec[] = [[...ordered[0].feature]];
  while (centers.length < 4) {
    let farthest: Sample | null = null, best = .055;
    for (const s of ordered) {
      const d = Math.min(...centers.map(c => distance(s.feature, c)));
      if (d > best) { best = d; farthest = s; }
    }
    if (!farthest) break;
    centers.push([...farthest.feature]);
  }
  let groups: Sample[][] = [];
  for (let pass = 0; pass < 12; pass++) {
    groups = centers.map(() => []);
    for (const s of ordered) {
      let nearest = 0;
      for (let i = 1; i < centers.length; i++) if (distance(s.feature, centers[i]) < distance(s.feature, centers[nearest])) nearest = i;
      groups[nearest].push(s);
    }
    for (let i = 0; i < groups.length; i++) {
      const weight = groups[i].reduce((n, s) => n + s.weight, 0);
      if (weight) centers[i] = [0, 1, 2].map(c => groups[i].reduce((n, s) => n + s.feature[c] * s.weight, 0) / weight) as Vec;
    }
  }
  return groups.filter(g => g.length);
}
function summarize(bucket: Bucket): ReconstructedColor {
  const samples: Sample[] = [...bucket.cells.values()].filter(c => c.area > 1e-8).map(c => {
    const color = c.sum.map(n => n / c.area) as Vec;
    return { color, feature: feature(color), weight: Math.min(GRID * GRID, c.area), position: c.position.map(n => n / c.area) as Vec, height: c.height / c.area, border: c.border };
  });
  if (!samples.length) return unknown();
  const total = samples.reduce((n, s) => n + s.weight, 0);
  if (samples.length < 6 || total < .025) return unknown('insufficient-spatial-coverage', samples.length);
  const groups = clusters(samples).map(group => {
    const weight = group.reduce((n, s) => n + s.weight, 0);
    const center = [0, 1, 2].map(i => median(group, s => s.color[i])) as Vec;
    const bounds = [0, 1, 2].map(axis => Math.max(...group.map(s => s.position[axis])) - Math.min(...group.map(s => s.position[axis])));
    return { group, weight, center, share: weight / total, borders: group.filter(s => s.border).length, height: median(group, s => s.height), spread: Math.sqrt(bounds.sort((a, b) => b - a)[0] * bounds[1]) };
  }).sort((a, b) => b.weight - a.weight);
  let selected = groups[0];
  let floorLevel: number | null = null;
  if (bucket.kind === 'floor' && groups.length > 1) {
    const meaningful = groups.filter(g => g.share >= .12 && g.group.length >= 8);
    if (meaningful.length > 1) {
      const low = Math.min(...meaningful.map(g => g.height));
      const candidates = meaningful.filter(g => g.height <= low + .004 && g.borders >= 5 && g.spread >= .5)
        .sort((a, b) => b.borders * b.spread - a.borders * a.spread);
      // Rugs can dominate triangle count but seldom occupy the lowest broadly
      // observed plane and its distributed boundary. No color is preferred.
      const sameBase = candidates.length > 1 && candidates.every(g => {
        const a = feature(candidates[0].center), b = feature(g.center);
        return Math.hypot(a[1] - b[1], a[2] - b[2]) < .035 && Math.abs(a[0] - b[0]) < .18;
      });
      if (candidates.length && (candidates.length === 1 || sameBase || candidates[0].borders * candidates[0].spread > candidates[1].borders * candidates[1].spread * 1.35)) {
        selected = candidates[0]; floorLevel = low;
      }
      else return unknown('mixed-appearance', samples.length);
    }
  } else if (selected.share < .4) return unknown('mixed-appearance', samples.length);
  // Adjacent clusters of the same hue commonly represent grain or illumination.
  // Merge those only around the selected cluster; never average opposed hues.
  const f = feature(selected.center);
  const compatible = groups.filter(g => {
    const other = feature(g.center);
    return (floorLevel === null || g.height <= floorLevel + .004)
      && Math.hypot(f[1] - other[1], f[2] - other[2]) < .035 && Math.abs(f[0] - other[0]) < (bucket.kind === 'floor' ? .18 : .13);
  });
  const chosen = compatible.flatMap(g => g.group);
  const support = Math.min(1, compatible.reduce((n, g) => n + g.share, 0));
  const color = [0, 1, 2].map(i => median(chosen, s => s.color[i])) as Vec;
  if (chosen.length < 6 || support < .2) return unknown('insufficient-spatial-coverage', samples.length);
  return { status: 'supported', source: 'camera-sampled-inference', colorLinear: color, colorHex: hex(color),
    confidence: support >= .8 && chosen.length >= 40 ? 'high' : support >= .55 && chosen.length >= 12 ? 'medium' : 'low', spatialCellCount: chosen.length, supportFraction: support };
}

/** Transient colors for clean reconstructed models. Does not name materials,
 * infer texture brands, mutate selections, price work, or alter source geometry.
 * Use only for unchosen finishes; the Source view must keep its original mesh. */
export function deriveReconstructedAppearance(mesh: ObservedMesh, scan: ScannedRoomGeometry, roomType: 'kitchen' | 'bathroom', layout?: ObservedSceneLayout): ReconstructedAppearance {
  const result: ReconstructedAppearance = { slots: record(), objects: record(), surfaces: record() };
  if (!Number.isInteger(mesh.triangleCount) || mesh.triangleCount <= 0 || mesh.triangleCount > 320_000 || mesh.positions.length !== mesh.triangleCount * 9 || mesh.colors.length !== mesh.positions.length || mesh.captured.length !== mesh.triangleCount * 3 || scan.surfaces.length > 256 || scan.objects.length > 512) return result;
  const source = layout ?? observedMeshLayout(mesh, scan, roomType);
  const objects = new Map(scan.objects.map(e => [e.id, e])), surfaces = new Map(scan.surfaces.map(e => [e.id, e]));
  const floors = scan.surfaces.filter(e => e.kind === 'floor' && e.polygonCorners?.length);
  const buckets: Bucket[] = []; let cellCount = 0, limited = false;
  for (const group of source.groups) {
    if (!group.slot || group.indices.length % 3) continue;
    const objectId = group.key.startsWith('object:') ? group.key.slice(7, group.key.lastIndexOf(':')) : undefined;
    const surfaceId = group.key.startsWith('wall:') ? group.key.slice(5) : undefined;
    const object = objectId ? objects.get(objectId) : undefined, wall = surfaceId ? surfaces.get(surfaceId) : undefined;
    const kind = group.slot === 'flooring' || group.slot === 'floor_tile' ? 'floor' : wall ? 'wall' : 'object';
    const bucket: Bucket = { slot: group.slot, kind, cells: new Map(), ...(objectId ? { objectId } : {}), ...(surfaceId ? { surfaceId } : {}) };
    const floorBuckets = new Map<string, Bucket>();
    if (kind !== 'floor') buckets.push(bucket);
    for (let i = 0; i < group.indices.length; i += 3) {
      const indices = [group.indices[i], group.indices[i + 1], group.indices[i + 2]];
      if (indices.some(v => v >= mesh.captured.length || mesh.captured[v] !== 1)) continue;
      const points = indices.map(v => [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]] as Vec);
      const rgb = indices.flatMap(v => [mesh.colors[v * 3], mesh.colors[v * 3 + 1], mesh.colors[v * 3 + 2]]);
      if (points.some(p => p.some(n => !Number.isFinite(n))) || rgb.some(n => !Number.isFinite(n) || n < 0 || n > 1)) continue;
      const normal = cross(sub(points[1], points[0]), sub(points[2], points[0])), length = Math.hypot(...normal), area = length / 2;
      if (area < 1e-9 || area > .04) continue; // A huge interpolated facet is not distributed color evidence.
      const ny = Math.abs(normal[1] / length), center = [0, 1, 2].map(a => points.reduce((n, p) => n + p[a], 0) / 3) as Vec;
      const color = [0, 1, 2].map(a => (rgb[a] + rgb[a + 3] + rgb[a + 6]) / 3) as Vec;
      const luminance = dot(color, [.2126, .7152, .0722]);
      if (luminance < .008 || luminance > .97 || rgb.filter(n => n > .995).length >= 3) continue;
      let position = center, height = center[1], border = false, destination = bucket;
      if (kind === 'floor') {
        if (ny < .93) continue;
        const floor = floors.find(f => pointInRing(center[0], center[2], f.polygonCorners!));
        if (!floor) continue;
        const level = floor.polygonCorners!.reduce((n, p) => n + p.y, 0) / floor.polygonCorners!.length;
        height -= level;
        if (Math.abs(height) > .045) continue;
        border = boundaryDistance(center[0], center[2], floor.polygonCorners!) < .35;
        position = [center[0], 0, center[2]];
        let floorBucket = floorBuckets.get(floor.id);
        if (!floorBucket) { floorBucket = { slot: group.slot, kind, surfaceId: floor.id, cells: new Map() }; floorBuckets.set(floor.id, floorBucket); buckets.push(floorBucket); }
        destination = floorBucket;
      } else if (wall) {
        const p = local(wall, center), t = wall.transform;
        if (Math.abs(p[2]) > .055 || Math.abs(dot(normal, [t[8], t[9], t[10]]) / length) < .92) continue;
        position = [p[0], p[1], 0];
      } else if (object) {
        const p = local(object, center);
        if (/countertop|_top$/.test(group.slot) && ny < .85) continue;
        if (/cabinet/.test(group.slot) && (ny > .35 || p[1] < -object.dimensions.y / 2 + .06 || p[1] > object.dimensions.y / 2 - .055)) continue;
        position = p;
      }
      const key = position.map(n => Math.floor(n / GRID)).join(',');
      let cell = destination.cells.get(key);
      if (!cell) {
        if (cellCount >= MAX_CELLS) { limited = true; continue; }
        cell = { key, area: 0, sum: [0, 0, 0], position: [0, 0, 0], height: 0, border: false }; destination.cells.set(key, cell); cellCount++;
      }
      cell.area += area; cell.height += height * area; cell.border ||= border;
      for (let a = 0; a < 3; a++) { cell.sum[a] += color[a] * area; cell.position[a] += position[a] * area; }
    }
  }
  const slots = new Map<string, Bucket>();
  for (const bucket of buckets) {
    const value = limited ? unknown('resource-limit') : summarize(bucket);
    if (bucket.objectId) (result.objects[bucket.objectId] ??= record())[bucket.slot] = value;
    if (bucket.surfaceId) result.surfaces[bucket.surfaceId] = value;
    let aggregate = slots.get(bucket.slot);
    if (!aggregate) { aggregate = { slot: bucket.slot, kind: bucket.kind, cells: new Map() }; slots.set(bucket.slot, aggregate); }
    for (const [key, cell] of bucket.cells) aggregate.cells.set(`${bucket.objectId ?? bucket.surfaceId ?? ''}:${key}`, cell);
  }
  for (const [slot, bucket] of slots) result.slots[slot] = limited ? unknown('resource-limit') : summarize(bucket);
  return result;
}
