/** Synthetic appearance evidence only: no private photos or room data. */
import assert from 'node:assert/strict';
import sample from './fixtures/native-countertop-contours.sample.json';
import { importNativeScan, NativeStudioProjectZ } from '../src/lib/native/scan-import';
import { ScanPhotoAnalysisZ, mergeScanPhotoFinishes, photoFinishAgreesWithFaces, scanPhotoFinishFor, scanPhotoFinishMatches, validateScanPhotoAnalysis, type ScanPhotoObservation } from '../src/lib/native/photo-finishes';
import { recordScanFinishChoices } from '../src/lib/native/scan-finishes';
import { getMaterial } from '../src/lib/materials/catalog';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { designFingerprint, snapshotOf } from '../src/lib/jarvis/types';
import { projectForSharing, scanShareAppearance, scanShareSnapshot } from '../src/lib/sharing/project';
import { defaultKitchen } from '../src/lib/spec/defaults';

let count = 0;
const check = (name: string, run: () => void) => { run(); count++; console.log(`PASS ${name}`); };
const fresh = () => importNativeScan(structuredClone(sample)).project;
const observation = (slot = 'cabinets_base', color = '#8f321a'): ScanPhotoObservation => ({
  observation: { slot, family: 'stained-wood', baseColorHex: color, accentColorHex: null, pattern: 'wood-grain', sheen: 'satin', moduleIn: { w: 6, h: 48 }, groutColorHex: null, description: 'Visible warm wood', visibility: 'clear', plankRun: 'diagonal' },
  confidence: 'high', photoIds: ['photo-a'], note: 'Approximate visible finish; lighting affects color.',
});
const analysis = (...observations: ScanPhotoObservation[]) => ({ observations, warnings: [] });
const apply = (project: ReturnType<typeof fresh>, ...selected: ScanPhotoObservation[]) => { project.overrides = { ...project.overrides, scanPhotoFinishes: mergeScanPhotoFinishes(project, selected) }; };
const sharedView = (project: ReturnType<typeof fresh>) => ({ version: 1, kind: 'viewport', imageUrl: '/uploads/viewport/synthetic.png', capturedAt: '2026-09-12T12:00:00.000Z', designFingerprint: designFingerprint(snapshotOf(project)), appearanceToken: scanShareAppearance(project) });

