/**
 * Bathroom geometry kit.
 *
 * Everything here is built on `scene/detail.ts` — chamfered and filleted boxes,
 * swept millwork profiles, real panel builders, real hardware — so no bathroom
 * part is a bare `BoxGeometry` any more. The rules:
 *
 *   - every visible edge is broken (1–2 mm chamfer or a real fillet), because a
 *     perfectly sharp edge is the single loudest "this is CG" tell;
 *   - parts that belong to one material slot are MERGED into one geometry, so
 *     an entire vanity carcase or a whole toilet is a single draw call;
 *   - anything repeated more than ~8 times (mosaic chips, tile courses, screws)
 *     returns `InstanceTransform[]` for `<InstancedSurface/>`;
 *   - results are cached by rounded parameters and must never be mutated —
 *     use `transformed()` from the detail kit to move a copy;
 *   - nothing throws: every input is clamped to something buildable.
 *
 * All dimensions are METRES unless the argument name says otherwise.
 */
import * as THREE from 'three';
import type { TilePattern } from '@/lib/spec/types';
import { applyWorldUVs, mergeGeometries, worldBox } from '@/components/scene/geometry';
import {
  chamferBox, chamferCylinder, clampNum, filletBox, grid, lathePoints, mergeDetail,
  profileMoulding, screwHead, sweepProfile, transformed,
  type InstanceTransform, type ProfileName, type Vec2, type Vec3,
} from '@/components/scene/detail';

export const IN = 0.0254;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = build(); cache.set(key, g); }
  return g;
}
const k = (n: number) => n.toFixed(4);
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry { return mergeDetail(parts); }

/** A moved / scaled CLONE — never hand a cached geometry to a transform. */
export function placed(g: THREE.BufferGeometry, position?: Vec3, rotation?: Vec3, scale?: Vec3 | number): THREE.BufferGeometry {
  return transformed(g, { position, rotation, scale });
}

/** How many geometries the bathroom kit is holding (diagnostics). */
export function bathCacheSize(): number { return cache.size; }
/** Free every cached bathroom geometry (whole-project unmount only). */
export function disposeBathCache() { cache.forEach((g) => g.dispose()); cache.clear(); }

// ---------------------------------------------------------------------------
// Shapes / slabs
// ---------------------------------------------------------------------------
export function roundedRect(path: THREE.Path, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4));
  path.moveTo(x + rr, y);
  path.lineTo(x + w - rr, y);
  if (rr > 0) path.absarc(x + w - rr, y + rr, rr, -Math.PI / 2, 0, false);
  path.lineTo(x + w, y + h - rr);
  if (rr > 0) path.absarc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2, false);
  path.lineTo(x + rr, y + h);
  if (rr > 0) path.absarc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI, false);
  path.lineTo(x, y + rr);
  if (rr > 0) path.absarc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5, false);
  path.closePath();
}

export interface Cutout { x: number; z: number; w: number; d: number; r?: number }

/**
 * Cutouts come straight off a model-generated spec, so every field is clamped
 * before it can reach a `THREE.Path`. An Infinity here used to produce a slab
 * with NaN positions, which renders as nothing at all and is invisible in
 * review — `scripts/check-bathroom.ts` now catches it.
 */
function sanitizeCutouts(cutouts: Cutout[], W: number, D: number): Cutout[] {
  if (!Array.isArray(cutouts)) return [];
  const out: Cutout[] = [];
  for (const c of cutouts) {
    if (!c || typeof c !== 'object') continue;
    const w = clampNum(c.w, 0, W, 0);
    const d = clampNum(c.d, 0, D, 0);
    if (w < 0.05 || d < 0.05) continue;
    out.push({
      x: clampNum(c.x, -W, W, 0),
      z: clampNum(c.z, -D, D, 0),
      w, d,
      r: clampNum(c.r ?? Math.min(w, d) * 0.3, 0, Math.min(w, d) / 2, Math.min(w, d) * 0.3),
    });
  }
  return out;
}

/**
 * Horizontal slab with rounded-rectangle cutouts — vanity tops with undermount
 * basins, tub decks. Centred at the origin, thickness along Y. Cutouts are in
 * slab-local x / z (z positive = toward the room).
 */
export function slabWithCutouts(w: number, h: number, d: number, cutouts: Cutout[], bevel = 0.004): THREE.BufferGeometry {
  const W = clampNum(w, 0.05, 12, 1), H = clampNum(h, 0.004, 0.4, 0.03), D = clampNum(d, 0.05, 6, 0.55);
  const shape = new THREE.Shape();
  roundedRect(shape, -W / 2, -D / 2, W, D, Math.min(0.01, clampNum(bevel, 0, 0.05, 0.004) * 2));
  for (const c of sanitizeCutouts(cutouts, W - 0.04, D - 0.04)) {
    const p = new THREE.Path();
    // shape y maps to world -z after the rotateX(-90°) below
    roundedRect(p, c.x - c.w / 2, -c.z - c.d / 2, c.w, c.d, c.r ?? Math.min(c.w, c.d) * 0.3);
    shape.holes.push(p);
  }
  const bv = Math.min(clampNum(bevel, 0, 0.02, 0.004), H / 3);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.002, H - bv * 2), bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, steps: 1, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (bb) g.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
  applyWorldUVs(g);
  return g;
}

/**
 * A stone top with a REAL milled edge: the slab body plus the named edge
 * profile swept along the three exposed sides (the back is against the wall
 * and never gets an edge). This is what separates a countertop from a plank.
 */
export function counterTop(
  w: number, d: number, thickness: number,
  edge: 'eased' | 'bullnose' | 'bevel' | 'ogee' | 'mitered',
  cutouts: Cutout[],
  opts: { sides?: boolean } = {},
): THREE.BufferGeometry {
  const W = clampNum(w, 0.1, 12, 1), D = clampNum(d, 0.1, 4, 0.55);
  const T = clampNum(thickness, 0.008, 0.15, 0.032);
  const sides = opts.sides !== false;
  const cuts = sanitizeCutouts(cutouts, W - 0.04, D - 0.04);
  const profName: ProfileName = edge === 'bullnose' ? 'counter-bullnose' : edge === 'bevel' ? 'counter-bevel'
    : edge === 'ogee' ? 'counter-ogee' : edge === 'mitered' ? 'counter-mitered' : 'counter-eased';
  const key = `top|${k(W)}|${k(D)}|${k(T)}|${edge}|${sides ? 's' : 'n'}|${cuts.map((c) => `${k(c.x)},${k(c.z)},${k(c.w)},${k(c.d)}`).join(';')}`;
  return cached(key, () => {
    // the slab is inset by the profile's projection so the finished front edge
    // lands exactly on ±W/2 / +D/2
    const proud = edge === 'bullnose' ? 0.015 : edge === 'ogee' ? 0.014 : edge === 'bevel' ? 0.006 : 0.002;
    const bodyW = Math.max(0.05, W - (sides ? proud * 2 : 0));
    const bodyD = Math.max(0.05, D - proud);
    const parts: THREE.BufferGeometry[] = [
      transformed(slabWithCutouts(bodyW, T, bodyD, cuts.map((c) => ({ ...c, z: c.z + proud / 2 })), 0.0012), { position: [0, 0, -proud / 2] }),
    ];
    const scale = T / (edge === 'mitered' ? 0.05 : 0.03);
    const front: Vec3[] = [[-bodyW / 2 - (sides ? proud : 0), 0, D / 2 - proud], [bodyW / 2 + (sides ? proud : 0), 0, D / 2 - proud]];
    parts.push(profileMoulding(front, profName, { scale, up: [0, 1, 0], offset: [proud, T / 2] as Vec2 }));
    if (sides) {
      parts.push(profileMoulding([[W / 2 - proud, 0, -bodyD / 2], [W / 2 - proud, 0, D / 2 - proud]], profName, { scale, up: [0, 1, 0], offset: [-proud, T / 2] as Vec2, flipX: true }));
      parts.push(profileMoulding([[-W / 2 + proud, 0, D / 2 - proud], [-W / 2 + proud, 0, -bodyD / 2]], profName, { scale, up: [0, 1, 0], offset: [-proud, T / 2] as Vec2, flipX: true }));
    }
    return merged(parts);
  });
}

/** Room floor (facing +Y at y = 0) with rectangular holes for recessed pans. */
export function floorWithHoles(w: number, d: number, holes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>): THREE.BufferGeometry {
  const W = clampNum(w, 0.5, 60, 3), D = clampNum(d, 0.5, 60, 3);
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, -D / 2); shape.lineTo(W / 2, -D / 2); shape.lineTo(W / 2, D / 2); shape.lineTo(-W / 2, D / 2); shape.closePath();
  for (const r of holes) {
    const x0 = Math.max(-W / 2 + 0.005, r.minX), x1 = Math.min(W / 2 - 0.005, r.maxX);
    const z0 = Math.max(-D / 2 + 0.005, r.minZ), z1 = Math.min(D / 2 - 0.005, r.maxZ);
    if (!(x1 - x0 > 0.05) || !(z1 - z0 > 0.05)) continue;
    const p = new THREE.Path();
    p.moveTo(x0, -z1); p.lineTo(x1, -z1); p.lineTo(x1, -z0); p.lineTo(x0, -z0); p.closePath();
    shape.holes.push(p);
  }
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  applyWorldUVs(g);
  return g;
}

// ---------------------------------------------------------------------------
// Tile: courses, edges, mosaic
// ---------------------------------------------------------------------------

/**
 * Real tile thickness with a finished termination.
 *
 * `kind` picks how the tile stops where it meets paint or drywall:
 *   - `bullnose`  a glazed, rolled-over edge (traditional ceramic)
 *   - `schluter`  an anodised metal L-trim (what every modern job actually uses)
 *   - `pencil`    a pencil-liner cap over the field
 * Swept along the run, so a 4 m wainscot cap is one 80-triangle piece.
 */
export function tileEdge(length: number, thickness: number, kind: 'bullnose' | 'schluter' | 'pencil' | 'chair-rail'): THREE.BufferGeometry {
  const L = clampNum(length, 0.05, 30, 1);
  const T = clampNum(thickness, 0.004, 0.03, 0.009);
  const key = `tedge|${k(L)}|${k(T)}|${kind}`;
  return cached(key, () => {
    // profile: x = proud of the wall (0 at the substrate), y = across the cap
    let prof: Vec2[];
    if (kind === 'schluter') {
      const f = 0.0012;
      prof = [[0, 0], [T + f, 0], [T + f, f], [T, f], [T, -0.010], [T - f, -0.010], [T - f, 0 - f], [0, -f], [0, 0]];
    } else if (kind === 'chair-rail') {
      // a real chair rail is millwork, not a tile trim: it stands ~2.5x the
      // tile proud and its ogee is what a wainscot is actually capped with
      const r = T * 2.4;
      prof = [[0, -0.030], [r * 0.30, -0.030], [r * 0.30, -0.020], [r * 0.80, -0.014],
        [r, -0.002], [r * 0.92, 0.008], [r * 0.62, 0.014], [r * 0.66, 0.024],
        [r * 0.34, 0.030], [0, 0.032], [0, -0.030]];
    } else if (kind === 'pencil') {
      const r = T * 0.9;
      prof = [[0, -0.008], [r * 0.5, -0.010], [r, -0.006], [r * 1.05, 0.002], [r * 0.7, 0.010], [0, 0.012], [0, -0.008]];
    } else {
      prof = [[0, -0.012], [T, -0.012], [T, 0.002], [T * 0.86, 0.008], [T * 0.5, 0.012], [0, 0.014], [0, -0.012]];
    }
    return sweepProfile(prof, [[-L / 2, 0, 0], [L / 2, 0, 0]], { up: [0, 1, 0] });
  });
}

/**
 * A silicone caulk bead in the corner where two planes meet — tile to tub deck,
 * pan to wall, counter to backsplash. Real bathrooms have one at every change
 * of plane, and its absence is why CG corners look like folded paper.
 *
 * Swept along +X with the bead filling the corner between the plane at z = 0
 * (behind) and the plane at y = 0 (below); rotate the mesh to place it in any
 * other corner.
 */
export function caulkBead(length: number, radius = 0.005): THREE.BufferGeometry {
  const L = clampNum(length, 0.03, 20, 1);
  const R = clampNum(radius, 0.001, 0.03, 0.005);
  return cached(`caulk|${k(L)}|${k(R)}`, () => {
    const prof: Vec2[] = [[0, 0], [R, 0]];
    for (let i = 0; i <= 6; i++) {
      const th = -Math.PI / 2 + (i / 6) * (Math.PI * 1.5);
      prof.push([R + R * Math.cos(th), R + R * Math.sin(th)]);
    }
    prof.push([0, R], [0, 0]);
    return sweepProfile(prof, [[-L / 2, 0, 0], [L / 2, 0, 0]], { up: [0, 1, 0] });
  });
}

/** Outside-corner tile return: two mitred faces so a tiled edge never shows a paper-thin plane. */
export function tileCornerReturn(height: number, thickness: number): THREE.BufferGeometry {
  const H = clampNum(height, 0.05, 5, 2);
  const T = clampNum(thickness, 0.004, 0.03, 0.009);
  return cached(`tcorner|${k(H)}|${k(T)}`, () => chamferBox(T, H, T, T * 0.18).clone());
}

/**
 * A mosaic shower floor as REAL chips — one InstancedMesh, so 600 chips cost
 * one draw call. `chip` is the nominal face size (2" hex / 1" penny / 2" square
 * are what actually get specified); the grout joint is the gap between them.
 *
 * Returns the chip geometry plus its transforms; feed both to
 * `<InstancedSurface slot="shower_floor_tile" …/>` so the chips stay clickable
 * and re-materialise when the user swaps the tile.
 */
export function mosaicField(
  w: number, d: number,
  opts: { chip?: number; joint?: number; slope?: number; drain?: [number, number]; max?: number } = {},
): { geometry: THREE.BufferGeometry; transforms: InstanceTransform[]; chip: number } {
  const W = clampNum(w, 0.1, 6, 1), D = clampNum(d, 0.1, 6, 1);
  const chip = clampNum(opts.chip ?? 0.05, 0.018, 0.16, 0.05);
  const joint = clampNum(opts.joint ?? 0.003, 0.001, 0.012, 0.003);
  const slope = clampNum(opts.slope ?? 0.02, 0, 0.08, 0.02);
  const maxChips = Math.round(clampNum(opts.max ?? 900, 16, 4000, 900));
  const pitch = chip + joint;
  let cols = Math.max(1, Math.floor(W / pitch));
  let rows = Math.max(1, Math.floor(D / pitch));
  // never blow the budget on a huge curbless pan: coarsen instead of exploding
  let step = 1;
  while (cols * rows > maxChips && step < 6) { step++; cols = Math.max(1, Math.floor(W / (pitch * step))); rows = Math.max(1, Math.floor(D / (pitch * step))); }
  const face = chip * step + joint * (step - 1);
  const geometry = chamferBox(face, 0.008, face, 0.0009);
  const ox = -((cols - 1) * pitch * step) / 2;
  const oz = -((rows - 1) * pitch * step) / 2;
  const dx = clampNum(opts.drain?.[0], -W, W, 0);
  const dz = clampNum(opts.drain?.[1], -D, D, D * 0.12);
  const far = Math.max(0.05, Math.hypot(W / 2, D / 2));
  const transforms: InstanceTransform[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = ox + i * pitch * step;
      const z = oz + j * pitch * step;
      // The pan falls toward the drain: a chip is lowest at the waste and rises
      // to full height at the far corner, and it TILTS with the fall — that
      // per-chip tilt is what makes light rake across a real mosaic floor
      // instead of sliding over one flat plane.
      const r = Math.min(1, Math.hypot(x - dx, z - dz) / far);
      transforms.push({
        position: [x, -slope * (1 - r), z],
        rotation: [((z - dz) / far) * slope * 1.2, 0, -((x - dx) / far) * slope * 1.2],
      });
    }
  }
  return { geometry, transforms, chip: face };
}

/**
 * Horizontal grout courses on a tiled wall: a shallow reveal every course so
 * the wall reads as stacked tile in raking light instead of a printed plane.
 * One instanced batch per wall.
 */
