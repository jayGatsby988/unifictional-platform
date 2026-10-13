import type { ObservedMesh } from './mesh-archive';
import type { ScanTexture } from './texture-archive';
import type { ScannedElement, ScannedRoomGeometry } from '../spec/types';
import { observedMeshLayout, type ObservedSceneLayout } from '@/components/scene/observed-mesh-layout';

type Vec = [number, number, number];
export interface ReconstructedObjectPlane {
  objectId: string; slot: string;
  /** Studio-world lower-left corner, orthonormal axes, and physical extent. */
  origin: Vec; u: Vec; v: Vec; spanMeters: [number, number];
  maxPlaneDistance?: number;
  /** Optional fitted-panel source triangle IDs, never vertex IDs. */
  sourceTriangleIndices?: Uint32Array;
}
export interface ReconstructedObjectTextureSource {
  readonly mesh: ObservedMesh; readonly texture: ScanTexture;
  readonly groups: ReadonlyMap<string, ReadonlyMap<string, Uint32Array>>;
  readonly objects: ReadonlyMap<string, ScannedElement>;
  readonly triangleObjects: ReadonlyMap<number, string>;
  readonly candidateTriangleCount: number;
}
export type ReconstructedObjectTexture = {
  status: 'unknown'; reason: 'invalid-input' | 'no-face-evidence' | 'resource-limit';
} | {
  status: 'supported'; recipe: 'camera-projected-face'; confidence: 'low';
  width: number; height: number; rgba: Uint8Array;
  origin: Vec; u: Vec; v: Vec; spanMeters: [number, number];
  wrapping: 'clamp-to-edge'; observedTexels: number; coverageFraction: number;
  observedAreaSquareMeters: number; sourceTriangleCount: number;
  /** Same-face median only. Alpha0 pixels remain unsupported even when a
   * renderer uses this explicitly estimated fill. Never borrow another face. */
  fillColorLinear: Vec | null; estimatedFillRequired: true;
};
const MAX_EDGE = 256, MAX_CHECKS = 2_000_000;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const finiteVector = (v: Vec) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 1000);
const linear = (byte: number) => { const n = byte / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };

/** Index the already validated mesh/texture pair once per provider. Every
 * subsequent face visits only its object's source triangles. No browser API,
 * source mutation, material choice, or persistence occurs in this helper. */
export function createReconstructedObjectTextureSource(mesh: ObservedMesh, texture: ScanTexture | null, scan: ScannedRoomGeometry, roomType: 'kitchen' | 'bathroom', layout?: ObservedSceneLayout): ReconstructedObjectTextureSource | null {
  const count = mesh.triangleCount;
  if (!texture || !Number.isInteger(count) || count < 1 || count > 320_000 || mesh.positions.length !== count * 9
    || texture.triangleCount !== count || texture.coordinates.length !== count * 9 || texture.frameIndices.length !== count
    || texture.images.length < 1 || texture.images.length > 48 || scan.objects.length > 512 || scan.surfaces.length > 256) return null;
  for (const image of texture.images) if (![image.width, image.height].every(n => Number.isInteger(n) && n >= 2 && n <= 384)
    || !(image.rgba instanceof Uint8Array) || image.rgba.length !== image.width * image.height * 4) return null;
  const source = layout ?? observedMeshLayout(mesh, scan, roomType);
  const objects = new Set(scan.objects.map(o => o.id)), pending = new Map<string, Map<string, number[]>>();
  const seen = new Set<number>(), triangleObjects = new Map<number, string>(); let candidateTriangleCount = 0;
  for (const group of source.groups) {
    if (!group.key.startsWith('object:') || !group.slot) continue;
    const objectId = group.key.slice(7, group.key.lastIndexOf(':'));
    if (!objects.has(objectId) || group.indices.length % 3) return null;
    let slots = pending.get(objectId); if (!slots) { slots = new Map(); pending.set(objectId, slots); }
    let triangles = slots.get(group.slot); if (!triangles) { triangles = []; slots.set(group.slot, triangles); }
    for (let i = 0; i < group.indices.length; i += 3) {
      const vertex = group.indices[i], triangle = vertex / 3;
      if (!Number.isInteger(triangle) || triangle < 0 || triangle >= count || group.indices[i + 1] !== vertex + 1 || group.indices[i + 2] !== vertex + 2 || seen.has(triangle)) return null;
      seen.add(triangle);
      triangleObjects.set(triangle, objectId);
      const frame = texture.frameIndices[triangle];
      if (frame < -1 || frame >= texture.images.length) return null;
      triangles.push(triangle); candidateTriangleCount++;
    }
  }
  const groups = new Map<string, ReadonlyMap<string, Uint32Array>>();
  for (const [id, slots] of pending) groups.set(id, new Map([...slots].map(([slot, indices]) => [slot, Uint32Array.from(indices)])));
  return { mesh, texture, groups, objects: new Map(scan.objects.map(object => [object.id, object])), triangleObjects, candidateTriangleCount };
}

