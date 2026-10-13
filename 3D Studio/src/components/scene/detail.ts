'use client';
/**
 * detail.ts — the shared DETAIL KIT.
 *
 * The single biggest reason a procedural room reads as fake is that every edge
 * is a perfect 90° and every surface is one flat rectangle. Real millwork has
 * a 1–2 mm chamfer that catches a specular line, a 3 mm reveal between doors,
 * a swept profile on every piece of trim, and hardware with real proportions.
 * This module ships those pieces so the kitchen / bathroom / exterior builders
 * never have to reach for `new THREE.BoxGeometry` again.
 *
 * CONTRACT
 * - Every builder returns a CACHED, SHARED `THREE.BufferGeometry`. Never mutate
 *   what you get back — clone it first (`transformed()` does that for you).
 * - Every returned geometry carries world-space (metre) UVs via `applyWorldUVs`,
 *   so catalog materials tile at their real physical size on it.
 * - All dimensions are METRES unless the argument name ends in `Mm` / `In`.
 * - Nothing throws. Every numeric input is clamped to something buildable.
 *
 * PERFORMANCE
 * - Cache keys are built from the rounded parameters, so 40 identical drawer
 *   fronts share one geometry (and therefore one GPU upload).
 * - Anything repeated more than ~8 times should go through `instanced()`, which
 *   bakes the matrices into an InstancedMesh — 200 balusters for one draw call.
 * - `triangleCount()` lets a builder budget before it commits.
 */
import * as THREE from 'three';
import { applyWorldUVs, mergeGeometries } from './geometry';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface InstanceTransform {
  /** defaults to the origin */
  position?: Vec3;
  /** Euler XYZ radians */
  rotation?: Vec3;
  scale?: Vec3 | number;
}

// ---------------------------------------------------------------------------
// Guards + cache
// ---------------------------------------------------------------------------

/** Model-generated numbers land here. Never let a NaN or a negative reach three. */
export function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = build(); g.userData.detailKey = key; cache.set(key, g); }
  return g;
}
const k = (n: number) => n.toFixed(4);

/** Triangles a geometry costs. Cheap enough to call in a builder's budget check. */
export function triangleCount(g: THREE.BufferGeometry): number {
  const idx = g.getIndex();
  if (idx) return idx.count / 3;
  const pos = g.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

/** Total triangles across a list (for scene budgeting). */
export function triangleBudget(geos: THREE.BufferGeometry[]): number {
  return geos.reduce((n, g) => n + triangleCount(g), 0);
}

/** Merge into one draw call, re-projecting UVs unless the stock has authored grain axes. */
export function mergeDetail(geos: THREE.BufferGeometry[], preserveUVs = false): THREE.BufferGeometry {
  const parts = geos.filter((g) => g && g.getAttribute('position') && g.getAttribute('position').count > 0);
  if (parts.length === 0) return applyWorldUVs(new THREE.BoxGeometry(0.001, 0.001, 0.001));
  if (parts.length === 1) return preserveUVs ? parts[0].clone() : applyWorldUVs(parts[0].clone());
  const merged = mergeGeometries(parts, preserveUVs);
  if (!preserveUVs) applyWorldUVs(merged);
  return merged;
}

/** A transformed CLONE of `g` — safe to merge with others. */
export function transformed(g: THREE.BufferGeometry, t: InstanceTransform): THREE.BufferGeometry {
  const out = g.clone();
  const m = new THREE.Matrix4();
  const s = typeof t.scale === 'number' ? [t.scale, t.scale, t.scale] as Vec3 : (t.scale ?? [1, 1, 1]);
  const pos = t.position ?? [0, 0, 0];
  m.compose(
    new THREE.Vector3(pos[0] || 0, pos[1] || 0, pos[2] || 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(t.rotation ?? [0, 0, 0]))),
    new THREE.Vector3(...s),
  );
  out.applyMatrix4(m);
  return out;
}

/**
 * One InstancedMesh with the matrices baked — 200 balusters, 60 shingles or
 * 40 drawer pulls for a single draw call. The matrices are written once; there
 * is no per-frame work and no per-frame allocation.
 */
export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: InstanceTransform[],
): THREE.InstancedMesh {
  const n = Math.max(1, transforms.length);
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i];
    const tp = t.position ?? [0, 0, 0];
    p.set(tp[0] || 0, tp[1] || 0, tp[2] || 0);
    const r = t.rotation ?? [0, 0, 0];
    e.set(r[0] || 0, r[1] || 0, r[2] || 0);
    q.setFromEuler(e);
    if (typeof t.scale === 'number') sc.setScalar(t.scale || 1);
    else if (t.scale) sc.set(t.scale[0] || 1, t.scale[1] || 1, t.scale[2] || 1);
    else sc.set(1, 1, 1);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
  }
  if (transforms.length === 0) mesh.setMatrixAt(0, m.identity().makeScale(0, 0, 0));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// The workhorses: chamfered and filleted boxes
// ---------------------------------------------------------------------------

/** Extrude a 2D outline (w along X, d along Y in shape space) into a solid h tall. */
function extrudeSolid(shape: THREE.Shape, h: number, bevel: number, bevelSegments: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0002, h - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: Math.max(1, bevelSegments),
    steps: 1,
    curveSegments: 4,
  });
  g.rotateX(-Math.PI / 2);          // shape XY → world XZ, extrusion → +Y
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (bb) g.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
  return g;
}

function chamferShape(w: number, d: number, c: number): THREE.Shape {
  const hw = w / 2, hd = d / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + c, -hd);
  s.lineTo(hw - c, -hd); s.lineTo(hw, -hd + c);
  s.lineTo(hw, hd - c); s.lineTo(hw - c, hd);
  s.lineTo(-hw + c, hd); s.lineTo(-hw, hd - c);
  s.lineTo(-hw, -hd + c); s.closePath();
  return s;
}

function filletShape(w: number, d: number, r: number): THREE.Shape {
  const hw = w / 2, hd = d / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hd);
  s.lineTo(hw - r, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + r);
  s.lineTo(hw, hd - r); s.quadraticCurveTo(hw, hd, hw - r, hd);
  s.lineTo(-hw + r, hd); s.quadraticCurveTo(-hw, hd, -hw, hd - r);
  s.lineTo(-hw, -hd + r); s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  return s;
}

/**
 * A box with every edge cut back by `chamfer`. This is THE realism primitive:
 * a 1–2 mm chamfer on a cabinet door, drawer front, counter or trim piece
 * catches a specular highlight along every edge, which is most of what makes a
 * render read as a photograph instead of a massing model.
 *
 * ~60 triangles (vs 12 for a BoxGeometry) — budget accordingly on huge runs.
 * w along X, h along Y, d along Z, centred at the origin.
 */
export function chamferBox(w: number, h: number, d: number, chamfer = 0.0015): THREE.BufferGeometry {
  const W = clampNum(w, 0.001, 60, 0.5);
  const H = clampNum(h, 0.001, 60, 0.5);
  const D = clampNum(d, 0.001, 60, 0.5);
  // W/5 (not W/2.5) because the shape is drawn 2c smaller — see below
  const c = Math.max(0, Math.min(clampNum(chamfer, 0, 0.2, 0.0015), W / 5, H / 2.5, D / 5));
  const key = `cbx|${k(W)}|${k(H)}|${k(D)}|${k(c)}`;
  return cached(key, () => {
    if (c <= 0.00005) return applyWorldUVs(new THREE.BoxGeometry(W, H, D));
    // ExtrudeGeometry's `bevelSize` grows the section OUTWARD, so extruding the
    // full-size outline returned a box (W + 2c) × H × (D + 2c) — the chamfer was
    // added, not cut back. Measured, that closed every reveal in the room: two
    // shaker doors 3 mm apart drew 2.8 mm of chamfer into the gap and left
    // 0.2 mm, and two slab fronts (c = 1.8 mm) OVERLAPPED by 0.6 mm. Drawing the
    // outline 2c smaller lets the bevel grow it back to exactly W × H × D.
    const g = extrudeSolid(chamferShape(W - 2 * c, D - 2 * c, c), H, c, 1);
    return applyWorldUVs(g);
  });
}

/**
 * A box with rounded edges. Use for pulls, tub rims, soft-modern slab doors,
 * anything moulded rather than machined. `segments` 2 reads as a real radius
 * and stays cheap; 3–4 for hero close-ups only.
 */
export function filletBox(w: number, h: number, d: number, radius = 0.004, segments = 2): THREE.BufferGeometry {
  const W = clampNum(w, 0.001, 60, 0.5);
  const H = clampNum(h, 0.001, 60, 0.5);
  const D = clampNum(d, 0.001, 60, 0.5);
  const r = Math.max(0, Math.min(clampNum(radius, 0, 0.5, 0.004), W / 5, H / 2.2, D / 5));
  const seg = Math.round(clampNum(segments, 1, 6, 2));
  const key = `fbx|${k(W)}|${k(H)}|${k(D)}|${k(r)}|${seg}`;
  return cached(key, () => {
    if (r <= 0.00005) return applyWorldUVs(new THREE.BoxGeometry(W, H, D));
    // drawn 2r smaller so the bevel grows it back to nominal — see chamferBox
    const g = extrudeSolid(filletShape(W - 2 * r, D - 2 * r, r), H, r, seg);
    return applyWorldUVs(g);
  });
}

/** Cylinder with chamfered (broken) ends — how a real turned metal part looks. */
export function chamferCylinder(radius: number, height: number, chamfer = 0.0006, segments = 16): THREE.BufferGeometry {
  const R = clampNum(radius, 0.0005, 5, 0.01);
  const H = clampNum(height, 0.0005, 20, 0.05);
  const c = Math.min(clampNum(chamfer, 0, 0.05, 0.0006), R / 3, H / 3);
  const seg = Math.round(clampNum(segments, 6, 48, 16));
  const key = `ccy|${k(R)}|${k(H)}|${k(c)}|${seg}`;
  return cached(key, () => {
    if (c <= 0.00002) return applyWorldUVs(new THREE.CylinderGeometry(R, R, H, seg));
    return applyWorldUVs(lathePoints([
      [0, -H / 2],
      [R - c, -H / 2],
      [R, -H / 2 + c],
      [R, H / 2 - c],
      [R - c, H / 2],
      [0, H / 2],
    ], seg));
  });
}

