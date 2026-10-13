/**
 * The kitchen's single build entry point: layout → parts.
 *
 * Both the renderer (`KitchenScene`) and the headless budget check
 * (`budget.ts`) call this, so what is measured is exactly what is drawn.
 */
import { autoInstance, costOf, type Part, type PartsCost } from './parts';
import { shellParts } from './shell';
import { cabinetParts } from './millwork';
import { counterParts } from './counters';
import { islandParts } from './island';
import { applianceParts } from './appliances';
import { plumbingParts } from './plumbing';
import { stylingParts } from './styling';
import { itemsParts } from './items';
import { contentsParts } from './contents';
import { decorParts } from './decor';
import type { KitchenLayoutData } from './layout';

/** Everything the kitchen draws, already collapsed into instanced groups. */
export function buildKitchenParts(L: KitchenLayoutData): Part[] {
  return autoInstance(buildKitchenPartsRaw(L));
}

/** Same list, un-instanced — useful when diffing what a builder emitted. */
export function buildKitchenPartsRaw(L: KitchenLayoutData): Part[] {
  return [
    ...(L.scanGeometry ? [] : shellParts(L)),
    ...cabinetParts(L),
    ...counterParts(L),
    ...islandParts(L),
    ...applianceParts(L),
    ...plumbingParts(L),
    ...stylingParts(L),
    // items after styling so the canned fallback is visibly REPLACED, not
    // overlaid; contents right behind them, décor last as before
    ...itemsParts(L),
    ...contentsParts(L),
    ...decorParts(L),
  ];
}

export interface KitchenBudget extends PartsCost {
  /** meshes the lighting rig adds (can trims + lenses, pendant shades + cords) */
  lightingDrawCalls: number;
  lightingTriangles: number;
}

/**
 * Measured cost of the whole kitchen. The lighting rig is not part of the part
 * list (it is lights, not geometry the user can re-material), so its meshes are
 * counted here from the same numbers `KitchenLighting` uses.
 */
export function kitchenGeometryBudget(L: KitchenLayoutData): KitchenBudget {
  const parts = costOf(buildKitchenParts(L));
  const cans = Math.max(0, Math.min(40, Math.round(L.lighting.recessed)));
  const pendants = L.lighting.pendants ? Math.max(1, Math.min(6, L.lighting.pendants.count)) : 0;
  const chandelier = L.lighting.chandelier && !L.island ? 1 : 0;
  const strips = L.lighting.underCabinet ? L.runs.reduce((n, r) => n + r.underCab.length, 0) : 0;
  // can = trim + lens; pendant = cord + canopy + socket cap + collar + shade +
  // bulb; strip = 1 mesh. The cap and its collar arrived with the seeded-glass
  // globe, which is the only opaque part of a clear pendant.
  const lightingDrawCalls = cans * 2 + (pendants + chandelier) * 6 + strips;
  // a 24-segment lathe trim is ~110 tris, a lens 24, a 48x32 globe ~3000
  const lightingTriangles = cans * 140 + (pendants + chandelier) * 3400 + strips * 12;
  return {
    ...parts,
    drawCalls: parts.drawCalls + lightingDrawCalls,
    triangles: parts.triangles + lightingTriangles,
    lightingDrawCalls,
    lightingTriangles,
  };
}
