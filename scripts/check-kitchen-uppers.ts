/** Regression coverage for high shallow rows, window headers and stacked uppers.
 * Synthetic dimensions describe geometric cases; frozen client fixtures stay intact.
 * Run: npx tsx scripts/check-kitchen-uppers.ts */
import assert from 'node:assert/strict';
import { defaultKitchen, emptyDecor } from '../src/lib/spec/defaults';
import type { CabinetRun, KitchenSpec } from '../src/lib/spec/types';
import { canopyHeightIn, hoodCabinetBandIn, rowBottomIn, rowHeightIn, rowToCeilingIn } from '../src/lib/spec/hood';
import { computeKitchenLayout, type KitchenLayoutData, type KUpper } from '../src/components/scene/kitchen/layout';
import { buildKitchenPartsRaw } from '../src/components/scene/kitchen/budget';
import { kitchenElementBoxes } from '../src/lib/fit/boxes';
import { kitchenParams } from '../src/lib/fit/params';

const IN = 0.0254;
let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; assert.ok(value, message); }
function near(a: number, b: number, message: string, tolerance = 1e-4) { check(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`); }
const demo = defaultKitchen();
const boxes = (n: number) => Array.from({ length: n }, () => ({ type: 'door' as const, widthIn: 24 }));
const run: CabinetRun = { ...demo.runs[0], id: 'back', lengthFt: 12, base: boxes(6), uppers: boxes(6), tall: [],
  upperBottomIn: 84, upperHeightIn: 18, uppersToCeiling: true, uppers2: null, uppers2HeightIn: null };
const source: KitchenSpec = { ...demo, dims: { widthFt: 12, depthFt: 12, ceilingFt: 9 },
  cabinets: { ...demo.cabinets, crown: false }, runs: [run], island: { ...demo.island, present: false },
  appliances: [], decor: emptyDecor(), openings: [{ ...demo.openings[0], t: 0.4, widthFt: 4, sillFt: 3.5, heightFt: 3.25 }] };
const real = (u: KUpper) => u.type !== 'hood-gap' && u.type !== 'appliance-gap';
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) > Math.max(a0, b0) + 1e-4;
function safe(L: KitchenLayoutData, label: string) {
  for (const r of L.runs) {
    for (const u of r.uppers.filter(real)) {
      check([u.bottom, u.top, u.x0, u.x1].every(Number.isFinite) && u.top > u.bottom && u.x1 > u.x0, `${label}: finite upper volume`);
      check(u.top <= L.h - L.crownH + 1e-4, `${label}: box under ceiling`);
      for (const o of L.openings.filter((o) => o.wall === r.wall)) {
        check(!(overlap(u.x0, u.x1, o.x - o.width / 2, o.x + o.width / 2)
          && overlap(u.bottom, u.top, o.sill, o.sill + o.height)), `${label}: ${u.id} avoids ${o.id}`);
      }
    }
    for (const [x0, x1, y] of r.underCab) {
      check(r.uppers.some((u) => real(u) && Math.abs(u.bottom - y) < 1e-4 && overlap(x0, x1, u.x0, u.x1)), `${label}: LED belongs to an actual underside`);
      for (const o of L.openings.filter((o) => o.wall === r.wall)) {
        check(!(overlap(x0, x1, o.x - o.width / 2, o.x + o.width / 2) && y > o.sill && y < o.sill + o.height), `${label}: LED does not float across window`);
      }
    }
  }
}
function coveredAt(uppers: KUpper[], x: number, y: number) { return uppers.some((u) => real(u) && x >= u.x0 - 1e-4 && x <= u.x1 + 1e-4 && y >= u.bottom && y <= u.top); }

// A continuous 18-inch row at 84 inches from the floor is still an 18-inch
// row when an older categorical field says to-ceiling. It spans the window.
const high = computeKitchenLayout(source);
safe(high, 'high row');
near(high.runs[0].upperBottom / IN, 84, 'explicit underside');
near(high.runs[0].upperTop / IN, 102, 'explicit height wins over to-ceiling flag');
check(high.runs[0].uppers.length === 6, 'window does not delete or shift any of six declared boxes');
high.runs[0].uppers.forEach((u) => near(u.width / IN, 24, 'declared box width retained'));
for (let x = -70; x <= 70; x += 5) check(coveredAt(high.runs[0].uppers, x * IN, 93 * IN), 'continuous high row across full back wall');
const fitUpper = kitchenElementBoxes(high).find((e) => e.kind === 'upper-cabinet-run')!;
near(fitUpper.box.min[1] / IN, 84, 'fitter uses high underside');
near(fitUpper.box.max[1] / IN, 102, 'fitter uses shallow height');

// The same short row continues on a U-shaped return and above a canopy.
const withHood: KitchenSpec = { ...source, layout: 'u-shaped',
  runs: [run, { ...run, id: 'right', wall: 'right', lengthFt: 8, base: boxes(4), uppers: boxes(4) }],
  appliances: [{ ...demo.appliances.find((a) => a.kind === 'hood')!, t: 0.78, widthIn: 30, hoodShape: 'box', aboveCounterIn: 30, cabinetAbove: 'doors' }] };
const hoodL = computeKitchenLayout(withHood);
safe(hoodL, 'return and hood');
for (const r of hoodL.runs) {
  near(r.upperBottom / IN, 84, `${r.id}: underside`);
  near(r.upperTop / IN, 102, `${r.id}: short top`);
  r.uppers.filter(real).forEach((u) => check(u.top - u.bottom <= 18 * IN + 1e-4, `${r.id}: no tall upper doors invented`));
}
const hood = hoodL.appliances.find((a) => a.kind === 'hood')!;
check(coveredAt(hoodL.runs[0].uppers, hood.x, 93 * IN), 'real cabinet over hood joins high row');
near(hood.cabinetBottom! / IN, 84, 'hood cabinet does not extend below measured row');
near(rowBottomIn(withHood, run), hoodL.runs[0].upperBottom / IN, 'hood helper underside');
near(rowHeightIn(withHood, run), 18, 'hood helper shallow height');
near(rowToCeilingIn(withHood, run), 6, 'hood helper ceiling gap');
near(hoodCabinetBandIn(withHood, run, withHood.appliances[0]), 18, 'hood helper cabinet band');
const slimL = computeKitchenLayout({ ...withHood, appliances: [{ ...withHood.appliances[0], hoodShape: 'slim', hoodStyle: 'under-cabinet' }] });
const slim = slimL.appliances.find((a) => a.kind === 'hood')!;
near((slim.y + slim.height) / IN, 84, 'slim insert hangs below measured underside');
near(slim.cabinetBottom! / IN, 84, 'slim insert preserves complete shallow cabinet height');

// A measured short black canopy, white chase and closed high row are three
// separate observed parts. Neither default canopy size nor appliance carving
// may replace them with one oversized black unit or a blank upper panel.
const smallHood = { ...withHood.appliances[0], heightIn: 8, cabinetAbove: 'panel' as const, bodyFinish: 'matte-black' as const };
const smallHoodSpec = { ...withHood, runs: [run], appliances: [smallHood] };
const chaseL = computeKitchenLayout(smallHoodSpec);
const small = chaseL.appliances.find((a) => a.kind === 'hood')!;
near(small.height / IN, 8, 'explicit small canopy retained');
near((small.top - small.y) / IN, 8, 'white chase does not become extra black flue');
near(canopyHeightIn(smallHood), 8, 'canopy helper honors measured size');
near(canopyHeightIn({ ...smallHood, heightIn: null }), 14, 'unmeasured box retains shape default');
const hoodHeightParam = kitchenParams(smallHoodSpec, smallHoodSpec).find((p) => p.label === 'appliances[0].heightIn')!;
check(!!hoodHeightParam && hoodHeightParam.dim.min <= 8 && hoodHeightParam.dim.max >= 8, 'observed8in hood lies within optimizer bounds');
check(!!hoodHeightParam.scan && hoodHeightParam.scan[0] <= 8 && hoodHeightParam.scan[1] >= 8, 'observed8in hood lies within scan bounds');
const roundtrip = structuredClone(smallHoodSpec);
hoodHeightParam.set(roundtrip, Math.max(hoodHeightParam.dim.min, Math.min(hoodHeightParam.dim.max, hoodHeightParam.get(roundtrip))));
near(computeKitchenLayout(roundtrip).appliances[0].height / IN, 8, 'optimizer bounds roundtrip retains measured8in canopy');
const defaultParams = kitchenParams(demo, demo);
const legacyRow = defaultParams.find((p) => p.label === 'runs[0].upperHeightIn')!;
check(legacyRow.dim.min === 24 && legacyRow.dim.max === 48 && legacyRow.scan?.[0] === 24 && legacyRow.scan[1] === 48, 'conventional unmeasured row retains established search range');
const legacyHood = defaultParams.find((p) => p.label === `appliances[${demo.appliances.findIndex((a) => a.kind === 'hood')}].heightIn`)!;
check(legacyHood.dim.min === 12 && legacyHood.scan?.[0] === 12, 'unmeasured canopy cannot acquire an unsupported compact search range');
const raisedParam = kitchenParams(source, source).find((p) => p.label === 'runs[0].upperHeightIn')!;
check(raisedParam.dim.min === 12 && raisedParam.dim.max === 60, 'measured raised row retains expanded height vocabulary');
for (const height of [12, 60]) {
  const observed = { ...source, runs: [{ ...run, upperBottomIn: null, upperHeightIn: height }] };
  const param = kitchenParams(observed, observed).find((p) => p.label === 'runs[0].upperHeightIn')!;
  check(param.dim.min <= height && param.dim.max >= height, `observed ${height}in row remains inside optimizer bounds without a mounting height`);
}
const shortGlobal = { ...demo, cabinets: { ...demo.cabinets, upperHeightIn: 12 } };
check(kitchenParams(shortGlobal, shortGlobal).find((p) => p.label === 'cabinets.upperHeightIn')!.dim.min === 12, 'observed short global height remains searchable');
check(chaseL.runs[0].uppers.filter((u) => u.type === 'door').length === 6, 'six closed boxes retained over chase');
const chase = chaseL.runs[0].uppers.find((u) => u.id === 'back-hood-chase')!;
check(!!chase && chase.hood?.front === 'panel', 'separate plain chase present');
near(chase.bottom, small.top, 'white chase meets black canopy');
near(chase.top / IN, 84, 'white chase stops under closed row');
const chaseUpperBox = kitchenElementBoxes(chaseL).find((e) => e.kind === 'upper-cabinet-run')!;
near(chaseUpperBox.box.min[1] / IN, 84, 'separate chase does not stretch upper-row fit box down');
const chaseParts = buildKitchenPartsRaw(chaseL);
const canopy = chaseParts.find((p) => p.key === `${small.id}-canopy`)!;
canopy.geometry.computeBoundingBox();
near((canopy.geometry.boundingBox!.max.y - canopy.geometry.boundingBox!.min.y) / IN, 8, 'rendered small black canopy height');
check(canopy.util === 'matte-black', 'canopy keeps observed black finish');
check(chaseParts.filter((p) => p.key.startsWith('back-hood-chase')).every((p) => p.slot === 'cabinets_upper' && !p.metal && !p.util), 'chase uses cabinet finish separately');
check(chaseParts.filter((p) => /^back-u\d+-f\d+-hw/.test(p.key)).length === 6, 'all six upper front handles retained');
chaseParts.forEach((p) => p.geometry.dispose());

// A cooktop sits above the observed drawer bank; it is not a floor-standing
// range and must not claim a nearby appliance gap or remove those drawers.
const cooktopSpec: KitchenSpec = { ...source, runs: [{ ...run, base: boxes(6).map((b, i) => i === 3
  ? { ...b, type: 'drawers' as const, drawerCount: 3 } : b) }],
  appliances: [{ ...demo.appliances.find((a) => a.kind === 'range')!, kind: 'cooktop', t: 0.6, widthIn: 24 }] };
const cooktopL = computeKitchenLayout(cooktopSpec);
const cooking = cooktopL.appliances[0];
check(cooktopL.runs[0].base.length === 6, 'cooktop retains six observed base modules');
check(cooktopL.runs[0].base.some((b) => b.type === 'drawers' && b.drawerCount === 3 && b.x0 < cooking.x && b.x1 > cooking.x), 'three observed drawers remain below cooktop');
check(!cooktopL.runs[0].base.some((b) => b.filledBy === 'cooktop' || b.type === 'appliance-gap'), 'cooktop creates no base void');
const cookerWithGap = computeKitchenLayout({ ...cooktopSpec, runs: [{ ...cooktopSpec.runs[0], base: boxes(6).map((b, i) => i === 0 ? { ...b, type: 'appliance-gap' as const } : b) }] });
near(cookerWithGap.appliances[0].x, cooking.x, 'cooktop does not snap sideways into appliance gap');

// Tier 1 is interrupted by the window; tier 2 above its head stays continuous.
const stacked: KitchenSpec = { ...source, runs: [{ ...run, upperBottomIn: null, upperHeightIn: 54,
  uppersToCeiling: false, uppers2: boxes(6), uppers2HeightIn: 18 }] };
const stackedL = computeKitchenLayout(stacked);
safe(stackedL, 'stacked row');
const transoms = stackedL.runs[0].uppers.filter((u) => u.tier === 2);
check(transoms.length === 6, 'all six second-tier boxes retained');
for (let x = -70; x <= 70; x += 5) check(coveredAt(transoms, x * IN, 99 * IN), 'transom row continuous over window');

// Short individual boxes hang from the row top without being flowed sideways
// around a window that lies entirely below their actual volume.
const conventional: KitchenSpec = { ...source, runs: [{ ...run, upperBottomIn: null, upperHeightIn: 42, uppersToCeiling: false,
  uppers: boxes(6) }] };
const repeatedHeight = { ...conventional, runs: [{ ...conventional.runs[0], uppers: boxes(6).map((u) => ({ ...u, heightIn: 42 })) }] };
const conventionalUppers = computeKitchenLayout(conventional).runs[0].uppers;
const repeatedUppers = computeKitchenLayout(repeatedHeight).runs[0].uppers;
check(conventionalUppers.length === repeatedUppers.length, 'repeating the full row height cannot create extra above-window boxes');
conventionalUppers.forEach((u, i) => {
  const repeated = repeatedUppers[i];
  check(u.id === repeated.id && u.type === repeated.type, 'repeated full-height door retains window-side identity');
  for (const field of ['x0', 'x1', 'bottom', 'top'] as const) near(u[field], repeated[field], `repeated full-height door retains ${field}`, 1e-9);
});
const mixed: KitchenSpec = { ...source, runs: [{ ...run, upperBottomIn: null, upperHeightIn: 54, uppersToCeiling: false,
  uppers: boxes(6).map((u, i) => ({ ...u, heightIn: i === 1 || i === 2 ? 18 : 54 })) }] };
const mixedL = computeKitchenLayout(mixed);
safe(mixedL, 'individual heights');
for (const i of [1, 2]) {
  const u = mixedL.runs[0].uppers.find((u) => u.id === `back-u${i}`)!;
  check(!!u, `short box ${i} exists`);
  near(u.x0 / IN, -72 + i * 24, `short box ${i} horizontal position`);
  near((u.top - u.bottom) / IN, 18, `short box ${i} own height`);
}

// An observed row partially crossing an opening retains its above-window
// volume and full-height cabinets beside it, without impossible L-shaped boxes.
const crossing: KitchenSpec = { ...source, runs: [{ ...run, upperBottomIn: 72, upperHeightIn: 30 }] };
const crossingL = computeKitchenLayout(crossing);
safe(crossingL, 'opening carve');
const window = crossingL.openings[0];
for (let dx = -20; dx <= 20; dx += 4) check(coveredAt(crossingL.runs[0].uppers, window.x + dx * IN, 93 * IN), 'above-window volume preserved');
check(crossingL.runs[0].uppers.some((u) => u.x1 < window.x - window.width / 2 && Math.abs(u.bottom / IN - 72) < 1e-4), 'full-height side cabinet retained');
const parts = buildKitchenPartsRaw(crossingL);
check(new Set(parts.map((p) => p.key)).size === parts.length, 'split upper mesh keys unique');
for (const p of parts.filter((p) => p.key.startsWith('back-rail'))) {
  p.geometry.computeBoundingBox();
  const bounds = p.geometry.boundingBox!;
  const x0 = bounds.min.x + (p.position?.[0] ?? 0), x1 = bounds.max.x + (p.position?.[0] ?? 0);
  const y0 = bounds.min.y + (p.position?.[1] ?? 0), y1 = bounds.max.y + (p.position?.[1] ?? 0);
  check(!(overlap(x0, x1, window.x - window.width / 2, window.x + window.width / 2) && overlap(y0, y1, window.sill, window.sill + window.height)), 'entire rendered light rail avoids window');
}
parts.forEach((p) => p.geometry.dispose());

// Invalid saved heights remain finite and bounded, and absence stays absence.
for (const bottom of [24, 60, 84, 228, Number.NaN, -1, Infinity]) {
  const s = { ...source, dims: { ...source.dims, ceilingFt: 7 }, runs: [{ ...run, upperBottomIn: bottom }] };
  safe(computeKitchenLayout(s), `7ft room bottom ${bottom}`);
}
const counterConflict = computeKitchenLayout({ ...source, runs: [{ ...run, upperBottomIn: 24 }] });
check(counterConflict.runs[0].upperBottom > counterConflict.counterTopY, 'impossible measured underside clears counter');
check(counterConflict.decor.warnings.some((w) => w.includes('requested 24.0 in') && w.includes('drawn at')), 'measurement clamp disclosed');
check(computeKitchenLayout({ ...source, runs: [{ ...run, hasUppers: false }] }).runs[0].uppers.length === 0, 'no uppers remain absent');
console.log(`PASS ${checks} high-row, window, hood, trim and lighting checks`);
