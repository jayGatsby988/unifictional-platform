/**
 * The spec's search space: every number the photo may correct, as a
 * `SpecParam` with a getter, a setter, physical bounds and a step — and the
 * derived coordinates the search moves instead of the raw fields where the
 * raw fields make a bad landscape (an element's two EDGES rather than its
 * position + size, the room's joint SCALE, a cabinet gap's SLIDE along its
 * run).
 *
 * Every inventory kind has something here that moves its twin box:
 *   runs        start / length (as edges), per-run upper height, tall units'
 *               position + width, the appliance gaps' and sink base's slide
 *               along the row (width traded between the plain cabinets either
 *               side, so the run's total and the gap itself stay put)
 *   appliances  position, width, fridge / hood height, the hood's mouth height
 *   island      offset / length / width (as edges), stool pitch, end seats
 *   pendants    spread, offset, drop
 *   openings    position, width, height, sill
 *   décor       shelves' position / width / bottom / spacing, plants' position / size
 *   room        width / depth (with the camera carried), ceiling, joint scale
 *
 * "0 = auto" / null fields (the pendant row, the stool pitch, the appliance
 * heights, a run's own upper height) start the search at what the scene
 * draws for them, read off the solved layout — and, because nobody measured
 * that value, they are exempt from the gate's per-size cap: they are searched
 * over their physical range like a position. Once the search writes one of
 * them, `honesty` holds it to what the scene draws (the layout clamps a
 * pendant row inside its top, a hood under the ceiling, the end stools to
 * the floor beyond the end), so no field is worth searching past the point
 * where the scene stops following it.
 */
import { computeKitchenLayout, hoodExtents, islandTopFt, pendantPositions, stoolPositions, type KIsland, type KitchenLayoutData } from '@/components/scene/kitchen/layout';
import { computeBathroomLayout, type BathLayout } from '@/components/scene/bathroom/layout';
import { resolveCabinetAbove, resolveHoodShape, resolveHoodStyle } from '@/lib/spec/hood';
import type { BathroomSpec, KitchenSpec, PhotoElementKind, RoomSpec, SolvedCamera, Wall } from '@/lib/spec/types';
import { ISLAND_KNEE_IN, islandNeedsKneeRoom } from '@/lib/ai/reconcile';
import { clamp } from '@/lib/units';
import { cameraBasis, roomSize } from './camera';
import { isSingleRoom } from '@/lib/spec/floorplan';
import { confirmedDimensions } from '@/lib/spec/measurements';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Dim {
  min: number;
  max: number;
  step: number;
  minStep: number;
  /** angles wrap instead of clamping */
  wrap?: boolean;
}

export type Search = 'scan' | 'pattern' | 'both' | 'none';

export interface SpecParam {
  label: string;
  /** the photo kinds this field moves; the param is skipped when none of them is in the inventory */
  kinds: readonly PhotoElementKind[];
  get(spec: RoomSpec): number;
  set(spec: RoomSpec, v: number): void;
  dim: Dim;
  /**
   * A position along a wall / across the floor rather than a size. Positions
   * are what the photo fixes: they are scanned coarsely over `scan` before the
   * local search (a range whose box has zero overlap gives the local search no
   * gradient) and are exempt from the gate's per-field change cap.
   */
  scan?: [lo: number, hi: number, step: number];
  /** how the search uses it (default 'both'): a field with edge coordinates of its own is scanned only, and its size not searched by name at all */
  search?: Search;
  /** carry the camera with the change (room size) */
  moveCamera?: (before: RoomSpec, after: RoomSpec, cam: SolvedCamera) => SolvedCamera;
  /** the gate's stricter cap applies */
  island?: boolean;
  /**
   * This size's own cap, as a fraction of the analyzer's value, replacing
   * `GATE_MAX_CHANGE` / `GATE_MAX_CHANGE_ISLAND`. Set only where a second,
   * independent measurement in the SAME spec says how far the number can
   * honestly be wrong (a hood is built for its opening, so a range under one
   * may reach the hood's width) — never to let a search wander further.
   */
  cap?: number;
  /**
   * The photo cannot measure this size: its own box is cut on that axis, so
   * the analyzer's number is a guess and not a measurement. Treated exactly
   * like an `auto` field — the gate's cap, the search bound derived from it
   * and the prior's pull toward the analyzer all drop away, and the photo's
   * boxes decide alone. Set by the fitter from `PhotoElement.open`, never
   * declared here: which sizes are unmeasured is a property of the PICTURE.
   */
  unmeasured?: boolean;
  /** a search coordinate made of real fields (an edge, the room scale, a gap's slide): never put back or gated by name */
  derived?: boolean;
  /**
   * True when the ORIGINAL spec left this field to the scene ("0 = auto",
   * null): the gate's cap is meaningless against a value nobody measured, so
   * the field is searched over its scan range and exempt from the cap.
   */
  auto?: (spec: RoomSpec) => boolean;
  /**
   * A RELATIVE coordinate: `get` always answers `neutral` and `set(v)` applies
   * `v` as a change from the spec it is given (the room scale answers 1, a
   * gap's slide 0). The joint optimiser treats a vector entry at `neutral`
   * as "leave it".
   */
  neutral?: number;
  /**
   * An index into a list (which cabinet a gap swaps with), not a quantity:
   * neighbouring values are not neighbouring layouts, so it is scanned only
   * — never stepped, never evolved. (Evolving it turned the joint round
   * into a lottery over cabinet orders and stranded a client fixture.)
   */
  nominal?: boolean;
  /**
   * How far a spec has moved along this coordinate from the analyzer's, as
   * a fraction of its reach (0 = not at all), for the fit's prior — a
   * relative coordinate leaves no field of its own to read the move off, so
   * it says how to recover it from what it changed (a slide from the widths
   * it traded).
   */
  prior?: (spec: RoomSpec) => number;
}

export const ALL_KINDS: readonly PhotoElementKind[] = [
  'base-cabinet-run', 'upper-cabinet-run', 'tall-cabinet', 'fridge', 'range', 'cooktop', 'hood', 'dishwasher', 'wall-oven', 'microwave',
  'sink', 'faucet', 'window', 'door', 'island', 'stool', 'pendant', 'shelf', 'plant', 'art', 'rug', 'backsplash', 'item',
  'vanity', 'mirror', 'shower', 'tub', 'toilet', 'towel-bar', 'wall', 'floor', 'ceiling', 'other',
];

/** no single size may move by more than this fraction of its original value (the island stricter) */
export const GATE_MAX_CHANGE = 0.3;
export const GATE_MAX_CHANGE_ISLAND = 0.25;
/** the search itself stays this much inside the gate's caps, so the reconciler's rounding of a fitted size cannot push it over */
const SEARCH_HEADROOM = 0.03;

const CABINET_KINDS: readonly PhotoElementKind[] = ['base-cabinet-run', 'upper-cabinet-run', 'tall-cabinet', 'backsplash', 'sink', 'fridge', 'range', 'cooktop', 'dishwasher', 'hood'];
const ISLAND_KINDS: readonly PhotoElementKind[] = ['island', 'stool', 'pendant', 'sink', 'cooktop', 'range'];
const STOOL_KINDS: readonly PhotoElementKind[] = ['stool', 'island'];
const BASE_GAP_KINDS: readonly PhotoElementKind[] = ['range', 'cooktop', 'dishwasher', 'fridge', 'wall-oven', 'hood', 'sink', 'faucet'];
const UPPER_GAP_KINDS: readonly PhotoElementKind[] = ['hood', 'microwave', 'fridge', 'upper-cabinet-run'];
const T_SCAN: [number, number, number] = [0, 1, 0.05];
const M_TO_IN = 1 / 0.0254;
const M_TO_FT = 1 / 0.3048;

const around = (v: number, spread: number, lo: number, hi: number): [number, number] => [Math.max(lo, v - spread), Math.min(hi, v + spread)];
export const wallFtOf = (spec: KitchenSpec | BathroomSpec, wall: Wall) => (wall === 'back' || wall === 'front' ? spec.dims.widthFt : spec.dims.depthFt);
export const scans = (p: SpecParam) => p.scan !== undefined && (p.search ?? 'both') !== 'pattern' && (p.search ?? 'both') !== 'none';
export const steps = (p: SpecParam) => (p.search ?? 'both') === 'both' || p.search === 'pattern';
/** A scan-only COUNT (end seats, the backsplash height): whole steps, never finer, and an ordered quantity (a gap's index is not). */
export const integerScan = (p: SpecParam) => !steps(p) && scans(p) && !p.nominal && p.dim.minStep >= 1 && p.dim.step >= 1;
/**
 * What the joint (evolution) round moves: every stepped coordinate, and the
 * scan-only counts as rounded coordinates — a count the coordinate stages
 * only ever scan on its own would otherwise never move together with the
 * things it changes (an end seat with the island's length, the splash
 * height with the uppers').
 */
export const jointParams = (params: SpecParam[]) => params.filter((p) => steps(p) || integerScan(p));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** an explicit contract value, or null when the field says "auto" */
const explicit = (v: unknown): number | null => (isNum(v) && v > 0 ? v : null);

