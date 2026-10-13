import assert from 'node:assert/strict';
import sample from './fixtures/native-countertop-contours.sample.json';
import { importNativeScan } from '../src/lib/native/scan-import';
import { scannedRoomQuantities } from '../src/lib/native/scan-geometry';
import { scannedWorkScope } from '../src/lib/estimate/scan-scope';
import { confirmScanTakeoff } from '../src/lib/native/scan-design';
import type { KitchenSpec, ScannedElement } from '../src/lib/spec/types';

const wall: ScannedElement = { id: 'wall', kind: 'wall', confidence: 'high', dimensions: { x: 4, y: 3, z: 0 }, transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,1.5,0,1] };
const quantity = (element: ScannedElement) => scannedRoomQuantities({ version: 1, objects: [], surfaces: [element] });
assert.equal(quantity(wall).incompleteWallCoverage, false);
assert.equal(quantity({ ...wall, completedEdges: ['bottom','left','top','right'] }).incompleteWallCoverage, false);
for (const completedEdges of [[], ['top'], ['top','bottom','left']] as const) assert.equal(quantity({ ...wall, completedEdges: [...completedEdges] }).incompleteWallCoverage, true);
const curved: ScannedElement = { ...wall, completedEdges: ['top','right','bottom','left'], curve: { center: { x: 0, y: 0 }, radius: 2, startAngleRadians: 0, endAngleRadians: Math.PI / 2 } };
const before = JSON.stringify(curved); assert.equal(quantity(curved).incompleteWallCoverage, true); assert.equal(JSON.stringify(curved), before);
console.log('PASS completed edge and curved-wall metadata cannot imply complete quantities');

const project = importNativeScan(structuredClone(sample)).project;
const spec = project.spec as KitchenSpec;
spec.scanGeometry!.surfaces.find(s => s.kind === 'wall')!.completedEdges = ['bottom'];
const original = JSON.stringify(spec.scanGeometry);
assert.ok(scannedWorkScope(spec, project.selections, project.estimateSettings, project.baseline).fullUnpriced.some(w => w.slot === 'walls'));
const reviewed = confirmScanTakeoff(spec, { id: 'walls-measured', slot: 'walls', objectIds: ['room-walls'], quantity: 320, unit: 'sqft', confirmedAt: '2026-09-12T12:00:00.000Z', note: 'Synthetic independent net paintable area.' });
assert.ok(!scannedWorkScope(reviewed, project.selections, project.estimateSettings, project.baseline).fullUnpriced.some(w => w.slot === 'walls'));
assert.equal(JSON.stringify(reviewed.scanGeometry), original);
console.log('PASS independent reviewed wall area resolves missing coverage without stretching source');
