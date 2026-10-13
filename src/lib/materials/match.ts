/**
 * Finish matching — turns what the analyzer SAW (a FinishObservation: colour,
 * pattern, sheen, module size) into a material id the rest of the app can use.
 *
 *   1. Score every catalog entry valid for the slot: family compatibility,
 *      CIE Lab ΔE between the observed base colour and the entry's colour,
 *      pattern / module-size agreement, sheen.
 *   2. Take the best acceptable entry of the SAME family; only when the family
 *      has nothing acceptable does a near family (hardwood → LVP) get a turn.
 *   3. Otherwise synthesise a CUSTOM material with exactly the observed
 *      colours, built on the closest entry's pricing group and a procedural
 *      recipe for its family, and register it in the catalog at runtime.
 *
 * Custom materials are a pure function of the (normalised) observation, so
 * their ids are stable hashes and they can be regenerated anywhere from the
 * spec alone — no extra persistence, no client/server drift. When the hash
 * formula moves (a recipe fix, a new field in the key) old ids go stale; the
 * `ensureSpecMaterials` entry point heals them and hands back a remap so
 * user selections follow.
 *
 * Why the colour term dominates: the client's complaint was "same colour,
 * same pattern as MY kitchen". A cabinet that is the right shade of green in a
 * slightly different sheen is a match; the right sheen in the wrong green is
 * not. Pattern is the one hard veto — a bold-veined marble shown as a solid
 * slab of the same base colour reads as the wrong stone immediately.
 */
import type { FinishFamily, FinishObservation, FinishPattern, FinishSheen, KitchenSpec, MaterialSlotId, RoomSpec, RoomType, Wall } from '@/lib/spec/types';
import {
  BATHROOM_SLOTS, CATALOG_BY_ID, DEFAULT_SELECTIONS, EXTERIOR_SLOTS, FLOORPLAN_SLOTS, KITCHEN_SLOTS,
  type MaterialCategory, type MaterialDef, type PBRRecipe, materialsForSlot, registerMaterial,
} from './catalog';
import { colorSplit, deltaE, lightness, materialAccent, materialColor, mix, parseHex, shade } from './color';

export interface FinishMatch {
  /** catalog id, or the id of a freshly registered custom material */
  id: string;
  /** the custom definition when one was synthesised (already registered) */
  custom: MaterialDef | null;
  /** CIE76 ΔE between the observation and the chosen material's base colour */
  deltaE: number;
  /** one line explaining the choice, for detected.notes / debugging */
  reason: string;
}

/** True for ids minted by this module. */
export function isCustomMaterialId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('custom-');
}

// ---------------------------------------------------------------------------
// Observation hygiene
// ---------------------------------------------------------------------------

const FAMILIES: FinishFamily[] = [
  'paint', 'stained-wood', 'quartz', 'granite', 'marble', 'quartzite', 'butcher-block', 'laminate', 'concrete', 'terrazzo', 'soapstone',
  'porcelain-tile', 'ceramic-tile', 'glass-tile', 'stone-tile', 'hardwood', 'engineered-wood', 'lvp', 'laminate-floor',
  'stainless', 'brass', 'nickel', 'bronze', 'black-metal', 'chrome', 'copper', 'glass', 'fabric', 'brick', 'stucco', 'siding', 'shingle', 'other',
];
const PATTERNS: FinishPattern[] = [
  'solid', 'veined', 'speckled', 'wood-grain', 'subway', 'stacked', 'herringbone', 'hex', 'mosaic', 'large-format',
  'checker', 'plank', 'lap', 'board-batten', 'brick', 'shingle', 'zellige', 'other',
];
const SHEENS: FinishSheen[] = ['matte', 'satin', 'semi-gloss', 'gloss', 'polished', 'honed', 'brushed', 'weathered'];

const slotsFor = (roomType: RoomType): readonly MaterialSlotId[] =>
  roomType === 'kitchen' ? KITCHEN_SLOTS
    : roomType === 'bathroom' ? BATHROOM_SLOTS
    : roomType === 'floorplan' ? FLOORPLAN_SLOTS
    : EXTERIOR_SLOTS;

