import { shelfFootprint, shelfPoint } from '../shelf-frame';
import { orientShelfParts } from './shelf-transform';
/**
 * The things standing ON a surface — the pot on the burner, the kettle, the
 * knife block, the row of canisters, the fruit bowl on the island.
 *
 * The client's words were "every small detail like a small thing in a cabinet
 * to be shown, a pot on the stove to be shown". `decor.items` is the analyzer's
 * answer; this file turns each entry into geometry.
 *
 * WHAT LIVES WHERE
 *  - the SHAPE TABLES below (proportions, default and range sizes, default
 *    material and colour, which kinds may repeat) are the single source of
 *    truth: the layout's placement solver imports them so the box it reserves
 *    is the box that gets drawn;
 *  - `layout.ts buildDecor` does the PLACING (which burner, which free stretch
 *    of counter, which shelf board) and hands back `KItem`s already in metres
 *    and already clamped to their headroom;
 *  - this file only draws what it is given, so an item can never end up in two
 *    places or be sized differently from the space reserved for it.
 *
 * Every part here is a `prop()` or a tinted-metal part. NEVER a `surface()`:
 * items carry no material slot, are not pickable and must never reach the
 * estimate — a staged kettle is not scope the contractor is selling.
 */
import * as THREE from 'three';
import { spaceAlong } from '@/components/scene/detail';
import { deltaE, lightness } from '@/lib/materials/color';
import { ITEM_KINDS, ITEM_SIZE } from '@/lib/spec/decor-items';
import type { DecorItemKind, DecorItemMaterial } from '@/lib/spec/types';
import { compact, type Look, type Part, type PartOpts, type UtilKind } from './parts';
import {
  basket, bookStack, bottle, candle, coffeeMaker, countertopMicrowave, cuttingBoard, dishRack,
  dutchOven, foldedTowel, fruit, fruitBowl, fryingPan, jar, kettle, knifeBlock, leafCluster, mug,
  paperTowel, planter, plateStack, servingBowl, soapDispenser, softForm, standMixer, stems,
  stockPot, toaster, tray, utensils, vase,
} from './helpers';
import type { KItem, KitchenLayoutData } from './layout';

// ---------------------------------------------------------------------------
// Shape tables — shared with the layout's placement solver
// ---------------------------------------------------------------------------

/** Bounding box of each kind as fractions of the item's LONGEST dimension. */
export const ITEM_PROPORTIONS: Record<DecorItemKind, { w: number; h: number; d: number }> = {
  pot: { w: 0.8, h: 0.6, d: 0.8 },
  pan: { w: 1.0, h: 0.15, d: 0.55 },
  kettle: { w: 0.9, h: 0.95, d: 0.9 },
  'dutch-oven': { w: 1.0, h: 0.5, d: 0.85 },
  'cutting-board': { w: 0.7, h: 1.0, d: 0.1 },
  bowl: { w: 1.0, h: 0.35, d: 1.0 },
  'fruit-bowl': { w: 1.0, h: 0.45, d: 1.0 },
  bottle: { w: 0.3, h: 1.0, d: 0.3 },
  'oil-set': { w: 0.6, h: 1.0, d: 0.35 },
  vase: { w: 0.4, h: 1.0, d: 0.4 },
  flowers: { w: 0.8, h: 1.0, d: 0.8 },
  books: { w: 1.0, h: 0.35, d: 0.7 },
  'utensil-crock': { w: 0.5, h: 1.0, d: 0.5 },
  'knife-block': { w: 0.6, h: 1.0, d: 0.5 },
  'coffee-maker': { w: 0.7, h: 1.0, d: 0.8 },
  'stand-mixer': { w: 0.6, h: 1.0, d: 0.9 },
  toaster: { w: 1.0, h: 0.65, d: 0.6 },
  'microwave-countertop': { w: 1.0, h: 0.55, d: 0.75 },
  'soap-set': { w: 1.0, h: 0.6, d: 0.4 },
  'dish-rack': { w: 1.0, h: 0.6, d: 0.7 },
  tray: { w: 1.0, h: 0.08, d: 0.65 },
  candle: { w: 0.35, h: 1.0, d: 0.35 },
  canister: { w: 0.45, h: 1.0, d: 0.45 },
  'paper-towel': { w: 0.55, h: 1.0, d: 0.55 },
  'plate-stack': { w: 1.0, h: 0.4, d: 1.0 },
  mugs: { w: 1.0, h: 0.45, d: 0.55 },
  jar: { w: 0.5, h: 1.0, d: 0.5 },
  basket: { w: 1.0, h: 0.7, d: 0.8 },
  towel: { w: 1.0, h: 0.15, d: 0.7 },
  // --- the bathroom six. A bathroom has no range and no island, so these
  // stand on the vanity top, an open shelf, a sill or the floor; the
  // proportions are read off the same rulers as the kitchen kinds (a bath
  // sheet folds to about 12 x 8 x 4, a hand-soap pump is a tall slim bottle).
  'folded-towels': { w: 1.0, h: 0.45, d: 0.62 },
  'soap-pump': { w: 0.34, h: 1.0, d: 0.34 },
  'toothbrush-cup': { w: 0.55, h: 1.0, d: 0.55 },
  // a robe reads as a hanging column: narrow, deep enough to be cloth, tall
  robe: { w: 0.5, h: 1.0, d: 0.28 },
  'bath-mat': { w: 1.0, h: 0.05, d: 0.62 },
  'tissue-box': { w: 1.0, h: 0.55, d: 0.55 },
  // an unnameable thing is drawn as a soft lozenge lying on the surface: a
  // 14 in one is a bread board's worth of loaves, never a 14 in TOWER
  other: { w: 1.0, h: 0.55, d: 0.7 },
};

