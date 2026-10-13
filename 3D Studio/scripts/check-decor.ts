/**
 * MANHATTAN — headless verification for the DETAIL LAYER.
 *
 *   npx tsx scripts/check-decor.ts
 *
 * The client's complaint this covers: *"every small detail like a small thing
 * in a cabinet to be shown, a pot on the stove to be shown, an amazing eye for
 * detail."* Two features answer it — `decor.items` (things standing on the
 * counters, the range, the island, a shelf, a sill, the floor) and
 * `decor.cabinetContents` (what shows behind a glass-front or open upper).
 *
 * What this script proves, in order:
 * 1. LANDING. Every host puts an item's BASE exactly on the surface it stands
 *    on — the counter, the burner grate, the island slab, a shelf board, a
 *    sill, the floor. A floating pot is the single most obvious render bug.
 * 2. NO INTERSECTION. Nothing pokes into a wall cabinet, a tall unit, the hood
 *    or the sink, and no two items share a footprint.
 * 3. FALLBACK. Items REPLACE the canned styling rather than doubling it; with
 *    no items the old styling is unchanged.
 * 4. PARTS. Everything the detail layer emits is a prop (no material slot, so
 *    it can never be clicked or priced), with unique finite keys, shadows off
 *    on the small stuff, and rows drawn as ONE instanced part.
 * 5. CONTENTS. Glass and open uppers are filled; solid doors, hood gaps and
 *    hood cabinets are not; 'empty' means empty; the whole wall folds into a
 *    handful of draw calls.
 * 6. BUDGET. 24 items and five crowded glass cabinets stay inside the
 *    project's 900-draw-call / 1.2M-triangle promise.
 * 7. NEVER PRICED. The estimate is byte-identical with and without the layer.
 * 8. NEVER SILENT. An item that cannot be honoured is named in
 *    `L.decor.warnings`, never dropped quietly.
 */
import fs from 'node:fs';
import path from 'node:path';
import type * as THREE from 'three';
import type { CabinetContents, DecorItem, KitchenSpec } from '../src/lib/spec/types';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { DEFAULT_SELECTIONS } from '../src/lib/materials/catalog';
import { DEFAULT_ESTIMATE_SETTINGS } from '../src/lib/store/project-store';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { inch } from '../src/lib/units';
import { computeKitchenLayout, hoodExtents, type KItem } from '../src/components/scene/kitchen/layout';
import { autoInstance } from '../src/components/scene/kitchen/parts';
import { buildKitchenPartsRaw, kitchenGeometryBudget } from '../src/components/scene/kitchen/budget';
import { itemsParts } from '../src/components/scene/kitchen/items';
import { contentsParts } from '../src/components/scene/kitchen/contents';
import { stylingParts } from '../src/components/scene/kitchen/styling';
import { decorParts } from '../src/components/scene/kitchen/decor';
import { itemsFromInventory } from '../src/lib/spec/items-from-inventory';
import { CROWDED_SURFACE_IN, ITEM_KINDS, ITEM_SIZE, kindFromLabel, plausibleSizeIn, readKind } from '../src/lib/spec/decor-items';
import { DEFAULT_SIZE_IN, SIZE_RANGE_IN } from '../src/components/scene/kitchen/items';
import { islandParts } from '../src/components/scene/kitchen/island';
import { stoolParts } from '../src/components/scene/kitchen/helpers';
import { filletBox } from '../src/components/scene/detail';
import { reconcileSpec } from '../src/lib/ai/reconcile';
import { RoomSpecZ } from '../src/lib/spec/schema';
import type { PhotoElement } from '../src/lib/spec/types';
// The bathroom's detail layer lives in its own builders; section 12 checks the
// three of them that only a rendered frame would otherwise catch.
import { floorTubFiller, plantCanopyRadius, plantFoliage, tileCourses } from '../src/components/scene/bathroom/helpers';

const PLANT_FORMS = ['leafy', 'tree', 'trailing', 'herb', 'succulent'] as const;

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const near = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One item entry with the contract's defaults filled in. */
function item(p: Partial<DecorItem> & Pick<DecorItem, 'kind' | 'on'>): DecorItem {
  return {
    kind: p.kind, label: p.label ?? p.kind.replace(/-/g, ' '), on: p.on,
    wall: p.wall ?? null, t: p.t ?? 0.5, depthT: p.depthT ?? null,
    shelfIndex: p.shelfIndex ?? null, burner: p.burner ?? null,
    sizeIn: p.sizeIn ?? 10, colorHex: p.colorHex ?? '#b9bcc0',
    material: p.material ?? 'stainless', count: p.count ?? 1,
  };
}

function withDecor(base: KitchenSpec, items: DecorItem[], cabinetContents: CabinetContents[]): KitchenSpec {
  return { ...base, decor: { ...base.decor, items, cabinetContents } };
}

const BASE = defaultKitchen();

/** the demo kitchen with an items-only inventory bolted on — one box per label */
function specWithBoxes(boxes: Array<{ id: string; label: string; box: [number, number, number, number] }>): KitchenSpec {
  const elements: PhotoElement[] = boxes.map((b) => ({
    id: b.id, kind: 'item', wall: 'back', facing: null,
    box: { x0: b.box[0], y0: b.box[1], x1: b.box[2], y1: b.box[3] }, label: b.label, confidence: 0.9,
  }));
  return { ...BASE, detected: { ...BASE.detected, elements } };
}

/** Ten entries covering every host, plus one glass cabinet's contents. */
const ITEMS: DecorItem[] = [
  item({ kind: 'pot', on: 'range', burner: 'left-back', sizeIn: 10, material: 'stainless' }),
  item({ kind: 'kettle', on: 'range', burner: 'right-front', sizeIn: 9, material: 'stainless' }),
  item({ kind: 'knife-block', on: 'counter', wall: 'back', t: 0.12, depthT: 0.3, sizeIn: 9, material: 'wood', colorHex: '#5a3c28' }),
  item({ kind: 'canister', on: 'counter', wall: 'back', t: 0.85, sizeIn: 8, material: 'ceramic', colorHex: '#efece6', count: 3 }),
  item({ kind: 'fruit-bowl', on: 'island', wall: 'island', t: 0.35, sizeIn: 11, material: 'ceramic', colorHex: '#efece6' }),
  item({ kind: 'books', on: 'island', wall: 'island', t: 0.72, sizeIn: 9, material: 'wood', colorHex: '#5a3c28' }),
  item({ kind: 'vase', on: 'shelf', wall: 'right', t: 0.3, shelfIndex: 1, sizeIn: 10, material: 'glass', colorHex: '#dfe9ee' }),
  item({ kind: 'candle', on: 'sill', wall: 'back', t: 0.33, sizeIn: 5, material: 'ceramic', colorHex: '#efece6', count: 2 }),
  item({ kind: 'basket', on: 'floor', wall: 'front', t: 0.3, sizeIn: 14, material: 'wicker', colorHex: '#b0844f' }),
  item({ kind: 'cutting-board', on: 'counter', wall: 'back', t: 0.6, sizeIn: 16, material: 'wood', colorHex: '#a8865a' }),
];
const bare = withDecor(BASE, [], []);

// the contents entry has to name a cabinet that exists — the layout resolves it
// by (wall, t) against the drawn row, so read the t off the drawn row
const probe = computeKitchenLayout(bare);
const glassSeat = probe.runs.flatMap((r) => r.uppers
  .filter((u) => u.type === 'glass')
  .map((u) => ({ wall: r.wall, t: (u.cx + r.wallLen / 2) / r.wallLen })))[0] ?? null;
if (!glassSeat) throw new Error('the default kitchen no longer has a glass upper to fill');
const CONTENTS: CabinetContents[] = [{ ...glassSeat, kind: 'glasses', density: 'full' }];

const itemsBase = withDecor(BASE, ITEMS, CONTENTS);

const L = computeKitchenLayout(itemsBase);
const byKind = new Map<string, KItem[]>();
for (const it of L.decor.items) {
  const g = byKind.get(it.kind);
  if (g) g.push(it); else byKind.set(it.kind, [it]);
}
const one = (kind: string): KItem | null => byKind.get(kind)?.[0] ?? null;

// ---------------------------------------------------------------------------
// 1. Landing — every item's base is exactly on its host
// ---------------------------------------------------------------------------
console.log('\n1. LANDING — an item stands ON its host, never floating, never sunk');

if (L.decor.items.length !== ITEMS.length) {
  fail(`layout solved ${L.decor.items.length} of ${ITEMS.length} items — ${L.decor.warnings.join('; ') || 'no warnings'}`);
} else {
  ok(`all ${ITEMS.length} items solved`);
}

for (const it of L.decor.items.filter((i) => i.on === 'counter')) {
  const run = L.runs.find((r) => r.wall === it.frame);
  if (!run) { fail(`${it.kind}: no run on ${String(it.frame)}`); continue; }
  if (!near(it.y, L.counterTopY)) fail(`${it.kind}: base y ${it.y.toFixed(4)} ≠ counter ${L.counterTopY.toFixed(4)}`);
  const span = run.counters.find(([a, b]) => it.x - it.w / 2 >= a - 0.002 && it.x + it.w / 2 <= b + 0.002);
  if (!span) fail(`${it.kind}: x ${it.x.toFixed(3)} ± ${(it.w / 2).toFixed(3)} is not inside a counter span of ${run.id}`);
  if (it.z - it.d / 2 < -1e-3 || it.z + it.d / 2 > run.counterDepth + 1e-3) {
    fail(`${it.kind}: z ${it.z.toFixed(3)} ± ${(it.d / 2).toFixed(3)} outside the counter depth ${run.counterDepth.toFixed(3)}`);
  }
}
ok(`counter items land on the counter inside a real slab span`);

