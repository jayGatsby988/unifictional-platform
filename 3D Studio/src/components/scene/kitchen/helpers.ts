/**
 * Kitchen-specific geometry. Everything the shared detail kit does not already
 * ship: appliance internals, sink bowls, stools, styling props and the small
 * pieces of cabinet trim that only a kitchen has.
 *
 * CONTRACT (same as `scene/detail.ts`)
 *  - metres; every builder is CACHED by its rounded parameters and the result
 *    is SHARED — never mutate what you get back;
 *  - world-space (metre) UVs so catalog textures tile at their real size;
 *  - every input clamped, nothing throws;
 *  - front faces point +Z, "up" is +Y, runs are along X.
 *
 * Prefer `detail.ts` for anything generic (chamferBox, doorPanel, barPull,
 * profileMoulding, outletPlate…). This file is only what is genuinely kitchen.
 */
import * as THREE from 'three';
import { applyWorldUVs, creasedLathe, disposeLatheCache, latheSegments, mergeGeometries } from '@/components/scene/geometry';
import {
  chamferBox, clampNum, filletBox, mergeDetail,
  PROFILES, profileMoulding, sweepProfile, transformed, type Vec2, type Vec3,
} from '@/components/scene/detail';
import { cupProfile, curtainGeometry } from '@/components/scene/bathroom/helpers';
import { inch } from '@/lib/units';

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = build(); cache.set(key, g); }
  return g;
}
const k = (n: number) => n.toFixed(4);
const num = (v: number, lo: number, hi: number, fb: number) => clampNum(v, lo, hi, fb);

/**
 * Every turned part in this file goes through the CREASE-AWARE lathe.
 *
 * three's own LatheGeometry averages the normal across a hard corner, so the
 * rim of a lid, the foot of a bowl and the end of any cylinder shade as if they
 * were rounded — measured, 26.6° off on a plain flat-topped cylinder. That soft
 * waxy edge is one of the loudest CG tells and a flat-shaded preview cannot show
 * it, so it is fixed at the primitive (see `creasedLathe` in geometry.ts) rather
 * than at forty call sites.
 */
function lathePoints(profile: Vec2[], segments = 8): THREE.BufferGeometry {
  // Under 8 segments is a DELIBERATE polygon — the square basket, a hexagonal
  // knob — so it is taken literally. At 8 and above the caller meant "round",
  // and the hand-picked 12–26 was an under-count on everything bigger than a
  // knob: a 170 mm stool-seat radius needs 46 and an 8 mm tube radius needs 10
  // (a 3 mm one is already at the 8-segment floor). So the written number is a
  // FLOOR and the radius decides.
  if (segments < 8) return creasedLathe(profile as Array<[number, number]>, segments);
  let r = 0;
  for (const p of profile) if (Number.isFinite(p[0])) r = Math.max(r, Math.abs(p[0]));
  return creasedLathe(profile as Array<[number, number]>, Math.max(segments, latheSegments(r)));
}

/**
 * Segment count for a turned part, from its RADIUS rather than a fixed number:
 * a 3 mm tube radius gets 8, an 8 mm one gets 10 and a 170 mm stool-seat radius
 * gets 46, so the triangles land where the silhouette is actually visible.
 * Pass `seg` to override.
 */
function cyl(r: number, h: number, seg?: number, chamfer = 0.0004): THREE.BufferGeometry {
  const R = num(r, 0.0005, 5, 0.01);
  const H = num(h, 0.0005, 20, 0.05);
  const c = Math.min(num(chamfer, 0, 0.05, 0.0004), R / 3, H / 3);
  // the chamfer is a real broken edge, not a fillet: at 45° to both the wall and
  // the cap it is past the crease angle, so each face keeps its own normal
  return creasedLathe([
    [0, -H / 2], [R - c, -H / 2], [R, -H / 2 + c],
    [R, H / 2 - c], [R - c, H / 2], [0, H / 2],
  ], seg ?? latheSegments(R));
}
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.filter((p) => p && p.getAttribute('position')?.count));
  applyWorldUVs(g);
  return g;
}

/**
 * A bowl / cup / carafe from `cupProfile`'s closed section, at a real radius.
 *
 * WHY NOT `cupLathe`. cupProfile is written from the inside floor, out over the
 * rim and down to the base — the opposite of three's direction convention — so
 * cupLathe probes one vertex, decides the whole thing is inside-out and flips
 * the winding and the normals. That flip cannot survive the
 * `computeVertexNormals()` it does first: the 180° fold at the rim averages the
 * inner and outer faces into a normal that opposes BOTH. Audited over the
 * client-tan kitchen it left ~200 back-facing vertices and two zero-length
 * normals on every bowl in the room, which is a bowl whose inside shades black
 * and whose rim has no edge. Reversing the profile and creasing it gets the
 * outer wall, the rolled rim, the inner wall and the foot ring each with their
 * own correct normal, and needs no flip at all.
 *
 * `radius` scales the unit profile BEFORE the lathe, so the cached geometry is
 * never mutated afterwards and the segment count matches the real silhouette.
 */
function cupShell(profile: Array<[number, number]>, radius: number, segments?: number): THREE.BufferGeometry {
  const R = num(radius, 0.002, 2, 0.1);
  const rev: Array<[number, number]> = [];
  for (let i = profile.length - 1; i >= 0; i--) rev.push([profile[i][0] * R, profile[i][1]]);
  return creasedLathe(rev, segments ?? latheSegments(R));
}

/** Rounded rectangle path, used for basins, cook-tops and appliance bezels. */
function roundedRectShape(w: number, d: number, r: number): THREE.Shape {
  const hw = w / 2, hd = d / 2;
  const rad = Math.max(0, Math.min(r, hw * 0.98, hd * 0.98));
  const s = new THREE.Shape();
  s.moveTo(-hw + rad, -hd);
  s.lineTo(hw - rad, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + rad);
  s.lineTo(hw, hd - rad); s.quadraticCurveTo(hw, hd, hw - rad, hd);
  s.lineTo(-hw + rad, hd); s.quadraticCurveTo(-hw, hd, -hw, hd - rad);
  s.lineTo(-hw, -hd + rad); s.quadraticCurveTo(-hw, -hd, -hw + rad, -hd);
  s.closePath();
  return s;
}
function roundedRectPath(w: number, d: number, r: number): THREE.Path {
  const p = new THREE.Path();
  const hw = w / 2, hd = d / 2;
  const rad = Math.max(0, Math.min(r, hw * 0.98, hd * 0.98));
  p.moveTo(-hw + rad, -hd);
  p.lineTo(hw - rad, -hd); p.quadraticCurveTo(hw, -hd, hw, -hd + rad);
  p.lineTo(hw, hd - rad); p.quadraticCurveTo(hw, hd, hw - rad, hd);
  p.lineTo(-hw + rad, hd); p.quadraticCurveTo(-hw, hd, -hw, hd - rad);
  p.lineTo(-hw, -hd + rad); p.quadraticCurveTo(-hw, -hd, -hw + rad, -hd);
  p.closePath();
  return p;
}

// ---------------------------------------------------------------------------
// Cabinet carcass + trim
// ---------------------------------------------------------------------------

/** Cabinet box. Chamfered so the carcass edge beside a reveal catches light. */
export function cabinetBox(w: number, h: number, d: number): THREE.BufferGeometry {
  return chamferBox(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d), 0.0012);
}

/** 3/4" shelf with an eased front edge. */
export function shelfBoard(w: number, dpt: number, t = inch(0.75)): THREE.BufferGeometry {
  return chamferBox(Math.max(0.02, w), Math.max(0.004, t), Math.max(0.02, dpt), 0.0010);
}

/** Toe board: the recessed dark strip under a base cabinet. */
export function toeBoard(w: number, h: number, t = inch(0.5)): THREE.BufferGeometry {
  return chamferBox(Math.max(0.02, w), Math.max(0.01, h), Math.max(0.004, t), 0.0008);
}

/** Finished end / scribe filler panel with a chamfered outside corner. */
export function panelStrip(w: number, h: number, t: number): THREE.BufferGeometry {
  return chamferBox(Math.max(0.004, w), Math.max(0.01, h), Math.max(0.004, t), 0.0010);
}

/**
 * Light rail (valance) under a run of wall cabinets. Spans X centred, hangs
 * below y = 0 and returns to the cabinet face at z = 0, projecting toward +Z.
 */
export function lightRail(len: number, drop = inch(1.5), proj = inch(0.75)): THREE.BufferGeometry {
  const L = num(len, 0.05, 30, 1);
  const H = num(drop, 0.01, 0.2, inch(1.5));
  const P = num(proj, 0.005, 0.2, inch(0.75));
  return cached(`lrail|${k(L)}|${k(H)}|${k(P)}`, () => {
    const prof: Vec2[] = [
      [0, 0], [P, 0], [P, -H * 0.55], [P * 0.72, -H * 0.82], [P * 0.30, -H],
      [0, -H], [0, 0],
    ];
    return sweepProfile(prof, [[-L / 2, 0, 0], [L / 2, 0, 0]], { up: [0, 1, 0] });
  });
}

/**
 * Crown for a cabinet run.
 *
 * Two things a procedural crown almost always gets wrong:
 *  - ORIENTATION. The stock profile is drawn springing UP from a wall leg, so
 *    it has to be flipped and lifted to sit on top of a cabinet, otherwise it
 *    reads as an upside-down cove.
 *  - ENDS. A crown that simply stops in mid air is the loudest "3D model" tell
 *    there is. A real one RETURNS to the wall, and the mitre at that corner is
 *    what catches the light. Because the return is part of the same swept path,
 *    `sweepProfile` mitres it for free.
 *
 * Authored in the run's wall frame: x along the run, y at the top of the boxes,
 * z = 0 at the wall and `faceZ` at the cabinet face.
 */
export function crownRun(
  x0: number, x1: number, y: number, faceZ: number,
  opts: { scale?: number; returnLo?: boolean; returnHi?: boolean; profile?: 'ogee-crown' | 'cove-crown' | 'crown-simple' | 'stepped-crown' } = {},
): THREE.BufferGeometry {
  const a = Math.min(x0, x1), b = Math.max(x0, x1);
  if (b - a < 0.02) return chamferBox(0.001, 0.001, 0.001, 0);
  const s = num(opts.scale ?? 1, 0.2, 3, 1);
  const face = num(faceZ, 0.02, 1.2, 0.3);
  const name = opts.profile ?? 'ogee-crown';
  const key = `crown|${name}|${k(a)}|${k(b)}|${k(y)}|${k(face)}|${k(s)}|${opts.returnLo ? 1 : 0}|${opts.returnHi ? 1 : 0}`;
  return cached(key, () => {
    let top = 0;
    for (const q of PROFILES[name]) top = Math.max(top, q[1]);
    const path: Vec3[] = [];
    if (opts.returnLo) path.push([a, y, 0]);
    path.push([a, y, face], [b, y, face]);
    if (opts.returnHi) path.push([b, y, 0]);
    // flipY + lift: the stock section springs upward from its wall leg, so it
    // has to be turned over and raised to sit ON the cabinet with its widest
    // projection at the TOP, which is what a cabinet crown actually does.
    return profileMoulding(path, name, { scale: s, up: [0, 1, 0], flipY: true, offset: [0, top * s] });
  });
}

// ---------------------------------------------------------------------------
// Hardware that is specific to appliances
// ---------------------------------------------------------------------------

/**
 * Heavy commercial appliance handle: a thick bar on two stand-offs with visible
 * set screws. `vertical` swaps the bar to the Y axis. Stands off toward +Z.
 */