export function tileCourses(width: number, height: number, courseH: number, opts: {
  max?: number;
  /**
   * How it is LAID. Absent = the horizontal course reveals the field has
   * always been drawn with, so a spec that never mentions a pattern gets a
   * byte-identical run of bars.
   */
  pattern?: TilePattern | null;
  /** the tile's width along the wall, m — what the vertical joints are spaced on */
  moduleW?: number | null;
  /** joint width, m; absent = the 3 mm reveal the field has always had */
  joint?: number | null;
  /**
   * The most joint bars a WOVEN field may spend on this wall; past it the
   * weave falls back to courses. The caller decides because the answer is not
   * about the tile: one accent wall is worth several times what each of four
   * field walls is (see `WEAVE_CAP`).
   */
  weaveCap?: number | null;
} = {}): { geometry: THREE.BufferGeometry; transforms: InstanceTransform[] } {
  const W = clampNum(width, 0.05, 30, 1);
  const H = clampNum(height, 0.05, 8, 2);
  const ch = clampNum(courseH, 0.05, 0.9, 0.2);
  const maxRows = Math.round(clampNum(opts.max ?? 40, 1, 120, 40));
  const pattern = opts.pattern ?? null;
  if (pattern === null && opts.moduleW == null && opts.joint == null) {
    // the original path, untouched: a spec with no tile detail draws what it drew
    const geometry = chamferBox(W, 0.003, 0.0022, 0.0006);
    const rows = Math.min(maxRows, Math.max(0, Math.floor(H / ch) - 1));
    return { geometry, transforms: grid(1, rows, 0, ch, { origin: [0, ch, 0] }) };
  }
  // A slab has no joints at all — that IS the look, and drawing course lines on
  // it is the single most obvious way to get a slab shower wrong.
  if (pattern === 'slab') return { geometry: chamferBox(0.001, 0.001, 0.001, 0), transforms: [] };
  const joint = clampNum(opts.joint ?? 0.003, 0.0008, 0.02, 0.003);
  // A UNIT bar scaled to length, so the horizontals and the verticals of every
  // pattern come out of ONE instanced batch (one draw call for a whole wall).
  const geometry = chamferBox(1, joint, 0.0022, Math.min(0.0006, joint / 4));
  const modW = opts.moduleW == null ? null : clampNum(opts.moduleW, 0.02, 2, 0.3);
  const transforms: InstanceTransform[] = [];
  const CAP = maxRows * 12;
  /**
   * The most joint bars one wall's batch may hold, past which the weave falls
   * back to plain courses rather than truncating — a wall woven half way up
   * and bare above it is a worse tell than a wall of straight courses.
   *
   * One bar is 60 triangles, so the cap is a triangle budget in disguise. 720
   * was too tight to be honest: an 11 ft × 9 ft wall in a 4" herringbone —
   * the single most ordinary way anyone lays one — needs 828 bars and fell
   * back to straight courses, i.e. drew a different tile than the client
   * picked. The callers now spend up to 1600 on a field wall (50 k tris) and
   * 6000 on the one accent wall (360 k), against a whole-scene budget of 1.2 M
   * that a bathroom otherwise spends about 150 k of.
   *
   * The ceiling is a real one, not a formality: a big room in a fine tile —
   * 12 ft of 2" herringbone at full height is 4.4 k bars — still falls back,
   * and should. Note the UPPER CLAMP: it used to be 4000, so a caller asking
   * for more silently got the 720 default and wove nothing.
   */
  const WEAVE_CAP = clampNum(opts.weaveCap ?? 720, 0, 12000, 720);

  if (pattern === 'herringbone' || pattern === 'chevron' || pattern === 'basketweave') {
    // A woven field: short bars on the two diagonals.
    //
    // Two gates, both about not lying. The size floor was 4", which excluded
    // the 2×8 and 3×12 a herringbone feature wall is most often laid in and
    // quietly drew them as straight courses — a different tile, on the one
    // wall the client picked out. It is now the same 2" floor the vertical
    // joints use, below which a joint really is finer than the reveal is deep.
    // The second gate is the batch: a field that will not FIT falls back to
    // courses rather than weaving half a wall.
    const m = modW ?? ch;
    const pitch = m * (pattern === 'basketweave' ? 2 : Math.SQRT1_2 * 2);
    const cols = Math.floor(W / pitch), rows = Math.floor(H / pitch);
    if (m >= 0.05 && cols * rows * 2 <= WEAVE_CAP) {
      const bar = pattern === 'basketweave' ? m * 2 : m * Math.SQRT2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = -W / 2 + (c + 0.5) * pitch, y = (r + 0.5) * pitch;
          // chevron leans both bars the same way; herringbone alternates
          const a = pattern === 'basketweave' ? 0 : Math.PI / 4;
          const b = pattern === 'chevron' ? -Math.PI / 4 : pattern === 'basketweave' ? Math.PI / 2 : -Math.PI / 4;
          transforms.push({ position: [x, y, 0], rotation: [0, 0, a], scale: [bar, 1, 1] });
          transforms.push({ position: [x, y, 0], rotation: [0, 0, b], scale: [bar, 1, 1] });
        }
      }
      return { geometry, transforms };
    }
  }

  /**
   * `vertical-stack` says the tile stands on end — but a module is declared AS
   * LAID (`TileModule`: w across, h up), so when one is given it already says
   * that, and turning it on end a second time lays the tile back down: a
   * declared 3×12 vertical stack was drawn as a 12×3 horizontal run, courses
   * every 3" and joints every 12", which is a different tile. Only a bare
   * course height — nothing to contradict — is stood on end here.
   */
  const vertical = pattern === 'vertical-stack';
  // A hex / penny / mosaic field's own joints are 2 mm at a 25 mm pitch: they
  // belong to the texture, not to thousands of bars. What DOES show is the
  // 12" sheet the mosaic is installed in, so those are the courses drawn.
  const fine = pattern === 'hex' || pattern === 'penny' || pattern === 'mosaic';
  const rowH = fine ? Math.max(ch, 0.3048) : ch;
  const colW = vertical && !modW ? ch : modW;
  /**
   * Every joint INSIDE the field, and the cut course at the top keeps its own.
   * `floor(H / rowH) - 1` dropped the last full course whenever the run was
   * not an exact multiple of the module — a 54" wainscot in a 12" tile lost
   * the line at 48" and its top 6" went blank, which is precisely the "cut
   * tile at the end" a real installer leaves. `ceil - 1` keeps every line
   * below the top edge and still drops one that would land exactly ON it.
   */
  const rows = Math.min(maxRows, Math.max(0, Math.ceil(H / rowH) - 1));
  for (let r = 1; r <= rows; r++) transforms.push({ position: [0, r * rowH, 0], scale: [W, 1, 1] });

  /**
   * Vertical joints only where they would actually catch light. The floor used
   * to be 4", which silently deleted the joints that ARE the look of the two
   * narrowest field tiles a bathroom is ever laid in — a 3×12 stack and a 2×8
   * — and left them as bare horizontal courses. The patterns whose joints
   * genuinely belong to the texture are named (`fine`), so the size floor only
   * has to stop a joint finer than the 2.2 mm reveal is deep; `CAP` below is
   * what bounds the count.
   */
  if (colW && colW >= 0.05 && !fine) {
    const cols = Math.floor(W / colW);
    // running-bond breaks the joint by half a tile every course; a stack lines
    // them all up, which is the entire difference between the two.
    const stagger = pattern === 'running-bond' || pattern === null ? colW / 2 : 0;
    for (let r = 0; r <= rows && transforms.length < CAP; r++) {
      const y0 = r * rowH, y1 = Math.min(H, (r + 1) * rowH);
      if (y1 - y0 < 0.01) continue;
      const off = (r % 2) * stagger;
      for (let c = 1; c <= cols && transforms.length < CAP; c++) {
        const x = -W / 2 + c * colW - off;
        if (x <= -W / 2 + 0.01 || x >= W / 2 - 0.01) continue;
        transforms.push({ position: [x, (y0 + y1) / 2, 0], rotation: [0, 0, Math.PI / 2], scale: [y1 - y0, 1, 1] });
      }
    }
  }
  return { geometry, transforms };
}

// ---------------------------------------------------------------------------
// Millwork runs
// ---------------------------------------------------------------------------

/** Base moulding + shoe as one run. `profile` follows the room's design style. */
export function baseRun(length: number, profile: ProfileName = 'colonial-base', opts: { shoe?: boolean } = {}): THREE.BufferGeometry {
  const L = clampNum(length, 0.05, 30, 1);
  const shoe = opts.shoe !== false;
  return cached(`base|${k(L)}|${profile}|${shoe ? 's' : 'n'}`, () => {
    const from: Vec3 = [-L / 2, 0, 0], to: Vec3 = [L / 2, 0, 0];
    const parts = [profileMoulding([from, to], profile, { up: [0, 1, 0] })];
    if (shoe) parts.push(profileMoulding([from, to], 'shoe', { up: [0, 1, 0] }));
    return merged(parts);
  });
}

/** The design style's base profile — what a real carpenter would run in that house. */
export function baseProfileFor(style: string): ProfileName {
  switch (style) {
    case 'traditional': case 'mediterranean': return 'colonial-base';
    case 'craftsman': case 'farmhouse': return 'craftsman-base';
    case 'modern': case 'contemporary': case 'scandinavian': case 'industrial': case 'mid-century': return 'modern-base';
    default: return 'colonial-base';
  }
}
/** The matching casing profile. */
export function casingProfileFor(style: string): ProfileName {
  switch (style) {
    case 'traditional': case 'mediterranean': case 'coastal': return 'colonial-casing';
    case 'craftsman': case 'farmhouse': return 'craftsman-casing';
    default: return 'modern-casing';
  }
}

// ---------------------------------------------------------------------------
// Doors (room doors, not cabinet fronts)
// ---------------------------------------------------------------------------

/** Stile-and-rail room door: real stiles, rails, and recessed panels with a bead. */
export function roomDoor(w: number, h: number, thickness: number, panels: 2 | 3 | 5 | 0): { body: THREE.BufferGeometry; thickness: number } {
  const W = clampNum(w, 0.4, 1.6, 0.76), H = clampNum(h, 1.4, 3.2, 2.03);
  const T = clampNum(thickness, 0.02, 0.08, 0.042);
  const n = panels;
  return {
    body: cached(`rdoor|${k(W)}|${k(H)}|${k(T)}|${n}`, () => {
      const stile = Math.min(0.115, W * 0.16);
      const topRail = stile, botRail = Math.min(0.235, H * 0.13), lockRail = 0.14;
      const parts: THREE.BufferGeometry[] = [];
      const ch = 0.0015;
      parts.push(transformed(chamferBox(stile, H, T, ch), { position: [-W / 2 + stile / 2, 0, 0] }));
      parts.push(transformed(chamferBox(stile, H, T, ch), { position: [W / 2 - stile / 2, 0, 0] }));
      const innerW = Math.max(0.02, W - stile * 2);
      parts.push(transformed(chamferBox(innerW, topRail, T, ch), { position: [0, H / 2 - topRail / 2, 0] }));
      parts.push(transformed(chamferBox(innerW, botRail, T, ch), { position: [0, -H / 2 + botRail / 2, 0] }));
      if (n === 0) {
        parts.push(transformed(chamferBox(innerW, Math.max(0.02, H - topRail - botRail), T, ch), { position: [0, (botRail - topRail) / 2, 0] }));
      } else {
        const fieldTop = H / 2 - topRail, fieldBot = -H / 2 + botRail;
        const rails = n === 2 ? [0.42] : n === 3 ? [0.34, 0.68] : [0.22, 0.44, 0.66, 0.84];
        const cuts = [0, ...rails, 1];
        const back = Math.max(0.006, T - 0.016);
        for (let i = 0; i < cuts.length - 1; i++) {
          const y0 = fieldBot + (fieldTop - fieldBot) * cuts[i] + (i === 0 ? 0 : lockRail / 2);
          const y1 = fieldBot + (fieldTop - fieldBot) * cuts[i + 1] - (i === cuts.length - 2 ? 0 : lockRail / 2);
          const ph = y1 - y0;
          if (ph < 0.05) continue;
          parts.push(transformed(chamferBox(innerW, ph + 0.004, back, 0.0008), { position: [0, (y0 + y1) / 2, 0] }));
          // sticking: a bead around the panel opening, both faces
          for (const sz of [1, -1]) {
            const z = sz * (T / 2 - 0.0006);
            const bx = innerW / 2, by0 = y0, by1 = y1;
            parts.push(profileMoulding([[-bx, by0, z], [-bx, by1, z]], 'panel-bead', { scale: 0.7, up: [0, 0, sz] }));
            parts.push(profileMoulding([[bx, by1, z], [bx, by0, z]], 'panel-bead', { scale: 0.7, up: [0, 0, sz] }));
            parts.push(profileMoulding([[-bx, by1, z], [bx, by1, z]], 'panel-bead', { scale: 0.7, up: [0, 0, sz] }));
            parts.push(profileMoulding([[bx, by0, z], [-bx, by0, z]], 'panel-bead', { scale: 0.7, up: [0, 0, sz] }));
          }
        }
        for (const y of rails) {
          const yy = fieldBot + (fieldTop - fieldBot) * y;
          parts.push(transformed(chamferBox(innerW, lockRail, T, ch), { position: [0, yy, 0] }));
        }
      }
      return merged(parts);
    }),
    thickness: T,
  };
}

/** Door jamb + stop + threshold, in one piece. Faces +Z, x centred, y from 0. */
export function doorJamb(w: number, h: number, wallT: number, opts: { threshold?: boolean } = {}): THREE.BufferGeometry {
  const W = clampNum(w, 0.4, 3, 0.81), H = clampNum(h, 1.4, 3.2, 2.03);
  const T = clampNum(wallT, 0.05, 0.4, 0.115);
  const th = opts.threshold === true;
  return cached(`jamb|${k(W)}|${k(H)}|${k(T)}|${th ? 't' : 'n'}`, () => {
    const j = 0.019, stop = 0.012;
    const parts: THREE.BufferGeometry[] = [
      transformed(chamferBox(j, H, T, 0.001), { position: [-W / 2 - j / 2, H / 2, 0] }),
      transformed(chamferBox(j, H, T, 0.001), { position: [W / 2 + j / 2, H / 2, 0] }),
      transformed(chamferBox(W + j * 2, j, T, 0.001), { position: [0, H + j / 2, 0] }),
      // door stop, set back the depth of the slab
      transformed(chamferBox(stop, H, 0.010, 0.0008), { position: [-W / 2 + stop / 2, H / 2, -T / 2 + 0.048] }),
      transformed(chamferBox(stop, H, 0.010, 0.0008), { position: [W / 2 - stop / 2, H / 2, -T / 2 + 0.048] }),
      transformed(chamferBox(W, stop, 0.010, 0.0008), { position: [0, H - stop / 2, -T / 2 + 0.048] }),
    ];
    if (th) {
      // marble saddle: the tile stops on it and the floor outside starts after
      parts.push(transformed(filletBox(W + j * 2, 0.014, T + 0.02, 0.004, 2), { position: [0, 0.007, 0] }));
    }
    return merged(parts);
  });
}

// ---------------------------------------------------------------------------
// Mirrors
// ---------------------------------------------------------------------------
function panelOutline(w: number, h: number, arched: boolean): THREE.Shape {
  const s = new THREE.Shape();
  if (arched && h > w / 2 + 0.05) {
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2);
    s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false);
    s.lineTo(-w / 2, 0); s.closePath();
  } else {
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
  }
  return s;
}

/**
 * Mirror glass, its polished BEVEL, and an optional frame.
 *
 * The bevel is the point: a real mirror has a 20 mm ground border that catches
 * the light at a different angle from the face, and its absence is why a flat
 * quad never reads as a mirror. It is returned separately so it can take the
 * same slot material at a grazing angle.
 */
export function mirrorGeometries(w: number, h: number, opts: { arched: boolean; frame: number; depth: number; bevel?: number }): {
  glass: THREE.BufferGeometry; bevel: THREE.BufferGeometry | null; frame: THREE.BufferGeometry | null; backer: THREE.BufferGeometry;
} {
  const W = clampNum(w, 0.15, 4, 0.9), H = clampNum(h, 0.15, 3, 0.9);
  const frameW = clampNum(opts.frame, 0, 0.2, 0);
  const bevelW = clampNum(opts.bevel ?? (frameW > 0 ? 0 : 0.020), 0, 0.06, 0.020);
  const gw = Math.max(0.1, W - frameW * 2), gh = Math.max(0.1, H - frameW * 2);
  const inner = panelOutline(gw, gh, opts.arched);
  const glass = new THREE.ShapeGeometry(inner, 28);
  glass.translate(0, frameW, 0);
  applyWorldUVs(glass);

  // 6 mm of real glass behind the face, so the edge is not paper thin
  const backer = new THREE.ExtrudeGeometry(panelOutline(gw, gh, opts.arched), { depth: 0.006, bevelEnabled: false, curveSegments: 28 });
  backer.translate(0, frameW, -0.006);
  applyWorldUVs(backer);

  let bevel: THREE.BufferGeometry | null = null;
  if (bevelW > 0.002 && !opts.arched) {
    const b = bevelW;
    const parts: THREE.BufferGeometry[] = [];
    // four mitred facets, each tilted a couple of degrees off the face
    const mk = (len: number, rot: number, px: number, py: number) =>
      transformed(chamferBox(len, b, 0.003, 0.0004), { position: [px, py + frameW, 0.0016], rotation: [rot, 0, 0] });
    parts.push(mk(gw, -0.10, 0, gh - b / 2));
    parts.push(mk(gw, 0.10, 0, b / 2));
    parts.push(transformed(chamferBox(b, gh - b * 2, 0.003, 0.0004), { position: [-gw / 2 + b / 2, gh / 2 + frameW, 0.0016], rotation: [0, 0.10, 0] }));
    parts.push(transformed(chamferBox(b, gh - b * 2, 0.003, 0.0004), { position: [gw / 2 - b / 2, gh / 2 + frameW, 0.0016], rotation: [0, -0.10, 0] }));
    bevel = merged(parts);
  }

  let frame: THREE.BufferGeometry | null = null;
  if (frameW > 0) {
    const outer = panelOutline(W, H, opts.arched);
    const holeShape = new THREE.Shape();
    holeShape.setFromPoints(inner.getPoints(28).map((p) => new THREE.Vector2(p.x, p.y + frameW)));
    outer.holes.push(holeShape);
    const depth = clampNum(opts.depth, 0.006, 0.12, 0.028);
    const fg = new THREE.ExtrudeGeometry(outer, { depth: depth - 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 28 });
    fg.translate(0, 0, -depth / 2);
    applyWorldUVs(fg);
    frame = fg;
  }
  return { glass, bevel, frame, backer };
}