const cooker = L.appliances.find((a) => a.kind === 'range' || a.kind === 'cooktop');
const onRange = L.decor.items.filter((i) => i.on === 'range');
if (!cooker) fail('the default kitchen has no range to stand a pot on');
else {
  const grateY = cooker.kind === 'range' ? cooker.height + inch(0.95) : L.counterTopY + inch(0.5);
  for (const it of onRange) {
    if (!near(it.y, grateY)) fail(`${it.kind} on the range: base y ${it.y.toFixed(4)} ≠ grate ${grateY.toFixed(4)}`);
    if (Math.abs(it.x - cooker.x) > cooker.width / 2 - it.w / 2 + 1e-3) fail(`${it.kind}: hangs off the range (x ${it.x.toFixed(3)}, range ${cooker.x.toFixed(3)} ± ${(cooker.width / 2).toFixed(3)})`);
    if (it.z < -1e-3 || it.z > cooker.depth + 1e-3) fail(`${it.kind}: z ${it.z.toFixed(3)} off the cooktop (depth ${cooker.depth.toFixed(3)})`);
  }
  if (onRange.length === 2) {
    const [a, b] = onRange;
    if (Math.abs(a.x - b.x) <= 0.1 && Math.abs(a.z - b.z) <= 0.1) fail('the pot and the kettle share a burner');
    else ok('the pot and the kettle stand on different burners');
  }
  ok('range items sit on the grate plane, inside the cooktop');
}

const isl = L.island;
const onIsland = L.decor.items.filter((i) => i.on === 'island');
if (!isl) fail('the default kitchen has no island');
else {
  const topY = isl.carcassTop + L.counterT;
  for (const it of onIsland) {
    if (it.frame !== 'island') fail(`${it.kind}: frame ${String(it.frame)} ≠ 'island'`);
    if (!near(it.y, topY)) fail(`${it.kind}: base y ${it.y.toFixed(4)} ≠ island top ${topY.toFixed(4)}`);
    if (Math.abs(it.x) > isl.topLen / 2 - it.w / 2 + 1e-3) fail(`${it.kind}: hangs off the island's end`);
    if (Math.abs(it.z - isl.topOffset) > isl.topWide / 2 - it.d / 2 + 1e-3) fail(`${it.kind}: hangs off the island's side`);
  }
  ok(`${onIsland.length} island items sit on the slab, inside its footprint`);
}

for (const it of L.decor.items.filter((i) => i.on === 'shelf')) {
  const s = L.decor.shelves.find((sh) => sh.id === it.hostId) ?? L.decor.shelves.find((sh) => sh.wall === it.frame);
  if (!s) { fail(`${it.kind}: no shelf on ${String(it.frame)}`); continue; }
  const k = it.shelfIndex ?? s.boards.length - 1;
  const top = s.boards[Math.max(0, Math.min(s.boards.length - 1, k))] + s.thickness;
  if (!near(it.y, top)) fail(`${it.kind}: base y ${it.y.toFixed(4)} ≠ board top ${top.toFixed(4)}`);
  if (Math.abs(it.x - s.x) > s.width / 2 - it.w / 2 + 1e-3) fail(`${it.kind}: wider than the shelf`);
  const next = k + 1 < s.boards.length ? s.boards[k + 1] : L.h - L.ceilingCrown;
  if (it.y + it.h > next + 1e-3) fail(`${it.kind}: ${it.h.toFixed(3)} m tall under a ${(next - it.y).toFixed(3)} m gap`);
}
ok('shelf items sit on a board with headroom above them');

for (const it of L.decor.items.filter((i) => i.on === 'sill')) {
  const o = L.openings.find((w) => w.kind === 'window' && w.wall === it.frame);
  if (!o) { fail(`${it.kind}: no window on ${String(it.frame)}`); continue; }
  if (!near(it.y, o.sill)) fail(`${it.kind}: base y ${it.y.toFixed(4)} ≠ sill ${o.sill.toFixed(4)}`);
  if (Math.abs(it.x - o.x) > o.width / 2 - it.w / 2 + 1e-3) fail(`${it.kind}: wider than the window`);
  if (it.z < inch(0.5) - 1e-3 || it.z > inch(4.4) + 1e-3) fail(`${it.kind}: z ${it.z.toFixed(4)} off the sill board`);
  if (it.d > inch(4) + 1e-3) fail(`${it.kind}: ${it.d.toFixed(3)} m deep on a 4" sill`);
}
ok('sill items sit on the sill, inside the window, no deeper than the board');

for (const it of L.decor.items.filter((i) => i.on === 'floor')) {
  if (it.frame !== 'world') fail(`${it.kind}: floor item in frame ${String(it.frame)}`);
  if (!near(it.y, 0)) fail(`${it.kind}: floor item at y ${it.y.toFixed(4)}`);
  if (Math.abs(it.x) > L.w / 2 || Math.abs(it.z) > L.d / 2) fail(`${it.kind}: outside the room`);
  const clear = Math.max(it.w, it.d) / 2;
  for (const r of L.rects) {
    const dx = Math.max(r.minX - it.x, 0, it.x - r.maxX);
    const dz = Math.max(r.minZ - it.z, 0, it.z - r.maxZ);
    const gap = Math.hypot(dx, dz);
    if (gap < clear - 1e-3) fail(`${it.kind}: ${gap.toFixed(3)} m from a fixture, needs ${clear.toFixed(3)}`);
  }
}
ok('the floor basket stands clear of every fixture');

const board = one('cutting-board');
if (!board) fail('the cutting board was dropped');
else {
  if (!near(board.lean, -0.14)) fail(`cutting board lean ${board.lean} ≠ -0.14`);
  if (!near(board.z, inch(3.5))) fail(`cutting board z ${board.z.toFixed(4)} ≠ 3.5"`);
  if (!near(board.y, L.counterTopY)) fail(`cutting board base y ${board.y.toFixed(4)} is off the counter`);
  ok('the leaning board keeps its base on the counter');
}

// ---------------------------------------------------------------------------
// 2. No intersection
// ---------------------------------------------------------------------------
console.log('\n2. NO INTERSECTION — items miss the cabinets, the hood, the sink and each other');

interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
const boxOf = (it: KItem): Box => ({
  x0: it.x - it.w / 2, x1: it.x + it.w / 2, y0: it.y, y1: it.y + it.h,
  z0: it.z - it.d / 2, z1: it.z + it.d / 2,
});
const overlaps = (a: Box, b: Box, tol = 0.002) =>
  a.x0 < b.x1 - tol && b.x0 < a.x1 - tol
  && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol
  && a.z0 < b.z1 - tol && b.z0 < a.z1 - tol;

for (const it of L.decor.items) {
  if (it.frame === 'world' || it.frame === 'island') continue;
  const b = boxOf(it);
  const run = L.runs.find((r) => r.wall === it.frame);
  if (run) {
    for (const u of run.uppers) {
      if (u.type === 'hood-gap' || u.type === 'appliance-gap') continue;
      if (overlaps(b, { x0: u.x0, x1: u.x1, y0: u.bottom, y1: run.upperTop, z0: 0, z1: run.upperDepth })) {
        fail(`${it.kind} runs into wall cabinet ${u.id}`);
      }
    }
    for (const t of run.tall) {
      if (overlaps(b, { x0: t.cx - t.width / 2, x1: t.cx + t.width / 2, y0: 0, y1: t.top, z0: 0, z1: t.depth })) {
        fail(`${it.kind} runs into tall unit ${t.id}`);
      }
    }
  }
  for (const a of L.appliances) {
    if (a.kind !== 'hood' || a.wall !== it.frame) continue;
    const e = hoodExtents(a);
    if (overlaps(b, { x0: a.x - a.width / 2, x1: a.x + a.width / 2, y0: e.mouth, y1: e.top, z0: 0, z1: a.depth })) {
      fail(`${it.kind} runs into the hood`);
    }
  }
  for (const o of L.openings) {
    if (o.wall !== it.frame) continue;
    if (overlaps(b, { x0: o.x - o.width / 2, x1: o.x + o.width / 2, y0: o.sill, y1: o.sill + o.height, z0: -0.05, z1: 0.02 })) {
      fail(`${it.kind} (${it.h.toFixed(2)} m tall) runs through the ${o.kind} ${o.id}`);
    }
  }
  if (it.on === 'counter' && L.sink && L.sink.wall === it.frame) {
    const half = L.sink.width / 2 + inch(1);
    if (b.x0 < L.sink.x + half && L.sink.x - half < b.x1) fail(`${it.kind} stands in the sink`);
  }
}
ok('no item intersects a cabinet, a tall unit, the hood, a window or the sink');

// A counter item is capped by whatever hangs over that stretch of counter, the
// way the range / shelf / sill hosts already cap theirs. 36" flowers under a
// 30" wall cabinet used to grow 18" into the cabinet box with no warning.
{
  const tall = withDecor(BASE, [
    item({ kind: 'flowers', on: 'counter', wall: 'left', t: 0.35, sizeIn: 36, material: 'glass', colorHex: '#dfe9ee' }),
  ], []);
  const T = computeKitchenLayout(tall);
  const f = T.decor.items[0];
  if (!f) fail('the tall counter item was dropped instead of being shortened');
  else {
    const run = T.runs.find((r) => r.wall === 'left');
    const over = (run?.uppers ?? [])
      .filter((u) => u.type !== 'hood-gap' && u.type !== 'appliance-gap')
      .filter((u) => u.x0 < f.x + f.w / 2 && f.x - f.w / 2 < u.x1);
    if (!over.length) fail('the fixture no longer stands the item under a wall cabinet');
    const lowest = Math.min(...over.map((u) => u.bottom));
    if (f.y + f.h > lowest + 1e-3) fail(`flowers reach ${(f.y + f.h).toFixed(3)} m, into the cabinet at ${lowest.toFixed(3)} m`);
    if (f.h >= inch(36) - 1e-3) fail('the item was not shortened at all');
    if (!T.decor.warnings.some((x) => /shortened to .* clear what hangs over the counter/.test(x))) {
      fail('the item was shortened silently — no warning');
    }
  }
  ok('a counter item is shortened to clear the wall cabinets above it, and says so');
}

for (let i = 0; i < L.decor.items.length; i++) {
  for (let j = i + 1; j < L.decor.items.length; j++) {
    const a = L.decor.items[i], c = L.decor.items[j];
    if (a.frame !== c.frame) continue;
    if (overlaps(boxOf(a), boxOf(c))) fail(`${a.kind} and ${c.kind} overlap on ${String(a.frame)}`);
  }
}
ok('no two items share a footprint');

// ---------------------------------------------------------------------------
// 3. Fallback — items replace the canned styling
// ---------------------------------------------------------------------------
console.log('\n3. FALLBACK — the photo\'s items win over the canned styling');

const bareStyling = stylingParts(computeKitchenLayout(bare));
if (bareStyling.length < 3) fail(`a lived-in kitchen with no items draws only ${bareStyling.length} styling parts`);
else ok(`no items → ${bareStyling.length} canned styling parts, as before`);

