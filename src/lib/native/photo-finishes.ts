import { z } from 'zod';
import { FinishObservationZ } from '@/lib/spec/schema';
import type { FinishObservation, Project } from '@/lib/spec/types';
import { matchFinish } from '@/lib/materials/match';
import { deltaE } from '@/lib/materials/color';

export const ScanPhotoObservationZ = z.object({
  observation: FinishObservationZ.extend({ slot: z.string().min(1).max(50), description: z.string().max(600) }).strict(),
  confidence: z.enum(['low', 'medium', 'high']),
  photoIds: z.array(z.string().min(1).max(160)).min(1).max(3),
  note: z.string().max(600),
}).strict();
export const ScanPhotoAnalysisZ = z.object({ observations: z.array(ScanPhotoObservationZ).max(20), warnings: z.array(z.string().max(500)).max(12) }).strict();
export type ScanPhotoObservation = z.infer<typeof ScanPhotoObservationZ>;
export type ScanPhotoAnalysis = z.infer<typeof ScanPhotoAnalysisZ>;
export const ScanPhotoFinishSetZ = z.object({ version: z.literal(1), matches: z.array(ScanPhotoObservationZ).max(20) }).strict();

type Context = Pick<Project, 'spec' | 'overrides'>;
/** These photos have no registered pose or physical scale. Sanitizing at read
 * and merge boundaries also protects older saved matches, without rewriting
 * the original document or inventing a calibrated plank/tile direction. */
function unregisteredPhoto(item: ScanPhotoObservation): ScanPhotoObservation {
  return { ...item, observation: { ...item.observation, moduleIn: null, plankRun: null } };
}
function slotCounts(items: ScanPhotoObservation[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.observation.slot, (counts.get(item.observation.slot) ?? 0) + 1);
  return counts;
}
/** Photo appearance is source interpretation, separate from remodel selections
 * and construction quantities. Observations regenerate materials on reopening. */
export function scanPhotoFinishMatches(project: Context): ScanPhotoObservation[] {
  if (!project.spec || !('scanGeometry' in project.spec) || !project.spec.scanGeometry) return [];
  const result = ScanPhotoFinishSetZ.safeParse(project.overrides.scanPhotoFinishes);
  if (!result.success) return [];
  const slots = new Set(Object.keys(project.spec.materials));
  const counts = slotCounts(result.data.matches);
  return result.data.matches.filter(item => {
    const slot = item.observation.slot;
    return slots.has(slot) && counts.get(slot) === 1 && item.confidence !== 'low' && item.observation.visibility !== 'inferred';
  }).map(unregisteredPhoto);
}
export function scanPhotoFinishFor(project: Context, slot: string): { id: string; observation: FinishObservation } | null {
  const item = scanPhotoFinishMatches(project).find(item => item.observation.slot === slot);
  if (!item) return null;
  return { id: matchFinish(item.observation, project.spec!.roomType).id, observation: item.observation };
}

/** A reviewed photo can correct a uniformly wrong captured color. Distinct
 * supported object-face colors still protect a cream island back from a
 * cherry-front match. A single island face cannot establish whole-object
 * uniformity; callers may pass independently observed objectColors for that.
 * This is an appearance safeguard, not verified material identification. */
export function photoFinishAgreesWithFaces(observation: FinishObservation, colors: number[][], options: { objectColors?: number[][] } = {}): boolean {
  const valid = (values: number[][]) => values.length <= 64 && values.every(color => color.length === 3 && color.every(n => Number.isFinite(n) && n >= 0 && n <= 255));
  if (!/^#[\da-f]{6}$/i.test(observation.baseColorHex) || !valid(colors) || (options.objectColors && !valid(options.objectColors))) return false;
  const hex = (color: number[]) => `#${color.map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
  const objectColors = options.objectColors ? [...options.objectColors, ...colors] : colors;
  const objectHex = objectColors.map(hex);
  const mixed = objectHex.some((color, i) => objectHex.slice(i + 1).some(other => deltaE(color, other) > 22));
  const islandCabinet = observation.slot === 'island_cabinets';
  const unscopedIslandFace = islandCabinet && (options.objectColors?.length ?? 0) < 2 && colors.length < 2;
  // No object-wide evidence can safely assign a front-only photo to an unseen
  // island back. Other slots may use the contractor's reviewed appearance.
  if (islandCabinet && !colors.length) return false;
  if (!mixed && !unscopedIslandFace) return true;
  return colors.length > 0 && colors.every(color => deltaE(hex(color), observation.baseColorHex) <= 32);
}
export function mergeScanPhotoFinishes(project: Context, selected: ScanPhotoObservation[]): z.infer<typeof ScanPhotoFinishSetZ> {
  const prior = new Map(scanPhotoFinishMatches(project).map(item => [item.observation.slot, item]));
  if (!project.spec || !('scanGeometry' in project.spec) || !project.spec.scanGeometry || selected.length > 20) return { version: 1, matches: [...prior.values()] };
  const parsed = selected.flatMap(raw => { const result = ScanPhotoObservationZ.safeParse(raw); return result.success ? [result.data] : []; });
  const counts = slotCounts(parsed);
  for (const item of parsed) {
    if (!Object.hasOwn(project.spec?.materials ?? {}, item.observation.slot) || counts.get(item.observation.slot) !== 1
      || item.confidence === 'low' || item.observation.visibility === 'inferred') continue;
    prior.set(item.observation.slot, unregisteredPhoto(item));
  }
  return { version: 1, matches: [...prior.values()].slice(0, 20) };
}

/** Reject provider-created slots, invented photo references and conflicting
 * duplicates. Missing observations stay missing; no default palette is added. */
export function validateScanPhotoAnalysis(raw: unknown, slots: string[], photoIds: string[]): ScanPhotoAnalysis {
  const result = ScanPhotoAnalysisZ.parse(raw);
  const supported = result.observations.filter(item => slots.includes(item.observation.slot)
    && new Set(item.photoIds).size === item.photoIds.length && item.photoIds.every(id => photoIds.includes(id)));
  const counts = slotCounts(supported), duplicates = [...counts].filter(([, count]) => count > 1).map(([slot]) => slot);
  // Keep neither side of a conflict; provider order must not decide whether a
  // mixed cabinet finish becomes white paint or stained wood. Even identical
  // repeats violate the single-observation contract and are omitted safely.
  const observations = supported.filter(item => counts.get(item.observation.slot) === 1).map(unregisteredPhoto);
  const warnings = [...result.warnings];
  if (duplicates.length) warnings.unshift(`Multiple observations disagreed or repeated a surface (${duplicates.join(', ')}). Those surfaces were omitted; use a focused photo to distinguish their finishes.`);
  if (supported.length < result.observations.length) warnings.unshift('Some observations named an unavailable surface or unsupported photo evidence and were omitted.');
  return { observations, warnings: warnings.slice(0, 12).map(warning => warning.slice(0, 500)) };
}
