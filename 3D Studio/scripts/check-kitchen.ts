/**
 * MANHATTAN — headless verification for the KITCHEN twin.
 *
 *   npx tsx scripts/check-kitchen.ts
 *
 * 1. LAYOUT STABILITY (user issue #4 — "when adjusting the height and widths of
 *    things such as the island, everything moves"). Every Layout-tab control is
 *    swept across its full slider range and the solver's output is diffed
 *    against the previous step. A control may only change the things it names:
 *    an island length slider may resize the island, and nothing else in the
 *    room is allowed to twitch — including the island's own anchor point.
 *    The same rule covers DÉCOR: a shelf slider may move that shelf (and the
 *    plant standing on it), and nothing else — not the island, not the runs,
 *    not the other shelves.
 * 2. GEOMETRY BUDGET. Builds the kitchen's geometry for a battery of specs and
 *    reports draw calls and triangles against the hard budget (900 / 1.2M).
 * 3. ROBUSTNESS. Absurd / missing / NaN specs must not throw and must produce a
 *    finite, buildable layout.
 * 4–5. PART INTEGRITY and PLACEMENT of everything the builders emit.
 * 6. DÉCOR CONTAINMENT: no plant inside a cabinet, no shelf through a window,
 *    no rug under the island, nothing outside the room.
 * 7. BACKSPLASH: per-run off, full height with and without wall cabinets,
 *    under and over a window, and a shelf sitting proud of the tile.
 * 8. CLIENT FIXTURES: real analyzer output (scripts/fixtures). Every part key
 *    unique (React drops a duplicate), cabinets keep their declared widths
 *    instead of being refit into slivers, and tall units on their own slot.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import type { KitchenSpec, RoomSpec } from '../src/lib/spec/types';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { kitchenDaylightWindows } from '../src/components/scene/kitchen/daylight';
import { computeKitchenLayout, hoodExtents, islandTopFt, pendantDrop, pendantPositions, stoolPositions, DOOR_T as DOOR_T_K, REVEAL as REVEAL_K, TIER_RAIL_H, type KitchenLayoutData } from '../src/components/scene/kitchen/layout';
import { wallFrame } from '../src/components/scene/geometry';
import { buildKitchenParts, buildKitchenPartsRaw, kitchenGeometryBudget } from '../src/components/scene/kitchen/budget';
import { kitchenElementBoxes } from '../src/lib/fit/boxes';
import { implausibility, kitchenParams } from '../src/lib/fit/params';
import { ITEM_PROPORTIONS } from '../src/components/scene/kitchen/items';
import { deriveUppers2, resolveUppers2HeightIn } from '../src/lib/spec/uppers';
import { hoodCabinetBandIn, hoodCabinetNet, resolveCabinetAbove, rowHeightIn, runForHood } from '../src/lib/spec/hood';
import { followRunLengths, reconcileSpec, setRunLength } from '../src/lib/ai/reconcile';

/** merge touching spans — the check's own copy, so it cannot drift with the layout's */
function mergeSpansLocal(spans: Array<[number, number]>): Array<[number, number]> {
  const sorted = spans.filter(([a, b]) => b - a > 1e-4).sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + 0.004) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

// ---------------------------------------------------------------------------
// Snapshot: every number a user could see move, tagged by what it belongs to
// ---------------------------------------------------------------------------
type Snap = Record<string, number>;

function snapshot(L: KitchenLayoutData): Snap {
  const s: Snap = {};
  s['room.w'] = L.w; s['room.d'] = L.d; s['room.h'] = L.h;
  s['cab.carcassTop'] = L.carcassTop;
  s['cab.counterTopY'] = L.counterTopY;
  s['cab.upperBottom'] = L.upperBottom;
  s['cab.toeKick'] = L.toeKick;
  s['cab.baseDepth'] = L.baseDepth;
  for (const r of L.runs) {
    s[`run.${r.id}.x0`] = r.x0;
    s[`run.${r.id}.x1`] = r.x1;
    s[`run.${r.id}.ux0`] = r.ux0;
    s[`run.${r.id}.ux1`] = r.ux1;
    s[`run.${r.id}.upperTop`] = r.upperTop;
    s[`run.${r.id}.tallTop`] = r.tallTop;
    r.base.forEach((b, i) => { s[`base.${r.id}.${i}.cx`] = b.cx; s[`base.${r.id}.${i}.w`] = b.width; });
    // `bottom` is the cabinet's own underside: the row's for an ordinary one,
    // the canopy's for the box that sits on the hood
    r.uppers.forEach((u, i) => {
      s[`upper.${r.id}.${i}.cx`] = u.cx; s[`upper.${r.id}.${i}.w`] = u.width;
      s[`upper.${r.id}.${i}.bottom`] = u.bottom;
      s[`upper.${r.id}.${i}.contents`] = CONTENT_KEYS.indexOf(u.contents ?? 'none');
    });
    r.tall.forEach((t, i) => { s[`tall.${r.id}.${i}.cx`] = t.cx; s[`tall.${r.id}.${i}.w`] = t.width; s[`tall.${r.id}.${i}.top`] = t.top; });
    r.counters.forEach((c, i) => { s[`counter.${r.id}.${i}.a`] = c[0]; s[`counter.${r.id}.${i}.b`] = c[1]; });
    r.splash.forEach((sp, i) => { s[`splash.${r.id}.${i}.a`] = sp.x0; s[`splash.${r.id}.${i}.b`] = sp.x1; s[`splash.${r.id}.${i}.top`] = sp.top; });
  }
  for (const a of L.appliances) {
    s[`app.${a.id}.x`] = a.x; s[`app.${a.id}.w`] = a.width; s[`app.${a.id}.y`] = a.y; s[`app.${a.id}.h`] = a.height; s[`app.${a.id}.top`] = a.top;
  }
  if (L.island) {
    s['island.cx'] = L.island.cx; s['island.cz'] = L.island.cz;
    // the DECLARED centre — `cx`/`cz` slide along the long axis when a declared
    // length outgrows the anchor's shorter side, so the sticky assertions below
    // watch the anchor, and the length sweeps allow the drawn centre to follow
    s['island.anchorX'] = L.island.anchorX; s['island.anchorZ'] = L.island.anchorZ;
    s['island.len'] = L.island.len; s['island.wide'] = L.island.wide;
    s['island.seatSide'] = L.island.seatSide; s['island.seating'] = L.island.seating;
    s['island.yaw'] = L.island.yaw; s['island.endSeats'] = L.island.endSeats; s['island.endSide'] = L.island.endSide;
    s['island.stoolPitch'] = L.island.stoolPitch;
    // island-local, so an island that moves as a whole does not drag these keys with it
    stoolPositions(L.island).forEach(([x, z], i) => { s[`stool.${i}.x`] = x; s[`stool.${i}.z`] = z; });
  }
  if (L.sink) { s['sink.x'] = L.sink.x; s['sink.z'] = L.sink.z; s['sink.w'] = L.sink.width; }
  s['light.recessed'] = L.lighting.recessed;
  s['light.pendants'] = L.lighting.pendants?.count ?? 0;
  s['light.pendantDrop'] = pendantDrop(L);
  pendantPositions(L).forEach((p, i) => { s[`light.pendant.${i}.x`] = p[0]; s[`light.pendant.${i}.z`] = p[2]; });
  const D = L.decor;
  D.shelves.forEach((sh, i) => {
    s[`decor.shelf.${i}.x`] = sh.x; s[`decor.shelf.${i}.w`] = sh.width; s[`decor.shelf.${i}.depth`] = sh.depth;
    s[`decor.shelf.${i}.bottom`] = sh.boards[0]; s[`decor.shelf.${i}.count`] = sh.boards.length; s[`decor.shelf.${i}.standoff`] = sh.standoff;
  });
  D.plants.forEach((p, i) => {
    s[`decor.plant.${i}.x`] = p.x; s[`decor.plant.${i}.y`] = p.y; s[`decor.plant.${i}.z`] = p.z; s[`decor.plant.${i}.h`] = p.height;
    s[`decor.plant.${i}.frame`] = FRAMES.indexOf(p.frame);
  });
  D.items.forEach((it, i) => {
    s[`decor.item.${i}.x`] = it.x; s[`decor.item.${i}.y`] = it.y; s[`decor.item.${i}.z`] = it.z;
    s[`decor.item.${i}.w`] = it.w; s[`decor.item.${i}.h`] = it.h;
    s[`decor.item.${i}.frame`] = FRAMES.indexOf(it.frame);
    s[`decor.item.${i}.on`] = ITEM_HOSTS.indexOf(it.on);
  });
  D.art.forEach((a, i) => { s[`decor.art.${i}.x`] = a.x; s[`decor.art.${i}.y`] = a.y; s[`decor.art.${i}.w`] = a.width; s[`decor.art.${i}.h`] = a.height; });
  if (D.rug) { s['decor.rug.cx'] = D.rug.cx; s['decor.rug.cz'] = D.rug.cz; s['decor.rug.len'] = D.rug.len; s['decor.rug.wide'] = D.rug.wide; s['decor.rug.yaw'] = D.rug.yaw; }
  D.treatments.forEach((t, i) => { s[`decor.wt.${i}.x`] = t.x; s[`decor.wt.${i}.head`] = t.head; s[`decor.wt.${i}.w`] = t.width; s[`decor.wt.${i}.kind`] = TREATMENTS.indexOf(t.kind); });
  s['decor.styling'] = ['none', 'minimal', 'lived-in'].indexOf(D.counterStyling);
  return s;
}
const FRAMES = ['world', 'island', 'back', 'left', 'right', 'front'];
const ITEM_KINDS_ALL = Object.keys(ITEM_PROPORTIONS) as Array<NonNullable<KitchenSpec['decor']['items']>[number]['kind']>;
const CONTENT_KEYS = ['none', 'plates', 'bowls', 'glasses', 'mugs', 'jars', 'cookbooks', 'bottles', 'mixed', 'empty'];
const ITEM_HOSTS = ['counter', 'range', 'island', 'shelf', 'sill', 'floor'];
const TREATMENTS = ['none', 'roman-shade', 'roller', 'curtains', 'blinds', 'cafe-curtain'];

/** Keys that changed by more than `tol` between two snapshots. */
function diffKeys(a: Snap, b: Snap, tol = 1e-6): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    const va = a[k], vb = b[k];
    if (va === undefined || vb === undefined) { out.push(k); continue; }
    if (Math.abs(va - vb) > tol) out.push(k);
  }
  return out.sort();
}

/**
 * Sweep one control and assert that every key that changed is covered by
 * `allowed` (prefix match). `anchors` must NEVER move.
 */
function sweep(
  name: string,
  values: number[] | string[] | boolean[],
  build: (v: never) => KitchenSpec,
  allowed: string[],
  anchors: string[] = [],
) {
  let prev: Snap | null = null;
  let prevV: unknown = null;
  const bad = new Map<string, string>();
  const moved = new Map<string, string>();
  for (const v of values) {
    let L: KitchenLayoutData;
    try { L = computeKitchenLayout(build(v as never)); }
    catch (e) { fail(`${name}: threw at ${String(v)} — ${(e as Error).message}`); return; }
    const snap = snapshot(L);
    for (const [k, val] of Object.entries(snap)) {
      if (!Number.isFinite(val)) { fail(`${name}: non-finite ${k} at ${String(v)}`); return; }
    }
    if (prev) {
      for (const k of diffKeys(prev, snap, 5e-4)) {
        if (anchors.some((p) => k === p || k.startsWith(p))) {
          if (!moved.has(k)) moved.set(k, `${String(prevV)}→${String(v)}: ${prev[k]?.toFixed(4)} → ${snap[k]?.toFixed(4)}`);
        } else if (!allowed.some((p) => k === p || k.startsWith(p))) {
          if (!bad.has(k)) bad.set(k, `${String(prevV)}→${String(v)}: ${prev[k]?.toFixed(4)} → ${snap[k]?.toFixed(4)}`);
        }
      }
    }
    prev = snap; prevV = v;
  }
  if (moved.size) {
    fail(`${name}: ANCHOR MOVED — ${[...moved].slice(0, 6).map(([k, d]) => `${k} (${d})`).join(', ')}`);
  }
  if (bad.size) {
    fail(`${name}: unrelated geometry moved — ${[...bad].slice(0, 8).map(([k, d]) => `${k} (${d})`).join(', ')}${bad.size > 8 ? ` …+${bad.size - 8}` : ''}`);
  }
  if (!moved.size && !bad.size) ok(`${name}: ${values.length} steps, only the named geometry changed`);
}

// ---------------------------------------------------------------------------
// 1. Layout stability
// ---------------------------------------------------------------------------
console.log('\n1. LAYOUT STABILITY — one slider may move one thing');

const base = defaultKitchen();
const range = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};
// mirror LayoutPanel's own rescale of run lengths when the room changes
const withDims = (p: Partial<KitchenSpec['dims']>): KitchenSpec => {
  const dims = { ...base.dims, ...p };
  const runs = base.runs.map((r) => {
    const wallLen = r.wall === 'back' || r.wall === 'front' ? dims.widthFt : dims.depthFt;
    return { ...r, lengthFt: Math.min(r.lengthFt, wallLen) };
  });
  return { ...base, dims, runs };
};

// A rug in front of a run and a plant on the floor are fitted AROUND the island,
// so they may follow it; everything on the walls must not.
// (the pendants hang over the island and the stools sit at it, so an island
// resize may re-spread those too — never the anchor, never the seating side)
const ISLAND_ALLOWED = ['decor.rug', 'decor.plant', 'decor.item', 'light.pendant.', 'stool.', 'island.stoolPitch'];

// the end stools follow the clear floor beyond the top, so a length or width
// slider may add or take them away — never the anchor or the seating side
sweep('island length 4→12ft', range(4, 12, 0.5),
  (v: number) => ({ ...base, island: { ...base.island, present: true, lengthFt: v } }),
  ['island.len', 'island.seating', 'island.endSeats', 'island.cx', 'island.cz', ...ISLAND_ALLOWED],
  ['island.anchorX', 'island.anchorZ', 'island.seatSide', 'island.yaw', 'island.endSide', 'decor.shelf', 'decor.art', 'decor.wt']);

sweep('island width 2→5ft', range(2, 5, 0.25),
  (v: number) => ({ ...base, island: { ...base.island, present: true, widthFt: v } }),
  ['island.wide', 'island.endSeats', ...ISLAND_ALLOWED],
  ['island.cx', 'island.cz', 'island.anchorX', 'island.anchorZ', 'island.seatSide', 'island.yaw', 'island.len', 'island.endSide', 'decor.shelf', 'decor.art', 'decor.wt']);

sweep('island seating 0→6', range(0, 6, 1),
  (v: number) => ({
    ...base,
    island: { ...base.island, present: true, seating: v, overhangIn: v > 0 ? Math.max(base.island.overhangIn, 12) : base.island.overhangIn },
  }),
  ['island.seating', 'island.endSeats', 'island.wide', ...ISLAND_ALLOWED],
  ['island.cx', 'island.cz', 'island.anchorX', 'island.anchorZ', 'island.seatSide', 'island.len', 'island.endSide', 'decor.shelf', 'decor.art', 'decor.wt']);

sweep('ceiling height 7.5→14ft', range(7.5, 14, 0.25),
  (v: number) => withDims({ ceilingFt: v }),
  ['room.h', 'run.', 'app.', 'upper.', 'tall.', 'splash.', 'decor.', 'light.pendantDrop'],
  ['island.cx', 'island.cz', 'island.len', 'island.wide', 'base.', 'counter.', 'sink.', 'cab.', 'light.pendant.', 'stool.']);

sweep('room width 8→30ft', range(8, 30, 0.5),
  (v: number) => withDims({ widthFt: v }),
  ['room.w', 'run.', 'base.', 'upper.', 'tall.', 'counter.', 'splash.', 'app.', 'sink.', 'island.', 'decor.', 'light.pendant.', 'stool.'],
  ['cab.carcassTop', 'cab.counterTopY', 'cab.upperBottom', 'cab.toeKick', 'room.h', 'room.d', 'light.pendantDrop']);

sweep('room depth 8→30ft', range(8, 30, 0.5),
  (v: number) => withDims({ depthFt: v }),
  ['room.d', 'run.', 'base.', 'upper.', 'tall.', 'counter.', 'splash.', 'app.', 'sink.', 'island.', 'decor.', 'light.pendant.', 'stool.'],
  ['cab.carcassTop', 'cab.counterTopY', 'cab.upperBottom', 'cab.toeKick', 'room.h', 'room.w', 'light.pendantDrop']);

// a 'glass' door style makes every wall cabinet a display case, so what shows
// behind the glass is the one thing this control may change
sweep('door style', ['shaker', 'flat', 'raised', 'slab', 'beaded', 'glass', 'open'],
  (v: KitchenSpec['cabinets']['doorStyle']) => ({ ...base, cabinets: { ...base.cabinets, doorStyle: v } }),
  ['upper.run-back.0.contents', 'upper.run-back.1.contents', 'upper.run-left.0.contents', 'upper.run-left.2.contents', 'upper.run-left.3.contents'],
  ['island.', 'base.', 'upper.run-back.0.cx', 'upper.run-back.0.w', 'upper.run-back.0.bottom', 'tall.', 'counter.', 'app.', 'sink.', 'run.', 'cab.', 'decor.']);

// the wall-cabinet band grows: a shelf or a picture beside it may step aside
sweep('uppers to ceiling', [false, true],
  (v: boolean) => ({ ...base, runs: base.runs.map((r) => ({ ...r, uppersToCeiling: v })) }),
  ['run.', 'tall.', 'decor.shelf', 'decor.art'],
  ['island.', 'base.', 'counter.', 'app.', 'sink.', 'upper.', 'cab.', 'splash.', 'decor.plant', 'decor.rug', 'decor.wt']);

sweep('crown moulding', [false, true],
  (v: boolean) => ({ ...base, cabinets: { ...base.cabinets, crown: v } }),
  ['run.', 'tall.', 'decor.shelf', 'decor.art'],
  ['island.', 'base.', 'counter.', 'app.', 'sink.', 'upper.', 'cab.', 'splash.', 'decor.plant', 'decor.rug', 'decor.wt']);

// a shelf on a tiled wall sits proud of the tile, so its standoff follows the splash
sweep('backsplash height', ['ledge', 'standard', 'full-height'],
  (v: KitchenSpec['backsplash']['height']) => ({ ...base, backsplash: { ...base.backsplash, height: v } }),
  ['splash.', 'decor.shelf'],
  ['island.', 'base.', 'upper.', 'tall.', 'counter.', 'app.', 'sink.', 'run.', 'cab.', 'decor.plant', 'decor.art', 'decor.rug', 'decor.wt']);

sweep('pendant count 0→6', range(0, 6, 1),
  (v: number) => ({
    ...base,
    lighting: { ...base.lighting, pendants: v === 0 ? null : { count: v, style: 'globe' as const, finish: 'brass' as const, spreadFt: 0, offsetFt: 0, aboveCounterIn: 0 } },
  }),
  ['light.pendant'],
  ['island.', 'base.', 'upper.', 'tall.', 'counter.', 'app.', 'sink.', 'run.', 'cab.', 'decor.', 'stool.', 'light.pendantDrop']);

sweep('recessed cans 0→16', range(0, 16, 1),
  (v: number) => ({ ...base, lighting: { ...base.lighting, recessedCount: v } }),
  ['light.recessed'],
  ['island.', 'base.', 'upper.', 'tall.', 'counter.', 'app.', 'sink.', 'run.', 'cab.', 'decor.']);

// the island must also hold still when it is rotated or made a peninsula
for (const kind of ['island', 'peninsula', 'breakfast-bar'] as const) {
  for (const rotationDeg of [0, 90] as const) {
    sweep(`${kind} @${rotationDeg}° length sweep`, range(4, 12, 0.5),
      (v: number) => ({ ...base, island: { ...base.island, present: true, kind, rotationDeg, lengthFt: v } }),
      ['island.len', 'island.seating', 'island.endSeats', 'island.cx', 'island.cz', ...ISLAND_ALLOWED],
      ['island.anchorX', 'island.anchorZ', 'island.seatSide', 'island.yaw', 'island.endSide', 'decor.shelf', 'decor.art', 'decor.wt']);
  }
}

// ---------------------------------------------------------------------------
// 1b. Décor stability — one décor control may move one décor piece
// ---------------------------------------------------------------------------
console.log('\n1b. DÉCOR STABILITY — a shelf slider moves that shelf and nothing else');

/**
 * The demo décor, spread out so no two pieces share a wall stretch: the shelf
 * on the free end of the left wall, the art on the right wall beside the
 * doorway, one plant of every kind. Each sweep below moves ONE of them.
 */
const decorBase: KitchenSpec = {
  ...base,
  decor: {
    items: [],
    cabinetContents: [],
    shelves: [{ wall: 'left', t: 0.85, widthIn: 36, count: 2, bottomFt: 4.6, depthIn: 10, spacingIn: 14, material: 'wood', styled: 'mixed' }],
    plants: [
      { kind: 'floor', wall: 'front', t: 0.3, sizeFt: 5.5, form: 'tree' },
      { kind: 'counter', wall: 'back', t: 0.2, sizeFt: 1.1, form: 'herb' },
      { kind: 'hanging', wall: 'back', t: 0.33, sizeFt: 2, form: 'trailing' },
      { kind: 'shelf', wall: 'left', t: 0.85, sizeFt: 0.8, form: 'succulent' },
    ],
    art: [{ wall: 'right', t: 0.35, widthIn: 24, heightIn: 30, centerFt: 5.2, frame: 'black' }],
    rug: { present: true, lengthFt: 7, widthFt: 2.5, style: 'runner' },
    windowTreatment: 'roman-shade',
    counterStyling: 'lived-in', stools: null,
  },
};
const EVERYTHING_ELSE = ['island.', 'base.', 'upper.', 'tall.', 'counter.', 'splash.', 'app.', 'sink.', 'run.', 'cab.', 'room.', 'light.', 'stool.'];
const decorAnchors = (...moving: string[]) => [
  ...EVERYTHING_ELSE,
  ...['decor.shelf.0', 'decor.plant.0', 'decor.plant.1', 'decor.plant.2', 'decor.plant.3', 'decor.art.0', 'decor.rug', 'decor.wt', 'decor.styling'].filter((k) => !moving.some((m) => k.startsWith(m) || m.startsWith(k))),
];
const withShelf = (p: Partial<KitchenSpec['decor']['shelves'][number]>): KitchenSpec => ({ ...decorBase, decor: { ...decorBase.decor, shelves: [{ ...decorBase.decor.shelves[0], ...p }] } });
const withPlant = (i: number, p: Partial<KitchenSpec['decor']['plants'][number]>): KitchenSpec => ({ ...decorBase, decor: { ...decorBase.decor, plants: decorBase.decor.plants.map((q, j) => (j === i ? { ...q, ...p } : q)) } });
const withArt = (p: Partial<KitchenSpec['decor']['art'][number]>): KitchenSpec => ({ ...decorBase, decor: { ...decorBase.decor, art: [{ ...decorBase.decor.art[0], ...p }] } });
const withRug = (p: Partial<NonNullable<KitchenSpec['decor']['rug']>>): KitchenSpec => ({ ...decorBase, decor: { ...decorBase.decor, rug: { ...decorBase.decor.rug!, ...p } } });

// the shelf: the succulent standing on it is the one thing allowed to follow
const SHELF_MOVES = ['decor.shelf.0', 'decor.plant.3'];
sweep('shelf position 5→95%', range(0.05, 0.95, 0.05), (v: number) => withShelf({ t: v }), SHELF_MOVES, decorAnchors(...SHELF_MOVES));
sweep('shelf width 12→96"', range(12, 96, 6), (v: number) => withShelf({ widthIn: v }), SHELF_MOVES, decorAnchors(...SHELF_MOVES));
sweep('shelf boards 1→5', range(1, 5, 1), (v: number) => withShelf({ count: v }), SHELF_MOVES, decorAnchors(...SHELF_MOVES));
sweep('shelf lowest board 2→9ft', range(2, 9, 0.25), (v: number) => withShelf({ bottomFt: v }), SHELF_MOVES, decorAnchors(...SHELF_MOVES));
sweep('shelf spacing 8→24"', range(8, 24, 2), (v: number) => withShelf({ spacingIn: v }), SHELF_MOVES, decorAnchors(...SHELF_MOVES));
sweep('shelf depth 6→16"', range(6, 16, 1), (v: number) => withShelf({ depthIn: v }), SHELF_MOVES, decorAnchors(...SHELF_MOVES));
sweep('shelf material', ['match-cabinets', 'wood', 'white', 'black', 'match-countertop'], (v: KitchenSpec['decor']['shelves'][number]['material']) => withShelf({ material: v }), SHELF_MOVES, decorAnchors(...SHELF_MOVES));
sweep('shelf styling', ['empty', 'dishes', 'books', 'plants', 'mixed'], (v: KitchenSpec['decor']['shelves'][number]['styled']) => withShelf({ styled: v }), SHELF_MOVES, decorAnchors(...SHELF_MOVES));
// moving the shelf onto the art's wall: the art steps aside (the one named dependency, see buildDecor)
sweep('shelf wall', ['back', 'left', 'right', 'front'], (v: KitchenSpec['decor']['shelves'][number]['wall']) => withShelf({ wall: v }), [...SHELF_MOVES, 'decor.art.0'], decorAnchors(...SHELF_MOVES, 'decor.art.0'));

sweep('floor plant position 5→95%', range(0.05, 0.95, 0.05), (v: number) => withPlant(0, { t: v }), ['decor.plant.0'], decorAnchors('decor.plant.0'));
sweep('floor plant size 1→9ft', range(1, 9, 0.5), (v: number) => withPlant(0, { sizeFt: v }), ['decor.plant.0'], decorAnchors('decor.plant.0'));
sweep('floor plant corner', range(0, 1, 0.25), (v: number) => withPlant(0, { wall: 'corner', t: v }), ['decor.plant.0'], decorAnchors('decor.plant.0'));
sweep('floor plant form', ['leafy', 'tree', 'trailing', 'herb', 'succulent'], (v: KitchenSpec['decor']['plants'][number]['form']) => withPlant(0, { form: v }), ['decor.plant.0'], decorAnchors('decor.plant.0'));
sweep('counter plant position 5→95%', range(0.05, 0.95, 0.05), (v: number) => withPlant(1, { t: v }), ['decor.plant.1'], decorAnchors('decor.plant.1'));
sweep('counter plant size 0.3→3ft', range(0.3, 3, 0.3), (v: number) => withPlant(1, { sizeFt: v }), ['decor.plant.1'], decorAnchors('decor.plant.1'));
sweep('hanging plant position 5→95%', range(0.05, 0.95, 0.05), (v: number) => withPlant(2, { t: v }), ['decor.plant.2'], decorAnchors('decor.plant.2'));
sweep('hanging plant size 0.5→6ft', range(0.5, 6, 0.5), (v: number) => withPlant(2, { sizeFt: v }), ['decor.plant.2'], decorAnchors('decor.plant.2'));
sweep('shelf plant position 5→95%', range(0.05, 0.95, 0.05), (v: number) => withPlant(3, { t: v }), ['decor.plant.3'], decorAnchors('decor.plant.3'));
sweep('plant kind', ['floor', 'counter', 'shelf', 'hanging'], (v: KitchenSpec['decor']['plants'][number]['kind']) => withPlant(1, { kind: v, wall: 'left', t: 0.85 }), ['decor.plant.1'], decorAnchors('decor.plant.1'));

