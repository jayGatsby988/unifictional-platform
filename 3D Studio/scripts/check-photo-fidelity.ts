/**
 * MANHATTAN — PHOTO FIDELITY: the client's seven promises, as assertions.
 *
 *   npx tsx scripts/check-photo-fidelity.ts [--out <file>]
 *
 * The client, verbatim: *"i js need every generation to be like the same
 * lengths as the things described in the image i give u, like same cabinet
 * colour and style, same floor and countertop size and style, and the small
 * overhead cabinets need to be there, the dishwasher, and all colors and
 * designs have to be the same."*
 *
 * `scratchpad/ACCEPTANCE.md` turns that sentence into seven groups; this file
 * turns those groups into numbers. Every group runs against EVERY kitchen
 * fixture — `client-tan`, `client-marble`, `client-marble-items`,
 * `client-shelves` and `defaultKitchen()` — because a fix that makes the tan
 * kitchen right and the marble one wrong is not a fix. No network.
 *
 * HOW TO READ A FAILURE. Every row prints what was MEASURED beside what it
 * must reach, so a build stream can see exactly how far it has to move a
 * number. Many rows fail today; that is the point of writing this before the
 * streams start. A threshold moved to make a row green is a lie to the client
 * — fail loudly with the number instead.
 *
 * STATUS VOCABULARY
 *   PASS     measured, and it meets the promise
 *   FAIL     measured, and it does not — the number is printed
 *   PENDING  cannot be measured yet because the field or the code it needs has
 *            not landed; names the stream that owns it, plus whatever part of
 *            the promise IS measurable today
 *   N/A      the promise does not apply to this fixture (no photo, no island…)
 *
 * THIS SUITE IS NOT PART OF THE 14-GREEN GATE. The other `scripts/check-*.ts`
 * assert that the code does what it was built to do; this one asserts that the
 * twin matches the client's photograph, which it does not yet. It is red on
 * purpose. A stream verifying "all 14 check-*.ts green" should run those 14 —
 * this file is the target it is moving toward, and every row it turns green is
 * a promise kept.
 *
 * WHAT IS MEASURED AGAINST WHAT. The twin is built the way the app builds it:
 * `healContract` → `ensureSpecMaterials` → `fitToPhoto` → `computeKitchenLayout`
 * → `buildKitchenPartsRaw`. Colour truth is the analyzer's own
 * `FinishObservation` for that slot (it read the photo correctly on the
 * fixtures that matter — see DIAGNOSIS-tan.md defect 4), so a colour row that
 * fails is the MATCHER losing what the analyzer saw, never a guess of mine.
 * The only numbers taken from the photograph by eye are in `PHOTO_FACTS`, and
 * each one says how it was read.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { filletBox } from '../src/components/scene/detail';
import { buildKitchenPartsRaw } from '../src/components/scene/kitchen/budget';
import { computeKitchenLayout, hoodExtents, type KAppliance, type KRun, type KitchenLayoutData } from '../src/components/scene/kitchen/layout';
import type { Part } from '../src/components/scene/kitchen/parts';
import { reconcileSpec } from '../src/lib/ai/reconcile';
import { fitToPhoto, healContract, kitchenElementBoxes, makeCamera, projectElement, projectElementRaw, type Box4, type FitMatch } from '../src/lib/fit';
import { CATALOG_BY_ID, DEFAULT_SELECTIONS, type MaterialDef } from '../src/lib/materials/catalog';
import { deltaE, materialAccent, materialColor } from '../src/lib/materials/color';
import { ensureSpecMaterials, finishPromise, isCustomMaterialId, isMirrorFamily } from '../src/lib/materials/match';
import { ITEM_KINDS, ITEM_SIZE } from '../src/lib/spec/decor-items';
import { defaultKitchen } from '../src/lib/spec/defaults';
import type { DecorItem, DecorItemKind, FinishObservation, KitchenSpec, MaterialSlotId, PhotoElementKind } from '../src/lib/spec/types';
import { resolveUppers2HeightIn, STACK_MIN_ROW_IN } from '../src/lib/spec/uppers';
import { inch } from '../src/lib/units';

// ---------------------------------------------------------------------------
// Tolerances — every one of them is ACCEPTANCE.md's, and none may be loosened
// ---------------------------------------------------------------------------

/**
 * §1: the twin's size must be within 10% of what the photo supports.
 *
 * THIS NUMBER HAS NOT MOVED AND MUST NOT. It fails today on client-tan
 * (85.0%), client-marble (88.3%) and client-marble-items (87.4%); each failing
 * row prints its own decomposition (`proportionsWhy`) so the gap explains
 * itself rather than sitting there as one opaque percentage.
 *
 * WHAT THE DECOMPOSITION SAYS, measured 2026-09-08 over every matched pair:
 * the deficit is not concentrated anywhere. On client-tan the five worst pairs
 * of 45 are 5.4 of the 15.0 points missing, and the tail is 22 counter items
 * worth 2.2 points between them. Two counterfactuals bound it:
 *
 *   · make every pot, stool, pendant, plant, tap and sink pixel-perfect and
 *     client-tan reaches 90.1%, client-marble-items 89.5%. The set dressing is
 *     not what is holding these photos under the line.
 *   · measure the CARPENTRY alone (runs, island, appliances, openings, 55% of
 *     the weight) and client-tan scores 88.4%, client-marble 88.9%. The
 *     cabinetry itself is outside 10%, so no reweighting can rescue the row.
 *
 * WHY the carpentry is outside 10%, in one sentence: an inventory box is what
 * is VISIBLE and a twin box is the whole element, and nothing reconciles the
 * two where an object stands in front. client-tan's back base run is boxed
 * x 0.325–0.857 while the uppers screwed to the wall above it span 0.026–0.862
 * and the island covers 0–0.482 — the run's left "end" is the island's near
 * edge, and the twin is charged 1.4 of those 15 points for drawing the run the
 * full length of its wall, which is what the photograph actually shows.
 * `PhotoElement.open` is the field that would say so and only the FRAME ever
 * sets it.
 *
 * Inferring those occluded edges from the boxes was built and measured: it
 * moves client-tan to 87.7% (mean IoU 68.9% → 73.8%, and the plausibility gate
 * stops discarding the fit), client-marble to 89.5%, client-marble-items to
 * 88.5% — and still reaches none of them past 90%, while costing four
 * assertions in `check-fit` (a client-shelves shelf board stops landing, and
 * runs grow without their base widths following, which §1.3 below catches).
 * It was reverted rather than shipped half-proven; the measurement stands as
 * the reason this row is red and the threshold is not.
 */
const PROPORTIONS_MIN = 0.90;
/** §1: base cabinet widths must still sum to the run they sit on. */
const RUN_SUM_TOL = 0.10;
/** §2/§3/§4/§7: a base colour this far from the observation is a different colour. */
const DE_BASE = 8;
/** §2/§4: the vein / grain / fleck, which is what separates two whites. */
const DE_ACCENT = 12;
/** §3: a plank width read to the nearest inch. */
const PLANK_W_TOL_IN = 0.5;
/** §4: thickness and overhang. */
const COUNTER_TOL_IN = 0.5;
/** §5: bare wall above a hood, under a row of uppers that reaches the ceiling. */
const HOOD_BARE_MAX_IN = 24;
/** §5: how close to the ceiling a row has to stop for "the uppers reach the ceiling". */
const ROW_AT_CEILING_IN = 12;
/** §5: the drawn wall-cabinet count may differ from the photo's by this much. */
const UPPER_COUNT_TOL = 1;
/** §7: a break in the splash wider than this is a hole in the wall. */
const SPLASH_GAP_MAX_IN = 2;
/** §6/§7: geometric slop, in metres — below this two surfaces are touching. */
const EPS = 1e-4;

/**
 * §7 — what each item kind may plausibly measure, in inches, from
 * brief-PROPS §1c (which measured the client's own render). `ITEM_SIZE`'s own
 * maxima are far more generous — an 18 in bread loaf and a 16 in pot filler
 * both came through it — so the clamp table cannot be its own judge.
 * Only the kinds the brief measured are listed; everything else falls back to
 * its `ITEM_SIZE` maximum, which is still a real assertion.
 */
const ITEM_MAX_IN: Partial<Record<DecorItemKind, number>> = {
  other: 14, vase: 14, bowl: 13, 'fruit-bowl': 13, pot: 13, jar: 10, canister: 10, candle: 8,
};

// ---------------------------------------------------------------------------
// Facts read off the client's photograph, by eye
// ---------------------------------------------------------------------------