export const safeGet = (p: SpecParam, spec: RoomSpec): number | null => {
  try {
    const v = p.get(spec);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
};

export function moveDim(v: number, delta: number, d: Dim): number {
  const n = v + delta;
  if (d.wrap) {
    let m = n;
    while (m > 180) m -= 360;
    while (m <= -180) m += 360;
    return m;
  }
  return clamp(n, d.min, d.max);
}

// ---------------------------------------------------------------------------
// Room size and the camera that rides with it
// ---------------------------------------------------------------------------

/** The wall a camera faces, from its yaw alone. */
export function facedWall(cam: SolvedCamera): Wall {
  const { forward } = cameraBasis(cam.yawDeg, 0);
  return Math.abs(forward[0]) > Math.abs(forward[2]) ? (forward[0] > 0 ? 'right' : 'left') : forward[2] < 0 ? 'back' : 'front';
}

/**
 * The camera after a change of room size, moved so that what it was looking
 * at stays put. The room frame is centred, so growing the width by Δ pushes
 * BOTH side walls out by Δ/2 — a camera left at the same coordinates would
 * see the near wall's run slide across the frame, and the optimiser read
 * that as "wider is worse" even when it was the far wall that was wrong. So
 * on each axis the camera keeps its distance to one anchor wall: the wall it
 * faces when that wall lies on the axis, else the nearer of the two. The
 * anchor walls' elements project exactly as before; only the far walls move.
 */
export function cameraForDims(from: RoomSpec, to: RoomSpec, cam: SolvedCamera): SolvedCamera {
  const a = roomSize(from), b = roomSize(to);
  if (Math.abs(a.w - b.w) < 1e-9 && Math.abs(a.d - b.d) < 1e-9) return cam;
  const faced = facedWall(cam);
  const anchorX = faced === 'left' || faced === 'right' ? faced : cam.x < 0 ? 'left' : 'right';
  const anchorZ = faced === 'back' || faced === 'front' ? faced : cam.z < 0 ? 'back' : 'front';
  const dx = (b.w - a.w) / 2, dz = (b.d - a.d) / 2;
  return { ...cam, x: cam.x + (anchorX === 'right' ? dx : -dx), z: cam.z + (anchorZ === 'front' ? dz : -dz) };
}

/** The room scaled by `s` about its centre: dimensions and the island's offset (feet from the centre). Sizes on the walls stay — a 36" range is still 36". */
export function scaleRoom(spec: RoomSpec, s: number): RoomSpec {
  const out = structuredClone(spec);
  if (!isSingleRoom(out) || !out.dims) return out;
  const locked = confirmedDimensions(out);
  if (locked.widthFt !== undefined || locked.depthFt !== undefined) return out;
  out.dims.widthFt = clamp(out.dims.widthFt * s, 4, 80);
  out.dims.depthFt = clamp(out.dims.depthFt * s, 4, 80);
  if (out.roomType === 'kitchen' && out.island && typeof out.island === 'object' && out.island.offset && typeof out.island.offset === 'object') {
    out.island.offset = { x: out.island.offset.x * s, z: out.island.offset.z * s };
  }
  return out;
}

export const scaleCamera = (cam: SolvedCamera, s: number): SolvedCamera => ({ ...cam, x: cam.x * s, z: cam.z * s });

// ---------------------------------------------------------------------------
// Field lists
// ---------------------------------------------------------------------------

/** Room dimensions (the photo can correct a room, not invent one — `boundSizes` keeps them near the analyzer's estimate). */
function dimsParams(spec: RoomSpec): SpecParam[] {
  const locked = confirmedDimensions(spec);
  const out: SpecParam[] = [];
  const add = (label: string, key: 'widthFt' | 'depthFt') => {
    out.push({
      label, kinds: ALL_KINDS,
      get: (s) => (s as KitchenSpec).dims[key],
      set: (s, x) => { (s as KitchenSpec).dims[key] = x; },
      dim: { min: 4, max: 80, step: 1, minStep: 0.1 },
      moveCamera: cameraForDims,
    });
  };
  add('dims.widthFt', 'widthFt');
  add('dims.depthFt', 'depthFt');
  out.push({ label: 'dims.ceilingFt', kinds: ALL_KINDS, get: (s) => (s as KitchenSpec).dims.ceilingFt, set: (s, x) => { (s as KitchenSpec).dims.ceilingFt = x; }, dim: { min: 7, max: 20, step: 0.5, minStep: 0.1 } });
  return out.filter((p) => locked[p.label.slice(5) as keyof typeof locked] === undefined);
}

function openingParams(spec: KitchenSpec | BathroomSpec): SpecParam[] {
  const out: SpecParam[] = [];
  const openings = Array.isArray(spec.openings) ? spec.openings : [];
  openings.forEach((o, i) => {
    if (!o || typeof o !== 'object') return;
    const at = (s: RoomSpec) => (s as KitchenSpec).openings[i];
    const kinds: readonly PhotoElementKind[] = o.kind === 'window' ? ['window'] : ['door'];
    out.push({ label: `openings[${i}].t`, kinds, get: (s) => at(s).t, set: (s, v) => { at(s).t = v; }, dim: { min: 0, max: 1, step: 0.05, minStep: 0.004 }, scan: T_SCAN });
    out.push({ label: `openings[${i}].widthFt`, kinds, get: (s) => at(s).widthFt, set: (s, v) => { at(s).widthFt = v; }, dim: { min: 0.5, max: 40, step: 0.5, minStep: 0.05 } });
    out.push({ label: `openings[${i}].heightFt`, kinds, get: (s) => at(s).heightFt, set: (s, v) => { at(s).heightFt = v; }, dim: { min: 0.5, max: 20, step: 0.5, minStep: 0.05 } });
    // a sill is where the window SITS, not how big it is: scanned like a position
    if (o.kind === 'window') out.push({ label: `openings[${i}].sillFt`, kinds, get: (s) => at(s).sillFt, set: (s, v) => { at(s).sillFt = v; }, dim: { min: 0, max: 12, step: 0.25, minStep: 0.05 }, scan: [0, 9, 0.5] });
  });
  return out;
}

function decorParams(spec: KitchenSpec | BathroomSpec): SpecParam[] {
  const out: SpecParam[] = [];
  const shelves = spec.decor && Array.isArray(spec.decor.shelves) ? spec.decor.shelves : [];
  shelves.forEach((sh, i) => {
    if (!sh || typeof sh !== 'object') return;
    const at = (s: RoomSpec) => (s as KitchenSpec).decor.shelves[i];
    out.push({ label: `decor.shelves[${i}].t`, kinds: ['shelf'], get: (s) => at(s).t, set: (s, v) => { at(s).t = v; }, dim: { min: 0, max: 1, step: 0.05, minStep: 0.004 }, scan: T_SCAN });
    out.push({ label: `decor.shelves[${i}].widthIn`, kinds: ['shelf'], get: (s) => at(s).widthIn, set: (s, v) => { at(s).widthIn = v; }, dim: { min: 12, max: 120, step: 6, minStep: 0.5 } });
    const caseSpacingRatio = sh.enclosure ? sh.spacingIn / sh.enclosure.heightIn : null;
    if (sh.enclosure) out.push({
      label: `decor.shelves[${i}].enclosure.heightIn`, kinds: ['shelf'],
      get: (s) => at(s).enclosure!.heightIn,
      set: (s, v) => {
        const shelf = at(s);
        shelf.enclosure!.heightIn = v;
        // The inventory measures the whole case, so keep its interior tiers
        // at their observed relative heights when that case is resized.
        shelf.spacingIn = clamp(caseSpacingRatio! * v, 8, 24);
      },
      dim: { min: 12, max: 120, step: 6, minStep: 0.5 },
    });
    // the height of the lowest board is where the shelves HANG: scanned like a
    // position (a ± step from the wrong board pairing never finds the right one)
    out.push({ label: `decor.shelves[${i}].bottomFt`, kinds: ['shelf'], get: (s) => at(s).bottomFt, set: (s, v) => { at(s).bottomFt = v; }, dim: { min: 2, max: 9, step: 0.5, minStep: 0.05 }, scan: [2, 9, 0.25] });
    // the pitch between boards: a photo of two boards fixes it exactly
    if (!sh.enclosure && (sh.count ?? 1) > 1) out.push({ label: `decor.shelves[${i}].spacingIn`, kinds: ['shelf'], get: (s) => at(s).spacingIn, set: (s, v) => { at(s).spacingIn = v; }, dim: { min: 8, max: 24, step: 2, minStep: 0.25 } });
  });
  // A counter item slides along its host surface; nothing else about it is
  // searched — its size comes from the object it IS, and the inventory's
  // 2%-of-frame box cannot measure a kettle's height.
  const items = spec.roomType === 'kitchen' && spec.decor && Array.isArray(spec.decor.items) ? spec.decor.items : [];
  items.forEach((it, i) => {
    if (!it || typeof it !== 'object') return;
    const at = (s: RoomSpec) => (s as KitchenSpec).decor.items?.[i];
    out.push({
      label: `decor.items[${i}].t`, kinds: ['item'],
      get: (s) => at(s)?.t ?? it.t,
      set: (s, v) => { const o = at(s); if (o) o.t = v; },
      dim: { min: 0, max: 1, step: 0.05, minStep: 0.004 }, scan: T_SCAN,
    });
  });
  const plants = spec.decor && Array.isArray(spec.decor.plants) ? spec.decor.plants : [];
  plants.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const at = (s: RoomSpec) => (s as KitchenSpec).decor.plants[i];
    out.push({ label: `decor.plants[${i}].t`, kinds: ['plant'], get: (s) => at(s).t, set: (s, v) => { at(s).t = v; }, dim: { min: 0, max: 1, step: 0.1, minStep: 0.01 }, scan: [0, 1, 0.1] });
    out.push({ label: `decor.plants[${i}].sizeFt`, kinds: ['plant'], get: (s) => at(s).sizeFt, set: (s, v) => { at(s).sizeFt = v; }, dim: { min: 0.3, max: 9, step: 0.5, minStep: 0.05 } });
  });
  return out;
}

/** The narrowest a traded cabinet may get: a real door or drawer stack is 12" at least; only a filler strip goes down to 9". */
export const CABINET_MIN_IN = 12;
export const FILLER_MIN_IN = 9;
export const CABINET_MAX_IN = 60;
const isFiller = (type: string) => type === 'filler';
const cabinetFloor = (type: string) => (isFiller(type) ? FILLER_MIN_IN : CABINET_MIN_IN);

/**
 * A cabinet gap's SLIDE along its row: `v` inches of width taken from the
 * plain cabinets before the gap (each in proportion to its size) and given
 * to the plain cabinets after it, so the gap — and whatever the layout snaps
 * into it: the range, the dishwasher, the sink in its base — moves `v`
 * toward the run's start while the run's total and the gap's own width stay
 * exactly what they were. Every cabinet keeps to a real size (12–60", a
 * filler strip down to 9"); a move they cannot make is made as far as they
 * can. Relative: `get` answers 0, and `prior` reads the net inches the gap
 * has slid off the widths as they stand against the analyzer's, so the fit
 * can charge a slide the way it charges any other change.
 */
function slideParams(spec: KitchenSpec, base: KitchenSpec = spec): SpecParam[] {
  const out: SpecParam[] = [];
  const PLAIN = new Set(['door', 'drawers', 'open', 'glass', 'open-shelf', 'corner', 'filler']);
  const runs = Array.isArray(spec.runs) ? spec.runs : [];
  const baseRuns = Array.isArray(base.runs) ? base.runs : [];
  type Cab = { type: string; widthIn: number };
  /** shrink (`take` > 0) or grow (`take` < 0) a set of cabinets together by `take` inches, in proportion, each within its floor and 60"; returns what was actually moved */
  const trade = (cabs: Cab[], take: number): number => {
    const total = cabs.reduce((a, c) => a + c.widthIn, 0);
    const room = take > 0 ? cabs.reduce((a, c) => a + Math.max(0, c.widthIn - cabinetFloor(c.type)), 0) : cabs.reduce((a, c) => a + Math.max(0, CABINET_MAX_IN - c.widthIn), 0);
    let moved = Math.sign(take) * Math.min(Math.abs(take), room);
    if (!total || Math.abs(moved) < 1e-9) return 0;
    // in proportion, then whatever a cabinet at its floor could not give is
    // taken from the ones that still can — so the whole move lands
    let left = moved;
    for (let pass = 0; pass < 4 && Math.abs(left) > 1e-9; pass++) {
      const open = cabs.filter((c) => (left > 0 ? c.widthIn > cabinetFloor(c.type) + 1e-9 : c.widthIn < CABINET_MAX_IN - 1e-9));
      const sum = open.reduce((a, c) => a + c.widthIn, 0);
      if (!open.length || sum <= 0) break;
      const share = left;
      for (const c of open) {
        const want = c.widthIn - share * (c.widthIn / sum);
        const next = clamp(want, cabinetFloor(c.type), CABINET_MAX_IN);
        left -= c.widthIn - next;
        c.widthIn = next;
      }
    }
    moved -= left;
    return moved;
  };
  runs.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const rows: Array<{ key: 'base' | 'uppers'; carriers: Set<string>; kinds: (t: string) => readonly PhotoElementKind[] }> = [
      { key: 'base', carriers: new Set(['appliance-gap', 'sink-base']), kinds: (t) => (t === 'sink-base' ? ['sink', 'faucet'] : BASE_GAP_KINDS) },
      { key: 'uppers', carriers: new Set(['appliance-gap', 'hood-gap']), kinds: () => UPPER_GAP_KINDS },
    ];
    for (const row of rows) {
      const list = (r as unknown as Record<string, unknown>)[row.key];
      if (!Array.isArray(list)) continue;
      const baseRow = baseRuns[i] && typeof baseRuns[i] === 'object' ? (baseRuns[i] as unknown as Record<string, unknown>)[row.key] : null;
      list.forEach((c, g) => {
        if (!c || typeof c !== 'object' || !row.carriers.has((c as Cab).type)) return;
        const sides = (cabs: Cab[]): [Cab[], Cab[]] => [
          cabs.slice(0, g).filter((k) => k && PLAIN.has(k.type)),
          cabs.slice(g + 1).filter((k) => k && PLAIN.has(k.type)),
        ];
        const [before, after] = sides(list as Cab[]);
        if (!before.length || !after.length) return;
        const give = (cabs: Cab[]) => cabs.reduce((a, k) => a + Math.max(0, k.widthIn - cabinetFloor(k.type)), 0);
        const reach = Math.min(give(before), give(after), 72);
        if (reach < 3) return;
        // the widths the analyzer wrote for the cabinets before the gap: the
        // slide is what has been taken from them since
        const before0 = Array.isArray(baseRow) && baseRow.length === list.length ? (baseRow as Cab[]).slice(0, g).filter((k) => k && PLAIN.has(k.type)).reduce((a, k) => a + k.widthIn, 0) : before.reduce((a, k) => a + k.widthIn, 0);
        out.push({
          label: `runs[${i}].${row.key}[${g}].slide`, kinds: row.kinds((c as Cab).type), derived: true, search: 'both', neutral: 0,
          get: () => 0,
          set: (s, v) => {
            const cabs = (((s as KitchenSpec).runs[i] as unknown as Record<string, unknown>)[row.key]) as Cab[] | null;
            if (!Array.isArray(cabs)) return;
            const [p, q] = sides(cabs);
            if (!p.length || !q.length || !Number.isFinite(v) || Math.abs(v) < 1e-9) return;
            // take from one side, give exactly as much to the other
            const moved = trade(v > 0 ? p : q, Math.abs(v));
            if (Math.abs(moved) < 1e-9) return;
            const given = trade(v > 0 ? q : p, -moved);
            if (Math.abs(given + moved) > 1e-6) trade(v > 0 ? p : q, given + moved);
          },
          prior: (s) => {
            const cabs = (((s as KitchenSpec).runs[i] as unknown as Record<string, unknown>)[row.key]) as Cab[] | null;
            if (!Array.isArray(cabs) || cabs.length !== list.length) return 0;
            const [p] = sides(cabs);
            const now = p.reduce((a, k) => a + (Number.isFinite(k.widthIn) ? k.widthIn : 0), 0);
            return Math.min(1, Math.abs(before0 - now) / reach);
          },
          dim: { min: -reach, max: reach, step: 6, minStep: 1 },
          // scanned like a position: an appliance only snaps into the gap
          // once the gap comes within reach of it, and a 6" nudge from far
          // away changes nothing the sweep could follow
          scan: [-reach, reach, 6],
        });
      });
    }
  });
  return out;
}