// ---------------------------------------------------------------------------
// Sweep engine + millwork profiles
// ---------------------------------------------------------------------------

/**
 * Sweep a 2D profile along a 3D path.
 *
 * The profile is drawn in the plane spanned by `right = normalize(cross(dir, up))`
 * (profile X) and `up` (profile Y), so for a path running along +X with up = +Y
 * the profile's +X points at +Z. Interior corners are MITRED: the ring is built
 * on the bisector and widened by 1/cos(halfAngle), so a crown running around a
 * room keeps a constant section through every corner instead of pinching.
 *
 * Normals are computed per profile SEGMENT (flat across the segment, smooth
 * along the sweep) — which is exactly how milled trim catches light. Give a
 * curved section 4–6 points and the facets disappear.
 */
export function sweepProfile(
  profile: Vec2[],
  path: Vec3[],
  opts: { closed?: boolean; up?: Vec3; caps?: boolean } = {},
): THREE.BufferGeometry {
  const pts = path.filter((p) => Array.isArray(p) && p.every((n) => Number.isFinite(n)));
  const prof = profile.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2 || prof.length < 2) return applyWorldUVs(new THREE.BoxGeometry(0.001, 0.001, 0.001));
  const closed = opts.closed === true;
  const up = new THREE.Vector3(...(opts.up ?? [0, 1, 0])).normalize();

  const P = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const n = P.length;
  const segCount = closed ? n : n - 1;

  // per-segment direction
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const d = new THREE.Vector3().subVectors(b, a);
    if (d.lengthSq() < 1e-12) d.set(1, 0, 0);
    dirs.push(d.normalize());
  }

  const rightOf = (dir: THREE.Vector3) => {
    const r = new THREE.Vector3().crossVectors(dir, up);
    if (r.lengthSq() < 1e-10) r.crossVectors(dir, new THREE.Vector3(0, 0, 1));
    if (r.lengthSq() < 1e-10) r.set(1, 0, 0);
    return r.normalize();
  };

  // per-vertex mitred frame
  const frames: Array<{ o: THREE.Vector3; right: THREE.Vector3; upv: THREE.Vector3 }> = [];
  for (let i = 0; i < n; i++) {
    const dIn = closed ? dirs[(i - 1 + segCount) % segCount] : dirs[Math.max(0, i - 1)];
    const dOut = closed ? dirs[i % segCount] : dirs[Math.min(segCount - 1, i)];
    const rIn = rightOf(dIn), rOut = rightOf(dOut);
    const bis = new THREE.Vector3().addVectors(rIn, rOut);
    if (bis.lengthSq() < 1e-10) bis.copy(rOut);
    bis.normalize();
    const cosHalf = Math.max(0.25, bis.dot(rOut));
    frames.push({ o: P[i].clone(), right: bis.multiplyScalar(1 / cosHalf), upv: up.clone() });
  }

  const ringPoint = (fi: number, pi: number, out: THREE.Vector3) => {
    const f = frames[fi];
    const p = prof[pi];
    return out.copy(f.o).addScaledVector(f.right, p[0]).addScaledVector(f.upv, p[1]);
  };

  const verts: number[] = [];
  const norms: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), dd = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const pushTri = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
    e1.subVectors(p1, p0); e2.subVectors(p2, p0);
    nrm.crossVectors(e1, e2);
    if (nrm.lengthSq() < 1e-16) return;
    nrm.normalize();
    verts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    for (let t = 0; t < 3; t++) norms.push(nrm.x, nrm.y, nrm.z);
  };

  const profSegs = closedProfile(prof) ? prof.length : prof.length - 1;
  for (let s = 0; s < segCount; s++) {
    const i0 = s, i1 = (s + 1) % n;
    for (let p = 0; p < profSegs; p++) {
      const p0 = p, p1 = (p + 1) % prof.length;
      ringPoint(i0, p0, a); ringPoint(i0, p1, b);
      ringPoint(i1, p0, c); ringPoint(i1, p1, dd);
      pushTri(a, c, dd);
      pushTri(a, dd, b);
    }
  }

  if (opts.caps !== false && !closed) {
    const capPts = prof.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(capPts, []);
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    for (const t of tris) {
      ringPoint(0, t[0], v0); ringPoint(0, t[1], v1); ringPoint(0, t[2], v2);
      pushTri(v0, v2, v1);
      ringPoint(n - 1, t[0], v0); ringPoint(n - 1, t[1], v1); ringPoint(n - 1, t[2], v2);
      pushTri(v0, v1, v2);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  applyWorldUVs(g);
  return g;
}

/** A profile whose first and last points coincide is treated as a closed loop. */
function closedProfile(prof: Vec2[]): boolean {
  const a = prof[0], b = prof[prof.length - 1];
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

export type ProfileName =
  | 'ogee-crown' | 'cove-crown' | 'crown-simple' | 'stepped-crown'
  | 'colonial-base' | 'modern-base' | 'craftsman-base'
  | 'colonial-casing' | 'craftsman-casing' | 'modern-casing'
  | 'chair-rail' | 'quarter-round' | 'shoe' | 'scotia' | 'panel-bead' | 'half-round'
  | 'counter-eased' | 'counter-bullnose' | 'counter-ogee' | 'counter-bevel' | 'counter-mitered'
  | 'brickmould' | 'water-table' | 'apron' | 'shiplap' | 'toe-kick' | 'light-rail' | 'stair-nosing';

/**
 * Real millwork sections, in METRES, drawn as a closed loop.
 *
 * Convention: profile +X points AWAY from the wall (into the room), +Y points
 * up. The back face sits at x = 0 and the bottom at y = 0 for wall trim; the
 * counter-edge profiles are drawn with x = 0 at the counter face and y = 0 at
 * the counter's top surface so they can be applied to any slab thickness.
 */
export const PROFILES: Record<ProfileName, Vec2[]> = {
  // --- crown (a 3-5/8" crown springs off the wall and returns to the ceiling)
  'ogee-crown': [
    [0, 0], [0, 0.092], [0.012, 0.092], [0.022, 0.083], [0.030, 0.070],
    [0.036, 0.055], [0.046, 0.044], [0.056, 0.030], [0.062, 0.014],
    [0.064, 0.004], [0.058, 0], [0, 0],
  ],
  'cove-crown': [
    [0, 0], [0, 0.086], [0.010, 0.086], [0.020, 0.078], [0.032, 0.064],
    [0.043, 0.046], [0.051, 0.026], [0.055, 0.006], [0.049, 0], [0, 0],
  ],
  'crown-simple': [
    [0, 0], [0, 0.070], [0.010, 0.070], [0.048, 0.012], [0.048, 0], [0, 0],
  ],
  'stepped-crown': [
    [0, 0], [0, 0.108], [0.018, 0.108], [0.018, 0.092], [0.034, 0.092],
    [0.034, 0.074], [0.048, 0.062], [0.056, 0.042], [0.060, 0.018],
    [0.060, 0], [0, 0],
  ],
  // --- base (3-1/4" colonial, 5-1/4" modern, 5-1/2" craftsman)
  'colonial-base': [
    [0, 0], [0.017, 0], [0.017, 0.052], [0.014, 0.060], [0.017, 0.068],
    [0.012, 0.076], [0.010, 0.083], [0, 0.083], [0, 0],
  ],
  'modern-base': [
    [0, 0], [0.016, 0], [0.016, 0.128], [0.011, 0.133], [0, 0.133], [0, 0],
  ],
  'craftsman-base': [
    [0, 0], [0.019, 0], [0.019, 0.126], [0.026, 0.126], [0.026, 0.133],
    [0.019, 0.140], [0, 0.140], [0, 0],
  ],
  // --- casing (around doors and windows; y is "across the casing", x is proud of the wall)
  'colonial-casing': [
    [0, 0], [0.014, 0], [0.017, 0.010], [0.014, 0.022], [0.017, 0.034],
    [0.012, 0.046], [0.014, 0.056], [0.008, 0.064], [0, 0.064], [0, 0],
  ],
  'craftsman-casing': [
    [0, 0], [0.019, 0], [0.019, 0.086], [0, 0.086], [0, 0],
  ],
  'modern-casing': [
    [0, 0], [0.012, 0], [0.012, 0.048], [0, 0.048], [0, 0],
  ],
  // --- small trim
  'chair-rail': [
    [0, 0], [0.014, 0], [0.020, 0.010], [0.016, 0.024], [0.022, 0.036],
    [0.016, 0.050], [0.010, 0.060], [0, 0.060], [0, 0],
  ],
  'quarter-round': [
    [0, 0], [0.019, 0], [0.0176, 0.0073], [0.0134, 0.0134], [0.0073, 0.0176],
    [0, 0.019], [0, 0],
  ],
  'shoe': [
    [0, 0], [0.012, 0], [0.0115, 0.0060], [0.0090, 0.0120], [0.0050, 0.0170],
    [0, 0.019], [0, 0],
  ],
  'scotia': [
    [0, 0], [0.019, 0], [0.019, 0.004], [0.013, 0.008], [0.008, 0.013],
    [0.004, 0.019], [0, 0.019], [0, 0],
  ],
  'panel-bead': [
    [0, 0], [0.008, 0], [0.0074, 0.0031], [0.0057, 0.0057], [0.0031, 0.0074],
    [0, 0.008], [0, 0],
  ],
  'half-round': [
    [0, 0], [0.006, 0.002], [0.009, 0.006], [0.009, 0.013], [0.006, 0.017],
    [0, 0.019], [0, 0],
  ],
  // --- countertop edges. x = proud of the cabinet face, y = 0 at the slab top,
  //     dropping to -thickness. Callers pass the slab thickness via `edgeProfile`.
  'counter-eased': [
    [0, 0], [0.0015, -0.0005], [0.002, -0.0015], [0.002, -0.028],
    [0.0015, -0.0295], [0, -0.030], [0, 0],
  ],
  'counter-bullnose': [
    [0, 0], [0.008, -0.002], [0.013, -0.006], [0.015, -0.012], [0.015, -0.018],
    [0.013, -0.024], [0.008, -0.028], [0, -0.030], [0, 0],
  ],
  'counter-ogee': [
    [0, 0], [0.006, -0.001], [0.011, -0.004], [0.013, -0.009], [0.010, -0.014],
    [0.006, -0.018], [0.008, -0.023], [0.013, -0.026], [0.014, -0.030],
    [0, -0.030], [0, 0],
  ],
  'counter-bevel': [
    [0, 0], [0.006, -0.006], [0.006, -0.024], [0, -0.030], [0, 0],
  ],
  'counter-mitered': [
    [0, 0], [0.002, -0.001], [0.002, -0.049], [0.001, -0.050], [0, -0.050], [0, 0],
  ],
  // --- exterior
  'brickmould': [
    [0, 0], [0.032, 0], [0.032, 0.014], [0.026, 0.024], [0.028, 0.036],
    [0.020, 0.046], [0.010, 0.050], [0, 0.050], [0, 0],
  ],
  'water-table': [
    [0, 0], [0.038, 0], [0.038, 0.010], [0.030, 0.020], [0.022, 0.026],
    [0.022, 0.140], [0, 0.140], [0, 0],
  ],
  'apron': [
    [0, 0], [0.022, 0], [0.022, 0.062], [0.014, 0.070], [0, 0.070], [0, 0],
  ],
  'shiplap': [
    [0, 0], [0.017, 0], [0.017, 0.130], [0.010, 0.130], [0.010, 0.140],
    [0, 0.140], [0, 0],
  ],
  'toe-kick': [
    [0, 0], [0.006, 0], [0.006, 0.114], [0, 0.114], [0, 0],
  ],
  'light-rail': [
    [0, 0], [0.028, 0], [0.028, 0.020], [0.022, 0.028], [0.012, 0.034],
    [0, 0.034], [0, 0],
  ],
  'stair-nosing': [
    [0, 0], [0.030, 0], [0.032, -0.006], [0.030, -0.014], [0.022, -0.019],
    [0, -0.019], [0, 0],
  ],
};

export interface MouldingOptions {
  closed?: boolean;
  up?: Vec3;
  caps?: boolean;
  /** uniform scale applied to the profile (1 = real millwork size) */
  scale?: number;
  /** mirror the profile across X (trim that faces the other way) */
  flipX?: boolean;
  /** mirror the profile across Y (base → crown) */
  flipY?: boolean;
  /** shift the profile in its own plane before sweeping */
  offset?: Vec2;
}

/** Sweep a named (or literal) millwork section along a path. Cached by shape. */
export function profileMoulding(path: Vec3[], profile: ProfileName | Vec2[], opts: MouldingOptions = {}): THREE.BufferGeometry {
  const base = Array.isArray(profile) ? profile : (PROFILES[profile] ?? PROFILES['modern-base']);
  const s = clampNum(opts.scale ?? 1, 0.05, 20, 1);
  const fx = opts.flipX ? -1 : 1;
  const fy = opts.flipY ? -1 : 1;
  const off = opts.offset ?? [0, 0];
  const prof: Vec2[] = base.map((p) => [p[0] * s * fx + off[0], p[1] * s * fy + off[1]]);
  if (fx * fy < 0) prof.reverse();
  const key = `mld|${Array.isArray(profile) ? 'lit' : profile}|${k(s)}|${fx}|${fy}|${k(off[0])}|${k(off[1])}|${opts.closed ? 'c' : 'o'}|${opts.caps === false ? 'n' : 'y'}|${path.map((p) => `${k(p[0])},${k(p[1])},${k(p[2])}`).join(';')}`;
  return cached(key, () => sweepProfile(prof, path, { closed: opts.closed, up: opts.up, caps: opts.caps }));
}

/** Straight run of trim between two points. */
export function mouldingRun(profile: ProfileName | Vec2[], from: Vec3, to: Vec3, opts: MouldingOptions = {}): THREE.BufferGeometry {
  return profileMoulding([from, to], profile, opts);
}

/**
 * Trim that runs all the way around a rectangular room at height `y`
 * (crown at the ceiling, base at the floor), mitred at all four corners.
 * `inset` pulls the run off the wall face by that much.
 */
export function roomMoulding(profile: ProfileName | Vec2[], w: number, d: number, y: number, opts: MouldingOptions = {}): THREE.BufferGeometry {
  const W = clampNum(w, 0.2, 60, 3) / 2;
  const D = clampNum(d, 0.2, 60, 3) / 2;
  const Y = clampNum(y, -50, 50, 0);
  // counter-clockwise seen from above → `right` (cross(dir, up)) points INTO the room
  const path: Vec3[] = [
    [-W, Y, -D], [W, Y, -D], [W, Y, D], [-W, Y, D],
  ];
  return profileMoulding(path, profile, { ...opts, closed: true });
}

/**
 * Casing around a rectangular opening, in the opening's local plane
 * (x left/right, y up, sitting at z = 0 and projecting toward +Z).
 * `reveal` is the classic 3/16" set-back from the jamb.
 */
export function openingCasing(width: number, height: number, profile: ProfileName | Vec2[] = 'colonial-casing', opts: { reveal?: number; scale?: number; sill?: boolean } = {}): THREE.BufferGeometry {
  const W = clampNum(width, 0.1, 12, 0.9);
  const H = clampNum(height, 0.1, 6, 2.03);
  const rev = clampNum(opts.reveal ?? 0.005, 0, 0.05, 0.005);
  const s = clampNum(opts.scale ?? 1, 0.2, 6, 1);
  const src = Array.isArray(profile) ? profile : (PROFILES[profile] ?? PROFILES['colonial-casing']);
  // casing section: profile x = proud of the wall (→ +Z), profile y = across the casing
  const band = src.map((p) => [p[1] * s, p[0] * s] as Vec2);
  const hw = W / 2 + rev, hh = H + rev;
  const key = `csg|${Array.isArray(profile) ? 'lit' : profile}|${k(W)}|${k(H)}|${k(rev)}|${k(s)}|${opts.sill ? 's' : 'n'}`;
  return cached(key, () => {
    const parts: THREE.BufferGeometry[] = [];
    const legL = sweepProfile(band, [[-hw, 0, 0], [-hw, hh, 0]], { up: [-1, 0, 0] });
    const legR = sweepProfile(band, [[hw, 0, 0], [hw, hh, 0]], { up: [1, 0, 0] });
    const head = sweepProfile(band, [[-hw, hh, 0], [hw, hh, 0]], { up: [0, 1, 0] });
    parts.push(legL, legR, head);
    if (opts.sill) {
      const t = 0.028 * s, dp = 0.06 * s;
      const sill = chamferBox(W + 0.10 * s, t, dp, 0.002);
      parts.push(transformed(sill, { position: [0, -t / 2, dp / 2 - 0.01] }));
    }
    return mergeDetail(parts);
  });
}

/** Countertop edge treatment swept along a straight front edge. */
export function edgeProfile(name: 'eased' | 'bullnose' | 'bevel' | 'ogee' | 'mitered', length: number, thickness = 0.03): THREE.BufferGeometry {
  const L = clampNum(length, 0.05, 30, 1);
  const t = clampNum(thickness, 0.01, 0.12, 0.03);
  const map: Record<string, ProfileName> = {
    eased: 'counter-eased', bullnose: 'counter-bullnose', bevel: 'counter-bevel', ogee: 'counter-ogee', mitered: 'counter-mitered',
  };
  const src = PROFILES[map[name] ?? 'counter-eased'];
  const nominal = name === 'mitered' ? 0.05 : 0.03;
  const sy = t / nominal;
  const prof: Vec2[] = src.map((p) => [p[0], p[1] * sy]);
  const key = `edg|${name}|${k(L)}|${k(t)}`;
  return cached(key, () => sweepProfile(prof, [[-L / 2, 0, 0], [L / 2, 0, 0]], { up: [0, 1, 0] }));
}

// ---------------------------------------------------------------------------
// Door + drawer fronts
// ---------------------------------------------------------------------------

/** Reveal between adjacent doors/drawers. 3 mm is what a real frameless job runs. */
export const DOOR_REVEAL = 0.003;

export type PanelStyle = 'shaker' | 'flat' | 'slab' | 'raised' | 'beaded' | 'glass' | 'open';

export interface PanelOptions {
  /** front-to-back thickness (3/4" = 0.019) */
  thickness?: number;
  /** stile (vertical) width */
  stile?: number;
  /** rail (horizontal) width; defaults to stile */
  rail?: number;
  /** bottom rail is usually wider on a real door */
  bottomRail?: number;
  /** how deep the centre panel sits behind the frame face */
  panelInset?: number;
  /** run a bead around the inside of the frame */
  bead?: boolean;
  /** edge chamfer on the outside of the door */
  chamfer?: number;
  /** glass panels: number of horizontal / vertical muntin bars */
  muntinsX?: number;
  muntinsY?: number;
}

export interface PanelParts {
  /** the millwork: frame + panel merged, one draw call, slot material */
  body: THREE.BufferGeometry;
  /** glass insert (use a util 'glass' material), or null */
  glass: THREE.BufferGeometry | null;
  /** how proud of the cabinet box the door face sits */
  thickness: number;
}

function panelDefaults(o: PanelOptions) {
  const thickness = clampNum(o.thickness ?? 0.019, 0.006, 0.06, 0.019);
  const stile = clampNum(o.stile ?? 0.057, 0.012, 0.2, 0.057);
  const rail = clampNum(o.rail ?? stile, 0.012, 0.2, stile);
  const bottomRail = clampNum(o.bottomRail ?? rail, 0.012, 0.3, rail);
  const panelInset = clampNum(o.panelInset ?? 0.006, 0, 0.03, 0.006);
  const chamfer = clampNum(o.chamfer ?? 0.0012, 0, 0.01, 0.0012);
  return { thickness, stile, rail, bottomRail, panelInset, chamfer };
}

/** Plain slab / flat front — still chamfered, because a real one is. */
export function slabPanel(w: number, h: number, o: PanelOptions = {}): PanelParts {
  const W = clampNum(w, 0.02, 4, 0.4), H = clampNum(h, 0.02, 4, 0.7);
  const { thickness, chamfer } = panelDefaults(o);
  const key = `pnl-slab|${k(W)}|${k(H)}|${k(thickness)}|${k(chamfer)}`;
  const body = cached(key, () => chamferBox(W, H, thickness, chamfer).clone());
  return { body, glass: null, thickness };
}

function frameParts(W: number, H: number, stile: number, rail: number, bottomRail: number, thickness: number, chamfer: number) {
  const st = Math.min(stile, W / 2.4);
  const rl = Math.min(rail, H / 3);
  const br = Math.min(bottomRail, H / 2.6);
  const midH = Math.max(0.004, H - rl - br);
  const parts: THREE.BufferGeometry[] = [];
  // stiles run the full height, rails sit between them (how a real door is built)
  parts.push(transformed(chamferBox(st, H, thickness, chamfer), { position: [-W / 2 + st / 2, 0, 0] }));
  parts.push(transformed(chamferBox(st, H, thickness, chamfer), { position: [W / 2 - st / 2, 0, 0] }));
  const innerW = Math.max(0.004, W - st * 2);
  // Rails are separate horizontal pieces of stock, so their grain crosses
  // the door while the stiles and panel run vertically. Keep these authored
  // UVs through the merge; a global projection erases the joinery.
  const railStock = (height: number, y: number) => {
    const g = transformed(chamferBox(innerW, height, thickness, chamfer), { position: [0, y, 0] });
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, -v, u);
    }
    return g;
  };
  parts.push(railStock(rl, H / 2 - rl / 2));
  parts.push(railStock(br, -H / 2 + br / 2));
  return { parts, st, rl, br, midH, innerW };
}

