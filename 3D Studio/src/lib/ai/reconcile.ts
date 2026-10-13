/**
 * Domain consistency for a RoomSpec that already has the right SHAPE (see
 * sanitize.ts). Zod checks ranges; this checks relationships: runs fit their
 * walls, base cabinets sum to the run, appliances sit in appliance gaps on a
 * wall that has a run, the hood is over the range, fixtures fit the wall,
 * garages have doors and driveways, material ids exist for their slot, etc.
 * With a photo inventory attached it also settles which WALL a corner
 * element stands on from how the photo shows it facing (see "Inventory
 * walls" below). Every change is appended to `ctx.fixes` for the UI's
 * "assumptions" list.
 */
import type {
  Appliance, BaseCabinet, BathAccessory, BathroomSpec, BoxOpenEdges, Burner, CabinetContents, CabinetRun, DecorItem, DecorItemKind, DecorItemOn, DecorSpec, DetectionMeta, ExteriorSpec, FinishObservation, KitchenLayout, KitchenSpec, MaterialSlotId, Opening, PendantPosition, PhotoElement, PhotoElementKind, RoomDims, RoomSpec, RoomType, SolvedCamera, UpperCabinet, Wall,
} from '@/lib/spec/types';
import { CATALOG_BY_ID, DEFAULT_SELECTIONS, materialsForSlot } from '@/lib/materials/catalog';
import { matchFinish, normalizeObservation, tallCabinetFallback, unifyRelatedSlots } from '@/lib/materials/match';
import { PhotoElementKindZ } from '@/lib/spec/schema';
import { defaultExterior, emptyDecor } from '@/lib/spec/defaults';
import {
  CABINET_ABOVE, HOOD_NET_CEILING_IN, hoodCabinetBandIn, hoodCabinetNet, resolveCabinetAbove, resolveHoodShape, resolveHoodStyle, rowBottomIn, rowHeightIn, rowToCeilingIn, runForHood,
} from '@/lib/spec/hood';
import { backsplashHeightWord } from '@/lib/spec/backsplash';
import { deriveUppers2, resolveUppers2HeightIn, STACK_MIN_ROW_IN, TIER2_MAX_BOXES, TIER2_MAX_IN, TIER2_MIN_IN } from '@/lib/spec/uppers';
import { resolveOpen } from '@/lib/spec/photo-box';
import { DEFAULT_COLOR, DEFAULT_MATERIAL, ITEM_KINDS, ITEM_MATERIALS, ITEM_SIZE, ITEM_STACKABLE, MAX_ITEMS } from '@/lib/spec/decor-items';
import { itemsFromInventory } from '@/lib/spec/items-from-inventory';
import { parseHex, repairHex } from '@/lib/materials/color';
import { clamp, ft } from '@/lib/units';
import { similarity } from './sanitize';
import { slotsForRoom } from './prompt';
import { isSingleRoom } from '@/lib/spec/floorplan';
import { confirmedDimensions } from '@/lib/spec/measurements';

export interface ReconcileContext {
  photoCount: number;
  fixes?: string[];
}

const note = (ctx: ReconcileContext, msg: string) => {
  if (ctx.fixes && ctx.fixes.length < 400) ctx.fixes.push(msg);
};

const wallLenFt = (dims: RoomDims, wall: Wall) => (wall === 'back' || wall === 'front' ? dims.widthFt : dims.depthFt);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.max(0, Math.round(n / 3) * 3);
const sumW = (cabs: Array<{ widthIn: number }>) => cabs.reduce((s, c) => s + c.widthIn, 0);

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Maps whatever the model wrote to a real catalog id valid for `slot`. */
export function resolveMaterialId(slot: MaterialSlotId, raw: unknown, roomType: RoomType): { id: string; changed: boolean } {
  const candidates = materialsForSlot(slot);
  const fallback = DEFAULT_SELECTIONS[roomType][slot] ?? candidates[0]?.id ?? '';
  if (typeof raw !== 'string' || !raw.trim()) return { id: fallback, changed: true };
  const id = raw.trim();
  const direct = CATALOG_BY_ID[id];
  if (direct && direct.slots.includes(slot)) return { id, changed: false };
  if (direct) {
    const twin = candidates.find((c) => c.name === direct.name || c.prompt === direct.prompt);
    if (twin) return { id: twin.id, changed: true };
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = Math.max(similarity(id, c.id), similarity(id, c.name), similarity(id, c.prompt) * 0.9, ...(c.tags ?? []).map((t) => similarity(id, t) * 0.7));
    if (score > bestScore) { bestScore = score; best = c.id; }
  }
  return best && bestScore >= 0.5 ? { id: best, changed: true } : { id: fallback, changed: true };
}

/**
 * Final material per slot. A slot the analyzer described (colour, pattern,
 * sheen in `detected.finishes`) is decided by the finish matcher — the
 * model's own catalog pick only breaks ties — because "it picked a white
 * that is not my white" is the complaint this exists to fix. Slots without
 * an observation keep the id-snapping path. `detected.finishes` is cleaned
 * in place so the spec only carries observations the matcher can rebuild
 * custom materials from later.
 */
function resolveMaterials<T extends object>(roomType: RoomType, materials: T, detected: DetectionMeta, ctx: ReconcileContext): T {
  const out: Record<string, string> = { ...(materials as unknown as Record<string, string>) };
  const observed = new Map<string, FinishObservation>();
  const rawFinishes = Array.isArray(detected.finishes) ? detected.finishes : [];
  for (const raw of rawFinishes) {
    const obs = normalizeObservation(raw, roomType);
    if (!obs) { note(ctx, `detected.finishes: dropped an observation without a usable slot or colour (${String((raw as { slot?: unknown })?.slot ?? '?')})`); continue; }
    observed.set(obs.slot, obs);
  }
  detected.finishes = [...observed.values()];
  for (const slot of slotsForRoom(roomType)) {
    const { id, changed } = resolveMaterialId(slot, out[slot], roomType);
    const obs = observed.get(slot);
    if (obs) {
      // the wall the camera faces is what turns the photo's `plankRun` into a
      // room-frame direction; without it a side-wall photo resolves as if the
      // camera looked at the back wall
      const m = matchFinish(obs, roomType, id, detected.camera?.lookingAt ?? null);
      if (m.custom) note(ctx, m.reason);
      else if (m.id !== id) note(ctx, `materials.${slot}: photo colour ${obs.baseColorHex} reads as ${m.id} (ΔE ${m.deltaE.toFixed(1)}), not ${id}`);
      out[slot] = m.id;
      continue;
    }
    if (changed) note(ctx, `materials.${slot}: "${String(out[slot] ?? '')}" is not a catalog id → ${id}`);
    out[slot] = id;
  }
  return out as unknown as T;
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Photo inventory
// ---------------------------------------------------------------------------

// 90, not 60: items are boxed too now. Moves together with schema.ts's
// DetectionMetaZ.elements cap, inventory.ts MAX_INVENTORY_ELEMENTS and the
// fitter's cleanElementsDetailed, or items are truncated at whichever is lowest.
export const MAX_ELEMENTS = 90;
/** a box thinner than this in either direction is a line, not an element */
const MIN_BOX_SIDE = 0.004;
const ELEMENT_KINDS = new Set<string>(PhotoElementKindZ.options);
const ELEMENT_WALLS = new Set<string>(['back', 'left', 'right', 'front', 'island']);
const ELEMENT_FACINGS = new Set<string>(['front', 'left', 'right', 'edge']);


const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const r3d = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Validates a raw inventory (from the inventory call or from the model's own
 * `detected.elements`) into PhotoElements the fitter can trust: kinds from the
 * enum, boxes clamped to 0..1 with x0<x1 and y0<y1, degenerate boxes and
 * exact duplicates dropped, ids unique, at most MAX_ELEMENTS. Never throws.
 *
 * `eyeFt` is how high the photographer stood, in feet above the floor, when
 * anything says so — `repairIslandTops` is the one repair here that needs it,
 * and refuses to run without it.
 */
export function reconcileElements(raw: unknown, ctx?: ReconcileContext, eyeFt?: number | null): PhotoElement[] {
  if (!Array.isArray(raw)) return [];
  const out: PhotoElement[] = [];
  const ids = new Set<string>();
  const seenBoxes = new Set<string>();
  let dropped = 0;
  let deduped = 0;
  const counter: Partial<Record<string, number>> = {};
  for (const item of raw) {
    if (out.length >= MAX_ELEMENTS) break;
    if (!item || typeof item !== 'object') { dropped++; continue; }
    const e = item as Record<string, unknown>;
    const kind = typeof e.kind === 'string' && ELEMENT_KINDS.has(e.kind) ? (e.kind as PhotoElementKind) : null;
    if (!kind) { dropped++; continue; }
    // tolerate a [x0,y0,x1,y1] tuple — an unstrict retry may produce one
    const tuple = Array.isArray(e.box) && e.box.length === 4 ? (e.box as unknown[]) : null;
    const b = !tuple && e.box && typeof e.box === 'object' ? (e.box as Record<string, unknown>) : null;
    const x0 = num(b ? b.x0 : tuple?.[0]), y0 = num(b ? b.y0 : tuple?.[1]), x1 = num(b ? b.x1 : tuple?.[2]), y1 = num(b ? b.y1 : tuple?.[3]);
    if (x0 === null || y0 === null || x1 === null || y1 === null) { dropped++; continue; }
    const box = { x0: r3d(clamp(x0, 0, 1)), y0: r3d(clamp(y0, 0, 1)), x1: r3d(clamp(x1, 0, 1)), y1: r3d(clamp(y1, 0, 1)) };
    if (box.x1 - box.x0 < MIN_BOX_SIDE || box.y1 - box.y0 < MIN_BOX_SIDE) { dropped++; continue; }
    const key = `${kind}|${box.x0}|${box.y0}|${box.x1}|${box.y1}`;
    if (seenBoxes.has(key)) { deduped++; continue; }
    seenBoxes.add(key);
    const wall = typeof e.wall === 'string' && ELEMENT_WALLS.has(e.wall) ? (e.wall as PhotoElement['wall']) : null;
    const facing = typeof e.facing === 'string' && ELEMENT_FACINGS.has(e.facing) ? (e.facing as PhotoElement['facing']) : null;
    counter[kind] = (counter[kind] ?? 0) + 1;
    let id = typeof e.id === 'string' ? e.id.trim().slice(0, 40) : '';
    if (!id || ids.has(id)) id = `${kind}-${counter[kind]}`;
    while (ids.has(id)) id = `${id}-${out.length + 1}`;
    ids.add(id);
    const confidence = num(e.confidence);
    // which edges are a CUT rather than the element's own boundary — read from
    // the annotator and unioned with the edges the frame demonstrably cut
    const { open, openCause } = resolveOpen(box, e.open as Partial<BoxOpenEdges> | null, e.openCause);
    out.push({
      id, kind, wall, facing, box,
      label: typeof e.label === 'string' ? e.label.trim().slice(0, 160) : '',
      confidence: r3d(clamp(confidence ?? 0.5, 0, 1)),
      open, openCause,
    });
  }
  if (ctx && dropped) note(ctx, `detected.elements: dropped ${dropped} element${dropped === 1 ? '' : 's'} with a missing kind or a degenerate box`);
  if (ctx && deduped) note(ctx, `detected.elements: dropped ${deduped} duplicate box${deduped === 1 ? '' : 'es'}`);
  if (ctx && Array.isArray(raw) && raw.length > MAX_ELEMENTS) note(ctx, `detected.elements: capped at ${MAX_ELEMENTS}`);
  repairIslandTops(out, eyeFt ?? null, ctx);
  return out;
}

/**
 * A base run's box stops at the countertop's UNDERSIDE (BOX RULES, prompt.ts);
 * an island's stops at the TOP of its slab — one counter thickness higher on a
 * box that spans the 34.5 in from toe kick to that underside. Scale-free: both
 * boxes shrink with distance together, so the fraction holds at any depth.
 */
const COUNTER_SLAB_OF_RUN = 1.5 / 34.5;

/**
 * The seating overhang a stool along the ISLAND'S SIDE needs, and the least
 * that will do. `stoolPositions` (kitchen/layout.ts) tucks a side stool 3"
 * under the front edge of the top, so at anything under 10.1" the seat is
 * drawn inside the carcass — the spec is not one the twin can draw. Exported
 * because three places have to agree about the same number: this reconciler,
 * `params.ts` (which floors the fitted overhang), and `LayoutPanel`'s slider,
 * which starts here so that every value a user can set is a value that comes
 * back unchanged from the next fit or accuracy pass.
 */
export const ISLAND_KNEE_MIN_IN = 10;
export const ISLAND_KNEE_IN = 12;

/**
 * Whether this island has a stool along its SIDE — the only row the seating
 * overhang is for. Stools round a short end tuck under `endOverhangIn`
 * instead, so an island seated only at its ends keeps the full overhang range
 * (down to flush, which is what the client's own photo shows).
 */
export function islandNeedsKneeRoom(isl: { seating: number; endSeats: number }): boolean {
  const seating = Math.max(0, Math.round(Number.isFinite(isl.seating) ? isl.seating : 0));
  const ends = Math.max(0, Math.round(Number.isFinite(isl.endSeats) ? isl.endSeats : 0));
  return seating - Math.min(seating, ends) > 0;
}

/** nominal height of an island's countertop above the floor, in feet (36 in) */
const ISLAND_COUNTER_FT = 3;
/**
 * How far above that counter the photographer has to stand before the ordering
 * `repairIslandTops` rests on is usable. Half a foot: below the counter plane
 * the ordering is REVERSED (see there), and within a few inches of it both
 * counters sit on the horizon, so which of them draws higher is decided by the
 * annotator's pixel or two rather than by the room. A standing photographer is
 * at 4.5–5.5 ft, so this refuses only shots taken sitting down or from the hip
 * — exactly the ones the repair cannot read.
 */
const EYE_ABOVE_COUNTER_FT = 0.5;

/**
 * How high the photographer stood, in feet above the floor, from whatever the
 * spec actually knows — the fitter's solved camera first (metres, room frame,
 * floor y = 0), else the analyzer's own estimate. Null when neither is stated:
 * a defaulted number is not evidence, and the one caller that needs this
 * refuses to act without it.
 */
export function cameraEyeFt(camera: DetectionMeta['camera'] | null | undefined): number | null {
  if (!camera || typeof camera !== 'object') return null;
  const solvedY = camera.solved?.y;
  if (typeof solvedY === 'number' && Number.isFinite(solvedY) && solvedY > 0) return solvedY / ft(1);
  const h = camera.heightFt;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : null;
}

/**
 * THE CONTAMINATED ISLAND BOX. The island box's top edge is the FAR edge of
 * its countertop. That top and the counter of the run on the wall the camera
 * faces are two horizontal planes ~36 in above the same floor, and a camera
 * ABOVE them sees the NEARER plane LOWER in the frame; the island always
 * stands in front of that run, with a walking aisle between them. So an
 * island box whose top edge is ABOVE the back run's box top is impossible —
 * and it happens for exactly one reason: the annotator traced the island's
 * silhouette WITH the vases, bowls and boards standing on it, against the
 * contract this file's prompt gives it ("EXCLUDING … anything standing on it").
 *
 * ABOVE THEM IS A PREMISE, NOT A GIVEN, and it is checked. For a horizontal
 * plane at height h seen from an eye at height H, the depression below the
 * horizon is atan((H − h) / D): with H > h a nearer plane (smaller D) draws
 * LOWER, which is the rule above; with H < h the same plane is seen from
 * underneath, the angle is an ELEVATION, and a nearer plane draws HIGHER —
 * the rule reverses and this repair destroys a correct box. Measured on a
 * ground-truth inventory (a 16×16 ft room, an 8 ft island, the camera at the
 * front wall pitched 4° down so both floor lines stay in frame) the unguarded
 * version threw away a third of the frame at eye height 1.6 ft (island y0
 * 0.017 → 0.335, over half the island's height) and was still moving a
 * correct box at 2.8 ft — while writing a note blaming the annotator. So the
 * eye has to be KNOWN and has to clear the counter by `EYE_ABOVE_COUNTER_FT`;
 * unknown or lower, the boxes are left exactly as drawn.
 *
 * The margin is wide once the premise holds. The bound only bites if the
 * island's far edge is within (H − 34.5) / (H − 36) ≈ 6% of the back run's
 * distance — i.e. the island jammed against the run with no aisle at all. The
 * second gate below (the island's floor line must be LOWER in the frame than
 * the run's, which is what "nearer" looks like on the floor plane) refuses the
 * repair when even that much is not visible in the boxes themselves.
 *
 * Measured, all four client fixtures break this bound — client-tan by 0.030
 * of the frame, the other three by 0.011 to 0.024 — and trimming to it raises
 * the FITTED score, the proportions AND the island's own IoU on every one of
 * them (score / island IoU after `fitToPhoto` at the fixture's own aspect:
 * tan .6891/.859 → .6933/.913, marble .7249/.682 → .7411/.725, marble-items
 * .6945/.616 → .6959/.630, shelves .7176/.672 → .7249/.735). So this is not
 * a client-tan patch that the others merely survive; they were all drawn a
 * little too tall, and tan is the one where it became visible.
 *
 * On client-tan, whose island top edge measures 0.603 on the photo's own
 * pixels against a boxed 0.504, it recovers 0.534 — a third of the error, and
 * only the third the boxes themselves prove. Reading the rest would need the
 * horizon (the two floor lines give the depth ratio, and the depth ratio
 * gives the counter line exactly), and on this fixture the island's floor
 * line is contaminated too: it is boxed at 1.000 against a measured 0.95,
 * because the stools in front of it run off the bottom of the picture. A
 * repair that leans on a contaminated edge to fix a contaminated edge is not
 * a repair. The other obvious rule — trim to the base of the lowest thing
 * standing on the island — is falsified by the same fixture: its serving-bowl
 * box has its base at 0.534, still above the counter's real far edge.
 */
export function repairIslandTops(els: PhotoElement[], eyeFt: number | null, ctx?: ReconcileContext): void {
  // the premise, first: a camera at or below the counters sees the ordering
  // this repair reads REVERSED, and a camera nobody measured is not evidence
  if (eyeFt === null || !(eyeFt >= ISLAND_COUNTER_FT + EYE_ABOVE_COUNTER_FT)) return;
  const islands = els.filter((e) => e.kind === 'island');
  if (!islands.length) return;
  // runs on the wall the camera faces only: a side run's box top is its
  // FARTHEST end, which an island can legitimately sit beyond.
  const runs = els.filter((e) => e.kind === 'base-cabinet-run' && e.wall === 'back');
  if (!runs.length) return;
  // the highest box top among them is the farthest counter = the weakest,
  // safest form of the bound
  const ref = runs.reduce((a, b) => (b.box.y0 < a.box.y0 ? b : a));
  const line = ref.box.y0 - (ref.box.y1 - ref.box.y0) * COUNTER_SLAB_OF_RUN;
  for (const isl of islands) {
    if (isl.box.y1 <= ref.box.y1) continue;          // not visibly nearer than the run — say nothing
    if (isl.box.y0 >= line) continue;                // already below the counter line
    const y0 = r3d(Math.min(line, isl.box.y1 - MIN_BOX_SIDE));
    if (y0 <= isl.box.y0) continue;
    if (ctx) note(ctx, `detected.elements: trimmed the ${isl.id} box down from ${isl.box.y0} to ${y0} — its top edge was above the back run's counter line, which puts the island behind the wall it stands in front of (it had swallowed what stands on the island)`);
    isl.box = { ...isl.box, y0 };
  }
}

// ---------------------------------------------------------------------------
// Photo frame — which wall the inventory calls "back"
// ---------------------------------------------------------------------------

/**
 * The inventory's read of the primary photo's frame: the normalised x extent
 * of the back wall's plane in the picture and whether either side wall shows.
 * The analysis and the inventory each choose a "back" wall on their own; this
 * block is how the fitter tells whether they chose the same one, and where an
 * element at the edge of the frame really stands.
 */
export interface PhotoFrame {
  backWallSpansX: [number, number];
  leftWallVisible: boolean;
  rightWallVisible: boolean;
}

/** `detected` with the frame block, until the spec types carry it. */
export type DetectedWithFrame = DetectionMeta & { frame?: PhotoFrame | null };

/** A frame block is either a usable span plus two flags, or null — never a half frame. */
export function reconcileFrame(raw: unknown): PhotoFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const span = Array.isArray(f.backWallSpansX) ? f.backWallSpansX : null;
  const a = num(span?.[0]), b = num(span?.[1]);
  if (a === null || b === null) return null;
  const x0 = r3d(clamp(Math.min(a, b), 0, 1)), x1 = r3d(clamp(Math.max(a, b), 0, 1));
  // a back wall thinner than 5% of the frame is not a read, it is a guess
  if (x1 - x0 < 0.05) return null;
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : typeof v === 'string' ? v.trim().toLowerCase() === 'true' : dflt);
  // when the flags are missing, a back wall that stops short of the frame edge means the side wall shows
  return { backWallSpansX: [x0, x1], leftWallVisible: bool(f.leftWallVisible, x0 > 0.02), rightWallVisible: bool(f.rightWallVisible, x1 < 0.98) };
}

