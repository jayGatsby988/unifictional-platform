/**
 * Photo inventory: vision calls that draw a tight normalised box around
 * every visible element of the primary photo and name the wall it sits on.
 *
 * This is the measurable half of "the twin matches the photo": the fitter
 * projects the twin's elements through a camera and moves camera + spec until
 * they land on these boxes. It runs beside the main analysis (see analyze.ts)
 * and never fails it — an inventory that errors or times out is an empty list.
 *
 * Precision comes from SAMPLING: three calls run concurrently with the same
 * prompt and a different nonce, their elements are clustered by kind and
 * position, and each cluster's box is the per-edge MEDIAN of its members. A
 * median, not a mean: one pass that draws a hood's top edge up into the
 * ceiling moves a mean by half its mistake and a median by nothing. A box
 * every pass draws in the same place is trustworthy; one they draw in three
 * places is not, and that shows in the element's `confidence` (the members'
 * mean confidence, times how well they agree, times √(passes that saw it ÷
 * passes run)). An element only one call saw survives when that call was
 * sure of it. Consistency rules (uppers above the base run, the hood above
 * the range, …) then lower — never delete — what still looks wrong.
 *
 * A separate ITEMS-ONLY pass (`only: 'items'`) boxes the pots, the kettles
 * and the canisters the full inventory spends its budget past; `analyze.ts`
 * runs it beside the main one and merges the two with `mergeItemPass`.
 *
 * The whole thing costs no wall time: every call finishes inside the main
 * analysis.
 */
import { z } from 'zod';
import { PhotoElementZ } from '@/lib/spec/schema';
import { NO_OPEN_EDGES, anyOpenEdge } from '@/lib/spec/photo-box';
import type { BoxOpenCause, BoxOpenEdges, ImageBox, PhotoElement, PhotoElementKind, RoomType } from '@/lib/spec/types';
import { clamp } from '@/lib/units';
import { errorMessage, serverLog, serverWarn, startTimer } from './log';
import { buildInventoryPrompt } from './prompt';
import { ProviderError, openaiClient, openaiVisionModel } from './providers';
import { MAX_ELEMENTS, reconcileElements, reconcileFrame, type PhotoFrame } from './reconcile';
import { parseModelJson } from './sanitize';

// the annotator is asked for up to this many boxes and reconcile / fit.ts /
// DetectionMetaZ all cap at the same number — they move together or the boxes
// past the lowest cap are dropped before anything scores them
export const MAX_INVENTORY_ELEMENTS = MAX_ELEMENTS;
/** the whole call, network included — the main analysis must never wait on this */
export const INVENTORY_TIMEOUT_MS = 60_000;
/** concurrent annotation passes whose boxes are merged by per-edge median */
export const INVENTORY_SAMPLES = 3;
/** an element only one of the passes saw is kept when that pass was at least this sure */
export const SINGLE_SAMPLE_MIN_CONFIDENCE = 0.8;
/** …and marked down by this much for having been seen once */
export const SINGLE_SAMPLE_FACTOR = 0.85;
/** a consistency-rule violation multiplies the element's confidence by this */
export const VIOLATION_FACTOR = 0.7;

export interface InventoryInput {
  roomType: RoomType;
  /** public https URL or data: URL the vision model can open */
  imageUrl: string;
  /** photo width ÷ height when known server-side; null = the model estimates it */
  aspect?: number | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** annotation passes to run and merge (default INVENTORY_SAMPLES; 1 = a single call) */
  samples?: number;
  /** 'items' asks for the small objects on the surfaces and nothing else — a
   *  second, cheaper reading that finds the pot on the stove */
  only?: 'items';
}

export interface InventoryResult {
  elements: PhotoElement[];
  /** the aspect the boxes were drawn against (server-measured when available, else the model's estimate) */
  aspect: number | null;
  /** the inventory's read of the frame (which x span the back wall covers), null when it gave none */
  frame: PhotoFrame | null;
  model: string;
  elapsedMs: number;
  /** passes that succeeded (≥ 2 = boxes are merged; 1 = the rest failed or only one was asked for) */
  samples: number;
  /** mean pairwise IoU inside the clusters — how repeatable the model's boxes were; null with one pass */
  agreement: number | null;
  /** consistency-rule violations that lowered confidences ("hood-1: not above the range") */
  violations: string[];
}