// ---------------------------------------------------------------------------
// Basins
// ---------------------------------------------------------------------------
/**
 * Lathe a profile [r, y][] around Y and guarantee the outside of the cup is the
 * front face whatever the point order. `outerIndex` must be a profile point on
 * the outer wall (r = max).
 */
export function cupLathe(profile: Array<[number, number]>, outerIndex: number, segments = 48): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const g = new THREE.LatheGeometry(pts, Math.round(clampNum(segments, 6, 96, 48)));
  g.computeVertexNormals();
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const i = Math.min(Math.max(0, outerIndex), pts.length - 1);
  const px = pos.getX(i), pz = pos.getZ(i);
  const hyp = Math.hypot(px, pz);
  const radial = hyp > 1e-6 ? [px / hyp, pz / hyp] : [0, 1];
  const dot = nor.getX(i) * radial[0] + nor.getZ(i) * radial[1];
  if (dot < 0 && g.index) {
    const idx = g.index.array as Uint16Array | Uint32Array;
    for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    g.index.needsUpdate = true;
    for (let t = 0; t < nor.count; t++) nor.setXYZ(t, -nor.getX(t), -nor.getY(t), -nor.getZ(t));
    nor.needsUpdate = true;
  }
  applyWorldUVs(g);
  return g;
}

/** Unit-radius cup profile (outer radius 1). Scale the mesh to (rx, 1, rz). */
export function cupProfile(opts: { height: number; wall: number; floor: number; rim: number; baseInset?: number; baseRise?: number }): { profile: Array<[number, number]>; outerIndex: number } {
  const height = clampNum(opts.height, 0.02, 1.2, 0.4);
  const wall = clampNum(opts.wall, 0.005, 0.4, 0.05);
  const floor = clampNum(opts.floor, 0, height * 0.8, 0.03);
  const rim = clampNum(opts.rim, 0.002, 0.12, 0.015);
  const baseInset = clampNum(opts.baseInset ?? 0.06, 0, 0.6, 0.06);
  const baseRise = clampNum(opts.baseRise ?? 0.02, 0, height * 0.5, 0.02);
  const rInner = 1 - wall;
  const p: Array<[number, number]> = [];
  p.push([0, floor]);
  p.push([rInner * 0.55, floor]);
  p.push([rInner * 0.88, floor + rim * 0.6]);
  p.push([rInner, floor + rim * 2.2]);
  p.push([rInner, height - rim]);
  const cx = (rInner + 1) / 2, rr = (1 - rInner) / 2;
  for (let i = 1; i < 6; i++) {
    const th = Math.PI - (Math.PI * i) / 6;
    p.push([cx + rr * Math.cos(th), height - rim + rim * Math.sin(th)]);
  }
  p.push([1, height - rim]);
  const outerIndex = p.length - 1;
  p.push([1, baseRise + 0.05]);
  p.push([1 - baseInset, baseRise]);
  p.push([1 - baseInset, 0]);
  p.push([0, 0]);
  return { profile: p, outerIndex };
}

/**
 * Undermount lavatory basin: a radiused oval bowl with a real wall thickness,
 * a rolled top flange that laps under the stone, a flat sump and the tapped
 * boss the drain screws into. Returned centred on the drain, with the flange
 * at y = 0 so it can be hung straight off the underside of a counter.
 */
export function undermountBasin(w: number, d: number, depth: number, opts: { round?: boolean } = {}): THREE.BufferGeometry {
  const W = clampNum(w, 0.20, 0.8, 0.44), D = clampNum(d, 0.18, 0.6, 0.34);
  const H = clampNum(depth, 0.06, 0.30, 0.155);
  const round = opts.round === true;
  return cached(`basin|${k(W)}|${k(D)}|${k(H)}|${round ? 'r' : 'o'}`, () => {
    // radii are FRACTIONS of the half axis (the bowl is scaled to W/2 × D/2 after),
    // heights are metres measured up from the sump.
    const ri = 1 - 0.010 / (W / 2);        // ~10 mm of vitreous china
    const p: Array<[number, number]> = [
      // inside: flat sump, then the wall sweeping up to the flange
      [0, 0.014], [0.20, 0.010], [0.48, H * 0.22], [0.76, H * 0.52], [0.93, H * 0.80],
      [ri, H - 0.028], [ri, H - 0.007],
      [1, H],                              // the rolled flange that laps under the stone
      [1, H - 0.013],
      // outside: back down to the underside of the sump
      [0.95, H - 0.034], [0.81, H * 0.54], [0.52, H * 0.18], [0.21, 0.002], [0, 0],
    ];
    const outerIndex = 7;
    const bowl = cupLathe(p, outerIndex, round ? 40 : 44);
    return transformed(bowl, { position: [0, -H, 0], scale: [W / 2, 1, D / 2] });
  });
}

/** Vessel basin: sits ON the counter, so it needs a finished outside. */
/**
 * A drop-in basin: the rim LANDS ON the stone instead of hanging under it, so
 * the top is cut smaller than the bowl and a 12 mm lip shows all the way round.
 * That lip is the whole visual difference from an undermount at the same size.
 */
export function dropInBasin(w: number, d: number, depth: number): THREE.BufferGeometry {
  const W = clampNum(w, 0.2, 1.0, 0.46), D = clampNum(d, 0.2, 0.8, 0.36), H = clampNum(depth, 0.05, 0.35, 0.155);
  return cached(`dropin|${k(W)}|${k(D)}|${k(H)}`, () => {
    const { profile, outerIndex } = cupProfile({ height: H, wall: 0.012, floor: 0.010, rim: 0.014, baseInset: 0.30, baseRise: 0.02 });
    return merged([
      transformed(cupLathe(profile, outerIndex, 40), { position: [0, -H, 0], scale: [W / 2 - 0.014, 1, D / 2 - 0.014] }),
      // the rim: a flat lip proud of the stone, softened at both edges
      transformed(filletBox(W, 0.012, D, 0.005, 2), { position: [0, 0.006, 0] }),
    ]);
  });
}

/**
 * A semi-recessed basin — half buried in the top, half hanging past its front
 * edge. It is what a 16"-deep vanity in a small bathroom actually gets, and it
 * reads completely differently from an undermount because the bowl is visible
 * in elevation.
 */
export function semiRecessedBasin(w: number, d: number, depth: number): THREE.BufferGeometry {
  const W = clampNum(w, 0.2, 1.0, 0.46), D = clampNum(d, 0.2, 0.8, 0.40), H = clampNum(depth, 0.06, 0.35, 0.17);
  return cached(`semirec|${k(W)}|${k(D)}|${k(H)}`, () => {
    const { profile, outerIndex } = cupProfile({ height: H, wall: 0.014, floor: 0.012, rim: 0.016, baseInset: 0.26, baseRise: 0.02 });
    return merged([
      transformed(cupLathe(profile, outerIndex, 44), { position: [0, -H, 0], scale: [W / 2, 1, D / 2] }),
      transformed(filletBox(W + 0.020, 0.014, D + 0.020, 0.006, 2), { position: [0, 0.007, 0] }),
    ]);
  });
}

/**
 * An integrated basin: one piece with the top, so there is no rim and no joint
 * — the surface simply falls into the bowl on a radius. Built as the DISH only;
 * the counter is drawn without a cut-out under it.
 */
export function integratedBasin(w: number, d: number, depth: number): THREE.BufferGeometry {
  const W = clampNum(w, 0.2, 1.0, 0.46), D = clampNum(d, 0.2, 0.8, 0.36), H = clampNum(depth, 0.04, 0.3, 0.10);
  return cached(`intbasin|${k(W)}|${k(D)}|${k(H)}`, () => {
    const { profile, outerIndex } = cupProfile({ height: H, wall: 0.016, floor: 0.014, rim: 0.030, baseInset: 0.34, baseRise: 0.03 });
    return transformed(cupLathe(profile, outerIndex, 44), { position: [0, -H, 0], scale: [W / 2, 1, D / 2] });
  });
}

/**
 * A wall-mounted lav tap: the spout comes OUT OF THE WALL above the bowl with
 * its handles beside it, so the top has no tap holes at all. Faces +Z.
 */
export function wallLavFaucet(opts: { reach?: number; spread?: number; cross?: boolean } = {}): THREE.BufferGeometry {
  const R = clampNum(opts.reach ?? 0.15, 0.06, 0.35, 0.15);
  const spread = clampNum(opts.spread ?? 0.20, 0.06, 0.4, 0.20);
  const cross = opts.cross === true;
  return cached(`wlav|${k(R)}|${k(spread)}|${cross ? 'x' : 'l'}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    // spout: escutcheon, a straight run out of the wall, then a turn down
    parts.push(transformed(lathePoints([[0, 0], [0.026, 0], [0.025, 0.005], [0.015, 0.011], [0, 0.012]], 18), { rotation: [-Math.PI / 2, 0, 0] }));
    parts.push(transformed(chamferCylinder(0.011, R, 0.0008, 14), { position: [0, 0, R / 2 + 0.008], rotation: [Math.PI / 2, 0, 0] }));
    parts.push(transformed(chamferCylinder(0.011, 0.038, 0.0008, 14), { position: [0, -0.019, R + 0.008] }));
    parts.push(transformed(lathePoints([[0, 0], [0.010, 0], [0.009, 0.006], [0, 0.007]], 12), { position: [0, -0.040, R + 0.008], rotation: [Math.PI, 0, 0] }));
    for (const sx of [-1, 1]) {
      parts.push(transformed(lathePoints([[0, 0], [0.022, 0], [0.021, 0.005], [0.013, 0.010], [0, 0.011]], 16), { position: [sx * spread / 2, 0, 0], rotation: [-Math.PI / 2, 0, 0] }));
      parts.push(transformed(chamferCylinder(0.009, 0.034, 0.0006, 12), { position: [sx * spread / 2, 0, 0.019], rotation: [Math.PI / 2, 0, 0] }));
      if (cross) {
        parts.push(transformed(chamferCylinder(0.005, 0.062, 0.0006, 8), { position: [sx * spread / 2, 0, 0.040], rotation: [0, 0, Math.PI / 2] }));
        parts.push(transformed(chamferCylinder(0.005, 0.062, 0.0006, 8), { position: [sx * spread / 2, 0, 0.040], rotation: [Math.PI / 2, 0, 0] }));
      } else {
        parts.push(transformed(chamferBox(0.016, 0.062, 0.012, 0.0012), { position: [sx * spread / 2, 0.024, 0.040] }));
      }
    }
    return merged(parts);
  });
}

/** A finger-pull rail: the 15 mm chamfered reveal an integrated-handle front is opened by. */
export function fingerPull(width: number): THREE.BufferGeometry {
  const W = clampNum(width, 0.05, 1.4, 0.4);
  return cached(`fpull|${k(W)}`, () => merged([
    transformed(chamferBox(W, 0.016, 0.010, 0.0015), { position: [0, 0, -0.005] }),
    transformed(chamferBox(W, 0.006, 0.014, 0.0010), { position: [0, 0.011, 0.002], rotation: [-0.5, 0, 0] }),
  ]));
}

/**
 * A sliding / barn track: the rail, its two stand-offs and the roller wheels.
 * A barn door hangs BELOW an exposed rail on big wheels; a bypass slider runs
 * inside a slimmer channel. Both faces +Z, origin at the rail centre.
 */
export function glassTrack(length: number, opts: { barn?: boolean; rollers?: number } = {}): THREE.BufferGeometry {
  const L = clampNum(length, 0.3, 3, 1.2);
  const barn = opts.barn === true;
  const n = Math.round(clampNum(opts.rollers ?? 2, 0, 6, 2));
  return cached(`gtrack|${k(L)}|${barn ? 'b' : 's'}|${n}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(barn ? chamferBox(L, 0.030, 0.014, 0.0015) : chamferBox(L, 0.042, 0.032, 0.0018), { position: [0, 0, 0] }));
    for (const sx of [-1, 1]) {
      parts.push(transformed(chamferCylinder(0.010, 0.052, 0.0008, 12), { position: [sx * (L / 2 - 0.06), 0, -0.030], rotation: [Math.PI / 2, 0, 0] }));
      parts.push(transformed(lathePoints([[0, 0], [0.024, 0], [0.023, 0.005], [0.013, 0.010], [0, 0.011]], 16), { position: [sx * (L / 2 - 0.06), 0, -0.056], rotation: [-Math.PI / 2, 0, 0] }));
    }
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -L / 4 + (i / Math.max(1, n - 1)) * (L / 2);
      parts.push(transformed(lathePoints([[0, 0], [barn ? 0.038 : 0.020, 0], [barn ? 0.038 : 0.020, 0.010], [0, 0.010]], 16), { position: [x, barn ? -0.030 : 0, 0.006], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  });
}

/** A heated towel ladder: two posts and its rails, wall-mounted. Faces +Z. */
export function towelWarmer(width: number, height: number, bars = 6): THREE.BufferGeometry {
  const W = clampNum(width, 0.25, 1.0, 0.55), H = clampNum(height, 0.3, 1.6, 0.90);
  const n = Math.round(clampNum(bars, 2, 12, 6));
  return cached(`warmer|${k(W)}|${k(H)}|${n}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      parts.push(transformed(chamferCylinder(0.011, H, 0.0008, 12), { position: [sx * W / 2, 0, 0.052] }));
      for (const sy of [-1, 1]) {
        parts.push(transformed(chamferCylinder(0.008, 0.046, 0.0006, 10), { position: [sx * W / 2, sy * (H / 2 - 0.07), 0.026], rotation: [Math.PI / 2, 0, 0] }));
        parts.push(transformed(lathePoints([[0, 0], [0.022, 0], [0.021, 0.005], [0.012, 0.010], [0, 0.011]], 14), { position: [sx * W / 2, sy * (H / 2 - 0.07), 0], rotation: [-Math.PI / 2, 0, 0] }));
      }
    }
    for (let i = 0; i < n; i++) {
      const y = -H / 2 + 0.04 + (i / Math.max(1, n - 1)) * (H - 0.08);
      parts.push(transformed(chamferCylinder(0.009, W, 0.0006, 10), { position: [0, y, 0.052], rotation: [0, 0, Math.PI / 2] }));
    }
    return merged(parts);
  });
}

/** A wire shower caddy: a shallow basket on a back plate. Faces +Z. */
export function showerCaddy(width: number): THREE.BufferGeometry {
  const W = clampNum(width, 0.15, 0.6, 0.30);
  const D = W * 0.42;
  return cached(`caddy|${k(W)}`, () => merged([
    transformed(chamferBox(W, 0.012, D, 0.0015), { position: [0, 0, D / 2] }),
    transformed(chamferCylinder(0.005, W, 0.0005, 8), { position: [0, 0.038, D], rotation: [0, 0, Math.PI / 2] }),
    ...[-1, 1].map((sx) => transformed(chamferCylinder(0.005, D, 0.0005, 8), { position: [sx * W / 2, 0.038, D / 2], rotation: [Math.PI / 2, 0, 0] })),
    ...[-1, 1].map((sx) => transformed(chamferBox(0.020, 0.052, 0.010, 0.0012), { position: [sx * (W / 2 - 0.02), 0.020, 0.005] })),
  ]));
}

/** A quarter-round corner shelf with a broken front edge. */
export function cornerShelf(radius: number): THREE.BufferGeometry {
  const R = clampNum(radius, 0.08, 0.5, 0.25);
  return cached(`cshelf|${k(R)}`, () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(R, 0);
    shape.absarc(0, 0, R, 0, Math.PI / 2, false);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.0025, bevelSegments: 2, curveSegments: 20 });
    g.rotateX(-Math.PI / 2);
    return applyWorldUVs(g);
  });
}

export function vesselBasin(d: number, h: number): THREE.BufferGeometry {
  const D = clampNum(d, 0.24, 0.6, 0.40), H = clampNum(h, 0.08, 0.25, 0.135);
  return cached(`vessel|${k(D)}|${k(H)}`, () => {
    const { profile, outerIndex } = cupProfile({ height: H, wall: 0.055, floor: 0.014, rim: 0.010, baseInset: 0.42, baseRise: 0.006 });
    return transformed(cupLathe(profile, outerIndex, 44), { scale: [D / 2, 1, D / 2] });
  });
}

/** Pop-up drain: flange ring, grid and the stopper cap. */
export function basinDrain(): THREE.BufferGeometry {
  return cached('drain-basin', () => merged([
    lathePoints([[0, 0], [0.021, 0], [0.021, 0.0025], [0.019, 0.0038], [0.010, 0.0040], [0.010, -0.014], [0, -0.014]], 20),
    transformed(chamferCylinder(0.014, 0.006, 0.0008, 16), { position: [0, 0.008, 0] }),
  ]));
}

/** Shower / tub waste: strainer body with real slots cut as raised ribs. */
export function wasteGrate(dMm = 90, opts: { square?: boolean } = {}): THREE.BufferGeometry {
  const D = clampNum(dMm, 40, 220, 90) * 0.001;
  const sq = opts.square === true;
  return cached(`waste|${k(D)}|${sq ? 'q' : 'r'}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    if (sq) {
      parts.push(transformed(chamferBox(D, 0.005, D, 0.0008), { position: [0, 0.0025, 0] }));
      const n = 5;
      for (let i = 0; i < n; i++) {
        const z = -D / 2 + (D / (n + 1)) * (i + 1);
        parts.push(transformed(chamferBox(D * 0.74, 0.0026, D * 0.055, 0.0004), { position: [0, 0.0062, z] }));
      }
    } else {
      parts.push(lathePoints([[0, 0.005], [D / 2 - 0.002, 0.005], [D / 2, 0.0032], [D / 2, 0], [0, 0]], 24));
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI;
        parts.push(transformed(chamferBox(D * 0.78, 0.0022, D * 0.055, 0.0004), { position: [0, 0.0065, 0], rotation: [0, a, 0] }));
      }
    }
    return merged(parts);
  });
}