sweep('art position 5→95%', range(0.05, 0.95, 0.05), (v: number) => withArt({ t: v }), ['decor.art.0'], decorAnchors('decor.art.0'));
sweep('art width 6→96"', range(6, 96, 6), (v: number) => withArt({ widthIn: v }), ['decor.art.0'], decorAnchors('decor.art.0'));
sweep('art height 6→96"', range(6, 96, 6), (v: number) => withArt({ heightIn: v }), ['decor.art.0'], decorAnchors('decor.art.0'));
sweep('art centre 2→9ft', range(2, 9, 0.25), (v: number) => withArt({ centerFt: v }), ['decor.art.0'], decorAnchors('decor.art.0'));
sweep('art frame', ['black', 'wood', 'white', 'none'], (v: KitchenSpec['decor']['art'][number]['frame']) => withArt({ frame: v }), ['decor.art.0'], decorAnchors('decor.art.0'));
sweep('art wall', ['back', 'left', 'right', 'front'], (v: KitchenSpec['decor']['art'][number]['wall']) => withArt({ wall: v }), ['decor.art.0'], decorAnchors('decor.art.0'));

sweep('rug length 2→14ft', range(2, 14, 0.5), (v: number) => withRug({ lengthFt: v }), ['decor.rug'], decorAnchors('decor.rug'));
sweep('rug width 1.5→10ft', range(1.5, 10, 0.5), (v: number) => withRug({ widthFt: v }), ['decor.rug'], decorAnchors('decor.rug'));
sweep('rug style', ['runner', 'area', 'round'], (v: NonNullable<KitchenSpec['decor']['rug']>['style']) => withRug({ style: v }), ['decor.rug'], decorAnchors('decor.rug'));
sweep('rug on/off', [true, false, true], (v: boolean) => withRug({ present: v }), ['decor.rug'], decorAnchors('decor.rug'));

sweep('window treatment', ['none', 'roman-shade', 'roller', 'curtains', 'blinds', 'cafe-curtain'],
  (v: KitchenSpec['decor']['windowTreatment']) => ({ ...decorBase, decor: { ...decorBase.decor, windowTreatment: v } }), ['decor.wt'], decorAnchors('decor.wt'));
sweep('counter styling', ['none', 'minimal', 'lived-in'],
  (v: KitchenSpec['decor']['counterStyling']) => ({ ...decorBase, decor: { ...decorBase.decor, counterStyling: v } }), ['decor.styling'], decorAnchors('decor.styling'));

// adding a shelf on another wall must not disturb the first one
sweep('shelf count 1→3', range(1, 3, 1), (v: number) => ({
  ...decorBase,
  decor: {
    ...decorBase.decor,
    shelves: [
      decorBase.decor.shelves[0],
      { wall: 'front' as const, t: 0.3, widthIn: 30, count: 2, bottomFt: 4.5, depthIn: 10, spacingIn: 12, material: 'white' as const, styled: 'books' as const },
      { wall: 'back' as const, t: 0.2, widthIn: 30, count: 1, bottomFt: 4.5, depthIn: 10, spacingIn: 12, material: 'match-cabinets' as const, styled: 'dishes' as const },
    ].slice(0, v),
  },
}), ['decor.shelf.1', 'decor.shelf.2'], decorAnchors('decor.shelf.1', 'decor.shelf.2'));

// the demo kitchen declares its art over its shelf on purpose: the art steps
// aside (deterministically), the shelf stays where the photo had it
{
  const L = computeKitchenLayout(base);
  const sh = L.decor.shelves[0], ar = L.decor.art[0];
  if (!sh || !ar) fail('demo décor: shelf or art missing');
  else if (Math.abs(sh.x - (base.decor.shelves[0].t - 0.5) * L.d) > 0.02) fail(`demo décor: the shelf moved (${sh.x.toFixed(3)})`);
  else if (sh.wall === ar.wall && Math.abs(ar.x - sh.x) < (ar.width + sh.width) / 2 && ar.y + ar.height / 2 > sh.boards[0] - 0.05 && ar.y - ar.height / 2 < sh.boards[sh.boards.length - 1] + 0.3) fail('demo décor: the art is hung behind the shelf');
  else ok(`demo décor: shelf held at t=${base.decor.shelves[0].t}, art stepped aside to x=${ar.x.toFixed(2)} (${L.decor.warnings.length} warning${L.decor.warnings.length === 1 ? '' : 's'} reported)`);
}

// ---------------------------------------------------------------------------
// 1c. Photo-fit controls — the fields the fitter moves to land on the photo:
//     pendant spread / offset / height, a run's own upper height, stool pitch
//     and end seats, the hood's mouth and overall height, the fridge's height.
//     Each moves the one thing it names; each is clamped to what can be built.
// ---------------------------------------------------------------------------
console.log('\n1c. PHOTO-FIT CONTROLS — pendants, per-run uppers, stools, hood and fridge heights');

const IN = 0.0254;
const baseL = computeKitchenLayout(base);
const HOOD_ID = baseL.appliances.find((a) => a.kind === 'hood')!.id;
const FRIDGE_ID = baseL.appliances.find((a) => a.kind === 'fridge')!.id;
const OTHER_APPS = baseL.appliances.filter((a) => a.kind !== 'hood' && a.kind !== 'fridge').map((a) => `app.${a.id}`);

// --- pendants ---------------------------------------------------------------
const NOT_PENDANTS = ['island.', 'base.', 'upper.', 'tall.', 'counter.', 'splash.', 'app.', 'sink.', 'run.', 'cab.', 'room.', 'decor.', 'stool.', 'light.pendants', 'light.recessed'];
const withPendants = (p: Partial<NonNullable<KitchenSpec['lighting']['pendants']>>): KitchenSpec => ({ ...base, lighting: { ...base.lighting, pendants: { ...base.lighting.pendants!, ...p } } });
sweep('pendant spread 0(auto)→12ft', range(0, 12, 0.5), (v: number) => withPendants({ spreadFt: v }), ['light.pendant.'], [...NOT_PENDANTS, 'light.pendantDrop']);
sweep('pendant offset -4→4ft', range(-4, 4, 0.25), (v: number) => withPendants({ offsetFt: v }), ['light.pendant.'], [...NOT_PENDANTS, 'light.pendantDrop']);
sweep('pendant height 0(auto),18→48"', [0, ...range(18, 48, 2)], (v: number) => withPendants({ aboveCounterIn: v }), ['light.pendantDrop'], [...NOT_PENDANTS, 'light.pendant.']);

// the row stays over the island whatever the spec asks: the widest spread is
// held inside the top, the offset stops where the last shade would hang past
// the end, and 60" over the counter on an 8 ft ceiling still leaves a cord
{
  const bad: string[] = [];
  const half = baseL.island!.topLen / 2 - 0.15;
  for (const [spreadFt, offsetFt] of [[12, 0], [0, 4], [12, -4], [3, 4]] as const) {
    const L = computeKitchenLayout(withPendants({ spreadFt, offsetFt }));
    for (const p of pendantPositions(L)) {
      const x = p[0] - L.island!.cx;
      if (Math.abs(x) > half + 1e-6) bad.push(`spread ${spreadFt} ft, offset ${offsetFt} ft: a shade at ${x.toFixed(2)} m hangs past the top (±${half.toFixed(2)})`);
    }
  }
  const P = pendantPositions(computeKitchenLayout(withPendants({ spreadFt: 4, offsetFt: 0 })));
  if (Math.abs((P[1][0] - P[0][0]) - 4 * 0.3048) > 1e-6) bad.push(`4 ft spread drawn as ${(P[1][0] - P[0][0]).toFixed(3)} m`);
  const Q = pendantPositions(computeKitchenLayout(withPendants({ spreadFt: 4, offsetFt: 1 })));
  if (Math.abs((Q[0][0] - P[0][0]) - 0.3048) > 1e-6) bad.push(`1 ft offset moved the row ${(Q[0][0] - P[0][0]).toFixed(3)} m`);
  const low = computeKitchenLayout({ ...withPendants({ aboveCounterIn: 60 }), dims: { ...base.dims, ceilingFt: 8 } });
  if (pendantDrop(low) < 0.3 - 1e-9) bad.push(`60" over the counter on 8 ft left a ${pendantDrop(low).toFixed(2)} m cord`);
  const L32 = computeKitchenLayout(withPendants({ aboveCounterIn: 0 }));
  if (Math.abs((L32.h - pendantDrop(L32)) - (L32.counterTopY + 32 * IN)) > 1e-6) bad.push('auto height is not 32" over the counter');
  const L40 = computeKitchenLayout(withPendants({ aboveCounterIn: 40 }));
  if (Math.abs((L40.h - pendantDrop(L40)) - (L40.counterTopY + 40 * IN)) > 1e-6) bad.push('40" over the counter not honoured');
  // no island: the row goes over the sink and stays on its run
  const noIsl = computeKitchenLayout({ ...withPendants({ spreadFt: 12, offsetFt: 4 }), island: { ...base.island, present: false } });
  const run = noIsl.runs.find((r) => r.id === noIsl.sink!.runId)!;
  for (const p of pendantPositions(noIsl)) {
    // back wall: world x is wall-local x
    if (p[0] < run.x0 + 0.15 - 1e-6 || p[0] > run.x1 - 0.15 + 1e-6) bad.push(`no island: a shade at x=${p[0].toFixed(2)} is off the sink run (${run.x0.toFixed(2)}…${run.x1.toFixed(2)})`);
  }
  if (bad.length) fail(`pendant clamps: ${bad.join('; ')}`);
  else ok('pendant clamps: spread and offset held over the island top (and the sink run without one), 4 ft spread / 1 ft offset exact, height 32" auto, 40" honoured, 60" on 8 ft still leaves a cord');
}

// --- a run's own upper height --------------------------------------------
// The demo hood carries a cabinet, whose band IS the row's height — so these
// sweeps take it away and section 9 tests the cabinet on its own.
const bareHood = (s: KitchenSpec): KitchenSpec => ({ ...s, appliances: s.appliances.map((a) => (a.kind === 'hood' ? { ...a, cabinetAbove: 'none' as const } : a)) });
const withRunUppers = (id: string, upperHeightIn: number | null, extra: Partial<KitchenSpec> = {}): KitchenSpec => bareHood({ ...base, ...extra, runs: base.runs.map((r) => (r.id === id ? { ...r, upperHeightIn } : r)) });
// the fridge surround's top follows the uppers, and the fridge in it is capped by the opening
sweep('back-run upper height 12→60"', range(12, 60, 3), (v: number) => withRunUppers('run-back', v),
  ['run.run-back.upperTop', 'run.run-back.tallTop', 'tall.run-back', `app.${FRIDGE_ID}.h`, `app.${FRIDGE_ID}.top`, 'decor.shelf', 'decor.art'],
  ['run.run-left', 'upper.', 'base.', 'island.', 'counter.', 'splash.', 'sink.', 'cab.', 'room.', 'light.', 'stool.', `app.${HOOD_ID}`, ...OTHER_APPS, `app.${FRIDGE_ID}.x`, `app.${FRIDGE_ID}.y`, 'decor.plant', 'decor.rug', 'decor.wt']);
{
  const bad: string[] = [];
  const L = computeKitchenLayout(withRunUppers('run-back', 30));
  const back = L.runs.find((r) => r.id === 'run-back')!, left = L.runs.find((r) => r.id === 'run-left')!;
  if (Math.abs((back.upperTop - back.upperBottom) - 30 * IN) > 1e-6) bad.push(`30" on the back run drawn ${((back.upperTop - back.upperBottom) / IN).toFixed(1)}"`);
  if (Math.abs((left.upperTop - left.upperBottom) - base.cabinets.upperHeightIn * IN) > 1e-6) bad.push(`the left run left the room default (${((left.upperTop - left.upperBottom) / IN).toFixed(1)}" vs ${base.cabinets.upperHeightIn}")`);
  // 60" on an 8 ft ceiling with crown: under the crown, never through it
  const low = computeKitchenLayout(withRunUppers('run-back', 60, { dims: { ...base.dims, ceilingFt: 8 } }));
  const lb = low.runs.find((r) => r.id === 'run-back')!;
  if (lb.upperTop > low.h - low.crownH - 0.004 + 1e-6) bad.push(`60" on 8 ft: top at ${lb.upperTop.toFixed(3)} through the crown (${(low.h - low.crownH).toFixed(3)})`);
  if (lb.upperTop - lb.upperBottom < 12 * IN - 1e-6) bad.push('60" on 8 ft: clamped below 12"');
  if (lb.upperTop - lb.upperBottom > 60 * IN - 1e-6) bad.push('60" on 8 ft: not clamped at all');
  // uppers-to-ceiling still wins
  const toC = computeKitchenLayout({ ...base, runs: withRunUppers('run-back', 24).runs.map((r) => ({ ...r, uppersToCeiling: true })) });
  const tb = toC.runs.find((r) => r.id === 'run-back')!;
  if (Math.abs(tb.upperTop - (toC.h - toC.crownH - 0.004)) > 1e-6) bad.push('uppers-to-ceiling lost to a 24" per-run height');
  // null = the room's height
  const nul = computeKitchenLayout(withRunUppers('run-back', null));
  if (Math.abs(nul.runs[0].upperTop - baseL.runs[0].upperTop) > 1e-9) bad.push('null did not fall back to the room default');
  if (bad.length) fail(`per-run upper height: ${bad.join('; ')}`);
  else ok(`per-run upper height: 30" on one run only, 60" on 8 ft clamped to ${((lb.upperTop - lb.upperBottom) / IN).toFixed(0)}" under the crown, uppers-to-ceiling wins, null = room default`);
}

// --- stools ---------------------------------------------------------------
const withIsland = (p: Partial<KitchenSpec['island']>, extra: Partial<KitchenSpec> = {}): KitchenSpec => ({ ...base, ...extra, island: { ...base.island, present: true, ...p } });
const STOOLS_ONLY = ['island.stoolPitch', 'island.seating', 'island.endSeats', 'stool.'];
const NOT_STOOLS = ['island.cx', 'island.cz', 'island.len', 'island.wide', 'island.seatSide', 'island.yaw', 'island.endSide', 'base.', 'upper.', 'tall.', 'counter.', 'splash.', 'app.', 'sink.', 'run.', 'cab.', 'room.', 'light.', 'decor.'];
sweep('stool pitch 0(auto),16→40"', [0, ...range(16, 40, 2)], (v: number) => withIsland({ stoolPitchIn: v }), STOOLS_ONLY, NOT_STOOLS);
// a wide room whose island end is clear, so end seats can actually be honoured
const wideRoom: Partial<KitchenSpec> = { dims: { ...base.dims, widthFt: 22 } };
sweep('end seats 0→4', range(0, 4, 1), (v: number) => withIsland({ seating: 4, offset: { x: 0, z: 1.5 }, endSeats: v }, wideRoom), STOOLS_ONLY, NOT_STOOLS);
{
  const bad: string[] = [];
  const L24 = computeKitchenLayout(withIsland({ stoolPitchIn: 24 }));
  const sp = stoolPositions(L24.island!);
  if (sp.length < 2 || Math.abs((sp[1][0] - sp[0][0]) - 24 * IN) > 1e-6) bad.push(`24" pitch drawn ${sp.length > 1 ? ((sp[1][0] - sp[0][0]) / IN).toFixed(1) : '?'}"`);
  // too wide a pitch for the top: fewer stools, none past the end
  const isl40 = computeKitchenLayout(withIsland({ seating: 6, stoolPitchIn: 40 })).island!;
  for (const [x] of stoolPositions(isl40).slice(0, isl40.seating - isl40.endSeats)) if (Math.abs(x) > isl40.topLen / 2 - 0.15 + 1e-6) bad.push(`40" pitch put a stool at ${x.toFixed(2)} m, past the top (±${(isl40.topLen / 2).toFixed(2)})`);
  if (isl40.seating >= 6) bad.push(`6 stools at 40" on a ${(isl40.topLen / 0.3048).toFixed(1)} ft top`);
  // end seats: honoured when the end is clear, capped by the top's width, never in a tight room
  const clear = computeKitchenLayout(withIsland({ seating: 4, offset: { x: 0, z: 1.5 }, endSeats: 2 }, wideRoom)).island!;
  if (clear.endSeats !== 2) bad.push(`2 end seats in a clear 22 ft room → ${clear.endSeats}`);
  if (stoolPositions(clear).filter(([x]) => Math.abs(x) > clear.topLen / 2).length !== 2) bad.push('the two end stools are not past the end');
  const one = computeKitchenLayout(withIsland({ seating: 4, offset: { x: 0, z: 1.5 }, endSeats: 1 }, wideRoom)).island!;
  if (one.endSeats !== 1) bad.push(`1 end seat → ${one.endSeats}`);
  const none = computeKitchenLayout(withIsland({ seating: 4, offset: { x: 0, z: 1.5 }, endSeats: 0 }, wideRoom)).island!;
  if (none.endSeats !== 0) bad.push(`0 end seats → ${none.endSeats} (the photo said a row)`);
  const narrow = computeKitchenLayout(withIsland({ seating: 4, widthFt: 2, overhangIn: 6, offset: { x: 0, z: 1.5 }, endSeats: 2 }, wideRoom)).island!;
  if (narrow.endSeats !== 1) bad.push(`2 end seats on a ${(narrow.topWide / IN).toFixed(0)}" top → ${narrow.endSeats}, expected 1`);
  const tight = computeKitchenLayout(withIsland({ seating: 4, lengthFt: 12, endSeats: 2 })).island!;
  if (tight.endSeats !== 0) bad.push(`end seats with no floor beyond the end → ${tight.endSeats}`);
  if (bad.length) fail(`stool controls: ${bad.join('; ')}`);
  else ok(`stool controls: 24" pitch exact, 40" pitch seats ${isl40.seating} under the top, end seats 2/1/0 honoured when clear, 1 on a ${(narrow.topWide / IN).toFixed(0)}" top, 0 when the end is tight`);
}

// --- hood and fridge heights ---------------------------------------------
const withApp = (kind: KitchenSpec['appliances'][number]['kind'], p: Partial<KitchenSpec['appliances'][number]>, extra: Partial<KitchenSpec> = {}): KitchenSpec => ({ ...base, ...extra, appliances: base.appliances.map((a) => (a.kind === kind ? { ...a, ...p } : a)) });
// A hood cabinet legitimately follows the mouth (its underside IS the canopy
// top), so `upper.` cannot be a blanket anchor any more — the anchors name the
// row cabinets that must NOT move instead. The sweeps below take the cabinet
// away; section 9 sweeps it back in with the keys it is allowed to move.
const UPPER_ANCHORS = baseL.runs.flatMap((r) => r.uppers.map((_, i) => `upper.${r.id}.${i}.cx`).concat(r.uppers.map((_, i) => `upper.${r.id}.${i}.w`)));
const NOT_HOOD = ['island.', 'base.', ...UPPER_ANCHORS, 'tall.', 'counter.', 'sink.', 'run.', 'cab.', 'room.', 'light.', 'stool.', 'decor.', `app.${FRIDGE_ID}`, ...OTHER_APPS, `app.${HOOD_ID}.h`, `app.${HOOD_ID}.x`, `app.${HOOD_ID}.w`];
// the feature slab behind the range follows the mouth; the duct cover still reaches the ceiling
sweep('hood mouth 18→48" (20" floor)', range(18, 48, 2), (v: number) => bareHood(withApp('hood', { aboveCounterIn: v })), [`app.${HOOD_ID}.y`, 'splash.'], [...NOT_HOOD, `app.${HOOD_ID}.top`]);
sweep('hood height 12→96"', range(12, 96, 4), (v: number) => bareHood(withApp('hood', { heightIn: v })), [`app.${HOOD_ID}.top`, `app.${HOOD_ID}.h`], [...NOT_HOOD.filter((key) => key !== `app.${HOOD_ID}.h`), 'splash.', `app.${HOOD_ID}.y`]);
sweep('fridge height 60→96"', range(60, 96, 2), (v: number) => withApp('fridge', { heightIn: v }), [`app.${FRIDGE_ID}.h`, `app.${FRIDGE_ID}.top`],
  ['island.', 'base.', 'upper.', 'tall.', 'counter.', 'splash.', 'sink.', 'run.', 'cab.', 'room.', 'light.', 'stool.', 'decor.', `app.${HOOD_ID}`, ...OTHER_APPS, `app.${FRIDGE_ID}.x`, `app.${FRIDGE_ID}.w`, `app.${FRIDGE_ID}.y`]);
{
  const bad: string[] = [];
  const hoodOf = (L: KitchenLayoutData) => L.appliances.find((a) => a.kind === 'hood')!;
  // Every case here is about the hood UNIT, so the cabinet is off: with one on
  // it the unit ends at the cabinet's underside by design (asserted below and
  // in section 9).
  const bareL = computeKitchenLayout(bareHood(base));
  const low = hoodOf(computeKitchenLayout(bareHood(withApp('hood', { aboveCounterIn: 18 }))));
  if (low.y < baseL.counterTopY + 20 * IN - 1e-6) bad.push(`18" asked → mouth ${((low.y - baseL.counterTopY) / IN).toFixed(1)}" over the counter (the floor is 20")`);
  const at36 = hoodOf(computeKitchenLayout(bareHood(withApp('hood', { aboveCounterIn: 36 }))));
  if (Math.abs((at36.y - baseL.counterTopY) - 36 * IN) > 1e-6) bad.push('36" mouth not honoured');
  const auto = hoodOf(bareL);
  if (Math.abs((auto.y - baseL.counterTopY) - 30 * IN) > 1e-6) bad.push('null mouth is not 30"');
  // overall height: the duct cover stops where the photo said — never under the canopy, never through the ceiling
  const h40 = hoodOf(computeKitchenLayout(bareHood(withApp('hood', { heightIn: 40 }))));
  if (Math.abs(hoodExtents(h40).top - (h40.y + 40 * IN)) > 1e-6) bad.push(`40" hood tops at ${((hoodExtents(h40).top - h40.y) / IN).toFixed(1)}"`);
  const h8 = hoodOf(computeKitchenLayout(bareHood(withApp('hood', { heightIn: 8 }))));
  if (Math.abs(h8.height - 8 * IN) > 1e-6 || Math.abs(hoodExtents(h8).top - h8.y - 8 * IN) > 1e-6) bad.push('measured 8" hood did not retain its canopy and total height');
  for (const requested of [6, 8, 10, 12, 14, 18]) {
    const measured = hoodOf(computeKitchenLayout(bareHood(withApp('hood', { heightIn: requested }))));
    if (Math.abs(measured.height / IN - Math.min(requested, 14)) > 1e-6) bad.push(`${requested}" hood canopy should be ${Math.min(requested, 14)}"`);
    if (Math.abs((hoodExtents(measured).top - measured.y) / IN - requested) > 1e-6) bad.push(`${requested}" hood total height changed`);
  }
  const h200 = hoodOf(computeKitchenLayout(bareHood(withApp('hood', { heightIn: 200 }))));
  if (hoodExtents(h200).top > baseL.h + 1e-6) bad.push('200" hood through the ceiling');
  if (Math.abs(hoodExtents(auto).top - baseL.h) > 1e-6) bad.push('null height: duct cover does not reach the ceiling');
  // the mirror: WITH a cabinet on it, a null height tops at the canopy — the
  // duct cover is what the cabinet replaces
  const withCab = hoodOf(baseL);
  if (Math.abs(hoodExtents(withCab).top - (withCab.y + withCab.height)) > 1e-6) bad.push(`cabinet above + null height: unit tops at ${hoodExtents(withCab).top.toFixed(3)}, canopy at ${(withCab.y + withCab.height).toFixed(3)}`);
  if (withCab.cabinetAbove !== 'doors' || withCab.cabinetBottom === null) bad.push(`the demo hood resolved cabinetAbove=${withCab.cabinetAbove}`);
  // the drawn flue follows the layout's top
  const parts = buildKitchenPartsRaw(computeKitchenLayout(bareHood(withApp('hood', { heightIn: 40 }))));
  const flue = parts.find((q) => q.key === `${h40.id}-flue`);
  if (!flue) bad.push('no flue on a 40" hood');
  else {
    flue.geometry.computeBoundingBox();
    const top = flue.geometry.boundingBox!.clone().applyMatrix4(partMatrix(flue)).max.y;
    if (Math.abs(top - hoodExtents(h40).top) > 0.003) bad.push(`flue tops at ${top.toFixed(3)}, layout says ${hoodExtents(h40).top.toFixed(3)}`);
  }
  // a slim insert hangs off the uppers whatever the spec asked
  const slim = hoodOf(computeKitchenLayout(withApp('hood', { hoodShape: 'slim', aboveCounterIn: 40, heightIn: 60 })));
  if (Math.abs(slim.y - baseL.upperBottom) > 1e-6 || Math.abs(hoodExtents(slim).top - (slim.y + slim.height)) > 1e-6) bad.push('a slim insert took a mouth / duct height');
  if (bad.length) fail(`hood heights: ${bad.join('; ')}`);
  else ok('hood heights: mouth 18"→20" floor, 36" honoured, 30" default; overall 40" exact (flue drawn to it), 8" exact, 200" ≤ ceiling, null → ceiling; with a cabinet on it → the canopy; slim insert unaffected');
}
{
  const bad: string[] = [];
  const fridgeOf = (L: KitchenLayoutData) => L.appliances.find((a) => a.kind === 'fridge')!;
  const f72 = fridgeOf(computeKitchenLayout(withApp('fridge', { heightIn: 72 })));
  if (Math.abs(f72.height - 72 * IN) > 1e-6) bad.push(`72" fridge drawn ${(f72.height / IN).toFixed(1)}"`);
  if (Math.abs(fridgeOf(baseL).height - 70 * IN) > 1e-6) bad.push('null height is not the 70" french-door default');
  // the surround's opening closes over whatever height the photo gave
  const surOf = (Lx: KitchenLayoutData) => Lx.runs.flatMap((r) => r.tall).find((t) => t.kind === 'fridge-surround')!;
  const tall = computeKitchenLayout(withApp('fridge', { heightIn: 96 }));
  const f96 = fridgeOf(tall);
  if (f96.height > surOf(tall).openingH + 1e-6) bad.push(`96" fridge (${(f96.height / IN).toFixed(0)}") pokes through its ${(surOf(tall).openingH / IN).toFixed(0)}" opening`);
  if (f96.height <= f72.height) bad.push('96" fridge is not taller than 72"');
  const free = computeKitchenLayout(withApp('fridge', { heightIn: 96 }, { runs: base.runs.map((r) => ({ ...r, tall: [] })) }));
  if (Math.abs(fridgeOf(free).height - Math.min(96 * IN, free.h - 0.3)) > 1e-6) bad.push(`96" free-standing fridge drawn ${(fridgeOf(free).height / IN).toFixed(1)}"`);
  if (bad.length) fail(`fridge height: ${bad.join('; ')}`);
  else ok(`fridge height: 72" exact, 70" default, 96" in a surround capped at ${(f96.height / IN).toFixed(0)}" by the opening, 96" free-standing held under the ceiling`);
}

// ---------------------------------------------------------------------------
// 2. Robustness
// ---------------------------------------------------------------------------
console.log('\n2. ROBUSTNESS — nothing throws, everything is finite');

