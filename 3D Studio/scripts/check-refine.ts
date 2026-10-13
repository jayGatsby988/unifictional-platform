/**
 * MANHATTAN — headless verification for the accuracy pass.
 *
 *   npx tsx scripts/check-refine.ts
 *
 * No network. Drives `applyCorrections()` — the pure half of the refine
 * pipeline — with hand-written model outputs against the default kitchen and
 * bathroom, and asserts the gate behaves: valid edits get through, everything
 * the allowlist / ranges / schemas reject stays out and is reported with a
 * reason, array ops validate and cap, camera edits land, finishes reach the
 * matcher, and the whole thing is deterministic. Then the measured half:
 * the fitter's residuals render as the words the prompt (and the match
 * report) use, and the match loop's stop rules hold against a fake fitter.
 */
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { applyCorrections, buildRefinePrompt, editSchema, hintsOf, measureRefineViewport, parseRefineOutput, REFINABLE, REFINABLE_ARRAYS, refinableFor, residualFacts, residualsOf as residualsOfFit, sanitizeMinConfidence, SERVER_MIN_CONFIDENCE, summarizeCorrections, type ApplyResult, type ModelOutput } from '../src/lib/ai/refine';
import { coverageOf, hintSentence, residualFromBoxes, residualName, residualPhrases, residualSentence, residualsOf, runMatchLoop, type MatchLoopDriver } from '../src/lib/api-client';
import { fitToPhoto, fromEstimate, kitchenElementBoxes, makeCamera, projectElement } from '../src/lib/fit';
import { applyMeasurements } from '../src/lib/spec/measurements';
import { getMaterial } from '../src/lib/materials/catalog';
import { computeKitchenLayout, islandTopFt } from '../src/components/scene/kitchen/layout';
import { mToFt } from '../src/lib/units';
import { inventoryDisagreements, ISLAND_KNEE_IN, reconcileSpec } from '../src/lib/ai/reconcile';
import { ProviderError } from '../src/lib/ai/providers/types';
import { defaultBathroom, defaultKitchen } from '../src/lib/spec/defaults';
import { RoomSpecZ, jsonSchemaFor } from '../src/lib/spec/schema';
import { inventoryJsonSchema } from '../src/lib/ai/inventory';
import { buildAnalysisPrompt, describeGeometry, FINISH_COLOR_DISCIPLINE } from '../src/lib/ai/prompt';
import type { KitchenSpec, RoomSpec } from '../src/lib/spec/types';

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const check = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));

const run = (spec: RoomSpec, output: ModelOutput, minConfidence?: number): ApplyResult => applyCorrections(spec, output, { minConfidence });
const out = (corrections: unknown[], extra: Partial<ModelOutput> = {}): ModelOutput => ({ corrections, notes: [], match: 0.7, finishes: [], ...extra });
const set = (field: string, value: number | string | boolean, index: number | null = null, confidence = 0.9) => ({
  op: 'set', field, index,
  value_number: typeof value === 'number' ? value : null,
  value_string: typeof value === 'string' ? value : null,
  value_boolean: typeof value === 'boolean' ? value : null,
  value_element: null, reason: 'test', confidence,
});
const applied = (r: ApplyResult) => r.corrections.filter((c) => c.applied);
const rejected = (r: ApplyResult, field: string) => r.corrections.find((c) => c.field === field && !c.applied);

console.log('\nObserved shelf construction and raised upper rows');
{
  const k = defaultKitchen();
  k.runs[0].uppersToCeiling = true;
  delete k.runs[0].upperBottomIn;
  k.decor.shelves = [{ wall: 'left', t: 0.5, widthIn: 24, count: 4, bottomFt: 3, depthIn: 12, spacingIn: 16, material: 'wood', styled: 'mixed' }];
  const before = JSON.stringify(k);
  const corrected = run(k, out([
    set('runs[].upperBottomIn', 84, 0), set('runs[].upperHeightIn', 12, 0),
    set('decor.shelves[].enclosure.heightIn', 60, 0),
    set('decor.shelves[].enclosure.backPanel', true, 0),
    set('decor.shelves[].enclosure.panelThicknessIn', 0.75, 0),
    set('decor.shelves[].finishColorHex', '#654321', 0),
  ]));
  const c = corrected.spec as KitchenSpec;
  check(applied(corrected).length === 6, 'legacy saved specs can receive all observed row/case/color fields');
  check(c.runs[0].upperBottomIn === 84 && c.runs[0].upperHeightIn === 12, 'a 12-inch row keeps its measured underside despite a legacy to-ceiling flag');
  check(c.runs[0].uppers2 == null, 'a short raised row cannot become an invented second tier');
  const shortDefault = run(k, out([set('cabinets.upperHeightIn', 12)]));
  check(shortDefault.spec.roomType === 'kitchen' && shortDefault.spec.cabinets.upperHeightIn === 12 && applied(shortDefault).length === 1, 'a 12-inch global upper height survives both refinement and reconciliation');
  check(c.decor.shelves[0].enclosure?.heightIn === 60 && c.decor.shelves[0].enclosure.backPanel && c.decor.shelves[0].bottomFt === 3 && c.decor.shelves[0].finishColorHex === '#654321', 'the observed wood case keeps its full height, backing, counter-level base and independent color');
  check(JSON.stringify(k) === before, 'correcting enclosure geometry leaves the source spec untouched');
  const boxedCase = structuredClone(c);
  boxedCase.detected.elements = [{ id: 'case-1', kind: 'shelf', wall: 'left', facing: null, label: 'enclosed wood display case, four boards', confidence: 0.9, box: { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.8 }, open: null, openCause: null }];
  check(!inventoryDisagreements(boxedCase).some((note) => note.includes('shelf')), 'one whole-case annotation agrees with a four-board enclosed unit');
  const floating = reconcileSpec(k, { photoCount: 1 });
  check(floating.roomType === 'kitchen' && !floating.decor.shelves[0].enclosure, 'ordinary floating boards remain open without evidence of a case');
  const backingOnly = run(k, out([set('decor.shelves[].enclosure.backPanel', true, 0)]));
  check(applied(backingOnly).length === 0, 'a backing-only edit cannot invent an unmeasured shelf enclosure');
  const turned = run(c, out([set('decor.shelves[].enclosure.rotationDeg', -90, 0)]));
  const turnSpec = turned.spec as KitchenSpec;
  check(applied(turned).length === 1 && turnSpec.decor.shelves[0].enclosure?.rotationDeg === -90 && turnSpec.decor.shelves[0].wall === c.decor.shelves[0].wall && turnSpec.decor.shelves[0].t === c.decor.shelves[0].t, 'an observed case can turn toward the front without relocating its mounting wall');
  check(applied(run(c, out([set('decor.shelves[].enclosure.rotationDeg', 45, 0)]))).length === 0, 'arbitrary non-quarter-turn case angles are rejected');
  check(applied(run(k, out([set('decor.shelves[].enclosure.rotationDeg', -90, 0)]))).length === 0, 'a rotation-only edit cannot invent an enclosure around floating boards');
  const cramped = structuredClone(c);
  cramped.decor.shelves[0].enclosure = { heightIn: 18, backPanel: true, panelThicknessIn: 1 };
  const fitted = reconcileSpec(cramped, { photoCount: 1 }) as KitchenSpec;
  const sh = fitted.decor.shelves[0];
  check((sh.count - 1) * sh.spacingIn + 2 <= sh.enclosure!.heightIn, 'interior shelf boards stay inside the observed carcass instead of piercing its top');
  const wording = buildRefinePrompt(c, ['geometry']);
  check(wording.includes('underside 84 in above floor') && wording.includes('enclosed case 60') && wording.includes('above a window') && wording.includes('Set decor.shelves[].enclosure.heightIn FIRST'), 'the visual audit receives actual row edges and distinguishes casework from floating boards');
  const renderWords = describeGeometry(c).join('\n');
  check(renderWords.includes('ENCLOSED OPEN DISPLAY CASE') && renderWords.includes('whole row underside 84') && renderWords.includes('#654321'), 'photoreal render instructions preserve the case, raised row and observed wood tone too');
}

console.log('\nObserved cabinet/opening relationships');
{
  const k = defaultKitchen();
  k.cabinets.crown = false;
  k.dims.ceilingFt = 8;
  k.appliances = [];
  k.runs = [k.runs[0]];
  k.runs[0].upperBottomIn = 60;
  k.runs[0].upperHeightIn = 24;
  k.openings = [{ id: 'observed-window', kind: 'window', style: 'standard', wall: 'back', t: 0.45, widthFt: 4, sillFt: 3.5, heightFt: 3 }];
  k.detected.elements = [
    { id: 'upper-row', kind: 'upper-cabinet-run', wall: 'back', facing: 'front', box: { x0: 0.2, x1: 0.85, y0: 0.1, y1: 0.3 }, label: 'short upper row', confidence: 0.95 },
    { id: 'window', kind: 'window', wall: 'back', facing: 'front', box: { x0: 0.3, x1: 0.6, y0: 0.3, y1: 0.6 }, label: 'window beneath row', confidence: 0.95 },
  ];
  const fixed = reconcileSpec(k, { photoCount: 1 }) as KitchenSpec;
  check(fixed.runs[0].upperBottomIn === 78 && fixed.runs[0].upperHeightIn === 18, 'coplanar photo evidence keeps a high upper row above its window and below the ceiling');
  const malformed = structuredClone(k);
  malformed.detected.elements = [null, 42, 'window', { kind: 'window', box: null }, ...k.detected.elements] as unknown as KitchenSpec['detected']['elements'];
  const repaired = reconcileSpec(malformed, { photoCount: 1 }) as KitchenSpec;
  check(RoomSpecZ.safeParse(repaired).success && repaired.runs[0].upperBottomIn === 78, 'malformed inventory is cleaned before cabinet/window inference without discarding valid evidence');
  for (const kind of ['missing', 'side-facing', 'overlap', 'occluded', 'ambiguous'] as const) {
    const uncertain = structuredClone(k);
    if (kind === 'missing') uncertain.detected.elements = [];
    if (kind === 'side-facing') uncertain.detected.elements[0].facing = 'left';
    if (kind === 'overlap') uncertain.detected.elements[0].box.y1 = 0.5;
    if (kind === 'occluded') uncertain.detected.elements[0].open = { left: false, right: false, top: false, bottom: true };
    if (kind === 'ambiguous') uncertain.openings.push({ ...uncertain.openings[0], id: 'second-window', t: 0.8 });
    const untouched = reconcileSpec(uncertain, { photoCount: 1 }) as KitchenSpec;
    check(untouched.runs[0].upperBottomIn === 60, `${kind} inventory cannot invent a raised cabinet row`);
  }
  const cooker = defaultKitchen();
  const template = cooker.appliances.find(a => a.kind === 'range')!;
  const drawerRun = cooker.runs.find(r => r.wall === 'left')!;
  const drawerIndex = drawerRun.base.findIndex(c => c.type === 'drawers');
  const drawer = structuredClone(drawerRun.base[drawerIndex]);
  const hobT = drawerRun.start + (drawerRun.base.slice(0, drawerIndex).reduce((sum, c) => sum + c.widthIn, 0) + drawer.widthIn / 2) / 12 / cooker.dims.depthFt;
  cooker.appliances = [{ ...template, kind: 'cooktop', wall: 'left', t: hobT, widthIn: 24, hoodStyle: null }];
  const hobFixed = reconcileSpec(cooker, { photoCount: 1 }) as KitchenSpec;
  const keptDrawer = hobFixed.runs.find(r => r.wall === 'left')!.base[drawerIndex];
  check(keptDrawer.type === 'drawers' && keptDrawer.drawerCount === drawer.drawerCount && keptDrawer.widthIn === drawer.widthIn, 'a drop-in cooktop keeps the visible drawer cabinet underneath');
  check(hobFixed.appliances[0].t === hobT, 'a drop-in cooktop is not relocated to an unrelated appliance opening');
  const highRun = cooker.runs.find(r => r.wall === 'left')!;
  highRun.upperBottomIn = 84; highRun.upperHeightIn = 18;
  highRun.uppers = highRun.base.map(c => ({ widthIn: c.widthIn, type: 'door' as const, heightIn: null }));
  cooker.appliances.push({ ...template, kind: 'hood', wall: 'left', t: hobT, widthIn: 30, hoodStyle: 'chimney', hoodShape: 'box', heightIn: 8, aboveCounterIn: 30, cabinetAbove: 'panel' });
  const belowRow = reconcileSpec(cooker, { photoCount: 1 }) as KitchenSpec;
  check(belowRow.runs.find(r => r.wall === 'left')!.uppers!.every(u => u.type === 'door'), 'a short canopy and plain chase below a high row do not erase the closed upper doors');
  const words = buildAnalysisPrompt('kitchen', '', 1);
  check(words.includes('DROP-IN COOKTOP') && words.includes('WITHOUT AN ISLAND') && words.includes('Handle-free doors') && words.includes('12 × (window.sillFt + window.heightFt)'), 'analysis distinguishes cooktops, remote pendants, handle-free doors and physical window clearance');
}

