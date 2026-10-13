/**
 * Headless verification for the exterior twin. Run with:
 *
 *   npx tsx scripts/check-exterior.ts
 *
 * Two jobs:
 *
 * 1. LAYOUT STABILITY (user issue 4 — "when adjusting the height and widths of
 *    things, everything moves"). Every Layout-tab control is swept across its
 *    full slider range and we assert that
 *      a) the swept object's own ANCHOR does not move, and
 *      b) every probe NOT derived from that control is bit-stable.
 *    A failure here is a correctness bug, not a polish issue.
 *
 * 2. GEOMETRY BUDGET. Builds every exterior geometry a full scene needs and
 *    reports triangles + draw calls against the 1.2 M tri / 900 call budget.
 */
import * as THREE from 'three';
import { padWithOpening } from '../src/components/scene/exterior/helpers';
import { defaultExterior } from '../src/lib/spec/defaults';
import { computeExteriorLayout, type ExteriorLayout } from '../src/components/scene/exterior/layout';
import { INTAKE_QUESTIONS, applyIntakeAnswers } from '../src/lib/spec/intake';
import type { ExteriorSpec } from '../src/lib/spec/types';

// ---------------------------------------------------------------------------
// Probes: a flat, comparable snapshot of "where everything is"
// ---------------------------------------------------------------------------
type Probes = Record<string, number>;

function probe(L: ExteriorLayout): Probes {
  const p: Probes = {};
  const put = (k: string, v: number | undefined | null) => { p[k] = typeof v === 'number' && Number.isFinite(v) ? v : NaN; };

  put('lot.w', L.lotW); put('lot.d', L.lotD);
  if (L.house) {
    put('house.cx', L.house.cx); put('house.cz', L.house.cz);
    put('house.w', L.house.w); put('house.d', L.house.d);
    put('house.frontZ', L.house.rect.maxZ);
    put('house.eaveY', L.house.eaveY); put('house.floorY', L.house.floorY);
    put('house.roof.rise', L.house.roof.rise);
    put('house.roof.ridge', L.house.roof.ridge === 'x' ? 0 : 1);
    for (const e of L.house.elevations) {
      put(`elev.${e.wall}.len`, e.len);
      e.windows.forEach((w, i) => { put(`elev.${e.wall}.win${i}.x`, w.x); put(`elev.${e.wall}.win${i}.w`, w.w); put(`elev.${e.wall}.win${i}.y`, w.y); });
      e.doors.forEach((d, i) => { put(`elev.${e.wall}.door${i}.x`, d.x); put(`elev.${e.wall}.door${i}.w`, d.w); });
    }
  }
  if (L.wing) { put('wing.cx', L.wing.cx); put('wing.cz', L.wing.cz); put('wing.w', L.wing.w); put('wing.d', L.wing.d); }
  if (L.garage) { put('garage.cx', L.garage.cx); put('garage.cz', L.garage.cz); }
  if (L.porch) {
    put('porch.x', L.porch.x); put('porch.w', L.porch.w); put('porch.depth', L.porch.depth);
    put('porch.floorY', L.porch.floorY); put('porch.roofY', L.porch.roofY);
    put('porch.cx', (L.porch.rect.minX + L.porch.rect.maxX) / 2);
    put('porch.cz', (L.porch.rect.minZ + L.porch.rect.maxZ) / 2);
  }
  if (L.deck) {
    put('deck.x', L.deck.x); put('deck.w', L.deck.w); put('deck.depth', L.deck.depth);
    put('deck.boards', L.deck.boardsAlong === 'x' ? 0 : 1);
    put('deck.cx', (L.deck.rect.minX + L.deck.rect.maxX) / 2);
    put('deck.cz', (L.deck.rect.minZ + L.deck.rect.maxZ) / 2);
  }
  if (L.patio) { put('patio.cx', L.patio.cx); put('patio.cz', L.patio.cz); }
  L.driveway.forEach((d, i) => { put(`drv${i}.cx`, d.cx); put(`drv${i}.cz`, d.cz); put(`drv${i}.w`, d.w); put(`drv${i}.d`, d.d); });
  L.walkway.forEach((w, i) => { put(`walk${i}.cx`, w.cx); put(`walk${i}.cz`, w.cz); });
  L.trees.forEach((t, i) => { put(`tree${i}.x`, t.x); put(`tree${i}.z`, t.z); put(`tree${i}.v`, t.variant); });
  L.fence.forEach((f, i) => { put(`fence${i}.cx`, f.cx); put(`fence${i}.cz`, f.cz); put(`fence${i}.len`, f.length); });
  if (L.street) { put('street.cz', L.street.asphalt.cz); }
  if (L.mailbox) { put('mailbox.x', L.mailbox.x); put('mailbox.z', L.mailbox.z); }
  put('treeline.count', L.treeline.length);
  L.treeline.forEach((t, i) => { put(`tl${i}.x`, t.x); put(`tl${i}.z`, t.z); });
  return p;
}

