/**
 * Unifictional 3D Studio — the guided intake.
 *
 * A photograph of an existing room answers almost every question this app
 * asks: the analyzer reads the cabinet colour off the pixels. An EMPTY LOT and
 * a FLOOR PLAN answer almost none of them — there is nothing in the picture to
 * read a colour, a material or a finish off — and until now the app guessed
 * anyway, which is how a client who uploaded a plan got somebody else's
 * kitchen back.
 *
 * So: when the analyzer says the upload was not a room photo
 * (`detected.inputKind`), the studio ASKS. This module is the question
 * catalogue and the pure functions that turn the answers into a spec.
 *
 * Three rules the catalogue keeps:
 *
 *  1. **Options are derived, never typed out.** Every choice list comes from
 *     the real enum in `types.ts` or from `materialsForSlot()` over the real
 *     catalog. A hand-kept list drifts the day someone adds a material, and a
 *     drifted option writes a spec value that does not exist.
 *  2. **Every answer names where it goes.** `writes` is the whole contract
 *     between a question and the spec: a dotted field path, a catalog material
 *     id for a slot, a part of a finish observation, or an estimate setting.
 *  3. **An answer is a FINISH OBSERVATION wherever it can be.** Family +
 *     colour + pattern + module is exactly what the photo pipeline already
 *     produces, and `matchFinish` / `ensureSpecMaterials` already turn that
 *     into a catalog product or a synthesised custom material. So "white oak,
 *     #C9AE86, plank, 6×48" from a homeowner lands in the same place, and
 *     through the same code, as the same reading off a photograph.
 *
 * Pure and dependency-free apart from the catalog: this is imported by the
 * store, the studio and the analyze route alike.
 */
import type {
  BathroomSpec, DesignStyle, EstimateSettings, ExteriorSpec, FinishFamily, FinishObservation,
  FinishPattern, FinishSheen, InputKind, IntakeAnswer, IntakeState, KitchenSpec, MaterialSlotId,
  PlankRun, RoomSpec, RoomType, Tier,
} from './types';
import { getMaterial, materialsForSlot } from '@/lib/materials/catalog';
import { describeMaterial } from '@/lib/materials/match';

// ---------------------------------------------------------------------------
// The shape of a question
// ---------------------------------------------------------------------------

export type IntakeAnswerType = 'choice' | 'multi' | 'colour' | 'number' | 'text';

/**
 * What the client is asked about, so a UI can page the interview instead of
 * dumping forty controls on one screen. Ordered the way a contractor walks a
 * job: what is it, how is it laid out, what is it made of, what does it cost.
 */
export type IntakeGroup = 'basics' | 'layout' | 'cabinetry' | 'surfaces' | 'fixtures' | 'site' | 'budget';

export const INTAKE_GROUPS: readonly IntakeGroup[] = ['basics', 'layout', 'cabinetry', 'surfaces', 'fixtures', 'site', 'budget'];

export const GROUP_LABEL: Record<IntakeGroup, string> = {
  basics: 'The basics',
  layout: 'Layout',
  cabinetry: 'Cabinets & millwork',
  surfaces: 'Surfaces & colour',
  fixtures: 'Fixtures & finishes',
  site: 'The site',
  budget: 'Budget',
};

export interface IntakeOption {
  value: string;
  label: string;
  /** one short clause of context, shown under the label */
  hint?: string;
  /** css colour or an image path, when the option has a look */
  swatch?: string;
}

/**
 * Where one answer goes.
 *
 * - `field`    a dotted path into the spec. A `[]` segment means EVERY element
 *              of that array ("stainless appliances" means all of them).
 * - `material` a catalog material id written straight onto `spec.materials`.
 * - `finish`   one part of a `FinishObservation` for a slot; the parts from
 *              every finish-question for the same slot are assembled into ONE
 *              observation, which is then matched exactly like a photo reading.
 * - `setting`  an estimate setting, not a spec field at all.
 */
export type IntakeWrite =
  | { kind: 'field'; path: string }
  | { kind: 'material'; slot: MaterialSlotId }
  | { kind: 'finish'; slot: MaterialSlotId; part: FinishPart }
  | { kind: 'setting'; key: 'tier' };

export type FinishPart = 'family' | 'colour' | 'accent' | 'pattern' | 'module' | 'sheen' | 'plankRun';

export interface IntakeQuestion {
  id: string;
  group: IntakeGroup;
  /** the question, as a contractor standing in the room would ask it */
  prompt: string;
  /** one line under it: why we are asking, or how to answer */
  help: string;
  type: IntakeAnswerType;
  /** 'choice' / 'multi' only; empty otherwise */
  options: IntakeOption[];
  /** 'number' only */
  unit: string | null;
  min: number | null;
  max: number | null;
  step: number | null;
  /** what we use when the client skips — always a real, buildable answer */
  default: string;
  writes: IntakeWrite;
  rooms: readonly RoomType[];
  inputs: readonly InputKind[];
}

// ---------------------------------------------------------------------------
// Option sources — every list below is DERIVED
// ---------------------------------------------------------------------------

