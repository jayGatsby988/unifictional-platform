/**
 * Geometry helpers for the procedural builders.
 *
 * World-space UVs: every surface geometry gets UVs in METERS (triplanar by
 * dominant normal). Materials then set texture.repeat = 1 / tileM so a texture
 * tiles at the same physical size on every mesh that shares it.
 */
import * as THREE from 'three';

export function applyWorldUVs(geometry: THREE.BufferGeometry, offset: [number, number] = [0, 0]): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  let nor = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!nor) { geometry.computeVertexNormals(); nor = geometry.getAttribute('normal') as THREE.BufferAttribute; }
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = x; v = z; }        // floor / ceiling / counters → XZ
    else if (nx >= nz) { u = z; v = y; }               // side walls → ZY
    else { u = x; v = y; }                             // back/front walls → XY
    uv[i * 2] = u + offset[0];
    uv[i * 2 + 1] = v + offset[1];
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** Box with world UVs, sized in meters. Cached by size so repeated cabinets share geometry. */
const boxCache = new Map<string, THREE.BoxGeometry>();
export function worldBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`;
  let g = boxCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    applyWorldUVs(g);
    boxCache.set(key, g);
  }
  return g;
}

/** Plane (facing +Y by default) with world UVs */
export function worldPlane(w: number, h: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  applyWorldUVs(g);
  return g;
}

/**
 * Rounded box for countertops / softened edges (tiny bevels catch light).
 *
 * PREFER `chamferBox` / `filletBox` from ./detail for new work: they are cached
 * by parameter (so 40 identical drawer fronts share one geometry), clamp every
 * input, and pair with `edgeProfile()` for a real ogee/bullnose counter edge.
 * This is kept for the builders that already call it.
 */
export function bevelBox(w: number, h: number, d: number, bevel = 0.004): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hw = w / 2, hd = d / 2, r = Math.min(bevel, hw / 4, hd / 4);
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd); shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
  shape.lineTo(hw, hd - r); shape.quadraticCurveTo(hw, hd, hw - r, hd);
  shape.lineTo(-hw + r, hd); shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
  shape.lineTo(-hw, -hd + r); shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -h / 2 + 0, 0);
  // ExtrudeGeometry extrudes along +Z then we rotate → height along Y; recentre vertically
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
  applyWorldUVs(g);
  return g;
}

/**
 * A wall panel with rectangular holes (windows/doors). Built in the XY plane,
 * facing +Z, width w and height h centred at origin. Holes are given in the
 * wall's local coordinates (x from -w/2..w/2, y from 0..h measured from floor).
 */
export function wallWithOpenings(w: number, h: number, thickness: number, holes: Array<{ x: number; y: number; w: number; h: number }>): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2, h); shape.lineTo(-w / 2, h); shape.closePath();
  for (const ho of holes) {
    const path = new THREE.Path();
    const x0 = Math.max(-w / 2 + 0.01, ho.x - ho.w / 2), x1 = Math.min(w / 2 - 0.01, ho.x + ho.w / 2);
    const y0 = Math.max(0.0, ho.y), y1 = Math.min(h - 0.01, ho.y + ho.h);
    if (x1 - x0 < 0.05 || y1 - y0 < 0.05) continue;
    path.moveTo(x0, y0); path.lineTo(x1, y0); path.lineTo(x1, y1); path.lineTo(x0, y1); path.closePath();
    shape.holes.push(path);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness); // front face at z=0, extends back
  applyWorldUVs(g);
  return g;
}

/** Simple gable / hip / shed roof solid. Returns geometry centred on footprint, base at y=0. */
export function roofGeometry(opts: { w: number; d: number; pitch: number; type: 'gable' | 'hip' | 'flat' | 'shed' | 'gambrel' | 'dutch-gable' | 'cross-gable'; overhang: number; ridge: 'x' | 'z'; thickness?: number }): THREE.BufferGeometry {
  const { pitch, overhang, ridge } = opts;
  const t = opts.thickness ?? 0.18;
  const w = opts.w + overhang * 2, d = opts.d + overhang * 2;
  const rise = (pitch / 12) * ((ridge === 'x' ? d : w) / 2);
  const type = opts.type;
  const geos: THREE.BufferGeometry[] = [];
  if (type === 'flat') {
    const g = new THREE.BoxGeometry(w, t, d); g.translate(0, t / 2, 0); geos.push(g);
  } else if (type === 'shed') {
    const g = new THREE.BoxGeometry(Math.hypot(d, rise) , t, w);
    g.rotateZ(Math.atan2(rise, d)); g.rotateY(Math.PI / 2); g.translate(0, rise / 2 + t / 2, 0); geos.push(g);
  } else if (type === 'hip') {
    // hip: pyramid-ish with ridge
    const ridgeLen = ridge === 'x' ? Math.max(0.5, w - d) : Math.max(0.5, d - w);
    const geo = new THREE.BufferGeometry();
    const hw = w / 2, hd = d / 2, rl = ridgeLen / 2;
    const v: number[] = [];
    const push = (...p: number[][]) => p.forEach((q) => v.push(...q));
    // Winding is counter-clockwise seen from OUTSIDE (above), so the generated
    // normals point up and the slopes are visible with FrontSide materials.
    if (ridge === 'x') {
      const r1 = [-rl, rise, 0], r2 = [rl, rise, 0];
      const a = [-hw, 0, -hd], b = [hw, 0, -hd], c = [hw, 0, hd], e = [-hw, 0, hd];
      push(b, a, r1, b, r1, r2);   // back slope (-z)
      push(e, c, r2, e, r2, r1);   // front slope (+z)
      push(c, b, r2);              // right hip (+x)
      push(a, e, r1);              // left hip (-x)
    } else {
      const r1 = [0, rise, -rl], r2 = [0, rise, rl];
      const a = [-hw, 0, -hd], b = [hw, 0, -hd], c = [hw, 0, hd], e = [-hw, 0, hd];
      push(c, b, r1, c, r1, r2);   // right slope (+x)
      push(a, e, r2, a, r2, r1);   // left slope (-x)
      push(b, a, r1);              // back hip (-z)
      push(e, c, r2);              // front hip (+z)
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    geos.push(geo);
    // underside
    const under = new THREE.BoxGeometry(w, 0.02, d); under.translate(0, -0.01, 0); geos.push(under);
  } else {
    // gable (and gambrel/dutch/cross fall back to gable)
    const along = ridge === 'x' ? w : d;      // ridge length
    const across = ridge === 'x' ? d : w;     // span
    const slopeLen = Math.hypot(across / 2, rise);
    const ang = Math.atan2(rise, across / 2);
    // Each slope is a slab lying along the ridge, hinged down from the ridge
    // line: build it centred on the ridge, rotate about X so the far edge drops
    // to the eave, then lift so the eave lands at y = 0 and the ridge at y = rise.
    const mk = (sign: 1 | -1) => {
      const g = new THREE.BoxGeometry(along, t, slopeLen);
      g.translate(0, -t / 2, sign * (slopeLen / 2));   // hang off the ridge, underside down
      g.rotateX(sign * ang);                            // tilt down toward the eave
      g.translate(0, rise, 0);                          // ridge to its real height
      return g;
    };
    const s1 = mk(1), s2 = mk(-1);
    if (ridge === 'z') { s1.rotateY(Math.PI / 2); s2.rotateY(Math.PI / 2); }
    geos.push(s1, s2);
    // gable end triangles (filled by wall builder using gableEnd) — here we add thin closure to avoid see-through
    const tri = new THREE.Shape();
    tri.moveTo(-across / 2, 0); tri.lineTo(across / 2, 0); tri.lineTo(0, rise); tri.closePath();
    const eg = new THREE.ExtrudeGeometry(tri, { depth: along, bevelEnabled: false });
    eg.translate(0, 0, -along / 2);
    if (ridge === 'x') eg.rotateY(Math.PI / 2);
    geos.push(eg);
  }
  const merged = mergeGeometries(geos);
  applyWorldUVs(merged);
  return merged;
}

/**
 * Minimal merge (non-indexed) so we don't need BufferGeometryUtils import churn.
 * By default keeps position + normal; run `applyWorldUVs` on the result.
 * `preserveUVs` keeps per-piece metre UVs for directional joinery stock.
 */
export function mergeGeometries(geos: THREE.BufferGeometry[], preserveUVs = false): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of parts) count += g.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = preserveUVs ? new Float32Array(count * 2) : null;
  let o = 0;
  for (const g of parts) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, o * 3);
    nor.set(n.array as Float32Array, o * 3);
    if (uv) {
      if (!g.getAttribute('uv')) applyWorldUVs(g);
      uv.set(g.getAttribute('uv').array as Float32Array, o * 2);
    }
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/**
 * Cylinder with world UVs (columns, faucets, pendant cords).
 *
 * PREFER `creasedLathe` below, or `chamferCylinder` from ./detail: three's
 * CylinderGeometry shares the rim vertex between the wall and the end cap and
 * averages their normals, so the wall shades like a cone and the cap like a
 * dome (26.6° out, measured — see `creasedLathe`). Nothing in the scene calls
 * this any more; it is kept because check-3d.ts pins its behaviour.
 */
export function worldCylinder(rTop: number, rBottom: number, h: number, seg = 24): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  applyWorldUVs(g);
  return g;
}

/**
 * Shaker-style door: outer frame box + recessed centre panel. Returns two
 * geometries positioned relative to door centre, facing +Z.
 *
 * PREFER `doorPanel(style, w, h)` from ./detail: it returns ONE merged, cached,
 * chamfered body (plus a separate glass sheet for glass fronts), builds real
 * stiles/rails with a wider bottom rail, and supports raised, beaded and
 * glass fronts. This remains for existing callers.
 */
export function shakerDoorParts(w: number, h: number, style: 'shaker' | 'flat' | 'raised' | 'slab' | 'beaded' | 'glass' | 'open', thickness = 0.019, rail = 0.06) {
  const frameDepth = thickness;
  const panelInset = style === 'raised' ? -0.004 : 0.006;
  if (style === 'flat' || style === 'slab') {
    return { frame: null as THREE.BufferGeometry | null, panel: worldBox(w, h, frameDepth), panelZ: 0, glass: false };
  }
  const r = Math.min(rail, w / 3, h / 3);
  const frame = new THREE.Shape();
  frame.moveTo(-w / 2, -h / 2); frame.lineTo(w / 2, -h / 2); frame.lineTo(w / 2, h / 2); frame.lineTo(-w / 2, h / 2); frame.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-w / 2 + r, -h / 2 + r); hole.lineTo(w / 2 - r, -h / 2 + r); hole.lineTo(w / 2 - r, h / 2 - r); hole.lineTo(-w / 2 + r, h / 2 - r); hole.closePath();
  frame.holes.push(hole);
  const fg = new THREE.ExtrudeGeometry(frame, { depth: frameDepth, bevelEnabled: false });
  fg.translate(0, 0, -frameDepth / 2);
  applyWorldUVs(fg);
  const panel = worldBox(w - 2 * r + 0.002, h - 2 * r + 0.002, Math.max(0.004, frameDepth - panelInset));
  return { frame: fg, panel, panelZ: -panelInset / 2, glass: style === 'glass' };
}

// ---------------------------------------------------------------------------
// Room conventions shared by every builder
// ---------------------------------------------------------------------------
/**
 * Room frame: centred at origin, floor y=0, +y up.
 *   back wall  z = -d/2, faces +z (into room)
 *   front wall z = +d/2, faces -z
 *   left wall  x = -w/2, faces +x
 *   right wall x = +w/2, faces -x
 * `t` (0..1) runs left→right AS SEEN BY SOMEONE INSIDE THE ROOM FACING THAT WALL.
 * Returns a frame so you can place things along a wall:
 *   world = origin + along * (t * length) + normal * offsetIntoRoom
 */
export function wallFrame(wall: 'back' | 'front' | 'left' | 'right', w: number, d: number) {
  switch (wall) {
    case 'back': return { origin: new THREE.Vector3(-w / 2, 0, -d / 2), along: new THREE.Vector3(1, 0, 0), normal: new THREE.Vector3(0, 0, 1), length: w, yaw: 0 };
    case 'front': return { origin: new THREE.Vector3(w / 2, 0, d / 2), along: new THREE.Vector3(-1, 0, 0), normal: new THREE.Vector3(0, 0, -1), length: w, yaw: Math.PI };
    case 'left': return { origin: new THREE.Vector3(-w / 2, 0, d / 2), along: new THREE.Vector3(0, 0, -1), normal: new THREE.Vector3(1, 0, 0), length: d, yaw: Math.PI / 2 };
    case 'right': return { origin: new THREE.Vector3(w / 2, 0, -d / 2), along: new THREE.Vector3(0, 0, 1), normal: new THREE.Vector3(-1, 0, 0), length: d, yaw: -Math.PI / 2 };
  }
}

/** Position on a wall: t along (0..1), height y, and how far into the room (m). Returns [x,y,z]. */
export function onWall(wall: 'back' | 'front' | 'left' | 'right', w: number, d: number, t: number, y: number, into = 0): [number, number, number] {
  const f = wallFrame(wall, w, d);
  const p = f.origin.clone().addScaledVector(f.along, t * f.length).addScaledVector(f.normal, into);
  return [p.x, y, p.z];
}

/**
 * Single-sided wall face (ShapeGeometry with holes) in the wall's local XY
 * plane: x from -length/2..length/2 (left→right as seen from inside), y from
 * 0..h, facing +Z. Rotate by wallFrame(...).yaw and translate to the wall's
 * centre. Because it is single-sided, an orbiting camera outside the room
 * sees straight through it (back-face culled) — the "dollhouse" trick.
 */
export function wallFace(length: number, h: number, holes: Array<{ x: number; y: number; w: number; h: number }> = []): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2, 0); shape.lineTo(length / 2, 0); shape.lineTo(length / 2, h); shape.lineTo(-length / 2, h); shape.closePath();
  for (const ho of holes) {
    const x0 = Math.max(-length / 2 + 0.01, ho.x - ho.w / 2), x1 = Math.min(length / 2 - 0.01, ho.x + ho.w / 2);
    const y0 = Math.max(0.0, ho.y), y1 = Math.min(h - 0.01, ho.y + ho.h);
    if (x1 - x0 < 0.05 || y1 - y0 < 0.05) continue;
    const path = new THREE.Path();
    path.moveTo(x0, y0); path.lineTo(x1, y0); path.lineTo(x1, y1); path.lineTo(x0, y1); path.closePath();
    shape.holes.push(path);
  }
  const g = new THREE.ShapeGeometry(shape, 1);
  applyWorldUVs(g);
  return g;
}

/** Place a wall face built by wallFace() onto a room wall. Returns position + rotation for a <mesh>. */
export function wallPlacement(wall: 'back' | 'front' | 'left' | 'right', w: number, d: number): { position: [number, number, number]; rotation: [number, number, number] } {
  const f = wallFrame(wall, w, d);
  const c = f.origin.clone().addScaledVector(f.along, f.length / 2);
  return { position: [c.x, 0, c.z], rotation: [0, f.yaw, 0] };
}

// ---------------------------------------------------------------------------
// Turned parts (surfaces of revolution)
// ---------------------------------------------------------------------------

/**
 * How many segments a circle of this radius needs before its silhouette stops
 * looking like a polygon.
 *
 * The argument is a RADIUS. Derived from the SAGITTA, not guessed: n segments
 * put the chord `r(1-cos(π/n))` inside the true circle, so solving for a fixed
 * tolerance gives a count that scales with the part. Measured: a 3 mm faucet
 * tube radius gets 8 (the floor), an 8 mm one gets 10, a 17 mm one 14 and a
 * 170 mm stool-seat radius 46 — which is the right way round. The old fixed
 * 12–26 everywhere spent the same triangles on both and left the big ones
 * visibly faceted.
 *
 * 0.4 mm is roughly a pixel at the distance a counter prop is looked at.
 */
export function latheSegments(radius: number, toleranceM = 0.0004): number {
  const r = Math.abs(radius);
  const tol = Math.abs(toleranceM);
  if (!Number.isFinite(r) || !Number.isFinite(tol) || tol <= 0 || r <= tol) return 8;
  const half = Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
  if (!(half > 1e-6)) return 48;
  return Math.max(8, Math.min(48, Math.round(Math.PI / half / 2) * 2));
}

const latheCache = new Map<string, THREE.BufferGeometry>();

/**
 * Revolve a profile around +Y with CREASE-AWARE normals.
 *
 * WHY THIS EXISTS. `THREE.LatheGeometry` averages the normal at every profile
 * vertex unconditionally, including across a 90° corner. Measured on a plain
 * flat-topped cylinder, the vertex where the wall meets the cap comes back as
 * (0, -0.447, 0.894) — 26.6° off the wall's true normal — so the wall shades
 * like a cone and the cap like a dome. That soft, waxy, edge-less look on every
 * lid, foot ring, bowl rim and cylinder end is one of the loudest CG tells in
 * the room, and it is invisible in a flat-shaded preview, which is why it
 * survived this long.
 *
 * Here a profile joint is welded (smooth) only when the two segments meet
 * within `creaseDeg`; past that the ring is duplicated and each side keeps its
 * own normal, so a curve stays curved and an arris stays sharp.
 *
 * Conventions match three exactly — x = r·sin φ, z = r·cos φ, and the profile
 * read bottom-to-top faces outward — so this is a drop-in replacement and
 * nothing flips. Pole rings (radius 0) emit one triangle per step instead of a
 * degenerate pair, which is also slightly cheaper.
 *
 * Points are [radius, y]. Cached by rounded parameters and SHARED: never mutate
 * what you get back.
 */
export function creasedLathe(profile: Array<[number, number]>, segments = 24, creaseDeg = 32): THREE.BufferGeometry {
  const pts: Array<[number, number]> = [];
  for (const p of profile) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const r = Math.max(0, p[0]);
    const last = pts[pts.length - 1];
    // a repeated point has no direction, so its normal would be NaN
    if (last && Math.abs(last[0] - r) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue;
    pts.push([r, p[1]]);
  }
  if (pts.length < 2) return worldBox(0.001, 0.001, 0.001);
  const seg = Math.max(3, Math.min(128, Math.round(Number.isFinite(segments) ? segments : 24)));
  const crease = Math.max(0, Math.min(179, Number.isFinite(creaseDeg) ? creaseDeg : 32));
  const key = `lth|${seg}|${crease.toFixed(1)}|${pts.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';')}`;
  const hit = latheCache.get(key);
  if (hit) return hit;

  const S = pts.length - 1;
  // per-segment 2D normal, three's convention: (dy, -dr) normalised
  const segN: Array<[number, number]> = [];
  for (let i = 0; i < S; i++) {
    const dr = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dr, dy) || 1;
    segN.push([dy / len, -dr / len]);
  }
  // welded[j] is the shared normal at interior joint j (between segment j-1 and
  // j) when the two meet inside the crease angle, else null
  const cosLimit = Math.cos((crease * Math.PI) / 180);
  const welded: Array<[number, number] | null> = [];
  for (let j = 1; j < S; j++) {
    const a = segN[j - 1], b = segN[j];
    if (a[0] * b[0] + a[1] * b[1] < cosLimit) { welded.push(null); continue; }
    const nx = a[0] + b[0], ny = a[1] + b[1];
    const len = Math.hypot(nx, ny);
    welded.push(len < 1e-6 ? null : [nx / len, ny / len]);
  }
  const startN = (i: number) => (i > 0 ? welded[i - 1] : null) ?? segN[i];
  const endN = (i: number) => (i < S - 1 ? welded[i] : null) ?? segN[i];

  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const ringCount = seg + 1;                 // duplicate the seam so UVs stay sane
  const cosT: number[] = [], sinT: number[] = [];
  for (let kk = 0; kk < ringCount; kk++) {
    const phi = (kk / seg) * Math.PI * 2;
    sinT.push(Math.sin(phi)); cosT.push(Math.cos(phi));
  }
  for (let i = 0; i < S; i++) {
    const A = pts[i], B = pts[i + 1];
    if (A[0] < 1e-9 && B[0] < 1e-9) continue;   // a segment on the axis has no surface
    const nA = startN(i), nB = endN(i);
    const base = pos.length / 3;
    for (const [p, n] of [[A, nA], [B, nB]] as Array<[[number, number], [number, number]]>) {
      for (let kk = 0; kk < ringCount; kk++) {
        pos.push(p[0] * sinT[kk], p[1], p[0] * cosT[kk]);
        nor.push(n[0] * sinT[kk], n[1], n[0] * cosT[kk]);
      }
    }
    for (let kk = 0; kk < seg; kk++) {
      const a = base + kk, b = base + kk + 1;
      const c = base + ringCount + kk, d = base + ringCount + kk + 1;
      // a = A@k, b = A@k+1, c = B@k, d = B@k+1 — same winding three uses, so
      // a profile written bottom-to-top comes out front-facing outward
      if (A[0] < 1e-9) idx.push(d, c, b);
      else if (B[0] < 1e-9) idx.push(a, b, c);
      else { idx.push(a, b, c, d, c, b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  applyWorldUVs(g);
  latheCache.set(key, g);
  return g;
}

/** Dispose the turned-part cache (hot reload / tests). */
export function disposeLatheCache() {
  for (const g of latheCache.values()) g.dispose();
  latheCache.clear();
}
