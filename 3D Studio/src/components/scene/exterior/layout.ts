/**
 * Exterior layout solver — turns an (AI-produced, possibly odd) ExteriorSpec
 * into a fully clamped, collision-resolved site plan in METRES that the scene
 * components render without any further validation.
 *
 * SITE FRAME: the lot is centred at the origin, grade at y = 0 and **+z is the
 * street**. The house sits `setbackFrontFt` back from the front edge, so its
 * centre is at a NEGATIVE-ish z. Elevations face OUTWARD — see the coordinate
 * note at the top of `helpers.ts`.
 *
 * Every number is guarded: NaN / missing / absurd values fall back to sane
 * defaults, a house wider than its lot is shrunk, a wing that would hang off
 * the property is pulled in, openings that overflow their wall are narrowed
 * and openings that collide are slid apart. Nothing here throws.
 */
import type { DesignStyle, Elevation, ExteriorSpec, HouseStyle, RoofType, Wall } from '@/lib/spec/types';
import { clamp, ft } from '@/lib/units';
import { getMaterial } from '@/lib/materials/catalog';
import { num, pick } from '@/components/scene/bathroom/layout';
import {
  elevationFrame, frameToWorld, hash01, isGableEnd, makeRoofShape, wallTopProfile,
  type ElevFrame, type RoofShape,
} from './helpers';

export { num, pick };

const WALLS: readonly Wall[] = ['back', 'left', 'right', 'front'];
const STYLES: readonly DesignStyle[] = ['modern', 'contemporary', 'transitional', 'traditional', 'farmhouse', 'scandinavian', 'industrial', 'coastal', 'mid-century', 'craftsman', 'mediterranean'];
const HOUSE_STYLES: readonly HouseStyle[] = ['craftsman', 'modern-farmhouse', 'modern', 'colonial', 'ranch', 'cape-cod', 'contemporary', 'mediterranean', 'tudor', 'victorian', 'northwest-contemporary'];
const ROOF_TYPES: readonly RoofType[] = ['gable', 'hip', 'flat', 'shed', 'gambrel', 'dutch-gable', 'cross-gable'];
const WINDOW_STYLES = ['standard', 'picture', 'bay', 'slider', 'french', 'pocket', 'barn', 'casement', 'double-hung'] as const;
export type WindowStyle = (typeof WINDOW_STYLES)[number] | 'colonial';
export type DoorKind = 'entry' | 'garage' | 'patio' | 'french' | 'side';

// ---------------------------------------------------------------------------
// Small value types
// ---------------------------------------------------------------------------
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Pad { cx: number; cz: number; w: number; d: number; y: number }

export const rectOf = (cx: number, cz: number, w: number, d: number): Rect => ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
export const padRect = (p: Pad): Rect => rectOf(p.cx, p.cz, p.w, p.d);
export const rectsOverlap = (a: Rect, b: Rect, pad = 0): boolean =>
  a.minX - pad < b.maxX && a.maxX + pad > b.minX && a.minZ - pad < b.maxZ && a.maxZ + pad > b.minZ;

export interface LWindow {
  id: string; x: number; y: number; w: number; h: number;
  style: WindowStyle; floor: number; shutters: boolean;
}
export interface LDoor {
  id: string; x: number; y: number; w: number; h: number;
  kind: DoorKind; bays: number; lites: boolean;
}
export interface LElevation {
  wall: Wall;
  len: number;
  windows: LWindow[];
  doors: LDoor[];
  /** polygon (wall-local x, y above the eave) filling wall → roof underside */
  top: Array<[number, number]> | null;
  /** true when `top` should read as the accent gable end */
  gable: boolean;
  /** validated catalog material id overriding siding_primary, or null */
  sidingId: string | null;
  frame: ElevFrame;
}

export interface LBlock {
  key: 'house' | 'wing' | 'garage';
  cx: number; cz: number;
  w: number; d: number;
  stories: number;
  storyH: number;
  /** exposed foundation height (grade → finished floor) */
  foundation: number;
  /** finished floor level */
  floorY: number;
  /** top of the walls = roof eave line */
  eaveY: number;
  roof: RoofShape;
  elevations: LElevation[];
  /** wall butting the parent mass — not rendered */
  hidden: Wall | null;
  rect: Rect;
  /** accent siding on the outward face (wings read as a different volume) */
  accentWall: Wall | null;
}

export interface LPorch {
  wall: Wall;
  /** wall-local centre + span */
  x: number; w: number; depth: number;
  floorY: number;
  roofY: number;
  roofed: boolean;
  columns: number;
  columnKind: 'square' | 'tapered' | 'round' | 'timber';
  railing: boolean;
  steps: number;
  stepRise: number;
  roof: RoofShape | null;
  frame: ElevFrame;
  rect: Rect;
}

export interface LDeck {
  wall: Wall;
  x: number; w: number; depth: number;
  floorY: number;
  railing: boolean;
  boardsAlong: 'x' | 'z';
  steps: number;
  frame: ElevFrame;
  rect: Rect;
}

export interface LPool { cx: number; cz: number; w: number; d: number; depth: number }
export interface LFenceRun { cx: number; cz: number; yaw: number; length: number; height: number }
export interface LTree { x: number; z: number; variant: number; scale: number; rot: number }
export interface LShrub { x: number; z: number; scale: number }
export interface LSconce { position: [number, number, number]; yaw: number }
export interface LUpLight { position: [number, number, number]; target: [number, number, number] }

/** Mulched planting bed hugging a wall — world centre + span, `yaw` from its elevation. */
export interface LBed { cx: number; cz: number; w: number; d: number; yaw: number }

/**
 * The small wall-mounted hardware that separates a photograph of a house from a
 * massing model. Every one is placed in world space with the outward yaw of the
 * elevation it hangs on.
 */
export type UtilityKind = 'hose-bib' | 'meter' | 'dryer-vent' | 'outlet' | 'doorbell' | 'numbers' | 'ac-condenser' | 'vent-louver';
export interface LUtility { kind: UtilityKind; position: [number, number, number]; yaw: number }

export interface LMailbox { x: number; z: number; yaw: number }
/** Neighbouring hedge run just outside the property line. */
export interface LHedge { x: number; z: number; length: number; yaw: number; height: number }

export interface ExteriorLayout {
  /** lot extents (m) */
  lotW: number; lotD: number;
  lotWidthFt: number; lotDepthFt: number;
  slope: 'flat' | 'gentle' | 'steep';
  style: DesignStyle;
  houseStyle: HouseStyle;
  /** the client says a house is already standing here */
  present: boolean;
  /** ...and its opposite: the massing is our PROPOSAL for an empty lot */
  proposed: boolean;
  trimW: number;
  house: LBlock | null;
  wing: LBlock | null;
  garage: LBlock | null;
  /** every mass, in draw order */
  blocks: LBlock[];
  /** the main mass's own footprint */
  buildable: Rect;
  /** what the lot will legally carry: front setback, side yards, rear yard */
  envelope: Rect;
  porch: LPorch | null;
  deck: LDeck | null;
  chimney: { x: number; z: number; base: number; height: number } | null;
  driveway: Pad[];
  walkway: Pad[];
  patio: Pad | null;
  pool: LPool | null;
  fence: LFenceRun[];
  trees: LTree[];
  shrubs: LShrub[];
  street: { sidewalk: Pad; asphalt: Pad; curb: Pad } | null;
  sconces: LSconce[];
  upLights: LUpLight[];
  timeOfDay: 'morning' | 'noon' | 'golden-hour' | 'dusk';
  landscapeLighting: boolean;
  /** mulched foundation beds (the shrubs sit inside these) */
  beds: LBed[];
  /** hose bib, meter, dryer vent, doorbell, house numbers, condenser… */
  utilities: LUtility[];
  mailbox: LMailbox | null;
  /** neighbouring hedges just outside the side property lines */
  hedges: LHedge[];
  /** distant treeline well beyond the lot, so the ground never ends in a void */
  treeline: LTree[];
  /** half-extent of the context ground plane (m) — always well past the lot */
  groundHalf: number;
  /**
   * What this layout DECIDED rather than read, in plain words.
   *
   * The kitchen has had `KDecor.warnings` since the décor landed and the
   * bathroom has its own; the exterior had no channel at all, which meant
   * `fillBlankFace` could put windows on a wing or a garage the analyzer
   * never described and nothing anywhere said they were assumed. A
   * contractor pricing off this twin has to be able to tell what came off
   * the photograph from what we drew because a blank two-storey wall would
   * have been a worse lie.
   */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Opening resolution
// ---------------------------------------------------------------------------
interface Slot { id: string; x: number; w: number; min: number; rank: number; y0: number; y1: number }

const slotsClash = (a: Slot, b: Slot) => a.y0 < b.y1 - 0.05 && a.y1 > b.y0 + 0.05;

/**
 * Clamp openings inside the wall and slide overlapping ones apart. Openings on
 * different storeys never fight — a second-floor window stacked directly over a
 * first-floor one is exactly what a real elevation looks like.
 */
function resolveSlots(slots: Slot[], len: number, inset: number): Set<string> {
  const lo = -len / 2 + inset, hi = len / 2 - inset;
  const dropped = new Set<string>();
  if (hi - lo < 0.3) { slots.forEach((s) => dropped.add(s.id)); return dropped; }
  for (const s of slots) {
    s.w = Math.min(s.w, hi - lo);
    s.x = clamp(s.x, lo + s.w / 2, hi - s.w / 2);
  }
  const gap = 0.16;
  const order = [...slots].sort((a, b) => a.x - b.x);
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i], b = order[i + 1];
      if (dropped.has(a.id) || dropped.has(b.id)) continue;
      if (!slotsClash(a, b)) continue;
      const need = a.x + a.w / 2 + gap - (b.x - b.w / 2);
      if (need <= 0.001) continue;
      const shiftA = Math.min(need / 2, a.x - (lo + a.w / 2));
      const shiftB = Math.min(need - shiftA, hi - b.w / 2 - b.x);
      a.x -= shiftA; b.x += shiftB;
      if (shiftA + shiftB < need - 0.002) {
        // no room left → narrow the lower-ranked one, then drop it if it cannot shrink
        const victim = a.rank >= b.rank ? a : b;
        const shrink = need - shiftA - shiftB;
        if (victim.w - shrink >= victim.min) {
          victim.w -= shrink;
          victim.x = clamp(victim.x, lo + victim.w / 2, hi - victim.w / 2);
        } else {
          dropped.add(victim.id);
        }
      }
      moved = true;
    }
    if (!moved) break;
  }

  // Final guarantee: reserve the doors, then fit the windows into what is left.
  // Anything with no room at all is dropped rather than left overlapping —
  // a spec can always ask for more glass than the wall has.
  const kept: Slot[] = [];
  const place = (list: Slot[]) => {
    for (const s of list) {
      if (dropped.has(s.id)) continue;
      let left = lo, right = hi;
      for (const k of kept) {
        if (!slotsClash(k, s)) continue;
        if (k.x <= s.x) left = Math.max(left, k.x + k.w / 2 + gap);
        else right = Math.min(right, k.x - k.w / 2 - gap);
      }
      const avail = right - left;
      if (avail < s.min) { dropped.add(s.id); continue; }
      if (s.w > avail) s.w = avail;
      s.x = clamp(s.x, left + s.w / 2, right - s.w / 2);
      kept.push(s);
    }
  };
  place(order.filter((s) => s.rank < 2));
  place(order.filter((s) => s.rank >= 2));
  return dropped;
}

