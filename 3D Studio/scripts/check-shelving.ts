import assert from 'node:assert/strict';
import * as THREE from 'three';
import { defaultBathroom, defaultKitchen, emptyDecor } from '../src/lib/spec/defaults';
import type { KitchenSpec, OpenShelf } from '../src/lib/spec/types';
import { ft, inch } from '../src/lib/units';
import { computeKitchenLayout } from '../src/components/scene/kitchen/layout';
import { decorParts } from '../src/components/scene/kitchen/decor';
import type { Part } from '../src/components/scene/kitchen/parts';
import { bathroomElementBoxes, kitchenElementBoxes } from '../src/lib/fit/boxes';
import { computeBathroomLayout } from '../src/components/scene/bathroom/layout';
import { shelfCase } from '../src/components/scene/bathroom/helpers';
import { harvestBathroom } from './preview-bathroom';
import { kitchenParams } from '../src/lib/fit/params';
import { itemsParts } from '../src/components/scene/kitchen/items';
import { shelfFootprint, shelfPoint } from '../src/components/scene/shelf-frame';
import { onWall, wallFrame } from '../src/components/scene/geometry';

const close = (a: number, b: number, why: string) => assert.ok(Math.abs(a - b) < 1e-5, `${why}: ${a} vs ${b}`);
function kitchen(): KitchenSpec {
  const s = defaultKitchen();
  s.style = 'modern'; s.island.present = false; s.appliances = []; s.openings = [];
  s.runs = [{ ...s.runs[0], start: 0, lengthFt: 16, tall: [], hasUppers: false, uppers: [], uppers2: null, backsplash: false }];
  s.cabinets.crown = false; s.backsplash.present = false;
  s.decor = { ...emptyDecor(), counterStyling: 'none' };
  return s;
}
const source: OpenShelf = { wall: 'back', t: 0.25, widthIn: 24, count: 5, bottomFt: 3, depthIn: 12, spacingIn: 12, material: 'wood', styled: 'empty', enclosure: { heightIn: 60, backPanel: true, panelThicknessIn: 0.75 }, finishColorHex: '#6E4525' };
const spec = kitchen(); spec.decor.shelves = [source];
const L = computeKitchenLayout(spec), shelf = L.decor.shelves[0];
assert.ok(shelf?.enclosure, 'observed case survives the shelf solver');
assert.equal(shelf.count, 5, 'case preserves the five declared boards, including its base');
close(shelf.boards[0], ft(3), 'case base stays at its declared counter height');
close(shelf.enclosure.top, ft(8), 'enclosure cap reaches the declared full height');
close(shelf.thickness, inch(0.75), 'case boards use the declared panel thickness');
const parts = decorParts(L).filter((p) => p.key.startsWith(shelf.id));
assert.equal(parts.length, 9, 'five boards plus exactly two sides, one back and one top');
assert.ok(parts.every((p) => p.procedural?.tint === '#6e4525'), 'observed dark wood overrides the modern style oak color');
assert.ok(parts.every((p) => !/reveal|bracket/.test(p.key)), 'enclosed boards do not get floating-shelf hardware');
const fitBoxes = kitchenElementBoxes(L).filter((b) => b.kind === 'shelf');
assert.equal(fitBoxes.length, 1, 'photo fitting observes the entire display case as one object');
close(fitBoxes[0].box.min[1], shelf.enclosure.bottom, 'fit box includes case bottom');
close(fitBoxes[0].box.max[1], shelf.enclosure.top, 'fit box includes full case height');
const paramSpec = structuredClone(spec); paramSpec.decor.shelves[0].spacingIn = 24;
const params = kitchenParams(paramSpec, paramSpec);
const heightParam = params.find((p) => p.label === 'decor.shelves[0].enclosure.heightIn')!;
assert.ok(heightParam, 'enclosed case exposes its own height parameter');
const resized = structuredClone(paramSpec);
heightParam.set(resized, 120); heightParam.set(resized, 60);
close(resized.decor.shelves[0].spacingIn, 24, 'returning case height restores its original board pitch even after a spacing clamp');
assert.ok(!params.some((p) => p.label === 'decor.shelves[0].spacingIn'), 'whole-case observation cannot independently reshape hidden interior pitch');
function bounds(p: Part) {
  p.geometry.computeBoundingBox();
  const box = p.geometry.boundingBox!.clone();
  const sc = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] as const : p.scale ?? [1, 1, 1] as const;
  return box.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...(p.position ?? [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rotation ?? [0, 0, 0]))), new THREE.Vector3(...sc)));
}
const outer = parts.reduce((b, p) => b.union(bounds(p)), new THREE.Box3());
close(outer.min.x, shelf.x - inch(12), 'case outer left');
close(outer.max.x, shelf.x + inch(12), 'case outer right');
close(outer.min.y, ft(3), 'case outer bottom');
close(outer.max.y, ft(8), 'case outer top');
close(outer.max.z - outer.min.z, inch(12), 'case outer depth');
for (const board of parts.filter((p) => /-board\d+$/.test(p.key))) {
  const b = bounds(board);
  close(b.min.x, shelf.x - shelf.width / 2 + shelf.enclosure.panelThickness, 'board fits inside left side');
  close(b.max.x, shelf.x + shelf.width / 2 - shelf.enclosure.panelThickness, 'board fits inside right side');
  close(b.min.z, shelf.standoff + shelf.enclosure.panelThickness, 'board starts in front of the back panel');
}
const meshMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
function ray(parts: Part[]) {
  const meshes = parts.map((p) => { const mesh = new THREE.Mesh(p.geometry, meshMaterial); mesh.position.set(...(p.position ?? [0, 0, 0])); mesh.name = p.key; mesh.updateMatrixWorld(); return mesh; });
  return new THREE.Raycaster(new THREE.Vector3(shelf.x, ft(3.5), 1), new THREE.Vector3(0, 0, -1)).intersectObjects(meshes);
}
assert.ok(ray(parts)[0]?.object.name.endsWith('case-back'), 'each open tier looks into a wood backing, not through the wall');
const openBack = structuredClone(spec); openBack.decor.shelves[0].enclosure!.backPanel = false;
assert.ok(!decorParts(computeKitchenLayout(openBack)).some((p) => p.key.endsWith('case-back')), 'no back panel is invented when not observed');
const legacy = structuredClone(spec); delete legacy.decor.shelves[0].enclosure; delete legacy.decor.shelves[0].finishColorHex;
const floating = computeKitchenLayout(legacy), floatingParts = decorParts(floating).filter((p) => p.key.startsWith('shelf-'));
assert.equal(floating.decor.shelves[0].enclosure, null);
assert.ok(floating.decor.shelves[0].boards[0] >= floating.counterTopY + inch(8) - 1e-6, 'legacy floating shelves retain counter clearance');
assert.ok(!floatingParts.some((p) => p.key.includes('case-')), 'legacy shelves get no enclosing geometry');
assert.ok(floatingParts.find((p) => p.key.endsWith('board0'))?.procedural?.tint === '#c9a874', 'legacy wood retains its original style finish');
const low = structuredClone(spec); low.dims.ceilingFt = 7;
const short = computeKitchenLayout(low).decor.shelves[0];
assert.ok(short.enclosure!.top <= ft(7) && short.boards.every((y) => y + short.thickness < short.enclosure!.top - short.enclosure!.panelThickness), 'ceiling fitting keeps boards below the solid cap');
const belowRow = structuredClone(spec);
belowRow.runs[0].hasUppers = true; belowRow.runs[0].uppersToCeiling = true;
belowRow.runs[0].uppers = Array.from({ length: 4 }, () => ({ widthIn: 48, type: 'door' as const, heightIn: 18 }));
belowRow.decor.shelves[0] = { ...source, count: 2, spacingIn: 14, material: 'white', enclosure: { heightIn: 30, backPanel: true } };
const underUpper = computeKitchenLayout(belowRow);
assert.ok(underUpper.decor.shelves.length === 1 && underUpper.runs[0].uppers.length > 0, 'display case below a high horizontal cabinet row is retained');
assert.ok(underUpper.runs[0].uppers.every((u) => u.bottom >= underUpper.decor.shelves[0].enclosure!.top), 'case fit tests each upper box actual height instead of blocking the whole row band');
// A small cap overlap with a raised row used to remove the complete case.
const overlapRow = structuredClone(belowRow);
overlapRow.decor.shelves[0].bottomFt = 5.4;
const capFit = computeKitchenLayout(overlapRow), capped = capFit.decor.shelves[0];
assert.ok(capped?.enclosure, 'slight upper overlap retains the requested enclosed case');
assert.equal(capped.count, 2, 'case-cap adjustment retains both declared boards');
close(capped.boards[0], ft(5.4), 'cap adjustment preserves the base');
close(capped.boards[1] - capped.boards[0], inch(14), 'cap adjustment preserves measured board pitch');
close(capped.enclosure.top, Math.min(...capFit.runs[0].uppers.map((u) => u.bottom)) - inch(0.125), 'cap stops just beneath the actual upper underside');
assert.ok(capFit.decor.warnings.some((w) => w.includes('to clear the upper cabinet above')), 'case adjustment is explained');
// Enclosed casework must remain beside its observed opening when the nearer
// space needs a small width reduction; it must not jump to a wider remote bay.
const anchored = kitchen();
anchored.decor.shelves = [{ ...source, t: 0.77, count: 2, enclosure: { heightIn: 30, backPanel: true } }];
anchored.openings = [
  { id: 'window', kind: 'window', wall: 'back', t: 0.6, widthFt: 4, heightFt: 3, sillFt: 2.5, style: 'picture' },
  { id: 'door', kind: 'door', wall: 'back', t: 0.92, widthFt: 2, heightFt: 7, sillFt: 0 },
];
const anchoredLayout = computeKitchenLayout(anchored), nearbyCase = anchoredLayout.decor.shelves[0];
assert.ok(nearbyCase && nearbyCase.x > 1, 'case stays in the nearer bay on the observed side of the window');
assert.ok(nearbyCase.width < inch(24) && nearbyCase.width >= inch(12), 'nearby case safely narrows instead of crossing the window to find a wider bay');
const window = anchoredLayout.openings.find((o) => o.id === 'window')!;
assert.ok(nearbyCase.x - nearbyCase.width / 2 > window.x + window.width / 2, 'preserving adjacency does not weaken the actual opening collision');
const shortTopTier = structuredClone(spec);
shortTopTier.decor.shelves[0] = { ...source, count: 4, spacingIn: 14.68, enclosure: { heightIn: 48.93, backPanel: true } };
assert.equal(computeKitchenLayout(shortTopTier).decor.shelves[0].count, 4, 'a physically clear short top compartment does not lose its declared board');

