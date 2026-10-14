/**
 * Material catalog — every swappable finish in Unifictional 3D Studio.
 *
 * Each entry knows: where it can be applied (slots), how it is priced
 * (price group + tier + optional multiplier), how it renders in 3D (PBR
 * recipe referencing the CC0 texture manifest), and how to describe it to the
 * photoreal renderer (prompt).
 */
import type { MaterialSlotId, RoomType, Tier } from '@/lib/spec/types';

export type PriceGroup =
  | 'cabinet-paint' | 'cabinet-wood'
  | 'countertop' | 'backsplash' | 'flooring' | 'wall-paint' | 'wall-tile' | 'ceiling'
  | 'siding' | 'roof' | 'exterior-paint' | 'entry-door' | 'garage-door' | 'window'
  | 'hardscape' | 'lawn' | 'fence' | 'deck' | 'railing' | 'column' | 'gutter'
  | 'fixture-finish' | 'appliance-finish' | 'hardware' | 'lighting' | 'tub' | 'mirror';

export type MaterialCategory =
  | 'paint' | 'wood' | 'quartz' | 'granite' | 'marble' | 'quartzite' | 'butcher-block' | 'laminate'
  | 'concrete' | 'porcelain' | 'ceramic' | 'glass-tile' | 'stone' | 'terrazzo' | 'hardwood' | 'engineered'
  | 'lvp' | 'metal' | 'fiber-cement' | 'vinyl' | 'brick' | 'stone-veneer' | 'stucco' | 'asphalt-shingle'
  | 'metal-roof' | 'clay-tile' | 'slate' | 'cedar' | 'pavers' | 'gravel' | 'grass' | 'composite'
  | 'finish' | 'glass' | 'acrylic' | 'cast-iron' | 'other';

/** A canvas-drawn surface: exact real-world module sizes, colours and joints. */
export interface ProceduralSpec {
  /** every generator runProcedural (components/scene/materials.ts) can run; photo-matched materials use the wood/metal/fabric ones */
  kind: 'slab' | 'tile' | 'plank' | 'siding' | 'wood' | 'quartz' | 'grouted-slab' | 'brushed-metal' | 'fabric' | 'painted-wall';
  /** options for the matching generator in components/scene/procedural.ts */
  options: Record<string, unknown>;
  /** how strongly the drawing is turned into relief (grout depth) */
  reliefStrength?: number;
  /** roughness of the joints/grout (tile faces use `roughness`) */
  jointRoughness?: number;
}

export interface PBRRecipe {
  /** procedural surface; when set, `texture` is ignored */
  procedural?: ProceduralSpec;
  /** texture manifest id (public/textures/<id>/{diff,nor,arm}.webp) */
  texture?: string;
  /** if false the diffuse map is ignored and `color` is used (normal/arm still applied for micro-detail) */
  useDiffuse?: boolean;
  /** base colour (hex) — used alone or as a tint over the diffuse map */
  color?: string;
  roughness: number;
  metalness: number;
  /** world-space size in meters of one texture repeat */
  tileM?: number;
  normalScale?: number;
  envMapIntensity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  transmission?: number;
  ior?: number;
  emissive?: string;
  /** rotate texture 90° (e.g. vertical siding) */
  rotate90?: boolean;
}

export interface MaterialDef {
  id: string;
  name: string;
  subtitle?: string;
  category: MaterialCategory;
  group: PriceGroup;
  tier: Tier;
  /** multiplier applied on top of the group/tier unit price (1 = as-is) */
  priceAdj?: number;
  slots: MaterialSlotId[];
  pbr: PBRRecipe;
  /** UI swatch: css colour or an image path */
  swatch: string;
  /** phrase used in photoreal prompts */
  prompt: string;
  tags?: string[];
}

const T = (id: string) => `/textures/${id}/diff.webp`;

// ---------------------------------------------------------------------------
// Paint palette (cabinets, walls, trim, doors, siding paint)
// ---------------------------------------------------------------------------
interface PaintColor { id: string; name: string; hex: string; sub?: string; tags?: string[] }
export const PAINT_COLORS: PaintColor[] = [
  { id: 'pure-white', name: 'Pure White', hex: '#F4F3EE', sub: 'similar to SW 7005' },
  { id: 'alabaster', name: 'Alabaster', hex: '#EDEAE0', sub: 'similar to SW 7008' },
  { id: 'chantilly-lace', name: 'Chantilly Lace', hex: '#F5F5F0', sub: 'similar to BM OC-65' },
  { id: 'swiss-coffee', name: 'Swiss Coffee', hex: '#EDE8DA' },
  { id: 'greige', name: 'Accessible Beige', hex: '#D2C6B4' },
  { id: 'agreeable-gray', name: 'Agreeable Gray', hex: '#D1CBC1' },
  { id: 'repose-gray', name: 'Repose Gray', hex: '#C9C6BF' },
  { id: 'dorian-gray', name: 'Dorian Gray', hex: '#A4A19A' },
  { id: 'mindful-gray', name: 'Mindful Gray', hex: '#B9B5AB' },
  { id: 'iron-ore', name: 'Iron Ore', hex: '#434341', sub: 'charcoal' },
  { id: 'tricorn-black', name: 'Tricorn Black', hex: '#2F2F30' },
  { id: 'hale-navy', name: 'Hale Navy', hex: '#40495A' },
  { id: 'naval', name: 'Naval', hex: '#2F3B4E' },
  { id: 'evergreen-fog', name: 'Evergreen Fog', hex: '#95978A', sub: 'sage' },
  { id: 'pewter-green', name: 'Pewter Green', hex: '#5E6259' },
  { id: 'hunter-green', name: 'Hunter Green', hex: '#3B4F3E' },
  { id: 'salamander', name: 'Salamander', hex: '#2C3A36', sub: 'deep green' },
  { id: 'urbane-bronze', name: 'Urbane Bronze', hex: '#54504A' },
  { id: 'sea-salt', name: 'Sea Salt', hex: '#CDD5CE' },
  { id: 'peppercorn', name: 'Peppercorn', hex: '#585655' },
  { id: 'terracotta', name: 'Cavern Clay', hex: '#AC6E52' },
  { id: 'mushroom', name: 'Mushroom', hex: '#B9AA95' },
  { id: 'rosemary', name: 'Rosemary', hex: '#65705E' },
  { id: 'blush', name: 'Intimate White', hex: '#EBD9D0' },
  { id: 'redend-point', name: 'Redend Point', hex: '#A17F72' },
  { id: 'smoky-blue', name: 'Smoky Blue', hex: '#5B6D7A' },
  { id: 'upward', name: 'Upward', hex: '#A9B7C2', sub: 'soft blue' },
  { id: 'ochre', name: 'Honeycomb', hex: '#D9B15E' },
];

// every paint colour is priced the same, whatever the colour
const PAINT_TIER: Tier = 'standard';

const CABINET_SLOTS: MaterialSlotId[] = ['cabinets_base', 'cabinets_upper', 'island_cabinets', 'cabinets_tall', 'vanity_cabinet'];
const WALL_SLOTS: MaterialSlotId[] = ['walls', 'ceiling'];
const EXT_PAINT_SLOTS: MaterialSlotId[] = ['siding_primary', 'siding_accent', 'trim', 'front_door', 'garage_door', 'window_frames', 'porch_columns', 'railing', 'fence', 'gutters'];

const paintedCabinet = (c: PaintColor): MaterialDef => ({
  id: `cab-${c.id}`, name: c.name, subtitle: c.sub ?? 'painted', category: 'paint', group: 'cabinet-paint', tier: 'standard',
  slots: CABINET_SLOTS,
  pbr: { texture: 'painted_plaster_wall', useDiffuse: false, color: c.hex, roughness: 0.38, metalness: 0.0, tileM: 0.6, normalScale: 0.08, clearcoat: 0.08, clearcoatRoughness: 0.5 },
  swatch: c.hex, prompt: `${c.name} painted cabinets (${c.hex}), smooth satin finish`, tags: ['paint', ...(c.tags ?? [])],
});
const wallPaint = (c: PaintColor): MaterialDef => ({
  id: `wall-${c.id}`, name: c.name, subtitle: 'wall paint', category: 'paint', group: 'wall-paint', tier: PAINT_TIER,
  slots: WALL_SLOTS,
  pbr: { texture: 'plastered_wall', useDiffuse: false, color: c.hex, roughness: 0.9, metalness: 0, tileM: 2.0, normalScale: 0.25 },
  swatch: c.hex, prompt: `${c.name} (${c.hex}) matte painted walls`, tags: ['paint'],
});
const extPaint = (c: PaintColor): MaterialDef => ({
  id: `ext-${c.id}`, name: c.name, subtitle: 'exterior paint', category: 'paint', group: 'exterior-paint', tier: 'standard',
  slots: EXT_PAINT_SLOTS,
  pbr: { color: c.hex, roughness: 0.55, metalness: 0 },
  swatch: c.hex, prompt: `${c.name} (${c.hex}) exterior paint`, tags: ['paint'],
});

// ---------------------------------------------------------------------------
// Wood (cabinet veneers / stains)
// ---------------------------------------------------------------------------
const wood = (id: string, name: string, texture: string, tier: Tier, prompt: string, extra: Partial<PBRRecipe> = {}): MaterialDef => ({
  id: `wood-${id}`, name, subtitle: 'stained wood', category: 'wood', group: 'cabinet-wood', tier,
  slots: CABINET_SLOTS,
  pbr: { texture, roughness: 0.45, metalness: 0, tileM: 1.2, normalScale: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.4, ...extra },
  swatch: extra.color ?? T(texture), prompt, tags: ['wood'],
});

// ---------------------------------------------------------------------------
// Countertops
// ---------------------------------------------------------------------------
const COUNTER_SLOTS: MaterialSlotId[] = ['countertop', 'island_countertop', 'vanity_top'];
const counter = (id: string, name: string, category: MaterialCategory, tier: Tier, pbr: PBRRecipe, swatch: string, prompt: string, priceAdj = 1): MaterialDef => ({
  id: `ct-${id}`, name, category, group: 'countertop', tier, priceAdj, slots: COUNTER_SLOTS, pbr, swatch, prompt, tags: ['countertop'],
});

// ---------------------------------------------------------------------------
// Tile (backsplash + bath walls/floors + shower)
// ---------------------------------------------------------------------------
const BACKSPLASH_SLOTS: MaterialSlotId[] = ['backsplash', 'wall_tile', 'shower_wall_tile'];
const FLOOR_TILE_SLOTS: MaterialSlotId[] = ['flooring', 'floor_tile', 'shower_floor_tile'];
const tile = (id: string, name: string, category: MaterialCategory, tier: Tier, pbr: PBRRecipe, swatch: string, prompt: string, slots: MaterialSlotId[], group: PriceGroup = 'backsplash', priceAdj = 1): MaterialDef => ({
  id: `tile-${id}`, name, category, group, tier, priceAdj, slots, pbr, swatch, prompt, tags: ['tile'],
});

// ---------------------------------------------------------------------------
// Flooring (wood / lvp / laminate)
// ---------------------------------------------------------------------------
const floor = (id: string, name: string, category: MaterialCategory, tier: Tier, texture: string, prompt: string, extra: Partial<PBRRecipe> = {}, priceAdj = 1): MaterialDef => ({
  id: `floor-${id}`, name, category, group: 'flooring', tier, priceAdj, slots: ['flooring', 'floor_tile'],
  pbr: { texture, roughness: 0.5, metalness: 0, tileM: 2.0, normalScale: 0.6, ...extra },
  swatch: T(texture), prompt, tags: ['flooring'],
});

// ---------------------------------------------------------------------------
// Exterior
// ---------------------------------------------------------------------------
const SIDING_SLOTS: MaterialSlotId[] = ['siding_primary', 'siding_accent', 'foundation'];
const siding = (id: string, name: string, category: MaterialCategory, tier: Tier, pbr: PBRRecipe, swatch: string, prompt: string, priceAdj = 1): MaterialDef => ({
  id: `sid-${id}`, name, category, group: 'siding', tier, priceAdj, slots: SIDING_SLOTS, pbr, swatch, prompt, tags: ['siding'],
});
const roof = (id: string, name: string, category: MaterialCategory, tier: Tier, pbr: PBRRecipe, swatch: string, prompt: string, priceAdj = 1): MaterialDef => ({
  id: `roof-${id}`, name, category, group: 'roof', tier, priceAdj, slots: ['roof'], pbr, swatch, prompt, tags: ['roof'],
});
const HARDSCAPE_SLOTS: MaterialSlotId[] = ['driveway', 'walkway', 'patio'];
const hardscape = (id: string, name: string, category: MaterialCategory, tier: Tier, pbr: PBRRecipe, swatch: string, prompt: string, priceAdj = 1): MaterialDef => ({
  id: `hs-${id}`, name, category, group: 'hardscape', tier, priceAdj, slots: HARDSCAPE_SLOTS, pbr, swatch, prompt, tags: ['hardscape'],
});

