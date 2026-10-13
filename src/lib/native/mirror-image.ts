import { uprightToRawUV, type CapturedImageRotation } from './camera-projection';
import type { ScanTextureImage } from './texture-archive';

type Filter = { start: number; weights: number[] };
const PRECISION = 2 ** 22;

/** Separable triangle resampling with wider support when reducing an image.
 * Fixed-point weights and byte rounding match Pillow's RGB bilinear pipeline
 * used to validate the local model. These are derived pixels, never source edits. */
function filters(source: number, target: number): Filter[] {
  const scale = source / target, support = Math.max(1, scale);
  return Array.from({ length: target }, (_, pixel) => {
    const center = (pixel + .5) * scale;
    const start = Math.max(0, Math.floor(center - support + .5));
    const end = Math.min(source, Math.floor(center + support + .5));
    const weights = Array.from({ length: end - start }, (_, index) => Math.max(0, 1 - Math.abs((start + index + .5 - center) / support)));
    const sum = weights.reduce((a, b) => a + b, 0);
    return { start, weights: weights.map(weight => Math.floor(weight / sum * PRECISION + .5)) };
  });
}

export function resizeMirrorImageRGB(image: ScanTextureImage, rotation: CapturedImageRotation, width: number, height: number): Uint8Array {
  if (![image.width, image.height].every(n => Number.isInteger(n) && n >= 1 && n <= 384)
    || ![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 512)
    || ![0, 90, 180, 270].includes(rotation) || !(image.rgba instanceof Uint8Array)
    || image.rgba.length !== image.width * image.height * 4) throw new Error('Invalid local camera image.');
  const turned = rotation === 90 || rotation === 270;
  const sourceWidth = turned ? image.height : image.width, sourceHeight = turned ? image.width : image.height;
  const horizontal = filters(sourceWidth, width), vertical = filters(sourceHeight, height);
  const intermediate = new Uint8Array(width * sourceHeight * 3), result = new Uint8Array(width * height * 3);
  for (let y = 0; y < sourceHeight; y++) for (let x = 0; x < width; x++) {
    const filter = horizontal[x], totals = [PRECISION / 2, PRECISION / 2, PRECISION / 2];
    for (let tap = 0; tap < filter.weights.length; tap++) {
      const uv = uprightToRawUV((filter.start + tap + .5) / sourceWidth, (y + .5) / sourceHeight, rotation);
      const rawX = Math.min(image.width - 1, Math.floor(uv.u * image.width)), rawY = Math.min(image.height - 1, Math.floor(uv.v * image.height));
      const index = (rawY * image.width + rawX) * 4;
      for (let c = 0; c < 3; c++) totals[c] += image.rgba[index + c] * filter.weights[tap];
    }
    for (let c = 0; c < 3; c++) intermediate[(y * width + x) * 3 + c] = Math.max(0, Math.min(255, Math.floor(totals[c] / PRECISION)));
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const filter = vertical[y];
    for (let c = 0; c < 3; c++) {
      let sum = PRECISION / 2;
      for (let tap = 0; tap < filter.weights.length; tap++) sum += intermediate[((filter.start + tap) * width + x) * 3 + c] * filter.weights[tap];
      result[(y * width + x) * 3 + c] = Math.max(0, Math.min(255, Math.floor(sum / PRECISION)));
    }
  }
  return result;
}

/** RGB byte image → Float32 NCHW with the model's documented normalization. */
export function mirrorModelPixels(image: ScanTextureImage, rotation: CapturedImageRotation, width: number, height: number): Float32Array {
  const rgb = resizeMirrorImageRGB(image, rotation, width, height), count = width * height;
  const result = new Float32Array(count * 3), mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let c = 0; c < 3; c++) for (let pixel = 0; pixel < count; pixel++) result[c * count + pixel] = (rgb[pixel * 3 + c] / 255 - mean[c]) / std[c];
  return result;
}