/** Linear shower drain: a channel with a slotted or tile-in cover. */
export function linearDrain(length: number, opts: { tileIn?: boolean } = {}): THREE.BufferGeometry {
  const L = clampNum(length, 0.2, 2.0, 0.6);
  const tileIn = opts.tileIn === true;
  return cached(`lindrain|${k(L)}|${tileIn ? 't' : 's'}`, () => {
    const W = 0.070, T = 0.006;
    const parts: THREE.BufferGeometry[] = [
      transformed(chamferBox(L, 0.030, W, 0.0010), { position: [0, -0.015, 0] }),      // channel body
      transformed(chamferBox(L + 0.006, T, W + 0.006, 0.0008), { position: [0, T / 2, 0] }), // frame
    ];
    if (tileIn) {
      parts.push(transformed(chamferBox(L - 0.010, 0.004, W - 0.024, 0.0006), { position: [0, T + 0.002, 0] }));
    } else {
      const n = Math.min(60, Math.max(6, Math.round(L / 0.022)));
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + (L / (n + 1)) * (i + 1);
        parts.push(transformed(chamferBox(0.008, 0.004, W - 0.020, 0.0005), { position: [x, T + 0.002, 0] }));
      }
    }
    return merged(parts);
  });
}

/** P-trap, tailpiece and two angle stops with braided supply lines. */
export function trapAndSupplies(spread = 0.20): THREE.BufferGeometry {
  const S = clampNum(spread, 0.05, 0.6, 0.20);
  return cached(`trap|${k(S)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const r = 0.019;
    parts.push(transformed(chamferCylinder(r, 0.14, 0.001, 14), { position: [0, -0.07, 0] }));         // tailpiece
    // the U bend: a ring swept around a half circle in the YZ plane
    const ring: Vec2[] = [];
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; ring.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const path: Vec3[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI + (i / 12) * Math.PI;
      path.push([0, -0.175 + Math.sin(a) * 0.048, 0.048 + Math.cos(a) * 0.048]);
    }
    parts.push(sweepProfile(ring, path, { up: [1, 0, 0], caps: false }));
    parts.push(transformed(chamferCylinder(r, 0.10, 0.001, 14), { position: [0, -0.132, 0.096], rotation: [Math.PI / 2, 0, 0] }));
    parts.push(transformed(lathePoints([[0, 0], [0.030, 0], [0.029, 0.006], [0.021, 0.010], [0, 0.010]], 16), { position: [0, -0.132, 0.140], rotation: [Math.PI / 2, 0, 0] }));
    for (const sx of [-1, 1]) {
      const x = (sx * S) / 2;
      parts.push(transformed(chamferCylinder(0.012, 0.055, 0.0008, 12), { position: [x, -0.30, 0.070], rotation: [Math.PI / 2, 0, 0] }));   // stop body
      parts.push(transformed(chamferCylinder(0.017, 0.010, 0.0008, 14), { position: [x, -0.30, 0.104], rotation: [Math.PI / 2, 0, 0] }));   // handle hub
      parts.push(transformed(lathePoints([[0, 0], [0.020, 0], [0.020, 0.004], [0.006, 0.008], [0, 0.008]], 12), { position: [x, -0.30, 0.112], rotation: [Math.PI / 2, 0, 0] }));
      // braided riser bowing gently up to the faucet shank
      const rise: Vec3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        rise.push([x + sx * 0.012 * Math.sin(t * Math.PI), -0.30 + t * 0.28, 0.052 - t * 0.030]);
      }
      const small: Vec2[] = [];
      for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2; small.push([Math.cos(a) * 0.0055, Math.sin(a) * 0.0055]); }
      parts.push(sweepProfile(small, rise, { up: [0, 0, 1], caps: false }));
    }
    return merged(parts);
  });
}

// ---------------------------------------------------------------------------
// Faucets and trim
// ---------------------------------------------------------------------------

/** Single-hole lavatory faucet: escutcheon, riser, arced spout, aerator, lever. */
export function lavFaucet(opts: { height?: number; reach?: number; widespread?: boolean; cross?: boolean } = {}): THREE.BufferGeometry {
  const H = clampNum(opts.height ?? 0.235, 0.10, 0.55, 0.235);
  const reach = clampNum(opts.reach ?? 0.125, 0.04, 0.30, 0.125);
  const wide = opts.widespread === true;
  const cross = opts.cross === true;
  return cached(`lav|${k(H)}|${k(reach)}|${wide ? 'w' : 's'}|${cross ? 'c' : 'l'}`, () => {
    const tube = 0.021;
    const parts: THREE.BufferGeometry[] = [];
    parts.push(lathePoints([[0, 0], [0.031, 0], [0.030, 0.005], [0.019, 0.011], [tube / 2 + 0.002, 0.020], [tube / 2, 0.030], [0, 0.030]], 22));
    const ring: Vec2[] = [];
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; ring.push([Math.cos(a) * (tube / 2), Math.sin(a) * (tube / 2)]); }
    const path: Vec3[] = [];
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      path.push([0, 0.026 + (H - 0.026) * Math.sin((Math.PI / 2) * t), reach * (1 - Math.cos((Math.PI / 2) * t)) * (0.62 + t * 0.38)]);
    }
    parts.push(sweepProfile(ring, path, { up: [1, 0, 0], caps: false }));
    const head = path[path.length - 1];
    parts.push(transformed(lathePoints([[0, 0], [tube * 0.62, 0], [tube * 0.66, -0.009], [tube * 0.55, -0.024], [tube * 0.34, -0.028], [0, -0.028]], 18), { position: head }));
    const handle = (x: number) => {
      const hp: THREE.BufferGeometry[] = [];
      hp.push(transformed(lathePoints([[0, 0], [0.024, 0], [0.023, 0.005], [0.014, 0.010], [0, 0.010]], 18), { position: [x, 0, 0] }));
      hp.push(transformed(chamferCylinder(0.010, 0.026, 0.0008, 12), { position: [x, 0.021, 0] }));
      if (cross) {
        hp.push(transformed(chamferBox(0.062, 0.008, 0.010, 0.0012), { position: [x, 0.038, 0] }));
        hp.push(transformed(chamferBox(0.010, 0.008, 0.062, 0.0012), { position: [x, 0.038, 0] }));
        hp.push(transformed(chamferCylinder(0.011, 0.008, 0.0008, 12), { position: [x, 0.040, 0] }));
      } else {
        hp.push(transformed(chamferCylinder(0.012, 0.011, 0.0008, 12), { position: [x, 0.036, 0] }));
        hp.push(transformed(chamferBox(0.013, 0.010, 0.062, 0.0016), { position: [x, 0.040, 0.022] }));
      }
      return hp;
    };
    if (wide) { parts.push(...handle(-0.102), ...handle(0.102)); }
    else {
      parts.push(transformed(chamferCylinder(0.011, 0.012, 0.0008, 12), { position: [0.020, 0.052, -0.004], rotation: [0, 0, 0.35] }));
      parts.push(transformed(chamferBox(0.012, 0.010, 0.058, 0.0016), { position: [0.030, 0.062, -0.020], rotation: [0.25, 0, 0.35] }));
    }
    return merged(parts);
  });
}

/** Wall-mounted tub spout + two handles on a plate. Faces +Z. */
export function wallTubTrim(opts: { spread?: number; cross?: boolean } = {}): THREE.BufferGeometry {
  const S = clampNum(opts.spread ?? 0.203, 0.10, 0.40, 0.203);
  const cross = opts.cross === true;
  return cached(`wtt|${k(S)}|${cross ? 'c' : 'l'}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    // spout: a tapered body with a real underside outlet and a lip
    parts.push(transformed(lathePoints([[0, 0], [0.036, 0], [0.035, 0.004], [0.026, 0.009], [0.024, 0.012], [0, 0.012]], 20), { rotation: [Math.PI / 2, 0, 0] }));
    parts.push(transformed(filletBox(0.048, 0.044, 0.150, 0.010, 2), { position: [0, 0, 0.086] }));
    parts.push(transformed(chamferBox(0.040, 0.008, 0.030, 0.0012), { position: [0, -0.022, 0.146] }));
    parts.push(transformed(chamferCylinder(0.011, 0.010, 0.0008, 12), { position: [0, -0.026, 0.140] }));
    for (const sx of [-1, 1]) {
      const x = (sx * S) / 2;
      parts.push(transformed(lathePoints([[0, 0], [0.032, 0], [0.031, 0.005], [0.020, 0.010], [0, 0.010]], 20), { position: [x, 0.115, 0], rotation: [Math.PI / 2, 0, 0] }));
      parts.push(transformed(chamferCylinder(0.011, 0.028, 0.0008, 12), { position: [x, 0.115, 0.024], rotation: [Math.PI / 2, 0, 0] }));
      if (cross) {
        parts.push(transformed(chamferBox(0.066, 0.009, 0.011, 0.0012), { position: [x, 0.115, 0.042] }));
        parts.push(transformed(chamferBox(0.011, 0.066, 0.011, 0.0012), { position: [x, 0.115, 0.042] }));
      } else {
        parts.push(transformed(chamferBox(0.012, 0.070, 0.013, 0.0016), { position: [x, 0.140, 0.042] }));
      }
    }
    return merged(parts);
  });
}

/**
 * Freestanding floor-mount tub filler with a hand shower on the riser.
 *
 * `reach` is how far the gooseneck carries the spout out from the column, and
 * it is the whole point of the fitting: the column stands on the floor beside
 * the tub and the spout has to arrive OVER the rim. The caller sets it from
 * the standoff it used, so the water lands in the bath.
 */
export function floorTubFiller(height = 1.06, reach = 0.20): THREE.BufferGeometry {
  const H = clampNum(height, 0.6, 1.6, 1.06);
  const RCH = clampNum(reach, 0.10, 0.45, 0.20);
  return cached(`ftf|${k(H)}|${k(RCH)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(lathePoints([[0, 0], [0.056, 0], [0.055, 0.006], [0.038, 0.014], [0.026, 0.024], [0.016, 0.030], [0, 0.030]], 24));
    parts.push(transformed(chamferCylinder(0.014, H - 0.13, 0.0012, 16), { position: [0, 0.03 + (H - 0.13) / 2, 0] }));
    const ring: Vec2[] = [];
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; ring.push([Math.cos(a) * 0.013, Math.sin(a) * 0.013]); }
    const path: Vec3[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; path.push([0, H - 0.10 + 0.10 * Math.sin((Math.PI / 2) * t), RCH * (1 - Math.cos((Math.PI / 2) * t))]); }
    parts.push(sweepProfile(ring, path, { up: [1, 0, 0], caps: false }));
    const head = path[path.length - 1];
    parts.push(transformed(lathePoints([[0, 0], [0.014, 0], [0.015, -0.010], [0.011, -0.026], [0, -0.026]], 16), { position: head }));
    // diverter + hand shower cradled on the riser
    parts.push(transformed(chamferCylinder(0.018, 0.030, 0.001, 14), { position: [0.026, 0.56, 0], rotation: [0, 0, Math.PI / 2] }));
    parts.push(transformed(chamferBox(0.011, 0.011, 0.062, 0.0014), { position: [0.046, 0.56, 0.024] }));
    parts.push(transformed(chamferCylinder(0.020, 0.034, 0.001, 12), { position: [-0.030, 0.63, 0], rotation: [0, 0, Math.PI / 2] }));
    parts.push(transformed(chamferCylinder(0.014, 0.190, 0.001, 12), { position: [-0.030, 0.74, 0] }));
    parts.push(transformed(lathePoints([[0, 0], [0.026, 0], [0.028, 0.008], [0.026, 0.016], [0, 0.018]], 18), { position: [-0.030, 0.835, 0] }));
    return merged(parts);
  });
}

/** Deck-mount tub filler for a drop-in or corner deck. */
export function deckTubFiller(): THREE.BufferGeometry {
  return cached('dtf', () => merged([
    lathePoints([[0, 0], [0.040, 0], [0.039, 0.006], [0.024, 0.013], [0.018, 0.020], [0, 0.020]], 22),
    transformed(chamferCylinder(0.017, 0.090, 0.001, 14), { position: [0, 0.065, 0] }),
    transformed(filletBox(0.038, 0.034, 0.130, 0.008, 2), { position: [0, 0.112, 0.056] }),
    transformed(chamferCylinder(0.010, 0.008, 0.0006, 12), { position: [0, 0.094, 0.108] }),
    transformed(lathePoints([[0, 0], [0.026, 0], [0.025, 0.005], [0.016, 0.010], [0, 0.010]], 18), { position: [0.115, 0, 0] }),
    transformed(chamferCylinder(0.010, 0.024, 0.0008, 12), { position: [0.115, 0.020, 0] }),
    transformed(chamferBox(0.012, 0.010, 0.058, 0.0016), { position: [0.115, 0.034, 0.020] }),
  ]));
}

/** Shower valve trim: escutcheon plate, temperature lever and volume knob. */
export function showerValve(opts: { round?: boolean; diverter?: boolean } = {}): THREE.BufferGeometry {
  const round = opts.round !== false;
  const div = opts.diverter === true;
  return cached(`svlv|${round ? 'r' : 'q'}|${div ? 'd' : 'n'}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(round
      ? transformed(lathePoints([[0, 0], [0.083, 0], [0.084, 0.004], [0.079, 0.009], [0.030, 0.012], [0, 0.012]], 28), { rotation: [Math.PI / 2, 0, 0] })
      : transformed(filletBox(0.150, 0.150, 0.012, 0.006, 2), { position: [0, 0, 0.006] }));
    parts.push(transformed(chamferCylinder(0.019, 0.032, 0.0010, 16), { position: [0, 0, 0.026], rotation: [Math.PI / 2, 0, 0] }));
    parts.push(transformed(chamferBox(0.014, 0.011, 0.072, 0.0016), { position: [0, 0.030, 0.034], rotation: [-0.10, 0, 0] }));
    // the four cover screws that hold a real plate on
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
      parts.push(transformed(screwHead(5), { position: [sx * 0.052, sy * 0.052, 0.012], rotation: [Math.PI / 2, 0, 0] }));
    }
    if (div) {
      parts.push(transformed(chamferCylinder(0.014, 0.030, 0.0008, 14), { position: [0, -0.052, 0.024], rotation: [Math.PI / 2, 0, 0] }));
      parts.push(transformed(chamferBox(0.010, 0.044, 0.011, 0.0012), { position: [0, -0.052, 0.038] }));
    }
    return merged(parts);
  });
}

