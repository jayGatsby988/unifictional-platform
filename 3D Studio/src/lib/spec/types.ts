/**
 * Unifictional 3D Studio — core domain contracts.
 *
 * Units: all user-facing dimensions are in FEET (decimal) unless the field name
 * ends in `In` (inches) or `M` (meters). The 3D engine converts to meters
 * (1 unit = 1 m) at the boundary via `ft()` in `@/lib/units`.
 *
 * A RoomSpec is produced by the vision analyzer from photos + description and
 * is the single source of truth for the procedural 3D twin, the photoreal
 * render prompts, and the estimator quantities.
 */

export type RoomType = 'kitchen' | 'bathroom' | 'exterior' | 'floorplan';

/**
 * What the client actually uploaded. A photo of an existing room is the case
 * the whole pipeline was built for; the other three carry almost no finish
 * information at all, which is why they are the cases where the app has to
 * ASK rather than guess.
 *
 * - 'room-photo'      a photograph of the space as it stands today.
 * - 'empty-lot'       bare ground, a teardown, a slab — no building to read.
 * - 'floor-plan'      a drawn plan: walls, dimensions, fixture symbols, no finishes.
 * - 'plans-document'  a full drawing set or a scanned PDF page (elevations,
 *                     schedules, a site plan) — geometry, still no finishes.
 *
 * Default 'room-photo' everywhere: that is what every project before this
 * field existed was, and it is the one kind that asks no questions.
 */
export type InputKind = 'room-photo' | 'empty-lot' | 'floor-plan' | 'plans-document';
export type Wall = 'back' | 'left' | 'right' | 'front';
export type Tier = 'budget' | 'standard' | 'premium' | 'luxury';
export type DesignStyle =
  | 'modern' | 'contemporary' | 'transitional' | 'traditional' | 'farmhouse'
  | 'scandinavian' | 'industrial' | 'coastal' | 'mid-century' | 'craftsman' | 'mediterranean';

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** A countertop boundary observed in the LiDAR mesh, in the scan's world frame. */
export interface ScannedCountertopSurface {
  polygonCorners: { x: number; y: number; z: number }[];
  holes?: { x: number; y: number; z: number }[][];
  source: 'lidar-mesh';
  /** Extraction grid interval; this is not an accuracy guarantee. */
  resolutionMeters: number;
}

/** Measured LiDAR elements, never generated from a photograph or flattened to four walls. */
export interface ScannedElement {
  id: string;
  kind: string;
  dimensions: { x: number; y: number; z: number };
  /** Sixteen column-major values, meters, in the studio's +Y-up frame. */
  transform: number[];
  confidence: 'high' | 'medium' | 'low' | 'sample' | 'unknown';
  /** Already in the same studio frame as transform; do not transform these twice. */
  polygonCorners?: { x: number; y: number; z: number }[] | null;
  /** Absolute world points like polygonCorners; never apply the object transform twice. */
  countertopSurfaces?: ScannedCountertopSurface[];
  parentIdentifier?: string;
  attributes?: string[];
  completedEdges?: ('top' | 'right' | 'bottom' | 'left')[];
  /** RoomPlan's original two-dimensional curve metadata, not studio-world points. */
  curve?: { center: { x: number; y: number }; radius: number; startAngleRadians: number; endAngleRadians: number };
}

export interface ScannedRoomGeometry {
  version: 1;
  surfaces: ScannedElement[];
  objects: ScannedElement[];
}

/** Proposed changes are kept outside immutable sensor geometry. */
export interface ScanObjectEdit {
  offsetXMeters: number;
  offsetZMeters: number;
  rotationDegrees: number;
  scaleX: number;
  scaleZ: number;
  hidden: boolean;
}
export interface ScanTakeoff {
  id: string;
  slot: string;
  objectIds: string[];
  quantity: number;
  unit: 'lf' | 'sqft' | 'each' | 'ls';
  /** User-entered site measurements, never a model-generated confirmation. */
  confirmedAt: string;
  note: string;
}
export interface ScanDesign {
  version: 1;
  objects: Record<string, ScanObjectEdit>;
  takeoffs: ScanTakeoff[];
  workAllowances?: { objectId: string; low: number; high: number; confirmedAt: string; note: string }[];
}

export interface Opening {
  id: string;
  kind: 'window' | 'door' | 'passage' | 'garage-door';
  wall: Wall;
  /** 0..1 position of the opening's centre along the wall (left→right when facing the wall) */
  t: number;
  widthFt: number;
  heightFt: number;
  /** distance from floor to the bottom of the opening */
  sillFt: number;
  style?: 'standard' | 'picture' | 'bay' | 'slider' | 'french' | 'pocket' | 'barn' | 'casement' | 'double-hung' | null;
}

/** One pendant's hook, in feet from the island top's centre. */
export interface PendantPosition { alongFt: number; acrossFt: number }

