/**
 * The photo inventory's small objects, turned into things the twin DRAWS.
 *
 * The client's words: *"every small detail like a small thing in a cabinet to
 * be shown, a pot on the stove to be shown, an amazing eye for detail."* Two
 * separate model calls already look for those objects — the main analysis
 * writes `decor.items` (what to draw) and the items-only inventory pass boxes
 * every one it can see (`detected.elements` of kind 'item', what to score
 * against). On the client's marble kitchen the inventory boxed NINETEEN and
 * the analysis wrote EIGHT, so the twin drew eight objects, the fitter
 * reported eleven unmatched photo elements, and coverage fell to 68%.
 *
 * This pass closes that gap: every boxed item the analysis did not already
 * describe becomes a real `DecorItem`, hosted, positioned and sized from the
 * BOXES — no camera needed, because every measurement here is a ratio between
 * two boxes in the same photo.
 *
 * Rules that matter:
 * - The analysis's own entries always win. It saw the object in colour and in
 *   context; a box and a five-word label is the weaker reading. Nothing here
 *   ever edits, reorders or removes one — it only fills what is missing.
 * - NINETEEN boxes are not nineteen objects. Both vision passes box the same
 *   counter and their boxes reach `detected.elements` side by side (the merge
 *   only drops a main-pass box at IoU ≥ 0.5, and the items pass doubles some
 *   objects on its own), so one pot is read as "copper metal vase" and "copper
 *   pitcher" a few pixels apart. Boxes are therefore clustered against each
 *   other as well as against the analysis, or the twin grows a shop-display
 *   row of seven vases where the photo has three.
 * - Everything is pure and deterministic. No clock, no randomness, ties broken
 *   by array order, so re-running the reconciler on its own output is a fixed
 *   point (the store, the share page and the refine route all rely on that).
 *   That fixed point is what the geometric arm of `sameThing` protects: an
 *   object this pass drew last run must be recognised in its own box again,
 *   even when the box carries no readable label at all.
 * - The vocabulary — label → kind / material / colour / count — lives in
 *   `decor-items.ts` beside the rest of the item vocabulary.
 *
 * The synthesised entries are deliberately NOT repaired here: the caller runs
 * them through `fixItems`, which re-hosts anything this room cannot carry,
 * clamps every size and assigns burners. This module's job is to read the
 * photo, not to know the room.
 */
import type {
  DecorItem, DecorItemKind, DecorItemOn, ImageBox, KitchenSpec, PhotoElement, RoomSpec, Wall,
} from './types';
import {
  DEFAULT_COLOR, DEFAULT_MATERIAL, ITEM_STACKABLE, MAX_ITEMS,
  colorFromLabel, countFromLabel, descriptorWords, labelOverlap, labelWords, materialFromLabel,
  plausibleSizeIn, readKind,
} from './decor-items';
import { mix, shade } from '@/lib/materials/color';
import { clamp } from '@/lib/units';

/** the photo's width ÷ height when nothing said — the fitter's own default */
const FALLBACK_ASPECT = 4 / 3;
/** how alike two labels must read, after the host and kind adjustments, before one is called the other */
const DUPLICATE_MIN = 0.5;
/** the two entries agree about where the object stands */
const SAME_HOST_BONUS = 0.15;
/** …and about which wall */
const SAME_WALL_BONUS = 0.05;
/** they name different hosts: a bowl on the island is not the bowl on the counter */
const OTHER_HOST_PENALTY = 0.25;
const SAME_KIND_BONUS = 0.1;
const OTHER_KIND_PENALTY = 0.2;
/** an item's base counts as standing on a surface within this much of its edge, as a fraction of the frame height */
const LANDS_ON = 0.1;
/** how close along its host an existing entry has to be before geometry alone calls it the box's object (≈7in on a 12ft run) */
const SAME_SPOT_T = 0.05;
/** what such a geometric match scores — over the threshold, under a genuine agreement of words */
const SAME_SPOT_SCORE = 0.6;
/** two boxes share this much area, or better, only when they outline one object */
const DUP_IOU = 0.15;
/** …or their centres sit closer than this share of the smaller box, measured in frame WIDTHS */
const DUP_CENTRE = 0.5;
/** how far the analysis's own sizes are allowed to move the box ruler */
const CALIBRATION = [0.5, 1.5] as const;

