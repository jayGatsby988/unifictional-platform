/**
 * MANHATTAN — headless verification for the BATHROOM twin.
 *
 *   npx tsx scripts/check-bathroom.ts
 *
 * Two things, with no browser and no dev server:
 *
 *  1. BUILDER SANITY. Every exported builder in `scene/bathroom/helpers.ts` is
 *     instantiated over nominal and hostile inputs (NaN, zero, negative,
 *     absurd) and checked for finite positions, finite world-space UVs,
 *     unit-length normals, a non-zero triangle count and a sane bounding box.
 *     Their triangle costs are printed so a scene author can budget.
 *
 *  2. SCENE BUDGET. For four representative bathrooms the script builds the
 *     SAME geometry the components build — same builders, same arguments, off
 *     the same `computeBathroomLayout` result — and reports the draw calls and
 *     triangles. Draw calls are counted per mesh the component tree emits
 *     (`<Surface/>`, `<Prop/>` = 1 each; `<InstancedSurface/>` = 1 regardless
 *     of instance count). The hard budget is 900 draw calls / 1.2 M triangles
 *     for a full scene at High quality.
 *
 * This is an inventory, not a renderer: it mirrors the component tree rather
 * than executing React. Keep it in step when a component gains or loses a mesh.
 */
import * as THREE from 'three';
import * as H from '../src/components/scene/bathroom/helpers';
import { computeBathroomLayout, DECOR_CLEAR, distToRect, type BathLayout, type LArt, type LShelf, type Rect } from '../src/components/scene/bathroom/layout';
import { triangleCount, transformed, mergeDetail, barPull, doorPanel, openingCasing, outletPlate, switchPlate, towelBar, ventRegister, doorKnob, hinge, DOOR_REVEAL } from '../src/components/scene/detail';
import { wallFace, wallFrame, wallWithOpenings, worldPlane } from '../src/components/scene/geometry';
import { bathroomWallHoles, clipTileJoint, showerFaces, showerHardwareLayout, showerNicheFrame } from '../src/components/scene/bathroom/envelope';
import { inch } from '../src/lib/units';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultBathroom, emptyDecor } from '../src/lib/spec/defaults';
import type { BathroomSpec, DecorSpec } from '../src/lib/spec/types';

let failures = 0;
let checks = 0;
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);

// ---------------------------------------------------------------------------
// 1. Builder sanity
// ---------------------------------------------------------------------------
function inspect(name: string, g: THREE.BufferGeometry, maxSpan = 8): string | null {
  const pos = g.getAttribute('position');
  if (!pos || pos.count === 0) return 'no positions';
  const arr = pos.array as ArrayLike<number>;
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return `non-finite position at ${i}`;
  const uv = g.getAttribute('uv');
  if (!uv) return 'no world-space UVs';
  const ua = uv.array as ArrayLike<number>;
  for (let i = 0; i < ua.length; i++) if (!Number.isFinite(ua[i])) return `non-finite uv at ${i}`;
  const nor = g.getAttribute('normal');
  if (nor) {
    const na = nor.array as ArrayLike<number>;
    for (let i = 0; i + 2 < na.length; i += 3) {
      const l = Math.hypot(na[i], na[i + 1], na[i + 2]);
      if (!Number.isFinite(l)) return `non-finite normal at ${i}`;
      if (l > 1e-6 && Math.abs(l - 1) > 1e-2) return `normal not unit length (${l.toFixed(4)}) at ${i}`;
    }
  }
  const tris = triangleCount(g);
  if (tris <= 0) return 'zero triangles';
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb) return 'no bounding box';
  const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  if (!Number.isFinite(span)) return 'non-finite bounding box';
  if (span > maxSpan) return `spans ${span.toFixed(2)} m, expected under ${maxSpan} m`;
  void name;
  return null;
}

const NASTY = [NaN, Infinity, -Infinity, 0, -5, 1e9, undefined] as unknown as number[];

interface Case { name: string; build: () => THREE.BufferGeometry; span?: number }
const CASES: Case[] = [
  { name: 'slabWithCutouts (vanity top, 2 basins)', build: () => H.slabWithCutouts(1.5, 0.032, 0.56, [{ x: -0.38, z: 0, w: 0.42, d: 0.32, r: 0.08 }, { x: 0.38, z: 0, w: 0.42, d: 0.32, r: 0.08 }]) },
  { name: 'counterTop eased', build: () => H.counterTop(1.5, 0.56, 0.032, 'eased', [{ x: 0, z: 0, w: 0.42, d: 0.32 }]) },
  { name: 'counterTop bullnose', build: () => H.counterTop(1.5, 0.56, 0.032, 'bullnose', []) },
  { name: 'counterTop ogee', build: () => H.counterTop(1.2, 0.56, 0.032, 'ogee', []) },
  { name: 'floorWithHoles', build: () => H.floorWithHoles(3.6, 3.0, [{ minX: 0.4, maxX: 1.5, minZ: -1.4, maxZ: -0.4 }]), span: 4 },
  { name: 'tileEdge bullnose', build: () => H.tileEdge(2.4, 0.010, 'bullnose'), span: 3 },
  { name: 'tileEdge schluter', build: () => H.tileEdge(2.4, 0.010, 'schluter'), span: 3 },
  { name: 'tileEdge pencil', build: () => H.tileEdge(2.4, 0.010, 'pencil'), span: 3 },
  { name: 'tileCornerReturn', build: () => H.tileCornerReturn(2.4, 0.010), span: 3 },
  { name: 'caulkBead', build: () => H.caulkBead(1.2, 0.006), span: 2 },
  { name: 'baseRun colonial+shoe', build: () => H.baseRun(3.2, 'colonial-base'), span: 4 },
  { name: 'baseRun craftsman', build: () => H.baseRun(3.2, 'craftsman-base'), span: 4 },
  { name: 'roomDoor 2-panel', build: () => H.roomDoor(0.76, 2.03, 0.042, 2).body, span: 3 },
  { name: 'roomDoor 3-panel', build: () => H.roomDoor(0.81, 2.03, 0.042, 3).body, span: 3 },
  { name: 'roomDoor flush', build: () => H.roomDoor(0.76, 2.03, 0.042, 0).body, span: 3 },
  { name: 'doorJamb + threshold', build: () => H.doorJamb(0.81, 2.03, 0.115, { threshold: true }), span: 3 },
  { name: 'mirror glass (frameless)', build: () => H.mirrorGeometries(0.9, 0.9, { arched: false, frame: 0, depth: 0.03 }).glass },
  { name: 'mirror bevel', build: () => H.mirrorGeometries(0.9, 0.9, { arched: false, frame: 0, depth: 0.03 }).bevel! },
  { name: 'mirror frame', build: () => H.mirrorGeometries(0.9, 0.9, { arched: false, frame: 0.028, depth: 0.03 }).frame! },
  { name: 'mirror arched frame', build: () => H.mirrorGeometries(0.7, 1.1, { arched: true, frame: 0.032, depth: 0.03 }).frame! },
  { name: 'undermountBasin', build: () => H.undermountBasin(0.46, 0.36, 0.155) },
  { name: 'vesselBasin', build: () => H.vesselBasin(0.40, 0.135) },
  { name: 'basinDrain', build: () => H.basinDrain() },
  { name: 'wasteGrate round', build: () => H.wasteGrate(100) },
  { name: 'wasteGrate square', build: () => H.wasteGrate(100, { square: true }) },
  { name: 'linearDrain', build: () => H.linearDrain(0.8) },
  { name: 'trapAndSupplies', build: () => H.trapAndSupplies(0.20) },
  { name: 'lavFaucet single', build: () => H.lavFaucet() },
  { name: 'lavFaucet widespread cross', build: () => H.lavFaucet({ widespread: true, cross: true }) },
  { name: 'wallTubTrim', build: () => H.wallTubTrim() },
  { name: 'floorTubFiller', build: () => H.floorTubFiller(1.06), span: 2 },
  { name: 'deckTubFiller', build: () => H.deckTubFiller() },
  { name: 'showerValve', build: () => H.showerValve({ diverter: true }) },
  { name: 'wallShowerHead', build: () => H.wallShowerHead() },
  { name: 'ceilingRainHead', build: () => H.ceilingRainHead(0.26, 250) },
  { name: 'ceilingRainHead square', build: () => H.ceilingRainHead(0.26, 300, { square: true }) },
  { name: 'slideBarSet', build: () => H.slideBarSet(0.66) },
  { name: 'bodyJet', build: () => H.bodyJet() },
  { name: 'glassPane', build: () => H.glassPane(0.78, 1.9, 0.010), span: 2 },
  { name: 'glassHeader', build: () => H.glassHeader(1.1), span: 2 },
  { name: 'glassHinge', build: () => H.glassHinge() },
  { name: 'glassHandle', build: () => H.glassHandle(0.30) },
  { name: 'glassClamp', build: () => H.glassClamp() },
  { name: 'curtainGeometry', build: () => H.curtainGeometry(0.9, 1.85), span: 2 },
  { name: 'showerCurb', build: () => H.showerCurb(1.1, inch(4), inch(5)), span: 2 },
  { name: 'nicheShell tile', build: () => H.nicheShell(0.36, 0.60, 0.095).tile },
  { name: 'nicheShell shelf', build: () => H.nicheShell(0.36, 0.60, 0.095).shelf! },
  { name: 'nicheShell trim', build: () => H.nicheShell(0.36, 0.60, 0.095).trim },
  { name: 'showerBench body', build: () => H.showerBench(0.44, 0.38, 0.46) .body },
  { name: 'showerBench top', build: () => H.showerBench(0.44, 0.38, 0.46).top },
  { name: 'tubOverflow', build: () => H.tubOverflow() },
  { name: 'clawFoot', build: () => H.clawFoot(0.16) },
  { name: 'tubApron', build: () => H.tubApron(1.52, 0.76, 0.50), span: 2 },
  { name: 'toiletBody two-piece', build: () => H.toiletBody('two-piece') },
  { name: 'toiletBody one-piece', build: () => H.toiletBody('one-piece') },
  { name: 'toiletBody wall-hung', build: () => H.toiletBody('wall-hung') },
  { name: 'toiletBody smart', build: () => H.toiletBody('smart') },
  { name: 'toiletSeat', build: () => H.toiletSeat('one-piece').seat },
  { name: 'toiletSeat hinges', build: () => H.toiletSeat('one-piece').hinges },
  { name: 'tripLever', build: () => H.tripLever() },
  { name: 'flushPlate', build: () => H.flushPlate() },
  { name: 'toiletSupply', build: () => H.toiletSupply() },
  { name: 'towelRing', build: () => H.towelRing() },
  { name: 'robeHook', build: () => H.robeHook() },
  { name: 'paperHolder', build: () => H.paperHolder() },
  { name: 'paperRoll', build: () => H.paperRoll() },
  { name: 'foldedTowel', build: () => H.foldedTowel(0.32, 0.22) },
  { name: 'hangingTowel', build: () => H.hangingTowel(0.34, 0.50) },
  { name: 'rolledTowel', build: () => H.rolledTowel() },
  { name: 'basket', build: () => H.basket() },
  { name: 'bathMat', build: () => H.bathMat() },
  { name: 'soapDispenser', build: () => H.soapDispenser() },
  { name: 'tumbler', build: () => H.tumbler() },
  { name: 'foliage', build: () => H.foliage() },
  { name: 'plantPot', build: () => H.plantPot() },
  { name: 'sconceMetal', build: () => H.sconceMetal() },
  { name: 'vanityBar body', build: () => H.vanityBar(0.6).body },
  { name: 'fanGrille', build: () => H.fanGrille(0.30) },
  { name: 'squareLeg', build: () => H.squareLeg(0.15) },
  { name: 'levellerFoot', build: () => H.levellerFoot() },
  { name: 'panelDoor (shared)', build: () => H.panelDoor(0.76, 2.03, 0.042, [{ y: 0.4, h: 0.7 }, { y: -0.45, h: 0.6 }]).frame, span: 3 },
  // décor
  { name: 'shelfBoards ×3', build: () => H.shelfBoards(0.9, 0.25, 3, 0.35) },
  { name: 'shelfCase ×4', build: () => H.shelfCase(0.9, 0.25, 4, 0.35, 0.01905, 1.6, true) },
  { name: 'shelfBrackets ×2', build: () => H.shelfBrackets(0.9, 0.25, 2, 0.35) },
  { name: 'jar body', build: () => H.jar().body },
  { name: 'jar lid', build: () => H.jar().lid },
  { name: 'candle', build: () => H.candle() },
  { name: 'bookStack', build: () => H.bookStack(4) },
  { name: 'rugSlab runner', build: () => H.rugSlab(2.1, 0.75), span: 3 },
  { name: 'rugSlab round', build: () => H.rugSlab(1.2, 1.2, true), span: 2 },
  { name: 'pictureFrame', build: () => H.pictureFrame(0.6, 0.8, 0.03) },
  { name: 'wrappedCanvas', build: () => H.wrappedCanvas(0.6, 0.8) },
  { name: 'plantFoliage leafy 1.2 m', build: () => H.plantFoliage('leafy', 1.2).foliage },
  { name: 'plantFoliage tree 1.8 m', build: () => H.plantFoliage('tree', 1.8).foliage },
  { name: 'plantFoliage tree trunk', build: () => H.plantFoliage('tree', 1.8).trunk! },
  { name: 'plantFoliage trailing (0.8 m drop)', build: () => H.plantFoliage('trailing', 0.4, { potD: 0.2, drop: 0.8 }).foliage },
  { name: 'plantFoliage herb', build: () => H.plantFoliage('herb', 0.25).foliage },
  { name: 'plantFoliage succulent', build: () => H.plantFoliage('succulent', 0.15).foliage },
  { name: 'hangingCords', build: () => H.hangingCords(0.2, 0.6) },
  { name: 'romanShade fabric', build: () => H.romanShade(1.1, 0.5).fabric },
  { name: 'romanShade rail', build: () => H.romanShade(1.1, 0.5).rail },
  { name: 'rollerShade fabric', build: () => H.rollerShade(1.1, 0.45).fabric },
  { name: 'rollerShade hardware', build: () => H.rollerShade(1.1, 0.45).hardware },
  { name: 'curtainRod', build: () => H.curtainRod(1.7) },
  { name: 'blinds rail', build: () => H.blinds(1.1, 0.8).rail },
  { name: 'blinds slat', build: () => H.blinds(1.1, 0.8).slat },
];