/**
 * Longest dimension in inches when the analyzer did not say, and the [min, max]
 * a photo reading may be clamped to — a 40" kettle is a misread, not a kettle.
 *
 * DERIVED from `ITEM_SIZE`, never restated. These used to be a second hand-kept
 * copy of the same numbers: the spec path (reconcile, the box synthesiser)
 * clamped against `ITEM_SIZE` and the DRAW path clamped against these, so the
 * two could disagree about how big a bowl may be — and did, which is how a
 * 16" serving bowl reached the client's island.
 */
export const DEFAULT_SIZE_IN = Object.fromEntries(
  ITEM_KINDS.map((kind) => [kind, ITEM_SIZE[kind][0]]),
) as Record<DecorItemKind, number>;

export const SIZE_RANGE_IN = Object.fromEntries(
  ITEM_KINDS.map((kind) => [kind, [ITEM_SIZE[kind][1], ITEM_SIZE[kind][2]] as [number, number]]),
) as Record<DecorItemKind, [number, number]>;

/** What a kind is made of when the analyzer did not say. */
// The kind→material table and each material's daylight colour are the spec's,
// not the renderer's: sanitize.ts has to snap an unknown word to the same
// answer before the schema coercer ever sees it. Re-exported so this module
// stays the one import for anything drawing an item.
export { DEFAULT_MATERIAL, DEFAULT_COLOR } from '@/lib/spec/decor-items';

/** Kinds that may legitimately appear as a row or a stack; everything else is count 1. */
export const STACKABLE: ReadonlySet<DecorItemKind> = new Set<DecorItemKind>([
  'canister', 'jar', 'candle', 'bottle', 'mugs', 'plate-stack', 'books',
]);

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------

/**
 * How near a util's own colour a hex has to be before we use the util rather
 * than a tinted metal. ΔE 12 is roughly "the same colour, different bulb" — a
 * cream jar keeps the shared ceramic material (one draw call for every ceramic
 * thing in the room); a navy one gets its own tint.
 */
const LOOK_TOLERANCE = 12;

/** top of the shallow tray the oil set and the soap set stand on */
const TRAY_T = 0.0152;

