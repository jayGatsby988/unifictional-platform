import { z } from 'zod';
import { defaultBathroom, defaultKitchen, emptyDecor } from '@/lib/spec/defaults';
import { RoomSpecZ, OpeningZ, ScannedCountertopSurfaceZ, ScanElementMetadataZ } from '@/lib/spec/schema';
import type { Opening, Project, SingleRoomSpec, Wall, ScannedElement, ScannedRoomGeometry } from '@/lib/spec/types';
import { EstimateSettingsZ, JarvisStateZ, ProjectBaselineZ } from '@/lib/jarvis/schemas';
import { prepareScanFloors, reviewScanBoundary, scanPoint, scannedRoomQuantities } from './scan-geometry';
import { validMeshFrame } from './mesh-archive';

const finite = z.number().finite();
const id = z.string().min(1).max(160);
const vector = z.object({ x: finite, y: finite, z: finite }).strict();
const element = z.object({
  id, kind: z.string().min(1).max(100), position: vector,
  dimensions: z.object({ x: finite.nonnegative(), y: finite.nonnegative(), z: finite.nonnegative() }).strict(),
  transform: z.array(finite).length(16), confidence: z.enum(['high', 'medium', 'low', 'sample', 'unknown']),
  polygonCorners: z.array(vector).min(3).max(256).nullable().optional(),
  countertopSurfaces: z.array(ScannedCountertopSurfaceZ).max(8).optional(),
  ...ScanElementMetadataZ.shape,
}).strict();
export const NativeScanPayloadZ = z.object({
  version: z.literal(1), id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), name: z.string().trim().min(1).max(200),
  roomType: z.enum(['kitchen', 'bathroom']), isSample: z.boolean(),
  room: z.object({ surfaces: z.array(element.extend({ kind: z.enum(['wall', 'door', 'window', 'opening', 'floor']) })).max(256), objects: z.array(element).max(512), capturedAt: z.string().datetime({ offset: true }) }).strict(),
  measurements: z.object({ widthMeters: finite.nonnegative(), depthMeters: finite.nonnegative(), heightMeters: finite.nonnegative(), verified: z.boolean() }).strict().refine(m => !m.verified || [m.widthMeters, m.depthMeters, m.heightMeters].every(n => n > 0), 'Confirmed room dimensions must be positive'),
  studioSnapshot: z.unknown().optional().nullable(),
  detailPhotoCount: z.number().int().min(0).max(30).optional(),
}).strict();
export type NativeScanPayload = z.infer<typeof NativeScanPayloadZ>;
type Element = z.infer<typeof element>;
type Vec = z.infer<typeof vector>;

