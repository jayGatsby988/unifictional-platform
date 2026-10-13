'use client';
/**
 * The photo → spec pipeline: prepare + upload photos, stream the analyzer's
 * NDJSON events into the store, then hand the spec to the 3D engine — and,
 * once the twin is on screen, fit it to the photo's pixel inventory, check it
 * against the photo with a vision model, and correct it.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ApiError, analyzeRoom, coverageOf, fitProportionsOf, fitScoreOf, fitTwin, measuredGapsFor, refineTwin, residualsOf, runMatchLoop, specToAdopt, uploadPhotos, uploadViewport, type CorrectionRecord, type FitResidual, type FitResponse, type MatchLoopDriver, type MatchLoopResult, type RefineResponse } from '@/lib/api-client';
import { preloadSelections } from '@/components/scene/materials';
import { captureViewport } from '@/components/scene/SceneCanvas';
import { useProjectStore } from '@/lib/store/project-store';
import { ensureSpecMaterials, healSelections } from '@/lib/materials/match';
import { captureRefinementEvidence, evidenceMatches, protectedFinishSlots, type RefinementEvidence } from '@/lib/refinement-evidence';
import { isSingleRoom } from '@/lib/spec/floorplan';
import { HOUSE_TEMPLATES, defaultExterior, defaultSpec } from '@/lib/spec/defaults';
import { intakeFromAnalysis } from '@/lib/spec/intake';
import type { BaselineSource, ExteriorSpec, Photo, RoomSpec, RoomType } from '@/lib/spec/types';
import { openInterview } from './Interview';
import { requestUnlock } from './UnlockModal';
import { shouldOpenInterview } from './interviewFlow';
import { prepareImageForUpload } from './imageUtils';
import { photoSizeOf, requestResetView } from './photoMatch';
import { errorMessage } from './hooks';

export interface IntakeSubmission {
  /** ordered photos; index `primaryIndex` is the hero shot */
  files: File[];
  primaryIndex: number;
  description: string;
  /** object URL of the hero shot, used for the blurred backdrop while analysing */
  previewUrl?: string | null;
  /** exterior only: the lot is empty → place a template house */
  emptyLot?: boolean;
  houseTemplate?: ExteriorSpec['houseStyle'] | null;
}

export const DEMO_PHOTOS: Record<RoomType, Photo[]> = {
  kitchen: [{ url: '/demo/kitchen-before.jpg', primary: true }],
  bathroom: [],
  exterior: [],
  floorplan: [],
};

export const DEMO_NAMES: Record<RoomType, string> = {
  kitchen: 'Demo kitchen',
  bathroom: 'Demo bathroom',
  exterior: 'Demo lot & exterior',
  floorplan: 'Demo floor plan',
};

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const normalizeProgress = (p: unknown) => {
  const n = typeof p === 'number' && Number.isFinite(p) ? p : 0;
  return clamp01(n > 1 ? n / 100 : n);
};

const PHASE_LABEL: Record<string, string> = {
  upload: 'Uploading photos',
  uploading: 'Uploading photos',
  vision: 'Reading the room',
  analyze: 'Analyzing the photos',
  analyzing: 'Analyzing the photos',
  measure: 'Measuring the room',
  materials: 'Identifying materials',
  validate: 'Checking the reconstruction',
  spec: 'Assembling the spec',
  done: 'Analysis complete',
};

// ---------------------------------------------------------------------------
// Accuracy report — what the background pass did, for the HUD and the
// assumptions list. Lives outside the persisted store on purpose: it is
// per-session diagnostics, not project data, and the badge needs more than the
// store's running/applied/clean flag can say (rounds, finishes matched).
// ---------------------------------------------------------------------------

export interface AccuracyReport {
  status: 'idle' | 'running' | 'done';
  /** counts passes started this session, so the badge can tell a second pass from a re-render of the first */
  pass: number;
  /** what the pass is doing right now */
  phase: 'geometry' | 'finishes' | null;
  /** the geometry round in progress (1-based), 0 before the first */
  round: number;
  /** geometry rounds completed */
  rounds: number;
  /** the best fit score so far (mean IoU against the photo's boxes); null when the photo has no inventory */
  score: number | null;
  /** how the match loop ended */
  stoppedBy: MatchLoopResult['stoppedBy'] | null;
  /** every round's score and whether its result was kept */
  history: MatchLoopResult['history'];
  /** geometry edits applied across all rounds */
  applied: number;
  /** material slots whose finish was re-matched to the photo */
  finishes: number;
  /** the model's last 0..1 match estimate */
  match: number;
  corrections: CorrectionRecord[];
  notes: string[];
}

const EMPTY_REPORT: AccuracyReport = { status: 'idle', pass: 0, phase: null, round: 0, rounds: 0, score: null, stoppedBy: null, history: [], applied: 0, finishes: 0, match: 0, corrections: [], notes: [] };
let report: AccuracyReport = EMPTY_REPORT;
const listeners = new Set<() => void>();
function publishReport(patch: Partial<AccuracyReport>) {
  report = { ...report, ...patch };
  for (const l of listeners) l();
}
const subscribeReport = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The latest accuracy-pass report; re-renders as the pass progresses. */
export function useAccuracyReport(): AccuracyReport {
  return useSyncExternalStore(subscribeReport, () => report, () => EMPTY_REPORT);
}

// ---------------------------------------------------------------------------
// Fit report — the last fit's element-by-element result, for the match
// report the contractor opens. Written by every fit and every adopted refine
// round; per-session like the accuracy report (the store keeps only the
// score, which is all the chips need).
// ---------------------------------------------------------------------------

