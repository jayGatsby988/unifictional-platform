import type { ObservedMesh } from './mesh-archive';
import type { ScanTexture } from './texture-archive';
import type { ScannedElement } from '../spec/types';
import type { ReconstructedColor } from './reconstructed-appearance';
import type { ScanPlaneTexturePlane } from './plane-texture-archive';

type Vec = [number, number, number];
export type ReconstructedFloor = {
  status: 'unknown'; reason: 'no-floor-evidence' | 'invalid-input' | 'insufficient-clean-coverage' | 'resource-limit';
} | {
  status: 'supported'; source: 'observed-floor-atlas'; confidence: 'low'; layout: 'world-registered';
  /** Alpha255 is a camera observation at this world position. Alpha0 is
   * unsupported: render an explicitly estimated fill, never repeat a sample. */
  wrapping: 'clamp-to-edge'; width: number; height: number; rgba: Uint8Array;
  metersPerTexel: number; spanMeters: [number, number]; origin: Vec; u: Vec; v: Vec;
  observedTexels: number; interiorTexels: number; coverageFraction: number;
  /** Full polygon coverage includes floor hidden under furniture. Separately
   * report how much validated camera evidence survived rug/clutter exclusion. */
  cameraSupportedTexels: number; unobservedInteriorTexels: number; excludedCameraTexels: number; cleanCoverageOfCameraEvidence: number;
  /** Explicitly estimated fill: accepted-camera median when the material
   * family is established, neutral geometry color when it remains unknown. */
  fillColorSRGB: Vec;
  /** Ambiguous floor/rug mixtures retain only validated measured-plane pixels
   * in their original positions. They must never seed a repeated material. */
  materialEvidence?: 'mesh-color-family' | 'ambiguous-preserve-plane';
  fillSource?: 'camera-median' | 'neutral-unknown-material';
  observedAreaSquareMeters: number; estimatedFillRequired: true;
};
const MAX_GRID = 512, MAX_RASTER_CHECKS = 4_000_000;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const linear = (n: number) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
function feature(c: Vec): Vec {
  const l = Math.cbrt(.4122214708 * c[0] + .5363325363 * c[1] + .0514459929 * c[2]);
  const m = Math.cbrt(.2119034982 * c[0] + .6806995451 * c[1] + .1073969566 * c[2]);
  const s = Math.cbrt(.0883024619 * c[0] + .2817188376 * c[1] + .6299787005 * c[2]);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}