const text = z.string().max(30000), map = z.record(z.string().max(160), z.string().max(200));
const url = z.string().max(4000).url().regex(/^https?:\/\//);
// Local upload/render writers use URL-safe project IDs and nanoid(12) image
// names. Permit that exact app-owned shape, never arbitrary relative paths.
const renderUrl = z.union([url, z.string().regex(/^\/uploads\/(viewport|renders)\/[A-Za-z0-9_-]{4,40}\/[A-Za-z0-9_-]{12}\.(jpg|png|webp)$/)]);
const photo = z.object({ url, width: finite.positive().optional(), height: finite.positive().optional(), primary: z.boolean().optional() }).strict();
const job = { id, status: z.enum(['queued', 'running', 'completed', 'failed']), createdAt: z.string().datetime(), sourceUrl: url, resultUrl: url.optional(), error: text.optional() };
/** Validate every field the studio consumes; return the original document after validation. */
export const NativeStudioProjectZ = z.object({
  id, name: z.string().min(1).max(200), roomType: z.enum(['kitchen', 'bathroom']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  description: text, spec: RoomSpecZ, selections: map, baseline: ProjectBaselineZ.nullable(), estimateSettings: EstimateSettingsZ,
  photos: z.array(photo).max(40), renders: z.array(z.object({ ...job, sourceUrl: renderUrl, resultUrl: renderUrl.optional(), provider: z.enum(['openai', 'google', 'higgsfield']), selections: map, sourceKind: z.enum(['photo', 'viewport']), prompt: text, elapsedMs: finite.nonnegative().optional(), optionId: id.optional(), designFingerprint: id.optional(), scanAppearanceToken: z.string().max(40000).optional() }).strict()).max(100),
  scans: z.array(z.object({ ...job, provider: z.enum(['higgsfield', 'meshy']), model: z.string().max(200), progress: finite.min(0).max(100).optional() }).strict()).max(100),
  overrides: z.record(z.string().max(160), z.unknown()), intake: z.object({ inputKind: z.enum(['room-photo', 'empty-lot', 'floor-plan', 'plans-document']), answers: z.array(z.object({ id, value: text, values: z.array(text).max(100), fromDefault: z.boolean().optional() }).strict()).max(200), capturedAt: z.string().datetime().nullable() }).strict().nullable(),
  branding: z.object({ company: z.string().max(200), phone: z.string().max(64).optional(), email: z.string().max(200).optional(), logoUrl: url.optional(), accent: z.string().max(32).optional() }).strict().optional(),
  client: z.object({ name: z.string().max(200).optional(), address: z.string().max(400).optional() }).strict().optional(),
  jarvis: JarvisStateZ.optional(),
}).strict();

export class NativeImportError extends Error { constructor(message: string) { super(message); this.name = 'NativeImportError'; } }
function fail(message: string): never { throw new NativeImportError(message); }
const FT = 1 / 0.3048;
/** Legacy small-distance comparison; it no longer rejects captured room closure. */
export const NATIVE_GEOMETRY_TOLERANCE_M = 0.005;
const near = (a: number, b: number, tolerance = NATIVE_GEOMETRY_TOLERANCE_M) => Math.abs(a - b) <= tolerance;
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const axis = (e: Element, offset: number): Vec => ({ x: e.transform[offset], y: e.transform[offset + 1], z: e.transform[offset + 2] });
const norm = (v: Vec) => Math.hypot(v.x, v.y, v.z);

const capturedCoordinatePath = /^(surfaces|objects)\.\d+\.(dimensions\.[xyz]|transform\.\d+|polygonCorners\.\d+\.[xyz]|countertopSurfaces\.\d+\.(polygonCorners\.\d+|holes\.\d+\.\d+)\.[xyz])$/;
/** Called only after snapshot schema/rigid validation. Native JSON dictionaries
 * do not preserve key order, and Foundation/WebKit can differ by a few Float64
 * ULPs. Permit only that numeric noise on geometry coordinates; preserve exact
 * IDs, metadata, topology and array order. This never rewrites saved values. */
function sameCapturedGeometry(a: unknown, b: unknown, path = '', sourceArithmeticTolerance?: number): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return capturedCoordinatePath.test(path) && Number.isFinite(a) && Number.isFinite(b)
      && Math.abs(a - b) <= (sourceArithmeticTolerance ?? Math.min(1e-12, 4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b))));
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => sameCapturedGeometry(value, b[index], `${path}.${index}`, sourceArithmeticTolerance));
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key)
    && sameCapturedGeometry(left[key], right[key], path ? `${path}.${key}` : key, sourceArithmeticTolerance));
}