export function applianceHandle(len: number, vertical = false, stand = 0.055): THREE.BufferGeometry {
  const L = num(len, 0.08, 1.6, 0.4);
  const S = num(stand, 0.02, 0.14, 0.055);
  return cached(`ahnd|${k(L)}|${vertical}|${k(S)}`, () => {
    const r = 0.0105;
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(cyl(r, L, 16, 0.0012), { position: [0, 0, S], rotation: vertical ? [0, 0, 0] : [0, 0, Math.PI / 2] }));
    for (const sgn of [-1, 1]) {
      const off = sgn * (L / 2 - 0.03);
      const px = vertical ? 0 : off;
      const py = vertical ? off : 0;
      parts.push(transformed(cyl(0.009, S, 12), { position: [px, py, S / 2], rotation: [Math.PI / 2, 0, 0] }));
      parts.push(transformed(cyl(0.016, 0.006, 16), { position: [px, py, 0.003], rotation: [Math.PI / 2, 0, 0] }));
      parts.push(transformed(cyl(0.0022, 0.0016, 8), { position: [px, py + 0.010, 0.0068], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  });
}

/** Recessed pocket handle along the top of an integrated dishwasher panel. */
export function pocketHandle(len: number): THREE.BufferGeometry {
  const L = num(len, 0.08, 1.5, 0.5);
  return cached(`pock|${k(L)}`, () => {
    const h = inch(1.4), d = inch(1.1), t = 0.0022;
    return mergeDetail([
      transformed(chamferBox(L, t, d, 0.0006), { position: [0, h / 2, -d / 2] }),
      transformed(chamferBox(L, h, t, 0.0006), { position: [0, 0, -d + t / 2] }),
      transformed(chamferBox(L, t, d * 0.55, 0.0006), { position: [0, -h / 2, -d * 0.72] }),
    ]);
  });
}

/** Row of appliance control knobs on a fascia (centred, facing +Z). */
export function controlKnobs(count: number, pitch: number): THREE.BufferGeometry {
  const n = Math.round(num(count, 1, 8, 4));
  const p = num(pitch, 0.03, 0.2, 0.1);
  return cached(`kctrl|${n}|${k(p)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * p;
      parts.push(transformed(lathePoints([[0, 0], [0.020, 0], [0.019, 0.008], [0.016, 0.018], [0.017, 0.026], [0.014, 0.030], [0, 0.030]], 18), { position: [x, 0, 0], rotation: [-Math.PI / 2, 0, 0] }));
      parts.push(transformed(chamferBox(0.0035, 0.011, 0.0035, 0.0006), { position: [x, 0.009, 0.031] }));
      parts.push(transformed(cyl(0.024, 0.0016, 20), { position: [x, 0, 0.0008], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  });
}

/** Cast-iron grates + sealed burner caps for a gas range (origin at the deck). */
export function burnerGrates(w: number, dpt: number, burners: number): THREE.BufferGeometry {
  const W = num(w, 0.2, 1.8, 0.7);
  const D = num(dpt, 0.2, 1.0, 0.55);
  const n = Math.round(num(burners, 2, 8, 4));
  return cached(`kgrate|${k(W)}|${k(D)}|${n}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const cols = n >= 6 ? 3 : 2;
    const rows = 2;
    const cw = Math.min((W - inch(2)) / cols, inch(13));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (c * rows + r >= n) break;
        const cx = -W / 2 + (W / cols) * (c + 0.5);
        const cz = -D / 2 + (D / rows) * (r + 0.5);
        const ring = new THREE.TorusGeometry(cw * 0.30, inch(0.22), 8, latheSegments(cw * 0.30));
        ring.rotateX(Math.PI / 2); ring.translate(cx, inch(0.72), cz);
        parts.push(ring);
        // sealed burner: base ring, cap, and the flame ports under the cap
        parts.push(transformed(lathePoints([[0, 0], [cw * 0.20, 0], [cw * 0.20, inch(0.20)], [cw * 0.15, inch(0.30)], [0, inch(0.30)]], 16), { position: [cx, 0, cz] }));
        parts.push(transformed(lathePoints([[0, 0], [cw * 0.17, 0], [cw * 0.16, inch(0.16)], [cw * 0.09, inch(0.22)], [0, inch(0.22)]], 16), { position: [cx, inch(0.30), cz] }));
        for (let a = 0; a < 4; a++) {
          const ang = (a / 4) * Math.PI * 2 + Math.PI / 4;
          const bar = chamferBox(cw * 0.52, inch(0.26), inch(0.26), 0.0006).clone();
          bar.translate(cw * 0.29, 0, 0);
          bar.rotateY(-ang);
          bar.translate(cx, inch(0.72), cz);
          parts.push(bar);
        }
      }
    }
    return merged(parts);
  });
}

