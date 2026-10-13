import assert from 'node:assert/strict';
import { Matrix4, Texture, Vector2, Vector3 } from 'three';
import { photoFloorTextureMatrix } from '../src/components/scene/photo-floor-registration';
import { getMaterial, type PBRRecipe } from '../src/lib/materials/catalog';

let count = 0;
const check = (name: string, run: () => void) => { run(); count++; console.log(`PASS ${name}`); };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const floor = { origin: [3, 0, -2], u: [1, 0, 0], v: [0, 0, 1], spanMeters: [4, 6] as [number, number] };
const finish = { origin: [3.2, 0, -2.1], u: [Math.cos(0.7), 0, Math.sin(0.7)], v: [-Math.sin(0.7), 0, Math.cos(0.7)], grainDirectionRadians: 0.7 };
const plank = getMaterial('floor-white-oak-plank')!.pbr;
const texture = (rotation = 0) => {
  const value = new Texture(); value.repeat.set(1 / 0.76, 1 / 3.2); value.offset.set(0.1, 0.2); value.rotation = rotation;
  if (rotation) value.center.set(0.5, 0.5); value.updateMatrix(); return value;
};
function uv(point: number[], frame = floor) {
  const delta = point.map((n, i) => n - frame.origin[i]);
  return new Vector2(delta.reduce((sum, n, i) => sum + n * frame.u[i], 0) / frame.spanMeters[0], delta.reduce((sum, n, i) => sum + n * frame.v[i], 0) / frame.spanMeters[1]);
}
const along = (origin: number[], direction: number[]) => origin.map((n, i) => n + direction[i]);

check('observed longitudinal grain maps to procedural texture V with physical repeats kept in texture axes', () => {
  const base = texture(), matrix = photoFloorTextureMatrix(base, floor, finish, plank), start = uv(finish.origin).applyMatrix3(matrix);
  const grain = uv(along(finish.origin, finish.u)).applyMatrix3(matrix).sub(start);
  const across = uv(along(finish.origin, finish.v)).applyMatrix3(matrix).sub(start);
  close(grain.x, 0); close(grain.y, -1 / 3.2); close(across.x, 1 / 0.76); close(across.y, 0);
});
check('catalog rotate90 and its pivot cannot rotate or offset already observed grain a second time', () => {
  const normal = photoFloorTextureMatrix(texture(), floor, finish, plank), rotated = photoFloorTextureMatrix(texture(Math.PI / 2), floor, finish, { ...plank, rotate90: true } as PBRRecipe);
  normal.elements.forEach((n, i) => close(n, rotated.elements[i]));
});
check('rotating and translating the room preserves registered texture coordinates', () => {
  const room = new Matrix4().makeRotationY(1.1).setPosition(-5, 0.2, 7), base = texture();
  const point = (p: number[]) => new Vector3().fromArray(p).applyMatrix4(room).toArray();
  const direction = (p: number[]) => new Vector3().fromArray(p).transformDirection(room).toArray();
  const movedFloor = { ...floor, origin: point(floor.origin), u: direction(floor.u), v: direction(floor.v) };
  const movedFinish = { ...finish, origin: point(finish.origin), u: direction(finish.u), v: direction(finish.v) };
  const original = photoFloorTextureMatrix(base, floor, finish, plank), moved = photoFloorTextureMatrix(base, movedFloor, movedFinish, plank);
  for (const p of [finish.origin, along(finish.origin, finish.u), along(finish.origin, finish.v)]) {
    const a = uv(p).applyMatrix3(original), b = uv(point(p), movedFloor).applyMatrix3(moved); close(a.x, b.x); close(a.y, b.y);
  }
});
check('checkerboard, mineral, tile and end-grain maps receive no plank-specific quarter-turn', () => {
  const frame = { ...floor, grainDirectionRadians: 0 };
  for (const recipe of [getMaterial('tile-floor-checker')!.pbr, getMaterial('tile-floor-grey')!.pbr, getMaterial('tile-floor-terrazzo')!.pbr,
    { ...plank, procedural: { kind: 'wood', options: { figure: 'end-grain' } } } as PBRRecipe]) {
    const base = texture(), matrix = photoFloorTextureMatrix(base, floor, frame, recipe), start = uv(floor.origin).applyMatrix3(matrix);
    const u = uv(along(floor.origin, floor.u)).applyMatrix3(matrix).sub(start), v = uv(along(floor.origin, floor.v)).applyMatrix3(matrix).sub(start);
    close(u.x, base.repeat.x); close(u.y, 0); close(v.x, 0); close(v.y, base.repeat.y);
  }
});
check('missing grain evidence retains the existing texture transform without asserting a measured direction', () => {
  for (const frame of [null, { ...floor, grainDirectionRadians: null }]) {
    const base = texture(Math.PI / 2), matrix = photoFloorTextureMatrix(base, floor, frame, plank);
    const actual = new Vector2(0.25, 0.5).applyMatrix3(matrix), expected = new Vector2(1, 3).applyMatrix3(base.matrix);
    close(actual.x, expected.x); close(actual.y, expected.y);
  }
});
check('texture transforms and captured frames stay immutable, including manually managed texture matrices', () => {
  const base = texture(Math.PI / 2), before = JSON.stringify({ floor, finish, repeat: base.repeat, offset: base.offset, center: base.center, rotation: base.rotation, matrix: base.matrix.elements });
  photoFloorTextureMatrix(base, floor, finish, plank);
  assert.equal(JSON.stringify({ floor, finish, repeat: base.repeat, offset: base.offset, center: base.center, rotation: base.rotation, matrix: base.matrix.elements }), before);
  base.matrixAutoUpdate = false; base.matrix.set(2, 0, 4, 0, 3, 5, 0, 0, 1);
  const managed = photoFloorTextureMatrix(base, floor, null, getMaterial('tile-floor-checker')!.pbr);
  const actual = new Vector2(0.25, 0.5).applyMatrix3(managed); close(actual.x, 6); close(actual.y, 14);
  assert.deepEqual(base.matrix.elements, [2, 0, 0, 0, 3, 0, 4, 5, 1]);
});
console.log(`Photo floor registration checks: ${count} passed.`);
