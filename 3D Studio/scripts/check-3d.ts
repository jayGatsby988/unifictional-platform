/**
 * MANHATTAN — headless verification for the 3D engine.
 *
 *   npx tsx scripts/check-3d.ts
 *
 * Covers, with no browser and no dev server:
 *   1. GEOMETRY + DETAIL KIT — instantiates every builder over a range of
 *      inputs (including NaN / zero / absurd) and asserts finite positions and
 *      UVs, unit-length normals, non-zero triangle counts, bounding boxes
 *      inside the expected envelope, and outward-facing normals on solids.
 *      Prints the triangle cost of each builder so a scene author can budget.
 *   2. PROCEDURAL TEXTURES — runs every generator behind a minimal 2D-canvas
 *      shim to catch crashes, non-termination and wrong physical spans.
 *   3. DETAIL-NORMAL SHADER INJECTION — proves the onBeforeCompile hook's
 *      anchor still exists in the installed three and that the injected GLSL
 *      leaves the preprocessor balanced.
 *   4. SHADOW MAP TYPE — guards the PCFSoftShadowMap trap (see SceneCanvas).
 *   5. RENDER PROMPT FIDELITY — asserts the viewport brief carries the room's
 *      real geometry and every "do not change this" clause, for all three room
 *      types plus a deliberately corrupt spec.
 */
import * as THREE from 'three';
import * as D from '../src/components/scene/detail';
import * as G from '../src/components/scene/geometry';
import * as LM from '../src/components/scene/light-math';

// --- minimal DOM / canvas shim ------------------------------------------
class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
function fakeCanvas() {
  const c: Record<string, unknown> = { width: 0, height: 0 };
  const blits: Array<{ x: number; y: number; w: number; h: number }> = [];
  c.blits = blits;
  let store: Uint8ClampedArray | null = null;
  const grad = { addColorStop() {} };
  const ctx: Record<string, unknown> = {
    fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    fillRect() {}, strokeRect() {}, clearRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    arc() {}, ellipse() {}, rect() {}, fill() {}, stroke() {}, clip() {},
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setLineDash() {},
    drawImage(src: { width: number; height: number }, x: number, y: number) { blits.push({ x, y, w: src.width, h: src.height }); },
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    createImageData(w: number, h: number) { return new FakeImageData(w, h); },
    putImageData(img: FakeImageData) { store = img.data.slice(); },
    getImageData(_x: number, _y: number, w: number, h: number) {
      const img = new FakeImageData(w, h);
      if (store && store.length === img.data.length) img.data.set(store);
      else for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 128; img.data[i + 1] = 128; img.data[i + 2] = 128; img.data[i + 3] = 255; }
      return img;
    },
  };
  c.getContext = () => ctx;
  return c;
}
(globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => (tag === 'canvas' ? fakeCanvas() : {}) };

/* eslint-disable @typescript-eslint/no-require-imports */
// imported AFTER the shim so module-level canvas access is safe
const P = require('../src/components/scene/procedural') as typeof import('../src/components/scene/procedural');
const PR = require('../src/lib/ai/prompt') as typeof import('../src/lib/ai/prompt');
const DEF = require('../src/lib/spec/defaults') as typeof import('../src/lib/spec/defaults');
const CAT = require('../src/lib/materials/catalog') as typeof import('../src/lib/materials/catalog');
const COL = require('../src/lib/materials/color') as typeof import('../src/lib/materials/color');

let failures = 0;
const fail = (m: string) => { failures++; console.error(`  FAIL ${m}`); };
const ok = (m: string) => console.log(`  ok   ${m}`);

function checkResult(name: string, r: { canvas: { width: number; height: number }; spanM: number }, expect?: { minSpan?: number; maxSpan?: number }) {
  if (!r || !r.canvas) { fail(`${name}: no result`); return; }
  if (!Number.isFinite(r.spanM) || r.spanM <= 0) { fail(`${name}: spanM ${r.spanM}`); return; }
  if (r.canvas.width !== r.canvas.height) fail(`${name}: canvas not square (${r.canvas.width}×${r.canvas.height})`);
  if (r.canvas.width < 128) fail(`${name}: canvas too small (${r.canvas.width})`);
  if (expect?.minSpan !== undefined && r.spanM < expect.minSpan) fail(`${name}: spanM ${r.spanM} < ${expect.minSpan}`);
  if (expect?.maxSpan !== undefined && r.spanM > expect.maxSpan) fail(`${name}: spanM ${r.spanM} > ${expect.maxSpan}`);
  ok(`${name.padEnd(38)} ${r.canvas.width}px, span ${r.spanM.toFixed(3)} m`);
}

console.log('\n--- GEOMETRY + DETAIL KIT ----------------------------------------');
const rows: Array<{ name: string; tris: number; size: string }> = [];


function check(name: string, g: THREE.BufferGeometry, expect?: { maxSize?: [number, number, number]; minTris?: number; outward?: boolean }) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) { fail(`${name}: empty geometry`); return; }
  for (let i = 0; i < pos.count * 3; i++) {
    if (!Number.isFinite((pos.array as ArrayLike<number>)[i])) { fail(`${name}: non-finite position at ${i}`); break; }
  }
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) fail(`${name}: no UVs (applyWorldUVs not applied)`);
  else {
    for (let i = 0; i < uv.count * 2; i++) {
      if (!Number.isFinite((uv.array as ArrayLike<number>)[i])) { fail(`${name}: non-finite UV at ${i}`); break; }
    }
    if (uv.count !== pos.count) fail(`${name}: uv count ${uv.count} != position count ${pos.count}`);
  }
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!nor) fail(`${name}: no normals`);
  else {
    for (let i = 0; i < nor.count; i++) {
      const l = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (!Number.isFinite(l) || l < 0.5) { fail(`${name}: degenerate normal at ${i} (len ${l.toFixed(3)})`); break; }
    }
  }
  const tris = D.triangleCount(g);
  if (tris < (expect?.minTris ?? 1)) fail(`${name}: ${tris} triangles (< ${expect?.minTris ?? 1})`);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite)) fail(`${name}: non-finite bounds`);
  if (expect?.maxSize) {
    const m = expect.maxSize;
    if (size.x > m[0] + 1e-4 || size.y > m[1] + 1e-4 || size.z > m[2] + 1e-4) {
      fail(`${name}: bounds ${size.toArray().map((n) => n.toFixed(3)).join('×')} exceed ${m.join('×')}`);
    }
  }
  if (expect?.outward) {
    // every face normal should point away from the centroid for a convex solid
    const c = bb.getCenter(new THREE.Vector3());
    const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3();
    let bad = 0, total = 0;
    const idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); cc.fromBufferAttribute(pos, i2);
      e1.subVectors(b, a); e2.subVectors(cc, a); n.crossVectors(e1, e2);
      if (n.lengthSq() < 1e-18) continue;
      n.normalize();
      mid.copy(a).add(b).add(cc).multiplyScalar(1 / 3).sub(c);
      if (mid.lengthSq() < 1e-12) continue;
      total++;
      if (n.dot(mid.normalize()) < -0.15) bad++;
    }
    if (total > 0 && bad / total > 0.05) fail(`${name}: ${bad}/${total} inward-facing faces`);
  }
  rows.push({ name, tris, size: size.toArray().map((n) => n.toFixed(3)).join(' × ') });
}