/** Bound untrusted WK bridge documents before schema recursion or geometry work. */
export function assertNativeDocument(value: unknown): void {
  let nodes = 0, chars = 0;
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number) => {
    if (++nodes > 800000 || depth > 40) fail('The native studio document is too large or deeply nested.');
    if (typeof v === 'string') { chars += v.length; if (chars > 20 * 1024 * 1024) fail('The native studio document exceeds 20 MB.'); return; }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
    if (!v || typeof v !== 'object' || seen.has(v)) fail('The native studio document must contain finite JSON values without cycles.');
    seen.add(v);
    if (Array.isArray(v)) { if (v.length > 5000) fail('A native document array is too large.'); v.forEach(x => walk(x, depth + 1)); }
    else { if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail('The native studio document must be plain JSON.'); for (const [key, x] of Object.entries(v)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('The native studio document contains an invalid property.'); walk(x, depth + 1); } }
    seen.delete(v);
  };
  walk(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 20 * 1024 * 1024) fail('The native studio document exceeds 20 MB.');
}
function rigid(e: Element): void {
  const t = e.transform, a = axis(e, 0), b = axis(e, 4), c = axis(e, 8);
  if (![a, b, c].every(v => near(norm(v), 1, 0.0001)) || Math.max(Math.abs(dot(a, b)), Math.abs(dot(a, c)), Math.abs(dot(b, c))) > 0.0001
    || !near(t[3], 0, 0.0001) || !near(t[7], 0, 0.0001) || !near(t[11], 0, 0.0001) || !near(t[15], 1, 0.0001)) fail(`Scan element ${e.id} has a scaled or invalid transform; rescan it before importing.`);
  const determinant = a.x * (b.y * c.z - b.z * c.y) - b.x * (a.y * c.z - a.z * c.y) + c.x * (a.y * b.z - a.z * b.y);
  if (!near(determinant, 1, 0.0001) || Math.hypot(t[12] - e.position.x, t[13] - e.position.y, t[14] - e.position.z) > 0.0001) fail(`Scan element ${e.id} has inconsistent position and transform data.`);
  if (Math.max(...Object.values(e.dimensions)) > 100 || t.some(n => Math.abs(n) > 1000000)) fail(`Scan element ${e.id} is outside supported capture limits.`);
}

export interface NativeRoomFrame {
  origin: Vec;
  widthAxis: Vec;
  depthAxis: Vec;
  widthMeters: number;
  depthMeters: number;
  heightMeters: number;
  maximumClosureErrorMeters: number;
}
export interface NativeImportResult { project: Project; restored: boolean; notices: string[]; frame: NativeRoomFrame | null }

/** The frame only centers the camera and defines studio coordinates. It is
 * never used to replace observed walls with four sides of a bounding box. */