interface PhotoFacts {
  /**
   * Distinct wall-cabinet BOXES on the back wall. Counted from
   * `scratchpad/photos/q2o89Aanne.jpg`: five column positions across the back
   * wall (glass pair, solid door, the cabinet sitting on the hood, glass pair,
   * solid door), each split into a tall lower tier and a short transom tier —
   * 5 × 2 = 10. The ±1 tolerance covers whether the hood column is one box or
   * two.
   */
  backWallUppers: number;
  /**
   * Which world axis the floor boards run along. In the photo the joints
   * recede toward the back wall — front to back — so the long axis is world Z.
   */
  plankAxis: 'x' | 'z';
  /** The dishwasher is visibly stainless (a brushed door with a bar handle), not a cabinet panel. */
  dishwasherFinish: 'stainless';
  source: string;
}

const PHOTO_FACTS: Record<string, PhotoFacts> = {
  'client-tan': {
    backWallUppers: 10,
    plankAxis: 'z',
    dishwasherFinish: 'stainless',
    source: 'scratchpad/photos/q2o89Aanne.jpg, read by eye',
  },
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type Status = 'PASS' | 'FAIL' | 'PENDING' | 'N/A';

interface Row {
  group: number;
  /** short, stable name — this is what a stream greps for */
  name: string;
  status: Status;
  measured: string;
  target: string;
}

class Sheet {
  readonly rows: Row[] = [];
  constructor(readonly fixture: string) {}

  add(group: number, name: string, status: Status, measured: string, target: string) {
    this.rows.push({ group, name, status, measured, target });
  }
  /** the common case: a boolean promise with its number on both sides */
  assert(group: number, name: string, ok: boolean, measured: string, target: string) {
    this.add(group, name, ok ? 'PASS' : 'FAIL', measured, target);
  }
  pending(group: number, name: string, owner: string, measured: string, target: string) {
    this.add(group, name, 'PENDING', `${measured} [PENDING ${owner}]`, target);
  }
  na(group: number, name: string, why: string) {
    this.add(group, name, 'N/A', why, '—');
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const IN = (m: number) => m / inch(1);
const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * The SECOND colour of a catalog entry — the vein in a slab, the grain in a
 * plank, the fleck in a granite — which is what the analyzer reports as
 * `accentColorHex` and therefore the only fair thing to compare it against.
 * Uses the same procedural or measured photographic accent as the matcher.
 * An unmeasured accent remains unknown; no colour threshold is changed.
 */
function accentOf(def: MaterialDef, pattern?: string): string | null {
  return materialAccent(def, pattern);
}

const obsFor = (spec: KitchenSpec, slot: string): FinishObservation | undefined =>
  (spec.detected?.finishes ?? []).find((o) => o?.slot === slot);

const materialFor = (spec: KitchenSpec, slot: string): MaterialDef | undefined => {
  const id = (spec.materials as unknown as Record<string, string>)?.[slot];
  return id ? CATALOG_BY_ID[id] : undefined;
};

const idFor = (spec: KitchenSpec, slot: string): string =>
  ((spec.materials as unknown as Record<string, string>)?.[slot] ?? '');

/** Every vertex of a geometry as a flat array, for exact shape comparison. */
function positionsOf(g: THREE.BufferGeometry): Float32Array | null {
  const p = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!p) return null;
  return p.array instanceof Float32Array ? p.array : new Float32Array(Array.from(p.array as ArrayLike<number>));
}

function sameGeometry(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  const pa = positionsOf(a), pb = positionsOf(b);
  if (!pa || !pb || pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) if (Math.abs(pa[i] - pb[i]) > 1e-6) return false;
  return true;
}

/**
 * The fallback `otherBox` (`items.ts`): a fillet box lifted onto its own base.
 * Rebuilt here at the item's exact drawn size so "uses the fallback box" is an
 * identity, not a shape heuristic — the moment PROPS replaces it with a real
 * form the comparison stops matching.
 */
function fallbackBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const W = Math.max(0.01, w), H = Math.max(0.01, h), D = Math.max(0.01, d);
  return filletBox(W, H, D, 0.006, 2).clone().translate(0, H / 2, 0);
}

/**
 * Is this geometry a plain cuboid? Every vertex of a box (filleted or not)
 * sits on one of its six bounding planes; a globe, a loaf or a jug puts most
 * of its vertices well inside all six. The second guard behind `fallbackBox`,
 * so a fallback that merely changes its fillet radius is still caught.
 */
function cuboidFraction(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!p || p.count === 0) return 0;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const tol = 0.002;
  let on = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (
      Math.abs(x - bb.min.x) < tol || Math.abs(x - bb.max.x) < tol
      || Math.abs(y - bb.min.y) < tol || Math.abs(y - bb.max.y) < tol
      || Math.abs(z - bb.min.z) < tol || Math.abs(z - bb.max.z) < tol
    ) on++;
  }
  return on / p.count;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Fixture {
  key: string;
  /** the spec as it enters the app: healed, materials ensured */
  spec: KitchenSpec;
  /** photo aspect — the solved camera's when there is one, else the aspect check-fit uses */
  aspect: number;
  facts: PhotoFacts | null;
}

const FIXTURE_ASPECT: Record<string, number> = {
  // the two fixtures whose camera was never solved; the same numbers check-fit
  // fits them with, so a proportion measured here is the one measured there
  'client-marble': 1.784,
  'client-shelves': 1.499,
};

