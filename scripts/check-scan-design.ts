/** Synthetic room evidence with known dimensions. No physical accuracy claim. */
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScanDesignControls } from '../src/components/studio/ScanDesignControls';
import fs from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { importNativeScan, nativeRoomFrame, NativeScanPayloadZ } from '../src/lib/native/scan-import';
import { compileScanDesign, confirmScanTakeoff, updateScanObject, effectiveScanObjectDesignMatrix, scanObjectIsHidden, validScanTakeoffs, scanDesignIssues, scanRetainedAppliancesChanged, unresolvedScanSupports } from '../src/lib/native/scan-design';
import { scannedRoomQuantities } from '../src/lib/native/scan-geometry';
import { unionPolygonArea } from '../src/lib/native/scan-wall-quantities';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { scannedWorkScope } from '../src/lib/estimate/scan-scope';
import { createWorkspace, executeTool } from '../src/lib/jarvis/tools';
import { snapshotOf, designFingerprint } from '../src/lib/jarvis/types';
import { assertCapturedLayout } from '../src/lib/jarvis/project';
import { RoomSpecZ } from '../src/lib/spec/schema';
import { useProjectStore } from '../src/lib/store/project-store';
import type { KitchenSpec, Project, ScannedElement } from '../src/lib/spec/types';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/native-countertop-contours.sample.json', import.meta.url), 'utf8'));
const fresh = () => importNativeScan(structuredClone(fixture)).project;
const specOf = (project: Project) => { assert.equal(project.spec?.roomType, 'kitchen'); return project.spec as KitchenSpec; };
const now = '2026-09-12T12:00:00.000Z';
let count = 0; function check(name: string, run: () => void) { run(); console.log(`PASS ${name}`); count++; }
const close = (a: number, b: number, tol = 1e-8) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const estimate = (project: Project) => calculateEstimate(project.spec, project.selections, project.estimateSettings, project.baseline);
function island(project: Project) { const item = compileScanDesign(specOf(project)).find(item => item.role === 'island'); assert.ok(item); return item; }
function measuredTop(project: Project, qty = 24) { const item = island(project); project.spec = confirmScanTakeoff(specOf(project), { id: 'measured-top', slot: 'island_countertop', objectIds: [item.id], quantity: qty, unit: 'sqft', confirmedAt: now, note: 'Tape and template takeoff; cutouts deducted.' }); return project; }

