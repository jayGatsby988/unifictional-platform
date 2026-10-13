/**
 * Zod schemas mirroring `types.ts`. Used to (1) validate analyzer output and
 * (2) generate the strict JSON schema handed to the vision model.
 *
 * Structured-output rules: every object key is required, no additionalProperties,
 * nullable instead of optional. `z.toJSONSchema` (zod 4) handles the emit.
 */
import { z } from 'zod';
import type { RoomType } from './types';
import { countertopSurfaceIssue } from '@/lib/native/countertop-surfaces';

export const WallZ = z.enum(['back', 'left', 'right', 'front']);
export const InputKindZ = z.enum(['room-photo', 'empty-lot', 'floor-plan', 'plans-document']);
export const TierZ = z.enum(['budget', 'standard', 'premium', 'luxury']);
export const DesignStyleZ = z.enum(['modern', 'contemporary', 'transitional', 'traditional', 'farmhouse', 'scandinavian', 'industrial', 'coastal', 'mid-century', 'craftsman', 'mediterranean']);

const ScanCoordinateZ = z.number().finite().min(-1000).max(1000);
const ScanPointZ = z.object({ x: ScanCoordinateZ, y: ScanCoordinateZ, z: ScanCoordinateZ });
export const ScannedCountertopSurfaceZ = z.object({
  polygonCorners: z.array(ScanPointZ.strict()).min(3).max(256),
  holes: z.array(z.array(ScanPointZ.strict()).min(3).max(256)).max(8).optional(),
  source: z.literal('lidar-mesh'),
  resolutionMeters: z.number().finite().positive().max(0.25),
}).strict().superRefine((surface, context) => {
  const issue = countertopSurfaceIssue(surface);
  if (issue) context.addIssue({ code: 'custom', message: issue });
});
const ScanTransformZ = z.array(ScanCoordinateZ).length(16).refine((m) => {
  const dot = (a: number, b: number) => m[a] * m[b] + m[a + 1] * m[b + 1] + m[a + 2] * m[b + 2];
  const determinant = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  return [0, 4, 8].every((a) => Math.abs(Math.sqrt(dot(a, a)) - 1) <= 0.0001)
    && Math.abs(dot(0, 4)) <= 0.0001 && Math.abs(dot(0, 8)) <= 0.0001 && Math.abs(dot(4, 8)) <= 0.0001
    && Math.abs(determinant - 1) <= 0.0001
    && Math.abs(m[3]) <= 0.0001 && Math.abs(m[7]) <= 0.0001 && Math.abs(m[11]) <= 0.0001 && Math.abs(m[15] - 1) <= 0.0001;
}, 'A scan transform must be a finite rigid 3D transform.');

export const ScanElementMetadataZ = z.object({
  parentIdentifier: z.string().min(1).max(160).optional(),
  attributes: z.array(z.string().min(1).max(160)).max(40).optional(),
  completedEdges: z.array(z.enum(['top', 'right', 'bottom', 'left'])).max(4).optional(),
  curve: z.object({ center: z.object({ x: ScanCoordinateZ, y: ScanCoordinateZ }).strict(), radius: z.number().finite().positive().max(1000), startAngleRadians: z.number().finite().min(-100).max(100), endAngleRadians: z.number().finite().min(-100).max(100) }).strict().optional(),
});
export const ScanObjectEditZ = z.object({
  offsetXMeters: z.number().finite().min(-20).max(20), offsetZMeters: z.number().finite().min(-20).max(20),
  rotationDegrees: z.number().finite().min(-180).max(180), scaleX: z.number().finite().min(0.25).max(4), scaleZ: z.number().finite().min(0.25).max(4), hidden: z.boolean(),
}).strict();
export const ScanTakeoffZ = z.object({
  id: z.string().min(1).max(160), slot: z.string().min(1).max(100), objectIds: z.array(z.string().min(1).max(160)).min(1).max(512),
  quantity: z.number().finite().positive().max(100000), unit: z.enum(['lf', 'sqft', 'each', 'ls']), confirmedAt: z.string().datetime({ offset: true }), note: z.string().max(1000),
}).strict().refine(value => value.unit !== 'each' || Number.isInteger(value.quantity), 'Item counts must be whole numbers').refine(value => value.unit !== 'ls' || value.quantity === 1, 'A package takeoff represents exactly one scope');
export const ScanWorkAllowanceZ = z.object({ objectId: z.string().min(1).max(160), low: z.number().finite().min(0).max(10000000), high: z.number().finite().min(0).max(10000000), confirmedAt: z.string().datetime({ offset: true }), note: z.string().max(1000) }).strict().refine(value => value.high >= value.low, 'The high allowance must be at least the low allowance');
export const ScanDesignZ = z.object({
  version: z.literal(1), objects: z.record(z.string().min(1).max(160), ScanObjectEditZ).refine(v => Object.keys(v).length <= 512, 'Too many object edits'),
  takeoffs: z.array(ScanTakeoffZ).max(512),
  workAllowances: z.array(ScanWorkAllowanceZ).max(512).optional(),
}).strict();

export const ScannedElementZ = z.object({
  id: z.string().min(1).max(160),
  kind: z.string().min(1).max(100),
  dimensions: z.object({ x: z.number().finite().min(0).max(100), y: z.number().finite().min(0).max(100), z: z.number().finite().min(0).max(100) }),
  transform: ScanTransformZ,
  confidence: z.enum(['high', 'medium', 'low', 'sample', 'unknown']),
  polygonCorners: z.array(ScanPointZ).min(3).max(256).nullable().optional(),
  countertopSurfaces: z.array(ScannedCountertopSurfaceZ).max(8).optional(),
  ...ScanElementMetadataZ.shape,
});

