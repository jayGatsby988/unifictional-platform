/**
 * Colour maths for finish matching — hex parsing/repair, sRGB → CIE Lab, ΔE,
 * and a "representative colour" for any catalog entry.
 *
 * Everything here is pure and DOM-free so the matcher runs identically on the
 * server (analyzer), in the client (store rehydrate) and in the headless
 * check scripts. CIE76 ΔE is deliberate: the observations are model
 * estimates, not spectrophotometer readings, and the finer 2000 formula would
 * only add false precision.
 */
import type { MaterialDef } from './catalog';

// ---------------------------------------------------------------------------
// Hex parsing
// ---------------------------------------------------------------------------

/**
 * Accepts '#RRGGBB', 'RRGGBB', '#RGB', '#RRGGBBAA', 'rgb(r, g, b)', a hex the
 * model annotated ('#c0392b (red)') and the usual typos (spaces, lowercase, a
 * stray quote), and returns a canonical upper-case '#RRGGBB', or null when
 * nothing colour-like is there.
 */
export function parseHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^['"`]+|['"`]+$/g, '').trim();
  if (!s) return null;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const hex = s.replace(/^#/, '').replace(/\s+/g, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${hex.split('').map((c) => c + c).join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return `#${hex.slice(0, 6)}`.toUpperCase();
  // '#c0392b (red)' — the model annotating its own answer. Take the leading
  // hex and drop the commentary rather than losing the photo's colour.
  const lead = /^#?([0-9a-f]{6})(?![0-9a-f])/i.exec(s);
  if (lead) return `#${lead[1]}`.toUpperCase();
  return null;
}

/** parseHex with a fallback so callers never have to branch on null. */
export function repairHex(input: unknown, fallback: string): string {
  return parseHex(input) ?? fallback;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = parseHex(hex) ?? '#808080';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Lab
// ---------------------------------------------------------------------------

export type Lab = [number, number, number];

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

// D65 reference white
const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / XN;
  const y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / YN;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / ZN;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const labCache = new Map<string, Lab>();
export function hexToLab(hex: string): Lab {
  const h = parseHex(hex) ?? '#808080';
  let lab = labCache.get(h);
  if (!lab) {
    lab = rgbToLab(...hexToRgb(h));
    labCache.set(h, lab);
  }
  return lab;
}

/** CIE76 colour difference. ~2 is a just-noticeable difference, ~10 is "a different colour". */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a);
  const [l2, a2, b2] = hexToLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/**
 * The same difference, split into the half a PHOTOGRAPH can attribute to the
 * material and the half it cannot.
 *
 * `dC` is the distance in the a*b* plane — hue and chroma, which is where a
 * metal's identity lives (brass vs nickel vs bronze). `dL` is lightness, which
 * for a mirror-like surface is mostly the brightness of the room it is
 * reflecting rather than anything about the material. `deltaE` is the
 * hypotenuse of the two, so a caller that wants the old single number still
 * gets it — this only lets a caller say WHICH of the two moved.
 *
 * Measured on the four client fixtures, every metal/glass mismatch is pure
 * lightness: four photos of one brushed stainless disagree by 4.5–8.2 dL while
 * agreeing to within 1.9 dC. See match.ts `finishPromise` for what that means
 * for the ΔE-8-or-synthesise promise.
 */
export interface ColorSplit { dE: number; dL: number; dC: number }
export function colorSplit(a: string, b: string): ColorSplit {
  const [l1, a1, b1] = hexToLab(a);
  const [l2, a2, b2] = hexToLab(b);
  const dL = l1 - l2, da = a1 - a2, db = b1 - b2;
  const dC = Math.sqrt(da * da + db * db);
  return { dE: Math.sqrt(dL * dL + dC * dC), dL: Math.abs(dL), dC };
}

/** Perceived lightness 0..100. */
export function lightness(hex: string): number {
  return hexToLab(hex)[0];
}

/** Multiply a colour's channels (0.9 = slightly darker, 1.1 = slightly lighter). */
export function shade(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

/** Linear blend in sRGB — fine for the small nudges the recipes need. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

// ---------------------------------------------------------------------------
// Representative colour of a catalog entry
// ---------------------------------------------------------------------------

/**
 * Average colour of the CC0 textures that ship without a `color` in their
 * recipe. The matcher needs SOME colour for a wood veneer or a stone tile or
 * it could never pick them, and `check-photo-fidelity` grades the client's
 * "same cabinet colour" against the same table, so a wrong entry here is a
 * pass on a pixel that is not the pixel that renders.
 *
 * These are MEASURED, not eyeballed: the mean sRGB of every shipped
 * `public/textures/<id>/diff.webp`, box-filtered to 128×128 (`m.color` is set
 * to white whenever a recipe has no `color`, so for these entries the drawn
 * pixel IS the map). The hand-written values they replaced were off by a mean
 * ΔE of 25 and by more than 8 on 91 of 99 entries — grey_oak_veneer_01 was
 * written #A8A093 and measures #CDB7A3, oak_veneer_01 #C8A878 against #A17E57,
 * white_oak_veneer #D8C3A0 against #907963 — so client-tan's cabinets scored
 * ΔE 6.2 against an observation the rendered pixel is 11.8 away from.
 *
 * Several maps also do not look like their id (painted_brick is a BLUE brick;
 * black_walnut_veneer_01 is a light taupe). That is a catalog fault, not a
 * measurement fault, and the honest thing is for the matcher to see the colour
 * that draws — a "Painted Brick · White" entry that renders blue should stop
 * winning white-brick photos. The mismatched entries are listed by
 * `scripts/check-materials.ts` §texture-truth so they are recorded, not hidden.
 *
 * To redo the measurement after a texture changes, resample every diff.webp
 * and write the means back (the maps are webp, which node cannot decode, so
 * this table is generated offline rather than read at runtime).
 */
const TEXTURE_COLORS: Record<string, string> = {
  white_oak_veneer: '#907963', oak_veneer_01: '#A17E57', grey_oak_veneer_01: '#CDB7A3', washed_grey_oak_veneer: '#CEB7A3',
  mocha_oak_veneer: '#A29888', black_oak_veneer: '#6B6257', american_walnut_veneer: '#736E69', black_walnut_veneer_01: '#AB957E',
  natural_walnut_veneer: '#897E72', cherry_veneer: '#E1B084', ash_veneer: '#AC957D',
  marble_01: '#B19D79', marble_tiles: '#8C8172', marble_mosaic_tiles: '#816D5E', granite_tile: '#4D4F4E', granite_tile_02: '#625041',
  granite_tile_03: '#635A51', granite_tile_04: '#716556', kitchen_wood: '#705D49', oak_wood_planks: '#A27654',
  smooth_concrete_floor: '#553C28', concrete_floor_01: '#766C59', concrete_pavement: '#7F7566', terrazzo_tiles: '#896D57',
  long_white_tiles: '#CEC6B6', square_tiled_wall: '#7E6E60', rounded_square_tiled_wall: '#857765', patterned_slate_tiles: '#3A3734',
  stone_tile_wall: '#AAA5A0', painted_brick: '#789FAA', hexagonal_concrete_paving: '#A99A84', interior_tiles: '#AA9884',
  square_tiles_02: '#504942', slab_tiles: '#3F3A34', stone_tiles_02: '#7A7A72', large_grey_tiles: '#847F72', large_floor_tiles_02: '#757773',
  floor_tiles_06: '#79706B', floor_tiles_02: '#9E917E', grey_tiles: '#6E6049', slate_floor_02: '#6D513A', terracotta_floor_tiles: '#4D271A',
  checkered_pavement_tiles: '#574B3F', tiled_floor_001: '#715C4A',
  plank_flooring: '#715239', plank_flooring_02: '#9A6413', plank_flooring_03: '#7C6952', plank_flooring_04: '#412417',
  laminate_floor: '#957345', laminate_floor_02: '#9B8163', herringbone_parquet: '#93704D', diagonal_parquet: '#A56636',
  rectangular_parquet: '#775C33', dark_wooden_planks: '#534A3E', wood_floor: '#806042',
  painted_plaster_wall: '#ABA3A0', plastered_wall: '#B0A99C', white_rough_plaster: '#B7B5AE', grey_plaster_02: '#8E816C', beige_wall_001: '#9E8D78', ceiling_interior: '#7B6F65',
  white_planks_clean: '#B4A79E', wood_plank_wall: '#42332C', weathered_plank_siding: '#4C3D31', exterior_wall_cladding: '#7B746A',
  exterior_wall_cladding_02: '#5F3A29', exterior_wall_cladding_03: '#ACA89B', box_profile_metal_sheet: '#6A2617', corrugated_iron_02: '#585851',
  red_brick_03: '#6A544B', brick_wall_001: '#644A3C', brick_wall_04: '#6E5943', dark_brick_wall: '#534739', plaster_stone_wall_01: '#9B8972',
  mixed_stone_tiles: '#87755C', sandstone_blocks_04: '#C5A57F', castle_wall_slates: '#8A7E66', white_stucco: '#D7D3D0',
  grey_roof_01: '#575652', roof_09: '#867461', clay_roof_tiles: '#5A331C', red_slate_roof_tiles_01: '#958D66', roof_07: '#6A614E',
  roof_3: '#93754A', roof_tiles: '#AC8E6E', ceramic_roof_01: '#8E7652',
  concrete_pavers: '#675E53', interlocking_concrete_pavers: '#68503B', patterned_concrete_pavers: '#877C6D', stone_pavers: '#64574B',
  gravel_floor_02: '#AAA79B', slate_driveway: '#514D4A', asphalt_01: '#595046', leafy_grass: '#978359', sparse_grass: '#4F3E15',
  grass_path_2: '#8D8163', wood_floor_deck: '#6F340E',
  // texture-only roof entries — without these roof-slate / roof-concrete-tile
  // had no colour at all and could never be matched or unified
  roof_slates_02: '#908675', grey_roof_tiles: '#615C4B',
};

/**
 * Measured grain in the shipped veneer photographs. Mean sRGB of the 5th–20th
 * luminance percentile after a 256px resize; excludes isolated black pores
 * and edge shadows while retaining the dark growth rings. This is image data,
 * not an accent guessed from the product's name or the client's observation.
 */
const TEXTURE_GRAIN: Record<string, string> = {
  white_oak_veneer: '#89735D', oak_veneer_01: '#98744D', grey_oak_veneer_01: '#CAB4A0',
  washed_grey_oak_veneer: '#CBB3A0', mocha_oak_veneer: '#9F9585', black_oak_veneer: '#665E53',
  american_walnut_veneer: '#6E6A65', black_walnut_veneer_01: '#A8927B',
  natural_walnut_veneer: '#7B6E61', cherry_veneer: '#DEAD81', ash_veneer: '#A89179',
};

/**
 * The one colour the matcher compares an observation against. Recipes carry
 * it in several places depending on how the surface is drawn; when none of
 * them has it the entry is scored with a penalty rather than skipped.
 */
export function materialColor(def: MaterialDef): string | null {
  const p = def.pbr.procedural?.options as { base?: unknown; color?: unknown } | undefined;
  // clear glass is tinted white but SEEN as the pale swatch; its pbr colour
  // would put every glass pendant 15 ΔE from the photo
  const seeThrough = (def.pbr.transmission ?? 0) >= 0.5 ? parseHex(def.swatch) : null;
  return (
    seeThrough ?? parseHex(p?.base) ?? parseHex(p?.color) ?? parseHex(def.pbr.color) ?? parseHex(def.swatch)
    ?? (def.pbr.texture ? parseHex(TEXTURE_COLORS[def.pbr.texture]) : null)
  );
}

/**
 * The SECOND colour of a catalog entry — the vein in a slab, the grain in a
 * plank, the fleck in a granite, the alternate tile or its grout. This is what
 * the analyzer reports as `accentColorHex`, so it is the only fair thing to
 * compare that against.
 *
 * Two white slabs are the same white; what makes one Calacatta and the other a
 * plain quartz is the vein, and `materialColor` cannot see it. Without this
 * accessor the accent term could not exist at all, which is how "white quartz
 * with soft warm grey veining" became a gold-veined Calacatta.
 *
 * `pattern` picks the right second colour where an entry carries two: a
 * speckled granite has BOTH a `vein` and a `speckleColor`, and what the
 * observation describes as its accent is the fleck; a checkerboard's accent is
 * the other tile.
 *
 * Photographic veneers use their measured grain. Flat paint and unmeasured
 * photographs still return null; an absent measurement is not an invented one.
 */
export function materialAccent(def: MaterialDef, pattern?: string): string | null {
  const o = def.pbr.procedural?.options as Record<string, unknown> | undefined;
  if (!o) return def.pbr.useDiffuse !== false && def.pbr.texture
    ? parseHex(TEXTURE_GRAIN[def.pbr.texture]) : null;
  if (pattern === 'speckled') return parseHex(o.speckleColor) ?? parseHex(o.vein) ?? null;
  if (pattern === 'checker') return parseHex(o.colorAlt) ?? null;
  return parseHex(o.vein) ?? parseHex(o.grain) ?? parseHex(o.speckleColor) ?? parseHex(o.colorAlt) ?? parseHex(o.grout) ?? null;
}