check('unregistered photos preserve appearance while discarding physical scale and photo-relative floor direction', () => {
  const raw = analysis(observation('flooring')), before = structuredClone(raw);
  const result = validateScanPhotoAnalysis(raw, ['flooring'], ['photo-a']);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].observation.baseColorHex, '#8f321a');
  assert.equal(result.observations[0].observation.moduleIn, null);
  assert.equal(result.observations[0].observation.plankRun, null);
  assert.deepEqual(raw, before);
});
check('conflicting duplicate slots are omitted regardless of provider order', () => {
  const a = observation(), b = observation('cabinets_base', '#eeeeee');
  for (const items of [[a, b], [b, a], [a, a]]) {
    const result = validateScanPhotoAnalysis(analysis(...items, observation('flooring')), ['cabinets_base', 'flooring'], ['photo-a']);
    assert.deepEqual(result.observations.map(item => item.observation.slot), ['flooring']);
    assert.match(result.warnings.join(' '), /omitted/);
  }
});
check('unavailable slots and invented or repeated photo references cannot become appearance evidence', () => {
  const repeated = observation('flooring'); repeated.photoIds = ['photo-a', 'photo-a'];
  const invented = observation('countertop'); invented.photoIds = ['photo-missing'];
  const result = validateScanPhotoAnalysis(analysis(observation('not-a-slot'), repeated, invented, observation()), ['flooring', 'countertop', 'cabinets_base'], ['photo-a']);
  assert.deepEqual(result.observations.map(item => item.observation.slot), ['cabinets_base']);
  assert.equal(result.warnings.length, 1);
});
check('strict malformed provider responses fail and generated warnings remain schema bounded', () => {
  assert.throws(() => validateScanPhotoAnalysis({ ...analysis(observation()), extra: true }, ['cabinets_base'], ['photo-a']));
  assert.throws(() => validateScanPhotoAnalysis(analysis({ ...observation(), confidence: 'certain' } as never), ['cabinets_base'], ['photo-a']));
  const slots = Array.from({ length: 10 }, (_, i) => `${i}${'x'.repeat(49)}`);
  const result = validateScanPhotoAnalysis({ observations: slots.flatMap(slot => [observation(slot), observation(slot)]), warnings: Array(12).fill('Original warning') }, slots, ['photo-a']);
  assert.equal(result.observations.length, 0); assert.equal(result.warnings.length, 12);
  ScanPhotoAnalysisZ.parse(result);
});
check('low and inferred matches stay unapplied while partial supported observations remain available', () => {
  const low = observation(); low.confidence = 'low';
  const inferred = observation('countertop'); inferred.observation.visibility = 'inferred';
  const partial = observation('flooring'); partial.confidence = 'medium'; partial.observation.visibility = 'partial';
  const project = fresh(); apply(project, low, inferred, partial);
  assert.deepEqual(scanPhotoFinishMatches(project).map(item => item.observation.slot), ['flooring']);
});
check('merge updates requested slots without mutating prior evidence, selections, geometry or quantities', () => {
  const project = fresh(); apply(project, observation(), observation('flooring'));
  const before = structuredClone(project), selected = [observation('cabinets_base', '#bf9065')], selectedBefore = structuredClone(selected);
  const merged = mergeScanPhotoFinishes(project, selected);
  assert.deepEqual(project, before); assert.deepEqual(selected, selectedBefore);
  assert.equal(merged.matches.find(item => item.observation.slot === 'cabinets_base')?.observation.baseColorHex, '#bf9065');
  assert.equal(merged.matches.find(item => item.observation.slot === 'flooring')?.observation.baseColorHex, '#8f321a');
  assert.deepEqual(mergeScanPhotoFinishes(project, [observation(), observation('cabinets_base', '#eeeeee')]), mergeScanPhotoFinishes(project, []));
  assert.deepEqual(mergeScanPhotoFinishes(project, Array(21).fill(observation())), mergeScanPhotoFinishes(project, []));
  assert.deepEqual(mergeScanPhotoFinishes({ ...project, spec: defaultKitchen() }, selected).matches, []);
});
check('persisted duplicates remain unknown and legacy pose-relative metadata is sanitized without rewriting it', () => {
  const project = fresh(); project.overrides.scanPhotoFinishes = { version: 1, matches: [observation(), observation('cabinets_base', '#ffffff'), observation('flooring')] };
  const before = structuredClone(project);
  const matches = scanPhotoFinishMatches(project);
  assert.deepEqual(matches.map(item => item.observation.slot), ['flooring']);
  assert.equal(matches[0].observation.moduleIn, null); assert.equal(matches[0].observation.plankRun, null);
  assert.deepEqual(project, before);
});
check('a reviewed photo can correct uniformly wrong captured color', () => {
  assert.equal(photoFinishAgreesWithFaces(observation().observation, [[245, 245, 245], [240, 240, 240]]), true);
  assert.equal(photoFinishAgreesWithFaces(observation().observation, []), true);
  assert.equal(photoFinishAgreesWithFaces(observation('island_cabinets').observation, [[245, 245, 245]], { objectColors: [[245, 245, 245], [240, 240, 240]] }), true);
});
check('a front-only wood match preserves a distinct cream island back and unseen island faces', () => {
  const item = observation('island_cabinets').observation, cherry = [143, 50, 26], cream = [239, 232, 211];
  assert.equal(photoFinishAgreesWithFaces(item, [cherry, cream]), false);
  assert.equal(photoFinishAgreesWithFaces(item, [cream], { objectColors: [cherry, cream] }), false);
  assert.equal(photoFinishAgreesWithFaces(item, [cherry], { objectColors: [cherry, cream] }), true);
  assert.equal(photoFinishAgreesWithFaces(item, [cream]), false);
  assert.equal(photoFinishAgreesWithFaces(item, [], { objectColors: [cherry, cherry] }), false);
  assert.equal(photoFinishAgreesWithFaces(item, [cream], { objectColors: [cherry, cherry] }), false, 'local evidence participates even when whole-object summary missed the back');
});
check('invalid face summaries cannot enable a photo override', () => {
  const item = observation().observation;
  for (const colors of [[[NaN, 0, 0]], [[-1, 0, 0]], [[256, 0, 0]], [[0, 0]], Array(65).fill([0, 0, 0])]) assert.equal(photoFinishAgreesWithFaces(item, colors), false);
  assert.equal(photoFinishAgreesWithFaces({ ...item, baseColorHex: 'red' }, []), false);
  assert.equal(photoFinishAgreesWithFaces(item, [], { objectColors: [[Infinity, 0, 0]] }), false);
});
check('material matches regenerate identically after reopening without changing source geometry or estimator state', () => {
  const project = fresh(), before = structuredClone(project), fingerprint = designFingerprint(snapshotOf(project));
  const estimate = calculateEstimate(project.spec, project.selections, project.estimateSettings, project.baseline);
  apply(project, observation());
  const match = scanPhotoFinishFor(project, 'cabinets_base'); assert.ok(match); assert.ok(getMaterial(match.id));
  NativeStudioProjectZ.parse(project);
  const restored = importNativeScan({ ...structuredClone(sample), studioSnapshot: JSON.parse(JSON.stringify(project)) }).project;
  assert.deepEqual(scanPhotoFinishFor(restored, 'cabinets_base'), match);
  assert.deepEqual(restored.spec, before.spec); assert.deepEqual(restored.baseline, before.baseline);
  assert.deepEqual(restored.selections, before.selections);
  assert.equal(designFingerprint(snapshotOf(project)), fingerprint);
  assert.deepEqual(calculateEstimate(project.spec, project.selections, project.estimateSettings, project.baseline), estimate);
});
check('photo appearance invalidates stale shared images but explicit remodel choices mask dormant photo matches', () => {
  const project = fresh(), before = scanShareAppearance(project);
  project.overrides.sharedScanView = sharedView(project); assert.ok(scanShareSnapshot(project));
  apply(project, observation()); assert.notEqual(scanShareAppearance(project), before); assert.equal(scanShareSnapshot(project), null);
  project.overrides.sharedScanView = sharedView(project); assert.ok(scanShareSnapshot(project));
  project.overrides = recordScanFinishChoices(project, project.selections, ['cabinets_base']);
  const explicit = scanShareAppearance(project); apply(project, observation('cabinets_base', '#dddddd'));
  assert.equal(scanShareAppearance(project), explicit);
});
check('a client share retains the reviewed appearance fingerprint without private photo bytes', () => {
  const project = fresh(); apply(project, observation()); project.overrides.sharedScanView = sharedView(project);
  const before = structuredClone(project), shared = projectForSharing(project);
  assert.ok(scanShareSnapshot(shared)); assert.equal(scanShareAppearance(shared), scanShareAppearance(project));
  assert.deepEqual(project, before); assert.equal(JSON.stringify(shared).includes('data:image'), false);
});
check('same catalog match with different face eligibility invalidates the saved image', () => {
  const project = fresh(), a = observation('island_cabinets', '#64645a'), b = observation('island_cabinets', '#6e5a50');
  const colors = [[110, 45, 20]], objectColors = [[110, 45, 20], [240, 230, 210]];
  assert.equal(photoFinishAgreesWithFaces(a.observation, colors, { objectColors }), false);
  assert.equal(photoFinishAgreesWithFaces(b.observation, colors, { objectColors }), true);
  apply(project, a); const first = scanPhotoFinishFor(project, 'island_cabinets')!.id;
  project.overrides.sharedScanView = sharedView(project); const token = scanShareAppearance(project);
  apply(project, b); assert.equal(scanPhotoFinishFor(project, 'island_cabinets')!.id, first);
  assert.notEqual(scanShareAppearance(project), token); assert.equal(scanShareSnapshot(project), null);
  const upperCase = structuredClone(b); upperCase.observation.baseColorHex = b.observation.baseColorHex.toUpperCase();
  const lowerToken = scanShareAppearance(project); apply(project, upperCase); assert.equal(scanShareAppearance(project), lowerToken);
});
console.log(`Scan photo finish checks: ${count} passed.`);