/** Runtime/project validation only. Native geometry is omitted from AI output schemas below. */
export const ScannedRoomGeometryZ = z.object({
  version: z.literal(1),
  surfaces: z.array(ScannedElementZ.extend({ kind: z.enum(['wall', 'door', 'window', 'opening', 'floor']) })).max(257),
  objects: z.array(ScannedElementZ).max(512),
});

export const OpeningZ = z.object({
  id: z.string(),
  kind: z.enum(['window', 'door', 'passage', 'garage-door']),
  wall: WallZ,
  t: z.number().min(0).max(1),
  widthFt: z.number().min(0.5).max(40),
  heightFt: z.number().min(0.5).max(20),
  sillFt: z.number().min(0).max(12),
  style: z.enum(['standard', 'picture', 'bay', 'slider', 'french', 'pocket', 'barn', 'casement', 'double-hung']).nullable(),
});

/** Object, never a tuple: a zod tuple emits `prefixItems`, which OpenAI strict
 *  mode rejects — and the whole analysis then silently falls back to non-strict. */
export const PendantPositionZ = z.object({
  alongFt: z.number().min(-20).max(20),
  acrossFt: z.number().min(-10).max(10),
});

export const LightingZ = z.object({
  recessedCount: z.number().int().min(0).max(40),
  pendants: z.object({
    count: z.number().int().min(0).max(12),
    style: z.enum(['globe', 'cone', 'dome', 'drum', 'lantern', 'linear', 'cage', 'glass']),
    finish: z.string(),
    spreadFt: z.number().min(0).max(16),
    offsetFt: z.number().min(-8).max(8),
    aboveCounterIn: z.number().min(0).max(60),
    positions: z.array(PendantPositionZ).max(12).nullable(),
  }).nullable(),
  underCabinet: z.boolean(),
  chandelier: z.boolean(),
  sconces: z.number().int().min(0).max(12),
  colorTempK: z.number().min(2000).max(6500),
  naturalLight: z.enum(['low', 'medium', 'high']),
});

export const DimsZ = z.object({
  widthFt: z.number().min(4).max(80),
  depthFt: z.number().min(4).max(80),
  ceilingFt: z.number().min(7).max(20),
});

export const OpenShelfZ = z.object({
  wall: WallZ,
  t: z.number().min(0).max(1),
  widthIn: z.number().min(12).max(120),
  count: z.number().int().min(1).max(5),
  bottomFt: z.number().min(2).max(9),
  depthIn: z.number().min(6).max(16),
  spacingIn: z.number().min(8).max(24),
  material: z.enum(['match-cabinets', 'wood', 'white', 'black', 'match-countertop']),
  finishColorHex: z.string().max(32).nullable().default(null),
  enclosure: z.object({
    heightIn: z.number().min(12).max(120),
    backPanel: z.boolean(),
    panelThicknessIn: z.number().min(0.25).max(2).nullable().default(null),
    rotationDeg: z.union([z.literal(-90), z.literal(0), z.literal(90), z.literal(180)]).nullable().default(null),
  }).nullable().default(null),
  styled: z.enum(['empty', 'dishes', 'books', 'plants', 'mixed']),
});

export const PlantZ = z.object({
  kind: z.enum(['floor', 'counter', 'shelf', 'hanging']),
  wall: z.enum(['back', 'left', 'right', 'front', 'island', 'corner']),
  t: z.number().min(0).max(1),
  sizeFt: z.number().min(0.3).max(9),
  form: z.enum(['leafy', 'tree', 'trailing', 'herb', 'succulent']),
});

/** Loose on purpose: a bad hex is repaired downstream, never rejected. The cap
 *  is wide enough for the spellings the model actually writes — 'rgb(200, 60, 60)',
 *  '#c0392b (red)' — because sanitize truncates to it and a hex sliced mid-value
 *  reaches `repairHex` as junk, losing the photo's colour. */
const HexZ = z.string().max(32);

export const WallArtZ = z.object({
  wall: WallZ,
  t: z.number().min(0).max(1),
  widthIn: z.number().min(6).max(96),
  heightIn: z.number().min(6).max(96),
  centerFt: z.number().min(2).max(9),
  frame: z.enum(['black', 'wood', 'white', 'none']),
});

export const DecorItemKindZ = z.enum([
  'pot', 'pan', 'kettle', 'dutch-oven', 'cutting-board', 'bowl', 'fruit-bowl',
  'bottle', 'oil-set', 'vase', 'flowers', 'books', 'utensil-crock', 'knife-block',
  'coffee-maker', 'stand-mixer', 'toaster', 'microwave-countertop', 'soap-set',
  'dish-rack', 'tray', 'candle', 'canister', 'paper-towel', 'plate-stack',
  'mugs', 'jar', 'basket', 'towel',
  // the bathroom six, before 'other' so every kitchen kind keeps its place
  'folded-towels', 'soap-pump', 'toothbrush-cup', 'robe', 'bath-mat', 'tissue-box',
  'other',
]);
export const DecorItemOnZ = z.enum(['counter', 'range', 'island', 'shelf', 'sill', 'floor']);
export const DecorItemMaterialZ = z.enum(['stainless', 'black-metal', 'copper', 'brass', 'enamel', 'ceramic', 'glass', 'wood', 'plastic', 'fabric', 'paper', 'marble', 'wicker']);
export const BurnerZ = z.enum(['left-back', 'left-front', 'centre-back', 'centre-front', 'right-back', 'right-front']);

export const DecorItemZ = z.object({
  kind: DecorItemKindZ,
  label: z.string().max(40),
  on: DecorItemOnZ,
  wall: z.enum(['back', 'left', 'right', 'front', 'island']).nullable(),
  t: z.number().min(0).max(1),
  depthT: z.number().min(0).max(1).nullable(),
  shelfIndex: z.number().int().min(0).max(4).nullable(),
  burner: BurnerZ.nullable(),
  sizeIn: z.number().min(1).max(40),
  colorHex: HexZ,
  material: DecorItemMaterialZ,
  count: z.number().int().min(1).max(12),
});

