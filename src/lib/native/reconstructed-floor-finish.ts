import type { ReconstructedFloor } from './reconstructed-floor';

type Vec = [number, number, number];
type Sample = { x: number; y: number; value: number };
type Cell = { angle: number; coherence: number; count: number };
export interface ReconstructedFloorFinish {
  source: 'estimated-clean-floor'; confidence: 'low';
  /** Appearance only: images cannot verify the physical flooring material. */
  appearance: 'wood-like' | 'tile-like' | 'unknown';
  pattern: 'directional-grain' | 'subtle-mineral' | 'uniform';
  rgba: Uint8Array; width: number; height: number; repeatMeters: [number, number];
  origin: Vec; u: Vec; v: Vec; colorSRGB: Vec;
  /** Measured periodic image evidence, not a construction dimension. Null
   * means no joint spacing is supported and no joint grid is drawn. */
  jointSpacingMeters: [number | null, number | null];
  grainDirectionRadians: number | null;
  evidence: { independentCells: number; directionalSupport: number; observedAreaSquareMeters: number; periodicFit: [number, number] };
}
const TAU = Math.PI * 2;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const angleDistance = (a: number, b: number) => Math.acos(clamp(Math.cos(2 * (a - b)), -1, 1)) / 2;
function quantile(values: number[], fraction: number): number {
  values.sort((a, b) => a - b); return values[Math.floor((values.length - 1) * fraction)] ?? 0;
}
function integral(values: Float32Array | Uint8Array, width: number, height: number): Float64Array {
  const sum = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) { row += values[y * width + x]; sum[(y + 1) * (width + 1) + x + 1] = sum[y * (width + 1) + x + 1] + row; }
  }
  return sum;
}
function box(sum: Float64Array, width: number, height: number, x: number, y: number, radius: number): number {
  const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1), y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1), stride = width + 1;
  return sum[y1 * stride + x1] - sum[y0 * stride + x1] - sum[y1 * stride + x0] + sum[y0 * stride + x0];
}
function periodicFit(samples: Sample[], angle: number, period: number): number {
  if (samples.length < 80) return 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let c = 0, s = 0, z = 0, cc = 0, ss = 0, cs = 0, cz = 0, sz = 0, zz = 0;
  for (const sample of samples) {
    const a = (sample.x * cos + sample.y * sin) * TAU / period, cv = Math.cos(a), sv = Math.sin(a), value = sample.value;
    c += cv; s += sv; z += value; cc += cv * cv; ss += sv * sv; cs += cv * sv; cz += cv * value; sz += sv * value; zz += value * value;
  }
  const n = samples.length;
  cc -= c * c / n; ss -= s * s / n; cs -= c * s / n; cz -= c * z / n; sz -= s * z / n; zz -= z * z / n;
  const determinant = cc * ss - cs * cs;
  if (determinant < 1e-8 || zz < 1e-8) return 0;
  return clamp((ss * cz * cz - 2 * cs * cz * sz + cc * sz * sz) / determinant / zz, 0, 1);
}
function spacing(samples: Sample[], angle: number, pitch: number): { period: number | null; score: number } {
  const candidates: { period: number; score: number }[] = [];
  for (let period = Math.max(.06, pitch * 4); period <= .8; period += .0025) candidates.push({ period, score: periodicFit(samples, angle, period) });
  candidates.sort((a, b) => b.score - a.score);
  const score = candidates[0]?.score ?? 0;
  // Require a periodic signal in independent spatial halves. A camera seam,
  // one rug edge or a shadow is not sufficient to invent a grout grid.
  const cos = Math.cos(angle), sin = Math.sin(angle), along = samples.map(p => p.x * cos + p.y * sin), split = quantile([...along], .5);
  const first = samples.filter((_, i) => along[i] < split), second = samples.filter((_, i) => along[i] >= split);
  const span = Math.max(...along) - Math.min(...along);
  const mean = samples.reduce((s, p) => s + p.value, 0) / Math.max(1, samples.length);
  const variance = samples.reduce((s, p) => s + (p.value - mean) ** 2, 0);
  for (const candidate of candidates) {
    const period = candidate.period;
    if (candidate.score < .04) break;
    if (span < period * 4 || periodicFit(first, angle, period) < .03 || periodicFit(second, angle, period) < .03) continue;
    // A joint has a narrow dark trough and otherwise a comparatively flat
    // profile. Smooth periodic grain is insufficient. Bin resolution follows
    // source pitch so quantized texel positions do not create empty phases.
    const bins = Math.max(8, Math.min(32, Math.floor(period / pitch / 2)));
    const sums = new Float64Array(bins), counts = new Uint32Array(bins), phases: number[] = [];
    samples.forEach((sample, i) => { const phase = along[i] / period, bin = Math.min(bins - 1, Math.floor((phase - Math.floor(phase)) * bins)); phases.push(bin); sums[bin] += sample.value; counts[bin]++; });
    if (counts.some(n => n < 3)) continue;
    const profile = Array.from(sums, (sum, i) => sum / counts[i]), middle = quantile([...profile], .5);
    const deviation = quantile(profile.map(n => Math.abs(n - middle)), .5), depth = middle - Math.min(...profile);
    const residual = samples.reduce((s, p, i) => s + (p.value - profile[phases[i]]) ** 2, 0);
    // Reject a high-scoring harmonic that overlays real joints with clear
    // floor between them; the accepted period must explain the full profile.
    if (variance < 1e-8 || residual / variance > .3 || depth < Math.max(.008, deviation * 4)
      || profile.filter(n => n < middle - depth * .5).length > bins / 4) continue;
    return { period, score: candidate.score };
  }
  return { period: null, score };
}