/** 'modern-farmhouse' → 'Modern farmhouse'. The enums are the labels. */
export function titleCase(value: string): string {
  const words = value.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const opts = (values: readonly string[], hints: Record<string, string> = {}): IntakeOption[] =>
  values.map((v) => ({ value: v, label: titleCase(v), ...(hints[v] ? { hint: hints[v] } : {}) }));

/**
 * Real catalog products for a slot, thinned to something a homeowner can read.
 *
 * `materialsForSlot` returns everything the slot accepts — well over a hundred
 * paints on `walls` — and a picker with a hundred rows is a picker nobody
 * finishes. So: at most `perCategory` from each material category, in catalog
 * order (which is authored cheapest-and-commonest first), capped at `limit`.
 * Still the real catalog: ids, names and swatches all come from it, so nothing
 * here can name a product that does not exist.
 */
export function materialOptions(slot: MaterialSlotId, limit = 12, perCategory = 3): IntakeOption[] {
  const seen = new Map<string, number>();
  const out: IntakeOption[] = [];
  for (const m of materialsForSlot(slot)) {
    const n = seen.get(m.category) ?? 0;
    if (n >= perCategory) continue;
    seen.set(m.category, n + 1);
    out.push({ value: m.id, label: m.name, hint: titleCase(m.tier), swatch: m.swatch });
    if (out.length >= limit) break;
  }
  return out;
}

/** The first product a slot offers — the honest "we picked one for you" answer. */
const firstMaterial = (slot: MaterialSlotId): string => materialOptions(slot, 1, 1)[0]?.value ?? '';

const DESIGN_STYLES: readonly DesignStyle[] = [
  'modern', 'contemporary', 'transitional', 'traditional', 'farmhouse',
  'scandinavian', 'industrial', 'coastal', 'mid-century', 'craftsman', 'mediterranean',
];
const TIERS: readonly Tier[] = ['budget', 'standard', 'premium', 'luxury'];
const HOUSE_STYLES: readonly ExteriorSpec['houseStyle'][] = [
  'craftsman', 'modern-farmhouse', 'modern', 'colonial', 'ranch', 'cape-cod',
  'contemporary', 'mediterranean', 'tudor', 'victorian', 'northwest-contemporary',
];
const KITCHEN_LAYOUTS: readonly KitchenSpec['layout'][] = ['single-wall', 'galley', 'l-shaped', 'u-shaped', 'peninsula', 'g-shaped'];
const BATH_LAYOUTS: readonly BathroomSpec['layout'][] = ['powder', 'full', 'three-quarter', 'primary', 'jack-and-jill'];
const DOOR_STYLES: readonly KitchenSpec['cabinets']['doorStyle'][] = ['shaker', 'flat', 'raised', 'slab', 'beaded', 'glass', 'open'];
const APPLIANCE_FINISHES = ['stainless', 'black-stainless', 'panel-ready', 'white', 'black', 'matte-black'] as const;
const BACKSPLASH_PATTERNS: readonly KitchenSpec['backsplash']['pattern'][] = ['running-bond', 'stacked', 'herringbone', 'slab', 'mosaic', 'hex'];
const TILE_PATTERNS: readonly NonNullable<BathroomSpec['wallTile']['pattern']>[] = [
  'stacked', 'running-bond', 'vertical-stack', 'herringbone', 'chevron',
  'basketweave', 'hex', 'penny', 'mosaic', 'large-format', 'slab',
];
const FIXTURE_FINISHES = ['chrome', 'brushed-nickel', 'polished-nickel', 'matte-black', 'brushed-gold', 'polished-brass', 'oil-rubbed-bronze', 'stainless', 'white', 'black'] as const;
const VANITY_STYLES: readonly BathroomSpec['vanity']['style'][] = ['floating', 'freestanding', 'furniture', 'pedestal', 'console'];
const ROOF_TYPES: readonly ExteriorSpec['house']['roof']['type'][] = ['gable', 'hip', 'flat', 'shed', 'gambrel', 'dutch-gable', 'cross-gable'];
const PLANK_RUNS: readonly PlankRun[] = ['toward', 'across', 'diagonal'];
/**
 * `plankRun` is told in the PHOTO's terms ('toward' = the joints recede toward
 * the wall the camera faces), which is not how a homeowner thinks about a
 * floor. The values are still derived from the enum — only the wording is
 * translated, and a value added to `PlankRun` shows up here missing a label
 * rather than silently absent from the picker.
 */
const PLANK_RUN_LABEL: Record<PlankRun, { label: string; hint: string }> = {
  toward: { label: 'Away from the door', hint: 'toward the main run of cabinets — makes the room read longer' },
  across: { label: 'Across the room', hint: 'parallel to the main run — makes it read wider' },
  diagonal: { label: 'On the diagonal', hint: 'a 45° layout' },
};

/** cabinetry / siding families the client can actually name, from the real FinishFamily union */
const CABINET_FAMILIES: readonly FinishFamily[] = ['paint', 'stained-wood', 'laminate'];
const SIDING_FAMILIES: readonly FinishFamily[] = ['siding', 'shingle', 'brick', 'stucco', 'stained-wood'];

/**
 * Tile / plank modules as a picker. The VALUE is `wxh` in inches so it parses
 * back into a `TileModule` with no table in between; the label is how a tile
 * shop says it.
 */
const MODULE_OPTIONS: IntakeOption[] = [
  { value: '3x6', label: '3 × 6 subway', hint: 'the classic' },
  { value: '4x12', label: '4 × 12 subway', hint: 'longer, more modern' },
  { value: '2x8', label: '2 × 8 subway', hint: 'slim, handmade look' },
  { value: '4x4', label: '4 × 4 square', hint: 'zellige, cement' },
  { value: '2x2', label: '2 in hex / mosaic', hint: 'shower floors' },
  { value: '12x24', label: '12 × 24 large format', hint: 'fewer grout lines' },
  { value: '24x24', label: '24 × 24 large format' },
  { value: '24x48', label: '24 × 48 slab-look panel' },
];

const SHEEN_OPTIONS: IntakeOption[] = [
  { value: 'matte', label: 'Matte' }, { value: 'satin', label: 'Satin' },
  { value: 'semi-gloss', label: 'Semi-gloss' }, { value: 'gloss', label: 'Gloss' },
  { value: 'polished', label: 'Polished' }, { value: 'honed', label: 'Honed' },
];

const YES_NO: IntakeOption[] = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** every upload that shows no finishes — which is every upload but a photograph */
const ASK_ALL: readonly InputKind[] = ['empty-lot', 'floor-plan', 'plans-document'];
/** including a room photograph: reserved for what no photograph can answer */
const ASK_EVERY: readonly InputKind[] = ['room-photo', 'empty-lot', 'floor-plan', 'plans-document'];

interface QBase {
  id: string;
  group: IntakeGroup;
  prompt: string;
  help: string;
  writes: IntakeWrite;
  rooms: readonly RoomType[];
  inputs?: readonly InputKind[];
}

const base = (q: QBase) => ({
  id: q.id, group: q.group, prompt: q.prompt, help: q.help, writes: q.writes,
  rooms: q.rooms, inputs: q.inputs ?? ASK_ALL,
  options: [] as IntakeOption[], unit: null, min: null, max: null, step: null,
});

const choice = (q: QBase & { options: IntakeOption[]; default?: string }): IntakeQuestion => ({
  ...base(q), type: 'choice', options: q.options, default: q.default ?? q.options[0]?.value ?? '',
});

const colour = (q: QBase & { default: string }): IntakeQuestion => ({ ...base(q), type: 'colour', default: q.default });

const number = (q: QBase & { unit: string; min: number; max: number; step: number; default: number }): IntakeQuestion => ({
  ...base(q), type: 'number', unit: q.unit, min: q.min, max: q.max, step: q.step, default: String(q.default),
});

const text = (q: QBase & { default?: string }): IntakeQuestion => ({ ...base(q), type: 'text', default: q.default ?? '' });

// ---------------------------------------------------------------------------
// THE CATALOGUE
// ---------------------------------------------------------------------------

const ALL_ROOMS: readonly RoomType[] = ['kitchen', 'bathroom', 'exterior'];
/**
 * The floor plan is deliberately NOT in `ALL_ROOMS`. Every question in that
 * list asks about one room's cabinets, tile or siding, and a plan has none of
 * those — its rooms are empty by contract. It gets its own short set below:
 * the whole-house finishes and the one number a plan sheet never carries.
 */
const PLAN_ONLY: readonly RoomType[] = ['floorplan'];

/**
 * Every question the app can ask, in the order a contractor would ask it.
 * `questionsFor` filters this by room type, input kind and what the spec
 * already knows; nothing else should ever build a question list.
 */
export const INTAKE_QUESTIONS: readonly IntakeQuestion[] = [
  // ---- basics -------------------------------------------------------------
  choice({
    // INTERIORS ONLY. On an exterior nothing reads `spec.style`: `houseStyle`
    // already carries the roof, the columns, the brackets and the window
    // proportions, and `defaultExterior` derives `spec.style` FROM it. Asking
    // a lot client for a design style as well was asking the same question
    // twice and throwing one answer away — `check-exterior.ts` asserts every
    // remaining exterior question changes what gets built.
    id: 'style', group: 'basics', rooms: ['kitchen', 'bathroom'],
    prompt: 'What look are you going for?',
    help: 'Pick the one closest to the pictures you have been saving. It sets the door profiles, the trim and the lighting.',
    options: opts(DESIGN_STYLES, {
      transitional: 'the safe middle — clean lines, a little warmth',
      farmhouse: 'shaker doors, apron sink, black hardware',
      modern: 'flat slab doors, no trim, hidden hardware',
      craftsman: 'wide trim, quartersawn oak, honest joinery',
    }),
    default: 'transitional', writes: { kind: 'field', path: 'style' },
  }),
  choice({
    id: 'budget-tier', group: 'budget', rooms: [...ALL_ROOMS, ...PLAN_ONLY], inputs: ASK_EVERY,
    prompt: 'Where should we price this?',
    help: 'This sets the default grade for anything you have not picked yourself. You can move it later without losing your selections.',
    options: opts(TIERS, {
      budget: 'stock cabinets, laminate tops, builder fixtures',
      standard: 'semi-custom cabinets, quartz, name-brand fixtures',
      premium: 'custom boxes, stone, designer plumbing',
      luxury: 'bespoke millwork, slab stone, imported fittings',
    }),
    default: 'standard', writes: { kind: 'setting', key: 'tier' },
  }),

  // ---- floor plan ---------------------------------------------------------
  // A plan is dimensioned and silent: it gives the walls, the rooms and the
  // stairs, and says nothing about height or finish. These six are exactly
  // what it cannot answer.
  choice({
    id: 'plan.style', group: 'basics', rooms: PLAN_ONLY,
    prompt: 'What look are you going for through the house?',
    help: 'One look for the whole interior — it sets the trim profiles, the door style and the floor.',
    options: opts(DESIGN_STYLES, {
      transitional: 'the safe middle — clean lines, a little warmth',
      farmhouse: 'shaker doors, wide trim, black hardware',
      modern: 'flat slab doors, minimal casing',
      craftsman: 'wide trim, quartersawn oak, honest joinery',
    }),
    default: 'transitional', writes: { kind: 'field', path: 'style' },
  }),
  number({
    // The one number a floor plan never carries: it is on the section sheet.
    // `levels[].ceilingFt` writes it to every storey, which is what a client
    // answering one question means.
    id: 'plan.ceiling-height', group: 'basics', rooms: PLAN_ONLY,
    prompt: 'How high are the ceilings?',
    help: 'Floor to ceiling, finished. A plan never shows this — it is on the section sheet. 8 ft is standard, 9 or 10 in a newer build.',
    unit: 'ft', min: 7, max: 14, step: 0.5, default: 9,
    writes: { kind: 'field', path: 'levels[].ceilingFt' },
  }),
  choice({
    id: 'plan.flooring', group: 'surfaces', rooms: PLAN_ONLY,
    prompt: 'What runs on the floor through the living areas and bedrooms?',
    help: 'The dry side of the house. Baths, laundry and entry are asked separately.',
    options: materialOptions('flooring'), default: firstMaterial('flooring'),
    writes: { kind: 'material', slot: 'flooring' },
  }),
  choice({
    id: 'plan.floor-tile', group: 'surfaces', rooms: PLAN_ONLY,
    prompt: 'And in the baths, laundry and entry?',
    help: 'The wet rooms usually change material even when the rest of the house does not.',
    options: materialOptions('floor_tile'), default: firstMaterial('floor_tile'),
    writes: { kind: 'material', slot: 'floor_tile' },
  }),
  choice({
    id: 'plan.walls', group: 'surfaces', rooms: PLAN_ONLY,
    prompt: 'What colour are the walls?',
    help: 'One wall colour through the house to start with — you can change a room later.',
    options: materialOptions('walls'), default: firstMaterial('walls'),
    writes: { kind: 'material', slot: 'walls' },
  }),
  choice({
    id: 'plan.trim', group: 'surfaces', rooms: PLAN_ONLY,
    prompt: 'What colour is the trim and casing?',
    help: 'Baseboard, door and window casing, and the stair skirt. Usually a shade off the wall, often white.',
    options: materialOptions('interior_trim'), default: firstMaterial('interior_trim'),
    writes: { kind: 'material', slot: 'interior_trim' },
  }),
  choice({
    id: 'plan.stair-treads', group: 'surfaces', rooms: PLAN_ONLY,
    prompt: 'What are the stair treads?',
    help: 'The step you walk on. A hardwood tread over a painted riser is the common answer.',
    options: materialOptions('stair_treads'), default: firstMaterial('stair_treads'),
    writes: { kind: 'material', slot: 'stair_treads' },
  }),


  // ---- kitchen ------------------------------------------------------------
  choice({
    id: 'kitchen.layout', group: 'layout', rooms: ['kitchen'],
    prompt: 'How do the cabinets run?',
    help: 'Walk the room in your head and count the walls that carry cabinets.',
    options: opts(KITCHEN_LAYOUTS, {
      galley: 'two runs facing each other',
      'l-shaped': 'two runs meeting in a corner',
      'u-shaped': 'three walls of cabinets',
      peninsula: 'a run that turns out into the room',
    }),
    default: 'l-shaped', writes: { kind: 'field', path: 'layout' },
  }),
  choice({
    id: 'kitchen.island', group: 'layout', rooms: ['kitchen'],
    prompt: 'Is there an island?',
    help: 'You need about 42 inches of walkway on every side of one. We will tell you if it does not fit.',
    options: YES_NO, default: 'true', writes: { kind: 'field', path: 'island.present' },
  }),
  number({
    id: 'kitchen.room-width', group: 'layout', rooms: ['kitchen'],
    prompt: 'How wide is the kitchen?',
    help: 'Wall to wall, along the run with the sink. A tape on the floor beats a guess — every cabinet in the twin is laid out against this number.',
    unit: 'ft', min: 5, max: 60, step: 0.5, default: 16,
    writes: { kind: 'field', path: 'dims.widthFt' },
  }),
  number({
    id: 'kitchen.room-depth', group: 'layout', rooms: ['kitchen'],
    prompt: 'How deep is it?',
    help: 'The other direction — from the run with the sink to the wall behind you.',
    unit: 'ft', min: 5, max: 60, step: 0.5, default: 14,
    writes: { kind: 'field', path: 'dims.depthFt' },
  }),
  number({
    id: 'kitchen.ceiling', group: 'layout', rooms: ['kitchen'],
    prompt: 'How high is the ceiling?',
    help: 'Floor to ceiling. It decides whether the wall cabinets stop short, run to the ceiling, or stack two high.',
    unit: 'ft', min: 7, max: 16, step: 0.5, default: 9,
    writes: { kind: 'field', path: 'dims.ceilingFt' },
  }),
  choice({
    id: 'kitchen.cabinet-material', group: 'cabinetry', rooms: ['kitchen'],
    prompt: 'Painted cabinets, or stained wood?',
    help: 'Paint reads crisp and hides joints; stain shows the grain and hides wear.',
    options: opts(CABINET_FAMILIES, { paint: 'a colour, any colour', 'stained-wood': 'oak, walnut, cherry — the grain shows', laminate: 'a printed foil over MDF, the budget answer' }),
    default: 'paint', writes: { kind: 'finish', slot: 'cabinets_base', part: 'family' },
  }),
  colour({
    id: 'kitchen.cabinet-colour', group: 'cabinetry', rooms: ['kitchen'],
    prompt: 'What colour are the cabinets?',
    help: 'Give us the colour in daylight, not under the kitchen lights. If you have a paint chip, use its number in the notes.',
    default: '#F2F0EC', writes: { kind: 'finish', slot: 'cabinets_base', part: 'colour' },
  }),
  choice({
    id: 'kitchen.cabinet-door', group: 'cabinetry', rooms: ['kitchen'],
    prompt: 'What door style?',
    help: 'This is the single thing that decides whether the kitchen reads modern or traditional.',
    options: opts(DOOR_STYLES, { shaker: 'a flat panel in a square frame', slab: 'one flat face, no frame', raised: 'a moulded, stepped panel' }),
    default: 'shaker', writes: { kind: 'field', path: 'cabinets.doorStyle' },
  }),
  choice({
    id: 'kitchen.countertop', group: 'surfaces', rooms: ['kitchen'],
    prompt: 'What are the countertops?',
    help: 'Quartz is the workhorse; marble is beautiful and stains; butcher block wants oiling.',
    options: materialOptions('countertop'), default: firstMaterial('countertop'),
    writes: { kind: 'material', slot: 'countertop' },
  }),
  choice({
    id: 'kitchen.backsplash-pattern', group: 'surfaces', rooms: ['kitchen'],
    prompt: 'How is the backsplash laid?',
    help: 'Running bond is the offset brick pattern; stacked lines the joints up; a slab has no joints at all.',
    options: opts(BACKSPLASH_PATTERNS, { 'running-bond': 'offset like brickwork', stacked: 'grid, joints lined up', slab: 'one piece of stone, no grout' }),
    default: 'running-bond', writes: { kind: 'field', path: 'backsplash.pattern' },
  }),
  choice({
    id: 'kitchen.backsplash-size', group: 'surfaces', rooms: ['kitchen'],
    prompt: 'What size is the backsplash tile?',
    help: 'Bigger tile means fewer grout lines and a calmer wall.',
    options: MODULE_OPTIONS, default: '3x6', writes: { kind: 'finish', slot: 'backsplash', part: 'module' },
  }),
  choice({
    id: 'kitchen.flooring', group: 'surfaces', rooms: ['kitchen'],
    prompt: 'What is on the floor?',
    help: 'In a kitchen this is the surface that takes the most abuse — and the one you see most of.',
    options: materialOptions('flooring'), default: firstMaterial('flooring'),
    writes: { kind: 'material', slot: 'flooring' },
  }),
  choice({
    id: 'kitchen.floor-direction', group: 'surfaces', rooms: ['kitchen'],
    prompt: 'Which way do the boards run?',
    help: 'Boards running away from the door make a room read longer; running across it make it read wider.',
    options: PLANK_RUNS.map((v) => ({ value: v, ...PLANK_RUN_LABEL[v] })),
    default: 'toward', writes: { kind: 'finish', slot: 'flooring', part: 'plankRun' },
  }),
  colour({
    id: 'kitchen.wall-colour', group: 'surfaces', rooms: ['kitchen'],
    prompt: 'What colour are the walls?',
    help: 'The paint above the backsplash and around the room. Off-white if you are not sure.',
    default: '#F1EFEA', writes: { kind: 'finish', slot: 'walls', part: 'colour' },
  }),
  choice({
    id: 'kitchen.wall-sheen', group: 'surfaces', rooms: ['kitchen'],
    prompt: 'How much shine on the wall paint?',
    help: 'Matte hides a bumpy wall; satin and up wipe clean, which matters behind a cooker.',
    options: SHEEN_OPTIONS, default: 'satin', writes: { kind: 'finish', slot: 'walls', part: 'sheen' },
  }),
  choice({
    id: 'kitchen.hardware', group: 'fixtures', rooms: ['kitchen'],
    prompt: 'What metal for the pulls and the tap?',
    help: 'Pick one and repeat it. Two metals in a small kitchen reads as a mistake.',
    options: materialOptions('hardware', 10, 10), default: firstMaterial('hardware'),
    writes: { kind: 'material', slot: 'hardware' },
  }),
  choice({
    id: 'kitchen.appliance-finish', group: 'fixtures', rooms: ['kitchen'],
    prompt: 'What finish are the appliances?',
    help: 'Panel-ready means the fridge and dishwasher wear cabinet doors and disappear.',
    options: opts(APPLIANCE_FINISHES, { 'panel-ready': 'hidden behind cabinet fronts' }),
    default: 'stainless', writes: { kind: 'field', path: 'appliances[].finish' },
  }),

  // ---- bathroom -----------------------------------------------------------
  choice({
    id: 'bath.layout', group: 'layout', rooms: ['bathroom'],
    prompt: 'What kind of bathroom is this?',
    help: 'A powder room is a toilet and a sink; a primary bath has a separate tub and shower.',
    options: opts(BATH_LAYOUTS, {
      powder: 'toilet and sink only',
      'three-quarter': 'shower, no tub',
      full: 'tub or tub-shower, toilet, sink',
      primary: 'double vanity, separate tub and shower',
    }),
    default: 'full', writes: { kind: 'field', path: 'layout' },
  }),
  choice({
    id: 'bath.shower', group: 'layout', rooms: ['bathroom'],
    prompt: 'Is there a walk-in shower?',
    help: 'Separate from the tub. If the shower is over the tub, answer no and say yes to the tub.',
    options: YES_NO, default: 'true', writes: { kind: 'field', path: 'shower.present' },
  }),
  choice({
    id: 'bath.tub', group: 'layout', rooms: ['bathroom'],
    prompt: 'Is there a tub?',
    help: 'Resale wants at least one tub in the house; a primary bath does not have to be it.',
    options: YES_NO, default: 'true', writes: { kind: 'field', path: 'tub.present' },
  }),
  number({
    id: 'bath.room-width', group: 'layout', rooms: ['bathroom'],
    prompt: 'How wide is the bathroom?',
    help: 'Wall to wall, along the vanity. Six inches decides whether a double vanity fits, so measure it if you can.',
    unit: 'ft', min: 3, max: 40, step: 0.5, default: 10,
    writes: { kind: 'field', path: 'dims.widthFt' },
  }),
  number({
    id: 'bath.room-depth', group: 'layout', rooms: ['bathroom'],
    prompt: 'How deep is it?',
    help: 'From the vanity wall to the wall opposite.',
    unit: 'ft', min: 3, max: 40, step: 0.5, default: 11,
    writes: { kind: 'field', path: 'dims.depthFt' },
  }),
  number({
    id: 'bath.ceiling', group: 'layout', rooms: ['bathroom'],
    prompt: 'How high is the ceiling?',
    help: 'Floor to ceiling. Full-height tile is priced to this number, so it is worth a tape measure.',
    unit: 'ft', min: 7, max: 16, step: 0.5, default: 8.5,
    writes: { kind: 'field', path: 'dims.ceilingFt' },
  }),
  choice({
    id: 'bath.vanity-style', group: 'cabinetry', rooms: ['bathroom'],
    prompt: 'What kind of vanity?',
    help: 'Floating hangs off the wall and shows floor under it; furniture-style stands on legs like a sideboard.',
    options: opts(VANITY_STYLES, { floating: 'wall-hung, floor runs under it', furniture: 'legs, like a piece of furniture', console: 'an open metal frame' }),
    default: 'freestanding', writes: { kind: 'field', path: 'vanity.style' },
  }),
  choice({
    id: 'bath.vanity-sinks', group: 'layout', rooms: ['bathroom'],
    prompt: 'One basin or two?',
    help: 'Two basins want at least 60 inches of vanity. Under that, one basin and more counter beats two and none.',
    options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two', hint: 'needs 60 in or more' }],
    default: '1', writes: { kind: 'field', path: 'vanity.sinks' },
  }),
  choice({
    id: 'bath.vanity-material', group: 'cabinetry', rooms: ['bathroom'],
    prompt: 'Painted vanity, or stained wood?',
    help: 'In a wet room, a painted or veneered box holds up better than solid wood.',
    options: opts(CABINET_FAMILIES), default: 'paint',
    writes: { kind: 'finish', slot: 'vanity_cabinet', part: 'family' },
  }),
  colour({
    id: 'bath.vanity-colour', group: 'cabinetry', rooms: ['bathroom'],
    prompt: 'What colour is the vanity?',
    help: 'In daylight, not under the vanity lights — bathroom bulbs push everything warm.',
    default: '#F2F0EC', writes: { kind: 'finish', slot: 'vanity_cabinet', part: 'colour' },
  }),
  choice({
    id: 'bath.vanity-top', group: 'surfaces', rooms: ['bathroom'],
    prompt: 'What is the vanity top?',
    help: 'A small top is where a slab remnant goes furthest — this is the cheapest place to buy real stone.',
    options: materialOptions('vanity_top'), default: firstMaterial('vanity_top'),
    writes: { kind: 'material', slot: 'vanity_top' },
  }),
  choice({
    id: 'bath.wall-tile', group: 'surfaces', rooms: ['bathroom'],
    prompt: 'What is the wall tile?',
    help: 'This is most of what you see standing in the door, so it is worth spending time on.',
    options: materialOptions('wall_tile'), default: firstMaterial('wall_tile'),
    writes: { kind: 'material', slot: 'wall_tile' },
  }),
  choice({
    id: 'bath.tile-pattern', group: 'surfaces', rooms: ['bathroom'],
    prompt: 'How is the tile laid?',
    help: 'The same tile reads completely differently stacked, offset or in a herringbone.',
    options: opts(TILE_PATTERNS, {
      stacked: 'grid, joints lined up',
      'running-bond': 'offset like brickwork',
      'vertical-stack': 'turned on end, makes the room taller',
      herringbone: 'a 45° zigzag',
      slab: 'one piece, no grout',
    }),
    default: 'running-bond', writes: { kind: 'field', path: 'wallTile.pattern' },
  }),
  choice({
    id: 'bath.tile-size', group: 'surfaces', rooms: ['bathroom'],
    prompt: 'What size is the tile?',
    help: 'Large format means fewer grout lines to scrub; small mosaic grips underfoot in a shower.',
    options: MODULE_OPTIONS, default: '3x6', writes: { kind: 'field', path: 'wallTile.moduleIn' },
  }),
  number({
    id: 'bath.tile-height', group: 'surfaces', rooms: ['bathroom'],
    prompt: 'How high does the wall tile go?',
    help: 'Measured from the finished floor. A wainscot stops at 42 in, a full-height wall runs to the ceiling.',
    unit: 'in', min: 0, max: 120, step: 6, default: 48,
    writes: { kind: 'field', path: 'wallTile.heightIn' },
  }),
  choice({
    id: 'bath.floor-tile', group: 'surfaces', rooms: ['bathroom'],
    prompt: 'What is on the floor?',
    help: 'Anything going in a shower or on a bathroom floor wants a slip rating, so small tile and more grout is a feature here.',
    options: materialOptions('floor_tile'), default: firstMaterial('floor_tile'),
    writes: { kind: 'material', slot: 'floor_tile' },
  }),
  colour({
    id: 'bath.wall-colour', group: 'surfaces', rooms: ['bathroom'],
    prompt: 'What colour is the paint above the tile?',
    help: 'Bathrooms want a scrubbable satin or semi-gloss, whatever the colour.',
    default: '#F1EFEA', writes: { kind: 'finish', slot: 'walls', part: 'colour' },
  }),
  choice({
    id: 'bath.wall-sheen', group: 'surfaces', rooms: ['bathroom'],
    prompt: 'How much shine on the wall paint?',
    help: 'A bathroom wants at least satin — matte paint in a wet room does not survive being wiped.',
    options: SHEEN_OPTIONS, default: 'satin', writes: { kind: 'finish', slot: 'walls', part: 'sheen' },
  }),
  choice({
    id: 'bath.fixture-finish', group: 'fixtures', rooms: ['bathroom'],
    prompt: 'What metal for the taps, the shower and the towel bars?',
    help: 'Pick one metal and carry it through the whole room, including the shower door hardware.',
    options: opts(FIXTURE_FINISHES, { chrome: 'the default, and the easiest to keep clean', 'matte-black': 'shows water spots, reads modern', 'brushed-gold': 'warm, forgiving, currently everywhere' }),
    default: 'chrome', writes: { kind: 'field', path: 'shower.hardwareFinish' },
  }),

  // ---- exterior / lot -----------------------------------------------------
  choice({
    id: 'ext.house-style', group: 'basics', rooms: ['exterior'],
    prompt: 'What style of house are we putting on it?',
    help: 'This drives the roof pitch, the trim width, the window proportions and the porch.',
    options: opts(HOUSE_STYLES, { 'modern-farmhouse': 'steep gables, board-and-batten, black windows', ranch: 'one storey, long and low', 'northwest-contemporary': 'deep overhangs, cedar, big glass' }),
    default: 'modern-farmhouse', writes: { kind: 'field', path: 'houseStyle' },
  }),
  number({
    id: 'ext.stories', group: 'basics', rooms: ['exterior'],
    prompt: 'How many storeys?',
    help: 'Two storeys buy floor area without buying more foundation or more roof.',
    unit: 'storeys', min: 1, max: 3, step: 1, default: 2,
    writes: { kind: 'field', path: 'house.stories' },
  }),
  number({
    id: 'ext.lot-width', group: 'site', rooms: ['exterior'],
    prompt: 'How wide is the lot at the street?',
    help: 'Off the plat or the survey if you have one; pacing the frontage is close enough if you do not.',
    unit: 'ft', min: 20, max: 600, step: 1, default: 80,
    writes: { kind: 'field', path: 'lot.widthFt' },
  }),
  number({
    id: 'ext.lot-depth', group: 'site', rooms: ['exterior'],
    prompt: 'How deep is the lot?',
    help: 'Front property line to back property line.',
    unit: 'ft', min: 20, max: 600, step: 1, default: 120,
    writes: { kind: 'field', path: 'lot.depthFt' },
  }),
  number({
    id: 'ext.setback-front', group: 'site', rooms: ['exterior'],
    prompt: 'What is the front setback?',
    help: 'How far back from the front property line the house has to sit. Your zoning code or the plat will say; 20–30 ft is typical.',
    unit: 'ft', min: 0, max: 200, step: 1, default: 30,
    writes: { kind: 'field', path: 'lot.setbackFrontFt' },
  }),
  number({
    id: 'ext.footprint-width', group: 'site', rooms: ['exterior'],
    prompt: 'How wide is the house itself?',
    help: 'Across the front. Leave at least 5 ft to each side property line — we will warn you if it will not fit.',
    unit: 'ft', min: 12, max: 150, step: 1, default: 44,
    writes: { kind: 'field', path: 'house.footprint.widthFt' },
  }),
  number({
    id: 'ext.footprint-depth', group: 'site', rooms: ['exterior'],
    prompt: 'How deep is the house?',
    help: 'Front wall to back wall.',
    unit: 'ft', min: 12, max: 150, step: 1, default: 34,
    writes: { kind: 'field', path: 'house.footprint.depthFt' },
  }),
  choice({
    id: 'ext.siding-material', group: 'surfaces', rooms: ['exterior'],
    prompt: 'What goes on the walls?',
    help: 'Lap siding, board-and-batten, shingle, brick or stucco — this is the biggest single surface on the job.',
    options: opts(SIDING_FAMILIES, { siding: 'lap or board-and-batten', shingle: 'cedar or fibre-cement shakes', 'stained-wood': 'cedar or a rain screen' }),
    default: 'siding', writes: { kind: 'finish', slot: 'siding_primary', part: 'family' },
  }),
  colour({
    id: 'ext.siding-colour', group: 'surfaces', rooms: ['exterior'],
    prompt: 'What colour is the siding?',
    help: 'Hold the chip outside in daylight — exterior colour reads two shades lighter in full sun than it does on the chip.',
    default: '#E8E6E0', writes: { kind: 'finish', slot: 'siding_primary', part: 'colour' },
  }),
  colour({
    id: 'ext.trim-colour', group: 'surfaces', rooms: ['exterior'],
    prompt: 'What colour is the trim?',
    help: 'The corner boards, the window casings and the fascia. Usually a clean white or the siding colour two steps darker.',
    default: '#FAF8F4', writes: { kind: 'finish', slot: 'trim', part: 'colour' },
  }),
  choice({
    id: 'ext.roof-type', group: 'basics', rooms: ['exterior'],
    prompt: 'What shape is the roof?',
    help: 'A gable has two slopes and an end wall; a hip slopes on all four sides.',
    options: opts(ROOF_TYPES, { gable: 'two slopes, a triangle end wall', hip: 'slopes on all four sides', shed: 'one slope, modern' }),
    default: 'gable', writes: { kind: 'field', path: 'house.roof.type' },
  }),
  choice({
    id: 'ext.roof-material', group: 'surfaces', rooms: ['exterior'],
    prompt: 'What is the roof?',
    help: 'Architectural asphalt is the default; standing-seam metal costs more and lasts twice as long.',
    options: materialOptions('roof'), default: firstMaterial('roof'),
    writes: { kind: 'material', slot: 'roof' },
  }),
  colour({
    id: 'ext.roof-colour', group: 'surfaces', rooms: ['exterior'],
    prompt: 'What colour is the roof?',
    help: 'A dark roof grounds a light house; a light roof runs cooler in the sun.',
    default: '#3A3B3D', writes: { kind: 'finish', slot: 'roof', part: 'colour' },
  }),
  colour({
    id: 'ext.front-door-colour', group: 'fixtures', rooms: ['exterior'],
    prompt: 'What colour is the front door?',
    help: 'The one place on the elevation where a strong colour costs nothing and pays for itself.',
    default: '#22364F', writes: { kind: 'finish', slot: 'front_door', part: 'colour' },
  }),
  number({
    id: 'ext.garage-bays', group: 'layout', rooms: ['exterior'],
    prompt: 'How many garage bays?',
    help: 'A single bay is about 9 ft of door, a double 16 ft. Zero if the parking is a pad.',
    unit: 'bays', min: 0, max: 3, step: 1, default: 2,
    writes: { kind: 'field', path: 'house.garage.bays' },
  }),
  choice({
    id: 'ext.porch', group: 'layout', rooms: ['exterior'],
    prompt: 'Is there a covered porch at the front door?',
    help: 'Even 6 ft deep changes how the house reads from the street, and keeps the rain off the entry.',
    options: YES_NO, default: 'true', writes: { kind: 'field', path: 'house.porch.present' },
  }),

  // ---- anything the catalogue cannot ask ----------------------------------
  text({
    id: 'notes', group: 'basics', rooms: ALL_ROOMS,
    prompt: 'Anything else we should know?',
    help: 'Must-keeps, things you hate, a paint number, a tile you already bought, how you actually use the room.',
    writes: { kind: 'field', path: 'detected.notes' },
  }),
];

// ---------------------------------------------------------------------------
// Which questions to ask
// ---------------------------------------------------------------------------

export interface QuestionsOptions {
  /** ask everything the room type allows, even what the spec already knows */
  includeAnswered?: boolean;
}

/**
 * A slot the analyzer actually READ off a photograph. An observation whose
 * visibility is 'inferred' is the model's guess, not a reading, so it is not
 * an answer and the question still gets asked.
 */
function observedSlots(spec: RoomSpec | null | undefined): Set<string> {
  const out = new Set<string>();
  const list = spec?.detected?.finishes;
  if (!Array.isArray(list)) return out;
  for (const f of list) if (f && typeof f === 'object' && f.visibility !== 'inferred' && typeof f.slot === 'string') out.add(f.slot);
  return out;
}

/**
 * What the analyzer says when a DRAWING carried no dimensions.
 *
 * A plan is the one upload that can be precise about size — it has the
 * numbers written on it — and the one upload where a guessed size looks
 * exactly as authoritative as a read one. Scaling an undimensioned sheet off
 * an assumed 36in door that is really 32in is 12% out, and that error
 * multiplies across every wall, so the analyzer refuses (see the READING A
 * DRAWING step in `ai/prompt.ts`) and `applyPlanLimits` puts this sentence on
 * the spec instead. It is the flag, not just a message: `questionsFor` reads
 * it and turns the room-size questions back on.
 */
export const PLAN_NO_DIMENSIONS = 'The plan carried no dimension strings we could read, so the room size is a placeholder — give us the size and the twin is rebuilt to it.';

/** The size questions, which are asked only when nothing measured the room. */
const SIZE_QUESTIONS = new Set(['kitchen.room-width', 'kitchen.room-depth', 'bath.room-width', 'bath.room-depth']);

/**
 * Whether we still have to ASK how big the room is.
 *
 * A dimensioned plan already answered it — re-asking would put a stock 16×14
 * in front of a client whose sheet says 12'-6" × 10'-0", and the interview
 * fills in every question's default for anyone who clicks through, so that
 * stock number would then overwrite the one we read. A drawing the analyzer
 * could not dimension, and a bare lot with nothing to measure at all, have
 * not been answered by anything.
 *
 * The ceiling is NOT part of this: it is on the elevation sheet, never on the
 * plan, so it is asked on every drawing however well dimensioned.
 */
export function planSizeUnknown(spec: RoomSpec | null | undefined, inputKind: InputKind): boolean {
  if (inputKind === 'room-photo') return false;
  if (inputKind !== 'floor-plan' && inputKind !== 'plans-document') return true;
  const assumptions = spec?.detected?.assumptions;
  if (!Array.isArray(assumptions)) return true;
  return assumptions.includes(PLAN_NO_DIMENSIONS);
}

/**
 * The questions to ask for this upload, in catalogue order.
 *
 * A question is skipped when (a) it does not apply to the room type, (b) it
 * does not apply to the input kind — a room photograph answers nearly
 * everything, so it asks only what no photograph can show — or (c) the spec
 * already carries a real reading for the slot it would ask about, or (d) it
 * asks the room size and the plan's own dimension strings already gave it.
 * (c) is why a floor plan with one interior photograph attached does not
 * re-ask the cabinet colour that photograph already gave us.
 */
export function questionsFor(
  roomType: RoomType,
  inputKind: InputKind,
  spec?: RoomSpec | null,
  options: QuestionsOptions = {},
): IntakeQuestion[] {
  const observed = options.includeAnswered ? new Set<string>() : observedSlots(spec);
  return INTAKE_QUESTIONS.filter((q) => {
    if (!q.rooms.includes(roomType)) return false;
    if (!options.includeAnswered && !q.inputs.includes(inputKind)) return false;
    // a plan that carried its own dimensions has already answered these
    if (!options.includeAnswered && SIZE_QUESTIONS.has(q.id) && !planSizeUnknown(spec, inputKind)) return false;
    const w = q.writes;
    if ((w.kind === 'finish' || w.kind === 'material') && observed.has(w.slot)) return false;
    return true;
  });
}

/** Grouped for a paged interview: `[group, questions]` in `INTAKE_GROUPS` order, empty groups dropped. */
export function questionGroups(questions: readonly IntakeQuestion[]): Array<[IntakeGroup, IntakeQuestion[]]> {
  return INTAKE_GROUPS
    .map((g) => [g, questions.filter((q) => q.group === g)] as [IntakeGroup, IntakeQuestion[]])
    .filter(([, qs]) => qs.length > 0);
}

export const questionById = (id: string): IntakeQuestion | undefined => INTAKE_QUESTIONS.find((q) => q.id === id);

/**
 * Every question's default, as answers — what a client who skips the whole
 * interview gets.
 *
 * `spec` is optional but you almost always have one, and it matters: without
 * it `questionsFor` cannot tell a dimensioned plan from a blind one, so
 * `planSizeUnknown` says "unknown", the size questions come back in, and the
 * stock 16 × 14 lands on top of the 12'-6" × 10'-0" we read off the sheet.
 * Pass the spec and the plan keeps its own dimensions — the same gate the
 * guided path gets through `interviewQuestions`.
 */
export function defaultAnswers(roomType: RoomType, inputKind: InputKind, spec?: RoomSpec | null): IntakeAnswer[] {
  // `fromDefault` because nobody touched any of these: they still land, but
  // they must never outrank the product on the slot they describe.
  return questionsFor(roomType, inputKind, spec).map((q) => ({ id: q.id, value: q.default, values: [], fromDefault: true }));
}

// ---------------------------------------------------------------------------
// Intake state — created, healed, persisted
// ---------------------------------------------------------------------------

const INPUT_KINDS: readonly InputKind[] = ['room-photo', 'empty-lot', 'floor-plan', 'plans-document'];
export const isInputKind = (v: unknown): v is InputKind => typeof v === 'string' && (INPUT_KINDS as readonly string[]).includes(v);

/** A fresh, unanswered intake for an upload of this kind. */
export function emptyIntake(inputKind: InputKind = 'room-photo'): IntakeState {
  return { inputKind, answers: [], capturedAt: null };
}

/**
 * Repair whatever came out of localStorage, a share link or an API body into a
 * usable IntakeState. Same contract as `healContract`: never throws, never
 * drops the client's answers, and `null` in means `null` out (never asked).
 */
export function healIntake(raw: unknown): IntakeState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<IntakeState>;
  const answers = Array.isArray(r.answers) ? r.answers : [];
  const seen = new Set<string>();
  const clean: IntakeAnswer[] = [];
  for (const a of answers) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || seen.has(a.id)) continue;
    seen.add(a.id);
    clean.push({
      id: a.id,
      value: typeof a.value === 'string' ? a.value.slice(0, 2000) : '',
      values: Array.isArray(a.values) ? a.values.filter((v): v is string => typeof v === 'string').slice(0, 24) : [],
      // absent (an answer persisted before the flag existed, or one a client
      // typed) means the client's own — only an explicit `true` demotes it
      ...(a.fromDefault === true ? { fromDefault: true } : {}),
    });
  }
  return {
    inputKind: isInputKind(r.inputKind) ? r.inputKind : 'room-photo',
    answers: clean,
    capturedAt: typeof r.capturedAt === 'string' ? r.capturedAt : null,
  };
}