/** Printed induction / radiant rings on a glass cook-top (origin at the glass). */
export function cooktopRings(w: number, dpt: number, burners = 4): THREE.BufferGeometry {
  const W = num(w, 0.2, 1.6, 0.7);
  const D = num(dpt, 0.15, 0.9, 0.5);
  const n = Math.round(num(burners, 2, 6, 4));
  return cached(`kctop|${k(W)}|${k(D)}|${n}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const cols = n >= 5 ? 3 : 2;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 2; r++) {
        if (c * 2 + r >= n) break;
        const cx = -W / 2 + (W / cols) * (c + 0.5);
        const cz = -D / 2 + (D / 2) * (r + 0.5);
        const rad = Math.min(W / cols, D / 2) * 0.30;
        const ring = new THREE.TorusGeometry(rad, 0.0022, 5, latheSegments(rad));
        ring.rotateX(Math.PI / 2); ring.translate(cx, 0.001, cz);
        parts.push(ring);
      }
    }
    // touch control strip along the front edge
    parts.push(transformed(chamferBox(W * 0.5, 0.0012, D * 0.10, 0.0004), { position: [0, 0.0008, D / 2 - D * 0.09] }));
    return parts.length ? merged(parts) : chamferBox(0.001, 0.001, 0.001, 0);
  });
}

/** Wine-fridge / open-shelf wire rack. */
export function wireRack(w: number, dpt: number, bars = 7): THREE.BufferGeometry {
  const W = num(w, 0.1, 1.4, 0.5);
  const D = num(dpt, 0.05, 0.9, 0.4);
  const n = Math.round(num(bars, 3, 14, 7));
  return cached(`krack|${k(W)}|${k(D)}|${n}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const z of [-D / 2 + 0.02, D / 2 - 0.02]) parts.push(transformed(cyl(0.0026, W, 8), { position: [0, 0, z], rotation: [0, 0, Math.PI / 2] }));
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (W / (n - 1 || 1)) * i;
      parts.push(transformed(cyl(0.0022, D, 8), { position: [x, 0, 0], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  });
}

/** Brand badge on an appliance door (a raised nameplate, never a texture). */
export function applianceBadge(w = 0.09): THREE.BufferGeometry {
  const W = num(w, 0.03, 0.3, 0.09);
  return cached(`badge|${k(W)}`, () => mergeDetail([
    transformed(filletBox(W, W * 0.16, 0.0016, 0.0006, 2), { position: [0, 0, 0.0008] }),
    transformed(filletBox(W * 0.86, W * 0.06, 0.0022, 0.0004, 1), { position: [0, 0, 0.0018] }),
  ]));
}

/** Through-the-door water / ice dispenser: recess, paddle, drip tray, keypad. */
export function waterDispenser(w = 0.19, h = 0.27): THREE.BufferGeometry {
  const W = num(w, 0.08, 0.4, 0.19);
  const H = num(h, 0.1, 0.6, 0.27);
  return cached(`disp|${k(W)}|${k(H)}`, () => {
    const dep = 0.055;
    const parts: THREE.BufferGeometry[] = [];
    // recess walls (the cavity itself is read as a dark opening)
    parts.push(transformed(chamferBox(W, 0.004, dep, 0.0008), { position: [0, H / 2, -dep / 2] }));
    parts.push(transformed(chamferBox(W, 0.004, dep, 0.0008), { position: [0, -H / 2, -dep / 2] }));
    for (const sx of [-1, 1]) parts.push(transformed(chamferBox(0.004, H, dep, 0.0008), { position: [(sx * W) / 2, 0, -dep / 2] }));
    parts.push(transformed(chamferBox(W, H, 0.004, 0.0008), { position: [0, 0, -dep] }));
    // paddle + spout + drip grille
    parts.push(transformed(chamferBox(W * 0.62, H * 0.28, 0.008, 0.0010), { position: [0, -H * 0.06, -dep + 0.016], rotation: [0.14, 0, 0] }));
    parts.push(transformed(cyl(0.009, 0.022, 12), { position: [0, H * 0.28, -dep + 0.018] }));
    parts.push(transformed(chamferBox(W * 0.80, 0.006, dep * 0.7, 0.0006), { position: [0, -H / 2 + 0.006, -dep * 0.55] }));
    for (let i = 0; i < 5; i++) {
      parts.push(transformed(chamferBox(W * 0.70, 0.0016, 0.0016, 0), { position: [0, -H / 2 + 0.010, -dep * 0.85 + i * (dep * 0.14)] }));
    }
    // control keypad above the recess
    for (let i = 0; i < 3; i++) {
      parts.push(transformed(filletBox(W * 0.22, H * 0.10, 0.0022, 0.0008, 1), { position: [(i - 1) * W * 0.28, H / 2 + H * 0.12, 0.0011] }));
    }
    return merged(parts);
  });
}

/** Appliance door gasket: the soft dark frame just inside a fridge door edge. */
export function doorGasket(w: number, h: number, band = inch(0.9)): THREE.BufferGeometry {
  const W = num(w, 0.05, 1.6, 0.4);
  const H = num(h, 0.05, 2.2, 0.8);
  const B = num(band, 0.005, 0.06, inch(0.9));
  return cached(`gskt|${k(W)}|${k(H)}|${k(B)}`, () => {
    const t = 0.006;
    return mergeDetail([
      transformed(chamferBox(W, B, t, 0.0010), { position: [0, H / 2 - B / 2, 0] }),
      transformed(chamferBox(W, B, t, 0.0010), { position: [0, -H / 2 + B / 2, 0] }),
      transformed(chamferBox(B, H - 2 * B, t, 0.0010), { position: [-W / 2 + B / 2, 0, 0] }),
      transformed(chamferBox(B, H - 2 * B, t, 0.0010), { position: [W / 2 - B / 2, 0, 0] }),
    ]);
  });
}

/** Microwave / oven keypad: display window plus a grid of real buttons. */
export function keypad(w: number, h: number, cols = 3, rows = 5): THREE.BufferGeometry {
  const W = num(w, 0.04, 0.5, 0.12);
  const H = num(h, 0.06, 0.6, 0.28);
  const c = Math.round(num(cols, 1, 5, 3));
  const r = Math.round(num(rows, 1, 8, 5));
  return cached(`keyp|${k(W)}|${k(H)}|${c}|${r}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(chamferBox(W * 0.88, H * 0.16, 0.0022, 0.0006), { position: [0, H * 0.38, 0.0011] }));
    const gw = (W * 0.88) / c, gh = (H * 0.62) / r;
    for (let i = 0; i < c; i++) {
      for (let j = 0; j < r; j++) {
        parts.push(transformed(filletBox(gw * 0.72, gh * 0.66, 0.0018, 0.0005, 1), {
          position: [(i - (c - 1) / 2) * gw, H * 0.22 - (j + 0.5) * gh, 0.0009],
        }));
      }
    }
    return merged(parts);
  });
}

/**
 * Chimney-hood canopy: a real tapered stainless shell with a rolled bottom lip
 * and a horizontal seam where the two pressings meet. Base at y = 0, top at y = h.
 */
export function hoodCanopy(topW: number, topD: number, botW: number, botD: number, h: number): THREE.BufferGeometry {
  const TW = num(topW, 0.05, 2, 0.3), TD = num(topD, 0.05, 1.2, 0.22);
  const BW = num(botW, 0.1, 2.4, 0.8), BD = num(botD, 0.1, 1.2, 0.55);
  const H = num(h, 0.05, 1.2, 0.23);
  return cached(`hood|${k(TW)}|${k(TD)}|${k(BW)}|${k(BD)}|${k(H)}`, () => {
    const v: number[] = [];
    const quad = (a: number[], b: number[], c: number[], e: number[], out: Vec3) => {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) v.push(...a, ...b, ...c, ...a, ...c, ...e);
      else v.push(...a, ...e, ...c, ...a, ...c, ...b);
    };
    // three stacked bands: rolled lip, main taper, top collar — real sheet metal
    const lip = Math.min(H * 0.16, 0.03);
    const rings: Array<{ w: number; d: number; y: number }> = [
      { w: BW, d: BD, y: 0 },
      { w: BW, d: BD, y: lip },
      { w: BW * 0.985, d: BD * 0.985, y: lip + 0.004 },
      { w: TW, d: TD, y: H },
    ];
    for (let i = 0; i < rings.length - 1; i++) {
      const lo = rings[i], hi = rings[i + 1];
      const L = [[-lo.w / 2, lo.y, -lo.d / 2], [lo.w / 2, lo.y, -lo.d / 2], [lo.w / 2, lo.y, lo.d / 2], [-lo.w / 2, lo.y, lo.d / 2]];
      const U = [[-hi.w / 2, hi.y, -hi.d / 2], [hi.w / 2, hi.y, -hi.d / 2], [hi.w / 2, hi.y, hi.d / 2], [-hi.w / 2, hi.y, hi.d / 2]];
      quad(L[0], L[1], U[1], U[0], [0, 0, -1]);
      quad(L[1], L[2], U[2], U[1], [1, 0, 0]);
      quad(L[2], L[3], U[3], U[2], [0, 0, 1]);
      quad(L[3], L[0], U[0], U[3], [-1, 0, 0]);
    }
    const T = [[-TW / 2, H, -TD / 2], [TW / 2, H, -TD / 2], [TW / 2, H, TD / 2], [-TW / 2, H, TD / 2]];
    const B = [[-BW / 2, 0, -BD / 2], [BW / 2, 0, -BD / 2], [BW / 2, 0, BD / 2], [-BW / 2, 0, BD / 2]];
    quad(T[0], T[1], T[2], T[3], [0, 1, 0]);
    quad(B[0], B[1], B[2], B[3], [0, -1, 0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return applyWorldUVs(g);
  });
}

/**
 * Points round a rounded rectangle, parameterised by angle so consecutive
 * rings of different size and corner radius line up vertex for vertex.
 */
function roundedRing(hw: number, hd: number, r: number, y: number, n: number): Vec3[] {
  const rad = Math.max(0, Math.min(r, hw * 0.98, hd * 0.98));
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    out.push([Math.sign(c) * (hw - rad) + rad * c, y, Math.sign(s) * (hd - rad) + rad * s]);
  }
  return out;
}

/**
 * Loft a stack of same-count rings into a smooth, indexed skin (normals from
 * the shared vertices, so a bell reads as one curved surface and not as
 * facets), with flat caps top and bottom when asked.
 */
function loftRings(rings: Vec3[][], caps: { top?: boolean; bottom?: boolean } = {}, creaseDeg = 34): THREE.BufferGeometry {
  const n = rings[0].length;
  const R = rings.length;
  const skinOf = (rows: Vec3[][]): THREE.BufferGeometry => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const ring of rows) for (const p of ring) pos.push(p[0], p[1], p[2]);
    for (let r = 0; r < rows.length - 1; r++) {
      for (let i = 0; i < n; i++) {
        const a = r * n + i, b = r * n + ((i + 1) % n);
        const c = (r + 1) * n + i, d = (r + 1) * n + ((i + 1) % n);
        // outward-facing: the ring runs counter-clockwise seen from +y
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  /**
   * WHERE THE SHELL FOLDS.
   *
   * `computeVertexNormals()` averages every face that touches a vertex, which is
   * right along a curve and wrong at an edge. A bell hood's rolled lip and a
   * saddle seat's rim both turn through ~90° between two bands, and the averaged
   * normal there came out 89.6° and 79.9° away from its own face — a lip that
   * shades like a soft dent instead of catching a line. Rings on either side of
   * such a fold get their own copy of the vertices (0 extra triangles, n extra
   * vertices) so each band keeps its own normal.
   */
  const bandNormal = (r: number, i: number, out: THREE.Vector3): boolean => {
    const A = rings[r][i], B = rings[r][(i + 1) % n], C = rings[r + 1][i];
    out.set(
      (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]),
      (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]),
      (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]),
    );
    const len = out.length();
    if (len < 1e-12) return false;       // a ring that collapsed to a point
    out.multiplyScalar(1 / len);
    return true;
  };
  const cosLimit = Math.cos((Math.max(0, Math.min(179, creaseDeg)) * Math.PI) / 180);
  const na = new THREE.Vector3(), nb = new THREE.Vector3();
  const folds: number[] = [];
  for (let r = 1; r < R - 1; r++) {
    let worst = 1;
    for (let i = 0; i < n; i++) {
      if (!bandNormal(r - 1, i, na) || !bandNormal(r, i, nb)) continue;
      worst = Math.min(worst, na.dot(nb));
    }
    if (worst < cosLimit) folds.push(r);
  }
  const parts: THREE.BufferGeometry[] = [];
  let start = 0;
  for (const f of [...folds, R - 1]) {
    if (f > start) parts.push(skinOf(rings.slice(start, f + 1)));
    start = f;
  }
  const cap = (ring: Vec3[], up: boolean) => {
    const v: number[] = [];
    let cx = 0, cy = 0, cz = 0;
    for (const p of ring) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      if (up) v.push(cx, cy, cz, p[0], p[1], p[2], q[0], q[1], q[2]);
      else v.push(cx, cy, cz, q[0], q[1], q[2], p[0], p[1], p[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    parts.push(g);
  };
  if (caps.top) cap(rings[rings.length - 1], true);
  if (caps.bottom) cap(rings[0], false);
  return merged(parts);
}

/**
 * Bell / ogee range hood: a rounded-rectangular canopy that flares out
 * CONCAVELY from the duct to a rolled lip — the plaster or blackened-steel
 * hood of a transitional kitchen. Origin at the centre of the mouth, y up;
 * `topW × topD` is the neck the duct cover sits on.
 */
export function hoodBell(botW: number, botD: number, topW: number, topD: number, h: number): THREE.BufferGeometry {
  const BW = num(botW, 0.3, 2.4, 0.8), BD = num(botD, 0.2, 1.2, 0.55);
  const TW = num(topW, 0.05, 1.2, Math.min(0.32, BW * 0.4)), TD = num(topD, 0.05, 0.8, Math.min(0.22, BD * 0.45));
  const H = num(h, 0.1, 1.2, 0.4);
  return cached(`hoodbell|${k(BW)}|${k(BD)}|${k(TW)}|${k(TD)}|${k(H)}`, () => {
    const N = 40, ROWS = 12;
    const lip = Math.min(H * 0.1, 0.022);
    const rings: Vec3[][] = [
      roundedRing(BW / 2, BD / 2, Math.min(BW, BD) * 0.06, 0, N),
      roundedRing(BW / 2, BD / 2, Math.min(BW, BD) * 0.06, lip, N),
    ];
    for (let r = 0; r <= ROWS; r++) {
      const s = r / ROWS;
      // (1-s)^2.4 narrows fast just above the lip and eases into the neck — the concave flare
      const f = Math.pow(1 - s, 2.4);
      const hw = (TW + (BW - TW) * f) / 2, hd = (TD + (BD - TD) * f) / 2;
      const corner = Math.min(hw, hd) * (0.08 + 0.42 * s);
      rings.push(roundedRing(hw, hd, corner, lip + 0.004 + (H - lip - 0.004) * s, N));
    }
    return loftRings(rings, { top: true, bottom: true });
  });
}

/** Baffle filters + a lit control strip inside a hood canopy (origin at its base). */
export function hoodInterior(w: number, dpt: number, baffles = 3): THREE.BufferGeometry {
  const W = num(w, 0.1, 2.2, 0.75);
  const D = num(dpt, 0.1, 1.0, 0.5);
  const n = Math.round(num(baffles, 1, 6, 3));
  return cached(`hoodi|${k(W)}|${k(D)}|${n}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const bw = (W - inch(3)) / n;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + inch(1.5) + bw * (i + 0.5);
      parts.push(transformed(chamferBox(bw * 0.92, inch(0.7), D - inch(3), 0.0010), { position: [x, inch(0.55), 0] }));
      parts.push(transformed(chamferBox(bw * 0.10, inch(0.9), D - inch(4), 0.0006), { position: [x, inch(0.9), 0] }));
    }
    // control strip with three buttons on the front lip
    parts.push(transformed(chamferBox(W * 0.30, inch(0.5), inch(0.30), 0.0008), { position: [W * 0.24, inch(1.4), D / 2 - inch(0.4)] }));
    for (let i = 0; i < 3; i++) {
      parts.push(transformed(cyl(0.0045, 0.0030, 10), { position: [W * 0.24 + (i - 1) * 0.022, inch(1.4), D / 2 - inch(0.28)], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  });
}

/** Oven door window: a raised bezel with the glass supplied separately. */
export function ovenWindow(w: number, h: number): { bezel: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const W = num(w, 0.08, 1.4, 0.5);
  const H = num(h, 0.08, 1.0, 0.35);
  const bezel = cached(`ovwb|${k(W)}|${k(H)}`, () => {
    const b = inch(0.9), t = inch(0.5);
    return mergeDetail([
      transformed(chamferBox(W, b, t, 0.0010), { position: [0, H / 2 - b / 2, 0] }),
      transformed(chamferBox(W, b, t, 0.0010), { position: [0, -H / 2 + b / 2, 0] }),
      transformed(chamferBox(b, H - 2 * b, t, 0.0010), { position: [-W / 2 + b / 2, 0, 0] }),
      transformed(chamferBox(b, H - 2 * b, t, 0.0010), { position: [W / 2 - b / 2, 0, 0] }),
    ]);
  });
  const glass = cached(`ovwg|${k(W)}|${k(H)}`, () => chamferBox(W - inch(1.6), H - inch(1.6), 0.004, 0.0008).clone());
  return { bezel, glass };
}

/** Louvred appliance grille (fridge kick plate, range vent). */
export function louvreGrille(w: number, h: number, slats = 4): THREE.BufferGeometry {
  const W = num(w, 0.05, 2, 0.8);
  const H = num(h, 0.01, 0.4, 0.08);
  const n = Math.round(num(slats, 2, 12, 4));
  return cached(`louv|${k(W)}|${k(H)}|${n}`, () => {
    const parts: THREE.BufferGeometry[] = [transformed(chamferBox(W, H, 0.010, 0.0010), { position: [0, 0, -0.005] })];
    const sh = H / n;
    for (let i = 0; i < n; i++) {
      parts.push(transformed(chamferBox(W - inch(0.8), sh * 0.60, 0.0030, 0.0006), {
        position: [0, H / 2 - sh * (i + 0.5), 0.0016], rotation: [-0.45, 0, 0],
      }));
    }
    return merged(parts);
  });
}

// ---------------------------------------------------------------------------
// Sink
// ---------------------------------------------------------------------------

/**
 * Sink bowl with radiused corners — a real stainless bowl has a 10 mm corner
 * radius and a slight slope to the drain, and the corner highlight is most of
 * what makes it read as metal rather than a hole.
 * Origin at the rim centre; the bowl hangs down to -depth.
 */
export function sinkBasin(w: number, dpt: number, depth: number, radius = inch(0.45)): THREE.BufferGeometry {
  const W = num(w, 0.15, 1.4, 0.6);
  const D = num(dpt, 0.12, 0.8, 0.42);
  const H = num(depth, 0.05, 0.5, 0.23);
  const R = Math.min(num(radius, 0.002, 0.08, inch(0.45)), W / 3, D / 3);
  return cached(`ksink|${k(W)}|${k(D)}|${k(H)}|${k(R)}`, () => {
    const wall = 0.010;
    // each corner is a quarter circle, so it wants a quarter of the count a
    // full circle of that radius would: 3 facets is right for a 10 mm undermount
    // radius and visibly wrong for the 40 mm one a farmhouse bowl has
    const SINK_CORNER_SEGS = Math.max(3, Math.round(latheSegments(R) / 4));
    const ring = roundedRectShape(W, D, R);
    ring.holes.push(roundedRectPath(W - 2 * wall, D - 2 * wall, Math.max(0.001, R - wall)));
    const walls = new THREE.ExtrudeGeometry(ring, { depth: H, bevelEnabled: false, curveSegments: SINK_CORNER_SEGS });
    walls.rotateX(Math.PI / 2);   // extrude down
    // sloped floor with the drain low point at the back centre
    const floor = new THREE.ExtrudeGeometry(roundedRectShape(W - 2 * wall + 0.002, D - 2 * wall + 0.002, Math.max(0.001, R - wall)), { depth: 0.008, bevelEnabled: false, curveSegments: SINK_CORNER_SEGS });
    floor.rotateX(Math.PI / 2);
    floor.translate(0, -H + 0.008, 0);
    // a 6 mm flat rim so an undermount reads as a real fabricated bowl
    const rim = new THREE.ExtrudeGeometry((() => {
      const s = roundedRectShape(W + 0.012, D + 0.012, R + 0.006);
      s.holes.push(roundedRectPath(W, D, R));
      return s;
    })(), { depth: 0.006, bevelEnabled: false, curveSegments: SINK_CORNER_SEGS });
    rim.rotateX(Math.PI / 2);
    return merged([walls, floor, rim]);
  });
}

/** Divider between two bowls of a double sink. */
export function sinkDivider(dpt: number, depth: number, t = inch(0.55)): THREE.BufferGeometry {
  return chamferBox(Math.max(0.004, t), Math.max(0.02, depth), Math.max(0.02, dpt), 0.0018);
}

/** Drain flange, strainer basket and the ring of holes in it. */
export function drainAssembly(): THREE.BufferGeometry {
  return cached('kdrain', () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(lathePoints([[0, 0], [0.0455, 0], [0.0450, -0.0035], [0.0400, -0.0050], [0.0400, -0.0170], [0.0370, -0.0180], [0, -0.0180]], 22), { position: [0, 0.0005, 0] }));
    parts.push(transformed(cyl(0.0170, 0.0060, 16), { position: [0, -0.0060, 0] }));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push(transformed(cyl(0.0032, 0.0040, 6), { position: [Math.cos(a) * 0.0290, -0.0025, Math.sin(a) * 0.0290] }));
    }
    return merged(parts);
  });
}

/** Deck-mounted soap dispenser. */
export function soapDispenser(): THREE.BufferGeometry {
  return cached('ksoap', () => mergeDetail([
    transformed(lathePoints([[0, 0], [0.021, 0], [0.020, 0.006], [0.013, 0.012], [0.012, 0.062], [0.010, 0.070], [0, 0.070]], 16), { position: [0, 0, 0] }),
    transformed(chamferBox(0.014, 0.012, 0.040, 0.0012), { position: [0, 0.072, 0.016] }),
    transformed(cyl(0.0035, 0.010, 10), { position: [0, 0.066, 0.033] }),
  ]));
}

/** Counter-top air switch for the disposal. */
export function airSwitch(): THREE.BufferGeometry {
  return cached('kair', () => transformed(
    lathePoints([[0, 0], [0.019, 0], [0.019, 0.004], [0.015, 0.007], [0.015, 0.016], [0.012, 0.019], [0, 0.019]], 16),
    { position: [0, 0, 0] },
  ));
}