/** Clean, consistent MATERIAL inference for the editable model. The original
 * world atlas remains a separate immutable source. Shadows, rugs and camera
 * exposure patches are not copied into this texture. Only independently
 * supported directional structure and periodic joints influence the pattern;
 * ambiguous evidence yields restrained mineral variation or a uniform color. */
export function deriveReconstructedFloorFinish(floor: ReconstructedFloor): ReconstructedFloorFinish | null {
  // A localized observation can include a real rug or shadow. Preserve it at
  // that world location instead of synthesizing/repeating it as the flooring.
  if (floor.status !== 'supported' || floor.materialEvidence === 'ambiguous-preserve-plane') return null;
  const { width, height, rgba, metersPerTexel: pitch } = floor, count = width * height;
  if (![width, height].every(n => Number.isInteger(n) && n >= 4 && n <= 512) || rgba.length !== count * 4 || !Number.isFinite(pitch) || pitch < .005 || pitch > .025
    || floor.fillColorSRGB.length !== 3 || !floor.fillColorSRGB.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    || ![floor.origin, floor.u, floor.v].every(v => v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 1500))
    || Math.abs(Math.hypot(...floor.u) - 1) > 1e-5 || Math.abs(Math.hypot(...floor.v) - 1) > 1e-5
    || Math.abs(floor.u.reduce((sum, n, i) => sum + n * floor.v[i], 0)) > 1e-5) return null;
  const valid = new Uint8Array(count), luminance = new Float32Array(count), high = new Float32Array(count), gx = new Float32Array(count), gy = new Float32Array(count);
  let observations = 0;
  for (let i = 0; i < count; i++) if (rgba[i * 4 + 3] === 255) {
    valid[i] = 1; observations++; luminance[i] = (rgba[i * 4] * .2126 + rgba[i * 4 + 1] * .7152 + rgba[i * 4 + 2] * .0722) / 255;
  }
  if (observations * pitch * pitch < .1) return null;
  const sum = integral(luminance, width, height), coverage = integral(valid, width, height), radius = Math.max(2, Math.round(.06 / pitch));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x; if (valid[i]) high[i] = luminance[i] - box(sum, width, height, x, y, radius) / Math.max(1, box(coverage, width, height, x, y, radius));
  }
  const interior = new Uint8Array(count), magnitudes: number[] = [], residues: number[] = [], samples: Sample[] = [];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (![i, i - 1, i + 1, i - width, i + width].every(j => valid[j])) continue;
    interior[i] = 1; gx[i] = (high[i + 1] - high[i - 1]) / 2; gy[i] = (high[i + width] - high[i - width]) / 2;
    magnitudes.push(Math.hypot(gx[i], gy[i])); residues.push(Math.abs(high[i]));
    samples.push({ x: (x + .5) * pitch, y: (y + .5) * pitch, value: clamp(high[i], -.04, .04) });
  }
  const cutoff = quantile(magnitudes, .8), variation = quantile(residues, .5), cellSize = Math.max(12, Math.round(.4 / pitch)), cells: Cell[] = [];
  for (let y = 0; y + cellSize <= height; y += cellSize) for (let x = 0; x + cellSize <= width; x += cellSize) {
    let xx = 0, xy = 0, yy = 0, observed = 0;
    for (let dy = 0; dy < cellSize; dy++) for (let dx = 0; dx < cellSize; dx++) {
      const i = (y + dy) * width + x + dx; if (!interior[i]) continue;
      observed++; const weight = Math.min(1, cutoff / Math.max(1e-10, Math.hypot(gx[i], gy[i])));
      xx += gx[i] * gx[i] * weight; xy += gx[i] * gy[i] * weight; yy += gy[i] * gy[i] * weight;
    }
    if (observed / (cellSize * cellSize) >= .65 && xx + yy > 1e-5) cells.push({ angle: Math.atan2(2 * xy, xx - yy) / 2, coherence: Math.hypot(xx - yy, 2 * xy) / (xx + yy), count: observed });
  }
  const directional = cells.filter(c => c.coherence >= .25);
  let dominant = 0, support = 0;
  for (let angle = 0; angle < Math.PI; angle += Math.PI / 180) {
    const matching = directional.filter(c => angleDistance(c.angle, angle) <= Math.PI / 9), ratio = matching.length / Math.max(1, directional.length);
    if (ratio > support) {
      support = ratio;
      dominant = Math.atan2(matching.reduce((s, c) => s + Math.sin(c.angle * 2), 0), matching.reduce((s, c) => s + Math.cos(c.angle * 2), 0)) / 2;
    }
  }
  const isDirectional = directional.length >= 6 && support >= .6 && variation >= .002;
  const crossed = directional.length >= 4 && directional.filter(c => angleDistance(c.angle, dominant) > Math.PI * .36).length >= 2;
  const appearance = isDirectional ? 'wood-like' : crossed ? 'tile-like' : 'unknown';
  const pattern = isDirectional ? 'directional-grain' : variation >= .002 && cells.length >= 3 ? 'subtle-mineral' : 'uniform';
  // The grain runs along U; its image gradient is perpendicular to it.
  const angle = isDirectional ? dominant + Math.PI / 2 : dominant;
  const u = floor.u.map((n, i) => n * Math.cos(angle) + floor.v[i] * Math.sin(angle)) as Vec;
  const v = floor.u.map((n, i) => -n * Math.sin(angle) + floor.v[i] * Math.cos(angle)) as Vec;
  const stride = Math.max(1, Math.ceil(samples.length / 1536)), subset = samples.filter((_, i) => i % stride === 0);
  const a = isDirectional || crossed ? spacing(subset, angle, pitch) : { period: null, score: 0 };
  const b = isDirectional || crossed ? spacing(subset, angle + Math.PI / 2, pitch) : { period: null, score: 0 };
  // Directional grain does not authorize regular perpendicular end joints.
  if (isDirectional) a.period = null;
  const repeats: [number, number] = [a.period ? a.period * Math.max(2, Math.round(1.6 / a.period)) : 1.6, b.period ? b.period * Math.max(2, Math.round(1.2 / b.period)) : 1.2];
  const size = pattern === 'uniform' ? 16 : 256, pixels = new Uint8Array(size * size * 4), amplitude = pattern === 'uniform' ? 0 : clamp(variation * 255 * .5, 1, 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Duplicate the periodic endpoint at both texture edges so linear and
    // mipmapped sampling cannot expose a wrap discontinuity.
    const px = x / (size - 1), py = y / (size - 1);
    // Integer harmonics make the inferred material seamless. Low amplitude
    // avoids asserting individual knots, grain lines, tile patterns or brands.
    const noise = isDirectional
      ? .65 * Math.sin(TAU * (21 * py + .18 * Math.sin(TAU * px))) + .25 * Math.sin(TAU * (47 * py + .12 * Math.sin(TAU * px * 3))) + .1 * Math.sin(TAU * (4 * py + px))
      : .4 * Math.sin(TAU * (13 * px + 9 * py)) + .35 * Math.cos(TAU * (7 * px - 17 * py)) + .25 * Math.sin(TAU * (31 * px + 23 * py));
    let delta = amplitude * noise;
    for (const [coordinate, repeat, joint] of [[px, repeats[0], a.period], [py, repeats[1], b.period]]) if (joint) {
      const phase = coordinate! * repeat! / joint, fraction = phase - Math.floor(phase), distance = Math.min(fraction, 1 - fraction) * joint;
      delta -= Math.max(0, 1 - distance / .002) * Math.min(10, amplitude * 3);
    }
    const at = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) pixels[at + c] = Math.round(clamp(floor.fillColorSRGB[c] + delta, 0, 255));
    pixels[at + 3] = 255;
  }
  return { source: 'estimated-clean-floor', confidence: 'low', appearance, pattern, rgba: pixels, width: size, height: size,
    repeatMeters: repeats, origin: [...floor.origin], u, v, colorSRGB: [...floor.fillColorSRGB], jointSpacingMeters: [a.period, b.period], grainDirectionRadians: isDirectional ? angle : null,
    evidence: { independentCells: cells.length, directionalSupport: support, observedAreaSquareMeters: observations * pitch * pitch, periodicFit: [a.score, b.score] } };
}