/**
 * Where along its row an appliance GAP sits: the gap swapped with any plain
 * cabinet of the row (types and widths trade places, so the row's total and
 * the gap's own width are untouched). The analyzer lists the cabinets from
 * a photo and often puts the range's gap under the wrong cabinet; the layout
 * then snaps the range into that gap from up to 1.6 m away, and no position
 * step can draw the range where the photo shows it until the gap is under
 * it. Scanned over the row's cabinet indices. `get` answers the gap's
 * current index; the j-th gap of the row is the one moved.
 */
function gapParams(spec: KitchenSpec): SpecParam[] {
  const out: SpecParam[] = [];
  const PLAIN = new Set(['door', 'drawers', 'open']);
  type Cab = { type: string; widthIn: number };
  const runs = Array.isArray(spec.runs) ? spec.runs : [];
  runs.forEach((r, i) => {
    if (!r || typeof r !== 'object' || !Array.isArray(r.base)) return;
    const gaps = r.base.map((c, k) => (c && typeof c === 'object' && c.type === 'appliance-gap' ? k : -1)).filter((k) => k >= 0);
    const n = r.base.length;
    if (n < 2) return;
    gaps.forEach((_, j) => {
      const nth = (row: Cab[]): number => {
        let seen = -1;
        for (let k = 0; k < row.length; k++) if (row[k] && row[k].type === 'appliance-gap' && ++seen === j) return k;
        return -1;
      };
      out.push({
        label: `runs[${i}].base.gap[${j}]`, kinds: BASE_GAP_KINDS, search: 'scan', nominal: true,
        get: (s) => Math.max(0, nth(((s as KitchenSpec).runs[i]?.base ?? []) as Cab[])),
        set: (s, v) => {
          const row = ((s as KitchenSpec).runs[i]?.base ?? []) as Cab[];
          const cur = nth(row);
          const k = clamp(Math.round(v), 0, row.length - 1);
          if (cur < 0 || k === cur || !row[k] || !PLAIN.has(row[k].type)) return;
          const gap = row[cur];
          row[cur] = row[k];
          row[k] = gap;
        },
        dim: { min: 0, max: n - 1, step: 1, minStep: 1 },
        scan: [0, n - 1, 1],
      });
    });
  });
  return out;
}

/** What the scene draws for the "auto" contract values, read off the solved layout of `spec` (null when it cannot be solved). */
interface AutoSeeds {
  pendantSpreadFt: number;
  stoolPitchIn: number;
  fridgeHeightIn: number;
  hoodHeightIn: number;
  hoodMouthIn: number;
  /** the splash field's DRAWN height above the counter, inches — what the `height` category currently means */
  splashHeightIn: number;
}

function autoSeeds(spec: KitchenSpec): AutoSeeds {
  const seeds: AutoSeeds = { pendantSpreadFt: 4, stoolPitchIn: 28, fridgeHeightIn: 70, hoodHeightIn: 36, hoodMouthIn: 30, splashHeightIn: 18 };
  let L: KitchenLayoutData;
  try { L = computeKitchenLayout(spec); } catch { return seeds; }
  const isl = L.island;
  if (isl) seeds.pendantSpreadFt = isl.topLen * 0.62 * M_TO_FT;
  else if (L.sink && L.sink.where === 'wall') seeds.pendantSpreadFt = Math.min(0.9, L.sink.width * 0.8) * M_TO_FT;
  else seeds.pendantSpreadFt = Math.min(L.w * 0.4, 1.6) * M_TO_FT;
  if (isl && isNum(isl.stoolPitch)) seeds.stoolPitchIn = isl.stoolPitch * M_TO_IN;
  const fridge = L.appliances.find((a) => a.kind === 'fridge');
  if (fridge) seeds.fridgeHeightIn = fridge.height * M_TO_IN;
  const hood = L.appliances.find((a) => a.kind === 'hood');
  if (hood) {
    const ext = hoodExtents(hood);
    seeds.hoodHeightIn = Math.max(6, (ext.top - ext.mouth) * M_TO_IN);
    seeds.hoodMouthIn = clamp((ext.mouth - L.counterTopY) * M_TO_IN, 18, 48);
  }
  const splashTop = Math.max(...L.runs.flatMap((r) => r.splash.map((sp) => sp.top)), -Infinity);
  if (Number.isFinite(splashTop)) seeds.splashHeightIn = clamp((splashTop - L.counterTopY) * M_TO_IN, 4, 120);
  return seeds;
}

/**
 * What the scene actually DRAWS for the contract fields it may clamp — the
 * island's size, how many stools sit round its end, where the pendant row
 * hangs, how tall the hood is — read off the solved layout so the fit can
 * hold the spec to it.
 */
export interface DrawnFacts {
  /** the island the layout drew (m), when there is one */
  island: {
    len: number; wide: number; endSeats: number; stoolOffsetM: number | null;
    /** how far the drawn body sits off its declared anchor along its long axis (m) */
    slideM: number;
  } | null;
  /**
   * The pendant row as hung: its centre-to-centre span, how far its centre
   * sits from where it would hang with no offset (m), and — when the spec
   * gave explicit hook points — each shade's hook in ISLAND-LOCAL metres
   * (along + toward the right end, across + toward the seating side), read
   * back off the world positions so it is what the scene draws, not a
   * second derivation of the same rule.
   */
  pendants: { spreadM: number; offsetM: number; hooks: Array<{ along: number; across: number }> | null } | null;
  /** the hood as drawn: mouth to top (m) and the mouth's height over the counter (m) */
  hood: { heightM: number; aboveCounterM: number } | null;
}

/** World XZ → island-local (x along the long axis, z across), the inverse of the layout's own island transform. */
function toIslandLocal(isl: KIsland, x: number, z: number): { along: number; across: number } {
  const c = Math.cos(isl.yaw), sn = Math.sin(isl.yaw);
  const dx = x - isl.cx, dz = z - isl.cz;
  return { along: dx * c - dz * sn, across: (dx * sn + dz * c) * (isl.seatSide === -1 ? -1 : 1) };
}

export function drawnFacts(L: KitchenLayoutData): DrawnFacts {
  const out: DrawnFacts = { island: null, pendants: null, hood: null };
  const isl = L.island;
  if (isl) {
    // where the row of SIDE stools actually sits along the island: the end
    // stools stand past the top and say nothing about the row's offset
    let offset: number | null = null;
    try {
      const side = stoolPositions(isl).filter(([x]) => Math.abs(x) <= isl.topLen / 2 + 1e-6);
      if (side.length) offset = side.reduce((a, [x]) => a + x, 0) / side.length;
    } catch { /* a row the layout could not place */ }
    out.island = { len: isl.len, wide: isl.wide, endSeats: isNum(isl.endSeats) ? isl.endSeats : 0, stoolOffsetM: offset, slideM: Math.hypot(isl.cx - isl.anchorX, isl.cz - isl.anchorZ) };
  }
  const p = L.lighting.pendants;
  if (p) {
    try {
      const hung = pendantPositions(L);
      if (hung.length) {
        const first = hung[0], last = hung[hung.length - 1];
        const spreadM = Math.hypot(last[0] - first[0], last[2] - first[2]);
        const centre = hung.reduce((a, h) => [a[0] + h[0] / hung.length, a[1] + h[2] / hung.length], [0, 0]);
        // the same row hung with no offset says where its centre would be
        const plain = pendantPositions({ ...L, lighting: { ...L.lighting, pendants: { ...p, offset: 0 } } });
        const centre0 = plain.reduce((a, h) => [a[0] + h[0] / plain.length, a[1] + h[2] / plain.length], [0, 0]);
        const hooks = isl
          ? hung.map((h) => toIslandLocal(isl, h[0], h[2]))
          : hung.map((h) => ({ along: h[0], across: h[2] }));
        out.pendants = { spreadM, offsetM: Math.hypot(centre[0] - centre0[0], centre[1] - centre0[1]), hooks };
      }
    } catch { /* a row the layout could not place: nothing to hold the spec to */ }
  }
  const hood = L.appliances.find((a) => a.kind === 'hood');
  if (hood) {
    const ext = hoodExtents(hood);
    out.hood = { heightM: Math.max(0, ext.top - ext.mouth), aboveCounterM: ext.mouth - L.counterTopY };
  }
  return out;
}

/**
 * The layout clamps what does not fit — an island about its anchor, the
 * pendant row inside the top it lights, a hood under the ceiling, the end
 * stools to the floor beyond the end — and a search that reads only the
 * spec could use that to claim one thing and draw another: a smaller island
 * than declared (past the gate's cap, which reads the spec), a spread the
 * row never reaches, a seat nobody is drawn on. Charged per metre of gap
 * between what the spec says and what the scene draws (0.3 m per stool),
 * so the search says what it draws and the optimiser has nothing to gain
 * from a field the scene clamps. Only explicit values are held to account:
 * 0 / null means "let the scene decide" and is honest by definition.
 */