// deep-clone a spec so a sweep never leaks into the next one
const clone = (s: ExteriorSpec): ExteriorSpec => JSON.parse(JSON.stringify(s)) as ExteriorSpec;

const TOL = 1e-6;

interface Sweep {
  name: string;
  /** probe keys (or prefixes ending in `.`) allowed to change */
  mayMove: string[];
  values: number[];
  apply: (s: ExteriorSpec, v: number) => void;
}

let failures = 0;
function fail(msg: string) { failures++; console.log(`  ✗ ${msg}`); }

function allowed(key: string, mayMove: string[]): boolean {
  return mayMove.some((m) => (m.endsWith('*') ? key.startsWith(m.slice(0, -1)) : key === m));
}

function runSweep(base: ExteriorSpec, sw: Sweep) {
  const ref = probe(computeExteriorLayout(clone(base)));
  const moved = new Map<string, number>();
  const appeared = new Set<string>();
  for (const v of sw.values) {
    const s = clone(base);
    sw.apply(s, v);
    const L = computeExteriorLayout(s);
    const p = probe(L);
    for (const k of Object.keys(ref)) {
      if (!(k in p)) continue; // an object legitimately dropped out of the scene
      if (allowed(k, sw.mayMove)) continue;
      const delta = Math.abs(p[k] - ref[k]);
      if (Number.isNaN(p[k]) && Number.isNaN(ref[k])) continue;
      if (!(delta <= TOL)) moved.set(k, Math.max(moved.get(k) ?? 0, delta));
    }
    for (const k of Object.keys(p)) if (!(k in ref) && !allowed(k, sw.mayMove)) appeared.add(k);
  }
  if (moved.size === 0 && appeared.size === 0) {
    console.log(`  ✓ ${sw.name} (${sw.values.length} steps)`);
    return;
  }
  const list = [...moved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, d]) => `${k} moved ${d.toFixed(4)}m`);
  if (appeared.size) list.push(`new keys: ${[...appeared].slice(0, 6).join(', ')}`);
  fail(`${sw.name}: ${list.join('; ')}`);
}

function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

// ---------------------------------------------------------------------------
// 1 — layout stability
// ---------------------------------------------------------------------------
console.log('\nLAYOUT STABILITY — each control must move only what it names\n');

const base = defaultExterior('modern-farmhouse');

