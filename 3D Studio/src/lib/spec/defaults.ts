/**
 * Default / template specs. Used for: demo mode, analyzer fallback when a
 * photo is unusable, and "example house" templates for empty lots.
 */
import type { BathroomSpec, DecorSpec, ExteriorSpec, FloorPlanSpec, KitchenSpec, PlanDoor, PlanRoom, PlanWall, PlanWindow, RoomSpec, RoomType } from './types';
import { defaultFloorSlotFor } from './floorplan';
import { DEFAULT_SELECTIONS } from '@/lib/materials/catalog';

const detected = (summary: string, primaryPhotoIndex = 0) => ({
  confidence: 0.6,
  summary,
  notes: [],
  assumptions: ['Dimensions estimated from standard cabinet sizes'],
  primaryPhotoIndex,
  camera: { fovDeg: 62, heightFt: 5, position: 'front' as const, lookingAt: 'back' as const, solved: null },
  finishes: [],
  elements: [],
  frame: null,
  inventory: null,
  measurements: null,
  // a template / demo spec describes a room, not a lot or a drawing
  inputKind: 'room-photo' as const,
});

/** Nothing on the walls, nothing on the floor — the analyzer fills this in. */
export function emptyDecor(): DecorSpec {
  return { shelves: [], plants: [], art: [], rug: null, windowTreatment: 'none', counterStyling: 'minimal', stools: null, items: [], cabinetContents: [] };
}