function loadFixture(name: string): Fixture {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/${name}.spec.json`, import.meta.url), 'utf8')) as KitchenSpec;
  const spec = healContract(raw) as KitchenSpec;
  ensureSpecMaterials(spec);
  return {
    key: name,
    spec,
    aspect: spec.detected?.camera?.solved?.aspect ?? FIXTURE_ASPECT[name] ?? 4 / 3,
    facts: PHOTO_FACTS[name] ?? null,
  };
}

function demoFixture(): Fixture {
  const spec = defaultKitchen();
  ensureSpecMaterials(spec);
  return { key: 'defaultKitchen', spec, aspect: 4 / 3, facts: null };
}

// ---------------------------------------------------------------------------
// 1. SAME LENGTHS
// ---------------------------------------------------------------------------

interface Fitted {
  spec: KitchenSpec;
  proportions: number | null;
  score: number | null;
  camera: ReturnType<typeof fitToPhoto>['camera'];
  ms: number;
  photoCount: number;
  /** the matched pairs, kept so a failing proportions row can say WHERE its deficit is */
  matched: FitMatch[];
}

function runFit(f: Fixture): Fitted {
  const photoCount = (f.spec.detected?.elements ?? []).length;
  if (!photoCount) {
    return { spec: f.spec, proportions: null, score: null, camera: f.spec.detected.camera.solved ?? ({} as Fitted['camera']), ms: 0, photoCount: 0, matched: [] };
  }
  const r = fitToPhoto(f.spec, { aspect: f.aspect });
  return { spec: r.spec as KitchenSpec, proportions: r.proportions, score: r.score, camera: r.camera, ms: r.ms, photoCount, matched: r.matched };
}

/**
 * The CARPENTRY: the elements the client meant by "the same lengths as the
 * things described in the image" — the runs, the island, the appliances and
 * the openings. Everything else the inventory boxes (a pot on a shelf, a
 * stool, a pendant, a plant) is set dressing that the same weighted mean
 * charges for at full price.
 */
const CARPENTRY_KINDS = new Set<PhotoElementKind>([
  'base-cabinet-run', 'upper-cabinet-run', 'tall-cabinet', 'island', 'fridge', 'range', 'cooktop', 'hood', 'dishwasher', 'window', 'door',
]);

/**
 * The SET DRESSING: a pot on a shelf, a stool, a plant, a pendant, a tap, a
 * sink. Not what "the same lengths as the things described in the image"
 * meant, and between them a third of the matched pairs on a busy photograph —
 * so "the clutter is dragging the number down" is a claim worth measuring
 * rather than assuming.
 */
const DRESSING_KINDS = new Set<PhotoElementKind>(['item', 'stool', 'plant', 'pendant', 'faucet', 'sink']);

/**
 * WHY a proportions row failed, decomposed, so the number is not the whole
 * story a reader gets. Two counterfactuals bounding it from both sides, both
 * measured off the same fit that produced the headline:
 *
 *   floor     the weighted mean over CARPENTRY_KINDS alone. A floor UNDER the
 *             threshold settles it: no reweighting can lift a mean above a
 *             bound its heaviest, most important half already sits under.
 *   ceiling   what the headline would be with every DRESSING_KINDS pair
 *             PIXEL-PERFECT. A ceiling under the threshold says the same thing
 *             from the other side — the clutter is not what is holding it down.
 *
 * Then the three pairs carrying the most of the deficit, by name, so the next
 * reader starts where the points are. See the note at `PROPORTIONS_MIN` for
 * what these numbers were when they were last read in full.
 */
function proportionsWhy(matched: FitMatch[]): string {
  if (!matched.length) return '';
  const sums = (list: FitMatch[]) => list.reduce((a, m) => ({ w: a.w + m.weight, e: a.e + m.weight * m.err }), { w: 0, e: 0 });
  const all = sums(matched);
  const carp = sums(matched.filter((m) => CARPENTRY_KINDS.has(m.kind)));
  const dress = sums(matched.filter((m) => DRESSING_KINDS.has(m.kind)));
  if (all.w <= 0 || carp.w <= 0 || all.e <= 0) return '';
  const worst = [...matched].sort((a, b) => b.weight * b.err - a.weight * a.err).slice(0, 3)
    .map((m) => `${m.kind}${m.wall ? `/${m.wall}` : ''} ${pct((m.weight * m.err) / all.e)}`).join(', ');
  return ` — carpentry alone ${pct(1 - carp.e / carp.w)} (${pct(carp.w / all.w)} of the weight);`
    + ` ${pct(1 - (all.e - dress.e) / all.w)} with every stool/pot/plant/pendant/tap/sink exact;`
    + ` worst: ${worst}`;
}

function group1(s: Sheet, f: Fixture, fit: Fitted, L: KitchenLayoutData) {
  // 1.1 the headline number: every element within 10% of what the photo supports
  if (fit.proportions === null) {
    s.na(1, 'proportions', `no photo elements on ${f.key}`);
  } else {
    const ok = fit.proportions >= PROPORTIONS_MIN;
    s.assert(1, 'proportions', ok,
      `${pct(fit.proportions)} (IoU ${fit.score === null ? '–' : pct(fit.score)}, ${fit.photoCount} boxes, ${fit.ms} ms)${ok ? '' : proportionsWhy(fit.matched)}`,
      `>= ${pct(PROPORTIONS_MIN)}`);
  }

  // 1.2 a run cannot be longer than the wall it is screwed to
  const over = L.runs
    .map((r) => ({ id: r.id, over: IN(r.length - r.wallLen) }))
    .filter((r) => r.over > 0.5);
  s.assert(1, 'run fits its wall', over.length === 0,
    over.length ? over.map((r) => `${r.id} +${r1(r.over)} in`).join(', ') : `${L.runs.length} runs, worst ${r1(Math.max(...L.runs.map((r) => IN(r.length - r.wallLen)), -99))} in`,
    '<= 0 in over the wall');

  // 1.3 the declared cabinets still add up to the declared run (a fit that
  //     stretches a run without refitting its boxes shows up here)
  const bad = f.spec.runs.map((run) => {
    const fitted = (fit.spec.runs ?? []).find((r) => r.id === run.id) ?? run;
    const sum = (fitted.base ?? []).reduce((n, b) => n + (b?.widthIn ?? 0), 0);
    const len = (fitted.lengthFt ?? 0) * 12;
    return { id: run.id, err: len > 0 ? Math.abs(sum - len) / len : 0, sum, len };
  });
  const worst = bad.sort((a, b) => b.err - a.err)[0];
  s.assert(1, 'base widths sum to the run', bad.every((b) => b.err <= RUN_SUM_TOL),
    worst ? `worst ${worst.id}: ${r1(worst.sum)} in of ${r1(worst.len)} in (${pct(worst.err)} off)` : 'no runs',
    `<= ${pct(RUN_SUM_TOL)} off`);

  // 1.4 the island the client complained about: a box the frame cut is a LOWER
  //     bound, so the twin must run off the picture there rather than stopping
  //     at the visible stub
  const el = (fit.spec.detected?.elements ?? []).find((e) => e.kind === 'island');
  const open = el?.open ?? null;
  const cut = !!open && (open.left || open.right) && (el?.openCause === 'frame' || el?.openCause === 'both');
  if (!el) {
    s.na(1, 'truncated island', 'no island box in the inventory');
  } else if (!cut || !open) {
    s.na(1, 'truncated island', `island box is not frame-open on a side edge (open ${JSON.stringify(el.open)}, cause ${el.openCause})`);
  } else {
    const stub = f.spec.island?.lengthFt ?? 0;
    const now = fit.spec.island?.lengthFt ?? 0;
    const pin = makeCamera(fit.camera);
    const twinIsland = kitchenElementBoxes(L).find((e) => e.kind === 'island');
    const box: Box4 | null = twinIsland ? projectElement(pin, twinIsland) : null;
    const raw: Box4 | null = twinIsland ? projectElementRaw(pin, twinIsland) : null;
    // What the picture CAN check: the island runs off the edge it was cut on
    // (its unclamped projection crosses it), and the part that IS visible is
    // the size the photo measured, to §1's own 10%.
    const runsOff = !!raw && ((open.left && raw[0] <= 0) || (open.right && raw[2] >= 1));
    const seen = box ? box[2] - box[0] : 0;
    const shown = el.box.x1 - el.box.x0;
    const err = shown > 1e-4 ? Math.abs(seen - shown) / shown : 1;
    s.assert(1, 'truncated island', runsOff && err <= RUN_SUM_TOL,
      `visible span ${r2(seen)} of frame against the photo's ${r2(shown)} (${pct(err)} off); unclamped twin x ${raw ? `${r2(raw[0])}–${r2(raw[2])}` : 'off-camera'} against a frame cut at ${open.left ? '0' : '1'}`,
      `the twin crosses the cut edge and its visible part is within ${pct(RUN_SUM_TOL)} of the photo's`);

    // What it CANNOT: how far the island runs past the cut — and the reason is
    // NOT that the projection is flat. That was the previous claim here and the
    // measurement contradicts it. Through the solved camera, at the declared
    // anchor, the loss is unimodal with a STRICT minimum at the stub:
    //
    //     4.0 ft 0.416248 | 5.0 ft 0.382991 | 5.5 ft 0.386986
    //     6.0 ft 0.400381 | 6.88 ft 0.426595   (6.88 is all the room allows)
    //
    // and it still rises when the anchor is slid left to hold the VISIBLE right
    // end where the photo pins it (0.383 → 0.387 → 0.400 → 0.427). So the photo
    // does choose, and as boxed it chooses the stub: a 5 ft island already runs
    // off the cut edge (its unclamped left edge is −0.341 of the frame) and
    // already covers the visible span to 0.0%, while every extra foot moves the
    // stools, the pendants and the one end the picture can measure.
    //
    // Two further facts, both measured, so the next reader does not re-derive
    // them: widening the room does not lengthen the island (the layout draws
    // the DECLARED length: 5.00 ft at widthFt 15.03, 16, 17 and 18), and on
    // this fixture the fit's spec edits are discarded wholesale by the
    // plausibility gate (fitted gate 0.699 against the original 0.671 + a 0.03
    // margin), so `island.lengthFt` never moves at all.
    //
    // What is actually missing is the analyzer's reading. Its own assumption
    // list says it guessed the length from two visible stools; the
    // extrapolation rule that fixes that ("a box with an open edge is a LOWER
    // BOUND — extrapolate by the repeat unit in whole units", contract §3) is
    // landed in the prompt and needs a re-analysis, which no build stream can
    // run against a frozen fixture.
    const target = stub * (1 + RUN_SUM_TOL);
    if (now >= target) s.assert(1, 'island length past the cut', true, `${r2(stub)} ft → ${r2(now)} ft`, `>= ${r2(target)} ft`);
    else s.pending(1, 'island length past the cut', 'analyzer (prompt landed; needs a re-analysis)',
      `${r2(stub)} ft → ${r2(now)} ft; the room draws up to ${r2(maxIslandFt(fit.spec))} ft at this anchor, and through the solved camera the loss has a strict minimum AT the stub (0.3830 at 5.0 vs 0.3870 at 5.5 and 0.4266 at 6.88) — the boxes as drawn prefer it, so only a re-read of the photo can move it`,
      `>= ${r2(target)} ft (the stub +${pct(RUN_SUM_TOL)})`);
  }}

/** The longest island this room will actually draw at the spec's own anchor. */
function maxIslandFt(spec: KitchenSpec): number {
  if (!spec.island?.present) return 0;
  let best = 0;
  for (let ft = 2; ft <= 30; ft += 0.25) {
    const drawn = computeKitchenLayout({ ...spec, island: { ...spec.island, lengthFt: ft } }).island;
    if (drawn) best = Math.max(best, drawn.len / 0.3048);
  }
  return best;
}

