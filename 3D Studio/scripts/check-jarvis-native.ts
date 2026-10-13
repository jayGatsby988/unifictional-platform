/** Deterministic synthetic scan and mocked-provider checks. No private scans,
 * credentials, image generation or paid model calls are used. */
import assert from 'node:assert/strict';
import sample from './fixtures/native-countertop-contours.sample.json';
import { importNativeScan } from '../src/lib/native/scan-import';
import { scanSlotShowsDesign, scanPreviewFinishProject } from '../src/lib/native/scan-finishes';
import { materialsForSlot } from '../src/lib/materials/catalog';
import { defaultKitchen } from '../src/lib/spec/defaults';
import type { KitchenSpec, MaterialSlotId, Project } from '../src/lib/spec/types';
import { createWorkspace, executeTool, finishWorkspace, type Workspace } from '../src/lib/jarvis/tools';
import { commitJarvisResult, applyJarvisOption, undoJarvisChange, restoredJarvisState } from '../src/lib/jarvis/project';
import { designFingerprint, emptyJarvisState, snapshotOf, type DesignOption, type DesignSnapshot, type JarvisTurnResult } from '../src/lib/jarvis/types';
import { estimateSnapshot, compareEstimates } from '../src/lib/jarvis/savings';
import { budgetFor, validateDesign } from '../src/lib/jarvis/validation';
import { buildJarvisProposal } from '../src/lib/jarvis/proposal';
import { JarvisStateZ } from '../src/lib/jarvis/schemas';
import { runJarvis, JarvisError } from '../src/lib/jarvis/runner';
import { openaiClient } from '../src/lib/ai/providers/openai';

const fresh = () => importNativeScan(structuredClone(sample)).project;
const alternative = (project: Project, slot: MaterialSlotId) => materialsForSlot(slot).find(material => material.id !== project.selections[slot])!.id;
const call = (workspace: Workspace, name: string, args: unknown) => executeTool(workspace, name, args) as Record<string, unknown>;
function success<T>(workspace: Workspace, name: string, args: unknown): T {
  const result = call(workspace, name, args); assert.equal(result.ok, true, JSON.stringify(result)); return result as T;
}
function fails(workspace: Workspace, name: string, args: unknown, code: string) {
  const before = JSON.stringify(workspace), result = call(workspace, name, args);
  assert.equal(result.ok, false); assert.equal(result.code, code, JSON.stringify(result)); assert.equal(JSON.stringify(workspace), before, 'failed tool preserves every workspace field');
}
const operation = (slot: MaterialSlotId, materialId: string) => ({ type: 'material', slot, materialId });
const optionArgs = (name: string, operations: unknown[] = [], exploratory = false) => ({ name, description: 'Synthetic design intent', operations, exploratory });
function resultFor(project: Project, workspace: Workspace): JarvisTurnResult {
  return { ...finishWorkspace(workspace), model: 'gpt-6-astra', baseFingerprint: designFingerprint(snapshotOf(project)), reply: 'The requested design action was checked.', activities: [] };
}
function optionFor(snapshot: DesignSnapshot, id = 'native-option'): DesignOption {
  const estimate = estimateSnapshot(snapshot), constraints = emptyJarvisState().constraints;
  return { id, name: 'Material option', description: 'Synthetic finish alternative', createdAt: '2026-09-12T00:00:00.000Z', snapshot, estimate, validation: validateDesign(snapshot, constraints), budget: budgetFor(estimate, constraints) };
}
const geometry = (project: Project) => JSON.stringify((project.spec as KitchenSpec).scanGeometry);
const viewKeys = ['scanReviewedFinishes', 'scanAppearanceMode', 'scanPreviewSlots'] as const;
const appearance = (project: Project) => Object.fromEntries(viewKeys.filter(key => project.overrides[key] !== undefined).map(key => [key, project.overrides[key]]));
let passed = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`PASS ${name}`); }

