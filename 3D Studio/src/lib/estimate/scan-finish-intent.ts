import type { EstimateSettings, RoomSpec } from '@/lib/spec/types';

const hasScan = (spec: RoomSpec | null) => Boolean(spec && 'scanGeometry' in spec && spec.scanGeometry);

/** Explicit renovation scope, independent of which appearance is displayed.
 * A RoomPlan baseline's seed ID is not proof of an existing material. */
export function scanReplacementSlots(spec: RoomSpec | null, settings: EstimateSettings, selections: Record<string, string>): Set<string> {
  if (!hasScan(spec)) return new Set();
  return new Set(Object.entries(settings.scanFinishChoices ?? {}).filter(([slot, id]) => Object.hasOwn(spec!.materials, slot) && selections[slot] === id && !(slot === 'appliances' && settings.keepExistingAppliances)).map(([slot]) => slot));
}

/** Only explicit edits create replacement intent. Bulk preservation of a
 * catalog palette does not declare that the contractor reviewed the room. */
export function recordScanEstimateChoices(spec: RoomSpec | null, settings: EstimateSettings, selections: Record<string, string>, explicitSlots: string[] = []): EstimateSettings {
  if (!hasScan(spec)) return settings;
  const choices = Object.fromEntries([...scanReplacementSlots(spec, settings, selections)].map(slot => [slot, selections[slot]]));
  for (const slot of explicitSlots) if (Object.hasOwn(spec!.materials, slot) && selections[slot]) choices[slot] = selections[slot];
  if (!Object.keys(choices).length) return clearScanEstimateChoices(settings);
  return { ...settings, scanFinishChoices: choices };
}

export function clearScanEstimateChoices(settings: EstimateSettings): EstimateSettings {
  if (settings.scanFinishChoices === undefined) return settings;
  const next = { ...settings }; delete next.scanFinishChoices; return next;
}