const nan = NaN as unknown as number;
const nasty: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['empty object', {}],
  ['NaN dims', { ...base, dims: { widthFt: nan, depthFt: nan, ceilingFt: nan } }],
  ['negative dims', { ...base, dims: { widthFt: -5, depthFt: -5, ceilingFt: -5 } }],
  ['absurd dims', { ...base, dims: { widthFt: 1e9, depthFt: 1e9, ceilingFt: 1e9 } }],
  ['no runs', { ...base, runs: [] }],
  ['garbage runs', { ...base, runs: [null, 3, { wall: 'nope', base: 'x' }] }],
  ['garbage island', { ...base, island: { present: true, lengthFt: nan, widthFt: nan, offset: null } }],
  ['tiny room + big island', { ...base, dims: { widthFt: 5, depthFt: 5, ceilingFt: 7 }, island: { ...base.island, present: true, lengthFt: 30, widthFt: 12 } }],
  ['garbage appliances', { ...base, appliances: [null, {}, { kind: 'zzz', wall: 'zzz', widthIn: nan }] }],
  ['garbage openings', { ...base, openings: [null, {}, { kind: 'window', wall: 'zzz', widthFt: nan, heightFt: nan, sillFt: nan }] }],
];
for (const [label, spec] of nasty) {
  try {
    const L = computeKitchenLayout(spec as KitchenSpec);
    const snap = snapshot(L);
    const badKey = Object.entries(snap).find(([, v]) => !Number.isFinite(v));
    if (badKey) fail(`${label}: non-finite ${badKey[0]}`);
    else ok(`${label}: ${L.runs.length} runs, ${L.appliances.length} appliances, island=${L.island ? 'yes' : 'no'}`);
  } catch (e) {
    fail(`${label}: threw — ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Geometry budget
// ---------------------------------------------------------------------------
console.log('\n3. GEOMETRY BUDGET — ≤ 900 draw calls, ≤ 1.2M triangles');

const STYLES = ['modern', 'contemporary', 'transitional', 'traditional', 'farmhouse', 'scandinavian', 'industrial', 'coastal', 'mid-century', 'craftsman', 'mediterranean'] as const;
const DOOR_STYLES = ['shaker', 'flat', 'raised', 'slab', 'beaded', 'glass', 'open'] as const;

/** A run stuffed with the maximum number of cabinets the solver accepts. */
const packedRun = (wall: KitchenSpec['runs'][number]['wall'], lengthFt: number): KitchenSpec['runs'][number] => ({
  id: `packed-${wall}`,
  wall,
  start: 0,
  lengthFt,
  base: Array.from({ length: 24 }, (_, i) => ({ type: i % 5 === 0 ? 'drawers' as const : 'door' as const, widthIn: 18, drawerCount: 3 })),
  uppers: Array.from({ length: 24 }, () => ({ type: 'door' as const, widthIn: 18 })),
  tall: [],
  hasUppers: true,
  uppersToCeiling: false,
  backsplash: true,
  upperHeightIn: null,
});

const scenarios: Array<[string, KitchenSpec]> = [
  ['default kitchen', base],
  ...STYLES.map((style): [string, KitchenSpec] => [`style: ${style}`, { ...base, style }]),
  ...DOOR_STYLES.map((doorStyle): [string, KitchenSpec] => [`door: ${doorStyle}`, { ...base, cabinets: { ...base.cabinets, doorStyle } }]),
  ['no island, no uppers', { ...base, island: { ...base.island, present: false }, runs: base.runs.map((r) => ({ ...r, hasUppers: false })) }],
  ['farmhouse sink + crown', {
    ...base,
    style: 'farmhouse' as const,
    cabinets: { ...base.cabinets, crown: true, doorStyle: 'beaded' as const, hardware: 'mixed' as const },
    sink: { ...base.sink, kind: 'farmhouse' as const },
  }],
  ['island sink + cooktop + hood', {
    ...base,
    sink: { ...base.sink, wall: 'island' as const },
    island: { ...base.island, present: true, hasSink: true, hasCooktop: true, waterfall: true, seating: 4 },
    appliances: [
      ...base.appliances,
      { kind: 'cooktop' as const, wall: 'island' as const, t: 0.5, widthIn: 36, finish: 'stainless' as const },
      { kind: 'hood' as const, wall: 'island' as const, t: 0.5, widthIn: 36, finish: 'stainless' as const, hoodStyle: 'island' as const },
    ],
  }],
  ['every appliance', {
    ...base,
    appliances: ([
      ['fridge', 'back', 0.1, 36], ['range', 'back', 0.5, 36], ['dishwasher', 'back', 0.75, 24],
      ['microwave', 'left', 0.3, 30], ['wall-oven', 'left', 0.6, 30], ['wine-fridge', 'left', 0.85, 24],
      ['hood', 'back', 0.5, 36], ['cooktop', 'right', 0.5, 30],
    ] as const).map(([kind, wall, t, widthIn]) => ({ kind, wall, t, widthIn, finish: 'stainless' as const })),
  }],
  ['décor stress: 6 shelves, 8 plants, 6 art, blinds', {
    ...base,
    runs: base.runs.map((r) => ({ ...r, hasUppers: false })),
    openings: [
      ...base.openings,
      { id: 'w2', kind: 'window' as const, wall: 'left' as const, t: 0.5, widthFt: 4, heightFt: 4, sillFt: 3.5, style: 'standard' as const },
      { id: 'w3', kind: 'window' as const, wall: 'front' as const, t: 0.3, widthFt: 5, heightFt: 4, sillFt: 3, style: 'standard' as const },
    ],
    decor: {
      items: [],
      cabinetContents: [],
      shelves: (['back', 'back', 'left', 'right', 'front', 'front'] as const).map((wall, i) => ({ wall, t: 0.15 + (i % 2) * 0.55, widthIn: 60, count: 4, bottomFt: 4.2, depthIn: 12, spacingIn: 12, material: 'wood' as const, styled: 'mixed' as const })),
      plants: [
        { kind: 'floor' as const, wall: 'corner' as const, t: 0, sizeFt: 7, form: 'tree' as const },
        { kind: 'floor' as const, wall: 'corner' as const, t: 0.5, sizeFt: 6, form: 'leafy' as const },
        { kind: 'floor' as const, wall: 'front' as const, t: 0.6, sizeFt: 4, form: 'trailing' as const },
        { kind: 'counter' as const, wall: 'back' as const, t: 0.2, sizeFt: 1.5, form: 'herb' as const },
        { kind: 'counter' as const, wall: 'island' as const, t: 0.5, sizeFt: 1, form: 'succulent' as const },
        { kind: 'shelf' as const, wall: 'back' as const, t: 0.2, sizeFt: 0.8, form: 'trailing' as const },
        { kind: 'hanging' as const, wall: 'back' as const, t: 0.33, sizeFt: 3, form: 'trailing' as const },
        { kind: 'hanging' as const, wall: 'left' as const, t: 0.5, sizeFt: 2, form: 'leafy' as const },
      ],
      art: (['back', 'left', 'right', 'right', 'front', 'front'] as const).map((wall, i) => ({ wall, t: 0.5 + (i % 3) * 0.2, widthIn: 36, heightIn: 48, centerFt: 5.5, frame: (['black', 'wood', 'white', 'none'] as const)[i % 4] })),
      rug: { present: true, lengthFt: 14, widthFt: 10, style: 'area' as const },
      windowTreatment: 'blinds' as const,
      counterStyling: 'lived-in' as const, stools: null,
    },
  }],
  ['WORST CASE: 4 packed runs, 30ft, glass, crown', {
    ...base,
    dims: { widthFt: 30, depthFt: 30, ceilingFt: 14 },
    style: 'traditional' as const,
    cabinets: { ...base.cabinets, crown: true, doorStyle: 'glass' as const, hardware: 'pulls' as const },
    runs: [packedRun('back', 30), packedRun('left', 30), packedRun('right', 30), packedRun('front', 30)],
    island: { ...base.island, present: true, lengthFt: 12, widthFt: 5, seating: 6, waterfall: true, offset: { x: 0, z: 0 } },
    lighting: { ...base.lighting, recessedCount: 16, pendants: { count: 6, style: 'globe' as const, finish: 'brass' as const, spreadFt: 0, offsetFt: 0, aboveCounterIn: 0 } },
    openings: [
      ...base.openings,
      { id: 'w2', kind: 'window' as const, wall: 'left' as const, t: 0.5, widthFt: 4, heightFt: 4, sillFt: 3.5, style: 'standard' as const },
      { id: 'd2', kind: 'door' as const, wall: 'front' as const, t: 0.2, widthFt: 2.83, heightFt: 6.83, sillFt: 0, style: null },
    ],
  }],
];

let worstTris = 0, worstCalls = 0;
for (const [label, spec] of scenarios) {
  let b;
  try { b = kitchenGeometryBudget(computeKitchenLayout(spec)); }
  catch (e) { fail(`${label}: build threw — ${(e as Error).message}`); continue; }
  worstTris = Math.max(worstTris, b.triangles);
  worstCalls = Math.max(worstCalls, b.drawCalls);
  const line = `${label.padEnd(40)} ${String(b.drawCalls).padStart(5)} draws ${b.triangles.toLocaleString().padStart(10)} tris  (${b.uniqueGeometries} geos, ${b.instanced} instanced)`;
  if (b.drawCalls > 900 || b.triangles > 1_200_000) fail(`OVER BUDGET — ${line}`);
  else ok(line);
}
console.log(`  worst case: ${worstCalls} draw calls / ${worstTris.toLocaleString()} triangles`);

// ---------------------------------------------------------------------------
// 4. Part integrity
// ---------------------------------------------------------------------------
console.log('\n4. PART INTEGRITY — finite transforms, real geometry, honest slots');

/** Every priced kitchen slot the twin is expected to put on screen. */
const REQUIRED_SLOTS = [
  'flooring', 'walls', 'ceiling', 'cabinets_base', 'cabinets_upper', 'countertop',
  'backsplash', 'hardware', 'appliances', 'faucet',
];

for (const [label, spec] of scenarios.slice(0, 4).concat([scenarios[scenarios.length - 1]])) {
  const L = computeKitchenLayout(spec);
  const raw = buildKitchenPartsRaw(L);
  const parts = buildKitchenParts(L);
  let bad = 0;
  const seen = new Set<string>();
  const keys = new Set<string>();
  let dupKey = '';
  for (const p of raw) {
    if (keys.has(p.key)) dupKey = dupKey || p.key;
    keys.add(p.key);
    if (p.slot) seen.add(p.slot);
    const pos = p.position ?? [0, 0, 0];
    const rot = p.rotation ?? [0, 0, 0];
    if (![...pos, ...rot].every(Number.isFinite)) bad++;
    const posAttr = p.geometry.getAttribute('position');
    if (!posAttr || posAttr.count === 0) bad++;
    else {
      const arr = posAttr.array as ArrayLike<number>;
      for (let i = 0; i < Math.min(arr.length, 900); i++) if (!Number.isFinite(arr[i])) { bad++; break; }
    }
  }
  if (bad) fail(`${label}: ${bad} malformed parts`);
  if (dupKey) fail(`${label}: duplicate part key "${dupKey}" (React would drop one)`);
  // instancing must not lose or invent geometry
  const rawTris = raw.reduce((n, p) => n + tri(p.geometry) * (p.instances?.length ?? 1), 0);
  const insTris = parts.reduce((n, p) => n + tri(p.geometry) * (p.instances?.length ?? 1), 0);
  if (Math.abs(rawTris - insTris) > 0.5) fail(`${label}: auto-instancing changed the triangle count (${rawTris} → ${insTris})`);
  const missing = REQUIRED_SLOTS.filter((s) => !seen.has(s));
  // the tall-unit slot is priced whenever a run has a pantry / surround / tower
  if (L.runs.some((r) => r.tall.length) && !seen.has('cabinets_tall')) missing.push('cabinets_tall');
  if (L.runs.length && missing.length) fail(`${label}: no geometry for priced slot(s) ${missing.join(', ')}`);
  if (!bad && !dupKey && !missing.length) ok(`${label}: ${raw.length} parts → ${parts.length} meshes, ${seen.size} slots on screen`);
}

function tri(g: THREE.BufferGeometry): number {
  const idx = g.getIndex();
  if (idx) return idx.count / 3;
  const pos = g.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

// ---------------------------------------------------------------------------
// 5. Placement sanity — nothing outside the room, trim facing the right way
// ---------------------------------------------------------------------------
console.log('\n5. PLACEMENT — everything inside the room, trim the right way round');

/** Parts that are DELIBERATELY outside the envelope (daylight plates, thresholds). */
const OUTSIDE_OK = /-sky$|-beyond$|-thresh$|^register$/;

function frameMatrix(frame: string, L: KitchenLayoutData): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  if (frame === 'world') return m;
  if (frame === 'island') {
    if (!L.island) return m;
    return m.compose(
      new THREE.Vector3(L.island.cx, 0, L.island.cz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, L.island.yaw, 0)),
      new THREE.Vector3(1, 1, 1),
    );
  }
  const f = wallFrame(frame as 'back' | 'left' | 'right' | 'front', L.w, L.d);
  const c = f.origin.clone().addScaledVector(f.along, f.length / 2);
  return m.compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.yaw, 0)), new THREE.Vector3(1, 1, 1));
}

function partMatrix(p: { position?: number[]; rotation?: number[]; scale?: number | number[] }): THREE.Matrix4 {
  const sc = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : (p.scale ?? [1, 1, 1]);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(p.position?.[0] ?? 0, p.position?.[1] ?? 0, p.position?.[2] ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation?.[0] ?? 0, p.rotation?.[1] ?? 0, p.rotation?.[2] ?? 0)),
    new THREE.Vector3(sc[0], sc[1], sc[2]),
  );
}

for (const [label, spec] of [scenarios[0], scenarios[scenarios.length - 1]] as Array<[string, KitchenSpec]>) {
  const L = computeKitchenLayout(spec);
  const parts = buildKitchenPartsRaw(L);
  const pad = 0.35;                    // overhangs, handles, stools, crown returns
  const outside: string[] = [];
  const sunk: string[] = [];
  for (const p of parts) {
    if (OUTSIDE_OK.test(p.key)) continue;
    p.geometry.computeBoundingBox();
    const bb = p.geometry.boundingBox;
    if (!bb) continue;
    const box = bb.clone().applyMatrix4(partMatrix(p)).applyMatrix4(frameMatrix(p.frame, L));
    if (box.min.x < -L.w / 2 - pad || box.max.x > L.w / 2 + pad
      || box.min.z < -L.d / 2 - pad || box.max.z > L.d / 2 + pad
      || box.max.y > L.h + 0.06) outside.push(p.key);
    if (box.min.y < -0.02) sunk.push(p.key);
  }
  if (outside.length) fail(`${label}: ${outside.length} part(s) outside the room — ${outside.slice(0, 6).join(', ')}`);
  if (sunk.length) fail(`${label}: ${sunk.length} part(s) below the floor — ${sunk.slice(0, 6).join(', ')}`);
  if (!outside.length && !sunk.length) ok(`${label}: all ${parts.length} parts inside the envelope`);

  // targeted: trim must face the right way in its own wall frame
  const bboxIn = (key: string) => {
    const p = parts.find((q) => q.key === key);
    if (!p) return null;
    p.geometry.computeBoundingBox();
    return p.geometry.boundingBox!.clone().applyMatrix4(partMatrix(p));
  };
  const baseTrim = parts.find((p) => p.key.startsWith('base-back-'));
  if (baseTrim) {
    const b = bboxIn(baseTrim.key)!;
    if (b.max.z <= 0.004) fail(`${label}: base moulding does not project into the room (max z ${b.max.z.toFixed(4)})`);
    else if (b.min.z < -0.004) fail(`${label}: base moulding is buried in the wall (min z ${b.min.z.toFixed(4)})`);
    else if (b.max.y > 0.20 || b.max.y < 0.06) fail(`${label}: base moulding height looks wrong (${b.max.y.toFixed(3)} m)`);
    else ok(`${label}: base moulding ${(b.max.y * 39.37).toFixed(1)}" tall, projects ${(b.max.z * 1000).toFixed(0)} mm`);
  }
  const toe = parts.find((p) => /-toe\d+$/.test(p.key));
  if (toe) {
    const b = bboxIn(toe.key)!;
    const run = L.runs[0];
    if (b.max.z > run.baseDepth - 0.06) fail(`${label}: toe kick is not recessed (front at ${b.max.z.toFixed(3)} of ${run.baseDepth.toFixed(3)})`);
    else ok(`${label}: toe kick recessed ${((run.baseDepth - b.max.z) * 39.37).toFixed(1)}"`);
  }
  const top = parts.find((p) => p.key.endsWith('-ct0'));
  if (top) {
    const b = bboxIn(top.key)!;
    if (Math.abs(b.max.y - L.counterTopY) > 0.002) fail(`${label}: counter top at ${b.max.y.toFixed(4)}, expected ${L.counterTopY.toFixed(4)}`);
    else ok(`${label}: counter surface at ${(L.counterTopY * 39.37).toFixed(1)}" AFF`);
  }
}

// ---------------------------------------------------------------------------
// 6. Décor containment — inside the room, out of the cabinets, off the glass
// ---------------------------------------------------------------------------
console.log('\n6. DÉCOR CONTAINMENT — no plant in a cabinet, no shelf through a window, no rug under the island');

const overlaps1 = (a0: number, a1: number, b0: number, b1: number, tol = 0.005) => a0 < b1 - tol && a1 > b0 + tol;
const distToRect = (px: number, pz: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  Math.hypot(Math.max(r.minX - px, 0, px - r.maxX), Math.max(r.minZ - pz, 0, pz - r.maxZ));

for (const [label, spec] of [scenarios[0], ['décor base', decorBase] as [string, KitchenSpec], scenarios.find(([l]) => l.startsWith('décor stress'))!]) {
  const L = computeKitchenLayout(spec);
  const D = L.decor;
  const bad: string[] = [];
  const wallLen = (wall: string) => (wall === 'back' || wall === 'front' ? L.w : L.d);
  // shelves and art: inside the wall, clear of every opening and wall cabinet in their height band
  const onWall = (what: string, wall: string, x: number, width: number, y0: number, y1: number) => {
    const wl = wallLen(wall);
    if (x - width / 2 < -wl / 2 - 0.001 || x + width / 2 > wl / 2 + 0.001) bad.push(`${what} runs past the end of the ${wall} wall`);
    for (const o of L.openings) {
      if (o.wall !== wall || !overlaps1(y0, y1, o.sill, o.sill + o.height)) continue;
      if (overlaps1(x - width / 2, x + width / 2, o.x - o.width / 2, o.x + o.width / 2)) bad.push(`${what} runs through ${o.id}`);
    }
    for (const r of L.runs) {
      if (r.wall !== wall) continue;
      for (const t of r.tall) if (y1 > 0 && overlaps1(x - width / 2, x + width / 2, t.x0, t.x1)) bad.push(`${what} runs through ${t.id}`);
      if (r.uppers.length && overlaps1(y0, y1, r.upperBottom, r.upperTop)) {
        for (const u of r.uppers) if (overlaps1(x - width / 2, x + width / 2, u.x0, u.x1)) bad.push(`${what} runs through ${u.id}`);
      }
    }
  };
  for (const s of D.shelves) {
    const top = s.boards[s.boards.length - 1] + s.thickness;
    onWall(s.id, s.wall, s.x, s.width, s.boards[0], top);
    if (top > L.h - 0.02) bad.push(`${s.id} is in the ceiling`);
    if (s.overCounter && s.boards[0] < L.counterTopY + 0.15) bad.push(`${s.id} sits on the counter`);
  }
  for (const a of D.art) {
    onWall(a.id, a.wall, a.x, a.width, a.y - a.height / 2, a.y + a.height / 2);
    for (const s of D.shelves) {
      if (s.wall !== a.wall) continue;
      if (overlaps1(a.x - a.width / 2, a.x + a.width / 2, s.x - s.width / 2, s.x + s.width / 2)
        && overlaps1(a.y - a.height / 2, a.y + a.height / 2, s.boards[0] - 0.02, s.boards[s.boards.length - 1] + 0.25)) bad.push(`${a.id} hangs behind ${s.id}`);
    }
  }
  // floor plants: inside the room, out of every footprint
  for (const p of D.plants) {
    if (p.kind !== 'floor') continue;
    if (Math.abs(p.x) > L.w / 2 - p.potR + 0.001 || Math.abs(p.z) > L.d / 2 - p.potR + 0.001) bad.push(`${p.id} is outside the room`);
    for (const r of L.rects) if (distToRect(p.x, p.z, r) < p.potR - 0.001) bad.push(`${p.id} stands in a cabinet footprint`);
  }
  // counter plants really are on a counter, shelf plants on a board
  for (const p of D.plants) {
    if (p.kind === 'counter' && Math.abs(p.y - L.counterTopY) > 0.002) bad.push(`${p.id} floats at ${p.y.toFixed(3)} instead of the counter`);
    if (p.kind === 'shelf' && !D.shelves.some((s) => s.wall === p.frame && s.boards.some((b) => Math.abs(b + s.thickness - p.y) < 0.002) && Math.abs(p.x - s.x) <= s.width / 2)) bad.push(`${p.id} is not on a board`);
    if (p.kind === 'hanging' && (p.y - p.drop < L.counterTopY + 0.1 || p.y > L.h + 0.001)) bad.push(`${p.id} hangs too low or through the ceiling`);
  }
  // the rug: inside the room, not under the island or a run
  if (D.rug) {
    const r = D.rug;
    const hx = (r.yaw === 0 ? r.len : r.wide) / 2, hz = (r.yaw === 0 ? r.wide : r.len) / 2;
    if (r.cx - hx < -L.w / 2 - 0.001 || r.cx + hx > L.w / 2 + 0.001 || r.cz - hz < -L.d / 2 - 0.001 || r.cz + hz > L.d / 2 + 0.001) bad.push('rug runs outside the room');
    for (const rc of L.rects) {
      if (overlaps1(r.cx - hx, r.cx + hx, rc.minX, rc.maxX, 0.02) && overlaps1(r.cz - hz, r.cz + hz, rc.minZ, rc.maxZ, 0.02)) bad.push('rug runs under the cabinetry');
    }
  }
  for (const t of D.treatments) if (t.head > L.h + 0.001 || t.head < t.sill) bad.push(`${t.id} is mounted off the wall`);
  if (bad.length) fail(`${label}: ${bad.slice(0, 6).join('; ')}${bad.length > 6 ? ` …+${bad.length - 6}` : ''}`);
  else ok(`${label}: ${D.shelves.length} shelves, ${D.plants.length} plants, ${D.art.length} art, rug=${D.rug ? D.rug.style : 'none'}, ${D.treatments.length} treatments all contained (${D.warnings.length} placement note${D.warnings.length === 1 ? '' : 's'})`);
}

// a piece that cannot be placed is reported, never dropped in silence
{
  const walled: KitchenSpec = { ...base, dims: { widthFt: 8, depthFt: 8, ceilingFt: 8 }, decor: { ...base.decor, shelves: [{ wall: 'back', t: 0.5, widthIn: 120, count: 5, bottomFt: 8.5, depthIn: 16, spacingIn: 24, material: 'wood', styled: 'mixed' }] } };
  const L = computeKitchenLayout(walled);
  const s = L.decor.shelves[0];
  if (s && L.decor.warnings.length === 0) fail('an impossible shelf was fitted without a word');
  else if (!s && !L.decor.warnings.some((w) => w.includes('dropped'))) fail('a shelf vanished without a warning');
  else ok(`impossible shelf: ${s ? `fitted as ${s.boards.length} board(s) ${(s.width * 39.37).toFixed(0)}" wide` : 'dropped'} — "${L.decor.warnings[0]}"`);
}

// ---------------------------------------------------------------------------
// 7. Backsplash semantics
// ---------------------------------------------------------------------------
console.log('\n7. BACKSPLASH — per-run off, full height to the cabinets or the ceiling, around a window');

const near = (a: number, b: number, tol = 0.003) => Math.abs(a - b) < tol;
const backWin = base.openings.find((o) => o.id === 'win-1')!;
{
  // per-run off: the left run loses its tile, cap and bead but keeps its outlets on the paint; the back run is untouched
  const off: KitchenSpec = { ...base, runs: base.runs.map((r) => (r.id === 'run-left' ? { ...r, backsplash: false } : r)) };
  const L0 = computeKitchenLayout(base), L1 = computeKitchenLayout(off);
  const left = L1.runs.find((r) => r.id === 'run-left')!;
  const parts = buildKitchenPartsRaw(L1);
  const splashParts = parts.filter((p) => p.key.startsWith('run-left-sp'));
  const outlets = parts.filter((p) => p.key.startsWith('outlet-run-left-'));
  const backSame = diffKeys(snapshot(L0), snapshot(L1)).filter((k) => k.startsWith('splash.run-back'));
  if (left.splash.length) fail(`per-run off: the left run still carries ${left.splash.length} splash piece(s)`);
  else if (splashParts.length) fail(`per-run off: ${splashParts.length} tile part(s) still drawn on the left run`);
  else if (!outlets.length) fail('per-run off: the left run lost its counter outlets');
  else if (backSame.length) fail(`per-run off: the back run's splash changed — ${backSame.join(', ')}`);
  else ok(`per-run off: left run bare, ${outlets.length} outlet(s) on the paint, back run unchanged`);
}
{
  // full height with wall cabinets: to their underside; behind a hood with
  // NOTHING above it: to the ceiling; under the window: to the sill
  const L = computeKitchenLayout(bareHood({ ...base, backsplash: { ...base.backsplash, height: 'full-height' } }));
  const run = L.runs.find((r) => r.id === 'run-back')!;
  const win = L.openings.find((o) => o.id === 'win-1')!;
  const hood = L.appliances.find((a) => a.kind === 'hood')!;
  const bad: string[] = [];
  for (const sp of run.splash) {
    const underWin = overlaps1(sp.x0, sp.x1, win.x - win.width / 2, win.x + win.width / 2);
    const behindHood = overlaps1(sp.x0, sp.x1, hood.x - hood.width / 2, hood.x + hood.width / 2);
    if (underWin && !near(sp.top, win.sill - 0.0127)) bad.push(`under the window tops at ${sp.top.toFixed(3)} (sill ${win.sill.toFixed(3)})`);
    else if (behindHood && !near(sp.top, L.h - 0.006)) bad.push(`behind the hood tops at ${sp.top.toFixed(3)} (ceiling ${L.h.toFixed(3)})`);
    else if (!underWin && !behindHood && !near(sp.top, run.upperBottom)) bad.push(`tops at ${sp.top.toFixed(3)} (uppers at ${run.upperBottom.toFixed(3)})`);
    if (overlaps1(sp.x0, sp.x1, win.x - win.width / 2, win.x + win.width / 2) && overlaps1(sp.bottom, sp.top, win.sill, win.sill + win.height)) bad.push('tile crosses the window');
  }
  // and with a cabinet ON the hood the field stops at that cabinet's underside:
  // tile behind a closed box is tile nobody buys
  const Lc = computeKitchenLayout({ ...base, backsplash: { ...base.backsplash, height: 'full-height' } });
  const runC = Lc.runs.find((r) => r.id === 'run-back')!;
  const hoodC = Lc.appliances.find((a) => a.kind === 'hood')!;
  if (hoodC.cabinetBottom === null) bad.push('the demo hood lost its cabinet');
  else {
    const behind = runC.splash.filter((sp) => overlaps1(sp.x0, sp.x1, hoodC.x - hoodC.width / 2, hoodC.x + hoodC.width / 2));
    if (!behind.length) bad.push('no tile behind the hood');
    else if (!behind.every((sp) => Math.abs(sp.top - (hoodC.cabinetBottom! + 0.5 * IN)) < 0.001)) {
      bad.push(`with a cabinet above, the field tops at ${behind.map((s) => s.top.toFixed(3)).join('/')} (cabinet underside ${hoodC.cabinetBottom!.toFixed(3)})`);
    }
  }
  if (bad.length) fail(`full height + uppers: ${bad.join('; ')}`);
  else ok(`full height + uppers: ${run.splash.length} pieces — to the cabinets, to the ceiling behind a bare hood, to the cabinet underside behind one with a cabinet on it, to the sill under the window`);
}
for (const style of ['transitional', 'traditional'] as const) {
  // full height with NO wall cabinets: to the ceiling (under the room crown when there is one), resuming over the window head
  const L = computeKitchenLayout({ ...base, style, backsplash: { ...base.backsplash, height: 'full-height' }, runs: base.runs.map((r) => ({ ...r, hasUppers: false })) });
  const run = L.runs.find((r) => r.id === 'run-back')!;
  const win = L.openings.find((o) => o.id === 'win-1')!;
  const ceiling = L.h - (L.ceilingCrown > 0 ? L.ceilingCrown + 0.004 : 0.006);
  const bad: string[] = [];
  let over = 0;
  for (const sp of run.splash) {
    const underWin = overlaps1(sp.x0, sp.x1, win.x - win.width / 2, win.x + win.width / 2);
    if (sp.bottom > L.counterTopY + 0.01) { over++; if (!near(sp.bottom, win.sill + win.height + 0.0127) || !near(sp.top, ceiling)) bad.push(`over the window runs ${sp.bottom.toFixed(3)}→${sp.top.toFixed(3)}`); continue; }
    if (underWin && !near(sp.top, win.sill - 0.0127)) bad.push(`under the window tops at ${sp.top.toFixed(3)}`);
    if (!underWin && !near(sp.top, ceiling)) bad.push(`tops at ${sp.top.toFixed(3)} instead of the ceiling ${ceiling.toFixed(3)}`);
    if (underWin && overlaps1(sp.bottom, sp.top, win.sill, win.sill + win.height)) bad.push('tile crosses the window');
  }
  if (!over) bad.push('no tile over the window head');
  if (style === 'traditional' && L.ceilingCrown <= 0) bad.push('traditional kitchen has no ceiling crown to stop under');
  const parts = buildKitchenPartsRaw(L);
  if (parts.some((p) => /^run-back-sp\d+-(schluter|bull)$/.test(p.key) && !p.key.includes('sp-'))) {
    // caps are only legitimate on the pieces that stop under the window sill
    const capped = parts.filter((p) => /^run-back-sp\d+-(schluter|bull)$/.test(p.key));
    const pieceOf = (k: string) => run.splash[Number(/sp(\d+)/.exec(k)![1])];
    if (capped.some((p) => near(pieceOf(p.key).top, ceiling))) bad.push('a tile field that reaches the ceiling has a finished top edge');
  }
  if (bad.length) fail(`full height, no uppers (${style}): ${bad.join('; ')}`);
  else ok(`full height, no uppers (${style}): tile to ${(ceiling * 39.37).toFixed(1)}" (${L.ceilingCrown > 0 ? 'under the crown' : 'the ceiling'}), resumes over the window head`);
}
{
  // standard height under a window: the piece under the sill stops half an inch short of it
  const L = computeKitchenLayout(base);
  const run = L.runs.find((r) => r.id === 'run-back')!;
  const win = L.openings.find((o) => o.id === 'win-1')!;
  const under = run.splash.filter((sp) => overlaps1(sp.x0, sp.x1, win.x - win.width / 2, win.x + win.width / 2));
  if (!under.length) fail('standard under a window: no tile between the counter and the sill');
  else if (!under.every((sp) => near(sp.top, Math.min(L.counterTopY + 0.4572, win.sill - 0.0127)))) fail(`standard under a window: tops at ${under.map((s) => s.top.toFixed(3)).join(', ')}`);
  else ok(`standard under a window: tile stops ${((win.sill - under[0].top) * 1000).toFixed(0)} mm under the sill (window at ${backWin.sillFt} ft)`);
}
{
  // a floating shelf on a tiled wall sits proud of the tile and clear of the counter
  const spec: KitchenSpec = {
    ...base,
    runs: base.runs.map((r) => ({ ...r, hasUppers: false })),
    backsplash: { ...base.backsplash, height: 'full-height' },
    decor: { ...base.decor, shelves: [{ wall: 'left', t: 0.3, widthIn: 36, count: 2, bottomFt: 3.5, depthIn: 14, spacingIn: 14, material: 'wood', styled: 'dishes' }] },
  };
  const L = computeKitchenLayout(spec);
  const s = L.decor.shelves[0];
  if (!s) fail('shelf over tile: the shelf was dropped');
  else if (!s.overCounter) fail('shelf over tile: not recognised as over the counter');
  else if (s.standoff < 0.005) fail('shelf over tile: the boards sit in the tile (standoff 0)');
  else if (s.depth > 0.3049) fail(`shelf over tile: ${(s.depth * 39.37).toFixed(1)}" deep over a counter`);
  else if (s.boards[0] < L.counterTopY + 0.2) fail(`shelf over tile: lowest board ${((s.boards[0] - L.counterTopY) * 39.37).toFixed(1)}" above the counter`);
  else {
    const parts = buildKitchenPartsRaw(L);
    const board = parts.find((p) => p.key === `${s.id}-board0`)!;
    const behind = L.runs.filter((r) => r.wall === s.wall).some((r) => r.splash.some((sp) => sp.x0 < s.x && sp.x1 > s.x && sp.top > s.boards[1]));
    if (!behind) fail('shelf over tile: the tile stops at the shelf instead of running behind it');
    else if ((board.position?.[2] ?? 0) - s.depth / 2 < s.standoff - 0.001) fail('shelf over tile: the board is buried in the tile');
    else ok(`shelf over tile: boards ${((s.boards[0] - L.counterTopY) * 39.37).toFixed(0)}" over the deck, ${(s.depth * 39.37).toFixed(0)}" deep, ${(s.standoff * 1000).toFixed(0)} mm proud of the tile that runs behind them`);
  }
}

// ---------------------------------------------------------------------------
// 8. Appliance fidelity — hood shapes, fridge sizes, per-unit finishes, the
//    feature slab behind the range, pendant finish
// ---------------------------------------------------------------------------
console.log('\n8. APPLIANCE FIDELITY — the hood, the fridge and the finish the photo showed');

const inch = (v: number) => v * 0.0254;
type Hood = NonNullable<KitchenSpec['appliances'][number]['hoodShape']>;
type Finish = KitchenSpec['appliances'][number]['finish'];
const withHood = (p: Partial<KitchenSpec['appliances'][number]>): KitchenSpec => ({
  ...base, appliances: base.appliances.map((a) => (a.kind === 'hood' ? { ...a, ...p } : a)),
});
const withFridge = (p: Partial<KitchenSpec['appliances'][number]>): KitchenSpec => ({
  ...base, appliances: base.appliances.map((a) => (a.kind === 'fridge' ? { ...a, ...p } : a)),
});
const bboxOf = (parts: ReturnType<typeof buildKitchenPartsRaw>, key: string) => {
  const p = parts.find((q) => q.key === key);
  if (!p) return null;
  p.geometry.computeBoundingBox();
  return p.geometry.boundingBox!.clone().applyMatrix4(partMatrix(p));
};

// every canopy shape: the right height, the right duct cover
{
  const expectH: Record<Hood, number> = { slim: 6, tapered: 14, curved: 16, box: 14, 'wood-canopy': 18 };
  for (const shape of Object.keys(expectH) as Hood[]) {
    // the cabinet on the canopy is section 9's subject; this loop is about the
    // canopy and its duct cover, so it is off here
    const L = computeKitchenLayout(withHood({ hoodShape: shape, cabinetAbove: 'none' }));
    const hood = L.appliances.find((a) => a.kind === 'hood')!;
    const parts = buildKitchenPartsRaw(L);
    const run = L.runs.find((r) => r.id === hood.runId)!;
    const bad: string[] = [];
    if (hood.hoodShape !== shape) bad.push(`resolved as ${hood.hoodShape}`);
    if (!near(hood.height, inch(expectH[shape]))) bad.push(`canopy ${(hood.height / 0.0254).toFixed(1)}" tall, expected ${expectH[shape]}"`);
    const canopy = bboxOf(parts, `${hood.id}-${shape === 'slim' ? 'body' : 'canopy'}`);
    // a wood hood's mouth is its moulded mantle band, under the box
    const mouth = shape === 'wood-canopy' ? bboxOf(parts, `${hood.id}-mantle`) : canopy;
    if (!canopy || !mouth) bad.push('no canopy part');
    else {
      if (!near(mouth.min.y, hood.y, 0.002)) bad.push(`canopy mouth at ${mouth.min.y.toFixed(3)}, hood at ${hood.y.toFixed(3)}`);
      if (Math.abs((canopy.max.x - canopy.min.x) - (hood.width + inch(2))) > 0.004) bad.push(`canopy ${((canopy.max.x - canopy.min.x) / 0.0254).toFixed(1)}" wide over a ${(hood.width / 0.0254).toFixed(0)}" hood`);
    }
    const flue = bboxOf(parts, `${hood.id}-flue`);
    if (shape === 'slim') {
      if (flue) bad.push('a slim insert grew a duct cover');
      if (!near(hood.y, L.upperBottom)) bad.push('slim insert is not under the wall cabinets');
    } else if (shape === 'wood-canopy') {
      if (!flue) bad.push('no chase over the wood canopy');
      else if (!near(flue.max.y, run.upperTop, 0.003)) bad.push(`chase tops at ${flue.max.y.toFixed(3)}, uppers at ${run.upperTop.toFixed(3)}`);
      const canopyPart = parts.find((p) => p.key === `${hood.id}-canopy`)!;
      if (canopyPart.slot !== 'cabinets_upper') bad.push(`wood canopy on the ${canopyPart.slot} slot`);
    } else {
      if (!flue) bad.push('no duct cover');
      else if (!near(flue.max.y, L.h, 0.003)) bad.push(`duct cover tops at ${flue.max.y.toFixed(3)}, ceiling ${L.h.toFixed(3)}`);
      else if (!near(flue.min.y, hood.y + hood.height, 0.003)) bad.push('duct cover does not sit on the canopy');
      if (shape === 'curved') {
        const g = parts.find((p) => p.key === `${hood.id}-canopy`)!.geometry;
        // the bell narrows: sample its width a third of the way up and near the neck
        const pos = g.getAttribute('position');
        let wLow = 0, wHigh = 0;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i), x = Math.abs(pos.getX(i));
          if (Math.abs(y - hood.height * 0.3) < 0.02) wLow = Math.max(wLow, x);
          if (Math.abs(y - hood.height * 0.9) < 0.02) wHigh = Math.max(wHigh, x);
        }
        if (!(wLow > wHigh * 1.15)) bad.push(`bell does not flare (half-widths ${wLow.toFixed(3)} → ${wHigh.toFixed(3)})`);
        // concave: at 30% up it is already narrower than a straight taper would be
        const straight = (hood.width + inch(2)) / 2 - ((hood.width + inch(2)) / 2 - wHigh) * 0.3 / 0.9;
        if (!(wLow < straight - 0.01)) bad.push('bell flare is not concave');
      }
    }
    // the wall cabinets are cut round every canopy but the slim insert
    const uppersOver = run.uppers.filter((u) => u.type !== 'hood-gap' && u.type !== 'hood-cabinet' && u.x0 < hood.x + hood.width / 2 - 0.01 && u.x1 > hood.x - hood.width / 2 + 0.01);
    if (shape !== 'slim' && uppersOver.length) bad.push('a wall cabinet runs through the canopy');
    if (bad.length) fail(`hood '${shape}': ${bad.join('; ')}`);
    else ok(`hood '${shape}': ${expectH[shape]}" canopy, ${shape === 'slim' ? 'no duct' : shape === 'wood-canopy' ? 'chase to the top of the uppers' : 'duct cover to the ceiling'}`);
  }
}

// the default shape per hood style when the analyzer said nothing
{
  const expect: Array<[NonNullable<KitchenSpec['appliances'][number]['hoodStyle']>, Hood]> = [['chimney', 'tapered'], ['custom-insert', 'wood-canopy'], ['under-cabinet', 'slim'], ['island', 'box']];
  const got = expect.map(([style]) => computeKitchenLayout(withHood({ hoodStyle: style, hoodShape: null })).appliances.find((a) => a.kind === 'hood')!.hoodShape);
  const wrong = expect.map(([style, shape], i) => (got[i] === shape ? null : `${style} → ${got[i]} (expected ${shape})`)).filter((w): w is string => !!w);
  if (wrong.length) fail(`hood defaults: ${wrong.join('; ')}`);
  else ok(`hood defaults: ${expect.map(([s, e]) => `${s}→${e}`).join(', ')}`);
}

// fridge styles: height, depth, and the surround sized to fit
{
  for (const hasDispenser of [true, false, null, undefined]) {
    const L = computeKitchenLayout(withFridge({ fridgeStyle: 'french-door', hasDispenser }));
    const fridge = L.appliances.find((a) => a.kind === 'fridge')!;
    const parts = buildKitchenPartsRaw(L);
    const drawn = parts.some((p) => p.key === `${fridge.id}-disp`);
    if (drawn !== (hasDispenser === true)) fail(`dispenser reading ${String(hasDispenser)} drawn=${drawn}`);
    else ok(`dispenser ${String(hasDispenser)}: ${drawn ? 'observed outlet drawn' : 'plain door preserved'}`);
  }
  {
    const L = computeKitchenLayout(withFridge({ fridgeStyle: 'built-in', hasDispenser: true, finish: 'panel-ready' }));
    const fridge = L.appliances.find((a) => a.kind === 'fridge')!;
    if (buildKitchenPartsRaw(L).some((p) => p.key === `${fridge.id}-disp`)) fail('panel-ready fridge acquired an external dispenser through its cabinet front');
    else ok('panel-ready fridge keeps an uninterrupted cabinet front');
  }
  const expect: Record<NonNullable<KitchenSpec['appliances'][number]['fridgeStyle']>, [number, number, number]> = {
    'built-in': [84, 24, 24], 'counter-depth': [70, 25, 25], 'french-door': [70, 30, 25], 'side-by-side': [70, 30, 25], 'top-freezer': [70, 30, 25],
  };
  for (const style of Object.keys(expect) as Array<keyof typeof expect>) {
    const [h, d, sd] = expect[style];
    const L = computeKitchenLayout(withFridge({ fridgeStyle: style }));
    const fr = L.appliances.find((a) => a.kind === 'fridge')!;
    const sur = L.runs.flatMap((r) => r.tall).find((t) => t.kind === 'fridge-surround')!;
    const bad: string[] = [];
    if (!near(fr.height, inch(h))) bad.push(`${(fr.height / 0.0254).toFixed(1)}" tall (expected ${h}")`);
    if (!near(fr.depth, inch(d))) bad.push(`${(fr.depth / 0.0254).toFixed(1)}" deep (expected ${d}")`);
    if (!sur) bad.push('no surround');
    else {
      if (!near(sur.depth, inch(sd))) bad.push(`surround ${(sur.depth / 0.0254).toFixed(1)}" deep (expected ${sd}")`);
      if (!near(sur.openingH, Math.min(sur.top - inch(2), fr.height + inch(0.5)))) bad.push(`opening ${(sur.openingH / 0.0254).toFixed(1)}" for a ${(fr.height / 0.0254).toFixed(0)}" fridge`);
      if (!sur.filled) bad.push('surround not filled');
      // flush or proud: the front of the body against the front of the panels
      const parts = buildKitchenPartsRaw(L);
      const bodyBox = bboxOf(parts, `${fr.id}-d0`)!, panel = bboxOf(parts, `${sur.id}-pl`)!;
      const proud = bodyBox.max.z - panel.max.z;
      if (style === 'built-in' && Math.abs(proud) > 0.002) bad.push(`built-in stands ${(proud * 1000).toFixed(0)} mm proud of its panels`);
      if (style === 'french-door' && proud < inch(4)) bad.push(`french door only ${(proud / 0.0254).toFixed(1)}" proud of the surround`);
    }
    if (bad.length) fail(`fridge '${style}': ${bad.join('; ')}`);
    else ok(`fridge '${style}': ${h}" × ${d}" deep in a ${sd}" surround, opening ${(sur.openingH / 0.0254).toFixed(0)}"`);
  }
  // a built-in on a run with no surround declared gets one synthesised round it
  const bare: KitchenSpec = {
    ...withFridge({ fridgeStyle: 'built-in', t: 0.9 }),
    runs: base.runs.map((r) => ({ ...r, tall: [] })),
  };
  const L = computeKitchenLayout(bare);
  const fr = L.appliances.find((a) => a.kind === 'fridge')!;
  const sur = L.runs.flatMap((r) => r.tall).find((t) => t.kind === 'fridge-surround');
  if (!sur) fail('built-in without a surround: none was synthesised');
  else if (!sur.filled || Math.abs(sur.cx - fr.x) > 0.01) fail(`built-in without a surround: the fridge (x ${fr.x.toFixed(2)}) is not in it (x ${sur.cx.toFixed(2)})`);
  else if (sur.width < fr.width + 2 * inch(1.5) - 0.002) fail('built-in without a surround: the surround is narrower than the fridge plus its panels');
  else ok(`built-in without a surround: one synthesised at x=${sur.cx.toFixed(2)}, ${(sur.width / 0.0254).toFixed(0)}" wide, fridge inside it`);
  // every tall unit is drawn in its own slot whatever the two-tone flag says:
  // pantry, oven tower, the surround's side panels and over-fridge cabinet
  // (doors included), and the surround synthesised round a built-in — never
  // the bases or the uppers. Hardware keeps its own slot.
  {
    const withTalls: KitchenSpec = {
      ...base,
      runs: base.runs.map((r) => (r.id === 'run-left'
        ? { ...r, tall: [{ t: 0.02, widthIn: 24, kind: 'pantry' as const }, { t: 0.6, widthIn: 30, kind: 'oven-tower' as const }] }
        : r)),
    };
    const cases: Array<[string, KitchenSpec]> = [['surround + pantry + oven tower', withTalls], ['synthesised built-in surround', bare]];
    for (const [label, spec] of cases) {
      for (const twoTone of [false, true]) {
        const L2 = computeKitchenLayout({ ...spec, cabinets: { ...spec.cabinets, twoTone } });
        const tallIds = L2.runs.flatMap((r) => r.tall.map((t) => t.id));
        const kinds = [...new Set(L2.runs.flatMap((r) => r.tall.map((t) => t.kind)))];
        const parts = buildKitchenPartsRaw(L2).filter((p) => tallIds.some((id) => p.key === id || p.key.startsWith(`${id}-`)));
        const surfaces = parts.filter((p) => p.slot && p.slot !== 'hardware');
        const doors = surfaces.filter((p) => /-f\d+$/.test(p.key));
        const wrong = parts.find((p) => p.slot === 'cabinets_base' || p.slot === 'cabinets_upper');
        const off = surfaces.find((p) => p.slot !== 'cabinets_tall');
        if (!tallIds.length) fail(`${label} twoTone=${twoTone}: no tall units in the layout`);
        else if (wrong) fail(`${label} twoTone=${twoTone}: ${wrong.key} is on ${wrong.slot}`);
        else if (off) fail(`${label} twoTone=${twoTone}: ${off.key} is on ${off.slot}`);
        // a built-in's surround has no cabinet over an 84" column, so doors are only demanded of the declared units
        else if (!doors.length && spec !== bare) fail(`${label} twoTone=${twoTone}: no tall-unit doors found`);
        else ok(`${label} twoTone=${twoTone}: ${surfaces.length} parts (${doors.length} doors) of ${kinds.join('/')} on cabinets_tall, ${parts.length - surfaces.length} hardware/props`);
      }
    }
  }
}

// a unit's own finish changes what it is drawn in, never where it is
{
  const looks: Array<[Finish | null, (p: { slot?: string; util?: string; metal?: { hex: string } }) => boolean, string]> = [
    [null, (p) => p.slot === 'appliances' && !p.util && !p.metal, 'the appliances slot'],
    ['stainless', (p) => p.slot === 'appliances' && !p.util && !p.metal, 'the appliances slot'],
    ['matte-black', (p) => p.slot === 'appliances' && p.util === 'matte-black', 'matte-black, still labelled appliances'],
    ['white', (p) => p.slot === 'appliances' && p.util === 'white-plastic', 'white, still labelled appliances'],
    ['black-stainless', (p) => p.slot === 'appliances' && p.metal?.hex === '#3a3c3f', 'black stainless tint'],
    ['black', (p) => p.slot === 'appliances' && p.metal?.hex === '#141416', 'gloss black tint'],
    ['panel-ready', (p) => p.slot === 'cabinets_upper' && !p.util && !p.metal, 'the uppers (panel-ready hood)'],
  ];
  // cabinetAbove off so the part count is stable across the finishes
  const ref = computeKitchenLayout(withHood({ hoodShape: 'curved', cabinetAbove: 'none' }));
  const refSnap = snapshot(ref);
  const refParts = buildKitchenPartsRaw(ref);
  for (const [finish, test, label] of looks) {
    const L = computeKitchenLayout(withHood({ hoodShape: 'curved', bodyFinish: finish, cabinetAbove: 'none' }));
    const parts = buildKitchenPartsRaw(L);
    const moved = diffKeys(refSnap, snapshot(L));
    const hood = L.appliances.find((a) => a.kind === 'hood')!;
    const canopy = parts.find((p) => p.key === `${hood.id}-canopy`)!;
    const refCanopy = refParts.find((p) => p.key === canopy.key)!;
    const sameGeom = canopy.geometry === refCanopy.geometry && JSON.stringify(canopy.position) === JSON.stringify(refCanopy.position);
    if (moved.length) fail(`bodyFinish ${finish}: layout moved — ${moved.slice(0, 4).join(', ')}`);
    else if (!sameGeom) fail(`bodyFinish ${finish}: the canopy geometry or position changed`);
    else if (!test(canopy)) fail(`bodyFinish ${finish}: canopy drawn on slot=${canopy.slot} util=${canopy.util} metal=${canopy.metal?.hex}`);
    else if (parts.length !== refParts.length) fail(`bodyFinish ${finish}: part count ${parts.length} vs ${refParts.length}`);
    else ok(`bodyFinish ${String(finish).padEnd(15)} → ${label}, geometry untouched`);
  }
  // a black fridge in a stainless kitchen: the doors, handles and body all go black; the range stays stainless
  const L = computeKitchenLayout(withFridge({ bodyFinish: 'matte-black', heightIn: null, aboveCounterIn: null }));
  const parts = buildKitchenPartsRaw(L);
  const fr = L.appliances.find((a) => a.kind === 'fridge')!, rg = L.appliances.find((a) => a.kind === 'range')!;
  const fridgeSkin = parts.filter((p) => new RegExp(`^${fr.id}-(body|d\\d|h\\d)$`).test(p.key));
  const rangeSkin = parts.filter((p) => new RegExp(`^${rg.id}-(body|door|handle)$`).test(p.key));
  if (fridgeSkin.length < 4 || fridgeSkin.some((p) => p.util !== 'matte-black' || p.slot !== 'appliances')) fail('black fridge: not every skin part went matte-black');
  else if (rangeSkin.some((p) => p.util || p.metal)) fail('black fridge: the range changed finish too');
  else ok(`black fridge beside a stainless range: ${fridgeSkin.length} fridge parts matte-black, ${rangeSkin.length} range parts on the slot`);
}

// behind the range: the feature slab under the hood
{
  const hoodOf = (L: KitchenLayoutData) => L.appliances.find((a) => a.kind === 'hood')!;
  const under = (L: KitchenLayoutData) => {
    const h = hoodOf(L);
    const run = L.runs.find((r) => r.id === h.runId)!;
    // the pieces under a window stop at the sill whatever the height word says — leave them out
    const wins = L.openings.filter((o) => o.wall === run.wall && o.kind === 'window');
    const clear = (sp: { x0: number; x1: number; bottom: number }) => sp.bottom < L.counterTopY + 0.01 && !wins.some((o) => overlaps1(sp.x0, sp.x1, o.x - o.width / 2 - inch(0.5), o.x + o.width / 2 + inch(0.5)));
    return {
      run,
      inHood: run.splash.filter((sp) => clear(sp) && overlaps1(sp.x0, sp.x1, h.x - h.width / 2, h.x + h.width / 2)),
      outHood: run.splash.filter((sp) => clear(sp) && !overlaps1(sp.x0, sp.x1, h.x - h.width / 2 - inch(0.5), h.x + h.width / 2 + inch(0.5))),
    };
  };
  const std = (L: KitchenLayoutData) => Math.min(L.counterTopY + inch(18), L.upperBottom);
  const same = computeKitchenLayout({ ...base, backsplash: { ...base.backsplash, height: 'standard', behindRange: 'same' } });
  const feature = computeKitchenLayout({ ...base, backsplash: { ...base.backsplash, height: 'standard', behindRange: 'full-height' } });
  // a bare hood: the field behind it runs to the ceiling (the "cabinet above"
  // case is covered in the full-height block of section 7)
  const full = computeKitchenLayout(bareHood({ ...base, backsplash: { ...base.backsplash, height: 'full-height', behindRange: 'full-height' } }));
  {
    const { inHood, outHood } = under(same);
    if (!inHood.length) fail("behindRange 'same': no tile behind the range");
    else if (!inHood.every((sp) => near(sp.top, std(same))) || !outHood.every((sp) => near(sp.top, std(same)))) fail("behindRange 'same': the tile behind the range is a different height");
    else ok(`behindRange 'same': tile ${((std(same) - same.counterTopY) / 0.0254).toFixed(0)}" everywhere`);
  }
  {
    const h = hoodOf(feature);
    const { inHood, outHood } = under(feature);
    const bad: string[] = [];
    if (!inHood.length) bad.push('no slab behind the range');
    if (!inHood.every((sp) => near(sp.top, h.y + inch(0.5)))) bad.push(`slab tops at ${inHood.map((s) => s.top.toFixed(3)).join('/')}, hood underside at ${h.y.toFixed(3)}`);
    if (inHood.length && !(near(inHood[0].x0, h.x - h.width / 2 - inch(0.5)) && near(inHood[inHood.length - 1].x1, h.x + h.width / 2 + inch(0.5)))) bad.push('slab is not the hood width plus half an inch each side');
    if (!outHood.length || !outHood.every((sp) => near(sp.top, std(feature)))) bad.push('the rest of the run changed height');
    const parts = buildKitchenPartsRaw(feature);
    const capped = parts.filter((p) => /-sp\d+-(schluter|bull)$/.test(p.key)).map((p) => p.position?.[1] ?? 0);
    if (capped.some((y) => y > std(feature) + 0.05)) bad.push('the feature slab got a finished top edge (it is hidden behind the canopy)');
    if (bad.length) fail(`behindRange 'full-height' + standard: ${bad.join('; ')}`);
    else ok(`behindRange 'full-height' + standard: slab to the hood underside (${((h.y - feature.counterTopY) / 0.0254).toFixed(0)}" up), rest at ${((std(feature) - feature.counterTopY) / 0.0254).toFixed(0)}"`);
  }
  {
    const { inHood } = under(full);
    if (!inHood.every((sp) => near(sp.top, full.h - 0.006))) fail("behindRange + full-height: the field behind the hood no longer reaches the ceiling");
    else ok('behindRange + full-height: field behind the hood still runs to the ceiling');
  }
  // nothing but the splash moves when behindRange flips
  const moved = diffKeys(snapshot(same), snapshot(feature)).filter((k) => !k.startsWith('splash.'));
  if (moved.length) fail(`behindRange moved non-splash geometry: ${moved.slice(0, 5).join(', ')}`);
  else ok('behindRange: only the splash changed');
}

// the pendant finish reaches the lighting rig
{
  const L = computeKitchenLayout({ ...base, lighting: { ...base.lighting, pendants: { count: 3, style: 'glass', finish: 'aged brass', spreadFt: 0, offsetFt: 0, aboveCounterIn: 0 } } });
  if (L.lighting.pendants?.finish !== 'aged brass') fail(`pendant finish: got '${L.lighting.pendants?.finish}'`);
  else ok('pendant finish: "aged brass" carried through to the rig');
}

// ---------------------------------------------------------------------------
// 9. Stools — what the photo showed, arranged the way a real island is
// ---------------------------------------------------------------------------
console.log('\n9. STOOLS — style, frame and seat from the photo; the L round a clear end');

type Stools = NonNullable<KitchenSpec['decor']['stools']>;
const withStools = (stools: Stools | null, extra: Partial<KitchenSpec> = {}): KitchenSpec => ({ ...base, ...extra, decor: { ...base.decor, stools } });
{
  // null → derived from the style, never null
  const derived = (['modern', 'scandinavian', 'transitional', 'farmhouse', 'traditional'] as const).map((style) => [style, computeKitchenLayout(withStools(null, { style })).decor.stools] as const);
  const bad = derived.filter(([, s]) => !s || !s.style || !s.frame || !s.seat);
  if (bad.length) fail('stools null: not resolved for every style');
  else ok(`stools null → by style: ${derived.map(([st, s]) => `${st}=${s.style}/${s.frame}/${s.seat}`).join(', ')}`);
  // given → honoured
  const given: Stools = { style: 'saddle', frame: 'black-metal', seat: 'wood' };
  const s = computeKitchenLayout(withStools(given)).decor.stools;
  if (s.style !== 'saddle' || s.frame !== 'black-metal' || s.seat !== 'wood') fail(`stools given: resolved as ${JSON.stringify(s)}`);
  else ok('stools given: saddle / black-metal / wood honoured');
}
{
  // the parts: a low-back woven stool on a light frame (the photo case) has a
  // frame in light wood, a woven seat and a woven back panel
  const L = computeKitchenLayout(withStools({ style: 'low-back', frame: 'light-wood', seat: 'woven' }));
  const parts = buildKitchenPartsRaw(L);
  const frames = parts.filter((p) => /^isl-stoolF\d+$/.test(p.key));
  const seats = parts.filter((p) => /^isl-stoolS\d+$/.test(p.key));
  const backs = parts.filter((p) => /^isl-stoolB\d+$/.test(p.key));
  const bad: string[] = [];
  if (frames.length !== L.island!.seating) bad.push(`${frames.length} frames for ${L.island!.seating} seats`);
  if (frames.some((p) => p.util !== 'light-wood')) bad.push('frame is not light wood');
  if (seats.length !== frames.length || seats.some((p) => p.procedural?.kind !== 'fabric')) bad.push('seat is not a weave');
  if (backs.length !== frames.length || backs.some((p) => p.procedural?.kind !== 'fabric')) bad.push(`${backs.length} woven back panels for ${frames.length} stools`);
  for (const p of backs) {
    p.geometry.computeBoundingBox();
    const b = p.geometry.boundingBox!;
    if (b.min.y < L.island!.seatY + 0.02 || b.min.z < 0.05) bad.push('back panel is not behind and above the seat');
    break;
  }
  if (bad.length) fail(`low-back woven: ${bad.join('; ')}`);
  else ok(`low-back woven on light wood: ${frames.length} stools, woven seat + back panel each`);

  // saddle on black metal: a scooped seat, thin legs, no back
  const L2 = computeKitchenLayout(withStools({ style: 'saddle', frame: 'black-metal', seat: 'wood' }));
  const parts2 = buildKitchenPartsRaw(L2);
  const seat = parts2.find((p) => p.key === 'isl-stoolS0')!, frame = parts2.find((p) => p.key === 'isl-stoolF0')!;
  seat.geometry.computeBoundingBox();
  const sb = seat.geometry.boundingBox!;
  const bad2: string[] = [];
  if (parts2.some((p) => /^isl-stoolB/.test(p.key))) bad2.push('a saddle grew a back');
  if (frame.util !== 'matte-black') bad2.push(`black metal frame drawn as ${frame.util}`);
  if (seat.util !== 'light-wood') bad2.push(`wood seat on a metal frame drawn as ${seat.util}`);
  if (!((sb.max.x - sb.min.x) > (sb.max.z - sb.min.z) * 1.15)) bad2.push('saddle seat is not wider than it is deep');
  if (Math.abs(sb.max.y - L2.island!.seatY) > 0.01) bad2.push(`seat top at ${sb.max.y.toFixed(3)}, seat height ${L2.island!.seatY.toFixed(3)}`);
  if (bad2.length) fail(`saddle on black metal: ${bad2.join('; ')}`);
  else ok('saddle on black metal: scooped wood seat, matte-black frame, no back');
}
{
  // the L: in a room with floor beyond the island's end, 3+ stools put one or
  // two round the end; the anchor never moves; the end stools vanish as the
  // island grows into the walkway, and never appear when the end is tight
  // a spec that predates `endSeats` (the field missing) gets the layout's own
  // guess; a spec that has it says exactly how many sit round the end (1c)
  const guessEnd = { ...base.island, present: true, seating: 4, offset: { x: 0, z: 1.5 } } as Omit<KitchenSpec['island'], 'endSeats'> & { endSeats?: number };
  delete guessEnd.endSeats;
  const wide: KitchenSpec = { ...base, dims: { ...base.dims, widthFt: 22 }, island: guessEnd as KitchenSpec['island'] };
  let prev: { cx: number; cz: number } | null = null;
  let lastEnd = Infinity;
  const bad: string[] = [];
  const seen = new Set<number>();
  for (const lengthFt of range(4, 14, 0.5)) {
    const L = computeKitchenLayout({ ...wide, island: { ...wide.island, lengthFt } });
    const isl = L.island!;
    seen.add(isl.endSeats);
    // the ANCHOR, not the drawn centre: a length that outgrows the anchor's
    // shorter side slides the body along its long axis on purpose (§9.5)
    if (prev && (Math.abs(prev.cx - isl.anchorX) > 1e-6 || Math.abs(prev.cz - isl.anchorZ) > 1e-6)) bad.push(`anchor moved at ${lengthFt} ft`);
    prev = { cx: isl.anchorX, cz: isl.anchorZ };
    if (isl.endSeats > lastEnd) bad.push(`end stools came back at ${lengthFt} ft as the island grew`);
    lastEnd = isl.endSeats;
    // clear floor beyond the end, measured against the room and the cabinetry the layout reports
    const endEdge = isl.cx + isl.endSide * (isl.topLen / 2);
    const bound = isl.endSide > 0 ? L.w / 2 - L.inset.right : -L.w / 2 + L.inset.left;
    const clear = Math.abs(bound - endEdge) - 0.6096;   // less the 24" hard aisle
    if (isl.endSeats > 0 && clear < 0.762 - 1e-6) bad.push(`end stool with only ${(clear / 0.0254).toFixed(0)}" clear at ${lengthFt} ft`);
    if (isl.endSeats === 0 && clear >= 0.762 && isl.seating >= 3) bad.push(`no end stool with ${(clear / 0.0254).toFixed(0)}" clear at ${lengthFt} ft`);
    if (isl.endSeats > 0) {
      const parts = buildKitchenPartsRaw(L);
      const endStool = parts.find((p) => p.key === `isl-stoolF${isl.seating - 1}`)!;
      const x = endStool.position![0];
      if (Math.sign(x) !== isl.endSide || Math.abs(x) < isl.topLen / 2) bad.push(`end stool at x=${x.toFixed(2)} is not past the end (${(isl.topLen / 2).toFixed(2)})`);
      const yaw = endStool.rotation![1];
      if (Math.abs(Math.abs(yaw) - Math.PI / 2) > 1e-6) bad.push('end stool does not face the island');
    }
  }
  if (!seen.has(0) || !(seen.has(1) || seen.has(2))) bad.push(`sweep never crossed the clearance (end seats seen: ${[...seen].join(',')})`);
  if (bad.length) fail(`end stools: ${bad.slice(0, 6).join('; ')}`);
  else ok(`end stools: ${[...seen].sort().join('/')} round the end across 4→14 ft, anchor fixed, only when ≥ 30" is clear`);
}

// ---------------------------------------------------------------------------
// 7b. THE ISLAND'S SLIDE — permission from geometry, not from the photo
// ---------------------------------------------------------------------------
console.log('\n7b. ISLAND SLIDE — a declared length is drawn wherever the floor can hold it');
{
  const bad: string[] = [];
  const FT2 = (m: number) => m / 0.3048;
  const base = (): KitchenSpec => {
    const k = defaultKitchen();
    k.dims = { ...k.dims, widthFt: 16, depthFt: 14 };
    k.island = { ...k.island, present: true, lengthFt: 6, widthFt: 3.5, offset: { x: 0, z: 0 }, rotationDeg: 0, seating: 2 };
    return k;
  };

  // 1. a length that fits symmetrically about the anchor is drawn there, with
  //    NO slide — the behaviour this file has always had, unchanged.
  {
    const isl = computeKitchenLayout(base()).island!;
    if (Math.abs(isl.cx - isl.anchorX) > 1e-9) bad.push(`a 6 ft island centred in a 16 ft room slid ${FT2(isl.cx - isl.anchorX).toFixed(3)} ft`);
    if (Math.abs(FT2(isl.len) - 6) > 1e-6) bad.push(`…and drew ${FT2(isl.len).toFixed(2)} ft, not 6`);
  }

  // 2. THE DEFECT. A declared length that does not fit SYMMETRICALLY about an
  //    off-centre anchor used to be cut back to twice its shorter half, even
  //    when the whole clear run had room for it: client-marble-items declares a
  //    5.5 ft island at offset.x −3.03 and the twin drew a 2.51 ft stub — the
  //    client's "in the 3d render its js a square small island". The permission
  //    to slide is GEOMETRIC now, so it does not matter whether a photo boxed
  //    the island at all (and no photo must never grant MORE freedom than a
  //    photo does, which is what gating it on truncation did).
  {
    const k = base();
    k.island.offset = { x: -4, z: 0 };
    const isl = computeKitchenLayout(k).island!;
    const anchor = isl.anchorX;
    if (FT2(isl.len) < 6 - 1e-6) bad.push(`an off-centre 6 ft island drew ${FT2(isl.len).toFixed(2)} ft with no photo box at all`);
    if (Math.abs(isl.cx - anchor) < 1e-6) bad.push('…without moving the body, which cannot be: the anchor has no room for half of it');
    // the anchor itself never moves, whatever the length asks for
    const longer = computeKitchenLayout({ ...k, island: { ...k.island, lengthFt: 9 } }).island!;
    if (Math.abs(longer.anchorX - anchor) > 1e-9) bad.push(`the anchor moved with the length (${FT2(anchor).toFixed(3)} → ${FT2(longer.anchorX).toFixed(3)} ft)`);
  }

  // 3. …and the body never leaves the floor it is allowed: the drawn top stays
  //    inside the room at every length the slider reaches.
  {
    const k = base();
    k.island.offset = { x: -4, z: 0 };
    for (const lengthFt of range(3, 16, 0.5)) {
      const L = computeKitchenLayout({ ...k, island: { ...k.island, lengthFt } });
      const isl = L.island;
      if (!isl) continue;
      if (isl.rect.minX < -L.w / 2 - 1e-6 || isl.rect.maxX > L.w / 2 + 1e-6) {
        bad.push(`at ${lengthFt} ft the top runs outside the room (${isl.rect.minX.toFixed(3)}…${isl.rect.maxX.toFixed(3)} in a ${L.w.toFixed(3)} m room)`);
        break;
      }
    }
  }
  if (bad.length) fail(`island slide: ${bad.join('; ')}`);
  else ok('island slide: a fitting length draws at the anchor with no slide; an off-centre one is drawn IN FULL (no photo box needed) by moving the body, never the anchor; and the top never leaves the room across 3→16 ft');
}

// ---------------------------------------------------------------------------
// 7c. Island SHAPE — the block is the COUNTERTOP, and it is longer than deep
// ---------------------------------------------------------------------------
console.log('\n7c. ISLAND SHAPE — the countertop is the block the client sees');
{
  const bad: string[] = [];
  const FT = (m: number) => m / 0.3048;
  const room = (isl: Partial<KitchenSpec['island']>): KitchenSpec => {
    const k = defaultKitchen();
    // a room big enough that nothing here is the aisle clamp talking
    k.dims = { ...k.dims, widthFt: 22, depthFt: 20 };
    k.island = { ...k.island, present: true, offset: { x: 0, z: 0 }, rotationDeg: 0, seating: 2, ...isl } as KitchenSpec['island'];
    return k;
  };

  // 1. `islandTopFt` IS the drawn top. Two formulas for one slab is how they
  //    drift, so the helper the gate reads is pinned to the layout's own
  //    numbers across the sliders' range.
  for (const lengthFt of [4, 6, 9]) {
    for (const widthFt of [2.5, 3.5, 4.5]) {
      for (const overhangIn of [0, 1.5, 12, 20]) {
        for (const endOverhangIn of [0, 1.5, 12]) {
          const k = room({ lengthFt, widthFt, overhangIn, endOverhangIn });
          const drawn = computeKitchenLayout(k).island!;
          const said = islandTopFt(k.island)!;
          if (Math.abs(FT(drawn.topLen) - said.len) > 1e-6 || Math.abs(FT(drawn.topWide) - said.wide) > 1e-6) {
            bad.push(`islandTopFt says ${said.len.toFixed(3)}×${said.wide.toFixed(3)} where the layout draws ${FT(drawn.topLen).toFixed(3)}×${FT(drawn.topWide).toFixed(3)} (L${lengthFt} W${widthFt} oh${overhangIn} end${endOverhangIn})`);
          }
        }
      }
    }
  }

  // 2. THE CLIENT'S ISLAND, by the numbers. client-tan declares 5.0 × 4.1 ft
  //    with the analyzer's default 12" overhang. The LENGTH is drawn exactly
  //    as declared — the 5.22 in the drawn island is the top's DEPTH (4.1 +
  //    12" + a 1.5" scribe), not a length the layout invented. Anyone reading
  //    5.22 as "the length the twin drew for a declared 5.0" is reading the
  //    wrong axis, and the real defect is right there: the block is deeper
  //    than it is long.
  {
    const k = room({ lengthFt: 5, widthFt: 4.1, overhangIn: 12, endOverhangIn: 0, stoolPitchIn: 25.75 });
    const isl = computeKitchenLayout(k).island!;
    if (Math.abs(FT(isl.len) - 5) > 1e-6) bad.push(`client-tan's declared 5.0 ft island is DRAWN ${FT(isl.len).toFixed(2)} ft long`);
    if (Math.abs(FT(isl.topLen) - 5) > 1e-6) bad.push(`…and its top is ${FT(isl.topLen).toFixed(2)} ft long`);
    if (Math.abs(FT(isl.topWide) - (4.1 + 13.5 / 12)) > 1e-6) bad.push(`…and ${FT(isl.topWide).toFixed(2)} ft deep, not widthFt + overhang + scribe`);
    if (FT(isl.topWide) <= FT(isl.topLen)) bad.push('…and the shape this pins is no longer the square the client rejected — retune the rest of this check');
  }

  // 3. So the "longer than it is wide" rule has to be measured on the top.
  //    A 6 × 4 ft island passes the declared-body reading (1.25 × 4 = 5 ≤ 6)
  //    and draws a 6.25 × 5.13 ft slab — 1.22, under the rule.
  {
    const k = room({ lengthFt: 6, widthFt: 4, overhangIn: 12 });
    const flat = room({ lengthFt: 6, widthFt: 4, overhangIn: 0 });
    if (!(implausibility(k) > 0)) bad.push('implausibility waves through a 6 × 4 ft island whose 12" overhang draws it 6.25 × 5.13 ft');
    if (implausibility(flat) > 1e-9) bad.push(`the same island with the slab flush (0" overhang) is a fine island and must score 0, not ${implausibility(flat).toFixed(3)}`);
    if (!(implausibility(room({ lengthFt: 9, widthFt: 4, overhangIn: 12 })) < 1e-9)) bad.push('…and a 9 × 4 ft island with the same overhang is an island, not a slab');
  }

  // 4. The seating overhang is searchable, and moving it moves the TOP alone:
  //    the body, the anchor and the stool pitch stay where they were. With
  //    stools along the side it is FLOORED at a foot, because a shallower one
  //    is not a shape the twin can draw (see 6) and `reconcileSpec` would undo
  //    it anyway; with no side seating the slider is free down to flush.
  {
    const seated = room({ lengthFt: 6, widthFt: 3.5, overhangIn: 12, stoolPitchIn: 26 });
    const bare = room({ lengthFt: 6, widthFt: 3.5, overhangIn: 12, seating: 0 });
    const pSeated = kitchenParams(seated, seated).find((q) => q.label === 'island.overhangIn');
    const pBare = kitchenParams(bare, bare).find((q) => q.label === 'island.overhangIn');
    if (!pSeated || !pBare) bad.push('the fit cannot see island.overhangIn at all');
    else {
      const before = computeKitchenLayout(bare).island!;
      const moved = structuredClone(bare);
      pBare.set(moved, 3);
      const after = computeKitchenLayout(moved).island!;
      if (Math.abs(pBare.get(bare) - 12) > 1e-9) bad.push(`island.overhangIn reads ${pBare.get(bare)}, not the declared 12`);
      if (Math.abs(FT(before.topWide) - FT(after.topWide) - 9 / 12) > 1e-6) bad.push(`a 12" → 3" overhang moved the top's depth by ${(FT(before.topWide) - FT(after.topWide)).toFixed(3)} ft, not 0.75`);
      for (const [what, a, b] of [['len', before.len, after.len], ['wide', before.wide, after.wide], ['topLen', before.topLen, after.topLen], ['anchorX', before.anchorX, after.anchorX], ['anchorZ', before.anchorZ, after.anchorZ], ['stoolPitch', before.stoolPitch, after.stoolPitch]] as Array<[string, number, number]>) {
        if (Math.abs(a - b) > 1e-9) bad.push(`the overhang slider moved ${what} (${FT(a).toFixed(3)} → ${FT(b).toFixed(3)} ft)`);
      }
      if (pBare.dim.min !== 0 || pBare.scan?.[0] !== 0) bad.push(`an island with no side stools must be searchable to flush (min ${pBare.dim.min}, scan from ${pBare.scan?.[0]})`);
      if (pSeated.dim.min !== 12 || pSeated.scan?.[0] !== 12) bad.push(`an island with side stools must be floored at 12" (min ${pSeated.dim.min}, scan from ${pSeated.scan?.[0]})`);
      const shallow = structuredClone(seated);
      pSeated.set(shallow, 0);
      if (Math.abs((shallow.island.overhangIn ?? 0) - 12) > 1e-9) bad.push(`the search set a seated island's overhang to ${shallow.island.overhangIn}"`);
    }
  }

  // 5. THE DOCUMENTED EXCEPTION. `islandTopFt` is what the spec ASKS for, and
  //    it deliberately skips the room clamps `buildIsland` applies — a gate on
  //    a spec has to judge the ask, or a tight room would hide an inflated one
  //    behind its own clamp. So in a room small enough to clamp, the two
  //    numbers DIVERGE, and that is pinned here rather than avoided: 1–3 above
  //    all use a 22 × 20 ft room, where they agree by construction.
  {
    const k = defaultKitchen();
    k.dims = { ...k.dims, widthFt: 12, depthFt: 20 };
    k.island = { ...k.island, present: true, offset: { x: 0, z: 0 }, rotationDeg: 90, lengthFt: 12, widthFt: 5, overhangIn: 20, endOverhangIn: 1.5, seating: 0 } as KitchenSpec['island'];
    const drawn = computeKitchenLayout(k).island!;
    const said = islandTopFt(k.island)!;
    if (Math.abs(said.wide - (5 + 21.5 / 12)) > 1e-6) bad.push(`islandTopFt should report the unclamped ask 6.79 ft, not ${said.wide.toFixed(2)}`);
    if (!(FT(drawn.topWide) < said.wide - 1)) bad.push(`a 12 ft room should clamp the drawn top well under the ask (drew ${FT(drawn.topWide).toFixed(2)} against ${said.wide.toFixed(2)})`);
    if (Math.abs(FT(drawn.topLen) - said.len) > 1e-6) bad.push(`the clamp is on the DEPTH only — the length still agrees (${FT(drawn.topLen).toFixed(2)} vs ${said.len.toFixed(2)})`);
  }

  // 6. A side stool never stands inside the cabinet. `stoolPositions` tucks it
  //    3" under the top's front edge, so at a shallow overhang the seat would
  //    be drawn INSIDE the carcass — 10.1" in at a flush top, which is where
  //    the fit used to land two of the four client fixtures.
  {
    const worst: string[] = [];
    for (const overhangIn of [0, 3, 6, 9, 12, 15, 20]) {
      const k = room({ lengthFt: 8, widthFt: 4, overhangIn, seating: 3, endSeats: 0 });
      const isl = computeKitchenLayout(k).island!;
      const side = stoolPositions(isl).slice(0, 3);
      for (const [, z] of side) {
        // the seat's own reach at the island (the turned disc's rim, 0.181 m)
        const clear = Math.abs(z) - isl.wide / 2 - 0.181;
        if (clear < -1e-9) worst.push(`at a ${overhangIn}" overhang a side stool's seat is ${(-clear / 0.0254).toFixed(1)}" inside the carcass`);
      }
      // and above the reconciler's floor the row is exactly where the spec puts it
      if (overhangIn >= 12 && Math.abs(Math.abs(side[0][1]) - (isl.wide / 2 + isl.overhang - 0.0254 * 3)) > 1e-9) worst.push(`the clamp moved a ${overhangIn}" row that was already clear`);
    }
    if (worst.length) bad.push(worst.join('; '));
  }
  if (bad.length) fail(`island shape: ${bad.join('; ')}`);
  else ok('island shape: islandTopFt is the drawn top across 36 specs (and diverges from it, by design, only where the room clamps); client-tan draws its declared 5.0 ft length and a 5.22 ft DEEP top; implausibility reads the slab; the overhang slider moves the top alone, is floored at 12" when stools sit along the side, and no stool is ever drawn inside the carcass');
}

// ---------------------------------------------------------------------------
// 8. Client fixtures — real analyzer output through the whole twin
// ---------------------------------------------------------------------------
console.log('\n8. CLIENT FIXTURES — unique keys, declared widths kept, talls on their slot');

const loadFixture = (name: string): KitchenSpec => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')) as { spec?: KitchenSpec } & KitchenSpec;
  return (raw.spec ?? raw) as KitchenSpec;
};
const marble = loadFixture('client-marble.spec.json');
const shelves = loadFixture('client-shelves.spec.json');