// ---------------------------------------------------------------------------
// 2. SAME CABINET COLOUR AND STYLE
// ---------------------------------------------------------------------------

const CAB_SLOTS: MaterialSlotId[] = ['cabinets_base', 'cabinets_upper', 'cabinets_tall'];

/** One colour row: base ΔE, and accent ΔE where both sides have an accent. */
function colourRow(s: Sheet, group: number, spec: KitchenSpec, slot: string, deBase = DE_BASE, deAccent = DE_ACCENT) {
  const obs = obsFor(spec, slot);
  if (!obs) {
    s.na(group, `${slot} colour`, 'no observation for this slot');
    s.na(group, `${slot} accent`, 'no observation for this slot');
    return;
  }
  const def = materialFor(spec, slot);
  if (!def) {
    s.add(group, `${slot} colour`, 'FAIL', `slot resolves to '${idFor(spec, slot)}' — no such material`, 'a real material');
    s.na(group, `${slot} accent`, 'the slot resolves to nothing');
    return;
  }
  const base = materialColor(def);
  const dE = base ? deltaE(obs.baseColorHex, base) : 999;
  s.assert(group, `${slot} colour`, dE <= deBase,
    `${def.id} ${base ?? '(no colour)'} vs observed ${obs.baseColorHex} — ΔE ${r1(dE)}`,
    `ΔE <= ${deBase}`);

  const a = accentOf(def, obs.pattern);
  if (!obs.accentColorHex) { s.na(group, `${slot} accent`, 'the observation has no accent'); return; }
  if (!a) {
    // an entry with no procedural recipe has no second colour to compare; that
    // is unknown, not wrong — but it is also the state where the vein the
    // client complained about cannot be honoured at all
    s.pending(group, `${slot} accent`, 'MAT', `${def.id} has no procedural accent to compare with observed ${obs.accentColorHex}`, `ΔE <= ${deAccent}`);
    return;
  }
  const dA = deltaE(obs.accentColorHex, a);
  s.assert(group, `${slot} accent`, dA <= deAccent,
    `${def.id} accent ${a} vs observed ${obs.accentColorHex} — ΔE ${r1(dA)}`,
    `ΔE <= ${deAccent}`);
}

function group2(s: Sheet, spec: KitchenSpec, L: KitchenLayoutData, parts: Part[]) {
  for (const slot of CAB_SLOTS) colourRow(s, 2, spec, slot);

  // the door style the analyzer read must survive into the layout…
  s.assert(2, 'doorStyle preserved', L.doorStyle === spec.cabinets.doorStyle,
    `spec '${spec.cabinets.doorStyle}' → drawn '${L.doorStyle}'`, 'the same word');

  // …and the drawn front must actually be that style: a slab is 12 triangles,
  // a shaker front is stiles + rails + a recessed centre with a chamfer on
  // every edge, so a framed style whose door is box-shaped is a slab in
  // disguise
  const doorish = parts.filter((p) => /-f\d+$/.test(p.key));
  const tris = doorish.map((p) => {
    const idx = p.geometry.getIndex();
    const pos = p.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    return idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
  });
  const minTris = tris.length ? Math.min(...tris) : 0;
  const framed = L.doorStyle !== 'slab';
  if (!doorish.length) s.na(2, 'door has rails and stiles', 'no door fronts drawn');
  else if (!framed) s.na(2, 'door has rails and stiles', `doorStyle '${L.doorStyle}' is a flat slab by definition`);
  else s.assert(2, 'door has rails and stiles', minTris > 12,
    `${doorish.length} fronts, thinnest ${minTris} triangles`, '> 12 triangles (a plain box is 12)');
}

// ---------------------------------------------------------------------------
// 3. SAME FLOOR, SIZE AND STYLE
// ---------------------------------------------------------------------------

/**
 * Which world axis the drawn boards run along.
 *
 * The floor is `worldPlane(w, d)` with world UVs, so u = world X and v = world
 * Z; `plankFloor` lays plank COLUMNS along u and runs each board's length
 * along v. So the boards run along world Z, and `PBRRecipe.rotate90` — which
 * `materials.ts` turns into `texture.rotation = π/2` for both texture and
 * canvas maps — is the only thing that turns them. Null when the entry is not
 * a plank at all (a tile floor has no direction to be wrong about).
 */
function drawnPlankAxis(def: MaterialDef | undefined): 'x' | 'z' | null {
  if (!def) return null;
  const kind = def.pbr.procedural?.kind;
  if (kind !== 'plank' && kind !== 'wood') return null;
  return def.pbr.rotate90 ? 'x' : 'z';
}

/** The room-frame axis an observation's `plankRun` asks for, given what the camera faces. */
function wantedPlankAxis(obs: FinishObservation, lookingAt: string | null | undefined): 'x' | 'z' | null {
  if (!obs.plankRun || obs.plankRun === 'diagonal') return null;
  // 'toward' = the joints recede toward the wall the camera looks at; facing
  // the back or front wall that is world Z, facing a side wall it is world X
  const towardAxis: 'x' | 'z' = lookingAt === 'left' || lookingAt === 'right' ? 'x' : 'z';
  return obs.plankRun === 'toward' ? towardAxis : towardAxis === 'z' ? 'x' : 'z';
}

function group3(s: Sheet, f: Fixture, spec: KitchenSpec) {
  const obs = obsFor(spec, 'flooring');
  const def = materialFor(spec, 'flooring');
  if (!obs) {
    s.na(3, 'floor direction', 'no flooring observation');
    s.na(3, 'plank width', 'no flooring observation');
  }
  else {
    // direction
    const drawn = drawnPlankAxis(def);
    const want = wantedPlankAxis(obs, spec.detected?.camera?.lookingAt) ?? f.facts?.plankAxis ?? null;
    // Say plainly WHERE the direction came from. On every fixture we own
    // `plankRun` is null, so where a fixture also has a hand-read photo fact
    // the twin is right by COINCIDENCE — the recipe's default axis (world z)
    // happens to be the axis the photo shows — and the row must not read as a
    // pipeline that chose. §floor-direction in check-materials is where the
    // mechanism itself is exercised, on synthetic observations.
    const why = obs.plankRun
      ? `plankRun '${obs.plankRun}' with the camera facing ${spec.detected?.camera?.lookingAt}`
      : f.facts ? `the observation's plankRun is null — nothing in the pipeline chose this; the recipe's default axis happens to agree with ${f.facts.source}` : 'nothing says which way';
    if (!drawn) s.na(3, 'floor direction', `${def?.id ?? '(none)'} is not a plank surface`);
    else if (!want) s.pending(3, 'floor direction', 'MAT + analyzer', `drawn along ${drawn}; the observation's plankRun is null and there is no photo reading for ${f.key}`, 'boards along the photo\'s axis');
    else s.assert(3, 'floor direction', drawn === want,
      `${def?.id} draws boards along world ${drawn} (rotate90 ${def?.pbr.rotate90 ? 'on' : 'off'}); the photo wants ${want} — ${why}`,
      `boards along world ${want}`);

    // width — the observation's module, not a stock plank
    const wantW = obs.moduleIn?.w ?? null;
    const gotW = (def?.pbr.procedural?.options as { widthM?: number } | undefined)?.widthM ?? null;
    if (wantW === null) s.na(3, 'plank width', 'the observation carries no moduleIn');
    else if (gotW === null) s.na(3, 'plank width', `${def?.id ?? '(none)'} has no plank width to read`);
    else s.assert(3, 'plank width', Math.abs(IN(gotW) - wantW) <= PLANK_W_TOL_IN,
      `${def?.id} draws ${r1(IN(gotW))} in boards; the photo reads ${r1(wantW)} in`,
      `within ${PLANK_W_TOL_IN} in`);
  }
  colourRow(s, 3, spec, 'flooring');
}

// ---------------------------------------------------------------------------
// 4. SAME COUNTERTOP, SIZE AND STYLE
// ---------------------------------------------------------------------------

