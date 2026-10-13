import type { ObservedMesh, MeshBounds } from '@/lib/native/mesh-archive';
import type { ScannedElement, ScannedRoomGeometry, ScannedCountertopSurface } from '@/lib/spec/types';
import { countertopSurfaceIssue, insideCountertopRing } from '@/lib/native/countertop-surfaces';
import { CAPTURED_FURNITURE_SLOT, isCapturedFurnitureRole } from '@/lib/native/captured-furniture';
import { scannedObjectLayout, type ScannedObjectPresentation } from './scanned-object-layout';
import { scannedWallInteriorSign } from './scanned-geometry';

export interface ObservedSceneGroup {
  key: string;
  slot: string | null;
  /** A display-only cutaway plane, with its normal facing into the room. */
  wallPlane?: [number, number, number, number];
  indices: Uint32Array;
}
export interface ObservedSceneLayout {
  groups: ObservedSceneGroup[];
  bounds: MeshBounds;
  visibleTriangles: number;
  ceilingTriangles: number;
  croppedTriangles: number;
}
interface Region {
  object: ScannedObjectPresentation;
  min: [number, number, number]; max: [number, number, number];
  topHeights: number[];
  tops: ScannedCountertopSurface[];
}
const floorCell = (x: number, z: number) => `${Math.floor(x)},${Math.floor(z)}`;
function region(object: ScannedObjectPresentation): Region {
  const t = object.transform, d = [object.dimensions.x, object.dimensions.y, object.dimensions.z];
  const radii = [0, 1, 2].map(axis => (Math.abs(t[axis]) * d[0] + Math.abs(t[4 + axis]) * d[1] + Math.abs(t[8 + axis]) * d[2]) / 2 + 0.065);
  const tops = (object.countertopSurfaces ?? []).filter(surface => !countertopSurfaceIssue(surface));
  const min: Region['min'] = [t[12] - radii[0], t[13] - radii[1], t[14] - radii[2]];
  const max: Region['max'] = [t[12] + radii[0], t[13] + radii[1], t[14] + radii[2]];
  // A supported overhang can extend beyond RoomPlan's object box. Include its
  // own footprint for finish picking without enlarging the object's body.
  for (const surface of tops) for (const p of surface.polygonCorners) for (const [axis, value] of [p.x, p.y, p.z].entries()) {
    min[axis] = Math.min(min[axis], value - 0.065); max[axis] = Math.max(max[axis], value + 0.065);
  }
  return { object, min, max, tops, topHeights: tops.map(surface => surface.polygonCorners.reduce((n, p) => n + p.y, 0) / surface.polygonCorners.length) };
}

function supportedTopAt(r: Region, x: number, y: number, z: number): boolean {
  const point = { x, y, z };
  return r.tops.some((surface, i) => Math.abs(r.topHeights[i] - y) <= 0.055
    && insideCountertopRing(point, surface.polygonCorners)
    && !(surface.holes ?? []).some(hole => insideCountertopRing(point, hole)));
}
function localPoint(t: number[], x: number, y: number, z: number): [number, number, number] {
  const dx = x - t[12], dy = y - t[13], dz = z - t[14];
  return [dx * t[0] + dy * t[1] + dz * t[2], dx * t[4] + dy * t[5] + dz * t[6], dx * t[8] + dy * t[9] + dz * t[10]];
}
function objectSlot(r: Region, x: number, y: number, z: number, ny: number, localY: number): string | null {
  const role = r.object.role;
  // Generic furniture has camera evidence, but no established construction
  // finish. Keep its own faces available without treating a stool as cabinetry.
  if (isCapturedFurnitureRole(role)) return CAPTURED_FURNITURE_SLOT;
  // RoomPlan can assign a measured working slab to the appliance or merged
  // storage beneath it. The rendered patch uses the countertop slot; its
  // camera evidence must use that same slot. A box top alone is insufficient:
  // require an actual horizontal facet inside a recorded ring, outside holes,
  // and at the captured level. Fronts and unobserved lids keep their own finish.
  if (['dishwasher', 'tall-cabinet'].includes(role)
    && Math.abs(ny) >= 0.9 && supportedTopAt(r, x, y, z)) return 'countertop';
  const top = r.topHeights.some(h => Math.abs(h - y) <= 0.055) || (Math.abs(ny) > 0.65 && Math.abs(localY - r.object.dimensions.y / 2) <= 0.1);
  switch (role) {
    case 'island': return top ? 'island_countertop' : 'island_cabinets';
    case 'base-cabinet': return top ? 'countertop' : 'cabinets_base';
    case 'upper-cabinet': return 'cabinets_upper';
    case 'tall-cabinet': return 'cabinets_tall';
    case 'refrigerator': case 'oven': case 'dishwasher': case 'cooktop': return 'appliances';
    case 'sink': return 'faucet';
    case 'toilet': return 'fixtures';
    case 'bathtub': return 'tub';
    default: return null;
  }
}
function wallPlane(wall: ScannedElement, scan: ScannedRoomGeometry): [number, number, number, number] {
  const t = wall.transform, sign = scannedWallInteriorSign(wall, scan);
  const nx = t[8] * sign, ny = t[9] * sign, nz = t[10] * sign;
  return [nx, ny, nz, -(t[12] * nx + t[13] * ny + t[14] * nz)];
}
const bathroomSlots: Record<string, string> = { cabinets_base: 'vanity_cabinet', cabinets_upper: 'vanity_cabinet', cabinets_tall: 'vanity_cabinet', island_cabinets: 'vanity_cabinet', countertop: 'vanity_top', island_countertop: 'vanity_top', flooring: 'floor_tile', faucet: 'fixtures' };