/** No two parts may share a key: React drops one of two children with the same key, and a cabinet silently vanishes. */
const uniqueKeys = (label: string, spec: KitchenSpec) => {
  const L = computeKitchenLayout(spec);
  const dups = new Map<string, number>();
  for (const p of buildKitchenParts(L)) dups.set(p.key, (dups.get(p.key) ?? 0) + 1);
  const twice = [...dups.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
  if (twice.length) fail(`${label}: duplicate part keys ${twice.slice(0, 5).join(', ')}`);
  else ok(`${label}: ${dups.size} unique part keys`);
};
uniqueKeys('demo kitchen', base);
uniqueKeys('décor stress kitchen', scenarios.find(([l]) => l.startsWith('décor stress'))![1]);
uniqueKeys('packed 24-cabinet runs', { ...base, runs: [packedRun('back', 16), packedRun('left', 14)] });
uniqueKeys('client-marble fixture', marble);
uniqueKeys('client-shelves fixture', shelves);
// and inside the geometry budget, like the demo battery in section 3
for (const [label, spec] of [['client-marble fixture', marble], ['client-shelves fixture', shelves]] as const) {
  const b = kitchenGeometryBudget(computeKitchenLayout(spec));
  if (b.drawCalls > 900 || b.triangles > 1_200_000) fail(`${label}: OVER BUDGET — ${b.drawCalls} draws, ${b.triangles.toLocaleString()} tris`);
  else ok(`${label}: ${b.drawCalls} draws, ${b.triangles.toLocaleString()} tris inside the budget`);
}

// a cabinet split in two by a cut keeps two distinct keys (a wide upper
// straddling the hood is the everyday case; the window is taken away so the
// row lands under the hood the way the analyzer listed it)
{
  const spec: KitchenSpec = {
    ...base,
    openings: base.openings.filter((o) => o.kind !== 'window'),
    runs: base.runs.map((r) => (r.id === 'run-back'
      ? { ...r, uppers: [{ widthIn: 36, type: 'door' as const }, { widthIn: 24, type: 'door' as const }, { widthIn: 36, type: 'appliance-gap' as const }, { widthIn: 96, type: 'door' as const }] }
      : r)),
  };
  const L = computeKitchenLayout(spec);
  const run = L.runs.find((r) => r.id === 'run-back')!;
  const split = run.uppers.filter((u) => /f\d$/.test(u.id));
  const ids = new Set(run.uppers.map((u) => u.id));
  if (ids.size !== run.uppers.length) fail(`split upper: duplicate ids ${run.uppers.map((u) => u.id).join(' ')}`);
  else if (split.length < 2) fail(`split upper: expected two suffixed pieces round the hood, got ${run.uppers.map((u) => u.id).join(' ')}`);
  else ok(`split upper: ${split.map((u) => u.id).join(' + ')} round the hood, all ${ids.size} ids unique`);
}

// the marble kitchen: the analyzer listed run-left as [30" drawers, 36" sink
// base, 18" door, 24" dishwasher gap] with an 18" pantry near the corner.
// The old fit carved the drawer stack into two 7" fillers (with one id) and
// stretched the sink to 39". A real kitchen keeps its cabinets.
{
  const L = computeKitchenLayout(marble);
  const left = L.runs.find((r) => r.id === 'run-left')!;
  const inches = (m: number) => m / 0.0254;
  const bad: string[] = [];
  const first = left.base[0];
  if (!first || first.type !== 'drawers' || inches(first.width) < 27) bad.push(`first cabinet is ${first ? `${inches(first.width).toFixed(0)}" ${first.type}` : 'missing'}, expected a ≥ 27" drawer stack`);
  const sink = left.base.find((b) => b.type === 'sink-base');
  if (!sink || inches(sink.width) < 33 || inches(sink.width) > 39) bad.push(`sink base ${sink ? `${inches(sink.width).toFixed(0)}"` : 'missing'}, expected 33–39"`);
  const gap = left.base.find((b) => b.type === 'appliance-gap' || b.filledBy === 'dishwasher');
  if (!gap || Math.abs(inches(gap.width) - 24) > 0.5) bad.push(`dishwasher gap ${gap ? `${inches(gap.width).toFixed(0)}"` : 'missing'}, expected 24"`);
  const wallOut = left.x1 >= left.wallLen / 2 - 0.01;
  const wide = left.base.filter((b) => b.type === 'filler' && inches(b.width) > 6);
  if (wide.length && !wallOut) bad.push(`filler ${inches(wide[0].width).toFixed(0)}" wide with wall to spare`);
  const pantry = left.tall.find((t) => t.kind === 'pantry');
  if (!pantry) bad.push('pantry missing');
  else if (pantry.x0 - left.x0 > 0.01) bad.push(`pantry ${inches(pantry.x0 - left.x0).toFixed(1)}" off the run start (a scribe nobody builds)`);
  // declared widths within measuring error (±3") on every real cabinet
  const declared = [30, 36, 18, 24];
  const real = left.base.filter((b) => b.type !== 'filler');
  real.forEach((b, i) => { if (declared[i] !== undefined && Math.abs(inches(b.width) - declared[i]) > 3) bad.push(`${b.type} ${inches(b.width).toFixed(0)}" vs declared ${declared[i]}"`); });
  if (bad.length) fail(`client-marble run-left: ${bad.join('; ')}`);
  else ok(`client-marble run-left: ${left.base.map((b) => `${inches(b.width).toFixed(0)}" ${b.type}`).join(', ')} after an ${inches(pantry!.width).toFixed(0)}" pantry, run ${inches(left.length).toFixed(0)}" of a ${inches(left.wallLen).toFixed(0)}" wall`);
  // the built-in fridge sits in its surround on the short back run, and the
  // surround is on the tall slot
  const sur = L.runs.flatMap((r) => r.tall).find((t) => t.kind === 'fridge-surround');
  const fridge = L.appliances.find((a) => a.kind === 'fridge');
  const parts = buildKitchenPartsRaw(L);
  const surParts = sur ? parts.filter((p) => p.key.startsWith(`${sur.id}-`) && p.slot && p.slot !== 'hardware') : [];
  if (!sur || !fridge || !sur.filled || Math.abs(sur.cx - fridge.x) > 0.01) fail(`client-marble fridge: ${sur ? (sur.filled ? 'surround off the fridge' : 'surround empty') : 'no surround'}`);
  else if (surParts.some((p) => p.slot !== 'cabinets_tall')) fail(`client-marble surround on ${surParts.find((p) => p.slot !== 'cabinets_tall')!.slot}`);
  else ok(`client-marble fridge: built-in inside a ${inches(sur.width).toFixed(0)}" surround, ${surParts.length} surround parts on cabinets_tall`);
}

// a corner pull-back shifts the guest run along the wall: cabinets keep
// their widths, and when the corner leaves no room for the dishwasher gap
// the doors before it give way — never the gap
{
  const spec: KitchenSpec = {
    ...marble,
    runs: marble.runs.map((r) => (r.id === 'run-left' ? { ...r, start: 4.5 / 14, tall: [] } : r)),
  };
  const L = computeKitchenLayout(spec);
  const left = L.runs.find((r) => r.id === 'run-left')!;
  const inches = (m: number) => m / 0.0254;
  const bad: string[] = [];
  if (!left.pulledHi) bad.push('run does not meet the corner');
  const gap = left.base.find((b) => b.type === 'appliance-gap' || b.filledBy === 'dishwasher');
  if (!gap || Math.abs(inches(gap.width) - 24) > 0.5) bad.push(`dishwasher gap ${gap ? `${inches(gap.width).toFixed(0)}"` : 'lost'}`);
  const sink = left.base.find((b) => b.type === 'sink-base');
  if (!sink || inches(sink.width) < 33) bad.push(`sink base ${sink ? `${inches(sink.width).toFixed(0)}"` : 'lost'}`);
  if (left.base[0]?.type !== 'drawers' || inches(left.base[0].width) < 27) bad.push(`first cabinet ${left.base[0] ? `${inches(left.base[0].width).toFixed(0)}" ${left.base[0].type}` : 'missing'}`);
  if (bad.length) fail(`corner pull-back: ${bad.join('; ')}`);
  else ok(`corner pull-back: ${left.base.map((b) => `${inches(b.width).toFixed(0)}" ${b.type}`).join(', ')} up to the pulled corner`);
}


// ---------------------------------------------------------------------------
// 9. CABINET ABOVE THE HOOD
//
// The client: "above the vent, there are always cabinets but the 3d model
// never renders them." The band between the canopy and the crown is a real
// wall cabinet on `cabinets_upper` — clickable, swappable, priced — and the
// crown runs straight across it. A hood with nothing above it is untouched.
// ---------------------------------------------------------------------------
console.log('\n9. CABINET ABOVE THE HOOD — a real wall cabinet on the canopy');

const hoodCabOf = (L: KitchenLayoutData) => {
  const hood = L.appliances.find((a) => a.kind === 'hood')!;
  const run = L.runs.find((r) => r.id === hood.runId) ?? null;
  const piece = run?.uppers.find((u) => u.type === 'hood-cabinet') ?? null;
  return { hood, run, piece };
};

{
  // 1. the demo: 'doors' on a chimney/tapered hood over the back run
  const L = computeKitchenLayout(base);
  const { hood, run, piece } = hoodCabOf(L);
  const bad: string[] = [];
  const pieces = run!.uppers.filter((u) => u.type === 'hood-cabinet');
  if (pieces.length !== 1) bad.push(`${pieces.length} hood-cabinet pieces, expected 1`);
  if (!piece) bad.push('no hood cabinet');
  else {
    if (Math.abs(piece.x0 - (hood.x - hood.width / 2 - 0.005)) > 1e-6) bad.push(`piece x0 ${piece.x0.toFixed(4)} vs hood ${(hood.x - hood.width / 2 - 0.005).toFixed(4)}`);
    if (Math.abs(piece.x1 - (hood.x + hood.width / 2 + 0.005)) > 1e-6) bad.push(`piece x1 ${piece.x1.toFixed(4)}`);
    if (Math.abs(piece.bottom - hoodExtents(hood).canopyTop) > 1e-6) bad.push('the cabinet does not sit on the canopy');
    const band = (run!.upperTop - piece.bottom) / IN;
    if (Math.abs(band - 10.0) > 0.1) bad.push(`band ${band.toFixed(2)}", expected 10.0"`);
    if (hood.cabinetAbove !== 'doors') bad.push(`cabinetAbove ${hood.cabinetAbove}`);
    if (hood.cabinetBottom !== piece.bottom) bad.push('cabinetBottom disagrees with the drawn piece');
    if (hoodExtents(hood).top !== piece.bottom) bad.push('the hood unit does not end under the cabinet');
    if (piece.contents !== null) bad.push(`a hood cabinet was given contents (${piece.contents})`);
  }
  if (bad.length) fail(`hood cabinet (demo): ${bad.join('; ')}`);
  else ok(`hood cabinet (demo): one 'doors' piece at the hood span, ${((run!.upperTop - piece!.bottom) / IN).toFixed(1)}" band sitting on the canopy`);
}

{
  // 2. parts: the box spans canopy → crown line, two doors, and NO flue
  const L = computeKitchenLayout(base);
  const { hood, run, piece } = hoodCabOf(L);
  const parts = buildKitchenPartsRaw(L);
  const bad: string[] = [];
  const box = bboxOf(parts, `${piece!.id}-box`);
  if (!box) bad.push('no cabinet box part');
  else {
    if (!near(box.min.y, piece!.bottom)) bad.push(`box bottom ${box.min.y.toFixed(3)} vs ${piece!.bottom.toFixed(3)}`);
    if (!near(box.max.y, run!.upperTop)) bad.push(`box top ${box.max.y.toFixed(3)} vs ${run!.upperTop.toFixed(3)}`);
  }
  const doors = parts.filter((p) => p.key.startsWith(`${piece!.id}-f`) && /-f\d+$/.test(p.key));
  if (doors.length !== 2) bad.push(`${doors.length} door fronts on a ${(piece!.width / IN).toFixed(0)}" piece, expected 2`);
  if (doors.some((p) => p.slot !== 'cabinets_upper')) bad.push('a door front is not on cabinets_upper');
  if (parts.some((p) => p.key === `${hood.id}-flue`)) bad.push('a flue is drawn behind the cabinet');
  if (parts.some((p) => p.key === `${hood.id}-flueseam`)) bad.push('a flue seam is drawn behind the cabinet');
  const canopy = bboxOf(parts, `${hood.id}-canopy`);
  if (!canopy || !near(canopy.min.y, hood.y, 0.004)) bad.push('the canopy moved');
  if (bad.length) fail(`hood cabinet parts: ${bad.join('; ')}`);
  else ok(`hood cabinet parts: box ${(piece!.bottom).toFixed(3)}→${run!.upperTop.toFixed(3)}, ${doors.length} doors on cabinets_upper, no flue, canopy untouched`);
}

{
  // 3. trim: the crown runs straight across, no light rail under the box
  const L = computeKitchenLayout(base);
  const { hood, run, piece } = hoodCabOf(L);
  const parts = buildKitchenPartsRaw(L);
  const bad: string[] = [];
  const crowns = parts.filter((p) => /^run-back-crown\d+$/.test(p.key)).map((p) => bboxOf(parts, p.key)!);
  const across = crowns.filter((b) => b.min.x <= hood.x - 0.2 + 1e-3 && b.max.x >= hood.x + 0.2 - 1e-3);
  if (across.length !== 1) bad.push(`${across.length} crown runs cover the hood span, expected 1 continuous one`);
  const rails = parts.filter((p) => /^run-back-rail\d+$/.test(p.key)).map((p) => bboxOf(parts, p.key)!);
  if (rails.some((b) => b.min.x < piece!.x1 - 0.02 && b.max.x > piece!.x0 + 0.02)) bad.push('a light rail hangs under the cabinet on the canopy');
  if (run!.underCab.some(([a, b]) => a < piece!.x1 - 0.02 && b > piece!.x0 + 0.02)) bad.push('an under-cabinet LED run crosses the hood');
  if (bad.length) fail(`hood cabinet trim: ${bad.join('; ')}`);
  else ok(`hood cabinet trim: one continuous crown across the hood, no rail and no LED strip under the box`);
}

{
  // 4. what the photo fitter measures: the hood box tops at the cabinet, the
  //    upper-run box runs continuously across it
  const L = computeKitchenLayout(base);
  const { hood, piece } = hoodCabOf(L);
  const boxes = kitchenElementBoxes(L);
  const bad: string[] = [];
  const hoodBox = boxes.find((b) => b.kind === 'hood');
  if (!hoodBox) bad.push('no hood box');
  else if (Math.abs(hoodBox.box.max[1] - piece!.bottom) > 0.01) bad.push(`hood box tops at ${hoodBox.box.max[1].toFixed(3)}, cabinet underside ${piece!.bottom.toFixed(3)}`);
  // the row box is in WORLD x; on the back wall that is the wall-local x
  const rowBox = boxes.filter((b) => b.kind === 'upper-cabinet-run' && b.wall === 'back')
    .find((b) => b.box.min[0] <= hood.x && b.box.max[0] >= hood.x);
  if (!rowBox) bad.push('no back-wall upper-cabinet-run box over the hood');
  else if (rowBox.box.max[0] < piece!.x1 - 0.01) bad.push(`the row box stops at ${rowBox.box.max[0].toFixed(3)} before the cabinet's ${piece!.x1.toFixed(3)}`);
  if (bad.length) fail(`hood cabinet boxes: ${bad.join('; ')}`);
  else ok('hood cabinet boxes: the hood box tops at the cabinet, the upper-run box runs across it');
}

{
  // 5/6. 'none' and a null on a chimney are the same kitchen, and the old one
  const explicit = computeKitchenLayout(withHood({ cabinetAbove: 'none' }));
  const derived = computeKitchenLayout(withHood({ cabinetAbove: null, hoodStyle: 'chimney' }));
  const { hood, run } = hoodCabOf(explicit);
  const parts = buildKitchenPartsRaw(explicit);
  const bad: string[] = [];
  const gaps = run!.uppers.filter((u) => u.type === 'hood-gap');
  if (gaps.length !== 1) bad.push(`${gaps.length} hood-gap pieces, expected 1`);
  else if (Math.abs(gaps[0].bottom - run!.upperBottom) > 1e-6) bad.push('the void does not start at the row bottom');
  if (run!.uppers.some((u) => u.type === 'hood-cabinet')) bad.push("'none' still drew a cabinet");
  const flue = bboxOf(parts, `${hood.id}-flue`);
  if (!flue) bad.push('no flue');
  else if (!near(flue.max.y, explicit.h)) bad.push(`flue tops at ${flue.max.y.toFixed(3)}, ceiling ${explicit.h.toFixed(3)}`);
  if (hoodExtents(hood).top !== explicit.h) bad.push('the unit does not reach the ceiling');
  const crowns = parts.filter((p) => /^run-back-crown\d+$/.test(p.key)).map((p) => bboxOf(parts, p.key)!);
  // the crown's mitred return projects ~2.5" past the span it caps
  const returns = gaps.length ? crowns.filter((b) => Math.abs(b.max.x - gaps[0].x0) < 0.08 || Math.abs(b.min.x - gaps[0].x1) < 0.08) : [];
  if (gaps.length && returns.length < 2) bad.push(`the crown does not return on each side of the void (${returns.length})`);
  const diff = diffKeys(snapshot(explicit), snapshot(derived));
  if (diff.length) bad.push(`a null cabinetAbove on a chimney differs from 'none': ${diff.slice(0, 4).join(', ')}`);
  if (bad.length) fail(`hood 'none': ${bad.join('; ')}`);
  else ok("hood 'none': one void at the row bottom, flue to the ceiling, crown returning each side; a null on a chimney is identical");
}

{
  // 7. an under-cabinet hood with a tapered canopy derives 'doors'
  const L = computeKitchenLayout(withHood({ hoodStyle: 'under-cabinet', hoodShape: 'tapered', cabinetAbove: null }));
  const { hood, piece } = hoodCabOf(L);
  const parts = buildKitchenPartsRaw(L);
  const bad: string[] = [];
  if (hood.cabinetAbove !== 'doors') bad.push(`derived ${hood.cabinetAbove}, expected doors`);
  if (!piece) bad.push('no cabinet drawn');
  else if (Math.abs(piece.bottom - hoodExtents(hood).canopyTop) > 1e-6) bad.push('the cabinet does not sit on the canopy');
  if (parts.some((p) => p.key === `${hood.id}-flue`)) bad.push('a flue was drawn');
  if (bad.length) fail(`under-cabinet + tapered, null: ${bad.join('; ')}`);
  else ok('under-cabinet + tapered, null → doors on the canopy, no flue');
}

{
  // 8/9. a VISIBLE duct cover: heightIn lifts the cabinet and the flue spans the gap
  const L = computeKitchenLayout(withHood({ cabinetAbove: 'doors', heightIn: 17 }));
  const { hood, run, piece } = hoodCabOf(L);
  const parts = buildKitchenPartsRaw(L);
  const bad: string[] = [];
  if (!piece) bad.push('no cabinet');
  else {
    if (Math.abs(piece.bottom - (hood.y + 17 * IN)) > 1e-6) bad.push(`cabinet underside ${((piece.bottom - hood.y) / IN).toFixed(1)}" over the mouth, expected 17"`);
    const band = (run!.upperTop - piece.bottom) / IN;
    if (band >= 9) bad.push(`band ${band.toFixed(1)}" is not the short one this case is about`);
    if (hood.cabinetAbove !== 'panel') bad.push(`a ${band.toFixed(1)}" band drew '${hood.cabinetAbove}', expected panel`);
    if (!parts.some((p) => p.key === `${piece.id}-panel`)) bad.push('no flat panel front');
    if (parts.some((p) => /^run-back-hood-f\d+$/.test(p.key))) bad.push('a short band still got doors');
    const flue = bboxOf(parts, `${hood.id}-flue`);
    if (!flue) bad.push('no flue across the visible gap');
    else if (!near(flue.min.y, hood.y + hood.height) || !near(flue.max.y, piece.bottom)) bad.push(`flue spans ${flue.min.y.toFixed(3)}→${flue.max.y.toFixed(3)}, expected ${(hood.y + hood.height).toFixed(3)}→${piece.bottom.toFixed(3)}`);
  }
  // 60" would put the cabinet through the crown: it is held to a 4" band
  const tall = computeKitchenLayout(withHood({ cabinetAbove: 'doors', heightIn: 60 }));
  const t = hoodCabOf(tall);
  if (!t.piece) bad.push('a 60" hood lost its cabinet entirely');
  else if (Math.abs((t.run!.upperTop - t.piece.bottom) - 4 * IN) > 1e-6) bad.push(`clamped band ${((t.run!.upperTop - t.piece.bottom) / IN).toFixed(2)}", expected 4"`);
  if (bad.length) fail(`hood cabinet over a visible duct: ${bad.join('; ')}`);
  else ok('hood cabinet over a visible duct: 17" lifts it, the 7" band becomes a panel, the flue spans the gap; 60" is held to a 4" band');
}

{
  // 10. a wood canopy: the chase is replaced by the cabinet
  const bad: string[] = [];
  const short = computeKitchenLayout(withHood({ hoodStyle: 'custom-insert', hoodShape: 'wood-canopy', cabinetAbove: null }));
  const s = hoodCabOf(short);
  const sParts = buildKitchenPartsRaw(short);
  const sBand = s.piece ? (s.run!.upperTop - s.piece.bottom) / IN : 0;
  if (!s.piece) bad.push('no cabinet on the wood canopy');
  else {
    if (sBand >= 9) bad.push(`band ${sBand.toFixed(1)}" — this case is about the short one`);
    if (short.appliances.find((a) => a.kind === 'hood')!.cabinetAbove !== 'panel') bad.push(`a ${sBand.toFixed(1)}" band drew doors`);
    const panel = sParts.find((p) => p.key === `${s.piece!.id}-panel`);
    if (!panel) bad.push('no panel front');
    else if (panel.slot !== 'cabinets_upper') bad.push(`panel on the ${panel.slot} slot`);
    if (sParts.some((p) => p.key === `${s.hood.id}-flue`)) bad.push('the chase is still drawn under the cabinet');
  }
  // with the uppers to the ceiling the band is a real cabinet with doors
  const tallSpec: KitchenSpec = { ...withHood({ hoodStyle: 'custom-insert', hoodShape: 'wood-canopy', cabinetAbove: null }), runs: base.runs.map((r) => ({ ...r, uppersToCeiling: true })) };
  const tall = computeKitchenLayout(tallSpec);
  const t = hoodCabOf(tall);
  const tBand = t.piece ? (t.run!.upperTop - t.piece.bottom) / IN : 0;
  if (!t.piece) bad.push('uppers to the ceiling: no cabinet');
  else {
    if (tBand < 9) bad.push(`uppers to the ceiling: band only ${tBand.toFixed(1)}"`);
    if (t.hood.cabinetAbove !== 'doors') bad.push(`a ${tBand.toFixed(1)}" band drew ${t.hood.cabinetAbove}, expected doors`);
    const doors = buildKitchenPartsRaw(tall).filter((p) => /^run-back-hood-f\d+$/.test(p.key));
    if (doors.length !== 2) bad.push(`${doors.length} doors on the tall band`);
  }
  // a chimney-style wood canopy still runs its chase to the top of the uppers
  const chimney = computeKitchenLayout(withHood({ hoodStyle: 'chimney', hoodShape: 'wood-canopy', cabinetAbove: null }));
  const c = hoodCabOf(chimney);
  if (c.hood.cabinetAbove !== 'none') bad.push(`chimney + wood canopy resolved ${c.hood.cabinetAbove}`);
  const chase = bboxOf(buildKitchenPartsRaw(chimney), `${c.hood.id}-flue`);
  if (!chase) bad.push('chimney + wood canopy: no chase');
  else if (!near(chase.max.y, c.run!.upperTop)) bad.push(`chase tops at ${chase.max.y.toFixed(3)}, uppers at ${c.run!.upperTop.toFixed(3)}`);
  if (bad.length) fail(`wood canopy: ${bad.join('; ')}`);
  else ok(`wood canopy: a ${sBand.toFixed(1)}" band is a panel with no chase, a ${tBand.toFixed(1)}" band is two doors, a chimney one still chases to the uppers`);
}

{
  // 11. no row of uppers over the hood → nothing above it, whatever the word says
  const bad: string[] = [];
  const noRow = computeKitchenLayout({
    ...withHood({ hoodStyle: 'custom-insert', hoodShape: 'curved', cabinetAbove: 'doors' }),
    runs: base.runs.map((r) => (r.wall === 'back' ? { ...r, hasUppers: false } : r)),
  });
  const nh = noRow.appliances.find((a) => a.kind === 'hood')!;
  if (nh.cabinetAbove !== 'none') bad.push(`cabinetAbove ${nh.cabinetAbove} with no row`);
  if (nh.cabinetBottom !== null) bad.push('a cabinet underside with no row');
  if (hoodExtents(nh).top !== noRow.h) bad.push('the flue does not reach the ceiling');
  if (noRow.runs.some((r) => r.uppers.some((u) => u.type === 'hood-cabinet'))) bad.push('a hood cabinet was drawn with no row');
  // the shelves fixture is the same shape in real client data
  const shelves = computeKitchenLayout(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'client-shelves.spec.json'), 'utf8')) as KitchenSpec);
  const sh = shelves.appliances.find((a) => a.kind === 'hood');
  if (sh && sh.cabinetAbove !== 'none') bad.push(`client-shelves hood resolved ${sh.cabinetAbove}`);
  if (shelves.runs.some((r) => r.uppers.some((u) => u.type === 'hood-cabinet'))) bad.push('client-shelves grew a hood cabinet');
  if (bad.length) fail(`hood with no row of uppers: ${bad.join('; ')}`);
  else ok('hood with no row of uppers: nothing above it, flue to the ceiling (client-shelves too)');
}

{
  // 12. a slim insert is unchanged; a void declared over it IS the cabinet it hangs from
  const bad: string[] = [];
  for (const word of [null, 'doors', 'none'] as const) {
    const L = computeKitchenLayout(withHood({ hoodStyle: 'under-cabinet', hoodShape: 'slim', cabinetAbove: word }));
    const { hood, run } = hoodCabOf(L);
    const parts = buildKitchenPartsRaw(L);
    if (Math.abs(hood.y - L.upperBottom) > 1e-6) bad.push(`${word}: the insert left the underside of the uppers`);
    if (Math.abs(hood.height - 6 * IN) > 1e-6) bad.push(`${word}: canopy ${(hood.height / IN).toFixed(1)}"`);
    if (hoodExtents(hood).top !== hood.y + hood.height) bad.push(`${word}: the insert grew a duct`);
    const own = parts.filter((p) => p.key.startsWith(`${hood.id}-`)).map((p) => p.key.replace(`${hood.id}-`, '')).sort();
    if (own.join(',') !== 'body,filter,strip') bad.push(`${word}: insert parts ${own.join(',')}`);
    const cab = run!.uppers.find((u) => u.type === 'hood-cabinet');
    if (word === 'none') {
      if (cab) bad.push("none: a cabinet was drawn over the insert");
      if (run!.uppers.some((u) => u.type === 'hood-gap')) bad.push('none: the declared void is still a hole');
    } else if (!cab) bad.push(`${word}: the declared void over the insert did not become the cabinet`);
    else {
      if (Math.abs(cab.bottom - (hood.y + hood.height)) > 1e-6) bad.push(`${word}: the cabinet does not sit on the insert`);
      const doors = parts.filter((p) => new RegExp(`^${cab.id}-f\\d+$`).test(p.key));
      if (doors.length !== 2) bad.push(`${word}: ${doors.length} doors on the ${(cab.width / IN).toFixed(0)}" box`);
    }
  }
  // a run whose uppers are all real cabinets keeps them untouched under an insert
  const real: KitchenSpec = {
    ...withHood({ hoodStyle: 'under-cabinet', hoodShape: 'slim', cabinetAbove: 'doors' }),
    runs: base.runs.map((r) => (r.id === 'run-back'
      ? { ...r, uppers: (r.uppers ?? []).map((u) => (u.type === 'hood-gap' || u.type === 'appliance-gap' ? { ...u, type: 'door' as const } : u)) }
      : r)),
  };
  const L2 = computeKitchenLayout(real);
  const overSlim = L2.runs.find((r) => r.id === 'run-back')!.uppers.filter((u) => u.type === 'hood-cabinet');
  if (overSlim.length) bad.push('a real door over a slim insert was converted');
  if (bad.length) fail(`slim insert: ${bad.join('; ')}`);
  else ok('slim insert: 6" body under the uppers, no duct, the declared void becomes the cabinet it hangs from, a real door stays a door');
}

{
  // 13. a DERIVED 'doors' between glass neighbours draws glass; an explicit one stays solid
  // a run built so the hood genuinely lands BETWEEN two glass cabinets
  const glassRun = (p: Partial<KitchenSpec['appliances'][number]>): KitchenSpec => {
    const s = withHood({ hoodStyle: 'under-cabinet', hoodShape: 'tapered', ...p });
    return {
      ...s,
      appliances: s.appliances.filter((a) => a.kind === 'hood' || a.kind === 'range').map((a) => ({ ...a, t: 0.5 })),
      openings: [],
      runs: [{
        id: 'run-back', wall: 'back', start: 0, lengthFt: 16,
        base: [{ widthIn: 60, type: 'door', drawerCount: 1 }, { widthIn: 30, type: 'appliance-gap', drawerCount: 0 }, { widthIn: 60, type: 'door', drawerCount: 1 }],
        uppers: [{ widthIn: 60, type: 'glass', heightIn: null }, { widthIn: 30, type: 'hood-gap', heightIn: null }, { widthIn: 60, type: 'glass', heightIn: null }],
        tall: [], hasUppers: true, uppersToCeiling: false, backsplash: true, upperHeightIn: null,
      }],
      island: { ...s.island, present: false },
      decor: { ...s.decor, shelves: [], plants: [], art: [], items: [], cabinetContents: [] },
    };
  };
  const bad: string[] = [];
  const derived = computeKitchenLayout(glassRun({ cabinetAbove: null }));
  const d = hoodCabOf(derived);
  if (!d.piece) bad.push('derived: no cabinet');
  else {
    if (d.piece.hood?.front !== 'glass') bad.push(`derived front ${d.piece.hood?.front} between glass neighbours`);
    if (!buildKitchenPartsRaw(derived).some((p) => p.key === `${d.piece!.id}-bk`)) bad.push('derived: no glass back panel');
  }
  const explicit = computeKitchenLayout(glassRun({ cabinetAbove: 'doors' }));
  const e = hoodCabOf(explicit);
  if (!e.piece) bad.push('explicit: no cabinet');
  else if (e.piece.hood?.front !== 'doors') bad.push(`an explicit 'doors' turned into ${e.piece.hood?.front}`);
  if (bad.length) fail(`hood cabinet fronts: ${bad.join('; ')}`);
  else ok("hood cabinet fronts: a derived 'doors' between glass neighbours goes glass, an explicit one stays solid");
}

{
  // 14. a declared void nothing landed under is a cabinet, not a hole
  const bad: string[] = [];
  const demo = computeKitchenLayout(base);
  const back = demo.runs.find((r) => r.id === 'run-back')!;
  const sliver = back.uppers.find((u) => u.width < 12 * IN && u.x1 <= back.uppers.find((q) => q.type === 'hood-cabinet')!.x0 + 1e-6);
  if (!sliver) bad.push('the demo lost its sliver beside the hood');
  else if (sliver.type !== 'filler') bad.push(`the ${(sliver.width / IN).toFixed(1)}" sliver beside the hood is a ${sliver.type}, not a filler`);
  // a 30" void declared a metre and a half away from the range
  const stray: KitchenSpec = {
    ...base,
    runs: base.runs.map((r) => (r.id === 'run-back'
      ? { ...r, uppers: [{ widthIn: 30, type: 'hood-gap' as const, heightIn: null }, ...(r.uppers ?? []).filter((u) => u.type !== 'hood-gap')] }
      : r)),
  };
  const L = computeKitchenLayout(stray);
  const row = L.runs.find((r) => r.id === 'run-back')!;
  const strayVoid = row.uppers.filter((u) => u.type === 'hood-gap' && u.x1 < L.appliances.find((a) => a.kind === 'hood')!.x - 0.5);
  if (strayVoid.length) bad.push(`${strayVoid.length} stray void(s) left as holes`);
  if (!row.uppers.some((u) => u.type === 'hood-cabinet')) bad.push('the hood span did not become the explicit piece');
  if (bad.length) fail(`unclaimed voids: ${bad.join('; ')}`);
  else ok(`unclaimed voids: the demo's ${(sliver!.width / IN).toFixed(1)}" sliver is a filler, a stray 30" void becomes a cabinet, the hood keeps its own piece`);
}

{
  // 15. the marble fixture: the hood is bare ('none') and the row reaches it
  const marbleSpec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'client-marble.spec.json'), 'utf8')) as KitchenSpec;
  const L = computeKitchenLayout(marbleSpec);
  const run = L.runs.find((r) => r.id === 'run-back-main')!;
  const bad: string[] = [];
  if (run.ux1 < 1.73) bad.push(`run-back-main.ux1 ${run.ux1.toFixed(3)}, expected ≥ 1.73`);
  const gap = run.uppers.find((u) => u.type === 'hood-gap');
  if (!gap) bad.push('no hood void in the row');
  else if (Math.abs(gap.x0 - 0.818) > 0.01 || Math.abs(gap.x1 - 1.732) > 0.01) bad.push(`hood void ${gap.x0.toFixed(3)}…${gap.x1.toFixed(3)}, expected ≈0.818…1.732`);
  const stray = run.uppers.find((u) => u.x0 < -0.60 && u.x1 > 0.29);
  if (!stray) bad.push('the 36" piece at −0.61…0.305 is gone');
  else if (stray.type !== 'glass') bad.push(`the stray 36" hole is a ${stray.type}, expected glass`);
  const sliver = run.uppers.find((u) => u.x0 > 0.29 && u.x1 < 0.83);
  if (!sliver || sliver.type !== 'glass') bad.push(`the 20.2" glass sliver is ${sliver ? sliver.type : 'gone'}`);
  const hood = L.appliances.find((a) => a.kind === 'hood')!;
  if (hood.cabinetAbove !== 'none') bad.push(`the marble hood resolved ${hood.cabinetAbove}`);
  if (hood.runId !== 'run-back-main') bad.push(`the marble hood hangs on ${hood.runId}`);
  if (bad.length) fail(`client-marble uppers: ${bad.join('; ')}`);
  else ok(`client-marble uppers: row to ${run.ux1.toFixed(3)} m, void ${gap!.x0.toFixed(3)}…${gap!.x1.toFixed(3)}, the stray 36" hole is a glass cabinet, the 20" sliver survives`);
}

// sweeps: the cabinet may follow the hood, nothing else may
{
  const cabKeyOf = (L: KitchenLayoutData) => {
    const run = L.runs.find((r) => r.id === 'run-back')!;
    const i = run.uppers.findIndex((u) => u.type === 'hood-cabinet');
    return i >= 0 ? `upper.run-back.${i}.bottom` : 'upper.run-back.3.bottom';
  };
  const HOOD_CAB_KEYS = ['upper.run-back.2.', 'upper.run-back.3.', 'upper.run-back.4.', cabKeyOf(baseL)];
  const rowAnchors = ['upper.run-back.0.', 'upper.run-back.1.', 'upper.run-left.'];
  sweep('hood mouth 18→48" (cabinet above)', range(18, 48, 2),
    (v: number) => withApp('hood', { aboveCounterIn: v, cabinetAbove: 'doors' }),
    [`app.${HOOD_ID}.y`, `app.${HOOD_ID}.top`, 'splash.', ...HOOD_CAB_KEYS],
    ['island.', 'base.', ...rowAnchors, 'tall.', 'counter.', 'sink.', 'run.', 'cab.', 'room.', 'light.', 'stool.', 'decor.', `app.${FRIDGE_ID}`, ...OTHER_APPS, `app.${HOOD_ID}.h`, `app.${HOOD_ID}.x`, `app.${HOOD_ID}.w`]);
  sweep('hood height 12→96" (cabinet above)', range(12, 96, 4),
    (v: number) => withApp('hood', { heightIn: v, cabinetAbove: 'doors' }),
    [`app.${HOOD_ID}.top`, `app.${HOOD_ID}.h`, 'splash.', ...HOOD_CAB_KEYS],
    ['island.', 'base.', ...rowAnchors, 'tall.', 'counter.', 'sink.', 'run.', 'cab.', 'room.', 'light.', 'stool.', 'decor.', `app.${FRIDGE_ID}`, ...OTHER_APPS, `app.${HOOD_ID}.x`, `app.${HOOD_ID}.w`, `app.${HOOD_ID}.y`]);
}


// ---------------------------------------------------------------------------
// 10. PROPORTION KNOBS — the seven degrees of freedom the photo can measure
//
// Each one moves exactly what it names, and moves it by the measured number.
// (The fitter searches these; if a knob changed nothing observable, searching
// it would be free and useless — which is what a splash height that stopped
// at the hood used to be.)
// ---------------------------------------------------------------------------
console.log('\n10. PROPORTION KNOBS — a measured number beats a category word');

// the demo carries behindRange 'full-height' (the feature slab under the hood),
// which is a separate control — these cases are about the FIELD height
const withSplashH = (heightIn: number | null): KitchenSpec => ({ ...base, backsplash: { ...base.backsplash, behindRange: 'same', heightIn } });
{
  const bad: string[] = [];
  for (const v of [6, 18, 48, 96]) {
    const L = computeKitchenLayout(withSplashH(v));
    const ceilingTop = L.h - 0.006;
    const want = Math.min(L.counterTopY + v * IN, ceilingTop);
    for (const r of L.runs) {
      for (const sp of r.splash) {
        // the piece under a window still stops at the sill; everything else follows heightIn
        const win = L.openings.find((o) => o.kind === 'window' && o.wall === r.wall && overlaps1(sp.x0, sp.x1, o.x - o.width / 2, o.x + o.width / 2));
        if (win && sp.top < want - 1e-4) continue;
        if (Math.abs(sp.top - want) > 0.002) bad.push(`${v}": ${r.id} piece tops at ${((sp.top - L.counterTopY) / IN).toFixed(1)}" over the counter`);
      }
    }
  }
  // behind the hood it follows heightIn too, unless behindRange asks for the slab
  const at18 = computeKitchenLayout(withSplashH(18));
  const hood = at18.appliances.find((a) => a.kind === 'hood')!;
  const behind = at18.runs.find((r) => r.id === 'run-back')!.splash.filter((sp) => overlaps1(sp.x0, sp.x1, hood.x - hood.width / 2, hood.x + hood.width / 2));
  if (!behind.length) bad.push('no tile behind the hood');
  else if (!behind.every((sp) => near(sp.top, at18.counterTopY + 18 * IN))) bad.push(`behind the hood tops at ${behind.map((s) => ((s.top - at18.counterTopY) / IN).toFixed(1)).join('/')}", expected 18"`);
  const slab = computeKitchenLayout({ ...base, backsplash: { ...base.backsplash, heightIn: 18, behindRange: 'full-height' } });
  const sh = slab.appliances.find((a) => a.kind === 'hood')!;
  const slabPieces = slab.runs.find((r) => r.id === 'run-back')!.splash.filter((sp) => overlaps1(sp.x0, sp.x1, sh.x - sh.width / 2, sh.x + sh.width / 2));
  if (!slabPieces.every((sp) => near(sp.top, sh.y + 0.5 * IN))) bad.push('behindRange full-height no longer reaches the hood mouth');
  if (bad.length) fail(`backsplash.heightIn: ${bad.slice(0, 5).join('; ')}`);
  else ok('backsplash.heightIn: 6/18/48/96" honoured on every run including behind the hood; behindRange full-height still runs to the mouth');
}
sweep('backsplash.heightIn 6→96"', range(6, 96, 6), (v: number) => withSplashH(v), ['splash.'],
  ['island.', 'base.', 'upper.', 'tall.', 'counter.', 'app.', 'sink.', 'run.', 'cab.', 'room.', 'light.', 'stool.', 'decor.']);

{
  // island end stools: which end, how far the top cantilevers, how far the row shifts
  const bad: string[] = [];
  const wide: Partial<KitchenSpec> = { dims: { ...base.dims, widthFt: 24 } };
  const both = computeKitchenLayout(withIsland({ seating: 5, endSeats: 2, endPlacement: 'both', offset: { x: 0, z: 1.5 }, widthFt: 3.2, overhangIn: 12 }, wide)).island!;
  const bp = stoolPositions(both);
  if (both.endSeats !== 2 || both.endSeatsOther !== 1) bad.push(`'both' drew ${both.endSeats} end seats (${both.endSeatsOther} at the far end)`);
  else {
    const ends = bp.slice(both.seating - both.endSeats);
    if (ends.length !== 2 || !(ends[0][0] > 0 !== ends[1][0] > 0)) bad.push(`'both' put both end stools at the same end (${ends.map((e) => e[0].toFixed(2)).join(', ')})`);
    if (both.seating - both.endSeats !== 3) bad.push(`'both' left ${both.seating - both.endSeats} along the side, expected 3`);
  }
  const left = computeKitchenLayout(withIsland({ seating: 4, endSeats: 1, endPlacement: 'left', offset: { x: 0, z: 1.5 } }, wide)).island!;
  if (left.endSide !== -1) bad.push(`'left' put the stools at endSide ${left.endSide}`);
  if (stoolPositions(left).slice(-1)[0][0] >= 0) bad.push("'left' drew the end stool at +x");
  const right = computeKitchenLayout(withIsland({ seating: 4, endSeats: 1, endPlacement: 'right', offset: { x: 0, z: 1.5 } }, wide)).island!;
  if (right.endSide !== 1) bad.push(`'right' put the stools at endSide ${right.endSide}`);
  const auto = computeKitchenLayout(withIsland({ seating: 4, endSeats: 1, endPlacement: 'auto', offset: { x: 0, z: 1.5 } }, wide)).island!;
  const old = computeKitchenLayout(withIsland({ seating: 4, endSeats: 1, offset: { x: 0, z: 1.5 } }, wide)).island!;
  if (auto.endSide !== old.endSide || auto.endSeats !== old.endSeats) bad.push("'auto' is not today's rule");
  // the top cantilevers at the ends and the stools tuck under it
  const flush = computeKitchenLayout(withIsland({ seating: 4, endSeats: 1, endPlacement: 'right', endOverhangIn: 1.5, offset: { x: 0, z: 1.5 } }, wide)).island!;
  const deep = computeKitchenLayout(withIsland({ seating: 4, endSeats: 1, endPlacement: 'right', endOverhangIn: 12, offset: { x: 0, z: 1.5 } }, wide)).island!;
  if (Math.abs(deep.topLen - (deep.len + 24 * IN)) > 1e-6) bad.push(`12" end overhang gave topLen − len = ${((deep.topLen - deep.len) / IN).toFixed(1)}"`);
  const flushX = stoolPositions(flush).slice(-1)[0][0], deepX = stoolPositions(deep).slice(-1)[0][0];
  if (Math.abs((flushX - flush.topLen / 2) - 4 * IN) > 1e-6) bad.push(`at a 1.5" overhang the stool stands ${((flushX - flush.topLen / 2) / IN).toFixed(1)}" past the top, expected 4"`);
  if (Math.abs((deep.topLen / 2 - deepX) - 7 * IN) > 1e-6) bad.push(`at a 12" overhang the stool tucks ${((deep.topLen / 2 - deepX) / IN).toFixed(1)}" under the top, expected 7"`);
  // the side row shifts, clamped so no stool leaves the top
  const shifted = computeKitchenLayout(withIsland({ seating: 3, endSeats: 0, lengthFt: 7, stoolOffsetIn: 24, offset: { x: 0, z: 1.5 } }, wide)).island!;
  const xs = stoolPositions(shifted).map(([x]) => x);
  if (xs.some((x) => Math.abs(x) > shifted.topLen / 2 - 7 * IN + 1e-6)) bad.push(`a shifted stool left the top (${xs.map((x) => x.toFixed(3)).join(', ')})`);
  const centred = computeKitchenLayout(withIsland({ seating: 3, endSeats: 0, lengthFt: 7, offset: { x: 0, z: 1.5 } }, wide)).island!;
  const dx = xs[0] - stoolPositions(centred)[0][0];
  if (Math.abs(dx - shifted.stoolOffset) > 1e-6) bad.push('the drawn shift is not KIsland.stoolOffset');
  if (shifted.stoolOffset <= 0) bad.push('a +24" offset did not move the row toward the right end');
  if (bad.length) fail(`island end stools: ${bad.join('; ')}`);
  else ok(`island end stools: 'both' splits 2 across the ends, 'left'/'right' honoured, 'auto' unchanged; a 12" end overhang tucks the stool 7" under the top (1.5" stands 4" past); a +24" row shift is clamped to ${(shifted.stoolOffset / IN).toFixed(1)}"`);
}

{
  // explicit pendant hooks: the count follows the list and a shade may hang past the island
  const bad: string[] = [];
  const withPos = (positions: Array<{ alongFt: number; acrossFt: number }> | null, extra: Partial<KitchenSpec['island']> = {}): KitchenSpec => ({
    ...withIsland({ lengthFt: 7, offset: { x: 0, z: 1.5 }, ...extra }, { dims: { ...base.dims, widthFt: 24 } }),
    lighting: { ...base.lighting, pendants: { ...base.lighting.pendants!, count: 2, positions } },
  });
  const L = computeKitchenLayout(withPos([{ alongFt: 4.5, acrossFt: 0 }]));
  const isl = L.island!;
  const hooks = pendantPositions(L);
  if (L.lighting.pendants!.count !== 1) bad.push(`count ${L.lighting.pendants!.count}, expected 1 (the list is the row)`);
  if (hooks.length !== 1) bad.push(`${hooks.length} hooks drawn`);
  else {
    // 4.5 ft from the centre of a 7 ft island: a foot past the end of the top,
    // which is the whole point — explicit hooks are NOT clamped inside the slab
    const past = (hooks[0][0] - isl.cx) - isl.topLen / 2;
    if (Math.abs((hooks[0][0] - isl.cx) - 4.5 * 0.3048) > 1e-6) bad.push(`the hook is ${((hooks[0][0] - isl.cx) / 0.3048).toFixed(2)} ft from the island centre, expected 4.5`);
    if (past < 0.2) bad.push(`the hook is only ${past.toFixed(3)} m past the island's end`);
    if (Math.abs(hooks[0][0]) > L.w / 2 - 0.15 + 1e-6) bad.push('the hook is not held inside the wall');
  }
  const row = computeKitchenLayout(withPos(null));
  if (pendantPositions(row).length !== 2) bad.push('a null positions list did not fall back to the spread row');
  if (bad.length) fail(`pendant positions: ${bad.join('; ')}`);
  else ok(`pendant positions: the list is the row (1 hook ${((hooks[0][0] - isl.cx - isl.topLen / 2)).toFixed(2)} m past the island's end, still inside the wall); null falls back to spread/offset`);
}

{
  // one wall cabinet shorter than its neighbours; a tall unit to the ceiling; a thicker counter overhang
  const bad: string[] = [];
  const shortSpec: KitchenSpec = {
    ...base,
    runs: base.runs.map((r) => (r.id === 'run-back'
      ? { ...r, uppers: (r.uppers ?? []).map((u, i) => (i === 1 ? { ...u, heightIn: 15 } : u)) }
      : r)),
  };
  const L = computeKitchenLayout(shortSpec);
  const run = L.runs.find((r) => r.id === 'run-back')!;
  const short = run.uppers.filter((u) => Math.abs((run.upperTop - u.bottom) - 15 * IN) < 1e-6);
  if (short.length !== 1) bad.push(`${short.length} cabinets took the 15" height`);
  if (run.uppers.filter((u) => u.type !== 'hood-cabinet' && Math.abs(u.bottom - run.upperBottom) > 1e-6).length !== 1) bad.push('more than one row cabinet left the row bottom');
  const moved = diffKeys(snapshot(computeKitchenLayout(base)), snapshot(L)).filter((k) => !k.endsWith('.bottom'));
  if (moved.length) bad.push(`a per-cabinet height moved ${moved.slice(0, 4).join(', ')}`);
  const parts = buildKitchenPartsRaw(L);
  const box = bboxOf(parts, `${short[0]?.id}-box`);
  if (short.length && (!box || !near(box.min.y, run.upperTop - 15 * IN) || !near(box.max.y, run.upperTop))) bad.push('the short cabinet is not drawn from the top line down');
  // tall to the ceiling, on a run with no uppers
  const tallSpec: KitchenSpec = {
    ...base,
    runs: base.runs.map((r) => (r.id === 'run-back' ? { ...r, hasUppers: false, tall: r.tall.map((t) => ({ ...t, toCeiling: true })) } : r)),
  };
  const T = computeKitchenLayout(tallSpec);
  const tall = T.runs.find((r) => r.id === 'run-back')!.tall[0];
  if (!tall || Math.abs(tall.top - (T.h - T.crownH - 0.004)) > 1e-6) bad.push(`toCeiling top ${tall ? tall.top.toFixed(3) : 'no unit'}, expected ${(T.h - T.crownH - 0.004).toFixed(3)}`);
  const off = computeKitchenLayout({ ...tallSpec, runs: tallSpec.runs.map((r) => ({ ...r, tall: r.tall.map((t) => ({ ...t, toCeiling: null })) })) });
  const offTall = off.runs.find((r) => r.id === 'run-back')!.tall[0];
  if (offTall && offTall.top >= tall.top - 1e-6) bad.push('toCeiling changed nothing');
  // the counter's front overhang
  const oh = computeKitchenLayout({ ...base, countertop: { ...base.countertop, overhangIn: 2.5 } });
  if (Math.abs(oh.runs[0].counterDepth - (oh.baseDepth + 2.5 * IN)) > 1e-6) bad.push(`2.5" overhang drew a ${((oh.runs[0].counterDepth - oh.baseDepth) / IN).toFixed(2)}" one`);
  const ohNull = computeKitchenLayout(base);
  if (Math.abs(ohNull.runs[0].counterDepth - (ohNull.baseDepth + 1.5 * IN)) > 1e-6) bad.push('a null overhang is not 1.5"');
  // the hood mouth floor
  const low = computeKitchenLayout(bareHood(withApp('hood', { aboveCounterIn: 20 }))).appliances.find((a) => a.kind === 'hood')!;
  if (Math.abs((low.y - baseL.counterTopY) - 20 * IN) > 1e-6) bad.push(`a 20" mouth drew ${((low.y - baseL.counterTopY) / IN).toFixed(1)}"`);
  if (bad.length) fail(`per-cabinet height / toCeiling / overhang / mouth: ${bad.join('; ')}`);
  else ok(`uppers[].heightIn 15" on one cabinet only (neighbours fixed), tall toCeiling → ${(tall.top / IN).toFixed(1)}" (crown line), countertop.overhangIn 2.5", hood mouth 20" (the old floor was 24")`);
}

// ---------------------------------------------------------------------------
// 11. ITEMS — the things standing on the surfaces
//
// These sweeps assert only that ONE item moves and nothing else does; where
// each item actually lands (the burner grid, the free counter, the shelf
// board) is stream I's check-decor.ts, which consumes what the layout solves.
// ---------------------------------------------------------------------------
console.log('\n11. ITEMS — one item moves, nothing else does');

type Item = NonNullable<KitchenSpec['decor']['items']>[number];
const ITEM: Item = { kind: 'pot', label: 'pot', on: 'counter', wall: 'back', t: 0.5, depthT: null, shelfIndex: null, burner: null, sizeIn: 10, colorHex: '#b9bcc0', material: 'stainless', count: 1 };
const itemBase: KitchenSpec = { ...decorBase, decor: { ...decorBase.decor, items: [ITEM] } };
const withItem = (p: Partial<Item>): KitchenSpec => ({ ...itemBase, decor: { ...itemBase.decor, items: [{ ...ITEM, ...p }] } });
const ITEM_MOVES = ['decor.item.0'];
const itemAnchors = [...EVERYTHING_ELSE, 'decor.shelf', 'decor.plant', 'decor.art', 'decor.rug', 'decor.wt', 'decor.styling'];

sweep('item position 5→95%', range(0.05, 0.95, 0.05), (v: number) => withItem({ t: v }), ITEM_MOVES, itemAnchors);
sweep('item size 2→30"', range(2, 30, 2), (v: number) => withItem({ sizeIn: v }), ITEM_MOVES, itemAnchors);
sweep('item depth 0→100%', range(0, 1, 0.1), (v: number) => withItem({ depthT: v }), ITEM_MOVES, itemAnchors);
sweep('item burner', ['left-back', 'right-back', 'left-front', 'right-front'],
  (v: Item['burner']) => withItem({ on: 'range', burner: v }), ITEM_MOVES, itemAnchors);
sweep('item host', ['counter', 'range', 'island', 'shelf', 'sill', 'floor'],
  (v: Item['on']) => withItem({ on: v, wall: v === 'island' ? 'island' : v === 'shelf' ? 'left' : 'back' }), ITEM_MOVES, itemAnchors);
sweep('item kind × 30', ITEM_KINDS_ALL, (v: Item['kind']) => withItem({ kind: v }), ITEM_MOVES, itemAnchors);
sweep('items 0→10', range(0, 10, 1),
  (v: number) => ({ ...itemBase, decor: { ...itemBase.decor, items: Array.from({ length: v }, (_, i) => ({ ...ITEM, t: 0.05 + i * 0.09 })) } }),
  ['decor.item.'], itemAnchors);
{
  // adding an item never moves the one already placed
  const one = computeKitchenLayout(withItem({ t: 0.2 }));
  const two = computeKitchenLayout({ ...itemBase, decor: { ...itemBase.decor, items: [{ ...ITEM, t: 0.2 }, { ...ITEM, kind: 'kettle', t: 0.8 }] } });
  const moved = diffKeys(snapshot(one), snapshot(two)).filter((k) => !k.startsWith('decor.item.1'));
  if (moved.length) fail(`adding a second item moved ${moved.slice(0, 5).join(', ')}`);
  else ok('adding a second item leaves the first one, and everything else, exactly where it was');
  // an item that cannot be hosted is reported, never silently dropped
  const noRange = computeKitchenLayout({ ...withItem({ on: 'range' }), appliances: base.appliances.filter((a) => a.kind !== 'range' && a.kind !== 'cooktop' && a.kind !== 'hood') });
  if (!noRange.decor.warnings.some((w) => w.includes('no range'))) fail('an item on a range in a kitchen with no range was dropped silently');
  else ok(`an item with no host is re-hosted with a note — "${noRange.decor.warnings.find((w) => w.includes('no range'))}"`);
}

// ---------------------------------------------------------------------------
// 10. STACKED UPPERS, THE CABINET ON THE HOOD, AND A COVERED BACKSPLASH
//     The client's three oldest complaints: "the small top cabinets not being
//     registered/created", "the cabinets above the stove vent are still not
//     appearing", "the backsplash why is it like in squares not covering the
//     entire surface".
// ---------------------------------------------------------------------------
console.log('\n10. STACKED UPPERS · THE HOOD CABINET · A COVERED SPLASH');
{
  const IN2 = (m: number) => m / 0.0254;
  const fx = (name: string): KitchenSpec => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.spec.json`), 'utf8')) as KitchenSpec;
  const tan = () => fx('client-tan');

  // 10.1 ONE TIER IS BIT-IDENTICAL. `uppers2` null must draw exactly what the
  //      scene drew before the field existed: every box tier 1, its top the
  //      row's top, its bottom the value it has at HEAD.
  {
    const L = computeKitchenLayout(defaultKitchen());
    const bad: string[] = [];
    // the bottoms this row had before the second tier landed (run.upperBottom
    // for every row cabinet, the canopy top for the box on the hood)
    const HEAD_BOTTOMS: Record<string, number[]> = {
      'run-back': [1.3653, 1.3653, 1.3653, 2.0257, 1.3653],
      'run-left': [1.3653, 1.3653, 1.3653, 1.3653],
    };
    for (const r of L.runs) {
      if (!r.uppers.length) continue;
      if (r.upperSplit !== null) bad.push(`${r.id} has a rail line with no uppers2`);
      for (const u of r.uppers) {
        if (u.tier !== 1) bad.push(`${r.id}/${u.id} is tier ${u.tier}`);
        if (Math.abs(u.top - r.upperTop) > 1e-9) bad.push(`${r.id}/${u.id} top ${u.top.toFixed(4)} ≠ upperTop ${r.upperTop.toFixed(4)}`);
      }
      const want = HEAD_BOTTOMS[r.id];
      const got = r.uppers.map((u) => Math.round(u.bottom * 1e4) / 1e4);
      if (!want) bad.push(`${r.id}: no HEAD snapshot`);
      else if (want.length !== got.length || want.some((v, i) => Math.abs(v - got[i]) > 5e-4)) bad.push(`${r.id} bottoms ${got.join(',')} ≠ HEAD ${want.join(',')}`);
    }
    if (bad.length) fail(`single tier unchanged: ${bad.join('; ')}`);
    else ok('single tier unchanged: every box tier 1, top = upperTop, bottoms bit-identical to HEAD');
  }

  // 10.2 TWO TIERS ON A 54" ROW — the client's photo measures 380 px : 215 px
  //      (1.77 : 1); a 36" door under an 18" transom is 2.00 : 1 at the row the
  //      analyzer read, which is the closest a 3" module gets.
  {
    const spec = tan();
    const back = spec.runs.find((r) => r.id === 'run-back')!;
    back.uppers2 = deriveUppers2(back.uppers!);
    back.uppers2HeightIn = null;
    const t2In = resolveUppers2HeightIn(54, back);
    const bad: string[] = [];
    if (t2In !== 18) bad.push(`resolveUppers2HeightIn(54) = ${t2In}, expected 18`);
    const L = computeKitchenLayout(spec);
    const r = L.runs.find((x) => x.id === 'run-back')!;
    const split = r.upperTop - 0.4572;                       // 18 in below the top
    if (r.upperSplit === null || Math.abs(r.upperSplit - split) > 1e-3) bad.push(`rail line at ${r.upperSplit?.toFixed(4) ?? 'null'}, expected ${split.toFixed(4)}`);
    const t1 = r.uppers.filter((u) => u.tier === 1);
    const t2 = r.uppers.filter((u) => u.tier === 2);
    if (!t1.length || !t2.length) bad.push(`tier 1 ${t1.length} boxes, tier 2 ${t2.length}`);
    // The tiers stop HALF A RAIL short of the split from each side. They used
    // to meet on it, which put 12.9 mm of each door over a 31.8 mm rail and
    // left 6.0 mm (0.24 in) of the 1.25 in band showing — the "ONE tall door
    // with a scratch across it" the rail exists to prevent.
    const railHalf = TIER_RAIL_H / 2;
    for (const u of t1) {
      if (Math.abs(u.bottom - r.upperBottom) > 1e-3 || Math.abs(u.top - (split - railHalf)) > 1e-3) bad.push(`tier-1 ${u.id} spans ${u.bottom.toFixed(4)}–${u.top.toFixed(4)}`);
    }
    for (const u of t2) {
      // the box on the hood legitimately starts lower: its underside is the canopy
      if (u.type === 'hood-cabinet') continue;
      if (Math.abs(u.bottom - (split + railHalf)) > 1e-3 || Math.abs(u.top - r.upperTop) > 1e-3) bad.push(`tier-2 ${u.id} spans ${u.bottom.toFixed(4)}–${u.top.toFixed(4)}`);
    }
    // …so the whole band is visible between the two door faces, and the rail's
    // own front face is a door thickness BEHIND them rather than 0.2 mm in
    // front (which z-fought on a flush-ended run).
    const doorGapM = (Math.min(...t2.filter((u) => u.type !== 'hood-cabinet').map((u) => u.bottom)) + REVEAL_K) - (Math.max(...t1.map((u) => u.top)) - REVEAL_K);
    if (doorGapM < TIER_RAIL_H - 1e-6) bad.push(`only ${IN2(doorGapM).toFixed(3)} in of the ${IN2(TIER_RAIL_H).toFixed(2)} in rail shows between the door faces`);
    // the two rows end at the same inch (contract §2.1) — the hood's own box
    // spans both, so compare the outer edges of the drawn row
    const span = (row: typeof t1) => [Math.min(...row.map((u) => u.x0)), Math.max(...row.map((u) => u.x1))];
    const [a0, a1] = span(t1), [b0, b1] = span(t2);
    if (Math.abs(a0 - b0) > 1e-3 || Math.abs(a1 - b1) > 1e-3) bad.push(`tier spans [${a0.toFixed(3)},${a1.toFixed(3)}] vs [${b0.toFixed(3)},${b1.toFixed(3)}]`);
    const rails = buildKitchenPartsRaw(L).filter((p) => p.key.startsWith('run-back-tier'));
    if (!rails.length) bad.push('no rail between the tiers');
    else if (rails.some((p) => Math.abs((p.position?.[1] ?? 0) - split) > 1e-3)) bad.push(`a rail is not on the split line (${rails.map((p) => (p.position?.[1] ?? 0).toFixed(4)).join(', ')})`);
    else if (rails.some((p) => (p.position?.[2] ?? 0) >= r.upperDepth - DOOR_T_K)) bad.push(`a rail is not set back behind the door plane (z ${rails.map((p) => (p.position?.[2] ?? 0).toFixed(5)).join(', ')} vs doors at ${(r.upperDepth - DOOR_T_K / 2).toFixed(5)})`);
    if (bad.length) fail(`two tiers on a 54" row: ${bad.join('; ')}`);
    else ok(`two tiers on a 54" row: ${IN2(split - r.upperBottom).toFixed(0)}" under an ${IN2(r.upperTop - split).toFixed(0)}" transom, ${t1.length}+${t2.length} boxes, ${rails.length} rail(s) on the split, all ${IN2(TIER_RAIL_H).toFixed(2)}" of the band visible (${IN2(doorGapM).toFixed(2)}" between door faces) and set back behind them`);
  }

  // 10.3 uppers2HeightIn is honoured, and clamped so a transom can never eat
  //      its own row (a 54" row can give at most 18" over a 36" door).
  {
    const bad: string[] = [];
    // NB the landed `resolveUppers2HeightIn` caps the transom at `row − 36`, so
    // a 54" row can only ever give 18" whatever is declared (brief-CAB §5.3
    // expected 24 on this row; the contract module is frozen, so the CONTRACT
    // is what is asserted). A 66" row is where a declared value has room.
    for (const [rowIn, declared, want] of [[54, 24, 18], [54, 40, 18], [54, 4, 9], [54, null, 18], [63, 24, 24], [63, 40, 27], [63, null, 27]] as Array<[number, number | null, number]>) {
      const spec = tan();
      const back = spec.runs.find((r) => r.id === 'run-back')!;
      back.upperHeightIn = rowIn;
      back.uppers2 = deriveUppers2(back.uppers!);
      back.uppers2HeightIn = declared;
      const got = resolveUppers2HeightIn(rowIn, back);
      if (got !== want) { bad.push(`${rowIn}" row, declared ${declared} → ${got}, expected ${want}`); continue; }
      const r = computeKitchenLayout(spec).runs.find((x) => x.id === 'run-back')!;
      // the drawn row is the one the scene has (a ceiling can clamp it), and
      // the drawn transom must be what the contract derives from THAT row
      const drawnRow = IN2(r.upperTop - r.upperBottom);
      const drawn = IN2(r.upperTop - (r.upperSplit ?? r.upperTop));
      const expect = resolveUppers2HeightIn(drawnRow, back);
      if (Math.abs(drawn - expect) > 0.1) bad.push(`${rowIn}" row (drawn ${drawnRow.toFixed(1)}"), declared ${declared} drew ${drawn.toFixed(1)}", contract says ${expect}`);
    }
    if (bad.length) fail(`uppers2HeightIn: ${bad.join('; ')}`);
    else ok('uppers2HeightIn honoured and clamped: 54" row 24/40/4/null → 18/18/9/18 (a 36" door wins); 63" row 24/40/null → 24/27/27');
  }

  // 10.4 A SHORT ROW REFUSES TO STACK. Under 45" there is no room for a 36"
  //      door and a transom over it, so `uppers2` is ignored and one tier drawn.
  {
    const spec = tan();
    const back = spec.runs.find((r) => r.id === 'run-back')!;
    back.upperHeightIn = 36;
    back.uppers2 = deriveUppers2(back.uppers!);
    back.uppers2HeightIn = null;
    const bad: string[] = [];
    if (resolveUppers2HeightIn(36, back) !== 0) bad.push(`resolveUppers2HeightIn(36) = ${resolveUppers2HeightIn(36, back)}, expected 0`);
    const r = computeKitchenLayout(spec).runs.find((x) => x.id === 'run-back')!;
    if (r.upperSplit !== null) bad.push(`a 36" row drew a rail at ${r.upperSplit.toFixed(4)}`);
    if (r.uppers.some((u) => u.tier === 2)) bad.push('a 36" row drew tier-2 boxes');
    if (bad.length) fail(`a short row refuses to stack: ${bad.join('; ')}`);
    else ok('a short row refuses to stack: 36" row → one tier even with uppers2 set');
  }

  // 10.5 THE HOOD SAFETY NET fires on client-tan and on NOTHING else.
  {
    const cases: Array<[string, KitchenSpec]> = [
      ['client-tan', tan()], ['client-marble', fx('client-marble')],
      ['client-marble-items', fx('client-marble-items')], ['client-shelves', fx('client-shelves')],
      ['defaultKitchen', defaultKitchen()],
    ];
    const bad: string[] = [];
    const rows: string[] = [];
    for (const [name, spec] of cases) {
      const hood = spec.appliances.find((a) => a.kind === 'hood') ?? null;
      const run = hood ? runForHood(spec, hood) : null;
      const rowIn = run ? rowHeightIn(spec, run) : NaN;
      const bandIn = hood && run ? hoodCabinetBandIn(spec, run, hood) : NaN;
      const before = hood ? resolveCabinetAbove(hood, true) : 'none';
      const net = hood && run ? hoodCabinetNet({ heightIn: hood.heightIn, aboveCounterIn: hood.aboveCounterIn, rowIn, bandIn, current: before }) : null;
      const fired = net !== null;
      if ((name === 'client-tan') !== fired) bad.push(`${name}: net ${fired ? 'fired' : 'did not fire'}`);
      const after = reconcileSpec(JSON.parse(JSON.stringify(spec)) as RoomSpec, { photoCount: 1 }) as KitchenSpec;
      const hood2 = after.appliances.find((a) => a.kind === 'hood') ?? null;
      const got = hood2 ? (hood2.cabinetAbove ?? 'null') : 'none';
      if (name === 'client-tan' && got !== 'doors') bad.push(`client-tan reconciled to cabinetAbove '${got}', expected 'doors'`);
      if (name !== 'client-tan' && hood && hood2 && hood2.cabinetAbove !== hood.cabinetAbove) bad.push(`${name}: reconcile changed cabinetAbove ${hood.cabinetAbove} → ${hood2.cabinetAbove}`);
      rows.push(`${name} h=${hood?.heightIn ?? 'null'} band=${Number.isFinite(bandIn) ? bandIn.toFixed(1) : '—'} ratio=${net ? net.ratio.toFixed(3) : '—'} ${fired ? 'FIRES' : 'no'}`);
    }
    if (bad.length) fail(`the hood net: ${bad.join('; ')}`);
    else ok(`the hood net fires on client-tan only — ${rows.join(' | ')}`);
  }

  // 10.6 THE BARE BAND OVER THE SPLASH IS GONE. The analyzer wrote heightIn 54
  //      on all three of run-right's uppers in a 61" row: they hung from the
  //      crown and left 6.9" of bare painted wall over the backsplash.
  {
    const before = computeKitchenLayout(tan()).runs.find((r) => r.id === 'run-right')!;
    const bareBefore = IN2(Math.min(...before.uppers.map((u) => u.bottom)) - before.upperBottom);
    const after = reconcileSpec(tan() as unknown as RoomSpec, { photoCount: 1 }) as KitchenSpec;
    const r = computeKitchenLayout(after).runs.find((x) => x.id === 'run-right')!;
    const bare = IN2(Math.min(...r.uppers.filter((u) => u.tier === 1).map((u) => u.bottom)) - r.upperBottom);
    if (bare > 0.01) fail(`run-right still hangs its uppers ${bare.toFixed(2)}" above the row bottom`);
    else ok(`run-right's uppers fill the row: ${bareBefore.toFixed(2)}" of bare wall over the splash → 0.00"`);
  }

  // 10.7 THE HOOD BAY IS COVERED, and no backsplashed run has bare wall
  //      between the counter and the wall cabinets. "i need everything to be
  //      covered."
  {
    const bad: string[] = [];
    const notes: string[] = [];
    for (const name of ['client-tan', 'client-marble', 'client-marble-items', 'client-shelves']) {
      const L = computeKitchenLayout(fx(name));
      for (const r of L.runs) {
        if (!r.splash.length || !r.counters.length) continue;
        // Every stretch of COUNTER must have tile behind it. Measuring against
        // the counters rather than the run makes the test blocker-aware for
        // free: a doorway or a fridge that breaks the field breaks the slab
        // too, and a range breaks the slab but not the tile behind it (the
        // splash is a superset). ACCEPTANCE §7: no gap wider than 2 in.
        // …less the wall that cannot be tiled: a window or doorway, and the
        // wall a tall cabinet or an un-housed fridge already covers.
        const covered = mergeSpansLocal([
          ...r.splash.filter((sp) => sp.top > L.counterTopY + 0.01).map((sp): [number, number] => [sp.x0, sp.x1]),
          ...L.openings.filter((o) => o.wall === r.wall).map((o): [number, number] => [o.x - o.width / 2 - 0.02, o.x + o.width / 2 + 0.02]),
          ...r.tall.map((t): [number, number] => [t.x0 - 0.02, t.x1 + 0.02]),
          ...L.appliances.filter((a) => a.wall === r.wall && a.kind === 'fridge').map((a): [number, number] => [a.x - a.width / 2 - 0.02, a.x + a.width / 2 + 0.02]),
        ]);
        for (const [c0, c1] of r.counters) {
          let cursor = c0;
          let worst = 0;
          for (const [a0, a1] of covered) {
            if (a1 <= c0 || a0 >= c1) continue;
            worst = Math.max(worst, a0 - cursor);
            cursor = Math.max(cursor, a1);
          }
          worst = Math.max(worst, c1 - cursor);
          if (IN2(worst) > 2) bad.push(`${name}/${r.id}: ${IN2(worst).toFixed(1)}" of counter with no tile behind it`);
        }
      }
      const hood = L.appliances.find((a) => a.kind === 'hood' && a.wall !== 'island');
      const run = hood ? L.runs.find((r) => r.id === hood.runId) : null;
      if (hood && run && run.splash.length && hood.cabinetBottom !== null) {
        const bay: [number, number] = [hood.x - hood.width / 2, hood.x + hood.width / 2];
        const tall = run.splash.filter((sp) => sp.x1 > bay[0] + 0.01 && sp.x0 < bay[1] - 0.01 && sp.top >= hood.cabinetBottom! - 0.02);
        const width = tall.reduce((s, sp) => s + Math.min(sp.x1, bay[1]) - Math.max(sp.x0, bay[0]), 0);
        if (width < (bay[1] - bay[0]) - 0.02) bad.push(`${name}: the hood bay is only ${IN2(width).toFixed(1)}" of ${IN2(bay[1] - bay[0]).toFixed(1)}" covered to the cabinet`);
        else notes.push(`${name} bay ${IN2(bay[1] - bay[0]).toFixed(0)}" to the cabinet underside`);
      }
    }
    if (bad.length) fail(`backsplash coverage: ${bad.join('; ')}`);
    else ok(`backsplash coverage: no gap over 2" on any backsplashed run; ${notes.join(', ') || 'no hood cabinet on these fixtures'}`);
  }

  // 10.8 ONE SLAB IS ONE MESH — abutting pieces at the same top and bottom are
  //      merged, because each is drawn as its own chamfered box and the seam
  //      between two of them is the client's "why is it like in squares".
  {
    const bad: string[] = [];
    let merged = 0;
    for (const name of ['client-tan', 'client-marble', 'client-marble-items', 'client-shelves']) {
      const L = computeKitchenLayout(fx(name));
      for (const r of L.runs) {
        const sorted = [...r.splash].sort((a, b) => a.x0 - b.x0);
        for (let i = 1; i < sorted.length; i++) {
          const a = sorted[i - 1], b = sorted[i];
          if (b.x0 - a.x1 < 1e-3 && Math.abs(a.top - b.top) < 1e-3 && Math.abs(a.bottom - b.bottom) < 1e-3) {
            bad.push(`${name}/${r.id}: two pieces abut at the same top (${a.x1.toFixed(3)})`);
          }
        }
        merged += r.splash.length;
      }
    }
    if (bad.length) fail(`one slab is one mesh: ${bad.join('; ')}`);
    else ok(`one slab is one mesh: ${merged} splash pieces over 4 fixtures, none abutting at the same top`);
  }
}


// ---------------------------------------------------------------------------
// 12. A RESIZED RUN — the cabinets follow the length
//     The fit moves `runs[].lengthFt` on its own. A run that stretches while
//     its boxes stay put draws 13.5 ft of cabinet in a 15 ft run and BILLS for
//     13.5 — which is what `check-photo-fidelity` §1.3 exists to catch. This
//     section changes each fixture's runs by ±20% through `setRunLength` and
//     holds the whole contract: the flexible boxes absorb it, the fixed
//     members (appliance gaps, the sink base, corners) do not move, a run that
//     cannot shrink that far refuses instead of lying, and reconciling the
//     result again changes nothing.
// ---------------------------------------------------------------------------
console.log('\n12. RESIZED RUNS — widths follow the length, gaps do not');
{
  const fx = (name: string): KitchenSpec => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.spec.json`), 'utf8')) as KitchenSpec;
  const NAMES = ['client-tan', 'client-marble', 'client-marble-items', 'client-shelves'];
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const FIXED_BASE = new Set(['appliance-gap', 'sink-base', 'corner']);
  const sum = (row: ReadonlyArray<{ widthIn: number }> | null | undefined) => (row ?? []).reduce((n, c) => n + c.widthIn, 0);
  /** what the reconciler may leave on the table: half a module, plus the 0.1 ft `lengthFt` is written to */
  const ROW_TOL_IN = 3;
  const wallFtOf = (spec: KitchenSpec, wall: string) => (wall === 'back' || wall === 'front' ? spec.dims.widthFt : spec.dims.depthFt);

  // every fixture, every run, both directions — reconciled first so the
  // baseline is the spec the app actually holds
  const cases = NAMES.flatMap((name) => {
    const spec = reconcileSpec(fx(name) as unknown as RoomSpec, { photoCount: 1 }) as KitchenSpec;
    return spec.runs.flatMap((run) => [1.2, 0.8].map((scale) => ({ name, spec, run, scale })));
  });
  // ±20% is the resize the fit actually asks for, and the width invariant below
  // is stated in inches, so it is the range 12.1/12.2 are measured over. The
  // two invariants that are stated as ABSOLUTES — a fixed member never moves,
  // and a second pass changes nothing — hold at any length, and both of them
  // were false outside ±20% while a ±20% sample certified them: a 0.7x run lost
  // an appliance gap, and 1.1x on a 2.5 ft run drifted a door 30in → 33in on the
  // second call. So they are sampled 0.3x–3.0x.
  const wideCases = NAMES.flatMap((name) => {
    const spec = reconcileSpec(fx(name) as unknown as RoomSpec, { photoCount: 1 }) as KitchenSpec;
    return spec.runs.flatMap((run) => [3, 2.5, 2, 1.5, 1.2, 1.1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3].map((scale) => ({ name, spec, run, scale })));
  });

  // 12.1 THE INVARIANT §1.3 ASSERTS, but after an arbitrary length change:
  //      the base widths still add up to the run they sit on.
  {
    const bad: string[] = [];
    let worst = 0, worstWhat = '';
    for (const c of cases) {
      const run = clone(c.run);
      const got = setRunLength(run, c.run.lengthFt * c.scale, wallFtOf(c.spec, run.wall));
      const off = Math.abs(sum(run.base) - got * 12);
      if (off > worst) { worst = off; worstWhat = `${c.name}/${run.id} ${c.scale}x`; }
      if (off > ROW_TOL_IN) bad.push(`${c.name}/${run.id} ${c.scale}x: ${sum(run.base).toFixed(1)}in of ${(got * 12).toFixed(1)}in`);
    }
    if (bad.length) fail(`base widths follow a resized run: ${bad.join('; ')}`);
    else ok(`base widths follow a resized run: ${cases.length} resizes over 4 fixtures, worst ${worst.toFixed(1)}" (${worstWhat}), tolerance ${ROW_TOL_IN}"`);
  }

  // 12.2 THE WALL ROWS FOLLOW TOO — a stretched run whose uppers stay put
  //      hangs a row that stops short of the cabinets under it, and tier 2
  //      must end exactly where tier 1 does.
  {
    const bad: string[] = [];
    for (const c of cases) {
      const run = clone(c.run);
      if (!run.hasUppers) continue;
      const got = setRunLength(run, c.run.lengthFt * c.scale, wallFtOf(c.spec, run.wall));
      const off = Math.abs(sum(run.uppers) - got * 12);
      if (off > ROW_TOL_IN) bad.push(`${c.name}/${run.id} ${c.scale}x: uppers ${sum(run.uppers).toFixed(1)}in of ${(got * 12).toFixed(1)}in`);
      if (run.uppers2 && run.uppers2.length && Math.abs(sum(run.uppers2) - sum(run.uppers)) > 0.01) {
        bad.push(`${c.name}/${run.id} ${c.scale}x: tier 2 ${sum(run.uppers2).toFixed(1)}in against tier 1 ${sum(run.uppers).toFixed(1)}in`);
      }
    }
    if (bad.length) fail(`the wall rows follow a resized run: ${bad.join('; ')}`);
    else ok('the wall rows follow a resized run: tier 1 lands on the run, tier 2 lands on tier 1');
  }

  // 12.3 FIXED MEMBERS DO NOT SCALE. An `appliance-gap` is the width of the
  //      appliance that fills it and a `sink-base` is sized to its sink —
  //      stretching one to make the arithmetic work moves a dishwasher.
  {
    const bad: string[] = [];
    for (const c of wideCases) {
      const run = clone(c.run);
      const before = c.run.base.filter((b) => FIXED_BASE.has(b.type)).map((b) => `${b.type}:${b.widthIn}`).join(',');
      setRunLength(run, c.run.lengthFt * c.scale, wallFtOf(c.spec, run.wall));
      const after = run.base.filter((b) => FIXED_BASE.has(b.type)).map((b) => `${b.type}:${b.widthIn}`).join(',');
      if (before !== after) bad.push(`${c.name}/${run.id} ${c.scale}x: [${before}] → [${after}]`);
    }
    if (bad.length) fail(`fixed members hold through a resize: ${bad.join('; ')}`);
    else ok(`fixed members hold through a resize: every appliance gap, sink base and corner kept its width and its COUNT across ${wideCases.length} resizes, 0.3x–3.0x`);
  }

  // 12.4 IDEMPOTENT. Reconciling twice must not drift — this codebase has been
  //      bitten by that class twice (see the tier-2 settle above).
  {
    const bad: string[] = [];
    for (const c of wideCases) {
      const once = clone(c.run);
      const got = setRunLength(once, c.run.lengthFt * c.scale, wallFtOf(c.spec, once.wall));
      const twice = clone(once);
      const got2 = setRunLength(twice, got, wallFtOf(c.spec, twice.wall));
      if (got2 !== got || JSON.stringify(twice) !== JSON.stringify(once)) {
        bad.push(`${c.name}/${once.id} ${c.scale}x: ${sum(once.base).toFixed(1)}in → ${sum(twice.base).toFixed(1)}in`);
      }
    }
    if (bad.length) fail(`a second resize changes nothing: ${bad.join('; ')}`);
    else ok(`a second resize changes nothing: ${wideCases.length} runs reconciled twice, 0.3x–3.0x, bit-identical`);
  }

  // 12.5 REFUSAL. When the fixed members alone overrun the new length there is
  //      no honest row: the run comes back LONGER than asked rather than
  //      shaving a dishwasher gap. client-marble's right run is exactly that —
  //      a 3.5 ft run holding nothing but a 36" appliance gap.
  {
    const bad: string[] = [];
    const marble = reconcileSpec(fx('client-marble') as unknown as RoomSpec, { photoCount: 1 }) as KitchenSpec;
    const run = clone(marble.runs.find((r) => r.id === 'run-right')!);
    const got = setRunLength(run, 2.8, wallFtOf(marble, run.wall));
    if (Math.abs(got - 3) > 0.01) bad.push(`client-marble/run-right shrank to ${got}ft, expected the 36" gap to hold it at 3ft`);
    if (Math.abs(sum(run.base) - got * 12) > 0.01) bad.push(`and its boxes came out ${sum(run.base).toFixed(1)}in of ${(got * 12).toFixed(1)}in`);
    if (run.base.some((b) => b.type === 'appliance-gap' && b.widthIn !== 36)) bad.push('the 36" gap was shaved');
    // and a run of nothing but fixed members refuses all the way down
    const twoGaps = clone(run);
    twoGaps.base = [{ widthIn: 36, type: 'appliance-gap', drawerCount: 0 }, { widthIn: 36, type: 'sink-base', drawerCount: 0 }];
    const got2 = setRunLength(twoGaps, 4, wallFtOf(marble, twoGaps.wall));
    if (Math.abs(got2 - 6) > 0.01 || Math.abs(sum(twoGaps.base) - 72) > 0.01) {
      bad.push(`a gap + a sink base asked for 4ft came back ${got2}ft / ${sum(twoGaps.base).toFixed(1)}in, expected 6ft / 72in`);
    }
    if (bad.length) fail(`a run refuses to shrink past its fixed members: ${bad.join('; ')}`);
    else ok('a run refuses to shrink past its fixed members: 2.8ft → 3ft on client-marble/run-right, 4ft → 6ft on a gap + a sink base');
  }

  // 12.7 THE NARROW REPAIR, for the spec `fitToPhoto` keeps when it throws the
  //      reconciler's version away wholesale ("kept the fitted spec
  //      un-reconciled") — the runs are stretched and the cabinets were left
  //      behind. `followRunLengths` refits the rows and touches nothing else.
  {
    const bad: string[] = [];
    const rows: string[] = [];
    for (const name of NAMES) {
      const spec = reconcileSpec(fx(name) as unknown as RoomSpec, { photoCount: 1 }) as KitchenSpec;
      // what the search does: the LENGTH moves, the boxes do not
      const stretched = clone(spec);
      for (const run of stretched.runs) run.lengthFt = Math.min(wallFtOf(stretched, run.wall), run.lengthFt * 1.15);
      const worstBefore = Math.max(...stretched.runs.map((r) => Math.abs(sum(r.base) - r.lengthFt * 12) / (r.lengthFt * 12)));
      const followed = followRunLengths(stretched as unknown as RoomSpec) as KitchenSpec;
      const worstAfter = Math.max(...followed.runs.map((r) => Math.abs(sum(r.base) - r.lengthFt * 12) / (r.lengthFt * 12)));
      // the argument is untouched, and nothing outside the runs moves
      if (JSON.stringify(stretched.runs) === JSON.stringify(followed.runs) && worstBefore > 0.1) bad.push(`${name}: nothing followed`);
      if (JSON.stringify({ ...stretched, runs: null }) !== JSON.stringify({ ...followed, runs: null })) bad.push(`${name}: it moved something outside the runs`);
      if (worstAfter > 0.1) bad.push(`${name}: worst run still ${(worstAfter * 100).toFixed(1)}% off`);
      const twice = followRunLengths(followed as unknown as RoomSpec) as KitchenSpec;
      if (JSON.stringify(twice.runs) !== JSON.stringify(followed.runs)) bad.push(`${name}: a second pass drifted`);
      rows.push(`${name} ${(worstBefore * 100).toFixed(1)}% → ${(worstAfter * 100).toFixed(1)}%`);
    }
    if (bad.length) fail(`followRunLengths repairs a stretched spec: ${bad.join('; ')}`);
    else ok(`followRunLengths repairs a stretched spec (worst run, §1.3's own measure): ${rows.join(', ')}`);
  }

  // 12.6 AND IT IS DRAWN. The payoff is geometric: before this, a stretched run
  //      drew the shortfall as one long filler panel. The drawn cabinets must
  //      cover the run they were fitted to.
  {
    const bad: string[] = [];
    const notes: string[] = [];
    for (const name of NAMES) {
      const spec = reconcileSpec(fx(name) as unknown as RoomSpec, { photoCount: 1 }) as KitchenSpec;
      const grown = clone(spec);
      for (const run of grown.runs) setRunLength(run, run.lengthFt * 1.2, wallFtOf(grown, run.wall));
      const L = computeKitchenLayout(grown);
      for (const r of L.runs) {
        const filler = r.base.filter((b) => b.type === 'filler').reduce((n, b) => n + b.width, 0) / 0.0254;
        // a filler under one cabinet is real carpentry; a filler over one is
        // the missing cabinet this section exists to stop
        if (filler >= 9) bad.push(`${name}/${r.id}: ${filler.toFixed(1)}" of filler in a stretched run`);
        else notes.push(`${name}/${r.id} ${filler.toFixed(1)}"`);
      }
    }
    if (bad.length) fail(`a stretched run draws cabinets, not filler: ${bad.join('; ')}`);
    else ok(`a stretched run draws cabinets, not filler: worst ${notes.length} runs all under one cabinet of filler`);
  }
}