/** Shaker: square frame, recessed flat centre panel. The workhorse door. */
export function shakerPanel(w: number, h: number, o: PanelOptions = {}): PanelParts {
  const W = clampNum(w, 0.06, 4, 0.4), H = clampNum(h, 0.06, 4, 0.7);
  const { thickness, stile, rail, bottomRail, panelInset, chamfer } = panelDefaults(o);
  const bead = o.bead === true;
  const key = `pnl-shk|${k(W)}|${k(H)}|${k(thickness)}|${k(stile)}|${k(rail)}|${k(bottomRail)}|${k(panelInset)}|${k(chamfer)}|${bead ? 'b' : 'n'}`;
  const body = cached(key, () => {
    const { parts, st, rl, br, midH, innerW } = frameParts(W, H, stile, rail, bottomRail, thickness, chamfer);
    const panelT = Math.max(0.004, thickness - panelInset);
    const cy = (br - rl) / 2;
    parts.push(transformed(chamferBox(innerW + 0.004, midH + 0.004, panelT, 0.0008), { position: [0, cy, -panelInset / 2] }));
    if (bead) {
      const bx = W / 2 - st, by = H / 2 - rl, byb = -H / 2 + br;
      const z = thickness / 2 - 0.0005;
      parts.push(profileMoulding([[-bx, byb, z], [bx, byb, z]], 'panel-bead', { scale: 0.6, up: [0, 0, 1] }));
      parts.push(profileMoulding([[-bx, by, z], [bx, by, z]], 'panel-bead', { scale: 0.6, up: [0, 0, 1], flipX: true }));
      parts.push(profileMoulding([[-bx, byb, z], [-bx, by, z]], 'panel-bead', { scale: 0.6, up: [0, 0, 1] }));
      parts.push(profileMoulding([[bx, byb, z], [bx, by, z]], 'panel-bead', { scale: 0.6, up: [0, 0, 1], flipX: true }));
    }
    return mergeDetail(parts, true);
  });
  return { body, glass: null, thickness };
}