/** What one pass returns: the boxes, the frame block and its own read of the aspect (a cross-check, not the truth). */
export const InventoryResponseZ = z.object({
  aspect: z.number(),
  frame: z.object({
    /** [x0, x1]: normalised x extent of the back wall's plane in the photo */
    backWallSpansX: z.array(z.number()),
    leftWallVisible: z.boolean(),
    rightWallVisible: z.boolean(),
  }),
  elements: z.array(PhotoElementZ).max(MAX_INVENTORY_ELEMENTS),
});

/**
 * OpenAI strict mode: every property required, additionalProperties:false,
 * no range keywords. `schema.ts` keeps its stripper private, so this is the
 * same walk again — and, like there, keys of a `properties` map are NAMES
 * and are never stripped (a property called "pattern" must survive).
 */
function stripForStrict(node: unknown, isPropertiesMap = false): unknown {
  if (Array.isArray(node)) return node.map((n) => stripForStrict(n));
  if (node && typeof node === 'object') {
    const o = { ...(node as Record<string, unknown>) };
    if (isPropertiesMap) {
      for (const k of Object.keys(o)) o[k] = stripForStrict(o[k]);
      return o;
    }
    for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', '$schema', 'default']) delete o[k];
    if (o.type === 'object' && o.properties && typeof o.properties === 'object') {
      o.additionalProperties = false;
      o.required = Object.keys(o.properties as Record<string, unknown>);
    }
    for (const k of Object.keys(o)) o[k] = k === 'properties' ? stripForStrict(o[k], true) : stripForStrict(o[k]);
    return o;
  }
  return node;
}

/** Strict JSON schema for the inventory call. */
export function inventoryJsonSchema(): Record<string, unknown> {
  const s = z.toJSONSchema(InventoryResponseZ, { target: 'draft-2020-12', unrepresentable: 'any' });
  return stripForStrict(s as Record<string, unknown>) as Record<string, unknown>;
}

export interface InventorySample {
  elements: PhotoElement[];
  aspect: number | null;
  frame: PhotoFrame | null;
}

/**
 * Model text → validated sample. Boxes are clamped/deduped/capped by
 * `reconcileElements`, so a slightly sloppy answer still yields a usable list;
 * a response with no `elements` array yields an empty one, no `frame` a null.
 */
export function inventoryFromModelJson(text: string): InventorySample {
  const raw = parseModelJson(text) as { aspect?: unknown; elements?: unknown; frame?: unknown } | null;
  const elements = reconcileElements(raw && typeof raw === 'object' ? raw.elements : undefined);
  const aspect = raw && typeof raw.aspect === 'number' && Number.isFinite(raw.aspect) && raw.aspect > 0.2 && raw.aspect < 5 ? raw.aspect : null;
  const frame = reconcileFrame(raw && typeof raw === 'object' ? raw.frame : undefined);
  return { elements, aspect, frame };
}

/** Elements in reading order (top-left first) so a printed list is easy to scan against the photo. */
function sortReading(elements: PhotoElement[]): PhotoElement[] {
  return [...elements].sort((a, b) => (a.box.y0 - b.box.y0) || (a.box.x0 - b.box.x0));
}

// ---------------------------------------------------------------------------
// Pairing + averaging across samples
// ---------------------------------------------------------------------------

const r3d = (n: number) => Math.round(n * 1000) / 1000;

export function iou(a: ImageBox, b: ImageBox): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return union > 1e-12 ? inter / union : 0;
}

