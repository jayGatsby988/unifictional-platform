/**
 * MANHATTAN — headless verification for FINISH MATCHING.
 *
 *   npx tsx scripts/check-materials.ts
 *
 * The client's complaint: "i need more exact color recognition and pattern
 * matching. like if the floor is a certain type i need that same thing, and
 * same thing with colors." So:
 *
 * 1. OBSERVATION TABLE. Every row is what the analyzer would report for one
 *    slot (colour, family, pattern, sheen, module) with the material the
 *    client would expect back — a named catalog entry when one is close, a
 *    CUSTOM material in exactly the observed colour when none is.
 * 2. CUSTOM MATERIALS ARE REAL MATERIALS. Deterministic ids, registered in
 *    the catalog, priced by the estimator, drawn from a generator the 3D view
 *    knows, described (with their hex) in render prompts, and rebuilt from
 *    the spec alone after the registry is wiped.
 * 3. PIPELINE. reconcile → custom ids + notes; décor clamped; the analyzer's
 *    strict JSON schema still carries decor + finishes; sanitize repairs a
 *    model answer that omitted both.
 */
import type { DecorSpec, FinishObservation, KitchenSpec, RoomType } from '../src/lib/spec/types';
import { defaultBathroom, defaultKitchen, emptyDecor } from '../src/lib/spec/defaults';
import { RoomSpecZ, jsonSchemaFor } from '../src/lib/spec/schema';
import { CATALOG, CATALOG_BY_ID, RUNTIME_MATERIAL_LIMIT, SLOT_BORROWS, getMaterial, materialsForSlot, registerMaterial, runtimeMaterials } from '../src/lib/materials/catalog';
import type { MaterialSlotId } from '../src/lib/spec/types';
import { colorSplit, deltaE, lightness, materialAccent, materialColor, parseHex } from '../src/lib/materials/color';
import {
  applyFinishObservations, customMaterialFor, ensureSpecMaterials, finishPromise, healSelections, isCustomMaterialId, isMirrorFamily, matchCacheSize, matchFinish, normalizeObservation, unifyRelatedSlots,
} from '../src/lib/materials/match';
import { plankSpans } from '../src/components/scene/procedural';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { buildAnalysisPrompt, buildRenderPrompt } from '../src/lib/ai/prompt';
import { reconcileSpec } from '../src/lib/ai/reconcile';
import { sanitizeShape } from '../src/lib/ai/sanitize';

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

// mode 'full' on purpose: every assertion below prices a whole remodel, which
// is what full mode means. Changes-mode pricing is scripts/check-estimate.ts.
const SETTINGS = { region: 'seattle', tier: 'standard' as const, contingencyPct: 0.1, markupPct: 0.2, scope: 'pull-and-replace' as const, includePermits: true, mode: 'full' as const, includeKnockOns: true };

// ---------------------------------------------------------------------------
// 1. Observation table
// ---------------------------------------------------------------------------
type Expect = { ids: string[] } | { custom: true; kind?: string; base?: string } | { any: string[] };

interface Row {
  label: string;
  room: RoomType;
  obs: Partial<FinishObservation> & { slot: string; family: FinishObservation['family']; baseColorHex: string };
  hint?: string;
  expect: Expect;
}

const O = (slot: string, family: FinishObservation['family'], baseColorHex: string, rest: Partial<FinishObservation> = {}): Row['obs'] => ({
  slot, family, baseColorHex, accentColorHex: null, pattern: 'solid', sheen: 'satin', moduleIn: null, groutColorHex: null, description: '', visibility: 'clear', ...rest,
});

/*
 * WHY ELEVEN ROWS CHANGED WHEN TEXTURE_COLORS WAS MEASURED.
 *
 * Every one of the observation hexes below that used to expect a TEXTURED
 * catalog entry was the entry's own hand-written TEXTURE_COLORS value copied
 * across — #D8C3A0 was `white_oak_veneer`, #6B4A34 `american_walnut_veneer`,
 * #C9A06A `kitchen_wood`, #B8623F `terracotta_floor_tiles`, #C4A272
 * `herringbone_parquet`, #9B4E3A `red_brick_03`, #A6A39D `concrete_pavers`,
 * #A9A7A2 `concrete_pavement`. The row therefore asserted that the table
 * equals itself, and it passed for as long as the table was wrong.
 *
 * The maps measure very differently (`white_oak_veneer` is #907963, a mid
 * brown; `terracotta_floor_tiles` #4D271A; `red_brick_03` #6A544B), and the
 * material SWATCH the contractor sees has always been the map itself
 * (`catalog.ts T()` = `/textures/<id>/diff.webp`), so the picture on screen
 * never agreed with the number the matcher scored.
 *
 * The hexes are kept — they are plausible readings off a real photo — and the
 * expectations now say what an honest matcher does with them: a light warm oak
 * reaches `wood-washed-oak` (the lightest oak veneer we actually ship), and a
 * walnut / terracotta / red brick / concrete paver reading has NOTHING in the
 * catalog within ΔE 10 and synthesises, which is exactly what ACCEPTANCE §7
 * asks for. Catalog reachability is not lost: the §1b rows below feed each of
 * those entries its own MEASURED colour and assert it can still be chosen.
 */