function wallMatrix(wall: OpenShelf['wall'], width: number, depth: number) {
  return new THREE.Matrix4().makeRotationY(wallFrame(wall, width, depth).yaw).setPosition(...onWall(wall, width, depth, 0.5, 0, 0));
}
function compareBox(actual: THREE.Box3, expected: { min: readonly number[]; max: readonly number[] }, why: string) {
  actual.min.toArray().forEach((n, i) => close(n, expected.min[i], `${why} min${i}`));
  actual.max.toArray().forEach((n, i) => close(n, expected.max[i], `${why} max${i}`));
}
for (const wall of ['back', 'left', 'right', 'front'] as const) for (const rotationDeg of [-90, 0, 90, 180] as const) {
  const turned = kitchen();
  turned.decor.shelves = [{ ...source, wall, t: 0.5, bottomFt: 4, count: 3, enclosure: { heightIn: 48, backPanel: true, rotationDeg } }];
  const layout = computeKitchenLayout(turned), sh = layout.decor.shelves[0];
  assert.ok(sh?.enclosure, `${wall}/${rotationDeg} case retained`);
  assert.equal(sh.wall, wall, 'orientation preserves mounting wall');
  close(sh.x, 0, 'orientation preserves an unobstructed mounting anchor');
  close(sh.width, inch(24), 'quarter turns preserve front width');
  close(sh.depth, inch(12), 'quarter turns preserve physical depth');
  const rendered = decorParts(layout).filter((p) => p.key.startsWith(sh.id));
  const actual = rendered.reduce((box, p) => box.union(bounds(p)), new THREE.Box3()).applyMatrix4(wallMatrix(wall, layout.w, layout.d));
  const fitted = kitchenElementBoxes(layout).find((b) => b.kind === 'shelf')!;
  compareBox(actual, fitted.box, `${wall}/${rotationDeg} rotated mesh equals fitting envelope`);
  assert.ok(actual.min.x >= -layout.w / 2 - 1e-5 && actual.max.x <= layout.w / 2 + 1e-5 && actual.min.z >= -layout.d / 2 - 1e-5 && actual.max.z <= layout.d / 2 + 1e-5, 'rotated case footprint stays inside the room');
  const before: [number, number] = [sh.x + 0.08, sh.standoff + 0.12];
  const after = shelfPoint(sh, ...before), reverse = shelfPoint(sh, ...after, true);
  close(reverse[0], before[0], 'case point transform is reversible along its width');
  close(reverse[1], before[1], 'case point transform is reversible through its depth');
  const front = shelfPoint(sh, sh.x, sh.standoff + sh.depth), center = shelfPoint(sh, sh.x, sh.standoff + sh.depth / 2);
  const frontWorld = new THREE.Vector3(front[0] - center[0], 0, front[1] - center[1]).applyAxisAngle(new THREE.Vector3(0, 1, 0), wallFrame(wall, layout.w, layout.d).yaw).normalize();
  if (wall === 'left' && rotationDeg === -90) close(frontWorld.z, 1, 'source left-wall case opens toward the room front');
}
const occupied = kitchen();
occupied.decor.shelves = [{ ...source, t: 0.5, bottomFt: 4, count: 3, enclosure: { heightIn: 48, backPanel: true, rotationDeg: -90 } }];
occupied.decor.items = [{ kind: 'canister', label: 'two jars', on: 'shelf', wall: 'back', t: 0.5, depthT: null, shelfIndex: 0, burner: null, sizeIn: 4, colorHex: '#888888', material: 'glass', count: 2 }];
occupied.decor.plants = [{ kind: 'shelf', wall: 'back', t: 0.5, sizeFt: 0.5, form: 'succulent' }];
const occupiedLayout = computeKitchenLayout(occupied), occupiedShelf = occupiedLayout.decor.shelves[0];
const envelope = kitchenElementBoxes(occupiedLayout).find((b) => b.kind === 'shelf')!.box;
const world = wallMatrix('back', occupiedLayout.w, occupiedLayout.d);
for (const part of itemsParts(occupiedLayout)) {
  for (const instance of part.instances ?? [{ position: part.position, rotation: part.rotation, scale: part.scale }]) {
    const actual = bounds({ ...part, instances: undefined, ...instance }).applyMatrix4(world);
    assert.ok(actual.min.x >= envelope.min[0] - 1e-5 && actual.max.x <= envelope.max[0] + 1e-5 && actual.min.z >= envelope.min[2] - 1e-5 && actual.max.z <= envelope.max[2] + 1e-5, 'every jar in an instanced row turns with its case and remains inside it');
  }
}
const rotatedItem = occupiedLayout.decor.items[0];
close(rotatedItem.yaw, -Math.PI / 2, 'declared item fitting envelope adopts case yaw');
const rotatedPlant = occupiedLayout.decor.plants[0];
const unturnedPlant = shelfPoint(occupiedShelf, rotatedPlant.x, rotatedPlant.z, true);
close(unturnedPlant[1], occupiedShelf.standoff + occupiedShelf.enclosure!.panelThickness + (occupiedShelf.depth - occupiedShelf.enclosure!.panelThickness) / 2, 'plant remains seated at the same depth inside the turned case');
const edgeCase = kitchen(); edgeCase.dims.widthFt = 4; edgeCase.dims.depthFt = 4; edgeCase.runs = [];
edgeCase.decor.shelves = [{ ...source, wall: 'left', t: 0, widthIn: 120, bottomFt: 4, count: 2, enclosure: { heightIn: 24, backPanel: true, rotationDeg: 90 } }];
const smallRoom = computeKitchenLayout(edgeCase), edgeShelf = smallRoom.decor.shelves[0];
assert.ok(edgeShelf && shelfFootprint(edgeShelf).projection < smallRoom.w, 'oversized turned case is limited by the perpendicular room dimension');
assert.ok(smallRoom.decor.warnings.some((w) => w.includes('rotated footprint')), 'dimension limit is disclosed');