export interface FitReport {
  projectId: string | null;
  /**
   * The spec object the gaps were measured on — the one adopted into the
   * store with them. A correction round reuses the residuals only while the
   * store still holds this very object; after an edit they describe a twin
   * that is gone.
   */
  spec: RoomSpec | null;
  /** mean IoU, 0..1; null when nothing matched */
  score: number | null;
  /** how well the twin's PROPORTIONS match the photo, 0..1; null when unscored */
  proportions: number | null;
  /** matched photo elements ÷ scored photo elements */
  coverage: number | null;
  residuals: FitResidual[];
  /** photo elements the twin does not draw, in words */
  hints: string[];
  unmatchedPhoto: NonNullable<FitResponse['unmatchedPhoto']>;
  /** which step wrote it */
  source: 'fit' | 'refine' | null;
  at: number;
}

const EMPTY_FIT: FitReport = { projectId: null, spec: null, score: null, proportions: null, coverage: null, residuals: [], hints: [], unmatchedPhoto: [], source: null, at: 0 };
let fitReport: FitReport = EMPTY_FIT;
const fitListeners = new Set<() => void>();
/** `spec` is the object the store now holds for these gaps (or null when the result was not adopted). */
function publishFitReport(res: FitResponse | RefineResponse, spec: RoomSpec, projectId: string, source: FitReport['source'], adopted: RoomSpec | null = spec) {
  const elements = spec.roomType === 'exterior' ? [] : spec.detected?.elements ?? [];
  const unmatchedPhoto = res.unmatchedPhoto ?? [];
  const residuals = residualsOf(res, elements);
  // hints come in words from a fitter that writes them; otherwise the unmatched list is said plainly here
  const labels = new Map(elements.map((e) => [e.id, e.label]));
  const hints = res.hints?.length ? res.hints : unmatchedPhoto.filter((u) => u.reason !== 'kind not scored').map((u) => `${u.kind.replace(/-/g, ' ')}${labels.get(u.id) ? ` (${labels.get(u.id)})` : ''} — ${u.reason}`);
  const coverage = typeof res.coverage === 'number' ? res.coverage : coverageOf(residuals.length, unmatchedPhoto.filter((u) => u.reason !== 'kind not scored').length);
  fitReport = { projectId, spec: adopted, score: fitScoreOf(res), proportions: fitProportionsOf(res), coverage, residuals, hints, unmatchedPhoto, source, at: Date.now() };
  for (const l of fitListeners) l();
}
const subscribeFit = (l: () => void) => { fitListeners.add(l); return () => { fitListeners.delete(l); }; };

/** The last fit's element-by-element result; re-renders when a fit or a refine round lands. */
export function useFitReport(): FitReport {
  const projectId = useProjectStore((s) => s.project.id);
  const report = useSyncExternalStore(subscribeFit, () => fitReport, () => EMPTY_FIT);
  return report.projectId === projectId ? report : EMPTY_FIT;
}

// ---------------------------------------------------------------------------
// Capture guard — true while a screenshot for the accuracy pass is pending.
// The Viewport blocks pointer events on the canvas meanwhile, so a drag cannot
// move the camera between "snap to the photo view" and "grab the frame".
// ---------------------------------------------------------------------------

let capturePending = false;
const captureListeners = new Set<() => void>();
function setCapturePending(v: boolean) {
  if (capturePending === v) return;
  capturePending = v;
  for (const l of captureListeners) l();
}
const subscribeCapture = (l: () => void) => { captureListeners.add(l); return () => { captureListeners.delete(l); }; };
export function useCapturePending(): boolean {
  return useSyncExternalStore(subscribeCapture, () => capturePending, () => false);
}

