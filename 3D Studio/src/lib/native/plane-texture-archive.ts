import type { NativeRoomFrame } from './scan-import';
import type { RawRoomObject, RawRoomSurface } from './room-geometry-digest';
import { meshPointInFrame, validMeshFrame } from './mesh-archive';
import { countertopSurfaceIssue } from './countertop-surfaces';

export const MAX_PLANE_TEXTURE_BYTES = 8 * 1024 * 1024;
export const MAX_PLANE_TEXTURE_BASE64 = Math.ceil(MAX_PLANE_TEXTURE_BYTES / 3) * 4;
export const MAX_PLANE_TEXTURE_TEXELS = 2_000_000;
type Vec = [number, number, number];
export interface ScanPlaneTexturePlane {
  id: string;
  kind: 'wall' | 'floor' | 'countertop';
  /** Present only for a validated MNHPLAN2 recorded countertop reference. */
  objectId?: string;
  patchIndex?: number;
  width: number;
  height: number;
  /** Studio coordinates: lower-left grid corner, then unit U/V axes. */
  origin: Vec;
  u: Vec;
  v: Vec;
  metersPerTexel: number;
  /** sRGB bytes. Row0 is minimumV. Alpha0 pixels have zero RGB. Render with
   * nearest filtering, no mipmaps and no interpolation through invalid masks. */
  rgba: Uint8Array;
  observedTexels: number;
}
export interface ScanPlaneTexture {
  version?: 1 | 2;
  roomGeometrySHA256: string;
  meshXYZSHA256: string;
  /** Native cache provenance; JS never receives/verifies the camera archive. */
  cameraSHA256: string;
  wasLimited: boolean;
  planes: ScanPlaneTexturePlane[];
  totalTexels: number;
  observedTexels: number;
}
export interface PlaneTextureExpectation {
  roomGeometrySHA256: string;
  /** MNHPGEO2, computed from the original room before studio normalization. */
  roomAppearanceSHA256?: string;
  meshXYZSHA256: string;
  cameraSHA256: string;
  surfaces: RawRoomSurface[];
  objects?: RawRoomObject[];
  frame: NativeRoomFrame;
}
function fail(message: string): never { throw new Error(message); }
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const point = (p: { x: number; y: number; z: number }): Vec => [p.x, p.y, p.z];
const norm = (p: Vec) => Math.hypot(...p);
const unit = (p: Vec): Vec => { const n = norm(p); if (!Number.isFinite(n) || n < 1e-9) fail('Invalid measured plane basis.'); return p.map(x => x / n) as Vec; };
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const valid = (p: Vec) => p.every(n => Number.isFinite(n) && Math.abs(n) <= 1000);
const close = (a: Vec, b: Vec, epsilon = 1e-6) => a.every((n, i) => Math.abs(n - b[i]) <= epsilon);
const hash = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
type Point2 = [number, number];
function simpleRing(ring: Point2[]): boolean {
  const side = (a: Point2, b: Point2, p: Point2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const on = (p: Point2, a: Point2, b: Point2) => Math.abs(side(a, b, p)) <= 1e-8 && p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8 && p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-8) return false;
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      const c = ring[j], d = ring[(j + 1) % ring.length];
      if ((side(a, b, c) * side(a, b, d) < -1e-16 && side(c, d, a) * side(c, d, b) < -1e-16) || on(a, c, d) || on(b, c, d) || on(c, a, b) || on(d, a, b)) return false;
    }
  }
  return true;
}

/** The deterministic source grid shared with Swift. Dimensions describe the
 * image domain only; original polygons/openings still clip rendered geometry. */
