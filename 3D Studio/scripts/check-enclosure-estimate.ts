import assert from 'node:assert/strict';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { defaultBathroom, defaultKitchen, emptyDecor } from '../src/lib/spec/defaults';
import type { BathroomSpec, EstimateSettings, KitchenSpec, OpenShelf, ProjectBaseline } from '../src/lib/spec/types';
import { CATALOG_BY_ID } from '../src/lib/materials/catalog';
import { PRICE_BOOK } from '../src/lib/estimate/pricebook';

const settings: EstimateSettings = { region: 'national', tier: 'standard', contingencyPct: 0, markupPct: 0, scope: 'pull-and-replace', includePermits: false, mode: 'full', includeKnockOns: true };
type Room = KitchenSpec | BathroomSpec;
const selections = (s: Room) => ({ ...s.materials }) as Record<string, string>;
const baseline = (s: Room): ProjectBaseline => ({ spec: s, selections: selections(s), source: 'analysis', capturedAt: '2026-09-10T00:00:00.000Z' });
const full = (s: Room, sel = selections(s)) => calculateEstimate(s, sel, settings);
const changes = (s: Room, base: Room, sel = selections(s)) => calculateEstimate(s, sel, { ...settings, mode: 'changes' }, baseline(base));
const close = (a: number, b: number, why: string) => assert.ok(Math.abs(a - b) < 1e-7, `${why}: ${a} vs ${b}`);
const floating: OpenShelf = { wall: 'back', t: 0.5, widthIn: 24, depthIn: 12, count: 2, spacingIn: 12, bottomFt: 4, material: 'wood', styled: 'empty' };
const enclosed: OpenShelf = { ...floating, count: 5, bottomFt: 3, finishColorHex: '#6e4525', enclosure: { heightIn: 60, panelThicknessIn: 0.75, backPanel: true, rotationDeg: 0 } };

