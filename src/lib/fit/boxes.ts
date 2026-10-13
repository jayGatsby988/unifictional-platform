/**
 * World-space boxes for everything the photo inventory can see, derived from
 * the layout solvers' output — so a base run, the fridge, each window, each
 * pendant, each stool, each shelf has one axis-aligned box in the room frame
 * that the fitter can project into the photo and compare with the inventory.
 *
 * Everything here is read off the SOLVED layout (KitchenLayoutData /
 * BathLayout), never off the spec, so the boxes are exactly where the scene
 * draws the geometry: a run the solver pulled back at a corner, an island it
 * shrank, a shelf it slid past a window all project where they are drawn.
 *
 * The pendants' hooks, the shades' drop and the stools' seats come from the
 * layout's own `pendantPositions` / `pendantDrop` / `stoolPositions` (the
 * scene draws from the same functions), re-exported here so the check script
 * and the studio reach them through one door.
 *
 * THE CONSTANTS BELOW FOLLOW THE INVENTORY MODEL'S HABITS, NOT `BOX_RULES`.
 * A shelf board's box includes the feet of what stands on it because that is
 * what the model draws; the hood is boxed by its canopy FRONT because the
 * model outlines the canopy and leaves the duct cover behind it out. They
 * were calibrated on two client photos and must be re-derived on at least
 * five real inventories if the annotator model changes — a model that starts
 * obeying `BOX_RULES` literally will move them a few points either way.
 */
import { subtractIntervals, type BathLayout, type LAccessory, type LShower } from '@/components/scene/bathroom/layout';
import { hoodExtents, pendantDrop, pendantPositions, stoolPositions, type KIsland, type KitchenLayoutData, type KRun } from '@/components/scene/kitchen/layout';
import { onWall } from '@/components/scene/geometry';
import type { BathAccessoryKind, PhotoElementKind, Wall } from '@/lib/spec/types';
import { inch } from '@/lib/units';
import { shelfFootprint } from '@/components/scene/shelf-frame';
import type { AABB, Box4, Pinhole, Vec3 } from './camera';

export { pendantDrop, pendantPositions, stoolPositions };

export interface TwinElement {
  kind: PhotoElementKind;
  /** the wall it sits against, 'island' for island things, null for free-standing / ceiling-hung */
  wall: Wall | 'island' | null;
  /** 0-based position among the twin's elements of this kind (+ wall) */
  index: number;
  box: AABB;
  /**
   * When set, the element projects as the UNION of these boxes instead of
   * `box`: a floor-standing cabinet or appliance is outlined in a photo from
   * the front edge of its top down to the floor line at the WALL — its
   * front-bottom edge is behind the island, the stools or the toe-kick's
   * shadow — so it carries its top slab and its back face, not its front-
   * bottom corners.
   */
  faces?: AABB[];
  /**
   * The box this element shows a photo element of ANOTHER kind in its
   * family: a range paired with a photo's "cooktop" is judged on its top —
   * the burners and the strip of front below them — not on its whole body.
   */
  alt?: { kind: PhotoElementKind; box: AABB };
}

const WALLS: readonly Wall[] = ['back', 'left', 'right', 'front'];

/** Thickness given to things that live ON a wall plane (openings, splash, art), so they still have a volume. */
const ON_WALL = 0.04;
/** How far above a shelf board its photo box reaches (the shadow line and the feet of what stands on it). */
const SHELF_BOX_ABOVE = 0.16;
/** how far onto the counter a photo's backsplash box reaches */
const SPLASH_COUNTER_STRIP = 0.22;
/** how thick the top slab and the back face of a floor-standing element's photo faces are */
const FACE_T = 0.05;
/** how far below a range's top a photo's "cooktop" box reaches (the control strip) */
const COOKTOP_STRIP = 0.22;
/** half-width of a stool's photo box (legs splayed, a back) */
const STOOL_R = 0.25;
/** a sink's photo box: the rim plus the counter strip round it, and an apron front's full depth */
const SINK_ABOVE = 0.08;
const SINK_BELOW = 0.06;
const SINK_APRON = 0.25;
/** a faucet's photo box: a gooseneck's arc */
const FAUCET_H = 0.42;
const FAUCET_R = 0.09;