/** Raised panel: frame plus a fielded centre that stands PROUD with a bevel. */
export function raisedPanel(w: number, h: number, o: PanelOptions = {}): PanelParts {
  const W = clampNum(w, 0.06, 4, 0.4), H = clampNum(h, 0.06, 4, 0.7);
  const { thickness, stile, rail, bottomRail, chamfer } = panelDefaults(o);
  const key = `pnl-rsd|${k(W)}|${k(H)}|${k(thickness)}|${k(stile)}|${k(rail)}|${k(bottomRail)}|${k(chamfer)}`;
  const body = cached(key, () => {
    const { parts, st, rl, br, midH, innerW } = frameParts(W, H, stile, rail, bottomRail, thickness, chamfer);
    const cy = (br - rl) / 2;
    const fieldW = Math.max(0.01, innerW - 0.034), fieldH = Math.max(0.01, midH - 0.034);
    const back = Math.max(0.004, thickness - 0.010);
    parts.push(transformed(chamferBox(innerW + 0.004, midH + 0.004, back, 0.0008), { position: [0, cy, -0.004] }));
    // the bevelled field: a shallow frustum standing proud of the frame's back
    const field = frustumSlab(innerW - 0.006, midH - 0.006, fieldW, fieldH, 0.010);
    parts.push(transformed(field, { position: [0, cy, back / 2 - 0.004] }));
    void st;
    return mergeDetail(parts, true);
  });
  return { body, glass: null, thickness };
}

/** Beaded / beadboard front: frame with vertical beads across the centre. */
export function beadedPanel(w: number, h: number, o: PanelOptions = {}): PanelParts {
  const W = clampNum(w, 0.06, 4, 0.4), H = clampNum(h, 0.06, 4, 0.7);
  const { thickness, stile, rail, bottomRail, panelInset, chamfer } = panelDefaults(o);
  const key = `pnl-bdd|${k(W)}|${k(H)}|${k(thickness)}|${k(stile)}|${k(rail)}|${k(bottomRail)}|${k(panelInset)}|${k(chamfer)}`;
  const body = cached(key, () => {
    const { parts, st, rl, br, midH, innerW } = frameParts(W, H, stile, rail, bottomRail, thickness, chamfer);
    const panelT = Math.max(0.004, thickness - panelInset);
    const cy = (br - rl) / 2;
    parts.push(transformed(chamferBox(innerW + 0.004, midH + 0.004, panelT, 0.0008), { position: [0, cy, -panelInset / 2] }));
    // 1-3/4" beadboard: a V-groove plus a bead, repeated
    const pitch = 0.044;
    const n = Math.max(1, Math.floor(innerW / pitch));
    const zFace = -panelInset / 2 + panelT / 2;
    for (let i = 1; i < n; i++) {
      const x = -innerW / 2 + (innerW / n) * i;
      parts.push(transformed(chamferBox(0.0045, midH, 0.0045, 0.0012), { position: [x, cy, zFace - 0.0012] }));
    }
    void st;
    return mergeDetail(parts, true);
  });
  return { body, glass: null, thickness };
}

/** Glass door: frame + muntin grid + a separate glass sheet. */
export function glassPanel(w: number, h: number, o: PanelOptions = {}): PanelParts {
  const W = clampNum(w, 0.06, 4, 0.4), H = clampNum(h, 0.06, 4, 0.7);
  const { thickness, stile, rail, bottomRail, chamfer } = panelDefaults(o);
  const mx = Math.round(clampNum(o.muntinsX ?? 1, 0, 6, 1));
  const my = Math.round(clampNum(o.muntinsY ?? 2, 0, 8, 2));
  const key = `pnl-gls|${k(W)}|${k(H)}|${k(thickness)}|${k(stile)}|${k(rail)}|${k(bottomRail)}|${k(chamfer)}|${mx}|${my}`;
  const body = cached(key, () => {
    const { parts, st, rl, br, midH, innerW } = frameParts(W, H, stile, rail, bottomRail, thickness, chamfer);
    const cy = (br - rl) / 2;
    const bar = 0.016, barT = Math.max(0.004, thickness * 0.55);
    for (let i = 1; i <= mx; i++) {
      const x = -innerW / 2 + (innerW / (mx + 1)) * i;
      parts.push(transformed(chamferBox(bar, midH, barT, 0.001), { position: [x, cy, thickness / 2 - barT / 2] }));
    }
    for (let i = 1; i <= my; i++) {
      const y = cy - midH / 2 + (midH / (my + 1)) * i;
      parts.push(transformed(chamferBox(innerW, bar, barT, 0.001), { position: [0, y, thickness / 2 - barT / 2] }));
    }
    void st;
    return mergeDetail(parts, true);
  });
  const glassKey = `pnl-gls-g|${k(W)}|${k(H)}|${k(stile)}|${k(rail)}|${k(bottomRail)}`;
  const glass = cached(glassKey, () => {
    const st = Math.min(stile, W / 2.4);
    const rl = Math.min(rail, H / 3);
    const brr = Math.min(bottomRail, H / 2.6);
    const gw = Math.max(0.01, W - st * 2 + 0.006);
    const gh = Math.max(0.01, H - rl - brr + 0.006);
    const cy = (brr - rl) / 2;
    return transformed(applyWorldUVs(new THREE.BoxGeometry(gw, gh, 0.004)), { position: [0, cy, -0.002] });
  });
  return { body, glass, thickness };
}

/** Dispatcher: give it the spec's doorStyle and get the right front. */
export function doorPanel(style: PanelStyle | string, w: number, h: number, o: PanelOptions = {}): PanelParts {
  switch (style) {
    case 'shaker': return shakerPanel(w, h, o);
    case 'raised': return raisedPanel(w, h, o);
    case 'beaded': return beadedPanel(w, h, o);
    case 'glass': return glassPanel(w, h, o);
    case 'open': return { body: applyWorldUVs(new THREE.BoxGeometry(0.001, 0.001, 0.001)), glass: null, thickness: panelDefaults(o).thickness };
    case 'flat':
    case 'slab':
    default: return slabPanel(w, h, o);
  }
}

/** A fielded (bevelled) slab: big face at the back, small face at the front. */
function frustumSlab(w0: number, h0: number, w1: number, h1: number, depth: number): THREE.BufferGeometry {
  const key = `frs|${k(w0)}|${k(h0)}|${k(w1)}|${k(h1)}|${k(depth)}`;
  return cached(key, () => {
    const a = [-w0 / 2, -h0 / 2, 0], b = [w0 / 2, -h0 / 2, 0], c = [w0 / 2, h0 / 2, 0], d = [-w0 / 2, h0 / 2, 0];
    const e = [-w1 / 2, -h1 / 2, depth], f = [w1 / 2, -h1 / 2, depth], g2 = [w1 / 2, h1 / 2, depth], hh = [-w1 / 2, h1 / 2, depth];
    const v: number[] = [];
    const quad = (p0: number[], p1: number[], p2: number[], p3: number[]) => { v.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); };
    quad(e, f, g2, hh);           // front face
    quad(b, a, d, c);             // back face
    quad(a, b, f, e);             // bottom bevel
    quad(b, c, g2, f);            // right bevel
    quad(c, d, hh, g2);           // top bevel
    quad(d, a, e, hh);            // left bevel
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    return applyWorldUVs(geo);
  });
}

