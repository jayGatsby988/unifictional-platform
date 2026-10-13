/**
 * Kitchen layout solver — turns an (AI-produced, frequently inconsistent)
 * KitchenSpec into a fully clamped, collision-resolved placement in METERS
 * that the scene components render without any further validation.
 *
 * The hard parts this file owns:
 *  - cabinet runs are snapped to their wall, corner-joined (one run owns the
 *    corner, the other is pulled back by the owner's counter depth) and their
 *    cabinet widths are fitted to the run length (appliance gaps keep their
 *    real width, everything else scales);
 *  - tall units (pantry / oven tower / fridge surround) carve the base and
 *    upper rows, leaving fillers where a cabinet is reduced to a sliver;
 *  - appliances snap into the `appliance-gap` voids nearest to their declared
 *    position, and hoods follow whatever range/cooktop they belong to;
 *  - countertops are emitted as segments (broken by ranges and tall units) so
 *    an L/U corner joins with a single clean seam;
 *  - the island is clamped inside the room with a real walkway clearance and
 *    shrunk (or dropped) when it cannot fit;
 *  - décor (open shelves, plants, art, the rug, window treatments) is fitted
 *    around the cabinetry and the openings — slid along its wall to the nearest
 *    clear span, shrunk as a last resort, never dropped silently (see
 *    `buildDecor` and the `warnings` list it fills).
 *
 * Every number is guarded: NaN / missing / absurd values fall back to sane
 * defaults and nothing here throws.
 */
import type {
  Appliance, ApplianceKind, BaseCabinetType, Burner, CabinetContents, CabinetDoorStyle, DecorItem,
  DecorItemKind, DecorItemMaterial, DecorItemOn, DecorSpec, DesignStyle, KitchenLayout, KitchenSpec,
  Opening, OpenShelf, Plant, UpperCabinet, UpperCabinetType, Wall, WallArt,
} from '@/lib/spec/types';
import {
  DEFAULT_COLOR, DEFAULT_MATERIAL, DEFAULT_SIZE_IN, ITEM_PROPORTIONS, SIZE_RANGE_IN, STACKABLE,
} from './items';
import {
  CABINET_ABOVE, HOOD_SHAPE_DEFAULT, HOOD_SHAPES, HOOD_STYLES,
  canopyHeightIn, hoodCabinetNet, resolveCabinetAbove, type CabinetAbove,
} from '@/lib/spec/hood';
import { hasUppers2, resolveUppers2HeightIn, TIER2_MAX_BOXES, type StackedRunLike } from '@/lib/spec/uppers';
import { clamp, ft, inch } from '@/lib/units';
import { shelfFootprint, shelfPoint, shelfRotation } from '../shelf-frame';
import { CATALOG_BY_ID } from '@/lib/materials/catalog';
import {
  num, pick, rectOnWall, subtractIntervals, wallLength, type Rect,
} from '@/components/scene/bathroom/layout';

export { num, pick, wallLength, rectOnWall } from '@/components/scene/bathroom/layout';
export type { Rect } from '@/components/scene/bathroom/layout';

// ---------------------------------------------------------------------------
// Constants (real millwork numbers)
// ---------------------------------------------------------------------------
/** 3/4" door / drawer front thickness */
export const DOOR_T = 0.019;
/** 3 mm reveal between adjacent fronts */
export const REVEAL = 0.003;
/**
 * The face-frame band a stacked run carries between its two tiers. The rail is
 * a real 1.25 in piece of wood: the tiers stop SHORT of it (see the row solver)
 * so it is not 81% buried behind two door edges, which left 0.24 in of it
 * showing — "ONE tall door with a scratch across it", the thing it exists to
 * prevent. `millwork.ts` draws it; the row solver has to know its height to
 * hold the doors off it, so it lives here with the other cabinet constants.
 */
export const TIER_RAIL_H = 0.03175;
/** countertop overhang past the cabinet face */
export const FRONT_OVERHANG = inch(1.5);
/** countertop overhang past a free run end */
export const END_OVERHANG = inch(0.75);
/** narrowest thing we still call a cabinet — anything less becomes a filler */
export const MIN_CAB = inch(9);
/** finished end / filler panel thickness on a tall unit */
export const TALL_PANEL = inch(1.5);
/** clear space between the countertop and the bottom of the wall cabinets */
export const UPPER_CLEAR = inch(18);
export const CROWN_H = inch(3.5);
export const CROWN_PROJ = inch(2.25);
/** preferred clear walkway kept around the island (used to ANCHOR it) */
export const WALKWAY = inch(36);
/** hard minimum aisle — the island may grow into the preferred walkway down to this */
export const MIN_AISLE = inch(24);
/** nominal tall-cabinet height used for opening collisions, so toggling
 *  "uppers to ceiling" cannot silently drop a pantry */
export const TALL_NOMINAL = inch(96);
export const SHELF_T = inch(0.75);
/** tile + thinset: what a floating shelf sits proud of when it lands on splash */
export const SPLASH_T = inch(0.4);
/** clear space kept between a counter and the underside of the lowest floating shelf */
export const SHELF_CLEAR = inch(8);
/** the 'corner' plant slot, read from `t`: quarters run back-left → front-right */
const CORNER_NAMES = ['back-left', 'back-right', 'front-left', 'front-right'] as const;

const WALLS: readonly Wall[] = ['back', 'left', 'right', 'front'];
const SHELF_MATERIALS: readonly OpenShelf['material'][] = ['match-cabinets', 'wood', 'white', 'black', 'match-countertop'];
const SHELF_STYLED: readonly OpenShelf['styled'][] = ['empty', 'dishes', 'books', 'plants', 'mixed'];
const PLANT_KINDS: readonly Plant['kind'][] = ['floor', 'counter', 'shelf', 'hanging'];
const PLANT_FORMS: readonly Plant['form'][] = ['leafy', 'tree', 'trailing', 'herb', 'succulent'];
const ART_FRAMES: readonly WallArt['frame'][] = ['black', 'wood', 'white', 'none'];
const TREATMENTS: readonly DecorSpec['windowTreatment'][] = ['none', 'roman-shade', 'roller', 'curtains', 'blinds', 'cafe-curtain'];
const COUNTER_STYLING: readonly DecorSpec['counterStyling'][] = ['none', 'minimal', 'lived-in'];
/** height of the ceiling crown the shell draws for these styles (see `trimFor`
 *  in shell.ts — the two tables must agree, a full-height splash stops under it) */
const CEILING_CROWN_H: Partial<Record<DesignStyle, number>> = {
  traditional: 0.092 * 1.1, mediterranean: 0.092 * 1.1, farmhouse: 0.086 * 1.1, coastal: 0.086 * 1.1,
};
const STYLES: readonly DesignStyle[] = ['modern', 'contemporary', 'transitional', 'traditional', 'farmhouse', 'scandinavian', 'industrial', 'coastal', 'mid-century', 'craftsman', 'mediterranean'];
const DOOR_STYLES: readonly CabinetDoorStyle[] = ['shaker', 'flat', 'raised', 'slab', 'beaded', 'glass', 'open'];
const LAYOUTS: readonly KitchenLayout[] = ['single-wall', 'galley', 'l-shaped', 'u-shaped', 'peninsula', 'g-shaped'];
const BASE_TYPES: readonly BaseCabinetType[] = ['door', 'drawers', 'sink-base', 'corner', 'appliance-gap', 'open'];
const UPPER_TYPES: readonly UpperCabinetType[] = ['door', 'glass', 'open-shelf', 'appliance-gap', 'hood-gap', 'corner'];
const APPLIANCE_KINDS: readonly ApplianceKind[] = ['fridge', 'range', 'cooktop', 'wall-oven', 'hood', 'dishwasher', 'microwave', 'wine-fridge'];
const FINISHES: readonly Appliance['finish'][] = ['stainless', 'black-stainless', 'panel-ready', 'white', 'black', 'matte-black'];
// the hood vocabulary lives in @/lib/spec/hood so the layout, the estimator,
// the reconciler and the analyzer prompt all derive the same answer
const FRIDGE_STYLES = ['french-door', 'side-by-side', 'counter-depth', 'built-in', 'top-freezer'] as const;
const PENDANT_STYLES = ['globe', 'cone', 'dome', 'drum', 'lantern', 'linear', 'cage', 'glass'] as const;
const STOOL_STYLES: readonly KStools['style'][] = ['backless', 'low-back', 'full-back', 'saddle'];
const STOOL_FRAMES: readonly KStools['frame'][] = ['light-wood', 'dark-wood', 'black-metal', 'brass', 'white'];
const STOOL_SEATS: readonly KStools['seat'][] = ['woven', 'upholstered', 'wood', 'leather', 'metal'];
/** the clear floor an end stool needs beyond the island top before we put one there */
const END_SEAT_CLEAR = inch(30);
/** thinner than this and the band over the hood is a reveal, not a cabinet — nothing is drawn */
export const HOOD_CAB_MIN = inch(4);
/** under this the band is drawn as a plain panel whatever the spec's word said:
 *  nobody hangs a 6" door, and the pull would land on the canopy */
export const HOOD_CAB_DOOR_MIN = inch(9);

/** stand-in entry for the tier helpers, which read only the two rows' lengths */
const STACK_PROBE: UpperCabinet = { widthIn: 0, type: 'door', heightIn: null };

/** [min, default, max] width in inches per appliance kind. */
const APP_W: Record<ApplianceKind, [number, number, number]> = {
  fridge: [24, 36, 48],
  range: [20, 30, 60],
  cooktop: [20, 30, 48],
  'wall-oven': [24, 30, 33],
  hood: [20, 30, 66],
  dishwasher: [18, 24, 24],
  microwave: [20, 30, 36],
  'wine-fridge': [15, 24, 30],
};

/** How eagerly each appliance grabs an `appliance-gap` (lower runs first). */
const APP_ORDER: ApplianceKind[] = ['fridge', 'range', 'cooktop', 'wall-oven', 'dishwasher', 'wine-fridge', 'microwave', 'hood'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type KBaseType = BaseCabinetType | 'filler';
/** 'hood-cabinet' is the wall cabinet that sits ON the hood canopy — a real
 *  priced upper on `cabinets_upper`, not a void (see `KUpper.hood`). */
export type KUpperType = UpperCabinetType | 'filler' | 'hood-cabinet';
export type KTallKind = 'pantry' | 'oven-tower' | 'fridge-surround';

export interface KOpening {
  id: string;
  kind: 'window' | 'door' | 'passage';
  wall: Wall;
  /** wall-local centred x of the opening's centre */
  x: number;
  t: number;
  width: number;
  height: number;
  sill: number;
  style: Opening['style'];
}

export interface KBase {
  id: string;
  type: KBaseType;
  /** wall-local centred extents */
  x0: number; x1: number; width: number; cx: number;
  drawerCount: number;
  /** appliance that claimed this void (appliance-gap only) */
  filledBy: ApplianceKind | null;
  /** height of a farmhouse apron eating into the top of this cabinet (m) */
  apronH: number;
}

export interface KUpper {
  id: string;
  type: KUpperType;
  x0: number; x1: number; width: number; cx: number;
  /** this cabinet's own underside (m). Equal to `run.upperBottom` for every row
   *  cabinet; higher for the hood cabinet, for an upper with its own
   *  `heightIn`, and for every box in the second tier. Everything that draws a
   *  wall cabinet measures from here. */
  bottom: number;
  /** this cabinet's own TOP (m): the row's top for a single-tier row and for
   *  tier 2, the rail line (`run.upperSplit`) for tier 1 under a transom. */
  top: number;
  /** 1 = the row that sits on the counter, 2 = the transom boxes over it */
  tier: 1 | 2;
  /** set only on a 'hood-cabinet' piece: which hood it sits on and what its front is */
  hood?: { id: string; front: 'doors' | 'glass' | 'panel' };
  /** what shows behind the glass; written by buildDecor, read by contents.ts */
  contents: CabinetContents['kind'] | null;
  density: 'sparse' | 'full';
}

export interface KTall {
  id: string;
  kind: KTallKind;
  x0: number; x1: number; width: number; cx: number;
  /** top of the box (m) */
  top: number;
  depth: number;
  /** fridge-surround: clear opening for the appliance */
  openingW: number;
  openingH: number;
  filled: boolean;
}

/** one field of tile: `bottom` is the counter unless the piece sits OVER a window */
export interface KSplash { x0: number; x1: number; top: number; bottom: number }

export interface KRun {
  id: string;
  wall: Wall;
  wallLen: number;
  /** false → painted wall behind this run (no tile, no cap, outlets on paint) */
  backsplash: boolean;
  /** wall-local centred extents of the finished base run */
  x0: number; x1: number; length: number;
  /** extents of the wall-cabinet row (corner pull-back is only one upper deep) */
  ux0: number; ux1: number;
  base: KBase[];
  uppers: KUpper[];
  tall: KTall[];
  hasUppers: boolean;
  upperBottom: number;
  upperTop: number;
  /** y where the two tiers meet — the rail line — or null for a single-tier row */
  upperSplit: number | null;
  upperDepth: number;
  baseDepth: number;
  counterDepth: number;
  tallTop: number;
  tallDepth: number;
  /** true when this end was pulled back so a neighbouring run owns the corner */
  pulledLo: boolean;
  pulledHi: boolean;
  /** counter slabs (wall-local centred) */
  counters: Array<[number, number]>;
  splash: KSplash[];
  /** under-cabinet LED runs: wall-local x0, x1 and the actual box underside */
  underCab: Array<[number, number, number]>;
  rect: Rect;
}

export interface KAppliance {
  id: string;
  kind: ApplianceKind;
  wall: Wall | 'island';
  /** wall-local centred x, or island-local x when wall === 'island' */
  x: number;
  /** 0..1 position as declared, kept so island units can be re-anchored */
  t: number;
  width: number;
  depth: number;
  height: number;
  /** bottom of the body (m above the floor) */
  y: number;
  /** top of the WHOLE hood unit: the duct cover's top (the ceiling unless
   *  `heightIn`), the UNDERSIDE OF THE CABINET that sits on the hood
   *  (`cabinetBottom`), the top of the uppers for a wood canopy's chase, the
   *  canopy itself for a slim insert; `y + height` for everything else */
  top: number;
  /** distance from the wall plane (or island face) to the appliance front */
  z: number;
  finish: Appliance['finish'];
  panelReady: boolean;
  hoodStyle: (typeof HOOD_STYLES)[number];
  /** resolved canopy shape (the spec's word, or the default for the style) */
  hoodShape: (typeof HOOD_SHAPES)[number];
  /** hood only: the EFFECTIVE word after the row and band gates — what is
   *  actually drawn on the canopy, which may be narrower than the spec asked
   *  ('doors' demoted to 'panel' in a short band, anything to 'none' with no row) */
  cabinetAbove: CabinetAbove;
  /** the cabinet's underside = the top of the hood unit; null when 'none' */
  cabinetBottom: number | null;
  fridgeStyle: (typeof FRIDGE_STYLES)[number];
  /** Draw only an observed external water/ice dispenser. */
  hasDispenser: boolean;
  /** this unit's own body finish; null = the room's appliances slot */
  bodyFinish: Appliance['finish'] | null;
  runId: string | null;
  rect: Rect | null;
}

export interface KIsland {
  kind: 'island' | 'peninsula' | 'breakfast-bar';
  /** world centre of the cabinet body — where the island is DRAWN */
  cx: number; cz: number;
  /** The declared, size-independent centre. Equal to `cx`/`cz` for every island
   *  that fits symmetrically about it; `cx`/`cz` slide along the long axis only
   *  when the declared LENGTH outgrows the shorter side of the anchor (a 9 ft
   *  island parked 3 ft off-centre has to run past its anchor or be a stub).
   *  Every sticky decision — the seating side, the end the stools go round — is
   *  measured from HERE, never from the drawn centre, so a length slider can
   *  never flip the stools to the other face. */
  anchorX: number; anchorZ: number;
  yaw: number;
  /** along the long (local x) axis */
  len: number;
  /** across (local z) */
  wide: number;
  seating: number;
  overhang: number;
  /** +1 → seating on local +z, -1 → local -z */
  seatSide: 1 | -1;
  /** stools tucked round the short end (the L a real kitchen makes when the end is clear) */
  endSeats: number;
  /** which end carries them: local +x or -x */
  endSide: 1 | -1;
  /** of `endSeats`, how many sit at the OTHER end (endPlacement 'both'); 0 otherwise */
  endSeatsOther: number;
  /** how far the top overhangs the body at each short end (m) — the spec's
   *  `endOverhangIn` or 1.5". `topLen = len + 2 * endOverhang`. */
  endOverhang: number;
  /** shift of the side-stool row from the island's centre (m, + toward the
   *  right end), CLAMPED so the row stays under the top — `honesty()` reads
   *  this, so it must be the number actually drawn */
  stoolOffset: number;
  /** centre-to-centre spacing of the stools along the seating face (m) — the
   *  spec's `stoolPitchIn` clamped so the row stays under the top, or the
   *  28"-capped auto spacing */
  stoolPitch: number;
  waterfall: boolean;
  hasSink: boolean;
  hasCooktop: boolean;
  carcassTop: number;
  topT: number;
  topLen: number;
  topWide: number;
  /** local z centre of the top slab relative to the body centre */
  topOffset: number;
  seatY: number;
  rect: Rect;
}

export interface KSink {
  kind: 'undermount' | 'farmhouse' | 'drop-in' | 'double';
  where: 'wall' | 'island';
  wall: Wall | null;
  /** wall-local centred x, or island-local x */
  x: number;
  width: number;
  /** front-to-back basin size */
  depth: number;
  /** basin centre distance from the wall plane (wall sinks only) */
  z: number;
  bowlDepth: number;
  runId: string | null;
}

export interface KLighting {
  recessed: number;
  underCabinet: boolean;
  chandelier: boolean;
  sconces: number;
  colorTempK: number;
  naturalLight: 'low' | 'medium' | 'high';
  pendants: {
    count: number;
    style: (typeof PENDANT_STYLES)[number];
    finish: string;
    /** centre-to-centre span of the row (m); 0 = auto (62% of the island top, 80% of the sink…) */
    spread: number;
    /** shift of the row along the island / run from its centre (m, + = toward the right end) */
    offset: number;
    /** shade bottom above the finished counter (m) — the spec's word or 32" */
    aboveCounter: number;
    /** explicit hook points, metres from the island top's centre (along, across).
     *  When set, `count` follows this list and spread/offset are ignored — a
     *  pendant hanging past the island's end is exactly what this is for. */
    positions: Array<{ along: number; across: number }> | null;
  } | null;
}

/** What the counter stools look like — always resolved, never null (the style fills in). */
export interface KStools {
  style: NonNullable<DecorSpec['stools']>['style'];
  frame: NonNullable<DecorSpec['stools']>['frame'];
  seat: NonNullable<DecorSpec['stools']>['seat'];
  /** the seat PAD's plan shape; null = the round lathe disc every style drew before the field existed */
  seatShape: NonNullable<DecorSpec['stools']>['seatShape'];
  /** the seat's own colour; null = the seat material's stock util colour */
  seatColorHex: NonNullable<DecorSpec['stools']>['seatColorHex'];
}

// ---------------------------------------------------------------------------
// Décor
// ---------------------------------------------------------------------------
export interface KShelf {
  id: string;
  wall: Wall;
  /** wall-local centred x of the boards' centre */
  x: number;
  width: number;
  depth: number;
  count: number;
  /** underside height of every board, lowest first */
  boards: number[];
  thickness: number;
  material: OpenShelf['material'];
  styled: OpenShelf['styled'];
  /** tile thickness the boards sit proud of (0 over painted wall) */
  standoff: number;
  /** the span is over a base run: depth was capped and the lowest board lifted */
  overCounter: boolean;
  brackets: 'hidden' | 'steel';
  /** Observed casework; null preserves the original floating-board model. */
  enclosure: { bottom: number; top: number; panelThickness: number; backPanel: boolean; rotationDeg: number } | null;
  finishColorHex: string | null;
}

export interface KPlant {
  id: string;
  /** Shelf host and tier, for packing and orienting the entire plant assembly. */
  hostId?: string;
  shelfIndex?: number;
  kind: Plant['kind'];
  form: Plant['form'];
  /** frame the position is expressed in (see parts.ts) */
  frame: Frame;
  /** the pot's base (floor / counter / board) — or the ceiling hook when hanging */
  x: number; y: number; z: number;
  /** overall height of the plant above its base */
  height: number;
  potR: number;
  potH: number;
  /** hanging only: hook → top of the pot */
  drop: number;
}

export interface KArt {
  id: string;
  wall: Wall;
  x: number;
  /** centre height */
  y: number;
  width: number;
  height: number;
  frame: WallArt['frame'];
  depth: number;
}

export interface KRug {
  style: 'runner' | 'area' | 'round';
  cx: number; cz: number;
  /** along local x after `yaw` */
  len: number;
  wide: number;
  yaw: number;
}

export interface KWindowTreatment {
  id: string;
  openingId: string;
  wall: Wall;
  kind: Exclude<DecorSpec['windowTreatment'], 'none'>;
  /** the opening it dresses (wall-local centred) */
  x: number;
  width: number;
  sill: number;
  height: number;
  /** mounting height of the head rail / rod */
  head: number;
}

/**
 * One small object standing on a surface, solved into the room. The layout
 * decides WHERE (which burner, which free stretch of counter, which board) and
 * clamps the size to the space it reserved; `items.ts` only draws it, so an
 * item can never be drawn bigger than the gap it was given.
 */
export interface KItem {
  id: string;
  kind: DecorItemKind;
  label: string;
  on: DecorItemOn;
  /** frame the position is expressed in (see parts.ts) */
  frame: Frame;
  /** x/z in that frame; `y` is the item's BASE, not its centre */
  x: number; y: number; z: number;
  /** metres, already clamped to the host's headroom and depth */
  w: number; h: number; d: number;
  yaw: number;
  /** tilt about x — a cutting board leaning on the splash */
  lean: number;
  colorHex: string;
  material: DecorItemMaterial;
  /** identical things in a row / a stack. `w` is ONE object: items.ts draws a
   *  row as `count` instances at a 1.1x pitch, and the layout reserved the whole
   *  row's width in the host lane and centred it on `x`. */
  count: number;
  burner: Burner | null;
  shelfIndex: number | null;
  /** the shelf / window this stands on, when it stands on one */
  hostId: string | null;
}

export interface KDecor {
  shelves: KShelf[];
  plants: KPlant[];
  /** everything standing ON a surface, already placed (see `KItem`) */
  items: KItem[];
  art: KArt[];
  rug: KRug | null;
  treatments: KWindowTreatment[];
  windowTreatment: DecorSpec['windowTreatment'];
  counterStyling: DecorSpec['counterStyling'];
  stools: KStools;
  /** muted tone for canvases, derived from the cabinet colour */
  accentHex: string;
  /** what could not be honoured as declared, in plain words for the UI */
  warnings: string[];
}

type Frame = 'world' | 'island' | Wall;

export interface KitchenLayoutData {
  w: number; d: number; h: number;
  scanGeometry?: KitchenSpec['scanGeometry'];
  widthFt: number; depthFt: number; ceilingFt: number;
  style: DesignStyle;
  layout: KitchenLayout;
  doorStyle: CabinetDoorStyle;
  twoTone: boolean;
  hardware: KitchenSpec['cabinets']['hardware'];
  crown: boolean;
  crownH: number;
  /** height of the room's ceiling crown (0 when the style has none) */
  ceilingCrown: number;
  toeKick: number;
  baseDepth: number;
  upperDepth: number;
  carcassTop: number;
  counterT: number;
  /** finished countertop surface height */
  counterTopY: number;
  upperBottom: number;
  edge: KitchenSpec['countertop']['edge'];
  backsplash: { present: boolean; height: 'standard' | 'full-height' | 'ledge'; pattern: KitchenSpec['backsplash']['pattern']; behindRange: 'same' | 'full-height' };
  openings: KOpening[];
  runs: KRun[];
  island: KIsland | null;
  appliances: KAppliance[];
  sink: KSink | null;
  lighting: KLighting;
  decor: KDecor;
  /** every footprint that blocks the floor (runs, island, free-standing appliances) */
  rects: Rect[];
  /** how far each wall is occupied by cabinetry (m) */
  inset: Record<Wall, number>;
}

// ---------------------------------------------------------------------------
// Interval helpers
// ---------------------------------------------------------------------------
type Span = [number, number];

function intersectIntervals(segs: Span[], cuts: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a0, a1] of segs) {
    for (const [c0, c1] of cuts) {
      const lo = Math.max(a0, c0), hi = Math.min(a1, c1);
      if (hi - lo > 0.02) out.push([lo, hi]);
    }
  }
  return out.sort((p, q) => p[0] - q[0]);
}

function mergeSpans(spans: Span[], gap = 0.004): Span[] {
  const sorted = spans.filter(([a, b]) => b - a > 1e-4).sort((p, q) => p[0] - q[0]);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + gap) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row fitting