// ---------------------------------------------------------------------------
// Applying the answers
// ---------------------------------------------------------------------------

export interface ApplyIntakeResult {
  spec: RoomSpec;
  /** one line per answer that landed, in the words a change log would use */
  wrote: string[];
  /** answers that did not land, and why */
  skipped: string[];
}

const HEX = /^#?([0-9a-f]{6})$/i;
const parseColour = (v: string): string | null => {
  const m = HEX.exec(v.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
};

/** '12x24' → { w: 12, h: 24 }; anything else → null. */
export function parseModule(v: string): { w: number; h: number } | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/i.exec(v);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Write `value` at a dotted path. A `[]` segment writes EVERY element of that
 * array — "the appliances are stainless" is one answer about six appliances.
 * Returns false when the path does not exist on this spec, which is how a
 * question aimed at a field the room does not have is skipped instead of
 * inventing one.
 */
function writePath(root: Record<string, unknown>, path: string, value: unknown): boolean {
  const parts = path.split('.');
  const last = parts.pop();
  if (!last) return false;
  let targets: unknown[] = [root];
  for (const part of parts) {
    const key = part.endsWith('[]') ? part.slice(0, -2) : part;
    const next: unknown[] = [];
    for (const t of targets) {
      if (!isObj(t)) continue;
      const child = t[key];
      if (part.endsWith('[]')) { if (Array.isArray(child)) next.push(...child); }
      else if (child !== undefined && child !== null) next.push(child);
    }
    targets = next;
    if (!targets.length) return false;
  }
  const key = last.endsWith('[]') ? last.slice(0, -2) : last;
  let wrote = false;
  for (const t of targets) {
    if (!isObj(t) || !(key in t)) continue;
    t[key] = value;
    wrote = true;
  }
  return wrote;
}

/** The value an answer carries, coerced for the question that asked it. */
function answerValue(q: IntakeQuestion, a: IntakeAnswer): { ok: true; value: unknown } | { ok: false; why: string } {
  const raw = (a.value ?? '').trim();
  if (!raw && q.type !== 'text') return { ok: false, why: 'left blank' };
  switch (q.type) {
    case 'colour': {
      const hex = parseColour(raw);
      return hex ? { ok: true, value: hex } : { ok: false, why: `'${raw}' is not a #RRGGBB colour` };
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, why: `'${raw}' is not a number` };
      const lo = q.min ?? -Infinity;
      const hi = q.max ?? Infinity;
      return { ok: true, value: Math.min(hi, Math.max(lo, n)) };
    }
    case 'text':
      return { ok: true, value: raw };
    case 'multi': {
      const allowed = new Set(q.options.map((o) => o.value));
      const picked = (a.values ?? []).filter((v) => allowed.has(v));
      return picked.length ? { ok: true, value: picked } : { ok: false, why: 'no valid option chosen' };
    }
    default: {
      // Options come from the real enums and the real catalog, so membership
      // here IS validity: nothing can write a spec value that does not exist.
      if (!q.options.some((o) => o.value === raw)) return { ok: false, why: `'${raw}' is not one of the offered options` };
      if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' };
      const asNumber = Number(raw);
      if (q.options.every((o) => Number.isFinite(Number(o.value)))) return { ok: true, value: asNumber };
      return { ok: true, value: raw };
    }
  }
}