if (stylingParts(L).length !== 0) fail(`items present but ${stylingParts(L).length} canned styling parts still drawn`);
else ok('items present → zero canned styling parts');

// a shelf board the photo furnished does not also get the canned thirds cast
const shelfItem = L.decor.items.find((i) => i.on === 'shelf');
if (!shelfItem) fail('the shelf item was dropped, so the board-cast suppression is untested');
else {
  const host = L.decor.shelves.find((sh) => sh.id === shelfItem.hostId) ?? L.decor.shelves[0];
  const k = shelfItem.shelfIndex ?? host.boards.length - 1;
  const canned = decorParts(L).filter((p) => p.key.startsWith(`${host.id}-b${k}-`));
  const bareCanned = decorParts(computeKitchenLayout(bare)).filter((p) => p.key.startsWith(`${host.id}-b${k}-`));
  if (canned.length) fail(`board ${k} of ${host.id} was furnished by the photo but still drew ${canned.length} canned parts`);
  else if (!bareCanned.length) fail(`board ${k} of ${host.id} draws nothing even with no items — the test proves nothing`);
  else ok(`furnished shelf board drops its canned cast (${bareCanned.length} parts → 0)`);
}

const noneStyling = computeKitchenLayout({ ...itemsBase, decor: { ...itemsBase.decor, counterStyling: 'none' } });
if (itemsParts(noneStyling).length === 0) fail("counterStyling 'none' silenced the photo's own items");
else ok(`counterStyling 'none' still draws the photo's ${itemsParts(noneStyling).length} item parts`);

// ---------------------------------------------------------------------------
// 4. Parts
// ---------------------------------------------------------------------------
console.log('\n4. PARTS — props only, never a priced surface');

const iparts = itemsParts(L);
const cparts = contentsParts(L);
const detail = [...iparts, ...cparts];
if (detail.length === 0) fail('the detail layer emitted nothing at all');

const finite = (v: number[] | undefined) => !v || v.every((n) => Number.isFinite(n));
const keys = new Set<string>();
for (const p of detail) {
  if (p.slot) fail(`${p.key} carries slot '${p.slot}' — the detail layer must never be priced`);
  const looks = [p.util, p.metal, p.materialId, p.procedural].filter(Boolean).length;
  if (looks !== 1) fail(`${p.key} has ${looks} looks (needs exactly one of util / metal)`);
  if (!finite(p.position) || !finite(p.rotation)) fail(`${p.key} has a non-finite transform`);
  if (keys.has(p.key)) fail(`duplicate key ${p.key}`);
  keys.add(p.key);
  for (const t of p.instances ?? []) {
    if (!finite(t.position as number[] | undefined) || !finite(t.rotation as number[] | undefined)) fail(`${p.key} has a non-finite instance`);
  }
}
ok(`${detail.length} detail parts: no slots, one look each, unique finite keys`);

for (const it of L.decor.items) {
  if (it.h >= 0.25) continue;
  const mine = iparts.filter((p) => p.key.startsWith(`${it.id}-`));
  const casting = mine.filter((p) => p.castShadow !== false);
  if (casting.length) fail(`${it.kind} is ${(it.h * 100).toFixed(0)} cm tall but ${casting.length} of its parts cast shadows`);
}
ok('items under 25 cm cast no shadow');

for (const it of L.decor.items.filter((i) => i.count > 1)) {
  const mine = iparts.filter((p) => p.key.startsWith(`${it.id}-`));
  const solo = mine.filter((p) => !p.instances);
  if (solo.length) fail(`${it.kind} ×${it.count}: ${solo.length} un-instanced parts (${solo.map((p) => p.key).join(', ')})`);
  for (const p of mine) {
    if (p.instances && p.instances.length !== it.count) fail(`${p.key}: ${p.instances.length} instances for count ${it.count}`);
  }
}
ok('rows are one instanced part each, with count instances');

const allKeys = buildKitchenPartsRaw(L).map((p) => p.key);
if (new Set(allKeys).size !== allKeys.length) fail('the whole kitchen has duplicate part keys with the detail layer on');
else ok(`${allKeys.length} kitchen part keys still unique`);

// ---------------------------------------------------------------------------
// 5. Contents
// ---------------------------------------------------------------------------
console.log('\n5. CONTENTS — what shows behind the glass');

const glassCab = L.runs.flatMap((r) => r.uppers.filter((u) => u.type === 'glass').map((u) => ({ run: r, u })))[0] ?? null;
if (!glassCab) fail('the default kitchen has no glass upper to fill');
else {
  if (glassCab.u.contents !== 'glasses') fail(`the named glass upper resolved to '${glassCab.u.contents}', expected 'glasses'`);
  if (glassCab.u.density !== 'full') fail(`the named glass upper resolved to density '${glassCab.u.density}', expected 'full'`);
  const mine = cparts.filter((p) => p.key.startsWith(`${glassCab.u.id}-c`));
  if (mine.length < 6) fail(`the furnished glass cabinet drew only ${mine.length} parts`);
  else ok(`the furnished glass cabinet drew ${mine.length} parts`);
  for (const p of mine) {
    const [x, y, z] = p.position ?? [0, 0, 0];
    if (Math.abs(x - glassCab.u.cx) > glassCab.u.width / 2 - 0.01) fail(`${p.key}: x ${x.toFixed(3)} outside the cabinet`);
    if (y < glassCab.u.bottom - 1e-3 || y > glassCab.run.upperTop + 1e-3) fail(`${p.key}: y ${y.toFixed(3)} outside the cabinet`);
    if (z < inch(0.5) - 1e-3 || z > glassCab.run.upperDepth + 1e-3) fail(`${p.key}: z ${z.toFixed(3)} outside the box`);
  }
  ok('every contents part sits inside its cabinet');

  // one small cabinet cannot fold below its own distinct geometries; the real
  // test of the folding is the marble fixture's full row, below
  const wallParts = autoInstance(cparts.filter((p) => p.frame === glassCab.run.wall));
  const geos = new Set(cparts.filter((p) => p.frame === glassCab.run.wall).map((p) => p.geometry.uuid)).size;
  if (wallParts.length > Math.max(geos, 4)) fail(`${glassCab.run.wall} wall: ${wallParts.length} draw calls for ${geos} distinct shapes`);
  else ok(`${glassCab.run.wall} wall contents: ${mine.length} parts, ${geos} shapes, ${wallParts.length} draw calls`);
}

const emptied = computeKitchenLayout(withDecor(BASE, [], [{ ...glassSeat, kind: 'empty', density: 'sparse' }]));
if (contentsParts(emptied).some((p) => glassCab && p.key.startsWith(`${glassCab.u.id}-c`))) fail("kind 'empty' still drew contents");
else ok("kind 'empty' empties that one cabinet");

// every solid-door kitchen: no contents at all
const doorsOnly: KitchenSpec = {
  ...bare,
  runs: bare.runs.map((r) => ({ ...r, uppers: (r.uppers ?? []).map((u) => (u.type === 'glass' || u.type === 'open-shelf' ? { ...u, type: 'door' as const } : u)) })),
};
const doorsL = computeKitchenLayout(doorsOnly);
const doorParts = contentsParts(doorsL);
if (doorParts.length) fail(`a solid-door kitchen drew ${doorParts.length} contents parts`);
else ok('solid doors, hood gaps and hood cabinets draw nothing inside');

for (const r of doorsL.runs) {
  for (const u of r.uppers) {
    if ((u.type === 'hood-gap' || u.type === 'hood-cabinet') && u.contents) fail(`${u.id} (${u.type}) was given contents`);
  }
}
ok('a hood gap and a hood cabinet are never given contents');

// the marble fixture's glass uppers default to the mixed / sparse cast
const fixturePath = path.join(__dirname, 'fixtures', 'client-marble.spec.json');
if (fs.existsSync(fixturePath)) {
  const marble = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as KitchenSpec;
  const ML = computeKitchenLayout(marble);
  const eligibleUppers = ML.runs.flatMap((r) => r.uppers.filter((u) => u.type === 'glass' || u.type === 'open-shelf'));
  const mparts = contentsParts(ML);
  const walls = [...new Set(mparts.map((p) => String(p.frame)))];
  const draws = walls.reduce((n, w) => n + autoInstance(mparts.filter((p) => String(p.frame) === w)).length, 0);
  if (eligibleUppers.length && !mparts.length) fail(`marble: ${eligibleUppers.length} eligible uppers drew nothing`);
  else ok(`marble: ${eligibleUppers.length} eligible uppers → ${mparts.length} contents parts in ${draws} draw calls`);
  // the busiest wall is where the folding has to work
  const busiest = walls.map((w) => mparts.filter((p) => String(p.frame) === w)).sort((a, b) => b.length - a.length)[0] ?? [];
  const busiestDraws = autoInstance(busiest).length;
  if (busiest.length >= 12 && busiestDraws > 4) fail(`marble: the busiest wall's ${busiest.length} parts take ${busiestDraws} draw calls`);
  else ok(`marble: the busiest wall's ${busiest.length} parts fold to ${busiestDraws} draw calls`);
  for (const u of eligibleUppers) {
    if (!u.contents) fail(`marble: ${u.id} (${u.type}) was left with no contents at all`);
  }
} else {
  fail('client-marble.spec.json is missing');
}

// ---------------------------------------------------------------------------
// 6. Budget
// ---------------------------------------------------------------------------
console.log('\n6. BUDGET — 24 items and five crowded cabinets stay inside 900 / 1.2M');

const base0 = kitchenGeometryBudget(computeKitchenLayout(bare));
const withItems = kitchenGeometryBudget(L);
console.log(`  baseline  ${base0.drawCalls} draws, ${base0.triangles.toLocaleString()} tris`);
console.log(`  itemsBase ${withItems.drawCalls} draws, ${withItems.triangles.toLocaleString()} tris`);
if (withItems.drawCalls > 900 || withItems.triangles > 1_200_000) fail('itemsBase is over budget');
else ok('itemsBase inside the budget');