/** util candidate + the fallback tint's surface, per material. */
const LOOK_RULES: Record<DecorItemMaterial, { util: UtilKind | null; hex: string; roughness: number; metalness: number }> = {
  stainless: { util: 'stainless', hex: '#b9bcc0', roughness: 0.28, metalness: 0.95 },
  'black-metal': { util: 'matte-black', hex: '#1a1a1c', roughness: 0.5, metalness: 0.4 },
  brass: { util: 'brushed-brass', hex: '#c2a15e', roughness: 0.32, metalness: 0.9 },
  glass: { util: 'glass', hex: '#dfe9ee', roughness: 0.12, metalness: 0 },
  ceramic: { util: 'ceramic-matte', hex: '#efece6', roughness: 0.6, metalness: 0 },
  plastic: { util: 'white-plastic', hex: '#f4f4f1', roughness: 0.45, metalness: 0 },
  fabric: { util: 'fabric-linen', hex: '#d9d2c3', roughness: 0.95, metalness: 0 },
  paper: { util: 'paper', hex: '#f6f4ef', roughness: 0.9, metalness: 0 },
  marble: { util: 'porcelain', hex: '#f7f7f4', roughness: 0.3, metalness: 0 },
  // no util comes close to these, so they are always tinted
  copper: { util: null, hex: '#b87333', roughness: 0.3, metalness: 1 },
  enamel: { util: null, hex: '#2b4c7e', roughness: 0.25, metalness: 0 },
  wicker: { util: null, hex: '#b0844f', roughness: 0.85, metalness: 0 },
  wood: { util: null, hex: '#a8865a', roughness: 0.6, metalness: 0 },
};

/**
 * The material an item is drawn in. Sharing a util wherever the colour allows
 * is what keeps 24 items inside the draw-call budget: every stainless pan in
 * the room is one material, and only the odd copper kettle costs its own.
 */
export function lookFor(material: DecorItemMaterial, colorHex: string): Look {
  if (material === 'wood') {
    const util: UtilKind = lightness(colorHex) > 55 ? 'light-wood' : 'dark-wood';
    const ref = util === 'light-wood' ? '#c9ad85' : '#4a3526';
    return deltaE(colorHex, ref) <= LOOK_TOLERANCE ? { util } : { metal: { hex: colorHex, roughness: 0.6, metalness: 0 } };
  }
  const rule = LOOK_RULES[material] ?? LOOK_RULES.ceramic;
  if (rule.util && deltaE(colorHex, rule.hex) <= LOOK_TOLERANCE) return { util: rule.util };
  return { metal: { hex: colorHex, roughness: rule.roughness, metalness: rule.metalness } };
}

const UTIL: Record<string, Look> = {
  stainless: { util: 'stainless' },
  black: { util: 'matte-black' },
  glass: { util: 'glass' },
  wood: { util: 'light-wood' },
  darkWood: { util: 'dark-wood' },
  brass: { util: 'brushed-brass' },
  porcelain: { util: 'porcelain' },
  ceramic: { util: 'ceramic-matte' },
  paper: { util: 'paper' },
  plant: { util: 'plant' },
  tan: { util: 'leather-tan' },
  towel: { util: 'towel' },
};

// ---------------------------------------------------------------------------
// Emitting one piece
// ---------------------------------------------------------------------------

/**
 * One mesh of one item, positioned RELATIVE to the item's base centre. Every
 * builder above is authored around its own origin, so a piece only has to say
 * how far up (or along) the assembly it sits.
 */
function piece(it: KItem, suffix: string, look: Look, geometry: THREE.BufferGeometry, o: { dx?: number; dy?: number; dz?: number } & PartOpts = {}): Part {
  const { dx = 0, dy = 0, dz = 0, ...rest } = o;
  const base: PartOpts = {
    position: [it.x + dx, it.y + dy, it.z + dz],
    rotation: [it.lean, it.yaw, 0],
    // a 4" candle casting a shadow map costs as much as the range does; the
    // ambient occlusion pass already grounds anything this small
    castShadow: it.h >= 0.25,
    receiveShadow: true,
    ...rest,
  };
  const key = `${it.id}-${suffix}`;
  return 'util' in look
    ? { key, frame: it.frame, util: look.util, geometry, ...base }
    : { key, frame: it.frame, metal: look.metal, geometry, ...base };
}

/**
 * A row of identical things (three canisters, two candles) as ONE part with
 * instance transforms — not `count` parts. `autoInstance` would fold them
 * anyway once there are six, but a row of three would otherwise be three draw
 * calls, and a lived-in counter is mostly rows of three.
 *
 * `it.w` is ONE object's width, not the row's; the layout reserved the row's
 * whole width for the lane at exactly the 1.1x pitch used here (see
 * `solveItems` — the two must agree or a row overhangs the space kept for it).
 */