/** The frame block on a spec, when one was attached (see analyze.ts). */
export function detectedFrame(spec: RoomSpec): PhotoFrame | null {
  return reconcileFrame((spec.detected as DetectedWithFrame | undefined)?.frame);
}

/** Walls in the order a viewer turning to the right meets them; rotating a label by k steps names the wall k places on. */
const WALL_RING: readonly Wall[] = ['back', 'right', 'front', 'left'];
const isRingWall = (w: unknown): w is Wall => typeof w === 'string' && (WALL_RING as readonly string[]).includes(w);
export const rotateWall = (w: Wall, k: number): Wall => WALL_RING[(WALL_RING.indexOf(w) + k + 400) % 4];

/**
 * The wall that adjoins `wall` at position `t` when `t` is near an end, so
 * "the spec has the fridge at t 0.99 on the back wall, the photo says right
 * wall" reads as a corner rather than a contradiction. Facing the front wall
 * from inside, the LEFT end (t 0) is the room's +x side, i.e. the right wall.
 */
function cornerNeighbour(wall: Wall, t: number): Wall | null {
  const end = t >= 0.85 ? 1 : t <= 0.15 ? 0 : -1;
  if (end < 0) return null;
  switch (wall) {
    case 'back': return end ? 'right' : 'left';
    case 'front': return end ? 'left' : 'right';
    case 'left': return end ? 'back' : 'front';
    case 'right': return end ? 'front' : 'back';
  }
}

/** Where the finished spec draws each inventory kind: wall → positions (t) of its instances. */
function specPlacements(spec: RoomSpec): Map<PhotoElementKind, Map<Wall, number[]>> {
  const m = new Map<PhotoElementKind, Map<Wall, number[]>>();
  const add = (kind: PhotoElementKind, wall: Wall | 'island' | 'corner' | null | undefined, t = 0.5) => {
    if (!isRingWall(wall)) return;
    const byWall = m.get(kind) ?? new Map<Wall, number[]>();
    byWall.set(wall, [...(byWall.get(wall) ?? []), t]);
    m.set(kind, byWall);
  };
  if (!isSingleRoom(spec)) return m;
  for (const o of spec.openings) add(o.kind === 'window' ? 'window' : 'door', o.wall, o.t);
  for (const sh of spec.decor.shelves) add('shelf', sh.wall, sh.t);
  for (const a of spec.decor.art) add('art', a.wall, a.t);
  for (const p of spec.decor.plants) add('plant', p.wall, p.t);
  for (const it of spec.decor.items ?? []) add('item', it.wall, it.t);
  if (spec.roomType === 'kitchen') {
    for (const r of spec.runs) {
      const mid = r.start + r.lengthFt / 2 / Math.max(1, wallLenFt(spec.dims, r.wall));
      add('base-cabinet-run', r.wall, mid);
      if (r.hasUppers) add('upper-cabinet-run', r.wall, mid);
      if (r.backsplash) add('backsplash', r.wall, mid);
      for (const t of r.tall) add('tall-cabinet', r.wall, t.t);
    }
    add('sink', spec.sink.wall, spec.sink.t);
    add('faucet', spec.sink.wall, spec.sink.t);
    for (const a of spec.appliances) {
      if (a.kind === 'wine-fridge') continue;
      add(a.kind, a.wall, a.t);
      // a photo cannot tell a slide-in range from a cooktop set in the run
      if (a.kind === 'range') add('cooktop', a.wall, a.t);
      if (a.kind === 'cooktop') add('range', a.wall, a.t);
    }
  } else {
    if (spec.vanity.present) { add('vanity', spec.vanity.wall, spec.vanity.t); add('sink', spec.vanity.wall, spec.vanity.t); add('faucet', spec.vanity.wall, spec.vanity.t); if (spec.vanity.mirror !== 'none') add('mirror', spec.vanity.wall, spec.vanity.t); }
    if (spec.shower.present) add('shower', spec.shower.wall, spec.shower.t);
    if (spec.tub.present) add('tub', spec.tub.wall, spec.tub.t);
    if (spec.toilet.present) add('toilet', spec.toilet.wall, spec.toilet.t);
  }
  return m;
}

export interface WallReconciliation {
  elements: PhotoElement[];
  /** quarter turns applied to every wall label (0 = the labels already agreed with the spec) */
  rotation: number;
  notes: string[];
}

/**
 * Checks the inventory's wall labels against the walls the FINISHED spec
 * draws each kind on. Two outcomes, neither touching geometry:
 * - the labels as a whole are turned relative to the spec (the inventory
 *   called the left wall "back") → every label is rotated so both name the
 *   same wall "back". The spec is the geometry the user is looking at, so
 *   the labels move, never the spec.
 * - one element sits on another wall than the spec's (the fridge at the far
 *   right of the frame labelled 'right' while the spec has it at the end of
 *   the back run) → a note; the fitter decides, with the frame hint.
 * `wall`-kind boxes never vote (the spec has all four) but turn with the
 * rest — the fitter refuses to pair a wall box with a wall of another name.
 */
export function reconcileElementWalls(spec: RoomSpec, frame: PhotoFrame | null): WallReconciliation {
  const elements = spec.detected?.elements ?? [];
  const notes: string[] = [];
  if (!elements.length || !isSingleRoom(spec)) return { elements, rotation: 0, notes };
  const placed = specPlacements(spec);
  const comparable = elements.filter((e) => e.kind !== 'wall' && isRingWall(e.wall) && placed.has(e.kind));
  if (!comparable.length) return { elements, rotation: 0, notes };
  const matches = (k: number) => comparable.filter((e) => placed.get(e.kind)!.has(rotateWall(e.wall as Wall, k))).length;
  const scores = [0, 1, 2, 3].map(matches);
  let rotation = 0;
  // a whole-frame turn needs a clear majority AND more than a couple of
  // elements behind it — one mislabelled fridge must not spin the room
  for (let k = 1; k < 4; k++) if (scores[k] > scores[rotation]) rotation = k;
  if (rotation && !(comparable.length >= 3 && scores[rotation] >= Math.ceil(comparable.length * 0.6) && scores[rotation] > scores[0])) rotation = 0;
  let out = elements;
  if (rotation) {
    out = elements.map((e) => (isRingWall(e.wall) ? { ...e, wall: rotateWall(e.wall, rotation) } : e));
    notes.push(`inventory: the photo's wall labels were turned ${rotation} quarter-turn${rotation === 1 ? '' : 's'} to the spec's frame (${scores[rotation]} of ${comparable.length} elements agree that way, ${scores[0]} as labelled)`);
  }
  // per-element disagreements, one note per kind + wall pair
  const seen = new Set<string>();
  const wallName = (w: Wall) => `${w} wall`;
  for (const e of out) {
    if (e.kind === 'wall' || !isRingWall(e.wall)) continue;
    const byWall = placed.get(e.kind);
    if (!byWall || byWall.has(e.wall)) continue;
    const key = `${e.kind}|${e.wall}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const specWalls = [...byWall.keys()];
    const corner = specWalls.flatMap((w) => (byWall.get(w) ?? []).filter((t) => cornerNeighbour(w, t) === e.wall).map((t) => `t ${r1(t * 100) / 100} on the ${wallName(w)}`));
    const cx = (e.box.x0 + e.box.x1) / 2;
    const beyond = frame && (cx > frame.backWallSpansX[1] ? 'right' : cx < frame.backWallSpansX[0] ? 'left' : null);
    const frameHint = beyond && beyond === e.wall ? `; its box sits ${beyond} of the back wall's span (x ${frame!.backWallSpansX[0]}–${frame!.backWallSpansX[1]}), which agrees with the label` : '';
    // a front turned toward the left of the frame belongs to something on the right wall, and vice versa
    const facingHint = e.facing === 'left' && e.wall === 'right' ? '; its front faces left in the photo, as a right-wall element\'s would' : e.facing === 'right' && e.wall === 'left' ? '; its front faces right in the photo, as a left-wall element\'s would' : e.facing === 'front' && e.wall !== 'back' ? '; but it is seen face-on, as a back-wall element would be' : '';
    notes.push(corner.length
      ? `inventory: ${e.kind} labelled on the ${wallName(e.wall)}; spec draws it at ${corner[0]} — a corner, so either wall may be right${frameHint}${facingHint}`
      : `inventory: ${e.kind} labelled on the ${wallName(e.wall)}; spec draws it on the ${specWalls.map(wallName).join(' / ')}${frameHint}${facingHint}`);
  }
  return { elements: out, rotation, notes };
}

/** A solved camera is either every field finite and in range, or null — the fitter never reads a half camera. */
export function reconcileSolvedCamera(raw: unknown): SolvedCamera | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const x = num(c.x), y = num(c.y), z = num(c.z), yawDeg = num(c.yawDeg), pitchDeg = num(c.pitchDeg), fovDeg = num(c.fovDeg), aspect = num(c.aspect), score = num(c.score);
  if ([x, y, z, yawDeg, pitchDeg, fovDeg, aspect, score].some((v) => v === null)) return null;
  if (fovDeg! < 10 || fovDeg! > 150 || aspect! < 0.2 || aspect! > 5) return null;
  return { x: x!, y: y!, z: z!, yawDeg: yawDeg!, pitchDeg: pitchDeg!, fovDeg: fovDeg!, aspect: aspect!, score: clamp(score!, 0, 1) };
}

/** How many of `kinds` the inventory holds. */
const countKinds = (elements: PhotoElement[], ...kinds: PhotoElementKind[]) => elements.filter((e) => kinds.includes(e.kind)).length;

/** "1 stool" / "4 stools"; pass the plural when +s is wrong ("pieces of art"). */
const plural = (n: number, word: string, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;

/**
 * Where the photo's inventory and the spec disagree on a COUNT, say so in
 * detected.notes. Nothing is edited here: the fitter and the accuracy pass
 * own that decision, and "photo shows 4 stools, spec says 2" is exactly the
 * line they need to make it.
 */
export function inventoryDisagreements(spec: RoomSpec): string[] {
  const elements = spec.detected?.elements ?? [];
  if (!elements.length) return [];
  const out: string[] = [];
  const compare = (what: string, photo: number, specCount: number, extra = '', whats?: string) => {
    if (photo !== specCount) out.push(`photo shows ${plural(photo, what, whats)}, spec says ${specCount}${extra}`);
  };
  const windows = countKinds(elements, 'window');
  // a plan is not a photograph: there is no inventory to disagree with
  if (spec.roomType === 'floorplan') return out;
  if (spec.roomType === 'exterior') {
    // an exterior photo shows one or two elevations; only flag the spec having FEWER than the photo
    const specWindows = spec.elevations.reduce((s, el) => s + el.windows.length, 0);
    const specDoors = spec.elevations.reduce((s, el) => s + el.doors.length, 0);
    const doors = countKinds(elements, 'door');
    if (windows > specWindows) out.push(`photo shows ${plural(windows, 'window')}, spec says ${specWindows} across all elevations`);
    if (doors > specDoors) out.push(`photo shows ${plural(doors, 'door')}, spec says ${specDoors} across all elevations`);
    return out;
  }
  // windows: a photo only shows some walls, so flag when the photo has MORE than the spec, or the spec has none
  const specWindows = spec.openings.filter((o) => o.kind === 'window').length;
  if (windows > specWindows) compare('window', windows, specWindows);
  const shelves = countKinds(elements, 'shelf');
  const specShelfBoards = spec.decor.shelves.reduce((s, sh) => s + (sh.enclosure ? 1 : sh.count), 0);
  const shelfLabel = spec.decor.shelves.some((sh) => sh.enclosure) ? 'shelf board or enclosed case' : 'shelf board';
  if (shelves > 0 || specShelfBoards > 0) compare(shelfLabel, shelves, specShelfBoards);
  const plants = countKinds(elements, 'plant');
  if (plants > 0 || spec.decor.plants.length > 0) compare('plant', plants, spec.decor.plants.length);
  const art = countKinds(elements, 'art');
  if (art > 0 || spec.decor.art.length > 0) compare('piece of art', art, spec.decor.art.length, '', 'pieces of art');
  // items are boxed in a bathroom photo too, and since the bathroom kinds
  // exist a bathroom can hold them — so the count is compared for BOTH
  // interiors now. It used to be kitchen-only because `fixDecor` forced a
  // bathroom's items to [], which made this a note no correction could ever
  // satisfy. (The caller only ever passes an interior — an exterior has no
  // `decor` at all — so there is nothing left to exclude.)
  {
    const itemBoxes = countKinds(elements, 'item');
    const specItems = spec.decor.items?.length ?? 0;
    if (itemBoxes > 0 || specItems > 0) compare('item', itemBoxes, specItems, '', 'items');
  }
  const pendants = countKinds(elements, 'pendant');
  const specPendants = spec.lighting.pendants?.count ?? 0;
  if (pendants > 0 || specPendants > 0) compare('pendant', pendants, specPendants);
  const rug = countKinds(elements, 'rug') > 0;
  const specRug = Boolean(spec.decor.rug?.present);
  if (rug !== specRug) out.push(rug ? 'photo shows a rug, spec has none' : 'spec has a rug the photo does not show');

  if (spec.roomType === 'kitchen') {
    const stools = countKinds(elements, 'stool');
    if (stools > 0 || spec.island.seating > 0) compare('stool', stools, spec.island.seating, spec.island.present ? '' : ' (no island in the spec)');
    const island = countKinds(elements, 'island') > 0;
    if (island !== spec.island.present) out.push(island ? 'photo shows an island, spec has none' : 'spec has an island the photo does not show');
    const applianceKinds: Array<Appliance['kind'] & PhotoElementKind> = ['fridge', 'range', 'cooktop', 'hood', 'dishwasher', 'wall-oven', 'microwave'];
    for (const kind of applianceKinds) {
      const inPhoto = countKinds(elements, kind) > 0;
      const inSpec = spec.appliances.some((a) => a.kind === kind);
      if (inPhoto && !inSpec) out.push(`photo shows a ${kind}, spec has none`);
    }
    const tall = countKinds(elements, 'tall-cabinet');
    const specTall = spec.runs.reduce((s, r) => s + r.tall.length, 0);
    if (tall > specTall) compare('tall cabinet', tall, specTall);
  } else {
    const fixtures: Array<['vanity' | 'shower' | 'tub' | 'toilet', boolean]> = [
      ['vanity', spec.vanity.present], ['shower', spec.shower.present], ['tub', spec.tub.present], ['toilet', spec.toilet.present],
    ];
    for (const [kind, present] of fixtures) {
      const inPhoto = countKinds(elements, kind) > 0;
      if (inPhoto && !present) out.push(`photo shows a ${kind}, spec has none`);
    }
    const mirror = countKinds(elements, 'mirror') > 0;
    if (mirror && spec.vanity.mirror === 'none') out.push('photo shows a mirror, spec says none');
  }
  return out;
}

function fixDetected(d: DetectionMeta, ctx: ReconcileContext): DetectionMeta {
  const clean = (arr: string[]) => Array.from(new Set(arr.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean))).slice(0, 24);
  const camera = d.camera && typeof d.camera === 'object' ? d.camera : { fovDeg: 62, heightFt: 5, position: 'front' as const, lookingAt: 'back' as const, solved: null };
  const out: DetectedWithFrame = {
    ...d,
    confidence: clamp(d.confidence, 0, 1),
    summary: d.summary?.trim() || 'Reconstructed from the uploaded photos.',
    notes: clean(d.notes),
    assumptions: clean(d.assumptions),
    primaryPhotoIndex: clamp(Math.round(d.primaryPhotoIndex), 0, Math.max(0, ctx.photoCount - 1)),
    camera: { ...camera, solved: reconcileSolvedCamera(camera.solved) },
    finishes: Array.isArray(d.finishes) ? d.finishes : [],
    // the island-box repair needs to know the photographer stood above the
    // counters (`repairIslandTops`), and this is the one place that knows
    elements: reconcileElements(d.elements, ctx, cameraEyeFt({ ...camera, solved: reconcileSolvedCamera(camera.solved) })),
    // the inventory's frame block rides along (validated, never half) so the fitter can read it
    frame: reconcileFrame((d as DetectedWithFrame).frame),
    // the detector's own repeatability: server-written, so a half answer is no answer
    inventory: d.inventory && typeof d.inventory === 'object' && typeof d.inventory.samples === 'number' && Number.isFinite(d.inventory.samples)
      ? {
          samples: clamp(Math.round(d.inventory.samples), 0, 4),
          agreement: typeof d.inventory.agreement === 'number' && Number.isFinite(d.inventory.agreement) ? clamp(d.inventory.agreement, 0, 1) : null,
        }
      : null,
  };
  return out;
}

/**
 * Décor fits the room it is in: a shelf cannot be wider than its wall or hang
 * above the ceiling, art keeps its whole frame on the wall, a rug fits the
 * floor. Anything the model hallucinated past the schema's hard caps is
 * truncated rather than rejected — a twin with five plants is closer to the
 * photo than a twin with none.
 */
/**
 * Where a `decor.items` entry can legally stand in THIS room. Built at the
 * call site by `reconcileKitchen` and `reconcileBathroom`; null empties both
 * detail arrays, which is what an exterior gets.
 *
 * A bathroom has no range and no island, so the re-hosting below moves
 * anything claiming one onto 'counter' — which in a bathroom IS the vanity
 * top. That is why the bathroom needed no new host word and no consumer has a
 * new `DecorItemOn` case to handle.
 */
interface DecorHost {
  /** wall of the first non-island range/cooktop */
  rangeWall: Wall | null;
  /** that hob's width in inches — under 32" it has four burners and no centre pair */
  rangeWidthIn: number;
  hasIsland: boolean;
  longestRunWall: Wall | null;
  /** walls carrying decor.shelves */
  shelfWalls: Wall[];
  /** walls carrying an opening of kind 'window' */
  windowWalls: Wall[];
  runWalls: Set<Wall>;
}

const ITEM_HOSTS: readonly DecorItemOn[] = ['counter', 'range', 'island', 'shelf', 'sill', 'floor'];
/**
 * The order a range item claims a free burner, front-to-back per side the way
 * a cook loads a hob (contract §4.2). The centre pair only exists on a 5- or
 * 6-burner range, so it is offered last and only when the range is wide enough
 * — layout.ts's BURNER_ORDER has the same table, and a burner the drawn hob
 * does not have gets silently reassigned there.
 */
const BURNER_ORDER: readonly Burner[] = ['left-back', 'right-back', 'left-front', 'right-front', 'centre-back', 'centre-front'];
/** a hob narrower than this has four burners and no centre pair */
const CENTRE_BURNER_MIN_IN = 32;
const CONTENT_KINDS: readonly CabinetContents['kind'][] = ['plates', 'bowls', 'glasses', 'mugs', 'jars', 'cookbooks', 'bottles', 'mixed', 'empty'];

/** kinds that stand back against the splash rather than in the middle of the counter */
const ITEM_BACK_OF_COUNTER = new Set<DecorItemKind>([
  'paper-towel', 'knife-block', 'canister', 'jar', 'utensil-crock', 'coffee-maker', 'toaster',
  'microwave-countertop', 'stand-mixer', 'bottle', 'oil-set', 'candle', 'vase', 'flowers',
]);