const centre = (b: ImageBox): [number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const centreDist = (a: ImageBox, b: ImageBox) => Math.hypot(centre(a)[0] - centre(b)[0], centre(a)[1] - centre(b)[1]);

/** Kinds that are the same box to a photo — one pass may say cooktop where the other says range. */
const PAIR_FAMILY: Partial<Record<PhotoElementKind, PhotoElementKind>> = { cooktop: 'range' };
const family = (k: PhotoElementKind) => PAIR_FAMILY[k] ?? k;

const diag = (b: ImageBox) => Math.hypot(b.x1 - b.x0, b.y1 - b.y0);

/** How well two readings of one element agree, 0..1: half IoU, half centre distance as a fraction of the box's diagonal. */
export function pairAgreement(a: ImageBox, b: ImageBox, overlap = iou(a, b)): number {
  const size = Math.max(1e-6, (diag(a) + diag(b)) / 2);
  return clamp(0.5 * overlap + 0.5 * (1 - Math.min(1, centreDist(a, b) / size)), 0, 1);
}

/** two boxes are the same element when they overlap at least this much… */
const PAIR_MIN_IOU = 0.1;
/** …or (a pendant cord, a faucet) their centres are within this much of the frame */
const PAIR_MAX_CENTRE_DIST = 0.05;

export interface MergeStats {
  /** clusters at least two passes saw */
  paired: number;
  /** kept from one sample only (confident enough) */
  single: number;
  /** seen once and not confident enough */
  dropped: number;
  /** mean pairwise IoU inside the multi-pass clusters — null when nothing clustered */
  agreement: number | null;
  /**
   * The median over clusters of the mean absolute distance from a member's
   * edge to the merged box's, as a fraction of the frame — how precisely the
   * annotator draws, for the log. Under 0.02 is a steady hand.
   */
  spreadMedian: number | null;
}

/**
 * A cluster's truncation: each EDGE by majority of the members that saw it,
 * the cause from the surest member that named one.
 *
 * `open` is a measurement, not a label, so it follows the file's rule for
 * measurements — but a median of booleans is a majority, and a mean would let
 * one pass that missed the cut halve the fact. Two passes out of three saying
 * the island runs off the left is a left edge that is cut; a tie (two passes,
 * one each) resolves OPEN, because a box that stops at the picture's border is
 * cut whether or not the annotator noticed, and `resolveOpen` would union the
 * frame edge back in anyway.
 *
 * The cause is a label: the surest member wins, except that 'both' is the
 * union of two facts and survives any member that carries it. Null when
 * nothing came out open, so "nothing is cut" keeps its one spelling.
 */
export function mergeOpenEdges(members: readonly PhotoElement[]): { open: BoxOpenEdges; openCause: BoxOpenCause | null } {
  const vote = (pick: (o: BoxOpenEdges) => boolean): boolean => {
    let yes = 0;
    for (const m of members) if (pick(m.open ?? NO_OPEN_EDGES)) yes++;
    return yes * 2 >= members.length && yes > 0;
  };
  const open: BoxOpenEdges = {
    left: vote((o) => o.left),
    right: vote((o) => o.right),
    top: vote((o) => o.top),
    bottom: vote((o) => o.bottom),
  };
  if (!anyOpenEdge(open)) return { open, openCause: null };
  const sure = [...members].sort((a, b) => b.confidence - a.confidence);
  if (sure.some((m) => m.openCause === 'both')) return { open, openCause: 'both' };
  const said = sure.find((m) => m.openCause === 'frame' || m.openCause === 'occluded')?.openCause ?? null;
  return { open, openCause: said ?? 'frame' };
}

/** The middle value (mean of the two middles when there is an even number). */
function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (!n) return 0;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

/**
 * Merges N annotation passes of one photo into one list.
 *
 * Clusters are seeded from the pass that saw the most; every other pass's
 * elements are paired into them greedily by (1 − IoU) + centre distance
 * against the cluster's running MEDIAN box, within a kind family, admitted
 * at IoU ≥ PAIR_MIN_IOU or centres within PAIR_MAX_CENTRE_DIST. What pairs
 * with nothing opens a cluster of its own.
 *
 * A cluster's box is the per-edge median of its members (the mean when there
 * are two, which is what a median of two is); kind, wall, facing and label
 * come from the surest member, because those are labels, not measurements.
 * Confidence = the members' mean × (0.5 + 0.5 × agreement) × √(seen ÷
 * passes): a box every pass drew in the same place keeps its confidence, one
 * they drew in three places loses up to half, and one only some passes saw
 * loses in proportion. A cluster only ONE pass saw is a different question —
 * not "how precisely", but "did the others see it at all" — so it keeps the
 * old rule: kept when that pass was ≥ SINGLE_SAMPLE_MIN_CONFIDENCE sure,
 * marked down by SINGLE_SAMPLE_FACTOR. Corroborated clusters come first in
 * the output so a cap keeps them.
 */
export function mergeInventorySamples(samples: PhotoElement[][]): { elements: PhotoElement[]; stats: MergeStats } {
  const passes = samples.filter((p) => Array.isArray(p));
  const n = passes.length;
  if (!n) return { elements: [], stats: { paired: 0, single: 0, dropped: 0, agreement: null, spreadMedian: null } };
  type Cluster = { members: PhotoElement[]; box: ImageBox };
  const boxOf = (members: PhotoElement[]): ImageBox => ({
    x0: r3d(median(members.map((e) => e.box.x0))),
    y0: r3d(median(members.map((e) => e.box.y0))),
    x1: r3d(median(members.map((e) => e.box.x1))),
    y1: r3d(median(members.map((e) => e.box.y1))),
  });
  // the longest pass seeds the clusters: starting from a short one would open
  // a new cluster for every element the short pass missed
  const order = passes.map((p, i) => i).sort((a, b) => passes[b].length - passes[a].length || a - b);
  const clusters: Cluster[] = passes[order[0]].map((e) => ({ members: [e], box: { ...e.box } }));
  for (const pi of order.slice(1)) {
    type Cand = { i: number; c: number; cost: number };
    const cands: Cand[] = [];
    passes[pi].forEach((e, i) => clusters.forEach((cl, c) => {
      if (family(e.kind) !== family(cl.members[0].kind)) return;
      const o = iou(e.box, cl.box);
      const dist = centreDist(e.box, cl.box);
      if (o < PAIR_MIN_IOU && dist > PAIR_MAX_CENTRE_DIST) return;
      cands.push({ i, c, cost: (1 - o) + dist });
    }));
    cands.sort((p, q) => p.cost - q.cost || p.i - q.i || p.c - q.c);
    const usedE = new Set<number>(), usedC = new Set<number>();
    for (const cand of cands) {
      if (usedE.has(cand.i) || usedC.has(cand.c)) continue;
      usedE.add(cand.i); usedC.add(cand.c);
      const cl = clusters[cand.c];
      cl.members.push(passes[pi][cand.i]);
      cl.box = boxOf(cl.members);
    }
    passes[pi].forEach((e, i) => { if (!usedE.has(i)) clusters.push({ members: [e], box: { ...e.box } }); });
  }

  const paired: PhotoElement[] = [];
  const singles: PhotoElement[] = [];
  const agreements: number[] = [];
  const spreads: number[] = [];
  let dropped = 0;
  for (const cl of clusters) {
    const m = cl.members;
    const lead = m.reduce((best, e) => (e.confidence > best.confidence ? e : best), m[0]);
    if (m.length === 1) {
      if (lead.confidence >= SINGLE_SAMPLE_MIN_CONFIDENCE) singles.push({ ...lead, confidence: r3d(lead.confidence * SINGLE_SAMPLE_FACTOR) });
      else dropped++;
      continue;
    }
    let agSum = 0, pairs = 0;
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) { agSum += pairAgreement(m[i].box, m[j].box); pairs++; }
    const agreement = pairs ? agSum / pairs : 1;
    agreements.push(agreement);
    const edges = m.flatMap((e) => [Math.abs(e.box.x0 - cl.box.x0), Math.abs(e.box.y0 - cl.box.y0), Math.abs(e.box.x1 - cl.box.x1), Math.abs(e.box.y1 - cl.box.y1)]);
    spreads.push(edges.reduce((a, v) => a + v, 0) / edges.length);
    const meanConf = m.reduce((a, e) => a + e.confidence, 0) / m.length;
    const cut = mergeOpenEdges(m);
    paired.push({
      id: m[0].id,
      kind: lead.kind,
      // wall / facing / label are labels, not measurements: the surest pass wins
      wall: lead.wall,
      facing: lead.facing,
      box: cl.box,
      label: lead.label || m.map((e) => e.label).find(Boolean) || '',
      confidence: r3d(clamp(meanConf * (0.5 + 0.5 * agreement) * Math.sqrt(m.length / n), 0, 1)),
      // …but WHICH EDGES ARE CUT is a measurement, merged per edge by majority
      // (`mergeOpenEdges`). Dropping it here is how the island came back a
      // stub: the fitter reads a cropped box as a size.
      open: cut.open,
      openCause: cut.openCause,
    });
  }
  // reconcile again: ids from the passes may collide, and the cap should favour the corroborated clusters
  const elements = reconcileElements([...paired, ...singles]);
  return {
    elements,
    stats: {
      paired: paired.length,
      single: singles.length,
      dropped,
      agreement: agreements.length ? r3d(agreements.reduce((a, v) => a + v, 0) / agreements.length) : null,
      spreadMedian: spreads.length ? r3d(median(spreads)) : null,
    },
  };
}