function row(it: KItem, radius: number): PartOpts['instances'] {
  if (it.count <= 1) return undefined;
  const pitch = radius * 2.2;
  const span = (it.count - 1) * pitch;
  return spaceAlong(
    [it.x - span / 2, it.y, it.z],
    [it.x + span / 2, it.y, it.z],
    it.count,
    { rotation: [it.lean, it.yaw, 0], inset: false },
  );
}

// ---------------------------------------------------------------------------
// Per-kind geometry
// ---------------------------------------------------------------------------

type Build = (it: KItem, look: Look) => Array<Part | null>;

const ITEM_GEOMETRY: Record<DecorItemKind, Build> = {
  pot: (it, look) => {
    const bodyH = it.h * 0.82;
    const { body, lid } = stockPot(it.w / 2, bodyH);
    return [piece(it, 'body', look, body), piece(it, 'lid', look, lid, { dy: bodyH * 0.94 })];
  },
  pan: (it, look) => {
    // the handle points back toward the middle of the wall (or the island), so
    // a pan on the right-hand burner does not stick out past the run's end
    const flip = it.x > 0 ? -1 : 1;
    const { pan, handle } = fryingPan(it.d / 2, Math.max(0.05, it.w - it.d));
    return [
      piece(it, 'pan', look, pan),
      piece(it, 'handle', UTIL.black, handle, { scale: [flip, 1, 1] }),
    ];
  },
  kettle: (it, look) => [piece(it, 'body', look, kettle(), { scale: it.h / 0.155 })],
  'dutch-oven': (it, look) => {
    const bodyH = it.h * 0.80;
    const { body, lid, knob } = dutchOven(it.w / 2, bodyH);
    return [
      piece(it, 'body', look, body),
      piece(it, 'lid', look, lid, { dy: bodyH * 0.80 }),
      piece(it, 'knob', UTIL.stainless, knob, { dy: bodyH * 1.01 }),
    ];
  },
  'cutting-board': (it, look) => [piece(it, 'board', look, cuttingBoard(it.w, it.h, Math.max(0.012, it.d)))],
  // a serving bowl is deeper and straighter-sided than a fruit bowl; they are
  // the two commonest objects on an island and must not be one shape twice
  bowl: (it, look) => [piece(it, 'bowl', look, servingBowl(it.w / 2, it.h))],
  'fruit-bowl': (it, look) => {
    const r = it.w / 2;
    const fr = fruit(r * 0.28);
    const out: Array<Part | null> = [piece(it, 'bowl', look, fruitBowl(r))];
    const spots: Array<[number, number, number]> = [[-0.34, 0.30, 0.08], [0.32, 0.30, -0.22], [0.03, 0.30, 0.29], [-0.06, 0.52, 0.02]];
    spots.forEach((p, i) => out.push(piece(it, `fruit${i}`, i % 2 ? UTIL.plant : UTIL.tan, fr, {
      dx: p[0] * r, dy: p[1] * r, dz: p[2] * r, castShadow: false,
    })));
    return out;
  },
  bottle: (it) => [piece(it, 'bottle', UTIL.glass, bottle(it.w / 2, it.h), { instances: row(it, it.w / 2) })],
  'oil-set': (it, look) => [
    piece(it, 'tray', UTIL.stainless, tray(it.w, it.d), { castShadow: false }),
    piece(it, 'oil', look, bottle(0.030, Math.max(0.08, it.h - TRAY_T)), { dx: -it.w * 0.20, dy: TRAY_T }),
    piece(it, 'vinegar', look, bottle(0.026, Math.max(0.07, (it.h - TRAY_T) * 0.85)), { dx: it.w * 0.20, dy: TRAY_T }),
  ],
  vase: (it, look) => [piece(it, 'vase', look, vase(it.w / 2, it.h))],
  flowers: (it, look) => {
    // A CLEAR vessel holding stems is a vase; an opaque one is a planter, and
    // 'flowers' is now also where "white planter with green plant" lands (it
    // used to be a `bowl`, which drew the pot and threw the plant away). The
    // planter is squatter, so it gets less of the height and a wider mouth.
    const pot = it.material !== 'glass';
    const vh = it.h * (pot ? 0.38 : 0.50);
    return [
      piece(it, 'vessel', look, pot ? planter(it.w * 0.44, vh) : vase(it.w * 0.30, vh)),
      piece(it, 'stems', UTIL.plant, stems(it.h - vh, pot ? 5 : 7), { dy: vh * 0.94, castShadow: false }),
      piece(it, 'leaves', UTIL.plant, leafCluster(Math.min(1.2, (it.h - vh) / 0.48)), { dy: vh * 0.94, castShadow: false }),
    ];
  },
  books: (it, look) => [piece(it, 'books', look, bookStack(), { scale: it.w / 0.21 })],
  'utensil-crock': (it, look) => {
    const crockH = it.h * 0.52;
    return [
      piece(it, 'crock', look, planter(it.w / 2, crockH)),
      piece(it, 'utensils', UTIL.stainless, utensils(it.h - crockH), { dy: crockH * 0.85, castShadow: false }),
    ];
  },
  'knife-block': (it, look) => {
    const { block, handles } = knifeBlock(it.w, it.h * 0.78, it.d);
    return [piece(it, 'block', look, block), piece(it, 'handles', UTIL.black, handles, { castShadow: false })];
  },
  'coffee-maker': (it, look) => {
    const { body, carafe } = coffeeMaker(it.w, it.h, it.d);
    return [piece(it, 'body', look, body), piece(it, 'carafe', UTIL.glass, carafe, { dy: 0.012, dz: it.d * 0.16, castShadow: false })];
  },
  'stand-mixer': (it, look) => {
    const { body, bowl } = standMixer(it.h);
    return [piece(it, 'body', look, body), piece(it, 'bowl', UTIL.stainless, bowl)];
  },
  toaster: (it, look) => {
    const { body, slots } = toaster(it.w, it.h, it.d);
    return [piece(it, 'body', look, body), piece(it, 'slots', UTIL.black, slots, { castShadow: false })];
  },
  'microwave-countertop': (it, look) => {
    const { body, window, pad } = countertopMicrowave(it.w, it.h, it.d);
    return [
      piece(it, 'body', look, body),
      piece(it, 'window', UTIL.glass, window, { castShadow: false }),
      piece(it, 'pad', UTIL.black, pad, { castShadow: false }),
    ];
  },
  'soap-set': (it, look) => [
    piece(it, 'tray', look, tray(it.w, it.d), { castShadow: false }),
    piece(it, 'soap1', UTIL.glass, soapDispenser(), { dx: -it.w * 0.22, dy: TRAY_T, scale: (it.h - TRAY_T) / 0.082, castShadow: false }),
    piece(it, 'soap2', UTIL.glass, soapDispenser(), { dx: it.w * 0.22, dy: TRAY_T, scale: ((it.h - TRAY_T) / 0.082) * 0.86, castShadow: false }),
  ],
  'dish-rack': (it) => {
    const { rack, plates } = dishRack(it.w, it.d);
    return [piece(it, 'rack', UTIL.stainless, rack), piece(it, 'plates', UTIL.porcelain, plates, { castShadow: false })];
  },
  tray: (it, look) => [piece(it, 'tray', look, tray(it.w, it.d), { castShadow: false })],
  candle: (it, look) => {
    const r = it.w / 2;
    const { body, wick } = candle(r, it.h);
    return [
      piece(it, 'wax', look, body, { instances: row(it, r) }),
      piece(it, 'wick', UTIL.black, wick, { instances: row(it, r), castShadow: false }),
    ];
  },
  canister: (it, look) => jarParts(it, look, 'canister'),
  jar: (it, look) => jarParts(it, look, 'jar'),
  'paper-towel': (it) => {
    const { stand, roll } = paperTowel();
    const s = it.h / 0.33;
    return [
      piece(it, 'stand', UTIL.stainless, stand, { scale: s }),
      piece(it, 'roll', UTIL.paper, roll, { dy: 0.03 * s, scale: s, castShadow: false }),
    ];
  },
  'plate-stack': (it, look) => [piece(it, 'plates', look, plateStack(Math.min(it.w / 2, 0.14), it.count))],
  mugs: (it, look) => {
    // mug() is a fixed 0.084 m across — a mug is a mug at any `sizeIn`, so the
    // row is drawn at a real mug pitch rather than scaled to the reservation
    const pitch = 0.11;
    return [piece(it, 'mugs', look, mug(), {
      instances: it.count > 1
        ? spaceAlong(
          [it.x - (pitch * (it.count - 1)) / 2, it.y, it.z],
          [it.x + (pitch * (it.count - 1)) / 2, it.y, it.z], it.count, { inset: false },
        ).map((t, i) => ({ ...t, rotation: [it.lean, it.yaw + (i % 2 ? 0.6 : -0.6), 0] as [number, number, number] }))
        : undefined,
    })];
  },
  basket: (it, look) => [piece(it, 'basket', look, basket(it.w, it.h))],
  towel: (it, look) => [piece(it, 'towel', 'util' in look && look.util === 'fabric-linen' ? UTIL.towel : look, foldedTowel(it.w, it.d, 3), { castShadow: false })],
  // --- the bathroom six, built from the same helpers as their kitchen
  // cousins. A stack of towels is a towel with more folds; a soap pump is the
  // dispenser the soap set already draws, standing on its own; a toothbrush
  // cup is a lidless jar with the utensil bristles in it; a robe and a bath
  // mat are soft forms. Nothing new had to be modelled, which is the point of
  // reusing the kitchen vocabulary for the bathroom kinds.
  'folded-towels': (it, look) => [
    piece(it, 'stack', 'util' in look && look.util === 'fabric-linen' ? UTIL.towel : look, foldedTowel(it.w, it.d, 5), { castShadow: false }),
  ],
  'soap-pump': (it, look) => [
    piece(it, 'body', it.material === 'glass' ? UTIL.glass : look, soapDispenser(), { scale: it.h / 0.082 }),
  ],
  'toothbrush-cup': (it, look) => {
    const r = it.w / 2;
    const { body } = jar(r, it.h * 0.62, 'clip');
    return [
      piece(it, 'cup', it.material === 'glass' ? UTIL.glass : look, body),
      // the brushes stand proud of the rim, which is what makes the object readable
      piece(it, 'brushes', UTIL.stainless, utensils(it.h * 0.6), { dy: it.h * 0.5, castShadow: false }),
    ];
  },
  robe: (it, look) => [piece(it, 'robe', 'util' in look && look.util === 'fabric-linen' ? UTIL.towel : look, softForm(it.w, it.h, it.d), { castShadow: false })],
  'bath-mat': (it, look) => [
    piece(it, 'mat', 'util' in look && look.util === 'fabric-linen' ? UTIL.towel : look, foldedTowel(it.w, it.d, 1), { castShadow: false }),
  ],
  'tissue-box': (it, look) => [piece(it, 'box', look, softForm(it.w, it.h, it.d), { castShadow: false })],
  other: (it, look) => [piece(it, 'body', look, softForm(it.w, it.h, it.d))],
};

