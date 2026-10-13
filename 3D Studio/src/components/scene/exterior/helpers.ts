/**
 * Geometry helpers for the exterior / lot builder.
 *
 * EXTERIOR COORDINATE CONVENTION (differs from the interior room frame!)
 * ---------------------------------------------------------------------
 * The LOT is centred at the origin, grade at y = 0, and **+z is the street
 * side (front)**. The house sits `setbackFrontFt` back from the front edge.
 * Building walls face OUTWARD (the camera is outside the house), so we cannot
 * use `wallFrame()` from the shared geometry module — that one points its
 * normal INTO a room. `elevationFrame()` below is its outward-facing twin:
 *
 *   front  z = +d/2, normal +z, local +x → world +x
 *   back   z = -d/2, normal -z, local +x → world -x
 *   left   x = -w/2, normal -x, local +x → world +z
 *   right  x = +w/2, normal +x, local +x → world -z
 *
 * `t ∈ [0,1]` runs left→right AS SEEN BY SOMEONE STANDING OUTSIDE facing that
 * elevation, which is how architectural elevations are read.
 *
 * Every builder returns geometry with world-space UVs (metres) so the shared
 * slot materials tile at their real physical size. Frequently reused pieces
 * are cached at module level so re-renders never rebuild them.
 *
 * NOTE ON ROOFS: the shared `roofGeometry()` is used for flat roofs. Its
 * gable/hip branches produce inverted geometry (the gable slabs rotate the
 * wrong way and float above the mass as a valley; the hip triangles are wound
 * inside-out so every face is back-culled), so `roofSolid()` below builds
 * those from a swept cross-section instead — same inputs, correct solid.
 */
import * as THREE from 'three';
import type { RoofType, Wall } from '@/lib/spec/types';
import { applyWorldUVs, mergeGeometries, roofGeometry } from '@/components/scene/geometry';

export const IN = 0.0254;

/** A horizontal surface with an actual opening, shared by pool coping and grade. */
export function padWithOpening(w: number, d: number, hole?: { cx: number; cz: number; w: number; d: number } | null, thickness = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -d / 2); shape.lineTo(w / 2, -d / 2);
  shape.lineTo(w / 2, d / 2); shape.lineTo(-w / 2, d / 2); shape.closePath();
  if (hole) {
    const p = new THREE.Path();
    // local +y becomes world -z after rotating into the horizontal plane
    const x0 = hole.cx - hole.w / 2, x1 = hole.cx + hole.w / 2;
    const y0 = -hole.cz - hole.d / 2, y1 = -hole.cz + hole.d / 2;
    p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.closePath();
    shape.holes.push(p);
  }
  const g = thickness > 0
    ? new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
    : new THREE.ShapeGeometry(shape);
  if (thickness > 0) g.translate(0, 0, -thickness / 2);
  g.rotateX(-Math.PI / 2);
  return applyWorldUVs(g);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
const cache = new Map<string, THREE.BufferGeometry>();
export function cachedGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = build(); cache.set(key, g); }
  return g;
}

const pos = (v: number) => (Number.isFinite(v) ? Math.max(1e-4, v) : 1e-4);

export function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(pos(w), pos(h), pos(d));
}
export function cyl(rTop: number, rBottom: number, h: number, seg = 16): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(Math.max(1e-4, rTop), Math.max(1e-4, rBottom), pos(h), Math.max(3, seg));
}
/** Merge parts into one draw call and re-derive world UVs. */
export function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const usable = parts.filter(Boolean);
  if (!usable.length) return applyWorldUVs(new THREE.BoxGeometry(0.01, 0.01, 0.01));
  const g = mergeGeometries(usable);
  applyWorldUVs(g);
  return g;
}
/** Flat slab lying on the ground (facing +Y), centred, with world UVs. */
export function pad(w: number, d: number): THREE.BufferGeometry {
  return cachedGeo(`pad|${w.toFixed(3)}|${d.toFixed(3)}`, () => {
    const g = new THREE.PlaneGeometry(pos(w), pos(d));
    g.rotateX(-Math.PI / 2);
    return applyWorldUVs(g);
  });
}
/** Box with world UVs (uncached — call sites vary too much to share). */
export function solid(w: number, h: number, d: number): THREE.BufferGeometry {
  return applyWorldUVs(box(w, h, d));
}

