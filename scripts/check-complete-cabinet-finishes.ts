import assert from 'node:assert/strict';
import { deriveCleanFaceFinish, type CleanFaceFinish } from '../src/lib/native/clean-face-finish';
import { completeSameCabinetFinishes, type CabinetFinishFace } from '../src/lib/native/complete-cabinet-finishes';
type RGB = [number, number, number];
function finish(rgb: RGB): Extract<CleanFaceFinish, { status: 'supported' }> {
  const rgba = new Uint8Array(64 * 64 * 4); for (let i = 0; i < rgba.length; i += 4) rgba.set([...rgb, 255], i);
  const result = deriveCleanFaceFinish({ rgba, width: 64, height: 64, slot: 'cabinets_upper' }); assert.equal(result.status, 'supported'); if (result.status !== 'supported') throw new Error('Expected supported synthetic finish'); return result;
}
const unknown: CleanFaceFinish = { status: 'unknown', reason: 'insufficient-evidence', confidence: 'low', provenance: 'same-face-camera-finish-estimate', estimated: true };
const face = (id: string, orientation: CabinetFinishFace['orientation'], value: CleanFaceFinish = unknown): CabinetFinishFace => ({ id, objectId: 'cabinet-A', slot: 'cabinets_upper', orientation, finish: value });
const run = (faces: CabinetFinishFace[], role = 'upper-cabinet') => completeSameCabinetFinishes({ objectId: 'cabinet-A', role, faces });
let passed = 0;
const check = (name: string, test: () => void) => { test(); console.log(`PASS ${++passed}: ${name}`); };
check('a broadly supported front completes only insufficient side and top finishes', () => {
  const faces = [face('front', 'front', finish([130, 70, 50])), face('side', 'side'), face('top', 'top'), face('back', 'back'), face('bottom', 'bottom')], result = run(faces);
  assert.deepEqual(result.map(r => r.faceId), ['side', 'top']);
  for (const r of result) { assert.deepEqual(r.cleanColorSRGB, [130, 70, 50]); assert.equal(r.confidence, 'low'); assert.equal(r.assumed, true); assert.equal(r.provenance, 'same-object-cabinet-finish-continuity'); assert.deepEqual(r.fromFaceIds, ['front']); }
});
check('opposing cream and cherry faces block any continuity assumption', () => {
  assert.deepEqual(run([face('front', 'front', finish([110, 45, 30])), face('back', 'back', finish([180, 165, 130])), face('top', 'top')]), []);
});
check('islands and all non-cabinet roles are excluded even with one matching color', () => {
  const faces = [face('front', 'front', finish([130, 70, 50])), face('side', 'side')];
  for (const role of ['island', 'table', 'other', 'refrigerator', 'sink']) assert.deepEqual(run(faces, role), []);
});
check('colors cannot transfer across object IDs or material slots', () => {
  const front = face('front', 'front', finish([130, 70, 50])), side = face('side', 'side'); side.objectId = 'cabinet-B'; assert.deepEqual(run([front, side]), []);
  for (const slot of ['countertop', 'island_cabinets', 'appliances', 'vanity_top']) assert.deepEqual(run([front, { ...face('top', 'top'), slot }]), []);
});
check('mixed or invalid faces cannot be overwritten or lend agreement', () => {
  for (const reason of ['mixed-appearance', 'invalid-input'] as const) {
    const mixed: CleanFaceFinish = { ...unknown, status: 'unknown', reason };
    assert.deepEqual(run([face('front', 'front', finish([130, 70, 50])), face('mixed', 'side', mixed), face('top', 'top')]), []);
  }
});
check('a tiny or weak front does not justify completing its cabinet', () => {
  for (const patch of [{ observedFraction: .1 }, { supportFraction: .3 }, { spatialCellCount: 6 }]) {
    assert.deepEqual(run([face('front', 'front', { ...finish([130, 70, 50]), ...patch }), face('side', 'side')]), []);
  }
});
check('white and black remain neutral while disagreeing neutral finishes remain separate', () => {
  for (const rgb of [[230, 230, 230], [18, 18, 18]] as RGB[]) assert.deepEqual(run([face('front', 'front', finish(rgb)), face('top', 'top')])[0].cleanColorSRGB, rgb);
  assert.deepEqual(run([face('front', 'front', finish([230, 230, 230])), face('back', 'back', finish([18, 18, 18])), face('top', 'top')]), []);
});
check('agreement permits restrained illumination differences without averaging donors', () => {
  const result = run([face('front', 'front', finish([130, 70, 50])), face('side', 'side', finish([110, 58, 41])), face('top', 'top')]);
  assert.equal(result.length, 1); assert.deepEqual(result[0].cleanColorSRGB, [130, 70, 50]); assert.deepEqual(result[0].fromFaceIds, ['front', 'side']);
});
check('source finish pixels, metadata and unknown states remain unchanged', () => {
  const faces = [face('front', 'front', finish([130, 70, 50])), face('top', 'top')], before = JSON.stringify(faces), result = run(faces);
  result[0].cleanColorSRGB[0] = 0; assert.equal(JSON.stringify(faces), before); assert.equal(faces[1].finish.status, 'unknown');
  assert.deepEqual(run([faces[0], { ...faces[1], id: faces[0].id }]), []);
});
console.log(`${passed} same-cabinet finish completion checks passed.`);