// ---------------------------------------------------------------------------
// Finishes (metal)
// ---------------------------------------------------------------------------
const FINISH_SLOTS: MaterialSlotId[] = ['hardware', 'faucet', 'fixtures', 'lighting_fixture'];
const finish = (id: string, name: string, color: string, roughness: number, prompt: string, tier: Tier = 'standard', priceAdj = 1): MaterialDef => ({
  id: `fin-${id}`, name, category: 'finish', group: 'hardware', tier, priceAdj, slots: FINISH_SLOTS,
  pbr: { color, roughness, metalness: 1.0, envMapIntensity: 1.2 }, swatch: color, prompt, tags: ['finish'],
});

// ---------------------------------------------------------------------------
// THE CATALOG
// ---------------------------------------------------------------------------
export const CATALOG: MaterialDef[] = [
  // --- painted cabinets / walls / exterior paint
  ...PAINT_COLORS.map(paintedCabinet),
  ...PAINT_COLORS.map(wallPaint),
  ...PAINT_COLORS.map(extPaint),

  // --- stained wood cabinets
  wood('white-oak', 'White Oak', 'white_oak_veneer', 'premium', 'natural white oak rift-cut cabinets with matte clear finish'),
  wood('natural-oak', 'Natural Oak', 'oak_veneer_01', 'standard', 'natural oak cabinets, satin finish'),
  wood('grey-oak', 'Grey Oak', 'grey_oak_veneer_01', 'premium', 'grey-washed oak cabinets'),
  wood('washed-oak', 'Washed Oak', 'washed_grey_oak_veneer', 'premium', 'light washed oak cabinets, Scandinavian'),
  wood('mocha-oak', 'Mocha Oak', 'mocha_oak_veneer', 'standard', 'medium-brown mocha oak cabinets'),
  wood('black-oak', 'Ebonized Oak', 'black_oak_veneer', 'premium', 'ebonized black oak cabinets with visible grain'),
  wood('walnut', 'American Walnut', 'american_walnut_veneer', 'luxury', 'rich American walnut cabinets, flat panel, matte'),
  wood('black-walnut', 'Black Walnut', 'black_walnut_veneer_01', 'luxury', 'dark black walnut cabinets'),
  wood('natural-walnut', 'Natural Walnut', 'natural_walnut_veneer', 'luxury', 'natural walnut cabinets'),
  wood('cherry', 'Cherry', 'cherry_veneer', 'premium', 'warm cherry wood cabinets'),
  wood('cherry-stained', 'Aged Cherry', 'cherry_veneer', 'premium', 'rich reddish-brown stained cherry cabinetry with a satin clear finish', { color: '#89503A', roughness: 0.28, normalScale: 0.18, clearcoat: 0.25, clearcoatRoughness: 0.3 }),
  wood('ash', 'Ash', 'ash_veneer', 'standard', 'pale ash wood cabinets'),

  // --- countertops
  counter('calacatta-quartz', 'Calacatta Gold Quartz', 'quartz', 'premium', { texture: 'marble_01', roughness: 0.12, metalness: 0, tileM: 2.4, normalScale: 0.15, color: '#FFFDF6', clearcoat: 0.3, clearcoatRoughness: 0.1 }, T('marble_01'), 'Calacatta Gold quartz countertop with soft warm grey-gold veining, polished', 1.15),
  counter('carrara-marble', 'Carrara Marble', 'marble', 'premium', { texture: 'marble_01', roughness: 0.1, metalness: 0, tileM: 2.0, normalScale: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.08 }, T('marble_01'), 'honed Carrara marble countertop with grey veining', 1.3),
  counter('white-quartz', 'Pure White Quartz', 'quartz', 'standard', { color: '#F5F4F0', roughness: 0.15, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.15 }, '#F5F4F0', 'solid pure white quartz countertop, polished'),
  counter('grey-quartz', 'Concrete Grey Quartz', 'quartz', 'standard', { color: '#B7B5B0', roughness: 0.3, metalness: 0, texture: 'smooth_concrete_floor', tileM: 2.0, normalScale: 0.15 }, T('smooth_concrete_floor'), 'matte concrete-look grey quartz countertop'),
  counter('black-quartz', 'Absolute Black Quartz', 'quartz', 'premium', { color: '#1E1E20', roughness: 0.18, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.1 }, '#1E1E20', 'polished absolute black quartz countertop', 1.1),
  counter('speckled-granite', 'Speckled Granite', 'granite', 'standard', { texture: 'granite_tile_03', roughness: 0.2, metalness: 0.02, tileM: 1.4, normalScale: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.12 }, T('granite_tile_03'), 'polished speckled grey granite countertop'),
  counter('black-granite', 'Black Pearl Granite', 'granite', 'standard', { texture: 'granite_tile_02', color: '#7A7A7A', roughness: 0.18, metalness: 0.05, tileM: 1.4, normalScale: 0.2, clearcoat: 0.35, clearcoatRoughness: 0.1 }, T('granite_tile_02'), 'polished black pearl granite countertop', 1.05),
  counter('brown-granite', 'Baltic Brown Granite', 'granite', 'standard', { texture: 'granite_tile', roughness: 0.2, metalness: 0.02, tileM: 1.4, normalScale: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.12 }, T('granite_tile'), 'polished Baltic brown granite countertop'),
  counter('golden-granite', 'Golden Sand Granite', 'granite', 'standard', { roughness: 0.22, metalness: 0.02, clearcoat: 0.3, clearcoatRoughness: 0.15, procedural: { kind: 'slab', options: { base: '#C3AD89', vein: '#806D53', intensity: 0.1, veinCount: 2, seed: 29, spanM: 1.2, speckle: 1.0, speckleColor: '#8C755B', speckleRadiusM: 0.0022, speckleColor2: '#40382E', speckleColor3: '#E2D5BD' }, reliefStrength: 0.4 } }, '#C3AD89', 'warm golden beige granite with fine brown, cream and charcoal mineral speckling'),
  counter('grey-granite', 'Steel Grey Granite', 'granite', 'standard', { texture: 'granite_tile_04', roughness: 0.2, metalness: 0.02, tileM: 1.4, normalScale: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.12 }, T('granite_tile_04'), 'polished steel grey granite countertop'),
  counter('taj-quartzite', 'Taj Mahal Quartzite', 'quartzite', 'luxury', { texture: 'marble_tiles', color: '#F1E9DA', roughness: 0.14, metalness: 0, tileM: 2.4, normalScale: 0.12, clearcoat: 0.3, clearcoatRoughness: 0.1 }, T('marble_tiles'), 'Taj Mahal quartzite countertop, creamy with soft gold veins, polished', 1.5),
  counter('butcher-block', 'Butcher Block', 'butcher-block', 'budget', { texture: 'kitchen_wood', roughness: 0.55, metalness: 0, tileM: 1.6, normalScale: 0.5 }, T('kitchen_wood'), 'oiled maple butcher block countertop'),
  counter('oak-block', 'White Oak Block', 'butcher-block', 'standard', { texture: 'oak_wood_planks', roughness: 0.5, metalness: 0, tileM: 1.8, normalScale: 0.5 }, T('oak_wood_planks'), 'white oak butcher block countertop, matte'),
  counter('concrete', 'Poured Concrete', 'concrete', 'premium', { texture: 'smooth_concrete_floor', roughness: 0.45, metalness: 0, tileM: 2.2, normalScale: 0.3 }, T('smooth_concrete_floor'), 'sealed poured concrete countertop, warm grey', 1.1),
  counter('terrazzo', 'Terrazzo', 'terrazzo', 'premium', { texture: 'terrazzo_tiles', roughness: 0.25, metalness: 0, tileM: 1.2, normalScale: 0.15, clearcoat: 0.25, clearcoatRoughness: 0.15 }, T('terrazzo_tiles'), 'polished terrazzo countertop with white and grey chips', 1.2),
  counter('laminate-white', 'White Laminate', 'laminate', 'budget', { color: '#F2F1EC', roughness: 0.35, metalness: 0 }, '#F2F1EC', 'white laminate countertop', 0.9),
  counter('laminate-slate', 'Slate Laminate', 'laminate', 'budget', { color: '#4C4E52', roughness: 0.4, metalness: 0 }, '#4C4E52', 'dark slate-look laminate countertop', 0.9),
  counter('stainless', 'Stainless Steel', 'metal', 'premium', { color: '#C9CACC', roughness: 0.3, metalness: 1.0, envMapIntensity: 1.1 }, '#C9CACC', 'brushed stainless steel countertop', 1.2),
  counter('porcelain-slab', 'Porcelain Slab', 'porcelain', 'premium', { texture: 'marble_tiles', color: '#F7F6F2', roughness: 0.16, metalness: 0, tileM: 3.0, normalScale: 0.05, clearcoat: 0.3, clearcoatRoughness: 0.1 }, T('marble_tiles'), 'large-format marble-look porcelain slab countertop', 1.2),
  counter('soapstone', 'Soapstone', 'stone', 'premium', { color: '#3A3E40', roughness: 0.5, metalness: 0, texture: 'smooth_concrete_floor', tileM: 2.0, normalScale: 0.15 }, '#3A3E40', 'oiled charcoal soapstone countertop with faint white veining', 1.25),

  // --- backsplash / wall tile
  tile('subway-white', 'White Subway 3×6', 'ceramic', 'budget', { texture: 'long_white_tiles', roughness: 0.18, metalness: 0, tileM: 0.9, normalScale: 0.6, clearcoat: 0.4, clearcoatRoughness: 0.1 }, T('long_white_tiles'), 'glossy white 3x6 subway tile backsplash, light grey grout, running bond', BACKSPLASH_SLOTS),
  tile('subway-sage', 'Sage Subway 3×6', 'ceramic', 'standard', { texture: 'long_white_tiles', color: '#B8C4B2', roughness: 0.2, metalness: 0, tileM: 0.9, normalScale: 0.6, clearcoat: 0.4, clearcoatRoughness: 0.1 }, '#B8C4B2', 'glossy sage green subway tile backsplash', BACKSPLASH_SLOTS),
  tile('subway-navy', 'Navy Subway 3×6', 'ceramic', 'standard', { texture: 'long_white_tiles', color: '#3E4A5E', roughness: 0.2, metalness: 0, tileM: 0.9, normalScale: 0.6, clearcoat: 0.4, clearcoatRoughness: 0.1 }, '#3E4A5E', 'glossy navy subway tile backsplash', BACKSPLASH_SLOTS),
  tile('subway-black', 'Black Subway 3×6', 'ceramic', 'standard', { texture: 'long_white_tiles', color: '#2A2A2C', roughness: 0.2, metalness: 0, tileM: 0.9, normalScale: 0.6, clearcoat: 0.4, clearcoatRoughness: 0.1 }, '#2A2A2C', 'glossy black subway tile backsplash', BACKSPLASH_SLOTS),
  tile('zellige-white', 'White Zellige', 'ceramic', 'premium', { texture: 'square_tiled_wall', color: '#F4F0E6', roughness: 0.12, metalness: 0, tileM: 0.8, normalScale: 0.9, clearcoat: 0.5, clearcoatRoughness: 0.08 }, T('square_tiled_wall'), 'handmade white zellige tile backsplash with glossy uneven surfaces', BACKSPLASH_SLOTS, 'backsplash', 1.6),
  tile('zellige-green', 'Emerald Zellige', 'ceramic', 'premium', { texture: 'square_tiled_wall', color: '#3E6B57', roughness: 0.12, metalness: 0, tileM: 0.8, normalScale: 0.9, clearcoat: 0.5, clearcoatRoughness: 0.08 }, '#3E6B57', 'handmade emerald green zellige tile backsplash', BACKSPLASH_SLOTS, 'backsplash', 1.6),
  tile('square-white', 'Square 4×4 White', 'ceramic', 'budget', { texture: 'rounded_square_tiled_wall', color: '#F2F2EE', roughness: 0.2, metalness: 0, tileM: 0.8, normalScale: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.15 }, T('rounded_square_tiled_wall'), 'white square 4x4 ceramic tile backsplash', BACKSPLASH_SLOTS),
  tile('marble-mosaic', 'Marble Mosaic', 'marble', 'premium', { texture: 'marble_mosaic_tiles', roughness: 0.2, metalness: 0, tileM: 0.6, normalScale: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.2 }, T('marble_mosaic_tiles'), 'Carrara marble mosaic tile backsplash', BACKSPLASH_SLOTS, 'backsplash', 1.4),
  tile('marble-slab', 'Marble Slab', 'marble', 'luxury', { texture: 'marble_01', roughness: 0.1, metalness: 0, tileM: 2.4, normalScale: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.08 }, T('marble_01'), 'full-height bookmatched Calacatta marble slab backsplash', BACKSPLASH_SLOTS, 'backsplash', 2.5),
  tile('quartz-slab', 'Quartz Slab', 'quartz', 'premium', { texture: 'marble_01', color: '#FFFDF6', roughness: 0.12, metalness: 0, tileM: 2.4, normalScale: 0.1, clearcoat: 0.3, clearcoatRoughness: 0.1 }, T('marble_01'), 'full-height quartz slab backsplash matching the countertop', BACKSPLASH_SLOTS, 'backsplash', 2.0),
  tile('slate-stacked', 'Stacked Slate', 'stone', 'premium', { texture: 'patterned_slate_tiles', roughness: 0.75, metalness: 0, tileM: 0.9, normalScale: 1.0 }, T('patterned_slate_tiles'), 'stacked natural slate ledger stone backsplash', BACKSPLASH_SLOTS, 'backsplash', 1.3),
  tile('stone-wall', 'Natural Stone', 'stone', 'premium', { texture: 'stone_tile_wall', roughness: 0.7, metalness: 0, tileM: 1.2, normalScale: 0.9 }, T('stone_tile_wall'), 'natural stone tile wall', BACKSPLASH_SLOTS, 'backsplash', 1.3),
  tile('painted-brick', 'Painted Brick', 'brick', 'standard', { texture: 'painted_brick', roughness: 0.8, metalness: 0, tileM: 1.4, normalScale: 0.8 }, T('painted_brick'), 'whitewashed painted brick backsplash', BACKSPLASH_SLOTS),
  tile('hex-white', 'Hex Mosaic White', 'porcelain', 'standard', { texture: 'hexagonal_concrete_paving', color: '#F2F1EC', roughness: 0.25, metalness: 0, tileM: 0.5, normalScale: 0.6 }, T('hexagonal_concrete_paving'), 'white hexagon mosaic tile', [...BACKSPLASH_SLOTS, ...FLOOR_TILE_SLOTS], 'wall-tile', 1.2),
  tile('hex-black', 'Hex Mosaic Black', 'porcelain', 'standard', { texture: 'hexagonal_concrete_paving', color: '#2E2E30', roughness: 0.3, metalness: 0, tileM: 0.5, normalScale: 0.6 }, '#2E2E30', 'matte black hexagon mosaic tile', [...BACKSPLASH_SLOTS, ...FLOOR_TILE_SLOTS], 'wall-tile', 1.2),
  tile('interior-tiles', 'Glazed Grey Tile', 'ceramic', 'standard', { texture: 'interior_tiles', roughness: 0.25, metalness: 0, tileM: 1.0, normalScale: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.2 }, T('interior_tiles'), 'glazed grey ceramic wall tile', BACKSPLASH_SLOTS),
  tile('square-tiles-02', 'Grey Square Tile', 'porcelain', 'standard', { texture: 'square_tiles_02', roughness: 0.35, metalness: 0, tileM: 1.0, normalScale: 0.5 }, T('square_tiles_02'), 'grey square porcelain tile', [...BACKSPLASH_SLOTS, ...FLOOR_TILE_SLOTS], 'wall-tile'),
  tile('large-format-white', 'Large-Format 24×48 Marble-Look', 'porcelain', 'premium', { texture: 'marble_tiles', roughness: 0.15, metalness: 0, tileM: 2.4, normalScale: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.1 }, T('marble_tiles'), 'large-format 24x48 marble-look porcelain tile', [...BACKSPLASH_SLOTS, ...FLOOR_TILE_SLOTS], 'wall-tile', 1.3),
  tile('slab-tiles', 'Stone Slab Tile', 'stone', 'premium', { texture: 'slab_tiles', roughness: 0.4, metalness: 0, tileM: 1.6, normalScale: 0.6 }, T('slab_tiles'), 'large stone slab tile', [...BACKSPLASH_SLOTS, ...FLOOR_TILE_SLOTS], 'wall-tile', 1.2),
  tile('stone-tiles-02', 'Limestone Tile', 'stone', 'premium', { texture: 'stone_tiles_02', roughness: 0.55, metalness: 0, tileM: 1.4, normalScale: 0.6 }, T('stone_tiles_02'), 'honed limestone tile', [...BACKSPLASH_SLOTS, ...FLOOR_TILE_SLOTS], 'wall-tile', 1.3),

  // --- floor tile
  tile('floor-large-grey', 'Large-Format Grey 24×24', 'porcelain', 'standard', { texture: 'large_grey_tiles', roughness: 0.35, metalness: 0, tileM: 1.8, normalScale: 0.3 }, T('large_grey_tiles'), 'large format grey porcelain floor tile', FLOOR_TILE_SLOTS, 'flooring'),
  tile('floor-large-02', 'Large-Format Beige 24×24', 'porcelain', 'standard', { texture: 'large_floor_tiles_02', roughness: 0.35, metalness: 0, tileM: 1.8, normalScale: 0.3 }, T('large_floor_tiles_02'), 'large format warm beige porcelain floor tile', FLOOR_TILE_SLOTS, 'flooring'),
  tile('floor-06', 'Textured Stone Tile', 'porcelain', 'standard', { texture: 'floor_tiles_06', roughness: 0.5, metalness: 0, tileM: 1.5, normalScale: 0.5 }, T('floor_tiles_06'), 'textured stone-look porcelain floor tile', FLOOR_TILE_SLOTS, 'flooring'),
  tile('floor-02', 'Classic Floor Tile', 'ceramic', 'budget', { texture: 'floor_tiles_02', roughness: 0.4, metalness: 0, tileM: 1.2, normalScale: 0.4 }, T('floor_tiles_02'), 'classic ceramic floor tile', FLOOR_TILE_SLOTS, 'flooring', 0.9),
  tile('floor-grey', 'Grey Tile 12×24', 'porcelain', 'standard', { texture: 'grey_tiles', roughness: 0.4, metalness: 0, tileM: 1.2, normalScale: 0.4 }, T('grey_tiles'), 'grey 12x24 porcelain floor tile', FLOOR_TILE_SLOTS, 'flooring'),
  tile('floor-slate', 'Natural Slate', 'slate', 'premium', { texture: 'slate_floor_02', roughness: 0.7, metalness: 0, tileM: 1.5, normalScale: 0.8 }, T('slate_floor_02'), 'natural slate floor tile', FLOOR_TILE_SLOTS, 'flooring', 1.3),
  tile('floor-terracotta', 'Terracotta', 'ceramic', 'standard', { texture: 'terracotta_floor_tiles', roughness: 0.75, metalness: 0, tileM: 1.2, normalScale: 0.6 }, T('terracotta_floor_tiles'), 'terracotta floor tile', FLOOR_TILE_SLOTS, 'flooring', 1.1),
  tile('floor-checker', 'Checkerboard', 'marble', 'premium', { texture: 'checkered_pavement_tiles', roughness: 0.3, metalness: 0, tileM: 1.2, normalScale: 0.3, clearcoat: 0.2, clearcoatRoughness: 0.2 }, T('checkered_pavement_tiles'), 'black and white checkerboard marble floor', FLOOR_TILE_SLOTS, 'flooring', 1.4),
  tile('floor-marble', 'Marble Tile 12×24', 'marble', 'luxury', { texture: 'marble_tiles', roughness: 0.15, metalness: 0, tileM: 1.6, normalScale: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.1 }, T('marble_tiles'), 'polished marble floor tile', FLOOR_TILE_SLOTS, 'flooring', 1.8),
  tile('floor-terrazzo', 'Terrazzo Floor', 'terrazzo', 'premium', { texture: 'terrazzo_tiles', roughness: 0.3, metalness: 0, tileM: 1.2, normalScale: 0.2, clearcoat: 0.2, clearcoatRoughness: 0.2 }, T('terrazzo_tiles'), 'terrazzo floor', FLOOR_TILE_SLOTS, 'flooring', 1.5),
  tile('floor-concrete', 'Polished Concrete', 'concrete', 'standard', { texture: 'concrete_floor_01', roughness: 0.4, metalness: 0, tileM: 2.5, normalScale: 0.3, clearcoat: 0.15, clearcoatRoughness: 0.3 }, T('concrete_floor_01'), 'polished concrete floor', FLOOR_TILE_SLOTS, 'flooring', 0.9),
  tile('floor-tiled-001', 'Patterned Tile', 'porcelain', 'standard', { texture: 'tiled_floor_001', roughness: 0.4, metalness: 0, tileM: 1.2, normalScale: 0.4 }, T('tiled_floor_001'), 'patterned encaustic-look porcelain floor tile', FLOOR_TILE_SLOTS, 'flooring', 1.2),

  // --- wood / lvp flooring
  floor('white-oak-plank', 'White Oak Plank', 'hardwood', 'premium', 'plank_flooring_03', 'wide-plank white oak hardwood floor, matte', {}, 1.2),
  floor('natural-plank', 'Natural Oak Plank', 'hardwood', 'standard', 'plank_flooring', 'natural oak hardwood plank floor'),
  floor('honey-plank', 'Honey Oak Plank', 'hardwood', 'standard', 'plank_flooring_02', 'honey-toned oak hardwood floor'),
  floor('light-plank', 'Light Ash Plank', 'engineered', 'standard', 'plank_flooring_04', 'light ash engineered wood floor'),
  floor('lvp-oak', 'LVP Light Oak', 'lvp', 'budget', 'laminate_floor_02', 'light oak luxury vinyl plank floor', {}, 0.8),
  floor('lvp-grey', 'LVP Grey Wash', 'lvp', 'budget', 'laminate_floor', 'grey-washed luxury vinyl plank floor', { color: '#C9C4BC' }, 0.8),
  floor('herringbone', 'Herringbone Oak', 'hardwood', 'luxury', 'herringbone_parquet', 'herringbone oak parquet floor', { tileM: 1.6 }, 1.6),
  floor('diagonal-parquet', 'Diagonal Parquet', 'hardwood', 'premium', 'diagonal_parquet', 'diagonal oak parquet floor', { tileM: 1.6 }, 1.4),
  floor('rect-parquet', 'Rectangular Parquet', 'hardwood', 'premium', 'rectangular_parquet', 'rectangular oak parquet floor', { tileM: 1.6 }, 1.3),
  floor('dark-walnut', 'Dark Walnut Plank', 'hardwood', 'premium', 'dark_wooden_planks', 'dark walnut wide plank floor', {}, 1.25),
  floor('wood-floor', 'Warm Oak Floor', 'hardwood', 'standard', 'wood_floor', 'warm oak hardwood floor'),

  // --- walls (textured)
  { id: 'wall-plaster', name: 'Venetian Plaster', subtitle: 'limewash', category: 'other', group: 'wall-paint', tier: 'luxury', priceAdj: 3.0, slots: WALL_SLOTS, pbr: { texture: 'white_rough_plaster', roughness: 0.9, metalness: 0, tileM: 2.0, normalScale: 0.6 }, swatch: T('white_rough_plaster'), prompt: 'warm white limewash plaster walls', tags: ['plaster'] },
  { id: 'wall-grey-plaster', name: 'Grey Microcement', subtitle: 'microcement', category: 'concrete', group: 'wall-paint', tier: 'luxury', priceAdj: 3.5, slots: WALL_SLOTS, pbr: { texture: 'grey_plaster_02', roughness: 0.8, metalness: 0, tileM: 2.0, normalScale: 0.5 }, swatch: T('grey_plaster_02'), prompt: 'grey microcement walls', tags: ['plaster'] },
  { id: 'wall-beige', name: 'Warm Beige Plaster', category: 'other', group: 'wall-paint', tier: 'premium', priceAdj: 2.0, slots: WALL_SLOTS, pbr: { texture: 'beige_wall_001', roughness: 0.9, metalness: 0, tileM: 2.0, normalScale: 0.4 }, swatch: T('beige_wall_001'), prompt: 'warm beige textured plaster walls', tags: ['plaster'] },
  { id: 'ceiling-white', name: 'Ceiling White', category: 'paint', group: 'ceiling', tier: 'standard', slots: ['ceiling'], pbr: { texture: 'ceiling_interior', useDiffuse: false, color: '#F7F6F2', roughness: 0.95, metalness: 0, tileM: 2.0, normalScale: 0.2 }, swatch: '#F7F6F2', prompt: 'flat white ceiling', tags: ['paint'] },
  { id: 'ceiling-wood', name: 'Wood Plank Ceiling', category: 'wood', group: 'ceiling', tier: 'luxury', priceAdj: 6.0, slots: ['ceiling'], pbr: { texture: 'plank_flooring_03', roughness: 0.6, metalness: 0, tileM: 2.0, normalScale: 0.5 }, swatch: T('plank_flooring_03'), prompt: 'white oak tongue-and-groove wood ceiling', tags: ['wood'] },

  // --- siding
  siding('hardie-lap-white', 'Fiber Cement Lap · White', 'fiber-cement', 'standard', { texture: 'white_planks_clean', roughness: 0.6, metalness: 0, tileM: 1.6, normalScale: 0.5 }, T('white_planks_clean'), 'white fiber cement horizontal lap siding'),
  siding('hardie-lap-grey', 'Fiber Cement Lap · Grey', 'fiber-cement', 'standard', { texture: 'white_planks_clean', color: '#9A9C9A', roughness: 0.6, metalness: 0, tileM: 1.6, normalScale: 0.5 }, '#9A9C9A', 'light grey fiber cement horizontal lap siding'),
  siding('hardie-lap-navy', 'Fiber Cement Lap · Navy', 'fiber-cement', 'standard', { texture: 'white_planks_clean', color: '#3A4556', roughness: 0.6, metalness: 0, tileM: 1.6, normalScale: 0.5 }, '#3A4556', 'navy fiber cement horizontal lap siding'),
  siding('hardie-lap-charcoal', 'Fiber Cement Lap · Charcoal', 'fiber-cement', 'standard', { texture: 'white_planks_clean', color: '#3F4142', roughness: 0.6, metalness: 0, tileM: 1.6, normalScale: 0.5 }, '#3F4142', 'charcoal fiber cement horizontal lap siding'),
  siding('hardie-lap-sage', 'Fiber Cement Lap · Sage', 'fiber-cement', 'standard', { texture: 'white_planks_clean', color: '#8E9A88', roughness: 0.6, metalness: 0, tileM: 1.6, normalScale: 0.5 }, '#8E9A88', 'sage green fiber cement lap siding'),
  siding('board-batten-white', 'Board & Batten · White', 'fiber-cement', 'premium', { texture: 'wood_plank_wall', color: '#F0EEE8', useDiffuse: false, roughness: 0.6, metalness: 0, tileM: 1.4, normalScale: 0.9, rotate90: true }, '#F0EEE8', 'white vertical board-and-batten siding', 1.15),
  siding('board-batten-black', 'Board & Batten · Black', 'fiber-cement', 'premium', { texture: 'wood_plank_wall', color: '#26282A', useDiffuse: false, roughness: 0.6, metalness: 0, tileM: 1.4, normalScale: 0.9, rotate90: true }, '#26282A', 'black vertical board-and-batten siding', 1.15),
  siding('cedar-natural', 'Natural Cedar', 'cedar', 'premium', { texture: 'wood_plank_wall', roughness: 0.65, metalness: 0, tileM: 1.6, normalScale: 0.7 }, T('wood_plank_wall'), 'natural clear cedar tongue-and-groove siding', 1.5),
  siding('cedar-weathered', 'Weathered Cedar', 'cedar', 'premium', { texture: 'weathered_plank_siding', roughness: 0.75, metalness: 0, tileM: 1.6, normalScale: 0.8 }, T('weathered_plank_siding'), 'silver weathered cedar siding', 1.4),
  siding('cladding-01', 'Composite Cladding', 'composite', 'premium', { texture: 'exterior_wall_cladding', roughness: 0.5, metalness: 0, tileM: 1.6, normalScale: 0.6 }, T('exterior_wall_cladding'), 'modern composite panel cladding', 1.3),
  siding('cladding-02', 'Composite Cladding · Dark', 'composite', 'premium', { texture: 'exterior_wall_cladding_02', roughness: 0.5, metalness: 0, tileM: 1.6, normalScale: 0.6 }, T('exterior_wall_cladding_02'), 'dark modern composite cladding', 1.3),
  siding('cladding-03', 'Composite Cladding · Warm', 'composite', 'premium', { texture: 'exterior_wall_cladding_03', roughness: 0.5, metalness: 0, tileM: 1.6, normalScale: 0.6 }, T('exterior_wall_cladding_03'), 'warm-toned composite cladding', 1.3),
  siding('metal-standing', 'Standing-Seam Metal · Black', 'metal', 'premium', { texture: 'box_profile_metal_sheet', color: '#2B2D2F', useDiffuse: false, roughness: 0.45, metalness: 0.6, tileM: 1.2, normalScale: 0.8, rotate90: true }, '#2B2D2F', 'black standing seam metal siding', 1.4),
  siding('corrugated', 'Corrugated Metal', 'metal', 'standard', { texture: 'corrugated_iron_02', roughness: 0.4, metalness: 0.8, tileM: 1.2, normalScale: 0.8, rotate90: true }, T('corrugated_iron_02'), 'galvanized corrugated metal siding', 1.1),
  siding('brick-red', 'Red Brick', 'brick', 'premium', { texture: 'red_brick_03', roughness: 0.85, metalness: 0, tileM: 1.5, normalScale: 0.8 }, T('red_brick_03'), 'red brick veneer', 1.0),
  siding('brick-classic', 'Classic Brick', 'brick', 'premium', { texture: 'brick_wall_001', roughness: 0.85, metalness: 0, tileM: 1.5, normalScale: 0.8 }, T('brick_wall_001'), 'classic brick veneer', 1.0),
  siding('brick-tan', 'Tan Brick', 'brick', 'premium', { texture: 'brick_wall_04', roughness: 0.85, metalness: 0, tileM: 1.5, normalScale: 0.8 }, T('brick_wall_04'), 'tan brick veneer', 1.0),
  siding('brick-dark', 'Dark Brick', 'brick', 'premium', { texture: 'dark_brick_wall', roughness: 0.85, metalness: 0, tileM: 1.5, normalScale: 0.8 }, T('dark_brick_wall'), 'dark charcoal brick veneer', 1.05),
  siding('brick-painted', 'Painted Brick · White', 'brick', 'premium', { texture: 'painted_brick', roughness: 0.85, metalness: 0, tileM: 1.5, normalScale: 0.8 }, T('painted_brick'), 'white painted brick', 1.0),
  siding('stone-veneer', 'Stacked Stone Veneer', 'stone-veneer', 'luxury', { texture: 'plaster_stone_wall_01', roughness: 0.8, metalness: 0, tileM: 1.5, normalScale: 1.0 }, T('plaster_stone_wall_01'), 'stacked natural stone veneer', 1.25),
  siding('stone-mixed', 'Ledgestone', 'stone-veneer', 'luxury', { texture: 'mixed_stone_tiles', roughness: 0.8, metalness: 0, tileM: 1.4, normalScale: 1.0 }, T('mixed_stone_tiles'), 'ledgestone veneer', 1.25),
  siding('sandstone', 'Sandstone Block', 'stone-veneer', 'luxury', { texture: 'sandstone_blocks_04', roughness: 0.8, metalness: 0, tileM: 1.8, normalScale: 0.9 }, T('sandstone_blocks_04'), 'sandstone block veneer', 1.35),
  siding('slate-wall', 'Slate Cladding', 'slate', 'luxury', { texture: 'castle_wall_slates', roughness: 0.8, metalness: 0, tileM: 1.4, normalScale: 1.0 }, T('castle_wall_slates'), 'stacked slate cladding', 1.3),
  siding('stucco-white', 'Smooth Stucco · White', 'stucco', 'standard', { texture: 'white_stucco', roughness: 0.9, metalness: 0, tileM: 2.0, normalScale: 0.6 }, T('white_stucco'), 'smooth white stucco', 1.2),
  siding('stucco-warm', 'Stucco · Warm Sand', 'stucco', 'standard', { texture: 'white_stucco', color: '#D8CDB8', roughness: 0.9, metalness: 0, tileM: 2.0, normalScale: 0.6 }, '#D8CDB8', 'warm sand stucco', 1.2),
  siding('vinyl-white', 'Vinyl Lap · White', 'vinyl', 'budget', { texture: 'white_planks_clean', roughness: 0.5, metalness: 0, tileM: 1.6, normalScale: 0.3 }, '#F1F1EE', 'white vinyl lap siding', 0.6),
  siding('vinyl-grey', 'Vinyl Lap · Grey', 'vinyl', 'budget', { texture: 'white_planks_clean', color: '#B9BCBB', roughness: 0.5, metalness: 0, tileM: 1.6, normalScale: 0.3 }, '#B9BCBB', 'grey vinyl lap siding', 0.6),

  // --- roofing
  roof('asphalt-charcoal', 'Architectural Shingle · Charcoal', 'asphalt-shingle', 'standard', { texture: 'grey_roof_01', color: '#4A4A4A', roughness: 0.9, metalness: 0, tileM: 1.6, normalScale: 0.8 }, T('grey_roof_01'), 'charcoal architectural asphalt shingle roof'),
  roof('asphalt-weathered', 'Architectural Shingle · Weathered Wood', 'asphalt-shingle', 'standard', { texture: 'grey_roof_01', color: '#7A6E62', roughness: 0.9, metalness: 0, tileM: 1.6, normalScale: 0.8 }, '#7A6E62', 'weathered wood architectural asphalt shingle roof'),
  roof('asphalt-black', 'Architectural Shingle · Black', 'asphalt-shingle', 'standard', { texture: 'roof_09', color: '#2A2A2A', roughness: 0.9, metalness: 0, tileM: 1.6, normalScale: 0.8 }, '#2A2A2A', 'black asphalt shingle roof'),
  roof('metal-black', 'Standing Seam Metal · Black', 'metal-roof', 'premium', { texture: 'box_profile_metal_sheet', color: '#26282A', useDiffuse: false, roughness: 0.4, metalness: 0.7, tileM: 1.4, normalScale: 0.8 }, '#26282A', 'black standing seam metal roof', 1.0),
  roof('metal-charcoal', 'Standing Seam Metal · Charcoal', 'metal-roof', 'premium', { texture: 'box_profile_metal_sheet', color: '#4E5256', useDiffuse: false, roughness: 0.4, metalness: 0.7, tileM: 1.4, normalScale: 0.8 }, '#4E5256', 'charcoal standing seam metal roof', 1.0),
  roof('metal-galv', 'Standing Seam Metal · Galvalume', 'metal-roof', 'premium', { texture: 'box_profile_metal_sheet', roughness: 0.35, metalness: 0.9, tileM: 1.4, normalScale: 0.8 }, T('box_profile_metal_sheet'), 'galvalume standing seam metal roof', 1.0),
  roof('metal-green', 'Standing Seam Metal · Forest Green', 'metal-roof', 'premium', { texture: 'box_profile_metal_sheet', color: '#2F4A3C', useDiffuse: false, roughness: 0.4, metalness: 0.7, tileM: 1.4, normalScale: 0.8 }, '#2F4A3C', 'forest green standing seam metal roof', 1.0),
  roof('clay-tile', 'Clay Barrel Tile', 'clay-tile', 'luxury', { texture: 'clay_roof_tiles', roughness: 0.8, metalness: 0, tileM: 1.4, normalScale: 0.9 }, T('clay_roof_tiles'), 'terracotta clay barrel tile roof', 0.7),
  roof('concrete-tile', 'Concrete Tile · Grey', 'clay-tile', 'premium', { texture: 'grey_roof_tiles', roughness: 0.85, metalness: 0, tileM: 1.4, normalScale: 0.9 }, T('grey_roof_tiles'), 'grey concrete tile roof', 0.85),
  roof('slate', 'Natural Slate', 'slate', 'luxury', { texture: 'roof_slates_02', roughness: 0.75, metalness: 0, tileM: 1.4, normalScale: 0.8 }, T('roof_slates_02'), 'natural grey slate roof', 0.85),
  roof('slate-red', 'Red Slate', 'slate', 'luxury', { texture: 'red_slate_roof_tiles_01', roughness: 0.75, metalness: 0, tileM: 1.4, normalScale: 0.8 }, T('red_slate_roof_tiles_01'), 'red slate roof', 0.85),
  roof('cedar-shake', 'Cedar Shake', 'cedar', 'luxury', { texture: 'roof_07', roughness: 0.85, metalness: 0, tileM: 1.4, normalScale: 0.9 }, T('roof_07'), 'cedar shake roof', 0.55),
  roof('roof-3', 'Flat Tile · Brown', 'clay-tile', 'premium', { texture: 'roof_3', roughness: 0.85, metalness: 0, tileM: 1.4, normalScale: 0.9 }, T('roof_3'), 'brown flat tile roof', 0.9),
  roof('roof-tiles', 'Roman Tile', 'clay-tile', 'luxury', { texture: 'roof_tiles', roughness: 0.8, metalness: 0, tileM: 1.4, normalScale: 0.9 }, T('roof_tiles'), 'roman clay tile roof', 0.7),
  roof('ceramic-roof', 'Glazed Ceramic Tile', 'clay-tile', 'luxury', { texture: 'ceramic_roof_01', roughness: 0.5, metalness: 0, tileM: 1.4, normalScale: 0.9 }, T('ceramic_roof_01'), 'glazed ceramic tile roof', 0.8),

  // --- hardscape / ground
  hardscape('concrete-broom', 'Broom-Finish Concrete', 'concrete', 'budget', { texture: 'concrete_pavement', roughness: 0.9, metalness: 0, tileM: 2.5, normalScale: 0.4 }, T('concrete_pavement'), 'broom-finished concrete'),
  hardscape('concrete-smooth', 'Smooth Concrete', 'concrete', 'standard', { texture: 'smooth_concrete_floor', roughness: 0.7, metalness: 0, tileM: 2.5, normalScale: 0.3 }, T('smooth_concrete_floor'), 'smooth-troweled concrete', 1.1),
  hardscape('pavers', 'Concrete Pavers', 'pavers', 'standard', { texture: 'concrete_pavers', roughness: 0.85, metalness: 0, tileM: 1.6, normalScale: 0.7 }, T('concrete_pavers'), 'grey concrete pavers', 1.0),
  hardscape('pavers-interlock', 'Interlocking Pavers', 'pavers', 'standard', { texture: 'interlocking_concrete_pavers', roughness: 0.85, metalness: 0, tileM: 1.6, normalScale: 0.7 }, T('interlocking_concrete_pavers'), 'interlocking concrete pavers', 1.0),
  hardscape('pavers-pattern', 'Patterned Pavers', 'pavers', 'premium', { texture: 'patterned_concrete_pavers', roughness: 0.85, metalness: 0, tileM: 1.6, normalScale: 0.7 }, T('patterned_concrete_pavers'), 'patterned concrete pavers', 1.1),
  hardscape('stone-pavers', 'Natural Stone Pavers', 'stone', 'premium', { texture: 'stone_pavers', roughness: 0.85, metalness: 0, tileM: 1.8, normalScale: 0.8 }, T('stone_pavers'), 'natural stone pavers', 1.2),
  hardscape('gravel', 'Crushed Gravel', 'gravel', 'budget', { texture: 'gravel_floor_02', roughness: 0.95, metalness: 0, tileM: 1.6, normalScale: 0.9 }, T('gravel_floor_02'), 'crushed grey gravel', 0.4),
  hardscape('slate-drive', 'Slate Flagstone', 'slate', 'premium', { texture: 'slate_driveway', roughness: 0.8, metalness: 0, tileM: 1.8, normalScale: 0.8 }, T('slate_driveway'), 'slate flagstone', 1.15),
  hardscape('asphalt', 'Asphalt', 'other', 'budget', { texture: 'asphalt_01', roughness: 0.95, metalness: 0, tileM: 3.0, normalScale: 0.5 }, T('asphalt_01'), 'asphalt driveway', 0.6),
  { id: 'lawn-lush', name: 'Lush Lawn', category: 'grass', group: 'lawn', tier: 'standard', slots: ['lawn'], pbr: { texture: 'leafy_grass', roughness: 0.95, metalness: 0, tileM: 3.0, normalScale: 0.6 }, swatch: T('leafy_grass'), prompt: 'lush green manicured lawn', tags: ['landscape'] },
  { id: 'lawn-sparse', name: 'Native Lawn', category: 'grass', group: 'lawn', tier: 'budget', priceAdj: 0.7, slots: ['lawn'], pbr: { texture: 'sparse_grass', roughness: 0.95, metalness: 0, tileM: 3.0, normalScale: 0.6 }, swatch: T('sparse_grass'), prompt: 'natural sparse lawn', tags: ['landscape'] },
  { id: 'lawn-turf', name: 'Artificial Turf', category: 'grass', group: 'lawn', tier: 'premium', priceAdj: 6.0, slots: ['lawn'], pbr: { texture: 'grass_path_2', color: '#4F8F3A', roughness: 0.9, metalness: 0, tileM: 2.0, normalScale: 0.3 }, swatch: '#4F8F3A', prompt: 'artificial turf lawn', tags: ['landscape'] },
  { id: 'deck-cedar', name: 'Cedar Deck', category: 'cedar', group: 'deck', tier: 'standard', slots: ['deck'], pbr: { texture: 'wood_floor_deck', roughness: 0.7, metalness: 0, tileM: 2.0, normalScale: 0.6 }, swatch: T('wood_floor_deck'), prompt: 'cedar wood deck', tags: ['deck'] },
  { id: 'deck-composite', name: 'Composite Deck · Grey', category: 'composite', group: 'deck', tier: 'premium', priceAdj: 1.0, slots: ['deck'], pbr: { texture: 'wood_floor_deck', color: '#8A8580', roughness: 0.6, metalness: 0, tileM: 2.0, normalScale: 0.4 }, swatch: '#8A8580', prompt: 'grey composite decking', tags: ['deck'] },
  { id: 'deck-composite-brown', name: 'Composite Deck · Brown', category: 'composite', group: 'deck', tier: 'premium', priceAdj: 1.0, slots: ['deck'], pbr: { texture: 'wood_floor_deck', color: '#7C5A44', roughness: 0.6, metalness: 0, tileM: 2.0, normalScale: 0.4 }, swatch: '#7C5A44', prompt: 'brown composite decking', tags: ['deck'] },
  { id: 'fence-cedar', name: 'Cedar Privacy Fence', category: 'cedar', group: 'fence', tier: 'standard', slots: ['fence'], pbr: { texture: 'wood_plank_wall', roughness: 0.75, metalness: 0, tileM: 1.6, normalScale: 0.7, rotate90: true }, swatch: T('wood_plank_wall'), prompt: 'cedar privacy fence', tags: ['fence'] },
  { id: 'fence-black-metal', name: 'Black Aluminum Fence', category: 'metal', group: 'fence', tier: 'premium', priceAdj: 1.5, slots: ['fence'], pbr: { color: '#202224', roughness: 0.5, metalness: 0.8 }, swatch: '#202224', prompt: 'black aluminum picket fence', tags: ['fence'] },
  { id: 'fence-horizontal', name: 'Horizontal Slat Fence', category: 'cedar', group: 'fence', tier: 'premium', priceAdj: 1.4, slots: ['fence'], pbr: { texture: 'weathered_plank_siding', roughness: 0.75, metalness: 0, tileM: 1.6, normalScale: 0.7 }, swatch: T('weathered_plank_siding'), prompt: 'modern horizontal cedar slat fence', tags: ['fence'] },

  // --- doors / windows / garage / columns / gutters
  { id: 'door-black', name: 'Black Entry Door', category: 'paint', group: 'entry-door', tier: 'standard', slots: ['front_door'], pbr: { color: '#1F2022', roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.2 }, swatch: '#1F2022', prompt: 'matte black modern entry door', tags: ['door'] },
  { id: 'door-wood', name: 'Walnut Entry Door', category: 'wood', group: 'entry-door', tier: 'premium', priceAdj: 1.8, slots: ['front_door'], pbr: { texture: 'american_walnut_veneer', roughness: 0.45, metalness: 0, tileM: 1.0, normalScale: 0.4, clearcoat: 0.2, clearcoatRoughness: 0.3 }, swatch: T('american_walnut_veneer'), prompt: 'warm walnut wood entry door with vertical grain', tags: ['door'] },
  { id: 'door-oak', name: 'White Oak Entry Door', category: 'wood', group: 'entry-door', tier: 'premium', priceAdj: 1.8, slots: ['front_door'], pbr: { texture: 'white_oak_veneer', roughness: 0.45, metalness: 0, tileM: 1.0, normalScale: 0.4, clearcoat: 0.2, clearcoatRoughness: 0.3 }, swatch: T('white_oak_veneer'), prompt: 'white oak entry door', tags: ['door'] },
  { id: 'door-red', name: 'Red Entry Door', category: 'paint', group: 'entry-door', tier: 'standard', slots: ['front_door'], pbr: { color: '#8E2C2C', roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.2 }, swatch: '#8E2C2C', prompt: 'deep red painted entry door', tags: ['door'] },
  { id: 'door-navy', name: 'Navy Entry Door', category: 'paint', group: 'entry-door', tier: 'standard', slots: ['front_door'], pbr: { color: '#2F3B4E', roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.2 }, swatch: '#2F3B4E', prompt: 'navy painted entry door', tags: ['door'] },
  { id: 'door-sage', name: 'Sage Entry Door', category: 'paint', group: 'entry-door', tier: 'standard', slots: ['front_door'], pbr: { color: '#7E8C79', roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.2 }, swatch: '#7E8C79', prompt: 'sage green painted entry door', tags: ['door'] },
  { id: 'door-glass-steel', name: 'Steel & Glass Pivot Door', category: 'metal', group: 'entry-door', tier: 'luxury', priceAdj: 4.0, slots: ['front_door'], pbr: { color: '#2A2C2E', roughness: 0.4, metalness: 0.8 }, swatch: '#2A2C2E', prompt: 'black steel and glass pivot entry door', tags: ['door'] },
  { id: 'garage-white', name: 'White Carriage Garage Door', category: 'paint', group: 'garage-door', tier: 'standard', slots: ['garage_door'], pbr: { color: '#F1F0EB', roughness: 0.5, metalness: 0 }, swatch: '#F1F0EB', prompt: 'white carriage-style garage door', tags: ['garage'] },
  { id: 'garage-black', name: 'Black Modern Garage Door', category: 'paint', group: 'garage-door', tier: 'standard', slots: ['garage_door'], pbr: { color: '#232527', roughness: 0.45, metalness: 0.1 }, swatch: '#232527', prompt: 'matte black flush modern garage door', tags: ['garage'] },
  { id: 'garage-wood', name: 'Cedar Garage Door', category: 'cedar', group: 'garage-door', tier: 'premium', priceAdj: 2.2, slots: ['garage_door'], pbr: { texture: 'wood_plank_wall', roughness: 0.6, metalness: 0, tileM: 1.6, normalScale: 0.6 }, swatch: T('wood_plank_wall'), prompt: 'natural cedar plank garage door', tags: ['garage'] },
  { id: 'garage-glass', name: 'Aluminum & Glass Garage Door', category: 'glass', group: 'garage-door', tier: 'luxury', priceAdj: 3.5, slots: ['garage_door'], pbr: { color: '#9EA4A8', roughness: 0.2, metalness: 0.8, transmission: 0.3 }, swatch: '#9EA4A8', prompt: 'modern aluminum and frosted glass garage door', tags: ['garage'] },
  { id: 'win-black', name: 'Black Window Frames', category: 'paint', group: 'window', tier: 'premium', slots: ['window_frames'], pbr: { color: '#1F2022', roughness: 0.4, metalness: 0.2 }, swatch: '#1F2022', prompt: 'black window frames', tags: ['window'] },
  { id: 'win-white', name: 'White Window Frames', category: 'vinyl', group: 'window', tier: 'standard', slots: ['window_frames'], pbr: { color: '#F2F2EF', roughness: 0.4, metalness: 0 }, swatch: '#F2F2EF', prompt: 'white window frames', tags: ['window'] },
  { id: 'win-bronze', name: 'Bronze Window Frames', category: 'metal', group: 'window', tier: 'premium', priceAdj: 1.15, slots: ['window_frames'], pbr: { color: '#4A3B2E', roughness: 0.4, metalness: 0.4 }, swatch: '#4A3B2E', prompt: 'dark bronze window frames', tags: ['window'] },
  { id: 'win-wood', name: 'Wood Window Frames', category: 'wood', group: 'window', tier: 'luxury', priceAdj: 1.5, slots: ['window_frames'], pbr: { texture: 'oak_veneer_01', roughness: 0.5, metalness: 0, tileM: 0.8, normalScale: 0.3 }, swatch: T('oak_veneer_01'), prompt: 'natural wood window frames', tags: ['window'] },
  { id: 'col-white', name: 'White Columns', category: 'paint', group: 'column', tier: 'standard', slots: ['porch_columns'], pbr: { color: '#F2F1EC', roughness: 0.5, metalness: 0 }, swatch: '#F2F1EC', prompt: 'white porch columns', tags: ['porch'] },
  { id: 'col-cedar', name: 'Cedar Timber Columns', category: 'cedar', group: 'column', tier: 'premium', priceAdj: 1.8, slots: ['porch_columns'], pbr: { texture: 'wood_plank_wall', roughness: 0.65, metalness: 0, tileM: 1.0, normalScale: 0.5 }, swatch: T('wood_plank_wall'), prompt: 'heavy cedar timber porch columns', tags: ['porch'] },
  { id: 'col-stone', name: 'Stone-Base Columns', category: 'stone-veneer', group: 'column', tier: 'luxury', priceAdj: 3.0, slots: ['porch_columns'], pbr: { texture: 'mixed_stone_tiles', roughness: 0.8, metalness: 0, tileM: 1.2, normalScale: 0.9 }, swatch: T('mixed_stone_tiles'), prompt: 'craftsman tapered columns on stone bases', tags: ['porch'] },
  { id: 'gutter-white', name: 'White Aluminum Gutters', category: 'metal', group: 'gutter', tier: 'standard', slots: ['gutters'], pbr: { color: '#EFEFEC', roughness: 0.4, metalness: 0.3 }, swatch: '#EFEFEC', prompt: 'white aluminum gutters', tags: ['gutter'] },
  { id: 'gutter-black', name: 'Black Aluminum Gutters', category: 'metal', group: 'gutter', tier: 'standard', slots: ['gutters'], pbr: { color: '#202224', roughness: 0.4, metalness: 0.3 }, swatch: '#202224', prompt: 'black aluminum gutters', tags: ['gutter'] },
  { id: 'gutter-copper', name: 'Copper Gutters', category: 'metal', group: 'gutter', tier: 'luxury', priceAdj: 4.0, slots: ['gutters'], pbr: { color: '#B87333', roughness: 0.35, metalness: 1.0 }, swatch: '#B87333', prompt: 'copper gutters', tags: ['gutter'] },
  { id: 'rail-black', name: 'Black Metal Railing', category: 'metal', group: 'railing', tier: 'standard', slots: ['railing'], pbr: { color: '#202224', roughness: 0.5, metalness: 0.8 }, swatch: '#202224', prompt: 'black metal railing', tags: ['railing'] },
  { id: 'rail-cable', name: 'Cable Railing', category: 'metal', group: 'railing', tier: 'premium', priceAdj: 1.8, slots: ['railing'], pbr: { color: '#B9BCBF', roughness: 0.3, metalness: 1.0 }, swatch: '#B9BCBF', prompt: 'stainless cable railing', tags: ['railing'] },
  { id: 'rail-wood', name: 'Cedar Railing', category: 'cedar', group: 'railing', tier: 'standard', slots: ['railing'], pbr: { texture: 'wood_plank_wall', roughness: 0.7, metalness: 0, tileM: 1.0, normalScale: 0.5 }, swatch: T('wood_plank_wall'), prompt: 'cedar wood railing', tags: ['railing'] },

  // --- hardware / fixture finishes
  finish('brushed-nickel', 'Brushed Nickel', '#C8C9C7', 0.35, 'brushed nickel'),
  finish('polished-chrome', 'Polished Chrome', '#DADCDF', 0.08, 'polished chrome'),
  finish('matte-black', 'Matte Black', '#232426', 0.6, 'matte black', 'standard', 1.1),
  finish('brushed-brass', 'Brushed Brass', '#C9A45C', 0.32, 'brushed brass / champagne bronze', 'premium', 1.5),
  finish('unlacquered-brass', 'Unlacquered Brass', '#D2A94F', 0.25, 'unlacquered brass', 'luxury', 2.2),
  // Two real SKUs the palette was missing, both found by measuring photos
  // against it: every brass entry was a bright champagne (#C9A45C and up) and
  // every bronze a near-black (#3E2F25), so the warm mid-tone brass that four
  // client photographs actually show landed 8–11 ΔE away, and a mid-brown
  // bronze 12 ΔE away. Priced exactly like the neighbour they sit beside, so
  // adding them moves a colour and never a number.
  finish('antique-brass', 'Antique Brass', '#B58F55', 0.34, 'antique / aged brass, warm and slightly darkened', 'premium', 1.5),
  finish('satin-bronze', 'Satin Bronze', '#5A493A', 0.42, 'satin bronze, warm mid-brown', 'standard', 1.2),
  finish('oil-bronze', 'Oil-Rubbed Bronze', '#3E2F25', 0.45, 'oil-rubbed bronze', 'standard', 1.2),
  finish('brushed-gold', 'Brushed Gold', '#D4B26A', 0.3, 'brushed gold', 'premium', 1.6),
  finish('polished-nickel', 'Polished Nickel', '#D6D5D0', 0.1, 'polished nickel', 'premium', 1.5),
  finish('gunmetal', 'Gunmetal', '#5A5D61', 0.35, 'gunmetal', 'premium', 1.3),
  finish('copper', 'Copper', '#B87333', 0.3, 'copper', 'luxury', 2.0),

  // --- appliance finishes
  { id: 'app-stainless', name: 'Stainless Steel', category: 'finish', group: 'appliance-finish', tier: 'standard', slots: ['appliances'], pbr: { color: '#C7C9CB', roughness: 0.3, metalness: 1.0, envMapIntensity: 1.1 }, swatch: '#C7C9CB', prompt: 'stainless steel appliances', tags: ['appliance'] },
  { id: 'app-black-stainless', name: 'Black Stainless', category: 'finish', group: 'appliance-finish', tier: 'premium', priceAdj: 1.15, slots: ['appliances'], pbr: { color: '#3A3C3F', roughness: 0.3, metalness: 0.9, envMapIntensity: 1.0 }, swatch: '#3A3C3F', prompt: 'black stainless steel appliances', tags: ['appliance'] },
  { id: 'app-matte-black', name: 'Matte Black', category: 'finish', group: 'appliance-finish', tier: 'premium', priceAdj: 1.2, slots: ['appliances'], pbr: { color: '#1F2022', roughness: 0.65, metalness: 0.4 }, swatch: '#1F2022', prompt: 'matte black appliances', tags: ['appliance'] },
  { id: 'app-panel-ready', name: 'Panel-Ready (matches cabinets)', category: 'finish', group: 'appliance-finish', tier: 'luxury', priceAdj: 2.4, slots: ['appliances'], pbr: { color: '#E9E7E1', roughness: 0.4, metalness: 0 }, swatch: '#E9E7E1', prompt: 'panel-ready integrated appliances matching the cabinetry', tags: ['appliance'] },
  { id: 'app-white', name: 'White', category: 'finish', group: 'appliance-finish', tier: 'budget', priceAdj: 0.8, slots: ['appliances'], pbr: { color: '#F3F3F0', roughness: 0.35, metalness: 0.05 }, swatch: '#F3F3F0', prompt: 'white appliances', tags: ['appliance'] },
  { id: 'app-pro-range', name: 'Pro Stainless (48" range)', category: 'finish', group: 'appliance-finish', tier: 'luxury', priceAdj: 3.0, slots: ['appliances'], pbr: { color: '#CDCFD1', roughness: 0.25, metalness: 1.0, envMapIntensity: 1.2 }, swatch: '#CDCFD1', prompt: 'professional-grade stainless appliances with a 48-inch pro range', tags: ['appliance'] },

  // --- tubs / mirrors / lighting fixtures
  { id: 'tub-acrylic-white', name: 'Acrylic Alcove Tub', category: 'acrylic', group: 'tub', tier: 'standard', slots: ['tub'], pbr: { color: '#F6F6F3', roughness: 0.15, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.1 }, swatch: '#F6F6F3', prompt: 'white acrylic alcove bathtub', tags: ['tub'] },
  { id: 'tub-freestanding', name: 'Freestanding Soaking Tub', category: 'acrylic', group: 'tub', tier: 'premium', priceAdj: 1.3, slots: ['tub'], pbr: { color: '#F7F7F4', roughness: 0.12, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.08 }, swatch: '#F7F7F4', prompt: 'white freestanding oval soaking tub', tags: ['tub'] },
  { id: 'tub-cast-iron', name: 'Cast Iron Clawfoot', category: 'cast-iron', group: 'tub', tier: 'luxury', priceAdj: 1.2, slots: ['tub'], pbr: { color: '#F5F5F2', roughness: 0.1, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.05 }, swatch: '#F5F5F2', prompt: 'cast iron clawfoot tub', tags: ['tub'] },
  { id: 'tub-black', name: 'Matte Black Freestanding', category: 'acrylic', group: 'tub', tier: 'luxury', priceAdj: 1.1, slots: ['tub'], pbr: { color: '#202224', roughness: 0.5, metalness: 0 }, swatch: '#202224', prompt: 'matte black freestanding tub', tags: ['tub'] },
  { id: 'mirror-frameless', name: 'Frameless Mirror', category: 'glass', group: 'mirror', tier: 'standard', slots: ['mirror'], pbr: { color: '#dfe7ec', roughness: 0.09, metalness: 0.5, envMapIntensity: 3.2 }, swatch: '#DDE2E6', prompt: 'frameless rectangular mirror', tags: ['mirror'] },
  { id: 'mirror-black-frame', name: 'Black Framed Mirror', category: 'glass', group: 'mirror', tier: 'standard', priceAdj: 1.3, slots: ['mirror'], pbr: { color: '#dfe7ec', roughness: 0.09, metalness: 0.5, envMapIntensity: 3.2 }, swatch: '#26282A', prompt: 'black metal framed mirror', tags: ['mirror'] },
  { id: 'mirror-led', name: 'Backlit LED Mirror', category: 'glass', group: 'mirror', tier: 'premium', priceAdj: 2.5, slots: ['mirror'], pbr: { color: '#dfe7ec', roughness: 0.09, metalness: 0.5, envMapIntensity: 3.2, emissive: '#FFF6E8' }, swatch: '#F6F0E4', prompt: 'backlit LED mirror', tags: ['mirror'] },
  { id: 'mirror-arched', name: 'Arched Brass Mirror', category: 'glass', group: 'mirror', tier: 'premium', priceAdj: 2.0, slots: ['mirror'], pbr: { color: '#dfe7ec', roughness: 0.09, metalness: 0.5, envMapIntensity: 3.2 }, swatch: '#C9A45C', prompt: 'arched brass-framed mirror', tags: ['mirror'] },
  { id: 'light-pendant-glass', name: 'Clear Glass Pendants', category: 'glass', group: 'lighting', tier: 'standard', slots: ['lighting_fixture'], pbr: { color: '#FFFFFF', roughness: 0.18, metalness: 0, transmission: 0.9, ior: 1.5, envMapIntensity: 1.3 }, swatch: '#E8EEF2', prompt: 'clear seeded glass globe pendant lights', tags: ['lighting'] },
  { id: 'light-pendant-black', name: 'Black Dome Pendants', category: 'metal', group: 'lighting', tier: 'standard', slots: ['lighting_fixture'], pbr: { color: '#1F2022', roughness: 0.4, metalness: 0.6 }, swatch: '#1F2022', prompt: 'matte black dome pendant lights', tags: ['lighting'] },
  { id: 'light-pendant-brass', name: 'Brass Lantern Pendants', category: 'metal', group: 'lighting', tier: 'premium', priceAdj: 1.8, slots: ['lighting_fixture'], pbr: { color: '#C9A45C', roughness: 0.3, metalness: 1.0 }, swatch: '#C9A45C', prompt: 'brass lantern pendant lights', tags: ['lighting'] },
  { id: 'light-linear', name: 'Linear LED Pendant', category: 'metal', group: 'lighting', tier: 'premium', priceAdj: 1.6, slots: ['lighting_fixture'], pbr: { color: '#2A2C2E', roughness: 0.35, metalness: 0.7, emissive: '#FFF3DC' }, swatch: '#2A2C2E', prompt: 'long linear LED pendant light', tags: ['lighting'] },
  { id: 'light-rattan', name: 'Woven Rattan Pendants', category: 'other', group: 'lighting', tier: 'standard', priceAdj: 1.2, slots: ['lighting_fixture'], pbr: { color: '#C8A574', roughness: 0.8, metalness: 0 }, swatch: '#C8A574', prompt: 'woven rattan pendant lights', tags: ['lighting'] },
  { id: 'light-sconce-brass', name: 'Brass Sconces', category: 'metal', group: 'lighting', tier: 'premium', priceAdj: 1.5, slots: ['lighting_fixture'], pbr: { color: '#C9A45C', roughness: 0.3, metalness: 1.0 }, swatch: '#C9A45C', prompt: 'brass wall sconces', tags: ['lighting'] },
];


