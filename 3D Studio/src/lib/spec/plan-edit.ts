import type { FloorPlanSpec, PlanPoint, Project } from './types';
import { FloorPlanSpecZ } from './schema';

/** Calibrate a drawing from a measured wall centreline. All plan coordinates
 * share one origin and scale, including upper floors and stair footprints.
 * Heights and printed area labels are independent evidence and remain intact. */
export function calibratePlan(spec: FloorPlanSpec, levelIndex: number, wallId: string, measuredFt: number): FloorPlanSpec {
  const scale = planScale(spec, levelIndex, wallId, measuredFt);
  return scalePlan(spec, scale, `Plan scale confirmed from wall ${wallId}: ${measuredFt.toFixed(3)} ft (centreline); horizontal scale ×${scale.toFixed(4)}.`);
}

function planScale(spec: FloorPlanSpec, levelIndex: number, wallId: string, measuredFt: number): number {
  const wall = spec.levels.find((l) => l.index === levelIndex)?.walls.find((w) => w.id === wallId);
  if (!wall) throw new Error('Select a wall from the drawing first.');
  const before = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
  if (!Number.isFinite(before) || before < 0.1 || !Number.isFinite(measuredFt) || measuredFt < 0.5) throw new Error('Enter a valid measured wall length of at least 6 inches.');
  const scale = measuredFt / before;
  if (scale < 0.25 || scale > 4) throw new Error('This would change the drawing scale by more than 4×. Check the reference wall and units.');
  return scale;
}

function scalePlan(spec: FloorPlanSpec, scale: number, note: string): FloorPlanSpec {
  const point = (p: PlanPoint): PlanPoint => ({ x: p.x * scale, y: p.y * scale });
  const next: FloorPlanSpec = {
    ...spec,
    levels: spec.levels.map((l) => ({ ...l,
      walls: l.walls.map((w) => ({ ...w, x1: w.x1 * scale, y1: w.y1 * scale, x2: w.x2 * scale, y2: w.y2 * scale, thicknessIn: w.thicknessIn * scale })),
      rooms: l.rooms.map((r) => ({ ...r, polygon: r.polygon.map(point) })),
      doors: l.doors.map((d) => ({ ...d, widthIn: d.widthIn * scale })),
      windows: l.windows.map((w) => ({ ...w, widthIn: w.widthIn * scale })),
      stairs: l.stairs.map((s) => ({ ...s,
        footprint: { ...s.footprint, x: s.footprint.x * scale, y: s.footprint.y * scale, widthFt: s.footprint.widthFt * scale, runFt: s.footprint.runFt * scale },
        treadIn: s.treadIn * scale,
        landing: s.landing ? { ...s.landing, widthFt: s.landing.widthFt * scale, depthFt: s.landing.depthFt * scale } : null,
      })),
    })),
    detected: { ...spec.detected, notes: [...spec.detected.notes, note] },
  };
  const parsed = FloorPlanSpecZ.safeParse(next);
  if (!parsed.success) throw new Error(`That scale puts ${parsed.error.issues[0].path.join('.')} outside the supported dimensions. Check the measurement.`);
  return parsed.data;
}

export function calibratePlanProject(project: Project, levelIndex: number, wallId: string, measuredFt: number): Project {
  if (project.spec?.roomType !== 'floorplan') return project;
  const spec = calibratePlan(project.spec, levelIndex, wallId, measuredFt);
  const baseline = project.baseline;
  if (!baseline || baseline.spec.roomType !== 'floorplan') return { ...project, spec };
  // Existing and proposed geometry share the drawing's units. Applying a
  // different factor to each would erase a deliberate change to the measured
  // wall, and skipping a deleted reference would leave the estimate at two
  // different scales. Correct both with the proposal's single scale factor.
  const scale = planScale(project.spec, levelIndex, wallId, measuredFt);
  return { ...project, spec, baseline: { ...baseline, spec: baseline.spec === project.spec ? spec : scalePlan(baseline.spec, scale, `Existing drawing corrected with the same horizontal calibration as the proposed plan: ×${scale.toFixed(4)}.`) } };
}