// ---------------------------------------------------------------------------
interface RowItem { type: string; width: number; fixed: boolean; min: number; drawerCount: number; heightIn?: number | null }
interface RowOut { type: string; width: number; fixed: boolean; drawerCount: number; x0: number; x1: number; cx: number; heightIn?: number | null }

/** per-cabinet stretch a declared width may absorb before the gap becomes a filler */
const STRETCH_TOL = inch(3);

/**
 * Lay a row of cabinets from `x0` at their DECLARED widths, flowing round the
 * reserved spans (tall units, doorways) and stopping at `xEnd` — the wall, a
 * corner pull-back, or the next run on this wall. The old proportional fit
 * turned a client's 30" drawer stack into two 7" fillers and a 36" sink base
 * into 39" whenever the analyzer's list and run length disagreed; a real
 * kitchen keeps the cabinets it has and lets the run end where they end.
 *
 *  - a cabinet that would straddle a reserved span is cut down to fill the
 *    gap before it when that gap is still a cabinet (≥ minW); otherwise the
 *    gap is a scribe filler and the cabinet moves past the span whole
 *  - only the LAST cabinet shrinks, and only when `xEnd` runs out; what does
 *    not fit at all is dropped rather than squeezed
 *  - fixed items (appliance gaps) never change width
 *
 * Returns the pieces and the x the row ends at (which may be short of, or
 * beyond, the declared run end — see fillRowGaps / the caller).
 */
function flowRow(items: RowItem[], x0: number, xEnd: number, reserved: Span[], minW: number, filler: string): { row: RowOut[]; end: number } {
  const row: RowOut[] = [];
  const put = (type: string, width: number, fixed: boolean, drawerCount: number, x: number, heightIn: number | null = null) =>
    row.push({ type, width, fixed, drawerCount, heightIn, x0: x, x1: x + width, cx: x + width / 2 });
  const res = mergeSpans(reserved.filter(([a, b]) => b > x0 + 1e-4 && a < xEnd - 1e-4))
    .map(([a, b]): Span => [Math.max(a, x0), Math.min(b, xEnd)]);
  let x = x0;
  /**
   * Take `need` back from the flexible cabinets just laid (last first: down
   * to minW, dropped when that is not enough) so a fixed item still fits.
   * Only the contiguous stretch behind `x` gives — never across a tall unit.
   */
  const reclaim = (need: number): boolean => {
    const trial = row.slice();
    let got = 0;
    while (got < need - 1e-6 && trial.length) {
      const p = trial[trial.length - 1];
      if (p.fixed || p.x1 < x - got - 1e-4) break;
      const give = p.type === filler ? p.width : p.width - minW;
      if (give < need - got - 1e-6) { got += p.width; trial.pop(); continue; }
      const width = p.width - (need - got);
      trial[trial.length - 1] = { ...p, width, x1: p.x0 + width, cx: p.x0 + width / 2 };
      got = need;
    }
    if (got < need - 1e-6) return false;
    row.splice(0, row.length, ...trial);
    x -= got;
    return true;
  };
  outer: for (const it of items) {
    if (it.width <= 1e-4) continue;
    for (;;) {
      if (x >= xEnd - 1e-4) break outer;
      const ahead = res.find(([a, b]) => b > x + 1e-4 && a < x + it.width - 1e-4);
      if (ahead) {
        const gap = ahead[0] - x;
        const cutDown = gap >= minW && !it.fixed;
        if (cutDown) put(it.type, gap, it.fixed, it.drawerCount, x, it.heightIn ?? null);
        else if (gap > 0.005) put(filler, gap, false, 0, x);
        x = ahead[1];
        if (cutDown) continue outer;
        continue;
      }
      if (x + it.width > xEnd + 1e-4) {
        // an appliance gap outranks the doors before it: a dishwasher with
        // nowhere to go is a bigger lie than a door that got narrower
        if (it.fixed && reclaim(x + it.width - xEnd)) continue;
        const rest = xEnd - x;
        if (rest >= minW && !it.fixed) put(it.type, rest, it.fixed, it.drawerCount, x, it.heightIn ?? null);
        else if (rest > 0.005) put(filler, rest, false, 0, x);
        x = xEnd;
        break outer;
      }
      put(it.type, it.width, it.fixed, it.drawerCount, x, it.heightIn ?? null);
      x += it.width;
      continue outer;
    }
  }
  return { row, end: x };
}

/**
 * The declared run is longer than the cabinets laid in it: within each
 * stretch between reserved spans, flexible cabinets absorb up to STRETCH_TOL
 * each (an analyzer's 108" of cabinets on a 114" run is the same kitchen
 * within measuring error) and whatever is left becomes a filler at the end of
 * that stretch — visible and honest, where the old fit silently widened every
 * cabinet by the same ratio.
 */
function fillRowGaps(row: RowOut[], x0: number, x1: number, reserved: Span[], filler: string): RowOut[] {
  const res = mergeSpans(reserved.filter(([a, b]) => b > x0 + 1e-4 && a < x1 - 1e-4))
    .map(([a, b]): Span => [Math.max(a, x0), Math.min(b, x1)]);
  // free stretches of the run: between consecutive reserved spans
  const segments: Span[] = [];
  let cursor = x0;
  for (const [a, b] of res) { if (a - cursor > 1e-4) segments.push([cursor, a]); cursor = Math.max(cursor, b); }
  if (x1 - cursor > 1e-4) segments.push([cursor, x1]);

  const out: RowOut[] = [];
  for (const [s0, s1] of segments) {
    const inside = row.filter((p) => p.x0 >= s0 - 1e-4 && p.x1 <= s1 + 1e-4);
    const end = inside.length ? inside[inside.length - 1].x1 : s0;
    const leftover = s1 - end;
    if (leftover <= 0.005) { out.push(...inside); continue; }
    const flex = inside.filter((p) => !p.fixed && p.type !== filler);
    const flexSum = flex.reduce((n, p) => n + p.width, 0);
    const stretch = Math.min(leftover, STRETCH_TOL * flex.length);
    let x = s0;
    for (const p of inside) {
      const width = p.width + (stretch > 1e-6 && !p.fixed && p.type !== filler ? stretch * (p.width / flexSum) : 0);
      out.push({ ...p, width, x0: x, x1: x + width, cx: x + width / 2 });
      x += width;
    }
    if (s1 - x > 0.005) out.push({ type: filler, width: s1 - x, fixed: false, drawerCount: 0, x0: x, x1: s1, cx: (x + s1) / 2 });
  }
  // pieces the caller laid inside a reserved span cannot exist; anything not
  // inside a segment was already dropped by the filter above
  return out;
}

/** How far along its wall a run's UPPER row may grow: the wall's end, or just
 *  short of the next run on that wall. The hood piece is clipped to it so a
 *  cabinet on the canopy never runs into the neighbouring row. */
function wallEndU(runs: KRun[], r: KRun): number {
  let end = r.wallLen / 2;
  for (const o of runs) {
    if (o === r || o.wall !== r.wall || o.ux0 <= r.ux0 + 1e-3) continue;
    end = Math.min(end, o.ux0 - 0.005);
  }
  return end;
}

/** do these two spans genuinely overlap (not merely touch)? */
const overlaps = (u: { x0: number; x1: number }, [c0, c1]: Span, tol: number) => u.x1 > c0 + tol && u.x0 < c1 - tol;

interface Carveable { id?: string; type: string; x0: number; x1: number; width: number; cx: number }

/**
 * Remove `cuts` from a laid-out row. A cabinet reduced below `minW` becomes
 * whatever `fillerFor` says — a scribe filler for real cabinetry, but a void
 * stays a void so a sliver of appliance gap never turns into a blank panel.
 * A cabinet cut into TWO pieces gets a suffix on each (`b0f0`, `b0f1`): the
 * pieces become separate meshes, and React drops one of two children that
 * share a key.
 */
function carveRow<T extends Carveable>(items: T[], cuts: Span[], minW: number, fillerFor: (t: T['type']) => T['type']): T[] {
  let out = items;
  for (const [c0, c1] of cuts) {
    if (c1 - c0 <= 1e-4) continue;
    const next: T[] = [];
    for (const it of out) {
      if (it.x1 <= c0 + 1e-4 || it.x0 >= c1 - 1e-4) { next.push(it); continue; }
      const lo = c0 - it.x0 > 1e-4, hi = it.x1 - c1 > 1e-4;
      const idOf = (n: number): Partial<Carveable> => (lo && hi && it.id !== undefined ? { id: `${it.id}f${n}` } : {});
      if (lo) {
        const wdt = c0 - it.x0;
        next.push({ ...it, ...idOf(0), x1: c0, width: wdt, cx: (it.x0 + c0) / 2, type: wdt < minW ? fillerFor(it.type) : it.type });
      }
      if (hi) {
        const wdt = it.x1 - c1;
        next.push({ ...it, ...idOf(1), x0: c1, width: wdt, cx: (c1 + it.x1) / 2, type: wdt < minW ? fillerFor(it.type) : it.type });
      }
    }
    out = next;
  }
  return out.filter((i) => i.width > 0.005);
}

/** Cut only the volume occupied by an opening. A window can interrupt the
 * lower part of a row while leaving real cabinets above its head. Projecting
 * it through the row's entire height used to delete those boxes and tier 2. */
function carveUpperOpenings(items: KUpper[], openings: KOpening[]): KUpper[] {
  let out = items;
  for (const o of openings) {
    const c0 = o.x - o.width / 2 - inch(0.5), c1 = o.x + o.width / 2 + inch(0.5);
    const y0 = o.sill - inch(0.5), y1 = o.sill + o.height + inch(0.5);
    out = out.flatMap((u) => {
      if (u.x1 <= c0 + 1e-4 || u.x0 >= c1 - 1e-4 || u.top <= y0 + 1e-4 || u.bottom >= y1 - 1e-4) return [u];
      const sides = carveRow([u], [[c0, c1]], MIN_CAB, upperFiller)
        .map((p, i) => ({ ...p, id: `${u.id}-${o.id}-side${i}` }));
      const x0 = Math.max(u.x0, c0), x1 = Math.min(u.x1, c1), width = x1 - x0;
      const piece = (bottom: number, top: number, key: string): KUpper[] => top - bottom >= MIN_CAB - 1e-4
        ? [{ ...u, id: `${u.id}-${o.id}-${key}`, x0, x1, width, cx: (x0 + x1) / 2, bottom, top,
          type: width < MIN_CAB ? upperFiller(u.type) : u.type }]
        : [];
      return [...sides, ...piece(u.bottom, Math.min(u.top, y0), 'below'), ...piece(Math.max(u.bottom, y1), u.top, 'above')];
    });
  }
  return out.sort((a, b) => a.tier - b.tier || a.x0 - b.x0 || a.bottom - b.bottom);
}

/**
 * A sliver left beside a carve is a scribe, not a hole. An `appliance-gap`
 * keeps its type (a sliver of it is still the void an appliance stands in),
 * but a `hood-gap` sliver beside the explicit hood piece would read as a
 * second hole in the row — it becomes a filler.
 */
const upperFiller = (t: KUpperType): KUpperType => (t === 'appliance-gap' ? t : 'filler');

/**
 * The explicit pendant hook points, feet → metres, or null for the evenly
 * spaced row. Objects, never pairs (a zod tuple emits `prefixItems`, which
 * OpenAI strict mode rejects).
 */
function pendantHooks(raw: unknown): Array<{ along: number; across: number }> | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = raw
    .filter((p): p is { alongFt: number; acrossFt: number } => !!p && typeof p === 'object')
    .slice(0, 6)
    .map((p) => ({ along: ft(num(p.alongFt, 0, -20, 20)), across: ft(num(p.acrossFt, 0, -10, 10)) }));
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
// Corners
// ---------------------------------------------------------------------------
type End = 'lo' | 'hi';
const CORNERS: Array<[{ wall: Wall; end: End }, { wall: Wall; end: End }]> = [
  [{ wall: 'back', end: 'lo' }, { wall: 'left', end: 'hi' }],
  [{ wall: 'back', end: 'hi' }, { wall: 'right', end: 'lo' }],
  [{ wall: 'front', end: 'lo' }, { wall: 'right', end: 'hi' }],
  [{ wall: 'front', end: 'hi' }, { wall: 'left', end: 'lo' }],
];

