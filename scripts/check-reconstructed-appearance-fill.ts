import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fillReconstructedAppearance, type ReconstructedAppearanceFillInput } from '../src/lib/native/reconstructed-appearance-fill';
type RGB = [number, number, number];
function fixture(width = 100, height = 60, color: RGB = [110, 55, 40]): ReconstructedAppearanceFillInput {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([...color, 255], i);
  return { width, height, rgba, spanMeters: [width * .005, height * .005], fillColorSRGB: [150, 90, 80] };
}
const clear = (input: ReconstructedAppearanceFillInput, left: number, bottom: number, right: number, top: number) => {
  for (let y = bottom; y < top; y++) for (let x = left; x < right; x++) input.rgba.set([255, 0, 255, 0], (y * input.width + x) * 4);
};
const pixel = (rgba: Uint8Array, width: number, x: number, y: number) => [...rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let passed = 0;
function check(name: string, test: () => void) { test(); console.log(`PASS ${++passed}: ${name}`); }
check('all observed RGB and the original support mask remain byte-exact', () => {
  const input = fixture();
  for (let i = 0; i < input.rgba.length; i += 4) input.rgba.set([(i * 13) % 256, (i * 29 + 1) % 256, (i * 7 + 4) % 256, 255], i);
  clear(input, 30, 20, 45, 35); const before = hash(input.rgba), result = fillReconstructedAppearance(input);
  assert.notEqual(result.rgba, input.rgba); assert.equal(hash(input.rgba), before);
  for (let i = 0; i < input.rgba.length; i += 4) if (input.rgba[i + 3]) assert.deepEqual(result.rgba.slice(i, i + 4), input.rgba.slice(i, i + 4));
  assert.equal(result.observedTexels, 6000 - 225); assert.equal(result.inferredTexels, 225); assert.equal(result.estimatedFillRequired, true);
});
check('small six-to-ten-centimeter holes interpolate local color instead of becoming geometry holes', () => {
  for (const size of [12, 20]) {
    const input = fixture(); clear(input, 35, 15, 35 + size, 15 + size);
    const result = fillReconstructedAppearance(input), center = pixel(result.rgba, input.width, 35 + size / 2, 15 + size / 2);
    assert.ok(center[0] < 130 && center[0] >= 110); assert.ok(center[1] < 75 && center[1] >= 55); assert.equal(center[3], 255);
    assert.equal(result.interpolatedTexels, size * size);
    for (let i = 3; i < result.rgba.length; i += 4) assert.equal(result.rgba[i], 255);
  }
});
check('large unobserved regions transition smoothly to the same-face robust estimate', () => {
  const input = fixture(); clear(input, 20, 0, 100, 60); const result = fillReconstructedAppearance(input);
  const samples = Array.from({ length: 28 }, (_, i) => pixel(result.rgba, input.width, 20 + i, 30)[0]);
  assert.ok(samples[0] <= 111); assert.equal(samples[27], 150);
  for (let i = 1; i < samples.length; i++) { assert.ok(samples[i] >= samples[i - 1]); assert.ok(samples[i] - samples[i - 1] <= 6); }
  assert.deepEqual(pixel(result.rgba, input.width, 80, 30), [150, 90, 80, 255]);
});
check('red and cream faces are independent and cannot pool or retain each other’s colors', () => {
  const a = fixture(80, 80, [100, 40, 25]), b = fixture(80, 80, [195, 180, 145]);
  a.fillColorSRGB = [100, 40, 25]; b.fillColorSRGB = [195, 180, 145];
  for (const input of [a, b]) clear(input, 25, 25, 45, 45);
  const first = fillReconstructedAppearance(a), cream = fillReconstructedAppearance(b), repeated = fillReconstructedAppearance(a);
  assert.deepEqual(pixel(first.rgba, a.width, 35, 35), [100, 40, 25, 255]);
  assert.deepEqual(pixel(cream.rgba, b.width, 35, 35), [195, 180, 145, 255]); assert.deepEqual(first.rgba, repeated.rgba);
});
check('unobserved RGB sentinels do not leak into interpolation and blank faces remain estimated', () => {
  const input = fixture(); clear(input, 30, 20, 40, 30); const result = fillReconstructedAppearance(input);
  const center = pixel(result.rgba, input.width, 35, 25); assert.ok(center[2] < 55); assert.ok(center[0] < 125);
  clear(input, 0, 0, input.width, input.height); const empty = fillReconstructedAppearance(input);
  assert.equal(empty.observedTexels, 0); assert.equal(empty.interpolatedTexels, 0); assert.equal(empty.inferredTexels, input.width * input.height);
  assert.deepEqual(pixel(empty.rgba, input.width, 20, 20), [...input.fillColorSRGB, 255]);
});
check('color interpolation averages surrounding fine stripes instead of repeating their grain', () => {
  const input = fixture(80, 80);
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) input.rgba.set(y % 2 ? [160, 80, 40, 255] : [80, 40, 20, 255], (y * input.width + x) * 4);
  clear(input, 34, 34, 46, 46); const result = fillReconstructedAppearance(input), center = pixel(result.rgba, input.width, 40, 40);
  assert.ok(center[0] > 105 && center[0] < 135); assert.ok(center[1] > 52 && center[1] < 68);
});
check('physical distance governs support instead of blindly spreading a fixed pixel radius', () => {
  const input = fixture(); clear(input, 20, 0, 100, 60);
  const small = fillReconstructedAppearance(input); input.spanMeters = [5, 3]; const large = fillReconstructedAppearance(input);
  assert.ok(pixel(small.rgba, input.width, 22, 30)[0] < 120); assert.deepEqual(pixel(large.rgba, input.width, 22, 30), [...input.fillColorSRGB, 255]);
});
check('fully observed input is a separate byte-identical output with no inferred pixels', () => {
  const input = fixture(), result = fillReconstructedAppearance(input); assert.deepEqual(result.rgba, input.rgba); assert.notEqual(result.rgba, input.rgba); assert.equal(result.estimatedFillRequired, false); assert.equal(result.inferredTexels, 0);
});
check('malformed and oversized inputs fail before unbounded allocation', () => {
  const input = fixture();
  for (const bad of [{ ...input, width: 1025 }, { ...input, spanMeters: [NaN, 1] as [number, number] }, { ...input, fillColorSRGB: [0, 0, 256] as RGB }, { ...input, rgba: new Uint8Array(3) }]) assert.throws(() => fillReconstructedAppearance(bad));
  input.rgba[3] = 128; assert.throws(() => fillReconstructedAppearance(input));
});
check('maximum admitted atlas has bounded complete output and exact observed data', () => {
  const input = fixture(1024, 1024); clear(input, 500, 0, 1024, 1024); const before = hash(input.rgba), started = performance.now(), result = fillReconstructedAppearance(input);
  assert.equal(result.rgba.length, input.rgba.length); assert.equal(hash(input.rgba), before); assert.equal(result.observedTexels, 500 * 1024); assert.equal(result.inferredTexels, 524 * 1024);
  console.log(`  Maximum 1,048,576-texel atlas: ${(performance.now() - started).toFixed(1)}ms`);
});
console.log(`${passed} reconstructed appearance fill checks passed.`);