/** Camera appearance at the original position and scale of a clean face.
 * Only nearby parallel measured facets contribute. Grain is neither tiled nor
 * stretched from another face, and unobserved pixels keep alpha0/RGB0. */
export function deriveReconstructedObjectTexture(source: ReconstructedObjectTextureSource, plane: ReconstructedObjectPlane): ReconstructedObjectTexture {
  const unknown = (reason: Extract<ReconstructedObjectTexture, { status: 'unknown' }>['reason']): ReconstructedObjectTexture => ({ status: 'unknown', reason });
  const tolerance = plane.maxPlaneDistance ?? .06;
  if (!finiteVector(plane.origin) || !finiteVector(plane.u) || !finiteVector(plane.v)
    || Math.abs(dot(plane.u, plane.u) - 1) > 1e-5 || Math.abs(dot(plane.v, plane.v) - 1) > 1e-5 || Math.abs(dot(plane.u, plane.v)) > 1e-5
    || plane.spanMeters.length !== 2 || !plane.spanMeters.every(n => Number.isFinite(n) && n > .01 && n <= 12)
    || !Number.isFinite(tolerance) || tolerance < .005 || tolerance > .10) return unknown('invalid-input');
  const slots = source.groups.get(plane.objectId); if (!slots) return unknown('no-face-evidence');
  let triangles = slots.get(plane.slot);
  if (plane.sourceTriangleIndices) {
    if (!(plane.sourceTriangleIndices instanceof Uint32Array) || plane.sourceTriangleIndices.length > source.mesh.triangleCount) return unknown('invalid-input');
    const unique = new Set(plane.sourceTriangleIndices);
    if (unique.size !== plane.sourceTriangleIndices.length || [...unique].some(i => i >= source.mesh.triangleCount)) return unknown('invalid-input');
    const object = source.objects.get(plane.objectId); if (!object) return unknown('invalid-input');
    const t = object.transform, d = object.dimensions;
    if (t.length !== 16 || !t.every(Number.isFinite) || ![d.x, d.y, d.z].every(n => Number.isFinite(n) && n > 0 && n < 12)) return unknown('invalid-input');
    // Fitted panels can recover a real face outside an approximate RoomPlan
    // box. Match the shell's bounded local search, but never borrow triangles
    // already attributed to a different captured object. The requested plane
    // and its original source facets still pass all near-plane checks below.
    triangles = Uint32Array.from([...unique].filter(triangle => {
      const owner = source.triangleObjects.get(triangle); if (owner && owner !== plane.objectId) return false;
      for (let vertex = 0; vertex < 3; vertex++) {
        const i = triangle * 9 + vertex * 3;
        const dx = source.mesh.positions[i] - t[12], dy = source.mesh.positions[i + 1] - t[13], dz = source.mesh.positions[i + 2] - t[14];
        const x = dx * t[0] + dy * t[1] + dz * t[2], y = dx * t[4] + dy * t[5] + dz * t[6], z = dx * t[8] + dy * t[9] + dz * t[10];
        if (![x, y, z].every(Number.isFinite) || Math.abs(x) > d.x / 2 + .35 || Math.abs(z) > d.z / 2 + .35 || Math.abs(y) > d.y / 2 + .06) return false;
      }
      return true;
    }));
  }
  if (!triangles?.length) return unknown('no-face-evidence');
  const [spanX, spanY] = plane.spanMeters;
  const pitch = Math.max(.005, Math.max(spanX, spanY) / MAX_EDGE);
  const width = Math.min(MAX_EDGE, Math.ceil(spanX / pitch)), height = Math.min(MAX_EDGE, Math.ceil(spanY / pitch));
  const stepX = spanX / width, stepY = spanY / height, count = width * height;
  const rgba = new Uint8Array(count * 4), errors = new Float32Array(count).fill(Infinity), owners = new Int32Array(count).fill(-1);
  const normal = cross(plane.u, plane.v), mesh = source.mesh, texture = source.texture, xyz = mesh.positions, uvq = texture.coordinates;
  let checks = 0;
  for (const triangle of triangles) {
    const offset = triangle * 9, frame = texture.frameIndices[triangle], image = texture.images[frame];
    if (frame === -1) continue;
    const a: Vec = [xyz[offset], xyz[offset + 1], xyz[offset + 2]], b: Vec = [xyz[offset + 3], xyz[offset + 4], xyz[offset + 5]], c: Vec = [xyz[offset + 6], xyz[offset + 7], xyz[offset + 8]];
    if (![a, b, c].every(finiteVector) || !image) return unknown('invalid-input');
    const n = cross(sub(b, a), sub(c, a)), length = Math.hypot(...n);
    if (length < 1e-9 || Math.abs(dot(n, normal)) < length * .9) continue;
    const local = [a, b, c].map(p => sub(p, plane.origin));
    const distances = local.map(p => dot(p, normal));
    if (distances.some(d => Math.abs(d) > tolerance)) continue;
    const ax = dot(local[0], plane.u), ay = dot(local[0], plane.v), bx = dot(local[1], plane.u), by = dot(local[1], plane.v), cx = dot(local[2], plane.u), cy = dot(local[2], plane.v);
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-10) continue;
    const left = Math.max(0, Math.floor(Math.min(ax, bx, cx) / stepX)), right = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx) / stepX));
    const bottom = Math.max(0, Math.floor(Math.min(ay, by, cy) / stepY)), top = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy) / stepY));
    checks += Math.max(0, right - left + 1) * Math.max(0, top - bottom + 1);
    if (checks > MAX_CHECKS) return unknown('resource-limit');
    for (let k = 0; k < 9; k++) if (!Number.isFinite(uvq[offset + k]) || (k % 3 === 2 ? uvq[offset + k] < .199999 || uvq[offset + k] > 6.000001 : uvq[offset + k] < 0 || uvq[offset + k] > 1)) return unknown('invalid-input');
    for (let y = bottom; y <= top; y++) for (let x = left; x <= right; x++) {
      const px = (x + .5) * stepX, py = (y + .5) * stepY;
      const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
      const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator, wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) < -1e-7) continue;
      const pixel = y * width + x, error = Math.abs(wa * distances[0] + wb * distances[1] + wc * distances[2]);
      if (error >= errors[pixel]) continue;
      const q = wa * uvq[offset + 2] + wb * uvq[offset + 5] + wc * uvq[offset + 8];
      const u = (wa * uvq[offset] * uvq[offset + 2] + wb * uvq[offset + 3] * uvq[offset + 5] + wc * uvq[offset + 6] * uvq[offset + 8]) / q;
      const v = (wa * uvq[offset + 1] * uvq[offset + 2] + wb * uvq[offset + 4] * uvq[offset + 5] + wc * uvq[offset + 7] * uvq[offset + 8]) / q;
      const imageX = u * image.width - .5, imageY = v * image.height - .5;
      if (!Number.isFinite(imageX) || !Number.isFinite(imageY) || imageX < 0 || imageY < 0 || imageX > image.width - 1 || imageY > image.height - 1) continue;
      const x0 = Math.floor(imageX), y0 = Math.floor(imageY), x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1), dx = imageX - x0, dy = imageY - y0;
      const addresses = [y0 * image.width + x0, y0 * image.width + x1, y1 * image.width + x0, y1 * image.width + x1];
      if (addresses.some(i => image.rgba[i * 4 + 3] !== 255)) continue;
      const weights = [(1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy];
      for (let channel = 0; channel < 3; channel++) rgba[pixel * 4 + channel] = Math.round(addresses.reduce((sum, index, i) => sum + image.rgba[index * 4 + channel] * weights[i], 0));
      rgba[pixel * 4 + 3] = 255; errors[pixel] = error; owners[pixel] = triangle;
    }
  }
  let observedTexels = 0; const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], contributing = new Set<number>();
  for (let pixel = 0; pixel < count; pixel++) if (rgba[pixel * 4 + 3]) {
    observedTexels++; contributing.add(owners[pixel]);
    for (let channel = 0; channel < 3; channel++) histograms[channel][rgba[pixel * 4 + channel]]++;
  }
  if (observedTexels < 4) return unknown('no-face-evidence');
  const area = observedTexels * stepX * stepY;
  const fillColorLinear = observedTexels >= 32 && area >= .005 ? histograms.map(histogram => {
    let cumulative = 0;
    for (let i = 0; i < 256; i++) { cumulative += histogram[i]; if (cumulative >= observedTexels / 2) return linear(i); }
    return 0;
  }) as Vec : null;
  return { status: 'supported', recipe: 'camera-projected-face', confidence: 'low', width, height, rgba,
    origin: [...plane.origin], u: [...plane.u], v: [...plane.v], spanMeters: [...plane.spanMeters], wrapping: 'clamp-to-edge',
    observedTexels, coverageFraction: observedTexels / count, observedAreaSquareMeters: area,
    sourceTriangleCount: contributing.size, fillColorLinear, estimatedFillRequired: true };
}