/**
 * The items-only pass merged into the main one. That pass is the authority
 * on items: where it corroborates a main-pass item (or the 'other' box the
 * main pass drew instead of one), the main box goes and the items pass's
 * stays. Main elements come FIRST, so a cap drops items, never a base run.
 */
export function mergeItemPass(main: PhotoElement[], items: PhotoElement[]): PhotoElement[] {
  const keep = main.filter((e) => !((e.kind === 'item' || e.kind === 'other') && items.some((it) => iou(e.box, it.box) >= 0.5)));
  const renamed = items.map((it, i) => ({ ...it, id: it.id.startsWith('item-') ? it.id : `item-${i + 1}-${it.id}` }));
  return [...keep, ...renamed].slice(0, MAX_ELEMENTS);
}

// ---------------------------------------------------------------------------
// Consistency rules
// ---------------------------------------------------------------------------

/** slack, as a fraction of the frame, before two edges are called inconsistent */
const RULE_TOL = 0.03;

/**
 * Physical relations every real photo obeys, in image space (y grows
 * DOWNWARD): the base run stands on the floor; the uppers hang above the
 * base run of their wall; the hood is above the range; pendants hang and
 * island plants stand above the island's top; a window is inside its wall;
 * an element's `facing` agrees with its wall label (a front turned toward
 * the left of the frame belongs to the right wall, a face-on front to the
 * wall the camera faces — the cue that puts a corner fridge on its side wall).
 * A violation lowers that element's confidence (VIOLATION_FACTOR) so the
 * fitter leans on it less — it is never deleted, because the rule may be
 * the one that is wrong (a hood the photo cuts off, a floor box that stops
 * at a rug). Boxes are never moved.
 *
 * A rule is SKIPPED where either box is CUT on an edge the rule compares
 * (`PhotoElement.open`). Every rule here says "this edge sits above / inside
 * that one", and a cut edge is not the element's edge — it is where the
 * picture or a nearer object stopped. A half-visible run is not a wrong run,
 * and marking it down would make the fitter lean less on exactly the boxes the
 * truncation work exists to take seriously.
 */