function validSiding(id: unknown): string | null {
  if (typeof id !== 'string' || !id) return null;
  return getMaterial(id) ? id : null;
}

function windowStyleFor(raw: unknown, houseStyle: HouseStyle): WindowStyle {
  const s = pick(raw, WINDOW_STYLES, 'double-hung');
  if (s === 'pocket' || s === 'barn') return 'double-hung';
  if ((houseStyle === 'colonial' || houseStyle === 'cape-cod') && (s === 'standard' || s === 'double-hung')) return 'colonial';
  return s;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function computeExteriorLayout(specIn: ExteriorSpec | null | undefined): ExteriorLayout {
  const spec = (specIn ?? {}) as Partial<ExteriorSpec>;
  const style = pick<DesignStyle>(spec.style, STYLES, 'transitional');
  const houseStyle = pick<HouseStyle>(spec.houseStyle, HOUSE_STYLES, 'modern-farmhouse');

  // --- lot -----------------------------------------------------------------
  const lotSpec = (spec.lot ?? {}) as Partial<ExteriorSpec['lot']>;
  const lotWidthFt = num(lotSpec.widthFt, 80, 24, 500);
  const lotDepthFt = num(lotSpec.depthFt, 120, 24, 800);
  const lotW = ft(lotWidthFt), lotD = ft(lotDepthFt);
  const slope = pick(lotSpec.slope, ['flat', 'gentle', 'steep'] as const, 'flat');

  // --- house shell ---------------------------------------------------------
  // ANCHORING RULE (see the file header): the FRONT WALL of the main mass is
  // the anchor. It sits exactly `setbackFrontFt` back from the front lot line
  // and nothing downstream is permitted to move it — not a deeper footprint,
  // not a bigger porch, not another garage bay, not a second storey. When a
  // dimension genuinely will not fit we clamp THAT DIMENSION; we never slide
  // the house to make room. This is what keeps a Layout-tab slider from
  // dragging the whole composition across the lot.
  const hs = (spec.house ?? {}) as Partial<ExteriorSpec['house']>;
  /**
   * `present` is the CLIENT'S STATEMENT that a house is already standing —
   * false for an empty-lot upload. It is not a build gate.
   *
   * It used to be one, and that was the empty-lot path's whole failure: the
   * intake asks a client with a bare lot for storeys, footprint, roof shape,
   * siding, trim, garage bays and a porch, `applyIntakeAnswers` writes every
   * one of those into `spec.house`, and then the scene threw the lot away and
   * drew a glowing rectangle. A proposal you cannot look at, price, walk or
   * re-clad is not a proposal. So the massing is ALWAYS built from whatever
   * `spec.house` says; `proposed` records which of the two it is, and the
   * scene rings a proposal with the zoning envelope so it is never mistaken
   * for a survey of what is there today.
   */
  const present = hs.present !== false;
  const proposed = !present;
  const fp = (hs.footprint ?? {}) as Partial<ExteriorSpec['house']['footprint']>;
  const rawWidthFt = num(fp.widthFt, 44, 10, 400);
  const rawDepthFt = num(fp.depthFt, 30, 10, 400);
  const REAR_YARD_MIN = ft(6);
  const setback = clamp(ft(num(lotSpec.setbackFrontFt, 30, 0, 400)), ft(4), Math.max(ft(4), lotD - ft(20)));
  const houseFrontZ = lotD / 2 - setback;
  /** depth the lot can actually carry behind the (fixed) front wall */
  const depthRoom = Math.max(ft(12), houseFrontZ + lotD / 2 - REAR_YARD_MIN);
  const houseW = clamp(ft(rawWidthFt), ft(12), Math.max(ft(12), lotW - ft(10)));
  const houseD = clamp(ft(rawDepthFt), ft(12), Math.max(ft(12), Math.min(lotD * 0.62, depthRoom)));
  const stories = (Math.round(num(hs.stories, 2, 1, 3)) as 1 | 2 | 3);
  const storyH = ft(num(hs.storyHeightFt, 10, 7.5, 16));
  const foundation = clamp(ft(num(hs.foundationExposedFt, 1, 0, 6)), 0, ft(5));
  const trimW = clamp(ft(num(hs.trimWidthIn, 5, 2, 14) / 12), ft(2.5 / 12), ft(1));
  const wallH = stories * storyH;
  const floorY = foundation;
  const eaveY = foundation + wallH;
  const shutters = hs.shutters === true;
  const chimneyOn = hs.chimney === true;

  // --- roof ----------------------------------------------------------------
  const rf = (hs.roof ?? {}) as Partial<ExteriorSpec['house']['roof']>;
  const roofType = pick<RoofType>(rf.type, ROOF_TYPES, 'gable');
  const roofPitch = num(rf.pitch, 8, 0, 18);
  const overhang = clamp(ft(num(rf.overhangFt, 1.5, 0, 6)), 0, Math.min(houseW, houseD) * 0.3);
  // STICKY: derived from the DECLARED footprint, never from the fitted one, so
  // shrinking the lot (or clamping the house to fit it) can never spin the roof.
  const ridge: 'x' | 'z' = rf.ridgeDirection === 'z' ? 'z' : rf.ridgeDirection === 'x' ? 'x' : rawWidthFt >= rawDepthFt ? 'x' : 'z';
  const mainRoof = makeRoofShape(roofType, roofPitch, overhang, ridge, houseW, houseD);

  // --- wing ----------------------------------------------------------------
  const wingSpec = (hs.wing ?? null) as ExteriorSpec['house']['wing'];
  const wingOn = !!wingSpec && wingSpec.present === true;
  const wingWall: Wall = wingOn ? pick<Wall>(wingSpec!.wall, WALLS, 'front') : 'front';
  const wingHostLen = wingWall === 'front' || wingWall === 'back' ? houseW : houseD;
  let wingW = wingOn ? clamp(ft(num(wingSpec!.widthFt, 20, 6, 200)), ft(8), Math.max(ft(8), wingHostLen - ft(4))) : 0;
  // The wing's PROJECTION is limited by the yard it sticks into (the `room`
  // clamp below), never by a fraction of the host's depth — tying it to houseD
  // meant a footprint-depth edit walked the wing, and with it the driveway that
  // aims at its garage doors.
  let wingD = wingOn ? clamp(ft(num(wingSpec!.depthFt, 18, 4, 200)), ft(6), ft(60)) : 0;
  const wingT = wingOn ? num(wingSpec!.t, 0.5, 0, 1) : 0.5;

  // --- garage --------------------------------------------------------------
  const gs = (hs.garage ?? {}) as Partial<ExteriorSpec['house']['garage']>;
  const bays = Math.round(num(gs.bays, 2, 0, 3)) as 0 | 1 | 2 | 3;
  const garageOn = gs.present === true && bays > 0;
  const garageWall = pick<Wall>(gs.wall, WALLS, 'front');
  const garageT = num(gs.t, 0.25, 0, 1);
  const garageAttached = gs.attached !== false;
  const doorH = clamp(ft(8), ft(6.8), Math.max(ft(6.8), storyH - ft(1.4)));
  const bayWidths: number[] = bays === 1 ? [ft(9)] : bays === 2 ? [ft(16)] : bays === 3 ? [ft(16), ft(9)] : [];

  // does the wing carry the garage doors?
  const wingCarriesGarage = wingOn && garageOn && garageAttached && garageWall === wingWall;

  // --- placement on the lot ------------------------------------------------
  // `setback` / `houseFrontZ` were fixed up in the house-shell block above and
  // are DELIBERATELY not touched here: projections (wing, porch, garage apron)
  // are fitted into the front yard that the setback leaves, they do not push
  // the house back. Everything below therefore grows away from a stable front
  // wall — the anchor a dimension edit is allowed to pivot around.
  const porchSpec = (hs.porch ?? {}) as Partial<ExteriorSpec['house']['porch']>;
  const porchOn = porchSpec.present === true;
  const porchWall = pick<Wall>(porchSpec.wall, WALLS, 'front');
  const houseCz = houseFrontZ - houseD / 2;
  const houseCx = 0;
  const houseBackZ = houseCz - houseD / 2;

  // A wing has to stay on the property. When the yard on that side cannot hold
  // even a minimal projection the wing is dropped outright — squeezing it would
  // put a garage over the property line.
  let wingFits = wingOn;
  if (wingOn) {
    const room = wingWall === 'front' ? lotD / 2 - houseFrontZ - ft(4)
      : wingWall === 'back' ? houseBackZ + lotD / 2 - ft(4)
        : lotW / 2 - houseW / 2 - ft(4);
    if (room < ft(5)) wingFits = false;
    else wingD = clamp(wingD, ft(5), room);
    wingW = Math.max(ft(6), Math.min(wingW, wingHostLen - ft(2)));
  }

  const buildable = rectOf(houseCx, houseCz, houseW, houseD);

  /**
   * The zoning envelope — what the lot will carry, not what we drew on it.
   * The front setback is the client's own number; the side and rear yards are
   * the 5 ft / 6 ft a plat writes when it does not say otherwise, scaled down
   * on a lot too narrow to give them up. Drawn on an empty lot so the client
   * sees the proposed house sitting INSIDE what they may build rather than
   * coincident with it.
   */
  const sideYard = Math.min(ft(5), lotW * 0.12);
  const envelope: Rect = {
    minX: -lotW / 2 + sideYard,
    maxX: lotW / 2 - sideYard,
    minZ: -lotD / 2 + Math.min(REAR_YARD_MIN, lotD * 0.12),
    maxZ: houseFrontZ,
  };

  // -------------------------------------------------------------------------
  // Elevations
  // -------------------------------------------------------------------------
  const elevSpecs = Array.isArray(spec.elevations) ? spec.elevations : [];
  const elevByWall = new Map<Wall, Elevation>();
  for (const e of elevSpecs) {
    if (!e || typeof e !== 'object') continue;
    const w = pick<Wall>(e.wall, WALLS, 'front');
    if (!elevByWall.has(w)) elevByWall.set(w, e);
  }

  /** Wing span (wall-local x on its host wall), or null. */
  let wingSpan: { wall: Wall; x0: number; x1: number; cx: number } | null = null;
  if (wingFits) {
    const half = wingHostLen / 2;
    const cx = clamp((wingT - 0.5) * wingHostLen, -half + wingW / 2, half - wingW / 2);
    wingSpan = { wall: wingWall, x0: cx - wingW / 2, x1: cx + wingW / 2, cx };
  }

  const garageDoorsOnWing = wingCarriesGarage && wingFits && wingSpan
    ? (() => {
      const gx = (garageT - 0.5) * wingHostLen;
      return gx >= wingSpan!.x0 - ft(3) && gx <= wingSpan!.x1 + ft(3);
    })()
    : false;

  function buildDoors(wall: Wall, len: number, e: Elevation | undefined, hostFace: 'house' | 'wing', withGarage: boolean): LDoor[] {
    const out: LDoor[] = [];
    const raw = e && Array.isArray(e.doors) ? e.doors : [];
    if (hostFace === 'house') {
      raw.forEach((dd, i) => {
        if (!dd || typeof dd !== 'object') return;
        const kind = pick<DoorKind>(dd.kind, ['entry', 'garage', 'patio', 'french', 'side'], 'entry');
        if (kind === 'garage') return; // garage doors are generated from house.garage
        const wide = kind === 'patio' || kind === 'french';
        const w = clamp(ft(num(dd.widthFt, wide ? 6 : 3, 1.5, 20)), ft(2.2), Math.max(ft(2.2), Math.min(len - ft(2), ft(wide ? 16 : 6))));
        const h = clamp(ft(num(dd.heightFt, wide ? 8 : 6.8, 5, 14)), ft(6.4), Math.max(ft(6.4), Math.min(wallH - ft(0.6), storyH - ft(0.6))));
        const t = num(dd.t, 0.5, 0, 1);
        out.push({ id: `${wall}-door-${i}`, x: (t - 0.5) * len, y: 0, w, h, kind, bays: 0, lites: kind !== 'entry' });
      });
    }
    // garage doors
    if (withGarage && bayWidths.length) {
      const gap = ft(1.6);
      let total = bayWidths.reduce((a, b) => a + b, 0) + gap * (bayWidths.length - 1);
      let widths = bayWidths.slice();
      const room = len - ft(2.5);
      if (total > room) {
        // fall back to the narrowest arrangement that fits, then to one bay
        widths = bayWidths.map(() => ft(9));
        total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
        while (total > room && widths.length > 1) {
          widths.pop();
          total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
        }
        if (total > room) { widths = [Math.max(ft(7), room)]; total = widths[0]; }
      }
      const center = hostFace === 'wing' ? 0 : clamp((garageT - 0.5) * len, -len / 2 + total / 2 + ft(1.2), len / 2 - total / 2 - ft(1.2));
      let cursor = center - total / 2;
      widths.forEach((bw, i) => {
        out.push({ id: `${wall}-garage-${i}`, x: cursor + bw / 2, y: 0, w: bw, h: doorH, kind: 'garage', bays: bw > ft(12) ? 2 : 1, lites: true });
        cursor += bw + gap;
      });
    }
    return out;
  }

  function buildWindows(wall: Wall, len: number, e: Elevation | undefined, maxWallH: number): LWindow[] {
    const raw = e && Array.isArray(e.windows) ? e.windows : [];
    const out: LWindow[] = [];
    raw.forEach((wnd, i) => {
      if (!wnd || typeof wnd !== 'object') return;
      const floor = Math.round(num(wnd.floor, 0, 0, 4));
      const fl = Math.min(floor, Math.max(0, stories - 1));
      const w = clamp(ft(num(wnd.widthFt, 3, 0.8, 40)), ft(1.2), Math.max(ft(1.2), len - ft(2)));
      const h = clamp(ft(num(wnd.heightFt, 4.5, 0.8, 20)), ft(1.2), Math.max(ft(1.2), Math.min(storyH - ft(1.2), maxWallH - ft(1.4))));
      // sillFt is sometimes absolute and sometimes per-floor; accept both
      let y = ft(num(wnd.sillFt, 3, 0, 60));
      if (y < fl * storyH) y += fl * storyH;
      y = clamp(y, ft(0.8), Math.max(ft(0.8), maxWallH - h - ft(0.7)));
      const t = num(wnd.t, 0.5, 0, 1);
      out.push({
        id: `${wall}-win-${i}`, x: (t - 0.5) * len, y, w, h,
        style: windowStyleFor(wnd.style, houseStyle), floor: fl,
        shutters: shutters && w <= ft(4.5) && h >= ft(2.5),
      });
    });
    return out;
  }

  /**
   * Openings for a face the spec never described.
   *
   * A wing and a detached garage carry no `Elevation` entry — the analyzer
   * describes the MAIN house's four walls and nothing else — so their faces
   * came out blank: a 24 ft, two-storey wall standing over a garage door with
   * not one opening on it, which is not a house, it is a shed. Where the spec
   * is silent we fill the face the way the volume is really built: a window per
   * storey of clear wall, never over a door, and never so tall that it runs out
   * through the plate.
   */
  // everything this layout decided rather than read — see ExteriorLayout.warnings
  const warnings: string[] = [];
  if (proposed) warnings.push('Assumed: rectangular lot boundary and 5 ft side / 6 ft rear clearance are visualization defaults. Confirm the survey and local setbacks before relying on the siting outline.');
  if (slope !== 'flat') warnings.push(`Not modeled: the lot is described as ${slope} slope, but no surveyed elevation points or slope direction were supplied. Grade, drainage and foundations are shown on a level reference plane.`);
  if (Math.abs(houseW - ft(rawWidthFt)) > 0.01 || Math.abs(houseD - ft(rawDepthFt)) > 0.01) warnings.push(`Adjusted: the requested ${rawWidthFt} × ${rawDepthFt} ft footprint was reduced to ${(houseW / ft(1)).toFixed(1)} × ${(houseD / ft(1)).toFixed(1)} ft to fit the assumed lot clearances. Confirm the measured footprint.`);
  if (wingOn && !wingFits) warnings.push('Not modeled: the requested wing does not fit inside the lot at the current setback. Adjust the lot measurements, footprint or wing projection.');

  function fillBlankFace(wall: Wall, len: number, maxWallH: number, doors: LDoor[]): LWindow[] {
    const out: LWindow[] = [];
    const floors = Math.max(1, Math.min(3, Math.round(maxWallH / storyH)));
    const wW = ft(3), wH = ft(4);
    if (len < wW + ft(2.5)) return out;
    const n = Math.max(1, Math.min(3, Math.round(len / ft(9))));
    for (let f = 0; f < floors; f++) {
      const sill = f * storyH + ft(3);
      if (sill + wH > maxWallH - ft(0.8)) continue;
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + (len * (i + 0.5)) / n;
        if (doors.some((d) => d.h > sill && Math.abs(d.x - x) < d.w / 2 + wW / 2 + ft(1))) continue;
        out.push({
          id: `${wall}-auto-${f}-${i}`, x, y: sill, w: wW, h: wH,
          style: windowStyleFor(undefined, houseStyle), floor: f, shutters: false,
        });
      }
    }
    return out;
  }

  function makeElevation(opts: {
    wall: Wall; len: number; blockW: number; blockD: number; cx: number; cz: number;
    roof: RoofShape; maxWallH: number; e: Elevation | undefined; hostFace: 'house' | 'wing';
    suppress?: { x0: number; x1: number } | null;
    /** this face carries the garage doors */
    garageFace?: boolean;
  }): LElevation {
    const { wall, len, roof, maxWallH, e, hostFace } = opts;
    const frame = elevationFrame(wall, opts.blockW, opts.blockD, opts.cx, opts.cz);
    let windows = buildWindows(wall, len, e, maxWallH);
    let doors = buildDoors(wall, len, e, hostFace, !!opts.garageFace);
    if (hostFace === 'wing' && !windows.length) {
      windows = fillBlankFace(wall, len, maxWallH, doors);
      // say so. These are the only openings in the whole twin that nobody
      // asked for, and an assumption a contractor cannot see is a change
      // order later.
      if (windows.length) {
        warnings.push(`Assumed: ${windows.length} window${windows.length === 1 ? '' : 's'} on the ${wall} face of the ${opts.garageFace ? 'garage' : 'wing'} — nothing described that face, and a blank wall would have been wrong too.`);
      }
    }
    if (opts.suppress) {
      const { x0, x1 } = opts.suppress;
      const hidden = (x: number, w: number) => x + w / 2 > x0 - 0.05 && x - w / 2 < x1 + 0.05;
      windows = windows.filter((wnd) => !hidden(wnd.x, wnd.w));
      doors = doors.filter((dd) => dd.kind === 'garage' || !hidden(dd.x, dd.w));
    }
    const inset = trimW + ft(0.35);
    const slots: Slot[] = [
      ...doors.map((d, i) => ({
        id: d.id, x: d.x, w: d.w,
        min: d.kind === 'garage' ? d.w : ft(2.2),
        rank: d.kind === 'garage' ? 0 : 1 + i * 0.01,
        y0: d.kind === 'garage' ? 0 : floorY, y1: (d.kind === 'garage' ? 0 : floorY) + d.h,
      })),
      ...windows.map((w, i) => ({ id: w.id, x: w.x, w: w.w, min: ft(1.2), rank: 2 + i * 0.01, y0: floorY + w.y, y1: floorY + w.y + w.h })),
    ];
    const dropped = resolveSlots(slots, len, inset);
    const byId = new Map(slots.map((s) => [s.id, s]));
    doors = doors.filter((d) => !dropped.has(d.id)).map((d) => ({ ...d, x: byId.get(d.id)!.x, w: byId.get(d.id)!.w }));
    windows = windows.filter((w) => !dropped.has(w.id)).map((w) => ({ ...w, x: byId.get(w.id)!.x, w: byId.get(w.id)!.w }));
    // Shutters need clear wall on BOTH sides of the casing or they collide with
    // the neighbouring opening — better no shutters than overlapping ones.
    if (shutters) {
      const half = len / 2;
      const others = [
        ...windows.map((o) => ({ x: o.x, w: o.w, y0: o.y, y1: o.y + o.h, id: o.id })),
        ...doors.map((o) => ({ x: o.x, w: o.w, y0: 0, y1: o.h, id: o.id })),
      ];
      windows = windows.map((wn) => {
        if (!wn.shutters) return wn;
        const shW = Math.max(0.24, wn.w * 0.52);
        const need = wn.w / 2 + trimW + shW + 0.05;
        let left = wn.x + half, right = half - wn.x;
        for (const o of others) {
          if (o.id === wn.id) continue;
          if (!(o.y0 < wn.y + wn.h - 0.05 && o.y1 > wn.y + 0.05)) continue;
          if (o.x < wn.x) left = Math.min(left, wn.x - (o.x + o.w / 2));
          else right = Math.min(right, o.x - o.w / 2 - wn.x);
        }
        return left >= need && right >= need ? wn : { ...wn, shutters: false };
      });
    }
    // a wall-local +x that runs opposite the roof's across-axis needs mirroring
    const flip = roof.ridge === 'x' ? wall === 'right' : wall === 'back';
    const top = wallTopProfile(roof, wall, len, flip);
    return {
      wall, len, windows, doors, top,
      gable: !!top && isGableEnd(wall, roof.ridge) && roof.type !== 'shed',
      sidingId: validSiding(e?.sidingOverride),
      frame,
    };
  }

  // --- main house block ----------------------------------------------------
  const houseElevations = WALLS.map((wall) => makeElevation({
    wall,
    len: wall === 'front' || wall === 'back' ? houseW : houseD,
    blockW: houseW, blockD: houseD, cx: houseCx, cz: houseCz,
    roof: mainRoof, maxWallH: wallH,
    e: elevByWall.get(wall),
    hostFace: 'house',
    garageFace: garageOn && garageAttached && !garageDoorsOnWing && garageWall === wall,
    suppress: wingSpan && wingSpan.wall === wall ? { x0: wingSpan.x0, x1: wingSpan.x1 } : null,
  }));
  const house: LBlock = {
    key: 'house', cx: houseCx, cz: houseCz, w: houseW, d: houseD,
    stories, storyH, foundation, floorY, eaveY,
    roof: mainRoof, elevations: houseElevations, hidden: null,
    rect: rectOf(houseCx, houseCz, houseW, houseD),
    accentWall: null,
  };

  // --- wing block ----------------------------------------------------------
  let wing: LBlock | null = null;
  if (wingFits && wingSpan) {
    const hostFrame = elevationFrame(wingWall, houseW, houseD, houseCx, houseCz);
    const centre = frameToWorld(hostFrame, wingSpan.cx, 0, wingD / 2);
    const axisZ = wingWall === 'front' || wingWall === 'back';
    const bw = axisZ ? wingW : wingD;
    const bd = axisZ ? wingD : wingW;
    const wingStories = Math.min(stories, garageDoorsOnWing && stories > 1 ? 2 : stories) as 1 | 2 | 3;
    const wingWallH = wingStories * storyH;
    const wingEaveY = foundation + wingWallH;
    const wingRidge: 'x' | 'z' = axisZ ? 'z' : 'x';
    const wingRoofType: RoofType = roofType === 'flat' ? 'flat' : roofType === 'shed' ? 'shed' : roofType === 'hip' ? 'hip' : 'gable';
    const wingRoof = makeRoofShape(wingRoofType, roofPitch, overhang, wingRidge, bw, bd);
    const facing = wingWall; // the wing's outward face points the same way as the host wall
    const hidden = OPPOSITE_WALL[facing];
    const wingElevs: LElevation[] = [];
    for (const wall of WALLS) {
      if (wall === hidden) continue;
      const len = wall === 'front' || wall === 'back' ? bw : bd;
      const isFace = wall === facing;
      // procedural completion: a blank wing face reads as a mistake, so give a
      // non-garage wing one centred window per storey
      const synthetic: Elevation | undefined = isFace && !garageDoorsOnWing
        ? {
          wall, sidingOverride: null, gableEnd: true, doors: [],
          windows: Array.from({ length: wingStories }, (_, s) => ({
            t: 0.5, widthFt: Math.min(5, (len / ft(1)) * 0.4), heightFt: 4.5, sillFt: 3 + s * (storyH / ft(1)), floor: s, style: 'double-hung' as const,
          })),
        }
        : undefined;
      wingElevs.push(makeElevation({
        wall, len, blockW: bw, blockD: bd, cx: centre[0], cz: centre[2],
        roof: wingRoof, maxWallH: wingWallH, e: synthetic, hostFace: 'wing',
        garageFace: isFace && garageDoorsOnWing,
      }));
    }
    wing = {
      key: 'wing', cx: centre[0], cz: centre[2], w: bw, d: bd,
      stories: wingStories, storyH, foundation, floorY, eaveY: wingEaveY,
      roof: wingRoof, elevations: wingElevs, hidden,
      rect: rectOf(centre[0], centre[2], bw, bd),
      accentWall: facing,
    };
  }

  // --- detached garage -----------------------------------------------------
  let garage: LBlock | null = null;
  if (garageOn && !garageAttached) {
    const gw = clamp(bayWidths.reduce((a, b) => a + b, 0) + ft(1.6) * (bayWidths.length - 1) + ft(4), ft(14), lotW - ft(12));
    const gd = ft(24);
    const side = garageWall === 'left' ? -1 : 1;
    const gcx = clamp(side * (houseW / 2 + gw / 2 + ft(6)), -lotW / 2 + gw / 2 + ft(4), lotW / 2 - gw / 2 - ft(4));
    // ANCHOR: a detached garage lines up with the house's FRONT wall (which is
    // fixed), set back one bay. Anchoring it on the house CENTRE meant every
    // footprint-depth edit walked the garage down the lot.
    const gcz = clamp(houseFrontZ - ft(6) - gd / 2, -lotD / 2 + gd / 2 + ft(6), lotD / 2 - gd / 2 - ft(6));
    const gStoryH = Math.max(doorH + ft(1.4), ft(9.5));
    const gRoof = makeRoofShape(roofType === 'flat' ? 'flat' : roofType === 'shed' ? 'shed' : 'gable', roofPitch, Math.min(overhang, ft(1.5)), gw >= gd ? 'x' : 'z', gw, gd);
    const gElevs = WALLS.map((wall) => makeElevation({
      wall,
      len: wall === 'front' || wall === 'back' ? gw : gd,
      blockW: gw, blockD: gd, cx: gcx, cz: gcz,
      roof: gRoof, maxWallH: gStoryH,
      e: undefined, hostFace: 'wing',
      garageFace: wall === 'front',
    }));
    garage = {
      key: 'garage', cx: gcx, cz: gcz, w: gw, d: gd,
      stories: 1, storyH: gStoryH, foundation: Math.min(foundation, ft(0.75)),
      floorY: Math.min(foundation, ft(0.75)), eaveY: Math.min(foundation, ft(0.75)) + gStoryH,
      roof: gRoof, elevations: gElevs, hidden: null,
      rect: rectOf(gcx, gcz, gw, gd), accentWall: null,
    };
  }

  const blocks: LBlock[] = [house, wing, garage].filter((b): b is LBlock => !!b);

  // --- porch ---------------------------------------------------------------
  let porch: LPorch | null = null;
  if (porchOn) {
    const hostLen = porchWall === 'front' || porchWall === 'back' ? houseW : houseD;
    // The porch projects into the yard the setback already reserved — it is
    // clamped to that yard, it never pushes the house back to make room.
    const yardOut = porchWall === 'front' ? setback
      : porchWall === 'back' ? houseBackZ + lotD / 2
        : lotW / 2 - houseW / 2;
    const porchD = clamp(ft(num(porchSpec.depthFt, 7, 3, 30)), ft(4), Math.max(ft(4), Math.min(ft(16), yardOut - ft(4))));
    const hostElev = house.elevations.find((e) => e.wall === porchWall);
    const entry = hostElev?.doors.find((d) => d.kind === 'entry' || d.kind === 'french' || d.kind === 'patio');

    // ANCHOR FIRST, THEN SIZE. The porch centres on the entry door and stays
    // there; the free bay it has to live in is decided from the wing and the
    // wall alone. Only after the centre is fixed do we clamp the WIDTH to what
    // fits either side of it. Doing it the other way round (clamp width, then
    // slide the centre out of the way) is exactly the bug where nudging a width
    // slider walks the porch sideways.
    let lo = -hostLen / 2, hi = hostLen / 2;
    let px = entry ? entry.x : 0;
    if (wingSpan && wingSpan.wall === porchWall) {
      const freeRight = hostLen / 2 - wingSpan.x1;
      const freeLeft = wingSpan.x0 + hostLen / 2;
      // STICKY: the side is decided by where the entry door already is relative
      // to the wing, not by which leftover gap happens to be wider.
      const goRight = px >= wingSpan.cx ? freeRight > ft(6) : freeLeft <= ft(6) && freeRight > ft(6);
      if (goRight) lo = wingSpan.x1 + ft(0.3);
      else hi = wingSpan.x0 - ft(0.3);
    }
    if (hi - lo < ft(6)) { lo = -hostLen / 2; hi = hostLen / 2; }
    px = clamp(px, lo + ft(3), hi - ft(3));
    const pw = clamp(
      ft(num(porchSpec.widthFt, 16, 4, 200)),
      ft(6),
      Math.max(ft(6), Math.min(hostLen - ft(1), 2 * Math.min(px - lo, hi - px))),
    );
    const frame = elevationFrame(porchWall, houseW, houseD, houseCx, houseCz);
    const pFloor = Math.max(floorY - ft(0.15), 0.06);
    const stepRise = 0.17;
    const steps = pFloor > 0.12 ? Math.max(1, Math.min(5, Math.round(pFloor / stepRise))) : 0;
    const roofed = porchSpec.roofed !== false;
    const columnKind: LPorch['columnKind'] = houseStyle === 'craftsman' ? 'tapered'
      : houseStyle === 'colonial' || houseStyle === 'victorian' ? 'round'
        : houseStyle === 'northwest-contemporary' || houseStyle === 'modern' || houseStyle === 'contemporary' ? 'timber' : 'square';
    // Solve the shed roof and its tie-in height together: the porch needs real
    // headroom AND has to stay under the main eave, so on a low one-storey house
    // the porch pitch flattens rather than punching through the roof.
    const pRidge: 'x' | 'z' = porchWall === 'front' || porchWall === 'back' ? 'x' : 'z';
    const pOver = Math.min(overhang, ft(1.2));
    const headroom = pFloor + ft(6.9);
    const ceilingLimit = eaveY - ft(0.15);
    let pPitch = Math.max(1.5, Math.min(roofPitch > 0 ? roofPitch : 3, 4));
    let pRoof = roofed ? makeRoofShape('shed', pPitch, pOver, pRidge, pw, porchD) : null;
    if (pRoof && ceilingLimit - pRoof.rise < headroom) {
      const avail = Math.max(0.03, ceilingLimit - headroom);
      pPitch = Math.max(0.5, Math.min(pPitch, (avail / Math.max(0.1, pRoof.across)) * 12));
      pRoof = makeRoofShape('shed', pPitch, pOver, pRidge, pw, porchD);
    }
    const tieIn = pRoof ? ceilingLimit - pRoof.rise : ceilingLimit;
    const pRoofY = Math.max(Math.min(floorY + storyH - ft(0.6), tieIn), Math.min(headroom, tieIn));
    const centre = frameToWorld(frame, px, 0, porchD / 2);
    porch = {
      wall: porchWall, x: px, w: pw, depth: porchD,
      floorY: pFloor, roofY: pRoofY, roofed,
      columns: Math.round(num(porchSpec.columns, 3, 0, 12)),
      columnKind,
      railing: pFloor > ft(1.2),
      steps, stepRise: steps ? pFloor / steps : 0,
      roof: pRoof, frame,
      rect: rectOf(centre[0], centre[2], porchWall === 'front' || porchWall === 'back' ? pw : porchD, porchWall === 'front' || porchWall === 'back' ? porchD : pw),
    };
  }

  // --- deck ----------------------------------------------------------------
  let deck: LDeck | null = null;
  const ds = (hs.deck ?? {}) as Partial<ExteriorSpec['house']['deck']>;
  if (ds.present === true) {
    const deckWall = pick<Wall>(ds.wall, WALLS, 'back');
    const hostLen = deckWall === 'front' || deckWall === 'back' ? houseW : houseD;
    const roomOut = deckWall === 'back' ? houseBackZ + lotD / 2 - ft(5)
      : deckWall === 'front' ? lotD / 2 - houseFrontZ - ft(5)
        : lotW / 2 - houseW / 2 - ft(5);
    const dd = clamp(ft(num(ds.depthFt, 12, 4, 100)), ft(5), Math.max(ft(5), roomOut));
    const hostElev = house.elevations.find((e) => e.wall === deckWall);
    const patioDoor = hostElev?.doors.find((d) => d.kind === 'patio' || d.kind === 'french');
    // ANCHOR FIRST, THEN SIZE (same rule as the porch): the deck centres on the
    // patio door and stays there; the width is what fits either side of it.
    const dx = clamp(patioDoor ? patioDoor.x : 0, -hostLen / 2 + ft(3), hostLen / 2 - ft(3));
    const dw = clamp(
      ft(num(ds.widthFt, 16, 4, 200)),
      ft(6),
      Math.max(ft(6), Math.min(hostLen - ft(1), 2 * Math.min(dx + hostLen / 2, hostLen / 2 - dx))),
    );
    const frame = elevationFrame(deckWall, houseW, houseD, houseCx, houseCz);
    const dFloor = Math.max(floorY - ft(0.25), 0.12);
    const centre = frameToWorld(frame, dx, 0, dd / 2);
    const axisZ = deckWall === 'front' || deckWall === 'back';
    deck = {
      wall: deckWall, x: dx, w: dw, depth: dd,
      floorY: dFloor,
      railing: ds.railing !== false,
      // STICKY: decking runs parallel to the ledger wall, which is a property of
      // WHICH WALL the deck is on — not of whichever fitted dimension came out
      // larger. Deriving it from the fitted size made every board pivot 90° the
      // moment a width slider crossed the depth.
      boardsAlong: deckWall === 'front' || deckWall === 'back' ? 'x' : 'z',
      steps: Math.max(2, Math.min(5, Math.round(dFloor / 0.17))),
      frame,
      rect: rectOf(centre[0], centre[2], axisZ ? dw : dd, axisZ ? dd : dw),
    };
  }

  // --- chimney -------------------------------------------------------------
  let chimney: ExteriorLayout['chimney'] = null;
  if (chimneyOn) {
    const side = ridge === 'x' ? 1 : -1;
    const cx = ridge === 'x' ? clamp(houseCx - houseW * 0.3, -houseW / 2 + 0.7, houseW / 2 - 0.7) : houseCx + side * (houseW * 0.18);
    const cz = ridge === 'x' ? houseCz + houseD * 0.12 : clamp(houseCz - houseD * 0.28, houseCz - houseD / 2 + 0.7, houseCz + houseD / 2 - 0.7);
    const acrossPos = mainRoof.ridge === 'x' ? cz - houseCz : cx - houseCx;
    const top = eaveY + Math.max(mainRoof.rise + ft(2.5), ft(3.5));
    const base = eaveY + Math.max(0, mainRoof.rise - Math.abs(acrossPos) * mainRoof.slope) - ft(3);
    chimney = { x: cx, z: cz, base: Math.min(base, top - ft(3)), height: top - Math.min(base, top - ft(3)) };
  }

  // -------------------------------------------------------------------------
  // Hardscape
  // -------------------------------------------------------------------------
  const hard = (spec.hardscape ?? {}) as Partial<ExteriorSpec['hardscape']>;
  const drvSpec = (hard.driveway ?? {}) as Partial<ExteriorSpec['hardscape']['driveway']>;
  const walkSpec = (hard.walkway ?? {}) as Partial<ExteriorSpec['hardscape']['walkway']>;
  const patioSpec = (hard.patio ?? {}) as Partial<ExteriorSpec['hardscape']['patio']>;
  const poolSpec = (hard.pool ?? {}) as Partial<ExteriorSpec['hardscape']['pool']>;

  const driveway: Pad[] = [];
  let drivewayEdgeX: number | null = null;
  if (drvSpec.present !== false) {
    const side = pick(drvSpec.side, ['left', 'right', 'center'] as const, 'left');
    const dW = clamp(ft(num(drvSpec.widthFt, 16, 6, 80)), ft(8), Math.max(ft(8), lotW * 0.55));
    // aim at the garage doors when there are any
    let targetX: number | null = null;
    let targetZ = houseFrontZ;
    if (garage) { targetX = garage.cx; targetZ = garage.cz + garage.d / 2; }
    else if (garageOn && garageAttached) {
      const host = garageDoorsOnWing && wing ? wing : house;
      const face = host?.elevations.find((e) => e.doors.some((d) => d.kind === 'garage'));
      if (host && face) {
        const gd = face.doors.filter((d) => d.kind === 'garage');
        const mid = gd.reduce((a, d) => a + d.x, 0) / Math.max(1, gd.length);
        const p = frameToWorld(face.frame, mid, 0, 0);
        targetX = p[0];
        targetZ = face.wall === 'front' ? p[2] : houseFrontZ;
        if (face.wall === 'left' || face.wall === 'right') {
          // side-entry garage: run up the lot then turn in
          const legZ = clamp(p[2], -lotD / 2 + ft(6), houseFrontZ - ft(2));
          const laneX = clamp(p[0] + (face.wall === 'left' ? -1 : 1) * (dW / 2 + ft(3)), -lotW / 2 + dW / 2 + ft(2), lotW / 2 - dW / 2 - ft(2));
          driveway.push({ cx: laneX, cz: (lotD / 2 + legZ) / 2, w: dW, d: Math.max(ft(6), lotD / 2 - legZ), y: 0.012 });
          // turn-in leg: span the lane to the door, then clip it to the property
          const rawLo = Math.min(laneX - dW / 2, p[0]);
          const rawHi = Math.max(laneX + dW / 2, p[0]);
          const legLo = Math.max(rawLo, -lotW / 2 + ft(1));
          const legHi = Math.min(rawHi, lotW / 2 - ft(1));
          if (legHi - legLo > ft(3)) {
            driveway.push({ cx: (legLo + legHi) / 2, cz: legZ, w: legHi - legLo, d: dW, y: 0.012 });
          }
          drivewayEdgeX = laneX + (face.wall === 'left' ? dW / 2 : -dW / 2);
          targetX = null;
        }
      }
    }
    if (!driveway.length) {
      const sideX = side === 'center' ? 0 : (side === 'left' ? -1 : 1) * Math.max(0, lotW / 2 - dW / 2 - ft(4));
      const cx = clamp(targetX ?? sideX, -lotW / 2 + dW / 2 + ft(1.5), lotW / 2 - dW / 2 - ft(1.5));
      const zEnd = clamp(targetX !== null ? targetZ : lotD / 2 - Math.max(ft(num(drvSpec.lengthFt, 30, 6, 300)), ft(12)), -lotD / 2 + ft(4), lotD / 2 - ft(6));
      const runD = Math.min(Math.max(ft(8), lotD / 2 - zEnd), lotD - ft(1));
      driveway.push({ cx, cz: clamp((lotD / 2 + zEnd) / 2, -lotD / 2 + runD / 2, lotD / 2 - runD / 2), w: dW, d: runD, y: 0.012 });
      drivewayEdgeX = cx + (cx <= 0 ? dW / 2 : -dW / 2);
    }
  }

  const walkway: Pad[] = [];
  if (walkSpec.present !== false) {
    const wW = clamp(ft(num(walkSpec.widthFt, 4, 2, 12)), ft(3), ft(8));
    const entryElev = house.elevations.find((e) => e.doors.some((d) => d.kind === 'entry'))
      ?? house.elevations.find((e) => e.wall === 'front');
    const entryDoor = entryElev?.doors.find((d) => d.kind === 'entry');
    if (entryElev) {
      const outward = porch && porch.wall === entryElev.wall ? porch.depth : 0;
      const start = frameToWorld(entryElev.frame, entryDoor ? entryDoor.x : 0, 0, outward);
      // walk out past anything that projects toward the street (garage wing,
      // porch) before turning toward the drive, so the path never crosses a mass
      const frontMost = Math.max(...blocks.map((b) => b.rect.maxZ), porch ? porch.rect.maxZ : -Infinity, start[2]);
      const zLanding = clamp(Math.max(start[2] + ft(5), frontMost + ft(4)), start[2] + ft(2.5), lotD / 2 - ft(4));
      walkway.push({ cx: start[0], cz: (start[2] + zLanding) / 2, w: wW, d: Math.max(ft(2), zLanding - start[2]), y: 0.014 });
      const endX = drivewayEdgeX ?? start[0];
      if (Math.abs(endX - start[0]) > wW * 0.6) {
        walkway.push({ cx: (start[0] + endX) / 2, cz: zLanding, w: Math.abs(endX - start[0]) + wW, d: wW, y: 0.014 });
      } else {
        walkway.push({ cx: start[0], cz: (zLanding + lotD / 2 - ft(1)) / 2, w: wW, d: Math.max(ft(2), lotD / 2 - ft(1) - zLanding), y: 0.014 });
      }
    }
  }

  let patio: Pad | null = null;
  if (patioSpec.present === true) {
    const pw = clamp(ft(num(patioSpec.widthFt, 14, 4, 120)), ft(6), lotW - ft(8));
    const pd = clamp(ft(num(patioSpec.depthFt, 12, 4, 120)), ft(6), Math.max(ft(6), houseBackZ + lotD / 2 - ft(6)));
    let cx = houseCx;
    if (deck && deck.wall === 'back') {
      // STICKY: the patio goes on the side of the lot the deck is NOT on, and
      // that side is read off the deck's ANCHOR (its centre on the wall), not
      // off the leftover gaps — widening the deck must not teleport the patio.
      const deckCx = (deck.rect.minX + deck.rect.maxX) / 2;
      cx = deckCx <= 0 ? deck.rect.maxX + pw / 2 + ft(1) : deck.rect.minX - pw / 2 - ft(1);
      cx = clamp(cx, -lotW / 2 + pw / 2 + ft(3), lotW / 2 - pw / 2 - ft(3));
    }
    const cz = clamp(houseBackZ - pd / 2 - ft(0.5), -lotD / 2 + pd / 2 + ft(4), houseBackZ - pd / 2);
    patio = { cx, cz, w: pw, d: pd, y: 0.011 };
  }

  let pool: LPool | null = null;
  if (poolSpec.present === true) {
    const pl = clamp(ft(num(poolSpec.lengthFt, 30, 8, 120)), ft(10), lotW - ft(14));
    const pwd = clamp(ft(num(poolSpec.widthFt, 15, 6, 80)), ft(6), Math.max(ft(6), (houseBackZ + lotD / 2) * 0.5));
    const behind = houseBackZ - (patio ? patio.d + ft(2) : ft(4)) - (deck && deck.wall === 'back' ? deck.depth : 0);
    const cz = clamp(behind - pwd / 2, -lotD / 2 + pwd / 2 + ft(6), houseBackZ - pwd / 2 - ft(3));
    pool = { cx: clamp(houseCx, -lotW / 2 + pl / 2 + ft(6), lotW / 2 - pl / 2 - ft(6)), cz, w: pl, d: pwd, depth: ft(4.5) };
  }

  // --- fence ---------------------------------------------------------------
  const fence: LFenceRun[] = [];
  const fenceSpec = (lotSpec.fence ?? {}) as Partial<ExteriorSpec['lot']['fence']>;
  if (fenceSpec.present === true) {
    const fh = clamp(ft(num(fenceSpec.heightFt, 6, 2, 12)), ft(3), ft(9));
    const sides = Array.isArray(fenceSpec.sides) ? fenceSpec.sides.filter((s): s is Wall => (WALLS as readonly string[]).includes(s as string)) : [];
    const inset = ft(0.5);
    const uniq = Array.from(new Set(sides));
    for (const s of uniq) {
      const f = elevationFrame(s, lotW - inset * 2, lotD - inset * 2, 0, 0);
      const len = f.len;
      if (s === 'front' && driveway.length) {
        // leave the driveway apron open
        const d0 = driveway[0];
        const gapC = d0.cx; // front frame local +x runs with world +x
        const gapW = d0.w + ft(2);
        const leftLen = Math.max(0, gapC - gapW / 2 - -len / 2);
        const rightLen = Math.max(0, len / 2 - (gapC + gapW / 2));
        if (leftLen > ft(2)) {
          const c = frameToWorld(f, -len / 2 + leftLen / 2, 0, 0);
          fence.push({ cx: c[0], cz: c[2], yaw: f.yaw, length: leftLen, height: fh });
        }
        if (rightLen > ft(2)) {
          const c = frameToWorld(f, len / 2 - rightLen / 2, 0, 0);
          fence.push({ cx: c[0], cz: c[2], yaw: f.yaw, length: rightLen, height: fh });
        }
        continue;
      }
      fence.push({ cx: f.cx, cz: f.cz, yaw: f.yaw, length: len, height: fh });
    }
  }

  // --- trees + shrubs ------------------------------------------------------
  const keepOut: Rect[] = [
    ...blocks.map((b) => b.rect),
    ...driveway.map(padRect),
    ...walkway.map(padRect),
    ...(porch ? [porch.rect] : []),
    ...(deck ? [deck.rect] : []),
    ...(patio ? [padRect(patio)] : []),
    ...(pool ? [rectOf(pool.cx, pool.cz, pool.w + ft(4), pool.d + ft(4))] : []),
  ];
  const treeCount = Math.round(num(lotSpec.treesCount, 3, 0, 40));
  // Deterministic candidate POOL first, then a pure accept/reject pass against
  // the built masses. Every candidate's position, variant and scale depend only
  // on its own index, and the mutual-spacing test runs candidate-vs-candidate —
  // never candidate-vs-accepted. Resizing the house therefore only ever REMOVES
  // a tree that is now under it (and pulls in the next pool slot); it can no
  // longer renumber the pool and walk every other tree across the yard.
  const treePool: LTree[] = [];
  for (let i = 0; i < 90 && treePool.length < 40; i++) {
    const variant = i % 4;
    const scale = 0.78 + hash01(i * 5 + 2) * 0.55;
    const radius = (variant === 2 ? 2.9 : variant === 0 ? 2.4 : variant === 1 ? 1.9 : 1.5) * scale;
    const margin = radius + ft(2);
    const spanX = Math.max(0.5, lotW - margin * 2), spanZ = Math.max(0.5, lotD - margin * 2);
    const x = (hash01(i * 7.13 + 3.1) - 0.5) * spanX;
    const z = (hash01(i * 7.13 + 11.7) - 0.5) * spanZ;
    if (treePool.some((t) => Math.hypot(t.x - x, t.z - z) < radius * 1.7)) continue;
    treePool.push({ x, z, variant, scale, rot: hash01(i * 3 + 7) * Math.PI * 2 });
  }
  /**
   * The street-facing view is THE shot for an exterior twin, and mature trees
   * are tall enough to hide the whole facade from it. So the front yard keeps a
   * clear sight corridor: nothing is planted between the street and the house
   * across the width the house occupies (plus a margin for the porch and eaves).
   * Trees still fill the sides and the rear, which is where they read as
   * landscaping rather than as an obstruction.
   */
  const frontOfHouse = blocks.length
    ? blocks.reduce((a, b) => ({
      minX: Math.min(a.minX, b.rect.minX), maxX: Math.max(a.maxX, b.rect.maxX),
      minZ: Math.min(a.minZ, b.rect.minZ), maxZ: Math.max(a.maxZ, b.rect.maxZ),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity })
    : null;
  const sightCorridor: Rect | null = frontOfHouse
    ? {
      minX: frontOfHouse.minX - ft(6),
      maxX: frontOfHouse.maxX + ft(6),
      minZ: frontOfHouse.maxZ,
      maxZ: lotD / 2 + ft(20),
    }
    : null;

  const trees: LTree[] = [];
  for (const t of treePool) {
    if (trees.length >= Math.min(treeCount, 24)) break;
    const radius = (t.variant === 2 ? 2.9 : t.variant === 0 ? 2.4 : t.variant === 1 ? 1.9 : 1.5) * t.scale;
    const r = rectOf(t.x, t.z, radius * 1.5, radius * 1.5);
    if (keepOut.some((k) => rectsOverlap(k, r, ft(2)))) continue;
    if (sightCorridor && rectsOverlap(sightCorridor, r, 0)) continue;
    trees.push(t);
  }

  const shrubs: LShrub[] = [];
  const frontElev = house.elevations.find((e) => e.wall === 'front');
  if (frontElev) {
    const onPorch = (x: number) => !!porch && porch.wall === 'front' && Math.abs(porch.x - x) < porch.w / 2 + ft(0.5);
    const blocked = (x: number) => frontElev.doors.some((d) => Math.abs(d.x - x) < d.w / 2 + ft(1.2))
      || (wingSpan && wingSpan.wall === 'front' && x > wingSpan.x0 - ft(0.5) && x < wingSpan.x1 + ft(0.5));
    const n = Math.max(2, Math.min(9, Math.round(houseW / ft(6))));
    for (let i = 0; i < n; i++) {
      const lx = -houseW / 2 + ft(2.5) + ((houseW - ft(5)) * i) / Math.max(1, n - 1);
      if (blocked(lx)) continue;
      // plantings sit against the foundation, or just off the porch edge
      const out = onPorch(lx) ? (porch!.depth + ft(2)) : ft(2.2);
      if (onPorch(lx) && walkway.some((p) => Math.abs(p.cx - frameToWorld(frontElev.frame, lx, 0, out)[0]) < p.w / 2 + ft(1))) continue;
      const p = frameToWorld(frontElev.frame, lx, 0, out);
      shrubs.push({ x: p[0], z: p[2], scale: 0.85 + hash01(i * 13 + 5) * 0.5 });
    }
  }

  // --- street --------------------------------------------------------------
  const street = {
    sidewalk: { cx: 0, cz: lotD / 2 + ft(2.5), w: lotW + ft(60), d: ft(5), y: 0.02 },
    curb: { cx: 0, cz: lotD / 2 + ft(5.4), w: lotW + ft(60), d: ft(0.8), y: 0.07 },
    asphalt: { cx: 0, cz: lotD / 2 + ft(17), w: lotW + ft(60), d: ft(22), y: 0.004 },
  };

  // --- lighting ------------------------------------------------------------
  const lt = (spec.lighting ?? {}) as Partial<ExteriorSpec['lighting']>;
  const timeOfDay = pick(lt.timeOfDay, ['morning', 'noon', 'golden-hour', 'dusk'] as const, 'golden-hour');
  const landscapeLighting = lt.landscape === true;
  const sconceBudget = Math.round(num(lt.exteriorSconces, 2, 0, 12));
  const sconces: LSconce[] = [];
  if (sconceBudget > 0) {
    for (const b of blocks) {
      for (const e of b.elevations) {
        for (const d of e.doors) {
          if (sconces.length >= sconceBudget) break;
          if (d.kind === 'entry') {
            const y = b.floorY + ft(6.2);
            for (const s of [-1, 1] as const) {
              if (sconces.length >= sconceBudget) break;
              const p = frameToWorld(e.frame, d.x + s * (d.w / 2 + ft(1.1)), y, 0.02);
              sconces.push({ position: p, yaw: e.frame.yaw });
            }
          } else if (d.kind === 'garage') {
            const y = d.h + ft(1.4); // garage doors start at the slab, not the finished floor
            const p = frameToWorld(e.frame, d.x, Math.min(y, b.eaveY - ft(0.8)), 0.02);
            sconces.push({ position: p, yaw: e.frame.yaw });
          }
        }
      }
    }
  }

  const upLights: LUpLight[] = [];
  if (landscapeLighting) {
    const frontElev = house.elevations.find((e) => e.wall === 'front');
    if (frontElev) {
      const n = Math.max(2, Math.min(5, Math.round(houseW / ft(12))));
      for (let i = 0; i < n; i++) {
        const lx = -houseW / 2 + ft(3) + ((houseW - ft(6)) * i) / Math.max(1, n - 1);
        if (wingSpan && wingSpan.wall === 'front' && lx > wingSpan.x0 && lx < wingSpan.x1) continue;
        const p = frameToWorld(frontElev.frame, lx, 0.12, ft(2.6));
        const t = frameToWorld(frontElev.frame, lx, eaveY * 0.85, ft(0.2));
        upLights.push({ position: p, target: t });
      }
    }
    if (wing) {
      const face = wing.elevations.find((e) => e.wall === wing!.accentWall);
      if (face) {
        const p = frameToWorld(face.frame, 0, 0.12, ft(2.6));
        const t = frameToWorld(face.frame, 0, wing.eaveY * 0.85, ft(0.2));
        upLights.push({ position: p, target: t });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Foundation beds, wall hardware, mailbox, and the context beyond the lot
  // -------------------------------------------------------------------------
  /** Is this point on flatwork? Nothing gets planted in the driveway. */
  const onPaving = (x: number, z: number): boolean =>
    [...driveway, ...walkway, ...(patio ? [patio] : [])].some(
      (pd) => Math.abs(x - pd.cx) < pd.w / 2 + ft(0.6) && Math.abs(z - pd.cz) < pd.d / 2 + ft(0.6),
    );

  const beds: LBed[] = [];
  for (const b of blocks) {
    for (const e of b.elevations) {
      if (e.wall === 'back') continue;
      const skip = porch && porch.wall === e.wall && b.key === 'house';
      const bedD = ft(3.2);
      // one run per elevation, shortened where the porch eats the middle
      const segs: Array<[number, number]> = skip
        ? [[-e.len / 2 + ft(0.5), porch!.x - porch!.w / 2 - ft(0.4)], [porch!.x + porch!.w / 2 + ft(0.4), e.len / 2 - ft(0.5)]]
        : [[-e.len / 2 + ft(0.5), e.len / 2 - ft(0.5)]];
      for (const [a, z] of segs) {
        const len = z - a;
        if (len < ft(3)) continue;
        const c = frameToWorld(e.frame, (a + z) / 2, 0, bedD / 2);
        beds.push({ cx: c[0], cz: c[2], w: len, d: bedD, yaw: e.frame.yaw });
        /*
         * Plant it. The house's own front bed is planted above, where the
         * porch, the entry door and the walkway are all known; every OTHER bed
         * used to get mulch and nothing else, so the sides and the garage read
         * as a strip of bare dirt wrapped round the house — which is what an
         * unfinished job looks like, not a finished one.
         */
        if (b.key === 'house' && e.wall === 'front') continue;
        const n = Math.max(1, Math.min(8, Math.round(len / ft(6))));
        for (let i = 0; i < n; i++) {
          const lx = a + (len * (i + 0.5)) / n;
          if (e.doors.some((dr) => Math.abs(dr.x - lx) < dr.w / 2 + ft(1.5))) continue;
          const w2 = frameToWorld(e.frame, lx, 0, bedD * 0.42);
          if (onPaving(w2[0], w2[2])) continue;
          shrubs.push({ x: w2[0], z: w2[2], scale: 0.7 + hash01(i * 7 + e.len * 3) * 0.45 });
        }
      }
    }
  }

  const utilities: LUtility[] = [];
  const front = house.elevations.find((e) => e.wall === 'front');
  const left = house.elevations.find((e) => e.wall === 'left');
  const right = house.elevations.find((e) => e.wall === 'right');
  const back = house.elevations.find((e) => e.wall === 'back');
  const entry = front?.doors.find((d) => d.kind === 'entry');
  const push = (kind: UtilityKind, e: LElevation | undefined, lx: number, ly: number) => {
    if (!e) return;
    utilities.push({ kind, position: frameToWorld(e.frame, clamp(lx, -e.len / 2 + ft(0.6), e.len / 2 - ft(0.6)), ly, 0.02), yaw: e.frame.yaw });
  };
  if (entry && front) {
    push('doorbell', front, entry.x + entry.w / 2 + trimW + ft(0.35), floorY + ft(3.8));
    push('numbers', front, entry.x - entry.w / 2 - trimW - ft(0.5), floorY + ft(5.4));
    push('outlet', front, entry.x + entry.w / 2 + trimW + ft(1.5), floorY + ft(1.5));
  } else if (front) {
    push('numbers', front, front.len / 2 - ft(2), floorY + ft(5.4));
  }
  push('hose-bib', front, front ? front.len / 2 - ft(2.5) : 0, floorY + ft(1.4));
  push('meter', left, left ? -left.len * 0.28 : 0, floorY + ft(4.2));
  push('dryer-vent', right, right ? right.len * 0.2 : 0, floorY + ft(2.6));
  push('vent-louver', back, 0, floorY + ft(2.2));
  if (left) {
    const p = frameToWorld(left.frame, left.len * 0.24, 0, ft(2.6));
    utilities.push({ kind: 'ac-condenser', position: [p[0], 0, p[2]], yaw: left.frame.yaw });
  }

  let mailbox: LMailbox | null = null;
  if (driveway.length) {
    const d0 = driveway[0];
    const side = d0.cx <= 0 ? 1 : -1;
    mailbox = {
      x: clamp(d0.cx + side * (d0.w / 2 + ft(2.5)), -lotW / 2 + ft(1), lotW / 2 - ft(1)),
      z: lotD / 2 - ft(1.5),
      yaw: Math.PI,
    };
  }

  // Context: the lot must not end in a visible void. A wide ground plane, a
  // neighbour's hedge down each side line, and a distant treeline well past the
  // property carry the horizon. All deterministic, all outside the buildable.
  const groundHalf = Math.max(lotW, lotD) * 1.9 + ft(120);
  const hedges: LHedge[] = [];
  const fencedSides = new Set(fence.length ? Array.from(new Set((Array.isArray(fenceSpec.sides) ? fenceSpec.sides : []) as Wall[])) : []);
  for (const s of ['left', 'right'] as const) {
    if (fencedSides.has(s)) continue;
    const x = (s === 'left' ? -1 : 1) * (lotW / 2 + ft(2.2));
    hedges.push({ x, z: -ft(6), length: lotD * 0.78, yaw: Math.PI / 2, height: ft(4.5) });
  }
  const treeline: LTree[] = [];
  {
    const rx = lotW / 2 + ft(55), rz = lotD / 2 + ft(55);
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + 0.4;
      const jitter = 0.78 + hash01(i * 9.7 + 1.3) * 0.5;
      const x = Math.cos(a) * rx * jitter;
      const z = Math.sin(a) * rz * jitter;
      // Keep the ENTIRE street side open. The camera views from the front and
      // off to one side, well beyond the lot line, so a ring tree anywhere in
      // the front hemisphere ends up between the lens and the facade — which is
      // exactly what it did: a row of canopies hid the whole house. The
      // backdrop only needs the rear and the far flanks to read as a horizon.
      if (z > -lotD * 0.05) continue;
      treeline.push({ x, z, variant: i % 4, scale: 1.15 + hash01(i * 3.3 + 6) * 0.7, rot: hash01(i * 2.1 + 9) * Math.PI * 2 });
    }
  }

  return {
    lotW, lotD, lotWidthFt, lotDepthFt, slope, style, houseStyle,
    present, proposed, trimW,
    house, wing, garage, blocks,
    buildable, envelope, porch, deck, chimney,
    driveway, walkway, patio, pool, fence, trees, shrubs, street,
    sconces, upLights, timeOfDay, landscapeLighting,
    beds, utilities, mailbox, hedges, treeline, groundHalf,
    warnings,
  };
}

const OPPOSITE_WALL: Record<Wall, Wall> = { front: 'back', back: 'front', left: 'right', right: 'left' };