console.log('\nEvidence consistency: current viewport and confirmed dimensions');
{
  const k = defaultKitchen();
  k.detected.confidence = 0.4;
  k.detected.primaryPhotoIndex = 2;
  const measured = applyMeasurements(k, { widthFt: 15 + 7 / 12, ceilingFt: 9 + 1 / 12 }, '2026-09-09T12:00:00Z');
  const r = run(measured, out([set('dims.widthFt', 20), set('dims.ceilingFt', 10), set('cabinets.doorStyle', 'flat')]));
  check(r.spec.roomType === 'kitchen' && r.spec.dims.widthFt === measured.dims.widthFt && r.spec.dims.ceilingFt === measured.dims.ceilingFt, 'photo corrections cannot replace precise measured dimensions');
  check(rejected(r, 'dims.widthFt')?.rejected === 'confirmed measurement is locked' && rejected(r, 'dims.ceilingFt')?.rejected === 'confirmed measurement is locked', 'measurement conflicts are rejected with a specific reason');
  check(r.spec.detected.primaryPhotoIndex === 2 && r.spec.detected.measurements?.widthFt === measured.dims.widthFt, 'accepted detail corrections preserve both the primary image and measurement record');
  check(r.spec.detected.confidence === measured.detected.confidence, 'a model-predicted match cannot turn uncertain source geometry into verified dimensions');
  const prompt = buildRefinePrompt(measured, ['geometry']);
  check(prompt.includes('CONFIRMED MEASUREMENTS') && !prompt.includes('  dims.widthFt (number'), 'vision receives measured constraints and cannot select those fields as editable');
  const selectionBefore = JSON.stringify(measured);
  const selectedPrompt = buildRefinePrompt(measured, ['finishes'], null, { cabinets_base: 'wood-black-walnut' });
  const selectedName = getMaterial('wood-black-walnut')?.name;
  check(!!selectedName && selectedPrompt.includes(`cabinets_base: ${selectedName}`), 'finish comparison describes the studio material actually visible in the screenshot');
  check(selectedPrompt.includes(FINISH_COLOR_DISCIPLINE) && selectedPrompt.includes('fallible hypotheses') && selectedPrompt.includes('rendering-light/exposure mismatch'), 'finish refinement preserves source contrast, rechecks old color guesses, and separates shared lighting errors from material errors');
  check(!buildRefinePrompt(measured, ['geometry']).includes(FINISH_COLOR_DISCIPLINE), 'geometry-only requests do not acquire a conflicting finish-correction task');
  check(JSON.stringify(measured) === selectionBefore, 'rendered material choices cannot overwrite the reconstruction baseline');
  const fridgeIndex = k.appliances.findIndex((a) => a.kind === 'fridge');
  const plain = structuredClone(k);
  delete plain.appliances[fridgeIndex].hasDispenser;
  const dispenser = run(plain, out([set('appliances[].hasDispenser', true, fridgeIndex)]));
  check(dispenser.spec.roomType === 'kitchen' && dispenser.spec.appliances[fridgeIndex].hasDispenser === true, 'an observed dispenser can be added to an older saved fridge without the field');
  const rangeIndex = k.appliances.findIndex((a) => a.kind === 'range');
  const invalidDispenser = run(k, out([set('appliances[].hasDispenser', true, rangeIndex)]));
  check(applied(invalidDispenser).length === 0, 'a door-dispenser correction cannot be applied to another appliance kind');

  const camera = fromEstimate(k, 1.5);
  k.detected.camera.solved = camera;
  k.detected.elements = kitchenElementBoxes(computeKitchenLayout(k)).flatMap((element, i) => {
    const box = projectElement(makeCamera(camera), element);
    if (!box || element.kind === 'wall' || element.kind === 'floor' || element.kind === 'ceiling') return [];
    return [{ id: `view-${i}`, kind: element.kind, wall: element.wall, facing: null, box: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] }, label: element.kind, confidence: 1 }];
  });
  const before = JSON.stringify(k);
  const viewport = measureRefineViewport(k);
  check(!!viewport && (viewport.score ?? 0) > 0.99 && viewport.residuals.length > 0, 'refinement measures the existing screenshot camera accurately without a search');
  check(JSON.stringify(k) === before, 'pre-refinement measurement cannot change screenshot geometry or camera');
  k.detected.camera.solved = null;
  check(measureRefineViewport(k) === null, 'a missing screenshot camera is not replaced with an invented pre-fit');
}

// ---------------------------------------------------------------------------
console.log('\n1. Allowlist sanity');
{
  const paths = new Set<string>();
  for (const f of REFINABLE) {
    if (paths.has(f.path)) fail(`duplicate allowlist entry ${f.path}`);
    paths.add(f.path);
    if (f.kind === 'string' && !f.values?.length) fail(`${f.path}: string field without values`);
    if ((f.kind === 'number' || f.kind === 'integer') && f.min === undefined && !f.numberValues) fail(`${f.path}: number field without a range`);
  }
  ok(`${REFINABLE.length} unique allowlisted fields, every string enumerated, every number ranged`);
  const must = ['detected.camera.fovDeg', 'detected.camera.heightFt', 'detected.camera.position', 'detected.camera.lookingAt', 'runs[].backsplash', 'backsplash.height', 'island.offset.x', 'island.offset.z', 'island.rotationDeg', 'island.overhangIn', 'cabinets.baseDepthIn', 'sink.widthIn', 'appliances[].hoodStyle', 'appliances[].fridgeStyle', 'appliances[].finish', 'lighting.pendants.style', 'openings[].kind', 'openings[].style', 'decor.windowTreatment', 'decor.counterStyling', 'decor.rug.present', 'decor.shelves[].count', 'decor.plants[].sizeFt', 'decor.art[].widthIn',
    // the contract fields. runs[].uppers[].heightIn and runs[].tall[].toCeiling are
    // deliberately absent: the path grammar carries ONE index, so they are
    // LayoutPanel- and fitter-only.
    'appliances[].cabinetAbove', 'appliances[].hoodShape', 'backsplash.heightIn', 'countertop.overhangIn',
    'island.endPlacement', 'island.endOverhangIn', 'island.stoolOffsetIn',
    'decor.items[].t', 'decor.items[].sizeIn', 'decor.items[].kind', 'decor.items[].burner',
    'decor.cabinetContents[].kind', 'decor.cabinetContents[].density'];
  const kitchen = new Set(refinableFor('kitchen').map((f) => f.path));
  for (const p of must) check(kitchen.has(p), `kitchen may edit ${p}`);
  // Load backward-compatible defaults through the public schema, then create
  // an observed case through the same correction path as a real photo audit.
  // Nested case fields intentionally have no target while enclosure is null.
  const withObservedCase = (spec: RoomSpec) => run(RoomSpecZ.parse(spec) as RoomSpec, out([set('decor.shelves[].enclosure.heightIn', 30, 0)])).spec;
  const specs = { kitchen: withObservedCase(defaultKitchen()), bathroom: withObservedCase(defaultBathroom()) } as const;
  let unresolved = 0;
  for (const f of REFINABLE) {
    for (const room of f.rooms) {
      if (room === 'exterior' || room === 'floorplan') continue;
      const spec = specs[room] as unknown as Record<string, unknown>;
      let cur: unknown = spec;
      for (const part of f.path.split('.')) {
        if (cur === null || typeof cur !== 'object') { cur = undefined; break; }
        cur = part.endsWith('[]') ? (cur as Record<string, unknown[]>)[part.slice(0, -2)]?.[0] : (cur as Record<string, unknown>)[part];
      }
      if (cur === undefined) { unresolved++; fail(`${f.path} does not resolve on the default ${room}`); }
    }
  }
  if (!unresolved) ok('every allowlisted path resolves on schema-loaded kitchen / bathroom with an observed case');
}

// ---------------------------------------------------------------------------
console.log('\n2. Scalar edits apply');
{
  const k = defaultKitchen();
  const r = run(k, out([
    set('island.lengthFt', 6),
    set('runs[].lengthFt', 12, 0),
    set('runs[].backsplash', false, 1),
    set('cabinets.doorStyle', 'flat'),
    set('island.rotationDeg', 90),
    set('island.offset.x', -2),
    set('decor.windowTreatment', 'curtains'),
    set('appliances[].fridgeStyle', 'built-in', 0),
    set('lighting.pendants.style', 'cone'),
  ]));
  const s = r.spec as KitchenSpec;
  check(applied(r).length === 9, `9 of 9 valid edits applied (${applied(r).length})`);
  check(s.island.lengthFt === 6, 'island.lengthFt = 6');
  // the reconciler re-fits the cabinets to the new length and may round the
  // run up to the nearest cabinet boundary, so the edit is judged within 10%
  check(Math.abs(s.runs[0].lengthFt - 12) <= 1.2 && s.runs[0].lengthFt !== 16, `runs[0].lengthFt = 12 → ${s.runs[0].lengthFt} after cabinet re-fit`);
  check(s.runs[1].backsplash === false, 'runs[1].backsplash = false');
  check(s.cabinets.doorStyle === 'flat', 'cabinets.doorStyle = flat');
  check(s.island.rotationDeg === 90, 'island.rotationDeg = 90');
  // offsets are clamped by the reconciler to keep walkway clearance, so only the direction and magnitude are asserted
  check(s.island.offset.x <= -1 && s.island.offset.x >= -2, `island.offset.x moved left (${s.island.offset.x})`);
  check(s.decor.windowTreatment === 'curtains', 'decor.windowTreatment = curtains');
  check(s.appliances[0].fridgeStyle === 'built-in', 'appliances[0].fridgeStyle = built-in');
  check(s.lighting.pendants?.style === 'cone', 'lighting.pendants.style = cone');
  check(k.island.lengthFt === 7 && k.runs[1].backsplash === true, 'input spec was not mutated');
  check(r.changed && RoomSpecZ.safeParse(r.spec).success, 'result is a valid RoomSpec and flagged as changed');
  check(r.spec.detected.notes.some((n) => n.startsWith('Checked against your photo')), 'audit line recorded in detected.notes');
  const summary = summarizeCorrections(r.corrections);
  check(summary.length === 8 && summary[0] === 'island lengthFt: 7 → 6', `summary reads "${summary[0]}"`);
}