const KINDS: DecorItem['kind'][] = [
  'pot', 'pan', 'kettle', 'dutch-oven', 'cutting-board', 'bowl', 'fruit-bowl', 'bottle',
  'oil-set', 'vase', 'flowers', 'books', 'utensil-crock', 'knife-block', 'coffee-maker',
  'stand-mixer', 'toaster', 'microwave-countertop', 'soap-set', 'dish-rack', 'tray',
  'candle', 'canister', 'paper-towel', 'plate-stack', 'mugs', 'jar', 'basket', 'towel', 'other',
];
const stress = withDecor(
  BASE,
  KINDS.slice(0, 24).map((kind, i) => item({
    kind, on: i % 4 === 0 ? 'island' : 'counter', wall: i % 4 === 0 ? 'island' : i % 2 ? 'back' : 'left',
    t: ((i * 37) % 100) / 100, sizeIn: 10, material: 'ceramic', colorHex: '#c0392b', count: 3,
  })),
  (['back', 'left', 'right'] as const).flatMap((wall) => [0.2, 0.5, 0.8].map((t) => ({ wall, t, kind: 'mixed' as const, density: 'full' as const }))),
);
const stressSpec: KitchenSpec = {
  ...stress,
  runs: stress.runs.map((r) => ({ ...r, uppers: (r.uppers ?? []).map((u) => (u.type === 'door' ? { ...u, type: 'glass' as const } : u)) })),
};
const SL = computeKitchenLayout(stressSpec);
const sb = kitchenGeometryBudget(SL);
console.log(`  stress    ${sb.drawCalls} draws, ${sb.triangles.toLocaleString()} tris (${SL.decor.items.length} items, ${SL.runs.flatMap((r) => r.uppers).filter((u) => u.contents && u.contents !== 'empty').length} filled cabinets)`);
if (sb.drawCalls > 900 || sb.triangles > 1_200_000) fail('the stress scenario is over budget');
else ok('the stress scenario is inside the budget');

// every kind must build without throwing
for (const kind of KINDS) {
  const spec = withDecor(BASE, [item({ kind, on: 'counter', wall: 'back', t: 0.5, sizeIn: 10 })], []);
  const KL = computeKitchenLayout(spec);
  const parts = itemsParts(KL);
  if (KL.decor.items.length && !parts.length) fail(`kind '${kind}' solved but drew nothing`);
  for (const p of parts) if (!p.geometry.getAttribute('position')?.count) fail(`kind '${kind}' drew an empty geometry`);
}
ok(`all ${KINDS.length} kinds build a non-empty geometry`);

// ---------------------------------------------------------------------------
// 7. Never priced
// ---------------------------------------------------------------------------
console.log('\n7. NEVER PRICED — the estimate cannot see the detail layer');

const sel = { ...DEFAULT_SELECTIONS.kitchen };
const withE = calculateEstimate(itemsBase, sel, DEFAULT_ESTIMATE_SETTINGS);
const withoutE = calculateEstimate(bare, sel, DEFAULT_ESTIMATE_SETTINGS);
if (JSON.stringify(withE.lines) !== JSON.stringify(withoutE.lines)) fail('the estimate lines changed when items were added');
else ok(`estimate lines byte-identical with and without ${ITEMS.length} items (${withE.lines.length} lines)`);

// ---------------------------------------------------------------------------
// 8. Never silent
// ---------------------------------------------------------------------------
console.log('\n8. NEVER SILENT — what cannot be honoured is named');

const crowdedSpec = withDecor(
  { ...BASE, dims: { ...BASE.dims, widthFt: 8, depthFt: 8 }, island: { ...BASE.island, present: false } },
  Array.from({ length: 10 }, (_, i) => item({ kind: 'tray', on: 'counter', wall: 'back', t: (i + 0.5) / 10, sizeIn: 30, material: 'stainless' })),
  [],
);
const CL = computeKitchenLayout(crowdedSpec);
if (CL.decor.items.length >= 10) fail(`ten 30" trays all fitted on a short run (${CL.decor.items.length} placed)`);
else if (CL.decor.warnings.length === 0) fail(`${10 - CL.decor.items.length} trays were dropped with no warning`);
else ok(`${CL.decor.items.length} trays placed, ${CL.decor.warnings.length} warnings name the rest`);

const noRange: KitchenSpec = withDecor(
  { ...BASE, appliances: BASE.appliances.filter((a) => a.kind !== 'range' && a.kind !== 'cooktop' && a.kind !== 'hood') },
  [item({ kind: 'pot', on: 'range', burner: 'left-back', sizeIn: 10 })],
  [],
);
const NL = computeKitchenLayout(noRange);
const rehosted = NL.decor.items[0];
if (!rehosted) fail('an on:range item in a range-less kitchen was dropped entirely');
else {
  if (rehosted.on !== 'counter') fail(`an on:range item with no range became on:'${rehosted.on}', expected 'counter'`);
  const said = NL.decor.warnings.find((w) => /pot|range/i.test(w));
  if (!said) fail(`the re-hosted item was moved silently (warnings: ${NL.decor.warnings.join('; ') || 'none'})`);
  else ok(`an on:range item with no range moved to the counter: "${said}"`);
}

// ---------------------------------------------------------------------------
console.log('\n9. A REAL CLIENT PHOTO — the fixture carries what its photo shows');