function box(a: Vec3, b: Vec3): AABB {
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

function wallLen(wall: Wall, w: number, d: number): number { return wall === 'back' || wall === 'front' ? w : d; }

/**
 * Box against a wall: `x0..x1` wall-local centred (left→right facing the
 * wall), `z0..z1` distance into the room from the wall plane, `y0..y1` height.
 */
function wallBox(wall: Wall, w: number, d: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): AABB {
  const len = wallLen(wall, w, d);
  const a = onWall(wall, w, d, (x0 + len / 2) / len, y0, z0);
  const b = onWall(wall, w, d, (x1 + len / 2) / len, y1, z1);
  return box(a, b);
}

/** Local island coordinates (x along the long axis, z across) → world XZ, turned by the island's yaw. */
function islandPoint(isl: KIsland, x: number, z: number): [number, number] {
  const c = Math.cos(isl.yaw), s = Math.sin(isl.yaw);
  return [isl.cx + x * c + z * s, isl.cz - x * s + z * c];
}

function islandBox(isl: KIsland, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): AABB {
  const [ax, az] = islandPoint(isl, x0, z0);
  const [bx, bz] = islandPoint(isl, x1, z1);
  const [cx, cz] = islandPoint(isl, x0, z1);
  const [dx, dz] = islandPoint(isl, x1, z0);
  return {
    min: [Math.min(ax, bx, cx, dx), Math.min(y0, y1), Math.min(az, bz, cz, dz)],
    max: [Math.max(ax, bx, cx, dx), Math.max(y0, y1), Math.max(az, bz, cz, dz)],
  };
}

/** A floor-standing element against a wall: its whole box, plus the top slab and back face it is outlined by. */
function standing(wall: Wall, w: number, d: number, x0: number, x1: number, y0: number, top: number, depth: number): { box: AABB; faces: AABB[] } {
  return {
    box: wallBox(wall, w, d, x0, x1, y0, top, 0, depth),
    faces: [
      wallBox(wall, w, d, x0, x1, Math.max(y0, top - FACE_T), top, 0, depth),
      wallBox(wall, w, d, x0, x1, y0, top, 0, Math.min(depth, FACE_T)),
    ],
  };
}

/**
 * The walls, floor and ceiling. A wall is outlined where it can be SEEN: a
 * pantry or a fridge surround standing floor-to-ceiling against it hides
 * that stretch, and the photo's wall box stops at the cabinet — so each wall
 * carries its visible stretches as faces (`hidden` = wall-local centred x
 * spans covered by tall units reaching the ceiling).
 */
function shellBoxes(w: number, d: number, h: number, hidden: Partial<Record<Wall, Array<[number, number]>>> = {}): TwinElement[] {
  const out: TwinElement[] = [];
  WALLS.forEach((wall, i) => {
    const len = wallLen(wall, w, d);
    const box = wallBox(wall, w, d, -len / 2, len / 2, 0, h, 0, ON_WALL);
    const cover = (hidden[wall] ?? []).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    const faces: AABB[] = [];
    let x = -len / 2;
    for (const [a, b] of cover) {
      if (a > x + 0.05) faces.push(wallBox(wall, w, d, x, a, 0, h, 0, ON_WALL));
      x = Math.max(x, b);
    }
    if (len / 2 > x + 0.05) faces.push(wallBox(wall, w, d, x, len / 2, 0, h, 0, ON_WALL));
    out.push({ kind: 'wall', wall, index: i, box, ...(cover.length && faces.length ? { faces } : {}) });
  });
  out.push({ kind: 'floor', wall: null, index: 0, box: box([-w / 2, 0, -d / 2], [w / 2, 0.01, d / 2]) });
  out.push({ kind: 'ceiling', wall: null, index: 0, box: box([-w / 2, h - 0.01, -d / 2], [w / 2, h, d / 2]) });
  return out;
}

/** Counts per (kind, wall) so repeated things get stable indices. */
class Indexer {
  private n = new Map<string, number>();
  next(kind: PhotoElementKind, wall: Wall | 'island' | null): number {
    const k = `${kind}|${wall ?? ''}`;
    const i = this.n.get(k) ?? 0;
    this.n.set(k, i + 1);
    return i;
  }
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

/**
 * A row of cabinets as the stretches a photo would box: one box per run of
 * cabinets, split only where a WINDOW or DOORWAY on the wall interrupts the
 * row (the uppers either side of a window are two things to a photo; the
 * uppers either side of a hood or a pantry are one row with something in
 * it, and the inventory boxes them as one). `gap` is the least clear wall
 * between two cabinets that counts as a break.
 */
function rowSegments(cabs: Array<{ x0: number; x1: number }>, cuts: Array<[number, number]>, gap = 0.3): Array<[number, number]> {
  const sorted = [...cabs].sort((a, b) => a.x0 - b.x0);
  const out: Array<[number, number]> = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    const breaks = !!last && c.x0 - last[1] > gap && cuts.some(([a, b]) => a < c.x0 && b > last[1]);
    if (last && !breaks) last[1] = Math.max(last[1], c.x1);
    else out.push([c.x0, c.x1]);
  }
  return out;
}

function runBoxes(L: KitchenLayoutData, r: KRun, ix: Indexer, out: TwinElement[]) {
  const { w, d } = L;
  const openingsOn = (kinds: Array<'window' | 'door' | 'passage'>): Array<[number, number]> => L.openings
    .filter((o) => o.wall === r.wall && kinds.includes(o.kind))
    .map((o): [number, number] => [o.x - o.width / 2, o.x + o.width / 2]);
  for (const [x0, x1] of rowSegments(r.base.length ? r.base : [{ x0: r.x0, x1: r.x1 }], openingsOn(['door', 'passage']))) {
    out.push({ kind: 'base-cabinet-run', wall: r.wall, index: ix.next('base-cabinet-run', r.wall), ...standing(r.wall, w, d, x0, x1, 0, L.counterTopY, r.counterDepth) });
  }
  if (r.hasUppers && r.uppers.length) {
    // A plain hood chase below a separately observed closed row belongs to
    // the hood assembly, not to that row's photo bounding box.
    const upperRow = r.uppers.filter((u) => !(u.type === 'hood-cabinet' && u.hood?.front === 'panel' && u.top <= r.upperBottom + 1e-4));
    for (const [ux0, ux1] of rowSegments(upperRow, openingsOn(['window', 'door', 'passage']))) {
      const boxes = upperRow.filter((u) => u.x0 < ux1 - 1e-4 && u.x1 > ux0 + 1e-4 && u.type !== 'appliance-gap' && u.type !== 'hood-gap');
      if (!boxes.length) continue;
      const bottom = Math.min(...boxes.map((u) => u.bottom));
      const top = Math.max(...boxes.map((u) => u.top + (u.top >= r.upperTop - 1e-4 ? L.crownH : 0)));
      out.push({ kind: 'upper-cabinet-run', wall: r.wall, index: ix.next('upper-cabinet-run', r.wall), box: wallBox(r.wall, w, d, ux0, ux1, bottom, top, 0, r.upperDepth) });
    }
  }
  for (const t of r.tall) {
    out.push({ kind: 'tall-cabinet', wall: r.wall, index: ix.next('tall-cabinet', r.wall), ...standing(r.wall, w, d, t.x0, t.x1, 0, t.top, t.depth) });
  }
  if (r.splash.length) {
    const x0 = Math.min(...r.splash.map((s) => s.x0));
    const x1 = Math.max(...r.splash.map((s) => s.x1));
    const y0 = Math.min(...r.splash.map((s) => s.bottom));
    const y1 = Math.max(...r.splash.map((s) => s.top));
    // a photo's splash box takes the strip of counter along the wall with it
    const box = wallBox(r.wall, w, d, x0, x1, y0, y1, 0, ON_WALL);
    out.push({ kind: 'backsplash', wall: r.wall, index: ix.next('backsplash', r.wall), box, faces: [box, wallBox(r.wall, w, d, x0, x1, Math.min(y0, L.counterTopY) - 0.02, Math.min(y0, L.counterTopY) + 0.02, 0, SPLASH_COUNTER_STRIP)] });
  }
}

const APPLIANCE_KIND: Partial<Record<KitchenLayoutData['appliances'][number]['kind'], PhotoElementKind>> = {
  fridge: 'fridge', range: 'range', cooktop: 'cooktop', hood: 'hood', dishwasher: 'dishwasher', 'wall-oven': 'wall-oven', microwave: 'microwave', 'wine-fridge': 'other',
};

/** Every element of a solved kitchen layout as a world box the fitter can project. */
export function kitchenElementBoxes(L: KitchenLayoutData): TwinElement[] {
  const out: TwinElement[] = [];
  const ix = new Indexer();
  const { w, d, h } = L;
  const isl = L.island;

  // Any tall unit hides the wall behind it — a pantry, a fridge surround, an
  // oven tower. The photo's wall box stops at the cabinet's edge whatever the
  // cabinet's height (marble's back wall stops at x 0.886, the surround's
  // edge, though the surround is a foot short of the ceiling), so the old
  // "within a hand of the ceiling" test only ever made the twin's wall too wide.
  const hidden: Partial<Record<Wall, Array<[number, number]>>> = {};
  for (const r of L.runs) for (const t of r.tall) (hidden[r.wall] ??= []).push([t.x0, t.x1]);
  out.push(...shellBoxes(w, d, h, hidden));
  for (const r of L.runs) runBoxes(L, r, ix, out);

  for (const a of L.appliances) {
    const kind = APPLIANCE_KIND[a.kind];
    if (!kind) continue;
    // a canopy hood is outlined with its duct cover (to the ceiling, or as
    // high as the spec's `heightIn` says) — a slim insert under a wall
    // cabinet is just its own body; the layout resolved both into `top`
    const top = a.kind === 'hood' ? hoodExtents(a).top : a.y + a.height;
    if (a.wall === 'island') {
      if (!isl) continue;
      out.push({ kind, wall: 'island', index: ix.next(kind, 'island'), box: islandBox(isl, a.x - a.width / 2, a.x + a.width / 2, a.y, top, -isl.wide / 2, isl.wide / 2) });
    } else if (a.kind === 'hood') {
      // A hood is boxed by the FRONT of its canopy: the duct cover above it
      // is narrower and stands behind it, so the model's outline is the
      // canopy's face. Its whole 24" depth, projected under an oblique
      // camera, drew a box a third too wide. The range, the fridge and the
      // dishwasher keep `standing()` — their front face is the NEAR one, and
      // boxing it alone made the fridge worse (0.83 → 0.69).
      out.push({ kind, wall: a.wall, index: ix.next(kind, a.wall), box: wallBox(a.wall, w, d, a.x - a.width / 2, a.x + a.width / 2, a.y, top, Math.max(0, a.depth - FACE_T), a.depth) });
    } else if (a.y < 0.05 && a.kind !== 'microwave' && a.kind !== 'cooktop') {
      // floor-standing (a fridge, a range, a dishwasher): outlined like a
      // cabinet; a range also carries the box a photo's "cooktop" means —
      // its top with the burners and the control strip under it
      const alt = a.kind === 'range' ? { kind: 'cooktop' as const, box: wallBox(a.wall, w, d, a.x - a.width / 2, a.x + a.width / 2, Math.max(0, top - COOKTOP_STRIP), top + inch(1), 0, a.depth) } : undefined;
      out.push({ kind, wall: a.wall, index: ix.next(kind, a.wall), ...standing(a.wall, w, d, a.x - a.width / 2, a.x + a.width / 2, a.y, top, a.depth), ...(alt ? { alt } : {}) });
    } else {
      out.push({ kind, wall: a.wall, index: ix.next(kind, a.wall), box: wallBox(a.wall, w, d, a.x - a.width / 2, a.x + a.width / 2, a.y, top, 0, a.depth) });
    }
  }

  if (isl) {
    const top = isl.carcassTop + isl.topT;
    const seatTop = isl.seatY + 0.05;
    // a stool with its legs splayed and a back is about half a metre across in a photo
    const local = stoolPositions(isl);
    const stools = local.map(([x, z]) => islandBox(isl, x - STOOL_R, x + STOOL_R, 0, seatTop, z - STOOL_R, z + STOOL_R));
    // The photo's "island" box is drawn round the island AND the stools TUCKED
    // under its top — a model outlining the island cannot see where the slab
    // ends and a seat begins, so it takes the whole silhouette. A stool that
    // stands CLEAR of the top (past a short end with no overhang to tuck
    // under) is a thing of its own and gets its own box. Which is which is
    // read off the layout's own stool positions against the top's footprint,
    // never off the seat counts: side stools are tucked by construction, end
    // stools only under a real end overhang.
    const tucked = stools.filter((_, i) => {
      const [x, z] = local[i];
      return Math.abs(x) <= isl.topLen / 2 + 0.02 && Math.abs(z - isl.topOffset) <= isl.topWide / 2 + 0.02;
    });
    const island: AABB = { min: [isl.rect.minX, 0, isl.rect.minZ], max: [isl.rect.maxX, top, isl.rect.maxZ] };
    for (const s of tucked) {
      island.min[0] = Math.min(island.min[0], s.min[0]); island.min[2] = Math.min(island.min[2], s.min[2]);
      island.max[0] = Math.max(island.max[0], s.max[0]); island.max[2] = Math.max(island.max[2], s.max[2]);
    }
    // outlined from the top's front edge to the floor line on its far side:
    // the stools and the overhang hide the front-bottom edge
    const farZ = -isl.seatSide * (isl.wide / 2);
    const faces: AABB[] = [
      islandBox(isl, -isl.topLen / 2, isl.topLen / 2, top - FACE_T, top, -isl.topWide / 2 + isl.topOffset, isl.topWide / 2 + isl.topOffset),
      islandBox(isl, -isl.len / 2, isl.len / 2, 0, top, farZ - FACE_T / 2, farZ + FACE_T / 2),
    ];
    // A tucked stool widens the outline from SEAT LEVEL up, not from its
    // legs: the photo's island box stops at the counter's front edge and the
    // seats, and the legs below belong to the stools' own boxes.
    for (const s of tucked) faces.push({ min: [s.min[0], Math.max(0, isl.seatY), s.min[2]], max: [s.max[0], s.max[1], s.max[2]] });
    out.push({ kind: 'island', wall: 'island', index: 0, box: island, faces });
    for (const s of stools) out.push({ kind: 'stool', wall: 'island', index: ix.next('stool', 'island'), box: s });
  }

  for (const o of L.openings) {
    const kind: PhotoElementKind = o.kind === 'window' ? 'window' : 'door';
    out.push({ kind, wall: o.wall, index: ix.next(kind, o.wall), box: wallBox(o.wall, w, d, o.x - o.width / 2, o.x + o.width / 2, o.sill, o.sill + o.height, 0, ON_WALL) });
  }

  const s = L.sink;
  if (s) {
    // A photo's sink box is the basin's rim with the strip of counter round
    // it and, for an apron-front sink, the apron below; its faucet box is a
    // gooseneck's whole arc. Both are drawn to what the inventory outlines.
    const below = s.kind === 'farmhouse' ? SINK_APRON : SINK_BELOW;
    if (s.where === 'island' && isl) {
      const top = isl.carcassTop + isl.topT;
      out.push({ kind: 'sink', wall: 'island', index: 0, box: islandBox(isl, s.x - s.width / 2, s.x + s.width / 2, top - below, top + SINK_ABOVE, -s.depth / 2, s.depth / 2) });
      out.push({ kind: 'faucet', wall: 'island', index: 0, box: islandBox(isl, s.x - FAUCET_R, s.x + FAUCET_R, top, top + FAUCET_H, -s.depth / 2 - 0.14, -s.depth / 2 + 0.06) });
    } else if (s.where === 'wall' && s.wall) {
      const y = L.counterTopY;
      out.push({ kind: 'sink', wall: s.wall, index: 0, box: wallBox(s.wall, w, d, s.x - s.width / 2, s.x + s.width / 2, y - below, y + SINK_ABOVE, s.z - s.depth / 2, s.z + s.depth / 2) });
      // the tap stands between the basin and the wall
      const zTap = Math.max(0.03, s.z - s.depth / 2 - 0.09);
      out.push({ kind: 'faucet', wall: s.wall, index: 0, box: wallBox(s.wall, w, d, s.x - FAUCET_R, s.x + FAUCET_R, y, y + FAUCET_H, zTap, zTap + 0.16) });
    }
  }

  const drop = pendantDrop(L);
  for (const p of pendantPositions(L)) {
    // cord and shade: the inventory boxes a pendant from its ceiling hook
    // down to the bottom of the shade (client photos bear this out), so the
    // twin's box does the same rather than the shade alone
    const bottom = h - drop;
    out.push({ kind: 'pendant', wall: null, index: ix.next('pendant', null), box: box([p[0] - 0.16, bottom - 0.03, p[2] - 0.16], [p[0] + 0.16, h, p[2] + 0.16]) });
  }

  // one box per BOARD, not per run: the inventory outlines each floating
  // shelf it can see (a photo of two boards has two "shelf" boxes), about a
  // hand tall — the board, its shadow line and the feet of what stands on
  // it, never the whole row of dishes
  for (const sh of L.decor.shelves) {
    if (sh.enclosure) {
      const { span, projection } = shelfFootprint(sh);
      out.push({ kind: 'shelf', wall: sh.wall, index: ix.next('shelf', sh.wall), box: wallBox(sh.wall, w, d, sh.x - span / 2, sh.x + span / 2, sh.enclosure.bottom, sh.enclosure.top, sh.standoff, sh.standoff + projection) });
      continue;
    }
    for (const bottom of sh.boards) {
      out.push({ kind: 'shelf', wall: sh.wall, index: ix.next('shelf', sh.wall), box: wallBox(sh.wall, w, d, sh.x - sh.width / 2, sh.x + sh.width / 2, bottom, bottom + sh.thickness + SHELF_BOX_ABOVE, sh.standoff, sh.standoff + sh.depth) });
    }
  }

  for (const p of L.decor.plants) {
    const r = Math.max(p.potR, p.height * (p.form === 'tree' ? 0.28 : p.form === 'herb' || p.form === 'succulent' ? 0.35 : 0.4));
    let wall: Wall | 'island' | null = null;
    let cx: number, cz: number;
    if (p.frame === 'world') { cx = p.x; cz = p.z; }
    else if (p.frame === 'island') {
      if (!isl) continue;
      [cx, cz] = islandPoint(isl, p.x, p.z);
      wall = 'island';
    } else {
      const len = wallLen(p.frame, w, d);
      const [x, , z] = onWall(p.frame, w, d, (p.x + len / 2) / len, 0, p.z);
      cx = x; cz = z; wall = p.frame;
    }
    // a hanging plant's y is the ceiling hook: the pot hangs `drop` below it and the strands fall from there
    const y0 = p.kind === 'hanging' ? Math.max(0, p.y - p.drop - p.height) : p.y;
    const y1 = p.kind === 'hanging' ? p.y - p.drop + p.potH : p.y + p.height;
    out.push({ kind: 'plant', wall, index: ix.next('plant', wall), box: box([cx - r, y0, cz - r], [cx + r, y1, cz + r]) });
  }

  for (const a of L.decor.art) {
    out.push({ kind: 'art', wall: a.wall, index: ix.next('art', a.wall), box: wallBox(a.wall, w, d, a.x - a.width / 2, a.x + a.width / 2, a.y - a.height / 2, a.y + a.height / 2, 0, a.depth) });
  }

  // Every small object standing on a surface — the pot on the burner, the
  // kettle, the knife block. The inventory boxes one from its BASE to the top
  // of its lid or handle, which is exactly what the layout solved, so the box
  // is the object's own footprint turned into the world and lifted to its
  // base. A row of identical things (three canisters) is one KItem whose `w`
  // is the row's total width, and the annotator boxes each separately — the
  // fitter's Hungarian pass sorts that out; nothing here needs to.
  for (const it of L.decor.items) {
    let wall: Wall | 'island' | null = null;
    let cx: number, cz: number;
    // the world angle of the item's own local x axis
    let theta = it.yaw;
    if (it.frame === 'world') {
      cx = it.x; cz = it.z;
    } else if (it.frame === 'island') {
      if (!isl) continue;
      [cx, cz] = islandPoint(isl, it.x, it.z);
      theta += isl.yaw;
      wall = 'island';
    } else {
      const len = wallLen(it.frame, w, d);
      const [x, , z] = onWall(it.frame, w, d, (it.x + len / 2) / len, 0, it.z);
      cx = x; cz = z;
      wall = it.frame;
      // a side wall's "along" axis is world z, so the footprint turns a quarter turn
      if (it.frame === 'left' || it.frame === 'right') theta += Math.PI / 2;
    }
    const c = Math.abs(Math.cos(theta)), sn = Math.abs(Math.sin(theta));
    const hx = (it.w / 2) * c + (it.d / 2) * sn;
    const hz = (it.w / 2) * sn + (it.d / 2) * c;
    out.push({ kind: 'item', wall, index: ix.next('item', wall), box: box([cx - hx, it.y, cz - hz], [cx + hx, it.y + it.h, cz + hz]) });
  }

  const rug = L.decor.rug;
  if (rug) {
    const alongX = Math.abs(Math.cos(rug.yaw)) > 0.5;
    const hx = (alongX ? rug.len : rug.wide) / 2, hz = (alongX ? rug.wide : rug.len) / 2;
    out.push({ kind: 'rug', wall: null, index: 0, box: box([rug.cx - hx, 0, rug.cz - hz], [rug.cx + hx, 0.012, rug.cz + hz]) });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Bathroom
// ---------------------------------------------------------------------------

/**
 * The two bathroom heights the LAYOUT does not carry, so they are read off the
 * scene instead: the stall's glass top (Shower.tsx GLASS_TOP) and the toilet's
 * (Toilet.tsx). Everything else a bathroom box needs — the tub's rim, the
 * curb, the tile's stop line, the vanity's top — the layout has already
 * solved, and a constant standing in for one of those is a box that stops
 * answering to the spec: `tub.heightIn` moved the drawn rim from 19.8" to
 * 26.8" while the twin's box stayed 0.58 m, so nothing the fitter could see
 * ever changed and the lever was dead weight.
 */
const SHOWER_GLASS_TOP = 1.98;
const TOILET_H: Record<string, number> = { 'wall-hung': 0.5 };

/**
 * Where the FIELD tile stops on a wall — the mirror of `RoomShell.tileHeightFor`
 * / `accentWallOf` / `fieldHeight`, which cannot be imported here: RoomShell is
 * a `'use client'` module and pulling it in would drag @react-three/fiber into
 * /api/fit. `scripts/check-inventory.ts` imports BOTH and asserts they agree
 * over every tile category, so the copy cannot drift in silence.
 */
const WAINSCOT_H = inch(42);

function accentWall(L: BathLayout): Wall | null {
  if (L.tile.accent) return L.tile.accent.wall;
  return L.wallTile === 'accent-wall' ? (L.vanity?.wall ?? 'back') : null;
}

/** The tile field's real top edge on `wall`, 0 where that wall carries none. */
export function tileTopOn(L: BathLayout, wall: Wall): number {
  const cap = L.h - 0.004;
  if (accentWall(L) === wall) return Math.min(L.tile.accent?.stopH ?? cap, cap);
  switch (L.wallTile) {
    case 'full': return Math.min(L.tile.stopH ?? cap, cap);
    case 'wainscot': return Math.min(L.tile.stopH ?? WAINSCOT_H, L.h - 0.3);
    default: return 0;
  }
}

/**
 * How tall a wall fitting's photo box is and how far it stands off the wall.
 *
 * These follow the geometry `Accessories.tsx` actually draws (`towelBar`'s
 * 72 mm projection and 48 mm flange, `towelRing`'s hoop hanging 156 mm below
 * its rose, `robeHook`'s 46 mm) — NOT the towel hanging over the bar, which
 * the inventory boxes as an `item`. `drop` shifts the box's centre below the
 * fitting's mounting height, which is the ring's whole shape.
 */
const ACCESSORY_BOX: Record<BathAccessoryKind, { h: number; depth: number; drop: number }> = {
  'towel-bar': { h: 0.048, depth: 0.090, drop: 0 },
  'grab-bar': { h: 0.060, depth: 0.075, drop: 0 },
  'towel-ring': { h: 0.190, depth: 0.070, drop: 0.078 },
  hook: { h: 0.070, depth: 0.050, drop: 0.017 },
  'robe-hook': { h: 0.070, depth: 0.050, drop: 0.017 },
  'toilet-paper-holder': { h: 0.060, depth: 0.075, drop: 0 },
  // the warmer's rails are the one fitting whose HEIGHT is a function of its
  // width, exactly as `Accessories.tsx` sizes it
  'towel-warmer': { h: 0, depth: 0.070, drop: 0 },
  'shower-caddy': { h: 0.090, depth: 0, drop: 0 },
  'corner-shelf': { h: 0.030, depth: 0, drop: 0 },
};

/** A fitting's photo box is its metal: the run along the wall, the drawn height, the projection. */
function accessoryBox(L: BathLayout, a: LAccessory): AABB {
  const m = ACCESSORY_BOX[a.kind];
  const h = a.kind === 'towel-warmer' ? Math.min(1.2, a.width * 1.6) : m.h;
  const depth = a.kind === 'shower-caddy' ? a.width * 0.42 : a.kind === 'corner-shelf' ? Math.max(0.12, a.width * 0.8) : m.depth;
  const y = a.y - m.drop;
  return wallBox(a.wall, L.w, L.d, a.x - a.width / 2, a.x + a.width / 2, y - h / 2, y + h / 2, 0, Math.max(depth, ON_WALL));
}

/**
 * Stall-local (x along the stall, z into the room from its wall) → a room box.
 * `Shower.tsx` draws every part of the stall in this frame inside an
 * `<OnWall t={s.t}>`, so the stall's centre is the wall-local centred `s.x`.
 */
function stallBox(L: BathLayout, s: LShower, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): AABB {
  return wallBox(s.wall, L.w, L.d, s.x + x0, s.x + x1, y0, y1, z0, z1);
}

/** Every element of a solved bathroom layout as a world box the fitter can project. */
export function bathroomElementBoxes(L: BathLayout): TwinElement[] {
  const out: TwinElement[] = [];
  const ix = new Indexer();
  const { w, d, h } = L;
  out.push(...shellBoxes(w, d, h));

  const v = L.vanity;
  if (v) {
    // `Placed.depth` and `Placed.width` are the TOP's footprint (the layout
    // sets `bodyDepth = depth - 1.5"`, which is exactly Vanity.tsx's front
    // overhang), so the vanity's outline is the slab; the carcase under it
    // stands back from the slab's edges on three sides, which is where a
    // photo's floor line for a vanity actually runs.
    const bodyW = Math.max(0.05, v.width - inch(1.5));
    const slab = wallBox(v.wall, w, d, v.x - v.topW / 2, v.x + v.topW / 2, v.topH - v.topThickness, v.topH, 0, v.depth);
    const body = wallBox(v.wall, w, d, v.x - bodyW / 2, v.x + bodyW / 2, v.bodyBottom, Math.max(v.bodyBottom, v.topH - v.topThickness), 0, v.bodyDepth);
    out.push({
      kind: 'vanity', wall: v.wall, index: 0,
      box: { min: [v.rect.minX, v.bodyBottom, v.rect.minZ], max: [v.rect.maxX, v.topH, v.rect.maxZ] },
      faces: [slab, body],
    });
    if (v.mirrorBand) {
      const m = v.mirrorBand;
      out.push({ kind: 'mirror', wall: v.wall, index: 0, box: wallBox(v.wall, w, d, m.x0, m.x1, m.y0, m.y1, 0, ON_WALL) });
    }
    for (const b of v.basins) {
      const x = v.x + b;
      out.push({ kind: 'sink', wall: v.wall, index: ix.next('sink', v.wall), box: wallBox(v.wall, w, d, x - 0.23, x + 0.23, v.topH - 0.03, v.topH + 0.03, v.depth * 0.25, v.depth * 0.9) });
      out.push({ kind: 'faucet', wall: v.wall, index: ix.next('faucet', v.wall), box: wallBox(v.wall, w, d, x - 0.05, x + 0.05, v.topH, v.topH + 0.2, v.depth * 0.08, v.depth * 0.22) });
    }
  }
  const s = L.shower;
  if (s) {
    out.push({ kind: 'shower', wall: s.wall, index: 0, box: { min: [s.rect.minX, 0, s.rect.minZ], max: [s.rect.maxX, SHOWER_GLASS_TOP, s.rect.maxZ] } });
    const Dp = s.depth - 0.03;
    const N = s.nicheAt;
    if (N) {
      // The recess as the photo sees it: the opening in the tiled face and the
      // box behind it. `Shower.tsx` cuts it at the tiled plane (TILE_T off the
      // substrate) and the shell runs `depth` back INTO the wall, so the box
      // reaches a little past the stall's face — which is where the niche is.
      const T = 0.010;
      if (N.face === 'back') {
        out.push({ kind: 'shelf', wall: s.wall, index: ix.next('shelf', s.wall), box: stallBox(L, s, N.x - N.width / 2, N.x + N.width / 2, N.bottom, N.bottom + N.height, T - N.depth, T) });
      } else {
        // a side face: the niche's WIDTH runs into the room, its depth across
        // the stall. `nicheAt.x` is measured from the stall opening on the
        // left face and from the wall on the right one (Shower.tsx).
        const zc = N.face === 'left' ? Dp - N.x : N.x;
        const xFace = N.face === 'left' ? s.innerOffset - s.inner / 2 + T : s.innerOffset + s.inner / 2 - T;
        const xIn = N.face === 'left' ? xFace - N.depth : xFace + N.depth;
        out.push({ kind: 'shelf', wall: s.wall, index: ix.next('shelf', s.wall), box: stallBox(L, s, Math.min(xFace, xIn), Math.max(xFace, xIn), N.bottom, N.bottom + N.height, zc - N.width / 2, zc + N.width / 2) });
      }
    }
    // The curb, on exactly the condition `Shower.tsx` draws one: a curbless
    // threshold and a tub-shower combo have none, and a curb of nothing is not
    // a 1 mm curb. Its top edge is the one thing in the photo that measures
    // `shower.curbHeightIn`.
    if (!s.curbless && !s.hasTub && s.curbHeight > 0.01) {
      const curbD = inch(5);
      const wide = s.inner + (s.leftIsRoomWall ? 0 : s.partition) + (s.rightIsRoomWall ? 0 : s.partition);
      out.push({ kind: 'shelf', wall: s.wall, index: ix.next('shelf', s.wall), box: stallBox(L, s, s.innerOffset - wide / 2, s.innerOffset + wide / 2, 0, s.curbHeight, Math.max(0, Dp - curbD), Dp) });
    }
  }
  const t = L.tub;
  // The rim the layout SOLVED, not a constant per kind: `Tub.tsx` draws every
  // shell to `rimHeight` (a clawfoot's feet raise a 520 mm bowl to it), and the
  // body sits `gap` off the wall and is `across` deep — the `Placed` rect is
  // the footprint the collision solver reserved, which is wider.
  if (t) out.push({ kind: 'tub', wall: t.wall, index: 0, box: wallBox(t.wall, w, d, t.x - t.width / 2, t.x + t.width / 2, 0, t.rimHeight, t.gap, t.gap + t.across) });
  const wc = L.toilet;
  if (wc) out.push({ kind: 'toilet', wall: wc.wall, index: 0, box: { min: [wc.rect.minX, 0, wc.rect.minZ], max: [wc.rect.maxX, TOILET_H[wc.style] ?? 0.76, wc.rect.maxZ] } });

  for (const o of L.openings) {
    const kind: PhotoElementKind = o.kind === 'window' ? 'window' : 'door';
    out.push({ kind, wall: o.wall, index: ix.next(kind, o.wall), box: wallBox(o.wall, w, d, o.x - o.width / 2, o.x + o.width / 2, o.sill, o.sill + o.height, 0, ON_WALL) });
  }

  // The tile field — the largest surface in most bathroom photographs and,
  // until now, the one thing in the room with no box at all. One box per
  // CONTIGUOUS stretch, as the inventory draws it: a door or a window standing
  // in the band breaks the field in two, and the field stops where the tile
  // stops, which is what measures `wallTile.heightIn` (and the accent wall's).
  for (const wall of WALLS) {
    const top = tileTopOn(L, wall);
    if (top <= 0.02) continue;
    const len = wallLen(wall, w, d);
    const cuts = L.openings
      .filter((o) => o.wall === wall && o.sill < top)
      .map((o): [number, number] => [o.x - o.width / 2, o.x + o.width / 2]);
    for (const [x0, x1] of subtractIntervals(-len / 2, len / 2, cuts)) {
      out.push({ kind: 'backsplash', wall, index: ix.next('backsplash', wall), box: wallBox(wall, w, d, x0, x1, 0, top, 0, ON_WALL) });
    }
  }

  // Every fitting the spec asked for: the bar, the ring, the hook, the grab
  // bar, the paper holder. `towel-bar` is the inventory's word for all of
  // them (a corner shelf is a shelf), and each one is a box the photo can be
  // asked for — which is what makes their `t`, height and width measurable.
  for (const a of L.accessories) {
    const kind: PhotoElementKind = a.kind === 'corner-shelf' ? 'shelf' : 'towel-bar';
    out.push({ kind, wall: a.wall, index: ix.next(kind, a.wall), box: accessoryBox(L, a) });
  }

  // one box per board, as for the kitchen
  for (const sh of L.decor.shelves) {
    if (sh.enclosure) {
      const { projection } = shelfFootprint(sh);
      out.push({ kind: 'shelf', wall: sh.wall, index: ix.next('shelf', sh.wall), box: wallBox(sh.wall, w, d, sh.band.x0, sh.band.x1, sh.enclosure.bottom, sh.enclosure.top, sh.standoff, sh.standoff + projection) });
      continue;
    }
    const count = Math.max(1, Math.round(sh.count));
    for (let k = 0; k < count; k++) {
      const bottom = sh.bottom + k * sh.spacing;
      out.push({ kind: 'shelf', wall: sh.wall, index: ix.next('shelf', sh.wall), box: wallBox(sh.wall, w, d, sh.band.x0, sh.band.x1, bottom, bottom + inch(1) + SHELF_BOX_ABOVE, 0, sh.depth) });
    }
  }
  for (const a of L.decor.art) {
    out.push({ kind: 'art', wall: a.wall, index: ix.next('art', a.wall), box: wallBox(a.wall, w, d, a.band.x0, a.band.x1, a.centerY - a.height / 2, a.centerY + a.height / 2, 0, ON_WALL) });
  }
  for (const p of L.decor.plants) {
    const r = Math.max(p.potD / 2, p.size * (p.form === 'tree' ? 0.28 : 0.4));
    const y0 = p.kind === 'hanging' ? Math.max(0, p.y - p.drop) : p.y;
    const y1 = p.kind === 'hanging' ? p.y + p.potD : p.y + p.size;
    out.push({ kind: 'plant', wall: p.wall, index: ix.next('plant', p.wall), box: box([p.x - r, y0, p.z - r], [p.x + r, y1, p.z + r]) });
  }
  const rug = L.decor.rug;
  if (rug) out.push({ kind: 'rug', wall: null, index: 0, box: { min: [rug.rect.minX, 0, rug.rect.minZ], max: [rug.rect.maxX, 0.012, rug.rect.maxZ] } });
  return out;
}

/** The frame box a twin element is judged by: its faces' union when it has faces, else its box. */
export function projectElement(pin: Pinhole, e: TwinElement): Box4 | null {
  return project(pin, e, false);
}

/**
 * The same union UNCLAMPED — how far past the picture's edge the twin really
 * runs. Only the truncation term reads it (`fit.ts` OFF_FRAME): everything
 * else scores in frame coordinates, where a box outside [0, 1] is not a
 * bigger element, only an invisible one.
 */
export function projectElementRaw(pin: Pinhole, e: TwinElement): Box4 | null {
  return project(pin, e, true);
}

function project(pin: Pinhole, e: TwinElement, raw: boolean): Box4 | null {
  const one = (b: AABB) => (raw ? pin.projectBoxRaw(b) : pin.projectBox(b));
  if (!e.faces || !e.faces.length) return one(e.box);
  let u: Box4 | null = null;
  for (const f of e.faces) {
    const b = one(f);
    if (!b) continue;
    u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b;
  }
  return u;
}

// ---------------------------------------------------------------------------
// Sanity
// ---------------------------------------------------------------------------

/**
 * Every box must be finite, non-inverted and inside the room (a small
 * tolerance for stools that tuck under an overhang past the island rect and
 * for boxes given a nominal thickness on a wall plane). Returns the problems
 * found, empty when all is well — `scripts/check-fit.ts` asserts on it.
 */
export function checkBoxes(elements: TwinElement[], w: number, d: number, h: number, tol = 0.35): string[] {
  const problems: string[] = [];
  for (const e of elements) {
    const { min, max } = e.box;
    const name = `${e.kind}${e.wall ? `@${e.wall}` : ''}#${e.index}`;
    if (![...min, ...max].every((n) => Number.isFinite(n))) { problems.push(`${name}: non-finite box`); continue; }
    if (min[0] > max[0] || min[1] > max[1] || min[2] > max[2]) problems.push(`${name}: inverted box`);
    if (min[0] < -w / 2 - tol || max[0] > w / 2 + tol || min[2] < -d / 2 - tol || max[2] > d / 2 + tol) problems.push(`${name}: outside the room footprint`);
    if (min[1] < -0.01 || max[1] > h + 0.05) problems.push(`${name}: below the floor or above the ceiling`);
  }
  return problems;
}
