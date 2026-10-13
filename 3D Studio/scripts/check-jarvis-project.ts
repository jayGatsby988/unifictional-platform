import assert from 'node:assert/strict';
import { defaultKitchen } from '../src/lib/spec/defaults';
import type { Project, EstimateSettings, KitchenSpec } from '../src/lib/spec/types';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { applyJarvisOption, commitJarvisResult, restoredJarvisState, undoJarvisChange } from '../src/lib/jarvis/project';
import { buildJarvisProposal } from '../src/lib/jarvis/proposal';
import { budgetFor, validateDesign } from '../src/lib/jarvis/validation';
import { designFingerprint, emptyJarvisState, snapshotOf, type DesignOption, type JarvisTurnResult } from '../src/lib/jarvis/types';
import { computeKitchenLayout } from '../src/components/scene/kitchen/layout';

const settings: EstimateSettings = { region: 'seattle', tier: 'standard', contingencyPct: 0.1, markupPct: 0.2, scope: 'pull-and-replace', includePermits: true, mode: 'changes', includeKnockOns: true };
const spec = defaultKitchen(); spec.island.present = false;
const now = '2026-09-10T09:00:00.000Z';
const selections = { ...spec.materials };
const p: Project = { id: 'jarvis-test-project', name: 'Jarvis regression kitchen', roomType: 'kitchen', createdAt: now, updatedAt: now, photos: [], description: '', spec, selections, overrides: {}, baseline: { spec: structuredClone(spec), selections: { ...selections }, capturedAt: now, source: 'demo' }, estimateSettings: settings, renders: [], scans: [], intake: null, branding: { company: 'Test Contractor' }, client: { name: 'Client' } };
const constraints = { budgetMax: 1000000, keepAppliances: false, lockedSlots: [] };
const before = JSON.stringify(p), snapshot = snapshotOf(p);
snapshot.selections.countertop = 'ct-soapstone';
const estimate = calculateEstimate(snapshot.spec, snapshot.selections, snapshot.estimateSettings, snapshot.baseline);
const option: DesignOption = { id: 'option-a', name: 'Option A', description: 'Soapstone counter', createdAt: now, snapshot, estimate, validation: validateDesign(snapshot), budget: budgetFor(estimate, constraints) };
assert.equal(option.validation.valid, true, JSON.stringify(option.validation));
const result: JarvisTurnResult = { model: 'gpt-6-astra', reply: 'Applied the soapstone counter.', baseFingerprint: designFingerprint(snapshotOf(p)), working: snapshot, constraints, options: [option], activeOptionId: option.id, activities: [], renderRequests: [], proposalRequest: null };
const applied = commitJarvisResult(p, result, 'Change the countertop.');
assert.equal(applied.selections.countertop, 'ct-soapstone');
assert.deepEqual(applied.baseline, p.baseline);
assert.equal(applied.jarvis?.messages.length, 2);
assert.equal(applied.jarvis?.activeOptionId, 'option-a');
assert.equal(JSON.stringify(p), before, 'input project must stay immutable');
assert.equal(applied.client?.name, 'Client');
assert.equal(applied.branding?.company, 'Test Contractor');
assert.equal(restoredJarvisState(applied.jarvis).options.length, 1, 'session survives schema roundtrip');
assert.throws(() => commitJarvisResult({ ...p, selections: { ...p.selections, walls: 'wall-naval' } }, result, 'Old request'), /changed while/);
assert.throws(() => commitJarvisResult(p, { ...result, constraints: { ...constraints, budgetMax: 1 } }, 'Under one dollar'), /exceeds/);
assert.throws(() => commitJarvisResult(p, { ...result, working: { ...snapshot, baseline: null } }, 'Fake baseline'), /baseline/);
const undone = undoJarvisChange(applied);
assert.deepEqual(undone.selections, p.selections);
assert.deepEqual(undone.baseline, p.baseline);
assert.equal(undone.jarvis?.undo, null);
assert.throws(() => undoJarvisChange({ ...applied, selections: { ...applied.selections, walls: 'wall-naval' } }), /edited the design/);
const changedBase = structuredClone(applied); changedBase.baseline!.spec.detected.notes.push('New measured baseline');
assert.throws(() => applyJarvisOption(changedBase, 'option-a'), /baseline changed/);
const measured = structuredClone(applied); measured.spec!.detected.measurements = { widthFt: 14, depthFt: 12, ceilingFt: 9, confirmedAt: now };
assert.throws(() => applyJarvisOption(measured, 'option-a'), /confirmed measurements/);
const locked = structuredClone(applied); locked.selections.countertop = p.selections.countertop; locked.jarvis!.constraints.lockedSlots = ['countertop'];
assert.throws(() => applyJarvisOption(locked, 'option-a'), /locked/);
const over = structuredClone(applied); over.jarvis!.constraints.budgetMax = 1;
assert.throws(() => applyJarvisOption(over, 'option-a'), /exceeds/);
const constraintOnly: JarvisTurnResult = { ...result, working: snapshotOf(p), constraints: { ...constraints, budgetMax: 1 }, options: [], activeOptionId: null };
assert.equal(commitJarvisResult(p, constraintOnly, 'Budget is one dollar').jarvis?.constraints.budgetMax, 1);