export function applyConsistencyRules(elements: PhotoElement[]): { elements: PhotoElement[]; violations: string[] } {
  const violations: string[] = [];
  const penalty = new Map<string, number>();
  const flag = (e: PhotoElement, why: string) => {
    penalty.set(e.id, (penalty.get(e.id) ?? 0) + 1);
    violations.push(`${e.id}: ${why}`);
  };
  const of = (kind: PhotoElementKind) => elements.filter((e) => e.kind === kind);
  const onWall = (list: PhotoElement[], wall: PhotoElement['wall']) => (wall ? list.filter((e) => e.wall === wall || e.wall === null) : list);
  const xOverlap = (a: ImageBox, b: ImageBox) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const nearestX = (list: PhotoElement[], b: ImageBox) => list.reduce<PhotoElement | null>((best, e) => (!best || Math.abs(centre(e.box)[0] - centre(b)[0]) < Math.abs(centre(best.box)[0] - centre(b)[0]) ? e : best), null);

  const floor = of('floor')[0];
  const bases = of('base-cabinet-run');
  const ranges = [...of('range'), ...of('cooktop')];
  const island = of('island')[0];
  const walls = of('wall');
  /** Is this element's `edge` a cut? Then no rule may read it as the element's own boundary. */
  const isCut = (e: PhotoElement, edge: keyof BoxOpenEdges) => (e.open ?? NO_OPEN_EDGES)[edge];
  const cutX = (e: PhotoElement) => isCut(e, 'left') || isCut(e, 'right');

  if (floor) for (const base of bases) if (!isCut(base, 'bottom') && !isCut(floor, 'top') && base.box.y1 < floor.box.y0 - RULE_TOL) flag(base, 'floats above the floor');

  for (const upper of of('upper-cabinet-run')) {
    const base = nearestX(onWall(bases, upper.wall), upper.box);
    if (base && !isCut(upper, 'bottom') && !isCut(base, 'top') && upper.box.y1 > base.box.y0 + RULE_TOL) flag(upper, `not above the base run (${base.id})`);
  }

  for (const hood of of('hood')) {
    const range = nearestX(onWall(ranges, hood.wall), hood.box) ?? nearestX(ranges, hood.box);
    if (!range) continue;
    if (!isCut(hood, 'bottom') && !isCut(range, 'top') && hood.box.y1 > range.box.y0 + RULE_TOL) flag(hood, `not above the range (${range.id})`);
    else if (!cutX(hood) && !cutX(range) && xOverlap(hood.box, range.box) <= 0) flag(hood, `not over the range (${range.id})`);
  }

  if (island) {
    const islandCutY = isCut(island, 'top') || isCut(island, 'bottom');
    // a pendant hangs from the ceiling: it starts above the island's top edge and never reaches below its bottom
    for (const p of of('pendant')) if (!islandCutY && !isCut(p, 'top') && !isCut(p, 'bottom') && (p.box.y0 > island.box.y0 || p.box.y1 > island.box.y1)) flag(p, `hangs below the island (${island.id})`);
    // a plant on the island stands on its top: it rises above the top edge and its pot is within the island's height
    for (const p of of('plant')) if (p.wall === 'island' && !islandCutY && !isCut(p, 'top') && !isCut(p, 'bottom') && (p.box.y0 > island.box.y0 || p.box.y1 > island.box.y1 + RULE_TOL)) flag(p, `not standing on the island (${island.id})`);
    // an item labelled 'island' stands ON the top: its base is inside the island's box, never floating above it or below the floor line
    for (const p of of('item')) {
      if (p.wall !== 'island' || islandCutY || isCut(p, 'bottom')) continue;
      if (p.box.y1 < island.box.y0 - RULE_TOL || p.box.y1 > island.box.y1 + RULE_TOL) flag(p, `not standing on the island (${island.id})`);
    }
  }

  for (const win of of('window')) {
    const wall = win.wall && win.wall !== 'island' ? walls.find((w) => w.wall === win.wall) : null;
    if (!wall) continue;
    // each side only where NEITHER box is cut there — a wall the frame cropped
    // is smaller than the wall, and a window can sit outside the visible part
    const o = win.open ?? NO_OPEN_EDGES, w = wall.open ?? NO_OPEN_EDGES;
    const inside = (o.left || w.left || win.box.x0 >= wall.box.x0 - RULE_TOL)
      && (o.right || w.right || win.box.x1 <= wall.box.x1 + RULE_TOL)
      && (o.top || w.top || win.box.y0 >= wall.box.y0 - RULE_TOL)
      && (o.bottom || w.bottom || win.box.y1 <= wall.box.y1 + RULE_TOL);
    if (!inside) flag(win, `outside its wall's box (${wall.id})`);
  }

  // facing 'front' ⇒ the back wall, 'left' ⇒ the right wall, 'right' ⇒ the left wall (the inventory prompt's own rule)
  for (const e of elements) {
    if (!e.facing || e.facing === 'edge' || !e.wall || e.wall === 'island') continue;
    const wants: PhotoElement['wall'] = e.facing === 'front' ? 'back' : e.facing === 'left' ? 'right' : 'left';
    if (e.wall !== wants) flag(e, `faces ${e.facing} but is labelled on the ${e.wall} wall`);
  }

  if (!penalty.size) return { elements, violations };
  return {
    elements: elements.map((e) => {
      const n = penalty.get(e.id);
      return n ? { ...e, confidence: r3d(clamp(e.confidence * VIOLATION_FACTOR ** n, 0.05, 1)) } : e;
    }),
    violations,
  };
}

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