// ---------------------------------------------------------------------------
console.log('\n3. Bad edits are rejected with reasons');
{
  const k = defaultKitchen();
  const r = run(k, out([
    set('island.lengthFt', 40),                       // above max
    set('island.widthFt', 0.5),                       // below min
    set('island.rotationDeg', 45),                    // not one of 0 | 90
    set('cabinets.doorStyle', 'louvered'),            // not in enum
    set('island.present', 'yes'),                     // wrong type (string for boolean)
    set('runs[].lengthFt', 'twelve', 0),              // wrong type (string for number)
    set('runs[].lengthFt', 9, 7),                     // index out of range
    set('runs[].lengthFt', 9),                        // missing index
    set('materials.countertop', 'quartz-white'),      // not on the allowlist
    set('detected.confidence', 1),                    // not on the allowlist
    set('island.seating', 5, null, 0.2),              // below confidence floor
    set('island.lengthFt', 7),                        // already matches
    { op: 'set', field: 'island.lengthFt', index: null, value_number: Number.NaN, value_string: null, value_boolean: null, value_element: null, reason: '', confidence: 1 },
    set('vanity.widthIn', 48),                        // bathroom field on a kitchen
  ]));
  check(applied(r).length === 0, `none of ${r.corrections.length} bad edits applied`);
  const reasons = Object.fromEntries(r.corrections.map((c) => [`${c.field}#${c.index}#${c.to}`, c.rejected]));
  check(/maximum/.test(rejected(r, 'island.lengthFt')?.rejected ?? ''), 'over-max rejected: ' + rejected(r, 'island.lengthFt')?.rejected);
  check(/minimum/.test(rejected(r, 'island.widthFt')?.rejected ?? ''), 'under-min rejected: ' + rejected(r, 'island.widthFt')?.rejected);
  check(/not one of/.test(rejected(r, 'island.rotationDeg')?.rejected ?? ''), 'rotation 45 rejected: ' + rejected(r, 'island.rotationDeg')?.rejected);
  check(/not one of/.test(rejected(r, 'cabinets.doorStyle')?.rejected ?? ''), 'unknown enum rejected');
  check(/expected a boolean/.test(rejected(r, 'island.present')?.rejected ?? ''), 'string-for-boolean rejected');
  check(/expected a number/.test(r.corrections.find((c) => c.field === 'runs[].lengthFt' && c.index === 0)?.rejected ?? ''), 'string-for-number rejected');
  check(/does not exist/.test(r.corrections.find((c) => c.field === 'runs[].lengthFt' && c.index === 7)?.rejected ?? ''), 'out-of-range index rejected');
  check(/needs an index/.test(r.corrections.find((c) => c.field === 'runs[].lengthFt' && c.index === null)?.rejected ?? ''), 'missing index rejected');
  check(/not editable/.test(rejected(r, 'materials.countertop')?.rejected ?? ''), 'materials.* not editable');
  check(/not editable/.test(rejected(r, 'detected.confidence')?.rejected ?? ''), 'detected.confidence not editable');
  check(/confidence 0.20 below/.test(rejected(r, 'island.seating')?.rejected ?? ''), 'low confidence rejected');
  check(/already matches/.test(reasons['island.lengthFt#null#7'] ?? ''), 'no-op edit reported as already matching');
  check(/expected a number/.test(reasons['island.lengthFt#null#undefined'] ?? ''), 'NaN rejected');
  check(/not editable/.test(rejected(r, 'vanity.widthIn')?.rejected ?? ''), 'bathroom field rejected on a kitchen');
  check(r.corrections.every((c) => c.applied || typeof c.rejected === 'string'), 'every rejected edit carries a reason');
  check(!r.changed && r.spec === k, 'spec untouched when nothing applies');
}

// ---------------------------------------------------------------------------
console.log('\n4. Array operations');
{
  const k = defaultKitchen();
  const shelf = { wall: 'left', t: 0.6, widthIn: 30, count: 3, bottomFt: 4.5, depthIn: 10, spacingIn: 12, material: 'wood', styled: 'dishes' };
  const plant = { kind: 'floor', wall: 'corner', t: 0, sizeFt: 4, form: 'leafy' };
  const art = { wall: 'left', t: 0.2, widthIn: 20, heightIn: 24, centerFt: 5, frame: 'wood' };
  const opening = { id: 'x', kind: 'window', wall: 'left', t: 0.5, widthFt: 3, heightFt: 4, sillFt: 3, style: 'casement' };
  const appliance = { kind: 'wine-fridge', wall: 'left', t: 0.8, widthIn: 24, finish: 'stainless', hoodStyle: null, hoodShape: null, fridgeStyle: null, bodyFinish: null, heightIn: null, aboveCounterIn: null };
  const r = run(k, out([
    { op: 'add', field: 'decor.shelves', index: null, value_element: shelf, reason: 'shelves over the window', confidence: 0.9 },
    { op: 'add', field: 'decor.plants', index: null, value_element: plant, reason: '', confidence: 0.9 },
    { op: 'add', field: 'decor.art', index: null, value_element: art, reason: '', confidence: 0.9 },
    { op: 'add', field: 'openings', index: null, value_element: opening, reason: '', confidence: 0.9 },
    { op: 'add', field: 'appliances', index: null, value_element: appliance, reason: '', confidence: 0.9 },
    { op: 'remove', field: 'decor.plants', index: 1, reason: 'no herb pot in the photo', confidence: 0.9 },
    { op: 'remove', field: 'decor.art', index: 0, reason: '', confidence: 0.9 },
  ]));
  const s = r.spec as KitchenSpec;
  check(applied(r).length === 7, `7 of 7 array ops applied (${applied(r).length})`);
  check(s.decor.shelves.length === 2 && s.decor.shelves[1].count === 3 && s.decor.shelves[1].wall === 'left', 'shelf appended');
  check(s.decor.plants.length === 2 && s.decor.plants[1].form === 'leafy' && s.decor.plants[0].form === 'tree', 'plant appended, herb removed');
  check(s.decor.art.length === 1 && s.decor.art[0].frame === 'wood', 'art removed then appended');
  check(s.openings.length === 3 && s.openings[2].id === 'window-3' && s.openings[2].kind === 'window', `opening appended with a generated id (${s.openings[2].id})`);
  check(s.appliances.length === 5 && s.appliances[4].kind === 'wine-fridge' && s.appliances[4].hoodShape === null && s.appliances[4].bodyFinish === null, 'appliance appended (hoodShape / bodyFinish null)');
  // an element that leaves a nullable key off (a non-strict retry, an older client) is "none", not invalid
  const bare = { kind: 'wine-fridge', wall: 'left', t: 0.8, widthIn: 24, finish: 'stainless', hoodStyle: null, fridgeStyle: null };
  const rBare = run(k, out([{ op: 'add', field: 'appliances', index: null, value_element: bare, reason: '', confidence: 0.9 }]));
  const sBare = rBare.spec as KitchenSpec;
  check(applied(rBare).length === 1 && sBare.appliances.length === 5 && sBare.appliances[4].hoodShape === null && sBare.appliances[4].bodyFinish === null, 'an appliance missing hoodShape / bodyFinish is appended with them defaulted to null');
  check(RoomSpecZ.safeParse(rBare.spec).success, 'and the spec stays valid');
  check(k.decor.plants.length === 2 && k.openings.length === 2, 'input spec was not mutated');
  check(RoomSpecZ.safeParse(r.spec).success, 'spec still valid');
  const summary = summarizeCorrections(r.corrections);
  check(summary[0].startsWith('added shelf: 3 wood boards on left wall'), `summary names the addition ("${summary[0]}")`);
  check(summary.some((l) => l === 'removed plant 2'), 'summary names the removal');

  // invalid elements, caps, bad indices
  const r2 = run(k, out([
    { op: 'add', field: 'decor.shelves', index: null, value_element: { ...shelf, count: 9 }, reason: '', confidence: 0.9 },          // count > 5
    { op: 'add', field: 'decor.plants', index: null, value_element: { ...plant, form: 'cactus' }, reason: '', confidence: 0.9 },       // bad enum
    { op: 'add', field: 'openings', index: null, value_element: { kind: 'window' }, reason: '', confidence: 0.9 },                     // incomplete
    { op: 'add', field: 'runs', index: null, value_element: {}, reason: '', confidence: 0.9 },                                        // an empty run is not a CabinetRun
    { op: 'add', field: 'decor.art', index: null, value_element: art, reason: '', confidence: 0.3 },                                  // low confidence
    { op: 'remove', field: 'decor.shelves', index: 5, reason: '', confidence: 0.9 },                                                  // no such element
    { op: 'remove', field: 'runs', index: 7, reason: '', confidence: 0.9 },                                                           // no such run
    { op: 'remove', field: 'decor.plants', index: null, reason: '', confidence: 0.9 },                                                // missing index
  ]));
  check(applied(r2).length === 0, `none of ${r2.corrections.length} bad array ops applied`);
  check(/not a valid decor.shelves entry/.test(rejected(r2, 'decor.shelves')?.rejected ?? ''), 'shelf with count 9 rejected by OpenShelfZ');
  check(/not a valid decor.plants entry/.test(rejected(r2, 'decor.plants')?.rejected ?? ''), 'plant with unknown form rejected by PlantZ');
  check(/not a valid openings entry/.test(rejected(r2, 'openings')?.rejected ?? ''), 'incomplete opening rejected by OpeningZ');
  check(/not a valid runs entry/.test(rejected(r2, 'runs')?.rejected ?? ''), 'an empty run is rejected by CabinetRunZ');
  check(/no runs element at index 7/.test(r2.corrections.find((c) => c.op === 'remove' && c.field === 'runs')?.rejected ?? ''), 'removing a run that does not exist is rejected (the real run ops are covered by check-walls.ts)');
  check(/confidence 0.30 below/.test(rejected(r2, 'decor.art')?.rejected ?? ''), 'low-confidence add rejected');
  check(/no decor.shelves element at index 5/.test(r2.corrections.find((c) => c.op === 'remove' && c.field === 'decor.shelves')?.rejected ?? ''), 'remove of a missing index rejected');
  check(/at index null/.test(r2.corrections.find((c) => c.op === 'remove' && c.field === 'decor.plants')?.rejected ?? ''), 'remove without index rejected');

  // cap: plants max 8 — six adds onto two existing leaves eight, the seventh is refused
  const adds = Array.from({ length: 7 }, () => ({ op: 'add', field: 'decor.plants', index: null, value_element: plant, reason: '', confidence: 0.9 }));
  const r3 = run(k, out(adds));
  check(applied(r3).length === 6 && (r3.spec as KitchenSpec).decor.plants.length === 8, `plants capped at 8 (${(r3.spec as KitchenSpec).decor.plants.length})`);
  check(/full \(max 8\)/.test(r3.corrections[6].rejected ?? ''), 'seventh add rejected as full');
}

