import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveCleanFaceFinish, type CleanFaceFinishInput } from '../src/lib/native/clean-face-finish';
type RGB = [number, number, number];
const fixture = (rgb: RGB, slot = 'cabinets_base', width = 80, height = 80): CleanFaceFinishInput => {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([...rgb, 255], i);
  return { width, height, rgba, slot };
};
function stripe(input: CleanFaceFinishInput, x0: number, x1: number, rgb: RGB) {
  for (let y = 0; y < input.height; y++) for (let x = x0; x < x1; x++) input.rgba.set([...rgb, 255], (y * input.width + x) * 4);
}
function supported(input: CleanFaceFinishInput) { const result = deriveCleanFaceFinish(input); assert.equal(result.status, 'supported'); if (result.status !== 'supported') throw new Error('Expected supported finish'); return result; }
let passed = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${++passed}: ${name}`); }
check('camera handles and compact clutter do not become a finish texture', () => {
  const input = fixture([125, 65, 45]); stripe(input, 16, 20, [238, 236, 235]);
  for (let y = 8; y < 16; y++) for (let x = 55; x < 68; x++) input.rgba.set([20, 30, 90, 255], (y * input.width + x) * 4);
  const result = supported(input); assert.deepEqual(result.cleanColorSRGB, [125, 65, 45]); assert.equal(result.finishKind, 'cabinet');
  for (let i = 0; i < result.rgba.length; i += 4) assert.deepEqual([...result.rgba.slice(i, i + 4)], [125, 65, 45, 255]);
  assert.equal(result.textureTreatment, 'smooth'); assert.equal(result.estimated, true);
});
check('white and black cabinets keep their neutral finish despite colored clutter', () => {
  for (const rgb of [[230, 230, 229], [18, 18, 19]] as RGB[]) {
    const input = fixture(rgb); stripe(input, 25, 30, [140, 70, 45]); const result = supported(input);
    assert.deepEqual(result.cleanColorSRGB, rgb); assert.equal(result.finishKind, 'cabinet');
  }
});
check('independent cream and cherry faces preserve their own color without pooling', () => {
  const cream = fixture([180, 168, 134], 'island_cabinets'), cherry = fixture([105, 42, 30], 'island_cabinets');
  assert.deepEqual(supported(cream).cleanColorSRGB, [180, 168, 134]); assert.deepEqual(supported(cherry).cleanColorSRGB, [105, 42, 30]);
  assert.deepEqual(supported(cream).cleanColorSRGB, [180, 168, 134]);
});
check('overlapping pale glare does not displace a distributed dominant hue family', () => {
  const input = fixture([150, 85, 65]);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if ((x + y) % 5 < 2) input.rgba.set([192, 159, 147, 255], (y * 80 + x) * 4);
  const result = supported(input); assert.deepEqual(result.cleanColorSRGB, [150, 85, 65]); assert.ok(result.supportFraction > .55 && result.supportFraction < .65);
});
check('co-spatial subdued shadows do not hide a strongly supported cabinet finish', () => {
  const input = fixture([182, 107, 92]);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if ((x + y) % 10 < 3) input.rgba.set([111, 86, 85, 255], (y * 80 + x) * 4);
  assert.deepEqual(supported(input).cleanColorSRGB, [182, 107, 92]);
});
check('substantial independent two-color faces fail explicitly instead of losing a finish', () => {
  for (const [a, b] of [[[110, 45, 25], [185, 170, 140]], [[235, 235, 235], [18, 18, 18]], [[30, 100, 160], [160, 50, 30]]] as [RGB, RGB][]) {
    for (const width of [20, 40]) { const input = fixture(a); stripe(input, 80 - width, 80, b); const result = deriveCleanFaceFinish(input); assert.equal(result.status, 'unknown'); if (result.status === 'unknown') assert.equal(result.reason, 'mixed-appearance'); }
  }
});
check('interleaved real multicolor patterns are not mistaken for removable pale glare', () => {
  const input = fixture([140, 45, 25]);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if ((x + y) % 2) input.rgba.set([25, 110, 155, 255], (y * 80 + x) * 4);
  assert.equal(deriveCleanFaceFinish(input).status, 'unknown');
});
check('beige stone keeps its tone while minority dark veins and clutter are not copied', () => {
  const input = fixture([210, 190, 155], 'island_countertop'); stripe(input, 10, 15, [60, 55, 45]); stripe(input, 40, 42, [110, 30, 20]);
  const result = supported(input); assert.equal(result.finishKind, 'stone'); assert.deepEqual(result.cleanColorSRGB, [210, 190, 155]);
  const greenStone = supported(fixture([80, 110, 85], 'countertop')); assert.deepEqual(greenStone.cleanColorSRGB, [80, 110, 85]);
});
check('appliance evidence selects neutral steel, black or white and excludes stickers', () => {
  for (const [rgb, kind] of [[[140, 139, 137], 'steel-appliance'], [[20, 21, 22], 'black-appliance'], [[235, 234, 232], 'white-appliance']] as [RGB, string][]) {
    const input = fixture(rgb, 'appliances'); stripe(input, 20, 30, [155, 40, 30]); const result = supported(input);
    assert.equal(result.finishKind, kind); assert.equal(result.cleanColorSRGB[0], result.cleanColorSRGB[1]); assert.equal(result.cleanColorSRGB[1], result.cleanColorSRGB[2]);
    assert.ok(Math.abs(result.cleanColorSRGB[0] - rgb[1]) <= 2);
  }
  assert.equal(deriveCleanFaceFinish(fixture([180, 20, 25], 'appliances')).status, 'unknown');
});
check('sparse mixed countertop fragments cannot repaint a whole slab', () => {
  for (const color of [[94, 95, 70], [225, 224, 213], [25, 25, 25]] as RGB[]) {
    const input = fixture(color, 'countertop');
    for (let i = 0; i < 6400; i++) {
      if (i % 14) input.rgba[i * 4 + 3] = 0;
      else if (Math.floor(i / 14) % 5 < 2) input.rgba.set([145, 52, 100, 255], i * 4);
    }
    assert.equal(deriveCleanFaceFinish(input).status, 'unknown');
    assert.deepEqual(supported(fixture(color, 'countertop')).cleanColorSRGB, color);
  }
  const agreeing = fixture([91, 110, 75], 'countertop');
  for (let i = 0; i < 6400; i++) if (i % 12) agreeing.rgba[i * 4 + 3] = 0;
  assert.deepEqual(supported(agreeing).cleanColorSRGB, [91, 110, 75]);
});
check('measured stone keeps supported fine detail without inventing veins in missing areas', () => {
  const input = fixture([232, 229, 215], 'countertop'); input.preserveSurfaceDetail = true;
  for (let y = 0; y < 80; y++) {
    const vein = 20 + Math.round(5 * Math.sin(y / 12));
    for (let x = vein; x < vein + 2; x++) input.rgba.set([218, 215, 201, 255], (y * 80 + x) * 4);
    for (let x = 60; x < 80; x++) input.rgba.set([255, 0, 0, 0], (y * 80 + x) * 4);
  }
  const before = Buffer.from(input.rgba), result = supported(input);
  assert.equal(result.textureTreatment, 'observed-fine-detail');
  assert.ok(result.rgba[(30 * 80 + 23) * 4] < result.cleanColorSRGB[0]);
  assert.deepEqual([...result.rgba.slice((30 * 80 + 70) * 4, (30 * 80 + 70) * 4 + 3)], result.cleanColorSRGB);
  assert.deepEqual(Buffer.from(input.rgba), before);
  const flat = supported({ ...input, preserveSurfaceDetail: false });
  assert.equal(flat.textureTreatment, 'smooth');
  const cabinet = supported({ ...input, slot: 'cabinets_base' }); assert.equal(cabinet.textureTreatment, 'smooth');
});
check('unobserved sentinels, sparse pixels and malformed masks cannot establish a finish', () => {
  const input = fixture([125, 65, 45]);
  for (let i = 0; i < input.rgba.length; i += 4) if (i % 20 !== 0) input.rgba.set([0, 255, 255, 0], i);
  assert.deepEqual(supported(input).cleanColorSRGB, [125, 65, 45]);
  input.rgba.fill(0); input.rgba.set([255, 30, 25, 255], 0); assert.equal(deriveCleanFaceFinish(input).status, 'unknown');
  input.rgba[3] = 128; const bad = deriveCleanFaceFinish(input); assert.equal(bad.status, 'unknown'); if (bad.status === 'unknown') assert.equal(bad.reason, 'invalid-input');
  assert.equal(deriveCleanFaceFinish({ ...input, width: 1025 }).status, 'unknown');
});
check('low coverage requires abundant distributed agreement, not a few isolated pixels', () => {
  const input = fixture([157, 134, 112]);
  for (let i = 0; i < 6400; i++) if (i % 32) input.rgba[i * 4 + 3] = 0;
  const result = supported(input); assert.equal(result.confidence, 'low'); assert.deepEqual(result.cleanColorSRGB, [157, 134, 112]);
  input.rgba.fill(0); for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) input.rgba.set([157, 134, 112, 255], (y * 80 + x) * 4);
  assert.equal(deriveCleanFaceFinish(input).status, 'unknown');
});
check('source bytes and source support mask stay exact while clean output is opaque', () => {
  const input = fixture([130, 70, 50]); for (let i = 3; i < input.rgba.length; i += 20) input.rgba[i] = 0;
  const hash = () => createHash('sha256').update(input.rgba).digest('hex'), before = hash(), result = supported(input);
  assert.equal(hash(), before); assert.notEqual(result.rgba, input.rgba); for (let i = 3; i < result.rgba.length; i += 4) assert.equal(result.rgba[i], 255);
  assert.ok(result.observedFraction < 1); assert.equal(result.provenance, 'same-face-camera-finish-estimate');
});
check('maximum admitted input uses a bounded sample and returns deterministic complete output', () => {
  const input = fixture([140, 90, 60], 'cabinets_base', 1024, 1024), started = performance.now(), result = supported(input);
  assert.equal(result.rgba.length, input.rgba.length); assert.deepEqual(result.cleanColorSRGB, [140, 90, 60]);
  console.log(`  Maximum 1,048,576-pixel input: ${(performance.now() - started).toFixed(1)}ms`);
});
console.log(`${passed} clean face finish checks passed.`);