/** Apron (farmhouse) sink front with a softened top edge and radiused corners. */
export function apronFront(w: number, h: number, t = inch(1.25)): THREE.BufferGeometry {
  const W = num(w, 0.2, 1.4, 0.8);
  const H = num(h, 0.05, 0.6, inch(10));
  const T = num(t, 0.01, 0.1, inch(1.25));
  return cached(`kapron|${k(W)}|${k(H)}|${k(T)}`, () => filletBox(W, H, T, inch(0.6), 2).clone());
}

// ---------------------------------------------------------------------------
// Millwork details
// ---------------------------------------------------------------------------

/** Decorative corbel under an island overhang or a hood shelf. */
export function corbel(w: number, h: number, d: number, style: 'scroll' | 'square' | 'tapered' = 'scroll'): THREE.BufferGeometry {
  const W = num(w, 0.02, 0.3, inch(2.5));
  const H = num(h, 0.05, 0.6, inch(7));
  const D = num(d, 0.03, 0.5, inch(9));
  return cached(`corb|${k(W)}|${k(H)}|${k(D)}|${style}`, () => {
    // authored in the YZ plane (z = out from the cabinet face, y = down), then
    // extruded across the corbel's thickness
    const s = new THREE.Shape();
    if (style === 'square') {
      s.moveTo(0, 0); s.lineTo(D, 0); s.lineTo(D, -H * 0.35); s.lineTo(D * 0.4, -H * 0.9); s.lineTo(0, -H); s.closePath();
    } else if (style === 'tapered') {
      s.moveTo(0, 0); s.lineTo(D, 0); s.lineTo(D * 0.22, -H); s.lineTo(0, -H); s.closePath();
    } else {
      s.moveTo(0, 0);
      s.lineTo(D, 0);
      s.lineTo(D, -H * 0.18);
      s.quadraticCurveTo(D * 0.62, -H * 0.26, D * 0.52, -H * 0.50);
      s.quadraticCurveTo(D * 0.44, -H * 0.74, D * 0.18, -H * 0.84);
      s.lineTo(D * 0.16, -H);
      s.lineTo(0, -H);
      s.closePath();
    }
    // shape x → +Z (out from the face it is fixed to), shape y → down,
    // extrusion → the corbel's thickness, centred on X
    const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 8 });
    g.rotateY(-Math.PI / 2);
    g.translate(W / 2, 0, 0);
    return applyWorldUVs(g);
  });
}

/** Turned or tapered island leg, base at y = 0. */
export function islandLeg(h: number, thick: number, turned: boolean): THREE.BufferGeometry {
  const H = num(h, 0.1, 1.4, 0.9);
  const T = num(thick, 0.02, 0.25, inch(3.5));
  return cached(`ileg|${k(H)}|${k(T)}|${turned}`, () => {
    if (!turned) {
      return mergeDetail([
        transformed(chamferBox(T, H - inch(2), T, 0.0020), { position: [0, (H - inch(2)) / 2 + inch(1), 0] }),
        transformed(chamferBox(T * 1.12, inch(1), T * 1.12, 0.0016), { position: [0, inch(0.5), 0] }),
      ]);
    }
    const r = T / 2;
    return transformed(lathePoints([
      [0, 0], [r * 1.10, 0], [r * 1.10, 0.030], [r * 0.92, 0.042],
      [r * 0.86, H * 0.22], [r * 1.02, H * 0.28], [r * 0.72, H * 0.38],
      [r * 0.80, H * 0.62], [r * 0.66, H * 0.72], [r * 0.90, H * 0.86],
      [r * 1.02, H - 0.030], [r * 1.02, H], [0, H],
    ], 14), { position: [0, 0, 0] });
  });
}

/** Bullnose cap tile along the top edge of a partial-height backsplash. */
export function bullnoseCap(len: number, t: number): THREE.BufferGeometry {
  const L = num(len, 0.02, 20, 1);
  const T = num(t, 0.004, 0.05, inch(0.4));
  return cached(`bull|${k(L)}|${k(T)}`, () => {
    const prof: Vec2[] = [];
    const h = inch(2);
    prof.push([0, 0], [T, 0]);
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      prof.push([T * Math.cos(a) * 0 + T - T * (1 - Math.cos(a)), h - T + T * Math.sin(a)]);
    }
    prof.push([0, 0]);
    return sweepProfile(prof, [[-L / 2, 0, 0], [L / 2, 0, 0]], { up: [0, 1, 0] });
  });
}

/** Schluter-style metal edge trim capping a tile field. */
export function schluterEdge(len: number, t: number): THREE.BufferGeometry {
  const L = num(len, 0.02, 20, 1);
  const T = num(t, 0.004, 0.04, inch(0.4));
  return cached(`schl|${k(L)}|${k(T)}`, () => {
    const prof: Vec2[] = [
      [0, 0], [T + 0.0016, 0], [T + 0.0016, 0.0016], [0.0016, 0.0016], [0.0016, -0.020], [0, -0.020], [0, 0],
    ];
    return sweepProfile(prof, [[-L / 2, 0, 0], [L / 2, 0, 0]], { up: [0, 1, 0] });
  });
}

/** The caulk / silicone bead where a counter meets a wall or a splash. */
export function caulkBead(len: number, r = 0.0035): THREE.BufferGeometry {
  const L = num(len, 0.02, 20, 1);
  const R = num(r, 0.001, 0.02, 0.0035);
  return cached(`caulk|${k(L)}|${k(R)}`, () => {
    const prof: Vec2[] = [[0, 0], [R, 0]];
    for (let i = 1; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      prof.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    prof.push([0, 0]);
    return sweepProfile(prof, [[-L / 2, 0, 0], [L / 2, 0, 0]], { up: [0, 1, 0] });
  });
}

// ---------------------------------------------------------------------------
// Furniture + styling
// ---------------------------------------------------------------------------

/**
 * Counter stool with REAL joinery: four splayed legs, a box stretcher, a foot
 * rail and an upholstered seat with a welt. Seat and frame come back separately
 * so they can take different materials.
 */
export type StoolStyle = 'backless' | 'low-back' | 'full-back' | 'saddle';

/**
 * The seat PAD's plan shape — orthogonal to the style, which says backless /
 * low-back / full-back, and to the seat MATERIAL. `null` is 'round', i.e. the
 * 340 mm lathe disc every non-saddle stool has always drawn.
 */
export type StoolSeatShape = 'round' | 'square' | null;

/**
 * The square pad: 340 mm across and 55 mm thick, measured off the photo.
 * `SQ_PAD_CORE` is the filleted cushion inside the piped welt, which stands
 * ~16 mm proud of the path it is swept along — so core + welt = 340 mm, and
 * the seat's plan size is the number the photo gives.
 */
const SQ_PAD = 0.34;
/** the piped welt is sewn round the core's rim and stands 5.5 mm proud of it,
 *  so the core is the finished pad less the welt on both sides */
const SQ_PAD_WELT = 0.0055;
const SQ_PAD_CORE = SQ_PAD - 2 * SQ_PAD_WELT;
const SQ_PAD_T = 0.055;

/** a piped welt: a circle swept round the pad's rim */
function weltProfile(r: number): Vec2[] {
  const p: Vec2[] = [];
  for (let i = 0; i <= 8; i++) p.push([Math.cos((i / 8) * Math.PI * 2) * r, Math.sin((i / 8) * Math.PI * 2) * r]);
  return p;
}

/**
 * The frame under a square pad: four STRAIGHT square-tube legs at the pad's
 * corners and one rectangular footrail low down.
 *
 * The splayed round-tube frame with two ring stretchers is the wrong furniture
 * for a square seat — it is the frame a round pad wants — and it is what the
 * client saw where his photo has a plain black box.
 */
function squareFrame(H: number, metal: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stock = metal ? 0.020 : 0.030;
  const c = SQ_PAD / 2 - stock / 2 - 0.008;   // leg centres, just inside the pad's edge
  const legs: Array<[number, number]> = [[-c, -c], [c, -c], [c, c], [-c, c]];
  for (const [x, z] of legs) {
    parts.push(transformed(chamferBox(stock, H, stock, 0.0015), { position: [x, H / 2, z] }));
  }
  // one footrail, four bars closing a rectangle at 7 in off the floor
  const railY = H * 0.28, rail = metal ? 0.016 : 0.022, railT = metal ? 0.012 : 0.018;
  for (const along of [-1, 1]) {
    parts.push(transformed(chamferBox(2 * c, railT, rail, 0.0012), { position: [0, railY, along * c] }));
    parts.push(transformed(chamferBox(rail, railT, 2 * c, 0.0012), { position: [along * c, railY, 0] }));
  }
  // the plate the pad is bolted to
  parts.push(transformed(chamferBox(SQ_PAD * 0.86, 0.020, SQ_PAD * 0.86, 0.0015), { position: [0, H - 0.014, 0] }));
  return merged(parts);
}

/**
 * Saddle seat: a scooped wood slab, lower between the sit-bones and rising to
 * the edges, with a softened rim. Origin under the seat's centre, y up.
 */
export function saddleSeat(w: number, d: number, t: number): THREE.BufferGeometry {
  const W = num(w, 0.25, 0.6, 0.42), D = num(d, 0.2, 0.5, 0.33), T = num(t, 0.02, 0.08, 0.04);
  return cached(`saddle|${k(W)}|${k(D)}|${k(T)}`, () => {
    const N = 36, DISH = 8;
    const hw = W / 2, hd = D / 2;
    const dip = T * 0.45;
    const rings: Vec3[][] = [
      roundedRing(hw * 0.96, hd * 0.96, hd * 0.3, 0, N),
      roundedRing(hw, hd, hd * 0.3, T * 0.35, N),
      roundedRing(hw * 0.985, hd * 0.985, hd * 0.3, T, N),
    ];
    // concentric rings drawn inward across the top, each dropping into the scoop
    for (let r = 1; r <= DISH; r++) {
      const f = 1 - r / (DISH + 0.5);
      rings.push(roundedRing(hw * 0.985 * f, hd * 0.985 * f, hd * 0.3 * f, T, N).map(([x, , z]): Vec3 => [
        x, T - dip * (1 - (x / hw) ** 2) * (1 - 0.5 * (z / hd) ** 2), z,
      ]));
    }
    return loftRings(rings, { top: true, bottom: true });
  });
}

/**
 * Counter stool. `seat` (and `back`, when the style has one) take the seat
 * material; `frame` takes the frame material — so a bentwood low-back with a
 * woven seat and back panel is exactly that. Origin on the floor under the
 * seat's centre; the sitter faces -z, the back is at +z.
 */
export function stoolParts(seatH: number, style: StoolStyle = 'backless', metal = false, seatShape: StoolSeatShape = null): { seat: THREE.BufferGeometry; frame: THREE.BufferGeometry; back: THREE.BufferGeometry | null } {
  const H = num(seatH, 0.3, 0.95, 0.66);
  const saddle = style === 'saddle';
  // 'round' and null are the same stool — the disc every style but `saddle`
  // has always drawn — so they share a cache key and come out byte-identical.
  const square = seatShape === 'square' && !saddle;
  const key = `stool|${k(H)}|${style}|${metal ? 'm' : 'w'}${square ? '|sq' : ''}`;
  const seat = cached(`${key}|s`, () => (saddle
    ? transformed(saddleSeat(0.42, 0.33, 0.04), { position: [0, H - 0.04, 0] })
    : square
      ? mergeDetail([
        // a cushioned square pad, softly filleted, with a piped welt round the
        // rim — the shape in the client's photo, which a lathe cannot make
        // because a lathe is a disc of revolution
        transformed(filletBox(SQ_PAD_CORE, SQ_PAD_T, SQ_PAD_CORE, 0.016, 3), { position: [0, H + SQ_PAD_T / 2, 0] }),
        sweepProfile(
          weltProfile(SQ_PAD_WELT),
          roundedRectPath(SQ_PAD_CORE, SQ_PAD_CORE, 0.016).getPoints(48)
            .map(({ x, y }): Vec3 => [x, H + SQ_PAD_T * 0.52, y]),
          { up: [0, 1, 0], closed: true },
        ),
      ])
      : mergeDetail([
        transformed(lathePoints([[0, 0], [0.170, 0], [0.178, 0.012], [0.176, 0.034], [0.160, 0.046], [0, 0.050]], 26), { position: [0, H, 0] }),
        (() => { const t = new THREE.TorusGeometry(0.170, 0.011, 8, latheSegments(0.170)); t.rotateX(Math.PI / 2); t.translate(0, H + 0.012, 0); return t; })(),
      ])));
  const frame = cached(`${key}|f`, () => {
    if (square) return squareFrame(H, metal);
    const parts: THREE.BufferGeometry[] = [];
    const splay = 0.062;
    const foot = 0.165, top = 0.128;
    // a metal frame is thin round tube; wood is a 30 mm square leg. Legs stop
    // inside the seat slab — a saddle's scoop would otherwise show their tops.
    const legH = saddle ? H - 0.03 : H;
    const legStock = metal ? cyl(0.011, legH, 12) : chamferBox(0.030, legH, 0.030, 0.0018);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      // a saddle sits on a rectangular base; round seats on a square one
      const rx = saddle ? 1.15 : 1, rz = saddle ? 0.85 : 1;
      const leg = legStock.clone();
      leg.translate(0, legH / 2, 0);
      leg.rotateX(splay * Math.cos(ang) * rz);
      leg.rotateZ(-splay * Math.sin(ang) * rx);
      leg.translate(Math.cos(ang) * top * rx, 0, Math.sin(ang) * top * rz);
      parts.push(leg);
    }
    // box stretcher low down and a foot rail at 11"
    for (const [y, r, rad] of [[H * 0.30, foot, metal ? 0.008 : 0.011], [H * 0.62, top * 1.06, metal ? 0.007 : 0.009]] as const) {
      for (let i = 0; i < 4; i++) {
        const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
        const rx = saddle ? 1.15 : 1, rz = saddle ? 0.85 : 1;
        const p0: Vec3 = [Math.cos(a0) * r * rx, y, Math.sin(a0) * r * rz];
        const p1: Vec3 = [Math.cos(a1) * r * rx, y, Math.sin(a1) * r * rz];
        const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
        const yaw = Math.atan2(p1[2] - p0[2], p1[0] - p0[0]);
        parts.push(transformed(cyl(rad, len, 8), {
          position: [(p0[0] + p1[0]) / 2, y, (p0[2] + p1[2]) / 2],
          rotation: [0, -yaw, Math.PI / 2],
        }));
      }
    }
    if (!saddle) parts.push(transformed(cyl(0.152, 0.020, 24), { position: [0, H - 0.014, 0] }));
    if (style === 'low-back') {
      // bentwood: a single steamed rail curving round the back of the seat on
      // two short posts, the way a Thonet / rattan counter stool is made
      const R = 0.175, A0 = 0.30, A1 = Math.PI - 0.30;
      const arc: Vec3[] = [];
      for (let i = 0; i <= 14; i++) {
        const a = A0 + ((A1 - A0) * i) / 14;
        arc.push([Math.cos(a) * R, H + 0.235, Math.sin(a) * R + 0.02]);
      }
      const round: Vec2[] = [];
      for (let i = 0; i <= 8; i++) round.push([Math.cos((i / 8) * Math.PI * 2) * 0.013, Math.sin((i / 8) * Math.PI * 2) * 0.013]);
      parts.push(sweepProfile(round, arc, { up: [0, 1, 0] }));
      for (const a of [A0, A1]) {
        parts.push(transformed(cyl(metal ? 0.010 : 0.013, 0.235, 10), { position: [Math.cos(a) * R, H + 0.1175, Math.sin(a) * R + 0.02] }));
      }
      // three spindles keep the panel honest when the seat is not woven
      for (const a of [Math.PI * 0.38, Math.PI * 0.5, Math.PI * 0.62]) {
        parts.push(transformed(cyl(0.006, 0.20, 8), { position: [Math.cos(a) * R, H + 0.115, Math.sin(a) * R + 0.02] }));
      }
    }
    if (style === 'full-back') {
      // two raked posts, a shaped top rail and two slats
      for (const sx of [-1, 1]) {
        parts.push(transformed(metal ? cyl(0.011, 0.44, 12) : chamferBox(0.026, 0.44, 0.026, 0.0016), { position: [sx * 0.14, H + 0.22, 0.11], rotation: [0.10, 0, 0] }));
      }
      parts.push(transformed(chamferBox(0.31, 0.06, 0.020, 0.0020), { position: [0, H + 0.41, 0.152], rotation: [0.10, 0, 0] }));
      for (const y of [0.16, 0.28]) {
        parts.push(transformed(chamferBox(0.28, 0.032, 0.014, 0.0014), { position: [0, H + y, 0.11 + (y - 0.22) * 0.10], rotation: [0.10, 0, 0] }));
      }
    }
    return merged(parts);
  });
  const back = style === 'low-back'
    ? cached(`${key}|b`, () => {
      // the woven / upholstered panel inside the bentwood rail
      const R = 0.170, A0 = 0.36, A1 = Math.PI - 0.36;
      const arc: Vec3[] = [];
      for (let i = 0; i <= 14; i++) {
        const a = A0 + ((A1 - A0) * i) / 14;
        arc.push([Math.cos(a) * R, H + 0.125, Math.sin(a) * R + 0.02]);
      }
      const band: Vec2[] = [[-0.004, -0.085], [0.004, -0.085], [0.004, 0.085], [-0.004, 0.085], [-0.004, -0.085]];
      const g = sweepProfile(band, arc, { up: [0, 1, 0] });
      applyWorldUVs(g);
      return g;
    })
    : style === 'full-back'
      ? cached(`${key}|b`, () => transformed(filletBox(0.27, 0.15, 0.024, 0.008, 2), { position: [0, H + 0.22, 0.10 + 0.012], rotation: [0.10, 0, 0] }))
      : null;
  return { seat, frame, back };
}