// ---------------------------------------------------------------------------
console.log('\n5. Camera edits');
{
  const k = defaultKitchen();
  const r = run(k, out([
    set('detected.camera.fovDeg', 72),
    set('detected.camera.heightFt', 4.6),
    set('detected.camera.position', 'corner-left'),
    set('detected.camera.lookingAt', 'right'),
    set('detected.camera.fovDeg', 150),               // out of range → rejected
    set('detected.camera.position', 'behind'),        // bad enum → rejected
  ]));
  const cam = r.spec.detected.camera;
  check(applied(r).length === 4, `4 camera edits applied (${applied(r).length})`);
  check(cam.fovDeg === 72 && cam.heightFt === 4.6 && cam.position === 'corner-left' && cam.lookingAt === 'right', `camera now ${cam.fovDeg}° at ${cam.heightFt} ft from ${cam.position} facing ${cam.lookingAt}`);
  check(k.detected.camera.fovDeg === 62, 'input camera untouched');
  check(r.corrections.filter((c) => c.field.startsWith('detected.camera') && !c.applied).length === 2, 'out-of-range fov and unknown position rejected');

  // the camera cannot face the wall at its back
  const back = run(k, out([set('detected.camera.lookingAt', 'front')]));   // the default kitchen's camera stands 'front'
  check(applied(back).length === 0 && /has the front wall at its back/.test(rejected(back, 'detected.camera.lookingAt')?.rejected ?? ''), `standing front, "looking at front" is rejected: ${rejected(back, 'detected.camera.lookingAt')?.rejected}`);
  const side = run(k, out([set('detected.camera.position', 'side-left'), set('detected.camera.lookingAt', 'left'), set('detected.camera.lookingAt', 'right')]));
  check(side.corrections[0].applied && !side.corrections[1].applied && side.corrections[2].applied && side.spec.detected.camera.lookingAt === 'right', 'side-left: facing left refused, facing right applied');
  const corner = run(k, out([set('detected.camera.position', 'corner-right'), set('detected.camera.lookingAt', 'front')]));
  check(!corner.corrections[1].applied, 'a corner standpoint has the front wall at its back too');
}

// ---------------------------------------------------------------------------
console.log('\n6. Nullable parents are seeded');
{
  const k = defaultKitchen();
  k.decor.rug = null;
  k.lighting.pendants = null;
  const r = run(k, out([set('decor.rug.present', true), set('decor.rug.style', 'round'), set('lighting.pendants.count', 3)]));
  const s = r.spec as KitchenSpec;
  check(applied(r).length === 3, `3 edits under null parents applied (${applied(r).length})`);
  check(s.decor.rug?.present === true && s.decor.rug.style === 'round', 'rug seeded then edited');
  check(s.lighting.pendants?.count === 3, 'pendants seeded then edited');
  check(RoomSpecZ.safeParse(r.spec).success, 'seeded spec is valid');
}

// ---------------------------------------------------------------------------
console.log('\n7. Finishes reach applyFinishObservations');
{
  const k = defaultKitchen();
  const good = { slot: 'flooring', family: 'hardwood', baseColorHex: '#b8834a', accentColorHex: '#7a5230', pattern: 'plank', sheen: 'satin', moduleIn: { w: 5, h: 48 }, groutColorHex: null, description: 'honey oak 5-in plank, satin', visibility: 'clear' };
  const counter = { ...good, slot: 'countertop', family: 'quartz', baseColorHex: '#f2f0ea', accentColorHex: '#9a9a9a', pattern: 'veined', sheen: 'polished', moduleIn: null, description: 'white quartz with grey veins' };
  const r = run(k, out([], { finishes: [
    good, counter,
    { ...good, slot: 'roof' },                       // not a kitchen slot
    { ...good, slot: 'walls', baseColorHex: 'beige' }, // not #RRGGBB
    { ...good, slot: 'backsplash', family: 'plastic' }, // bad enum
    { ...good, slot: 'flooring' },                   // duplicate
    'garbage',
  ] }));
  check(r.finishes.length === 2 && r.finishes.map((f) => f.slot).join(',') === 'flooring,countertop', `2 observations accepted (${r.finishes.map((f) => f.slot).join(', ')})`);
  check(r.rejectedFinishes.length === 5, `5 observations rejected (${r.rejectedFinishes.map((x) => `${x.slot}: ${x.reason}`).join('; ')})`);
  const det = r.spec.detected.finishes;
  check(det.some((f) => f.slot === 'flooring' && f.baseColorHex.toLowerCase() === '#b8834a') && det.some((f) => f.slot === 'countertop'), 'detected.finishes carries both observations');
  check(k.detected.finishes.length === 0, 'input spec finishes untouched');
  check(r.changed && applied(r).length === 0, 'finishes alone mark the pass as changed');
  check(RoomSpecZ.safeParse(r.spec).success, 'spec with finishes is valid');
  check(typeof (r.spec.materials as unknown as Record<string, string>).flooring === 'string' && (r.spec.materials as unknown as Record<string, string>).flooring.length > 0, `flooring material set (${(r.spec.materials as unknown as Record<string, string>).flooring})`);
  check(r.spec.detected.notes.some((n) => /matched 2 finishes \(flooring, countertop\)/.test(n)), 'audit line names the matched finishes');

  // an existing observation for the same slot is replaced, not duplicated
  const again = run(r.spec, out([], { finishes: [{ ...good, baseColorHex: '#333333' }] }));
  check(again.spec.detected.finishes.filter((f) => f.slot === 'flooring').length === 1 && again.spec.detected.finishes.find((f) => f.slot === 'flooring')?.baseColorHex === '#333333', 'second observation for a slot replaces the first');
}

// ---------------------------------------------------------------------------
console.log('\n8. Schema guard drops the one bad edit and keeps the rest');
{
  const k = defaultKitchen();
  // Every allowlisted range sits inside its zod range, so the schema guard
  // is the LAST line of defence rather than the first: it fires when an edit
  // is individually fine but the spec around it is not. Simulate that with a
  // spec that is already invalid in one unrelated place — every edit must be
  // refused and the spec handed back untouched.
  const broken = { ...k, sink: { ...k.sink, widthIn: 999 } } as KitchenSpec;
  const r = run(broken, out([set('island.lengthFt', 6), set('cabinets.crown', false)]));
  check(applied(r).length === 0 && r.corrections.every((c) => c.rejected === 'would make the spec invalid'), 'edits on an invalid spec are refused by the schema guard');
  check(r.spec === broken, 'spec returned untouched');

  // and on a valid spec the guard lets everything through while a bad
  // element among good ones is dropped on its own
  const mixed = run(k, out([
    set('island.lengthFt', 6),
    { op: 'add', field: 'decor.art', index: null, value_element: { wall: 'back', t: 2 }, reason: '', confidence: 0.9 },
    set('cabinets.crown', false),
  ]));
  check(applied(mixed).length === 2 && (mixed.spec as KitchenSpec).island.lengthFt === 6 && (mixed.spec as KitchenSpec).cabinets.crown === false, 'good edits around a bad one still apply');
}

// ---------------------------------------------------------------------------
console.log('\n9. Bathroom');
{
  const b = defaultBathroom();
  const r = run(b, out([
    set('vanity.widthIn', 72),
    set('vanity.doorStyle', 'shaker'),
    set('shower.bench', true),
    set('tub.lengthIn', 60),
    set('decor.counterStyling', 'none'),
    set('detected.camera.position', 'corner-left'),
    set('runs[].lengthFt', 10, 0),                    // kitchen-only field
    { op: 'add', field: 'appliances', index: null, value_element: {}, reason: '', confidence: 0.9 }, // kitchen-only array
    { op: 'add', field: 'decor.plants', index: null, value_element: { kind: 'hanging', wall: 'back', t: 0.5, sizeFt: 2, form: 'trailing' }, reason: '', confidence: 0.9 },
  ]));
  const s = r.spec as typeof b;
  check(applied(r).length === 7, `7 bathroom edits applied (${applied(r).length})`);
  check(s.vanity.widthIn === 72 && s.vanity.doorStyle === 'shaker' && s.shower.bench && s.tub.lengthIn === 60 && s.decor.counterStyling === 'none', 'bathroom fields updated');
  check(s.decor.plants.length === 3 && s.decor.plants[2].form === 'trailing', 'hanging plant added');
  check(/not editable/.test(rejected(r, 'runs[].lengthFt')?.rejected ?? '') && /not editable/.test(rejected(r, 'appliances')?.rejected ?? ''), 'kitchen-only fields rejected on a bathroom');
  check(RoomSpecZ.safeParse(r.spec).success, 'bathroom spec valid');
}

// ---------------------------------------------------------------------------
console.log('\n10. Robustness + determinism');
{
  const k = defaultKitchen();
  const junk = [null, undefined, {}, { corrections: 'nope' }, { corrections: [null, 5, 'x', { field: 42 }], notes: 'n', match: 'high', finishes: 7 }] as unknown[];
  for (const j of junk) {
    try {
      const r = applyCorrections(k, j as ModelOutput);
      if (r.spec !== k || r.changed) fail(`junk output ${JSON.stringify(j)} changed the spec`);
    } catch (err) {
      fail(`junk output ${JSON.stringify(j)} threw: ${(err as Error).message}`);
    }
  }
  ok('junk model output never throws and never changes the spec');

  const bigOutput = out([
    set('island.lengthFt', 6.25), set('runs[].lengthFt', 11, 1), set('detected.camera.fovDeg', 70),
    { op: 'add', field: 'openings', index: null, value_element: { id: 'q', kind: 'window', wall: 'left', t: 0.4, widthFt: 3, heightFt: 4, sillFt: 3, style: null }, reason: '', confidence: 0.8 },
    { op: 'remove', field: 'decor.art', index: 0, reason: '', confidence: 0.8 },
  ], { finishes: [{ slot: 'cabinets_base', family: 'paint', baseColorHex: '#3f5a4c', accentColorHex: null, pattern: 'solid', sheen: 'satin', moduleIn: null, groutColorHex: null, description: 'sage green painted shaker', visibility: 'clear' }], notes: ['a'], match: 0.8 });
  const a = applyCorrections(defaultKitchen(), bigOutput);
  const b = applyCorrections(defaultKitchen(), bigOutput);
  check(JSON.stringify(a) === JSON.stringify(b), 'same input → byte-identical output');
  check(applied(a).length === 5 && a.finishes.length === 1, `${applied(a).length} edits + ${a.finishes.length} finish in the determinism fixture`);
  check(a.spec.detected.confidence === defaultKitchen().detected.confidence && a.match === 0.8, `source confidence stays ${a.spec.detected.confidence}; the model's match estimate is reported separately`);
  check(a.notes.length === 1 && a.spec.detected.notes.some((n) => n === 'Photo check: a'), 'free-text notes recorded');
  // edits cap
  const flood = out(Array.from({ length: 200 }, (_, i) => set('island.lengthFt', 3 + (i % 10) * 0.5)));
  const f = applyCorrections(defaultKitchen(), flood);
  check(f.corrections.length <= 60, `edits considered are capped (${f.corrections.length} of 200)`);
}