console.log('bathroom builders');
let totalTris = 0;
const costs: Array<[string, number]> = [];
for (const c of CASES) {
  checks++;
  try {
    const g = c.build();
    const bad = inspect(c.name, g, c.span ?? 8);
    if (bad) fail(`${c.name}: ${bad}`);
    else { const t = triangleCount(g); totalTris += t; costs.push([c.name, t]); }
  } catch (e) {
    fail(`${c.name}: threw ${(e as Error).message}`);
  }
}
if (failures === 0) ok(`${CASES.length} builders valid — ${totalTris.toLocaleString()} triangles across all of them`);
costs.sort((a, b) => b[1] - a[1]);
console.log('  heaviest: ' + costs.slice(0, 8).map(([n, t]) => `${n} ${t}`).join(', '));

// mosaic + courses return instance batches rather than a single geometry
console.log('\ninstanced batches');
{
  checks++;
  const m = H.mosaicField(1.1, 0.95, { chip: inch(2), max: 1100 });
  const bad = inspect('mosaicField chip', m.geometry, 0.5);
  if (bad) fail(`mosaicField: ${bad}`);
  else if (m.transforms.length === 0) fail('mosaicField: produced no chips');
  else if (m.transforms.some((t) => (t.position ?? []).some((n) => !Number.isFinite(n)))) fail('mosaicField: non-finite chip position');
  else ok(`mosaicField ${m.transforms.length} chips of ${(m.chip * 39.37).toFixed(1)}" — 1 draw call, ${(m.transforms.length * triangleCount(m.geometry)).toLocaleString()} tris`);

  checks++;
  const c = H.tileCourses(1.2, 2.4, inch(12), { max: 44 });
  const bad2 = inspect('tileCourses', c.geometry, 2);
  if (bad2) fail(`tileCourses: ${bad2}`);
  else ok(`tileCourses ${c.transforms.length} courses — 1 draw call, ${(c.transforms.length * triangleCount(c.geometry)).toLocaleString()} tris`);

  checks++;
  const capped = H.mosaicField(2.4, 2.0, { chip: 0.02, max: 400 });
  if (capped.transforms.length > 400) fail(`mosaicField ignored its cap: ${capped.transforms.length} chips`);
  else ok(`mosaicField honours its instance cap (${capped.transforms.length} ≤ 400, chips coarsened to ${(capped.chip * 39.37).toFixed(1)}")`);

  checks++;
  const bl = H.blinds(1.1, 0.8, { max: 24 });
  const bad3 = inspect('blinds slat', bl.slat, 2);
  if (bad3) fail(`blinds: ${bad3}`);
  else if (bl.transforms.length === 0 || bl.transforms.length > 24) fail(`blinds ignored its slat cap: ${bl.transforms.length}`);
  else if (bl.transforms.some((t) => (t.position ?? []).some((n) => !Number.isFinite(n)))) fail('blinds: non-finite slat position');
  else ok(`blinds ${bl.transforms.length} slats — 1 draw call, cap honoured`);
}

// hostile inputs
console.log('\nhostile inputs');
{
  checks++;
  let threw: string | null = null;
  for (const n of NASTY) {
    try {
      H.slabWithCutouts(n, n, n, [{ x: n, z: n, w: n, d: n }]);
      H.counterTop(n, n, n, 'eased', [{ x: n, z: n, w: n, d: n }]);
      H.floorWithHoles(n, n, [{ minX: n, maxX: n, minZ: n, maxZ: n }]);
      H.tileEdge(n, n, 'bullnose');
      H.caulkBead(n, n);
      H.mosaicField(n, n, { chip: n, joint: n, slope: n, max: n });
      H.tileCourses(n, n, n, { max: n });
      H.baseRun(n, 'modern-base');
      H.roomDoor(n, n, n, 2);
      H.doorJamb(n, n, n, { threshold: true });
      H.mirrorGeometries(n, n, { arched: true, frame: n, depth: n, bevel: n });
      H.undermountBasin(n, n, n);
      H.vesselBasin(n, n);
      H.linearDrain(n);
      H.wasteGrate(n);
      H.trapAndSupplies(n);
      H.lavFaucet({ height: n, reach: n });
      H.floorTubFiller(n);
      H.ceilingRainHead(n, n);
      H.slideBarSet(n);
      H.glassPane(n, n, n);
      H.glassHeader(n);
      H.glassHandle(n);
      H.curtainGeometry(n, n);
      H.showerCurb(n, n, n);
      H.nicheShell(n, n, n);
      H.showerBench(n, n, n);
      H.clawFoot(n);
      H.tubApron(n, n, n);
      H.foldedTowel(n, n, n);
      H.hangingTowel(n, n);
      H.rolledTowel(n, n);
      H.basket(n, n);
      H.bathMat(n, n);
      H.plantPot(n, n);
      H.sconceMetal({ shadeR: n, shadeH: n });
      H.vanityBar(n);
      H.fanGrille(n);
      H.squareLeg(n, n);
      H.panelDoor(n, n, n, [{ y: n, h: n }]);
      H.shelfBoards(n, n, n, n, n);
      H.shelfCase(n, n, n, n, n, n, true);
      H.shelfBrackets(n, n, n, n);
      H.jar(n, n);
      H.candle(n, n);
      H.bookStack(n, n, n);
      H.rugSlab(n, n, true);
      H.rugSlab(n, n);
      H.pictureFrame(n, n, n, n);
      H.wrappedCanvas(n, n, n);
      for (const form of ['leafy', 'tree', 'trailing', 'herb', 'succulent'] as const) H.plantFoliage(form, n, { potD: n, drop: n });
      H.hangingCords(n, n);
      H.romanShade(n, n, n);
      H.rollerShade(n, n);
      H.curtainRod(n);
      H.blinds(n, n, { max: n });
      H.shelfStyling(n, n, 'mixed', n);
    } catch (e) { threw = `${String(n)}: ${(e as Error).message}`; break; }
  }
  if (threw) fail(`a builder threw on a hostile input — ${threw}`);
  else ok(`every builder survived ${NASTY.length} hostile inputs without throwing`);
}