interface DraftRun {
  id: string;
  wall: Wall;
  wallLen: number;
  a0: number; a1: number;
  base: RowItem[];
  uppers: RowItem[];
  /** the SECOND, shorter tier — the transom boxes that sit on `uppers` and run
   *  to the top of the row. Empty = one tier, which is every spec written
   *  before `CabinetRun.uppers2` existed and exactly what the scene drew then. */
  uppers2: RowItem[];
  /** the spec's `uppers2HeightIn`, or null to derive it from the row */
  uppers2HeightIn: number | null;
  tall: Array<{ t: number; widthIn: number; kind: KTallKind; toCeiling: boolean | null }>;
  hasUppers: boolean;
  uppersToCeiling: boolean;
  /** this run's own wall-cabinet height (inches) when the photo showed it differing from the room's; null = room default */
  upperHeightIn: number | null;
  /** absolute underside from the floor; null retains the standard counter clearance */
  upperBottomIn: number | null;
  backsplash: boolean;
  pullLo: number;
  pullHi: number;
  ownsLo: boolean;
  ownsHi: boolean;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function computeKitchenLayout(specIn: KitchenSpec | null | undefined): KitchenLayoutData {
  const spec = (specIn ?? {}) as Partial<KitchenSpec>;
  const geometryWarnings: string[] = [];

  // ---- room -------------------------------------------------------------
  const dims = (spec.dims ?? {}) as Partial<KitchenSpec['dims']>;
  // Same envelope as DimsZ: a confirmed room dimension must not silently
  // draw a different width/depth in the scene.
  const widthFt = num(dims.widthFt, 14, 4, 80);
  const depthFt = num(dims.depthFt, 12, 4, 80);
  const ceilingFt = num(dims.ceilingFt, 9, 7, 20);
  const w = ft(widthFt), d = ft(depthFt), h = ft(ceilingFt);
  const style = pick<DesignStyle>(spec.style, STYLES, 'transitional');
  const layout = pick<KitchenLayout>(spec.layout, LAYOUTS, 'l-shaped');

  // ---- cabinetry parameters --------------------------------------------
  const cs = (spec.cabinets ?? {}) as Partial<KitchenSpec['cabinets']>;
  const doorStyle = pick<CabinetDoorStyle>(cs.doorStyle, DOOR_STYLES, 'shaker');
  const hardware = pick<KitchenSpec['cabinets']['hardware']>(cs.hardware, ['pulls', 'knobs', 'mixed', 'integrated', 'none'], 'pulls');
  const baseDepth = inch(num(cs.baseDepthIn, 24, 15, 30));
  const upperDepth = inch(num(cs.upperDepthIn, 12, 9, 18));
  const cts = (spec.countertop ?? {}) as Partial<KitchenSpec['countertop']>;
  const counterT = inch(num(cts.thicknessIn, 1.25, 0.4, 4));
  const edge = pick<KitchenSpec['countertop']['edge']>(cts.edge, ['eased', 'bullnose', 'bevel', 'ogee', 'mitered'], 'eased');
  const toeKick = clamp(inch(num(cs.toeKickIn, 4.5, 0, 9)), 0, inch(9));
  const carcassTop = clamp(inch(num(cs.baseHeightIn, 34.5, 28, 44)), toeKick + inch(14), h - 0.6);
  const counterTopY = carcassTop + counterT;
  const crown = cs.crown === true;
  const crownH = crown ? Math.min(CROWN_H, Math.max(0.02, h - counterTopY - UPPER_CLEAR - inch(12))) : 0;
  const ceilingCrown = h > 2.3 ? (CEILING_CROWN_H[style] ?? 0) : 0;
  const upperBottom = counterTopY + UPPER_CLEAR;
  /** the wall-cabinet height the SPEC declares, before the ceiling clamps it.
   *  Collision bands are taken from this so that raising the ceiling — or
   *  toggling "uppers to ceiling" — cannot change which openings a row of wall
   *  cabinets is deemed to run through. */
  const upperHNominal = inch(num(cs.upperHeightIn, 36, 12, 60));
  // the perimeter counter's front overhang past the door faces — 1.5" unless
  // the photo read a thicker mitred slab off a drawer front seen edge-on
  const counterDepth = baseDepth + inch(num(cts.overhangIn, FRONT_OVERHANG / 0.0254, 0, 4));

  const bs = (spec.backsplash ?? {}) as Partial<KitchenSpec['backsplash']>;
  const backsplash = {
    present: bs.present !== false,
    height: pick<'standard' | 'full-height' | 'ledge'>(bs.height, ['standard', 'full-height', 'ledge'], 'standard'),
    pattern: pick<KitchenSpec['backsplash']['pattern']>(bs.pattern, ['running-bond', 'stacked', 'herringbone', 'slab', 'mosaic', 'hex'], 'running-bond'),
    behindRange: pick<'same' | 'full-height'>(bs.behindRange, ['same', 'full-height'], 'same'),
  };
  /** where the tile STOPS above the counter, inches — 0 = use the category.
   *  A measured height beats the 3-value word everywhere the field is drawn,
   *  INCLUDING behind the hood (without that half it changes nothing you can see). */
  const splashHeightIn = num(bs.heightIn, 0, 0, 240);
  // tall units (fridge surround, pantry, oven tower) have their own slot,
  // `cabinets_tall` (see tallUnitParts in millwork.ts) — the layout no longer
  // guesses base-or-upper for them from twoTone

  // ---- openings ---------------------------------------------------------
  const openings: KOpening[] = [];
  const rawOpenings = Array.isArray(spec.openings) ? spec.openings : [];
  rawOpenings.forEach((o, i) => {
    if (!o || typeof o !== 'object') return;
    const kindRaw = pick<Opening['kind']>(o.kind, ['window', 'door', 'passage', 'garage-door'], 'window');
    const kind: KOpening['kind'] = kindRaw === 'garage-door' ? 'passage' : kindRaw;
    const wall = pick<Wall>(o.wall, WALLS, 'back');
    const len = wallLength(wall, w, d);
    if (len < 0.9) return;
    let width: number, height: number, sill: number;
    if (kind === 'window') {
      width = clamp(ft(num(o.widthFt, 4, 1, 60)), 0.4, Math.max(0.4, len - 0.3));
      sill = clamp(ft(num(o.sillFt, 3.5, 0, 16)), 0, Math.max(0, h - 0.6));
      height = clamp(ft(num(o.heightFt, 3.5, 1, 16)), 0.4, Math.max(0.4, h - sill - 0.12));
    } else {
      width = clamp(ft(num(o.widthFt, kind === 'passage' ? 4 : 2.83, 1.5, 20)), 0.6, Math.max(0.6, len - 0.3));
      sill = 0;
      height = clamp(ft(num(o.heightFt, 6.83, 5, 16)), 1.9, Math.max(1.9, h - 0.06));
    }
    const t = num(o.t, 0.5, 0, 1);
    const a = clamp(t * len, width / 2 + 0.05, Math.max(width / 2 + 0.05, len - width / 2 - 0.05));
    openings.push({
      id: typeof o.id === 'string' && o.id ? o.id : `opening-${i}`,
      kind, wall, x: a - len / 2, t: a / len, width, height, sill, style: o.style ?? null,
    });
  });

  // ---- lighting ---------------------------------------------------------
  const lt = (spec.lighting ?? {}) as Partial<KitchenSpec['lighting']>;
  const pendantsRaw = lt.pendants && typeof lt.pendants === 'object' ? lt.pendants : null;
  const lighting: KLighting = {
    recessed: Math.round(num(lt.recessedCount, 6, 0, 24)),
    underCabinet: lt.underCabinet !== false,
    chandelier: !!lt.chandelier,
    sconces: Math.round(num(lt.sconces, 0, 0, 8)),
    colorTempK: num(lt.colorTempK, 3000, 2200, 5500),
    naturalLight: pick(lt.naturalLight, ['low', 'medium', 'high'] as const, 'medium'),
    pendants: pendantsRaw && num(pendantsRaw.count, 0, 0, 8) >= 1
      ? {
        // explicit hook points win over the count: they ARE the row
        count: pendantHooks(pendantsRaw.positions)?.length ?? Math.round(num(pendantsRaw.count, 2, 1, 6)),
        style: pick(pendantsRaw.style, PENDANT_STYLES, 'globe'),
        // the metal word travels through so a brass chain in the photo is a brass chain in the twin
        finish: typeof pendantsRaw.finish === 'string' ? pendantsRaw.finish : '',
        // 0 = auto for the span and the height; the row's shift is a plain
        // offset. The room-dependent clamps (the island top, the run, the
        // ceiling) are applied in `pendantPositions` / `pendantDrop`, which
        // see the finished layout.
        spread: ft(num(pendantsRaw.spreadFt, 0, 0, 16)),
        offset: ft(num(pendantsRaw.offsetFt, 0, -8, 8)),
        aboveCounter: inch(num(pendantsRaw.aboveCounterIn, 0, 0, 60) || 32),
        positions: pendantHooks(pendantsRaw.positions),
      }
      : null,
  };

  // ---- appliance pre-pass (widths are needed to size tall units) --------
  const rawAppliances = (Array.isArray(spec.appliances) ? spec.appliances : []).filter((a): a is Appliance => !!a && typeof a === 'object');
  const appWidth = (a: Partial<Appliance>): number => {
    const kind = pick<ApplianceKind>(a.kind, APPLIANCE_KINDS, 'fridge');
    const [lo, def, hi] = APP_W[kind];
    return inch(num(a.widthIn, def, lo, hi));
  };
  const fridgeRaw = rawAppliances.find((a) => a.kind === 'fridge') ?? null;
  const fridgeW = fridgeRaw ? appWidth(fridgeRaw) : inch(36);
  const fridgeStyle0 = pick(fridgeRaw?.fridgeStyle ?? undefined, FRIDGE_STYLES, 'french-door');
  // A built-in is a 84" column that sits flush in a 24" deep surround; a
  // counter-depth box is 25" deep and a free-standing french door / side-by-side
  // stands 30" deep and proud of the cabinets. The surround is sized from this
  // so the opening fits the fridge that goes in it.
  // The photo's own fridge height (a 72" french door, an 84" column) wins over
  // the style's default; both are kept under the ceiling so the surround's
  // opening can always close over it.
  const fridgeHeightFor = (style: (typeof FRIDGE_STYLES)[number], heightIn: number | null | undefined) => (
    Number.isFinite(heightIn) && (heightIn as number) > 0
      ? clamp(inch(heightIn as number), inch(48), Math.max(inch(48), h - 0.3))
      : style === 'built-in' ? Math.min(inch(84), h - 0.3) : inch(70)
  );
  const fridgeH = fridgeHeightFor(fridgeStyle0, fridgeRaw?.heightIn);
  const fridgeD = fridgeStyle0 === 'built-in' ? baseDepth : fridgeStyle0 === 'counter-depth' ? baseDepth + inch(1) : inch(30);
  const ovenW = (() => {
    const ov = rawAppliances.find((a) => a.kind === 'wall-oven');
    return ov ? appWidth(ov) : inch(30);
  })();

  // ---- draft runs -------------------------------------------------------
  const SNAP = 0.4;
  const drafts: DraftRun[] = [];
  const rawRuns = (Array.isArray(spec.runs) ? spec.runs : []).filter((r) => !!r && typeof r === 'object');
  rawRuns.slice(0, 6).forEach((r, i) => {
    const wall = pick<Wall>(r.wall, WALLS, 'back');
    const wl = wallLength(wall, w, d);
    if (wl < inch(18)) return;
    const rawBase = (Array.isArray(r.base) ? r.base : []).filter((b) => !!b && typeof b === 'object');
    const baseItems: RowItem[] = rawBase.slice(0, 24).map((b) => {
      const type = pick<BaseCabinetType>(b.type, BASE_TYPES, 'door');
      const width = inch(num(b.widthIn, type === 'appliance-gap' ? 30 : 24, 6, 72));
      return {
        type,
        width,
        fixed: type === 'appliance-gap',
        min: type === 'appliance-gap' ? width : MIN_CAB,
        drawerCount: Math.round(num(b.drawerCount, type === 'drawers' ? 3 : 0, 0, 6)),
      };
    });
    const wanted = clamp(ft(num(r.lengthFt, wl / 0.3048, 1, 200)), inch(12), wl);
    const fallbackLen = baseItems.reduce((s, b) => s + b.width, 0);
    const runLen = clamp(baseItems.length ? wanted : Math.min(wl, Math.max(wanted, inch(24))), inch(12), wl);
    if (!baseItems.length) {
      // no cabinet list at all — synthesise a plain run of 30" doors
      const n = Math.max(1, Math.round(runLen / inch(30)));
      for (let k = 0; k < n; k++) baseItems.push({ type: 'door', width: runLen / n, fixed: false, min: MIN_CAB, drawerCount: 0 });
    }
    void fallbackLen;

    const hasUppers = r.hasUppers !== false;
    const rawUppers = (Array.isArray(r.uppers) ? r.uppers : []).filter((u) => !!u && typeof u === 'object');
    const upperItems: RowItem[] = rawUppers.slice(0, 24).map((u) => {
      const type = pick<UpperCabinetType>(u.type, UPPER_TYPES, 'door');
      const width = inch(num(u.widthIn, 30, 6, 72));
      const fixed = type === 'appliance-gap' || type === 'hood-gap';
      // one cabinet in the row may be shorter than its neighbours (the box over
      // the fridge, a stacked glass box) — it hangs from the row's TOP line
      const heightIn = Number.isFinite(u.heightIn) && (u.heightIn as number) > 0 ? num(u.heightIn, 36, 9, 60) : null;
      return { type, width, fixed, min: fixed ? width : MIN_CAB, drawerCount: 0, heightIn };
    });
    // The second tier reads through the SAME sanitiser as the first — one
    // grammar, one set of clamps — and is dropped outright without a first
    // tier, because a stacked run is two rows, never one row hung at the top.
    const rawUppers2 = (Array.isArray(r.uppers2) ? r.uppers2 : []).filter((u) => !!u && typeof u === 'object');
    const upper2Items: RowItem[] = (rawUppers.length ? rawUppers2 : []).slice(0, TIER2_MAX_BOXES).map((u) => {
      const type = pick<UpperCabinetType>(u.type, UPPER_TYPES, 'door');
      const width = inch(num(u.widthIn, 30, 6, 72));
      const fixed = type === 'appliance-gap' || type === 'hood-gap';
      return { type, width, fixed, min: fixed ? width : MIN_CAB, drawerCount: 0, heightIn: null };
    });
    if (hasUppers && !upperItems.length) {
      // mirror the base row so uppers line up with the cabinets under them
      for (const b of baseItems) {
        upperItems.push({
          type: b.type === 'appliance-gap' ? 'appliance-gap' : 'door',
          width: b.width,
          fixed: b.type === 'appliance-gap',
          min: b.type === 'appliance-gap' ? b.width : MIN_CAB,
          drawerCount: 0,
        });
      }
    }

    const tall = (Array.isArray(r.tall) ? r.tall : [])
      .filter((t) => !!t && typeof t === 'object')
      .slice(0, 6)
      .map((t) => ({
        t: num(t.t, 0, 0, 1),
        widthIn: num(t.widthIn, 30, 12, 72),
        kind: pick<KTallKind>(t.kind, ['pantry', 'oven-tower', 'fridge-surround'], 'pantry'),
        toCeiling: t.toCeiling === true ? true : t.toCeiling === false ? false : null,
      }));

    // position along the wall + corner snapping
    const start = num(r.start, 0, -1, 2);
    let a0 = clamp(start * wl, 0, Math.max(0, wl - runLen));
    let a1 = a0 + runLen;
    const firstCorner = baseItems[0]?.type === 'corner';
    const lastCorner = baseItems[baseItems.length - 1]?.type === 'corner';
    if (lastCorner && !firstCorner) { a1 = wl; a0 = Math.max(0, wl - runLen); }
    else if (firstCorner && !lastCorner) { a0 = 0; a1 = Math.min(wl, runLen); }
    else {
      if (a0 < SNAP) { a0 = 0; a1 = Math.min(wl, runLen); }
      if (wl - a1 < SNAP) { a1 = wl; a0 = Math.max(0, wl - runLen); }
    }

    drafts.push({
      id: typeof r.id === 'string' && r.id ? r.id : `run-${i}`,
      wall, wallLen: wl, a0, a1,
      base: baseItems, uppers: upperItems, uppers2: upper2Items, tall,
      uppers2HeightIn: Number.isFinite(r.uppers2HeightIn) ? (r.uppers2HeightIn as number) : null,
      hasUppers, uppersToCeiling: r.uppersToCeiling === true,
      upperHeightIn: Number.isFinite(r.upperHeightIn) && (r.upperHeightIn as number) > 0 ? num(r.upperHeightIn, 36, 12, 60) : null,
      upperBottomIn: Number.isFinite(r.upperBottomIn) && (r.upperBottomIn as number) > 0 ? num(r.upperBottomIn, 54, 1, 240) : null,
      // a missing flag means the analyzer predates per-run splash: tile it
      backsplash: r.backsplash !== false,
      pullLo: 0, pullHi: 0,
      ownsLo: firstCorner, ownsHi: lastCorner,
    });
  });

  // ---- corner resolution ------------------------------------------------
  // One run owns each occupied corner and runs straight into it; the other is
  // pulled back by the owner's countertop depth so the two slabs butt in a
  // single seam with no gap and no doubled thickness.
  for (const [sideA, sideB] of CORNERS) {
    const touching = (r: DraftRun, side: { wall: Wall; end: End }) =>
      r.wall === side.wall && (side.end === 'lo' ? r.a0 < 0.02 : r.wallLen - r.a1 < 0.02);
    const ra = drafts.find((r) => touching(r, sideA));
    const rb = drafts.find((r) => touching(r, sideB));
    if (!ra || !rb || ra === rb) continue;
    const aOwns = sideA.end === 'lo' ? ra.ownsLo : ra.ownsHi;
    const bOwns = sideB.end === 'lo' ? rb.ownsLo : rb.ownsHi;
    let owner = ra, guest = rb, guestEnd = sideB.end;
    if (bOwns && !aOwns) { owner = rb; guest = ra; guestEnd = sideA.end; }
    else if (aOwns === bOwns) {
      // neither (or both) declared a corner cabinet — the first-declared run wins
      const ia = drafts.indexOf(ra), ib = drafts.indexOf(rb);
      if (ib < ia) { owner = rb; guest = ra; guestEnd = sideA.end; }
    }
    const pull = owner.wall === guest.wall ? 0 : counterDepth;
    if (pull <= 0) continue;
    if (guestEnd === 'lo') guest.pullLo = Math.max(guest.pullLo, pull);
    else guest.pullHi = Math.max(guest.pullHi, pull);
  }

  // A built-in fridge is nothing without its surround: if the analyzer put one
  // on a wall whose run has no 'fridge-surround', synthesise one around the
  // fridge's declared position so the column gets its side panels and the
  // cabinet over it. Deterministic in the spec, so nothing else moves.
  if (fridgeRaw && fridgeStyle0 === 'built-in' && fridgeRaw.wall !== 'island') {
    const wall = pick<Wall>(fridgeRaw.wall, WALLS, 'back');
    const onWall = drafts.filter((r) => r.wall === wall);
    if (onWall.length && !onWall.some((r) => r.tall.some((t) => t.kind === 'fridge-surround'))) {
      const wl = wallLength(wall, w, d);
      const at = clamp(num(fridgeRaw.t, 0.5, 0, 1) * wl, 0, wl);
      const host = onWall.reduce((best, r) => {
        const dist = at < r.a0 ? r.a0 - at : at > r.a1 ? at - r.a1 : 0;
        return !best || dist < best.dist ? { r, dist } : best;
      }, null as { r: DraftRun; dist: number } | null)!.r;
      // tall `t` is the left edge as a fraction of the FINISHED run, after the corner pull-backs
      const width = fridgeW + 2 * TALL_PANEL;
      const lo = host.a0 + host.pullLo, hi = host.a1 - host.pullHi;
      host.tall.push({ t: clamp((at - width / 2 - lo) / Math.max(1e-3, hi - lo), 0, 1), widthIn: width / 0.0254, kind: 'fridge-surround', toCeiling: null });
    }
  }

  // ---- build the finished runs -----------------------------------------
  const runs: KRun[] = [];
  for (const dr of drafts) {
    const wl = dr.wallLen;
    const half = wl / 2;
    // A corner pull-back moves the run's START (its cabinets shift along the
    // wall, widths intact); the declared end is where the analyzer said the
    // run stops, and the cabinets may run past it as far as the wall, a
    // pulled corner, or the next run on this wall allows.
    const x0 = clamp(dr.a0 + dr.pullLo, 0, wl) - half;
    let x1 = clamp(dr.a1 - dr.pullHi, 0, wl) - half;
    const span = x1 - x0;
    if (span < inch(9)) continue;
    const nextStart = drafts.reduce((m, o) => (o !== dr && o.wall === dr.wall && o.a0 > dr.a0 + 1e-3 ? Math.min(m, o.a0) : m), wl);
    const wallEnd = Math.max(x1, nextStart - half);
    const xEnd = dr.pullHi > 1e-4 ? x1 : wallEnd;
    // wall cabinets only lose one upper depth at a corner, not the counter depth
    const upperPull = upperDepth + inch(0.5);
    const pullLoU = dr.pullLo > 0 ? Math.min(dr.pullLo, upperPull) : 0;
    const pullHiU = dr.pullHi > 0 ? Math.min(dr.pullHi, upperPull) : 0;
    const ux0 = clamp(dr.a0 + pullLoU, 0, wl) - half;
    let ux1 = clamp(dr.a1 - pullHiU, 0, wl) - half;
    const xEndU = dr.pullHi > 1e-4 ? ux1 : Math.max(ux1, wallEnd);

    // A run may carry its own wall-cabinet height (the photo showed 42"
    // uppers over the range wall and 30" over the window wall). It obeys the
    // same ceiling bounds as the room's. A measured underside and height
    // describe the actual box; a categorical to-ceiling flag cannot stretch
    // a measured shallow row into a tall door.
    const rowCeiling = h - crownH - 0.004;
    const lowestUpperBottom = counterTopY + inch(0.5);
    const runUpperBottom = dr.upperBottomIn === null ? upperBottom
      : clamp(inch(dr.upperBottomIn), lowestUpperBottom, Math.max(lowestUpperBottom, rowCeiling - inch(12)));
    if (dr.upperBottomIn !== null && Math.abs(runUpperBottom - inch(dr.upperBottomIn)) > inch(0.5)) {
      geometryWarnings.push(`Upper cabinets on the ${dr.wall} wall were requested ${dr.upperBottomIn.toFixed(1)} in above the floor; drawn at ${(runUpperBottom / 0.0254).toFixed(1)} in to clear the counter and ceiling.`);
    }
    const upperHNominalRun = dr.upperHeightIn != null ? inch(dr.upperHeightIn) : upperHNominal;
    const upperHRun = clamp(upperHNominalRun, inch(12), Math.max(inch(12), h - runUpperBottom - crownH - 0.01));
    const upperTop = dr.uppersToCeiling && dr.upperBottomIn === null
      ? Math.max(runUpperBottom + inch(12), rowCeiling)
      : Math.min(runUpperBottom + upperHRun, rowCeiling);
    const tallTop = dr.hasUppers ? upperTop : Math.min(h - crownH - 0.004, Math.max(inch(84), counterTopY + inch(36)));
    const tallDepth = baseDepth;

    // openings on this wall that cabinetry must not run through
    const cutsIn = (yLo: number, yHi: number, kinds?: KOpening['kind'][]): Span[] => mergeSpans(
      openings
        .filter((o) => o.wall === dr.wall
          && (!kinds || kinds.includes(o.kind))
          && o.sill < yHi - 0.02 && o.sill + o.height > yLo + 0.02)
        .map((o): Span => [o.x - o.width / 2 - inch(0.5), o.x + o.width / 2 + inch(0.5)]),
    );
    const doorCuts = cutsIn(0, carcassTop, ['door', 'passage']);
    // Tall-unit collisions use the nominal band, so a ceiling-only edit does
    // not change which window-side tall units are placed.
    const tallCuts = cutsIn(0, Math.min(h - 0.01, TALL_NOMINAL));

    // --- tall units first: they carve everything else
    const tallSpans: Span[] = [];
    const tall: KTall[] = [];
    dr.tall.forEach((t, ti) => {
      const wantW = t.kind === 'fridge-surround'
        ? Math.max(inch(t.widthIn), fridgeW + 2 * TALL_PANEL)
        : t.kind === 'oven-tower'
          ? Math.max(inch(t.widthIn), ovenW + 2 * inch(0.75))
          : inch(t.widthIn);
      const width = clamp(wantW, inch(12), Math.max(inch(12), span));
      let s0 = x0 + clamp(t.t, 0, 1) * span;
      s0 = clamp(s0, x0, Math.max(x0, x1 - width));
      let s1 = s0 + width;
      if (s1 > x1) { s1 = x1; s0 = Math.max(x0, s1 - width); }
      // never overlap a previously placed tall unit or a window / doorway
      const clear = (a: number, b: number) => {
        for (const [p0, p1] of tallSpans) if (a < p1 - 1e-3 && b > p0 + 1e-3) return false;
        for (const [p0, p1] of tallCuts) if (a < p1 - 1e-3 && b > p0 + 1e-3) return false;
        return true;
      };
      if (!clear(s0, s1)) return;
      // A sliver narrower than a cabinet between the run's end and a tall
      // unit is a scribe nobody builds (a pantry "7 in from the corner" is a
      // pantry in the corner): the unit goes to the end — to both when the
      // run is barely wider than it. Kept only where it stays clear.
      const lead = s0 - x0 < MIN_CAB, trail = x1 - s1 < MIN_CAB;
      if (lead || trail) {
        const [n0, n1]: Span = lead && trail ? [x0, x1] : lead ? [x0, x0 + width] : [x1 - width, x1];
        if (clear(n0, n1)) { s0 = n0; s1 = n1; }
      }
      tallSpans.push([s0, s1]);
      const openingW = t.kind === 'fridge-surround' ? Math.max(inch(18), s1 - s0 - 2 * TALL_PANEL) : 0;
      tall.push({
        id: `${dr.id}-tall-${ti}`, kind: t.kind,
        x0: s0, x1: s1, width: s1 - s0, cx: (s0 + s1) / 2,
        // a unit the photo showed meeting the ceiling goes there whatever the
        // run's uppers do (a pantry beside a 30" row still runs to the crown)
        top: t.toCeiling === true ? Math.max(tallTop, h - crownH - 0.004) : tallTop,
        depth: t.kind === 'fridge-surround' ? Math.max(tallDepth, Math.min(fridgeD, inch(25))) : tallDepth,
        openingW,
        openingH: t.kind === 'fridge-surround' ? Math.min(tallTop - inch(2), fridgeH + inch(0.5)) : 0,
        filled: false,
      });
    });
    tallSpans.sort((p, q) => p[0] - q[0]);

    // --- base row: declared widths, flowing round the talls and doorways;
    //     the run grows to the cabinets (up to xEnd) or fills up to its
    //     declared end with a tolerance stretch and an honest filler
    const baseReserved = [...tallSpans, ...doorCuts];
    const flowed = flowRow(dr.base, x0, xEnd, baseReserved, MIN_CAB, 'filler');
    const tallEnd = tallSpans.reduce((m, [, b]) => Math.max(m, b), x0);
    x1 = Math.min(xEnd, Math.max(x1, flowed.end, tallEnd));
    const base: KBase[] = fillRowGaps(flowed.row, x0, x1, baseReserved, 'filler').map((b, i) => ({
      id: `${dr.id}-b${i}`,
      type: b.type as KBaseType,
      x0: b.x0, x1: b.x1, width: b.width, cx: b.cx,
      drawerCount: b.drawerCount,
      filledBy: null,
      apronH: 0,
    }));

    // Each tier is fitted against its own vertical band. A window through the
    // lower doors must not reserve the transom row above it. When the declared
    // band has enough height above an opening for a real box, retain that
    // span and cut only the opening's volume after each box has its height.
    let uppers: KUpper[] = [];
    let upperSplit: number | null = null;
    if (dr.hasUppers && dr.uppers.length) {
      const rowIn = (upperTop - runUpperBottom) / 0.0254;
      // `hasUppers2` / `resolveUppers2HeightIn` read only the two rows' LENGTHS
      // and the declared height, so the draft's sanitised rows stand in for the
      // spec's — the vocabulary stays in one place (@/lib/spec/uppers).
      const stacked: StackedRunLike = {
        hasUppers: dr.hasUppers,
        uppers: dr.uppers.map(() => STACK_PROBE),
        uppers2: dr.uppers2.map(() => STACK_PROBE),
        uppers2HeightIn: dr.uppers2HeightIn,
      };
      const t2 = hasUppers2(stacked) ? inch(resolveUppers2HeightIn(rowIn, stacked)) : 0;
      /** where the two tiers meet — the rail line. `upperTop` when there is one tier. */
      const split = t2 > 0 ? upperTop - t2 : upperTop;
      if (t2 > 0) upperSplit = split;
      const rowOpenings = openings.filter((o) => o.wall === dr.wall);
      const reservedIn = (bottom: number, top: number, preserveAbove: boolean): Span[] => [
        ...tallSpans,
        ...rowOpenings.filter((o) => o.sill - inch(0.5) < top && o.sill + o.height + inch(0.5) > bottom
          && (!preserveAbove || o.kind !== 'window' || top - o.sill - o.height - inch(0.5) < MIN_CAB))
          .map((o): Span => [o.x - o.width / 2 - inch(0.5), o.x + o.width / 2 + inch(0.5)]),
      ];
      // For legacy single rows use the declared top for horizontal fitting:
      // a ceiling-only edit must not move the doors beside a window. The
      // actual fitted volumes are always clipped below, including low rooms.
      const topForFit = t2 > 0 ? split - TIER_RAIL_H / 2 : runUpperBottom + upperHNominalRun;
      // A legacy row lists the doors beside the window, with no observation
      // of a high row or shorter boxes. Keep that ordering stable; raising a
      // height slider alone is not evidence of extra cabinets over a window.
      // Repeating the row's full height on every door is still a conventional
      // row beside the window, not evidence of another band above its head.
      const preserveAbove = dr.upperBottomIn !== null || dr.uppers.some((u) => u.type !== 'hood-gap' && u.type !== 'appliance-gap'
        && u.heightIn != null && inch(u.heightIn) < upperHNominalRun - inch(0.5));
      const upperReserved = reservedIn(runUpperBottom, topForFit, preserveAbove);
      const flowedU = flowRow(dr.uppers, ux0, xEndU, upperReserved, MIN_CAB, 'filler');
      ux1 = Math.min(xEndU, Math.max(ux1, flowedU.end, tallEnd));
      const box = (tier: 1 | 2, top: number, floor: number, key: string) => (u: RowOut, i: number): KUpper => ({
        id: `${dr.id}-${key}${i}`,
        type: u.type as KUpperType,
        x0: u.x0, x1: u.x1, width: u.width, cx: u.cx,
        // a per-cabinet heightIn hangs the box from its TIER's top line, never
        // below the tier's own bottom; everything else fills the tier. Tier 2
        // has no per-box height: it IS the height, and `uppers2HeightIn` sets it.
        bottom: tier === 1 && u.heightIn != null ? Math.max(floor, top - inch(u.heightIn)) : floor,
        top,
        tier,
        contents: null,
        density: 'sparse' as const,
      });
      // The tiers stop half a rail short of the split line from each side, so
      // the whole 1.25 in band is visible between them instead of 0.24 in of it
      // peeping out between two door edges. `upperSplit` stays the rail's
      // CENTRE — that is what it means, and what the fitter and the checks read.
      const railHalf = t2 > 0 ? TIER_RAIL_H / 2 : 0;
      uppers = fillRowGaps(flowedU.row, ux0, ux1, upperReserved, 'filler').map(box(1, split - railHalf, runUpperBottom, 'u'));
      if (t2 > 0) {
        const tier2Reserved = reservedIn(split + railHalf, upperTop, true);
        const flowed2 = flowRow(dr.uppers2, ux0, xEndU, tier2Reserved, MIN_CAB, 'filler');
        uppers.push(...fillRowGaps(flowed2.row, ux0, ux1, tier2Reserved, 'filler').map(box(2, upperTop, split + railHalf, 'u2')));
      }
      uppers = carveUpperOpenings(uppers, rowOpenings);
    }

    runs.push({
      id: dr.id, wall: dr.wall, wallLen: wl,
      backsplash: dr.backsplash,
      x0, x1, length: x1 - x0, ux0, ux1,
      base, uppers, tall,
      hasUppers: dr.hasUppers && uppers.length > 0,
      upperBottom: runUpperBottom, upperTop, upperSplit, upperDepth,
      baseDepth, counterDepth,
      tallTop, tallDepth,
      pulledLo: dr.pullLo > 1e-4,
      pulledHi: dr.pullHi > 1e-4,
      counters: [], splash: [], underCab: [],
      rect: rectOnWall(dr.wall, w, d, (x0 + x1) / 2 + half, x1 - x0, Math.max(counterDepth, tall.length ? tall[0].depth : 0)),
    });
  }

  // ---- appliances -------------------------------------------------------
  const appliances: KAppliance[] = [];
  const claimedGaps = new Set<string>();
  const sorted = [...rawAppliances].sort((a, b) => {
    const ia = APP_ORDER.indexOf(pick<ApplianceKind>(a.kind, APPLIANCE_KINDS, 'fridge'));
    const ib = APP_ORDER.indexOf(pick<ApplianceKind>(b.kind, APPLIANCE_KINDS, 'fridge'));
    return ia - ib;
  });

  const runsOn = (wall: Wall) => runs.filter((r) => r.wall === wall);
  /** hoods whose `cabinetAbove` came from the spec rather than the style's
   *  default — an explicit word is never second-guessed by the neighbours */
  const hoodDeclared = new Set<string>();

  sorted.slice(0, 14).forEach((a, i) => {
    const kind = pick<ApplianceKind>(a.kind, APPLIANCE_KINDS, 'fridge');
    const finish = pick<Appliance['finish']>(a.finish, FINISHES, 'stainless');
    let hoodStyle = pick(a.hoodStyle ?? undefined, HOOD_STYLES, 'chimney');
    let hoodShape = pick(a.hoodShape ?? undefined, HOOD_SHAPES, HOOD_SHAPE_DEFAULT[hoodStyle]);
    const fridgeStyle = pick(a.fridgeStyle ?? undefined, FRIDGE_STYLES, 'french-door');
    const bodyFinish = a.bodyFinish == null ? null : pick<Appliance['finish']>(a.bodyFinish, FINISHES, finish);
    if (kind === 'hood' && hoodStyle === 'none') return;
    let width = appWidth(a);
    const isIsland = a.wall === 'island';
    const wall = isIsland ? null : pick<Wall>(a.wall, WALLS, 'back');
    const wl = wall ? wallLength(wall, w, d) : 0;
    const tRaw = num(a.t, 0.5, 0, 1);
    let x = wall ? clamp(tRaw * wl, 0, wl) - wl / 2 : 0;
    let runId: string | null = null;

    if (wall) {
      const candidates = runsOn(wall);
      // fridge / wall-oven prefer their dedicated tall unit
      if (kind === 'fridge' || kind === 'wall-oven') {
        const wantKind: KTallKind = kind === 'fridge' ? 'fridge-surround' : 'oven-tower';
        let best: { run: KRun; t: KTall; dist: number } | null = null;
        for (const r of candidates) {
          for (const t of r.tall) {
            if (t.kind !== wantKind || t.filled) continue;
            const dist = Math.abs(t.cx - x);
            if (!best || dist < best.dist) best = { run: r, t, dist };
          }
        }
        if (best && best.dist < Math.max(1.6, best.t.width)) {
          best.t.filled = true;
          runId = best.run.id;
          x = best.t.cx;
          if (kind === 'fridge') width = Math.min(width, Math.max(inch(18), best.t.openingW));
          else width = Math.min(width, best.t.width - inch(1.5));
        }
      }
      // otherwise snap into the nearest compatible appliance gap
      if (!runId && kind !== 'hood' && kind !== 'microwave' && kind !== 'cooktop') {
        let best: { run: KRun; slot: KBase; dist: number } | null = null;
        for (const r of candidates) {
          for (const b of r.base) {
            if (b.type !== 'appliance-gap' || claimedGaps.has(b.id)) continue;
            if (b.width < width - inch(2) && b.width < inch(15)) continue;
            if (b.width > width + inch(18)) continue;
            const dist = Math.abs(b.cx - x);
            if (!best || dist < best.dist) best = { run: r, slot: b, dist };
          }
        }
        if (best && best.dist < 1.6) {
          claimedGaps.add(best.slot.id);
          best.slot.filledBy = kind;
          runId = best.run.id;
          x = best.slot.cx;
          width = Math.abs(best.slot.width - width) < inch(7) ? Math.max(inch(12), best.slot.width - inch(0.5)) : Math.min(width, best.slot.width - inch(0.5));
        }
      }
      const snapped = runId !== null;
      if (!runId) {
        const r = candidates[0];
        if (r) runId = r.id;
      }
      if (kind === 'hood') {
        // The hood belongs to the row that can carry its cabinet, not to
        // whichever run happens to be declared first on this wall (the marble
        // fixture: run-back-main, not run-back-fridge). Measured at the cooker
        // it follows, because that is where the canopy ends up.
        const cooker = appliances.find((p) => (p.kind === 'range' || p.kind === 'cooktop') && p.wall === wall);
        const hx = cooker ? cooker.x : x;
        const host = candidates.find((r) => r.hasUppers && hx > r.ux0 - MIN_CAB && hx < r.ux1 + MIN_CAB)
          ?? candidates.find((r) => r.hasUppers);
        if (host) runId = host.id;
      }
      x = clamp(x, -wl / 2 + width / 2, wl / 2 - width / 2);
      // A unit that found no gap and lands inside a tall unit (the analyzer's
      // `t` drifted into the fridge column — the marble client photo did
      // exactly this with its range) slides to the nearest clear floor beside
      // it: nothing cooks inside a pantry. Deterministic in the declared `t`,
      // so only this unit (and the hood that follows it) moves.
      if (!snapped) {
        const lo = -wl / 2 + width / 2, hi = wl / 2 - width / 2;
        for (const r of candidates) {
          for (const t of r.tall) {
            if (x - width / 2 >= t.x1 - 0.01 || x + width / 2 <= t.x0 + 0.01) continue;
            const left = t.x0 - width / 2, right = t.x1 + width / 2;
            const canL = left >= lo, canR = right <= hi;
            x = canL && canR ? (x - left <= right - x ? left : right) : canL ? left : canR ? right : x;
          }
        }
      }
    }

    const run = runs.find((r) => r.id === runId) ?? null;
    const measuredUpperBottom = !!run && drafts.some((r) => r.id === run.id && r.upperBottomIn !== null);

    // THE HOOD SAFETY NET, on the numbers the layout is about to draw (the rule
    // and its thresholds live in `@/lib/spec/hood`). `reconcile.ts` writes the
    // same answer into the spec before the fitter runs; this is the same rule
    // applied to whatever spec actually reached the scene — a persisted project,
    // a share link, a fixture — so a hood the analyzer called 'none' can never
    // draw 26 in of bare wall framed by cabinetry. A spec that has been through
    // the reconciler already says 'doors' here and nothing fires.
    // …and one term the spec-level net does not carry: the row must run to the
    // ceiling. In `reconcile.ts` an explicit 'none' is the analyzer's mis-read
    // and is there to be overridden; HERE it is what the spec in front of the
    // scene actually says, and the only case where bare wall over a hood is
    // certainly wrong is the one ACCEPTANCE §5 names — "nothing above a hood
    // may be bare wall WHEN THE RUN'S UPPERS REACH THE CEILING". Under a row
    // that stops short, the wall above the row is bare anyway and a hood
    // standing in front of it is an ordinary kitchen.
    if (kind === 'hood' && !isIsland && run && run.hasUppers && (h - run.upperTop) / 0.0254 <= 12) {
      const rowIn = (run.upperTop - run.upperBottom) / 0.0254;
      const canopyIn = canopyHeightIn({ ...a, hoodShape, hoodStyle });
      const mouthIn = Number.isFinite(a.aboveCounterIn) && (a.aboveCounterIn as number) > 0 ? (a.aboveCounterIn as number) : 30;
      const metalIn = Number.isFinite(a.heightIn) ? (a.heightIn as number) : null;
      // the same arithmetic as `hoodCabinetBandIn`, over the DRAWN row
      const flueIn = metalIn !== null && metalIn > canopyIn ? metalIn - canopyIn : 0;
      const clearanceIn = (run.upperBottom - counterTopY) / 0.0254;
      const bandIn = Math.max(0, rowIn - Math.max(0, mouthIn + canopyIn + flueIn - clearanceIn));
      const net = hoodCabinetNet({
        heightIn: metalIn, aboveCounterIn: mouthIn, rowIn, bandIn, clearanceIn,
        current: resolveCabinetAbove({ ...a, hoodStyle, hoodShape }, true),
      });
      if (net) {
        a = { ...a, cabinetAbove: net.cabinetAbove };
        if (net.slim) { hoodStyle = 'under-cabinet'; hoodShape = 'slim'; }
      }
    }

    const bDepth = run?.baseDepth ?? baseDepth;
    let depth = bDepth, height = carcassTop, y = 0, z = 0;
    switch (kind) {
      case 'fridge':
        // see `fridgeH` / `fridgeD` above — the surround was sized from the same numbers
        depth = fridgeStyle === 'built-in' ? bDepth : fridgeStyle === 'counter-depth' ? bDepth + inch(1) : inch(30);
        height = fridgeHeightFor(fridgeStyle, a.heightIn);
        // inside a surround the column can be no taller than the opening the
        // layout cut for it — the cabinet over it is real
        if (runId) {
          const sur = run?.tall.find((t) => t.kind === 'fridge-surround' && t.filled && Math.abs(t.cx - x) < 0.01);
          if (sur) height = Math.min(height, Math.max(inch(48), sur.openingH - inch(0.5)));
        }
        break;
      case 'range':
        depth = bDepth + inch(1);
        height = counterTopY;
        break;
      case 'cooktop':
        depth = Math.min(inch(21), bDepth - inch(2));
        height = inch(0.4);
        y = counterTopY - inch(0.1);
        break;
      case 'wall-oven':
        depth = bDepth - inch(1);
        height = inch(29);
        y = inch(30);
        break;
      case 'dishwasher':
        depth = bDepth - inch(1);
        height = carcassTop - inch(0.5);
        break;
      case 'microwave':
        depth = Math.max(inch(15), upperDepth + inch(3));
        height = inch(17);
        y = run?.upperBottom ?? upperBottom;
        break;
      case 'wine-fridge':
        depth = bDepth - inch(1);
        height = carcassTop - inch(0.5);
        break;
      case 'hood': {
        const partner = appliances.find((p) => (p.kind === 'range' || p.kind === 'cooktop') && p.wall === (isIsland ? 'island' : wall));
        if (partner) { x = partner.x; width = Math.max(width, partner.width); }
        // a slim insert lives under a wall cabinet whatever the style word said;
        // any other shape is a canopy at 30" over the cooktop with the uppers cut round it
        depth = hoodShape === 'slim' ? upperDepth : Math.min(inch(24), bDepth);
        // `height` is the CANOPY: a slim insert is 6", a sheet-metal or plaster
        // canopy 14–16", a wood box hood 18". The duct cover above is drawn to
        // the ceiling by the builder, not counted here.
        height = inch(canopyHeightIn({ ...a, hoodShape, hoodStyle }));
        // the mouth: the photo's height over the counter when it gave one
        // (20" is the floor — both client photos sat on the old 24" clamp and
        // both wanted lower), else 30" on a wall and 32" over an island; a slim
        // insert hangs off the uppers whatever the spec said, because that is
        // what it is bolted to. An "island" hood declared against a wall is
        // really a chimney hood.
        const mouth = Number.isFinite(a.aboveCounterIn) && (a.aboveCounterIn as number) > 0
          ? clamp(inch(a.aboveCounterIn as number), inch(20), inch(48))
          : inch(hoodStyle === 'island' && isIsland ? 32 : 30);
        y = hoodShape === 'slim'
          ? (run?.upperBottom ?? upperBottom) - (measuredUpperBottom ? height : 0)
          : counterTopY + mouth;
        break;
      }
    }
    z = depth;

    // final safety: keep the body inside the wall and under the ceiling even
    // after the hood inherited its partner's width
    if (wall) {
      width = clamp(width, inch(8), Math.max(inch(8), wl - inch(0.5)));
      const lo = -wl / 2 + width / 2, hi = wl / 2 - width / 2;
      x = lo <= hi ? clamp(x, lo, hi) : 0;
    }
    y = clamp(y, 0, Math.max(0, h - inch(4)));
    height = clamp(height, inch(2), Math.max(inch(2), h - y - inch(0.5)));
    depth = Math.max(inch(4), depth);

    // The top of the whole unit (see `KAppliance.top`) and what is built on it.
    //
    // The client: "above the vent, there are always cabinets but the 3d model
    // never renders them." When the hood sits under a row of wall cabinets the
    // band between the canopy and the crown is a real cabinet, not bare wall
    // and not a duct cover — so the hood unit ENDS at that cabinet's underside
    // and the flue only spans a visible gap (`heightIn` taller than the canopy).
    // With no cabinet the old behaviour is untouched: the cover telescopes to
    // the ceiling, or to the top of the uppers for a wood hood's chase.
    let top = y + height;
    let cabinetAbove: CabinetAbove = 'none';
    let cabinetBottom: number | null = null;
    if (kind === 'hood') {
      const rowTop = run && run.hasUppers ? run.upperTop : null;
      const span: Span = [x - width / 2 - 0.005, x + width / 2 + 0.005];
      const inRow = !isIsland && !!run && run.hasUppers
        && span[1] > run.ux0 + MIN_CAB && span[0] < Math.min(run.ux1, wallEndU(runs, run)) - MIN_CAB;
      const want = resolveCabinetAbove({ ...a, hoodStyle, hoodShape }, inRow);
      const canopyTop = y + height;
      if (hoodShape === 'slim') {
        top = canopyTop;                        // no flue: an insert hangs off the cabinet it is bolted to
        if (want !== 'none' && inRow) { cabinetAbove = want; cabinetBottom = canopyTop; }
      } else if (want !== 'none' && inRow && rowTop !== null) {
        // `heightIn` is canopy + VISIBLE duct cover, so it says where the
        // cabinet starts, not where the hood stops growing
        const wantBottom = Number.isFinite(a.heightIn) && (a.heightIn as number) > 0 ? y + inch(a.heightIn as number) : canopyTop;
        // never below the canopy (the cabinet would run through it) and never
        // so high that the band is a reveal — a canopy that already reaches the
        // crown line simply has nothing above it
        // A plain chase can descend below a separately measured high row.
        // Extending the metal to that row would recolor the observed chase.
        const floor = want === 'panel' ? canopyTop : Math.max(canopyTop, run?.upperBottom ?? upperBottom);
        const bottom = clamp(wantBottom, floor, Math.max(floor, rowTop - HOOD_CAB_MIN));
        if (rowTop - bottom >= HOOD_CAB_MIN - 1e-6) {
          cabinetAbove = rowTop - bottom >= HOOD_CAB_DOOR_MIN ? want : 'panel';
          cabinetBottom = bottom;
          top = bottom;
        }
      }
      if (cabinetAbove === 'none' && hoodShape !== 'slim') {
        const chase = hoodShape === 'wood-canopy' && !isIsland && run && run.hasUppers ? run.upperTop : h;
        top = Number.isFinite(a.heightIn) && (a.heightIn as number) > 0
          ? clamp(y + inch(a.heightIn as number), y + height, Math.max(y + height, h - 0.004))
          : Math.max(y + height, chase);
      }
    }

    const rect = wall && kind !== 'hood' && kind !== 'microwave' && kind !== 'cooktop'
      ? rectOnWall(wall, w, d, x + wl / 2, width, depth)
      : null;

    if (kind === 'hood' && (CABINET_ABOVE as readonly string[]).includes(a.cabinetAbove ?? '')) hoodDeclared.add(`app-${i}-${kind}`);

    appliances.push({
      id: `app-${i}-${kind}`,
      kind,
      wall: isIsland ? 'island' : (wall as Wall),
      x, t: tRaw, width, depth, height, y, top, z,
      finish,
      panelReady: finish === 'panel-ready',
      hoodStyle, hoodShape, cabinetAbove, cabinetBottom, fridgeStyle, bodyFinish, hasDispenser: a.hasDispenser === true,
      runId,
      rect,
    });
  });

  // A built-in that found no void is standing in FRONT of cabinetry: the demo
  // kitchen drew its dishwasher across a door and a sink base, client-marble
  // its range across a drawer bank — a cabinet nobody could open and, for the
  // dishwasher, the client's own promise 6 ("the twin must draw a
  // distinguishable dishwasher, not one hidden inside a cabinet"). The row
  // solver can drop a declared `appliance-gap` when a run is over-subscribed,
  // and the snap then has nothing to claim. On site the CABINETRY gives way,
  // so cut the void the appliance needs out of the row: trim the boxes it
  // lands on, drop the ones it swallows, and leave a real `appliance-gap`
  // behind. Nothing fires on a run whose gaps did their job.
  // A drop-in cooktop occupies the counter cutout, not the cabinet below it.
  const carves = new Set<ApplianceKind>(['dishwasher', 'range', 'wall-oven', 'wine-fridge']);
  for (const a of appliances) {
    if (a.wall === 'island' || !carves.has(a.kind)) continue;
    const r = runs.find((q) => q.id === a.runId);
    if (!r) continue;
    const lo = a.x - a.width / 2, hi = a.x + a.width / 2;
    const over = (b: KBase) => Math.min(b.x1, hi) - Math.max(b.x0, lo);
    if (r.base.some((b) => b.type === 'appliance-gap' && over(b) > a.width * 0.5)) continue;
    if (!r.base.some((b) => b.type !== 'appliance-gap' && over(b) > inch(1))) continue;
    const cut: KBase[] = [];
    /** a trimmed remnant; under a cabinet's minimum width it is a scribe, not a box */
    const part = (b: KBase, x0: number, x1: number, tag: string): KBase => ({
      ...b,
      id: `${b.id}-${tag}`,
      type: x1 - x0 >= MIN_CAB - 1e-6 ? b.type : 'filler',
      x0, x1, width: x1 - x0, cx: (x0 + x1) / 2,
      drawerCount: x1 - x0 >= MIN_CAB - 1e-6 ? b.drawerCount : 0,
    });
    for (const b of r.base) {
      if (b.type === 'appliance-gap' || over(b) <= 0) { cut.push(b); continue; }
      if (b.x0 < lo - 1e-6) cut.push(part(b, b.x0, lo, 'l'));
      if (b.x1 > hi + 1e-6) cut.push(part(b, hi, b.x1, 'r'));
    }
    cut.push({ id: `${a.id}-void`, type: 'appliance-gap', x0: lo, x1: hi, width: hi - lo, cx: a.x, drawerCount: 0, filledBy: a.kind, apronH: 0 });
    cut.sort((p, q) => p.x0 - q.x0);
    r.base = cut;
  }

  // unclaimed appliance gaps would read as holes in the run — make them doors
  for (const r of runs) {
    for (const b of r.base) {
      if (b.type === 'appliance-gap' && !b.filledBy) b.type = b.width >= inch(24) ? 'door' : 'filler';
    }
  }

  // ---- uppers round the appliances under them ---------------------------
  // A hood no longer carves the row's FULL height: with a cabinet on the
  // canopy the row keeps a real box there (bottom = the canopy, top = the
  // crown line), and only a hood with nothing above it leaves a void.
  /** the front a hood cabinet gets: an explicit word wins (the band gate has
   *  already demoted it to 'panel' if it had to); a DERIVED 'doors' turns to
   *  glass when both cabinets it lands between are glass */
  const frontFor = (a: KAppliance, r: KRun, at: Span): 'doors' | 'glass' | 'panel' => {
    const want = a.cabinetAbove === 'none' ? 'doors' : a.cabinetAbove;
    if (want !== 'doors' || hoodDeclared.has(a.id)) return want;
    // the nearest real cabinet each side — read before the carve, so a piece
    // the hood is about to cut in two is not counted as either neighbour
    const real = r.uppers.filter((u) => u.tier === 1 && (u.type === 'door' || u.type === 'glass') && (u.cx < at[0] || u.cx > at[1]));
    const lo = real.filter((u) => u.cx < at[0]).sort((p, q) => q.cx - p.cx)[0];
    const hi = real.filter((u) => u.cx > at[1]).sort((p, q) => p.cx - q.cx)[0];
    return lo && hi && lo.type === 'glass' && hi.type === 'glass' ? 'glass' : 'doors';
  };
  /** does this appliance's own body climb past the rail into the second tier? */
  const reaches2 = (r: KRun, a: KAppliance) => r.upperSplit === null || a.y + a.height > r.upperSplit + 0.01;
  /** what a declared void nothing landed under should have been: whatever its nearest real neighbour is */
  const neighbourType = (row: KUpper[], u: KUpper): KUpperType => {
    const real = row.filter((q) => q !== u && (q.type === 'door' || q.type === 'glass' || q.type === 'corner' || q.type === 'open-shelf'));
    if (!real.length) return 'door';
    const near = real.reduce((b, q) => (Math.abs(q.cx - u.cx) < Math.abs(b.cx - u.cx) ? q : b));
    return near.type === 'glass' ? 'glass' : 'door';
  };

  for (const r of runs) {
    if (!r.uppers.length) continue;
    /** what is cut out of tier 1 — the row that sits on the counter */
    const cuts: Span[] = [];
    /** …and out of tier 2, which only what reaches PAST the rail may touch. A
     *  hood with a cabinet on it is closed off below the rail and the transom
     *  runs straight over it; a bare flue really does pass through both. */
    const cuts2: Span[] = [];
    const pieces: KUpper[] = [];
    for (const a of appliances) {
      if (a.wall !== r.wall) continue;
      const span: Span = [a.x - a.width / 2 - 0.005, a.x + a.width / 2 + 0.005];
      if (a.kind === 'hood') {
        if (a.runId !== r.id) continue;
        if (a.hoodShape === 'slim') {
          // an insert is bolted UNDER a cabinet: never cut one away for it. A
          // void declared over it IS the cabinet it hangs from — converted in place.
          if (a.cabinetAbove === 'none') continue;
          r.uppers = r.uppers.map((u) => (u.tier === 1 && (u.type === 'hood-gap' || u.type === 'appliance-gap') && overlaps(u, span, 0.01)
            ? { ...u, type: 'hood-cabinet' as const, bottom: Math.min(a.cabinetBottom!, u.top - HOOD_CAB_MIN), hood: { id: a.id, front: frontFor(a, r, [u.x0, u.x1]) } }
            : u));
          continue;
        }
        const clipped: Span = [Math.max(span[0], r.ux0), Math.min(span[1], wallEndU(runs, r))];
        if (clipped[1] - clipped[0] < MIN_CAB) continue;
        const mid = (clipped[0] + clipped[1]) / 2;
        const measuredRow = drafts.some((d) => d.id === r.id && d.upperBottomIn !== null);
        const closedSpans = mergeSpans(r.uppers.filter((u) => u.tier === 1 && u.bottom <= r.upperBottom + 1e-4
          && (u.type === 'door' || u.type === 'glass' || u.type === 'corner')).map((u): Span => [u.x0, u.x1]));
        const closedAbove = closedSpans.some(([x0, x1]) => x0 <= clipped[0] + 1e-4 && x1 >= clipped[1] - 1e-4);
        if (measuredRow && closedAbove && a.cabinetAbove === 'panel' && a.cabinetBottom !== null
          && r.upperBottom - a.cabinetBottom >= HOOD_CAB_MIN) {
          // Two observed components: a plain chase below the row, then the
          // declared closed boxes above it. Do not erase their doors/knobs by
          // replacing both components with one full-height blank panel.
          pieces.push({
            id: `${r.id}-hood-chase`, type: 'hood-cabinet', x0: clipped[0], x1: clipped[1], width: clipped[1] - clipped[0], cx: mid,
            bottom: a.cabinetBottom, top: r.upperBottom, tier: 1,
            hood: { id: a.id, front: 'panel' }, contents: null, density: 'sparse',
          });
          continue;
        }
        cuts.push(clipped);
        // The box on the canopy belongs to the tier it SITS IN: where a second
        // tier is drawn and the canopy stops below the rail, tier 1 carries the
        // hood cabinet and tier 2 runs over it like any other box. Only where
        // the canopy pushes past the rail does the piece take the whole row.
        const hoodTier: 1 | 2 = r.upperSplit !== null && a.cabinetBottom !== null && a.cabinetBottom >= r.upperSplit - MIN_CAB ? 2 : 1;
        // …and it stops under the rail like every other tier-1 box
        const hoodTop = r.upperSplit !== null && hoodTier === 1 ? r.upperSplit - TIER_RAIL_H / 2 : r.upperTop;
        pieces.push(a.cabinetAbove !== 'none'
          ? {
            id: `${r.id}-hood`, type: 'hood-cabinet', x0: clipped[0], x1: clipped[1], width: clipped[1] - clipped[0], cx: mid,
            bottom: Math.min(a.cabinetBottom!, hoodTop - HOOD_CAB_MIN), top: hoodTop, tier: hoodTier,
            hood: { id: a.id, front: frontFor(a, r, clipped) }, contents: null, density: 'sparse',
          }
          : {
            id: `${r.id}-hoodgap`, type: 'hood-gap', x0: clipped[0], x1: clipped[1], width: clipped[1] - clipped[0], cx: mid,
            bottom: r.upperBottom, top: r.upperTop, tier: 1, contents: null, density: 'sparse',
          });
        // A bare flue climbs through the whole row. A cabinet on the canopy
        // stops it at the rail — UNLESS the canopy itself pushes up near the
        // rail, in which case the one box over the hood takes both tiers and
        // the transom has to give way to it. Either way tier 2 is only cut
        // where something really occupies it.
        if (a.cabinetAbove === 'none' || hoodTier === 2) cuts2.push(clipped);
      } else if (a.kind === 'fridge' && !a.runId) { cuts.push(span); if (reaches2(r, a)) cuts2.push(span); }
      else if (a.kind === 'microwave') { cuts.push(span); if (reaches2(r, a)) cuts2.push(span); }
      else if (a.kind === 'fridge' && a.y + a.height > r.upperBottom) { cuts.push(span); if (reaches2(r, a)) cuts2.push(span); }
    }
    if (cuts.length || cuts2.length) {
      const t1 = carveRow(r.uppers.filter((u) => u.tier === 1), mergeSpans(cuts), MIN_CAB, upperFiller);
      const t2 = carveRow(r.uppers.filter((u) => u.tier === 2), mergeSpans(cuts2), MIN_CAB, upperFiller);
      r.uppers = [...t1, ...t2];
    }
    if (pieces.length) {
      r.uppers = [...r.uppers, ...pieces].sort((p, q) => (p.tier - q.tier) || (p.x0 - q.x0));
      r.ux0 = Math.min(r.ux0, ...pieces.map((p) => p.x0));
      r.ux1 = Math.max(r.ux1, ...pieces.map((p) => p.x1));
    }
    // A declared void nothing landed under is a cabinet the analyzer
    // mis-placed, not a hole in the wall. (The cause is the reconciler laying
    // gaps by declared ORDER rather than position — not this file's to fix, so
    // the row heals the symptom here and says so.)
    // A wide one becomes the cabinet its neighbours are; a sliver left over
    // from a carve is a scribe filler, never a hole — the base row has had the
    // same rule for unclaimed gaps for as long as it has existed.
    r.uppers = r.uppers.map((u) => ((u.type === 'hood-gap' || u.type === 'appliance-gap')
      && !(u.tier === 1 ? cuts : cuts2).some((c) => overlaps(u, c, 0.01))
      ? { ...u, type: u.width >= inch(12) ? neighbourType(r.uppers.filter((q) => q.tier === u.tier), u) : 'filler' }
      : u));
  }

  // ---- countertops, backsplash, under-cabinet lighting ------------------
  for (const r of runs) {
    const tallSpans = r.tall.map((t): Span => [t.x0, t.x1]);
    const breaks: Span[] = [...tallSpans];
    for (const a of appliances) {
      if (a.wall !== r.wall) continue;
      if (a.kind === 'range') breaks.push([a.x - a.width / 2, a.x + a.width / 2]);
      if (a.kind === 'fridge' && !r.tall.some((t) => t.kind === 'fridge-surround' && Math.abs(t.cx - a.x) < t.width)) {
        breaks.push([a.x - a.width / 2 - inch(0.5), a.x + a.width / 2 + inch(0.5)]);
      }
    }
    // a doorway inside the run also breaks the slab
    for (const o of openings) {
      if (o.wall !== r.wall || o.kind === 'window') continue;
      breaks.push([o.x - o.width / 2 - inch(0.5), o.x + o.width / 2 + inch(0.5)]);
    }
    // no end overhang where a neighbouring run's slab already covers the corner
    const atLoWall = r.x0 <= -r.wallLen / 2 + 0.01 || r.pulledLo;
    const atHiWall = r.x1 >= r.wallLen / 2 - 0.01 || r.pulledHi;
    const cx0 = atLoWall ? r.x0 : r.x0 - END_OVERHANG;
    const cx1 = atHiWall ? r.x1 : r.x1 + END_OVERHANG;
    r.counters = subtractIntervals(cx0, cx1, mergeSpans(breaks));

    // backsplash — see the semantics block at the top of counters.ts
    if (backsplash.present && r.backsplash) {
      // with no wall cabinets, full height means the CEILING (stopping under
      // the room crown when the style has one), not an arbitrary 30"
      const ceilingTop = h - (ceilingCrown > 0 ? ceilingCrown + 0.004 : 0.006);
      // a measured height beats the 3-value category everywhere the field is drawn
      const normalTop = splashHeightIn > 0
        ? Math.min(counterTopY + inch(splashHeightIn), ceilingTop)
        : backsplash.height === 'ledge'
          ? counterTopY + inch(6)
          : backsplash.height === 'full-height'
            ? (r.hasUppers ? r.upperBottom : ceilingTop)
            : Math.min(counterTopY + inch(18), r.hasUppers ? r.upperBottom : counterTopY + inch(22));
      // Behind the range: a full-height field goes to the ceiling (the duct
      // cover stands in front of it). A 'full-height' behindRange on an
      // otherwise standard splash is the feature slab under the hood — it runs
      // up to the canopy's underside and stops there, hidden by the lip, while
      // the rest of the run keeps its height.
      const hoodOnRun = appliances.find((a) => a.wall === r.wall && a.kind === 'hood');
      // a cabinet sitting on the canopy stops the field at its underside —
      // tile behind a closed box is tile nobody buys
      const hoodCab = !!hoodOnRun && hoodOnRun.cabinetBottom !== null && hoodOnRun.hoodShape !== 'slim';
      // "i need everything to be covered." A MEASURED `heightIn` is a reading
      // of where the field stops on a PLAIN run; it may never demote the
      // full-height CATEGORY behind the range, which is what the old
      // `splashHeightIn > 0` short-circuit did — the same photo that measured
      // 28 in is the one whose assumption list says "full-height slab …
      // continuous behind the range", and the twin answered with 1.08 m ×
      // 1.12 m of bare painted wall in the hood bay. Behind the hood a
      // full-height field runs to whatever CLOSES it: the cabinet on the
      // canopy, else the top of the wall-cabinet row where a number really was
      // measured (a measurement is evidence against the ceiling), else the
      // ceiling, which is what the bare category has always meant.
      // A 'full-height' behindRange on an otherwise standard splash is a
      // different thing — the feature slab under the hood — and is untouched.
      const hoodTop = backsplash.height === 'full-height'
        ? (hoodCab
          ? hoodOnRun!.cabinetBottom! + inch(0.5)
          : splashHeightIn > 0
            // a measured number stands where there is no cabinetry to close the
            // field against; where there IS a row, the slab reaches it
            ? (hoodOnRun && r.hasUppers ? Math.max(normalTop, r.upperTop) : normalTop)
            : ceilingTop)
        : splashHeightIn > 0
          ? (backsplash.behindRange === 'full-height' && hoodOnRun ? Math.max(normalTop, hoodOnRun.y + inch(0.5)) : normalTop)
          : backsplash.behindRange === 'full-height'
            ? Math.max(normalTop, hoodOnRun ? hoodOnRun.y + inch(0.5) : (r.hasUppers ? r.upperBottom : ceilingTop))
            : normalTop;
      const fieldTop = Math.max(normalTop, hoodTop);
      const blockers: Span[] = [...tallSpans];
      // a window inside the tile band splits the field: the tile stops under
      // its sill and (when the field goes to the ceiling) resumes over its head
      const windowsIn = openings.filter((o) => o.wall === r.wall && o.kind === 'window' && o.sill < fieldTop - 0.02);
      for (const o of openings) {
        if (o.wall !== r.wall) continue;
        if (o.kind === 'window' && o.sill >= fieldTop - 0.02) continue;
        blockers.push([o.x - o.width / 2 - inch(0.5), o.x + o.width / 2 + inch(0.5)]);
      }
      for (const a of appliances) {
        if (a.wall !== r.wall) continue;
        if (a.kind === 'fridge') blockers.push([a.x - a.width / 2, a.x + a.width / 2]);
      }
      const segs = subtractIntervals(r.x0, r.x1, mergeSpans(blockers));
      const hoodSpans = mergeSpans(r.uppers.filter((u) => u.tier === 1 && u.type === 'hood-gap').map((u): Span => [u.x0, u.x1]).concat(
        // half an inch past the canopy each side so the feature slab is never narrower than the hood over it
        appliances.filter((a) => a.wall === r.wall && a.kind === 'hood' && a.hoodShape !== 'slim').map((a): Span => [a.x - a.width / 2 - inch(0.5), a.x + a.width / 2 + inch(0.5)]),
      ));
      const inHood = intersectIntervals(segs, hoodSpans);
      const outHood = subtractIntervals(r.x0, r.x1, mergeSpans([...blockers, ...hoodSpans]));
      const aroundWindow: KSplash[] = [];
      for (const o of windowsIn) {
        const a0 = Math.max(r.x0, o.x - o.width / 2 - inch(0.5));
        const a1 = Math.min(r.x1, o.x + o.width / 2 + inch(0.5));
        if (a1 - a0 <= 0.05) continue;
        const under = Math.min(normalTop, o.sill - inch(0.5));
        if (under > counterTopY + inch(1.5)) aroundWindow.push({ x0: a0, x1: a1, top: under, bottom: counterTopY });
        const head = o.sill + o.height + inch(0.5);
        if (backsplash.height === 'full-height' && normalTop - head > 0.06) aroundWindow.push({ x0: a0, x1: a1, top: normalTop, bottom: head });
      }
      // ONE SLAB IS ONE MESH. Each piece is drawn as its own chamfered box
      // standing 10 mm proud of the wall, so three abutting pieces at the same
      // top gave two 1.6 mm V-grooves and two shading seams across a wall the
      // photo shows as unbroken stone — literally the client's "why is it like
      // in squares". Pieces that touch and share both edges are one piece.
      const pieces = [
        ...outHood.map(([a0, a1]) => ({ x0: a0, x1: a1, top: normalTop, bottom: counterTopY })),
        ...inHood.map(([a0, a1]) => ({ x0: a0, x1: a1, top: hoodTop, bottom: counterTopY })),
        ...aroundWindow,
      ].filter((sp) => sp.top > sp.bottom + 0.02).sort((p, q) => p.x0 - q.x0 || p.bottom - q.bottom);
      const merged: KSplash[] = [];
      for (const sp of pieces) {
        const last = merged[merged.length - 1];
        if (last && sp.x0 - last.x1 < 1e-3 && Math.abs(sp.top - last.top) < 1e-3 && Math.abs(sp.bottom - last.bottom) < 1e-3) last.x1 = Math.max(last.x1, sp.x1);
        else merged.push({ ...sp });
      }
      r.splash = merged;
    }

    // under-cabinet strips follow the wall cabinets that actually have a bottom
    if (r.hasUppers) {
      // under-cabinet lighting goes under the row that sits on the counter, never under a transom
      const lit = r.uppers.filter((u) => u.tier === 1 && (u.type === 'door' || u.type === 'glass' || u.type === 'corner' || u.type === 'open-shelf'));
      const bands = new Map<number, Span[]>();
      for (const u of lit) {
        const y = Math.round(u.bottom * 1e5) / 1e5;
        const spans = bands.get(y) ?? [];
        spans.push([u.x0 + 0.02, u.x1 - 0.02]);
        bands.set(y, spans);
      }
      r.underCab = [...bands].flatMap(([y, spans]) => mergeSpans(spans)
        .filter(([a0, a1]) => a1 - a0 > 0.15).map(([a0, a1]): [number, number, number] => [a0, a1, y]));
    }
  }

  // ---- how deep each wall is occupied -----------------------------------
  const inset: Record<Wall, number> = { back: 0, left: 0, right: 0, front: 0 };
  for (const r of runs) {
    inset[r.wall] = Math.max(inset[r.wall], r.counterDepth, ...r.tall.map((t) => t.depth));
  }
  for (const a of appliances) {
    if (a.wall === 'island') continue;
    inset[a.wall] = Math.max(inset[a.wall], a.kind === 'fridge' ? a.depth : 0);
  }

  // ---- island -----------------------------------------------------------
  const hasRun: Record<Wall, boolean> = { back: false, left: false, right: false, front: false };
  for (const r of runs) hasRun[r.wall] = true;
  // The island's declared LENGTH is drawn whenever the floor can hold it,
  // whether or not the photo cut its box. Gating that on frame-truncation drew
  // client-marble-items' declared 5.5 ft island as a 2.51 ft stub — the exact
  // "in the 3d render its js a square small island" the client complained
  // about — because that fixture's box happens not to be cut. A length is a
  // MEASUREMENT and an anchor is a position derived from one, so where the two
  // disagree the length wins and the body moves; see `buildIsland`.
  const island = buildIsland(spec.island, {
    w, d, inset, hasRun, carcassTop, counterT, counterTopY,
  });

  // island appliances are anchored along the island's long axis (or dropped
  // entirely when the spec asked for an island that could not be built)
  for (let i = appliances.length - 1; i >= 0; i--) {
    const a = appliances[i];
    if (a.wall !== 'island') continue;
    if (!island) { appliances.splice(i, 1); continue; }
    a.width = Math.min(a.width, Math.max(inch(8), island.len - inch(4)));
    const lo = -island.len / 2 + a.width / 2, hi = island.len / 2 - a.width / 2;
    a.x = lo <= hi ? clamp((a.t - 0.5) * island.len, lo, hi) : 0;
  }

  // ---- sink -------------------------------------------------------------
  const sink = buildSink(spec.sink, { runs, island, openings, w, d, counterTopY, carcassTop, toeKick });

  // ---- collision footprints --------------------------------------------
  const rects: Rect[] = runs.map((r) => r.rect);
  for (const a of appliances) if (a.rect) rects.push(a.rect);
  if (island) rects.push(island.rect);

  // ---- décor ------------------------------------------------------------
  const mats = (spec.materials ?? {}) as Partial<KitchenSpec['materials']>;
  const decor = buildDecor(spec.decor, {
    w, d, h, style, doorStyle, runs, openings, appliances, island, sink, rects, inset,
    counterTopY, counterT, ceilingCrown,
    cabinetHex: CATALOG_BY_ID[String(mats.cabinets_base ?? '')]?.pbr.color,
  });
  decor.warnings.push(...geometryWarnings);

  return {
    w, d, h, widthFt, depthFt, ceilingFt,
    scanGeometry: spec.scanGeometry,
    style, layout, doorStyle,
    twoTone: cs.twoTone === true,
    hardware, crown, crownH, ceilingCrown, toeKick,
    baseDepth, upperDepth, carcassTop, counterT, counterTopY, upperBottom,
    edge, backsplash, openings, runs, island, appliances, sink, lighting, decor,
    rects, inset,
  };
}

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------
/**
 * The island — and the one place a "resize" used to turn into a "move".
 *
 * THE RULE: an edit to a dimension changes ONLY that dimension.
 *
 * The old solver clamped the island's CENTRE against bounds derived from its
 * CURRENT size, so dragging length or width translated the whole island (and,
 * because the seating side was re-derived from whichever side of the FITTED
 * body had more floor, the stools flipped to the other face on the way). Every
 * pendant, stool and cut-out hanging off the island moved with it.
 *
 * Now:
 *  - the ANCHOR is the declared centre, clamped only against bounds that are
 *    functions of the ROOM and the CABINETRY (never of len / wide / overhang),
 *    so no island slider can move it;
 *  - when the island does not fit, the SIZE is clamped about that fixed anchor,
 *    never the position;
 *  - the seating side is STICKY: it is decided from the declared spec (which
 *    walls own cabinet runs, which way the island is rotated) and the anchor,
 *    so it cannot flip when a slider moves one notch.
 *
 * Two clearances are used on purpose. WALKWAY (36") is the *preferred* aisle and
 * only ever constrains the ANCHOR; MIN_AISLE (24") is the hard one and is what
 * the SIZE is clamped against. That keeps a legitimately snug kitchen from
 * silently deleting its island while still parking it in a sensible spot.
 */
/** the top's overhang on the NON-seating long side — always a scribe 1.5" */
const ISLAND_SIDE_SCRIBE = inch(1.5);

/**
 * The COUNTERTOP an island spec asks for, in FEET — `topLen × topWide`, the
 * slab `buildIsland` draws, the block a photo outlines and the thing the
 * client points at when they say "island".
 *
 * It is not `lengthFt × widthFt`. The seating overhang and the 1.5" scribe
 * are ADDED to the declared body, so the spec's own numbers hide the shape of
 * what gets drawn: client-tan declares 5.0 × 4.1 ft (a sane 1.22 ratio) and
 * the layout draws a top 5.00 ft long and 5.22 ft DEEP — deeper than it is
 * long, which is the client's "its js a square small island". A rule about an
 * island's SHAPE (`implausibility`) has to read it here, or the foot of
 * overhang walks straight past it.
 *
 * The ROOM's clamps are deliberately not applied: this is what the spec ASKS
 * for, which is what a gate on the spec must judge. `check-kitchen` pins it
 * to the layout's own `topLen`/`topWide` on specs the room does not clamp, so
 * the two formulas cannot drift apart.
 */
export function islandTopFt(isl: KitchenSpec['island'] | null | undefined): { len: number; wide: number } | null {
  if (!isl || typeof isl !== 'object' || isl.present !== true) return null;
  const len = clamp(ft(num(isl.lengthFt, 6, 2, 30)), inch(30), 12);
  const wide = clamp(ft(num(isl.widthFt, 3.5, 1.5, 12)), inch(20), 3);
  const overhang = clamp(inch(num(isl.overhangIn, 12, 0, 24)), 0, inch(20));
  const endOH = inch(num(isl.endOverhangIn, 1.5, 0, 18));
  return { len: (len + 2 * endOH) / ft(1), wide: (wide + ISLAND_SIDE_SCRIBE + overhang) / ft(1) };
}

function buildIsland(
  raw: KitchenSpec['island'] | undefined,
  ctx: {
    w: number; d: number; inset: Record<Wall, number>; hasRun: Record<Wall, boolean>;
    carcassTop: number; counterT: number; counterTopY: number;
  },
): KIsland | null {
  const isl = (raw ?? {}) as Partial<KitchenSpec['island']>;
  if (isl.present !== true) return null;
  const { w, d, inset, hasRun, carcassTop, counterT, counterTopY } = ctx;
  const kind = pick<KIsland['kind']>(isl.kind, ['island', 'peninsula', 'breakfast-bar'], 'island');
  const rot: 0 | 90 = num(isl.rotationDeg, 0, 0, 90) >= 45 ? 90 : 0;
  const yaw = rot === 90 ? Math.PI / 2 : 0;
  const wantLen = clamp(ft(num(isl.lengthFt, 6, 2, 30)), inch(30), 12);
  const wantWide = clamp(ft(num(isl.widthFt, 3.5, 1.5, 12)), inch(20), 3);
  const overhang = clamp(inch(num(isl.overhangIn, 12, 0, 24)), 0, inch(20));
  const waterfall = isl.waterfall === true;
  const sideOH = ISLAND_SIDE_SCRIBE;
  /** the top's overhang at each SHORT end. A photo that shows the slab
   *  cantilevered 12" past the last door is a photo of stools tucked under it. */
  const endOH = inch(num(isl.endOverhangIn, 1.5, 0, 18));
  const MIN_LEN = inch(30), MIN_WIDE = inch(20);

  // --- size-independent bounds -------------------------------------------
  // hard = the floor the cabinetry does not already own.
  const hardMinX = -w / 2 + inset.left;
  const hardMaxX = w / 2 - inset.right;
  const hardMinZ = -d / 2 + inset.back;
  const hardMaxZ = d / 2 - inset.front;
  const band = (lo: number, hi: number, relief: number): [number, number] => {
    const a = lo + relief, b = hi - relief;
    return b - a >= inch(20) ? [a, b] : [lo, hi];
  };
  const aisle = kind === 'peninsula' ? 0 : MIN_AISLE;
  const walk = kind === 'peninsula' ? 0 : WALKWAY;
  // what the SIZE may occupy
  const [sizeMinX, sizeMaxX] = band(hardMinX, hardMaxX, aisle);
  const [sizeMinZ, sizeMaxZ] = band(hardMinZ, hardMaxZ, aisle);
  // where the ANCHOR may sit (preferred walkway; falls back to the size band)
  const [anchMinX, anchMaxX] = band(sizeMinX, sizeMaxX, Math.max(0, walk - aisle));
  const [anchMinZ, anchMaxZ] = band(sizeMinZ, sizeMaxZ, Math.max(0, walk - aisle));

  const fit = (v: number, lo: number, hi: number) => (lo <= hi ? clamp(v, lo, hi) : (lo + hi) / 2);
  // THE ANCHOR. Nothing below this line may write to cx / cz.
  const cx = fit(ft(num(isl.offset?.x, 0, -40, 40)), anchMinX, anchMaxX);
  const cz = fit(ft(num(isl.offset?.z, 0, -40, 40)), anchMinZ, anchMaxZ);

  // --- sticky seating side ------------------------------------------------
  // Measured from the ANCHOR and the room, never from the fitted body, so a
  // width or length nudge cannot swing the stools round to the other face.
  const facePlus: Wall = rot === 0 ? 'front' : 'right';
  const faceMinus: Wall = rot === 0 ? 'back' : 'left';
  const clearPlus = rot === 0 ? sizeMaxZ - cz : sizeMaxX - cx;
  const clearMinus = rot === 0 ? cz - sizeMinZ : cx - sizeMinX;
  const score = (clear: number, wall: Wall) => clear + (hasRun[wall] ? -0.9 : 0.45);
  const seatSide: 1 | -1 = score(clearPlus, facePlus) >= score(clearMinus, faceMinus) ? 1 : -1;

  // --- clamp the SIZE about the fixed anchor ------------------------------
  // Two tiers of clearance: the comfortable aisle first, then a last-resort 12"
  // squeeze. A tight room ends up with a SMALLER island, never a moved one and
  // never (unless it is truly impossible) a deleted one.
  const ohPlus = seatSide > 0 ? overhang : sideOH;
  const ohMinus = seatSide > 0 ? sideOH : overhang;
  const room = (relief: number) => {
    const [mnX, mxX] = band(hardMinX, hardMaxX, relief);
    const [mnZ, mxZ] = band(hardMinZ, hardMaxZ, relief);
    const alongLo = rot === 0 ? cx - mnX : cz - mnZ;
    const alongHi = rot === 0 ? mxX - cx : mxZ - cz;
    const acrossLo = rot === 0 ? cz - mnZ : cx - mnX;
    const acrossHi = rot === 0 ? mxZ - cz : mxX - cx;
    return {
      len: 2 * Math.min(alongLo, alongHi) - 2 * endOH,
      // the WHOLE clear run along the island's long axis, not just twice its
      // shorter half — see the slide below
      span: alongLo + alongHi - 2 * endOH,
      wide: 2 * Math.min(acrossLo - ohMinus, acrossHi - ohPlus),
      alongLo, alongHi,
    };
  };
  let cap = room(aisle);
  if (cap.len < MIN_LEN - 1e-4 || cap.wide < MIN_WIDE - 1e-4) cap = room(kind === 'peninsula' ? 0 : inch(12));
  if (cap.len < MIN_LEN - 1e-4 || cap.wide < MIN_WIDE - 1e-4) return null;
  // The length cap above is SYMMETRIC about the anchor (twice the shorter
  // half), so an island parked off-centre could never be longer than twice its
  // short side however much floor lay beyond the other end — the client's
  // "u see how long the island is… in the 3d render its js a square small
  // island". The ANCHOR still never moves: the seating side was already decided
  // from it, and every stool, pendant and cut-out is measured off the body it
  // produces. What may move is the BODY, along its own long axis only, and only
  // by as much as the declared length actually needs — so an island that fits
  // symmetrically comes out exactly where it always did. A length is a
  // MEASUREMENT and an anchor is a position derived from one, so where the two
  // disagree the length wins and the body moves.
  const len = Math.min(wantLen, cap.span);
  const wide = Math.min(wantWide, cap.wide);
  // The window the body may sit in, as a slide off the anchor: far enough + that
  // its low end clears the floor's low edge, far enough − that its high end
  // clears the high edge. Non-empty exactly because `len <= cap.span`, and the
  // body sits as close to the anchor as the window allows.
  //
  // NO DIRECTION IS CHOSEN HERE, and that is a measurement, not an oversight.
  // The obvious idea — "slide toward the end the photo cut, since that is the
  // end the picture could not measure" — has nothing to bite on: the window
  // either CONTAINS zero (the length fits about the anchor, so the body does
  // not move and the visible end stays exactly where the analyzer put it: on
  // client-tan the drawn right end lands at frame 0.478 against the photo's
  // 0.482) or lies entirely on one side of it (the length does not fit, and
  // there is only one direction with floor in it). `slideLo > 0` and
  // `slideHi < 0` cannot both hold, so clamping zero into the window IS the
  // whole rule. A cut-edge sign was built here and measured inert on every
  // fixture — cut-left and cut-right produced byte-identical geometry — so it
  // was removed rather than shipped as a mechanism that does nothing. Holding
  // the visible end while the LENGTH changes is a coupling between
  // `island.lengthFt` and `island.offset.x`, which only the fitter can express.
  const slideLo = len / 2 + endOH - cap.alongLo;
  const slideHi = cap.alongHi - endOH - len / 2;
  const slide = slideLo <= slideHi ? clamp(0, slideLo, slideHi) : 0;
  /** the drawn centre: the anchor, slid along the long axis when the length asked for it */
  const bx = rot === 0 ? cx + slide : cx;
  const bz = rot === 0 ? cz : cz + slide;

  const topLen = len + 2 * endOH;
  const topWide = wide + sideOH + overhang;
  const topOffset = seatSide * (overhang - sideOH) / 2;

  // --- the L: stools round the short end --------------------------------
  // Three or more stools on a real island are rarely in a row — one or two go
  // round the clear end. The end is picked from the ANCHOR and the room (the
  // side with more floor beyond the top), and only used when that floor is at
  // least END_SEAT_CLEAR, so a length slider can grow into the walkway and
  // take the end stools away without anything else moving.
  // Two readings of "floor beyond that end", and the difference matters once
  // the body may slide to hold a declared length.
  //   anchorClear — from the ANCHOR, which never moves under a length nudge.
  //     WHICH end takes the stools is decided from this, so a length slider
  //     cannot swing the row round to the other end mid-search.
  //   bodyClear   — from the body the scene actually draws. WHETHER there is
  //     room for a stool is decided from this: floor reckoned from the anchor
  //     is floor the slid top is already standing on.
  const alongClear = (side: 1 | -1) => (rot === 0
    ? (side > 0 ? sizeMaxX - cx : cx - sizeMinX)
    : (side > 0 ? sizeMaxZ - cz : cz - sizeMinZ)) - topLen / 2;
  const bodyClear = (side: 1 | -1) => alongClear(side) - side * slide;
  // The photo may name the end (`endPlacement`); 'auto' keeps the old rule of
  // taking whichever end has more floor. An explicit word is trusted with less
  // clear floor than a guess — the photo already showed a stool standing there.
  const endPl = pick<'auto' | 'left' | 'right' | 'both'>(isl.endPlacement, ['auto', 'left', 'right', 'both'], 'auto');
  const autoSide: 1 | -1 = alongClear(1) >= alongClear(-1) ? 1 : -1;
  const endSide: 1 | -1 = endPl === 'left' ? -1 : endPl === 'right' ? 1 : autoSide;
  const clearNeeded = endPl === 'auto' ? END_SEAT_CLEAR : inch(20);
  const endRoom = bodyClear(endSide) >= clearNeeded;
  const wanted = clamp(Math.round(num(isl.seating, 0, 0, 12)), 0, 12);
  // The photo says how many sit round the end (`endSeats`, 0 = all along the
  // side); a spec without the field gets the old guess. Either way the end
  // only takes stools when the floor beyond it is clear, and two of them
  // need a top wide enough to sit side by side (40" for the guess, 34" when
  // the photo insists).
  const endWanted = Number.isFinite(isl.endSeats) ? clamp(Math.round(isl.endSeats as number), 0, 4) : null;
  const perEndCap = topWide >= inch(34) ? 2 : 1;
  // 'both' needs two stools AND floor beyond the far end as well
  const bothWanted = endPl === 'both' && (endWanted ?? 0) >= 2 && bodyClear((endSide === 1 ? -1 : 1)) >= inch(20);
  const endSeats = !endRoom || wanted < 1 ? 0
    : endWanted != null ? Math.min(endWanted, wanted, bothWanted ? 2 * perEndCap : perEndCap)
      : wanted < 3 ? 0 : topWide >= inch(40) && wanted >= 4 ? 2 : 1;
  /** of those, how many go round the OTHER end */
  const endSeatsOther = bothWanted ? Math.floor(endSeats / 2) : 0;
  // The spacing along the seating face: the photo's pitch, kept so the row
  // stays under the top (a stool is ~14" across), or 28" capped by the top.
  // The cap on how many fit follows the same pitch, so a tight pitch seats
  // more and a wide one fewer — the count never exceeds what the top spans.
  const pitchWant = num(isl.stoolPitchIn, 0, 0, 40);
  const sideCap = pitchWant > 0
    ? Math.max(1, Math.floor((topLen - inch(14)) / Math.max(inch(16), inch(pitchWant))) + 1)
    : Math.max(0, Math.floor(topLen / inch(22)));
  const seating = Math.min(wanted, sideCap + endSeats);
  const onSide = Math.max(0, seating - endSeats);
  const stoolPitch = pitchWant > 0
    ? clamp(inch(pitchWant), inch(16), Math.max(inch(16), onSide > 1 ? (topLen - inch(14)) / (onSide - 1) : inch(pitchWant)))
    : Math.min(inch(28), topLen / Math.max(1, onSide));

  const rect: Rect = rot === 0
    ? { minX: bx - topLen / 2, maxX: bx + topLen / 2, minZ: bz - wide / 2 - ohMinus, maxZ: bz + wide / 2 + ohPlus }
    : { minX: bx - wide / 2 - ohMinus, maxX: bx + wide / 2 + ohPlus, minZ: bz - topLen / 2, maxZ: bz + topLen / 2 };

  // How far the side-stool row may slide before its outermost stool leaves the
  // top. Reported CLAMPED (see `KIsland.stoolOffset`) so the Layout tab's
  // honesty check reads the number that was actually drawn.
  const rowReach = Math.max(0, (topLen - inch(14)) / 2 - ((onSide - 1) * stoolPitch) / 2);
  const stoolOffset = clamp(inch(num(isl.stoolOffsetIn, 0, -60, 60)), -rowReach, rowReach);

  return {
    kind, cx: bx, cz: bz, anchorX: cx, anchorZ: cz, yaw, len, wide,
    seating, overhang, seatSide, endSeats, endSide, endSeatsOther, endOverhang: endOH, stoolOffset, stoolPitch, waterfall,
    hasSink: isl.hasSink === true,
    hasCooktop: isl.hasCooktop === true,
    carcassTop, topT: counterT,
    topLen, topWide, topOffset,
    seatY: Math.max(inch(18), counterTopY - inch(11)),
    rect,
  };
}

// ---------------------------------------------------------------------------
// Sink
// ---------------------------------------------------------------------------
function buildSink(
  raw: KitchenSpec['sink'] | undefined,
  ctx: { runs: KRun[]; island: KIsland | null; openings: KOpening[]; w: number; d: number; counterTopY: number; carcassTop: number; toeKick: number },
): KSink | null {
  const s = (raw ?? {}) as Partial<KitchenSpec['sink']>;
  const kind = pick<KSink['kind']>(s.kind, ['undermount', 'farmhouse', 'drop-in', 'double'], 'undermount');
  const { runs, island, openings, w, d } = ctx;
  const wantIsland = s.wall === 'island';

  const islandSink = (isl: KIsland): KSink => ({
    kind: kind === 'farmhouse' ? 'undermount' : kind,
    where: 'island', wall: null,
    x: 0,
    width: clamp(inch(num(s.widthIn, 33, 15, 48)), inch(15), Math.max(inch(15), isl.len - inch(8))),
    depth: clamp(inch(18), inch(10), Math.max(inch(10), isl.wide - inch(8))),
    z: 0,
    bowlDepth: inch(9),
    runId: null,
  });
  if (wantIsland && island) return islandSink(island);

  const wall = pick<Wall>(wantIsland ? undefined : s.wall, WALLS, 'back');
  const candidates = runs.filter((r) => r.wall === wall);
  const run = candidates[0] ?? runs[0] ?? null;
  if (!run) return island ? islandSink(island) : null;
  const wl = wallLength(run.wall, w, d);
  let width = inch(num(s.widthIn, 33, 15, 48));
  let x = clamp(num(s.t, 0.5, 0, 1) * wl, 0, wl) - wl / 2;

  // prefer an explicit sink base; otherwise land under a window; otherwise the
  // widest counter segment near the declared position
  const sinkBase = run.base.filter((b) => b.type === 'sink-base').sort((a, b) => Math.abs(a.cx - x) - Math.abs(b.cx - x))[0];
  if (sinkBase) {
    x = sinkBase.cx;
    width = Math.min(width, Math.max(inch(14), sinkBase.width - inch(3)));
    if (kind === 'farmhouse') sinkBase.apronH = inch(10);
  } else {
    const win = openings.filter((o) => o.wall === run.wall && o.kind === 'window').sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
    if (win && Math.abs(win.x - x) < 1.2) x = win.x;
    const seg = run.counters.filter(([a0, a1]) => a1 - a0 >= width + inch(4)).sort((p, q) => Math.abs((p[0] + p[1]) / 2 - x) - Math.abs((q[0] + q[1]) / 2 - x))[0];
    if (seg) {
      width = Math.min(width, seg[1] - seg[0] - inch(4));
      x = clamp(x, seg[0] + width / 2 + inch(2), seg[1] - width / 2 - inch(2));
    } else {
      x = clamp(x, run.x0 + width / 2, run.x1 - width / 2);
    }
  }
  const depth = kind === 'farmhouse'
    ? clamp(inch(19), inch(10), Math.max(inch(10), run.baseDepth - inch(4)))
    : clamp(inch(18), inch(10), Math.max(inch(10), run.baseDepth - inch(7)));
  return {
    kind,
    where: 'wall',
    wall: run.wall,
    x,
    width: Math.max(inch(14), width),
    depth,
    // front edge sits ~2.5" back from the cabinet face (farmhouse bowls run to the apron)
    z: kind === 'farmhouse' ? run.baseDepth - inch(0.5) - depth / 2 : run.baseDepth - inch(2.5) - depth / 2,
    bowlDepth: kind === 'farmhouse' ? inch(10) : inch(9),
    runId: run.id,
  };
}

// ---------------------------------------------------------------------------
// Décor
// ---------------------------------------------------------------------------
/**
 * Décor placement — the island's rule, applied to everything on the walls.
 *
 * THE RULE: a décor anchor is a function of the SPEC and of the ROOM +
 * CABINETRY, never of another piece of décor. A shelf slides around windows,
 * doorways, tall units and wall cabinets; a floor plant keeps out of every
 * cabinet footprint and doorway; the rug is fitted to the clear floor. Nothing
 * reads back a plant or a rug to place something else, which is what lets the
 * check script sweep every décor control and assert nothing unrelated twitches.
 *
 * Two deliberate, NAMED dependencies on the shelves: a plant that lives ON a
 * shelf follows its board, and art keeps clear of the shelves on its wall (the
 * fitted span — a picture hung behind a board is wrong however it got there).
 * Both are consequences a user expects when they drag a shelf.
 *
 * Nothing is dropped silently. A piece that had to move, shrink or go is
 * written to `warnings` in plain words so the Layout tab can say so.
 */
interface DecorCtx {
  w: number; d: number; h: number;
  style: DesignStyle;
  doorStyle: CabinetDoorStyle;
  runs: KRun[];
  openings: KOpening[];
  appliances: KAppliance[];
  island: KIsland | null;
  sink: KSink | null;
  rects: Rect[];
  inset: Record<Wall, number>;
  counterTopY: number;
  counterT: number;
  ceilingCrown: number;
  cabinetHex: string | undefined;
}

const STEEL_BRACKET_STYLES: ReadonlySet<DesignStyle> = new Set<DesignStyle>(['industrial', 'farmhouse', 'craftsman', 'traditional', 'mid-century']);

export const CONTENT_KINDS: readonly CabinetContents['kind'][] = ['plates', 'bowls', 'glasses', 'mugs', 'jars', 'cookbooks', 'bottles', 'mixed', 'empty'];

/**
 * Whether anything shows inside this wall cabinet. Glass fronts and open
 * shelves do; a solid door, a corner unit, a filler, a void and the cabinet
 * that sits on the hood never do (whatever front the hood cabinet ended up
 * with, it is a box in the middle of a canopy, not a display case).
 */
export function contentsFor(u: KUpper, doorStyle: CabinetDoorStyle): boolean {
  if (u.type === 'glass' || u.type === 'open-shelf') return true;
  return u.type === 'door' && doorStyle === 'glass';
}

/**
 * Slide a span of `width` centred at `x` into the nearest clear stretch of a
 * wall. When no stretch takes the full width, the widest one is used and the
 * span shrinks to it; `null` means there is nothing worth having.
 */
function fitOnWall(wl: number, x: number, width: number, blockers: Span[], minW: number, margin = inch(2), preserveAnchor = false): { x: number; width: number; moved: boolean; shrunk: boolean } | null {
  const free = subtractIntervals(-wl / 2 + margin, wl / 2 - margin, mergeSpans(blockers));
  if (preserveAnchor) {
    // Built-in casework belongs beside the observed hood/window. A narrower
    // nearby opening is preferable to jumping across that landmark merely
    // because the opposite side has a wider unused stretch of wall.
    let nearest: { x: number; width: number; dist: number } | null = null;
    for (const [a, b] of free) {
      if (b - a < minW) continue;
      const fittedWidth = Math.min(width, b - a);
      const cx = clamp(x, a + fittedWidth / 2, b - fittedWidth / 2);
      const dist = Math.abs(cx - x);
      if (!nearest || dist < nearest.dist - 1e-6 || (Math.abs(dist - nearest.dist) < 1e-6 && fittedWidth > nearest.width)) nearest = { x: cx, width: fittedWidth, dist };
    }
    return nearest ? { x: nearest.x, width: nearest.width, moved: nearest.dist > 1e-3, shrunk: nearest.width < width - 1e-3 } : null;
  }
  let best: { x: number; dist: number } | null = null;
  for (const [a, b] of free) {
    if (b - a < width - 1e-4) continue;
    const cx = clamp(x, a + width / 2, b - width / 2);
    const dist = Math.abs(cx - x);
    if (!best || dist < best.dist) best = { x: cx, dist };
  }
  if (best) return { x: best.x, width, moved: best.dist > 1e-3, shrunk: false };
  let widest: Span | null = null;
  for (const s of free) if (!widest || s[1] - s[0] > widest[1] - widest[0]) widest = s;
  if (!widest || widest[1] - widest[0] < minW) return null;
  const wdt = widest[1] - widest[0];
  return { x: (widest[0] + widest[1]) / 2, width: wdt, moved: true, shrunk: true };
}

/** A muted, gallery-safe tone pulled from the cabinet colour toward dusty slate. */
function mutedFrom(hex: string | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  const v = m ? parseInt(m[1], 16) : 0x8a8f96;
  const mix = (c: number, t: number) => Math.round(c * 0.45 + t * 0.55).toString(16).padStart(2, '0');
  return `#${mix((v >> 16) & 255, 122)}${mix((v >> 8) & 255, 132)}${mix(v & 255, 140)}`;
}

/** metres as the inches a warning quotes back to the user */
const inches = (m: number) => `${Math.round(m / 0.0254)}"`;

function buildDecor(raw: DecorSpec | undefined, ctx: DecorCtx): KDecor {
  const { w, d, h, style, runs, openings, appliances, island, sink, rects, inset, counterTopY, counterT, ceilingCrown } = ctx;
  const dec = (raw && typeof raw === 'object' ? raw : {}) as Partial<DecorSpec>;
  const warnings: string[] = [];
  const warn = (s: string) => { warnings.push(s); };
  const ceilingLimit = h - ceilingCrown - inch(3);

  /** everything on `wall` that a piece occupying the height band [y0, y1] must not run through */
  const wallBlockers = (wall: Wall, y0: number, y1: number): Span[] => {
    const out: Span[] = [];
    for (const o of openings) {
      if (o.wall !== wall || o.sill >= y1 || o.sill + o.height <= y0) continue;
      out.push([o.x - o.width / 2 - inch(2.5), o.x + o.width / 2 + inch(2.5)]);
    }
    for (const r of runs) {
      if (r.wall !== wall) continue;
      for (const t of r.tall) if (t.top > y0) out.push([t.x0 - inch(0.5), t.x1 + inch(0.5)]);
      for (const u of r.uppers) if (u.type !== 'appliance-gap' && u.type !== 'hood-gap' && u.bottom < y1 && u.top > y0) out.push([u.x0 - inch(0.5), u.x1 + inch(0.5)]);
    }
    for (const a of appliances) {
      if (a.wall !== wall) continue;
      // a chimney hood's duct cover runs to wherever the layout stopped it (the ceiling unless the photo said otherwise); a fridge is a wall
      if (a.y < y1 && a.top > y0) out.push([a.x - a.width / 2 - inch(0.5), a.x + a.width / 2 + inch(0.5)]);
    }
    // cabinetry on the NEIGHBOURING walls reaches into the corner: the side of
    // a fridge surround or a run of uppers covers the first two feet of this
    // wall, and a picture hung there would be inside the box
    const wf = wallFrameLite(wall, w, d);
    const wl = wallLength(wall, w, d);
    const sideOf = (rc: Rect, top: number, bottom = 0) => {
      if (top <= y0 || bottom >= y1) return;
      const cs: Array<[number, number]> = [[rc.minX, rc.minZ], [rc.maxX, rc.minZ], [rc.minX, rc.maxZ], [rc.maxX, rc.maxZ]];
      let perp = Infinity, a0 = Infinity, a1 = -Infinity;
      for (const [px, pz] of cs) {
        const dx = px - wf.ox, dz = pz - wf.oz;
        perp = Math.min(perp, dx * wf.nx + dz * wf.nz);
        const along = dx * wf.ax + dz * wf.az;
        a0 = Math.min(a0, along); a1 = Math.max(a1, along);
      }
      if (perp < 0.03) out.push([a0 - wl / 2 - inch(0.5), a1 - wl / 2 + inch(0.5)]);
    };
    for (const r of runs) if (r.wall !== wall) {
      sideOf(r.rect, counterTopY);
      for (const u of r.uppers) if (u.type !== 'appliance-gap' && u.type !== 'hood-gap') sideOf(rectOnWall(r.wall, w, d, u.cx + r.wallLen / 2, u.width, r.upperDepth), u.top, u.bottom);
      for (const t of r.tall) sideOf(rectOnWall(r.wall, w, d, (t.x0 + t.x1) / 2 + r.wallLen / 2, t.width, t.depth), t.top);
    }
    for (const a of appliances) if (a.wall !== wall && a.wall !== 'island' && a.rect) sideOf(a.rect, a.y + a.height);
    return out;
  };
  const runsOn = (wall: Wall) => runs.filter((r) => r.wall === wall);
  const overRun = (wall: Wall, cx: number, wdt: number) => runsOn(wall).some((r) => cx - wdt / 2 < r.x1 - 0.01 && cx + wdt / 2 > r.x0 + 0.01);

  // ---- shelves ----------------------------------------------------------
  const rawShelves = (Array.isArray(dec.shelves) ? dec.shelves : []).filter((s): s is OpenShelf => !!s && typeof s === 'object').slice(0, 6);
  const shelves: KShelf[] = [];
  rawShelves.forEach((s, i) => {
    const wall = pick<Wall>(s.wall, WALLS, 'back');
    const wl = wallLength(wall, w, d);
    const name = `Shelf ${i + 1} (${wall} wall)`;
    if (wl < inch(30)) { warn(`${name}: the wall is too short — dropped`); return; }
    const material = pick(s.material, SHELF_MATERIALS, 'wood');
    const styled = pick(s.styled, SHELF_STYLED, 'mixed');
    const caseSpec = s.enclosure && typeof s.enclosure === 'object' ? s.enclosure : null;
    const rotationDeg = shelfRotation(caseSpec?.rotationDeg);
    const quarter = Math.abs(rotationDeg) === 90;
    const caseThickness = inch(num(caseSpec?.panelThicknessIn, 0.75, 0.25, 2));
    const thickness = caseSpec ? caseThickness : material === 'wood' ? inch(1.5) : material === 'match-countertop' ? Math.max(inch(0.75), counterT) : inch(1);
    const spacing = clamp(inch(num(s.spacingIn, 14, 8, 24)), inch(8), inch(24));
    const wantCount = Math.round(num(s.count, 2, 1, 5));
    const caseHeight = caseSpec ? inch(num(caseSpec.heightIn, wantCount * (spacing / inch(1)) + thickness / inch(1), 12, 120)) : 0;
    let fittedCaseHeight = caseHeight;
    let count = wantCount;
    const normalRoomSize = wall === 'back' || wall === 'front' ? d : w;
    const requestedWidth = inch(num(s.widthIn, 36, 12, 120));
    let width = clamp(requestedWidth, inch(12), Math.max(inch(12), (quarter ? normalRoomSize : wl) - inch(4)));
    let depth = clamp(inch(num(s.depthIn, 10, 6, 16)), inch(6), Math.min(inch(16), wl - inch(4)));
    const footprintSize = () => ({ span: quarter ? depth : width, projection: quarter ? width : depth });
    const bottomDeclared = clamp(ft(num(s.bottomFt, 4.5, 2, 9)), inch(24), h - inch(6));
    let bottom = bottomDeclared;
    let x = clamp(num(s.t, 0.5, 0, 1) * wl - wl / 2, -wl / 2 + footprintSize().span / 2, wl / 2 - footprintSize().span / 2);
    const stackH = () => caseSpec ? fittedCaseHeight : (count - 1) * spacing + thickness;
    let overCounter = overRun(wall, x, footprintSize().span);
    let moved = false, shrunk = false, fitted = true;
    let cappedByUpper = false;
    // the band the boards need depends on whether they end up over a counter
    // (the lowest board is lifted clear of it), and sliding can change that —
    // so settle it in a couple of passes
    for (let pass = 0; pass < 3; pass++) {
      bottom = overCounter ? Math.max(bottomDeclared, counterTopY + (caseSpec ? 0.002 : SHELF_CLEAR)) : bottomDeclared;
      count = wantCount;
      if (caseSpec) {
        fittedCaseHeight = Math.min(caseHeight, ceilingLimit - bottom);
        cappedByUpper = false;
        const minimumTopGap = inch(0.25);
        const requiredBoardsHeight = (wantCount - 1) * spacing + thickness * 2 + minimumTopGap;
        const footprint = rectOnWall(wall, w, d, x + wl / 2, footprintSize().span, footprintSize().projection);
        let upperLimit = Infinity;
        for (const r of runs) for (const u of r.uppers) {
          if (u.type === 'appliance-gap' || u.type === 'hood-gap' || u.bottom <= bottom) continue;
          const upperFootprint = rectOnWall(r.wall, w, d, u.cx + r.wallLen / 2, u.width, r.upperDepth);
          const overlapX = Math.min(footprint.maxX, upperFootprint.maxX) - Math.max(footprint.minX, upperFootprint.minX);
          const overlapZ = Math.min(footprint.maxZ, upperFootprint.maxZ) - Math.max(footprint.minZ, upperFootprint.minZ);
          if (overlapX > 0.001 && overlapZ > 0.001) upperLimit = Math.min(upperLimit, u.bottom - inch(0.125));
        }
        // A case just below a raised row must not disappear because its cap
        // overlaps that row by a few inches. Keep its base, position and all
        // declared boards when they fit below the actual cabinet underside.
        if (upperLimit < bottom + fittedCaseHeight && upperLimit - bottom >= requiredBoardsHeight) {
          fittedCaseHeight = upperLimit - bottom;
          cappedByUpper = true;
        }
        if (fittedCaseHeight < thickness * 2 + minimumTopGap) { fitted = false; break; }
        // Preserve every physically clear tier: a short top opening is still
        // a shelf. Its contents are fitted separately to the available space.
        while (count > 1 && (count - 1) * spacing + thickness * 2 + minimumTopGap > fittedCaseHeight) count--;
      } else {
        while (count > 1 && bottom + stackH() > ceilingLimit) count--;
        if (bottom + stackH() > ceilingLimit) bottom = Math.max(inch(24), ceilingLimit - stackH());
      }
      const fit = fitOnWall(wl, x, footprintSize().span, wallBlockers(wall, bottom - (caseSpec ? 0 : inch(1)), bottom + stackH() + (caseSpec ? 0 : inch(8))), inch(quarter ? 6 : 12), inch(2), !!caseSpec);
      if (!fit) { fitted = false; break; }
      moved = moved || fit.moved; shrunk = shrunk || fit.shrunk;
      const shifted = Math.abs(x - fit.x) > 0.001 || Math.abs(footprintSize().span - fit.width) > 0.001;
      x = fit.x; if (quarter) depth = fit.width; else width = fit.width;
      const now = overRun(wall, x, footprintSize().span);
      if (now === overCounter && (!caseSpec || !shifted)) break;
      overCounter = now;
    }
    if (!fitted) { warn(`${name}: no clear stretch of wall — dropped`); return; }
    if (overCounter && !caseSpec) depth = Math.min(depth, inch(12));
    const boards = Array.from({ length: count }, (_, k) => bottom + k * spacing);
    const top = bottom + stackH();
    const standoff = runsOn(wall).some((r) => r.splash.some((sp) => sp.x0 < x + footprintSize().span / 2 && sp.x1 > x - footprintSize().span / 2 && sp.bottom < top && sp.top > bottom - 0.01))
      ? SPLASH_T : 0;
    shelves.push({
      id: `shelf-${i}`, wall, x, width, depth, count, boards, thickness, material, styled, standoff, overCounter,
      brackets: STEEL_BRACKET_STYLES.has(style) ? 'steel' : 'hidden',
      enclosure: caseSpec ? { bottom, top, panelThickness: caseThickness, backPanel: caseSpec.backPanel === true, rotationDeg } : null,
      finishColorHex: itemHex(s.finishColorHex, '') || null,
    });
    if (moved) warn(`${name}: slid along the wall to clear a window, doorway or cabinet`);
    if (shrunk) warn(`${name}: ${quarter ? 'depth reduced' : 'narrowed'} to ${inches(footprintSize().span)} to fit`);
    if (quarter && width < requestedWidth - 0.001) warn(`${name}: case width reduced to ${inches(width)} so its rotated footprint stays inside the room`);
    if (count < wantCount) warn(`${name}: ${count} of ${wantCount} boards fit ${caseSpec ? 'inside the enclosure' : 'under the ceiling'}`);
    if (caseSpec && fittedCaseHeight < caseHeight - 0.001) warn(`${name}: enclosure height reduced to ${inches(fittedCaseHeight)} ${cappedByUpper ? 'to clear the upper cabinet above' : 'below the ceiling'}`);
    if (caseSpec && bottom > bottomDeclared + 0.003) warn(`${name}: enclosure base raised to sit on the countertop`);
  });

  // ---- art ----------------------------------------------------------------
  const rawArt = (Array.isArray(dec.art) ? dec.art : []).filter((a): a is WallArt => !!a && typeof a === 'object').slice(0, 6);
  const art: KArt[] = [];
  rawArt.forEach((a, i) => {
    const wall = pick<Wall>(a.wall, WALLS, 'back');
    const wl = wallLength(wall, w, d);
    const name = `Art ${i + 1} (${wall} wall)`;
    if (wl < inch(24)) { warn(`${name}: the wall is too short — dropped`); return; }
    const frame = pick(a.frame, ART_FRAMES, 'black');
    let width = clamp(inch(num(a.widthIn, 24, 6, 96)), inch(6), Math.max(inch(6), wl - inch(4)));
    let height = clamp(inch(num(a.heightIn, 30, 6, 96)), inch(6), Math.max(inch(6), ceilingLimit - inch(30)));
    let x = clamp(num(a.t, 0.5, 0, 1) * wl - wl / 2, -wl / 2 + width / 2, wl / 2 - width / 2);
    let cy = clamp(ft(num(a.centerFt, 5, 2, 9)), height / 2 + inch(24), ceilingLimit - height / 2 - inch(1));
    // the shelves on this wall (with the ~12" of things standing on the top board)
    const shelfBlockers = (y0: number, y1: number): Span[] => shelves
      .filter((s) => s.wall === wall && s.boards[0] - inch(2) < y1 && (s.enclosure?.top ?? s.boards[s.boards.length - 1] + s.thickness + inch(12)) > y0)
      .map((s): Span => [s.x - shelfFootprint(s).span / 2 - inch(2), s.x + shelfFootprint(s).span / 2 + inch(2)]);
    let moved = false, shrunk = false, fitted = true;
    let overCounter = overRun(wall, x, width);
    for (let pass = 0; pass < 3; pass++) {
      if (overCounter) cy = Math.max(cy, counterTopY + inch(4) + height / 2);
      const y0 = cy - height / 2, y1 = cy + height / 2;
      const fit = fitOnWall(wl, x, width, [...wallBlockers(wall, y0, y1), ...shelfBlockers(y0, y1)], inch(6));
      if (!fit) { fitted = false; break; }
      if (fit.shrunk) { height *= fit.width / width; shrunk = true; }
      moved = moved || fit.moved;
      x = fit.x; width = fit.width;
      const now = overRun(wall, x, width);
      if (now === overCounter) break;
      overCounter = now;
    }
    if (!fitted) { warn(`${name}: no clear stretch of wall — dropped`); return; }
    art.push({ id: `art-${i}`, wall, x, y: cy, width, height, frame, depth: frame === 'none' ? inch(1.5) : inch(1.25) });
    if (moved) warn(`${name}: slid along the wall to clear a window, cabinet or shelf`);
    if (shrunk) warn(`${name}: scaled down to ${inches(width)} wide to fit`);
  });

  // ---- plants -------------------------------------------------------------
  const rawPlants = (Array.isArray(dec.plants) ? dec.plants : []).filter((p): p is Plant => !!p && typeof p === 'object').slice(0, 8);
  const plants: KPlant[] = [];
  // doorways block the floor in front of them the way a cabinet does
  const obstacles: Rect[] = [...rects];
  for (const o of openings) {
    if (o.kind === 'window') continue;
    obstacles.push(rectOnWall(o.wall, w, d, o.x + wallLength(o.wall, w, d) / 2, o.width + 0.6, 1.0));
  }
  const clearAt = (px: number, pz: number, r: number): boolean =>
    Math.abs(px) < w / 2 - r && Math.abs(pz) < d / 2 - r && obstacles.every((rc) => distToRect(px, pz, rc) > r + 0.05);
  const corners: Array<[number, number]> = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]];

  rawPlants.forEach((p, i) => {
    const kind = pick(p.kind, PLANT_KINDS, 'floor');
    const form = pick(p.form, PLANT_FORMS, 'leafy');
    const t = num(p.t, 0.5, 0, 1);
    const wantWall = p.wall;
    const wall = pick<Wall>(wantWall === 'island' || wantWall === 'corner' ? undefined : wantWall, WALLS, 'back');
    const name = `Plant ${i + 1}`;
    const id = `plant-${i}`;

    if (kind === 'floor') {
      const height = clamp(ft(num(p.sizeFt, 4, 0.3, 9)), 0.3, Math.max(0.3, h - 0.15));
      const potR = clamp(0.08 + height * 0.05, 0.10, 0.26);
      const potH = clamp(potR * 1.5, 0.12, 0.42);
      const stand = potR + 0.04;
      let spot: [number, number] | null = null;
      let moved = false;
      if (wantWall === 'corner') {
        const at = (k: number): [number, number] => [corners[k][0] + Math.sign(-corners[k][0]) * stand, corners[k][1] + Math.sign(-corners[k][1]) * stand];
        const want = clamp(Math.floor(t * 4), 0, 3);
        if (clearAt(...at(want), potR)) spot = at(want);
        else {
          let best = 0;
          for (let k = 0; k < 4; k++) {
            const [px, pz] = at(k);
            if (!clearAt(px, pz, potR)) continue;
            const dmin = obstacles.reduce((m, rc) => Math.min(m, distToRect(px, pz, rc)), Infinity);
            if (dmin > best) { best = dmin; spot = [px, pz]; }
          }
          if (spot) { moved = true; warn(`${name}: the ${CORNER_NAMES[want]} corner is taken — moved to the clearest corner`); }
        }
      } else {
        const wl = wallLength(wall, w, d);
        const f = wallFrameLite(wall, w, d);
        const a0 = clamp(t * wl, stand, wl - stand);
        // walk outward from the declared spot in 5 cm steps until the pot clears
        for (let k = 0; k <= 80 && !spot; k++) {
          for (const sgn of k === 0 ? [1] : [1, -1]) {
            const a = a0 + sgn * k * 0.05;
            if (a < stand || a > wl - stand) continue;
            const px = f.ox + f.ax * a + f.nx * stand, pz = f.oz + f.az * a + f.nz * stand;
            if (clearAt(px, pz, potR)) { spot = [px, pz]; moved = k > 0; break; }
          }
        }
        if (moved) warn(`${name}: slid along the ${wall} wall to clear the cabinets`);
      }
      if (!spot) { warn(`${name}: no clear floor — dropped`); return; }
      plants.push({ id, kind, form, frame: 'world', x: spot[0], y: 0, z: spot[1], height, potR, potH, drop: 0 });
      return;
    }

    if (kind === 'counter') {
      const height = clamp(ft(num(p.sizeFt, 1, 0.3, 9)), 0.15, 0.9);
      const potR = clamp(0.04 + height * 0.07, 0.05, 0.11);
      const potH = potR * 1.2;
      const onIsland = (isl: KIsland) => {
        const lo = -isl.len / 2 + potR + inch(2), hi = isl.len / 2 - potR - inch(2);
        const x = lo <= hi ? clamp((t - 0.5) * isl.len, lo, hi) : 0;
        plants.push({ id, kind, form, frame: 'island', x, y: isl.carcassTop + counterT, z: isl.topOffset - isl.seatSide * inch(3), height, potR, potH, drop: 0 });
      };
      if (wantWall === 'island') {
        if (island) { onIsland(island); return; }
        warn(`${name}: there is no island — moved to the nearest counter`);
      }
      const candidates = runsOn(wall).length ? runsOn(wall) : runs;
      if (!candidates.length) {
        if (island) { onIsland(island); return; }
        warn(`${name}: no counter to stand on — dropped`);
        return;
      }
      const run = candidates[0];
      const wl = run.wallLen;
      let x = clamp(t * wl - wl / 2, run.x0, run.x1);
      const seg = run.counters
        .filter(([a0, a1]) => a1 - a0 >= 2 * potR + inch(3))
        .sort((s0, s1) => Math.abs(clamp(x, s0[0], s0[1]) - x) - Math.abs(clamp(x, s1[0], s1[1]) - x))[0];
      if (!seg) { warn(`${name}: no counter to stand on — dropped`); return; }
      x = clamp(x, seg[0] + potR + inch(1.5), seg[1] - potR - inch(1.5));
      // never in the sink
      if (sink && sink.where === 'wall' && sink.runId === run.id && Math.abs(x - sink.x) < sink.width / 2 + potR + inch(1)) {
        const side = x >= sink.x ? 1 : -1;
        x = clamp(sink.x + side * (sink.width / 2 + potR + inch(1.5)), seg[0] + potR + inch(1.5), seg[1] - potR - inch(1.5));
      }
      plants.push({ id, kind, form, frame: run.wall, x, y: counterTopY, z: run.counterDepth * 0.45, height, potR, potH, drop: 0 });
      return;
    }

    if (kind === 'shelf') {
      const onWall = shelves.filter((s) => s.wall === wall);
      const pool = onWall.length ? onWall : shelves;
      if (!pool.length) { warn(`${name}: there is no open shelf to sit on — dropped`); return; }
      const wl = wallLength(wall, w, d);
      const want = t * wl - wl / 2;
      const shelf = [...pool].sort((s0, s1) => Math.abs(s0.x - want) - Math.abs(s1.x - want))[0];
      let top = shelf.boards.length - 1;
      const headAt = (k: number) => (k + 1 < shelf.boards.length ? shelf.boards[k + 1] : shelf.enclosure ? shelf.enclosure.top - shelf.enclosure.panelThickness : h - ceilingCrown) - shelf.boards[k] - shelf.thickness - 0.04;
      while (shelf.enclosure && top > 0 && headAt(top) < 0.2) top--;
      if (shelf.enclosure && headAt(top) < 0.2) { warn(`${name}: no case tier has enough headroom for a plant — dropped`); return; }
      if (top < shelf.boards.length - 1) warn(`${name}: moved to a lower case tier to clear the cap`);
      const y = shelf.boards[top] + shelf.thickness;
      const headroom = Math.max(0.1, headAt(top));
      const height = clamp(ft(num(p.sizeFt, 1, 0.3, 9)), 0.1, Math.min(0.7, headroom));
      const side = shelf.enclosure?.panelThickness ?? 0, rear = shelf.enclosure?.backPanel ? side : 0;
      const potR = clamp(0.035 + height * 0.06, 0.04, Math.min(0.08, (shelf.depth - rear) / 2 - 0.01));
      const x = clamp(shelf.wall === wall ? want : shelf.x, shelf.x - shelf.width / 2 + side + potR + 0.02, shelf.x + shelf.width / 2 - side - potR - 0.02);
      plants.push({ id, kind, form, hostId: shelf.id, shelfIndex: top, frame: shelf.wall, x, y, z: shelf.standoff + rear + (shelf.depth - rear) / 2, height, potR, potH: potR * 1.2, drop: 0 });
      return;
    }

    // hanging: in front of a window when there is one, else off the wall
    const height = clamp(ft(num(p.sizeFt, 2, 0.3, 9)), 0.3, Math.max(0.3, h - counterTopY - 0.5));
    const potR = clamp(0.06 + height * 0.04, 0.08, 0.14);
    const wl = wallLength(wall, w, d);
    const want = t * wl - wl / 2;
    const windowsHere = openings.filter((o) => o.kind === 'window' && o.wall === wall);
    const pool = windowsHere.length ? windowsHere : openings.filter((o) => o.kind === 'window');
    const win = [...pool].sort((a, b) => Math.abs(a.x - want) - Math.abs(b.x - want))[0] ?? null;
    const hangWall = win ? win.wall : wall;
    const x = win ? clamp(want, win.x - win.width / 2 + potR + 0.05, win.x + win.width / 2 - potR - 0.05) : clamp(want, -wl / 2 + potR + 0.1, wl / 2 - potR - 0.1);
    // the pot hangs a hand below the window head; off a plain wall it hangs at eye level
    const potTop = win ? Math.min(win.sill + win.height - inch(4), h - 0.35) : Math.min(inch(66), h - 0.35);
    const drop = clamp(h - potTop, 0.25, Math.max(0.25, h - counterTopY - 0.3));
    plants.push({ id, kind, form, frame: hangWall, x, y: h, z: win ? 0.30 : 0.40, height: Math.min(height, Math.max(0.2, potTop - counterTopY - 0.05)), potR, potH: potR * 1.1, drop });
  });

  // ---- items ----------------------------------------------------------------
  // "every small detail like a small thing in a cabinet to be shown, a pot on
  // the stove to be shown." The PLACING happens here, next to the counters,
  // the sink and the plants an item has to dodge; `items.ts` only draws what
  // this hands back, so nothing can be drawn bigger than the gap reserved for
  // it. Runs after the plants so an item never lands on a herb pot.
  const items: KItem[] = solveItems(dec.items, {
    ...ctx, shelves, plants, warn, obstacles, clearAt, corners,
  });

  // ---- rug ------------------------------------------------------------------
  let rug: KRug | null = null;
  const rr = dec.rug && typeof dec.rug === 'object' ? dec.rug : null;
  if (rr && rr.present === true) {
    const styleR = pick<KRug['style']>(rr.style, ['runner', 'area', 'round'], 'runner');
    const wantLen = clamp(ft(num(rr.lengthFt, 6, 2, 14)), 0.6, 4.3);
    const wantWide = clamp(ft(num(rr.widthFt, 2.5, 1.5, 10)), 0.45, 3.1);
    const freeX: Span = [-w / 2 + inset.left, w / 2 - inset.right];
    const freeZ: Span = [-d / 2 + inset.back, d / 2 - inset.front];
    if (styleR === 'runner' && runs.length) {
      // in front of the sink run (or the longest run), centred on the sink
      const run = (sink && sink.where === 'wall' && runs.find((r) => r.id === sink.runId)) || [...runs].sort((a, b) => b.length - a.length)[0];
      const len = Math.min(wantLen, run.length);
      const along = clamp(sink && sink.runId === run.id ? sink.x : (run.x0 + run.x1) / 2, run.x0 + len / 2, run.x1 - len / 2);
      // how much floor there is between the run's front and whatever faces it
      const f = wallFrameLite(run.wall, w, d);
      const front = inset[run.wall];
      let gap = (run.wall === 'back' || run.wall === 'front' ? freeZ[1] - freeZ[0] : freeX[1] - freeX[0]);
      if (island) {
        const [px, pz] = runPointLite(f, run.wallLen, along, front + 0.05);
        // distance from a point just off the run front to the island, measured into the room
        const into = run.wall === 'back' ? island.rect.minZ - pz : run.wall === 'front' ? pz - island.rect.maxZ : run.wall === 'left' ? island.rect.minX - px : px - island.rect.maxX;
        if (Number.isFinite(into)) gap = Math.min(gap, into - 0.05);
      }
      const wide = Math.min(wantWide, gap - 0.10);
      if (wide < 0.35) warn('Rug: not enough floor in front of the run — dropped');
      else {
        const [cx, cz] = runPointLite(f, run.wallLen, along, front + 0.05 + wide / 2);
        rug = { style: 'runner', cx, cz, len, wide, yaw: run.wall === 'back' || run.wall === 'front' ? 0 : Math.PI / 2 };
        if (wide < wantWide - 1e-3 || len < wantLen - 1e-3) warn(`Rug: trimmed to ${inches(len)} × ${inches(wide)} to fit the aisle`);
      }
    } else {
      // the largest clear stretch of floor: the free rect, or the biggest strip
      // of it left around the island
      let strip: Rect = { minX: freeX[0], maxX: freeX[1], minZ: freeZ[0], maxZ: freeZ[1] };
      if (island) {
        const r = island.rect;
        const strips: Rect[] = [
          { minX: freeX[0], maxX: freeX[1], minZ: freeZ[0], maxZ: r.minZ },
          { minX: freeX[0], maxX: freeX[1], minZ: r.maxZ, maxZ: freeZ[1] },
          { minX: freeX[0], maxX: r.minX, minZ: freeZ[0], maxZ: freeZ[1] },
          { minX: r.maxX, maxX: freeX[1], minZ: freeZ[0], maxZ: freeZ[1] },
        ];
        strip = strips.reduce((b, s) => ((s.maxX - s.minX) * (s.maxZ - s.minZ) > (b.maxX - b.minX) * (b.maxZ - b.minZ) ? s : b));
      }
      const sx = strip.maxX - strip.minX - 0.15, sz = strip.maxZ - strip.minZ - 0.15;
      const yaw = sx >= sz ? 0 : Math.PI / 2;
      const alongMax = Math.max(sx, sz), acrossMax = Math.min(sx, sz);
      let len = Math.min(wantLen, alongMax), wide = Math.min(wantWide, acrossMax);
      if (styleR === 'round') { len = wide = Math.min(wantLen, wantWide, acrossMax); }
      if (Math.min(len, wide) < 0.35) warn('Rug: not enough clear floor — dropped');
      else {
        rug = { style: styleR, cx: (strip.minX + strip.maxX) / 2, cz: (strip.minZ + strip.maxZ) / 2, len, wide, yaw };
        if (len < wantLen - 1e-3 || wide < wantWide - 1e-3) warn(`Rug: trimmed to ${inches(len)} × ${inches(wide)} to fit the clear floor`);
      }
    }
  }

  // ---- what shows behind the glass ------------------------------------------
  // Runs AFTER the carve, so a glass upper split round the hood (ids suffixed
  // f0 / f1) inherits the entry nearest each half. An eligible cabinet with no
  // entry gets 'mixed' / 'sparse': in a lived-in photo an EMPTY glass cabinet
  // is the rarer case, and the model only lists what it can see.
  const rawContents = (Array.isArray(dec.cabinetContents) ? dec.cabinetContents : [])
    .filter((c): c is CabinetContents => !!c && typeof c === 'object')
    .slice(0, 10);
  const usedContents = new Set<number>();
  for (const r of runs) {
    const wl = r.wallLen;
    for (const u of r.uppers) {
      u.contents = null;
      u.density = 'sparse';
      // a `cabinetContents` entry is a position along the wall, so it can only
      // address ONE box per x — the tier that sits on the counter, which is the
      // one the photo can see into
      if (u.tier !== 1 || !contentsFor(u, ctx.doorStyle)) continue;
      let best: { i: number; c: CabinetContents; dist: number } | null = null;
      rawContents.forEach((c, i) => {
        if (pick<Wall>(c.wall, WALLS, 'back') !== r.wall) return;
        const cx = clamp(num(c.t, 0.5, 0, 1), 0, 1) * wl - wl / 2;
        const dist = Math.abs(cx - u.cx);
        if (dist > u.width / 2 + inch(1)) return;
        if (!best || dist < best.dist) best = { i, c, dist };
      });
      const hit = best as { i: number; c: CabinetContents; dist: number } | null;
      u.contents = hit ? pick(hit.c.kind, CONTENT_KINDS, 'mixed') : 'mixed';
      u.density = hit ? pick(hit.c.density, ['sparse', 'full'] as const, 'sparse') : 'sparse';
      if (hit) usedContents.add(hit.i);
    }
  }
  rawContents.forEach((c, i) => {
    if (usedContents.has(i)) return;
    warn(`Cabinet contents ${i + 1} (${pick<Wall>(c.wall, WALLS, 'back')} wall): no glass or open cabinet there — ignored`);
  });

  // ---- window treatments ----------------------------------------------------
  const windowTreatment = pick(dec.windowTreatment, TREATMENTS, 'none');
  const treatments: KWindowTreatment[] = [];
  if (windowTreatment !== 'none') {
    openings.filter((o) => o.kind === 'window').forEach((o, i) => {
      const headMax = h - ceilingCrown - 0.02;
      // roman shades and curtains mount OUTSIDE the casing, above the head;
      // rollers and blinds sit inside the reveal; a cafe rod crosses mid-glass
      const head = windowTreatment === 'curtains' ? Math.min(o.sill + o.height + inch(6), headMax)
        : windowTreatment === 'roman-shade' ? Math.min(o.sill + o.height + inch(3.5), headMax)
          : windowTreatment === 'cafe-curtain' ? o.sill + o.height * 0.5
            : o.sill + o.height - inch(0.75);
      treatments.push({ id: `wt-${i}`, openingId: o.id, wall: o.wall, kind: windowTreatment, x: o.x, width: o.width, sill: o.sill, height: o.height, head });
    });
  }

  // Packing uses each case's front-facing local coordinates. Apply its
  // observed orientation once, after all occupants have reserved their lanes.
  for (const occupant of [...plants, ...items]) {
    if (!occupant.hostId) continue;
    const host = shelves.find((s) => s.id === occupant.hostId);
    if (!host?.enclosure?.rotationDeg) continue;
    [occupant.x, occupant.z] = shelfPoint(host, occupant.x, occupant.z);
    if ('yaw' in occupant) occupant.yaw += shelfFootprint(host).yaw;
  }
  return {
    shelves, plants, items, art, rug, treatments, windowTreatment,
    counterStyling: pick(dec.counterStyling, COUNTER_STYLING, 'minimal'),
    stools: resolveStools(dec.stools, ctx.style),
    accentHex: mutedFrom(ctx.cabinetHex),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Items — the things standing on the surfaces
// ---------------------------------------------------------------------------
const ITEM_KINDS = Object.keys(ITEM_PROPORTIONS) as DecorItemKind[];
const ITEM_MATERIALS = Object.keys(DEFAULT_COLOR) as DecorItemMaterial[];
const ITEM_HOSTS: readonly DecorItemOn[] = ['counter', 'range', 'island', 'shelf', 'sill', 'floor'];
const BURNERS: readonly Burner[] = ['left-back', 'left-front', 'centre-back', 'centre-front', 'right-back', 'right-front'];
/** the order a burner is claimed when the photo did not name one: the two back
 *  burners first (where a pot actually sits), the centre only on a big range */
const BURNER_ORDER: readonly Burner[] = ['left-back', 'right-back', 'left-front', 'right-front', 'centre-back', 'centre-front'];
/** kinds that live pushed back against the splash rather than mid-counter */
const AT_SPLASH: ReadonlySet<DecorItemKind> = new Set<DecorItemKind>([
  'paper-towel', 'knife-block', 'canister', 'jar', 'utensil-crock', 'coffee-maker', 'toaster',
  'microwave-countertop', 'stand-mixer', 'bottle', 'oil-set', 'candle', 'vase', 'flowers',
]);
/** which way a floor item faces when it stands against a wall */
const FACE_INTO_ROOM: Record<Wall, number> = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

/** '#rrggbb' or the material's own colour — never a broken string in a shader */
function itemHex(raw: unknown, fallback: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(typeof raw === 'string' ? raw : '');
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

/**
 * A host surface as a set of free stretches. `take` claims `width` at the
 * point nearest `x` and splits the stretch it came out of, so two items on one
 * counter cannot overlap by construction; `null` means there is no room left.
 */
function makeLane(spans: Span[], blockers: Span[]) {
  const cuts = mergeSpans(blockers);
  let free: Span[] = [];
  for (const [a0, a1] of spans) free.push(...subtractIntervals(a0, a1, cuts).map(([p, q]): Span => [p, q]));
  return {
    take(x: number, width: number): number | null {
      const wdt = Math.max(0.01, width);
      let best: { x: number; i: number; dist: number } | null = null;
      free.forEach(([a, b], i) => {
        if (b - a < wdt - 1e-6) return;
        const cx = clamp(x, a + wdt / 2, b - wdt / 2);
        const dist = Math.abs(cx - x);
        if (!best || dist < best.dist) best = { x: cx, i, dist };
      });
      const hit = best as { x: number; i: number; dist: number } | null;
      if (!hit) return null;
      const [a, b] = free[hit.i];
      const rest: Span[] = [];
      if (hit.x - wdt / 2 - a > 0.01) rest.push([a, hit.x - wdt / 2]);
      if (b - (hit.x + wdt / 2) > 0.01) rest.push([hit.x + wdt / 2, b]);
      free = [...free.slice(0, hit.i), ...rest, ...free.slice(hit.i + 1)];
      return hit.x;
    },
  };
}

/** the steps a crowded object is packed down through before it is honestly dropped */
const PACK_STEPS: readonly number[] = [1, 0.85, 0.7, 0.55, 0.4, 0.3];

/**
 * Reserve a stretch of a lane, SHRINKING the object rather than dropping it.
 * A lived-in photo puts far more on a counter than the clear stretches hold at
 * full size — the client's marble kitchen boxes nineteen objects on two runs
 * and an island — and an item drawn a third small still reads as his copper
 * pitcher, while one that vanished reads as a bug. Returns the centre and the
 * factor the object has to shrink by, or null when even the smallest step did
 * not fit (then, and only then, the caller drops it with a warning).
 */
function takePacked(lane: ReturnType<typeof makeLane>, x: number, want: number): { x: number; scale: number } | null {
  for (const scale of PACK_STEPS) {
    const at = lane.take(x, want * scale);
    if (at !== null) return { x: at, scale };
  }
  return null;
}

interface ItemCtx extends DecorCtx {
  shelves: KShelf[];
  plants: KPlant[];
  warn: (s: string) => void;
  obstacles: Rect[];
  clearAt: (px: number, pz: number, r: number) => boolean;
  corners: Array<[number, number]>;
}

/**
 * Place every `decor.items` entry. Nothing is dropped silently: an item that
 * finds no clear surface writes a warning the Layout tab can show. The
 * re-hosting fallbacks the reconciler already applies are repeated
 * defensively, because the layout must survive a hand-edited spec.
 */
function solveItems(raw: DecorItem[] | undefined, ctx: ItemCtx): KItem[] {
  const list = (Array.isArray(raw) ? raw : []).filter((it): it is DecorItem => !!it && typeof it === 'object').slice(0, 24);
  if (!list.length) return [];
  const { w, d, h, runs, openings, appliances, island, sink, shelves, plants, warn, counterTopY, counterT, ceilingCrown } = ctx;
  const out: KItem[] = [];

  const runsOn = (wall: Wall) => runs.filter((r) => r.wall === wall);
  const longestRun = [...runs].sort((a, b) => b.length - a.length)[0] ?? null;
  const cookers = appliances.filter((a) => a.kind === 'range' || a.kind === 'cooktop');

  // --- lanes, built once per host the first time something asks for one
  const lanes = new Map<string, ReturnType<typeof makeLane>>();
  const counterLane = (r: KRun) => {
    const key = `run:${r.id}`;
    let l = lanes.get(key);
    if (!l) {
      const blockers: Span[] = [];
      if (sink && sink.where === 'wall' && sink.runId === r.id) blockers.push([sink.x - sink.width / 2 - inch(1), sink.x + sink.width / 2 + inch(1)]);
      for (const a of appliances) {
        if (a.wall !== r.wall || (a.kind !== 'cooktop' && a.kind !== 'range')) continue;
        blockers.push([a.x - a.width / 2 - inch(0.5), a.x + a.width / 2 + inch(0.5)]);
      }
      for (const p of plants) {
        if (p.kind !== 'counter' || p.frame !== r.wall) continue;
        blockers.push([p.x - p.potR - inch(1), p.x + p.potR + inch(1)]);
      }
      l = makeLane(r.counters.map(([a, b]): Span => [a, b]), blockers);
      lanes.set(key, l);
    }
    return l;
  };
  const islandLane = (isl: KIsland) => {
    let l = lanes.get('island');
    if (!l) {
      const blockers: Span[] = [];
      if (sink && sink.where === 'island') blockers.push([sink.x - sink.width / 2 - inch(0.5), sink.x + sink.width / 2 + inch(0.5)]);
      for (const a of appliances) if (a.wall === 'island') blockers.push([a.x - a.width / 2 - inch(0.5), a.x + a.width / 2 + inch(0.5)]);
      for (const p of plants) if (p.frame === 'island') blockers.push([p.x - p.potR - inch(1), p.x + p.potR + inch(1)]);
      l = makeLane([[-isl.topLen / 2 + inch(1), isl.topLen / 2 - inch(1)]], blockers);
      lanes.set('island', l);
    }
    return l;
  };
  const shelfLane = (s: KShelf, k: number) => {
    const key = `shelf:${s.id}:${k}`;
    let l = lanes.get(key);
    if (!l) {
      const blockers: Span[] = [];
      {
        for (const p of plants) {
          if (p.kind !== 'shelf' || p.hostId !== s.id || p.shelfIndex !== k) continue;
          blockers.push([p.x - p.potR - 0.02, p.x + p.potR + 0.02]);
        }
      }
      const side = s.enclosure?.panelThickness ?? 0;
      l = makeLane([[s.x - s.width / 2 + side + 0.02, s.x + s.width / 2 - side - 0.02]], blockers);
      lanes.set(key, l);
    }
    return l;
  };
  const sillLane = (o: KOpening) => {
    const key = `sill:${o.id}`;
    let l = lanes.get(key);
    if (!l) { l = makeLane([[o.x - o.width / 2 + inch(0.5), o.x + o.width / 2 - inch(0.5)]], []); lanes.set(key, l); }
    return l;
  };
  /** which burners on each cooker are still free, in claim order */
  const freeBurners = new Map<string, Burner[]>();
  const burnersOf = (a: KAppliance) => {
    let f = freeBurners.get(a.id);
    if (!f) {
      const n = a.width > inch(40) ? 6 : a.width > inch(32) ? 5 : 4;
      f = BURNER_ORDER.filter((b) => (n >= 5 ? true : !b.startsWith('centre'))).slice(0, n);
      freeBurners.set(a.id, f);
    }
    return f;
  };

  list.forEach((it, i) => {
    const kind = pick<DecorItemKind>(it.kind, ITEM_KINDS, 'other');
    const material = pick<DecorItemMaterial>(it.material, ITEM_MATERIALS, DEFAULT_MATERIAL[kind]);
    const label = typeof it.label === 'string' && it.label.trim() ? it.label.trim().slice(0, 40) : kind.replace(/-/g, ' ');
    const name = `Item ${i + 1} (${label})`;
    const colorHex = itemHex(it.colorHex, DEFAULT_COLOR[material]);
    const [loIn, hiIn] = SIZE_RANGE_IN[kind];
    const size = inch(num(it.sizeIn, DEFAULT_SIZE_IN[kind], loIn, hiIn));
    const shape = ITEM_PROPORTIONS[kind];
    const count = STACKABLE.has(kind) ? clamp(Math.round(num(it.count, 1, 1, 12)), 1, 12) : 1;
    let wdt = Math.max(0.01, shape.w * size);
    let hgt = Math.max(0.01, shape.h * size);
    let dep = Math.max(0.01, shape.d * size);
    // `items.ts` draws a row as instances of ONE object at a 1.1× pitch, so the
    // lane must reserve the row's whole width while `w` stays the single thing
    let rowW = wdt * (1 + 1.1 * (count - 1));
    const t = clamp(num(it.t, 0.5, 0, 1), 0, 1);
    const depthT = Number.isFinite(it.depthT) ? clamp(it.depthT as number, 0, 1) : null;
    const wantWall = it.wall === 'island' ? 'island' : pick<Wall>(it.wall ?? undefined, WALLS, 'back');
    let on = pick<DecorItemOn>(it.on, ITEM_HOSTS, 'counter');

    // re-hosting: a spec may name a host this room does not have
    if (on === 'range' && !cookers.length) { on = 'counter'; warn(`${name}: there is no range — moved to the counter`); }
    if (on === 'island' && !island) { on = 'counter'; warn(`${name}: there is no island — moved to the counter`); }
    if (on === 'shelf' && !shelves.length) { on = 'counter'; warn(`${name}: there is no open shelf — moved to the counter`); }
    if (on === 'sill' && !openings.some((o) => o.kind === 'window')) { on = 'counter'; warn(`${name}: there is no window sill — moved to the counter`); }

    const push = (p: Omit<KItem, 'id' | 'kind' | 'label' | 'on' | 'colorHex' | 'material' | 'count'>) => {
      out.push({ id: `item-${i}`, kind, label, on, colorHex, material, count, ...p });
    };
    /** the object, shrunk by the factor its lane could actually spare */
    const pack = (scale: number, where: string) => {
      if (scale >= 1) return;
      wdt *= scale; dep *= scale; hgt *= scale; rowW *= scale;
      warn(`${name}: packed to ${Math.round(scale * 100)}% to fit the ${where}`);
    };

    if (on === 'range') {
      const cooker = cookers.find((a) => a.wall === wantWall) ?? cookers.find((a) => a.wall !== 'island') ?? cookers[0];
      if (!cooker) { warn(`${name}: no range to stand on — dropped`); return; }
      const free = burnersOf(cooker);
      const asked = pick<Burner>(it.burner ?? undefined, BURNERS, free[0] ?? 'left-back');
      const at = free.includes(asked) ? asked : free[0];
      if (!at) { warn(`${name}: every burner is taken — dropped`); return; }
      free.splice(free.indexOf(at), 1);
      const n = cooker.width > inch(40) ? 6 : cooker.width > inch(32) ? 5 : 4;
      const cols = n >= 6 ? 3 : 2;
      // the same grid `burnerGrates` draws, placed where `rangeParts` puts it
      const gw = Math.max(0.05, cooker.width - inch(2));
      const gd = Math.max(0.05, cooker.depth - inch(4));
      const c = at.startsWith('left') ? 0 : at.startsWith('right') ? cols - 1 : Math.min(1, cols - 1);
      const r = at.endsWith('back') ? 0 : 1;
      const cell = gw / cols;
      const x = cooker.x - gw / 2 + cell * (c + 0.5);
      const z = (cooker.depth - inch(1)) / 2 - gd / 2 + (gd / 2) * (r + 0.5);
      const y = cooker.kind === 'range' ? cooker.y + cooker.height + inch(0.95) : counterTopY + inch(0.5);
      const cap = Math.max(0.02, Math.min(wdt, dep, cell - inch(0.5)));
      wdt = cap; dep = cap;
      const hood = appliances.find((a) => a.kind === 'hood' && a.wall === cooker.wall && Math.abs(a.x - cooker.x) < cooker.width);
      if (hood) hgt = Math.min(hgt, Math.max(0.03, hood.y - y - inch(1)));
      push({ frame: cooker.wall === 'island' ? 'island' : cooker.wall, x, y, z, w: wdt, h: hgt, d: dep, yaw: 0, lean: 0, burner: at, shelfIndex: null, hostId: cooker.id });
      return;
    }

    if (on === 'island' && island) {
      const got = takePacked(islandLane(island), (t - 0.5) * island.topLen, rowW + inch(1));
      if (!got) { warn(`${name}: no clear island top — dropped`); return; }
      pack(got.scale, 'island top');
      const x = got.x;
      // measured from the WORKING side (the one without the stools)
      const work = island.topOffset - island.seatSide * (island.topWide / 2);
      const across = work + island.seatSide * (depthT ?? 0.4) * island.topWide;
      const lo = island.topOffset - island.topWide / 2 + dep / 2, hi = island.topOffset + island.topWide / 2 - dep / 2;
      push({
        frame: 'island', x, y: island.carcassTop + counterT, z: lo <= hi ? clamp(across, lo, hi) : island.topOffset,
        w: wdt, h: hgt, d: dep, yaw: 0, lean: 0, burner: null, shelfIndex: null, hostId: null,
      });
      return;
    }

    if (on === 'shelf') {
      const onWall = shelves.filter((s) => s.wall === wantWall);
      const pool = onWall.length ? onWall : shelves;
      const wl = wantWall === 'island' ? 0 : wallLength(wantWall, w, d);
      const want = t * wl - wl / 2;
      const shelf = [...pool].sort((a, b) => Math.abs(a.x - want) - Math.abs(b.x - want))[0];
      if (!shelf) { warn(`${name}: no open shelf — dropped`); return; }
      const k = clamp(Math.round(Number.isFinite(it.shelfIndex) ? (it.shelfIndex as number) : shelf.boards.length - 1), 0, shelf.boards.length - 1);
      const y = shelf.boards[k] + shelf.thickness;
      const above = k + 1 < shelf.boards.length ? shelf.boards[k + 1] : shelf.enclosure ? shelf.enclosure.top - shelf.enclosure.panelThickness : h - ceilingCrown - 0.04;
      if (shelf.enclosure && above - y < 0.05) { warn(`${name}: this case tier has insufficient headroom — dropped`); return; }
      const got = takePacked(shelfLane(shelf, k), clamp(want, shelf.x - shelf.width / 2, shelf.x + shelf.width / 2), rowW + 0.02);
      if (!got) { warn(`${name}: no clear shelf board — dropped`); return; }
      pack(got.scale, 'shelf board');
      const x = got.x;
      hgt = Math.min(hgt, Math.max(0.03, above - y - 0.02));
      const rear = shelf.enclosure?.backPanel ? shelf.enclosure.panelThickness : 0;
      dep = Math.min(dep, Math.max(0.03, shelf.depth - rear - 0.02));
      push({ frame: shelf.wall, x, y, z: shelf.standoff + rear + (shelf.depth - rear) / 2, w: wdt, h: hgt, d: dep, yaw: 0, lean: 0, burner: null, shelfIndex: k, hostId: shelf.id });
      return;
    }

    if (on === 'sill') {
      const windows = openings.filter((o) => o.kind === 'window');
      const onWall = windows.filter((o) => o.wall === wantWall);
      const pool = onWall.length ? onWall : windows;
      const wl = wantWall === 'island' ? 0 : wallLength(wantWall, w, d);
      const want = t * wl - wl / 2;
      const win = [...pool].sort((a, b) => Math.abs(a.x - want) - Math.abs(b.x - want))[0];
      if (!win) { warn(`${name}: no window sill — dropped`); return; }
      const got = takePacked(sillLane(win), win.x + (t - 0.5) * win.width, rowW + inch(0.5));
      if (!got) { warn(`${name}: no clear window sill — dropped`); return; }
      pack(got.scale, 'window sill');
      const x = got.x;
      dep = Math.min(dep, inch(4));
      hgt = Math.min(hgt, Math.max(0.03, win.height - inch(1)));
      push({ frame: win.wall, x, y: win.sill, z: inch(2.2), w: wdt, h: hgt, d: dep, yaw: 0, lean: 0, burner: null, shelfIndex: null, hostId: win.id });
      return;
    }

    if (on === 'floor') {
      const rad = Math.max(wdt, dep) / 2;
      const stand = rad + 0.04;
      let spot: [number, number] | null = null;
      let yaw = 0;
      if (it.wall === null || it.wall === undefined) {
        let best = 0;
        for (let k = 0; k < 4; k++) {
          const [cxc, czc] = ctx.corners[k];
          const px = cxc + Math.sign(-cxc) * stand, pz = czc + Math.sign(-czc) * stand;
          if (!ctx.clearAt(px, pz, rad)) continue;
          const dmin = ctx.obstacles.reduce((m, rc) => Math.min(m, distToRect(px, pz, rc)), Infinity);
          if (dmin > best) { best = dmin; spot = [px, pz]; }
        }
      } else {
        const wall = wantWall === 'island' ? 'back' : wantWall;
        yaw = FACE_INTO_ROOM[wall];
        const wl = wallLength(wall, w, d);
        const f = wallFrameLite(wall, w, d);
        const a0 = clamp(t * wl, stand, Math.max(stand, wl - stand));
        for (let k = 0; k <= 80 && !spot; k++) {
          for (const sgn of k === 0 ? [1] : [1, -1]) {
            const a = a0 + sgn * k * 0.05;
            if (a < stand || a > wl - stand) continue;
            const px = f.ox + f.ax * a + f.nx * stand, pz = f.oz + f.az * a + f.nz * stand;
            if (ctx.clearAt(px, pz, rad)) { spot = [px, pz]; break; }
          }
        }
      }
      if (!spot) { warn(`${name}: no clear floor — dropped`); return; }
      push({ frame: 'world', x: spot[0], y: 0, z: spot[1], w: wdt, h: hgt, d: dep, yaw, lean: 0, burner: null, shelfIndex: null, hostId: null });
      return;
    }

    // counter
    const onWall = wantWall === 'island' ? [] : runsOn(wantWall);
    const run = onWall[0] ?? longestRun;
    if (!run) { warn(`${name}: no counter to stand on — dropped`); return; }
    const wl = run.wallLen;
    const got = takePacked(counterLane(run), t * wl - wl / 2, rowW + inch(1));
    if (!got) { warn(`${name}: no clear counter — dropped`); return; }
    pack(got.scale, 'counter');
    const x = got.x;
    const board = kind === 'cutting-board';
    const dt = depthT ?? (board ? 0 : AT_SPLASH.has(kind) ? 0.35 : 0.5);
    const lo = dep / 2 + SPLASH_T + inch(0.5), hi = run.counterDepth - dep / 2 - inch(0.5);
    // a board leans on the splash, exactly the way styling.ts stands one up
    const z = board ? inch(3.5) : lo <= hi ? clamp(dt * run.counterDepth, lo, hi) : run.counterDepth / 2;
    // KItem.h is documented as already clamped to the host's headroom, and the
    // range / shelf / sill hosts all do it. The counter did not, so 36" flowers
    // under a 30" wall cabinet grew straight through the cabinet box. Only what
    // actually hangs OVER this stretch counts: an item at the counter's front
    // edge is clear of a 12" deep upper, and 'hood-gap' / 'appliance-gap'
    // uppers draw nothing (the same two exclusions check-decor uses).
    let head = h - ceilingCrown - 0.02;
    const underX = (a0: number, a1: number) => a0 < x + rowW / 2 && x - rowW / 2 < a1;
    if (run.hasUppers) {
      for (const u of run.uppers) {
        if (u.type === 'hood-gap' || u.type === 'appliance-gap') continue;
        if (!underX(u.x0, u.x1) || z - dep / 2 >= run.upperDepth) continue;
        head = Math.min(head, u.bottom);
      }
    }
    for (const a of appliances) {
      if (a.kind !== 'hood' || a.wall !== run.wall) continue;
      if (!underX(a.x - a.width / 2, a.x + a.width / 2) || z - dep / 2 >= a.depth) continue;
      head = Math.min(head, a.y);
    }
    const room = Math.max(0.03, head - counterTopY - inch(0.5));
    if (hgt > room + 1e-4) {
      warn(`${name}: shortened to ${inches(room)} to clear what hangs over the counter`);
      hgt = room;
    }
    push({
      frame: run.wall, x, y: counterTopY, z,
      w: wdt, h: hgt, d: dep, yaw: 0, lean: board ? -0.14 : 0,
      burner: null, shelfIndex: null, hostId: run.id,
    });
  });

  return out;
}

/**
 * The stools the photo showed, or the ones the style would buy when the
 * analyzer said nothing: a bentwood low-back on a light frame for the softer
 * styles, a black metal backless for the hard ones, dark wood elsewhere.
 */
function resolveStools(raw: DecorSpec['stools'] | undefined, style: DesignStyle): KStools {
  // the style presets carry the three fields a DesignStyle can decide; the
  // seat pad's shape and colour come from the photo or stay null
  const byStyle: Omit<KStools, 'seatShape' | 'seatColorHex'> = style === 'modern' || style === 'industrial'
    ? { style: 'backless', frame: 'black-metal', seat: style === 'industrial' ? 'metal' : 'upholstered' }
    : style === 'scandinavian' || style === 'coastal'
      ? { style: 'low-back', frame: 'light-wood', seat: 'woven' }
      : style === 'mid-century' || style === 'contemporary' || style === 'transitional'
        ? { style: 'low-back', frame: 'dark-wood', seat: 'upholstered' }
        : style === 'farmhouse' || style === 'craftsman'
          ? { style: 'saddle', frame: 'dark-wood', seat: 'wood' }
          : { style: 'full-back', frame: 'dark-wood', seat: 'leather' };
  const s = raw && typeof raw === 'object' ? raw : null;
  // A style preset says nothing about the seat pad's shape or its own colour;
  // null on both keeps the round tan disc every style drew before the fields
  // existed, which is what `null` has to mean (contract rule 5).
  if (!s) return { ...byStyle, seatShape: null, seatColorHex: null };
  return {
    style: pick(s.style, STOOL_STYLES, byStyle.style),
    frame: pick(s.frame, STOOL_FRAMES, byStyle.frame),
    seat: pick(s.seat, STOOL_SEATS, byStyle.seat),
    seatShape: s.seatShape ?? null,
    seatColorHex: s.seatColorHex ?? null,
  };
}

// ---------------------------------------------------------------------------
// Small shared queries used by the scene components
// ---------------------------------------------------------------------------
export function distToRect(px: number, pz: number, r: Rect): number {
  const dx = Math.max(r.minX - px, 0, px - r.maxX);
  const dz = Math.max(r.minZ - pz, 0, pz - r.maxZ);
  return Math.hypot(dx, dz);
}

/** World XZ of a point on a run: `x` is wall-local centred, `z` is into the room. */
export function runPoint(L: KitchenLayoutData, run: KRun, x: number, z: number): [number, number] {
  return runPointLite(wallFrameLite(run.wall, L.w, L.d), run.wallLen, x, z);
}

function runPointLite(f: ReturnType<typeof wallFrameLite>, wallLen: number, x: number, z: number): [number, number] {
  const a = x + wallLen / 2;
  return [f.ox + f.ax * a + f.nx * z, f.oz + f.az * a + f.nz * z];
}

function wallFrameLite(wall: Wall, w: number, d: number) {
  switch (wall) {
    case 'back': return { ox: -w / 2, oz: -d / 2, ax: 1, az: 0, nx: 0, nz: 1 };
    case 'front': return { ox: w / 2, oz: d / 2, ax: -1, az: 0, nx: 0, nz: -1 };
    case 'left': return { ox: -w / 2, oz: d / 2, ax: 0, az: -1, nx: 1, nz: 0 };
    default: return { ox: w / 2, oz: -d / 2, ax: 0, az: 1, nx: -1, nz: 0 };
  }
}

// ---------------------------------------------------------------------------
// Placement helpers the scene AND the photo fitter share
//
// The pendants, the stools and the hood's three heights are the things a
// photo outlines that are not stored as boxes in the layout — they are
// derived from it. The scene components (KitchenLighting.tsx, island.ts,
// appliances.ts) draw from these functions and `src/lib/fit/boxes.ts`
// projects the same points into the photo, so keep the names and signatures:
// a change here is a change in what the fitter measures.
// ---------------------------------------------------------------------------

/**
 * Where the pendants hang — ceiling hook points in world metres. The row sits
 * over the island top when there is one, else over the sink, else across the
 * room's centre. `spread` is the row's centre-to-centre span (0 = auto: 62% of
 * the island top, 80% of the sink, 40% of the room), `offset` shifts the whole
 * row along the island / run (+ = toward the right end), and both are held
 * inside the thing they light so no shade hangs past its end.
 */
export function pendantPositions(L: KitchenLayoutData): Array<[number, number, number]> {
  const p = L.lighting.pendants;
  if (!p) return [];
  const n = Math.max(1, Math.min(6, p.count));
  /** absolute positions along one axis between `lo` and `hi`, the row centred on `c` then shifted by the offset that keeps it inside */
  const row = (auto: number, lo: number, hi: number, c: number): number[] => {
    const reach = Math.max(0, hi - lo);
    const span = n === 1 ? 0 : clamp(p.spread > 0 ? p.spread : auto, 0, reach);
    const centre = clamp(c + p.offset, lo + span / 2, hi - span / 2);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(centre + (n === 1 ? 0 : -span / 2 + (span * i) / (n - 1)));
    return out;
  };
  const out: Array<[number, number, number]> = [];
  const isl = L.island;
  if (p.positions) {
    // Explicit hooks: feet from the island top's centre, along + toward the
    // right end and across + toward the seating side. Held only 0.15 m inside
    // the WALLS, never inside the island top — a pendant hanging past the
    // island's end is exactly the thing this field exists to draw.
    const lim = (v: number, half: number) => clamp(v, -half + 0.15, half - 0.15);
    for (const q of p.positions) {
      if (isl) {
        const cs = Math.cos(isl.yaw), sn = Math.sin(isl.yaw);
        const across = isl.topOffset + isl.seatSide * q.across;
        out.push([lim(isl.cx + q.along * cs + across * sn, L.w / 2), L.h, lim(isl.cz - q.along * sn + across * cs, L.d / 2)]);
        continue;
      }
      const s0 = L.sink;
      const run = s0 && s0.where === 'wall' ? L.runs.find((r) => r.id === s0.runId) : undefined;
      if (run && s0) {
        const [wx, wz] = runPoint(L, run, s0.x + q.along, run.counterDepth * 0.55 + q.across);
        out.push([lim(wx, L.w / 2), L.h, lim(wz, L.d / 2)]);
        continue;
      }
      out.push([lim(q.along, L.w / 2), L.h, lim(q.across, L.d / 2)]);
    }
    return out;
  }
  if (isl) {
    // island-local x along the top (a shade is ~0.3 m across, so the row
    // stops that far short of the ends), turned into the world by the yaw
    const half = Math.max(0, isl.topLen / 2 - 0.15);
    const cs = Math.cos(isl.yaw), sn = Math.sin(isl.yaw);
    for (const x of row(isl.topLen * 0.62, -half, half, 0)) {
      out.push([isl.cx + x * cs + isl.topOffset * sn, L.h, isl.cz - x * sn + isl.topOffset * cs]);
    }
    return out;
  }
  const s = L.sink;
  if (s && s.where === 'wall' && s.wall) {
    const run = L.runs.find((r) => r.id === s.runId);
    if (run) {
      for (const x of row(Math.min(0.9, s.width * 0.8), run.x0 + 0.15, run.x1 - 0.15, s.x)) {
        const [wx, wz] = runPoint(L, run, x, run.counterDepth * 0.55);
        out.push([wx, L.h, wz]);
      }
      return out;
    }
  }
  for (const x of row(Math.min(L.w * 0.4, 1.6), -L.w / 2 + 0.45, L.w / 2 - 0.45, 0)) out.push([x, L.h, 0]);
  return out;
}

/** How far below the ceiling the shades hang: their bottom sits `aboveCounter` (32" unless the photo said) over the finished counter. */
export function pendantDrop(L: KitchenLayoutData): number {
  const above = L.lighting.pendants?.aboveCounter ?? inch(32);
  return Math.max(0.3, L.h - (L.counterTopY + above));
}

/**
 * Stool positions in ISLAND-LOCAL metres (x along the long axis, z across):
 * `seating − endSeats` along the seating face under the overhang at the
 * island's `stoolPitch`, then `endSeats` tucked just past the short end the
 * layout found clear, spread across the top. The first `seating − endSeats`
 * entries are the side stools (they face the island across z), the rest face
 * it along x.
 */
/**
 * How far a stool's seat reaches toward the island from its own centre, m —
 * the widest seat `stoolParts` draws: the turned disc, whose rim torus sits at
 * 0.170 with an 0.011 tube (the lathe itself stops at 0.178, the saddle at
 * 0.165 and the square pad at 0.160 with its welt). The BACK is on the far
 * side, so this is the whole of a stool's reach at the island.
 * `STOOL_R` in the fitter's `boxes.ts` is a different number on purpose: it is
 * how big a stool looks in a PHOTO (legs splayed, back included), not how
 * close its seat can get to a cabinet.
 */
const STOOL_SEAT_R = 0.181;

export function stoolPositions(isl: KIsland): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const seating = Math.max(0, Math.round(Number.isFinite(isl.seating) ? isl.seating : 0));
  if (seating <= 0) return out;
  const endSeats = Math.max(0, Math.min(seating, Math.round(Number.isFinite(isl.endSeats) ? isl.endSeats : 0)));
  const onSide = seating - endSeats;
  // A side stool is tucked 3" under the top's front edge, so a SHALLOW
  // overhang would slide it into the cabinet: at overhang 0 the centre lands
  // 3" INSIDE the body face and the seat is drawn 10.1" into the carcass.
  // `reconcileSpec` already forbids that spec (an island with seating gets at
  // least a 10" overhang, snapped to 12), but the layout is what draws, and a
  // spec reaches it from the fitter and from `applyCorrections` before it is
  // reconciled — so the row stands its own seat clear of the body rather than
  // trusting the number. A no-op from 10.1" up (the centre is already past
  // where the clamp would put it), so every spec the reconciler allows draws
  // exactly as it did.
  const z = isl.seatSide * (isl.wide / 2 + Math.max(isl.overhang - inch(3), STOOL_SEAT_R));
  const shift = Number.isFinite(isl.stoolOffset) ? isl.stoolOffset : 0;
  for (let i = 0; i < onSide; i++) out.push([shift + (i - (onSide - 1) / 2) * isl.stoolPitch, z]);
  // At a real end overhang the stool tucks UNDER the top (that is what the
  // cantilever is for, and it is what the photo's island box shows); at a
  // scribe 1.5" it stands past the end.
  const endOH = Number.isFinite(isl.endOverhang) ? isl.endOverhang : inch(1.5);
  const tuck = endOH >= inch(6) ? -Math.min(inch(7), endOH - inch(1)) : inch(4);
  const endX = (isl.endSide === -1 ? -1 : 1) * (isl.topLen / 2 + tuck);
  const other = Math.max(0, Math.min(endSeats, Math.round(Number.isFinite(isl.endSeatsOther) ? isl.endSeatsOther : 0)));
  const here = endSeats - other;
  const at = (x: number, j: number, n: number) => out.push([x, isl.topOffset + (n === 1 ? 0 : (j === 0 ? -1 : 1) * isl.topWide * 0.26)]);
  for (let j = 0; j < here; j++) at(endX, j, here);
  for (let j = 0; j < other; j++) at(-endX, j, other);
  return out;
}

/**
 * The three heights a photo can outline on a hood (m above the floor): the
 * mouth (canopy underside), the top of the canopy, and the top of the duct
 * cover — which is the underside of the cabinet that sits on the hood
 * (`KAppliance.cabinetBottom`) when there is one, else the ceiling unless the
 * spec gave the unit's height, the top of the uppers for a wood hood's chase,
 * or the canopy itself for a slim insert. Read off the layout, never
 * recomputed: the flue, the fitter's hood box and the splash all use it.
 */
export function hoodExtents(a: KAppliance): { mouth: number; canopyTop: number; top: number } {
  return { mouth: a.y, canopyTop: a.y + a.height, top: Math.max(a.y + a.height, a.top) };
}
