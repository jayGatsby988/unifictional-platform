import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';
import { ScannedRoomGeometryZ, jsonSchemaFor } from '../src/lib/spec/schema';
import { defaultBathroom, defaultKitchen } from '../src/lib/spec/defaults';
import { rawJsonSchema, sanitizeShape } from '../src/lib/ai/sanitize';
import { scannedRoomRig } from '../src/components/scene/scanned-camera';
import { fitCameraRig } from '../src/components/scene/camera-fit';
import { computeKitchenLayout } from '../src/components/scene/kitchen/layout';
import { buildKitchenPartsRaw } from '../src/components/scene/kitchen/build';
import { isSimpleScanPolygon, openingOnScannedWall, scannedFloorGeometry, scannedWallArea, scannedWallGeometry, scannedWallInteriorSign, scannedWallOutline } from '../src/components/scene/scanned-geometry';

let count = 0;
const check = (name: string, fn: () => void) => { fn(); count++; console.log(`PASS ${name}`); };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);
function element(id: string, kind: string, width: number, height: number, x = 0, y = 1.5, z = 0, yaw = 0): ScannedElement {
  const matrix = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  return { id, kind, dimensions: { x: width, y: height, z: 0 }, transform: matrix.toArray(), confidence: 'high' };
}
function surfaceArea(geometry: THREE.BufferGeometry, doubleSided = false): number {
  const p = geometry.getAttribute('position'), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    total += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  geometry.dispose();
  return total / (doubleSided ? 2 : 1);
}
const wall = element('wall', 'wall', 4, 3);
const scan: ScannedRoomGeometry = { version: 1, surfaces: [wall], objects: [] };

