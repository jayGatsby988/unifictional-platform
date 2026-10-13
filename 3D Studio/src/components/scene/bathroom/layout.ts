/**
 * Bathroom layout solver — turns an (AI-produced, possibly odd) BathroomSpec
 * into a fully clamped, collision-resolved placement in METERS that the scene
 * components render without further validation.
 *
 * Every number is guarded: NaN / missing / absurd values fall back to sane
 * defaults, fixtures wider than their wall are shrunk, and fixtures that
 * crowd each other — on the SAME wall or across a CORNER — are pulled apart
 * with the more movable one yielding: it slides along its own wall by the
 * minimum that clears the other, and only when the wall end stops it does it
 * give up length, from the edge that faces the other (see `Anchor`). Nothing
 * here throws.
 */
import type { BathAccessory, BathAccessoryKind, BathroomLayout, BathroomSpec, CabinetDoorStyle, DecorSpec, DesignStyle, FixtureFinish, OpenShelf, Opening, Plant, TileModule, TilePattern, Wall, WallArt } from '@/lib/spec/types';
import { clamp, ft, inch } from '@/lib/units';
import { onWall, wallFrame } from '@/components/scene/geometry';
import { shelfFootprint, shelfPoint, shelfRotation } from '../shelf-frame';
import { tileOffsetAt } from './tile-height';
import { alcoveSurroundHeight, plantCanopyRadius } from './helpers';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
export function num(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return clamp(n, lo, hi);
}
export function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback) as T;
}
const WALLS: readonly Wall[] = ['back', 'left', 'right', 'front'];
const STYLES: readonly DesignStyle[] = ['modern', 'contemporary', 'transitional', 'traditional', 'farmhouse', 'scandinavian', 'industrial', 'coastal', 'mid-century', 'craftsman', 'mediterranean'];
const DOOR_STYLES: readonly CabinetDoorStyle[] = ['shaker', 'flat', 'raised', 'slab', 'beaded', 'glass', 'open'];

// The detail vocabularies. Every one of these is a field the contract already
// carried and the layout ignored, so each list is the schema's own order and
// each `pick` below falls back to the value the scene drew BEFORE the field
// existed — a spec written without them builds the identical room.
export type VanityLeg = NonNullable<BathroomSpec['vanity']['legStyle']>;
export type VanityBasin = NonNullable<BathroomSpec['vanity']['basin']>;
export type VanityFaucet = NonNullable<BathroomSpec['vanity']['faucetMount']>;
export type VanityHardware = NonNullable<BathroomSpec['vanity']['hardware']>;
export type VanitySplash = NonNullable<BathroomSpec['vanity']['backsplash']>;
export type ShowerDoor = NonNullable<BathroomSpec['shower']['doorType']>;
export type BenchStyle = NonNullable<BathroomSpec['shower']['benchStyle']>;
export type TubFiller = NonNullable<BathroomSpec['tub']['fillerType']>;
export type TubApronKind = NonNullable<BathroomSpec['tub']['apron']>;
export type TubMaterial = NonNullable<BathroomSpec['tub']['material']>;
export type TileTrim = NonNullable<BathroomSpec['wallTile']['trim']>;

const LEG_STYLES: readonly VanityLeg[] = ['none', 'tapered', 'turned', 'square', 'hairpin', 'plinth'];
const BASINS: readonly VanityBasin[] = ['undermount', 'integrated', 'vessel', 'semi-recessed', 'drop-in'];
const FAUCET_MOUNTS: readonly VanityFaucet[] = ['deck', 'wall', 'widespread', 'centerset', 'single-hole'];
const HARDWARES: readonly VanityHardware[] = ['pulls', 'knobs', 'mixed', 'integrated', 'none'];
const SPLASHES: readonly VanitySplash[] = ['none', 'standard', 'full-height', 'integrated'];
const SHOWER_DOORS: readonly ShowerDoor[] = ['hinged', 'sliding', 'barn', 'pivot', 'fixed-panel', 'walk-in', 'none'];
const BENCH_STYLES: readonly BenchStyle[] = ['corner', 'full-width', 'floating'];
const TUB_FILLERS: readonly TubFiller[] = ['deck-mount', 'wall-mount', 'floor-mount', 'roman', 'tub-shower-diverter', 'none'];
const TUB_APRONS: readonly TubApronKind[] = ['integral', 'tiled', 'panel', 'skirted', 'none'];
const TUB_MATERIALS: readonly TubMaterial[] = ['acrylic', 'cast-iron', 'stone-resin', 'solid-surface', 'copper', 'fiberglass', 'steel', 'wood'];
const TILE_PATTERNS: readonly TilePattern[] = ['stacked', 'running-bond', 'vertical-stack', 'herringbone', 'chevron', 'basketweave', 'hex', 'penny', 'mosaic', 'large-format', 'slab'];
const TILE_TRIMS: readonly TileTrim[] = ['none', 'bullnose', 'pencil', 'chair-rail', 'metal-edge'];
const FINISHES: readonly FixtureFinish[] = ['chrome', 'brushed-nickel', 'polished-nickel', 'matte-black', 'brushed-gold', 'polished-brass', 'oil-rubbed-bronze', 'stainless', 'white', 'black'];
const ACCESSORY_KINDS: readonly BathAccessoryKind[] = ['towel-bar', 'towel-ring', 'hook', 'robe-hook', 'grab-bar', 'toilet-paper-holder', 'towel-warmer', 'shower-caddy', 'corner-shelf'];

/** `null` on an optional field means "as the scene drew it before the field existed", so a nullable pick needs its own helper. */
function opt<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return v == null ? fallback : pick(v, allowed, fallback);
}
/** Same, for a nullable number: absent = the old constant, present = clamped. */
function optNum(v: unknown, fallback: number, lo: number, hi: number): number {
  return v == null ? fallback : num(v, fallback, lo, hi);
}
/** A module only survives if BOTH sides are real inches — a half-read module would silently retile the room. */
function optModule(v: unknown): TileModule | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Partial<TileModule>;
  if (typeof m.w !== 'number' || typeof m.h !== 'number' || !Number.isFinite(m.w) || !Number.isFinite(m.h)) return null;
  if (m.w < 0.5 || m.h < 0.5 || m.w > 96 || m.h > 96) return null;
  return { w: m.w, h: m.h };
}
/**
 * Fixed clearance from the finished top to the mirror glass — NOT "counter +
 * backsplash". Deriving it from the backsplash made the mirror hop 100 mm up
 * the wall the moment the wall-tile control changed.
 */
export const MIRROR_CLEAR = 0.235;
/** Height of the vessel bowl `Vanity.tsx` stands on the top (`vesselBasin(0.40, 0.135)`). */
export const VESSEL_H = 0.135;
const HEX = /^#[0-9a-fA-F]{6}$/;
function optHex(v: unknown): string | null { return typeof v === 'string' && HEX.test(v) ? v : null; }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Side = 'left' | 'right';
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * Which point of a fixture stays PUT when its size changes.
 *
 * This is the whole answer to "editing a dimension makes unrelated things
 * jump". A fixture that is snapped into a corner grows into the room from that
 * corner (`start` / `end`); a fixture floating on a wall grows about its own
 * declared centre (`center`). The anchor is derived from the SPEC's declared
 * `t`, never from the fitted result, so nudging a slider one notch can never
 * flip it.
 */
export type Anchor = 'start' | 'center' | 'end';

/** Something sitting against a wall. `a` = centre along the wall from the wall's origin (m); `x` = wall-local centred coordinate (a - len/2). */
export interface Placed {
  wall: Wall;
  /** wall length (m) */
  len: number;
  a: number;
  t: number;
  x: number;
  /** footprint along the wall (m) — outer size used for collisions */
  width: number;
  /** footprint into the room (m) */
  depth: number;
  rect: Rect;
  /** which edge stays put when the fixture is resized */
  anchor: Anchor;
  /**
   * Wall-local `a` of the anchored point: the near edge for `start`, the far
   * edge for `end`, the centre for `center`. Sweeping the fixture's own size
   * control must leave THIS number unchanged — that is the layout-stability
   * contract, and `scripts/check-bath-layout.ts` asserts it.
   */
  anchorA: number;
  /** the size the spec asked for, before any collision shrink */
  wantWidth: number;
  /**
   * How far (m) the collision solver had to move or shrink this fixture away
   * from its anchored placement. ZERO for everything the user's edit did not
   * genuinely crowd — which is the property `scripts/check-bath-layout.ts`
   * asserts, and the reason an edit no longer makes the room jump around.
   */
  displaced: number;
}

export interface LOpening {
  id: string;
  kind: 'window' | 'door' | 'passage';
  wall: Wall;
  /** wall-local centred x of the opening centre */
  x: number;
  t: number;
  width: number;
  height: number;
  sill: number;
  style: Opening['style'];
}

export interface LVanity extends Placed {
  style: BathroomSpec['vanity']['style'];
  sinks: 1 | 2;
  mirror: BathroomSpec['vanity']['mirror'];
  doorStyle: CabinetDoorStyle;
  /** finished top surface height */
  topH: number;
  /** underside of the cabinet body (floating / furniture legs) */
  bodyBottom: number;
  /** cabinet body depth (top overhangs it) */
  bodyDepth: number;
  topThickness: number;
  /** finished top length along the wall (the slab overhangs the carcase) */
  topW: number;
  /** basin centres, vanity-local x — what `Vanity.tsx` cuts the top around */
  basins: number[];
  /**
   * Wall-local centred x + height band the mirror(s), their sconces and the
   * light bar occupy, so nothing hung on this wall lands on the glass. Derived
   * from the same rules `Vanity.tsx` draws with, off the declared spec values.
   */
  mirrorBand: WallBand | null;
  /**
   * The FACE. A bathroom photograph is mostly the front of the vanity, and
   * every field below used to stop at the spec: the contract described a
   * cabinet the scene could not build. Each one falls back to what the scene
   * drew before it existed, so an old spec is byte-identical.
   */
  legStyle: VanityLeg;
  /** how far the box stands off the floor on its legs / plinth (0 = a toe kick) */
  legHeight: number;
  /** a shelf (or a rail) in the gap under a floating box */
  openShelf: boolean;
  basin: VanityBasin;
  faucetMount: VanityFaucet;
  hardware: VanityHardware;
  splash: VanitySplash;
  /** how many drawer stacks / hinged doors the user asked for; null = derive from the width */
  drawers: number | null;
  doors: number | null;
  /**
   * Escutcheon height of a WALL-mounted tap (null for every deck mount). It
   * lives here rather than in `Vanity.tsx` because the MIRROR has to know: the
   * tap used to be pinned a fixed 420 mm over the top while the glass started
   * at 235 mm, so a wall tap over a vessel basin was drawn straight through
   * the mirror. One number, two consumers.
   */
  tapY: number | null;
  /** lower edge of the mirror glass — lifted clear of a wall tap's handles */
  mirrorBottom: number;
}

export interface LShower extends Placed {
  enclosure: BathroomSpec['shower']['enclosure'];
  niche: boolean;
  bench: boolean;
  curbless: boolean;
  fixtures: BathroomSpec['shower']['fixtures'];
  /** clear interior width between tiled surfaces */
  inner: number;
  /** interior centre offset from the outer footprint centre (wall-local x) */
  innerOffset: number;
  leftIsRoomWall: boolean;
  rightIsRoomWall: boolean;
  partition: number;
  doorSide: Side;
  /** tub-shower combo: an alcove tub lives inside the footprint */
  hasTub: boolean;
  tubLength: number;
  /** curb above the finished floor (0 when curbless) */
  curbHeight: number;
  /** glass panel thickness */
  glassThickness: number;
  /** what actually opens — derived from `enclosure` when the spec is silent */
  doorType: ShowerDoor;
  benchStyle: BenchStyle;
  /** where the niche is cut; non-null exactly when `niche` is true */
  nicheAt: LNiche | null;
  /** the enclosure's own metal; null = the room's `fixtures` slot */
  hardwareFinish: FixtureFinish | null;
}