export const HONESTY_WEIGHT = 0.08;
export function honesty(spec: RoomSpec, drawn: DrawnFacts | null): number {
  if (spec.roomType !== 'kitchen' || !drawn) return 0;
  let gap = 0;
  const isl = spec.island;
  if (drawn.island && isl && typeof isl === 'object' && isl.present) {
    const len = isNum(isl.lengthFt) ? isl.lengthFt * 0.3048 : drawn.island.len;
    const wide = isNum(isl.widthFt) ? isl.widthFt * 0.3048 : drawn.island.wide;
    gap += Math.max(0, len - drawn.island.len - 0.1) + Math.max(0, wide - drawn.island.wide - 0.05);
    // …and the same for WHERE it is drawn. The layout may slide the body off
    // its declared anchor to hold a declared length that will not fit
    // symmetrically, which makes (offset.x, lengthFt) degenerate: the search
    // can park the anchor anywhere and let the slide put the body back, and on
    // client-marble it did exactly that — the anchor 4.2 ft off-centre and the
    // island pair down from IoU 0.90 to 0.56. Charging the slide costs a spec
    // that describes its own island NOTHING (write the drawn centre into
    // offset.x and the slide is zero), and takes the free lunch away from one
    // that does not.
    gap += Math.max(0, drawn.island.slideM - 0.05);
    // the end seats are compared as a TOTAL across both ends: 'both' splits
    // them and the layout reports the total it drew
    const seats = isNum(isl.seating) ? Math.round(isl.seating) : 0;
    if (seats > 0 && isNum(isl.endSeats)) gap += 0.3 * Math.abs(Math.round(isl.endSeats) - drawn.island.endSeats);
    // a stool row shifted further along the island than the top lets it go
    if (drawn.island.stoolOffsetM !== null && isNum(isl.stoolOffsetIn) && Math.abs(isl.stoolOffsetIn) > 1e-9) {
      gap += Math.max(0, Math.abs(isl.stoolOffsetIn * 0.0254 - drawn.island.stoolOffsetM) - 0.05);
    }
  }
  const pend = spec.lighting && typeof spec.lighting === 'object' ? spec.lighting.pendants : null;
  if (drawn.pendants && pend && typeof pend === 'object' && isNum(pend.count) && pend.count >= 1) {
    const declared = Array.isArray(pend.positions) ? pend.positions : null;
    const hooks = drawn.pendants.hooks;
    if (declared && hooks) {
      // explicit hook points: charged per pendant, so the search cannot claim
      // a shade hangs past the island's end while the scene hangs it inside
      declared.forEach((q, k) => {
        const h = hooks[k];
        if (!h || !q || !isNum(q.alongFt) || !isNum(q.acrossFt)) return;
        gap += Math.max(0, Math.hypot(q.alongFt * 0.3048 - h.along, q.acrossFt * 0.3048 - h.across) - 0.05);
      });
    } else {
      if (pend.count > 1 && explicit(pend.spreadFt) !== null) gap += Math.max(0, Math.abs(pend.spreadFt * 0.3048 - drawn.pendants.spreadM) - 0.05);
      if (isNum(pend.offsetFt) && Math.abs(pend.offsetFt) > 1e-9) gap += Math.max(0, Math.abs(Math.abs(pend.offsetFt) * 0.3048 - drawn.pendants.offsetM) - 0.05);
    }
  }
  const hood = (Array.isArray(spec.appliances) ? spec.appliances : []).find((a) => a && typeof a === 'object' && a.kind === 'hood');
  if (drawn.hood && hood) {
    if (explicit(hood.heightIn) !== null) gap += Math.max(0, Math.abs(hood.heightIn! * 0.0254 - drawn.hood.heightM) - 0.03);
    if (explicit(hood.aboveCounterIn) !== null) gap += Math.max(0, Math.abs(hood.aboveCounterIn! * 0.0254 - drawn.hood.aboveCounterM) - 0.03);
  }
  return HONESTY_WEIGHT * gap;
}