check('a door reaching the floor leaves no artificial strip under the opening', () => {
  const door = element('door', 'door', 1, 2, 0, 1);
  close(surfaceArea(scannedWallGeometry(wall, [door]), true), 10);
});
check('one window cuts both split wall segments without stretching either', () => {
  const window = element('window', 'window', 1, 1);
  const left = element('left', 'wall', 2, 3, -1), right = element('right', 'wall', 2, 3, 1);
  close(surfaceArea(scannedWallGeometry(left, [window]), true), 5.5);
  close(surfaceArea(scannedWallGeometry(right, [window]), true), 5.5);
});
check('overlapping opening detections subtract their union only once', () => {
  const openings = [element('a', 'window', 1, 1), element('b', 'window', 1, 1, 0.5)];
  close(surfaceArea(scannedWallGeometry(wall, openings), true), 10.5);
  close(scannedWallArea(wall, openings), 10.5);
});
check('opening association tolerates real plane drift without altering the measured frame', () => {
  const window = element('window', 'window', 1, 1, 0, 1.5, 0.07, 0.025);
  const original = JSON.stringify(window);
  assert.ok(openingOnScannedWall(wall, window));
  close(surfaceArea(scannedWallGeometry(wall, [window]), true), 12 - Math.cos(0.025));
  assert.equal(JSON.stringify(window), original);
  assert.equal(openingOnScannedWall(wall, element('remote', 'door', 1, 2, 0, 1, 0.5)), null);
  assert.equal(openingOnScannedWall(wall, element('perpendicular', 'door', 1, 2, 0, 1, 0, Math.PI / 2)), null);
});
check('rotated and translated wall frames preserve true local opening area and height', () => {
  const tilted = element('angled', 'wall', 4, 2.85, 2, 1.425, -1, Math.PI / 7);
  const window = element('window', 'window', 1, 1, 2, 1.6, -1, Math.PI / 7);
  close(surfaceArea(scannedWallGeometry(tilted, [window]), true), 4 * 2.85 - 1);
});
check('concave floors retain their notch instead of filling a rectangular hull', () => {
  const floor = element('floor', 'floor', 4, 4, 0, 0);
  floor.polygonCorners = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]].map(([x, z]) => ({ x: x - 2, y: 0.12, z: z - 2 }));
  const mesh = scannedFloorGeometry(floor)!;
  assert.ok(mesh); close(surfaceArea(mesh), 7);
  floor.polygonCorners.reverse();
  close(surfaceArea(scannedFloorGeometry(floor)!), 7);
});
check('crossed, backtracking, missing and collapsed floor outlines remain unfilled', () => {
  for (const points of [[[0, 0], [4, 4], [4, 0], [0, 4]], [[0, 0], [3, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [1, 0], [2, 0]]]) {
    assert.equal(isSimpleScanPolygon(points.map(([x, y]) => ({ x, y }))), false);
    const floor = { ...element('bad', 'floor', 4, 4, 0, 0), polygonCorners: points.map(([x, z]) => ({ x, y: 0, z })) };
    assert.equal(scannedFloorGeometry(floor), null);
  }
  assert.equal(scannedFloorGeometry(element('missing', 'floor', 4, 4, 0, 0)), null);
});
check('wall polygon preserves a sloping measured top', () => {
  const sloped = structuredClone(wall);
  sloped.polygonCorners = [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: -2, y: 2, z: 0 }];
  close(surfaceArea(scannedWallGeometry(sloped, []), true), 10);
});
check('always-visible wall outlines retain only measured perimeter corners and exact heights', () => {
  const outline = scannedWallOutline(wall);
  assert.deepEqual(outline, [{ x: -2, y: -1.5, z: 0 }, { x: 2, y: -1.5, z: 0 }, { x: 2, y: 1.5, z: 0 }, { x: -2, y: 1.5, z: 0 }]);
  const shaped = structuredClone(wall);
  shaped.polygonCorners = [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }, { x: -2, y: 2.5, z: 0 }];
  const matrix = new THREE.Matrix4().fromArray(shaped.transform);
  assert.deepEqual(scannedWallOutline(shaped).map((p) => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(matrix).toArray()), shaped.polygonCorners.map((p) => [p.x, p.y, p.z]));
});
check('concave floor identifies the interior at a notch wall', () => {
  const floor = { ...element('floor', 'floor', 4, 4, 0, 0), polygonCorners: [[-2, -2], [2, -2], [2, -1], [-1, -1], [-1, 2], [-2, 2]].map(([x, z]) => ({ x, y: 0, z })) };
  const notch = element('notch', 'wall', 3, 3, 0.5, 1.5, -1);
  assert.equal(scannedWallInteriorSign(notch, { ...scan, surfaces: [notch, floor] }), -1);
});
check('runtime schema bounds malformed transforms and preserves measured geometry', () => {
  assert.deepEqual(ScannedRoomGeometryZ.parse(scan), scan);
  for (const value of [NaN, Infinity, 2000]) { const invalid = structuredClone(scan); invalid.surfaces[0].transform[12] = value; assert.equal(ScannedRoomGeometryZ.safeParse(invalid).success, false); }
  const scaled = structuredClone(scan); scaled.surfaces[0].transform[0] = 3; assert.equal(ScannedRoomGeometryZ.safeParse(scaled).success, false);
  const projective = structuredClone(scan); projective.surfaces[0].transform[3] = .1; assert.equal(ScannedRoomGeometryZ.safeParse(projective).success, false);
});
check('AI structured outputs never fabricate native scanGeometry', () => {
  for (const room of ['kitchen', 'bathroom'] as const) {
    assert.ok(!JSON.stringify(jsonSchemaFor(room)).includes('scanGeometry'));
    assert.ok(!JSON.stringify(rawJsonSchema(room)).includes('scanGeometry'));
  }
});
check('ordinary kitchen and bathroom repairs never acquire empty or AI-invented scan geometry', () => {
  for (const defaults of [defaultKitchen, defaultBathroom]) {
    const fallback = defaults();
    for (const raw of [{}, fallback, { ...fallback, scanGeometry: {} }, { ...fallback, scanGeometry: scan }]) {
      const output = sanitizeShape(raw, fallback.roomType, fallback, { fixes: [] }) as typeof fallback;
      assert.equal(Object.hasOwn(output, 'scanGeometry'), false);
    }
  }
});
check('refinement restores only valid source scan evidence and keeps its dimensions and openings', () => {
  for (const defaults of [defaultKitchen, defaultBathroom]) {
    const fallback = { ...defaults(), scanGeometry: structuredClone(scan) };
    const before = JSON.stringify(fallback);
    const replacement = structuredClone(scan); replacement.surfaces[0].dimensions.x += 2;
    for (const scanGeometry of [null, {}, replacement]) {
      const raw = { ...fallback, scanGeometry, dims: { widthFt: 40, depthFt: 30, ceilingFt: 15 }, openings: [], style: 'industrial' };
      const output = sanitizeShape(raw, fallback.roomType, fallback, { fixes: [] }) as typeof fallback;
      assert.deepEqual(output.scanGeometry, fallback.scanGeometry);
      assert.notEqual(output.scanGeometry, fallback.scanGeometry, 'sensor evidence is copied, not shared with model output');
      assert.deepEqual(output.dims, fallback.dims);
      assert.deepEqual(output.openings, fallback.openings);
      assert.equal(output.style, 'industrial', 'nonstructural design refinements still apply');
      assert.equal(JSON.stringify(fallback), before, 'source evidence remains unchanged');
    }
    const invalid = structuredClone(fallback); invalid.scanGeometry.surfaces[0].transform[0] = 1.01;
    const output = sanitizeShape({ ...fallback, scanGeometry: scan }, fallback.roomType, invalid, { fixes: [] }) as typeof fallback;
    assert.equal(Object.hasOwn(output, 'scanGeometry'), false, 'invalid fallback cannot authorize AI-supplied replacement geometry');
  }
});
check('scanned overview frames every actual bound on portrait and landscape canvases', () => {
  const room: ScannedRoomGeometry = { ...scan, surfaces: [element('back', 'wall', 5, 3, 0, 1.5, -2), element('side', 'wall', 4, 2.8, 2.5, 1.4, 0, Math.PI / 2)], objects: [{ ...element('cabinet', 'storage', 1, 2.2, -1.8, 1.1, 1.2, .2), dimensions: { x: 1, y: 2.2, z: .6 } }] };
  const initial = scannedRoomRig(room);
  assert.ok(initial.position[1] > initial.fitBounds!.max[1], 'the initial view starts above the captured walls');
  for (const aspect of [.35, .55, 1, 2.4]) {
    const fitted = fitCameraRig(initial, aspect), camera = new THREE.PerspectiveCamera(fitted.fov, aspect, .05, 1e5);
    camera.position.set(...fitted.position); camera.lookAt(...fitted.target); camera.updateMatrixWorld();
    const { min, max } = fitted.fitBounds!;
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(projected.x) <= .880001 && Math.abs(projected.y) <= .880001 && projected.z > -1 && projected.z < 1);
    }
    assert.ok(camera.position.distanceTo(new THREE.Vector3(...fitted.target)) <= fitted.maxDistance!, 'orbit controls can reach the fitted pose');
  }
});
check('scanned kitchens exclude the complete procedural rectangular shell', () => {
  const spec = defaultKitchen();
  const procedural = buildKitchenPartsRaw(computeKitchenLayout(spec));
  assert.ok(procedural.some((p) => p.key === 'wall-back'));
  const measured = buildKitchenPartsRaw(computeKitchenLayout({ ...spec, scanGeometry: scan }));
  assert.ok(!measured.some((p) => p.key.startsWith('wall-') || p.slot === 'flooring' || p.slot === 'ceiling'));
  assert.ok(measured.some((p) => p.slot === 'cabinets_base'), 'proposed fixtures remain editable');
});

