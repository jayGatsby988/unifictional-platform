/**
 * EXTERIOR DETAIL KIT — the millwork, hardware, flashing and site fittings that
 * separate a photograph of a house from a massing model.
 *
 * Built on `scene/detail.ts` (chamferBox / filletBox / sweepProfile / PROFILES /
 * instanced / screwHead …). Read that file first; this one is its exterior
 * dialect: everything here is in METRES, carries world-space UVs, is cached by
 * a rounded parameter key, clamps every input and never throws.
 *
 * THREE RULES THIS FILE FOLLOWS EVERYWHERE
 *  1. Nothing is a raw BoxGeometry if a camera can see its edge. A 1.5 mm
 *     chamfer catches a specular line along every arris; that highlight is most
 *     of what reads as "real" at a distance.
 *  2. Anything repeated more than ~8 times ships as `InstanceTransform[]` plus
 *     one unit geometry, so the caller draws it with `<InstancedSurface/>` in a
 *     single call — pickets, balusters, shingle courses, pavers, deck boards.
 *  3. Course/joint/reveal geometry is generated at REAL trade dimensions
 *     (7" lap exposure, 16" batten spacing, 5" shingle exposure, 5' control
 *     joints) so scale reads correctly from any distance.
 *
 * COORDINATES match `helpers.ts`: a wall-local frame is +x along the elevation,
 * +y up from grade, +z outward. Roof-local is centred on the footprint with
 * y = 0 at the wall plate.
 */
import * as THREE from 'three';
import {
  chamferBox, filletBox, chamferCylinder, transformed, screwHead, doorKnob, deadbolt,
  PROFILES, spaceAlong, clampNum, openingCasing,
  type InstanceTransform,
} from '@/components/scene/detail';
import { applyWorldUVs } from '@/components/scene/geometry';
import { box, cachedGeo, cyl, merged, IN } from './helpers';
import type { RoofShape } from './helpers';

/** A unit geometry plus the matrices that stamp it — feed to `<InstancedSurface/>`. */
export interface InstancedPart {
  geometry: THREE.BufferGeometry;
  transforms: InstanceTransform[];
}

const EMPTY: InstanceTransform[] = [];

/**
 * `detail.ts` CACHES and SHARES the geometry it returns — translating one in
 * place corrupts it for every other caller. These three aliases hand back a
 * clone, so a builder can freely `.translate()` / `.rotate*()` the result
 * before merging it. Use them anywhere in this file; the merge throws the
 * clone away immediately afterwards, so the cost is a transient copy.
 */
export const cbox = (w: number, h: number, d: number, c = 0.0015) => chamferBox(w, h, d, c).clone();
export const fbox = (w: number, h: number, d: number, r = 0.004, seg = 2) => filletBox(w, h, d, r, seg).clone();
export const ccyl = (r: number, h: number, c = 0.0006, seg = 16) => chamferCylinder(r, h, c, seg).clone();

/**
 * Clamp a dimension coming in from a solved layout. NaN / Infinity / negative
 * values must never reach a geometry constructor: they propagate into vertex
 * positions, poison the bounding sphere and can black-screen the whole canvas.
 * Every builder in this file funnels its size arguments through here.
 */
const dim = (v: number, min: number, max = 400) => clampNum(v, min, max, min);
const k = (n: number, p = 3) => (Number.isFinite(n) ? n.toFixed(p) : '0');

/** Merge, but return null instead of a degenerate cube when there is nothing. */
function mergedOrNull(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const usable = parts.filter(Boolean);
  return usable.length ? merged(usable) : null;
}

// ===========================================================================
// 1 · CLADDING
// ===========================================================================

/**
 * How a siding material is actually assembled. Chosen from the catalog id so a
 * finish swap re-details the wall: picking board-and-batten grows real battens,
 * picking brick grows a soldier course over every opening.
 */
export type CladdingKind = 'lap' | 'batten' | 'shake' | 'panel' | 'seam' | 'masonry' | 'stucco';

export interface CladdingSpec {
  kind: CladdingKind;
  /** course exposure / batten spacing / panel module, metres */
  module: number;
  /** how far the course butt stands proud of the wall */
  relief: number;
}

const CLADDING_TABLE: Array<[RegExp, CladdingSpec]> = [
  [/board-batten/, { kind: 'batten', module: 16 * IN, relief: 0.019 }],
  [/hardie-lap|vinyl/, { kind: 'lap', module: 7 * IN, relief: 0.014 }],
  [/cedar-natural|cedar-weathered/, { kind: 'lap', module: 6 * IN, relief: 0.016 }],
  [/shake|shingle-sid/, { kind: 'shake', module: 5.5 * IN, relief: 0.017 }],
  [/metal-standing|corrugated/, { kind: 'seam', module: 16 * IN, relief: 0.022 }],
  [/brick|stone|sandstone|slate-wall|ledge/, { kind: 'masonry', module: 8 * IN, relief: 0.012 }],
  [/stucco/, { kind: 'stucco', module: 0, relief: 0 }],
  [/cladding-/, { kind: 'panel', module: 4 * 12 * IN, relief: 0.008 }],
];

export function claddingFor(materialId: string | undefined): CladdingSpec {
  const id = String(materialId ?? '');
  for (const [re, spec] of CLADDING_TABLE) if (re.test(id)) return spec;
  return { kind: 'lap', module: 7 * IN, relief: 0.014 };
}

export interface Hole { x: number; y: number; w: number; h: number }

/** The clear x-spans of a horizontal band [y0,y1] once the openings are cut out. */
function bandSpans(len: number, y0: number, y1: number, holes: Hole[], pad: number): Array<[number, number]> {
  const blockers: Array<[number, number]> = [];
  for (const h of holes) {
    if (h.y + h.h <= y0 + 0.002 || h.y >= y1 - 0.002) continue;
    blockers.push([h.x - h.w / 2 - pad, h.x + h.w / 2 + pad]);
  }
  blockers.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  let cursor = -len / 2;
  for (const [a, b] of blockers) {
    if (a > cursor + 0.06) out.push([cursor, Math.min(a, len / 2)]);
    cursor = Math.max(cursor, b);
    if (cursor >= len / 2) break;
  }
  if (cursor < len / 2 - 0.06) out.push([cursor, len / 2]);
  return out.filter(([a, b]) => b - a > 0.06);
}

/**
 * The cladding relief for one elevation: the shadow line under every lap
 * course, the battens of a board-and-batten wall, the staggered butts of a
 * shake wall, the standing seams of a metal wall, or the joint courses of
 * masonry. Sits a few millimetres proud of the flat field panel and shares its
 * slot, so it swaps and prices with the siding.
 *
 * Returns null for stucco (which genuinely has no relief) and for walls too
 * small to bother with. One merged geometry = one extra draw call per
 * elevation; a two-storey 44 ft wall costs roughly 1.5 k triangles.
 */
