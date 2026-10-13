/** Explicit native renovation intent; synthetic scans and local store only. */
import assert from 'node:assert/strict';
import sample from './fixtures/native-countertop-contours.sample.json';
import { importNativeScan } from '../src/lib/native/scan-import';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { recordScanEstimateChoices, clearScanEstimateChoices } from '../src/lib/estimate/scan-finish-intent';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { budgetFor } from '../src/lib/jarvis/validation';
import { createWorkspace, executeTool, finishWorkspace } from '../src/lib/jarvis/tools';
import { commitJarvisResult, applyJarvisOption, undoJarvisChange } from '../src/lib/jarvis/project';
import { designFingerprint, snapshotOf, type DesignOption, type JarvisTurnResult } from '../src/lib/jarvis/types';
import { DesignSnapshotZ } from '../src/lib/jarvis/schemas';
import { compareEstimates, findSavings } from '../src/lib/jarvis/savings';
import { useProjectStore } from '../src/lib/store/project-store';
import type { Project } from '../src/lib/spec/types';
const fresh = () => importNativeScan(structuredClone(sample)).project;
const estimate = (project: Project) => calculateEstimate(project.spec, project.selections, project.estimateSettings, project.baseline);
const replace = (project: Project, slot: string, id = project.selections[slot]) => { const selections = { ...project.selections, [slot]: id }; return { ...project, selections, estimateSettings: recordScanEstimateChoices(project.spec, project.estimateSettings, selections, [slot]) }; };
const constraints = { budgetMax: 85000, lockedSlots: [], keepAppliances: false };
function turn(project: Project, workspace: ReturnType<typeof createWorkspace>): JarvisTurnResult { return { ...finishWorkspace(workspace), baseFingerprint: designFingerprint(snapshotOf(project)), model: 'gpt-6-astra', activities: [], reply: 'Synthetic test' }; }
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
check('explicit seed-ID floor and wall replacement use measured quantities and real labor', () => {
  for (const slot of ['flooring', 'walls']) {
    const project = fresh(), before = JSON.stringify(project), replacement = replace(project, slot), e = estimate(replacement), original = estimate(project);
    assert.equal(original.totalHigh, 0); assert.ok(e.totalHigh > 0); assert.ok(e.lines.some(line => line.slot === slot && line.scope === 'changed' && line.materialHigh > 0 && line.laborHigh > 0 && line.reason?.includes('explicit replacement')));
    assert.deepEqual(e.quantities, original.quantities); assert.deepEqual(replacement.spec, project.spec); assert.deepEqual(replacement.baseline, project.baseline); assert.deepEqual(replacement.selections, project.selections);
    assert.notEqual(designFingerprint(snapshotOf(replacement)), designFingerprint(snapshotOf(project))); assert.equal(JSON.stringify(project), before);
    assert.deepEqual(DesignSnapshotZ.parse(snapshotOf(replacement)).estimateSettings.scanFinishChoices, { [slot]: project.selections[slot] });
  }
});
check('native fixture choices remain unpriced, including the body under a partial island top', () => {
  for (const slot of ['cabinets_base', 'island_cabinets', 'island_countertop', 'hardware']) {
    const project = replace(fresh(), slot), e = estimate(project);
    assert.ok(e.unpriced?.some(work => work.slot === slot), slot); assert.equal(e.totalHigh, 0); assert.equal(e.quantities.baseLF, 0); assert.equal(e.quantities.islandTopSqft, 0);
    assert.equal(budgetFor(e, constraints).status, 'incomplete'); assert.ok(e.unpriced!.find(work => work.slot === slot)!.objectIds.length > 0);
    assert.equal(compareEstimates(estimate(fresh()), e).complete, false); assert.throws(() => findSavings(snapshotOf(project), constraints), /unpriced/);
  }
});
check('unknown floor coverage cannot turn explicit flooring replacement into a complete zero estimate', () => {
  const project = fresh(); if (!project.spec || !('scanGeometry' in project.spec)) throw new Error('fixture missing');
  project.spec.scanGeometry!.surfaces = project.spec.scanGeometry!.surfaces.filter(surface => surface.kind !== 'floor');
  if (project.baseline && 'scanGeometry' in project.baseline.spec) project.baseline.spec.scanGeometry = structuredClone(project.spec.scanGeometry);
  const e = estimate(replace(project, 'flooring')); assert.equal(e.quantities.floorSqft, 0); assert.ok(e.unpriced?.some(work => work.slot === 'flooring')); assert.equal(budgetFor(e, constraints).status, 'incomplete');
});
check('dormant legacy reviewed palettes do not become replacement work', () => {
  const project = fresh(); project.overrides.scanReviewedFinishes = { ...project.selections }; project.overrides.scanAppearanceMode = 'design';
  assert.equal(estimate(project).totalHigh, 0); assert.deepEqual(estimate(project).unpriced, []);
  assert.equal(recordScanEstimateChoices(project.spec, project.estimateSettings, project.selections), project.estimateSettings);
  assert.equal(project.estimateSettings.scanFinishChoices, undefined);
});
check('ordinary project estimates and full native scope retain their existing totals', () => {
  const project = fresh(), ordinary = defaultKitchen(), settings = project.estimateSettings;
  assert.equal(recordScanEstimateChoices(ordinary, settings, { ...ordinary.materials }, ['flooring']), settings);
  const normal = calculateEstimate(ordinary, { ...ordinary.materials }, settings), marked = calculateEstimate(ordinary, { ...ordinary.materials }, { ...settings, scanFinishChoices: { flooring: ordinary.materials.flooring } }); assert.deepEqual(marked, normal);
  const full = fresh(); full.estimateSettings.mode = 'full'; assert.equal(estimate(replace(full, 'flooring')).totalHigh, estimate(full).totalHigh);
});
check('invalid or mismatched scope entries cannot manufacture matching replacement work', () => {
  const project = fresh(); project.estimateSettings.scanFinishChoices = { walls: 'wrong-id', nonexistent: 'x' };
  assert.equal(estimate(project).totalHigh, 0); assert.throws(() => DesignSnapshotZ.parse(snapshotOf(project)), /replacement intent/);
  const next = recordScanEstimateChoices(project.spec, project.estimateSettings, project.selections); assert.equal(next.scanFinishChoices, undefined);
});
check('store picker changes, display toggle, bulk preservation and resets keep scope coherent', () => {
  const previous = useProjectStore.getState(), project = fresh(); useProjectStore.setState({ project });
  try {
    useProjectStore.getState().setSelection('flooring', project.selections.flooring); const selected = useProjectStore.getState().project; assert.ok(estimate(selected).totalHigh > 0);
    useProjectStore.getState().setOverride('scanAppearanceMode', 'captured'); assert.deepEqual(useProjectStore.getState().project.estimateSettings.scanFinishChoices, { flooring: project.selections.flooring }); assert.equal(estimate(useProjectStore.getState().project).totalHigh, estimate(selected).totalHigh);
    useProjectStore.getState().setSelections({ ...project.selections }); assert.deepEqual(useProjectStore.getState().project.estimateSettings.scanFinishChoices, selected.estimateSettings.scanFinishChoices);
    useProjectStore.getState().resetSelectionsToDetected(); assert.equal(useProjectStore.getState().project.estimateSettings.scanFinishChoices, undefined); assert.equal(estimate(useProjectStore.getState().project).totalHigh, 0);
    useProjectStore.getState().setSelection('walls', project.selections.walls); useProjectStore.getState().revertToBaseline(); assert.equal(useProjectStore.getState().project.estimateSettings.scanFinishChoices, undefined); assert.equal(estimate(useProjectStore.getState().project).totalHigh, 0);
  } finally { useProjectStore.setState(previous); }
});
check('Jarvis charges explicit native replacement and refuses an underfunded same-ID request atomically', () => {
  const project = fresh(), workspace = createWorkspace(project, 'Budget under $1'); const before = JSON.stringify(workspace);
  const failed = executeTool(workspace, 'changeMaterial', { slot: 'walls', materialId: project.selections.walls }) as { ok: boolean; code: string }; assert.equal(failed.ok, false); assert.equal(failed.code, 'over-budget'); assert.equal(JSON.stringify(workspace), before);
  const fixture = createWorkspace(project, 'Budget under $85000'); const failedFixture = executeTool(fixture, 'changeMaterial', { slot: 'island_cabinets', materialId: project.selections.island_cabinets }) as { ok: boolean; code: string }; assert.equal(failedFixture.ok, false); assert.equal(failedFixture.code, 'unpriced-scan-work');
  const allowed = createWorkspace(project); assert.equal((executeTool(allowed, 'changeMaterial', { slot: 'walls', materialId: project.selections.walls }) as {ok:boolean}).ok, true);
  const applied = commitJarvisResult(project, turn(project, allowed), 'Replace wall paint'); assert.ok(estimate(applied).totalHigh > 0); assert.deepEqual(undoJarvisChange(applied).estimateSettings, project.estimateSettings);
});
check('final budget tightening and client commit recheck same-ID scope even without selection changes', () => {
  const project = fresh(), workspace = createWorkspace(project);
  executeTool(workspace, 'changeMaterial', { slot: 'walls', materialId: project.selections.walls });
  const result = turn(project, workspace); result.constraints.budgetMax = 1;
  assert.throws(() => commitJarvisResult(project, result, 'Explicit replacement'), /budget/);
  executeTool(workspace, 'setConstraints', { budgetMax: 1, keepAppliances: null, lockedSlots: null });
  assert.throws(() => finishWorkspace(workspace), /budget/);
});
check('same-ID option prices, applies and undoes its explicit scope without touching the capture', () => {
  const project = fresh(), workspace = createWorkspace(project);
  const result = executeTool(workspace, 'createDesignOption', { name: 'New wall finish', description: 'Explicit selected seed finish', operations: [{ type: 'material', slot: 'walls', materialId: project.selections.walls }], exploratory: false }) as { ok: boolean; option: DesignOption };
  assert.equal(result.ok, true); assert.ok(result.option.estimate.totalHigh > 0); assert.deepEqual(result.option.snapshot.estimateSettings.scanFinishChoices, { walls: project.selections.walls });
  const saved = commitJarvisResult(project, turn(project, workspace), 'Save paint option'); assert.equal(estimate(saved).totalHigh, 0);
  const applied = applyJarvisOption(saved, result.option.id); assert.equal(estimate(applied).totalHigh, result.option.estimate.totalHigh); assert.deepEqual(applied.spec, project.spec); assert.deepEqual(applied.baseline, project.baseline);
  assert.deepEqual(undoJarvisChange(applied).estimateSettings, project.estimateSettings);
});
check('returning to the seed material retains replacement scope instead of claiming the work disappears', () => {
  const original = fresh(), changed = replace(original, 'flooring', 'floor-walnut'), returned = replace(changed, 'flooring', original.selections.flooring);
  assert.ok(estimate(returned).totalHigh > 0); assert.deepEqual(returned.estimateSettings.scanFinishChoices, { flooring: original.selections.flooring });
  assert.equal(estimate({ ...returned, estimateSettings: clearScanEstimateChoices(returned.estimateSettings) }).totalHigh, 0);
});
console.log(`\n${passed} scan finish-estimate checks passed.`);