/** A tile module written into a `moduleIn`-shaped field rather than an observation. */
const MODULE_FIELDS = new Set(['wallTile.moduleIn', 'wallTile.showerModuleIn', 'backsplash.moduleIn']);

/**
 * The half-built observations, one per slot, that the finish-part answers
 * assemble. Filled in from the answers, then completed with the same neutral
 * defaults a partial photo reading gets.
 */
interface FinishDraft {
  family?: FinishFamily;
  baseColorHex?: string;
  accentColorHex?: string;
  pattern?: FinishPattern;
  sheen?: FinishSheen;
  moduleIn?: { w: number; h: number };
  plankRun?: PlankRun;
}

/** family → the pattern and sheen that family wears when nobody said. */
const FAMILY_DEFAULTS: Partial<Record<FinishFamily, { pattern: FinishPattern; sheen: FinishSheen }>> = {
  paint: { pattern: 'solid', sheen: 'satin' },
  'stained-wood': { pattern: 'wood-grain', sheen: 'satin' },
  laminate: { pattern: 'solid', sheen: 'matte' },
  siding: { pattern: 'lap', sheen: 'matte' },
  shingle: { pattern: 'shingle', sheen: 'matte' },
  brick: { pattern: 'brick', sheen: 'matte' },
  stucco: { pattern: 'solid', sheen: 'matte' },
  'porcelain-tile': { pattern: 'subway', sheen: 'gloss' },
  'ceramic-tile': { pattern: 'subway', sheen: 'gloss' },
  hardwood: { pattern: 'plank', sheen: 'satin' },
};