// --- geometry.ts baseline -----------------------------------------------
check('worldBox 0.6×0.7×0.6', G.worldBox(0.6, 0.7, 0.6), { maxSize: [0.6, 0.7, 0.6], outward: true });
check('bevelBox counter 2.4×0.03×0.64', G.bevelBox(2.4, 0.03, 0.64, 0.004), { maxSize: [2.41, 0.04, 0.65] });
check('worldCylinder', G.worldCylinder(0.05, 0.05, 0.4, 16), { maxSize: [0.11, 0.41, 0.11] });
check('wallFace 4×2.6 + window', G.wallFace(4, 2.6, [{ x: 0, y: 0.9, w: 1.2, h: 1.2 }]), { maxSize: [4.01, 2.61, 0.01] });
check('roofGeometry gable', G.roofGeometry({ w: 10, d: 8, pitch: 6, type: 'gable', overhang: 0.4, ridge: 'x' }));
check('roofGeometry hip', G.roofGeometry({ w: 10, d: 8, pitch: 6, type: 'hip', overhang: 0.4, ridge: 'z' }));

// --- chamfer / fillet boxes over a wide range ---------------------------
for (const [w, h, d, c] of [[0.6, 0.72, 0.019, 0.0015], [0.02, 0.02, 0.02, 0.01], [4, 0.03, 0.64, 0.002], [0.3, 2.4, 0.6, 0.0], [0.001, 0.001, 0.001, 5]] as const) {
  check(`chamferBox ${w}×${h}×${d} c=${c}`, D.chamferBox(w, h, d, c), { outward: true });
}
for (const [w, h, d, r, s] of [[0.4, 0.6, 0.02, 0.004, 2], [0.1, 0.1, 0.1, 0.3, 4], [1.6, 0.5, 0.7, 0.02, 3]] as const) {
  check(`filletBox ${w}×${h}×${d} r=${r}`, D.filletBox(w, h, d, r, s), { outward: true });
}
check('chamferCylinder', D.chamferCylinder(0.012, 0.4, 0.001, 14), { maxSize: [0.025, 0.41, 0.025] });
// degenerate inputs must not throw or produce NaN
check('chamferBox NaN inputs', D.chamferBox(NaN, -5, Infinity, NaN));
check('filletBox zero', D.filletBox(0, 0, 0, 0, 0));

// --- mouldings ----------------------------------------------------------
for (const name of Object.keys(D.PROFILES) as D.ProfileName[]) {
  check(`moulding run ${name}`, D.mouldingRun(name, [-1.5, 2.4, 0], [1.5, 2.4, 0]), { minTris: 4 });
}
check('roomMoulding crown 4×3.6', D.roomMoulding('ogee-crown', 4, 3.6, 2.44), { maxSize: [4.2, 0.1, 3.8] });
check('roomMoulding base 4×3.6', D.roomMoulding('colonial-base', 4, 3.6, 0), { maxSize: [4.2, 0.1, 3.8] });
check('openingCasing door', D.openingCasing(0.81, 2.03, 'colonial-casing'));
check('openingCasing window + sill', D.openingCasing(0.9, 1.2, 'craftsman-casing', { sill: true }));
for (const e of ['eased', 'bullnose', 'bevel', 'ogee', 'mitered'] as const) {
  check(`edgeProfile ${e}`, D.edgeProfile(e, 2.4, 0.03));
}
check('sweepProfile empty path', D.sweepProfile([[0, 0], [1, 0]], [[0, 0, 0]] as D.Vec3[]));

// --- door + drawer fronts ----------------------------------------------
for (const style of ['shaker', 'flat', 'slab', 'raised', 'beaded', 'glass'] as const) {
  for (const [w, h] of [[0.381, 0.727], [0.762, 0.14], [0.2286, 1.9]] as const) {
    const p = D.doorPanel(style, w, h);
    check(`${style} ${w}×${h}`, p.body, { maxSize: [w + 0.01, h + 0.01, 0.06] });
    if (p.glass) check(`${style} glass ${w}×${h}`, p.glass, { maxSize: [w, h, 0.01] });
  }
}
check('doorPanel unknown style', D.doorPanel('nonsense', 0.4, 0.7).body);

// --- hardware -----------------------------------------------------------
check('barPull 96', D.barPull(96), { maxSize: [0.12, 0.03, 0.05] });
check('barPull 320 square', D.barPull(320, { square: true }), { maxSize: [0.33, 0.04, 0.06] });
check('knob 32', D.knob(32), { maxSize: [0.04, 0.04, 0.05] });
check('knob mushroom', D.knob(38, { style: 'mushroom' }));
check('knob square', D.knob(32, { style: 'square' }));
check('knob octagon', D.knob(32, { style: 'octagon' }));
check('cupPull', D.cupPull(96), { maxSize: [0.11, 0.04, 0.04] });
check('edgePull', D.edgePull(600), { maxSize: [0.61, 0.03, 0.02] });
check('hinge euro', D.hinge());
check('hinge barrel', D.hinge({ kind: 'barrel' }));
check('hinge exposed', D.hinge({ kind: 'exposed' }));
check('shelfPin', D.shelfPin());
check('faucetGooseneck', D.faucetGooseneck(), { maxSize: [0.08, 0.5, 0.35] });
check('faucetGooseneck tall', D.faucetGooseneck({ heightM: 0.6, reachM: 0.3, tubeMm: 28 }));
check('faucetHandle lever', D.faucetHandle());
check('faucetHandle cross', D.faucetHandle({ kind: 'cross' }));
check('faucetHandle knob', D.faucetHandle({ kind: 'knob' }));
check('showerArm', D.showerArm(), { maxSize: [0.07, 0.15, 0.34] });
check('rainHead 250', D.rainHead(250), { maxSize: [0.26, 0.04, 0.26] });
check('rainHead square', D.rainHead(300, { square: true }));
check('valveTrim', D.valveTrim());
check('valveTrim square + diverter', D.valveTrim({ round: false, diverter: true }));
check('towelBar 610', D.towelBar(610), { maxSize: [0.66, 0.06, 0.10] });
check('tpHolder', D.tpHolder());
check('doorKnob', D.doorKnob());
check('doorKnob lever', D.doorKnob({ lever: true }));
check('deadbolt', D.deadbolt());
check('cabinetLatch', D.cabinetLatch());

// --- fasteners + micro-detail ------------------------------------------
check('screwHead', D.screwHead(8), { maxSize: [0.01, 0.01, 0.01] });
check('screwHead flat', D.screwHead(6, { slot: 'flat' }));
check('outletPlate duplex', D.outletPlate(), { maxSize: [0.08, 0.12, 0.02] });
check('outletPlate gfci 2-gang', D.outletPlate({ gangs: 2, kind: 'gfci' }));
check('switchPlate decora', D.switchPlate());
check('switchPlate 3-gang toggle', D.switchPlate({ gangs: 3, kind: 'toggle' }));
check('ventRegister 10×4', D.ventRegister(10, 4), { maxSize: [0.26, 0.11, 0.02] });
const can = D.ceilingCan();
check('ceilingCan trim', can.trim, { maxSize: [0.14, 0.08, 0.14] });
check('ceilingCan lens', can.lens);
check('smokeDetector', D.smokeDetector());
check('thermostat', D.thermostat());

// --- lathe / turned -----------------------------------------------------
check('turnedSpindle colonial', D.turnedSpindle(), { maxSize: [0.05, 0.79, 0.05] });
check('turnedSpindle square-tapered', D.turnedSpindle({ style: 'square-tapered' }));
check('turnedSpindle simple', D.turnedSpindle({ style: 'simple' }));
check('tableLeg turned', D.tableLeg(), { maxSize: [0.1, 0.87, 0.1] });
check('tableLeg square', D.tableLeg({ turned: false }));
check('tubFoot', D.tubFoot());
check('columnShaft', D.columnShaft(), { maxSize: [0.26, 2.61, 0.26] });
check('lathePoints degenerate', D.lathePoints([[0, 0]], 8));