export function kitchenParams(spec: KitchenSpec, base: KitchenSpec): SpecParam[] {
  const out: SpecParam[] = [...dimsParams(spec)];
  const seeds = autoSeeds(spec);
  const runs = Array.isArray(spec.runs) ? spec.runs : [];
  runs.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const at = (s: RoomSpec) => (s as KitchenSpec).runs[i];
    out.push({ label: `runs[${i}].start`, kinds: CABINET_KINDS, get: (s) => at(s).start, set: (s, v) => { at(s).start = v; }, dim: { min: 0, max: 1, step: 0.05, minStep: 0.004 }, scan: T_SCAN });
    // the wall itself caps the length, per candidate (the room may change size) — see `implausibility`
    out.push({ label: `runs[${i}].lengthFt`, kinds: CABINET_KINDS, get: (s) => at(s).lengthFt, set: (s, v) => { at(s).lengthFt = v; }, dim: { min: 1, max: 40, step: 1, minStep: 0.05 } });
    // This run's own wall-cabinet height: starts at the room's, and once the
    // photo moves it the run carries its own number (null = the room's).
    // Created even when `uppersToCeiling` is set — that boolean is searchable
    // now, and gating the height on it left the optimiser with no way to
    // lower a row of uppers except to lower the CEILING, which it did.
    if (r.hasUppers !== false) {
      // A measured high/short row needs the expanded vocabulary. Conventional
      // rows keep their established search range; exposing implausible short
      // boxes without that evidence creates new ambiguous fitting basins.
      const rowHeight = r.upperHeightIn ?? spec.cabinets.upperHeightIn;
      const rowMin = isNum(r.upperBottomIn) || rowHeight < 24 ? 12 : 24;
      const rowMax = isNum(r.upperBottomIn) || rowHeight > 48 ? 60 : 48;
      if (isNum(r.upperBottomIn)) out.push({
        label: `runs[${i}].upperBottomIn`, kinds: ['upper-cabinet-run'],
        get: (s) => at(s).upperBottomIn!,
        set: (s, v) => { at(s).upperBottomIn = v; },
        dim: { min: 24, max: Math.max(24, spec.dims.ceilingFt * 12 - 12), step: 3, minStep: 0.5 },
      });
      out.push({
        label: `runs[${i}].upperHeightIn`, kinds: ['upper-cabinet-run'],
        get: (s) => at(s).upperHeightIn ?? (s as KitchenSpec).cabinets.upperHeightIn,
        set: (s, v) => { at(s).upperHeightIn = v; },
        dim: { min: rowMin, max: rowMax, step: 3, minStep: 0.5 },
        auto: (s) => !isNum((s as KitchenSpec).runs[i]?.upperHeightIn),
        scan: [rowMin, rowMax, 3],
      });
      // "the uppers run to the ceiling" is a yes/no the photo can see (a band
      // of wall over the boxes, or crown against plaster). Scan-only, and an
      // integerScan so the joint round can move it together with the ceiling
      // height and the row's own height.
      out.push({
        label: `runs[${i}].uppersToCeiling`, kinds: ['upper-cabinet-run', 'ceiling', 'wall'], search: 'scan',
        get: (s) => (at(s).uppersToCeiling ? 1 : 0),
        set: (s, v) => { at(s).uppersToCeiling = Math.round(v) >= 1; },
        dim: { min: 0, max: 1, step: 1, minStep: 1 },
        scan: [0, 1, 1],
      });
    }
    // a fridge / wall oven snaps into its tall unit, so the unit's position is what moves it
    (Array.isArray(r.tall) ? r.tall : []).forEach((t, j) => {
      if (!t || typeof t !== 'object') return;
      const kinds: readonly PhotoElementKind[] = t.kind === 'fridge-surround' ? ['tall-cabinet', 'fridge'] : t.kind === 'oven-tower' ? ['tall-cabinet', 'wall-oven'] : ['tall-cabinet'];
      out.push({ label: `runs[${i}].tall[${j}].t`, kinds, get: (s) => at(s).tall[j].t, set: (s, v) => { at(s).tall[j].t = v; }, dim: { min: 0, max: 1, step: 0.05, minStep: 0.004 }, scan: T_SCAN });
      out.push({ label: `runs[${i}].tall[${j}].widthIn`, kinds, get: (s) => at(s).tall[j].widthIn, set: (s, v) => { at(s).tall[j].widthIn = v; }, dim: { min: 12, max: 72, step: 3, minStep: 0.5 } });
      // does this pantry / surround / tower meet the ceiling? the same yes/no,
      // per unit: it decides both the unit's own box and the stretch of wall it hides
      out.push({
        label: `runs[${i}].tall[${j}].toCeiling`, kinds, search: 'scan',
        get: (s) => (at(s).tall[j].toCeiling ? 1 : 0),
        set: (s, v) => { at(s).tall[j].toCeiling = Math.round(v) >= 1; },
        dim: { min: 0, max: 1, step: 1, minStep: 1 },
        scan: [0, 1, 1],
      });
    });
  });
  out.push(...gapParams(spec), ...slideParams(spec, base));
  if (spec.island && spec.island.present) {
    const isl = (s: RoomSpec) => (s as KitchenSpec).island;
    // Real islands: 2.5–5.5 ft across, at least a quarter longer than wide,
    // never more than 16 ft or 80% of the wall they face (`implausibility`
    // holds the cross-field rules).
    out.push({ label: 'island.lengthFt', kinds: ISLAND_KINDS, get: (s) => isl(s).lengthFt, set: (s, v) => { isl(s).lengthFt = v; }, dim: { min: 2, max: 16, step: 0.5, minStep: 0.03 }, island: true });
    out.push({ label: 'island.widthFt', kinds: ISLAND_KINDS, get: (s) => isl(s).widthFt, set: (s, v) => { isl(s).widthFt = v; }, dim: { min: 2.5, max: 5.5, step: 0.25, minStep: 0.03 }, island: true });
    // How far the top cantilevers past the body on the SEATING side — a FOOT
    // of drawn depth by default, and until now the only island number no
    // photo could touch. The perimeter counter's 1.5" overhang has been
    // searched all along, and so has this one's short-end twin
    // (`endOverhangIn`); the seating overhang is eight times the first and
    // moves the island's whole front edge.
    //
    // Scanned, so it answers to the photo rather than to the gate's cap: the
    // analyzer is never asked to MEASURE it. The prompt hands it the number
    // ("overhang (12\" for seating)") the way it hands nothing else, and
    // three of the four client fixtures carry exactly 12 with the fourth at
    // 15 — a ±25% band round a constant bounds nothing. The layout's own
    // 0–20" clamp is the real bound, and the photo can see which it is: the
    // slab either cantilevers past the last door with stools under it, or
    // sits flush over it with the stools standing clear.
    //
    // FLOORED AT A FOOT WHEN STOOLS SIT ALONG THE SIDE, because a shallower
    // one is not a shape the twin can draw. `stoolPositions` tucks a side
    // stool 3" under the front edge, so its seat clears the carcass only from
    // a 10.1" overhang up — and `reconcileSpec` says the same thing about the
    // SPEC (seating with an overhang under 10" is normalised to 12"), so a
    // shallower fit would be both un-drawable and undone the next time the
    // spec is reconciled. Left free the search takes it every time: reading
    // the DRAWN top, `implausibility` charges for the overhang's depth, and
    // giving up the cantilever is the cheapest depth there is — it cost two
    // of the four client fixtures their whole seating overhang (client-marble
    // and client-marble-items both fitted to 0, burying 4 and 3 stools 10"
    // inside the cabinet). An island with no side seating has no knee space to
    // keep and keeps the full range.
    // read from `reconcileSpec`'s own rule and its own number, so a fitted
    // overhang is never one the next reconcile would raise back
    const ohMin = islandNeedsKneeRoom({ seating: isNum(spec.island.seating) ? spec.island.seating : 0, endSeats: isNum(spec.island.endSeats) ? spec.island.endSeats : 0 }) ? ISLAND_KNEE_IN : 0;
    out.push({
      label: 'island.overhangIn', kinds: ISLAND_KINDS,
      get: (s) => Math.max(ohMin, explicit(isl(s).overhangIn) ?? 12),
      set: (s, v) => { isl(s).overhangIn = Math.max(ohMin, v); },
      dim: { min: ohMin, max: 18, step: 3, minStep: 0.5 },
      scan: [ohMin, 18, 3],
    });
    const reach = (ft: number): [number, number, number] => [-ft * 0.35, ft * 0.35, 0.5];
    out.push({ label: 'island.offset.x', kinds: ISLAND_KINDS, get: (s) => isl(s).offset.x, set: (s, v) => { isl(s).offset.x = v; }, dim: { min: -20, max: 20, step: 0.5, minStep: 0.03 }, scan: reach(spec.dims.widthFt) });
    out.push({ label: 'island.offset.z', kinds: ISLAND_KINDS, get: (s) => isl(s).offset.z, set: (s, v) => { isl(s).offset.z = v; }, dim: { min: -20, max: 20, step: 0.5, minStep: 0.03 }, scan: reach(spec.dims.depthFt) });
    const seating = isNum(spec.island.seating) ? Math.round(spec.island.seating) : 0;
    if (seating > 0) {
      // the stools' pitch along the seating face (0 = auto: 28" capped by the top)
      out.push({
        label: 'island.stoolPitchIn', kinds: STOOL_KINDS,
        get: (s) => explicit(isl(s).stoolPitchIn) ?? seeds.stoolPitchIn,
        set: (s, v) => { isl(s).stoolPitchIn = v; },
        dim: { min: 16, max: 40, step: 2, minStep: 0.25 },
        auto: (s) => explicit(isl(s).stoolPitchIn) === null,
        scan: [16, 36, 2],
      });
      // How many stools sit round a short END, and WHICH end — one coordinate
      // over the pairs, not two. The count alone cannot find "the same two
      // stools, round the other end": that is one move here and two moves
      // (through a worse spec) as separate fields. An integerScan rather than
      // a nominal index, so the joint round can move it together with the
      // island's length — which is how the search finds "shorter island,
      // stools on the other end". The reconciler seats at most two per end
      // (four only under 'both'), so the pairs stop where it would pull them
      // back.
      const endMax = Math.min(4, seating);
      const combos: Array<[number, KitchenSpec['island']['endPlacement']]> = [[0, 'auto']];
      for (let n = 1; n <= endMax; n++) {
        if (n <= 2) combos.push([n, 'left'], [n, 'right']);
        if (n >= 2) combos.push([n, 'both']);
      }
      if (combos.length > 1) {
        const indexOf = (s: RoomSpec): number => {
          const it = isl(s);
          const n = isNum(it.endSeats) ? clamp(Math.round(it.endSeats), 0, endMax) : 0;
          if (n <= 0) return 0;
          const exact = combos.findIndex(([c, p]) => c === n && p === it.endPlacement);
          if (exact >= 0) return exact;
          const byCount = combos.findIndex(([c]) => c === n);
          return byCount >= 0 ? byCount : 0;
        };
        out.push({
          label: 'island.endLayout', kinds: STOOL_KINDS, search: 'scan',
          get: indexOf,
          set: (s, v) => {
            const [n, place] = combos[clamp(Math.round(v), 0, combos.length - 1)];
            isl(s).endSeats = n;
            isl(s).endPlacement = place;
          },
          dim: { min: 0, max: combos.length - 1, step: 1, minStep: 1 },
          scan: [0, combos.length - 1, 1],
        });
      }
      // how far the top cantilevers past the cabinet body at each short end:
      // at 6" and up the end stools tuck UNDER it instead of standing clear,
      // which is the difference between one island box and three
      out.push({
        label: 'island.endOverhangIn', kinds: STOOL_KINDS,
        get: (s) => explicit(isl(s).endOverhangIn) ?? 1.5,
        set: (s, v) => { isl(s).endOverhangIn = v; },
        dim: { min: 0, max: 18, step: 3, minStep: 0.5 },
        auto: (s) => explicit(isl(s).endOverhangIn) === null,
        scan: [0, 15, 3],
      });
      // the side-stool row shifted along the island from centred
      out.push({
        label: 'island.stoolOffsetIn', kinds: STOOL_KINDS,
        get: (s) => (isNum(isl(s).stoolOffsetIn) ? isl(s).stoolOffsetIn : 0),
        set: (s, v) => { isl(s).stoolOffsetIn = v; },
        dim: { min: -60, max: 60, step: 6, minStep: 0.5 },
        scan: [-36, 36, 6],
      });
    }
  }
  const appliances = Array.isArray(spec.appliances) ? spec.appliances : [];
  const baseAppliances = Array.isArray(base.appliances) ? base.appliances : [];
  appliances.forEach((a, i) => {
    if (!a || typeof a !== 'object') return;
    const at = (s: RoomSpec) => (s as KitchenSpec).appliances[i];
    const kinds: PhotoElementKind[] = a.kind === 'wine-fridge' ? ['other'] : a.kind === 'range' || a.kind === 'cooktop' ? [a.kind, 'hood'] : [a.kind];
    // A hood hangs over its range in the layout and the reconciler, so it has
    // no position of its own: moving the range moves the hood's `t` with it
    // and the spec never says one thing while the scene draws another.
    if (a.kind !== 'hood') {
      const set = (s: RoomSpec, v: number) => {
        const me = at(s);
        me.t = v;
        if (me.kind !== 'range' && me.kind !== 'cooktop') return;
        for (const h of (s as KitchenSpec).appliances) if (h && h.kind === 'hood' && h.wall === me.wall) h.t = v;
      };
      // scanned finely: the layout snaps an appliance into any gap within
      // reach, so the stretch of wall where it is drawn where the spec says
      // can be a few inches wide between two gaps' pull
      out.push({ label: `appliances[${i}].t`, kinds, get: (s) => at(s).t, set, dim: { min: 0, max: 1, step: 0.05, minStep: 0.004 }, scan: [0, 1, 0.02] });
    }
    // widths come from real appliances (a 36" range is a 36" range): the photo
    // may nudge one by half a foot, never turn a dishwasher into a fridge
    const w0 = baseAppliances[i] && isNum(baseAppliances[i].widthIn) ? baseAppliances[i].widthIn : a.widthIn;
    const [wMin, wMax0] = around(w0, 6, 12, 60);
    let wMax = wMax0;
    let wCap: number | undefined;
    // A hood is built for the opening it hangs over, so a hood on the same
    // wall is a SECOND, independent measurement of the range's width in the
    // analyzer's own spec — and where the two disagree it is the range that is
    // usually wrong (client-tan: a 42" hood written over a 30" range, which
    // ±6" can never reach). Widen the band to the hood, and widen this one
    // field's gate cap by exactly as much as the band moved, or `boundSizes`
    // would clamp the search straight back to ±27%. This only opens a door:
    // the width is still scored against the photo's own `range` box (and its
    // `cooktop` alias), so a picture that shows a 30" range keeps one —
    // verified on client-marble-items, where a 48" hood over a 36" range
    // stays at 36.
    if ((a.kind === 'range' || a.kind === 'cooktop') && isNum(w0)) {
      const hoodW = appliances.reduce((best, h) => (h && typeof h === 'object' && h.kind === 'hood' && h.wall === a.wall && isNum(h.widthIn) ? Math.max(best, h.widthIn) : best), 0);
      if (hoodW > wMax) {
        wMax = Math.min(60, hoodW);
        wCap = (wMax - w0) / sizeBase(w0) + SEARCH_HEADROOM;
      }
    }
    // NOTE — this band is currently INERT for a BUILT-IN appliance, and the
    // measurement that says so also says why it must stay that way for now.
    // The layout draws a built-in at the width of the `'appliance-gap'` it
    // sits in, not at `widthIn`, so the projected range box on client-tan is
    // byte-identical at every width from 24 to 42 in. Coupling the field to
    // its gap so the search can move it was built and measured, and it breaks
    // rule 5: through the fixture cameras the best range width is 30 in on
    // client-tan (pair IoU 0.7365, falling to 0.5829 at 42) while on
    // client-marble-items it rises monotonically 0.3210 at 30 in → 0.4788 at
    // 48 in — the range there is badly localised, so wider simply overlaps
    // more — and the full fit then writes 42–45 in where 36 is right. So the
    // band and the cap are landed (they cost nothing and they are the
    // mechanism the contract asked for), and the field stays inert until the
    // gap moves with it. See the FIT report: the hood-vs-range contradiction
    // is not correctable by geometry on this photo.
    out.push({ label: `appliances[${i}].widthIn`, kinds, get: (s) => at(s).widthIn, set: (s, v) => { at(s).widthIn = v; }, dim: { min: wMin, max: wMax, step: 3, minStep: 0.5 }, ...(wCap === undefined ? {} : { cap: wCap }) });
    if (a.kind === 'fridge') {
      // the body's height (null = 70", a built-in 84")
      out.push({
        label: `appliances[${i}].heightIn`, kinds: ['fridge', 'tall-cabinet'],
        get: (s) => explicit(at(s).heightIn) ?? seeds.fridgeHeightIn,
        set: (s, v) => { at(s).heightIn = v; },
        dim: { min: 48, max: 96, step: 3, minStep: 0.5 },
        auto: (s) => explicit(at(s).heightIn) === null,
        scan: [60, 90, 3],
      });
    } else if (a.kind === 'hood' && a.hoodShape !== 'slim' && a.hoodStyle !== 'under-cabinet') {
      // canopy + duct cover from the mouth up (null = to the ceiling), and the
      // mouth's height over the counter (null = 30")
      const hoodMin = explicit(a.heightIn) !== null && a.heightIn! < 12 ? 6 : 12;
      out.push({
        label: `appliances[${i}].heightIn`, kinds: ['hood'],
        get: (s) => explicit(at(s).heightIn) ?? seeds.hoodHeightIn,
        set: (s, v) => { at(s).heightIn = v; },
        dim: { min: hoodMin, max: 96, step: 3, minStep: 0.5 },
        auto: (s) => explicit(at(s).heightIn) === null,
        scan: [hoodMin, 72, 3],
      });
      // the mouth's height over the counter. The floor is the layout's own
      // clamp (20"): both client fixtures used to sit ON the old 24" scan
      // floor, which is the search saying "lower still, please".
      out.push({
        label: `appliances[${i}].aboveCounterIn`, kinds: ['hood'],
        get: (s) => explicit(at(s).aboveCounterIn) ?? seeds.hoodMouthIn,
        set: (s, v) => { at(s).aboveCounterIn = v; },
        dim: { min: 20, max: 48, step: 2, minStep: 0.5 },
        scan: [20, 42, 2],
      });
    }
    // Is there a cabinet on the hood? The client's own words: "above the vent,
    // there are always cabinets but the 3d model never renders them." Searched
    // ONLY when the spec left it null — an explicit word from the analyzer or
    // the client is a measurement, never something the fitter overwrites. A
    // count-shaped scan (like the old backsplash category) so `integerScan`
    // carries it into the joint round and the size gate never caps it.
    if (a.kind === 'hood' && a.cabinetAbove == null && resolveHoodShape(a) !== 'slim' && resolveHoodStyle(a) !== 'island') {
      out.push({
        label: `appliances[${i}].cabinetAbove`, kinds: ['hood', 'upper-cabinet-run'], search: 'scan',
        get: (s) => (resolveCabinetAbove(at(s), true) === 'none' ? 0 : 1),
        set: (s, v) => { at(s).cabinetAbove = Math.round(v) >= 1 ? 'doors' : 'none'; },
        dim: { min: 0, max: 1, step: 1, minStep: 1 },
        scan: [0, 1, 1],
        auto: () => true,
      });
    }
  });
  // How far up the wall the splash goes, in INCHES. The three-way category
  // (standard / ledge / full-height) could only ever draw three heights, and
  // a photo's slab stops where it stops — under a clerestory sill, at the
  // hood's mouth, halfway up a chimney breast. Seeded from what the scene
  // currently draws, so a spec that left the field null starts where it is.
  if (spec.backsplash && typeof spec.backsplash === 'object' && spec.backsplash.present !== false) {
    const ceilingFt = isNum(spec.dims?.ceilingFt) ? spec.dims.ceilingFt : 9;
    const maxIn = Math.max(12, ceilingFt * 12 - 38);
    out.push({
      label: 'backsplash.heightIn', kinds: ['backsplash'],
      get: (s) => explicit((s as KitchenSpec).backsplash.heightIn) ?? seeds.splashHeightIn,
      set: (s, v) => { (s as KitchenSpec).backsplash.heightIn = v; },
      dim: { min: 4, max: maxIn, step: 3, minStep: 0.5 },
      auto: (s) => explicit((s as KitchenSpec).backsplash.heightIn) === null,
      scan: [4, Math.min(96, maxIn), 6],
    });
  }
  // the perimeter counter's front overhang. Its effect in frame is under the
  // detector's own precision, so it is deliberately a narrow pattern search:
  // a fidelity and pricing field that the photo may nudge, not steer.
  if (spec.countertop && typeof spec.countertop === 'object') {
    out.push({
      label: 'countertop.overhangIn', kinds: ['base-cabinet-run'],
      get: (s) => explicit((s as KitchenSpec).countertop.overhangIn) ?? 1.5,
      set: (s, v) => { (s as KitchenSpec).countertop.overhangIn = v; },
      dim: { min: 0.5, max: 3, step: 0.5, minStep: 0.25 },
      auto: (s) => explicit((s as KitchenSpec).countertop.overhangIn) === null,
      search: 'pattern',
    });
  }
  const sink = spec.sink;
  if (sink && typeof sink === 'object') {
    const sk = (s: RoomSpec) => (s as KitchenSpec).sink;
    out.push({ label: 'sink.t', kinds: ['sink', 'faucet'], get: (s) => sk(s).t, set: (s, v) => { sk(s).t = v; }, dim: { min: 0, max: 1, step: 0.05, minStep: 0.004 }, scan: T_SCAN });
    out.push({ label: 'sink.widthIn', kinds: ['sink', 'faucet'], get: (s) => sk(s).widthIn, set: (s, v) => { sk(s).widthIn = v; }, dim: { min: 15, max: 48, step: 3, minStep: 0.5 } });
  }
  out.push({ label: 'cabinets.upperHeightIn', kinds: ['upper-cabinet-run'], get: (s) => (s as KitchenSpec).cabinets.upperHeightIn, set: (s, v) => { (s as KitchenSpec).cabinets.upperHeightIn = v; }, dim: { min: spec.cabinets.upperHeightIn < 24 ? 12 : 24, max: 48, step: 3, minStep: 0.5 } });
  const pend = spec.lighting && typeof spec.lighting === 'object' ? spec.lighting.pendants : null;
  if (pend && typeof pend === 'object' && isNum(pend.count) && pend.count >= 1) {
    const pd = (s: RoomSpec) => (s as KitchenSpec).lighting.pendants!;
    const along = spec.island?.present ? Math.max(3, spec.island.lengthFt) : 6;
    const positions = Array.isArray(pend.positions) ? pend.positions : null;
    if (positions && positions.length) {
      // Explicit hook points: each shade moves on its own. The evenly spaced
      // row's spread / offset say nothing once the spec has hooks — searching
      // both would be two coordinates fighting over one drawing.
      positions.forEach((_, k) => {
        const at = (s: RoomSpec) => (s as KitchenSpec).lighting.pendants?.positions?.[k];
        const reachAlong = along / 2 + 2;
        out.push({
          label: `lighting.pendants.positions[${k}].alongFt`, kinds: ['pendant'],
          get: (s) => at(s)?.alongFt ?? 0,
          set: (s, v) => { const q = at(s); if (q) q.alongFt = v; },
          dim: { min: -reachAlong, max: reachAlong, step: 0.5, minStep: 0.03 },
          scan: [-along / 2, along / 2, 0.5],
        });
        out.push({
          label: `lighting.pendants.positions[${k}].acrossFt`, kinds: ['pendant'], search: 'pattern',
          get: (s) => at(s)?.acrossFt ?? 0,
          set: (s, v) => { const q = at(s); if (q) q.acrossFt = v; },
          dim: { min: -3, max: 3, step: 0.25, minStep: 0.03 },
        });
      });
    } else {
      if (pend.count > 1) {
        out.push({
          label: 'lighting.pendants.spreadFt', kinds: ['pendant'],
          get: (s) => explicit(pd(s).spreadFt) ?? seeds.pendantSpreadFt,
          set: (s, v) => { pd(s).spreadFt = v; },
          dim: { min: 0.5, max: 16, step: 0.5, minStep: 0.03 },
          auto: (s) => explicit(pd(s).spreadFt) === null,
          scan: [0.5, Math.min(16, along), 0.5],
        });
      }
      const reach = Math.min(8, along * 0.4);
      out.push({ label: 'lighting.pendants.offsetFt', kinds: ['pendant'], get: (s) => pd(s).offsetFt, set: (s, v) => { pd(s).offsetFt = v; }, dim: { min: -8, max: 8, step: 0.5, minStep: 0.03 }, scan: [-reach, reach, 0.5] });
    }
    out.push({
      label: 'lighting.pendants.aboveCounterIn', kinds: ['pendant'],
      get: (s) => explicit(pd(s).aboveCounterIn) ?? 32,
      set: (s, v) => { pd(s).aboveCounterIn = v; },
      dim: { min: 12, max: 60, step: 2, minStep: 0.25 },
      auto: (s) => explicit(pd(s).aboveCounterIn) === null,
      scan: [18, 48, 2],
    });
  }
  out.push(...openingParams(spec), ...decorParams(spec));
  return out;
}