// Measurement entry and rendering share DimsZ's 4–80 ft envelope.
for (const [widthFt, depthFt] of [[4, 4], [80, 80], [4, 80], [80, 4]]) {
  const L = computeKitchenLayout({ ...base, dims: { ...base.dims, widthFt, depthFt } });
  const parts = buildKitchenPartsRaw(L);
  const finite = parts.every((part) => {
    const p = part.geometry.getAttribute('position');
    for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) return false;
    return true;
  });
  if (!near(L.w, widthFt * 0.3048) || !near(L.d, depthFt * 0.3048) || !finite) fail(`confirmed ${widthFt}×${depthFt}ft room was clamped or produced invalid geometry`);
  else ok(`confirmed ${widthFt}×${depthFt}ft room draws exactly; ${parts.length} finite parts`);
}

// An unshadowed area source must stop at the actual opaque treatment geometry.
for (const kind of ['none', 'roman-shade', 'roller', 'cafe-curtain', 'curtains', 'blinds'] as const) {
  const spec = defaultKitchen();
  spec.decor.windowTreatment = kind;
  const L = computeKitchenLayout(spec);
  const windows = kitchenDaylightWindows(L);
  const raw = buildKitchenPartsRaw(L);
  const bad: string[] = [];
  for (const [i, source] of windows.entries()) {
    const opening = L.openings.filter((o) => o.kind === 'window')[i];
    if (source.sill < opening.sill - 1e-5 || source.sill + source.height > opening.sill + opening.height + 1e-5 || source.width > opening.width + 1e-5 || source.transmission < 0 || source.transmission > 1) bad.push('source escaped its opening');
    const treatment = L.decor.treatments.find((t) => t.openingId === opening.id);
    if (treatment && ['roman-shade', 'roller', 'cafe-curtain'].includes(kind)) {
      const cover = raw.filter((p) => p.key.includes(`${treatment.id}-`) && !p.key.endsWith('-tube'));
      const bounds = cover.map((p) => {
        p.geometry.computeBoundingBox();
        const b = p.geometry.boundingBox!;
        return [b.min.y + (p.position?.[1] ?? 0), b.max.y + (p.position?.[1] ?? 0)];
      });
      if (!bounds.length) bad.push('no treatment geometry checked');
      if (kind === 'cafe-curtain' ? bounds.some((b) => b[1] > source.sill + 1e-4) : bounds.some((b) => b[0] < source.sill + source.height - 1e-4)) bad.push('source passes through opaque treatment geometry');
    }
  }
  if (bad.length || !windows.length) fail(`${kind} daylight aperture: ${bad.join('; ') || 'no source'}`);
  else ok(`${kind} daylight stays inside glazing and outside its modeled covering`);
}

console.log(failures ? `\nFAILED (${failures})\n` : '\nALL KITCHEN CHECKS PASSED\n');
process.exit(failures ? 1 : 0);
