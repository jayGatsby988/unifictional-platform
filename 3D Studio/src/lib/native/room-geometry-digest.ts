import type { NativeScanPayload } from './scan-import';
import { countertopSurfaceIssue } from './countertop-surfaces';

export type RawRoomSurface = NativeScanPayload['room']['surfaces'][number];
export type RawRoomObject = NativeScanPayload['room']['objects'][number];
export const ROOM_SURFACE_KIND = { wall: 1, floor: 2, door: 3, window: 4, opening: 5 } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const finite = (n: number, limit = 1000) => Number.isFinite(n) && Math.abs(n) <= limit;
const utf8Compare = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

/** MNHPGEO1 is a hash-only canonical representation shared with Swift. Float32
 * matches ARKit source precision and tolerates JSON Float64 ULP differences;
 * it NEVER rewrites project geometry. Sort elements by raw UTF8 ID bytes while
 * preserving polygon order. Absent polygons have count0; -0 hashes as +0. */
export function canonicalRoomSurfaceBytes(surfaces: RawRoomSurface[]): Uint8Array<ArrayBuffer> {
  if (!Array.isArray(surfaces) || !surfaces.length || surfaces.length > 256) throw new Error('Invalid measured room surface count.');
  const ids = new Set<string>();
  const records = surfaces.map(surface => {
    if (!surface || !Object.hasOwn(ROOM_SURFACE_KIND, surface.kind) || typeof surface.id !== 'string' || !surface.id.length || surface.id.includes('\0')) throw new Error('Invalid measured room surface.');
    const id = encoder.encode(surface.id), polygon = surface.polygonCorners ?? [];
    if (id.length > 160 || ids.has(surface.id) || decoder.decode(id) !== surface.id) throw new Error('Invalid or duplicate measured room surface ID.');
    ids.add(surface.id);
    const d = surface.dimensions;
    if (!d || ![d.x, d.y, d.z].every(n => finite(n, 100) && n >= 0) || !Array.isArray(surface.transform) || surface.transform.length !== 16 || !surface.transform.every(n => finite(n))) throw new Error('Invalid measured room dimensions or transform.');
    if (!Array.isArray(polygon) || (polygon.length !== 0 && (polygon.length < 3 || polygon.length > 256)) || polygon.some(p => !p || ![p.x, p.y, p.z].every(n => finite(n)))) throw new Error('Invalid measured room polygon.');
    return { surface, id, polygon };
  }).sort((a, b) => utf8Compare(a.id, b.id));
  const length = 10 + records.reduce((sum, record) => sum + 2 + record.id.length + 1 + 19 * 4 + 2 + record.polygon.length * 12, 0);
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer); bytes.set(encoder.encode('MNHPGEO1'));
  view.setUint16(8, records.length, true); let offset = 10;
  const float = (n: number) => { view.setFloat32(offset, n === 0 ? 0 : n, true); offset += 4; };
  for (const { surface, id, polygon } of records) {
    view.setUint16(offset, id.length, true); offset += 2; bytes.set(id, offset); offset += id.length;
    view.setUint8(offset++, ROOM_SURFACE_KIND[surface.kind]);
    [surface.dimensions.x, surface.dimensions.y, surface.dimensions.z, ...surface.transform].forEach(float);
    view.setUint16(offset, polygon.length, true); offset += 2;
    for (const p of polygon) [p.x, p.y, p.z].forEach(float);
  }
  return bytes;
}
export async function roomSurfaceGeometryDigest(surfaces: RawRoomSurface[]): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Measured room geometry hashing is unavailable.');
  const hash = await crypto.subtle.digest('SHA-256', canonicalRoomSurfaceBytes(surfaces));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}

/** MNHPGEO2 binds the same raw surface records, followed by every top-bearing
 * object, even when its semantic kind cannot receive a countertop image.
 * Sorting affects only object/attribute order; all captured ring order stays
 * intact. These bytes are for hashing, never for changing source geometry. */