// ---------------------------------------------------------------------------
// Lathe helpers (turned parts: spindles, legs, tub feet, columns)
// ---------------------------------------------------------------------------

/**
 * Revolve a profile around the Y axis. Points are [radius, y]; radius 0 closes
 * the part. Cheap and exact — this is how every turned wood or metal part
 * should be built.
 */
export function lathePoints(profile: Vec2[], segments = 16): THREE.BufferGeometry {
  const pts = profile
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => new THREE.Vector2(Math.max(0, p[0]), p[1]));
  if (pts.length < 2) return applyWorldUVs(new THREE.BoxGeometry(0.001, 0.001, 0.001));
  const g = new THREE.LatheGeometry(pts, Math.round(clampNum(segments, 4, 64, 16)));
  // three leaves the pole vertices (radius 0) with an UN-normalised normal, which
  // shows up as a black ring on the cap under any real light. Fix it here so no
  // caller has to know.
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  let midY = 0;
  for (const p of pts) midY += p.y;
  midY /= pts.length;
  for (let i = 0; i < nor.count; i++) {
    const x = nor.getX(i), y = nor.getY(i), z = nor.getZ(i);
    const len = Math.hypot(x, y, z);
    if (len > 1e-4) nor.setXYZ(i, x / len, y / len, z / len);
    else nor.setXYZ(i, 0, pos.getY(i) >= midY ? 1 : -1, 0);
  }
  nor.needsUpdate = true;
  return applyWorldUVs(g);
}

/** Named lathe wrapper with caching. */
export function lathe(profile: Vec2[], segments = 16, key?: string): THREE.BufferGeometry {
  if (!key) return lathePoints(profile, segments);
  return cached(`lth|${key}|${segments}`, () => lathePoints(profile, segments));
}

/** Turned baluster / stair spindle / porch spindle. */
export function turnedSpindle(opts: { height?: number; maxRadius?: number; segments?: number; style?: 'colonial' | 'square-tapered' | 'simple' } = {}): THREE.BufferGeometry {
  const H = clampNum(opts.height ?? 0.78, 0.1, 3, 0.78);
  const R = clampNum(opts.maxRadius ?? 0.022, 0.004, 0.15, 0.022);
  const seg = Math.round(clampNum(opts.segments ?? 12, 5, 32, 12));
  const style = opts.style ?? 'colonial';
  const key = `spn|${style}|${k(H)}|${k(R)}|${seg}`;
  return cached(key, () => {
    if (style === 'square-tapered') {
      const bottom = chamferBox(R * 2, H * 0.32, R * 2, 0.0015);
      const shaftTop = chamferBox(R * 1.5, H * 0.68, R * 1.5, 0.0015);
      return mergeDetail([
        transformed(bottom, { position: [0, H * 0.16, 0] }),
        transformed(shaftTop, { position: [0, H * 0.32 + H * 0.34, 0] }),
      ]);
    }
    if (style === 'simple') {
      return lathePoints([[0, 0], [R * 0.8, 0], [R * 0.8, H], [0, H]], seg);
    }
    const p: Vec2[] = [
      [0, 0], [R, 0], [R, H * 0.06], [R * 0.72, H * 0.09],
      [R * 0.86, H * 0.14], [R * 0.60, H * 0.20], [R * 0.52, H * 0.34],
      [R * 0.62, H * 0.48], [R * 0.86, H * 0.60], [R * 0.94, H * 0.68],
      [R * 0.70, H * 0.74], [R * 0.52, H * 0.80], [R * 0.60, H * 0.88],
      [R * 0.92, H * 0.93], [R, H * 0.96], [R, H], [0, H],
    ];
    return lathePoints(p, seg);
  });
}

/** Turned table / island / vanity leg with a real taper. */
export function tableLeg(opts: { height?: number; top?: number; toe?: number; segments?: number; turned?: boolean } = {}): THREE.BufferGeometry {
  const H = clampNum(opts.height ?? 0.86, 0.1, 2.5, 0.86);
  const top = clampNum(opts.top ?? 0.045, 0.01, 0.3, 0.045);
  const toe = clampNum(opts.toe ?? 0.030, 0.008, 0.3, 0.030);
  const seg = Math.round(clampNum(opts.segments ?? 14, 5, 32, 14));
  const turned = opts.turned !== false;
  const key = `leg|${k(H)}|${k(top)}|${k(toe)}|${seg}|${turned ? 't' : 's'}`;
  return cached(key, () => {
    if (!turned) {
      return mergeDetail([transformed(chamferBox(top * 2, H, top * 2, 0.002), { position: [0, H / 2, 0] })]);
    }
    const p: Vec2[] = [
      [0, 0], [toe, 0], [toe, 0.012], [toe * 1.18, 0.022], [toe * 1.06, 0.05],
      [top * 0.78, H * 0.42], [top * 0.86, H * 0.62], [top * 0.72, H * 0.70],
      [top * 0.94, H * 0.80], [top, H * 0.86], [top, H], [0, H],
    ];
    return lathePoints(p, seg);
  });
}

/** Clawfoot / pedestal tub foot. */
export function tubFoot(opts: { height?: number; radius?: number } = {}): THREE.BufferGeometry {
  const H = clampNum(opts.height ?? 0.13, 0.03, 0.5, 0.13);
  const R = clampNum(opts.radius ?? 0.048, 0.01, 0.3, 0.048);
  const key = `tbf|${k(H)}|${k(R)}`;
  return cached(key, () => lathePoints([
    [0, 0], [R, 0], [R * 0.96, H * 0.10], [R * 0.72, H * 0.22], [R * 0.50, H * 0.36],
    [R * 0.40, H * 0.54], [R * 0.46, H * 0.72], [R * 0.62, H * 0.88], [R * 0.70, H], [0, H],
  ], 14));
}

/**
 * Column shaft with entasis — the slight convex swell a real classical column
 * has. Without it a column reads as a pipe.
 */
export function columnShaft(opts: { height?: number; base?: number; top?: number; entasis?: number; segments?: number; steps?: number } = {}): THREE.BufferGeometry {
  const H = clampNum(opts.height ?? 2.6, 0.3, 8, 2.6);
  const rb = clampNum(opts.base ?? 0.11, 0.02, 1, 0.11);
  const rt = clampNum(opts.top ?? 0.092, 0.02, 1, 0.092);
  const ent = clampNum(opts.entasis ?? 0.012, 0, 0.2, 0.012);
  const seg = Math.round(clampNum(opts.segments ?? 20, 6, 48, 20));
  const steps = Math.round(clampNum(opts.steps ?? 8, 3, 24, 8));
  const key = `col|${k(H)}|${k(rb)}|${k(rt)}|${k(ent)}|${seg}|${steps}`;
  return cached(key, () => {
    const p: Vec2[] = [[0, 0]];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const lin = rb + (rt - rb) * t;
      p.push([lin + ent * Math.sin(Math.PI * t) * (1 - t * 0.35), H * t]);
    }
    p.push([0, H]);
    return lathePoints(p, seg);
  });
}

// ---------------------------------------------------------------------------
// Hardware — real proportions, chamfered ends, visible screw bosses
// ---------------------------------------------------------------------------

const MM = 0.001;

/**
 * Bar pull. `lengthMm` is the OVERALL length; standard centre-to-centre sizes
 * are 96 / 128 / 160 / 192 / 224 / 320 mm, so the overall runs ~25 mm longer.
 * Projection 35 mm, bar 12 mm — the proportions of a real Top Knobs bar.
 */
export function barPull(lengthMm = 160, opts: { barMm?: number; projectionMm?: number; square?: boolean } = {}): THREE.BufferGeometry {
  const L = clampNum(lengthMm, 40, 700, 160) * MM;
  const bar = clampNum(opts.barMm ?? 12, 4, 30, 12) * MM;
  const proj = clampNum(opts.projectionMm ?? 35, 12, 90, 35) * MM;
  const square = opts.square === true;
  const key = `pull|${k(L)}|${k(bar)}|${k(proj)}|${square ? 'q' : 'r'}`;
  return cached(key, () => {
    const parts: THREE.BufferGeometry[] = [];
    const postR = bar * 0.42, postH = proj - bar / 2;
    const cc = Math.max(bar * 1.6, L - bar * 2.1);
    if (square) {
      parts.push(transformed(chamferBox(L, bar, bar, bar * 0.12), { position: [0, 0, proj - bar / 2] }));
    } else {
      const barG = chamferCylinder(bar / 2, L, bar * 0.10, 14);
      parts.push(transformed(barG, { position: [0, 0, proj - bar / 2], rotation: [0, 0, Math.PI / 2] }));
    }
    const post = chamferCylinder(postR, postH, postR * 0.18, 12);
    for (const sx of [-1, 1]) {
      parts.push(transformed(post, { position: [(sx * cc) / 2, 0, postH / 2], rotation: [Math.PI / 2, 0, 0] }));
      // screw boss where the post meets the door
      parts.push(transformed(chamferCylinder(postR * 1.25, 0.0012, 0.0003, 12), { position: [(sx * cc) / 2, 0, 0.0006], rotation: [Math.PI / 2, 0, 0] }));
    }
    return mergeDetail(parts);
  });
}