// A second turn may raise a budget and apply a previously over-budget option.
// Undo must restore eligibility for every retained option, not only the room.
const budgetProject: Project = { ...structuredClone(p), estimateSettings: { ...settings, region: 'national', markupPct: 0.1, mode: 'full' }, jarvis: { ...emptyJarvisState(), constraints: { ...constraints, budgetMax: 85000 } } };
const lowerSnapshot = snapshotOf(budgetProject), higherSnapshot = snapshotOf(budgetProject);
higherSnapshot.selections.countertop = 'ct-soapstone';
const undoOptions = [lowerSnapshot, higherSnapshot].map((candidate, index): DesignOption => {
  const priced = calculateEstimate(candidate.spec, candidate.selections, candidate.estimateSettings, candidate.baseline);
  return { ...option, id: `undo-budget-${index}`, snapshot: candidate, estimate: priced, validation: validateDesign(candidate, budgetProject.jarvis!.constraints), budget: budgetFor(priced, budgetProject.jarvis!.constraints) };
});
assert.ok(undoOptions[0].estimate.totalHigh < 85000 && undoOptions[1].estimate.totalHigh > 85000 && undoOptions[1].estimate.totalHigh < 95000, 'real estimate fixture crosses only the restored $85k ceiling');
budgetProject.jarvis!.options = structuredClone(undoOptions);
budgetProject.jarvis!.proposals = [{ id: 'historical-proposal', url: '/proposal/historical-proposal', title: 'Original comparison', createdAt: now, optionIds: undoOptions.map((o) => o.id) }];
budgetProject.renders = [{ id: 'historical-render', provider: 'openai', status: 'completed', createdAt: now, selections: higherSnapshot.selections, sourceUrl: 'https://example.com/source.png', sourceKind: 'viewport', resultUrl: 'https://example.com/finished.png', prompt: 'Saved image', optionId: undoOptions[1].id, designFingerprint: designFingerprint(higherSnapshot) }];
const raisedAndApplied = commitJarvisResult(budgetProject, { ...result, working: higherSnapshot, baseFingerprint: designFingerprint(snapshotOf(budgetProject)), constraints: { ...constraints, budgetMax: 95000 }, options: undoOptions, activeOptionId: undoOptions[1].id }, 'Raise the budget to $95k and apply the soapstone option.');
assert.ok(raisedAndApplied.jarvis!.options.every((o) => o.budget.status === 'within' && o.budget.max === 95000));
const restoredBudget = undoJarvisChange(raisedAndApplied);
assert.equal(restoredBudget.jarvis!.constraints.budgetMax, 85000);
assert.equal(designFingerprint(snapshotOf(restoredBudget)), designFingerprint(snapshotOf(budgetProject)), 'undo restores the previous design exactly');
assert.deepEqual(restoredBudget.jarvis!.options.map((o) => o.budget.status), ['within', 'over'], 'every saved option reflects the restored budget');
for (const [index, savedOption] of restoredBudget.jarvis!.options.entries()) {
  assert.equal(savedOption.budget.max, 85000);
  assert.equal(savedOption.budget.headroom, 85000 - savedOption.estimate.totalHigh);
  assert.deepEqual(savedOption.snapshot, undoOptions[index].snapshot, 'eligibility refresh preserves immutable option snapshots');
  assert.deepEqual(savedOption.validation, validateDesign(savedOption.snapshot, restoredBudget.jarvis!.constraints));
  assert.deepEqual(savedOption.estimate, calculateEstimate(savedOption.snapshot.spec, savedOption.snapshot.selections, savedOption.snapshot.estimateSettings, savedOption.snapshot.baseline));
}
assert.deepEqual(restoredBudget.renders, raisedAndApplied.renders, 'historical rendered artifacts remain intact');
assert.deepEqual(restoredBudget.jarvis!.proposals, raisedAndApplied.jarvis!.proposals, 'historical proposal links remain intact');
assert.throws(() => applyJarvisOption(restoredBudget, undoOptions[1].id), /exceeds/, 'restored displayed eligibility agrees with the application guard');