/**
 * What the bathroom scene DREW for the sizes whose spec field is `null`
 * ("as the scene has always drawn it"). Read off the solved layout rather
 * than restating the layout's defaults here, exactly as `autoSeeds` does for
 * the kitchen: a duplicated constant is a lie the moment the layout clamps
 * the value to a small room, and the search must start from the twin the
 * photo is actually being compared against.
 */
interface BathSeeds { vanityHeightIn: number; vanityDepthIn: number; tubWidthIn: number }
function bathSeeds(spec: BathroomSpec): BathSeeds {
  const seeds: BathSeeds = { vanityHeightIn: 34, vanityDepthIn: 21, tubWidthIn: 30 };
  let L: BathLayout;
  try { L = computeBathroomLayout(spec); } catch { return seeds; }
  if (L.vanity) {
    seeds.vanityHeightIn = L.vanity.topH * M_TO_IN;
    // `Placed.depth` is the footprint the collision solver reserves — the
    // carcase plus 1.5" of clearance. The spec field is the CARCASE.
    seeds.vanityDepthIn = L.vanity.bodyDepth * M_TO_IN;
  }
  // `widthIn` is the tub body ACROSS the room; the layout's `depth` is that
  // body plus the kind's wall gap, and `across` is the body itself.
  if (L.tub) seeds.tubWidthIn = L.tub.across * M_TO_IN;
  return seeds;
}

export function bathroomParams(spec: BathroomSpec): SpecParam[] {
  const out: SpecParam[] = [...dimsParams(spec)];
  const tDim: Dim = { min: 0, max: 1, step: 0.05, minStep: 0.004 };
  const seeds = bathSeeds(spec);
  if (spec.vanity?.present) {
    out.push({ label: 'vanity.t', kinds: ['vanity', 'mirror', 'sink', 'faucet'], get: (s) => (s as BathroomSpec).vanity.t, set: (s, v) => { (s as BathroomSpec).vanity.t = v; }, dim: tDim, scan: T_SCAN });
    out.push({ label: 'vanity.widthIn', kinds: ['vanity', 'mirror'], get: (s) => (s as BathroomSpec).vanity.widthIn, set: (s, v) => { (s as BathroomSpec).vanity.widthIn = v; }, dim: { min: 18, max: 120, step: 6, minStep: 0.5 } });
    // The counter's height off the floor. A photo measures this well — the
    // vanity box's TOP is the counter, and the mirror band and every basin and
    // tap ride on it, so four of the inventory's boxes move together with it.
    // Bounds are the layout's own clamp (28"–40"): outside that the layout
    // would clamp the value back and the search would score a spec it is not
    // being shown.
    out.push({
      label: 'vanity.heightIn', kinds: ['vanity', 'mirror', 'sink', 'faucet'],
      get: (s) => explicit((s as BathroomSpec).vanity.heightIn) ?? seeds.vanityHeightIn,
      set: (s, v) => { (s as BathroomSpec).vanity.heightIn = v; },
      dim: { min: 28, max: 40, step: 1, minStep: 0.25 },
      auto: (s) => explicit((s as BathroomSpec).vanity.heightIn) === null,
    });
    // Depth INTO the room. A photo measures it only obliquely (the counter's
    // front edge against the floor), so it is searched but never scanned: a
    // 14"–26" sweep of a weakly-observed axis is how a fit starts hallucinating
    // a 26" powder-room vanity.
    out.push({
      label: 'vanity.depthIn', kinds: ['vanity', 'sink'],
      get: (s) => explicit((s as BathroomSpec).vanity.depthIn) ?? seeds.vanityDepthIn,
      set: (s, v) => { (s as BathroomSpec).vanity.depthIn = v; },
      dim: { min: 14, max: 26, step: 1, minStep: 0.25 },
      auto: (s) => explicit((s as BathroomSpec).vanity.depthIn) === null,
    });
  }
  if (spec.shower?.present) {
    out.push({ label: 'shower.t', kinds: ['shower'], get: (s) => (s as BathroomSpec).shower.t, set: (s, v) => { (s as BathroomSpec).shower.t = v; }, dim: tDim, scan: T_SCAN });
    out.push({ label: 'shower.widthIn', kinds: ['shower'], get: (s) => (s as BathroomSpec).shower.widthIn, set: (s, v) => { (s as BathroomSpec).shower.widthIn = v; }, dim: { min: 30, max: 120, step: 6, minStep: 0.5 } });
    out.push({ label: 'shower.depthIn', kinds: ['shower'], get: (s) => (s as BathroomSpec).shower.depthIn, set: (s, v) => { (s as BathroomSpec).shower.depthIn = v; }, dim: { min: 30, max: 96, step: 6, minStep: 0.5 } });
  }
  if (spec.tub?.present) {
    out.push({ label: 'tub.t', kinds: ['tub'], get: (s) => (s as BathroomSpec).tub.t, set: (s, v) => { (s as BathroomSpec).tub.t = v; }, dim: tDim, scan: T_SCAN });
    out.push({ label: 'tub.lengthIn', kinds: ['tub'], get: (s) => (s as BathroomSpec).tub.lengthIn, set: (s, v) => { (s as BathroomSpec).tub.lengthIn = v; }, dim: { min: 48, max: 84, step: 6, minStep: 0.5 } });
    // The tub's other measured dimension. `lengthIn` runs ALONG the wall and
    // `widthIn` across it, so on a back-wall tub the length is read straight
    // off the photo and the width is the depth axis — the pair is what tells a
    // 30" alcove tub from a 42" drop-in deck at the same length.
    out.push({
      label: 'tub.widthIn', kinds: ['tub'],
      get: (s) => explicit((s as BathroomSpec).tub.widthIn) ?? seeds.tubWidthIn,
      set: (s, v) => { (s as BathroomSpec).tub.widthIn = v; },
      dim: { min: 24, max: 48, step: 2, minStep: 0.5 },
      auto: (s) => explicit((s as BathroomSpec).tub.widthIn) === null,
    });
  }
  if (spec.toilet?.present) {
    out.push({ label: 'toilet.t', kinds: ['toilet'], get: (s) => (s as BathroomSpec).toilet.t, set: (s, v) => { (s as BathroomSpec).toilet.t = v; }, dim: tDim, scan: T_SCAN });
  }
  out.push(...openingParams(spec), ...decorParams(spec));
  return out;
}

// ---------------------------------------------------------------------------
// Bounds, edges, scale
// ---------------------------------------------------------------------------

/** The gate's per-field cap on a size, relative to the analyzer's value. */
export const sizeCap = (p: SpecParam) => (typeof p.cap === 'number' && Number.isFinite(p.cap) ? Math.max(p.cap, p.island ? GATE_MAX_CHANGE_ISLAND : GATE_MAX_CHANGE) : p.island ? GATE_MAX_CHANGE_ISLAND : GATE_MAX_CHANGE);
/** The base a size change is measured against: at least a foot / an inch, so a 0.5 → 0.8 ft sill is not a "60% change". */
export const sizeBase = (from: number) => Math.max(Math.abs(from), 1);
/**
 * Positions, auto values, derived coordinates and sizes the photo could not
 * measure (`unmeasured` — the box is cut on that axis) answer to the photo,
 * not to the cap. One predicate does all four jobs: it bounds the SEARCH
 * (`boundSizes`), it decides the GATE (`oversizedChanges`) and it selects the
 * fields the fit's PRIOR pulls back toward the analyzer (`fit.ts`), so a size
 * nobody measured is free in all three at once.
 */
