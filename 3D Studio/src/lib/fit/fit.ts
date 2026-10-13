/**
 * The fitter: adjust camera + spec until the twin's elements project onto
 * the photo's boxes.
 *
 * The analyzer reads a photo and writes a RoomSpec; the accuracy pass asks a
 * vision model what still looks wrong. Both are judgement calls. This is the
 * measurement: the photo inventory (`detected.elements`) says where the
 * fridge, the island, each window IS in the picture, the layout solver says
 * where the twin puts them, a pinhole camera projects the twin into the
 * picture, and the gap between the two sets of boxes is a number we can
 * drive down.
 *
 * Loss = Σ w · ((1 − IoU) + 0.5 · centre distance + 0.25 · proportion error)
 * over matched pairs, normalised by Σ w, where w = √area × photo confidence
 * × kind importance (the square root so a run or the floor outweighs a stool
 * without drowning it). The proportion term (`report.ts proportionError`) is
 * what makes a box that is the right SIZE in the wrong place beat one that
 * is the wrong size — an IoU alone cannot tell those apart. It rides in the
 * LOSS only: the PAIRING cost stays (1 − IoU) + 0.5 · centre distance + hint,
 * because the drop columns at w · MAX_COST are denominated in that, and a λ
 * in the pairing cost flipped a client fixture into a basin that dropped two
 * pairings outright.
 *
 * Three numbers come out, and they are not interchangeable. The SCORE
 * ("photo match") is the weighted mean IoU over the matched pairs with the
 * same weights — the optimiser's currency and the gate's. PROPORTIONS is
 * 1 − Σ w · err / Σ w over those same pairs: how close the sizes and
 * positions are, which reads 15–20 points above the IoU for the same twin
 * because an IoU punishes a 5% size error by 9 points. COVERAGE is the
 * share of scorable photo elements (everything but kind 'other') that found
 * a twin. Show all three or none — one of them dressed as another is a
 * number massage. A photo element
 * whose twin counterpart exists but is out of frame costs the maximum
 * (otherwise a camera that looks at the ceiling would score zero). A photo
 * element with NO counterpart in the twin (a plant the analyzer missed, a
 * fourth stool when the twin seats three) is reported with a plain-English
 * hint, not penalised — the fitter cannot add things, only move and resize
 * them, and penalising what it cannot fix would only pull the camera toward
 * a lie. Pairs are made by KIND (a cooktop and a range are the same box to a
 * photo); the wall the inventory named is a hint that breaks ties, never a
 * key, and the `facing` cue (which way the thing's front points in the
 * picture) is the STRONG form of that hint — a fridge whose front is turned
 * to the left of the frame stands on the right wall, and pairing it with a
 * back-wall fridge costs about half an element — except that when the
 * labels disagree with the twin outright, the whole labelling is also tried
 * turned one wall either way (`frame.ts`).
 *
 * Optimiser, in order, all deterministic:
 *   1. camera alone, from a grid of standpoints × aims × lenses × ROOM
 *      SCALES (the analyzer's commonest mistake is the whole room a size
 *      too big or too small) plus the frame hints' seeds, for each label
 *      hypothesis; the best three standpoints get a pattern search;
 *   2. then, until a full round buys less than 0.3% twice or the budget is
 *      spent: a spec round (positions scanned coarsely, then coordinate
 *      descent over every field — `params.ts` — each candidate through the
 *      layout solver, re-paired), a camera round, and a JOINT round (a
 *      seeded Gaussian evolution strategy over camera + spec together, the
 *      only stage that takes diagonal moves — `optimise.ts`).
 * The final spec goes through `reconcileSpec` so cabinet widths and gaps
 * stay consistent with the new lengths, and a plausibility gate discards
 * the spec edits (keeping the solved camera) when they did not clearly beat
 * the original or moved any one measured size by more than a quarter to a
 * third. A gated result carries the ORIGINAL spec (tidied; reconciled only
 * when the reconciler's version draws no worse through the solved camera),
 * and says so in `spec_unchanged` — a caller then adopts the camera alone.
 * The one exception is PARTIAL ADOPTION (`adoptUnmeasured`): a size the photo
 * could not measure because its box leaves the frame is written back on top of
 * that gated spec on its own, and kept only when it GREW and drew measurably
 * closer — `spec_unchanged` is then 'partial' and the caller adopts the
 * returned spec.
 */
import { computeBathroomLayout } from '@/components/scene/bathroom/layout';
import { computeKitchenLayout } from '@/components/scene/kitchen/layout';
import type { FitResidual } from '@/lib/api-client';
import { isCustomMaterialId } from '@/lib/materials/match';
import { MAX_ELEMENTS, reconcileSpec } from '@/lib/ai/reconcile';
import { RoomSpecZ } from '@/lib/spec/schema';
import { NO_OPEN_EDGES, frameOpenEdges, resolveOpen } from '@/lib/spec/photo-box';
import type { BathroomSpec, BoxOpenEdges, KitchenSpec, PhotoElement, PhotoElementKind, RoomSpec, SolvedCamera, Wall } from '@/lib/spec/types';
import { clamp } from '@/lib/units';
import { confirmedDimensions } from '@/lib/spec/measurements';
import { bathroomElementBoxes, kitchenElementBoxes, projectElement, projectElementRaw, type TwinElement } from './boxes';
import { DEFAULT_ASPECT, cameraBasis, fromEstimate, makeCamera, roomSize, toEstimate, type Box4, type Pinhole } from './camera';
import { healContract } from './contract';
import { frameStarts, labelHypotheses, readFrame, turnWall, wallFromFacing } from './frame';
import { evolve, mulberry32 } from './optimise';
import {
  ALL_KINDS, bathroomParams, boundSizes, cameraForDims, capped, drawnFacts, honesty, implausibility, jointParams, kitchenParams, moveDim, oversizedChanges,
  restoreFitted, safeGet, scaleCamera, scaleRoom, scans, sizeBase, sizeCap, steps, tidy, withSearchCoordinates, type Dim, type DrawnFacts, type SpecParam,
} from './params';
import { hintFor, repairOpen, residual, type HintContext } from './report';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The default evaluation budget. 6000 stopped both client fixtures mid-search
 * ("ended by evaluations"), which cost client-marble 0.8 of a proportion point
 * and client-shelves its last round; both now CONVERGE and stop on their own,
 * marble after ~12.8k evaluations and 2.7 s. The 20k hard cap in `clamp` below
 * is still the ceiling, and `maxMs` is still the safety net for a slow server.
 */
export const DEFAULT_EVALUATIONS = 16_000;

export interface FitOptions {
  /** photo width ÷ height; defaults to the previous solve's aspect, else 4:3 */
  aspect?: number;
  /** most layout evaluations (spec candidates) the fit may spend — the primary budget; default `DEFAULT_EVALUATIONS` */
  maxEvaluations?: number;
  /** wall-clock safety net in ms (a slow server, never the normal way a fit ends); default 20000 */
  maxMs?: number;
  /** start from this camera instead of the analyzer's estimate */
  camera?: SolvedCamera;
}

export interface FitMatch {
  kind: PhotoElementKind;
  wall: Wall | 'island' | null;
  iou: number;
  twin: Box4;
  /**
   * The photo's box AS SCORED — the inventory's, REPAIRED along the edges it
   * is a cut on (`report.ts repairOpen`). Not the raw inventory box: `iou`,
   * `dx/dy`, `dw/dh` and `err` are all measured against this one, and
   * `residualFromBoxes` (api-client) re-derives those numbers from `photo` and
   * `twin`, so handing it the raw box would make a residual read off the fit
   * and one derived from the boxes disagree — an invariant `check-fit` §7
   * asserts to a nanometre. `open` says which edges were moved.
   */
  photo: Box4;
  photoId: string;
  twinIndex: number;
  /** the element's weight in the loss and the score (√area × confidence × importance) */
  weight: number;
  /** photo centre − twin centre, as a fraction of the frame (+x right, +y down) */
  dx: number;
  dy: number;
  /** photo size ÷ twin size − 1: a DIFFERENCE (+0.18 = the photo's is 18% wider / taller), the same number as `FitResidual.dw/dh` */
  dw: number;
  dh: number;
  /** this pair's proportion error, 0 = the same size in the same place (`report.ts proportionError`) */
  err: number;
  /**
   * Which edges of `photo` are a CUT rather than the element's own boundary.
   * `photo` is the inventory's box exactly as drawn; `iou`, `dx/dy`, `dw/dh`
   * and `err` are all measured against it REPAIRED along these edges
   * (`report.ts repairOpen`), because a cut edge is a lower bound and not a
   * size. Null / all-false when nothing is cut, which is every pair that was
   * scored before the field existed.
   */
  open: BoxOpenEdges | null;
  /**
   * 0..2: how far the twin stops INSIDE the frame edges the photo says this
   * element runs off (`offFrameCost`). 0 when it runs off, which is what the
   * photo said. The loss charges it; `iou` cannot see it, because an IoU is
   * measured in frame coordinates where everything past the border is the
   * same box.
   */
  offFrame: number;
  /**
   * This pair's implied LENS: log(twin image height ÷ photo image height).
   * A pinhole draws a thing of world height H at depth Z with image height
   * f·H/Z, so this is log(f_twin ÷ f_photo) + log(Z_photo ÷ Z_twin) — the
   * lens the twin was drawn with over the lens the photo was taken with,
   * times how much NEARER the twin puts this element than the photo does.
   * Null when the pair is not a size measurement (a shell, a counter item, a
   * box the frame cut top or bottom); those never enter the perspective term.
   * Two pairs whose values differ disagree about where the photographer
   * stood — see `SCALE_WEIGHT`.
   */
  scale: number | null;
}

export type UnmatchedReason =
  /** the twin draws nothing of this kind at all */
  | 'no twin counterpart'
  /** the twin draws this kind, but fewer of them than the photo shows */
  | 'twin has fewer of this kind'
  /** a twin counterpart exists but projects outside the frame */
  | 'not in frame'
  /** kind 'other' never drives the fit */
  | 'kind not scored';

export interface FitUnmatched {
  id: string;
  kind: PhotoElementKind;
  wall: Wall | 'island' | null;
  reason: UnmatchedReason;
  /** what the correction loop should tell the vision model */
  hint: string;
}

export type FitEnd = 'converged' | 'rounds' | 'evaluations' | 'time';

export interface FitResult {
  spec: RoomSpec;
  camera: SolvedCamera;
  /** weighted mean IoU over matched pairs, or null when nothing could be matched */
  score: number | null;
  /** 1 − the weighted mean proportion error over the same pairs: how close the sizes and positions are (1 = exact). NOT the score — it reads 15–20 points higher. */
  proportions: number | null;
  /** matched photo elements ÷ scorable photo elements (everything but kind 'other'), or null when there are none */
  coverage: number | null;
  matched: FitMatch[];
  unmatchedPhoto: FitUnmatched[];
  unmatchedTwin: Array<{ kind: PhotoElementKind; wall: Wall | 'island' | null; index: number }>;
  /** the matched pairs' gaps under the names the client reads (`FitResidual`): one per match, the inventory's label attached */
  residuals: FitResidual[];
  /** the unmatched photo elements' hints in words (everything but kind 'other'), in inventory order */
  hints: string[];
  /** optimiser rounds run (camera, spec and joint rounds all count) */
  iterations: number;
  /** layout evaluations spent */
  evaluations: number;
  ms: number;
  lossBefore: number | null;
  lossAfter: number | null;
  /** what ended the search */
  endedBy: FitEnd;
  /** the ORIGINAL spec's weighted mean IoU through the solved camera — what the plausibility gate compared against */
  originalScore: number | null;
  /**
   * Set when the returned spec is NOT the fit's own answer. 'gated': the gate
   * refused the edits and the input spec came back (adopt the camera alone).
   * 'nothing to fit': there was nothing to measure against. 'partial': the
   * gate refused the aggregate, but a size the photo could not measure
   * (`adoptUnmeasured`) was put back on top of what the gated path would have
   * returned and drew closer to the photo — so the returned spec differs from
   * that gated spec in those sizes alone (plus the island offset that holds
   * the visible end still), and a caller adopts it rather than the camera
   * alone. 'partial' is otherwise an ordinary answer: it is not "unchanged".
   */
  spec_unchanged: 'gated' | 'partial' | 'nothing to fit' | null;
  /** what the fit did that a contractor should know about (a flipped inventory, a scaled room, discarded edits) */
  notes: string[];
}

interface Twin {
  elements: TwinElement[];
  byKey: Map<string, TwinElement>;
  /** what the layout actually drew for the fields it may clamp (kitchens), for `honesty` */
  drawn: DrawnFacts | null;
}

/** A cleaned photo element with the twin wall its `facing` cue implies under the labelling in force (null when it says nothing), and its truncation read once. */
interface FitPhoto extends PhotoElement {
  facingWall: Wall | null;
  trunc: Truncation;
}
const withFacing = (photos: readonly PhotoElement[], turns: number): FitPhoto[] =>
  photos.map((p) => ({ ...p, facingWall: wallFromFacing(p.facing, turns), trunc: truncationOf(p) }));

/** photo element id → twin element key */
type Assignment = Map<string, string>;

/** cost charged when a scored element's twin counterpart is out of frame */
const MAX_COST = 1.5;
/**
 * Added to the pairing cost when the inventory's wall disagrees with the
 * twin's. Small on purpose: about the width of a stool in frame, enough to
 * break a tie between two candidates, never enough to refuse a fridge that
 * lines up with the photo's fridge.
 */
const WALL_HINT_PENALTY = 0.12;
/**
 * Added instead when the element's `facing` cue puts it on another wall
 * than the twin's: about half an element's worth of loss — a strong hint,
 * enough to send a fridge to the right wall's twin over the back wall's
 * when both lie under its box, never an exclusion (the twin may simply
 * have no fridge on that wall, and a fridge paired somewhere beats one
 * paired nowhere). When there is a facing cue the label is not consulted.
 */
const FACING_PENALTY = 0.5;

/**
 * The pairing cost's hint term for one photo element against a twin
 * element on `twinWall`: Infinity for a wall box on another wall (the label
 * IS the identity), else the facing penalty when the cue disagrees, the
 * label penalty when only the label does, 0 when they agree or say nothing.
 * `turns` is the labelling in force (`turnLabels`) — the cue turns with it.
 */
