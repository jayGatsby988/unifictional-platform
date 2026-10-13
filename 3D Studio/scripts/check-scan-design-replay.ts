/** Local saved-scan replay. Inputs remain on disk; no photos, meshes or room
 * identifiers are copied into this repository. This is not a tape-measure test.
 * Usage: tsx scripts/check-scan-design-replay.ts payload.json [studio.json] */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importNativeScan } from '../src/lib/native/scan-import';
import { compileScanDesign, updateScanObject, effectiveScanObjectDesignMatrix, unresolvedScanSupports } from '../src/lib/native/scan-design';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { designFingerprint, snapshotOf } from '../src/lib/jarvis/types';
import { Matrix4, Vector3 } from 'three';
const [payloadFile, snapshotFile] = process.argv.slice(2);
if (!payloadFile) throw new Error('Pass a saved native payload and optionally its Studio snapshot.');
const bytes = fs.readFileSync(payloadFile), payload = JSON.parse(bytes.toString('utf8'));
if (snapshotFile) payload.studioSnapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
const project = importNativeScan(payload).project, spec = project.spec;
assert.ok(spec && (spec.roomType === 'kitchen' || spec.roomType === 'bathroom') && spec.scanGeometry);
const source = JSON.stringify(spec.scanGeometry), baseline = JSON.stringify(project.baseline);
const inventory = compileScanDesign(spec);
const editable = inventory.filter(item => item.renderedInModel && !item.parentId && !unresolvedScanSupports(spec, item.id).length);
const object = editable.find(item => item.role === 'island') ?? editable.find(item => item.role === 'base-cabinet') ?? editable[0];
assert.ok(object, 'Expected one editable captured fixture in this regression input.');
const next = updateScanObject(spec, object.id, { offsetXMeters: .025, rotationDegrees: 5 });
const delta = new Matrix4().fromArray(effectiveScanObjectDesignMatrix(next, object.id));
const center = new Vector3(object.source.transform[12], object.source.transform[13], object.source.transform[14]);
assert.ok(Math.abs(center.clone().applyMatrix4(delta).x - center.x - .025) < 1e-8);
project.spec = next;
assert.equal(JSON.stringify(next.scanGeometry), source); assert.equal(JSON.stringify(project.baseline), baseline);
const beforeEstimate = JSON.stringify(project); calculateEstimate(next, project.selections, project.estimateSettings, project.baseline); assert.equal(JSON.stringify(project), beforeEstimate);
const restored = importNativeScan({ ...payload, studioSnapshot: JSON.parse(JSON.stringify(project)) }).project;
assert.equal(designFingerprint(snapshotOf(project)), designFingerprint(snapshotOf(restored)));
assert.equal(JSON.stringify(restored.baseline), baseline); assert.equal(fs.readFileSync(payloadFile).equals(bytes), true);
console.log(JSON.stringify({ status: 'passed', roomType: spec.roomType, surfaces: spec.scanGeometry.surfaces.length, objects: inventory.length, editableObjects: inventory.filter(item => item.renderedInModel && !item.parentId).length, restoredExistingSnapshot: Boolean(snapshotFile || payload.studioSnapshot), sourceUnchanged: true, baselineUnchanged: true, proposalRoundTrip: true }));