const WALL_RING: readonly Wall[] = ['back', 'right', 'front', 'left'];
const isWall = (v: unknown): v is Wall => typeof v === 'string' && (WALL_RING as readonly string[]).includes(v);
const opposite = (w: Wall): Wall => WALL_RING[(WALL_RING.indexOf(w) + 2) % 4];

const okBox = (b: unknown): b is ImageBox => {
  if (!b || typeof b !== 'object') return false;
  const { x0, y0, x1, y1 } = b as ImageBox;
  return [x0, y0, x1, y1].every((n) => typeof n === 'number' && Number.isFinite(n)) && x1 > x0 && y1 > y0;
};
const cxOf = (b: ImageBox) => (b.x0 + b.x1) / 2;
const cyOf = (b: ImageBox) => (b.y0 + b.y1) / 2;
const areaOf = (b: ImageBox) => (b.x1 - b.x0) * (b.y1 - b.y0);
const overlapArea = (a: ImageBox, b: ImageBox) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
/** the item's centre-x lies within the host's span, with a little slack for a box drawn tight */
const spans = (host: ImageBox, x: number, slack = 0.01) => x >= host.x0 - slack && x <= host.x1 + slack;

// ---------------------------------------------------------------------------
// What each boxed item stands on
// ---------------------------------------------------------------------------

interface Placement {
  on: DecorItemOn;
  wall: DecorItem['wall'];
  shelfIndex: number | null;
  /** the element whose span `t` is measured in — the island for an island item, else null (the wall's own span) */
  islandSpan: ImageBox | null;
  /** the range box an on:'range' item stands on, for reading its burner */
  rangeBox: ImageBox | null;
}

/**
 * Where a boxed item stands, decided from 2D geometry against the OTHER boxes
 * in the same inventory. Image y grows DOWNWARD, so a surface's top edge is
 * its box's `y0` and something standing on it has its own `y1` there.
 *
 * Order is deliberate: the range and a shelf are small, specific hosts and are
 * tested first; the island next (its label is a direct signal — the annotator
 * writes wall:'island' for anything on the island top); the counter last,
 * because it is also the fallback. A host this room turns out not to have is
 * re-hosted downstream by `fixItems`, never dropped.
 */