// ---------------------------------------------------------------------------
// Elevation frames
// ---------------------------------------------------------------------------
export interface ElevFrame {
  wall: Wall;
  /** wall-centre in world XZ (grade level) */
  cx: number; cz: number;
  /** Y rotation that maps local +z onto the outward normal */
  yaw: number;
  /** wall length (m) */
  len: number;
  /** outward normal */
  nx: number; nz: number;
}

export function elevationFrame(wall: Wall, w: number, d: number, cx = 0, cz = 0): ElevFrame {
  switch (wall) {
    case 'front': return { wall, cx, cz: cz + d / 2, yaw: 0, len: w, nx: 0, nz: 1 };
    case 'back': return { wall, cx, cz: cz - d / 2, yaw: Math.PI, len: w, nx: 0, nz: -1 };
    case 'left': return { wall, cx: cx - w / 2, cz, yaw: -Math.PI / 2, len: d, nx: -1, nz: 0 };
    default: return { wall, cx: cx + w / 2, cz, yaw: Math.PI / 2, len: d, nx: 1, nz: 0 };
  }
}

/** Wall-local (x along the elevation, y up, z outward) → world. */
export function frameToWorld(f: ElevFrame, lx: number, ly: number, lz: number): [number, number, number] {
  const s = Math.sin(f.yaw), c = Math.cos(f.yaw);
  return [f.cx + lx * c + lz * s, ly, f.cz - lx * s + lz * c];
}

export const OPPOSITE: Record<Wall, Wall> = { front: 'back', back: 'front', left: 'right', right: 'left' };

/** Is this wall perpendicular to the given ridge axis (i.e. a gable end)? */
export function isGableEnd(wall: Wall, ridge: 'x' | 'z'): boolean {
  return ridge === 'x' ? wall === 'left' || wall === 'right' : wall === 'front' || wall === 'back';
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------
export interface RoofShape {
  type: RoofType;
  /** rise per 12 units of run */
  pitch: number;
  /** rise per 1 unit of run */
  slope: number;
  overhang: number;
  ridge: 'x' | 'z';
  /** footprint (no overhang) in metres */
  W: number; D: number;
  /** across-axis span INCLUDING both overhangs */
  across: number;
  /** across-axis span of the STRUCTURE (no overhang) — what sets the ridge */
  structAcross: number;
  /** along-ridge span INCLUDING both overhangs */
  along: number;
  /** wall plate → ridge, metres */
  rise: number;
  /**
   * The ACTUAL fall per metre of the plane that lands on the eave — which is
   * NOT `slope` whenever `rise` was capped for a very steep pitch, and is the
   * lower gambrel slope on a gambrel. Every height query and every trim datum
   * uses this, so the roof underside meets the wall plate exactly.
   */
  eaveSlope: number;
  /**
   * How far the eave edge hangs BELOW the wall plate. A rafter bears on the
   * plate and keeps sloping past it, so the fascia sits `eaveSlope × overhang`
   * below the wall top — that drop is what makes the eave read as an eave
   * instead of a slab flush with the wall.
   */
  eaveDrop: number;
  /** vertical thickness of the roof slab */
  tv: number;
}

const GABLE_TYPES: RoofType[] = ['gable', 'gambrel', 'dutch-gable', 'cross-gable'];

export function makeRoofShape(type: RoofType, pitch: number, overhang: number, ridge: 'x' | 'z', W: number, D: number): RoofShape {
  const oh = Math.max(0, Math.min(overhang, Math.min(W, D) * 0.45));
  const structAcross = ridge === 'x' ? D : W;
  const across = structAcross + oh * 2;
  const along = (ridge === 'x' ? W : D) + oh * 2;
  const slope = type === 'flat' ? 0 : Math.max(0.04, Math.min(pitch, 18) / 12);
  const t = 0.16;
  const tv = type === 'flat' ? 0.2 : Math.min(0.45, t * Math.sqrt(1 + slope * slope));
  // Ridge height comes from the STRUCTURAL span. Deriving it from the
  // overhang-inflated span made the ridge climb every time the eave slider
  // moved — a dimension edit that changed a dimension nobody asked about.
  let rise = 0;
  if (type === 'flat') rise = 0;
  else if (type === 'shed') rise = Math.min(slope * structAcross, structAcross * 0.85);
  else rise = Math.min(slope * (structAcross / 2), structAcross * 0.85);
  // Back the eave slope out of the FITTED rise rather than reusing the nominal
  // pitch: at very steep pitches `rise` is capped, and a gambrel's lower plane
  // is shallower than its pitch. Every datum downstream keys off this.
  const half = Math.max(1e-4, structAcross / 2);
  const eaveSlope = type === 'flat' ? 0
    : type === 'shed' ? rise / Math.max(1e-4, structAcross)
      : type === 'gambrel' ? (rise * 0.62) / Math.max(1e-4, half / 2)
        : rise / half;
  const eaveDrop = eaveSlope * oh;
  return { type, pitch, slope, overhang: oh, ridge, W, D, across, structAcross, along, rise, eaveSlope, eaveDrop, tv };
}

function extrudeProfile(points: Array<[number, number]>, depth: number, rotate: boolean): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: pos(depth), bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  if (rotate) g.rotateY(-Math.PI / 2); // shape +x → world +z, extrusion → world x
  return applyWorldUVs(g);
}