/**
 * Write the client's answers into a spec.
 *
 * Pure: the argument is never touched, the result is a fresh object. Anything
 * that cannot land — an answer to a question this room does not have, a colour
 * that is not a colour, an option that has drifted out of the catalogue — is
 * reported in `skipped` and changes nothing, because a guided intake that
 * silently drops a client's answer is worse than one that never asked.
 *
 * Finish answers become `detected.finishes` observations, which is how a
 * photograph's readings reach the materials too: run `ensureSpecMaterials`
 * (or `applyFinishObservations`) over the result and the observation becomes a
 * catalog product, or a custom material carrying exactly the colour the client
 * chose.
 */
export function applyIntakeAnswers(spec: RoomSpec, answers: readonly IntakeAnswer[]): ApplyIntakeResult {
  const out = JSON.parse(JSON.stringify(spec)) as RoomSpec;
  const root = out as unknown as Record<string, unknown>;
  const wrote: string[] = [];
  const skipped: string[] = [];
  /*
   * Two drafts per slot, because the two carry different weight.
   *
   * `stated` is what the client actually chose. `assumed` is a question's own
   * default, filled in for a client who clicked past it (`fromDefault`); it
   * still lands, because the interview showed it preselected, but it ranks
   * BELOW what the surface already is — see the precedence note where the
   * observations are assembled.
   */
  const drafts = new Map<MaterialSlotId, FinishDraft>();
  const assumed = new Map<MaterialSlotId, FinishDraft>();
  const draft = (slot: MaterialSlotId, byDefault: boolean): FinishDraft => {
    const into = byDefault ? assumed : drafts;
    let d = into.get(slot);
    if (!d) { d = {}; into.set(slot, d); }
    return d;
  };

  for (const a of answers) {
    const q = questionById(a?.id);
    if (!q) { skipped.push(`${a?.id ?? '?'}: no such question`); continue; }
    if (!q.rooms.includes(out.roomType)) { skipped.push(`${q.id}: not a ${out.roomType} question`); continue; }
    const parsed = answerValue(q, a);
    if (!parsed.ok) { skipped.push(`${q.id}: ${parsed.why}`); continue; }
    const value = parsed.value;
    const w = q.writes;

    if (w.kind === 'setting') continue; // collected by intakeEstimateSettings

    if (w.kind === 'material') {
      const id = String(value);
      const def = getMaterial(id);
      if (!def || !def.slots.includes(w.slot)) { skipped.push(`${q.id}: '${id}' is not a ${w.slot} material`); continue; }
      (out.materials as unknown as Record<string, string>)[w.slot] = id;
      wrote.push(`${w.slot} = ${def.name}`);
      continue;
    }

    if (w.kind === 'finish') {
      const d = draft(w.slot, a.fromDefault === true);
      switch (w.part) {
        case 'family': d.family = String(value) as FinishFamily; break;
        case 'colour': d.baseColorHex = String(value); break;
        case 'accent': d.accentColorHex = String(value); break;
        case 'pattern': d.pattern = String(value) as FinishPattern; break;
        case 'sheen': d.sheen = String(value) as FinishSheen; break;
        case 'plankRun': d.plankRun = String(value) as PlankRun; break;
        case 'module': {
          const m = parseModule(String(value));
          if (!m) { skipped.push(`${q.id}: '${String(value)}' is not a w×h module`); continue; }
          d.moduleIn = m;
          break;
        }
      }
      wrote.push(`${w.slot} ${w.part} = ${String(value)}`);
      continue;
    }

    // ---- a plain spec field
    if (w.path === 'detected.notes') {
      const s = String(value).trim();
      if (!s) continue;
      out.detected.notes = [...(out.detected.notes ?? []), `client: ${s.slice(0, 500)}`];
      wrote.push('detected.notes += the client\'s own words');
      continue;
    }
    const payload = MODULE_FIELDS.has(w.path) ? parseModule(String(value)) : value;
    if (payload === null && MODULE_FIELDS.has(w.path)) { skipped.push(`${q.id}: '${String(value)}' is not a w×h module`); continue; }
    if (!writePath(root, w.path, payload)) { skipped.push(`${q.id}: ${w.path} does not exist on this ${out.roomType}`); continue; }
    wrote.push(`${w.path} = ${JSON.stringify(payload)}`);
  }

  // ---- the assembled observations, merged over anything the analyzer already saw
  if (drafts.size || assumed.size) {
    const existing = Array.isArray(out.detected.finishes) ? out.detected.finishes : [];
    const byslot = new Map<string, FinishObservation>(existing.map((f) => [f.slot, f]));
    for (const slot of new Set([...drafts.keys(), ...assumed.keys()])) {
      const d = drafts.get(slot) ?? {};
      const asm = assumed.get(slot) ?? {};
      const prev = byslot.get(slot);
      /*
       * WHAT THIS SURFACE ALREADY IS.
       *
       * Some slots are asked for a catalog PRODUCT ("what is the roof?") and
       * some for a FINISH ("what family? what colour?"); a few get one
       * orthogonal finish question on top of a product — the floor's plank
       * direction, the roof's colour. Those used to fabricate a whole
       * observation out of the fallbacks below to carry that single answer,
       * and 'paint' / '#EFECE6' then beat the product the client had just
       * picked from a swatch grid: every roof choice collapsed onto one
       * synthesised custom material, and so did every floor tile.
       *
       * The slot's own material is a far better prior than a hard-coded white
       * paint — it is, literally, what that surface is — so the draft is
       * seeded from it and only the parts the client actually stated are
       * written over the top. A stated colour still re-tints the product; an
       * untouched one no longer destroys it.
       *
       * PRECEDENCE, strongest first:
       *   d    what the client chose here
       *   prev what a photograph was read as showing
       *   own  what the product on this slot already is
       *   asm  the question's default, which nobody touched (`fromDefault`)
       *   the family's habits, then a neutral
       *
       * `asm` sits under `own` on purpose: '#3A3B3D' is the roof question's
       * politeness, not a statement about THIS roof, and ranking it above the
       * product re-matched 8 of the 12 roof swatches onto a neighbour. It
       * still outranks the neutral fallback, so a slot with no product to
       * describe (a wall the analyzer never saw) gets the preselected answer
       * the client was shown rather than a hard-coded white.
       */
      const own = describeMaterial((out.materials as unknown as Record<string, string>)[slot]);
      const family = d.family ?? prev?.family ?? own?.family ?? asm.family ?? 'paint';
      const fam = FAMILY_DEFAULTS[family];
      const obs: FinishObservation = {
        slot,
        family,
        baseColorHex: d.baseColorHex ?? prev?.baseColorHex ?? own?.baseColorHex ?? asm.baseColorHex ?? '#EFECE6',
        accentColorHex: d.accentColorHex ?? prev?.accentColorHex ?? own?.accentColorHex ?? asm.accentColorHex ?? null,
        pattern: d.pattern ?? prev?.pattern ?? own?.pattern ?? asm.pattern ?? fam?.pattern ?? 'solid',
        sheen: d.sheen ?? prev?.sheen ?? own?.sheen ?? asm.sheen ?? fam?.sheen ?? 'satin',
        moduleIn: d.moduleIn ?? prev?.moduleIn ?? own?.moduleIn ?? asm.moduleIn ?? null,
        groutColorHex: prev?.groutColorHex ?? null,
        // 'inferred' on purpose: nobody LOOKED at this surface — the client
        // told us what they want it to be. That is exactly what the word
        // means, and it keeps `questionsFor` willing to ask again.
        description: `client's choice: ${family.replace(/-/g, ' ')}${d.baseColorHex ? ` in ${d.baseColorHex}` : ''}`,
        visibility: 'inferred',
        /*
         * No `asm` here, unlike every line above it. A board direction is not
         * a colour that can be blended onto a product: `matchFinish` treats a
         * catalog floor whose boards run the other way as the WRONG floor and
         * forces a custom synthesis (see `directionOk`), so an untouched
         * default direction did not tint the client's floor, it replaced it —
         * 7 of the 12 kitchen floor swatches. Stated, it still does exactly
         * that, which is the point of asking; unstated, the product keeps the
         * direction it was drawn with.
         */
        plankRun: d.plankRun ?? prev?.plankRun ?? null,
      };
      byslot.set(slot, obs);
    }
    out.detected.finishes = [...byslot.values()];
  }

  return { spec: out, wrote, skipped };
}