const crowded = structuredClone(spec);
crowded.decor.items = [{ kind: 'canister', label: 'large jar', on: 'shelf', wall: 'back', t: 0.25, depthT: null, shelfIndex: 4, burner: null, sizeIn: 24, colorHex: '#888888', material: 'glass', count: 1 }];
const fitted = computeKitchenLayout(crowded), item = fitted.decor.items[0], host = fitted.decor.shelves[0];
assert.ok(item && item.y + item.h < host.enclosure!.top - host.enclosure!.panelThickness, 'declared objects fit below the case cap');
assert.ok(item.x - item.w / 2 > host.x - host.width / 2 + host.enclosure!.panelThickness, 'declared objects fit inside side panels');
assert.ok(item.z - item.d / 2 > host.standoff + host.enclosure!.panelThickness, 'declared objects fit in front of the back panel');
const styled = structuredClone(spec);
styled.decor.shelves[0].enclosure!.heightIn = 51;
styled.decor.shelves[0].styled = 'plants';
const styledLayout = computeKitchenLayout(styled), styledShelf = styledLayout.decor.shelves[0];
for (const p of decorParts(styledLayout).filter((p) => /^shelf-0-b\d+-/.test(p.key))) {
  const b = bounds(p);
  assert.ok(b.max.y < styledShelf.enclosure!.top - styledShelf.enclosure!.panelThickness, 'styled objects stay below the enclosure cap');
  assert.ok(b.min.x >= styledShelf.x - styledShelf.width / 2 + styledShelf.enclosure!.panelThickness && b.max.x <= styledShelf.x + styledShelf.width / 2 - styledShelf.enclosure!.panelThickness, 'styled objects stay inside case sides');
}
meshMaterial.dispose();

