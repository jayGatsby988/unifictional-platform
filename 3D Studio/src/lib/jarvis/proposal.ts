import { recordScanEstimateChoices } from '@/lib/estimate/scan-finish-intent';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { Project, RenderJob } from '@/lib/spec/types';
import { calculateEstimate } from '@/lib/estimate/estimator';
import { ensureSpecMaterials } from '@/lib/materials/match';
import { DesignOptionZ, DesignSnapshotZ, JarvisConstraintsZ } from './schemas';
import { assertSnapshotFresh } from './project';
import { budgetFor, validateDesign } from './validation';
import { designFingerprint, type DesignOption, type JarvisProposal } from './types';
import { scanPreviewFinishProject } from '@/lib/native/scan-finishes';
import { isScannedProject, publicImageUrl, scanShareAppearance } from '@/lib/sharing/project';
import { estimateHasUnpricedWork } from '@/lib/estimate/scan-scope';

const BrandingZ = z.object({ company: z.string().max(200), phone: z.string().max(64).optional(), email: z.string().max(200).optional(), logoUrl: z.string().max(4000).optional(), accent: z.string().max(32).optional() });
const RenderZ = z.object({ id: z.string().max(80), provider: z.enum(['openai', 'google', 'higgsfield']), status: z.enum(['queued', 'running', 'completed', 'failed']), createdAt: z.string().max(64), selections: z.record(z.string().max(80), z.string().max(200)), sourceUrl: z.string().max(4000), sourceKind: z.enum(['photo', 'viewport']), prompt: z.string().max(30000), resultUrl: z.string().max(4000).optional(), optionId: z.string().max(80).optional(), designFingerprint: z.string().max(100).optional(), scanAppearanceToken: z.string().max(20000).optional() });

export const ProposalInputZ = z.object({
  project: z.object({
    ...DesignSnapshotZ.shape,
    id: z.string().regex(/^[a-zA-Z0-9_-]{3,80}$/), name: z.string().min(1).max(200),
    branding: BrandingZ.optional(), client: z.object({ name: z.string().max(200).optional(), address: z.string().max(400).optional() }).optional(),
    photos: z.array(z.object({ url: z.string().max(4000), width: z.number().positive().optional(), height: z.number().positive().optional(), primary: z.boolean().optional() })).max(24),
    renders: z.array(RenderZ).max(200),
    overrides: z.object({ scanAppearanceMode: z.enum(['captured', 'design']).optional(), scanPreviewSlots: z.array(z.string().max(80)).max(80).optional(), scanReviewedFinishes: z.record(z.string().max(80), z.string().max(200)).optional() }).default({}),
    jarvis: z.object({ constraints: JarvisConstraintsZ, options: z.array(DesignOptionZ).min(1).max(12) }),
  }),
  optionIds: z.array(z.string().min(1).max(80)).min(1).max(12),
  title: z.string().trim().min(1).max(160),
});

/** Re-price every option on the server. Model text and caller totals are never the proposal's authority. */
export function buildJarvisProposal(raw: unknown): { proposal: JarvisProposal; projects: Project[] } {
  const input = ProposalInputZ.parse(raw);
  const { project } = input;
  // Validation may fill legacy defaults; keep original snapshot identity so a
  // captured render still belongs to the exact immutable option it depicts.
  const originalOptions = (raw as { project: { jarvis: { options: DesignOption[] } } }).project.jarvis.options;
  if (new Set(input.optionIds).size !== input.optionIds.length) throw new Error('Choose each option only once.');
  const constraints = project.jarvis.constraints;
  const options: DesignOption[] = input.optionIds.map((id) => {
    const source = project.jarvis.options.find((o) => o.id === id);
    if (!source) throw new Error('A selected option is no longer available.');
    const snapshot = structuredClone(originalOptions.find((o) => o.id === id)!.snapshot);
    snapshot.estimateSettings = recordScanEstimateChoices(snapshot.spec, snapshot.estimateSettings, snapshot.selections, Object.keys(source.finishChoices ?? {}));
    const current = raw as { project: Project };
    if (!current.project.spec) throw new Error('The current design is missing.');
    assertSnapshotFresh({ spec: current.project.spec, selections: current.project.selections, estimateSettings: current.project.estimateSettings, baseline: current.project.baseline }, snapshot);
    if (constraints.keepAppliances && snapshot.estimateSettings.keepExistingAppliances !== true) throw new Error('Apply this option with the current appliance policy before creating its proposal.');
    ensureSpecMaterials(structuredClone(snapshot.spec));
    if (snapshot.baseline) ensureSpecMaterials(structuredClone(snapshot.baseline.spec));
    const estimate = calculateEstimate(snapshot.spec, snapshot.selections, snapshot.estimateSettings, snapshot.baseline);
    if (estimateHasUnpricedWork(estimate)) throw new Error(`“${source.name}” includes unpriced scanned work: ${estimate.unpriced!.map(item => item.label).join(', ')}. Complete the measured takeoff and contractor pricing before creating a proposal; partial scan coverage cannot establish a full construction quantity.`);
    const validation = validateDesign(snapshot, constraints), budget = budgetFor(estimate, constraints);
    if (!validation.valid) throw new Error(`Resolve the design errors in “${source.name}” before creating its proposal: ${validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join(' ')}`);
    if (budget.status === 'over') throw new Error(`The full estimated range for “${source.name}” exceeds the current budget. Adjust the design or budget before creating its proposal.`);
    return { ...source, snapshot, estimate, validation, budget };
  });
  const id = nanoid(16), now = new Date().toISOString();
  const appearanceFor = (option: DesignOption) => scanPreviewFinishProject(project, option.snapshot, option.finishChoices);
  const renders = project.renders.filter((r) => r.status === 'completed' && publicImageUrl(r.resultUrl) && options.some((o) => o.id === r.optionId && designFingerprint(o.snapshot) === r.designFingerprint && (!isScannedProject(o.snapshot) || r.scanAppearanceToken === scanShareAppearance(appearanceFor(o))))) as RenderJob[];
  const projectLinks: Record<string, string> = {};
  const projects: Project[] = options.map((option, i) => {
    const optionProjectId = `${id}-${i + 1}`;
    projectLinks[option.id] = `/p/${optionProjectId}`;
    return {
      id: optionProjectId, name: `${project.name} · ${option.name}`, roomType: option.snapshot.spec.roomType,
      createdAt: now, updatedAt: now, photos: project.photos, description: option.description,
      // Native option pages deliberately display saved visualizations/details.
      // Local mesh and camera assets do not exist in this shared JSON document.
      ...option.snapshot, overrides: isScannedProject(option.snapshot) ? appearanceFor(option).overrides : {}, intake: null, scans: [],
      renders: renders.filter((r) => r.optionId === option.id), branding: project.branding, client: project.client,
    };
  });
  return { proposal: { id, title: input.title, createdAt: now, projectId: project.id, projectName: project.name, branding: project.branding, client: project.client, constraints, options, renders, projectLinks }, projects };
}