async function storeChecks() {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } });
  const { useProjectStore } = await import('../src/lib/store/project-store');
  check('actual project store preserves source geometry through replacement, patches and measurement edits', () => {
    for (const defaults of [defaultKitchen, defaultBathroom]) {
      const source = { ...defaults(), scanGeometry: structuredClone(scan) };
      const before = JSON.stringify({ scanGeometry: source.scanGeometry, dims: source.dims, openings: source.openings });
      const sameEvidence = () => {
        const current = useProjectStore.getState().project.spec;
        assert.ok(current && (current.roomType === 'kitchen' || current.roomType === 'bathroom'));
        assert.equal(JSON.stringify({ scanGeometry: current.scanGeometry, dims: current.dims, openings: current.openings }), before);
      };
      useProjectStore.getState().newProject(source.roomType);
      useProjectStore.getState().setSpec(source);
      useProjectStore.getState().setSpec({ ...defaults(), style: 'industrial', dims: { widthFt: 30, depthFt: 25, ceilingFt: 15 }, scanGeometry: null, openings: [] });
      sameEvidence();
      assert.equal(useProjectStore.getState().project.spec!.style, 'industrial');
      useProjectStore.getState().patchSpec((current) => current.roomType === 'kitchen' || current.roomType === 'bathroom' ? { ...current, dims: { widthFt: 20, depthFt: 15, ceilingFt: 12 }, scanGeometry: null, openings: [] } : current);
      sameEvidence();
      useProjectStore.getState().confirmMeasurements({ widthFt: 40, depthFt: 35, ceilingFt: 16 });
      sameEvidence();
    }
  });
  console.log(`\n${count} scanned geometry checks passed.`);
}
storeChecks().catch((error) => { console.error(error); process.exitCode = 1; });
