import { nanoid } from 'nanoid';
import type { Project } from '@/lib/spec/types';
import { assertScanDesign, scanRetainedAppliancesChanged } from '@/lib/native/scan-design';
import { recordScanEstimateChoices } from '@/lib/estimate/scan-finish-intent';
import { calculateEstimate } from '@/lib/estimate/estimator';
import { ensureSpecMaterials } from '@/lib/materials/match';
import { recordScanFinishChoices } from '@/lib/native/scan-finishes';
import { DesignSnapshotZ, JarvisConstraintsZ, DesignOptionZ, JarvisStateZ, JarvisFinishChoicesZ } from './schemas';
import { budgetFor, validateDesign } from './validation';
import { designFingerprint, emptyJarvisState, snapshotOf, type DesignOption, type DesignSnapshot, type JarvisState, type JarvisTurnResult, type ScanAppearanceSnapshot } from './types';

const appearanceKeys = ['scanReviewedFinishes', 'scanAppearanceMode', 'scanPreviewSlots'] as const;
const hasScan = (snapshot: DesignSnapshot) => 'scanGeometry' in snapshot.spec && Boolean(snapshot.spec.scanGeometry);
function sameValue(a: unknown, b: unknown): boolean {
  const stable = (value: unknown) => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([x], [y]) => x.localeCompare(y))) : child);
  return stable(a) === stable(b);
}
function appearanceOf(overrides: Project['overrides']): ScanAppearanceSnapshot {
  return structuredClone(Object.fromEntries(appearanceKeys.filter(key => overrides[key] !== undefined).map(key => [key, overrides[key]])));
}
function appearanceUndo(before: Project, overrides: Project['overrides']) {
  return hasScan(snapshotOf(before)) ? { appearance: { before: appearanceOf(before.overrides), after: appearanceOf(overrides) } } : {};
}

/** The observed-mesh renderer has no editable parametric fixture geometry.
 * A saved option cannot silently replace a capture or change fields it ignores. */
export function assertCapturedLayout(current: DesignSnapshot, candidate: DesignSnapshot) {
  if (!hasScan(current) && !hasScan(candidate)) return;
  const scan = (snapshot: DesignSnapshot) => 'scanGeometry' in snapshot.spec ? snapshot.spec.scanGeometry : undefined;
  if (!sameValue(scan(current), scan(candidate))) throw new Error('Captured scan geometry changed. Rebuild this option from the current scan; original sensor coordinates cannot be replaced.');
  if (candidate.spec.roomType === 'kitchen' || candidate.spec.roomType === 'bathroom') assertScanDesign(candidate.spec);
  const reviewed = (snapshot: DesignSnapshot) => 'scanDesign' in snapshot.spec ? snapshot.spec.scanDesign : undefined;
  const before = reviewed(current), after = reviewed(candidate);
  if (after?.takeoffs.some(item => !before?.takeoffs.some(existing => sameValue(existing, item))) || after?.workAllowances?.some(item => !before?.workAllowances?.some(existing => sameValue(existing, item)))) throw new Error('Reviewed measurements or contractor allowances changed. Refresh this option; Jarvis cannot create or alter site confirmations.');
  const layout = (snapshot: DesignSnapshot) => { const { materials, detected, ...geometry } = snapshot.spec; void materials; void detected; if ('scanDesign' in geometry) delete geometry.scanDesign; return geometry; };
  if (!sameValue(layout(current), layout(candidate))) throw new Error('Captured-room changes must use the supported proposal layer. Original fixture geometry and room structure remain preserved.');
}

export function restoredJarvisState(value: unknown): JarvisState {
  const parsed = JarvisStateZ.safeParse(value);
  if (!parsed.success) return emptyJarvisState();
  const state = structuredClone(value) as JarvisState;
  return { ...state, options: refreshOptionAssessments(state.options, state.constraints) };
}

