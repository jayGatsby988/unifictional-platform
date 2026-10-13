import type { Estimate, EstimateSettings, Project, ProjectBaseline, RenderJob, RoomSpec } from '@/lib/spec/types';

/** Serializable design state. Photos, client details and job history are never replaced by a tool. */
export interface DesignSnapshot {
  spec: RoomSpec;
  selections: Record<string, string>;
  estimateSettings: EstimateSettings;
  baseline: ProjectBaseline | null;
}

export interface JarvisConstraints {
  budgetMax: number | null;
  keepAppliances: boolean;
  lockedSlots: string[];
}

export interface DesignIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface DesignValidation {
  valid: boolean;
  issues: DesignIssue[];
}

export interface DesignBudget {
  max: number | null;
  /** The high end of the estimated range must fit a hard budget. */
  status: 'not-set' | 'within' | 'over' | 'incomplete';
  headroom: number | null;
}

export interface DesignOption {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  snapshot: DesignSnapshot;
  /** Explicit finish intent, including choosing an existing seed ID. */
  finishChoices?: Record<string, string>;
  estimate: Estimate;
  validation: DesignValidation;
  budget: DesignBudget;
}

export interface JarvisActivity {
  id: string;
  tool: string;
  label: string;
  status: 'running' | 'completed' | 'failed';
  detail?: string;
}

export interface JarvisMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  activities?: JarvisActivity[];
}

export interface JarvisRenderRequest { optionId: string }
export interface JarvisProposalRequest { optionIds: string[]; title: string }
export interface JarvisProposalLink { id: string; url: string; title: string; createdAt: string; optionIds: string[] }

/** Only scan finish presentation belongs to a design undo. Camera position,
 * asset ownership and every other native override remain independently owned. */
export interface ScanAppearanceSnapshot {
  scanReviewedFinishes?: unknown;
  scanAppearanceMode?: unknown;
  scanPreviewSlots?: unknown;
}

export interface JarvisState {
  messages: JarvisMessage[];
  constraints: JarvisConstraints;
  options: DesignOption[];
  activeOptionId: string | null;
  proposals: JarvisProposalLink[];
  undo?: { snapshot: DesignSnapshot; afterFingerprint: string; activeOptionId: string | null; constraints: JarvisConstraints; appearance?: { before: ScanAppearanceSnapshot; after: ScanAppearanceSnapshot } } | null;
}

/** The tool engine returns data, with artifact requests executed after an atomic client commit. */
export interface JarvisResultState {
  working: DesignSnapshot;
  constraints: JarvisConstraints;
  options: DesignOption[];
  activeOptionId: string | null;
  renderRequests: JarvisRenderRequest[];
  proposalRequest: JarvisProposalRequest | null;
  /** Successfully applied material intents, including a deliberate choice of
   * a seeded ID that was not yet displayed on a captured scan. */
  finishChoices?: Record<string, string>;
}

export interface JarvisTurnResult extends JarvisResultState {
  model: 'gpt-6-astra';
  reply: string;
  baseFingerprint: string;
  activities: JarvisActivity[];
}

export type JarvisEvent =
  | { type: 'status'; message: string }
  | { type: 'activity'; activity: JarvisActivity }
  | { type: 'done'; result: JarvisTurnResult }
  | { type: 'error'; error: string; code: string };

export interface JarvisProposal {
  id: string;
  title: string;
  createdAt: string;
  projectId: string;
  projectName: string;
  branding?: Project['branding'];
  client?: Project['client'];
  constraints: JarvisConstraints;
  options: DesignOption[];
  renders: RenderJob[];
  projectLinks: Record<string, string>;
}

export const EMPTY_CONSTRAINTS: JarvisConstraints = { budgetMax: null, keepAppliances: false, lockedSlots: [] };
export const emptyJarvisState = (): JarvisState => ({ messages: [], constraints: { ...EMPTY_CONSTRAINTS, lockedSlots: [] }, options: [], activeOptionId: null, proposals: [], undo: null });

export function snapshotOf(project: Project): DesignSnapshot {
  if (!project.spec) throw new Error('Build a 3D project before asking Jarvis to edit it.');
  return structuredClone({ spec: project.spec, selections: project.selections, estimateSettings: project.estimateSettings, baseline: project.baseline ?? null });
}

/** Canonical state token for optimistic concurrency, never a credential. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function designFingerprint(snapshot: DesignSnapshot): string {
  // Two independent 32-bit accumulators keep this dependency-free in browser and server.
  const source = canonical(snapshot);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < source.length; i++) {
    a = Math.imul(a ^ source.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ source.charCodeAt(i);
  }
  return `${source.length.toString(36)}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