async function checkBathroom() {
  const bath = defaultBathroom();
  bath.vanity.present = false; bath.shower.present = false; bath.tub.present = false; bath.toilet.present = false;
  bath.openings = []; bath.wallTile.height = 'none';
  bath.decor = { ...emptyDecor(), shelves: [{ ...source, t: 0.5, count: 4, spacingIn: 12, enclosure: { heightIn: 50, panelThicknessIn: 0.75, backPanel: true } }], counterStyling: 'none' };
  const layout = computeBathroomLayout(bath), s = layout.decor.shelves[0];
  assert.ok(s.enclosure && s.count === 4, 'bathroom retains declared case and board count');
  close(s.enclosure.top - s.enclosure.bottom, inch(50), 'bathroom uses the same overall case height');
  assert.equal(s.finishColorHex, '#6e4525', 'bathroom preserves observed wood finish independently');
  const geometry = shelfCase(s.width, s.depth, s.count, s.spacing, s.thickness, s.enclosure.top - s.enclosure.bottom, true);
  geometry.computeBoundingBox();
  close(geometry.boundingBox!.max.y, inch(50), 'bathroom case mesh contains full cap');
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld();
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, inch(6), 1), new THREE.Vector3(0, 0, -1));
  const hit = raycaster.intersectObject(mesh);
  assert.ok(hit.length > 0, 'bathroom open tier has observed backing');
  close(hit[0].point.z, s.thickness, 'bathroom tier is open up to its back panel');
  const noBack = new THREE.Mesh(shelfCase(s.width, s.depth, s.count, s.spacing, s.thickness, inch(50), false), material); noBack.updateMatrixWorld();
  assert.equal(raycaster.intersectObject(noBack).length, 0, 'bathroom does not invent unobserved backing');
  const collected = await harvestBathroom(bath);
  const caseNode = collected.nodes.find((n) => n.label === 'shelf-case-0');
  assert.ok(caseNode, 'actual bathroom component tree emits the case mesh');
  assert.ok([...collected.skipped.keys()].every((k) => !k.startsWith('throw:') || k.includes('ContactShadows')), 'bathroom case rendering has no missing component branches');
  const expected = [0x6e, 0x45, 0x25].map((channel) => (channel / 255) ** 2.2);
  caseNode.color.forEach((c, i) => close(c, expected[i], 'actual bathroom material uses observed finish'));
  const { materialCacheSize } = await import('../src/components/scene/materials');
  const cached = materialCacheSize();
  const anotherFinish = structuredClone(bath); anotherFinish.decor.shelves[0].finishColorHex = '#704826';
  await harvestBathroom(anotherFinish);
  assert.equal(materialCacheSize() - cached, 1, 'one observed shelf finish creates only its active material, not an unused paint and wood pair');
  const bathBoxes = bathroomElementBoxes(layout).filter((b) => b.kind === 'shelf');
  assert.ok(bathBoxes.some((b) => Math.abs(b.box.min[1] - s.enclosure!.bottom) < 1e-5 && Math.abs(b.box.max[1] - s.enclosure!.top) < 1e-5), 'bathroom fitter observes the complete case envelope');
  // Walk the actual component tree on a tiled wall: panel geometry and
  // photo fitting must agree even when width/depth swap and tile adds 10mm.
  for (const rotationDeg of [-90, 0, 90, 180] as const) {
    const turned = structuredClone(bath); turned.wallTile.height = 'full';
    turned.decor.shelves[0].wall = 'left'; turned.decor.shelves[0].enclosure!.rotationDeg = rotationDeg;
    const rotated = computeBathroomLayout(turned), caseShelf = rotated.decor.shelves[0];
    const nodes = await harvestBathroom(turned), actualCase = nodes.nodes.find((n) => n.label === 'shelf-case-0')!;
    assert.ok(actualCase, 'actual bathroom component emits its turned case');
    actualCase.geometry.computeBoundingBox();
    const actual = actualCase.geometry.boundingBox!.clone().applyMatrix4(actualCase.matrix);
    const fit = bathroomElementBoxes(rotated).find((b) => b.kind === 'shelf')!;
    compareBox(actual, fit.box, `bathroom ${rotationDeg} mesh equals tiled-wall fit box`);
    assert.ok(caseShelf.standoff > 0, 'bathroom solver includes finished tile offset');
    assert.equal(caseShelf.wall, 'left', 'bathroom rotation preserves mounting wall');
    close(caseShelf.t, 0.5, 'bathroom rotation preserves unobstructed anchor');
    turned.decor.plants = [{ kind: 'shelf', wall: 'left', t: 0.5, sizeFt: 0.5, form: 'succulent' }];
    const planted = computeBathroomLayout(turned), p = planted.decor.plants[0];
    assert.ok(p.x > fit.box.min[0] && p.x < fit.box.max[0] && p.z > fit.box.min[2] && p.z < fit.box.max[2], 'bathroom plant follows its rotated case footprint');
    close(p.yaw, wallFrame('left', rotated.w, rotated.d).yaw + rotationDeg * Math.PI / 180, 'bathroom plant turns with its case');
  }
  bath.decor.plants = [{ kind: 'shelf', wall: 'back', t: 0.5, sizeFt: 4, form: 'succulent' }];
  const plantLayout = computeBathroomLayout(bath), plant = plantLayout.decor.plants[0], caseShelf = plantLayout.decor.shelves[0];
  assert.ok(plant.y + plant.size < caseShelf.enclosure!.top - caseShelf.enclosure!.panelThickness, 'bathroom shelf plant fits below its case cap');
  delete bath.decor.shelves[0].enclosure; delete bath.decor.shelves[0].finishColorHex;
  const legacy = computeBathroomLayout(bath).decor.shelves[0];
  assert.equal(legacy.enclosure, null, 'bathroom legacy floating defaults unchanged');
  close(legacy.thickness, 0.032, 'bathroom legacy floating board thickness unchanged');
  material.dispose();
}
void checkBathroom().then(() => console.log('Enclosed shelving: kitchen and bathroom structure, open tiers, observed finish, legacy defaults, fitting envelopes and contents clearance passed.')).catch((err) => { console.error(err); process.exitCode = 1; });