export const CabinetContentsZ = z.object({
  wall: WallZ,
  t: z.number().min(0).max(1),
  kind: z.enum(['plates', 'bowls', 'glasses', 'mugs', 'jars', 'cookbooks', 'bottles', 'mixed', 'empty']),
  density: z.enum(['sparse', 'full']),
});

export const DecorZ = z.object({
  shelves: z.array(OpenShelfZ).max(6),
  plants: z.array(PlantZ).max(8),
  art: z.array(WallArtZ).max(6),
  rug: z.object({
    present: z.boolean(),
    lengthFt: z.number().min(2).max(14),
    widthFt: z.number().min(1.5).max(10),
    style: z.enum(['runner', 'area', 'round']),
  }).nullable(),
  windowTreatment: z.enum(['none', 'roman-shade', 'roller', 'curtains', 'blinds', 'cafe-curtain']),
  counterStyling: z.enum(['none', 'minimal', 'lived-in']),
  stools: z.object({
    style: z.enum(['backless', 'low-back', 'full-back', 'saddle']),
    frame: z.enum(['light-wood', 'dark-wood', 'black-metal', 'brass', 'white']),
    seat: z.enum(['woven', 'upholstered', 'wood', 'leather', 'metal']),
    // the pad's plan shape and its own colour: `style` and `seat` can say
    // neither, and the scene's only pad is a round lathe in a stock colour
    // `.default(null)`, not a bare nullable: strict mode still lists and
    // requires them (stripForStrict drops the `default` keyword and requires
    // every property), but a payload written before they existed — a persisted
    // project, a share link, a fixture — still parses instead of 400ing
    // /api/refine and dropping the client's kitchen to the template.
    seatShape: z.enum(['round', 'square']).nullable().default(null),
    seatColorHex: HexZ.nullable().default(null),
  }).nullable(),
  // always present, never nullable: an empty list is the answer for a bare room
  items: z.array(DecorItemZ).max(24),
  cabinetContents: z.array(CabinetContentsZ).max(10),
});

export const FinishFamilyZ = z.enum([
  'paint', 'stained-wood', 'quartz', 'granite', 'marble', 'quartzite', 'butcher-block', 'laminate', 'concrete', 'terrazzo', 'soapstone',
  'porcelain-tile', 'ceramic-tile', 'glass-tile', 'stone-tile', 'hardwood', 'engineered-wood', 'lvp', 'laminate-floor',
  'stainless', 'brass', 'nickel', 'bronze', 'black-metal', 'chrome', 'copper', 'glass', 'fabric', 'brick', 'stucco', 'siding', 'shingle', 'other',
]);
export const FinishPatternZ = z.enum([
  'solid', 'veined', 'speckled', 'wood-grain', 'subway', 'stacked', 'herringbone', 'hex', 'mosaic', 'large-format',
  'checker', 'plank', 'lap', 'board-batten', 'brick', 'shingle', 'zellige', 'other',
]);
export const FinishSheenZ = z.enum(['matte', 'satin', 'semi-gloss', 'gloss', 'polished', 'honed', 'brushed', 'weathered']);

export const FinishObservationZ = z.object({
  slot: z.string(),
  family: FinishFamilyZ,
  baseColorHex: HexZ,
  accentColorHex: HexZ.nullable(),
  pattern: FinishPatternZ,
  sheen: FinishSheenZ,
  moduleIn: z.object({ w: z.number().min(0.5).max(120), h: z.number().min(0.5).max(120) }).nullable(),
  groutColorHex: HexZ.nullable(),
  description: z.string(),
  visibility: z.enum(['clear', 'partial', 'inferred']),
  // direction, told in the photo's terms; null for anything without one
  plankRun: z.enum(['toward', 'across', 'diagonal']).nullable().default(null),
});

export const PhotoElementKindZ = z.enum([
  'base-cabinet-run', 'upper-cabinet-run', 'tall-cabinet', 'fridge', 'range', 'cooktop', 'hood', 'dishwasher', 'wall-oven', 'microwave',
  'sink', 'faucet', 'window', 'door', 'island', 'stool', 'pendant', 'shelf', 'plant', 'art', 'rug', 'backsplash', 'item',
  'vanity', 'mirror', 'shower', 'tub', 'toilet', 'towel-bar', 'wall', 'floor', 'ceiling', 'other',
]);

export const ImageBoxZ = z.object({
  x0: z.number().min(0).max(1), y0: z.number().min(0).max(1), x1: z.number().min(0).max(1), y1: z.number().min(0).max(1),
});

/** Four booleans, never a tuple — a zod tuple emits `prefixItems`, which strict mode rejects. */
export const BoxOpenEdgesZ = z.object({
  left: z.boolean(), right: z.boolean(), top: z.boolean(), bottom: z.boolean(),
});

export const PhotoElementZ = z.object({
  id: z.string(),
  kind: PhotoElementKindZ,
  wall: z.enum(['back', 'left', 'right', 'front', 'island']).nullable(),
  box: ImageBoxZ,
  facing: z.enum(['front', 'left', 'right', 'edge']).nullable(),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  // which edges of `box` are a CUT, and why. `.nullable()` to match
  // `PhotoElement.open`, whose doc comment says "null / absent = nothing is
  // cut": the TS type is what every stream codes against, and a validator that
  // rejects a value the type invites is a 400 at /api/refine and /api/projects
  // PUT — i.e. the client's kitchen dropped for the template, the exact
  // failure the nullable-not-optional pattern exists to prevent. Costs nothing
  // in pressure on the annotator: strict mode still lists and REQUIRES the
  // key, and `resolveOpen` unions null with the frame edges either way.
  open: BoxOpenEdgesZ.nullable().default({ left: false, right: false, top: false, bottom: false }),
  openCause: z.enum(['frame', 'occluded', 'both']).nullable().default(null),
});

