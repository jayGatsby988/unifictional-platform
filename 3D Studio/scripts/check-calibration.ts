/** Regression checks for human measurements, baseline accounting and drawing scale. */
import assert from 'node:assert/strict';
import { defaultKitchen, defaultFloorPlan, defaultBathroom } from '../src/lib/spec/defaults';
import { emptyProject, useProjectStore } from '../src/lib/store/project-store';
import { applyMeasurements, confirmedDimensions, measureProject, parseMeasurement, releaseInconsistentMeasurements } from '../src/lib/spec/measurements';
import { calibratePlan, calibratePlanProject } from '../src/lib/spec/plan-edit';
import { planPolygonArea } from '../src/lib/spec/floorplan';
import { RoomSpecZ } from '../src/lib/spec/schema';

const now = '2026-09-09T12:00:00.000Z';
for (const [input, expected] of [["12' 6\"", 12.5], ['12.5 ft', 12.5], ['150 in', 12.5], ['381 cm', 12.5], ['3810 mm', 12.5], ['3.81 m', 12.5], ['12′ 6″', 12.5], ['.5', 0.5]] as const) {
  assert.ok(Math.abs((parseMeasurement(input) ?? 0) - expected) < 1e-9, input);
}
for (const input of ['12 rubbish', "12' 14\"", '12x6', 'NaN', '-8', '0', '', '12,6', 'Infinity', '12 ft 3 cm']) assert.equal(parseMeasurement(input), null, input);

const source = defaultKitchen(), original = JSON.stringify(source);
const measured = applyMeasurements(source, { widthFt: 14.25, ceilingFt: 9.125 }, now);
assert.deepEqual(confirmedDimensions(measured), { widthFt: 14.25, ceilingFt: 9.125 });
assert.equal(measured.dims.depthFt, source.dims.depthFt);
assert.equal(JSON.stringify(source), original, 'confirmation never mutates source');
assert.ok(RoomSpecZ.safeParse(measured).success, 'confirmed spec accepted by API contract');
const unlocked = releaseInconsistentMeasurements({ ...measured, dims: { ...measured.dims, widthFt: 15 } });
assert.deepEqual(confirmedDimensions(unlocked), { ceilingFt: 9.125 }, 'manual dimension edits release only that axis');
assert.deepEqual(confirmedDimensions({ ...measured, dims: { ...measured.dims, widthFt: 15 } }), { widthFt: 14.25, ceilingFt: 9.125 }, 'optimizer candidates cannot silently discard a lock');
assert.throws(() => applyMeasurements(source, { widthFt: NaN }, now));
assert.throws(() => applyMeasurements(source, { ceilingFt: 6 }, now));
assert.deepEqual(confirmedDimensions(defaultBathroom()), {});
const old = JSON.parse(JSON.stringify(source));
delete old.detected.measurements;
assert.ok(RoomSpecZ.safeParse(old).success, 'old projects require no destructive migration');

const project = { ...emptyProject(), spec: source, baseline: { source: 'analysis' as const, spec: source, selections: { ...source.materials }, capturedAt: now } };
const calibrated = measureProject(project, { widthFt: 17 }, now);
assert.equal(calibrated.baseline?.spec, calibrated.spec, 'following analysis keeps a shared as-found baseline');
const designed = { ...project, spec: { ...source, island: { ...source.island, lengthFt: 8 } }, selections: { ...source.materials, countertop: 'counter-quartz-calacatta' } };
const corrected = measureProject(designed, { depthFt: 15 }, now);
assert.equal(corrected.spec?.roomType === 'kitchen' && corrected.spec.island.lengthFt, 8);
assert.equal(corrected.baseline?.spec.roomType === 'kitchen' && corrected.baseline.spec.island.lengthFt, 7, 'design choices stay separate from existing room correction');
assert.equal(corrected.selections, designed.selections, 'hand-picked finishes preserved');
assert.equal(corrected.baseline?.spec.roomType === 'kitchen' && corrected.baseline.spec.dims.depthFt, 15, 'baseline quantities follow measured existing room');

