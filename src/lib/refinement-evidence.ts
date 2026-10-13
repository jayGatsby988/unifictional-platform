import type { RoomSpec } from './spec/types';

export interface RefinementEvidence {
  spec: RoomSpec;
  selections: Record<string, string>;
  viewportUrl: string;
}

const sameSelections = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((slot) => a[slot] === b[slot]);

/** A fitted camera is part of the spec, even when no model correction applied. */
export function evidenceMatches(evidence: RefinementEvidence, spec: RoomSpec, selections: Record<string, string>): boolean {
  return evidence.spec === spec && sameSelections(evidence.selections, selections);
}

/** Bind evidence before async capture/upload. Discard a frame whose scene
 * changed while the canvas was being encoded; later choices cannot relabel it. */
export async function captureRefinementEvidence(input: {
  read: () => { spec: RoomSpec; selections: Record<string, string> };
  alive: () => boolean;
  capture: () => Promise<Blob | null>;
  upload: (shot: Blob) => Promise<string>;
}): Promise<RefinementEvidence | null> {
  if (!input.alive()) return null;
  const before = input.read();
  const evidence = { spec: before.spec, selections: { ...before.selections }, viewportUrl: '' };
  const shot = await input.capture();
  if (!shot || !input.alive()) return null;
  const after = input.read();
  if (!evidenceMatches(evidence, after.spec, after.selections)) return null;
  const viewportUrl = await input.upload(shot);
  return input.alive() ? { ...evidence, viewportUrl } : null;
}

/** Preserve choices present in the screenshot and choices made while the
 * model was answering. Neither may become a new detected finish by accident. */
export function protectedFinishSlots(spec: RoomSpec, atCapture: Record<string, string>, current: Record<string, string>): Set<string> {
  const detected = spec.materials as unknown as Record<string, string>;
  return new Set(Object.keys(detected).filter((slot) =>
    (atCapture[slot] !== undefined && atCapture[slot] !== detected[slot]) || current[slot] !== atCapture[slot]));
}