export function hintPenalty(p: Pick<PhotoElement, 'kind' | 'wall' | 'facing'>, twinWall: Wall | 'island' | null, turns = 0): number {
  const label = p.wall && p.wall !== 'island' ? (turns ? turnWall(p.wall, turns) : p.wall) : null;
  const labelDisagree = label !== null && twinWall !== null && label !== twinWall;
  if (labelDisagree && p.kind === 'wall') return Infinity;
  const facingWall = wallFromFacing(p.facing, turns);
  if (facingWall !== null) return twinWall !== null && twinWall !== 'island' && facingWall !== twinWall ? FACING_PENALTY : 0;
  return labelDisagree ? WALL_HINT_PENALTY : 0;
}
/**
 * How much the fitted spec must beat the original by (weighted IoU, both
 * through the solved camera) for its edits to stand: a tenth of the room
 * the original left, never under two points nor over five — an original
 * that already scores 60% is beaten by 64%, one at 90% by 92%.
 */
const gateMargin = (originalScore: number) => clamp(0.1 * (1 - originalScore), 0.02, 0.05);
/**
 * The smallest loss gain that counts as partial adoption having LEARNED
 * something about a size the photo could not measure.
 *
 * A frame-cut island stays cut whichever length it has, so an inch either way
 * redraws nothing the frame can see — and the loss still moves, on rounding
 * and on which pairing the assignment happens to pick. The case that made this
 * visible is check-fit §10(c), a 13×12 room whose best island came out an inch
 * SHORTER than the stub the photo plainly shows and "won" by about a
 * thousandth; the growth-only rule refuses that one outright, and this floor
 * is what stops the same wobble adopting an invisible change in the other
 * direction. A real length correction on the same generator buys ten to a
 * hundred times this, so the floor costs nothing that matters.
 */
const PARTIAL_MIN_GAIN = 1e-4;
/** most spec ↔ camera ↔ joint alternations; the evaluation budget normally ends the fit first */
const MAX_ALTERNATIONS = 12;
/** a full alternation that buys less than this (relative) counts as a stall; two stalls in a row end the fit */
const STALL = 0.003;
/** room scales tried for the starting camera (1 first: prefer the analyzer's size on a tie) */
const SCALES = [1, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3];
/** how the photo area enters an element's weight: 1 = area, 0.5 = its square root (a run outweighs a stool, the floor does not drown either) */
const AREA_POWER = 0.5;
/** the smallest area an element is credited with (a faucet is not weightless) */
const AREA_FLOOR = 0.0025;
/**
 * A tiny pull toward the analyzer's number on every capped size: a full-cap
 * change of one size costs this much loss. Far below any real IoU gain, so
 * a size the photo can see moves freely; decisive on a size the photo
 * cannot see (an island end out of frame), which the joint optimiser would
 * otherwise walk at random along the flat direction.
 */
const PRIOR_WEIGHT = 0.01;
/**
 * How much the proportion error weighs in the LOSS, beside (1 − IoU) and
 * half the centre distance. 0.25 was chosen by measurement, not taste: at
 * this weight both client fixtures gained on BOTH numbers (marble 0.682 →
 * 0.731 IoU, shelves 0.724 → 0.768) and reran byte-identically. It is never
 * added to the pairing cost — see the header.
 */
const PROPORTION_WEIGHT = 0.25;
/** the same idea for a cabinet gap's slide: a full-reach slide costs this much loss */
const SLIDE_PRIOR_WEIGHT = 0.005;
/**
 * TRUNCATION, the only term that pushes an element toward being BIGGER.
 *
 * Repairing the photo box (`repairOpen`) makes overshoot past a cut edge free;
 * it cannot make it wanted. And along a FRAME cut it cannot even do that much,
 * because `projectBox` clamps the twin to the picture: a twin ending exactly
 * at x = 0 and one running three metres past it are the same box, so the loss
 * is flat and `PRIOR_WEIGHT` — designed to settle a flat direction — quietly
 * locks in whatever the analyzer guessed. That is the ratchet that left the
 * client's island a stub.
 *
 * So: when the photo says an element leaves the frame on an edge and
 * `projectBoxRaw` says the twin STOPS INSIDE it, charge for the gap. Never the
 * reverse — running off the picture is exactly what the photo said happens.
 * Frame-cut edges only: an OCCLUDED edge says something stands in front, which
 * is no licence to hang the twin off the side of the picture.
 *
 * HORIZONTAL edges only, and that is a decision, not an oversight. A charge on
 * a left or right cut asks the fit to change a LENGTH — exactly the quantity a
 * cropped photo cannot measure, and exactly the client's complaint. A charge
 * on a top or bottom cut asks it to change the room's HEIGHT or the camera's
 * pitch, which the ceiling and floor pairs already measure directly and well
 * (client-tan's ceiling pair sits at IoU 0.996 and its height is right), and
 * the commonest top-cut box is a pendant, whose box is mostly cord. Measured
 * over the four client fixtures: including the vertical edges moved
 * client-marble-items to 0.6940 mean IoU and client-shelves to 0.7770 against
 * their 0.6964 / 0.7790 without the term, while horizontal-only leaves both
 * BYTE-IDENTICAL to the control at every weight from 0.02 to 0.15.
 *
 * WHAT IT ACTUALLY CHARGES, measured over the two fixtures with a solved
 * camera and asserted in check-fit §9.4b: client-tan 1 of 45 pairs (18 open),
 * client-marble-items 1 of 32 (10 open) — in both cases a shell WALL and
 * nothing else. It is not the island mechanism and must not be reported as
 * one: the island pair's charge is 0.000 because the constraint is already
 * SATISFIED (the twin's raw box runs to x = -0.341, past the frame edge), and
 * what recovers an off-frame island length is the visible end plus the anchor,
 * with `honesty` charging the body's slide so the two are not degenerate.
 *
 * The weight was chosen by sweep, not taste (eight weights × four fixtures,
 * reported in the stream's write-up): 0.08 is the value at which
 * client-marble-items and client-shelves are unchanged, client-tan gains
 * (0.6870 → 0.6871 mean IoU, 0.8488 → 0.8511 proportions) and client-marble
 * gains mean IoU (0.7547 → 0.7551) for 0.004 of proportions, while the term's
 * own sign test — the gate score of client-tan's room at the 17 ft the photo
 * proves it is, against the analyzer's 15.03 — nearly doubles its margin
 * (0.0047 → 0.0080). Above 0.08 nothing further is bought.
 */
const OFF_FRAME_WEIGHT = 0.08;
/** how far inside a cut frame edge a twin may stop before the term saturates: a tenth of the frame */
const OFF_FRAME_SPAN = 0.1;

/**
 * PERSPECTIVE CONSISTENCY — the term that resolves the fov ↔ standoff
 * ambiguity, and the only term that reads more than one pair at a time.
 *
 * A pinhole draws a thing of world height H at depth Z with image height
 * f·H/Z. So for one matched pair
 *
 *     L = log(twin image height ÷ photo image height)
 *       = log(f_twin ÷ f_photo) + log(Z_photo ÷ Z_twin)
 *
 * — the lens the twin was drawn with over the lens the photo was taken with,
 * times how much nearer the twin puts that element than the photo does. Two
 * facts make the SPREAD of L worth charging for.
 *
 *  - Stepping BACK and lengthening the lens redraws the far wall almost
 *    exactly. That is the classic dolly zoom, and it is the fitter's own
 *    seventh camera coordinate (`CAMERA_DIMS`), so the far field ALONE cannot
 *    say where the photographer stood. The near field can: at half the
 *    distance the same move changes an object's image height twice as much.
 *    The photo states both, and a camera has to satisfy both at once.
 *  - IoU cannot state it. Once a pair is 2× out of scale its boxes barely
 *    overlap; the IoU is ~0 for every wrong scale alike and the pair stops
 *    constraining anything — it falls off a cliff, and the far field, which
 *    is easy, then takes the camera unopposed. In LOG size there is no cliff:
 *    twice too big and four times too big are different numbers and the
 *    gradient survives all the way out.
 *
 * So the quantity charged for is the weighted VARIANCE of L over the pairs
 * whose height is a real measurement — never its mean. The mean IS the gauge
 * freedom of a single photograph: scale the room and the standoff together
 * and the picture does not change (`scaleRoom` + `scaleCamera` do exactly
 * that, at 13 scales, on every fit). A term that read the mean would fight
 * that search and break the exact invariance those two rely on; the variance
 * is invariant under it to the last bit, and is zero for ANY correct camera
 * whatever lens it has. What it cannot be zero for is a scene whose near
 * field and far field imply different lenses — precisely the ambiguity
 * resolved wrongly. `Scored.scale` reports its square root (a spread in log
 * size) and `FitMatch.scale` each pair's own L, on every fit, free: the
 * unclamped projection it needs is the one the truncation term already asks
 * for on a couple of kinds (`rawKindsOf`), and the four client fixtures rerun
 * within a per cent of their previous wall-clock.
 *
 * MEASURED at HEAD's own solve on the four client fixtures — the near half of
 * the measuring pairs' implied lens over the far half's (1.00 = the two halves
 * of the room agree about the camera):
 *
 *     fixture              pairs  spread  near/far  solved fovV
 *     client-shelves          14   0.104      0.91       45.0°
 *     client-marble           14   0.257      0.87       41.8°
 *     client-marble-items     12   0.459      1.55       59.7°
 *     client-tan               8   0.527      2.39       57.4°
 *
 * — systematic, not one fixture, and the two that disagree are exactly the
 * two the search gave the widest lenses, standing correspondingly close. On
 * client-tan the back wall's four pairs come in at ×0.95 (right to 5%) while
 * the RIGHT wall's, two metres nearer, come in at ×2.28 — its upper run is
 * drawn 4.4× too tall. client-marble-items says the same in its own words:
 * back wall ×1.00, left wall ×1.48, its left base run ×3.34.
 */
const SCALE_WEIGHT = 4;
/**
 * The deadband: spread charged past, and not below.
 *
 * WHAT THIS ROUND IS. Say it plainly, because the arithmetic above reads like
 * a camera constraint and it is not one. On a CORRECT twin with its own
 * inventory the spread is BOUNDED, and far below this number — so no camera
 * error, however absurd, can arm the round on a twin that is right. Measured
 * (check-fit §11(e), three rooms), walking the dolly-zoom ambiguity's own
 * direction from the truth camera out to 256 m back with the lens lengthened
 * to hold the far wall: the spread rises to 0.062–0.070 at 16 m and falls
 * back to zero beyond it — it cannot exceed ~0.07, because past a point every
 * element is far away and they all agree again. Adding ±3.5% of annotation
 * jitter on top, at the worst step of that walk, reaches 0.093. So ~0.1 is
 * everything a correct twin can produce, and this deadband stands at 3.8×
 * that on purpose: what remains above it is not a camera that wandered, it is
 * an inventory that cannot be reproduced by ANY camera — a box drawn around
 * something that is not the object (client-tan's island, traced with the
 * vases standing on it) or two boxes that contradict each other. The round is
 * a repair for those, and the four client fixtures are its only live domain
 * (0.10 / 0.24 / 0.46 / 0.53). It is not a constraint that sharpens a good
 * fit, and it should not be described as one.
 *
 * The number itself is therefore chosen for the property that matters — that
 * the round is provably INERT on any correct twin, whatever camera the search
 * happens to be holding — and not from where the fixtures happened to fall.
 * The fixtures only say which of them it reaches: client-marble and
 * client-shelves come back byte-identical, and the two that disagree with
 * their own near field are re-solved.
 */
export const SCALE_TOL = 0.35;
/**
 * WHAT THE PERSPECTIVE ROUND CAN AND CANNOT BUY, measured before this weight
 * was chosen, because it decides what the round is allowed to do.
 *
 * Sweeping the charge in a camera-only search on client-tan's DELIVERED spec
 * traces the whole trade-off curve, and it is steep: spread 0.53 → 0.40 costs
 * 7% of the geometric loss, → 0.29 costs 12%, and the reported photo match
 * falls 0.69 → 0.64. There is no free consistent camera for that geometry,
 * and the reason is not the lens: client-tan's fit is GATED, so the camera it
 * delivers is solved against the analyzer's spec — a 5 ft island in a 15 ft
 * room — and no standpoint reproduces both halves of a room that shape. The
 * same fit with the perspective charge in the LOSS (so the spec moves with
 * the camera) reaches spread 0.256 at the same IoU and better proportions,
 * which says the near-field error is jointly the spec's; and repairing the
 * one contaminated box in that inventory — the island's, which the annotator
 * drew from a vase on the counter to the bottom of the frame — moves the
 * solve from 57.8° to 52.3°, a third of a metre further back, and improves
 * the photo match (0.687 → 0.696), the proportions (0.850 → 0.858) AND the
 * consistency (0.533 → 0.419) together.
 *
 * So the round is deliberately a chooser, not an overruler: it takes a
 * consistent camera when one is free and refuses to buy one when it is not.
 * At this weight the charge is worth ~0.13 of loss at client-tan's spread,
 * enough to walk a pattern search out of the near basin, while
 * `PERSPECTIVE_SLACK` decides whether the answer is kept.
 */
/** the perspective round's own evaluation cap — a camera-only pattern search, so these are cheap moves */
const PERSPECTIVE_EVALS = 600;
/**
 * How much geometric loss the perspective round may give up for a consistent
 * camera: a fortieth of it, floored so a fit that is already excellent still
 * has room to trade a hair. The round exists to choose ALONG the direction
 * IoU cannot see, never to overrule it — where the near field genuinely
 * cannot be reconciled with the far field by moving the camera (the twin's
 * geometry, or a contaminated box, is what disagrees), the trade fails this
 * test and the incumbent camera stands.
 */
const PERSPECTIVE_SLACK = 0.025;
const PERSPECTIVE_SLACK_FLOOR = 0.004;
/** …and how much spread a PAID move must buy to be worth its price (in log size, about a sixth of a stop) */
const PERSPECTIVE_MIN_GAIN = 0.05;
/** the joint attempt's evaluation cap (layout runs), spent only when the camera alone could not buy a consistent perspective */
const PERSPECTIVE_JOINT_EVALS = 1200;
/** its seed — the round is a seeded evolution strategy, and this fit must rerun byte-identically */
const PERSPECTIVE_SEED = 0x9e3779b9;
/**
 * The kinds whose photo box outlines an object, so its HEIGHT measures that
 * object's distance. Shells are frame artefacts (a wall box is as tall as the
 * picture); `item` / `plant` / `art` are the detector's least repeatable boxes
 * at a quarter to a half the weight; a `faucet` is a gooseneck's arc and a
 * `pendant` mostly cord. `backsplash` is left out for a different reason —
 * its height is a spec field the fit itself searches, and the twin's box adds
 * a fixed strip of counter, so it would let the search answer a question
 * about the CAMERA by changing a cabinet detail.
 */
export const SCALE_KINDS: ReadonlySet<PhotoElementKind> = new Set<PhotoElementKind>([
  'base-cabinet-run', 'upper-cabinet-run', 'tall-cabinet', 'fridge', 'range', 'cooktop', 'hood', 'dishwasher', 'wall-oven', 'microwave',
  'sink', 'window', 'door', 'island', 'stool', 'shelf',
  'vanity', 'mirror', 'shower', 'tub', 'toilet',
]);
/**
 * Below this many measuring pairs the spread is box-convention noise rather
 * than a statement about the lens, and the term is off. Four is what the
 * thinnest client fixture keeps after the vertical-cut filter with room to
 * spare (client-tan keeps 8 of 45 pairs, client-shelves 15 of 29).
 */
