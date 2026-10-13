/**
 * The décor item vocabulary — the kind list, the material list, and what each
 * kind is made of when the photo could not say. One copy, because three
 * different callers have to agree on it: `sanitize.ts` (which must snap an
 * unknown word to 'other' BEFORE the schema coercer picks the nearest valid
 * enum member for it), `reconcile.ts` (which fills the defaults) and
 * `scene/kitchen/items.ts` (which draws them).
 *
 * Pure and dependency-free on purpose: sanitize.ts is server code and cannot
 * reach into `scene/`, which imports three.
 */
import type { DecorItemKind, DecorItemMaterial, DecorItemOn } from './types';

/** the 36 kinds, in schema order — 29 kitchen, then the bathroom six, then 'other' */
export const ITEM_KINDS: readonly DecorItemKind[] = [
  'pot', 'pan', 'kettle', 'dutch-oven', 'cutting-board', 'bowl', 'fruit-bowl',
  'bottle', 'oil-set', 'vase', 'flowers', 'books', 'utensil-crock', 'knife-block',
  'coffee-maker', 'stand-mixer', 'toaster', 'microwave-countertop', 'soap-set',
  'dish-rack', 'tray', 'candle', 'canister', 'paper-towel', 'plate-stack',
  'mugs', 'jar', 'basket', 'towel',
  'folded-towels', 'soap-pump', 'toothbrush-cup', 'robe', 'bath-mat', 'tissue-box',
  'other',
];

/**
 * The kinds a BATHROOM photograph actually contains. Not a schema restriction
 * — a bathroom may hold a vase, a plant, a book, a tray, and does — but the
 * list the analyzer is shown and the list a bathroom UI offers first. A
 * cutting board on a vanity is a mis-read, not a bathroom.
 */
export const BATHROOM_ITEM_KINDS: readonly DecorItemKind[] = [
  'towel', 'folded-towels', 'soap-pump', 'soap-set', 'bottle', 'jar', 'basket',
  'candle', 'tray', 'toothbrush-cup', 'robe', 'bath-mat', 'tissue-box', 'vase',
  'flowers', 'books', 'plate-stack', 'other',
];

/** the 13 materials, in schema order */
export const ITEM_MATERIALS: readonly DecorItemMaterial[] = [
  'stainless', 'black-metal', 'copper', 'brass', 'enamel', 'ceramic', 'glass',
  'wood', 'plastic', 'fabric', 'paper', 'marble', 'wicker',
];

/** what a kind is made of when the photo could not say */
export const DEFAULT_MATERIAL: Record<DecorItemKind, DecorItemMaterial> = {
  pot: 'stainless', pan: 'stainless', kettle: 'stainless', 'dutch-oven': 'enamel',
  'cutting-board': 'wood', books: 'wood', 'knife-block': 'wood',
  bowl: 'ceramic', 'fruit-bowl': 'ceramic', 'utensil-crock': 'ceramic', canister: 'ceramic',
  mugs: 'ceramic', 'plate-stack': 'ceramic', candle: 'ceramic',
  bottle: 'glass', 'oil-set': 'glass', vase: 'glass', jar: 'glass', flowers: 'glass',
  'coffee-maker': 'stainless', toaster: 'stainless', 'microwave-countertop': 'stainless',
  'soap-set': 'stainless', 'dish-rack': 'stainless', tray: 'stainless',
  'stand-mixer': 'black-metal', 'paper-towel': 'paper', basket: 'wicker', towel: 'fabric',
  // the bathroom six: cloth is cloth, a pump is glass, a tissue box is paper
  'folded-towels': 'fabric', robe: 'fabric', 'bath-mat': 'fabric',
  'soap-pump': 'glass', 'toothbrush-cup': 'ceramic', 'tissue-box': 'paper',
  other: 'ceramic',
};

