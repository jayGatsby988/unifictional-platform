import type { Project } from '@/lib/spec/types';

/** Finish display policy only. It never rewrites scan geometry, selections,
 * the original baseline, or the quantities used by the estimator. */
export type ScanFinishProject = Pick<Project, 'spec' | 'selections' | 'baseline' | 'overrides'>;
export type ScanSlotFinish =
  | { kind: 'catalog'; reason: 'not-scanned' | 'chosen' | 'changed' | 'observed' }
  | { kind: 'neutral'; reason: 'source-geometry' | 'not-captured'; color: string };

const hasScan = (project: Pick<ScanFinishProject, 'spec'>) => Boolean(project.spec && 'scanGeometry' in project.spec && project.spec.scanGeometry);

/** A restrained geometry-view palette, not an estimate of the room's colors. */
export function neutralScanColor(slot: string): string {
  if (['flooring', 'floor_tile', 'shower_floor_tile'].includes(slot)) return '#929795';
  if (['walls', 'ceiling', 'wall_tile', 'shower_wall_tile', 'backsplash'].includes(slot)) return '#dedfdb';
  if (['countertop', 'island_countertop', 'vanity_top'].includes(slot)) return '#cdd2cf';
  if (['hardware', 'faucet', 'fixtures'].includes(slot)) return '#7c8581';
  return '#b5bdb8';
}

function reviewedFinishes(project: Pick<ScanFinishProject, 'overrides'>): Record<string, string> {
  const value = project.overrides.scanReviewedFinishes;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** RoomPlan has no captured finish channel. A baseline's default catalog ID
 * is not evidence that the room has that finish. Source mode deliberately
 * shows only neutral geometry even after a material change or photo review. */
export function scanSlotFinish(project: ScanFinishProject, slot: string, mode: 'model' | 'source' = 'model'): ScanSlotFinish {
  if (!hasScan(project) || slot === '__unused__') return { kind: 'catalog', reason: 'not-scanned' };
  if (mode === 'source') return { kind: 'neutral', reason: 'source-geometry', color: neutralScanColor(slot) };
  const selected = project.selections[slot];
  if (selected && reviewedFinishes(project)[slot] === selected) return { kind: 'catalog', reason: 'chosen' };
  const original = project.baseline?.selections[slot] ?? (project.spec?.materials as Record<string, string> | undefined)?.[slot];
  if (selected && original && selected !== original) return { kind: 'catalog', reason: 'changed' };
  const observed = project.spec?.detected.finishes.some(finish => finish.slot === slot && ['clear', 'partial'].includes(finish.visibility));
  if (selected && observed && (project.spec?.materials as Record<string, string> | undefined)?.[slot] === selected) return { kind: 'catalog', reason: 'observed' };
  return { kind: 'neutral', reason: 'not-captured', color: neutralScanColor(slot) };
}

/** Single-picker calls pass their slot explicitly, including an intentional
 * choice of the starting ID. Bulk reconciliation only marks changed fields:
 * automated preservation of a whole selection map is not a finish review. */
export function recordScanFinishChoices(project: ScanFinishProject, selections: Record<string, string>, explicitSlots: string[] = []): Project['overrides'] {
  if (!hasScan(project)) return project.overrides;
  const reviewed = Object.fromEntries(Object.entries(reviewedFinishes(project)).filter(([slot, id]) => selections[slot] === id));
  const explicit = new Set(explicitSlots);
  const chosen: string[] = [];
  for (const [slot, id] of Object.entries(selections)) {
    if (id && (explicit.has(slot) || project.selections[slot] !== id)) { reviewed[slot] = id; chosen.push(slot); }
  }
  const overrides = { ...project.overrides, scanReviewedFinishes: reviewed };
  if (!chosen.length) return overrides;
  // A new edit changes only requested surfaces. Old reviewed palettes must
  // not replace camera appearance across the room when one slot is changed.
  const previousMask = project.overrides.scanPreviewSlots;
  const explicitAll = project.overrides.scanAppearanceMode === 'design' && previousMask === undefined;
  return { ...overrides, scanAppearanceMode: 'design', ...(explicitAll ? {} : {
    scanPreviewSlots: [...new Set([...(project.overrides.scanAppearanceMode === 'design' && Array.isArray(previousMask) ? previousMask.filter((s): s is string => typeof s === 'string') : []), ...chosen])],
  }) };
}

/** Camera appearance is the default, including for legacy saved palettes.
 * An absent mask in explicit design mode means the user chose the whole palette. */
export function scanSlotShowsDesign(project: ScanFinishProject, slot: string): boolean {
  if (project.overrides.scanAppearanceMode !== 'design' || scanSlotFinish(project, slot).kind !== 'catalog') return false;
  const mask = project.overrides.scanPreviewSlots;
  return mask === undefined || (Array.isArray(mask) && mask.includes(slot));
}

/** A staged option can show its changed finishes without committing selections
 * or overwriting the camera appearance behind the preview. */
export function scanPreviewFinishProject(project: ScanFinishProject, preview?: Omit<ScanFinishProject, 'overrides'> | null, finishChoices?: Record<string, string>): ScanFinishProject {
  if (!preview) return project;
  const explicit = Object.entries(finishChoices ?? {}).filter(([slot, id]) => Object.hasOwn(preview.spec?.materials ?? {}, slot) && preview.selections[slot] === id).map(([slot]) => slot);
  return { ...preview, overrides: recordScanFinishChoices(project, preview.selections, explicit) };
}

/** UI labels follow the surface being drawn, not a dormant catalog selection. */
export function scanSlotUsesCapturedAppearance(project: ScanFinishProject, slot: string, mode: 'model' | 'source', hasMesh: boolean): boolean {
  return hasMesh && hasScan(project) && (mode === 'source' || !scanSlotShowsDesign(project, slot));
}

export function clearScanFinishChoices(project: ScanFinishProject): Project['overrides'] {
  if (!hasScan(project)) return project.overrides;
  const overrides = { ...project.overrides };
  delete overrides.scanReviewedFinishes;
  delete overrides.scanAppearanceMode;
  delete overrides.scanPreviewSlots;
  return overrides;
}