/**
 * Deep serving bowl (origin at the counter surface).
 *
 * `bowl` and `fruit-bowl` used to share `fruitBowl`, and a fruit bowl is a
 * SHALLOW splayed dish: it is the right shape under a mound of limes and the
 * wrong one for the plain serving bowl that sits on half the islands ever
 * photographed. This one is deeper and much straighter-sided, with a real foot
 * ring, so the two read as two objects across a room.
 */
export function servingBowl(radius = 0.12, height = 0.10): THREE.BufferGeometry {
  const R = num(radius, 0.04, 0.4, 0.12);
  const H = num(height, 0.03, 0.4, 0.10);
  return cached(`kserve|${k(R)}|${k(H)}`, () => {
    const { profile } = cupProfile({ height: H, wall: 0.055, floor: 0.016, rim: 0.008, baseInset: 0.34, baseRise: 0.014 });
    return cupShell(profile, R);
  });
}

/**
 * The form an object nobody could name is drawn in.
 *
 * The client's sentence was *"the items on the island are js boxes vs
 * something else in the picture"*: `kind: 'other'` fell through to a filleted
 * BOX, and a hard-edged crate is the one shape that announces "the software
 * gave up". A soft lozenge — a sphere squashed to the reserved footprint with
 * a flattened base so it sits rather than rolls — reads as an object seen from
 * across a room, and it is honest about a bread loaf, a bundle of pastries or
 * a heap of anything else, which really are blobs.
 *
 * It fills EXACTLY the (w, h, d) the layout reserved, because `buildDecor`
 * placed its neighbours against that box. The small taper is derived from the
 * dimensions, so it is stable across reloads and a row of them still does not
 * repeat.
 */
export function softForm(w: number, hgt: number, dpt: number): THREE.BufferGeometry {
  const W = num(w, 0.01, 1.5, 0.16);
  const H = num(hgt, 0.01, 1.5, 0.12);
  const D = num(dpt, 0.01, 1.5, 0.14);
  return cached(`ksoft|${k(W)}|${k(H)}|${k(D)}`, () => {
    const g = new THREE.SphereGeometry(0.5, 34, 22);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    // a deterministic ±1 lean, so two blobs side by side are not one shape twice
    const lean = (Math.round((W + D) * 10000) % 2 ? 1 : -1) * 0.13;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const y = Math.max(p.getY(i), -0.36);
      // the top leans, the base does not: a loaf, not an egg
      const t = (y + 0.5);
      p.setXYZ(i, x * (1 + lean * t * 0.5) + lean * t * 0.06, y, z * (1 - lean * t * 0.35));
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const sx = W / Math.max(1e-6, bb.max.x - bb.min.x);
    const sy = H / Math.max(1e-6, bb.max.y - bb.min.y);
    const sz = D / Math.max(1e-6, bb.max.z - bb.min.z);
    g.scale(sx, sy, sz);
    g.computeBoundingBox();
    const b2 = g.boundingBox!;
    g.translate(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    return applyWorldUVs(g);
  });
}

/** Shallow serving bowl (origin at the counter surface). */
export function fruitBowl(radius = 0.13): THREE.BufferGeometry {
  const R = num(radius, 0.04, 0.4, 0.13);
  return cached(`kbowl|${k(R)}`, () => {
    const { profile } = cupProfile({ height: 0.075, wall: 0.09, floor: 0.012, rim: 0.01, baseInset: 0.45, baseRise: 0.008 });
    return cupShell(profile, R);
  });
}

/** Sphere of fruit. */
export function fruit(r = 0.036): THREE.BufferGeometry {
  const R = num(r, 0.01, 0.12, 0.036);
  return cached(`kfruit|${k(R)}`, () => applyWorldUVs(new THREE.SphereGeometry(R, 14, 10)));
}

/** End-grain cutting board leaning against a splash (origin at its base). */
export function cuttingBoard(w = 0.32, hgt = 0.45, t = 0.032): THREE.BufferGeometry {
  const W = num(w, 0.1, 0.8, 0.32);
  const H = num(hgt, 0.1, 0.9, 0.45);
  const T = num(t, 0.008, 0.08, 0.032);
  return cached(`kboard|${k(W)}|${k(H)}|${k(T)}`, () => {
    const s = roundedRectShape(W, H, 0.02);
    const hole = new THREE.Path();
    hole.absarc(0, H / 2 - 0.05, 0.016, 0, Math.PI * 2, false);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: true, bevelThickness: 0.0018, bevelSize: 0.0018, bevelSegments: 1, curveSegments: 8 });
    g.translate(0, H / 2, -T / 2);
    return applyWorldUVs(g);
  });
}

/** Two stacked hardbacks (origin at the bottom face). */
export function bookStack(): THREE.BufferGeometry {
  return cached('kbooks', () => mergeDetail([
    transformed(chamferBox(0.210, 0.032, 0.150, 0.0016), { position: [0, 0.016, 0] }),
    transformed(chamferBox(0.195, 0.028, 0.140, 0.0016), { position: [0.008, 0.046, 0.004], rotation: [0, 0.16, 0] }),
    transformed(chamferBox(0.196, 0.026, 0.006, 0.0008), { position: [0, 0.016, -0.072] }),
  ]));
}

/** Tea towel folded over an oven handle (origin at the bar). */
export function hangingTowel(w = 0.19, drop = 0.26): THREE.BufferGeometry {
  const W = num(w, 0.05, 0.5, 0.19);
  const D = num(drop, 0.05, 0.6, 0.26);
  return cached(`ktowel|${k(W)}|${k(D)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    // a real towel has folds — three panels at slightly different depths
    parts.push(transformed(chamferBox(W, D, 0.007, 0.0012), { position: [0, -D / 2, 0.013], rotation: [0.03, 0, 0.02] }));
    parts.push(transformed(chamferBox(W * 0.92, D * 0.80, 0.006, 0.0012), { position: [0.004, -D * 0.40, 0.019] }));
    parts.push(transformed(chamferBox(W, D * 0.84, 0.007, 0.0012), { position: [0, -D * 0.42, -0.013], rotation: [-0.02, 0, 0] }));
    parts.push(transformed(cyl(0.013, W, 10), { position: [0, 0, 0], rotation: [0, 0, Math.PI / 2] }));
    return merged(parts);
  });
}

/** Ceramic planter (origin at the floor / counter). */
export function planter(r = 0.12, hgt = 0.24): THREE.BufferGeometry {
  const R = num(r, 0.03, 0.5, 0.12);
  const H = num(hgt, 0.03, 0.8, 0.24);
  return cached(`kplant|${k(R)}|${k(H)}`, () => transformed(lathePoints([
    [0, 0], [R * 0.74, 0], [R * 0.76, 0.012], [R * 0.86, H * 0.35], [R * 0.97, H * 0.82],
    [R, H - 0.012], [R * 1.04, H - 0.006], [R * 1.04, H], [R * 0.94, H], [0, H],
  ], 22), { position: [0, 0, 0] }));
}

/** Broad-leaf foliage cluster (origin at soil level). */
export function leafCluster(scale = 1): THREE.BufferGeometry {
  const S = num(scale, 0.15, 4, 1);
  return cached(`kleaves|${k(S)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (i % 3) * 0.4;
      const hgt = (0.26 + (i % 4) * 0.075) * S;
      const leaf = new THREE.SphereGeometry(1, 8, 6);
      leaf.scale(0.055 * S, hgt / 2, 0.014 * S);
      leaf.translate(0, hgt / 2, 0);
      leaf.rotateZ(0.34 * (i % 2 ? 1 : -1));
      leaf.rotateY(ang);
      leaf.translate(Math.cos(ang) * 0.04 * S, 0, Math.sin(ang) * 0.04 * S);
      parts.push(leaf);
      const stem = cyl(0.0035 * S, hgt * 0.5, 6).clone();
      stem.translate(0, hgt * 0.25, 0);
      stem.rotateZ(0.30 * (i % 2 ? 1 : -1));
      stem.rotateY(ang);
      parts.push(stem);
    }
    return merged(parts);
  });
}

