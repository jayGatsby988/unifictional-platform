/**
 * The guided interview's WIRING: which questions this project still needs
 * asked, and what happens to the project when the client answers them.
 *
 * Deliberately React-free and kept out of `Interview.tsx`. Two reasons:
 *
 *  1. `scripts/check-intake.ts` cannot mount a component, but it CAN drive
 *     the store — so every rule that decides whether a client gets
 *     interrogated, and every write that lands when they finish, is verified
 *     headlessly instead of by reading JSX and hoping.
 *  2. `useAnalysis` needs the "should we ask?" rule the moment an analysis
 *     lands, and a hook cannot import a view without dragging the whole
 *     interview into the analysis path.
 *
 * Nothing here reaches the 3D engine: the caller preloads textures after the
 * build, because this module is imported by a node script that has no WebGL.
 */
import { getMaterial } from '@/lib/materials/catalog';
import {
  answerMap, intakeEstimateSettings, questionsFor, shouldAskIntake, specFromIntake,
  type IntakeQuestion,
} from '@/lib/spec/intake';
import { useProjectStore } from '@/lib/store/project-store';
// the pure exterior SOLVER, not the engine — no WebGL, no React; it is what
// says which openings it had to invent (see `declaredAssumptions`)
import { computeExteriorLayout } from '@/components/scene/exterior/layout';
import type { ExteriorSpec, InputKind, IntakeAnswer, IntakeState, RoomSpec } from '@/lib/spec/types';

// ---------------------------------------------------------------------------
// How the upload is described back to the client
// ---------------------------------------------------------------------------

/** What we tell the client we were looking at, in their words not the enum's. */
export const INPUT_LABEL: Record<InputKind, string> = {
  'room-photo': 'your photo',
  'empty-lot': 'an empty lot',
  'floor-plan': 'a floor plan',
  'plans-document': 'a set of plans',
};

/** Why we are asking at all — one sentence, specific to what they sent us. */
export const INPUT_BLURB: Record<InputKind, string> = {
  'room-photo': 'Your photo answered nearly everything. Only a couple of things a camera cannot see are left.',
  'empty-lot': 'Bare ground tells us the site and nothing else — no house, no colours, no materials. So we ask.',
  'floor-plan': 'A plan gives us the walls and the sizes, but a drawing has no colour and no finish in it. So we ask.',
  'plans-document': 'The drawings give us the layout and the dimensions; the finishes were never on the sheet. So we ask.',
};

// ---------------------------------------------------------------------------
// Which questions, and whether to interrupt
// ---------------------------------------------------------------------------

/**
 * The questions this project still needs asked, in catalogue order.
 * `questionsFor` already drops what the room type does not have, what this
 * kind of upload answered by itself, and any slot the analyzer actually READ
 * off a photograph — so a plan with one interior shot attached is a shorter
 * interview than a plan on its own.
 */
export function interviewQuestions(spec: RoomSpec | null | undefined, intake: IntakeState | null | undefined): IntakeQuestion[] {
  if (!spec || !intake) return [];
  return questionsFor(spec.roomType, intake.inputKind, spec);
}

/**
 * Below this, the interview opens only because the client asked for it.
 *
 * A room photograph's one unanswerable question is where to price the job,
 * and taking the whole screen away from someone who just watched their own
 * kitchen appear — to ask them one thing — is exactly the form the client
 * told us not to build. One question is a chip in the top bar; nineteen is an
 * interview.
 */
export const MIN_AUTO_OPEN = 2;

/**
 * Whether the studio should INTERRUPT with the interview.
 *
 * `shouldAskIntake` is the contract's rule (this upload could not answer its
 * own questions); this adds the client's other one — a room photo must not be
 * interrogated — by refusing to take the screen for a one-question interview.
 */
