/**
 * The per-element spec contract the fitter searches over — pendant spread /
 * offset / drop / explicit hook positions, per-run upper height, per-cabinet
 * upper height, tall units to the ceiling, stool pitch / end seats / end
 * placement / end overhang / stool offset, appliance heights, the cabinet
 * above the hood, the backsplash height in inches, the counter overhang, the
 * detail layer (decor.items, decor.cabinetContents), the second tier of wall
 * cabinets (runs[].uppers2 / uppers2HeightIn), the stool seat's shape and
 * colour, a finish observation's plank direction, the truncation flags on a
 * photo box (elements[].open / openCause), the detector's own repeatability,
 * what the upload was (detected.inputKind), and — since the bathroom got a
 * contract that can describe a bathroom — the vanity's front, the shower's
 * glass and door, the tub's material and filler, the wall tile's pattern /
 * module / numeric height and its accent wall, and the accessories list.
 * Every one of them means "let the scene decide" when it is 0
 * or null — `cabinetAbove: null` specifically means "by hood style",
 * `uppers2: null` means one tier, `seatShape: null` a round pad, `plankRun:
 * null` the recipe's own orientation — so a spec written before the fields
 * existed still draws the same twin once they are filled in. The one field
 * that is INFERRED rather than defaulted is `open`: a box touching the frame
 * edge was cut by the picture whether or not the annotator said so (see
 * @/lib/spec/photo-box). `healContract` does that filling, in place,
 * so the zod schema (which requires the fields), the layout and the fitter
 * all read one spec. Never called on the caller's object by the fitter —
 * only on its own clones.
 */
import { computeKitchenLayout } from '@/components/scene/kitchen/layout';
import { readKind } from '@/lib/spec/decor-items';
import { CABINET_ABOVE } from '@/lib/spec/hood';
import type { BathAccessory, BathroomSpec, CabinetContents, DecorItem, DecorSpec, KitchenSpec, RoomSpec } from '@/lib/spec/types';
import { NO_OPEN_EDGES, resolveOpen } from '@/lib/spec/photo-box';
import { parseHex } from '@/lib/materials/color';
import { healFloorPlan, isSingleRoom } from '@/lib/spec/floorplan';

type Stools = NonNullable<DecorSpec['stools']>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bound = (v: unknown, lo: number, hi: number): number => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : 0);
const END_PLACEMENTS: readonly string[] = ['auto', 'left', 'right', 'both'];
const PLANK_RUNS: readonly string[] = ['toward', 'across', 'diagonal'];
const SEAT_SHAPES: readonly string[] = ['round', 'square'];
const INPUT_KINDS: readonly string[] = ['room-photo', 'empty-lot', 'floor-plan', 'plans-document'];

/**
 * How many stools the scene used to put round the island's end before the
 * spec could say: none under three seats, two on four or more when the top
 * is wide enough to sit side by side, else one. The layout's own guess also
 * asks whether the floor beyond the end is clear — `drawnEndSeats` reads
 * that off the solved layout; this is the fallback for a spec the layout
 * cannot solve.
 */
export function legacyEndSeats(isl: Partial<KitchenSpec['island']> | null | undefined): number {
  if (!isl || typeof isl !== 'object') return 0;
  const seating = isNum(isl.seating) ? Math.round(isl.seating) : 0;
  if (seating < 3) return 0;
  const topWideIn = (isNum(isl.widthFt) ? isl.widthFt : 3.5) * 12 + 1.5 + (isNum(isl.overhangIn) ? isl.overhangIn : 12);
  return seating >= 4 && topWideIn >= 40 ? 2 : 1;
}

/**
 * How many stools the scene draws round the island's end for a spec that
 * does not say: the layout's guess, which also asks whether the floor beyond
 * the end is clear (an island against a wall seats nobody there) — so a
 * legacy spec healed with this keeps drawing exactly the island it drew.
 * Null when the layout cannot be solved.
 */
export function drawnEndSeats(spec: Partial<KitchenSpec>): number | null {
  try {
    const isl = computeKitchenLayout(spec as KitchenSpec).island;
    return isl && isNum(isl.endSeats) ? Math.max(0, Math.round(isl.endSeats)) : 0;
  } catch {
    return null;
  }
}