export function measuredPlaneGrid(surface: RawRoomSurface): { origin: Vec; u: Vec; v: Vec; width: number; height: number } {
  const t = surface.transform;
  if (!Array.isArray(t) || t.length !== 16 || !t.every(n => Number.isFinite(n) && Math.abs(n) <= 1000)) fail('Invalid measured plane transform.');
  const x: Vec = [t[0], t[1], t[2]], y: Vec = [t[4], t[5], t[6]], z: Vec = [t[8], t[9], t[10]];
  if ([x, y, z].some(v => Math.abs(norm(v) - 1) > 1e-4) || Math.max(Math.abs(dot(x, y)), Math.abs(dot(x, z)), Math.abs(dot(y, z))) > 1e-4
    || Math.abs(dot(cross(x, y), z) - 1) > 1e-4 || Math.max(Math.abs(t[3]), Math.abs(t[7]), Math.abs(t[11]), Math.abs(t[15] - 1)) > 1e-4) fail('Invalid measured plane transform.');
  const dimensions = surface.dimensions;
  if (!dimensions || ![dimensions.x, dimensions.y, dimensions.z].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) fail('Invalid measured plane dimensions.');
  const polygon = surface.polygonCorners?.map(point);
  if (polygon && (polygon.length < 3 || polygon.length > 256 || !polygon.every(valid))) fail('Invalid measured plane polygon.');
  let center: Vec = [t[12], t[13], t[14]], u = unit(x), v = unit(y), coordinates: [number, number][];
  if (surface.kind === 'floor') {
    if (!polygon) fail('A camera floor image requires an observed floor polygon.');
    const level = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
    if (Math.max(...polygon.map(p => p[1])) - Math.min(...polygon.map(p => p[1])) > 0.01) fail('Measured floor is not a supported plane.');
    center = [0, level, 0]; u = [1, 0, 0]; v = [0, 0, 1]; coordinates = polygon.map(p => [p[0], p[2]]);
  } else if (surface.kind === 'wall') {
    const normal = unit(cross(u, v));
    if (polygon?.some(p => Math.abs(dot(sub(p, center), normal)) > 0.01)) fail('Measured wall is not a supported plane.');
    coordinates = polygon ? polygon.map(p => { const delta = sub(p, center); return [dot(delta, u), dot(delta, v)]; })
      : [[-dimensions.x / 2, -dimensions.y / 2], [dimensions.x / 2, -dimensions.y / 2], [dimensions.x / 2, dimensions.y / 2], [-dimensions.x / 2, dimensions.y / 2]];
  } else fail('Camera plane does not refer to a wall or floor.');
  const xs = coordinates.map(p => p[0]), ys = coordinates.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const area = Math.abs(coordinates.reduce((sum, p, i) => { const q = coordinates[(i + 1) % coordinates.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  if (!Number.isFinite(area) || area <= 0.001 || !simpleRing(coordinates) || width <= 0 || height <= 0 || width > 100 || height > 100) fail('Measured plane has no supported image area.');
  return { origin: center.map((n, i) => n + u[i] * minX + v[i] * minY) as Vec, u, v, width, height };
}

/** Match native eligibility exactly; a generic table may actually be a stool. */
export function measuredCountertopOwner(object: RawRoomObject): boolean {
  return ['storage', 'cabinet', 'dishwasher', 'island'].includes(object.kind)
    || (object.kind === 'table' && Array.isArray(object.attributes) && object.attributes.includes('TableType:kitchenIsland'));
}
export const measuredCountertopPlaneId = (objectId: string, patchIndex: number) => `countertop:${objectId}:${patchIndex}`;
export function measuredCountertopGrid(object: RawRoomObject, patchIndex: number): ReturnType<typeof measuredPlaneGrid> {
  const patch = object.countertopSurfaces?.[patchIndex];
  if (!measuredCountertopOwner(object) || !Number.isInteger(patchIndex) || patchIndex < 0 || patchIndex > 7 || !patch || countertopSurfaceIssue(patch)) fail('Camera image references an unsupported measured countertop.');
  // A derived floor-like grid uses the measured horizontal ring. The object's
  // bounds and classification remain untouched, including merged tall boxes.
  return measuredPlaneGrid({ ...object, kind: 'floor', polygonCorners: patch.polygonCorners });
}

type CellDomain = { rings: Point2[][]; rectangle: boolean };
function countertopDomain(object: RawRoomObject, patchIndex: number, grid: ReturnType<typeof measuredPlaneGrid>): CellDomain {
  const patch = object.countertopSurfaces![patchIndex];
  const rings = [patch.polygonCorners, ...(patch.holes ?? [])].map(ring => ring.map(p => [p.x - grid.origin[0], p.z - grid.origin[2]] as Point2));
  const rectangle = rings.length === 1 && rings[0].length === 4 && rings[0].every(p => (Math.abs(p[0]) < 1e-8 || Math.abs(p[0] - grid.width) < 1e-8) && (Math.abs(p[1]) < 1e-8 || Math.abs(p[1] - grid.height) < 1e-8));
  return { rings, rectangle };
}
const side2 = (a: Point2, b: Point2, p: Point2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
/** Native validates the center plus all four corners. A narrow hole/notch can
 * still pass those five probes, so preserve its ring/edge intersection check. */
function countertopCell(domain: CellDomain, x: number, y: number, step: number, width: number, height: number, work: { remaining: number }): boolean {
  const x0 = x * step, y0 = y * step;
  if (domain.rectangle) return x0 + step <= width + 1e-8 && y0 + step <= height + 1e-8;
  const points: Point2[] = [[x0 + step / 2, y0 + step / 2], [x0, y0], [x0 + step, y0], [x0 + step, y0 + step], [x0, y0 + step]];
  const inside = (p: Point2, ring: Point2[]) => {
    let value = false;
    for (let i = 0; i < ring.length; i++) {
      if (--work.remaining < 0) fail('Measured-countertop coverage validation exceeds the supported work limit.');
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (Math.abs(side2(a, b, p)) <= 1e-8 && p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8 && p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8) return true;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) value = !value;
    }
    return value;
  };
  if (!points.every(p => inside(p, domain.rings[0]) && !domain.rings.slice(1).some(ring => inside(p, ring)))) return false;
  const edges = points.slice(1);
  for (const ring of domain.rings) {
    if (ring.some(p => p[0] > x0 + 1e-8 && p[0] < x0 + step - 1e-8 && p[1] > y0 + 1e-8 && p[1] < y0 + step - 1e-8)) return false;
    for (let i = 0; i < ring.length; i++) for (let j = 0; j < 4; j++) {
      if (--work.remaining < 0) fail('Measured-countertop coverage validation exceeds the supported work limit.');
      const a = ring[i], b = ring[(i + 1) % ring.length], c = edges[j], d = edges[(j + 1) % 4];
      if (side2(a, b, c) * side2(a, b, d) < -1e-16 && side2(c, d, a) * side2(c, d, b) < -1e-16) return false;
    }
  }
  return true;
}

function bytesOf(data: unknown): Uint8Array<ArrayBuffer> {
  if (data instanceof ArrayBuffer) {
    if (data.byteLength < 107 || data.byteLength > MAX_PLANE_TEXTURE_BYTES) fail('Measured-plane image exceeds the supported size.');
    return new Uint8Array(data);
  }
  if (typeof data !== 'string' || !data.length || data.length > MAX_PLANE_TEXTURE_BASE64 || data.length % 4 || /[^A-Za-z0-9+/=]/.test(data)) fail('Invalid measured-plane image encoding.');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if (data.slice(0, data.length - padding).includes('=')) fail('Invalid measured-plane image padding.');
  const tail = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(data[data.length - padding - 1]);
  if ((padding === 2 && (tail & 15)) || (padding === 1 && (tail & 3))) fail('Invalid measured-plane image padding bits.');
  const size = data.length / 4 * 3 - padding;
  if (size < 107 || size > MAX_PLANE_TEXTURE_BYTES) fail('Measured-plane image exceeds the supported size.');
  const raw = atob(data), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Decode only the separate bounded native asset. Hashes bind raw room planes,
 * original mesh XYZ and native camera-cache provenance before normalization. */
export function decodePlaneTextureArchive(data: unknown, expected: PlaneTextureExpectation): ScanPlaneTexture {
  if (![expected.roomGeometrySHA256, expected.meshXYZSHA256, expected.cameraSHA256].every(s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)) || !validMeshFrame(expected.frame)) fail('The measured-plane image source could not be verified.');
  if (!Array.isArray(expected.surfaces) || expected.surfaces.length > 256 || new Set(expected.surfaces.map(s => s.id)).size !== expected.surfaces.length) fail('Invalid measured-plane source IDs.');
  const sources = new Map(expected.surfaces.map(s => [s.id, s]));
  const bytes = bytesOf(data), view = new DataView(bytes.buffer), magic = String.fromCharCode(...bytes.subarray(0, 8));
  const version = magic === 'MNHPLAN1' ? 1 : magic === 'MNHPLAN2' ? 2 : fail('Unsupported measured-plane image version.');
  const topSources = new Map<string, { object: RawRoomObject; patchIndex: number }>();
  if (version === 2) {
    if (typeof expected.roomAppearanceSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.roomAppearanceSHA256) || !Array.isArray(expected.objects) || expected.objects.length > 512
      || new Set(expected.objects.map(o => o?.id)).size !== expected.objects.length) fail('Measured-countertop images require their original room objects and geometry fingerprint.');
    for (const object of expected.objects) {
      if (!object || typeof object.id !== 'string' || !object.id.length || object.id.includes('\0') || new TextEncoder().encode(object.id).length > 160
        || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new TextEncoder().encode(object.id)) !== object.id
        || (object.attributes !== undefined && (!Array.isArray(object.attributes) || object.attributes.some(a => typeof a !== 'string')))
        || (object.countertopSurfaces !== undefined && (!Array.isArray(object.countertopSurfaces) || object.countertopSurfaces.length > 8))) fail('Invalid measured-countertop source object.');
      if (measuredCountertopOwner(object)) (object.countertopSurfaces ?? []).forEach((_, patchIndex) => topSources.set(measuredCountertopPlaneId(object.id, patchIndex), { object, patchIndex }));
    }
  }
  const roomGeometrySHA256 = hash(bytes.subarray(8, 40)), meshXYZSHA256 = hash(bytes.subarray(40, 72)), cameraSHA256 = hash(bytes.subarray(72, 104));
  if (roomGeometrySHA256 !== (version === 2 ? expected.roomAppearanceSHA256 : expected.roomGeometrySHA256) || meshXYZSHA256 !== expected.meshXYZSHA256 || cameraSHA256 !== expected.cameraSHA256) fail('Measured-plane images belong to different capture evidence.');
  const count = view.getUint16(104, true), limited = view.getUint8(106);
  if (count < 1 || count > 64 || limited > 1) fail('Invalid measured-plane image counts or flags.');
  const planes: ScanPlaneTexturePlane[] = [], ids = new Set<string>(), utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let offset = 107, totalTexels = 0, observedTexels = 0;
  const coverageWork = { remaining: 64_000_000 };
  const readVector = (): Vec => { const values: Vec = [view.getFloat64(offset, true), view.getFloat64(offset + 8, true), view.getFloat64(offset + 16, true)]; offset += 24; if (!valid(values)) fail('Invalid measured-plane image coordinates.'); return values; };
  for (let index = 0; index < count; index++) {
    if (offset + 2 > bytes.length) fail('Truncated measured-plane image ID.');
    const idLength = view.getUint16(offset, true); offset += 2;
    if (idLength < 1 || idLength > (version === 2 ? 192 : 160) || offset + idLength + 89 > bytes.length) fail('Invalid measured-plane image record.');
    const id = utf8.decode(bytes.subarray(offset, offset + idLength)); offset += idLength;
    if (id.includes('\0') || ids.has(id)) fail('Invalid or duplicate measured-plane image ID.');
    ids.add(id);
    const kindCode = view.getUint8(offset++), width = view.getUint16(offset, true), height = view.getUint16(offset + 2, true); offset += 4;
    const source = sources.get(id), top = version === 2 && kindCode === 3 ? topSources.get(id) : undefined;
    const kind = kindCode === 1 ? 'wall' : kindCode === 2 ? 'floor' : version === 2 && kindCode === 3 ? 'countertop' : null;
    if (!kind || (kind === 'countertop' ? !top : !source || source.kind !== kind || idLength > 160)) fail('Camera image references an unknown measured plane.');
    if (width < 1 || height < 1 || width > 1024 || height > 1024 || totalTexels + width * height > MAX_PLANE_TEXTURE_TEXELS) fail('Measured-plane image dimensions exceed the supported limit.');
    const origin = readVector(), u = readVector(), v = readVector(), metersPerTexel = view.getFloat64(offset, true); offset += 8;
    const length = view.getUint32(offset, true); offset += 4;
    if (!Number.isFinite(metersPerTexel) || metersPerTexel < 0.005 || metersPerTexel > 0.25 || length !== width * height * 4 || offset + length > bytes.length) fail('Invalid measured-plane image resolution or byte count.');
    const grid = top ? measuredCountertopGrid(top.object, top.patchIndex) : measuredPlaneGrid(source!);
    const domain = top ? countertopDomain(top.object, top.patchIndex, grid) : null;
    if (!close(origin, grid.origin) || !close(u, grid.u) || !close(v, grid.v) || Math.abs(norm(u) - 1) > 1e-6 || Math.abs(norm(v) - 1) > 1e-6 || Math.abs(dot(u, v)) > 1e-6
      || width !== Math.ceil(grid.width / metersPerTexel) || height !== Math.ceil(grid.height / metersPerTexel)) fail('Camera image does not match its measured plane geometry.');
    const rgba = bytes.slice(offset, offset + length); offset += length; let colored = 0;
    for (let p = 0; p < rgba.length; p += 4) {
      const alpha = rgba[p + 3];
      if (alpha !== 0 && alpha !== 255) fail('Measured-plane image contains an invalid coverage mask.');
      if (alpha === 0 && (rgba[p] !== 0 || rgba[p + 1] !== 0 || rgba[p + 2] !== 0)) fail('Unsupported measured-plane pixels must contain no color.');
      if (alpha === 255) {
        if (domain && !countertopCell(domain, p / 4 % width, Math.floor(p / 4 / width), metersPerTexel, grid.width, grid.height, coverageWork)) fail('Camera countertop image colors an unsupported outline or hole.');
        colored++;
      }
    }
    if (!colored) fail('Measured-plane image contains no camera observations.');
    const rotate = (p: Vec): Vec => [p[0] * expected.frame.widthAxis.x + p[2] * expected.frame.widthAxis.z, p[1], p[0] * expected.frame.depthAxis.x + p[2] * expected.frame.depthAxis.z];
    planes.push({ id, kind, ...(top ? { objectId: top.object.id, patchIndex: top.patchIndex } : {}), width, height, origin: meshPointInFrame(...origin, expected.frame), u: rotate(u), v: rotate(v), metersPerTexel, rgba, observedTexels: colored });
    totalTexels += width * height; observedTexels += colored;
  }
  if (offset !== bytes.length) fail('Measured-plane image contains trailing data.');
  return { version, roomGeometrySHA256, meshXYZSHA256, cameraSHA256, wasLimited: limited === 1, planes, totalTexels, observedTexels };
}