const ROWS: Row[] = [
  // --- painted cabinets preserve pigment; only nearly equal swatches snap
  { label: 'white satin cabinets', room: 'kitchen', obs: O('cabinets_base', 'paint', '#F3F1EA', { sheen: 'satin', description: 'white painted shaker cabinets' }), expect: { custom: true, base: '#F3F1EA' } },
  { label: 'navy cabinets', room: 'kitchen', obs: O('island_cabinets', 'paint', '#2F3B4E', { description: 'navy painted island' }), expect: { ids: ['cab-hale-navy', 'cab-naval'] } },
  { label: 'sage cabinets', room: 'kitchen', obs: O('cabinets_upper', 'paint', '#95978A', { description: 'sage green uppers' }), expect: { ids: ['cab-evergreen-fog'] } },
  { label: 'white painted pantry / fridge surround', room: 'kitchen', obs: O('cabinets_tall', 'paint', '#F3F1EA', { sheen: 'satin', description: 'white painted fridge surround and pantry' }), expect: { custom: true, base: '#F3F1EA' } },
  { label: 'oak pantry', room: 'kitchen', obs: O('cabinets_tall', 'stained-wood', '#D8C3A0', { pattern: 'wood-grain', description: 'white oak pantry' }), expect: { custom: true, base: '#D8C3A0' } },
  { label: 'charcoal cabinets, cream photo', room: 'kitchen', obs: O('cabinets_base', 'paint', '#434341', { description: 'charcoal cabinets' }), expect: { ids: ['cab-iron-ore', 'cab-tricorn-black'] } },
  { label: 'terracotta cabinets (no palette match)', room: 'kitchen', obs: O('cabinets_base', 'paint', '#C4552D', { description: 'burnt orange painted cabinets' }), expect: { custom: true, base: '#C4552D' } },
  { label: 'wall paint greige', room: 'kitchen', obs: O('walls', 'paint', '#D2C6B4', { sheen: 'matte' }), expect: { ids: ['wall-greige', 'wall-mushroom'] } },
  { label: 'dusty pink walls', room: 'bathroom', obs: O('walls', 'paint', '#D9A6A0', { sheen: 'matte', description: 'dusty pink walls' }), expect: { custom: true, base: '#D9A6A0' } },
  // --- wood
  { label: 'white oak vanity', room: 'bathroom', obs: O('vanity_cabinet', 'stained-wood', '#D8C3A0', { pattern: 'wood-grain', accentColorHex: '#8A6A46', description: 'rift white oak vanity' }), expect: { custom: true, base: '#D8C3A0' } },
  { label: 'walnut cabinets', room: 'kitchen', obs: O('cabinets_base', 'stained-wood', '#6B4A34', { pattern: 'wood-grain', description: 'walnut flat-panel cabinets' }), expect: { custom: true, base: '#6B4A34' } },
  { label: 'teal-stained wood', room: 'kitchen', obs: O('cabinets_base', 'stained-wood', '#2E6B6B', { pattern: 'wood-grain', description: 'teal stained oak' }), expect: { custom: true, kind: 'wood', base: '#2E6B6B' } },
  // --- countertops
  { label: 'calacatta quartz', room: 'kitchen', obs: O('countertop', 'quartz', '#F8F6F0', { pattern: 'veined', accentColorHex: '#9A8154', sheen: 'polished', description: 'calacatta quartz with gold veins' }), expect: { ids: ['ct-calacatta-quartz', 'tile-marble-slab', 'ct-taj-quartzite'] } },
  { label: 'plain white quartz', room: 'kitchen', obs: O('countertop', 'quartz', '#F4F3EE', { sheen: 'polished', description: 'solid white quartz' }), expect: { ids: ['ct-white-quartz'] } },
  { label: 'black veined marble', room: 'kitchen', obs: O('island_countertop', 'marble', '#1E1E20', { pattern: 'veined', accentColorHex: '#F0F0F0', sheen: 'polished', description: 'nero marquina marble, bold white veins' }), expect: { custom: true, kind: 'slab', base: '#1E1E20' } },
  { label: 'speckled grey granite', room: 'kitchen', obs: O('countertop', 'granite', '#8A8880', { pattern: 'speckled', accentColorHex: '#332F2B', sheen: 'polished' }), expect: { ids: ['ct-speckled-granite', 'ct-grey-granite'] } },
  { label: 'green granite', room: 'kitchen', obs: O('countertop', 'granite', '#3C5A46', { pattern: 'speckled', accentColorHex: '#1E2D22', sheen: 'polished', description: 'verde butterfly granite' }), expect: { custom: true, kind: 'slab', base: '#3C5A46' } },
  { label: 'soapstone', room: 'kitchen', obs: O('countertop', 'soapstone', '#3A3E40', { pattern: 'veined', accentColorHex: '#A8AEB2', sheen: 'honed' }), expect: { ids: ['ct-soapstone'] } },
  { label: 'butcher block', room: 'kitchen', obs: O('island_countertop', 'butcher-block', '#C9A06A', { pattern: 'wood-grain', sheen: 'matte' }), expect: { custom: true, base: '#C9A06A' } },
  { label: 'blue laminate vanity top', room: 'bathroom', obs: O('vanity_top', 'laminate', '#4C6A8F', { description: 'blue laminate' }), expect: { custom: true, base: '#4C6A8F' } },
  // --- tile
  { label: 'white 3×6 subway', room: 'kitchen', obs: O('backsplash', 'ceramic-tile', '#F3F2EE', { pattern: 'subway', sheen: 'gloss', moduleIn: { w: 6, h: 3 }, groutColorHex: '#CFCAC0', description: '3x6 glossy white subway' }), expect: { ids: ['tile-subway-white'] } },
  { label: 'navy subway', room: 'kitchen', obs: O('backsplash', 'ceramic-tile', '#3A4759', { pattern: 'subway', sheen: 'gloss', moduleIn: { w: 6, h: 3 } }), expect: { ids: ['tile-subway-navy'] } },
  { label: '2" white hex', room: 'bathroom', obs: O('shower_floor_tile', 'porcelain-tile', '#F1F1EC', { pattern: 'hex', sheen: 'matte', moduleIn: { w: 2, h: 2 }, groutColorHex: '#C6C2B8' }), expect: { ids: ['tile-hex-white'] } },
  { label: 'sage 4×4 zellige', room: 'kitchen', obs: O('backsplash', 'ceramic-tile', '#9AAB98', { pattern: 'zellige', sheen: 'gloss', moduleIn: { w: 4, h: 4 }, accentColorHex: '#86987F', description: 'sage zellige 4x4' }), expect: { any: ['tile-zellige-green', 'tile-subway-sage', 'custom'] } },
  { label: 'blush pink 2×8 subway', room: 'kitchen', obs: O('backsplash', 'ceramic-tile', '#E8C4B8', { pattern: 'subway', sheen: 'gloss', moduleIn: { w: 8, h: 2 }, description: 'blush 2x8 subway' }), expect: { custom: true, kind: 'tile', base: '#E8C4B8' } },
  { label: 'large-format grey 24×24 floor', room: 'bathroom', obs: O('floor_tile', 'porcelain-tile', '#A8A69F', { pattern: 'large-format', sheen: 'matte', moduleIn: { w: 24, h: 24 } }), expect: { ids: ['tile-floor-large-grey'] } },
  { label: 'grey 12×24 floor', room: 'bathroom', obs: O('floor_tile', 'porcelain-tile', '#9E9C96', { pattern: 'stacked', sheen: 'matte', moduleIn: { w: 24, h: 12 } }), expect: { ids: ['tile-floor-grey', 'tile-floor-large-grey'] } },
  { label: 'black & white checker floor', room: 'kitchen', obs: O('flooring', 'porcelain-tile', '#EFEEE9', { pattern: 'checker', accentColorHex: '#26262A', sheen: 'satin', moduleIn: { w: 12, h: 12 } }), expect: { ids: ['tile-floor-checker'] } },
  { label: 'cobalt 4×4 shower tile', room: 'bathroom', obs: O('shower_wall_tile', 'ceramic-tile', '#1F4E9C', { pattern: 'stacked', sheen: 'gloss', moduleIn: { w: 4, h: 4 } }), expect: { custom: true, kind: 'tile', base: '#1F4E9C' } },
  { label: 'terracotta floor', room: 'kitchen', obs: O('flooring', 'ceramic-tile', '#B8623F', { pattern: 'stacked', sheen: 'matte', moduleIn: { w: 12, h: 12 } }), expect: { custom: true, base: '#B8623F' } },
  // --- wood floors
  { label: '7" white-oak plank', room: 'kitchen', obs: O('flooring', 'hardwood', '#C9B48E', { pattern: 'plank', sheen: 'matte', moduleIn: { w: 7, h: 60 }, accentColorHex: '#7A6242', description: '7 in white-oak plank, matte' }), expect: { any: ['floor-white-oak-plank', 'floor-lvp-oak', 'custom'] } },
  { label: 'honey oak floor', room: 'kitchen', obs: O('flooring', 'hardwood', '#C79A5C', { pattern: 'plank', sheen: 'satin', moduleIn: { w: 5, h: 48 } }), expect: { ids: ['floor-honey-plank', 'floor-natural-plank', 'floor-wood-floor'] } },
  { label: 'grey-wash LVP', room: 'kitchen', obs: O('flooring', 'lvp', '#B3ADA4', { pattern: 'plank', sheen: 'satin', moduleIn: { w: 7, h: 48 } }), expect: { ids: ['floor-lvp-grey'] } },
  { label: 'ebony floor', room: 'kitchen', obs: O('flooring', 'hardwood', '#2B2320', { pattern: 'plank', sheen: 'matte', moduleIn: { w: 5, h: 48 }, description: 'ebony stained oak plank' }), expect: { custom: true, kind: 'plank', base: '#2B2320' } },
  { label: 'herringbone oak', room: 'kitchen', obs: O('flooring', 'hardwood', '#C4A272', { pattern: 'herringbone', sheen: 'satin', moduleIn: { w: 3, h: 18 } }), expect: { custom: true, base: '#C4A272' } },
  // --- metals
  { label: 'brass hardware', room: 'kitchen', obs: O('hardware', 'brass', '#C9A45C', { sheen: 'brushed' }), expect: { ids: ['fin-brushed-brass', 'fin-brushed-gold', 'fin-unlacquered-brass'] } },
  { label: 'matte black faucet', room: 'kitchen', obs: O('faucet', 'black-metal', '#232426', { sheen: 'matte' }), expect: { ids: ['fin-matte-black'] } },
  { label: 'polished chrome fixtures', room: 'bathroom', obs: O('fixtures', 'chrome', '#DADCDF', { sheen: 'polished' }), expect: { ids: ['fin-polished-chrome', 'fin-polished-nickel'] } },
  { label: 'brushed nickel hardware', room: 'bathroom', obs: O('hardware', 'nickel', '#C8C9C7', { sheen: 'brushed' }), expect: { ids: ['fin-brushed-nickel'] } },
  { label: 'stainless appliances', room: 'kitchen', obs: O('appliances', 'stainless', '#C7C9CB', { sheen: 'brushed' }), expect: { ids: ['app-stainless', 'app-pro-range'] } },
  { label: 'rose gold hardware', room: 'kitchen', obs: O('hardware', 'copper', '#D9A08A', { sheen: 'polished', description: 'rose gold pulls' }), expect: { custom: true, base: '#D9A08A' } },
  // --- exterior
  { label: 'navy lap siding', room: 'exterior', obs: O('siding_primary', 'siding', '#3A4556', { pattern: 'lap', sheen: 'matte', moduleIn: { w: 6, h: 6 } }), expect: { ids: ['sid-hardie-lap-navy'] } },
  { label: 'red brick', room: 'exterior', obs: O('siding_primary', 'brick', '#9B4E3A', { pattern: 'brick', sheen: 'matte' }), expect: { custom: true, base: '#9B4E3A' } },
  { label: 'yellow board and batten', room: 'exterior', obs: O('siding_accent', 'siding', '#E3C46A', { pattern: 'board-batten', sheen: 'matte', description: 'yellow board and batten' }), expect: { custom: true, kind: 'siding', base: '#E3C46A' } },
  { label: 'charcoal shingle roof', room: 'exterior', obs: O('roof', 'shingle', '#4A4A4A', { pattern: 'shingle', sheen: 'matte' }), expect: { ids: ['roof-asphalt-charcoal', 'roof-asphalt-black'] } },
  { label: 'black front door', room: 'exterior', obs: O('front_door', 'paint', '#1F2022', { sheen: 'semi-gloss' }), expect: { ids: ['door-black'] } },
  { label: 'red front door', room: 'exterior', obs: O('front_door', 'paint', '#A3232B', { sheen: 'semi-gloss', description: 'red front door' }), expect: { custom: true, base: '#A3232B' } },
  // --- review hardening
  { label: '#2 concrete pavers on a driveway', room: 'exterior', obs: O('driveway', 'concrete', '#A6A39D', { pattern: 'brick', sheen: 'matte', moduleIn: { w: 8, h: 4 } }), expect: { custom: true, base: '#A6A39D' } },
  { label: '#2 concrete patio by module alone', room: 'exterior', obs: O('patio', 'concrete', '#A29E97', { pattern: 'stacked', sheen: 'matte', moduleIn: { w: 12, h: 12 } }), expect: { custom: true, base: '#A29E97' } },
  { label: '#2 broom concrete stays a slab', room: 'exterior', obs: O('driveway', 'concrete', '#A9A7A2', { pattern: 'solid', sheen: 'matte' }), expect: { custom: true, base: '#A9A7A2' } },
  { label: '#2 terracotta pavers → custom pavers', room: 'exterior', obs: O('walkway', 'concrete', '#C46A3A', { pattern: 'brick', sheen: 'matte', moduleIn: { w: 8, h: 4 } }), expect: { custom: true, kind: 'tile', base: '#C46A3A' } },
  // #D8C3A0 (the old fictional `white_oak_veneer` colour) has no veneer within
  // ΔE 8 now that the maps are measured, and this row is about PATTERN, not
  // identity — so it is anchored on `washed_grey_oak_veneer`'s measured colour,
  // where a catalog answer is reachable and 'solid' vs 'wood-grain' is what
  // decides it.
  { label: '#3 white oak cabinets reported "solid"', room: 'kitchen', obs: O('cabinets_base', 'stained-wood', '#CEB7A3', { pattern: 'solid', description: 'white oak cabinets' }), expect: { ids: ['wood-washed-oak', 'wood-white-oak', 'wood-ash', 'wood-natural-oak', 'wood-grey-oak'] } },
  { label: '#3 honey oak floor reported "solid"', room: 'kitchen', obs: O('flooring', 'hardwood', '#C79A5C', { pattern: 'solid', sheen: 'satin' }), expect: { ids: ['floor-honey-plank', 'floor-natural-plank', 'floor-wood-floor'] } },
  { label: '#3 painted cabinets reported "wood-grain"', room: 'kitchen', obs: O('cabinets_base', 'paint', '#2F3B4E', { pattern: 'wood-grain' }), expect: { ids: ['cab-hale-navy', 'cab-naval'] } },
  { label: '#3 veined marble at a solid-quartz colour still vetoes', room: 'kitchen', obs: O('countertop', 'marble', '#1E1E20', { pattern: 'veined', accentColorHex: '#F0F0F0', sheen: 'polished' }), expect: { custom: true, kind: 'slab', base: '#1E1E20' } },
  { label: '#4 oak floor at an LVP colour', room: 'kitchen', obs: O('flooring', 'hardwood', '#C9B18C', { pattern: 'plank', sheen: 'satin', moduleIn: { w: 6, h: 48 } }), expect: { ids: ['floor-natural-plank', 'floor-wood-floor', 'floor-rect-parquet', 'floor-white-oak-plank'] } },
  { label: '#4 grey oak floor → LVP only as a near family', room: 'kitchen', obs: O('flooring', 'hardwood', '#B3ADA4', { pattern: 'plank', sheen: 'satin', moduleIn: { w: 7, h: 48 } }), expect: { ids: ['floor-lvp-grey'] } },
  { label: '#12 clear glass pendants, brass hardware', room: 'kitchen', obs: O('lighting_fixture', 'glass', '#D9D6D0', { accentColorHex: '#B08A53', sheen: 'gloss', description: 'oversized clear glass pendants with warm brass hardware' }), expect: { ids: ['light-pendant-glass'] } },
  { label: '#12 pale glass pendants, no metal mentioned', room: 'kitchen', obs: O('lighting_fixture', 'glass', '#D9D6D0', { sheen: 'gloss', description: 'globe pendants' }), expect: { ids: ['light-pendant-glass'] } },
  { label: '#12 brass sconces stay metal', room: 'bathroom', obs: O('lighting_fixture', 'brass', '#C9A45C', { sheen: 'satin', description: 'brass sconces' }), expect: { ids: ['light-sconce-brass', 'fin-brushed-brass', 'fin-unlacquered-brass', 'fin-brushed-gold'] } },
  // --- the accent colour is the discriminator (client-tan: "the countertop was
  //     not a design it was js white"). Five candidates sit inside ΔE 2.1 of
  //     this white, so the BASE separates nothing and the vein decides: warm
  //     grey #D7D1C8 is a plain quartz, gold #9A8154 is a Calacatta. The pair
  //     of rows is the point — the same white must go both ways.
  { label: '#tan white quartz with warm grey veining', room: 'kitchen', obs: O('countertop', 'quartz', '#F2F0EB', { pattern: 'veined', accentColorHex: '#D7D1C8', sheen: 'polished', description: 'white quartz with soft warm grey veining, polished' }), expect: { ids: ['ct-white-quartz'] } },
  { label: '#tan the same white with a GOLD vein is still calacatta', room: 'kitchen', obs: O('countertop', 'quartz', '#F2F0EB', { pattern: 'veined', accentColorHex: '#9A8154', sheen: 'polished', description: 'white quartz with warm gold veining, polished' }), expect: { ids: ['ct-calacatta-quartz'] } },
  { label: '#tan full-height white slab backsplash', room: 'kitchen', obs: O('backsplash', 'quartz', '#F1EFEB', { pattern: 'veined', accentColorHex: '#D6D0C7', sheen: 'polished', description: 'full-height white veined slab backsplash matching counters' }), expect: { ids: ['tile-quartz-slab'] } },
  // A photographed veneer now has a measured grain palette. An exact base
  // colour cannot excuse growth rings far outside the promised accent ΔE.
  { label: '#tan measured grain rejects the wrong accent', room: 'kitchen', obs: O('cabinets_base', 'stained-wood', '#CEB7A3', { pattern: 'wood-grain', accentColorHex: '#2B2320', description: 'white oak cabinets' }), expect: { custom: true, kind: 'wood', base: '#CEB7A3' } },

  // --- 1b. reachability: each textured entry, fed the colour its own map
  //     MEASURES, must still be chosen. This is the half of the coverage the
  //     self-referential rows above used to provide, now anchored on the
  //     pixels instead of on the table.
  { label: '#tex white_oak_veneer at its measured colour', room: 'kitchen', obs: O('cabinets_base', 'stained-wood', '#907963', { pattern: 'wood-grain', description: 'mid-brown oak veneer cabinets' }), expect: { ids: ['wood-white-oak', 'wood-ash', 'wood-natural-oak', 'wood-mocha-oak'] } },
  { label: '#tex american_walnut_veneer at its measured colour', room: 'kitchen', obs: O('cabinets_base', 'stained-wood', '#736E69', { pattern: 'wood-grain', description: 'greyed walnut cabinets' }), expect: { ids: ['wood-walnut', 'wood-natural-walnut', 'wood-black-oak'] } },
  { label: '#tex kitchen_wood at its measured colour', room: 'kitchen', obs: O('island_countertop', 'butcher-block', '#705D49', { pattern: 'wood-grain', sheen: 'matte' }), expect: { ids: ['ct-butcher-block', 'ct-oak-block'] } },
  { label: '#tex terracotta_floor_tiles at its measured colour', room: 'kitchen', obs: O('flooring', 'ceramic-tile', '#4D271A', { pattern: 'stacked', sheen: 'matte', moduleIn: { w: 12, h: 12 } }), expect: { ids: ['tile-floor-terracotta'] } },
  { label: '#tex herringbone_parquet at its measured colour', room: 'kitchen', obs: O('flooring', 'hardwood', '#93704D', { pattern: 'herringbone', sheen: 'satin', moduleIn: { w: 3, h: 18 } }), expect: { ids: ['floor-herringbone'] } },
  { label: '#tex red_brick_03 at its measured colour', room: 'exterior', obs: O('siding_primary', 'brick', '#6A544B', { pattern: 'brick', sheen: 'matte' }), expect: { ids: ['sid-brick-red', 'sid-brick-classic'] } },
  { label: '#tex concrete_pavers at its measured colour', room: 'exterior', obs: O('driveway', 'concrete', '#675E53', { pattern: 'brick', sheen: 'matte', moduleIn: { w: 8, h: 4 } }), expect: { ids: ['hs-pavers', 'hs-pavers-interlock', 'hs-pavers-pattern'] } },
  { label: '#tex concrete_pavement at its measured colour', room: 'exterior', obs: O('driveway', 'concrete', '#7F7566', { pattern: 'solid', sheen: 'matte' }), expect: { ids: ['hs-concrete-broom', 'hs-concrete-smooth'] } },
];

