import type { ScannedCountertopSurface, ScannedElement, ScannedRoomGeometry } from '@/lib/spec/types';

type Point = { x: number; y: number; z: number };
export type ScannedObjectRole = 'base-cabinet' | 'upper-cabinet' | 'tall-cabinet' | 'island' | 'table'
  | 'refrigerator' | 'oven' | 'cooktop' | 'dishwasher' | 'sink' | 'toilet' | 'bathtub'
  | 'chair' | 'sofa' | 'bed' | 'other';

export interface ScannedObjectPresentation {
  id: string;
  kind: string;
  confidence: ScannedElement['confidence'];
  /** A representative visual role, not a verified construction specification. */
  role: ScannedObjectRole;
  dimensions: Point;
  position: Point;
  yaw: number;
  transform: number[];
  sourceTransform: number[];
  countertopSurfaces?: ScannedCountertopSurface[];
  nearestWallId: string | null;
  alignment: { applied: boolean; deltaRadians: number; reason: string };
  representation: 'inferred-from-captured-bounds';
}

export interface ScannedObjectLayoutOptions {
  /** Explicit visual preview only. Never used for measurements, quantities, or export of the original scan. */
  alignLowConfidenceIslands?: boolean;
}

const QUARTER = Math.PI / 2;
const radians = (degrees: number) => degrees * Math.PI / 180;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const yawOf = (matrix: number[]) => Math.atan2(-matrix[2], matrix[0]);
const axisDelta = (from: number, to: number) => ((to - from + QUARTER / 2) % QUARTER + QUARTER) % QUARTER - QUARTER / 2;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function pointAt(element: ScannedElement, x: number, y: number, z = 0): Point {
  const t = element.transform;
  return { x: t[0] * x + t[4] * y + t[8] * z + t[12], y: t[1] * x + t[5] * y + t[9] * z + t[13], z: t[2] * x + t[6] * y + t[10] * z + t[14] };
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const x = b.x - a.x, z = b.z - a.z;
  const t = clamp(((point.x - a.x) * x + (point.z - a.z) * z) / Math.max(1e-12, x * x + z * z), 0, 1);
  return distance(point, { x: a.x + t * x, y: point.y, z: a.z + t * z });
}

function nearestWall(object: ScannedElement, walls: ScannedElement[]) {
  const center = pointAt(object, 0, 0);
  return walls.map(wall => {
    const a = pointAt(wall, -wall.dimensions.x / 2, 0), b = pointAt(wall, wall.dimensions.x / 2, 0);
    return { wall, distance: distanceToSegment(center, a, b) };
  }).sort((a, b) => a.distance - b.distance || a.wall.id.localeCompare(b.wall.id))[0] ?? null;
}

/** An axis family needs substantial, mutually perpendicular walls. A lone wall
 * or an irregular collection of partitions does not justify object alignment. */
function roomAxis(walls: ScannedElement[]): number | null {
  const substantial = walls.filter(wall => wall.dimensions.x >= 0.8 && wall.confidence !== 'low');
  if (substantial.length < 2) return null;
  const total = substantial.reduce((sum, wall) => sum + wall.dimensions.x, 0);
  const candidates = substantial.map(reference => {
    const yaw = yawOf(reference.transform);
    const members = substantial.filter(wall => Math.abs(axisDelta(yaw, yawOf(wall.transform))) <= radians(3));
    return { yaw, members, weight: members.reduce((sum, wall) => sum + wall.dimensions.x, 0) };
  }).sort((a, b) => b.weight - a.weight);
  const best = candidates[0];
  if (best.weight / total < 0.9) return null;
  if (!best.members.some(wall => Math.abs(Math.sin(yawOf(wall.transform) - best.yaw)) > 0.98)) return null;
  const x = best.members.reduce((sum, wall) => sum + Math.cos(yawOf(wall.transform) * 4) * wall.dimensions.x, 0);
  const z = best.members.reduce((sum, wall) => sum + Math.sin(yawOf(wall.transform) * 4) * wall.dimensions.x, 0);
  return Math.atan2(z, x) / 4;
}