export function claddingRelief(
  spec: CladdingSpec, len: number, h: number, holes: Hole[], quality: 'high' | 'balanced' | 'performance' = 'high',
): THREE.BufferGeometry | null {
  const L = dim(len, 0.2), H = dim(h, 0.2);
  if (spec.kind === 'stucco' || spec.module <= 0) return null;
  const holeKey = holes.map((o) => `${k(o.x, 2)},${k(o.y, 2)},${k(o.w, 2)},${k(o.h, 2)}`).join(';');
  return cachedGeo(`clad|${spec.kind}|${k(L, 2)}|${k(H, 2)}|${k(spec.module, 3)}|${quality}|${holeKey}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const cap = quality === 'performance' ? 220 : quality === 'balanced' ? 420 : 900;
    const pad = 0.012;

    if (spec.kind === 'batten' || spec.kind === 'seam') {
      // vertical members: a batten every 16", a standing seam every 16"
      const n = Math.min(cap, Math.max(2, Math.floor(L / spec.module)));
      const step = L / n;
      const bw = spec.kind === 'seam' ? 0.026 : 0.055;
      for (let i = 0; i <= n; i++) {
        const x = -L / 2 + step * i;
        // split the batten wherever an opening crosses it
        const blocked: Array<[number, number]> = holes
          .filter((o) => Math.abs(o.x - x) < o.w / 2 + bw / 2 + pad)
          .map((o) => [o.y - pad, o.y + o.h + pad] as [number, number])
          .sort((a, b) => a[0] - b[0]);
        let y = 0;
        const runs: Array<[number, number]> = [];
        for (const [a, b] of blocked) { if (a > y + 0.08) runs.push([y, Math.min(a, H)]); y = Math.max(y, b); }
        if (y < H - 0.08) runs.push([y, H]);
        for (const [a, b] of runs) {
          const g = cbox(bw, b - a, spec.relief, 0.0018);
          g.translate(x, (a + b) / 2, spec.relief / 2);
          parts.push(g);
        }
      }
      if (spec.kind === 'batten') {
        // the frieze board the battens die into at the top
        const cap2 = cbox(L, 0.09, spec.relief * 1.3, 0.002);
        cap2.translate(0, H - 0.045, spec.relief * 0.65);
        parts.push(cap2);
      }
      return applyWorldUVs(merged(parts));
    }

    // horizontal courses: lap butts, shake butts, masonry joint bands
    const rows = Math.min(cap, Math.max(2, Math.floor(H / spec.module)));
    const step = H / rows;
    const buttH = spec.kind === 'masonry' ? 0.012 : Math.min(0.026, step * 0.32);
    for (let r = 1; r <= rows; r++) {
      const y = step * r;
      for (const [a, b] of bandSpans(L, y - buttH, y + buttH, holes, pad)) {
        const w = b - a;
        // A lap butt is a wedge: thick at the bottom edge, feathered at the top.
        // Chamfering the bottom arris is what produces the shadow line.
        const g = cbox(w, buttH, spec.relief, 0.0015);
        g.translate((a + b) / 2, y, spec.relief / 2);
        parts.push(g);
      }
    }
    if (spec.kind === 'shake' && quality !== 'performance') {
      // staggered vertical butt joints — the thing that says "shake", not "lap"
      const jointsPerCourse = Math.min(24, Math.max(2, Math.floor(L / (10 * IN))));
      for (let r = 1; r <= rows; r += 1) {
        const y = step * r;
        for (let j = 0; j < jointsPerCourse; j++) {
          const t = (j + 0.5) / jointsPerCourse + (r % 2 ? 0.5 / jointsPerCourse : 0);
          const x = -L / 2 + L * (t % 1);
          if (holes.some((o) => Math.abs(o.x - x) < o.w / 2 + pad && y > o.y - pad && y < o.y + o.h + pad)) continue;
          const g = box(0.006, step * 0.94, spec.relief * 0.8);
          g.translate(x, y - step / 2, spec.relief * 0.4);
          parts.push(g);
        }
      }
    }
    return applyWorldUVs(merged(parts));
  });
}

/**
 * Cladding relief clipped to an arbitrary polygon — the gable end, the tall
 * wall under a shed, the gambrel infill. Courses are trimmed to the polygon's
 * width at their own height, so nothing pokes out past the rake board (which is
 * exactly what a rectangular relief does on a triangular wall).
 *
 * `poly` is the same wall-local [x, y] outline `wallTopProfile()` returns.
 */
export function claddingReliefPoly(
  spec: CladdingSpec, poly: Array<[number, number]>, quality: 'high' | 'balanced' | 'performance' = 'high',
): THREE.BufferGeometry | null {
  if (spec.kind === 'stucco' || spec.module <= 0 || poly.length < 3) return null;
  const key = poly.map((p) => `${k(p[0], 2)},${k(p[1], 2)}`).join(';');
  return cachedGeo(`cladpoly|${spec.kind}|${k(spec.module, 3)}|${quality}|${key}`, () => {
    const ys = poly.map((p) => p[1]);
    const top = Math.max(...ys);
    if (!Number.isFinite(top) || top < 0.25) return applyWorldUVs(box(0.01, 0.01, 0.01));

    /** where the outline crosses a horizontal line, as [min, max] */
    const spanAt = (y: number): [number, number] | null => {
      const xs: number[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y - a[1]) / (b[1] - a[1]);
          xs.push(a[0] + (b[0] - a[0]) * t);
        }
      }
      if (xs.length < 2) return null;
      return [Math.min(...xs), Math.max(...xs)];
    };

    const parts: THREE.BufferGeometry[] = [];
    const cap = quality === 'performance' ? 40 : quality === 'balanced' ? 90 : 180;
    const inset = 0.06;

    if (spec.kind === 'batten' || spec.kind === 'seam') {
      const full = spanAt(0.02);
      if (!full) return applyWorldUVs(box(0.01, 0.01, 0.01));
      const width = full[1] - full[0];
      const n = Math.min(cap, Math.max(2, Math.floor(width / spec.module)));
      const bw = spec.kind === 'seam' ? 0.026 : 0.055;
      for (let i = 0; i <= n; i++) {
        const x = full[0] + (width * i) / n;
        // walk up until the outline no longer contains this x
        let hi = 0;
        for (let y = 0.02; y <= top; y += 0.05) {
          const sp = spanAt(y);
          if (!sp || x < sp[0] + inset || x > sp[1] - inset) break;
          hi = y;
        }
        if (hi < 0.15) continue;
        const g = cbox(bw, hi, spec.relief, 0.0018);
        g.translate(x, hi / 2, spec.relief / 2);
        parts.push(g);
      }
      return applyWorldUVs(merged(parts.length ? parts : [box(0.01, 0.01, 0.01)]));
    }

    const rows = Math.min(cap, Math.max(2, Math.floor(top / spec.module)));
    const step = top / rows;
    const buttH = spec.kind === 'masonry' ? 0.012 : Math.min(0.026, step * 0.32);
    for (let r = 1; r <= rows; r++) {
      const y = step * r;
      const sp = spanAt(y);
      if (!sp) continue;
      const a = sp[0] + inset, b = sp[1] - inset;
      if (b - a < 0.12) continue;
      const g = cbox(b - a, buttH, spec.relief, 0.0015);
      g.translate((a + b) / 2, y, spec.relief / 2);
      parts.push(g);
    }
    return applyWorldUVs(merged(parts.length ? parts : [box(0.01, 0.01, 0.01)]));
  });
}

/**
 * Water table: the cap that closes the top of the exposed foundation, with a
 * sloped wash and a drip kerf underneath so rain leaves the wall. Faces +z,
 * origin at the top of the foundation.
 */
export function waterTable(len: number): THREE.BufferGeometry {
  const L = dim(len, 0.3);
  return cachedGeo(`watertable|${k(L, 2)}`, () => {
    const band = cbox(L, 0.14, 0.028, 0.002); band.translate(0, -0.06, 0.014);
    const capG = cbox(L, 0.032, 0.075, 0.0025);
    capG.rotateX(-0.14); capG.translate(0, 0.018, 0.036);
    const drip = box(L, 0.014, 0.012); drip.translate(0, -0.006, 0.062);
    return merged([band, capG, drip]);
  });
}

/**
 * Corner boards with a real reveal: two chamfered boards mitred at the corner
 * plus the shadow bead between them and the siding. Origin at the corner.
 */
export function cornerBoardPair(height: number, width: number, thick = 0.028): THREE.BufferGeometry {
  const h = dim(height, 0.4), w = dim(width, 0.04);
  return cachedGeo(`cornerx|${k(h, 2)}|${k(w, 3)}|${k(thick, 3)}`, () => {
    const a = cbox(w, h, thick, 0.002); a.translate(w / 2, h / 2, thick / 2);
    const b = cbox(thick, h, w, 0.002); b.translate(thick / 2, h / 2, w / 2);
    // the thin bead that reads as the caulk joint against the field
    const beadA = box(0.008, h, thick * 0.5); beadA.translate(w + 0.004, h / 2, thick * 0.25);
    const beadB = box(thick * 0.5, h, 0.008); beadB.translate(thick * 0.25, h / 2, w + 0.004);
    return merged([a, b, beadA, beadB]);
  });
}

/** Soldier course over a masonry opening (bricks stood on end). */
export function soldierCourse(width: number): THREE.BufferGeometry {
  const w = dim(width, 0.2);
  return cachedGeo(`soldier|${k(w, 2)}`, () => {
    const n = Math.max(2, Math.min(60, Math.round(w / (4 * IN))));
    const step = w / n;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const g = cbox(step - 0.006, 8 * IN, 0.022, 0.0015);
      g.translate(-w / 2 + step * (i + 0.5), 0, 0.011);
      parts.push(g);
    }
    return merged(parts);
  });
}

/** Cast stone / rowlock sill under a masonry opening, sloped to shed water. */
export function masonrySill(width: number): THREE.BufferGeometry {
  const w = dim(width, 0.2);
  return cachedGeo(`msill|${k(w, 2)}`, () => {
    const g = cbox(w, 0.055, 0.1, 0.003);
    g.rotateX(-0.11); g.translate(0, 0, 0.042);
    const drip = box(w - 0.02, 0.012, 0.014); drip.translate(0, -0.028, 0.086);
    return merged([g, drip]);
  });
}

// ===========================================================================
// 2 · ROOF
// ===========================================================================

/** The two sloping edges of each gable end, for rake boards. */
export interface RakeRun {
  /** roof-local start (outer eave corner) and end (ridge) */
  from: [number, number, number];
  to: [number, number, number];
  length: number;
}

export function rakeRuns(s: RoofShape): RakeRun[] {
  if (s.type === 'flat' || s.type === 'hip') return [];
  const A = s.across, along = s.along, R = s.rise, E = -s.eaveDrop;
  const out: RakeRun[] = [];
  const mk = (ax: number, az: number, bx: number, bz: number, ay: number, by: number) => {
    out.push({
      from: [ax, ay, az], to: [bx, by, bz],
      length: Math.hypot(bx - ax, by - ay, bz - az),
    });
  };
  if (s.ridge === 'x') {
    for (const sx of [-1, 1]) {
      const x = (sx * along) / 2;
      if (s.type === 'shed') mk(x, A / 2, x, -A / 2, E, R - E);
      else { mk(x, -A / 2, x, 0, E, R); mk(x, A / 2, x, 0, E, R); }
    }
  } else {
    for (const sz of [-1, 1]) {
      const z = (sz * along) / 2;
      if (s.type === 'shed') mk(A / 2, z, -A / 2, z, E, R - E);
      else { mk(-A / 2, z, 0, z, E, R); mk(A / 2, z, 0, z, E, R); }
    }
  }
  return out;
}

/**
 * The roof's shingle/tile courses as raised butt lines lying on each plane.
 * A pitched roof rendered as one flat slab is the single most obvious "it's a
 * model" tell; stepping it at the real 5" exposure fixes that for ~1 draw call
 * and a couple of thousand triangles.
 */
export function roofCourses(s: RoofShape, quality: 'high' | 'balanced' | 'performance' = 'high'): THREE.BufferGeometry | null {
  if (s.type === 'flat') return null;
  const exposure = 5.5 * IN;
  return cachedGeo(`courses|${s.type}|${k(s.across, 2)}|${k(s.along, 2)}|${k(s.rise, 2)}|${s.ridge}|${quality}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const A = s.across, along = s.along, R = s.rise, E = -s.eaveDrop;
    const cap = quality === 'performance' ? 24 : quality === 'balanced' ? 64 : 150;
    const tabs = quality === 'high' ? 26 : quality === 'balanced' ? 14 : 0;
    const buttT = 0.02;

    /**
     * Lay courses up ONE plane. `a` is the across-axis coordinate, which maps to
     * world z when the ridge runs along x and to world x when it runs along z.
     * A course strip lies flat and is tilted about the axis perpendicular to
     * the slope; the sign of that tilt follows the sign of the plane's fall.
     *
     * three's Euler XYZ with only one component set is a plain axis rotation,
     * so: ridge x → tilt about X, and rotating +φ about X drives +z downward;
     * ridge z → tilt about Z, and rotating +φ about Z drives +x upward.
     */
    const plane = (aStart: number, aEnd: number, yStart: number, yEnd: number) => {
      const run = aEnd - aStart;
      const rise = yEnd - yStart;
      const slopeLen = Math.hypot(run, rise);
      if (slopeLen < exposure * 1.5) return;
      const n = Math.min(cap, Math.max(2, Math.floor(slopeLen / exposure)));
      // fall per unit of |a| travelled, signed so the tilt matches the plane
      const theta = Math.atan2(rise, Math.abs(run)) * (run > 0 ? -1 : 1);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const a = aStart + run * t;
        const y = yStart + rise * t;
        if (s.ridge === 'x') {
          const g = cbox(along, buttT, exposure * 0.92, 0.0012);
          g.rotateX(theta);
          g.translate(0, y + buttT * 0.45, a);
          parts.push(g);
          for (let j = 0; j < tabs; j++) {
            // staggered vertical tab cuts — what makes courses read as shingles
            const off = ((j + (i % 2 ? 0.5 : 0)) / tabs - 0.5) * along;
            const nb = cbox(0.012, buttT * 1.15, exposure * 0.9, 0.001);
            nb.rotateX(theta);
            nb.translate(off, y + buttT * 0.5, a);
            parts.push(nb);
          }
        } else {
          const g = cbox(exposure * 0.92, buttT, along, 0.0012);
          g.rotateZ(-theta);
          g.translate(a, y + buttT * 0.45, 0);
          parts.push(g);
          for (let j = 0; j < tabs; j++) {
            const off = ((j + (i % 2 ? 0.5 : 0)) / tabs - 0.5) * along;
            const nb = cbox(exposure * 0.9, buttT * 1.15, 0.012, 0.001);
            nb.rotateZ(-theta);
            nb.translate(a, y + buttT * 0.5, off);
            parts.push(nb);
          }
        }
      }
    };

    if (s.type === 'shed') plane(A / 2, -A / 2, E, R - E);
    else { plane(A / 2, 0, E, R); plane(-A / 2, 0, E, R); }
    return mergedOrNull(parts) ?? applyWorldUVs(box(0.01, 0.01, 0.01));
  });
}