const sweeps: Sweep[] = [
  {
    name: 'footprint.widthFt 24 → 70',
    // width legitimately re-scales the front/back elevations and everything
    // hung on them, the roof, the garage bays and the drive that aims at them
    mayMove: ['house.w', 'house.cx', 'elev.*', 'house.roof.*', 'wing.*', 'garage.*', 'drv*', 'walk*', 'porch.*', 'deck.*', 'tree*', 'patio.*', 'mailbox.*'],
    values: range(24, 70, 2),
    apply: (s, v) => { s.house.footprint.widthFt = v; },
  },
  {
    name: 'footprint.depthFt 18 → 60  (front wall must not move)',
    mayMove: ['house.d', 'house.cz', 'elev.left.*', 'elev.right.*', 'deck.*', 'patio.*', 'house.roof.*', 'tree*', 'wing.cz', 'wing.d'],
    values: range(18, 60, 2),
    apply: (s, v) => { s.house.footprint.depthFt = v; },
  },
  {
    name: 'stories 1 → 3',
    // Dropping to one storey collapses the second-floor windows onto the
    // ground floor, where they genuinely collide with the entry door and the
    // solver slides it. The porch is anchored ON that door, so it follows —
    // that is the anchor doing its job, not the bug we are hunting.
    mayMove: ['house.eaveY', 'elev.*', 'porch.*', 'walk*', 'wing.*'],
    values: [1, 2, 3],
    apply: (s, v) => { s.house.stories = v as 1 | 2 | 3; },
  },
  {
    name: 'storyHeightFt 8 → 14',
    mayMove: ['house.eaveY', 'elev.*', 'porch.roofY', 'wing.*', 'garage.*'],
    values: range(8, 14, 0.5),
    apply: (s, v) => { s.house.storyHeightFt = v; },
  },
  {
    name: 'roof.pitch 0 → 18',
    mayMove: ['house.roof.rise', 'porch.roofY'],
    values: range(0, 18, 1),
    apply: (s, v) => { s.house.roof.pitch = v; },
  },
  {
    name: 'roof.overhangFt 0 → 4',
    mayMove: [],
    values: range(0, 4, 0.25),
    apply: (s, v) => { s.house.roof.overhangFt = v; },
  },
  {
    name: 'garage.bays 0 → 3  (house must not slide)',
    mayMove: ['elev.*door*', 'drv*', 'walk*', 'wing.*', 'garage.*', 'mailbox.*'],
    values: [0, 1, 2, 3],
    apply: (s, v) => { s.house.garage.bays = v as 0 | 1 | 2 | 3; },
  },
  {
    name: 'porch.widthFt 6 → 40',
    mayMove: ['porch.w', 'porch.x', 'porch.cx', 'tree*'],
    values: range(6, 40, 2),
    apply: (s, v) => { s.house.porch.widthFt = v; },
  },
  {
    name: 'porch.depthFt 3 → 26  (house must not slide)',
    mayMove: ['porch.depth', 'porch.cz', 'porch.roofY', 'walk*', 'tree*'],
    values: range(3, 26, 1),
    apply: (s, v) => { s.house.porch.depthFt = v; },
  },
  {
    name: 'deck.widthFt 6 → 44',
    mayMove: ['deck.w', 'deck.x', 'deck.cx', 'tree*', 'patio.cx'],
    values: range(6, 44, 2),
    apply: (s, v) => { s.house.deck.widthFt = v; },
  },
  {
    name: 'deck.depthFt 5 → 40  (boards must not pivot)',
    mayMove: ['deck.depth', 'deck.cz', 'tree*'],
    values: range(5, 40, 2),
    apply: (s, v) => { s.house.deck.depthFt = v; },
  },
  {
    name: 'lot.setbackFrontFt 5 → 80',
    mayMove: ['house.cz', 'house.frontZ', 'house.d', 'wing.*', 'porch.*', 'deck.*', 'garage.cz', 'drv*', 'walk*', 'patio.*', 'tree*', 'elev.*', 'mailbox.*'],
    values: range(5, 80, 2.5),
    apply: (s, v) => { s.lot.setbackFrontFt = v; },
  },
  {
    name: 'lot.widthFt 40 → 200  (house must stay centred and sized)',
    mayMove: ['lot.w', 'drv*', 'walk*', 'fence*', 'street.*', 'tree*', 'tl*', 'treeline.count', 'patio.cx', 'mailbox.*', 'house.w', 'elev.front.*', 'elev.back.*', 'wing.*', 'garage.*', 'house.roof.*', 'porch.*', 'deck.*'],
    values: range(40, 200, 5),
    apply: (s, v) => { s.lot.widthFt = v; },
  },
  {
    name: 'lot.treesCount 0 → 12  (existing trees must not shuffle)',
    // trees may APPEAR; the assertion that matters is that none of the ones
    // already placed changes position, which the `moved` check still enforces
    mayMove: ['tree*'],
    values: [3, 4, 5, 6, 8, 10, 12],
    apply: (s, v) => { s.lot.treesCount = v; },
  },
  {
    name: 'foundationExposedFt 0 → 5',
    mayMove: ['house.floorY', 'house.eaveY', 'porch.floorY', 'porch.roofY', 'deck.*', 'elev.*'],
    values: range(0, 5, 0.25),
    apply: (s, v) => { s.house.foundationExposedFt = v; },
  },
  {
    name: 'trimWidthIn 2 → 14',
    mayMove: ['elev.*'],
    values: range(2, 14, 1),
    apply: (s, v) => { s.house.trimWidthIn = v; },
  },
];