/** each material's own daylight colour — the fallback when the hex is unreadable */
export const DEFAULT_COLOR: Record<DecorItemMaterial, string> = {
  stainless: '#b9bcc0', 'black-metal': '#1c1d1f', copper: '#b87333', brass: '#c2a15e',
  enamel: '#2b4c7e', ceramic: '#efece6', glass: '#dfe9ee', wood: '#a8865a', plastic: '#f0efe9',
  fabric: '#d9d2c3', paper: '#f6f4ef', marble: '#f2f0ea', wicker: '#b0844f',
};

const KIND_SET = new Set<string>(ITEM_KINDS);
const MATERIAL_SET = new Set<string>(ITEM_MATERIALS);

export const isItemKind = (v: unknown): v is DecorItemKind => typeof v === 'string' && KIND_SET.has(v);
export const isItemMaterial = (v: unknown): v is DecorItemMaterial => typeof v === 'string' && MATERIAL_SET.has(v);

/**
 * default size (inches) and the range a photo reading is allowed to claim.
 *
 * The maxima are the only thing standing between the box ruler and a serving
 * bowl the size of a sink. On the client's tan kitchen two entries landed
 * EXACTLY on `hi` ("wood serving bowl" 16, "brass pot filler" 16), which is the
 * signature of a ruler that over-reads and a ceiling doing all the work — so
 * the ceilings that a photograph can actually justify were measured off the
 * photo and tightened here. A 16 in bowl is a sink; a 20 in counter vase is a
 * floor urn; an object nobody could name ('other') is by definition a SMALL
 * object, because a big one would have been recognised.
 *
 * `items.ts` derives `DEFAULT_SIZE_IN` and `SIZE_RANGE_IN` from this table
 * rather than restating it: the spec path (reconcile, the box synthesiser) and
 * the draw path (the layout's placement solver) clamped against two hand-kept
 * copies, and a copy that drifts lets a 16 in bowl through one of them.
 */
export const ITEM_SIZE: Record<DecorItemKind, [number, number, number]> = {
  pot: [10, 5, 13], pan: [14, 8, 20], kettle: [9, 6, 12], 'dutch-oven': [13, 9, 16],
  'cutting-board': [16, 8, 20], bowl: [9, 4, 13], 'fruit-bowl': [11, 6, 13], bottle: [11, 5, 16],
  'oil-set': [10, 5, 14], vase: [10, 4, 14], flowers: [18, 8, 36], books: [9, 6, 14],
  'utensil-crock': [12, 7, 16], 'knife-block': [9, 6, 12], 'coffee-maker': [14, 9, 18],
  'stand-mixer': [14, 11, 17], toaster: [11, 7, 14], 'microwave-countertop': [20, 16, 26],
  'soap-set': [8, 4, 12], 'dish-rack': [17, 12, 22], tray: [15, 8, 20], candle: [5, 2, 8],
  canister: [8, 4, 10], 'paper-towel': [13, 10, 15], 'plate-stack': [10, 6, 12], mugs: [9, 4, 14],
  jar: [7, 3, 10], basket: [14, 8, 20], towel: [12, 6, 20],
  // Bathroom rulers: a folded bath sheet is ~12 in on its long edge and a
  // stack of three is the same footprint; a hand-soap pump is 6–9 in tall; a
  // toothbrush cup 4–5 in with the brushes standing 2 in proud; a hanging robe
  // reads 40–48 in on a hook; a bath mat is 24 × 36 in, so its LONGEST
  // dimension is 36; a boutique tissue box is a 5 in cube, a rectangular one 9 in.
  'folded-towels': [13, 8, 20], 'soap-pump': [8, 4, 11], 'toothbrush-cup': [5, 3, 8],
  robe: [42, 24, 56], 'bath-mat': [32, 18, 42], 'tissue-box': [9, 4, 12],
  other: [6, 2, 14],
};

/**
 * Kinds that are genuinely appliance-sized: a 20 in countertop microwave and a
 * 17 in stand mixer are real objects at that size, so the oversize rule below
 * must not touch them.
 */