// ---------------------------------------------------------------------------
// 2. Scene budget
// ---------------------------------------------------------------------------
interface Tally { calls: number; tris: number; instances: number }
function add(t: Tally, g: THREE.BufferGeometry | null | undefined, copies = 1) {
  if (!g) return;
  t.calls += copies;
  t.tris += triangleCount(g) * copies;
}
function addInstanced(t: Tally, g: THREE.BufferGeometry, n: number) {
  if (n <= 0) return;
  t.calls += 1;
  t.tris += triangleCount(g) * n;
  t.instances += n;
}

/**
 * Mirror of the component tree, at High quality. One entry per mesh the
 * components emit; instanced batches count as one call.
 */
function budget(L: BathLayout): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  const T = (k: string) => (out[k] ??= { calls: 0, tris: 0, instances: 0 });
  const TILE_T = 0.010;

  // -- shell
  const shell = T('shell');
  add(shell, H.floorWithHoles(L.w, L.d, []));
  add(shell, worldPlane(L.w, L.d));
  for (const wall of ['back', 'left', 'right', 'front'] as const) {
    const len = wall === 'back' || wall === 'front' ? L.w : L.d;
    add(shell, wallFace(len, L.h, L.openings.filter((o) => o.wall === wall).map((o) => ({ x: o.x, y: o.sill, w: o.width, h: o.height }))));
    const tileH = L.wallTile === 'full' ? L.h : L.wallTile === 'wainscot' ? inch(42) : 0;
    if (tileH > 0) {
      add(shell, wallFace(len, tileH));
      // the joints follow the wall's own pattern and module — a 3×6 running
      // bond is many more bars than a 12×24 stack, and the instanced batch is
      // still one draw call either way
      const lay = L.tile.accent?.wall === wall ? { p: L.tile.accent.pattern, m: L.tile.accent.module ?? L.tile.module } : { p: L.tile.pattern, m: L.tile.module };
      const c = H.tileCourses(len - 0.2, tileH, lay.m ? inch(lay.m.h) : inch(12), { max: 44, pattern: lay.p, moduleW: lay.m ? inch(lay.m.w) : null, joint: L.tile.grout });
      addInstanced(shell, c.geometry, c.transforms.length);
      if (L.wallTile === 'wainscot' && L.tile.trim !== 'none') add(shell, H.tileEdge(len, TILE_T, L.tile.trim === 'metal-edge' ? 'schluter' : L.tile.trim === 'chair-rail' ? 'chair-rail' : L.tile.trim));
    }
    add(shell, H.baseRun(len, 'colonial-base'));
  }
  for (const o of L.openings) {
    if (o.kind === 'window') {
      add(shell, H.counterTop(o.width, 0.15, 0.026, 'eased', []));            // stool
      add(shell, openingCasing(o.width, o.height, 'colonial-casing'));
      add(shell, worldPlane(o.width, o.height), 2);                            // glass + backdrop
      add(shell, wallFace(o.width, 0.05), 8);                                  // jambs, sash, muntins
    } else {
      add(shell, H.doorJamb(o.width, o.height, 0.115, { threshold: true }));
      add(shell, openingCasing(o.width, o.height, 'colonial-casing'));
      add(shell, H.roomDoor(o.width, o.height, 0.042, 2).body);
      add(shell, doorKnob({ lever: true }), 2);
      add(shell, hinge({ kind: 'barrel' }), 3);
    }
  }
  add(shell, outletPlate({ kind: 'gfci' }));
  add(shell, switchPlate({ gangs: 2 }));
  add(shell, ventRegister(10, 4));

  // -- vanity
  if (L.vanity) {
    const v = L.vanity;
    const t = T('vanity');
    const W = v.width - inch(1.5), D = v.bodyDepth;
    const bodyBottom = v.bodyBottom + (v.style === 'freestanding' ? inch(4) : 0);
    const bodyH = Math.max(0.25, v.topH - v.topThickness - bodyBottom);
    const nDoors = v.sinks === 2 ? 4 : 2;
    const nDrawers = v.sinks === 2 ? 4 : 3;
    const parts: THREE.BufferGeometry[] = [transformed(H.worldBox(W, bodyH, D - 0.019), {})];
    for (let i = 0; i < nDoors; i++) parts.push(transformed(doorPanel(v.doorStyle, W / 4 - DOOR_REVEAL, bodyH * 0.7).body, { position: [i * 0.001, 0, 0] }));
    for (let i = 0; i < nDrawers; i++) parts.push(transformed(doorPanel(v.doorStyle === 'glass' ? 'shaker' : v.doorStyle, W / 4, inch(5)).body, { position: [i * 0.001, 0.4, 0] }));
    add(t, mergeDetail(parts));                                               // carcase + every front, one call
    addInstanced(t, barPull(160), nDoors + nDrawers);
    add(t, H.counterTop(W + inch(1.5), D + inch(1.5), v.topThickness, 'eased', [{ x: 0, z: 0, w: 0.43, d: 0.33 }]));
    add(t, H.undermountBasin(0.46, 0.36, 0.155), v.sinks);
    add(t, H.lavFaucet(), 1);
    add(t, H.basinDrain(), 1);
    const m = H.mirrorGeometries(0.9, 0.9, { arched: false, frame: 0, depth: 0.03 });
    const nMirrors = v.mirror === 'double' ? 2 : v.mirror === 'none' ? 0 : 1;
    add(t, m.glass, nMirrors);
    add(t, m.backer, nMirrors);
    if (m.bevel) add(t, m.bevel, nMirrors);
    const nSconce = Math.min(L.lighting.sconces, 4);
    add(t, H.sconceMetal(), nSconce);
    add(t, H.vanityBar(0.6).body, nSconce === 0 ? 1 : 0);
    add(t, H.foldedTowel(0.30, 0.21));
    add(t, H.soapDispenser());
    add(t, H.tumbler());
    add(t, H.plantPot(0.13, 0.115));
    add(t, H.foliage());
  }

  // -- shower
  if (L.shower) {
    const s = L.shower;
    const t = T('shower');
    const Wi = s.inner, Dp = s.depth - 0.03, tileH = L.h;
    add(t, mergeDetail([
      transformed(wallFace(Wi, tileH), {}),
      transformed(wallFace(Dp, tileH), { rotation: [0, Math.PI / 2, 0] }),
      transformed(wallFace(Dp, tileH), { rotation: [0, -Math.PI / 2, 0] }),
      ...(s.nicheAt ? [transformed(H.nicheShell(s.nicheAt.width, s.nicheAt.height, s.nicheAt.depth).tile, {})] : []),
      ...(s.bench ? [transformed(H.showerBench(s.benchStyle === 'full-width' ? Wi - 0.02 : 0.44, 0.38, 0.46).body, {})] : []),
    ]));
    const faceCourses = showerFaces(L, s).map((face) => H.tileCourses(face.width, tileH, L.tile.showerModule ? inch(L.tile.showerModule.h) : inch(12), {
      max: 44, pattern: L.tile.showerPattern ?? L.tile.pattern, moduleW: L.tile.showerModule ? inch(L.tile.showerModule.w) : null, joint: L.tile.grout ?? 0.003,
    }));
    addInstanced(t, faceCourses[0].geometry, faceCourses.reduce((n, c) => n + c.transforms.length, 0));
    if (s.nicheAt) add(t, H.nicheShell(s.nicheAt.width, s.nicheAt.height, s.nicheAt.depth).trim);
    if (!s.hasTub) {
      add(t, H.worldBox(Wi, 0.022, Dp));
      const mos = H.mosaicField(Wi, Dp, { chip: inch(2), max: 1100 });
      addInstanced(t, mos.geometry, mos.transforms.length);
      add(t, mergeDetail([
        ...(s.curbless ? [] : [transformed(H.showerCurb(Wi, inch(4), inch(5)), {})]),
        ...(s.nicheAt && s.nicheAt.shelves > 0 ? Array.from({ length: s.nicheAt.shelves }, (_, i) => transformed(H.nicheShell(s.nicheAt!.width, s.nicheAt!.height, s.nicheAt!.depth).shelf!, { position: [0, i * 0.01, 0] })) : []),
        ...(s.bench ? [transformed(H.showerBench(s.benchStyle === 'full-width' ? Wi - 0.02 : 0.44, 0.38, 0.46).top, {})] : []),
      ]));
    }
    add(t, mergeDetail([
      transformed(H.showerValve({ diverter: true }), {}),
      transformed(s.fixtures === 'single' ? H.wallShowerHead() : H.ceilingRainHead(0.26, 250), { position: [0, 1, 0] }),
      ...(s.fixtures === 'rain-plus-handheld' ? [transformed(H.slideBarSet(0.66), { position: [0.3, 0, 0] })] : []),
      transformed(H.glassHeader(Wi), { position: [0, 2, 0] }),
      transformed(H.glassHandle(0.3), { position: [0.2, 1.1, 0] }),
      transformed(H.glassHinge(), { position: [0, 0.3, 0] }),
      transformed(H.glassHinge(), { position: [0, 1.7, 0] }),
      transformed(s.curbless ? H.linearDrain(0.8) : H.wasteGrate(100), { position: [0, 0, 0.3] }),
    ]));
    add(t, mergeDetail([transformed(H.glassPane(0.78, 1.88), {}), transformed(H.glassPane(Math.max(0.06, Wi - 0.8), 1.88), { position: [0.9, 0, 0] })]));
    if (s.niche) { add(t, H.soapDispenser()); add(t, H.worldBox(0.062, 0.175, 0.062)); }
  }

  // -- tub
  if (L.tub) {
    const tb = L.tub;
    const t = T('tub');
    const len = tb.length, Wd = tb.across;
    if (tb.kind === 'alcove') {
      add(t, mergeDetail([transformed(wallFace(len, 2.2), {}), transformed(wallFace(Wd, 2.2), { rotation: [0, Math.PI / 2, 0] }), transformed(wallFace(Wd, 2.2), { rotation: [0, -Math.PI / 2, 0] })]));
      add(t, mergeDetail([transformed(H.tubApron(len, Wd, 0.5), {}), transformed(H.slabWithCutouts(len, 0.044, Wd, [{ x: 0, z: 0, w: len - 0.2, d: Wd - 0.2 }]), { position: [0, 0.48, 0] })]));
    } else {
      add(t, H.tubApron(len, Wd, 0.5));
    }
    const cp = H.cupProfile({ height: 0.46, wall: 0.045, floor: 0.03, rim: 0.016 });
    add(t, H.cupLathe(cp.profile, cp.outerIndex, 48));
    if (tb.kind === 'clawfoot') add(t, mergeDetail([0, 1, 2, 3].map((i) => transformed(H.clawFoot(), { position: [i * 0.4, 0, 0] }))));
    add(t, mergeDetail([transformed(H.floorTubFiller(), {}), transformed(H.tubOverflow(), { position: [0.5, 0.4, 0] }), transformed(H.wasteGrate(78), { position: [0.4, 0.1, 0] })]));
    add(t, H.foldedTowel(0.30, 0.20, 2));
  }

  // -- toilet
  if (L.toilet) {
    const t = T('toilet');
    add(t, H.toiletBody(L.toilet.style));
    add(t, H.toiletSeat(L.toilet.style).seat);
    add(t, H.toiletSeat(L.toilet.style).hinges);
    add(t, L.toilet.style === 'wall-hung' ? H.flushPlate() : mergeDetail([transformed(H.tripLever(), {}), transformed(H.toiletSupply(), { position: [0.2, 0, 0] })]));
  }

  // -- accessories
  {
    const t = T('accessories');
    add(t, H.foldedTowel(0.32, 0.16, 2));
    add(t, H.hangingTowel(0.34, 0.5), 2);
    add(t, H.towelRing());
    add(t, H.robeHook());
    add(t, H.paperHolder());
    add(t, H.paperRoll());
    add(t, H.bathMat());
    add(t, H.plantPot());
    add(t, H.foliage());
    add(t, H.basket());
    add(t, H.rolledTowel(), 3);
    // every fitting the SPEC placed: the piece plus the towel it carries
    for (const a of L.accessories) {
      switch (a.kind) {
        case 'towel-bar': add(t, towelBar(Math.round(a.width * 1000))); add(t, H.hangingTowel(Math.min(0.36, a.width * 0.6), 0.50)); break;
        case 'grab-bar': add(t, towelBar(Math.round(a.width * 1000), { tubeMm: 32, projectionMm: 60 })); break;
        case 'towel-ring': add(t, H.towelRing()); add(t, H.hangingTowel(0.20, 0.40)); break;
        case 'hook': case 'robe-hook': add(t, H.robeHook()); add(t, H.hangingTowel(0.24, 0.42)); break;
        case 'toilet-paper-holder': add(t, H.paperHolder()); add(t, H.paperRoll()); break;
        case 'towel-warmer': add(t, H.towelWarmer(a.width, Math.min(1.2, a.width * 1.6))); break;
        case 'shower-caddy': add(t, H.showerCaddy(a.width)); break;
        default: add(t, H.cornerShelf(Math.max(0.12, a.width * 0.8)));
      }
    }
  }

  // -- décor (mirrors Decor.tsx at High quality: shelf styling on, 60 slats)
  {
    const t = T('decor');
    L.decor.shelves.forEach((s, i) => {
      add(t, s.enclosure ? H.shelfCase(s.width, s.depth, s.count, s.spacing, s.thickness, s.enclosure.top - s.enclosure.bottom, s.enclosure.backPanel) : H.shelfBoards(s.width, s.depth, s.count, s.spacing, s.thickness));
      if (!s.enclosure && s.material === 'black') add(t, H.shelfBrackets(s.width, s.depth, s.count, s.spacing));
      for (const it of H.shelfStyling(s.width, s.count, s.styled, i)) {
        switch (it.item) {
          case 'jar': add(t, H.jar(0.085, 0.14).body); add(t, H.jar(0.085, 0.14).lid); break;
          case 'candle': add(t, H.candle(0.07, 0.09)); break;
          case 'books': add(t, H.bookStack(3, 0.17, 0.12)); break;
          case 'tumbler': add(t, H.tumbler()); break;
          case 'towels': add(t, H.rolledTowel(0.24, 0.09), 1); break;
          default: add(t, H.plantPot(0.11, 0.09)); add(t, H.worldBox(0.09, 0.008, 0.09)); add(t, H.plantFoliage('succulent', 0.16, { potD: 0.11 }).foliage);
        }
      }
    });
    for (const a of L.decor.art) {
      if (a.frame === 'none') add(t, H.wrappedCanvas(a.width, a.height));
      else { add(t, H.pictureFrame(a.width, a.height, 0.03)); add(t, worldPlane(a.width - 0.064, a.height - 0.064)); }
      add(t, worldPlane(Math.max(0.03, a.width - 0.16), Math.max(0.03, a.height - 0.16)));
    }
    for (const p of L.decor.plants) {
      const potH = p.kind === 'floor' ? p.potD : p.potD * 0.85;
      const f = H.plantFoliage(p.form, Math.max(0.08, p.size - potH), { potD: p.potD, drop: p.drop });
      add(t, H.plantPot(p.potD, potH));
      add(t, H.worldBox(p.potD * 0.86, 0.008, p.potD * 0.86));
      add(t, f.foliage);
      if (f.trunk) add(t, f.trunk);
      if (p.kind === 'hanging') add(t, H.hangingCords(p.potD, Math.max(0.1, L.h - 0.03 - (p.y + potH))));
    }
    if (L.decor.rug) add(t, H.rugSlab(L.decor.rug.length, L.decor.rug.width, L.decor.rug.style === 'round'));
    for (const w of L.decor.treatments) {
      const outer = w.width + 0.16;
      switch (w.kind) {
        case 'roman-shade': { const r = H.romanShade(outer, w.height * 0.45 + 0.12); add(t, r.fabric); add(t, r.rail); break; }
        case 'roller': { const r = H.rollerShade(outer, w.height * 0.4 + 0.10); add(t, r.fabric); add(t, r.hardware); break; }
        case 'blinds': { const b = H.blinds(outer, w.height * 0.7 + 0.10, { max: 60 }); add(t, b.rail); addInstanced(t, b.slat, b.transforms.length); break; }
        case 'cafe-curtain': add(t, H.curtainRod(w.width + 0.12)); add(t, H.curtainGeometry(w.width + 0.08, w.height * 0.55, 0.006)); break;
        default: add(t, H.curtainRod(w.width + 0.6)); add(t, H.curtainGeometry(Math.max(0.25, w.width * 0.35), 2, 0.008), 1);
      }
    }
  }

  // -- lighting practicals drawn by the rig (can trim + lens per can)
  {
    const t = T('lighting');
    add(t, H.fanGrille());
    add(t, H.worldBox(0.1, 0.02, 0.1), Math.max(0, L.lighting.recessed) * 2);
    add(t, H.plantPot(0.2, 0.2), L.lighting.pendants ? L.lighting.pendants.count * 2 : 0);
  }
  return out;
}