function readySnapshot(raw: DesignSnapshot, finishChoices?: Record<string, string>): DesignSnapshot {
  const parsed = structuredClone(raw);
  DesignSnapshotZ.parse(parsed);
  parsed.estimateSettings = recordScanEstimateChoices(parsed.spec, parsed.estimateSettings, parsed.selections, Object.entries(finishChoices ?? {}).filter(([slot, id]) => parsed.selections[slot] === id).map(([slot]) => slot));
  DesignSnapshotZ.parse(parsed);
  // Rebuild photo-matched catalog entries in this process without mutating stored observations.
  ensureSpecMaterials(structuredClone(parsed.spec));
  if (parsed.baseline) ensureSpecMaterials(structuredClone(parsed.baseline.spec));
  return parsed;
}

/** Saved price/status caches are derived data, including across price-book
 * changes. Register observed finishes on clones and preserve snapshot identity. */
function refreshOptionAssessments(options: DesignOption[], constraints: JarvisState['constraints']): DesignOption[] {
  return options.map((option) => {
    const snapshot = readySnapshot(option.snapshot, option.finishChoices);
    const estimate = calculateEstimate(snapshot.spec, snapshot.selections, snapshot.estimateSettings, snapshot.baseline);
    return { ...option, snapshot, estimate, validation: validateDesign(snapshot, constraints), budget: budgetFor(estimate, constraints) };
  });
}

function assertApplicable(snapshot: DesignSnapshot, constraints: JarvisState['constraints']) {
  const validation = validateDesign(snapshot, constraints);
  if (!validation.valid) throw new Error(validation.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' '));
  const estimate = calculateEstimate(snapshot.spec, snapshot.selections, snapshot.estimateSettings, snapshot.baseline);
  if (estimate.unpriced?.length && constraints.budgetMax !== null) throw new Error('Scanned material work is unpriced. Complete its measured takeoff and contractor pricing before applying an option against a hard budget.');
  if (budgetFor(estimate, constraints).status === 'over') throw new Error('This design exceeds the budget at the upper end of its estimate. Adjust the design or budget before applying it.');
}

export function assertSnapshotFresh(current: DesignSnapshot, option: DesignSnapshot) {
  if (option.spec.roomType !== current.spec.roomType) throw new Error('That option belongs to another room type.');
  if (designFingerprint({ ...current, baseline: option.baseline }) !== designFingerprint(current)) throw new Error('The existing-room baseline changed after this option was created. Ask Jarvis to rebuild it using the current measurements.');
  if (JSON.stringify(option.spec.detected.measurements ?? null) !== JSON.stringify(current.spec.detected.measurements ?? null)) throw new Error('This option predates your confirmed measurements. Ask Jarvis to update it before applying, rendering or sharing.');
  assertCapturedLayout(current, option);
}