/** A niche resolved into the STALL's own frame. `x` is along the face it is cut into. */
export interface LNiche {
  face: 'back' | 'left' | 'right';
  x: number;
  /** sill above the finished floor */
  bottom: number;
  width: number;
  height: number;
  depth: number;
  shelves: number;
}

export interface LTub extends Placed {
  kind: BathroomSpec['tub']['kind'];
  length: number;
  /** clear gap between the wall and the tub body */
  gap: number;
  corner: Side | null;
  /** the body across the room (`depth` less `gap`) — what the shell is scaled to */
  across: number;
  /** rim above the finished floor */
  rimHeight: number;
  apron: TubApronKind;
  filler: TubFiller;
  fillerFinish: FixtureFinish | null;
  /**
   * What it is made of. Not a colour — a rolled cast-iron rim is 40 mm and an
   * acrylic soaker's is 30, which is most of what tells the two apart at the
   * same length.
   */
  material: TubMaterial;
}

export interface LToilet extends Placed {
  style: BathroomSpec['toilet']['style'];
  /**
   * The trip lever / seat-hinge metal, when the client says it is a different
   * metal from the room's `fixtures` slot. Null means "whatever the slot
   * carries" — the same rule the shower's hardware and the tub's filler keep.
   */
  trimFinish: FixtureFinish | null;
}

export interface LLighting {
  recessed: number;
  sconces: number;
  underCabinet: boolean;
  pendants: { count: number; style: NonNullable<BathroomSpec['lighting']['pendants']>['style'] } | null;
  chandelier: boolean;
  colorTempK: number;
  naturalLight: 'low' | 'medium' | 'high';
}

export interface Segment { wall: Wall; a0: number; a1: number }

/** A rectangle on a wall face: wall-local centred x, height above the floor. */
export interface WallBand { x0: number; x1: number; y0: number; y1: number }

/**
 * Where the solver could not honour the spec. Décor is never DROPPED — a
 * photo that shows a shelf gets a shelf — but when it had to be shrunk hard
 * or drawn through something, the Layout tab can say so.
 */
export interface DecorWarning { piece: 'shelf' | 'plant' | 'art' | 'rug'; index: number; message: string }

/** Something hung on a wall (a shelf, a picture). Same anchor contract as the fixtures: `anchorA` is the declared centre and sweeping the piece's own size cannot move it. */
export interface WallPiece {
  wall: Wall;
  len: number;
  a: number;
  t: number;
  x: number;
  width: number;
  anchorA: number;
  wantWidth: number;
  displaced: number;
  /** wall-local band the piece and its contents occupy */
  band: WallBand;
  /** plan-view footprint (world XZ) */
  rect: Rect;
}

export interface LShelf extends WallPiece {
  depth: number;
  count: number;
  /** height of the lowest board */
  bottom: number;
  spacing: number;
  material: OpenShelf['material'];
  styled: OpenShelf['styled'];
  thickness: number;
  enclosure: { bottom: number; top: number; panelThickness: number; backPanel: boolean; rotationDeg: number } | null;
  standoff: number;
  finishColorHex: string | null;
}

export interface LArt extends WallPiece {
  height: number;
  centerY: number;
  frame: WallArt['frame'];
}

export interface LPlant {
  kind: Plant['kind'];
  form: Plant['form'];
  /** overall height (m), already clamped to what fits where it stands */
  size: number;
  /** pot diameter */
  potD: number;
  /** world position of the pot base (counter / shelf / floor / hanging pot bottom) */
  x: number; y: number; z: number;
  /** yaw so the plant faces into the room off the wall it stands against */
  yaw: number;
  /** plan-view clearance radius used for collisions */
  radius: number;
  /** the wall it stands against / hangs by, when it does */
  wall: Wall | null;
  /** for a shelf plant: which shelf it sits on */
  shelfIndex: number | null;
  /** for a hanging plant: how far the strands drop below the pot */
  drop: number;
  displaced: number;
}

export interface LRug {
  style: NonNullable<DecorSpec['rug']>['style'];
  /** long dimension (diameter when round) */
  length: number;
  width: number;
  x: number; z: number;
  /** 0 = long axis along world x, π/2 = along world z */
  yaw: number;
  rect: Rect;
  displaced: number;
}

export interface LTreatment {
  kind: Exclude<DecorSpec['windowTreatment'], 'none'>;
  openingId: string;
  wall: Wall;
  t: number;
  x: number;
  width: number;
  height: number;
  sill: number;
}

export interface LDecor {
  shelves: LShelf[];
  plants: LPlant[];
  art: LArt[];
  rug: LRug | null;
  windowTreatment: DecorSpec['windowTreatment'];
  treatments: LTreatment[];
  counterStyling: DecorSpec['counterStyling'];
  warnings: DecorWarning[];
}

/** One wall's worth of tile: where it stops, how it is laid, how it is capped. */
export interface LTile {
  height: BathroomSpec['wallTile']['height'];
  /** where the field stops above the floor, m; null = the category's own stop line */
  stopH: number | null;
  pattern: TilePattern | null;
  module: TileModule | null;
  /** grout joint width, m; null = the joint the geometry has always drawn */
  grout: number | null;
  trim: TileTrim;
  accent: LAccent | null;
  /** the stall's own layout when it differs from the field */
  showerPattern: TilePattern | null;
  showerModule: TileModule | null;
}

/** The ONE wall done differently from the field. */
export interface LAccent {
  wall: Wall;
  pattern: TilePattern;
  module: TileModule | null;
  stopH: number | null;
  colorHex: string | null;
}

/**
 * A towel bar, ring, hook, grab bar or paper holder the spec actually asked
 * for. Same discipline as everything else on a wall: clamped inside the wall,
 * slid clear of an opening it would land in, and `displaced` says by how much
 * so the Layout tab can admit it.
 */
export interface LAccessory {
  kind: BathAccessoryKind;
  wall: Wall;
  len: number;
  a: number;
  t: number;
  x: number;
  /** centre height above the finished floor */
  y: number;
  /** length along the wall */
  width: number;
  /** null = the room's `hardware` slot */
  finish: FixtureFinish | null;
  displaced: number;
}

export interface BathLayout {
  w: number; d: number; h: number;
  widthFt: number; depthFt: number; ceilingFt: number;
  style: DesignStyle;
  layout: BathroomLayout;
  /** the tile CATEGORY — where tile goes. `tile` says what it looks like. */
  wallTile: BathroomSpec['wallTile']['height'];
  tile: LTile;
  accessories: LAccessory[];
  openings: LOpening[];
  vanity: LVanity | null;
  shower: LShower | null;
  tub: LTub | null;
  toilet: LToilet | null;
  lighting: LLighting;
  /** wall-local free intervals (in `a` coords) usable for accessories */
  free: Segment[];
  /** all fixture footprints (world XZ) */
  rects: Rect[];
  /** shelves, plants, art, rug and window treatments — clamped and placed */
  decor: LDecor;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
export function wallLength(wall: Wall, w: number, d: number): number { return wall === 'back' || wall === 'front' ? w : d; }

export function rectOnWall(wall: Wall, w: number, d: number, a: number, width: number, depth: number): Rect {
  const f = wallFrame(wall, w, d);
  const p0 = f.origin.clone().addScaledVector(f.along, a - width / 2);
  const p1 = f.origin.clone().addScaledVector(f.along, a + width / 2).addScaledVector(f.normal, depth);
  return { minX: Math.min(p0.x, p1.x), maxX: Math.max(p0.x, p1.x), minZ: Math.min(p0.z, p1.z), maxZ: Math.max(p0.z, p1.z) };
}

export function rectCenter(r: Rect): [number, number] { return [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]; }

/** Project a world rect onto a wall. Returns the wall-local centred x interval it covers and how far its nearest edge is from the wall plane. */
export function projectRectOnWall(wall: Wall, w: number, d: number, r: Rect): { x0: number; x1: number; perp: number } {
  const f = wallFrame(wall, w, d);
  const corners = [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]];
  let perp = Infinity, a0 = Infinity, a1 = -Infinity;
  for (const [x, z] of corners) {
    const dx = x - f.origin.x, dz = z - f.origin.z;
    const along = dx * f.along.x + dz * f.along.z;
    perp = Math.min(perp, dx * f.normal.x + dz * f.normal.z);
    a0 = Math.min(a0, along); a1 = Math.max(a1, along);
  }
  return { x0: a0 - f.length / 2, x1: a1 - f.length / 2, perp };
}

/** Subtract intervals from [lo, hi]. */
export function subtractIntervals(lo: number, hi: number, cuts: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...cuts].sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let cursor = lo;
  for (const [c0, c1] of sorted) {
    if (c0 > cursor) out.push([cursor, Math.min(c0, hi)]);
    cursor = Math.max(cursor, c1);
    if (cursor >= hi) break;
  }
  if (cursor < hi) out.push([cursor, hi]);
  return out.filter(([a, b]) => b - a > 0.02);
}

function overlapOf(a: Rect, b: Rect): { ox: number; oz: number } {
  return {
    ox: Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX),
    oz: Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ),
  };
}

// ---------------------------------------------------------------------------
// Collision bodies
// ---------------------------------------------------------------------------
interface Body {
  key: 'vanity' | 'shower' | 'tub' | 'toilet' | 'door';
  wall: Wall;
  len: number;
  /** declared position fraction along the wall — the STABLE input, never re-derived */
  t0: number;
  anchor: Anchor;
  /** clear gap held between the wall end and the near edge, for start/end anchors */
  anchorGap: number;
  a: number;
  width: number;
  /** the width the spec asked for (collisions may shrink `width` below it) */
  wantWidth: number;
  depth: number;
  /** a corner tub is as deep as it is long, so a width shrink must shrink its depth too */
  square: boolean;
  /** higher = more willing to move */
  rank: number;
  fixed: boolean;
  minWidth: number;
}

/** Clearance the solver holds between neighbours (and a fixture and a door swing). */
const GAP = 0.05;
/**
 * Nothing sits closer than this to a wall end. ONE constant for both
 * `fitBody` and `clampA`: when the two disagreed (5 mm vs 10 mm) a centred
 * body that had been shrunk to fit its wall end was then nudged 5 mm by the
 * clamp, and its anchor crept as its length slider crossed the wall cap.
 */
const EDGE = 0.01;
/**
 * Two footprints closer than this on BOTH axes are "crowding" each other and
 * get separated to GAP. A hair under GAP so that neighbours the solver itself
 * parked exactly GAP apart do not count as crowded on the next pass.
 */
const CONTACT = GAP - 0.004;

function clampA(b: Body): number {
  const lo = b.width / 2 + EDGE, hi = b.len - b.width / 2 - EDGE;
  return lo > hi ? b.len / 2 : clamp(b.a, lo, hi);
}

function bodyRect(b: Body, w: number, d: number): Rect { return rectOnWall(b.wall, w, d, b.a, b.width, b.depth); }

/**
 * Place a body from its ANCHOR, not from a clamp on its centre.
 *
 * The bug this replaces: `a = clamp(t * len, width/2, len - width/2)` slides a
 * fixture sideways the moment it gets wider near a wall end, so widening the
 * vanity translated it and the shower crept along the wall as it grew. Here an
 * edit to a size changes only that size:
 *   - `start` / `end` — the corner edge is fixed, the fixture grows inward.
 *   - `center`        — the declared centre is fixed; if the fixture would run
 *                       off the wall we shrink the SIZE about that centre and
 *                       only slide as a genuine last resort (a body narrower
 *                       than `minWidth` that still cannot fit).
 */
function fitBody(b: Body) {
  b.width = Math.min(b.width, Math.max(0.05, b.len - 2 * EDGE));
  if (b.anchor === 'start') {
    b.a = b.anchorGap + b.width / 2;
  } else if (b.anchor === 'end') {
    b.a = b.len - b.anchorGap - b.width / 2;
  } else {
    const centre = clamp(b.t0, 0, 1) * b.len;
    const room = Math.min(centre, b.len - centre) - EDGE;
    if (b.width / 2 > room) b.width = Math.max(Math.min(b.minWidth, b.len - 2 * EDGE), 2 * room);
    b.a = centre;
  }
  if (b.square) b.depth = b.width;
  b.a = clampA(b);
}