function spec(over: Partial<BathroomSpec>): BathroomSpec {
  return {
    roomType: 'bathroom',
    dims: { widthFt: 10, depthFt: 9, ceilingFt: 9 },
    style: 'transitional', layout: 'full',
    vanity: { present: true, wall: 'left', t: 0.5, widthIn: 60, sinks: 2, style: 'freestanding', mirror: 'double', doorStyle: 'shaker' },
    shower: { present: true, wall: 'back', t: 0.8, widthIn: 48, depthIn: 38, enclosure: 'frameless-glass', niche: true, bench: true, curbless: false, fixtures: 'rain-plus-handheld' },
    tub: { present: true, wall: 'back', t: 0.18, kind: 'freestanding', lengthIn: 66 },
    toilet: { present: true, wall: 'right', t: 0.5, style: 'one-piece' },
    wallTile: { height: 'full' },
    openings: [
      { id: 'd', kind: 'door', wall: 'front', t: 0.5, widthFt: 2.67, heightFt: 6.67, sillFt: 0, style: null },
      { id: 'w', kind: 'window', wall: 'right', t: 0.82, widthFt: 2.5, heightFt: 3.33, sillFt: 3.83, style: 'standard' },
    ],
    lighting: { recessedCount: 6, sconces: 2, underCabinet: true, pendants: null, chandelier: false, colorTempK: 3000, naturalLight: 'medium' } as BathroomSpec['lighting'],
    decor: emptyDecor(),
    materials: {} as BathroomSpec['materials'],
    detected: {} as BathroomSpec['detected'],
    ...over,
  } as BathroomSpec;
}