function sameFloorFamily(sample: Vec, target: Vec): boolean {
  const a = Math.hypot(sample[1], sample[2]), b = Math.hypot(target[1], target[2]);
  if (b < .022) return a < .045 && Math.abs(sample[0] - target[0]) < .15;
  // Illumination changes lightness and chroma strength dramatically on wood.
  // Preserve those actual pixels; compare chromatic direction rather than
  // forcing every observation toward one shaded median color.
  return a >= Math.min(.018, b * .38) && a <= b * 3 + .04 && (sample[1] * target[1] + sample[2] * target[2]) / (a * b) >= .65;
}
function excludeOtherFloorFamilies(rgba: Uint8Array, width: number, height: number, compatible: Uint8Array, pitch: number): void {
  const step = Math.max(1, Math.round(.025 / pitch));
  const observed = Uint8Array.from(compatible, (_, i) => rgba[i * 4 + 3] ? 1 : 0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x; if (!rgba[pixel * 4 + 3] || compatible[pixel]) continue;
    let available = 0, matching = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const px = x + dx * step, py = y + dy * step;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const next = py * width + px;
      if (observed[next]) { available++; if (compatible[next]) matching++; }
    }
    // Thin neutral grout/seams can belong to chromatic flooring. Preserve
    // their own RGB only when surrounded by independently matching floor.
    if (available < 12 || matching / available < .72) rgba.fill(0, pixel * 4, pixel * 4 + 4);
  }
}
function inside(x: number, y: number, ring: [number, number][]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

/** Exclude small isolated light/dark blemishes from the floor image. The
 * threshold is relative to neighboring observations, never a preferred floor
 * brightness. Long thin runs are retained, including genuine grout lines. */
function excludeCompactBlemishes(rgba: Uint8Array, width: number, height: number, lightness: Float32Array, pitch: number): void {
  const radius = Math.max(2, Math.round(.075 / pitch)), step = Math.max(1, Math.round(radius / 2));
  const outliers = new Uint8Array(width * height), visited = new Uint8Array(width * height), queue = new Int32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x; if (!rgba[pixel * 4 + 3]) continue;
    const neighbors: number[] = [];
    for (let dy = -radius; dy <= radius; dy += step) for (let dx = -radius; dx <= radius; dx += step) {
      const px = x + dx, py = y + dy;
      if (px >= 0 && px < width && py >= 0 && py < height && rgba[(py * width + px) * 4 + 3]) neighbors.push(lightness[py * width + px]);
    }
    if (neighbors.length < 9) continue;
    neighbors.sort((a, b) => a - b); const median = neighbors[Math.floor(neighbors.length / 2)];
    const deviations = neighbors.map(n => Math.abs(n - median)).sort((a, b) => a - b);
    const threshold = Math.max(.055, deviations[Math.floor(deviations.length / 2)] * 4);
    if (Math.abs(lightness[pixel] - median) > threshold) outliers[pixel] = 1;
  }
  for (let start = 0; start < outliers.length; start++) {
    if (!outliers[start] || visited[start]) continue;
    let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const pixel = queue[head++], x = pixel % width, y = Math.floor(pixel / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx, py = y + dy, next = py * width + px;
        if (px >= 0 && px < width && py >= 0 && py < height && outliers[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      }
    }
    const spanX = maxX - minX + 1, spanY = maxY - minY + 1;
    if (Math.max(spanX, spanY) * pitch > .25 || Math.max(spanX, spanY) / Math.min(spanX, spanY) > 4) continue;
    // A little margin removes the blurred outline too; no pixels are invented.
    const margin = Math.max(1, Math.ceil(.02 / pitch));
    for (let y = Math.max(0, minY - margin); y <= Math.min(height - 1, maxY + margin); y++) for (let x = Math.max(0, minX - margin); x <= Math.min(width - 1, maxX + margin); x++) rgba.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
  }
}

/** Derive a clean, world-registered floor atlas from the already verified
 * mesh/texture pair in native asset state. Geometry binding belongs to the
 * archive loader; this function never receives arbitrary camera poses, fills
 * missing observations, changes geometry, or writes project material choices.
 * Every accepted camera texel keeps its measured position, scale and orientation.
 * Board or tile seams are never repeated, synthesized, or claimed as measured. */
export function deriveReconstructedFloor(mesh: ObservedMesh, texture: ScanTexture | null, floor: ScannedElement, color: ReconstructedColor | undefined, plane?: ScanPlaneTexturePlane): ReconstructedFloor {
  const unknown = (reason: Extract<ReconstructedFloor, { status: 'unknown' }>['reason']): ReconstructedFloor => ({ status: 'unknown', reason });
  const hasMaterialEvidence = color?.status === 'supported' && !!color.colorLinear;
  // A mixture of rugs and exposed flooring can make the whole-room vertex
  // color ambiguous while the measured-plane camera archive still contains
  // valid floor pixels. Keep those local observations without asserting that
  // a rug's color or pattern describes the material beneath it.
  const localizedPlaneOnly = !hasMaterialEvidence;
  if (!texture || (localizedPlaneOnly && !plane) || floor.kind !== 'floor' || !floor.polygonCorners?.length) return unknown('no-floor-evidence');
  const count = mesh.triangleCount, p = mesh.positions, uvq = texture.coordinates;
  if (!Number.isInteger(count) || count < 1 || count > 320_000 || texture.triangleCount !== count || p.length !== count * 9
    || uvq.length !== count * 9 || texture.frameIndices.length !== count || texture.images.length < 1 || texture.images.length > 48
    || floor.transform.length !== 16 || !floor.transform.every(Number.isFinite) || floor.polygonCorners.length < 3 || floor.polygonCorners.length > 256
    || (hasMaterialEvidence && (color!.colorLinear!.length !== 3 || !color!.colorLinear!.every(n => Number.isFinite(n) && n >= 0 && n <= 1)))) return unknown('invalid-input');
  for (const image of texture.images) if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 2 || image.height < 2 || image.width > 384 || image.height > 384 || image.rgba.length !== image.width * image.height * 4) return unknown('invalid-input');
  const axisLength = Math.hypot(floor.transform[0], floor.transform[2]);
  if (axisLength < .99 || axisLength > 1.01) return unknown('invalid-input');
  const u: Vec = [floor.transform[0] / axisLength, 0, floor.transform[2] / axisLength], v: Vec = [-u[2], 0, u[0]];
  const ring = floor.polygonCorners.map(c => [c.x * u[0] + c.z * u[2], c.x * v[0] + c.z * v[2]] as [number, number]);
  const level = floor.polygonCorners.reduce((n, c) => n + c.y, 0) / ring.length;
  if (!Number.isFinite(level) || Math.abs(level) > 1000 || ring.some(c => c.some(n => !Number.isFinite(n) || Math.abs(n) > 1500)) || floor.polygonCorners.some(c => Math.abs(c.y - level) > .01)) return unknown('invalid-input');
  if (plane && (plane.id !== floor.id || plane.kind !== 'floor' || !Number.isInteger(plane.width) || !Number.isInteger(plane.height) || plane.width < 1 || plane.height < 1 || plane.width > 1024 || plane.height > 1024
    || plane.rgba.length !== plane.width * plane.height * 4 || !Number.isFinite(plane.metersPerTexel) || plane.metersPerTexel < .005 || plane.metersPerTexel > .25
    || ![...plane.origin, ...plane.u, ...plane.v].every(n => Number.isFinite(n) && Math.abs(n) <= 1000) || Math.abs(plane.origin[1] - level) > .01
    || Math.abs(Math.hypot(...plane.u) - 1) > 1e-5 || Math.abs(Math.hypot(...plane.v) - 1) > 1e-5 || Math.abs(dot(plane.u, plane.v)) > 1e-5 || Math.abs(plane.u[1]) > 1e-5 || Math.abs(plane.v[1]) > 1e-5)) return unknown('invalid-input');
  const x0 = Math.min(...ring.map(c => c[0])), y0 = Math.min(...ring.map(c => c[1]));
  const spanX = Math.max(...ring.map(c => c[0])) - x0, spanY = Math.max(...ring.map(c => c[1])) - y0;
  if (spanX <= 0 || spanY <= 0 || spanX > 100 || spanY > 100) return unknown('invalid-input');
  const pitch = Math.max(.0075, spanX / MAX_GRID, spanY / MAX_GRID);
  if (pitch > .025) return unknown('resource-limit');
  const width = Math.ceil(spanX / pitch), height = Math.ceil(spanY / pitch), rgba = new Uint8Array(width * height * 4);
  const heights = new Float32Array(width * height).fill(Infinity), lightness = new Float32Array(width * height), compatible = new Uint8Array(width * height), target = hasMaterialEvidence ? feature(color!.colorLinear!) : null;
  let checks = 0;
  for (let triangle = 0; triangle < (localizedPlaneOnly ? 0 : count); triangle++) {
    const frame = texture.frameIndices[triangle]; if (frame === -1) continue;
    if (frame < 0 || frame >= texture.images.length) return unknown('invalid-input');
    const i = triangle * 9;
    const a: Vec = [p[i], p[i + 1], p[i + 2]], b: Vec = [p[i + 3], p[i + 4], p[i + 5]], c: Vec = [p[i + 6], p[i + 7], p[i + 8]];
    if ([...a, ...b, ...c].some(n => !Number.isFinite(n) || Math.abs(n) > 1000)) return unknown('invalid-input');
    if ([a, b, c].some(q => Math.abs(q[1] - level) > .04)) continue;
    const ab = b.map((n, axis) => n - a[axis]) as Vec, ac = c.map((n, axis) => n - a[axis]) as Vec;
    const normal: Vec = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.abs(normal[1]) < .95 * Math.hypot(...normal)) continue;
    const ax = dot(a, u), ay = dot(a, v), bx = dot(b, u), by = dot(b, v), cx = dot(c, u), cy = dot(c, v);
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-10) continue;
    const left = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / pitch)), right = Math.min(width - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / pitch));
    const bottom = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / pitch)), top = Math.min(height - 1, Math.ceil((Math.max(ay, by, cy) - y0) / pitch));
    checks += Math.max(0, right - left + 1) * Math.max(0, top - bottom + 1);
    if (checks > MAX_RASTER_CHECKS) return unknown('resource-limit');
    for (let k = 0; k < 9; k++) if (!Number.isFinite(uvq[i + k]) || (k % 3 === 2 ? uvq[i + k] < .199999 || uvq[i + k] > 6.000001 : uvq[i + k] < 0 || uvq[i + k] > 1)) return unknown('invalid-input');
    const image = texture.images[frame];
    for (let y = bottom; y <= top; y++) for (let x = left; x <= right; x++) {
      const px = x0 + (x + .5) * pitch, py = y0 + (y + .5) * pitch;
      const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
      const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator, wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) < -1e-6 || !inside(px, py, ring)) continue;
      const pixel = y * width + x, heightError = Math.abs(wa * a[1] + wb * b[1] + wc * c[1] - level);
      if (heightError >= heights[pixel]) continue;
      const qa = wa * uvq[i + 2], qb = wb * uvq[i + 5], qc = wc * uvq[i + 8], q = qa + qb + qc;
      const sx = (qa * uvq[i] + qb * uvq[i + 3] + qc * uvq[i + 6]) / q * image.width - .5;
      const sy = (qa * uvq[i + 1] + qb * uvq[i + 4] + qc * uvq[i + 7]) / q * image.height - .5;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      if (ix < 0 || iy < 0 || ix + 1 >= image.width || iy + 1 >= image.height) continue;
      const fx = sx - ix, fy = sy - iy, rgb: Vec = [0, 0, 0];
      let opaque = true;
      for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
        const source = ((iy + dy) * image.width + ix + dx) * 4, weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        if (image.rgba[source + 3] !== 255) opaque = false;
        for (let channel = 0; channel < 3; channel++) rgb[channel] += image.rgba[source + channel] * weight;
      }
      if (!opaque) continue;
      const f = feature(rgb.map(n => linear(n / 255)) as Vec);
      heights[pixel] = heightError; lightness[pixel] = f[0]; compatible[pixel] = target && sameFloorFamily(f, target) ? 1 : 0; rgba.set([...rgb.map(Math.round), 255], pixel * 4);
    }
  }
  if (plane) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x; if (rgba[pixel * 4 + 3]) continue;
    const pu = x0 + (x + .5) * pitch, pv = y0 + (y + .5) * pitch;
    if (!inside(pu, pv, ring)) continue;
    const delta: Vec = [pu * u[0] + pv * v[0] - plane.origin[0], level - plane.origin[1], pu * u[2] + pv * v[2] - plane.origin[2]];
    const sx = Math.floor(dot(delta, plane.u) / plane.metersPerTexel), sy = Math.floor(dot(delta, plane.v) / plane.metersPerTexel);
    if (sx < 0 || sx >= plane.width || sy < 0 || sy >= plane.height) continue;
    const source = (sy * plane.width + sx) * 4; if (plane.rgba[source + 3] !== 255) continue;
    const rgb: Vec = [plane.rgba[source], plane.rgba[source + 1], plane.rgba[source + 2]], f = feature(rgb.map(n => linear(n / 255)) as Vec);
    lightness[pixel] = f[0]; compatible[pixel] = target && sameFloorFamily(f, target) ? 1 : 0; rgba.set([...rgb, 255], pixel * 4);
  }
  let cameraSupportedTexels = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) cameraSupportedTexels++;
  if (!localizedPlaneOnly) {
    excludeOtherFloorFamilies(rgba, width, height, compatible, pitch);
    excludeCompactBlemishes(rgba, width, height, lightness, pitch);
  }
  let observedTexels = 0, interiorTexels = 0;
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (inside(x0 + (x + .5) * pitch, y0 + (y + .5) * pitch, ring)) interiorTexels++;
    const pixel = (y * width + x) * 4;
    if (rgba[pixel + 3]) { observedTexels++; for (let channel = 0; channel < 3; channel++) histograms[channel][rgba[pixel + channel]]++; }
  }
  if (!interiorTexels || observedTexels * pitch * pitch < .10) return unknown('insufficient-clean-coverage');
  // With no established material family, a dominant rug must not recolor the
  // unseen floor. A neutral geometry fill describes missing evidence; the
  // retained camera pixels keep their actual color, position and scale.
  const fillColorSRGB: Vec = localizedPlaneOnly ? [146, 151, 149] : histograms.map(histogram => {
    let count = 0;
    for (let value = 0; value < histogram.length; value++) { count += histogram[value]; if (count >= observedTexels / 2) return value; }
    return 0;
  }) as Vec;
  return { status: 'supported', source: 'observed-floor-atlas', confidence: 'low', layout: 'world-registered', wrapping: 'clamp-to-edge',
    width, height, rgba, metersPerTexel: pitch, spanMeters: [width * pitch, height * pitch],
    origin: [x0 * u[0] + y0 * v[0], level, x0 * u[2] + y0 * v[2]], u, v,
    observedTexels, interiorTexels, coverageFraction: observedTexels / interiorTexels,
    cameraSupportedTexels, unobservedInteriorTexels: Math.max(0, interiorTexels - cameraSupportedTexels), excludedCameraTexels: cameraSupportedTexels - observedTexels, cleanCoverageOfCameraEvidence: observedTexels / cameraSupportedTexels,
    fillColorSRGB, materialEvidence: localizedPlaneOnly ? 'ambiguous-preserve-plane' : 'mesh-color-family', fillSource: localizedPlaneOnly ? 'neutral-unknown-material' : 'camera-median',
    observedAreaSquareMeters: observedTexels * pitch * pitch, estimatedFillRequired: true };
}
