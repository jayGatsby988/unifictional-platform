import { z } from 'zod';
import type { Project, RenderJob } from '@/lib/spec/types';
import { designFingerprint, snapshotOf } from '@/lib/jarvis/types';
import { scanSlotShowsDesign, type ScanFinishProject } from '@/lib/native/scan-finishes';
import { scanPhotoFinishFor, scanPhotoFinishMatches } from '@/lib/native/photo-finishes';

export const isScannedProject = (project: Pick<Project, 'spec'>) => Boolean(project.spec && 'scanGeometry' in project.spec && project.spec.scanGeometry);
export function publicImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4000) return false;
  if (/^\/uploads\/(?:viewport|renders)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp)$/i.test(value) && !value.includes('..')) return true;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
const ScanShareSnapshotZ = z.object({ version: z.literal(1), kind: z.literal('viewport'), imageUrl: z.string().refine(publicImageUrl), capturedAt: z.string().datetime(), designFingerprint: z.string().min(1).max(160), appearanceToken: z.string().max(20000) }).strict();
export type ScanShareSnapshot = z.infer<typeof ScanShareSnapshotZ>;
/** Fingerprint view-only finish intent separately from estimate/design state. */
export function scanShareAppearance(project: ScanFinishProject): string {
  // Only displayed intent affects the image. Empty bookkeeping or a dormant
  // reviewed palette must not make two identical captured views disagree.
  const finishes = Object.fromEntries(Object.keys(project.selections).sort().filter(slot => scanSlotShowsDesign(project, slot)).map(slot => [slot, project.selections[slot]]));
  const photos = Object.fromEntries(scanPhotoFinishMatches(project).filter(item => !scanSlotShowsDesign(project, item.observation.slot))
    .sort((a, b) => a.observation.slot.localeCompare(b.observation.slot))
    .map(item => [item.observation.slot, {
      materialId: scanPhotoFinishFor(project, item.observation.slot)!.id,
      // Different observed colors can resolve to the same catalog ID but
      // enable different faces on a mixed-finish island. That changes the view.
      baseColorHex: item.observation.baseColorHex.toLowerCase(),
    }]));
  return JSON.stringify({ representation: 'clean-reconstruction-v3', mode: Object.keys(finishes).length ? 'design' : 'estimated', finishes, ...(Object.keys(photos).length ? { photoFinishes: photos } : {}) });
}
export function scanShareSnapshot(project: Project): ScanShareSnapshot | null {
  if (!isScannedProject(project) || !project.spec) return null;
  const parsed = ScanShareSnapshotZ.safeParse(project.overrides.sharedScanView);
  if (!parsed.success || parsed.data.designFingerprint !== designFingerprint(snapshotOf(project)) || parsed.data.appearanceToken !== scanShareAppearance(project)) return null;
  return parsed.data;
}
export function scanShareRenders(project: Project): RenderJob[] {
  if (!project.spec) return [];
  const fingerprint = designFingerprint(snapshotOf(project));
  return project.renders.filter(render => render.status === 'completed' && publicImageUrl(render.resultUrl) && render.designFingerprint === fingerprint && (!isScannedProject(project) || render.scanAppearanceToken === scanShareAppearance(project)));
}
export function sharedScanPresentation(project: Project) {
  const snapshot = scanShareSnapshot(project), render = scanShareRenders(project)[0];
  if (snapshot) return { kind: 'snapshot' as const, imageUrl: snapshot.imageUrl, caption: 'Saved image of the scan view', detail: 'This is the view saved by the contractor. The original 3D scan stays on their device; this page contains an image, not an interactive model.' };
  if (render) return { kind: 'render' as const, imageUrl: render.resultUrl!, caption: 'AI-generated design visualization', detail: 'Generated from the saved design. Shapes, colors and details may differ from the captured room. This image does not verify dimensions or existing conditions.' };
  return { kind: 'unavailable' as const, imageUrl: null, caption: 'Scan image not included', detail: 'The original 3D scan is stored on the contractor’s device. Ask them to share a saved scan-view image; this link cannot display the captured shapes and colors.' };
}
/** Client shares do not contain private assistant conversations or native
 * transfer metadata. No captured mesh, camera archive or texture is uploaded. */
export function projectForSharing(project: Project): Project {
  const shared = structuredClone(project); delete shared.jarvis;
  if (isScannedProject(shared)) {
    if (!scanShareSnapshot(shared) && !scanShareRenders(shared).length) throw new Error('Capture a ready scan-view image before creating this link. A project-only link cannot include the original 3D scan.');
    const keys = ['scanAppearanceMode', 'scanPreviewSlots', 'scanReviewedFinishes', 'sharedScanView'];
    const photoMatches = scanPhotoFinishMatches(shared);
    shared.overrides = Object.fromEntries(keys.filter(key => shared.overrides[key] !== undefined).map(key => [key, shared.overrides[key]]));
    if (photoMatches.length) shared.overrides.scanPhotoFinishes = { version: 1, matches: photoMatches };
    if (!scanShareSnapshot(shared)) delete shared.overrides.sharedScanView;
  }
  return shared;
}

/** All asynchronous boundaries recheck caller ownership before publishing.
 * The source project and its local sensor assets are never mutated. */
export async function captureScanShare(project: Project, dependencies: {
  assertCurrent(): void;
  capture(): Promise<Blob | null>;
  upload(blob: Blob, projectId: string, signal: AbortSignal): Promise<string>;
}, signal: AbortSignal): Promise<Project> {
  if (!isScannedProject(project)) throw new Error('A scanned project is required.');
  const current = () => { signal.throwIfAborted(); dependencies.assertCurrent(); };
  current();
  const blob = await dependencies.capture(); current();
  if (!blob || !blob.size || blob.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('The scan view could not be captured. Wait until the model is ready and try again.');
  const imageUrl = await dependencies.upload(blob, project.id, signal); current();
  const snapshot = ScanShareSnapshotZ.parse({ version: 1, kind: 'viewport', imageUrl, capturedAt: new Date().toISOString(), designFingerprint: designFingerprint(snapshotOf(project)), appearanceToken: scanShareAppearance(project) });
  return projectForSharing({ ...project, overrides: { ...project.overrides, sharedScanView: snapshot } });
}