/** Everything the décor contract allows at once — the worst case for the budget. */
const HEAVY_DECOR: DecorSpec = {
  shelves: [
    { wall: 'left', t: 0.15, widthIn: 36, count: 3, bottomFt: 4.5, depthIn: 10, spacingIn: 14, material: 'wood', styled: 'mixed' },
    { wall: 'right', t: 0.3, widthIn: 30, count: 2, bottomFt: 5, depthIn: 8, spacingIn: 12, material: 'black', styled: 'dishes' },
    { wall: 'front', t: 0.2, widthIn: 24, count: 2, bottomFt: 5.2, depthIn: 8, spacingIn: 12, material: 'match-cabinets', styled: 'plants' },
  ],
  plants: [
    { kind: 'floor', wall: 'corner', t: 0.9, sizeFt: 6, form: 'tree' },
    { kind: 'floor', wall: 'front', t: 0.15, sizeFt: 3, form: 'leafy' },
    { kind: 'counter', wall: 'left', t: 0.5, sizeFt: 0.9, form: 'succulent' },
    { kind: 'shelf', wall: 'left', t: 0.15, sizeFt: 0.8, form: 'trailing' },
    { kind: 'hanging', wall: 'back', t: 0.5, sizeFt: 2.5, form: 'trailing' },
    { kind: 'counter', wall: 'left', t: 0.2, sizeFt: 1, form: 'herb' },
  ],
  art: [
    { wall: 'right', t: 0.3, widthIn: 24, heightIn: 30, centerFt: 5.4, frame: 'black' },
    { wall: 'front', t: 0.75, widthIn: 20, heightIn: 16, centerFt: 5.2, frame: 'none' },
  ],
  rug: { present: true, lengthFt: 5, widthFt: 2.5, style: 'runner' },
  windowTreatment: 'curtains',
  counterStyling: 'lived-in', stools: null,
  items: [], cabinetContents: [],
};

const SCENES: Array<[string, BathroomSpec]> = [
  ['primary bath (freestanding tub + walk-in shower, full tile)', spec({})],
  ['demo bathroom (the app default: shelves, plants, art, rug, roller shade)', defaultBathroom()],
  ['styled primary bath (every décor kind at once, curtains, 6 plants)', spec({ dims: { widthFt: 14, depthFt: 11, ceilingFt: 9 }, decor: HEAVY_DECOR })],
  ['powder room', spec({
    dims: { widthFt: 5, depthFt: 7, ceilingFt: 8 },
    vanity: { present: true, wall: 'back', t: 0.5, widthIn: 30, sinks: 1, style: 'pedestal', mirror: 'single', doorStyle: 'shaker' },
    shower: { present: false } as BathroomSpec['shower'],
    tub: { present: false } as BathroomSpec['tub'],
    wallTile: { height: 'wainscot' },
  })],
  ['tub-shower alcove (hall bath)', spec({
    dims: { widthFt: 8, depthFt: 8, ceilingFt: 8 },
    shower: { present: true, wall: 'back', t: 0.5, widthIn: 60, depthIn: 32, enclosure: 'tub-shower', niche: true, bench: false, curbless: false, fixtures: 'single' },
    tub: { present: false } as BathroomSpec['tub'],
    wallTile: { height: 'shower-only' },
  })],
  ['low-ceiling alcove bath (7 ft ceiling)', spec({
    dims: { widthFt: 8, depthFt: 7, ceilingFt: 7 },
    vanity: { present: true, wall: 'left', t: 0.5, widthIn: 36, sinks: 1, style: 'freestanding', mirror: 'single', doorStyle: 'shaker' },
    shower: { present: false } as BathroomSpec['shower'],
    tub: { present: true, wall: 'back', t: 0.3, kind: 'alcove', lengthIn: 60 },
    wallTile: { height: 'wainscot' },
  })],
  ['curbless wet room (clawfoot + rain head)', spec({
    dims: { widthFt: 14, depthFt: 12, ceilingFt: 10 },
    vanity: { present: true, wall: 'left', t: 0.5, widthIn: 84, sinks: 2, style: 'floating', mirror: 'double', doorStyle: 'slab' },
    shower: { present: true, wall: 'back', t: 0.85, widthIn: 72, depthIn: 48, enclosure: 'frameless-glass', niche: true, bench: true, curbless: true, fixtures: 'rain-plus-handheld' },
    tub: { present: true, wall: 'back', t: 0.15, kind: 'clawfoot', lengthIn: 72 },
    wallTile: { height: 'full' },
  })],
];

console.log('\nscene budget (High quality — 900 draw calls / 1.2 M triangles)');
for (const [name, s] of SCENES) {
  checks++;
  const L = computeBathroomLayout(s);
  const b = budget(L);
  const calls = Object.values(b).reduce((n, t) => n + t.calls, 0);
  const tris = Object.values(b).reduce((n, t) => n + t.tris, 0);
  const inst = Object.values(b).reduce((n, t) => n + t.instances, 0);
  const detail = Object.entries(b).map(([k, t]) => `${k} ${t.calls}/${(t.tris / 1000).toFixed(0)}k`).join('  ');
  if (calls > 900) fail(`${name}: ${calls} draw calls exceeds the 900 budget`);
  else if (tris > 1_200_000) fail(`${name}: ${tris.toLocaleString()} triangles exceeds the 1.2 M budget`);
  else ok(`${name}\n      ${calls} draw calls · ${tris.toLocaleString()} triangles · ${inst.toLocaleString()} instances\n      ${detail}`);
}

// ---------------------------------------------------------------------------
// Everything is INSIDE the room
// ---------------------------------------------------------------------------
/**
 * The budget above is a MODEL of the components. These assertions are not:
 * they read the layout the components actually consume, so they catch the
 * class of bug the user reported — a fixture half-buried in a wall, a shower
 * hanging out of the room, trim that runs past the ceiling.
 */
console.log('\ncontainment (read off the real layout, not the budget model)');
{
  /** Constants the components hard-code; each must clear the shortest ceiling. */
  const GLASS_TOP = 1.98, GLASS_HEADER = 0.013;
  const NICHE_TOP = 1.05 + 0.60 / 2;
  /** The real function `Tub.tsx` calls — not a copy of it. */
  const surroundHeight = H.alcoveSurroundHeight;

  for (const [name, sp] of SCENES) {
    checks++;
    const L = computeBathroomLayout(sp);
    const bad: string[] = [];
    const hx = L.w / 2 + 1e-6, hz = L.d / 2 + 1e-6;
    const items: Array<[string, typeof L.vanity]> = [
      ['vanity', L.vanity], ['shower', L.shower], ['tub', L.tub], ['toilet', L.toilet],
    ] as Array<[string, typeof L.vanity]>;
    for (const [key, p] of items) {
      if (!p) continue;
      const r = p.rect;
      if (r.minX < -hx || r.maxX > hx || r.minZ < -hz || r.maxZ > hz) {
        bad.push(`${key} footprint leaves the room (${r.minX.toFixed(2)}..${r.maxX.toFixed(2)} × ${r.minZ.toFixed(2)}..${r.maxZ.toFixed(2)} in ${L.w.toFixed(2)}×${L.d.toFixed(2)})`);
      }
      if (p.depth > (p.wall === 'back' || p.wall === 'front' ? L.d : L.w)) bad.push(`${key} is deeper than the room`);
    }
    if (L.shower && !L.shower.hasTub && GLASS_TOP + GLASS_HEADER > L.h) bad.push(`shower glass header (${(GLASS_TOP + GLASS_HEADER).toFixed(2)} m) is above the ${L.h.toFixed(2)} m ceiling`);
    if (L.shower?.niche && NICHE_TOP > L.h - 0.1) bad.push('shower niche runs into the ceiling');
    if (L.tub?.kind === 'alcove' && surroundHeight(L.h) > L.h) bad.push(`the ${surroundHeight(L.h).toFixed(2)} m tub surround is taller than the ${L.h.toFixed(2)} m ceiling`);
    // the vanity top, its mirror and the light over it all have to fit
    if (L.vanity) {
      const mirrorBottom = L.vanity.topH + 0.235;
      const mirrorH = Math.min(0.95, Math.max(0.4, L.h - 0.2 - mirrorBottom));
      if (mirrorBottom + mirrorH + 0.105 > L.h) bad.push('the vanity light bar is above the ceiling');
      if (L.vanity.topH + 0.24 > L.h) bad.push('the GFCI is above the ceiling');
    }
    // wall tile can never poke through the ceiling
    const tileH = L.wallTile === 'full' || L.wallTile === 'accent-wall' ? L.h - 0.004 : L.wallTile === 'wainscot' ? Math.min(inch(42), L.h - 0.3) : 0;
    if (tileH > L.h) bad.push('wall tile is taller than the room');
    // every opening has to fit in its wall and under the ceiling
    for (const o of L.openings) {
      const len = o.wall === 'back' || o.wall === 'front' ? L.w : L.d;
      if (Math.abs(o.x) + o.width / 2 > len / 2 + 1e-6) bad.push(`opening ${o.id} runs off its wall`);
      if (o.sill + o.height > L.h + 1e-6) bad.push(`opening ${o.id} runs through the ceiling`);
    }
    if (bad.length) fail(`${name}: ${bad.join('; ')}`);
    else ok(`${name} — every fixture, opening and trim run inside ${L.w.toFixed(2)}×${L.d.toFixed(2)}×${L.h.toFixed(2)} m`);
  }

  // the same, swept across every room size the Layout tab can produce
  checks++;
  const escapes: string[] = [];
  for (let wf = 4; wf <= 20 && escapes.length < 4; wf += 0.5) {
    for (let df = 4; df <= 20; df += 0.5) {
      for (const [, sp] of SCENES) {
        const L = computeBathroomLayout({ ...sp, dims: { ...sp.dims, widthFt: wf, depthFt: df } });
        const hx = L.w / 2 + 0.002, hz = L.d / 2 + 0.002;
        for (const p of [L.vanity, L.shower, L.tub, L.toilet]) {
          if (!p) continue;
          const r = p.rect;
          if (r.minX < -hx || r.maxX > hx || r.minZ < -hz || r.maxZ > hz) { escapes.push(`${wf}×${df} ft`); break; }
        }
      }
    }
  }
  if (escapes.length) fail(`a fixture left the room at ${escapes.join(', ')}`);
  else ok('no fixture leaves the room at any width × depth from 4 ft to 20 ft');

  // The ceiling is its own sweep: a 7 ft ceiling used to leave 66 mm of the
  // alcove tub surround sticking through it.
  checks++;
  const tall: string[] = [];
  for (let cf = 7; cf <= 14; cf += 0.25) {
    for (const [, sp] of SCENES) {
      const L = computeBathroomLayout({ ...sp, dims: { ...sp.dims, ceilingFt: cf } });
      const items: Array<[string, number]> = [];
      if (L.shower && !L.shower.hasTub) items.push(['shower glass header', 1.98 + 0.013]);
      if (L.shower?.niche) items.push(['shower niche', 1.05 + 0.30]);
      if (L.tub?.kind === 'alcove') items.push(['alcove tub surround', surroundHeight(L.h)]);
      if (L.vanity) {
        const mb = L.vanity.topH + 0.235;
        items.push(['vanity light bar', mb + Math.min(0.95, Math.max(0.4, L.h - 0.2 - mb)) + 0.105]);
      }
      for (const [what, y] of items) if (y > L.h + 1e-6) tall.push(`${what} at ${cf} ft (${y.toFixed(3)} > ${L.h.toFixed(3)} m)`);
    }
  }
  if (tall.length) fail(`through the ceiling: ${[...new Set(tall)].slice(0, 4).join('; ')}`);
  else ok('nothing runs through the ceiling at any height from 7 ft to 14 ft');
}