export const capped = (p: SpecParam, original: RoomSpec) => !p.scan && !p.derived && !p.unmeasured && !(p.auto && p.auto(original));

/**
 * Every size is searched only within the gate's cap of the analyzer's value
 * (a little inside it, so the reconciler's rounding cannot push a fitted
 * size over). Bounding the SEARCH rather than only checking the RESULT means
 * the fit finds the best plausible spec instead of an implausible one that
 * is then thrown away whole. A size the analyzer already put outside its
 * physical range is dropped from the search rather than jumped to the edge.
 */
export function boundSizes(params: SpecParam[], original: RoomSpec): SpecParam[] {
  const out: SpecParam[] = [];
  for (const p of params) {
    if (!capped(p, original)) { out.push(p); continue; }
    const from = safeGet(p, original);
    if (from === null) { out.push(p); continue; }
    const span = Math.max(0, sizeCap(p) - SEARCH_HEADROOM) * sizeBase(from);
    const min = Math.max(p.dim.min, from - span), max = Math.min(p.dim.max, from + span);
    if (min > max) continue;
    out.push({ ...p, dim: { ...p.dim, min, max } });
  }
  return out;
}

/**
 * A wall element is stored as (position along the wall, size) but is best
 * SEARCHED by its two EDGES: an IoU answers to each edge on its own, while a
 * size step moves both edges and a position step moves both the same way,
 * so coordinate descent on (t, width) stalls on the diagonal whenever one
 * edge is already right (a 5 ft window whose right jamb lines up never got
 * back to 4 ft). The edges are feet along the wall from its left end (for
 * the island: feet from the room centre along the axis). Moving one edge
 * keeps the other where it is; the size stays inside its own bounds (the
 * gate's cap) and a fraction position inside [0, 1]. The position field is
 * then only scanned, the size field not searched by name at all.
 */
function edgeParams(
  label: string, pos: SpecParam, size: SpecParam,
  len: (spec: RoomSpec) => number,
  opts: { centre: boolean; frac: boolean; unit: number; span: number },
): SpecParam[] {
  const sizeFt = (s: RoomSpec) => size.get(s) * opts.unit;
  const posFt = (s: RoomSpec) => (opts.frac ? pos.get(s) * len(s) : pos.get(s));
  const lo = (s: RoomSpec) => (opts.centre ? posFt(s) - sizeFt(s) / 2 : posFt(s));
  const hi = (s: RoomSpec) => lo(s) + sizeFt(s);
  const write = (s: RoomSpec, l: number, h: number) => {
    const sz = clamp(h - l, size.dim.min * opts.unit, size.dim.max * opts.unit);
    const l2 = opts.centre ? (l + h) / 2 - sz / 2 : l;
    const p = opts.centre ? l2 + sz / 2 : l2;
    pos.set(s, opts.frac ? clamp(p / Math.max(1e-6, len(s)), pos.dim.min, pos.dim.max) : clamp(p, pos.dim.min, pos.dim.max));
    size.set(s, sz / opts.unit);
  };
  const dim = (base: number): Dim => ({ min: base - opts.span - 1, max: base + opts.span + 1, step: 0.5, minStep: 0.03 });
  const flags = { kinds: pos.kinds, derived: true, search: 'pattern' as const, island: size.island };
  return [
    { label: `${label}.lo`, ...flags, get: lo, set: (s, v) => write(s, v, hi(s)), dim: dim(opts.centre ? -opts.span / 2 : 0) },
    { label: `${label}.hi`, ...flags, get: hi, set: (s, v) => write(s, lo(s), v), dim: dim(opts.centre ? opts.span / 2 : opts.span) },
  ];
}

/**
 * The search coordinates for a bounded field list: every (position, size)
 * pair of a wall element becomes its two edges, and the room gets a joint
 * SCALE (dims + island offset + camera about the room's centre — the size
 * mistake an analyzer makes as a whole, which a width step and a depth step
 * taken one at a time only ever half-fix).
 */