/** Wall-local `a` of the point that must not move when the body is resized. */
function anchorA(b: { anchor: Anchor; a: number; width: number }): number {
  return b.anchor === 'start' ? b.a - b.width / 2 : b.anchor === 'end' ? b.a + b.width / 2 : b.a;
}

/** Do two footprints crowd each other — overlap, or sit closer than the clearance we hold? */
function crowded(a: Rect, b: Rect): boolean {
  const { ox, oz } = overlapOf(a, b);
  return ox > -CONTACT && oz > -CONTACT;
}

/**
 * How far `other` reaches past the edge of `b` that faces it, ALONG b's own
 * wall, and which edge that is (+1 = the one toward the wall's far end). This
 * is the one measurement both a same-wall and a cross-corner conflict reduce
 * to: a body on the adjacent wall projects onto this wall as the strip its
 * DEPTH covers from the corner, and `b` is clear of it once its facing edge
 * has backed out of that strip. Measured edge-to-edge (not as an overlap
 * length) so that it is exactly the distance the facing edge must retreat,
 * even when `other` sits wholly inside `b`'s span. Negative when they are
 * already apart, by the separation.
 */
function reach(b: Body, other: Rect, w: number, d: number): { ov: number; side: 1 | -1 } {
  const p = projectRectOnWall(b.wall, w, d, other);
  const p0 = p.x0 + b.len / 2, p1 = p.x1 + b.len / 2;
  const side: 1 | -1 = (p0 + p1) / 2 >= b.a ? 1 : -1;
  const ov = side === 1 ? b.a + b.width / 2 - p0 : p1 - (b.a - b.width / 2);
  return { ov, side };
}

/** Do two walls run the same way (same or opposite walls), so a slide along one is a slide along the other's axis too? */
function parallel(a: Wall, b: Wall): boolean {
  return (a === 'back' || a === 'front') === (b === 'back' || b === 'front');
}

/**
 * Pull the edge of `b` that faces `side` back by `need`; the opposite edge
 * stays where it is. For a corner-anchored body that opposite edge is its
 * anchor, so the anchored point is untouched — and if the facing edge IS the
 * anchor (a stall cannot back out of its corner) nothing happens and the
 * caller lets the other body give way. A centred body normally gets here only
 * after `slideAway` has pushed it against a wall end, so keeping the far edge
 * keeps it against that wall; shrinking it symmetrically instead would walk it
 * back off the wall, and a vanity dragged wider would then get NARROWER (the
 * symmetric cut is twice the intrusion, the growth only once). Returns how
 * far the facing edge actually retreated (zero at `minWidth`).
 */
function shrinkAway(b: Body, side: 1 | -1, need: number): number {
  if (need <= 1e-9) return 0;
  if (b.anchor === 'start' && side === -1) return 0;
  if (b.anchor === 'end' && side === 1) return 0;
  const newW = Math.max(b.minWidth, b.width - need);
  const cut = b.width - newW;
  if (cut <= 1e-9) return 0;
  b.width = newW;
  b.a -= side * cut / 2;
  if (b.square) b.depth = b.width;
  return cut;
}

/** Slide `b` along its wall away from `side` by `need`, stopping at the wall end. Returns the distance achieved. */
function slideAway(b: Body, side: 1 | -1, need: number): number {
  if (need <= 1e-9) return 0;
  const before = b.a;
  b.a -= side * need;
  b.a = clampA(b);
  return Math.abs(b.a - before);
}

/**
 * Separate one crowding pair. The more movable body yields (`rank`; a door
 * never moves). Each step is taken only if the previous ones left the pair
 * still crowded, and each takes the MINIMUM that clears it:
 *   1. the yielder slides along its own wall, away from the other;
 *   2. the other body slides — but only when the two walls are parallel.
 *      Across a corner the other's axis is perpendicular, and "clearing" on
 *      that axis means leaving the corner altogether (a full depth strip),
 *      which would make a stall jump a metre the moment a toilet ran out of
 *      room. Across a corner the yielder is the only one that moves;
 *   3. the yielder backs its facing edge off, keeping its anchored edge;
 *   4. the other body does the same.
 * Every amount grows from zero with the intrusion, so the response to a
 * slider is continuous: a one-notch edit can never make a neighbour jump.
 * Returns whether anything changed.
 */
function separate(A: Body, B: Body, w: number, d: number): boolean {
  const Y = A.fixed ? B : B.fixed ? A : A.rank >= B.rank ? A : B;
  const O = Y === A ? B : A;
  const steps: Array<[Body, Body, (b: Body, side: 1 | -1, need: number) => number]> = [
    [Y, O, slideAway], [O, Y, slideAway], [Y, O, shrinkAway], [O, Y, shrinkAway],
  ];
  let changed = false;
  for (const [mover, other, act] of steps) {
    if (mover.fixed) continue;
    if (act === slideAway && mover === O && !parallel(Y.wall, O.wall)) continue;
    if (!crowded(bodyRect(mover, w, d), bodyRect(other, w, d))) break;
    const { ov, side } = reach(mover, bodyRect(other, w, d), w, d);
    if (act(mover, side, ov + GAP) > 1e-9) changed = true;
  }
  return changed;
}

/**
 * Push apart every pair of bodies whose footprints crowd each other, in world
 * space — so a vanity on the left wall and a tub on the back wall meet at the
 * corner exactly like two neighbours on one wall do. Only pairs actually in
 * conflict are touched; everything else keeps the placement `fitBody` gave it
 * (`displaced` = 0). Slides are bounded by the wall ends and widths only ever
 * decrease, so the passes settle; a brief that is physically impossible (more
 * fixture than wall) simply stops improving and is drawn as declared.
 */
function resolve(bodies: Body[], w: number, d: number) {
  for (let iter = 0; iter < 24; iter++) {
    let changed = false;
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i], B = bodies[j];
      if (A.fixed && B.fixed) continue;
      if (!crowded(bodyRect(A, w, d), bodyRect(B, w, d))) continue;
      if (separate(A, B, w, d)) changed = true;
    }
    if (!changed) break;
  }
}
// ---------------------------------------------------------------------------
// Free wall segments (for accessories)
// ---------------------------------------------------------------------------
/**
 * Stock sizes along the wall, inches. `widthIn: null` on the spec means "the
 * size this fitting comes in", not "zero" — a towel ring is 6" across whatever
 * the slider's range happens to be.
 */
const ACCESSORY_WIDTH_IN: Record<BathAccessoryKind, number> = {
  'towel-bar': 24, 'towel-ring': 6, hook: 3, 'robe-hook': 3, 'grab-bar': 24,
  'toilet-paper-holder': 7, 'towel-warmer': 22, 'shower-caddy': 12, 'corner-shelf': 10,
};

/**
 * Bars, rings, hooks and the paper holder the spec actually asked for.
 *
 * They obey the same rule as everything else on a wall: clamped inside the
 * wall, then slid the MINIMUM that clears an opening they would otherwise be
 * screwed through, with `displaced` recording how far so the Layout tab can
 * say it. A fitting is never dropped — a photo that shows a towel bar gets a
 * towel bar.
 */
function placeAccessories(raw: unknown, w: number, d: number, h: number, openings: LOpening[]): LAccessory[] {
  if (!Array.isArray(raw)) return [];
  const out: LAccessory[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const A = item as Partial<BathAccessory>;
    const kind = pick<BathAccessoryKind>(A.kind, ACCESSORY_KINDS, 'towel-bar');
    const wall = pick<Wall>(A.wall, WALLS, 'back');
    const len = wallLength(wall, w, d);
    if (len < 0.4) continue;
    const width = clamp(inch(A.widthIn == null ? ACCESSORY_WIDTH_IN[kind] : num(A.widthIn, ACCESSORY_WIDTH_IN[kind], 2, 60)), 0.05, Math.max(0.05, len - 0.10));
    const y = clamp(ft(num(A.heightFt, 4, 0.5, 8)), 0.15, Math.max(0.15, h - 0.12));
    const want = clamp(num(A.t, 0.5, 0, 1) * len, width / 2 + 0.04, Math.max(width / 2 + 0.04, len - width / 2 - 0.04));
    // an opening only blocks the fitting if they are at the same HEIGHT — a bar
    // at 1.2 m and a window whose sill is at 1.5 m share a wall, not a hole
    const blocks: Array<[number, number]> = [];
    for (const o of openings) {
      if (o.wall !== wall) continue;
      if (o.sill > y + 0.12 || o.sill + o.height < y - 0.12) continue;
      const c = o.x + len / 2;
      blocks.push([c - o.width / 2 - 0.05, c + o.width / 2 + 0.05]);
    }
    let a = want;
    for (const [b0, b1] of blocks.sort((p, q) => p[0] - q[0])) {
      if (a + width / 2 <= b0 || a - width / 2 >= b1) continue;
      const left = b0 - width / 2, right = b1 + width / 2;
      const goLeft = Math.abs(left - want) <= Math.abs(right - want);
      a = clamp(goLeft ? left : right, width / 2 + 0.04, Math.max(width / 2 + 0.04, len - width / 2 - 0.04));
    }
    out.push({
      kind, wall, len, a, t: a / len, x: a - len / 2, y, width,
      finish: A.finish == null ? null : pick<FixtureFinish>(A.finish, FINISHES, 'chrome'),
      displaced: Math.abs(a - want),
    });
  }
  return out;
}