/** Semantic regions control picking and optional finish edits only. They NEVER
 * become render volumes: every index points to an original observed vertex. */
export function observedMeshLayout(mesh: ObservedMesh, scan: ScannedRoomGeometry, roomType: 'kitchen' | 'bathroom', focusBounds?: MeshBounds): ObservedSceneLayout {
  const regions = scannedObjectLayout(scan, roomType).objects.map(region);
  const cells = new Map<string, Region[]>(), broad: Region[] = [];
  for (const r of regions) {
    const x0 = Math.floor(r.min[0]), x1 = Math.floor(r.max[0]), z0 = Math.floor(r.min[2]), z1 = Math.floor(r.max[2]);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 256) { broad.push(r); continue; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = `${x},${z}`, bucket = cells.get(key) ?? []; bucket.push(r); cells.set(key, bucket);
    }
  }
  const walls = scan.surfaces.filter(s => s.kind === 'wall'), floors = scan.surfaces.filter(s => s.kind === 'floor');
  const ceiling = walls.length ? Math.max(...walls.map(w => w.transform[13] + w.dimensions.y / 2)) : Infinity;
  const floorHeight = floors.length ? Math.min(...floors.map(f => f.transform[13])) : mesh.bounds.min[1];
  const batches = new Map<string, { slot: string | null; wallPlane?: [number, number, number, number]; indices: number[] }>();
  const bounds: MeshBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const p = mesh.positions;
  let ceilingTriangles = 0, visibleTriangles = 0, croppedTriangles = 0;
  for (let triangle = 0; triangle < mesh.triangleCount; triangle++) {
    const i = triangle * 9;
    // Focus fixtures is a view crop, never a saved-room edit. Keep triangles
    // crossing its edge intact; Source scan always retains the whole archive.
    if (focusBounds && [0, 2].some(axis => [0, 3, 6].every(v => p[i + v + axis] < focusBounds.min[axis])
      || [0, 3, 6].every(v => p[i + v + axis] > focusBounds.max[axis]))) { croppedTriangles++; continue; }
    const x = (p[i] + p[i + 3] + p[i + 6]) / 3, y = (p[i + 1] + p[i + 4] + p[i + 7]) / 3, z = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    const normal = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    const length = Math.hypot(...normal); if (length > 0) { normal[0] /= length; normal[1] /= length; normal[2] /= length; }
    // An architectural cutaway removes overhead observed triangles only. Source
    // scan retains the complete archive, including ceilings and adjacent rooms.
    if (y >= ceiling - 0.12 && Math.abs(normal[1]) > 0.55) { ceilingTriangles++; continue; }
    let match: Region | null = null, localY = 0, best = Infinity;
    const nearby = cells.get(floorCell(x, z)) ?? [];
    for (const r of broad.length ? [...nearby, ...broad] : nearby) {
      if (x < r.min[0] || x > r.max[0] || y < r.min[1] || y > r.max[1] || z < r.min[2] || z > r.max[2]) continue;
      const local = localPoint(r.object.transform, x, y, z), d = r.object.dimensions;
      const distances = [Math.abs(local[0]) - d.x / 2, Math.abs(local[1]) - d.y / 2, Math.abs(local[2]) - d.z / 2];
      const outside = Math.max(...distances);
      const supportedTop = supportedTopAt(r, x, y, z);
      if (outside > 0.065 && !supportedTop) continue;
      const score = supportedTop ? -1 : Math.max(0, outside) * 10 + Math.abs(outside);
      if (score < best) { best = score; match = r; localY = local[1]; }
    }
    let slot: string | null = null, key = 'unclassified', plane: [number, number, number, number] | undefined;
    if (Math.abs(y - floorHeight) < 0.08 && Math.abs(normal[1]) > 0.9) { slot = 'flooring'; key = 'floor'; }
    else if (match) { slot = objectSlot(match, x, y, z, normal[1], localY); key = `object:${match.object.id}:${slot ?? 'unclassified'}`; }
    else {
      let nearest = 0.13;
      for (const wall of walls) {
        const t = wall.transform, local = localPoint(t, x, y, z);
        const distance = Math.abs(local[2]);
        if (distance < nearest && Math.abs(local[0]) <= wall.dimensions.x / 2 + 0.07 && Math.abs(local[1]) <= wall.dimensions.y / 2 + 0.07
          && Math.abs(normal[0] * t[8] + normal[1] * t[9] + normal[2] * t[10]) > 0.6) {
          nearest = distance; slot = 'walls'; key = `wall:${wall.id}`; plane = wallPlane(wall, scan);
        }
      }
    }
    if (roomType === 'bathroom' && slot) slot = bathroomSlots[slot] ?? slot;
    let batch = batches.get(key);
    if (!batch) { batch = { slot, ...(plane ? { wallPlane: plane } : {}), indices: [] }; batches.set(key, batch); }
    batch.indices.push(triangle * 3, triangle * 3 + 1, triangle * 3 + 2); visibleTriangles++;
    for (let vertex = 0; vertex < 3; vertex++) for (let axis = 0; axis < 3; axis++) {
      bounds.min[axis] = Math.min(bounds.min[axis], p[i + vertex * 3 + axis]); bounds.max[axis] = Math.max(bounds.max[axis], p[i + vertex * 3 + axis]);
    }
  }
  return { groups: [...batches].map(([key, batch]) => ({ key, slot: batch.slot, ...(batch.wallPlane ? { wallPlane: batch.wallPlane } : {}), indices: new Uint32Array(batch.indices) })), bounds: visibleTriangles ? bounds : mesh.bounds, visibleTriangles, ceilingTriangles, croppedTriangles };
}