console.log('\nOBSERVATION TABLE');
const table: Array<Record<string, string>> = [];
for (const row of ROWS) {
  const m = matchFinish(row.obs as FinishObservation, row.room, row.hint);
  const def = getMaterial(m.id);
  const custom = isCustomMaterialId(m.id);
  const kind = def?.pbr.procedural?.kind ?? (def?.pbr.color ? 'flat' : def?.pbr.texture ?? '?');
  const color = def ? materialColor(def) : null;
  const dE = color ? deltaE(row.obs.baseColorHex, color) : NaN;
  let pass = true;
  let want = '';
  if ('ids' in row.expect) {
    want = row.expect.ids.join(' | ');
    pass = row.expect.ids.includes(m.id);
  } else if ('any' in row.expect) {
    want = row.expect.any.join(' | ');
    pass = row.expect.any.includes(m.id) || (custom && row.expect.any.includes('custom'));
  } else {
    want = `custom${row.expect.kind ? ` (${row.expect.kind})` : ''}`;
    pass = custom && (!row.expect.kind || kind === row.expect.kind) && (!row.expect.base || Boolean(color && deltaE(row.expect.base, color) < 1));
  }
  if (!def) pass = false;
  if (!custom && def && Number.isFinite(dE) && dE > 16.5) pass = false;
  table.push({ result: pass ? 'ok' : 'FAIL', row: row.label, slot: row.obs.slot, got: m.id.length > 34 ? `${m.id.slice(0, 31)}…` : m.id, name: def?.name ?? '-', kind, dE: Number.isFinite(dE) ? dE.toFixed(1) : '-', want });
  if (!pass) fail(`${row.label}: got ${m.id} (${def?.name ?? 'missing'}, ${kind}, ΔE ${dE.toFixed(1)}), wanted ${want} — ${m.reason}`);
}
console.table(table);
const passed = table.filter((t) => t.result === 'ok').length;
console.log(`  ${passed}/${ROWS.length} observations matched as expected`);

// ---------------------------------------------------------------------------
// 2. Custom materials are real materials
// ---------------------------------------------------------------------------
console.log('\nCUSTOM MATERIALS');
const marble = O('island_countertop', 'marble', '#1E1E20', { pattern: 'veined', accentColorHex: '#F0F0F0', sheen: 'polished', description: 'nero marquina marble, bold white veins' }) as FinishObservation;
const a = matchFinish(marble, 'kitchen');
const b = matchFinish({ ...marble, description: '  Nero  Marquina marble, bold WHITE veins (#1E1E20). ' }, 'kitchen');
if (a.id !== b.id) fail(`determinism: same observation gave ${a.id} then ${b.id}`);
else ok(`determinism: ${a.id} both times (case, spacing, punctuation and hex notes do not change the id)`);
if (!/^custom-island_countertop-[0-9a-f]{8}$/.test(a.id)) fail(`custom id shape: ${a.id}`);
else ok(`custom id shape: ${a.id}`);
// #5 the description names the material, so a different wording is a different (equally real) material
{
  const c = matchFinish({ ...marble, description: 'Nero Marquina, white veins' }, 'kitchen');
  const defA = getMaterial(a.id), defC = getMaterial(c.id);
  const recipe = (d?: { pbr: { procedural?: { options: Record<string, unknown> } } }) => JSON.stringify({ ...d?.pbr, procedural: d?.pbr.procedural ? { ...d.pbr.procedural, options: { ...d.pbr.procedural.options, seed: 0 } } : undefined });
  if (c.id === a.id) fail('#5 a different description must give a different id (the name/prompt depend on it)');
  else if (!defA || !defC || defA.name === defC.name || recipe(defA) !== recipe(defC)) fail(`#5 reworded observation: names ${defA?.name} / ${defC?.name}, recipes ${recipe(defA) === recipe(defC) ? 'same' : 'DIFFER'}`);
  else ok(`#5 reworded observation → its own id with its own name ("${defA.name}" vs "${defC.name}"), identical recipe (seed aside)`);
  // the definition is a pure function of the observation — no dependence on what was registered first
  const kin = CATALOG_BY_ID['ct-calacatta-quartz'];
  const d1 = customMaterialFor(marble, kin), d2 = customMaterialFor({ ...marble, description: 'Nero Marquina, white veins' }, kin);
  if (d1.id === d2.id || d1.name === d2.name) fail('#5 customMaterialFor is not a pure function of the observation');
  else ok('#5 customMaterialFor: name and prompt come from the observation, never from registration order');
}