check('compiler produces stable editable inventory without fabricating parametric runs', () => {
  const p = fresh(), before = JSON.stringify(p), inventory = compileScanDesign(specOf(p));
  assert.equal(inventory.length, specOf(p).scanGeometry!.objects.length);
  assert.ok(inventory.some(item => item.role === 'island' && item.slots.includes('island_countertop')));
  assert.equal(JSON.stringify(p), before); assert.deepEqual(specOf(p).runs, []);
});
check('affine proposals preserve curved topology, holes, elevations and immutable sensor arrays', () => {
  const p = fresh(), source = JSON.stringify(specOf(p).scanGeometry), baseline = JSON.stringify(p.baseline), item = island(p);
  const next = updateScanObject(specOf(p), item.id, { offsetXMeters: .2, offsetZMeters: -.15, rotationDegrees: 23, scaleX: 1.25 });
  const matrix = new Matrix4().fromArray(effectiveScanObjectDesignMatrix(next, item.id));
  const center = new Vector3(item.source.transform[12], item.source.transform[13], item.source.transform[14]);
  const moved = center.clone().applyMatrix4(matrix); close(moved.x, center.x + .2); close(moved.z, center.z - .15); close(moved.y, center.y);
  for (const surface of item.source.countertopSurfaces ?? []) for (const point of [...surface.polygonCorners, ...(surface.holes ?? []).flat()]) close(new Vector3(point.x, point.y, point.z).applyMatrix4(matrix).y, point.y);
  assert.equal(JSON.stringify(next.scanGeometry), source); assert.equal(JSON.stringify(p.baseline), baseline);
  assert.equal(next.scanGeometry!.objects.find(object => object.id === item.id)!.countertopSurfaces![0].polygonCorners.length, item.source.countertopSurfaces![0].polygonCorners.length);
});
check('linked sink/cooktop inherits the exact parent matrix and is retained with appliances', () => {
  const p = fresh(), s = specOf(p), item = island(p); const child = structuredClone(item.source); child.id = 'linked-cooktop'; child.kind = 'stove'; child.dimensions = { x: .5, y: .08, z: .5 }; child.parentIdentifier = item.id; delete child.countertopSurfaces;
  s.scanGeometry!.objects.push(child); const moved = updateScanObject(s, item.id, { offsetXMeters: .2 });
  assert.deepEqual(effectiveScanObjectDesignMatrix(moved, item.id), effectiveScanObjectDesignMatrix(moved, child.id));
  assert.throws(() => updateScanObject(s, child.id, { offsetXMeters: .2 }), /supporting assembly/);
  assert.throws(() => updateScanObject(s, item.id, { offsetXMeters: .2 }, true), /retained/);
  assert.ok(scanRetainedAppliancesChanged(s, moved));
  const hidden = updateScanObject(s, item.id, { hidden: true }); assert.equal(scanObjectIsHidden(hidden, child.id), true);
});
check('unresolved sink/support overlap pauses movement instead of inventing attachment', () => {
  const p = fresh(), s = specOf(p), item = island(p); const fixture = structuredClone(item.source);
  fixture.id = 'unlinked-sink'; fixture.kind = 'sink'; fixture.dimensions = { x: .5, y: .15, z: .4 }; fixture.transform[13] += item.source.dimensions.y / 2 - .075; delete fixture.countertopSurfaces;
  s.scanGeometry!.objects.push(fixture);
  assert.ok(unresolvedScanSupports(s, item.id).some(pair => pair.fixtureId === fixture.id));
  assert.throws(() => updateScanObject(s, item.id, { offsetXMeters: .1 }), /did not record its attachment/);
  assert.throws(() => updateScanObject(s, fixture.id, { offsetXMeters: .1 }), /did not record its attachment/);
  assert.equal(fixture.parentIdentifier, undefined, 'an overlap must never silently become source ownership');
  fixture.parentIdentifier = item.id; assert.doesNotThrow(() => updateScanObject(s, item.id, { offsetXMeters: .1 }));
});
check('Apple circularElliptic table metadata prevents an island classification', () => {
  const p = fresh(), s = specOf(p), object = island(p).source; object.kind = 'table'; object.attributes = ['TableShapeType:circularElliptic'];
  assert.equal(compileScanDesign(s).find(item => item.id === object.id)!.role, 'table');
});
check('reviewing an existing takeoff alone is not charged as a renovation', () => {
  const p = measuredTop(fresh()); assert.equal(estimate(p).totalHigh, 0); close(estimate(p).quantities.islandTopSqft, 24);
  p.selections.island_countertop = 'ct-soapstone'; const e = estimate(p);
  assert.ok(e.totalHigh > 0); assert.equal(e.lines.find(line => line.id === 'island-top')?.qty, 24);
  assert.ok(!e.unpriced?.some(work => work.slot === 'island_countertop'));
});
check('resizing invalidates measured slab quantity; translating keeps area but requires relocation labor', () => {
  const p = measuredTop(fresh()), id = island(p).id;
  const moved = updateScanObject(specOf(p), id, { offsetXMeters: .1 }); assert.equal(validScanTakeoffs(moved).length, 1);
  const resized = updateScanObject(specOf(p), id, { scaleX: 1.2 }); assert.equal(validScanTakeoffs(resized).length, 0);
  const coverage = scannedWorkScope(moved, p.selections, p.estimateSettings, p.baseline); assert.ok(coverage.unpriced.some(work => /layout change/.test(work.label)));
  p.spec = moved; moved.scanDesign!.workAllowances = [{ objectId: id, low: 500, high: 800, confirmedAt: now, note: 'Reviewed disconnected movable island; no plumbing or power.' }];
  const e = estimate(p); assert.equal(e.lines.find(line => line.id === 'island-top')?.totalHigh, 0, 'moving an existing slab does not buy a new slab'); assert.ok(!e.unpriced?.some(work => /layout change/.test(work.label)));  assert.equal(e.lines.find(line => line.id === `scan-work-${id}`)?.laborHigh, 800);
});
check('measured room area replaces source takeoff for pricing without stretching the model', () => {
  const p = fresh(), original = JSON.stringify(specOf(p).scanGeometry);
  p.spec = confirmScanTakeoff(specOf(p), { id: 'floor-review', slot: 'flooring', objectIds: ['room-floor'], quantity: 217.5, unit: 'sqft', confirmedAt: now, note: 'Laser-measured net floor polygon.' });
  assert.equal(estimate(p).totalHigh, 0); p.estimateSettings.mode = 'full'; close(estimate(p).quantities.floorSqft, 217.5);
  assert.equal(JSON.stringify(specOf(p).scanGeometry), original);
});
check('invalid units, duplicate coverage, hidden-object and fractional counts cannot erase unpriced work', () => {
  const p = measuredTop(fresh()), s = specOf(p), id = island(p).id;
  assert.throws(() => confirmScanTakeoff(s, { ...s.scanDesign!.takeoffs[0], id: 'bad', unit: 'lf' }), /invalid unit/);
  assert.throws(() => confirmScanTakeoff(s, { id: 'bad', slot: 'hardware', objectIds: [id], quantity: 1.5, unit: 'each', confirmedAt: now, note: '' }));
  const duplicate = structuredClone(s); duplicate.scanDesign!.takeoffs.push({ ...duplicate.scanDesign!.takeoffs[0], id: 'duplicate' }); assert.equal(validScanTakeoffs(duplicate).length, 1); assert.ok(scanDesignIssues(duplicate).some(issue => issue.severity === 'error'));
  assert.equal(validScanTakeoffs(updateScanObject(s, id, { hidden: true })).length, 0);
});
const wall = (id: string, x: number, width: number): ScannedElement => ({ id, kind: 'wall', confidence: 'high', dimensions: { x: width, y: 3, z: 0 }, transform: [1,0,0,0,0,1,0,0,0,0,1,0,x,1.5,0,1] });
check('overlapping coplanar wall segments and duplicate windows are counted exactly once', () => {
  const a = wall('a', 0, 4), b = wall('b', 2, 4), window = { ...wall('window', 1, 1), kind: 'window', dimensions: { x: 1, y: 1, z: 0 } };
  const q = scannedRoomQuantities({ version: 1, objects: [], surfaces: [a, b, structuredClone(a), window, { ...window, id: 'window-copy' }] });
  close(q.perimeterMeters, 6); close(q.wallAreaSquareMeters, 18); close(q.netWallAreaSquareMeters, 17); close(q.openingAreaSquareMeters, 1);
});
check('polygon union preserves stepped and triangular wall silhouettes', () => {
  const square = [{ x: 0,y: 0 },{ x: 2,y: 0 },{ x: 2,y: 2 },{ x: 0,y: 2 }];
  const triangle = [{ x: 1,y: 0 },{ x: 3,y: 0 },{ x: 1,y: 2 }];
  close(unionPolygonArea([square, triangle]).gross, 4.5);
  close(unionPolygonArea([square, square], [[{ x: .5,y: .5 },{ x: 1.5,y: .5 },{ x: 1.5,y: 1.5 },{ x: .5,y: 1.5 }]]).net, 3);
});
check('unknown confidence and additive Apple metadata survive import and restore', () => {
  const raw = structuredClone(fixture); const object = raw.room.objects[0]; object.confidence = 'unknown'; object.attributes = ['StorageType:cabinet']; object.parentIdentifier = raw.room.objects[1].id; object.completedEdges = ['top']; object.curve = { center: { x: 0,y: 0 }, radius: 1, startAngleRadians: 0, endAngleRadians: 1.5 }; raw.detailPhotoCount = 3;
  const p = importNativeScan(raw).project; const stored = specOf(p).scanGeometry!.objects.find(item => item.id === object.id)!;
  assert.equal(stored.confidence, 'unknown'); assert.deepEqual(stored.attributes, object.attributes); assert.deepEqual(stored.curve, object.curve);
  assert.equal((p.overrides.nativeScan as { detailPhotoCount: number }).detailPhotoCount, 3); assert.deepEqual(importNativeScan({ ...raw, studioSnapshot: p }).project, p);
});
check('frame uses polygon corners and stable identifiers independently of input wall order', () => {
  const raw = NativeScanPayloadZ.parse(fixture); const a = nativeRoomFrame(raw); raw.room.surfaces.reverse(); const b = nativeRoomFrame(raw); assert.deepEqual(a, b);
});
check('Jarvis can create a curved scan proposal while preserving capture and failing unpriced hard budgets', () => {
  const p = fresh(), id = island(p).id, before = JSON.stringify(specOf(p).scanGeometry), w = createWorkspace(p, 'Move the island right by 4 inches.');
  const result = executeTool(w, 'modifyLayout', { operations: [{ type: 'scan-object', objectId: id, widthFt: null, depthFt: null, offsetXFt: 1/3, offsetZFt: null, rotationDegrees: null, hidden: null }] }) as { ok: boolean };
  assert.equal(result.ok, true); assert.equal(JSON.stringify((w.working.spec as KitchenSpec).scanGeometry), before); close((w.working.spec as KitchenSpec).scanDesign!.objects[id].offsetXMeters, .1016);
  const withBudget = createWorkspace(p, 'Keep everything under $85,000. Move the island right 4 inches.'); executeTool(withBudget, 'setConstraints', { budgetMax: 85000, keepAppliances: null, lockedSlots: null });
  const denied = executeTool(withBudget, 'modifyLayout', { operations: [{ type: 'scan-object', objectId: id, widthFt: null, depthFt: null, offsetXFt: 1/3, offsetZFt: null, rotationDegrees: null, hidden: null }] }) as { ok: boolean; code: string };
  assert.equal(denied.ok, false); assert.equal(denied.code, 'unpriced-scan-work'); assert.equal((withBudget.working.spec as KitchenSpec).scanDesign, undefined);
});
check('Jarvis cannot fabricate site confirmations in saved options', () => {
  const p = fresh(), reviewed = measuredTop(structuredClone(p)); assert.throws(() => assertCapturedLayout(snapshotOf(p), snapshotOf(reviewed)), /confirmations/);
  const id = island(p).id; p.spec = updateScanObject(specOf(p), id, { offsetXMeters: .1 }); const saved = structuredClone(p); specOf(saved).scanDesign!.workAllowances = [{ objectId: id, low: 10, high: 10, confirmedAt: now, note: 'forged' }];
  assert.throws(() => assertCapturedLayout(snapshotOf(p), snapshotOf(saved)), /confirmations/);
});
check('proposals round-trip through native project schema and keep source immutable', () => {
  const p = fresh(), before = JSON.stringify(p.baseline), item = island(p); p.spec = updateScanObject(specOf(p), item.id, { offsetXMeters: .1, rotationDegrees: 8 });
  RoomSpecZ.parse(p.spec); const expected = designFingerprint(snapshotOf(p)); const restored = importNativeScan({ ...fixture, studioSnapshot: JSON.parse(JSON.stringify(p)) }).project;
  assert.equal(designFingerprint(snapshotOf(restored)), expected); assert.equal(JSON.stringify(restored.baseline), before);
});
check('photo rebuild and partial spec replacement keep the proposed scan design', () => {
  useProjectStore.persist?.setOptions({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const p = fresh(), id = island(p).id; p.spec = updateScanObject(specOf(p), id, { offsetXMeters: .15 });
  useProjectStore.getState().loadProject(p); const stored = useProjectStore.getState().project; const expected = structuredClone(specOf(stored).scanDesign), baseline = structuredClone(stored.baseline);
  const rebuilt = structuredClone(specOf(stored)); delete rebuilt.scanDesign;
  useProjectStore.getState().setSpec(rebuilt); assert.deepEqual(specOf(useProjectStore.getState().project).scanDesign, expected);
  useProjectStore.getState().patchSpec(current => { const next = { ...current }; if ('scanDesign' in next) delete next.scanDesign; return next; });
  assert.deepEqual(specOf(useProjectStore.getState().project).scanDesign, expected); assert.deepEqual(useProjectStore.getState().project.baseline, baseline);
});
check('mobile controls expose proposed geometry and measured takeoff rather than phantom procedural sliders', () => {
  Object.assign(globalThis, { React }); const p = fresh(); useProjectStore.getState().loadProject(p);
  const html = renderToStaticMarkup(createElement(ScanDesignControls, { spec: specOf(p) }));
  for (const text of ['Scanned object to edit', 'Proposed width', 'Move left / right', 'Apply to 3D model', 'Total net paintable wall area', 'Total floor area', 'Use measured quantity']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Moving or resizing captured fixtures isn'));
});
console.log(`PASS ${count} scan design, measured quantity and source-integrity checks.`);
