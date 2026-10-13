import { z } from 'zod';
import { RoomSpecZ } from '@/lib/spec/schema';
import { REGION_BY_ID } from '@/lib/estimate/pricebook';

const text = z.string().max(4000), id = z.string().min(1).max(160);
const number = z.number().finite();
const map = z.record(z.string().max(160), z.string().max(200));
/** Bound saved documents before geometry, catalog or estimate work begins. */
function bounded(value: unknown, maxNodes = 20000): boolean {
  let nodes = 0;
  const visit = (v: unknown, depth: number): boolean => {
    if (++nodes > maxNodes || depth > 32) return false;
    if (typeof v === 'string') return v.length <= 50000;
    if (Array.isArray(v)) return v.length <= 1000 && v.every((x) => visit(x, depth + 1));
    if (v && typeof v === 'object') return Object.entries(v).length <= 1000 && Object.entries(v).every(([k, x]) => !['__proto__', 'constructor', 'prototype'].includes(k) && visit(x, depth + 1));
    return v == null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
  };
  return visit(value, 0);
}
export const EstimateSettingsZ = z.object({
  region: z.string().refine((v) => !!REGION_BY_ID[v], 'Unknown estimate region'), tier: z.enum(['budget', 'standard', 'premium', 'luxury']),
  contingencyPct: number.min(0).max(0.5), markupPct: number.min(0).max(0.6), scope: z.enum(['cosmetic', 'pull-and-replace', 'full-gut']),
  includePermits: z.boolean(), mode: z.enum(['changes', 'full']), includeKnockOns: z.boolean(), keepExistingAppliances: z.boolean().optional(),
  scanFinishChoices: map.refine(value => Object.keys(value).length <= 80, 'Too many scan finish choices').optional(),
}).strict();
const SpecZ = z.unknown().refine(bounded, 'Design exceeds safe document limits').pipe(RoomSpecZ);
export const ProjectBaselineZ = z.object({ spec: SpecZ, selections: map, capturedAt: z.string().datetime(), source: z.enum(['analysis', 'manual', 'demo', 'migrated']) }).strict();
export const DesignSnapshotZ = z.object({ spec: SpecZ, selections: map, estimateSettings: EstimateSettingsZ, baseline: ProjectBaselineZ.nullable() }).strict().refine(snapshot => Object.entries(snapshot.estimateSettings.scanFinishChoices ?? {}).every(([slot, id]) => Object.hasOwn(snapshot.spec.materials, slot) && snapshot.selections[slot] === id), 'Scan replacement intent does not match the selected finish');
export const JarvisConstraintsZ = z.object({ budgetMax: number.positive().max(100000000).nullable(), keepAppliances: z.boolean(), lockedSlots: z.array(id).max(80) }).strict();
const IssueZ = z.object({ severity: z.enum(['error', 'warning']), code: id, message: text }).strict();
const ValidationZ = z.object({ valid: z.boolean(), issues: z.array(IssueZ).max(500) }).strict();
const BudgetZ = z.object({ max: number.positive().nullable(), status: z.enum(['not-set', 'within', 'over', 'incomplete']), headroom: number.nullable() }).strict();
const totals = { subtotalLow: number, subtotalHigh: number, contingencyLow: number, contingencyHigh: number, markupLow: number, markupHigh: number, taxLow: number, taxHigh: number, totalLow: number, totalHigh: number, mid: number, timelineWeeksLow: number, timelineWeeksHigh: number };
const TotalsZ = z.object(totals).strict();
const LineZ = z.object({ id, category: text, label: text, qty: number, unit: z.enum(['sqft', 'lf', 'each', 'sq', 'ls', 'hr', 'cy']), materialLow: number, materialHigh: number, laborLow: number, laborHigh: number, totalLow: number, totalHigh: number, slot: id.optional(), note: text.optional(), scope: z.enum(['changed', 'added', 'unchanged', 'removed']), baselineQty: number.nullable(), fullTotalLow: number, fullTotalHigh: number, reason: text.optional() }).strict();
const UnpricedWorkZ = z.object({ slot: id, label: text, materialId: z.string().max(200), materialName: text, objectIds: z.array(id).max(512), reason: text }).strict();
export const EstimateZ = z.object({ ...totals, lines: z.array(LineZ).max(1000), salesTaxPct: number, regionMultiplier: number, quantities: z.record(id, number), mode: z.enum(['changes', 'full']), full: TotalsZ, scopeShare: number, changedCount: number, trades: z.object({ demo: z.boolean(), plumbing: z.boolean(), electrical: z.boolean(), drywall: z.boolean() }).strict(), baselineQuantities: z.record(id, number).nullable(), unpriced: z.array(UnpricedWorkZ).max(80).optional(), fullUnpriced: z.array(UnpricedWorkZ).max(80).optional() }).strict();
export const JarvisFinishChoicesZ = map.refine(value => Object.keys(value).length <= 80, 'Too many applied finish choices');
export const DesignOptionZ = z.object({ id, name: z.string().min(1).max(120), description: text, createdAt: z.string().datetime(), snapshot: DesignSnapshotZ, finishChoices: JarvisFinishChoicesZ.optional(), estimate: EstimateZ, validation: ValidationZ, budget: BudgetZ }).strict().refine(option => Object.entries(option.finishChoices ?? {}).every(([slot, selected]) => Object.hasOwn(option.snapshot.spec.materials, slot) && option.snapshot.selections[slot] === selected), 'An option finish choice does not match its saved design');
const ActivityZ = z.object({ id, tool: id, label: text, status: z.enum(['running', 'completed', 'failed']), detail: text.optional() }).strict();
const ScanAppearanceZ = z.object({ scanReviewedFinishes: z.unknown().optional(), scanAppearanceMode: z.unknown().optional(), scanPreviewSlots: z.unknown().optional() }).strict().refine(value => bounded(value, 1000), 'Scan appearance exceeds safe document limits');
export const JarvisStateZ = z.object({
  messages: z.array(z.object({ id, role: z.enum(['user', 'assistant']), text: z.string().max(30000), createdAt: z.string().datetime(), activities: z.array(ActivityZ).max(100).optional() }).strict()).max(100),
  constraints: JarvisConstraintsZ, options: z.array(DesignOptionZ).max(12), activeOptionId: id.nullable(),
  proposals: z.array(z.object({ id, url: z.union([z.string().max(4000).url().regex(/^https?:\/\//), z.string().regex(/^\/proposal\/[a-zA-Z0-9_-]+$/)]), title: text, createdAt: z.string().datetime(), optionIds: z.array(id).max(12) }).strict()).max(30),
  undo: z.object({ snapshot: DesignSnapshotZ, constraints: JarvisConstraintsZ, afterFingerprint: id, activeOptionId: id.nullable(), appearance: z.object({ before: ScanAppearanceZ, after: ScanAppearanceZ }).strict().optional() }).strict().nullable().optional(),
}).strict().superRefine((s, ctx) => {
  const ids = new Set(s.options.map((o) => o.id));
  if (ids.size !== s.options.length) ctx.addIssue({ code: 'custom', message: 'Duplicate option IDs' });
  if (s.activeOptionId && !ids.has(s.activeOptionId)) ctx.addIssue({ code: 'custom', message: 'Active design option is missing' });
});
export const JarvisRenderRequestZ = z.object({ optionId: id }).strict();
export const JarvisProposalRequestZ = z.object({ optionIds: z.array(id).min(1).max(12), title: z.string().min(1).max(160) }).strict();
// Unrelated project metadata is preserved by the atomic client commit, never
// consumed as executable instructions or replaced by the workspace engine.
export const JarvisRequestZ = z.unknown().refine((value) => bounded(value, 200000), 'Request exceeds safe document limits').pipe(z.object({
  project: z.object({ id, name: z.string().max(300), roomType: z.enum(['kitchen', 'bathroom', 'exterior', 'floorplan']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), description: z.string().max(30000), spec: SpecZ, selections: map, baseline: ProjectBaselineZ.nullable(), estimateSettings: EstimateSettingsZ, jarvis: JarvisStateZ.optional(), photos: z.array(z.unknown()).max(40), renders: z.array(z.unknown()).max(100), scans: z.array(z.unknown()).max(100), overrides: z.record(z.string(), z.unknown()), intake: z.unknown().nullable() }).passthrough(),
  message: z.string().trim().min(1).max(12000),
}).strict());