/** Round cabinet knob (32 mm is the standard). Turned profile, not a sphere. */
export function knob(dMm = 32, opts: { style?: 'round' | 'mushroom' | 'square' | 'octagon' } = {}): THREE.BufferGeometry {
  const D = clampNum(dMm, 10, 90, 32) * MM;
  const style = opts.style ?? 'round';
  const key = `knb|${k(D)}|${style}`;
  return cached(key, () => {
    const R = D / 2;
    if (style === 'square') {
      return mergeDetail([
        transformed(chamferBox(D * 0.42, D * 0.42, 0.010, 0.0008), { position: [0, 0, 0.005] }),
        transformed(chamferBox(D, D, 0.016, 0.0015), { position: [0, 0, 0.010 + 0.008] }),
      ]);
    }
    if (style === 'octagon') {
      return mergeDetail([
        transformed(lathePoints([[0, 0], [R * 0.38, 0], [R * 0.38, 0.010], [R, 0.012], [R * 0.92, 0.024], [R * 0.34, 0.030], [0, 0.030]], 8), { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0] }),
      ]);
    }
    const p: Vec2[] = style === 'mushroom'
      ? [[0, 0], [R * 0.44, 0], [R * 0.44, 0.008], [R * 0.62, 0.011], [R, 0.020], [R * 0.98, 0.028], [R * 0.60, 0.034], [0, 0.036]]
      : [[0, 0], [R * 0.40, 0], [R * 0.40, 0.009], [R * 0.86, 0.014], [R, 0.022], [R * 0.88, 0.030], [R * 0.46, 0.034], [0, 0.035]];
    // lathe is around +Y; rotate so the knob projects along +Z off a door face
    return transformed(lathePoints(p, 16), { rotation: [-Math.PI / 2, 0, 0] });
  });
}

/** Bin / cup pull — the classic drawer pull on a farmhouse or transitional job. */
export function cupPull(widthMm = 96): THREE.BufferGeometry {
  const W = clampNum(widthMm, 50, 250, 96) * MM;
  const key = `cup|${k(W)}`;
  return cached(key, () => {
    const t = 0.0022, depth = 0.026, height = 0.030;
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(chamferBox(W, t, depth, 0.0008), { position: [0, height / 2 - t / 2, depth / 2] }));       // top lip
    parts.push(transformed(chamferBox(W, height, t, 0.0008), { position: [0, 0, depth - t / 2] }));                    // front face
    parts.push(transformed(chamferBox(W, height * 0.55, t, 0.0008), { position: [0, -height * 0.10, t / 2], rotation: [0, 0, 0] }));
    for (const sx of [-1, 1]) {
      parts.push(transformed(chamferBox(t, height, depth, 0.0006), { position: [(sx * (W - t)) / 2, 0, depth / 2] })); // ends
      parts.push(transformed(chamferCylinder(0.0035, 0.0016, 0.0004, 10), { position: [(sx * (W * 0.36)), height * 0.30, 0.0008], rotation: [Math.PI / 2, 0, 0] }));
    }
    return mergeDetail(parts);
  });
}

/** Recessed / finger edge pull for handleless modern cabinetry. */
export function edgePull(lengthMm = 300, opts: { heightMm?: number; depthMm?: number } = {}): THREE.BufferGeometry {
  const L = clampNum(lengthMm, 60, 1500, 300) * MM;
  const H = clampNum(opts.heightMm ?? 22, 8, 60, 22) * MM;
  const D = clampNum(opts.depthMm ?? 16, 6, 50, 16) * MM;
  const key = `epl|${k(L)}|${k(H)}|${k(D)}`;
  return cached(key, () => {
    const t = 0.0018;
    return mergeDetail([
      transformed(chamferBox(L, t, D, 0.0006), { position: [0, H / 2, -D / 2] }),
      transformed(chamferBox(L, H, t, 0.0006), { position: [0, 0, -D + t / 2] }),
      transformed(chamferBox(L, t, D * 0.6, 0.0006), { position: [0, -H / 2, -D * 0.7] }),
    ]);
  });
}

/** Concealed euro hinge cup + arm (what you see when a door is open). */
export function hinge(opts: { kind?: 'euro' | 'barrel' | 'exposed' } = {}): THREE.BufferGeometry {
  const kind = opts.kind ?? 'euro';
  return cached(`hng|${kind}`, () => {
    if (kind === 'barrel') {
      return mergeDetail([
        transformed(chamferCylinder(0.007, 0.052, 0.0008, 12), { position: [0, 0, 0] }),
        transformed(chamferCylinder(0.0085, 0.010, 0.0006, 12), { position: [0, 0.030, 0] }),
        transformed(chamferCylinder(0.0085, 0.010, 0.0006, 12), { position: [0, -0.030, 0] }),
      ]);
    }
    if (kind === 'exposed') {
      return mergeDetail([
        transformed(chamferBox(0.030, 0.058, 0.0022, 0.0006), { position: [0, 0, 0] }),
        transformed(chamferCylinder(0.0055, 0.058, 0.0006, 10), { position: [-0.015, 0, 0.004], rotation: [0, 0, 0] }),
      ]);
    }
    return mergeDetail([
      transformed(chamferCylinder(0.0175, 0.0115, 0.0008, 14), { position: [0, 0, 0.006], rotation: [Math.PI / 2, 0, 0] }),
      transformed(chamferBox(0.020, 0.032, 0.0022, 0.0005), { position: [0, 0, -0.006] }),
      transformed(chamferBox(0.014, 0.048, 0.0030, 0.0005), { position: [0, 0, -0.020] }),
    ]);
  });
}

/** 5 mm shelf pin. Tiny, but a shelf floating on nothing reads wrong. */
export function shelfPin(): THREE.BufferGeometry {
  return cached('pin', () => mergeDetail([
    transformed(chamferCylinder(0.0025, 0.009, 0.0004, 8), { rotation: [0, 0, Math.PI / 2] }),
    transformed(chamferCylinder(0.0040, 0.0018, 0.0003, 8), { position: [0.0045, 0, 0], rotation: [0, 0, Math.PI / 2] }),
  ]));
}

/** Gooseneck kitchen faucet: base, curved spout, aerator, optional side spray. */
export function faucetGooseneck(opts: { heightM?: number; reachM?: number; tubeMm?: number; pulldown?: boolean; segments?: number } = {}): THREE.BufferGeometry {
  const H = clampNum(opts.heightM ?? 0.42, 0.15, 0.9, 0.42);
  const reach = clampNum(opts.reachM ?? 0.22, 0.06, 0.5, 0.22);
  const tube = clampNum(opts.tubeMm ?? 22, 8, 50, 22) * MM;
  const pulldown = opts.pulldown !== false;
  const seg = Math.round(clampNum(opts.segments ?? 12, 6, 24, 12));
  const key = `fct|${k(H)}|${k(reach)}|${k(tube)}|${pulldown ? 'p' : 's'}|${seg}`;
  return cached(key, () => {
    const parts: THREE.BufferGeometry[] = [];
    // escutcheon + base
    parts.push(transformed(lathePoints([[0, 0], [tube * 1.5, 0], [tube * 1.45, 0.006], [tube * 0.9, 0.012], [tube * 0.62, 0.03], [tube * 0.58, 0.05], [0, 0.05]], seg), { position: [0, 0, 0] }));
    // gooseneck arc, swept as a tube along a quarter-ish arc in the YZ plane
    const pts: Vec3[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = 0.04 + (H - 0.04) * Math.sin((Math.PI / 2) * t);
      const z = reach * (1 - Math.cos((Math.PI / 2) * t)) * (t * 0.35 + 0.65);
      pts.push([0, y, z]);
    }
    const ring: Vec2[] = [];
    const rSeg = Math.max(6, Math.round(seg * 0.75));
    for (let i = 0; i <= rSeg; i++) {
      const a = (i / rSeg) * Math.PI * 2;
      ring.push([Math.cos(a) * (tube / 2), Math.sin(a) * (tube / 2)]);
    }
    parts.push(sweepProfile(ring, pts, { up: [1, 0, 0], caps: false }));
    // spout head / aerator
    const head = pts[pts.length - 1];
    parts.push(transformed(lathePoints([[0, 0], [tube * 0.62, 0], [tube * 0.66, -0.010], [tube * 0.58, -0.028], [tube * 0.40, -0.034], [0, -0.034]], seg), { position: [head[0], head[1], head[2]] }));
    if (pulldown) {
      parts.push(transformed(chamferCylinder(tube * 0.30, 0.020, 0.0006, 10), { position: [head[0], head[1] + 0.014, head[2] - tube * 0.55] }));
    }
    return mergeDetail(parts);
  });
}

/** Lever or cross faucet handle. */
export function faucetHandle(opts: { kind?: 'lever' | 'cross' | 'knob'; lengthM?: number } = {}): THREE.BufferGeometry {
  const kind = opts.kind ?? 'lever';
  const L = clampNum(opts.lengthM ?? 0.075, 0.02, 0.25, 0.075);
  const key = `fhd|${kind}|${k(L)}`;
  return cached(key, () => {
    const stem = transformed(chamferCylinder(0.009, 0.028, 0.0006, 12), { position: [0, 0.014, 0] });
    if (kind === 'cross') {
      return mergeDetail([
        stem,
        transformed(chamferBox(L, 0.008, 0.010, 0.0012), { position: [0, 0.032, 0] }),
        transformed(chamferBox(0.010, 0.008, L, 0.0012), { position: [0, 0.032, 0] }),
        transformed(chamferCylinder(0.012, 0.008, 0.0008, 12), { position: [0, 0.034, 0] }),
      ]);
    }
    if (kind === 'knob') {
      return mergeDetail([stem, transformed(lathePoints([[0, 0], [0.016, 0], [0.018, 0.008], [0.014, 0.020], [0, 0.022]], 14), { position: [0, 0.028, 0] })]);
    }
    return mergeDetail([
      stem,
      transformed(chamferCylinder(0.011, 0.012, 0.0008, 12), { position: [0, 0.032, 0] }),
      transformed(chamferBox(0.014, 0.011, L, 0.0015), { position: [0, 0.036, L / 2 - 0.008] }),
    ]);
  });
}