/** Wall shower arm + head, angled down. Origin at the wall, projecting +Z. */
export function wallShowerHead(opts: { armLength?: number; headMm?: number } = {}): THREE.BufferGeometry {
  const L = clampNum(opts.armLength ?? 0.34, 0.12, 0.7, 0.34);
  const HD = clampNum(opts.headMm ?? 150, 60, 320, 150) * 0.001;
  return cached(`wsh|${k(L)}|${k(HD)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(lathePoints([[0, 0], [0.032, 0], [0.031, 0.005], [0.019, 0.011], [0.010, 0.014], [0, 0.014]], 20), { rotation: [Math.PI / 2, 0, 0] }));
    const ring: Vec2[] = [];
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; ring.push([Math.cos(a) * 0.0105, Math.sin(a) * 0.0105]); }
    const path: Vec3[] = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; path.push([0, -0.075 * t * t, 0.012 + L * t]); }
    parts.push(sweepProfile(ring, path, { up: [1, 0, 0], caps: false }));
    const end = path[path.length - 1];
    parts.push(transformed(lathePoints([[0, 0], [0.017, 0], [0.019, 0.010], [0.017, 0.020], [0, 0.022]], 16), { position: end, rotation: [Math.PI / 2 - 0.36, 0, 0] }));
    // head: rim, face, and the nozzle ring you can actually see
    parts.push(transformed(lathePoints([[0, 0], [HD / 2 - 0.004, 0], [HD / 2, 0.005], [HD / 2, 0.016], [HD / 2 - 0.006, 0.021], [0, 0.021]], 30),
      { position: [end[0], end[1] - 0.030, end[2] + 0.028], rotation: [-0.36, 0, 0] }));
    parts.push(transformed(lathePoints([[0, 0], [HD / 2 - 0.010, 0], [HD / 2 - 0.010, 0.002], [0, 0.002]], 26),
      { position: [end[0], end[1] - 0.034, end[2] + 0.026], rotation: [-0.36, 0, 0] }));
    return merged(parts);
  });
}

/** Ceiling rain head on a real drop arm with a canopy. Hangs down from y = 0. */
export function ceilingRainHead(drop: number, diameterMm = 250, opts: { square?: boolean } = {}): THREE.BufferGeometry {
  const D = clampNum(drop, 0.04, 0.9, 0.24);
  const HD = clampNum(diameterMm, 100, 600, 250) * 0.001;
  const sq = opts.square === true;
  return cached(`crh|${k(D)}|${k(HD)}|${sq ? 'q' : 'r'}`, () => {
    const parts: THREE.BufferGeometry[] = [
      lathePoints([[0, 0], [0.040, 0], [0.039, -0.005], [0.024, -0.011], [0.014, -0.015], [0, -0.015]], 22),
      transformed(chamferCylinder(0.013, D, 0.0010, 14), { position: [0, -D / 2 - 0.012, 0] }),
    ];
    const y = -D - 0.012;
    if (sq) {
      parts.push(transformed(filletBox(HD, 0.014, HD, 0.004, 2), { position: [0, y - 0.007, 0] }));
      parts.push(transformed(chamferBox(HD - 0.020, 0.003, HD - 0.020, 0.001), { position: [0, y - 0.015, 0] }));
    } else {
      parts.push(transformed(lathePoints([[0, 0], [HD / 2 - 0.005, 0], [HD / 2, -0.005], [HD / 2, -0.013], [HD / 2 - 0.006, -0.017], [0, -0.017]], 34), { position: [0, y, 0] }));
      parts.push(transformed(lathePoints([[0, 0], [HD / 2 - 0.012, 0], [HD / 2 - 0.012, -0.002], [0, -0.002]], 30), { position: [0, y - 0.017, 0] }));
    }
    return merged(parts);
  });
}

/** Hand shower on a slide bar, with a hose that actually hangs. Faces +Z. */
export function slideBarSet(length = 0.66): THREE.BufferGeometry {
  const L = clampNum(length, 0.3, 1.2, 0.66);
  return cached(`slide|${k(L)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(chamferCylinder(0.011, L, 0.0009, 14), { position: [0, L / 2, 0.050] }));
    for (const y of [0, L]) {
      parts.push(transformed(lathePoints([[0, 0], [0.026, 0], [0.025, 0.005], [0.015, 0.010], [0, 0.010]], 18), { position: [0, y, 0], rotation: [-Math.PI / 2, 0, 0] }));
      parts.push(transformed(chamferCylinder(0.008, 0.042, 0.0006, 10), { position: [0, y, 0.030], rotation: [Math.PI / 2, 0, 0] }));
    }
    const hy = L * 0.72;
    parts.push(transformed(chamferCylinder(0.020, 0.042, 0.0008, 14), { position: [0, hy, 0.072], rotation: [Math.PI / 2 - 0.5, 0, 0] }));
    parts.push(transformed(chamferCylinder(0.0115, 0.185, 0.0008, 12), { position: [0, hy + 0.082, 0.117], rotation: [0.5, 0, 0] }));
    parts.push(transformed(lathePoints([[0, 0], [0.024, 0], [0.026, 0.008], [0.023, 0.015], [0, 0.016]], 18), { position: [0, hy + 0.176, 0.168], rotation: [0.5, 0, 0] }));
    // hose: a real catenary, not a straight stick
    const ring: Vec2[] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2; ring.push([Math.cos(a) * 0.0062, Math.sin(a) * 0.0062]); }
    const path: Vec3[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      path.push([Math.sin(t * Math.PI) * 0.028, hy - 0.03 - (hy - 0.02) * t, 0.086 + Math.sin(t * Math.PI) * 0.062]);
    }
    parts.push(sweepProfile(ring, path, { up: [0, 0, 1], caps: false }));
    parts.push(transformed(lathePoints([[0, 0], [0.024, 0], [0.023, 0.005], [0.014, 0.011], [0, 0.011]], 16), { position: [0, -0.010, 0], rotation: [-Math.PI / 2, 0, 0] }));
    return merged(parts);
  });
}

/** Flush body jet with a real ball nozzle. */
export function bodyJet(): THREE.BufferGeometry {
  return cached('jet', () => merged([
    transformed(lathePoints([[0, 0], [0.030, 0], [0.029, 0.004], [0.020, 0.008], [0, 0.009]], 20), { rotation: [Math.PI / 2, 0, 0] }),
    transformed(lathePoints([[0, 0], [0.016, 0], [0.018, 0.008], [0.014, 0.016], [0, 0.016]], 16), { position: [0, 0, 0.008], rotation: [Math.PI / 2, 0, 0] }),
  ]));
}

// ---------------------------------------------------------------------------
// Glass enclosure
// ---------------------------------------------------------------------------

/** A real 10 mm glass panel: full thickness with polished, chamfered edges. */
export function glassPane(w: number, h: number, thickness = 0.010): THREE.BufferGeometry {
  const W = clampNum(w, 0.05, 3, 0.7), H = clampNum(h, 0.05, 3, 1.9);
  const T = clampNum(thickness, 0.004, 0.02, 0.010);
  return cached(`pane|${k(W)}|${k(H)}|${k(T)}`, () => chamferBox(W, H, T, T * 0.14).clone());
}

/** Frameless header bar with the two mounting brackets that carry it. */
export function glassHeader(length: number): THREE.BufferGeometry {
  const L = clampNum(length, 0.2, 3.5, 1);
  return cached(`ghdr|${k(L)}`, () => merged([
    transformed(chamferBox(L, 0.026, 0.026, 0.0018), { position: [0, 0, 0] }),
    ...[-1, 1].map((sx) => transformed(chamferBox(0.010, 0.048, 0.038, 0.0012), { position: [(sx * (L - 0.012)) / 2, 0, 0] })),
  ]));
}

/** Frameless pivot hinge: wall plate, barrel, glass clamp, cover screws. */
export function glassHinge(): THREE.BufferGeometry {
  return cached('ghinge', () => merged([
    transformed(filletBox(0.052, 0.062, 0.010, 0.003, 2), { position: [0, 0, 0.005] }),
    transformed(chamferCylinder(0.011, 0.062, 0.0008, 14), { position: [0, 0, 0.019] }),
    transformed(filletBox(0.030, 0.056, 0.026, 0.003, 2), { position: [0, 0, 0.036] }),
    transformed(screwHead(6), { position: [0, 0.022, 0.010], rotation: [Math.PI / 2, 0, 0] }),
    transformed(screwHead(6), { position: [0, -0.022, 0.010], rotation: [Math.PI / 2, 0, 0] }),
  ]));
}