const COUNTER_APPLIANCES: ReadonlySet<DecorItemKind> = new Set<DecorItemKind>([
  'microwave-countertop', 'coffee-maker', 'stand-mixer', 'toaster', 'dish-rack',
  // A folded bath sheet on a vanity really is 13–16 in on its long edge — one
  // object, not two read as one — so the crowded-surface halving must not fire
  // on it any more than it fires on a countertop microwave.
  'folded-towels',
]);

/** past this, a thing standing on a worktop is almost always two things read as one */
export const CROWDED_SURFACE_IN = 15;

/**
 * The size a kind may be, at the place it stands.
 *
 * The per-kind range is a table and a table cannot say the one thing the
 * client's photo demanded: a box on an island or a counter that measures over
 * 15 in is nearly always TWO objects the annotator outlined together (a board
 * AND the loaves on it, a bowl AND the fruit beside it). Clamping such a
 * reading to the kind's ceiling keeps the mistake at full size; halving it
 * toward the kind's own default keeps the object and loses the second one.
 * Nothing on the floor, a shelf or a sill is touched — a floor basket really is
 * 22 in — and neither is an appliance.
 */
export function plausibleSizeIn(kind: DecorItemKind, on: DecorItemOn | null | undefined, sizeIn: number): number {
  const [def, lo, hi] = ITEM_SIZE[kind];
  let v = Number.isFinite(sizeIn) && sizeIn > 0 ? sizeIn : def;
  const crowded = on === 'island' || on === 'counter';
  // …above the kind's OWN default as well as above the threshold, or the rule
  // inflates a kind whose honest default is already large: a floral
  // arrangement defaults to 18 in, and halving a 15.6 in one "toward" 18
  // would push it UP to 16.8.
  if (crowded && !COUNTER_APPLIANCES.has(kind) && v > Math.max(CROWDED_SURFACE_IN, def)) v = (v + def) / 2;
  return Math.min(hi, Math.max(lo, Math.round(v * 10) / 10));
}

/** kinds that can legitimately come in a row or a stack; everything else is forced to 1 */
export const ITEM_STACKABLE = new Set<DecorItemKind>(['canister', 'jar', 'candle', 'bottle', 'mugs', 'plate-stack', 'books', 'folded-towels']);

/** the schema's cap on `decor.items` — the synthesiser and the reconciler share it */
export const MAX_ITEMS = 24;

// ---------------------------------------------------------------------------
// Reading a label
// ---------------------------------------------------------------------------
//
// The photo inventory boxes the small things and names them in plain words —
// "round wood cutting board", "light wood utensil crock", "shallow wood fruit
// bowl with green limes". Those words are the only description of the object
// that exists, so this is where they are turned into a kind, a material, a
// colour and a count. Every table is ordered MOST SPECIFIC FIRST and every
// unknown word degrades ('other', the kind's default material, a neutral
// colour) rather than throwing: a label nobody anticipated must still draw
// something on the counter.

/** words that carry no meaning for matching or classification */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'with', 'and', 'of', 'in', 'on', 'at', 'to', 'for', 'its', 'plus', 'holding', 'full', 'some',
]);

