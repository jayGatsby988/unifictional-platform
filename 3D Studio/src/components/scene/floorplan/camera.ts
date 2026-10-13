import type { FloorPlanSpec } from '@/lib/spec/types';
import { planBounds } from '@/lib/spec/floorplan';
import { ft } from '@/lib/units';
import type { CameraRig } from '../SceneCanvas';

/** Plan coordinates and floors use the same centre and elevations as the mesh
 * builder. SceneCanvas completes the fit using the actual canvas aspect. */
export function floorPlanRig(spec: FloorPlanSpec, levelIndex: number | null = null): CameraRig {
  const b = planBounds(spec);
  const w = ft(Math.max(4, b.maxX - b.minX)), d = ft(Math.max(4, b.maxY - b.minY));
  const level = spec.levels.find((l) => l.index === levelIndex);
  // Lower floors remain in the scene for context, but inspecting a floor must
  // frame that floor itself rather than shrink it to fit the whole facade.
  const visible = level ? [level] : spec.levels;
  const bounds = level ? planBounds({ ...spec, levels: [{ ...level, stairs: spec.levels.flatMap((sheet) => sheet.stairs).filter((stair) => Math.min(stair.connects.fromLevel, stair.connects.toLevel) === level.index) }] }) : b;
  const originX = (b.minX + b.maxX) / 2, originY = (b.minY + b.maxY) / 2;
  const centerX = ft((bounds.minX + bounds.maxX) / 2 - originX), centerZ = ft(originY - (bounds.minY + bounds.maxY) / 2);
  const bottom = visible.length ? Math.min(...visible.map((l) => l.elevationFt)) : 0;
  let top = visible.length ? Math.max(...visible.map((l) => l.elevationFt + Math.max(l.ceilingFt, ...l.walls.map((w) => w.heightFt ?? l.ceilingFt)))) : 9;
  // A flight owned by the selected floor still rises to the next floor, even
  // when that next shell is hidden. Include its railing and DN-only sheets.
  for (const sheet of spec.levels) for (const stair of sheet.stairs) {
    if (level && Math.min(stair.connects.fromLevel, stair.connects.toLevel) !== level.index) continue;
    const upper = spec.levels.find((l) => l.index === Math.max(stair.connects.fromLevel, stair.connects.toLevel));
    if (upper) top = Math.max(top, upper.elevationFt + 3.5);
  }
  const floor = ft(level?.elevationFt ?? spec.levels[0]?.elevationFt ?? 0);
  const target: [number, number, number] = [centerX, level ? ft(level.elevationFt + level.ceilingFt * 0.18) : ft((bottom + top) / 2), centerZ];
  const span = Math.max(ft(Math.max(4, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)), ft(top - bottom));
  const margin = ft(Math.max(0.5, ...visible.flatMap((l) => l.walls.map((w) => w.thicknessIn / 24 + 0.25))));
  return {
    target,
    // Roughly70° above the selected floor makes its rooms legible through the
    // removed ceiling. The building overview keeps a three-quarter angle.
    position: level ? [target[0] + span * 0.25, target[1] + span * 1.65, target[2] + span * 0.55] : [target[0] + span * 0.65, target[1] + span * 0.9, target[2] + span * 1.15],
    fitBounds: { min: [ft(bounds.minX - originX) - margin, ft(bottom - 1), ft(originY - bounds.maxY) - margin], max: [ft(bounds.maxX - originX) + margin, ft(top + 0.15), ft(originY - bounds.minY) + margin] },
    minDistance: 2,
    maxDistance: span * 3,
    eyeHeight: floor + ft(5.4),
    bounds: { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 },
  };
}