export interface LightingSpec {
  recessedCount: number;
  pendants: {
    count: number;
    style: 'globe' | 'cone' | 'dome' | 'drum' | 'lantern' | 'linear' | 'cage' | 'glass';
    finish: string;
    /** centre-to-centre span of the whole row in feet (0 = auto: 62% of the island) */
    spreadFt: number;
    /** shift of the row along the island / run from its centre, feet (+ = toward the right end) */
    offsetFt: number;
    /** shade bottom above the finished counter, inches (0 = auto: 32") */
    aboveCounterIn: number;
    /**
     * Explicit hook points, feet from the island top's centre: alongFt +
     * toward the right end, acrossFt + toward the seating side (room centre /
     * sink run when there is no island). `count` follows positions.length when
     * this is non-null. null = the evenly spaced row spreadFt / offsetFt
     * describes. Objects, never pairs: a zod tuple emits `prefixItems`, which
     * OpenAI strict mode rejects.
     */
    positions?: PendantPosition[] | null;
  } | null;
  underCabinet: boolean;
  chandelier: boolean;
  sconces: number;
  /** 2700–5000 */
  colorTempK: number;
  naturalLight: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Décor — the things in a photograph that are not cabinetry or fixtures but
// that make a twin read as THAT room: open shelves, plants, art, a rug, the
// window treatment. Detected by the analyzer, drawn by every room builder,
// editable in the Layout tab.
// ---------------------------------------------------------------------------

export interface OpenShelf {
  wall: Wall;
  /** 0..1 centre position along the wall (left→right facing the wall) */
  t: number;
  widthIn: number;
  /** number of boards stacked above each other */
  count: number;
  /** height of the LOWEST board above the floor, in feet */
  bottomFt: number;
  depthIn: number;
  /** vertical pitch between boards, inches */
  spacingIn: number;
  /** what the boards are made of; 'match-cabinets' follows the cabinet slot */
  material: 'match-cabinets' | 'wood' | 'white' | 'black' | 'match-countertop';
  /** Observed finish colour, independent of the room's design style. Null uses the material default. */
  finishColorHex?: string | null;
  /** Joined open display case; absent/null means separate floating boards. */
  enclosure?: {
    /** Overall case height from bottomFt (lowest board underside), including its top cap. */
    heightIn: number;
    /** Only true when a backing panel is visible; sides and top are part of the case. */
    backPanel: boolean;
    panelThicknessIn?: number | null;
    /** Quarter-turn about the case centre relative to its mounting wall; null/0 faces into the room. */
    rotationDeg?: -90 | 0 | 90 | 180 | null;
  } | null;
  /** what sits on them */
  styled: 'empty' | 'dishes' | 'books' | 'plants' | 'mixed';
}

export interface Plant {
  kind: 'floor' | 'counter' | 'shelf' | 'hanging';
  /** where it stands: a wall (t along it), the island, or a room corner */
  wall: Wall | 'island' | 'corner';
  t: number;
  /** overall height in feet (a 6 ft fiddle-leaf fig, a 1 ft herb) */
  sizeFt: number;
  /** 'leafy' = broad leaves, 'tree' = trunk + canopy, 'trailing' = pothos-style, 'herb' = small pot */
  form: 'leafy' | 'tree' | 'trailing' | 'herb' | 'succulent';
}

export interface WallArt {
  wall: Wall;
  t: number;
  widthIn: number;
  heightIn: number;
  /** centre height above the floor, feet */
  centerFt: number;
  frame: 'black' | 'wood' | 'white' | 'none';
}

/**
 * The small things. A pot on a burner, a kettle, a knife block, three
 * canisters in a row — the objects a client points at and says "that's my
 * kitchen". One entry per object; a row or stack of identical things is one
 * entry with `count`. Never priced: these are staging, not scope.
 */
export type DecorItemKind =
  | 'pot' | 'pan' | 'kettle' | 'dutch-oven' | 'cutting-board' | 'bowl' | 'fruit-bowl'
  | 'bottle' | 'oil-set' | 'vase' | 'flowers' | 'books' | 'utensil-crock' | 'knife-block'
  | 'coffee-maker' | 'stand-mixer' | 'toaster' | 'microwave-countertop' | 'soap-set'
  | 'dish-rack' | 'tray' | 'candle' | 'canister' | 'paper-towel' | 'plate-stack'
  | 'mugs' | 'jar' | 'basket' | 'towel'
  // the six a BATHROOM has and a kitchen does not. Appended before 'other' so
  // every kitchen kind keeps its meaning and its place in the list; 'other'
  // stays last because sanitize and the label reader treat it as the floor.
  | 'folded-towels' | 'soap-pump' | 'toothbrush-cup' | 'robe' | 'bath-mat' | 'tissue-box'
  | 'other';
export type DecorItemOn = 'counter' | 'range' | 'island' | 'shelf' | 'sill' | 'floor';
export type DecorItemMaterial =
  | 'stainless' | 'black-metal' | 'copper' | 'brass' | 'enamel' | 'ceramic' | 'glass'
  | 'wood' | 'plastic' | 'fabric' | 'paper' | 'marble' | 'wicker';
/** which burner an item stands on; centre only exists on a 5/6-burner range */
export type Burner =
  | 'left-back' | 'left-front' | 'centre-back' | 'centre-front' | 'right-back' | 'right-front';

export interface DecorItem {
  kind: DecorItemKind;
  /** the model's own words: what it is and its colour, ≤ 40 chars */
  label: string;
  on: DecorItemOn;
  /** wall of the host surface; 'island' for the island top; null only for a floor item */
  wall: Wall | 'island' | null;
  /** centre along that wall, LEFT→RIGHT as seen facing it (wallFrame convention) */
  t: number;
  /** counter / island / sill: 0 = against the splash / back edge, 1 = at the front edge.
   *  null = the per-kind default. */
  depthT: number | null;
  /** on:'shelf' only — which board, 0 = lowest. null = the top board. */
  shelfIndex: number | null;
  /** on:'range' only — which burner it stands on. null = the next free one. */
  burner: Burner | null;
  /** the object's LONGEST dimension, inches */
  sizeIn: number;
  /** dominant colour in neutral daylight, '#RRGGBB' */
  colorHex: string;
  material: DecorItemMaterial;
  /** identical things in a row (canisters) or a stack (plates); 1 otherwise */
  count: number;
}

/** What shows behind one glass-front or open wall cabinet, keyed by (wall, t). */
export interface CabinetContents {
  wall: Wall;
  /** the cabinet's centre along its wall, left→right facing it */
  t: number;
  kind: 'plates' | 'bowls' | 'glasses' | 'mugs' | 'jars' | 'cookbooks' | 'bottles' | 'mixed' | 'empty';
  density: 'sparse' | 'full';
}

export interface DecorSpec {
  shelves: OpenShelf[];
  plants: Plant[];
  art: WallArt[];
  rug: { present: boolean; lengthFt: number; widthFt: number; style: 'runner' | 'area' | 'round' } | null;
  windowTreatment: 'none' | 'roman-shade' | 'roller' | 'curtains' | 'blinds' | 'cafe-curtain';
  /** how much everyday clutter the counters carry */
  counterStyling: 'none' | 'minimal' | 'lived-in';
  /** what the counter stools look like; null = derived from the room style */
  stools: {
    style: 'backless' | 'low-back' | 'full-back' | 'saddle';
    frame: 'light-wood' | 'dark-wood' | 'black-metal' | 'brass' | 'white';
    seat: 'woven' | 'upholstered' | 'wood' | 'leather' | 'metal';
    /** the SEAT PAD's plan shape, which `style` cannot say: a backless stool
     *  is round in nine kitchens out of ten and square in the tenth, and the
     *  two read completely differently across a counter. null = 'round',
     *  which is the only pad the scene has ever drawn. */
    seatShape?: 'round' | 'square' | null;
    /** the seat's own colour in neutral daylight, '#RRGGBB'. null = the seat
     *  material's stock colour (a 'leather' seat is tan #8b5a34), which is
     *  what the scene has always used — there is no finish observation for
     *  stools, so this is the only route a photo's leather has into the twin. */
    seatColorHex?: string | null;
  } | null;
  /** every small object standing ON a surface — a pot on a burner, a kettle, a
   *  knife block, canisters; in a bathroom the towels, the soap pump, the
   *  toothbrush cup, the bath mat. Never priced.
   *
   *  A bathroom has no range and no island, so `on` there means: 'counter' =
   *  the VANITY TOP, 'shelf' = an open shelf, 'sill' = a window sill, 'floor' =
   *  the floor. The reconciler re-hosts anything else onto the vanity top, so
   *  no host word had to be added and no consumer has a new case to handle. */
  items: DecorItem[];
  /** what shows behind each glass-front or open wall cabinet, keyed by (wall, t) */
  cabinetContents: CabinetContents[];
}

export type FinishFamily =
  | 'paint' | 'stained-wood' | 'quartz' | 'granite' | 'marble' | 'quartzite' | 'butcher-block' | 'laminate' | 'concrete' | 'terrazzo' | 'soapstone'
  | 'porcelain-tile' | 'ceramic-tile' | 'glass-tile' | 'stone-tile' | 'hardwood' | 'engineered-wood' | 'lvp' | 'laminate-floor'
  | 'stainless' | 'brass' | 'nickel' | 'bronze' | 'black-metal' | 'chrome' | 'copper' | 'glass' | 'fabric' | 'brick' | 'stucco' | 'siding' | 'shingle' | 'other';

export type FinishPattern =
  | 'solid' | 'veined' | 'speckled' | 'wood-grain' | 'subway' | 'stacked' | 'herringbone' | 'hex' | 'mosaic' | 'large-format'
  | 'checker' | 'plank' | 'lap' | 'board-batten' | 'brick' | 'shingle' | 'zellige' | 'other';

export type FinishSheen = 'matte' | 'satin' | 'semi-gloss' | 'gloss' | 'polished' | 'honed' | 'brushed' | 'weathered';

/**
 * What the analyzer actually SAW on one material slot, before it was snapped
 * to a catalog id. Colours are estimated under neutral light (i.e. what the
 * surface would look like in daylight, not what the warm photo shows). The
 * matcher uses these to pick the closest catalog entry, and when nothing is
 * close enough it synthesises a custom material with exactly these colours.
 */
export interface FinishObservation {
  /** a MaterialSlotId; typed loosely because it comes straight from the model and is validated by the matcher */
  slot: string;
  family: FinishFamily;
  /** '#RRGGBB' */
  baseColorHex: string;
  /** vein / grain / speckle colour, '#RRGGBB' or null */
  accentColorHex: string | null;
  pattern: FinishPattern;
  sheen: FinishSheen;
  /** tile / plank module size in inches, or null when not applicable */
  moduleIn: { w: number; h: number } | null;
  groutColorHex: string | null;
  /** one plain phrase a contractor would write on a spec sheet */
  description: string;
  /** how well the surface was actually visible */
  visibility: 'clear' | 'partial' | 'inferred';
  /**
   * Which way the boards / courses run, for a plank, lap or herringbone
   * surface. Told in the PHOTO's terms because that is what a model can see:
   * 'toward' = the joints recede toward the wall named by
   * `detected.camera.lookingAt` (they converge on the vanishing point),
   * 'across' = they run parallel to that wall, 'diagonal' = 45°. null for
   * anything with no direction (tile, slab, paint, metal) and for a plank
   * whose joints are hidden — which leaves the recipe's own orientation, i.e.
   * exactly what the twin drew before this field existed.
   */
  plankRun?: PlankRun | null;
}

/** @see FinishObservation.plankRun */
export type PlankRun = 'toward' | 'across' | 'diagonal';

// ---------------------------------------------------------------------------
// Photo inventory — pixel-space boxes for everything visible in the primary
// photo. The fitter projects the twin's elements through a camera and adjusts
// camera + spec until they land on these; that is the measurable definition
// of "the twin matches the photo".
// ---------------------------------------------------------------------------

export type PhotoElementKind =
  | 'base-cabinet-run' | 'upper-cabinet-run' | 'tall-cabinet' | 'fridge' | 'range' | 'cooktop' | 'hood' | 'dishwasher' | 'wall-oven' | 'microwave'
  | 'sink' | 'faucet' | 'window' | 'door' | 'island' | 'stool' | 'pendant' | 'shelf' | 'plant' | 'art' | 'rug' | 'backsplash'
  | 'item'
  | 'vanity' | 'mirror' | 'shower' | 'tub' | 'toilet' | 'towel-bar'
  | 'wall' | 'floor' | 'ceiling' | 'other';

/** Normalised image box: (0,0) is the photo's top-left, (1,1) bottom-right. */
export interface ImageBox { x0: number; y0: number; x1: number; y1: number }

/**
 * Which edges of a `PhotoElement.box` are a CUT rather than the element's own
 * boundary — the frame crops it there, or a nearer object hides it. Without
 * this an island that runs off the left of the picture is measured as if the
 * visible part were the whole thing, and the fitter, which scores |log(tw/pw)|
 * symmetrically, punishes a twin that is correctly LONGER exactly as hard as
 * one that is too short. An open edge turns "exactly this big" into "at least
 * this big".
 *
 * Four plain booleans, no tuple: a zod tuple emits `prefixItems`, which OpenAI
 * strict mode rejects.
 */
export interface BoxOpenEdges { left: boolean; right: boolean; top: boolean; bottom: boolean }

/**
 * Why the box is open. A 'frame'-open edge carries one extra fact the fitter
 * can use — the twin must ALSO run off the picture there, which is the only
 * positive gradient toward a BIGGER element. An 'occluded' edge carries no
 * such fact: the island hides the left half of the back cabinet run, and the
 * twin's run must not overhang the frame to pay for it.
 */
export type BoxOpenCause = 'frame' | 'occluded' | 'both';

export interface PhotoElement {
  id: string;
  kind: PhotoElementKind;
  /** the wall it sits on / against, 'island' for island things, null when unknown (a rug, a pendant) */
  wall: Wall | 'island' | null;
  box: ImageBox;
  /**
   * Which way the element's FRONT faces in the photo: 'front' = seen face-on
   * (it is on the wall the camera faces), 'left' / 'right' = its front is
   * turned toward that side of the frame (it is on the opposite side wall,
   * facing into the room), 'edge' = seen almost edge-on. This is the cue that
   * puts a fridge on the right wall instead of the back wall's far right.
   */
  facing: 'front' | 'left' | 'right' | 'edge' | null;
  /** short plain label, e.g. "36in stainless french-door fridge with white surround" */
  label: string;
  confidence: number;
  /** which edges of `box` are a cut, not the element's own boundary.
   *  null / absent = nothing is cut (an older inventory), which is exactly how
   *  every box was read before the field existed. */
  open?: BoxOpenEdges | null;
  /** why those edges are open; null when no edge is. */
  openCause?: BoxOpenCause | null;
}

/**
 * A camera the fitter solved, in the room frame (metres). yawDeg 0 looks
 * toward -z (the back wall) and increases turning toward +x; pitchDeg is
 * positive looking DOWN; fovDeg is the VERTICAL field of view; aspect is the
 * photo's width ÷ height; score is the mean IoU the fit reached (0..1).
 */
export interface SolvedCamera {
  x: number; y: number; z: number;
  yawDeg: number; pitchDeg: number;
  fovDeg: number; aspect: number;
  score: number;
}

export interface RoomDims {
  widthFt: number;   // along the back wall (x)
  depthFt: number;   // front→back (z)
  ceilingFt: number; // y
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

export type KitchenLayout = 'single-wall' | 'galley' | 'l-shaped' | 'u-shaped' | 'peninsula' | 'g-shaped';
export type CabinetDoorStyle = 'shaker' | 'flat' | 'raised' | 'slab' | 'beaded' | 'glass' | 'open';
export type BaseCabinetType = 'door' | 'drawers' | 'sink-base' | 'corner' | 'appliance-gap' | 'open';
export type UpperCabinetType = 'door' | 'glass' | 'open-shelf' | 'appliance-gap' | 'hood-gap' | 'corner';

export interface BaseCabinet { widthIn: number; type: BaseCabinetType; drawerCount?: number | null }
export interface UpperCabinet {
  widthIn: number;
  type: UpperCabinetType;
  /** this wall cabinet's own box height, inches, hung from the run's top line
   *  downward (a shorter box over the fridge, a stacked glass box).
   *  null = the run's height. */
  heightIn?: number | null;
}

export interface CabinetRun {
  id: string;
  wall: Wall;
  /** 0..1 start position along the wall */
  start: number;
  lengthFt: number;
  base: BaseCabinet[];
  uppers: UpperCabinet[] | null;
  /** tall pantry / oven tower segments, expressed as [start(0..1 of run), widthIn][].
   *  `toCeiling` true = this unit's top meets the ceiling whatever the run's
   *  uppers do; null = today's rule (the run's upper top, else 84"). */
  tall: Array<{ t: number; widthIn: number; kind: 'pantry' | 'oven-tower' | 'fridge-surround'; toCeiling?: boolean | null }>;
  hasUppers: boolean;
  uppersToCeiling: boolean;
  /** whether the backsplash covers this run (a photo often shows tile behind
   *  the range wall only, with painted wall behind a side run) */
  backsplash: boolean;
  /** this run's wall-cabinet height in inches when it differs from cabinets.upperHeightIn; null = room default */
  upperHeightIn: number | null;
  /** Absolute underside above the floor; null preserves the usual counter-to-upper gap. */
  upperBottomIn?: number | null;
  /**
   * The SECOND, shorter tier of wall cabinets — the row of transom boxes that
   * sits ON TOP of `uppers` and runs to the top of the row, with a rail
   * between the two. Same grammar as `uppers`: one entry per box, LEFT→RIGHT
   * facing the wall, widths summing to the run length, 'hood-gap' /
   * 'appliance-gap' where the tier is interrupted.
   *
   * null = one tier, which is every spec written before this field existed and
   * is what the scene has always drawn. A whole row rather than a per-cabinet
   * flag because the accuracy pass's path grammar substitutes ONE index at
   * every `[]` (see refine.ts readPath), so `runs[].uppers[].something` can
   * only ever address `runs[i].uppers[i]` — unreachable from a correction.
   */
  uppers2?: UpperCabinet[] | null;
  /**
   * Height of a tier-2 box in inches, measured DOWN from the top of the row;
   * tier 1 then gets `rowHeight - uppers2HeightIn`. null = derive it (see
   * `resolveUppers2HeightIn` in @/lib/spec/uppers). A plain scalar beside
   * `upperHeightIn` on purpose: this is the one number the accuracy pass can
   * actually address.
   */
  uppers2HeightIn?: number | null;
}

export interface Island {
  present: boolean;
  kind: 'island' | 'peninsula' | 'breakfast-bar';
  lengthFt: number;
  widthFt: number;
  /** centre offset from room centre (x,z in feet) */
  offset: { x: number; z: number };
  rotationDeg: 0 | 90;
  seating: number;
  overhangIn: number;
  waterfall: boolean;
  hasSink: boolean;
  hasCooktop: boolean;
  /** centre-to-centre stool spacing in inches (0 = auto, ≤ 28") */
  stoolPitchIn: number;
  /** how many of the stools sit round the short end (0 = all along the long side) */
  endSeats: number;
  /** which short end carries the endSeats stools, seen facing the back wall.
   *  'both' splits them (needs endSeats ≥ 2 and both ends clear). */
  endPlacement: 'auto' | 'left' | 'right' | 'both';
  /** how far the top overhangs the cabinet body at EACH short end, inches;
   *  null = 1.5". At ≥ 6" the end stools tuck UNDER the top instead of
   *  standing past it. */
  endOverhangIn: number | null;
  /** shift of the side-stool row along the island from centred, inches,
   *  + toward the right end. 0 = centred. */
  stoolOffsetIn: number;
}

export type ApplianceKind = 'fridge' | 'range' | 'cooktop' | 'wall-oven' | 'hood' | 'dishwasher' | 'microwave' | 'wine-fridge';
export interface Appliance {
  /** Visible door-mounted water/ice dispenser; null or absent means unobserved. */
  hasDispenser?: boolean | null;
  kind: ApplianceKind;
  wall: Wall | 'island';
  t: number;
  widthIn: number;
  finish: 'stainless' | 'black-stainless' | 'panel-ready' | 'white' | 'black' | 'matte-black';
  /** hood style when kind === 'hood' */
  hoodStyle?: 'chimney' | 'under-cabinet' | 'custom-insert' | 'island' | 'none' | null;
  /** hood canopy shape when kind === 'hood': box chimney, tapered canopy, curved bell, a wood box matching the uppers, or a slim insert */
  hoodShape?: 'box' | 'tapered' | 'curved' | 'wood-canopy' | 'slim' | null;
  /** fridge style */
  fridgeStyle?: 'french-door' | 'side-by-side' | 'counter-depth' | 'built-in' | 'top-freezer' | null;
  /** this appliance's own body finish when it differs from the room's appliance finish (a black hood over a stainless range); null = follow the appliances slot */
  bodyFinish?: 'stainless' | 'black-stainless' | 'panel-ready' | 'white' | 'black' | 'matte-black' | null;
  /** overall height in inches — a fridge's body; for a hood, its canopy plus
   *  its VISIBLE duct cover measured from the underside, i.e. to the ceiling,
   *  or to the underside of the cabinet that sits on it. null = default for
   *  the kind */
  heightIn?: number | null;
  /** hood only: canopy underside above the finished counter, inches; null = 30" */
  aboveCounterIn?: number | null;
  /** hood only: what is built on top of the canopy, from the top of the hood
   *  unit up to the top of the wall-cabinet row (under the crown). 'doors' = a
   *  wall cabinet with door(s) in the run's door style on the cabinets_upper
   *  finish; 'glass' = the same box with glass doors; 'panel' = a plain
   *  flat-fronted box / chase in the cabinet finish, no doors, no hardware;
   *  'none' = bare wall or a narrower duct cover running to the ceiling.
   *  null = derived from the hood style (see @/lib/spec/hood). */
  cabinetAbove?: 'none' | 'doors' | 'glass' | 'panel' | null;
}

export interface KitchenSpec {
  roomType: 'kitchen';
  dims: RoomDims;
  scanGeometry?: ScannedRoomGeometry | null;
  scanDesign?: ScanDesign | null;
  style: DesignStyle;
  layout: KitchenLayout;
  runs: CabinetRun[];
  island: Island;
  appliances: Appliance[];
  sink: { wall: Wall | 'island'; t: number; kind: 'undermount' | 'farmhouse' | 'drop-in' | 'double'; widthIn: number };
  cabinets: {
    doorStyle: CabinetDoorStyle;
    twoTone: boolean;
    baseHeightIn: number;   // 34.5 typical
    baseDepthIn: number;    // 24
    upperHeightIn: number;  // 12–48; short rows above windows are valid
    upperDepthIn: number;   // 12–13
    toeKickIn: number;      // 4.5
    crown: boolean;
    hardware: 'pulls' | 'knobs' | 'mixed' | 'integrated' | 'none';
  };
  countertop: {
    thicknessIn: number;
    edge: 'eased' | 'bullnose' | 'bevel' | 'ogee' | 'mitered';
    /** front overhang of the perimeter counter past the base cabinet faces,
     *  inches. null = 1.5". */
    overhangIn?: number | null;
  };
  backsplash: {
    present: boolean;
    height: 'standard' | 'full-height' | 'ledge';
    pattern: 'running-bond' | 'stacked' | 'herringbone' | 'slab' | 'mosaic' | 'hex';
    /** the span under the hood: 'same' as the rest, or a feature slab that
     *  runs 'full-height' to the hood / ceiling while the rest stays standard */
    behindRange: 'same' | 'full-height';
    /** height of the splash field above the finished counter, inches, measured
     *  to where the tile or slab STOPS. Overrides the `height` category
     *  everywhere the field is drawn, INCLUDING the span behind the hood.
     *  null = use the category. */
    heightIn?: number | null;
  };
  openings: Opening[];
  lighting: LightingSpec;
  decor: DecorSpec;
  /** material slot → catalog material id (as detected in the photo) */
  materials: KitchenMaterialSlots;
  detected: DetectionMeta;
}

export interface KitchenMaterialSlots {
  cabinets_base: string;
  cabinets_upper: string;
  island_cabinets: string;
  /** pantry / oven tower / fridge surround (side panels + the cabinet over
   *  the fridge). Its own slot because a painted white surround beside
   *  stained-wood bases and uppers is common, and base-vs-upper cannot say it. */
  cabinets_tall: string;
  countertop: string;
  island_countertop: string;
  backsplash: string;
  flooring: string;
  walls: string;
  ceiling: string;
  hardware: string;
  faucet: string;
  appliances: string;
  lighting_fixture: string;
}

// ---------------------------------------------------------------------------
// Bathroom
// ---------------------------------------------------------------------------

export type BathroomLayout = 'powder' | 'full' | 'three-quarter' | 'primary' | 'jack-and-jill';

/**
 * The plumbing / hardware metal, as a WORD rather than a catalog id.
 *
 * The room already has a `fixtures` slot and a `hardware` slot, and those stay
 * the source of truth for what the twin renders and what the estimate prices.
 * These fields exist because a photo routinely shows TWO metals — a chrome
 * shower door on a bathroom whose faucet is matte black — and one slot cannot
 * say that. `null` everywhere means "follow the room's slot", which is exactly
 * what every spec written before these fields existed meant.
 */
export type FixtureFinish =
  | 'chrome' | 'brushed-nickel' | 'polished-nickel' | 'matte-black' | 'brushed-gold'
  | 'polished-brass' | 'oil-rubbed-bronze' | 'stainless' | 'white' | 'black';

/**
 * How the tiles are laid. A superset of the kitchen backsplash's six, because
 * a bathroom's tile is most of a bathroom photograph and the layouts that only
 * ever show up in a bathroom (a vertical stack, penny round, basketweave, a
 * chevron accent) are precisely the ones a client points at.
 */
export type TilePattern =
  | 'stacked' | 'running-bond' | 'vertical-stack' | 'herringbone' | 'chevron'
  | 'basketweave' | 'hex' | 'penny' | 'mosaic' | 'large-format' | 'slab';

/** A tile / plank module in inches, as LAID (w across, h up). */
export interface TileModule { w: number; h: number }

/**
 * The one wall done differently from the field — the tiled wall behind a
 * freestanding tub, a herringbone vanity wall, a slab shower back. It is a
 * separate object rather than another `wallTile.height` word because "accent
 * wall" as a height cannot say WHICH wall, in WHAT pattern, to WHAT height.
 * null = there is no accent, which is what `height: 'accent-wall'` alone has
 * always drawn (the vanity wall, in the field tile).
 */
export interface WallTileAccent {
  wall: Wall;
  pattern: TilePattern;
  /** null = the pattern's stock module */
  moduleIn: TileModule | null;
  /** where it stops above the finished floor, inches; null = to the ceiling */
  heightIn: number | null;
  /** its own colour in neutral daylight, '#RRGGBB'; null = the wall_tile material */
  colorHex: string | null;
}

/**
 * Where the shower niche is cut, in the STALL's own frame: 'back' is the wall
 * opposite the door, 'left' / 'right' as seen standing in the stall facing
 * that back wall. null on `shower.nicheAt` = wherever the scene has always put
 * it, so `niche: true` alone keeps drawing exactly what it drew.
 */
export interface ShowerNiche {
  face: 'back' | 'left' | 'right';
  /** 0..1 centre along that face, left→right as seen facing it */
  t: number;
  /** centre height above the finished floor, inches (a shampoo niche sits 44–52") */
  centerIn: number;
  widthIn: number;
  heightIn: number;
  /** shelves inside; 0 = one open box */
  shelves: number;
}

/**
 * A towel bar, a ring, a hook, a grab bar, the paper holder. They did not
 * exist in the contract at all, so a bathroom twin had bare walls where the
 * photo has the two things a client looks for first. Never priced as their own
 * line (the estimate's fixture allowance carries them); they are geometry.
 */
export type BathAccessoryKind =
  | 'towel-bar' | 'towel-ring' | 'hook' | 'robe-hook' | 'grab-bar'
  | 'toilet-paper-holder' | 'towel-warmer' | 'shower-caddy' | 'corner-shelf';

export interface BathAccessory {
  kind: BathAccessoryKind;
  wall: Wall;
  /** 0..1 centre along that wall, left→right facing it (wallFrame convention) */
  t: number;
  /** centre height above the finished floor, feet (a towel bar 4.0, a hook 5.5, a paper holder 2.1) */
  heightFt: number;
  /** the bar's / ring's length in inches; null = the kind's stock size */
  widthIn: number | null;
  /** null = follow the room's `hardware` slot */
  finish: FixtureFinish | null;
}

export interface BathroomSpec {
  roomType: 'bathroom';
  dims: RoomDims;
  scanGeometry?: ScannedRoomGeometry | null;
  scanDesign?: ScanDesign | null;
  style: DesignStyle;
  layout: BathroomLayout;
  /**
   * The vanity, front and all. The first eight fields say where it is and how
   * wide; everything after them describes the FACE, which is what a bathroom
   * photograph is mostly showing and which the contract previously could not
   * describe at all. Every one of them is null / absent = "as the scene has
   * always drawn it", so a spec written before they existed builds the same
   * cabinet it built.
   */
  vanity: {
    present: boolean;
    wall: Wall;
    t: number;
    widthIn: number;
    sinks: 1 | 2;
    style: 'floating' | 'freestanding' | 'furniture' | 'pedestal' | 'console';
    mirror: 'single' | 'double' | 'full-width' | 'medicine-cabinet' | 'none';
    doorStyle: CabinetDoorStyle;
    /** drawer stacks across the front; null = derived from width and sink count */
    drawers?: number | null;
    /** hinged doors across the front; null = derived the same way */
    doors?: number | null;
    /** how it meets the floor. A furniture vanity on turned legs and the same
     *  box on a plinth are different cabinets. null = the 6" turned leg a
     *  furniture vanity has always stood on, and 'none' (a plain toe kick)
     *  everywhere else. A floating / console / pedestal vanity has no legs. */
    legStyle?: 'none' | 'tapered' | 'turned' | 'square' | 'hairpin' | 'plinth' | null;
    /** vanity-top thickness, inches; null = 1.25 */
    counterThicknessIn?: number | null;
    /** the splash at the back of the top; null = the 4" upstand the scene has
     *  always drawn wherever the wall behind is not already tiled to the
     *  ceiling — which is 'standard' there and 'none' where it is */
    backsplash?: 'none' | 'standard' | 'full-height' | 'integrated' | null;
    /** top height above the finished floor, inches; null = 34 (33 on a
     *  pedestal), the heights the scene has always drawn */
    heightIn?: number | null;
    /** cabinet depth, inches; null = 21 */
    depthIn?: number | null;
    /** how the basin meets the top; null = the vessel a console (or a modern
     *  floating) vanity has always been drawn with, undermount elsewhere */
    basin?: 'undermount' | 'integrated' | 'vessel' | 'semi-recessed' | 'drop-in' | null;
    /** where the tap is mounted; null = the widespread set a vanity over 46"
     *  has always had in a non-modern room, a plain deck tap otherwise */
    faucetMount?: 'deck' | 'wall' | 'widespread' | 'centerset' | 'single-hole' | null;
    /** pulls / knobs on the front; null = what the design style has always
     *  chosen — cup pulls and knobs ('mixed') on a farmhouse, knobs on a
     *  traditional or craftsman, bar pulls on everything else */
    hardware?: 'pulls' | 'knobs' | 'mixed' | 'integrated' | 'none' | null;
    /** an open shelf (or a towel bar) under a floating vanity; null = false */
    openShelf?: boolean | null;
  };
  shower: {
    present: boolean;
    wall: Wall;
    t: number;
    widthIn: number;
    depthIn: number;
    enclosure: 'frameless-glass' | 'framed-glass' | 'curtain' | 'open' | 'tub-shower';
    niche: boolean;
    bench: boolean;
    curbless: boolean;
    fixtures: 'single' | 'rain' | 'rain-plus-handheld' | 'body-jets';
    /** panel thickness in inches — 3/8" (0.375) reads heavy and true frameless,
     *  1/4" (0.25) is a framed panel. null = the 10 mm the enclosure has
     *  always been drawn at, which is a hair over 3/8". */
    glassThicknessIn?: number | null;
    /** what actually opens. null = derived from `enclosure` (a frameless stall
     *  gets a hinged door, a curtain gets none), which is today's behaviour. */
    doorType?: 'hinged' | 'sliding' | 'barn' | 'pivot' | 'fixed-panel' | 'walk-in' | 'none' | null;
    /** the door's own hardware metal; null = the room's `fixtures` slot */
    hardwareFinish?: FixtureFinish | null;
    /** where the niche is cut; null = wherever the scene puts it (see ShowerNiche) */
    nicheAt?: ShowerNiche | null;
    /** the bench's shape when `bench` is true; null = the 440 mm corner block
     *  the stall has always been drawn with */
    benchStyle?: 'corner' | 'full-width' | 'floating' | null;
    /** curb height above the finished floor, inches; null = 0 when curbless, 4 otherwise */
    curbHeightIn?: number | null;
  };
  tub: {
    present: boolean;
    wall: Wall;
    t: number;
    kind: 'alcove' | 'freestanding' | 'drop-in' | 'clawfoot' | 'corner';
    lengthIn: number;
    /** what it is made of — a cast-iron roll-top and an acrylic soaker are not
     *  the same object at the same size. null = the `tub` material slot. */
    material?: 'acrylic' | 'cast-iron' | 'stone-resin' | 'solid-surface' | 'copper' | 'fiberglass' | 'steel' | 'wood' | null;
    /** how it is filled. A floor-mount filler beside a freestanding tub is the
     *  single most recognisable thing in a primary bath. null = derived from
     *  `kind` (alcove → a wall-mount diverter), which is today's behaviour. */
    fillerType?: 'deck-mount' | 'wall-mount' | 'floor-mount' | 'roman' | 'tub-shower-diverter' | 'none' | null;
    /** the filler's metal; null = the room's `fixtures` slot */
    fillerFinish?: FixtureFinish | null;
    /** how it meets the room; null = derived from `kind` */
    apron?: 'integral' | 'tiled' | 'panel' | 'skirted' | 'none' | null;
    /** across the tub, inches; null = the width the kind has always been drawn
     *  at — 32 freestanding, 31 clawfoot, 42 drop-in, 30 alcove (32 at 66"+) */
    widthIn?: number | null;
    /** rim above the finished floor, inches; null = the rim the kind has always
     *  been drawn at — 22.8 freestanding, 26.8 clawfoot, 19.8 alcove/corner */
    heightIn?: number | null;
  };
  toilet: {
    present: boolean;
    wall: Wall;
    t: number;
    style: 'two-piece' | 'one-piece' | 'wall-hung' | 'smart';
    /** the seat / trip-lever metal; null = the room's `fixtures` slot */
    trimFinish?: FixtureFinish | null;
  };
  /**
   * The wall tile — the surface that occupies most of a bathroom photograph.
   * It carried ONE field (`height`) against the kitchen backsplash's five,
   * which is why a bathroom twin could never say "3×12 white subway, laid
   * herringbone, to 48 inches". `height` still decides WHERE tile goes and
   * every field after it is null = "as before", so nothing that reads only
   * `height` changes.
   */
  wallTile: {
    height: 'none' | 'wainscot' | 'shower-only' | 'full' | 'accent-wall';
    /** where the field tile STOPS above the finished floor, inches. Overrides
     *  the `height` category's own stop line everywhere the field is drawn.
     *  null = the category (wainscot 42", full = the ceiling). */
    heightIn?: number | null;
    /** how it is laid; null = derived from the module (a 3×6 is running-bond) */
    pattern?: TilePattern | null;
    /** the module in inches as laid; null = the pattern's stock module */
    moduleIn?: TileModule | null;
    /** grout joint width, inches (1/16" = 0.0625, 1/8" = 0.125); null = 0.125 */
    groutWidthIn?: number | null;
    /** the cap at the top of a wainscot run; null = 'none' */
    trim?: 'none' | 'bullnose' | 'pencil' | 'chair-rail' | 'metal-edge' | null;
    /** the ONE wall done differently from the field; null = no accent */
    accent?: WallTileAccent | null;
    /** the shower's own layout when it differs from the field; null = the same */
    showerPattern?: TilePattern | null;
    showerModuleIn?: TileModule | null;
  };
  /** towel bars, rings, hooks, the paper holder, a grab bar. `[]` = a bare
   *  wall, which is every spec written before the field existed. */
  accessories?: BathAccessory[];
  openings: Opening[];
  lighting: LightingSpec;
  decor: DecorSpec;
  materials: BathroomMaterialSlots;
  detected: DetectionMeta;
}

export interface BathroomMaterialSlots {
  vanity_cabinet: string;
  vanity_top: string;
  floor_tile: string;
  wall_tile: string;
  shower_wall_tile: string;
  shower_floor_tile: string;
  walls: string;
  ceiling: string;
  fixtures: string;      // faucet / shower trim finish
  hardware: string;
  tub: string;
  lighting_fixture: string;
  mirror: string;
}

// ---------------------------------------------------------------------------
// Exterior / Lot
// ---------------------------------------------------------------------------

export type RoofType = 'gable' | 'hip' | 'flat' | 'shed' | 'gambrel' | 'dutch-gable' | 'cross-gable';
export type HouseStyle = 'craftsman' | 'modern-farmhouse' | 'modern' | 'colonial' | 'ranch' | 'cape-cod' | 'contemporary' | 'mediterranean' | 'tudor' | 'victorian' | 'northwest-contemporary';

export interface Elevation {
  wall: Wall;
  windows: Array<{ t: number; widthFt: number; heightFt: number; sillFt: number; floor: number; style?: Opening['style'] | null }>;
  doors: Array<{ t: number; widthFt: number; heightFt: number; kind: 'entry' | 'garage' | 'patio' | 'french' | 'side' }>;
  /** wall-specific siding override slot id, or null to use primary */
  sidingOverride: string | null;
  gableEnd: boolean;
}

export interface ExteriorSpec {
  roomType: 'exterior';
  style: DesignStyle;
  houseStyle: HouseStyle;
  /** if the photo/plan is an empty lot, `house.present` is false and a template house is proposed */
  lot: {
    widthFt: number;
    depthFt: number;
    slope: 'flat' | 'gentle' | 'steep';
    setbackFrontFt: number;
    orientation: 'north' | 'south' | 'east' | 'west';
    treesCount: number;
    fence: { present: boolean; sides: Wall[]; heightFt: number; };
  };
  house: {
    present: boolean;
    footprint: { widthFt: number; depthFt: number };
    /** optional L/T-shaped wing */
    wing: { present: boolean; wall: Wall; widthFt: number; depthFt: number; t: number } | null;
    stories: 1 | 2 | 3;
    storyHeightFt: number;
    roof: { type: RoofType; pitch: number; overhangFt: number; ridgeDirection: 'x' | 'z' };
    garage: { present: boolean; bays: 0 | 1 | 2 | 3; wall: Wall; t: number; attached: boolean };
    porch: { present: boolean; wall: Wall; widthFt: number; depthFt: number; columns: number; roofed: boolean };
    deck: { present: boolean; wall: Wall; widthFt: number; depthFt: number; railing: boolean };
    chimney: boolean;
    foundationExposedFt: number;
    trimWidthIn: number;
    shutters: boolean;
  };
  elevations: Elevation[];
  hardscape: {
    driveway: { present: boolean; widthFt: number; lengthFt: number; side: 'left' | 'right' | 'center' };
    walkway: { present: boolean; widthFt: number };
    patio: { present: boolean; widthFt: number; depthFt: number };
    pool: { present: boolean; lengthFt: number; widthFt: number };
  };
  lighting: { exteriorSconces: number; landscape: boolean; timeOfDay: 'morning' | 'noon' | 'golden-hour' | 'dusk' };
  materials: ExteriorMaterialSlots;
  detected: DetectionMeta;
}

export interface ExteriorMaterialSlots {
  siding_primary: string;
  siding_accent: string;
  trim: string;
  roof: string;
  front_door: string;
  garage_door: string;
  window_frames: string;
  foundation: string;
  porch_columns: string;
  deck: string;
  railing: string;
  driveway: string;
  walkway: string;
  patio: string;
  lawn: string;
  fence: string;
  gutters: string;
}

// ---------------------------------------------------------------------------
// Floor plan — a whole house, not one room
// ---------------------------------------------------------------------------
//
// The three specs above each describe ONE room and hang everything off four
// named walls. A floor plan cannot work that way: a house has rooms whose
// walls are shared, doors that belong to a wall rather than to a room, and
// stairs that belong to no room at all. So the floor plan model is built the
// way a drawing actually is — a set of wall SEGMENTS, with rooms, doors and
// windows hanging off them.
//
// COORDINATES (the full convention, with the scene mapping, is in
// @/lib/spec/floorplan — read the doc comment there before drawing anything):
// plan feet, origin at the plan's bottom-left, +x right, +y up the sheet
// (plan north). Every helper in this app obeys it.

/** A point in plan feet. An object, never a tuple: a zod tuple emits
 *  `prefixItems`, which OpenAI strict mode rejects. */
export interface PlanPoint { x: number; y: number }

/** What a room is FOR. Drives the default floor slot, the estimator's
 *  quantities and whether a scene stream draws a wet-room floor. */
export type PlanRoomKind =
  | 'bedroom' | 'bathroom' | 'powder' | 'kitchen' | 'living' | 'dining' | 'family'
  | 'hall' | 'entry' | 'closet' | 'laundry' | 'garage' | 'office' | 'stair'
  | 'mechanical' | 'other';

/** The two floor finishes a ROOM can carry. Stair treads are on the stair. */
export type PlanFloorSlot = 'flooring' | 'floor_tile';

/**
 * One wall SEGMENT in plan feet, from (x1,y1) to (x2,y2) along its CENTRE
 * LINE. Segments rather than rectangles because a plan is drawn as segments
 * and everything else hangs off them: a door and a window carry a wallId and
 * a `t` along it, and a room's polygon runs along wall centre lines.
 *
 * `bearing` is advisory — it never changes geometry, it tells the estimator
 * and the notes that removing this wall is structural work.
 */
export interface PlanWall {
  id: string;
  x1: number; y1: number; x2: number; y2: number;
  thicknessIn: number;
  /** an envelope wall (outside on one face) rather than a partition */
  exterior: boolean;
  /** load-bearing as drawn or noted on the sheet */
  bearing: boolean;
  /** wall height in feet; null = the level's `ceilingFt` (the usual case) */
  heightFt: number | null;
}

/**
 * One room as the sheet labels it. `polygon` is the room's finished floor
 * outline in plan feet, in order, IMPLICITLY CLOSED (never repeat the first
 * point) and wound counter-clockwise in plan space (positive shoelace area) —
 * `healFloorPlan` rewinds a clockwise one rather than rejecting it.
 *
 * `areaSqft` is the number PRINTED on the sheet, and null when none is: a
 * computed area is always available from the polygon (`planPolygonArea`), so
 * a filled-in value here would destroy the one thing worth keeping, which is
 * whether the drawing agreed with the geometry.
 *
 * A room carries no "open to below" flag because the openings are DERIVED,
 * once, from the flights: `floorHoles(spec, levelIndex)` in @/lib/spec/floorplan
 * returns the rings a level's floor has to be cut by. A floor mesh per room
 * polygon with nothing subtracted decks over the stairwell.
 */
export interface PlanRoom {
  id: string;
  /** exactly as written on the sheet: "Master Suite", "Bath 2", "Great Room" */
  name: string;
  kind: PlanRoomKind;
  polygon: PlanPoint[];
  areaSqft: number | null;
  floorSlot: PlanFloorSlot;
}

export type PlanDoorKind =
  | 'swing' | 'double' | 'pocket' | 'bifold' | 'barn' | 'sliding'
  | 'cased-opening' | 'garage' | 'exterior';

/**
 * A door in a wall. `t` is 0..1 along that wall from (x1,y1) to (x2,y2) — the
 * segment's own direction, NOT the "as seen from inside" rule the single-room
 * specs use, because a plan wall has no inside.
 *
 * `hand` and `swingsInto` are the swing arc as drawn: hand is which edge the
 * hinges are on looking along the wall in its (x1,y1)→(x2,y2) direction, and
 * `swingsInto` names the room the leaf opens into. Both null on a door that
 * has no swing (pocket, sliding, barn, cased opening).
 */
export interface PlanDoor {
  id: string;
  wallId: string;
  t: number;
  widthIn: number;
  heightIn: number;
  kind: PlanDoorKind;
  hand: 'left' | 'right' | null;
  swingsInto: string | null;
}

export type PlanWindowKind =
  | 'fixed' | 'single-hung' | 'double-hung' | 'casement' | 'slider'
  | 'awning' | 'bay' | 'picture' | 'transom' | 'egress';

/** A window in a wall. `t` follows the same rule as a door's. */
export interface PlanWindow {
  id: string;
  wallId: string;
  t: number;
  widthIn: number;
  heightIn: number;
  /** finished floor to the bottom of the glass */
  sillIn: number;
  kind: PlanWindowKind;
}

/**
 * The landing an L-, U- or winder stair turns on. `atTread` is which tread
 * the landing REPLACES, counted from the bottom (1 = the landing is the first
 * step off the lower floor), so the flight below it has `atTread - 1` treads
 * and the flight above has `treads - atTread`. `turn` is which way the upper
 * flight heads, seen by somebody walking up.
 */
export interface PlanStairLanding {
  atTread: number;
  widthFt: number;
  depthFt: number;
  turn: 'left' | 'right' | 'straight' | 'u-turn';
}

export type PlanStairKind = 'straight' | 'l-shaped' | 'u-shaped' | 'winder' | 'spiral';

/**
 * A flight of stairs. The client named these specifically, so they are
 * first-class: a flight is listed ONCE, on the level it stands on, and
 * `connects.fromLevel` is that level's index.
 *
 * `footprint` is the un-rotated rectangle the whole assembly occupies: (x,y)
 * is its bottom-left corner in plan feet, `widthFt` runs along +x and `runFt`
 * along +y before rotation, and `rotationDeg` turns it counter-clockwise
 * about (x,y). So a flight with rotationDeg 0 climbs toward plan north. It is
 * also the ARBITER horizontally — it is what the sheet draws — so `runFt`
 * beats `treads × treadIn` and `solvedTreadIn` is the depth to build;
 * `healFloorPlan` pulls the two back together when they are more than one
 * tread apart.
 *
 * `direction` is the arrow as DRAWN on this level's sheet ("UP" / "DN"); the
 * geometry follows `connects`, and `healFloorPlan` makes the two agree rather
 * than trusting a word over two indices. A set that prints the same flight on
 * both sheets — UP at its foot, DN at its head — is deduped to the copy on
 * the lower level, so a shaft holds one flight however many sheets drew it.
 *
 * Vertically the LEVELS are the arbiter: `solvedRiserIn` is the riser the
 * geometry must build, and the healer re-treads a flight whose riser lands
 * outside 4"–9" rather than leaving it unclimbable.
 */
export interface PlanStair {
  id: string;
  kind: PlanStairKind;
  footprint: { x: number; y: number; widthFt: number; runFt: number; rotationDeg: number };
  direction: 'up' | 'down';
  connects: { fromLevel: number; toLevel: number };
  /** number of TREADS; the risers are treads + 1 (the top riser lands on the floor above) */
  treads: number;
  riserIn: number;
  treadIn: number;
  handrail: 'none' | 'one-side' | 'both' | 'wall-mounted';
  /** null on a straight run, and on any kind that turns without a flat landing */
  landing: PlanStairLanding | null;
}

/**
 * One storey. `elevationFt` is its finished floor above grade and `ceilingFt`
 * its finished floor to finished ceiling, so the floor/ceiling assembly
 * between two storeys is implied — level n+1's elevation minus (level n's
 * elevation + ceiling) — and never stored twice where the two could disagree.
 */
export interface Level {
  id: string;
  /** as the sheet titles it: "First Floor", "Upper Level", "Basement" */
  name: string;
  /** 0 = ground; levels are stored in index order and indices are contiguous */
  index: number;
  elevationFt: number;
  ceilingFt: number;
  rooms: PlanRoom[];
  walls: PlanWall[];
  doors: PlanDoor[];
  windows: PlanWindow[];
  stairs: PlanStair[];
}

/**
 * A whole house read off a floor plan: the rooms and the stairs are there,
 * the rooms are EMPTY. No cabinetry, no fixtures, no décor — a plan carries
 * none of it, and inventing it is what the READING A DRAWING step in
 * `ai/prompt.ts` exists to refuse.
 */
export interface FloorPlanSpec {
  roomType: 'floorplan';
  style: DesignStyle;
  levels: Level[];
  materials: FloorPlanMaterialSlots;
  detected: DetectionMeta;
}

/**
 * The whole-house interior shell. Every slot here borrows an existing
 * catalogue shelf (see `SLOT_BORROWS` in @/lib/materials/catalog) so a
 * client has swatches to swap on day one.
 */
export interface FloorPlanMaterialSlots {
  /** the dry side of the house: living, dining, bedrooms, halls */
  flooring: string;
  /** the wet rooms: baths, laundry, entry, mudroom */
  floor_tile: string;
  walls: string;
  ceiling: string;
  /** baseboard, door and window casing, the stair skirt */
  interior_trim: string;
  /** interior door slabs */
  interior_doors: string;
  stair_treads: string;
  stair_railing: string;
}

// ---------------------------------------------------------------------------
// Union + metadata
// ---------------------------------------------------------------------------

export type RoomSpec = KitchenSpec | BathroomSpec | ExteriorSpec | FloorPlanSpec;

/** The specs that describe ONE room inside four named walls — the ones with
 *  `dims`, a photo camera and a décor layer. A floor plan has none of that. */
export type SingleRoomSpec = KitchenSpec | BathroomSpec;

/** Dimensions explicitly confirmed by a person. Vision must never invent these. */
export interface RoomMeasurements {
  widthFt: number | null;
  depthFt: number | null;
  ceilingFt: number | null;
  confirmedAt: string;
}

export interface DetectionMeta {
  /** Known dimensions of the existing room; null means photograph estimates only. */
  measurements?: RoomMeasurements | null;
  /** 0..1 model confidence in the reconstruction */
  confidence: number;
  /** plain-language description of what was seen (used in prompts + UI) */
  summary: string;
  /** noteworthy observations, e.g. "load-bearing wall likely", "existing tile is 12x24" */
  notes: string[];
  /** what the analyzer could not determine and assumed */
  assumptions: string[];
  /** which photo index drove the primary view */
  primaryPhotoIndex: number;
  /** camera description for the primary photo (for matching 3D camera) */
  camera: {
    fovDeg: number; heightFt: number;
    position: 'front' | 'corner-left' | 'corner-right' | 'side-left' | 'side-right' | 'top';
    lookingAt: Wall;
    /** exact camera the fitter solved against the photo's inventory, or null */
    solved: SolvedCamera | null;
  };
  /** per-slot colour / pattern / sheen observations that drove `materials` */
  finishes: FinishObservation[];
  /** pixel-space inventory of the primary photo (empty when not inventoried) */
  elements: PhotoElement[];
  /** where the back wall sits in the photo frame and which side walls show — the inventory's frame block, or null */
  frame: PhotoFrame | null;
  /** the photo inventory's own repeatability, filled by the server: how many
   *  annotation passes succeeded and their mean pairwise agreement. null = not
   *  inventoried. The analyzer must leave this null. */
  inventory?: { samples: number; agreement: number | null } | null;
  /**
   * What the analyzer decided it was looking AT — a room photograph, bare
   * ground, a drawn plan, a drawing set. This is the switch the app reads to
   * decide whether to ask the client the intake questions instead of guessing
   * finishes nothing in the picture shows. Absent / 'room-photo' = today's
   * behaviour, which is to ask nothing.
   */
  inputKind?: InputKind;
}

/** The inventory's read of the photo's framing: the back wall's horizontal span and which side walls are visible. */
export interface PhotoFrame {
  backWallSpansX: [number, number];
  leftWallVisible: boolean;
  rightWallVisible: boolean;
}

export type MaterialSlotId =
  | keyof KitchenMaterialSlots
  | keyof BathroomMaterialSlots
  | keyof ExteriorMaterialSlots
  | keyof FloorPlanMaterialSlots;

// ---------------------------------------------------------------------------
// Project / jobs / estimates
// ---------------------------------------------------------------------------

export interface Photo {
  url: string;
  width?: number;
  height?: number;
  /** ordering + which one the user marked as primary */
  primary?: boolean;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface RenderJob {
  id: string;
  provider: 'openai' | 'google' | 'higgsfield';
  status: JobStatus;
  createdAt: string;
  /** which selections produced this render (slot → material id) */
  selections: Record<string, string>;
  /** the photo (or 3D screenshot) this render was derived from */
  sourceUrl: string;
  sourceKind: 'photo' | 'viewport';
  prompt: string;
  resultUrl?: string;
  error?: string;
  elapsedMs?: number;
  /** Immutable Jarvis design option used for this image. */
  optionId?: string;
  designFingerprint?: string;
  /** Captured/design finish intent of the native view used for this image. */
  scanAppearanceToken?: string;
}

export interface ScanJob {
  id: string;
  provider: 'higgsfield' | 'meshy';
  model: string;
  status: JobStatus;
  createdAt: string;
  sourceUrl: string;
  resultUrl?: string;
  error?: string;
  progress?: number;
}

export interface EstimateSettings {
  region: string;          // key into REGIONS
  tier: Tier;              // default labor/material tier when a material has no tier
  contingencyPct: number;  // 0.10
  markupPct: number;       // contractor overhead+profit, 0.20
  scope: 'cosmetic' | 'pull-and-replace' | 'full-gut';
  includePermits: boolean;
  /** price only what differs from project.baseline, or a full pull-and-replace
   *  of the current twin (today's behaviour). Effective mode = baseline ? mode
   *  : 'full'. A settings object that predates the field is filled in by the
   *  store's v5 migration and by DEFAULT_ESTIMATE_SETTINGS, so every live
   *  value carries one. */
  mode: 'changes' | 'full';
  /** in changes mode, may the knock-on table pull dependent lines into scope */
  includeKnockOns: boolean;
  /** Keep the existing appliance package; no purchase or replacement installation allowance. */
  keepExistingAppliances?: boolean;
  /** Explicit replacement scope for native scans, including seed-ID choices. */
  scanFinishChoices?: Record<string, string>;
}

/** How one estimate line relates to the room as found. */
export type LineScope = 'changed' | 'added' | 'unchanged' | 'removed';

export interface EstimateLine {
  id: string;
  category: string;
  label: string;
  qty: number;
  unit: 'sqft' | 'lf' | 'each' | 'sq' | 'ls' | 'hr' | 'cy';
  materialLow: number;
  materialHigh: number;
  laborLow: number;
  laborHigh: number;
  totalLow: number;
  totalHigh: number;
  /** slot this line is driven by (for highlighting on hover) */
  slot?: MaterialSlotId | string;
  note?: string;
  /** how this line relates to the baseline */
  scope: LineScope;
  /** the baseline line's qty; 0 = new; null = full mode */
  baselineQty: number | null;
  /** what this line costs in a FULL remodel, whatever the scope charges */
  fullTotalLow: number;
  fullTotalHigh: number;
  /** why this line is in scope: 'material changed: Grey Oak → Hale Navy', 'knock-on: …', '+3 lf', 'new' */
  reason?: string;
}

/** The money block, computed once for the in-scope lines and once for a full remodel. */
export interface EstimateTotals {
  subtotalLow: number;
  subtotalHigh: number;
  contingencyLow: number;
  contingencyHigh: number;
  markupLow: number;
  markupHigh: number;
  taxLow: number;
  taxHigh: number;
  totalLow: number;
  totalHigh: number;
  /** headline midpoint */
  mid: number;
  timelineWeeksLow: number;
  timelineWeeksHigh: number;
}

/**
 * The top-level totals are the IN-SCOPE totals; `full` carries the
 * full-remodel numbers. In full mode the two agree, every line is
 * `scope: 'changed'` and the numbers are what the estimator has always
 * produced.
 */
export interface UnpricedScanWork {
  slot: string;
  label: string;
  materialId: string;
  materialName: string;
  objectIds: string[];
  reason: string;
}

export interface Estimate extends EstimateTotals {
  /** Requested scanned fixture work excluded from totals; absence supports older saved estimates. */
  unpriced?: UnpricedScanWork[];
  /** Exclusions from the full remodel comparison, including unchanged scanned fixtures. */
  fullUnpriced?: UnpricedScanWork[];
  lines: EstimateLine[];
  salesTaxPct: number;
  regionMultiplier: number;
  quantities: Record<string, number>;
  /** which number the headline is */
  mode: 'changes' | 'full';
  /** the "Full remodel $Y" block; equal to the top-level totals in full mode */
  full: EstimateTotals;
  /** in-scope mid ÷ full mid, 0..1 */
  scopeShare: number;
  /** non-allowance lines with scope changed | added | removed */
  changedCount: number;
  /** which trades this scope opens */
  trades: { demo: boolean; plumbing: boolean; electrical: boolean; drywall: boolean };
  baselineQuantities: Record<string, number> | null;
}

export type BaselineSource = 'analysis' | 'manual' | 'demo' | 'migrated';

/**
 * The room as found. The changes-only estimate diffs against this, which is
 * what stops an untouched twin from quoting a whole remodel the moment it
 * finishes analysing.
 */
export interface ProjectBaseline {
  /** the room as found */
  spec: RoomSpec;
  /** the healed slot → material map at capture time */
  selections: Record<string, string>;
  capturedAt: string;
  source: BaselineSource;
}

/**
 * One answer to one question from the intake catalogue
 * (@/lib/spec/intake). `value` is always a STRING — the option's value for a
 * choice, '#RRGGBB' for a colour, the number written out for a number, the
 * client's own words for text — because one shape survives persistence, a
 * share link and a schema without a union per question type. `values` carries
 * a multi-select and is empty for every other type.
 */
export interface IntakeAnswer {
  /** the question's id, e.g. 'kitchen.cabinet-colour' */
  id: string;
  value: string;
  values: string[];
  /**
   * True when this answer is the question's own default, filled in for a
   * client who never touched it (`completeAnswers` / `defaultAnswers`).
   *
   * It still lands — the interview shows every default preselected, so the
   * spec we build is the spec the client looked at — but it is the weakest
   * kind of statement there is, and `applyIntakeAnswers` ranks it below what
   * the surface ALREADY is. Without the flag, a constant like the roof
   * colour's '#3A3B3D' re-tinted the slate the client had just picked off the
   * swatch grid: a default nobody touched must not move a product somebody
   * chose. Optional so every persisted answer written before this existed
   * reads as what it was — the client's own.
   */
  fromDefault?: boolean;
}

/**
 * What the client uploaded and what they told us about it. `answers` is the
 * record of the guided intake — the questions asked when a photo could not
 * answer them (an empty lot, a floor plan) and what the client said.
 *
 * null on a Project = never asked, which is every project before this existed
 * and every plain room photo. `applyIntakeAnswers` is what turns the answers
 * into a spec; keeping the raw answers as well means the studio can re-ask,
 * show what was said, and re-apply after a re-analysis.
 */
export interface IntakeState {
  inputKind: InputKind;
  answers: IntakeAnswer[];
  /** ISO timestamp of when the client finished answering; null = not yet */
  capturedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  roomType: RoomType;
  createdAt: string;
  updatedAt: string;
  photos: Photo[];
  description: string;
  spec: RoomSpec | null;
  /** current material selections (slot → material id). Starts as spec.materials (= baseline.selections). */
  selections: Record<string, string>;
  /** structural toggles the user changed after analysis (e.g. add island) */
  overrides: Record<string, unknown>;
  /** the room as found — the changes-only estimate diffs against this. null for
   *  demo and template projects and for shares saved before this field existed. */
  baseline: ProjectBaseline | null;
  estimateSettings: EstimateSettings;
  renders: RenderJob[];
  scans: ScanJob[];
  /** what was uploaded and what the client answered about it; null = never
   *  asked (a plain room photo, or a project from before the guided intake) */
  intake: IntakeState | null;
  /** optional contractor branding for share pages */
  branding?: { company: string; phone?: string; email?: string; logoUrl?: string; accent?: string };
  client?: { name?: string; address?: string };
  jarvis?: import('@/lib/jarvis/types').JarvisState;
}