/**
 * Half-length of a hip roof's ridge: the span left over once the two hip ends
 * have eaten in from the short axis. Shared by the shell and by `hipRuns()` so
 * the hip caps land exactly on the hips the shell drew.
 */
function hipRidgeHalf(s: RoofShape): number {
  const W = s.W + s.overhang * 2, D = s.D + s.overhang * 2;
  const ridgeLen = Math.max(0.6, s.ridge === 'x' ? W - D : D - W);
  return Math.min(ridgeLen, s.ridge === 'x' ? W - 0.4 : D - 0.4) / 2;
}

/** Hip roof shell: sloped top faces + flat soffit + eave fascia band. Outward winding. */
function hipSolid(s: RoofShape): THREE.BufferGeometry {
  const W = s.W + s.overhang * 2;
  const D = s.D + s.overhang * 2;
  const drop = -s.eaveDrop;
  const hw = W / 2, hd = D / 2, rise = s.rise, tv = s.tv;
  const rl = hipRidgeHalf(s);
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => { v.push(...a, ...b, ...c); };
  const A = [-hw, drop, -hd], B = [hw, drop, -hd], C = [hw, drop, hd], E = [-hw, drop, hd];
  if (s.ridge === 'x') {
    const r1 = [-rl, rise, 0], r2 = [rl, rise, 0];
    tri(A, r2, B); tri(A, r1, r2);   // back slope  (normal -z, +y)
    tri(C, r1, E); tri(C, r2, r1);   // front slope (normal +z, +y)
    tri(B, r2, C);                   // right hip
    tri(E, r1, A);                   // left hip
  } else {
    const r1 = [0, rise, -rl], r2 = [0, rise, rl];
    tri(B, r2, C); tri(B, r1, r2);   // right slope
    tri(E, r1, A); tri(E, r2, r1);   // left slope
    tri(A, r1, B);                   // back hip
    tri(C, r2, E);                   // front hip
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  top.computeVertexNormals();
  // soffit + fascia band around the eave
  const soffit = new THREE.PlaneGeometry(W, D);
  soffit.rotateX(Math.PI / 2); soffit.translate(0, drop - tv, 0);
  const parts: THREE.BufferGeometry[] = [top, soffit];
  const fasciaFB = box(W, tv, 0.02);
  const f1 = fasciaFB.clone(); f1.translate(0, drop - tv / 2, hd - 0.01);
  const f2 = fasciaFB.clone(); f2.translate(0, drop - tv / 2, -hd + 0.01);
  const fasciaLR = box(0.02, tv, D);
  const f3 = fasciaLR.clone(); f3.translate(hw - 0.01, drop - tv / 2, 0);
  const f4 = fasciaLR.clone(); f4.translate(-hw + 0.01, drop - tv / 2, 0);
  parts.push(f1, f2, f3, f4);
  return merged(parts);
}

/**
 * Roof solid for a mass. Origin at the footprint centre; the EAVE LINE sits at
 * y = 0 and the slab hangs down to y = -tv, so a caller places it at the top
 * of the walls. Overhang is already baked in.
 */
export function roofSolid(s: RoofShape): THREE.BufferGeometry {
  const key = `roof|${s.type}|${s.W.toFixed(3)}|${s.D.toFixed(3)}|${s.pitch}|${s.overhang.toFixed(3)}|${s.ridge}`;
  return cachedGeo(key, () => {
    const A = s.across, R = s.rise, tv = s.tv, E = -s.eaveDrop;
    if (s.type === 'flat') {
      // the shared helper is correct for flat roofs — reuse it, then drop the
      // slab so its top face lands on the eave line like every other type.
      const g = roofGeometry({ w: s.W, d: s.D, pitch: 0, type: 'flat', overhang: s.overhang, ridge: s.ridge, thickness: tv });
      g.translate(0, -tv, 0);
      return applyWorldUVs(g);
    }
    if (s.type === 'shed') {
      // the high edge climbs past the plate by the same drop the low edge falls
      return extrudeProfile([[-A / 2, R - E], [A / 2, E], [A / 2, E - tv], [-A / 2, R - E - tv]], s.along, s.ridge === 'x');
    }
    if (s.type === 'hip') return hipSolid(s);
    if (s.type === 'gambrel') {
      const kx = s.structAcross / 4, ky = R * 0.62;
      return extrudeProfile(
        [[-A / 2, E], [-kx, ky], [0, R], [kx, ky], [A / 2, E], [A / 2, E - tv], [kx, ky - tv], [0, R - tv], [-kx, ky - tv], [-A / 2, E - tv]],
        s.along, s.ridge === 'x',
      );
    }
    // gable / dutch-gable / cross-gable → symmetric chevron
    return extrudeProfile([[-A / 2, E], [0, R], [A / 2, E], [A / 2, E - tv], [0, R - tv], [-A / 2, E - tv]], s.along, s.ridge === 'x');
  });
}

/** Height of the roof's UNDERSIDE at a distance `a` from the roof centre along the across-axis. */
export function roofUndersideAt(s: RoofShape, a: number): number {
  if (s.type === 'flat') return -s.tv;
  // Every branch is written so that at the WALL LINE (|a| = structAcross/2) the
  // underside lands on y = -tv, i.e. flush with the plate; past that it drops
  // into the overhang. That invariant is what lets the gable-end panel meet the
  // roof exactly and the fascia sit at the right height.
  if (s.type === 'shed') return s.rise / 2 - a * s.eaveSlope - s.tv;
  if (s.type === 'gambrel') {
    // knee at a quarter of the STRUCTURAL span; the lower plane keeps falling
    // past the wall line at `eaveSlope`, which is what carries the overhang
    const half = s.structAcross / 2, kneeA = half / 2, kneeY = s.rise * 0.62;
    const d = Math.abs(a);
    const y = d <= kneeA
      ? s.rise - (s.rise - kneeY) * (d / Math.max(1e-4, kneeA))
      : kneeY - (d - kneeA) * s.eaveSlope;
    return y - s.tv;
  }
  return s.rise - Math.abs(a) * s.eaveSlope - s.tv;
}

/**
 * Polygon (wall-local x, y above the eave line) filling the wall between the
 * eave and the roof underside — the gable-end triangle, the tall wall under a
 * shed, etc. `flip` mirrors the across-axis for walls whose local +x runs
 * opposite the roof's across-axis. Returns null when the wall stops at the eave.
 */
export function wallTopProfile(s: RoofShape, wall: Wall, wallLen: number, flip: boolean): Array<[number, number]> | null {
  if (s.type === 'flat' || s.type === 'hip') return null;
  const half = wallLen / 2;
  const gableWall = isGableEnd(wall, s.ridge);
  const eps = 0.004;
  if (s.type === 'shed') {
    if (gableWall) {
      // wall runs along the slope → trapezoid
      const yl = roofUndersideAt(s, flip ? half : -half);
      const yr = roofUndersideAt(s, flip ? -half : half);
      if (yl < 0.03 && yr < 0.03) return null;
      return [[-half, 0], [half, 0], [half, Math.max(eps, yr)], [-half, Math.max(eps, yl)]];
    }
    // wall parallel to the ridge → flat top at the local eave height
    const isHigh = s.ridge === 'x' ? wall === 'back' : wall === 'left';
    const y = roofUndersideAt(s, isHigh ? -(s.ridge === 'x' ? s.D : s.W) / 2 : (s.ridge === 'x' ? s.D : s.W) / 2);
    if (y < 0.03) return null;
    return [[-half, 0], [half, 0], [half, y], [-half, y]];
  }
  if (!gableWall || !GABLE_TYPES.includes(s.type)) return null;
  const yEdge = Math.max(0, roofUndersideAt(s, half));
  const yApex = Math.max(eps, roofUndersideAt(s, 0));
  if (s.type === 'gambrel') {
    const k = Math.min(half, s.structAcross / 4);
    const yK = Math.max(0, roofUndersideAt(s, k));
    return [[-half, 0], [half, 0], [half, yEdge], [k, yK], [0, yApex], [-k, yK], [-half, yEdge]];
  }
  return [[-half, 0], [half, 0], [half, yEdge], [0, yApex], [-half, yEdge]];
}

/** Vertical panel (facing +z) from an arbitrary polygon, with optional rectangular holes. */
export function polyPanel(points: Array<[number, number]>, holes: Array<{ x: number; y: number; w: number; h: number }> = []): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  for (const ho of holes) {
    if (ho.w < 0.05 || ho.h < 0.05) continue;
    const p = new THREE.Path();
    p.moveTo(ho.x - ho.w / 2, ho.y); p.lineTo(ho.x + ho.w / 2, ho.y);
    p.lineTo(ho.x + ho.w / 2, ho.y + ho.h); p.lineTo(ho.x - ho.w / 2, ho.y + ho.h);
    p.closePath();
    shape.holes.push(p);
  }
  return applyWorldUVs(new THREE.ShapeGeometry(shape, 1));
}

