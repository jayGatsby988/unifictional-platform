import assert from 'node:assert/strict';
import { deriveRoomAppearance } from '../src/lib/native/room-appearance';
import { srgbByteToLinear, type ObservedMesh } from '../src/lib/native/mesh-archive';
import type { ScannedElement, ScannedRoomGeometry } from '../src/lib/spec/types';

type Vec = [number, number, number];
type Facet = { points: Vec[]; color: Vec; captured?: number };
let checks = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${++checks}: ${name}`); }
const linear = (r: number, g: number, b: number): Vec => [r, g, b].map(srgbByteToLinear) as Vec;
const wallColor = linear(203, 204, 192), floorColor = linear(135, 94, 65), red = linear(220, 30, 25);
function element(id: string, kind: string, dimensions: Vec, position: Vec): ScannedElement {
  return { id, kind, dimensions: { x: dimensions[0], y: dimensions[1], z: dimensions[2] }, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...position, 1], confidence: 'high' };
}
const wall = element('wall', 'wall', [2, 2, 0], [1, 1, 0]);
const floor = { ...element('floor', 'floor', [2, 0, 2], [1, 0, 1]), polygonCorners: [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]].map(p => ({ x: p[0], y: p[1], z: p[2] })) };
const room = (surfaces = [wall, floor], objects: ScannedElement[] = []): ScannedRoomGeometry => ({ version: 1, surfaces, objects });
function patch(map: (u: number, v: number) => Vec, color: Vec, u0 = 0, v0 = 0, u1 = 2, v1 = 2, step = 0.1): Facet[] {
  const out: Facet[] = [];
  for (let u = u0; u < u1 - 1e-7; u += step) for (let v = v0; v < v1 - 1e-7; v += step) {
    const a = map(u, v), b = map(Math.min(u1, u + step), v), c = map(Math.min(u1, u + step), Math.min(v1, v + step)), d = map(u, Math.min(v1, v + step));
    out.push({ points: [a, b, c], color }, { points: [a, c, d], color });
  }
  return out;
}
const wallPatch = (color = wallColor, u0 = 0, v0 = 0, u1 = 2, v1 = 2) => patch((u, v) => [u, v, 0], color, u0, v0, u1, v1);
const floorPatch = (color = floorColor) => patch((u, v) => [u, 0, v], color);
function mesh(facets: Facet[]): ObservedMesh {
  const positions = new Float32Array(facets.flatMap(t => t.points.flat())), colors = new Float32Array(facets.flatMap(t => t.points.flatMap(() => t.color))), captured = new Float32Array(facets.flatMap(t => t.points.map(() => t.captured ?? 1)));
  return { version: 2, triangleCount: facets.length, coloredVertexCount: captured.filter(x => x === 1).length, wasLimited: false, positions, colors, captured, bounds: { min: [0, 0, 0], max: [2, 2, 2] } };
}
function nearColor(actual: Vec | undefined, expected: Vec) { assert.ok(actual); actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-6, `${actual} != ${expected}`)); }

check('floor and wall use their own distributed camera evidence in linear RGB', () => {
  const result = deriveRoomAppearance(mesh([...wallPatch(), ...floorPatch()]), room());
  assert.equal(result.wall.status, 'supported'); assert.equal(result.floor.status, 'supported');
  nearColor(result.wall.colorLinear, wallColor); nearColor(result.floor.colorLinear, floorColor);
  assert.equal(result.wall.colorHex, '#cbccc0'); assert.equal(result.floor.colorHex, '#875e41');
  assert.ok(result.wall.spatialCellCount > 50 && result.floor.coveredAreaMeters2 > 2);
});
check('missing color, one large triangle and densely repeated tiny observations cannot tint a whole wall', () => {
  const tiny = wallPatch(red, 0.5, 0.5, 0.51, 0.51)[0];
  const cases = [wallPatch().map(t => ({ ...t, captured: 0 })), [{ points: [[0, 0, 0], [2, 0, 0], [0, 2, 0]] as Vec[], color: red }], Array(10_000).fill(tiny)];
  for (const facets of cases) assert.equal(deriveRoomAppearance(mesh(facets), room()).wall.status, 'unknown');
});
check('cabinet and opening colors near the wall cannot contaminate its inferred tint', () => {
  const cabinet = element('cabinet', 'storage', [1.2, 1.5, 0.4], [0.6, 0.75, 0.18]);
  const window = element('window', 'window', [0.4, 0.4, 0], [1.65, 1.5, 0]);
  const painted = wallPatch();
  const cabinetRed = patch((u, v) => [u, v, 0.03], red, 0, 0, 1.2, 1.5, 0.025);
  const windowRed = wallPatch(red, 1.45, 1.3, 1.85, 1.7);
  const result = deriveRoomAppearance(mesh([...cabinetRed, ...windowRed, ...painted]), room([wall, floor, window], [cabinet])).wall;
  assert.equal(result.status, 'supported'); nearColor(result.colorLinear, wallColor);
  assert.ok(result.rejectedObjectTriangleCount > 1000);
});
check('normals and the 5 cm plane gate exclude nearby perpendicular and offset surfaces', () => {
  const horizontal = patch((u, v) => [u, 1, v], red, 0, 0, 2, 0.04, 0.02);
  const offset = patch((u, v) => [u, v, 0.0501], red);
  const result = deriveRoomAppearance(mesh([...horizontal, ...offset, ...wallPatch()]), room()).wall;
  assert.equal(result.status, 'supported'); nearColor(result.colorLinear, wallColor);
});
check('uncolored sentinel RGB and clipped glare do not replace observed diffuse color', () => {
  const uncolored = wallPatch(red).map(t => ({ ...t, captured: 0 }));
  const glare = wallPatch([1, 1, 1]);
  const result = deriveRoomAppearance(mesh([...uncolored, ...glare, ...wallPatch()]), room()).wall;
  nearColor(result.colorLinear, wallColor); assert.ok(result.rejectedBrightnessTriangleCount > 0);
});
check('one densely sampled differently colored cell cannot outweigh distributed wall evidence', () => {
  const tiny = wallPatch(red, 0.21, 0.21, 0.25, 0.25)[0];
  const result = deriveRoomAppearance(mesh([...Array(10_000).fill(tiny), ...wallPatch()]), room()).wall;
  assert.equal(result.status, 'supported'); nearColor(result.colorLinear, wallColor);
});
check('unobserved concave floor regions and missing floor polygons provide no tint evidence', () => {
  const bentFloor = { ...floor, polygonCorners: [[0, 0], [2, 0], [2, 0.7], [0.7, 0.7], [0.7, 2], [0, 2]].map(([x, z]) => ({ x, y: 0, z })) };
  const absent = patch((u, v) => [u, 0, v], red, 0.8, 0.8, 1.9, 1.9);
  assert.equal(deriveRoomAppearance(mesh(absent), room([bentFloor])).floor.status, 'unknown');
  const missing = { ...floor, polygonCorners: undefined };
  assert.equal(deriveRoomAppearance(mesh(floorPatch()), room([missing])).floor.reason, 'invalid-surface');
});
check('different walls keep independent inferred appearances', () => {
  const second = element('second-wall', 'wall', [2, 2, 0], [1, 1, 2]);
  const blue = linear(70, 105, 160);
  const result = deriveRoomAppearance(mesh([...wallPatch(), ...patch((u, v) => [u, v, 2], blue)]), room([wall, second]));
  nearColor(result.wall.colorLinear, wallColor); nearColor(result['second-wall'].colorLinear, blue);
});
check('two substantially different finishes on one wall remain unknown instead of asserting a uniform tint', () => {
  const facets = [...wallPatch(linear(225, 225, 225), 0, 0, 1, 2), ...wallPatch(linear(45, 65, 90), 1, 0, 2, 2)];
  const result = deriveRoomAppearance(mesh(facets), room()).wall;
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'mixed-appearance'); assert.equal(result.colorLinear, undefined);
});
check('grain and illumination brightness variation can support a low-confidence tint without inventing hue', () => {
  const light: Vec = [0.55, 0.3, 0.16], shade = light.map(n => n * 0.2) as Vec;
  const facets = [...wallPatch(light, 0, 0, 1, 2), ...wallPatch(shade, 1, 0, 2, 2)];
  const result = deriveRoomAppearance(mesh(facets), room()).wall;
  assert.equal(result.status, 'supported'); assert.equal(result.confidence, 'low'); assert.ok(result.chromaticSpread < 1e-6);
});
check('rotated room coordinates preserve the same inferred appearance without transforming source twice', () => {
  const a = 0.73, c = Math.cos(a), s = Math.sin(a);
  const rotate = ([x, y, z]: Vec): Vec => [c * x + s * z + 3, y + 1, -s * x + c * z - 4];
  const scan = structuredClone(room());
  for (const element of scan.surfaces) {
    const t = element.transform, o = rotate([t[12], t[13], t[14]]);
    for (const start of [0, 4, 8]) { const x = t[start], z = t[start + 2]; t[start] = c * x + s * z; t[start + 2] = -s * x + c * z; }
    [t[12], t[13], t[14]] = o;
    element.polygonCorners = element.polygonCorners?.map(p => { const [x, y, z] = rotate([p.x, p.y, p.z]); return { x, y, z }; });
  }
  const facets = [...wallPatch(), ...floorPatch()].map(t => ({ ...t, points: t.points.map(rotate) }));
  const result = deriveRoomAppearance(mesh(facets), scan);
  nearColor(result.wall.colorLinear, wallColor); nearColor(result.floor.colorLinear, floorColor);
});
check('geometry, colors, captured flags and project metadata remain unchanged', () => {
  const m = mesh([...wallPatch(), ...floorPatch()]), scan = room(), json = JSON.stringify(scan);
  const xyz = m.positions.slice(), rgb = m.colors.slice(), captured = m.captured.slice();
  deriveRoomAppearance(m, scan);
  assert.equal(JSON.stringify(scan), json); assert.deepEqual(m.positions, xyz); assert.deepEqual(m.colors, rgb); assert.deepEqual(m.captured, captured);
  assert.equal(deriveRoomAppearance({ ...m, triangleCount: 320_001 }, scan).wall.status, 'unknown');
});
console.log(`${checks} room appearance checks passed.`);