function group4(s: Sheet, f: Fixture, spec: KitchenSpec, L: KitchenLayoutData) {
  colourRow(s, 4, spec, 'countertop');

  // the client's own sentence: "the countertop was not a design it was js
  // white". The gold-veined Calacatta is the pick that produced it.
  if (f.key === 'client-tan') {
    s.assert(4, 'tan counter is not calacatta', idFor(spec, 'countertop') !== 'ct-calacatta-quartz',
      `countertop = ${idFor(spec, 'countertop')}`, 'anything but ct-calacatta-quartz (gold veins on a warm-grey-veined photo)');
  } else {
    s.na(4, 'tan counter is not calacatta', 'fixture-specific to client-tan');
  }

  // one material in the photo means one material in the twin
  const islandObs = obsFor(spec, 'island_countertop');
  if (!L.island) s.na(4, 'island top matches the perimeter', 'no island');
  else if (!obsFor(spec, 'countertop')) s.na(4, 'island top matches the perimeter', 'no photo observed this kitchen — a designed demo may contrast its island on purpose');
  else if (islandObs) s.na(4, 'island top matches the perimeter', 'the photo shows a second countertop material');
  else s.assert(4, 'island top matches the perimeter', idFor(spec, 'island_countertop') === idFor(spec, 'countertop'),
    `island_countertop ${idFor(spec, 'island_countertop')} vs countertop ${idFor(spec, 'countertop')}`,
    'the same material id');

  // size: the slab the spec asked for is the slab that got drawn
  const wantT = spec.countertop.thicknessIn ?? 1.5;
  const gotT = IN(L.counterT);
  s.assert(4, 'counter thickness', Math.abs(gotT - wantT) <= COUNTER_TOL_IN,
    `drawn ${r1(gotT)} in, spec ${r1(wantT)} in`, `within ${COUNTER_TOL_IN} in`);
  const wantO = spec.countertop.overhangIn;
  if (wantO === null || wantO === undefined) s.na(4, 'counter overhang', 'the spec leaves the overhang to the scene');
  else {
    // the overhang is drawn as the counter's projection past the base boxes
    const got = IN(L.runs.reduce((n, r) => Math.max(n, r.counterDepth - r.baseDepth), 0));
    s.assert(4, 'counter overhang', Math.abs(got - wantO) <= COUNTER_TOL_IN,
      `drawn ${r1(got)} in, spec ${r1(wantO)} in`, `within ${COUNTER_TOL_IN} in`);
  }
}

// ---------------------------------------------------------------------------
// 5. THE SMALL OVERHEAD CABINETS
// ---------------------------------------------------------------------------

/** Wall cabinets the run actually draws as boxes (a gap is a hole, not a cabinet). */
const drawnUppers = (r: KRun) => r.uppers.filter((u) => u.type !== 'appliance-gap' && u.type !== 'hood-gap' && u.type !== 'filler');

function group5(s: Sheet, f: Fixture, spec: KitchenSpec, L: KitchenLayoutData) {
  // 5.1 two tiers where the photo shows two tiers. No fixture DECLARES a
  //     second tier yet (the analyzer has never been re-run against the landed
  //     contract), so the promise is measured by seeding one through the
  //     contract's own helpers — exactly what LayoutPanel's "Stacked uppers"
  //     toggle does — and asking the layout to draw it. A row that comes back
  //     with one bottom edge is a row that ignored `uppers2`.
  const declared = spec.runs.filter((r) => Array.isArray(r.uppers2) && r.uppers2.length > 0);
  const candidate = spec.runs.find((r) => (r.uppers?.length ?? 0) > 0 && (r.upperHeightIn ?? 0) >= STACK_MIN_ROW_IN)
    ?? spec.runs.find((r) => (r.uppers?.length ?? 0) > 0);
  const rowIn = candidate?.upperHeightIn ?? 0;
  // the SEEDED layout, kept for 5.3: the count on the back wall has to be read
  // off the same twin 5.1 measures, or the suite asserts two different kitchens
  let stackedL: KitchenLayoutData | null = null;
  let stackedWhy = '';
  if (!candidate) {
    s.na(5, 'two tiers with a rail', 'no run carries wall cabinets');
  } else if (resolveUppers2HeightIn(rowIn, candidate) === 0) {
    // the contract's own rule: a row under 45 in cannot hold a 36 in door and
    // a transom over it, so ONE tier is the right answer and demanding two
    // would be demanding a kitchen the photo does not show
    s.na(5, 'two tiers with a rail', `the tallest row on ${candidate.id} is ${r1(rowIn)} in — under the ${STACK_MIN_ROW_IN} in a stacked row needs, so one tier is correct`);
  } else {
    // NOT SEEDED. The probe is the fixture put through `reconcileSpec` — the
    // exact call `analyze.ts:372` makes between the model's answer and the fit
    // — so what this row measures is whether PRODUCTION derives the tier. The
    // previous version wrote `probeRun.uppers2 = deriveUppers2(...)` itself and
    // then asked the layout to draw it, which could only ever prove that the
    // layout can draw a tier somebody hands it; the field had no producer, so
    // re-rendering the client's kitchen still gave one 54 in door and the row
    // printed its own tell ("0 run(s) declare uppers2 today") beside a ✓.
    // If the reconciler declines, this fails with that fact rather than
    // supplying the answer.
    const probe = healContract(reconcileSpec(structuredClone(spec), { photoCount: 1, fixes: [] }) as KitchenSpec) as KitchenSpec;
    const probeRun = probe.runs.find((r) => r.id === candidate.id) ?? probe.runs.find((r) => (r.uppers2?.length ?? 0) > 0);
    if (!probeRun || !(probeRun.uppers2?.length)) {
      // fail this row and carry on — 5.2 and 5.3 still have something to say
      s.assert(5, 'two tiers with a rail', false,
        `reconcileSpec left uppers2 null on a measured ${r1(rowIn)} in row (${candidate.id}) — nothing in the pipeline creates a second tier`,
        'the reconciler seeds a second tier on a row too tall to be one door');
    } else {
    const PL = computeKitchenLayout(probe);
    stackedL = PL;
    stackedWhy = `${probeRun.id} stacked by reconcileSpec`;
    const pr = PL.runs.find((r) => r.id === probeRun.id);
    const tier2In = resolveUppers2HeightIn(rowIn, probeRun);
    const boxes = pr ? drawnUppers(pr).length : 0;
    const before = L.runs.find((r) => r.id === probeRun.id);
    // Which TIER each box belongs to, not where its underside happens to be.
    // A hood cabinet legitimately sits on the canopy, so a stacked row that
    // also carries one has THREE distinct bottoms and the old
    // `bottoms[1] - bottoms[0]` read the canopy, not the rail.
    const t1 = pr ? drawnUppers(pr).filter((u) => u.tier === 1) : [];
    const t2 = pr ? drawnUppers(pr).filter((u) => u.tier === 2) : [];
    const tiers = (t1.length ? 1 : 0) + (t2.length ? 1 : 0);
    // the rail line the run itself records; tier 1 is counter-to-rail
    const splitIn = pr && pr.upperSplit !== null ? IN(pr.upperSplit - pr.upperBottom) : 0;
    const ok = tiers >= 2 && pr !== undefined && pr.upperSplit !== null
      && boxes > (before ? drawnUppers(before).length : 0)
      && Math.abs(splitIn - (rowIn - tier2In)) <= 2;
    s.assert(5, 'two tiers with a rail', ok,
      `${probeRun.id}: reconcileSpec derived ${probeRun.uppers2.length} tier-2 boxes over a ${r1(rowIn)} in row → ${t1.length} tier-1 + ${t2.length} tier-2 boxes (was ${before ? drawnUppers(before).length : 0} in one tier), rail at ${r1(splitIn)} in; ${declared.length} run(s) declared uppers2 before the reconciler ran`,
      `2 rows of boxes, tier 1 ${r1(rowIn - tier2In)} in under a ${r1(tier2In)} in transom`);
    }
  }

  // 5.2 nothing above a hood may be bare wall — the client's oldest complaint
  const hoods = L.appliances.filter((a) => a.kind === 'hood' && a.wall !== 'island');
  if (!hoods.length) s.na(5, 'no bare wall above the hood', 'no wall hood');
  else {
    const worstBand = hoods.map((h) => bareBandIn(L, h)).sort((a, b) => b.bareIn - a.bareIn)[0];
    if (!worstBand.rowAtCeiling) {
      s.na(5, 'no bare wall above the hood', `${r1(worstBand.bareIn)} in of bare wall over ${worstBand.id}, but the row stops ${r1(worstBand.toCeilingIn)} in below the ceiling — ACCEPTANCE §5 conditions this on a ceiling-height row`);
    } else {
      s.assert(5, 'no bare wall above the hood', worstBand.bareIn <= HOOD_BARE_MAX_IN,
        `${worstBand.id}: ${r1(worstBand.bareIn)} in of bare wall between the hood top and the top of the row (cabinetAbove '${worstBand.cabinetAbove}', ${worstBand.covered ? 'a cabinet covers it' : 'nothing covers it'})`,
        `<= ${HOOD_BARE_MAX_IN} in`);
    }
  }

  // 5.3 the count on the back wall — off the SAME twin 5.1 measured, which is
  //     the fixture put through `reconcileSpec`. Every fixture's stored
  //     `uppers2` predates the contract that named the field, so counting the
  //     stored run would assert the analyzer's OLD reading rather than what the
  //     pipeline produces today.
  const countL = stackedL ?? L;
  const back = countL.runs.filter((r) => r.wall === 'back');
  const drawnCount = back.reduce((n, r) => n + drawnUppers(r).length, 0);
  const seeded = stackedL ? ` [${stackedWhy}]` : '';
  if (f.facts) {
    const want = f.facts.backWallUppers;
    s.assert(5, 'back-wall cabinet count', Math.abs(drawnCount - want) <= UPPER_COUNT_TOL,
      `${drawnCount} drawn${seeded}, photo shows ${want} (${f.facts.source})`,
      `within ${UPPER_COUNT_TOL} of ${want}`);
  } else {
    // no photo for this fixture: the analyzer's own reading is the best truth
    // available, and a layout that draws fewer boxes than the spec lists is a
    // twin dropping cabinets the photo showed
    const want = spec.runs.filter((r) => r.wall === 'back')
      .reduce((n, r) => n + (r.uppers ?? []).filter((u) => u.type !== 'appliance-gap' && u.type !== 'hood-gap').length + (r.uppers2 ?? []).filter((u) => u.type !== 'appliance-gap').length, 0);
    s.assert(5, 'back-wall cabinet count', Math.abs(drawnCount - want) <= UPPER_COUNT_TOL,
      `${drawnCount} drawn, spec declares ${want} (no photo for ${f.key} — the analyzer's reading stands in)`,
      `within ${UPPER_COUNT_TOL} of ${want}`);
  }
}

