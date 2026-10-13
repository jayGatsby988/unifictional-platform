/**
 * What the house costs the GPU — MEASURED, not modelled.
 *
 * The kitchen and the exterior estimate their budgets from their layouts
 * because their builders are React. This one does not have to: `layout.ts` and
 * `parts.ts` are pure, so the same call the scene makes runs here and the
 * triangles are counted off the buffers themselves. A model can drift from the
 * builder; this cannot.
 */
import { triangleCount } from '@/components/scene/detail';
import type { FloorPlanSpec } from '@/lib/spec/types';
import { computeFloorPlanLayout } from './layout';
import { levelParts } from './parts';

export interface FloorPlanBudget {
  drawCalls: number;
  triangles: number;
  /** merged buffers, before instancing */
  meshes: number;
  instanced: number;
  balusters: number;
  lightingDrawCalls: number;
  perLevel: Array<{ level: number; calls: number; tris: number }>;
}

/**
 * `ceiling` matches the scene: the top storey's ceiling is drawn only in walk
 * mode, so the WORST case (walking) is what the budget has to hold.
 */
export function floorPlanBudget(spec: FloorPlanSpec): FloorPlanBudget {
  const L = computeFloorPlanLayout(spec);
  let calls = 0, tris = 0, meshes = 0, instanced = 0, balusters = 0;
  const perLevel: FloorPlanBudget['perLevel'] = [];

  for (const level of L.levels) {
    const parts = levelParts(level, { ceiling: true });
    let lc = 0, lt = 0;
    const solid = [parts.walls, parts.ceiling, parts.trim, parts.doors, parts.glass, parts.treads, parts.railing];
    for (const g of solid) {
      if (!g) continue;
      lc++; lt += triangleCount(g); g.dispose();
    }
    for (const f of parts.floors) { lc++; lt += triangleCount(f.geometry); f.geometry.dispose(); }
    if (parts.balusters) {
      // one InstancedMesh however many spindles: one draw call, every
      // instance's triangles
      lc++; instanced++;
      balusters += parts.balusters.transforms.length;
      lt += triangleCount(parts.balusters.geometry) * parts.balusters.transforms.length;
    }
    meshes += lc;
    calls += lc; tris += lt;
    perLevel.push({ level: level.index, calls: lc, tris: lt });
  }

  // the practicals draw their own hardware: a can is a trim ring plus a lens
  const cans = L.levels.reduce((n, l) => n + l.lights.filter((x) => x.kind === 'can').length, 0);
  const lightingDrawCalls = Math.min(12, cans) * 2;
  return { drawCalls: calls + lightingDrawCalls, triangles: tris, meshes, instanced, balusters, lightingDrawCalls, perLevel };
}