export function defaultKitchen(): KitchenSpec {
  return {
    roomType: 'kitchen',
    dims: { widthFt: 16, depthFt: 14, ceilingFt: 9 },
    style: 'transitional',
    layout: 'l-shaped',
    runs: [
      {
        id: 'run-back', wall: 'back', start: 0, lengthFt: 16,
        base: [
          { widthIn: 36, type: 'drawers', drawerCount: 3 }, { widthIn: 24, type: 'door', drawerCount: 1 },
          { widthIn: 36, type: 'sink-base', drawerCount: 0 }, { widthIn: 24, type: 'appliance-gap', drawerCount: 0 },
          { widthIn: 30, type: 'appliance-gap', drawerCount: 0 }, { widthIn: 18, type: 'door', drawerCount: 1 }, { widthIn: 24, type: 'door', drawerCount: 1 },
        ],
        uppers: [
          { widthIn: 36, type: 'door', heightIn: null }, { widthIn: 24, type: 'door', heightIn: null }, { widthIn: 36, type: 'appliance-gap', heightIn: null },
          { widthIn: 24, type: 'door', heightIn: null }, { widthIn: 30, type: 'hood-gap', heightIn: null }, { widthIn: 42, type: 'door', heightIn: null },
        ],
        tall: [{ t: 0.93, widthIn: 36, kind: 'fridge-surround', toCeiling: null }],
        hasUppers: true, uppersToCeiling: false, backsplash: true, upperHeightIn: null, uppers2: null, uppers2HeightIn: null,
      },
      {
        id: 'run-left', wall: 'left', start: 0, lengthFt: 10,
        base: [{ widthIn: 30, type: 'drawers', drawerCount: 3 }, { widthIn: 36, type: 'door', drawerCount: 1 }, { widthIn: 30, type: 'door', drawerCount: 1 }, { widthIn: 24, type: 'corner', drawerCount: 0 }],
        uppers: [{ widthIn: 30, type: 'door', heightIn: null }, { widthIn: 36, type: 'glass', heightIn: null }, { widthIn: 30, type: 'door', heightIn: null }, { widthIn: 24, type: 'corner', heightIn: null }],
        tall: [], hasUppers: true, uppersToCeiling: false, backsplash: true, upperHeightIn: null, uppers2: null, uppers2HeightIn: null,
      },
    ],
    island: { present: true, kind: 'island', lengthFt: 7, widthFt: 3.5, offset: { x: 1, z: 1.5 }, rotationDeg: 0, seating: 3, overhangIn: 12, waterfall: false, hasSink: false, hasCooktop: false, stoolPitchIn: 0, endSeats: 1, endPlacement: 'auto', endOverhangIn: null, stoolOffsetIn: 0 },
    appliances: [
      { kind: 'fridge', wall: 'back', t: 0.93, widthIn: 36, finish: 'stainless', hoodStyle: null, hoodShape: null, fridgeStyle: 'french-door', bodyFinish: null, heightIn: null, aboveCounterIn: null, cabinetAbove: null, hasDispenser: null },
      { kind: 'range', wall: 'back', t: 0.66, widthIn: 30, finish: 'stainless', hoodStyle: null, hoodShape: null, fridgeStyle: null, bodyFinish: null, heightIn: null, aboveCounterIn: null, cabinetAbove: null, hasDispenser: null },
      // the demo hood carries the feature the client asked for: a two-door box
      // on the canopy, filling the 10" band between the canopy top and the crown
      { kind: 'hood', wall: 'back', t: 0.66, widthIn: 30, finish: 'stainless', hoodStyle: 'chimney', hoodShape: 'tapered', fridgeStyle: null, bodyFinish: null, heightIn: null, aboveCounterIn: null, cabinetAbove: 'doors', hasDispenser: null },
      { kind: 'dishwasher', wall: 'back', t: 0.42, widthIn: 24, finish: 'stainless', hoodStyle: null, hoodShape: null, fridgeStyle: null, bodyFinish: null, heightIn: null, aboveCounterIn: null, cabinetAbove: null, hasDispenser: null },
    ],
    sink: { wall: 'back', t: 0.33, kind: 'undermount', widthIn: 33 },
    cabinets: { doorStyle: 'shaker', twoTone: true, baseHeightIn: 34.5, baseDepthIn: 24, upperHeightIn: 36, upperDepthIn: 12, toeKickIn: 4.5, crown: true, hardware: 'pulls' },
    countertop: { thicknessIn: 1.25, edge: 'eased', overhangIn: null },
    backsplash: { present: true, height: 'standard', pattern: 'running-bond', behindRange: 'full-height', heightIn: null },
    openings: [
      { id: 'win-1', kind: 'window', wall: 'back', t: 0.33, widthFt: 4, heightFt: 3.5, sillFt: 3.5, style: 'standard' },
      { id: 'door-1', kind: 'passage', wall: 'right', t: 0.7, widthFt: 4, heightFt: 7, sillFt: 0, style: 'standard' },
    ],
    lighting: { recessedCount: 6, pendants: { count: 2, style: 'globe', finish: 'brass', spreadFt: 0, offsetFt: 0, aboveCounterIn: 0, positions: null }, underCabinet: true, chandelier: false, sconces: 0, colorTempK: 3000, naturalLight: 'medium' },
    decor: {
      shelves: [{ wall: 'right', t: 0.3, widthIn: 36, count: 2, bottomFt: 4.6, depthIn: 10, spacingIn: 14, material: 'wood', styled: 'mixed' }],
      plants: [
        { kind: 'floor', wall: 'corner', t: 1, sizeFt: 5.5, form: 'tree' },
        { kind: 'counter', wall: 'back', t: 0.2, sizeFt: 1.1, form: 'herb' },
      ],
      art: [{ wall: 'right', t: 0.3, widthIn: 24, heightIn: 30, centerFt: 5.2, frame: 'black' }],
      rug: { present: true, lengthFt: 7, widthFt: 2.5, style: 'runner' },
      windowTreatment: 'roman-shade',
      counterStyling: 'lived-in',
      stools: { style: 'low-back', frame: 'light-wood', seat: 'woven', seatShape: null, seatColorHex: null },
      // one item per host type the layout can solve, so the demo exercises the
      // detail layer and every `decor.items[0].*` refine path resolves
      items: [
        { kind: 'kettle', label: 'stainless kettle', on: 'range', wall: 'back', t: 0.66, depthT: null, shelfIndex: null, burner: 'right-back', sizeIn: 9, colorHex: '#b9bcc0', material: 'stainless', count: 1 },
        { kind: 'knife-block', label: 'walnut knife block', on: 'counter', wall: 'back', t: 0.12, depthT: 0.3, shelfIndex: null, burner: null, sizeIn: 9, colorHex: '#5a3c28', material: 'wood', count: 1 },
        { kind: 'fruit-bowl', label: 'white bowl of lemons', on: 'island', wall: 'island', t: 0.35, depthT: null, shelfIndex: null, burner: null, sizeIn: 11, colorHex: '#efece6', material: 'ceramic', count: 1 },
        { kind: 'canister', label: 'white ceramic canisters', on: 'counter', wall: 'left', t: 0.15, depthT: 0.3, shelfIndex: null, burner: null, sizeIn: 8, colorHex: '#efece6', material: 'ceramic', count: 3 },
      ],
      // t is measured along the WALL (14 ft = 168"), not along the run: the left
      // run's 36" glass upper lands with its centre at 96" → t = 96/168 = 0.5714.
      // At 0.4 the entry hit no cabinet and the layout warned.
      cabinetContents: [{ wall: 'left', t: 0.5714, kind: 'glasses', density: 'sparse' }],
    },
    materials: { ...DEFAULT_SELECTIONS.kitchen } as unknown as KitchenSpec['materials'],
    detected: detected('L-shaped kitchen with island, window over the sink and a fridge surround on the back wall.'),
  };
}