/** Averages two frame reads; a side wall is visible when either pass saw it. */
function mergeFrames(a: PhotoFrame | null, b: PhotoFrame | null): PhotoFrame | null {
  if (!a || !b) return a ?? b;
  return {
    backWallSpansX: [r3d((a.backWallSpansX[0] + b.backWallSpansX[0]) / 2), r3d((a.backWallSpansX[1] + b.backWallSpansX[1]) / 2)],
    leftWallVisible: a.leftWallVisible || b.leftWallVisible,
    rightWallVisible: a.rightWallVisible || b.rightWallVisible,
  };
}

/** One annotation pass. Throws a ProviderError on any failure. */
async function samplePhoto(input: InventoryInput, aspect: number | null, nonce: string): Promise<InventorySample> {
  const client = openaiClient();
  const model = openaiVisionModel();
  const response = await client.responses.create(
    {
      model,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: buildInventoryPrompt(input.roomType, aspect, { nonce, ...(input.only ? { only: input.only } : {}) }) },
          { type: 'input_image', image_url: input.imageUrl, detail: 'high' },
        ],
      }],
      text: { format: { type: 'json_schema', name: 'photo_inventory', strict: true, schema: inventoryJsonSchema() } },
      reasoning: { effort: 'low' },
      max_output_tokens: 12_000,
      store: false,
    },
    { signal: input.signal, timeout: input.timeoutMs ?? INVENTORY_TIMEOUT_MS, maxRetries: 0 },
  );
  if (response.status === 'incomplete') {
    throw new ProviderError('openai', `Inventory response incomplete (${response.incomplete_details?.reason ?? 'unknown reason'})`, { code: 'incomplete', retryable: true });
  }
  const text = response.output_text;
  if (!text || !text.trim()) throw new ProviderError('openai', 'Inventory model returned an empty response', { code: 'empty_response', retryable: true });
  try {
    return inventoryFromModelJson(text);
  } catch (err) {
    throw new ProviderError('openai', `Inventory JSON unparsable: ${errorMessage(err)}`, { code: 'bad_json', retryable: true });
  }
}