// ---------------------------------------------------------------------------
// Décor is INSIDE the room and OFF the fixtures
// ---------------------------------------------------------------------------
/**
 * Read off the real layout, reasoned independently of `solveDecor`: a shelf
 * over the toilet is right, a shelf through its tank is not; a picture beside
 * the mirror is right, one on the glass is not; a plant in a corner is right,
 * one standing in the shower pan is not. Pieces the solver itself flagged in
 * `decor.warnings` are exempt — those are the ones it could not honour and
 * said so.
 */
console.log('\ndécor containment');
{
  const spanOverlap = (a0: number, a1: number, b0: number, b1: number, tol = 0.004) => Math.min(a1, b1) - Math.max(a0, b0) > tol;
  const rectsOverlap = (a: Rect, b: Rect) => spanOverlap(a.minX, a.maxX, b.minX, b.maxX) && spanOverlap(a.minZ, a.maxZ, b.minZ, b.maxZ);
  const wallLocalX = (L: BathLayout, wall: BathroomSpec['vanity']['wall'], x: number, z: number) => {
    const f = wallFrame(wall, L.w, L.d);
    return (x - f.origin.x) * f.along.x + (z - f.origin.z) * f.along.z - f.length / 2;
  };

  function decorProblems(L: BathLayout): string[] {
    const bad: string[] = [];
    const warned = new Set(L.decor.warnings.map((w) => `${w.piece}-${w.index}`));
    const hx = L.w / 2 + 1e-6, hz = L.d / 2 + 1e-6;
    const hung: Array<['shelf' | 'art', number, LShelf | LArt]> = [
      ...L.decor.shelves.map((s, i) => ['shelf', i, s] as ['shelf', number, LShelf]),
      ...L.decor.art.map((a, i) => ['art', i, a] as ['art', number, LArt]),
    ];
    for (const [kind, i, p] of hung) {
      if (warned.has(`${kind}-${i}`)) continue;
      const tag = `${kind}[${i}] on the ${p.wall} wall`;
      const r = p.rect;
      if (r.minX < -hx || r.maxX > hx || r.minZ < -hz || r.maxZ > hz) bad.push(`${tag} leaves the room`);
      if (Math.abs(p.x) + p.width / 2 > p.len / 2 + 1e-6) bad.push(`${tag} runs off its wall`);
      if (p.band.y0 < 0 || p.band.y1 > L.h + 1e-6) bad.push(`${tag} runs through the floor or ceiling`);
      for (const o of L.openings) {
        if (o.wall !== p.wall) continue;
        if (spanOverlap(p.x - p.width / 2, p.x + p.width / 2, o.x - o.width / 2, o.x + o.width / 2) && spanOverlap(p.band.y0, p.band.y1, o.sill, o.sill + o.height)) bad.push(`${tag} hangs across ${o.kind} ${o.id}`);
      }
      if (L.shower && rectsOverlap(r, L.shower.rect)) bad.push(`${tag} is inside the shower`);
      if (L.tub && rectsOverlap(r, L.tub.rect) && p.band.y0 < (L.tub.kind === 'alcove' ? H.alcoveSurroundHeight(L.h) : DECOR_CLEAR.tub) - 1e-6) bad.push(`${tag} runs into the tub`);
      if (L.toilet && rectsOverlap(r, L.toilet.rect) && p.band.y0 < (L.toilet.style === 'wall-hung' ? DECOR_CLEAR.toiletWallHung : DECOR_CLEAR.toilet) - 1e-6) bad.push(`${tag} runs into the toilet`);
      if (L.vanity) {
        const v = L.vanity;
        if (rectsOverlap(r, v.rect) && p.band.y0 < v.topH + DECOR_CLEAR.vanity - 1e-6) bad.push(`${tag} runs into the vanity`);
        const m = v.mirrorBand;
        if (m && v.wall === p.wall && spanOverlap(p.x - p.width / 2, p.x + p.width / 2, m.x0, m.x1) && spanOverlap(p.band.y0, p.band.y1, m.y0, m.y1)) bad.push(`${tag} is on the mirror`);
      }
      if (kind === 'art') {
        for (const s of L.decor.shelves) {
          if (s.wall !== p.wall) continue;
          if (spanOverlap(p.x - p.width / 2, p.x + p.width / 2, s.x - s.width / 2, s.x + s.width / 2) && spanOverlap(p.band.y0, p.band.y1, s.band.y0, s.band.y1)) bad.push(`${tag} is behind a shelf`);
        }
      }
    }
    L.decor.plants.forEach((p, i) => {
      if (warned.has(`plant-${i}`)) return;
      const tag = `${p.kind} plant[${i}]`;
      if (![p.x, p.y, p.z, p.size, p.potD].every(Number.isFinite)) { bad.push(`${tag} has a non-finite number`); return; }
      if (p.kind === 'floor') {
        if (Math.abs(p.x) + p.radius > hx || Math.abs(p.z) + p.radius > hz) bad.push(`${tag} leaves the room`);
        for (const r of L.rects) if (distToRect(p.x, p.z, r) < p.radius - 1e-6) bad.push(`${tag} stands in a fixture`);
        L.decor.plants.forEach((q, j) => { if (j < i && q.kind === 'floor' && Math.hypot(p.x - q.x, p.z - q.z) < p.radius + q.radius - 1e-6) bad.push(`${tag} stands in plant[${j}]`); });
        if (p.y + p.size > L.h + 1e-6) bad.push(`${tag} is taller than the room`);
      } else if (p.kind === 'counter') {
        const v = L.vanity;
        if (!v) { bad.push(`${tag} has no vanity to stand on`); return; }
        const xl = wallLocalX(L, v.wall, p.x, p.z) - v.x;
        if (Math.abs(xl) + p.potD / 2 > v.topW / 2 + 1e-6) bad.push(`${tag} hangs off the vanity top`);
        if (Math.abs(p.y - v.topH) > 1e-6) bad.push(`${tag} floats above the vanity top`);
        for (const bx of v.basins) if (Math.abs(xl - bx) < 0.23 + p.potD / 2 - 1e-6) bad.push(`${tag} sits in a basin`);
      } else if (p.kind === 'shelf') {
        const s = p.shelfIndex !== null ? L.decor.shelves[p.shelfIndex] : null;
        if (!s) { bad.push(`${tag} has no shelf`); return; }
        if (distToRect(p.x, p.z, s.rect) > 1e-6) bad.push(`${tag} is not on its shelf`);
        if (p.y + p.size > L.h + 1e-6) bad.push(`${tag} is through the ceiling`);
      } else {
        if (p.y + p.potD > L.h + 1e-6) bad.push(`${tag} pot is through the ceiling`);
        if (L.shower && distToRect(p.x, p.z, L.shower.rect) < 1e-6) bad.push(`${tag} hangs inside the shower`);
        if (L.tub?.kind === 'alcove' && distToRect(p.x, p.z, L.tub.rect) < 1e-6) bad.push(`${tag} hangs inside the tub alcove`);
      }
    });
    const rug = L.decor.rug;
    if (rug && !warned.has('rug-0')) {
      const r = rug.rect;
      if (r.minX < -hx || r.maxX > hx || r.minZ < -hz || r.maxZ > hz) bad.push('rug leaves the room');
      for (const f of L.rects) if (rectsOverlap(r, f)) bad.push('rug runs under a fixture');
    }
    return bad;
  }

  for (const [name, sp] of SCENES) {
    checks++;
    const L = computeBathroomLayout(sp);
    const n = L.decor.shelves.length + L.decor.art.length + L.decor.plants.length + (L.decor.rug ? 1 : 0) + L.decor.treatments.length;
    const bad = decorProblems(L);
    if (bad.length) fail(`${name}: ${bad.join('; ')}`);
    else ok(`${name} — ${n} décor piece${n === 1 ? '' : 's'} clear of every fixture, opening and mirror${L.decor.warnings.length ? ` (${L.decor.warnings.length} flagged by the solver)` : ''}`);
  }

  // the same across every room size the Layout tab can produce
  checks++;
  const escapes: string[] = [];
  const decorScenes = SCENES.filter(([, sp]) => sp.decor && (sp.decor.shelves.length || sp.decor.plants.length));
  for (let wf = 5; wf <= 18 && escapes.length < 4; wf += 1) {
    for (let df = 5; df <= 18; df += 1) {
      for (const [, sp] of decorScenes) {
        const L = computeBathroomLayout({ ...sp, dims: { ...sp.dims, widthFt: wf, depthFt: df } });
        const bad = decorProblems(L);
        if (bad.length) { escapes.push(`${wf}×${df} ft: ${bad[0]}`); break; }
      }
    }
  }
  if (escapes.length) fail(`décor problems at ${escapes.join(', ')}`);
  else ok(`décor stays clear of the fixtures at every width × depth from 5 ft to 18 ft (${decorScenes.length} scenes)`);

  // a photo's shelf is never dropped: every declared piece comes out the other side
  checks++;
  const L = computeBathroomLayout(spec({ dims: { widthFt: 6, depthFt: 6, ceilingFt: 8 }, decor: HEAVY_DECOR }));
  const kept = L.decor.shelves.length === HEAVY_DECOR.shelves.length && L.decor.art.length === HEAVY_DECOR.art.length && L.decor.plants.length === HEAVY_DECOR.plants.length && !!L.decor.rug;
  if (!kept) fail(`a crowded 6×6 room dropped décor: ${L.decor.shelves.length}/${HEAVY_DECOR.shelves.length} shelves, ${L.decor.art.length}/${HEAVY_DECOR.art.length} art, ${L.decor.plants.length}/${HEAVY_DECOR.plants.length} plants, rug ${L.decor.rug ? 'kept' : 'dropped'}`);
  else ok(`a crowded 6×6 room keeps every declared piece (${L.decor.warnings.length} flagged for the Layout tab rather than dropped)`);
}