export function canonicalRoomAppearanceBytes(surfaces: RawRoomSurface[], objects: RawRoomObject[]): Uint8Array<ArrayBuffer> {
  const surfaceBytes = canonicalRoomSurfaceBytes(surfaces);
  if (!Array.isArray(objects) || objects.length > 512) throw new Error('Invalid measured room object count.');
  const string = (value: string, maximum: number) => {
    if (typeof value !== 'string' || !value.length || value.includes('\0')) throw new Error('Invalid measured object string.');
    const bytes = encoder.encode(value);
    if (bytes.length > maximum || decoder.decode(bytes) !== value) throw new Error('Invalid measured object UTF8.');
    return bytes;
  };
  const ids = new Set<string>();
  const records = objects.filter(object => (object?.countertopSurfaces?.length ?? 0) > 0).map(object => {
    const id = string(object.id, 160), kind = string(object.kind, 100), d = object.dimensions, patches = object.countertopSurfaces!;
    if (ids.has(object.id)) throw new Error('Duplicate measured countertop owner.'); ids.add(object.id);
    if (!d || ![d.x, d.y, d.z].every(n => finite(n, 100) && n >= 0) || !Array.isArray(object.transform) || object.transform.length !== 16 || !object.transform.every(n => finite(n))) throw new Error('Invalid measured object dimensions or transform.');
    if (!Array.isArray(object.attributes ?? []) || (object.attributes?.length ?? 0) > 32) throw new Error('Invalid measured object attribute count.');
    const attributes = (object.attributes ?? []).map(value => string(value, 128)).sort(utf8Compare);
    if (!Array.isArray(patches) || patches.length > 8) throw new Error('Invalid measured countertop count.');
    const tops = patches.map(patch => {
      if (!patch || countertopSurfaceIssue(patch)) throw new Error('Invalid measured countertop geometry.');
      return { patch, source: string(patch.source, 100), rings: [patch.polygonCorners, ...(patch.holes ?? [])] };
    });
    return { object, id, kind, attributes, tops };
  }).sort((a, b) => utf8Compare(a.id, b.id));
  const length = surfaceBytes.length + 2 + records.reduce((sum, record) => sum + 2 + record.id.length + 2 + record.kind.length + 19 * 4 + 2
    + record.attributes.reduce((n, attribute) => n + 2 + attribute.length, 0) + 2
    + record.tops.reduce((n, top) => n + 2 + top.source.length + 4 + 2 + top.rings.reduce((m, ring) => m + 2 + ring.length * 12, 0), 0), 0);
  if (length > 20 * 1024 * 1024) throw new Error('Measured room appearance geometry exceeds the supported size.');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  bytes.set(surfaceBytes); bytes.set(encoder.encode('MNHPGEO2'));
  let offset = surfaceBytes.length;
  const count = (n: number) => { view.setUint16(offset, n, true); offset += 2; };
  const text = (value: Uint8Array) => { count(value.length); bytes.set(value, offset); offset += value.length; };
  const float = (n: number) => { view.setFloat32(offset, n === 0 ? 0 : n, true); offset += 4; };
  count(records.length);
  for (const { object, id, kind, attributes, tops } of records) {
    text(id); text(kind); [object.dimensions.x, object.dimensions.y, object.dimensions.z, ...object.transform].forEach(float);
    count(attributes.length); attributes.forEach(text); count(tops.length);
    for (const { patch, source, rings } of tops) {
      text(source); float(patch.resolutionMeters); count(rings.length);
      for (const ring of rings) { count(ring.length); for (const p of ring) [p.x, p.y, p.z].forEach(float); }
    }
  }
  return bytes;
}

export async function roomAppearanceGeometryDigest(surfaces: RawRoomSurface[], objects: RawRoomObject[]): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Measured room geometry hashing is unavailable.');
  const hash = await crypto.subtle.digest('SHA-256', canonicalRoomAppearanceBytes(surfaces, objects));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