/**
 * Inventories one photo: `samples` concurrent passes, paired and averaged,
 * then the consistency rules. Throws (the first pass's error) only when
 * EVERY pass failed, so the caller can decide what an empty inventory means;
 * `analyze.ts` catches and logs it. One failed pass out of two just means
 * un-averaged boxes.
 */
export async function inventoryPhoto(input: InventoryInput): Promise<InventoryResult> {
  const elapsed = startTimer();
  const model = openaiVisionModel();
  const aspect = input.aspect && Number.isFinite(input.aspect) && input.aspect > 0 ? input.aspect : null;
  const n = Math.max(1, Math.min(4, Math.round(input.samples ?? INVENTORY_SAMPLES)));
  // the nonce is the only difference between the passes' prompts — enough to
  // keep the model from returning the same cached answer twice
  const nonces = Array.from({ length: n }, (_, i) => `${i + 1}of${n}-${Math.random().toString(36).slice(2, 8)}`);
  const settled = await Promise.allSettled(nonces.map((nonce) => samplePhoto(input, aspect, nonce)));
  const good = settled.filter((s): s is PromiseFulfilledResult<InventorySample> => s.status === 'fulfilled').map((s) => s.value);
  const failed = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (!good.length) throw failed[0].reason;
  if (failed.length && !input.signal?.aborted) serverWarn('inventory', `${failed.length} of ${n} passes failed; using the rest un-averaged`, { error: errorMessage(failed[0].reason) });

  let elements: PhotoElement[];
  let stats: MergeStats | null = null;
  if (good.length >= 2) {
    // every good pass, not the first two: a discarded third pass is a third
    // of the money spent on nothing
    const merged = mergeInventorySamples(good.map((g) => g.elements));
    elements = merged.elements;
    stats = merged.stats;
  } else {
    elements = good[0].elements;
  }
  const ruled = applyConsistencyRules(elements);
  elements = sortReading(ruled.elements);
  const frame = good.reduce<PhotoFrame | null>((acc, s) => mergeFrames(acc, s.frame), null);
  const modelAspect = good.find((s) => s.aspect)?.aspect ?? null;
  const elapsedMs = elapsed();
  if (aspect && modelAspect && Math.abs(modelAspect - aspect) / aspect > 0.25) {
    serverWarn('inventory', 'model read a different aspect than the file header', { fileAspect: aspect, modelAspect });
  }
  serverLog('inventory', 'complete', {
    roomType: input.roomType, model, elapsedMs, count: elements.length, aspect: aspect ?? modelAspect,
    samples: good.length, paired: stats?.paired ?? null, single: stats?.single ?? null, dropped: stats?.dropped ?? null, agreement: stats?.agreement ?? null, spreadMedian: stats?.spreadMedian ?? null,
    violations: ruled.violations.length, frame,
  });
  return { elements, aspect: aspect ?? modelAspect, frame, model, elapsedMs, samples: good.length, agreement: stats?.agreement ?? null, violations: ruled.violations };
}