/**
 * The estimate settings the answers imply. Separate from
 * `applyIntakeAnswers` because settings live on the Project, not the spec, and
 * one pure function must not reach across both.
 */
export function intakeEstimateSettings(answers: readonly IntakeAnswer[]): Partial<EstimateSettings> {
  const out: Partial<EstimateSettings> = {};
  for (const a of answers) {
    const q = questionById(a?.id);
    if (!q || q.writes.kind !== 'setting') continue;
    if (q.writes.key === 'tier' && (TIERS as readonly string[]).includes(a.value)) out.tier = a.value as Tier;
  }
  return out;
}

/**
 * Whether the studio should stop and ASK.
 *
 * The rule is the client's own: a photograph of a room answers its own
 * questions, and everything else does not. An analysis whose confidence came
 * back at or under `lowConfidence` also earns an interview even on a room
 * photo — the model itself is saying it could not read the space.
 */
export function shouldAskIntake(spec: RoomSpec | null | undefined, lowConfidence = 0.35): boolean {
  if (!spec) return false;
  const kind = spec.detected?.inputKind ?? 'room-photo';
  if (kind !== 'room-photo') return true;
  const c = spec.detected?.confidence;
  return typeof c === 'number' && c <= lowConfidence;
}

/**
 * The intake an analysis implies: what the analyzer said it was looking at,
 * with no answers yet. This is what a caller stores on `project.intake` the
 * moment an analysis comes back, so the studio knows whether to open the
 * interview and the answers have somewhere to go.
 */