// ---------------------------------------------------------------------------
// The demo fixture: every declared detail reaches the scene
// ---------------------------------------------------------------------------
/**
 * `scripts/fixtures/demo-bathroom.spec.json` sets EVERY field the expanded
 * `BathroomSpec` gained to a non-null value that is NOT the value the scene
 * drew before that field existed. So each assertion below fails if its field
 * is ignored: the fallback is a different number, a different word, or a
 * missing object, never the declared one. That is the whole point of the
 * fixture — a field nobody consumes shows up here as a difference rather than
 * as a silent default.
 */
console.log('\ndemo fixture — declared detail reaches the layout');
{
  const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'demo-bathroom.spec.json'), 'utf8')) as { spec?: BathroomSpec } & BathroomSpec;
  const demo = raw.spec ?? raw;
  const L = computeBathroomLayout(demo);
  const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
  /** one assertion, named by the field it is about */
  const is = (field: string, got: unknown, want: unknown, note = '') => {
    checks++;
    const good = typeof got === 'number' && typeof want === 'number' ? near(got, want, 1e-6) : JSON.stringify(got) === JSON.stringify(want);
    if (good) ok(`${field} = ${JSON.stringify(got)}${note ? ` — ${note}` : ''}`);
    else fail(`${field}: layout has ${JSON.stringify(got)}, the fixture declares ${JSON.stringify(want)}`);
  };
  const holds = (name: string, good: boolean, detail: string) => {
    checks++;
    if (good) ok(`${name} — ${detail}`);
    else fail(`${name}: ${detail}`);
  };

  // --- tile: the biggest visual share of any bathroom ----------------------
  const T = L.tile;
  is('wallTile.heightIn', T.stopH, inch(54), 'not the wainscot category’s 42"');
  is('wallTile.pattern', T.pattern, 'vertical-stack');
  is('wallTile.moduleIn', T.module, { w: 3, h: 12 });
  is('wallTile.groutWidthIn', T.grout, inch(0.0625), '1/16", not the 1/8" default');
  is('wallTile.trim', T.trim, 'pencil');
  is('wallTile.accent.wall', T.accent?.wall, 'back');
  is('wallTile.accent.pattern', T.accent?.pattern, 'herringbone');
  is('wallTile.accent.moduleIn', T.accent?.module, { w: 2, h: 8 });
  is('wallTile.accent.heightIn', T.accent?.stopH, null, 'null = to the ceiling');
  is('wallTile.accent.colorHex', T.accent?.colorHex, '#D9CFC0');
  is('wallTile.showerPattern', T.showerPattern, 'stacked');
  is('wallTile.showerModuleIn', T.showerModule, { w: 12, h: 24 });

  // The module is declared AS LAID (w across, h up). A 3×12 vertical stack is
  // therefore courses every 12" and joints every 3" — turning it on end again
  // (the bug this pins) gives courses every 3" and joints every 12".
  {
    const c = H.tileCourses(2.6, T.stopH!, inch(T.module!.h), { max: 44, pattern: T.pattern, moduleW: inch(T.module!.w), joint: T.grout });
    const courses = c.transforms.filter((t) => !t.rotation).map((t) => t.position![1]).sort((a, b) => a - b);
    const cols = [...new Set(c.transforms.filter((t) => t.rotation).map((t) => t.position![0].toFixed(4)))];
    const pitch = courses.length > 1 ? courses[1] - courses[0] : 0;
    holds('3×12 vertical stack is laid as declared', near(pitch, inch(12), 1e-3) && cols.length > 20,
      `courses every ${(pitch / inch(1)).toFixed(1)}" over ${cols.length} columns (a swapped module gives 3" courses and ~8 columns)`);
    // the cut course at the top keeps its joints: 54" in a 12" tile ends on a
    // 6" cut, and an installer's cut tile is still a tile
    const topCourse = courses[courses.length - 1];
    const topVert = Math.max(...c.transforms.filter((t) => t.rotation).map((t) => t.position![1]));
    holds('the cut top course keeps its joints', topCourse > T.stopH! - inch(12) - 1e-6 && topVert > topCourse,
      `last course at ${(topCourse / inch(1)).toFixed(1)}" of ${(T.stopH! / inch(1)).toFixed(0)}", verticals reach ${(topVert / inch(1)).toFixed(1)}"`);
  }
  // the accent wall is genuinely a different wall, not the field with a tint
  {
    const field = H.tileCourses(2.6, T.stopH!, inch(T.module!.h), { max: 44, pattern: T.pattern, moduleW: inch(T.module!.w), joint: T.grout });
    const accent = H.tileCourses(2.6, L.h, inch(T.accent!.module!.h), { max: 44, pattern: T.accent!.pattern, moduleW: inch(T.accent!.module!.w), joint: T.grout, weaveCap: 3600 });
    const woven = accent.transforms.filter((t) => t.rotation && Math.abs(Math.abs(t.rotation[2]) - Math.PI / 4) < 1e-6).length;
    holds('the herringbone accent actually weaves', woven > 100 && woven === accent.transforms.length,
      `${woven}/${accent.transforms.length} bars on the diagonal (a fallback to courses leaves none)`);
    holds('the accent is laid differently from the field', accent.transforms.length !== field.transforms.length,
      `${accent.transforms.length} accent bars vs ${field.transforms.length} field bars`);
  }

  // --- the vanity's FACE ----------------------------------------------------
  const V = L.vanity!;
  is('vanity.heightIn', V.topH, inch(31));
  // the declared depth is the CARCASE; `Placed.depth` carries the layout's
  // extra 1.5" of clearance, which is why this reads `bodyDepth`
  is('vanity.depthIn', V.bodyDepth, inch(22));
  is('vanity.counterThicknessIn', V.topThickness, inch(2));
  is('vanity.legStyle', V.legStyle, 'turned');
  is('vanity.basin', V.basin, 'vessel');
  is('vanity.faucetMount', V.faucetMount, 'wall');
  is('vanity.hardware', V.hardware, 'knobs');
  is('vanity.backsplash', V.splash, 'standard');
  is('vanity.drawers', V.drawers, 3);
  is('vanity.doors', V.doors, 2);
  holds('turned legs lift the box off the floor', V.legHeight > 0.05 && near(V.bodyBottom, V.legHeight),
    `${(V.legHeight * 1000).toFixed(0)} mm of leg under the carcase`);
  // the invariant the render found: a wall tap is drawn ON the wall the mirror
  // hangs on, so the glass has to start above its handles
  holds('a wall tap clears the vessel rim and stays out of the mirror',
    V.tapY !== null && V.tapY - 0.04 > V.topH + 0.135 && V.mirrorBottom >= V.tapY + 0.09 && (!V.mirrorBand || V.mirrorBand.y0 >= V.mirrorBottom - 0.031),
    `spout ${(((V.tapY ?? 0) - 0.04 - V.topH - 0.135) * 1000).toFixed(0)} mm over the bowl, glass ${(((V.mirrorBottom) - (V.tapY ?? 0)) * 1000).toFixed(0)} mm over the escutcheon`);

  // --- shower + tub ---------------------------------------------------------
  const S = L.shower!;
  is('shower.glassThicknessIn', S.glassThickness, inch(0.375));
  is('shower.doorType', S.doorType, 'barn');
  is('shower.hardwareFinish', S.hardwareFinish, 'oil-rubbed-bronze');
  is('shower.benchStyle', S.benchStyle, 'full-width');
  is('shower.curbHeightIn', S.curbHeight, inch(4));
  holds('the niche is placed where nicheAt puts it',
    !!S.nicheAt && near(S.nicheAt.width, inch(30), 1e-3) && near(S.nicheAt.height, inch(16), 1e-3) && S.nicheAt.face === 'back' && S.nicheAt.shelves === 1
      && S.nicheAt.bottom > 0.6 && S.nicheAt.bottom + S.nicheAt.height < L.h,
    S.nicheAt ? `${(S.nicheAt.width / inch(1)).toFixed(0)}"×${(S.nicheAt.height / inch(1)).toFixed(0)}" on the ${S.nicheAt.face} face, sill ${(S.nicheAt.bottom / inch(1)).toFixed(0)}", ${S.nicheAt.shelves} shelf` : 'no niche placed');
  const B = L.tub!;
  is('tub.material', B.material, 'cast-iron');
  is('tub.fillerType', B.filler, 'floor-mount');
  is('tub.fillerFinish', B.fillerFinish, 'oil-rubbed-bronze');
  is('tub.apron', B.apron, 'integral');
  is('tub.widthIn', B.across, inch(31));
  is('tub.heightIn', B.rimHeight, inch(25));

  // --- how many bowls: ONE decision, not two -------------------------------
  /*
   * `Vanity.tsx` used to re-derive the basins inside `planFronts` — one per
   * DOOR BAY — while the layout derived the MIRRORS from `vanityBasins`. On
   * this fixture ("2 sinks, 3 drawers, 2 doors") the two disagreed: two
   * mirrors, ONE bowl, and the estimator billing two vessel sinks. The scene
   * now reads `L.vanity.basins` for both, so a bowl lands under its own
   * mirror. Assert the count against `sinks` — the field the client set and
   * the estimator prices — never against the front plan.
   */
  is('vanity.sinks → basins drawn', V.basins.length, V.sinks, 'a declared front plan does not re-decide the sink count');
  holds('a double mirror has a bowl under each half',
    V.mirror !== 'double' || (V.basins.length === 2 && V.mirrorBand !== null),
    `${V.basins.length} bowl(s) under mirror '${V.mirror}'`);
  {
    // the same bug from the other side: door bays that CANNOT equal the sink
    // count used to draw three bowls on a single vanity
    const odd = JSON.parse(JSON.stringify(demo)) as BathroomSpec;
    odd.vanity.doors = 6; odd.vanity.drawers = 0; odd.vanity.sinks = 1;
    const one = computeBathroomLayout(odd).vanity!;
    holds('a six-door single vanity still draws one bowl', one.basins.length === 1,
      `${one.basins.length} bowl(s) for 6 declared doors and 1 sink`);
  }

  // --- the toilet's own metal ----------------------------------------------
  /*
   * `toilet.trimFinish` is written by the analyzer, allowlisted by refine and
   * healed by the store, and until now read by nobody: the trip lever, the
   * seat hinges and a flush plate all followed the room's `fixtures` slot, so
   * a declared oil-rubbed lever in a matte-black bathroom drew matte black. It
   * now takes the per-piece override the shower's hardware and the tub's
   * filler already had.
   */
  is('toilet.trimFinish', L.toilet!.trimFinish, 'oil-rubbed-bronze', 'the lever is not forced to the fixtures slot');

  // --- accessories and objects (bathrooms drew NEITHER) --------------------
  const kinds = L.accessories.map((a) => a.kind).sort();
  is('accessories', kinds, ['robe-hook', 'toilet-paper-holder', 'towel-bar', 'towel-ring'], 'every declared fitting placed');
  holds('every fitting takes the declared finish', L.accessories.every((a) => a.finish === 'oil-rubbed-bronze'),
    `${L.accessories.length} fittings in oil-rubbed-bronze`);
  holds('every fitting is on a wall, inside the room, at a reachable height',
    L.accessories.every((a) => a.y > 0.3 && a.y < L.h - 0.2 && Math.abs(a.x) <= a.len / 2 + 1e-6),
    L.accessories.map((a) => `${a.kind}@${a.wall} ${(a.y / inch(1)).toFixed(0)}"`).join(', '));
  const objects = L.decor.counterStyling;
  holds('decor.items reach the bathroom', objects.length > 0, `${objects.length} objects placed on the vanity / the tub / the floor`);
}