for (const spec of [defaultKitchen(), defaultBathroom()]) {
  spec.decor = { ...emptyDecor(), shelves: [structuredClone(floating)] };
  const old = full(spec), line = old.lines.find((l) => l.id === 'open-shelves')!;
  // Pin the pre-enclosure formula and complete row, including rounding,
  // notes, scoping and full-remodel amounts. Existing check-estimate also
  // pins whole-room floating-shelf fixture totals against the prior release.
  assert.deepEqual(line, {
    id: 'open-shelves', category: spec.roomType === 'kitchen' ? 'Cabinetry' : 'Vanity', label: 'Open shelving (2 boards)',
    qty: 4, unit: 'lf', slot: undefined, note: 'floating boards, brackets and blocking',
    materialLow: 308, materialHigh: 504, laborLow: 120, laborHigh: 180, totalLow: 428, totalHigh: 684,
    scope: 'changed', baselineQty: null, fullTotalLow: 428, fullTotalHigh: 684,
  }, 'legacy floating row is byte-for-byte unchanged');
  const nullCase = structuredClone(spec); nullCase.decor.shelves[0].enclosure = null; nullCase.decor.shelves[0].finishColorHex = null;
  assert.deepEqual(full(nullCase), old, 'optional null case fields do not affect any legacy estimate data');
  assert.ok(!Object.keys(old.quantities).some((k) => k.startsWith('shelfCase')), 'legacy estimates gain no unrelated case quantities');

  const caseSpec = structuredClone(spec); caseSpec.decor.shelves = [structuredClone(enclosed)];
  const input = JSON.stringify(caseSpec), estimate = full(caseSpec);
  assert.equal(JSON.stringify(caseSpec), input, 'case takeoff is pure');
  assert.ok(!estimate.lines.some((l) => l.id === 'open-shelves'), 'casework is not also charged as floating boards/brackets');
  const q = estimate.quantities;
  // 24×60×12 case, ¾ panels. The five boards and cap span 22½×11¼;
  // sides span 60×12, and the full-height back spans 60×22½ inches.
  const singleBoard = 22.5 * 11.25 / 144;
  close(q.shelfCaseBoardSqft, singleBoard * 5, 'base and four interior boards');
  close(q.shelfCaseCapSqft, singleBoard, 'one separate cap');
  close(q.shelfCaseSideSqft, 2 * 60 * 12 / 144, 'two full sides');
  close(q.shelfCaseBackSqft, 60 * 22.5 / 144, 'optional full-height backing');
  close(q.shelfCasePanelSqft, singleBoard * 6 + 10 + 9.375, 'sum of non-overlapping joined panels');
  close(q.shelfCasePanelCuft, q.shelfCasePanelSqft * 0.75 / 12, 'panel thickness accounts for material volume');
  assert.equal(q.shelfCaseBoards, 5); assert.equal(q.shelfCaseCount, 1);
  const panels = estimate.lines.find((l) => l.id === 'open-shelf-case-0-panels')!;
  const assembly = estimate.lines.find((l) => l.id === 'open-shelf-case-0-install')!;
  assert.equal(panels.materialLow, Math.round(q.shelfCasePanelSqft * PRICE_BOOK['cabinet-wood'].standard.material.low * 0.35), 'allowance uses the existing book, not a new vendor rate');
  assert.equal(assembly.laborLow, Math.round(q.shelfCasePanelSqft * PRICE_BOOK['cabinet-wood'].standard.labor.low * 0.5));
  assert.equal(panels.laborHigh, 0); assert.equal(assembly.materialHigh, 0);
  assert.match(panels.note!, /Allowance.*not a supplier quote/);

  const noBack = structuredClone(caseSpec); noBack.decor.shelves[0].enclosure!.backPanel = false;
  const openBack = full(noBack);
  close(openBack.quantities.shelfCaseBackSqft, 0, 'no backing is bought when unobserved');
  close(openBack.quantities.shelfCaseBoardSqft, 22.5 * 12 / 144 * 5, 'boards extend through the omitted back panel space');
  assert.ok(openBack.lines.find((l) => l.id === panels.id)!.materialHigh < panels.materialHigh, 'removing backing reduces actual panel takeoff');
  const thicker = structuredClone(caseSpec); thicker.decor.shelves[0].enclosure!.panelThicknessIn = 1.5;
  const thick = full(thicker);
  assert.ok(thick.quantities.shelfCasePanelCuft > q.shelfCasePanelCuft, 'thicker panels require more volume despite narrower clear spans');
  assert.ok(thick.lines.find((l) => l.id === panels.id)!.materialHigh > panels.materialHigh);
  assert.ok(changes(thicker, caseSpec).lines.find((l) => l.id === panels.id)!.materialHigh > 0, 'thicker material cannot vanish as a negative area delta');

  const untouched = changes(caseSpec, structuredClone(caseSpec));
  assert.equal(untouched.totalHigh, 0); assert.equal(untouched.changedCount, 0);
  assert.ok(untouched.lines.every((l) => l.scope === 'unchanged'), 'identical enclosed-case baseline starts at zero');
  assert.ok(changes(caseSpec, spec).totalHigh > 0, 'floating-to-case conversion creates a real priced change');
  const turned = structuredClone(caseSpec); turned.decor.shelves[0].enclosure!.rotationDeg = -90;
  const turning = changes(turned, caseSpec);
  assert.equal(turning.lines.find((l) => l.id === panels.id)!.scope, 'unchanged', 'turning existing case does not repurchase its panels');
  assert.ok(turning.lines.find((l) => l.id === assembly.id)!.laborLow > 0, 'turning an installed case includes remount work');
  assert.deepEqual(full(turned).quantities, q, 'rotation preserves all physical material quantities');
  const defaultAngle = structuredClone(caseSpec); delete defaultAngle.decor.shelves[0].enclosure!.rotationDeg;
  assert.equal(changes(defaultAngle, caseSpec).totalHigh, 0, 'missing/default orientation is equivalent to zero');
  const stained = structuredClone(caseSpec); stained.decor.shelves[0].finishColorHex = '#302010';
  assert.equal(changes(stained, caseSpec).lines.find((l) => l.id === panels.id)!.scope, 'changed', 'observed finish change enters scope');
  const painted = structuredClone(caseSpec); painted.decor.shelves[0].material = 'white'; painted.decor.shelves[0].finishColorHex = null;
  assert.ok(full(painted).lines.find((l) => l.id === panels.id)!.materialLow < panels.materialLow, 'painted cases use the existing painted-cabinet rate');

  const matched = structuredClone(caseSpec); matched.decor.shelves[0].material = 'match-cabinets';
  const slot = spec.roomType === 'kitchen' ? 'cabinets_upper' : 'vanity_cabinet';
  const match = full(matched), beforeMatch = match.lines.find((l) => l.id === panels.id)!;
  const material = CATALOG_BY_ID[selections(matched)[slot]];
  assert.equal(beforeMatch.slot, slot); assert.ok(material && beforeMatch.label.includes(material.name), 'case uses the selected cabinet material and tier');
  const ignoredTint = structuredClone(matched); ignoredTint.decor.shelves[0].finishColorHex = '#112233';
  assert.equal(changes(ignoredTint, matched).totalHigh, 0, 'a tint ignored by match-cabinets rendering does not invent work');
  matched.decor.shelves[0].material = 'match-countertop';
  const slab = full(matched).lines.find((l) => l.id === panels.id)!;
  assert.equal(slab.slot, spec.roomType === 'kitchen' ? 'countertop' : 'vanity_top');
  assert.match(slab.note!, /Selected countertop material rate per sqft/, 'matched slab case uses the existing area-priced material');

  const mixed = structuredClone(spec); mixed.decor.shelves = [structuredClone(floating), structuredClone(enclosed)];
  const mix = full(mixed);
  assert.deepEqual(mix.lines.find((l) => l.id === 'open-shelves'), line, 'adding casework leaves neighboring floating-shelf line untouched');
  assert.ok(mix.lines.some((l) => l.id === 'open-shelf-case-1-panels'), 'case line identity is anchored to its shelf index');
}
console.log('Enclosure estimates: panel takeoff, optional backs, thickness, matched finishes, remount-only rotation, zero baseline and legacy floating snapshots passed.');