export function intakeFromAnalysis(spec: RoomSpec | null | undefined): IntakeState {
  return emptyIntake(isInputKind(spec?.detected?.inputKind) ? spec!.detected.inputKind! : 'room-photo');
}

/** Answers keyed by question id — what a form binds to. */
export const answerMap = (answers: readonly IntakeAnswer[]): Map<string, IntakeAnswer> =>
  new Map(answers.filter((a) => a && typeof a.id === 'string').map((a) => [a.id, a]));

/**
 * Put one answer into a list, replacing any earlier answer to the same
 * question and keeping the catalogue's order. Pure, so a form can call it on
 * every keystroke without the list drifting into duplicates.
 */
export function setAnswer(answers: readonly IntakeAnswer[], id: string, value: string, values: string[] = []): IntakeAnswer[] {
  const next = answers.filter((a) => a.id !== id);
  next.push({ id, value, values });
  const order = new Map(INTAKE_QUESTIONS.map((q, i) => [q.id, i]));
  return next.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}

/**
 * The whole guided path in one call: take the room's template spec, write the
 * client's answers into it, and say what landed. The caller still runs
 * `reconcileSpec` / `ensureSpecMaterials` over the result — this function does
 * not know about the catalog registry or the geometry rules, and must not.
 */
export function specFromIntake(template: RoomSpec, intake: IntakeState): ApplyIntakeResult {
  const applied = applyIntakeAnswers(template, intake.answers);
  applied.spec.detected.inputKind = intake.inputKind;
  return applied;
}