console.log('\nWet-area opening regressions');
{
  const check = (pass: boolean, message: string) => { checks++; if (pass) ok(message); else fail(message); };
  const hits = (g: THREE.BufferGeometry, x: number, y: number) => {
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld();
    return new THREE.Raycaster(new THREE.Vector3(x, y, 0.4), new THREE.Vector3(0, 0, -1)).intersectObject(mesh).length > 0;
  };
  for (const wall of ['back', 'left', 'right', 'front'] as const) {
    for (const nicheFace of ['back', 'left', 'right'] as const) {
      const raw = defaultBathroom();
      raw.vanity.present = false; raw.toilet.present = false; raw.tub.present = false; raw.openings = [];
      raw.shower = { ...raw.shower, present: true, wall, t: nicheFace === 'right' ? 1 : nicheFace === 'left' ? 0 : 0.5, widthIn: 48, depthIn: 42, niche: true,
        nicheAt: { face: nicheFace, t: 0.55, widthIn: 14, heightIn: 24, centerIn: 52, shelves: 1 } };
      const L = computeBathroomLayout(raw), stall = L.shower!, niche = stall.nicheAt!;
      const face = showerFaces(L, stall).find((f) => f.kind === nicheFace)!;
      const hole = face.holes[0];
      check(!!hole && !hits(wallFace(face.width, L.h, face.holes), hole.x, hole.y + hole.h * 0.35), `${wall}/${nicheFace}: tile opening is a real hole`);
      if (face.roomWall) {
        const holes = bathroomWallHoles(L, face.roomWall);
        const h = holes[0];
        check(!!h && !hits(wallFace(wallFrame(face.roomWall, L.w, L.d).length, L.h, holes), h.x, h.y + h.h * 0.35), `${wall}/${nicheFace}: room substrate cannot plug the niche`);
      }
      const frame = showerNicheFrame(stall)!;
      check(Math.abs(frame.position[1] - niche.bottom) < 1e-8, `${wall}/${nicheFace}: niche sill and opening share elevation`);
      // A centred shower has independent partitions; these need openings too.
      raw.shower.t = 0.5;
      const mid = computeBathroomLayout(raw), m = mid.shower!;
      const partition = showerFaces(mid, m).find((f) => f.kind === nicheFace)!;
      if (!partition.roomWall) {
        const h = partition.holes[0];
        check(!hits(wallWithOpenings(partition.width, mid.h, m.partition, partition.holes), h.x, h.y + h.h / 2), `${wall}/${nicheFace}: side partition does not fill the recessed niche`);
      }
    }
  }
  const raw = defaultBathroom();
  raw.vanity.present = false; raw.toilet.present = false; raw.tub.present = false;
  raw.shower = { ...raw.shower, present: true, wall: 'back', t: 0.5, widthIn: 60, depthIn: 36, niche: false };
  raw.openings = [{ id: 'wet-window', kind: 'window', wall: 'back', t: 0.5, widthFt: 2, heightFt: 2, sillFt: 4, style: 'standard' }];
  const L = computeBathroomLayout(raw), face = showerFaces(L, L.shower!)[0];
  check(face.holes.length === 1 && !hits(wallFace(face.width, L.h, face.holes), 0, 1.5), 'a real window in the shower remains open through its tile');
  const measured = defaultBathroom();
  measured.dims = { widthFt: 80, depthFt: 80, ceilingFt: 20 };
  const measuredL = computeBathroomLayout(measured);
  check(measuredL.widthFt === 80 && measuredL.depthFt === 80 && measuredL.ceilingFt === 20, 'schema-valid measured room dimensions are honored without silently shrinking the room');
  const wideNiche = defaultBathroom();
  wideNiche.shower = { ...wideNiche.shower, present: true, niche: true, fixtures: 'rain-plus-handheld', nicheAt: { face: 'back', t: 0.5, widthIn: 30, heightIn: 16, centerIn: 48, shelves: 1 } };
  const hwL = computeBathroomLayout(wideNiche), hw = showerHardwareLayout(hwL, hwL.shower!);
  const n = hwL.shower!.nicheAt!;
  const overlaps = (x: number, y: number, halfW: number, halfH: number) => x + halfW > n.x - n.width / 2 && x - halfW < n.x + n.width / 2 && y + halfH > n.bottom && y - halfH < n.bottom + n.height;
  check(!overlaps(hw.valve[0], hw.valve[1], 0.09, 0.10), 'shower valve is mounted on solid wall, clear of a centred niche');
  check(!overlaps(hw.handheld[0], hw.handheld[1] + 0.33, 0.045, 0.37), 'handheld rail avoids the niche instead of crossing its shelf');
  check(hw.warnings.length === 0, 'a normal niche/valve arrangement resolves without an unbuildable mount');
  const rect = [{ x0: -0.15, x1: 0.15, y0: -0.15, y1: 0.15 }];
  for (const angle of [0, Math.PI / 2, Math.PI / 4]) {
    const joints = clipTileJoint({ position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, angle] }, rect);
    check(joints.length === 2 && joints.every((j) => Math.hypot(j.position![0], j.position![1]) > 0.15), `joint at ${(angle * 180 / Math.PI).toFixed(0)}° splits around an opening instead of crossing it`);
  }
}

void (async () => {
  const { harvestBathroom } = await import('./preview-bathroom');
  for (const style of ['modern', 'traditional'] as const) {
    for (const doorType of ['fixed-panel', 'sliding', 'none'] as const) {
      const raw = defaultBathroom();
      raw.style = style; raw.openings = []; raw.vanity.present = false; raw.toilet.present = false; raw.tub.present = false;
      raw.shower = { ...raw.shower, present: true, enclosure: 'tub-shower', doorType, niche: false, bench: false };
      raw.decor = emptyDecor();
      const { nodes, skipped } = await harvestBathroom(raw);
      const glass = nodes.filter((n) => n.label === 'glass');
      checks++;
      const want = doorType === 'none' ? 0 : 1;
      if (glass.length === want) ok(`${style} tub-shower / ${doorType}: ${want} glass assembly, no duplicate style-generated screen`);
      else fail(`${style} tub-shower / ${doorType}: expected ${want} glass assembly, found ${glass.length}`);
      checks++;
      if (!nodes.some((n) => { n.geometry.computeBoundingBox(); return n.label === 'fabric-linen' && n.geometry.boundingBox!.getSize(new THREE.Vector3()).y > 1.5; })) ok(`${style} tub-shower / ${doorType}: no unrequested curtain`);
      else fail(`${style} tub-shower / ${doorType}: a style fallback added an unrequested curtain`);
      checks++;
      const errors = [...skipped.keys()].filter((key) => key.startsWith('throw:') && !key.includes('props(position/scale/opacity/blur/far/resolution/frames/color)'));
      if (!errors.length) ok(`${style} tub-shower / ${doorType}: component tree builds without omitted geometry`);
      else fail(errors.join(' | '));
    }
  }
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks`);
process.exit(failures === 0 ? 0 : 1);

})();