function placeItem(e: PhotoElement, box: ImageBox, hosts: Hosts, boardCount: (wall: Wall | null) => number): Placement {
  const cx = cxOf(box);
  const said = isWall(e.wall) ? e.wall : null;
  const base: Placement = { on: 'counter', wall: said, shelfIndex: null, islandSpan: null, rangeBox: null };

  // a pot on the stove: its base sits on the cooktop, which is the range box's top edge
  for (const r of hosts.ranges) {
    const h = r.box.y1 - r.box.y0;
    if (!spans(r.box, cx)) continue;
    if (box.y1 < r.box.y0 - 0.25 * h || box.y1 > r.box.y0 + 0.25 * h) continue;
    return { ...base, on: 'range', wall: (isWall(r.wall) ? r.wall : said), rangeBox: r.box };
  }

  // a shelf swallows the things on it: judge by how much of the item is inside the shelf's box
  for (const s of hosts.shelves) {
    if (overlapArea(box, s.box) < 0.5 * areaOf(box)) continue;
    const wall = isWall(s.wall) ? s.wall : said;
    const boards = boardCount(wall);
    // boards are evenly spaced, so where the item sits in the unit's height names its board (0 = lowest)
    const fromBottom = (s.box.y1 - box.y1) / Math.max(1e-6, s.box.y1 - s.box.y0);
    return { ...base, on: 'shelf', wall, shelfIndex: boards > 1 ? clamp(Math.round(fromBottom * (boards - 1)), 0, boards - 1) : null };
  }

  for (const wdw of hosts.windows) {
    const h = wdw.box.y1 - wdw.box.y0;
    if (!spans(wdw.box, cx)) continue;
    if (box.y1 < wdw.box.y1 - 0.3 * h || box.y1 > wdw.box.y1 + 0.06 * h) continue;
    return { ...base, on: 'sill', wall: isWall(wdw.wall) ? wdw.wall : said };
  }

  // The annotator's own 'island' label is the strongest signal there is. The
  // geometry test only runs when it labelled NO wall: an island seen from the
  // front covers the corner of the run behind it, so "inside the island's box"
  // catches things standing on the counter three feet further away — which is
  // exactly what put the client's six left-run vases on his island.
  const isl = hosts.island;
  if (isl) {
    const h = isl.box.y1 - isl.box.y0;
    const onTop = !said && spans(isl.box, cx) && box.y1 >= isl.box.y0 - 0.06 && box.y1 <= isl.box.y0 + 0.5 * h;
    if (e.wall === 'island' || onTop) return { ...base, on: 'island', wall: 'island', islandSpan: isl.box };
  }

  // a counter: the item's base is at the top edge of a base run. When two runs
  // could carry it (the corner, where their spans overlap) the nearer counter
  // line wins — but the WALL still comes from the annotator, which reads the
  // corner from the object's own perspective and is right more often.
  let best: { wall: Wall | null; dist: number } | null = null;
  for (const r of hosts.runs) {
    if (!spans(r.box, cx, 0.02)) continue;
    const dist = Math.abs(box.y1 - r.box.y0);
    if (dist > LANDS_ON) continue;
    if (!best || dist < best.dist) best = { wall: isWall(r.wall) ? r.wall : null, dist };
  }
  if (best) return { ...base, wall: said ?? best.wall };

  // nothing under it and it is big and low in the frame: a floor basket or crock
  if (box.y1 >= 0.85 && box.y1 - box.y0 >= 0.12) return { ...base, on: 'floor' };
  return base;
}

/** which burner an item's box stands over, read from where it sits inside the range's box */
function burnerAt(box: ImageBox, range: ImageBox): DecorItem['burner'] {
  const f = clamp((cxOf(box) - range.x0) / Math.max(1e-6, range.x1 - range.x0), 0, 1);
  const col = f < 1 / 3 ? 'left' : f > 2 / 3 ? 'right' : 'centre';
  // the front burners are nearer the camera, so they sit LOWER in the frame
  const row = box.y1 > range.y0 + 0.08 * (range.y1 - range.y0) ? 'front' : 'back';
  return `${col}-${row}` as DecorItem['burner'];
}

// ---------------------------------------------------------------------------
// Reading the photo's own scale
// ---------------------------------------------------------------------------

interface Hosts {
  island: PhotoElement | null;
  ranges: PhotoElement[];
  shelves: PhotoElement[];
  windows: PhotoElement[];
  runs: PhotoElement[];
  /** each wall's span across the frame: the union of every box the annotator put on it */
  wallSpan: Map<Wall, [number, number]>;
  /** inches per unit of normalised image x, and the photo's aspect */
  inchesPerX: number;
  aspect: number;
}

/** kinds that describe the room rather than a place on a wall — they would stretch a wall's span across the whole frame */
const NOT_A_WALL_THING = new Set(['item', 'floor', 'ceiling', 'rug', 'pendant']);

/**
 * The photo's scale, from a pair whose real size the spec already knows.
 *
 * The wall the camera faces is the best ruler in the frame: it spans the whole
 * room dimension, and the annotator draws boxes all along it. A base run is
 * the fallback — good when it is fully visible, but an island standing in
 * front of one clips its box and the scale comes out ~20% hot, which is how a
 * 16" cutting board turned into a 24" one on the client's photo.
 *
 * This is only ever a first reading: the wall is a true ruler when the camera
 * looks square at it, and a corner shot foreshortens it. `calibrate()` below
 * corrects that from the analysis's own measurements.
 */