export const SolvedCameraZ = z.object({
  x: z.number(), y: z.number(), z: z.number(),
  yawDeg: z.number(), pitchDeg: z.number(),
  fovDeg: z.number().min(10).max(150), aspect: z.number().min(0.2).max(5),
  score: z.number().min(0).max(1),
});

export const DetectionMetaZ = z.object({
  measurements: z.object({
    widthFt: DimsZ.shape.widthFt.nullable(),
    depthFt: DimsZ.shape.depthFt.nullable(),
    ceilingFt: DimsZ.shape.ceilingFt.nullable(),
    confirmedAt: z.iso.datetime(),
  }).nullable().default(null),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  notes: z.array(z.string()),
  assumptions: z.array(z.string()),
  primaryPhotoIndex: z.number().int().min(0),
  camera: z.object({
    fovDeg: z.number().min(20).max(120),
    heightFt: z.number().min(2).max(12),
    position: z.enum(['front', 'corner-left', 'corner-right', 'side-left', 'side-right', 'top']),
    lookingAt: WallZ,
    solved: SolvedCameraZ.nullable(),
  }),
  finishes: z.array(FinishObservationZ).max(24),
  // 90, not 60: items are boxed too now, and this cap must move together with
  // reconcile.ts MAX_ELEMENTS, inventory.ts MAX_INVENTORY_ELEMENTS and the
  // fitter's cleanElementsDetailed or items are silently truncated at the lowest.
  elements: z.array(PhotoElementZ).max(90),
  frame: z.object({
    backWallSpansX: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    leftWallVisible: z.boolean(),
    rightWallVisible: z.boolean(),
  }).nullable(),
  inventory: z.object({
    samples: z.number().int().min(0).max(4),
    agreement: z.number().min(0).max(1).nullable(),
  }).nullable(),
  // what the upload IS. `.default`, not `.nullable()`: there is always an
  // answer (a photograph of a room is the answer for a photograph of a room),
  // and strict mode still lists and requires the key. A payload written before
  // the field existed parses as 'room-photo', which is what it was.
  inputKind: InputKindZ.default('room-photo'),
});

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------
export const CabinetDoorStyleZ = z.enum(['shaker', 'flat', 'raised', 'slab', 'beaded', 'glass', 'open']);

export const UpperCabinetZ = z.object({
  widthIn: z.number().min(9).max(48),
  type: z.enum(['door', 'glass', 'open-shelf', 'appliance-gap', 'hood-gap', 'corner']),
  heightIn: z.number().min(9).max(60).nullable(),
});

export const CabinetRunZ = z.object({
  id: z.string(),
  wall: WallZ,
  start: z.number().min(0).max(1),
  lengthFt: z.number().min(1).max(40),
  base: z.array(z.object({
    widthIn: z.number().min(9).max(48),
    type: z.enum(['door', 'drawers', 'sink-base', 'corner', 'appliance-gap', 'open']),
    drawerCount: z.number().int().min(0).max(5).nullable(),
  })),
  uppers: z.array(UpperCabinetZ).nullable(),
  // the second, shorter tier that sits ON TOP of `uppers`; null = one tier.
  // The 16 is mirrored as TIER2_MAX_BOXES in @/lib/spec/uppers, which the
  // reconciler caps against — this file imports nothing but zod on purpose.
  uppers2: z.array(UpperCabinetZ).max(16).nullable().default(null),
  uppers2HeightIn: z.number().min(9).max(36).nullable().default(null),
  tall: z.array(z.object({
    t: z.number().min(0).max(1),
    widthIn: z.number().min(18).max(48),
    kind: z.enum(['pantry', 'oven-tower', 'fridge-surround']),
    toCeiling: z.boolean().nullable(),
  })),
  hasUppers: z.boolean(),
  uppersToCeiling: z.boolean(),
  backsplash: z.boolean(),
  upperHeightIn: z.number().min(12).max(60).nullable(),
  upperBottomIn: z.number().min(24).max(228).nullable().default(null),
});

export const IslandZ = z.object({
  present: z.boolean(),
  kind: z.enum(['island', 'peninsula', 'breakfast-bar']),
  lengthFt: z.number().min(2).max(16),
  widthFt: z.number().min(1.5).max(8),
  offset: z.object({ x: z.number().min(-20).max(20), z: z.number().min(-20).max(20) }),
  rotationDeg: z.union([z.literal(0), z.literal(90)]),
  seating: z.number().int().min(0).max(8),
  overhangIn: z.number().min(0).max(18),
  waterfall: z.boolean(),
  hasSink: z.boolean(),
  hasCooktop: z.boolean(),
  stoolPitchIn: z.number().min(0).max(40),
  endSeats: z.number().int().min(0).max(4),
  endPlacement: z.enum(['auto', 'left', 'right', 'both']),
  endOverhangIn: z.number().min(0).max(18).nullable(),
  stoolOffsetIn: z.number().min(-60).max(60),
});

export const ApplianceZ = z.object({
  hasDispenser: z.boolean().nullable().default(null),
  kind: z.enum(['fridge', 'range', 'cooktop', 'wall-oven', 'hood', 'dishwasher', 'microwave', 'wine-fridge']),
  wall: z.enum(['back', 'left', 'right', 'front', 'island']),
  t: z.number().min(0).max(1),
  widthIn: z.number().min(12).max(60),
  finish: z.enum(['stainless', 'black-stainless', 'panel-ready', 'white', 'black', 'matte-black']),
  hoodStyle: z.enum(['chimney', 'under-cabinet', 'custom-insert', 'island', 'none']).nullable(),
  hoodShape: z.enum(['box', 'tapered', 'curved', 'wood-canopy', 'slim']).nullable(),
  fridgeStyle: z.enum(['french-door', 'side-by-side', 'counter-depth', 'built-in', 'top-freezer']).nullable(),
  bodyFinish: z.enum(['stainless', 'black-stainless', 'panel-ready', 'white', 'black', 'matte-black']).nullable(),
  heightIn: z.number().min(6).max(120).nullable(),
  aboveCounterIn: z.number().min(18).max(48).nullable(),
  cabinetAbove: z.enum(['none', 'doors', 'glass', 'panel']).nullable(),
});