/** How much bare wall a hood leaves under a row of wall cabinets. */
function bareBandIn(L: KitchenLayoutData, h: KAppliance) {
  const run = L.runs.find((r) => r.id === h.runId) ?? L.runs.find((r) => r.wall === h.wall);
  const top = hoodExtents(h).top;
  const rowTop = run?.upperTop ?? 0;
  const covered = !!run && run.uppers.some((u) =>
    Math.min(u.x1, h.x + h.width / 2) - Math.max(u.x0, h.x - h.width / 2) > h.width * 0.4
    && u.bottom <= top + inch(1)
    && (u.type === 'hood-cabinet' || u.bottom > run.upperBottom + EPS || h.cabinetAbove !== 'none'));
  return {
    id: h.id,
    bareIn: covered ? 0 : Math.max(0, IN(rowTop - top)),
    covered,
    cabinetAbove: h.cabinetAbove,
    rowAtCeiling: !!run && run.hasUppers && IN(L.h - rowTop) <= ROW_AT_CEILING_IN,
    toCeilingIn: run ? IN(L.h - rowTop) : 0,
  };
}

// ---------------------------------------------------------------------------
// 6. THE DISHWASHER
// ---------------------------------------------------------------------------

function group6(s: Sheet, f: Fixture, spec: KitchenSpec, L: KitchenLayoutData, parts: Part[]) {
  const dw = L.appliances.find((a) => a.kind === 'dishwasher');
  if (!dw) {
    const declared = spec.appliances.some((a) => a.kind === 'dishwasher');
    if (declared) s.add(6, 'dishwasher is drawn', 'FAIL', 'the spec carries a dishwasher and the layout drew none', 'one dishwasher in the layout');
    else s.na(6, 'dishwasher is drawn', 'the spec carries no dishwasher');
    s.na(6, 'dishwasher is not inside a cabinet', 'no dishwasher');
    s.na(6, 'uppers above the dishwasher render', 'no dishwasher');
    s.na(6, 'dishwasher finish', 'no dishwasher');
    return;
  }

  // 6.1 its own front and handle exist in the built parts, by id
  const mine = parts.filter((p) => p.key.startsWith(`${dw.id}-`));
  const has = (suffix: string) => mine.some((p) => p.key === `${dw.id}-${suffix}`);
  s.assert(6, 'dishwasher is drawn', has('body') && has('front') && has('handle'),
    `${mine.length} parts: ${mine.map((p) => p.key.slice(dw.id.length + 1)).join(', ') || '(none)'}`,
    'a body, a front and a handle');

  // 6.2 it is not buried inside a cabinet box — the void must be its own
  const run = L.runs.find((r) => r.id === dw.runId) ?? L.runs.find((r) => r.wall === dw.wall);
  const lo = dw.x - dw.width / 2, hi = dw.x + dw.width / 2;
  const solid = (run?.base ?? []).filter((b) => b.type !== 'appliance-gap' && Math.min(b.x1, hi) - Math.max(b.x0, lo) > inch(1));
  const gap = (run?.base ?? []).find((b) => b.type === 'appliance-gap' && Math.min(b.x1, hi) - Math.max(b.x0, lo) > dw.width * 0.5);
  s.assert(6, 'dishwasher is not inside a cabinet', solid.length === 0 && !!gap,
    solid.length ? `overlapped by ${solid.map((b) => `${b.type} ${r1(IN(Math.min(b.x1, hi) - Math.max(b.x0, lo)))} in`).join(', ')}` : gap ? `sits in ${gap.type} (filledBy ${gap.filledBy ?? 'nothing'})` : 'no appliance void claims it',
    'its own void, no cabinet over it');

  // 6.3 the cabinets above it still render
  if (!run || !run.hasUppers) s.na(6, 'uppers above the dishwasher render', 'no wall cabinets on that run');
  else {
    const window = L.openings.some((o) => o.wall === run.wall && o.kind === 'window' && Math.min(o.x + o.width / 2, hi) - Math.max(o.x - o.width / 2, lo) > dw.width * 0.4);
    const cover = drawnUppers(run).reduce((n, u) => n + Math.max(0, Math.min(u.x1, hi) - Math.max(u.x0, lo)), 0);
    const frac = cover / Math.max(EPS, dw.width);
    if (window) s.na(6, 'uppers above the dishwasher render', 'a window sits above it');
    else s.assert(6, 'uppers above the dishwasher render', frac >= 0.5,
      `${pct(frac)} of the dishwasher's width has a wall cabinet over it`, '>= 50%');
  }

  // 6.4 the finish. The client's photo shows a stainless door; the fixture
  //     says panel-ready, which is the analyzer mis-read DIAGNOSIS §9 names and
  //     the landed prompt fixes — no build stream can change a frozen fixture,
  //     so this is reported, not failed.
  const want = f.facts?.dishwasherFinish;
  if (!want) s.na(6, 'dishwasher finish', 'no photo reading for this fixture');
  else if (dw.finish === want) s.assert(6, 'dishwasher finish', true, `drawn '${dw.finish}'`, `'${want}'`);
  else s.pending(6, 'dishwasher finish', 'analyzer (prompt landed; needs a re-analysis)',
    `spec says '${dw.finish}', the photo shows '${want}' — the front takes the cabinet material, so the appliance disappears`, `'${want}'`);
}

// ---------------------------------------------------------------------------
// 7. ALL COLOURS AND DESIGNS
// ---------------------------------------------------------------------------