/** Eave runs of a roof, in roof-local coords (y = 0 at the eave line). */
export interface EaveRun { cx: number; cz: number; yaw: number; length: number }
export function eaveRuns(s: RoofShape): EaveRun[] {
  const W = s.W + s.overhang * 2, D = s.D + s.overhang * 2;
  const front: EaveRun = { cx: 0, cz: D / 2, yaw: 0, length: W };
  const back: EaveRun = { cx: 0, cz: -D / 2, yaw: Math.PI, length: W };
  const right: EaveRun = { cx: W / 2, cz: 0, yaw: Math.PI / 2, length: D };
  const left: EaveRun = { cx: -W / 2, cz: 0, yaw: -Math.PI / 2, length: D };
  if (s.type === 'flat' || s.type === 'hip') return [front, back, right, left];
  if (s.type === 'shed') return s.ridge === 'x' ? [front] : [right];
  return s.ridge === 'x' ? [front, back] : [right, left];
}

/** A sloping trim line on a roof plane (a rake, a hip), in roof-local coords. */
export interface SlopeRun {
  from: [number, number, number];
  to: [number, number, number];
  length: number;
}

/**
 * The four HIP lines of a hip roof — eave corner up to the nearer ridge end.
 *
 * A hip roof with no hip caps is the giveaway that nobody modelled the roof:
 * the ridge gets its cap, the four corners that actually catch the light get
 * nothing, and the whole thing reads as a folded sheet. Empty for every other
 * roof type, which have rakes instead (`rakeRuns`).
 */