export const KitchenMaterialSlotsZ = z.object({
  cabinets_base: z.string(), cabinets_upper: z.string(), island_cabinets: z.string(), cabinets_tall: z.string(), countertop: z.string(),
  island_countertop: z.string(), backsplash: z.string(), flooring: z.string(), walls: z.string(), ceiling: z.string(),
  hardware: z.string(), faucet: z.string(), appliances: z.string(), lighting_fixture: z.string(),
});

export const KitchenSpecZ = z.object({
  roomType: z.literal('kitchen'),
  dims: DimsZ,
  scanGeometry: ScannedRoomGeometryZ.nullable().optional(),
  scanDesign: ScanDesignZ.nullable().optional(),
  style: DesignStyleZ,
  layout: z.enum(['single-wall', 'galley', 'l-shaped', 'u-shaped', 'peninsula', 'g-shaped']),
  // A measured native shell may have no reconstructed cabinetry yet.
  runs: z.array(CabinetRunZ).max(4),
  island: IslandZ,
  appliances: z.array(ApplianceZ),
  sink: z.object({
    wall: z.enum(['back', 'left', 'right', 'front', 'island']),
    t: z.number().min(0).max(1),
    kind: z.enum(['undermount', 'farmhouse', 'drop-in', 'double']),
    widthIn: z.number().min(15).max(48),
  }),
  cabinets: z.object({
    doorStyle: CabinetDoorStyleZ,
    twoTone: z.boolean(),
    baseHeightIn: z.number().min(30).max(38),
    baseDepthIn: z.number().min(18).max(30),
    upperHeightIn: z.number().min(12).max(48),
    upperDepthIn: z.number().min(10).max(16),
    toeKickIn: z.number().min(0).max(6),
    crown: z.boolean(),
    hardware: z.enum(['pulls', 'knobs', 'mixed', 'integrated', 'none']),
  }),
  countertop: z.object({
    thicknessIn: z.number().min(0.5).max(3),
    edge: z.enum(['eased', 'bullnose', 'bevel', 'ogee', 'mitered']),
    overhangIn: z.number().min(0).max(4).nullable(),
  }),
  backsplash: z.object({
    present: z.boolean(),
    height: z.enum(['standard', 'full-height', 'ledge']),
    pattern: z.enum(['running-bond', 'stacked', 'herringbone', 'slab', 'mosaic', 'hex']),
    behindRange: z.enum(['same', 'full-height']),
    heightIn: z.number().min(4).max(120).nullable(),
  }),
  openings: z.array(OpeningZ),
  lighting: LightingZ,
  decor: DecorZ,
  materials: KitchenMaterialSlotsZ,
  detected: DetectionMetaZ,
});

// ---------------------------------------------------------------------------
// Bathroom
// ---------------------------------------------------------------------------
export const BathroomMaterialSlotsZ = z.object({
  vanity_cabinet: z.string(), vanity_top: z.string(), floor_tile: z.string(), wall_tile: z.string(),
  shower_wall_tile: z.string(), shower_floor_tile: z.string(), walls: z.string(), ceiling: z.string(),
  fixtures: z.string(), hardware: z.string(), tub: z.string(), lighting_fixture: z.string(), mirror: z.string(),
});

/**
 * The plumbing / hardware metal as a word. `.nullable().default(null)` on
 * every field that uses it: null means "follow the room's fixtures or hardware
 * slot", which is what a spec written before these fields existed meant, and
 * the default is what lets such a spec still parse (nullable ≠ optional, and
 * /api/refine, /api/fit and /api/render all validate with this schema).
 */
export const FixtureFinishZ = z.enum([
  'chrome', 'brushed-nickel', 'polished-nickel', 'matte-black', 'brushed-gold',
  'polished-brass', 'oil-rubbed-bronze', 'stainless', 'white', 'black',
]);

export const TilePatternZ = z.enum([
  'stacked', 'running-bond', 'vertical-stack', 'herringbone', 'chevron',
  'basketweave', 'hex', 'penny', 'mosaic', 'large-format', 'slab',
]);

/** Object, never a tuple — a zod tuple emits `prefixItems`, which strict mode rejects. */
export const TileModuleZ = z.object({ w: z.number().min(0.5).max(120), h: z.number().min(0.5).max(120) });

export const WallTileAccentZ = z.object({
  wall: WallZ,
  pattern: TilePatternZ,
  moduleIn: TileModuleZ.nullable(),
  heightIn: z.number().min(12).max(240).nullable(),
  colorHex: HexZ.nullable(),
});

export const ShowerNicheZ = z.object({
  face: z.enum(['back', 'left', 'right']),
  t: z.number().min(0).max(1),
  centerIn: z.number().min(12).max(96),
  widthIn: z.number().min(6).max(60),
  heightIn: z.number().min(6).max(60),
  shelves: z.number().int().min(0).max(4),
});

export const BathAccessoryZ = z.object({
  kind: z.enum(['towel-bar', 'towel-ring', 'hook', 'robe-hook', 'grab-bar', 'toilet-paper-holder', 'towel-warmer', 'shower-caddy', 'corner-shelf']),
  wall: WallZ,
  t: z.number().min(0).max(1),
  heightFt: z.number().min(0.5).max(8),
  widthIn: z.number().min(3).max(48).nullable(),
  finish: FixtureFinishZ.nullable(),
});