export function shouldOpenInterview(spec: RoomSpec | null | undefined, intake: IntakeState | null | undefined): boolean {
  if (!shouldAskIntake(spec)) return false;
  return interviewQuestions(spec, intake).length >= MIN_AUTO_OPEN;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const hasValue = (a: IntakeAnswer | undefined): boolean => !!a && (a.value.trim() !== '' || (a.values?.length ?? 0) > 0);

/** How many questions the client actually answered themselves. */
export function answeredCount(questions: readonly IntakeQuestion[], answers: readonly IntakeAnswer[]): number {
  const given = answerMap(answers);
  return questions.reduce((n, q) => n + (hasValue(given.get(q.id)) ? 1 : 0), 0);
}

/**
 * Every question answered: the client's answer where they gave one, the
 * question's own default where they did not.
 *
 * This is what makes "accept the lot" and "use defaults for the rest" honest.
 * The interview shows each question's default preselected, so a client who
 * clicks straight through has *seen* every answer we are about to use — and
 * the spec we build is the spec they looked at, not a different one assembled
 * out of whatever they happened to touch.
 *
 * The filled-in ones are flagged `fromDefault`, which is how the honesty above
 * stops short of arrogance: they still land, but `applyIntakeAnswers` ranks a
 * default nobody touched below the product the client DID pick, so the roof
 * question's stock grey no longer re-tints their slate.
 */
export function completeAnswers(questions: readonly IntakeQuestion[], answers: readonly IntakeAnswer[]): IntakeAnswer[] {
  const given = answerMap(answers);
  return questions.map((q) => {
    const a = given.get(q.id);
    // The flag rides along on a re-run: a stored answer that was filled in for
    // the client last time must not be promoted to a statement just because it
    // is now on the project. `setAnswer` is the only thing that clears it, and
    // it is only ever called by the client touching the control.
    return hasValue(a)
      ? { id: q.id, value: a!.value, values: a!.values ?? [], ...(a!.fromDefault === true ? { fromDefault: true } : {}) }
      : { id: q.id, value: q.default, values: [], fromDefault: true };
  });
}

// ---------------------------------------------------------------------------
// Building the twin from the answers
// ---------------------------------------------------------------------------

const materialsOf = (spec: RoomSpec): Record<string, string> => ({ ...(spec.materials as unknown as Record<string, string>) });

/** Slots whose material the answers actually moved — including the ones moved for them. */
export function changedSlots(before: RoomSpec, after: RoomSpec): string[] {
  const a = materialsOf(before);
  const b = materialsOf(after);
  // `unifyRelatedSlots` drags the upper and tall cabinets along with the base
  // ones, and a synthesised custom material lands under a brand-new id, so
  // "what did the answers change" can only be read off the result.
  return Object.keys(b).filter((slot) => a[slot] !== b[slot]);
}

/**
 * The prefix every geometry-made assumption is written under, so a rebuild can
 * drop the last set instead of stacking a second copy on top of it.
 */
const ASSUMED = 'Assumed: ';

/**
 * Assumptions the GEOMETRY made, written where the client already reads them.
 *
 * `EstimatePanel` lists `detected.assumptions` under the quote, and the
 * exterior solver invents the only openings in the whole twin that nobody
 * described: a wing or garage face the analysis left blank gets a window per
 * storey, because a blank two-storey wall over a garage door would be a worse
 * lie (`fillBlankFace`). A contractor has to read that on the estimate rather
 * than find it on site, so the layout's `warnings` are folded in here, at the
 * one moment a spec is adopted, rather than during a render.
 */
function declaredAssumptions(spec: RoomSpec): RoomSpec {
  if (spec.roomType !== 'exterior') return spec;
  const warnings = computeExteriorLayout(spec as ExteriorSpec).warnings;
  const kept = spec.detected.assumptions.filter((a) => !a.startsWith(ASSUMED));
  if (!warnings.length && kept.length === spec.detected.assumptions.length) return spec;
  return { ...spec, detected: { ...spec.detected, assumptions: [...kept, ...warnings] } };
}

export interface InterviewBuild {
  ok: boolean;
  spec: RoomSpec | null;
  /** one line per answer that landed */
  wrote: string[];
  /** answers that could not land, and why */
  skipped: string[];
  /** material slots the answers moved */
  changed: string[];
  /** why nothing happened, when `ok` is false */
  reason?: string;
}

/**
 * Build the twin from the client's answers.
 *
 * The answers are completed with their own defaults, stored on the project
 * (so they survive a reload and can be edited one at a time later), written
 * into the current spec and adopted. `setSpec` runs `ensureSpecMaterials`,
 * which is what turns a "white oak, #C9AE86, plank" answer into a real
 * catalog product or a synthesised custom material — the same path a reading
 * off a photograph takes.
 *
 * Two things it deliberately does NOT do:
 *
 *  - It does not reset the material selections. `setSpec` points every slot
 *    at the spec's own material, which is right for the first build and wrong
 *    for the client who reopens the interview to change one answer after an
 *    hour of swapping swatches. So the selections the answers did not move
 *    are put back exactly as they were.
 *  - It does not touch the baseline. On a plan or a lot there is no baseline
 *    (nothing stands there to price changes against); on a room photo the
 *    baseline is the room as found, and the client's answers are changes to
 *    it — which is precisely what the estimate should show.
 */
export function buildFromInterview(answers: readonly IntakeAnswer[]): InterviewBuild {
  const st = useProjectStore.getState();
  const spec = st.project.spec;
  const intake = st.project.intake;
  const empty: InterviewBuild = { ok: false, spec: null, wrote: [], skipped: [], changed: [] };
  if (!spec) return { ...empty, reason: 'there is no twin to build on yet' };
  if (!intake) return { ...empty, reason: 'this project was never asked' };

  const questions = interviewQuestions(spec, intake);
  const full = completeAnswers(questions, answers);
  const next: IntakeState = { inputKind: intake.inputKind, answers: full, capturedAt: new Date().toISOString() };
  const applied = specFromIntake(spec, next);

  const beforeSelections = { ...st.project.selections };
  st.setIntake(next);
  useProjectStore.getState().setSpec(declaredAssumptions(applied.spec));

  const held = useProjectStore.getState();
  const built = held.project.spec ?? applied.spec;
  const changed = new Set(changedSlots(spec, built));
  const keep = { ...held.project.selections };
  for (const [slot, id] of Object.entries(beforeSelections)) {
    if (!changed.has(slot) && getMaterial(id)) keep[slot] = id;
  }
  held.setSelections(keep);

  const settings = intakeEstimateSettings(full);
  if (settings.tier) useProjectStore.getState().setEstimateSettings(settings);

  return { ok: true, spec: built, wrote: applied.wrote, skipped: applied.skipped, changed: [...changed] };
}