// --- instancing ---------------------------------------------------------
const mat = new THREE.MeshBasicMaterial();
const baluster = D.turnedSpindle();
const many = D.instanced(baluster, mat, D.spaceAlong([-3, 0, 0], [3, 0, 0], 200));
if (many.count !== 200) fail(`instanced: count ${many.count} != 200`);
const m0 = new THREE.Matrix4(); many.getMatrixAt(0, m0);
if (!m0.elements.every(Number.isFinite)) fail('instanced: non-finite matrix');
const none = D.instanced(baluster, mat, []);
if (none.count !== 1) fail('instanced: empty list should still be valid');
const g100 = D.grid(10, 10, 0.3, 0.2, { stagger: 0.5, jitter: 0.1 });
if (g100.length !== 100) fail(`grid: ${g100.length} != 100`);
if (D.spaceAlong([0, 0, 0], [1, 0, 0], -5).length !== 0) fail('spaceAlong: negative count must be empty');

// --- reporting ----------------------------------------------------------
rows.sort((a, b) => b.tris - a.tris);
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
console.log('\nBUILDER                                  TRIS   BOUNDS (m)');
for (const r of rows) console.log(`${pad(r.name, 40)} ${pad(String(r.tris), 6)} ${r.size}`);
const total = rows.reduce((n, r) => n + r.tris, 0);
console.log(`\n${rows.length} builders, ${total} triangles total, cache holds ${D.detailCacheSize()} geometries.`);

// A realistic full kitchen: 28 doors, 18 drawers, 46 pulls, crown + base, 8 cans.
const doors = Array.from({ length: 28 }, () => D.shakerPanel(0.381, 0.727).body);
const drawers = Array.from({ length: 18 }, () => D.shakerPanel(0.559, 0.165).body);
const pulls = D.barPull(160);
const kitchenTris =
  D.triangleBudget(doors) + D.triangleBudget(drawers) +
  D.triangleCount(pulls) * 46 +
  D.triangleCount(D.roomMoulding('ogee-crown', 4.3, 3.7, 2.44)) +
  D.triangleCount(D.roomMoulding('colonial-base', 4.3, 3.7, 0)) +
  (D.triangleCount(can.trim) + D.triangleCount(can.lens)) * 8;
console.log(`Representative kitchen millwork + hardware: ${kitchenTris} triangles`);
console.log(`  (doors/drawers share geometry, so GPU-resident unique tris = ${D.triangleCount(doors[0]) + D.triangleCount(drawers[0]) + D.triangleCount(pulls)})`);



console.log('\n--- PROCEDURAL GENERATORS ---------------------------------------');
for (const q of [512, 1024, 2048] as const) {
  P.setProceduralQuality(q);
  if (P.proceduralQuality() !== q) fail(`quality knob did not take ${q}`);
}
P.setProceduralQuality(512); // keep the shimmed run cheap
checkResult('veinedSlab calacatta', P.veinedSlab({ base: '#f4f3f0', vein: '#8f9095', veinCount: 5, intensity: 0.8 }));
checkResult('veinedSlab solid quartz', P.veinedSlab({ base: '#ffffff', vein: '#ffffff', intensity: 0 }));
checkResult('veinedSlab terrazzo', P.veinedSlab({ base: '#e8e6e0', vein: '#555', speckle: 0.9, speckleRadiusM: 0.006, speckleColor2: '#b33', speckleColor3: '#38a' }));
checkResult('tiledSurface subway', P.tiledSurface({ tileW: 0.152, tileH: 0.076, color: '#f2f2ee', grout: '#c8c5be' }));
checkResult('tiledSurface hex', P.tiledSurface({ tileW: 0.05, tileH: 0.05, color: '#eee', grout: '#999', pattern: 'hex' }));
checkResult('tiledSurface herringbone', P.tiledSurface({ tileW: 0.3, tileH: 0.075, color: '#ddd', grout: '#aaa', pattern: 'herringbone' }));
checkResult('plankFloor white oak', P.plankFloor({ widthM: 0.19, lengthM: 1.8, color: '#c8a878', grain: '#5a3f26' }), { minSpan: 1.0 });
checkResult('plankFloor narrow', P.plankFloor({ widthM: 0.06, color: '#8a5f36' }));
checkResult('lapSiding 6in', P.lapSiding({ exposureM: 0.152, color: '#e8e6df' }));
checkResult('lapSiding board+batten', P.lapSiding({ exposureM: 0.152, color: '#3b3f42', batten: true }));
checkResult('woodGrain cathedral', P.woodGrain({ color: '#a9764a', grain: '#3a2416', figure: 'cathedral' }));
checkResult('woodGrain straight', P.woodGrain({ color: '#d8b98b', figure: 'straight', pores: 0 }));
checkResult('woodGrain rift', P.woodGrain({ color: '#6b4a2f', figure: 'rift' }));
checkResult('woodGrain end-grain (butcher)', P.woodGrain({ color: '#c99a5f', figure: 'end-grain', stripM: 0.05 }));
checkResult('brushedMetal x', P.brushedMetal({ color: '#c9c8c4' }), { maxSpan: 1 });
checkResult('brushedMetal radial', P.brushedMetal({ color: '#b9bcc0', direction: 'radial', grit: 1 }));
checkResult('quartzWithSpeckle', P.quartzWithSpeckle({ base: '#f6f5f2', speckle: '#c9c5bd', density: 0.8 }));
checkResult('quartzWithSpeckle veined', P.quartzWithSpeckle({ base: '#fbfaf8', vein: '#9b9ea5', veinCount: 4, veinIntensity: 0.6, sparkle: 0.6 }));
checkResult('groutedSlab 24x48', P.groutedSlab({ tileW: 0.61, tileH: 1.22, base: '#dcdad4', vein: '#a8a49c', grout: '#b6b2aa' }), { minSpan: 0.6 });
checkResult('groutedSlab 12x24', P.groutedSlab({ tileW: 0.305, tileH: 0.61, base: '#c9c6c0', grout: '#9c9890', groutM: 0.003 }));
checkResult('fabricWeave plain', P.fabricWeave({ color: '#d9d2c3' }));
checkResult('fabricWeave basket', P.fabricWeave({ color: '#8a8a84', weave: 'basket', threadM: 0.006 }));
checkResult('fabricWeave terry', P.fabricWeave({ color: '#eceae4', weave: 'terry' }));
checkResult('paintedWall eggshell', P.paintedWall({ color: '#efece5' }));
checkResult('paintedWall flat no laps', P.paintedWall({ color: '#2c2f31', sheen: 'flat', laps: 0 }));
// degenerate inputs must not throw
checkResult('woodGrain NaN options', P.woodGrain({ color: '#888', spanM: NaN as number, contrast: NaN as number, grainDensity: -5 }));
checkResult('groutedSlab tiny tile', P.groutedSlab({ tileW: 0.0001, tileH: 0.0001, base: '#fff', grout: '#000' }));

const micro = P.microNormal('stone', 128);
if (micro.width !== 128) fail(`microNormal: width ${micro.width}`);
else ok(`microNormal(stone)                     ${micro.width}px`);
for (const kind of ['paint', 'stone', 'wood', 'metal', 'ceramic', 'fabric', 'plaster'] as const) {
  const c = P.microNormal(kind, 128);
  if (!c || c.width !== 128) fail(`microNormal ${kind}`);
}
ok('microNormal all 7 surfaces');
const cav = P.cavityFromCanvas(P.tiledSurface({ tileW: 0.152, tileH: 0.076, color: '#eee', grout: '#888' }).canvas, 0.8);
if (!cav || cav.width < 128) fail('cavityFromCanvas'); else ok('cavityFromCanvas');