// Persisted sessions may contain the old undo bug or stale/forged cached prices.
// Loading derives assessments from saved designs and current constraints.
const staleCachedState = structuredClone(restoredBudget.jarvis!);
staleCachedState.options.forEach((savedOption) => {
  savedOption.estimate.totalLow = 0; savedOption.estimate.totalHigh = 1; savedOption.estimate.mid = 0.5;
  savedOption.validation = { valid: false, issues: [{ severity: 'error', code: 'stale-cache', message: 'Old validation cache' }] };
  savedOption.budget = { max: 95000, status: 'within', headroom: 94999 };
});
const staleBefore = JSON.stringify(staleCachedState);
const refreshedState = restoredJarvisState(staleCachedState);
assert.equal(JSON.stringify(staleCachedState), staleBefore, 'restoring a session never mutates its supplied payload');
assert.deepEqual(refreshedState.options.map((savedOption) => savedOption.budget.status), ['within', 'over'], 'load replaces stale $95k eligibility with the stored $85k constraint');
for (const [index, savedOption] of refreshedState.options.entries()) {
  assert.equal(savedOption.budget.max, 85000);
  assert.deepEqual(savedOption.estimate, undoOptions[index].estimate, 'load recalculates actual totals instead of trusting a forged cached estimate');
  assert.deepEqual(savedOption.validation, validateDesign(savedOption.snapshot, refreshedState.constraints));
  assert.equal(designFingerprint(savedOption.snapshot), designFingerprint(staleCachedState.options[index].snapshot), 'assessment refresh does not change a saved design fingerprint');
  assert.deepEqual(savedOption.snapshot, staleCachedState.options[index].snapshot);
}
assert.deepEqual(refreshedState.proposals, staleCachedState.proposals, 'session restoration preserves historical proposal links');

const retained = snapshotOf(p); retained.estimateSettings = { ...settings, mode: 'full', keepExistingAppliances: true };
const keptEstimate = calculateEstimate(retained.spec, retained.selections, retained.estimateSettings, retained.baseline);
const replacedEstimate = calculateEstimate(retained.spec, retained.selections, { ...retained.estimateSettings, keepExistingAppliances: false }, retained.baseline);
assert.equal(keptEstimate.lines.find((l) => l.id === 'appliances')?.totalHigh, 0);
assert.ok(replacedEstimate.totalHigh > keptEstimate.totalHigh);
assert.deepEqual(retained.spec.roomType === 'kitchen' ? retained.spec.appliances : [], p.spec?.roomType === 'kitchen' ? p.spec.appliances : []);

