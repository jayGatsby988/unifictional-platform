import * as THREE from 'three';
import { CENTER, MeshBVH } from 'three-mesh-bvh';
import { projectCapturedPoint, recoverCapturedCameras, type CapturedCameraProjection } from './camera-projection';
import type { ReconstructedObjectTextureSource } from './reconstructed-object-texture';

type Vec = [number, number, number];
export interface GlareObservation {
  frameIndex: number; cameraPosition: Vec;
  /** Matching source points, in sRGB bytes. No averaged room/material color. */
  colors: Vec[];
}
interface Feature { l: number; a: number; b: number; chroma: number }
function feature(rgb: Vec): Feature {
  const c = rgb.map(byte => { const x = byte / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
  const l = Math.cbrt(.4122214708 * c[0] + .5363325363 * c[1] + .0514459929 * c[2]);
  const m = Math.cbrt(.2119034982 * c[0] + .6806995451 * c[1] + .1073969566 * c[2]);
  const s = Math.cbrt(.0883024619 * c[0] + .2817188376 * c[1] + .6299787005 * c[2]);
  const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, b = .0259040371 * l + .7827717662 * m - .808675766 * s;
  return { l: .2104542553 * l + .793617785 * m - .0040720468 * s, a, b, chroma: Math.hypot(a, b) };
}
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const validObservation = (view: GlareObservation) => Number.isInteger(view.frameIndex) && view.frameIndex >= 0 && view.frameIndex < 48
  && view.cameraPosition.length === 3 && view.cameraPosition.every(Number.isFinite)
  && view.colors.length === 4 && view.colors.every(rgb => rgb.length === 3 && rgb.every(n => Number.isFinite(n) && n >= 0 && n <= 255));
function possibleImprovement(original: Feature[], candidate: Feature[]): boolean {
  let votes = 0;
  for (let i = 0; i < original.length; i++) {
    const a = original[i], b = candidate[i];
    // Neutral material is never made chromatic. Genuine colored patterns must
    // match point-for-point; a different hue is not an exposure correction.
    if (a.chroma < .022) { if (b.chroma > .035) return false; continue; }
    const alignment = (a.a * b.a + a.b * b.b) / Math.max(1e-8, a.chroma * b.chroma);
    if (alignment < .88 || b.l > a.l + .035 || b.l < a.l - .24) return false;
    if (b.chroma > Math.max(.03, a.chroma * 1.12) && b.l <= a.l + .025) votes++;
  }
  return votes >= 3;
}
/** Select a real recorded view only when two independent cameras agree that
 * the original's pale appearance is view-dependent. White/neutral and
 * ambiguous surfaces keep their original view. This does not calibrate albedo. */
export function selectLowerGlareObservation(original: GlareObservation, alternatives: GlareObservation[]): GlareObservation {
  if (!validObservation(original) || alternatives.length > 48) return original;
  const baseline = original.colors.map(feature), seen = new Set<number>([original.frameIndex]);
  const candidates = alternatives.filter(view => {
    if (!validObservation(view) || seen.has(view.frameIndex)) return false; seen.add(view.frameIndex);
    return possibleImprovement(baseline, view.colors.map(feature));
  }).map(view => ({ view, features: view.colors.map(feature) }));
  let chosen: GlareObservation | null = null, best = -Infinity;
  for (const candidate of candidates) {
    const peers = candidates.filter(other => other !== candidate && distance(other.view.cameraPosition, candidate.view.cameraPosition) >= .04
      && candidate.features.every((a, i) => { const b = other.features[i]; return Math.abs(a.l - b.l) < .13 && Math.hypot((a.l - b.l) * .5, (a.a - b.a) * 2, (a.b - b.b) * 2) < .085; }));
    if (!peers.length) continue;
    const score = candidate.features.reduce((sum, f) => sum + f.chroma / Math.max(.2, f.l), 0) / 4 + Math.min(3, peers.length) * .005;
    if (score > best) { best = score; chosen = candidate.view; }
  }
  return chosen ?? original;
}

export interface ObjectRefinementOptions {
  signal?: AbortSignal; onProgress?: (processed: number, total: number) => void;
  maximumRayChecks?: number;
}
export interface ObjectRefinementResult {
  source: ReconstructedObjectTextureSource; changedTriangles: number; rayChecks: number; processedTriangles: number; limited: boolean;
}
function center(camera: CapturedCameraProjection): Vec | null {
  const r = camera.rows, matrix = new THREE.Matrix3().set(r[0][0], r[0][1], r[0][2], r[1][0], r[1][1], r[1][2], r[2][0], r[2][1], r[2][2]);
  if (Math.abs(matrix.determinant()) < 1e-8) return null;
  const p = new THREE.Vector3(-r[0][3], -r[1][3], -r[2][3]).applyMatrix3(matrix.invert()).toArray() as Vec;
  return p.every(n => Number.isFinite(n) && Math.abs(n) <= 1000) ? p : null;
}
function sample(image: ReconstructedObjectTextureSource['texture']['images'][number], u: number, v: number): Vec | null {
  const px = u * image.width - .5, py = v * image.height - .5;
  if (px < 1 || py < 1 || px >= image.width - 2 || py >= image.height - 2) return null;
  const x = Math.floor(px), y = Math.floor(py), dx = px - x, dy = py - y;
  const addresses = [y * image.width + x, y * image.width + x + 1, (y + 1) * image.width + x, (y + 1) * image.width + x + 1];
  if (addresses.some(index => image.rgba[index * 4 + 3] !== 255)) return null;
  const weights = [(1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy];
  return [0, 1, 2].map(c => addresses.reduce((sum, index, i) => sum + image.rgba[index * 4 + c] * weights[i], 0)) as Vec;
}

/** Optional asynchronous refinement of clean cabinet appearance only. The
 * original mesh, texture packet, camera images, and Source view stay intact.
 * A bounded indirect BVH validates four same-face rays per alternate view;
 * per-texel work still uses the chosen frame's exact projective coordinates. */
export async function refineReconstructedObjectTextureSource(source: ReconstructedObjectTextureSource, options: ObjectRefinementOptions = {}): Promise<ObjectRefinementResult> {
  const abort = () => { if (options.signal?.aborted) throw new DOMException('Appearance refinement cancelled.', 'AbortError'); };
  abort();
  const maximum = options.maximumRayChecks ?? 180_000;
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 250_000) throw new Error('Invalid appearance refinement budget.');
  const result: ObjectRefinementResult = { source, changedTriangles: 0, rayChecks: 0, processedTriangles: 0, limited: false };
  if (!maximum) { result.limited = true; return result; }
  const candidates: number[] = [];
  for (const slots of source.groups.values()) for (const [slot, triangles] of slots) if (/cabinet/.test(slot)) for (const t of triangles) if (source.texture.frameIndices[t] >= 0) candidates.push(t);
  if (!candidates.length || candidates.length > 320_000) return result;
  // Let the existing model paint before optional indexing/refinement begins.
  await new Promise(resolve => setTimeout(resolve, 0)); abort();
  const started = performance.now(), maximumTriangles = 80_000, maximumMilliseconds = 8_000;
  const cameras = recoverCapturedCameras(source.mesh, source.texture), centers = cameras.map(camera => camera ? center(camera) : null);
  if (cameras.filter(Boolean).length < 3) return result;
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(source.mesh.positions, 3));
  // 0.8.3 supports indirect at runtime; its bundled declaration omits the
  // field. Keeping options in a variable preserves the supported structural API.
  const bvhOptions = { strategy: CENTER, maxLeafTris: 12, indirect: true, setBoundingBox: false };
  let frameIndices: Int16Array | undefined, coordinates: Float32Array | undefined;
  try {
    const bvh = new MeshBVH(geometry, bvhOptions), ray = new THREE.Ray(), hitPoint = new THREE.Vector3();
    const xyz = source.mesh.positions, texture = source.texture, normal = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
    for (let index = 0; index < Math.min(candidates.length, maximumTriangles); index++) {
      if (index % 128 === 0) { abort(); options.onProgress?.(index, candidates.length); await new Promise(resolve => setTimeout(resolve, 0)); abort(); }
      if (result.rayChecks >= maximum || performance.now() - started > maximumMilliseconds) { result.limited = true; break; }
      const triangle = candidates[index], offset = triangle * 9, originalFrame = texture.frameIndices[triangle], originalCamera = cameras[originalFrame], originalCenter = centers[originalFrame];
      result.processedTriangles++;
      if (!originalCamera || !originalCenter) continue;
      const vertices = [0, 3, 6].map(i => [xyz[offset + i], xyz[offset + i + 1], xyz[offset + i + 2]] as Vec);
      const centroid = [0, 1, 2].map(axis => (vertices[0][axis] + vertices[1][axis] + vertices[2][axis]) / 3) as Vec;
      ab.fromArray(vertices[1]).sub(new THREE.Vector3(...vertices[0])); ac.fromArray(vertices[2]).sub(new THREE.Vector3(...vertices[0])); normal.crossVectors(ab, ac);
      if (normal.lengthSq() < 1e-12) continue; normal.normalize();
      if (Math.abs(normal.y) > .35) continue;
      const originalSide = normal.dot(new THREE.Vector3(...originalCenter).sub(new THREE.Vector3(...centroid)));
      const points: Vec[] = [centroid, ...vertices.map(v => v.map((n, axis) => n * .8 + centroid[axis] * .2) as Vec)];
      const observe = (frame: number): GlareObservation | null => {
        const camera = cameras[frame], position = centers[frame]; if (!camera || !position) return null;
        const delta = new THREE.Vector3(...position).sub(new THREE.Vector3(...centroid)), sign = normal.dot(delta);
        if (sign * originalSide <= 0 || Math.abs(sign) / delta.length() < .4) return null;
        const colors: Vec[] = [];
        for (const point of points) { const p = projectCapturedPoint(camera, point); if (!p || p.q < .2 || p.q > 6) return null; const color = sample(texture.images[frame], p.u, p.v); if (!color) return null; colors.push(color); }
        return { frameIndex: frame, cameraPosition: position, colors };
      };
      const original = observe(originalFrame); if (!original) continue;
      const baseline = original.colors.map(feature), alternatives: GlareObservation[] = [];
      const promising: GlareObservation[] = [];
      for (let frame = 0; frame < cameras.length; frame++) {
        if (frame === originalFrame) continue;
        const view = observe(frame); if (view && possibleImprovement(baseline, view.colors.map(feature))) promising.push(view);
      }
      // Consensus at source points is cheap; only plausible alternatives incur
      // bounded occlusion rays. Nearer views are preferred when work is capped.
      promising.sort((a, b) => distance(a.cameraPosition, centroid) - distance(b.cameraPosition, centroid));
      for (const view of promising.slice(0, 8)) {
        let visible = true;
        for (const point of points) {
          if (result.rayChecks >= maximum) { result.limited = true; visible = false; break; }
          result.rayChecks++; ray.origin.fromArray(view.cameraPosition); hitPoint.fromArray(point); ray.direction.copy(hitPoint).sub(ray.origin).normalize();
          const length = hitPoint.distanceTo(ray.origin), hit = bvh.raycastFirst(ray, THREE.DoubleSide, .02, length + .025);
          if (!hit || Math.abs(hit.distance - length) > .02 || hit.point.distanceTo(hitPoint) > .02
            || !hit.face || Math.abs(hit.face.normal.dot(normal)) < .9) { visible = false; break; }
          const owner = hit.faceIndex == null ? undefined : source.triangleObjects.get(hit.faceIndex);
          if (owner && owner !== source.triangleObjects.get(triangle)) { visible = false; break; }
        }
        if (visible) alternatives.push(view);
      }
      const selected = selectLowerGlareObservation(original, alternatives);
      if (selected === original) continue;
      const chosen = cameras[selected.frameIndex]!;
      const uvq = vertices.flatMap(point => { const p = projectCapturedPoint(chosen, point); return p ? [p.u, p.v, p.q] : []; });
      if (uvq.length !== 9 || uvq.some((n, i) => !Number.isFinite(n) || (i % 3 === 2 ? n < .2 || n > 6 : n < 0 || n > 1))) continue;
      const projectedArea = (values: ArrayLike<number>, at: number, image: typeof texture.images[number]) => Math.abs((values[at + 3] - values[at]) * (values[at + 7] - values[at + 1]) - (values[at + 6] - values[at]) * (values[at + 4] - values[at + 1])) * image.width * image.height;
      if (projectedArea(uvq, 0, texture.images[selected.frameIndex]) < projectedArea(texture.coordinates, offset, texture.images[originalFrame]) * .55) continue;
      if (!frameIndices) { frameIndices = texture.frameIndices.slice(); coordinates = texture.coordinates.slice(); }
      frameIndices[triangle] = selected.frameIndex; coordinates!.set(uvq, offset); result.changedTriangles++;
    }
    if (result.processedTriangles < candidates.length) result.limited = true;
    abort(); options.onProgress?.(result.processedTriangles, candidates.length);
    if (frameIndices) result.source = { ...source, texture: { ...source.texture, frameIndices, coordinates: coordinates! } };
    return result;
  } finally { geometry.dispose(); }
}