export function hipRuns(s: RoofShape): SlopeRun[] {
  if (s.type !== 'hip') return [];
  const W = s.W + s.overhang * 2, D = s.D + s.overhang * 2;
  const hw = W / 2, hd = D / 2, drop = -s.eaveDrop, rl = hipRidgeHalf(s);
  const corners: Array<[number, number]> = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  return corners.map(([x, z]) => {
    // each corner runs to the ridge end on its own side of centre
    const to: [number, number, number] = s.ridge === 'x'
      ? [Math.sign(x) * rl, s.rise, 0]
      : [0, s.rise, Math.sign(z) * rl];
    const from: [number, number, number] = [x, drop, z];
    return { from, to, length: Math.hypot(to[0] - x, to[1] - drop, to[2] - z) };
  });
}

/** Ridge line of a gable-family roof in roof-local coords, or null. */
export function ridgeRun(s: RoofShape): { length: number; yaw: number; y: number } | null {
  if (s.type === 'flat' || s.type === 'shed') return null;
  if (s.type === 'hip') {
    const W = s.W + s.overhang * 2, D = s.D + s.overhang * 2;
    const len = Math.max(0.6, s.ridge === 'x' ? W - D : D - W);
    return { length: Math.min(len, s.ridge === 'x' ? W : D), yaw: s.ridge === 'x' ? 0 : Math.PI / 2, y: s.rise };
  }
  return { length: s.along, yaw: s.ridge === 'x' ? 0 : Math.PI / 2, y: s.rise };
}

// ---------------------------------------------------------------------------
// Trim, gutters, hardware
// ---------------------------------------------------------------------------
/** Deterministic pseudo-random in [0,1) from an integer seed — stable across renders. */
export function hash01(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