/** Canisters and jars share a builder; only the lid says which is which. */
function jarParts(it: KItem, look: Look, kind: 'canister' | 'jar'): Array<Part | null> {
  const r = it.w / 2;
  const lidKind = it.material === 'glass' ? 'clip' : it.material === 'wood' ? 'wood' : 'metal';
  const { body, lid } = jar(r, it.h, lidKind);
  const lidLook = lidKind === 'wood' ? UTIL.wood : lidKind === 'clip' ? UTIL.stainless : UTIL.brass;
  // a glass jar shows its contents; a ceramic canister is the item's own colour
  const bodyLook = kind === 'jar' && it.material === 'glass' ? UTIL.glass : look;
  return [
    piece(it, 'body', bodyLook, body, { instances: row(it, r) }),
    piece(it, 'lid', lidLook, lid, { instances: row(it, r), castShadow: false }),
  ];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Every `decor.items` entry the layout placed, as parts. */
export function itemsParts(L: KitchenLayoutData): Part[] {
  const out: Array<Part | null> = [];
  for (const it of L.decor.items) {
    const build = ITEM_GEOMETRY[it.kind] ?? ITEM_GEOMETRY.other;
    const host = it.on === 'shelf' ? L.decor.shelves.find((s) => s.id === it.hostId) : null;
    if (host?.enclosure?.rotationDeg) {
      const [x, z] = shelfPoint(host, it.x, it.z, true);
      const authored = { ...it, x, z, yaw: it.yaw - shelfFootprint(host).yaw };
      out.push(...orientShelfParts(host, compact(build(authored, lookFor(it.material, it.colorHex)))));
    } else out.push(...build(it, lookFor(it.material, it.colorHex)));
  }
  return compact(out);
}