function fixDecor(raw: DecorSpec | undefined, dims: RoomDims, hasWindows: boolean, ctx: ReconcileContext, host: DecorHost | null = null, allowContents = true): DecorSpec {
  const d: DecorSpec = raw && typeof raw === 'object' ? { ...emptyDecor(), ...raw } : emptyDecor();
  const L = (wall: Wall) => wallLenFt(dims, wall);
  let fitted = 0;

  const shelves = (Array.isArray(d.shelves) ? d.shelves : []).slice(0, 6).map((s) => {
    const wallIn = L(s.wall) * 12;
    const widthIn = clamp(r3(s.widthIn) || 24, 12, Math.max(12, Math.min(120, wallIn)));
    const half = widthIn / 2 / wallIn;
    let count = clamp(Math.round(s.count) || 1, 1, 5);
    let spacingIn = clamp(s.spacingIn || 14, 8, 24);
    // the top board still needs a few inches of wall above it
    const maxBottom = dims.ceilingFt - ((count - 1) * spacingIn + 4) / 12;
    let bottomFt = r1(clamp(s.bottomFt, 2, Math.max(2, maxBottom)));
    let enclosure = s.enclosure ?? null;
    if (enclosure) {
      // The case's observed base and top bound its boards. Floating shelves
      // retain their old clearance rule; a case may meet the ceiling.
      bottomFt = clamp(s.bottomFt, 2, Math.min(9, dims.ceilingFt - 1));
      const thickness = clamp(numOr(enclosure.panelThicknessIn, 0.75), 0.25, 2);
      const heightIn = clamp(numOr(enclosure.heightIn, 12), 12, Math.min(120, (dims.ceilingFt - bottomFt) * 12));
      count = Math.min(count, Math.floor((heightIn - 2 * thickness) / 8) + 1);
      if (count > 1) spacingIn = Math.min(spacingIn, (heightIn - 2 * thickness) / (count - 1));
      enclosure = { heightIn, backPanel: enclosure.backPanel === true, panelThicknessIn: enclosure.panelThicknessIn == null ? null : thickness,
        rotationDeg: [-90, 0, 90, 180].includes(enclosure.rotationDeg as number) ? enclosure.rotationDeg : null };
    }
    const t = clamp(s.t, Math.min(half, 0.5), Math.max(1 - half, 0.5));
    if (widthIn !== s.widthIn || bottomFt !== r1(s.bottomFt) || Math.abs(t - s.t) > 0.005) fitted++;
    return { ...s, t, widthIn, count, bottomFt, depthIn: clamp(s.depthIn || 10, 6, 16), spacingIn,
      ...(s.enclosure !== undefined ? { enclosure } : {}),
      ...(s.finishColorHex !== undefined ? { finishColorHex: parseHex(s.finishColorHex) } : {}),
    };
  });
  if (fitted) note(ctx, `decor.shelves: ${fitted} shelf unit${fitted === 1 ? '' : 's'} fitted to the wall`);

  const plants = (Array.isArray(d.plants) ? d.plants : []).slice(0, 8).map((p) => {
    const maxFt = p.kind === 'floor' ? dims.ceilingFt - 0.5 : p.kind === 'hanging' ? 3 : 2.5;
    return { ...p, t: clamp(p.t, 0, 1), sizeFt: r1(clamp(p.sizeFt || 1, 0.3, Math.min(9, Math.max(0.3, maxFt)))) };
  });

  const art = (Array.isArray(d.art) ? d.art : []).slice(0, 6).map((a) => {
    const wallIn = L(a.wall) * 12;
    const widthIn = clamp(a.widthIn || 24, 6, Math.max(6, Math.min(96, wallIn)));
    const heightIn = clamp(a.heightIn || 24, 6, Math.max(6, Math.min(96, dims.ceilingFt * 12 - 12)));
    const half = widthIn / 2 / wallIn;
    const centerFt = clamp(a.centerFt, heightIn / 24 + 0.5, Math.max(heightIn / 24 + 0.5, dims.ceilingFt - heightIn / 24 - 0.2));
    return { ...a, t: clamp(a.t, Math.min(half, 0.5), Math.max(1 - half, 0.5)), widthIn: r1(widthIn), heightIn: r1(heightIn), centerFt: r1(centerFt) };
  });

  const rug = d.rug && d.rug.present
    ? {
        ...d.rug,
        lengthFt: r1(clamp(d.rug.lengthFt || 4, 2, Math.max(2, Math.min(14, Math.max(dims.widthFt, dims.depthFt) - 1)))),
        widthFt: r1(clamp(d.rug.widthFt || 2.5, 1.5, Math.max(1.5, Math.min(10, Math.min(dims.widthFt, dims.depthFt) - 1)))),
      }
    : null;

  let windowTreatment = d.windowTreatment ?? 'none';
  if (windowTreatment !== 'none' && !hasWindows) { windowTreatment = 'none'; note(ctx, 'decor.windowTreatment: none — the room has no window'); }
  // seatShape / seatColorHex are the two things a photo can say about a stool
  // that `style` and `seat` cannot; an unreadable one is "not said", which is
  // the round pad in the seat material's stock colour the scene always drew.
  const stools = d.stools && typeof d.stools === 'object' && d.stools.style && d.stools.frame && d.stools.seat
    ? {
        ...d.stools,
        seatShape: d.stools.seatShape === 'round' || d.stools.seatShape === 'square' ? d.stools.seatShape : null,
        // through the same hex repair every other colour in the spec gets:
        // HexZ is deliberately loose (a bare `z.string()`) BECAUSE the
        // reconciler repairs, and the prompt asks for this one in prose
        // ("dark chocolate leather is #5A3B2A, not tan"), which is exactly
        // the wording that comes back as a colour name or '#5A3B2A (chocolate)'.
        // Unrepairable falls to null — "the seat material's own colour" —
        // never to a stock hex, which would be a colour nobody read.
        seatColorHex: parseHex(d.stools.seatColorHex),
      }
    : null;
  const items = host ? fixItems(d.items, host, shelves, ctx) : [];
  // A bathroom has no glass-front wall cabinet whose inside the twin draws —
  // a medicine cabinet is a mirror, not a vitrine — so contents stay a
  // kitchen thing even though items no longer are.
  const cabinetContents = host && allowContents ? fixCabinetContents(d.cabinetContents, host) : [];
  return { shelves, plants, art, rug, windowTreatment, counterStyling: d.counterStyling ?? 'minimal', stools, items, cabinetContents };
}

const pickWord = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);
const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * The detail layer, repaired against the room it claims to be in. An item on a
 * host that does not exist is RE-HOSTED onto the nearest thing that does, with
 * a note each time — an item silently dropped is a client's pot that vanished.
 */