function buildDescription(sub: IntakeSubmission, roomType: RoomType): string {
  const parts = [sub.description.trim()];
  if (roomType === 'exterior' && sub.emptyLot) {
    const tpl = HOUSE_TEMPLATES.find((t) => t.id === sub.houseTemplate);
    parts.push(`The lot is empty (no existing house). Propose a ${tpl ? tpl.name : 'modern farmhouse'} style home${tpl ? ` — ${tpl.blurb}` : ''}.`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/** Merge a template house onto an analyzed (empty) lot, keeping the lot the analyzer measured. */
function applyTemplate(spec: ExteriorSpec, template: ExteriorSpec['houseStyle'] | null | undefined): ExteriorSpec {
  const tpl = defaultExterior(template ?? 'modern-farmhouse');
  const name = HOUSE_TEMPLATES.find((t) => t.id === tpl.houseStyle)?.name ?? tpl.houseStyle;
  return {
    ...tpl,
    lot: { ...tpl.lot, ...spec.lot },
    detected: {
      ...spec.detected,
      // A template on a lot is a PROPOSAL, whatever the analyzer decided it
      // was looking at: the finishes on it were never photographed, so the
      // interview has to open on it.
      inputKind: 'empty-lot',
      summary: spec.detected.summary ? `${spec.detected.summary} A ${name} template house has been placed on the lot.` : `Empty lot with a proposed ${name} home.`,
      assumptions: [...spec.detected.assumptions, `House massing, roof and elevations come from the ${name} template, not the photo.`],
    },
  };
}

// ---------------------------------------------------------------------------
// Adopting a corrected spec
// ---------------------------------------------------------------------------

const materialsOf = (spec: RoomSpec) => spec.materials as unknown as Record<string, string>;

/**
 * Put a corrected spec in the store without trampling the user's material
 * choices: selections are kept for every slot except the ones the finishes
 * pass re-matched to the photo, which take the new detected material.
 *
 * Refuses (returns false) when the store no longer holds the spec the
 * correction was computed from — a Layout edit landed while the request was
 * in flight, or the project changed under us — because writing the result
 * would silently throw that edit away.
 */
function adoptSpec(next: RoomSpec, rematchedSlots: readonly string[], builtFrom: RoomSpec, projectId: string): boolean {
  const st = useProjectStore.getState();
  if (st.project.id !== projectId || st.project.spec !== builtFrom) return false;
  // healing can rename a custom id the model re-described; the user's kept
  // selection on that slot must follow it or it points at nothing
  const healed = ensureSpecMaterials(next);
  const keep = healSelections({ ...st.project.selections }, next, healed.remap, healed.slotRemap);
  const materials = materialsOf(next);
  for (const slot of rematchedSlots) if (materials[slot]) keep[slot] = materials[slot];
  // Is the user still following the passes, or have they started designing?
  // `captureBaseline` stores the SAME spec object as `project.spec`, so
  // reference equality answers it exactly: nothing has replaced the spec since
  // the capture, and the selections are still the ones captured with it.
  const b = st.project.baseline;
  const following = !!b && b.source !== 'manual' && st.project.spec === b.spec && sameSelections(st.project.selections, b.selections);
  st.setSpec(next);
  const after = useProjectStore.getState();
  after.setSelections(keep);
  if (following) useProjectStore.getState().captureBaseline(b!.source);
  else if (b && rematchedSlots.length) {
    // The finishes pass is a BETTER observation of the room as found, not a
    // design decision, so the slots it re-matched must not read as the user's
    // changes. (Slots the user picked by hand are already excluded upstream.)
    // Known limit: a reload between the capture and the pass breaks the
    // reference equality above, after which a pass can only patch these slots.
    // No pass runs after a reload, so that is acceptable.
    const patch: Record<string, string> = {};
    for (const slot of rematchedSlots) if (materials[slot]) patch[slot] = materials[slot];
    if (Object.keys(patch).length) useProjectStore.getState().patchBaselineSelections(patch);
  }
  return true;
}

function sameSelections(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/**
 * Fires `onEdit` the moment the project's spec object is replaced by anything
 * other than what the caller expects (a Layout-tab edit, a load, a new
 * project). `expected()` is read at notification time so the caller can move
 * the goalposts right before it adopts a result of its own.
 */
function watchEdits(projectId: string, expected: () => RoomSpec | null, onEdit: () => void): () => void {
  return useProjectStore.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    if (state.project.id !== projectId || state.project.spec !== expected()) onEdit();
  });
}

/** The refine route reports the camera beside the spec; make sure the spec carries it too. */
function withSolvedCamera(res: { spec: RoomSpec; camera?: FitResponse['camera'] }): RoomSpec {
  const spec = res.spec;
  if (spec.roomType === 'exterior' || !res.camera) return spec;
  if (spec.detected?.camera?.solved) return spec;
  return { ...spec, detected: { ...spec.detected, camera: { ...spec.detected.camera, solved: res.camera } } };
}

const isAbort = (err: unknown) => (err instanceof ApiError && err.code === 'aborted') || (err as Error)?.name === 'AbortError';

/**
 * The photo's frame (width ÷ height) for the fitter and the accuracy pass.
 * The inventory's boxes are normalised to the photo, so a fit made at a
 * guessed frame solves the wrong lens and the overlay never lines up. The
 * size on the record wins; otherwise the photo is decoded in the browser
 * (the same probe the Viewport letterboxes with) and the measured size is
 * written onto the record, so the letterbox, the fit and the screenshot all
 * use one frame from then on. Undefined when it cannot be known.
 */
async function photoAspectFor(photo: Photo | undefined, projectId: string): Promise<number | undefined> {
  if (!photo?.url) return undefined;
  const size = await photoSizeOf(photo);
  if (!size) return undefined;
  if (!(photo.width && photo.height)) {
    const st = useProjectStore.getState();
    if (st.project.id === projectId) st.setPhotos(st.project.photos.map((p) => (p.url === photo.url ? { ...p, width: size.width, height: size.height } : p)));
  }
  return size.width / size.height;
}

// ---------------------------------------------------------------------------
// Fit to photo
// ---------------------------------------------------------------------------

export interface FitOutcome {
  ok: boolean;
  /** mean IoU, 0..1 */
  score: number | null;
  /** how well the proportions match, 0..1; null when unscored */
  proportions?: number | null;
  /** why it did not fit — user-facing */
  error?: string;
  /** the fit was superseded (edit, new project, another fit) rather than failed */
  cancelled?: boolean;
}

let fitInFlight: AbortController | null = null;

/**
 * Fit the store's current twin to its photo: POST the spec, adopt the fitted
 * spec + solved camera, keep the user's material picks. Safe to call from
 * anywhere; a fit already in flight is superseded. Never throws.
 */
export async function fitProjectToPhoto(parentSignal?: AbortSignal): Promise<FitOutcome> {
  if (parentSignal?.aborted) return { ok: false, score: null, cancelled: true };
  const st = useProjectStore.getState();
  const spec = st.project.spec;
  const projectId = st.project.id;
  if (!spec || spec.roomType === 'exterior') return { ok: false, score: null, error: 'Only kitchens and bathrooms can be fitted to a photo.' };
  if (!spec.detected?.elements?.length) return { ok: false, score: null, error: 'This photo has no inventory to fit against. Re-analyze it to build one.' };
  // the inventory boxes are normalised, so the fitter needs the photo's frame
  // shape to solve a vertical lens the studio can reproduce exactly
  const photo = st.project.photos.find((p) => p.primary) ?? st.project.photos[0];
  fitInFlight?.abort();
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  fitInFlight = controller;
  st.setUI({ fitState: 'running' });
  const aspect = await photoAspectFor(photo, projectId);
  // the project may have moved on while the photo decoded
  if (signal.aborted || fitInFlight !== controller || useProjectStore.getState().project.id !== projectId || useProjectStore.getState().project.spec !== spec) {
    if (fitInFlight === controller) { useProjectStore.getState().setUI({ fitState: 'idle' }); fitInFlight = null; }
    return { ok: false, score: null, cancelled: true };
  }
  const unwatch = watchEdits(projectId, () => spec, () => controller.abort());
  // Only the fit that still owns the slot may write its outcome; a superseded
  // one would otherwise overwrite the newer fit's 'running'.
  const owns = () => fitInFlight === controller && useProjectStore.getState().project.id === projectId;
  const cancelled = (): FitOutcome => {
    if (owns()) useProjectStore.getState().setUI({ fitState: 'idle' });
    return { ok: false, score: null, cancelled: true };
  };
  try {
    const res = await fitTwin(spec, { aspect }, signal);
    unwatch(); // adopting below replaces the spec on purpose
    if (signal.aborted) return cancelled();
    if (!res?.spec || typeof res.spec !== 'object') throw new Error('The fitter returned no spec.');
    // a GATED fit refused its own edits: the twin on screen stays exactly as
    // it is and only the solved camera is taken (`specToAdopt`)
    const next = specToAdopt(spec, res);
    if (!adoptSpec(next, [], spec, projectId)) return cancelled();
    const score = fitScoreOf(res);
    publishFitReport(res, next, projectId, 'fit', next);
    useProjectStore.getState().setUI({ fitState: 'done', fitScore: score, fitProportions: fitProportionsOf(res) });
    return { ok: true, score, proportions: fitProportionsOf(res) };
  } catch (err) {
    if (signal.aborted || isAbort(err)) return cancelled();
    if (owns()) useProjectStore.getState().setUI({ fitState: 'error' });
    return { ok: false, score: null, error: errorMessage(err, 'Could not fit the twin to the photo.') };
  } finally {
    unwatch();
    if (fitInFlight === controller) fitInFlight = null;
  }
}

/** Fit button state for the HUD. */
export function useFitToPhoto() {
  const fitState = useProjectStore((s) => s.ui.fitState);
  const fitScore = useProjectStore((s) => s.ui.fitScore);
  const fitProportions = useProjectStore((s) => s.ui.fitProportions);
  // isSingleRoom, not "not an exterior": a floor plan has a `detected` block
  // like every other spec, so the old test lit the button up on a plan, where
  // the fit can only ever come back with a null score.
  const canFit = useProjectStore((s) => Boolean(isSingleRoom(s.project.spec) && s.project.spec.detected?.elements?.length));
  const fit = useCallback(() => fitProjectToPhoto(), []);
  return useMemo(() => ({ fit, busy: fitState === 'running', score: fitScore, proportions: fitProportions, canFit }), [fit, fitState, fitScore, fitProportions, canFit]);
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useAnalysis() {
  const runId = useRef(0);
  const analysisAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const stop = () => { runId.current += 1; analysisAbort.current?.abort(); analysisAbort.current = null; };
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.project.id !== previous.project.id || state.project.roomType !== previous.project.roomType) stop();
    });
    return () => { unsubscribe(); stop(); };
  }, []);
  const lastSubmission = useRef<IntakeSubmission | null>(null);
  const uploaded = useRef<{ sub: IntakeSubmission; photos: Photo[] } | null>(null);

  /**
   * Accuracy pass: screenshot the finished twin from the photo-matched camera
   * (at the photo's aspect ratio), show it to the model next to the client's
   * photo together with the fitter's measured gaps, and apply the corrections
   * it reports. Geometry goes round a loop — fit → refine → fit → … up to
   * four rounds, each from a fresh screenshot of the twin it just changed —
   * until the twin lands on the photo (score ≥ 0.9) or two rounds in a row
   * stop paying (`runMatchLoop` holds the rules); a round that scores worse
   * than the best so far is refused, so the twin can only get closer to the
   * picture. Finishes are compared once at the end, against the corrected
   * geometry. Best-effort throughout — a failure leaves the twin exactly as
   * the last successful step built it, because a slightly-off twin beats no
   * twin.
   *
   * The pass is abandoned (requests aborted, nothing more written) the moment
   * the user edits the layout or swaps projects: their edit always wins over
   * a correction computed against the spec they just changed.
   */
  const runAccuracyPass = useCallback(async (initial: RoomSpec, isAlive: () => boolean, parentSignal: AbortSignal): Promise<RoomSpec> => {
    if (initial.roomType === 'exterior') return initial;
    const st = useProjectStore.getState();
    const photo = st.project.photos.find((p) => p.primary) ?? st.project.photos[0];
    if (!photo?.url) return initial;
    const photoUrl = photo.url;
    const projectId = st.project.id;
    // the re-fit after a geometry pass needs the photo's frame shape (see fitTwin)
    const aspect = await photoAspectFor(photo, projectId);
    if (!isAlive() || useProjectStore.getState().project.id !== projectId || useProjectStore.getState().project.spec !== initial) return initial;
    const restore = { cameraMode: st.ui.cameraMode, showOriginalPhoto: st.ui.showOriginalPhoto };

    let spec: RoomSpec = initial;
    let rounds = 0;
    let applied = 0;
    let finishesApplied = 0;
    let match = 0;
    let started = false;
    let completed = false;
    let loop: MatchLoopResult | null = null;
    const corrections: CorrectionRecord[] = [];
    const notes: string[] = [];
    const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

    // Every request is built from `spec`; if the store stops holding that
    // exact object before the answer lands, the answer is stale.
    const controller = new AbortController();
    const signal = AbortSignal.any([parentSignal, controller.signal]);
    const unwatch = watchEdits(projectId, () => spec, () => { controller.abort(); runId.current += 1; });
    const alive = () => isAlive() && !signal.aborted;
    const adopt = (next: RoomSpec, rematched: readonly string[]): boolean => {
      if (!alive()) return false;
      const from = spec;
      spec = next; // before the store write: the edit watcher reads `spec` synchronously
      if (adoptSpec(next, rematched, from, projectId)) return true;
      spec = from;
      return false;
    };
    // A refine response that re-fitted carries a solved camera; surface the
    // score. `adopted` is the spec object the store now holds for it.
    const noteFit = (res: RefineResponse, adopted: RoomSpec | null) => {
      const score = fitScoreOf(res);
      if (score !== null) {
        useProjectStore.getState().setUI({ fitState: 'done', fitScore: score, fitProportions: fitProportionsOf(res) });
        publishFitReport(res, res.spec, projectId, 'refine', adopted);
      }
    };

    // Compare like with like: stand the camera where the photo was taken, snap
    // it back there in case the user has orbited away, give the scene a moment
    // to paint (the canvas also resizes to the photo's aspect), then grab that
    // frame. Pointer events are blocked on the canvas meanwhile so a drag
    // cannot move the camera between the snap and the shot. The twin stays on
    // screen throughout.
    const snapshot = async (settleMs: number): Promise<RefinementEvidence | null> => {
      useProjectStore.getState().setUI({ cameraMode: 'photo', showOriginalPhoto: false });
      setCapturePending(true);
      try {
        await wait(80); // the photo rig mounts on the next render
        if (!alive()) return null;
        requestResetView();
        await wait(settleMs);
        if (!alive()) return null;
        return await captureRefinementEvidence({
          read: () => ({ spec, selections: useProjectStore.getState().project.selections }),
          alive,
          capture: () => captureViewport({ format: 'jpeg', quality: 0.9, maxPx: 1600 }),
          upload: (shot) => {
            // The canvas no longer needs to stay locked while bytes upload.
            setCapturePending(false);
            return uploadViewport(shot, projectId, signal);
          },
        });
      } finally {
        setCapturePending(false);
      }
    };

    try {
      const firstShot = await snapshot(1100);
      if (!firstShot) return spec;
      let evidence = firstShot;
      started = true;
      useProjectStore.getState().setUI({ accuracyPass: 'running' });
      // The fit that ran before this pass measured the twin's gaps; those go
      // into the first round's prompt — but only when they were measured on
      // the very spec this pass is correcting (an edit since then makes them
      // gaps of a twin that is gone; the route then measures for itself).
      // Later rounds use the gaps the route measured after its corrections.
      const measurable = Boolean(spec.detected?.elements?.length);
      const startScore = measurable ? spec.detected.camera.solved?.score ?? null : null;
      const prior = measuredGapsFor(fitReport, projectId, spec);
      let residuals: FitResidual[] | undefined = prior.residuals;
      let hints: string[] | undefined = prior.hints;
      /** the score of the twin the store holds — the start's, then each ADOPTED round's; a refused round never moves it */
      let best = startScore;
      publishReport({ ...EMPTY_REPORT, status: 'running', pass: report.pass + 1, phase: 'geometry', score: startScore });

      // What the loop needs from each round, and what to do with a round it
      // keeps. The response is parked between the two calls so the loop's
      // verdict decides whether it reaches the store at all.
      let pending: RefineResponse | null = null;
      const driver: MatchLoopDriver = {
        alive,
        round: async (round) => {
          publishReport({ round, score: best });
          if (round > 1) {
            // a fresh frame of the twin the previous round changed (or, after a refused round, the same twin — cheap, and the model still sees what it is judging)
            const next = await snapshot(900);
            if (!next) return null;
            evidence = next;
          }
          const res = await refineTwin({ spec: evidence.spec, photoUrl, viewportUrl: evidence.viewportUrl, passes: ['geometry'], selections: evidence.selections, aspect, residuals, hints, round }, signal);
          if (!alive() || !res?.spec) return null;
          rounds++;
          corrections.push(...(res.corrections ?? []));
          notes.push(...(res.notes ?? []));
          match = res.match ?? 0;
          pending = res;
          const appliedNow = (res.corrections ?? []).filter((c) => c.applied).length;
          // `changed` is what the model's corrections did to the spec; the
          // re-fit's camera is not a change of twin. A round that changed
          // nothing and whose re-fit was gated has nothing to adopt.
          // 'gated' only — a 'partial' round changed the spec (a size the
          // photo could not measure survived the gate, `fit.ts
          // adoptUnmeasured`), so it must NOT take runMatchLoop's
          // "nothing moved, stop" branch
          return { score: fitScoreOf(res), changed: appliedNow > 0 || Boolean(res.changed), match: res.match, gated: res.spec_unchanged === 'gated' };
        },
        adopt: (round, outcome) => {
          const res = pending;
          pending = null;
          if (!res) return false;
          const appliedNow = (res.corrections ?? []).filter((c) => c.applied);
          // The route re-fits the twin to the photo after the model's edits,
          // so its spec can carry a better camera and measured sizes even when
          // the model itself changed nothing — that solve is worth keeping too.
          const refitted = fitScoreOf(res) !== null || Boolean(res.camera);
          let held: RoomSpec | null = null;
          if (appliedNow.length || res.changed || refitted) {
            held = withSolvedCamera(res);
            if (!adopt(held, [])) return false;
            applied += appliedNow.length;
          }
          noteFit(res, held);
          if (res.residuals?.length) residuals = res.residuals;
          if (res.hints) hints = res.hints;
          // the report says what the twin on screen scores: this round's, now that it is adopted
          if (outcome.score !== null) best = outcome.score;
          publishReport({ rounds, applied, match, score: best, corrections: corrections.slice(), notes: notes.slice(), history: [...report.history, { round, score: outcome.score, adopted: true }] });
          return true;
        },
        reject: (round, outcome, bestSoFar) => {
          const res = pending;
          pending = null;
          // the round's edits never reached the twin, so the audit trail must not say they did
          for (const c of res?.corrections ?? []) if (c.applied) { c.applied = false; c.rejected = `round ${round} refused: it lowered the photo match to ${pct(outcome.score)}`; }
          notes.push(`Round ${round} would have lowered the photo match from ${pct(bestSoFar)} to ${pct(outcome.score)}; kept the previous twin.`);
          publishReport({ rounds, applied, match, score: best, corrections: corrections.slice(), notes: notes.slice(), history: [...report.history, { round, score: outcome.score, adopted: false }] });
        },
      };
      loop = await runMatchLoop(startScore, driver);
      // a round the loop neither adopted nor refused (nothing changed, fit gated) is still on the record
      if (loop.history.length > report.history.length) publishReport({ rounds, applied, match, history: loop.history.slice() });
      publishReport({ stoppedBy: loop.stoppedBy, score: loop.score ?? best });
      if (loop.stoppedBy === 'aborted' || !alive()) return spec;
      publishReport({ phase: 'finishes' });

      // A fit may move the camera/spec with zero model corrections. Reuse a
      // frame only when both its scene and its captured finishes still match.
      if (!evidenceMatches(evidence, spec, useProjectStore.getState().project.selections)) {
        const next = await snapshot(900);
        if (!next) return spec;
        evidence = next;
      }
      // What is on screen is the user's selections, not necessarily the spec's
      // detected materials: the route gets both so it can judge the frame it
      // was actually given.
      const before = spec;
      const selectionsAtShot = evidence.selections;
      const fin = await refineTwin({ spec: evidence.spec, photoUrl, viewportUrl: evidence.viewportUrl, passes: ['finishes'], selections: selectionsAtShot, aspect }, signal);
      if (!alive() || !fin?.spec) return spec;
      // Never revert a finish the user picked by hand. A slot whose on-screen
      // selection differs from the pre-pass detected material was chosen
      // deliberately; the model's re-match for it is discarded and the spec's
      // detected material for that slot stays what it was.
      const detectedBefore = materialsOf(before);
      const handPicked = protectedFinishSlots(before, selectionsAtShot, useProjectStore.getState().project.selections);
      const finishes = (fin.finishes ?? []).filter((f) => !handPicked.has(f.slot));
      const finSpec = fin.spec;
      const finMaterials = materialsOf(finSpec);
      for (const slot of handPicked) if (detectedBefore[slot]) finMaterials[slot] = detectedBefore[slot];
      let heldFin: RoomSpec | null = null;
      if (finishes.length || fin.changed) {
        if (!adopt(finSpec, finishes.map((f) => f.slot))) return spec;
        heldFin = finSpec;
        finishesApplied = finishes.length;
      }
      noteFit(fin, heldFin);
      notes.push(...(fin.notes ?? []));
      match = Math.max(match, fin.match ?? 0);
      completed = true;
      return spec;
    } catch (err) {
      if (!isAbort(err) && process.env.NODE_ENV !== 'production') console.warn('[accuracy pass]', err);
      return spec;
    } finally {
      unwatch();
      const sameProject = useProjectStore.getState().project.id === projectId;
      // Terminal state no matter how we got here — a pass abandoned mid-way
      // must not leave the badge saying "checking…" forever.
      if (started) {
        publishReport({ status: 'done', phase: null, rounds, applied, finishes: finishesApplied, match, stoppedBy: loop?.stoppedBy ?? 'aborted', corrections: corrections.slice(), notes: notes.slice() });
        if (sameProject) {
          const changed = applied + finishesApplied;
          useProjectStore.getState().setUI({ accuracyPass: changed ? 'applied' : completed ? 'clean' : 'idle', accuracyApplied: changed, accuracyMatch: match });
        }
      }
      if (sameProject) {
        // Only undo our own camera change — if the user switched modes while
        // the pass ran, their choice stands. The side-by-side photo pane is
        // ours alone, so it always goes back to how it was.
        const ui = useProjectStore.getState().ui;
        useProjectStore.getState().setUI({ showOriginalPhoto: restore.showOriginalPhoto, ...(ui.cameraMode === 'photo' ? { cameraMode: restore.cameraMode } : {}) });
      }
    }
  }, []);

  /**
   * What happens after the twin is on screen: the pixel fit first (fast,
   * arithmetic only — it also gives the accuracy pass an exact camera to
   * screenshot from), then the vision check. Neither blocks 'ready'.
   */
  const runBackgroundPasses = useCallback(async (spec: RoomSpec, isAlive: () => boolean, signal: AbortSignal) => {
    const projectId = useProjectStore.getState().project.id;
    if (isSingleRoom(spec) && spec.detected?.elements?.length) {
      await fitProjectToPhoto(signal);
      if (!isAlive()) return;
    }
    // Whatever the store holds now — the fitted spec, or the user's edit if
    // one landed meanwhile — is what the vision check must look at.
    const st = useProjectStore.getState();
    if (st.project.id !== projectId || !st.project.spec) return;
    await runAccuracyPass(st.project.spec, isAlive, signal);
  }, [runAccuracyPass]);

  /**
   * `opts.baseline` says whether this spec IS the room as found. An analysed
   * photo is (a re-analysis re-captures it); a template house on an empty lot
   * is not — nothing existed, everything is new, and a full remodel is the
   * honest price.
   */
  const finish = useCallback(async (spec: RoomSpec, isAlive: () => boolean, opts: { baseline: BaselineSource | null; signal: AbortSignal }) => {
    const st = useProjectStore.getState();
    ensureSpecMaterials(spec);
    st.setSpec(spec);
    const held = useProjectStore.getState();
    if (opts.baseline) held.captureBaseline(opts.baseline); else held.clearBaseline();
    // What the analyzer said it was looking at, recorded on the project the
    // moment the spec lands: this is what decides whether the studio asks,
    // and it is where the client's answers will go.
    held.setIntake(intakeFromAnalysis(spec));
    st.setAnalysis('building', 'Assembling the 3D twin…', 0.9);
    try { preloadSelections(useProjectStore.getState().project.selections); } catch { /* textures stream in later */ }
    await wait(700);
    if (!isAlive()) return;
    useProjectStore.getState().setAnalysis('building', 'Streaming materials…', 0.93);
    await wait(400);
    if (!isAlive()) return;
    useProjectStore.getState().setAnalysis('ready', 'Your 3D twin is ready', 1);

    // A plan or a lot goes straight to the interview, over the twin we built
    // from the template — so the client watches their answers land on
    // something rather than filling in a form against a blank screen. A room
    // photograph never gets here (`shouldOpenInterview` refuses to take the
    // screen for the one question a camera cannot answer).
    const after = useProjectStore.getState();
    if (shouldOpenInterview(after.project.spec, after.project.intake)) {
      openInterview();
      // The fit and the accuracy pass compare the twin with a PHOTOGRAPH of
      // the room. There is no such photograph here: a floor plan's "elements"
      // are symbols on a drawing and a bare lot has none at all, so a pass
      // would be measuring the twin against a picture of something else —
      // and it would be screenshotting the viewport from behind the
      // interview while the client is still answering it.
      return;
    }
    // The fit takes under a second; the accuracy pass a minute or two. Showing
    // the twin first and correcting it in the background keeps the
    // minute-to-first-twin promise while still ending up with a reconstruction
    // that has been measured and checked against the photo.
    // Keep the run's controller reachable until all follow-up requests finish.
    // The UI is already ready, so this only extends cancellation ownership.
    await runBackgroundPasses(spec, isAlive, opts.signal);
  }, [runBackgroundPasses]);

  const start = useCallback(async (sub: IntakeSubmission) => {
    analysisAbort.current?.abort();
    const controller = new AbortController();
    analysisAbort.current = controller;
    const run = ++runId.current;
    const isAlive = () => runId.current === run && !controller.signal.aborted;
    lastSubmission.current = sub;
    const st = useProjectStore.getState();
    const { project } = st;
    const roomType = project.roomType;

    try {
      // Empty lot with no photos: build straight from the template.
      if (roomType === 'exterior' && sub.emptyLot && sub.files.length === 0) {
        st.setAnalysis('uploading', 'Preparing your lot…', 0.1);
        await wait(350);
        if (!isAlive()) return;
        useProjectStore.getState().setAnalysis('analyzing', 'Placing the template house…', 0.55);
        const tpl = defaultExterior(sub.houseTemplate ?? 'modern-farmhouse');
        const name = HOUSE_TEMPLATES.find((t) => t.id === tpl.houseStyle)?.name ?? tpl.houseStyle;
        const spec: ExteriorSpec = {
          ...tpl,
          detected: {
            ...tpl.detected,
            // Nobody classified anything — there was no upload to classify —
            // but the client TOLD us it is a bare lot, and that is exactly
            // the case the interview exists for. Saying so here is what makes
            // "no photo at all" walk the same path as an analyzed lot.
            inputKind: 'empty-lot',
            summary: `Empty lot with a proposed ${name} home.${sub.description.trim() ? ` Notes: ${sub.description.trim()}` : ''}`,
            assumptions: [...tpl.detected.assumptions, 'No photos were provided — lot size, materials and colours come from your answers and the template, not from a survey.'],
          },
        };
        await wait(500);
        if (!isAlive()) return;
        await finish(spec, isAlive, { baseline: null, signal: controller.signal });
        return;
      }

      // 1. Prepare + upload (reused on retry when the upload already succeeded).
      let photos = uploaded.current && uploaded.current.sub === sub ? uploaded.current.photos : null;
      if (!photos) {
        st.setAnalysis('uploading', 'Optimizing photos…', 0.02);
        const prepared: File[] = [];
        for (let i = 0; i < sub.files.length; i++) {
          const r = await prepareImageForUpload(sub.files[i]);
          if (!isAlive()) return;
          prepared.push(r.file);
          useProjectStore.getState().setAnalysis('uploading', `Optimizing photo ${i + 1} of ${sub.files.length}…`, 0.02 + 0.06 * ((i + 1) / sub.files.length));
        }
        useProjectStore.getState().setAnalysis('uploading', 'Uploading photos…', 0.08);
        const result = await uploadPhotos(prepared, project.id, (p) => {
          const frac = normalizeProgress(typeof p === 'number' ? p : p?.percentage);
          if (isAlive()) useProjectStore.getState().setAnalysis('uploading', `Uploading photos… ${Math.round(frac * 100)}%`, 0.08 + 0.17 * frac);
        }, controller.signal);
        if (!isAlive()) return;
        const list: Photo[] = Array.isArray(result) ? result : [];
        if (!list.length) throw new Error('Upload returned no photos. Check BLOB_READ_WRITE_TOKEN and try again.');
        photos = list.map((p, i) => ({ ...p, primary: i === Math.min(sub.primaryIndex, list.length - 1) }));
        uploaded.current = { sub, photos };
        useProjectStore.getState().setPhotos(photos);
      }

      // 2. Analyze (NDJSON events → status lines).
      useProjectStore.getState().setAnalysis('analyzing', 'Reading the room…', 0.27);
      const description = buildDescription(sub, roomType);
      const measured: { photos: Photo[] | null } = { photos: null };
      let spec: RoomSpec = await analyzeRoom({ roomType, photos, description }, (e) => {
        if (!isAlive()) return;
        if (e.phase === 'done' && Array.isArray(e.meta?.photos)) measured.photos = e.meta.photos;
        const message = (e && typeof e.message === 'string' && e.message.trim()) || PHASE_LABEL[e?.phase] || 'Analyzing…';
        useProjectStore.getState().setAnalysis('analyzing', message, 0.27 + 0.63 * normalizeProgress(e?.progress));
      }, controller.signal);
      if (!isAlive()) return;
      // The server measured the primary photo's pixel size for its inventory
      // (the boxes are normalised to that frame); keep it on the record so
      // the fit and the photo view use the same frame.
      if (measured.photos) {
        const byUrl = new Map(measured.photos.map((p) => [p.url, p]));
        const held = useProjectStore.getState();
        if (held.project.id === project.id) {
          const merged = held.project.photos.map((p) => {
            const m = byUrl.get(p.url);
            return m && m.width && m.height && !(p.width && p.height) ? { ...p, width: m.width, height: m.height } : p;
          });
          if (merged.some((p, i) => p !== held.project.photos[i])) held.setPhotos(merged);
        }
      }
      if (!spec || typeof spec !== 'object' || !('roomType' in spec)) throw new Error('The analyzer returned an unusable result. Try clearer, wider photos.');
      // A template house dropped on an empty lot is a proposal, not a record
      // of anything that stands there — nothing to price changes against.
      const templated = spec.roomType === 'exterior' && Boolean(sub.emptyLot) && (!spec.house.present || Boolean(sub.houseTemplate));
      if (templated && spec.roomType === 'exterior') spec = applyTemplate(spec, sub.houseTemplate);
      await finish(spec, isAlive, { baseline: templated ? null : 'analysis', signal: controller.signal });
    } catch (err) {
      if (!isAlive()) return;
      useProjectStore.getState().setAnalysis('error', errorMessage(err, 'We could not analyze those photos.'));
      // Out of free scans: the paywall opens over the error state.
      if (err instanceof ApiError && err.code === 'limit_reached') {
        const d = (err.details ?? {}) as { used?: number; free?: number };
        requestUnlock({ used: d.used, free: d.free });
      }
    } finally {
      if (analysisAbort.current === controller) analysisAbort.current = null;
    }
  }, [finish]);

  const retry = useCallback(() => {
    if (lastSubmission.current) void start(lastSubmission.current);
  }, [start]);

  /** Load a fully-specified demo project (no network). */
  const useDemo = useCallback((roomType: RoomType) => {
    analysisAbort.current?.abort();
    runId.current += 1;
    const st = useProjectStore.getState();
    st.newProject(roomType);
    const s = useProjectStore.getState();
    s.setName(DEMO_NAMES[roomType]);
    s.setPhotos(DEMO_PHOTOS[roomType]);
    s.setDescription('');
    s.setSpec(defaultSpec(roomType));
    // the demo opens at $0 with "swap a material" and "Show full remodel" one
    // click away, which is the whole point of the demo
    useProjectStore.getState().captureBaseline('demo');
    try { preloadSelections(useProjectStore.getState().project.selections); } catch { /* ignore */ }
    useProjectStore.getState().setAnalysis('ready', 'Demo loaded', 1);
  }, []);

  /** Abandon the in-flight run and go back to intake (keeps photos + description). */
  const cancel = useCallback(() => {
    analysisAbort.current?.abort();
    runId.current += 1;
    useProjectStore.getState().setAnalysis('idle', '', 0);
  }, []);

  return useMemo(() => ({
    start, retry, useDemo, cancel,
    hasSubmission: () => lastSubmission.current !== null,
    /** the last accuracy pass, in the shape the assumptions panel already reads */
    getRefinement: () => (report.status === 'done' ? { corrections: report.corrections, notes: report.notes, match: report.match, appliedCount: report.applied + report.finishes } : null),
  }), [start, retry, useDemo, cancel]);
}

export type AnalysisController = ReturnType<typeof useAnalysis>;