const def = getMaterial(a.id);
if (!def) fail('custom material not registered');
else {
  if (!def.slots.includes('island_countertop') || !def.slots.includes('countertop')) fail(`custom slots: ${def.slots.join(',')}`);
  else ok(`custom slots inherited: ${def.slots.join(', ')}`);
  if (def.group !== 'countertop') fail(`custom group: ${def.group}`); else ok(`custom group/tier: ${def.group} / ${def.tier}`);
  if (def.name.length > 28 || !def.name) fail(`custom name length: "${def.name}"`); else ok(`custom name: "${def.name}"`);
  if (def.subtitle !== 'matched from photo') fail(`custom subtitle: ${def.subtitle}`);
  if (def.swatch !== '#1E1E20') fail(`custom swatch: ${def.swatch}`); else ok(`custom swatch is the observed hex`);
  if (!def.prompt.includes('#1E1E20')) fail(`custom prompt lacks hex: ${def.prompt}`); else ok(`custom prompt: "${def.prompt}"`);
  // #11 a description that already carries the hex must not repeat it in the name or the prompt
  const noted = getMaterial(matchFinish({ ...marble, description: 'nero marquina marble (#1E1E20), bold white veins' }, 'kitchen').id);
  const hexCount = (noted?.prompt.match(/#1E1E20/gi) ?? []).length;
  if (!noted || hexCount !== 1 || /#1E1E20/i.test(noted.name)) fail(`#11 hex duplicated: name "${noted?.name}", prompt "${noted?.prompt}"`);
  else ok(`#11 hex note stripped from the description: "${noted.name}" / "${noted.prompt}"`);
  const opts = def.pbr.procedural?.options as { base?: string; vein?: string; spanM?: number } | undefined;
  if (def.pbr.procedural?.kind !== 'slab' || opts?.base !== '#1E1E20' || opts?.vein !== '#F0F0F0' || opts?.spanM !== 2.4) fail(`custom slab recipe: ${JSON.stringify(def.pbr.procedural)}`);
  else ok(`custom slab recipe: base ${opts.base}, vein ${opts.vein}, span ${opts.spanM} m, roughness ${def.pbr.roughness}, clearcoat ${def.pbr.clearcoat}`);
  if (!materialsForSlot('countertop').some((m) => m.id === a.id)) fail('custom material missing from materialsForSlot(countertop)');
  else ok('custom material listed by materialsForSlot for its sibling slot');
}

// ---------------------------------------------------------------------------
// 2a. SLOT_BORROWS TERMINATES
//
// A borrowing slot pulls its neighbour's shelf, and materialsForSlot follows
// the chain. Today's map is a shallow tree, but one later entry pointing back
// (`walls: 'interior_trim'` beside `interior_trim: 'walls'`) would be an
// unbounded recursion and a blank slot rail in the studio.
// ---------------------------------------------------------------------------
console.log('\nSLOT BORROWS');
{
  for (const key of Object.keys(SLOT_BORROWS) as MaterialSlotId[]) {
    const walked: MaterialSlotId[] = [key];
    let cur: MaterialSlotId | undefined = SLOT_BORROWS[key];
    let looped = false;
    while (cur) {
      if (walked.includes(cur)) { looped = true; break; }
      walked.push(cur);
      cur = SLOT_BORROWS[cur];
    }
    if (looped) fail(`SLOT_BORROWS loops: ${walked.join(' → ')} → ${cur}`);
    else ok(`${walked.join(' → ')} terminates`);
    // and the call itself returns rather than blowing the stack, whatever the map says
    const swatches = materialsForSlot(key);
    if (!swatches.length) fail(`materialsForSlot('${key}') came back empty`);
    else ok(`materialsForSlot('${key}') returns ${swatches.length} swatches`);
  }
}

// ---------------------------------------------------------------------------
// 2b. METALS AND CLEAR GLASS — the promise, and the synthesis behind it
//
// None of the four client fixtures contains a metal or a glass the catalog
// lacks, so this is the only place the mirror path is exercised. See the
// `finishPromise` comment in match.ts for why these two families are graded on
// hue and lightness separately instead of on one ΔE: a metal has no diffuse
// albedo, so its photographed pixel is the ROOM, and holding it to ΔE 8 was
// failing app-stainless for a photo that says "stainless" and
// light-pendant-glass for one that says "clear glass".
// ---------------------------------------------------------------------------
console.log('\nMETALS AND CLEAR GLASS');
{
  const M = (slot: string, family: FinishObservation['family'], hex: string, rest: Partial<FinishObservation> = {}) =>
    O(slot, family, hex, rest) as FinishObservation;
  const optsOf = (id: string) => getMaterial(id)?.pbr.procedural?.options as Record<string, string> | undefined;

  // --- the split is exact: a ΔE is its lightness and its hue, nothing lost
  {
    const bad = (['#AEB3B7', '#B58D52', '#1E1E1E', '#D9D7D2'] as const).filter((h) => {
      const c = colorSplit(h, '#C7C9CB');
      return Math.abs(Math.hypot(c.dL, c.dC) - c.dE) > 1e-9 || Math.abs(c.dE - deltaE(h, '#C7C9CB')) > 1e-9;
    });
    if (bad.length) fail(`colorSplit is not a decomposition of deltaE: ${bad.join(', ')}`);
    else ok('colorSplit: ΔE² = ΔL² + ΔC² exactly, so nothing is hidden by grading the halves');
  }

  // --- the two rows the acceptance suite failed: the RIGHT product, over ΔE 8,
  //     and over it entirely in lightness
  for (const [label, obs, id] of [
    ['stainless range read off a marble kitchen', M('appliances', 'stainless', '#AEB3B7', { sheen: 'brushed', accentColorHex: '#6D7378' }), 'app-stainless'],
    ['clear glass pendants with brass fittings', M('lighting_fixture', 'glass', '#D9D7D2', { sheen: 'gloss', accentColorHex: '#B8925D' }), 'light-pendant-glass'],
  ] as const) {
    const p = finishPromise(obs, CATALOG_BY_ID[id]);
    if (!p.ok || p.dE <= 8 || p.dL <= p.dC) fail(`${label}: ${id} ${p.why} — expected a pass whose ΔE ${p.dE.toFixed(1)} is spent on lightness`);
    else ok(`${label}: ${id} honoured — ΔE ${p.dE.toFixed(1)} is ΔL ${p.dL.toFixed(1)} + ΔC ${p.dC.toFixed(1)}, so the excess is the room`);
  }

  // --- the budget is not a back door: a metal of the WRONG hue still fails,
  //     and it fails at a distance the old single ΔE ≤ 16 waved through
  {
    // ΔE 10.9 from app-stainless — comfortably inside the old single ΔE ≤ 16 —
    // but 10.5 of it is hue, which is where a metal's identity lives
    const brassy = M('appliances', 'stainless', '#CBBFB0', { sheen: 'brushed', description: 'warm champagne-toned appliance panels' });
    const p = finishPromise(brassy, CATALOG_BY_ID['app-stainless']);
    const m = matchFinish(brassy, 'kitchen');
    if (p.ok || p.dE > 16) fail(`champagne panels: app-stainless ${p.why} at ΔE ${p.dE.toFixed(1)} — wanted a REJECT inside the old ΔE 16`);
    else if (!isCustomMaterialId(m.id)) fail(`champagne panels resolved to ${m.id}, expected a synthesised material`);
    else ok(`champagne panels: app-stainless rejected on ${p.why} at only ΔE ${p.dE.toFixed(1)} (the old gate passed it) → ${m.id}`);
  }

  // --- a synthesised metal is DRAWN as brushed. brushedMetal has shipped in
  //     procedural.ts from the start and nothing ever asked for it, so every
  //     metal was a flat colour and a roughness scalar.
  {
    const bronze = M('hardware', 'bronze', '#7E5A2E', { sheen: 'brushed', description: 'champagne bronze pulls' });
    const m = matchFinish(bronze, 'kitchen');
    const def = getMaterial(m.id);
    const o = optsOf(m.id);
    if (!isCustomMaterialId(m.id) || def?.pbr.procedural?.kind !== 'brushed-metal') fail(`champagne bronze: ${m.id} kind ${def?.pbr.procedural?.kind ?? 'none'} — wanted a brushed-metal recipe`);
    else if (o?.direction !== 'y' || def.pbr.metalness !== 1) fail(`champagne bronze: direction ${o?.direction}, metalness ${def.pbr.metalness}`);
    else ok(`champagne bronze → ${m.id}: brushed-metal generator, brush along the handle (direction ${o.direction}), grit ${o.grit}`);

    // an appliance panel is brushed ACROSS, matching applyRealism's anisotropyRotation
    const panel = matchFinish(M('appliances', 'stainless', '#CBBFB0', { sheen: 'brushed', description: 'champagne stainless panels' }), 'kitchen');
    if (optsOf(panel.id)?.direction !== 'x') fail(`appliance panel brush runs ${optsOf(panel.id)?.direction}, expected x (across the panel)`);
    else ok('appliance panel brushes across, a faucet or handle along — the axes applyRealism already uses');

    // a mirror has no brush to draw
    const chrome = matchFinish(M('faucet', 'chrome', '#C7A8D8', { sheen: 'polished', description: 'lilac chromed faucet' }), 'kitchen');
    if (!isCustomMaterialId(chrome.id) || getMaterial(chrome.id)?.pbr.procedural) fail(`polished metal got a procedural recipe: ${JSON.stringify(getMaterial(chrome.id)?.pbr.procedural)}`);
    else ok('a polished metal stays flat — a mirror has no brush');
  }

  // --- the photographed colour is what gets DRAWN. A synthesised metal is
  //     not re-lit toward a catalog entry: see the recipe comment in match.ts
  //     for why the catalog cannot name the reference light. What this pins is
  //     the failure that made the question worth asking — a matcher that picks
  //     a reference by SCORE has a cliff in the middle of the neutral range,
  //     because hue cannot tell stainless from matte black, and it draws the
  //     lower half DARKER than the photograph.
  {
    const bad: string[] = [];
    // straddling the old cliff: 6 neutral greys, 1.6 L apart at the middle
    const band = ['#6C7074', '#74787C', '#787C80', '#7C8084', '#808488', '#94989C'];
    let prev = -Infinity;
    const drawnL: number[] = [];
    for (const hex of band) {
      const obs = M('appliances', 'stainless', hex, { sheen: 'brushed', description: 'brushed stainless panels in a dim kitchen' });
      const m = matchFinish(obs, 'kitchen');
      if (!isCustomMaterialId(m.id)) { bad.push(`${hex} resolved to ${m.id} — the catalog has no neutral this dark, so this band must synthesise`); continue; }
      const drawn = materialColor(getMaterial(m.id)!)!;
      const split = colorSplit(drawn, hex);
      if (split.dE > 0.5) bad.push(`${hex} is drawn ${drawn} (ΔE ${split.dE.toFixed(1)}) — the photograph is the only reading there is`);
      if (lightness(drawn) < lightness(hex) - 0.5) bad.push(`${hex} (L ${lightness(hex).toFixed(1)}) is drawn DARKER, at L ${lightness(drawn).toFixed(1)}`);
      if (lightness(drawn) < prev - 0.5) bad.push(`the band is not monotone: ${hex} draws L ${lightness(drawn).toFixed(1)} under the previous ${prev.toFixed(1)}`);
      prev = lightness(drawn);
      drawnL.push(lightness(drawn));
    }
    // the pair that used to straddle the cliff: 1.6 L of photograph in, 1.6 out (it was 33.5)
    const step = drawnL.length === band.length ? Math.abs(drawnL[3] - drawnL[2]) : NaN;
    if (!(step < 2)) bad.push(`#787C80 → #7C8084 is 1.6 L of photograph and ${step.toFixed(1)} L of output`);
    if (bad.length) fail(`neutral metals: ${bad.join('; ')}`);
    else ok(`a neutral metal is drawn at the colour photographed, monotonically and never darker — #787C80 → #7C8084 is 1.6 L in, ${step.toFixed(1)} L out`);
  }

  // --- …and a metal the catalog has no hue for is the same story: the nearest
  //     entry is a different metal and neither its hue nor its lightness is
  //     ours to borrow
  {
    const rose = M('hardware', 'copper', '#D9A08A', { sheen: 'polished', description: 'rose gold pulls' });
    const m = matchFinish(rose, 'kitchen');
    const drawn = materialColor(getMaterial(m.id)!)!;
    if (!isCustomMaterialId(m.id) || deltaE(drawn, rose.baseColorHex) > 0.5) fail(`rose gold drawn ${drawn}, expected the observed ${rose.baseColorHex} untouched`);
    else ok(`rose gold #D9A08A drawn as ${drawn} — no catalog entry of that hue, so nothing to borrow a lightness from either`);
  }

  // --- clear glass: the room's hue is tolerated, a real tint is not
  {
    const pale = M('lighting_fixture', 'glass', '#D9D6D0', { sheen: 'gloss', description: 'globe pendants' });
    const amber = M('lighting_fixture', 'glass', '#C98A3C', { sheen: 'gloss', description: 'amber smoked glass globe pendants' });
    const mp = matchFinish(pale, 'kitchen'), ma = matchFinish(amber, 'kitchen');
    const dp = finishPromise(pale, CATALOG_BY_ID['light-pendant-glass']);
    if (mp.id !== 'light-pendant-glass') fail(`a pale clear pendant (ΔC ${dp.dC.toFixed(1)}) resolved to ${mp.id} — the room's hue must not cost it its own product`);
    else if (!isCustomMaterialId(ma.id) || (getMaterial(ma.id)?.pbr.transmission ?? 0) < 0.5) fail(`amber glass resolved to ${ma.id} (transmission ${getMaterial(ma.id)?.pbr.transmission})`);
    else ok(`clear glass keeps light-pendant-glass at ΔC ${dp.dC.toFixed(1)}; amber #C98A3C synthesises see-through at ${materialColor(getMaterial(ma.id)!)}`);
    // a smoked pendant keeps its own darkness: the catalog's single clear entry
    // (L 93.8) cannot say whether this is tinted glass or a dark wall behind it
    const smoked = M('lighting_fixture', 'glass', '#5A5048', { sheen: 'gloss', description: 'smoked glass globe pendants' });
    const md = matchFinish(smoked, 'kitchen');
    const drawn = materialColor(getMaterial(md.id)!)!;
    if (!isCustomMaterialId(md.id)) fail(`a pendant ΔL ${colorSplit(smoked.baseColorHex, '#E8EEF2').dL.toFixed(1)} off should synthesise, got ${md.id}`);
    else if (deltaE(drawn, smoked.baseColorHex) > 0.5) fail(`smoked glass ${smoked.baseColorHex} is drawn ${drawn} — a tint the photo reported must not be lit away`);
    else ok(`a smoked pendant #5A5048 is drawn ${drawn}: one clear entry in the slot is not a reading of the room`);
  }

  // --- every mirror family is covered by the rule, and no surface family is
  {
    const mirrors = (['stainless', 'brass', 'nickel', 'bronze', 'black-metal', 'chrome', 'copper', 'glass'] as const).filter((f) => !isMirrorFamily(f));
    const surfaces = (['paint', 'quartz', 'marble', 'hardwood', 'porcelain-tile', 'glass-tile', 'fabric', 'brick'] as const).filter((f) => isMirrorFamily(f));
    if (mirrors.length || surfaces.length) fail(`isMirrorFamily: missing ${mirrors.join(', ')}; wrongly included ${surfaces.join(', ')}`);
    else ok('isMirrorFamily covers every metal plus clear glass, and no diffuse family — glass TILE is grouted, opaque and graded as a surface');
  }
}

// recipes per family reach generators the 3D view can draw
const KNOWN_KINDS = new Set(['slab', 'tile', 'plank', 'siding', 'wood', 'quartz', 'grouted-slab', 'brushed-metal', 'fabric', 'painted-wall']);
for (const row of ROWS) {
  const m = matchFinish(row.obs as FinishObservation, row.room);
  const d = getMaterial(m.id);
  if (d?.pbr.procedural && !KNOWN_KINDS.has(d.pbr.procedural.kind)) fail(`${row.label}: unknown generator kind ${d.pbr.procedural.kind}`);
}
ok('every recipe names a generator runProcedural knows');

// pricing through the inherited group
{
  const spec = defaultKitchen();
  const flooring = matchFinish(O('flooring', 'hardwood', '#2B2320', { pattern: 'plank', sheen: 'matte', moduleIn: { w: 5, h: 48 }, description: 'ebony stained oak plank' }) as FinishObservation, 'kitchen');
  const selections = { ...(spec.materials as unknown as Record<string, string>), island_countertop: a.id, flooring: flooring.id };
  try {
    const est = calculateEstimate(spec, selections, SETTINGS);
    const island = est.lines.find((l) => l.id === 'island-top');
    const floor = est.lines.find((l) => l.id === 'floor');
    if (!island || island.totalHigh <= 0) fail('estimate: island top line missing for custom marble');
    else ok(`estimate: island top priced $${island.totalLow}–${island.totalHigh} via ${def?.group}/${def?.tier}`);
    if (!floor || floor.totalHigh <= 0 || !floor.label.includes(getMaterial(flooring.id)?.name ?? '@@')) fail(`estimate: flooring line wrong for custom plank (${floor?.label})`);
    else ok(`estimate: flooring "${floor.label}" $${floor.totalLow}–${floor.totalHigh}`);
    const shelves = est.lines.find((l) => l.id === 'open-shelves');
    if (!shelves) fail('estimate: open shelving line missing (demo kitchen has a shelf)');
    else ok(`estimate: ${shelves.label} — ${shelves.qty} lf, $${shelves.totalLow}–${shelves.totalHigh}`);
    const wt = est.lines.find((l) => l.id === 'window-treatment');
    if (!wt) fail('estimate: window treatment line missing (demo kitchen has a roman shade)');
    else ok(`estimate: ${wt.label} $${wt.totalLow}–${wt.totalHigh}`);
    if (est.lines.some((l) => /\brugs?\b|\bplants?\b|\bart\b|artwork/i.test(l.label))) fail('estimate: rugs/plants/art must not be priced');
    else ok('estimate: rugs, plants and art are not on the bid');
  } catch (err) {
    fail(`estimate threw: ${(err as Error).message}`);
  }
}

// rebuild from the spec alone
{
  const spec = defaultKitchen();
  spec.detected.finishes = [marble];
  spec.materials.island_countertop = a.id;
  delete CATALOG_BY_ID[a.id];
  if (getMaterial(a.id)) fail('test setup: could not remove custom material from the registry');
  ensureSpecMaterials(spec);
  const again = getMaterial(a.id);
  if (!again) fail('ensureSpecMaterials did not re-register the custom material');
  else if (again.swatch !== '#1E1E20' || again.pbr.procedural?.kind !== 'slab') fail('re-registered custom material differs');
  else ok('ensureSpecMaterials rebuilt the custom material from detected.finishes after the registry lost it');
  const prompt = buildRenderPrompt(spec, spec.materials as unknown as Record<string, string>);
  if (!prompt.includes('#1E1E20')) fail('render prompt does not mention the custom material hex');
  else ok('render prompt carries the custom hex');
  const viewport = buildRenderPrompt(spec, spec.materials as unknown as Record<string, string>, undefined, 'viewport');
  if (!/OPEN SHELVES \(exact count 1\)/.test(viewport) || !/PLANTS \(exact count 2\)/.test(viewport) || !/RUG:/.test(viewport)) fail('viewport prompt lacks décor lines');
  else ok('viewport prompt lists shelves, plants, art, rug and window treatment');
  if (!/open shelf, plant, piece of art, rug/.test(prompt)) fail('photo prompt keep-list does not protect décor');
  else ok('photo prompt keep-list protects shelves, plants, art and rug');
}

// applyFinishObservations (the accuracy pass entry point)
{
  const spec = defaultKitchen();
  const next = applyFinishObservations(spec, [O('cabinets_base', 'paint', '#2F3B4E', { description: 'navy' }) as FinishObservation, O('countertop', 'marble', '#1E1E20', { pattern: 'veined', accentColorHex: '#F0F0F0', sheen: 'polished' }) as FinishObservation]);
  const mats = next.materials as unknown as Record<string, string>;
  if (next === spec || spec.materials.cabinets_base !== 'cab-pure-white') fail('applyFinishObservations mutated or did not copy');
  if (!['cab-hale-navy', 'cab-naval'].includes(mats.cabinets_base)) fail(`applyFinishObservations: cabinets → ${mats.cabinets_base}`);
  if (!isCustomMaterialId(mats.countertop) || !getMaterial(mats.countertop)) fail(`applyFinishObservations: countertop → ${mats.countertop}`);
  if (next.detected.finishes.length !== 2) fail(`applyFinishObservations: finishes merged to ${next.detected.finishes.length}`);
  else ok(`applyFinishObservations: cabinets → ${mats.cabinets_base}, countertop → ${mats.countertop}`);
}

// ---------------------------------------------------------------------------
// 2c. THE VEIN AND THE DIRECTION
//
// The client: "the countertop was not a design it was js white" and "floors
// are facing the wrong way and arent detailed enough". Both are one fault —
// the matcher scored only the BASE colour, so it could not tell a warm-grey
// vein from a gold one, and nothing anywhere carried which way the boards run.
// ---------------------------------------------------------------------------
console.log('\nVEIN AND DIRECTION');

{
  const tanCounter = O('countertop', 'quartz', '#F2F0EB', { pattern: 'veined', accentColorHex: '#D7D1C8', sheen: 'polished', description: 'white quartz with soft warm grey veining, polished' }) as FinishObservation;

  // the reason line has to SHOW the accent, or nobody can tell why a slot moved
  const counter = matchFinish(tanCounter, 'kitchen');
  if (!/accent \d/.test(counter.reason)) fail(`the reason line does not name the accent: ${counter.reason}`);
  else ok(`reason names the accent — ${counter.reason}`);

  // the accessor itself: the vein of a slab, the fleck of a granite (which
  // carries BOTH a vein and a speckleColor), and null for a photo texture
  const wq = CATALOG_BY_ID['ct-white-quartz'], gran = CATALOG_BY_ID['ct-speckled-granite'], oak = CATALOG_BY_ID['wood-white-oak'];
  const accents = [
    ['ct-white-quartz vein', materialAccent(wq, 'veined'), '#DFDDD5'],
    ['ct-speckled-granite fleck', materialAccent(gran, 'speckled'), '#332F2B'],
    ['ct-speckled-granite vein when not speckled', materialAccent(gran, 'veined'), '#4A4844'],
  ] as const;
  for (const [what, got, want] of accents) {
    if (got !== want) fail(`materialAccent ${what}: ${got} (wanted ${want})`);
    else ok(`materialAccent ${what} = ${got}`);
  }
  if (materialAccent(oak) !== '#89735D') fail(`photo veneer grain differs from the measured texture palette: ${materialAccent(oak)}`);
  else ok('photographic white-oak grain is measured from its shipped diffuse map (#89735D)');

  // the whole point: identical whites, opposite veins, opposite answers
  const gold = matchFinish({ ...tanCounter, accentColorHex: '#9A8154', description: 'white quartz with warm gold veining, polished' }, 'kitchen');
  if (counter.id !== 'ct-white-quartz' || gold.id !== 'ct-calacatta-quartz') {
    fail(`the vein must decide: warm grey → ${counter.id}, gold → ${gold.id}`);
  } else {
    const dW = deltaE('#D7D1C8', materialAccent(CATALOG_BY_ID['ct-white-quartz'], 'veined')!);
    const dG = deltaE('#9A8154', materialAccent(CATALOG_BY_ID['ct-calacatta-quartz'], 'veined')!);
    ok(`the same white #F2F0EB splits on its vein: grey → ct-white-quartz (accent ΔE ${dW.toFixed(1)}), gold → ct-calacatta-quartz (accent ΔE ${dG.toFixed(1)})`);
  }

  // an entry whose vein is further off than the client's promise must not be
  // handed over at all — that slot gets the photo's own colours instead
  const shelves = matchFinish(O('countertop', 'marble', '#F1F0EC', { pattern: 'veined', accentColorHex: '#A9A8A6', sheen: 'polished', description: 'white marble with soft grey veining' }) as FinishObservation, 'kitchen');
  const sDef = getMaterial(shelves.id);
  const sAcc = sDef ? materialAccent(sDef, 'veined') : null;
  const sDe = sAcc ? deltaE('#A9A8A6', sAcc) : NaN;
  if (!(sDe <= 12)) fail(`a grey-veined white marble resolved to ${shelves.id}, accent ΔE ${sDe.toFixed(1)} — over the ΔE 12 promise`);
  else ok(`grey-veined white marble → ${shelves.id}, accent ΔE ${sDe.toFixed(1)} (ACCEPTANCE §4 wants <= 12)`);
}

{
  // --- plankRun: the direction is part of the material, and of its id
  const floor = O('flooring', 'hardwood', '#DCC8AF', { pattern: 'plank', accentColorHex: '#C3AA8B', sheen: 'matte', moduleIn: { w: 7, h: 72 }, description: 'wide-plank white oak floor, very light natural finish, matte' }) as FinishObservation;
  const toward = matchFinish({ ...floor, plankRun: 'toward' }, 'kitchen', undefined, 'back');
  const across = matchFinish({ ...floor, plankRun: 'across' }, 'kitchen', undefined, 'back');
  const towardAgain = matchFinish({ ...floor, plankRun: 'toward' }, 'kitchen', undefined, 'back');
  if (toward.id === across.id) fail(`plankRun must change the id: both directions gave ${toward.id}`);
  else if (toward.id !== towardAgain.id) fail(`plankRun ids must be deterministic: ${toward.id} then ${towardAgain.id}`);
  else ok(`plankRun is part of the id: toward → ${toward.id}, across → ${across.id}, and toward twice is the same id`);

  // …and it resolves against the ROOM frame, not the photo's words: facing a
  // side wall, "toward" and "across" swap which world axis they mean
  const cases: Array<[string, 'toward' | 'across', 'back' | 'right', boolean]> = [
    ['facing back, toward', 'toward', 'back', false],
    ['facing back, across', 'across', 'back', true],
    ['facing right, toward', 'toward', 'right', true],
    ['facing right, across', 'across', 'right', false],
  ];
  for (const [what, run, wall, wantRot] of cases) {
    const m = matchFinish({ ...floor, plankRun: run }, 'kitchen', undefined, wall);
    const got = getMaterial(m.id)?.pbr.rotate90 === true;
    if (got !== wantRot) fail(`rotate90 ${what}: ${got} (wanted ${wantRot}) on ${m.id}`);
    else ok(`rotate90 ${what} → ${got} (boards along world ${got ? 'X' : 'Z'})`);
  }

  // a floor with no reading keeps the id it always had — the field must not
  // move every custom material that existed before it
  const unread = matchFinish(floor, 'kitchen', undefined, 'back');
  const noCamera = matchFinish(floor, 'kitchen');
  if (unread.id !== noCamera.id) fail(`plankRun null must ignore the camera: ${unread.id} vs ${noCamera.id}`);
  else ok(`plankRun null → one id whatever the camera faced (${unread.id})`);

  // --- the plank SIZE comes from the photo, and the canvas is not square
  const def = getMaterial(unread.id);
  const o = def?.pbr.procedural?.options as { widthM?: number; lengthM?: number } | undefined;
  const wantLen = 72 * 0.0254;
  if (def?.pbr.procedural?.kind !== 'plank') fail(`custom floor is not a plank recipe: ${def?.pbr.procedural?.kind}`);
  else if (Math.abs((o?.lengthM ?? 0) - wantLen) > 0.02) fail(`plank length: ${o?.lengthM} m from a 72 in board (wanted ${wantLen.toFixed(2)})`);
  else if (Math.abs((o?.widthM ?? 0) - 7 * 0.0254) > 0.005) fail(`plank width: ${o?.widthM} m from a 7 in board`);
  else ok(`the photo's board survives into the recipe: ${(o!.widthM! / 0.0254).toFixed(1)} in × ${(o!.lengthM! / 0.0254).toFixed(0)} in`);

  // the drawn tile must be RECTANGULAR and at least two board-lengths down, or
  // every butt joint lands on the same lattice and the floor reads as a grid
  const spans = plankSpans({ widthM: o!.widthM!, lengthM: o!.lengthM! });
  if (!(spans.spanVM >= 2 * o!.lengthM! - 1e-6)) fail(`floor tile repeats every ${spans.spanVM.toFixed(2)} m along the boards — under two ${o!.lengthM!.toFixed(2)} m lengths`);
  else if (Math.abs(spans.spanVM - spans.spanM) < 0.2) fail(`floor tile is square (${spans.spanM.toFixed(2)} × ${spans.spanVM.toFixed(2)} m) — that is the lattice the client saw`);
  else ok(`floor tile ${spans.spanM.toFixed(2)} m across × ${spans.spanVM.toFixed(2)} m along (${(spans.spanVM / o!.lengthM!).toFixed(0)} board lengths), not square`);
  // and the OLD square tile is what the client was looking at: six 0.19 m
  // boards is a 1.14 m grid, four repeats across a normal kitchen floor
  const oldSpan = 6 * 0.19;
  ok(`was: ${oldSpan.toFixed(2)} m × ${oldSpan.toFixed(2)} m (a ${(4.58 / oldSpan).toFixed(1)} × ${(3.99 / oldSpan).toFixed(1)} lattice on a 4.58 × 3.99 m floor)`);
}

// ---------------------------------------------------------------------------
// 2b. Review hardening: healing, unification, hygiene, caps
// ---------------------------------------------------------------------------
console.log('\nREVIEW HARDENING');

// #1 dangling custom ids heal, selections and the estimate follow
{
  const spec = defaultKitchen();
  spec.detected.finishes = [marble];
  spec.materials.island_countertop = 'custom-island_countertop-deadbeef';
  spec.materials.backsplash = 'custom-backsplash-00000000'; // no observation → room default
  const selections = { ...(spec.materials as unknown as Record<string, string>), cabinets_base: 'cab-hale-navy' };
  const { remap, notes } = ensureSpecMaterials(spec);
  if (spec.materials.island_countertop !== a.id) fail(`#1 stale island id not healed: ${spec.materials.island_countertop} (${notes.join(' / ')})`);
  else ok(`#1 stale custom id healed from its observation → ${a.id}`);
  if (spec.materials.backsplash !== 'tile-subway-white') fail(`#1 dangling id without an observation should fall back to the default, got ${spec.materials.backsplash}`);
  else ok('#1 dangling custom id with no observation → room default (tile-subway-white)');
  if (remap['custom-island_countertop-deadbeef'] !== a.id || remap['custom-backsplash-00000000'] !== 'tile-subway-white') fail(`#1 remap incomplete: ${JSON.stringify(remap)}`);
  else ok(`#1 remap returned: ${Object.keys(remap).length} ids`);
  const healed = healSelections(selections, spec, remap);
  if (healed.island_countertop !== a.id || healed.backsplash !== 'tile-subway-white' || healed.cabinets_base !== 'cab-hale-navy') fail(`#1 healSelections: ${JSON.stringify(healed)}`);
  else ok('#1 healSelections follows the remap and keeps the user\'s other choices');
  const stray = healSelections({ ...healed, countertop: 'custom-countertop-ffffffff' }, spec, {});
  if (stray.countertop !== spec.materials.countertop) fail(`#1 healSelections: unregistered custom selection should fall back to spec.materials, got ${stray.countertop}`);
  else ok(`#1 healSelections: an unregistered custom selection falls back to spec.materials.countertop (${stray.countertop})`);
  if (healSelections(healed, spec, {}) !== healed) fail('#1 healSelections must return the same object when nothing changes');
  const again = ensureSpecMaterials(spec);
  if (Object.keys(again.remap).length) fail(`#1 ensureSpecMaterials is not idempotent: ${JSON.stringify(again.remap)}`);
  else ok('#1 second pass is a no-op');
  // the estimator never drops a line over an unresolvable selection
  const est = calculateEstimate(spec, { ...(spec.materials as unknown as Record<string, string>), countertop: 'custom-countertop-ffffffff', flooring: 'custom-flooring-ffffffff' }, SETTINGS);
  const ct = est.lines.find((l) => l.id === 'counter'), fl = est.lines.find((l) => l.id === 'floor');
  if (!ct || ct.totalHigh <= 0 || !fl || fl.totalHigh <= 0) fail(`#1 estimator dropped lines for unresolvable selections (countertop ${ct?.totalHigh}, floor ${fl?.totalHigh})`);
  else ok(`#1 estimator prices unresolvable selections at the room default ("${ct.label}", "${fl.label}")`);
}

// #13 sibling slots read from one surface get one id
{
  const spec = defaultKitchen();
  spec.cabinets.twoTone = true;
  spec.materials.cabinets_base = 'wood-grey-oak';
  spec.materials.cabinets_upper = 'wood-washed-oak';
  spec.detected.finishes = [
    O('cabinets_base', 'stained-wood', '#B0A899', { pattern: 'wood-grain', description: 'white oak cabinets' }) as FinishObservation,
    O('cabinets_upper', 'stained-wood', '#BDB5A8', { pattern: 'wood-grain', description: 'white oak uppers' }) as FinishObservation,
    O('countertop', 'quartz', '#F4F3EE', { sheen: 'polished', description: 'white quartz' }) as FinishObservation,
  ];
  const u = unifyRelatedSlots(spec);
  const m = u.spec.materials as unknown as Record<string, string>;
  if (m.cabinets_base !== m.cabinets_upper) fail(`#13 cabinets not unified: ${m.cabinets_base} / ${m.cabinets_upper}`);
  else if ((u.spec as KitchenSpec).cabinets.twoTone) fail('#13 unified cabinets must clear twoTone');
  else ok(`#13 cabinets_base/cabinets_upper → ${m.cabinets_base} (${u.notes[0]})`);
  const target = ['#B0A899', '#BDB5A8'];
  const chosen = materialColor(getMaterial(m.cabinets_base)!)!;
  const other = materialColor(getMaterial(m.cabinets_base === 'wood-grey-oak' ? 'wood-washed-oak' : 'wood-grey-oak')!)!;
  const avg = (c: string) => (deltaE(target[0], c) + deltaE(target[1], c)) / 2;
  if (avg(chosen) > avg(other) + 0.01) fail(`#13 kept ${m.cabinets_base} but the other id is closer to the readings`);
  else ok('#13 the id kept is the one closest to the average of both readings');
  if (m.island_countertop !== m.countertop) fail(`#13 island top should follow the counters when only the counters were observed: ${m.island_countertop} vs ${m.countertop}`);
  else ok(`#13 island_countertop follows countertop (${m.countertop}) when the island was not observed`);
  if (spec.materials.cabinets_upper !== 'wood-washed-oak') fail('#13 unifyRelatedSlots mutated its input');
  if (u.remap['wood-washed-oak'] !== m.cabinets_base) fail(`#13 remap should carry the dropped id: ${JSON.stringify(u.remap)}`);
  // demo template: no observations, two-tone by design → untouched
  const demo = unifyRelatedSlots(defaultKitchen());
  if (demo.notes.length) fail(`#13 demo kitchen must keep its two-tone island: ${demo.notes.join(' / ')}`);
  else ok('#13 a two-tone spec with no observations is left alone');
  // twoTone false unifies even without observations
  const plain = defaultKitchen();
  plain.cabinets.twoTone = false;
  plain.materials.cabinets_upper = 'cab-alabaster';
  const p = unifyRelatedSlots(plain).spec.materials as unknown as Record<string, string>;
  if (p.cabinets_upper !== p.cabinets_base) fail('#13 twoTone=false must unify cabinets');
  else ok('#13 twoTone=false unifies cabinets to the base id');
  // different readings stay two-tone
  const two = defaultKitchen();
  two.cabinets.twoTone = true;
  two.materials.cabinets_base = 'cab-hale-navy';
  two.materials.cabinets_upper = 'cab-pure-white';
  two.detected.finishes = [O('cabinets_base', 'paint', '#40495A') as FinishObservation, O('cabinets_upper', 'paint', '#F4F3EE') as FinishObservation];
  if (unifyRelatedSlots(two).notes.length) fail('#13 navy bases + white uppers must stay two-tone');
  else ok('#13 genuinely two-tone readings stay two-tone');
  // the unified custom id survives the next ensureSpecMaterials pass
  const cust = defaultKitchen();
  cust.cabinets.twoTone = true;
  cust.detected.finishes = [
    O('cabinets_base', 'stained-wood', '#2E6B6B', { pattern: 'wood-grain', description: 'teal stained oak' }) as FinishObservation,
    O('cabinets_upper', 'stained-wood', '#2F6C6A', { pattern: 'wood-grain', description: 'teal stained oak' }) as FinishObservation,
  ];
  const custApplied = applyFinishObservations(cust, cust.detected.finishes) as KitchenSpec;
  const first = { ...custApplied.materials };
  const r1 = ensureSpecMaterials(custApplied);
  if (custApplied.materials.cabinets_base !== custApplied.materials.cabinets_upper || !isCustomMaterialId(custApplied.materials.cabinets_base)) fail(`#13 custom cabinets not unified: ${custApplied.materials.cabinets_base} / ${custApplied.materials.cabinets_upper}`);
  else if (first.cabinets_upper !== custApplied.materials.cabinets_upper || Object.keys(r1.remap).length) fail(`#13 ensureSpecMaterials fought the unification: ${JSON.stringify(r1.remap)}`);
  else ok(`#13 a unified custom id is stable across ensureSpecMaterials (${custApplied.materials.cabinets_base})`);
}

// #14 tall units: their own slot, following the bases unless a reading says otherwise
{
  const oak = (slot: string, hex: string) => O(slot, 'stained-wood', hex, { pattern: 'wood-grain', description: 'light oak cabinets' }) as FinishObservation;
  const white = (slot: string) => O(slot, 'paint', '#F3F1EA', { sheen: 'satin', description: 'white painted' }) as FinishObservation;
  const isObservedWhite = (id: string) => {
    const def = getMaterial(id);
    const color = def && materialColor(def);
    return def?.category === 'paint' && !!color && deltaE(color, '#F3F1EA') <= 1;
  };
  // What these rows are actually about is that the oak reading resolves to a
  // WOOD and the white one does not — not which named veneer wins. Since the
  // texture colours were measured, a light oak like #D8C3A0 has nothing in the
  // catalog within the promised ΔE 8 and synthesises `custom-…` on the wood
  // recipe, which is a correct answer to this question and unrepresentable as
  // a list of ids. Asking the resolved material's CATEGORY is the stronger
  // test: it holds for a named veneer and for a synthesised one alike.
  const isWood = (id: string) => getMaterial(id)?.category === 'wood';
  // the client's photo: white-painted fridge surround and pantry beside light-oak bases AND uppers
  {
    const spec = defaultKitchen();
    spec.cabinets.twoTone = false;
    spec.detected.finishes = [oak('cabinets_base', '#D8C3A0'), oak('cabinets_upper', '#DCC7A6'), white('cabinets_tall')];
    const fixes: string[] = [];
    const out = reconcileSpec(spec, { photoCount: 1, fixes }) as KitchenSpec;
    const m = out.materials;
    if (!isObservedWhite(m.cabinets_tall)) fail(`#14 white surround beside oak: cabinets_tall → ${m.cabinets_tall}`);
    else if (!isWood(m.cabinets_base) || m.cabinets_base !== m.cabinets_upper) fail(`#14 white surround beside oak: bases ${m.cabinets_base} (wood? ${isWood(m.cabinets_base)}) / uppers ${m.cabinets_upper}`);
    else if (out.cabinets.twoTone) fail('#14 white surround beside oak: one-colour perimeter must not read as two-tone');
    else ok(`#14 white surround beside oak: cabinets_tall ${m.cabinets_tall}, bases and uppers ${m.cabinets_base}, not two-tone`);
    // nothing downstream merges the talls into the bases
    const u = unifyRelatedSlots(out);
    const e = ensureSpecMaterials(out);
    if ((u.spec.materials as unknown as Record<string, string>).cabinets_tall !== m.cabinets_tall || out.materials.cabinets_tall !== m.cabinets_tall) fail(`#14 unify merged the white surround into the oak (${u.notes.join(' / ')} ${e.notes.join(' / ')})`);
    else ok('#14 unifyRelatedSlots / ensureSpecMaterials leave the white surround alone');
    // the render prompt names the tall units on their own line
    const prompt = buildRenderPrompt(out, out.materials as unknown as Record<string, string>);
    if (!/Tall Cabinets: .*pantry and fridge surround/.test(prompt)) fail('#14 render prompt has no tall-cabinet line');
    else ok('#14 render prompt carries a Tall Cabinets line');
  }
  // no reading on the talls: they follow the base cabinets, whatever the model picked
  {
    const spec = defaultKitchen();
    spec.cabinets.twoTone = false;
    spec.materials.cabinets_tall = 'cab-hale-navy';
    spec.detected.finishes = [oak('cabinets_base', '#D8C3A0')];
    const fixes: string[] = [];
    const out = reconcileSpec(spec, { photoCount: 1, fixes }) as KitchenSpec;
    if (out.materials.cabinets_tall !== out.materials.cabinets_base || !isWood(out.materials.cabinets_base)) fail(`#14 no tall reading: cabinets_tall ${out.materials.cabinets_tall} vs base ${out.materials.cabinets_base} (wood? ${isWood(out.materials.cabinets_base)})`);
    else if (!fixes.some((f) => /cabinets_tall: no finish observed/.test(f))) fail('#14 no tall reading: no note written');
    else ok(`#14 no tall reading: cabinets_tall follows the bases (${out.materials.cabinets_tall})`);
  }
  // two-tone with lighter uppers: the talls are painted with the uppers
  {
    const spec = defaultKitchen();
    spec.cabinets.twoTone = true;
    spec.detected.finishes = [O('cabinets_base', 'paint', '#2F3B4E', { description: 'navy bases' }) as FinishObservation, white('cabinets_upper')];
    const out = reconcileSpec(spec, { photoCount: 1, fixes: [] }) as KitchenSpec;
    if (out.materials.cabinets_tall !== out.materials.cabinets_upper || !isObservedWhite(out.materials.cabinets_upper) || !out.cabinets.twoTone) fail(`#14 navy bases / white uppers: cabinets_tall ${out.materials.cabinets_tall}, uppers ${out.materials.cabinets_upper}, twoTone ${out.cabinets.twoTone}`);
    else ok(`#14 navy bases / white uppers: talls follow the lighter uppers (${out.materials.cabinets_tall})`);
  }
  // twoTone=false from the model, but the readings clearly differ: the readings win
  {
    const spec = defaultKitchen();
    spec.cabinets.twoTone = false;
    spec.materials.cabinets_base = 'cab-hale-navy';
    spec.materials.cabinets_upper = 'cab-pure-white';
    spec.detected.finishes = [O('cabinets_base', 'paint', '#40495A') as FinishObservation, O('cabinets_upper', 'paint', '#F4F3EE') as FinishObservation];
    if (unifyRelatedSlots(spec).notes.length) fail('#14 navy bases + white uppers must stay two-tone even when the model said twoTone=false');
    else {
      const out = reconcileSpec(spec, { photoCount: 1, fixes: [] }) as KitchenSpec;
      if (!out.cabinets.twoTone || out.materials.cabinets_base === out.materials.cabinets_upper) fail(`#14 reconcile collapsed navy/white: ${out.materials.cabinets_base} / ${out.materials.cabinets_upper}`);
      else ok('#14 two clearly different readings outrank a twoTone=false flag');
    }
  }
  // two noisy readings of one oak unify, and the talls that were only following the dropped id move with them
  {
    const spec = defaultKitchen();
    spec.cabinets.twoTone = true;
    spec.materials.cabinets_base = 'wood-grey-oak';
    spec.materials.cabinets_upper = 'wood-washed-oak';
    spec.materials.cabinets_tall = 'wood-washed-oak';
    spec.detected.finishes = [oak('cabinets_base', '#B0A899'), oak('cabinets_upper', '#BDB5A8')];
    const u = unifyRelatedSlots(spec);
    const m = u.spec.materials as unknown as Record<string, string>;
    if (m.cabinets_tall !== m.cabinets_base || m.cabinets_base !== m.cabinets_upper) fail(`#14 unify: tall ${m.cabinets_tall} did not follow the unified cabinets ${m.cabinets_base}/${m.cabinets_upper}`);
    else ok(`#14 unify: unobserved talls follow the unified cabinets (${m.cabinets_tall})`);
    // a third reading of the same oak on the pantry joins them too
    spec.detected.finishes.push(oak('cabinets_tall', '#B6AD9E'));
    spec.materials.cabinets_tall = 'wood-natural-oak';
    const u2 = unifyRelatedSlots(spec);
    const m2 = u2.spec.materials as unknown as Record<string, string>;
    if (m2.cabinets_tall !== m2.cabinets_base) fail(`#14 unify: a same-oak pantry reading stayed a third finish (${m2.cabinets_tall} vs ${m2.cabinets_base}; ${u2.notes.join(' / ')})`);
    else ok(`#14 unify: a same-family reading within ΔE 8 joins the cabinets (${u2.notes.find((n) => n.startsWith('cabinets_tall'))})`);
  }
  // a kitchen saved before the slot existed: healed to follow the bases, selections filled in
  {
    const spec = defaultKitchen();
    spec.cabinets.twoTone = true;
    spec.materials.cabinets_base = 'cab-hale-navy';
    spec.materials.cabinets_upper = 'cab-hale-navy';
    delete (spec.materials as unknown as Record<string, string>).cabinets_tall;
    const r = ensureSpecMaterials(spec);
    const healed = healSelections({ cabinets_base: 'cab-hale-navy', countertop: 'ct-white-quartz' }, spec, r.remap);
    if (spec.materials.cabinets_tall !== 'cab-hale-navy') fail(`#14 legacy spec: cabinets_tall → ${spec.materials.cabinets_tall}`);
    else if (healed.cabinets_tall !== 'cab-hale-navy' || healed.cabinets_upper !== 'cab-hale-navy' || healed.cabinets_base !== 'cab-hale-navy') fail(`#14 legacy selections: ${JSON.stringify(healed)}`);
    else ok(`#14 legacy spec + selections: cabinets_tall filled from the bases (${r.notes.find((n) => n.includes('cabinets_tall'))})`);
  }
  // the estimator prices the tall line through the tall slot
  {
    const spec = defaultKitchen();
    const sel = { ...(spec.materials as unknown as Record<string, string>), cabinets_base: 'wood-walnut', cabinets_tall: 'cab-pure-white' };
    const est = calculateEstimate(spec, sel, SETTINGS);
    const line = est.lines.find((l) => l.id === 'cab-tall');
    const walnut = calculateEstimate(spec, { ...sel, cabinets_tall: 'wood-walnut' }, SETTINGS).lines.find((l) => l.id === 'cab-tall');
    if (!line || line.slot !== 'cabinets_tall') fail(`#14 estimator: cab-tall line on slot ${line?.slot}`);
    else if (!walnut || walnut.totalHigh <= line.totalHigh) fail(`#14 estimator: walnut talls (${walnut?.totalHigh}) should cost more than painted (${line.totalHigh})`);
    else ok(`#14 estimator: cab-tall priced through cabinets_tall (painted ${Math.round(line.totalHigh)} < walnut ${Math.round(walnut.totalHigh)})`);
  }
}

// #3 the family decides the pattern where the model was lazy — and only there
{
  const pat = (slot: string, family: FinishObservation['family'], pattern: FinishObservation['pattern']) => normalizeObservation(O(slot, family, '#888888', { pattern }), slot.startsWith('siding') ? 'exterior' : 'kitchen')?.pattern;
  const cases: Array<[string, FinishObservation['family'], FinishObservation['pattern'], FinishObservation['pattern']]> = [
    ['cabinets_base', 'stained-wood', 'solid', 'wood-grain'], ['flooring', 'hardwood', 'other', 'plank'], ['flooring', 'lvp', 'solid', 'plank'], ['countertop', 'butcher-block', 'solid', 'wood-grain'],
    ['cabinets_base', 'paint', 'wood-grain', 'solid'], ['hardware', 'brass', 'subway', 'solid'], ['siding_primary', 'paint', 'lap', 'lap'],
    ['countertop', 'marble', 'solid', 'solid'], ['countertop', 'marble', 'veined', 'veined'], ['backsplash', 'ceramic-tile', 'solid', 'solid'],
  ];
  const wrong = cases.filter(([slot, family, from, to]) => pat(slot, family, from) !== to).map(([slot, family, from, to]) => `${slot}/${family}/${from} → ${pat(slot, family, from)} (wanted ${to})`);
  if (wrong.length) fail(`#3 effective pattern: ${wrong.join('; ')}`);
  else ok(`#3 effective pattern follows the family for wood/paint/metal and is left alone for slab and tile (${cases.length} cases)`);
}

// #6 every catalog entry has a colour the matcher can compare against
{
  const blind = CATALOG.filter((m) => materialColor(m) === null).map((m) => m.id);
  if (blind.length) fail(`#6 entries without a representative colour: ${blind.join(', ')}`);
  else ok(`#6 all ${CATALOG.length} catalog entries have a representative colour`);
  const slate = matchFinish(O('roof', 'shingle', '#908675', { pattern: 'shingle', sheen: 'matte', description: 'slate roof' }) as FinishObservation, 'exterior');
  if (slate.id !== 'roof-slate' && slate.id !== 'roof-slate-red') fail(`#6 slate-coloured roof should reach roof-slate, got ${slate.id} — ${slate.reason}`);
  else ok(`#6 slate roof observation → ${slate.id}`);
}

// #7 module clamps: a sub-millimetre module cannot reach the generators
{
  const tiny = normalizeObservation({ ...O('backsplash', 'ceramic-tile', '#3A4759', { pattern: 'subway', sheen: 'gloss' }), moduleIn: { w: 0.001, h: 0.0004 } }, 'kitchen');
  if (!tiny?.moduleIn || tiny.moduleIn.w < 0.5 || tiny.moduleIn.h < 0.5) fail(`#7 moduleIn not clamped: ${JSON.stringify(tiny?.moduleIn)}`);
  else ok(`#7 moduleIn clamped to ${tiny.moduleIn.w}×${tiny.moduleIn.h} in`);
  const def = customMaterialFor({ ...O('backsplash', 'ceramic-tile', '#1F4E9C', { pattern: 'subway', sheen: 'gloss' }), moduleIn: { w: 0.0001, h: 0.0001 } } as FinishObservation, CATALOG_BY_ID['tile-subway-white']);
  const o = def.pbr.procedural?.options as { tileW?: number; tileH?: number } | undefined;
  if (!o || (o.tileW ?? 0) < 0.01 || (o.tileH ?? 0) < 0.01) fail(`#7 tile recipe module below 1 cm: ${JSON.stringify(o)}`);
  else ok(`#7 tile recipe never goes below 1 cm (${o.tileW} × ${o.tileH} m)`);
}

// #8 a family the slot cannot be: custom on the nearest recipe, and the reason says so
{
  const m = matchFinish(O('cabinets_base', 'fabric', '#7A8C6E', { description: 'sage cabinets' }) as FinishObservation, 'kitchen');
  const d = getMaterial(m.id);
  if (!isCustomMaterialId(m.id) || !d || !/no fabric entries/.test(m.reason) || d.group !== 'cabinet-paint' && d.group !== 'cabinet-wood') fail(`#8 fabric cabinets → ${m.id} (${d?.group}) — ${m.reason}`);
  else ok(`#8 fabric cabinets → custom ${d.name} on ${d.group} — "${m.reason}"`);
}

// #9 raw input and its normalised copy land on the same id
{
  const raw = { slot: ' Cabinets-Base ', family: 'paint', baseColorHex: 'c4552d', accentColorHex: null, pattern: 'solid', sheen: 'satin', moduleIn: null, groutColorHex: null, description: 'burnt  orange painted cabinets ', visibility: 'clear' } as unknown as FinishObservation;
  const norm = normalizeObservation(raw, 'kitchen')!;
  const r1 = matchFinish(raw, 'kitchen'), r2 = matchFinish(norm, 'kitchen');
  if (r1.id !== r2.id || !isCustomMaterialId(r1.id) || !r1.id.startsWith('custom-cabinets_base-')) fail(`#9 raw vs normalised: ${r1.id} / ${r2.id}`);
  else ok(`#9 raw observation and its normalised copy → ${r1.id}`);
  const spec = defaultKitchen();
  const next = applyFinishObservations(spec, [raw]);
  const finishes = next.detected.finishes;
  if (finishes.filter((f) => f.slot === 'cabinets_base').length !== 1 || (next.materials as unknown as Record<string, string>).cabinets_base !== r1.id) fail(`#9 applyFinishObservations keyed by raw slot: ${JSON.stringify(finishes.map((f) => f.slot))}`);
  else ok('#9 applyFinishObservations keys by the normalised slot');
  const junk = matchFinish({ slot: 'nope', baseColorHex: '#FFFFFF' } as unknown as FinishObservation, 'kitchen');
  if (junk.custom || !/no usable slot/.test(junk.reason)) fail(`#9 unusable observation should not match: ${junk.reason}`);
  else ok('#9 an unusable observation returns a reason, not a material');
}

// #10 runtime registry and match cache are bounded
{
  const before = runtimeMaterials().length;
  const base = CATALOG_BY_ID['cab-pure-white'];
  for (let i = 0; i < RUNTIME_MATERIAL_LIMIT + 50; i++) registerMaterial({ ...base, id: `custom-walls-cap${i.toString(16).padStart(6, '0')}` });
  if (runtimeMaterials().length > RUNTIME_MATERIAL_LIMIT) fail(`#10 runtime registry grew to ${runtimeMaterials().length}`);
  else ok(`#10 runtime registry capped at ${RUNTIME_MATERIAL_LIMIT} (was ${before}, ${RUNTIME_MATERIAL_LIMIT + 50} registered)`);
  if (getMaterial('custom-walls-cap000000')) fail('#10 the oldest runtime material should have been evicted');
  else ok('#10 oldest runtime material evicted first');
  // an evicted id referenced by a spec is rebuilt on the next entry-point pass
  const spec = defaultKitchen();
  spec.detected.finishes = [marble];
  spec.materials.island_countertop = a.id;
  ensureSpecMaterials(spec);
  if (!getMaterial(a.id) || spec.materials.island_countertop !== a.id) fail(`#10 evicted custom material not rebuilt: ${spec.materials.island_countertop}`);
  else ok('#10 an evicted custom material comes back on ensureSpecMaterials with the same id');
  for (let i = 0; i < 2100; i++) matchFinish(O('walls', 'paint', `#${(0x400000 + i * 977).toString(16).padStart(6, '0').slice(0, 6)}`, { sheen: 'matte' }) as FinishObservation, 'kitchen');
  if (matchCacheSize() > 2000) fail(`#10 match cache grew to ${matchCacheSize()}`);
  else ok(`#10 match cache bounded at ${matchCacheSize()} entries after 2100 distinct observations`);
}

// ---------------------------------------------------------------------------
// 3. Pipeline: reconcile, décor clamps, schema, sanitize
// ---------------------------------------------------------------------------
console.log('\nPIPELINE');
{
  const spec = defaultKitchen();
  spec.materials.flooring = 'floor-white-oak-plank';
  spec.detected.finishes = [
    O('flooring', 'hardwood', '#2B2320', { pattern: 'plank', sheen: 'matte', moduleIn: { w: 5, h: 48 }, description: 'ebony stained oak plank' }) as FinishObservation,
    { ...O('backsplash', 'ceramic-tile', 'f3f2ee', { pattern: 'subway', sheen: 'gloss', moduleIn: { w: 6, h: 3 } }), baseColorHex: 'f3f2ee' } as FinishObservation,
    { slot: 'nope', family: 'paint', baseColorHex: '#FFFFFF' } as unknown as FinishObservation,
  ];
  spec.decor = {
    shelves: [{ wall: 'left', t: 0.02, widthIn: 240, count: 9, bottomFt: 12, depthIn: 30, spacingIn: 14, material: 'wood', styled: 'dishes' }],
    plants: Array.from({ length: 12 }, () => ({ kind: 'floor' as const, wall: 'corner' as const, t: 0, sizeFt: 30, form: 'tree' as const })),
    art: [{ wall: 'back', t: 0.5, widthIn: 24, heightIn: 30, centerFt: 12, frame: 'black' }],
    rug: { present: true, lengthFt: 40, widthFt: 30, style: 'area' },
    windowTreatment: 'curtains',
    counterStyling: 'minimal', stools: null,
    items: [], cabinetContents: [],
  };
  (spec.runs[1] as unknown as { backsplash?: boolean }).backsplash = undefined;
  const fixes: string[] = [];
  const out = reconcileSpec(spec, { photoCount: 1, fixes }) as KitchenSpec;
  if (!isCustomMaterialId(out.materials.flooring)) fail(`reconcile: flooring should be custom, got ${out.materials.flooring}`);
  else ok(`reconcile: flooring → ${out.materials.flooring}`);
  if (out.materials.backsplash !== 'tile-subway-white') fail(`reconcile: backsplash from a bare-hex observation → ${out.materials.backsplash}`);
  else ok('reconcile: a hex without "#" is repaired and still matches tile-subway-white');
  if (out.detected.finishes.length !== 2 || out.detected.finishes[1].baseColorHex !== '#F3F2EE') fail(`reconcile: finishes not cleaned (${JSON.stringify(out.detected.finishes.map((f) => [f.slot, f.baseColorHex]))})`);
  else ok('reconcile: invalid observation dropped, hex canonicalised');
  const customNote = fixes.find((f) => /flooring: no catalog match/.test(f));
  if (!customNote) fail(`reconcile: no custom-material note in fixes (${fixes.filter((f) => /flooring/.test(f)).join(' / ')})`);
  else ok(`reconcile note: "${customNote}"`);
  const sh = out.decor.shelves[0];
  if (out.decor.shelves.length !== 1 || sh.widthIn > out.dims.depthFt * 12 || sh.count > 5 || sh.bottomFt + ((sh.count - 1) * sh.spacingIn) / 12 > out.dims.ceilingFt || sh.t - sh.widthIn / 24 / out.dims.depthFt < -0.001 || sh.depthIn > 16) fail(`reconcile décor: shelf not clamped ${JSON.stringify(sh)}`);
  else ok(`reconcile décor: shelf clamped to ${sh.widthIn}" × ${sh.count} boards, bottom ${sh.bottomFt} ft, t ${sh.t.toFixed(2)}`);
  if (out.decor.plants.length !== 8 || out.decor.plants.some((p) => p.sizeFt > out.dims.ceilingFt)) fail(`reconcile décor: plants ${out.decor.plants.length}, max ${Math.max(...out.decor.plants.map((p) => p.sizeFt))} ft`);
  else ok(`reconcile décor: plants capped at 8, tallest ${Math.max(...out.decor.plants.map((p) => p.sizeFt))} ft`);
  const art = out.decor.art[0];
  if (art.centerFt + art.heightIn / 24 > out.dims.ceilingFt) fail(`reconcile décor: art above the ceiling (${art.centerFt} ft)`);
  else ok(`reconcile décor: art centred at ${art.centerFt} ft inside a ${out.dims.ceilingFt} ft wall`);
  if (!out.decor.rug || out.decor.rug.lengthFt > Math.max(out.dims.widthFt, out.dims.depthFt) || out.decor.rug.widthFt > Math.min(out.dims.widthFt, out.dims.depthFt)) fail(`reconcile décor: rug ${JSON.stringify(out.decor.rug)}`);
  else ok(`reconcile décor: rug ${out.decor.rug.lengthFt}×${out.decor.rug.widthFt} ft fits the room`);
  if (out.runs.some((r) => typeof r.backsplash !== 'boolean') || out.runs[1].backsplash !== true) fail('reconcile: missing per-run backsplash did not default to true');
  else ok('reconcile: per-run backsplash defaults to true when missing');
  const parsed = RoomSpecZ.safeParse(out);
  if (!parsed.success) fail(`reconcile output fails schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  else ok('reconcile output validates against RoomSpecZ');

  const bath = defaultBathroom();
  bath.decor.windowTreatment = 'roller';
  bath.openings = bath.openings.filter((o) => o.kind !== 'window');
  const bfix: string[] = [];
  const bout = reconcileSpec(bath, { photoCount: 1, fixes: bfix });
  if (bout.roomType !== 'bathroom' || bout.decor.windowTreatment !== 'none') fail('reconcile: window treatment kept with no window');
  else ok('reconcile: window treatment dropped when the room has no window');
}

// strict schema still carries decor + finishes, with property names intact
{
  const schema = jsonSchemaFor('kitchen') as { properties: Record<string, { properties?: Record<string, unknown>; items?: { properties?: Record<string, unknown> } }>; required: string[] };
  const decor = schema.properties.decor;
  const finishes = schema.properties.detected?.properties?.finishes as { items?: { properties?: Record<string, unknown>; required?: string[] } } | undefined;
  if (!decor?.properties || !['shelves', 'plants', 'art', 'rug', 'windowTreatment', 'counterStyling', 'items', 'cabinetContents'].every((k) => k in decor.properties!)) fail('schema: decor missing keys');
  else ok('schema: decor carries shelves/plants/art/rug/windowTreatment/counterStyling/items/cabinetContents');
  const fprops = finishes?.items?.properties ?? {};
  if (!['slot', 'family', 'baseColorHex', 'accentColorHex', 'pattern', 'sheen', 'moduleIn', 'groutColorHex', 'description', 'visibility', 'plankRun'].every((k) => k in fprops)) fail(`schema: finishes item missing keys (${Object.keys(fprops).join(',')})`);
  else ok('schema: finishes item keeps the "pattern" property (name not stripped by the strict pass)');
  // every property, whatever the count — the point is that strict mode requires
  // all of them, not that an observation has exactly ten fields
  if ((finishes?.items?.required ?? []).length !== Object.keys(fprops).length) fail('schema: finishes item does not require every key');
  else ok('schema: every finishes key required (strict mode)');
  const text = JSON.stringify(schema);
  if (/"minimum"|"maximum"|"format":/.test(text)) fail('schema: strict pass left min/max/format keywords');
  else ok('schema: no min/max/format keywords remain');
  const mats = schema.properties.materials as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (!mats?.properties || !('cabinets_tall' in mats.properties) || !(mats.required ?? []).includes('cabinets_tall')) fail('schema: materials.cabinets_tall missing or not required');
  else ok('schema: materials.cabinets_tall present and required');
}

// sanitize repairs a model answer that omitted decor and finishes
{
  const raw = JSON.parse(JSON.stringify(defaultKitchen())) as Record<string, unknown>;
  delete raw.decor;
  delete (raw.detected as Record<string, unknown>).finishes;
  (raw.runs as Array<Record<string, unknown>>).forEach((r) => { delete r.backsplash; });
  const template = defaultKitchen();
  template.decor = emptyDecor();
  template.detected.finishes = [];
  const report = { fixes: [] as string[] };
  const shaped = sanitizeShape(raw, 'kitchen', template, report) as KitchenSpec;
  const parsed = RoomSpecZ.safeParse(shaped);
  if (!parsed.success) fail(`sanitize: repaired spec invalid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  else ok('sanitize: a response without decor/finishes/run.backsplash repairs to a valid spec');
  const d = shaped.decor as DecorSpec;
  if (d.shelves.length !== 0 || d.plants.length !== 0 || d.rug !== null) fail('sanitize: fallback décor leaked showroom shelves/plants into a repaired response');
  else ok('sanitize: missing décor becomes EMPTY décor, not the demo kitchen\'s');
  if (shaped.detected.finishes.length !== 0) fail('sanitize: fallback finishes not empty');
  // a model that predates the tall slot leaves materials.cabinets_tall out: the fallback fills it
  const noTall = JSON.parse(JSON.stringify(defaultKitchen())) as { materials: Record<string, string> };
  delete noTall.materials.cabinets_tall;
  const tallReport = { fixes: [] as string[] };
  const shapedTall = sanitizeShape(noTall, 'kitchen', template, tallReport) as KitchenSpec;
  if (shapedTall.materials.cabinets_tall !== template.materials.cabinets_tall || !tallReport.fixes.some((f) => /materials\.cabinets_tall/.test(f))) fail(`sanitize: missing cabinets_tall → ${shapedTall.materials.cabinets_tall} (${tallReport.fixes.filter((f) => /cabinets_tall/.test(f)).join(' / ')})`);
  else ok(`sanitize: missing materials.cabinets_tall filled from the fallback (${shapedTall.materials.cabinets_tall})`);
}

// model-written free text is the one shape error nothing downstream can repair:
// reconcile only runs on a spec that already PARSED, so a 41-char decor label or
// a colour written as 'rgb(200, 60, 60)' has to be clamped inside sanitizeShape
{
  const template = defaultKitchen();
  template.decor = emptyDecor();
  const raw = JSON.parse(JSON.stringify(defaultKitchen())) as Record<string, unknown>;
  const long = 'large blue enamel cast-iron dutch oven with lid';   // 46 chars
  (raw.decor as Record<string, unknown>).items = [
    { kind: 'dutch-oven', label: long, on: 'range', wall: 'back', t: 0.6, depthT: null, shelfIndex: null, burner: 'left-front', sizeIn: 13, colorHex: 'rgb(200, 60, 60)', material: 'enamel', count: 1 },
    { kind: 'pot', label: 'pot', on: 'counter', wall: 'back', t: 0.2, depthT: null, shelfIndex: null, burner: null, sizeIn: 10, colorHex: '#c0392b (red)', material: 'stainless', count: 1 },
  ];
  const finish = (raw.detected as { finishes: Array<Record<string, unknown>> }).finishes;
  finish.push({ slot: 'flooring', family: 'hardwood', baseColorHex: 'rgb(184, 131, 74)', accentColorHex: null, pattern: 'plank', sheen: 'satin', moduleIn: null, groutColorHex: null, description: 'oak plank', visibility: 'clear' });
  const report = { fixes: [] as string[] };
  const shaped = sanitizeShape(raw, 'kitchen', template, report) as KitchenSpec;
  const parsed = RoomSpecZ.safeParse(shaped);
  if (!parsed.success) fail(`sanitize: over-long label / rgb() colour still fails RoomSpecZ: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  else ok('sanitize: a 46-char label and rgb()/annotated colours repair to a valid spec');
  const items = (shaped.decor as DecorSpec).items ?? [];
  if (items[0]?.label.length !== 40 || !report.fixes.some((f) => /decor\.items\[0\]\.label/.test(f))) fail(`sanitize: label not truncated to 40 (${items[0]?.label.length} chars, fixes: ${report.fixes.filter((f) => /label/.test(f)).join(' / ')})`);
  else ok(`sanitize: label truncated to 40 chars and reported ("${items[0].label}")`);
  // the truncation must not cut a colour mid-value — reconcile's repairHex has
  // to still see a colour, not 'rgb(200, 60,'
  const reconciled = reconcileSpec(shaped, { photoCount: 1, fixes: [] }) as KitchenSpec;
  const colours = (reconciled.decor.items ?? []).map((i) => i.colorHex);
  if (colours[0] !== '#C83C3C' || colours[1] !== '#C0392B') fail(`sanitize: colours mangled by truncation (${colours.join(', ')})`);
  else ok(`sanitize: rgb()/annotated colours survive to repairHex (${colours.join(', ')})`);
}

// the analysis prompt asks for all of it
{
  const p = buildAnalysisPrompt('kitchen', '', 2);
  for (const needle of ['FINISHES', 'NEUTRAL DAYLIGHT', 'accentColorHex', 'moduleIn', 'groutColorHex', 'DÉCOR', 'shelves', 'plants', 'windowTreatment', 'own backsplash boolean', 'full-height', 'PROPORTIONS FIRST', 'ratio:']) {
    if (!p.toLowerCase().includes(needle.toLowerCase())) fail(`analysis prompt lacks "${needle}"`);
  }
  ok(`analysis prompt: ${p.length.toLocaleString()} chars, covers finishes, décor, per-run backsplash and proportions`);
  if (buildAnalysisPrompt('exterior', '', 1).includes('DÉCOR')) fail('exterior prompt should not ask for décor');
  if (parseHex(' "#abc" ') !== '#AABBCC' || parseHex('rgb(255, 0, 0)') !== '#FF0000' || parseHex('nope') !== null) fail('parseHex repair');
  else ok('parseHex repairs #abc / rgb() / quoted input');
}

// ---------------------------------------------------------------------------
// PLANK DIRECTION — the mechanism, on observations that actually carry one
// ---------------------------------------------------------------------------
{
  // `FinishObservation.plankRun` is null on every fixture we own, so the four
  // fixture rows in check-photo-fidelity exercise NOTHING: client-tan's floor
  // is right only because the recipe's default axis (world z) happens to be the
  // axis its photo shows. This is where the code path is actually driven.
  //
  // The contract: `plankRun` is told in the PHOTO's terms — 'toward' = the
  // joints recede toward the wall `detected.camera.lookingAt` names — and world
  // UVs run a plank's LENGTH along world Z, so an un-rotated plank draws along
  // z. Facing the back (or front) wall, 'toward' IS z and no rotation is
  // needed; facing a side wall the two axes swap.
  const floor = (plankRun: 'toward' | 'across' | 'diagonal' | null): FinishObservation => ({
    slot: 'flooring', family: 'hardwood', baseColorHex: '#DCC8AF', accentColorHex: '#C3AA8B',
    pattern: 'plank', sheen: 'satin', moduleIn: { w: 7, h: 48 }, groutColorHex: null,
    description: 'wide light oak plank floor', visibility: 'clear', plankRun,
  } as FinishObservation);
  const axisOf = (id: string): string => {
    const d = getMaterial(id);
    const kind = d?.pbr.procedural?.kind;
    if (kind !== 'plank' && kind !== 'wood') return `not a plank surface (${kind ?? 'none'})`;
    return d?.pbr.rotate90 ? 'x' : 'z';
  };
  const cases: Array<[('toward' | 'across'), ('back' | 'left'), 'x' | 'z']> = [
    ['toward', 'back', 'z'],   // joints recede to the back wall = world z, no rotation
    ['across', 'back', 'x'],   // joints run parallel to the back wall = world x, rotated
    ['toward', 'left', 'x'],   // facing a side wall, "toward" is world x
    ['across', 'left', 'z'],
  ];
  const ids = new Set<string>();
  for (const [run, lookingAt, want] of cases) {
    const m = matchFinish(floor(run), 'kitchen', undefined, lookingAt);
    ids.add(m.id);
    const got = axisOf(m.id);
    if (got !== want) fail(`plankRun '${run}' facing ${lookingAt}: ${m.id} draws along ${got}, expected ${want}`);
    else ok(`plankRun '${run}' facing the ${lookingAt} wall → ${m.id} draws boards along world ${want} (rotate90 ${getMaterial(m.id)?.pbr.rotate90 ? 'on' : 'off'})`);
  }
  // the two directions must be DIFFERENT materials: the shared cache is keyed
  // by id, so one id cannot carry two orientations
  if (ids.size < 2) fail(`all four plank directions resolved to one material (${[...ids].join(', ')}) — the direction is not reaching the recipe`);
  else ok(`the four directions resolve to ${ids.size} distinct materials, so an id never carries two orientations`);
  // null means "leave the recipe alone" — exactly what the twin drew before
  const nul = matchFinish(floor(null), 'kitchen', undefined, 'back');
  if (axisOf(nul.id) !== 'z') fail(`a null plankRun turned the boards (${nul.id} draws along ${axisOf(nul.id)})`);
  else ok(`a null plankRun leaves the recipe's own orientation (${nul.id} along z)`);
}

// Photographic grain is part of the match, even when the base colour is exact.
// A dark-ring observation cannot pass on the catalog's unmeasured accent.
{
  const veneers = CATALOG.filter((m) => m.id.startsWith('wood-') && m.pbr.texture);
  const missing = veneers.filter((m) => !materialAccent(m, 'wood-grain'));
  if (missing.length) fail(`unmeasured photographic wood grain: ${missing.map((m) => m.id).join(', ')}`);
  else ok(`${veneers.length} photographic veneers have measured grain colours`);
  const nearest = getMaterial('wood-grey-oak')!;
  const obs = O('cabinets_base', 'stained-wood', materialColor(nearest)!, {
    pattern: 'wood-grain', accentColorHex: '#382417', description: 'pale oak with dark brown growth rings',
  }) as FinishObservation;
  const matched = matchFinish(obs, 'kitchen', nearest.id);
  const accent = materialAccent(getMaterial(matched.id)!, obs.pattern);
  if (!accent || deltaE(accent, obs.accentColorHex!) > 12) fail(`wood grain reading lost: ${matched.reason}, accent ${accent}`);
  else ok(`wood grain survives exact-base match: ${matched.id}, accent ΔE ${deltaE(accent, obs.accentColorHex!).toFixed(2)}`);
}

// Live finish QA: these three independently observed greys used to all become
// Sea Salt. Test the full adoption/healing path, including sibling unification.
{
  const readings = [
    O('cabinets_base', 'paint', '#D9D9D3'),
    O('cabinets_upper', 'paint', '#C7C8C2'),
    O('cabinets_tall', 'paint', '#D0D0CA'),
  ] as FinishObservation[];
  for (const twoTone of [false, true]) {
    const before = failures;
    const spec = defaultKitchen();
    spec.cabinets.twoTone = twoTone;
    const next = applyFinishObservations(spec, readings) as KitchenSpec;
    ensureSpecMaterials(next);
    const healed = reconcileSpec(next, { photoCount: 1 }) as KitchenSpec;
    const ids = readings.map((o) => healed.materials[o.slot as keyof KitchenSpec['materials']]);
    if (new Set(ids).size !== 3) fail(`distinct observed paints collapsed after adoption (twoTone=${twoTone}): ${ids.join(', ')}`);
    for (const [i, obs] of readings.entries()) {
      const def = getMaterial(ids[i])!;
      const color = materialColor(def);
      if (!color || deltaE(color, obs.baseColorHex) > 0.01) fail(`${obs.slot}: observed paint ${obs.baseColorHex} recolored to ${color}`);
      if (def.category !== 'paint' || def.group !== 'cabinet-paint' || def.tier !== getMaterial('cab-sea-salt')!.tier) fail(`${obs.slot}: precise pigment lost its paint/pricing group`);
    }
    const first = JSON.stringify(healed.materials);
    ensureSpecMaterials(healed);
    if (JSON.stringify(healed.materials) !== first) fail('observed paint healing drifted on second pass');
    else if (failures === before) ok(`distinct grey paints survive adoption, healing and reconciliation exactly (twoTone=${twoTone})`);
  }
  const exact = matchFinish(O('cabinets_base', 'paint', materialColor(getMaterial('cab-sea-salt')!)!) as FinishObservation, 'kitchen');
  if (exact.id !== 'cab-sea-salt' || exact.custom) fail('an exact palette paint stopped using its catalog entry');
  else ok('an exact paint swatch remains a catalog match');

  const shared = registerMaterial(customMaterialFor(O('cabinets_base', 'paint', '#A5A3A1') as FinishObservation, getMaterial('cab-sea-salt')!));
  const saved = defaultKitchen();
  saved.detected.finishes = readings;
  for (const obs of readings) saved.materials[obs.slot as keyof KitchenSpec['materials']] = shared.id;
  const oldSelections = { ...saved.materials, island_cabinets: shared.id };
  const repair = ensureSpecMaterials(saved);
  const restored = healSelections(oldSelections, saved, repair.remap, repair.slotRemap);
  if (repair.remap[shared.id]) fail('a split shared paint still exposes an ambiguous global id remap');
  if (readings.some((o) => restored[o.slot as keyof typeof restored] !== saved.materials[o.slot as keyof KitchenSpec['materials']])) fail('saved shared paint id collapsed during selection healing');
  else ok('one old shared custom paint restores three slot-specific observed paints');
  if (restored.island_cabinets !== shared.id) fail('manual reuse of the old custom paint in another slot was overwritten');
  const manual = healSelections({ ...oldSelections, cabinets_upper: 'cab-hale-navy' }, saved, repair.remap, repair.slotRemap);
  if (manual.cabinets_upper !== 'cab-hale-navy') fail('slot repair overwrote a newer manual paint choice');
  else ok('scoped paint repair preserves manual choices, including custom paint reused elsewhere');
}

console.log(failures ? `\nFAILED (${failures})\n` : `\nALL MATERIAL CHECKS PASSED (${ROWS.length} observations)\n`);
process.exit(failures ? 1 : 0);