export function defaultBathroom(): BathroomSpec {
  return {
    roomType: 'bathroom',
    // A 10 × 11 room: the 66" tub and 48" stall share the 10 ft back wall, and
    // the 11 ft side walls leave the double vanity clear of the tub's corner
    // and the toilet clear of the stall — at every size the Layout tab's
    // sliders reach (a 66" corner tub, a 60"-deep stall). In an 8 ft-deep room
    // the vanity and tub could only interpenetrate, and every slider fought.
    dims: { widthFt: 10, depthFt: 11, ceilingFt: 8.5 },
    style: 'contemporary',
    layout: 'full',
    // The demo bathroom describes its FRONTS, its tile and its towel bars, not
    // just where the boxes stand: the analyzer's fallback and the demo are the
    // two specs a client is most likely to see, and a spec that leaves every
    // new field null teaches the twin nothing it did not already know.
    vanity: {
      present: true, wall: 'left', t: 0.24, widthIn: 60, sinks: 2, style: 'floating', mirror: 'full-width', doorStyle: 'flat',
      drawers: 4, doors: 0, legStyle: 'none', counterThicknessIn: 1.25, backsplash: 'none',
      heightIn: 34, depthIn: 21, basin: 'undermount', faucetMount: 'widespread', hardware: 'integrated', openShelf: false,
    },
    shower: {
      present: true, wall: 'back', t: 0.72, widthIn: 48, depthIn: 36, enclosure: 'frameless-glass', niche: true, bench: false, curbless: true, fixtures: 'rain-plus-handheld',
      glassThicknessIn: 0.375, doorType: 'hinged', hardwareFinish: 'matte-black',
      nicheAt: { face: 'back', t: 0.5, centerIn: 48, widthIn: 24, heightIn: 14, shelves: 1 },
      benchStyle: null, curbHeightIn: 0,
    },
    tub: {
      present: true, wall: 'back', t: 0.28, kind: 'freestanding', lengthIn: 66,
      material: 'acrylic', fillerType: 'floor-mount', fillerFinish: 'matte-black', apron: 'integral', widthIn: 32, heightIn: 24,
    },
    toilet: { present: true, wall: 'right', t: 0.67, style: 'one-piece', trimFinish: null },
    wallTile: {
      height: 'shower-only', heightIn: null, pattern: 'stacked',
      moduleIn: { w: 12, h: 24 }, groutWidthIn: 0.0625, trim: 'metal-edge',
      // the wall behind the freestanding tub, done differently from the stall:
      // a 2×8 handmade herringbone in a warm off-white. This is the shape the
      // contract could never describe — "one wall, another pattern, its own
      // colour" — so the demo shows it.
      accent: { wall: 'back', pattern: 'herringbone', moduleIn: { w: 2, h: 8 }, heightIn: null, colorHex: '#DCD6CB' },
      showerPattern: null, showerModuleIn: null,
    },
    accessories: [
      { kind: 'towel-bar', wall: 'front', t: 0.78, heightFt: 4, widthIn: 24, finish: null },
      { kind: 'toilet-paper-holder', wall: 'right', t: 0.82, heightFt: 2.1, widthIn: null, finish: null },
      { kind: 'robe-hook', wall: 'front', t: 0.24, heightFt: 5.4, widthIn: null, finish: null },
    ],
    openings: [
      { id: 'win-1', kind: 'window', wall: 'back', t: 0.25, widthFt: 3, heightFt: 2, sillFt: 5, style: 'standard' },
      { id: 'door-1', kind: 'door', wall: 'front', t: 0.5, widthFt: 2.67, heightFt: 6.67, sillFt: 0, style: 'standard' },
    ],
    lighting: { recessedCount: 4, pendants: null, underCabinet: false, chandelier: false, sconces: 2, colorTempK: 3000, naturalLight: 'medium' },
    decor: {
      shelves: [{ wall: 'right', t: 0.3, widthIn: 24, count: 2, bottomFt: 4.8, depthIn: 8, spacingIn: 12, material: 'wood', styled: 'mixed' }],
      plants: [{ kind: 'floor', wall: 'corner', t: 0, sizeFt: 3.5, form: 'leafy' }, { kind: 'counter', wall: 'left', t: 0.5, sizeFt: 0.8, form: 'succulent' }],
      art: [{ wall: 'right', t: 0.3, widthIn: 16, heightIn: 20, centerFt: 5.4, frame: 'wood' }],
      rug: { present: true, lengthFt: 3.5, widthFt: 2, style: 'area' },
      windowTreatment: 'roller',
      counterStyling: 'minimal',
      stools: null,
      // In a bathroom `on: 'counter'` is the VANITY TOP and `on: 'floor'` is
      // the floor — the two hosts a bathroom actually has. The reconciler
      // re-hosts anything else onto the vanity, so no new host word exists.
      items: [
        { kind: 'folded-towels', label: 'stack of white bath towels', on: 'shelf', wall: 'right', t: 0.3, depthT: null, shelfIndex: 0, burner: null, sizeIn: 13, colorHex: '#F2F0EC', material: 'fabric', count: 2 },
        { kind: 'soap-pump', label: 'amber glass soap pump', on: 'counter', wall: 'left', t: 0.36, depthT: 0.35, shelfIndex: null, burner: null, sizeIn: 8, colorHex: '#C08A45', material: 'glass', count: 1 },
        { kind: 'toothbrush-cup', label: 'white ceramic toothbrush cup', on: 'counter', wall: 'left', t: 0.14, depthT: 0.35, shelfIndex: null, burner: null, sizeIn: 5, colorHex: '#EFECE6', material: 'ceramic', count: 1 },
        { kind: 'tray', label: 'black marble vanity tray', on: 'counter', wall: 'left', t: 0.5, depthT: 0.45, shelfIndex: null, burner: null, sizeIn: 12, colorHex: '#2B2C2E', material: 'marble', count: 1 },
        { kind: 'candle', label: 'white pillar candle', on: 'counter', wall: 'left', t: 0.56, depthT: 0.4, shelfIndex: null, burner: null, sizeIn: 5, colorHex: '#F1EADC', material: 'ceramic', count: 2 },
        { kind: 'bath-mat', label: 'grey cotton bath mat', on: 'floor', wall: null, t: 0.45, depthT: null, shelfIndex: null, burner: null, sizeIn: 32, colorHex: '#B5B3AE', material: 'fabric', count: 1 },
      ],
      cabinetContents: [],
    },
    materials: { ...DEFAULT_SELECTIONS.bathroom } as unknown as BathroomSpec['materials'],
    detected: detected('Full bathroom with a double floating vanity, freestanding tub under the window and a curbless glass shower.'),
  };
}