export function nativeRoomFrame(payload: NativeScanPayload): NativeRoomFrame {
  const walls = payload.room.surfaces.filter(s => s.kind === 'wall');
  if (!walls.length) fail('No wall surfaces were captured. Scan at least one wall to open its 3D geometry.');
  [...payload.room.surfaces, ...payload.room.objects].forEach(e => rigid(e));
  if (walls.some(w => w.dimensions.x <= 0 || w.dimensions.y <= 0)) fail('A captured wall has no usable surface dimensions.');
  const reference = [...walls].sort((a, b) => b.dimensions.x - a.dimensions.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  let u = axis(reference, 0);
  if (Math.hypot(u.x, u.z) < 0.01) fail('The wall coordinate system has no horizontal direction.');
  if (u.x < -0.000001 || (Math.abs(u.x) <= 0.000001 && u.z < 0)) u = { x: -u.x, y: 0, z: -u.z };
  u = { x: u.x / Math.hypot(u.x, u.z), y: 0, z: u.z / Math.hypot(u.x, u.z) };
  const v = { x: -u.z, y: 0, z: u.x };
  const corners = walls.flatMap(w => w.polygonCorners && w.polygonCorners.length >= 3 ? w.polygonCorners : [-0.5, 0.5].flatMap(x => [-0.5, 0.5].map(y => scanPoint(w, x * w.dimensions.x, y * w.dimensions.y))));
  const xs = corners.map(p => dot(p, u)), zs = corners.map(p => dot(p, v)), ys = corners.map(p => p.y);
  const minU = Math.min(...xs), maxU = Math.max(...xs), minV = Math.min(...zs), maxV = Math.max(...zs), floor = Math.min(...ys);
  const origin = { x: u.x * (minU + maxU) / 2 + v.x * (minV + maxV) / 2, y: floor, z: u.z * (minU + maxU) / 2 + v.z * (minV + maxV) / 2 };
  return { origin, widthAxis: u, depthAxis: v, widthMeters: maxU - minU, depthMeters: maxV - minV, heightMeters: Math.max(...ys) - floor, maximumClosureErrorMeters: reviewScanBoundary(walls).maximumJoinGapMeters };
}

function eMetadata(e: Element) {
  return Object.fromEntries(['parentIdentifier', 'attributes', 'completedEdges', 'curve'].filter(key => e[key as keyof Element] !== undefined).map(key => [key, e[key as keyof Element]]));
}
function normalizedGeometry(payload: NativeScanPayload, frame: NativeRoomFrame): ScannedRoomGeometry {
  const rotate = (p: Vec): Vec => ({ x: dot(p, frame.widthAxis), y: p.y, z: dot(p, frame.depthAxis) });
  const point = (p: Vec): Vec => rotate({ x: p.x - frame.origin.x, y: p.y - frame.origin.y, z: p.z - frame.origin.z });
  const element = (e: Element): ScannedElement => {
    const a = rotate(axis(e, 0)), b = rotate(axis(e, 4)), c = rotate(axis(e, 8)), p = point(e.position);
    return { id: e.id, kind: e.kind, dimensions: { ...e.dimensions }, confidence: e.confidence, ...ScanElementMetadataZ.parse(eMetadata(e)),
      transform: [a.x, a.y, a.z, 0, b.x, b.y, b.z, 0, c.x, c.y, c.z, 0, p.x, p.y, p.z, 1],
      ...(e.polygonCorners ? { polygonCorners: e.polygonCorners.map(point) } : {}),
      ...(e.countertopSurfaces ? { countertopSurfaces: e.countertopSurfaces.map(surface => ({ ...surface, polygonCorners: surface.polygonCorners.map(point), ...(surface.holes ? { holes: surface.holes.map(hole => hole.map(point)) } : {}) })) } : {}) };
  };
  return { version: 1, surfaces: payload.room.surfaces.map(element), objects: payload.room.objects.map(element) };
}

/** A saved baseline is editable JSON too, so agreement between two saved copies
 * is insufficient. Rebuild only the source comparison in the original rigid
 * frame; never replace the user's saved values or their finish/estimate edits. */
function assertSavedGeometrySource(payload: NativeScanPayload, project: Project, geometry: ScannedRoomGeometry | null | undefined): void {
  const canonical = nativeRoomFrame(payload); // Validate raw transforms even on restoration.
  if (!geometry) fail('The saved design is missing its captured room geometry. The original scan has not been changed.');
  const native = project.overrides.nativeScan as { frame?: unknown } | undefined;
  const frames = [canonical, ...(validMeshFrame(native?.frame) ? [native.frame] : [])];
  const sourceIds = new Set([...payload.room.surfaces, ...payload.room.objects].map(element => element.id));
  const matches = frames.some(frame => {
    const expected = prepareScanFloors(normalizedGeometry(payload, frame)).geometry;
    // Older snapshots predate provisional floor outlines. They may omit that
    // derived surface, but cannot omit a captured surface or add another one.
    const savedIds = new Set(geometry.surfaces.map(element => element.id));
    const compatible = { ...expected, surfaces: expected.surfaces.filter(element => sourceIds.has(element.id) || savedIds.has(element.id)) };
    // Subtracting a persisted world origin and projecting can differ from the
    // original calculation near zero. Budget round-off from the source scale,
    // never millimetres of measurement tolerance; metadata stays exact.
    let magnitude = Math.max(1, ...Object.values(frame.origin));
    const observe = (point: Vec) => { magnitude = Math.max(magnitude, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)); };
    observe(frame.origin);
    for (const element of [...payload.room.surfaces, ...payload.room.objects]) {
      observe(element.position);
      element.polygonCorners?.forEach(observe);
      element.countertopSurfaces?.forEach(surface => { surface.polygonCorners.forEach(observe); surface.holes?.forEach(hole => hole.forEach(observe)); });
    }
    const roundOff = Math.min(1e-8, Math.max(1e-12, 32 * Number.EPSILON * magnitude));
    return sameCapturedGeometry(geometry, compatible, '', roundOff);
  });
  if (!matches) fail('The saved design does not match its original captured room geometry. The original scan and saved design have not been changed.');
}

