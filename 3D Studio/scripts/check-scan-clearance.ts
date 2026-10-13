/** Synthetic layout review, not a physical clearance certification. */
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Matrix4, Vector3 } from 'three';
import { defaultKitchen } from '../src/lib/spec/defaults';
import type { KitchenSpec, ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import { scannedObjectLayout } from '../src/components/scene/scanned-object-layout';
import { scanProposalClearanceIssues } from '../src/lib/native/scan-proposal-clearance';
import { scanDesignIssues, updateScanObject, effectiveScanObjectDesignMatrix, scanObjectIsHidden } from '../src/lib/native/scan-design';
import { validateDesign } from '../src/lib/jarvis/validation';
import { snapshotOf } from '../src/lib/jarvis/types';
import { importNativeScan } from '../src/lib/native/scan-import';
import { useProjectStore } from '../src/lib/store/project-store';
import { ScanDesignControls } from '../src/components/studio/ScanDesignControls';
import sample from './fixtures/native-countertop-contours.sample.json';

type P = { x: number; y: number; z: number };
const ring = (points: number[][], y = 0): P[] => points.map(([x, z]) => ({ x, y, z }));
const outer = ring([[-5, -4], [5, -4], [5, 4], [-5, 4]]);
function room(objects: ScannedElement[], outline = outer): ScannedRoomGeometry {
  const surfaces: ScannedElement[] = [{ id: 'floor', kind: 'floor', confidence: 'high', dimensions: { x: 10, y: 0, z: 8 }, transform: new Matrix4().toArray(), polygonCorners: structuredClone(outline) }];
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length], length = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(a.z - b.z, b.x - a.x);
    surfaces.push({ id: `wall-${i}`, kind: 'wall', confidence: 'high', dimensions: { x: length, y: 3, z: 0 }, transform: new Matrix4().makeRotationY(yaw).setPosition((a.x + b.x) / 2, 1.5, (a.z + b.z) / 2).toArray() });
  }
  return { version: 1, surfaces, objects };
}
function object(id: string, x: number, z: number, width = 1, depth = 1, yaw = 0): ScannedElement {
  return { id, kind: 'storage', confidence: 'high', dimensions: { x: width, y: .9, z: depth }, transform: new Matrix4().makeRotationY(yaw).setPosition(x, .45, z).toArray() };
}
function profile(item: ScannedElement, points: number[][], holes: number[][][] = []): ScannedElement {
  const matrix = new Matrix4().fromArray(item.transform), world = (points: number[][]) => ring(points, item.dimensions.y / 2).map(p => new Vector3(p.x, p.y, p.z).applyMatrix4(matrix)).map(p => ({ x: p.x, y: p.y, z: p.z }));
  item.countertopSurfaces = [{ polygonCorners: world(points), holes: holes.map(world), source: 'lidar-mesh', resolutionMeters: .015 }]; return item;
}
const bent = [[-1, -1], [1, -1], [1, 0], [0, 0], [0, 1], [-1, 1]];
const rectangle = (w: number, d: number) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
function spec(scan: ScannedRoomGeometry): KitchenSpec { return { ...defaultKitchen(), dims: { ...defaultKitchen().dims, widthFt: 10 / .3048, depthFt: 8 / .3048 }, scanGeometry: scan, scanDesign: { version: 1, objects: {}, takeoffs: [] } }; }
function review(s: KitchenSpec) {
  return scanProposalClearanceIssues(s.scanGeometry!, scannedObjectLayout(s.scanGeometry!, 'kitchen').objects.map(o => ({ object: o, label: o.id, delta: effectiveScanObjectDesignMatrix(s, o.id), hidden: scanObjectIsHidden(s, o.id), assemblyId: o.id === 'linked' ? 'island' : o.id })), { width: 10, depth: 8 });
}
function edited(s: KitchenSpec, id: string, edit: Partial<NonNullable<KitchenSpec['scanDesign']>['objects'][string]>) {
  return { ...s, scanDesign: { version: 1 as const, takeoffs: [], objects: { ...s.scanDesign!.objects, [id]: { offsetXMeters: 0, offsetZMeters: 0, rotationDegrees: 0, scaleX: 1, scaleZ: 1, hidden: false, ...edit } } } };
}
let count = 0;
function check(name: string, run: () => void) { run(); count++; console.log(`PASS ${name}`); }
const conflicts = (s: KitchenSpec) => review(s).filter(i => i.code === 'scan-fixture-overlap-risk');
check('a newly narrowed island gap warns with bounds provenance and no claimed measured aisle', () => {
  const s = spec(room([object('island', 0, 0, 2, 1), object('cabinet', 0, -2, 2, .6)]));
  assert.deepEqual(review(s), []);
  const issues = review(edited(s, 'island', { offsetZMeters: -.5 }));
  assert.equal(issues.length, 1); assert.equal(issues[0].code, 'scan-clearance-reduced'); assert.equal(issues[0].severity, 'warning'); assert.deepEqual(issues[0].objectIds, ['island', 'cabinet']);
  assert.match(issues[0].message, /detection bounds/); assert.match(issues[0].message, /not a measured clear aisle/);
});
check('unchanged, improved, and uniformly moved existing tight gaps do not create new warnings', () => {
  const s = spec(room([object('island', 0, 0, 2, 1), object('cabinet', 0, -1.3, 2, .6)]));
  assert.deepEqual(review(s), []); assert.deepEqual(review(edited(s, 'island', { offsetZMeters: .2 })), []);
  assert.deepEqual(review(edited(edited(s, 'island', { offsetXMeters: .2 }), 'cabinet', { offsetXMeters: .2 })), []);
});
check('touching edges are not intersections; moving further increases overlap', () => {
  const s = spec(room([object('island', 0, 0, 1, 1), object('cabinet', 2, 0, 1, 1)]));
  const touching = edited(s, 'island', { offsetXMeters: 1 }); assert.equal(conflicts(touching).length, 0);
  assert.equal(conflicts(edited(s, 'island', { offsetXMeters: 1.15 })).length, 1);
});
check('pre-existing detection overlap warns only if the proposed intersection increases', () => {
  const s = spec(room([object('island', 0, 0), object('cabinet', .8, 0)]));
  assert.equal(conflicts(edited(s, 'island', { offsetXMeters: -.1 })).length, 0);
  assert.equal(conflicts(edited(s, 'island', { offsetXMeters: .15 })).length, 1);
});
check('a rotated bent profile leaves its concave empty corner empty', () => {
  for (const yaw of [0, .61, Math.PI / 2]) {
    const base = profile(object('island', 0, 0, 2, 2, yaw), bent), obstacle = new Vector3(.65, .45, .65).applyMatrix4(new Matrix4().makeRotationY(yaw));
    const cabinet = object('cabinet', obstacle.x, obstacle.z, .3, .3, yaw), s = spec(room([base, cabinet]));
    const step = new Vector3(.05, 0, 0).applyMatrix4(new Matrix4().makeRotationY(yaw));
    assert.equal(conflicts(edited(s, 'island', { offsetXMeters: step.x, offsetZMeters: step.z })).length, 0, `bend lost at yaw ${yaw}`);
    const into = new Vector3(.9, 0, 0).applyMatrix4(new Matrix4().makeRotationY(yaw));
    assert.equal(conflicts(edited(s, 'island', { offsetXMeters: into.x, offsetZMeters: into.z })).length, 1);
  }
});
check('captured holes never become solid collision geometry', () => {
  const island = profile(object('island', 0, 0, 2, 2), rectangle(2, 2), [rectangle(.8, .8)]), cabinet = object('cabinet', 0, 0, .2, .2), s = spec(room([island, cabinet]));
  assert.equal(conflicts(edited(s, 'island', { offsetXMeters: .05 })).length, 0);
  assert.equal(conflicts(edited(s, 'island', { offsetXMeters: .5 })).length, 1);
});
check('a resized assembly retains linked fixtures and checks the child against independent obstacles', () => {
  const island = profile(object('island', 0, 0, 2, 1), rectangle(2, 1)), child = object('linked', .7, 0, .4, .4); child.kind = 'sink'; child.parentIdentifier = island.id;
  const s = spec(room([island, child, object('cabinet', 2, 0, .5, 1)]));
  const next = edited(s, island.id, { scaleX: 1.5, offsetXMeters: .5, rotationDegrees: 8 });
  const issues = review(next); assert.ok(issues.some(i => i.objectIds?.includes('cabinet')));
  assert.ok(!issues.some(i => i.objectIds?.includes('island') && i.objectIds?.includes('linked')));
  assert.deepEqual(effectiveScanObjectDesignMatrix(next, child.id), effectiveScanObjectDesignMatrix(next, island.id));
});
check('overhead fixtures and hidden assemblies do not block a lower island footprint', () => {
  const island = object('island', 0, 0, 2, 1), upper = object('upper', 1, 0, 1, .6); upper.dimensions.y = .6; upper.transform[13] = 2;
  const s = spec(room([island, upper])); assert.deepEqual(review(edited(s, island.id, { offsetXMeters: .2 })), []);
  assert.deepEqual(review(edited(s, island.id, { hidden: true })), []);
});
check('a proposal entering a room notch is blocked even inside overall width and depth', () => {
  const outline = ring([[-5, -4], [5, -4], [5, 4], [0, 4], [0, 0], [-5, 0]]), s = spec(room([object('island', -2, -1, 1, 1)], outline));
  const issues = review(edited(s, 'island', { offsetZMeters: 2 }));
  assert.ok(issues.some(i => i.code === 'scan-object-outside-room' && i.severity === 'error'));
});
check('a full profile crossing a notch is blocked even when its center and corners remain inside', () => {
  const outline = ring([[-5, -4], [5, -4], [5, 4], [1, 4], [1, 1], [0, 1], [0, 4], [-5, 4]]), slab = profile(object('island', -1, 0, 6, .4), rectangle(6, .4));
  // Its semantic role is base-cabinet here, which shares the same profile path.
  const s = spec(room([slab], outline)), next = edited(s, slab.id, { offsetZMeters: 2 });
  assert.ok(review(next).some(i => i.code === 'scan-object-outside-room' && i.severity === 'error'));
});
check('uncertain bounds crossing the floor is a risk warning and original floor overlap stays unchanged', () => {
  const s = spec(room([object('island', 4.2, 0, 1, 1)]));
  const issues = review(edited(s, 'island', { offsetXMeters: .5 }));
  assert.ok(issues.some(i => i.code === 'scan-room-boundary-risk' && i.severity === 'warning'));
  const overlapping = spec(room([object('island', 4.8, 0, 1, 1)])); assert.deepEqual(review(edited(overlapping, 'island', { offsetZMeters: .1 })), []);
});
check('a provisional floor and a tiny profile-edge discrepancy cannot claim definite room escape', () => {
  const outline = ring([[-5, -4], [5, -4], [5, 4], [0, 4], [0, 0], [-5, 0]]), s = spec(room([object('island', -2, -1)], outline));
  s.scanGeometry!.surfaces[0].confidence = 'low'; s.scanGeometry!.surfaces[0].id = 'inferred-floor-outline';
  assert.ok(review(edited(s, 'island', { offsetZMeters: 2 })).every(i => i.severity === 'warning'));
  const atEdge = profile(object('island', 4, 0, 2, 2), rectangle(2, 2));
  assert.ok(review(edited(spec(room([atEdge])), 'island', { offsetXMeters: .003 })).every(i => i.severity === 'warning'));
});
check('observed overhangs outside smaller detection bounds participate in proposal risk checks', () => {
  const island = object('island', 0, 0, 1, 1);
  island.countertopSurfaces = [{ polygonCorners: ring([[.5, -.3], [1.2, -.3], [1.2, .3], [.5, .3]], .9), source: 'lidar-mesh', resolutionMeters: .015 }];
  const s = spec(room([island, object('cabinet', 1.7, 0, .4, .4)]));
  assert.equal(conflicts(edited(s, island.id, { offsetXMeters: .4 })).length, 1);
});
check('bounded complexity yields an explicit unchecked warning and preserves all source geometry', () => {
  const objects = Array.from({ length: 129 }, (_, i) => object(`piece-${i}`, i / 10, 0, .2, .2)), s = spec(room(objects)), next = edited(s, objects[0].id, { offsetZMeters: .1 }), before = JSON.stringify(next.scanGeometry);
  assert.ok(review(next).some(i => i.code === 'scan-clearance-incomplete')); assert.equal(JSON.stringify(next.scanGeometry), before);
});
check('Layout and Jarvis expose the same actionable warning without modifying the scan or dimensions', () => {
  Object.assign(globalThis, { React });
  const s = spec(room([object('island', 0, 0, 2, 1), object('cabinet', 0, -2, 2, .6)])), original = JSON.stringify(s.scanGeometry), dims = JSON.stringify(s.dims);
  const next = updateScanObject(s, 'island', { offsetZMeters: -.5 }) as KitchenSpec, issues = scanDesignIssues(next);
  assert.ok(issues.some(i => i.code === 'scan-clearance-reduced')); assert.equal(JSON.stringify(next.scanGeometry), original); assert.equal(JSON.stringify(next.dims), dims);
  const p = importNativeScan(structuredClone(sample)).project; p.spec = next;
  const validation = validateDesign(snapshotOf(p)); assert.ok(validation.issues.some(i => i.code === 'scan-clearance-reduced')); assert.equal(validation.valid, true);
  useProjectStore.persist?.setOptions({ storage: { getItem: () => null, setItem() {}, removeItem() {} } }); useProjectStore.getState().loadProject(p);
  const html = renderToStaticMarkup(createElement(ScanDesignControls, { spec: next }));
  assert.ok(html.includes('Layout checks')); assert.ok(html.includes('Review island')); assert.ok(html.includes('model risk check, not a measured clear aisle'));
  p.spec = edited(s, 'island', { offsetXMeters: 6 });
  const outside = validateDesign(snapshotOf(p)); assert.equal(outside.valid, false); assert.ok(outside.issues.some(i => i.code === 'scan-object-outside-room'));
});
console.log(`Scan clearance checks: ${count} passed.`);