function group7(s: Sheet, f: Fixture, spec: KitchenSpec, L: KitchenLayoutData, parts: Part[]) {
  // 7.1 no observed slot may quietly become the room default. Reported in two
  //     rows: the surfaces the client's sentence names, and the metal / glass
  //     finishes.
  //
  //     The two rows are graded by DIFFERENT promises, and that is a statement
  //     about optics rather than a loosened threshold for a slot that would
  //     not pass. A metal has no diffuse albedo: at metalness 1 the pixel —
  //     photographed or rendered — is F0 × whatever is in the mirror
  //     direction, so a stainless panel photographs as the ROOM, and clear
  //     glass does the same through transmission. Decomposing every
  //     metal/glass difference on the four client fixtures into Lab lightness
  //     and Lab hue says which half moved: four photographs of nominally
  //     identical brushed stainless agree about its hue to inside a
  //     just-noticeable difference (ΔC 1.9 / 1.6 / 1.5 / 0.0) and disagree
  //     about its brightness by 3.7 (ΔL 4.5 / 8.2 / 4.9 / 6.2). Holding a
  //     mirror to ΔE 8 asks the photograph for a number it does not contain,
  //     and it was failing the RIGHT answers: client-marble's "stainless
  //     professional-style range" on app-stainless (Stainless Steel) at ΔE
  //     8.3, and its "oversized clear glass bell pendants" on
  //     light-pendant-glass (Clear Glass Pendants) at ΔE 9.5.
  //
  //     So the finish row asks `finishPromise` — the matcher's own rule, so
  //     the two can never disagree about what a pass is — which grades a
  //     mirror on hue (ΔC ≤ 6, the material) and lightness (ΔL ≤ 16, the room)
  //     separately. That is TIGHTER than the single ΔE ≤ 16 the matcher used
  //     to accept metals at: a metal 15 ΔE off entirely in hue now synthesises
  //     instead of snapping. Nothing here relaxes ΔE 8 for a surface.
  const FINISH_SLOTS = new Set(['hardware', 'faucet', 'appliances', 'lighting_fixture', 'fixtures']);
  const tally = (want: 'surface' | 'finish') => {
    const misses: string[] = [];
    let custom = 0, exact = 0, seen = 0;
    for (const obs of spec.detected?.finishes ?? []) {
      if (!obs?.slot) continue;
      if ((FINISH_SLOTS.has(obs.slot) ? 'finish' : 'surface') !== want) continue;
      seen++;
      const id = idFor(spec, obs.slot);
      const def = id ? CATALOG_BY_ID[id] : undefined;
      if (isCustomMaterialId(id)) { custom++; continue; }
      const p = def ? finishPromise(obs, def) : null;
      if (p?.ok) { exact++; continue; }
      const base = def ? materialColor(def) : null;
      const dE = base ? deltaE(obs.baseColorHex, base) : 999;
      misses.push(`${obs.slot} ${id || '(unset)'} ${p ? p.why : `ΔE ${r1(dE)}`}${id === DEFAULT_SELECTIONS.kitchen?.[obs.slot] ? ' (the room DEFAULT)' : ''}`);
    }
    return { misses, custom, exact, seen };
  };
  for (const want of ['surface', 'finish'] as const) {
    const t = tally(want);
    const name = want === 'surface' ? 'every observed surface resolves' : 'every observed finish resolves';
    const promise = want === 'surface'
      ? `every observation within ΔE ${DE_BASE} or synthesised`
      : `every observation within ΔE ${DE_BASE}, or — for a metal / clear glass — hue ΔC 6 and lightness ΔL 16, or synthesised`;
    if (!t.seen) { s.na(7, name, `no ${want} observations`); continue; }
    s.assert(7, name, t.misses.length === 0,
      `${t.exact} honoured, ${t.custom} synthesised, ${t.misses.length} adrift${t.misses.length ? `: ${t.misses.join('; ')}` : ''}`,
      promise);
  }

  // 7.1b the mirror budget must not become a back door. Every metal / glass
  //      slot that spent it is checked for what it spent it ON: the hue has to
  //      be the tight half. A row that only PRINTED the split would be
  //      documentation dressed as a pass — it could not fail — so the claim in
  //      the title is the assertion: over ΔE 8, the excess is lightness (ΔL >
  //      ΔC) and the entry still honours `finishPromise` on both budgets.
  const mirrors: string[] = [];
  const spent: string[] = [];
  for (const obs of spec.detected?.finishes ?? []) {
    if (!obs?.slot || !FINISH_SLOTS.has(obs.slot) || !isMirrorFamily(obs.family)) continue;
    const id = idFor(spec, obs.slot);
    const def = id && !isCustomMaterialId(id) ? CATALOG_BY_ID[id] : undefined;
    if (!def) continue;
    const p = finishPromise(obs, def);
    if (p.dE <= DE_BASE) continue;
    spent.push(`${obs.slot} ${id} ΔE ${r1(p.dE)} is ΔL ${r1(p.dL)} + ΔC ${r1(p.dC)}`);
    if (!p.ok || p.dL <= p.dC) mirrors.push(`${obs.slot} ${id} ${p.why}${p.ok ? '' : ' — OVER'}`);
  }
  if (!spent.length) s.na(7, 'a mirror finish spends its budget on lightness', 'no metal / glass slot is over ΔE 8');
  else s.assert(7, 'a mirror finish spends its budget on lightness', mirrors.length === 0,
    mirrors.length ? `${mirrors.join('; ')} (of ${spent.join('; ')})` : spent.join('; '),
    'the excess over ΔE 8 is the room, not the metal: ΔL > ΔC and both budgets still honoured');

  // 7.2 "the backsplash why is it like in squares not covering the entire
  //     surface" — a run that has a splash must have ONE continuous field
  const gaps: string[] = [];
  for (const r of L.runs) {
    if (!r.backsplash || r.splash.length < 2) continue;
    // wall that is not tile-able: a window / door opening, and the wall a tall
    // cabinet already covers. Everything else between two fields of splash is
    // the bare wall the client saw.
    const exempt: Array<[number, number]> = [
      ...L.openings.filter((o) => o.wall === r.wall).map((o): [number, number] => [o.x - o.width / 2, o.x + o.width / 2]),
      ...r.tall.map((t): [number, number] => [t.x0, t.x1]),
    ];
    const spans = [...r.splash].sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < spans.length; i++) {
      const a = spans[i - 1].x1, b = spans[i].x0;
      if (b - a <= inch(SPLASH_GAP_MAX_IN)) continue;
      const covered = exempt.reduce((n, [e0, e1]) => n + Math.max(0, Math.min(e1, b) - Math.max(e0, a)), 0);
      const bare = IN(b - a - covered);
      if (bare > SPLASH_GAP_MAX_IN) gaps.push(`${r.id} ${r1(bare)} in`);
    }
  }
  const splashRuns = L.runs.filter((r) => r.backsplash && r.splash.length).length;
  if (!splashRuns) s.na(7, 'backsplash covers the wall', 'no run carries a backsplash');
  else s.assert(7, 'backsplash covers the wall', gaps.length === 0,
    gaps.length ? `holes: ${gaps.join(', ')}` : `${splashRuns} run(s), no gap over ${SPLASH_GAP_MAX_IN} in`,
    `no gap wider than ${SPLASH_GAP_MAX_IN} in`);

  // 7.3 "the items on the island are js boxes" — nothing may fall through to
  //     the fallback block, on this fixture or for any kind at all
  const boxed: string[] = [];
  for (const it of L.decor.items) {
    const fb = fallbackBox(it.w, it.h, it.d);
    for (const p of parts.filter((q) => q.key.startsWith(`${it.id}-`))) {
      if (sameGeometry(p.geometry, fb)) boxed.push(`${it.kind} "${it.label}"`);
      else if (it.kind === 'other' && cuboidFraction(p.geometry) > 0.9) boxed.push(`${it.kind} "${it.label}" (a plain cuboid, ${pct(cuboidFraction(p.geometry))} of its vertices on a face plane)`);
    }
  }
  if (!L.decor.items.length) s.na(7, 'no item is a plain box', 'this fixture places no items');
  else s.assert(7, 'no item is a plain box', boxed.length === 0,
    boxed.length ? `${boxed.length} of ${L.decor.items.length}: ${boxed.slice(0, 4).join(', ')}` : `${L.decor.items.length} items, none on the fallback box`,
    'no drawn item uses the fallback box');

  // 7.4 sizes a photo can support: a bread loaf is not 18 in
  const big = L.decor.items
    .map((it) => ({ it, maxIn: ITEM_MAX_IN[it.kind] ?? ITEM_SIZE[it.kind][2], gotIn: IN(Math.max(it.w, it.h, it.d)) }))
    .filter((x) => x.gotIn > x.maxIn + 0.25);
  if (!L.decor.items.length) s.na(7, 'item sizes are plausible', 'this fixture places no items');
  else s.assert(7, 'item sizes are plausible', big.length === 0,
    big.length ? big.map((x) => `${x.it.kind} "${x.it.label}" ${r1(x.gotIn)} in > ${x.maxIn}`).join(', ') : `${L.decor.items.length} items, largest ${r1(Math.max(...L.decor.items.map((i) => IN(Math.max(i.w, i.h, i.d)))))} in`,
    'every item inside its kind\'s plausible size');

  // 7.5 a glass pendant is a clear globe, not an opaque cone
  const pend = L.lighting.pendants;
  if (!pend || !pend.count) s.na(7, 'glass pendant is a clear globe', 'no pendants');
  else if (pend.style !== 'glass') s.na(7, 'glass pendant is a clear globe', `pendant style is '${pend.style}'`);
  else {
    const def = materialFor(spec, 'lighting_fixture');
    const clear = (def?.pbr.transmission ?? 0) >= 0.5;
    const shape = glassShadeShape();
    s.assert(7, 'glass pendant is a clear globe', clear && shape.isGlobe,
      `material ${def?.id ?? '(none)'} transmission ${def?.pbr.transmission ?? 0}; Lighting.tsx draws ${shape.what}`,
      'a transmissive material on a sphere');
  }
  void f;
}