function floorHeight(geometry: ScannedRoomGeometry): number {
  const measured = geometry.surfaces.filter(surface => surface.kind === 'floor').flatMap(surface => surface.polygonCorners?.map(point => point.y) ?? []);
  const levels = measured.length ? measured : geometry.surfaces.filter(surface => surface.kind === 'wall').map(wall => pointAt(wall, 0, -wall.dimensions.y / 2).y);
  if (!levels.length) return 0;
  const sorted = levels.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function objectRole(object: ScannedElement, roomType: 'kitchen' | 'bathroom', floor: number, wallDistance: number): ScannedObjectRole {
  const kind = object.kind.toLowerCase().replace(/[\s_-]/g, '');
  const d = object.dimensions;
  const attributes = (object.attributes ?? []).join(' ').toLowerCase();
  // RoomPlan's semantic attributes outrank a box-size guess. A bookshelf is
  // furniture; a round table is not evidence of a kitchen island.
  if (kind === 'storage' && /bookcase|bookshelf|shelving/.test(attributes)) return 'other';
  if (kind === 'table' && /round|circular|elliptic|dining|conference|coffee/.test(attributes)) return 'table';
  const bottom = Math.min(...[-0.5, 0.5].flatMap(x => [-0.5, 0.5].flatMap(y => [-0.5, 0.5].map(z => pointAt(object, d.x * x, d.y * y, d.z * z).y)))) - floor;
  const longest = Math.max(d.x, d.z), shortest = Math.min(d.x, d.z);
  // A bounding box can also include clutter or a chamfered breakfast bar. This
  // role deliberately makes no assertion that its real footprint is rectangular.
  const counterSized = d.y >= 0.82 && d.y <= 1.25 && bottom >= -0.12 && bottom <= 0.2
    && longest >= 1.15 && longest <= 4.5 && shortest >= 0.65 && shortest <= 2.2;
  const freestanding = Number.isFinite(wallDistance) && wallDistance - Math.hypot(d.x, d.z) / 2 >= 0.35;
  if (roomType === 'kitchen' && ['storage', 'table', 'island'].includes(kind) && counterSized && freestanding) return 'island';
  if (kind === 'storage' || kind === 'cabinet') {
    if (bottom >= 0.65 && d.y <= 1.9 && d.z <= 0.9) return 'upper-cabinet';
    if (bottom <= 0.35 && d.y >= 1.35) return 'tall-cabinet';
    if (bottom <= 0.35 && d.y >= 0.45 && d.y <= 1.3) return 'base-cabinet';
    return 'other';
  }
  if (kind === 'stove' || kind === 'cooktop') return d.y <= 0.3 ? 'cooktop' : 'oven';
  const direct: Record<string, ScannedObjectRole> = {
    refrigerator: 'refrigerator', fridge: 'refrigerator', oven: 'oven', dishwasher: 'dishwasher', sink: 'sink',
    toilet: 'toilet', bathtub: 'bathtub', tub: 'bathtub', chair: 'chair', sofa: 'sofa', bed: 'bed', table: 'table',
  };
  return direct[kind] ?? 'other';
}

/** Rotate only the presentation's basis about its captured centre. Pitch, roll,
 * dimensions, source data and translation stay intact. */
function rotatedBasis(source: number[], delta: number): number[] {
  const transform = [...source], c = Math.cos(delta), s = Math.sin(delta);
  for (const i of [0, 4, 8]) {
    transform[i] = c * source[i] + s * source[i + 2];
    transform[i + 2] = -s * source[i] + c * source[i + 2];
  }
  return transform;
}

/** Derive renderable furniture roles without writing guessed fixture details or
 * adjusted transforms into the captured geometry or estimator inputs. Measured
 * orientation is the default: a real angled peninsula must not be silently squared. */
export function scannedObjectLayout(geometry: ScannedRoomGeometry, roomType: 'kitchen' | 'bathroom', options: ScannedObjectLayoutOptions = {}) {
  const walls = geometry.surfaces.filter(surface => surface.kind === 'wall' && surface.dimensions.x > 0 && surface.dimensions.y > 0);
  const axis = roomAxis(walls), floor = floorHeight(geometry);
  const objects: ScannedObjectPresentation[] = geometry.objects.map(object => {
    const nearest = nearestWall(object, walls);
    const role = objectRole(object, roomType, floor, nearest?.distance ?? Infinity);
    const sourceYaw = yawOf(object.transform);
    const delta = axis === null ? 0 : axisDelta(sourceYaw, axis);
    const radius = Math.max(...[-0.5, 0.5].flatMap(x => [-0.5, 0.5].flatMap(y => [-0.5, 0.5].map(z => {
      const corner = pointAt(object, x * object.dimensions.x, y * object.dimensions.y, z * object.dimensions.z);
      return Math.hypot(corner.x - object.transform[12], corner.z - object.transform[14]);
    }))));
    const cornerMovement = 2 * radius * Math.sin(Math.abs(delta) / 2);
    const hasMeasuredTop = (object.countertopSurfaces?.length ?? 0) > 0;
    const eligible = !hasMeasuredTop && role === 'island' && object.confidence === 'low' && axis !== null
      && Math.abs(delta) >= radians(0.1) && Math.abs(delta) <= radians(12) && cornerMovement <= 0.3;
    const applied = Boolean(options.alignLowConfidenceIslands && eligible);
    const transform = applied ? rotatedBasis(object.transform, delta) : [...object.transform];
    return {
      id: object.id, kind: object.kind, confidence: object.confidence, role,
      dimensions: { ...object.dimensions }, position: { x: transform[12], y: transform[13], z: transform[14] },
      yaw: yawOf(transform), transform, sourceTransform: [...object.transform], nearestWallId: nearest?.wall.id ?? null,
      ...(object.countertopSurfaces ? { countertopSurfaces: structuredClone(object.countertopSurfaces) } : {}),
      alignment: {
        applied, deltaRadians: applied ? delta : 0,
        reason: applied ? 'An optional preview aligns this low-confidence island to the main wall directions. Its actual outline and angle require review.'
          : eligible ? 'Captured orientation retained. A low-confidence island may represent a genuinely angled or irregular breakfast bar.'
            : hasMeasuredTop ? 'Measured LiDAR countertop contours retain their exact world positions and orientation; straightening is disabled.' : 'Captured orientation retained.',
      },
      representation: 'inferred-from-captured-bounds',
    };
  });
  const alignedCount = objects.filter(object => object.alignment.applied).length;
  return {
    objects, alignedCount,
    notices: [
      'Object shapes and fixture details are representative models fitted inside captured bounds; verify fronts, divisions and actual outlines against the room.',
      ...(objects.some(object => object.countertopSurfaces?.length) ? ['LiDAR countertop patches show observed coverage only. Gaps do not establish cutouts or the full perimeter; slab thickness and cabinet construction remain unmeasured.'] : []),
      ...(alignedCount ? [`${alignedCount} low-confidence island preview${alignedCount === 1 ? ' is' : 's are'} aligned to the main walls. Original scan angles and measurement quantities remain unchanged.`] : []),
    ],
  };
}