export function withSearchCoordinates(fields: SpecParam[], spec: KitchenSpec | BathroomSpec): SpecParam[] {
  const byLabel = new Map(fields.map((p) => [p.label, p]));
  const out: SpecParam[] = [];
  const used = new Set<string>();
  const wallLenAt = (wall: Wall) => (s: RoomSpec) => wallFtOf(s as KitchenSpec, wall);
  const pair = (label: string, posLabel: string, sizeLabel: string, len: (s: RoomSpec) => number, opts: { centre: boolean; frac: boolean; unit: number; span: number }) => {
    const pos = byLabel.get(posLabel), size = byLabel.get(sizeLabel);
    if (!pos || !size) return;
    used.add(posLabel); used.add(sizeLabel);
    out.push({ ...pos, search: 'scan' }, { ...size, search: 'none' }, ...edgeParams(label, pos, size, len, opts));
  };
  if (spec.roomType === 'kitchen') {
    (Array.isArray(spec.runs) ? spec.runs : []).forEach((r, i) => {
      if (r && typeof r === 'object') pair(`runs[${i}]`, `runs[${i}].start`, `runs[${i}].lengthFt`, wallLenAt(r.wall), { centre: false, frac: true, unit: 1, span: wallFtOf(spec, r.wall) });
    });
    if (spec.island?.present) {
      const rot = spec.island.rotationDeg >= 45;
      const along = (s: RoomSpec) => (rot ? (s as KitchenSpec).dims.depthFt : (s as KitchenSpec).dims.widthFt);
      const across = (s: RoomSpec) => (rot ? (s as KitchenSpec).dims.widthFt : (s as KitchenSpec).dims.depthFt);
      pair('island.along', rot ? 'island.offset.z' : 'island.offset.x', 'island.lengthFt', along, { centre: true, frac: false, unit: 1, span: along(spec) });
      pair('island.across', rot ? 'island.offset.x' : 'island.offset.z', 'island.widthFt', across, { centre: true, frac: false, unit: 1, span: across(spec) });
    }
  } else {
    if (spec.vanity?.present) pair('vanity', 'vanity.t', 'vanity.widthIn', wallLenAt(spec.vanity.wall), { centre: true, frac: true, unit: 1 / 12, span: wallFtOf(spec, spec.vanity.wall) });
    if (spec.shower?.present) pair('shower', 'shower.t', 'shower.widthIn', wallLenAt(spec.shower.wall), { centre: true, frac: true, unit: 1 / 12, span: wallFtOf(spec, spec.shower.wall) });
    if (spec.tub?.present) pair('tub', 'tub.t', 'tub.lengthIn', wallLenAt(spec.tub.wall), { centre: true, frac: true, unit: 1 / 12, span: wallFtOf(spec, spec.tub.wall) });
  }
  (Array.isArray(spec.openings) ? spec.openings : []).forEach((o, i) => {
    if (o && typeof o === 'object') pair(`openings[${i}]`, `openings[${i}].t`, `openings[${i}].widthFt`, wallLenAt(o.wall), { centre: true, frac: true, unit: 1, span: wallFtOf(spec, o.wall) });
  });
  (spec.decor && Array.isArray(spec.decor.shelves) ? spec.decor.shelves : []).forEach((sh, i) => {
    if (sh && typeof sh === 'object') pair(`decor.shelves[${i}]`, `decor.shelves[${i}].t`, `decor.shelves[${i}].widthIn`, wallLenAt(sh.wall), { centre: true, frac: true, unit: 1 / 12, span: wallFtOf(spec, sh.wall) });
  });
  // The VERTICAL edges, for the same reason the horizontal ones exist: a
  // window's head and a shelf run's top board are what the photo fixes, and
  // stepping (sill, height) or (bottom, spacing) one at a time stalls on the
  // diagonal whenever the bottom edge is already right. Neither is stored:
  // the analyzer writes sill + height, and a third number could only
  // contradict them, so these coordinates WRITE the field they came from.
  (Array.isArray(spec.openings) ? spec.openings : []).forEach((o, i) => {
    if (!o || typeof o !== 'object' || o.kind !== 'window') return;
    const sill = byLabel.get(`openings[${i}].sillFt`), height = byLabel.get(`openings[${i}].heightFt`);
    if (!sill || !height) return;
    used.add(`openings[${i}].heightFt`);
    out.push({ ...height, search: 'none' });
    out.push({
      label: `openings[${i}].head`, kinds: height.kinds, derived: true, search: 'pattern',
      get: (s) => sill.get(s) + height.get(s),
      set: (s, v) => { height.set(s, clamp(v - sill.get(s), height.dim.min, height.dim.max)); },
      dim: { min: 0.5, max: 24, step: 0.5, minStep: 0.03 },
    });
  });
  (spec.decor && Array.isArray(spec.decor.shelves) ? spec.decor.shelves : []).forEach((sh, i) => {
    if (!sh || typeof sh !== 'object' || (sh.count ?? 1) <= 1) return;
    const bottom = byLabel.get(`decor.shelves[${i}].bottomFt`), spacing = byLabel.get(`decor.shelves[${i}].spacingIn`);
    if (!bottom || !spacing) return;
    const boards = Math.max(2, Math.round(sh.count));
    used.add(`decor.shelves[${i}].spacingIn`);
    out.push({ ...spacing, search: 'none' });
    out.push({
      label: `decor.shelves[${i}].top`, kinds: spacing.kinds, derived: true, search: 'pattern',
      get: (s) => bottom.get(s) + (boards - 1) * spacing.get(s) / 12,
      set: (s, v) => { spacing.set(s, clamp((v - bottom.get(s)) * 12 / (boards - 1), spacing.dim.min, spacing.dim.max)); },
      dim: { min: 2, max: 12, step: 0.5, minStep: 0.03 },
    });
  });
  for (const p of fields) if (!used.has(p.label)) out.push(p);

  const width = byLabel.get('dims.widthFt'), depth = byLabel.get('dims.depthFt');
  if (width && depth) {
    out.push({
      label: 'room.scale', kinds: ALL_KINDS, derived: true, search: 'pattern', neutral: 1,
      // relative: every step scales the room by the value (1 = as it is)
      get: () => 1,
      set: (s, v) => {
        if (!isSingleRoom(s)) return;
        const w = clamp(s.dims.widthFt * v, width.dim.min, width.dim.max);
        const d = clamp(s.dims.depthFt * v, depth.dim.min, depth.dim.max);
        const f = Math.min(w / s.dims.widthFt, d / s.dims.depthFt);
        s.dims.widthFt = w; s.dims.depthFt = d;
        if (s.roomType === 'kitchen' && s.island?.offset) s.island.offset = { x: s.island.offset.x * f, z: s.island.offset.z * f };
      },
      dim: { min: 0.5, max: 2, step: 0.05, minStep: 0.005 },
      moveCamera: (before, after, cam) => scaleCamera(cam, roomSize(after).w / Math.max(1e-6, roomSize(before).w)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Physical rules and the gate's bookkeeping
// ---------------------------------------------------------------------------

/**
 * How far a spec breaks the physical rules the photo may not talk it out of,
 * as one number (0 = fine) so a candidate is judged against the spec it came
 * from rather than refused outright — an input that already breaks a rule
 * can still be improved, it just may not get worse:
 *   - an island is 2.5–5.5 ft across, at least 1.25× as long as it is wide,
 *     and no longer than 16 ft or 80% of the wall it faces;
 *   - a cabinet run, a vanity, a tub or a shower is no longer than its wall,
 *     and two runs on one wall do not overlap.
 */
export function implausibility(spec: RoomSpec): number {
  if (!isSingleRoom(spec)) return 0;
  const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  let bad = 0;
  const over = (v: number, max: number) => { if (v > max) bad += v - max; };
  const under = (v: number, min: number) => { if (v < min) bad += min - v; };
  if (spec.roomType === 'kitchen') {
    const isl = spec.island;
    if (isl && typeof isl === 'object' && isl.present) {
      const len = n(isl.lengthFt, 6), wide = n(isl.widthFt, 3.5);
      under(wide, 2.5); over(wide, 5.5);
      // "longer than it is wide" is a rule about the BLOCK, so it is measured
      // on the COUNTERTOP the layout draws, not on the declared body. The
      // seating overhang is added to the body (a foot of it by default), and
      // read off `widthFt` alone the rule waves through exactly the island the
      // client rejected: client-tan declares 5.0 × 4.1 ft — 1.22, a hair under
      // the rule — and the drawn top is 5.00 × 5.22 ft, DEEPER than it is
      // long. Reading the drawn top also stops the overhang (searched since
      // this round) from being the way a search inflates an island into a slab.
      const top = islandTopFt(isl);
      under(top ? top.len : len, 1.25 * (top ? top.wide : wide));
      const faces = n(isl.rotationDeg, 0) >= 45 ? n(spec.dims?.depthFt, 12) : n(spec.dims?.widthFt, 14);
      over(len, Math.min(16, 0.8 * faces));
    }
    const runs = (Array.isArray(spec.runs) ? spec.runs : []).filter((r) => r && typeof r === 'object');
    runs.forEach((r, i) => {
      const wall = wallFtOf(spec, r.wall);
      over(n(r.lengthFt, 0), wall);
      // …and a run is no SHORTER than the boxes it cannot shrink. A tall
      // column is a fixed width and an `appliance-gap` is the appliance's, so
      // a run searched below them is a run nobody can build: client-marble's
      // `run-back-fridge` came back 34.7 in long holding a 39 in fridge
      // surround and a 36 in void, and the layout then drew its whole base
      // list as nothing. Gaps and talls are MAXed, not summed — a fridge void
      // normally sits INSIDE its surround, and counting both would demand
      // 75 in for a 39 in column. Soft, like every rule here, so the search
      // can narrow the COLUMN and the run together rather than being pinned to
      // whatever the analyzer declared: `dim.min` is fixed at parameter-build
      // time and could only ever floor the run at the FIRST tall width it saw.
      const widthsIn = (xs: unknown) => (Array.isArray(xs) ? xs : [])
        .reduce((t: number, b) => t + (b && typeof b === 'object' ? n((b as { widthIn?: unknown }).widthIn, 0) : 0), 0);
      const gapBoxes = (Array.isArray(r.base) ? r.base : []).filter((b) => b && typeof b === 'object' && b.type === 'appliance-gap');
      under(n(r.lengthFt, 0), Math.max(widthsIn(gapBoxes), widthsIn(r.tall)) / 12);
      // two runs on one wall (a main run and a fridge run) may not be drawn
      // through each other — the fit once slid a fridge run into the middle
      // of the wall so the range could borrow its gap
      const a0 = n(r.start, 0) * wall, a1 = a0 + n(r.lengthFt, 0);
      for (let j = 0; j < i; j++) {
        const q = runs[j];
        if (q.wall !== r.wall) continue;
        const b0 = n(q.start, 0) * wall, b1 = b0 + n(q.lengthFt, 0);
        over(Math.min(a1, b1) - Math.max(a0, b0), 0);
      }
    });
  } else {
    const inFt = (v: unknown) => n(v, 0) / 12;
    if (spec.vanity?.present) over(inFt(spec.vanity.widthIn), wallFtOf(spec, spec.vanity.wall));
    if (spec.tub?.present) over(inFt(spec.tub.lengthIn), wallFtOf(spec, spec.tub.wall));
    if (spec.shower?.present) over(inFt(spec.shower.widthIn), wallFtOf(spec, spec.shower.wall));
  }
  return bad;
}

/**
 * The reconciler has its own ideas about where things go — it snaps an
 * appliance to the nearest gap in the cabinet list, which is a fine guess for
 * an analyzer's number and a bad one for a MEASURED one. Every field the fit
 * changed (against the input) is put back to its fitted value when the
 * reconciler moved it by more than rounding; the reconciler's other work
 * (cabinet rows refitted to new lengths, ids, materials) stands. Returns the
 * labels put back.
 */
export function restoreFitted(reconciled: RoomSpec, fitted: RoomSpec, original: RoomSpec, params: SpecParam[]): string[] {
  const restored: string[] = [];
  for (const p of params) {
    const want = safeGet(p, fitted), was = safeGet(p, original), got = safeGet(p, reconciled);
    if (want === null || was === null || got === null) continue;
    if (Math.abs(want - was) < 1e-9) continue;
    const tolerance = p.dim.max === 1 && p.dim.min === 0 ? 0.02 : 0.05 * Math.max(Math.abs(want), 0.5);
    if (Math.abs(got - want) <= tolerance) continue;
    try { p.set(reconciled, want); restored.push(p.label); } catch { /* the reconciler removed it — nothing to put back */ }
  }
  return restored;
}

/** Which sizes the fit changed by more than the gate allows (positions and auto values are exempt — they are what the photo fixes). */
export function oversizedChanges(params: SpecParam[], original: RoomSpec, fitted: RoomSpec): Array<{ label: string; from: number; to: number; rel: number; cap: number }> {
  const out: Array<{ label: string; from: number; to: number; rel: number; cap: number }> = [];
  for (const p of params) {
    if (!capped(p, original)) continue;
    const from = safeGet(p, original), to = safeGet(p, fitted);
    if (from === null || to === null) continue;
    const rel = Math.abs(to - from) / sizeBase(from);
    const cap = sizeCap(p);
    if (rel > cap + 1e-6) out.push({ label: p.label, from, to, rel, cap });
  }
  return out;
}

/** Round to what a contractor would write down — nobody wants an island 6.9371 ft long. */
export function tidy(spec: RoomSpec): RoomSpec {
  const r2 = (n: number) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const r3 = (n: number) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);
  const r2n = (n: number | null | undefined) => (typeof n === 'number' ? r2(n) : n);
  /** to the nearest half inch — how a splash height or an overhang is written on a plan */
  const half = (n: number) => (typeof n === 'number' ? Math.round(n * 2) / 2 : n);
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as T[]) : []);
  const obj = (v: unknown) => !!v && typeof v === 'object';
  if (!obj(spec)) return spec;
  if (!isSingleRoom(spec)) return spec;
  if (obj(spec.dims)) spec.dims = { widthFt: r2(spec.dims.widthFt), depthFt: r2(spec.dims.depthFt), ceilingFt: r2(spec.dims.ceilingFt), ...confirmedDimensions(spec) };
  if (spec.roomType === 'kitchen') {
    for (const r of list<KitchenSpec['runs'][number]>(spec.runs)) {
      r.start = r3(r.start); r.lengthFt = r2(r.lengthFt);
      r.upperHeightIn = r2n(r.upperHeightIn) ?? null;
      r.upperBottomIn = r2n(r.upperBottomIn) ?? null;
      for (const t of list<{ t: number; widthIn: number }>(r.tall)) { t.t = r3(t.t); t.widthIn = r2(t.widthIn); }
      for (const b of list<{ widthIn: number }>(r.base)) b.widthIn = r2(b.widthIn);
      for (const u of list<{ widthIn: number }>(r.uppers)) u.widthIn = r2(u.widthIn);
    }
    if (obj(spec.island)) {
      spec.island.lengthFt = r2(spec.island.lengthFt); spec.island.widthFt = r2(spec.island.widthFt);
      if (obj(spec.island.offset)) spec.island.offset = { x: r2(spec.island.offset.x), z: r2(spec.island.offset.z) };
      if (typeof spec.island.stoolPitchIn === 'number') spec.island.stoolPitchIn = r2(spec.island.stoolPitchIn);
      if (typeof spec.island.endSeats === 'number') spec.island.endSeats = Math.round(spec.island.endSeats);
      // an overhang and an offset a contractor would write down: half-inches
      if (typeof spec.island.endOverhangIn === 'number') spec.island.endOverhangIn = half(spec.island.endOverhangIn);
      if (typeof spec.island.stoolOffsetIn === 'number') spec.island.stoolOffsetIn = half(spec.island.stoolOffsetIn);
    }
    for (const a of list<KitchenSpec['appliances'][number]>(spec.appliances)) {
      a.t = r3(a.t); a.widthIn = r2(a.widthIn);
      if (typeof a.heightIn === 'number') a.heightIn = r2(a.heightIn);
      if (typeof a.aboveCounterIn === 'number') a.aboveCounterIn = r2(a.aboveCounterIn);
    }
    if (obj(spec.sink)) { spec.sink.t = r3(spec.sink.t); spec.sink.widthIn = r2(spec.sink.widthIn); }
    if (obj(spec.cabinets)) spec.cabinets.upperHeightIn = r2(spec.cabinets.upperHeightIn);
    if (obj(spec.countertop) && typeof spec.countertop.overhangIn === 'number') spec.countertop.overhangIn = r2(spec.countertop.overhangIn);
    if (obj(spec.backsplash) && typeof spec.backsplash.heightIn === 'number') spec.backsplash.heightIn = half(spec.backsplash.heightIn);
    const p = obj(spec.lighting) ? spec.lighting.pendants : null;
    if (p && obj(p)) {
      p.spreadFt = r2(p.spreadFt); p.offsetFt = r2(p.offsetFt); p.aboveCounterIn = r2(p.aboveCounterIn);
      if (Array.isArray(p.positions)) for (const q of p.positions) if (obj(q)) { q.alongFt = r2(q.alongFt); q.acrossFt = r2(q.acrossFt); }
    }
  } else if (spec.roomType === 'bathroom') {
    if (obj(spec.vanity)) { spec.vanity.t = r3(spec.vanity.t); spec.vanity.widthIn = r2(spec.vanity.widthIn); }
    if (obj(spec.shower)) { spec.shower.t = r3(spec.shower.t); spec.shower.widthIn = r2(spec.shower.widthIn); spec.shower.depthIn = r2(spec.shower.depthIn); }
    if (obj(spec.tub)) { spec.tub.t = r3(spec.tub.t); spec.tub.lengthIn = r2(spec.tub.lengthIn); }
    if (obj(spec.toilet)) spec.toilet.t = r3(spec.toilet.t);
  }
  for (const o of list<KitchenSpec['openings'][number]>(spec.openings)) { o.t = r3(o.t); o.widthFt = r2(o.widthFt); o.heightFt = r2(o.heightFt); o.sillFt = r2(o.sillFt); }
  if (obj(spec.decor)) {
    for (const s of list<KitchenSpec['decor']['shelves'][number]>(spec.decor.shelves)) {
      s.t = r3(s.t); s.widthIn = r2(s.widthIn); s.bottomFt = r2(s.bottomFt); s.spacingIn = r2(s.spacingIn);
      if (s.enclosure) {
        s.enclosure.heightIn = r2(s.enclosure.heightIn);
        s.enclosure.panelThicknessIn = r2n(s.enclosure.panelThicknessIn) ?? null;
      }
    }
    for (const p of list<KitchenSpec['decor']['plants'][number]>(spec.decor.plants)) { p.t = r3(p.t); p.sizeFt = r2(p.sizeFt); }
    // a field missing here ships as 6.9371 — every number the fit or the
    // model can write is rounded to what a person would say out loud
    for (const it of list<{ t: number; sizeIn: number }>(spec.decor.items)) { it.t = r3(it.t); it.sizeIn = r2(it.sizeIn); }
    for (const c of list<{ t: number }>(spec.decor.cabinetContents)) c.t = r3(c.t);
  }
  return spec;
}