/** Stove-top kettle with a spout and a bail handle. */
export function kettle(): THREE.BufferGeometry {
  return cached('kkettle', () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(lathePoints([
      [0, 0], [0.070, 0], [0.082, 0.020], [0.086, 0.060], [0.070, 0.105],
      [0.040, 0.125], [0.036, 0.140], [0.030, 0.142], [0, 0.142],
    ], 22), { position: [0, 0, 0] }));
    parts.push(transformed(lathePoints([[0, 0], [0.032, 0], [0.030, 0.010], [0.020, 0.014], [0, 0.014]], 16), { position: [0, 0.142, 0] }));
    // spout
    const spout: Vec3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      spout.push([0.062 + 0.055 * t, 0.062 + 0.070 * t * t, 0]);
    }
    const ring: Vec2[] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2; ring.push([Math.cos(a) * 0.011, Math.sin(a) * 0.011]); }
    parts.push(sweepProfile(ring, spout, { up: [0, 0, 1], caps: false }));
    // bail handle
    const bail: Vec3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (i / 8);
      bail.push([Math.cos(a) * 0.080, 0.120 + Math.sin(a) * 0.085, 0]);
    }
    const bring: Vec2[] = [];
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2; bring.push([Math.cos(a) * 0.006, Math.sin(a) * 0.006]); }
    parts.push(sweepProfile(bring, bail, { up: [0, 0, 1], caps: false }));
    return merged(parts);
  });
}

// ---------------------------------------------------------------------------
// Décor — shelves, plants, art, rugs, window treatments
// ---------------------------------------------------------------------------

/**
 * Steel L-bracket under a floating shelf. Origin at the wall face, at the
 * board's underside: the arm runs +z under the board, the leg runs down the
 * wall, and a strut ties them — the way a real forged bracket is made.
 */
export function shelfBracket(dpt: number, drop: number): THREE.BufferGeometry {
  const D = num(dpt, 0.08, 0.5, 0.25);
  const H = num(drop, 0.05, 0.4, 0.16);
  return cached(`kbracket|${k(D)}|${k(H)}`, () => {
    const bar = 0.006, wide = 0.030;
    const arm = D * 0.86, leg = H;
    const strutLen = Math.hypot(arm * 0.7, leg * 0.7);
    return merged([
      transformed(chamferBox(wide, bar, arm, 0.0006), { position: [0, -bar / 2, arm / 2] }),
      transformed(chamferBox(wide, leg, bar, 0.0006), { position: [0, -leg / 2, bar / 2] }),
      transformed(chamferBox(wide * 0.6, bar, strutLen, 0.0006), {
        position: [0, -leg * 0.35 - bar, arm * 0.35 + bar], rotation: [Math.atan2(leg * 0.7, arm * 0.7), 0, 0],
      }),
    ]);
  });
}

/** A stack of dinner plates (origin at the base). */
export function plateStack(r = 0.115, count = 5): THREE.BufferGeometry {
  const R = num(r, 0.04, 0.2, 0.115);
  const n = Math.round(num(count, 1, 12, 5));
  return cached(`kplates|${k(R)}|${n}`, () => {
    const plate = lathePoints([[0, 0], [R * 0.55, 0], [R * 0.6, 0.004], [R * 0.62, 0.006], [R * 0.92, 0.012], [R, 0.016], [R * 0.98, 0.018], [R * 0.6, 0.010], [0, 0.008]], 24);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) parts.push(transformed(plate, { position: [0, i * 0.013, 0], rotation: [0, i * 0.7, 0] }));
    return merged(parts);
  });
}

/** Bottle with a shoulder and a cork (origin at the base). */
export function bottle(r = 0.035, h = 0.26): THREE.BufferGeometry {
  const R = num(r, 0.012, 0.08, 0.035);
  const H = num(h, 0.08, 0.5, 0.26);
  return cached(`kbottle|${k(R)}|${k(H)}`, () => merged([
    lathePoints([
      [0, 0], [R * 0.9, 0], [R, 0.008], [R, H * 0.66], [R * 0.72, H * 0.76], [R * 0.36, H * 0.84],
      [R * 0.36, H - 0.006], [R * 0.42, H - 0.006], [R * 0.42, H], [0, H],
    ], 18),
    transformed(cyl(R * 0.3, 0.02, 12), { position: [0, H + 0.006, 0] }),
  ]));
}

/** Mug with a handle (origin at the base). */
export function mug(): THREE.BufferGeometry {
  return cached('kmug', () => {
    const { profile } = cupProfile({ height: 0.095, wall: 0.004, floor: 0.006, rim: 0.001, baseInset: 0.08, baseRise: 0.003 });
    const body = cupShell(profile, 0.042);
    const handle = new THREE.TorusGeometry(0.022, 0.006, 6, latheSegments(0.022), Math.PI * 1.2);
    handle.rotateZ(-Math.PI * 0.1);
    handle.translate(0.046, 0.05, 0);
    return merged([body, handle]);
  });
}

/** Tapered tree trunk with a slight lean (origin at the base). */
export function trunk(h: number, rBase: number, rTop: number): THREE.BufferGeometry {
  const H = num(h, 0.1, 3, 1);
  const R0 = num(rBase, 0.008, 0.12, 0.035);
  const R1 = num(rTop, 0.004, 0.1, 0.015);
  return cached(`ktrunk|${k(H)}|${k(R0)}|${k(R1)}`, () => {
    // clone: `lathePoints` returns a SHARED cached geometry
    const g = lathePoints([[0, 0], [R0, 0], [R0 * 0.82, H * 0.35], [R1 * 1.3, H * 0.7], [R1, H], [0, H]], 12).clone();
    g.rotateZ(0.05);
    return g;
  });
}

/**
 * Pothos-style strands draping over a pot rim and hanging down. Origin at the
 * rim centre; each strand is a tube along a sagging curve with leaves along it.
 */
export function trailingStrands(count = 4, drop = 0.5, spread = 0.1): THREE.BufferGeometry {
  const n = Math.round(num(count, 1, 8, 4));
  const D = num(drop, 0.1, 1.6, 0.5);
  const S = num(spread, 0.03, 0.3, 0.1);
  return cached(`ktrail|${n}|${k(D)}|${k(S)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const ring: Vec2[] = [];
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2; ring.push([Math.cos(a) * 0.004, Math.sin(a) * 0.004]); }
    const leaf = new THREE.SphereGeometry(1, 6, 4);
    leaf.scale(0.028, 0.006, 0.045);
    for (let s = 0; s < n; s++) {
      const ang = (s / n) * Math.PI * 2 + 0.6;
      const len = D * (0.7 + 0.3 * ((s * 7) % 3) / 2);
      const path: Vec3[] = [];
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const out = S * (0.8 + 0.5 * Math.sin(t * Math.PI * 0.5));
        path.push([Math.cos(ang) * out, -len * t + 0.03 * Math.sin(t * Math.PI), Math.sin(ang) * out]);
      }
      parts.push(sweepProfile(ring, path, { up: [1, 0, 0], caps: false }));
      for (let i = 1; i < steps; i++) {
        const p = path[i];
        const l = leaf.clone();
        l.rotateY(ang + (i % 2 ? 0.9 : -0.9));
        l.rotateX(0.5);
        l.translate(p[0], p[1] - 0.01, p[2]);
        parts.push(l);
      }
    }
    return merged(parts);
  });
}

/** Succulent rosette: three rings of fat leaves (origin at the soil). */
export function rosette(r = 0.05): THREE.BufferGeometry {
  const R = num(r, 0.015, 0.15, 0.05);
  return cached(`krosette|${k(R)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const rings: Array<[number, number, number]> = [[8, 1, 0.55], [6, 0.65, 0.95], [4, 0.35, 1.3]];
    rings.forEach(([n, scale, tilt], ri) => {
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + ri * 0.4;
        const leaf = new THREE.SphereGeometry(1, 7, 5);
        leaf.scale(R * 0.28 * scale, R * 0.12 * scale, R * 0.5 * scale);
        leaf.translate(0, 0, R * 0.42 * scale);
        leaf.rotateX(-tilt);
        leaf.rotateY(ang);
        leaf.translate(0, R * 0.08 + ri * R * 0.16, 0);
        parts.push(leaf);
      }
    });
    return merged(parts);
  });
}

/** Picture frame: four rails around an opening, back face at z = 0 (origin at the centre). */
export function pictureFrame(w: number, h: number, rail = inch(1), depth = inch(1.25)): THREE.BufferGeometry {
  const W = num(w, 0.1, 3, 0.6);
  const H = num(h, 0.1, 3, 0.75);
  const R = Math.min(num(rail, 0.008, 0.08, inch(1)), W / 4, H / 4);
  const D = num(depth, 0.008, 0.08, inch(1.25));
  return cached(`kframe|${k(W)}|${k(H)}|${k(R)}|${k(D)}`, () => merged([
    transformed(chamferBox(W, R, D, 0.0015), { position: [0, H / 2 - R / 2, D / 2] }),
    transformed(chamferBox(W, R, D, 0.0015), { position: [0, -H / 2 + R / 2, D / 2] }),
    transformed(chamferBox(R, H - 2 * R, D, 0.0015), { position: [-W / 2 + R / 2, 0, D / 2] }),
    transformed(chamferBox(R, H - 2 * R, D, 0.0015), { position: [W / 2 - R / 2, 0, D / 2] }),
  ]));
}

/** Bound edge of a rectangular rug: a flat tape around the perimeter (origin at the centre, on the floor). */
export function rugBinding(len: number, wide: number, band = 0.03, t = 0.008): THREE.BufferGeometry {
  const L = num(len, 0.3, 6, 2);
  const Wd = num(wide, 0.3, 4, 0.8);
  const B = Math.min(num(band, 0.01, 0.1, 0.03), Wd / 4);
  const T = num(t, 0.002, 0.03, 0.008);
  return cached(`krugbind|${k(L)}|${k(Wd)}|${k(B)}|${k(T)}`, () => merged([
    transformed(chamferBox(L, T, B, 0.001), { position: [0, T / 2, -Wd / 2 + B / 2] }),
    transformed(chamferBox(L, T, B, 0.001), { position: [0, T / 2, Wd / 2 - B / 2] }),
    transformed(chamferBox(B, T, Wd - 2 * B, 0.001), { position: [-L / 2 + B / 2, T / 2, 0] }),
    transformed(chamferBox(B, T, Wd - 2 * B, 0.001), { position: [L / 2 - B / 2, T / 2, 0] }),
  ]));
}

/** Round rug: a flat pile disc (origin at the centre, on the floor). */
export function roundRug(r: number, t = 0.006): THREE.BufferGeometry {
  const R = num(r, 0.2, 2.5, 0.8);
  const T = num(t, 0.002, 0.03, 0.006);
  return cached(`kroundrug|${k(R)}|${k(T)}`, () => lathePoints([[0, 0], [R, 0], [R, T], [0, T]], 48));
}

/** Binding ring for a round rug. */
export function roundBinding(r: number, band = 0.03, t = 0.008): THREE.BufferGeometry {
  const R = num(r, 0.2, 2.5, 0.8);
  const B = num(band, 0.01, 0.1, 0.03);
  const T = num(t, 0.002, 0.03, 0.008);
  return cached(`kroundbind|${k(R)}|${k(B)}|${k(T)}`, () => lathePoints([[R - B, 0], [R, 0], [R, T], [R - B, T], [R - B, 0]], 48));
}

/**
 * Roman shade, raised: the head box and a stack of soft folds beneath it,
 * each fold set back a touch so the stack reads as fabric, not as a box.
 * Origin at the head's top edge; hangs down -y; back face at z = 0.
 */
export function romanShade(w: number, folds = 4, foldH = 0.075, dpt = 0.045): THREE.BufferGeometry {
  const W = num(w, 0.3, 4, 1.2);
  const n = Math.round(num(folds, 2, 6, 4));
  const F = num(foldH, 0.04, 0.14, 0.075);
  const D = num(dpt, 0.02, 0.1, 0.045);
  return cached(`kroman|${k(W)}|${n}|${k(F)}|${k(D)}`, () => {
    const parts: THREE.BufferGeometry[] = [transformed(chamferBox(W, 0.05, D, 0.002), { position: [0, -0.025, D / 2] })];
    for (let i = 0; i < n; i++) {
      const d = D * (0.95 - i * 0.1);
      const y = -0.05 - F * (i + 0.5);
      parts.push(transformed(filletBox(W, F, d, 0.012, 2), { position: [0, y, d / 2 + 0.004] }));
    }
    // the last fold has a weighted hem
    parts.push(transformed(cyl(0.011, W - 0.01, 12), { position: [0, -0.05 - F * n - 0.006, D * 0.5], rotation: [0, 0, Math.PI / 2] }));
    return merged(parts);
  });
}