// An appliance's local coordinates may stay identical while its island parent
// moves it in the room. Apply must enforce retention for both explicit devices
// and a photo-inferred cooktop carried only by island.hasCooktop.
for (const inferred of [false, true]) {
  const kitchen = defaultKitchen();
  kitchen.dims = { widthFt: 20, depthFt: 20, ceilingFt: 9 };
  kitchen.island.offset = { x: 0, z: 0 };
  kitchen.island.hasCooktop = inferred;
  if (!inferred) kitchen.appliances.push({ ...kitchen.appliances[1], kind: 'cooktop', wall: 'island', t: 0.5 });
  const client: Project = { ...structuredClone(p), spec: kitchen, estimateSettings: { ...settings, keepExistingAppliances: true }, baseline: { spec: structuredClone(kitchen), selections: { ...kitchen.materials }, capturedAt: now, source: 'demo' } };
  const keptConstraints = { ...constraints, keepAppliances: true };
  assert.equal(validateDesign(snapshotOf(client), keptConstraints).valid, true, 'retained-island fixture has valid physical clearances');
  const edits: Array<[string, (island: KitchenSpec['island']) => void]> = [
    ['move', (island) => { island.offset.x += 0.5; }],
    ['rotate', (island) => { island.rotationDeg = 90; }],
    ['lengthen', (island) => { island.lengthFt = 8; }],
    ['widen', (island) => { island.widthFt = 4; }],
    ['change support kind', (island) => { island.kind = 'breakfast-bar'; }],
    ['change side overhang', (island) => { island.overhangIn = 18; }],
    ['change end overhang', (island) => { island.endOverhangIn = 6; }],
    ['remove support', (island) => { island.present = false; }],
  ];
  function savedProject(edit: (spec: KitchenSpec) => void): Project {
    const candidate = snapshotOf(client); edit(candidate.spec as KitchenSpec);
    const candidateEstimate = calculateEstimate(candidate.spec, candidate.selections, candidate.estimateSettings, candidate.baseline);
    const savedOption: DesignOption = { ...option, id: 'retained-island-option', snapshot: candidate, estimate: candidateEstimate, validation: validateDesign(candidate, keptConstraints), budget: budgetFor(candidateEstimate, keptConstraints) };
    return { ...structuredClone(client), jarvis: { ...emptyJarvisState(), constraints: keptConstraints, options: [savedOption] } };
  }
  for (const [action, edit] of edits) {
    const attempt = savedProject((candidate) => edit(candidate.island));
    const candidate = attempt.jarvis!.options[0].snapshot.spec as KitchenSpec;
    assert.deepEqual(candidate.appliances, kitchen.appliances, 'source appliance array is unchanged, reproducing the parent-transform bypass');
    if (action === 'move') {
      assert.notEqual(computeKitchenLayout(candidate).island!.cx, computeKitchenLayout(kitchen).island!.cx, 'actual parent position changes');
      if (!inferred) assert.equal(computeKitchenLayout(candidate).appliances.find((a) => a.wall === 'island')!.x, computeKitchenLayout(kitchen).appliances.find((a) => a.wall === 'island')!.x, 'island appliance local x stays unchanged despite parent movement');
    }
    const serialized = JSON.stringify(attempt);
    assert.throws(() => applyJarvisOption(attempt, 'retained-island-option'), /moves or resizes the island supporting an appliance/, `${inferred ? 'inferred' : 'explicit'} retained cooktop rejects ${action}`);
    assert.equal(JSON.stringify(attempt), serialized, 'rejected application preserves the project and immutable saved option');
  }
  const finishOnly = savedProject(() => {});
  finishOnly.jarvis!.options[0].snapshot.selections.countertop = 'ct-soapstone';
  const unchangedParent = applyJarvisOption(finishOnly, 'retained-island-option');
  assert.equal(unchangedParent.selections.countertop, 'ct-soapstone', 'retention still allows material changes that do not move the appliance');
  assert.deepEqual((unchangedParent.spec as KitchenSpec).island, kitchen.island);
  assert.deepEqual((unchangedParent.spec as KitchenSpec).appliances, kitchen.appliances);
}

const proposalProject = structuredClone(applied);
proposalProject.jarvis!.options[0].estimate.mid = 1;
proposalProject.jarvis!.options[0].estimate.totalHigh = 1;
proposalProject.jarvis!.messages.push({ id: 'private-message', role: 'user', text: 'PRIVATE CHAT TEXT', createdAt: now });
proposalProject.renders.push({ id: 'real-render', provider: 'openai', status: 'completed', createdAt: now, selections: snapshot.selections, sourceUrl: 'https://example.com/capture.png', sourceKind: 'viewport', resultUrl: 'https://example.com/render.png', prompt: 'A real captured model', optionId: 'option-a', designFingerprint: designFingerprint(snapshot) });
proposalProject.renders.push({ ...proposalProject.renders[0], id: 'stale-render', designFingerprint: 'stale' });
const built = buildJarvisProposal({ project: proposalProject, optionIds: ['option-a'], title: 'Client options' });
assert.equal(built.proposal.options[0].estimate.mid, estimate.mid, 'server must recalculate caller-forged totals');
assert.equal(built.proposal.renders.length, 1);
assert.equal(built.proposal.renders[0].id, 'real-render');
assert.equal(built.projects.length, 1);
assert.equal(built.projects[0].jarvis, undefined, 'conversation must never be published');
assert.ok(!JSON.stringify(built).includes('PRIVATE CHAT TEXT'));
assert.equal(built.projects[0].selections.countertop, 'ct-soapstone');
assert.equal(built.proposal.projectLinks['option-a'], `/p/${built.projects[0].id}`);
assert.throws(() => buildJarvisProposal({ project: proposalProject, optionIds: ['option-a', 'option-a'], title: 'Duplicate' }), /only once/);
assert.throws(() => buildJarvisProposal({ project: proposalProject, optionIds: ['missing'], title: 'Missing' }), /no longer/);
const saved = { ...applied.jarvis!, proposals: [{ id: built.proposal.id, url: `/proposal/${built.proposal.id}`, title: built.proposal.title, createdAt: now, optionIds: ['option-a'] }] };
assert.equal(restoredJarvisState(saved).proposals.length, 1, 'relative proposal link survives reload');
assert.deepEqual(restoredJarvisState(null), emptyJarvisState());
console.log('PASS Jarvis project transactions, stale guards, undo, retained-appliance pricing, proposal recalculation, render binding and private-chat exclusion.');