console.log('\n--- DETAIL-NORMAL SHADER INJECTION -------------------------------');
{
  const frag = THREE.ShaderLib.physical.fragmentShader;
  const token = '#include <normal_fragment_maps>';
  if (!frag.includes(token)) fail('physical fragment shader has no normal_fragment_maps include — injection point gone');
  else ok('injection token present in three ' + THREE.REVISION);
  const beginAt = frag.indexOf('#include <normal_fragment_begin>');
  if (beginAt < 0 || beginAt > frag.indexOf(token)) fail('normal_fragment_begin does not precede the injection point');
  else ok('tbn is in scope at the injection point');
  if (!THREE.ShaderChunk.normal_fragment_begin.includes('mat3 tbn')) fail('normal_fragment_begin no longer declares tbn');
  else ok('normal_fragment_begin declares tbn');
  // the injected snippet, exactly as materials.ts writes it
  const injected = frag.replace(token, `${token}
#if defined( USE_NORMALMAP_TANGENTSPACE )
	{
		vec3 detailN = texture2D( uDetailNormalMap, vNormalMapUv * uDetailNormalScale ).xyz * 2.0 - 1.0;
		normal = normalize( normal + tbn * vec3( detailN.xy * uDetailNormalStrength, 0.0 ) );
	}
#endif`);
  if (!injected.includes('uDetailNormalMap')) fail('injection produced no change');
  else ok('injection applies cleanly');
  const opens = (injected.match(/#if/g) ?? []).length;
  const closes = (injected.match(/#endif/g) ?? []).length;
  if (opens !== closes) fail(`preprocessor unbalanced after injection (${opens} #if vs ${closes} #endif)`);
  else ok(`preprocessor balanced (${opens} #if / #endif)`);
}

console.log('\n--- TURNED PARTS (crease-aware lathe) ----------------------------');
{
  // A cylinder with flat ends is the smallest thing that catches the defect
  // `creasedLathe` exists for: three's LatheGeometry averages the normal across
  // the 90° corner where the wall meets the cap, so the wall shades like a cone
  // and the cap like a dome. Measured on this exact profile it comes back
  // (0, -0.447, 0.894) — 26.6° off — on EVERY ring vertex.
  const wall: Array<[number, number]> = [[0, 0], [0.1, 0], [0.1, 0.2], [0, 0.2]];
  const naive = new THREE.LatheGeometry(wall.map(([r, y]) => new THREE.Vector2(r, y)), 8);
  const nn = naive.getAttribute('normal') as THREE.BufferAttribute;
  let naiveWorst = 0;
  for (let i = 0; i < nn.count; i++) {
    const p = naive.getAttribute('position') as THREE.BufferAttribute;
    const rad = Math.hypot(p.getX(i), p.getZ(i));
    if (rad < 1e-6) continue;                       // pole vertices have no radial direction
    const d = (nn.getX(i) * p.getX(i) + nn.getZ(i) * p.getZ(i)) / rad;
    naiveWorst = Math.max(naiveWorst, Math.acos(Math.min(1, Math.abs(d))) * 180 / Math.PI);
  }
  if (naiveWorst < 20) console.log(`  note three's LatheGeometry no longer smears the corner (${naiveWorst.toFixed(1)}°) — creasedLathe may be redundant`);
  else ok(`three's LatheGeometry smears the wall/cap corner by ${naiveWorst.toFixed(1)}° (the defect)`);

  const g = G.creasedLathe(wall, 8);
  check('creasedLathe cylinder', g, { maxSize: [0.201, 0.201, 0.201], minTris: 16, outward: true });
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  let wallWorst = 0, capWorst = 0;
  for (let i = 0; i < nor.count; i++) {
    const rad = Math.hypot(pos.getX(i), pos.getZ(i));
    const ny = Math.abs(nor.getY(i));
    if (rad > 1e-6 && ny < 0.5) {
      // a wall vertex: its normal must be purely radial
      const d = (nor.getX(i) * pos.getX(i) + nor.getZ(i) * pos.getZ(i)) / rad;
      wallWorst = Math.max(wallWorst, Math.acos(Math.min(1, d)) * 180 / Math.PI);
    } else if (ny >= 0.5) {
      capWorst = Math.max(capWorst, Math.acos(Math.min(1, ny)) * 180 / Math.PI);
    }
  }
  if (wallWorst > 1) fail(`creasedLathe: wall normal ${wallWorst.toFixed(1)}° off radial`);
  else ok(`creasedLathe keeps the wall radial (${wallWorst.toFixed(2)}°) and the caps flat (${capWorst.toFixed(2)}°)`);

  // …and a genuinely curved profile must still come out SMOOTH, or every bowl
  // in the room turns into a faceted bucket
  const arc: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; arc.push([0.1 * Math.sin(a), 0.1 * (1 - Math.cos(a))]); }
  const dome = G.creasedLathe(arc, 24);
  const dn = dome.getAttribute('normal') as THREE.BufferAttribute;
  const dp = dome.getAttribute('position') as THREE.BufferAttribute;
  let domeWorst = 0;
  for (let i = 0; i < dn.count; i++) {
    // on a sphere centred at (0, 0.1, 0) the normal IS the outward radius
    const x = dp.getX(i), y = dp.getY(i) - 0.1, z = dp.getZ(i);
    const l = Math.hypot(x, y, z);
    if (l < 1e-6) continue;
    const d = (dn.getX(i) * x + dn.getY(i) * y + dn.getZ(i) * z) / l;
    domeWorst = Math.max(domeWorst, Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI);
  }
  if (domeWorst > 8) fail(`creasedLathe: smooth arc creased (${domeWorst.toFixed(1)}° off the true sphere normal)`);
  else ok(`creasedLathe keeps a curve smooth (${domeWorst.toFixed(2)}° off the true sphere normal)`);

  // no degenerate triangles at the poles — three emits one per segment there
  let degen = 0;
  const gi = g.getIndex()!;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  for (let t = 0; t < gi.count; t += 3) {
    va.fromBufferAttribute(pos, gi.getX(t)); vb.fromBufferAttribute(pos, gi.getX(t + 1)); vc.fromBufferAttribute(pos, gi.getX(t + 2));
    if (vb.sub(va).cross(vc.sub(va)).lengthSq() < 1e-18) degen++;
  }
  if (degen) fail(`creasedLathe: ${degen} degenerate triangles`);
  else ok('creasedLathe emits no degenerate pole triangles');

  // garbage in, geometry out
  check('creasedLathe (NaN / duplicate / negative points)', G.creasedLathe(
    [[NaN, 0], [0.05, 0], [0.05, 0], [-1, 0.1], [0.05, 0.2]] as Array<[number, number]>, 5000));

  // the segment rule: monotonic, bounded, and scaled to the part
  const sizes: Array<[number, number]> = [[0.002, 8], [0.006, 10], [0.035, 22], [0.09, 34], [0.17, 46], [5, 48]];
  let segOk = true;
  let prev = 0;
  for (const [r, want] of sizes) {
    const n = G.latheSegments(r);
    if (n < prev) { fail(`latheSegments not monotonic at r=${r} (${n} < ${prev})`); segOk = false; }
    if (Math.abs(n - want) > 2) { fail(`latheSegments(${r}) = ${n}, expected ~${want}`); segOk = false; }
    prev = n;
  }
  for (const bad of [NaN, Infinity, -1, 0]) {
    const n = G.latheSegments(bad);
    if (!Number.isFinite(n) || n < 8 || n > 48) { fail(`latheSegments(${bad}) = ${n}`); segOk = false; }
  }
  if (segOk) ok(`latheSegments scales 8 → 48 with radius (${sizes.map(([r]) => `${r}m:${G.latheSegments(r)}`).join(' ')})`);
}

console.log('\n--- LOFTED SHELLS (a fold has to stay a fold) --------------------');
{
  /* eslint-disable @typescript-eslint/no-require-imports */
  const KH = require('../src/components/scene/kitchen/helpers') as typeof import('../src/components/scene/kitchen/helpers');
  // `computeVertexNormals()` averages every face at a vertex, which is right on
  // a curve and wrong at an edge. The bell hood's rolled lip and the saddle
  // seat's rim each turn ~90° between two bands, and before `loftRings` learnt
  // to split there the averaged normal was 89.6° / 79.9° away from its own face
  // — a lip that shades like a soft dent instead of catching a specular line.
  const cases: Array<[string, THREE.BufferGeometry]> = [
    ['bell hood', KH.hoodBell(0.9, 0.6, 0.3, 0.22, 0.45)],
    ['saddle seat', KH.saddleSeat(0.42, 0.33, 0.04)],
    ['tapered canopy', KH.hoodCanopy(0.3, 0.22, 0.9, 0.6, 0.3)],
    ['sink basin', KH.sinkBasin(0.7, 0.45, 0.23)],
  ];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  for (const [name, g] of cases) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    let worst = 0;
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      e1.subVectors(b, a); e2.subVectors(c, a); fn.crossVectors(e1, e2);
      if (fn.lengthSq() < 1e-18) continue;
      fn.normalize();
      for (const i of [i0, i1, i2]) {
        const d = Math.abs(nor.getX(i) * fn.x + nor.getY(i) * fn.y + nor.getZ(i) * fn.z);
        worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI);
      }
    }
    if (worst > 45) fail(`${name}: vertex normal ${worst.toFixed(1)}° from its own face — a fold got averaged away`);
    else ok(`${name.padEnd(15)} worst shading normal ${worst.toFixed(1)}° off its face (budget 45°)`);
  }
}