// ---------------------------------------------------------------------------
console.log('\n10b. The detail layer: decor.items and decor.cabinetContents');
{
  const k = defaultKitchen();
  const item = (p: Record<string, unknown> = {}) => ({ kind: 'pot', label: '10in steel pot', on: 'range', wall: 'back', t: 0.66, depthT: null, shelfIndex: null, burner: 'left-front', sizeIn: 10, colorHex: '#b9bcc0', material: 'stainless', count: 1, ...p });
  // the back wall, clear of the demo's own left/0.4 entry — the reconciler
  // dedupes two readings of one cabinet within 0.05 t on the same wall
  const contents = (p: Record<string, unknown> = {}) => ({ wall: 'back', t: 0.1, kind: 'plates', density: 'full', ...p });
  const add = (field: string, value_element: unknown, confidence = 0.9) => ({ op: 'add', field, index: null, value_element, reason: 'seen in the photo', confidence });

  const r = run(k, out([add('decor.items', item()), add('decor.cabinetContents', contents())]));
  const s = r.spec as KitchenSpec;
  check(applied(r).length === 2 && (s.decor.items ?? []).length === 5 && (s.decor.cabinetContents ?? []).length === 2, `an item and a cabinet-contents entry are appended (${applied(r).length} applied)`);
  check(RoomSpecZ.safeParse(r.spec).success, 'and the spec stays valid');
  check(summarizeCorrections(r.corrections)[0] === 'added item: 10" 10in steel pot on the range', `summary names the item ("${summarizeCorrections(r.corrections)[0]}")`);

  // an added element that leaves the nullable keys off is "none", not invalid
  const bare = { kind: 'kettle', label: 'kettle', on: 'counter', wall: 'back', t: 0.4, sizeIn: 9, colorHex: '#b9bcc0', material: 'stainless', count: 1 };
  const rBare = run(k, out([add('decor.items', bare)]));
  const sBare = (rBare.spec as KitchenSpec).decor.items ?? [];
  check(applied(rBare).length === 1 && sBare[4]?.depthT !== undefined && sBare[4]?.burner === null && sBare[4]?.shelfIndex === null, 'an item missing depthT / shelfIndex / burner is filled by fillNullable');

  // per-field edits
  const tuned = run(k, out([set('decor.items[].t', 0.8, 0), set('decor.items[].sizeIn', 12, 0), set('decor.items[].kind', 'dutch-oven', 0), set('decor.cabinetContents[].density', 'full', 0)]));
  const st = tuned.spec as KitchenSpec;
  check(applied(tuned).length === 4 && st.decor.items?.[0].sizeIn === 12 && st.decor.items?.[0].kind === 'dutch-oven' && st.decor.cabinetContents?.[0].density === 'full', `item and contents fields are tunable (${applied(tuned).length} of 4)`);

  // caps
  const many = out(Array.from({ length: 22 }, (_, i) => add('decor.items', item({ t: 0.02 + i * 0.04, burner: null, on: 'counter' }))));
  const capped = run(k, many);
  check((capped.spec as KitchenSpec).decor.items!.length === 24 && capped.corrections.some((c) => /full \(max 24\)/.test(c.rejected ?? '')), `decor.items caps at 24 (${(capped.spec as KitchenSpec).decor.items!.length})`);
  const manyC = out(Array.from({ length: 12 }, (_, i) => add('decor.cabinetContents', contents({ wall: 'back', t: 0.02 + i * 0.08 }))));
  const cappedC = run(k, manyC);
  check((cappedC.spec as KitchenSpec).decor.cabinetContents!.length === 10 && cappedC.corrections.some((c) => /full \(max 10\)/.test(c.rejected ?? '')), `decor.cabinetContents caps at 10 (${(cappedC.spec as KitchenSpec).decor.cabinetContents!.length})`);

  // room rejects — every host must exist in THIS room
  const noRange = { ...k, appliances: k.appliances.filter((a) => a.kind !== 'range' && a.kind !== 'cooktop') } as KitchenSpec;
  const noIsland = { ...k, island: { ...k.island, present: false } } as KitchenSpec;
  const noShelf = { ...k, decor: { ...k.decor, shelves: [] } } as KitchenSpec;
  const noWindow = { ...k, openings: k.openings.filter((o) => o.kind !== 'window') } as KitchenSpec;
  const cases: Array<[string, KitchenSpec, Record<string, unknown>, string]> = [
    ['no range', noRange, item(), 'no range or cooktop for an item to stand on'],
    ['no island', noIsland, item({ on: 'island', wall: 'island', burner: null }), 'no island for an island item'],
    ['no shelf', noShelf, item({ on: 'shelf', burner: null, shelfIndex: 0 }), 'no open shelf for a shelf item'],
    ['no window', noWindow, item({ on: 'sill', burner: null }), 'no window sill for a sill item'],
    ['no counter', k, item({ on: 'counter', wall: 'front', burner: null }), 'no counter on the front wall for a counter item'],
    ['no uppers', k, contents({ wall: 'front' }), 'no wall cabinets on the front wall'],
  ];
  for (const [what, spec, element, reason] of cases) {
    const field = 'density' in element ? 'decor.cabinetContents' : 'decor.items';
    const res = run(spec, out([add(field, element)]));
    check(applied(res).length === 0 && (rejected(res, field)?.rejected ?? '').includes(reason), `${what}: "${reason}" (${rejected(res, field)?.rejected})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n10c. The cabinet above the hood');
{
  const k = defaultKitchen();
  const hoodIdx = k.appliances.findIndex((a) => a.kind === 'hood');
  const fridgeIdx = k.appliances.findIndex((a) => a.kind === 'fridge');
  const good = run(k, out([set('appliances[].cabinetAbove', 'glass', hoodIdx), set('appliances[].hoodShape', 'box', hoodIdx)]));
  const sg = good.spec as KitchenSpec;
  check(applied(good).length === 2 && sg.appliances[hoodIdx].cabinetAbove === 'glass' && sg.appliances[hoodIdx].hoodShape === 'box', 'a hood takes cabinetAbove and hoodShape');
  // the reconciler nulls the word on anything that is not a hood, so the edit
  // must be reported as undone rather than silently swallowed
  const onFridge = run(k, out([set('appliances[].cabinetAbove', 'doors', fridgeIdx)]));
  check(applied(onFridge).length === 0 && rejected(onFridge, 'appliances[].cabinetAbove')?.rejected === 'undone by reconcile', `cabinetAbove on a fridge is "undone by reconcile" (${rejected(onFridge, 'appliances[].cabinetAbove')?.rejected})`);
  const nums = run(k, out([set('backsplash.heightIn', 42), set('countertop.overhangIn', 2), set('island.endPlacement', 'both'), set('island.endOverhangIn', 12), set('island.stoolOffsetIn', 18)]));
  const sn = nums.spec as KitchenSpec;
  check(applied(nums).length === 5 && sn.backsplash.heightIn === 42 && sn.countertop.overhangIn === 2 && sn.island.endPlacement === 'both' && sn.island.endOverhangIn === 12 && sn.island.stoolOffsetIn === 18, `the five proportion fields land (${applied(nums).length} of 5; ${nums.corrections.filter((c) => !c.applied).map((c) => `${c.field}: ${c.rejected}`).join('; ') || 'none rejected'})`);
  check(sn.backsplash.height === 'full-height', `a 42" splash makes the category full-height (${sn.backsplash.height})`);
}

// ---------------------------------------------------------------------------
console.log('\n10d. Pendant hook positions');
{
  const k = defaultKitchen();
  const hook = (alongFt: number, acrossFt = 0) => ({ op: 'add', field: 'lighting.pendants.positions', index: null, value_element: { alongFt, acrossFt }, reason: 'the right one hangs past the island', confidence: 0.9 });
  const count0 = (k.lighting.pendants?.count ?? 0);
  check(k.lighting.pendants?.positions == null && count0 > 0, `the default kitchen has ${count0} pendants and no explicit hooks`);

  // null is the state you would add a hook FROM, so the add has to seed the list
  const one = run(k, out([hook(-1.5)]));
  const p1 = (one.spec as KitchenSpec).lighting.pendants;
  check(applied(one).length === 1 && (p1?.positions?.length ?? 0) === 1, `an add seeds the list from null (${applied(one).length} applied, ${p1?.positions?.length ?? 'null'} hooks; ${one.corrections.filter((c) => !c.applied).map((c) => c.rejected).join('; ')})`);
  check(p1?.count === 1, `and count follows positions.length so the reconciler does not null it (count ${p1?.count})`);
  check(RoomSpecZ.safeParse(one.spec).success, 'the spec stays valid');

  const two = run(k, out([hook(-1.5), hook(1.5, 0.5)]));
  const p2 = (two.spec as KitchenSpec).lighting.pendants;
  check(applied(two).length === 2 && p2?.positions?.length === 2 && p2.count === 2 && p2.positions[1].acrossFt === 0.5, `two hooks land as a pair (${p2?.positions?.length ?? 'null'} hooks, count ${p2?.count})`);

  // and back out again: removing the last hook leaves the evenly spaced row
  const gone = run(two.spec, out([
    { op: 'remove', field: 'lighting.pendants.positions', index: 1, value_element: null, reason: '', confidence: 0.9 },
    { op: 'remove', field: 'lighting.pendants.positions', index: 0, value_element: null, reason: '', confidence: 0.9 },
  ]));
  const p3 = (gone.spec as KitchenSpec).lighting.pendants;
  check(applied(gone).length === 2 && (p3 === null || p3.positions === null), `removing every hook goes back to the spread/offset row (${p3 === null ? 'no pendants' : String(p3.positions)})`);

  // out of range is the element schema's job, not the reconciler's
  const wild = run(k, out([hook(99)]));
  check(applied(wild).length === 0 && /not a valid lighting\.pendants\.positions entry/.test(rejected(wild, 'lighting.pendants.positions')?.rejected ?? ''), `a hook 99 ft out is refused (${rejected(wild, 'lighting.pendants.positions')?.rejected})`);

  // a kitchen with no pendants at all: the nullable parent is seeded first
  const dark = { ...k, lighting: { ...k.lighting, pendants: null } } as KitchenSpec;
  const lit = run(dark, out([hook(0)]));
  const p4 = (lit.spec as KitchenSpec).lighting.pendants;
  check(applied(lit).length === 1 && p4?.positions?.length === 1 && p4.count === 1, `an add onto null pendants seeds the parent too (${p4 ? `count ${p4.count}, ${p4.positions?.length} hooks` : 'still null'})`);
}

// ---------------------------------------------------------------------------
console.log('\n11. Review fixes');
{
  const k = defaultKitchen();
  const shelf = { wall: 'left', t: 0.6, widthIn: 30, count: 3, bottomFt: 4.5, depthIn: 10, spacingIn: 12, material: 'wood', styled: 'dishes' };
  const finish = { slot: 'flooring', family: 'hardwood', baseColorHex: '#b8834a', accentColorHex: null, pattern: 'plank', sheen: 'satin', moduleIn: null, groutColorHex: null, description: 'oak plank', visibility: 'clear' };

  // (a) passes are enforced
  const fin = applyCorrections(k, out([set('island.lengthFt', 6)], { finishes: [finish] }), { passes: ['finishes'] });
  check(applied(fin).length === 0 && fin.corrections[0].rejected === 'not part of this pass' && fin.finishes.length === 1, 'finishes-only pass: geometry edit refused as "not part of this pass", finish applied');
  const geo = applyCorrections(k, out([set('island.lengthFt', 6)], { finishes: [finish] }), { passes: ['geometry'] });
  check(applied(geo).length === 1 && geo.finishes.length === 0 && geo.rejectedFinishes[0]?.reason === 'not part of this pass', 'geometry-only pass: finish refused as "not part of this pass", edit applied');
  const both = applyCorrections(k, out([set('island.lengthFt', 6)], { finishes: [finish] }), { passes: ['geometry', 'finishes'] });
  check(applied(both).length === 1 && both.finishes.length === 1, 'both passes: everything goes through');

  // (b) edits the reconciler undoes are not reported as applied
  const undone = run(k, out([set('runs[].start', 0.9, 0)]));   // run-back fills its wall: start is clamped straight back to 0
  check(applied(undone).length === 0 && rejected(undone, 'runs[].start')?.rejected === 'undone by reconcile', 'a start the reconciler clamps back is flagged "undone by reconcile"');
  check((undone.spec as KitchenSpec).runs[0].start === 0 && !undone.changed, 'and the pass is not marked as changed');
  const partial = run(k, out([set('island.offset.x', -2)]));    // clamped by the walkway rule, but the island did move that way
  check(applied(partial).length === 1 && (partial.spec as KitchenSpec).island.offset.x < k.island.offset.x, `an edit the reconciler only clamps still counts as applied (offset.x ${k.island.offset.x} → ${(partial.spec as KitchenSpec).island.offset.x})`);
  const wallMove = run(k, out([set('runs[].wall', 'left', 0), set('runs[].wall', 'right', 1)]));
  check(/already sits on the left wall/.test(rejected(wallMove, 'runs[].wall')?.rejected ?? ''), 'a run cannot move onto a wall that already has a run');
  check(wallMove.corrections[1].applied && (wallMove.spec as KitchenSpec).runs[1].wall === 'right', 'a run can move onto a free wall');

  // (c) added openings are interior-only
  const openingsDef = REFINABLE_ARRAYS.find((a) => a.path === 'openings')!;
  const garage = { id: 'g', kind: 'garage-door', wall: 'back', t: 0.5, widthFt: 8, heightFt: 7, sillFt: 0, style: null };
  const g = run(k, out([{ op: 'add', field: 'openings', index: null, value_element: garage, reason: '', confidence: 0.9 }]));
  check(applied(g).length === 0 && /not a valid openings entry/.test(rejected(g, 'openings')?.rejected ?? ''), 'adding a garage door to a kitchen is rejected by the element schema');
  const kinds = ((z.toJSONSchema(openingsDef.schema, { target: 'draft-2020-12', unrepresentable: 'any' }) as unknown as { properties: { kind: { enum: string[] } } }).properties.kind.enum);
  check(kinds.join(',') === 'window,door,passage', `the strict JSON schema offers only ${kinds.join(' | ')}`);

  // (d) room-aware add checks
  const tall = run(k, out([{ op: 'add', field: 'decor.shelves', index: null, value_element: { ...shelf, bottomFt: 8.5, count: 3, spacingIn: 14 }, reason: '', confidence: 0.9 }]));
  check(applied(tall).length === 0 && /above the 9 ft ceiling/.test(rejected(tall, 'decor.shelves')?.rejected ?? ''), 'a shelf whose top board is above the ceiling is rejected: ' + rejected(tall, 'decor.shelves')?.rejected);
  const low = run(k, out([{ op: 'add', field: 'decor.shelves', index: null, value_element: { ...shelf, bottomFt: 5, count: 2, spacingIn: 14 }, reason: '', confidence: 0.9 }]));
  check(applied(low).length === 1, 'a shelf that fits under the ceiling is added');
  const counterPlant = (wall: string) => ({ op: 'add', field: 'decor.plants', index: null, value_element: { kind: 'counter', wall, t: 0.5, sizeFt: 1, form: 'herb' }, reason: '', confidence: 0.9 });
  const plants = run(k, out([counterPlant('front'), counterPlant('back'), counterPlant('island')]));
  check(/no counter on the front/.test(plants.corrections[0].rejected ?? '') && plants.corrections[1].applied && plants.corrections[2].applied, 'a counter plant needs a counter: front wall refused, back wall and island accepted');
  const noShelves = { ...k, decor: { ...k.decor, shelves: [] } } as KitchenSpec;
  const shelfPlant = run(noShelves, out([{ op: 'add', field: 'decor.plants', index: null, value_element: { kind: 'shelf', wall: 'right', t: 0.3, sizeFt: 0.8, form: 'trailing' }, reason: '', confidence: 0.9 }]));
  check(applied(shelfPlant).length === 0 && /no open shelf/.test(rejected(shelfPlant, 'decor.plants')?.rejected ?? ''), 'a shelf plant with no shelf to sit on is rejected');
  const b = defaultBathroom();
  const bathPlant = run(b, out([counterPlant('right'), counterPlant('left')]));
  check(/no counter on the right/.test(bathPlant.corrections[0].rejected ?? '') && bathPlant.corrections[1].applied, 'bathroom: only the vanity wall has a counter');

  // (e) minConfidence is sanitised
  check(sanitizeMinConfidence(NaN) === 0.45 && sanitizeMinConfidence('0.9') === 0.45 && sanitizeMinConfidence(undefined) === 0.45, 'NaN / string / undefined → default 0.45');
  check(sanitizeMinConfidence(7) === 1 && sanitizeMinConfidence(-3) === 0, 'out of range → clamped to 0..1');
  check(sanitizeMinConfidence(0.05, SERVER_MIN_CONFIDENCE) === 0.2 && sanitizeMinConfidence(0.6, SERVER_MIN_CONFIDENCE) === 0.6, `server floor ${SERVER_MIN_CONFIDENCE} applies only below it`);
  const nan = applyCorrections(k, out([set('island.lengthFt', 6, null, 0.3)]), { minConfidence: Number.NaN });
  check(/confidence 0.30 below 0.45/.test(nan.corrections[0].rejected ?? ''), 'minConfidence NaN falls back to the default');
  const huge = applyCorrections(k, out([set('island.lengthFt', 6, null, 0.9)]), { minConfidence: 99 });
  check(/below 1/.test(huge.corrections[0].rejected ?? ''), 'minConfidence 99 clamps to 1');
  const neg = applyCorrections(k, out([set('island.lengthFt', 6, null, 0.01)]), { minConfidence: -5 });
  check(applied(neg).length === 1, 'minConfidence -5 clamps to 0 (applyCorrections is pure; the server floor is applied by refineSpec)');

  // (f) unusable model output is a retryable provider error, not a crash
  const throwsRefine = (text: string, status?: string) => {
    try { parseRefineOutput(text, status); return false; } catch (err) { return err instanceof ProviderError && err.code === 'refine_failed' && err.retryable; }
  };
  check(throwsRefine(''), 'empty output → ProviderError refine_failed (retryable)');
  check(throwsRefine('the kitchen looks fine'), 'prose instead of JSON → ProviderError refine_failed');
  check(throwsRefine('[1, 2]'), 'a JSON array → ProviderError refine_failed');
  check(throwsRefine('{"corrections": []}'), 'an object missing `finishes` → ProviderError refine_failed');
  check(throwsRefine('{"corrections": [], "notes": [], "match": 0.5, "finishes": []}', 'incomplete'), 'a truncated (status incomplete) response → ProviderError refine_failed');
  const good = parseRefineOutput('```json\n{"corrections": [], "notes": ["x"], "match": 0.5, "finishes": []}\n```', 'completed');
  check(Array.isArray(good.corrections) && Array.isArray(good.notes), 'a complete (even fenced) answer parses');

  // (g) detected.notes keeps the NEWEST lines
  const noisy = { ...k, detected: { ...k.detected, notes: Array.from({ length: 24 }, (_, i) => `old note ${i}`) } } as KitchenSpec;
  const trimmed = run(noisy, out([set('island.lengthFt', 6)], { notes: ['fresh observation'] }));
  const notes = trimmed.spec.detected.notes;
  check(notes.length === 24 && notes[notes.length - 1] === 'Photo check: fresh observation' && notes.some((n) => n.startsWith('Checked against your photo')) && !notes.includes('old note 0'), 'with 24 notes already, the new lines survive and the oldest are dropped');
}

// ---------------------------------------------------------------------------
console.log('\n8. Measured gaps → words (the residual-to-prompt rendering)');
{
  // numbers → phrases: sign and threshold
  const gap = { kind: 'range', wall: 'back', index: 0, iou: 0.4, dx: -0.09, dy: 0, dw: 0, dh: 0.18 };
  const phrases = residualPhrases(gap);
  check(phrases.join(' | ') === '9% of the frame further LEFT | 18% taller', `phrases: ${phrases.join(' | ')}`);
  check(residualSentence(gap) === 'In the photo the range on the back wall is 9% of the frame further LEFT and 18% taller than in the twin.', `sentence: ${residualSentence(gap)}`);
  const signs = residualPhrases({ dx: 0.12, dy: 0.05, dw: -0.2, dh: -0.1 });
  check(signs.join(' | ') === '12% of the frame further RIGHT | 5% of the frame LOWER | 20% narrower | 10% shorter', `signs: ${signs.join(' | ')}`);
  check(residualPhrases({ dx: 0.01, dy: -0.015, dw: 0.04, dh: -0.03 }).length === 0, 'shifts under 2% of the frame and sizes under 5% are inside the boxes\' precision → no phrase');
  check(residualSentence({ ...gap, dx: 0, dh: 0 }).startsWith('The range on the back wall lands on the photo (overlap 40%)'), 'no phrase → "lands on the photo; the box shapes differ"');
  // names
  check(residualName({ kind: 'window', wall: 'left', index: 1 }) === 'the second window on the left wall', 'second window on the left wall');
  check(residualName({ kind: 'island', wall: 'island', index: 0 }) === 'the island', 'the island (no "at the island")');
  check(residualName({ kind: 'upper-cabinet-run', wall: 'back', index: 0 }) === 'the upper cabinets on the back wall', 'upper cabinets on the back wall');
  check(residualName({ kind: 'stool', wall: 'island', index: 2 }) === 'the third stool at the island', 'third stool at the island');
  check(residualName({ kind: 'pendant', wall: null, index: 0 }) === 'the pendant', 'a free-hanging pendant has no wall');
  check(hintSentence({ kind: 'window', wall: 'left', reason: 'twin has fewer of this kind' }) === 'a window on the left wall — twin has fewer of this kind', 'hint sentence');
  check(hintSentence({ kind: 'art', wall: 'back', reason: 'no twin counterpart', label: 'large abstract canvas' }) === 'an art on the back wall (large abstract canvas) — no twin counterpart', 'hint sentence with the inventory label');
  // boxes → residual
  const r = residualFromBoxes({ kind: 'fridge', wall: 'right', index: 0, iou: 0.5, twin: [0.2, 0.3, 0.4, 0.6], photo: [0.1, 0.3, 0.3, 0.66] });
  check(Math.abs(r.dx + 0.1) < 1e-9 && Math.abs(r.dy - 0.03) < 1e-9 && Math.abs(r.dw) < 1e-9 && Math.abs(r.dh - 0.2) < 1e-9, `residualFromBoxes: dx ${r.dx.toFixed(3)} dy ${r.dy.toFixed(3)} dw ${r.dw.toFixed(3)} dh ${r.dh.toFixed(3)}`);
  const derived = residualsOf({ matched: [{ kind: 'fridge', wall: 'right', iou: 0.5, photoId: 'p1', twinIndex: 0, twin: [0.2, 0.3, 0.4, 0.6], photo: [0.1, 0.3, 0.3, 0.66] }] }, [{ id: 'p1', label: 'french-door fridge' }]);
  check(derived.length === 1 && derived[0].label === 'french-door fridge', 'residualsOf derives from matched boxes and carries the inventory label');
  const own = residualsOf({ residuals: [gap], matched: [] });
  check(own.length === 1 && own[0] === gap, 'residualsOf prefers the fitter\'s own residuals when it reports them');
  check(residualsOf({ matched: [{ kind: 'fridge', wall: 'right', iou: 0.5, photoId: 'p1', twinIndex: 0 }] }).length === 0, 'matched pairs without boxes (an older server) → no residuals, no throw');
  check(coverageOf(6, 2) === 0.75 && coverageOf(0, 0) === null, 'coverage = matched ÷ scored; null with nothing to score');

  // the prompt block: worst first, fields named, the good ones listed as "leave alone", hints listed
  const k = defaultKitchen();
  const hoodIdx = k.appliances.findIndex((a) => a.kind === 'hood');
  const rangeIdx = k.appliances.findIndex((a) => a.kind === 'range');
  const residuals = [
    { kind: 'island', wall: 'island', index: 0, iou: 0.82, dx: 0.01, dy: 0, dw: 0.02, dh: 0 },
    { kind: 'range', wall: k.appliances[rangeIdx]?.wall ?? 'back', index: 0, iou: 0.41, dx: -0.09, dy: 0, dw: 0, dh: 0, label: '30in slide-in range' },
    { kind: 'upper-cabinet-run', wall: 'back', index: 0, iou: 0.55, dx: 0, dy: -0.03, dw: 0, dh: 0.18 },
    { kind: 'hood', wall: k.appliances[hoodIdx]?.wall ?? 'back', index: 0, iou: 0.2, dx: 0, dy: -0.06, dw: 0, dh: 0.3 },
  ];
  const hints = ['a window on the left wall — twin has fewer of this kind'];
  const facts = residualFacts(k, residuals, hints);
  const text = facts.join('\n');
  check(facts[0].includes('the hood') && facts[1].includes('the range') && facts[2].includes('the upper cabinets'), 'gaps are listed worst overlap first');
  check(facts[1].includes(`Fields: appliances[${rangeIdx}].t, appliances[${rangeIdx}].widthIn`), `the range names its appliance's fields (appliances[${rangeIdx}].t …)`);
  check(facts[0].includes(`appliances[${hoodIdx}].aboveCounterIn`), 'the hood names aboveCounterIn / heightIn');
  check(facts[2].includes('runs[0].upperHeightIn'), 'the upper cabinets name runs[0].upperHeightIn');
  check(facts[1].includes('Photo shows: 30in slide-in range'), 'the inventory label rides along');
  check(text.includes('Already landing on the photo — leave these alone: island (82%)'), 'an element at ≥ 75% overlap is listed as "leave alone", not as a gap');
  check(text.includes('In the photo but not in the twin') && text.includes(hints[0]), 'hints are listed under "in the photo but not in the twin"');
  check(!text.includes('island (82%). Overlap'), 'the landing island does not also appear as a gap');

  const measured = { residuals, hints, score: 0.52 };
  const prompt = buildRefinePrompt(k, ['geometry'], measured);
  check(prompt.includes('PASS 2 — Close the measured gaps') && prompt.includes('Measured gaps (mean overlap 52%') && prompt.includes('Every measured gap gets an edit'), 'geometry prompt with measured gaps: box-aware PASS 2, the gaps block, the every-gap rule');
  check(prompt.includes('PASS 1 — Audit') && prompt.includes('PASS 3 — Proportions') && prompt.includes('PASS 4 — Décor'), 'the audit, proportions and décor passes are kept');
  const plain = buildRefinePrompt(k, ['geometry'], null);
  check(plain.includes('PASS 2 — Diff the images') && !plain.includes('Measured gaps'), 'without measurements the prompt falls back to diffing the images');
  const fin = buildRefinePrompt(k, ['finishes'], measured);
  check(!fin.includes('Measured gaps') && fin.includes('Finishes'), 'a finishes-only pass carries no gaps block');

  // the new contract fields are editable
  const edits = run(k, out([set('runs[].upperHeightIn', 42, 0), set('appliances[].aboveCounterIn', 30, hoodIdx), set('appliances[].heightIn', 70, k.appliances.findIndex((a) => a.kind === 'fridge')), set('lighting.pendants.spreadFt', 3), set('lighting.pendants.offsetFt', -1), set('lighting.pendants.aboveCounterIn', 32), set('island.stoolPitchIn', 24), set('island.endSeats', 2)]));
  const sp = edits.spec as KitchenSpec;
  check(applied(edits).length === 8, `all 8 new-contract edits apply (${applied(edits).length}; ${edits.corrections.filter((c) => !c.applied).map((c) => `${c.field}: ${c.rejected}`).join('; ') || 'none rejected'})`);
  check(sp.runs[0].upperHeightIn === 42 && sp.lighting.pendants?.spreadFt === 3 && sp.island.endSeats === 2, 'run upper height, pendant spread and end seats land on the spec');
  const pend = defaultKitchen();
  pend.lighting.pendants = null;
  // (a spread with no pendants is nothing to draw, so count comes first — the reconciler nulls a zero-count pendants object)
  const seeded = run(pend, out([set('lighting.pendants.count', 3), set('lighting.pendants.spreadFt', 4)]));
  check(applied(seeded).length === 2 && (seeded.spec as KitchenSpec).lighting.pendants?.spreadFt === 4, 'the pendant seed carries the new fields, so count + spread under a null pendants both land');
  check((seeded.spec as KitchenSpec).lighting.pendants?.positions === null, 'the pendant seed leaves positions null (the evenly spaced row)');

  // real client photo: the fitter's matches render as gaps a model can act on
  try {
    const marble = JSON.parse(readFileSync(new URL('./fixtures/client-marble.spec.json', import.meta.url), 'utf8')) as KitchenSpec;
    const fit = fitToPhoto(marble, { aspect: 1.784 });
    const rs = residualsOfFit(fit, fit.spec);
    check(rs.length === fit.matched.length, `client-marble: ${rs.length} residuals for ${fit.matched.length} matched pairs (score ${fit.score?.toFixed(3)})`);
    const lines = residualFacts(fit.spec, rs, hintsOf(fit, fit.spec));
    const gapLines = lines.filter((l) => l.startsWith('  - In the photo') || l.startsWith('  - The '));
    check(gapLines.length > 0 && gapLines.every((l) => /\d+%/.test(l)), `client-marble: ${gapLines.length} gap lines, every one carries a percentage`);
    for (const l of lines.slice(0, 5)) console.log(`     ${l.trim().slice(0, 150)}`);
  } catch (err) {
    fail(`client-marble fixture: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n9. The match loop\'s stop rules (fake fitter)');

/** A driver that answers each round with the next score in the sequence, and records what the loop did with it. */
function fakeDriver(scores: Array<number | null>, opts: { dieAfterRound?: number; dieDuringRound?: number; changed?: boolean; match?: number } = {}) {
  const log: string[] = [];
  let alive = true;
  const driver: MatchLoopDriver = {
    alive: () => alive,
    round: async (round) => {
      log.push(`round ${round}`);
      if (opts.dieDuringRound === round) { alive = false; return { score: scores[round - 1] ?? null }; }
      return { score: scores[round - 1] ?? null, changed: opts.changed ?? true, match: opts.match ?? 0.6 };
    },
    adopt: (round) => { log.push(`adopt ${round}`); if (opts.dieAfterRound === round) alive = false; return true; },
    reject: (round, o, best) => { log.push(`reject ${round} (${o.score} < ${best})`); },
  };
  return { driver, log };
}

// ---------------------------------------------------------------------------
console.log('\n12. Strict JSON schema shape — every schema the model is handed');
{
  // The failure this guards has bitten twice: a zod tuple emits `prefixItems`,
  // OpenAI strict mode rejects the schema, the call silently retries non-strict
  // and the client's kitchen comes back as the template. `stripForStrict`
  // rewrites the one live tuple (DetectionMeta.frame.backWallSpansX); nothing
  // asserted that it had, or that a new tuple could not sneak past it.
  const banned = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', 'default', '$schema', 'prefixItems'];
  const walkSchema = (schema: unknown, name: string): string[] => {
    const problems: string[] = [];
    const walk = (node: unknown, path: string, inProps = false) => {
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (inProps) {
        // keys here are property NAMES — a property called "pattern" must survive
        for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
        return;
      }
      for (const k of banned) if (k in o) problems.push(`${path}: keyword ${k} left in`);
      // strict mode "only knows homogeneous arrays": `items: false` is the other
      // half of a tuple and is rejected the same way prefixItems is
      if (o.type === 'array' && (o.items === false || o.items === undefined)) problems.push(`${path}: array without an items schema`);
      if (o.type === 'object' && o.properties) {
        if (o.additionalProperties !== false) problems.push(`${path}: additionalProperties not false`);
        const props = Object.keys(o.properties as Record<string, unknown>);
        const req = Array.isArray(o.required) ? (o.required as string[]) : [];
        if (props.length !== req.length || props.some((k) => !req.includes(k))) problems.push(`${path}: required ≠ properties`);
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, k === 'properties');
    };
    walk(schema, name);
    return problems;
  };
  const schemas: Array<[string, unknown]> = [
    ['kitchen', jsonSchemaFor('kitchen')],
    ['bathroom', jsonSchemaFor('bathroom')],
    ['exterior', jsonSchemaFor('exterior')],
    ['edits(kitchen)', editSchema('kitchen')],
    ['edits(bathroom)', editSchema('bathroom')],
    ['edits(exterior)', editSchema('exterior')],
    ['inventory', inventoryJsonSchema()],
  ];
  for (const [name, schema] of schemas) {
    const problems = walkSchema(schema, name);
    check(problems.length === 0, `${name}: strict rules hold everywhere${problems.length ? ` — ${problems.slice(0, 3).join('; ')}` : ''}`);
  }
  // and the one tuple in the spec really is rewritten rather than absent
  // `frame` is nullable, so it is an anyOf[object, null] — the tuple lives in the object half
  const detected = (jsonSchemaFor('kitchen') as { properties: Record<string, { properties: Record<string, { anyOf?: Array<{ properties?: Record<string, Record<string, unknown>> }> }> }> }).properties.detected;
  const frameObj = (detected.properties.frame.anyOf ?? []).find((o) => o.properties) ?? {};
  const spans = (frameObj.properties?.backWallSpansX ?? {}) as Record<string, unknown>;
  check(spans.type === 'array' && typeof spans.items === 'object' && !('prefixItems' in spans), `detected.frame.backWallSpansX is a homogeneous array, not a tuple (${JSON.stringify(spans).slice(0, 80)})`);
}

void (async () => {
  {
    const { driver, log } = fakeDriver([0.7, 0.71, 0.71, 0.95]);
    const r = await runMatchLoop(0.5, driver);
    check(r.rounds === 3 && r.stoppedBy === 'stalled' && r.adopted === 3 && r.rejected === 0 && r.score === 0.71, `0.5 → 0.7, 0.71, 0.71: stops after round 3 (${r.rounds} rounds, ${r.stoppedBy}, best ${r.score})`);
    check(!log.includes('round 4'), 'round 4 never runs');
    check(log.join(',') === 'round 1,adopt 1,round 2,adopt 2,round 3,adopt 3', `every round adopted in order (${log.join(',')})`);
  }
  {
    const { driver, log } = fakeDriver([0.65, 0.95]);
    const r = await runMatchLoop(0.7, driver);
    check(r.rejected === 1 && log.includes('reject 1 (0.65 < 0.7)') && !log.includes('adopt 1'), 'a drop of 0.05 is rejected: the round is not adopted');
    check(r.stoppedBy === 'target' && r.adopted === 1 && r.score === 0.95 && log.includes('adopt 2'), 'the next round can still be adopted, and ≥ 0.9 stops the loop');
  }
  {
    const { driver, log } = fakeDriver([0.69, 0.685]);
    const r = await runMatchLoop(0.7, driver);
    // the loop judges every round against the ADOPTED score, so even a small
    // drop is refused — the store never holds a twin worse than the one shown
    check(!log.includes('adopt 1') && !log.includes('adopt 2') && r.score === 0.7 && r.stoppedBy === 'stalled', `a drop within 0.02 is refused (nothing adopted, counts as a stall); the adopted score stays (${log.join(',')} → ${r.score}, ${r.stoppedBy})`);
  }
  {
    const { driver, log } = fakeDriver([0.55, 0.6, 0.65, 0.7]);
    const r = await runMatchLoop(0.5, driver);
    check(r.rounds === 4 && r.stoppedBy === 'rounds' && r.adopted === 4 && log.filter((l) => l.startsWith('round')).length === 4, 'steady +0.05 gains run all 4 rounds');
  }
  {
    const { driver, log } = fakeDriver([0.99]);
    const r = await runMatchLoop(0.92, driver);
    check(r.rounds === 0 && r.stoppedBy === 'target' && log.length === 0, 'already at ≥ 0.9: no round runs');
  }
  {
    // the user edits after round 1 landed: nothing more runs, nothing more is adopted
    const { driver, log } = fakeDriver([0.7, 0.8, 0.9], { dieAfterRound: 1 });
    const r = await runMatchLoop(0.5, driver);
    check(r.stoppedBy === 'aborted' && r.rounds === 1 && r.adopted === 1 && !log.includes('round 2'), `a user edit after round 1 aborts the loop (${log.join(',')})`);
  }
  {
    // the user edits while round 2 is in flight: its result is never adopted
    const { driver, log } = fakeDriver([0.7, 0.8, 0.9], { dieDuringRound: 2 });
    const r = await runMatchLoop(0.5, driver);
    check(r.stoppedBy === 'aborted' && r.rounds === 1 && !log.includes('adopt 2') && r.score === 0.7, `an edit during round 2 discards its result (${log.join(',')})`);
  }
  {
    const { driver, log } = fakeDriver([0.7], { dieDuringRound: 1 });
    const r = await runMatchLoop(null, driver);
    check(r.stoppedBy === 'aborted' && r.adopted === 0 && !log.includes('adopt 1'), 'an edit during round 1 adopts nothing');
  }
  {
    // no inventory to measure: the model's own estimate, at most two rounds
    const two = fakeDriver([null, null, null], { changed: true, match: 0.6 });
    const r2 = await runMatchLoop(null, two.driver);
    check(r2.rounds === 2 && r2.stoppedBy === 'unmeasured' && r2.adopted === 2 && r2.score === null, 'unmeasurable + still changing: two rounds, both kept');
    const one = fakeDriver([null, null], { changed: false });
    const r1 = await runMatchLoop(null, one.driver);
    check(r1.rounds === 1 && r1.stoppedBy === 'unmeasured', 'unmeasurable + nothing changed: one round');
    const happy = fakeDriver([null, null], { changed: true, match: 0.9 });
    const rh = await runMatchLoop(null, happy.driver);
    check(rh.rounds === 1 && rh.stoppedBy === 'unmeasured', 'unmeasurable + the model is satisfied: one round');
  }
  {
    // a measurable start that suddenly cannot be measured (a route without a fitter) stalls out rather than looping
    const { driver } = fakeDriver([null, null, null]);
    const r = await runMatchLoop(0.5, driver);
    check(r.stoppedBy === 'stalled' && r.rounds === 2 && r.score === 0.5, 'measured start, unmeasurable rounds: stalls after two');
  }
  {
    const { driver } = fakeDriver([0.6, 0.62, 0.64, 0.66, 0.68, 0.7]);
    const r = await runMatchLoop(0.5, driver, { maxRounds: 6, minGain: 0.01 });
    check(r.rounds === 6 && r.stoppedBy === 'rounds', 'options: maxRounds 6 and minGain 0.01 run six rounds of +0.02');
  }

  // -------------------------------------------------------------------------
  // THE ISLAND LEVER. The client: "u see how long the island is in the
  // picture, but in the 3d render, its js a square small island." The twin
  // draws client-tan's island top 5.22 ft DEEP by 5.00 ft long — deeper than
  // it is long, a square slab — because `island.widthFt` 4.1 has a 12"
  // seating overhang and a 1.5" scribe added to it. The accuracy pass had a
  // lever for that and it could never pull: it was shown the ratio of the
  // BODY (4.1 ÷ 5.0 = 0.82) and asked to compare it with what it measured on
  // the photo, which can only be the SLAB (the analyzer's own note reads
  // 0.57). Two different measurements, so they never agreed and no correction
  // fired. Both sides now read `islandTopFt`.
  console.log('\n13. The island the client complained about: the pass is shown the slab it can see');
  {
    const tan = JSON.parse(readFileSync(new URL('./fixtures/client-tan.spec.json', import.meta.url), 'utf8')) as KitchenSpec;
    const topOf = (s: KitchenSpec) => islandTopFt(s.island)!;
    const drawnOf = (s: KitchenSpec) => { const i = computeKitchenLayout(s).island!; return { len: mToFt(i.topLen), wide: mToFt(i.topWide) }; };
    const before = { top: topOf(tan), drawn: drawnOf(tan) };
    console.log(`    before: declared ${tan.island.lengthFt} × ${tan.island.widthFt} ft + ${tan.island.overhangIn}" overhang → DRAWN top ${before.drawn.len.toFixed(2)} ft long × ${before.drawn.wide.toFixed(2)} ft deep (ratio ${(before.drawn.wide / before.drawn.len).toFixed(2)})`);
    check(before.drawn.wide > before.drawn.len, `the complaint reproduces: the drawn top is DEEPER (${before.drawn.wide.toFixed(2)} ft) than it is long (${before.drawn.len.toFixed(2)} ft)`);

    const prompt = buildRefinePrompt(tan, ['geometry']);
    const slabLine = prompt.split('\n').find((l) => l.includes('island countertop width ÷')) ?? '';
    check(slabLine.includes('1.05'), `the pass is shown the SLAB ratio it can measure, not the body's 0.82 (${slabLine.slice(slabLine.indexOf('=') + 2, slabLine.indexOf('—')).trim()})`);
    check(slabLine.includes('the visible SLAB, overhang included'), 'and the line says in words that the ratio is of the countertop, overhang included');
    // the field it can edit is not the number it measured, so the offset is spelled out
    const pad = before.top.wide - tan.island.widthFt;
    check(slabLine.includes(`island.widthFt = D − ${(Math.round(pad * 100) / 100)}`), `and names the knob WITH its arithmetic (slab = body + ${pad.toFixed(2)} ft of scribe and overhang)`);
    // the ratios the analyzer measured off the photo and nothing ever read back
    check(prompt.includes('ratio: island width ÷ island length = 0.57') && prompt.includes('ratio: island length ÷ back run = 0.52'), 'and the ratios the FIRST pass measured are quoted back beside them');
    check(prompt.includes('nothing in IMAGE 1 measures the island\'s full LENGTH'), 'and the length its box runs off the frame is named as the lower bound it is');

    // BOTH AXES NAMED, in the one prompt whose whole job is to get the model to
    // tell an island's two axes apart. It used to state the same island twice
    // in opposite orders — "island: island, 5×4.1 ft" in the facts block and
    // "a 4.1×5 ft cabinet body" here — two unlabelled A×B, so the reader had
    // no way to know which was which. Both now carry their axes.
    check(slabLine.includes(`over a cabinet body ${tan.island.widthFt} ft deep by ${tan.island.lengthFt} ft long`), `and the body under it names its axes too (${slabLine.slice(slabLine.indexOf('over a cabinet'), slabLine.indexOf('plus a')).trim()})`);
    check(!/\d+×\d/.test(slabLine), 'with no unlabelled A×B left in the line');
    check(prompt.includes(`island: ${tan.island.kind}, ${tan.island.lengthFt} ft long × ${tan.island.widthFt} ft deep`), 'and the facts block above states the same island the same way round');
    // …and the OTHER knob is offered only for what it can actually give.
    // `island.overhangIn` can give back the overhang; the 1.5" side scribe in
    // the same difference is fixed geometry no field controls, so offering the
    // whole difference there invites an edit that cannot deliver it.
    check(slabLine.includes('leave island.overhangIn alone') && slabLine.includes(`${ISLAND_KNEE_IN}" seating overhang is held for knee room`),
      'and with a stool along the side the overhang is declared off-limits, because the reconciler holds it there');
    {
      // an island seated only at its ends: the knee-room floor does not apply,
      // so the overhang IS offered — for exactly the 0.50 ft it holds, not the
      // 0.63 ft of difference (the other 0.13 is the scribe)
      const ends: KitchenSpec = { ...tan, island: { ...tan.island, seating: 1, endSeats: 1, overhangIn: 6 } };
      const line = buildRefinePrompt(ends, ['geometry']).split('\n').find((l) => l.includes('island countertop width ÷')) ?? '';
      check(/cut island\.overhangIn to 0 — that gives back 0\.5 ft of those 0\.6/.test(line), `the overhang is offered for the 0.50 ft it holds, not the 0.62 ft of difference (${line.slice(line.indexOf('or, if')).trim()})`);
      check(line.includes('fixed 1.5" scribe no field controls'), 'and the remainder is named as fixed geometry');
    }
    {
      // and on an island that is ALREADY flush there is nothing left to offer:
      // the old text still said "cut island.overhangIn instead — that is the
      // same 0.13 ft", which invites `island.overhangIn: 0`, a no-op the pass
      // would believe had fixed the depth
      const flush: KitchenSpec = { ...tan, island: { ...tan.island, seating: 0, endSeats: 0, overhangIn: 0 } };
      const line = buildRefinePrompt(flush, ['geometry']).split('\n').find((l) => l.includes('island countertop width ÷')) ?? '';
      check(!line.includes('cut island.overhangIn'), `a flush island is never told to cut an overhang it does not have (${line.slice(line.indexOf('island.widthFt = D')).trim()})`);
      check(line.includes('island.overhangIn is already 0') && line.includes('fixed 1.5" scribe'), 'it is told the rest is fixed geometry instead');
    }

    // the correction a model plausibly returns from a 0.57 slab ratio: the
    // slab is 0.57 × 5.00 = 2.85 ft deep, and the line above says that is
    // island.widthFt = 2.85 − pad.
    const wanted = 0.57 * tan.island.lengthFt;
    const r = run(tan, out([set('island.widthFt', Math.round((wanted - pad) * 100) / 100)]));
    const after = { top: topOf(r.spec as KitchenSpec), drawn: drawnOf(r.spec as KitchenSpec) };
    console.log(`    after:  declared ${(r.spec as KitchenSpec).island.lengthFt} × ${(r.spec as KitchenSpec).island.widthFt} ft + ${(r.spec as KitchenSpec).island.overhangIn}" overhang → DRAWN top ${after.drawn.len.toFixed(2)} ft long × ${after.drawn.wide.toFixed(2)} ft deep (ratio ${(after.drawn.wide / after.drawn.len).toFixed(2)})`);
    check(applied(r).length === 1, `the correction lands (${r.corrections.map((c) => `${c.field} ${c.applied ? 'applied' : c.rejected}`).join('; ')})`);
    check(after.drawn.wide < after.drawn.len, `and the island stops being deeper than it is long (${after.drawn.wide.toFixed(2)} deep × ${after.drawn.len.toFixed(2)} long)`);
    check(Math.abs(after.drawn.wide / after.drawn.len - 0.57) < 0.02, `the DRAWN slab now measures what the photo measures (${(after.drawn.wide / after.drawn.len).toFixed(3)} against 0.57)`);
    check(Math.abs(after.drawn.len - before.drawn.len) < 1e-9, `and the length — the axis the photo cannot measure — was not touched (${after.drawn.len.toFixed(2)} ft)`);
    // …and the pass would now be told the truth about what it just drew
    check((buildRefinePrompt(r.spec, ['geometry']).split('\n').find((l) => l.includes('island countertop width ÷')) ?? '').includes('0.57'), 'and a second round is shown 0.57, so the lever stops pulling once it agrees with the photo');
  }

  console.log(failures ? `\nFAILED (${failures})\n` : '\nALL REFINE CHECKS PASSED\n');
  process.exit(failures ? 1 : 0);
})();