export const BathroomSpecZ = z.object({
  roomType: z.literal('bathroom'),
  dims: DimsZ,
  scanGeometry: ScannedRoomGeometryZ.nullable().optional(),
  scanDesign: ScanDesignZ.nullable().optional(),
  style: DesignStyleZ,
  layout: z.enum(['powder', 'full', 'three-quarter', 'primary', 'jack-and-jill']),
  vanity: z.object({
    present: z.boolean(), wall: WallZ, t: z.number().min(0).max(1), widthIn: z.number().min(18).max(120),
    sinks: z.union([z.literal(1), z.literal(2)]),
    style: z.enum(['floating', 'freestanding', 'furniture', 'pedestal', 'console']),
    mirror: z.enum(['single', 'double', 'full-width', 'medicine-cabinet', 'none']),
    doorStyle: CabinetDoorStyleZ,
    // the FRONT. Every one nullable-with-default: null = "as the scene has
    // always drawn it", and the default is what keeps a spec written before
    // they existed parsing (see the stools note above — nullable ≠ optional).
    drawers: z.number().int().min(0).max(12).nullable().default(null),
    doors: z.number().int().min(0).max(8).nullable().default(null),
    legStyle: z.enum(['none', 'tapered', 'turned', 'square', 'hairpin', 'plinth']).nullable().default(null),
    counterThicknessIn: z.number().min(0.5).max(6).nullable().default(null),
    backsplash: z.enum(['none', 'standard', 'full-height', 'integrated']).nullable().default(null),
    heightIn: z.number().min(24).max(42).nullable().default(null),
    depthIn: z.number().min(12).max(30).nullable().default(null),
    basin: z.enum(['undermount', 'integrated', 'vessel', 'semi-recessed', 'drop-in']).nullable().default(null),
    faucetMount: z.enum(['deck', 'wall', 'widespread', 'centerset', 'single-hole']).nullable().default(null),
    hardware: z.enum(['pulls', 'knobs', 'mixed', 'integrated', 'none']).nullable().default(null),
    openShelf: z.boolean().nullable().default(null),
  }),
  shower: z.object({
    present: z.boolean(), wall: WallZ, t: z.number().min(0).max(1), widthIn: z.number().min(30).max(120), depthIn: z.number().min(30).max(96),
    enclosure: z.enum(['frameless-glass', 'framed-glass', 'curtain', 'open', 'tub-shower']),
    niche: z.boolean(), bench: z.boolean(), curbless: z.boolean(),
    fixtures: z.enum(['single', 'rain', 'rain-plus-handheld', 'body-jets']),
    glassThicknessIn: z.number().min(0.12).max(0.75).nullable().default(null),
    doorType: z.enum(['hinged', 'sliding', 'barn', 'pivot', 'fixed-panel', 'walk-in', 'none']).nullable().default(null),
    hardwareFinish: FixtureFinishZ.nullable().default(null),
    nicheAt: ShowerNicheZ.nullable().default(null),
    benchStyle: z.enum(['corner', 'full-width', 'floating']).nullable().default(null),
    curbHeightIn: z.number().min(0).max(12).nullable().default(null),
  }),
  tub: z.object({
    present: z.boolean(), wall: WallZ, t: z.number().min(0).max(1),
    kind: z.enum(['alcove', 'freestanding', 'drop-in', 'clawfoot', 'corner']),
    lengthIn: z.number().min(48).max(84),
    material: z.enum(['acrylic', 'cast-iron', 'stone-resin', 'solid-surface', 'copper', 'fiberglass', 'steel', 'wood']).nullable().default(null),
    fillerType: z.enum(['deck-mount', 'wall-mount', 'floor-mount', 'roman', 'tub-shower-diverter', 'none']).nullable().default(null),
    fillerFinish: FixtureFinishZ.nullable().default(null),
    apron: z.enum(['integral', 'tiled', 'panel', 'skirted', 'none']).nullable().default(null),
    widthIn: z.number().min(24).max(60).nullable().default(null),
    heightIn: z.number().min(12).max(36).nullable().default(null),
  }),
  toilet: z.object({
    present: z.boolean(), wall: WallZ, t: z.number().min(0).max(1),
    style: z.enum(['two-piece', 'one-piece', 'wall-hung', 'smart']),
    trimFinish: FixtureFinishZ.nullable().default(null),
  }),
  wallTile: z.object({
    height: z.enum(['none', 'wainscot', 'shower-only', 'full', 'accent-wall']),
    heightIn: z.number().min(6).max(240).nullable().default(null),
    pattern: TilePatternZ.nullable().default(null),
    moduleIn: TileModuleZ.nullable().default(null),
    groutWidthIn: z.number().min(0).max(0.75).nullable().default(null),
    trim: z.enum(['none', 'bullnose', 'pencil', 'chair-rail', 'metal-edge']).nullable().default(null),
    accent: WallTileAccentZ.nullable().default(null),
    showerPattern: TilePatternZ.nullable().default(null),
    showerModuleIn: TileModuleZ.nullable().default(null),
  }),
  // `[]`, never nullable: an empty list is the answer for a bare wall, and the
  // default is what keeps a pre-accessories spec parsing.
  accessories: z.array(BathAccessoryZ).max(10).default([]),
  openings: z.array(OpeningZ),
  lighting: LightingZ,
  decor: DecorZ,
  materials: BathroomMaterialSlotsZ,
  detected: DetectionMetaZ,
});