/** Back-to-back glass door handle (ladder pull) with its through-bolts. */
export function glassHandle(length = 0.30): THREE.BufferGeometry {
  const L = clampNum(length, 0.10, 0.8, 0.30);
  return cached(`ghandle|${k(L)}`, () => {
    const parts: THREE.BufferGeometry[] = [
      transformed(chamferCylinder(0.011, L, 0.0010, 14), { position: [0, 0, 0.056], rotation: [0, 0, Math.PI / 2] }),
    ];
    for (const sx of [-1, 1]) {
      const x = (sx * (L - 0.052)) / 2;
      parts.push(transformed(chamferCylinder(0.008, 0.045, 0.0006, 12), { position: [x, 0, 0.033], rotation: [Math.PI / 2, 0, 0] }));
      parts.push(transformed(chamferCylinder(0.014, 0.008, 0.0006, 14), { position: [x, 0, 0.014], rotation: [Math.PI / 2, 0, 0] }));
      parts.push(transformed(chamferCylinder(0.014, 0.008, 0.0006, 14), { position: [x, 0, -0.004], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  });
}

/** Glass-to-glass or glass-to-wall clamp for a fixed return panel. */
export function glassClamp(): THREE.BufferGeometry {
  return cached('gclamp', () => merged([
    transformed(filletBox(0.044, 0.044, 0.008, 0.0025, 2), { position: [0, 0, 0.004] }),
    transformed(filletBox(0.030, 0.038, 0.024, 0.0025, 2), { position: [0, 0, 0.020] }),
    transformed(screwHead(5), { position: [0, 0, 0.032], rotation: [Math.PI / 2, 0, 0] }),
  ]));
}

/** Wavy shower curtain: thin extruded band, x centred, y from 0 upward. */
export function curtainGeometry(width: number, height: number, thick = 0.008, waves = 7, amp = 0.028): THREE.BufferGeometry {
  const W = clampNum(width, 0.1, 4, 1), H = clampNum(height, 0.2, 3, 1.6);
  const n = 64;
  const shape = new THREE.Shape();
  const top: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const x = -W / 2 + (W * i) / n;
    top.push([x, amp * Math.sin((i / n) * waves * Math.PI * 2)]);
  }
  shape.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i <= n; i++) shape.lineTo(top[i][0], top[i][1]);
  for (let i = n; i >= 0; i--) shape.lineTo(top[i][0], top[i][1] + thick);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  applyWorldUVs(g);
  return g;
}

// ---------------------------------------------------------------------------
// Shower structure
// ---------------------------------------------------------------------------

/** Shower curb: sloped stone cap over a mortar bed, with a bullnose front. */
export function showerCurb(length: number, height: number, depth: number): THREE.BufferGeometry {
  const L = clampNum(length, 0.2, 4, 1), H = clampNum(height, 0.03, 0.3, 0.102), D = clampNum(depth, 0.05, 0.3, 0.127);
  return cached(`curb|${k(L)}|${k(H)}|${k(D)}`, () => merged([
    transformed(chamferBox(L, H - 0.020, D, 0.0015), { position: [0, (H - 0.020) / 2, 0] }),
    // the cap pitches ~2° back into the pan, which is code and reads correctly
    transformed(chamferBox(L, 0.020, D + 0.010, 0.0020), { position: [0, H - 0.010, 0], rotation: [0.035, 0, 0] }),
  ]));
}

/** Tiled niche: back, sides, head, sill and the stone shelf that splits it. */
export function nicheShell(w: number, h: number, depth: number, opts: { shelf?: boolean } = {}): { tile: THREE.BufferGeometry; shelf: THREE.BufferGeometry | null; trim: THREE.BufferGeometry } {
  const W = clampNum(w, 0.15, 1.6, 0.36), H = clampNum(h, 0.15, 1.4, 0.60), D = clampNum(depth, 0.04, 0.2, 0.09);
  const wantShelf = opts.shelf !== false && H > 0.32;
  const key = `niche|${k(W)}|${k(H)}|${k(D)}|${wantShelf ? 's' : 'n'}`;
  const tile = cached(key, () => {
    const t = 0.010;
    return merged([
      transformed(chamferBox(W, H, t, 0.0012), { position: [0, H / 2, -D + t / 2] }),
      transformed(chamferBox(t, H, D, 0.0012), { position: [-W / 2 + t / 2, H / 2, -D / 2] }),
      transformed(chamferBox(t, H, D, 0.0012), { position: [W / 2 - t / 2, H / 2, -D / 2] }),
      transformed(chamferBox(W, t, D, 0.0012), { position: [0, H - t / 2, -D / 2] }),
      // sill pitched forward so water leaves the niche
      transformed(chamferBox(W, t, D, 0.0012), { position: [0, t / 2, -D / 2], rotation: [-0.03, 0, 0] }),
    ]);
  });
  const shelf = wantShelf
    ? cached(`${key}|shelf`, () => transformed(chamferBox(W - 0.004, 0.018, D - 0.004, 0.0018), { position: [0, H * 0.5, -D / 2] }))
    : null;
  // schluter reveal all the way round the opening — how a real niche is finished
  const trim = cached(`${key}|trim`, () => merged([
    transformed(tileEdge(W, 0.010, 'schluter'), { position: [0, 0.004, 0], rotation: [0, 0, Math.PI] }),
    transformed(tileEdge(W, 0.010, 'schluter'), { position: [0, H - 0.004, 0] }),
    transformed(tileEdge(H, 0.010, 'schluter'), { position: [-W / 2 + 0.004, H / 2, 0], rotation: [0, 0, Math.PI / 2] }),
    transformed(tileEdge(H, 0.010, 'schluter'), { position: [W / 2 - 0.004, H / 2, 0], rotation: [0, 0, -Math.PI / 2] }),
  ]));
  return { tile, shelf, trim };
}

/** Floating shower bench: radiused front edge, tiled body, stone top. */
export function showerBench(w: number, d: number, h: number): { body: THREE.BufferGeometry; top: THREE.BufferGeometry } {
  const W = clampNum(w, 0.25, 2, 0.42), D = clampNum(d, 0.20, 0.8, 0.38), H = clampNum(h, 0.25, 0.7, 0.46);
  const key = `bench|${k(W)}|${k(D)}|${k(H)}`;
  return {
    body: cached(`${key}|b`, () => transformed(filletBox(W, H - 0.028, D, 0.012, 2), { position: [0, (H - 0.028) / 2, 0] })),
    top: cached(`${key}|t`, () => transformed(filletBox(W + 0.012, 0.028, D + 0.012, 0.008, 2), { position: [0, H - 0.014, 0] })),
  };
}

// ---------------------------------------------------------------------------
// Tubs
// ---------------------------------------------------------------------------

/** Overflow escutcheon + waste lever on a tub end wall. Faces +Z. */
export function tubOverflow(): THREE.BufferGeometry {
  return cached('overflow', () => merged([
    transformed(lathePoints([[0, 0], [0.030, 0], [0.029, 0.004], [0.019, 0.008], [0.014, 0.010], [0, 0.010]], 20), { rotation: [Math.PI / 2, 0, 0] }),
    transformed(chamferCylinder(0.011, 0.014, 0.0008, 12), { position: [0, 0, 0.014], rotation: [Math.PI / 2, 0, 0] }),
    transformed(chamferBox(0.010, 0.046, 0.010, 0.0012), { position: [0, -0.022, 0.017], rotation: [0.22, 0, 0] }),
  ]));
}

/** Clawfoot ball-and-claw foot, turned then splayed. */
export function clawFoot(height = 0.16): THREE.BufferGeometry {
  const H = clampNum(height, 0.06, 0.35, 0.16);
  return cached(`claw|${k(H)}`, () => merged([
    lathePoints([
      [0, 0], [0.052, 0.006], [0.056, 0.024], [0.046, 0.040], [0.030, 0.056],
      [0.022, H * 0.55], [0.026, H * 0.74], [0.038, H * 0.88], [0.046, H], [0, H],
    ], 20),
    // three toes at the base, which is the whole reason a clawfoot reads as one
    ...[0.4, Math.PI / 2, Math.PI - 0.4].map((a) =>
      transformed(lathePoints([[0, 0], [0.014, 0.002], [0.016, 0.010], [0.010, 0.018], [0, 0.020]], 10),
        { position: [Math.cos(a) * 0.040, 0.010, Math.sin(a) * 0.040], rotation: [0.5, -a, 0] })),
  ]));
}

/** Freestanding tub apron: a filleted skirt so the shell is not floating. */
/**
 * Height of a tiled alcove-tub surround in a room with ceiling `h`.
 *
 * The nominal 2.2 m is taller than a 7 ft (2.134 m) ceiling, so an unclamped
 * surround pushed tile through the ceiling of every low-ceiling bathroom. Tile
 * on a wall stops where the wall stops. Lives here rather than inside `Tub.tsx`
 * so `scripts/check-bathroom.ts` verifies the real function instead of a copy.
 */
export function alcoveSurroundHeight(h: number): number {
  const ceiling = typeof h === 'number' && Number.isFinite(h) ? h : 2.44;
  return Math.max(1.2, Math.min(2.2, ceiling - 0.006));
}

export function tubApron(len: number, depth: number, height: number): THREE.BufferGeometry {
  const L = clampNum(len, 0.8, 2.4, 1.52), D = clampNum(depth, 0.4, 1.2, 0.76), H = clampNum(height, 0.2, 0.8, 0.46);
  return cached(`apron|${k(L)}|${k(D)}|${k(H)}`, () => merged([
    transformed(filletBox(L, H, 0.030, 0.008, 2), { position: [0, H / 2, D - 0.015] }),
    transformed(chamferBox(L, 0.014, 0.040, 0.0025), { position: [0, H - 0.007, D - 0.020] }),
  ]));
}

// ---------------------------------------------------------------------------
// Toilets
// ---------------------------------------------------------------------------

/**
 * Toilet body per style. Origin at the floor, tank against z = 0, bowl toward
 * +Z. The bowl is a lathed oval shell with a rolled rim, the skirt is filleted,
 * and the tank has a real overhanging lid — so the silhouette reads as a
 * fixture rather than a stack of blocks.
 */
export function toiletBody(style: 'two-piece' | 'one-piece' | 'wall-hung' | 'smart'): THREE.BufferGeometry {
  return cached(`toilet|${style}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const bowlY = style === 'wall-hung' ? 0.335 : 0.375;
    const bowlZ = style === 'wall-hung' ? 0.34 : 0.335;
    // rim + inner bowl: outer wall flares, rim rolls over, bowl drops to a sump
    const bowlProfile: Array<[number, number]> = [
      [0, -0.20], [0.30, -0.20], [0.58, -0.15], [0.80, -0.06], [0.92, 0.02],
      [0.985, 0.055], [1.0, 0.070], [0.985, 0.082], [0.93, 0.086],
      [0.90, 0.060], [0.86, 0.020], [0.70, -0.070], [0.44, -0.140], [0.16, -0.180], [0, -0.190],
    ];
    parts.push(transformed(cupLathe(bowlProfile, 6, 34), { position: [0, bowlY, bowlZ], scale: [0.185, 1, 0.245] }));
    if (style === 'wall-hung') {
      parts.push(transformed(filletBox(0.360, 0.300, 0.480, 0.026, 2), { position: [0, 0.320, 0.240] }));
      parts.push(transformed(filletBox(0.330, 0.150, 0.120, 0.020, 2), { position: [0, 0.230, 0.130] }));
    } else {
      // skirt: a tapered, filleted pedestal — the trapway is hidden, as on a
      // modern skirted bowl, and it meets the floor on a real foot
      parts.push(transformed(filletBox(0.355, 0.360, 0.560, 0.045, 2), { position: [0, 0.190, 0.300] }));
      parts.push(transformed(lathePoints([[0, 0], [0.180, 0], [0.180, 0.330], [0.150, 0.360], [0, 0.360]], 26), { position: [0, 0.010, 0.560], scale: [1, 1, 1.02] }));
      parts.push(transformed(filletBox(0.375, 0.016, 0.580, 0.006, 2), { position: [0, 0.008, 0.300] }));
      const tankH = style === 'smart' ? 0.190 : style === 'two-piece' ? 0.380 : 0.300;
      const tankY = style === 'two-piece' ? 0.415 : 0.400;
      const tankD = style === 'two-piece' ? 0.195 : 0.180;
      parts.push(transformed(filletBox(0.455, tankH, tankD, 0.024, 2), { position: [0, tankY + tankH / 2, tankD / 2 + 0.010] }));
      // the lid overhangs the tank on every side — that shadow line is the tell
      parts.push(transformed(filletBox(0.475, 0.026, tankD + 0.022, 0.008, 2), { position: [0, tankY + tankH + 0.013, tankD / 2 + 0.010] }));
      if (style === 'two-piece') {
        // the china spud where tank meets bowl, plus the two tank bolts
        parts.push(transformed(chamferCylinder(0.036, 0.030, 0.002, 16), { position: [0, tankY - 0.014, 0.090] }));
      }
    }
    return merged(parts);
  });
}

/** Toilet seat and closed lid with real hinges and bumpers. */
export function toiletSeat(style: 'two-piece' | 'one-piece' | 'wall-hung' | 'smart'): { seat: THREE.BufferGeometry; hinges: THREE.BufferGeometry } {
  const key = `seat|${style}`;
  const y = style === 'wall-hung' ? 0.400 : 0.440;
  const z = style === 'wall-hung' ? 0.340 : 0.335;
  const seat = cached(key, () => {
    // ring: a lathed torus-ish section, then the lid as a filleted dome slice
    const ring: Array<[number, number]> = [
      [0.62, 0.006], [0.80, 0.000], [0.94, 0.004], [1.0, 0.012], [0.99, 0.020],
      [0.86, 0.024], [0.68, 0.022], [0.60, 0.016], [0.62, 0.006],
    ];
    const parts: THREE.BufferGeometry[] = [
      transformed(cupLathe(ring, 3, 32), { position: [0, y, z], scale: [0.198, 1, 0.258] }),
    ];
    const lid: Array<[number, number]> = [
      [0, 0.030], [0.40, 0.030], [0.74, 0.027], [0.94, 0.019], [1.0, 0.008],
      [0.99, 0.000], [0.80, -0.003], [0.42, -0.004], [0, -0.004],
    ];
    parts.push(transformed(cupLathe(lid, 4, 32), { position: [0, y + 0.024, z - 0.004], scale: [0.202, 1, 0.262] }));
    return merged(parts);
  });
  const hinges = cached(`${key}|h`, () => merged([
    ...[-1, 1].map((sx) => transformed(filletBox(0.044, 0.020, 0.062, 0.006, 2), { position: [sx * 0.070, y + 0.008, z - 0.245] })),
    ...[-1, 1].map((sx) => transformed(chamferCylinder(0.010, 0.030, 0.0008, 12), { position: [sx * 0.070, y + 0.014, z - 0.222], rotation: [0, 0, Math.PI / 2] })),
    ...[-1, 1].map((sx) => transformed(chamferCylinder(0.008, 0.005, 0.0006, 10), { position: [sx * 0.130, y - 0.006, z + 0.120] })),
  ]));
  return { seat, hinges };
}

/** Chrome trip lever on the tank face. */
export function tripLever(): THREE.BufferGeometry {
  return cached('trip', () => merged([
    transformed(lathePoints([[0, 0], [0.020, 0], [0.019, 0.004], [0.011, 0.008], [0, 0.008]], 16), { rotation: [Math.PI / 2, 0, 0] }),
    transformed(chamferCylinder(0.008, 0.014, 0.0006, 10), { position: [0, 0, 0.012], rotation: [Math.PI / 2, 0, 0] }),
    transformed(chamferBox(0.082, 0.011, 0.009, 0.0014), { position: [0.036, -0.006, 0.020], rotation: [0, 0, -0.14] }),
  ]));
}

/** Wall-hung flush plate with two real buttons and a chamfered frame. */
export function flushPlate(): THREE.BufferGeometry {
  return cached('flushplate', () => merged([
    transformed(filletBox(0.246, 0.164, 0.010, 0.004, 2), { position: [0, 0, 0.005] }),
    transformed(filletBox(0.086, 0.096, 0.006, 0.004, 2), { position: [-0.048, 0, 0.012] }),
    transformed(filletBox(0.058, 0.096, 0.006, 0.004, 2), { position: [0.048, 0, 0.012] }),
  ]));
}

/** Angle stop + braided supply riser feeding a tank or a wall-hung carrier. */
export function toiletSupply(): THREE.BufferGeometry {
  return cached('tsupply', () => {
    const parts: THREE.BufferGeometry[] = [
      transformed(lathePoints([[0, 0], [0.026, 0], [0.025, 0.005], [0.016, 0.009], [0, 0.009]], 16), { rotation: [Math.PI / 2, 0, 0] }),
      transformed(chamferCylinder(0.012, 0.052, 0.0008, 12), { position: [0, 0, 0.030], rotation: [Math.PI / 2, 0, 0] }),
      transformed(lathePoints([[0, 0], [0.021, 0], [0.021, 0.004], [0.007, 0.008], [0, 0.008]], 12), { position: [0, 0, 0.058], rotation: [Math.PI / 2, 0, 0] }),
    ];
    const ring: Vec2[] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2; ring.push([Math.cos(a) * 0.0062, Math.sin(a) * 0.0062]); }
    const path: Vec3[] = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; path.push([0, t * 0.185, 0.036 - Math.sin(t * Math.PI) * 0.030]); }
    parts.push(sweepProfile(ring, path, { up: [1, 0, 0], caps: false }));
    parts.push(transformed(chamferCylinder(0.011, 0.026, 0.0006, 12), { position: [0, 0.196, 0.036] }));
    return merged(parts);
  });
}

// ---------------------------------------------------------------------------
// Accessories + styling
// ---------------------------------------------------------------------------

/** Towel ring: rose, post and a real oval ring. */
export function towelRing(): THREE.BufferGeometry {
  return cached('towelring', () => {
    const ring: Vec2[] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2; ring.push([Math.cos(a) * 0.0065, Math.sin(a) * 0.0065]); }
    const path: Vec3[] = [];
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      path.push([Math.sin(a) * 0.082, -0.078 + Math.cos(a) * 0.078, 0.058]);
    }
    return merged([
      transformed(lathePoints([[0, 0], [0.026, 0], [0.025, 0.005], [0.015, 0.011], [0, 0.012]], 18), { rotation: [-Math.PI / 2, 0, 0] }),
      transformed(chamferCylinder(0.009, 0.044, 0.0006, 12), { position: [0, 0, 0.028], rotation: [Math.PI / 2, 0, 0] }),
      sweepProfile(ring, path, { up: [0, 0, 1], closed: true, caps: false }),
    ]);
  });
}

/** Robe hook with a back plate and its screw. */
export function robeHook(): THREE.BufferGeometry {
  return cached('hook', () => merged([
    transformed(lathePoints([[0, 0], [0.022, 0], [0.021, 0.005], [0.013, 0.010], [0, 0.011]], 18), { rotation: [-Math.PI / 2, 0, 0] }),
    transformed(chamferCylinder(0.008, 0.030, 0.0006, 12), { position: [0, 0, 0.019], rotation: [Math.PI / 2, 0, 0] }),
    transformed(chamferCylinder(0.008, 0.038, 0.0006, 12), { position: [0, -0.017, 0.032], rotation: [0.5, 0, 0] }),
    transformed(lathePoints([[0, 0], [0.013, 0], [0.014, 0.006], [0.010, 0.012], [0, 0.013]], 14), { position: [0, -0.033, 0.040] }),
  ]));
}

/** Paper holder: rose, post, arm and the end stop that keeps the roll on. */
export function paperHolder(): THREE.BufferGeometry {
  return cached('tp', () => merged([
    transformed(lathePoints([[0, 0], [0.026, 0], [0.025, 0.005], [0.015, 0.011], [0, 0.012]], 18), { rotation: [-Math.PI / 2, 0, 0] }),
    transformed(chamferCylinder(0.009, 0.055, 0.0006, 12), { position: [0, 0, 0.034], rotation: [Math.PI / 2, 0, 0] }),
    transformed(chamferCylinder(0.009, 0.165, 0.0006, 12), { position: [0.082, 0, 0.062], rotation: [0, 0, Math.PI / 2] }),
    transformed(lathePoints([[0, 0], [0.016, 0], [0.015, 0.005], [0, 0.006]], 12), { position: [0.165, 0, 0.062], rotation: [0, 0, -Math.PI / 2] }),
  ]));
}

/** Part-used paper roll with a soft edge and a visible core. */
export function paperRoll(): THREE.BufferGeometry {
  return cached('roll', () => merged([
    transformed(lathePoints([
      [0.021, 0], [0.052, 0], [0.055, 0.006], [0.055, 0.094], [0.052, 0.100], [0.021, 0.100], [0.021, 0],
    ], 26), { position: [0.082, -0.050, 0.062], rotation: [0, 0, Math.PI / 2] }),
  ]));
}

/**
 * A folded towel — three stacked plies with rounded ends and a visible fold,
 * which is what a towel actually looks like on a bar or a counter.
 */
export function foldedTowel(w: number, d: number, plies = 3): THREE.BufferGeometry {
  const W = clampNum(w, 0.10, 0.9, 0.32), D = clampNum(d, 0.06, 0.6, 0.22);
  const n = Math.round(clampNum(plies, 1, 6, 3));
  return cached(`towel|${k(W)}|${k(D)}|${n}`, () => {
    const t = 0.016;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const s = 1 - i * 0.03;
      parts.push(transformed(filletBox(W * s, t, D * s, 0.007, 2), { position: [0, t / 2 + i * (t + 0.002), (D * (1 - s)) / 2], rotation: [0, (i % 2 ? 1 : -1) * 0.012, 0] }));
    }
    return merged(parts);
  });
}

/** A towel hanging over a bar: two faces joined by a rolled fold at the top. */
export function hangingTowel(w: number, drop: number): THREE.BufferGeometry {
  const W = clampNum(w, 0.10, 0.9, 0.34), H = clampNum(drop, 0.10, 1.2, 0.50);
  return cached(`hang|${k(W)}|${k(H)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const t = 0.012;
    for (const [sz, len] of [[-1, H], [1, H * 0.86]] as Array<[number, number]>) {
      // a gentle sway so the two faces are not mirror-identical planks
      parts.push(transformed(filletBox(W, len, t, 0.005, 2), { position: [0, -len / 2 - 0.012, sz * 0.017], rotation: [0, 0, sz * 0.010] }));
    }
    parts.push(transformed(lathePoints([[0, 0], [0.019, 0], [0.021, 0.008], [0.019, 0.016], [0, 0.018]], 12), { position: [0, 0, 0], rotation: [0, 0, Math.PI / 2], scale: [1, W / 0.038, 1] }));
    return merged(parts);
  });
}

/** Rolled towel for a basket or a shelf. Axis along X. */
export function rolledTowel(length = 0.26, d = 0.11): THREE.BufferGeometry {
  const L = clampNum(length, 0.10, 0.6, 0.26), D = clampNum(d, 0.05, 0.25, 0.11);
  return cached(`rolled|${k(L)}|${k(D)}`, () => merged([
    transformed(lathePoints([
      [0, 0], [D / 2 - 0.004, 0], [D / 2, 0.006], [D / 2, L - 0.006], [D / 2 - 0.004, L], [0, L],
    ], 20), { position: [-L / 2, 0, 0], rotation: [0, 0, -Math.PI / 2] }),
    // the loose tail of the roll
    transformed(filletBox(L * 0.94, 0.010, D * 0.5, 0.004, 2), { position: [0, -D * 0.20, D * 0.28], rotation: [0.5, 0, 0] }),
  ]));
}

/** Woven storage basket: a tapered body with a rolled rim and two handles. */
export function basket(d = 0.30, h = 0.30): THREE.BufferGeometry {
  const D = clampNum(d, 0.15, 0.7, 0.30), H = clampNum(h, 0.10, 0.7, 0.30);
  return cached(`basket|${k(D)}|${k(H)}`, () => {
    const { profile, outerIndex } = cupProfile({ height: H, wall: 0.035, floor: 0.012, rim: 0.014, baseInset: 0.16, baseRise: 0.010 });
    return transformed(cupLathe(profile, outerIndex, 30), { scale: [D / 2, 1, D / 2] });
  });
}

/** Bath mat: a soft slab with a rolled edge and a slight ripple. */
export function bathMat(w = 0.86, d = 0.56): THREE.BufferGeometry {
  const W = clampNum(w, 0.3, 2, 0.86), D = clampNum(d, 0.2, 1.4, 0.56);
  return cached(`mat|${k(W)}|${k(D)}`, () => merged([
    transformed(filletBox(W, 0.016, D, 0.008, 2), { position: [0, 0.008, 0] }),
    transformed(filletBox(W - 0.05, 0.006, D - 0.05, 0.003, 2), { position: [0.004, 0.019, -0.006], rotation: [0, 0.010, 0] }),
  ]));
}

/** Pump soap dispenser: bottle, shoulder, collar, pump stem and spout. */
export function soapDispenser(): THREE.BufferGeometry {
  return cached('soap', () => merged([
    lathePoints([
      [0, 0], [0.031, 0], [0.033, 0.008], [0.033, 0.108], [0.030, 0.122],
      [0.019, 0.136], [0.016, 0.146], [0, 0.146],
    ], 22),
    transformed(chamferCylinder(0.014, 0.020, 0.0008, 16), { position: [0, 0.156, 0] }),
    transformed(chamferCylinder(0.006, 0.030, 0.0005, 10), { position: [0, 0.180, 0] }),
    transformed(chamferBox(0.030, 0.014, 0.014, 0.0022), { position: [0.011, 0.196, 0] }),
    transformed(chamferCylinder(0.005, 0.012, 0.0005, 10), { position: [0.024, 0.188, 0] }),
  ]));
}

/** Tumbler / toothbrush cup. */
export function tumbler(): THREE.BufferGeometry {
  return cached('tumbler', () => {
    const { profile, outerIndex } = cupProfile({ height: 0.105, wall: 0.10, floor: 0.010, rim: 0.006, baseInset: 0.10, baseRise: 0.004 });
    return transformed(cupLathe(profile, outerIndex, 26), { scale: [0.036, 1, 0.036] });
  });
}

/** Snake-plant foliage cluster, origin at soil level. */
export function foliage(): THREE.BufferGeometry {
  return cached('foliage', () => {
    const parts: THREE.BufferGeometry[] = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (i % 2) * 0.3;
      const hgt = 0.32 + (i % 3) * 0.09;
      const leaf = new THREE.SphereGeometry(1, 10, 8);
      leaf.scale(0.035, hgt / 2, 0.012);
      leaf.translate(0, hgt / 2, 0);
      leaf.rotateZ(0.28 * ((i % 2) ? 1 : -1) * 0.6);
      leaf.rotateY(ang);
      leaf.translate(Math.cos(ang) * 0.035, 0, Math.sin(ang) * 0.035);
      parts.push(leaf);
    }
    const g = mergeGeometries(parts);
    applyWorldUVs(g);
    return g;
  });
}

/** Tapered plant pot with a rolled rim and a foot. */
export function plantPot(d = 0.28, h = 0.30): THREE.BufferGeometry {
  const D = clampNum(d, 0.1, 0.8, 0.28), H = clampNum(h, 0.08, 0.8, 0.30);
  return cached(`pot|${k(D)}|${k(H)}`, () => {
    const { profile, outerIndex } = cupProfile({ height: H, wall: 0.06, floor: 0.03, rim: 0.014, baseInset: 0.22, baseRise: 0.014 });
    return transformed(cupLathe(profile, outerIndex, 28), { scale: [D / 2, 1, D / 2] });
  });
}

// ---------------------------------------------------------------------------
// Décor — shelves, plants by form, framed art, rugs, window treatments
// ---------------------------------------------------------------------------

/** A broad leaf: a flattened ellipsoid with its base at the origin, growing up +Y. */
function leafBlade(w: number, l: number, t: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 8, 6);
  g.scale(w / 2, l / 2, t / 2);
  g.translate(0, l / 2, 0);
  return g;
}

/**
 * Floating-shelf boards, stacked. Origin on the wall at the lowest board's
 * underside, x centred, z into the room. One geometry for the whole stack.
 */