/** Ridge cap: a run of overlapping caps straddling the ridge. */
export function ridgeCap(length: number): THREE.BufferGeometry {
  const L = dim(length, 0.3);
  return cachedGeo(`ridgecap|${k(L, 2)}`, () => {
    const n = Math.max(2, Math.min(120, Math.round(L / (10 * IN))));
    const step = L / n;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const a = cbox(step + 0.012, 0.05, 0.17, 0.0018);
      a.rotateZ(0);
      a.translate(-L / 2 + step * (i + 0.5), 0.012 + (i % 2) * 0.004, 0);
      parts.push(a);
    }
    return merged(parts);
  });
}

/** Drip edge: the L-flashing that closes the deck edge over the fascia. */
export function dripEdge(length: number): THREE.BufferGeometry {
  const L = dim(length, 0.3);
  return cachedGeo(`dripedge|${k(L, 2)}`, () => {
    const top = box(L, 0.004, 0.05); top.translate(0, 0, 0.025);
    const face = box(L, 0.045, 0.004); face.translate(0, -0.022, 0.05);
    const kick = box(L, 0.008, 0.012); kick.translate(0, -0.044, 0.055);
    return merged([top, face, kick]);
  });
}

/** Fascia board with a chamfered bottom arris and a bed-mould shadow line. */
export function fasciaBoard(length: number, height = 0.185): THREE.BufferGeometry {
  const L = dim(length, 0.3), H = dim(height, 0.08);
  return cachedGeo(`fascia|${k(L, 2)}|${k(H, 3)}`, () => {
    const board = cbox(L, H, 0.032, 0.0022);
    const bed = cbox(L, 0.035, 0.05, 0.002); bed.translate(0, H / 2 - 0.017, -0.012);
    return merged([board, bed]);
  });
}

/**
 * Soffit: the panel closing the underside of the overhang, with continuous
 * vents let into it. `depth` is the overhang; the run is along local +x and the
 * panel lies in the XZ plane at y = 0, extending to +z.
 */