useProjectStore.getState().loadProject(project);
useProjectStore.getState().confirmMeasurements({ widthFt: 18 });
useProjectStore.getState().patchSpec((s) => s.roomType === 'kitchen' ? { ...s, dims: { ...s.dims, widthFt: 19 } } : s);
assert.equal(confirmedDimensions(useProjectStore.getState().project.spec!).widthFt, undefined, 'store structural controls release dimension locks');

const plan = defaultFloorPlan(), planBefore = JSON.stringify(plan);
const ref = plan.levels[0].walls[0], length = Math.hypot(ref.x2 - ref.x1, ref.y2 - ref.y1);
const next = calibratePlan(plan, 0, ref.id, length * 1.05);
for (let i = 0; i < plan.levels.length; i++) {
  const a = plan.levels[i], b = next.levels[i];
  assert.equal(a.ceilingFt, b.ceilingFt, 'horizontal calibration preserves heights');
  assert.equal(a.elevationFt, b.elevationFt, 'floor elevations preserved');
  assert.equal(a.rooms[0].areaSqft, b.rooms[0].areaSqft, 'printed area is independent evidence');
  assert.ok(Math.abs(planPolygonArea(b.rooms[0].polygon) / planPolygonArea(a.rooms[0].polygon) - 1.05 ** 2) < 1e-8, 'all floor areas use squared linear scale');
  for (let n = 0; n < a.doors.length; n++) {
    assert.equal(b.doors[n].wallId, a.doors[n].wallId);
    assert.equal(b.doors[n].t, a.doors[n].t);
    assert.equal(b.doors[n].widthIn, a.doors[n].widthIn * 1.05);
  }
}
assert.equal(JSON.stringify(plan), planBefore);
const planProject = { ...emptyProject('floorplan'), spec: plan, baseline: { source: 'demo' as const, spec: plan, selections: { ...plan.materials }, capturedAt: now } };
const scaledProject = calibratePlanProject(planProject, 0, ref.id, length * 1.05);
assert.equal(scaledProject.spec, scaledProject.baseline?.spec, 'measured plan scale corrects as-found quantities, not a chargeable remodel');
const remodeled = structuredClone(plan);
const changedWall = remodeled.levels[0].walls[0];
changedWall.x2 = changedWall.x1 + (ref.x2 - ref.x1) * 0.8;
changedWall.y2 = changedWall.y1 + (ref.y2 - ref.y1) * 0.8;
const correctedRemodel = calibratePlanProject({ ...planProject, spec: remodeled }, 0, ref.id, length * 0.8 * 1.05);
assert.ok(correctedRemodel.spec?.roomType === 'floorplan' && correctedRemodel.baseline?.spec.roomType === 'floorplan');
const newWall = correctedRemodel.spec.levels[0].walls[0], existingWall = correctedRemodel.baseline.spec.levels[0].walls[0];
const wallLength = (w: typeof ref) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
assert.ok(Math.abs(wallLength(existingWall) - length * 1.05) < 1e-8, 'existing drawing receives the same scale factor');
assert.ok(Math.abs(wallLength(newWall) / wallLength(existingWall) - 0.8) < 1e-8, 'calibration preserves the designed wall-length delta');
const missingReference = structuredClone(plan);
missingReference.levels[0].walls[0].id = 'old-wall-reference';
const correctedMissing = calibratePlanProject({ ...planProject, baseline: { ...planProject.baseline, spec: missingReference } }, 0, ref.id, length * 1.05);
assert.ok(correctedMissing.baseline?.spec.roomType === 'floorplan');
assert.ok(Math.abs(wallLength(correctedMissing.baseline.spec.levels[0].walls[0]) - length * 1.05) < 1e-8, 'a replaced reference wall cannot leave the existing drawing at a different scale');
assert.throws(() => calibratePlan(plan, 0, 'missing', 30));
assert.throws(() => calibratePlan(plan, 0, ref.id, Infinity));
assert.throws(() => calibratePlan(plan, 0, ref.id, length * 5));
console.log('Calibration: measurement parsing, axis locks, old projects, baseline accounting, and multi-floor scale checks passed.');