export function shelfBoards(w: number, depth: number, count: number, spacing: number, thick = 0.032): THREE.BufferGeometry {
  const W = clampNum(w, 0.15, 3, 0.6), D = clampNum(depth, 0.08, 0.5, 0.2), T = clampNum(thick, 0.012, 0.06, 0.032);
  const n = Math.round(clampNum(count, 1, 6, 1)), S = clampNum(spacing, 0.15, 0.8, 0.3);
  return cached(`shelf|${k(W)}|${k(D)}|${n}|${k(S)}|${k(T)}`, () => merged(
    Array.from({ length: n }, (_, i) => transformed(chamferBox(W, T, D, 0.002), { position: [0, i * S + T / 2, D / 2] })),
  ));
}

/** Open display case. The existing lowest board is its base; only the
 * observed sides, cap and optional back are added, without doors or props. */
export function shelfCase(w: number, depth: number, count: number, spacing: number, thick: number, height: number, backPanel: boolean): THREE.BufferGeometry {
  const W = clampNum(w, 0.15, 3.1, 0.6), D = clampNum(depth, 0.08, 0.5, 0.2), T = clampNum(thick, 0.006, 0.06, 0.01905);
  const H = clampNum(height, T * 2 + 0.00635, 3.1, 1.5), S = clampNum(spacing, 0.15, 0.8, 0.3);
  const n = Math.max(1, Math.min(Math.round(clampNum(count, 1, 6, 1)), Math.floor((H - T * 2) / S) + 1));
  const innerW = W - T * 2, rear = backPanel ? T : 0, innerD = D - rear;
  return cached(`shelfcase|${k(W)}|${k(D)}|${n}|${k(S)}|${k(T)}|${k(H)}|${backPanel}`, () => merged([
    ...Array.from({ length: n }, (_, i) => transformed(chamferBox(innerW, T, innerD, 0.002), { position: [0, i * S + T / 2, rear + innerD / 2] })),
    ...[-1, 1].map((sign) => transformed(chamferBox(T, H, D, 0.002), { position: [sign * (W - T) / 2, H / 2, D / 2] })),
    transformed(chamferBox(innerW, T, innerD, 0.002), { position: [0, H - T / 2, rear + innerD / 2] }),
    ...(backPanel ? [transformed(chamferBox(innerW, H, rear, 0.002), { position: [0, H / 2, rear / 2] })] : []),
  ]));
}

/** Two exposed L-brackets under every board of a stack (the black-steel shelf look). */
export function shelfBrackets(w: number, depth: number, count: number, spacing: number): THREE.BufferGeometry {
  const W = clampNum(w, 0.15, 3, 0.6), D = clampNum(depth, 0.08, 0.5, 0.2);
  const n = Math.round(clampNum(count, 1, 6, 1)), S = clampNum(spacing, 0.15, 0.8, 0.3);
  return cached(`shbr|${k(W)}|${k(D)}|${n}|${k(S)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const inset = Math.min(0.08, W * 0.18);
    for (let i = 0; i < n; i++) for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - inset);
      parts.push(transformed(chamferBox(0.028, 0.10, 0.006, 0.0008), { position: [x, i * S - 0.05, 0.003] }));
      parts.push(transformed(chamferBox(0.028, 0.006, D - 0.03, 0.0008), { position: [x, i * S - 0.003, (D - 0.03) / 2] }));
    }
    return merged(parts);
  });
}

/** Lidded apothecary jar: a glass body and a turned lid, both with the base at y = 0. */
export function jar(d = 0.09, h = 0.14): { body: THREE.BufferGeometry; lid: THREE.BufferGeometry } {
  const D = clampNum(d, 0.04, 0.3, 0.09), H = clampNum(h, 0.05, 0.4, 0.14);
  const body = cached(`jar|${k(D)}|${k(H)}`, () => {
    const { profile, outerIndex } = cupProfile({ height: H, wall: 0.06, floor: 0.02, rim: 0.008, baseInset: 0.05, baseRise: 0.004 });
    return transformed(cupLathe(profile, outerIndex, 24), { scale: [D / 2, 1, D / 2] });
  });
  const lid = cached(`jarlid|${k(D)}|${k(H)}`, () => merged([
    transformed(chamferCylinder(D / 2 * 0.98, 0.012, 0.002, 24), { position: [0, H + 0.006, 0] }),
    transformed(chamferCylinder(D * 0.12, 0.016, 0.002, 14), { position: [0, H + 0.020, 0] }),
  ]));
  return { body, lid };
}

/** Pillar candle with a wick, base at y = 0. */
export function candle(d = 0.07, h = 0.09): THREE.BufferGeometry {
  const D = clampNum(d, 0.02, 0.2, 0.07), H = clampNum(h, 0.03, 0.4, 0.09);
  return cached(`candle|${k(D)}|${k(H)}`, () => merged([
    transformed(chamferCylinder(D / 2, H, 0.003, 22), { position: [0, H / 2, 0] }),
    transformed(chamferCylinder(0.0015, 0.012, 0.0003, 6), { position: [0, H + 0.005, 0] }),
  ]));
}

/** A stack of books, spines out (+z), each slightly fanned. Base at y = 0. */
export function bookStack(n = 3, w = 0.16, d = 0.12): THREE.BufferGeometry {
  const N = Math.round(clampNum(n, 1, 8, 3)), W = clampNum(w, 0.06, 0.4, 0.16), D = clampNum(d, 0.05, 0.35, 0.12);
  return cached(`books|${N}|${k(W)}|${k(D)}`, () => merged(
    Array.from({ length: N }, (_, i) => {
      const s = 1 - (i % 3) * 0.06;
      return transformed(chamferBox(W * s, 0.022, D * s, 0.0012), { position: [(i % 2) * 0.008, 0.011 + i * 0.023, 0], rotation: [0, (i % 2 ? 1 : -1) * 0.06, 0] });
    }),
  ));
}

export type ShelfItem = 'jar' | 'candle' | 'books' | 'towels' | 'plant' | 'tumbler';
/**
 * What sits on a styled shelf: one to three items per board, chosen from the
 * menu the spec's `styled` names and rotated board by board so two boards
 * never carry the same line-up. Pure, so the budget check can count it.
 */
export function shelfStyling(width: number, count: number, styled: 'empty' | 'dishes' | 'books' | 'plants' | 'mixed', seed = 0): Array<{ item: ShelfItem; board: number; x: number }> {
  const W = clampNum(width, 0.1, 4, 0.6), n = Math.round(clampNum(count, 1, 6, 1));
  const slots = W < 0.45 ? 1 : W < 0.8 ? 2 : 3;
  const xs = slots === 1 ? [0] : slots === 2 ? [-W * 0.24, W * 0.26] : [-W * 0.32, 0.02, W * 0.34];
  const menu: Record<string, ShelfItem[]> = {
    empty: [],
    dishes: ['jar', 'tumbler', 'candle', 'jar'],
    books: ['books', 'candle', 'books', 'jar'],
    plants: ['plant', 'plant', 'candle', 'plant'],
    mixed: ['towels', 'jar', 'plant', 'candle', 'books'],
  };
  const list = menu[styled] ?? [];
  const out: Array<{ item: ShelfItem; board: number; x: number }> = [];
  if (!list.length) return out;
  const s = Math.round(clampNum(seed, 0, 1000, 0));
  for (let b = 0; b < n; b++) for (let j = 0; j < slots; j++) out.push({ item: list[(b * slots + j + s) % list.length], board: b, x: xs[j] });
  return out;
}

/** Rug: a bound-edge pile slab (or disc), flat on the floor at the origin. Long axis along X. */
export function rugSlab(length: number, width: number, round = false): THREE.BufferGeometry {
  const L = clampNum(length, 0.3, 6, 1.5), W = clampNum(width, 0.3, 6, 0.9);
  return cached(`rug|${k(L)}|${k(W)}|${round ? 'r' : 's'}`, () => (round
    ? merged([
      transformed(chamferCylinder(L / 2, 0.012, 0.003, 48), { position: [0, 0.006, 0] }),
      transformed(chamferCylinder(L / 2 - 0.03, 0.006, 0.002, 48), { position: [0, 0.015, 0] }),
    ])
    : merged([
      transformed(filletBox(L, 0.012, W, 0.006, 2), { position: [0, 0.006, 0] }),
      // the pile sits inside the binding, and is never quite square to it
      transformed(filletBox(L - 0.05, 0.006, W - 0.05, 0.003, 2), { position: [0.003, 0.015, -0.004], rotation: [0, 0.006, 0] }),
    ])));
}

/** Picture frame: four members around a w × h picture, origin at the picture centre on the wall, +z out. */
export function pictureFrame(w: number, h: number, frameW = 0.03, depth = 0.03): THREE.BufferGeometry {
  const W = clampNum(w, 0.1, 2.5, 0.5), H = clampNum(h, 0.1, 2.5, 0.6);
  const F = Math.min(clampNum(frameW, 0.008, 0.12, 0.03), W / 4, H / 4), D = clampNum(depth, 0.01, 0.08, 0.03);
  return cached(`frame|${k(W)}|${k(H)}|${k(F)}|${k(D)}`, () => merged([
    transformed(chamferBox(W, F, D, 0.0015), { position: [0, H / 2 - F / 2, D / 2] }),
    transformed(chamferBox(W, F, D, 0.0015), { position: [0, -H / 2 + F / 2, D / 2] }),
    transformed(chamferBox(F, H - 2 * F, D, 0.0015), { position: [W / 2 - F / 2, 0, D / 2] }),
    transformed(chamferBox(F, H - 2 * F, D, 0.0015), { position: [-W / 2 + F / 2, 0, D / 2] }),
  ]));
}

/** Gallery-wrapped canvas: a soft-edged slab standing off the wall, no frame. */
export function wrappedCanvas(w: number, h: number, depth = 0.035): THREE.BufferGeometry {
  const W = clampNum(w, 0.1, 2.5, 0.5), H = clampNum(h, 0.1, 2.5, 0.6), D = clampNum(depth, 0.01, 0.08, 0.035);
  return cached(`canvas|${k(W)}|${k(H)}|${k(D)}`, () => transformed(filletBox(W, H, D, 0.004, 2), { position: [0, 0, D / 2] }));
}

/**
 * Foliage by form, origin at the soil surface, y up. `size` is the overall
 * height in metres — a 1.8 m fiddle-leaf fig, a 0.25 m herb — and everything
 * scales from it so a plant in a photo comes out the size it was.
 *
 *   leafy      broad leaves on leaning stems (monstera / bird of paradise)
 *   tree       a trunk with a canopy of clusters and big leaves
 *   trailing   a tuft on top and strands that hang down `drop` (pothos)
 *   herb       a dense low cluster of narrow leaves
 *   succulent  a rosette of thick short leaves
 */
/**
 * How far the canopy of `plantFoliage` reaches out from the pot's axis, as a
 * fraction of the foliage size passed in. Measured off the built geometry, so
 * it has to move whenever the recipes below do.
 *
 * The layout only ever clears the POT's footprint — widening the search to the
 * canopy would make every plant's position a function of every fixture rect,
 * and the placement sweeps would never settle. So the layout uses this to
 * shrink a plant that would otherwise lean over the thing it stands beside.
 */
const CANOPY_REACH: Record<'leafy' | 'tree' | 'trailing' | 'herb' | 'succulent', number> = {
  leafy: 0.40, tree: 0.39, trailing: 0.18, herb: 0.37, succulent: 0.62,
};

/** Radius the drawn canopy of a `size`-tall foliage of `form` will occupy. */
export function plantCanopyRadius(form: 'leafy' | 'tree' | 'trailing' | 'herb' | 'succulent', size: number): number {
  return CANOPY_REACH[form] * Math.max(0, size);
}

export function plantFoliage(form: 'leafy' | 'tree' | 'trailing' | 'herb' | 'succulent', size: number, opts: { potD?: number; drop?: number } = {}): { foliage: THREE.BufferGeometry; trunk: THREE.BufferGeometry | null } {
  const S = clampNum(size, 0.08, 3.5, 1);
  const potD = clampNum(opts.potD ?? S * 0.2, 0.04, 0.6, 0.2);
  const drop = clampNum(opts.drop ?? S, 0.05, 2.5, S);
  const key = `${form}|${k(S)}|${k(potD)}|${k(drop)}`;
  const foliage = cached(`plant|${key}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    switch (form) {
      case 'leafy': {
        const n = 9;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + (i % 2) * 0.35;
          // A potted rubber plant is a VASE, not a pancake: it used to lean the
          // stems 0.5–0.82 rad and hang a 0.34 S blade off the end of each, so
          // the canopy spread 0.84 of the plant's height — wider than it was
          // tall — and the leaves leaned across whatever the pot stood beside.
          const lean = 0.14 + (i % 3) * 0.07;
          const sL = S * (0.58 + (i % 3) * 0.078);
          /*
           * `.clone()` IS THE FIX, not a tidy-up. `chamferCylinder` hands back
           * the SHARED cached geometry, and three of these nine stems ask for
           * the same radius and length — so translating and rotating it in
           * place applied to the same buffer three times over. The compounded
           * lift is what floated the whole canopy 0.23 m above its own pot,
           * leaning off to one side, in every bathroom with a leafy plant.
           * 6 mm was also too thin to read at room scale; 16 mm shows.
           */
          const stem = chamferCylinder(0.006 + S * 0.005, sL, 0.0005, 6).clone();
          stem.translate(0, sL / 2, 0); stem.rotateZ(-lean); stem.rotateY(ang);
          parts.push(stem);
          const blade = leafBlade(S * 0.185, S * 0.33, 0.012);
          blade.rotateZ(-(lean + 0.26));
          blade.translate(Math.sin(lean) * sL, Math.cos(lean) * sL, 0);
          blade.rotateY(ang);
          parts.push(blade);
        }
        break;
      }
      case 'tree': {
        const th = S * 0.6, cr = S * 0.17;
        const clusters: Array<[number, number, number]> = [[0, th + cr * 0.9, 0], [cr * 0.9, th + cr * 0.5, cr * 0.3], [-cr * 0.8, th + cr * 0.6, -cr * 0.4], [cr * 0.2, th + cr * 1.5, -cr * 0.7], [-cr * 0.3, th + cr * 1.4, cr * 0.8]];
        clusters.forEach(([x, y, z], i) => {
          const c = new THREE.SphereGeometry(1, 10, 8);
          c.scale(cr, cr * 0.72, cr);
          c.translate(x, y, z);
          parts.push(c);
          // big leaves standing off each cluster
          for (let j = 0; j < 3; j++) {
            const ang = ((i * 3 + j) / 15) * Math.PI * 2;
            const blade = leafBlade(S * 0.09, S * 0.15, 0.010);
            blade.rotateZ(-1.15); blade.rotateY(ang);
            blade.translate(x + Math.cos(ang) * cr * 0.7, y - cr * 0.1, z - Math.sin(ang) * cr * 0.7);
            parts.push(blade);
          }
        });
        break;
      }
      case 'trailing': {
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          const blade = leafBlade(0.045, 0.07, 0.008);
          blade.rotateZ(-0.9); blade.rotateY(ang);
          blade.translate(Math.cos(ang) * potD * 0.2, 0.01, -Math.sin(ang) * potD * 0.2);
          parts.push(blade);
        }
        const strands = 7, segs = 8;
        for (let i = 0; i < strands; i++) {
          const ang = (i / strands) * Math.PI * 2 + 0.2;
          const len = drop * (0.55 + ((i * 7) % 5) * 0.11);
          const r = potD / 2 + 0.015;
          let prev: [number, number, number] = [Math.cos(ang) * r * 0.7, 0.03, -Math.sin(ang) * r * 0.7];
          for (let j = 1; j <= segs; j++) {
            const u = j / segs;
            const sway = Math.sin(u * Math.PI * 1.5 + i) * 0.03;
            const p: [number, number, number] = [Math.cos(ang) * (r + sway), 0.03 - len * u, -Math.sin(ang) * (r + sway)];
            const dx = p[0] - prev[0], dy = p[1] - prev[1], dz = p[2] - prev[2];
            const L = Math.hypot(dx, dy, dz);
            // cloned for the same reason as `leafy` above: `k()` quantises the
            // cache key to 4 dp, so two strand segments collide constantly
            const stem = chamferCylinder(0.002, L, 0.0002, 5).clone();
            stem.translate(0, L / 2, 0);
            // aim +Y at the next sample
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
            stem.applyQuaternion(q);
            stem.translate(prev[0], prev[1], prev[2]);
            parts.push(stem);
            const blade = leafBlade(0.04, 0.05, 0.006);
            blade.rotateZ(j % 2 ? 1.3 : -1.3); blade.rotateX(0.4 * ((i + j) % 3 - 1)); blade.rotateY(ang + (j % 2) * 0.6);
            blade.translate(p[0], p[1], p[2]);
            parts.push(blade);
            prev = p;
          }
        }
        break;
      }
      case 'herb': {
        const n = 14;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + (i % 3) * 0.2;
          const l = S * (0.64 + (i % 4) * 0.09);
          const blade = leafBlade(S * 0.11, l, 0.005);
          // same reason as `leafy`: a fanned 0.65 rad splay put the outer
          // blades 0.6 S from the pot, which is a bush, not a herb pot
          blade.rotateZ(-(0.18 + (i % 3) * 0.13)); blade.rotateY(ang);
          blade.translate(Math.cos(ang) * potD * 0.15, 0, -Math.sin(ang) * potD * 0.15);
          parts.push(blade);
        }
        break;
      }
      default: {
        const rings: Array<[number, number, number]> = [[8, 1.05, 0.45], [6, 0.65, 0.3], [4, 0.3, 0.15]];
        rings.forEach(([n, tilt, off], ri) => {
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + ri * 0.4;
            const blade = leafBlade(S * 0.22, S * (0.55 - ri * 0.1), S * 0.10);
            blade.rotateZ(-tilt); blade.rotateY(ang);
            blade.translate(Math.cos(ang) * S * off * 0.3, 0, -Math.sin(ang) * S * off * 0.3);
            parts.push(blade);
          }
        });
        const bud = new THREE.SphereGeometry(S * 0.08, 8, 6);
        bud.translate(0, S * 0.1, 0);
        parts.push(bud);
      }
    }
    const g = mergeGeometries(parts);
    applyWorldUVs(g);
    return g;
  });
  const trunk = form === 'tree'
    ? cached(`trunk|${key}`, () => {
      const th = S * 0.6, r0 = 0.010 + S * 0.014;
      return merged([
        lathePoints([[0, 0], [r0 * 1.2, 0], [r0, th * 0.08], [r0 * 0.8, th * 0.6], [r0 * 0.55, th], [0, th]], 10),
        transformed(chamferCylinder(r0 * 0.4, S * 0.16, 0.0005, 7), { position: [S * 0.05, th - 0.02, S * 0.02], rotation: [0.4, 0, -0.5] }),
        transformed(chamferCylinder(r0 * 0.4, S * 0.14, 0.0005, 7), { position: [-S * 0.05, th - 0.05, -S * 0.02], rotation: [-0.3, 0, 0.55] }),
      ]);
    })
    : null;
  return { foliage, trunk };
}