{
  // Everything above is synthetic. This section is the one that would have
  // caught the layer regressing on a room somebody actually photographed:
  // client-marble's own inventory boxes a wood bowl of limes on the island and
  // its back run is a row of glass-front uppers.
  const marble = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/fixtures/client-marble.spec.json'), 'utf8')) as KitchenSpec;
  const bowl = marble.decor.items.find((i) => i.kind === 'fruit-bowl');
  if (!bowl) fail("client-marble carries no fruit bowl, though its inventory boxes one ('wood fruit bowl with green limes')");
  else if (bowl.on !== 'island') fail(`client-marble's fruit bowl stands on '${bowl.on}', but the photo puts it on the island`);
  else ok(`client-marble carries the bowl its photo shows: ${bowl.label} on the ${bowl.on}`);
  const boxed = marble.detected.elements.find((e) => e.kind === 'item');
  if (!boxed) fail("client-marble's inventory has no element of kind 'item' — the bowl is still tagged 'other' and the fitter cannot pair it");
  else ok(`and the inventory boxes it as an item: "${boxed.label}"`);
  if (!marble.decor.cabinetContents.length) fail('client-marble has six glass-front uppers and no cabinetContents entry');
  else {
    const ML = computeKitchenLayout(marble);
    const drawnItems = ML.decor.items.filter((i) => i.kind === 'fruit-bowl');
    const filled = ML.runs.flatMap((r) => r.uppers).filter((u) => u.contents && u.contents !== 'empty');
    const asked = marble.decor.cabinetContents[0];
    const got = ML.runs.flatMap((r) => r.uppers).find((u) => u.contents === asked.kind);
    if (drawnItems.length !== 1) fail(`the bowl is not drawn on the marble twin (${drawnItems.length} fruit bowls in the layout)`);
    else if (!got) fail(`the '${asked.kind}' cabinet the fixture names is not resolved onto any upper`);
    else ok(`the twin draws the bowl and fills ${filled.length} glass uppers, the named one with ${asked.kind}`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n10. FROM THE PHOTO'S OWN BOXES — every small thing the inventory saw");

{
  // The gap this closes, measured live against production: the items-only
  // inventory pass boxed NINETEEN objects on the client's marble kitchen and
  // the main analysis described EIGHT, so the twin drew eight, the fitter
  // reported eleven unmatched photo elements and coverage sat at 68%.
  // `itemsFromInventory` turns the unclaimed boxes into real entries.
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/fixtures/client-marble-items.spec.json'), 'utf8')) as KitchenSpec;
  const boxes = raw.detected.elements.filter((e) => e.kind === 'item');
  const before = raw.decor.items.length;
  if (boxes.length !== 19 || before !== 8) fail(`the fixture drifted: expected 19 boxed items against 8 described, got ${boxes.length} against ${before}`);

  // Nineteen boxes are not nineteen objects: both vision passes box the same
  // counter and both readings survive the merge, so his three left-run vases
  // arrive as eight boxes and his two boards as five. The honest landing is a
  // dozen-odd objects — too few means the detail is being thrown away again,
  // too many means the twin is drawing one pot twice.
  const grown = itemsFromInventory(raw);
  if (grown.decor.items.length < 12) fail(`only ${grown.decor.items.length} items from 19 boxes — the twin still draws less than the photo shows`);
  else if (grown.decor.items.length > 16) fail(`${grown.decor.items.length} items from 19 boxes — the second readings are being drawn as second objects`);
  else ok(`${before} described + ${grown.decor.items.length - before} synthesised = ${grown.decor.items.length} items for ${boxes.length} boxes`);

  // the analysis's own eight are untouched, in order, and never doubled
  const head = grown.decor.items.slice(0, before);
  const same = head.every((it, i) => JSON.stringify(it) === JSON.stringify(raw.decor.items[i]));
  if (!same) fail("the analysis's own entries were rewritten — they are the better reading and must win");
  else ok("the analysis's eight entries come through byte-identical, first");
  // What a client actually sees, counted per host. Comparing LABELS proves
  // nothing here — the analysis wrote "round wood board" and the inventory
  // "round wood cutting board" for the same slab, so an exact-label test
  // passes green while the twin stands both against the splash. These
  // ceilings are read off the photograph itself: three vases in the left
  // corner, two boards leaning on the backsplash, one bowl of limes on the
  // island. The doubling bug drew seven, four and two.
  const SEEN: Array<{ kind: DecorItem['kind']; on: DecorItem['on']; wall: DecorItem['wall']; photo: number; max: number }> = [
    { kind: 'vase', on: 'counter', wall: 'left', photo: 3, max: 4 },
    { kind: 'cutting-board', on: 'counter', wall: 'back', photo: 2, max: 3 },
    { kind: 'fruit-bowl', on: 'island', wall: 'island', photo: 1, max: 1 },
  ];
  const drawnCount = (spec: KitchenSpec, w: (typeof SEEN)[number]) =>
    spec.decor.items.filter((i) => i.kind === w.kind && i.on === w.on && i.wall === w.wall).reduce((n, i) => n + Math.max(1, i.count), 0);
  const crowded = SEEN.filter((w) => drawnCount(grown as KitchenSpec, w) > w.max);
  if (crowded.length) fail(`the twin crowds a surface the photo does not: ${crowded.map((w) => `${drawnCount(grown as KitchenSpec, w)} ${w.kind}s on the ${w.wall} ${w.on} where the photo shows ${w.photo}`).join('; ')}`);
  else ok(`no surface is crowded: ${SEEN.map((w) => `${drawnCount(grown as KitchenSpec, w)}/${w.photo} ${w.kind}`).join(', ')} (photo counts)`);
  // …and the near-misses too: the analysis's "clear glass vase" on the island
  // IS the box labelled "clear glass vase with green branches", so that box
  // must not come back as a second vase standing beside the first
  const islandVases = grown.decor.items.filter((i) => i.on === 'island' && i.kind === 'vase');
  if (islandVases.length > 1) fail(`the island grew ${islandVases.length} vases where the photo has one: ${islandVases.map((v) => v.label).join(' | ')}`);
  else ok('a box the analysis described in different words is recognised, not doubled ("clear glass vase" = "clear glass vase with green branches")');

  // it survives the strict schema and the reconciler's own repair
  const settled = reconcileSpec(grown, { photoCount: 1, fixes: [] }) as KitchenSpec;
  const parsed = RoomSpecZ.safeParse(settled);
  if (!parsed.success) fail(`the grown spec does not validate: ${parsed.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  else ok(`RoomSpecZ accepts it, and reconcile settles on ${settled.decor.items.length} items`);
  const GL = computeKitchenLayout(settled);
  if (GL.decor.items.length < settled.decor.items.length) fail(`the twin only draws ${GL.decor.items.length} of ${settled.decor.items.length} items (${GL.decor.warnings.filter((w) => /dropped/.test(w)).join('; ')})`);
  else ok(`the twin draws all ${GL.decor.items.length} of them`);

  // every host was read from the boxes, not guessed: the photo puts things on
  // the island AND on both counter runs
  const hosts = new Set(settled.decor.items.map((i) => `${i.on}:${i.wall}`));
  if (hosts.size < 3) fail(`every item landed on the same host (${[...hosts].join(', ')})`);
  else ok(`hosted across ${hosts.size} surfaces: ${[...hosts].sort().join(', ')}`);
}

{
  // The client's nineteen labels, verbatim from the live inventory. A kind of
  // 'other' here is a twin drawing a grey blob where the photo has a copper
  // pitcher, so every one of these must land somewhere sensible.
  const LABELS: Array<[string, DecorItem['kind']]> = [
    ['copper pitcher', 'vase'],
    ['woven tan pitcher', 'vase'],
    ['round wood cutting board', 'cutting-board'],
    ['woven tan vase', 'vase'],
    ['small round wood cutting board', 'cutting-board'],
    ['brass metal vase', 'vase'],
    ['wood bowl with greens', 'bowl'],
    ['tan woven vase', 'vase'],
    ['wood bowl with green limes', 'fruit-bowl'],
    ['clear glass vase with green branches', 'vase'],
    ['copper metal vase', 'vase'],
    ['light wood utensil crock', 'utensil-crock'],
    // a PLANTER is a vessel with a plant in it: it used to land in the `bowl`
    // rule, which drew the pot and threw the plant away — `flowers` composes
    // the vessel, the stems and the leaves, so the plant survives
    ['shallow wood planter with green herbs', 'flowers'],
    ['shallow wood fruit bowl with green limes', 'fruit-bowl'],
  ];
  const wrong = LABELS.filter(([label, want]) => kindFromLabel(label) !== want);
  if (wrong.length) fail(`${wrong.length} label(s) read wrong: ${wrong.map(([l, want]) => `"${l}" → ${kindFromLabel(l)}, expected ${want}`).join('; ')}`);
  else ok(`all ${LABELS.length} distinct labels from the client's photo map to the kind a contractor would name`);

  // …and a pot on the stove, which is the client's own example
  const stove: Array<[string, DecorItem['kind']]> = [
    ['stainless stock pot', 'pot'], ['cast iron skillet', 'pan'], ['blue enamel dutch oven', 'dutch-oven'],
    ['copper kettle', 'kettle'], ['white ceramic canisters', 'canister'], ['paper towel roll', 'paper-towel'],
    ['stack of white plates', 'plate-stack'], ['woven basket', 'basket'], ['glass olive oil bottle', 'oil-set'],
  ];
  const off = stove.filter(([label, want]) => kindFromLabel(label) !== want);
  if (off.length) fail(`${off.length} everyday label(s) read wrong: ${off.map(([l, want]) => `"${l}" → ${kindFromLabel(l)}, expected ${want}`).join('; ')}`);
  else ok('and the everyday cookware vocabulary reads too (pot, skillet, dutch oven, kettle, canisters…)');

  // the colours describe the OBJECT, never what it holds
  const bowl = itemsFromInventory(specWithBoxes([{ id: 'i-1', label: 'wood bowl with green limes', box: [0.45, 0.56, 0.6, 0.66] }]));
  const drawn = bowl.decor.items[bowl.decor.items.length - 1];
  if (drawn.material !== 'wood') fail(`"wood bowl with green limes" came out ${drawn.material}, not wood`);
  else if (drawn.colorHex === '#7E8F62') fail('the bowl took the colour of the limes inside it');
  else ok(`"wood bowl with green limes" → ${drawn.kind}, ${drawn.material} ${drawn.colorHex} (not the fruit's green)`);
}

{
  // Degradation. A label nobody anticipated, a box in the middle of nowhere:
  // the entry still has to be a legal DecorItem, because a throw here takes
  // the whole analysis down to the template.
  const junk = itemsFromInventory(specWithBoxes([
    { id: 'j-1', label: '???', box: [0.4, 0.5, 0.44, 0.55] },
    { id: 'j-2', label: '', box: [0.5, 0.5, 0.54, 0.55] },
    { id: 'j-3', label: 'zblorp mcguffin 9000', box: [0.6, 0.5, 0.64, 0.55] },
  ]));
  const made = junk.decor.items.slice(BASE.decor.items.length);
  const parsed = RoomSpecZ.safeParse(junk);
  if (made.length !== 3) fail(`three garbage labels produced ${made.length} entries, expected 3`);
  else if (!parsed.success) fail(`a garbage label produced an invalid spec: ${parsed.error.issues.slice(0, 2).map((i) => i.path.join('.')).join('; ')}`);
  else if (!made.every((m) => m.kind === 'other' && /^#[0-9A-F]{6}$/.test(m.colorHex) && m.sizeIn > 0)) fail(`a garbage label produced ${JSON.stringify(made[0])}`);
  else if (made.some((m) => m.colorHex === '#000000')) fail('an unreadable label defaulted to black');
  else ok(`three unreadable labels degrade to valid 'other' items in a neutral colour (${made[0].colorHex})`);
  const empty = itemsFromInventory(BASE);
  if (empty !== BASE) fail('a spec with no boxed items was rewritten anyway');
  else ok('a spec whose inventory boxes no items comes back untouched, by identity');
}

{
  // The cap. The schema stops at 24 and the most VISIBLE objects are the ones
  // a client looks for, so the biggest boxes win and the rest are said out loud.
  // Thirty SEPARATE objects, laid out six across and five down: boxes stacked
  // on the same corner would be thirty readings of one bowl, and the
  // clustering would rightly draw a single one of them.
  const many = Array.from({ length: 30 }, (_, i) => {
    // box i is bigger than box i-1, so the last ones are the ones to keep
    const w = 0.004 * (i + 1);
    const h = w * 1.2;
    const cx = 0.08 + (i % 6) * 0.16;
    const cy = 0.12 + Math.floor(i / 6) * 0.18;
    return {
      id: `m-${i}`,
      label: `wood bowl ${i}`,
      box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] as [number, number, number, number],
    };
  });
  const capped = itemsFromInventory(specWithBoxes(many));
  const note = capped.detected.notes.find((n) => n.startsWith('decor.items:'));
  if (capped.decor.items.length !== 24) fail(`30 candidates produced ${capped.decor.items.length} items, expected exactly 24`);
  else if (!note || !/dropped/.test(note)) fail(`the dropped candidates were not written down (notes: ${JSON.stringify(capped.detected.notes.slice(-2))})`);
  else {
    const kept = capped.decor.items.slice(BASE.decor.items.length).map((i) => Number(i.label.split(' ')[2]));
    const smallest = Math.min(...kept);
    const biggest = many.length - 1;
    if (kept.some((n) => n < biggest - kept.length + 1)) fail(`the cap kept a smaller box over a bigger one (kept ${kept.join(', ')})`);
    else ok(`30 candidates → 24 items, the ${kept.length} biggest boxes kept (down to #${smallest}): "${note}"`);
  }
}

{
  // Determinism. The reconciler is run twice over its own output everywhere
  // (the store rehydrate, the share page, /api/refine), so a pass that shuffles
  // on the second run would move a client's pot every time they reload.
  const marble = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/fixtures/client-marble-items.spec.json'), 'utf8')) as KitchenSpec;
  const once = itemsFromInventory(marble);
  const twice = itemsFromInventory(JSON.parse(JSON.stringify(marble)) as KitchenSpec);
  if (JSON.stringify(once) !== JSON.stringify(twice)) fail('two runs of the pass over the same spec disagree');
  else if (JSON.stringify(itemsFromInventory(once)) !== JSON.stringify(once)) fail('running the pass over its own output added or moved something — it is not a fixed point');
  else ok('the pass is deterministic and idempotent: run twice, byte-identical');

  // …including when a box carries NO readable label. Every label in the marble
  // fixture has words in it, so it cannot catch this on its own: an unlabelled
  // box matches nothing lexically, and before the geometric arm of the
  // duplicate test it could never be recognised as the grey 'other' it had
  // produced the run before. Six reloads grew the demo kitchen by three items
  // each time until it pinned at the 24-item cap.
  const mute = specWithBoxes([
    { id: 'q-1', label: '', box: [0.12, 0.5, 0.16, 0.56] },
    { id: 'q-2', label: '???', box: [0.4, 0.5, 0.44, 0.56] },
    { id: 'q-3', label: 'a of the', box: [0.68, 0.5, 0.72, 0.56] },
  ]);
  let grown6 = mute as KitchenSpec;
  const counts: number[] = [];
  for (let i = 0; i < 6; i++) { grown6 = reconcileSpec(grown6, { photoCount: 1, fixes: [] }) as KitchenSpec; counts.push(grown6.decor.items.length); }
  if (new Set(counts).size !== 1) fail(`three unlabelled boxes grow the spec on every reload: ${counts.join(' → ')} items`);
  else ok(`three unlabelled boxes settle at ${counts[0]} items and stay there over six reloads`);
  const a = reconcileSpec(marble, { photoCount: 1, fixes: [] });
  const b = reconcileSpec(a, { photoCount: 1, fixes: [] });
  if (JSON.stringify(a) !== JSON.stringify(b)) fail('reconcileSpec is no longer a fixed point with the synthesiser in it');
  else ok('and reconcileSpec still settles in one pass');
}

// ---------------------------------------------------------------------------
console.log('\n11. NOT BOXES, NOT CONES, NOT DISCS — the client\'s three sentences');

/**
 * "the items on the island are js boxes vs something else in the picture" ·
 * "the lights arent the same" · "proportions arent there… detail"
 *
 * `kind: 'other'` fell through to a filleted BOX, `style: 'glass'` drew an
 * opaque bell, and every non-saddle stool drew a 340 mm round disc whatever the
 * photo showed. All three are measured here.
 */

/**
 * The invariant chosen for "not a box": what FRACTION of a geometry's vertices
 * lie on one of its own six bounding planes. A cuboid — filleted or not — puts
 * EVERY vertex on a face plane, so the old `otherBox` scores 1.00; a solid of
 * revolution or a lozenge puts most of them well inside. It is a property of
 * the shape rather than of one builder, so a future fallback that merely
 * re-tunes its fillet radius is still caught.
 */
function onFacePlanes(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const tol = 0.002;
  let on = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(x - bb.min.x) < tol || Math.abs(x - bb.max.x) < tol
      || Math.abs(y - bb.min.y) < tol || Math.abs(y - bb.max.y) < tol
      || Math.abs(z - bb.min.z) < tol || Math.abs(z - bb.max.z) < tol) on++;
  }
  return on / Math.max(1, p.count);
}
const ON_FACES_MAX = 0.5;

{
  // --- 11.1 an unnameable thing is a soft form, not a crate ----------------
  const spec = withDecor(BASE, [item({ kind: 'other', on: 'counter', wall: 'back', t: 0.5, sizeIn: 12, material: 'paper', colorHex: '#B98954' })], []);
  const OL = computeKitchenLayout(spec);
  const it = OL.decor.items[0];
  const parts = itemsParts(OL);
  if (!it || parts.length !== 1) fail(`an 'other' item drew ${parts.length} parts, expected 1`);
  else {
    const g = parts[0].geometry;
    const frac = onFacePlanes(g);
    const boxFrac = onFacePlanes(filletBox(it.w, it.h, it.d, 0.006, 2));
    if (frac > ON_FACES_MAX) fail(`'other' still reads as a box: ${(frac * 100).toFixed(0)}% of its vertices sit on a face plane (a filletBox is ${(boxFrac * 100).toFixed(0)}%)`);
    else ok(`'other' is a soft form: ${(frac * 100).toFixed(0)}% of vertices on a face plane vs ${(boxFrac * 100).toFixed(0)}% for the filletBox it replaced`);
    // …and it still fills exactly the footprint `buildDecor` reserved for it
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const dims: Array<[string, number, number]> = [
      ['w', bb.max.x - bb.min.x, it.w], ['h', bb.max.y - bb.min.y, it.h], ['d', bb.max.z - bb.min.z, it.d],
    ];
    const off = dims.filter(([, got, want]) => !near(got, want, 1e-4));
    if (off.length) fail(`the soft form does not fill its reservation: ${off.map(([n, got, want]) => `${n} ${got.toFixed(4)} vs ${want.toFixed(4)}`).join(', ')}`);
    else if (!near(bb.min.y, 0, 1e-4)) fail(`the soft form floats or sinks: its base is at y ${bb.min.y.toFixed(4)}, not 0`);
    else ok(`and it fills exactly the reserved ${(it.w * 39.37).toFixed(1)} x ${(it.h * 39.37).toFixed(1)} x ${(it.d * 39.37).toFixed(1)} in box, sitting on y = 0`);
  }

  // every kind, at four sizes, must be something other than the fallback block.
  // The identity test (is this geometry the OLD `otherBox`?) is the strong one;
  // the vertex fraction above is the guard behind it, and it only applies to
  // 'other' because a candle really is a cylinder and a board really is a slab.
  const boxy: string[] = [];
  const soft: string[] = [];
  for (const kind of KINDS) {
    for (const sizeIn of [6, 10, 14, 20]) {
      const one = computeKitchenLayout(withDecor(BASE, [item({ kind, on: 'counter', wall: 'back', t: 0.5, sizeIn })], []));
      const one0 = one.decor.items[0];
      if (!one0) continue;
      const fb = filletBox(one0.w, one0.h, one0.d, 0.006, 2);
      const fbv = fb.getAttribute('position') as THREE.BufferAttribute;
      for (const p of itemsParts(one)) {
        const pv = p.geometry.getAttribute('position') as THREE.BufferAttribute;
        let same = pv.count === fbv.count;
        for (let i = 0; same && i < pv.count; i++) {
          if (Math.abs(pv.getX(i) - fbv.getX(i)) > 1e-6 || Math.abs(pv.getY(i) - one0.h / 2 - fbv.getY(i)) > 1e-6 || Math.abs(pv.getZ(i) - fbv.getZ(i)) > 1e-6) same = false;
        }
        if (same) boxy.push(`${kind}@${sizeIn}`);
      }
      if (kind === 'other') for (const p of itemsParts(one)) if (onFacePlanes(p.geometry) > ON_FACES_MAX) soft.push(`${kind}@${sizeIn} ${(onFacePlanes(p.geometry) * 100).toFixed(0)}%`);
    }
  }
  if (boxy.length) fail(`${boxy.length} part(s) still draw the fallback block: ${boxy.join(', ')}`);
  else if (soft.length) fail(`'other' hardens into a box at some sizes: ${soft.join(', ')}`);
  else ok(`none of the ${KINDS.length} kinds draws the fallback block at 6 / 10 / 14 / 20 in, and 'other' stays soft at all four`);
}

{
  // --- 11.2 label routing -------------------------------------------------
  const ROUTES: Array<[string, DecorItem['kind'] | null]> = [
    ['clear drinking glass', 'jar'],
    ['glass tumbler', 'jar'],
    ['white planter with green plant', 'flowers'],
    ['small white potted plant', 'flowers'],
    ['brass pot filler', null],
    ['stainless faucet', null],
    ['cabinet pull', null],
    // …without eating the objects those words also appear inside
    ['clear glass vase with green branches', 'vase'],
    ['copper pot with a wood handle', 'pot'],
    ['stainless stock pot', 'pot'],
  ];
  const bad = ROUTES.filter(([label, want]) => readKind(label).kind !== want);
  if (bad.length) fail(`${bad.length} label(s) route wrong: ${bad.map(([l, w]) => `"${l}" → ${String(readKind(l).kind)}, expected ${String(w)}`).join('; ')}`);
  else ok(`${ROUTES.length} labels route to the object a contractor would name, and three pieces of plumbing / hardware are rejected outright`);

  // the reject is a DROP, not a re-host: the box must not come back somewhere else
  const filler = itemsFromInventory(specWithBoxes([
    { id: 'p-1', label: 'brass pot filler', box: [0.44, 0.39, 0.56, 0.45] },
    { id: 'p-2', label: 'stainless stock pot', box: [0.30, 0.50, 0.36, 0.56] },
  ]));
  const made = filler.decor.items.slice(BASE.decor.items.length);
  if (made.length !== 1 || made[0].kind !== 'pot' || /filler/.test(made[0].label)) {
    fail(`the pot filler was not dropped: ${made.length} entries — ${made.map((m) => `${m.kind} "${m.label}"`).join(', ')}`);
  } else ok('a boxed "brass pot filler" is dropped, not re-hosted; the real stock pot beside it still lands');

  // …and an entry the ANALYSIS wrote is pruned too, wherever the words came from
  const seeded = withDecor(BASE, [
    item({ kind: 'pot', on: 'counter', wall: 'back', t: 0.26, sizeIn: 16, label: 'brass pot filler', material: 'brass' }),
    item({ kind: 'kettle', on: 'counter', wall: 'back', t: 0.6, sizeIn: 9, label: 'stainless kettle' }),
  ], []);
  const pruned = itemsFromInventory(seeded);
  if (pruned.decor.items.some((i) => /pot filler/.test(i.label))) fail('an analysis entry naming the wall pot filler survived the pass');
  else if (pruned.decor.items.length !== 1) fail(`pruning took ${2 - pruned.decor.items.length} entries, expected exactly 1`);
  else ok(`a described "brass pot filler" is pruned as well (${pruned.decor.items.length} of 2 entries kept)`);
}

{
  // --- 11.3 the two clamp tables cannot disagree ---------------------------
  const drift = (ITEM_KINDS as DecorItem['kind'][]).filter((k) =>
    DEFAULT_SIZE_IN[k] !== ITEM_SIZE[k][0] || SIZE_RANGE_IN[k][0] !== ITEM_SIZE[k][1] || SIZE_RANGE_IN[k][1] !== ITEM_SIZE[k][2]);
  if (drift.length) fail(`the spec path and the draw path disagree about ${drift.length} kind(s): ${drift.join(', ')}`);
  else ok(`all ${ITEM_KINDS.length} kinds clamp identically in the spec path (ITEM_SIZE) and the draw path (DEFAULT_SIZE_IN / SIZE_RANGE_IN)`);
}

{
  // --- 11.4 a big thing on a worktop is two things ------------------------
  const CASES: Array<[DecorItem['kind'], DecorItem['on'], number, number, string]> = [
    // halved toward the kind's default, because a 16 in bowl on a worktop is a
    // board AND a bowl outlined as one object
    ['bowl', 'island', 16, 12.5, 'the client\'s island bowl'],
    ['bowl', 'counter', 16, 12.5, 'the same on a counter'],
    ['other', 'island', 18, 12, 'the bread loaf'],
    // NOT halved: only the kind's own ceiling applies off a worktop…
    ['bowl', 'floor', 16, 13, 'a floor bowl meets its ceiling, never the halving'],
    ['bowl', 'floor', 12, 12, 'and under the ceiling it is untouched'],
    ['basket', 'floor', 20, 20, 'a floor basket really is 20 in'],
    // …nor to an appliance, which is genuinely that big
    ['microwave-countertop', 'counter', 20, 20, 'an appliance is left alone'],
    ['coffee-maker', 'counter', 16, 16, 'so is a coffee maker'],
    // …nor under the threshold
    ['other', 'counter', 14, 14, '14 in is under the 15 in threshold'],
  ];
  const wrong = CASES.filter(([k, on, got, want]) => plausibleSizeIn(k, on, got) !== want);
  if (wrong.length) {
    fail(`the oversize rule misfires: ${wrong.map(([k, on, got, want]) => `${k} on ${on} ${got} → ${plausibleSizeIn(k, on, got)}, expected ${want}`).join('; ')}`);
  } else ok(`oversize rule: ${CASES.map(([k, on, got]) => `${k}/${on} ${got}→${plausibleSizeIn(k, on, got)}`).join(', ')}`);
}

{
  // --- 11.5 the client's own kitchen --------------------------------------
  const tanPath = path.join(process.cwd(), 'scripts/fixtures/client-tan.spec.json');
  if (!fs.existsSync(tanPath)) fail('client-tan.spec.json is missing');
  else {
    const tan = JSON.parse(fs.readFileSync(tanPath, 'utf8')) as KitchenSpec;
    const boxes = tan.detected.elements.filter((e) => e.kind === 'item').length;
    const settled = itemsFromInventory(tan) as KitchenSpec;
    const TL = computeKitchenLayout(settled);
    const IN = (m: number) => m / 0.0254;

    const fatOther = TL.decor.items.filter((i) => i.kind === 'other' && IN(Math.max(i.w, i.h, i.d)) > 14.25);
    if (fatOther.length) fail(`${fatOther.length} 'other' item(s) drawn over 14 in: ${fatOther.map((i) => IN(Math.max(i.w, i.h, i.d)).toFixed(1)).join(', ')}`);
    else ok(`client-tan: no unnameable object is drawn over 14 in (largest ${TL.decor.items.filter((i) => i.kind === 'other').map((i) => IN(Math.max(i.w, i.h, i.d))).sort((a, b) => b - a).map((n) => n.toFixed(1))[0] ?? '–'} in)`);

    if (settled.decor.items.some((i) => /pot filler/.test(i.label))) fail('client-tan still carries the wall pot filler as a countertop pot');
    else ok('client-tan: the brass pot filler is gone from decor.items');

    // Nothing the BOX RULER writes may land exactly on its kind's ceiling. Two
    // entries did ("wood serving bowl" 16, "brass pot filler" 16, both pinned
    // at the old 16 in max), which is the tell that the ruler over-reads and
    // the clamp is the only brake on it. The fixture's own note says 14 of its
    // 24 entries came from the ruler; wind those back and run the pass again,
    // so what is measured is exactly the synthesiser's own output — with the
    // analysis's ten still there, because they are what calibrates the ruler.
    const SYNTHESISED = 14;
    const described = tan.decor.items.length - SYNTHESISED;
    const ruled = itemsFromInventory({ ...tan, decor: { ...tan.decor, items: tan.decor.items.slice(0, described) } } as KitchenSpec) as KitchenSpec;
    const fresh = ruled.decor.items.slice(ruled.decor.items.length - Math.max(0, ruled.decor.items.length - described));
    // Two things are asserted, and the second is the general one.
    //  (a) the two entries that WERE pinned at the old 16 in ceiling: the pot
    //      filler is gone outright and the serving bowl comes back smaller;
    //  (b) nothing the ruler puts on a worktop exceeds the greater of
    //      CROWDED_SURFACE_IN and its kind's own default. That is the rule this
    //      round added, at its stated threshold, and it is what stops the
    //      ceiling from being the only brake on the ruler. The floor is the
    //      kind's default because a floral arrangement really is 18 in.
    //      One entry still lands ON its kind's ceiling — the big wooden bowl on
    //      the island, whose box really is a quarter of the frame wide — which
    //      is a 13 in bowl, an object that exists, not a 16 in one that does not.
    const filler2 = fresh.filter((i) => /pot filler/.test(i.label));
    const servingBowls = fresh.filter((i) => /serving bowl/.test(i.label));
    const ceilFor = (i: DecorItem) => Math.max(CROWDED_SURFACE_IN, ITEM_SIZE[i.kind][0]);
    const over = fresh.filter((i) => (i.on === 'island' || i.on === 'counter') && i.sizeIn > ceilFor(i) + 0.05);
    if (!fresh.length) fail('winding client-tan back to its analysis entries synthesised nothing — the fixture drifted');
    else if (filler2.length) fail(`the box ruler wrote the pot filler again: ${filler2.map((i) => `${i.kind} ${i.sizeIn}`).join(', ')}`);
    else if (servingBowls.some((i) => i.sizeIn > 13.05)) fail(`the serving bowl is still oversize: ${servingBowls.map((i) => i.sizeIn).join(', ')} in`);
    else if (over.length) fail(`${over.length} of ${fresh.length} ruler entries exceed their worktop ceiling: ${over.map((i) => `${i.kind} "${i.label}" ${i.sizeIn} > ${ceilFor(i)}`).join('; ')}`);
    else ok(`client-tan: of ${fresh.length} box-ruler entries the pot filler is gone (was 16 in), the serving bowl is ${servingBowls.map((i) => i.sizeIn).join('/')} in (was 16), and none exceeds max(${CROWDED_SURFACE_IN}, its default) on a worktop`);

    if (Math.abs(TL.decor.items.length - 24) > 2) fail(`client-tan draws ${TL.decor.items.length} items for ${boxes} boxes — outside 24 ± 2`);
    else ok(`client-tan: ${TL.decor.items.length} items drawn for ${boxes} inventory boxes (24 ± 2)`);
  }
}

{
  // --- 11.6 the pendants ---------------------------------------------------
  // `PendantLight` is a client component and its shade factory is a useMemo, so
  // importing it headlessly would drag in R3F and the reconciler. The source is
  // read instead — narrow on purpose: this asks only whether 'glass' and
  // 'globe' build the SAME sphere, and whether the cap sits on the crown.
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/scene/Lighting.tsx'), 'utf8');
  const cases = [...src.matchAll(/case '(glass|globe)':\s*(?:\n\s*(?:case '\w+':|default:))*\s*return ([^\n]+)/g)];
  const glass = cases.find((m) => m[1] === 'glass')?.[2] ?? '';
  const globe = /case 'globe':\s*\n\s*default: return ([^\n]+)/.exec(src)?.[1] ?? '';
  if (!/SphereGeometry\(GLOBE_R/.test(glass)) fail(`pendant style 'glass' does not build a globe: ${glass.slice(0, 70) || '(no case found)'}`);
  else if (glass !== globe) fail(`'glass' and 'globe' build different shades: ${glass.slice(0, 50)} vs ${globe.slice(0, 50)}`);
  else ok(`pendant 'glass' and 'globe' build one flattened-crown sphere: ${glass.trim()}`);
  // `pendantDrop` defines `y` as where the shade's BOTTOM sits, and `boxes.ts`
  // builds the fitter's pendant box from that same line, so the globe's centre
  // has to be a radius ABOVE it. `y - GLOBE_R` put the drawn glass 2*GLOBE_R
  // (0.28 m) under the box it is scored against.
  if (!/const shadeY = globe \? y \+ GLOBE_R/.test(src)) fail("a globe's centre does not sit a radius ABOVE the drop line, so its bottom misses pendantDrop's line");
  else ok('a globe sits a radius above the drop line: its BOTTOM is the line pendantDrop and boxes.ts both mean');
  // and the cord must stop where the cap grips, not run on through clear glass
  if (!/const cordEnd = globe \? shadeY \+ GLOBE_CROWN : y;/.test(src)) fail('the cord does not stop at the crown the cap grips');
  else if (!/position=\{\[position\[0\], \(position\[1\] \+ cordEnd\) \/ 2, position\[2\]\]\}/.test(src)) fail('the cord is not drawn between the canopy and cordEnd');
  else ok('the cord runs canopy → crown (15 mm inside the 30 mm cap), so there is no floating gap and no rod through the glass');
  if (!/position=\{\[position\[0\], shadeY \+ GLOBE_CROWN, position\[2\]\]\}\s*castShadow>/.test(src)) fail('the socket cap does not sit on the flattened crown with castShadow on');
  else if (!/geometry=\{shade\} material=\{shadeMaterial\} castShadow=\{!globe\}/.test(src)) fail('the glass itself still casts a shadow');
  else ok('the opaque cap sits on the crown and casts; the clear glass does not');
}

{
  // --- 11.7 / 11.8 the stools ---------------------------------------------
  const seatH = 0.66;
  const round = stoolParts(seatH, 'backless', true, 'round');
  const nul = stoolParts(seatH, 'backless', true, null);
  const bbox = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); const b = g.boundingBox!; return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((n) => n.toFixed(5)).join(','); };
  const count = (g: THREE.BufferGeometry) => g.getAttribute('position').count;
  if (round.seat !== nul.seat || round.frame !== nul.frame) fail("seatShape null and 'round' built different geometry — null must mean today's stool exactly");
  else ok(`seatShape null === 'round', byte-identical (seat ${count(round.seat)} verts ${bbox(round.seat)}, frame ${count(round.frame)} verts)`);

  const sq = stoolParts(seatH, 'backless', true, 'square');
  sq.seat.computeBoundingBox();
  const sb = sq.seat.boundingBox!;
  const planW = sb.max.x - sb.min.x, planD = sb.max.z - sb.min.z;
  // the welt bulges 5.5 mm proud of the 340 mm pad on each side
  if (Math.abs(planW - 0.340) > 0.002 || Math.abs(planD - 0.340) > 0.002) {
    fail(`the square pad measures ${(planW * 1000).toFixed(0)} x ${(planD * 1000).toFixed(0)} mm in plan, expected 340 x 340 (the cushion plus its welt)`);
  } else if (Math.abs((sb.max.y - sb.min.y) - 0.055) > 0.002) {
    fail(`the square pad is ${((sb.max.y - sb.min.y) * 1000).toFixed(0)} mm thick, expected 55`);
  } else ok(`the square pad is ${(planW * 1000).toFixed(0)} x ${(planD * 1000).toFixed(0)} mm in plan, ${((sb.max.y - sb.min.y) * 1000).toFixed(0)} mm thick, and it is not a disc`);

  // splay 0: the legs' footprint is the SAME at the floor and under the seat.
  // A splayed frame widens as it falls, which is the frame a round pad wants.
  const spanAt = (g: THREE.BufferGeometry, y0: number, y1: number) => {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y >= y0 && y <= y1) { lo = Math.min(lo, p.getX(i)); hi = Math.max(hi, p.getX(i)); } }
    return hi - lo;
  };
  const widthOf = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); const b = g.boundingBox!; return b.max.x - b.min.x; };
  const sqFloor = spanAt(sq.frame, 0.00, 0.03), sqAll = widthOf(sq.frame);
  if (Math.abs(sqFloor - sqAll) > 0.002) fail(`the square frame is not vertical: ${(sqFloor * 1000).toFixed(0)} mm across at the floor but ${(sqAll * 1000).toFixed(0)} mm at its widest`);
  else ok(`splay 0: the square frame is ${(sqFloor * 1000).toFixed(0)} mm across at the floor and ${(sqAll * 1000).toFixed(0)} mm at its widest — the legs are vertical`);
  const rdFloor = spanAt(round.frame, 0.00, 0.03), rdAll = widthOf(round.frame);
  if (Math.abs(rdFloor - rdAll) < 0.002) fail('the ROUND frame lost its splay — the default stool must be unchanged');
  else ok(`…and the round frame still splays and stands narrower, unchanged (${(rdFloor * 1000).toFixed(0)} mm at the floor, ${(rdAll * 1000).toFixed(0)} mm at its widest)`);

  /** how many horizontal RAILS a frame carries between the floor and the seat plate */
  const rails = (g: THREE.BufferGeometry, H: number) => {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const bin = 0.02, n = Math.ceil(H / bin);
    const hist = new Array<number>(n).fill(0);
    for (let i = 0; i < p.count; i++) { const b = Math.floor(p.getY(i) / bin); if (b >= 0 && b < n) hist[b]++; }
    const sorted = [...hist].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] || 1;
    let bands = 0, inBand = false;
    for (let b = Math.round(0.05 * H / bin); b < Math.round(0.80 * H / bin); b++) {
      const hot = hist[b] > median * 3;
      if (hot && !inBand) bands++;
      inBand = hot;
    }
    return bands;
  };
  const sqRails = rails(sq.frame, seatH), rdRails = rails(round.frame, seatH);
  if (sqRails !== 1) fail(`the square frame carries ${sqRails} rail band(s) between the floor and the seat, expected exactly 1 footrail`);
  else ok(`the square frame carries exactly ${sqRails} footrail (the round frame's two ring stretchers: ${rdRails})`);

  // 11.8 the seat's own colour reaches the drawn part
  const withStools = { ...BASE, decor: { ...BASE.decor, stools: { style: 'backless' as const, frame: 'black-metal' as const, seat: 'leather' as const, seatShape: 'square' as const, seatColorHex: '#5A3B2A' } } };
  const SLd = computeKitchenLayout(withStools);
  // `resolveStools` (layout.ts, CAB's file) does not forward the two contract
  // fields into KStools yet; island.ts reads them structurally, so this stands
  // in for that one-line change and proves the geometry and the colour arrive.
  Object.assign(SLd.decor.stools, { seatShape: 'square', seatColorHex: '#5A3B2A' });
  const seatParts = islandParts(SLd).filter((p) => /stoolS/.test(p.key));
  if (!seatParts.length) fail('no stool seats were drawn');
  else if (!seatParts.every((p) => p.metal?.hex === '#5A3B2A')) fail(`seatColorHex did not reach the drawn seat: ${seatParts.map((p) => p.metal?.hex ?? p.util ?? 'proc').join(', ')}`);
  else ok(`seatColorHex '#5A3B2A' reaches all ${seatParts.length} drawn stool seats`);

  Object.assign(SLd.decor.stools, { seatShape: null, seatColorHex: null });
  const stock = islandParts(SLd).filter((p) => /stoolS/.test(p.key));
  if (!stock.every((p) => p.util === 'leather-tan' && !p.metal)) fail(`a null seatColorHex no longer draws the stock util: ${stock.map((p) => p.metal?.hex ?? p.util).join(', ')}`);
  else ok(`a null seatColorHex still draws the stock 'leather-tan' util on all ${stock.length} seats`);
}

