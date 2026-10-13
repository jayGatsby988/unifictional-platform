/**
 * MANHATTAN — headless verification for the ESTIMATOR.
 *
 *   npx tsx scripts/check-estimate.ts
 *   npx tsx scripts/check-estimate.ts --print-snapshot
 *
 * The client's complaint: "the pricing is so weird, without me even changing
 * anything it says a price." An untouched twin used to quote a whole
 * pull-and-replace of the room the photo shows. So:
 *
 * 1. CHANGES MODE. An untouched project prices at $0, every line tagged
 *    'unchanged', no allowance line at all, no weeks.
 * 2. FULL MODE IS UNTOUCHED. Toggling "Full remodel" reproduces the numbers
 *    this estimator has always produced, line for line, with or without a
 *    baseline in hand.
 * 3. EVERY KIND OF CHANGE. A material swap, a knock-on, an added element, a
 *    bigger run, a count, a removal, a layout move — each charges its own cost
 *    plus the trades it actually opens, and nothing else.
 * 4. PURITY. Two identical calls are deep-equal and nothing upstream moved.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BathroomSpec, EstimateLine, EstimateSettings, Estimate, ExteriorSpec, KitchenSpec, ProjectBaseline, RoomSpec } from '../src/lib/spec/types';
import { defaultBathroom, defaultExterior, defaultKitchen } from '../src/lib/spec/defaults';
import { CATALOG_BY_ID, materialsForSlot } from '../src/lib/materials/catalog';
import { ensureSpecMaterials } from '../src/lib/materials/match';
import { PRICE_BOOK } from '../src/lib/estimate/pricebook';
import { calculateEstimate, estimateMode, groupLines } from '../src/lib/estimate/estimator';
import { deriveUppers2 } from '../src/lib/spec/uppers';

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const section = (n: string) => console.log(`\n${n}`);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const S: EstimateSettings = {
  region: 'seattle', tier: 'standard', contingencyPct: 0.1, markupPct: 0.2,
  scope: 'pull-and-replace', includePermits: true, mode: 'changes', includeKnockOns: true,
};
const FULL: EstimateSettings = { ...S, mode: 'full' };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/**
 * A fixture priced against the materials it DECLARES.
 *
 * `ensureSpecMaterials` is still run — it registers the synthesised
 * `custom-<slot>-<hash>` materials a spec may reference, and heals any id the
 * catalog no longer has — but where the fixture names a real catalog material
 * that id is kept. The price snapshot below is a pin on the ESTIMATOR's
 * arithmetic, not on the matcher's taste: when `match.ts` learns to score an
 * accent colour it legitimately picks a different, differently priced slab, and
 * that must not read as the estimator moving. (It did: countertop
 * ct-calacatta-quartz → ct-porcelain-slab and backsplash tile-marble-slab → a
 * synthesised custom moved four snapshot lines with no estimator change at all.)
 */
function fixture(name: string): KitchenSpec {
  const spec = JSON.parse(readFileSync(join(process.cwd(), 'scripts/fixtures', name), 'utf8')) as KitchenSpec;
  const declared = { ...(spec.materials as unknown as Record<string, string>) };
  ensureSpecMaterials(spec);
  const healed = spec.materials as unknown as Record<string, string>;
  for (const [slot, id] of Object.entries(declared)) if (CATALOG_BY_ID[id]) healed[slot] = id;
  return spec;
}
const selOf = (spec: RoomSpec): Record<string, string> => ({ ...(spec.materials as unknown as Record<string, string>) });
const baselineOf = (spec: RoomSpec, sel = selOf(spec)): ProjectBaseline => ({ spec, selections: sel, capturedAt: '2026-01-01T00:00:00.000Z', source: 'analysis' });
const byId = (est: Estimate, id: string): EstimateLine | undefined => est.lines.find((l) => l.id === id);
const inScopeIds = (est: Estimate) => est.lines.filter((l) => l.scope !== 'unchanged').map((l) => l.id);
const roomIds = (est: Estimate) => est.lines.filter((l) => !l.id.startsWith('allow-') && l.scope !== 'unchanged').map((l) => l.id);

const marble = fixture('client-marble.spec.json');
const marbleSel = selOf(marble);
const marbleBase = baselineOf(marble, marbleSel);

// ---------------------------------------------------------------------------
// The full-mode snapshot. Two tables on purpose.
//
// MEASURED is what the estimator produced before this stream — the number the
// client was shown. POST_FIX is what it produces now: identical on every line
// but `faucet`, which stopped compounding a per-pull finish multiplier onto a
// line that had already overridden the price group. Asserting both is the only
// way to prove the mode machinery changed nothing and the one price fix
// changed exactly one line.
//
// The full-mode deviation list, in full: `faucet`, on both fixtures, and
// nothing else. Every other line on client-marble AND client-shelves is
// byte-identical to the pre-stream run (§7 pins the shelves side, including
// the backsplash its custom-insert hood once silently shrank).
// ---------------------------------------------------------------------------
type Snap = Record<string, [number, number]>;
const MEASURED: Snap = {
  'cab-base': [9565, 15914], 'cab-upper': [9855, 16447], 'cab-tall': [4640, 7822], 'cab-island': [3548, 5745],
  'cab-crown': [284, 606], counter: [5349, 8663], 'island-top': [4841, 7841], backsplash: [8411, 21636],
  // `walls` was re-baselined once, deliberately: the paint deduction used to
  // subtract the ROOM's `cabinets.upperHeightIn` for every run, so a run
  // declared taller than the room default (client-tan's back run is 54" in a
  // 48" kitchen; client-marble's runs are uppers-to-ceiling, a 50.5" row in a
  // 42" kitchen) was quoted paint behind cabinets that are there. It now uses
  // `rowHeightIn(spec, run)` per run: 1081–1871 → 1048–1813 on this fixture.
  floor: [4896, 8383], walls: [1048, 1813], ceiling: [665, 1109], hardware: [1362, 2824], faucet: [2287, 4858],
  appliances: [5610, 11220], pendants: [766, 1558], recessed: [1619, 2904], 'window-treatment': [277, 730],
  'allow-demo': [1584, 3300], 'allow-electrical': [1980, 4620], 'allow-plumbing': [1584, 3960],
  'allow-drywall': [792, 2376], 'allow-design': [660, 3300], 'allow-permits': [792, 2904],
};
const MEASURED_TOTALS = { subtotalLow: 72415, subtotalHigh: 140533, totalLow: 105482, totalHigh: 204703, mid: 155093, weeks: [4, 9] };
const POST_FIX: Snap = { ...MEASURED, faucet: [1621, 3406] };
const POST_FIX_TOTALS = { subtotalLow: 71749, subtotalHigh: 139081, totalLow: 104511, totalHigh: 202588, mid: 153550, weeks: [4, 9] };

