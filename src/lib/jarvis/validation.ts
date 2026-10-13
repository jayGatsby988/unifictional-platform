import { scanDesignIssues } from '@/lib/native/scan-design';
import { RoomSpecZ } from '@/lib/spec/schema';
import { computeKitchenLayout } from '@/components/scene/kitchen/layout';
import { computeBathroomLayout, rectOnWall, type Rect } from '@/components/scene/bathroom/layout';
import { computeExteriorLayout } from '@/components/scene/exterior/layout';
import { computeFloorPlanLayout } from '@/components/scene/floorplan/layout';
import { planPolygonArea } from '@/lib/spec/floorplan';
import { ft } from '@/lib/units';
import type { Estimate } from '@/lib/spec/types';
import type { DesignBudget, DesignIssue, DesignSnapshot, DesignValidation, JarvisConstraints } from './types';
import { estimateHasUnpricedWork, scannedWorkScope } from '@/lib/estimate/scan-scope';

export function budgetFor(estimate: Estimate, constraints: JarvisConstraints): DesignBudget {
  const max = constraints.budgetMax;
  if (estimateHasUnpricedWork(estimate)) return { max, status: 'incomplete', headroom: null };
  if (max === null) return { max, status: 'not-set', headroom: null };
  const headroom = max - estimate.totalHigh;
  return { max, status: headroom >= 0 ? 'within' : 'over', headroom };
}
const overlap = (a: Rect, b: Rect, tolerance = 0.01) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > tolerance && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > tolerance;
function gap(a: Rect, b: Rect): number {
  const x = Math.max(0, a.minX - b.maxX, b.minX - a.maxX), z = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  return Math.hypot(x, z);
}
/** Geometry checks describe actual solver output; this is not a permit/code certificate. */
export function validateDesign(snapshot: DesignSnapshot, constraints?: JarvisConstraints): DesignValidation {
  const issues: DesignIssue[] = [];
  const issue = (severity: DesignIssue['severity'], code: string, message: string) => { if (!issues.some((i) => i.code === code && i.message === message)) issues.push({ severity, code, message }); };
  const result = RoomSpecZ.safeParse(snapshot.spec);
  if (!result.success) return { valid: false, issues: result.error.issues.slice(0, 50).map((i) => ({ severity: 'error', code: 'invalid-spec', message: `${i.path.join('.')}: ${i.message}` })) };
  const spec = snapshot.spec;
  for (const work of scannedWorkScope(spec, snapshot.selections, snapshot.estimateSettings, snapshot.baseline).unpriced) {
    issue('warning', 'unpriced-scan-work', `${work.label} · ${work.materialName}: unpriced scanned work. ${work.reason}`);
  }
  if (constraints?.keepAppliances && spec.roomType === 'kitchen' && snapshot.estimateSettings.keepExistingAppliances !== true) issue('error', 'appliance-purchase', 'Retained appliances must have purchase and replacement installation excluded from the estimate.');
  const changed = (label: string, wanted: number, actual: number) => { if (Math.abs(wanted - actual) > ft(0.01)) issue('error', 'geometry-adjusted', `${label}: requested ${(wanted / ft(1)).toFixed(2)} ft but the model draws ${(actual / ft(1)).toFixed(2)} ft. The requested geometry does not fit.`); };
  try {
    if ((spec.roomType === 'kitchen' || spec.roomType === 'bathroom') && spec.scanGeometry) {
      for (const detail of scanDesignIssues(spec)) issue(detail.severity, detail.code, detail.message);
    } else if (spec.roomType === 'kitchen') {
      const L = computeKitchenLayout(spec), island = L.island;
      if (spec.island.present && !island) issue('error', 'island-missing', 'The requested island cannot fit in the actual room.');
      if (spec.island.present && island) {
        changed('Island length', ft(spec.island.lengthFt), island.len); changed('Island width', ft(spec.island.widthFt), island.wide);
        changed('Island X position', ft(spec.island.offset.x), island.cx); changed('Island Z position', ft(spec.island.offset.z), island.cz);
        const obstacles = [...L.runs.map((r) => ({ rect: r.rect, name: `${r.wall} cabinet run` })), ...L.appliances.filter((a) => a.rect && a.wall !== 'island').map((a) => ({ rect: a.rect!, name: a.kind }))];
        for (const obstacle of obstacles) {
          if (overlap(island.rect, obstacle.rect)) issue('error', 'fixture-overlap', `Island overlaps the ${obstacle.name}.`);
          else if (island.kind === 'island' && gap(island.rect, obstacle.rect) < ft(3) - 0.01) issue('error', 'aisle-too-narrow', `Island clearance to ${obstacle.name} is ${(gap(island.rect, obstacle.rect) / ft(1) * 12).toFixed(1)}″; this tool requires at least 36″ clear.`);
          else if (island.kind === 'island' && gap(island.rect, obstacle.rect) < ft(3.5) - 0.01) issue('warning', 'work-aisle', `Clearance to ${obstacle.name} is below a 42″ work-aisle planning target; verify intended use on site.`);
        }
        const edges = [island.rect.minX + L.w / 2, L.w / 2 - island.rect.maxX, island.rect.minZ + L.d / 2, L.d / 2 - island.rect.maxZ];
        if (Math.min(...edges) < -0.01) issue('error', 'room-boundary', 'The island extends outside the actual room.');
        if (island.kind === 'island' && Math.min(...edges) < ft(3) - 0.01) issue('error', 'wall-clearance', 'The island leaves less than 36″ clear to a room boundary.');
        for (const opening of L.openings.filter((o) => o.kind !== 'window')) {
          const length = opening.wall === 'back' || opening.wall === 'front' ? L.w : L.d;
          if (overlap(island.rect, rectOnWall(opening.wall, L.w, L.d, opening.x + length / 2, opening.width, ft(3)))) issue('error', 'door-circulation', `The island obstructs circulation at opening ${opening.id}.`);
        }
      }
      L.decor.warnings.forEach((message) => issue('warning', 'decor-adjusted', message));
      for (const run of spec.runs) if (!L.runs.some((r) => r.id === run.id)) issue('error', 'run-missing', `Cabinet run ${run.id} cannot be placed.`);
    } else if (spec.roomType === 'bathroom') {
      const L = computeBathroomLayout(spec);
      const keys = ['vanity', 'shower', 'tub', 'toilet'] as const;
      for (const key of keys) if (spec[key].present) {
        const piece = L[key];
        if (!piece) { issue('error', 'fixture-missing', `The requested ${key} cannot be placed.`); continue; }
        changed(`${key} width`, piece.wantWidth, piece.width);
        if (piece.displaced > ft(0.01)) issue('error', 'fixture-moved', `The ${key} must move or shrink to clear nearby fixtures.`);
      }
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) { const a = L[keys[i]], b = L[keys[j]]; if (a && b && overlap(a.rect, b.rect)) issue('error', 'fixture-overlap', `${keys[i]} and ${keys[j]} overlap.`); }
      L.decor.warnings.forEach((w) => issue('warning', 'decor-adjusted', w.message));
    } else if (spec.roomType === 'exterior') {
      computeExteriorLayout(spec).warnings.forEach((message) => issue(message.startsWith('Adjusted:') || message.startsWith('Not modeled: the requested') ? 'error' : 'warning', 'site-review', message));
    } else {
      computeFloorPlanLayout(spec).warnings.forEach((message) => issue('warning', 'plan-review', message));
      for (const level of spec.levels) {
        const above = spec.levels.find((l) => l.index === level.index + 1);
        if (above && level.elevationFt + level.ceilingFt > above.elevationFt - 0.25) issue('error', 'floor-overlap', `${level.name} ceiling conflicts with ${above.name}'s floor.`);
        for (const room of level.rooms) if (room.polygon.length < 3 || Math.abs(planPolygonArea(room.polygon)) < 1) issue('error', 'room-polygon', `${room.name} has no usable floor polygon.`);
        for (const opening of [...level.doors, ...level.windows]) {
          const wall = level.walls.find((w) => w.id === opening.wallId);
          if (!wall) { issue('error', 'missing-opening-wall', `Opening ${opening.id} has no supporting wall.`); continue; }
          const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) * 12;
          if (opening.t * length - opening.widthIn / 2 < -0.1 || opening.t * length + opening.widthIn / 2 > length + 0.1) issue('error', 'opening-bounds', `Opening ${opening.id} extends beyond its wall.`);
          if (opening.heightIn + ('sillIn' in opening ? opening.sillIn : 0) > (wall.heightFt ?? level.ceilingFt) * 12) issue('error', 'opening-height', `Opening ${opening.id} exceeds its wall height.`);
        }
      }
    }
  } catch (error) { issue('error', 'geometry-failed', error instanceof Error ? error.message : 'Geometry calculation failed.'); }
  if (!spec.detected.measurements) issue('warning', 'unverified-measurements', 'Dimensions are estimates unless confirmed against the site; these checks do not certify hidden conditions.');
  return { valid: !issues.some((i) => i.severity === 'error'), issues };
}
