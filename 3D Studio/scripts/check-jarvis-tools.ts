import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkspace, executeTool, finishWorkspace, JARVIS_TOOLS, type Workspace } from '../src/lib/jarvis/tools';
import { validateDesign, budgetFor } from '../src/lib/jarvis/validation';
import { compareEstimates, estimateSnapshot, findSavings } from '../src/lib/jarvis/savings';
import { DesignSnapshotZ, JarvisStateZ, DesignOptionZ, JarvisRequestZ } from '../src/lib/jarvis/schemas';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { CATALOG_BY_ID, materialsForSlot } from '../src/lib/materials/catalog';
import { computeKitchenLayout } from '../src/components/scene/kitchen/layout';
import { designFingerprint, emptyJarvisState, snapshotOf, type DesignOption } from '../src/lib/jarvis/types';
import type { Project, KitchenSpec, Estimate } from '../src/lib/spec/types';
import { ft } from '../src/lib/units';
import { RoomSpecZ } from '../src/lib/spec/schema';
import { commitJarvisResult, undoJarvisChange } from '../src/lib/jarvis/project';

function project(): Project {
  const spec = defaultKitchen(); spec.dims = { widthFt: 20, depthFt: 20, ceilingFt: 9 }; spec.island.offset = { x: 0, z: 0 };
  return { id: 'jarvis-tools-test', name: 'Measured spacious kitchen', roomType: 'kitchen', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', photos: [], description: '', spec, selections: { ...spec.materials }, overrides: {}, baseline: { spec: structuredClone(spec), selections: { ...spec.materials }, capturedAt: '2026-09-10T00:00:00.000Z', source: 'analysis' }, estimateSettings: { region: 'national', tier: 'standard', mode: 'changes', scope: 'pull-and-replace', contingencyPct: 0.1, markupPct: 0.2, includePermits: true, includeKnockOns: true }, renders: [], scans: [], intake: null };
}
const call = (w: Workspace, name: string, args: unknown) => executeTool(w, name, args) as Record<string, unknown>;
function success<T>(w: Workspace, name: string, args: unknown): T { const result = call(w, name, args); assert.equal(result.ok, true, JSON.stringify(result)); return result as T; }
function fails(w: Workspace, name: string, args: unknown, code: string) { const before = JSON.stringify(w); const result = call(w, name, args); assert.equal(result.ok, false, `${name} must fail`); assert.equal(result.code, code, JSON.stringify(result)); assert.equal(JSON.stringify(w), before, 'failed tool rolls back the entire workspace'); }
const wallAlternative = materialsForSlot('walls').find((m) => m.id !== project().selections.walls)!;
const constraints = { budgetMax: null, keepAppliances: null, lockedSlots: null };
const settings = { region: null, tier: null, contingencyPct: null, markupPct: null, scope: null, includePermits: null, mode: null, includeKnockOns: null };
const resize = { lengthFt: 8, widthFt: null, offsetXFt: null, offsetZFt: null };
const option = (name: string, operations: unknown[] = [], exploratory = false) => ({ name, description: 'Deterministic test design', operations, exploratory });
const original = project(), originalJSON = JSON.stringify(original), w = createWorkspace(original);
assert.ok(validateDesign(w.working).valid, JSON.stringify(validateDesign(w.working)));
success(w, 'getProject', {});
assert.equal(designFingerprint(finishWorkspace(w).working), designFingerprint(snapshotOf(original)), 'read-only legacy snapshot stays byte-identical');
assert.equal(JSON.stringify(original), originalJSON, 'workspace does not mutate the input project');
fails(w, 'deleteEverything', {}, 'unknown-tool');
fails(w, 'getProject', { extra: true }, 'invalid-arguments');
fails(w, 'modifyLayout', { operations: [{ type: 'patch', path: '/dims/widthFt', value: 50 }] }, 'invalid-arguments');
fails(w, 'changeMaterial', { slot: 'walls', materialId: 'imaginary-vendor-white' }, 'unknown-material');
fails(w, 'changeMaterial', { slot: 'room_width', materialId: wallAlternative.id }, 'unknown-slot');
fails(w, 'changeMaterial', { slot: 'countertop', materialId: wallAlternative.id }, 'unknown-material');
const baseline = JSON.stringify(w.initial.baseline);
success(w, 'modifyLayout', { operations: [{ type: 'material', slot: 'walls', materialId: wallAlternative.id }] });
assert.equal(JSON.stringify(w.working.baseline), baseline, 'material editing preserves immutable as-found baseline');
assert.deepEqual(w.working.spec, original.spec, 'material choices never rewrite the observed spec');
assert.deepEqual((w.working.spec as KitchenSpec).appliances, (original.spec as KitchenSpec).appliances, 'unrelated appliances preserved');
fails(w, 'modifyLayout', { operations: [{ type: 'material', slot: 'walls', materialId: original.selections.walls }, { type: 'material', slot: 'countertop', materialId: 'invalid' }] }, 'unknown-material');
success(w, 'setConstraints', { ...constraints, lockedSlots: ['countertop'] });
fails(w, 'changeMaterial', { slot: 'countertop', materialId: materialsForSlot('countertop')[0].id }, 'locked-slot');
success(w, 'setConstraints', { ...constraints, lockedSlots: [] });
assert.ok(w.constraints.lockedSlots.includes('countertop'), 'an empty lock list cannot silently unlock existing constraints');
w.message = 'Unlock the countertop.';
success(w, 'setConstraints', { ...constraints, lockedSlots: [] });
assert.ok(!w.constraints.lockedSlots.includes('countertop'), 'explicit current request can unlock a material');

const budget = createWorkspace(project(), 'Keep existing appliances and stay under $85k. Make the island 8 feet long.');
assert.equal(budget.constraints.budgetMax, 85000); assert.equal(budget.constraints.keepAppliances, true);
const priorBudget = project(); priorBudget.jarvis = { ...emptyJarvisState(), constraints: { ...emptyJarvisState().constraints, budgetMax: 85000 } };
for (const message of [
  'Set the hard budget back to $95,000 and apply the option.',
  'Raise the budget from $85k to $95k.',
  'Set the budget ceiling to $95,000.',
  'Change the budget limit back to 95k.',
  'Budget max: $95,000.',
]) {
  const parsedBudget = createWorkspace(priorBudget, message);
  assert.equal(parsedBudget.explicitBudget, 95000, `${message}: requested new ceiling is recognized`);
  success(parsedBudget, 'setConstraints', { ...constraints, budgetMax: 95000 });
  assert.equal(parsedBudget.constraints.budgetMax, 95000);
}
assert.equal(createWorkspace(priorBudget, 'Lower the budget from $95k to $80k.').constraints.budgetMax, 80000, 'from/to parsing chooses the destination when lowering, too');
const lowerPriorBudget = structuredClone(priorBudget); lowerPriorBudget.jarvis!.constraints.budgetMax = 75000;
for (const message of ['Keep everything under $85,000.', 'Keep the whole job under $85,000.', 'Keep the entire project under $85k.']) {
  const wholeProjectCap = createWorkspace(lowerPriorBudget, message);
  assert.equal(wholeProjectCap.explicitBudget, 85000, `${message}: an explicit whole-project cap authorizes the new ceiling`);
  success(wholeProjectCap, 'setConstraints', { ...constraints, budgetMax: 85000 });
  assert.equal(wholeProjectCap.constraints.budgetMax, 85000);
}
for (const message of [
  "Don't raise the budget from $85k to $95k.",
  'Don’t increase the hard budget ceiling to $95,000.',
  'I will not raise the budget to $95,000.',
  'We won’t increase the budget from $85k to $95k.',
  'No increase to the budget limit of $95,000.',
  'The option costs $95,000; find $12,000 in savings.',
  'Find savings under $95,000 and save $12k against the budget.',
]) {
  const guardedBudget = createWorkspace(priorBudget, message);
  assert.equal(guardedBudget.explicitBudget, null, `${message}: no authorized new budget`);
  assert.equal(guardedBudget.constraints.budgetMax, 85000);
  fails(guardedBudget, 'setConstraints', { ...constraints, budgetMax: 95000 }, 'budget-locked');
}
success(budget, 'resizeIsland', resize);
const actual = computeKitchenLayout(budget.working.spec as KitchenSpec).island!;
assert.ok(Math.abs(actual.len - ft(8)) < 0.001, '8ft request is 8ft in the actual renderer');
assert.deepEqual((budget.working.spec as KitchenSpec).dims, (budget.initial.spec as KitchenSpec).dims, 'room measurements never expand to fit');
const priced = success<{ estimate: Estimate }>(budget, 'calculateEstimate', { optionId: null }).estimate;
const appliance = priced.lines.find((l) => l.id === 'appliances')!;
assert.ok(appliance && appliance.materialHigh === 0 && appliance.laborHigh === 0, 'retained appliances incur no purchase/replacement allowance');
assert.equal(budgetFor(priced, budget.constraints).status, 'within');
fails(budget, 'changeMaterial', { slot: 'appliances', materialId: materialsForSlot('appliances')[0].id }, 'retained-appliances');
fails(budget, 'setConstraints', { ...constraints, keepAppliances: false }, 'retained-appliances');
fails(budget, 'setConstraints', { ...constraints, budgetMax: 90000 }, 'budget-locked');
budget.message = 'Replace the existing appliances.';
success(budget, 'setConstraints', { ...constraints, keepAppliances: false });
assert.equal(budget.constraints.keepAppliances, false, 'explicit current request can release retained-appliance policy');

const islandApplianceProject = project();
const islandKitchen = islandApplianceProject.spec as KitchenSpec;
islandKitchen.island.hasCooktop = true;
const islandRetained = createWorkspace(islandApplianceProject, 'Keep existing appliances.');
fails(islandRetained, 'resizeIsland', resize, 'appliance-relocation');
fails(islandRetained, 'modifyLayout', { operations: [{ type: 'island', ...resize, lengthFt: null, rotationDeg: 90, waterfall: null, seating: null }] }, 'appliance-relocation');
const tiny = project(); (tiny.spec as KitchenSpec).dims.widthFt = 10; const small = createWorkspace(tiny);
fails(small, 'resizeIsland', resize, 'invalid-design');
const tinyOption = success<{ option: DesignOption }>(small, 'createDesignOption', option('Eight foot idea', [{ type: 'island', ...resize, rotationDeg: null, waterfall: null, seating: null }], true)).option;
assert.equal(tinyOption.validation.valid, false); assert.equal(tinyOption.name, 'Eight foot idea');
assert.equal(tinyOption.description, 'Deterministic test design', 'invalid ideas retain authored design notes; structured validation identifies the blocker');
fails(small, 'selectDesignOption', { optionId: tinyOption.id }, 'invalid-design');
fails(small, 'renderPhoto', { optionId: tinyOption.id }, 'invalid-design');

const options = createWorkspace(project());
const batch = success<{ options: DesignOption[] }>(options, 'createDesignOptions', { options: [option('As found'), option('New wall finish', [{ type: 'material', slot: 'walls', materialId: wallAlternative.id }]), option('Eight foot island', [{ type: 'island', ...resize, rotationDeg: null, waterfall: null, seating: null }])] }).options;
assert.equal(options.activeOptionId, null, 'saving options never applies them');
const immutable = JSON.stringify(options.options[1].snapshot);
batch[1].snapshot.selections.walls = 'external-mutation';
assert.equal(JSON.stringify(options.options[1].snapshot), immutable, 'returned options cannot mutate saved snapshots');
success(options, 'setConstraints', { ...constraints, budgetMax: 85000, keepAppliances: true, lockedSlots: ['countertop'] });
const selected = success<{ optionId: string; revisedFrom: string }>(options, 'selectDesignOption', { optionId: options.options[1].id });
assert.notEqual(selected.optionId, options.options[1].id, 'policy adjustment creates a new immutable revision');
assert.equal(selected.revisedFrom, options.options[1].id);
assert.equal(designFingerprint(options.working), designFingerprint(options.options.find((o) => o.id === selected.optionId)!.snapshot), 'active option identity exactly matches the applied snapshot');
assert.equal(options.constraints.budgetMax, 85000); assert.equal(options.constraints.keepAppliances, true); assert.ok(options.constraints.lockedSlots.includes('countertop'));
assert.equal(options.working.estimateSettings.keepExistingAppliances, true, 'retention policy survives selecting an older option');
assert.equal(JSON.stringify(options.working.baseline), JSON.stringify(options.initial.baseline));
assert.equal(JSON.stringify(options.options[1].snapshot), immutable, 'selection never rewrites the immutable option snapshot');
const comparison = success<{ options: Array<{ deltaFromReference: ReturnType<typeof compareEstimates> }> }>(options, 'compareOptions', { optionIds: options.options.map((o) => o.id) });
for (const o of comparison.options) for (const bound of [o.deltaFromReference.low, o.deltaFromReference.high]) assert.equal(bound.material + bound.labor + bound.contingency + bound.markup + bound.tax + bound.rounding, bound.total, 'all comparison components reconcile exactly');
const beforeBatch = JSON.stringify(options);
const failedBatch = call(options, 'createDesignOptions', { options: [option('Temporary'), option('Bad material', [{ type: 'material', slot: 'walls', materialId: 'fake' }])] });
assert.equal(failedBatch.ok, false); assert.equal(JSON.stringify(options), beforeBatch, 'failed option batch leaves no partial saved option');

const over = createWorkspace(project()); success(over, 'setConstraints', { ...constraints, budgetMax: 1 });
fails(over, 'changeMaterial', { slot: 'walls', materialId: wallAlternative.id }, 'over-budget');
const explored = success<{ option: DesignOption }>(over, 'createDesignOption', option('Painted walls', [{ type: 'material', slot: 'walls', materialId: wallAlternative.id }], true)).option;
assert.equal(explored.budget.status, 'over'); fails(over, 'selectDesignOption', { optionId: explored.id }, 'over-budget');
assert.equal(explored.name, 'Painted walls'); assert.equal(explored.description, 'Deterministic test design', 'no transient eligibility assertion is baked into option prose');
const laterProject = project(); laterProject.jarvis = { ...emptyJarvisState(), constraints: structuredClone(over.constraints), options: structuredClone(over.options) };
const raisedBudget = createWorkspace(laterProject, 'Raise the budget to $95k.');
const savedBeforeRaise = JSON.stringify(raisedBudget.options[0]);
const currentEligibility = success<{ budget: { status: string } }>(raisedBudget, 'calculateEstimate', { optionId: explored.id });
assert.equal(currentEligibility.budget.status, 'within', 'current eligibility follows the newly authorized budget');
success(raisedBudget, 'selectDesignOption', { optionId: explored.id });
assert.equal(JSON.stringify(raisedBudget.options[0]), savedBeforeRaise, 'budget changes and selection preserve existing names, notes and the complete saved option');
assert.equal(designFingerprint(raisedBudget.working), designFingerprint(explored.snapshot), 'new eligibility does not alter the immutable design fingerprint');
const finalGuard = createWorkspace(project()); success(finalGuard, 'changeMaterial', { slot: 'walls', materialId: wallAlternative.id }); success(finalGuard, 'setConstraints', { ...constraints, budgetMax: 1 });
assert.throws(() => finishWorkspace(finalGuard), /budget/, 'a final constraint change cannot commit a newly over-budget design');
const unchangedOver = project(); unchangedOver.estimateSettings.mode = 'full'; const existing = createWorkspace(unchangedOver); success(existing, 'setConstraints', { ...constraints, budgetMax: 1 });
assert.doesNotThrow(() => finishWorkspace(existing), 'existing over-budget design may be described while saving a stricter constraint');

const rates = createWorkspace(project(), 'Find savings under $85k');
fails(rates, 'setEstimateSettings', { ...settings, contingencyPct: 0 }, 'settings-authorization');
fails(rates, 'setEstimateSettings', { ...settings, scope: 'cosmetic' }, 'settings-authorization');
rates.message = 'Set markup to 15%.'; success(rates, 'setEstimateSettings', { ...settings, markupPct: 0.15 });
assert.equal(rates.working.estimateSettings.markupPct, 0.15, 'explicit rate change is supported');
const savingsProject = project(); savingsProject.estimateSettings.mode = 'full'; const savingsSnapshot = snapshotOf(savingsProject);
const everySlotLocked = { budgetMax: 1, keepAppliances: false, lockedSlots: Object.keys(savingsSnapshot.spec.materials) };
const honest = findSavings(savingsSnapshot, everySlotLocked, 6, 12000);
assert.equal(honest.savingsHigh, 0); assert.equal(honest.remainingSavings, 12000); assert.equal(honest.shortfallHigh, honest.estimate.totalHigh - 1); assert.equal(honest.recommendations.length, 0, 'locked finishes cannot be silently swapped to claim savings');
const savings = findSavings(savingsSnapshot, { budgetMax: null, keepAppliances: false, lockedSlots: ['countertop'] }, 2, 12000);
assert.ok(savings.evaluated <= 240); assert.ok(savings.recommendations.every((r) => r.slot !== 'countertop' && CATALOG_BY_ID[r.to]));
assert.deepEqual((savings.snapshot.spec as KitchenSpec).dims, (savingsSnapshot.spec as KitchenSpec).dims); assert.deepEqual(savings.snapshot.estimateSettings, savingsSnapshot.estimateSettings); assert.deepEqual(savings.snapshot.baseline, savingsSnapshot.baseline);
assert.deepEqual(savings.snapshot.spec, savingsSnapshot.spec, 'savings changes selections only, preserving observed materials and every geometry field');
assert.equal(savings.savingsHigh, estimateSnapshot(savingsSnapshot).totalHigh - savings.estimate.totalHigh); assert.equal(savings.remainingSavings, Math.max(0, 12000 - savings.savingsHigh));
assert.deepEqual(findSavings(savingsSnapshot, { budgetMax: null, keepAppliances: false, lockedSlots: ['countertop'] }, 2, 12000), savings, 'catalog savings search is deterministic');

success(options, 'renderPhoto', { optionId: selected.optionId }); success(options, 'generateProposal', { optionIds: [selected.optionId], title: 'Client comparison' });
const queued = finishWorkspace(options); assert.equal(queued.renderRequests.length, 1); assert.ok(queued.proposalRequest); assert.ok(!('url' in queued.renderRequests[0]), 'render queue never fabricates an artifact URL');
const withState = project(); withState.jarvis = { ...emptyJarvisState(), options: structuredClone(options.options), constraints: options.constraints, proposals: [{ id: 'p1', url: '/proposal/proposal-one', title: 'Proposal', createdAt: withState.createdAt, optionIds: [options.options[0].id] }] };
assert.ok(JarvisRequestZ.safeParse({ project: withState, message: 'Compare these three options.' }).success, 'representative request with three complete options and baselines validates');
assert.ok(JarvisStateZ.safeParse(withState.jarvis).success); assert.ok(DesignOptionZ.safeParse(options.options[0]).success); assert.ok(DesignSnapshotZ.safeParse(options.working).success);
const stale = createWorkspace(project()); const staleOption = success<{ option: DesignOption }>(stale, 'createDesignOption', option('Old baseline')).option;
const forged = structuredClone(staleOption); forged.snapshot.baseline!.spec.detected.summary = 'Different original room'; stale.options = [forged];
fails(stale, 'selectDesignOption', { optionId: forged.id }, 'stale-option');
fails(stale, 'renderPhoto', { optionId: forged.id }, 'stale-option');
fails(stale, 'generateProposal', { optionIds: [forged.id], title: 'Stale proposal' }, 'stale-option');
const malicious = structuredClone(options.options[0]); malicious.snapshot.estimateSettings.markupPct = -1; assert.equal(DesignOptionZ.safeParse(malicious).success, false, 'saved invalid estimate settings rejected');
const badState = structuredClone(withState.jarvis); badState.options.push(structuredClone(badState.options[0])); assert.equal(JarvisStateZ.safeParse(badState).success, false, 'duplicate immutable option identifiers rejected');
const previousProject = project(); previousProject.jarvis = { ...emptyJarvisState(), undo: { snapshot: snapshotOf(project()), afterFingerprint: 'test', activeOptionId: null, constraints: emptyJarvisState().constraints } }; previousProject.selections.walls = wallAlternative.id;
assert.ok(success<Record<string, unknown>>(createWorkspace(previousProject), 'getProject', {}).previousChangeComparison, 'read-only context includes the actual previous change');
function strictObject(value: unknown) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(strictObject); return; }
  const object = value as Record<string, unknown>;
  assert.ok(!('oneOf' in object), 'strict provider schema contains no unsupported oneOf');
  if (object.type === 'object') { assert.equal(object.additionalProperties, false); assert.deepEqual([...(object.required as string[])].sort(), Object.keys(object.properties as object).sort()); }
  Object.values(object).forEach(strictObject);
}
for (const tool of JARVIS_TOOLS) {
  strictObject(tool.parameters);
  assert.equal(tool.strict, true);
  const schema = tool.parameters as { additionalProperties: boolean; properties: object; required: string[] };
  assert.equal(schema.additionalProperties, false); assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), 'all strict tool fields are required, with null used explicitly');
}
async function checkMaterialPersistence() {
  // Install storage before importing the actual Zustand store so its real
  // persistence middleware, loadProject and rehydration callback all execute.
  const memory = new Map<string, string>();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  } });
  try {
    const { useProjectStore } = await import('../src/lib/store/project-store');
    const source = project();
    source.spec = RoomSpecZ.parse(JSON.parse(readFileSync(new URL('./fixtures/client-shelves.spec.json', import.meta.url), 'utf8')));
    source.selections = { ...source.spec.materials };
    source.baseline = { spec: structuredClone(source.spec), selections: { ...source.selections }, capturedAt: source.createdAt, source: 'analysis' };
    useProjectStore.getState().loadProject(source);
    const originalPhoto = structuredClone(useProjectStore.getState().project);
    const photoWorkspace = createWorkspace(originalPhoto);
    const saved = success<{ option: DesignOption }>(photoWorkspace, 'createDesignOption', option('Soapstone remodel', [{ type: 'material', slot: 'countertop', materialId: 'ct-soapstone' }])).option;
    success(photoWorkspace, 'selectDesignOption', { optionId: saved.id });
    const applied = commitJarvisResult(originalPhoto, { ...finishWorkspace(photoWorkspace), model: 'gpt-6-astra', reply: 'Selected soapstone.', baseFingerprint: designFingerprint(snapshotOf(originalPhoto)), activities: [] }, 'Use soapstone.');
    const expected = designFingerprint(snapshotOf(applied));
    function checkRoundtrip(stage: string) {
      const loaded = useProjectStore.getState().project;
      const active = loaded.jarvis!.options.find((o) => o.id === loaded.jarvis!.activeOptionId)!;
      assert.equal(loaded.selections.countertop, 'ct-soapstone', `${stage}: remodel choice survives`);
      assert.deepEqual(loaded.spec, originalPhoto.spec, `${stage}: photo observations and detected material map remain immutable`);
      assert.deepEqual(loaded.baseline, originalPhoto.baseline, `${stage}: as-found baseline survives`);
      assert.equal(designFingerprint(snapshotOf(loaded)), expected, `${stage}: working identity survives`);
      assert.equal(designFingerprint(active.snapshot), expected, `${stage}: selected option badge remains current`);
      assert.equal(loaded.jarvis!.undo!.afterFingerprint, expected, `${stage}: undo remains bound to the current design`);
      assert.equal(designFingerprint(snapshotOf(undoJarvisChange(loaded))), designFingerprint(snapshotOf(originalPhoto)), `${stage}: actual undo restores the original photo design`);
    }
    useProjectStore.setState({ project: structuredClone(applied) });
    assert.ok(memory.get('manhattan-project-v1'), 'actual project store writes its persistence envelope');
    await useProjectStore.persist.rehydrate(); checkRoundtrip('local storage rehydration');
    useProjectStore.getState().loadProject(JSON.parse(JSON.stringify(applied)) as Project); checkRoundtrip('saved project JSON load');
    await useProjectStore.persist.rehydrate(); checkRoundtrip('reload then rehydration');
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}
checkMaterialPersistence().then(() => console.log('Jarvis deterministic tools: exact geometry, $85k high-end budget, retained appliances, snapshots, rollback, constraints, reconciled deltas, honest $12k savings target, strict schemas, real artifact queues and actual project persistence passed.')).catch((error) => { console.error(error); process.exitCode = 1; });
