import * as THREE from 'three';
import type { ScannedElement, ScannedRoomGeometry } from '@/lib/spec/types';
import type { CameraRig } from './SceneCanvas';
import { scannedWallInteriorSign } from './scanned-geometry';

/** Prefer the interior faces of furnished walls, irrespective of the scan's world heading. */
function viewingDirection(scan: ScannedRoomGeometry, center: THREE.Vector3): THREE.Vector2 {
  const walls = scan.surfaces.filter((s) => s.kind === 'wall' && s.dimensions.x > 0 && s.dimensions.y > 0);
  if (!walls.length) return new THREE.Vector2(0.55, 0.83).normalize();
  const hasFloor = scan.surfaces.some((s) => s.kind === 'floor' && (s.polygonCorners?.length ?? 0) >= 3);
  const normal = (wall: ScannedElement) => {
    const m = wall.transform;
    const sign = hasFloor ? scannedWallInteriorSign(wall, scan) : (center.x - m[12]) * m[8] + (center.z - m[14]) * m[10] >= 0 ? 1 : -1;
    return new THREE.Vector2(m[8] * sign, m[10] * sign).normalize();
  };
  const furnished = new Map<ScannedElement, number>();
  for (const object of scan.objects) {
    if (!['storage', 'refrigerator', 'stove', 'oven', 'dishwasher', 'sink', 'washerDryer', 'bathtub', 'toilet'].includes(object.kind)) continue;
    const p = object.transform;
    let nearest: ScannedElement | undefined;
    let distance = Infinity;
    for (const wall of walls) {
      const m = wall.transform, dx = p[12] - m[12], dz = p[14] - m[14];
      const along = Math.abs(dx * m[0] + dz * m[2]);
      // Do not let a detached island choose the camera heading. Only use
      // fixtures whose measured footprint reaches a nearby wall segment.
      const normalRadius = (Math.abs(p[0] * m[8] + p[2] * m[10]) * object.dimensions.x + Math.abs(p[8] * m[8] + p[10] * m[10]) * object.dimensions.z) / 2;
      const away = Math.abs(dx * m[8] + dz * m[10]);
      if (along > wall.dimensions.x / 2 + 0.15 || away > normalRadius + 0.35) continue;
      if (away < distance || (away === distance && wall.id < (nearest?.id ?? ''))) { nearest = wall; distance = away; }
    }
    if (nearest) furnished.set(nearest, (furnished.get(nearest) ?? 0) + Math.sqrt(object.dimensions.x * object.dimensions.y));
  }
  const weighted = walls.map((wall) => ({ wall, weight: furnished.size ? furnished.get(wall) ?? 0 : wall.dimensions.x * wall.dimensions.y, normal: normal(wall) }));
  weighted.sort((a, b) => b.weight - a.weight || a.wall.id.localeCompare(b.wall.id));
  const direction = new THREE.Vector2();
  let total = 0;
  for (const entry of weighted) { direction.addScaledVector(entry.normal, entry.weight); total += entry.weight; }
  // A closed, evenly furnished room has cancelling normals. Choose a stable
  // wall instead of amplifying tiny measurement differences into a new view.
  if (direction.length() < total * 0.2) direction.copy(weighted[0].normal);
  direction.normalize();
  const hasCorner = weighted.some((entry) => entry.weight > 0 && Math.abs(entry.normal.cross(weighted[0].normal)) > 0.25);
  if (!hasCorner) direction.add(new THREE.Vector2(direction.y, -direction.x).multiplyScalar(0.28)).normalize();
  return direction;
}

export interface ScannedRoomCameraOptions {
  /** Room shows all captured geometry; fixtures frames the furnished portion for a closer initial view. */
  focus?: 'fixtures' | 'room';
}

function elementBounds(element: ScannedElement): THREE.Box3 {
  const box = new THREE.Box3();
  const matrix = new THREE.Matrix4().fromArray(element.transform), point = new THREE.Vector3();
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
    point.set(x * element.dimensions.x, y * element.dimensions.y, z * element.dimensions.z).applyMatrix4(matrix);
    if ([point.x, point.y, point.z].every(Number.isFinite)) box.expandByPoint(point);
  }
  for (const corner of element.polygonCorners ?? []) {
    if ([corner.x, corner.y, corner.z].every(Number.isFinite)) box.expandByPoint(point.set(corner.x, corner.y, corner.z));
  }
  for (const surface of element.countertopSurfaces ?? []) for (const corner of surface.polygonCorners) {
    if ([corner.x, corner.y, corner.z].every(Number.isFinite)) box.expandByPoint(point.set(corner.x, corner.y, corner.z));
  }
  return box;
}

function fixtureBounds(scan: ScannedRoomGeometry, room: THREE.Box3): THREE.Box3 {
  const focus = new THREE.Box3();
  for (const object of scan.objects) {
    if (object.dimensions.x > 0 && object.dimensions.y > 0 && object.dimensions.z > 0) focus.union(elementBounds(object));
  }
  if (focus.isEmpty()) return room;
  focus.expandByVector(new THREE.Vector3(0.3, 0, 0.3));
  focus.min.y = Math.min(focus.min.y, room.min.y);
  // Include the height of the walls/windows behind the furnishings, without
  // letting a long empty wall or an adjacent open floor pull the camera away.
  for (const surface of scan.surfaces) {
    if (!['wall', 'window', 'door', 'opening'].includes(surface.kind)) continue;
    const bounds = elementBounds(surface);
    if (bounds.isEmpty()) continue;
    if (bounds.max.x >= focus.min.x && bounds.min.x <= focus.max.x && bounds.max.z >= focus.min.z && bounds.min.z <= focus.max.z) {
      focus.min.y = Math.min(focus.min.y, bounds.min.y);
      focus.max.y = Math.max(focus.max.y, bounds.max.y);
    }
  }
  return focus;
}

/** A shallow architectural overview with explicit full-room or furnished-area framing. */
export function scannedRoomRig(scan: ScannedRoomGeometry, options: ScannedRoomCameraOptions = {}): CameraRig {
  const box = new THREE.Box3();
  for (const element of [...scan.surfaces, ...scan.objects]) box.union(elementBounds(element));
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2.5, 1));
  const roomCenter = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const span = Math.max(1, size.x, size.y, size.z);
  const fit = options.focus === 'fixtures' ? fixtureBounds(scan, box) : box;
  const center = fit.getCenter(new THREE.Vector3()), fitSize = fit.getSize(new THREE.Vector3());
  const fitSpan = Math.max(1, fitSize.x, fitSize.y, fitSize.z);
  const direction = viewingDirection(scan, roomCenter);
  // A fixed elevation avoids turning tall or narrow captures into a top-down
  // floor plan. At 25° the cabinet fronts remain legible and counters are visible.
  const elevation = THREE.MathUtils.degToRad(25);
  const distance = Math.max(fitSpan * 1.8, (fit.max.y - center.y + 0.3) / Math.sin(elevation));
  const target: [number, number, number] = [center.x, center.y, center.z];
  return {
    target,
    position: [center.x + direction.x * Math.cos(elevation) * distance, center.y + Math.sin(elevation) * distance, center.z + direction.y * Math.cos(elevation) * distance],
    fitBounds: { min: fit.min.toArray(), max: fit.max.toArray() },
    minDistance: 0.3,
    maxDistance: span * 5,
    minPolar: 0.1,
    maxPolar: Math.PI / 2 - 0.03,
    eyeHeight: box.min.y + Math.min(1.6, Math.max(0.5, size.y * 0.65)),
    bounds: { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
    fov: 46,
  };
}