export function soffitPanel(length: number, depth: number): THREE.BufferGeometry | null {
  const L = dim(length, 0.2), D = depth;
  if (D < 0.06) return null;
  return cachedGeo(`soffit|${k(L, 2)}|${k(D, 3)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const panel = box(L, 0.018, D); panel.translate(0, 0, D / 2); parts.push(panel);
    // continuous vent strip two-thirds of the way out, with real louvre bars
    const ventZ = D * 0.6;
    const vw = Math.min(0.09, D * 0.34);
    const rec = box(L * 0.94, 0.006, vw); rec.translate(0, -0.011, ventZ); parts.push(rec);
    const bars = Math.max(3, Math.min(90, Math.floor((L * 0.94) / 0.09)));
    for (let i = 0; i < bars; i++) {
      const b = box((L * 0.94) / bars - 0.02, 0.004, vw * 0.7);
      b.translate(-L * 0.47 + ((L * 0.94) / bars) * (i + 0.5), -0.014, ventZ);
      parts.push(b);
    }
    // frieze return where the soffit dies into the wall
    const ret = cbox(L, 0.075, 0.028, 0.002); ret.translate(0, 0.03, 0.014); parts.push(ret);
    return merged(parts);
  });
}

/**
 * K-style gutter: 5" section with the ogee front face stepped out of three
 * chamfered facets, a rolled bead at the lip, end caps and hidden hangers.
 *
 * Runs along local +x with the trough opening upward and the ogee face toward
 * +z (outward); the caller hangs it under the fascia with the eave's yaw. The
 * ogee is built from boxes rather than swept, because a mis-oriented sweep is
 * invisible in a headless check and this section is what the eye reads.
 */
export function gutterProfile(length: number): THREE.BufferGeometry {
  const L = dim(length, 0.3);
  return cachedGeo(`gutterx|${k(L, 2)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const H = 0.128, D = 0.113, t = 0.011;
    // back leg (screws to the fascia)
    const back = cbox(L, H, t, 0.0012); back.translate(0, -H / 2, t / 2); parts.push(back);
    // trough floor
    const floor = cbox(L, t, D - t, 0.0012); floor.translate(0, -H + t / 2, (D + t) / 2 - t); parts.push(floor);
    // ogee front, three facets: an outward kick, a hollow, then the fascia face
    const f1 = cbox(L, 0.05, t, 0.0012); f1.rotateX(-0.42); f1.translate(0, -H + 0.026, D - 0.028); parts.push(f1);
    const f2 = cbox(L, 0.042, t, 0.0012); f2.rotateX(0.35); f2.translate(0, -H + 0.062, D - 0.006); parts.push(f2);
    const f3 = cbox(L, 0.05, t, 0.0012); f3.translate(0, -0.032, D - 0.001); parts.push(f3);
    // rolled bead at the top of the face
    const bead = ccyl(0.011, L, 0.001, 10); bead.rotateZ(Math.PI / 2); bead.translate(0, -0.006, D - 0.004); parts.push(bead);
    // end caps
    for (const sx of [-1, 1]) {
      const cap = cbox(0.008, H, D, 0.0012);
      cap.translate(sx * (L / 2 - 0.004), -H / 2, D / 2);
      parts.push(cap);
    }
    // hidden hangers every 24", each with the screw that holds it
    const n = Math.max(2, Math.min(60, Math.round(L / 0.61)));
    for (let i = 0; i <= n; i++) {
      const x = -L / 2 + (L * i) / n;
      const h = cbox(0.022, 0.018, D - 0.02, 0.001); h.translate(x, -0.018, D / 2); parts.push(h);
      parts.push(transformed(screwHead(8), { position: [x, -0.018, 0.004], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  });
}

/**
 * Downspout: tube, elbows, straps with screws, and a kick-out at grade.
 *
 * The tube hangs on the WALL (local z = 0 is the wall face, +z outward), and
 * `reach` is how far out the gutter is — under a 2 ft overhang the spout needs
 * a real offset run at the top to get from the wall out to the gutter outlet.
 * Hanging it straight under the gutter instead, which is what we used to do,
 * stood a white pole two feet clear of the house in every street view.
 */
export function downspoutRun(height: number, reach = 0): THREE.BufferGeometry {
  const h = dim(height, 0.4);
  const R = Math.max(0, reach);
  return cachedGeo(`spoutx|${k(h, 2)}|${k(R, 2)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const w = 0.075, d = 0.056;
    const tube = cbox(w, h - 0.12, d, 0.0018); tube.translate(0, (h - 0.12) / 2 + 0.06, d / 2);
    parts.push(tube);
    if (R > 0.1) {
      // offset run: elbow, a sloped leg out to the gutter line, then the outlet
      const riseOut = 0.16;
      const leg = cbox(w, Math.hypot(R, riseOut) + 0.04, d, 0.0018);
      leg.rotateX(Math.atan2(R, riseOut));
      leg.translate(0, h - 0.06 + riseOut / 2, d / 2 + R / 2);
      parts.push(leg);
      const out = cbox(w * 0.95, 0.07, d * 0.95, 0.0015);
      out.translate(0, h - 0.06 + riseOut, d / 2 + R);
      parts.push(out);
    } else {
      // short eave: a single elbow straight up into the outlet
      const e1 = cbox(w, 0.1, d, 0.0018); e1.rotateX(-0.5); e1.translate(0, h - 0.02, -0.02); parts.push(e1);
      const outlet = cbox(w * 0.9, 0.05, d * 0.9, 0.0015); outlet.translate(0, h + 0.04, -0.05); parts.push(outlet);
    }
    // bottom kick-out
    const e2 = cbox(w, 0.09, d, 0.0018); e2.rotateX(0.62); e2.translate(0, 0.055, d / 2 + 0.03); parts.push(e2);
    const shoe = cbox(w, 0.05, 0.2, 0.0018); shoe.rotateX(0.12); shoe.translate(0, 0.03, 0.15); parts.push(shoe);
    // straps, each with a visible screw
    const n = Math.max(2, Math.min(8, Math.round(h / 1.6)));
    for (let i = 1; i <= n; i++) {
      const y = (h * i) / (n + 1);
      const strap = box(w + 0.055, 0.022, d + 0.006); strap.translate(0, y, d / 2);
      parts.push(strap);
      for (const sx of [-1, 1]) {
        const sc = transformed(screwHead(9), { position: [sx * (w / 2 + 0.018), y, 0.004], rotation: [Math.PI / 2, 0, 0] });
        parts.push(sc);
      }
    }
    return merged(parts);
  });
}

/** Precast splash block under a downspout, sloped away from the wall. */
export function splashBlock(): THREE.BufferGeometry {
  return cachedGeo('splash', () => {
    const body = cbox(0.3, 0.075, 0.55, 0.004);
    body.rotateX(0.05); body.translate(0, 0.035, 0.28);
    const trough = box(0.2, 0.03, 0.46); trough.rotateX(0.05); trough.translate(0, 0.062, 0.28);
    return merged([body, trough]);
  });
}

/** Step flashing where a roof plane dies into a wall (porch, wing, chimney). */
export function stepFlashing(length: number, riseSlope: number): THREE.BufferGeometry {
  const L = dim(length, 0.2);
  return cachedGeo(`stepflash|${k(L, 2)}|${k(riseSlope, 3)}`, () => {
    const n = Math.max(2, Math.min(80, Math.round(L / (7 * IN))));
    const step = L / n;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + step * (i + 0.5);
      const y = riseSlope * (x + L / 2);
      const up = box(step + 0.01, 0.12, 0.004); up.translate(x, y + 0.06, 0.004);
      const flat = box(step + 0.01, 0.004, 0.09); flat.translate(x, y + 0.004, 0.047);
      parts.push(up, flat);
    }
    return merged(parts);
  });
}

// ===========================================================================
// 3 · OPENINGS
// ===========================================================================

/**
 * Brickmould casing around an opening, with the drip cap that sits over the
 * head. Origin at the BOTTOM of the opening, running up to `h` and projecting
 * toward +z — the same frame `openingCasing` uses, which this wraps so the
 * mitres and reveal come from the engine's tested sweeper.
 *
 * `band` is the trim width the spec asked for; the stock profile is 2-1/2"
 * wide, so we scale it to match rather than stretching the section.
 */
export function brickmould(w: number, h: number, band: number, opts: { profile?: 'brickmould' | 'colonial-casing' | 'craftsman-casing' | 'modern-casing' | 'panel-bead'; sill?: boolean; dripCap?: boolean } = {}): THREE.BufferGeometry {
  const W = dim(w, 0.2), H = dim(h, 0.2), B = clampNum(band, 0.04, 0.36, 0.11);
  const prof = opts.profile ?? 'brickmould';
  const src = PROFILES[prof] ?? PROFILES['brickmould'];
  // profile y is the casing's WIDTH across the wall; scale it to the spec band
  const nominal = Math.max(...src.map((p) => p[1]));
  const scale = clampNum(B / Math.max(1e-4, nominal), 0.4, 5, 1);
  return cachedGeo(`bmould|${prof}|${k(W, 3)}|${k(H, 3)}|${k(B, 3)}|${opts.sill ? 1 : 0}|${opts.dripCap === false ? 0 : 1}`, () => {
    const parts: THREE.BufferGeometry[] = [openingCasing(W, H, prof, { reveal: 0.006, scale, sill: opts.sill === true })];
    if (opts.dripCap !== false) {
      const outer = W + B * 2 + 0.05;
      const cap = cbox(outer, 0.028, B * 0.7, 0.0022);
      cap.rotateX(-0.16); cap.translate(0, H + B * 0.55, B * 0.3);
      const drip = box(outer - 0.01, 0.012, 0.012); drip.translate(0, H + B * 0.5, B * 0.62);
      parts.push(cap, drip);
    }
    return merged(parts);
  });
}

/** Stool + apron under a window: the projecting sill and the board beneath it. */
export function sillApron(width: number, band: number): THREE.BufferGeometry {
  const W = dim(width, 0.2), B = clampNum(band, 0.04, 0.36, 0.11);
  return cachedGeo(`sillapron|${k(W, 3)}|${k(B, 3)}`, () => {
    const stool = cbox(W + 0.06, 0.034, 0.1, 0.0025);
    stool.rotateX(-0.1); stool.translate(0, 0, 0.04);
    const drip = box(W + 0.04, 0.012, 0.014); drip.translate(0, -0.024, 0.086);
    const apron = cbox(W - 0.02, B * 0.72, 0.024, 0.002);
    apron.translate(0, -0.024 - B * 0.36, 0.012);
    // the two ears the apron is scribed back to
    const earL = cbox(0.02, B * 0.72, 0.03, 0.0018); earL.translate(-(W - 0.02) / 2 - 0.01, -0.024 - B * 0.36, 0.015);
    const earR = earL.clone(); earR.translate(W - 0.02 + 0.02, 0, 0);
    return merged([stool, drip, apron, earL, earR]);
  });
}

/**
 * Window sash with real stile/rail widths, a chamfered edge on every member,
 * a meeting rail and the muntin grid the style calls for. Faces +z; the frame
 * runs from z = -0.03 (in the wall) to z = +0.05 (proud of the siding).
 */
export function sashUnit(w: number, h: number, style: string): THREE.BufferGeometry {
  const W = dim(w, 0.25), H = dim(h, 0.25);
  return cachedGeo(`sashx|${k(W, 3)}|${k(H, 3)}|${style}`, () => {
    const jamb = 0.052, sashW = 0.038, dpt = 0.08, z0 = -0.03;
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, x: number, y: number, z: number) => { g.translate(x, y, z); parts.push(g); };
    const frameZ = z0 + dpt / 2;
    // outer frame (jambs, head, sill)
    add(cbox(W, jamb, dpt, 0.0018), 0, H / 2 - jamb / 2, frameZ);
    add(cbox(W, jamb * 1.15, dpt, 0.0018), 0, -H / 2 + jamb * 0.575, frameZ);
    add(cbox(jamb, H - jamb * 2, dpt, 0.0018), -W / 2 + jamb / 2, 0, frameZ);
    add(cbox(jamb, H - jamb * 2, dpt, 0.0018), W / 2 - jamb / 2, 0, frameZ);

    const iw = W - jamb * 2, ih = H - jamb * 2;
    const sashZ = z0 + dpt - 0.018;
    // sash perimeter, set in from the frame — this is the reveal that makes a
    // window look like joinery instead of a hole with a border round it
    const perim = (yc: number, hh: number) => {
      add(cbox(iw, sashW, 0.03, 0.0015), 0, yc + hh / 2 - sashW / 2, sashZ);
      add(cbox(iw, sashW, 0.03, 0.0015), 0, yc - hh / 2 + sashW / 2, sashZ);
      add(cbox(sashW, hh - sashW * 2, 0.03, 0.0015), -iw / 2 + sashW / 2, yc, sashZ);
      add(cbox(sashW, hh - sashW * 2, 0.03, 0.0015), iw / 2 - sashW / 2, yc, sashZ);
    };
    const bar = 0.026, barZ = z0 + dpt - 0.012;
    const hBar = (y: number, span = iw) => add(cbox(span, bar, 0.022, 0.0012), 0, y, barZ);
    const vBar = (x: number, yc: number, hh: number) => add(cbox(bar, hh, 0.022, 0.0012), x, yc, barZ);

    const twoSash = style === 'double-hung' || style === 'standard' || style === 'colonial';
    if (twoSash) {
      perim(ih / 4, ih / 2); perim(-ih / 4, ih / 2);
      add(cbox(iw, 0.05, 0.034, 0.0018), 0, 0, sashZ);   // meeting rail
      if (style === 'colonial') {
        for (const yc of [ih / 4, -ih / 4]) {
          const inner = ih / 2 - sashW * 2;
          hBar(yc, iw - sashW * 2);
          for (const s of [-1, 1]) vBar((s * (iw - sashW * 2)) / 6, yc, inner);
          vBar(0, yc, inner);
        }
      } else if (W > 1.0) {
        for (const yc of [ih / 4, -ih / 4]) vBar(0, yc, ih / 2 - sashW * 2);
      }
      // sash lift + lock
      const lift = cbox(0.09, 0.014, 0.02, 0.0012); lift.translate(0, -ih / 4 - ih / 4 + 0.05, z0 + dpt + 0.004);
      parts.push(lift);
    } else {
      perim(0, ih);
      if (style === 'slider') vBar(0, 0, ih - sashW * 2);
      else if (style === 'casement' && W > 0.9) vBar(0, 0, ih - sashW * 2);
      else if (style === 'french') { hBar(0, iw - sashW * 2); vBar(0, 0, ih - sashW * 2); }
      else if (style === 'bay') { vBar(-iw / 4, 0, ih - sashW * 2); vBar(iw / 4, 0, ih - sashW * 2); }
    }
    return merged(parts);
  });
}

/**
 * Louvered shutter, faces +z, centred. Real stiles and rails with a chamfer on
 * every arris, angled louvres between them, and the pair of strap hinges that
 * make it read as hung rather than glued on.
 */
export function shutterPanel(w: number, h: number): THREE.BufferGeometry {
  const W = dim(w, 0.12), H = dim(h, 0.3);
  return cachedGeo(`shutterx|${k(W, 3)}|${k(H, 3)}`, () => {
    const t = 0.03;
    const parts: THREE.BufferGeometry[] = [];
    const stileW = Math.min(0.058, W * 0.28);
    for (const sx of [-1, 1]) {
      const st = cbox(stileW, H, t, 0.0018);
      st.translate(sx * (W / 2 - stileW / 2), 0, t / 2);
      parts.push(st);
    }
    for (const [y, hh] of [[H / 2 - 0.032, 0.064], [-H / 2 + 0.032, 0.064], [0, 0.055]] as Array<[number, number]>) {
      const r = cbox(W, hh, t, 0.0018); r.translate(0, y, t / 2); parts.push(r);
    }
    const inner = W - stileW * 2;
    const n = Math.max(4, Math.min(48, Math.floor((H - 0.2) / 0.06)));
    for (let i = 0; i < n; i++) {
      const y = -H / 2 + 0.095 + ((H - 0.19) * i) / (n - 1);
      if (Math.abs(y) < 0.04) continue;
      const s = cbox(inner, 0.024, 0.022, 0.0012);
      s.rotateX(-0.55);
      s.translate(0, y, t * 0.55);
      parts.push(s);
    }
    // strap hinges on the outer stile
    for (const y of [H * 0.34, -H * 0.34]) {
      const strap = cbox(stileW * 1.9, 0.036, 0.008, 0.0015);
      strap.translate(-W / 2 + stileW * 0.6, y, t + 0.004);
      parts.push(strap);
      parts.push(transformed(screwHead(6), { position: [-W / 2 + stileW * 0.35, y, t + 0.009], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  });
}

/**
 * Entry-door furniture: handleset with backplate and screws, a deadbolt above
 * it, and a kick plate at the bottom. Returned separately so each part takes
 * the finish it should.
 */
export function entryHardware(): { lock: THREE.BufferGeometry; kick: (w: number) => THREE.BufferGeometry } {
  const lock = cachedGeo('entry-lock', () => {
    const plate = fbox(0.062, 0.28, 0.012, 0.008); plate.translate(0, 0, 0.006);
    const knobG = transformed(doorKnob({ lever: true }), { position: [0, -0.06, 0.012] });
    const boltG = transformed(deadbolt(), { position: [0, 0.085, 0.012] });
    const parts: THREE.BufferGeometry[] = [plate, knobG, boltG];
    for (const y of [0.128, -0.128]) parts.push(transformed(screwHead(6), { position: [0, y, 0.013], rotation: [Math.PI / 2, 0, 0] }));
    return merged(parts);
  });
  const kick = (w: number) => cachedGeo(`kickplate|${k(w, 3)}`, () => {
    const p = cbox(dim(w, 0.2) - 0.03, 0.2, 0.004, 0.0012);
    const parts: THREE.BufferGeometry[] = [p];
    const n = 4;
    for (let i = 0; i < n; i++) {
      for (const sy of [-1, 1]) {
        parts.push(transformed(screwHead(5), {
          position: [-(w - 0.09) / 2 + ((w - 0.09) * i) / (n - 1), sy * 0.078, 0.003],
          rotation: [Math.PI / 2, 0, 0],
        }));
      }
    }
    return merged(parts);
  });
  return { lock, kick };
}

/**
 * Garage-door lift handle, the two decorative strap hinges beside it and the
 * pull rope escutcheon. Placed on the second section up, where a real one is.
 */
export function garageHardware(w: number, rows: number): THREE.BufferGeometry {
  const W = dim(w, 0.6);
  const R = Number.isFinite(rows) ? Math.max(2, Math.min(8, Math.round(rows))) : 4;
  return cachedGeo(`ghw|${k(W, 2)}|${R}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const handle = fbox(0.22, 0.05, 0.02, 0.006); handle.translate(0, 0, 0.03);
    const hubA = fbox(0.032, 0.055, 0.032, 0.004); hubA.translate(-0.085, 0, 0.016);
    const hubB = hubA.clone(); hubB.translate(0.17, 0, 0);
    parts.push(handle, hubA, hubB);
    // carriage-house strap hinges either side, with their bolts
    for (const sx of [-1, 1]) {
      const x = sx * Math.min(W / 2 - 0.14, 0.9);
      const strap = fbox(0.24, 0.055, 0.012, 0.005); strap.translate(x - sx * 0.08, 0, 0.028);
      const pivot = ccyl(0.035, 0.016, 0.002, 12); pivot.rotateX(Math.PI / 2); pivot.translate(x, 0, 0.032);
      parts.push(strap, pivot);
      for (let i = 0; i < 3; i++) {
        parts.push(transformed(screwHead(7), { position: [x - sx * (0.04 + i * 0.06), 0, 0.036], rotation: [Math.PI / 2, 0, 0] }));
      }
    }
    return merged(parts);
  });
}

/**
 * Knee bracket / corbel under an eave or a gable overhang. This is the single
 * detail that says "craftsman" or "farmhouse" rather than "generic house", and
 * an overhang without one reads as an unsupported slab.
 *
 * Origin at the wall face, at the TOP of the bracket; it hangs down and out
 * toward +z. `run` is how far it projects, `drop` how far down the wall.
 */
export function eaveBracket(run: number, drop: number, style: 'craftsman' | 'scroll' | 'timber' = 'craftsman'): THREE.BufferGeometry {
  const RU = dim(run, 0.15, 2), DR = dim(drop, 0.15, 2.5);
  return cachedGeo(`bracket|${k(RU, 3)}|${k(DR, 3)}|${style}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const t = style === 'timber' ? 0.11 : 0.075;
    // vertical leg against the wall
    const leg = cbox(t, DR, 0.075, 0.003); leg.translate(0, -DR / 2, 0.038); parts.push(leg);
    // horizontal arm under the soffit
    const arm = cbox(t, 0.09, RU, 0.003); arm.translate(0, -0.045, RU / 2); parts.push(arm);
    if (style === 'scroll') {
      // a quarter-round web, stepped so it reads as a sawn scroll
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        const a = ((i + 0.5) / steps) * (Math.PI / 2);
        const r = Math.min(RU, DR) * 0.86;
        const seg = cbox(t * 0.7, 0.055, 0.055, 0.002);
        seg.translate(0, -DR + Math.sin(a) * r, Math.cos(a) * r);
        parts.push(seg);
      }
    } else {
      // a diagonal brace, the way a real knee brace is cut
      const len = Math.hypot(RU, DR) * 0.82;
      const br = cbox(t * 0.8, 0.075, len, 0.003);
      br.rotateX(Math.atan2(DR, RU));
      br.translate(0, -DR * 0.52, RU * 0.46);
      parts.push(br);
      if (style === 'timber') {
        parts.push(transformed(screwHead(16), { position: [t * 0.42, -DR * 0.52, RU * 0.46], rotation: [0, 0, -Math.PI / 2] }));
      }
    }
    return merged(parts);
  });
}

// ===========================================================================
// 4 · PORCH, DECK, RAILINGS
// ===========================================================================

/**
 * Railing frame (top rail with a real profile, bottom rail, newels at each end)
 * plus the baluster transforms to instance. Runs along local +x, origin at the
 * deck surface.
 */
export function railingParts(length: number, height: number, style: 'baluster' | 'cable' | 'picket'): {
  frame: THREE.BufferGeometry;
  baluster: THREE.BufferGeometry;
  transforms: InstanceTransform[];
} {
  const L = dim(length, 0.3), H = dim(height, 0.6);
  const frame = cachedGeo(`railframe|${k(L, 2)}|${k(H, 2)}|${style}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    // top rail: a real 2× cap over a sub-rail, with the drip bevel underneath
    const cap = cbox(L, 0.038, 0.14, 0.003); cap.translate(0, H - 0.019, 0);
    const sub = cbox(L, 0.05, 0.09, 0.0025); sub.translate(0, H - 0.063, 0);
    const bot = cbox(L, 0.042, 0.085, 0.0025); bot.translate(0, 0.095, 0);
    parts.push(cap, sub, bot);
    for (const sx of [-1, 1]) {
      const x = sx * (L / 2 - 0.05);
      const post = cbox(0.1, H + 0.09, 0.1, 0.004); post.translate(x, (H + 0.09) / 2, 0);
      const collar = cbox(0.13, 0.03, 0.13, 0.003); collar.translate(x, H + 0.075, 0);
      const finial = cbox(0.115, 0.055, 0.115, 0.005); finial.translate(x, H + 0.118, 0);
      const base = cbox(0.125, 0.04, 0.125, 0.003); base.translate(x, 0.02, 0);
      parts.push(post, collar, finial, base);
    }
    if (style === 'cable') {
      for (let i = 1; i <= 6; i++) {
        const c = cyl(0.005, 0.005, L - 0.14, 6); c.rotateZ(Math.PI / 2);
        c.translate(0, 0.115 + ((H - 0.2) * i) / 7, 0);
        parts.push(c);
      }
    }
    return merged(parts);
  });

  if (style === 'cable') return { frame, baluster: box(0.01, 0.01, 0.01), transforms: EMPTY };

  const clear = H - 0.137;
  const baluster = cachedGeo(`bal|${k(clear, 3)}|${style}`, () => (
    style === 'picket'
      ? cbox(0.036, clear, 0.021, 0.0014)
      : cbox(0.03, clear, 0.03, 0.0014)
  ));
  // code spacing: no 4" sphere passes, so ≤ 4" clear between balusters
  const span = L - 0.22;
  const n = Math.max(2, Math.min(60, Math.floor(span / (4.4 * IN))));
  const transforms = spaceAlong(
    [-span / 2, 0.116 + clear / 2, 0],
    [span / 2, 0.116 + clear / 2, 0],
    n + 1,
  );
  return { frame, baluster, transforms };
}

/** Porch column: base block, plinth, shaft with entasis, necking, capital. */
export function columnUnit(height: number, kind: 'square' | 'tapered' | 'round' | 'timber'): THREE.BufferGeometry {
  const h = dim(height, 0.6);
  return cachedGeo(`colx|${k(h, 2)}|${kind}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    if (kind === 'round') {
      const baseH = 0.12, capH = 0.1;
      const plinth = cbox(0.36, 0.055, 0.36, 0.004); plinth.translate(0, 0.0275, 0); parts.push(plinth);
      const torus = ccyl(0.155, baseH - 0.055, 0.004, 20); torus.translate(0, 0.055 + (baseH - 0.055) / 2, 0); parts.push(torus);
      // entasis: the shaft swells slightly and tapers to ~0.82 at the neck
      const shaftH = h - baseH - capH;
      const seg = 8;
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg, t1 = (i + 1) / seg;
        const r = (t: number) => 0.13 * (1 + 0.055 * Math.sin(Math.PI * Math.min(1, t * 0.9)) - 0.16 * t * t);
        const s = cyl(r(t1), r(t0), shaftH / seg + 0.001, 20);
        s.translate(0, baseH + shaftH * (t0 + t1) / 2, 0);
        parts.push(s);
      }
      const neck = ccyl(0.128, 0.03, 0.003, 20); neck.translate(0, h - capH - 0.015, 0); parts.push(neck);
      const echinus = cyl(0.16, 0.125, 0.045, 20); echinus.translate(0, h - capH + 0.022, 0); parts.push(echinus);
      const abacus = cbox(0.34, 0.05, 0.34, 0.004); abacus.translate(0, h - 0.025, 0); parts.push(abacus);
    } else if (kind === 'tapered') {
      const baseH = h * 0.3;
      const pier = cbox(0.44, baseH, 0.44, 0.005); pier.translate(0, baseH / 2, 0); parts.push(pier);
      const water = cbox(0.5, 0.05, 0.5, 0.004); water.rotateX(0); water.translate(0, baseH + 0.025, 0); parts.push(water);
      const shaftH = h - baseH - 0.14;
      const shaft = new THREE.CylinderGeometry(0.105, 0.155, shaftH, 4);
      shaft.rotateY(Math.PI / 4); shaft.translate(0, baseH + 0.05 + shaftH / 2, 0); parts.push(shaft);
      const nk = cbox(0.26, 0.035, 0.26, 0.003); nk.translate(0, h - 0.105, 0); parts.push(nk);
      const capG = cbox(0.36, 0.07, 0.36, 0.004); capG.translate(0, h - 0.035, 0); parts.push(capG);
    } else if (kind === 'timber') {
      const shaft = cbox(0.19, h - 0.12, 0.19, 0.004); shaft.translate(0, (h - 0.12) / 2 + 0.03, 0); parts.push(shaft);
      const base = cbox(0.26, 0.03, 0.26, 0.003); base.translate(0, 0.015, 0); parts.push(base);
      const capG = cbox(0.27, 0.055, 0.27, 0.004); capG.translate(0, h - 0.0275, 0); parts.push(capG);
      // knee braces + the bolts through them
      for (const sz of [-1, 1]) {
        const br = cbox(0.06, 0.36, 0.36, 0.003);
        br.rotateX(sz * Math.PI / 4);
        br.translate(0, h - 0.3, sz * 0.16);
        parts.push(br);
        parts.push(transformed(screwHead(14), { position: [0.032, h - 0.24, sz * 0.1], rotation: [0, 0, -Math.PI / 2] }));
      }
    } else {
      const base = cbox(0.27, 0.055, 0.27, 0.004); base.translate(0, 0.0275, 0); parts.push(base);
      const plinth = cbox(0.22, 0.09, 0.22, 0.003); plinth.translate(0, 0.1, 0); parts.push(plinth);
      const shaft = cbox(0.16, h - 0.26, 0.16, 0.0025); shaft.translate(0, 0.145 + (h - 0.26) / 2, 0); parts.push(shaft);
      const nk = cbox(0.2, 0.03, 0.2, 0.003); nk.translate(0, h - 0.1, 0); parts.push(nk);
      const capG = cbox(0.25, 0.06, 0.25, 0.004); capG.translate(0, h - 0.03, 0); parts.push(capG);
    }
    return merged(parts);
  });
}

/** Beadboard porch ceiling: a panel with the bead grooves running one way. */
export function beadboardCeiling(w: number, d: number): THREE.BufferGeometry {
  const W = dim(w, 0.3), D = dim(d, 0.3);
  return cachedGeo(`bead|${k(W, 2)}|${k(D, 2)}`, () => {
    const parts: THREE.BufferGeometry[] = [box(W, 0.022, D)];
    const step = 3.5 * IN;
    const n = Math.max(2, Math.min(220, Math.floor(W / step)));
    for (let i = 1; i < n; i++) {
      const b = cyl(0.004, 0.004, D, 6); b.rotateX(Math.PI / 2);
      b.translate(-W / 2 + (W * i) / n, -0.012, 0);
      parts.push(b);
    }
    return merged(parts);
  });
}

/** Deck field as instanced boards + the rim joist frame, so it is 2 draw calls. */
export function deckBoards(w: number, d: number, along: 'x' | 'z'): { board: THREE.BufferGeometry; transforms: InstanceTransform[]; rim: THREE.BufferGeometry } {
  const W = dim(w, 0.4), D = dim(d, 0.4);
  const boardW = 5.5 * IN, gap = 0.005, step = boardW + gap;
  const spanAcross = along === 'x' ? D : W;
  const spanAlong = along === 'x' ? W : D;
  const n = Math.max(1, Math.min(160, Math.floor(spanAcross / step)));
  const board = cachedGeo(`deckboard|${k(spanAlong, 2)}|${along}`, () => {
    const g = fbox(along === 'x' ? spanAlong : boardW, 0.028, along === 'x' ? boardW : spanAlong, 0.004, 2);
    return g;
  });
  const used = n * step - gap;
  const transforms: InstanceTransform[] = [];
  for (let i = 0; i < n; i++) {
    const off = -used / 2 + step * i + boardW / 2;
    transforms.push({ position: along === 'x' ? [0, -0.014, off] : [off, -0.014, 0] });
  }
  const rim = cachedGeo(`deckrim|${k(W, 2)}|${k(D, 2)}`, () => {
    const t = 1.5 * IN, hgt = 0.235;
    const a = cbox(W, hgt, t, 0.002); a.translate(0, -0.145, D / 2 - t / 2);
    const b = a.clone(); b.translate(0, 0, -D + t);
    const c = cbox(t, hgt, D, 0.002); c.translate(W / 2 - t / 2, -0.145, 0);
    const e = c.clone(); e.translate(-W + t, 0, 0);
    return merged([a, b, c, e]);
  });
  return { board, transforms, rim };
}

/** Stair flight with nosed treads, set-back risers and cut stringers. */
export function stairUnit(width: number, totalRise: number, steps: number): THREE.BufferGeometry {
  // Math.max(1, Math.min(9, Math.round(NaN))) is NaN, not 1 — Math.min/max
  // propagate NaN rather than clamping it. A non-finite `steps` (a model that
  // answered null, a spec that lost the field) therefore skipped the tread loop
  // entirely and translated both stringers to z = NaN: a porch with no stairs
  // and a merged geometry whose bounding sphere is NaN, which breaks frustum
  // culling and slot picking for that mesh. clampNum is the guard everything
  // else in the kit already uses.
  const w = dim(width, 0.5), rise = dim(totalRise, 0.05), n = Math.round(clampNum(steps, 1, 9, 1));
  return cachedGeo(`stairx|${k(w, 2)}|${k(rise, 3)}|${n}`, () => {
    const r = rise / n, run = 0.29, nose = 0.028;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const y = -r * (i + 1);
      const z = run * (i + 0.5) + 0.02;
      // two 2×6 treads with a gap, nosed past the riser
      for (const sz of [-1, 1]) {
        const t = fbox(w - 0.06, 0.038, run / 2 - 0.006, 0.004, 2);
        t.translate(0, y + 0.019, z + sz * (run / 4) - nose / 2);
        parts.push(t);
      }
      const riser = cbox(w - 0.08, r - 0.038, 0.019, 0.0018);
      riser.translate(0, y + (r - 0.038) / 2 + 0.019, z - run / 2 + 0.012);
      parts.push(riser);
    }
    for (const sx of [-1, 1]) {
      const str = cbox(0.038, rise + 0.12, run * n + 0.06, 0.0025);
      str.translate(sx * (w / 2 - 0.019), -rise / 2 - 0.06, (run * n) / 2 + 0.02);
      parts.push(str);
    }
    return merged(parts);
  });
}

// ===========================================================================
// 5 · SITE
// ===========================================================================

/**
 * Control joints scored into a concrete slab. Real drives are jointed on a
 * ~5 ft grid; a driveway without them reads as a grey rectangle.
 */
export function controlJoints(w: number, d: number): THREE.BufferGeometry | null {
  const W = dim(w, 0.5), D = dim(d, 0.5);
  return cachedGeo(`joints|${k(W, 2)}|${k(D, 2)}`, () => {
    const spacing = 1.52; // 5 ft
    const parts: THREE.BufferGeometry[] = [];
    const nx = Math.min(40, Math.floor(W / spacing));
    const nz = Math.min(60, Math.floor(D / spacing));
    for (let i = 1; i <= nx; i++) {
      const g = box(0.014, 0.01, D);
      g.translate(-W / 2 + (W * i) / (nx + 1), 0, 0);
      parts.push(g);
    }
    for (let j = 1; j <= nz; j++) {
      const g = box(W, 0.01, 0.014);
      g.translate(0, 0, -D / 2 + (D * j) / (nz + 1));
      parts.push(g);
    }
    // thickened edge so the slab has a visible depth against the lawn
    const edgeA = box(W, 0.055, 0.05); edgeA.translate(0, -0.025, D / 2 - 0.025);
    const edgeB = edgeA.clone(); edgeB.translate(0, 0, -D + 0.05);
    const edgeC = box(0.05, 0.055, D); edgeC.translate(W / 2 - 0.025, -0.025, 0);
    const edgeD = edgeC.clone(); edgeD.translate(-W + 0.05, 0, 0);
    parts.push(edgeA, edgeB, edgeC, edgeD);
    return mergedOrNull(parts) ?? applyWorldUVs(box(0.01, 0.01, 0.01));
  });
}

/** A jointed paver field: one unit paver plus its transforms, running bond. */
export function paverField(w: number, d: number): { paver: THREE.BufferGeometry; transforms: InstanceTransform[] } {
  const W = dim(w, 0.3), D = dim(d, 0.3);
  const pw = 8 * IN, pd = 16 * IN, joint = 0.008;
  const cols = Math.max(1, Math.min(24, Math.round(W / (pw + joint))));
  const rows = Math.max(1, Math.min(90, Math.round(D / (pd + joint))));
  const cw = W / cols, cd = D / rows;
  const paver = cachedGeo(`paver|${k(cw, 3)}|${k(cd, 3)}`, () => fbox(cw - joint, 0.055, cd - joint, 0.005, 2));
  const transforms: InstanceTransform[] = [];
  for (let r = 0; r < rows; r++) {
    const stagger = r % 2 ? cw / 2 : 0;
    for (let c = 0; c <= cols; c++) {
      const x = -W / 2 + cw * (c + 0.5) - stagger;
      if (x < -W / 2 - cw * 0.4 || x > W / 2 + cw * 0.4) continue;
      transforms.push({ position: [x, -0.006, -D / 2 + cd * (r + 0.5)] });
    }
  }
  return { paver, transforms };
}

/** Spade-cut lawn edge around a bed / pad — a thin lip of soil. */
export function bedEdge(w: number, d: number): THREE.BufferGeometry {
  const W = dim(w, 0.3), D = dim(d, 0.3);
  return cachedGeo(`bededge|${k(W, 2)}|${k(D, 2)}`, () => {
    const t = 0.07, h = 0.075;
    const a = cbox(W + t * 2, h, t, 0.004); a.translate(0, h / 2, D / 2 + t / 2);
    const b = a.clone(); b.translate(0, 0, -D - t);
    const c = cbox(t, h, D, 0.004); c.translate(W / 2 + t / 2, h / 2, 0);
    const e = c.clone(); e.translate(-W - t, 0, 0);
    return merged([a, b, c, e]);
  });
}

/** Mulch surface for a planting bed — sits just above grade. */
export function mulchBed(w: number, d: number): THREE.BufferGeometry {
  const W = dim(w, 0.3), D = dim(d, 0.3);
  return cachedGeo(`mulch|${k(W, 2)}|${k(D, 2)}`, () => {
    const g = box(W, 0.05, D); g.translate(0, 0.025, 0);
    return applyWorldUVs(g);
  });
}

/** Neighbour's hedge: a clipped run of overlapping mounds. */
/**
 * Mow stripes: alternating raised bands across the lawn.
 *
 * A lawn rendered as one flat plane is the tell that nobody thought about the
 * ground — every other surface in the scene has relief and the biggest one has
 * none. Real mown grass lies over in bands, and 2 cm of height is enough for
 * the sun and the AO pass to separate them. One merged draw call for the whole
 * lot; the bands run parallel to the street, the way a mower walks a front
 * yard.
 */
export function mowStripes(w: number, d: number, band = 1.6): THREE.BufferGeometry | null {
  const W = dim(w, 1), D = dim(d, 1), B = Math.max(0.6, band);
  const n = Math.floor(D / B);
  if (n < 2) return null;
  return cachedGeo(`mow|${k(W, 1)}|${k(D, 1)}|${k(B, 2)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    // every other band only — the un-raised ones ARE the lawn plane
    for (let i = 0; i < Math.min(n, 120); i += 2) {
      const g = box(W, 0.02, B - 0.03);
      g.translate(0, 0.01, -D / 2 + B * (i + 0.5));
      parts.push(g);
    }
    return merged(parts);
  });
}

export function hedgeGeometry(length: number, height: number): THREE.BufferGeometry {
  const L = dim(length, 0.5), H = dim(height, 0.4);
  return cachedGeo(`hedge|${k(L, 1)}|${k(H, 2)}`, () => {
    const n = Math.max(2, Math.min(60, Math.round(L / 1.1)));
    const parts: THREE.BufferGeometry[] = [];
    const body = box(L, H * 0.86, 0.85); body.translate(0, H * 0.43, 0); parts.push(body);
    for (let i = 0; i < n; i++) {
      const s = new THREE.SphereGeometry(1, 8, 6);
      const r = 0.46 + ((i * 37) % 7) * 0.02;
      s.scale(r, r * 0.7, r);
      s.translate(-L / 2 + (L * (i + 0.5)) / n, H * 0.86, ((i % 2) - 0.5) * 0.16);
      parts.push(s);
    }
    return merged(parts);
  });
}

// ---------------------------------------------------------------------------
// Wall-mounted fittings — the small stuff that sells the shot
// ---------------------------------------------------------------------------

/** Frost-proof hose bib with an escutcheon and a screwed flange. Faces +z. */
export function hoseBib(): THREE.BufferGeometry {
  return cachedGeo('hosebib', () => {
    const flange = ccyl(0.048, 0.012, 0.001, 14); flange.rotateX(Math.PI / 2); flange.translate(0, 0, 0.006);
    const body = ccyl(0.019, 0.09, 0.001, 12); body.rotateX(Math.PI / 2); body.translate(0, 0, 0.055);
    const spout = ccyl(0.013, 0.075, 0.001, 10); spout.rotateX(0.35); spout.translate(0, -0.03, 0.085);
    const wheel = ccyl(0.032, 0.012, 0.001, 14); wheel.translate(0, 0.035, 0.09);
    const stem = cyl(0.008, 0.008, 0.045, 8); stem.translate(0, 0.018, 0.09);
    const parts = [flange, body, spout, wheel, stem];
    for (const a of [0.6, 2.7, 4.8]) parts.push(transformed(screwHead(6), { position: [Math.cos(a) * 0.036, Math.sin(a) * 0.036, 0.012], rotation: [Math.PI / 2, 0, 0] }));
    return merged(parts);
  });
}

/** Electric meter: base, glass dome, and the conduit dropping out of it. */
export function meterBox(): THREE.BufferGeometry {
  return cachedGeo('meterbox', () => {
    const base = fbox(0.21, 0.3, 0.055, 0.01, 2); base.translate(0, 0, 0.028);
    const ring = ccyl(0.085, 0.02, 0.002, 20); ring.rotateX(Math.PI / 2); ring.translate(0, 0.04, 0.065);
    const dome = new THREE.SphereGeometry(0.082, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.rotateX(Math.PI / 2); dome.translate(0, 0.04, 0.07);
    const conduit = ccyl(0.021, 0.5, 0.001, 10); conduit.translate(0, -0.4, 0.03);
    const strap = box(0.07, 0.016, 0.05); strap.translate(0, -0.55, 0.025);
    return merged([base, ring, dome, conduit, strap]);
  });
}

/** Dryer / bath vent hood with a damper flap. Faces +z. */
export function ventHood(): THREE.BufferGeometry {
  return cachedGeo('venthood', () => {
    const plate = cbox(0.13, 0.13, 0.012, 0.0015); plate.translate(0, 0, 0.006);
    const hood = cbox(0.11, 0.085, 0.07, 0.003); hood.rotateX(-0.18); hood.translate(0, 0.012, 0.045);
    const flap = cbox(0.095, 0.075, 0.006, 0.001); flap.rotateX(-0.3); flap.translate(0, -0.024, 0.062);
    const parts = [plate, hood, flap];
    for (const [x, y] of [[-0.05, 0.05], [0.05, 0.05], [-0.05, -0.05], [0.05, -0.05]]) {
      parts.push(transformed(screwHead(5), { position: [x, y, 0.012], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  });
}

/** Gable / foundation louver vent. */
export function louverVent(w = 0.34, h = 0.26): THREE.BufferGeometry {
  return cachedGeo(`louver|${k(w, 2)}|${k(h, 2)}`, () => {
    const frame = cbox(w, h, 0.03, 0.002); frame.translate(0, 0, 0.015);
    const parts: THREE.BufferGeometry[] = [frame];
    const n = Math.max(3, Math.floor((h - 0.05) / 0.038));
    for (let i = 0; i < n; i++) {
      const b = cbox(w - 0.05, 0.02, 0.028, 0.0012);
      b.rotateX(-0.5);
      b.translate(0, -h / 2 + 0.032 + ((h - 0.064) * i) / (n - 1), 0.024);
      parts.push(b);
    }
    return merged(parts);
  });
}

/** Weatherproof exterior outlet with an in-use bubble cover. */
export function extOutlet(): THREE.BufferGeometry {
  return cachedGeo('extoutlet', () => {
    const plate = fbox(0.085, 0.125, 0.012, 0.006, 2); plate.translate(0, 0, 0.006);
    const bubble = fbox(0.075, 0.11, 0.045, 0.01, 2); bubble.translate(0, 0.004, 0.032);
    const hinge = box(0.075, 0.012, 0.02); hinge.translate(0, 0.062, 0.02);
    return merged([plate, bubble, hinge]);
  });
}

/** Lit doorbell button on a small backplate. */
export function doorbellButton(): THREE.BufferGeometry {
  return cachedGeo('doorbell', () => {
    const plate = fbox(0.045, 0.11, 0.01, 0.006, 2); plate.translate(0, 0, 0.005);
    const btn = ccyl(0.012, 0.012, 0.001, 12); btn.rotateX(Math.PI / 2); btn.translate(0, 0.018, 0.014);
    return merged([plate, btn]);
  });
}

/**
 * House numbers: four modern floating digits on standoffs. Digits are built
 * from bars rather than text so no font has to load.
 */
export function houseNumbers(): THREE.BufferGeometry {
  return cachedGeo('housenumbers', () => {
    const parts: THREE.BufferGeometry[] = [];
    const dh = 0.13, dw = 0.072, t = 0.013, z = 0.026;
    // segment layout per digit (7-segment); the four digits spell a plausible
    // street number and read correctly at any angle
    const SEG: Record<string, string[]> = {
      '0': ['a', 'b', 'c', 'd', 'e', 'f'], '1': ['b', 'c'], '4': ['b', 'c', 'f', 'g'],
      '2': ['a', 'b', 'g', 'e', 'd'], '7': ['a', 'b', 'c'],
    };
    const digits = ['2', '4', '1', '7'];
    digits.forEach((d, i) => {
      const ox = -0.16 + i * 0.105;
      for (const s of SEG[d] ?? []) {
        let g: THREE.BufferGeometry;
        if (s === 'a') { g = cbox(dw, t, 0.012, 0.001); g.translate(ox, dh / 2, z); }
        else if (s === 'd') { g = cbox(dw, t, 0.012, 0.001); g.translate(ox, -dh / 2, z); }
        else if (s === 'g') { g = cbox(dw, t, 0.012, 0.001); g.translate(ox, 0, z); }
        else if (s === 'b') { g = cbox(t, dh / 2, 0.012, 0.001); g.translate(ox + dw / 2, dh / 4, z); }
        else if (s === 'c') { g = cbox(t, dh / 2, 0.012, 0.001); g.translate(ox + dw / 2, -dh / 4, z); }
        else if (s === 'e') { g = cbox(t, dh / 2, 0.012, 0.001); g.translate(ox - dw / 2, -dh / 4, z); }
        else { g = cbox(t, dh / 2, 0.012, 0.001); g.translate(ox - dw / 2, dh / 4, z); }
        parts.push(g);
      }
      const stand = cyl(0.005, 0.005, z, 6); stand.rotateX(Math.PI / 2); stand.translate(ox, 0, z / 2);
      parts.push(stand);
    });
    return merged(parts);
  });
}

/** Post-mounted mailbox with a flag, on a 4×4 with a brace. */
export function mailboxGeometry(): THREE.BufferGeometry {
  return cachedGeo('mailbox', () => {
    const post = cbox(0.09, 1.15, 0.09, 0.003); post.translate(0, 0.575, 0);
    const arm = cbox(0.07, 0.06, 0.34, 0.003); arm.translate(0, 1.13, 0.13);
    const brace = cbox(0.05, 0.05, 0.3, 0.003); brace.rotateX(-Math.PI / 4); brace.translate(0, 0.98, 0.11);
    const bodyBase = cbox(0.19, 0.1, 0.44, 0.004); bodyBase.translate(0, 1.21, 0.13);
    const shell = new THREE.CylinderGeometry(0.095, 0.095, 0.44, 14, 1, false, 0, Math.PI);
    shell.rotateZ(Math.PI / 2); shell.rotateY(Math.PI / 2); shell.rotateX(Math.PI / 2);
    shell.translate(0, 1.26, 0.13);
    const door = cbox(0.185, 0.16, 0.012, 0.002); door.translate(0, 1.27, 0.352);
    const flagPost = cyl(0.007, 0.007, 0.14, 6); flagPost.translate(0.1, 1.31, 0.01);
    const flag = cbox(0.012, 0.09, 0.06, 0.002); flag.translate(0.1, 1.37, 0.03);
    return merged([post, arm, brace, bodyBase, shell, door, flagPost, flag]);
  });
}

/** Outdoor condensing unit on a pad, with a fan grille. */
export function acCondenser(): THREE.BufferGeometry {
  return cachedGeo('condenser', () => {
    const pad = cbox(0.85, 0.06, 0.85, 0.004); pad.translate(0, 0.03, 0);
    const body = cbox(0.72, 0.78, 0.72, 0.006); body.translate(0, 0.45, 0);
    const top = cbox(0.76, 0.05, 0.76, 0.005); top.translate(0, 0.86, 0);
    const parts = [pad, body, top];
    // fan grille: concentric rings + spokes
    for (let i = 1; i <= 4; i++) {
      const r = 0.06 + i * 0.055;
      const ring = new THREE.TorusGeometry(r, 0.005, 5, 20);
      ring.rotateX(Math.PI / 2); ring.translate(0, 0.885, 0);
      parts.push(ring);
    }
    for (let i = 0; i < 6; i++) {
      const s = box(0.01, 0.008, 0.5); s.rotateY((i / 6) * Math.PI);
      s.translate(0, 0.885, 0); parts.push(s);
    }
    // fin louvres on two faces
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 14; i++) {
        const f = box(0.68, 0.006, 0.008);
        f.translate(0, 0.16 + i * 0.045, sz * 0.361);
        parts.push(f);
      }
    }
    return merged(parts);
  });
}

/** Small in-grade uplight can with a knuckle and a lens ring. */
export function upLightUnit(): THREE.BufferGeometry {
  return cachedGeo('uplightx', () => {
    const can = ccyl(0.055, 0.12, 0.003, 14); can.translate(0, 0.05, 0);
    const lens = ccyl(0.05, 0.012, 0.002, 14); lens.translate(0, 0.113, 0);
    const stake = cyl(0.012, 0.006, 0.12, 6); stake.translate(0, -0.05, 0);
    return merged([can, lens, stake]);
  });
}

/** Wall lantern: back plate, arm, tapered glass cage, cap and finial. */
export function lanternBody(): THREE.BufferGeometry {
  return cachedGeo('lantern', () => {
    const plate = fbox(0.12, 0.19, 0.022, 0.01, 2); plate.translate(0, 0, 0.011);
    const arm = cbox(0.035, 0.028, 0.1, 0.002); arm.translate(0, 0.085, 0.06);
    const top = cbox(0.17, 0.026, 0.17, 0.003); top.translate(0, 0.135, 0.115);
    const roofCap = new THREE.ConeGeometry(0.115, 0.06, 4); roofCap.rotateY(Math.PI / 4); roofCap.translate(0, 0.172, 0.115);
    const finial = ccyl(0.014, 0.05, 0.002, 8); finial.translate(0, 0.215, 0.115);
    const bot = cbox(0.145, 0.024, 0.145, 0.003); bot.translate(0, -0.085, 0.115);
    const drop = ccyl(0.016, 0.045, 0.002, 8); drop.translate(0, -0.115, 0.115);
    const parts = [plate, arm, top, roofCap, finial, bot, drop];
    for (const [dx, dz] of [[-0.068, 0.047], [0.068, 0.047], [-0.068, 0.183], [0.068, 0.183]]) {
      const p = cbox(0.013, 0.21, 0.013, 0.001); p.translate(dx, 0.024, dz); parts.push(p);
    }
    for (const y of [0.075, -0.075]) parts.push(transformed(screwHead(6), { position: [0, y, 0.023], rotation: [Math.PI / 2, 0, 0] }));
    return merged(parts);
  });
}

// ---------------------------------------------------------------------------
// Trees — a real trunk with taper and branching, and a layered canopy
// ---------------------------------------------------------------------------
export interface TreeParts { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry; height: number; radius: number }

const TREE_SPECS = [
  { h: 6.6, r: 2.5, lobes: 5, taper: 0.55 },
  { h: 4.8, r: 2.0, lobes: 4, taper: 0.5 },
  { h: 8.6, r: 3.0, lobes: 6, taper: 0.6 },
  { h: 3.6, r: 1.6, lobes: 4, taper: 0.45 },
];

export function treeParts(variant: number, quality: 'high' | 'balanced' | 'performance' = 'high'): TreeParts {
  const raw = Number.isFinite(variant) ? Math.round(variant) : 0;
  const v = ((raw % 4) + 4) % 4;
  const spec = TREE_SPECS[v];
  const seg = quality === 'performance' ? 6 : quality === 'balanced' ? 8 : 12;
  const trunk = cachedGeo(`trunkx|${v}|${seg}`, () => {
    const th = spec.h * spec.taper;
    const parts: THREE.BufferGeometry[] = [];
    // tapered trunk in three sections so the silhouette is not a cylinder
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const r = (t: number) => (0.2 + v * 0.018) * (1 - 0.62 * t);
      const s = cyl(r(t1), r(t0), th / steps + 0.005, seg);
      s.translate(0, th * (t0 + t1) / 2, 0);
      parts.push(s);
    }
    const flare = cyl(0.22 + v * 0.015, 0.33 + v * 0.02, 0.3, seg);
    flare.translate(0, 0.15, 0);
    parts.push(flare);
    // primary limbs lifting into the canopy
    const limbs = quality === 'performance' ? 3 : 5;
    for (let i = 0; i < limbs; i++) {
      const a = (i / limbs) * Math.PI * 2 + v;
      const len = spec.h * 0.3;
      const lb = cyl(0.028, 0.075, len, Math.max(5, seg - 4));
      lb.rotateZ(0.6);
      lb.rotateY(a);
      lb.translate(Math.cos(a) * 0.3, th * 0.86 + len * 0.35, Math.sin(a) * 0.3);
      parts.push(lb);
    }
    return merged(parts);
  });
  const canopy = cachedGeo(`canopyx|${v}|${quality}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const base = spec.h * spec.taper * 0.92;
    const wSeg = quality === 'performance' ? 8 : quality === 'balanced' ? 12 : 16;
    const hSeg = quality === 'performance' ? 6 : quality === 'balanced' ? 8 : 11;
    for (let i = 0; i < spec.lobes; i++) {
      const s = new THREE.SphereGeometry(1, wSeg, hSeg);
      const kf = 1 - (i % 3) * 0.19;
      s.scale(spec.r * kf, spec.r * kf * 0.78, spec.r * kf);
      const a = (i / spec.lobes) * Math.PI * 2 + v * 0.7;
      const ring = spec.r * (0.3 + (i % 2) * 0.16);
      s.translate(Math.cos(a) * ring, base + spec.r * (0.42 + (i % 3) * 0.34), Math.sin(a) * ring);
      parts.push(s);
    }
    return merged(parts);
  });
  return { trunk, canopy, height: spec.h, radius: spec.r };
}

/** Foundation shrub: three overlapping mounds so it is not a single ball. */
export function shrubParts(scale: number): THREE.BufferGeometry {
  const s = clampNum(scale, 0.3, 1.6, 1);
  return cachedGeo(`shrubx|${k(s, 2)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const lobes: Array<[number, number, number, number]> = [
      [0, 0.44, 0, 0.62], [0.3, 0.3, -0.18, 0.42], [-0.26, 0.26, 0.2, 0.36],
    ];
    for (const [dx, dy, dz, r] of lobes) {
      const g = new THREE.SphereGeometry(1, 12, 9);
      g.scale(s * r, s * r * 0.82, s * r);
      g.translate(s * dx, s * dy, s * dz);
      parts.push(g);
    }
    return merged(parts);
  });
}

/** Fence: rails + posts as one merged frame, plus pickets to instance. */
export function fenceParts(length: number, height: number): {
  frame: THREE.BufferGeometry;
  picket: THREE.BufferGeometry;
  transforms: InstanceTransform[];
} {
  const L = dim(length, 0.6), H = dim(height, 0.6);
  const bay = 2.44;
  const bays = Math.max(1, Math.min(80, Math.round(L / bay)));
  const seg = L / bays;
  const frame = cachedGeo(`fenceframe|${k(L, 2)}|${k(H, 2)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= bays; i++) {
      const x = -L / 2 + seg * i;
      const p = cbox(0.095, H + 0.14, 0.095, 0.003); p.translate(x, (H + 0.14) / 2, 0);
      const capG = cbox(0.13, 0.045, 0.13, 0.004); capG.translate(x, H + 0.16, 0);
      parts.push(p, capG);
    }
    for (const y of [H - 0.16, H * 0.5, 0.16]) {
      const r = cbox(L, 0.09, 0.038, 0.0025); r.translate(0, y, -0.035);
      parts.push(r);
    }
    const capRail = cbox(L, 0.04, 0.14, 0.003); capRail.translate(0, H + 0.02, 0);
    parts.push(capRail);
    return merged(parts);
  });
  const pw = 5.5 * IN, gap = 0.008;
  const clear = H - 0.03;
  const picket = cachedGeo(`picket|${k(clear, 3)}|${k(pw, 3)}`, () => {
    const body = cbox(pw, clear, 0.019, 0.0016);
    // dog-eared top
    const cut = cbox(pw * 0.42, 0.05, 0.02, 0.0012);
    cut.rotateZ(Math.PI / 4); cut.translate(pw / 2 - 0.01, clear / 2 - 0.01, 0);
    return merged([body, cut]);
  });
  const n = Math.max(2, Math.min(400, Math.floor(L / (pw + gap))));
  const transforms: InstanceTransform[] = [];
  const usable = n * (pw + gap) - gap;
  for (let i = 0; i < n; i++) {
    transforms.push({ position: [-usable / 2 + (pw + gap) * i + pw / 2, 0.02 + clear / 2, 0.012] });
  }
  return { frame, picket, transforms };
}

/** Masonry chimney: shaft with a corbelled cap, clay flues and a crown wash. */
export function chimneyUnit(height: number, w = 0.95, d = 0.75): THREE.BufferGeometry {
  const h = dim(height, 0.8);
  return cachedGeo(`chimneyx|${k(h, 2)}|${k(w, 2)}|${k(d, 2)}`, () => {
    const shaft = cbox(w, h, d, 0.004); shaft.translate(0, h / 2, 0);
    const corbel1 = cbox(w + 0.09, 0.08, d + 0.09, 0.004); corbel1.translate(0, h - 0.2, 0);
    const corbel2 = cbox(w + 0.17, 0.08, d + 0.17, 0.004); corbel2.translate(0, h - 0.12, 0);
    const crown = cbox(w + 0.2, 0.06, d + 0.2, 0.005); crown.rotateX(0); crown.translate(0, h - 0.05, 0);
    const parts = [shaft, corbel1, corbel2, crown];
    for (const sx of [-1, 1]) {
      const flue = cbox(0.2, 0.3, 0.2, 0.003); flue.translate(sx * w * 0.2, h + 0.13, 0);
      const lip = cbox(0.23, 0.03, 0.23, 0.002); lip.translate(sx * w * 0.2, h + 0.29, 0);
      parts.push(flue, lip);
    }
    // counter-flashing where the stack passes the roof
    const flash = box(w + 0.03, 0.1, d + 0.03); flash.translate(0, 0.55, 0);
    parts.push(flash);
    return merged(parts);
  });
}