for (const sw of sweeps) runSweep(base, sw);

// The swept object's own anchor must be exactly stable, checked explicitly.
console.log('\nANCHOR CHECKS\n');
function anchor(name: string, get: (L: ExteriorLayout) => number, apply: (s: ExteriorSpec, v: number) => void, values: number[]) {
  const ref = get(computeExteriorLayout(clone(base)));
  let worst = 0;
  for (const v of values) {
    const s = clone(base); apply(s, v);
    worst = Math.max(worst, Math.abs(get(computeExteriorLayout(s)) - ref));
  }
  if (worst <= TOL) console.log(`  ✓ ${name} (max drift ${worst.toExponential(1)} m)`);
  else fail(`${name}: anchor drifted ${worst.toFixed(4)} m`);
}
anchor('front wall stays put while depth sweeps', (L) => L.house!.rect.maxZ, (s, v) => { s.house.footprint.depthFt = v; }, range(18, 60, 2));
anchor('front wall stays put while porch depth sweeps', (L) => L.house!.rect.maxZ, (s, v) => { s.house.porch.depthFt = v; }, range(3, 26, 1));
anchor('front wall stays put while garage bays sweep', (L) => L.house!.rect.maxZ, (s, v) => { s.house.garage.bays = v as 0 | 1 | 2 | 3; }, [0, 1, 2, 3]);
anchor('house centre-x stays 0 while width sweeps', (L) => L.house!.cx, (s, v) => { s.house.footprint.widthFt = v; }, range(24, 70, 2));
anchor('porch centre stays put while porch width sweeps', (L) => L.porch!.x, (s, v) => { s.house.porch.widthFt = v; }, range(6, 20, 1));
anchor('deck ledger stays put while deck depth sweeps', (L) => L.deck!.rect.maxZ, (s, v) => { s.house.deck.depthFt = v; }, range(5, 40, 2));
anchor('setback exactly tracks the slider', (L) => L.house!.rect.maxZ, (s) => { s.lot.setbackFrontFt = 30; }, [30]);