/** Shower arm + flange (the pipe a head hangs off). */
export function showerArm(opts: { lengthM?: number; dropM?: number; tubeMm?: number } = {}): THREE.BufferGeometry {
  const L = clampNum(opts.lengthM ?? 0.30, 0.06, 0.9, 0.30);
  const drop = clampNum(opts.dropM ?? 0.10, 0, 0.6, 0.10);
  const tube = clampNum(opts.tubeMm ?? 16, 8, 40, 16) * MM;
  const key = `arm|${k(L)}|${k(drop)}|${k(tube)}`;
  return cached(key, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(lathePoints([[0, 0], [tube * 1.9, 0], [tube * 1.8, 0.004], [tube * 0.9, 0.010], [tube * 0.7, 0.014], [0, 0.014]], 16), { rotation: [Math.PI / 2, 0, 0] }));
    parts.push(transformed(chamferCylinder(tube / 2, L, tube * 0.08, 12), { position: [0, 0, L / 2], rotation: [Math.PI / 2, 0, 0] }));
    if (drop > 0.005) {
      parts.push(transformed(chamferCylinder(tube / 2, drop, tube * 0.08, 12), { position: [0, -drop / 2, L] }));
    }
    return mergeDetail(parts);
  });
}

/** Rain shower head — a real one is a thin disc with a chamfered rim and a face plate. */
export function rainHead(diameterMm = 250, opts: { square?: boolean } = {}): THREE.BufferGeometry {
  const D = clampNum(diameterMm, 80, 600, 250) * MM;
  const square = opts.square === true;
  const key = `rain|${k(D)}|${square ? 'q' : 'r'}`;
  return cached(key, () => {
    if (square) {
      return mergeDetail([
        transformed(chamferBox(D, 0.012, D, 0.0025), { position: [0, 0, 0] }),
        transformed(chamferBox(D - 0.018, 0.003, D - 0.018, 0.001), { position: [0, -0.0075, 0] }),
        transformed(chamferCylinder(0.014, 0.012, 0.0008, 12), { position: [0, 0.011, 0] }),
      ]);
    }
    return mergeDetail([
      lathePoints([[0, 0], [D / 2 - 0.004, 0], [D / 2, 0.004], [D / 2, 0.010], [D / 2 - 0.004, 0.014], [0, 0.014]], 28),
      transformed(chamferCylinder(0.014, 0.012, 0.0008, 12), { position: [0, 0.019, 0] }),
    ]);
  });
}

/** Shower valve trim: plate + handle + diverter. */
export function valveTrim(opts: { round?: boolean; diverter?: boolean } = {}): THREE.BufferGeometry {
  const round = opts.round !== false;
  const div = opts.diverter === true;
  const key = `vlv|${round ? 'r' : 'q'}|${div ? 'd' : 'n'}`;
  return cached(key, () => {
    const parts: THREE.BufferGeometry[] = [];
    const plate = round
      ? transformed(lathePoints([[0, 0], [0.085, 0], [0.085, 0.005], [0.080, 0.009], [0, 0.010]], 24), { rotation: [Math.PI / 2, 0, 0] })
      : transformed(chamferBox(0.150, 0.150, 0.010, 0.0015), { position: [0, 0, 0.005] });
    parts.push(plate);
    parts.push(transformed(chamferCylinder(0.017, 0.028, 0.0008, 14), { position: [0, 0, 0.024], rotation: [Math.PI / 2, 0, 0] }));
    parts.push(transformed(chamferBox(0.014, 0.011, 0.070, 0.0015), { position: [0, 0.028, 0.030] }));
    if (div) parts.push(transformed(chamferCylinder(0.010, 0.030, 0.0006, 12), { position: [0, -0.055, 0.020], rotation: [Math.PI / 2, 0, 0] }));
    return mergeDetail(parts);
  });
}

/** Towel bar with posts and rosettes. */
export function towelBar(lengthMm = 610, opts: { tubeMm?: number; projectionMm?: number } = {}): THREE.BufferGeometry {
  const L = clampNum(lengthMm, 150, 1500, 610) * MM;
  const tube = clampNum(opts.tubeMm ?? 16, 6, 40, 16) * MM;
  const proj = clampNum(opts.projectionMm ?? 72, 25, 200, 72) * MM;
  const key = `twb|${k(L)}|${k(tube)}|${k(proj)}`;
  return cached(key, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(chamferCylinder(tube / 2, L, tube * 0.10, 12), { position: [0, 0, proj], rotation: [0, 0, Math.PI / 2] }));
    for (const sx of [-1, 1]) {
      parts.push(transformed(lathePoints([[0, 0], [0.024, 0], [0.023, 0.006], [0.014, 0.012], [0.012, 0.016], [0, 0.016]], 16), { position: [(sx * L) / 2, 0, 0], rotation: [-Math.PI / 2, 0, 0] }));
      parts.push(transformed(chamferCylinder(tube * 0.42, proj - 0.014, tube * 0.08, 10), { position: [(sx * L) / 2, 0, 0.014 + (proj - 0.014) / 2], rotation: [Math.PI / 2, 0, 0] }));
    }
    return mergeDetail(parts);
  });
}