function fixItems(raw: unknown, host: DecorHost, shelves: DecorSpec['shelves'], ctx: ReconcileContext): DecorItem[] {
  const list = (Array.isArray(raw) ? raw : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object').slice(0, MAX_ITEMS);
  const takenBurners = new Set<Burner>();
  const out: DecorItem[] = [];
  for (const r of list) {
    const kind = pickWord(r.kind, ITEM_KINDS, 'other');
    let on = pickWord(r.on, ITEM_HOSTS, 'counter');
    // re-hosting: the host has to exist in this room or the item has nowhere to stand
    if (on === 'range' && !host.rangeWall) { note(ctx, `decor.items: ${kind} moved off the range — the spec has no range or cooktop`); on = 'counter'; }
    if (on === 'island' && !host.hasIsland) { note(ctx, `decor.items: ${kind} moved off the island — the spec has no island`); on = 'counter'; }
    if (on === 'shelf' && !shelves.length) { note(ctx, `decor.items: ${kind} moved off the shelf — the spec has no open shelves`); on = 'counter'; }
    if (on === 'sill' && !host.windowWalls.length) { note(ctx, `decor.items: ${kind} moved off the sill — the spec has no window`); on = 'counter'; }

    const asked = pickWord(r.wall, ['back', 'left', 'right', 'front', 'island'] as const, '' as 'back');
    let wall: DecorItem['wall'];
    if (on === 'range') wall = host.rangeWall;
    else if (on === 'island') wall = 'island';
    else if (on === 'shelf') wall = (host.shelfWalls.includes(asked as Wall) ? asked : shelves[0]?.wall ?? host.longestRunWall) as Wall | null;
    else if (on === 'sill') wall = (host.windowWalls.includes(asked as Wall) ? asked : host.windowWalls[0]) as Wall | null;
    else if (on === 'floor') wall = asked && asked !== 'island' ? (asked as Wall) : null;
    else wall = (asked && asked !== 'island' && host.runWalls.has(asked as Wall) ? asked : host.longestRunWall) as Wall | null;

    const [defSize, loSize, hiSize] = ITEM_SIZE[kind];
    const material = pickWord(r.material, ITEM_MATERIALS, DEFAULT_MATERIAL[kind]);
    const sizeIn = clamp(numOr(r.sizeIn, defSize) || defSize, loSize, hiSize);
    const label = (typeof r.label === 'string' ? r.label.trim() : '').slice(0, 40) || kind.replace(/-/g, ' ');

    let depthT: number | null = null;
    if (on === 'counter' || on === 'island' || on === 'sill') {
      depthT = typeof r.depthT === 'number' && Number.isFinite(r.depthT)
        ? clamp(r.depthT, 0, 1)
        : kind === 'cutting-board' ? 0 : ITEM_BACK_OF_COUNTER.has(kind) ? 0.35 : on === 'island' ? 0.4 : 0.5;
    }
    // null means the top board of the shelf run it stands on, which is where a
    // photo puts a single object more often than not
    const board = shelves.find((sh) => sh.wall === wall) ?? shelves[0];
    const topBoard = Math.max(0, (board?.count ?? 1) - 1);
    const shelfIndex = on === 'shelf'
      ? clamp(Math.round(numOr(r.shelfIndex, topBoard)), 0, Math.min(4, topBoard))
      : null;
    let burner: Burner | null = null;
    if (on === 'range') {
      const free = BURNER_ORDER.filter((b) => (host.rangeWidthIn >= CENTRE_BURNER_MIN_IN ? true : !b.startsWith('centre')));
      const asked2 = typeof r.burner === 'string' && (free as readonly string[]).includes(r.burner) ? (r.burner as Burner) : null;
      burner = asked2 && !takenBurners.has(asked2) ? asked2 : (free.find((b) => !takenBurners.has(b)) ?? 'left-back');
      takenBurners.add(burner);
    }
    out.push({
      kind, label, on, wall,
      t: clamp(numOr(r.t, 0.5), 0, 1),
      depthT, shelfIndex, burner, sizeIn,
      colorHex: repairHex(r.colorHex, DEFAULT_COLOR[material]),
      material,
      count: ITEM_STACKABLE.has(kind) ? clamp(Math.round(numOr(r.count, 1)) || 1, 1, 12) : 1,
    });
  }
  return out;
}

/** One entry per glass-front or open wall cabinet; two entries on the same cabinet are one reading. */
function fixCabinetContents(raw: unknown, host: DecorHost): CabinetContents[] {
  const list = (Array.isArray(raw) ? raw : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object').slice(0, 10);
  const out: CabinetContents[] = [];
  for (const r of list) {
    const wall = pickWord(r.wall, ['back', 'left', 'right', 'front'] as const, host.longestRunWall ?? 'back');
    const t = clamp(numOr(r.t, 0.5), 0, 1);
    if (out.some((e) => e.wall === wall && Math.abs(e.t - t) < 0.05)) continue;
    out.push({ wall, t, kind: pickWord(r.kind, CONTENT_KINDS, 'mixed'), density: pickWord(r.density, ['sparse', 'full'] as const, 'sparse') });
  }
  return out;
}

function fixOpenings(openings: Opening[], lenFt: (w: Wall) => number, ceilingFt: number, ctx: ReconcileContext): Opening[] {
  const ids = new Set<string>();
  const out: Opening[] = [];
  openings.slice(0, 12).forEach((o, i) => {
    const L = lenFt(o.wall);
    const widthFt = clamp(o.widthFt, 0.5, L);
    const half = widthFt / 2 / L;
    const t = clamp(o.t, half, 1 - half);
    const dup = out.find((p) => p.wall === o.wall && p.kind === o.kind && Math.abs(p.t - t) < 0.02);
    if (dup) { note(ctx, `openings: dropped duplicate ${o.kind} on ${o.wall} wall`); return; }
    let id = (o.id || '').trim() || `${o.kind}-${i + 1}`;
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const sillFt = o.kind === 'window' ? clamp(o.sillFt, 0, Math.max(0, ceilingFt - 1)) : 0;
    const heightFt = clamp(o.heightFt, 0.5, Math.max(0.5, ceilingFt - sillFt));
    if (widthFt !== o.widthFt || t !== o.t) note(ctx, `openings.${id}: fitted to the ${o.wall} wall`);
    out.push({ ...o, id, t, widthFt: r1(widthFt), heightFt: r1(heightFt), sillFt: r1(sillFt) });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

const STD_WIDTHS = [36, 30, 24, 18, 15, 12, 9];

function fillBase(gapIn: number, seed = 0): BaseCabinet[] {
  const out: BaseCabinet[] = [];
  let gap = gapIn;
  let i = seed;
  while (gap >= 9 && out.length < 12) {
    const w = STD_WIDTHS.find((x) => x <= gap) ?? 9;
    const drawers = i % 2 === 1;
    out.push({ widthIn: w, type: drawers ? 'drawers' : 'door', drawerCount: drawers ? 3 : 1 });
    gap -= w;
    i++;
  }
  return out;
}

function fillUppers(gapIn: number): UpperCabinet[] {
  const out: UpperCabinet[] = [];
  let gap = gapIn;
  while (gap >= 9 && out.length < 12) {
    const w = STD_WIDTHS.find((x) => x <= gap) ?? 9;
    out.push({ widthIn: w, type: 'door', heightIn: null });
    gap -= w;
  }
  return out;
}

const PLAIN_BASE = new Set(['door', 'drawers', 'open']);

/** Trims/pads a cabinet list so its width matches `lengthIn` (±6%). */
function fitCabinets<T extends { widthIn: number; type: string }>(cabs: T[], lengthIn: number, filler: (gap: number, seed: number) => T[], isPlain: (c: T) => boolean): T[] {
  let out = cabs.map((c) => ({ ...c, widthIn: clamp(r3(c.widthIn) || 9, 9, 48) }));
  if (!out.length) return filler(lengthIn, 0);
  let sum = sumW(out);
  while (sum > lengthIn * 1.06 && out.length > 1) {
    let idx = -1;
    for (let i = out.length - 1; i >= 0; i--) if (isPlain(out[i])) { idx = i; break; }
    // nothing plain left to drop: the rest are the widths of real objects, and
    // a run of a dishwasher gap and a sink base asked to be 4 ft long is the
    // wrong LENGTH, not a row with a spare cabinet in it. `refitRun` grows the
    // run back to its carpentry (and only the WALL may overrule that).
    if (idx < 0) break;
    out.splice(idx, 1);
    sum = sumW(out);
  }
  // …but a lone FIXED box is the width of the appliance that fills it: a run
  // with nothing but a 36" dishwasher gap cannot be 33" long, and shaving the
  // gap to fit is the lie `absorbRow` refuses (the run grows back instead).
  if (out.length === 1 && out[0].widthIn > lengthIn && isPlain(out[0])) out = [{ ...out[0], widthIn: clamp(r3(lengthIn) || 9, 9, 48) }];
  sum = sumW(out);
  if (sum < lengthIn * 0.9) out.push(...filler(lengthIn - sum, out.length));
  return out;
}

/** The cabinet module every width snaps to (`r3`), and the range a real box lives in. */
const CAB_MODULE_IN = 3;
/** Mirrors `CabinetRunZ.base[].widthIn` — a 6" door and a 60" door are both fictions. */
const CAB_MIN_IN = 9;
const CAB_MAX_IN = 48;
/** Half a module: below this the row IS the run — one `r3` snap cannot express the difference. */
const ROW_EXACT_IN = CAB_MODULE_IN / 2;
/** Ceiling on boxes this file will ADD to a row (a 40 ft run of 9" doors is not a kitchen). */
const ROW_MAX_BOXES = 24;

/**
 * Move a row's widths onto `targetIn`, holding the fixed members.
 *
 * Extracted from the tier-2 block below, which is where this was written and
 * fuzzed (400 rows over client-tan's 13.6 ft back run): each pass hands the
 * whole difference to the boxes that still have ROOM under the clamp, so only
 * a box that reaches the clamp sits out the next one — a single proportional
 * pass pins the widest door and leaves the rest of the difference on the
 * floor. Then, because widths snap to the 3" module, one module of difference
 * spread over four doors rounds away on all four: the second pass hands what
 * the spread could not place to single boxes, a module at a time.
 *
 * `isPlain` is the row's flexible members. An `appliance-gap` is the width of
 * the appliance that fills it, a `sink-base` is sized to its sink and a corner
 * is a corner — none of them may move, so a row whose fixed members alone miss
 * the target comes back missing it (the caller decides what that means).
 */
function settleRow<T extends { widthIn: number }>(row: T[], targetIn: number, isPlain: (c: T) => boolean): T[] {
  const out = row.slice();
  for (let pass = 0; pass < 4; pass++) {
    const residue = targetIn - sumW(out);
    if (Math.abs(residue) <= 0.01) return out;
    const room = out.map((c) => (!isPlain(c) ? 0 : residue > 0 ? CAB_MAX_IN - c.widthIn : c.widthIn - CAB_MIN_IN));
    const total = room.reduce((a, b) => a + b, 0);
    if (total <= 0.01) break;
    const move = Math.min(Math.abs(residue), total) * Math.sign(residue);
    const before = sumW(out);
    for (let i = 0; i < out.length; i++) {
      if (room[i] <= 0) continue;
      out[i] = { ...out[i], widthIn: clamp(r3(out[i].widthIn + move * (room[i] / total)), CAB_MIN_IN, CAB_MAX_IN) };
    }
    if (sumW(out) === before) break;
  }
  for (let i = 0; i < out.length; i++) {
    const residue = targetIn - sumW(out);
    if (Math.abs(residue) <= 0.01) break;
    if (!isPlain(out[i])) continue;
    out[i] = { ...out[i], widthIn: clamp(r3(out[i].widthIn + residue), CAB_MIN_IN, CAB_MAX_IN) };
  }
  return out;
}

/**
 * Make a row of cabinets follow a run whose LENGTH moved under it — the fit
 * stretches `runs[].lengthFt` on its own, and a freed run that stretches while
 * its boxes do not draws 13.5 ft of cabinet in a 15 ft run (and bills for
 * 13.5). `check-photo-fidelity` §1.3 is the assertion that says so.
 *
 * Resolution order, widest lever last so the answer stays the client's:
 *  1. WIDTHS — `settleRow` spreads the difference over the flexible boxes.
 *  2. COUNT — every flexible box at 48" and still a whole cabinet short is a
 *     MISSING BOX; every one down at 9" and still a cabinet over is one box
 *     too many. `fitCabinets` reaches for this first and coarsely; here it is
 *     the fallback, so a resized run keeps the cabinets the photo showed.
 *  3. REFUSE — when the fixed members alone overrun the new length there is no
 *     honest row: the caller is told, and `refitRun` grows the run back to the
 *     carpentry rather than emitting a run its own boxes contradict.
 *
 * A shortfall under one cabinet (< 9") is left alone on purpose: that is a
 * FILLER, which is real carpentry and what the row solver already draws.
 *
 * Idempotent by construction — the last pass leaves |residue| within half a
 * module, and `r3(w ± 1.5)` is `w`, so a second call changes nothing.
 */
function absorbRow<T extends { widthIn: number }>(
  row: T[],
  targetIn: number,
  isPlain: (c: T) => boolean,
  filler: (gap: number, seed: number) => T[],
): { row: T[]; refused: boolean } {
  let out = row.slice();
  // one iteration per box the row can gain or lose, plus a settle each time
  for (let i = 0; i < 8; i++) {
    out = settleRow(out, targetIn, isPlain);
    const residue = targetIn - sumW(out);
    if (residue >= CAB_MIN_IN && out.length < ROW_MAX_BOXES) {
      const added = filler(residue, out.length).slice(0, ROW_MAX_BOXES - out.length);
      if (!added.length) break;
      out.push(...added);
      continue;
    }
    if (-residue >= CAB_MIN_IN && out.length > 1) {
      let idx = -1;
      for (let k = out.length - 1; k >= 0; k--) if (isPlain(out[k])) { idx = k; break; }
      if (idx < 0) break;
      out.splice(idx, 1);
      continue;
    }
    break;
  }
  // only an OVERRUN is a refusal: the row cannot be made to fit inside the
  // length, so the length is the thing that is wrong. Coming up short is a
  // filler, not a lie.
  return { row: out, refused: sumW(out) - targetIn > ROW_EXACT_IN };
}

/**
 * A tenth of the run — `check-photo-fidelity` §1.3's own tolerance, i.e. the
 * width the twin may draw as filler before it is drawing a missing cabinet.
 */
const ROW_SLACK = 0.1;

/**
 * Did this row's length move out from under it? Two lines, and a row past
 * EITHER has lost or gained a cabinet rather than a filler panel: ONE CABINET
 * in absolute terms, and a tenth of the run for the short runs where one
 * cabinet is most of it (a 30" door in a 36" run is 17% of nothing there).
 *
 * Under both, the row is left exactly as written: a run that misses its own
 * length by less than the narrowest box ends in a filler, which is real
 * carpentry and is what the analyzer writes — client-marble's left run has
 * been 6" short of its own 9.5 ft since the day it was measured. So every spec
 * that reconciles clean today comes out of here bit-identical, and only a run
 * the FITTER stretched gets its boxes rebuilt.
 */
function rowLengthMoved<T extends { widthIn: number }>(row: T[], targetIn: number): boolean {
  const sum = sumW(row.map((c) => ({ widthIn: clamp(r3(c.widthIn) || CAB_MIN_IN, CAB_MIN_IN, CAB_MAX_IN) })));
  const off = Math.abs(sum - targetIn);
  return targetIn > 0 && (off >= CAB_MIN_IN || off > targetIn * ROW_SLACK);
}

function uppersFromBase(base: BaseCabinet[]): UpperCabinet[] {
  return base.map((c) => {
    if (c.type === 'appliance-gap') return { widthIn: c.widthIn, type: c.widthIn >= 33 ? 'appliance-gap' : c.widthIn >= 27 ? 'hood-gap' : 'door', heightIn: null } as UpperCabinet;
    if (c.type === 'corner') return { widthIn: c.widthIn, type: 'corner', heightIn: null };
    if (c.type === 'open') return { widthIn: c.widthIn, type: 'open-shelf', heightIn: null };
    return { widthIn: c.widthIn, type: 'door', heightIn: null };
  });
}

/**
 * `follow` — rebuild the rows onto the run's length (see `absorbRow`). OFF by
 * default, and deliberately: `reconcileSpec` runs on every spec that enters the
 * app, including inside `fitToPhoto`, which judges the reconciler's whole spec
 * against the photo and throws ALL of it away when it draws worse. Refitting
 * rows there flipped that verdict on client-shelves and cost the fixture its
 * §1.3 row — so the rule is opt-in, through `setRunLength` / `followRunLengths`,
 * for the callers that actually moved a length.
 */
function refitRun(run: CabinetRun, wallLen: number, ctx: ReconcileContext, follow = false) {
  run.lengthFt = clamp(run.lengthFt, 1, wallLen);
  // `lengthFt` is written to a tenth of a foot (the `r1` below), so a row that
  // FOLLOWS the length has to be fitted to the length the run will DECLARE,
  // not the raw one it was asked for. Rounding afterwards moved the target out
  // from under the row it had just settled: client-tan/run-left asked for
  // 2.75 ft read its trigger against 33.0in, wrote a 2.8 ft (33.6in) run, and
  // the next call at 2.8 ft rebuilt the row the first one had left alone.
  // Round FIRST and the trigger, the row and the declared length are one
  // number — which is the whole of `setRunLength`'s idempotence.
  if (follow) run.lengthFt = clamp(r1(run.lengthFt), 1, wallLen);
  const isPlainBase = (c: BaseCabinet) => PLAIN_BASE.has(c.type);
  // read BEFORE the fit: after it the row is back inside the band and the
  // evidence that the length moved is gone
  const baseMoved = follow && rowLengthMoved(run.base, run.lengthFt * 12);
  run.base = fitCabinets(run.base, run.lengthFt * 12, fillBase, isPlainBase);
  if (baseMoved) {
    const before = sumW(run.base);
    const absorbed = absorbRow(run.base, run.lengthFt * 12, isPlainBase, fillBase);
    run.base = absorbed.row;
    if (Math.abs(sumW(run.base) - before) > 0.01) {
      note(ctx, `runs.${run.id}: ${run.base.length} base cabinet${run.base.length === 1 ? '' : 's'} refitted to a ${r1(run.lengthFt)}ft run (${r1(before)}in → ${r1(sumW(run.base))}in)`);
    }
  }
  const baseIn = sumW(run.base);
  if (baseIn > run.lengthFt * 12 * 1.02) {
    const grown = Math.min(wallLen, baseIn / 12);
    if (grown !== run.lengthFt) note(ctx, `runs.${run.id}: length ${r1(run.lengthFt)}ft → ${r1(grown)}ft to fit ${run.base.length} base cabinets`);
    run.lengthFt = grown;
  }
  run.lengthFt = r1(run.lengthFt);
  // LAST RESORT, and only reachable when the WALL is what stopped the grow-back
  // above — otherwise the run has just been set to the length its own boxes
  // want. A run pinned at its wall with more boxes than fit has to lose some,
  // because the alternative is cabinets through the corner.
  //
  // Plain boxes go first. A fixed member is the width of a real object, so
  // dropping one drops an APPLIANCE'S SLOT, and taking the row's last box
  // regardless of type did exactly that: client-shelves' back run at 0.7x came
  // back with one 48" gap where it had two (and with two again at 0.6x, which
  // is what marks it a bug rather than a policy).
  //
  // The band is the guarantee `fitCabinets` gave up when its trim learned to
  // `break` instead of eating a sink base: on the default path a run whose
  // boxes overrun it by more than 6% is the inconsistency that trim existed to
  // prevent, and it is now caught here, at the wall, with a `note`. Under
  // `follow` the row was settled onto the length exactly, so the line is the
  // half-module it was settled to.
  const overrunIn = follow ? run.lengthFt * 12 + ROW_EXACT_IN : run.lengthFt * 12 * 1.06;
  while (sumW(run.base) > overrunIn && run.base.length > 1) {
    let idx = -1;
    for (let i = run.base.length - 1; i >= 0; i--) if (isPlainBase(run.base[i])) { idx = i; break; }
    if (idx < 0) idx = run.base.length - 1;
    note(ctx, `runs.${run.id}: dropped a ${run.base[idx].type} — ${r1(sumW(run.base))}in of boxes on a ${r1(run.lengthFt)}ft run at the wall`);
    run.base = run.base.filter((_, i) => i !== idx);
    if (follow) run.base = absorbRow(run.base, run.lengthFt * 12, isPlainBase, fillBase).row;
  }
  run.start = clamp(run.start, 0, Math.max(0, 1 - run.lengthFt / wallLen));
  const plainUpper = (c: UpperCabinet) => c.type === 'door' || c.type === 'glass' || c.type === 'open-shelf';
  // a spec written before the per-cabinet height existed must come out of
  // reconcile valid under the strict schema, not just heal-able later
  const healUpper = (u: UpperCabinet): UpperCabinet => ({ ...u, heightIn: typeof u.heightIn === 'number' && Number.isFinite(u.heightIn) ? u.heightIn : null });
  if (!run.hasUppers) run.uppers = null;
  else {
    const src = run.uppers && run.uppers.length ? run.uppers : uppersFromBase(run.base);
    // the wall row has the same problem as the base row and takes the same
    // answer — a stretched run whose uppers stay put hangs a row that stops
    // short of the cabinets under it
    const upperMoved = follow && rowLengthMoved(src, run.lengthFt * 12);
    const fitted = fitCabinets(src, run.lengthFt * 12, (gap) => fillUppers(gap), plainUpper);
    run.uppers = (upperMoved ? absorbRow(fitted, run.lengthFt * 12, plainUpper, (gap) => fillUppers(gap)).row : fitted).map(healUpper);
  }
  // The second tier ends exactly where the first one does — two tiers that
  // disagree about where the run ends draw a stepped row nobody built. It
  // cannot exist without a first tier: a stacked run is two rows, never one
  // row hung at the top.
  if (!run.uppers || !Array.isArray(run.uppers2) || run.uppers2.length === 0) run.uppers2 = null;
  else {
    // Tier 1's ACTUAL span, not run.lengthFt*12: `fitCabinets` only trims above
    // +6% and only pads below −10%, so fitting each tier to the nominal length
    // let them settle up to 16 in apart on a 13.6 ft run. And the cap is
    // applied BEFORE the fit, so the fit targets the run with the boxes it will
    // actually keep — slicing after it let a 24-entry tier 2 fit to 163 in and
    // then ship 144.
    const span = sumW(run.uppers);
    const tier2 = fitCabinets(run.uppers2.slice(0, TIER2_MAX_BOXES), span, (gap) => fillUppers(gap), plainUpper).map(healUpper);
    // fitCabinets pads to reach the span and can push back past the cap; fold
    // the overflow into the last box we keep rather than losing the span
    if (tier2.length > TIER2_MAX_BOXES) {
      const tail = sumW(tier2.slice(TIER2_MAX_BOXES - 1));
      tier2.length = TIER2_MAX_BOXES;
      tier2[TIER2_MAX_BOXES - 1] = { ...tier2[TIER2_MAX_BOXES - 1], widthIn: clamp(r3(tail), 9, 48) };
    }
    // …and close the tolerance out on the plain boxes so the rows really do end
    // together: a gap or an appliance-gap is a fixed opening (it lines up with
    // the thing below it), a door is not. The difference goes to the doors that
    // still have ROOM under the 9–48 clamp, not to every door in proportion to
    // its width — a single proportional pass pins the widest door to the clamp
    // and leaves the rest of the difference on the floor (fuzzing tier 2 over
    // client-tan's 13.6 ft back run: 14 rows in 400 came out up to 12 in adrift
    // of tier 1, which is the stepped row this whole block exists to stop).
    // `settleRow` above IS this block, lifted so the base and tier-1 rows get
    // the same answer; the two-pass spread and the module-snap it ends on are
    // documented there.
    const settle = () => { tier2.splice(0, tier2.length, ...settleRow(tier2, span, plainUpper)); };
    settle();
    // every door is already at 48 and the row is STILL short by a whole
    // cabinet: that is a missing box, not a wrong width. fillUppers only lays
    // standard widths that fit, so it cannot overshoot; the second settle
    // hands the doors whatever is left under 9 in. What no amount of this can
    // fix is a tier 2 whose FIXED openings alone miss the span — the doors are
    // then pinned at 9 in with nothing to give (3 rows in 400 of the fuzz, all
    // 3 in out), and moving a hood-gap to close it would unline it from the
    // hood, which is worse than a 3 in step.
    const short = span - sumW(tier2);
    if (short >= 9 && tier2.length < TIER2_MAX_BOXES) {
      tier2.push(...fillUppers(short).slice(0, TIER2_MAX_BOXES - tier2.length).map(healUpper));
      settle();
    }
    run.uppers2 = tier2;
  }
  run.uppers2HeightIn = run.uppers2 && typeof run.uppers2HeightIn === 'number' && Number.isFinite(run.uppers2HeightIn)
    ? r1(clamp(run.uppers2HeightIn, TIER2_MIN_IN, TIER2_MAX_IN))
    : null;
  run.base = run.base.map((c) => ({
    ...c,
    drawerCount: c.type === 'drawers' ? (c.drawerCount && c.drawerCount > 0 ? c.drawerCount : 3) : c.type === 'door' ? (c.drawerCount ?? 1) : (c.drawerCount ?? 0),
  }));
  run.tall = run.tall.slice(0, 3).map((t) => ({ ...t, t: clamp(t.t, 0, 1), widthIn: clamp(r3(t.widthIn), 18, 48), toCeiling: typeof t.toCeiling === 'boolean' ? t.toCeiling : null }));
}

/**
 * Set a run's length and bring its cabinets with it — the one entry point for
 * anything that MOVES `runs[].lengthFt` (the photo fit, an accuracy pass, the
 * layout panel). Returns the length actually achieved, which is longer than
 * `wantFt` when the run refuses to shrink that far: the fixed members
 * (appliance gaps, the sink base, corners) are the widths of real objects, so
 * a run that cannot hold them is the wrong length, not the wrong row.
 *
 * `wallLen` is the wall's length in feet — a run never outgrows its wall.
 */
export function setRunLength(run: CabinetRun, wantFt: number, wallLen: number, ctx?: ReconcileContext): number {
  run.lengthFt = clamp(wantFt, 1, wallLen);
  refitRun(run, wallLen, ctx ?? { photoCount: 1, fixes: [] }, true);
  return run.lengthFt;
}

/**
 * The rows-follow-the-run rule ALONE, for a spec that cannot take the whole
 * reconciler: `fitToPhoto` throws its reconciled spec away wholesale when that
 * version draws further from the photo ("kept the fitted spec un-reconciled"),
 * and the fitted spec it keeps instead has runs the search stretched with
 * their cabinets left behind — 174" of boxes in a 189" run on client-shelves,
 * which `check-photo-fidelity` §1.3 reads as 12.9% off.
 *
 * This is the narrowest possible repair for that: a run whose row no longer
 * fits the length it declares — by a whole cabinet, or by a tenth of the run
 * (`rowLengthMoved`) — has its base and wall rows refitted, and NOTHING else
 * in the spec is touched: no material snapping, no appliance or sink
 * re-anchoring, none of the normalisation the fit deliberately rejected, and
 * not one run that was already honest. A length the boxes cannot make comes
 * back grown, exactly as `setRunLength` would (the run refuses to shrink past
 * its fixed members).
 *
 * Pure: the argument is untouched, and a spec with nothing to repair comes
 * back by identity, so a caller can test `followRunLengths(s) !== s`.
 */
export function followRunLengths(spec: RoomSpec): RoomSpec {
  if (spec.roomType !== 'kitchen' || !Array.isArray(spec.runs)) return spec;
  const ctx: ReconcileContext = { photoCount: 1, fixes: [] };
  let touched = false;
  const runs = spec.runs.map((run) => {
    // `rowLengthMoved` FIRST, and per run: this is the whole difference between
    // a repair and a re-reconcile. `refitRun` normalises more than the rows —
    // it re-snaps `start`, `lengthFt` and the tall cabinets' widths, and
    // `fitCabinets` inside it rewrites any row more than 6% off its run, which
    // is a tighter band than the one this function is allowed to care about.
    // Run on every run, that rebuilt rows the fit had every right to keep:
    // client-marble-items' left run went 108in → 96in when it was 7.1% off a
    // 100.8in run — a filler, real carpentry, inside §1.3's own tolerance —
    // and the fixture lost 1.0 point of proportions and 0.8 of photo match to
    // buy nothing. A run whose row still fits its length is left ALONE, object
    // identity and all, so a spec the fit deliberately kept un-reconciled
    // comes back out of here un-reconciled everywhere it was already honest.
    if (!run || !Array.isArray(run.base) || !rowLengthMoved(run.base, run.lengthFt * 12)) return run;
    const next = structuredClone(run);
    refitRun(next, wallLenFt(spec.dims, next.wall), ctx, true);
    touched = true;
    return next;
  });
  return touched ? { ...spec, runs } : spec;
}

/** Index of the base cabinet under position `relIn` (inches from the run start). */
function cabinetAt(base: Array<{ widthIn: number }>, relIn: number): number {
  let acc = 0;
  for (let i = 0; i < base.length; i++) {
    if (relIn >= acc && relIn <= acc + base[i].widthIn) return i;
    acc += base[i].widthIn;
  }
  return relIn < 0 ? 0 : base.length - 1;
}

function centreT(run: CabinetRun, idx: number, wallLen: number): number {
  const centreIn = sumW(run.base.slice(0, idx)) + run.base[idx].widthIn / 2;
  return clamp(run.start + centreIn / 12 / wallLen, 0, 1);
}

/**
 * The run on `wall` that contains (or is nearest to) position `t`. Compares
 * in 0..1 wall units on both sides — an earlier version measured the run's
 * half-length in FEET against a 0..1 t, which made every appliance snap to
 * the run whose centre in feet happened to be numerically closest, i.e. the
 * fridge run, whatever the photo said.
 */
function runOnWallNear(runs: CabinetRun[], wall: Wall, t: number, wallLen: number): CabinetRun | null {
  const onWall = runs.filter((r) => r.wall === wall);
  if (!onWall.length) return null;
  const dist = (r: CabinetRun) => {
    const a = r.start, b = Math.min(1, r.start + r.lengthFt / Math.max(0.1, wallLen));
    return t < a ? a - t : t > b ? t - b : 0;
  };
  return onWall.reduce((best, r) => (dist(r) < dist(best) ? r : best));
}

const APPLIANCE_WIDTH: Record<Appliance['kind'], [number, number, number]> = {
  fridge: [30, 48, 36], range: [24, 48, 30], cooktop: [24, 36, 30], 'wall-oven': [24, 30, 30], hood: [24, 48, 30],
  dishwasher: [18, 24, 24], microwave: [18, 30, 24], 'wine-fridge': [15, 24, 24],
};

// ---------------------------------------------------------------------------
// Inventory walls — the photo decides which wall a corner element stands on
// ---------------------------------------------------------------------------
//
// The client's complaint, verbatim: "it doesnt correctly recognize when smth
// is like u shaped or l shaped, like the fridge is on the right, like facing
// inward but it js puts it on the backwall". A fridge in the back-right corner
// reads two ways from the far right of a photo — the end of the back run or
// the start of the right wall — and the analyzer flips between them from one
// run to the next. What settles it is how the element FACES: doors seen
// turned toward the left of the frame, foreshortened, belong to a unit on the
// RIGHT wall facing into the room; a unit seen face-on stands on the wall the
// camera faces. The inventory reads that per element (`facing`), and this
// pass moves the SPEC's element — appliance or tall unit, with its gap and
// surround — onto that wall at the shared corner, giving the wall a run when
// it has none, and re-derives the layout word from the walls that carry runs.
// Only corner swaps are acted on (the two walls must meet next to where the
// spec drew the thing); any other disagreement stays a note for the fitter
// and the accuracy pass. Nothing moves without an inventory.

/** an element the annotator was only guessing at (below this) does not move anything, however it faces */
const FACING_MIN_CONFIDENCE = 0.4;
/** without a facing, a side-wall label counts only from this confidence… */
const LABEL_MIN_CONFIDENCE = 0.75;
/** …and only when the box touches the frame edge on that side (x1 > 1 − this for the right wall, x0 < this for the left) */
const FRAME_EDGE = 0.15;
/** finished panel on each side of a fridge surround / appliance opening, inches */
const SURROUND_IN = 3;
/** a run whose end is within this of a corner is treated as reaching it */
const CORNER_TOUCH_IN = 6;
/** which part of the element is turned: the words the notes use */
const FRONT_WORD: Partial<Record<PhotoElementKind, string>> = { fridge: 'doors', 'tall-cabinet': 'doors', dishwasher: 'door', 'wall-oven': 'door', microwave: 'door', range: 'front', cooktop: 'front' };

export interface PhotoWallRead {
  /** the wall the photo puts the element on */
  wall: Wall;
  /** why, in the words a note uses */
  cue: string;
  /** 'facing' = read from how the element faces (strong); 'label' = its wall label at the frame edge (weaker) */
  by: 'facing' | 'label';
}

/**
 * The wall an element stands on according to the photo, or null when the
 * photo has no usable say. Facing wins: a front turned toward the left of the
 * frame is on the wall to the camera's right, face-on is the wall the camera
 * looks at (`lookingAt`, 'back' by convention). Without a facing, a side-wall
 * label is trusted only when the annotator was sure AND the box touches that
 * edge of the frame — the frame edge is where a side wall shows. 'edge' says
 * nothing about the wall and never moves anything.
 */
export function photoWallOf(e: PhotoElement, lookingAt: Wall = 'back'): PhotoWallRead | null {
  const look = isRingWall(lookingAt) ? lookingAt : 'back';
  if (e.facing && e.facing !== 'edge') {
    if (e.confidence < FACING_MIN_CONFIDENCE) return null;
    // WALL_RING turns to the right: a front seen turned toward the LEFT of the frame belongs to the wall on the camera's RIGHT
    const wall = e.facing === 'front' ? look : e.facing === 'left' ? rotateWall(look, 1) : rotateWall(look, -1);
    const part = FRONT_WORD[e.kind] ?? 'front';
    const cue = e.facing === 'front' ? 'it is seen face-on in the photo' : `its ${part} ${part.endsWith('s') ? 'are' : 'is'} seen turned into the room, toward the ${e.facing} of the frame`;
    return { wall, cue, by: 'facing' };
  }
  if (e.facing === null && (e.wall === 'left' || e.wall === 'right') && e.confidence >= LABEL_MIN_CONFIDENCE) {
    const atEdge = e.wall === 'right' ? e.box.x1 > 1 - FRAME_EDGE : e.box.x0 < FRAME_EDGE;
    if (atEdge) return { wall: e.wall, cue: `the photo labels it on the ${e.wall} wall, at the ${e.wall} edge of the frame`, by: 'label' };
  }
  return null;
}

/** A spec element paired with its photo element and where the photo puts it — a conflict when that is another wall. */
export interface WallConflict {
  kind: PhotoElementKind;
  /** 'fridge', 'range', 'pantry', 'wall oven' — for notes */
  what: string;
  /** where the spec draws it */
  specWall: Wall;
  specT: number;
  widthIn: number;
  /** where the photo says it stands, and why */
  photoWall: Wall;
  read: PhotoWallRead;
  element: PhotoElement;
  /** the two walls meet at a corner next to where the spec drew it — the only kind of disagreement that is acted on */
  corner: boolean;
  /** the spec item: an appliance by index, or a pantry tall unit by run id (re-found by position when moved) */
  target: { appliance: number } | { run: string; kind: 'pantry' };
}

/** position of a tall unit along its wall (0..1), from its start fraction of the run */
const tallCentreT = (run: CabinetRun, tall: CabinetRun['tall'][number], wallLen: number) =>
  clamp(run.start + (tall.t * run.lengthFt * 12 + tall.widthIn / 2) / 12 / wallLen, 0, 1);

/** an inventory tall-cabinet box that is really the fridge surround or an oven tower (those move with their appliance) */
const isApplianceTower = (label: string) => /fridge|refrigerator|surround|oven/i.test(label);

/**
 * Every appliance and pantry in the spec that has an inventory counterpart
 * with a usable wall read (see `photoWallOf`), agreeing or not. Pure: reads
 * the spec, edits nothing. Elements are paired by kind (range and cooktop
 * are one family), the surest box first; the hood is skipped because it
 * follows the range, and a fridge surround / oven tower is skipped because it
 * moves with its appliance. The inventory's labels are read in the spec's
 * frame (a turned inventory is rotated first, exactly as
 * `reconcileElementWalls` does), while `facing` is relative to the camera
 * and needs no rotation.
 */
export function inventoryWallReads(spec: RoomSpec): WallConflict[] {
  if (spec.roomType !== 'kitchen') return [];
  const raw = reconcileElements(spec.detected?.elements, undefined, cameraEyeFt(spec.detected?.camera));
  if (!raw.length) return [];
  const k = spec;
  const framed: KitchenSpec = { ...k, openings: Array.isArray(k.openings) ? k.openings : [], decor: k.decor ?? emptyDecor(), detected: { ...k.detected, elements: raw } };
  const elements = reconcileElementWalls(framed, detectedFrame(k)).elements;
  const lookingAt = k.detected?.camera?.lookingAt ?? 'back';
  const W = (wall: Wall) => wallLenFt(k.dims, wall);
  const used = new Set<string>();
  const take = (kinds: PhotoElementKind[], accept: (e: PhotoElement) => boolean = () => true): PhotoElement | null => {
    const cands = elements.filter((e) => kinds.includes(e.kind) && !used.has(e.id) && accept(e)).sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
    if (!cands.length) return null;
    used.add(cands[0].id);
    return cands[0];
  };
  const out: WallConflict[] = [];
  const consider = (element: PhotoElement | null, kind: PhotoElementKind, what: string, specWall: Wall | 'island', specT: number, widthIn: number, target: WallConflict['target']) => {
    if (!element || !isRingWall(specWall)) return;
    const read = photoWallOf(element, lookingAt);
    if (!read) return;
    out.push({ kind, what, specWall, specT, widthIn, photoWall: read.wall, read, element, corner: read.wall !== specWall && cornerNeighbour(specWall, specT) === read.wall, target });
  };
  k.appliances.forEach((a, i) => {
    if (a.kind === 'hood' || a.kind === 'wine-fridge') return;
    const kinds: PhotoElementKind[] = a.kind === 'range' || a.kind === 'cooktop' ? ['range', 'cooktop'] : [a.kind];
    consider(take(kinds), a.kind, a.kind === 'wall-oven' ? 'wall oven' : a.kind, a.wall, a.t, a.widthIn, { appliance: i });
  });
  for (const run of k.runs) {
    for (const t of run.tall) {
      if (t.kind !== 'pantry') continue;
      consider(take(['tall-cabinet'], (e) => !isApplianceTower(e.label)), 'tall-cabinet', 'pantry', run.wall, tallCentreT(run, t, W(run.wall)), t.widthIn, { run: run.id, kind: 'pantry' });
    }
  }
  return out;
}

/** The reads whose photo wall is not the spec's wall — what the notes, the accuracy pass and the corner moves act on. */
export function inventoryWallConflicts(spec: RoomSpec): WallConflict[] {
  return inventoryWallReads(spec).filter((r) => r.photoWall !== r.specWall);
}

/** The layout word for the walls that carry cabinetry: 1 wall, 2 opposite, 2 adjacent, 3 or more. */
export function layoutForRuns(runs: ReadonlyArray<Pick<CabinetRun, 'wall'>>): KitchenLayout {
  const walls = new Set(runs.map((r) => r.wall));
  if (walls.size <= 1) return 'single-wall';
  if (walls.size === 2) return (walls.has('back') && walls.has('front')) || (walls.has('left') && walls.has('right')) ? 'galley' : 'l-shaped';
  return 'u-shaped';
}

export interface WallMove {
  what: string;
  from: Wall;
  to: Wall;
  /** where it now sits along its new wall */
  t: number;
  /** the run it now belongs to, and whether that run was created for it */
  runId: string;
  created: boolean;
  cue: string;
}

type CornerEnd = 'lo' | 'hi';
/** the end of `wall` (t 0 = 'lo', t 1 = 'hi') at which it meets `neighbour`, or null when they do not meet */
function cornerEndOf(wall: Wall, neighbour: Wall): CornerEnd | null {
  return cornerNeighbour(wall, 0) === neighbour ? 'lo' : cornerNeighbour(wall, 1) === neighbour ? 'hi' : null;
}
/** a run's span along its wall in inches from the wall's t 0 end */
const runSpanIn = (run: CabinetRun, wallLen: number): [number, number] => [run.start * wallLen * 12, run.start * wallLen * 12 + run.lengthFt * 12];
const touchesEnd = (run: CabinetRun, wallLen: number, end: CornerEnd) => {
  const [a, b] = runSpanIn(run, wallLen);
  return end === 'lo' ? a <= CORNER_TOUCH_IN : wallLen * 12 - b <= CORNER_TOUCH_IN;
};
/**
 * Shortens a run at one end by `inches`, cutting the cabinets at that end
 * (a plain box shrinks to no less than 9in or goes; a corner box too, since
 * the corner is what the moved unit takes; an appliance gap or a sink base
 * stops the cut) so the other cabinets — and the appliances whose `t` sits
 * on them — stay where they were. The run's far end never moves.
 */
function trimRunEnd(run: CabinetRun, end: CornerEnd, inches: number, wallLen: number) {
  const aligned = Boolean(run.uppers && run.uppers.length === run.base.length);
  let need = inches;
  while (need > 0 && run.base.length > 1) {
    const i = end === 'lo' ? 0 : run.base.length - 1;
    const cab = run.base[i];
    if (!PLAIN_BASE.has(cab.type) && cab.type !== 'corner') break;
    if (cab.widthIn - need >= 9) {
      cab.widthIn = r3(cab.widthIn - need) || 9;
      if (cab.type === 'corner') cab.type = 'door';
      if (aligned) run.uppers![i].widthIn = cab.widthIn;
      need = 0;
    } else {
      need -= cab.widthIn;
      run.base.splice(i, 1);
      if (aligned) run.uppers!.splice(i, 1);
    }
  }
  const lengthFt = r1(Math.max(1, run.lengthFt - inches / 12));
  if (end === 'lo') run.start = clamp(run.start + (run.lengthFt - lengthFt) / wallLen, 0, 1);
  run.lengthFt = lengthFt;
}

/**
 * Moves every corner-conflicting appliance / pantry onto the wall the photo
 * shows it on (see `inventoryWallConflicts`). For each move: the item's gap
 * and surround leave the run the spec drew them in (the run shrinks to the
 * cabinets it keeps, is dropped when nothing is left, and is pulled back a
 * base depth from the corner so the moved unit owns the corner); then the
 * photo's wall gets the unit at the shared corner — inserted into a run that
 * already reaches that corner, or in a new `run-<wall>` of the unit's width
 * plus its surround. Right wall: t runs 0 at the back corner; left wall: 1.
 * `layout` is re-derived from the walls that now carry runs. Hands back the
 * same object when there is nothing to move — an empty inventory, no corner
 * conflict, or no room at the corner — so callers can test identity.
 */
export function applyInventoryWalls(spec: RoomSpec, ctx?: ReconcileContext): { spec: RoomSpec; moved: WallMove[]; notes: string[] } {
  const untouched = { spec, moved: [] as WallMove[], notes: [] as string[] };
  if (spec.roomType !== 'kitchen' || !Array.isArray(spec.runs) || !spec.runs.length) return untouched;
  const reads = inventoryWallReads(spec);
  const conflicts = reads.filter((c) => c.corner);
  // same wall, wrong END: a side-wall unit whose box adjoins the back wall's span in the photo stands at the back
  // corner; the spec has it nearer the front (right wall: t runs 0 at the back; left wall: 1). Only a run that is the
  // unit plus its fillers is turned round — along a long run the fitter decides where the unit sits.
  const frame = detectedFrame(spec);
  const flips = frame ? reads.filter((r) => {
    if (!('appliance' in r.target) || r.photoWall !== r.specWall || (r.specWall !== 'left' && r.specWall !== 'right')) return false;
    // adjoining = nothing of the unit's own size fits between it and the back wall's edge (its surround panel and the
    // perspective put a fridge BODY 3–4% of the frame past the wall's edge on the client photo, so a fixed slack is too tight)
    const slack = Math.max(0.03, 0.75 * (r.element.box.x1 - r.element.box.x0));
    const adjoins = r.specWall === 'right' ? r.element.box.x0 <= frame.backWallSpansX[1] + slack : r.element.box.x1 >= frame.backWallSpansX[0] - slack;
    return adjoins && (r.specWall === 'right' ? r.specT > 0.5 : r.specT < 0.5);
  }) : [];
  if (!conflicts.length && !flips.length) return untouched;
  const k = structuredClone(spec);
  const W = (wall: Wall) => wallLenFt(k.dims, wall);
  const moved: WallMove[] = [];
  const notes: string[] = [];
  const say = (msg: string) => { notes.push(`inventory: ${msg}`); if (ctx) note(ctx, `inventory: ${msg}`); };

  for (const c of conflicts) {
    const end = cornerEndOf(c.photoWall, c.specWall);
    if (!end) continue;
    const toLen = W(c.photoWall);
    const fromLen = W(c.specWall);
    const isTall = 'run' in c.target;
    // a pantry is its own box; an appliance gets finished panels either side
    const unitIn = isTall ? c.widthIn : c.widthIn + 2 * SURROUND_IN;
    const lengthFt = r1(unitIn / 12);
    if (lengthFt > toLen) { say(`${c.what}: the photo shows it on the ${c.photoWall} wall, which is too short for it — left on the ${c.specWall} wall`); continue; }
    // the run on the photo's wall that already reaches the shared corner, if any; otherwise the corner must be free
    const host = k.runs.find((r) => r.wall === c.photoWall && touchesEnd(r, toLen, end)) ?? null;
    if (!host) {
      const span: [number, number] = end === 'lo' ? [0, unitIn] : [toLen * 12 - unitIn, toLen * 12];
      const blocked = k.runs.some((r) => { if (r.wall !== c.photoWall) return false; const [a, b] = runSpanIn(r, toLen); return a < span[1] - 1 && b > span[0] + 1; });
      if (blocked) { say(`${c.what}: the photo shows it on the ${c.photoWall} wall, but that wall's run leaves no room at the ${c.specWall} corner — left on the ${c.specWall} wall`); continue; }
    }

    // --- out of the run the spec drew it in
    const source = runOnWallNear(k.runs, c.specWall, c.specT, fromLen);
    if (source) {
      let removedIn = 0;
      let removedAtStart = false;
      const nearestTall = (kind: CabinetRun['tall'][number]['kind']) => {
        let best = -1, bestD = Infinity;
        source.tall.forEach((t, i) => { if (t.kind !== kind) return; const d = Math.abs(tallCentreT(source, t, fromLen) - c.specT); if (d < bestD) { bestD = d; best = i; } });
        return best;
      };
      if (isTall) {
        const i = nearestTall('pantry');
        if (i >= 0) { removedIn += source.tall[i].widthIn; source.tall.splice(i, 1); }
      } else {
        const applianceIdx = (c.target as { appliance: number }).appliance;
        const companion = c.kind === 'fridge' ? 'fridge-surround' : c.kind === 'wall-oven' ? 'oven-tower' : null;
        let companionFound = false;
        if (companion) { const i = nearestTall(companion); if (i >= 0) { source.tall.splice(i, 1); companionFound = true; } }
        // its appliance gap: the cabinet under it (or the one beside it) when that is a gap of about its width. Another
        // appliance whose t drifted onto that gap does not own it when the gap sits under the moved unit's own surround
        // or is the only cabinet of the run (the analyzer put the marble range's t inside the fridge run).
        const relIn = (c.specT - source.start) * fromLen * 12;
        const at = cabinetAt(source.base, relIn);
        const ownGap = companionFound || source.base.length === 1;
        const claimed = new Set<number>();
        if (!ownGap) k.appliances.forEach((a, i) => { if (i !== applianceIdx && a.wall === source.wall && a.kind !== 'hood' && a.kind !== 'microwave') claimed.add(cabinetAt(source.base, (a.t - source.start) * fromLen * 12)); });
        const fits = (i: number) => i >= 0 && i < source.base.length && source.base[i].type === 'appliance-gap' && Math.abs(source.base[i].widthIn - c.widthIn) <= 9 && !claimed.has(i);
        const idx = fits(at) ? at : fits(at + 1) ? at + 1 : fits(at - 1) ? at - 1 : -1;
        if (idx >= 0) {
          const aligned = Boolean(source.uppers && source.uppers.length === source.base.length);
          removedIn += source.base[idx].widthIn;
          if (idx === 0) removedAtStart = true;
          source.base.splice(idx, 1);
          if (aligned) source.uppers!.splice(idx, 1);
        }
      }
      if (!source.base.length && !source.tall.length && k.runs.length > 1) {
        k.runs.splice(k.runs.indexOf(source), 1);
        if (ctx) note(ctx, `runs.${source.id}: removed — it only held the ${c.what}, which the photo puts on the ${c.photoWall} wall`);
      } else {
        if (removedIn) {
          // the run is as long as the cabinets it keeps, so the refit adds no filler where the unit was
          const kept = source.base.length ? sumW(source.base) : Math.max(12, source.lengthFt * 12 - removedIn);
          if (removedAtStart) source.start = clamp(source.start + (source.lengthFt * 12 - kept) / 12 / fromLen, 0, 1);
          source.lengthFt = r1(Math.max(1, kept / 12));
        }
        // the moved unit owns the corner: a run still reaching it is pulled back one base depth
        const sourceEnd = cornerEndOf(c.specWall, c.photoWall);
        if (sourceEnd && touchesEnd(source, fromLen, sourceEnd)) trimRunEnd(source, sourceEnd, k.cabinets?.baseDepthIn || 24, fromLen);
      }
    }

    // --- onto the photo's wall, at the shared corner
    const tallEntry = isTall ? { widthIn: c.widthIn, kind: 'pantry' as const, toCeiling: null } : c.kind === 'fridge' ? { widthIn: unitIn, kind: 'fridge-surround' as const, toCeiling: null } : c.kind === 'wall-oven' ? { widthIn: unitIn, kind: 'oven-tower' as const, toCeiling: null } : null;
    const baseEntry: BaseCabinet = isTall ? { widthIn: c.widthIn, type: 'door', drawerCount: 1 } : { widthIn: c.widthIn, type: 'appliance-gap', drawerCount: 0 };
    let runId: string;
    let created = false;
    if (host) {
      const oldIn = host.lengthFt * 12;
      const newIn = oldIn + unitIn;
      const aligned = Boolean(host.uppers && host.uppers.length === host.base.length);
      const upperEntry: UpperCabinet = { widthIn: baseEntry.widthIn, type: isTall ? 'door' : 'appliance-gap', heightIn: null };
      if (end === 'lo') {
        host.base.unshift(baseEntry);
        if (aligned) host.uppers!.unshift(upperEntry);
        host.tall = host.tall.map((t) => ({ ...t, t: clamp((t.t * oldIn + unitIn) / newIn, 0, 1) }));
        if (tallEntry) host.tall.unshift({ t: 0, ...tallEntry });
      } else {
        host.base.push(baseEntry);
        if (aligned) host.uppers!.push(upperEntry);
        host.tall = host.tall.map((t) => ({ ...t, t: clamp((t.t * oldIn) / newIn, 0, 1) }));
        if (tallEntry) host.tall.push({ t: clamp(1 - tallEntry.widthIn / newIn, 0, 1), ...tallEntry });
      }
      host.lengthFt = r1(Math.min(toLen, newIn / 12));
      host.start = end === 'lo' ? 0 : clamp(1 - host.lengthFt / toLen, 0, 1);
      runId = host.id;
    } else {
      runId = `run-${c.photoWall}`;
      for (let n = 2; k.runs.some((r) => r.id === runId); n++) runId = `run-${c.photoWall}-${n}`;
      k.runs.push({
        id: runId, wall: c.photoWall, start: end === 'lo' ? 0 : r3d(clamp(1 - lengthFt / toLen, 0, 1)), lengthFt,
        base: [baseEntry], uppers: null, tall: tallEntry ? [{ t: 0, ...tallEntry }] : [],
        hasUppers: false, uppersToCeiling: source?.uppersToCeiling ?? false, backsplash: false, upperHeightIn: null,
      });
      created = true;
    }
    const t = r3d(clamp(end === 'lo' ? unitIn / 2 / 12 / toLen : 1 - unitIn / 2 / 12 / toLen, 0, 1));
    if (!isTall) {
      const a = k.appliances[(c.target as { appliance: number }).appliance];
      a.wall = c.photoWall;
      a.t = t;
    }
    moved.push({ what: c.what, from: c.specWall, to: c.photoWall, t, runId, created, cue: c.read.cue });
    say(`${c.what} moved to the ${c.photoWall} wall: ${c.read.cue}`);
    if (created && ctx) note(ctx, `runs.${runId}: created at the ${c.specWall} corner of the ${c.photoWall} wall for the ${c.what} (${unitIn}in with its surround)`);
  }

  for (const r of flips) {
    if (!('appliance' in r.target)) continue;
    const len = W(r.specWall);
    const run = runOnWallNear(k.runs, r.specWall, r.specT, len);
    // the run must be the unit and its fillers, nothing else (the live analyzer gave the client fridge a 36d + 12d run); along a longer run the fitter decides where it sits
    if (!run || (run.base.length > 1 && run.lengthFt * 12 > r.widthIn + 2 * SURROUND_IN + 12)) continue;
    run.start = r.specWall === 'right' ? 0 : r3d(clamp(1 - run.lengthFt / len, 0, 1));
    const a = k.appliances[r.target.appliance];
    a.t = r3d(clamp(r.specWall === 'right' ? run.lengthFt / 2 / len : 1 - run.lengthFt / 2 / len, 0, 1));
    const cue = 'its box adjoins the back wall in the photo, and the spec had it at the front end';
    moved.push({ what: r.what, from: r.specWall, to: r.specWall, t: a.t, runId: run.id, created: false, cue });
    say(`${r.what} moved to the back end of the ${r.specWall} wall: ${cue}`);
  }

  if (!moved.length) return { spec, moved, notes };
  const layout = layoutForRuns(k.runs);
  if (layout !== k.layout) {
    const walls = Array.from(new Set(k.runs.map((r) => r.wall)));
    say(`layout ${k.layout} → ${layout}: cabinets on the ${walls.join(', ')} wall${walls.length === 1 ? '' : 's'}`);
    k.layout = layout;
  }
  return { spec: k, moved, notes };
}

/** An independently boxed, front-facing row above a window cannot intersect
 * that window in 3D. Only use unambiguous coplanar observations: perspective
 * makes the vertical ordering of side-wall AABBs unsuitable for this rule. */
function reconcileUpperOpeningEdges(k: KitchenSpec, ctx: ReconcileContext): void {
  // This runs before fixDetected: old or malformed inventory must be cleaned
  // before any relationship inference reads its boxes.
  const elements = reconcileElements(k.detected?.elements, undefined, cameraEyeFt(k.detected?.camera));
  for (const run of k.runs) {
    if (!run.hasUppers || !run.uppers?.length || (run.wall !== 'back' && run.wall !== 'front')) continue;
    if (k.runs.filter(r => r.wall === run.wall && r.hasUppers && r.uppers?.length).length !== 1) continue;
    const rows = elements.filter(e => e.kind === 'upper-cabinet-run' && e.wall === run.wall && e.facing === 'front' && e.confidence >= 0.7 && !resolveOpen(e.box, e.open, e.openCause).open.bottom);
    const windows = k.openings.filter(o => o.kind === 'window' && o.wall === run.wall);
    const observedWindows = elements.filter(e => e.kind === 'window' && e.wall === run.wall && e.facing === 'front' && e.confidence >= 0.7 && !resolveOpen(e.box, e.open, e.openCause).open.top);
    // Multiple windows/rows require a perspective-aware correspondence, not
    // an index guess. The fitter can solve those without this safety check.
    if (rows.length !== 1 || windows.length !== 1 || observedWindows.length !== 1) continue;
    const row = rows[0].box, win = observedWindows[0].box, opening = windows[0];
    const overlap = Math.max(0, Math.min(row.x1, win.x1) - Math.max(row.x0, win.x0));
    if (overlap < 0.8 * (win.x1 - win.x0) || row.y1 > win.y0 + 0.015) continue;
    const headIn = (opening.sillFt + opening.heightFt) * 12;
    const bottomIn = rowBottomIn(k, run), heightIn = rowHeightIn(k, run);
    const runStart = run.start * wallLenFt(k.dims, run.wall);
    const openingStart = opening.t * wallLenFt(k.dims, run.wall) - opening.widthFt / 2;
    if (openingStart + opening.widthFt < runStart || openingStart > runStart + run.lengthFt) continue;
    if (bottomIn >= headIn - 0.5 || bottomIn + heightIn <= opening.sillFt * 12) continue;
    const availableIn = k.dims.ceilingFt * 12 - (k.cabinets.crown ? 3.5 : 0) - headIn;
    if (availableIn < 12) {
      note(ctx, `runs.${run.id}: photo places the upper row above ${opening.id}, but its estimated head leaves less than 12in below the ceiling; dimensions need visual refinement`);
      continue;
    }
    run.upperBottomIn = headIn;
    run.upperHeightIn = Math.min(heightIn, availableIn);
    note(ctx, `runs.${run.id}: upper underside ${r1(bottomIn)} → ${r1(headIn)}in, height ${r1(run.upperHeightIn)}in — the front-facing photo row is above ${opening.id}, not across its glass`);
  }
}

function reconcileKitchen(k: KitchenSpec, ctx: ReconcileContext): KitchenSpec {
  const W = (wall: Wall) => wallLenFt(k.dims, wall);
  k.openings = fixOpenings(k.openings, W, k.dims.ceilingFt, ctx);

  // --- runs
  const ids = new Set<string>();
  k.runs = k.runs.slice(0, 4).map((run, i) => {
    let id = (run.id || '').trim() || `run-${run.wall}`;
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    run.id = id;
    if (typeof run.upperBottomIn === 'number' && Number.isFinite(run.upperBottomIn)) {
      const ceilingIn = k.dims.ceilingFt * 12;
      run.upperBottomIn = clamp(run.upperBottomIn, 24, Math.max(24, ceilingIn - 12));
      if (typeof run.upperHeightIn === 'number' && Number.isFinite(run.upperHeightIn)) {
        run.upperHeightIn = clamp(run.upperHeightIn, 12, Math.min(60, ceilingIn - run.upperBottomIn));
      }
    }
    refitRun(run, W(run.wall), ctx);
    return run;
  });
  reconcileUpperOpeningEdges(k, ctx);
  const runWalls = new Set(k.runs.map((r) => r.wall));
  const primaryRun = k.runs.reduce((a, b) => (b.base.length > a.base.length ? b : a), k.runs[0]);
  // The layout word follows the walls that carry cabinetry (1 = single-wall, 2 opposite = galley, 2 adjacent =
  // l-shaped, 3 = u-shaped): the live analyzer wrote "l-shaped" over runs on three walls — the client's "doesnt
  // recognize u shaped" from the other side. A peninsula / g-shape is about the island, which walls cannot decide.
  if (k.layout !== 'peninsula' && k.layout !== 'g-shaped') {
    const derived = layoutForRuns(k.runs);
    if (derived !== k.layout) {
      note(ctx, `layout: ${k.layout} → ${derived} (cabinets on the ${Array.from(runWalls).join(', ')} wall${runWalls.size === 1 ? '' : 's'})`);
      k.layout = derived;
    }
  }

  // --- island
  if (k.island.present) {
    const clear = 3;
    const fx0 = k.island.rotationDeg === 0 ? k.island.lengthFt : k.island.widthFt;
    const fz0 = k.island.rotationDeg === 0 ? k.island.widthFt : k.island.lengthFt;
    const leftIn = runWalls.has('left') ? 2 : 0, rightIn = runWalls.has('right') ? 2 : 0, backIn = runWalls.has('back') ? 2 : 0, frontIn = runWalls.has('front') ? 2 : 0;
    const availX = k.dims.widthFt - leftIn - rightIn - clear * 2;
    const availZ = k.dims.depthFt - backIn - frontIn - clear * 2;
    if (availX < 2 || availZ < 1.5) {
      k.island.present = false;
      note(ctx, `island: removed — a ${r1(k.dims.widthFt)}×${r1(k.dims.depthFt)}ft room cannot fit one with 36in clearances`);
    } else {
      const fx = Math.min(fx0, availX);
      const fz = Math.min(fz0, availZ);
      if (fx !== fx0 || fz !== fz0) note(ctx, `island: shrunk to ${r1(Math.max(fx, fz))}×${r1(Math.min(fx, fz))}ft to keep clearances`);
      k.island.lengthFt = clamp(r1(k.island.rotationDeg === 0 ? fx : fz), 2, 16);
      k.island.widthFt = clamp(r1(k.island.rotationDeg === 0 ? fz : fx), 1.5, 8);
      const minX = -k.dims.widthFt / 2 + leftIn + clear + fx / 2;
      const maxX = k.dims.widthFt / 2 - rightIn - clear - fx / 2;
      const minZ = -k.dims.depthFt / 2 + backIn + clear + fz / 2;
      const maxZ = k.dims.depthFt / 2 - frontIn - clear - fz / 2;
      k.island.offset = { x: r1(clamp(k.island.offset.x, Math.min(minX, maxX), Math.max(minX, maxX))), z: r1(clamp(k.island.offset.z, Math.min(minZ, maxZ), Math.max(minZ, maxZ))) };
      k.island.seating = clamp(Math.round(k.island.seating), 0, Math.max(0, Math.floor(k.island.lengthFt / 2)));
      // KNEE ROOM, and the one place that decides it. `stoolPositions` tucks a
      // SIDE stool 3" under the front edge, so its seat only clears the carcass
      // from a 10.1" overhang up; `params.ts` floors the fitted overhang at the
      // same 12" for the same reason, and `LayoutPanel`'s slider starts there so
      // a number the user sets is a number that survives. Read off the SIDE row
      // only — stools round a short end answer to `endOverhangIn` and leave the
      // seating overhang free, which is how an island with end seats alone can
      // be drawn flush the way the client's photo shows it.
      if (islandNeedsKneeRoom(k.island) && k.island.overhangIn < ISLAND_KNEE_MIN_IN) {
        note(ctx, `island: seating overhang raised ${k.island.overhangIn}" → ${ISLAND_KNEE_IN}" — a stool along the side needs that much counter to sit under`);
        k.island.overhangIn = ISLAND_KNEE_IN;
      }
    }
  }

  // --- appliances
  const counts: Partial<Record<Appliance['kind'], number>> = {};
  const kept: Appliance[] = [];
  const moveToRun = (a: Appliance, why: string) => {
    a.wall = primaryRun.wall;
    a.t = clamp(primaryRun.start + primaryRun.lengthFt / 2 / W(primaryRun.wall), 0, 1);
    note(ctx, `appliances.${a.kind}: moved to the ${a.wall} wall (${why})`);
  };
  for (const a of k.appliances) {
    const n = counts[a.kind] ?? 0;
    if (n >= (a.kind === 'wall-oven' ? 2 : 1)) { note(ctx, `appliances: dropped extra ${a.kind}`); continue; }
    counts[a.kind] = n + 1;
    const [lo, hi, def] = APPLIANCE_WIDTH[a.kind];
    a.widthIn = Number.isFinite(a.widthIn) && a.widthIn >= lo && a.widthIn <= hi ? r3(a.widthIn) || def : def;
    a.hoodStyle = a.kind === 'hood' ? (a.hoodStyle && a.hoodStyle !== 'none' ? a.hoodStyle : 'under-cabinet') : null;
    // only a hood can carry a cabinet on it; garbage or a non-hood → null, which
    // means "by hood style" and never invents a box the photo did not show
    a.cabinetAbove = a.kind === 'hood' && (CABINET_ABOVE as readonly string[]).includes(a.cabinetAbove as string) ? a.cabinetAbove : null;
    a.fridgeStyle = a.kind === 'fridge' ? (a.fridgeStyle ?? 'french-door') : null;
    a.hasDispenser = a.kind === 'fridge' && typeof a.hasDispenser === 'boolean' ? a.hasDispenser : null;
    if (a.wall === 'island') {
      const islandOk = k.island.present && ['cooktop', 'range', 'hood', 'dishwasher', 'microwave', 'wine-fridge'].includes(a.kind);
      if (!islandOk) moveToRun(a, k.island.present ? 'not an island appliance' : 'no island');
    } else if (!runWalls.has(a.wall)) {
      moveToRun(a, `no cabinets on the ${a.wall} wall`);
    }
    kept.push(a);
  }

  // Align wall appliances to appliance gaps / tall units in their run.
  const claimedGaps = new Set<string>();
  // A slim insert hangs UNDER a cabinet — carving the row for it leaves the
  // insert dangling under a hole. Only a canopy takes the row's height.
  const hood0 = kept.find((a) => a.kind === 'hood');
  const hoodIsCanopy = !!hood0 && resolveHoodShape(hood0) !== 'slim';
  const hoodCutsUpperRow = (run: CabinetRun) => {
    if (!hoodIsCanopy || !hood0) return false;
    // A compact hood and its plain chase can finish beneath a separate high
    // cabinet row. Do not erase the observed doors in that independent row.
    const highRow = typeof run.upperBottomIn === 'number' && Number.isFinite(run.upperBottomIn);
    const observedHoodTop = typeof hood0.heightIn === 'number' && typeof hood0.aboveCounterIn === 'number'
      ? k.cabinets.baseHeightIn + k.countertop.thicknessIn + hood0.aboveCounterIn + hood0.heightIn : null;
    return !(highRow && hood0.cabinetAbove === 'panel' && observedHoodTop !== null && observedHoodTop <= rowBottomIn(k, run));
  };
  for (const a of kept) {
    if (a.wall === 'island') continue;
    const run = runOnWallNear(k.runs, a.wall, a.t, W(a.wall)) ?? primaryRun;
    const wallLen = W(run.wall);
    a.wall = run.wall;
    if (a.kind === 'fridge') {
      const tall = run.tall.find((t) => t.kind === 'fridge-surround');
      if (tall) { a.t = clamp(run.start + (tall.t * run.lengthFt * 12 + tall.widthIn / 2) / 12 / wallLen, 0, 1); continue; }
    }
    if (a.kind === 'wall-oven') {
      const tower = run.tall.find((t) => t.kind === 'oven-tower');
      if (tower) { a.t = clamp(run.start + (tower.t * run.lengthFt * 12 + tower.widthIn / 2) / 12 / wallLen, 0, 1); continue; }
    }
    if (a.kind === 'hood' || a.kind === 'microwave') continue;
    const relIn = (a.t - run.start) * wallLen * 12;
    let idx = cabinetAt(run.base, relIn);
    // A drop-in cooktop only cuts the counter. It can sit over the observed
    // drawers/doors, and need not align with a full-height appliance opening.
    // Treating it as a range erased that cabinetry and moved the hob to an
    // unrelated dishwasher/oven gap elsewhere in the run.
    if (a.kind === 'cooktop') {
      if (run.uppers?.length === run.base.length && hoodCutsUpperRow(run)) {
        const up = run.uppers[idx];
        if (up.type === 'door' || up.type === 'glass') up.type = 'hood-gap';
      }
      continue;
    }
    // not on its gap (or on one another appliance already took): an unclaimed gap of its width elsewhere in the
    // run is the one the analyzer meant — a run whose corner was just cut, or a t the analyzer dropped a run over
    const gapKey = (i: number) => `${run.id}:${i}`;
    if (run.base[idx].type !== 'appliance-gap' || claimedGaps.has(gapKey(idx))) {
      let best = -1, bestD = Infinity;
      run.base.forEach((c, i) => {
        if (c.type !== 'appliance-gap' || claimedGaps.has(gapKey(i)) || Math.abs(c.widthIn - a.widthIn) > 3) return;
        const d = Math.abs(i - idx);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) idx = best;
    }
    claimedGaps.add(gapKey(idx));
    const cab = run.base[idx];
    if (cab.type !== 'appliance-gap') {
      note(ctx, `runs.${run.id}: cabinet ${idx + 1} became an appliance gap for the ${a.kind}`);
      cab.type = 'appliance-gap';
      cab.drawerCount = 0;
      cab.widthIn = clamp(a.widthIn, 9, 48);
    } else if (Math.abs(cab.widthIn - a.widthIn) > 3) {
      cab.widthIn = clamp(a.widthIn, 9, 48);
    }
    a.t = centreT(run, idx, wallLen);
    if (run.uppers && run.uppers.length === run.base.length) {
      const up = run.uppers[idx];
      if (a.kind === 'range' && hoodCutsUpperRow(run)) { if (up.type === 'door' || up.type === 'glass') up.type = 'hood-gap'; }
      if (a.kind === 'fridge') { up.type = 'appliance-gap'; up.widthIn = cab.widthIn; }
    }
  }
  const hood = kept.find((a) => a.kind === 'hood');
  const cooking = kept.find((a) => a.kind === 'range') ?? kept.find((a) => a.kind === 'cooktop');
  if (hood && cooking) {
    if (hood.wall !== cooking.wall || Math.abs(hood.t - cooking.t) > 0.005) note(ctx, 'appliances.hood: centred over the range');
    hood.wall = cooking.wall;
    hood.t = cooking.t;
    hood.widthIn = Math.max(hood.widthIn, cooking.widthIn);
    if (hood.wall === 'island') hood.hoodStyle = 'island';
    else if (hood.hoodStyle === 'island') hood.hoodStyle = 'chimney';

    // THE HOOD SAFETY NET (see `hoodCabinetNet`). The client's oldest
    // complaint: their photo shows a slim insert with a two-door cabinet
    // sitting on it, and the analyzer answered `cabinetAbove: 'none'` —
    // explicitly, which also locks the fitter out — leaving 26.5 in of bare
    // painted wall framed by cabinetry on both sides. It has to fire HERE,
    // before the fit, because the fit cannot reach an explicit word.
    const hoodRun = runForHood(k, hood);
    // …and the same condition the scene-level net carries (layout.ts): the row
    // has to run to the ceiling. It was left off here on the argument that an
    // explicit 'none' is the analyzer's mis-read and is there to be overridden,
    // but that argument is about the WORD, not about the wall: where the uppers
    // stop a foot or more below the ceiling there is bare wall over the whole
    // row and a hood in front of it is an ordinary kitchen. Measured on all
    // four fixtures, this changes nothing — client-tan's row tops out 10.6 in
    // under its ceiling and client-marble's runs to it — it just stops the net
    // reaching a kitchen ACCEPTANCE §5 never claimed.
    if (hoodRun && hood.wall !== 'island' && rowToCeilingIn(k, hoodRun) <= HOOD_NET_CEILING_IN) {
      const net = hoodCabinetNet({
        heightIn: hood.heightIn,
        aboveCounterIn: hood.aboveCounterIn,
        rowIn: rowHeightIn(k, hoodRun),
        clearanceIn: rowBottomIn(k, hoodRun) - (k.cabinets.baseHeightIn + k.countertop.thicknessIn),
        bandIn: hoodCabinetBandIn(k, hoodRun, hood),
        current: resolveCabinetAbove(hood, true),
      });
      if (net) {
        hood.cabinetAbove = net.cabinetAbove;
        note(ctx, `appliances.hood: cabinetAbove none → ${net.cabinetAbove} — ${r1(hood.heightIn as number)}in of metal in a ${r1(net.openingIn)}in opening (ratio ${net.ratio.toFixed(3)}) leaves a ${r1(net.bandIn)}in band, which is a cabinet, not bare wall`);
        if (net.slim) {
          // an insert is bolted to the cabinet above it; standing it as a
          // canopy is what put a chimney in front of the client's cabinet
          hood.hoodStyle = 'under-cabinet';
          hood.hoodShape = 'slim';
          note(ctx, `appliances.hood: ${r1(hood.heightIn as number)}in of metal at ${net.ratio.toFixed(2)} of its opening is an insert — hoodStyle → under-cabinet, hoodShape → slim`);
        } else if (resolveHoodStyle(hood) === 'chimney') {
          // A CHIMNEY runs its duct to the ceiling by definition, so "chimney"
          // and "a cabinet above it" cannot both be true. The geometry the
          // layout draws once cabinetAbove is set is a canopy built into the
          // millwork — which is what 'custom-insert' means, and its own
          // CABINET_ABOVE_DEFAULT is already 'doors'. The shape (tapered,
          // curved) is what the annotator SAW and is kept. Left contradictory,
          // the word is what the photoreal render prompt reads out, so the
          // image model was being told to draw a flue over a cabinet.
          hood.hoodStyle = 'custom-insert';
          note(ctx, `appliances.hood: a cabinet sits on it, so the metal cannot run to the ceiling — hoodStyle chimney → custom-insert (shape ${resolveHoodShape(hood)} kept)`);
        }
      }
    }
  }
  if (k.island.present) k.island.hasCooktop = kept.some((a) => a.wall === 'island' && (a.kind === 'cooktop' || a.kind === 'range'));
  k.appliances = kept;

  // --- sink
  if (k.sink.wall === 'island' && !k.island.present) {
    k.sink.wall = primaryRun.wall;
    k.sink.t = clamp(primaryRun.start + primaryRun.lengthFt / 2 / W(primaryRun.wall), 0, 1);
    note(ctx, 'sink: moved to the main run (no island)');
  }
  k.sink.widthIn = clamp(r3(k.sink.widthIn) || 33, 15, 48);
  if (k.sink.wall !== 'island') {
    const run = runOnWallNear(k.runs, k.sink.wall, k.sink.t, W(k.sink.wall)) ?? primaryRun;
    const wallLen = W(run.wall);
    k.sink.wall = run.wall;
    const relIn = (k.sink.t - run.start) * wallLen * 12;
    let idx = run.base.findIndex((c) => c.type === 'sink-base');
    if (idx >= 0) {
      let acc = 0;
      let best = idx, bestD = Infinity;
      run.base.forEach((c, i) => { if (c.type === 'sink-base') { const d = Math.abs(acc + c.widthIn / 2 - relIn); if (d < bestD) { bestD = d; best = i; } } acc += c.widthIn; });
      idx = best;
    } else {
      idx = cabinetAt(run.base, relIn);
      const cab = run.base[idx];
      if (cab.type === 'appliance-gap') {
        // never steal an appliance gap — find the nearest plain cabinet
        let near = -1, nearD = Infinity;
        run.base.forEach((c, i) => { if (PLAIN_BASE.has(c.type)) { const d = Math.abs(i - idx); if (d < nearD) { nearD = d; near = i; } } });
        if (near >= 0) idx = near;
      }
      const target = run.base[idx];
      if (target.type !== 'appliance-gap') {
        target.type = 'sink-base';
        target.drawerCount = 0;
        target.widthIn = clamp(Math.max(target.widthIn, r3(k.sink.widthIn + 3)), 9, 48);
        note(ctx, `runs.${run.id}: cabinet ${idx + 1} became the sink base`);
      }
    }
    const cab = run.base[idx];
    if (cab.type === 'sink-base') k.sink.widthIn = Math.min(k.sink.widthIn, Math.max(15, cab.widthIn - 3));
    k.sink.t = centreT(run, idx, wallLen);
    if (run.uppers && run.uppers.length === run.base.length && run.uppers[idx].type === 'hood-gap') run.uppers[idx].type = 'door';
  } else {
    k.island.hasSink = true;
  }

  // Runs may have changed width — settle lengths once more.
  for (const run of k.runs) refitRun(run, W(run.wall), ctx);

  // A per-upper `heightIn` MEANS "this ONE box is shorter than its neighbours"
  // — the layout hangs such a box from the row's top line and leaves the
  // difference as bare wall under it, over the backsplash. The analyzer wrote
  // 54 on all eight of the client's uppers, and two different readings came out
  // of that one number:
  //   * on run-back (a 54 in row) it says nothing at all;
  //   * on run-right (48 in declared, uppers-to-ceiling, so a 61 in row) it hung
  //     three doors from the crown and left 6.9 in of bare painted wall over the
  //     splash — the client's "the small top cabinets not being registered".
  // So: a height that is not SHORTER than its row carries no information, and a
  // height every cabinet in the row shares is a statement about the ROW, not
  // about any one box (that is what `upperHeightIn` is for). Both go back to
  // null, and the row is told the height where it had no better number.
  for (const run of k.runs) {
    if (!run.uppers || !run.uppers.length) continue;
    // Explicit row edges are a separate measurement from per-box heights.
    // Never erase individually observed short boxes or stretch a high band.
    if (typeof run.upperBottomIn === 'number' && Number.isFinite(run.upperBottomIn)) continue;
    const rowIn = rowHeightIn(k, run);
    const real = run.uppers.filter((u) => u.type === 'door' || u.type === 'glass' || u.type === 'open-shelf' || u.type === 'corner');
    const h0 = real.length >= 2 && real[0].heightIn;
    const uniform = typeof h0 === 'number' && Number.isFinite(h0)
      && real.every((u) => typeof u.heightIn === 'number' && Number.isFinite(u.heightIn) && Math.abs((u.heightIn as number) - h0) < 0.5)
      ? h0 : null;
    const dropped: number[] = [];
    run.uppers = run.uppers.map((u) => {
      const h = u.heightIn;
      if (typeof h !== 'number' || !Number.isFinite(h)) return u;
      if (h < rowIn - 0.5 && uniform === null) return u;
      dropped.push(h);
      return { ...u, heightIn: null };
    });
    if (!dropped.length) continue;
    const why = uniform !== null && uniform < rowIn - 0.5
      ? `every cabinet in the row declared ${r1(uniform)}in, which is the row's height, not a hang`
      : `${r1(Math.max(...dropped))}in in a ${r1(rowIn)}in row is not shorter than the row`;
    note(ctx, `runs.${run.id}: ${dropped.length} upper heightIn dropped — ${why}; the boxes fill the row instead of hanging from its top`);
    // …and where the run had no row height of its own, the number the analyzer
    // read for every box IS that row height. `uppersToCeiling` still wins.
    if (uniform !== null && !run.uppersToCeiling && (run.upperHeightIn == null || !Number.isFinite(run.upperHeightIn))) {
      run.upperHeightIn = r1(clamp(uniform, 12, Math.max(12, k.dims.ceilingFt * 12 - 60)));
      note(ctx, `runs.${run.id}: upperHeightIn → ${r1(run.upperHeightIn)}in (read off the cabinets themselves)`);
    }
  }

  // THE STACKED-UPPERS SAFETY NET — the client's second sentence, and the one
  // the round-2 contract gave a field but no producer: "i feel as tho there is
  // a problem with the small top cabinets not being registered/created."
  //
  // `runs[].uppers2` exists, the layout draws it, the estimator prices it and
  // the Layout panel can toggle it — but nothing except a hand toggle ever
  // WROTE it, so re-rendering the client's kitchen still gave one 54 in door
  // where the photo has two doors, two rows of pulls and a rail. The hood
  // defect got a net in this same function; this one, raised in the same
  // breath, got none, and the suite showed it green by seeding the field
  // itself. This is that net.
  //
  // THE EVIDENCE, and why it is not a guess. The gate is the row height the
  // ANALYZER MEASURED (`run.upperHeightIn`), never the height derived from
  // `uppersToCeiling`: a run that only says "to the ceiling" has measured
  // nothing, and 9 ft − 54 in comes out over 45 in for every such run in every
  // kitchen. A measured row of 45 in or more cannot be one box — 36 in is the
  // tallest door a stacked kitchen puts on the bottom and `STACK_MIN_ROW_IN`
  // is that plus the 9 in minimum transom — so the row is two boxes and a
  // rail, which is exactly what `resolveUppers2HeightIn` already encodes.
  //
  // Verified over every fixture we own: it fires on client-tan's run-back
  // (54.0 in) and run-right (48.0 in) — both of which the photograph shows
  // stacked, with a second row of pulls — and on NOTHING else: client-marble's
  // runs declare no row height (uppersToCeiling, so 50.5 in is derived, not
  // read), client-marble-items declares 34.0 and 42.0, client-shelves carries
  // no uppers and the demo declares none. An explicit `uppers2` from the
  // analyzer is never overridden, and an explicit empty array means one tier.
  for (const run of k.runs) {
    if (run.uppers2 != null) continue;
    // A directly observed row elevation is not evidence of two door tiers.
    if (typeof run.upperBottomIn === 'number' && Number.isFinite(run.upperBottomIn)) continue;
    if (run.hasUppers === false || !Array.isArray(run.uppers) || run.uppers.length === 0) continue;
    const declaredRow = run.upperHeightIn;
    if (typeof declaredRow !== 'number' || !Number.isFinite(declaredRow) || declaredRow < STACK_MIN_ROW_IN) continue;
    run.uppers2 = deriveUppers2(run.uppers);
    if (!run.uppers2.length) { run.uppers2 = null; continue; }
    run.uppers2HeightIn = null;
    // …and pin the new tier to tier 1's span, the same way a declared one is
    refitRun(run, W(run.wall), ctx);
    note(ctx, `runs.${run.id}: a measured ${r1(declaredRow)}in row is two tiers, not one door — seeded ${run.uppers2?.length ?? 0} transom boxes over ${run.uppers.length} (tier 2 ${r1(resolveUppers2HeightIn(declaredRow, run))}in, rail between)`);
  }

  // --- windows over the sink share its position
  if (k.sink.wall !== 'island') {
    const win = k.openings.find((o) => o.kind === 'window' && o.wall === k.sink.wall && Math.abs(o.t - k.sink.t) < 0.12);
    if (win && Math.abs(win.t - k.sink.t) > 0.005) { win.t = k.sink.t; note(ctx, `openings.${win.id}: centred over the sink`); }
  }

  // --- cabinets / materials / lighting
  k.cabinets.baseHeightIn = clamp(k.cabinets.baseHeightIn, 30, 38);
  k.cabinets.upperHeightIn = clamp(k.cabinets.upperHeightIn, 12, Math.max(12, Math.min(48, k.dims.ceilingFt * 12 - 54)));
  if (k.lighting.pendants && k.lighting.pendants.count === 0) k.lighting.pendants = null;
  // --- backsplash per run: a photo of tile behind the range with painted
  //     wall behind the side run is the norm, and tiling every run was the
  //     "backsplash is only in that one part" complaint seen from the other side
  for (const run of k.runs) if (typeof run.backsplash !== 'boolean') run.backsplash = true;
  if (k.backsplash.present && !k.runs.some((r) => r.backsplash)) {
    for (const run of k.runs) run.backsplash = true;
    note(ctx, 'backsplash: present but no run carried it — applied to every run');
  } else if (!k.backsplash.present && k.runs.some((r) => r.backsplash)) {
    k.backsplash.present = true;
    note(ctx, `backsplash: present — tile behind the ${k.runs.filter((r) => r.backsplash).map((r) => r.wall).join(' and ')} run`);
  }

  k.materials = resolveMaterials('kitchen', k.materials, k.detected, ctx);
  // The pattern word must agree with the material: a slab has no bond
  // pattern, and 'herringbone' on a slab would price herringbone labour.
  {
    const bsMat = CATALOG_BY_ID[k.materials.backsplash];
    const isSlab = bsMat && (bsMat.pbr.procedural?.kind === 'slab' || ['marble', 'quartz', 'quartzite', 'granite', 'soapstone'].includes(bsMat.category));
    if (isSlab && k.backsplash.pattern !== 'slab') { note(ctx, `backsplash.pattern: ${k.backsplash.pattern} → slab (${bsMat.name} is a slab)`); k.backsplash.pattern = 'slab'; }
    else if (!isSlab && k.backsplash.pattern === 'slab' && bsMat?.pbr.procedural?.kind === 'tile') {
      const pat = String((bsMat.pbr.procedural.options as { pattern?: string }).pattern ?? 'running-bond');
      k.backsplash.pattern = pat === 'hex' ? 'hex' : pat === 'herringbone' ? 'herringbone' : pat === 'stacked' ? 'stacked' : 'running-bond';
    }
  }
  if (!k.island.present) {
    k.materials.island_cabinets = k.materials.island_cabinets || k.materials.cabinets_base;
    k.materials.island_countertop = k.materials.island_countertop || k.materials.countertop;
  }
  // Tall units (pantry, fridge surround, oven tower) follow the cabinets
  // unless the analyzer actually read a finish off them: its catalog pick
  // alone is not evidence, and a pantry in shadow must not become a third
  // finish. The white-surround-beside-oak case arrives as an observation.
  if (!k.detected.finishes.some((f) => f.slot === 'cabinets_tall')) {
    const tall = tallCabinetFallback(k.materials as unknown as Record<string, string>);
    if (tall && tall !== k.materials.cabinets_tall) {
      const follows = tall === k.materials.cabinets_upper && tall !== k.materials.cabinets_base ? 'uppers' : 'base cabinets';
      k.materials.cabinets_tall = tall;
      note(ctx, `materials.cabinets_tall: no finish observed on the tall units — following the ${follows} (${tall})`);
    }
  }
  // One material per real surface (two readings of one oak are not a
  // two-tone kitchen), and two-tone decided by what is left after that —
  // never by the raw pair, which is what made every noisy reading two-tone.
  const unified = unifyRelatedSlots(k);
  if (unified.notes.length) {
    const u = unified.spec as KitchenSpec;
    k.materials = u.materials;
    k.cabinets.twoTone = u.cabinets.twoTone;
    for (const n of unified.notes) note(ctx, `materials.${n}`);
  }
  if (k.materials.cabinets_base !== k.materials.cabinets_upper) k.cabinets.twoTone = true;
  // --- the new degrees of freedom, clamped to what the room can hold
  if (typeof k.backsplash.heightIn === 'number' && Number.isFinite(k.backsplash.heightIn)) {
    k.backsplash.heightIn = r1(clamp(k.backsplash.heightIn, 4, Math.max(4, k.dims.ceilingFt * 12 - 38)));
    // the category word drives pricing and the render prompt; it must never
    // contradict the number the fitter measured
    const word = backsplashHeightWord(k.backsplash.heightIn);
    if (k.backsplash.height !== word) { note(ctx, `backsplash.height: ${k.backsplash.height} → ${word} (${r1(k.backsplash.heightIn)}in measured)`); k.backsplash.height = word; }
  } else k.backsplash.heightIn = null;
  k.countertop.overhangIn = typeof k.countertop.overhangIn === 'number' && Number.isFinite(k.countertop.overhangIn) ? clamp(k.countertop.overhangIn, 0, 4) : null;
  {
    const isl = k.island;
    isl.endPlacement = (['auto', 'left', 'right', 'both'] as const).includes(isl.endPlacement) ? isl.endPlacement : 'auto';
    isl.endOverhangIn = typeof isl.endOverhangIn === 'number' && Number.isFinite(isl.endOverhangIn) ? clamp(isl.endOverhangIn, 0, 18) : null;
    isl.stoolOffsetIn = typeof isl.stoolOffsetIn === 'number' && Number.isFinite(isl.stoolOffsetIn) ? clamp(isl.stoolOffsetIn, -60, 60) : 0;
    const cap = isl.endPlacement === 'both' ? 4 : 2;
    if (isl.endSeats > cap) { note(ctx, `island.endSeats: ${isl.endSeats} → ${cap} (one end seats at most two)`); isl.endSeats = cap; }
  }
  {
    // the row and the explicit hooks are two spellings of one thing; a count
    // that no longer matches the list means the list is stale, not the count
    const p = k.lighting.pendants;
    if (p && Array.isArray(p.positions)) {
      // the last stop before RoomSpecZ: a hook past ±20 ft (or a non-object in
      // the list) would 400 /api/refine and /api/render and drop the analysis to
      // the template, so every entry is clamped, not just the list's length
      const pts = p.positions
        .filter((q): q is PendantPosition => !!q && typeof q === 'object')
        .map((q) => ({ alongFt: clamp(numOr(q.alongFt, 0), -20, 20), acrossFt: clamp(numOr(q.acrossFt, 0), -10, 10) }))
        .slice(0, 12);
      if (pts.length !== p.positions.length) note(ctx, `lighting.pendants.positions: dropped ${p.positions.length - pts.length} unreadable hook${p.positions.length - pts.length === 1 ? '' : 's'}`);
      p.positions = pts.length === p.count ? pts : null;
    } else if (p) p.positions = null;
  }
  const longestRun = k.runs.reduce<CabinetRun | null>((best, r) => (!best || r.lengthFt > best.lengthFt ? r : best), null);
  const cooker = k.appliances.find((a) => (a.kind === 'range' || a.kind === 'cooktop') && a.wall !== 'island');
  // The detail layer the analysis missed. Two model calls look for the small
  // objects and only one of them writes anything the twin can DRAW: the
  // items-only inventory pass boxes every pot, board and crock it can see, and
  // those boxes were used for SCORING alone — on the client's marble kitchen
  // that was nineteen boxes against eight drawn objects. `itemsFromInventory`
  // turns the unclaimed boxes into real entries; it runs HERE, after the runs,
  // island and appliances have settled and before `fixDecor`, so a synthesised
  // entry is re-hosted, clamped and given a burner by exactly the same repair
  // the model's own entries go through.
  {
    const before = Array.isArray(k.decor?.items) ? k.decor.items.length : 0;
    const withItems = itemsFromInventory(k);
    const added = (withItems.decor?.items?.length ?? 0) - before;
    if (added > 0) {
      k.decor = withItems.decor;
      k.detected = withItems.detected;
      note(ctx, `decor.items: ${added} object${added === 1 ? '' : 's'} the photo boxes but the analysis did not describe`);
    }
  }
  k.decor = fixDecor(k.decor, k.dims, k.openings.some((o) => o.kind === 'window'), ctx, {
    rangeWall: (cooker?.wall as Wall) ?? null,
    rangeWidthIn: cooker?.widthIn ?? 30,
    hasIsland: k.island.present,
    longestRunWall: longestRun?.wall ?? null,
    shelfWalls: (Array.isArray(k.decor?.shelves) ? k.decor.shelves : []).map((sh) => sh?.wall).filter((w): w is Wall => !!w),
    windowWalls: k.openings.filter((o) => o.kind === 'window').map((o) => o.wall),
    runWalls: new Set(k.runs.map((r) => r.wall)),
  });
  k.detected = fixDetected(k.detected, ctx);
  return k;
}

// ---------------------------------------------------------------------------
// Bathroom
// ---------------------------------------------------------------------------

interface WallItem { key: 'vanity' | 'shower' | 'tub' | 'toilet'; t: number; widthIn: number }

function reconcileBathroom(b: BathroomSpec, ctx: ReconcileContext): BathroomSpec {
  const W = (wall: Wall) => wallLenFt(b.dims, wall);
  const other = (wall: Wall) => (wall === 'back' || wall === 'front' ? b.dims.depthFt : b.dims.widthFt);
  const fitT = (wall: Wall, t: number, widthIn: number) => {
    const half = widthIn / 2 / 12 / W(wall);
    return clamp(t, Math.min(half, 0.5), Math.max(1 - half, 0.5));
  };

  const v = b.vanity;
  v.widthIn = clamp(r3(v.widthIn) || 36, 18, Math.max(18, Math.min(120, W(v.wall) * 12 - 2)));
  if (v.widthIn < 48 && v.sinks === 2) { v.sinks = 1; note(ctx, 'vanity: a vanity under 48in gets one sink'); }
  v.t = fitT(v.wall, v.t, v.widthIn);

  const s = b.shower;
  s.widthIn = clamp(r3(s.widthIn) || 36, 30, Math.max(30, Math.min(120, W(s.wall) * 12)));
  s.depthIn = clamp(r3(s.depthIn) || 36, 30, Math.max(30, Math.min(96, other(s.wall) * 12 - 30)));
  s.t = fitT(s.wall, s.t, s.widthIn);

  const t = b.tub;
  t.lengthIn = clamp(r3(t.lengthIn) || 60, 48, Math.max(48, Math.min(84, W(t.wall) * 12)));
  t.t = fitT(t.wall, t.t, t.lengthIn);

  if (s.present && s.enclosure === 'tub-shower') {
    if (!t.present) note(ctx, 'tub: added an alcove tub for the tub-shower combo');
    t.present = true;
    t.kind = 'alcove';
    t.wall = s.wall;
    t.t = s.t;
    t.lengthIn = clamp(Math.max(60, s.widthIn), 48, 84);
    s.widthIn = t.lengthIn;
    s.depthIn = clamp(s.depthIn, 30, 36);
  }

  const toiletHalf = 15 / 12 / W(b.toilet.wall);
  b.toilet.t = clamp(b.toilet.t, Math.min(toiletHalf, 0.5), Math.max(1 - toiletHalf, 0.5));

  // Separate fixtures that overlap on the same wall.
  for (const wall of ['back', 'left', 'right', 'front'] as Wall[]) {
    const L = W(wall) * 12;
    const items: WallItem[] = [];
    if (v.present && v.wall === wall) items.push({ key: 'vanity', t: v.t, widthIn: v.widthIn });
    if (s.present && s.wall === wall) items.push({ key: 'shower', t: s.t, widthIn: s.widthIn });
    if (t.present && t.wall === wall && !(s.present && s.enclosure === 'tub-shower' && s.wall === wall)) items.push({ key: 'tub', t: t.t, widthIn: t.lengthIn });
    if (b.toilet.present && b.toilet.wall === wall) items.push({ key: 'toilet', t: b.toilet.t, widthIn: 30 });
    if (items.length < 2) continue;
    items.sort((a, c) => a.t - c.t);
    let cursor = 0;
    let moved = false;
    for (const it of items) {
      let start = it.t * L - it.widthIn / 2;
      if (start < cursor) { start = cursor; moved = true; }
      if (start + it.widthIn > L) { start = Math.max(cursor, L - it.widthIn); moved = true; }
      it.t = clamp((start + it.widthIn / 2) / L, 0, 1);
      cursor = start + it.widthIn + 2;
    }
    if (moved) note(ctx, `${wall} wall: fixtures spaced out so they do not overlap`);
    for (const it of items) {
      if (it.key === 'vanity') v.t = it.t;
      else if (it.key === 'shower') s.t = it.t;
      else if (it.key === 'tub') t.t = it.t;
      else b.toilet.t = it.t;
    }
  }
  if (s.present && s.enclosure === 'tub-shower') t.t = s.t;

  if (s.present && b.wallTile.height === 'none') b.wallTile.height = 'shower-only';
  b.openings = fixOpenings(b.openings, W, b.dims.ceilingFt, ctx);
  if (b.lighting.pendants && b.lighting.pendants.count === 0) b.lighting.pendants = null;

  fixBathroomDetail(b, W, ctx);

  b.materials = resolveMaterials('bathroom', b.materials, b.detected, ctx);
  // A bathroom's hosts: the vanity top is its 'counter', its shelves are open
  // shelves, its sills are sills. No range, no island — `fixItems` re-hosts
  // anything claiming one onto the vanity. `allowContents` false because a
  // bathroom has no glass-front wall cabinet the twin draws the inside of.
  const vanityWall: Wall | null = b.vanity.present ? b.vanity.wall : null;
  b.decor = fixDecor(b.decor, b.dims, b.openings.some((o) => o.kind === 'window'), ctx, {
    rangeWall: null,
    rangeWidthIn: 0,
    hasIsland: false,
    longestRunWall: vanityWall,
    shelfWalls: (Array.isArray(b.decor?.shelves) ? b.decor.shelves : []).map((sh) => sh?.wall).filter((w): w is Wall => !!w),
    windowWalls: b.openings.filter((o) => o.kind === 'window').map((o) => o.wall),
    runWalls: new Set<Wall>(vanityWall ? [vanityWall] : []),
  }, false);
  b.detected = fixDetected(b.detected, ctx);
  return b;
}

const FIXTURE_FINISHES: readonly NonNullable<BathroomSpec['shower']['hardwareFinish']>[] = [
  'chrome', 'brushed-nickel', 'polished-nickel', 'matte-black', 'brushed-gold',
  'polished-brass', 'oil-rubbed-bronze', 'stainless', 'white', 'black',
];
const TILE_PATTERNS: readonly NonNullable<BathroomSpec['wallTile']['pattern']>[] = [
  'stacked', 'running-bond', 'vertical-stack', 'herringbone', 'chevron',
  'basketweave', 'hex', 'penny', 'mosaic', 'large-format', 'slab',
];
const ACCESSORY_KINDS: readonly BathAccessory['kind'][] = [
  'towel-bar', 'towel-ring', 'hook', 'robe-hook', 'grab-bar', 'toilet-paper-holder',
  'towel-warmer', 'shower-caddy', 'corner-shelf',
];
/** the length a bar / ring / holder actually comes in, when nobody measured it */
const ACCESSORY_WIDTH_IN: Record<BathAccessory['kind'], number> = {
  'towel-bar': 24, 'towel-ring': 7, hook: 3, 'robe-hook': 3, 'grab-bar': 24,
  'toilet-paper-holder': 6, 'towel-warmer': 24, 'shower-caddy': 12, 'corner-shelf': 10,
};
/** the height one is SCREWED AT, feet — a towel bar at 4 ft, a hook at eye level, the paper holder at seat height */
const ACCESSORY_HEIGHT_FT: Record<BathAccessory['kind'], number> = {
  'towel-bar': 4, 'towel-ring': 4.2, hook: 5.4, 'robe-hook': 5.4, 'grab-bar': 3,
  'toilet-paper-holder': 2.1, 'towel-warmer': 3.5, 'shower-caddy': 4.5, 'corner-shelf': 4.5,
};

/**
 * The bathroom's detail contract, made internally consistent.
 *
 * Everything here is a field the spec could not hold until the bathroom got a
 * contract that can describe a bathroom, and every repair follows one rule:
 * a value the room CANNOT have becomes null, which means "let the scene
 * decide" and draws exactly what a spec without the field drew. Nothing is
 * invented — an unanswered field stays unanswered.
 */
function fixBathroomDetail(b: BathroomSpec, W: (wall: Wall) => number, ctx: ReconcileContext): void {
  const v = b.vanity;
  // A 24" vanity cannot have six drawers and four doors. The cap is the
  // number of 9"-minimum openings the face actually has.
  const faces = Math.max(1, Math.floor(v.widthIn / 9));
  if (typeof v.drawers === 'number') v.drawers = clamp(Math.round(v.drawers), 0, Math.min(12, faces));
  if (typeof v.doors === 'number') v.doors = clamp(Math.round(v.doors), 0, Math.min(8, faces));
  if ((v.drawers ?? 0) + (v.doors ?? 0) > faces) {
    note(ctx, `vanity: ${(v.drawers ?? 0) + (v.doors ?? 0)} fronts will not fit a ${r1(v.widthIn)}in vanity — reduced to ${faces}`);
    v.doors = Math.max(0, faces - (v.drawers ?? 0));
  }
  // A pedestal has no cabinet, so it has no fronts, no legs and no hardware.
  if (v.style === 'pedestal') {
    if (v.drawers || v.doors) note(ctx, 'vanity: a pedestal has no drawers or doors');
    v.drawers = 0;
    v.doors = 0;
    v.hardware = 'none';
  }
  // A floating vanity hangs off the wall; legs are the one thing it cannot have.
  if (v.style === 'floating' && v.legStyle && v.legStyle !== 'none') {
    note(ctx, 'vanity: a floating vanity has no legs');
    v.legStyle = 'none';
  }
  // A vessel basin sits ON the top, so the top drops to keep the rim at a
  // usable height; a 36in top under a vessel puts the rim at 42in.
  if (v.basin === 'vessel' && typeof v.heightIn === 'number' && v.heightIn > 32) {
    note(ctx, 'vanity: dropped the top to 31in for a vessel basin');
    v.heightIn = 31;
  }
  if (v.style !== 'floating' && v.openShelf) {
    note(ctx, 'vanity: only a floating vanity shows an open shelf under it');
    v.openShelf = false;
  }

  const s = b.shower;
  const glazed = s.enclosure === 'frameless-glass' || s.enclosure === 'framed-glass';
  if (!glazed) {
    // no glass, no glass thickness and no glass hardware
    s.glassThicknessIn = null;
    if (s.enclosure === 'curtain' || s.enclosure === 'open') s.doorType = 'none';
  } else if (typeof s.glassThicknessIn === 'number') {
    s.glassThicknessIn = clamp(s.glassThicknessIn, 0.12, 0.75);
  }
  if (!s.niche) s.nicheAt = null;
  else if (s.nicheAt) {
    const n = s.nicheAt;
    // the niche is cut in a stall wall, so it cannot be wider than that wall
    // nor sit above the head of the enclosure
    const faceIn = n.face === 'back' ? s.widthIn : s.depthIn;
    n.widthIn = clamp(r1(n.widthIn), 6, Math.max(6, faceIn - 6));
    n.heightIn = clamp(r1(n.heightIn), 6, 60);
    const half = n.widthIn / 2 / Math.max(1, faceIn);
    n.t = clamp(n.t, Math.min(half, 0.5), Math.max(1 - half, 0.5));
    n.centerIn = clamp(r1(n.centerIn), 12 + n.heightIn / 2, Math.max(12 + n.heightIn / 2, b.dims.ceilingFt * 12 - 6 - n.heightIn / 2));
    n.shelves = clamp(Math.round(n.shelves), 0, 4);
  }
  if (!s.bench) s.benchStyle = null;
  if (s.curbless) s.curbHeightIn = 0;
  else if (typeof s.curbHeightIn === 'number') s.curbHeightIn = clamp(s.curbHeightIn, 0, 12);
  s.hardwareFinish = pickWordOrNull(s.hardwareFinish, FIXTURE_FINISHES);

  const t = b.tub;
  // The tub has to fit ACROSS the room as well as along its wall: a 36in-wide
  // tub in a 5 ft room leaves no floor.
  const acrossIn = (t.wall === 'back' || t.wall === 'front' ? b.dims.depthFt : b.dims.widthFt) * 12;
  if (typeof t.widthIn === 'number') t.widthIn = clamp(r1(t.widthIn), 24, Math.max(24, Math.min(60, acrossIn - 18)));
  if (typeof t.heightIn === 'number') t.heightIn = clamp(r1(t.heightIn), 12, 36);
  // A tub-shower is an alcove tub with a wall diverter; a freestanding tub
  // cannot have a tiled or skirted apron because it has no wall to tile to.
  if (t.kind === 'freestanding' || t.kind === 'clawfoot') {
    if (t.apron && t.apron !== 'integral' && t.apron !== 'none') {
      note(ctx, `tub: a ${t.kind} tub has no ${t.apron} apron`);
      t.apron = 'integral';
    }
    if (t.fillerType === 'tub-shower-diverter') t.fillerType = 'floor-mount';
  }
  if (s.present && s.enclosure === 'tub-shower' && t.present && !t.fillerType) t.fillerType = 'tub-shower-diverter';
  t.fillerFinish = pickWordOrNull(t.fillerFinish, FIXTURE_FINISHES);
  b.toilet.trimFinish = pickWordOrNull(b.toilet.trimFinish, FIXTURE_FINISHES);

  const wt = b.wallTile;
  wt.pattern = pickWordOrNull(wt.pattern, TILE_PATTERNS);
  wt.showerPattern = pickWordOrNull(wt.showerPattern, TILE_PATTERNS);
  // A numeric stop line is measured from the floor and cannot pass the ceiling.
  const ceilIn = b.dims.ceilingFt * 12;
  if (typeof wt.heightIn === 'number') {
    const capped = clamp(r1(wt.heightIn), 6, ceilIn);
    if (capped !== r1(wt.heightIn)) note(ctx, `wallTile: tile height ${r1(wt.heightIn)}in capped at the ${r1(ceilIn)}in ceiling`);
    wt.heightIn = capped;
    // …and a stop line AT the ceiling is 'full', which is what the category word says
    if (wt.heightIn >= ceilIn - 2 && wt.height === 'wainscot') {
      wt.height = 'full';
      note(ctx, 'wallTile: a wainscot that reaches the ceiling is full-height tile');
    }
  }
  if (wt.height === 'none') {
    // nothing on the walls means nothing to describe about it
    wt.heightIn = null;
    wt.accent = null;
    wt.trim = null;
  }
  if (typeof wt.groutWidthIn === 'number') wt.groutWidthIn = clamp(wt.groutWidthIn, 0, 0.75);
  // A slab has no module and no grout; that is what makes it a slab.
  if (wt.pattern === 'slab') { wt.moduleIn = null; wt.groutWidthIn = 0; }
  if (wt.accent) {
    const a = wt.accent;
    a.pattern = pickWord(a.pattern, TILE_PATTERNS, wt.pattern ?? 'stacked');
    a.wall = pickWord(a.wall, ['back', 'left', 'right', 'front'] as const, 'back');
    if (typeof a.heightIn === 'number') a.heightIn = clamp(r1(a.heightIn), 12, ceilIn);
    a.colorHex = parseHex(a.colorHex);
    // An accent wall in the SAME pattern and no colour of its own is not an
    // accent — it is the field tile, and drawing it as an accent would only
    // put a seam in the middle of a wall.
    if (a.pattern === wt.pattern && !a.colorHex && a.moduleIn === null) {
      note(ctx, 'wallTile.accent: dropped — it is the same tile as the rest of the room');
      wt.accent = null;
    }
  }
  if (wt.height === 'accent-wall' && !wt.accent) {
    // the legacy meaning of the category word, made explicit: the vanity wall,
    // in the field tile, to the ceiling
    wt.accent = { wall: b.vanity.present ? b.vanity.wall : 'back', pattern: wt.pattern ?? 'stacked', moduleIn: wt.moduleIn ?? null, heightIn: null, colorHex: null };
  }

  // Accessories: on a wall, at a height a person can reach, not through a door.
  const raw = Array.isArray(b.accessories) ? b.accessories : [];
  const acc: BathAccessory[] = [];
  for (const r of raw.slice(0, 10)) {
    if (!r || typeof r !== 'object') continue;
    const kind = pickWord(r.kind, ACCESSORY_KINDS, 'towel-bar');
    const wall = pickWord(r.wall, ['back', 'left', 'right', 'front'] as const, 'back');
    const wallIn = W(wall) * 12;
    const widthIn = typeof r.widthIn === 'number' && Number.isFinite(r.widthIn)
      ? clamp(r1(r.widthIn), 3, Math.max(3, Math.min(48, wallIn - 4)))
      : null;
    const half = (widthIn ?? ACCESSORY_WIDTH_IN[kind]) / 2 / Math.max(1, wallIn);
    const heightFt = clamp(r1(numOr(r.heightFt, ACCESSORY_HEIGHT_FT[kind])), 0.5, Math.max(0.5, b.dims.ceilingFt - 0.5));
    acc.push({
      kind, wall,
      t: clamp(numOr(r.t, 0.5), Math.min(half, 0.5), Math.max(1 - half, 0.5)),
      heightFt, widthIn,
      finish: pickWordOrNull(r.finish, FIXTURE_FINISHES),
    });
  }
  if (raw.length > acc.length) note(ctx, `accessories: kept ${acc.length} of ${raw.length}`);
  b.accessories = acc;
}

/** `pickWord` with null as the fallback: an unreadable word means "not said". */
const pickWordOrNull = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);

// ---------------------------------------------------------------------------
// Exterior
// ---------------------------------------------------------------------------

const GARAGE_DOOR_WIDTH: Record<number, number> = { 0: 0, 1: 9, 2: 16, 3: 25 };

function reconcileExterior(e: ExteriorSpec, ctx: ReconcileContext): ExteriorSpec {
  const h = e.house;
  const wallLen = (wall: Wall) => (wall === 'front' || wall === 'back' ? h.footprint.widthFt : h.footprint.depthFt);

  // Lot grows to fit the house (the house is what the photo shows).
  if (e.lot.widthFt < h.footprint.widthFt + 16) { e.lot.widthFt = clamp(r1(h.footprint.widthFt + 20), 20, 600); note(ctx, `lot: widened to ${e.lot.widthFt}ft to fit the house`); }
  const minDepth = h.footprint.depthFt + e.lot.setbackFrontFt + 10;
  if (e.lot.depthFt < minDepth) { e.lot.depthFt = clamp(r1(minDepth + 10), 20, 600); note(ctx, `lot: deepened to ${e.lot.depthFt}ft`); }
  e.lot.setbackFrontFt = clamp(e.lot.setbackFrontFt, 0, Math.max(0, e.lot.depthFt - h.footprint.depthFt - 10));
  e.lot.fence.sides = Array.from(new Set(e.lot.fence.sides));

  if (h.wing) {
    if (!h.wing.present) h.wing = null;
    else {
      h.wing.widthFt = clamp(h.wing.widthFt, 6, Math.max(6, wallLen(h.wing.wall)));
      h.wing.depthFt = clamp(h.wing.depthFt, 6, 80);
      const half = h.wing.widthFt / 2 / wallLen(h.wing.wall);
      h.wing.t = clamp(h.wing.t, Math.min(half, 0.5), Math.max(1 - half, 0.5));
    }
  }
  if (h.roof.type === 'flat') h.roof.pitch = Math.min(h.roof.pitch, 1);
  else if (h.roof.pitch < 2) { h.roof.pitch = h.roof.type === 'shed' ? 3 : 6; note(ctx, `roof: pitch raised to ${h.roof.pitch}/12 for a ${h.roof.type} roof`); }

  // Garage ↔ bays ↔ garage door ↔ driveway
  if (h.garage.present && h.garage.bays === 0) { h.garage.bays = 2; note(ctx, 'garage: assumed 2 bays'); }
  if (!h.garage.present) h.garage.bays = 0;
  const doorW = GARAGE_DOOR_WIDTH[h.garage.bays] ?? 16;
  if (h.garage.present) {
    const half = doorW / 2 / wallLen(h.garage.wall);
    h.garage.t = clamp(h.garage.t, Math.min(half, 0.5), Math.max(1 - half, 0.5));
  }
  h.porch.widthFt = clamp(h.porch.widthFt, 3, Math.max(3, wallLen(h.porch.wall)));
  h.deck.widthFt = clamp(h.deck.widthFt, 4, Math.max(4, wallLen(h.deck.wall)));
  if (h.porch.present && h.porch.columns === 0 && h.porch.roofed) h.porch.columns = Math.max(2, Math.round(h.porch.widthFt / 8));

  // Elevations: one per wall, front required.
  const seen = new Set<Wall>();
  e.elevations = e.elevations.filter((el) => { if (seen.has(el.wall)) { note(ctx, `elevations: dropped duplicate ${el.wall}`); return false; } seen.add(el.wall); return true; }).slice(0, 4);
  if (!seen.has('front')) {
    const tpl = defaultExterior(e.houseStyle).elevations.find((el) => el.wall === 'front')!;
    e.elevations.unshift({ ...tpl, sidingOverride: null });
    note(ctx, 'elevations: added a template front elevation');
  }
  const storyH = h.storyHeightFt;
  for (const el of e.elevations) {
    const L = wallLen(el.wall);
    el.windows = el.windows.slice(0, 14).map((w) => {
      const floor = clamp(Math.round(w.floor), 0, h.stories - 1);
      const heightFt = clamp(w.heightFt, 1, Math.max(1, storyH - 1.5));
      const sillLo = floor * storyH + 0.5;
      const sillHi = Math.max(sillLo, (floor + 1) * storyH - heightFt - 0.5);
      const widthFt = clamp(w.widthFt, 1, Math.max(1, L));
      const half = widthFt / 2 / L;
      return { ...w, floor, heightFt: r1(heightFt), sillFt: r1(clamp(w.sillFt, sillLo, sillHi)), widthFt: r1(widthFt), t: clamp(w.t, Math.min(half, 0.5), Math.max(1 - half, 0.5)) };
    });
    el.doors = el.doors.slice(0, 5).map((d) => {
      const widthFt = clamp(d.widthFt, 2, Math.max(2, L));
      const half = widthFt / 2 / L;
      return { ...d, widthFt: r1(widthFt), heightFt: r1(clamp(d.heightFt, 6, 10)), t: clamp(d.t, Math.min(half, 0.5), Math.max(1 - half, 0.5)) };
    });
    if (typeof el.sidingOverride === 'string') {
      const { id } = resolveMaterialId('siding_primary', el.sidingOverride, 'exterior');
      el.sidingOverride = id === e.materials.siding_primary ? null : id;
    }
    const garageDoor = el.doors.find((d) => d.kind === 'garage');
    if (garageDoor && !h.garage.present) {
      h.garage = { present: true, bays: garageDoor.widthFt >= 20 ? 3 : garageDoor.widthFt >= 13 ? 2 : 1, wall: el.wall, t: garageDoor.t, attached: true };
      note(ctx, `garage: detected from the ${el.wall} garage door`);
    }
  }
  if (h.garage.present) {
    const el = e.elevations.find((x) => x.wall === h.garage.wall);
    if (el && !el.doors.some((d) => d.kind === 'garage')) {
      el.doors.push({ t: h.garage.t, widthFt: doorW, heightFt: h.garage.bays >= 2 ? 8 : 7, kind: 'garage' });
      note(ctx, `elevations.${el.wall}: added a ${doorW}ft garage door`);
    }
  }
  const front = e.elevations.find((x) => x.wall === 'front');
  if (front && h.present && !front.doors.some((d) => d.kind === 'entry' || d.kind === 'french')) {
    front.doors.push({ t: h.porch.present && h.porch.wall === 'front' ? 0.5 : 0.65, widthFt: 3, heightFt: 6.7, kind: 'entry' });
    note(ctx, 'elevations.front: added an entry door');
  }

  // Hardscape
  const dw = e.hardscape.driveway;
  if (h.garage.present && !dw.present) {
    dw.present = true;
    dw.side = h.garage.t < 0.4 ? 'left' : h.garage.t > 0.6 ? 'right' : 'center';
    note(ctx, `driveway: added on the ${dw.side} for the garage`);
  }
  if (dw.present) dw.widthFt = clamp(Math.max(dw.widthFt, h.garage.bays * 9), 8, 40);
  e.hardscape.pool.lengthFt = clamp(e.hardscape.pool.lengthFt, 10, Math.max(10, e.lot.widthFt - 10));
  e.hardscape.pool.widthFt = clamp(e.hardscape.pool.widthFt, 6, 30);

  e.materials = resolveMaterials('exterior', e.materials, e.detected, ctx);
  e.detected = fixDetected(e.detected, ctx);
  return e;
}

// ---------------------------------------------------------------------------

/** Returns a new, internally consistent spec. Never throws on odd data. */
export function reconcileSpec(spec: RoomSpec, ctx: ReconcileContext): RoomSpec {
  const copy = structuredClone(spec);
  // Measured room dimensions are constraints on the layout, not estimates
  // that a model or a normalization pass may replace or round away.
  if (isSingleRoom(copy)) copy.dims = { ...copy.dims, ...confirmedDimensions(copy) };
  // The photo decides which wall a corner element stands on BEFORE the runs
  // and appliances are refitted, so the refit flows the cabinets round the
  // fridge where it really is (see applyInventoryWalls).
  const walled = applyInventoryWalls(copy, ctx);
  // A floor plan carries no photo-derived layout to reconcile — the healer in
  // @/lib/spec/floorplan is its normaliser, and it has already run by the time
  // a spec reaches here — so it passes through untouched.
  const out = walled.spec.roomType === 'kitchen' ? reconcileKitchen(walled.spec, ctx)
    : walled.spec.roomType === 'bathroom' ? reconcileBathroom(walled.spec, ctx)
    : walled.spec.roomType === 'floorplan' ? walled.spec
    : reconcileExterior(walled.spec, ctx);
  if (walled.notes.length) out.detected.notes = Array.from(new Set([...out.detected.notes, ...walled.notes])).slice(0, 40);
  // The inventory is compared against the FINISHED spec so a stool the
  // island pass just removed still shows up as "photo shows 4 stools".
  const disagreements = inventoryDisagreements(out);
  if (disagreements.length) {
    out.detected.notes = Array.from(new Set([...out.detected.notes, ...disagreements.map((d) => `inventory: ${d}`)])).slice(0, 32);
    note(ctx, `detected.elements: ${disagreements.length} count${disagreements.length === 1 ? '' : 's'} differ from the photo (${disagreements[0]}${disagreements.length > 1 ? ', …' : ''})`);
  }
  // Same for WALLS: labels turned against the spec's frame are rotated (the
  // spec stays), single disagreements become notes for the fitter.
  const walls = reconcileElementWalls(out, detectedFrame(out));
  out.detected.elements = walls.elements;
  if (walls.notes.length) {
    out.detected.notes = Array.from(new Set([...out.detected.notes, ...walls.notes])).slice(0, 40);
    note(ctx, walls.rotation ? walls.notes[0] : `detected.elements: ${walls.notes.length} wall label${walls.notes.length === 1 ? '' : 's'} differ from the spec (${walls.notes[0].replace(/^inventory: /, '')})`);
  }
  return out;
}