/** Roller-shade tube with its end caps, along X (origin at the tube axis). */
export function rollerTube(w: number, r = 0.02): THREE.BufferGeometry {
  const W = num(w, 0.2, 4, 1);
  const R = num(r, 0.01, 0.04, 0.02);
  return cached(`kroller|${k(W)}|${k(R)}`, () => merged([
    transformed(cyl(R, W - 0.02, 18), { rotation: [0, 0, Math.PI / 2] }),
    transformed(cyl(R * 1.25, 0.012, 18), { position: [-W / 2 + 0.006, 0, 0], rotation: [0, 0, Math.PI / 2] }),
    transformed(cyl(R * 1.25, 0.012, 18), { position: [W / 2 - 0.006, 0, 0], rotation: [0, 0, Math.PI / 2] }),
  ]));
}

/** Curtain rod with turned finials and two wall brackets, along X (origin at the rod axis, wall at z = -stand). */
export function curtainRod(len: number, r = 0.012, stand = 0.09): THREE.BufferGeometry {
  const L = num(len, 0.3, 6, 1.6);
  const R = num(r, 0.004, 0.03, 0.012);
  const S = num(stand, 0.02, 0.2, 0.09);
  return cached(`krod|${k(L)}|${k(R)}|${k(S)}`, () => {
    const finial = lathePoints([[0, 0], [R * 1.1, 0], [R * 1.6, 0.012], [R * 1.8, 0.026], [R * 1.2, 0.04], [R * 0.5, 0.05], [0, 0.056]], 14);
    const parts: THREE.BufferGeometry[] = [transformed(cyl(R, L, 14), { rotation: [0, 0, Math.PI / 2] })];
    for (const sx of [-1, 1]) {
      parts.push(transformed(finial, { position: [sx * L / 2, 0, 0], rotation: [0, 0, sx * -Math.PI / 2] }));
      const bx = sx * (L / 2 - 0.12);
      parts.push(transformed(cyl(R * 0.6, S, 10), { position: [bx, 0, -S / 2], rotation: [Math.PI / 2, 0, 0] }));
      parts.push(transformed(chamferBox(0.04, 0.05, 0.006, 0.001), { position: [bx, 0, -S + 0.003] }));
    }
    return merged(parts);
  });
}

/** Gathered curtain panel, cached (the shared builder is not): x centred, y from 0 up, hangs toward -z. */
export function curtainPanel(w: number, h: number): THREE.BufferGeometry {
  const W = num(w, 0.15, 3, 0.6);
  const H = num(h, 0.2, 3, 1.5);
  return cached(`kcurtain|${k(W)}|${k(H)}`, () => curtainGeometry(W, H, 0.008, Math.max(3, Math.round(W / 0.09)), 0.024));
}

// ---------------------------------------------------------------------------
// Items — the things that stand ON a surface
// ---------------------------------------------------------------------------
/**
 * The client's complaint was that the twin never showed the pot on the stove.
 * These are the shapes that answer it. Same contract as everything above:
 * metres, origin at the BASE CENTRE, front +z, cached by rounded parameters,
 * never mutate what comes back.
 *
 * Multi-material objects return their pieces separately (`{ body, lid }`) so
 * the item builder can give each piece its own look — a stainless knob on an
 * enamel Dutch oven is what stops it reading as one moulded blob. Single
 * material ones go through `merged()`.
 */

/** Stock pot: straight-sided body, domed lid, knob, two swept loop handles. */
export function stockPot(r: number, hgt: number): { body: THREE.BufferGeometry; lid: THREE.BufferGeometry } {
  const R = num(r, 0.04, 0.26, 0.13);
  const H = num(hgt, 0.05, 0.4, 0.16);
  const key = `kpot|${k(R)}|${k(H)}`;
  const body = cached(`${key}|b`, () => {
    const parts: THREE.BufferGeometry[] = [lathePoints([
      [0, 0], [R * 0.92, 0], [R, R * 0.10], [R, H * 0.94], [R * 1.04, H * 0.97],
      [R * 1.04, H], [R * 0.98, H], [R * 0.96, H * 0.94], [0, H * 0.94],
    ], 24)];
    // loop handles, swept so they read as bent bar rather than pasted torus
    const ring: Vec2[] = [];
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2; ring.push([Math.cos(a) * 0.006, Math.sin(a) * 0.006]); }
    for (const sx of [-1, 1]) {
      const path: Vec3[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (i / 8);
        path.push([sx * (R + Math.sin(a) * R * 0.42), H * 0.82 - Math.cos(a) * R * 0.40, 0]);
      }
      parts.push(sweepProfile(ring, path, { up: [0, 0, 1], caps: false }));
    }
    return merged(parts);
  });
  const lid = cached(`${key}|l`, () => merged([
    lathePoints([[0, 0], [R * 1.02, 0], [R * 1.02, R * 0.05], [R * 0.86, R * 0.16], [R * 0.30, R * 0.22], [0, R * 0.22]], 24),
    transformed(lathePoints([[0, 0], [R * 0.16, 0.004], [R * 0.13, R * 0.10], [0, R * 0.12]], 12), { position: [0, R * 0.22, 0] }),
  ]));
  return { body, lid };
}

/** Frying pan: a shallow lathe dish plus a handle running out along +x, tilted
 *  up 0.18 rad the way a real riveted handle sits. */
export function fryingPan(r: number, handleLen: number): { pan: THREE.BufferGeometry; handle: THREE.BufferGeometry } {
  const R = num(r, 0.05, 0.22, 0.12);
  const L = num(handleLen, 0.05, 0.35, 0.16);
  const key = `kpan|${k(R)}|${k(L)}`;
  const pan = cached(`${key}|p`, () => lathePoints([
    [0, 0], [R * 0.70, 0], [R * 0.86, 0.008], [R * 0.96, 0.030], [R, 0.052],
    [R * 1.03, 0.055], [R * 0.99, 0.056], [R * 0.94, 0.034], [R * 0.84, 0.014], [0, 0.010],
  ], 24));
  const handle = cached(`${key}|h`, () => transformed(
    chamferBox(L, 0.014, 0.026, 0.004),
    { position: [R + L / 2 - 0.006, 0.040 + Math.sin(0.18) * L / 2, 0], rotation: [0, 0, 0.18] },
  ));
  return { pan, handle };
}

/** Dutch oven: heavy squat body, domed lid, stub handles. Knob is separate. */
export function dutchOven(r: number, hgt: number): { body: THREE.BufferGeometry; lid: THREE.BufferGeometry; knob: THREE.BufferGeometry } {
  const R = num(r, 0.05, 0.24, 0.14);
  const H = num(hgt, 0.05, 0.30, 0.14);
  const key = `kdutch|${k(R)}|${k(H)}`;
  const body = cached(`${key}|b`, () => {
    const parts: THREE.BufferGeometry[] = [lathePoints([
      [0, 0], [R * 0.80, 0], [R * 0.94, H * 0.10], [R, H * 0.42], [R * 0.98, H * 0.72],
      [R * 1.06, H * 0.80], [R * 1.06, H], [R * 0.96, H], [R * 0.94, H * 0.80], [0, H * 0.80],
    ], 24)];
    for (const sx of [-1, 1]) {
      parts.push(transformed(chamferBox(R * 0.34, H * 0.16, R * 0.5, 0.003), { position: [sx * (R * 1.16), H * 0.60, 0] }));
    }
    return merged(parts);
  });
  const lid = cached(`${key}|l`, () => lathePoints([
    [0, 0], [R * 1.06, 0], [R * 1.06, H * 0.06], [R * 0.90, H * 0.14], [R * 0.36, H * 0.20], [0, H * 0.21],
  ], 24));
  const knob = cached(`${key}|k`, () => lathePoints([
    [0, 0], [R * 0.16, 0.002], [R * 0.19, R * 0.09], [R * 0.10, R * 0.13], [0, R * 0.13],
  ], 12));
  return { body, lid, knob };
}

/** Narrow-necked vase (origin at the base). */
export function vase(r: number, hgt: number): THREE.BufferGeometry {
  const R = num(r, 0.02, 0.24, 0.07);
  const H = num(hgt, 0.05, 0.6, 0.25);
  return cached(`kvase|${k(R)}|${k(H)}`, () => lathePoints([
    [0, 0], [R * 0.62, 0], [R * 0.78, H * 0.06], [R, H * 0.34], [R * 0.94, H * 0.58],
    [R * 0.52, H * 0.82], [R * 0.46, H * 0.94], [R * 0.54, H], [R * 0.46, H], [R * 0.40, H * 0.94], [0, H * 0.94],
  ], 20));
}

/** Flower stems splayed out of a vase neck, with small heads (origin at the neck). */
export function stems(hgt: number, count = 7): THREE.BufferGeometry {
  const H = num(hgt, 0.05, 0.7, 0.22);
  const n = Math.round(num(count, 1, 14, 7));
  return cached(`kstems|${k(H)}|${n}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (i % 3) * 0.5;
      const lean = 0.12 * (0.4 + (i % 3) * 0.3);
      const len = H * (0.7 + ((i * 7) % 5) * 0.075);
      const stem = cyl(0.0028, len, 6).clone();
      stem.translate(0, len / 2, 0);
      stem.rotateZ(lean);
      stem.rotateY(ang);
      parts.push(stem);
      const head = new THREE.SphereGeometry(0.017, 8, 6);
      head.translate(0, len, 0);
      head.rotateZ(lean);
      head.rotateY(ang);
      parts.push(head);
    }
    return merged(parts);
  });
}

/** Wooden spoons and a whisk standing in a crock (origin at the crock's rim). */
export function utensils(hgt: number): THREE.BufferGeometry {
  const H = num(hgt, 0.05, 0.4, 0.18);
  return cached(`kutensils|${k(H)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const lay = [-0.12, -0.04, 0.05, 0.11, 0.02];
    lay.forEach((lean, i) => {
      const len = H * (0.75 + (i % 3) * 0.12);
      if (i < 3) {
        const rod = cyl(0.0045, len, 8).clone();
        rod.translate(0, len / 2, 0);
        rod.rotateZ(lean);
        rod.rotateY(i * 1.3);
        parts.push(rod);
      } else {
        // flat blades — a spatula reads only if it is flat
        const blade = chamferBox(0.032, len, 0.005, 0.001).clone();
        blade.translate(0, len / 2, 0);
        blade.rotateZ(lean);
        blade.rotateY(i * 1.1);
        parts.push(blade);
      }
    });
    return merged(parts);
  });
}

/** Knife block: a wedge on a base with four slots and four handle stubs. */
export function knifeBlock(w: number, hgt: number, dpt: number): { block: THREE.BufferGeometry; handles: THREE.BufferGeometry } {
  const W = num(w, 0.04, 0.30, 0.13);
  const H = num(hgt, 0.06, 0.40, 0.22);
  const D = num(dpt, 0.03, 0.30, 0.11);
  const key = `kknife|${k(W)}|${k(H)}|${k(D)}`;
  const block = cached(`${key}|b`, () => merged([
    transformed(chamferBox(W, 0.012, D * 1.15, 0.002), { position: [0, 0.006, 0] }),
    transformed(chamferBox(W, H, D * 0.82, 0.004), { position: [0, 0.012 + H / 2, Math.sin(0.35) * H * 0.5], rotation: [-0.35, 0, 0] }),
  ]));
  const handles = cached(`${key}|h`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const len = 0.055 + (i % 2) * 0.018;
      parts.push(transformed(chamferBox(W * 0.13, len, 0.012, 0.002), {
        position: [(t - 0.5) * W * 0.78, 0.012 + H + Math.cos(0.35) * len / 2 - 0.004, Math.sin(0.35) * (H + len / 2)],
        rotation: [-0.35, 0, 0],
      }));
    }
    return merged(parts);
  });
  return { block, handles };
}

/** Drip coffee maker: back tower, canopy over the carafe, warming plate. */
export function coffeeMaker(w: number, hgt: number, dpt: number): { body: THREE.BufferGeometry; carafe: THREE.BufferGeometry } {
  const W = num(w, 0.08, 0.40, 0.22);
  const H = num(hgt, 0.10, 0.55, 0.34);
  const D = num(dpt, 0.06, 0.40, 0.25);
  const key = `kcoffee|${k(W)}|${k(H)}|${k(D)}`;
  const body = cached(`${key}|b`, () => merged([
    // tower at the back, canopy across the top, plate at the bottom
    transformed(filletBox(W, H, D * 0.42, 0.010, 2), { position: [0, H / 2, -D * 0.29] }),
    transformed(filletBox(W, H * 0.22, D * 0.62, 0.008, 2), { position: [0, H - H * 0.11, D * 0.19] }),
    transformed(cyl(W * 0.34, 0.010, undefined, 0.0008), { position: [0, 0.005, D * 0.16] }),
    transformed(filletBox(W * 0.42, H * 0.16, 0.006, 0.002, 1), { position: [0, H * 0.60, -D * 0.29 + D * 0.21 + 0.003] }),
  ]));
  const carafe = cached(`${key}|c`, () => {
    const { profile } = cupProfile({ height: H * 0.44, wall: 0.05, floor: 0.008, rim: 0.006, baseInset: 0.12, baseRise: 0.006 });
    const g = cupShell(profile, W * 0.30);
    const handle = new THREE.TorusGeometry(W * 0.15, 0.006, 6, latheSegments(W * 0.15), Math.PI * 1.1);
    handle.rotateZ(-Math.PI * 0.1);
    handle.translate(W * 0.32, H * 0.26, 0);
    return merged([g, handle]);
  });
  return { body, carafe };
}