// ---------------------------------------------------------------------------
// Exterior
// ---------------------------------------------------------------------------
export const ElevationZ = z.object({
  wall: WallZ,
  windows: z.array(z.object({
    t: z.number().min(0).max(1), widthFt: z.number().min(1).max(20), heightFt: z.number().min(1).max(12), sillFt: z.number().min(0).max(30),
    floor: z.number().int().min(0).max(2),
    style: z.enum(['standard', 'picture', 'bay', 'slider', 'french', 'pocket', 'barn', 'casement', 'double-hung']).nullable(),
  })),
  doors: z.array(z.object({
    t: z.number().min(0).max(1), widthFt: z.number().min(2).max(20), heightFt: z.number().min(6).max(10),
    kind: z.enum(['entry', 'garage', 'patio', 'french', 'side']),
  })),
  sidingOverride: z.string().nullable(),
  gableEnd: z.boolean(),
});

export const ExteriorMaterialSlotsZ = z.object({
  siding_primary: z.string(), siding_accent: z.string(), trim: z.string(), roof: z.string(), front_door: z.string(),
  garage_door: z.string(), window_frames: z.string(), foundation: z.string(), porch_columns: z.string(), deck: z.string(),
  railing: z.string(), driveway: z.string(), walkway: z.string(), patio: z.string(), lawn: z.string(), fence: z.string(), gutters: z.string(),
});

export const ExteriorSpecZ = z.object({
  roomType: z.literal('exterior'),
  style: DesignStyleZ,
  houseStyle: z.enum(['craftsman', 'modern-farmhouse', 'modern', 'colonial', 'ranch', 'cape-cod', 'contemporary', 'mediterranean', 'tudor', 'victorian', 'northwest-contemporary']),
  lot: z.object({
    widthFt: z.number().min(20).max(600), depthFt: z.number().min(20).max(600),
    slope: z.enum(['flat', 'gentle', 'steep']),
    setbackFrontFt: z.number().min(0).max(200),
    orientation: z.enum(['north', 'south', 'east', 'west']),
    treesCount: z.number().int().min(0).max(40),
    fence: z.object({ present: z.boolean(), sides: z.array(WallZ), heightFt: z.number().min(2).max(10) }),
  }),
  house: z.object({
    present: z.boolean(),
    footprint: z.object({ widthFt: z.number().min(12).max(150), depthFt: z.number().min(12).max(150) }),
    wing: z.object({ present: z.boolean(), wall: WallZ, widthFt: z.number().min(6).max(80), depthFt: z.number().min(6).max(80), t: z.number().min(0).max(1) }).nullable(),
    stories: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    storyHeightFt: z.number().min(8).max(14),
    roof: z.object({
      type: z.enum(['gable', 'hip', 'flat', 'shed', 'gambrel', 'dutch-gable', 'cross-gable']),
      pitch: z.number().min(0).max(14),
      overhangFt: z.number().min(0).max(4),
      ridgeDirection: z.enum(['x', 'z']),
    }),
    garage: z.object({ present: z.boolean(), bays: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), wall: WallZ, t: z.number().min(0).max(1), attached: z.boolean() }),
    porch: z.object({ present: z.boolean(), wall: WallZ, widthFt: z.number().min(3).max(60), depthFt: z.number().min(3).max(20), columns: z.number().int().min(0).max(12), roofed: z.boolean() }),
    deck: z.object({ present: z.boolean(), wall: WallZ, widthFt: z.number().min(4).max(60), depthFt: z.number().min(4).max(30), railing: z.boolean() }),
    chimney: z.boolean(),
    foundationExposedFt: z.number().min(0).max(6),
    trimWidthIn: z.number().min(2).max(12),
    shutters: z.boolean(),
  }),
  elevations: z.array(ElevationZ).min(1).max(4),
  hardscape: z.object({
    driveway: z.object({ present: z.boolean(), widthFt: z.number().min(8).max(40), lengthFt: z.number().min(10).max(300), side: z.enum(['left', 'right', 'center']) }),
    walkway: z.object({ present: z.boolean(), widthFt: z.number().min(2).max(10) }),
    patio: z.object({ present: z.boolean(), widthFt: z.number().min(4).max(60), depthFt: z.number().min(4).max(60) }),
    pool: z.object({ present: z.boolean(), lengthFt: z.number().min(10).max(60), widthFt: z.number().min(6).max(30) }),
  }),
  lighting: z.object({
    exteriorSconces: z.number().int().min(0).max(20),
    landscape: z.boolean(),
    timeOfDay: z.enum(['morning', 'noon', 'golden-hour', 'dusk']),
  }),
  materials: ExteriorMaterialSlotsZ,
  detected: DetectionMetaZ,
});

// ---------------------------------------------------------------------------
// Floor plan
// ---------------------------------------------------------------------------

/** Objects, never tuples — a zod tuple emits `prefixItems`, which OpenAI
 *  strict mode rejects and which silently drops the whole call to non-strict. */
export const PlanPointZ = z.object({
  x: z.number().min(-500).max(500),
  y: z.number().min(-500).max(500),
});

export const PlanRoomKindZ = z.enum([
  'bedroom', 'bathroom', 'powder', 'kitchen', 'living', 'dining', 'family',
  'hall', 'entry', 'closet', 'laundry', 'garage', 'office', 'stair', 'mechanical', 'other',
]);

export const PlanWallZ = z.object({
  id: z.string(),
  x1: z.number().min(-500).max(500), y1: z.number().min(-500).max(500),
  x2: z.number().min(-500).max(500), y2: z.number().min(-500).max(500),
  thicknessIn: z.number().min(1).max(24),
  exterior: z.boolean(),
  bearing: z.boolean(),
  heightFt: z.number().min(4).max(30).nullable(),
});

export const PlanRoomZ = z.object({
  id: z.string(),
  name: z.string(),
  kind: PlanRoomKindZ,
  polygon: z.array(PlanPointZ).min(3).max(24),
  areaSqft: z.number().min(1).max(20000).nullable(),
  floorSlot: z.enum(['flooring', 'floor_tile']),
});

