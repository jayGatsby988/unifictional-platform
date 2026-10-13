import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAPTURED_FURNITURE_SLOT } from '../src/lib/native/captured-furniture';
import { scannedObjectLayout } from '../src/components/scene/scanned-object-layout';
import { scannedObjectParts } from '../src/components/scene/scanned-object-parts';
import { scannedCountertopParts } from '../src/components/scene/scanned-countertop-geometry';
import { observedMeshLayout } from '../src/components/scene/observed-mesh-layout';
import { createReconstructedObjectTextureSource, deriveReconstructedObjectTexture } from '../src/lib/native/reconstructed-object-texture';
import { deriveCleanFaceFinish } from '../src/lib/native/clean-face-finish';
import { scanSlotShowsDesign } from '../src/lib/native/scan-finishes';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { CATALOG_BY_ID, SLOT_META } from '../src/lib/materials/catalog';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import type { ObservedMesh } from '../src/lib/native/mesh-archive';
import type { ScanTexture } from '../src/lib/native/texture-archive';

let passed = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${++passed}: ${name}`); }
function element(kind = 'table', x = 0): ScannedElement {
  return { id: `synthetic-${kind}-${x}`, kind, confidence: 'high', dimensions: { x: .8, y: .75, z: .8 },
    attributes: kind === 'table' ? ['TableShapeType:rectangular', 'TableType:unidentified'] : undefined,
    transform: new THREE.Matrix4().setPosition(x, .375, 0).toArray() };
}
function fixture() {
  const scan: ScannedRoomGeometry = { version: 1, surfaces: [], objects: [element(), element('chair', 3)] };
  scan.objects[0].countertopSurfaces = [{ source: 'lidar-mesh', resolutionMeters: .015,
    polygonCorners: [{ x: -.4, y: .75, z: -.4 }, { x: .4, y: .75, z: -.4 }, { x: .4, y: .75, z: .4 }, { x: -.4, y: .75, z: .4 }] }];
  const points: number[] = [], coords: number[] = [], frames: number[] = [];
  for (const [index, x] of [0, 3].entries()) {
    points.push(x - .4, 0, .4, x + .4, 0, .4, x + .4, .75, .4, x - .4, 0, .4, x + .4, .75, .4, x - .4, .75, .4);
    points.push(x - .4, .75, -.4, x + .4, .75, -.4, x + .4, .75, .4, x - .4, .75, -.4, x + .4, .75, .4, x - .4, .75, .4);
    for (let face = 0; face < 2; face++) { coords.push(.01, .01, 1, .99, .01, 1, .99, .99, 1, .01, .01, 1, .99, .99, 1, .01, .99, 1); frames.push(index, index); }
  }
  const mesh: ObservedMesh = { version: 2, triangleCount: 8, coloredVertexCount: 24, wasLimited: false,
    positions: Float32Array.from(points), colors: new Float32Array(72), captured: new Float32Array(24).fill(1), bounds: { min: [-.4, 0, -.4], max: [3.4, .75, .4] } };
  const images = [[48, 44, 40], [29, 62, 139]].map(rgb => { const rgba = new Uint8Array(64 * 64 * 4); for (let i = 0; i < rgba.length; i += 4) rgba.set([...rgb, 255], i); return { width: 64, height: 64, rgba }; });
  const texture: ScanTexture = { geometrySHA256: '0'.repeat(64), triangleCount: 8, texturedTriangleCount: 8, coordinates: Float32Array.from(coords), frameIndices: Int16Array.from(frames), images };
  return { scan, mesh, texture };
}

check('generic furniture retains its role and geometry without guessed wood, fabric or cabinet finish slots', () => {
  for (const kind of ['table', 'chair', 'sofa', 'bed', 'unidentified']) {
    const scan: ScannedRoomGeometry = { version: 1, surfaces: [], objects: [element(kind)] }, before = JSON.stringify(scan);
    const object = scannedObjectLayout(scan, 'kitchen').objects[0];
    for (const simplifiedSolids of [false, true]) {
      const parts = scannedObjectParts(object, { simplifiedSolids });
      assert.ok(parts.length); assert.ok(parts.every(part => part.slot === CAPTURED_FURNITURE_SLOT && !part.util));
      if (kind === 'table') { assert.equal(object.role, 'table'); assert.ok(parts.some(part => part.name === 'table-top')); assert.equal(parts.length, 5); }
    }
    assert.equal(JSON.stringify(scan), before);
  }
});
check('measured furniture tops and tiny detections cannot bypass the evidence-only finish path', () => {
  const { scan } = fixture(), object = scannedObjectLayout(scan, 'kitchen').objects[0], before = JSON.stringify(scan);
  const original = scannedCountertopParts(object)!;
  const parts = scannedObjectParts(object, { simplifiedSolids: false });
  assert.ok(parts.length && parts.every(part => part.slot === CAPTURED_FURNITURE_SLOT && !part.util));
  assert.deepEqual(parts.map(part => Array.from(part.geometry.getAttribute('position').array)), original.map(part => Array.from(part.geometry.getAttribute('position').array)));
  const tiny = { ...object, countertopSurfaces: undefined, dimensions: { x: .1, y: .1, z: .1 } };
  const tinyParts = scannedObjectParts(tiny); assert.equal(tinyParts.length, 1); assert.equal(tinyParts[0].slot, CAPTURED_FURNITURE_SLOT); assert.equal(tinyParts[0].util, undefined);
  assert.equal(JSON.stringify(scan), before);
});
check('body and measured top facets enter the same furniture evidence channel without modifying source geometry', () => {
  const { mesh, scan } = fixture(), before = [...mesh.positions], layout = observedMeshLayout(mesh, scan, 'kitchen');
  assert.equal(layout.visibleTriangles, 8); assert.equal(layout.groups.length, 2);
  assert.ok(layout.groups.every(group => group.slot === CAPTURED_FURNITURE_SLOT));
  assert.equal(layout.groups.reduce((sum, group) => sum + group.indices.length, 0), 24);
  assert.deepEqual([...mesh.positions], before);
});
check('own camera colors reach furniture faces and never borrow the neighboring object or cabinet slot', () => {
  const { mesh, scan, texture } = fixture();
  const source = createReconstructedObjectTextureSource(mesh, texture, scan, 'kitchen'); assert.ok(source);
  for (const [index, x] of [0, 3].entries()) {
    const plane = { objectId: scan.objects[index].id, slot: CAPTURED_FURNITURE_SLOT, origin: [x - .4, 0, .4] as [number, number, number], u: [1, 0, 0] as [number, number, number], v: [0, 1, 0] as [number, number, number], spanMeters: [.8, .75] as [number, number] };
    const face = deriveReconstructedObjectTexture(source, plane); assert.equal(face.status, 'supported'); if (face.status !== 'supported') continue;
    const finish = deriveCleanFaceFinish({ ...face, slot: plane.slot }); assert.equal(finish.status, 'supported');
    if (finish.status === 'supported') { assert.deepEqual(finish.cleanColorSRGB, index === 0 ? [48, 44, 40] : [29, 62, 139]); assert.equal(finish.finishKind, 'surface'); }
    assert.equal(deriveReconstructedObjectTexture(source, { ...plane, slot: 'cabinets_base' }).status, 'unknown');
    assert.equal(deriveReconstructedObjectTexture(source, { ...plane, origin: [x - .4, 0, -.4] }).status, 'unknown');
    assert.equal(deriveReconstructedObjectTexture(source, { ...plane, objectId: scan.objects[1 - index].id }).status, 'unknown');
  }
});
check('cabinet palette changes do not become furniture finishes or introduce a priced material', () => {
  const { scan } = fixture(), spec = defaultKitchen(); spec.scanGeometry = scan;
  const project = { spec, baseline: null, selections: { ...spec.materials, cabinets_base: 'cab-white-oak', countertop: 'counter-quartz-white' }, overrides: { scanAppearanceMode: 'design', scanReviewedFinishes: { cabinets_base: 'cab-white-oak', countertop: 'counter-quartz-white' } } };
  assert.equal(scanSlotShowsDesign(project, 'cabinets_base'), true);
  assert.equal(scanSlotShowsDesign(project, CAPTURED_FURNITURE_SLOT), false);
  assert.equal(Object.hasOwn(SLOT_META, CAPTURED_FURNITURE_SLOT), false); assert.equal(Object.hasOwn(CATALOG_BY_ID, CAPTURED_FURNITURE_SLOT), false);
  assert.ok(scannedObjectParts(scannedObjectLayout(scan, 'bathroom').objects[0], { simplifiedSolids: true }).every(part => part.slot === CAPTURED_FURNITURE_SLOT));
});
console.log(`${passed} captured furniture checks passed.`);