console.log('\n--- PART-LIST SHADING (built kitchen) ----------------------------');
{
  /* eslint-disable @typescript-eslint/no-require-imports */
  const LAY = require('../src/components/scene/kitchen/layout') as typeof import('../src/components/scene/kitchen/layout');
  const BUD = require('../src/components/scene/kitchen/budget') as typeof import('../src/components/scene/kitchen/budget');
  const parts = BUD.buildKitchenPartsRaw(LAY.computeKitchenLayout(DEF.defaultKitchen()));
  const seen = new Set<string>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  let geos = 0, zeroNormals = 0, backFacing = 0, degenerate = 0, tris = 0;
  const worstBack: string[] = [];
  const worstDegen: Array<{ key: string; frac: number }> = [];
  for (const p of parts) {
    const g = p.geometry;
    if (seen.has(g.uuid)) continue;
    seen.add(g.uuid);
    geos++;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!nor) { fail(`${p.key}: no normals`); continue; }
    for (let i = 0; i < nor.count; i++) {
      const l = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (!Number.isFinite(l) || l < 0.5) zeroNormals++;
    }
    const idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    let localBack = 0, localDegen = 0;
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      e1.subVectors(b, a); e2.subVectors(c, a); fn.crossVectors(e1, e2);
      tris++;
      if (fn.lengthSq() < 1e-18) { localDegen++; continue; }
      fn.normalize();
      // a shading normal that points AWAY from its own face renders black
      for (const i of [i0, i1, i2]) {
        if (nor.getX(i) * fn.x + nor.getY(i) * fn.y + nor.getZ(i) * fn.z < -0.1) localBack++;
      }
    }
    backFacing += localBack;
    degenerate += localDegen;
    if (localBack) worstBack.push(`${p.key}(${localBack})`);
    if (localDegen / Math.max(1, n / 3) > 0.15) worstDegen.push({ key: p.key, frac: localDegen / (n / 3) });
  }
  if (zeroNormals) fail(`${zeroNormals} zero-length vertex normals across the kitchen (they render black)`);
  else ok(`no zero-length vertex normals (${geos} unique geometries, ${tris.toLocaleString()} triangles)`);
  if (backFacing) fail(`${backFacing} vertex normals oppose their own face: ${worstBack.slice(0, 6).join(' ')}`);
  else ok('no vertex normal opposes its own face (bowl interiors shade right)');
  const frac = degenerate / Math.max(1, tris);
  if (frac > 0.05) fail(`${(frac * 100).toFixed(1)}% of kitchen triangles are degenerate (budget 5%)`);
  else ok(`${(frac * 100).toFixed(1)}% degenerate triangles (budget 5%)`);
  if (worstDegen.length) {
    console.log(`  note ${worstDegen.length} geometries are >15% degenerate — all from three's lathe poles in detail.ts:`);
    for (const w of worstDegen.sort((x, y) => y.frac - x.frac).slice(0, 4)) console.log(`       ${(w.frac * 100).toFixed(0)}%  ${w.key}`);
  }
}

console.log('\n--- SHADOW MAP TYPE ----------------------------------------------');
{
  // three 0.185 falls back from deprecated PCFSoftShadowMap every render.
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const three = fs.readFileSync(path.join(process.cwd(), 'node_modules/three/build/three.cjs'), 'utf8');
  const at = three.indexOf('const shadowMapTypeDefines');
  const table = at >= 0 ? three.slice(at, at + 220) : '';
  const softMapped = /PCFSoftShadowMap/.test(table);
  if (softMapped) console.log('  note PCFSoftShadowMap IS mapped in this three build — SceneCanvas may use either');
  else ok('confirmed: PCFSoftShadowMap has no dedicated shader in this three build');
  const canvasSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/scene/SceneCanvas.tsx'), 'utf8');
  if (!softMapped && /shadowMap\.type\s*=\s*THREE\.PCFSoftShadowMap/.test(canvasSrc)) fail('SceneCanvas still sets deprecated PCFSoftShadowMap');
  else if (/shadowMap\.type\s*=\s*THREE\.PCFShadowMap/.test(canvasSrc)) ok('SceneCanvas sets PCFShadowMap (5-tap Vogel disk, honours shadow.radius)');
  else fail('SceneCanvas sets no recognisable shadow map type');
  if (!/shadows=\{\{\s*type:\s*THREE\.PCFShadowMap\s*\}\}/.test(canvasSrc)) fail('Canvas reconfiguration can reset the renderer to R3F\'s deprecated shadow default');
  else ok('Canvas and RendererSetup both explicitly select the supported shadow type');
}