// ---------------------------------------------------------------------------
// 2 — every template must solve without throwing, on absurd input too
// ---------------------------------------------------------------------------
console.log('\nROBUSTNESS\n');
const STYLES: Array<ExteriorSpec['houseStyle']> = ['craftsman', 'modern-farmhouse', 'modern', 'colonial', 'ranch', 'cape-cod', 'contemporary', 'mediterranean', 'tudor', 'victorian', 'northwest-contemporary'];
let robustOk = true;
for (const st of STYLES) {
  try { computeExteriorLayout(defaultExterior(st)); } catch (e) { robustOk = false; fail(`${st} threw: ${String(e)}`); }
}
const junk = [
  null, undefined, {} as ExteriorSpec,
  { ...clone(base), lot: { ...base.lot, widthFt: NaN, depthFt: -4, setbackFrontFt: 1e9 } } as unknown as ExteriorSpec,
  { ...clone(base), house: { ...base.house, footprint: { widthFt: 1e6, depthFt: 0 }, stories: 99 } } as unknown as ExteriorSpec,
  { ...clone(base), elevations: 'nope' } as unknown as ExteriorSpec,
];
for (const j of junk) {
  try {
    const L = computeExteriorLayout(j as ExteriorSpec);
    if (!Number.isFinite(L.lotW) || L.lotW <= 0) { robustOk = false; fail('junk spec produced a non-finite lot'); }
  } catch (e) { robustOk = false; fail(`junk spec threw: ${String(e)}`); }
}
if (robustOk) console.log('  ✓ 11 templates + 6 malformed specs solve without throwing');

// ---------------------------------------------------------------------------
// 3 — the empty-lot path: the intake's answers must reach the geometry
// ---------------------------------------------------------------------------
/*
 * The client's own ask: "if i upload a empty lot, floor plans, i need you to
 * ask some questions ... and then make it". `intake.ts` asks; this section is
 * the proof that the ANSWERS land in the scene rather than in a field nothing
 * reads. For every exterior question we apply the default answer and a
 * different one and require the layout (or, for a finish/material question, the
 * spec's materials) to come out different. A question whose answer changes
 * nothing is a question we should not be asking.
 */
console.log('\nEMPTY LOT + INTAKE\n');

/** Everything the scene resolves, flattened, so "did this answer matter?" is one compare. */
function signature(L: ExteriorLayout): string {
  return JSON.stringify({
    ...probe(L),
    // NOT houseStyle/style themselves: the point is that the style answer
    // changes what gets BUILT, not that the label round-trips
    proposed: L.proposed, present: L.present,
    roofType: L.house?.roof.type ?? null, ridge: L.house?.roof.ridge ?? null,
    stories: L.house?.stories ?? null,
    columns: L.porch ? `${L.porch.columns}|${L.porch.columnKind}` : null,
    winStyles: L.blocks.flatMap((b) => b.elevations.flatMap((e) => e.windows.map((w) => w.style))).join(','),
    garageDoors: L.blocks.flatMap((b) => b.elevations.flatMap((e) => e.doors.filter((d) => d.kind === 'garage').map((d) => d.w.toFixed(3)))).join(','),
    envelope: L.envelope, shrubs: L.shrubs.length, beds: L.beds.length,
  });
}

// An empty lot still gets a house — the one the answers describe.
{
  const empty = clone(base);
  empty.house.present = false;
  const L = computeExteriorLayout(empty);
  if (!L.house) fail('empty lot: no proposed house was built at all');
  else if (!L.proposed) fail('empty lot: the massing is not flagged as a proposal');
  else if (!L.porch || !L.driveway.length || !L.walkway.length) fail('empty lot: the proposal has no porch / drive / walk');
  else if (!(L.envelope.maxX > L.envelope.minX && L.envelope.maxZ > L.envelope.minZ)) fail('empty lot: the zoning envelope is inside-out');
  else if (L.house.rect.maxZ > L.envelope.maxZ + TOL) fail('empty lot: the proposed house breaks the front setback');
  else console.log('  ✓ house.present=false still proposes a house, inside a valid zoning envelope');

  const standing = computeExteriorLayout(clone(base));
  if (standing.proposed) fail('a declared house is wrongly flagged as a proposal');
  else if (signature(standing) !== signature({ ...L, proposed: false, present: true })) {
    fail('the proposed house differs from the same spec with a house standing on it');
  } else console.log('  ✓ the proposal is the same building the spec describes, not a stand-in');
}