function readScale(k: KitchenSpec, elements: PhotoElement[], wallSpan: Map<Wall, [number, number]>, lookingAt: Wall): number {
  const wallFt = (w: Wall) => (w === 'back' || w === 'front' ? k.dims?.widthFt : k.dims?.depthFt) ?? 12;
  const faced = wallSpan.get(lookingAt);
  if (faced && faced[1] - faced[0] > 0.2) return (wallFt(lookingAt) * 12) / (faced[1] - faced[0]);

  const runs = k.runs ?? [];
  let best: { px: number; inches: number } | null = null;
  for (const e of elements) {
    if (e.kind !== 'base-cabinet-run' || !okBox(e.box)) continue;
    const run = runs.find((r) => r.wall === e.wall) ?? [...runs].sort((a, b) => b.lengthFt - a.lengthFt)[0];
    if (!run) continue;
    const px = e.box.x1 - e.box.x0;
    if (!best || px > best.px) best = { px, inches: run.lengthFt * 12 };
  }
  if (!best) {
    const isl = elements.find((e) => e.kind === 'island' && okBox(e.box));
    if (isl && k.island?.present) best = { px: isl.box.x1 - isl.box.x0, inches: k.island.lengthFt * 12 };
  }
  if (!best) best = { px: 1, inches: wallFt(lookingAt) * 12 };
  return best.inches / Math.max(0.02, best.px);
}

function readHosts(k: KitchenSpec, elements: PhotoElement[], lookingAt: Wall): Hosts {
  const boxed = elements.filter((e) => okBox(e.box));
  // A wall's span across the frame is the UNION of everything the annotator put
  // on it — its own box AND the cabinetry, splash and openings standing against
  // it. Neither reading alone is reliable: the wall box often stops where the
  // cabinets do, and the cabinets stop short of the corners. On the client's
  // photo the union is what put his corner vases at t 0.76–0.92 of the left
  // run, where the analysis independently put its own two.
  const wallSpan = new Map<Wall, [number, number]>();
  for (const e of boxed) {
    if (!isWall(e.wall) || NOT_A_WALL_THING.has(e.kind)) continue;
    const cur = wallSpan.get(e.wall);
    wallSpan.set(e.wall, cur ? [Math.min(cur[0], e.box.x0), Math.max(cur[1], e.box.x1)] : [e.box.x0, e.box.x1]);
  }
  const islands = boxed.filter((e) => e.kind === 'island');
  return {
    island: islands.sort((a, b) => areaOf(b.box) - areaOf(a.box))[0] ?? null,
    ranges: boxed.filter((e) => e.kind === 'range' || e.kind === 'cooktop'),
    shelves: boxed.filter((e) => e.kind === 'shelf'),
    windows: boxed.filter((e) => e.kind === 'window'),
    runs: boxed.filter((e) => e.kind === 'base-cabinet-run'),
    wallSpan,
    inchesPerX: readScale(k, boxed, wallSpan, lookingAt),
    aspect: k.detected?.camera?.solved?.aspect || FALLBACK_ASPECT,
  };
}

/**
 * The item's centre mapped to `t` along its host. Image x grows with `t` on
 * every wall — `wallFrame`'s left→right is the photo's left→right for the wall
 * the camera faces and for both side walls — and reverses only on the wall
 * BEHIND the camera, which a photo almost never shows.
 */
function tOf(box: ImageBox, place: Placement, hosts: Hosts, lookingAt: Wall): number {
  const span = place.islandSpan
    ? ([place.islandSpan.x0, place.islandSpan.x1] as [number, number])
    : (isWall(place.wall) ? hosts.wallSpan.get(place.wall) : null) ?? [0, 1];
  const t = clamp((cxOf(box) - span[0]) / Math.max(1e-6, span[1] - span[0]), 0, 1);
  return isWall(place.wall) && place.wall === opposite(lookingAt) ? 1 - t : t;
}

/** the object's longest dimension in inches, straight off its box and the photo's scale — before calibration and before the kind's own limits */
function rawSize(box: ImageBox, hosts: Hosts): number {
  const widthIn = (box.x1 - box.x0) * hosts.inchesPerX;
  // normalised y is stretched by the aspect: one unit of y is `aspect` times
  // as many pixels-worth of x as one unit of x is
  const heightIn = ((box.y1 - box.y0) * hosts.inchesPerX) / Math.max(0.2, hosts.aspect);
  return Math.max(widthIn, heightIn);
}