console.log('\n--- SURFACE RELIEF (heightfields) --------------------------------');
{
  // Color alone is not relief: grout is lower but a dark mineral vein in a
  // polished slab is flush. Tile carries its own geometric heightfield.
  const tile = P.tiledSurface({ tileW: 0.152, tileH: 0.076, color: '#3A4759', grout: '#B9B6AC' });
  if (!tile.height) fail('tiledSurface emits no heightfield — grout relief still follows colour');
  else if (tile.height === tile.canvas) fail('tiledSurface returned its colour canvas as the heightfield');
  else if (tile.height.width !== tile.canvas.width || tile.height.height !== tile.canvas.height) {
    fail(`tiledSurface heightfield ${tile.height.width}×${tile.height.height} != colour ${tile.canvas.width}×${tile.canvas.height}`);
  } else ok(`tiledSurface emits a separate ${tile.height.width}px heightfield`);
  for (const pat of ['hex', 'herringbone', 'stacked'] as const) {
    const r = P.tiledSurface({ tileW: 0.1, tileH: 0.05, color: '#eee', grout: '#333', pattern: pat });
    if (!r.height || r.height.width !== r.canvas.width) fail(`tiledSurface(${pat}) heightfield missing or mis-sized`);
  }
  ok('tiledSurface heightfield covers hex, herringbone and stacked too');
  const gs = P.groutedSlab({ tileW: 0.61, tileH: 1.22, base: '#dcdad4', vein: '#a8a49c', grout: '#f0ede6' });
  if (!gs.height) fail('groutedSlab emits no heightfield — printed stone movement would be embossed');
  else ok(`groutedSlab emits a separate ${gs.height.width}px heightfield`);

  // How much this actually mattered: count the catalog's tile recipes whose
  // grout is LIGHTER than their tile. Every one of those was pushing its joint
  // OUT into a ridge and making the grout the glossiest thing on the wall.
  const lum = (hex: string) => { const c = new THREE.Color(hex); return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; };
  let tiles = 0, inverted = 0;
  for (const def of CAT.CATALOG) {
    const pr = def.pbr.procedural;
    if (!pr || pr.kind !== 'tile') continue;
    const o = pr.options as { color?: string; grout?: string };
    if (typeof o.color !== 'string' || typeof o.grout !== 'string') continue;
    tiles++;
    if (lum(o.grout) > lum(o.color)) inverted++;
  }
  if (tiles === 0) fail('no tile recipes found in the catalog — the inversion probe is not testing anything');
  else ok(`${inverted} of ${tiles} catalog tile recipes have grout LIGHTER than the tile (all were inverted before the heightfield)`);
}

console.log('\n--- LIGHT MATH ---------------------------------------------------');
{
  const TIERS = ['high', 'balanced', 'performance'] as const;
  // 1. penumbra is a property of the LIGHT, not of the quality menu
  const extent = 6.45; // a 4.3 m kitchen's key shadow camera
  const widths = TIERS.map((q) => LM.penumbraWidthM(LM.shadowSettings(q, 1, extent)));
  const spread = Math.max(...widths) - Math.min(...widths);
  if (spread > 0.0005) fail(`penumbra varies by ${(spread * 1000).toFixed(1)} mm across tiers: ${widths.map((w) => (w * 1000).toFixed(1)).join(' / ')} mm`);
  else ok(`penumbra constant across tiers at ${(widths[0] * 1000).toFixed(1)} mm (was 10 mm high / 20 mm performance)`);
  for (const q of TIERS) {
    const s = LM.shadowSettings(q, 1, extent);
    if (!(s.radius >= 0.6 && s.radius <= 6)) fail(`${q}: PCF radius ${s.radius} outside [0.6, 6]`);
    if (!(s.normalBias >= 0.002 && s.normalBias <= 0.03)) fail(`${q}: normalBias ${s.normalBias} outside [2, 30] mm`);
  }
  const nb = TIERS.map((q) => LM.shadowSettings(q, 1, extent).normalBias);
  if (!(nb[0] < nb[1] && nb[1] < nb[2])) fail(`normalBias does not follow texel size: ${nb.join(' / ')}`);
  else ok(`normalBias tracks texel footprint: ${nb.map((n) => (n * 1000).toFixed(1)).join(' / ')} mm (high / balanced / performance)`);
  // degenerate inputs must not produce a NaN a light would silently swallow
  for (const bad of [0, -5, NaN, 1e9]) {
    const s = LM.shadowSettings('balanced', 1, bad as number);
    if (!Number.isFinite(s.radius) || !Number.isFinite(s.normalBias)) fail(`shadowSettings(extent=${bad}) produced NaN`);
  }
  ok('shadowSettings survives extent 0 / negative / NaN / 1e9');

  // 2. ortho depth bias is a constant WORLD distance
  for (const range of [4, 13, 60, 220]) {
    const mm = Math.abs(LM.orthoBias(range)) * range * 1000;
    if (Math.abs(mm - 0.6) > 1e-6) fail(`orthoBias(${range}) is ${mm.toFixed(3)} mm, not 0.6 mm`);
  }
  ok('orthoBias holds 0.6 mm of world offset over ranges 4 → 220 m');

  // 3. the under-cabinet strip is aimed at the backsplash, not past it
  const aim = LM.underCabAim();
  if (!(aim.y < 0)) fail(`under-cabinet light aims up (y=${aim.y.toFixed(3)})`);
  if (!(aim.z < 0)) fail(`under-cabinet light aims into the room (z=${aim.z.toFixed(3)}), away from the splash`);
  if (!(aim.towardSplash > 0.3 && aim.towardSplash < 0.6)) fail(`under-cabinet splash fraction ${aim.towardSplash.toFixed(2)} outside 0.30–0.60`);
  else ok(`under-cabinet strip sends ${(aim.towardSplash * 100).toFixed(0)}% of its flux at the splash (straight down sends 0%)`);
  if (Math.abs(LM.underCabAim(0).towardSplash) > 1e-9) fail('the zero-tilt control case is not aimed straight down');

  // 4. bounce follows the floor the user actually chose
  if (LM.floorBounce(undefined, '#fbfaf7').gain !== 1) fail('an unknown floor must leave the bounce alone');
  if (LM.floorBounce('no-such-material', '#fbfaf7').color !== '#fbfaf7') fail('an unresolved id must leave the bounce colour alone');
  // ordering: over the whole flooring catalog, a lighter floor must never
  // bounce less than a darker one. Most flooring recipes carry their colour
  // inside the procedural options, so the swatch is the readable stand-in —
  // exactly the fallback floorBounce itself uses.
  const floors = CAT.CATALOG.filter((d) => d.slots.includes('flooring'));
  const scored = floors.map((d) => {
    const hex = COL.materialColor(d);
    if (!hex) return null;
    const c = new THREE.Color(hex);
    return { id: d.id, lum: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, gain: LM.floorBounce(d.id, '#fbfaf7').gain };
  }).filter((x): x is { id: string; lum: number; gain: number } => x !== null).sort((a, b) => a.lum - b.lum);
  for (const f of scored) if (!(f.gain >= 0.35 && f.gain <= 1.3)) fail(`floorBounce(${f.id}) gain ${f.gain} outside its bounds`);
  if (scored.length < 20) fail(`only ${scored.length} of ${floors.length} flooring materials resolve a colour — the bounce is a no-op for the rest`);
  // a photographed floor's swatch is a texture PATH, not a colour. It must be
  // resolved through the measured texture-colour table, never parsed as one.
  const photo = CAT.CATALOG.find((d) => d.slots.includes('flooring') && typeof d.swatch === 'string' && d.swatch.startsWith('/textures/'));
  if (photo) {
    const b = LM.floorBounce(photo.id, '#fbfaf7');
    if (b.color === '#ffffff' || b.gain > 1.29) fail(`floorBounce read the texture path of ${photo.id} as white (gain ${b.gain}, ${b.color})`);
    else ok(`a photo-textured floor (${photo.id}) resolves to ${b.color}, gain ${b.gain.toFixed(2)} — not parsed as white`);
  }
  let mono = true;
  for (let i = 1; i < scored.length; i++) if (scored[i].gain < scored[i - 1].gain - 1e-9) mono = false;
  if (!mono) fail('floorBounce gain is not monotone in floor lightness');
  else if (scored.length >= 2) ok(`floorBounce over ${scored.length} floors: ${scored[0].id} ${scored[0].gain.toFixed(2)} → ${scored[scored.length - 1].id} ${scored[scored.length - 1].gain.toFixed(2)}`);

  // 5. warm/cool: an evening is carried by the practicals, a daylight is not
  const day = LM.practicalBlend(0.6), eve = LM.practicalBlend(1.9);
  if (!(day < eve && eve <= 0.75)) fail(`practicalBlend daylight ${day} / evening ${eve} is not ordered and capped`);
  else ok(`bounce sits ${(day * 100).toFixed(0)}% toward the lamps at daylight and ${(eve * 100).toFixed(0)}% in the evening`);
}