const pick = <T extends string>(allowed: readonly T[], v: unknown, fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : typeof v === 'string' && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

const METALS = new Set<FinishFamily>(['stainless', 'brass', 'nickel', 'bronze', 'black-metal', 'chrome', 'copper']);
const WOOD_FAMILY = new Set<FinishFamily>(['stained-wood', 'hardwood', 'engineered-wood', 'lvp', 'laminate-floor', 'butcher-block']);
const isFloorSlot = (slot: string) => /floor|flooring|deck/.test(slot);
const isCladdingSlot = (slot: string) => /^siding_|^foundation$/.test(slot);
const isHardscapeSlot = (slot: string) => /^(driveway|walkway|patio|foundation)$/.test(slot);

/**
 * The pattern a family IMPLIES wins over a lazy "solid" from the model: wood
 * always has grain (or planks on a floor), and paint or metal never has a
 * tile pattern. Without this a white-oak cabinet reported as "solid" was
 * vetoed against every wood entry (wood-grain vs solid costs 10) and became a
 * custom material of the same colour. Slab and tile families keep whatever
 * the model said — there the pattern IS the identity of the stone.
 * Painted exterior cladding keeps its pattern too: lap is lap even when the
 * model filed it under paint.
 */
function effectivePattern(family: FinishFamily, pattern: FinishPattern, slot: string): FinishPattern {
  if (WOOD_FAMILY.has(family) && (pattern === 'solid' || pattern === 'other')) return isFloorSlot(slot) ? 'plank' : 'wood-grain';
  if ((family === 'paint' && !isCladdingSlot(slot)) || METALS.has(family)) return 'solid';
  return pattern;
}

/** Drops the "(#RRGGBB)" notes models like to append so a hex never appears twice in a name or prompt. */
function stripHexNotes(s: string): string {
  return s.replace(/\s*\(\s*#?[0-9a-f]{6}\s*\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

const PLANK_RUNS: readonly string[] = ['toward', 'across', 'diagonal'];

/**
 * Repairs a model-written observation into something the matcher can trust,
 * or returns null when the slot does not exist in this room or no colour
 * could be read from it (the id-snapping path takes over for that slot).
 * Idempotent: normalising an already-normalised observation is a no-op, which
 * is what makes "same observation → same id" hold for raw input.
 */
export function normalizeObservation(raw: unknown, roomType: RoomType): FinishObservation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const slot = typeof o.slot === 'string' ? o.slot.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  if (!slotsFor(roomType).includes(slot as MaterialSlotId)) return null;
  const baseColorHex = parseHex(o.baseColorHex);
  if (!baseColorHex) return null;
  const mod = o.moduleIn && typeof o.moduleIn === 'object' ? (o.moduleIn as Record<string, unknown>) : null;
  const w = mod ? num(mod.w) : null;
  const h = mod ? num(mod.h) : null;
  // the schema's own bounds (0.5"–120"); a sub-millimetre module once made the tile generator draw millions of joints
  const clampIn = (v: number) => Math.min(120, Math.max(0.5, v));
  const family = pick(FAMILIES, o.family, 'other');
  return {
    slot,
    family,
    baseColorHex,
    accentColorHex: parseHex(o.accentColorHex),
    pattern: effectivePattern(family, pick(PATTERNS, o.pattern, 'solid'), slot),
    sheen: pick(SHEENS, o.sheen, 'satin'),
    moduleIn: w && h ? { w: clampIn(w), h: clampIn(h) } : null,
    groutColorHex: parseHex(o.groutColorHex),
    description: typeof o.description === 'string' ? o.description.replace(/\s+/g, ' ').trim().slice(0, 160) : '',
    visibility: pick(['clear', 'partial', 'inferred'] as const, o.visibility, 'partial'),
    // told in the photo's terms ('toward' = the joints recede toward the wall
    // the camera faces); null = not read, which leaves the recipe's own
    // orientation — exactly what the twin drew before the field existed
    plankRun: PLANK_RUNS.includes(o.plankRun as string) ? (o.plankRun as FinishObservation['plankRun']) : null,
  };
}

// ---------------------------------------------------------------------------
// Family ↔ catalog category
// ---------------------------------------------------------------------------

const SLAB_STONE = new Set<FinishFamily>(['quartz', 'granite', 'marble', 'quartzite', 'soapstone', 'terrazzo', 'concrete']);
const TILE_FAMILY = new Set<FinishFamily>(['porcelain-tile', 'ceramic-tile', 'glass-tile', 'stone-tile']);
const PLANK_FAMILY = new Set<FinishFamily>(['hardwood', 'engineered-wood', 'lvp', 'laminate-floor', 'butcher-block']);
const TILED_PATTERNS = new Set<FinishPattern>(['subway', 'stacked', 'herringbone', 'hex', 'mosaic', 'large-format', 'checker', 'zellige', 'brick']);

interface FamilyMap { exact: MaterialCategory[]; near: MaterialCategory[] }
/** `exact` costs nothing; `near` is a related material a client would accept as "close"; anything else is excluded. */
const FAMILY_CATEGORIES: Record<FinishFamily, FamilyMap> = {
  paint: { exact: ['paint'], near: ['vinyl', 'laminate', 'other'] },
  'stained-wood': { exact: ['wood', 'cedar'], near: ['hardwood', 'engineered', 'butcher-block'] },
  quartz: { exact: ['quartz'], near: ['quartzite', 'marble', 'porcelain', 'laminate'] },
  granite: { exact: ['granite'], near: ['quartz', 'stone', 'quartzite'] },
  marble: { exact: ['marble'], near: ['quartz', 'quartzite', 'porcelain'] },
  quartzite: { exact: ['quartzite'], near: ['marble', 'quartz', 'granite'] },
  'butcher-block': { exact: ['butcher-block'], near: ['wood', 'hardwood'] },
  laminate: { exact: ['laminate'], near: ['quartz', 'vinyl'] },
  // concrete pavers ARE concrete: a driveway laid in modules reaches the paver entries, a broom slab stays a slab (pattern decides)
  concrete: { exact: ['concrete', 'pavers'], near: ['quartz', 'stone', 'stucco'] },
  terrazzo: { exact: ['terrazzo'], near: ['quartz', 'granite'] },
  soapstone: { exact: ['stone'], near: ['granite', 'quartz', 'slate'] },
  'porcelain-tile': { exact: ['porcelain'], near: ['ceramic', 'stone', 'marble', 'slate', 'concrete'] },
  'ceramic-tile': { exact: ['ceramic'], near: ['porcelain', 'glass-tile'] },
  'glass-tile': { exact: ['glass-tile'], near: ['ceramic', 'glass'] },
  'stone-tile': { exact: ['stone', 'marble', 'slate', 'stone-veneer'], near: ['porcelain', 'concrete', 'terrazzo', 'pavers'] },
  hardwood: { exact: ['hardwood'], near: ['engineered', 'lvp', 'wood'] },
  'engineered-wood': { exact: ['engineered', 'hardwood'], near: ['lvp', 'wood'] },
  lvp: { exact: ['lvp'], near: ['hardwood', 'engineered', 'laminate'] },
  'laminate-floor': { exact: ['lvp', 'laminate'], near: ['engineered', 'hardwood'] },
  stainless: { exact: ['finish', 'metal', 'metal-roof'], near: ['glass'] },
  brass: { exact: ['finish', 'metal', 'metal-roof'], near: ['glass'] },
  nickel: { exact: ['finish', 'metal', 'metal-roof'], near: ['glass'] },
  bronze: { exact: ['finish', 'metal', 'metal-roof'], near: ['glass'] },
  'black-metal': { exact: ['finish', 'metal', 'metal-roof'], near: ['paint', 'glass'] },
  chrome: { exact: ['finish', 'metal', 'metal-roof'], near: ['glass'] },
  copper: { exact: ['finish', 'metal', 'metal-roof'], near: [] },
  glass: { exact: ['glass'], near: ['glass-tile', 'acrylic', 'finish', 'metal'] },
  fabric: { exact: ['other'], near: ['grass'] },
  brick: { exact: ['brick'], near: ['stone-veneer', 'pavers'] },
  stucco: { exact: ['stucco'], near: ['fiber-cement', 'paint', 'concrete'] },
  siding: { exact: ['fiber-cement', 'vinyl', 'cedar', 'composite'], near: ['metal', 'paint', 'wood'] },
  shingle: { exact: ['asphalt-shingle', 'cedar', 'slate', 'clay-tile', 'metal-roof'], near: [] },
  other: { exact: [], near: [] },
};

const CATEGORY_FOR_FAMILY: Record<FinishFamily, MaterialCategory> = {
  paint: 'paint', 'stained-wood': 'wood', quartz: 'quartz', granite: 'granite', marble: 'marble', quartzite: 'quartzite', 'butcher-block': 'butcher-block',
  laminate: 'laminate', concrete: 'concrete', terrazzo: 'terrazzo', soapstone: 'stone', 'porcelain-tile': 'porcelain', 'ceramic-tile': 'ceramic',
  'glass-tile': 'glass-tile', 'stone-tile': 'stone', hardwood: 'hardwood', 'engineered-wood': 'engineered', lvp: 'lvp', 'laminate-floor': 'lvp',
  stainless: 'finish', brass: 'finish', nickel: 'finish', bronze: 'finish', 'black-metal': 'finish', chrome: 'finish', copper: 'finish',
  glass: 'glass', fabric: 'other', brick: 'brick', stucco: 'stucco', siding: 'fiber-cement', shingle: 'asphalt-shingle', other: 'other',
};

const METAL_WORDS = /\b(metal|metallic|brass|nickel|chrome|bronze|steel|stainless|iron|copper|gold)\b/i;

/**
 * 0 exact family, 6 near, null = incompatible. 'other' accepts everything on
 * colour alone. Near costs more than a few ΔE because it usually crosses a
 * price group too (hardwood → LVP) — the colour has to be clearly better.
 * A glass light fixture is glass: the metal FINISH entries are only "near"
 * when the model actually described metal, otherwise a pale-grey pendant
 * observation snapped to polished nickel on colour alone.
 */
function familyScore(obs: FinishObservation, def: MaterialDef): number | null {
  const { family } = obs;
  if (family === 'other') return 2;
  const map = FAMILY_CATEGORIES[family];
  if (map.exact.includes(def.category)) return 0;
  if (!map.near.includes(def.category)) return null;
  if (family === 'glass' && obs.slot === 'lighting_fixture' && (def.category === 'finish' || def.category === 'metal') && !METAL_WORDS.test(obs.description)) return null;
  return 6;
}

// ---------------------------------------------------------------------------
// What a catalog entry LOOKS like (pattern, module, roughness)
// ---------------------------------------------------------------------------

interface Signature { pattern: FinishPattern; moduleM: { w: number; h: number } | null; roughness: number }

const sigCache = new Map<string, Signature>();

function signatureOf(def: MaterialDef): Signature {
  const hit = sigCache.get(def.id);
  if (hit) return hit;
  const p = def.pbr.procedural;
  let pattern: FinishPattern = 'other';
  let moduleM: Signature['moduleM'] = null;
  if (p) {
    const o = p.options as Record<string, unknown>;
    if (p.kind === 'tile') {
      const tw = Number(o.tileW) || 0, th = Number(o.tileH) || 0;
      moduleM = { w: tw, h: th };
      const pat = String(o.pattern ?? 'stacked');
      if (pat === 'running-bond') pattern = tw >= 0.4 ? 'large-format' : tw / Math.max(th, 0.001) >= 1.6 ? 'subway' : 'brick';
      else if (pat === 'hex') pattern = 'hex';
      else if (pat === 'herringbone') pattern = 'herringbone';
      else if (o.checker) pattern = 'checker';
      else if (tw >= 0.45) pattern = 'large-format';
      else if (tw <= 0.06) pattern = 'mosaic';
      else if ((Number(o.variation) || 0) >= 0.25) pattern = 'zellige';
      else pattern = 'stacked';
    } else if (p.kind === 'slab' || p.kind === 'quartz') {
      const intensity = Number(o.intensity ?? o.veinIntensity) || 0;
      const speckle = Number(o.speckle ?? o.density) || 0;
      pattern = intensity >= 0.5 ? 'veined' : speckle >= 0.6 ? 'speckled' : 'solid';
    } else if (p.kind === 'plank') {
      pattern = 'plank';
      moduleM = { w: Number(o.widthM) || 0.15, h: Number(o.lengthM) || 1.6 };
    } else if (p.kind === 'siding') pattern = o.batten ? 'board-batten' : 'lap';
    else if (p.kind === 'wood') pattern = 'wood-grain';
    else if (p.kind === 'grouted-slab') pattern = 'large-format';
    else if (p.kind === 'painted-wall' || p.kind === 'brushed-metal' || p.kind === 'fabric') pattern = 'solid';
  } else {
    const text = `${def.id} ${def.name} ${def.prompt} ${(def.tags ?? []).join(' ')}`.toLowerCase();
    const dims = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/.exec(text);
    if (dims) moduleM = { w: Number(dims[2]) * 0.0254, h: Number(dims[1]) * 0.0254 };
    if (/subway/.test(text)) pattern = 'subway';
    else if (/hex/.test(text)) pattern = 'hex';
    else if (/herringbone/.test(text)) pattern = 'herringbone';
    else if (/mosaic|penny/.test(text)) pattern = 'mosaic';
    else if (/checker/.test(text)) pattern = 'checker';
    else if (/zellige/.test(text)) pattern = 'zellige';
    else if (/vein|calacatta|carrara|marble|soapstone/.test(text)) pattern = 'veined';
    else if (/granite|speckle|terrazzo/.test(text)) pattern = 'speckled';
    else if (/batten/.test(text)) pattern = 'board-batten';
    else if (/lap siding|lap\b|clapboard/.test(text)) pattern = 'lap';
    else if (/shingle|shake/.test(text)) pattern = 'shingle';
    else if (/brick/.test(text)) pattern = 'brick';
    else if (/large.?format|24x48|24×48|slab/.test(text)) pattern = 'large-format';
    else if (/plank|parquet/.test(text)) pattern = 'plank';
    else if (/oak|walnut|cherry|ash|wood|cedar|veneer|butcher|maple/.test(text)) pattern = 'wood-grain';
    else if (/tile|paver/.test(text)) pattern = 'stacked';
    // a flat-colour recipe IS a solid; only a photo texture can hide a pattern we failed to name
    else if (!def.pbr.texture || /paint|plaster|stucco|laminate|solid|matte|brushed|polished|stainless|steel|metal|nickel|brass|chrome|bronze|black|white|glass|acrylic|concrete|turf|lawn/.test(text)) pattern = 'solid';
  }
  const sig = { pattern, moduleM, roughness: def.pbr.roughness };
  sigCache.set(def.id, sig);
  return sig;
}

/** Patterns a client would call "the same look" cost little; a different look costs 10 and vetoes a catalog match. */
const PATTERN_KIN: Array<[Set<FinishPattern>, number]> = [
  [new Set(['subway', 'stacked', 'brick', 'zellige']), 3],
  [new Set(['hex', 'mosaic']), 3],
  [new Set(['large-format', 'stacked', 'solid']), 3],
  [new Set(['wood-grain', 'plank']), 1],
  [new Set(['lap', 'board-batten', 'shingle']), 4],
  [new Set(['checker', 'stacked']), 5],
  // A faint-veined slab and a "solid" one are the same look from three feet;
  // the vein COLOUR, not its amplitude, is what makes them different stones,
  // and `accentScore` now judges that. Keeping this at 6 vetoed the plain
  // white quartz that WAS the client's counter (intensity 0.12 → 'solid') and
  // handed the slot to the gold-veined Calacatta on vein amplitude alone.
  [new Set(['veined', 'solid']), 3],
  [new Set(['speckled', 'solid']), 6],
];
function patternScore(a: FinishPattern, b: FinishPattern): number {
  if (a === b) return 0;
  // unknown is not a mismatch — it must never veto a colour match on its own
  if (a === 'other' || b === 'other') return 3;
  let best = 10;
  for (const [kin, cost] of PATTERN_KIN) if (kin.has(a) && kin.has(b)) best = Math.min(best, cost);
  return best;
}

function moduleScore(obs: FinishObservation, sig: Signature): number {
  if (!obs.moduleIn) return 0;
  if (!sig.moduleM || !sig.moduleM.w) return 3;
  const ow = obs.moduleIn.w * 0.0254, oh = obs.moduleIn.h * 0.0254;
  // planks only care about width; tiles compare both edges in either orientation
  if (sig.pattern === 'plank' || obs.pattern === 'plank') return Math.min(8, Math.abs(ow - sig.moduleM.w) / Math.max(ow, 0.01) * 12);
  const a = Math.abs(ow - sig.moduleM.w) / Math.max(ow, 0.01) + Math.abs(oh - sig.moduleM.h) / Math.max(oh, 0.01);
  const b = Math.abs(ow - sig.moduleM.h) / Math.max(ow, 0.01) + Math.abs(oh - sig.moduleM.w) / Math.max(oh, 0.01);
  return Math.min(10, Math.min(a, b) * 8);
}

const SHEEN_ROUGHNESS: Record<FinishSheen, number> = { matte: 0.65, honed: 0.45, satin: 0.35, brushed: 0.32, 'semi-gloss': 0.22, gloss: 0.12, polished: 0.12, weathered: 0.75 };
function sheenScore(sheen: FinishSheen, sig: Signature, family: FinishFamily): number {
  const d = Math.abs(SHEEN_ROUGHNESS[sheen] - sig.roughness);
  // brushed vs polished is the whole identity of a metal finish
  return Math.min(METALS.has(family) ? 10 : 6, d * (METALS.has(family) ? 30 : 12));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Two white slabs are the same white; what makes one Calacatta and the other a
 * plain quartz is the VEIN. Base ΔE cannot separate them — 0.5 to 2.1 across
 * the five candidates for the client's `#F2F0EB` counter — so the accent is
 * what carries the discrimination (4.3 for the right answer, 36.8 for the gold
 * one that was chosen).
 *
 * 0.35 keeps it a TERM rather than a veto: a 17 ΔE accent costs 6, about the
 * same as a near family, so a slightly-off vein never outranks a badly-off
 * base. The cap stops one wrong vein colour from swamping a total that also
 * has to price family, pattern, module and sheen.
 */
const ACCENT_W = 0.35;
const ACCENT_CAP = 14;
/**
 * The accent a client would still call "the same stone". ACCEPTANCE.md §2/§4
 * promises the resolved material's accent within ΔE 12 of the observation, so
 * the gate that decides catalog-entry-vs-synthesise IS that promise: past it
 * the entry is the wrong material whatever its base colour, and the honest
 * answer is a custom material with the photo's own vein.
 *
 * Measured over the four client fixtures, this costs no named product the
 * catalog genuinely had — client-tan still keeps `ct-white-quartz` (accent
 * ΔE 4.3) and `tile-quartz-slab` (3.4), client-marble/-items still keep
 * `ct-porcelain-slab` (3.6 / 8.1) — and it synthesises exactly the four slots
 * whose nearest entry was 13–17 ΔE off in the vein.
 */
const DE_ACCENT_MAX = 12;
const ACCENT_LIMIT = DE_ACCENT_MAX * ACCENT_W;

/**
 * How far the entry's second colour is from the observed one. Zero when either
 * side has no accent: an observation that did not report one, and a catalog
 * entry with neither a procedural accent nor a measured photographic palette,
 * are unknowns. Photographic cabinet veneers now have measured grain colours,
 * so those participate in the same accent gate as generated wood.
 */
function accentScore(obs: FinishObservation, def: MaterialDef, sig: Signature): number {
  if (!obs.accentColorHex) return 0;
  const a = materialAccent(def, sig.pattern);
  if (!a) return 0;
  return Math.min(ACCENT_CAP, deltaE(obs.accentColorHex, a) * ACCENT_W);
}

interface Scored { def: MaterialDef; total: number; dE: number; family: number; pattern: number; module: number; sheen: number; accent: number }

function score(obs: FinishObservation, def: MaterialDef, hint?: string): Scored | null {
  const fam = familyScore(obs, def);
  if (fam === null) return null;
  const color = materialColor(def);
  const dE = color ? deltaE(obs.baseColorHex, color) : 18;
  const sig = signatureOf(def);
  const pattern = patternScore(obs.pattern, sig.pattern);
  const mod = moduleScore(obs, sig);
  const sheen = sheenScore(obs.sheen, sig, obs.family);
  const accent = accentScore(obs, def, sig);
  // the model's own pick is worth a small nudge — it saw the photo, we did not
  const bonus = hint && def.id === hint ? 3 : 0;
  return { def, total: dE + fam + pattern + mod + sheen + accent - bonus, dE, family: fam, pattern, module: mod, sheen, accent };
}

/**
 * How far a CATALOG entry may sit from the observation and still stand in for
 * it. 8 is not a taste: it is the same ΔE the client is promised in
 * ACCEPTANCE §2 and §7 ("within ΔE 8 … or synthesise a custom material"), and
 * the matcher having its own looser 10 meant a slot could be graded a pass by
 * the promise and filled by an entry the promise rejects — client-shelves'
 * cabinets sat at ΔE 8.5 on `wood-cherry` with the synthesis that would have
 * drawn the photo's own colour never reached.
 */
const DE_SURFACE_MAX = 8;
// Solid paint has no grain/veining to mask a colour substitution. Preserve the
// observed pigment unless the palette entry is nearly equal; the broader
// surface budget collapsed visibly different grey cabinet runs to Sea Salt.
const DE_PAINT_MAX = 1;
const surfaceColorMax = (family: FinishFamily) => family === 'paint' ? DE_PAINT_MAX : DE_SURFACE_MAX;

/**
 * Metals and clear glass are graded on TWO budgets instead of one ΔE, and this
 * is a statement about optics, not a carve-out for a slot that would not pass.
 *
 * A metal has no diffuse albedo. At metalness 1 the rendered (and the
 * photographed) pixel is F0 × whatever sits in the mirror direction, so a
 * stainless panel photographs as the ROOM. Clear glass is the same story
 * through transmission — `materialColor` already concedes it and substitutes
 * the UI swatch, because the pbr colour of clear glass is #FFFFFF and would
 * put every pendant 15 ΔE from its photo.
 *
 * Decomposing every metal/glass difference on the four client fixtures into
 * Lab lightness and Lab hue+chroma says exactly which half moved:
 *
 *   appliances (brushed stainless), four different kitchens
 *     ΔL 4.5 / 8.2 / 4.9 / 6.2      ΔC 1.9 / 1.6 / 1.5 / 0.0
 *   lighting_fixture (clear glass pendants), three kitchens
 *     ΔL 7.4 / 7.8 / 3.9            ΔC 2.0 / 5.4 / 0.0
 *
 * Four photographs of nominally identical steel agree about its hue to inside
 * a just-noticeable difference and disagree about its brightness by 3.7 ΔL.
 * That spread IS the environment term, and no matcher can read it out of the
 * pixel. So the promise splits:
 *
 *   dC ≤ 6   the MATERIAL — tight, because metal identity lives in the hue
 *   dL ≤ 16  the ROOM     — loose, because this is what the mirror borrowed
 *
 * Both limits come off the catalog's own product spacing rather than off the
 * fixtures — spacing between ENTRIES, measured entry-to-entry, so no fixture
 * grades its own budget. ΔC 6 is closer than the two nearest distinct brasses
 * in the library (fin-antique-brass → fin-brushed-brass 6.5, → fin-brushed-gold
 * 6.4) while a genuinely different metal is 15–39 away (unlacquered brass 15.1,
 * copper 17.2, every cool metal 36+). ΔL 16 is a shade wider than the whole
 * neutral-appliance CLUSTER — from app-stainless, app-pro-range is 2.2, panel
 * ready 10.8 and white 14.9 — so an appliance photographed anywhere in that
 * cluster can still be filled by a member of it, and 3.5× short of the nearest
 * appliance that is a different product (app-black-stainless 55.6,
 * app-matte-black 68.6). Cluster width 14.9 under the budget, 55.6 over it:
 * that gap is what the number is bought with, and it is why ΔL alone cannot be
 * the whole promise — inside 16 it cannot tell stainless from panel-ready.
 *
 * Neither budget works alone: ΔC cannot separate stainless from matte black
 * (both neutral, 1.5 apart) and ΔL cannot separate brass from nickel.
 *
 * This is TIGHTER than the single ΔE ≤ 16 it replaces, in the direction that
 * carries the identity — a metal 15 ΔE off entirely in hue used to pass and
 * now synthesises.
 *
 * CLEAR GLASS gets a wider hue budget than a metal, and that is the same
 * argument taken one step further rather than a concession. A metal at least
 * tints what it reflects; clear glass contributes almost nothing, so the hue
 * that comes back is the bulb, the brass fitting and the wall behind it — and
 * the catalog's own reference (`light-pendant-glass`, pbr colour #FFFFFF) has
 * no hue at all, only a UI swatch. Held at the metal's 6 the matcher rejected
 * a clear-glass pendant reading at ΔC 6.1 and handed the slot to POLISHED
 * NICKEL, which is the failure the METAL_WORDS guard exists to prevent. 12
 * comes off the same catalog spacing as the metal budget: from
 * light-pendant-glass the nearest fixture in the slot that is a genuinely
 * different colour of glass or shade is ΔC 33.7 (light-rattan), then 45.2
 * (light-pendant-brass) — so 12 is under a third of the distance to the first
 * wrong answer and an amber or green pendant still synthesises. It also has to
 * clear the room's contribution, and the worst clear-glass reading across the
 * four fixtures is 6.1; that is corroboration, not the derivation. What the
 * hue budget cannot do here is separate a clear pendant from a black one
 * (light-pendant-black is ΔC 1.7 from the clear entry, light-linear 1.3) —
 * those are 81.5 and 75.9 apart in LIGHTNESS, which is the other half of the
 * promise doing the work.
 */
const DC_METAL_MAX = 6;
const DC_GLASS_MAX = 12;
const DL_MIRROR_MAX = 16;
const dcMax = (family: FinishFamily) => (family === 'glass' ? DC_GLASS_MAX : DC_METAL_MAX);

/** Families whose photographed colour is mostly the room they were standing in. */
export const isMirrorFamily = (family: FinishFamily): boolean => METALS.has(family) || family === 'glass';

/** The single budget the TOTAL score is still clamped against (see `acceptable`). */
const deMax = (family: FinishFamily) => (isMirrorFamily(family) ? DL_MIRROR_MAX : surfaceColorMax(family));

export interface FinishPromise {
  /** does this entry honour what the client was promised for this slot? */
  ok: boolean;
  /** 'surface' is graded on one ΔE; 'mirror' on hue and lightness separately */
  kind: 'surface' | 'mirror';
  dE: number;
  dL: number;
  dC: number;
  /** the promise as a sentence, for the check sheets and `detected.notes` */
  why: string;
}

/**
 * Does `def` honour the colour promise for `obs`? THE one place the rule
 * lives: `matchFinish` uses it to decide catalog-entry-vs-synthesise, and
 * `check-photo-fidelity` §7.1 grades against it, so the matcher can never
 * again fill a slot with an entry the acceptance suite rejects (or, as with
 * client-marble's stainless and clear-glass pendants, be failed for the
 * correct answer).
 */
export function finishPromise(obs: FinishObservation, def: MaterialDef): FinishPromise {
  const color = materialColor(def);
  const split = color ? colorSplit(obs.baseColorHex, color) : { dE: 999, dL: 999, dC: 999 };
  const mirror = isMirrorFamily(obs.family);
  const dc = dcMax(obs.family);
  const surfaceLimit = surfaceColorMax(obs.family);
  const ok = mirror ? split.dC <= dc && split.dL <= DL_MIRROR_MAX : split.dE <= surfaceLimit;
  const why = mirror
    ? `hue ΔC ${split.dC.toFixed(1)}/${dc}, lightness ΔL ${split.dL.toFixed(1)}/${DL_MIRROR_MAX}`
    : `ΔE ${split.dE.toFixed(1)}/${surfaceLimit}`;
  return { ok, kind: mirror ? 'mirror' : 'surface', ...split, why };
}

// ---------------------------------------------------------------------------
// Custom material synthesis
// ---------------------------------------------------------------------------

/** FNV-1a, 8 hex chars. Stable across runtimes, which is the whole point. */
function hash8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The description as it takes part in the id: case, punctuation and hex notes do not count. */
function descriptionKey(description: string): string {
  return stripHexNotes(description).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The fields a material is a function of. The description IS one of them:
 * it names the material for the photoreal prompt ("rift white oak", "nero
 * marquina") in a way the structured fields cannot, so two observations that
 * differ only in wording must not share an id — otherwise whichever was
 * registered first would decide the name every client sees. The price of
 * that (ids move when the model rewords) is paid by ensureSpecMaterials,
 * which heals stale ids and remaps selections. Visibility is prose about the
 * photo, not the material, and stays out.
 */
function observationKey(obs: FinishObservation, lookingAt?: Wall | null): string {
  const key = [
    obs.slot, obs.family, obs.baseColorHex, obs.accentColorHex ?? '-', obs.pattern, obs.sheen,
    obs.moduleIn ? `${obs.moduleIn.w}x${obs.moduleIn.h}` : '-', obs.groutColorHex ?? '-', descriptionKey(obs.description),
  ].join('|');
  // Direction joins the key only once it has been READ, and as the room-frame
  // answer rather than the photo-relative word: two floors that differ only in
  // which way the boards run are different materials and must not share a
  // cached recipe, while 'toward' facing the back wall and 'across' facing a
  // side wall are the SAME floor and should. Appending nothing when plankRun
  // is null keeps every id minted before the field existed byte-identical.
  return obs.plankRun ? `${key}|rot${plankRotate90(obs, lookingAt) ? 1 : 0}` : key;
}

/**
 * Does this floor need its texture turned a quarter turn?
 *
 * World UVs put u on world X and v on world Z, and `plankFloor` runs each
 * board's LENGTH along v — so an un-rotated plank material draws boards along
 * world Z. `plankRun` is told in the PHOTO's terms ('toward' = the joints
 * recede toward the wall the camera faces), so which world axis that is
 * depends on which wall that was: facing the back or front wall, "toward" is
 * Z and no rotation is needed; facing a side wall the two swap.
 *
 * A missing reading, or 'diagonal' (which no generator draws), leaves the
 * recipe's own orientation — exactly what the twin drew before the field
 * existed.
 */
function plankRotate90(obs: FinishObservation, lookingAt?: Wall | null): boolean {
  if (!obs.plankRun || obs.plankRun === 'diagonal') return false;
  const acrossIsX = lookingAt !== 'left' && lookingAt !== 'right';
  return obs.plankRun === (acrossIsX ? 'across' : 'toward');
}

/** Surfaces whose drawing has a grain direction, and so can disagree with an observed `plankRun`. */
const hasPlankDirection = (def: MaterialDef): boolean => {
  const kind = def.pbr.procedural?.kind;
  return kind === 'plank' || kind === 'wood';
};

const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'with', 'in', 'on', 'to', 'x']);
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** The description without trailing punctuation or hex notes, or '' when the model gave none. */
function cleanDescription(obs: FinishObservation): string {
  return stripHexNotes(obs.description).replace(/[.;,\s]+$/, '').trim();
}

function customName(obs: FinishObservation): string {
  const desc = cleanDescription(obs);
  let name = desc ? titleCase(desc) : titleCase(`${obs.family.replace(/-/g, ' ')} ${obs.pattern === 'solid' ? '' : obs.pattern}`.trim());
  if (name.length > 28) {
    name = name.slice(0, 28);
    const cut = name.lastIndexOf(' ');
    if (cut > 14) name = name.slice(0, cut);
  }
  return name || `Custom ${obs.slot.replace(/_/g, ' ')}`;
}

/** Tile module in metres for a pattern when the model gave none. */
function defaultModuleIn(pattern: FinishPattern, slot: string): { w: number; h: number } {
  const floor = isFloorSlot(slot) || isHardscapeSlot(slot);
  switch (pattern) {
    case 'subway': case 'brick': return floor ? { w: 8, h: 4 } : { w: 6, h: 3 };
    case 'stacked': return floor ? { w: 24, h: 12 } : { w: 12, h: 4 };
    case 'herringbone': return { w: 6, h: 2 };
    case 'hex': return { w: 2, h: 2 };
    case 'mosaic': return { w: 1, h: 1 };
    case 'zellige': return { w: 4, h: 4 };
    case 'checker': return { w: 12, h: 12 };
    case 'large-format': return floor ? { w: 24, h: 24 } : { w: 24, h: 12 };
    case 'plank': return { w: 36, h: 6 };
    default: return floor ? { w: 24, h: 12 } : { w: 12, h: 4 };
  }
}

const IN = 0.0254;
/** The generators draw joints per module; below a centimetre that is millions of joints and a frozen tab. */
const MIN_MODULE_M = 0.01;

interface Finish { roughness: number; clearcoat: number; clearcoatRoughness: number }
function finishFor(sheen: FinishSheen, family: FinishFamily): Finish {
  if (SLAB_STONE.has(family)) {
    if (sheen === 'honed' || sheen === 'matte') return { roughness: 0.45, clearcoat: 0.1, clearcoatRoughness: 0.4 };
    if (sheen === 'satin' || sheen === 'brushed' || sheen === 'weathered') return { roughness: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.2 };
    return { roughness: 0.14, clearcoat: 0.5, clearcoatRoughness: 0.07 };
  }
  switch (sheen) {
    case 'gloss': case 'polished': return { roughness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.06 };
    case 'semi-gloss': return { roughness: 0.2, clearcoat: 0.45, clearcoatRoughness: 0.1 };
    case 'satin': case 'brushed': return { roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.2 };
    case 'honed': return { roughness: 0.45, clearcoat: 0.15, clearcoatRoughness: 0.35 };
    default: return { roughness: 0.6, clearcoat: 0.12, clearcoatRoughness: 0.5 };
  }
}

/** Grout that reads right against the tile when the model did not give one. */
const autoGrout = (tile: string) => (lightness(tile) > 60 ? mix(tile, '#7A7568', 0.3) : mix(tile, '#C9C4B8', 0.45));

/** Slots drawn as a field of modules: tile, floors, and the hardscape a driveway's pavers sit in. */
const isTileSlot = (slot: string) => /tile|backsplash|flooring/.test(slot) || isHardscapeSlot(slot);

/**
 * The PBR recipe for a custom finish. Each family maps to the generator that
 * the 3D view already knows how to draw (components/scene/materials.ts
 * runProcedural), with the observed colours in the slots those generators
 * expect. `nearest` supplies the recipe for families we cannot draw from
 * scratch (brick, stucco, shingle …), re-coloured.
 */
/**
 * Give a procedural recipe a flat colour to stand on until its canvas exists.
 *
 * `buildMaterial` creates the three material with `color: r.color ?? '#ffffff'`
 * and then hands a procedural recipe to `onIdle`, so the drawing lands a frame
 * or two later — the comment there says as much. The paint, glass and fabric
 * recipes set a top-level `color`, but every PROCEDURAL one (wood, plank,
 * tile, slab, siding) put the observed colour only inside
 * `procedural.options.color`, where the renderer cannot see it. So a
 * photo-matched walnut island was WHITE until its canvas arrived, and white
 * for good on any path where it never did — an idle callback that does not
 * fire, a recipe that throws, a screenshot taken too early, `document`
 * missing. The client's walnut island is exactly this case.
 *
 * `buildProcedural` sets the colour back to white once the map is in place
 * (the map carries the colour), so this only ever governs the before and the
 * failure — never the finished surface.
 */
function withFlatColour(pbr: PBRRecipe, baseColorHex: string): PBRRecipe {
  if (!pbr.procedural || pbr.color) return pbr;
  return { ...pbr, color: baseColorHex };
}

function recipeFor(obs: FinishObservation, nearest: MaterialDef, seed: number, rotate90 = false): PBRRecipe {
  const { family, pattern, sheen, baseColorHex: base } = obs;
  const accent = obs.accentColorHex;
  const fin = finishFor(sheen, family);
  const slotIsTile = isTileSlot(obs.slot);
  const tiled = TILED_PATTERNS.has(pattern);

  // --- metals: the observed colour, with the brush drawn
  //
  // NOT re-lit, and that is a decision with a proof rather than a shrug. The
  // objection to synthesising a metal at all is real: at metalness 1 three
  // multiplies the environment sample by `color`, and the observation ALREADY
  // contains an environment, so a photo of steel in a dim room is dim and the
  // twin reflects its own room through it a second time. The answer would be
  // to keep the hue and take the lightness from a catalog metal authored under
  // a reference light — but there is no such reference to be had here:
  //
  //   * Hue cannot name one. `app-stainless` (L 80.9), `app-black-stainless`
  //     (25.2) and `app-matte-black` (12.2) are all inside ΔC 1.5 of a neutral
  //     grey, so a mid-grey observation has kin above AND below it and "the
  //     room made it dark" and "the room made it light" are equally supported.
  //     Choosing by best SCORE put a cliff in the middle of the range: a photo
  //     at L 51.8 was drawn at 35.9 — 16 ΔL DARKER than the photograph, the
  //     opposite of the correction's whole point — while one RGB step lighter,
  //     L 53.4, was drawn at 69.4. 1.6 L of photograph, 33.5 L of output.
  //   * Where the kin are one-sided the reference is out of reach BY
  //     CONSTRUCTION. A pull may only blame the room for `DL_MIRROR_MAX`, and
  //     an entry of the right hue within `DL_MIRROR_MAX` is an entry that
  //     `finishPromise` ACCEPTS — it would have been the match, and no
  //     synthesis would have run. So every reference synthesis can still see
  //     is further away than the cap, and the pull can only ever saturate:
  //     measured, 12 of 3984 sampled metal observations relit and all 12 hit
  //     the cap exactly. That is extrapolation from the catalog's coverage (it
  //     stocks no dark brass), not an illuminant we read.
  //
  // So the photographed colour stands, as it did before the two budgets, and
  // the double-darkening is left to the renderer to answer.
  //
  // What DID change here:
  //
  // 1. Draw the brush. `brushedMetal` has shipped in procedural.ts from the
  //    start — wired through runProcedural, swatch.ts and check-3d — and
  //    nothing in the catalog or here ever asked for it, so every metal in the
  //    app was a flat colour and a roughness scalar while prompt.ts asked the
  //    image model for "brushed-metal anisotropy" the twin never drew. A
  //    polished metal is a mirror and genuinely has no brush; everything else
  //    gets one, running ACROSS an appliance panel and ALONG a faucet or a
  //    handle — the same axis convention `applyRealism` uses for
  //    `anisotropyRotation`.
  if (METALS.has(family)) {
    const polished = sheen === 'polished' || sheen === 'gloss';
    const roughness = polished ? 0.08 : sheen === 'matte' ? 0.55 : sheen === 'weathered' ? 0.5 : 0.32;
    if (polished) return { color: base, roughness, metalness: 1, envMapIntensity: 1.2 };
    return {
      procedural: {
        kind: 'brushed-metal',
        options: { color: base, direction: obs.slot === 'appliances' ? 'x' : 'y', spanM: 0.25, grit: sheen === 'matte' || sheen === 'weathered' ? 0.85 : 0.45, seed },
        // microns of relief: any more and the streaks read as corrugation
        reliefStrength: 0.45,
      },
      roughness, metalness: 1, envMapIntensity: 1.2, normalScale: 0.25,
    };
  }

  // --- paint: the nearest painted entry's micro-normal, with our colour and a film that matches the sheen
  if (family === 'paint' || family === 'laminate') {
    const inherited: PBRRecipe = nearest.pbr.procedural ? { roughness: 0.4, metalness: 0 } : { ...nearest.pbr };
    const roughness = sheen === 'gloss' || sheen === 'polished' ? 0.15 : sheen === 'semi-gloss' ? 0.24 : sheen === 'satin' ? 0.36 : 0.6;
    const clearcoat = sheen === 'gloss' || sheen === 'polished' ? 0.45 : sheen === 'semi-gloss' ? 0.3 : sheen === 'satin' ? 0.12 : 0;
    return { ...inherited, procedural: undefined, color: base, useDiffuse: false, roughness, metalness: 0, clearcoat, clearcoatRoughness: clearcoat ? 0.25 : 0.5 };
  }

  // --- planks (floors, butcher block); a herringbone floor is drawn by the tile generator with wood colours
  if (PLANK_FAMILY.has(family)) {
    const widthM = Math.max(MIN_MODULE_M, (obs.moduleIn?.w ?? (family === 'butcher-block' ? 2 : 6)) * IN);
    // The observation's module is {w: board width, h: board LENGTH} in inches,
    // and the length is what stops the floor reading as a lattice: real 7×72"
    // oak is 1.83 m long, and the old fixed 1.6 was drawn shorter still. 0.6 m
    // is the shortest board anyone lays; butcher block keeps its short staves
    // unless the photo actually measured them.
    const lengthM = Math.max(0.6, (obs.moduleIn?.h ?? (family === 'butcher-block' ? 35 : 63)) * IN);
    const grain = accent ?? shade(base, 0.55);
    const roughness = sheen === 'gloss' || sheen === 'polished' || sheen === 'semi-gloss' ? 0.3 : sheen === 'satin' ? 0.42 : 0.5;
    const clearcoat = family === 'lvp' || family === 'laminate-floor' ? 0.18 : sheen === 'matte' ? 0.08 : 0.14;
    if (pattern === 'herringbone') {
      return {
        procedural: { kind: 'tile', options: { tileW: widthM * 6, tileH: widthM, color: base, colorAlt: shade(base, 0.92), grout: grain, pattern: 'herringbone', variation: 0.14, gloss: 0.3, groutM: 0.0015, seed }, reliefStrength: 1.2, jointRoughness: 0.9 },
        roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.45, normalScale: 0.5,
      };
    }
    return {
      procedural: { kind: 'plank', options: { widthM, lengthM, color: base, colorAlt: shade(base, 0.92), grain, variation: 0.16, seed }, reliefStrength: 1.2, jointRoughness: 0.9 },
      roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.45, normalScale: 0.5, rotate90: rotate90 || undefined,
    };
  }

  // --- stained cabinet wood
  if (family === 'stained-wood') {
    const light = lightness(base) > 62;
    return {
      procedural: { kind: 'wood', options: { color: base, colorAlt: shade(base, 1.08), grain: accent ?? shade(base, 0.55), figure: light ? 'rift' : 'cathedral', spanM: 1.2, contrast: light ? 0.4 : 0.55, pores: light ? 0.6 : 0.3, seed }, reliefStrength: 0.6 },
      roughness: sheen === 'gloss' || sheen === 'semi-gloss' ? 0.3 : 0.45, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4, normalScale: 0.35, rotate90: rotate90 || undefined,
    };
  }

  // --- glass that is not tile (a pendant, a shower door): see-through, tinted
  //     by what was observed, and not re-lit for the reasons the metals above
  //     are not — with one more on top. The catalog holds exactly ONE clear
  //     entry (`light-pendant-glass`, L 93.8), so every darker pendant is on
  //     the same side of it and there is nothing to be ambiguous WITH; and a
  //     smoked globe and a clear one against a dark wall photograph alike, so
  //     even a one-sided library cannot say which of the two it is looking at.
  if (family === 'glass' && !slotIsTile) {
    const frosted = sheen === 'matte' || sheen === 'satin' || sheen === 'brushed';
    return { color: base, roughness: frosted ? 0.45 : 0.05, metalness: 0, transmission: frosted ? 0.6 : 0.9, ior: 1.5 };
  }

  // --- tile: real module sizes and grout, whatever the material is made of (pavers on a driveway included)
  if (TILE_FAMILY.has(family) || family === 'glass' || (slotIsTile && (tiled || obs.moduleIn))) {
    const mod = obs.moduleIn ?? defaultModuleIn(pattern, obs.slot);
    const gen = pattern === 'subway' || pattern === 'brick' ? 'running-bond' : pattern === 'hex' ? 'hex' : pattern === 'herringbone' ? 'herringbone' : 'stacked';
    const gloss = sheen === 'gloss' || sheen === 'polished' ? 0.9 : sheen === 'semi-gloss' ? 0.65 : sheen === 'satin' ? 0.4 : 0.2;
    const variation = pattern === 'zellige' ? 0.32 : family === 'glass-tile' || family === 'glass' ? 0.08 : family === 'stone-tile' || family === 'concrete' ? 0.12 : 0.06;
    const small = pattern === 'hex' || pattern === 'mosaic';
    return {
      procedural: {
        kind: 'tile',
        options: {
          tileW: Math.max(MIN_MODULE_M, Math.max(mod.w, mod.h) * IN), tileH: Math.max(MIN_MODULE_M, Math.min(mod.w, mod.h) * IN), color: base,
          colorAlt: pattern === 'checker' ? (accent ?? (lightness(base) > 50 ? '#26262A' : '#EFEEE9')) : accent ?? (pattern === 'zellige' ? shade(base, 0.94) : undefined),
          grout: obs.groutColorHex ?? autoGrout(base), pattern: gen, variation, gloss, groutM: small ? 0.0025 : 0.003, seed, checker: pattern === 'checker',
        },
        reliefStrength: 3.0, jointRoughness: 0.85,
      },
      roughness: fin.roughness, metalness: 0, clearcoat: fin.clearcoat, clearcoatRoughness: fin.clearcoatRoughness, normalScale: 0.5,
    };
  }

  // --- slab stone (and a slab backsplash of the same)
  if (SLAB_STONE.has(family) || (slotIsTile && (pattern === 'veined' || pattern === 'speckled'))) {
    const speckled = family === 'granite' || family === 'terrazzo' || pattern === 'speckled';
    const vein = accent ?? (lightness(base) > 50 ? shade(base, 0.72) : shade(base, 1.6));
    const intensity = pattern === 'veined' ? 0.9 : speckled ? 0.12 : pattern === 'solid' ? 0.12 : 0.4;
    return {
      procedural: {
        kind: 'slab',
        options: {
          base, vein, vein2: mix(vein, base, 0.5), intensity, veinCount: pattern === 'veined' ? 6 : 2, seed, spanM: family === 'terrazzo' ? 1.0 : speckled ? 1.2 : 2.4,
          ...(speckled ? { speckle: family === 'terrazzo' ? 0.9 : 1.0, speckleColor: vein, speckleRadiusM: family === 'terrazzo' ? 0.007 : 0.0022, speckleColor2: shade(base, 1.25), speckleColor3: mix(vein, base, 0.6) } : {}),
        },
        reliefStrength: 0.4,
      },
      roughness: fin.roughness, metalness: family === 'granite' ? 0.02 : 0, clearcoat: fin.clearcoat, clearcoatRoughness: fin.clearcoatRoughness, normalScale: 0.12, envMapIntensity: 1.1,
    };
  }

  // --- fabric
  if (family === 'fabric') return { color: base, roughness: 0.95, metalness: 0, sheen: 0.7 };

  // --- lap / board-and-batten siding at its real reveal
  if (family === 'siding' && (pattern === 'lap' || pattern === 'board-batten' || pattern === 'solid')) {
    const batten = pattern === 'board-batten';
    const exposureM = batten ? 0.3 : Math.max(MIN_MODULE_M, (obs.moduleIn?.w ?? 6) * IN);
    return {
      procedural: { kind: 'siding', options: { exposureM, color: base, seed, ...(batten ? { batten: true, battenSpacingM: 0.406 } : {}) }, reliefStrength: 2.4, jointRoughness: 0.75 },
      roughness: sheen === 'gloss' || sheen === 'semi-gloss' ? 0.45 : 0.62, metalness: 0,
    };
  }

  // --- siding / brick / stucco / shingle / anything else: the nearest recipe, re-coloured
  const near = nearest.pbr;
  if (near.procedural) {
    const key = 'base' in near.procedural.options ? 'base' : 'color';
    return { ...near, procedural: { ...near.procedural, options: { ...near.procedural.options, [key]: base, seed } } };
  }
  return { ...near, color: base, useDiffuse: false, roughness: family === 'other' ? near.roughness : fin.roughness };
}

/**
 * Build (but do not register) the custom definition for an observation.
 * `lookingAt` is the wall the photo's camera faced; it is what turns the
 * photo-relative `plankRun` into a room-frame rotation, and it takes part in
 * the id so two directions can never share one material.
 */
export function customMaterialFor(obs: FinishObservation, nearest: MaterialDef, lookingAt?: Wall | null): MaterialDef {
  const h = hash8(observationKey(obs, lookingAt));
  const family = obs.family;
  const pavers = family === 'concrete' && isHardscapeSlot(obs.slot) && (TILED_PATTERNS.has(obs.pattern) || obs.moduleIn !== null);
  const category: MaterialCategory = family === 'other' ? nearest.category : pavers ? 'pavers' : METALS.has(family) && nearest.category === 'metal' ? 'metal' : CATEGORY_FOR_FAMILY[family];
  const slots = nearest.slots.includes(obs.slot as MaterialSlotId) ? nearest.slots : [...nearest.slots, obs.slot as MaterialSlotId];
  const desc = cleanDescription(obs) || `${obs.pattern === 'solid' ? '' : `${obs.pattern} `}${family.replace(/-/g, ' ')}`.trim();
  return {
    id: `custom-${obs.slot}-${h}`,
    name: customName(obs),
    subtitle: 'matched from photo',
    category,
    group: nearest.group,
    tier: nearest.tier,
    priceAdj: nearest.priceAdj,
    slots,
    pbr: withFlatColour(recipeFor(obs, nearest, parseInt(h.slice(0, 4), 16), plankRotate90(obs, lookingAt)), obs.baseColorHex),
    swatch: obs.baseColorHex,
    prompt: `${desc} (${obs.baseColorHex})${obs.accentColorHex ? `, ${obs.pattern === 'veined' ? 'veins' : obs.pattern === 'speckled' ? 'flecks' : 'accents'} ${obs.accentColorHex}` : ''}${obs.groutColorHex ? `, grout ${obs.groutColorHex}` : ''}`,
    tags: ['custom', 'photo', family, obs.sheen],
  };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Match results keyed by observation. Bounded like the runtime catalog: a
 * server sees a new key per distinct observation, and an evicted entry only
 * costs a re-score (~0.2 ms), never a different answer.
 */
const matchCache = new Map<string, FinishMatch>();
const MATCH_CACHE_LIMIT = 2000;

function cacheGet(key: string): FinishMatch | undefined {
  const hit = matchCache.get(key);
  if (hit) {
    // re-insert so the most recently used key is the last to go
    matchCache.delete(key);
    matchCache.set(key, hit);
  }
  return hit;
}
/** For the headless checks: how many match results are held. */
export function matchCacheSize(): number {
  return matchCache.size;
}

function cacheSet(key: string, value: FinishMatch) {
  matchCache.set(key, value);
  while (matchCache.size > MATCH_CACHE_LIMIT) {
    const oldest = matchCache.keys().next().value;
    if (oldest === undefined) break;
    matchCache.delete(oldest);
  }
}

/**
 * Pick (or synthesise) the material for one observation. `hint` is the id the
 * analyzer chose itself; it breaks ties but never overrides the colour.
 * The input is normalised first, so a raw model observation and its cleaned
 * copy in `detected.finishes` always land on the same id.
 */
/**
 * A catalog product, described the way an observation describes a surface.
 *
 * WHY THIS EXISTS. The guided intake asks some slots for a real catalog
 * product ("what is the roof?", from twelve swatches) and other slots for a
 * finish ("what family?" + "what colour?"). A few slots get BOTH forms,
 * because one orthogonal question — the floor's plank direction, the roof's
 * colour — is worth asking on top of a product. When that happened,
 * `applyIntakeAnswers` fabricated a whole observation out of its defaults
 * ('paint', '#EFECE6') to carry that one answer, and `ensureSpecMaterials`
 * then believed it: a client who picked standing-seam metal, clay tile or
 * slate got the SAME synthesised custom material every time, because a white
 * paint observation beat the product they had chosen.
 *
 * So an intake draft for a slot that already has a catalog product is seeded
 * from that product first, and only the parts the client actually stated are
 * written over it. The observation then DESCRIBES the chosen product instead
 * of replacing it, and `matchFinish` lands back on the same id.
 *
 * Returns null for an id the catalog does not have, or a procedural custom
 * (which has no product identity to describe).
 */
export function describeMaterial(id: string | null | undefined): Pick<FinishObservation, 'family' | 'baseColorHex' | 'accentColorHex' | 'pattern' | 'sheen' | 'moduleIn'> | null {
  if (!id || isCustomMaterialId(id)) return null;
  const def = CATALOG_BY_ID[id];
  if (!def) return null;
  // the family whose EXACT categories claim this material's category; `exact`
  // is what `familyScore` charges nothing for, so this is the family the
  // matcher itself considers a perfect fit
  let family: FinishFamily = 'other';
  for (const f of FAMILIES) {
    if (FAMILY_CATEGORIES[f].exact.includes(def.category)) { family = f; break; }
  }
  const sig = signatureOf(def);
  return {
    family,
    /*
     * `materialColor`, not `pbr.color`, because the description has to be the
     * one the SCORER will read back. A texture-only entry — slate, clay tile,
     * terracotta, cedar shake — carries no flat colour on the recipe at all,
     * and reading `pbr.color` alone described every one of them as the same
     * '#EFECE6' white; the observation then matched a white neighbour or
     * synthesised a white custom, which is the original bug wearing a
     * different hex. `materialColor` walks the procedural base, the pbr
     * colour, the swatch and the texture table, exactly as `score` does.
     */
    baseColorHex: materialColor(def) ?? '#EFECE6',
    // the vein / grain / second tile, so the accent term scores the product
    // against itself rather than against "no accent stated"
    accentColorHex: materialAccent(def, sig.pattern),
    pattern: sig.pattern,
    sheen: sig.roughness <= 0.25 ? 'gloss' : sig.roughness >= 0.7 ? 'matte' : 'satin',
    // the signature carries METRES; an observation carries inches
    moduleIn: sig.moduleM && sig.moduleM.w > 0 && sig.moduleM.h > 0
      ? { w: +(sig.moduleM.w / 0.0254).toFixed(2), h: +(sig.moduleM.h / 0.0254).toFixed(2) }
      : null,
  };
}

export function matchFinish(raw: FinishObservation, roomType: RoomType, hint?: string, lookingAt?: Wall | null): FinishMatch {
  const obs = normalizeObservation(raw, roomType);
  if (!obs) {
    const rawSlot = String((raw as { slot?: unknown } | null)?.slot ?? '?');
    return { id: DEFAULT_SELECTIONS[roomType]?.[rawSlot] ?? '', custom: null, deltaE: 100, reason: `${rawSlot}: observation has no usable slot or colour` };
  }
  const slot = obs.slot as MaterialSlotId;
  const key = `${roomType}|${hint ?? ''}|${observationKey(obs, lookingAt)}`;
  const cached = cacheGet(key);
  // a cache hit is only good while the material it names still resolves
  if (cached && CATALOG_BY_ID[cached.id]) return cached;

  const candidates = materialsForSlot(slot).filter((m) => !isCustomMaterialId(m.id));
  const fallback = DEFAULT_SELECTIONS[roomType]?.[slot] ?? candidates[0]?.id ?? '';
  if (!candidates.length) return { id: fallback, custom: null, deltaE: 100, reason: `${slot}: no catalog entries for this slot` };

  const byTotal = (a: Scored, b: Scored) => a.total - b.total;
  const scored = candidates.map((m) => score(obs, m, hint)).filter((s): s is Scored => s !== null).sort(byTotal);
  let result: FinishMatch;

  if (!scored.length) {
    // a family nothing in the slot can be (fabric cabinets?): the closest thing
    // by colour alone lends its recipe, re-coloured — never its identity
    const loose: FinishObservation = { ...obs, family: 'other' };
    const nearest = candidates.map((m) => score(loose, m, hint)).filter((s): s is Scored => s !== null).sort(byTotal)[0];
    const def = registerMaterial(customMaterialFor(loose, nearest.def, lookingAt));
    result = { id: def.id, custom: def, deltaE: 0, reason: `${slot}: no ${obs.family} entries for this slot — custom ${def.name} ${obs.baseColorHex} built on ${nearest.def.id} re-coloured` };
    cacheSet(key, result);
    return result;
  }

  // Two passes: the best acceptable entry of the SAME family wins outright;
  // a near family is only consulted when the exact family has nothing
  // acceptable. A single sorted list let a near-family entry beat an exact
  // one on a few ΔE of colour noise, which is how an oak floor became LVP.
  const limit = deMax(obs.family);
  // A catalog floor whose boards run the other way is the wrong floor: the
  // shared material is cached by id, so it cannot be cloned per direction, and
  // silently keeping it would drop the only reading the photo gave us. Force
  // synthesis instead — the custom recipe carries `rotate90`.
  const wantRotate = obs.plankRun && obs.plankRun !== 'diagonal' ? plankRotate90(obs, lookingAt) : null;
  const directionOk = (s: Scored) => wantRotate === null || !hasPlankDirection(s.def) || (s.def.pbr.rotate90 === true) === wantRotate;
  // colour is judged by `finishPromise` (one ΔE for a surface, hue and
  // lightness separately for a metal or clear glass); `limit` survives only as
  // the clamp on the TOTAL, which also prices pattern, module, sheen and accent.
  const acceptable = (s: Scored) => finishPromise(obs, s.def).ok && s.pattern <= 3 && s.accent <= ACCENT_LIMIT && s.total <= limit + 12 && directionOk(s);
  const exact = scored.filter((s) => s.family < 6);
  const near = scored.filter((s) => s.family >= 6);
  const pickExact = exact.find(acceptable);
  const picked = pickExact ?? near.find(acceptable);
  if (picked) {
    result = {
      id: picked.def.id, custom: null, deltaE: picked.dE,
      reason: `${slot}: ${picked.def.id} (ΔE ${picked.dE.toFixed(1)}, pattern ${picked.pattern}, module ${picked.module.toFixed(1)}, sheen ${picked.sheen.toFixed(1)}, accent ${picked.accent.toFixed(1)}${pickExact ? '' : `, near family — no ${obs.family} entry within ΔE ${limit}`})`,
    };
  } else {
    // price and slots come from the closest thing of the same family; the look comes from the photo
    const best = scored[0];
    const kin = exact[0] ?? best;
    const def = registerMaterial(customMaterialFor(obs, kin.def, lookingAt));
    const bp = finishPromise(obs, best.def);
    const why = best.pattern > 3 ? ', pattern differs'
      : best.accent > ACCENT_LIMIT ? `, accent ΔE ${(best.accent / ACCENT_W).toFixed(1)} over ${DE_ACCENT_MAX}`
      : !directionOk(best) ? ', boards run the other way'
      // a metal the catalog has no HUE for is the case metal synthesis exists
      // for; say so, because "ΔE" alone would read as the room's brightness
      : bp.kind === 'mirror' && bp.dC > dcMax(obs.family) ? `, hue ΔC ${bp.dC.toFixed(1)} over ${dcMax(obs.family)}`
      : '';
    result = {
      id: def.id, custom: def, deltaE: 0,
      reason: `${slot}: no catalog match (closest ${best.def.id} ${bp.why}${why}) — custom ${def.name} ${obs.baseColorHex}`,
    };
  }
  cacheSet(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Consistency between related slots
// ---------------------------------------------------------------------------

export interface UnifyResult {
  spec: RoomSpec;
  /** old id → the id that replaced it, for ids no slot uses any more */
  remap: Record<string, string>;
  notes: string[];
}

/**
 * The wall the photo's camera faced, which is the frame `plankRun` is told in.
 * Null (an un-analyzed spec, a hand-built fixture) means the recipe keeps its
 * own orientation, so nothing moves.
 */
function cameraLookingAt(spec: RoomSpec | null | undefined): Wall | null {
  const w = spec?.detected?.camera?.lookingAt;
  return w === 'back' || w === 'front' || w === 'left' || w === 'right' ? w : null;
}

function observedBySlot(spec: RoomSpec): Map<string, FinishObservation> {
  const out = new Map<string, FinishObservation>();
  const finishes = Array.isArray(spec.detected?.finishes) ? spec.detected.finishes : [];
  for (const raw of finishes) {
    const obs = normalizeObservation(raw, spec.roomType);
    if (obs) out.set(obs.slot, obs);
  }
  return out;
}

/** The average of two observations' base colours, or whichever exists, for picking the sibling id closest to both. */
function targetColor(a: FinishObservation | undefined, b: FinishObservation | undefined): string | null {
  if (a && b) return mix(a.baseColorHex, b.baseColorHex, 0.5);
  return a?.baseColorHex ?? b?.baseColorHex ?? null;
}

/** L* of a catalog / runtime material's base colour, null when it has none. */
function lightnessOf(id: string | undefined): number | null {
  const def = id ? CATALOG_BY_ID[id] : undefined;
  const c = def ? materialColor(def) : null;
  return c ? lightness(c) : null;
}

/**
 * The id the tall units (pantry, oven tower, fridge surround) take when the
 * analyzer read nothing off them: the base cabinets, or the uppers when the
 * kitchen is two-tone and the uppers are the lighter colour. A white pantry
 * and fridge surround over navy bases is the common photo; navy talls beside
 * white uppers is not. A clear margin (10 L*) so two readings of one oak that
 * have not been unified yet do not send the talls the wrong way.
 */
export function tallCabinetFallback(materials: Record<string, string | undefined>): string {
  const base = materials.cabinets_base ?? '';
  const upper = materials.cabinets_upper ?? '';
  if (!upper || upper === base) return base;
  const lb = lightnessOf(base), lu = lightnessOf(upper);
  return lb !== null && lu !== null && lu - lb > 10 ? upper : base;
}

/**
 * Slots that are one material in the real kitchen get ONE id in the spec.
 * The analyzer observes each slot on its own, and two readings of the same
 * white-oak cabinetry (uppers in shadow, bases lit) came back as wood-grey-oak
 * and wood-washed-oak — a two-tone kitchen the client never had.
 *
 *   cabinets_base / cabinets_upper — unified when the spec says the kitchen
 *   is not two-tone, or when both observations are the same family within
 *   ΔE 8 for textured surfaces, ΔE 1 for solid paint.
 *   countertop / island_countertop — unified when the counters were observed
 *   and the island was not (nothing said it differs), or when both readings
 *   are the same family within ΔE 6.
 *   cabinets_tall — follows the base (or upper) id it was given when it has
 *   no reading of its own, and joins the bases / uppers when its reading is
 *   the same family within its colour budget of theirs. A reading that differs (a white
 *   painted surround beside stained-oak cabinets) is exactly what the slot
 *   exists for and is never merged.
 *
 * The id kept is the one closest in colour to the average of the readings.
 * Pure: returns a new spec. Bathrooms have no sibling slots (vanity_top has
 * no counterpart), so they pass through untouched.
 */
export function unifyRelatedSlots(spec: RoomSpec): UnifyResult {
  if (!spec || spec.roomType !== 'kitchen') return { spec, remap: {}, notes: [] };
  const observed = observedBySlot(spec);
  const materials: Record<string, string> = { ...(spec.materials as unknown as Record<string, string>) };
  const remap: Record<string, string> = {};
  const notes: string[] = [];
  let twoTone = spec.cabinets?.twoTone === true;

  const pairs: Array<{ a: MaterialSlotId; b: MaterialSlotId; why: () => string | null }> = [
    {
      a: 'cabinets_base', b: 'cabinets_upper',
      why: () => {
        const oa = observed.get('cabinets_base'), ob = observed.get('cabinets_upper');
        const d = oa && ob && oa.family === ob.family ? deltaE(oa.baseColorHex, ob.baseColorHex) : null;
        const limit = oa ? surfaceColorMax(oa.family) : DE_SURFACE_MAX;
        if (!twoTone) {
          // the flag is the model's word; two clearly different readings of
          // the real surfaces (navy bases under white uppers) outrank it
          if (oa && ob && (d === null || d >= limit)) return null;
          return 'kitchen is not two-tone';
        }
        if (oa && d !== null && d < limit) return `both read as ${oa.family} within ΔE ${d.toFixed(1)}`;
        return null;
      },
    },
    {
      a: 'countertop', b: 'island_countertop',
      why: () => {
        const oa = observed.get('countertop'), ob = observed.get('island_countertop');
        if (oa && !ob) return 'counters observed, island not — nothing said it differs';
        if (oa && ob && oa.family === ob.family) {
          const d = deltaE(oa.baseColorHex, ob.baseColorHex);
          if (d < 6) return `both read as ${oa.family} within ΔE ${d.toFixed(1)}`;
        }
        return null;
      },
    },
  ];

  for (const { a, b, why } of pairs) {
    const idA = materials[a], idB = materials[b];
    if (!idA || !idB || idA === idB) continue;
    const reason = why();
    if (!reason) continue;
    const target = targetColor(observed.get(a), observed.get(b));
    const dist = (id: string) => {
      const def = CATALOG_BY_ID[id];
      const c = def ? materialColor(def) : null;
      return target && c ? deltaE(target, c) : Number.POSITIVE_INFINITY;
    };
    // ties (and no readings at all) keep the base / perimeter id: it is the larger, better-lit surface
    const winner = dist(idB) < dist(idA) ? idB : idA;
    const loser = winner === idA ? idB : idA;
    materials[a] = winner;
    materials[b] = winner;
    if (a === 'cabinets_base') {
      twoTone = false;
      // talls that were only following the dropped id move with it; a
      // reading of their own (the white surround beside oak) is left alone
      if (materials.cabinets_tall === loser && !observed.get('cabinets_tall')) materials.cabinets_tall = winner;
    }
    if (!Object.values(materials).includes(loser)) remap[loser] = winner;
    notes.push(`${a}/${b}: unified to ${winner} (${reason}; was ${loser})`);
  }

  // A tall surround only shares a sibling finish within that family's colour
  // budget. Independent paint observations must keep their lightness contrast.
  const ot = observed.get('cabinets_tall');
  const tallId = materials.cabinets_tall;
  if (ot && tallId && tallId !== materials.cabinets_base && tallId !== materials.cabinets_upper) {
    for (const sib of ['cabinets_base', 'cabinets_upper'] as const) {
      const os = observed.get(sib);
      if (!os || !materials[sib] || os.family !== ot.family) continue;
      const d = deltaE(os.baseColorHex, ot.baseColorHex);
      if (d >= surfaceColorMax(ot.family)) continue;
      materials.cabinets_tall = materials[sib];
      if (!Object.values(materials).includes(tallId)) remap[tallId] = materials[sib];
      notes.push(`cabinets_tall/${sib}: unified to ${materials[sib]} (both read as ${ot.family} within ΔE ${d.toFixed(1)}; was ${tallId})`);
      break;
    }
  }

  if (!notes.length) return { spec, remap, notes };
  const next = { ...spec, materials } as unknown as KitchenSpec;
  if (next.cabinets) next.cabinets = { ...next.cabinets, twoTone };
  return { spec: next, remap, notes };
}

/**
 * Apply a set of observations to a spec: merges them into `detected.finishes`
 * (replacing any earlier observation for the same slot, keyed by the
 * normalised slot), sets `materials[slot]` from the match, registers any
 * custom materials and unifies sibling slots. Returns a new spec; never
 * mutates.
 */
export function applyFinishObservations(spec: RoomSpec, observations: FinishObservation[]): RoomSpec {
  if (!observations.length) return spec;
  const merged = observedBySlot(spec);
  const lookingAt = cameraLookingAt(spec);
  const materials: Record<string, string> = { ...(spec.materials as unknown as Record<string, string>) };
  for (const raw of observations) {
    const obs = normalizeObservation(raw, spec.roomType);
    if (!obs) continue;
    merged.set(obs.slot, obs);
    materials[obs.slot] = matchFinish(obs, spec.roomType, materials[obs.slot], lookingAt).id;
  }
  const next = { ...spec, materials, detected: { ...spec.detected, finishes: [...merged.values()] } } as unknown as RoomSpec;
  return unifyRelatedSlots(next).spec;
}

export type SlotMaterialRemap = Record<string, { from: string; to: string }>;

export interface EnsureResult {
  spec: RoomSpec | null;
  /** Unambiguous old id → new id; selection callers should also pass slotRemap. */
  remap: Record<string, string>;
  /** Slot-specific provenance when one old shared material splits into several finishes. */
  slotRemap: SlotMaterialRemap;
  notes: string[];
}

/**
 * Make sure every custom material the spec references exists in the runtime
 * catalog, and HEAL the spec where it does not: a custom id that no longer
 * resolves (the hash formula moved, or the registry evicted it and the
 * observation now produces a different id) is rewritten to what its
 * observation matches today — or the room default when the observation is
 * gone — and sibling slots are unified. Materials are fixed IN PLACE so the
 * callers that ignore the return value (routes, the analysis hook) still get
 * a consistent spec; the remap is for callers that hold selections keyed by
 * the old ids. Idempotent and cheap; call it wherever a spec enters the
 * process (store.setSpec, loadProject, rehydrate, the analyze/refine/render
 * routes, the shared-project loader).
 */
export function ensureSpecMaterials(spec: RoomSpec | null | undefined): EnsureResult {
  if (!spec || typeof spec !== 'object') return { spec: null, remap: {}, slotRemap: {}, notes: [] };
  const roomType = spec.roomType;
  const bag = spec as unknown as { materials?: Record<string, string> };
  if (!bag.materials || typeof bag.materials !== 'object') bag.materials = {};
  const materials = bag.materials;
  const before = { ...materials };
  const remap: Record<string, string> = {};
  const notes: string[] = [];

  // 1. register what every observation describes today. The hint keeps a
  //    slot that snapped to a catalog entry snapping the same way.
  const matched = new Map<string, FinishMatch>();
  const lookingAt = cameraLookingAt(spec);
  for (const [slot, obs] of observedBySlot(spec)) {
    const current = materials[slot];
    matched.set(slot, matchFinish(obs, roomType, isCustomMaterialId(current) ? undefined : current, lookingAt));
  }

  // 2. a custom id is stale when it no longer resolves, or when its own
  //    observation now produces a different id and no sibling slot produced
  //    it either (a unified sibling legitimately shares one custom id):
  //    follow the observation, else the room default
  const live = new Set([...matched.values()].map((m) => m.id));
  for (const slot of slotsFor(roomType)) {
    const id = materials[slot];
    const own = matched.get(slot)?.id;
    if (!isCustomMaterialId(id)) {
      // 2a. A CATALOG id the slot's own observation no longer matches. The
      //     observation is the photograph; the id is an answer some earlier
      //     run of the matcher cached beside it, and a spec outlives the
      //     matcher — a saved project, a share link, a fixture. Without this,
      //     a matcher fix reaches the next photo and never reaches the
      //     kitchen the client is looking at. (The current id is passed as
      //     the hint, so it keeps a 3-point edge: only a hard gate — colour,
      //     pattern, accent, plank direction — moves a slot.)
      //
      //     Deliberately NOT recorded in `remap`: remap rewrites the client's
      //     own `selections`, and a finish they picked by hand is not a stale
      //     id. `spec.materials` is what the analyzer read; `selections` is
      //     what they chose.
      if (!id || !own || own === id || !matched.has(slot)) continue;
      materials[slot] = own;
      notes.push(`materials.${slot}: ${id} no longer matches its own observation → ${own}`);
      continue;
    }
    const stale = !CATALOG_BY_ID[id] || (own !== undefined && own !== id && !live.has(id));
    if (!stale) continue;
    const next = own ?? DEFAULT_SELECTIONS[roomType]?.[slot];
    if (!next || next === id) continue;
    materials[slot] = next;
    remap[id] = next;
    notes.push(`materials.${slot}: stale custom id ${id} → ${next}${matched.has(slot) ? '' : ' (no observation to rebuild it from)'}`);
  }

  // 2b. a kitchen saved before the tall-cabinet slot existed has no id for
  //     it; without one the twin would draw the pantry in the room default
  //     (white) beside whatever the bases are. Same rule as reconcile.
  if (roomType === 'kitchen' && !materials.cabinets_tall) {
    const next = tallCabinetFallback(materials) || DEFAULT_SELECTIONS.kitchen.cabinets_tall;
    materials.cabinets_tall = next;
    notes.push(`materials.cabinets_tall: missing → ${next} (follows the ${next === materials.cabinets_upper && next !== materials.cabinets_base ? 'uppers' : 'base cabinets'})`);
  }

  // 3. one material per real surface
  const unified = unifyRelatedSlots(spec);
  if (unified.notes.length) {
    Object.assign(materials, unified.spec.materials as unknown as Record<string, string>);
    if (spec.roomType === 'kitchen' && spec.cabinets) spec.cabinets.twoTone = (unified.spec as KitchenSpec).cabinets.twoTone;
    Object.assign(remap, unified.remap);
    notes.push(...unified.notes);
  }
  const slotRemap: SlotMaterialRemap = {};
  const destinations = new Map<string, Set<string>>();
  for (const [slot, from] of Object.entries(before)) {
    const to = materials[slot];
    if (!from || !to || from === to || (!isCustomMaterialId(from) && !remap[from])) continue;
    slotRemap[slot] = { from, to };
    const ids = destinations.get(from) ?? new Set<string>();
    ids.add(to);
    destinations.set(from, ids);
  }
  // An id-only map cannot represent a split. Never expose an arbitrary last
  // winner to callers; selections follow their recorded slot's old id below.
  for (const [from, ids] of destinations) {
    if (ids.size > 1) delete remap[from];
    else remap[from] = [...ids][0];
  }
  return { spec, remap, slotRemap, notes };
}

/**
 * Bring a project's selections in line with a spec that just went through
 * ensureSpecMaterials: ids the pass rewrote follow their slot's recorded old
 * id, preserving later manual picks. The id-only remap supports legacy callers.
 * A custom id
 * with no definition falls back to the spec's material for that slot, then
 * the room default. Returns the same object when nothing changed.
 */
export function healSelections(selections: Record<string, string>, spec: RoomSpec | null | undefined, remap: Record<string, string> = {}, slotRemap?: SlotMaterialRemap): Record<string, string> {
  if (!selections) return selections;
  const materials = ((spec?.materials ?? {}) as unknown as Record<string, string>);
  const defaults: Record<string, string> = spec ? DEFAULT_SELECTIONS[spec.roomType] ?? {} : {};
  let out = selections;
  for (const [slot, id] of Object.entries(selections)) {
    const scoped = slotRemap?.[slot];
    let next = slotRemap ? (scoped?.from === id ? scoped.to : id) : remap[id] ?? id;
    if (isCustomMaterialId(next) && !CATALOG_BY_ID[next]) next = materials[slot] ?? defaults[slot] ?? next;
    if (next === id) continue;
    if (out === selections) out = { ...selections };
    out[slot] = next;
  }
  // a slot the room has but the selections do not (a project persisted
  // before the slot existed) takes the spec's material — the tall units
  // then follow the bases the way ensureSpecMaterials just decided — and
  // only then the room default
  if (spec) {
    for (const slot of slotsFor(spec.roomType)) {
      if (out[slot] !== undefined) continue;
      const next = materials[slot] ?? defaults[slot];
      if (!next) continue;
      if (out === selections) out = { ...selections };
      out[slot] = next;
    }
  }
  return out;
}