/**
 * …that reading, corrected and held to what the kind can be WHERE IT STANDS.
 *
 * `calibrate()` is bounded to ±50% and needs two matched pairs, so it corrects
 * a foreshortened ruler but cannot correct a reading that is a whole second
 * object; `plausibleSizeIn` is what stops a 16 in "serving bowl" on an island.
 */
function sizeOf(raw: number, kind: DecorItemKind, on: DecorItemOn, factor: number): number {
  const size = raw * factor;
  return plausibleSizeIn(kind, on, Number.isFinite(size) && size > 0 ? size : NaN);
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** a boxed item, read: where it stands, what it is, and how big its box says it is */
interface Read {
  e: PhotoElement;
  place: Placement;
  kind: DecorItemKind;
  /** the word index of the kind's own noun, so a colour after it is the contents */
  at: number;
  t: number;
  raw: number;
  area: number;
}

/**
 * How alike an existing entry and a boxed element read; ≥ DUPLICATE_MIN means
 * the entry already IS that object.
 *
 * Two arms, because two different things go wrong. The WORDS arm is the strong
 * one — "clear glass vase" is "clear glass vase with green branches". The
 * GEOMETRY arm catches what words cannot: two objects of one kind cannot stand
 * in the same seven inches of counter, so an entry already there is this box,
 * whatever the passes chose to call it ("vase" vs "copper pitcher"). Geometry
 * is also what makes this pass a fixed point — an entry it synthesised last
 * run sits at exactly the `t` its own box maps to, so it claims that box again
 * even when the box carries no readable label and the words arm scores zero.
 */
function sameThing(item: DecorItem, itemWords: string[], r: Read): number {
  const sameSpot = item.kind === r.kind
    && item.on === r.place.on
    && (!item.wall || !r.place.wall || item.wall === r.place.wall)
    && Math.abs(item.t - r.t) <= SAME_SPOT_T;
  let score = labelOverlap(itemWords, labelWords(r.e.label));
  if (score <= 0) return sameSpot ? SAME_SPOT_SCORE : 0;
  score += item.on === r.place.on ? SAME_HOST_BONUS : -OTHER_HOST_PENALTY;
  if (item.wall && r.place.wall && item.wall === r.place.wall) score += SAME_WALL_BONUS;
  score += item.kind === r.kind ? SAME_KIND_BONUS : -OTHER_KIND_PENALTY;
  return sameSpot ? Math.max(score, SAME_SPOT_SCORE) : score;
}

/**
 * Two boxes outlining ONE object.
 *
 * Both vision passes box the same counter and both readings survive into
 * `detected.elements` — the merge only drops a main-pass box at IoU ≥ 0.5, and
 * the items pass doubles some objects by itself. The two readings of one pot
 * sit a few pixels apart with different nouns, so the test is geometric first
 * (they overlap, or their centres are inside the smaller of them) and lexical
 * only as a veto: a bowl standing in front of a crock overlaps it without
 * being it, so the kinds have to agree, or the labels have to agree about what
 * the thing is made of and what colour it is.
 *
 * Centres are compared in frame WIDTHS — normalised y is stretched by the
 * aspect, and a tall narrow vase box would otherwise read as far taller than
 * it is wide and swallow its neighbours.
 */
function sameObject(a: Read, b: Read, aspect: number): boolean {
  const inter = overlapArea(a.e.box, b.e.box);
  const iou = inter / Math.max(1e-9, areaOf(a.e.box) + areaOf(b.e.box) - inter);
  let near = iou >= DUP_IOU;
  if (!near) {
    const diag = (bx: ImageBox) => Math.hypot(bx.x1 - bx.x0, (bx.y1 - bx.y0) / aspect);
    const d = Math.hypot(cxOf(a.e.box) - cxOf(b.e.box), (cyOf(a.e.box) - cyOf(b.e.box)) / aspect);
    near = d < DUP_CENTRE * Math.min(diag(a.e.box), diag(b.e.box));
  }
  if (!near) return false;
  if (a.kind === b.kind) return true;
  const words = new Set(descriptorWords(b.e.label));
  return descriptorWords(a.e.label).some((w) => words.has(w));
}

/**
 * The box ruler, corrected by the analysis's own measurements.
 *
 * `readScale` measures inches-per-x against the wall the camera faces, which
 * is a true ruler only when the camera looks square at it. The client's photo
 * is a corner shot (position 'corner-left', solved yaw 16°), so that wall is
 * foreshortened, everything nearer the lens reads long, and his 16" board came
 * out at 22" — big enough that the layout's own guard had to shorten it again
 * to clear the counter.
 *
 * No camera is needed to fix it. Where an analysis entry and a box are the
 * same object, the analysis has already said how big that object is, so the
 * ratio of the two readings IS the error in the ruler. The median over every
 * such pair is the correction; one pair could be a mistaken match, so two are
 * required, and the result is clamped so a bad pair cannot shrink a room's
 * objects to dolls' furniture.
 */
function calibrate(pairs: Array<{ said: number; raw: number }>): number {
  const ratios = pairs
    .filter((p) => Number.isFinite(p.said) && p.said > 0 && Number.isFinite(p.raw) && p.raw > 0)
    .map((p) => p.said / p.raw)
    .sort((a, b) => a - b);
  if (ratios.length < 2) return 1;
  const mid = ratios.length >> 1;
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return clamp(median, CALIBRATION[0], CALIBRATION[1]);
}

/**
 * Turn every boxed `item` element the analysis did not already describe into a
 * real `decor.items` entry. Kitchens only (the schema draws items nowhere
 * else). Returns the spec UNCHANGED — the same object — when there is nothing
 * to add, so a caller can run it unconditionally.
 */
export function itemsFromInventory<T extends RoomSpec>(spec: T): T {
  if (!spec || spec.roomType !== 'kitchen') return spec;
  const k = spec as unknown as KitchenSpec;
  const elements = Array.isArray(k.detected?.elements) ? k.detected.elements : [];
  const boxed = elements.filter((e) => e && e.kind === 'item' && okBox(e.box));

  // An entry naming a thing that is NOT an object standing on a surface is a
  // mis-read wherever it came from: the prompt forbids the wall pot filler, the
  // faucet, the sink soap dispenser, outlets, switches and cabinet hardware to
  // BOTH vision passes. The live run on the client's tan kitchen still produced
  // "brass pot filler", and 'pot' drew it as a stock pot standing on the
  // counter. This is the one pure pass every path runs through, so it is where
  // the entry goes — the analysis's readings are otherwise still untouchable.
  const allExisting = (Array.isArray(k.decor?.items) ? k.decor.items : []).filter((i): i is DecorItem => !!i && typeof i === 'object');
  const existing = allExisting.filter((i) => readKind(i.label).kind !== null);
  const rejected = allExisting.length - existing.length;
  if (!boxed.length) {
    return rejected
      ? { ...spec, decor: { ...k.decor, items: existing } } as T
      : spec;
  }
  const lookingAt = isWall(k.detected?.camera?.lookingAt) ? k.detected.camera.lookingAt : 'back';
  const hosts = readHosts(k, elements, lookingAt);
  const shelves = Array.isArray(k.decor?.shelves) ? k.decor.shelves : [];
  const boardCount = (wall: Wall | null) => {
    const s = shelves.find((sh) => sh?.wall === wall) ?? shelves[0];
    return Math.max(1, Math.round(s?.count ?? 1));
  };

  const read: Read[] = [];
  let notObjects = 0;
  for (const e of boxed) {
    const kindRead = readKind(e.label);
    if (kindRead.kind === null) { notObjects++; continue; }
    const place = placeItem(e, e.box, hosts, boardCount);
    read.push({
      e, place, kind: kindRead.kind, at: kindRead.at,
      t: tOf(e.box, place, hosts, lookingAt),
      raw: rawSize(e.box, hosts),
      area: areaOf(e.box),
    });
  }

  // --- 1. which boxes the analysis already described -----------------------
  // Greedy, highest score first, one box per entry — except an entry the
  // analysis wrote as a ROW ("three white ceramic canisters", count 3) already
  // draws three objects and may claim three boxes, or the inventory's three
  // boxes for that row would each become a fourth, fifth and sixth canister.
  // Ties break on array order, which is why this is reproducible.
  const words = existing.map((i) => labelWords(i.label));
  const pairs: Array<{ i: number; j: number; score: number }> = [];
  existing.forEach((item, i) => {
    read.forEach((r, j) => {
      const score = sameThing(item, words[i], r);
      if (score >= DUPLICATE_MIN) pairs.push({ i, j, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
  const claims = new Map<number, number>();
  const claimed = new Map<number, number>();
  for (const p of pairs) {
    const room = Math.max(1, Math.round(existing[p.i].count) || 1);
    if ((claims.get(p.i) ?? 0) >= room || claimed.has(p.j)) continue;
    claims.set(p.i, (claims.get(p.i) ?? 0) + 1);
    claimed.set(p.j, p.i);
  }

  // --- 2. the ruler, corrected against the pairs it just found -------------
  const factor = calibrate([...claimed].map(([j, i]) => ({ said: existing[i].sizeIn, raw: read[j].raw })));

  // --- 3. synthesise the rest, one entry per OBJECT ------------------------
  // Biggest box first, so when two readings of one object survive it is the
  // fuller outline that is drawn and the sliver that is dropped — and so the
  // cap keeps the objects a client would notice. A box already claimed by an
  // analysis entry counts as drawn: the duplicates around it must go too.
  const taken: Read[] = [...claimed.keys()].sort((a, b) => a - b).map((j) => read[j]);
  const fresh: DecorItem[] = [];
  let merged = 0;
  const candidates = read
    .map((r, j) => ({ r, j }))
    .filter(({ j }) => !claimed.has(j))
    .sort((a, b) => b.r.area - a.r.area || a.j - b.j);
  for (const { r } of candidates) {
    if (taken.some((t) => sameObject(r, t, hosts.aspect))) { merged++; continue; }
    taken.push(r);
    const { e, place, kind, at } = r;
    const material = materialFromLabel(e.label) ?? DEFAULT_MATERIAL[kind];
    const colour = colorFromLabel(e.label, at);
    let hex = colour.hex ?? DEFAULT_COLOR[material];
    if (colour.lighten) hex = mix(hex, '#ffffff', 0.22);
    if (colour.darken) hex = shade(hex, 0.75);
    fresh.push({
      kind,
      label: (typeof e.label === 'string' ? e.label.trim() : '').slice(0, 40) || kind.replace(/-/g, ' '),
      on: place.on,
      wall: place.on === 'island' ? 'island' : place.wall,
      t: Math.round(r.t * 1000) / 1000,
      // the per-kind default is a better guess than anything a single box can
      // say about how far back on the counter something stands
      depthT: null,
      shelfIndex: place.on === 'shelf' ? place.shelfIndex : null,
      burner: place.on === 'range' && place.rangeBox ? burnerAt(e.box, place.rangeBox) : null,
      sizeIn: sizeOf(r.raw, kind, place.on, factor),
      colorHex: hex.toUpperCase(),
      material,
      count: ITEM_STACKABLE.has(kind) ? clamp(countFromLabel(e.label), 1, 12) : 1,
    });
  }

  // --- 4. the cap ----------------------------------------------------------
  const room = Math.max(0, MAX_ITEMS - existing.length);
  const kept = fresh.slice(0, room);
  const dropped = fresh.length - kept.length;
  if (!kept.length && !dropped && !rejected && !notObjects) return spec;

  const note = `decor.items: ${kept.length} synthesised from the photo's boxes`
    + `${merged ? `, ${merged} second reading${merged === 1 ? '' : 's'} of an object already drawn` : ''}`
    + `${rejected + notObjects ? `, ${rejected + notObjects} dropped as plumbing / hardware, not an object` : ''}`
    + `${dropped ? `, ${dropped} dropped past the ${MAX_ITEMS}-item cap` : ''}`;
  const notes = Array.isArray(k.detected?.notes) ? k.detected.notes : [];
  return {
    ...spec,
    decor: { ...k.decor, items: [...existing, ...kept] },
    detected: { ...k.detected, notes: notes.includes(note) ? notes : [...notes, note] },
  } as T;
}
