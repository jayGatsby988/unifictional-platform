/** Synthetic scans only. No sensor data or API calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importNativeScan } from '../src/lib/native/scan-import';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { estimateHasUnpricedWork } from '../src/lib/estimate/scan-scope';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { budgetFor, validateDesign } from '../src/lib/jarvis/validation';
import { snapshotOf, emptyJarvisState, type DesignOption, type JarvisProposal } from '../src/lib/jarvis/types';
import { EstimateZ, DesignOptionZ } from '../src/lib/jarvis/schemas';
import { buildJarvisProposal } from '../src/lib/jarvis/proposal';
import { applyJarvisOption, restoredJarvisState } from '../src/lib/jarvis/project';
import { createWorkspace, executeTool } from '../src/lib/jarvis/tools';
import { compareEstimates, findSavings } from '../src/lib/jarvis/savings';
import { estimateToCSV, estimateSummaryText } from '../src/components/studio/projectUtils';
import { JarvisOptionCard, JarvisBudgetLabel, jarvisOptionBlocked } from '../src/components/studio/JarvisOptionCard';
import { JarvisProposalView } from '../src/components/studio/JarvisProposalView';
import { EstimatePanel } from '../src/components/studio/EstimatePanel';
import { MaterialPicker } from '../src/components/studio/MaterialPicker';
import { ToastProvider } from '../src/components/studio/Toast';
import { useProjectStore } from '../src/lib/store/project-store';
import type { KitchenSpec } from '../src/lib/spec/types';

Object.assign(globalThis, { React });
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/native-countertop-contours.sample.json', import.meta.url), 'utf8'));
const constraints = { budgetMax: 85000, keepAppliances: false, lockedSlots: [] };
const fresh = () => importNativeScan(structuredClone(fixture)).project;
const estimate = (p: ReturnType<typeof fresh>) => calculateEstimate(p.spec, p.selections, p.estimateSettings, p.baseline);
function changedProject() { const p = fresh(); p.selections.island_countertop = 'ct-soapstone'; return p; }
function optionFor(p = changedProject()): DesignOption {
  const snapshot = snapshotOf(p), e = estimate(p);
  return { id: 'scan-option', name: 'Countertop finish', description: 'Visual material option', createdAt: p.createdAt, snapshot, estimate: e, validation: validateDesign(snapshot), budget: budgetFor(e, constraints) };
}
let passed = 0;
function check(name: string, run: () => void) { run(); console.log(`PASS ${name}`); passed++; }

check('a countertop finish swap has unknown cost, never a successful zero-dollar budget', () => {
  const p = changedProject(), before = JSON.stringify(p), e = estimate(p);
  assert.equal(e.mid, 0, 'no invented slab quantity or allowance');
  assert.deepEqual(e.unpriced?.map(item => item.slot), ['island_countertop']);
  assert.equal(e.unpriced![0].materialId, 'ct-soapstone');
  assert.ok(e.unpriced![0].objectIds.length > 0);
  assert.equal(e.quantities.islandTopSqft, 0);
  assert.deepEqual(budgetFor(e, constraints), { max: 85000, status: 'incomplete', headroom: null });
  assert.equal(budgetFor(e, { ...constraints, budgetMax: null }).status, 'incomplete');
  assert.ok(validateDesign(snapshotOf(p)).issues.some(issue => issue.code === 'unpriced-scan-work' && issue.message.includes('Island Top')));
  assert.equal(JSON.stringify(p), before);
});
check('full remodel excludes measured patches and bounds-only cabinet work explicitly', () => {
  const p = fresh(); p.estimateSettings.mode = 'full'; const e = estimate(p);
  for (const slot of ['island_countertop', 'cabinets_base', 'countertop', 'hardware']) assert.ok(e.unpriced?.some(item => item.slot === slot), slot);
  assert.deepEqual(e.unpriced, e.fullUnpriced);
  assert.equal(budgetFor(e, constraints).status, 'incomplete');
  assert.equal(e.quantities.baseLF, 0);
  assert.equal(e.quantities.counterSqft, 0);
});
check('partial-patch size cannot manufacture construction area or a completion claim', () => {
  const p = changedProject(), original = estimate(p);
  const object = (p.spec as KitchenSpec).scanGeometry!.objects.find(item => item.countertopSurfaces?.length)!;
  const top = object.countertopSurfaces![0], first = top.polygonCorners[0];
  object.countertopSurfaces = [{ ...top, holes: [], polygonCorners: [first, { ...first, x: first.x + 0.1 }, { ...first, x: first.x + 0.1, z: first.z + 0.1 }, { ...first, z: first.z + 0.1 }] }];
  const partial = estimate(p);
  assert.deepEqual(partial.quantities, original.quantities);
  assert.equal(partial.totalHigh, original.totalHigh);
  assert.equal(budgetFor(partial, constraints).status, 'incomplete');
});
check('unchanged scans retain a zero changes subtotal with honest full-remodel exclusions', () => {
  const p = fresh(), e = estimate(p);
  assert.equal(e.mid, 0); assert.deepEqual(e.unpriced, []); assert.ok(e.fullUnpriced!.length > 0);
  const swap = structuredClone(p); swap.selections.cabinets_base = 'wood-walnut';
  assert.ok(estimate(swap).unpriced?.some(item => item.slot === 'cabinets_base'));
});
check('bathroom partial tops use bathroom coverage slots', () => {
  const input = structuredClone(fixture); input.roomType = 'bathroom';
  const p = importNativeScan(input).project; p.selections.vanity_top = 'ct-soapstone';
  assert.deepEqual(estimate(p).unpriced?.map(item => item.slot), ['vanity_top']);
});
check('procedural fixtures still price normally even alongside excluded scanned fixtures', () => {
  const p = changedProject(), k = p.spec as KitchenSpec;
  k.island = { ...defaultKitchen().island, present: true };
  const e = estimate(p);
  assert.ok(e.quantities.islandTopSqft > 0 && e.lines.some(line => line.id === 'island-top' && line.totalHigh > 0));
  assert.ok(estimateHasUnpricedWork(e), 'proposed island pricing cannot cover the separate captured island');
  const ordinary = defaultKitchen();
  const plain = calculateEstimate(ordinary, { ...ordinary.materials }, { ...p.estimateSettings, mode: 'full' });
  assert.equal(plain.unpriced, undefined); assert.equal(plain.fullUnpriced, undefined);
  assert.ok(plain.lines.some(line => line.id === 'counter' && line.qty > 0));
});
check('CSV and copied summary list missing work and never label the subtotal a complete quote', () => {
  const p = changedProject(), e = estimate(p), csv = estimateToCSV(e, p), text = estimateSummaryText(e, p);
  for (const result of [csv, text]) {
    assert.match(result, /INCOMPLETE/); assert.match(result, /Island Top/); assert.match(result, /Soapstone/);
    assert.match(result, /[Bb]udget (not verified|unverified)/); assert.match(result, /[Pp]artial full-remodel subtotal/);
  }
});
check('the real estimate panel shows pricing needed and not Nothing changed yet', () => {
  // Zustand's SSR getter deliberately reads its initial snapshot. Seed that
  // isolated in-memory snapshot, without persistence or browser storage.
  const initial = useProjectStore.getInitialState(), previous = initial.project;
  try {
    initial.project = changedProject();
    const html = renderToStaticMarkup(createElement(ToastProvider, null, createElement(EstimatePanel)));
    assert.match(html, /Pricing needed/); assert.match(html, /Island Top/); assert.match(html, /Unpriced scanned work/);
    assert.ok(!html.includes('Nothing changed yet'));
    assert.match(html, /<span>Priced subtotal<\/span>/); assert.match(html, /<span>Partial full-remodel subtotal<\/span>/);
    assert.ok(!html.includes('<span>Total</span>') && !html.includes('<span>Full remodel</span>'));
    assert.match(html, /captured room geometry/); assert.match(html, /Scanned fixture construction quantities remain incomplete and are excluded/);
    assert.ok(!html.includes('photo-reconstructed model') && !html.includes('Finishes from your photo'));
  } finally { initial.project = previous; }
});
check('option UI recomputes coverage even if old cached pricing claims within budget', () => {
  const option = optionFor(); delete option.estimate.unpriced; delete option.estimate.fullUnpriced;
  option.budget = { max: 85000, status: 'within', headroom: 85000 };
  assert.equal(jarvisOptionBlocked(option), true);
  const label = renderToStaticMarkup(createElement(JarvisBudgetLabel, { option }));
  assert.match(label, /budget unverified/); assert.ok(!label.includes('High estimate fits'));
  const html = renderToStaticMarkup(createElement(JarvisOptionCard, { option, index: 0, active: false, compared: false, busy: false, currentSpec: option.snapshot.spec, currentSelections: option.snapshot.selections, renders: [], onCompare() {}, onApply() {}, onRender() {}, onRemove() {} }));
  assert.match(html, /Pricing needed/); assert.match(html, /Island Top/);
  assert.match(html, /disabled=""[^>]*>Apply to 3D/);
});
check('scan material alternatives and restore cards never claim equal prices or photo detection', () => {
  const initial = useProjectStore.getInitialState(), previousProject = initial.project, previousUI = initial.ui;
  try {
    initial.ui = { ...initial.ui, selectedSlot: 'island_countertop' };
    for (const project of [fresh(), changedProject()]) {
      initial.project = project;
      const html = renderToStaticMarkup(createElement(MaterialPicker));
      assert.match(html, /Pricing needed/);
      assert.ok(!html.includes('≈ same'));
      assert.ok(!html.includes('Detected in your photo') && !html.includes('Detected in photo') && !html.includes('Matched from photo'));
      assert.ok(!html.includes('Starting finish') && !html.includes('Preview finish'), 'an unobserved demo finish is not a restore target');
      if (project.selections.island_countertop === (project.spec as KitchenSpec).materials.island_countertop) {
        assert.match(html, /Estimated from scan/);
        assert.ok(!html.includes('aria-pressed="true"'), 'unknown starting materials are not checked choices');
      } else assert.match(html, /Estimated from scan/, 'a dormant selection is not presented as the current reconstructed finish');
    }
    initial.ui = { ...initial.ui, selectedSlot: null };
    const overview = renderToStaticMarkup(createElement(MaterialPicker));
    assert.match(overview, /Clear design finish choices/); assert.match(overview, /Clear choices/);
    assert.ok(!overview.includes('Reset to detected'));
  } finally { initial.project = previousProject; initial.ui = previousUI; }
});
check('ordinary material picker keeps actual priced deltas and its existing provenance labels', () => {
  const initial = useProjectStore.getInitialState(), previousProject = initial.project, previousUI = initial.ui;
  try {
    const spec = defaultKitchen(), p = fresh(); p.spec = spec; p.selections = { ...spec.materials }; p.baseline = null; p.estimateSettings.mode = 'full';
    initial.project = p; initial.ui = { ...initial.ui, selectedSlot: 'countertop' };
    const html = renderToStaticMarkup(createElement(MaterialPicker));
    assert.ok(!html.includes('Pricing needed')); assert.match(html, /Detected in your photo/);
    assert.ok(html.includes('text-success') || html.includes('text-warn'), 'ordinary price changes remain visible');
  } finally { initial.project = previousProject; initial.ui = previousUI; }
});
check('server proposals and saved-option application recheck unknown scan pricing', () => {
  const p = changedProject(), option = optionFor(p);
  delete option.estimate.unpriced; delete option.estimate.fullUnpriced;
  option.budget = { max: 85000, status: 'within', headroom: 85000 };
  p.jarvis = { ...emptyJarvisState(), constraints, options: [option] };
  assert.throws(() => buildJarvisProposal({ project: p, optionIds: [option.id], title: 'Client proposal' }), /unpriced scanned work/);
  assert.throws(() => applyJarvisOption(p, option.id), /unpriced/);
  assert.equal(restoredJarvisState(p.jarvis).options[0].budget.status, 'incomplete');
  p.jarvis.constraints.budgetMax = null;
  assert.doesNotThrow(() => applyJarvisOption(p, option.id), 'unbudgeted visual review is allowed');
  assert.throws(() => buildJarvisProposal({ project: p, optionIds: [option.id], title: 'No budget proposal' }), /unpriced scanned work/);
});
check('deterministic tools roll back budgeted swaps and block incomplete proposal queues', () => {
  const w = createWorkspace(fresh(), 'Keep everything under $85,000');
  const before = JSON.stringify(w);
  const result = executeTool(w, 'changeMaterial', { slot: 'island_countertop', materialId: 'ct-soapstone' }) as { ok: boolean; code: string };
  assert.equal(result.ok, false); assert.equal(result.code, 'unpriced-scan-work'); assert.equal(JSON.stringify(w), before);
  const p = changedProject(); p.jarvis = { ...emptyJarvisState(), options: [optionFor(p)] };
  const queue = createWorkspace(p);
  const proposal = executeTool(queue, 'generateProposal', { optionIds: ['scan-option'], title: 'Client proposal' }) as { ok: boolean; code: string };
  assert.equal(proposal.ok, false); assert.equal(proposal.code, 'unpriced-scan-work'); assert.equal(queue.proposalRequest, null);
  const visual = createWorkspace(fresh());
  assert.equal((executeTool(visual, 'changeMaterial', { slot: 'island_countertop', materialId: 'ct-soapstone' }) as { ok: boolean }).ok, true);
});
check('savings and comparisons cannot equate missing scan prices with zero cost changes', () => {
  const p = changedProject();
  assert.throws(() => findSavings(snapshotOf(p), constraints, 2, 12000), /Savings cannot be verified/);
  assert.equal(compareEstimates(estimate(fresh()), estimate(p)).complete, false);
});
check('new coverage survives schema validation while older saved estimates still parse', () => {
  const option = optionFor(); assert.ok(DesignOptionZ.safeParse(option).success);
  const old = structuredClone(option.estimate); delete old.unpriced; delete old.fullUnpriced;
  assert.ok(EstimateZ.safeParse(old).success);
  const restored = importNativeScan(JSON.parse(JSON.stringify({ ...fixture, studioSnapshot: { ...changedProject(), jarvis: { ...emptyJarvisState(), constraints, options: [option] } } })));
  assert.equal(restored.project.jarvis!.options[0].budget.status, 'incomplete');
});
check('previously saved proposals display missing coverage instead of stale budget success', () => {
  const option = optionFor(); delete option.estimate.unpriced; delete option.estimate.fullUnpriced; option.budget.status = 'within';
  const proposal: JarvisProposal = { id: 'old-proposal', title: 'Old proposal', createdAt: option.createdAt, projectId: 'scan', projectName: 'Synthetic scan', constraints, options: [option], renders: [], projectLinks: { [option.id]: '/p/synthetic' } };
  const html = renderToStaticMarkup(createElement(JarvisProposalView, { proposal }));
  assert.match(html, /Pricing incomplete/); assert.match(html, /budget unverified/); assert.match(html, /Island Top/);
  assert.ok(!html.includes('Full estimated range within budget'));
});
console.log(`${passed} scanned estimate coverage checks passed.`);