console.log('\n--- QUALITY TIERS ------------------------------------------------');
{
  const phones: Array<[string, Parameters<typeof LM.qualityForDevice>[0], LM.LightQuality]> = [
    ['iPhone with WebKit core bucketing', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', hardwareConcurrency: 4 }, 'balanced'],
    ['iPhone with reduced hardware reporting', { userAgent: 'iPhone Mobile', hardwareConcurrency: 2 }, 'balanced'],
    ['iPad desktop browsing', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15', hardwareConcurrency: 4, maxTouchPoints: 5 }, 'balanced'],
    ['small Android phone', { userAgent: 'Android Mobile', hardwareConcurrency: 4, deviceMemory: 2 }, 'performance'],
    ['capable Android phone', { userAgent: 'Android Mobile', hardwareConcurrency: 8, deviceMemory: 8 }, 'balanced'],
    ['desktop workstation', { userAgent: 'Macintosh', hardwareConcurrency: 8, maxTouchPoints: 0 }, 'high'],
  ];
  for (const [name, device, expected] of phones) {
    const actual = LM.qualityForDevice(device);
    if (actual !== expected) fail(`${name}: expected ${expected}, got ${actual}`);
    else ok(`${name}: ${actual}`);
  }
  const T = LM.QUALITY;
  const order = ['performance', 'balanced', 'high'] as const;
  // every axis must be monotone: a higher tier may never buy you LESS
  const axes: Array<[string, (q: LM.QualityTier) => number]> = [
    ['dpr ceiling', (q) => q.dpr[1]],
    ['texture px', (q) => q.texturePx],
    ['anisotropy', (q) => q.anisotropy],
    ['MSAA', (q) => q.msaa],
    ['shadow map', (q) => q.shadowMap],
    ['window rects', (q) => q.windowRects],
    ['casting cans', (q) => q.castingCans],
    ['detail normal', (q) => (q.detailNormal ? 1 : 0)],
    ['AO', (q) => (q.ao ? 1 : 0)],
    ['grade', (q) => (q.grade ? 1 : 0)],
    ['contact shadows', (q) => (q.contactShadows ? 1 : 0)],
  ];
  for (const [name, get] of axes) {
    const vals = order.map((q) => get(T[q]));
    if (!(vals[0] <= vals[1] && vals[1] <= vals[2])) fail(`quality tier "${name}" is not monotone: ${order.map((q, i) => `${q} ${vals[i]}`).join(', ')}`);
  }
  ok(`${axes.length} quality axes are monotone across performance → balanced → high`);
  // and the low tier has to actually be low, or "auto" on a phone is a lie
  const p = T.performance;
  if (p.ao || p.grade || p.detailNormal || p.contactShadows || p.windowRects !== 0 || p.castingCans !== 0) {
    fail('the performance tier still pays for area lights / AO / grade / contact shadows');
  } else ok('performance drops every area light, the AO, the grade, the contact pass and the detail normal');
  // strictly cheaper on the continuous axes too
  for (const [name, get] of axes.slice(0, 5)) {
    if (get(p) >= get(T.high)) fail(`performance is not cheaper than high on "${name}"`);
  }
  ok(`performance vs high: ${p.texturePx}px/${p.anisotropy}× vs ${T.high.texturePx}px/${T.high.anisotropy}×, shadow ${p.shadowMap} vs ${T.high.shadowMap}, dpr ${p.dpr[1]} vs ${T.high.dpr[1]}`);
}

console.log('\n--- RENDERER + MATERIAL WIRING -----------------------------------');
{
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const canvasSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/scene/SceneCanvas.tsx'), 'utf8');
  const matSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/scene/materials.ts'), 'utf8');
  const litSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/scene/Lighting.tsx'), 'utf8');

  if (!/setMaxAnisotropy\(gl\.capabilities\.getMaxAnisotropy\(\)\)/.test(canvasSrc)) fail('SceneCanvas never reads the GPU anisotropy cap — every texture stays at the default');
  else ok('SceneCanvas reads the device anisotropy cap in the renderer setup');
  if (/<AdaptiveDpr[^>]*pixelated/.test(canvasSrc)) fail('AdaptiveDpr still upscales nearest-neighbour (pixelated) when the frame rate dips');
  else ok('AdaptiveDpr scales smoothly, not pixelated');
  if (!/if \(changed\) applyAnisotropy\(\)/.test(matSrc)) fail('a quality change does not re-filter live textures — the control does nothing to a standing scene');
  else ok('a quality change re-filters every live texture');
  // one table, three consumers: a tier that is only written down in one of
  // them is a tier the other two silently ignore, which is how the lights ended
  // up disconnected from the quality menu in the first place
  for (const [what, src] of [['SceneCanvas', canvasSrc], ['materials', matSrc], ['Lighting', litSrc]] as const) {
    if (!/QUALITY\[/.test(src) && !/QUALITY\b/.test(src)) fail(`${what} does not read the shared quality table`);
  }
  ok('the canvas, the material factory and the lighting rigs all read one quality table');

  // every brushed metal in the catalog now actually gets a brush
  const brushRe = /const BRUSHED_RE = (\/.*?\/[a-z]*);/.exec(matSrc);
  const polishRe = /const POLISHED_RE = (\/.*?\/[a-z]*);/.exec(matSrc);
  if (!brushRe || !polishRe) fail('could not read BRUSHED_RE / POLISHED_RE out of materials.ts');
  else if (!/attachBrush\(m, r\.color/.test(matSrc)) fail('applyRealism never calls attachBrush — brushed metals are still flat colours');
  else {
    const B = eval(brushRe[1]) as RegExp, Pol = eval(polishRe[1]) as RegExp;
    const brushed = CAT.CATALOG.filter((d) => {
      const text = `${d.id} ${d.name} ${(d.tags ?? []).join(' ')}`;
      return d.pbr.metalness >= 0.55 && B.test(text) && !Pol.test(text) && !d.pbr.texture && !d.pbr.procedural;
    });
    if (brushed.length === 0) fail('no catalog metal reaches the brush path');
    else ok(`${brushed.length} flat-colour catalog metals now get a real brush (e.g. ${brushed.slice(0, 3).map((d) => d.id).join(', ')})`);
  }
  if (!/attachBrush\(m, hex, brush/.test(matSrc)) fail('the utility metals (faucets, pulls, appliance panels) do not get a brush');
  else ok('utilMaterial brushed finishes get the same grain');
  // a photo-matched metal must not end up glossier than the catalog metal
  // standing next to it: its recipe carries no jointRoughness, so the
  // roughness map has to be derived from the brush drawing explicitly
  if (!/spec\.kind === 'brushed-metal'[\s\S]{0,700}roughnessFromCanvas/.test(matSrc)) fail('a custom brushed metal gets no roughness map — it will read glossier and flatter than the catalog equivalent');
  else ok('a photo-matched brushed metal derives its roughness from the same brush the catalog metals use');
  // and the heightfield actually reaches the normal / roughness / cavity maps
  if (!/const relief = res\.height \?\? res\.canvas/.test(matSrc)) fail('buildProcedural still derives relief from the colour canvas');
  else ok('buildProcedural derives normal, roughness and cavity from the heightfield when there is one');

  // the rigs are wired to the quality control at all
  if (!/quality: qualityProp/.test(litSrc) || !/const quality = qualityProp \?\? auto/.test(litSrc)) fail('InteriorRig/ExteriorRig still default their quality to a hard-coded tier');
  else ok('the rigs default to the studio quality control instead of a hard-coded "balanced"');
  if (!/<ContactShadows[\s\S]{0,400}far=\{0\.45\}/.test(litSrc)) fail('the interior rig has no floor contact shadow');
  else ok('the interior rig throws a real contact shadow in the bottom 0.45 m');
}

console.log('\n--- DRAWN FINISH FIDELITY ----------------------------------------');
{
  // The shim retains the real ImageData underlay. Ignore stroked grain/veins
  // here to test colour encoding independently of the artistic pattern.
  const meanHex = (canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) rgb[c] += data[i + c];
    return COL.rgbToHex(...rgb.map((v) => v / (data.length / 4)) as [number, number, number]);
  };
  for (const color of ['#808080', '#63412C', '#A99A84', '#232326', '#F4F3EE']) {
    const wood = meanHex(P.woodGrain({ color, colorAlt: color, contrast: 0, pores: 0, px: 256 }).canvas);
    const slab = meanHex(P.veinedSlab({ base: color, vein: color, intensity: 0, px: 256 }).canvas);
    for (const [kind, got] of [['wood', wood], ['slab', slab]]) {
      const de = COL.deltaE(color, got);
      if (de > 2) fail(`${kind} colour ${color} drew ${got}, ΔE ${de.toFixed(2)} > 2 before lighting`);
      else ok(`${kind} colour ${color} → drawn ${got}, ΔE ${de.toFixed(2)}`);
    }
  }
  for (const [tileW, tileH] of [[0.61, 1.22], [0.3, 0.9], [1.2, 0.4]]) {
    const o = { tileW, tileH, groutM: 0.002, base: '#B0AFA9', grout: '#ffffff', px: 256, seed: 12 };
    const s = P.groutedSlabSpans(o), r = P.groutedSlab(o);
    const errorM = Math.max(Math.abs(s.spanM / s.cols - s.groutM - tileW), Math.abs(s.spanVM / s.rows - s.groutM - tileH));
    if (errorM > 1e-6 || r.spanVM !== s.spanVM) fail(`slab ${tileW}×${tileH}: distorted physical module (${errorM} m)`);
    const blits = (r.canvas as unknown as { blits: Array<{ x: number; y: number; w: number; h: number }> }).blits;
    let missed = 0;
    for (let row = 0; row < s.rows; row++) for (let col = 0; col < s.cols; col++) {
      const batch = blits.slice((row * s.cols + col) * 4, (row * s.cols + col + 1) * 4);
      for (const u of [0.001, 0.5, 0.999]) for (const v of [0.001, 0.5, 0.999]) {
        const x = col * 256 / s.cols + u * tileW * 256 / s.spanM;
        const y = row * 256 / s.rows + v * tileH * 256 / s.spanVM;
        if (!batch.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) missed++;
      }
    }
    if (missed) fail(`slab ${tileW}×${tileH}: ${missed} face samples are uncovered by the stone drawing`);
    else ok(`slab ${tileW}×${tileH}: exact module; every tile face covered; ${blits.length} blits`);
  }
  for (const style of ['shaker', 'raised', 'beaded', 'glass'] as const) {
    const g = D.doorPanel(style, 0.5, 0.8).body;
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv'), normal = g.getAttribute('normal');
    let rails = 0, stiles = 0, wrong = 0;
    for (let i = 0; i < pos.count; i++) {
      if (normal.getZ(i) < 0.99) continue;
      const x = pos.getX(i), y = pos.getY(i), v = uv.getY(i);
      if (Math.abs(x) < 0.193 && Math.abs(y) > 0.35) { rails++; if (Math.abs(v - x) > 1e-5) wrong++; }
      if (Math.abs(x) > 0.20 && Math.abs(y) < 0.4) { stiles++; if (Math.abs(v - y) > 1e-5) wrong++; }
    }
    if (!rails || !stiles || wrong) fail(`${style}: ${wrong} incorrect grain UVs, rails=${rails}, stiles=${stiles}`);
    else ok(`${style}: rail grain horizontal, stile grain vertical; unchanged mesh budget`);
  }
  const granite = CAT.getMaterial('ct-grey-granite')!;
  const chip = Number(granite.pbr.procedural?.options.speckleRadiusM);
  if (!(chip >= 0.0005 && chip <= 0.005)) fail(`grey granite chip radius ${chip} m is outside 0.5–5 mm`);
  else ok(`grey granite chip radius ${(chip * 1000).toFixed(1)} mm`);
  for (const apertureIn of [2, 4, 6]) {
    const can = D.ceilingCan({ apertureIn });
    can.trim.computeBoundingBox(); can.lens.computeBoundingBox();
    const body = can.trim.boundingBox!, lens = can.lens.boundingBox!;
    if (body.min.y < -0.0031 || body.max.y <= 0 || lens.min.y < -0.0011) fail(`${apertureIn}in recessed light hangs below its ceiling (${body.min.y}m body, ${lens.min.y}m lens)`);
    else ok(`${apertureIn}in can: housing above ceiling, trim ${(Math.abs(body.min.y) * 1000).toFixed(1)}mm below`);
  }
}

console.log('\n--- RENDER PROMPT FIDELITY ---------------------------------------');
{
  const specs = [DEF.defaultKitchen(), DEF.defaultBathroom(), DEF.defaultExterior()];
  for (const spec of specs) {
    const selections = { ...(CAT.DEFAULT_SELECTIONS as Record<string, Record<string, string>>)[spec.roomType] };
    const geo = PR.describeGeometry(spec);
    if (geo.length < 4) fail(`${spec.roomType}: geometry brief only ${geo.length} lines`);
    if (geo.some((l) => /NaN|undefined|\[object/.test(l))) fail(`${spec.roomType}: geometry brief contains NaN/undefined`);
    const vp = PR.buildRenderPrompt(spec, selections, undefined, 'viewport');
    for (const must of ['DO NOT RESTYLE', 'DO NOT RE-STAGE', 'DO NOT CHANGE THE CAMERA', 'COPY THE REFERENCE IMAGE EXACTLY', 'CAMERA:', 'HARD CONSTRAINTS']) {
      if (!vp.includes(must)) fail(`${spec.roomType} viewport prompt missing "${must}"`);
    }
    if (/NaN|undefined|\[object/.test(vp)) fail(`${spec.roomType} viewport prompt contains NaN/undefined`);
    const photo = PR.buildRenderPrompt(spec, selections, undefined, 'photo');
    if (!photo.includes('KEEP EVERYTHING ELSE EXACTLY AS IN THE SOURCE PHOTO')) fail(`${spec.roomType} photo prompt lost its surgical clause`);
    const surgical = PR.buildRenderPrompt(spec, selections, [Object.keys(selections)[0]], 'photo');
    if (!surgical.includes('CHANGE ONLY these finishes')) fail(`${spec.roomType} changed-slot prompt lost "CHANGE ONLY"`);
    ok(`${spec.roomType.padEnd(9)} geometry ${String(geo.length).padStart(2)} lines, viewport prompt ${vp.length} chars, photo ${photo.length} chars`);
  }
  // a spec full of garbage must still produce a prompt, never throw
  const broken = DEF.defaultKitchen() as unknown as Record<string, unknown>;
  (broken.dims as Record<string, number>).widthFt = NaN;
  (broken as { runs: unknown[] }).runs = [];
  (broken as { appliances: unknown[] }).appliances = [];
  (broken as { openings: unknown[] }).openings = [];
  const p2 = PR.buildRenderPrompt(broken as never, {}, undefined, 'viewport');
  if (!p2.includes('HARD CONSTRAINTS')) fail('degenerate spec produced no prompt');
  else ok('degenerate spec still produces a full prompt');
}

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