/** Macramé-style hanger: three cords from the pot rim to a ring on a ceiling hook. Rim at y = 0, ring at y = `cordLen`. */
export function hangingCords(potD: number, cordLen: number): THREE.BufferGeometry {
  const D = clampNum(potD, 0.06, 0.6, 0.2), L = clampNum(cordLen, 0.1, 3, 0.6);
  return cached(`cords|${k(D)}|${k(L)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const r = D / 2 - 0.01;
    const len = Math.hypot(r, L), tilt = Math.atan2(r, L);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      // lean the cord so its top meets the ring on the axis, then swing its foot round the rim
      // all three cords are the same length, so they are the same CACHED
      // geometry — transforming it in place walked the second and third one
      // out of the room. Clone before touching it.
      const c = chamferCylinder(0.0025, len, 0.0003, 6).clone();
      c.translate(0, len / 2, 0); c.rotateZ(tilt); c.translate(r, 0, 0); c.rotateY(ang);
      parts.push(c);
    }
    parts.push(transformed(new THREE.TorusGeometry(0.018, 0.003, 6, 16), { position: [0, L + 0.012, 0], rotation: [Math.PI / 2, 0, 0] }));
    parts.push(transformed(chamferCylinder(0.004, 0.03, 0.0005, 8), { position: [0, L + 0.04, 0] }));
    return merged(parts);
  });
}

/**
 * Window treatments. All are built with the origin at the HEAD of the window
 * (the top of the casing), x centred on the window, hanging down −y, standing
 * off the wall +z.
 */

/** Roman shade: a flat panel with the stacked folds of a half-raised shade at its foot, and a headrail. */
export function romanShade(width: number, drop: number, folds = 3): { fabric: THREE.BufferGeometry; rail: THREE.BufferGeometry } {
  const W = clampNum(width, 0.3, 4, 1), Dp = clampNum(drop, 0.2, 3, 0.5), n = Math.round(clampNum(folds, 1, 6, 3));
  const foldH = 0.055;
  const fabric = cached(`roman|${k(W)}|${k(Dp)}|${n}`, () => {
    const flat = Math.max(0.05, Dp - n * foldH);
    const parts = [transformed(chamferBox(W, flat, 0.008, 0.002), { position: [0, -flat / 2, 0.030] })];
    for (let i = 0; i < n; i++) {
      parts.push(transformed(filletBox(W, foldH, 0.034, 0.012, 2), { position: [0, -flat - foldH * i - foldH / 2, 0.030 + 0.012 + (i % 2) * 0.004] }));
    }
    return merged(parts);
  });
  const rail = cached(`romanrail|${k(W)}`, () => transformed(chamferBox(W + 0.03, 0.028, 0.040, 0.002), { position: [0, 0.014, 0.020] }));
  return { fabric, rail };
}

/** Roller shade: tube, a sheet part-way down and a hem bar. */
export function rollerShade(width: number, drop: number): { fabric: THREE.BufferGeometry; hardware: THREE.BufferGeometry } {
  const W = clampNum(width, 0.3, 4, 1), Dp = clampNum(drop, 0.1, 3, 0.4);
  const fabric = cached(`roller|${k(W)}|${k(Dp)}`, () => merged([
    transformed(chamferBox(W, Dp, 0.0015, 0.0003), { position: [0, -0.02 - Dp / 2, 0.047] }),
    transformed(chamferCylinder(0.021, W, 0.002, 18), { position: [0, -0.02, 0.026], rotation: [0, 0, Math.PI / 2] }),
  ]));
  const hardware = cached(`rollerhw|${k(W)}|${k(Dp)}`, () => merged([
    transformed(chamferBox(W + 0.002, 0.012, 0.010, 0.001), { position: [0, -0.02 - Dp - 0.006, 0.047] }),
    ...[-1, 1].map((sx) => transformed(chamferBox(0.018, 0.052, 0.034, 0.001), { position: [sx * (W / 2 + 0.010), -0.02, 0.017] })),
    transformed(chamferCylinder(0.0015, Dp * 0.6, 0.0002, 6), { position: [W / 2 - 0.03, -0.02 - Dp * 0.3, 0.052] }),
  ]));
  return { fabric, hardware };
}

/** Curtain rod with finials and brackets, along x at the origin. */
export function curtainRod(length: number): THREE.BufferGeometry {
  const L = clampNum(length, 0.3, 5, 1.5);
  return cached(`rod|${k(L)}`, () => merged([
    transformed(chamferCylinder(0.011, L, 0.001, 12), { rotation: [0, 0, Math.PI / 2] }),
    ...[-1, 1].map((sx) => transformed(chamferCylinder(0.020, 0.032, 0.004, 12), { position: [sx * (L / 2 + 0.014), 0, 0], rotation: [0, 0, Math.PI / 2] })),
    ...[-1, 1].map((sx) => transformed(chamferBox(0.018, 0.024, 0.070, 0.001), { position: [sx * (L / 2 - 0.10), -0.006, -0.035] })),
  ]));
}

/** Venetian blind: the rails and ladder cords as one geometry, and a slat to instance down the window. */
export function blinds(width: number, drop: number, opts: { max?: number } = {}): { rail: THREE.BufferGeometry; slat: THREE.BufferGeometry; transforms: InstanceTransform[] } {
  const W = clampNum(width, 0.3, 4, 1), Dp = clampNum(drop, 0.1, 3, 0.6);
  const pitch = 0.022;
  const n = Math.min(Math.round(clampNum(opts.max ?? 60, 0, 200, 60)), Math.max(1, Math.floor((Dp - 0.06) / pitch)));
  const rail = cached(`blindrail|${k(W)}|${k(Dp)}|${n}`, () => merged([
    transformed(chamferBox(W, 0.045, 0.045, 0.002), { position: [0, -0.0225, 0.0225] }),
    transformed(chamferBox(W - 0.02, 0.012, 0.028, 0.001), { position: [0, -0.045 - n * pitch - 0.006, 0.030] }),
    ...[-1, 1].map((sx) => transformed(chamferCylinder(0.0012, n * pitch, 0.0001, 5), { position: [sx * (W / 2 - 0.09), -0.045 - (n * pitch) / 2, 0.030] })),
  ]));
  const slat = chamferBox(W - 0.024, 0.0012, 0.025, 0.0003);
  const transforms: InstanceTransform[] = Array.from({ length: n }, (_, i) => ({ position: [0, -0.045 - (i + 0.5) * pitch, 0.030], rotation: [0.5, 0, 0] }));
  return { rail, slat, transforms };
}

// ---------------------------------------------------------------------------
// Lighting fixtures
// ---------------------------------------------------------------------------

/** Sconce metalwork: back plate, arm, socket and the two shade caps. */
export function sconceMetal(opts: { shadeR?: number; shadeH?: number } = {}): THREE.BufferGeometry {
  const R = clampNum(opts.shadeR ?? 0.052, 0.02, 0.2, 0.052);
  const H = clampNum(opts.shadeH ?? 0.22, 0.06, 0.6, 0.22);
  return cached(`sconce|${k(R)}|${k(H)}`, () => merged([
    transformed(lathePoints([[0, 0], [0.048, 0], [0.047, 0.005], [0.030, 0.012], [0.020, 0.016], [0, 0.016]], 24), { rotation: [-Math.PI / 2, 0, 0] }),
    transformed(chamferCylinder(0.010, 0.086, 0.0008, 12), { position: [0, 0, 0.062], rotation: [Math.PI / 2, 0, 0] }),
    transformed(lathePoints([[0, 0], [R + 0.004, 0], [R + 0.005, 0.004], [R + 0.001, 0.010], [0, 0.010]], 26), { position: [0, H / 2, 0.108] }),
    transformed(lathePoints([[0, 0], [R + 0.004, 0], [R + 0.005, -0.004], [R + 0.001, -0.010], [0, -0.010]], 26), { position: [0, -H / 2, 0.108] }),
    transformed(chamferCylinder(0.016, 0.034, 0.0008, 12), { position: [0, H / 2 - 0.026, 0.108] }),
    transformed(screwHead(6), { position: [0, 0.030, 0.006], rotation: [Math.PI / 2, 0, 0] }),
    transformed(screwHead(6), { position: [0, -0.030, 0.006], rotation: [Math.PI / 2, 0, 0] }),
  ]));
}

/** Vanity bar light: back plate, arm, extruded body and end caps. */
export function vanityBar(length: number): { body: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const L = clampNum(length, 0.25, 1.6, 0.6);
  return {
    body: cached(`vbar|${k(L)}`, () => merged([
      transformed(filletBox(0.120, 0.120, 0.014, 0.006, 2), { position: [0, 0, 0.007] }),
      transformed(chamferCylinder(0.011, 0.060, 0.0008, 12), { position: [0, 0, 0.040], rotation: [Math.PI / 2, 0, 0] }),
      transformed(filletBox(L, 0.070, 0.086, 0.010, 2), { position: [0, 0, 0.112] }),
      ...[-1, 1].map((sx) => transformed(filletBox(0.014, 0.078, 0.094, 0.006, 2), { position: [(sx * L) / 2, 0, 0.112] })),
    ])),
    lens: cached(`vbar|${k(L)}|l`, () => transformed(filletBox(L - 0.026, 0.010, 0.070, 0.004, 2), { position: [0, -0.036, 0.112] })),
  };
}

/** Exhaust-fan grille: housing, louvred face and the two mounting screws. */
export function fanGrille(size = 0.30): THREE.BufferGeometry {
  const S = clampNum(size, 0.15, 0.6, 0.30);
  return cached(`fan|${k(S)}`, () => {
    const parts: THREE.BufferGeometry[] = [
      transformed(chamferBox(S - 0.04, 0.030, S - 0.04, 0.002), { position: [0, 0.015, 0] }),
      transformed(filletBox(S, 0.012, S, 0.008, 2), { position: [0, -0.006, 0] }),
    ];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const z = -S / 2 + 0.030 + ((S - 0.060) / (n - 1)) * i;
      parts.push(transformed(chamferBox(S - 0.060, 0.004, 0.014, 0.0008), { position: [0, -0.002, z], rotation: [0.5, 0, 0] }));
    }
    parts.push(transformed(screwHead(6), { position: [0, -0.012, S / 2 - 0.016], rotation: [Math.PI, 0, 0] }));
    parts.push(transformed(screwHead(6), { position: [0, -0.012, -S / 2 + 0.016], rotation: [Math.PI, 0, 0] }));
    return merged(parts);
  });
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

/** Square furniture leg with a chamfered foot. */
/**
 * A vanity leg, by the way it actually meets the floor. A furniture vanity on
 * turned legs and the same box on a plinth are not the same cabinet, and the
 * contract could say which since the spec grew `legStyle` — this is the part
 * that turns the word into a silhouette.
 *
 * Every style is built to `height`, standing on y = 0 with its top at y = H, so
 * the carcase above it needs no per-style offset.
 */
export function vanityLeg(kind: 'tapered' | 'turned' | 'square' | 'hairpin', height: number, top = 0.048): THREE.BufferGeometry {
  const H = clampNum(height, 0.04, 0.6, 0.15);
  const T = clampNum(top, 0.012, 0.12, 0.048);
  const key = `vleg|${kind}|${k(H)}|${k(T)}`;
  return cached(key, () => {
    if (kind === 'turned') {
      return lathePoints([
        [0, 0], [T * 0.62, 0], [T * 0.66, 0.010], [T * 0.52, 0.026],
        [T * 0.70, H * 0.30], [T * 0.82, H * 0.46], [T * 0.60, H * 0.56],
        [T * 0.88, H * 0.72], [T, H * 0.86], [T, H], [0, H],
      ], 18);
    }
    if (kind === 'tapered') {
      // a four-sided taper: 3/4 of the top section at the floor, which is the
      // proportion a mid-century leg is actually cut to
      return transformed(lathePoints([[0, 0], [T * 0.52, 0], [T * 0.74, H], [0, H]], 4), { rotation: [0, Math.PI / 4, 0] });
    }
    if (kind === 'hairpin') {
      // two rods raking out of one floor plate — the rake IS the style
      const rod = chamferCylinder(0.006, Math.hypot(H, 0.055), 0.0008, 8);
      const lean = Math.atan2(0.055, H);
      return merged([
        transformed(chamferBox(T * 1.5, 0.005, T * 1.5, 0.0012), { position: [0, 0.0025, 0] }),
        transformed(rod, { position: [0, H / 2, 0.028], rotation: [-lean, 0, 0] }),
        transformed(rod, { position: [0, H / 2, -0.028], rotation: [lean, 0, 0] }),
      ]);
    }
    return transformed(chamferBox(T * 1.4, H, T * 1.4, 0.0025), { position: [0, H / 2, 0] });
  });
}

export function squareLeg(h: number, s = 0.045): THREE.BufferGeometry {
  const H = clampNum(h, 0.02, 1.2, 0.15), S = clampNum(s, 0.008, 0.2, 0.045);
  return cached(`sleg|${k(H)}|${k(S)}`, () => chamferBox(S, H, S, 0.0025).clone());
}

/** Adjustable cabinet levelling foot (what a real toe-kick hides). */
export function levellerFoot(): THREE.BufferGeometry {
  return cached('leveller', () => merged([
    lathePoints([[0, 0], [0.020, 0], [0.020, 0.006], [0.008, 0.010], [0.008, 0.060], [0, 0.060]], 12),
  ]));
}

/** Plain world-UV box, for the rare case a sharp edge is genuinely correct. */
export { worldBox };

// ---------------------------------------------------------------------------
// Shared with the kitchen / exterior builders — DO NOT change these signatures
// ---------------------------------------------------------------------------

/**
 * Door slab facing +Z with recessed panel openings.
 *
 * Kept for `kitchen/RoomShell` and `exterior/Openings`, which import it from
 * here. Prefer `roomDoor()` inside the bathroom: it builds real stiles and
 * rails with a sticking bead instead of a plate with holes.
 */
export function panelDoor(w: number, h: number, thickness: number, panels: Array<{ y: number; h: number }>, inset = 0.07): { frame: THREE.BufferGeometry; panels: Array<{ geometry: THREE.BufferGeometry; y: number }> } {
  const W = clampNum(w, 0.1, 4, 0.8), H = clampNum(h, 0.1, 4, 2), T = clampNum(thickness, 0.006, 0.2, 0.04);
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, -H / 2); shape.lineTo(W / 2, -H / 2); shape.lineTo(W / 2, H / 2); shape.lineTo(-W / 2, H / 2); shape.closePath();
  const pw = W - clampNum(inset, 0, W / 2.2, 0.07) * 2;
  const out: Array<{ geometry: THREE.BufferGeometry; y: number }> = [];
  for (const raw of Array.isArray(panels) ? panels : []) {
    if (!raw || typeof raw !== 'object') continue;
    const ph = clampNum(raw.h, 0, H, 0);
    const py = clampNum(raw.y, -H / 2, H / 2, 0);
    if (pw < 0.08 || ph < 0.08 || Math.abs(py) + ph / 2 > H / 2) continue;
    const hole = new THREE.Path();
    hole.moveTo(-pw / 2, py - ph / 2); hole.lineTo(pw / 2, py - ph / 2); hole.lineTo(pw / 2, py + ph / 2); hole.lineTo(-pw / 2, py + ph / 2); hole.closePath();
    shape.holes.push(hole);
    out.push({ geometry: chamferBox(pw + 0.002, ph + 0.002, Math.max(0.004, T - 0.012), 0.0012), y: py });
  }
  const frame = new THREE.ExtrudeGeometry(shape, { depth: T - 0.003, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, steps: 1 });
  frame.translate(0, 0, -T / 2);
  applyWorldUVs(frame);
  return { frame, panels: out };
}
