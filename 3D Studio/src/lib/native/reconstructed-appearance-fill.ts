type RGB = [number, number, number];
export interface ReconstructedAppearanceFillInput {
  rgba: Uint8Array; width: number; height: number;
  spanMeters: [number, number]; fillColorSRGB: RGB;
}
export interface ReconstructedAppearanceFill {
  /** Opaque display pixels only; the caller retains its original support mask. */
  rgba: Uint8Array;
  observedTexels: number; inferredTexels: number; interpolatedTexels: number;
  estimatedFillRequired: boolean;
  recipe: 'same-plane-local-color-fill';
}
const MAX_EDGE = 1024, MAX_TEXELS = 1_048_576;
const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low))); return t * t * (3 - 2 * t);
};

/** Fill display gaps from this plane's nearby observed colors, without copying
 * or synthesizing grain. Nested, distance-weighted windows interpolate color
 * across small holes; beyond 3.5–10cm from evidence this smoothly approaches
 * the caller's robust same-face estimate. Windows never extend more than 10cm
 * along either plane axis. All measured RGB bytes are copied exactly.
 *
 * Two chamfer-distance passes and summed-area tables keep work O(texels),
 * independent of hole size. At most one channel table is allocated at a time
 * (about 21 MiB total working/output arrays at the 1,048,576-texel cap).
 * This function creates neither geometry nor a new observation/support mask. */
export function fillReconstructedAppearance(input: ReconstructedAppearanceFillInput): ReconstructedAppearanceFill {
  const { rgba, width, height, spanMeters, fillColorSRGB } = input;
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE || count > MAX_TEXELS
    || !(rgba instanceof Uint8Array) || rgba.length !== count * 4
    || spanMeters.length !== 2 || !spanMeters.every(n => Number.isFinite(n) && n > 0 && n <= 100)
    || fillColorSRGB.length !== 3 || !fillColorSRGB.every(n => Number.isFinite(n) && n >= 0 && n <= 255)) throw new Error('Invalid reconstructed appearance fill.');
  const output = rgba.slice(), distance = new Float32Array(count), fill = fillColorSRGB.map(Math.round);
  let observedTexels = 0;
  for (let i = 0; i < count; i++) {
    const alpha = rgba[i * 4 + 3];
    if (alpha !== 0 && alpha !== 255) throw new Error('Appearance support alpha must be zero or 255.');
    if (alpha) { observedTexels++; distance[i] = 0; }
    else { distance[i] = Infinity; output.set(fill, i * 4); output[i * 4 + 3] = 255; }
  }
  const result: ReconstructedAppearanceFill = { rgba: output, observedTexels, inferredTexels: count - observedTexels, interpolatedTexels: 0, estimatedFillRequired: observedTexels !== count, recipe: 'same-plane-local-color-fill' };
  if (!observedTexels || observedTexels === count) return result;
  const stepX = spanMeters[0] / width, stepY = spanMeters[1] / height, diagonal = Math.hypot(stepX, stepY);
  // Anisotropic physical distances avoid treating a narrow and a wide pixel
  // as equally close. Conservative chamfer distance need not fabricate edges.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x; let d = distance[i];
    if (x) d = Math.min(d, distance[i - 1] + stepX);
    if (y) { d = Math.min(d, distance[i - width] + stepY); if (x) d = Math.min(d, distance[i - width - 1] + diagonal); if (x + 1 < width) d = Math.min(d, distance[i - width + 1] + diagonal); }
    distance[i] = d;
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x; let d = distance[i];
    if (x + 1 < width) d = Math.min(d, distance[i + 1] + stepX);
    if (y + 1 < height) { d = Math.min(d, distance[i + width] + stepY); if (x) d = Math.min(d, distance[i + width - 1] + diagonal); if (x + 1 < width) d = Math.min(d, distance[i + width + 1] + diagonal); }
    distance[i] = d;
  }
  const stride = width + 1, tableLength = stride * (height + 1), weights = new Uint32Array(tableLength), channel = new Float64Array(tableLength);
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) { row += rgba[(y * width + x) * 4 + 3] ? 1 : 0; const index = (y + 1) * stride + x + 1; weights[index] = weights[index - stride] + row; }
  }
  const sum = (table: Uint32Array | Float64Array, x: number, y: number, rx: number, ry: number) => {
    const left = Math.max(0, x - rx), right = Math.min(width, x + rx + 1), bottom = Math.max(0, y - ry), top = Math.min(height, y + ry + 1);
    return table[top * stride + right] - table[top * stride + left] - table[bottom * stride + right] + table[bottom * stride + left];
  };
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        const pixel = (y * width + x) * 4, index = (y + 1) * stride + x + 1;
        if (rgba[pixel + 3]) row += rgba[pixel + c];
        channel[index] = channel[index - stride] + row;
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, d = distance[i]; if (rgba[i * 4 + 3] || d >= .1) continue;
      const baseRadius = Math.min(.1, Math.max(stepX, stepY, d) * 1.25 + .005);
      let value = 0, weight = 0;
      for (let ring = 0; ring < 3; ring++) {
        const radius = Math.min(.1, baseRadius + ring * .015), rx = Math.floor(radius / stepX), ry = Math.floor(radius / stepY), importance = 4 >> ring;
        weight += sum(weights, x, y, rx, ry) * importance; value += sum(channel, x, y, rx, ry) * importance;
      }
      if (!weight) continue;
      const blend = smoothstep(.035, .1, d);
      output[i * 4 + c] = Math.round(value / weight * (1 - blend) + fill[c] * blend);
      if (!c) result.interpolatedTexels++;
    }
  }
  return result;
}