/** Compatibility hints for the existing cabinet layout controls. Every actual
 * opening is also retained at its exact transform in scanGeometry. */
function scanOpenings(payload: NativeScanPayload, frame: NativeRoomFrame): Opening[] {
  const { widthAxis: u, depthAxis: v, origin, widthMeters: width, depthMeters: depth } = frame;
  const openings: Opening[] = [];
  for (const e of payload.room.surfaces.filter(s => ['door', 'window', 'opening'].includes(s.kind))) {
    const relative = { x: e.position.x - origin.x, y: e.position.y - origin.y, z: e.position.z - origin.z };
    const x = dot(relative, u), z = dot(relative, v), tangent = axis(e, 0);
    const candidates: Array<{ wall: Wall; distance: number; along: number; length: number; tangent: Vec }> = [
      { wall: 'back' as Wall, distance: Math.abs(z + depth / 2), along: x + width / 2, length: width, tangent: u },
      { wall: 'front' as Wall, distance: Math.abs(z - depth / 2), along: width / 2 - x, length: width, tangent: u },
      { wall: 'left' as Wall, distance: Math.abs(x + width / 2), along: depth / 2 - z, length: depth, tangent: v },
      { wall: 'right' as Wall, distance: Math.abs(x - width / 2), along: z + depth / 2, length: depth, tangent: v },
    ].filter(c => c.distance <= 0.12 && Math.abs(dot(tangent, c.tangent)) >= 0.98 && c.length > 0);
    if (candidates.length !== 1) continue;
    const wall = candidates[0], sill = relative.y - e.dimensions.y / 2;
    const parsed = OpeningZ.safeParse({ id: e.id, kind: e.kind === 'opening' ? 'passage' : e.kind, wall: wall.wall, t: wall.along / wall.length, widthFt: e.dimensions.x * FT, heightFt: e.dimensions.y * FT, sillFt: Math.max(0, sill) * FT, style: null });
    if (parsed.success) openings.push(parsed.data);
  }
  return openings;
}