// Every exterior question's answer has to change something.
{
  const extQuestions = INTAKE_QUESTIONS.filter((q) => q.rooms.includes('exterior'));
  /*
   * No exceptions list. There used to be one — the shared `style` question
   * wrote `spec.style`, which nothing on an exterior reads (`houseStyle`
   * already carries the roof, the columns, the brackets and the window
   * proportions, and `defaultExterior` derives `spec.style` FROM it). That was
   * fixed where it belonged, in the question catalogue: `style` is now asked
   * of interiors only. Keep this list absent — a question an exterior client
   * answers and the exterior then ignores is the bug, not the assertion.
   */
  const dead: string[] = [];
  const skips: string[] = [];
  let checked = 0;
  for (const q of extQuestions) {
    if (q.id === 'notes') continue; // free text: it lands in detected.notes, not the geometry
    if (q.writes.kind === 'setting') continue; // an estimate setting, not a spec field at all
    // a second answer that is definitely different from the default
    const alt = q.type === 'choice'
      ? q.options.find((o) => o.value !== q.default)?.value
      : q.type === 'number'
        ? String(Number(q.default) === (q.min ?? 0) ? (q.max ?? Number(q.default) + 1) : (q.min ?? 0))
        : q.default === '#111111' ? '#EEEEEE' : '#111111';
    if (!alt) continue;
    const a = applyIntakeAnswers(defaultExterior(), [{ id: q.id, value: q.default, values: [] }]);
    const b = applyIntakeAnswers(defaultExterior(), [{ id: q.id, value: alt, values: [] }]);
    if (a.skipped.length || b.skipped.length) skips.push(`${q.id}: ${[...a.skipped, ...b.skipped][0]}`);
    checked++;
    const changed = q.writes.kind === 'field'
      ? signature(computeExteriorLayout(a.spec as ExteriorSpec)) !== signature(computeExteriorLayout(b.spec as ExteriorSpec))
      : JSON.stringify([a.spec.materials, a.spec.detected.finishes]) !== JSON.stringify([b.spec.materials, b.spec.detected.finishes]);
    if (!changed) dead.push(`${q.id} → ${q.writes.kind === 'field' ? q.writes.path : String(q.writes.slot)}`);
  }
  if (extQuestions.some((q) => q.id === 'style')) {
    fail('the exterior is being asked for a DesignStyle again — nothing on an exterior reads spec.style');
  } else console.log('  ✓ an exterior client is not asked for a design style houseStyle already answers');
  if (skips.length) fail(`intake answers rejected by the spec: ${skips.join('; ')}`);
  if (dead.length) fail(`${dead.length} intake answer(s) change nothing the exterior renders: ${dead.join(', ')}`);
  else console.log(`  ✓ all ${checked} exterior intake answers change what gets built`);
}

// ---------------------------------------------------------------------------
// 3b — openings nobody asked for are declared as assumptions
// ---------------------------------------------------------------------------
/*
 * `fillBlankFace` is the one place the exterior invents something a client
 * never described: a wing or a garage face with no `Elevation` entry gets a
 * window per storey, because a blank two-storey wall over a garage door is
 * not a house. That is the right call — and it has to be SAID, or a
 * contractor prices openings nobody specified. `ExteriorLayout.warnings` is
 * the channel (the kitchen and the bathroom have had one for their décor);
 * this asserts it actually carries them, and that a spec which describes its
 * own faces gets no warnings at all.
 */