function freeSegments(wall: Wall, w: number, d: number, rects: Rect[], openings: LOpening[], hung: WallPiece[] = []): Segment[] {
  const f = wallFrame(wall, w, d);
  const len = f.length;
  const busy: Array<[number, number]> = [];
  for (const p of hung) {
    if (p.wall !== wall) continue;
    // only what a bar / hook / ring / holder could actually hit
    if (p.band.y1 < 0.6 || p.band.y0 > 1.75) continue;
    busy.push([p.a - p.width / 2 - 0.05, p.a + p.width / 2 + 0.05]);
  }
  for (const r of rects) {
    const corners = [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]];
    let minPerp = Infinity, a0 = Infinity, a1 = -Infinity;
    for (const [x, z] of corners) {
      const dx = x - f.origin.x, dz = z - f.origin.z;
      const along = dx * f.along.x + dz * f.along.z;
      const perp = dx * f.normal.x + dz * f.normal.z;
      minPerp = Math.min(minPerp, perp);
      a0 = Math.min(a0, along); a1 = Math.max(a1, along);
    }
    if (minPerp < 0.4) busy.push([a0 - 0.05, a1 + 0.05]);
  }
  for (const o of openings) {
    if (o.wall !== wall) continue;
    if (o.kind === 'window' && o.sill > 1.45) continue;
    const c = o.x + len / 2;
    busy.push([c - o.width / 2 - 0.08, c + o.width / 2 + 0.08]);
  }
  busy.sort((p, q) => p[0] - q[0]);
  const out: Segment[] = [];
  let cursor = 0.05;
  for (const [b0, b1] of busy) {
    if (b0 > cursor + 0.02) out.push({ wall, a0: cursor, a1: Math.min(b0, len - 0.05) });
    cursor = Math.max(cursor, b1);
  }
  if (cursor < len - 0.07) out.push({ wall, a0: cursor, a1: len - 0.05 });
  return out.filter((s) => s.a1 - s.a0 > 0.1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function computeBathroomLayout(specIn: BathroomSpec | null | undefined): BathLayout {
  const spec = (specIn ?? {}) as Partial<BathroomSpec>;
  const dims = (spec.dims ?? {}) as Partial<BathroomSpec['dims']>;
  const widthFt = num(dims.widthFt, 8, 4, 80);
  const depthFt = num(dims.depthFt, 8, 4, 80);
  const ceilingFt = num(dims.ceilingFt, 8.5, 7, 20);
  const w = ft(widthFt), d = ft(depthFt), h = ft(ceilingFt);
  const style = pick<DesignStyle>(spec.style, STYLES, 'contemporary');
  const layout = pick<BathroomLayout>(spec.layout, ['powder', 'full', 'three-quarter', 'primary', 'jack-and-jill'], 'full');
  const wt = (spec.wallTile ?? {}) as Partial<BathroomSpec['wallTile']>;
  const wallTile = pick<BathroomSpec['wallTile']['height']>(wt.height, ['none', 'wainscot', 'shower-only', 'full', 'accent-wall'], 'shower-only');
  const rawAccent = wt.accent && typeof wt.accent === 'object' ? wt.accent : null;
  const tile: LTile = {
    height: wallTile,
    // A measured stop line overrides the category's own everywhere the field is
    // drawn; null leaves `tileHeightFor` exactly as it was.
    stopH: wt.heightIn == null ? null : inch(num(wt.heightIn, 42, 6, 168)),
    pattern: wt.pattern == null ? null : pick<TilePattern>(wt.pattern, TILE_PATTERNS, 'running-bond'),
    module: optModule(wt.moduleIn),
    grout: wt.groutWidthIn == null ? null : inch(num(wt.groutWidthIn, 0.125, 0, 0.75)),
    trim: opt<TileTrim>(wt.trim, TILE_TRIMS, 'none'),
    accent: rawAccent
      ? {
        wall: pick<Wall>(rawAccent.wall, WALLS, 'back'),
        pattern: pick<TilePattern>(rawAccent.pattern, TILE_PATTERNS, 'stacked'),
        module: optModule(rawAccent.moduleIn),
        stopH: rawAccent.heightIn == null ? null : inch(num(rawAccent.heightIn, 96, 6, 168)),
        colorHex: optHex(rawAccent.colorHex),
      }
      : null,
    showerPattern: wt.showerPattern == null ? null : pick<TilePattern>(wt.showerPattern, TILE_PATTERNS, 'running-bond'),
    showerModule: optModule(wt.showerModuleIn),
  };

  // --- openings
  const openings: LOpening[] = [];
  const rawOpenings = Array.isArray(spec.openings) ? spec.openings : [];
  rawOpenings.forEach((o, i) => {
    if (!o || typeof o !== 'object') return;
    const kindRaw = pick<Opening['kind']>(o.kind, ['window', 'door', 'passage', 'garage-door'], 'window');
    const kind: LOpening['kind'] = kindRaw === 'garage-door' ? 'passage' : kindRaw;
    const wall = pick<Wall>(o.wall, WALLS, 'back');
    const len = wallLength(wall, w, d);
    if (len < 0.8) return;
    let width: number, height: number, sill: number;
    if (kind === 'window') {
      width = clamp(ft(num(o.widthFt, 3, 1, 40)), 0.3, Math.max(0.3, len - 0.3));
      sill = clamp(ft(num(o.sillFt, 3.5, 0, 12)), 0, h - 0.6);
      height = clamp(ft(num(o.heightFt, 3, 1, 12)), 0.3, Math.max(0.3, h - sill - 0.15));
    } else {
      width = clamp(ft(num(o.widthFt, 2.67, 1.5, 12)), 0.6, Math.max(0.6, Math.min(kind === 'passage' ? len - 0.3 : 1.6, len - 0.3)));
      sill = 0;
      height = clamp(ft(num(o.heightFt, 6.67, 5, 12)), 1.9, Math.max(1.9, h - 0.08));
    }
    // Same anchoring rule as the fixtures: an opening that will not fit at its
    // declared centre is made NARROWER, it is not slid along the wall.
    const t = num(o.t, 0.5, 0, 1);
    const centre = t * len;
    const roomEachSide = Math.min(centre, len - centre) - 0.06;
    if (width / 2 > roomEachSide) width = Math.max(0.3, 2 * roomEachSide);
    const a = clamp(centre, width / 2 + 0.06, len - width / 2 - 0.06);
    openings.push({ id: typeof o.id === 'string' && o.id ? o.id : `opening-${i}`, kind, wall, x: a - len / 2, t: a / len, width, height, sill, style: o.style ?? null });
  });

  // --- lighting
  const lt = (spec.lighting ?? {}) as Partial<BathroomSpec['lighting']>;
  const pendantsRaw = lt.pendants && typeof lt.pendants === 'object' ? lt.pendants : null;
  const lighting: LLighting = {
    recessed: Math.round(num(lt.recessedCount, 4, 0, 12)),
    sconces: Math.round(num(lt.sconces, 2, 0, 6)),
    underCabinet: !!lt.underCabinet,
    pendants: pendantsRaw && num(pendantsRaw.count, 0, 0, 4) > 0
      ? { count: Math.round(num(pendantsRaw.count, 1, 1, 4)), style: pick(pendantsRaw.style, ['globe', 'cone', 'dome', 'drum', 'lantern', 'linear', 'cage', 'glass'] as const, 'globe') }
      : null,
    chandelier: !!lt.chandelier,
    colorTempK: num(lt.colorTempK, 3000, 2200, 5500),
    naturalLight: pick(lt.naturalLight, ['low', 'medium', 'high'] as const, 'medium'),
  };

  // --- fixture bodies
  const bodies: Body[] = [];
  const PT = inch(4.5);

  const vs = (spec.vanity ?? {}) as Partial<BathroomSpec['vanity']>;
  const vanityPresent = vs.present === true;
  const vanityStyle = pick<BathroomSpec['vanity']['style']>(vs.style, ['floating', 'freestanding', 'furniture', 'pedestal', 'console'], 'freestanding');
  let vanityWidthIn = num(vs.widthIn, 36, 18, 120);
  if (vanityStyle === 'pedestal') vanityWidthIn = clamp(vanityWidthIn, 20, 28);
  if (vanityStyle === 'console') vanityWidthIn = clamp(vanityWidthIn, 24, 72);
  const vanitySinks: 1 | 2 = vs.sinks === 2 && vanityWidthIn >= 48 && vanityStyle !== 'pedestal' ? 2 : 1;
  const vanityT = num(vs.t, 0.5, 0, 1);
  /**
   * Legs are a property of the CARCASE, so they have to be resolved before the
   * body: they set how far the box stands off the floor, which sets its height,
   * which sets the front plan. A pedestal / console / floating vanity has no
   * legs to speak of, and `null` on a furniture vanity is the turned leg it has
   * always stood on — at exactly the 6" it has always stood at.
   */
  const legDefault: VanityLeg = vanityStyle === 'furniture' ? 'turned' : 'none';
  const vanityLeg: VanityLeg = vanityStyle === 'floating' || vanityStyle === 'pedestal' || vanityStyle === 'console'
    ? 'none'
    : opt<VanityLeg>(vs.legStyle, LEG_STYLES, legDefault);
  const legHeight = vanityLeg === 'none' ? 0
    : vanityLeg === 'plinth' ? inch(3.5)
      : vs.legStyle == null ? inch(6)
        : vanityLeg === 'hairpin' ? inch(7) : inch(6.5);
  const vanityDepthIn = optNum(vs.depthIn, vanityStyle === 'pedestal' ? 19 : vanityStyle === 'console' ? 20 : 21, 14, 26);
  if (vanityPresent) {
    const wall = pick<Wall>(vs.wall, WALLS, 'left');
    const len = wallLength(wall, w, d);
    const depth = inch(vanityDepthIn);
    // A vanity grows about its declared centre: dragging the width slider must
    // widen it symmetrically, never walk it along the wall.
    const width = inch(vanityWidthIn) + inch(1.5);
    bodies.push({
      key: 'vanity', wall, len, t0: vanityT, anchor: 'center', anchorGap: 0,
      a: vanityT * len, width, wantWidth: width, depth: depth + inch(1.5),
      square: false, rank: 2, fixed: false, minWidth: inch(20),
    });
  }

  const ss = (spec.shower ?? {}) as Partial<BathroomSpec['shower']>;
  const showerPresent = ss.present === true;
  const enclosure = pick<BathroomSpec['shower']['enclosure']>(ss.enclosure, ['frameless-glass', 'framed-glass', 'curtain', 'open', 'tub-shower'], 'frameless-glass');
  const ts = (spec.tub ?? {}) as Partial<BathroomSpec['tub']>;
  const tubKind = pick<BathroomSpec['tub']['kind']>(ts.kind, ['alcove', 'freestanding', 'drop-in', 'clawfoot', 'corner'], 'alcove');
  let tubLengthIn = num(ts.lengthIn, 60, 48, 84);
  if (tubKind === 'corner') tubLengthIn = clamp(tubLengthIn, 54, 72);
  let tubPresent = ts.present === true;
  const tubWall = pick<Wall>(ts.wall, WALLS, 'back');
  const showerWall = pick<Wall>(ss.wall, WALLS, 'back');
  const showerT = num(ss.t, 0.75, 0, 1);
  const tubT = num(ts.t, 0.25, 0, 1);
  // tub-shower combo swallows a separate alcove tub declared at the same place
  const comboTubLength = enclosure === 'tub-shower' ? clamp(tubPresent && tubKind === 'alcove' ? tubLengthIn : Math.max(60, num(ss.widthIn, 60, 30, 96)), 54, 72) : 0;
  if (showerPresent && enclosure === 'tub-shower' && tubPresent && (tubKind === 'alcove' || (tubWall === showerWall && Math.abs(tubT - showerT) < 0.3))) tubPresent = false;

  // Which corner (if any) the stall is snapped into is decided from the SPEC's
  // declared t alone. Deriving it from the fitted footprint is what made the
  // shower slide across the wall as it was resized.
  const showerAnchor: Anchor = showerT <= 0.28 ? 'start' : showerT >= 0.72 ? 'end' : 'center';
  const showerWidthIn = num(ss.widthIn, 42, 30, 96);
  if (showerPresent) {
    const len = wallLength(showerWall, w, d);
    const perp = showerWall === 'back' || showerWall === 'front' ? d : w;
    let width = enclosure === 'tub-shower' ? inch(comboTubLength) + 2 * PT : inch(showerWidthIn);
    let depth = enclosure === 'tub-shower' ? inch(comboTubLength >= 66 ? 32 : 30) : inch(num(ss.depthIn, 36, 30, 72));
    depth = clamp(depth, inch(30), Math.max(inch(30), perp - 0.9));
    width = clamp(width, inch(30), Math.max(inch(30), len - 0.02));
    bodies.push({
      key: 'shower', wall: showerWall, len, t0: showerT, anchor: showerAnchor, anchorGap: 0,
      a: showerT * len, width, wantWidth: width, depth: depth + 0.03,
      square: false, rank: 0, fixed: false, minWidth: inch(30),
    });
  }

  // A corner tub owns a corner and an alcove tub is captured between walls, so
  // both grow out of their declared corner. Any other tub declared in the
  // last 28 % of its wall is in that corner too — the stall's rule — so a
  // freestanding tub pushed against the end wall keeps its full length as its
  // neighbours grow, instead of being shrunk about a centre that would put
  // half of it inside the wall. Derived from the declared t alone so changing
  // `lengthIn` cannot flip it.
  const tubAnchor: Anchor =
    tubKind === 'corner' || tubKind === 'alcove'
      ? (tubT <= 0.5 ? 'start' : 'end')
      : tubT <= 0.28 ? 'start' : tubT >= 0.72 ? 'end' : 'center';
  // Across-the-room size, per kind, before the wall gap a freestanding tub
  // stands off by. `widthIn` overrides the body only — the gap is the kind's.
  const tubAcrossIn = optNum(ts.widthIn, tubKind === 'freestanding' ? 32 : tubKind === 'clawfoot' ? 31 : tubKind === 'drop-in' ? 42 : tubLengthIn >= 66 ? 32 : 30, 24, 48);
  const tubGap = tubKind === 'freestanding' ? inch(4) : tubKind === 'clawfoot' ? inch(6) : 0;
  if (tubPresent) {
    const len = wallLength(tubWall, w, d);
    const perp = tubWall === 'back' || tubWall === 'front' ? d : w;
    let width: number, depth: number;
    const L = inch(tubLengthIn);
    switch (tubKind) {
      case 'freestanding': case 'clawfoot': width = L; depth = inch(tubAcrossIn) + tubGap; break;
      case 'drop-in': width = L + inch(12); depth = inch(tubAcrossIn); break;
      case 'corner': width = L; depth = L; break;
      default: width = L; depth = inch(tubAcrossIn);
    }
    width = clamp(width, 1.2, Math.max(1.2, len - 0.02));
    depth = clamp(depth, 0.7, Math.max(0.7, perp - 0.8));
    bodies.push({
      key: 'tub', wall: tubWall, len, t0: tubT, anchor: tubAnchor, anchorGap: 0,
      a: tubT * len, width, wantWidth: width, depth,
      square: tubKind === 'corner', rank: 1, fixed: false, minWidth: 1.2,
    });
  }

  const to = (spec.toilet ?? {}) as Partial<BathroomSpec['toilet']>;
  const toiletPresent = to.present === true;
  const toiletStyle = pick<BathroomSpec['toilet']['style']>(to.style, ['two-piece', 'one-piece', 'wall-hung', 'smart'], 'one-piece');
  const toiletT = num(to.t, 0.5, 0, 1);
  const toiletTrimFinish = to.trimFinish == null ? null : pick<FixtureFinish>(to.trimFinish, FINISHES, 'chrome');
  if (toiletPresent) {
    const wall = pick<Wall>(to.wall, WALLS, 'right');
    const len = wallLength(wall, w, d);
    const depth = toiletStyle === 'wall-hung' ? inch(23) : toiletStyle === 'two-piece' ? inch(29) : inch(27);
    bodies.push({
      key: 'toilet', wall, len, t0: toiletT, anchor: 'center', anchorGap: 0,
      a: toiletT * len, width: inch(30), wantWidth: inch(30), depth: depth + 0.1,
      square: false, rank: 3, fixed: false, minWidth: inch(24),
    });
  }

  // doors are fixed obstacles: the slab needs a swing zone
  for (const o of openings) {
    if (o.kind === 'window') continue;
    const dLen = wallLength(o.wall, w, d);
    bodies.push({
      key: 'door', wall: o.wall, len: dLen, t0: o.t, anchor: 'center', anchorGap: 0,
      a: o.x + dLen / 2, width: o.width + 0.1, wantWidth: o.width + 0.1,
      depth: o.kind === 'door' ? Math.min(o.width, 0.75) : 0.3,
      square: false, rank: -1, fixed: true, minWidth: o.width,
    });
  }

  // Two distinct passes, so we can tell "the user made this bigger" apart from
  // "the solver had to shove it": `fitBody` places every fixture from its own
  // anchor with no knowledge of its neighbours, and only then does `resolve`
  // push apart the ones that genuinely overlap.
  for (const b of bodies) fitBody(b);
  const anchored = new Map<Body, { a: number; width: number }>(bodies.map((b) => [b, { a: b.a, width: b.width }]));
  resolve(bodies, w, d);
  const displacementOf = (b: Body) => {
    const before = anchored.get(b);
    if (!before) return 0;
    return Math.abs(b.a - before.a) + Math.abs(b.width - before.width);
  };

  const placed = (b: Body): Placed => ({
    wall: b.wall, len: b.len, a: b.a, t: b.a / b.len, x: b.a - b.len / 2, width: b.width, depth: b.depth,
    rect: rectOnWall(b.wall, w, d, b.a, b.width, b.depth),
    anchor: b.anchor, anchorA: anchorA(b), wantWidth: b.wantWidth,
    displaced: displacementOf(b),
  });

  let vanity: LVanity | null = null;
  let shower: LShower | null = null;
  let tub: LTub | null = null;
  let toilet: LToilet | null = null;

  for (const b of bodies) {
    if (b.key === 'vanity') {
      const p = placed(b);
      const topThickness = inch(optNum(vs.counterThicknessIn, 1.25, 0.5, 4));
      const mirror = pick<BathroomSpec['vanity']['mirror']>(vs.mirror, ['single', 'double', 'full-width', 'medicine-cabinet', 'none'], 'single');
      const topH = inch(optNum(vs.heightIn, vanityStyle === 'pedestal' ? 33 : 34, 28, 40));
      const W = p.width - inch(1.5);
      const topW = vanityStyle === 'pedestal' ? W : W + 2 * inch(0.75);
      const basins = vanityBasins(W, vanitySinks, vanityStyle);
      // These four used to be decided inside Vanity.tsx from the style and the
      // room's design style. They still are — that is what `opt` falls back to
      // — but now the spec can override each one, which is what a contractor
      // setting "vessel basin, wall-mounted tap" expects to see happen.
      const vesselByDefault = vanityStyle === 'console' || (vanityStyle === 'floating' && (style === 'modern' || style === 'contemporary'));
      const wideByDefault = p.width > inch(46) && style !== 'modern';
      const hardwareDefault: VanityHardware = style === 'farmhouse' ? 'mixed'
        : style === 'traditional' || style === 'craftsman' ? 'knobs' : 'pulls';
      // The splash is omitted where the wall is already tiled to the ceiling —
      // that is the rule `Vanity.tsx` has always applied, kept here so the spec
      // can override it in either direction.
      const bodyStyle = vanityStyle === 'floating' || vanityStyle === 'freestanding' || vanityStyle === 'furniture';
      const wallFullyTiled = wallTile === 'full' || (wallTile === 'accent-wall' && (tile.accent?.wall ?? b.wall) === b.wall);
      const splashDefault: VanitySplash = bodyStyle && !wallFullyTiled ? 'standard' : 'none';
      const basinKind = opt<VanityBasin>(vs.basin, BASINS, vesselByDefault ? 'vessel' : 'undermount');
      const mount = opt<VanityFaucet>(vs.faucetMount, FAUCET_MOUNTS, wideByDefault ? 'widespread' : 'deck');
      // A wall tap is set by its SPOUT, which turns down 40 mm below the
      // escutcheon: over a vessel it has to clear the bowl's rim (135 mm) by a
      // hand's width, over a flat deck only the basin's own lip.
      const tapY = mount === 'wall' ? topH + (basinKind === 'vessel' ? VESSEL_H + 0.11 : 0.15) : null;
      // Whichever is higher: the fixed clearance over the top, or clear air
      // above the tap's handles (they stand 55 mm proud of the escutcheon).
      const mirrorBottom = Math.max(topH + MIRROR_CLEAR, tapY === null ? 0 : tapY + 0.10);
      vanity = {
        ...p, style: vanityStyle, sinks: vanitySinks, mirror,
        doorStyle: pick<CabinetDoorStyle>(vs.doorStyle, DOOR_STYLES, 'shaker'),
        topH,
        bodyBottom: (vanityStyle === 'floating' ? inch(8) : 0) + legHeight,
        bodyDepth: p.depth - inch(1.5),
        topThickness,
        topW,
        basins,
        tapY, mirrorBottom,
        mirrorBand: mirrorBandFor(mirror, W, topW, basins, mirrorBottom, h, p.x),
        legStyle: vanityLeg,
        legHeight,
        openShelf: vanityStyle === 'floating' && vs.openShelf === true,
        basin: basinKind,
        faucetMount: mount,
        hardware: opt<VanityHardware>(vs.hardware, HARDWARES, hardwareDefault),
        splash: opt<VanitySplash>(vs.backsplash, SPLASHES, splashDefault),
        drawers: vs.drawers == null ? null : Math.round(num(vs.drawers, 2, 0, 8)),
        doors: vs.doors == null ? null : Math.round(num(vs.doors, 2, 0, 6)),
      };
    } else if (b.key === 'shower') {
      const p = placed(b);
      const leftIsRoomWall = p.a - p.width / 2 < 0.03;
      const rightIsRoomWall = p.len - (p.a + p.width / 2) < 0.03;
      const partition = PT;
      const inner = p.width - (leftIsRoomWall ? 0 : partition) - (rightIsRoomWall ? 0 : partition);
      const innerOffset = ((leftIsRoomWall ? 0 : partition) - (rightIsRoomWall ? 0 : partition)) / 2;
      // STICKY: the door opens away from the corner the stall is anchored into,
      // and the bench takes the other side. Both come from the DECLARED t and
      // the DECLARED width, so a one-notch resize can never swap them (which is
      // what made the whole enclosure appear to flip while dragging a slider).
      const doorSide: Side = showerT <= 0.5 ? 'right' : 'left';
      const niche = !!ss.niche;
      const isGlass = enclosure === 'frameless-glass' || enclosure === 'framed-glass';
      const curbless = !!ss.curbless;
      // What opens, when the spec does not say: a glass stall has always had a
      // hinged door, a curtain has none, a wet room is walk-in, and a combo
      // gets the fixed screen `Shower.tsx` draws for a modern room.
      const doorDefault: ShowerDoor = isGlass ? 'hinged'
        : enclosure === 'open' ? 'walk-in'
          : enclosure === 'tub-shower' ? 'fixed-panel' : 'none';
      shower = {
        ...p, enclosure, niche, bench: !!ss.bench && showerWidthIn >= 42 && enclosure !== 'tub-shower', curbless,
        fixtures: pick<BathroomSpec['shower']['fixtures']>(ss.fixtures, ['single', 'rain', 'rain-plus-handheld', 'body-jets'], 'single'),
        inner, innerOffset, leftIsRoomWall, rightIsRoomWall, partition,
        doorSide,
        hasTub: enclosure === 'tub-shower', tubLength: enclosure === 'tub-shower' ? Math.min(inch(comboTubLength), inner) : 0,
        // A curbless stall's curb is 0 whatever the number says — the two
        // controls contradict each other and the threshold wins.
        curbHeight: curbless ? 0 : inch(optNum(ss.curbHeightIn, 4, 0, 10)),
        // 10 mm is what the enclosure has always been drawn at; a stated
        // thickness is honoured exactly (3/8" reads heavy, 1/4" reads framed).
        glassThickness: ss.glassThicknessIn == null ? 0.010 : inch(num(ss.glassThicknessIn, 0.375, 0.125, 0.625)),
        doorType: opt<ShowerDoor>(ss.doorType, SHOWER_DOORS, doorDefault),
        benchStyle: opt<BenchStyle>(ss.benchStyle, BENCH_STYLES, 'corner'),
        nicheAt: niche ? resolveNiche(ss.nicheAt, inner, innerOffset, p.depth - 0.03, h) : null,
        hardwareFinish: ss.hardwareFinish == null ? null : pick<FixtureFinish>(ss.hardwareFinish, FINISHES, 'chrome'),
      };
    } else if (b.key === 'tub') {
      const p = placed(b);
      const gap = tubKind === 'freestanding' || tubKind === 'clawfoot' ? tubGap : 0;
      // Rim heights the scene has always drawn, kind by kind. A stated rim is
      // honoured, which is the difference between a 22" alcove and the 26" a
      // deep soaker actually stands at.
      const rimDefault = tubKind === 'freestanding' ? 0.58 : tubKind === 'clawfoot' ? 0.68 : tubKind === 'drop-in' ? 0.50 + inch(1.25) : 0.502;
      // A clawfoot IS cast iron and a soaker is acrylic, and the two rims are
      // 40 mm and 30 mm — which is why the default is per KIND, not one word.
      const materialDefault: TubMaterial = tubKind === 'clawfoot' ? 'cast-iron' : 'acrylic';
      const fillerDefault: TubFiller = tubKind === 'freestanding' || tubKind === 'clawfoot' ? 'floor-mount'
        : tubKind === 'alcove' ? 'wall-mount' : 'deck-mount';
      const apronDefault: TubApronKind = tubKind === 'alcove' ? 'integral'
        : tubKind === 'drop-in' ? 'panel' : tubKind === 'corner' ? 'skirted' : 'none';
      tub = {
        ...p, kind: tubKind, length: Math.min(inch(tubLengthIn), tubKind === 'drop-in' ? p.width - inch(12) : p.width),
        gap,
        // STICKY: which corner a corner tub occupies is the declared t, not the
        // fitted centre — otherwise lengthening the tub flipped it end for end.
        corner: tubKind === 'corner' ? (tubT <= 0.5 ? 'left' : 'right') : null,
        across: p.depth - gap,
        rimHeight: ts.heightIn == null ? rimDefault : inch(num(ts.heightIn, 22, 14, 30)),
        apron: opt<TubApronKind>(ts.apron, TUB_APRONS, apronDefault),
        filler: opt<TubFiller>(ts.fillerType, TUB_FILLERS, fillerDefault),
        fillerFinish: ts.fillerFinish == null ? null : pick<FixtureFinish>(ts.fillerFinish, FINISHES, 'chrome'),
        material: opt<TubMaterial>(ts.material, TUB_MATERIALS, materialDefault),
      };
    } else if (b.key === 'toilet') {
      toilet = { ...placed(b), style: toiletStyle, trimFinish: toiletTrimFinish };
    }
  }

  const rects = bodies.filter((b) => b.key !== 'door').map((b) => rectOnWall(b.wall, w, d, b.a, b.width, b.depth));
  const doorRects = bodies.filter((b) => b.key === 'door').map((b) => rectOnWall(b.wall, w, d, b.a, b.width, b.depth));
  const partial = { w, d, h, widthFt, depthFt, ceilingFt, style, layout, wallTile, tile, openings, vanity, shower, tub, toilet, lighting, rects };
  const decor = solveDecor(spec.decor, partial, doorRects);
  const accessories = placeAccessories(spec.accessories, w, d, h, openings);
  // Accessories keep clear of the shelves and art at hand height, the same
  // way they keep clear of the fixtures — a towel bar under a picture is a
  // render tell. The fittings the SPEC placed are obstacles too, so the
  // auto-placed filler bar never lands on top of the one the photo showed.
  const specHung: WallPiece[] = accessories.map((a) => ({
    wall: a.wall, len: a.len, a: a.a, t: a.t, x: a.x, width: a.width,
    anchorA: a.a, wantWidth: a.width, displaced: a.displaced,
    band: { x0: a.x - a.width / 2, x1: a.x + a.width / 2, y0: a.y - 0.22, y1: a.y + 0.22 },
    rect: rectOnWall(a.wall, w, d, a.a, a.width, 0.12),
  }));
  const free = WALLS.flatMap((wall) => freeSegments(wall, w, d, rects, openings, [...decor.shelves, ...decor.art, ...specHung]));

  return { ...partial, accessories, free, decor };
}

// ---------------------------------------------------------------------------
// Décor — shelves, plants, art, rug, window treatments
// ---------------------------------------------------------------------------
/**
 * The décor follows the fixtures, never the other way round: a shelf, a
 * picture or a plant reads the finished fixture placement as an obstacle and
 * finds its own clear spot, so editing a shelf can never nudge the vanity.
 * Each piece's anchor is still its DECLARED position — the same contract the
 * fixtures honour — and `displaced` says how far the room's contents pushed it.
 *
 * Nothing is dropped. A shelf that has no clear span is narrowed; one that
 * cannot even be narrowed is drawn where the photo said it was and reported
 * in `warnings`, because a missing shelf is a worse lie than a tight one.
 */
type DecorInputs = Pick<BathLayout, 'w' | 'd' | 'h' | 'openings' | 'vanity' | 'shower' | 'tub' | 'toilet' | 'rects' | 'wallTile' | 'tile'>;

/** Clearance held between a hung piece and anything else on the wall. */
const D_CL = 0.05;
/** Nothing hangs closer than this to a wall end. */
const D_EDGE = 0.06;
/** How far off a wall a fixture can stand and still be in the way of the deepest shelf (16" + clearance). */
const DECOR_REACH = 0.45;
/**
 * How high a fixture reaches up the wall behind it — the band nothing may be
 * hung through. A shelf OVER the toilet is right; a shelf THROUGH its tank is
 * not. Exported so the checks read the real numbers instead of copies.
 */
export const DECOR_CLEAR = { tub: 0.75, vanity: 0.15, toilet: 0.95, toiletWallHung: 1.15 } as const;

interface WallBlock { a0: number; a1: number; y0: number; y1: number }

/** Distance from a point to a rect's edge (0 inside). */
export function distToRect(px: number, pz: number, r: Rect): number {
  const dx = Math.max(r.minX - px, 0, px - r.maxX);
  const dz = Math.max(r.minZ - pz, 0, pz - r.maxZ);
  return Math.hypot(dx, dz);
}

function rectsOverlap(a: Rect, b: Rect, tol = 0.004): boolean {
  const { ox, oz } = overlapOf(a, b);
  return ox > tol && oz > tol;
}

/**
 * Basin centres, vanity-local x — the same sectioning `Vanity.tsx#planFronts`
 * uses, so a counter plant can be kept out of the bowls.
 */
/**
 * A niche resolved into the stall's own frame.
 *
 * `null` reproduces the one the scene has always cut: 360 × 600 on the back
 * face, sill at 1.05 m, one shelf, pushed a quarter of the way off centre in a
 * wide stall so it does not land behind the shower head. A stated niche is
 * clamped to fit the face it is cut into rather than being drawn through it.
 */
function resolveNiche(raw: unknown, inner: number, innerOffset: number, stallDepth: number, h: number): LNiche {
  const D = 0.095;
  if (!raw || typeof raw !== 'object') {
    return { face: 'back', x: inner >= 0.9 ? innerOffset - inner * 0.24 : innerOffset, bottom: 1.05, width: 0.36, height: 0.60, depth: D, shelves: 1 };
  }
  const n = raw as Partial<NonNullable<BathroomSpec['shower']['nicheAt']>>;
  const face = pick<'back' | 'left' | 'right'>(n.face, ['back', 'left', 'right'], 'back');
  // the back face is as wide as the stall is clear; a side face is as deep as it
  const faceLen = face === 'back' ? inner : stallDepth;
  const width = clamp(inch(num(n.widthIn, 24, 4, 60)), 0.15, Math.max(0.15, faceLen - 0.14));
  const centre = clamp(inch(num(n.centerIn, 48, 12, 84)), 0.4, Math.max(0.4, h - 0.35));
  const height = clamp(inch(num(n.heightIn, 14, 4, 60)), 0.15, Math.max(0.15, 2 * Math.min(centre - 0.15, h - 0.15 - centre)));
  const t = num(n.t, 0.5, 0, 1);
  const along = clamp(t * faceLen, width / 2 + 0.06, Math.max(width / 2 + 0.06, faceLen - width / 2 - 0.06));
  return {
    face,
    // back: wall-local centred x. side: distance from the stall opening's back wall.
    x: face === 'back' ? innerOffset + along - faceLen / 2 : along,
    bottom: centre - height / 2,
    width, height, depth: D,
    shelves: Math.round(num(n.shelves, 1, 0, 4)),
  };
}

export function vanityBasins(W: number, sinks: 1 | 2, style: BathroomSpec['vanity']['style']): number[] {
  const hasBody = style === 'floating' || style === 'freestanding' || style === 'furniture';
  if (!hasBody) return sinks === 2 ? [-W * 0.25, W * 0.25] : [0];
  if (W < 0.7) return [0];
  if (sinks === 2) { const a = W * 0.36, b = W * 0.28; return [-(a + b) / 2, (a + b) / 2]; }
  if (W >= 1.0) return [0];
  return [-W * 0.2];
}

/** The mirror(s) `Vanity.tsx` will draw, widened by the sconces beside them and the bar above. */
function mirrorBandFor(mirror: BathroomSpec['vanity']['mirror'], W: number, topW: number, basins: number[], bottom: number, h: number, vx: number): WallBand | null {
  if (mirror === 'none') return null;
  const maxH = Math.max(0.4, h - 0.2 - bottom);
  const ms: Array<{ x: number; w: number; h: number }> = [];
  switch (mirror) {
    case 'double': {
      const mw = Math.max(0.4, Math.min(0.75, W * 0.36 - 0.04));
      if (basins.length >= 2) basins.slice(0, 2).forEach((x) => ms.push({ x, w: mw, h: Math.min(0.9, maxH) }));
      else for (const sx of [-1, 1]) ms.push({ x: sx * W * 0.25, w: Math.max(0.35, W * 0.4), h: Math.min(0.9, maxH) });
      break;
    }
    case 'full-width': ms.push({ x: 0, w: topW, h: Math.min(0.95, maxH) }); break;
    case 'medicine-cabinet': ms.push({ x: basins.length === 1 ? basins[0] : 0, w: Math.min(0.6, W), h: Math.min(0.76, maxH) }); break;
    default: ms.push({ x: basins.length === 1 ? basins[0] : 0, w: Math.min(W >= 0.8 ? 0.9 : W, W), h: Math.min(W >= 0.8 ? 0.9 : 0.75, maxH) });
  }
  // sconces flank the glass by 120 mm plus their shade; the bar sits 105 mm above it
  const x0 = Math.min(...ms.map((m) => m.x - m.w / 2)) - 0.30;
  const x1 = Math.max(...ms.map((m) => m.x + m.w / 2)) + 0.30;
  const top = bottom + Math.max(...ms.map((m) => m.h)) + 0.25;
  return { x0: vx + x0, x1: vx + x1, y0: bottom - 0.03, y1: Math.min(h, top) };
}

/** Everything already on `wall` that a hung piece must not cross, in wall-local `a` (0..len) × height. */
function wallBlocks(P: DecorInputs, wall: Wall): WallBlock[] {
  const { w, d, h } = P;
  const len = wallLength(wall, w, d);
  const out: WallBlock[] = [];
  for (const o of P.openings) {
    if (o.wall !== wall) continue;
    const c = o.x + len / 2;
    // casing + a stool on a window; the full slab height on a door
    out.push({ a0: c - o.width / 2 - 0.10, a1: c + o.width / 2 + 0.10, y0: o.kind === 'window' ? o.sill - 0.10 : 0, y1: o.sill + o.height + 0.15 });
  }
  // A fixture blocks the wall it stands against AND any wall it stands near
  // enough for a shelf to reach — a corner shower's side is tile to the
  // ceiling too, and a stall the solver left a hand's width off the wall is
  // still in the way of a 10" board.
  const span = (r: Rect) => {
    const p = projectRectOnWall(wall, w, d, r);
    return p.perp < DECOR_REACH ? { a0: p.x0 + len / 2 - 0.02, a1: p.x1 + len / 2 + 0.02 } : null;
  };
  if (P.shower) { const s = span(P.shower.rect); if (s) out.push({ ...s, y0: 0, y1: h }); }
  if (P.tub) { const s = span(P.tub.rect); if (s) out.push({ ...s, y0: 0, y1: P.tub.kind === 'alcove' ? alcoveSurroundHeight(h) : DECOR_CLEAR.tub }); }
  if (P.vanity) {
    const v = P.vanity;
    const s = span(v.rect);
    if (s) out.push({ ...s, y0: 0, y1: v.topH + DECOR_CLEAR.vanity });
    if (v.mirrorBand && v.wall === wall) out.push({ a0: v.mirrorBand.x0 + len / 2, a1: v.mirrorBand.x1 + len / 2, y0: v.mirrorBand.y0, y1: v.mirrorBand.y1 });
  }
  if (P.toilet) { const s = span(P.toilet.rect); if (s) out.push({ ...s, y0: 0, y1: P.toilet.style === 'wall-hung' ? DECOR_CLEAR.toiletWallHung : DECOR_CLEAR.toilet }); }
  return out;
}

/**
 * Place a piece of width `want` about its declared centre `a0` on a wall,
 * within the height band [y0, y1]:
 *   1. it stays exactly where it was declared if that spot is clear;
 *   2. otherwise it slides along the wall to the NEAREST span that takes it;
 *   3. otherwise it narrows into the nearest span that takes at least half of
 *      it, or failing that the widest span (never below `minW`) — nearest
 *      first, because a shelf drawn at the far end of the wall from where the
 *      photo shows it is the wrong shelf, however wide;
 *   4. otherwise `null` — the caller draws it as declared and warns.
 */
function fitOnWall(a0: number, want: number, minW: number, y0: number, y1: number, blocks: WallBlock[], len: number): { a: number; width: number; displaced: number } | null {
  const busy: Array<[number, number]> = blocks
    .filter((b) => b.y0 < y1 + D_CL && b.y1 > y0 - D_CL)
    .map((b) => [b.a0 - D_CL, b.a1 + D_CL]);
  const spans = subtractIntervals(D_EDGE, len - D_EDGE, busy);
  const width = Math.min(want, Math.max(0.05, len - 2 * D_EDGE));
  if (spans.some(([s0, s1]) => a0 - width / 2 >= s0 - 1e-9 && a0 + width / 2 <= s1 + 1e-9)) return { a: a0, width, displaced: 0 };
  let best: { a: number; dist: number } | null = null;
  for (const [s0, s1] of spans) {
    if (s1 - s0 < width) continue;
    const a = clamp(a0, s0 + width / 2, s1 - width / 2);
    const dist = Math.abs(a - a0);
    if (!best || dist < best.dist - 1e-9) best = { a, dist };
  }
  if (best) return { a: best.a, width, displaced: best.dist };
  const distTo = ([s0, s1]: [number, number]) => Math.max(0, s0 - a0, a0 - s1);
  const roomy = spans.filter(([s0, s1]) => s1 - s0 >= Math.max(minW, width / 2));
  const pool = roomy.length ? roomy : spans.filter(([s0, s1]) => s1 - s0 >= minW);
  const pickSpan = pool.reduce<[number, number] | null>((m, s) => {
    if (!m) return s;
    const ds = distTo(s), dm = distTo(m);
    if (roomy.length) return ds < dm - 1e-9 ? s : m;
    return s[1] - s[0] > m[1] - m[0] + 1e-9 ? s : m;
  }, null);
  if (!pickSpan) return null;
  const shrunk = pickSpan[1] - pickSpan[0] - 0.02;
  const a = clamp(a0, pickSpan[0] + shrunk / 2, pickSpan[1] - shrunk / 2);
  return { a, width: shrunk, displaced: Math.abs(a - a0) + (width - shrunk) };
}

/**
 * Nearest floor spot to `ideal` where a circle of radius `r` stands clear of
 * every obstacle and inside the room. The search is a fixed grid walked in a
 * fixed order, so equal candidates always resolve the same way and a plant
 * cannot hop between two corners as a slider moves.
 */
function clearFloorSpot(ideal: [number, number], r: number, obstacles: Rect[], w: number, d: number): { x: number; z: number; displaced: number } | null {
  const hx = w / 2 - r - 0.02, hz = d / 2 - r - 0.02;
  if (hx <= 0 || hz <= 0) return null;
  const clear = (x: number, z: number) => obstacles.every((o) => distToRect(x, z, o) >= r);
  const ix = clamp(ideal[0], -hx, hx), iz = clamp(ideal[1], -hz, hz);
  if (clear(ix, iz)) return { x: ix, z: iz, displaced: Math.hypot(ix - ideal[0], iz - ideal[1]) };
  const step = 0.05;
  let best: { x: number; z: number; dist: number } | null = null;
  for (let x = -hx; x <= hx + 1e-9; x += step) {
    for (let z = -hz; z <= hz + 1e-9; z += step) {
      if (!clear(x, z)) continue;
      const dist = Math.hypot(x - ix, z - iz);
      if (!best || dist < best.dist - 1e-9) best = { x, z, dist };
    }
  }
  return best ? { x: best.x, z: best.z, displaced: best.dist } : null;
}

function rugRectAt(x: number, z: number, length: number, width: number, yaw: number): Rect {
  const ex = (yaw === 0 ? length : width) / 2, ez = (yaw === 0 ? width : length) / 2;
  return { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez };
}

function solveDecor(raw: DecorSpec | undefined, P: DecorInputs, doorRects: Rect[]): LDecor {
  const { w, d, h } = P;
  const spec = (raw && typeof raw === 'object' ? raw : {}) as Partial<DecorSpec>;
  const warnings: DecorWarning[] = [];
  const floorObstacles = [...P.rects, ...doorRects];

  // --- shelves: slide to the nearest clear span, narrow last, never drop
  const shelves: LShelf[] = [];
  const rawShelves = Array.isArray(spec.shelves) ? spec.shelves.slice(0, 6) : [];
  rawShelves.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const wall = pick<Wall>(s.wall, WALLS, 'right');
    const len = wallLength(wall, w, d);
    const caseSpec = s.enclosure && typeof s.enclosure === 'object' ? s.enclosure : null;
    const rotationDeg = shelfRotation(caseSpec?.rotationDeg), quarter = Math.abs(rotationDeg) === 90;
    const normalRoomSize = wall === 'back' || wall === 'front' ? d : w;
    const requestedWidth = inch(num(s.widthIn, 24, 8, 96));
    const caseWidth = Math.min(requestedWidth, Math.max(0.2, (quarter ? normalRoomSize : len) - 2 * D_EDGE));
    let depth = Math.min(inch(num(s.depthIn, 8, 4, 16)), len - 2 * D_EDGE);
    const want = quarter ? depth : caseWidth;
    const spacing = inch(num(s.spacingIn, 12, 8, 24));
    const bottom = clamp(ft(num(s.bottomFt, 4.5, 2.5, 10)), 0.75, Math.max(0.75, h - 0.3));
    const thickness = caseSpec ? inch(num(caseSpec.panelThicknessIn, 0.75, 0.25, 2)) : 0.032;
    const wantCount = Math.round(num(s.count, 1, 1, 5));
    const wantedCaseHeight = caseSpec ? inch(num(caseSpec.heightIn, (wantCount * spacing + thickness) / inch(1), 12, 120)) : 0;
    const caseHeight = caseSpec ? Math.max(thickness * 2 + inch(0.25), Math.min(wantedCaseHeight, h - 0.06 - bottom)) : 0;
    // never a board within 250 mm of the ceiling — drop boards before dropping the shelf
    const count = caseSpec ? Math.max(1, Math.min(wantCount, Math.floor((caseHeight - thickness * 2 - inch(0.25)) / spacing) + 1)) : Math.max(1, Math.min(wantCount, Math.floor((h - 0.25 - bottom) / spacing) + 1));
    const top = bottom + (count - 1) * spacing;
    const y0 = bottom - 0.04, y1 = caseSpec ? bottom + caseHeight : Math.min(h, top + 0.35);
    const t = num(s.t, 0.5, 0, 1);
    const a0 = t * len;
    const fit = fitOnWall(a0, want, quarter ? inch(4) : 0.2, y0, y1, wallBlocks(P, wall), len);
    let a: number, width: number, displaced: number;
    if (fit) ({ a, width, displaced } = fit);
    else {
      width = want; a = clamp(a0, width / 2 + D_EDGE, len - width / 2 - D_EDGE); displaced = Math.abs(a - a0);
      warnings.push({ piece: 'shelf', index: i, message: `No clear stretch of the ${wall} wall for a ${Math.round(want * 39.37)}" shelf — drawn where the photo shows it.` });
    }
    const wallSpan = width;
    if (quarter) { depth = width; width = caseWidth; }
    const standoff = tileOffsetAt(P, wall, bottom);
    shelves.push({
      wall, len, a, t: a / len, x: a - len / 2, width, anchorA: a0, wantWidth: caseWidth, displaced,
      band: { x0: a - wallSpan / 2 - len / 2, x1: a + wallSpan / 2 - len / 2, y0, y1 },
      rect: rectOnWall(wall, w, d, a, wallSpan, (quarter ? width : depth) + standoff),
      depth, count, bottom, spacing,
      material: pick<OpenShelf['material']>(s.material, ['match-cabinets', 'wood', 'white', 'black', 'match-countertop'], 'wood'),
      styled: pick<OpenShelf['styled']>(s.styled, ['empty', 'dishes', 'books', 'plants', 'mixed'], 'mixed'),
      thickness, standoff,
      enclosure: caseSpec ? { bottom, top: bottom + caseHeight, panelThickness: thickness, backPanel: caseSpec.backPanel === true, rotationDeg } : null,
      finishColorHex: typeof s.finishColorHex === 'string' && /^#[0-9a-f]{6}$/i.test(s.finishColorHex) ? s.finishColorHex.toLowerCase() : null,
    });
    if (quarter && width < requestedWidth - 0.001) warnings.push({ piece: 'shelf', index: i, message: `Case width reduced to ${Math.round(width / inch(1))}″ so its rotated footprint stays inside the room.` });
    if (caseSpec && caseHeight < wantedCaseHeight - 0.001) warnings.push({ piece: 'shelf', index: i, message: `Enclosure height reduced to ${Math.round(caseHeight / inch(1))}″ below the ceiling.` });
    if (caseSpec && count < wantCount) warnings.push({ piece: 'shelf', index: i, message: `${count} of ${wantCount} boards fit inside the enclosure.` });
  });

  // --- art: same rule, and it also keeps off the shelves that are already up
  const art: LArt[] = [];
  const rawArt = Array.isArray(spec.art) ? spec.art.slice(0, 6) : [];
  rawArt.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const wall = pick<Wall>(p.wall, WALLS, 'right');
    const len = wallLength(wall, w, d);
    const want = Math.min(inch(num(p.widthIn, 20, 6, 72)), Math.max(0.15, len - 2 * D_EDGE));
    const height = Math.min(inch(num(p.heightIn, 24, 6, 72)), Math.max(0.15, h - 1.0));
    const centerY = clamp(ft(num(p.centerFt, 5.2, 2, 12)), height / 2 + 0.9, Math.max(height / 2 + 0.9, h - height / 2 - 0.08));
    const y0 = centerY - height / 2 - 0.03, y1 = centerY + height / 2 + 0.03;
    const t = num(p.t, 0.5, 0, 1);
    const a0 = t * len;
    const blocks = [
      ...wallBlocks(P, wall),
      ...shelves.filter((s) => s.wall === wall).map((s) => ({ a0: s.a - shelfFootprint(s).span / 2, a1: s.a + shelfFootprint(s).span / 2, y0: s.band.y0, y1: s.band.y1 })),
    ];
    const fit = fitOnWall(a0, want, 0.15, y0, y1, blocks, len);
    let a: number, width: number, displaced: number;
    if (fit) ({ a, width, displaced } = fit);
    else {
      width = want; a = clamp(a0, width / 2 + D_EDGE, len - width / 2 - D_EDGE); displaced = Math.abs(a - a0);
      warnings.push({ piece: 'art', index: i, message: `No clear wall for the ${Math.round(want * 39.37)}" picture on the ${wall} wall — drawn where the photo shows it.` });
    }
    art.push({
      wall, len, a, t: a / len, x: a - len / 2, width, anchorA: a0, wantWidth: want, displaced,
      band: { x0: a - width / 2 - len / 2, x1: a + width / 2 - len / 2, y0, y1 },
      rect: rectOnWall(wall, w, d, a, width, 0.05),
      height, centerY, frame: pick<WallArt['frame']>(p.frame, ['black', 'wood', 'white', 'none'], 'black'),
    });
  });

  // --- plants
  const plants: LPlant[] = [];
  const rawPlants = Array.isArray(spec.plants) ? spec.plants.slice(0, 8) : [];
  const v = P.vanity;
  const corners: Array<[number, number]> = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  rawPlants.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const form = pick<Plant['form']>(p.form, ['leafy', 'tree', 'trailing', 'herb', 'succulent'], 'leafy');
    let kind = pick<Plant['kind']>(p.kind, ['floor', 'counter', 'shelf', 'hanging'], 'floor');
    const where = pick<Plant['wall'] | 'island'>(p.wall, [...WALLS, 'island', 'corner'], 'corner');
    const t = num(p.t, 0.5, 0, 1);
    const wantSize = ft(num(p.sizeFt, 2, 0.5, 9));
    let shelfIndex: number | null = null;
    // a shelf plant needs a shelf and a counter plant needs a counter; the
    // photo's plant still gets drawn, just on the next surface down
    if (kind === 'shelf') {
      const onWallShelves = shelves.map((s, idx) => ({ s, idx })).filter(({ s }) => s.wall === where);
      const pool = onWallShelves.length ? onWallShelves : shelves.map((s, idx) => ({ s, idx }));
      if (pool.length) shelfIndex = pool.reduce((m, c) => (Math.abs(c.s.t - t) < Math.abs(m.s.t - t) - 1e-9 ? c : m)).idx;
      else kind = v ? 'counter' : 'floor';
    }
    if (kind === 'counter' && !v) kind = 'floor';

    if (kind === 'shelf' && shelfIndex !== null) {
      const s = shelves[shelfIndex];
      let board = s.count - 1;
      const headAt = (k: number) => k + 1 < s.count ? s.bottom + (k + 1) * s.spacing : s.enclosure ? s.enclosure.top - s.enclosure.panelThickness : h;
      while (s.enclosure && board > 0 && headAt(board) - (s.bottom + board * s.spacing + s.thickness) < 0.16) board--;
      const boardTop = s.bottom + board * s.spacing + s.thickness;
      const head = headAt(board);
      if (s.enclosure && head - boardTop < 0.16) { warnings.push({ piece: 'plant', index: i, message: 'No case tier has sufficient headroom for a plant — omitted.' }); return; }
      if (board < s.count - 1) warnings.push({ piece: 'plant', index: i, message: 'Plant moved to a lower case tier to clear the cap.' });
      const minimumSize = s.enclosure ? 0.05 : 0.1;
      const size = clamp(wantSize, minimumSize, Math.max(minimumSize, Math.min(0.45, head - boardTop - (s.enclosure ? 0.02 : 0.1))));
      const side = s.enclosure?.panelThickness ?? 0, rear = s.enclosure?.backPanel ? side : 0;
      const minimumPot = s.enclosure ? 0.04 : 0.06;
      const potD = clamp(size * 0.3, minimumPot, Math.max(minimumPot, Math.min(0.14, s.depth - rear - 0.03)));
      const xl = clamp(t * s.len - s.a, -s.width / 2 + side + potD / 2 + 0.03, s.width / 2 - side - potD / 2 - 0.03);
      const [localX, localZ] = shelfPoint(s, s.x + xl, s.standoff + rear + (s.depth - rear) / 2);
      const [x, y, z] = onWall(s.wall, w, d, (localX + s.len / 2) / s.len, boardTop, localZ);
      plants.push({ kind, form, size, potD, x, y, z, yaw: wallFrame(s.wall, w, d).yaw + shelfFootprint(s).yaw, radius: potD / 2, wall: s.wall, shelfIndex, drop: 0, displaced: 0 });
      return;
    }
    if (kind === 'counter' && v) {
      const size = clamp(wantSize, 0.12, Math.max(0.12, Math.min(0.9, h - v.topH - 0.3)));
      const potD = clamp(size * 0.24, 0.07, 0.18);
      const lim = v.topW / 2 - potD / 2 - 0.03;
      const xWant = clamp(where === v.wall ? t * v.len - v.a : (t - 0.5) * v.topW, -lim, lim);
      // out of the bowls: 460 mm basins, the plant steps to the nearer side
      let xl = xWant;
      for (const bx of v.basins) {
        const need = 0.23 + potD / 2 + 0.02;
        if (Math.abs(xl - bx) < need) xl = xl >= bx ? bx + need : bx - need;
      }
      xl = clamp(xl, -lim, lim);
      const crowded = v.basins.some((bx) => Math.abs(xl - bx) < 0.23 + potD / 2);
      if (crowded) warnings.push({ piece: 'plant', index: i, message: 'The vanity top has no room beside the basins for a plant — drawn anyway.' });
      const [x, y, z] = onWall(v.wall, w, d, (v.a + xl) / v.len, v.topH, v.depth * 0.5);
      plants.push({ kind, form, size, potD, x, y, z, yaw: wallFrame(v.wall, w, d).yaw, radius: potD / 2, wall: v.wall, shelfIndex: null, drop: 0, displaced: Math.abs(xl - xWant) });
      return;
    }
    if (kind === 'hanging') {
      const wall: Wall = where === 'island' || where === 'corner' ? 'back' : where;
      const len = wallLength(wall, w, d);
      const size = clamp(wantSize, 0.3, 1.5);
      const potD = clamp(size * 0.2, 0.14, 0.26);
      let a0 = clamp(t * len, 0.3, Math.max(0.3, len - 0.3));
      // beside the window, not in front of the glass
      for (const o of P.openings) {
        if (o.wall !== wall || o.kind !== 'window') continue;
        const c = o.x + len / 2, half = o.width / 2 + potD / 2 + 0.05;
        if (Math.abs(a0 - c) < half) a0 = clamp(a0 >= c ? c + half : c - half, 0.3, Math.max(0.3, len - 0.3));
      }
      const potY = Math.max(1.6, h - 0.32 - potD * 0.6);
      const drop = Math.min(size, Math.max(0.2, potY - 1.15));
      const [ix, , iz] = onWall(wall, w, d, a0 / len, potY, 0.32);
      // may hang over a vanity or a toilet, never inside a stall or an alcove
      const tall = [P.shower?.rect ?? null, P.tub && P.tub.kind === 'alcove' ? P.tub.rect : null].filter((r): r is Rect => !!r);
      const spot = clearFloorSpot([ix, iz], potD / 2 + 0.05, tall, w, d);
      if (!spot) warnings.push({ piece: 'plant', index: i, message: `Nowhere to hang a plant by the ${wall} wall — drawn anyway.` });
      plants.push({ kind, form, size, potD, x: spot?.x ?? ix, y: potY, z: spot?.z ?? iz, yaw: wallFrame(wall, w, d).yaw, radius: potD / 2, wall, shelfIndex: null, drop, displaced: spot?.displaced ?? 0 });
      return;
    }
    // floor: a clear corner, or against the wall it was seen on
    const size = clamp(wantSize, 0.3, Math.max(0.3, h - 0.15));
    const potD = clamp(size * 0.16, 0.16, 0.45);
    const r = potD / 2 + 0.04;
    let ideal: [number, number];
    let wall: Wall | null = null;
    if (where === 'island' || where === 'corner') {
      const [cx, cz] = corners[Math.min(3, Math.floor(t * 4))];
      ideal = [cx - Math.sign(cx) * (r + 0.06), cz - Math.sign(cz) * (r + 0.06)];
    } else {
      wall = where;
      const [x, , z] = onWall(wall, w, d, t, 0, r + 0.05);
      ideal = [x, z];
    }
    // earlier plants are obstacles for later ones (spec order = importance)
    const taken = plants.filter((q) => q.kind === 'floor').map((q) => ({ minX: q.x - q.radius, maxX: q.x + q.radius, minZ: q.z - q.radius, maxZ: q.z + q.radius }));
    const blockers = [...floorObstacles, ...taken];
    const spot = clearFloorSpot(ideal, r, blockers, w, d);
    if (!spot) warnings.push({ piece: 'plant', index: i, message: 'No clear floor for a plant — drawn where the photo shows it.' });
    const x = spot?.x ?? clamp(ideal[0], -w / 2 + r, w / 2 - r), z = spot?.z ?? clamp(ideal[1], -d / 2 + r, d / 2 - r);
    /*
     * The search above only ever clears the POT — the canopy reaches several
     * times further, so a plant parked in the corner beside a freestanding tub
     * hung its leaves over the rim. Widening the search radius to the canopy
     * would make every plant's POSITION a function of every fixture rect and
     * the placement sweeps would never settle, so the spot stays exactly where
     * it landed and the plant shrinks instead — only when it has to, and never
     * below 65% of the height the photo asked for.
     */
    const free = blockers.reduce((m, o) => Math.min(m, distToRect(x, z, o)), Math.max(w, d));
    const wantFoliage = Math.max(0.08, size - potD);
    const reach = Math.max(0.05, plantCanopyRadius(form, 1));
    // 40 mm of grace: leaves that just kiss a fixture read as a plant beside it
    const foliage = clamp((free + 0.04) / reach, wantFoliage * 0.65, wantFoliage);
    plants.push({ kind: 'floor', form, size: foliage + potD, potD, x, y: 0, z, yaw: wall ? wallFrame(wall, w, d).yaw : 0, radius: r, wall, shelfIndex: null, drop: 0, displaced: spot?.displaced ?? 0 });
  });

  // --- rug: a runner in front of the vanity, an area / round rug on the free floor
  let rug: LRug | null = null;
  const rr = spec.rug && typeof spec.rug === 'object' ? spec.rug : null;
  if (rr && rr.present === true) {
    const style = pick<LRug['style']>(rr.style, ['runner', 'area', 'round'], 'area');
    let length = ft(num(rr.lengthFt, 3, 1.5, 12));
    let width = style === 'round' ? length : ft(num(rr.widthFt, 2, 1, 10));
    if (style === 'round') length = width;
    let yaw = w >= d ? 0 : Math.PI / 2;
    let ideal: [number, number] = [0, 0];
    if (style === 'runner' && v) {
      // the long side runs along the vanity, a hand's width off the toe-kick
      yaw = v.wall === 'back' || v.wall === 'front' ? 0 : Math.PI / 2;
      length = Math.min(length, Math.max(1, v.len - 0.2));
      const [x, , z] = onWall(v.wall, w, d, v.t, 0, v.depth + 0.06 + width / 2);
      ideal = [x, z];
    }
    const ex = yaw === 0 ? length : width, ez = yaw === 0 ? width : length;
    let placed: { x: number; z: number; displaced: number } | null = null;
    let scale = 1;
    // shrink is the last resort: nine steps of 10 % before giving up
    for (let k = 0; k < 9 && !placed; k++) {
      scale = Math.pow(0.9, k);
      const hx = w / 2 - (ex * scale) / 2 - 0.03, hz = d / 2 - (ez * scale) / 2 - 0.03;
      if (hx < 0 || hz < 0 || length * scale < 0.5) break;
      const ok = (x: number, z: number) => !P.rects.some((o) => rectsOverlap(rugRectAt(x, z, length * scale, width * scale, yaw), o));
      const ix = clamp(ideal[0], -hx, hx), iz = clamp(ideal[1], -hz, hz);
      if (ok(ix, iz)) { placed = { x: ix, z: iz, displaced: Math.hypot(ix - ideal[0], iz - ideal[1]) }; break; }
      let best: { x: number; z: number; dist: number } | null = null;
      for (let x = -hx; x <= hx + 1e-9; x += 0.05) {
        for (let z = -hz; z <= hz + 1e-9; z += 0.05) {
          if (!ok(x, z)) continue;
          const dist = Math.hypot(x - ix, z - iz);
          if (!best || dist < best.dist - 1e-9) best = { x, z, dist };
        }
      }
      if (best) placed = { x: best.x, z: best.z, displaced: best.dist };
    }
    if (!placed) {
      scale = Math.min(1, Math.max(0.2, Math.min((w - 0.1) / ex, (d - 0.1) / ez)));
      placed = { x: clamp(ideal[0], -(w / 2 - (ex * scale) / 2), w / 2 - (ex * scale) / 2), z: clamp(ideal[1], -(d / 2 - (ez * scale) / 2), d / 2 - (ez * scale) / 2), displaced: 0 };
      warnings.push({ piece: 'rug', index: 0, message: 'No clear floor for the rug — drawn where it fits best.' });
    } else if (scale < 0.999) {
      warnings.push({ piece: 'rug', index: 0, message: `Rug shrunk to ${Math.round(scale * 100)} % to fit the free floor.` });
    }
    length *= scale; width *= scale;
    rug = { style, length, width, x: placed.x, z: placed.z, yaw, rect: rugRectAt(placed.x, placed.z, length, width, yaw), displaced: placed.displaced + (1 - scale) };
  }

  // --- window treatments, one per window
  const windowTreatment = pick<DecorSpec['windowTreatment']>(spec.windowTreatment, ['none', 'roman-shade', 'roller', 'curtains', 'blinds', 'cafe-curtain'], 'none');
  const treatments: LTreatment[] = windowTreatment === 'none' ? [] : P.openings
    .filter((o) => o.kind === 'window')
    .map((o) => ({ kind: windowTreatment, openingId: o.id, wall: o.wall, t: o.t, x: o.x, width: o.width, height: o.height, sill: o.sill }));

  return {
    shelves, plants, art, rug, windowTreatment, treatments,
    counterStyling: pick<DecorSpec['counterStyling']>(spec.counterStyling, ['none', 'minimal', 'lived-in'], 'minimal'),
    warnings,
  };
}