async function main() {
  await check('native material execution reaches the requested surface while keeping the old palette captured', () => {
    const project = fresh(); project.overrides.scanReviewedFinishes = { ...project.selections }; project.overrides.scanAppearanceMode = 'captured';
    project.overrides.scanAlignIsland = false;
    const before = JSON.stringify(project), measured = geometry(project), workspace = createWorkspace(project);
    const materialId = alternative(project, 'flooring'); success(workspace, 'changeMaterial', { slot: 'flooring', materialId });
    const applied = commitJarvisResult(project, resultFor(project, workspace), 'Change only the floor.');
    assert.equal(applied.selections.flooring, materialId); assert.equal(scanSlotShowsDesign(applied, 'flooring'), true);
    assert.deepEqual(applied.overrides.scanPreviewSlots, ['flooring']);
    for (const slot of Object.keys(project.selections).filter(slot => slot !== 'flooring')) assert.equal(scanSlotShowsDesign(applied, slot), false, slot);
    assert.equal(geometry(applied), measured); assert.deepEqual(applied.baseline, project.baseline); assert.equal(JSON.stringify(project), before);
    assert.equal(applied.overrides.scanAlignIsland, false); assert.deepEqual(applied.overrides.nativeScan, project.overrides.nativeScan);
    JarvisStateZ.parse(applied.jarvis);
    const reloaded = { ...JSON.parse(JSON.stringify(applied)), jarvis: restoredJarvisState(JSON.parse(JSON.stringify(applied.jarvis))) } as Project;
    assert.equal(scanSlotShowsDesign(reloaded, 'flooring'), true);
    const undone = undoJarvisChange(reloaded);
    assert.deepEqual(undone.selections, project.selections); assert.deepEqual(appearance(undone), appearance(project)); assert.equal(geometry(undone), measured);
  });
  await check('option application uses the same per-slot finish intent and undo preserves unrelated view edits', () => {
    const project = fresh(); project.overrides.scanReviewedFinishes = { ...project.selections };
    const workspace = createWorkspace(project), materialId = alternative(project, 'walls');
    const { option } = success<{ option: DesignOption }>(workspace, 'createDesignOption', optionArgs('Wall finish', [operation('walls', materialId)]));
    const saved = commitJarvisResult(project, resultFor(project, workspace), 'Save a wall option.');
    assert.deepEqual(appearance(saved), appearance(project), 'saving an option is not applying it');
    const applied = applyJarvisOption(saved, option.id); assert.equal(scanSlotShowsDesign(applied, 'walls'), true); assert.equal(scanSlotShowsDesign(applied, 'flooring'), false);
    applied.overrides.scanAlignIsland = true; applied.overrides.cameraNote = 'User independently changed camera settings';
    const undone = undoJarvisChange(applied); assert.deepEqual(appearance(undone), appearance(project));
    assert.equal(undone.overrides.scanAlignIsland, true); assert.equal(undone.overrides.cameraNote, applied.overrides.cameraNote);
    assert.equal(geometry(undone), geometry(project));
  });
  await check('explicitly choosing an already-seeded ID changes captured appearance and can be undone', () => {
    const project = fresh(), workspace = createWorkspace(project), materialId = project.selections.flooring;
    success(workspace, 'changeMaterial', { slot: 'flooring', materialId });
    const result = resultFor(project, workspace); assert.deepEqual(result.finishChoices, { flooring: materialId });
    assert.notEqual(designFingerprint(result.working), designFingerprint(snapshotOf(project)), 'explicit replacement scope participates in snapshot ownership even when the ID is unchanged');
    const applied = commitJarvisResult(project, result, 'Use the selected floor finish.');
    assert.equal(scanSlotShowsDesign(applied, 'flooring'), true); assert.equal(scanSlotShowsDesign(applied, 'walls'), false);
    assert.ok(applied.jarvis!.undo); const undone = undoJarvisChange(applied); assert.deepEqual(appearance(undone), appearance(project));
    const mismatch = { ...result, finishChoices: { flooring: 'different-id' } }; assert.throws(() => commitJarvisResult(project, mismatch, 'Wrong finish'), /does not match/);
    assert.throws(() => commitJarvisResult(project, { ...result, finishChoices: { unknown: 'unknown-id' } }, 'Wrong slot'), /does not match/);
    const batch = createWorkspace(project); success(batch, 'modifyLayout', { operations: [operation('walls', project.selections.walls)] });
    assert.deepEqual(resultFor(project, batch).finishChoices, { walls: project.selections.walls });
    const saved = createWorkspace(project); success(saved, 'createDesignOption', optionArgs('Same material option', [operation('walls', project.selections.walls)]));
    assert.equal(resultFor(project, saved).finishChoices, undefined, 'saving alternatives must not apply their material intents');
  });
  await check('same-ID saved finish intent survives option preview, selection, application and undo', () => {
    const project = fresh(); project.overrides.scanReviewedFinishes = { ...project.selections }; project.overrides.scanAppearanceMode = 'captured';
    const original = JSON.stringify(project), workspace = createWorkspace(project), id = project.selections.walls;
    const { option } = success<{ option: DesignOption }>(workspace, 'createDesignOption', optionArgs('Explicit original paint', [operation('walls', id)]));
    assert.deepEqual(option.finishChoices, { walls: id });
    assert.notEqual(designFingerprint(option.snapshot), designFingerprint(snapshotOf(project)));
    const preview = scanPreviewFinishProject(project, option.snapshot, option.finishChoices);
    assert.equal(scanSlotShowsDesign(preview, 'walls'), true); assert.equal(scanSlotShowsDesign(preview, 'flooring'), false);
    assert.equal(scanSlotShowsDesign(scanPreviewFinishProject(project, option.snapshot, { walls: 'wrong-id', nonexistent: id }), 'walls'), false);
    const saved = commitJarvisResult(project, resultFor(project, workspace), 'Save original paint option');
    assert.equal(scanSlotShowsDesign(saved, 'walls'), false); assert.deepEqual(saved.jarvis!.options[0].finishChoices, { walls: id });
    const applied = applyJarvisOption(saved, option.id); assert.equal(scanSlotShowsDesign(applied, 'walls'), true); assert.equal(scanSlotShowsDesign(applied, 'flooring'), false);
    assert.deepEqual(appearance(undoJarvisChange(applied)), appearance(project));
    const selection = createWorkspace(saved); success(selection, 'selectDesignOption', { optionId: option.id });
    assert.deepEqual(resultFor(saved, selection).finishChoices, { walls: id });
    assert.equal(scanSlotShowsDesign(commitJarvisResult(saved, resultFor(saved, selection), 'Apply option'), 'walls'), true);
    const forged = resultFor(project, workspace); forged.options[0].finishChoices = { walls: 'wrong-id' };
    assert.throws(() => commitJarvisResult(project, forged, 'Mismatch'), /finish choice/);
    assert.equal(JSON.stringify(project), original);
  });
  await check('undo does not erase a subsequent finish-preview edit and legacy undo remains compatible', () => {
    const project = fresh(), workspace = createWorkspace(project); success(workspace, 'changeMaterial', { slot: 'walls', materialId: alternative(project, 'walls') });
    const applied = commitJarvisResult(project, resultFor(project, workspace), 'Change the wall paint.');
    for (const [key, value] of [['scanAppearanceMode', 'captured'], ['scanPreviewSlots', ['flooring']], ['scanReviewedFinishes', {}]] as const) {
      const later = structuredClone(applied); later.overrides[key] = value; const before = JSON.stringify(later);
      assert.throws(() => undoJarvisChange(later), /scan finish preview/); assert.equal(JSON.stringify(later), before);
    }
    const legacy = structuredClone(applied); delete legacy.jarvis!.undo!.appearance;
    assert.deepEqual(undoJarvisChange(legacy).selections, project.selections);
    const sorted = structuredClone(applied); sorted.overrides.scanReviewedFinishes = Object.fromEntries(Object.entries(sorted.overrides.scanReviewedFinishes as object).reverse());
    assert.doesNotThrow(() => undoJarvisChange(sorted), 'dictionary insertion order is not a user edit');
  });
  await check('native unsupported layout edits fail atomically instead of claiming invisible model changes', () => {
    const project = fresh();
    for (const edit of [
      { type: 'cabinet-door-style', style: 'glass' }, { type: 'backsplash-height', heightIn: 32 },
      { type: 'island', lengthFt: 8, widthFt: null, offsetXFt: null, offsetZFt: null, rotationDeg: null, waterfall: true, seating: null },
    ]) {
      const workspace = createWorkspace(project);
      fails(workspace, 'modifyLayout', { operations: [operation('walls', alternative(project, 'walls')), edit] }, 'unsupported-scan-layout');
      fails(workspace, 'createDesignOptions', { options: [optionArgs('First material', [operation('walls', alternative(project, 'walls'))]), optionArgs('Unsupported layout', [edit], true)] }, 'unsupported-scan-layout');
    }
    const resized = executeTool(createWorkspace(project), 'resizeIsland', { lengthFt: 8, widthFt: null, offsetXFt: null, offsetZFt: null }) as { ok: boolean };
    assert.equal(resized.ok, true, 'supported resize edits the derived shape and preserves original capture');
  });
  await check('client commit, saved option application and proposal reject replacement source geometry', () => {
    const project = fresh(), workspace = createWorkspace(project), candidate = resultFor(project, workspace);
    (candidate.working.spec as KitchenSpec).scanGeometry!.objects[0].transform[12] += 0.02;
    const before = JSON.stringify(project); assert.throws(() => commitJarvisResult(project, candidate, 'Forged capture'), /Captured scan geometry changed/);
    const option = optionFor(candidate.working), withOption = { ...project, jarvis: { ...emptyJarvisState(), options: [option] } };
    assert.throws(() => applyJarvisOption(withOption, option.id), /Captured scan geometry changed/);
    assert.throws(() => buildJarvisProposal({ project: withOption, optionIds: [option.id], title: 'Changed source' }), /Captured scan geometry changed/);
    const toolWorkspace = createWorkspace(withOption);
    for (const name of ['selectDesignOption', 'renderPhoto']) fails(toolWorkspace, name, { optionId: option.id }, 'stale-option');
    fails(toolWorkspace, 'generateProposal', { optionIds: [option.id], title: 'Changed source' }, 'stale-option');
    assert.equal(JSON.stringify(project), before);
  });
  await check('historical phantom layout options cannot be applied, committed as new work or rendered', () => {
    const project = fresh(), candidate = snapshotOf(project); (candidate.spec as KitchenSpec).cabinets.doorStyle = 'glass';
    const option = optionFor(candidate), saved = { ...project, jarvis: { ...emptyJarvisState(), options: [option] } };
    assert.throws(() => applyJarvisOption(saved, option.id), /Captured-room changes must use/);
    const workspace = createWorkspace(saved); fails(workspace, 'renderPhoto', { optionId: option.id }, 'stale-option');
    const incoming = resultFor(project, createWorkspace(project)); incoming.options = [option];
    assert.throws(() => commitJarvisResult(project, incoming, 'Add broken option'), /Captured-room changes must use/);
    assert.doesNotThrow(() => commitJarvisResult(saved, resultFor(saved, createWorkspace(saved)), 'What is my estimate?'), 'old saved alternatives must not block an unrelated read-only answer');
  });
  await check('reordered source dictionaries remain acceptable without modifying the saved source values', () => {
    const project = fresh(), workspace = createWorkspace(project), result = resultFor(project, workspace);
    const scan = (result.working.spec as KitchenSpec).scanGeometry!;
    (result.working.spec as KitchenSpec).scanGeometry = Object.fromEntries(Object.entries(scan).reverse()) as typeof scan;
    const applied = commitJarvisResult(project, result, 'Review capture'); assert.deepEqual((applied.spec as KitchenSpec).scanGeometry, (project.spec as KitchenSpec).scanGeometry);
  });
  await check('three-options budget language is recognized, including amount suffixes and strict option phrasing', () => {
    for (const message of ['Give me three options all under $85,000.', 'All options must stay under 85k.', 'Each option should cost less than $85,000.', 'Keep everything under $85,000 and give me three options.', 'Three designs at most $85k.']) {
      const workspace = createWorkspace(fresh(), message); assert.equal(workspace.constraints.budgetMax, 85000, message); assert.equal(workspace.optionsMustFitBudget, true, message);
    }
    assert.equal(createWorkspace(fresh(), 'Save $12k without changing the look.').constraints.budgetMax, null);
  });
  await check('an exploratory flag cannot bypass an explicitly requested ceiling for every option', () => {
    const project = fresh();
    for (const message of ['Give me three options all under $1.', 'All options under $1; do not include over-budget alternatives.']) {
      const workspace = createWorkspace(project, message), expensive = [operation('flooring', alternative(project, 'flooring'))];
      fails(workspace, 'createDesignOption', optionArgs('Expensive', expensive, true), 'over-budget');
      fails(workspace, 'createDesignOptions', { options: [optionArgs('Keep finishes'), optionArgs('Expensive', expensive, true), optionArgs('Keep finishes again')] }, 'over-budget');
    }
    const stretch = createWorkspace(project, 'Budget is $1; include an over-budget comparison option.');
    const { option } = success<{ option: DesignOption }>(stretch, 'createDesignOption', optionArgs('Explicit stretch', [operation('flooring', alternative(project, 'flooring'))], true));
    assert.equal(option.budget.status, 'over'); fails(stretch, 'selectDesignOption', { optionId: option.id }, 'over-budget');
  });
  await check('three feasible native finish alternatives stay under the actual upper estimate limit without changing the live design', () => {
    const project = fresh(), workspace = createWorkspace(project, 'Three options all under $85,000.');
    const options = (['flooring', 'walls', 'ceiling'] as const).map(slot => optionArgs(`${slot} option`, [operation(slot, alternative(project, slot))]));
    const saved = success<{ options: DesignOption[] }>(workspace, 'createDesignOptions', { options }).options;
    assert.equal(saved.length, 3); for (const option of saved) { assert.equal(option.budget.status, 'within'); assert.ok(option.estimate.totalHigh <= 85000); assert.deepEqual((option.snapshot.spec as KitchenSpec).scanGeometry, (project.spec as KitchenSpec).scanGeometry); }
    assert.equal(designFingerprint(workspace.working), designFingerprint(snapshotOf(project))); assert.equal(workspace.activeOptionId, null);
  });
  await check('partial native countertop pricing is explicitly incomplete and cannot queue a complete proposal', () => {
    const project = fresh(), workspace = createWorkspace(project, 'Keep everything under $85k.');
    const { option } = success<{ option: DesignOption }>(workspace, 'createDesignOption', optionArgs('Countertop appearance only', [operation('island_countertop', alternative(project, 'island_countertop'))], true));
    assert.equal(option.budget.status, 'incomplete'); assert.ok(option.estimate.unpriced?.length); assert.equal(option.estimate.quantities.islandTopSqft, 0);
    fails(workspace, 'selectDesignOption', { optionId: option.id }, 'unpriced-scan-work');
    fails(workspace, 'generateProposal', { optionIds: [option.id], title: 'Unverified takeoff' }, 'unpriced-scan-work');
    assert.equal(workspace.proposalRequest, null);
  });
  await check('proposal preparation catches over-budget and duplicate choices before claiming a queued artifact', () => {
    const project = fresh(), workspace = createWorkspace(project);
    const { option } = success<{ option: DesignOption }>(workspace, 'createDesignOption', optionArgs('Floor choice', [operation('flooring', alternative(project, 'flooring'))]));
    fails(workspace, 'generateProposal', { optionIds: [option.id, option.id], title: 'Duplicate' }, 'duplicate-options');
    success(workspace, 'setConstraints', { budgetMax: 1, keepAppliances: null, lockedSlots: null });
    fails(workspace, 'generateProposal', { optionIds: [option.id], title: 'Over budget' }, 'over-budget');
    assert.equal(workspace.proposalRequest, null);
  });
  await check('real render requests report queued work and bind an immutable option without a fabricated image', () => {
    const project = fresh(), workspace = createWorkspace(project);
    const response = success<{ status: string; optionId: string }>(workspace, 'renderPhoto', { optionId: null });
    assert.equal(response.status, 'queued'); assert.equal('url' in response, false); assert.equal('resultUrl' in response, false);
    assert.deepEqual(finishWorkspace(workspace).renderRequests, [{ optionId: response.optionId }]);
    assert.equal(designFingerprint(workspace.options[0].snapshot), designFingerprint(snapshotOf(project)));
  });
  await check('price explanations reconcile native material changes against the actual preceding estimate', () => {
    const project = fresh(), workspace = createWorkspace(project); success(workspace, 'changeMaterial', { slot: 'flooring', materialId: alternative(project, 'flooring') });
    const applied = commitJarvisResult(project, resultFor(project, workspace), 'Change the flooring.');
    const facts = success<{ previousChangeComparison: ReturnType<typeof compareEstimates> }>(createWorkspace(applied, 'Why did the price increase?'), 'getProject', {});
    assert.deepEqual(facts.previousChangeComparison, compareEstimates(estimateSnapshot(snapshotOf(project)), estimateSnapshot(snapshotOf(applied))));
    for (const bound of [facts.previousChangeComparison.low, facts.previousChangeComparison.high]) assert.equal(bound.total, bound.material + bound.labor + bound.contingency + bound.markup + bound.tax + bound.rounding);
    assert.equal(geometry(project), geometry(applied));
  });
  await check('appliance-retention savings are not erased by repricing the preceding design with the new policy', () => {
    const project = fresh(), spec = defaultKitchen(); spec.dims = { widthFt: 20, depthFt: 20, ceilingFt: 9 }; spec.island.offset = { x: 0, z: 0 };
    project.spec = spec; project.selections = { ...spec.materials }; project.baseline = { spec: structuredClone(spec), selections: { ...spec.materials }, capturedAt: project.createdAt, source: 'demo' };
    project.estimateSettings.mode = 'full'; project.estimateSettings.keepExistingAppliances = false;
    const workspace = createWorkspace(project, 'Keep existing appliances.'), applied = commitJarvisResult(project, resultFor(project, workspace), 'Keep existing appliances.');
    const expected = compareEstimates(estimateSnapshot(snapshotOf(project)), estimateSnapshot(snapshotOf(applied)));
    assert.ok(expected.high.total < 0); assert.ok(expected.lines.some(line => line.id === 'appliances' && line.totalHigh < 0));
    const facts = success<{ previousChangeComparison: ReturnType<typeof compareEstimates> }>(createWorkspace(applied), 'getProject', {});
    assert.deepEqual(facts.previousChangeComparison, expected); assert.deepEqual((applied.spec as KitchenSpec).appliances, spec.appliances);
  });
  await check('cancelled native turns discard successful private tool edits without returning a commit', async () => {
    const previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'offline-native-jarvis-test';
    const client = openaiClient(), original = client.responses.create, project = fresh(), before = JSON.stringify(project), controller = new AbortController();
    let rounds = 0;
    client.responses.create = (async () => {
      if (rounds++ === 0) return { status: 'completed', output: [{ type: 'function_call', id: 'fc-floor', call_id: 'floor', name: 'changeMaterial', arguments: JSON.stringify({ slot: 'flooring', materialId: alternative(project, 'flooring') }), status: 'completed' }] };
      controller.abort(); return new Promise(() => {});
    }) as unknown as typeof original;
    try {
      const statuses: string[] = [];
      await assert.rejects(runJarvis({ project, message: 'Change the flooring.', signal: controller.signal, onEvent: event => { if (event.type === 'activity') statuses.push(event.activity.status); } }), error => error instanceof JarvisError && error.code === 'aborted');
      assert.deepEqual(statuses, ['running', 'completed']); assert.equal(rounds, 2); assert.equal(JSON.stringify(project), before);
    } finally { client.responses.create = original; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; }
  });
  console.log(`\n${passed} native Jarvis checks passed.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