/** Stand mixer: lathe base, column, tilting head lying along z. Bowl separate. */
export function standMixer(hgt: number): { body: THREE.BufferGeometry; bowl: THREE.BufferGeometry } {
  const H = num(hgt, 0.15, 0.55, 0.36);
  const key = `kmixer|${k(H)}`;
  const body = cached(`${key}|b`, () => {
    const base = lathePoints([
      [0, 0], [H * 0.32, 0], [H * 0.34, H * 0.03], [H * 0.33, H * 0.14], [H * 0.20, H * 0.20], [0, H * 0.20],
    ], 20).clone();   // cloned: the lathe cache is shared
    base.scale(1, 1, 0.86);
    const column = transformed(filletBox(H * 0.30, H * 0.62, H * 0.30, 0.012, 2), { position: [-H * 0.16, H * 0.50, 0] });
    const head = transformed(filletBox(H * 0.62, H * 0.26, H * 0.28, 0.014, 2), { position: [H * 0.06, H * 0.86, 0] });
    const nose = transformed(cyl(H * 0.09, H * 0.16, undefined, 0.001), { position: [H * 0.30, H * 0.68, 0] });
    return merged([base, column, head, nose]);
  });
  const bowl = cached(`${key}|w`, () => {
    const { profile } = cupProfile({ height: H * 0.34, wall: 0.05, floor: 0.010, rim: 0.006, baseInset: 0.42, baseRise: 0.010 });
    const g = cupShell(profile, H * 0.30);
    return applyWorldUVs(transformed(g, { position: [H * 0.16, H * 0.20, 0] }));
  });
  return { body, bowl };
}

/** Two-slice toaster: fillet box, two slots, a lever and a dial. */
export function toaster(w: number, hgt: number, dpt: number): { body: THREE.BufferGeometry; slots: THREE.BufferGeometry } {
  const W = num(w, 0.08, 0.40, 0.28);
  const H = num(hgt, 0.06, 0.30, 0.18);
  const D = num(dpt, 0.05, 0.30, 0.17);
  const key = `ktoaster|${k(W)}|${k(H)}|${k(D)}`;
  const body = cached(`${key}|b`, () => merged([
    filletBox(W, H, D, 0.012, 2).clone().translate(0, H / 2, 0),
    transformed(chamferBox(0.012, H * 0.34, 0.010, 0.001), { position: [W / 2 + 0.005, H * 0.62, D * 0.16] }),
    transformed(cyl(0.014, 0.008, undefined, 0.0006), { position: [W / 2 + 0.003, H * 0.34, -D * 0.10], rotation: [0, 0, Math.PI / 2] }),
  ]));
  const slots = cached(`${key}|s`, () => merged([
    transformed(chamferBox(W * 0.66, 0.004, D * 0.20, 0.0006), { position: [0, H - 0.002, -D * 0.13] }),
    transformed(chamferBox(W * 0.66, 0.004, D * 0.20, 0.0006), { position: [0, H - 0.002, D * 0.13] }),
  ]));
  return { body, slots };
}

/** Countertop microwave: box, a proud door slab and a bar handle. Window and keypad separate. */
export function countertopMicrowave(w: number, hgt: number, dpt: number): { body: THREE.BufferGeometry; window: THREE.BufferGeometry; pad: THREE.BufferGeometry } {
  const W = num(w, 0.20, 0.80, 0.51);
  const H = num(hgt, 0.12, 0.45, 0.28);
  const D = num(dpt, 0.15, 0.60, 0.38);
  const key = `kmicro|${k(W)}|${k(H)}|${k(D)}`;
  const doorW = W * 0.68;
  const body = cached(`${key}|b`, () => merged([
    filletBox(W, H, D, 0.008, 2).clone().translate(0, H / 2, 0),
    transformed(filletBox(doorW, H * 0.94, 0.014, 0.004, 2), { position: [-(W - doorW) / 2, H / 2, D / 2 + 0.007] }),
    transformed(chamferBox(0.016, H * 0.72, 0.020, 0.003), { position: [-(W - doorW) / 2 + doorW / 2 - 0.014, H / 2, D / 2 + 0.024] }),
  ]));
  const window = cached(`${key}|w`, () => transformed(chamferBox(doorW * 0.78, H * 0.68, 0.004, 0.001), {
    position: [-(W - doorW) / 2, H / 2, D / 2 + 0.015],
  }));
  const pad = cached(`${key}|p`, () => transformed(chamferBox(W * 0.24, H * 0.72, 0.004, 0.001), {
    position: [W / 2 - W * 0.16, H / 2, D / 2 + 0.004],
  }));
  return { body, window, pad };
}

/**
 * One builder serves the canister and the jar: a straight body with a rolled
 * rim and a lid whose form says what it is — a screw band, a wooden plug or a
 * bail clip. Lid is separate so glass and metal can differ.
 */
export function jar(r: number, hgt: number, lid: 'metal' | 'wood' | 'clip' = 'metal'): { body: THREE.BufferGeometry; lid: THREE.BufferGeometry } {
  const R = num(r, 0.015, 0.16, 0.05);
  const H = num(hgt, 0.04, 0.40, 0.16);
  const style = lid === 'wood' || lid === 'clip' ? lid : 'metal';
  const key = `kjar|${k(R)}|${k(H)}|${style}`;
  const bodyH = H * 0.86;
  const body = cached(`${key}|b`, () => lathePoints([
    [0, 0], [R * 0.86, 0], [R, R * 0.14], [R, bodyH * 0.86], [R * 0.92, bodyH * 0.96],
    [R * 0.90, bodyH], [R * 0.83, bodyH], [R * 0.83, bodyH * 0.90], [0, bodyH * 0.88],
  ], 18));
  const lidG = cached(`${key}|l`, () => {
    const cap = style === 'wood'
      ? lathePoints([[0, 0], [R * 0.82, 0], [R * 0.94, 0.004], [R * 0.94, H - bodyH], [R * 0.70, H - bodyH + 0.004], [0, H - bodyH + 0.004]], 18)
      : lathePoints([[0, 0], [R * 0.86, 0], [R * 0.98, 0.003], [R * 0.98, (H - bodyH) * 0.8], [R * 0.80, H - bodyH], [0, H - bodyH]], 18);
    const g = transformed(cap, { position: [0, bodyH * 0.88, 0] });
    if (style !== 'clip') return g;
    const clip = new THREE.TorusGeometry(R * 1.02, 0.0022, 5, latheSegments(R * 1.02), Math.PI);
    clip.rotateY(Math.PI / 2);
    clip.translate(0, bodyH * 0.92, 0);
    return merged([g, clip]);
  });
  return { body, lid: lidG };
}

/** Pillar candle with a wick (origin at the base). Wick is separate. */
export function candle(r: number, hgt: number): { body: THREE.BufferGeometry; wick: THREE.BufferGeometry } {
  const R = num(r, 0.008, 0.09, 0.028);
  const H = num(hgt, 0.02, 0.35, 0.10);
  const key = `kcandle|${k(R)}|${k(H)}`;
  return {
    body: cached(`${key}|b`, () => transformed(cyl(R, H, undefined, 0.0012), { position: [0, H / 2, 0] })),
    wick: cached(`${key}|w`, () => transformed(cyl(0.0009, 0.008, 6), { position: [0, H + 0.003, 0] })),
  };
}

/** Paper-towel stand. The roll is separate so it can take 'paper'. */
export function paperTowel(): { stand: THREE.BufferGeometry; roll: THREE.BufferGeometry } {
  return {
    stand: cached('kptstand', () => merged([
      transformed(cyl(0.062, 0.008, undefined, 0.0010), { position: [0, 0.004, 0] }),
      transformed(cyl(0.011, 0.310, 12), { position: [0, 0.163, 0] }),
      transformed(cyl(0.014, 0.006, undefined, 0.0006), { position: [0, 0.318, 0] }),
    ])),
    roll: cached('kptroll', () => lathePoints([
      [0.024, 0], [0.058, 0], [0.060, 0.004], [0.060, 0.246], [0.058, 0.250], [0.024, 0.250], [0.024, 0],
    ], 20)),
  };
}

/** Drinking glass (origin at the base) — the shelf's smallest countable thing. */
export function tumbler(r: number, hgt: number): THREE.BufferGeometry {
  const R = num(r, 0.015, 0.08, 0.038);
  const H = num(hgt, 0.03, 0.25, 0.11);
  return cached(`ktumbler|${k(R)}|${k(H)}`, () => {
    const { profile } = cupProfile({ height: H, wall: 0.055, floor: 0.008, rim: 0.002, baseInset: 0.10, baseRise: 0.004 });
    return cupShell(profile, R);
  });
}

/** Dish rack: a wire grid on a drain board, with plates standing in it. */
export function dishRack(w: number, dpt: number): { rack: THREE.BufferGeometry; plates: THREE.BufferGeometry } {
  const W = num(w, 0.15, 0.70, 0.43);
  const D = num(dpt, 0.10, 0.50, 0.30);
  const key = `krack|${k(W)}|${k(D)}`;
  const rack = cached(`${key}|r`, () => merged([
    transformed(filletBox(W, 0.014, D, 0.004, 2), { position: [0, 0.007, 0] }),
    transformed(wireRack(W * 0.92, D * 0.86, 9), { position: [0, 0.100, 0] }),
    transformed(chamferBox(0.006, 0.094, 0.006, 0.001), { position: [-W * 0.44, 0.061, -D * 0.40] }),
    transformed(chamferBox(0.006, 0.094, 0.006, 0.001), { position: [W * 0.44, 0.061, -D * 0.40] }),
    transformed(chamferBox(0.006, 0.094, 0.006, 0.001), { position: [-W * 0.44, 0.061, D * 0.40] }),
    transformed(chamferBox(0.006, 0.094, 0.006, 0.001), { position: [W * 0.44, 0.061, D * 0.40] }),
  ]));
  const plates = cached(`${key}|p`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const plate = lathePoints([[0, 0], [0.05, 0], [0.085, 0.004], [0.098, 0.008], [0.096, 0.011], [0.05, 0.007], [0, 0.005]], 20);
    for (let i = 0; i < 4; i++) {
      parts.push(transformed(plate, {
        position: [(i - 1.5) * Math.min(0.052, W / 5), 0.115, 0],
        rotation: [0, 0, Math.PI / 2 - 0.10],
      }));
    }
    return merged(parts);
  });
  return { rack, plates };
}

/**
 * Shallow serving tray with a lipped edge. Moved here from `appliances.ts`
 * (`trayGeometry`) so every item shape lives in one file.
 */
export function tray(w: number, dpt: number): THREE.BufferGeometry {
  const W = num(w, 0.08, 0.80, 0.40);
  const D = num(dpt, 0.06, 0.60, 0.28);
  return cached(`ktray|${k(W)}|${k(D)}`, () => filletBox(W, inch(0.6), D, inch(0.4), 2).clone().translate(0, inch(0.3), 0));
}

/** Woven basket: tapered open box (origin at the floor). */
export function basket(w: number, hgt: number): THREE.BufferGeometry {
  const W = num(w, 0.08, 0.80, 0.36);
  const H = num(hgt, 0.05, 0.60, 0.25);
  return cached(`kbasket|${k(W)}|${k(H)}`, () => {
    // 4 segments is the point — a square basket — and the clone is because the
    // lathe cache is shared
    const g = lathePoints([
      [0, 0], [W * 0.36, 0], [W * 0.42, H * 0.14], [W * 0.50, H * 0.92], [W * 0.50, H],
      [W * 0.46, H], [W * 0.46, H * 0.92], [W * 0.38, H * 0.14], [0, H * 0.10],
    ], 4).clone();
    g.rotateY(Math.PI / 4);
    return applyWorldUVs(g);
  });
}

/** Folded tea towel sitting flat on a counter (origin at the base). */
export function foldedTowel(w: number, dpt: number, folds = 3): THREE.BufferGeometry {
  const W = num(w, 0.06, 0.60, 0.30);
  const D = num(dpt, 0.04, 0.40, 0.21);
  const n = Math.round(num(folds, 1, 5, 3));
  return cached(`kfolded|${k(W)}|${k(D)}|${n}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      parts.push(transformed(chamferBox(W * (1 - i * 0.03), 0.010, D * (1 - i * 0.04), 0.002), {
        position: [i * 0.003, 0.005 + i * 0.010, i * 0.002], rotation: [0, i * 0.03, 0],
      }));
    }
    return merged(parts);
  });
}

/** Free the kitchen geometry cache (whole-project teardown only). */
export function disposeKitchenCache() {
  // some entries here ARE the shared lathe geometry (a vase, a jar body, a pan),
  // so the turned-part cache has to go with them or it would hand out a disposed
  // geometry on the next build
  disposeLatheCache();
  cache.forEach((g) => g.dispose());
  cache.clear();
}
export function kitchenCacheSize(): number { return cache.size; }