// ---------------------------------------------------------------------------
console.log('\n12. THE BATHROOM\'S DETAIL GEOMETRY — a plant in its pot, tile that weaves');
{
  /*
   * These three are the shape of bugs that a numeric layout check cannot see
   * and that a render makes obvious the moment you look at it, so they are
   * pinned here rather than left to the eye.
   */

  // 12.1 a plant grows OUT OF ITS POT. The builders in bathroom/helpers.ts sit
  // the foliage at the soil line, so everything but a trailing plant (which
  // hangs over the rim) and a tree (which stands on a trunk of its own) has to
  // start at y = 0. It did not: the leafy recipe transformed the SHARED cached
  // stem geometry in place, three stems per cache entry, and the compounded
  // lift floated the whole canopy a quarter of a metre above its own pot.
  for (const form of PLANT_FORMS) {
    const { foliage, trunk } = plantFoliage(form, 1, { potD: 0.18 });
    foliage.computeBoundingBox();
    const b = foliage.boundingBox!;
    if (form === 'trailing') {
      if (b.min.y > -0.2) fail(`a trailing plant's strands stop at y=${b.min.y.toFixed(3)} — they are meant to hang below the rim`);
      else ok(`trailing hangs to ${b.min.y.toFixed(2)} m below its pot`);
    } else if (form === 'tree') {
      if (!trunk) fail('a tree has no trunk geometry, so its canopy stands on nothing');
      else ok(`tree canopy starts at ${b.min.y.toFixed(2)} and has a trunk under it`);
    } else if (b.min.y > 0.02) {
      fail(`${form} foliage starts ${(b.min.y * 1000).toFixed(0)} mm ABOVE the soil — it floats over its own pot`);
    } else ok(`${form} foliage meets the soil (starts at ${(b.min.y * 1000).toFixed(0)} mm)`);
  }

  // 12.2 the same recipe, built twice. Both builds read the same cached stem
  // geometry; only `potD` differs, which no stem depends on. If either build
  // mutates the cache instead of a clone, the second comes out different —
  // which is exactly the failure 12.1 describes, caught at its source.
  for (const form of PLANT_FORMS) {
    const a = plantFoliage(form, 1, { potD: 0.18 }).foliage;
    const c = plantFoliage(form, 1, { potD: 0.30 }).foliage;
    a.computeBoundingBox(); c.computeBoundingBox();
    const drift = Math.max(
      Math.abs(a.boundingBox!.min.y - c.boundingBox!.min.y),
      Math.abs(a.boundingBox!.max.y - c.boundingBox!.max.y),
    );
    // `trailing` and `succulent` genuinely place leaves off the pot's rim
    const potBound = form === 'trailing' || form === 'succulent';
    if (!potBound && drift > 0.005) fail(`${form} built twice differs by ${(drift * 1000).toFixed(0)} mm in height — a shared cached geometry is being transformed in place`);
    else ok(`${form} builds identically twice over${potBound ? ' (pot-relative parts aside)' : ''}`);
  }

  // 12.3 `plantCanopyRadius` is what the bathroom layout shrinks a plant
  // against, so it has to keep agreeing with the geometry it describes.
  for (const form of PLANT_FORMS) {
    const { foliage } = plantFoliage(form, 1, { potD: 0.18 });
    foliage.computeBoundingBox();
    const b = foliage.boundingBox!;
    const measured = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
    const stated = plantCanopyRadius(form, 1);
    if (Math.abs(measured - stated) > Math.max(0.03, stated * 0.15)) {
      fail(`${form}: plantCanopyRadius says ${stated.toFixed(2)} but the canopy measures ${measured.toFixed(2)} — the table has drifted from the recipe`);
    } else ok(`${form} canopy ${measured.toFixed(2)} m/unit matches the stated ${stated.toFixed(2)}`);
  }

  // 12.4 the weave cap has to be REACHABLE. `tileCourses` clamps `weaveCap`,
  // and the clamp's ceiling used to be 4000 — an accent wall asking for more
  // silently fell back to the 720 default and drew straight courses instead of
  // the herringbone the client picked out.
  const wall = { w: 3.35, h: 2.7, module: inch(4) };
  const tight = tileCourses(wall.w, wall.h, wall.module, { max: 44, pattern: 'herringbone', moduleW: wall.module, joint: 0.003, weaveCap: 720 });
  const roomy = tileCourses(wall.w, wall.h, wall.module, { max: 44, pattern: 'herringbone', moduleW: wall.module, joint: 0.003, weaveCap: 1600 });
  if (roomy.transforms.length <= tight.transforms.length) {
    fail(`an 11 ft wall in 4" herringbone draws ${roomy.transforms.length} bars at cap 1600 and ${tight.transforms.length} at cap 720 — raising the cap changed nothing`);
  } else ok(`4" herringbone on an 11 ft wall weaves at cap 1600 (${roomy.transforms.length} bars) where cap 720 fell back (${tight.transforms.length})`);
  const big = tileCourses(4.27, 2.7, inch(2), { max: 44, pattern: 'herringbone', moduleW: inch(2), joint: 0.003, weaveCap: 6000 });
  if (big.transforms.length < 4000) fail(`a 14 ft accent wall in 2" herringbone drew only ${big.transforms.length} bars at cap 6000 — the cap is being clamped away`);
  else ok(`a 14 ft accent wall in 2" herringbone weaves ${big.transforms.length} bars at cap 6000 (${(big.transforms.length * 60 / 1000).toFixed(0)} k triangles of the 1.2 M budget)`);

  // 12.5 the floor-mount tub filler's gooseneck has to CARRY, or the spout
  // pours beside the tub instead of into it.
  for (const reach of [0.14, 0.30]) {
    const g = floorTubFiller(1.06, reach);
    g.computeBoundingBox();
    const carried = g.boundingBox!.max.z;
    if (Math.abs(carried - reach) > 0.02) fail(`floorTubFiller(1.06, ${reach}) carries its spout ${carried.toFixed(3)} m, not ${reach}`);
    else ok(`floorTubFiller carries its spout ${carried.toFixed(2)} m for a ${reach} m reach`);
  }
}

// ---------------------------------------------------------------------------
console.log(failures === 0 ? '\nAll detail-layer checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