const SCALE_MIN_PAIRS = 4;
/** a box thinner than this in frame is not a height measurement (a hundredth of the picture) */
const SCALE_MIN_SIDE = 0.01;

const WALL_VALUES = new Set<string>(['back', 'left', 'right', 'front', 'island']);
const FACING_VALUES = new Set<string>(['front', 'left', 'right', 'edge']);
const SHELL_KINDS = new Set<PhotoElementKind>(['wall', 'floor', 'ceiling']);

/** How much a wrong placement of each kind hurts. Runs, island and the big appliances define a kitchen; a stool or a plant is set dressing. */
const IMPORTANCE: Partial<Record<PhotoElementKind, number>> = {
  'base-cabinet-run': 2, 'upper-cabinet-run': 2, island: 2, fridge: 2, range: 2, cooktop: 2, hood: 2, window: 2,
  vanity: 2, shower: 2, tub: 2,
  stool: 0.5, plant: 0.5,
  // a counter item is 1–3% of the frame and the detector's least repeatable
  // box: with the √area weight this is about a tenth of a stool's, so a pot
  // drawn in the wrong place can never steer the camera
  item: 0.25,
};

/**
 * Kinds that are the same box to a photo. A cooktop set in a run and a
 * slide-in range fill the same rectangle of counter; the inventory model
 * picks one word, the analyzer may pick the other.
 */
const FAMILY: Partial<Record<PhotoElementKind, PhotoElementKind>> = { cooktop: 'range' };
const family = (kind: PhotoElementKind): PhotoElementKind => FAMILY[kind] ?? kind;

const keyOf = (e: TwinElement) => `${e.kind}|${e.wall ?? ''}|${e.index}`;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface Cleaned {
  elements: PhotoElement[];
  /** the boxes came bottom-left-origin and were flipped */
  flipped: boolean;
  notes: string[];
}

function cleanElementsDetailed(spec: RoomSpec): Cleaned {
  const raw = spec.detected && Array.isArray(spec.detected.elements) ? spec.detected.elements : [];
  const out: PhotoElement[] = [];
  raw.slice(0, MAX_ELEMENTS).forEach((e, i) => {
    if (!e || typeof e !== 'object') return;
    const b = e.box;
    if (!b || typeof b !== 'object') return;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : NaN);
    let x0 = n(b.x0), y0 = n(b.y0), x1 = n(b.x1), y1 = n(b.y1);
    if ([x0, y0, x1, y1].some((v) => Number.isNaN(v))) return;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return;
    const kind = ALL_KINDS.includes(e.kind) ? e.kind : 'other';
    const wall = typeof e.wall === 'string' && WALL_VALUES.has(e.wall) ? (e.wall as PhotoElement['wall']) : null;
    const confidence = typeof e.confidence === 'number' && Number.isFinite(e.confidence) ? clamp(e.confidence, 0, 1) : 0.5;
    const facing = typeof e.facing === 'string' && FACING_VALUES.has(e.facing) ? e.facing : null;
    // Truncation survives the clean, and is re-derived from the CLEANED box:
    // this list is rebuilt field by field, so a plain spread would drop
    // `open` / `openCause` and the fit would go blind again — and the box it
    // is a fact about is the one clamped and un-inverted just above, not the
    // one the annotator sent. Same helper the reconciler and `healContract`
    // use, so a hand-built element with no `open` still gets its frame edges.
    const { open, openCause } = resolveOpen({ x0, y0, x1, y1 }, e.open, e.openCause);
    out.push({
      id: typeof e.id === 'string' && e.id ? e.id : `el-${i}`,
      kind, wall,
      box: { x0, y0, x1, y1 },
      facing,
      label: typeof e.label === 'string' ? e.label : '',
      confidence,
      open,
      openCause,
    });
  });
  // duplicate ids would collapse the assignment map
  const seen = new Set<string>();
  let elements = out.map((e) => {
    let id = e.id;
    while (seen.has(id)) id = `${id}'`;
    seen.add(id);
    return id === e.id ? e : { ...e, id };
  });
  // Our boxes have (0, 0) at the TOP-left; a model that answered in
  // bottom-left-origin coordinates puts the floor above the ceiling. That is
  // unambiguous whenever both are in the list, and every box is then flipped
  // the same way rather than the fit quietly scoring an upside-down room.
  const notes: string[] = [];
  let flipped = false;
  const floor = elements.find((e) => e.kind === 'floor');
  const ceiling = elements.find((e) => e.kind === 'ceiling');
  const midY = (e: PhotoElement) => (e.box.y0 + e.box.y1) / 2;
  if (floor && ceiling && midY(floor) < midY(ceiling)) {
    // turning the picture over turns its cut edges over with it — a floor cut
    // by the BOTTOM of a bottom-left-origin frame is cut by the top of ours
    elements = elements.map((e) => ({
      ...e,
      box: { x0: e.box.x0, y0: 1 - e.box.y1, x1: e.box.x1, y1: 1 - e.box.y0 },
      open: e.open ? { ...e.open, top: e.open.bottom, bottom: e.open.top } : e.open,
    }));
    flipped = true;
    notes.push('inventory boxes had the floor above the ceiling (bottom-left origin) — every box was flipped top-to-bottom');
  }
  return { elements, flipped, notes };
}

/** The inventory, defensively: bad numbers clamped, reversed boxes flipped, slivers and junk dropped, a bottom-left-origin list turned the right way up (`notes` says when). */
export function cleanElements(spec: RoomSpec, notes?: string[]): PhotoElement[] {
  const c = cleanElementsDetailed(spec);
  notes?.push(...c.notes);
  return c.elements;
}

const box4 = (b: PhotoElement['box']): Box4 => [b.x0, b.y0, b.x1, b.y1];

function iou(a: Box4, b: Box4): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 1e-12 ? inter / union : 0;
}

function centreDist(a: Box4, b: Box4): number {
  return Math.hypot((a[0] + a[2] - b[0] - b[2]) / 2, (a[1] + a[3] - b[1] - b[3]) / 2);
}

const areaOf = (p: PhotoElement) => Math.max(AREA_FLOOR, (p.box.x1 - p.box.x0) * (p.box.y1 - p.box.y0));
const weightOf = (p: PhotoElement) => Math.pow(areaOf(p), AREA_POWER) * Math.max(0.2, p.confidence) * (IMPORTANCE[p.kind] ?? 1);

function twinFor(spec: RoomSpec): Twin | null {
  try {
    let elements: TwinElement[];
    let drawn: DrawnFacts | null = null;
    if (spec.roomType === 'kitchen') {
      const L = computeKitchenLayout(spec);
      elements = kitchenElementBoxes(L);
      drawn = drawnFacts(L);
    } else if (spec.roomType === 'bathroom') elements = bathroomElementBoxes(computeBathroomLayout(spec));
    else return null;
    return { elements, byKey: new Map(elements.map((e) => [keyOf(e), e])), drawn };
  } catch {
    return null;
  }
}

/** photo-frame boxes of the twin's elements, by key; null when out of frame */
type Projected = Map<string, Box4 | null>;
/**
 * The same elements UNCLAMPED, for the truncation term only, and only for the
 * kinds some photo box is frame-cut on — the raw projection costs a second
 * pass over eight corners per box, and on every fixture we have that is a
 * handful of kinds out of thirty.
 */
type ProjectedRaw = Map<string, Box4 | null>;

/**
 * Every twin element projected into the frame. An element with `faces`
 * projects as the union of its faces' boxes rather than its whole AABB —
 * the way a photo boxes a run of base cabinets: the counter's front edge
 * on top, the floor line at the WALL below (the front-bottom edge is behind
 * the island, the stools or the toe-kick shadow in every photo we have).
 *
 * `rawKinds` (`rawKindsOf`: the families some photo box is frame-cut on, plus
 * the families the perspective term measures) also get the unclamped
 * projection, so the truncation term can tell "the twin runs off the picture
 * here" from "the twin stops at the edge", and the perspective term reads an
 * element's real size rather than the part of it the border left.
 */
function projectAll(twin: Twin, pin: Pinhole, rawKinds?: ReadonlySet<PhotoElementKind>): { projected: Projected; raw: ProjectedRaw } {
  const projected: Projected = new Map();
  const raw: ProjectedRaw = new Map();
  for (const t of twin.elements) {
    const key = keyOf(t);
    projected.set(key, projectElement(pin, t));
    if (t.alt) projected.set(`${key}|${t.alt.kind}`, pin.projectBox(t.alt.box));
    if (rawKinds && rawKinds.has(family(t.kind))) {
      raw.set(key, projectElementRaw(pin, t));
      if (t.alt) raw.set(`${key}|${t.alt.kind}`, pin.projectBoxRaw(t.alt.box));
    }
  }
  return { projected, raw };
}

/** The twin box a photo element is judged against: the element's own, or the one it keeps for the photo's kind. */
const boxFor = (projected: Projected, t: TwinElement, photoKind: PhotoElementKind): Box4 | null =>
  (t.alt && t.alt.kind === photoKind ? projected.get(`${keyOf(t)}|${photoKind}`) : projected.get(keyOf(t))) ?? null;
/** …and the key its unclamped twin box is filed under. */
const rawKeyFor = (t: TwinElement, photoKind: PhotoElementKind): string =>
  (t.alt && t.alt.kind === photoKind ? `${keyOf(t)}|${photoKind}` : keyOf(t));

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/**
 * What the photo's own box says about each edge: which are cut, and whether
 * the FRAME is what cut them. Precomputed once per fit — `frameOpenEdges` is
 * four comparisons but the loss runs it millions of times otherwise.
 */
interface Truncation {
  open: BoxOpenEdges;
  /** an edge the frame cut AND the element is open on: the only edges OFF_FRAME may charge for */
  offFrame: BoxOpenEdges;
  any: boolean;
  anyOffFrame: boolean;
}

const NO_TRUNCATION: Truncation = { open: NO_OPEN_EDGES, offFrame: NO_OPEN_EDGES, any: false, anyOffFrame: false };

function truncationOf(p: PhotoElement): Truncation {
  const open = p.open ?? NO_OPEN_EDGES;
  const any = open.left || open.right || open.top || open.bottom;
  if (!any) return NO_TRUNCATION;
  // 'occluded' says something stands in front, which is no evidence at all
  // about the twin running off the picture; 'both' carries the frame half.
  const byFrame = p.openCause === 'frame' || p.openCause === 'both';
  const atFrame = byFrame ? frameOpenEdges(p.box) : NO_OPEN_EDGES;
  const offFrame: BoxOpenEdges = {
    left: open.left && atFrame.left,
    right: open.right && atFrame.right,
    top: open.top && atFrame.top,
    bottom: open.bottom && atFrame.bottom,
  };
  // A box open on BOTH sides of an axis is excluded on that axis (the vertical
  // pair is computed even though the term ignores it, so `anyOffFrame` means
  // one thing). This is the
  // shell-plane decision (contract §9.4), taken as a rule rather than a kind
  // list: a floor open left AND right, or a ceiling open top AND bottom, says
  // only "the camera is inside the room", which is true of every interior
  // photo ever taken — charging for it would be a constant downward pressure
  // on the room's size on EVERY fixture, not just the one with the cropped
  // island. One-sided evidence is real and stays: `wall-back-1` cut on the
  // left really does say the room continues past the picture there, and
  // `floor-1`, cut only at the bottom, really does continue below it.
  if (offFrame.left && offFrame.right) { offFrame.left = false; offFrame.right = false; }
  if (offFrame.top && offFrame.bottom) { offFrame.top = false; offFrame.bottom = false; }
  const anyOffFrame = offFrame.left || offFrame.right || offFrame.top || offFrame.bottom;
  return { open, offFrame, any, anyOffFrame };
}

/**
 * 0..2: how far the twin stops INSIDE the frame edges the photo says it runs
 * off, one saturating hinge per open edge. 0 when it runs off (which is what
 * was asked for) and 0 when the raw box is unavailable.
 */
function offFrameCost(t: Truncation, raw: Box4 | null | undefined): number {
  if (!t.anyOffFrame || !raw) return 0;
  const hinge = (gap: number) => (gap <= 0 ? 0 : Math.min(1, gap / OFF_FRAME_SPAN));
  let sum = 0;
  if (t.offFrame.left) sum += hinge(raw[0]);
  if (t.offFrame.right) sum += hinge(1 - raw[2]);
  // top / bottom cuts are deliberately not charged — see OFF_FRAME_WEIGHT
  return sum;
}

// ---------------------------------------------------------------------------
// Matching + loss
// ---------------------------------------------------------------------------

/**
 * Which photo elements the fit is judged on, fixed for the whole fit from the
 * twin it STARTED with — so a spec change that drops an element (an island
 * shrunk to nothing) cannot make the loss go down by removing its term, and a
 * spec change that adds one cannot be rewarded for a pairing that was never
 * asked for.
 */
interface Scoring {
  /** ids of the photo elements that count: a kind the twin draws, never 'other' */
  ids: Set<string>;
  /** per kind family, how many more of it the photo shows than the twin draws — that many unpaired ones are surplus, not "out of frame" */
  surplus: Map<PhotoElementKind, number>;
  /** how many of each kind family the starting twin draws */
  twinCount: Map<PhotoElementKind, number>;
}

function scoringFor(photos: PhotoElement[], twin: Twin): Scoring {
  const twinCount = new Map<PhotoElementKind, number>();
  for (const t of twin.elements) twinCount.set(family(t.kind), (twinCount.get(family(t.kind)) ?? 0) + 1);
  const ids = new Set<string>();
  const photoCount = new Map<PhotoElementKind, number>();
  for (const p of photos) {
    if (p.kind === 'other') continue;
    const fam = family(p.kind);
    if (!twinCount.has(fam)) continue;
    ids.add(p.id);
    photoCount.set(fam, (photoCount.get(fam) ?? 0) + 1);
  }
  const surplus = new Map<PhotoElementKind, number>();
  for (const [fam, n] of photoCount) {
    const extra = n - (twinCount.get(fam) ?? 0);
    if (extra > 0) surplus.set(fam, extra);
  }
  return { ids, surplus, twinCount };
}