if (process.argv.includes('--print-snapshot')) {
  const e = calculateEstimate(marble, marbleSel, FULL);
  const rows = e.lines.map((l) => `  '${l.id}': [${l.totalLow}, ${l.totalHigh}],`).join('\n');
  console.log(`const SNAPSHOT: Snap = {\n${rows}\n};`);
  console.log(`const TOTALS = { subtotalLow: ${e.subtotalLow}, subtotalHigh: ${e.subtotalHigh}, totalLow: ${e.totalLow}, totalHigh: ${e.totalHigh}, mid: ${e.mid}, weeks: [${e.timelineWeeksLow}, ${e.timelineWeeksHigh}] };`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
section('§1  untouched fixture — the client\'s complaint');
// ---------------------------------------------------------------------------
{
  const before = JSON.stringify([marble, marbleSel, marbleBase]);
  const e = calculateEstimate(marble, marbleSel, S, marbleBase);
  if (e.mode !== 'changes') fail(`untouched: mode ${e.mode}`);
  if (e.subtotalLow || e.subtotalHigh || e.totalLow || e.totalHigh || e.mid) fail(`untouched: ${e.totalLow}–${e.totalHigh} (mid ${e.mid}), expected 0`);
  else ok('untouched project prices at $0');
  if (e.changedCount !== 0) fail(`untouched: changedCount ${e.changedCount}`);
  if (e.scopeShare !== 0) fail(`untouched: scopeShare ${e.scopeShare}`);
  if (e.lines.some((l) => l.id.startsWith('allow-'))) fail('untouched: an allowance line was priced');
  else ok('no allowance line at all when nothing changed');
  if (e.lines.length !== 17) fail(`untouched: ${e.lines.length} lines, expected 17 (23 legacy minus 6 allowances)`);
  else ok('17 lines — the 23 legacy lines minus the 6 allowances');
  for (const l of e.lines) {
    if (l.scope !== 'unchanged') { fail(`untouched: ${l.id} is '${l.scope}'`); break; }
    if (l.totalLow !== 0 || l.totalHigh !== 0) { fail(`untouched: ${l.id} charges ${l.totalLow}–${l.totalHigh}`); break; }
    if (!(l.fullTotalHigh > 0)) { fail(`untouched: ${l.id} has no full-remodel cost`); break; }
    if (l.baselineQty !== l.qty) { fail(`untouched: ${l.id} baselineQty ${l.baselineQty} ≠ qty ${l.qty}`); break; }
  }
  ok('every line unchanged, $0, with its full-remodel cost and baselineQty intact');
  if (e.timelineWeeksLow !== 0 || e.timelineWeeksHigh !== 0) fail(`untouched: ${e.timelineWeeksLow}–${e.timelineWeeksHigh} weeks`);
  else ok('0–0 weeks');
  if (e.full.mid !== POST_FIX_TOTALS.mid || e.full.totalLow !== POST_FIX_TOTALS.totalLow || e.full.totalHigh !== POST_FIX_TOTALS.totalHigh) {
    fail(`untouched: full block ${e.full.totalLow}–${e.full.totalHigh} mid ${e.full.mid}, expected ${POST_FIX_TOTALS.totalLow}–${POST_FIX_TOTALS.totalHigh} mid ${POST_FIX_TOTALS.mid}`);
  } else ok(`"Full remodel" secondary still reads $${e.full.mid.toLocaleString()}`);
  const again = calculateEstimate(marble, marbleSel, S, marbleBase);
  if (JSON.stringify(again) !== JSON.stringify(e)) fail('two identical calls differ');
  else if (JSON.stringify([marble, marbleSel, marbleBase]) !== before) fail('calculateEstimate mutated its inputs');
  else ok('pure: identical calls are deep-equal, inputs untouched');
}

// ---------------------------------------------------------------------------
section('§2  countertop only');
// ---------------------------------------------------------------------------
{
  const sel2 = { ...marbleSel, countertop: 'ct-soapstone' };
  const e = calculateEstimate(marble, sel2, S, marbleBase);
  const ids = inScopeIds(e).sort().join(',');
  if (ids !== 'allow-demo,allow-design,counter') fail(`countertop: in scope = ${ids}`);
  else ok('only the countertop, a demo allowance and a design allowance');
  const counter = byId(e, 'counter')!;
  const fullCounter = byId(calculateEstimate(marble, sel2, FULL), 'counter')!;
  if (counter.scope !== 'changed' || !counter.reason?.startsWith('material changed')) fail(`countertop: ${counter.scope} / ${counter.reason}`);
  if (counter.totalLow !== fullCounter.totalLow || counter.totalHigh !== fullCounter.totalHigh) fail(`countertop: ${counter.totalLow}–${counter.totalHigh} ≠ full ${fullCounter.totalLow}–${fullCounter.totalHigh}`);
  else ok(`the changed row charges its whole cost, ${counter.totalLow}–${counter.totalHigh}`);
  const demo = byId(e, 'allow-demo')!;
  if (demo.totalLow !== 317 || demo.totalHigh !== 660) fail(`countertop: allow-demo ${demo.totalLow}–${demo.totalHigh}, expected 317–660 (20% floor)`);
  const design = byId(e, 'allow-design')!;
  if (design.totalLow !== 66 || design.totalHigh !== 330) fail(`countertop: allow-design ${design.totalLow}–${design.totalHigh}, expected 66–330`);
  else ok('allowances at their floors: demo 317–660, design 66–330');
  if (e.trades.plumbing || e.trades.electrical || e.trades.drywall) fail(`countertop opened ${JSON.stringify(e.trades)}`);
  else ok('no plumber, no electrician, no drywall');
  if (e.timelineWeeksLow !== 1 || e.timelineWeeksHigh !== 3) fail(`countertop: ${e.timelineWeeksLow}–${e.timelineWeeksHigh} weeks, expected 1–3`);
  if (e.totalLow !== 8827 || e.totalHigh !== 14826 || e.mid !== 11827) fail(`countertop: ${e.totalLow}–${e.totalHigh} mid ${e.mid}, expected 8827–14826 mid 11827`);
  else ok('$8,827–14,826, midpoint $11,827, 1–3 weeks');
}

// ---------------------------------------------------------------------------
section('§3  island added');
// ---------------------------------------------------------------------------
{
  const noIsland = clone(marble); noIsland.island.present = false; ensureSpecMaterials(noIsland);
  const e = calculateEstimate(marble, marbleSel, S, baselineOf(noIsland, marbleSel));
  const cab = byId(e, 'cab-island')!, top = byId(e, 'island-top')!, hw = byId(e, 'hardware')!;
  if (cab.scope !== 'added' || cab.baselineQty !== 0 || cab.reason !== 'new' || cab.totalLow !== 3548 || cab.totalHigh !== 5745) fail(`island: cab-island ${cab.scope}/${cab.baselineQty}/${cab.reason} ${cab.totalLow}–${cab.totalHigh}`);
  if (top.scope !== 'added' || top.baselineQty !== 0 || top.totalLow !== 4841 || top.totalHigh !== 7841) fail(`island: island-top ${top.scope}/${top.baselineQty} ${top.totalLow}–${top.totalHigh}`);
  else ok('Island cabinetry 3,548–5,745 and Island top 4,841–7,841, both New');
  if (hw.scope !== 'added' || hw.qty !== 19 || hw.baselineQty !== 24) fail(`island: hardware ${hw.scope} qty ${hw.qty} was ${hw.baselineQty}`);
  else if (!near(hw.totalHigh, Math.round(2824 * 19 / 43), 2)) fail(`island: hardware high ${hw.totalHigh} ≉ ${Math.round(2824 * 19 / 43)}`);
  else ok('Cabinet hardware +19 ea, priced as 19/43 of the run');
  const others = roomIds(e).filter((id) => !['cab-island', 'island-top', 'hardware'].includes(id));
  if (others.length) fail(`island: also in scope ${others.join(',')}`);
  else ok('nothing else is priced');
  if (!e.trades.electrical) fail('island: electrical should be open');
  const permits = byId(e, 'allow-permits');
  if (!permits || permits.totalLow !== 198 || permits.totalHigh !== 726) fail(`island: allow-permits ${permits?.totalLow}–${permits?.totalHigh}, expected 198–726`);
  if (byId(e, 'allow-plumbing')) fail('island: a plumbing allowance appeared');
  else ok('Electrical open, Permits at its 25% floor, no plumbing');

  const withSink = clone(marble); withSink.island.hasSink = true; ensureSpecMaterials(withSink);
  const e2 = calculateEstimate(withSink, marbleSel, S, marbleBase);
  const faucet = byId(e2, 'faucet')!;
  if (faucet.scope !== 'added' || faucet.qty !== 1 || faucet.baselineQty !== 1) fail(`island sink: faucet ${faucet.scope} qty ${faucet.qty} was ${faucet.baselineQty}`);
  if (!e2.trades.plumbing) fail('island sink: plumbing should be open');
  else ok('an island sink adds one faucet and opens the plumber');
}

// ---------------------------------------------------------------------------
section('§4  run extended, same cabinets');
// ---------------------------------------------------------------------------
{
  const ext = clone(marble);
  const left = ext.runs.find((r) => r.wall === 'left')!;
  left.lengthFt += 3;
  left.base.push({ type: 'door', widthIn: 36, drawerCount: 0 });
  left.uppers!.push({ type: 'door', widthIn: 36, heightIn: null });
  ensureSpecMaterials(ext);
  const e = calculateEstimate(ext, marbleSel, S, marbleBase);
  const full = calculateEstimate(ext, marbleSel, FULL);
  const check = (id: string, qty: number, baseQty: number) => {
    const l = byId(e, id);
    if (!l) return fail(`extended: no ${id} line`);
    if (l.scope !== 'added') return fail(`extended: ${id} is '${l.scope}', expected 'added'`);
    if (!near(l.qty, qty, 0.11)) return fail(`extended: ${id} qty ${l.qty}, expected ${qty}`);
    if (!near(l.baselineQty ?? -1, baseQty, 0.11)) return fail(`extended: ${id} baselineQty ${l.baselineQty}, expected ${baseQty}`);
  };
  check('cab-base', 3, 18.5);
  check('cab-upper', 3, 17);
  check('cab-crown', 3, 17);
  check('counter', 6.5, 39.8);
  check('backsplash', 7.5, 55.3);
  const cb = byId(e, 'cab-base')!, cbFull = byId(full, 'cab-base')!;
  if (!near(cb.totalLow, Math.round(cbFull.totalLow * 3 / 21.5), 2)) fail(`extended: cab-base low ${cb.totalLow} ≉ ${Math.round(cbFull.totalLow * 3 / 21.5)}`);
  else ok('every grown line bills only its delta, priced at the same unit rate');
  if (e.lines.some((l) => !l.id.startsWith('allow-') && l.scope === 'changed')) fail('extended: a line was badged Changed');
  else ok("no row is badged Changed — the cabinets did not change, there are just more of them");
  if (e.lines.some((l) => l.scope === 'added' && !((l.baselineQty ?? 0) > 0))) fail('extended: an added line has no baseline qty');
  if (!e.trades.drywall || !e.trades.electrical) fail(`extended: trades ${JSON.stringify(e.trades)}`);
  const dw = byId(e, 'allow-drywall')!;
  if (dw.totalLow !== 158 || dw.totalHigh !== 475) fail(`extended: allow-drywall ${dw.totalLow}–${dw.totalHigh}, expected 158–475`);
  else ok('drywall opens at its 20% floor, 158–475');
  if (!near(e.mid, 14183, 150)) fail(`extended: mid ${e.mid}, expected 14,183 ±150`);
  else ok(`midpoint $${e.mid.toLocaleString()}`);
}

// ---------------------------------------------------------------------------
section('§5  pendant removed — a shrink is never a cost');
// ---------------------------------------------------------------------------
{
  const fewer = clone(marble); fewer.lighting.pendants!.count = 1; ensureSpecMaterials(fewer);
  const e = calculateEstimate(fewer, marbleSel, S, marbleBase);
  const p = byId(e, 'pendants')!;
  if (e.totalLow !== 0 || e.totalHigh !== 0 || e.changedCount !== 0) fail(`pendant: ${e.totalLow}–${e.totalHigh}, changed ${e.changedCount}`);
  if (p.scope !== 'unchanged' || p.qty !== 1 || p.baselineQty !== 2) fail(`pendant: ${p.scope} qty ${p.qty} was ${p.baselineQty}`);
  if (e.lines.some((l) => l.id.startsWith('allow-'))) fail('pendant: an allowance was charged for taking something out');
  if (e.timelineWeeksHigh !== 0) fail(`pendant: ${e.timelineWeeksHigh} weeks`);
  else ok('taking a pendant down leaves the headline at $0 and 0 weeks');
}

// ---------------------------------------------------------------------------
section('§6  island removed');
// ---------------------------------------------------------------------------
{
  const noIsland = clone(marble); noIsland.island.present = false; ensureSpecMaterials(noIsland);
  const e = calculateEstimate(noIsland, marbleSel, S, marbleBase);
  for (const [id, q] of [['cab-island', 12.8], ['island-top', 36]] as const) {
    const l = byId(e, id);
    if (!l) { fail(`removed: no ${id} row`); continue; }
    if (l.scope !== 'removed' || l.totalLow !== 0 || l.totalHigh !== 0) fail(`removed: ${id} ${l.scope} ${l.totalLow}–${l.totalHigh}`);
    if (!(l.fullTotalHigh > 0)) fail(`removed: ${id} lost its full-remodel cost`);
    if (!near(l.baselineQty ?? -1, q, 0.05)) fail(`removed: ${id} baselineQty ${l.baselineQty}, expected ${q}`);
    if (l.note !== 'removed — demolition in allowance') fail(`removed: ${id} note "${l.note}"`);
  }
  ok('Island cabinetry and Island top show as Removed at $0, with what they were worth');
  const cats = e.lines.map((l) => l.category);
  const cabIdx = e.lines.findIndex((l) => l.id === 'cab-island');
  if (cats[cabIdx] !== 'Cabinetry' || e.lines.findIndex((l) => l.id === 'island-top') <= cabIdx) fail('removed: rows are not slotted into their own categories');
  if (e.lines.findIndex((l) => l.id === 'island-top') > e.lines.findIndex((l) => l.id.startsWith('allow-'))) fail('removed: a removed row landed after the allowances');
  else ok('the removed rows sit inside Cabinetry / Surfaces, before the allowances');
  if (e.changedCount !== 2) fail(`removed: changedCount ${e.changedCount}`);
  const allow = e.lines.filter((l) => l.id.startsWith('allow-')).map((l) => l.id).join(',');
  if (allow !== 'allow-demo,allow-design') fail(`removed: allowances ${allow}`);
  const demo = byId(e, 'allow-demo')!;
  if (demo.totalLow !== 317 || demo.totalHigh !== 660) fail(`removed: allow-demo ${demo.totalLow}–${demo.totalHigh}`);
  if (!(e.totalHigh < 2000)) fail(`removed: totalHigh ${e.totalHigh}`);
  else ok(`demolition and design only, $${e.totalLow}–${e.totalHigh}`);
}

// ---------------------------------------------------------------------------
section('§7  full-mode parity + the snapshot');
// ---------------------------------------------------------------------------
{
  const a = calculateEstimate(marble, marbleSel, FULL, marbleBase);
  const b = calculateEstimate(marble, marbleSel, FULL, null);
  const c = calculateEstimate(marble, marbleSel, S);
  const tuple = (e: Estimate) => e.lines.map((l) => [l.id, l.qty, l.unit, l.materialLow, l.materialHigh, l.laborLow, l.laborHigh, l.totalLow, l.totalHigh]);
  if ([a, b, c].some((e) => e.mode !== 'full')) fail('parity: a mode is not full');
  if (JSON.stringify(tuple(a)) !== JSON.stringify(tuple(b)) || JSON.stringify(tuple(a)) !== JSON.stringify(tuple(c))) fail('parity: the three full-mode runs disagree');
  else ok('full mode with a baseline, with a null baseline and with no baseline argument agree line for line');
  for (const l of a.lines) {
    if (l.scope !== 'changed' || l.baselineQty !== null || l.fullTotalLow !== l.totalLow || l.fullTotalHigh !== l.totalHigh) { fail(`parity: ${l.id} is tagged ${l.scope}/${l.baselineQty}`); break; }
  }
  if (a.scopeShare !== 1) fail(`parity: scopeShare ${a.scopeShare}`);
  if (a.full.totalLow !== a.totalLow || a.full.mid !== a.mid) fail('parity: full block ≠ own totals');
  else ok("every line 'changed', baselineQty null, full block equal to the totals");

  // the measured baseline, line for line
  if (a.lines.length !== 23) fail(`snapshot: ${a.lines.length} lines, expected 23`);
  let drift = 0;
  for (const l of a.lines) {
    const m = MEASURED[l.id];
    if (!m) { fail(`snapshot: unexpected line ${l.id}`); continue; }
    if (l.id === 'faucet') continue;
    if (l.totalLow !== m[0] || l.totalHigh !== m[1]) { fail(`snapshot: ${l.id} ${l.totalLow}–${l.totalHigh}, measured ${m[0]}–${m[1]}`); drift++; }
  }
  if (!drift) ok('22 of 23 lines are byte-identical to the measured pre-change estimate');
  const faucet = byId(a, 'faucet')!;
  if (faucet.totalLow !== POST_FIX.faucet[0] || faucet.totalHigh !== POST_FIX.faucet[1]) fail(`snapshot: faucet ${faucet.totalLow}–${faucet.totalHigh}, expected ${POST_FIX.faucet.join('–')}`);
  else ok(`the 23rd, faucet, is the one deliberate price fix: ${MEASURED.faucet.join('–')} → ${POST_FIX.faucet.join('–')}`);
  // the measured totals are exactly the shipped totals plus the faucet decoupling
  const dLow = MEASURED.faucet[0] - POST_FIX.faucet[0], dHigh = MEASURED.faucet[1] - POST_FIX.faucet[1];
  if (a.subtotalLow + dLow !== MEASURED_TOTALS.subtotalLow || a.subtotalHigh + dHigh !== MEASURED_TOTALS.subtotalHigh) fail(`snapshot: subtotal ${a.subtotalLow}–${a.subtotalHigh} + faucet delta ≠ measured ${MEASURED_TOTALS.subtotalLow}–${MEASURED_TOTALS.subtotalHigh}`);
  else ok(`the measured subtotal ${MEASURED_TOTALS.subtotalLow.toLocaleString()}–${MEASURED_TOTALS.subtotalHigh.toLocaleString()} is recovered by adding the faucet delta back`);
  if (a.subtotalLow !== POST_FIX_TOTALS.subtotalLow || a.subtotalHigh !== POST_FIX_TOTALS.subtotalHigh) fail(`snapshot: subtotal ${a.subtotalLow}–${a.subtotalHigh}`);
  if (a.totalLow !== POST_FIX_TOTALS.totalLow || a.totalHigh !== POST_FIX_TOTALS.totalHigh || a.mid !== POST_FIX_TOTALS.mid) fail(`snapshot: total ${a.totalLow}–${a.totalHigh} mid ${a.mid}`);
  if (a.timelineWeeksLow !== POST_FIX_TOTALS.weeks[0] || a.timelineWeeksHigh !== POST_FIX_TOTALS.weeks[1]) fail(`snapshot: ${a.timelineWeeksLow}–${a.timelineWeeksHigh} weeks`);
  else ok(`shipped full remodel $${a.totalLow.toLocaleString()}–${a.totalHigh.toLocaleString()}, mid $${a.mid.toLocaleString()}, 4–9 weeks`);

  // The other fixture. Its island top and its pendants are CUSTOM materials
  // synthesised from the photo, so those two lines are priced by the finish
  // matcher and move whenever it does — they are not this stream's to pin.
  // Every category built from named catalog ids is asserted against the same
  // measured run.
  const shelves = fixture('client-shelves.spec.json');
  const sh = calculateEstimate(shelves, selOf(shelves), FULL);
  if (sh.lines.length !== 19) fail(`shelves: ${sh.lines.length} lines, expected 19`);
  const cat = (e: Estimate, c: string): [number, number] => e.lines.filter((l) => l.category === c).reduce<[number, number]>((a, l) => [a[0] + l.totalLow, a[1] + l.totalHigh], [0, 0]);
  const SHELVES_MEASURED: Record<string, [number, number]> = {
    Cabinetry: [8976, 14371], Appliances: [3630, 7260], 'Site Work': [2376, 5676], MEP: [3564, 8580], 'Soft Costs': [1452, 6204],
  };
  let shDrift = 0;
  for (const [c, m] of Object.entries(SHELVES_MEASURED)) {
    const [lo, hi] = cat(sh, c);
    if (lo !== m[0] || hi !== m[1]) { fail(`shelves: ${c} ${lo}–${hi}, measured ${m[0]}–${m[1]}`); shDrift++; }
  }
  if (!shDrift) ok('client-shelves: Cabinetry, Appliances, Site Work, MEP and Soft Costs are byte-identical to the measured run');
  const [finLo, finHi] = cat(sh, 'Finishes');
  const shFaucet = byId(sh, 'faucet')!;
  const shAdj = (CATALOG_BY_ID[selOf(shelves).faucet]?.priceAdj ?? 1) - 1;
  if (!near(finLo + shFaucet.materialLow * shAdj, 1941, 2) || !near(finHi + shFaucet.materialHigh * shAdj, 4025, 2)) {
    fail(`shelves: Finishes ${finLo}–${finHi}; adding the oil-bronze multiplier back gives ${Math.round(finLo + shFaucet.materialLow * shAdj)}–${Math.round(finHi + shFaucet.materialHigh * shAdj)}, measured 1941–4025`);
  } else ok('client-shelves Finishes moves by exactly its own faucet decoupling');
  // Contract §5 pins full mode, and this fixture is the one that catches a
  // silent drift: its hood is 'custom-insert', so widening the splash deduction
  // past 'chimney' cut the backsplash 19% and grew the wall behind it — a price
  // a returning client sees move with no action of theirs. The faucet is the
  // ONLY line either fixture is allowed to move (brief-PRICING §7, commit 2).
  const shSplash = byId(sh, 'backsplash')!, shWalls = byId(sh, 'walls')!;
  if (shSplash.totalLow !== 3223 || shSplash.totalHigh !== 8290) fail(`shelves: backsplash ${shSplash.totalLow}–${shSplash.totalHigh} (${shSplash.qty} sqft), measured 3223–8290 at 21.2 sqft — a custom-insert hood must not deduct splash`);
  else if (shWalls.totalLow !== 1602 || shWalls.totalHigh !== 2772) fail(`shelves: walls ${shWalls.totalLow}–${shWalls.totalHigh}, measured 1602–2772 — the wall follows whatever the splash gave up`);
  else ok(`client-shelves: the custom-insert hood deducts no splash — ${shSplash.qty} sqft, ${shSplash.totalLow}–${shSplash.totalHigh}, byte-identical to the measured run`);
  const shE = calculateEstimate(shelves, selOf(shelves), S, baselineOf(shelves));
  if (shE.mid !== 0 || shE.changedCount !== 0) fail(`shelves: untouched changes mode ${shE.mid} / ${shE.changedCount}`);
  else ok('client-shelves untouched in changes mode: $0');
  console.log(`  · Surfaces ${cat(sh, 'Surfaces').join('–')} (measured 19946–36067) and Lighting ${cat(sh, 'Lighting').join('–')} (measured 1148–2336) carry the two photo-matched custom materials`);
}

// ---------------------------------------------------------------------------
section('§8  knock-ons');
// ---------------------------------------------------------------------------
{
  const sel2 = { ...marbleSel, cabinets_base: 'cab-hale-navy' };
  const e = calculateEstimate(marble, sel2, S, marbleBase);
  const base = byId(e, 'cab-base')!, counter = byId(e, 'counter')!, hw = byId(e, 'hardware')!;
  if (base.scope !== 'changed' || !base.reason?.startsWith('material changed')) fail(`knock-on: cab-base ${base.scope}/${base.reason}`);
  if (counter.scope !== 'changed' || !counter.reason?.startsWith('knock-on: new base cabinets')) fail(`knock-on: counter ${counter.scope}/${counter.reason}`);
  if (hw.scope !== 'changed' || !hw.reason?.startsWith('knock-on:')) fail(`knock-on: hardware ${hw.scope}/${hw.reason}`);
  else ok('new base cabinets pull in the countertop and the hardware, each saying why');
  for (const id of ['cab-upper', 'cab-tall', 'island-top']) if (byId(e, id)!.scope !== 'unchanged') fail(`knock-on: ${id} was pulled in`);
  ok('the uppers, the pantry and the island top stay out of it');
  const off = calculateEstimate(marble, sel2, { ...S, includeKnockOns: false }, marbleBase);
  if (roomIds(off).join(',') !== 'cab-base') fail(`knock-on off: in scope ${roomIds(off).join(',')}`);
  else ok('with knock-ons off, only the cabinets are priced');
  for (const est of [e, off]) {
    if (!est.trades.electrical) fail('knock-on: electrical should be open');
    if (!byId(est, 'allow-permits')) fail('knock-on: permits should be present');
    if (byId(est, 'allow-plumbing')) fail('knock-on: no plumbing allowance expected');
  }
  ok('either way: electrician and permits, no plumber');
}

// ---------------------------------------------------------------------------
section('§9  count lines');
// ---------------------------------------------------------------------------
{
  const more = clone(marble); more.lighting.recessedCount = 12; more.lighting.pendants!.count = 4; ensureSpecMaterials(more);
  const e = calculateEstimate(more, marbleSel, S, marbleBase);
  const rec = byId(e, 'recessed')!, pen = byId(e, 'pendants')!;
  if (rec.scope !== 'added' || rec.qty !== 4 || rec.baselineQty !== 8) fail(`counts: recessed ${rec.scope} qty ${rec.qty} was ${rec.baselineQty}`);
  if (!near(rec.totalHigh, Math.round(2904 * 4 / 8), 1)) fail(`counts: recessed high ${rec.totalHigh} ≉ ${Math.round(2904 * 4 / 8)}`);
  if (pen.scope !== 'added' || pen.qty !== 2 || pen.baselineQty !== 2) fail(`counts: pendants ${pen.scope} qty ${pen.qty} was ${pen.baselineQty}`);
  else ok('four more cans and two more pendants bill as +4 and +2, not as sixteen fittings');
  if (!e.trades.electrical || e.trades.plumbing) fail(`counts: trades ${JSON.stringify(e.trades)}`);
  else ok('electrician only');
}

// ---------------------------------------------------------------------------
section('§10  bathroom variants');
// ---------------------------------------------------------------------------
{
  const bath = defaultBathroom() as BathroomSpec;
  bath.shower.curbless = false; bath.shower.enclosure = 'frameless-glass';
  ensureSpecMaterials(bath);
  const bsel = selOf(bath);
  const bbase = baselineOf(bath, bsel);

  const wallHung = clone(bath); wallHung.toilet.style = 'wall-hung'; ensureSpecMaterials(wallHung);
  const e1 = calculateEstimate(wallHung, bsel, S, bbase);
  const toilet = byId(e1, 'toilet')!;
  if (toilet.scope !== 'changed' || !toilet.reason?.includes('→ Toilet (wall-hung)')) fail(`bath: toilet ${toilet.scope}/${toilet.reason}`);
  if (!e1.trades.plumbing) fail('bath: a new toilet should open the plumber');
  const plumb = byId(e1, 'allow-plumbing')!;
  if (plumb.totalLow !== 356 || plumb.totalHigh !== 891) fail(`bath: allow-plumbing ${plumb.totalLow}–${plumb.totalHigh}, expected 356–891`);
  else ok(`a different toilet: "${toilet.reason}", plumber at his 15% floor 356–891`);

  const curbless = clone(bath); curbless.shower.curbless = true; ensureSpecMaterials(curbless);
  const e2 = calculateEstimate(curbless, bsel, S, bbase);
  if (roomIds(e2).join(',') !== 'shower-pan') fail(`bath: curbless in scope ${roomIds(e2).join(',')}`);
  else ok('going curbless re-prices the pan and nothing else');

  const framed = clone(bath); framed.shower.enclosure = 'framed-glass'; ensureSpecMaterials(framed);
  const e3 = calculateEstimate(framed, bsel, S, bbase);
  if (roomIds(e3).join(',') !== 'shower-glass') fail(`bath: framed in scope ${roomIds(e3).join(',')}`);
  const fan = byId(e3, 'fan')!;
  if (fan.scope !== 'unchanged' || fan.totalHigh !== 0) fail(`bath: fan ${fan.scope} ${fan.totalHigh}`);
  else ok('a cheaper enclosure touches the glass line only; the fan stays at $0');

  const other = bsel.vanity_cabinet === 'cab-hale-navy' ? 'wood-walnut' : 'cab-hale-navy';
  const e4 = calculateEstimate(bath, { ...bsel, vanity_cabinet: other }, S, bbase);
  if (roomIds(e4).sort().join(',') !== 'sinks,vanity,vanity-top') fail(`bath: vanity in scope ${roomIds(e4).join(',')}`);
  const e5 = calculateEstimate(bath, { ...bsel, vanity_cabinet: other }, { ...S, includeKnockOns: false }, bbase);
  if (roomIds(e5).join(',') !== 'vanity') fail(`bath: vanity noKO in scope ${roomIds(e5).join(',')}`);
  else ok('a new vanity brings its top and re-sets the sinks — unless knock-ons are off');
}

// ---------------------------------------------------------------------------
section('§11  exterior');
// ---------------------------------------------------------------------------
{
  const ext = defaultExterior('modern-farmhouse') as ExteriorSpec;
  ensureSpecMaterials(ext);
  const esel = selOf(ext);
  const ebase = baselineOf(ext, esel);
  const other = (slot: string) => materialsForSlot(slot as never).find((m) => m.id !== esel[slot])!.id;
  const roofSwap = other('roof');
  const e = calculateEstimate(ext, { ...esel, roof: roofSwap }, S, ebase);
  if (roomIds(e).join(',') !== 'roof') fail(`exterior: roof swap in scope ${roomIds(e).join(',')}`);
  const allow = e.lines.filter((l) => l.id.startsWith('allow-')).map((l) => l.id).sort().join(',');
  if (allow !== 'allow-demo,allow-design') fail(`exterior: allowances ${allow}`);
  else ok('a new roof prices the roof, a tear-off allowance and design — nothing else');
  const sidingSwap = other('siding_primary');
  const e2 = calculateEstimate(ext, { ...esel, siding_primary: sidingSwap }, S, ebase);
  const trim = byId(e2, 'trim')!;
  if (trim.scope !== 'changed' || !trim.reason?.startsWith('knock-on: new siding')) fail(`exterior: trim ${trim.scope}/${trim.reason}`);
  else ok('new siding re-runs the trim and the corners');
}

// ---------------------------------------------------------------------------
section('§12  the faucet is decoupled from the pull finish');
// ---------------------------------------------------------------------------
{
  const e = calculateEstimate(marble, marbleSel, FULL);
  const faucet = byId(e, 'faucet')!, hardware = byId(e, 'hardware')!;
  const expectHigh = Math.round(PRICE_BOOK['fixture-finish'].premium.material.high * 2.2 * 1.1);
  const expectLow = Math.round(PRICE_BOOK['fixture-finish'].premium.material.low * 2.2 * 1.1);
  if (faucet.materialHigh !== expectHigh || faucet.materialLow !== expectLow) fail(`faucet: material ${faucet.materialLow}–${faucet.materialHigh}, expected ${expectLow}–${expectHigh}`);
  else ok(`the faucet prices the farmhouse adj against fixture-finish only: ${expectLow}–${expectHigh}`);
  if (hardware.materialHigh !== 2483) fail(`hardware: materialHigh ${hardware.materialHigh}, expected 2483 (the 1.5 brass adj still applies)`);
  else ok('the hardware line still carries the brushed-brass 1.5 — same price group');
  // ...and the opt-out is the faucet line ALONE. Every other line that
  // overrides the price group still carries its material's own multiplier,
  // because "swap a material, watch the estimate move" is the product.
  const bath = defaultBathroom() as BathroomSpec; ensureSpecMaterials(bath);
  const bsel = selOf(bath);
  const brass = calculateEstimate(bath, { ...bsel, fixtures: 'fin-brushed-brass' }, FULL);
  const bf = byId(brass, 'fixtures')!;
  const showerAdj = bath.shower.fixtures === 'rain-plus-handheld' ? 1.4 : bath.shower.fixtures === 'body-jets' ? 2.2 : 1;
  const brassMat = CATALOG_BY_ID['fin-brushed-brass'];
  const brassAdj = brassMat.priceAdj ?? 1;
  const wantHigh = Math.round(PRICE_BOOK['fixture-finish'][brassMat.tier].material.high * bf.qty * showerAdj * brassAdj * 1.1);
  if (bf.materialHigh !== wantHigh) fail(`bath fixtures: ${bf.materialHigh}, expected ${wantHigh} — the brass ${brassAdj}× was dropped from a fixture-finish line`);
  else ok(`the bathroom fixtures line still carries the brass ${brassAdj}× (${bf.materialHigh})`);
  // the shower wall prices `wall-tile` for materials whose own group is
  // `backsplash`; two tiles 1.25× apart must not price the same
  const wallOf = (id: string) => byId(calculateEstimate(bath, { ...bsel, shower_wall_tile: id }, FULL), 'shower-wall')!;
  const quartz = wallOf('tile-quartz-slab'), zellige = wallOf('tile-zellige-white');
  const ratio = quartz.materialHigh / zellige.materialHigh;
  const wantRatio = (CATALOG_BY_ID['tile-quartz-slab'].priceAdj ?? 1) / (CATALOG_BY_ID['tile-zellige-white'].priceAdj ?? 1);
  if (!near(ratio, wantRatio, 0.01)) fail(`shower wall: quartz/zellige material ratio ${ratio.toFixed(3)}, expected ${wantRatio.toFixed(3)}`);
  else ok(`a group-overridden tile line still moves with the swatch: quartz ${quartz.totalLow}–${quartz.totalHigh} vs zellige ${zellige.totalLow}–${zellige.totalHigh}`);
}

// ---------------------------------------------------------------------------
section('§13  degrade rather than throw');
// ---------------------------------------------------------------------------
{
  const noBase = calculateEstimate(marble, marbleSel, S);
  const bath = defaultBathroom() as BathroomSpec; ensureSpecMaterials(bath);
  const wrongRoom = calculateEstimate(marble, marbleSel, S, baselineOf(bath, selOf(bath)));
  if (noBase.mode !== 'full' || wrongRoom.mode !== 'full') fail(`degrade: ${noBase.mode} / ${wrongRoom.mode}`);
  if (JSON.stringify(wrongRoom.lines) !== JSON.stringify(noBase.lines)) fail('degrade: a stale baseline changed the lines');
  else ok('no baseline, or one from another room, prices a full remodel line for line');
  if (estimateMode(null, S, baselineOf(marble, marbleSel)) !== 'full') fail('degrade: estimateMode(null) should be full');
  const empty = calculateEstimate(null, {}, S, baselineOf(marble, marbleSel));
  if (empty.mode !== 'full' || empty.lines.length !== 0 || empty.mid !== 0 || empty.totalHigh !== 0) fail(`degrade: empty ${empty.mode} ${empty.lines.length} ${empty.mid}`);
  else ok('no spec at all returns zeros and no lines');
}

// ---------------------------------------------------------------------------
section('§14  timeline bands');
// ---------------------------------------------------------------------------
{
  const swap = calculateEstimate(marble, { ...marbleSel, countertop: 'ct-soapstone' }, S, marbleBase);
  if (swap.timelineWeeksLow !== 1 || swap.timelineWeeksHigh !== 3) fail(`timeline: countertop ${swap.timelineWeeksLow}–${swap.timelineWeeksHigh}`);
  const untouched = calculateEstimate(marble, marbleSel, S, marbleBase);
  if (untouched.timelineWeeksHigh !== 0) fail(`timeline: untouched ${untouched.timelineWeeksHigh}`);
  const big = calculateEstimate(marble, { ...marbleSel, cabinets_base: 'cab-hale-navy', cabinets_upper: 'cab-hale-navy', cabinets_tall: 'cab-hale-navy', countertop: 'ct-soapstone', island_countertop: 'ct-soapstone', backsplash: 'tile-zellige-white' }, S, marbleBase);
  const full = calculateEstimate(marble, marbleSel, FULL);
  // the band slides from cosmetic toward the chosen scope as the share grows,
  // and only picks up the big-room bump once it is off the cosmetic floor
  if (!(big.scopeShare > swap.scopeShare && big.timelineWeeksHigh > swap.timelineWeeksHigh)) fail(`timeline: a ${Math.round(big.scopeShare * 100)}% job is not longer than a ${Math.round(swap.scopeShare * 100)}% one`);
  if (big.timelineWeeksHigh > full.timelineWeeksHigh) fail(`timeline: a partial job (${big.timelineWeeksHigh}) outruns the full remodel (${full.timelineWeeksHigh})`);
  else ok(`0–0 untouched · 1–3 for a countertop · ${big.timelineWeeksLow}–${big.timelineWeeksHigh} at ${Math.round(big.scopeShare * 100)}% · 4–9 full`);
}

// ---------------------------------------------------------------------------
section('§15  the cabinet above the hood is priced');
// ---------------------------------------------------------------------------
{
  const demo = defaultKitchen();
  const dsel = selOf(demo);
  const hood = demo.appliances.find((a) => a.kind === 'hood');
  if (!hood) fail('hood: the demo kitchen has no hood');
  else if (hood.cabinetAbove !== 'doors') fail(`hood: the demo kitchen ships cabinetAbove '${hood.cabinetAbove}', expected 'doors' so the feature shows`);
  const bare = clone(demo); bare.appliances.find((a) => a.kind === 'hood')!.cabinetAbove = 'none';
  const withCab = calculateEstimate(demo, dsel, FULL);
  const without = calculateEstimate(bare, dsel, FULL);
  const dLF = withCab.quantities.upperLF - without.quantities.upperLF;
  if (!near(dLF, 30 / 12 * (10 / 36), 0.02)) fail(`hood: upperLF delta ${dLF.toFixed(3)}, expected ${(30 / 12 * (10 / 36)).toFixed(3)}`);
  else ok(`a 30" cabinet filling 10" of a 36" row adds ${dLF.toFixed(3)} lin ft of uppers`);
  if (withCab.quantities.hardwareCount - without.quantities.hardwareCount !== 2) fail(`hood: hardware delta ${withCab.quantities.hardwareCount - without.quantities.hardwareCount}, expected 2`);
  else ok('and two more pulls');
  for (const [e, q] of [[withCab, withCab.quantities.upperLF], [without, without.quantities.upperLF]] as const) {
    if (byId(e, 'cab-crown')!.qty !== Math.round(q)) fail(`hood: cab-crown qty ${byId(e, 'cab-crown')!.qty} does not follow upperLF ${q}`);
  }
  ok('the crown follows the upper linear footage for free');
  const nulled = clone(marble); nulled.appliances.find((a) => a.kind === 'hood')!.cabinetAbove = null; ensureSpecMaterials(nulled);
  const qa = calculateEstimate(nulled, marbleSel, FULL).quantities;
  const qb = calculateEstimate(marble, marbleSel, FULL).quantities;
  if (qa.upperLF !== qb.upperLF || qa.hardwareCount !== qb.hardwareCount) fail(`hood: marble null (${qa.upperLF}) ≠ 'none' (${qb.upperLF})`);
  else ok("on the marble fixture a chimney hood derives 'none' from null — quantities identical");

  // The wall behind a chimney canopy carries no tile. The deduction is keyed on
  // the RESOLVED style, so a hood whose style the photo could not read (null →
  // chimney, drawn as a tapered canopy) deducts like the canopy it is drawn as.
  // It stays chimney-only: widening it to custom-insert moved a full-remodel
  // total that contract §5 pins.
  // a 'standard' 18" splash already stops below the hood mouth, so the
  // deduction is only non-zero on a full-height splash — measure it there
  const splashOf = (style: KitchenSpec['appliances'][number]['hoodStyle']) => {
    const k = clone(demo);
    k.backsplash = { ...k.backsplash, height: 'full-height', heightIn: null };
    k.appliances.find((a) => a.kind === 'hood')!.hoodStyle = style;
    return calculateEstimate(k, dsel, FULL).quantities.backsplashSqft;
  };
  const chimney = splashOf('chimney');
  if (!near(splashOf(null), chimney, 1e-6)) fail(`hood: an unread hood style tiles ${splashOf(null).toFixed(1)} sqft where a chimney tiles ${chimney.toFixed(1)}`);
  for (const style of ['custom-insert', 'under-cabinet'] as const) {
    if (splashOf(style) <= chimney) fail(`hood: a '${style}' hood should leave the splash whole, not deduct behind it`);
  }
  ok('an unread hood style deducts the same splash as a chimney; custom-insert and under-cabinet deduct none');

  // A measured splash height beats the category everywhere — the drawn field
  // and the bid have to agree, which is the whole point of the slider.
  const heightAt = (heightIn: number | null) => {
    const k = clone(marble);
    k.backsplash = { ...k.backsplash, heightIn };
    ensureSpecMaterials(k);
    return calculateEstimate(k, marbleSel, FULL).quantities.backsplashSqft;
  };
  const asFound = heightAt(null);
  if (!(heightAt(90) > asFound * 1.5)) fail(`backsplash: heightIn 90 tiles ${heightAt(90).toFixed(1)} sqft, no more than the 'full-height' word's ${asFound.toFixed(1)}`);
  if (!(heightAt(6) < asFound * 0.35)) fail(`backsplash: heightIn 6 tiles ${heightAt(6).toFixed(1)} sqft, not a ledge`);
  else ok(`backsplash.heightIn drives the quantity: 6" ${heightAt(6).toFixed(1)} · as found ${asFound.toFixed(1)} · 90" ${heightAt(90).toFixed(1)} sqft`);
  const grown = clone(marble); grown.backsplash = { ...grown.backsplash, heightIn: 90 }; ensureSpecMaterials(grown);
  const growth = calculateEstimate(grown, marbleSel, S, marbleBase);
  const bsLine = byId(growth, 'backsplash');
  if (!bsLine || bsLine.scope === 'unchanged' || bsLine.totalHigh <= 0) fail('backsplash: raising heightIn in changes mode still prices $0');
  else ok(`raising the splash to 90" bills the delta: ${bsLine.reason} · ${bsLine.totalLow}–${bsLine.totalHigh}`);

  // the counter follows the overhang slider the same way
  const counterAt = (overhangIn: number | null) => {
    const k = clone(marble); k.countertop = { ...k.countertop, overhangIn }; ensureSpecMaterials(k);
    return calculateEstimate(k, marbleSel, FULL).quantities.counterSqft;
  };
  if (!(counterAt(3) > counterAt(null))) fail('countertop: a 3" overhang does not grow the slab');
  else ok(`countertop.overhangIn moves the slab: 1.5" ${counterAt(null).toFixed(1)} → 3" ${counterAt(3).toFixed(1)} sqft`);
}

// ---------------------------------------------------------------------------
section('§16  groupLines');
// ---------------------------------------------------------------------------
{
  const e = calculateEstimate(marble, { ...marbleSel, countertop: 'ct-soapstone' }, S, marbleBase);
  const all = groupLines(e.lines);
  const shown = groupLines(e.lines, { hideUnchanged: true });
  if (all.reduce((s, g) => s + g.lines.length, 0) !== e.lines.length) fail('groupLines: dropped a line');
  if (shown.some((g) => g.lines.some((l) => l.scope === 'unchanged'))) fail('groupLines: an unchanged row survived the filter');
  if (shown.some((g) => g.lines.length === 0)) fail('groupLines: an empty group survived');
  const surfaces = all.find((g) => g.category === 'Surfaces')!;
  if (!(surfaces.fullHigh > surfaces.high)) fail('groupLines: fullHigh should exceed the in-scope high when rows are hidden');
  const shownSurfaces = shown.find((g) => g.category === 'Surfaces')!;
  if (shownSurfaces.hidden !== surfaces.lines.length - 1) fail(`groupLines: hidden ${shownSurfaces.hidden}, expected ${surfaces.lines.length - 1}`);
  else ok(`hideUnchanged leaves ${shown.length} groups and reports ${shownSurfaces.hidden} hidden rows in Surfaces`);
  const cats = all.map((g) => g.category);
  if (cats.join(',') !== [...new Set(e.lines.map((l) => l.category))].join(',')) fail('groupLines: insertion order lost');
  else ok('category order is the estimate\'s own');
}

// ---------------------------------------------------------------------------
// THE SECOND TIER OF WALL CABINET, AND THE WALL IT COVERS
// ---------------------------------------------------------------------------
section('STACKED UPPERS · a separate quantity, and the wall behind them');
{
  const withStack = (): KitchenSpec => {
    const k = clone(marble);
    for (const r of k.runs) if (r.hasUppers && r.uppers && r.uppers.length) { r.uppers2 = deriveUppers2(r.uppers); r.uppers2HeightIn = null; }
    return k;
  };
  const flat = calculateEstimate(marble, marbleSel, FULL);
  const stacked = calculateEstimate(withStack(), marbleSel, FULL);
  const bad: string[] = [];

  // 1. no second tier → no line at all
  if (byId(flat, 'cab-upper-stack')) bad.push('cab-upper-stack priced on a single-tier kitchen');
  const stackLine = byId(stacked, 'cab-upper-stack');
  if (!stackLine) bad.push('a stacked kitchen has no cab-upper-stack line');
  else if (!near(stackLine.qty, stacked.quantities.upperStackLF, 0.51)) bad.push(`cab-upper-stack qty ${stackLine.qty} ≠ upperStackLF ${stacked.quantities.upperStackLF.toFixed(1)}`);
  else if (stackLine.totalHigh <= 0) bad.push('cab-upper-stack prices $0');

  // 2. the transom is more cabinetry at the SAME linear feet: the crown runs
  //    once, over tier 2, and the LED strip is under tier 1 only. Neither may
  //    double, and the base row must not move either.
  for (const id of ['cab-crown', 'undercab', 'cab-upper', 'cab-base', 'counter', 'backsplash']) {
    const a = byId(flat, id), b = byId(stacked, id);
    if (!a || !b) { if (a || b) bad.push(`${id} appears in only one of the two estimates`); continue; }
    if (a.qty !== b.qty || a.totalLow !== b.totalLow || a.totalHigh !== b.totalHigh) {
      bad.push(`${id} moved: ${a.qty}@${a.totalLow}–${a.totalHigh} → ${b.qty}@${b.totalLow}–${b.totalHigh}`);
    }
  }
  // 3. …and the hardware DOES grow, by one pull per transom door
  const extraDoors = withStack().runs.reduce((n, r) => n + (r.uppers2 ?? []).filter((u) => u.type === 'door' || u.type === 'glass').length, 0);
  const dH = (byId(stacked, 'hardware')?.qty ?? 0) - (byId(flat, 'hardware')?.qty ?? 0);
  if (dH !== extraDoors) bad.push(`hardware grew by ${dH}, expected ${extraDoors} (one pull per transom door)`);
  if (bad.length) fail(`stacked uppers: ${bad.join('; ')}`);
  else ok(`stacked uppers: cab-upper-stack ${stackLine!.qty} lf appears only with uppers2; cab-crown, undercab and cab-upper unchanged; hardware +${extraDoors}`);
}
{
  // The cabinet on the hood is real wall cabinetry and is paid for. The
  // client's oldest complaint has a price attached: turning it off must remove
  // upper linear feet and pulls.
  const withCab = clone(marble);
  const hood = withCab.appliances.find((a) => a.kind === 'hood')!;
  hood.cabinetAbove = 'doors';
  const on = calculateEstimate(withCab, marbleSel, FULL);
  const off = calculateEstimate(marble, marbleSel, FULL);
  const bad: string[] = [];
  if (!(on.quantities.upperLF > off.quantities.upperLF + 0.5)) bad.push(`upperLF ${off.quantities.upperLF.toFixed(1)} → ${on.quantities.upperLF.toFixed(1)} (the hood's slot is not priced as cabinetry)`);
  if (!(on.quantities.hardwareCount > off.quantities.hardwareCount)) bad.push('no pulls for the cabinet on the hood');
  if (!((byId(on, 'cab-upper')?.totalHigh ?? 0) > (byId(off, 'cab-upper')?.totalHigh ?? 0))) bad.push('cab-upper did not grow');
  if (bad.length) fail(`the cabinet on the hood: ${bad.join('; ')}`);
  else ok(`the cabinet on the hood is priced: upperLF ${off.quantities.upperLF.toFixed(1)} → ${on.quantities.upperLF.toFixed(1)} lf, ${on.quantities.hardwareCount - off.quantities.hardwareCount} extra pull(s), band ${on.quantities.hoodBandIn.toFixed(1)}"`);
}
{
  // The paint deduction uses the RUN's row height, not the room default. The
  // client's back run is declared 54" in a 48" kitchen, so the old arithmetic
  // quoted paint behind cabinets that are there.
  const k = clone(marble);
  const before = calculateEstimate(k, marbleSel, FULL).quantities.wallSqft;
  const tall = clone(marble);
  for (const r of tall.runs) if (r.hasUppers) { r.uppersToCeiling = false; r.upperHeightIn = 60; }
  const after = calculateEstimate(tall, marbleSel, FULL).quantities.wallSqft;
  if (!(after < before - 1)) fail(`wallSqft: a 60" row deducts ${after.toFixed(1)} sqft, no more than the room default's ${before.toFixed(1)}`);
  else ok(`wallSqft follows each run's own row height: ${before.toFixed(1)} → ${after.toFixed(1)} sqft when the runs are declared 60" (the room says ${marble.cabinets.upperHeightIn}")`);
}

// ---------------------------------------------------------------------------
section('§17  every bathroom detail field moves the price');
// ---------------------------------------------------------------------------
/**
 * The inverse of the usual assertion, and the one that was missing.
 *
 * The bathroom contract grew ~30 fields describing the vanity face, the
 * enclosure, the tub and the tile, and for a while every one of them was a
 * live control that changed neither the model nor the estimate. Sweeping "a
 * control may only move what it names" cannot catch that, because a field
 * wired to nothing passes it. So: name a field, change it, and the total MUST
 * move. `scripts/verify-scenes.mts` asserts the same thing for the geometry.
 */
{
  const bath = defaultBathroom() as BathroomSpec;
  ensureSpecMaterials(bath);
  const bsel = selOf(bath);
  const base = calculateEstimate(bath, bsel, FULL);
  const drives: Array<[string, (s: BathroomSpec) => void]> = [
    ['shower.doorType', (s) => { s.shower.doorType = 'barn'; }],
    ['shower.glassThicknessIn', (s) => { s.shower.glassThicknessIn = 0.25; }],
    ['shower.nicheAt', (s) => { s.shower.nicheAt = { face: 'back', t: 0.5, centerIn: 48, widthIn: 36, heightIn: 36, shelves: 4 }; }],
    ['shower.benchStyle', (s) => { s.shower.bench = true; s.shower.benchStyle = 'full-width'; }],
    ['tub.material', (s) => { s.tub.material = 'cast-iron'; }],
    ['tub.fillerType', (s) => { s.tub.fillerType = 'wall-mount'; }],
    ['vanity.basin', (s) => { s.vanity.basin = 'vessel'; }],
    ['vanity.faucetMount', (s) => { s.vanity.faucetMount = 'wall'; }],
    ['vanity.counterThicknessIn', (s) => { s.vanity.counterThicknessIn = 3; }],
    ['vanity.backsplash', (s) => { s.vanity.backsplash = 'full-height'; }],
    ['wallTile.pattern', (s) => { s.wallTile = { ...s.wallTile, height: 'full', pattern: 'herringbone' }; }],
    ['wallTile.heightIn', (s) => { s.wallTile = { ...s.wallTile, height: 'wainscot', heightIn: 60 }; }],
    ['wallTile.accent', (s) => { s.wallTile = { ...s.wallTile, accent: { wall: 'left', pattern: 'chevron', moduleIn: null, heightIn: null, colorHex: null } }; }],
    ['accessories', (s) => { s.accessories = Array.from({ length: 10 }, () => ({ kind: 'towel-bar' as const, wall: 'front' as const, t: 0.5, heightFt: 4, widthIn: 24, finish: null })); }],
  ];
  const dead: string[] = [];
  for (const [name, fn] of drives) {
    const s = clone(bath);
    fn(s);
    ensureSpecMaterials(s);
    const e = calculateEstimate(s, bsel, FULL);
    if (e.totalLow === base.totalLow && e.totalHigh === base.totalHigh) dead.push(name);
  }
  if (dead.length) fail(`${dead.length} bathroom field(s) change the twin but not the price: ${dead.join(', ')}`);
  else ok(`all ${drives.length} bathroom detail fields move the estimate off ${base.totalLow}–${base.totalHigh}`);
}

console.log(failures ? `\nFAILED (${failures})\n` : '\nALL ESTIMATE CHECKS PASSED\n');
process.exit(failures ? 1 : 0);