export function defaultExterior(houseStyle: ExteriorSpec['houseStyle'] = 'modern-farmhouse'): ExteriorSpec {
  const base: ExteriorSpec = {
    roomType: 'exterior',
    style: 'farmhouse',
    houseStyle,
    lot: { widthFt: 80, depthFt: 120, slope: 'flat', setbackFrontFt: 30, orientation: 'south', treesCount: 3, fence: { present: false, sides: ['left', 'right', 'back'], heightFt: 6 } },
    house: {
      present: true,
      footprint: { widthFt: 44, depthFt: 30 },
      wing: { present: true, wall: 'front', widthFt: 24, depthFt: 22, t: 0.25 },
      stories: 2,
      storyHeightFt: 10,
      roof: { type: 'gable', pitch: 9, overhangFt: 1.5, ridgeDirection: 'x' },
      garage: { present: true, bays: 2, wall: 'front', t: 0.25, attached: true },
      porch: { present: true, wall: 'front', widthFt: 18, depthFt: 7, columns: 3, roofed: true },
      deck: { present: true, wall: 'back', widthFt: 16, depthFt: 12, railing: true },
      chimney: false,
      foundationExposedFt: 1,
      trimWidthIn: 5,
      shutters: false,
    },
    elevations: [
      {
        wall: 'front',
        windows: [
          { t: 0.62, widthFt: 5, heightFt: 5, sillFt: 3, floor: 0, style: 'picture' },
          { t: 0.85, widthFt: 3, heightFt: 5, sillFt: 3, floor: 0, style: 'double-hung' },
          { t: 0.62, widthFt: 3, heightFt: 4.5, sillFt: 13, floor: 1, style: 'double-hung' },
          { t: 0.85, widthFt: 3, heightFt: 4.5, sillFt: 13, floor: 1, style: 'double-hung' },
          { t: 0.25, widthFt: 3, heightFt: 4.5, sillFt: 13, floor: 1, style: 'double-hung' },
        ],
        doors: [{ t: 0.72, widthFt: 3, heightFt: 8, kind: 'entry' }],
        sidingOverride: null,
        gableEnd: false,
      },
      { wall: 'left', windows: [{ t: 0.3, widthFt: 3, heightFt: 4.5, sillFt: 3, floor: 0, style: 'double-hung' }, { t: 0.7, widthFt: 3, heightFt: 4.5, sillFt: 13, floor: 1, style: 'double-hung' }], doors: [], sidingOverride: null, gableEnd: true },
      { wall: 'right', windows: [{ t: 0.5, widthFt: 3, heightFt: 4.5, sillFt: 3, floor: 0, style: 'double-hung' }, { t: 0.5, widthFt: 3, heightFt: 4.5, sillFt: 13, floor: 1, style: 'double-hung' }], doors: [], sidingOverride: null, gableEnd: true },
      { wall: 'back', windows: [{ t: 0.25, widthFt: 4, heightFt: 4.5, sillFt: 3, floor: 0, style: 'slider' }, { t: 0.75, widthFt: 3, heightFt: 4.5, sillFt: 13, floor: 1, style: 'double-hung' }], doors: [{ t: 0.55, widthFt: 6, heightFt: 8, kind: 'patio' }], sidingOverride: null, gableEnd: false },
    ],
    hardscape: {
      driveway: { present: true, widthFt: 20, lengthFt: 32, side: 'left' },
      walkway: { present: true, widthFt: 4 },
      patio: { present: false, widthFt: 14, depthFt: 12 },
      pool: { present: false, lengthFt: 30, widthFt: 15 },
    },
    lighting: { exteriorSconces: 3, landscape: true, timeOfDay: 'golden-hour' },
    materials: { ...DEFAULT_SELECTIONS.exterior } as unknown as ExteriorSpec['materials'],
    detected: detected('Two-story modern farmhouse on a flat suburban lot with an attached two-car garage, covered front porch and rear deck.'),
  };
  if (houseStyle === 'modern' || houseStyle === 'northwest-contemporary' || houseStyle === 'contemporary') {
    base.style = 'modern';
    base.house.roof = { type: houseStyle === 'modern' ? 'flat' : 'shed', pitch: houseStyle === 'modern' ? 0 : 3, overhangFt: 2.5, ridgeDirection: 'x' };
    base.house.porch = { present: false, wall: 'front', widthFt: 0, depthFt: 0, columns: 0, roofed: false };
    base.materials = { ...base.materials, siding_primary: 'sid-cladding-02', siding_accent: 'sid-cedar-natural', roof: 'roof-metal-black', window_frames: 'win-black', front_door: 'door-wood' };
  }
  if (houseStyle === 'craftsman') {
    base.style = 'craftsman';
    base.house.roof = { type: 'gable', pitch: 6, overhangFt: 2.5, ridgeDirection: 'x' };
    base.house.porch.columns = 4;
    base.materials = { ...base.materials, siding_primary: 'sid-hardie-lap-sage', siding_accent: 'sid-cedar-natural', trim: 'ext-pure-white', porch_columns: 'col-stone', roof: 'roof-asphalt-weathered', front_door: 'door-wood' };
  }
  if (houseStyle === 'ranch') {
    base.house.stories = 1;
    base.house.footprint = { widthFt: 60, depthFt: 32 };
    base.house.roof = { type: 'hip', pitch: 5, overhangFt: 2, ridgeDirection: 'x' };
    base.elevations = base.elevations.map((e) => ({ ...e, windows: e.windows.filter((w) => w.floor === 0), gableEnd: false }));
  }
  if (houseStyle === 'colonial') {
    base.style = 'traditional';
    base.house.wing = null;
    base.house.shutters = true;
    base.house.roof = { type: 'gable', pitch: 8, overhangFt: 1, ridgeDirection: 'x' };
    base.materials = { ...base.materials, siding_primary: 'sid-brick-red', siding_accent: 'sid-hardie-lap-white', trim: 'ext-pure-white', front_door: 'door-black', window_frames: 'win-white' };
  }
  if (houseStyle === 'mediterranean') {
    base.style = 'mediterranean';
    base.house.roof = { type: 'hip', pitch: 4, overhangFt: 2, ridgeDirection: 'x' };
    base.materials = { ...base.materials, siding_primary: 'sid-stucco-warm', siding_accent: 'sid-stucco-white', roof: 'roof-clay-tile', window_frames: 'win-bronze', front_door: 'door-wood' };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Floor plan — the demo house, and the fixture every consumer develops against
// ---------------------------------------------------------------------------

/** A rectangular room, written the way a plan is read: corners in plan feet, counter-clockwise. */
const rect = (id: string, name: string, kind: PlanRoom['kind'], x0: number, y0: number, x1: number, y1: number): PlanRoom => ({
  id, name, kind,
  polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  // the sheet prints the area, so the demo prints it too — it is what a
  // consumer compares its computed area against
  areaSqft: Math.round((x1 - x0) * (y1 - y0)),
  floorSlot: defaultFloorSlotFor(kind),
});

/** One wall segment along its centre line. `ext` walls are the envelope. */
const seg = (id: string, x1: number, y1: number, x2: number, y2: number, ext: boolean, bearing = ext): PlanWall =>
  ({ id, x1, y1, x2, y2, thicknessIn: ext ? 6.5 : 4.5, exterior: ext, bearing, heightFt: null });

const door = (id: string, wallId: string, t: number, widthIn: number, kind: PlanDoor['kind'], swingsInto: string | null = null, hand: PlanDoor['hand'] = null): PlanDoor =>
  ({ id, wallId, t, widthIn, heightIn: 80, kind, hand, swingsInto });

const win = (id: string, wallId: string, t: number, widthIn: number, kind: PlanWindow['kind'] = 'double-hung', heightIn = 48, sillIn = 30): PlanWindow =>
  ({ id, wallId, t, widthIn, heightIn, sillIn, kind });

/**
 * A small, real, walkable two-storey house: 30 ft × 24 ft on both levels,
 * entry / living / kitchen / dining / powder and a straight stair below,
 * two bedrooms, two baths, a closet and an office above.
 *
 * It is the demo AND the test fixture, so it is coherent rather than
 * decorative: every room polygon edge lies on a wall segment, every door and
 * window sits on a wall that exists, the stair's 15 treads and 16 risers at
 * 7.5" climb exactly the 10 ft between finished floors, and the room areas
 * printed on the "sheet" are the areas the polygons actually enclose.
 */
export function defaultFloorPlan(): FloorPlanSpec {
  // level 0 — 30 × 24, front (the street) is plan south, y = 0
  const g = {
    rooms: [
      rect('g-living', 'Living Room', 'living', 0, 0, 12, 14),
      rect('g-entry', 'Entry', 'entry', 12, 0, 18, 8),
      rect('g-powder', 'Powder', 'powder', 18, 0, 24, 8),
      rect('g-stair', 'Stair Hall', 'stair', 24, 0, 30, 14),
      rect('g-hall', 'Hall', 'hall', 12, 8, 24, 14),
      rect('g-kitchen', 'Kitchen', 'kitchen', 0, 14, 14, 24),
      rect('g-dining', 'Dining', 'dining', 14, 14, 30, 24),
    ],
    walls: [
      seg('g-w-west', 0, 0, 0, 24, true),
      seg('g-w-east', 30, 0, 30, 24, true),
      seg('g-w-south', 0, 0, 30, 0, true),
      seg('g-w-north', 0, 24, 30, 24, true),
      seg('g-w-x12', 12, 0, 12, 14, false),
      seg('g-w-x18', 18, 0, 18, 8, false),
      seg('g-w-x24', 24, 0, 24, 14, false, true),
      seg('g-w-x14', 14, 14, 14, 24, false),
      seg('g-w-y8', 12, 8, 24, 8, false),
      // the spine: the wall the second storey lands on
      seg('g-w-y14', 0, 14, 30, 14, false, true),
    ],
    doors: [
      door('g-d-front', 'g-w-south', 0.5, 36, 'exterior', 'g-entry', 'left'),
      door('g-d-entry-hall', 'g-w-y8', 0.25, 60, 'cased-opening'),
      door('g-d-powder', 'g-w-y8', 0.75, 30, 'swing', 'g-powder', 'right'),
      door('g-d-living', 'g-w-x12', 0.2857, 72, 'cased-opening'),
      door('g-d-stair', 'g-w-x24', 0.7857, 48, 'cased-opening'),
      door('g-d-kitchen', 'g-w-y14', 0.2, 84, 'cased-opening'),
      door('g-d-dining', 'g-w-y14', 0.6, 72, 'cased-opening'),
      door('g-d-kitchen-dining', 'g-w-x14', 0.5, 60, 'cased-opening'),
      door('g-d-patio', 'g-w-north', 0.7333, 72, 'sliding'),
    ],
    windows: [
      win('g-n-living-w', 'g-w-west', 0.2917, 48),
      win('g-n-living-s', 'g-w-south', 0.2, 60, 'picture', 60, 24),
      win('g-n-kitchen', 'g-w-north', 0.2333, 48),
      win('g-n-powder', 'g-w-south', 0.7, 24, 'awning', 24, 54),
      win('g-n-stair', 'g-w-east', 0.2917, 36, 'fixed'),
    ],
    stairs: [{
      id: 'g-stair-up',
      kind: 'straight' as const,
      // 15 treads at 10.5" = 13.125 ft of run, standing clear of both walls
      footprint: { x: 25.25, y: 0.5, widthFt: 3.5, runFt: 13.125, rotationDeg: 0 },
      direction: 'up' as const,
      connects: { fromLevel: 0, toLevel: 1 },
      // 16 risers at 7.5" = exactly the 10 ft between finished floors
      treads: 15, riserIn: 7.5, treadIn: 10.5,
      handrail: 'one-side' as const,
      landing: null,
    }],
  };

  // level 1 — the same footprint, the stair shaft open above the flight
  const u = {
    rooms: [
      rect('u-bed2', 'Bedroom 2', 'bedroom', 0, 0, 12, 12),
      rect('u-bath2', 'Bath 2', 'bathroom', 12, 0, 20, 7),
      rect('u-closet', 'Linen Closet', 'closet', 20, 0, 24, 7),
      rect('u-hall', 'Upper Hall', 'hall', 12, 7, 24, 12),
      rect('u-stair', 'Stair Opening', 'stair', 24, 0, 30, 14),
      rect('u-master', 'Master Suite', 'bedroom', 0, 12, 16, 24),
      rect('u-master-bath', 'Master Bath', 'bathroom', 16, 12, 24, 24),
      rect('u-office', 'Office', 'office', 24, 14, 30, 24),
    ],
    walls: [
      seg('u-w-west', 0, 0, 0, 24, true),
      seg('u-w-east', 30, 0, 30, 24, true),
      seg('u-w-south', 0, 0, 30, 0, true),
      seg('u-w-north', 0, 24, 30, 24, true),
      seg('u-w-x12', 12, 0, 12, 12, false),
      seg('u-w-x16', 16, 12, 16, 24, false),
      seg('u-w-x20', 20, 0, 20, 7, false),
      seg('u-w-x24', 24, 0, 24, 24, false, true),
      seg('u-w-y7', 12, 7, 24, 7, false),
      seg('u-w-y12', 0, 12, 24, 12, false, true),
      seg('u-w-y14', 24, 14, 30, 14, false),
    ],
    doors: [
      door('u-d-master', 'u-w-y12', 0.5833, 32, 'swing', 'u-master', 'left'),
      door('u-d-master-bath', 'u-w-y12', 0.8333, 30, 'swing', 'u-master-bath', 'right'),
      door('u-d-bed2', 'u-w-x12', 0.7917, 32, 'swing', 'u-bed2', 'left'),
      door('u-d-bath2', 'u-w-y7', 0.25, 30, 'swing', 'u-bath2', 'right'),
      door('u-d-closet', 'u-w-y7', 0.8333, 48, 'bifold'),
      door('u-d-stair', 'u-w-x24', 0.3958, 42, 'cased-opening'),
      door('u-d-office', 'u-w-y14', 0.5, 30, 'swing', 'u-office', 'left'),
    ],
    windows: [
      win('u-n-master', 'u-w-north', 0.2667, 60),
      win('u-n-master-bath', 'u-w-north', 0.6667, 36, 'awning', 30, 54),
      win('u-n-bed2-w', 'u-w-west', 0.25, 48, 'egress'),
      win('u-n-bed2-s', 'u-w-south', 0.2, 48, 'egress'),
      win('u-n-bath2', 'u-w-south', 0.5333, 30, 'awning', 30, 54),
      win('u-n-office', 'u-w-east', 0.7917, 48),
    ],
    stairs: [],
  };

  return {
    roomType: 'floorplan',
    style: 'transitional',
    levels: [
      { id: 'level-0', name: 'First Floor', index: 0, elevationFt: 0, ceilingFt: 9, ...g },
      // 9 ft ceiling + a 12" floor assembly = the 10 ft the stair climbs
      { id: 'level-1', name: 'Second Floor', index: 1, elevationFt: 10, ceilingFt: 9, ...u },
    ],
    materials: {
      flooring: 'floor-white-oak-plank', floor_tile: 'tile-floor-large-grey', walls: 'wall-alabaster', ceiling: 'ceiling-white',
      interior_trim: 'wall-pure-white', interior_doors: 'ext-pure-white', stair_treads: 'floor-white-oak-plank', stair_railing: 'rail-black',
    },
    detected: {
      ...detected('Two-storey 30 × 24 plan: entry, living, kitchen and dining with a powder room and a straight stair below; two bedrooms, two baths and an office above.'),
      // a plan is a drawing, and a drawing carries no finishes
      assumptions: ['Finishes are placeholders — a drawing shows no colour or material'],
      inputKind: 'floor-plan' as const,
    },
  };
}

export function defaultSpec(roomType: RoomType): RoomSpec {
  if (roomType === 'kitchen') return defaultKitchen();
  if (roomType === 'bathroom') return defaultBathroom();
  if (roomType === 'floorplan') return defaultFloorPlan();
  return defaultExterior();
}

export const HOUSE_TEMPLATES: Array<{ id: ExteriorSpec['houseStyle']; name: string; blurb: string }> = [
  { id: 'modern-farmhouse', name: 'Modern Farmhouse', blurb: 'Board-and-batten, black windows, covered porch' },
  { id: 'craftsman', name: 'Craftsman', blurb: 'Low-pitch gables, tapered columns, warm cedar' },
  { id: 'northwest-contemporary', name: 'NW Contemporary', blurb: 'Shed roofs, cedar + dark cladding, big glass' },
  { id: 'modern', name: 'Modern', blurb: 'Flat roof, clean volumes, walnut door' },
  { id: 'ranch', name: 'Ranch', blurb: 'Single story, hip roof, wide footprint' },
  { id: 'colonial', name: 'Colonial', blurb: 'Symmetrical brick, shutters, classic' },
  { id: 'mediterranean', name: 'Mediterranean', blurb: 'Stucco, clay tile roof, bronze windows' },
];