/**
 * Minimum-cost bipartite matching (Kuhn–Munkres) of `rows` to `cols` with
 * costs `cost[r][c]`; a missing pair is `Infinity`. Returns the column each
 * row got, or -1. Greedy nearest-first pairing crossed a pair of shelf boards
 * (one perfect pair, one hopeless one) where the two slightly-off pairs
 * were the truth; the optimum never does. Sizes here are tiny (the stools,
 * the shelves, the pendants of one kind), so O(n³) is nothing.
 */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = n ? Math.max(n, ...cost.map((r) => r.length)) : 0;
  if (!n || !m) return cost.map(() => -1);
  const BIG = 1e6;
  const a = (i: number, j: number) => { const v = cost[i - 1]?.[j - 1]; return v !== undefined && Number.isFinite(v) ? v : BIG; };
  const u = new Array<number>(n + 1).fill(0), v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0), way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a(i0, j) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] && a(p[j], j) < BIG / 2) out[p[j] - 1] = j - 1;
  return out;
}

/**
 * Photo ↔ twin pairing: within each kind family, the matching of scored photo
 * elements to in-frame twin elements that minimises the LOSS — each pair
 * costs its weighted loss term, and every photo element may instead be left
 * unpaired at its weighted MAX_COST (a drop column of its own), so a
 * confident element is paired before a doubtful one and a hopeless pairing
 * is refused rather than forced. A wall disagreement adds a small penalty —
 * the inventory's wall is a hint, except for the walls themselves, where the
 * label IS the identity ("the right wall" cannot be the twin's front wall
 * however the boxes lie). Deterministic.
 */
function assign(photos: FitPhoto[], scoring: Scoring, twin: Twin, projected: Projected): Assignment {
  const groups = new Map<PhotoElementKind, FitPhoto[]>();
  for (const p of photos) {
    if (!scoring.ids.has(p.id)) continue;
    const fam = family(p.kind);
    const g = groups.get(fam) ?? [];
    g.push(p);
    groups.set(fam, g);
  }
  const out: Assignment = new Map();
  for (const [fam, rows] of groups) {
    const cols = twin.elements.filter((t) => family(t.kind) === fam && projected.get(keyOf(t)));
    if (!cols.length) continue;
    // the pairing cost is the weighted loss term itself, so the matching
    // minimises what the fit minimises — centre distance alone paired a short
    // filler run with the photo's long run because their centres almost
    // coincided; columns past the twin elements are the per-row drop columns
    const cost = rows.map((p, r) => {
      const pb = box4(p.box);
      const w = weightOf(p);
      const pairs = cols.map((t) => {
        // the facing cue, when there is one, is the wall hint; the label
        // only when there is not — and a wall box IS its label
        const labelDisagree = p.wall !== null && t.wall !== null && p.wall !== t.wall;
        if (labelDisagree && p.kind === 'wall') return Infinity;
        const tb = boxFor(projected, t, p.kind);
        if (!tb) return Infinity;
        const hint = p.facingWall !== null
          ? (t.wall !== null && t.wall !== 'island' && p.facingWall !== t.wall ? FACING_PENALTY : 0)
          : (labelDisagree ? WALL_HINT_PENALTY : 0);
        // The REPAIR is here as well as in the loss, and must be: it changes
        // which BOXES are compared, so leaving it out would have the matching
        // and the loss disagree about which pair is better.
        //
        // The truncation TERM is not, for the same reason `PROPORTION_WEIGHT`
        // is not (see the file header): a weighting term in the pairing cost
        // shifts the drop columns, which are denominated in (1 − IoU) +
        // ½ centre distance, and flips a fixture into a basin that drops
        // pairings outright. Measured — with the term in the pairing cost,
        // client-marble fell from mean IoU 0.755 to 0.622 with 27 pairs
        // instead of 29 at OFF_FRAME_WEIGHT 0.05, 0.1 and 0.3 while passing
        // at 0.15 and 0.2, i.e. a knife edge, which is exactly the symptom
        // the proportion term's note describes. In the loss alone it is
        // monotone on all four fixtures.
        const rb = p.trunc.any ? repairOpen(pb, tb, p.trunc.open) : pb;
        return w * ((1 - iou(rb, tb)) + 0.5 * centreDist(rb, tb) + hint);
      });
      const drops = rows.map((_, r2) => (r2 === r ? w * MAX_COST : Infinity));
      return [...pairs, ...drops];
    });
    hungarian(cost).forEach((c, r) => { if (c >= 0 && c < cols.length) out.set(rows[r].id, keyOf(cols[c])); });
  }
  return out;
}

interface Scored {
  loss: number;
  matches: FitMatch[];
  /** unpaired photo elements written off as surplus (the twin draws fewer of their kind) */
  surplusIds: Set<string>;
  /**
   * The perspective spread already folded into `loss`: the weighted standard
   * deviation of the measuring pairs' `scale`, in log units. 0 when every
   * measuring pair implies the same lens (and when there are too few of them
   * to ask). See `SCALE_WEIGHT`.
   */
  scale: number;
}