/** lower-case alphanumeric words, stop words removed — the unit both the kind table and the duplicate matcher work in */
export function labelWords(label: unknown): string[] {
  if (typeof label !== 'string') return [];
  return label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** how much two labels say the same thing, 0..1 — overlap over the SHORTER one, so "wood bowl" fully matches "wood bowl with green limes" */
export function labelOverlap(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const hit = new Set(a.filter((w) => setB.has(w))).size;
  return hit / Math.min(new Set(a).size, new Set(b).size);
}

/** `any` alone matches; with `and`, a word from BOTH lists must appear ("bowl" + "limes" = a fruit bowl) */
interface KindRule { kind: DecorItemKind; any: readonly string[]; and?: readonly string[] }

/** fruit words that turn a plain bowl into a fruit bowl */
const FRUIT = ['fruit', 'fruits', 'lime', 'limes', 'lemon', 'lemons', 'orange', 'oranges', 'apple', 'apples', 'pear', 'pears', 'citrus', 'grape', 'grapes', 'banana', 'bananas', 'peach', 'peaches'];

/**
 * Label → kind, first rule that fires. Order is the whole design: 'cutting
 * board' has to beat 'board', 'fruit bowl' has to beat 'bowl', 'paper towel'
 * has to beat 'towel', and 'vase' has to beat 'branches' so "clear glass vase
 * with green branches" is a vase (the inventory boxed ONE object, not two).
 */
export const KIND_RULES: readonly KindRule[] = [
  { kind: 'cutting-board', any: ['cutting board', 'chopping board', 'chopping block', 'bread board', 'serving board', 'charcuterie', 'cheese board', 'board'] },
  { kind: 'fruit-bowl', any: ['fruit bowl', 'fruit basket', 'bowl of fruit'] },
  { kind: 'fruit-bowl', any: ['bowl', 'bowls'], and: FRUIT },
  { kind: 'utensil-crock', any: ['utensil crock', 'utensil holder', 'utensil jar', 'utensil pot', 'utensil vase', 'utensils', 'crock', 'spoon holder', 'spoon jar'] },
  { kind: 'knife-block', any: ['knife block', 'knife holder', 'knife rack', 'knives'] },
  { kind: 'dutch-oven', any: ['dutch oven', 'braiser', 'cocotte', 'casserole'] },
  { kind: 'stand-mixer', any: ['stand mixer', 'mixer'] },
  { kind: 'coffee-maker', any: ['coffee maker', 'coffee machine', 'espresso machine', 'espresso maker', 'french press', 'coffee grinder', 'coffee pot', 'coffee'] },
  { kind: 'kettle', any: ['kettle', 'teapot', 'tea pot'] },
  { kind: 'toaster', any: ['toaster'] },
  { kind: 'microwave-countertop', any: ['microwave'] },
  { kind: 'paper-towel', any: ['paper towel', 'paper towels', 'kitchen roll'] },
  // --- the bathroom nouns. Each sits ABOVE the generic rule it would
  // otherwise lose to: 'folded towels' before 'towel', 'soap pump' before the
  // soap set, 'toothbrush holder' before 'jar'. 'paper towel' still wins over
  // all of them because it is listed first.
  { kind: 'bath-mat', any: ['bath mat', 'bathmat', 'bath rug', 'shower mat', 'floor mat', 'bath sheet rug'] },
  // The towel noun goes in `any` and the stacking word in `and`, not the other
  // way round, for two reasons. The label reader drops stop words, so "stack OF
  // folded white towels" arrives as [stack, folded, white, towels] and no
  // ADJACENT phrase survives — only an anywhere-plus-anywhere rule fires. And
  // `at` (which is the first `any` hit) is where `colorFromLabel` stops
  // looking: pointing it at 'towels' keeps "white" readable as the towels'
  // colour, where pointing it at 'stack' would throw the colour away.
  { kind: 'folded-towels', any: ['towel', 'towels', 'washcloth', 'washcloths'], and: ['folded', 'rolled', 'stack', 'stacked', 'stacks', 'pile', 'piled', 'bundle'] },
  { kind: 'robe', any: ['bathrobe', 'bath robe', 'robe', 'dressing gown', 'kimono'] },
  { kind: 'toothbrush-cup', any: ['toothbrush holder', 'toothbrush cup', 'toothbrush', 'tooth brush', 'toothbrushes'] },
  { kind: 'tissue-box', any: ['tissue box', 'box of tissues', 'tissues', 'tissue', 'kleenex'] },
  { kind: 'soap-pump', any: ['soap pump', 'pump bottle', 'hand soap', 'liquid soap', 'lotion pump', 'lotion bottle', 'soap bottle', 'hand wash bottle'] },
  { kind: 'dish-rack', any: ['dish rack', 'drying rack', 'draining rack', 'dish drainer'] },
  { kind: 'soap-set', any: ['soap', 'soap dispenser', 'hand wash', 'lotion'] },
  { kind: 'oil-set', any: ['oil set', 'oil and vinegar', 'olive oil', 'oil bottle', 'oil cruet', 'cruet'] },
  { kind: 'plate-stack', any: ['plate stack', 'stack of plates', 'plates', 'plate', 'dishes'] },
  { kind: 'mugs', any: ['mug', 'mugs', 'cup', 'cups', 'teacup', 'teacups'] },
  { kind: 'canister', any: ['canister', 'canisters', 'tin', 'tins'] },
  // A drinking glass is a straight-sided glass vessel, which is exactly what
  // `jarParts` draws for a glass material. Only MULTI-WORD glassware phrases:
  // the bare word 'glass' is a material, and putting it here would read
  // "clear glass vase with green branches" as a jar.
  { kind: 'jar', any: ['jar', 'jars', 'drinking glass', 'water glass', 'juice glass', 'glass tumbler', 'tumbler', 'stemware', 'wine glass', 'goblet', 'highball'] },
  { kind: 'bottle', any: ['bottle', 'bottles', 'carafe', 'decanter', 'wine'] },
  { kind: 'vase', any: ['vase', 'vases', 'bud vase', 'pitcher', 'pitchers', 'jug', 'jugs', 'ewer', 'urn'] },
  // A planter is a vessel WITH A PLANT IN IT. It used to sit in the `bowl`
  // rule, so "white planter with green plant" drew an empty bowl and the
  // plant — the whole reason the box was drawn — vanished. The `flowers`
  // builder composes a vessel plus stems plus leaves, so it keeps both.
  { kind: 'flowers', any: ['flower', 'flowers', 'floral', 'florals', 'bouquet', 'branch', 'branches', 'stem', 'stems', 'sprig', 'sprigs', 'eucalyptus', 'greenery', 'foliage', 'tulips', 'arrangement', 'planter', 'planters', 'potted plant', 'potted', 'houseplant', 'plant', 'plants', 'herb', 'herbs', 'succulent', 'succulents', 'orchid', 'fern'] },
  { kind: 'books', any: ['cookbook', 'cookbooks', 'book', 'books'] },
  { kind: 'basket', any: ['basket', 'baskets'] },
  { kind: 'towel', any: ['towel', 'towels', 'tea towel', 'dish cloth', 'napkins'] },
  { kind: 'candle', any: ['candle', 'candles', 'candlestick', 'candle holder', 'candleholder', 'taper', 'votive', 'hurricane'] },
  { kind: 'tray', any: ['tray', 'trays', 'platter', 'platters'] },
  { kind: 'bowl', any: ['bowl', 'bowls', 'trough', 'catchall', 'compote', 'dish'] },
  { kind: 'pot', any: ['stockpot', 'saucepan', 'saucepot', 'cooking pot', 'pot', 'pots'] },
  { kind: 'pan', any: ['frying pan', 'saute pan', 'skillet', 'griddle', 'wok', 'pan', 'pans'] },
];

/**
 * Things that are NOT objects standing on a surface, however confidently the
 * inventory boxed them.
 *
 * The prompt has always told both vision passes to leave the wall pot filler,
 * the faucet, the sink soap dispenser, outlets, switches and cabinet hardware
 * alone, and it is still told to; a prompt is not a net. The live run on the
 * client's tan kitchen boxed "brass pot filler", the word 'pot' fired the pot
 * rule, and a wall-mounted faucet was drawn as a 16 in stock pot standing on
 * the counter.
 *
 * The test is not "does this word appear" — "copper pot with handle" is a pot,
 * not a piece of hardware. It is "is this word the OBJECT": the rejected phrase
 * has to sit at or before the noun that named the kind (see `readKind`).
 */
export const NOT_AN_ITEM: readonly string[] = [
  'pot filler', 'filler', 'faucet', 'spout', 'soap dispenser',
  'outlet', 'outlets', 'socket', 'switch', 'light switch', 'switch plate', 'cover plate',
  'pull', 'pulls', 'handle', 'handles', 'knob', 'knobs', 'hinge', 'hinges', 'hardware',
  'sconce', 'sconces', 'vent', 'register', 'thermostat', 'stool', 'stools',
  // …and the bathroom's own wall fittings, which are `accessories` now, not
  // objects standing on a surface. Without these a boxed towel bar draws a
  // folded towel lying on the vanity — the same mistake the brass pot filler
  // made in the client's tan kitchen.
  'towel bar', 'towel rail', 'towel ring', 'towel warmer', 'towel rack',
  'robe hook', 'hook', 'hooks', 'grab bar', 'toilet paper holder', 'paper holder',
  'shower head', 'showerhead', 'shower caddy', 'shower valve', 'toilet',
];

/**
 * Where in the label a rule fired: `at` is the word index of the noun, so a
 * colour AFTER it ("bowl with GREEN limes") is the contents, not the object.
 * `kind` is **null** when the label names something that is not an object at
 * all — the caller drops the entry rather than re-hosting it.
 */
export interface KindRead { kind: DecorItemKind | null; at: number }

/** true when `phrase` (one or more words) appears in `words`; returns its start index or -1 */
function phraseAt(words: readonly string[], phrase: string): number {
  const parts = phrase.split(' ');
  for (let i = 0; i + parts.length <= words.length; i++) {
    let hit = true;
    for (let j = 0; j < parts.length; j++) if (words[i + j] !== parts[j]) { hit = false; break; }
    if (hit) return i;
  }
  return -1;
}

/** Label → kind and where its noun sits. An unreadable label is 'other' at the end of the words. */
export function readKind(label: unknown): KindRead {
  const words = labelWords(label);
  let reject = -1;
  for (const p of NOT_AN_ITEM) { const i = phraseAt(words, p); if (i >= 0 && (reject < 0 || i < reject)) reject = i; }
  for (const rule of KIND_RULES) {
    let at = -1;
    for (const p of rule.any) { const i = phraseAt(words, p); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) continue;
    if (rule.and && !rule.and.some((w) => phraseAt(words, w) >= 0)) continue;
    // the rejected word IS the object when it stands at or before the kind's
    // own noun: "brass POT FILLER" is plumbing, "copper POT with a HANDLE" is a pot
    return reject >= 0 && reject <= at ? { kind: null, at: reject } : { kind: rule.kind, at };
  }
  return reject >= 0 ? { kind: null, at: reject } : { kind: 'other', at: words.length };
}

/** Label → kind; anything the reject list drops degrades to 'other' for callers that must draw something. */
export const kindFromLabel = (label: unknown): DecorItemKind => readKind(label).kind ?? 'other';

/**
 * Label → material, most specific first. 'metal' on its own reads STAINLESS,
 * not black: an unreadable object drawn in a neutral grey is a mistake a
 * client forgives, a black one in a white kitchen is not.
 */
export const MATERIAL_RULES: ReadonlyArray<readonly [DecorItemMaterial, readonly string[]]> = [
  ['copper', ['copper']],
  ['brass', ['brass', 'bronze', 'gold', 'golden', 'gilt', 'gilded']],
  ['enamel', ['enamel', 'enameled', 'enamelled', 'lacquer', 'lacquered']],
  ['glass', ['glass', 'crystal', 'clear']],
  ['marble', ['marble', 'granite', 'soapstone', 'stone', 'travertine', 'alabaster']],
  ['wicker', ['woven', 'wicker', 'rattan', 'seagrass', 'cane', 'jute', 'raffia', 'basketweave']],
  ['wood', ['wood', 'wooden', 'oak', 'walnut', 'teak', 'acacia', 'maple', 'bamboo', 'beech', 'birch', 'cherry', 'butcher']],
  ['ceramic', ['ceramic', 'stoneware', 'porcelain', 'terracotta', 'earthenware', 'pottery', 'clay', 'china', 'planter']],
  ['stainless', ['stainless', 'steel', 'chrome', 'nickel', 'silver', 'aluminium', 'aluminum', 'pewter', 'metal', 'metallic']],
  ['paper', ['paper', 'cardboard']],
  ['fabric', ['linen', 'cotton', 'fabric', 'cloth', 'textile', 'canvas']],
  ['plastic', ['plastic', 'acrylic', 'melamine', 'silicone']],
  ['black-metal', ['cast iron', 'wrought iron', 'iron', 'matte black', 'black']],
];

/** Label → material, or null when the words name none (the caller falls back to the kind's default). */
export function materialFromLabel(label: unknown): DecorItemMaterial | null {
  const words = labelWords(label);
  for (const [material, phrases] of MATERIAL_RULES) if (phrases.some((p) => phraseAt(words, p) >= 0)) return material;
  return null;
}

/** colour words a vision model actually writes, in neutral daylight */
export const COLOR_WORDS: Readonly<Record<string, string>> = {
  white: '#F2F0EC', cream: '#EDE6D8', ivory: '#F1EADC', beige: '#DCCFB8', oatmeal: '#DED4C0',
  tan: '#C6A981', taupe: '#B5A895', natural: '#C9AE86', camel: '#C09A6B', sand: '#D6C3A1',
  brown: '#8A6440', chocolate: '#5A4030', walnut: '#6B4A32', honey: '#C79A5B',
  black: '#1C1D1F', charcoal: '#3A3B3D', grey: '#9EA0A2', gray: '#9EA0A2', silver: '#C3C6C9',
  green: '#7E8F62', sage: '#9AA88A', olive: '#6F7448', emerald: '#2F6B4F',
  blue: '#3F5D80', navy: '#22364F', teal: '#2F6B6B',
  red: '#9E3B32', terracotta: '#B4674A', rust: '#A2542F', orange: '#C97B3C',
  yellow: '#D3B15A', mustard: '#C09A3E', amber: '#C08A45',
  pink: '#D8A6A0', blush: '#E0BDB4', purple: '#6B5480',
  clear: '#DFE9EE', copper: '#B87333', brass: '#C2A15E', gold: '#C2A15E', bronze: '#9C7A47',
};

/**
 * The colour word describing the OBJECT — one standing before the kind's own
 * noun. "wood bowl with green limes" is a wood bowl holding green fruit, not
 * a green bowl; `before` is `readKind().at` and cuts exactly that mistake.
 * `hex` is null when the label only shaded a colour it did not name ("light
 * wood" = the material's own colour, lifted).
 */
export function colorFromLabel(label: unknown, before = Infinity): { hex: string | null; lighten: boolean; darken: boolean } {
  const words = labelWords(label);
  let hex: string | null = null;
  let lighten = false;
  let darken = false;
  for (let i = 0; i < words.length && i < before; i++) {
    const w = words[i];
    if (w === 'light' || w === 'pale' || w === 'soft' || w === 'bleached') lighten = true;
    else if (w === 'dark' || w === 'deep' || w === 'rich') darken = true;
    else if (!hex && COLOR_WORDS[w]) hex = COLOR_WORDS[w];
  }
  return { hex, lighten, darken };
}

/** number words a label uses for a row or a stack */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, pair: 2, trio: 3,
};

/** How many identical things the label describes — "three canisters" is one entry with count 3. */
export function countFromLabel(label: unknown): number {
  const words = labelWords(label);
  for (const w of words) {
    if (NUMBER_WORDS[w]) return NUMBER_WORDS[w];
    const n = Number(w);
    if (Number.isInteger(n) && n >= 2 && n <= 12) return n;
  }
  return 1;
}

/**
 * The colour and material words a label uses to describe the OBJECT — what two
 * differently-named readings of one thing still have in common. The two vision
 * passes rarely choose the same noun for the same object ("copper pitcher" and
 * "copper metal vase" are one pot on the client's counter), but they almost
 * always agree about what it is made of and what colour it is, so this is the
 * tie-breaker the duplicate matcher falls back on when the nouns disagree.
 * Materials come back NORMALISED (the material name, not the word), so
 * "woven" and "wicker" are the same descriptor and "bronze" and "brass" are.
 */
export function descriptorWords(label: unknown): string[] {
  const words = labelWords(label);
  const out = new Set<string>();
  const material = materialFromLabel(label);
  if (material) out.add(material);
  for (const w of words) if (COLOR_WORDS[w]) out.add(w);
  return [...out];
}