export function importNativeScan(raw: unknown): NativeImportResult {
  assertNativeDocument(raw);
  const parsed = NativeScanPayloadZ.safeParse(raw);
  if (!parsed.success) fail(`Invalid native scan: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const payload = parsed.data;
  if (!payload.isSample && [...payload.room.surfaces, ...payload.room.objects].some(e => e.confidence === 'sample')) fail('Sample confidence is valid only for a clearly labeled sample project.');
  const ids = [...payload.room.surfaces, ...payload.room.objects].map(e => e.id);
  if (new Set(ids).size !== ids.length) fail('Scan elements must have unique identifiers.');
  const projectId = payload.id;
  if (payload.studioSnapshot != null) {
    const saved = NativeStudioProjectZ.safeParse(payload.studioSnapshot);
    if (!saved.success) fail(`The saved studio snapshot is invalid: ${saved.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const project = structuredClone(payload.studioSnapshot) as Project;
    if (project.id !== projectId || project.roomType !== payload.roomType || project.spec?.roomType !== payload.roomType || project.baseline?.spec.roomType !== payload.roomType) fail('This saved design does not belong to the same native room or is missing its original room baseline.');
    const geometry = 'scanGeometry' in project.spec ? project.spec.scanGeometry : undefined;
    const original = project.baseline?.spec && 'scanGeometry' in project.baseline.spec ? project.baseline.spec.scanGeometry : undefined;
    if (!sameCapturedGeometry(geometry, original)) fail('The saved design changed its captured room geometry. Restore the original scan before opening this snapshot.');
    assertSavedGeometrySource(payload, project, geometry);
    project.name = payload.name;
    if (payload.detailPhotoCount !== undefined && project.overrides.nativeScan && typeof project.overrides.nativeScan === 'object') project.overrides.nativeScan = { ...project.overrides.nativeScan, detailPhotoCount: payload.detailPhotoCount };
    return { project, restored: true, frame: null, notices: ['Saved studio edits restored. Original room baseline and measurement confirmations retained.'] };
  }
  const frame = nativeRoomFrame(payload);
  const prepared = prepareScanFloors(normalizedGeometry(payload, frame));
  const quantities = scannedRoomQuantities(prepared.geometry);
  const openings = scanOpenings(payload, frame);
  const spec: SingleRoomSpec = payload.roomType === 'kitchen' ? defaultKitchen() : defaultBathroom();
  const verified = payload.measurements.verified && !payload.isSample;
  const dimensions = frame;
  const corrected = (verified || payload.isSample) && (!near(payload.measurements.widthMeters, frame.widthMeters) || !near(payload.measurements.depthMeters, frame.depthMeters) || !near(payload.measurements.heightMeters, frame.heightMeters));
  // Existing fixture controls use bounded framing dimensions. A partial scan
  // can be thinner or shorter; padding the camera never stretches its geometry.
  spec.dims = { widthFt: Math.min(80, Math.max(4, dimensions.widthMeters * FT)), depthFt: Math.min(80, Math.max(4, dimensions.depthMeters * FT)), ceilingFt: Math.min(20, Math.max(7, dimensions.heightMeters * FT)) };
  spec.scanGeometry = prepared.geometry;
  spec.openings = openings;
  spec.decor = emptyDecor(); spec.decor.counterStyling = 'minimal';
  spec.lighting = { recessedCount: 0, pendants: null, underCabinet: false, chandelier: false, sconces: 0, colorTempK: 4000, naturalLight: openings.some(o => o.kind === 'window') ? 'medium' : 'low' };
  if (spec.roomType === 'kitchen') {
    spec.layout = 'single-wall'; spec.runs = []; spec.appliances = []; spec.island = { ...spec.island, present: false, hasSink: false, hasCooktop: false, seating: 0 };
    spec.backsplash.present = false; spec.cabinets.crown = false;
  } else {
    spec.vanity.present = false; spec.shower.present = false; spec.tub.present = false; spec.toilet.present = false;
    spec.accessories = []; spec.wallTile.height = 'none'; spec.wallTile.heightIn = null; spec.wallTile.accent = null;
  }
  const notices = [payload.isSample ? 'Sample scan — dimensions are illustrative, not verified site measurements.' : verified ? 'Reviewed dimensions are saved with this scan. The 3D surfaces retain their captured positions and sizes.' : 'Scan dimensions are unverified. Confirm them against the room before using quantities.',
    `${payload.room.surfaces.filter(e => e.kind === 'wall').length} captured wall surfaces imported, including split walls and irregular corners. The room is centered and rotated together; no walls are stretched into a rectangle.`,
    'The 3D model adds representative fixture details inside captured object bounds. Source scan shows the original measurements; cabinet construction, finishes and irregular counter edges need photo or site review.', ...prepared.notices];
  if (corrected) notices.push(payload.isSample ? 'Edited sample measurements are retained for demonstration. They do not stretch the source 3D scan.' : 'Reviewed overall dimensions differ from the captured bounds. They are retained separately; changing three overall numbers cannot accurately relocate each scanned wall.');
  const measuredTops = prepared.geometry.objects.reduce((count, object) => count + (object.countertopSurfaces?.length ?? 0), 0);
  if (measuredTops) notices.push(`${measuredTops} LiDAR countertop surface${measuredTops === 1 ? '' : 's'} imported with exact observed contour points, gaps, and elevations. Coverage may be partial; the full perimeter, cutouts, slab thickness and cabinet construction remain unverified.`);
  const low = [...payload.room.surfaces, ...payload.room.objects].filter(e => e.confidence === 'low' || e.confidence === 'unknown').length;
  const wallSurfaces = prepared.geometry.surfaces.filter(e => e.kind === 'wall');
  const bases = wallSurfaces.map(e => scanPoint(e, 0, -e.dimensions.y / 2).y), tops = wallSurfaces.map(e => scanPoint(e, 0, e.dimensions.y / 2).y);
  if (Math.max(...bases) - Math.min(...bases) > 0.02 || Math.max(...tops) - Math.min(...tops) > 0.02) notices.push('Wall base or top elevations vary across this scan. Their measured heights remain unchanged; no common ceiling has been invented.');
  if (low) notices.push(`${low} captured surfaces or object bounds have low confidence. They remain visible for review; inspect them and rescan uncertain areas before ordering.`);
  if (quantities.floorAreaSquareMeters === null && prepared.geometry.surfaces.some(e => e.kind === 'floor')) notices.push('Floor surfaces have ambiguous or overlapping coverage. Floor and ceiling quantities are excluded pending review.');
  const openingsCount = payload.room.surfaces.filter(e => ['door', 'window', 'opening'].includes(e.kind)).length;
  spec.detected = { ...spec.detected, confidence: 0, summary: `${payload.isSample ? 'Sample' : 'Native scanned'} ${payload.roomType} with exact captured surfaces and ${openingsCount} openings.`, notes: notices, assumptions: ['Existing finishes and object construction are unknown. Display materials are placeholders.', 'Captured surfaces are retained; overall dimensions describe bounds, not a rectangular floor.', 'Scanned surface quantities are preliminary. Missing floor coverage is excluded, not estimated as width times depth.', 'Ceiling quantities are a projected floor-footprint allowance; ceiling geometry is not captured.'], finishes: [], elements: [], frame: null, inventory: null, measurements: verified && !corrected ? { ...spec.dims, confirmedAt: payload.room.capturedAt } : null, camera: { ...spec.detected.camera, solved: null } };
  const valid = RoomSpecZ.safeParse(spec);
  if (!valid.success) fail(`This room is outside the editable studio's supported size range: ${valid.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  // Materialize schema defaults only for a newly generated shell, never a saved snapshot.
  const shell = valid.data as SingleRoomSpec;
  const selections = { ...shell.materials };
  const project: Project = { id: projectId, name: payload.name, roomType: payload.roomType, createdAt: payload.room.capturedAt, updatedAt: payload.room.capturedAt, photos: [], description: notices.join('\n'), spec: shell, selections,
    baseline: { spec: structuredClone(shell), selections: { ...selections }, capturedAt: payload.room.capturedAt, source: 'manual' },
    estimateSettings: { region: 'seattle', tier: 'standard', contingencyPct: 0.1, markupPct: 0.2, scope: 'pull-and-replace', includePermits: true, mode: 'changes', includeKnockOns: true },
    overrides: { nativeScan: { version: 1, scanId: payload.id, isSample: payload.isSample, verified, capturedAt: payload.room.capturedAt, frame, reviewedMeasurements: { ...payload.measurements }, dimensionCorrection: corrected ? { ...payload.measurements } : null, excludedObjectCount: 0, geometryVersion: 1, detailPhotoCount: payload.detailPhotoCount ?? 0 } }, intake: null, renders: [], scans: [] };
  return { project, restored: false, frame, notices };
}