/** Fill the contract fields a spec lacks with their "auto" values, in place; returns the same object. */
export function healContract<T extends RoomSpec>(spec: T): T {
  if (!spec || typeof spec !== 'object') return spec;
  // A floor plan's contract is its own geometry, and `healFloorPlan` is the
  // one place that knows it: overlapping walls, an unclosed polygon, a door on
  // a wall that is not there, a stair to a level nobody drew. Everything below
  // this line is about a photographed room and means nothing on a plan.
  if (spec.roomType === 'floorplan') {
    spec.levels = healFloorPlan(spec.levels);
    if (spec.detected && typeof spec.detected === 'object') {
      if (spec.detected.inventory == null) spec.detected.inventory = null;
      if (!INPUT_KINDS.includes(spec.detected.inputKind as string)) spec.detected.inputKind = 'floor-plan';
      // a drawing carries no finish observation; see applyPlanLimits
      if (!Array.isArray(spec.detected.finishes)) spec.detected.finishes = [];
      if (!Array.isArray(spec.detected.elements)) spec.detected.elements = [];
    }
    return spec;
  }
  // an inventory boxed before the `facing` cue existed: unknown, not wrong
  const elements = spec.detected && typeof spec.detected === 'object' && Array.isArray(spec.detected.elements) ? spec.detected.elements : null;
  if (elements) {
    for (const e of elements) {
      if (!e || typeof e !== 'object') continue;
      if (e.facing === undefined) e.facing = null;
      // A box drawn before truncation could be said still ran off the picture
      // where it touches the frame — the inventory prompt has always told the
      // annotator to stop at the edge — so the frame case is recovered here.
      // Same helper the reconciler uses, so the two can never disagree.
      if (e.box && typeof e.box === 'object') {
        const r = resolveOpen(e.box, e.open, e.openCause);
        e.open = r.open;
        e.openCause = r.openCause;
      } else {
        e.open = { ...NO_OPEN_EDGES };
        e.openCause = null;
      }
    }
  }
  // a plank direction nobody recorded leaves the recipe's own orientation
  const finishes = spec.detected && typeof spec.detected === 'object' && Array.isArray(spec.detected.finishes) ? spec.detected.finishes : null;
  if (finishes) for (const f of finishes) if (f && typeof f === 'object' && !PLANK_RUNS.includes(f.plankRun as string)) f.plankRun = null;
  // the server writes the inventory's repeatability; a spec that never met it says nothing
  if (spec.detected && typeof spec.detected === 'object' && spec.detected.inventory == null) spec.detected.inventory = null;
  // a spec that never met the classifier described a room somebody photographed
  if (spec.detected && typeof spec.detected === 'object' && !INPUT_KINDS.includes(spec.detected.inputKind as string)) spec.detected.inputKind = 'room-photo';
  if (isSingleRoom(spec) && spec.decor && typeof spec.decor === 'object') {
    for (const shelf of Array.isArray(spec.decor.shelves) ? spec.decor.shelves : []) {
      if (!shelf || typeof shelf !== 'object') continue;
      shelf.finishColorHex = parseHex(shelf.finishColorHex);
      const enclosure = shelf.enclosure;
      if (!enclosure || typeof enclosure !== 'object' || !isNum(enclosure.heightIn)) shelf.enclosure = null;
      else shelf.enclosure = {
        heightIn: bound(enclosure.heightIn, 12, 120),
        backPanel: enclosure.backPanel === true,
        panelThicknessIn: isNum(enclosure.panelThicknessIn) ? bound(enclosure.panelThicknessIn, 0.25, 2) : null,
        rotationDeg: [-90, 0, 90, 180].includes(enclosure.rotationDeg as number) ? enclosure.rotationDeg : null,
      };
    }
    const d = spec.decor as { items?: DecorItem[]; cabinetContents?: CabinetContents[]; stools?: Stools | null };
    if (!Array.isArray(d.items)) d.items = [];
    // An entry naming a thing that is not an object standing on a surface —
    // the wall pot filler the live tan run wrote, a faucet, an outlet, a
    // cabinet pull — is a mis-read that draws a stock pot on the counter.
    // `itemsFromInventory` (which every ANALYSIS path runs through
    // `reconcileSpec`) already drops it, but a project persisted before that
    // rule existed only ever meets this pass on reopening. Same predicate, so
    // the two normalisers cannot disagree. Prune only: synthesising the
    // missing items is the reconciler's job, not a healer's.
    else d.items = d.items.filter((i) => !!i && typeof i === 'object' && readKind(i.label).kind !== null);
    if (!Array.isArray(d.cabinetContents)) d.cabinetContents = [];
    // a round pad in the seat material's stock colour is the only stool the
    // scene has ever drawn, so "not said" and "as before" are the same answer
    if (d.stools && typeof d.stools === 'object') {
      if (!SEAT_SHAPES.includes(d.stools.seatShape as string)) d.stools.seatShape = null;
      // the same repair the reconciler applies, so the two normalisers agree:
      // a colour word or an annotated hex is not a colour the scene can use,
      // and "unreadable" has to keep meaning "the seat material's own colour"
      d.stools.seatColorHex = parseHex(d.stools.seatColorHex);
    }
  }
  if (spec.roomType === 'bathroom') return healBathroom(spec as unknown as BathroomSpec) as unknown as T;
  if (spec.roomType !== 'kitchen') return spec;
  const k = spec as unknown as Partial<KitchenSpec>;
  if (Array.isArray(k.runs)) {
    for (const r of k.runs) {
      if (!r || typeof r !== 'object') continue;
      if (!isNum(r.upperHeightIn)) r.upperHeightIn = null;
      r.upperBottomIn = isNum(r.upperBottomIn) ? bound(r.upperBottomIn, 24, 228) : null;
      if (Array.isArray(r.uppers)) for (const u of r.uppers) if (u && typeof u === 'object' && !isNum(u.heightIn)) u.heightIn = null;
      // one tier is what every spec written before uppers2 existed described.
      // A stacked run is two rows, never one row hung at the top, so a tier 2
      // without a tier 1 is not a stacked run — the same rule `refitRun`
      // applies, because the two normalisers have to be interchangeable.
      if (!Array.isArray(r.uppers) || r.uppers.length === 0 || !Array.isArray(r.uppers2) || r.uppers2.length === 0) r.uppers2 = null;
      else for (const u of r.uppers2) if (u && typeof u === 'object' && !isNum(u.heightIn)) u.heightIn = null;
      // …and a split height with nothing to split is not a number the row means
      if (r.uppers2 === null || !isNum(r.uppers2HeightIn)) r.uppers2HeightIn = null;
      if (Array.isArray(r.tall)) for (const t of r.tall) if (t && typeof t === 'object' && typeof t.toCeiling !== 'boolean') t.toCeiling = null;
    }
  }
  if (k.island && typeof k.island === 'object') {
    if (!isNum(k.island.stoolPitchIn)) k.island.stoolPitchIn = 0;
    // the count the scene drew for this spec before the field existed, read
    // off the layout (which also knows whether the end has floor to sit at)
    if (!isNum(k.island.endSeats)) k.island.endSeats = drawnEndSeats(k) ?? legacyEndSeats(k.island);
    if (!END_PLACEMENTS.includes(k.island.endPlacement as string)) k.island.endPlacement = 'auto';
    if (!isNum(k.island.endOverhangIn)) k.island.endOverhangIn = null;
    if (!isNum(k.island.stoolOffsetIn)) k.island.stoolOffsetIn = 0;
  }
  if (Array.isArray(k.appliances)) {
    for (const a of k.appliances) {
      if (!a || typeof a !== 'object') continue;
      if (!isNum(a.heightIn)) a.heightIn = null;
      if (!isNum(a.aboveCounterIn)) a.aboveCounterIn = null;
      // a word only a hood can carry; anything else (and any garbage) is "by hood style"
      a.cabinetAbove = a.kind === 'hood' && (CABINET_ABOVE as readonly string[]).includes(a.cabinetAbove as string) ? a.cabinetAbove : null;
    }
  }
  if (k.backsplash && typeof k.backsplash === 'object' && !isNum(k.backsplash.heightIn)) k.backsplash.heightIn = null;
  if (k.countertop && typeof k.countertop === 'object' && !isNum(k.countertop.overhangIn)) k.countertop.overhangIn = null;
  const p = k.lighting && typeof k.lighting === 'object' ? k.lighting.pendants : null;
  if (p && typeof p === 'object') {
    if (!isNum(p.spreadFt)) p.spreadFt = 0;
    if (!isNum(p.offsetFt)) p.offsetFt = 0;
    if (!isNum(p.aboveCounterIn)) p.aboveCounterIn = 0;
    // healContract exists so a persisted spec still PARSES: a hook past ±20 ft,
    // or a non-object in the list, would 400 the very routes it guards
    if (Array.isArray(p.positions)) {
      const pts = p.positions
        .filter((q): q is { alongFt: number; acrossFt: number } => !!q && typeof q === 'object')
        .slice(0, 12)
        .map((q) => ({ alongFt: bound(q.alongFt, -20, 20), acrossFt: bound(q.acrossFt, -10, 10) }));
      p.positions = pts.length ? pts : null;
    } else p.positions = null;
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Bathroom
// ---------------------------------------------------------------------------

const ACCESSORY_KINDS: readonly string[] = ['towel-bar', 'towel-ring', 'hook', 'robe-hook', 'grab-bar', 'toilet-paper-holder', 'towel-warmer', 'shower-caddy', 'corner-shelf'];
const FIXTURE_FINISHES: readonly string[] = ['chrome', 'brushed-nickel', 'polished-nickel', 'matte-black', 'brushed-gold', 'polished-brass', 'oil-rubbed-bronze', 'stainless', 'white', 'black'];
const TILE_PATTERNS: readonly string[] = ['stacked', 'running-bond', 'vertical-stack', 'herringbone', 'chevron', 'basketweave', 'hex', 'penny', 'mosaic', 'large-format', 'slab'];
const WALLS: readonly string[] = ['back', 'left', 'right', 'front'];
const NICHE_FACES: readonly string[] = ['back', 'left', 'right'];

const word = (v: unknown, allowed: readonly string[]): string | null => (typeof v === 'string' && allowed.includes(v) ? v : null);
/** a module is two positive numbers or nothing at all — half a module is not a module */
const tileModule = (v: unknown): { w: number; h: number } | null => {
  if (!v || typeof v !== 'object') return null;
  const m = v as { w?: unknown; h?: unknown };
  return isNum(m.w) && isNum(m.h) && m.w > 0 && m.h > 0 ? { w: m.w, h: m.h } : null;
};

/**
 * The bathroom half of the contract: the vanity's front, the shower's glass
 * and door, the tub's material and filler, the wall tile's pattern / module /
 * numeric height and its accent wall, and the accessories list.
 *
 * Same rule as the kitchen half — every field means "let the scene decide"
 * when it is null, so a spec written before these existed heals to exactly
 * the bathroom it drew. This runs on every route that takes a spec, so it
 * must also make the object PARSE: a garbage niche or an accessory on a wall
 * that is not a wall would 400 /api/refine and drop the client's bathroom for
 * the template, which is the failure the healer exists to prevent.
 */
function healBathroom(b: BathroomSpec): BathroomSpec {
  const v = b.vanity as Record<string, unknown> | undefined;
  if (v && typeof v === 'object') {
    if (!isNum(v.drawers)) v.drawers = null; else v.drawers = Math.round(bound(v.drawers, 0, 12));
    if (!isNum(v.doors)) v.doors = null; else v.doors = Math.round(bound(v.doors, 0, 8));
    v.legStyle = word(v.legStyle, ['none', 'tapered', 'turned', 'square', 'hairpin', 'plinth']);
    v.counterThicknessIn = isNum(v.counterThicknessIn) ? bound(v.counterThicknessIn, 0.5, 6) : null;
    v.backsplash = word(v.backsplash, ['none', 'standard', 'full-height', 'integrated']);
    v.heightIn = isNum(v.heightIn) ? bound(v.heightIn, 24, 42) : null;
    v.depthIn = isNum(v.depthIn) ? bound(v.depthIn, 12, 30) : null;
    v.basin = word(v.basin, ['undermount', 'integrated', 'vessel', 'semi-recessed', 'drop-in']);
    v.faucetMount = word(v.faucetMount, ['deck', 'wall', 'widespread', 'centerset', 'single-hole']);
    v.hardware = word(v.hardware, ['pulls', 'knobs', 'mixed', 'integrated', 'none']);
    v.openShelf = typeof v.openShelf === 'boolean' ? v.openShelf : null;
  }

  const sh = b.shower as Record<string, unknown> | undefined;
  if (sh && typeof sh === 'object') {
    sh.glassThicknessIn = isNum(sh.glassThicknessIn) ? bound(sh.glassThicknessIn, 0.12, 0.75) : null;
    sh.doorType = word(sh.doorType, ['hinged', 'sliding', 'barn', 'pivot', 'fixed-panel', 'walk-in', 'none']);
    sh.hardwareFinish = word(sh.hardwareFinish, FIXTURE_FINISHES);
    sh.benchStyle = word(sh.benchStyle, ['corner', 'full-width', 'floating']);
    sh.curbHeightIn = isNum(sh.curbHeightIn) ? bound(sh.curbHeightIn, 0, 12) : null;
    const n = sh.nicheAt as Record<string, unknown> | null | undefined;
    sh.nicheAt = n && typeof n === 'object' && word(n.face, NICHE_FACES)
      ? {
          face: word(n.face, NICHE_FACES) as 'back' | 'left' | 'right',
          t: isNum(n.t) ? bound(n.t, 0, 1) : 0.5,
          centerIn: isNum(n.centerIn) ? bound(n.centerIn, 12, 96) : 48,
          widthIn: isNum(n.widthIn) ? bound(n.widthIn, 6, 60) : 24,
          heightIn: isNum(n.heightIn) ? bound(n.heightIn, 6, 60) : 14,
          shelves: isNum(n.shelves) ? Math.round(bound(n.shelves, 0, 4)) : 0,
        }
      : null;
  }

  const t = b.tub as Record<string, unknown> | undefined;
  if (t && typeof t === 'object') {
    t.material = word(t.material, ['acrylic', 'cast-iron', 'stone-resin', 'solid-surface', 'copper', 'fiberglass', 'steel', 'wood']);
    t.fillerType = word(t.fillerType, ['deck-mount', 'wall-mount', 'floor-mount', 'roman', 'tub-shower-diverter', 'none']);
    t.fillerFinish = word(t.fillerFinish, FIXTURE_FINISHES);
    t.apron = word(t.apron, ['integral', 'tiled', 'panel', 'skirted', 'none']);
    t.widthIn = isNum(t.widthIn) ? bound(t.widthIn, 24, 60) : null;
    t.heightIn = isNum(t.heightIn) ? bound(t.heightIn, 12, 36) : null;
  }

  const wc = b.toilet as Record<string, unknown> | undefined;
  if (wc && typeof wc === 'object') wc.trimFinish = word(wc.trimFinish, FIXTURE_FINISHES);

  const wt = b.wallTile as Record<string, unknown> | undefined;
  if (wt && typeof wt === 'object') {
    wt.heightIn = isNum(wt.heightIn) ? bound(wt.heightIn, 6, 240) : null;
    wt.pattern = word(wt.pattern, TILE_PATTERNS);
    wt.moduleIn = tileModule(wt.moduleIn);
    wt.groutWidthIn = isNum(wt.groutWidthIn) ? bound(wt.groutWidthIn, 0, 0.75) : null;
    wt.trim = word(wt.trim, ['none', 'bullnose', 'pencil', 'chair-rail', 'metal-edge']);
    wt.showerPattern = word(wt.showerPattern, TILE_PATTERNS);
    wt.showerModuleIn = tileModule(wt.showerModuleIn);
    const a = wt.accent as Record<string, unknown> | null | undefined;
    // an accent needs a wall AND a pattern to be an accent; without both it is
    // the field tile, which is what `accent: null` has always meant
    wt.accent = a && typeof a === 'object' && word(a.wall, WALLS) && word(a.pattern, TILE_PATTERNS)
      ? {
          wall: word(a.wall, WALLS) as BathroomSpec['vanity']['wall'],
          pattern: word(a.pattern, TILE_PATTERNS) as NonNullable<BathroomSpec['wallTile']['pattern']>,
          moduleIn: tileModule(a.moduleIn),
          heightIn: isNum(a.heightIn) ? bound(a.heightIn, 12, 240) : null,
          colorHex: parseHex(a.colorHex),
        }
      : null;
  }

  const raw = (b as unknown as { accessories?: unknown }).accessories;
  const acc: BathAccessory[] = (Array.isArray(raw) ? raw : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .slice(0, 10)
    .map((x) => ({
      kind: (word(x.kind, ACCESSORY_KINDS) ?? 'towel-bar') as BathAccessory['kind'],
      wall: (word(x.wall, WALLS) ?? 'back') as BathAccessory['wall'],
      t: isNum(x.t) ? bound(x.t, 0, 1) : 0.5,
      heightFt: isNum(x.heightFt) ? bound(x.heightFt, 0.5, 8) : 4,
      widthIn: isNum(x.widthIn) ? bound(x.widthIn, 3, 48) : null,
      finish: word(x.finish, FIXTURE_FINISHES) as BathAccessory['finish'],
    }));
  (b as unknown as { accessories: BathAccessory[] }).accessories = acc;
  return b;
}