// ---------------------------------------------------------------------------
// Procedural surface overrides
//
// The CC0 photo library has no white Calacatta slab, no clean subway tile and
// no large-format porcelain at a scale we control — and a photo of the wrong
// stone reads as wrong immediately. These entries redraw the hero surfaces at
// their real module sizes (a 3×6" subway tile really is 152 × 76 mm here) so
// the twin matches the material the client is actually buying.
// ---------------------------------------------------------------------------
const PROCEDURAL_OVERRIDES: Record<string, PBRRecipe> = {
  'ct-calacatta-quartz': { procedural: { kind: 'slab', options: { base: '#F8F6F0', vein: '#9A8154', intensity: 0.95, veinCount: 6, seed: 21, spanM: 2.4, vein2: '#C6B48E' }, reliefStrength: 0.4 }, roughness: 0.11, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.06, envMapIntensity: 1.15 },
  'ct-carrara-marble': { procedural: { kind: 'slab', options: { base: '#F0F0EB', vein: '#5F666E', intensity: 0.95, veinCount: 7, seed: 22, spanM: 2.4, vein2: '#A6ABB1' }, reliefStrength: 0.4 }, roughness: 0.13, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.08 },
  'ct-white-quartz': { procedural: { kind: 'slab', options: { base: '#F4F3EE', vein: '#DFDDD5', intensity: 0.12, veinCount: 3, seed: 23, spanM: 2.4 }, reliefStrength: 0.4 }, roughness: 0.16, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.1 },
  'ct-grey-quartz': { procedural: { kind: 'slab', options: { base: '#B4B2AC', vein: '#9A988F', intensity: 0.25, veinCount: 4, seed: 24, spanM: 2.4, speckle: 0.3, speckleColor: '#8D8B84' }, reliefStrength: 0.4 }, roughness: 0.35, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.3 },
  'ct-black-quartz': { procedural: { kind: 'slab', options: { base: '#232326', vein: '#3A3A3E', intensity: 0.2, veinCount: 3, seed: 25, spanM: 2.4, speckle: 0.25, speckleColor: '#55555A' }, reliefStrength: 0.2 }, roughness: 0.22, metalness: 0.02, clearcoat: 0.3, clearcoatRoughness: 0.12 },
  'ct-speckled-granite': { procedural: { kind: 'slab', options: { base: '#8A8880', vein: '#4A4844', intensity: 0.12, veinCount: 2, seed: 26, spanM: 1.2, speckle: 1.0, speckleColor: '#332F2B', speckleRadiusM: 0.0022, speckleColor2: '#B4AFA6', speckleColor3: '#6E6A63' }, reliefStrength: 0.4 }, roughness: 0.2, metalness: 0.02, clearcoat: 0.42, clearcoatRoughness: 0.09 },
  'ct-black-granite': { procedural: { kind: 'slab', options: { base: '#2A2A2C', vein: '#6E6E72', intensity: 0.1, veinCount: 2, seed: 27, spanM: 1.2, speckle: 1.0, speckleColor: '#8E8E96', speckleRadiusM: 0.0022, speckleColor2: '#4A4A50', speckleColor3: '#C9C9D0' }, reliefStrength: 0.2 }, roughness: 0.24, metalness: 0.03, clearcoat: 0.3, clearcoatRoughness: 0.12 },
  'ct-brown-granite': { procedural: { kind: 'slab', options: { base: '#6B5443', vein: '#3A2C22', intensity: 0.12, veinCount: 2, seed: 28, spanM: 1.2, speckle: 1.0, speckleColor: '#9C7854', speckleRadiusM: 0.0022, speckleColor2: '#4A382A', speckleColor3: '#C4A882' }, reliefStrength: 0.4 }, roughness: 0.2, metalness: 0.02, clearcoat: 0.42, clearcoatRoughness: 0.09 },
  'ct-grey-granite': { procedural: { kind: 'slab', options: { base: '#6E6F71', vein: '#3C3D3F', intensity: 0.1, veinCount: 2, seed: 29, spanM: 1.2, speckle: 1.0, speckleColor: '#2E2F31', speckleRadiusM: 0.0022, speckleColor2: '#A2A3A6', speckleColor3: '#545557' }, reliefStrength: 0.4 }, roughness: 0.2, metalness: 0.03, clearcoat: 0.44, clearcoatRoughness: 0.09 },
  'ct-taj-quartzite': { procedural: { kind: 'slab', options: { base: '#F1E9D9', vein: '#A5875A', intensity: 0.8, veinCount: 5, seed: 30, spanM: 2.4, vein2: '#D0BE9C' }, reliefStrength: 0.4 }, roughness: 0.14, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.07 },
  'ct-porcelain-slab': { procedural: { kind: 'slab', options: { base: '#F5F4F0', vein: '#87888B', intensity: 0.75, veinCount: 5, seed: 31, spanM: 3.0, vein2: '#B7B8BA' }, reliefStrength: 0.4 }, roughness: 0.15, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.09 },
  'ct-soapstone': { procedural: { kind: 'slab', options: { base: '#383C3E', vein: '#A8AEB2', intensity: 0.7, veinCount: 5, seed: 32, spanM: 2.4, vein2: '#5E6468' }, reliefStrength: 0.4 }, roughness: 0.45, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.4 },
  'ct-concrete': { procedural: { kind: 'slab', options: { base: '#93918B', vein: '#7C7A74', intensity: 0.15, veinCount: 2, seed: 33, spanM: 3.0, speckle: 0.35, speckleColor: '#7E7C77', speckleRadiusM: 0.004 }, reliefStrength: 0.4 }, roughness: 0.5, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.5 },
  'ct-terrazzo': { procedural: { kind: 'slab', options: { base: '#EDEAE2', vein: '#8A8378', intensity: 0.05, veinCount: 1, seed: 34, spanM: 1.0, speckle: 0.9, speckleColor: '#5E5A52', speckleRadiusM: 0.007, speckleColor2: '#B9A98E', speckleColor3: '#8FA39B' }, reliefStrength: 0.4 }, roughness: 0.24, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.12 },
  'tile-subway-white': { procedural: { kind: 'tile', options: { tileW: 0.152, tileH: 0.076, color: '#F3F2EE', grout: '#CFCAC0', pattern: 'running-bond', variation: 0.05, gloss: 0.9, groutM: 0.003, seed: 41 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.12, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.06 },
  'tile-subway-sage': { procedural: { kind: 'tile', options: { tileW: 0.152, tileH: 0.076, color: '#AFBCA8', grout: '#C9C6BC', pattern: 'running-bond', variation: 0.08, gloss: 0.9, groutM: 0.003, seed: 42 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.13, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.06 },
  'tile-subway-navy': { procedural: { kind: 'tile', options: { tileW: 0.152, tileH: 0.076, color: '#3A4759', grout: '#B9B6AC', pattern: 'running-bond', variation: 0.08, gloss: 0.9, groutM: 0.003, seed: 43 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.13, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.06 },
  'tile-subway-black': { procedural: { kind: 'tile', options: { tileW: 0.152, tileH: 0.076, color: '#26262A', grout: '#8E8B84', pattern: 'running-bond', variation: 0.07, gloss: 0.9, groutM: 0.003, seed: 44 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.13, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.06 },
  'tile-zellige-white': { procedural: { kind: 'tile', options: { tileW: 0.102, tileH: 0.102, color: '#F2EDE0', grout: '#DCD6C8', pattern: 'stacked', variation: 0.3, gloss: 1.0, groutM: 0.004, seed: 45, colorAlt: '#E6DECB' }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.1, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.05 },
  'tile-zellige-green': { procedural: { kind: 'tile', options: { tileW: 0.102, tileH: 0.102, color: '#3F6B57', grout: '#CFC9BA', pattern: 'stacked', variation: 0.35, gloss: 1.0, groutM: 0.004, seed: 46, colorAlt: '#2E5A46' }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.1, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.05 },
  'tile-square-white': { procedural: { kind: 'tile', options: { tileW: 0.102, tileH: 0.102, color: '#F2F2ED', grout: '#CBC7BD', pattern: 'stacked', variation: 0.05, gloss: 0.7, groutM: 0.003, seed: 47 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.16, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.08 },
  'tile-hex-white': { procedural: { kind: 'tile', options: { tileW: 0.051, tileH: 0.051, color: '#F1F1EC', grout: '#C6C2B8', pattern: 'hex', variation: 0.07, gloss: 0.35, groutM: 0.0025, seed: 48 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.22, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.12 },
  'tile-hex-black': { procedural: { kind: 'tile', options: { tileW: 0.051, tileH: 0.051, color: '#2C2C2F', grout: '#9B978F', pattern: 'hex', variation: 0.07, gloss: 0.2, groutM: 0.0025, seed: 49 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.34, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.25 },
  'tile-large-format-white': { procedural: { kind: 'tile', options: { tileW: 1.22, tileH: 0.61, color: '#F2F1EC', grout: '#DAD6CC', pattern: 'stacked', variation: 0.03, gloss: 0.4, groutM: 0.002, seed: 50 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.15, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.08 },
  'tile-square-tiles-02': { procedural: { kind: 'tile', options: { tileW: 0.152, tileH: 0.152, color: '#B9B7B1', grout: '#A5A199', pattern: 'stacked', variation: 0.08, gloss: 0.35, groutM: 0.003, seed: 51 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.3, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.2 },
  'tile-interior-tiles': { procedural: { kind: 'tile', options: { tileW: 0.152, tileH: 0.076, color: '#C9C7C1', grout: '#AFACA4', pattern: 'running-bond', variation: 0.07, gloss: 0.65, groutM: 0.003, seed: 52 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.18, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.1 },
  'tile-marble-slab': { procedural: { kind: 'slab', options: { base: '#F8F6F0', vein: '#967D50', intensity: 1.0, veinCount: 7, seed: 53, spanM: 2.8, vein2: '#C6B48E' }, reliefStrength: 0.4 }, roughness: 0.1, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.05 },
  'tile-quartz-slab': { procedural: { kind: 'slab', options: { base: '#F5F4EF', vein: '#CFC9BC', intensity: 0.35, veinCount: 4, seed: 54, spanM: 2.8 }, reliefStrength: 0.4 }, roughness: 0.13, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.07 },
  'tile-floor-large-grey': { procedural: { kind: 'tile', options: { tileW: 0.61, tileH: 0.61, color: '#A8A69F', grout: '#95928A', pattern: 'stacked', variation: 0.06, gloss: 0.25, groutM: 0.003, seed: 61 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.3, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.25 },
  'tile-floor-large-02': { procedural: { kind: 'tile', options: { tileW: 0.61, tileH: 0.61, color: '#CFC4B2', grout: '#B8AC98', pattern: 'stacked', variation: 0.07, gloss: 0.25, groutM: 0.003, seed: 62 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.32, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.28 },
  'tile-floor-grey': { procedural: { kind: 'tile', options: { tileW: 0.61, tileH: 0.305, color: '#9E9C96', grout: '#8B8983', pattern: 'running-bond', variation: 0.07, gloss: 0.2, groutM: 0.003, seed: 63 }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.34, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.3 },
  'tile-floor-checker': { procedural: { kind: 'tile', options: { tileW: 0.305, tileH: 0.305, color: '#EFEEE9', grout: '#BDB9B0', pattern: 'stacked', variation: 0.02, gloss: 0.45, groutM: 0.002, seed: 64, colorAlt: '#26262A', checker: true }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.16, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.08 },
  'tile-floor-marble': { procedural: { kind: 'tile', options: { tileW: 0.61, tileH: 0.305, color: '#EDEBE4', grout: '#CFCBC2', pattern: 'running-bond', variation: 0.09, gloss: 0.55, groutM: 0.002, seed: 65, colorAlt: '#DCD8CE' }, reliefStrength: 3.0, jointRoughness: 0.85 }, roughness: 0.14, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.07 },
  'tile-floor-terrazzo': { procedural: { kind: 'slab', options: { base: '#EDEAE2', vein: '#8A8378', intensity: 0.05, veinCount: 1, seed: 66, spanM: 1.0, speckle: 0.9, speckleColor: '#5E5A52', speckleRadiusM: 0.007, speckleColor2: '#B9A98E', speckleColor3: '#8FA39B' }, reliefStrength: 0.4 }, roughness: 0.26, metalness: 0, clearcoat: 0.32, clearcoatRoughness: 0.14 },
  'floor-white-oak-plank': { procedural: { kind: 'plank', options: { widthM: 0.19, lengthM: 1.6, color: '#D6C4A6', colorAlt: '#C3AE8C', grain: '#7A6242', variation: 0.16, seed: 71 }, reliefStrength: 1.2, jointRoughness: 0.9 }, roughness: 0.42, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.45 },
  'floor-natural-plank': { procedural: { kind: 'plank', options: { widthM: 0.15, lengthM: 1.6, color: '#C9A97A', colorAlt: '#B49466', grain: '#6B5232', variation: 0.16, seed: 72 }, reliefStrength: 1.2, jointRoughness: 0.9 }, roughness: 0.45, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.5 },
  'floor-honey-plank': { procedural: { kind: 'plank', options: { widthM: 0.15, lengthM: 1.6, color: '#C79A5C', colorAlt: '#B0834A', grain: '#6A4A25', variation: 0.16, seed: 73 }, reliefStrength: 1.2, jointRoughness: 0.9 }, roughness: 0.45, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.45 },
  'floor-light-plank': { procedural: { kind: 'plank', options: { widthM: 0.19, lengthM: 1.6, color: '#DCCDB4', colorAlt: '#CBB99C', grain: '#8A755A', variation: 0.16, seed: 74 }, reliefStrength: 1.2, jointRoughness: 0.9 }, roughness: 0.44, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.5 },
  'floor-lvp-oak': { procedural: { kind: 'plank', options: { widthM: 0.18, lengthM: 1.6, color: '#C9B18C', colorAlt: '#B79C74', grain: '#7A6242', variation: 0.16, seed: 75 }, reliefStrength: 1.2, jointRoughness: 0.9 }, roughness: 0.38, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.35 },
  'floor-lvp-grey': { procedural: { kind: 'plank', options: { widthM: 0.18, lengthM: 1.6, color: '#B3ADA4', colorAlt: '#9E978D', grain: '#6E6860', variation: 0.16, seed: 76 }, reliefStrength: 1.2, jointRoughness: 0.9 }, roughness: 0.38, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.35 },
  'floor-dark-walnut': { procedural: { kind: 'plank', options: { widthM: 0.19, lengthM: 1.6, color: '#5C4630', colorAlt: '#4A3826', grain: '#2C1F14', variation: 0.16, seed: 77 }, reliefStrength: 1.2, jointRoughness: 0.9 }, roughness: 0.42, metalness: 0, clearcoat: 0.14, clearcoatRoughness: 0.4 },
  'floor-wood-floor': { procedural: { kind: 'plank', options: { widthM: 0.16, lengthM: 1.6, color: '#C3A276', colorAlt: '#AE8D62', grain: '#6B5232', variation: 0.16, seed: 78 }, reliefStrength: 1.2, jointRoughness: 0.9 }, roughness: 0.45, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.5 },
  'sid-hardie-lap-white': { procedural: { kind: 'siding', options: { exposureM: 0.152, color: '#EAE9E2', seed: 81 }, reliefStrength: 2.4, jointRoughness: 0.75 }, roughness: 0.62, metalness: 0 },
  'sid-hardie-lap-grey': { procedural: { kind: 'siding', options: { exposureM: 0.152, color: '#9A9C9A', seed: 82 }, reliefStrength: 2.4, jointRoughness: 0.75 }, roughness: 0.62, metalness: 0 },
  'sid-hardie-lap-navy': { procedural: { kind: 'siding', options: { exposureM: 0.152, color: '#3A4556', seed: 83 }, reliefStrength: 2.4, jointRoughness: 0.75 }, roughness: 0.62, metalness: 0 },
  'sid-hardie-lap-charcoal': { procedural: { kind: 'siding', options: { exposureM: 0.152, color: '#3F4142', seed: 84 }, reliefStrength: 2.4, jointRoughness: 0.75 }, roughness: 0.62, metalness: 0 },
  'sid-hardie-lap-sage': { procedural: { kind: 'siding', options: { exposureM: 0.152, color: '#8E9A88', seed: 85 }, reliefStrength: 2.4, jointRoughness: 0.75 }, roughness: 0.62, metalness: 0 },
  'sid-vinyl-white': { procedural: { kind: 'siding', options: { exposureM: 0.102, color: '#EBEBE7', seed: 86 }, reliefStrength: 2.4, jointRoughness: 0.75 }, roughness: 0.5, metalness: 0 },
  'sid-vinyl-grey': { procedural: { kind: 'siding', options: { exposureM: 0.102, color: '#B9BCBB', seed: 87 }, reliefStrength: 2.4, jointRoughness: 0.75 }, roughness: 0.5, metalness: 0 },
  'sid-board-batten-white': { procedural: { kind: 'siding', options: { exposureM: 0.3, color: '#F0EEE8', seed: 88, batten: true, battenSpacingM: 0.406 }, reliefStrength: 2.4, jointRoughness: 0.75 }, roughness: 0.6, metalness: 0 },
  'sid-board-batten-black': { procedural: { kind: 'siding', options: { exposureM: 0.3, color: '#26282A', seed: 89, batten: true, battenSpacingM: 0.406 }, reliefStrength: 2.4, jointRoughness: 0.75 }, roughness: 0.6, metalness: 0 },
};

for (const m of CATALOG) {
  const o = PROCEDURAL_OVERRIDES[m.id];
  if (o) m.pbr = { ...o, tileM: undefined, texture: undefined, normalScale: m.pbr.normalScale ?? 0.5 };
}

export const CATALOG_BY_ID: Record<string, MaterialDef> = Object.fromEntries(CATALOG.map((m) => [m.id, m]));

// ---------------------------------------------------------------------------
// Runtime materials
//
// The catalog is not closed: the finish matcher (materials/match.ts) mints a
// material when a photo shows a colour nothing in the library is close to.
// Those live here, beside the static list, so every consumer that resolves an
// id — the 3D material factory, the estimator, the render prompt, the picker —
// sees them without knowing they were synthesised. Ids are content hashes, so
// re-registering the same definition is a no-op and never invalidates caches.
//
// The list is capped: a long-lived server process would otherwise grow one
// entry per distinct observation it ever saw. Eviction is oldest-first —
// there is no way to know which ids a live spec elsewhere still references,
// so the matcher's ensureSpecMaterials re-registers (and heals) on every
// entry point. Re-registration under the same id is harmless because the
// scene's THREE material caches (components/scene/materials.ts matCache /
// tintCache / adhocCache) are keyed by id, not by definition object.
// ---------------------------------------------------------------------------
const RUNTIME_MATERIALS: MaterialDef[] = [];
export const RUNTIME_MATERIAL_LIMIT = 2000;

/** Add a material at runtime. Idempotent: an id that already resolves is left alone. */
export function registerMaterial(def: MaterialDef): MaterialDef {
  const existing = CATALOG_BY_ID[def.id];
  if (existing) return existing;
  CATALOG_BY_ID[def.id] = def;
  // a re-registration (after the id was dropped from the map) moves to the newest end
  const idx = RUNTIME_MATERIALS.findIndex((m) => m.id === def.id);
  if (idx >= 0) RUNTIME_MATERIALS.splice(idx, 1);
  RUNTIME_MATERIALS.push(def);
  while (RUNTIME_MATERIALS.length > RUNTIME_MATERIAL_LIMIT) {
    const old = RUNTIME_MATERIALS.shift()!;
    if (CATALOG_BY_ID[old.id] === old) delete CATALOG_BY_ID[old.id];
  }
  return def;
}

/** Materials added since load, in registration order. */
export function runtimeMaterials(): readonly MaterialDef[] {
  return RUNTIME_MATERIALS;
}

export function getMaterial(id: string | undefined | null): MaterialDef | undefined {
  if (!id) return undefined;
  return CATALOG_BY_ID[id];
}

/**
 * Shelves a slot BORROWS when the catalogue has nothing of its own.
 *
 * The whole-house interior slots the floor plan introduced describe things
 * the catalogue already stocks under another name — an interior door slab is
 * a painted door, a stair tread is a wood floor, a baseboard is wall paint —
 * so rather than stamping four new slot ids onto ~250 material entries (and
 * getting them subtly wrong), each new slot borrows the shelf that already
 * holds the right materials. A material that later declares one of these
 * slots directly shows up alongside the borrowed ones rather than replacing
 * them, so adding one swatch can never collapse a shelf to one swatch.
 */
export const SLOT_BORROWS: Partial<Record<MaterialSlotId, MaterialSlotId>> = {
  interior_trim: 'walls',
  interior_doors: 'front_door',
  stair_treads: 'flooring',
  stair_railing: 'railing',
};

export function materialsForSlot(slot: MaterialSlotId, seen?: Set<MaterialSlotId>): MaterialDef[] {
  const out = CATALOG.filter((m) => m.slots.includes(slot));
  for (const m of RUNTIME_MATERIALS) if (m.slots.includes(slot) && CATALOG_BY_ID[m.id] === m) out.push(m);
  const borrow = SLOT_BORROWS[slot];
  // Today's borrows are a shallow tree, but a later `walls: 'interior_trim'`
  // beside the existing `interior_trim: 'walls'` would be an unbounded
  // recursion and a blank slot rail, so the chain is walked at most once per
  // slot rather than trusted to stay acyclic.
  if (borrow) {
    const visited = seen ?? new Set<MaterialSlotId>([slot]);
    if (!visited.has(borrow)) {
      visited.add(borrow);
      const have = new Set(out.map((m) => m.id));
      for (const m of materialsForSlot(borrow, visited)) if (!have.has(m.id)) out.push(m);
    }
  }
  return out;
}

/** Human labels + grouping for the customizer UI */
export const SLOT_META: Record<MaterialSlotId, { label: string; group: string; unit?: string }> = {
  cabinets_base: { label: 'Base Cabinets', group: 'Cabinets' },
  cabinets_upper: { label: 'Upper Cabinets', group: 'Cabinets' },
  island_cabinets: { label: 'Island', group: 'Cabinets' },
  cabinets_tall: { label: 'Tall Cabinets', group: 'Cabinets' },
  countertop: { label: 'Countertop', group: 'Surfaces' },
  island_countertop: { label: 'Island Top', group: 'Surfaces' },
  backsplash: { label: 'Backsplash', group: 'Surfaces' },
  flooring: { label: 'Flooring', group: 'Surfaces' },
  walls: { label: 'Wall Paint', group: 'Surfaces' },
  ceiling: { label: 'Ceiling', group: 'Surfaces' },
  hardware: { label: 'Hardware', group: 'Finishes' },
  faucet: { label: 'Faucet', group: 'Finishes' },
  appliances: { label: 'Appliances', group: 'Finishes' },
  lighting_fixture: { label: 'Light Fixtures', group: 'Finishes' },
  vanity_cabinet: { label: 'Vanity', group: 'Vanity' },
  vanity_top: { label: 'Vanity Top', group: 'Vanity' },
  mirror: { label: 'Mirror', group: 'Vanity' },
  floor_tile: { label: 'Floor Tile', group: 'Tile' },
  wall_tile: { label: 'Wall Tile', group: 'Tile' },
  shower_wall_tile: { label: 'Shower Walls', group: 'Tile' },
  shower_floor_tile: { label: 'Shower Floor', group: 'Tile' },
  fixtures: { label: 'Plumbing Finish', group: 'Finishes' },
  tub: { label: 'Tub', group: 'Fixtures' },
  siding_primary: { label: 'Primary Siding', group: 'Exterior' },
  siding_accent: { label: 'Accent Siding', group: 'Exterior' },
  trim: { label: 'Trim', group: 'Exterior' },
  roof: { label: 'Roof', group: 'Exterior' },
  front_door: { label: 'Front Door', group: 'Openings' },
  garage_door: { label: 'Garage Door', group: 'Openings' },
  window_frames: { label: 'Windows', group: 'Openings' },
  foundation: { label: 'Foundation / Skirt', group: 'Exterior' },
  porch_columns: { label: 'Porch Columns', group: 'Exterior' },
  deck: { label: 'Deck', group: 'Outdoor' },
  railing: { label: 'Railing', group: 'Outdoor' },
  driveway: { label: 'Driveway', group: 'Hardscape' },
  walkway: { label: 'Walkway', group: 'Hardscape' },
  patio: { label: 'Patio', group: 'Hardscape' },
  lawn: { label: 'Lawn', group: 'Landscape' },
  fence: { label: 'Fence', group: 'Landscape' },
  gutters: { label: 'Gutters', group: 'Exterior' },
  interior_trim: { label: 'Trim & Baseboard', group: 'Interior' },
  interior_doors: { label: 'Interior Doors', group: 'Interior' },
  stair_treads: { label: 'Stair Treads', group: 'Stairs' },
  stair_railing: { label: 'Stair Railing', group: 'Stairs' },
};

export const KITCHEN_SLOTS: MaterialSlotId[] = ['cabinets_base', 'cabinets_upper', 'island_cabinets', 'cabinets_tall', 'countertop', 'island_countertop', 'backsplash', 'flooring', 'walls', 'ceiling', 'hardware', 'faucet', 'appliances', 'lighting_fixture'];
export const BATHROOM_SLOTS: MaterialSlotId[] = ['vanity_cabinet', 'vanity_top', 'mirror', 'floor_tile', 'wall_tile', 'shower_wall_tile', 'shower_floor_tile', 'walls', 'ceiling', 'fixtures', 'hardware', 'tub', 'lighting_fixture'];
/** The whole-house interior shell: what a client changes when the rooms are empty. */
export const FLOORPLAN_SLOTS: MaterialSlotId[] = ['flooring', 'floor_tile', 'walls', 'ceiling', 'interior_trim', 'interior_doors', 'stair_treads', 'stair_railing'];

export const EXTERIOR_SLOTS: MaterialSlotId[] = ['siding_primary', 'siding_accent', 'trim', 'roof', 'front_door', 'garage_door', 'window_frames', 'foundation', 'porch_columns', 'deck', 'railing', 'driveway', 'walkway', 'patio', 'lawn', 'fence', 'gutters'];

/** The perimeter cabinet default. Tall units (pantry, fridge surround) are
 *  usually the same finish as the base cabinets, so their default is the
 *  same id — one constant so the two cannot drift apart. */
const KITCHEN_CABINET_DEFAULT = 'cab-pure-white';

/** Sensible defaults when the analyzer can't identify a material */
export const DEFAULT_SELECTIONS: Record<RoomType, Record<string, string>> = {
  kitchen: {
    cabinets_base: KITCHEN_CABINET_DEFAULT, cabinets_upper: KITCHEN_CABINET_DEFAULT, island_cabinets: 'cab-hale-navy', cabinets_tall: KITCHEN_CABINET_DEFAULT,
    countertop: 'ct-white-quartz', island_countertop: 'ct-calacatta-quartz', backsplash: 'tile-subway-white',
    flooring: 'floor-white-oak-plank', walls: 'wall-alabaster', ceiling: 'ceiling-white', hardware: 'fin-brushed-nickel',
    faucet: 'fin-matte-black', appliances: 'app-stainless', lighting_fixture: 'light-pendant-glass',
  },
  bathroom: {
    vanity_cabinet: 'wood-white-oak', vanity_top: 'ct-white-quartz', mirror: 'mirror-frameless', floor_tile: 'tile-floor-large-grey',
    wall_tile: 'tile-subway-white', shower_wall_tile: 'tile-large-format-white', shower_floor_tile: 'tile-hex-white',
    walls: 'wall-pure-white', ceiling: 'ceiling-white', fixtures: 'fin-matte-black', hardware: 'fin-matte-black', tub: 'tub-freestanding',
    lighting_fixture: 'light-sconce-brass',
  },
  exterior: {
    siding_primary: 'sid-hardie-lap-white', siding_accent: 'sid-board-batten-white', trim: 'ext-pure-white', roof: 'roof-asphalt-charcoal',
    front_door: 'door-black', garage_door: 'garage-black', window_frames: 'win-black', foundation: 'sid-stone-veneer',
    porch_columns: 'col-cedar', deck: 'deck-cedar', railing: 'rail-black', driveway: 'hs-concrete-broom', walkway: 'hs-pavers',
    patio: 'hs-pavers', lawn: 'lawn-lush', fence: 'fence-cedar', gutters: 'gutter-black',
  },
  floorplan: {
    flooring: 'floor-white-oak-plank', floor_tile: 'tile-floor-large-grey', walls: 'wall-alabaster', ceiling: 'ceiling-white',
    interior_trim: 'wall-pure-white', interior_doors: 'ext-pure-white', stair_treads: 'floor-white-oak-plank', stair_railing: 'rail-black',
  },
};