export const PlanDoorZ = z.object({
  id: z.string(),
  wallId: z.string(),
  t: z.number().min(0).max(1),
  widthIn: z.number().min(18).max(240),
  heightIn: z.number().min(60).max(144),
  kind: z.enum(['swing', 'double', 'pocket', 'bifold', 'barn', 'sliding', 'cased-opening', 'garage', 'exterior']),
  hand: z.enum(['left', 'right']).nullable(),
  swingsInto: z.string().nullable(),
});

export const PlanWindowZ = z.object({
  id: z.string(),
  wallId: z.string(),
  t: z.number().min(0).max(1),
  widthIn: z.number().min(6).max(240),
  heightIn: z.number().min(6).max(144),
  sillIn: z.number().min(0).max(96),
  kind: z.enum(['fixed', 'single-hung', 'double-hung', 'casement', 'slider', 'awning', 'bay', 'picture', 'transom', 'egress']),
});

export const PlanStairLandingZ = z.object({
  atTread: z.number().int().min(1).max(40),
  widthFt: z.number().min(2).max(20),
  depthFt: z.number().min(2).max(20),
  turn: z.enum(['left', 'right', 'straight', 'u-turn']),
});

export const PlanStairZ = z.object({
  id: z.string(),
  kind: z.enum(['straight', 'l-shaped', 'u-shaped', 'winder', 'spiral']),
  footprint: z.object({
    x: z.number().min(-500).max(500), y: z.number().min(-500).max(500),
    widthFt: z.number().min(2).max(30), runFt: z.number().min(2).max(40),
    rotationDeg: z.number().min(-360).max(360),
  }),
  direction: z.enum(['up', 'down']),
  connects: z.object({ fromLevel: z.number().int().min(0).max(3), toLevel: z.number().int().min(0).max(3) }),
  treads: z.number().int().min(2).max(40),
  riserIn: z.number().min(4).max(9),
  treadIn: z.number().min(8).max(16),
  handrail: z.enum(['none', 'one-side', 'both', 'wall-mounted']),
  landing: PlanStairLandingZ.nullable(),
});

export const LevelZ = z.object({
  id: z.string(),
  name: z.string(),
  index: z.number().int().min(0).max(3),
  elevationFt: z.number().min(-30).max(60),
  ceilingFt: z.number().min(6).max(24),
  rooms: z.array(PlanRoomZ).max(40),
  walls: z.array(PlanWallZ).max(200),
  doors: z.array(PlanDoorZ).max(80),
  windows: z.array(PlanWindowZ).max(80),
  stairs: z.array(PlanStairZ).max(8),
});

export const FloorPlanMaterialSlotsZ = z.object({
  flooring: z.string(), floor_tile: z.string(), walls: z.string(), ceiling: z.string(),
  interior_trim: z.string(), interior_doors: z.string(), stair_treads: z.string(), stair_railing: z.string(),
});

export const FloorPlanSpecZ = z.object({
  roomType: z.literal('floorplan'),
  style: DesignStyleZ,
  levels: z.array(LevelZ).min(1).max(4),
  materials: FloorPlanMaterialSlotsZ,
  detected: DetectionMetaZ,
});

export const RoomSpecZ = z.discriminatedUnion('roomType', [KitchenSpecZ, BathroomSpecZ, ExteriorSpecZ, FloorPlanSpecZ]);

export type KitchenSpecInput = z.infer<typeof KitchenSpecZ>;
export type BathroomSpecInput = z.infer<typeof BathroomSpecZ>;
export type ExteriorSpecInput = z.infer<typeof ExteriorSpecZ>;
export type FloorPlanSpecInput = z.infer<typeof FloorPlanSpecZ>;

export function schemaFor(roomType: RoomType) {
  if (roomType === 'kitchen') return KitchenSpecZ;
  if (roomType === 'bathroom') return BathroomSpecZ;
  if (roomType === 'floorplan') return FloorPlanSpecZ;
  return ExteriorSpecZ;
}

/** Strict JSON schema for OpenAI structured outputs / Anthropic tool input. */
export function jsonSchemaFor(roomType: RoomType) {
  const schema = roomType === 'kitchen' ? KitchenSpecZ.omit({ scanGeometry: true, scanDesign: true })
    : roomType === 'bathroom' ? BathroomSpecZ.omit({ scanGeometry: true, scanDesign: true }) : schemaFor(roomType);
  const s = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' });
  return stripForStrict(s as Record<string, unknown>);
}

/** OpenAI strict mode: every property required, additionalProperties:false, no min/max keywords on numbers. */
function stripForStrict(node: unknown, isPropertiesMap = false): unknown {
  if (Array.isArray(node)) return node.map((n) => stripForStrict(n));
  if (node && typeof node === 'object') {
    const o = { ...(node as Record<string, unknown>) };
    if (isPropertiesMap) {
      // keys here are property NAMES (e.g. "pattern", "format") — never strip them
      for (const k of Object.keys(o)) o[k] = stripForStrict(o[k]);
      return o;
    }
    for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', '$schema', 'default']) delete o[k];
    // A zod tuple emits `prefixItems` with no `items`; OpenAI strict mode
    // rejects that ("array schema items is not an object") and the whole call
    // silently falls back to non-strict — which is how an out-of-range frame
    // block once turned a client's kitchen into the template. Strict mode
    // only knows homogeneous arrays, so a tuple becomes an array of its first
    // element's schema (every tuple in the spec is homogeneous).
    if (o.type === 'array' && Array.isArray(o.prefixItems)) {
      if (o.items === undefined || o.items === false) o.items = (o.prefixItems as unknown[])[0];
      delete o.prefixItems;
    }
    if (o.type === 'object' && o.properties && typeof o.properties === 'object') {
      o.additionalProperties = false;
      o.required = Object.keys(o.properties as Record<string, unknown>);
    }
    for (const k of Object.keys(o)) o[k] = k === 'properties' ? stripForStrict(o[k], true) : stripForStrict(o[k]);
    return o;
  }
  return node;
}