/**
 * What `PendantLight`'s `'glass'` case builds. The shade factory is a `useMemo`
 * inside a client component — importing Lighting.tsx headlessly would drag in
 * R3F and the reconciler — so this reads the one line instead. Narrow on
 * purpose: it asks only whether the branch is a lathe profile (a bell / cone)
 * or a sphere, which is exactly what the client's sentence is about.
 */
function glassShadeShape(): { isGlobe: boolean; what: string } {
  const src = readFileSync(new URL('../src/components/scene/Lighting.tsx', import.meta.url), 'utf8');
  const m = /case 'glass':([\s\S]{0,400}?)(?=\n\s{4,}(?:case|default)\b)/.exec(src);
  if (!m) return { isGlobe: false, what: "no 'glass' case found in the shade factory" };
  const body = m[1];
  if (/SphereGeometry/.test(body)) return { isGlobe: true, what: 'a SphereGeometry globe' };
  if (/lathe\(/.test(body)) return { isGlobe: false, what: 'a lathe profile (bell / cone), not a globe' };
  return { isGlobe: false, what: body.trim().slice(0, 60) };
}

// ---------------------------------------------------------------------------
// A cross-fixture probe: no DecorItemKind may fall through to the fallback
// ---------------------------------------------------------------------------

/**
 * §7 asks that EVERY kind have real geometry, not just the kinds a fixture
 * happens to place. This stands one item of every kind on the demo kitchen's
 * counters and asks the same identity question of each.
 */
function everyKindProbe(): { placed: number; boxed: string[] } {
  const boxed: string[] = [];
  let placed = 0;
  const batches: DecorItemKind[][] = [];
  for (let i = 0; i < ITEM_KINDS.length; i += 6) batches.push(ITEM_KINDS.slice(i, i + 6) as DecorItemKind[]);
  for (const batch of batches) {
    const spec = defaultKitchen();
    ensureSpecMaterials(spec);
    spec.decor.items = batch.map((kind, i): DecorItem => ({
      kind, label: `${kind} probe`, on: 'counter', wall: 'back', t: (i + 0.5) / batch.length, depthT: null,
      shelfIndex: null, burner: null, sizeIn: ITEM_SIZE[kind][0], colorHex: '#C9C4BC', material: 'ceramic', count: 1,
    }));
    const L = computeKitchenLayout(spec);
    const parts = buildKitchenPartsRaw(L);
    for (const it of L.decor.items) {
      placed++;
      const fb = fallbackBox(it.w, it.h, it.d);
      for (const p of parts.filter((q) => q.key.startsWith(`${it.id}-`))) {
        if (sameGeometry(p.geometry, fb)) { boxed.push(it.kind); break; }
        if (it.kind === 'other' && cuboidFraction(p.geometry) > 0.9) { boxed.push(`${it.kind} (plain cuboid)`); break; }
      }
    }
  }
  return { placed, boxed: [...new Set(boxed)] };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const GROUP_NAMES = [
  '', '1 SAME LENGTHS', '2 CABINET COLOUR AND STYLE', '3 FLOOR', '4 COUNTERTOP',
  '5 OVERHEAD CABINETS', '6 DISHWASHER', '7 COLOURS AND DESIGNS',
];

const out: string[] = [];
const say = (line = '') => { out.push(line); console.log(line); };

const fixtures: Fixture[] = [
  loadFixture('client-tan'),
  loadFixture('client-marble'),
  loadFixture('client-marble-items'),
  loadFixture('client-shelves'),
  demoFixture(),
];

const sheets: Sheet[] = [];
for (const f of fixtures) {
  const s = new Sheet(f.key);
  sheets.push(s);
  const fit = runFit(f);
  const spec = fit.spec;
  const L = computeKitchenLayout(spec);
  const parts = buildKitchenPartsRaw(L);
  group1(s, f, fit, L);
  group2(s, spec, L, parts);
  group3(s, f, spec);
  group4(s, f, spec, L);
  group5(s, f, spec, L);
  group6(s, f, spec, L, parts);
  group7(s, f, spec, L, parts);
}

const MARK: Record<Status, string> = { PASS: '✓', FAIL: '✗', PENDING: '~', 'N/A': '·' };

say('\nMANHATTAN — photo fidelity (ACCEPTANCE.md, seven promises, five kitchens)');
say('  ✓ pass   ✗ fail   ~ pending (not implementable yet)   · not applicable\n');

for (const s of sheets) {
  say(`── ${s.fixture} ${'─'.repeat(Math.max(2, 74 - s.fixture.length))}`);
  let g = 0;
  for (const row of s.rows) {
    if (row.group !== g) { g = row.group; say(`  ${GROUP_NAMES[g]}`); }
    say(`    ${MARK[row.status]} ${row.name.padEnd(34)} ${row.measured}`);
    if (row.status === 'FAIL' || row.status === 'PENDING') say(`      ${' '.repeat(34)} target: ${row.target}`);
  }
  say('');
}

// every kind, not just the ones a fixture places
{
  const probe = everyKindProbe();
  say(`── every DecorItemKind ${'─'.repeat(56)}`);
  say(`    ${probe.boxed.length ? '✗' : '✓'} no kind falls through to the fallback   ${probe.placed}/${ITEM_KINDS.length} kinds placed${probe.boxed.length ? `, on the fallback box: ${probe.boxed.join(', ')}` : ''}`);
  if (probe.boxed.length) say(`      ${' '.repeat(34)} target: every kind draws its own geometry`);
  say('');
  sheets[0].add(7, 'every kind has real geometry (all fixtures)', probe.boxed.length ? 'FAIL' : 'PASS',
    `${probe.placed}/${ITEM_KINDS.length} kinds placed, ${probe.boxed.length} on the fallback box${probe.boxed.length ? `: ${probe.boxed.join(', ')}` : ''}`,
    'every kind draws its own geometry');
}

// summary matrix: one line per promise, one column per fixture
say(`── summary ${'─'.repeat(68)}`);
const header = ['promise'.padEnd(46), ...sheets.map((s) => s.fixture.replace('client-', '').slice(0, 14).padStart(15))].join('');
say(`    ${header}`);
const names = [...new Set(sheets.flatMap((s) => s.rows.map((r) => `${r.group}|${r.name}`)))]
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
for (const key of names) {
  const [g, name] = key.split('|');
  const cells = sheets.map((s) => {
    const row = s.rows.find((r) => `${r.group}|${r.name}` === key);
    return (row ? MARK[row.status] : '—').padStart(15);
  });
  say(`    ${`${g}. ${name}`.padEnd(46)}${cells.join('')}`);
}

const all = sheets.flatMap((s) => s.rows.map((r) => ({ fixture: s.fixture, ...r })));
const failed = all.filter((r) => r.status === 'FAIL');
const pending = all.filter((r) => r.status === 'PENDING');
say('');
say(`    ${all.filter((r) => r.status === 'PASS').length} pass, ${failed.length} FAIL, ${pending.length} pending, ${all.filter((r) => r.status === 'N/A').length} n/a`);

if (failed.length) {
  say('\n── what has to move ' + '─'.repeat(58));
  for (const r of failed) say(`    ✗ ${r.fixture} · ${r.group}. ${r.name}\n        measured: ${r.measured}\n        target:   ${r.target}`);
}
if (pending.length) {
  say('\n── pending (a stream has to land the field or the code first) ' + '─'.repeat(17));
  for (const r of pending) say(`    ~ ${r.fixture} · ${r.group}. ${r.name}\n        ${r.measured}\n        target:   ${r.target}`);
}

const outFlag = process.argv.indexOf('--out');
if (outFlag >= 0 && process.argv[outFlag + 1]) {
  writeFileSync(process.argv[outFlag + 1], `${out.join('\n')}\n`, 'utf8');
  console.log(`\n  wrote ${process.argv[outFlag + 1]}`);
}

console.log(failed.length
  ? `\n  ${failed.length} FIDELITY CHECK(S) FAILED — expected until the build streams land; this suite is NOT part of the 14-green gate\n`
  : '\n  ALL FIDELITY CHECKS PASSED\n');
process.exit(failed.length ? 1 : 0);