export function commitJarvisResult(project: Project, result: JarvisTurnResult, message: string): Project {
  const before = snapshotOf(project);
  if (result.baseFingerprint !== designFingerprint(before)) throw new Error('The project changed while Jarvis was working. Your edits are safe; send the request again against this version.');
  const working = readySnapshot(result.working);
  if (working.spec.roomType !== project.roomType) throw new Error('Jarvis cannot replace this project with another room type.');
  const constraints = JarvisConstraintsZ.parse(result.constraints);
  const finishChoices = JarvisFinishChoicesZ.parse(result.finishChoices ?? {});
  for (const [slot, id] of Object.entries(finishChoices)) if (!Object.hasOwn(working.spec.materials, slot) || working.selections[slot] !== id) throw new Error('An applied finish choice does not match the final design. No changes were saved.');
  const changed = designFingerprint(working) !== designFingerprint(before);
  const normalizedBefore = readySnapshot(before);
  if (designFingerprint({ ...normalizedBefore, baseline: working.baseline }) !== designFingerprint(normalizedBefore)) throw new Error('Jarvis cannot change the existing-room baseline.');
  assertSnapshotFresh(normalizedBefore, working);
  if (constraints.keepAppliances && (working.spec.roomType === 'kitchen' || working.spec.roomType === 'bathroom') && normalizedBefore.spec.roomType === working.spec.roomType && scanRetainedAppliancesChanged(normalizedBefore.spec, working.spec)) throw new Error('Retained scanned appliances cannot be moved or replaced.');
  const designChanged = designFingerprint({ ...normalizedBefore, spec: working.spec, selections: working.selections }) !== designFingerprint(normalizedBefore);
  // A tighter budget or retention policy can describe an existing design that
  // still needs work. It must not prevent saving the constraint itself.
  const replacementChanged = !sameValue(normalizedBefore.estimateSettings.scanFinishChoices, working.estimateSettings.scanFinishChoices);
  if (designChanged || replacementChanged) assertApplicable(working, constraints);
  const previous = restoredJarvisState(project.jarvis);
  const options = result.options.slice(-12).map((raw) => {
    DesignOptionZ.parse(raw);
    const option = structuredClone(raw);
    const snapshot = readySnapshot(option.snapshot, option.finishChoices);
    for (const [slot, id] of Object.entries(option.finishChoices ?? {})) if (!Object.hasOwn(snapshot.spec.materials, slot) || snapshot.selections[slot] !== id) throw new Error('An option finish choice does not match its saved design. No changes were saved.');
    if (snapshot.spec.roomType !== project.roomType) throw new Error('An option belongs to another room type.');
    const saved = previous.options.find(item => item.id === option.id);
    if (!saved || designFingerprint(saved.snapshot) !== designFingerprint(snapshot)) assertSnapshotFresh(normalizedBefore, snapshot);
    const estimate = calculateEstimate(snapshot.spec, snapshot.selections, snapshot.estimateSettings, snapshot.baseline);
    return { ...option, snapshot, estimate, validation: validateDesign(snapshot, constraints), budget: budgetFor(estimate, constraints) };
  });
  const now = new Date().toISOString();
  const activeOptionId = options.some((o) => o.id === result.activeOptionId && designFingerprint(o.snapshot) === designFingerprint(working)) ? result.activeOptionId : null;
  const overrides = designChanged || Object.keys(finishChoices).length ? recordScanFinishChoices(project, working.selections, Object.keys(finishChoices)) : project.overrides;
  const appearanceChanged = !sameValue(appearanceOf(project.overrides), appearanceOf(overrides));
  return {
    ...project, ...working, overrides, updatedAt: now,
    jarvis: {
      ...previous, constraints, options, activeOptionId,
      messages: [...previous.messages, { id: nanoid(), role: 'user' as const, text: message, createdAt: now }, { id: nanoid(), role: 'assistant' as const, text: result.reply, createdAt: now, activities: result.activities }].slice(-50),
      undo: changed || appearanceChanged ? { snapshot: before, afterFingerprint: designFingerprint(working), activeOptionId: previous.activeOptionId, constraints: previous.constraints, ...appearanceUndo(project, overrides) } : previous.undo,
    },
  };
}