/** Toilet paper holder (post + pivot arms + roll spindle). */
export function tpHolder(opts: { widthMm?: number } = {}): THREE.BufferGeometry {
  const W = clampNum(opts.widthMm ?? 165, 100, 300, 165) * MM;
  return cached(`tpr|${k(W)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(lathePoints([[0, 0], [0.026, 0], [0.025, 0.006], [0.014, 0.012], [0, 0.013]], 16), { rotation: [-Math.PI / 2, 0, 0] }));
    parts.push(transformed(chamferBox(W, 0.012, 0.010, 0.0012), { position: [W / 2 - 0.024, 0, 0.020] }));
    for (const sx of [0, 1]) {
      parts.push(transformed(chamferBox(0.010, 0.038, 0.010, 0.0012), { position: [sx === 0 ? 0.0 : W - 0.048, -0.020, 0.020] }));
    }
    parts.push(transformed(chamferCylinder(0.011, W - 0.056, 0.0006, 10), { position: [(W - 0.048) / 2, -0.036, 0.020], rotation: [0, 0, Math.PI / 2] }));
    return mergeDetail(parts);
  });
}

/** Door knob or lever with rose. */
export function doorKnob(opts: { lever?: boolean } = {}): THREE.BufferGeometry {
  const lever = opts.lever === true;
  return cached(`dkb|${lever ? 'l' : 'k'}`, () => {
    const rose = transformed(lathePoints([[0, 0], [0.030, 0], [0.029, 0.004], [0.020, 0.009], [0.017, 0.011], [0, 0.011]], 20), { rotation: [-Math.PI / 2, 0, 0] });
    const stem = transformed(chamferCylinder(0.011, 0.026, 0.0006, 12), { position: [0, 0, 0.022], rotation: [Math.PI / 2, 0, 0] });
    if (lever) {
      return mergeDetail([rose, stem, transformed(chamferBox(0.104, 0.017, 0.020, 0.003), { position: [0.040, 0, 0.036] })]);
    }
    return mergeDetail([rose, stem, transformed(lathePoints([[0, 0], [0.020, 0.004], [0.028, 0.014], [0.028, 0.026], [0.018, 0.034], [0, 0.036]], 20), { position: [0, 0, 0.034], rotation: [Math.PI / 2, 0, 0] })]);
  });
}

/** Deadbolt: exterior cylinder + rose. */
export function deadbolt(): THREE.BufferGeometry {
  return cached('dbt', () => mergeDetail([
    transformed(lathePoints([[0, 0], [0.033, 0], [0.032, 0.005], [0.024, 0.011], [0.022, 0.014], [0, 0.014]], 20), { rotation: [-Math.PI / 2, 0, 0] }),
    transformed(chamferCylinder(0.017, 0.014, 0.0008, 16), { position: [0, 0, 0.020], rotation: [Math.PI / 2, 0, 0] }),
    transformed(chamferBox(0.014, 0.0025, 0.004, 0.0004), { position: [0, 0, 0.027] }),
  ]));
}

/** Surface cabinet latch (icebox / bin latch on a farmhouse job). */
export function cabinetLatch(): THREE.BufferGeometry {
  return cached('ltc', () => mergeDetail([
    transformed(chamferBox(0.024, 0.052, 0.004, 0.0008), { position: [0, 0, 0.002] }),
    transformed(chamferCylinder(0.010, 0.010, 0.0008, 12), { position: [0, 0.014, 0.008], rotation: [Math.PI / 2, 0, 0] }),
    transformed(chamferBox(0.010, 0.034, 0.007, 0.0010), { position: [0, -0.004, 0.010] }),
    transformed(chamferCylinder(0.0035, 0.0016, 0.0003, 8), { position: [0, 0.022, 0.005], rotation: [Math.PI / 2, 0, 0] }),
  ]));
}

// ---------------------------------------------------------------------------
// Fasteners + micro-detail (the things a photo always has and a model never does)
// ---------------------------------------------------------------------------

/** Countersunk screw head with a cross slot. Use instanced — never one mesh each. */
export function screwHead(dMm = 8, opts: { slot?: 'phillips' | 'flat' | 'none' } = {}): THREE.BufferGeometry {
  const D = clampNum(dMm, 2, 30, 8) * MM;
  const slot = opts.slot ?? 'phillips';
  return cached(`scr|${k(D)}|${slot}`, () => {
    const R = D / 2;
    const parts: THREE.BufferGeometry[] = [
      transformed(lathePoints([[0, 0], [R, 0], [R * 0.62, -R * 0.55], [0, -R * 0.62]], 12), { rotation: [-Math.PI / 2, 0, 0] }),
    ];
    if (slot === 'phillips') {
      parts.push(transformed(chamferBox(R * 1.3, R * 0.22, R * 0.30, 0), { position: [0, 0, -R * 0.10] }));
      parts.push(transformed(chamferBox(R * 0.22, R * 1.3, R * 0.30, 0), { position: [0, 0, -R * 0.10] }));
    } else if (slot === 'flat') {
      parts.push(transformed(chamferBox(R * 1.5, R * 0.20, R * 0.30, 0), { position: [0, 0, -R * 0.10] }));
    }
    return mergeDetail(parts);
  });
}

/** Duplex outlet plate + receptacle faces. Sits flat against a wall, facing +Z. */
export function outletPlate(opts: { gangs?: number; kind?: 'duplex' | 'gfci' | 'blank' | 'usb' } = {}): THREE.BufferGeometry {
  const gangs = Math.round(clampNum(opts.gangs ?? 1, 1, 4, 1));
  const kind = opts.kind ?? 'duplex';
  return cached(`out|${gangs}|${kind}`, () => {
    const W = 0.0700 + (gangs - 1) * 0.0464, H = 0.1146, T = 0.0060;
    const parts: THREE.BufferGeometry[] = [transformed(filletBox(W, H, T, 0.0025, 2), { position: [0, 0, T / 2] })];
    for (let g = 0; g < gangs; g++) {
      const cx = -W / 2 + 0.035 + g * 0.0464;
      if (kind === 'blank') continue;
      if (kind === 'gfci') {
        parts.push(transformed(chamferBox(0.0334, 0.0700, 0.0026, 0.0006), { position: [cx, 0, T + 0.0013] }));
        parts.push(transformed(chamferBox(0.0090, 0.0110, 0.0030, 0.0004), { position: [cx - 0.0075, 0.0130, T + 0.0015] }));
        parts.push(transformed(chamferBox(0.0090, 0.0110, 0.0030, 0.0004), { position: [cx + 0.0075, 0.0130, T + 0.0015] }));
      } else {
        for (const sy of [-1, 1]) {
          parts.push(transformed(lathePoints([[0, 0], [0.0165, 0], [0.0165, 0.0022], [0, 0.0022]], 16), { position: [cx, sy * 0.0192, T], rotation: [-Math.PI / 2, 0, 0] }));
          parts.push(transformed(chamferBox(0.0018, 0.0075, 0.0030, 0), { position: [cx - 0.0062, sy * 0.0192 + 0.0030, T] }));
          parts.push(transformed(chamferBox(0.0018, 0.0090, 0.0030, 0), { position: [cx + 0.0062, sy * 0.0192 + 0.0025, T] }));
        }
        if (kind === 'usb') parts.push(transformed(chamferBox(0.0130, 0.0050, 0.0030, 0), { position: [cx, 0, T] }));
      }
    }
    return mergeDetail(parts);
  });
}

/** Decora / toggle switch plate. */
export function switchPlate(opts: { gangs?: number; kind?: 'decora' | 'toggle' | 'dimmer' } = {}): THREE.BufferGeometry {
  const gangs = Math.round(clampNum(opts.gangs ?? 1, 1, 4, 1));
  const kind = opts.kind ?? 'decora';
  return cached(`swp|${gangs}|${kind}`, () => {
    const W = 0.0700 + (gangs - 1) * 0.0464, H = 0.1146, T = 0.0060;
    const parts: THREE.BufferGeometry[] = [transformed(filletBox(W, H, T, 0.0025, 2), { position: [0, 0, T / 2] })];
    for (let g = 0; g < gangs; g++) {
      const cx = -W / 2 + 0.035 + g * 0.0464;
      if (kind === 'toggle') {
        parts.push(transformed(chamferBox(0.0090, 0.0230, 0.0060, 0.0010), { position: [cx, 0.0020, T + 0.0028], rotation: [0.16, 0, 0] }));
      } else {
        parts.push(transformed(filletBox(0.0270, 0.0660, 0.0038, 0.0018, 2), { position: [cx, 0, T + 0.0019], rotation: [0.03, 0, 0] }));
        if (kind === 'dimmer') parts.push(transformed(filletBox(0.0060, 0.0180, 0.0044, 0.0012, 2), { position: [cx, -0.0400, T + 0.0022] }));
      }
    }
    return mergeDetail(parts);
  });
}

/** Floor / wall vent register with instanced louvre blades folded into one geometry. */
export function ventRegister(widthIn = 10, heightIn = 4, opts: { blades?: number } = {}): THREE.BufferGeometry {
  const W = clampNum(widthIn, 2, 48, 10) * 0.0254;
  const H = clampNum(heightIn, 2, 36, 4) * 0.0254;
  const blades = Math.round(clampNum(opts.blades ?? Math.max(3, Math.floor(H / 0.016)), 2, 30, 5));
  return cached(`vnt|${k(W)}|${k(H)}|${blades}`, () => {
    const frame = 0.010, T = 0.0035;
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(chamferBox(W, frame, T, 0.0008), { position: [0, H / 2 - frame / 2, 0] }));
    parts.push(transformed(chamferBox(W, frame, T, 0.0008), { position: [0, -H / 2 + frame / 2, 0] }));
    parts.push(transformed(chamferBox(frame, H, T, 0.0008), { position: [-W / 2 + frame / 2, 0, 0] }));
    parts.push(transformed(chamferBox(frame, H, T, 0.0008), { position: [W / 2 - frame / 2, 0, 0] }));
    const innerH = Math.max(0.004, H - frame * 2);
    const innerW = Math.max(0.004, W - frame * 2);
    for (let i = 0; i < blades; i++) {
      const y = -innerH / 2 + (innerH / blades) * (i + 0.5);
      parts.push(transformed(chamferBox(innerW, innerH / blades * 0.62, 0.0018, 0.0004), { position: [0, y, -0.0035], rotation: [-0.62, 0, 0] }));
    }
    parts.push(transformed(chamferCylinder(0.0025, 0.0018, 0.0004, 8), { position: [-W / 2 + frame / 2, H / 2 - frame / 2, T / 2 + 0.0009], rotation: [Math.PI / 2, 0, 0] }));
    parts.push(transformed(chamferCylinder(0.0025, 0.0018, 0.0004, 8), { position: [W / 2 - frame / 2, -H / 2 + frame / 2, T / 2 + 0.0009], rotation: [Math.PI / 2, 0, 0] }));
    return mergeDetail(parts);
  });
}

/** Recessed can: trim ring + baffle + lens, as one body plus a separate lens. */
export function ceilingCan(opts: { apertureIn?: number; baffle?: boolean } = {}): { trim: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const A = clampNum(opts.apertureIn ?? 4, 2, 10, 4) * 0.0254;
  const baffle = opts.baffle !== false;
  const R = A / 2;
  const trim = cached(`can|${k(R)}|${baffle ? 'b' : 'f'}`, () => {
    // Origin is the finished ceiling. The housing belongs ABOVE that plane,
    // not 64 mm into the room; only the 3 mm trim lip is below it.
    const p: Vec2[] = baffle
      ? [[R * 1.18, 0], [R * 1.20, -0.0015], [R * 1.12, -0.003], [R, -0.003], [R * 0.90, 0.020], [R * 0.86, 0.052], [R * 0.98, 0.054], [R * 1.10, 0.054], [R * 1.24, 0.020], [R * 1.24, 0]]
      : [[R * 1.18, 0], [R * 1.20, -0.0015], [R * 1.10, -0.003], [R, -0.003], [R, 0.040], [R * 1.16, 0.040], [R * 1.16, 0]];
    p.reverse();
    return lathePoints(p, 24);
  });
  // Lens sits just below the ceiling plane so an uncut shell cannot occlude
  // it. The baffle is housed above, with no protruding luminous cylinder.
  const lens = cached(`canl|${k(R)}`, () => transformed(applyWorldUVs(new THREE.CircleGeometry(R * 0.90, 24)), { rotation: [Math.PI / 2, 0, 0], position: [0, -0.001, 0] }));
  return { trim, lens };
}

/** Ceiling smoke detector. */
export function smokeDetector(): THREE.BufferGeometry {
  return cached('smk', () => mergeDetail([
    lathePoints([[0, 0], [0.064, 0], [0.066, -0.006], [0.062, -0.020], [0.048, -0.028], [0, -0.030]], 22),
    transformed(chamferCylinder(0.006, 0.004, 0.0004, 10), { position: [0.030, -0.030, 0] }),
  ]));
}

/** Wall thermostat. */
export function thermostat(): THREE.BufferGeometry {
  return cached('thm', () => mergeDetail([
    transformed(filletBox(0.084, 0.084, 0.024, 0.010, 3), { position: [0, 0, 0.012] }),
    transformed(filletBox(0.062, 0.062, 0.004, 0.006, 2), { position: [0, 0, 0.0255] }),
  ]));
}

// ---------------------------------------------------------------------------
// Repetition helpers used by every builder
// ---------------------------------------------------------------------------

/** Evenly spaced transforms along a line — pickets, balusters, spindles, pulls. */
export function spaceAlong(from: Vec3, to: Vec3, count: number, opts: { rotation?: Vec3; scale?: Vec3 | number; inset?: boolean } = {}): InstanceTransform[] {
  const n = Math.round(clampNum(count, 0, 2000, 0));
  if (n <= 0) return [];
  const out: InstanceTransform[] = [];
  const inset = opts.inset !== false;
  for (let i = 0; i < n; i++) {
    const t = inset ? (i + 0.5) / n : n === 1 ? 0.5 : i / (n - 1);
    out.push({
      position: [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ],
      rotation: opts.rotation,
      scale: opts.scale,
    });
  }
  return out;
}

/** A grid of transforms in the XY plane at a fixed z (tiles, shingles, panels). */
export function grid(cols: number, rows: number, dx: number, dy: number, opts: { origin?: Vec3; stagger?: number; jitter?: number; seed?: number } = {}): InstanceTransform[] {
  const c = Math.round(clampNum(cols, 0, 400, 0));
  const r = Math.round(clampNum(rows, 0, 400, 0));
  if (c <= 0 || r <= 0) return [];
  const o = opts.origin ?? [0, 0, 0];
  const stagger = clampNum(opts.stagger ?? 0, -1, 1, 0);
  const jitter = clampNum(opts.jitter ?? 0, 0, 0.2, 0);
  let seed = Math.round(clampNum(opts.seed ?? 1, 0, 1e9, 1)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const out: InstanceTransform[] = [];
  for (let j = 0; j < r; j++) {
    for (let i = 0; i < c; i++) {
      const off = (j % 2) * stagger * dx;
      out.push({
        position: [
          o[0] + i * dx + off + (jitter ? (rnd() - 0.5) * jitter * dx : 0),
          o[1] + j * dy + (jitter ? (rnd() - 0.5) * jitter * dy : 0),
          o[2],
        ],
      });
    }
  }
  return out;
}

/** Free the cached geometries (call on unmount of a whole project, not per frame). */
export function disposeDetailCache() {
  cache.forEach((g) => g.dispose());
  cache.clear();
}

/** How many distinct geometries the kit is holding (diagnostics). */
export function detailCacheSize(): number { return cache.size; }