/** The loss for one (twin, camera, assignment). */
function evaluate(photos: FitPhoto[], scoring: Scoring, twin: Twin, projected: Projected, raw: ProjectedRaw, assignment: Assignment): Scored {
  let total = 0, sumW = 0;
  // the perspective term's running sums (weight, ΣwL, ΣwL²) — see SCALE_WEIGHT
  let scaleW = 0, scaleSum = 0, scaleSq = 0, scaleN = 0;
  const matches: FitMatch[] = [];
  const unpaired = new Map<PhotoElementKind, PhotoElement[]>();
  for (const p of photos) {
    if (!scoring.ids.has(p.id)) continue;
    const key = assignment.get(p.id);
    const t = key ? twin.byKey.get(key) : undefined;
    const tb = t ? boxFor(projected, t, p.kind) : null;
    if (!t || !tb) {
      const fam = family(p.kind);
      const list = unpaired.get(fam) ?? [];
      list.push(p);
      unpaired.set(fam, list);
      continue;
    }
    const w = weightOf(p);
    sumW += w;
    const pb = box4(p.box);
    // An open edge is a LOWER bound, not a size: repaired first, so overshoot
    // past a cut is free and stopping short still pays in full. And where the
    // FRAME did the cutting, `repairOpen` cannot help — the twin's box is
    // clamped to the picture, so both boxes end at the same edge whatever the
    // twin really does — which is what the truncation term is for.
    const rb = p.trunc.any ? repairOpen(pb, tb, p.trunc.open) : pb;
    const overlap = iou(rb, tb);
    const res = residual(pb, tb, p.trunc.open);
    const off = p.trunc.anyOffFrame ? OFF_FRAME_WEIGHT * offFrameCost(p.trunc, raw.get(rawKeyFor(t, p.kind))) : 0;
    total += w * ((1 - overlap) + 0.5 * centreDist(rb, tb) + PROPORTION_WEIGHT * res.err + off);
    // This pair's implied lens, when its height is a measurement at all: the
    // photo's own box (never the repaired one — the repair only ever moves an
    // edge the frame or an object cut, and a pair that IS cut top or bottom
    // is excluded here anyway) against the twin's UNCLAMPED box, so a twin
    // that runs off the picture is measured at the size it really has rather
    // than the size the border leaves of it.
    let scale: number | null = null;
    if (SCALE_KINDS.has(p.kind) && !p.trunc.open.top && !p.trunc.open.bottom) {
      const rawBox = raw.get(rawKeyFor(t, p.kind));
      const ht = rawBox ? rawBox[3] - rawBox[1] : 0;
      const hp = pb[3] - pb[1];
      if (ht >= SCALE_MIN_SIDE && hp >= SCALE_MIN_SIDE) {
        scale = Math.log(ht / hp);
        scaleW += w; scaleSum += w * scale; scaleSq += w * scale * scale; scaleN++;
      }
    }
    matches.push({ kind: p.kind, wall: t.wall, iou: overlap, twin: tb, photo: rb, photoId: p.id, twinIndex: t.index, weight: w, open: p.trunc.any ? p.trunc.open : null, offFrame: off > 0 ? off / OFF_FRAME_WEIGHT : 0, scale, ...res });
  }
  // The surplus of a kind is whichever of its unpaired elements matter least
  // (lowest weight); everything else unpaired has a counterpart that is out
  // of frame, which is the camera's fault and costs the maximum.
  const surplusIds = new Set<string>();
  for (const [fam, list] of unpaired) {
    list.sort((a, b) => weightOf(a) - weightOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const skip = scoring.surplus.get(fam) ?? 0;
    list.forEach((p, i) => {
      if (i < skip) { surplusIds.add(p.id); return; }
      const w = weightOf(p);
      sumW += w;
      total += w * MAX_COST;
    });
  }
  // The variance of the implied lens, added to the MEAN loss (it is itself a
  // mean over pairs, so the two are in the same units). Never the mean of the
  // implied lens — that is the single photograph's gauge freedom, and the
  // room-scale search rides on it.
  let spread = 0;
  if (scaleN >= SCALE_MIN_PAIRS && scaleW > 0) {
    const mean = scaleSum / scaleW;
    spread = Math.sqrt(Math.max(0, scaleSq / scaleW - mean * mean));
  }
  return { loss: sumW > 0 ? total / sumW : 0, matches, surplusIds, scale: spread };
}

/** Project, pair (unless a pairing is given) and score a twin through a camera. */
function scoreAt(photos: FitPhoto[], scoring: Scoring, twin: Twin, pin: Pinhole, rawKinds: ReadonlySet<PhotoElementKind>, assignment?: Assignment): Scored {
  const { projected, raw } = projectAll(twin, pin, rawKinds);
  return evaluate(photos, scoring, twin, projected, raw, assignment ?? assign(photos, scoring, twin, projected));
}

/** Weighted mean IoU over the matches — the score. */
const scoreOf = (matches: FitMatch[]): number | null => {
  let s = 0, w = 0;
  for (const m of matches) { s += m.weight * m.iou; w += m.weight; }
  return w > 0 ? s / w : null;
};

/**
 * The PLAUSIBILITY GATE's currency, and only its currency.
 *
 * `scoreOf` above is the reported "photo match" and stays a plain weighted
 * mean IoU — it is a number contractors read and it must keep meaning one
 * thing. But an IoU is measured in FRAME coordinates, where a twin that stops
 * a tenth of the picture inside a cut edge and one that runs three metres past
 * it are the same box. On a photo that crops the room that is exactly the
 * comparison the gate has to make, so it would keep discarding the fit that
 * got the truncation right in favour of the analyzer's guess — which is the
 * client's island, discarded by the gate on every run.
 *
 * So the gate reads each pair's IoU LESS the truncation penalty the LOSS
 * already charges for it, at the same weight. Both specs are measured this way,
 * through the same camera, and `gateMargin` is untouched: this is not a looser
 * gate, it is the same gate reading a quantity that can tell the two specs
 * apart. With no cut boxes it is `scoreOf` exactly.
 */
const gateScoreOf = (matches: FitMatch[]): number | null => {
  let s = 0, w = 0;
  for (const m of matches) { s += m.weight * Math.max(0, m.iou - OFF_FRAME_WEIGHT * m.offFrame); w += m.weight; }
  return w > 0 ? s / w : null;
};

/** 1 − the weighted mean proportion error over the same matches — how close the sizes and positions are. */
const proportionsOf = (matches: FitMatch[]): number | null => {
  let s = 0, w = 0;
  for (const m of matches) { s += m.weight * m.err; w += m.weight; }
  return w > 0 ? 1 - s / w : null;
};

/**
 * The kind families that need the second, UNCLAMPED projection: the ones some
 * photo box is frame-cut on (the truncation term compares against those), plus
 * the ones the perspective term measures a height on (`SCALE_KINDS`, where a
 * twin clipped by the border would otherwise read as a shorter object rather
 * than a nearer one). Everything else is projected once, clamped, as before.
 */
function rawKindsOf(photos: readonly FitPhoto[]): Set<PhotoElementKind> {
  const out = new Set<PhotoElementKind>();
  for (const p of photos) {
    if (p.trunc.anyOffFrame) out.add(family(p.kind));
    if (SCALE_KINDS.has(p.kind) && !p.trunc.open.top && !p.trunc.open.bottom) out.add(family(p.kind));
  }
  return out;
}

/**
 * Which spec sizes the photo could not measure, because the box that measures
 * them is cut on that axis — the `unmeasured` flag `params.ts capped` reads.
 *
 * The client's complaint in one sentence: the island runs off the left of the
 * picture, the analyzer measured the stub, and three separate mechanisms then
 * refused to let the fit grow it — the gate's ±25% island cap, the search
 * bound derived from it, and the prior pulling back to the analyzer's number.
 * All three exist to stop the search wandering along a direction the photo
 * cannot see. On a CUT axis that reasoning inverts: the photo cannot see it
 * BECAUSE the element leaves the frame, so the analyzer's number is a guess
 * and holding the fit to it locks the guess in. The truncation term supplies
 * the gradient the direction was missing, so it is no longer flat and the
 * three restraints have nothing left to protect.
 *
 * Deliberately narrow: the ISLAND's length, and nothing else. A cabinet RUN's
 * length looks like the same case and is not — a run is anchored by its own
 * `start` fraction, `implausibility` holds it inside its wall, and it shares
 * that wall with the uppers, the appliances and the splash, all of which the
 * photo CAN see, so the analyzer's number is corroborated by measured things
 * and the 30% cap costs nothing. Freeing it was measured, not assumed: on
 * client-marble (whose left run is frame-cut) it took the fit from mean IoU
 * 0.755 to 0.622 and into the gate, by turning a corroborated number loose in
 * a direction that then dragged the tall units past their own caps. An island
 * is free-standing; nothing but its own box measures its length, so when that
 * box is cut there is nothing left to hold it to.
 */
function unmeasuredLabels(photos: readonly FitPhoto[], spec: RoomSpec): Set<string> {
  const out = new Set<string>();
  if (spec.roomType !== 'kitchen') return out;
  for (const p of photos) {
    // a side cut is a cut along the LONG axis: a top or bottom cut says
    // nothing about a length
    if (p.kind !== 'island' || (!p.trunc.offFrame.left && !p.trunc.offFrame.right)) continue;
    out.add('island.lengthFt');
  }
  return out;
}

/**
 * PARTIAL ADOPTION: the one edit a rejected fit is still allowed to keep.
 *
 * The plausibility gate is all-or-nothing on purpose. It exists to stop a
 * search that wandered somewhere the photo cannot see from being handed back
 * as a measurement, and when the aggregate does not clearly beat the original
 * the honest answer is "I did not learn anything", so everything goes.
 *
 * On a FRAME-CUT axis that reasoning inverts, exactly as it does for the caps
 * in `unmeasuredLabels` above. Keeping the original there is not the safe
 * default — it is keeping a different guess. The analyzer measured the visible
 * stub of the client's island and wrote 5.0 ft because the box stops at the
 * edge of the picture; that number is an ADMITTED guess, not a measurement, so
 * "the fit did not beat it by 3 points" says nothing about which of the two is
 * closer to the kitchen. And the direction is no longer flat: the truncation
 * term supplies the gradient the axis was missing, so what the search finds
 * there is driven by evidence rather than by drift.
 *
 * So when the gate rejects the aggregate, do not fall all the way back: write
 * the `unmeasured` sizes back on top of the spec the gated path just chose,
 * and keep the result only when it draws MEASURABLY closer to the photo
 * through the same re-solved camera. The gate's real safety property — never
 * hand back something further from the photo than what you were given — is
 * kept intact, while the single edit the photo corroborates survives.
 *
 * THE BASE IS THE FALLBACK, NOT THE ANALYZER'S SPEC. It is tempting to build
 * the candidate from `original` and reconcile it afresh, and it is wrong: the
 * gated path a few lines above has ALREADY decided, by the same loss, whether
 * the reconciler's version of the original draws better than the plain tidied
 * one, and sometimes it decided against it and said so in a note. Rebuilding
 * from `original` re-runs that decision on a spec with a different island and
 * can let the rejected version back in on the coat-tails of the island edit —
 * measured: a 13×12 kitchen came back with three decor items the analyzer
 * never saw, un-rounded appliance and sink positions, and (on a 14×12) an
 * island.seating of 3 where the photo said 2, which prints on a priced
 * estimate line. None of that is a size the photo could not measure. Starting
 * from `fallback` and writing scalars onto it makes the narrowness structural,
 * and `elsewhereUnmoved` below re-checks it leaf by leaf anyway.
 *
 * ONLY GROWTH. A cut box is a LOWER bound and nothing else: the photo shows at
 * least that much of the island and the rest continues past the frame. So a
 * FITTED value above the analyzer's is a number the picture cannot contradict,
 * and one below it is the single direction the picture positively does — the
 * visible stub is right there. A shrink here would also be invisible (the
 * island stays cut on that edge either way), so the loss can "prefer" it by a
 * few ten-thousandths of search noise while the note claims the photo could
 * not see what it plainly could, and both islandLF and islandTopSqft move on a
 * priced line. Growth only, and the gain has to clear `PARTIAL_MIN_GAIN`
 * rather than merely tie.
 *
 * WHY THERE ARE THREE CANDIDATES AND NOT ONE. A spec stores the island as
 * (centre offset, length), so writing the fitted length onto the fallback
 * moves BOTH of its ends by half the change — including the end the photo CAN
 * see, which is the one thing here that WAS measured. Measured on the
 * synthetic frame-cut fixture (check-fit §10): holding the visible end still,
 * the loss is a clean bowl from 0.0345 at the analyzer's 5 ft down to 0.0 at
 * the truth's 7; letting the centre stay put instead, the same lengths run
 * 0.0345 → 0.0567 — uphill the whole way, so the guard below would refuse
 * every one of them and partial adoption could never fire at all. This is the
 * same fact `edgeParams` is built on: the search moves the island by its two
 * EDGES, not by (position, size). So the candidates are the literal one and
 * the two that pin an end — grow toward −x, or toward +x — and the loss
 * picks. Only the unmeasured SIZE differs from the fallback in any of them;
 * the paired offset moves only to hold an end still, and the loss guard is
 * what proves it held the right one.
 *
 * Deterministic: the candidates are built in a fixed order and ties keep the
 * earliest. Returns null when there is nothing to adopt.
 */
function adoptUnmeasured(opts: {
  fields: readonly SpecParam[];
  /** the analyzer's spec, healed — what the gate's per-field caps are measured against */
  original: RoomSpec;
  /** the spec the gated path ALREADY chose: the base every candidate is built on, and what narrowness is judged against */
  fallback: RoomSpec;
  /** the search's own answer, before the reconciler had a go at it (the same spec the gate's size cap judges) */
  searched: RoomSpec;
  /** the loss of `fallback`: the bar every candidate has to clear */
  fallbackLoss: number;
  lossOf: (s: RoomSpec) => number;
}): { spec: RoomSpec; loss: number; adopted: Array<{ label: string; from: number; to: number }> } | null {
  const { fields, original, fallback, searched, fallbackLoss, lossOf } = opts;
  const wanted: Array<{ p: SpecParam; from: number; to: number }> = [];
  for (const p of fields) {
    if (!p.unmeasured) continue;
    const from = safeGet(p, fallback), to = safeGet(p, searched);
    if (from === null || to === null) continue;
    // growth only — the photo's own stub is the floor (see "ONLY GROWTH")
    if (to <= from + 1e-9) continue;
    wanted.push({ p, from, to });
  }
  if (!wanted.length) return null;

  /** the fallback with the fitted sizes written on, and optionally slid to hold one end of the island still */
  const build = (shift: number): { spec: RoomSpec; axis: 'x' | 'z' | null } | null => {
    const cand = structuredClone(fallback);
    for (const { p, to } of wanted) {
      try { p.set(cand, to); } catch { return null; }
    }
    if (!shift) return { spec: cand, axis: null };
    if (cand.roomType !== 'kitchen') return null;
    const isl = (cand as KitchenSpec).island;
    if (!isl?.present) return null;
    // the island runs along the room's depth once it is turned a quarter
    // turn — the same test `withSearchCoordinates` pairs its edges by
    const axis: 'x' | 'z' = isl.rotationDeg >= 45 ? 'z' : 'x';
    // rounded the way `tidy` writes an island offset, so the number that
    // reaches a contractor is one they would write down
    isl.offset[axis] = Math.round((isl.offset[axis] + shift) * 100) / 100;
    return { spec: cand, axis };
  };

  /**
   * Every leaf outside the adopted sizes (and the one offset that held an end
   * still) is still the fallback's — asked of the spec that is actually going
   * back, by putting the fallback's own numbers into those slots and comparing
   * whole specs. Construction already guarantees it; this is what turns that
   * into something a later edit cannot quietly break.
   */
  const elsewhereUnmoved = (cand: RoomSpec, axis: 'x' | 'z' | null): boolean => {
    const back = structuredClone(cand);
    for (const { p, from } of wanted) {
      try { p.set(back, from); } catch { return false; }
    }
    if (axis && back.roomType === 'kitchen' && fallback.roomType === 'kitchen') {
      const bi = (back as KitchenSpec).island, fi = (fallback as KitchenSpec).island;
      if (!bi || !fi) return false;
      bi.offset[axis] = fi.offset[axis];
    }
    return JSON.stringify(back) === JSON.stringify(fallback);
  };

  // the gate's per-field caps, as the fallback already stands: `capped` exempts
  // the unmeasured sizes and nothing else, so an adopted candidate must trip
  // exactly the same set — never a new one
  const cappedLabels = (s: RoomSpec) => oversizedChanges([...fields], original, s).map((c) => c.label).sort().join('|');
  const capsBefore = cappedLabels(fallback);

  // how far the island grew, and so how far its centre has to slide to leave
  // one end where it was — the literal candidate first, so a tie keeps it
  const lengthChange = wanted.find((w) => w.p.label === 'island.lengthFt');
  const grew = lengthChange ? lengthChange.to - lengthChange.from : 0;
  const shifts = grew ? [0, -grew / 2, grew / 2] : [0];

  let best: { spec: RoomSpec; loss: number } | null = null;
  for (const shift of shifts) {
    const built = build(shift);
    if (!built) continue;
    const { spec, axis } = built;
    if (!RoomSpecZ.safeParse(spec).success) continue;
    if (!elsewhereUnmoved(spec, axis)) continue;
    if (cappedLabels(spec) !== capsBefore) continue;
    const loss = lossOf(spec);
    // measurably closer to the photo than what the gated path would have
    // returned — a tie or a flicker is not something the photo told us
    if (!Number.isFinite(loss) || loss > fallbackLoss - PARTIAL_MIN_GAIN) continue;
    if (!best || loss < best.loss - 1e-9) best = { spec, loss };
  }
  if (!best) return null;
  const adopted = wanted
    .map(({ p, from }) => ({ label: p.label, from, to: safeGet(p, best.spec) }))
    .filter((a): a is { label: string; from: number; to: number } => a.to !== null && Math.abs(a.to - a.from) > 1e-9);
  return adopted.length ? { spec: best.spec, loss: best.loss, adopted } : null;
}

// ---------------------------------------------------------------------------
// Pattern search (shared by the camera and the spec rounds)
// ---------------------------------------------------------------------------

interface Budget {
  deadline: number;
  evalsLeft: number;
  /** cost of one evaluation in `evalsLeft` units (camera moves are free, layout runs are not) */
  cost: number;
  /** what stopped the fit, once something has */
  endedBy?: FitEnd;
}

/** True when the budget is gone; records which limit went first (the evaluation cap is the budget, the clock a safety net). */
function spent(b: Budget, parent: Budget = b): boolean {
  if (b.evalsLeft <= 0) { if (b === parent) parent.endedBy ??= 'evaluations'; return true; }
  if (Date.now() > b.deadline) { parent.endedBy ??= 'time'; return true; }
  return false;
}

/**
 * Coordinate-wise pattern search: try ± step on each dimension, take the
 * first improvement, halve every step when a full sweep finds none, stop when
 * all steps are under their floor or the budget is gone.
 */
function patternSearch(p0: number[], dims: Dim[], f: (p: number[]) => number, budget: Budget, parent: Budget, f0?: number): { p: number[]; loss: number; evals: number } {
  let p = p0.slice();
  let best = f0 ?? f(p);
  let evals = f0 === undefined ? 1 : 0;
  const stepOf = dims.map((d) => d.step);
  for (let guard = 0; guard < 200; guard++) {
    let improved = false;
    for (let i = 0; i < dims.length; i++) {
      if (stepOf[i] < dims[i].minStep) continue;
      for (const sgn of [1, -1]) {
        if (spent(budget, parent)) return { p, loss: best, evals };
        const q = p.slice();
        q[i] = moveDim(p[i], sgn * stepOf[i], dims[i]);
        if (Math.abs(q[i] - p[i]) < 1e-9) continue;
        const fq = f(q);
        evals++;
        budget.evalsLeft -= budget.cost;
        if (fq < best - 1e-9) { p = q; best = fq; improved = true; break; }
      }
    }
    if (!improved) {
      let alive = false;
      for (let i = 0; i < dims.length; i++) {
        stepOf[i] /= 2;
        if (stepOf[i] >= dims[i].minStep) alive = true;
      }
      if (!alive) break;
    }
  }
  return { p, loss: best, evals };
}

// ---------------------------------------------------------------------------
// Camera round
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * The camera search vector: position, bearing, lens — and a DOLLY. Moving
 * the camera back makes everything smaller and narrowing the lens makes
 * everything bigger, so neither alone helps when the far wall already fits
 * and the island in the foreground is too big; the fix is both at once
 * (further back, longer lens), the classic dolly zoom, which a one-axis-at-
 * a-time search cannot find. The seventh coordinate is that move: metres
 * along the flat bearing, with the lens adjusted so the wall the camera
 * faces keeps its size in frame. It is folded back into position + lens
 * whenever a camera leaves the search.
 */
const CAMERA_DIMS = 7;
/**
 * Where a photographer can stand: inside the side walls (a camera outside a
 * wall it can see is a cheat the pinhole allows and a photo never does),
 * anywhere from just inside the back wall to six metres beyond the FRONT —
 * the open side of an open-plan kitchen, a doorway, the next room.
 */
const cameraDims = (w: number, d: number, h: number): Dim[] => [
  { min: -w / 2 + 0.15, max: w / 2 - 0.15, step: 0.5, minStep: 0.02 },
  { min: 0.5, max: h - 0.1, step: 0.3, minStep: 0.02 },
  { min: -d / 2 + 0.15, max: d / 2 + 6, step: 0.5, minStep: 0.02 },
  { min: -180, max: 180, step: 8, minStep: 0.25, wrap: true },
  { min: -45, max: 60, step: 5, minStep: 0.25 },
  { min: 20, max: 110, step: 8, minStep: 0.25 },
  { min: -3, max: 3, step: 0.5, minStep: 0.02 },
];
const camToVec = (c: SolvedCamera) => [c.x, c.y, c.z, c.yawDeg, c.pitchDeg, c.fovDeg, 0];

/** Distance along the flat bearing (fx, fz) from (x, z) to the room's footprint edge. */
function flatDistToWall(x: number, z: number, fx: number, fz: number, w: number, d: number): number {
  let t = Infinity;
  if (Math.abs(fx) > 1e-9) { const tx = ((fx > 0 ? w / 2 : -w / 2) - x) / fx; if (tx > 0 && tx < t) t = tx; }
  if (Math.abs(fz) > 1e-9) { const tz = ((fz > 0 ? d / 2 : -d / 2) - z) / fz; if (tz > 0 && tz < t) t = tz; }
  return Number.isFinite(t) ? t : 3;
}

/** The search vector as a plain camera: the dolly folded into position + lens. */
function vecToCam(p: number[], aspect: number, w: number, d: number, score = 0): SolvedCamera {
  const [x, y, z, yawDeg, pitchDeg, fov0, dolly] = p;
  let fovDeg = fov0, cx = x, cz = z;
  if (Math.abs(dolly) > 1e-12) {
    const fx = Math.sin(yawDeg * DEG), fz = -Math.cos(yawDeg * DEG);
    const dist = Math.max(0.5, flatDistToWall(x, z, fx, fz, w, d));
    const remaining = Math.max(0.3, dist - dolly);
    cx = x + fx * dolly;
    cz = z + fz * dolly;
    fovDeg = clamp((2 * Math.atan(Math.tan((fov0 * DEG) / 2) * (dist / remaining))) / DEG, 20, 110);
  }
  return { x: cx, y, z: cz, yawDeg, pitchDeg, fovDeg, aspect, score };
}

// ---------------------------------------------------------------------------
// Settling the result
// ---------------------------------------------------------------------------

/** The camera the fit starts from — and the camera returned when there is nothing to fit against. */
function startCamera(spec: RoomSpec, aspect: number, given?: SolvedCamera): SolvedCamera {
  const ok = (c: SolvedCamera | null | undefined): c is SolvedCamera =>
    !!c && [c.x, c.y, c.z, c.yawDeg, c.pitchDeg, c.fovDeg].every((n) => typeof n === 'number' && Number.isFinite(n));
  if (ok(given)) return { ...given, aspect, score: 0 };
  const solved = spec.detected?.camera?.solved;
  if (ok(solved)) return { ...solved, aspect, score: 0 };
  return fromEstimate(spec, aspect);
}

/** reconcileSpec snaps material ids to the catalog; custom finishes the analyzer synthesised must survive it (same rule as refine.ts). */
function reconcileKeepingCustom(spec: RoomSpec): RoomSpec {
  const before = spec.materials as unknown as Record<string, string>;
  const reconciled = reconcileSpec(spec, { photoCount: Math.max(1, spec.detected.primaryPhotoIndex + 1), fixes: [] });
  const materials = { ...(reconciled.materials as unknown as Record<string, string>) };
  for (const [slot, id] of Object.entries(before)) if (isCustomMaterialId(id)) materials[slot] = id;
  const out = healContract({ ...reconciled, materials } as unknown as RoomSpec);
  // the reconciler caps the seats at half the island's length in feet — a
  // guess, where the analyzer COUNTED the stools in the photo; a fit that
  // trims the island by a foot must not lose a stool for it
  if (spec.roomType === 'kitchen' && out.roomType === 'kitchen' && spec.island?.present && out.island && Number.isFinite(spec.island.seating)) {
    out.island.seating = spec.island.seating;
  }
  return out;
}

function withCamera(spec: RoomSpec, camera: SolvedCamera): RoomSpec {
  const est = toEstimate(camera, spec);
  return { ...spec, detected: { ...spec.detected, camera: { ...spec.detected.camera, ...est, solved: camera } } } as RoomSpec;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

type MeasurementDetails = Pick<FitResult, 'matched' | 'unmatchedPhoto' | 'unmatchedTwin' | 'coverage' | 'residuals' | 'hints'>;

/** The report for one measured viewport, with no geometry or camera edits. */
function measurementDetails(photos: FitPhoto[], inventory: PhotoElement[], twin: Twin, scoring: Scoring, scoredNow: Scored, assignment: Assignment): MeasurementDetails {
  const matched = scoredNow.matches;
  // per kind family, the photo's elements in inventory order (for the hints' "3rd of 4 stools")
  const siblingsOf = new Map<PhotoElementKind, PhotoElement[]>();
  for (const p of inventory) {
    const fam = family(p.kind);
    const list = siblingsOf.get(fam) ?? [];
    list.push(p);
    siblingsOf.set(fam, list);
  }
  // The hints speak to the vision model in the inventory's own terms: under
  // a turned labelling `photos` carries the turned walls, so each unmatched
  // element is mapped back to the cleaned inventory element for its wall.
  const inventoryById = new Map(inventory.map((e) => [e.id, e]));
  const unmatchedPhoto: FitUnmatched[] = photos
    .filter((p) => !assignment.has(p.id))
    .map((p) => {
      const src = inventoryById.get(p.id) ?? p;
      const reason: UnmatchedReason = p.kind === 'other' ? 'kind not scored' : !scoring.ids.has(p.id) ? 'no twin counterpart' : scoredNow.surplusIds.has(p.id) ? 'twin has fewer of this kind' : 'not in frame';
      const ctx: HintContext = { siblings: siblingsOf.get(family(p.kind)) ?? [src], twinCount: scoring.twinCount.get(family(p.kind)) ?? 0, reason };
      return { id: p.id, kind: p.kind, wall: src.wall, reason, hint: hintFor(src, ctx) };
    });
  const scorable = photos.filter((p) => p.kind !== 'other').length;
  const coverage = scorable ? matched.length / scorable : null;
  const used = new Set(assignment.values());
  const unmatchedTwin = twin.elements
    .filter((t) => !used.has(keyOf(t)) && !SHELL_KINDS.has(t.kind))
    .map((t) => ({ kind: t.kind, wall: t.wall, index: t.index }));

  // the gaps under the names the correction loop and the match report read
  // (the same numbers `residualFromBoxes` derives from `matched`), and the
  // hints in words — so a route that forwards this result needs nothing more
  const residuals: FitResidual[] = matched.map((m) => ({
    kind: m.kind, wall: m.wall, index: m.twinIndex, iou: m.iou, dx: m.dx, dy: m.dy, dw: m.dw, dh: m.dh, err: m.err, label: inventoryById.get(m.photoId)?.label || null,
    // this pair's OWN truncation, so the report never has to guess which
    // element of a kind a residual came from
    open: m.open ?? null, openCause: (m.open ? inventoryById.get(m.photoId)?.openCause : null) ?? null,
  }));
  const hints = unmatchedPhoto.filter((u) => u.reason !== 'kind not scored').map((u) => u.hint);

  return { matched, unmatchedPhoto, unmatchedTwin, coverage, residuals, hints };
}

/**
 * ONE spec through ONE camera, no search: the fit's own measurement of how a
 * twin lands on the photo, with the truncation repair and the truncation term
 * exactly as the loss applies them.
 *
 * `fitToPhoto` cannot answer this — every path through it re-solves the camera,
 * so "is a 9 ft island better than a 5 ft one" comes back confounded with
 * "which camera suits each". The truncation tests in `check-fit.ts` need the
 * unconfounded answer, and so does anyone asking why the fit chose what it
 * chose. Returns null when there is nothing to score.
 */
export function measureAt(specIn: RoomSpec, camera: SolvedCamera): { score: number | null; gateScore: number | null; proportions: number | null; loss: number; scale: number } & MeasurementDetails | null {
  if (!specIn || (specIn.roomType !== 'kitchen' && specIn.roomType !== 'bathroom')) return null;
  let spec: RoomSpec;
  try { spec = healContract(structuredClone(specIn)); } catch { return null; }
  const inventory = cleanElementsDetailed(spec).elements;
  const photos = withFacing(inventory, 0);
  if (!photos.length) return null;
  const twin = twinFor(spec);
  if (!twin) return null;
  const scoring = scoringFor(photos, twin);
  if (!scoring.ids.size) return null;
  const pin = makeCamera(camera);
  const assignment = assign(photos, scoring, twin, projectAll(twin, pin).projected);
  const scored = scoreAt(photos, scoring, twin, pin, rawKindsOf(photos), assignment);
  return { score: scoreOf(scored.matches), gateScore: gateScoreOf(scored.matches), proportions: proportionsOf(scored.matches), loss: scored.loss, scale: scored.scale, ...measurementDetails(photos, inventory, twin, scoring, scored, assignment) };
}

export function fitToPhoto(specIn: RoomSpec, opts: FitOptions = {}): FitResult {
  const t0 = Date.now();
  const locked = specIn?.detected ? confirmedDimensions(specIn) : {};
  if (specIn?.roomType === 'kitchen' || specIn?.roomType === 'bathroom') {
    const dims = specIn.dims;
    if (Object.entries(locked).some(([axis, value]) => dims[axis as keyof typeof locked] !== value)) {
      specIn = { ...specIn, dims: { ...dims, ...locked } };
    }
  }
  const aspect = clamp(typeof opts.aspect === 'number' && Number.isFinite(opts.aspect) ? opts.aspect : (specIn?.detected?.camera?.solved?.aspect ?? DEFAULT_ASPECT), 0.2, 5);
  const notes: string[] = [];
  if (Object.keys(locked).length) notes.push(`measured dimensions held fixed: ${Object.entries(locked).map(([axis, value]) => `${axis} ${value} ft`).join(', ')}`);
  const nothing = (camera: SolvedCamera): FitResult => ({
    spec: specIn, camera, score: null, proportions: null, coverage: null, matched: [], unmatchedPhoto: [], unmatchedTwin: [], residuals: [], hints: [], iterations: 0, evaluations: 0, ms: Date.now() - t0,
    lossBefore: null, lossAfter: null, endedBy: 'converged', originalScore: null, spec_unchanged: 'nothing to fit', notes,
  });

  let camera = startCamera(specIn ?? ({} as RoomSpec), aspect, opts.camera);
  if (!specIn || (specIn.roomType !== 'kitchen' && specIn.roomType !== 'bathroom')) return nothing(camera);
  const cleaned = cleanElementsDetailed(specIn);
  notes.push(...cleaned.notes);
  let photos: FitPhoto[] = withFacing(cleaned.elements, 0);
  if (!photos.length) return nothing(camera);
  // The truncation set is a property of the PICTURE, not of a labelling
  // hypothesis or a candidate spec: `truncationOf` reads only the box and its
  // own flags, and turning the wall labels does not move a box. So it is read
  // once here and every scoring path takes it.
  let rawKinds = rawKindsOf(photos);

  // the spec the fit works on: a clone the params may mutate freely, with
  // the contract fields an older spec lacks filled in ("auto"); `original`
  // is the same for the input, so the gate compares like with like
  let spec: RoomSpec;
  let original: RoomSpec;
  try { spec = healContract(structuredClone(specIn)); original = healContract(structuredClone(specIn)); } catch { return nothing(camera); }
  const twin0 = twinFor(spec);
  if (!twin0) return nothing(camera);
  let twin: Twin = twin0;

  const scoring = scoringFor(photos, twin0);
  if (!scoring.ids.size) return nothing(camera);

  const budget: Budget = {
    deadline: t0 + clamp(typeof opts.maxMs === 'number' && Number.isFinite(opts.maxMs) ? opts.maxMs : 20_000, 50, 60_000),
    evalsLeft: clamp(typeof opts.maxEvaluations === 'number' && Number.isFinite(opts.maxEvaluations) ? opts.maxEvaluations : DEFAULT_EVALUATIONS, 10, 20_000),
    cost: 1,
  };
  let evaluations = 0;
  let iterations = 0;
  const bad0 = implausibility(spec);
  const plausible = (candidate: RoomSpec) => implausibility(candidate) <= bad0 + 1e-9
    && ((candidate.roomType !== 'kitchen' && candidate.roomType !== 'bathroom') || Object.entries(locked).every(([axis, value]) => candidate.dims[axis as keyof typeof locked] === value));

  const cameraLoss = (cam: SolvedCamera, twinNow: Twin, assignment: Assignment | null, photosNow: FitPhoto[] = photos): Scored =>
    scoreAt(photosNow, scoring, twinNow, makeCamera(cam), rawKinds, assignment ?? undefined);
  const pairing = (photosNow: FitPhoto[], twinNow: Twin, cam: SolvedCamera): Assignment => {
    const pin = makeCamera(cam);
    return assign(photosNow, scoring, twinNow, projectAll(twinNow, pin).projected);
  };
  const cameraRound = (cam: SolvedCamera, twinNow: Twin, assignment: Assignment, evalCap: number, specNow: RoomSpec, photosNow: FitPhoto[] = photos): { cam: SolvedCamera; loss: number } => {
    const { w, d, h } = roomSize(specNow);
    const local: Budget = { deadline: budget.deadline, evalsLeft: evalCap, cost: 1 };
    const f = (p: number[]) => cameraLoss(vecToCam(p, aspect, w, d), twinNow, assignment, photosNow).loss;
    const r = patternSearch(camToVec(cam), cameraDims(w, d, h), f, local, budget);
    return { cam: vecToCam(r.p, aspect, w, d), loss: r.loss };
  };

  // --- starting point: the estimate, the previous solve, a coarse grid of
  // standpoints × aims × lenses (so a wrong "position" word cannot trap the
  // fit in the wrong corner) and the frame hints' seeds, each tried at every
  // room SCALE (so a room the analyzer read a size too big or too small is
  // corrected as a whole — the camera scales with it about the room's
  // centre, the way a standpoint word does). Camera moves are cheap; each
  // scale costs one layout run. All of it for each labelling hypothesis.
  // the frame hints, the facing cues filling in the side walls the inventory left unsaid
  const frame = readFrame(specIn, photos);
  const heightFt = spec.detected?.camera?.heightFt ?? 5;
  const starts: SolvedCamera[] = [camera];
  for (const position of ['front', 'corner-left', 'corner-right', 'side-left', 'side-right'] as const) {
    for (const lookingAt of ['back', 'left', 'right', 'front'] as const) {
      for (const fovDeg of [48, 65, 82]) {
        starts.push(fromEstimate(spec, aspect, { position, lookingAt, fovDeg, heightFt }));
      }
    }
  }
  starts.push(...frameStarts(frame, spec, aspect, heightFt));
  const scaled: Array<{ s: number; spec: RoomSpec; twin: Twin }> = [{ s: 1, spec, twin: twin0 }];
  const roomScales = locked.widthFt !== undefined || locked.depthFt !== undefined ? [1] : SCALES;
  for (const s of roomScales) {
    if (s === 1 || spent(budget)) continue;
    const candidate = scaleRoom(spec, s);
    if (!plausible(candidate)) continue;
    evaluations++;
    budget.evalsLeft -= 1;
    const tw = twinFor(candidate);
    if (tw) scaled.push({ s, spec: candidate, twin: tw });
  }
  type Start = { cam: SolvedCamera; i: number; s: number; spec: RoomSpec; twin: Twin; loss: number };
  let lossBefore: number | null = null;
  let best: { cam: SolvedCamera; loss: number; pick: Start; hypothesis: string; photos: FitPhoto[] } | null = null;
  for (const hyp of labelHypotheses(photos, twin0.elements)) {
    // the labels turned, and the facing cues turned with them
    const hypPhotos = withFacing(hyp.photos, hyp.turns);
    const ranked: Start[] = scaled
      .flatMap((sc) => starts.map((cam, i) => {
        const c = scaleCamera(cam, sc.s);
        return { cam: c, i, s: sc.s, spec: sc.spec, twin: sc.twin, loss: cameraLoss(c, sc.twin, null, hypPhotos).loss };
      }))
      .sort((a, b) => a.loss - b.loss || Math.abs(a.s - 1) - Math.abs(b.s - 1) || a.i - b.i);
    if (hyp.turns === 0) lossBefore = ranked.find((r) => r.i === 0 && r.s === 1)?.loss ?? ranked[0].loss;

    // round 1: camera only, from the three most promising standpoints, each at its best scale
    const picks: Start[] = [];
    const pickedStarts = new Set<number>();
    for (const r of ranked) {
      if (pickedStarts.has(r.i)) continue;
      pickedStarts.add(r.i);
      picks.push(r);
      if (picks.length === 3) break;
    }
    for (const pick of picks) {
      const r = cameraRound(pick.cam, pick.twin, pairing(hypPhotos, pick.twin, pick.cam), 1500, pick.spec, hypPhotos);
      // re-match after the move — a better assignment is a lower loss, never a higher one
      const re = cameraLoss(r.cam, pick.twin, null, hypPhotos).loss;
      const loss = Math.min(r.loss, re);
      // a turned labelling has to be clearly better to displace the model's
      // own words — unless the model's own facing cues are what point to it
      const handicap = hyp.turns === 0 || hyp.seeded ? 0 : 0.02;
      if (!best || loss + handicap < best.loss) best = { cam: r.cam, loss, pick, hypothesis: hyp.name, photos: hypPhotos };
    }
    iterations++;
  }
  camera = best!.cam;
  spec = best!.pick.spec;
  twin = best!.pick.twin;
  photos = best!.photos;
  rawKinds = rawKindsOf(photos);
  if (best!.pick.s !== 1) notes.push(`room scaled ×${best!.pick.s.toFixed(2)} as a whole before the search (the analyzer's size was off)`);
  if (best!.hypothesis !== 'as labelled') notes.push(`inventory wall labels read with the room turned (${best!.hypothesis}) — they landed better that way`);
  let assignment = pairing(photos, twin, camera);
  let loss = scoreAt(photos, scoring, twin, makeCamera(camera), rawKinds, assignment).loss;

  // --- alternate: spec round, camera round, joint round, until the budget is
  // spent or two rounds in a row stop paying. `fields` are the spec's own
  // numbers (put back after reconcile, judged by the gate); `params` are what
  // the search moves — the same fields plus the edges, the slides and the
  // room scale made from them
  const rawFields = spec.roomType === 'kitchen' ? kitchenParams(spec as KitchenSpec, original as KitchenSpec) : bathroomParams(spec as BathroomSpec);
  // marked BEFORE `boundSizes`, which is where the gate's cap becomes a search
  // bound: a size the photo cut is exempt from the bound, the gate and the
  // prior together, because `capped` is the one predicate all three consult
  const unmeasured = unmeasuredLabels(photos, spec);
  const fields = boundSizes(unmeasured.size ? rawFields.map((p) => (unmeasured.has(p.label) ? { ...p, unmeasured: true } : p)) : rawFields, original);
  if (unmeasured.size) notes.push(`the photo cuts ${unmeasured.size === 1 ? 'the box that measures' : 'the boxes that measure'} ${[...unmeasured].join(', ')} — searched without the size cap`);
  const params = withSearchCoordinates(fields, spec as KitchenSpec | BathroomSpec);
  const present = new Set(photos.filter((p) => scoring.ids.has(p.id)).map((p) => family(p.kind)));
  const active = params.filter((p) => p.kinds.some((k) => present.has(family(k))));
  const patterned = active.filter(steps);
  // the joint round moves every stepped coordinate and, as rounded
  // coordinates, the scan-only counts (end seats, a gap's index, the
  // backsplash height) the coordinate stages only ever scan
  const joint = jointParams(active);
  const integer = joint.map((p) => !steps(p));

  // the prior: mean squared change of the capped sizes, in units of their cap
  const priorFields = fields.filter((p) => capped(p, original)).map((p) => ({ p, from: safeGet(p, original), scale: sizeCap(p) * sizeBase(safeGet(p, original) ?? 1) }))
    .filter((f): f is { p: SpecParam; from: number; scale: number } => f.from !== null && f.scale > 0);
  // a relative coordinate (a gap's slide) has no field to read its move off;
  // it says itself how far the spec has gone along it, charged linearly at a
  // small weight so a slide is never free where a size change is not
  const slideFields = active.filter((p) => typeof p.prior === 'function');
  const prior = (s: RoomSpec): number => {
    let out = 0;
    if (priorFields.length) {
      let sum = 0;
      for (const f of priorFields) {
        const v = safeGet(f.p, s);
        if (v === null) continue;
        const rel = (v - f.from) / f.scale;
        sum += rel * rel;
      }
      out += (PRIOR_WEIGHT * sum) / priorFields.length;
    }
    for (const f of slideFields) {
      try { out += SLIDE_PRIOR_WEIGHT * Math.max(0, f.prior!(s)); } catch { /* a row the candidate no longer has */ }
    }
    return out;
  };
  /** what the search minimises: the geometric loss plus the prior on the spec it came from and its honesty about what the scene draws */
  const total = (geometric: number, s: RoomSpec, tw: Twin) => geometric + prior(s) + honesty(s, tw.drawn);

  type Candidate = { spec: RoomSpec; cam: SolvedCamera; loss: number; twin: Twin | null };
  const candidateFrom = (base: RoomSpec, baseCam: SolvedCamera, mutate: (s: RoomSpec) => void, carry: (before: RoomSpec, after: RoomSpec, cam: SolvedCamera) => SolvedCamera): Candidate | null => {
    const candidate: RoomSpec = structuredClone(base);
    mutate(candidate);
    if (!plausible(candidate)) return null;
    const cam = carry(base, candidate, baseCam);
    evaluations++;
    budget.evalsLeft -= 1;
    const tw = twinFor(candidate);
    if (!tw) return { spec: candidate, cam, loss: Infinity, twin: null };
    // re-paired for every candidate: the loss of a spec is the best pairing
    // it admits, and a pairing frozen from before the move would hide the
    // move that swaps two shelf boards into their right places
    return { spec: candidate, cam, loss: total(scoreAt(photos, scoring, tw, makeCamera(cam), rawKinds).loss, candidate, tw), twin: tw };
  };

  /**
   * The joint round: camera and every stepped spec coordinate in one vector,
   * a seeded Gaussian evolution strategy over it. A candidate's spec is the
   * round's base with every coordinate that left its base value applied
   * (relative coordinates from their neutral), the camera carried with any
   * change of room size; a candidate that moved only the camera costs no
   * layout run.
   */
  const jointRound = (base: RoomSpec, baseCam: SolvedCamera, baseTwin: Twin, baseLoss: number, evalCap: number, seed: number, scale0 = 0.5, charge: (sc: Scored) => number = () => 0): { spec: RoomSpec; cam: SolvedCamera; twin: Twin; loss: number; evals: number } => {
    const { w, d, h } = roomSize(base);
    const dims = [...cameraDims(w, d, h), ...joint.map((p) => p.dim)];
    const p0 = [...camToVec(baseCam), ...joint.map((p) => p.neutral ?? (safeGet(p, base) ?? p.dim.min))];
    let bestNow = { spec: base, cam: baseCam, twin: baseTwin, loss: baseLoss };
    let layoutEvals = 0;
    const f = (q: number[]): number => {
      const moved: number[] = [];
      // a count (end seats, a gap's index, the backsplash height) rides in
      // the vector as a real number and is read rounded: a step that rounds
      // back to where it was moves nothing
      const at = (j: number) => (integer[j] ? Math.round(q[CAMERA_DIMS + j]) : q[CAMERA_DIMS + j]);
      for (let j = 0; j < joint.length; j++) if (Math.abs(at(j) - p0[CAMERA_DIMS + j]) > 1e-9) moved.push(j);
      let candidate = base, tw: Twin | null = baseTwin;
      let cam = vecToCam(q.slice(0, CAMERA_DIMS), aspect, w, d);
      if (moved.length) {
        if (spent(budget)) return Infinity;
        candidate = structuredClone(base);
        for (const j of moved) joint[j].set(candidate, at(j));
        if (!plausible(candidate)) return Infinity;
        evaluations++;
        budget.evalsLeft -= 1;
        layoutEvals++;
        tw = twinFor(candidate);
        if (!tw) return Infinity;
        cam = cameraForDims(base, candidate, cam);
      }
      const sc = scoreAt(photos, scoring, tw, makeCamera(cam), rawKinds);
      const l = total(sc.loss, candidate, tw) + charge(sc);
      if (l < bestNow.loss - 1e-9) bestNow = { spec: candidate, cam, twin: tw, loss: l };
      return l;
    };
    evolve(p0, dims, f, { rng: mulberry32(seed), maxEvals: evalCap * 3, deadline: budget.deadline, f0: baseLoss, lambda: 8, scale0, stop: () => layoutEvals >= evalCap || spent(budget) });
    return { ...bestNow, evals: layoutEvals };
  };

  loss = total(loss, spec, twin);
  let alt = 0;
  let stalls = 0;
  let shaken = false;
  for (; alt < MAX_ALTERNATIONS && active.length; alt++) {
    const lossAtStart = loss;
    if (spent(budget)) break;

    // spec round: each candidate is a fresh clone through the layout solver,
    // judged with the current camera (moved along when the room changes size)
    let cur: RoomSpec = spec;
    let curCam = camera;
    let curLoss = loss;
    const candidateOf = (prm: SpecParam, value: number): Candidate | null =>
      candidateFrom(cur, curCam, (s) => prm.set(s, value), (before, after, cam) => (prm.moveCamera ? prm.moveCamera(before, after, cam) : cam));

    // Positions first, coarsely, every round (the camera has moved since the
    // last one): a range whose box does not overlap the photo's has an IoU of
    // 0 wherever it stands within a cabinet's width, and the ± step search
    // reads that as flat. The centre-distance term is continuous, so
    // scanning the whole wall finds the right neighbourhood.
    // Where several values draw the same thing the spec's number should say
    // where the scene draws it: a plateau in the MIDDLE of the range is the
    // layout snapping the thing to a gap, so its middle is kept; a plateau
    // running off either END of the range is a clamp (a window pushed to the
    // corner, a shelf lifted clear of the counter), so the value nearest the
    // unclamped region is kept rather than one deep inside the clamp.
    {
      for (const prm of active) {
        if (!prm.scan || !scans(prm) || spent(budget)) continue;
        const [lo, hi, step] = prm.scan;
        const values: number[] = [];
        for (let v = lo; v <= hi + 1e-9; v += step) values.push(clamp(Math.round(v * 1e6) / 1e6, prm.dim.min, prm.dim.max));
        const results = values.map((v) => (spent(budget) ? null : candidateOf(prm, v)));
        let bi = -1;
        results.forEach((r, i) => { if (r && r.twin && (bi < 0 || r.loss < results[bi]!.loss - 1e-9)) bi = i; });
        if (bi < 0 || results[bi]!.loss >= curLoss - 1e-9) continue;
        const bestLoss = results[bi]!.loss;
        let a = bi, b = bi;
        while (a > 0 && results[a - 1] && results[a - 1]!.twin && results[a - 1]!.loss <= bestLoss + 1e-9) a--;
        while (b < results.length - 1 && results[b + 1] && results[b + 1]!.twin && results[b + 1]!.loss <= bestLoss + 1e-9) b++;
        const pickI = a === 0 && b < results.length - 1 ? b : b === results.length - 1 && a > 0 ? a : Math.floor((a + b) / 2);
        const chosen = results[pickI]!;
        cur = chosen.spec; curCam = chosen.cam; curLoss = chosen.loss; twin = chosen.twin!;
      }
    }

    const stepOf = patterned.map((p) => p.dim.step);
    for (let sweep = 0; sweep < 40; sweep++) {
      let improved = false;
      for (let i = 0; i < patterned.length; i++) {
        const prm = patterned[i];
        if (stepOf[i] < prm.dim.minStep) continue;
        const v = prm.get(cur);
        for (const sgn of [1, -1]) {
          if (spent(budget)) break;
          const nv = moveDim(v, sgn * stepOf[i], prm.dim);
          if (Math.abs(nv - v) < 1e-9) continue;
          const r = candidateOf(prm, nv);
          if (r && r.twin && r.loss < curLoss - 1e-9) { cur = r.spec; curCam = r.cam; curLoss = r.loss; twin = r.twin; improved = true; break; }
        }
        if (spent(budget)) break;
      }
      if (spent(budget)) break;
      if (improved) continue;
      let alive = false;
      for (let i = 0; i < patterned.length; i++) { stepOf[i] /= 2; if (stepOf[i] >= patterned[i].dim.minStep) alive = true; }
      if (!alive) break;
    }
    spec = cur;
    camera = curCam;
    loss = curLoss;
    iterations++;
    assignment = pairing(photos, twin, camera);
    loss = Math.min(loss, total(scoreAt(photos, scoring, twin, makeCamera(camera), rawKinds, assignment).loss, spec, twin));

    // camera round on the moved twin (the spec, and so the prior, stays)
    if (spent(budget)) break;
    const cr = cameraRound(camera, twin, assignment, 1200, spec);
    camera = cr.cam;
    iterations++;
    assignment = pairing(photos, twin, camera);
    loss = Math.min(total(cr.loss, spec, twin), total(scoreAt(photos, scoring, twin, makeCamera(camera), rawKinds, assignment).loss, spec, twin));

    // joint round: camera + spec together, then the pairing refreshed
    if (spent(budget)) break;
    if (joint.length) {
      const jr = jointRound(spec, camera, twin, loss, Math.min(budget.evalsLeft, 1500), 0x9e3779b9 ^ (alt * 0x85ebca6b));
      spec = jr.spec; camera = jr.cam; twin = jr.twin;
      iterations++;
      assignment = pairing(photos, twin, camera);
      loss = Math.min(jr.loss, total(scoreAt(photos, scoring, twin, makeCamera(camera), rawKinds, assignment).loss, spec, twin));
    }

    const gain = (lossAtStart - loss) / Math.max(lossAtStart, 1e-6);
    stalls = gain < STALL ? stalls + 1 : 0;
    if (stalls >= 2) {
      // Converged with budget to spare: one wide joint round (three times
      // the usual step) to jump out of a local minimum — the coordinate
      // stages only ever walk downhill. Taken only when it lands lower;
      // then the alternation continues from there.
      if (!shaken && joint.length && budget.evalsLeft >= 1500 && !spent(budget)) {
        shaken = true;
        const jr = jointRound(spec, camera, twin, loss, Math.min(budget.evalsLeft - 800, 2000), 0x2545f491 ^ (alt * 0x9e3779b9), 1.5);
        iterations++;
        if (jr.loss < loss - 1e-9) { spec = jr.spec; camera = jr.cam; twin = jr.twin; assignment = pairing(photos, twin, camera); loss = jr.loss; stalls = 0; continue; }
      }
      budget.endedBy ??= 'converged';
      break;
    }
  }
  if (alt >= MAX_ALTERNATIONS) budget.endedBy ??= 'rounds';

  /**
   * THE PERSPECTIVE ROUND — the one thing an IoU cannot see, taken once the
   * search has settled so it cannot disturb it.
   *
   * The alternation above has just found a camera that minimises the
   * geometric loss. Along ONE direction that loss is nearly flat: step back
   * and lengthen the lens and the far wall is redrawn almost exactly (the
   * dolly zoom, the fitter's own seventh camera coordinate). The near field
   * is not flat along it at all — at half the distance the same step changes
   * an object's image height twice as much — but by then a near element that
   * is 2× out of scale has an IoU of nearly nothing, the same nearly-nothing
   * it has at 3× and 4×, so it has already stopped voting. That is how a
   * camera ends up standing far too close with far too wide a lens while the
   * back wall lands within 3%, and it is why a 5 ft island can fill the frame
   * the way a 9 ft one does.
   *
   * So: re-solve the camera on the geometric loss PLUS the perspective charge
   * (`SCALE_WEIGHT`, deadbanded by `SCALE_TOL`), which is measured in log
   * size and therefore has a gradient at 2× and at 4× alike, and keep the
   * answer only if it costs no real geometric loss (`PERSPECTIVE_SLACK`).
   * Kept deliberately as a separate, LAST round rather than a term in the
   * loss: a term changes the search's path everywhere, and measured that way
   * it moved fixtures whose perspective was never in question off their own
   * optimum by a point of IoU for nothing. As a final round it is provably
   * inert wherever it does not pay — the two consistent client fixtures come
   * back byte-identical — and it is what re-solves the two that disagree.
   *
   * AND IT IS NARROW. `SCALE_TOL` stands well above everything a correct twin
   * can produce (measured there: ~0.07 over the whole ambiguity, ~0.093 with
   * annotation noise on top), so this round never fires on a twin that is
   * right, at any camera error. What it fires on is an inventory no camera
   * reproduces — a box drawn around something that is not the object. Read it
   * as a repair for those, not as the constraint that pins down the lens.
   */
  /** the charge itself: the spread PAST what a correct twin can reach, squared — smooth at the deadband, growing where the disagreement is real */
  const perspectiveCharge = (sc: Scored): number => { const over = Math.max(0, sc.scale - SCALE_TOL); return SCALE_WEIGHT * over * over; };
  /** how much geometric loss a more consistent answer may cost before it is refused */
  const perspectiveSlack = (loss: number) => Math.max(PERSPECTIVE_SLACK_FLOOR, PERSPECTIVE_SLACK * loss);
  /** the acceptance test, in both places: strictly more consistent, and no dearer than the slack allows */
  const perspectiveTakes = (before: Scored, after: Scored, what: string): boolean => {
    if (after.scale >= before.scale - 1e-9) return false;
    if (after.loss > before.loss + perspectiveSlack(before.loss)) return false;
    // A consistency gain that costs nothing is always worth having; one that
    // is PAID for in geometric loss has to be worth the price, or the round
    // spends the slack on rounding. (The delivered answer is not always the
    // one measured here — a fit whose spec the gate then discards is
    // re-solved against the original spec — so a hundredth of spread bought
    // at a real price is not a bargain, it is churn.)
    if (after.loss > before.loss + 1e-9 && after.scale > before.scale - PERSPECTIVE_MIN_GAIN) return false;
    notes.push(`${what} re-solved for perspective: the near field and the far field disagreed about the lens (spread ${before.scale.toFixed(2)} → ${after.scale.toFixed(2)} in log size), which an IoU cannot see`);
    return true;
  };
  /** camera alone, on the charged objective — the cheap attempt, and the only one the gated path may make */
  const perspectiveCamera = (cam: SolvedCamera, twinNow: Twin, specNow: RoomSpec): SolvedCamera => {
    if (spent(budget)) return cam;
    const before = cameraLoss(cam, twinNow, null);
    if (!(before.scale > SCALE_TOL)) return cam;
    const { w, d, h } = roomSize(specNow);
    const frozen = pairing(photos, twinNow, cam);
    const charged = (sc: Scored) => sc.loss + perspectiveCharge(sc);
    const local: Budget = { deadline: budget.deadline, evalsLeft: PERSPECTIVE_EVALS, cost: 1 };
    const r = patternSearch(camToVec(cam), cameraDims(w, d, h), (p) => charged(cameraLoss(vecToCam(p, aspect, w, d), twinNow, frozen)), local, budget, charged(cameraLoss(cam, twinNow, frozen)));
    iterations++;
    const cand = vecToCam(r.p, aspect, w, d);
    // judged re-paired, the way every camera move is judged
    return perspectiveTakes(before, cameraLoss(cand, twinNow, null), 'camera') ? cand : cam;
  };
  {
    const moved = perspectiveCamera(camera, twin, spec);
    if (moved !== camera) { camera = moved; assignment = pairing(photos, twin, camera); }
    else {
      // Camera alone could not buy it. A near field that disagrees with the
      // far field is not always the camera's fault: a room a foot too deep or
      // an island a yard too short leaves NO standpoint that reproduces both
      // halves at once, and then the camera is only the visible half of the
      // error. So the same charge is offered to the joint round — camera and
      // every stepped spec coordinate together — under the same acceptance
      // test, which is what keeps a fixture whose geometry genuinely cannot
      // be reconciled (the charge would only buy distortion) exactly where
      // the search left it.
      const before = cameraLoss(camera, twin, null);
      const evalCap = Math.min(budget.evalsLeft - 200, PERSPECTIVE_JOINT_EVALS);
      if (before.scale > SCALE_TOL && joint.length && evalCap >= 100 && !spent(budget)) {
        const base = total(before.loss, spec, twin) + perspectiveCharge(before);
        const jr = jointRound(spec, camera, twin, base, evalCap, PERSPECTIVE_SEED, 0.8, perspectiveCharge);
        iterations++;
        const after = scoreAt(photos, scoring, jr.twin, makeCamera(jr.cam), rawKinds);
        if (perspectiveTakes(before, after, 'camera and spec')) {
          spec = jr.spec; camera = jr.cam; twin = jr.twin;
          assignment = pairing(photos, twin, camera);
        }
      }
    }
  }

  const endedBy: FitEnd = budget.endedBy ?? 'converged';

  // --- settle the result: reconcile the spec (keeping what was measured), re-measure with what the scene will actually draw
  const settle = (source: RoomSpec): RoomSpec | null => {
    try {
      const rec = reconcileKeepingCustom(tidy(structuredClone(source)));
      return RoomSpecZ.safeParse(rec).success ? rec : null;
    } catch {
      return null;
    }
  };
  // what a spec DRAWS through a camera — the geometric loss alone, without
  // the search's prior and honesty terms: the settle and the gate compare
  // pictures, and a renumbering that draws the same must cost the same
  const lossOf = (s: RoomSpec, cam: SolvedCamera): number => {
    const tw = twinFor(s);
    if (!tw) return Infinity;
    return scoreAt(photos, scoring, tw, makeCamera(cam), rawKinds).loss;
  };
  let finalSpec: RoomSpec = tidy(structuredClone(spec));
  /**
   * The SEARCH's own answer, before the reconciler had a go at it. The gate's
   * size cap asks "did the FIT move a measured size further than it is allowed
   * to?", and `boundSizes` bounds the search so it CANNOT: the numbers that
   * exceeded the cap on client-marble (`runs[1].tall[0].widthIn 39 -> 18`,
   * 54% against a 30% cap) were written by `reconcileSpec` inside `settle`,
   * which refits a run's boxes to a new run length. Judging the reconciled
   * spec therefore blamed the fit for the reconciler's arithmetic and threw
   * away the whole fit — non-monotonically in the loss, on a knife edge no
   * evaluation budget could cross. The reconciler is the app's own normaliser
   * and runs on every path anyway; its refits are not the fit's edits.
   */
  const searched: RoomSpec = structuredClone(finalSpec);
  const settled = settle(spec);
  if (settled) {
    // The reconciler may renumber what the fit measured as long as the scene
    // still draws the same thing (syncing a fridge's t to its surround is
    // fine). When its changes draw WORSE than what was fitted — it snapped an
    // appliance back into a gap the photo says is empty — the fitted numbers
    // are put back.
    const lossFit = lossOf(finalSpec, camera);
    // refitting cabinet rows to a new length moves boxes by millimetres; only a real loss counts as "worse"
    const worse = (l: number) => l > lossFit + Math.max(0.005, 0.02 * lossFit);
    let kept = settled;
    let lossKept = lossOf(settled, camera);
    if (worse(lossKept)) {
      // one field at a time, kept only where the fitted value draws better —
      // a renumbering that draws the same (a fridge's t synced to its
      // surround) is the reconciler's to make
      const restored: string[] = [];
      for (const label of restoreFitted(structuredClone(settled), finalSpec, original, fields)) {
        const field = fields.find((f) => f.label === label);
        const want = field ? safeGet(field, finalSpec) : null;
        if (!field || want === null) continue;
        const trial = structuredClone(kept);
        try { field.set(trial, want); } catch { continue; }
        if (!RoomSpecZ.safeParse(trial).success) continue;
        const lossTrial = lossOf(trial, camera);
        if (lossTrial < lossKept - 1e-9) { kept = trial; lossKept = lossTrial; restored.push(label); }
      }
      if (restored.length) notes.push(`kept the fitted ${restored.join(', ')} where the reconciler would have moved ${restored.length === 1 ? 'it' : 'them'} back`);
      // still worse (it capped the stools, dropped a plant…): the fitted spec
      // is already a reconciled analyzer spec with measured numbers, and it
      // draws what the photo shows — keep it as it is
      if (worse(lossKept) && RoomSpecZ.safeParse(finalSpec).success) {
        kept = finalSpec;
        notes.push('kept the fitted spec un-reconciled: the reconciler\'s version drew further from the photo');
      }
    }
    finalSpec = kept;
  } else if (!RoomSpecZ.safeParse(finalSpec).success) {
    finalSpec = settle(original) ?? structuredClone(original);
  }
  let finalTwin = twinFor(finalSpec) ?? twin;
  let pin = makeCamera(camera);
  const fittedMatchesNow = scoreAt(photos, scoring, finalTwin, pin, rawKinds).matches;
  const fittedScore = scoreOf(fittedMatchesNow);
  const fittedGate = gateScoreOf(fittedMatchesNow);

  // --- plausibility gate: the edits must clearly beat the original spec seen
  // through the same camera, and no single measured size may have moved by
  // more than a quarter (island) or a third. Otherwise the original spec is
  // kept — a camera solve on its own is still worth a lot — and the camera
  // is re-solved for it, since the one above was solved jointly with the
  // discarded edits.
  const originalTwin = twinFor(original);
  const originalMatches = originalTwin ? scoreAt(photos, scoring, originalTwin, pin, rawKinds).matches : [];
  const originalScore = originalTwin ? scoreOf(originalMatches) : null;
  const originalGate = originalTwin ? gateScoreOf(originalMatches) : null;
  const fittedMatched = fittedMatchesNow.length;
  let gated: string | null = null;
  /** the gate rejected the aggregate, but a size the photo could not measure was kept (`adoptUnmeasured`) */
  let partial = false;
  if (originalTwin) {
    const tooFar = oversizedChanges(fields, original, searched);
    if (fittedScore === null || fittedGate === null) gated = 'the fitted spec matched nothing';
    // The comparison is in GATE score (IoU with the truncation charge folded
    // in), not plain IoU — that is what `gateScoreOf` exists for — and on any
    // fixture with frame-cut boxes the two currencies differ. Printing the
    // plain pair while comparing the gate pair produced sentences that were
    // arithmetically false ("fitted IoU 72% did not beat the original 70% by
    // 2%"), and this string is the only diagnostic a later reader gets for a
    // rejection. Both pairs are printed, gate first, since gate is what fired.
    else if (originalGate !== null && originalScore !== null && fittedGate < originalGate + gateMargin(originalScore)) gated = `fitted gate ${pct(fittedGate)} (IoU ${pct(fittedScore)}) did not beat the original gate ${pct(originalGate)} (IoU ${pct(originalScore)}) by ${pct(gateMargin(originalScore))}`;
    // A mean IoU can go UP by dropping the pairings it was doing worst on
    // (the proportion term made that basin reachable on one fixture: 0.634
    // at coverage 0.759). Refuse it by name rather than trusting the margin.
    else if (fittedMatched < originalMatches.length) gated = `fitted spec matched fewer elements than the original (${fittedMatched} vs ${originalMatches.length})`;
    else if (tooFar.length) gated = tooFar.slice(0, 3).map((c) => `${c.label} ${c.from} → ${c.to} moved ${pct(c.rel)} (cap ${pct(c.cap)})`).join('; ');
  }
  if (gated && originalTwin) {
    notes.push(`spec edits discarded: ${gated}`);
    const cr = cameraRound(camera, originalTwin, pairing(photos, originalTwin, camera), 800, original);
    camera = cr.cam;
    iterations++;
    // …and the same perspective round on it: the re-solve above minimises the
    // geometric loss alone, so without this the gated path would hand back a
    // camera standing in the ambiguous place the round had just left
    camera = perspectiveCamera(camera, originalTwin, original);
    pin = makeCamera(camera);
    // The original's own numbers, tidied — what the caller already draws.
    // The reconciler's version of them is taken only when it draws NO WORSE
    // through this camera: it snaps appliances into gaps and caps counts,
    // and a gated fit that handed back a re-reconciled original could draw
    // further from the photo than the spec it was given, which every
    // caller would then adopt as "the fit".
    const plain = tidy(structuredClone(original));
    const plainOk = RoomSpecZ.safeParse(plain).success;
    const reconciled = settle(original);
    const lossPlain = plainOk ? lossOf(plain, camera) : Infinity;
    const lossReconciled = reconciled ? lossOf(reconciled, camera) : Infinity;
    if (reconciled && lossReconciled <= lossPlain + 1e-9) finalSpec = reconciled;
    else if (plainOk) {
      finalSpec = plain;
      if (reconciled) notes.push('kept the original spec un-reconciled: the reconciler\'s version drew further from the photo');
    } else finalSpec = reconciled ?? structuredClone(original);
    finalTwin = twinFor(finalSpec) ?? originalTwin;

    // …except for the sizes the photo could not measure: those go back on top
    // of what the fallback just chose (`adoptUnmeasured`), and only when they
    // GREW and drew measurably closer than it did.
    if (unmeasured.size) {
      const part = adoptUnmeasured({
        fields, original, searched,
        // the base is what the fallback just chose, so nothing else can move
        fallback: finalSpec,
        fallbackLoss: lossOf(finalSpec, camera),
        lossOf: (s) => lossOf(s, camera),
      });
      if (part) {
        finalSpec = part.spec;
        finalTwin = twinFor(finalSpec) ?? finalTwin;
        partial = true;
        for (const a of part.adopted) {
          notes.push(`kept the fitted ${a.label} (${a.from} → ${a.to}): the photo cuts the box that measures it, so the analyzer's number was the visible stub, not a measurement`);
        }
      }
    }
  }

  const finalAssignment = pairing(photos, finalTwin, camera);
  const scoredNow = scoreAt(photos, scoring, finalTwin, pin, rawKinds, finalAssignment);
  const matched = scoredNow.matches;
  const score = scoreOf(matched);
  const proportions = proportionsOf(matched);
  camera = { ...camera, score: score ?? 0 };

  // an inventory that came in upside down goes out the right way up, so the
  // next fit (and the studio) read the same boxes; the labels stay the
  // model's own (a turned reading is a note, not an edit)
  if (cleaned.flipped) finalSpec = { ...finalSpec, detected: { ...finalSpec.detected, elements: cleaned.elements } } as RoomSpec;

  const { unmatchedPhoto, unmatchedTwin, coverage, residuals, hints } = measurementDetails(photos, cleaned.elements, finalTwin, scoring, scoredNow, finalAssignment);

  return {
    spec: withCamera(finalSpec, camera),
    camera,
    score,
    proportions,
    coverage,
    matched,
    unmatchedPhoto,
    unmatchedTwin,
    residuals,
    hints,
    iterations,
    evaluations,
    ms: Date.now() - t0,
    lossBefore,
    lossAfter: scoredNow.loss,
    endedBy,
    originalScore,
    spec_unchanged: gated ? (partial ? 'partial' : 'gated') : null,
    notes,
  };
}

export { cameraBasis };