export function applyJarvisOption(project: Project, optionId: string): Project {
  const state = restoredJarvisState(project.jarvis);
  const option = state.options.find((o) => o.id === optionId);
  if (!option) throw new Error('That design option is no longer available.');
  const snapshot = readySnapshot(option.snapshot, option.finishChoices);
  const current = readySnapshot(snapshotOf(project));
  assertSnapshotFresh(current, snapshot);
  for (const slot of state.constraints.lockedSlots) if (snapshot.selections[slot] !== current.selections[slot]) throw new Error(`${slot.replaceAll('_', ' ')} is locked to the current selection.`);
  if (state.constraints.keepAppliances && snapshot.spec.roomType === 'kitchen' && current.spec.roomType === 'kitchen' && (JSON.stringify(snapshot.spec.appliances) !== JSON.stringify(current.spec.appliances) || snapshot.selections.appliances !== current.selections.appliances)) throw new Error('This option changes the appliances you asked to retain.');
  if (state.constraints.keepAppliances && snapshot.spec.roomType === 'kitchen' && current.spec.roomType === 'kitchen' && (current.spec.appliances.some((a) => a.wall === 'island') || current.spec.island.hasCooktop)) {
    const pose = (s: typeof current.spec) => s.roomType === 'kitchen' ? [s.island.present, s.island.kind, s.island.offset, s.island.rotationDeg, s.island.lengthFt, s.island.widthFt, s.island.overhangIn, s.island.endOverhangIn] : null;
    if (JSON.stringify(pose(snapshot.spec)) !== JSON.stringify(pose(current.spec))) throw new Error('This option moves or resizes the island supporting an appliance you asked to retain.');
  }
  if (state.constraints.keepAppliances || snapshot.estimateSettings.keepExistingAppliances !== undefined) snapshot.estimateSettings.keepExistingAppliances = state.constraints.keepAppliances;
  if (state.constraints.keepAppliances && (snapshot.spec.roomType === 'kitchen' || snapshot.spec.roomType === 'bathroom') && current.spec.roomType === snapshot.spec.roomType && scanRetainedAppliancesChanged(current.spec, snapshot.spec)) throw new Error('This option changes a retained scanned appliance or its supporting assembly.');
  assertApplicable(snapshot, state.constraints);
  const before = snapshotOf(project);
  const overrides = recordScanFinishChoices(project, snapshot.selections, Object.keys(option.finishChoices ?? {}));
  let selected = option;
  if (designFingerprint(snapshot) !== designFingerprint(option.snapshot)) {
    if (state.options.length >= 12) throw new Error('Remove an older option to save this option with the current appliance policy.');
    const estimate = calculateEstimate(snapshot.spec, snapshot.selections, snapshot.estimateSettings, snapshot.baseline);
    selected = { ...option, id: `option-${nanoid(12)}`, name: `${option.name} · Updated policy`.slice(0, 120), createdAt: new Date().toISOString(), snapshot, estimate, validation: validateDesign(snapshot, state.constraints), budget: budgetFor(estimate, state.constraints) };
    state.options = [...state.options, selected];
  }
  return {
    ...project, ...snapshot, overrides, updatedAt: new Date().toISOString(),
    jarvis: { ...state, activeOptionId: selected.id, undo: { snapshot: before, afterFingerprint: designFingerprint(snapshot), activeOptionId: state.activeOptionId, constraints: state.constraints, ...appearanceUndo(project, overrides) } },
  };
}

export function removeJarvisOption(project: Project, id: string): Project {
  const state = restoredJarvisState(project.jarvis);
  return { ...project, updatedAt: new Date().toISOString(), jarvis: { ...state, options: state.options.filter((o) => o.id !== id), activeOptionId: state.activeOptionId === id ? null : state.activeOptionId, undo: state.undo ? { ...state.undo, activeOptionId: state.undo.activeOptionId === id ? null : state.undo.activeOptionId } : null } };
}

export function undoJarvisChange(project: Project): Project {
  const state = restoredJarvisState(project.jarvis);
  const undo = state.undo;
  if (!undo) throw new Error('There is no Jarvis design change to undo.');
  if (designFingerprint(snapshotOf(project)) !== undo.afterFingerprint) throw new Error('You edited the design after this change. Undo is paused to preserve those edits.');
  if (undo.appearance && !sameValue(appearanceOf(project.overrides), undo.appearance.after)) throw new Error('You changed the scan finish preview after this change. Undo is paused to preserve those choices.');
  // Undo restores constraints as well as geometry. Saved snapshots stay intact,
  // but their derived eligibility must follow that restored budget/policy.
  const options = refreshOptionAssessments(state.options, undo.constraints);
  const overrides = { ...project.overrides };
  if (undo.appearance) { appearanceKeys.forEach(key => { delete overrides[key]; }); Object.assign(overrides, structuredClone(undo.appearance.before)); }
  return { ...project, ...readySnapshot(undo.snapshot), overrides, updatedAt: new Date().toISOString(), jarvis: { ...state, options, activeOptionId: undo.activeOptionId, constraints: undo.constraints, undo: null } };
}