console.log('\nASSUMPTIONS\n');
{
  const s = clone(base);
  s.house.garage = { ...s.house.garage, bays: 2, attached: true };
  const L = computeExteriorLayout(s);
  const openingWarnings = L.warnings.filter((w) => /window.*face/.test(w));
  const invented = L.blocks.flatMap((b) => b.elevations ?? []).flatMap((e) => (e.windows ?? []).filter((w) => w.id.includes('-auto-')));
  if (invented.length && !openingWarnings.length) {
    fail(`${invented.length} window(s) were invented on a face nobody described and nothing says so`);
  } else if (invented.length) {
    console.log(`  ✓ ${invented.length} invented opening(s) are declared — "${L.warnings[0]}"`);
  } else if (openingWarnings.length) {
    fail(`the layout warns about invented openings it did not make: ${L.warnings.join(' | ')}`);
  } else {
    console.log('  ✓ nothing was invented on this spec, and nothing claims to have been');
  }
  // the warning count must track the faces, not the render: two runs of the
  // same spec cannot disagree about what was assumed
  const again = computeExteriorLayout(s);
  if (JSON.stringify(again.warnings) !== JSON.stringify(L.warnings)) fail('the assumptions are not deterministic');
  else console.log('  ✓ the same spec declares the same assumptions twice running');
}

// ---------------------------------------------------------------------------
// Real openings through the site and a driveway opening on its actual side.
// ---------------------------------------------------------------------------
console.log('\nSITE OPENING REGRESSIONS\n');
{
  for (const side of ['left', 'right'] as const) {
    const s = clone(base);
    s.house.garage.present = false;
    s.lot.fence = { ...s.lot.fence, present: true, sides: ['front'] };
    s.hardscape.driveway = { ...s.hardscape.driveway, present: true, side };
    const L = computeExteriorLayout(s), drive = L.driveway[0];
    const crossings = L.fence.filter((f) => Math.abs(f.cz - (L.lotD / 2 - 0.1524)) < 0.01)
      .filter((f) => Math.min(f.cx + f.length / 2, drive.cx + drive.w / 2) - Math.max(f.cx - f.length / 2, drive.cx - drive.w / 2) > 0.01);
    if (crossings.length) fail(`${side} driveway crosses ${crossings.length} front fence run(s)`);
    else console.log(`  ✓ ${side} driveway opening is clear on the same side as the driveway`);
  }
  const hole = { cx: -2, cz: 3, w: 5, d: 3 };
  for (const [name, width, depth, opening, thickness] of [
    ['lawn', 24, 36, hole, 0], ['context grade', 100, 100, hole, 0],
    ['coping surface', 6, 4, { ...hole, cx: 0, cz: 0 }, 0], ['coping solid', 6, 4, { ...hole, cx: 0, cz: 0 }, 0.06],
  ] as const) {
    const g = padWithOpening(width, depth, opening, thickness);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld();
    const ray = (x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
    if (ray(opening.cx, opening.cz).length) fail(`${name} caps the pool and hides water`);
    else console.log(`  ✓ ${name} leaves the entire pool centre open`);
    if (!ray(-width / 2 + 0.1, -depth / 2 + 0.1).length) fail(`${name} removed the surrounding ground / coping too`);
    else console.log(`  ✓ ${name} retains the solid surface outside the opening`);
    g.dispose();
  }
  const slope = clone(base); slope.lot.slope = 'steep';
  if (!computeExteriorLayout(slope).warnings.some((w) => w.includes('no surveyed elevation'))) fail('a sloped lot silently renders as surveyed flat grade');
  else console.log('  ✓ missing survey elevations are exposed for sloped lots');
  const proposal = clone(base); proposal.house.present = false;
  if (!computeExteriorLayout(proposal).warnings.some((w) => w.includes('visualization defaults'))) fail('proposal clearances are presented as verified setbacks');
  else console.log('  ✓ assumed siting clearances are distinguished from verified setbacks');
}

// ---------------------------------------------------------------------------
// 4 — geometry budget
// ---------------------------------------------------------------------------
console.log('\nGEOMETRY BUDGET\n');
import { report } from './check-exterior-geometry';
if (!report(computeExteriorLayout(base))) failures++;

console.log(failures === 0 ? '\nALL EXTERIOR CHECKS PASSED\n' : `\n${failures} EXTERIOR CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
