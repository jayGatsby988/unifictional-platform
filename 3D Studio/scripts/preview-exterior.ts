/**
 * Offscreen preview of the exterior twin — the same tiny software rasteriser
 * `preview-kitchen.ts` uses, pointed at a house and a lot.
 *
 *   npx tsx scripts/preview-exterior.ts out.png [street|three-quarter|entry|plan|rear] [houseStyle] [--all]
 *   EMPTY=1 npx tsx scripts/preview-exterior.ts out.png street   # the empty-lot proposal
 *
 * Not a renderer: no textures, no shadows, no post, flat lambert per slot. It
 * exists to catch what a headless numeric check cannot — a hip cap running off
 * the corner, a soffit floating clear of the wall, a gutter hung inside the
 * fascia, a porch column standing in the flower bed, a proposed house that
 * never got drawn.
 *
 * PLACEMENT: every transform below is read off `computeExteriorLayout()` and
 * the same builders the React components call, so the shapes are the real
 * shapes. What is deliberately NOT reproduced is the fine wall hardware
 * (hose bibs, house numbers, screws) — at street distance they are sub-pixel
 * and they triple the rasterising time.
 */
import * as THREE from 'three';
import * as zlib from 'zlib';
import * as fs from 'fs';
import { defaultExterior } from '../src/lib/spec/defaults';
import type { ExteriorSpec, HouseStyle } from '../src/lib/spec/types';
import { computeExteriorLayout, type ExteriorLayout, type LBlock, type LElevation } from '../src/components/scene/exterior/layout';
import {
  eaveRuns, hipRuns, pad, polyPanel, ridgeRun, roofSolid, solid,
} from '../src/components/scene/exterior/helpers';
import {
  brickmould, claddingFor, claddingRelief, claddingReliefPoly, columnUnit, controlJoints,
  cornerBoardPair, deckBoards, downspoutRun, dripEdge, fasciaBoard, fenceParts, gutterProfile,
  hedgeGeometry, mowStripes, mulchBed, railingParts, rakeRuns, ridgeCap, roofCourses, sashUnit, shrubParts,
  sillApron, soffitPanel, stairUnit, treeParts, waterTable, chimneyUnit,
} from '../src/components/scene/exterior/detail-ext';
import { wallFace, worldPlane } from '../src/components/scene/geometry';
import { doorPanel } from '../src/components/scene/detail';
import { ft } from '../src/lib/units';

const W = 1440, H = 900;

/** Flat colours, only so the shapes read apart. */
const COLOR: Record<string, [number, number, number]> = {
  siding_primary: [0.86, 0.85, 0.81], siding_accent: [0.30, 0.31, 0.30],
  trim: [0.96, 0.95, 0.93], roof: [0.20, 0.21, 0.22],
  front_door: [0.10, 0.17, 0.27], garage_door: [0.90, 0.89, 0.86],
  window_frames: [0.13, 0.13, 0.14], foundation: [0.52, 0.51, 0.49],
  porch_columns: [0.94, 0.93, 0.90], deck: [0.50, 0.37, 0.25],
  railing: [0.94, 0.93, 0.90], driveway: [0.55, 0.55, 0.53],
  walkway: [0.62, 0.61, 0.58], patio: [0.58, 0.55, 0.51],
  lawn: [0.24, 0.40, 0.18], fence: [0.66, 0.60, 0.50], gutters: [0.88, 0.88, 0.86],
  glass: [0.36, 0.47, 0.55], plant: [0.16, 0.34, 0.14], trunk: [0.24, 0.17, 0.11],
  soil: [0.19, 0.13, 0.09], concrete: [0.63, 0.63, 0.61], asphalt: [0.17, 0.17, 0.18],
  envelope: [0.30, 0.85, 0.95], context: [0.28, 0.42, 0.22],
};

interface P { g: THREE.BufferGeometry; m: THREE.Matrix4; c: string; two?: boolean }
const M = (pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(1, 1, 1),
  );

// ---------------------------------------------------------------------------
// Part list — mirrors the components' placement, read off the same layout
// ---------------------------------------------------------------------------
function buildParts(L: ExteriorLayout): P[] {
  const out: P[] = [];
  const push = (g: THREE.BufferGeometry | null, m: THREE.Matrix4, c: string, two = false) => {
    if (g) out.push({ g, m, c, two });
  };

  // ---- ground ------------------------------------------------------------
  push(pad(L.groundHalf * 2, L.groundHalf * 2), M([0, -0.03, 0]), 'context');
  push(pad(L.lotW, L.lotD), M(), 'lawn');
  push(mowStripes(L.lotW, L.lotD), M(), 'lawn');
  if (L.street) {
    push(pad(L.street.asphalt.w, L.street.asphalt.d), M([L.street.asphalt.cx, L.street.asphalt.y, L.street.asphalt.cz]), 'asphalt');
    push(pad(L.street.sidewalk.w, L.street.sidewalk.d), M([L.street.sidewalk.cx, L.street.sidewalk.y, L.street.sidewalk.cz]), 'concrete');
    push(solid(L.street.curb.w, 0.16, L.street.curb.d), M([L.street.curb.cx, 0.06, L.street.curb.cz]), 'concrete');
  }

  // ---- flatwork ----------------------------------------------------------
  for (const p of [...L.driveway, ...L.walkway, ...(L.patio ? [L.patio] : [])]) {
    const slot = L.driveway.includes(p) ? 'driveway' : L.walkway.includes(p) ? 'walkway' : 'patio';
    push(pad(p.w, p.d), M([p.cx, p.y, p.cz]), slot);
    push(controlJoints(p.w, p.d), M([p.cx, p.y - 0.004, p.cz]), 'concrete');
  }

  // ---- masses ------------------------------------------------------------
  const elevation = (b: LBlock, e: LElevation, accent: boolean) => {
    const base = M([e.frame.cx, 0, e.frame.cz], [0, e.frame.yaw, 0]);
    const at = (g: THREE.BufferGeometry | null, pos: [number, number, number], c: string, rot?: [number, number, number]) =>
      push(g, base.clone().multiply(M(pos, rot)), c);
    const wallH = Math.max(0.3, b.eaveY - b.floorY);
    const slot = accent && b.accentWall === e.wall ? 'siding_accent' : 'siding_primary';
    const clad = claddingFor(e.sidingId ?? 'sid-hardie-lap-white');
    const holes = [
      ...e.windows.map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })),
      // Same arithmetic as `Elevation` in Elevations.tsx, and it has to be: a
      // garage door sits on the slab at grade, BELOW this wall's floorY, so
      // the hole it cuts in the siding is `floorY` SHORTER than the leaf —
      // it starts at the wall's own base and stops at the door head. Cutting
      // it `d.h` tall (what this line did) left a 12 in band of open wall
      // above every garage door, and because `wallFace` is single-sided you
      // looked straight through it to the back yard.
      ...e.doors.map((d) => {
        const base = d.kind === 'garage' ? 0 : b.floorY;
        const y = Math.max(0, base - b.floorY);
        return { x: d.x, y, w: d.w, h: Math.max(0.3, base + d.h - b.floorY - y) };
      }),
    ];
    at(wallFace(e.len, wallH, holes), [0, b.floorY, 0], slot);
    at(claddingRelief(clad, e.len, wallH, holes.map((h) => ({ ...h, w: h.w + L.trimW * 2, h: h.h + L.trimW * 2 })), 'high'), [0, b.floorY, 0.002], slot);
    if (b.floorY > 0.02) {
      at(wallFace(e.len, b.floorY, []), [0, 0, 0.018], 'foundation');
      at(waterTable(e.len + 0.02), [0, b.floorY, 0.03], 'trim');
    }
    if (e.top) {
      at(polyPanel(e.top), [0, b.eaveY, 0], e.gable ? 'siding_accent' : slot);
      at(claddingReliefPoly(clad, e.top, 'balanced'), [0, b.eaveY, 0.002], e.gable ? 'siding_accent' : slot);
    }
    at(solid(e.len, ft(0.62), 0.038), [0, b.eaveY - ft(0.31), 0.026], 'trim');
    for (const w of e.windows) {
      const yc = b.floorY + w.y + w.h / 2;
      at(brickmould(w.w, w.h, L.trimW, { profile: 'brickmould', dripCap: true }), [w.x, b.floorY + w.y, 0.004], 'trim');
      at(sillApron(w.w + L.trimW * 2 + 0.06, L.trimW), [w.x, b.floorY + w.y - 0.01, 0.006], 'trim');
      at(sashUnit(w.w, w.h, w.style), [w.x, yc, 0.004], 'window_frames');
      at(worldPlane(w.w - 0.11, w.h - 0.11), [w.x, yc, -0.006], 'glass');
    }
    for (const d of e.doors) {
      const baseY = d.kind === 'garage' ? 0 : b.floorY;
      at(brickmould(d.w, d.h, L.trimW, { profile: 'brickmould', dripCap: true }), [d.x, baseY, 0.004], 'trim');
      if (d.kind === 'garage') {
        at(solid(d.w, d.h, 0.05), [d.x, d.h / 2, 0.03], 'garage_door');
      } else if (d.kind === 'entry' || d.kind === 'side') {
        at(doorPanel('raised', d.w - 0.055, d.h - 0.04, { thickness: 0.045, rail: 0.14, stile: 0.13 }).body, [d.x, baseY + d.h / 2, -0.012], 'front_door');
      } else {
        at(worldPlane(d.w - 0.12, d.h - 0.18), [d.x, baseY + d.h / 2, -0.006], 'glass');
      }
    }
  };

  for (const b of L.blocks) {
    const accent = b.key === 'wing';
    for (const e of b.elevations) elevation(b, e, accent);
    // corner boards
    const cb = cornerBoardPair(b.eaveY - b.floorY, L.trimW);
    const hw = b.w / 2, hd = b.d / 2;
    const corners: Array<[number, number, number, string[]]> = [
      [-hw, hd, Math.PI / 2, ['front', 'left']], [hw, hd, Math.PI, ['front', 'right']],
      [hw, -hd, -Math.PI / 2, ['back', 'right']], [-hw, -hd, 0, ['back', 'left']],
    ];
    for (const [x, z, yaw, walls] of corners) {
      if (b.hidden && walls.includes(b.hidden)) continue;
      push(cb, M([b.cx + x, b.floorY, b.cz + z], [0, yaw, 0]), 'trim');
    }
    roof(b);
  }

  function roof(b: LBlock) {
    const s = b.roof;
    const g = M([b.cx, b.eaveY, b.cz]);
    const at = (geo: THREE.BufferGeometry | null, pos: [number, number, number], c: string, rot?: [number, number, number]) =>
      push(geo, g.clone().multiply(M(pos, rot)), c);
    at(roofSolid(s), [0, 0, 0], 'roof');
    at(roofCourses(s, 'high'), [0, 0, 0], 'roof');
    const eaveY0 = -s.eaveDrop;
    const off = (cx: number, cz: number, yaw: number, dist: number): [number, number] =>
      [cx + Math.sin(yaw) * dist, cz + Math.cos(yaw) * dist];
    for (const e of eaveRuns(s)) {
      const [fx, fz] = off(e.cx, e.cz, e.yaw, -0.016);
      at(fasciaBoard(e.length + 0.04), [fx, eaveY0 - s.tv * 0.5 - 0.06, fz], 'trim', [0, e.yaw, 0]);
      const [dx, dz] = off(e.cx, e.cz, e.yaw, -0.012);
      at(dripEdge(e.length + 0.04), [dx, eaveY0 + 0.004, dz], 'gutters', [0, e.yaw, 0]);
      const [gx, gz] = off(e.cx, e.cz, e.yaw, -0.11);
      at(gutterProfile(e.length), [gx, eaveY0 - s.tv - 0.055, gz], 'gutters', [0, e.yaw, 0]);
      if (s.overhang >= 0.08 && s.type !== 'flat') {
        const [sx, sz] = off(e.cx, e.cz, e.yaw, -s.overhang);
        at(soffitPanel(e.length, s.overhang), [sx, eaveY0 - s.tv - 0.05, sz], 'trim', [0, e.yaw, 0]);
      }
    }
    const r = ridgeRun(s);
    if (r) at(ridgeCap(r.length + 0.06), [0, r.y + 0.03, 0], 'roof', [0, r.yaw, 0]);
    for (const k of rakeRuns(s)) {
      const mx = (k.from[0] + k.to[0]) / 2, my = (k.from[1] + k.to[1]) / 2, mz = (k.from[2] + k.to[2]) / 2;
      const dx = k.to[0] - k.from[0], dy = k.to[1] - k.from[1], dz = k.to[2] - k.from[2];
      at(fasciaBoard(k.length, 0.2), [mx, my - s.tv * 0.55, mz], 'trim', [0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz))]);
    }
    for (const h of hipRuns(s)) {
      const mx = (h.from[0] + h.to[0]) / 2, my = (h.from[1] + h.to[1]) / 2, mz = (h.from[2] + h.to[2]) / 2;
      const dx = h.to[0] - h.from[0], dy = h.to[1] - h.from[1], dz = h.to[2] - h.from[2];
      at(ridgeCap(h.length), [mx, my + 0.03, mz], 'roof', [0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz))]);
    }
    // downspouts at the ends of the two longest eaves, strapped to the wall
    const drop = Math.max(0.6, b.eaveY + eaveY0 - s.tv - 0.1);
    const standoff = 0.03;
    const reach = Math.max(0, s.overhang - 0.11 - standoff);
    for (const e of [...eaveRuns(s)].sort((a, c) => c.length - a.length).slice(0, 2)) {
      const [ex, ez] = off(e.cx, e.cz, e.yaw, -(s.overhang + standoff));
      const half = Math.max(0.3, e.length / 2 - s.overhang - 0.2);
      for (const sg of [-1, 1]) {
        const along = half * sg;
        push(downspoutRun(drop, reach), M([b.cx + ex + along * Math.cos(e.yaw), 0, b.cz + ez - along * Math.sin(e.yaw)], [0, e.yaw, 0]), 'gutters');
      }
    }
  }

  if (L.chimney) push(chimneyUnit(L.chimney.height), M([L.chimney.x, L.chimney.base, L.chimney.z]), 'foundation');

  // ---- porch -------------------------------------------------------------
  const p = L.porch;
  if (p) {
    const base = M([p.frame.cx, 0, p.frame.cz], [0, p.frame.yaw, 0]).multiply(M([p.x, 0, p.depth / 2]));
    const at = (g: THREE.BufferGeometry | null, pos: [number, number, number], c: string, rot?: [number, number, number]) =>
      push(g, base.clone().multiply(M(pos, rot)), c);
    const colH = Math.max(ft(6.4), p.roofY - p.floorY - 0.24);
    const colZ = p.depth / 2 - ft(0.75);
    at(solid(p.w, 0.1, p.depth), [0, p.floorY - 0.05, 0], 'deck');
    if (p.floorY > 0.1) at(solid(p.w + 0.02, p.floorY, p.depth + 0.02), [0, p.floorY / 2, 0], 'foundation');
    const n = Math.max(0, Math.min(10, Math.round(p.columns)));
    const span = p.w - ft(1);
    const cols = n === 0 ? [] : n === 1 ? [0] : Array.from({ length: n }, (_, i) => -span / 2 + (span * i) / (n - 1));
    if (p.roofed) {
      const col = columnUnit(colH, p.columnKind);
      for (const x of cols) at(col, [x, p.floorY, colZ], 'porch_columns');
      at(solid(p.w + 0.18, ft(0.82), 0.15), [0, p.floorY + colH + ft(0.42), colZ], 'trim');
    }
    if (p.railing && cols.length >= 2) {
      for (let i = 0; i < cols.length - 1; i++) {
        const len = cols[i + 1] - cols[i] - 0.26;
        if (len < ft(1.2)) continue;
        const r = railingParts(len, ft(3), p.columnKind === 'timber' ? 'cable' : 'baluster');
        at(r.frame, [(cols[i] + cols[i + 1]) / 2, p.floorY, colZ], 'railing');
      }
    }
    if (p.steps > 0) at(stairUnit(Math.min(ft(5), Math.max(ft(3), p.w * 0.4)), p.floorY, p.steps), [0, p.floorY, p.depth / 2], 'deck');
    if (p.roof) {
      // the same assembly <RoofMass/> gives it: slab, courses, fascia, soffit, gutter
      const s = p.roof;
      const rg = M([p.frame.cx, 0, p.frame.cz], [0, p.frame.yaw, 0]).multiply(M([p.x, p.roofY, p.depth / 2]));
      const rat = (g: THREE.BufferGeometry | null, pos: [number, number, number], c: string, rot?: [number, number, number]) =>
        push(g, rg.clone().multiply(M(pos, rot)), c);
      rat(roofSolid(s), [0, 0, 0], 'roof');
      rat(roofCourses(s, 'high'), [0, 0, 0], 'roof');
      const e0 = -s.eaveDrop;
      for (const e of eaveRuns(s)) {
        const o = (dist: number): [number, number] => [e.cx + Math.sin(e.yaw) * dist, e.cz + Math.cos(e.yaw) * dist];
        const [fx, fz] = o(-0.016);
        rat(fasciaBoard(e.length + 0.04), [fx, e0 - s.tv * 0.5 - 0.06, fz], 'trim', [0, e.yaw, 0]);
        const [gx, gz] = o(-0.11);
        rat(gutterProfile(e.length), [gx, e0 - s.tv - 0.055, gz], 'gutters', [0, e.yaw, 0]);
        if (s.overhang >= 0.08 && s.type !== 'flat') {
          const [sx2, sz2] = o(-s.overhang);
          rat(soffitPanel(e.length, s.overhang), [sx2, e0 - s.tv - 0.05, sz2], 'trim', [0, e.yaw, 0]);
        }
      }
      const pr = ridgeRun(s);
      if (pr) rat(ridgeCap(pr.length + 0.06), [0, pr.y + 0.03, 0], 'roof', [0, pr.yaw, 0]);
    }
  }

  // ---- deck --------------------------------------------------------------
  const dk = L.deck;
  if (dk) {
    const base = M([dk.frame.cx, 0, dk.frame.cz], [0, dk.frame.yaw, 0]).multiply(M([dk.x, 0, dk.depth / 2]));
    const f = deckBoards(dk.w, dk.depth, dk.boardsAlong);
    for (const t of f.transforms) {
      push(f.board, base.clone().multiply(M([t.position![0], dk.floorY + t.position![1], t.position![2]])), 'deck');
    }
    push(f.rim, base.clone().multiply(M([0, dk.floorY, 0])), 'deck');
    if (dk.railing) {
      const r = railingParts(dk.w - 0.16, ft(3), 'baluster');
      push(r.frame, base.clone().multiply(M([0, dk.floorY, dk.depth / 2 - 0.08])), 'railing');
    }
  }

  // ---- site --------------------------------------------------------------
  for (const f of L.fence) {
    const parts = fenceParts(f.length, f.height);
    const b = M([f.cx, 0, f.cz], [0, f.yaw, 0]);
    push(parts.frame, b, 'fence');
    for (const t of parts.transforms) push(parts.picket, b.clone().multiply(M(t.position as [number, number, number])), 'fence');
  }
  for (const b of L.beds) push(mulchBed(b.w, b.d), M([b.cx, 0, b.cz], [0, b.yaw, 0]), 'soil');
  for (const s of L.shrubs) push(shrubParts(s.scale), M([s.x, 0, s.z]), 'plant', true);
  for (const h of L.hedges) push(hedgeGeometry(h.length, h.height), M([h.x, 0, h.z], [0, h.yaw, 0]), 'plant', true);
  for (const list of [L.trees, L.treeline]) {
    for (const t of list) {
      const g = treeParts(t.variant, list === L.trees ? 'high' : 'performance');
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(t.x, 0, t.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.rot, 0)),
        new THREE.Vector3(t.scale, t.scale, t.scale),
      );
      push(g.trunk, m, 'trunk');
      push(g.canopy, m, 'plant', true);
    }
  }

  // ---- the empty-lot proposal's zoning envelope ---------------------------
  if (L.proposed) {
    const e = L.envelope;
    const w = e.maxX - e.minX, d = e.maxZ - e.minZ;
    const cx = (e.minX + e.maxX) / 2, cz = (e.minZ + e.maxZ) / 2;
    push(solid(w, 0.012, 0.07), M([cx, 0.03, e.minZ]), 'envelope');
    push(solid(w + ft(12), 0.012, 0.126), M([cx, 0.03, e.maxZ]), 'envelope');
    push(solid(0.07, 0.012, d), M([e.minX, 0.03, cz]), 'envelope');
    push(solid(0.07, 0.012, d), M([e.maxX, 0.03, cz]), 'envelope');
    for (const [x, z] of [[e.minX, e.minZ], [e.maxX, e.minZ], [e.maxX, e.maxZ], [e.minX, e.maxZ]]) {
      push(solid(0.05, ft(3), 0.05), M([x, ft(1.5), z]), 'envelope');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rasteriser (same core as preview-kitchen.ts)
// ---------------------------------------------------------------------------
function render(parts: P[], eye: THREE.Vector3, target: THREE.Vector3, fovDeg: number) {
  const view = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
  const rot = new THREE.Matrix4().extractRotation(view).transpose();
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const aspect = W / H;
  const color = new Float32Array(W * H * 3);
  const invDepth = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { color[i * 3] = 0.58; color[i * 3 + 1] = 0.70; color[i * 3 + 2] = 0.84; }
  const light = new THREE.Vector3(0.45, 0.78, 0.44).normalize();
  const v = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const sa = [0, 0, 0], sb = [0, 0, 0], sc = [0, 0, 0];
  const toScreen = (pt: THREE.Vector3, o: number[]) => {
    v.copy(pt).sub(eye).applyMatrix4(rot);
    const z = -v.z;
    o[0] = ((v.x / z) * f / aspect) * 0.5 + 0.5;
    o[1] = 0.5 - ((v.y / z) * f) * 0.5;
    o[2] = 1 / z;
    o[0] *= W; o[1] *= H;
  };
  let drawn = 0;
  for (const p of parts) {
    const pos = p.g.getAttribute('position');
    if (!pos) continue;
    const idx = p.g.getIndex();
    const n = idx ? idx.count : pos.count;
    const [cr, cg, cb] = COLOR[p.c] ?? [0.7, 0.7, 0.7];
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos as THREE.BufferAttribute, i0).applyMatrix4(p.m);
      b.fromBufferAttribute(pos as THREE.BufferAttribute, i1).applyMatrix4(p.m);
      c.fromBufferAttribute(pos as THREE.BufferAttribute, i2).applyMatrix4(p.m);
      const enx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      const eny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      const enz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const facing = enx * (eye.x - a.x) + eny * (eye.y - a.y) + enz * (eye.z - a.z);
      if (facing < 0 && !p.two) continue;
      toScreen(a, sa); toScreen(b, sb); toScreen(c, sc);
      if (sa[2] <= 0 || sb[2] <= 0 || sc[2] <= 0) continue;
      const minX = Math.max(0, Math.floor(Math.min(sa[0], sb[0], sc[0])));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(sa[0], sb[0], sc[0])));
      const minY = Math.max(0, Math.floor(Math.min(sa[1], sb[1], sc[1])));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(sa[1], sb[1], sc[1])));
      if (maxX < minX || maxY < minY) continue;
      const area = (sb[0] - sa[0]) * (sc[1] - sa[1]) - (sc[0] - sa[0]) * (sb[1] - sa[1]);
      if (Math.abs(area) < 1e-9) continue;
      const nl = Math.hypot(enx, eny, enz) || 1;
      const lam = Math.abs((enx / nl) * light.x + (eny / nl) * light.y + (enz / nl) * light.z);
      const sh = 0.34 + 0.66 * lam;
      drawn++;
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const x = px + 0.5, y = py + 0.5;
          let w0 = (sb[0] - sa[0]) * (y - sa[1]) - (x - sa[0]) * (sb[1] - sa[1]);
          let w1 = (sc[0] - sb[0]) * (y - sb[1]) - (x - sb[0]) * (sc[1] - sb[1]);
          let w2 = (sa[0] - sc[0]) * (y - sc[1]) - (x - sc[0]) * (sa[1] - sc[1]);
          if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const sum = w0 + w1 + w2 || 1;
          const iz = (w1 * sa[2] + w2 * sb[2] + w0 * sc[2]) / sum;
          const o = py * W + px;
          if (iz <= invDepth[o]) continue;
          invDepth[o] = iz;
          color[o * 3] = cr * sh; color[o * 3 + 1] = cg * sh; color[o * 3 + 2] = cb * sh;
        }
      }
    }
  }
  return { color, drawn };
}

// --- minimal PNG writer -----------------------------------------------------
function crc32(buf: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePng(path: string, color: Float32Array) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      for (let ch = 0; ch < 3; ch++) raw[o++] = Math.round(255 * Math.pow(Math.max(0, Math.min(1, color[i + ch])), 1 / 2.2));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// --- go ---------------------------------------------------------------------
const argv = process.argv.slice(2).filter((a) => a !== '--all');
// `--all` is stripped BEFORE the positionals are read: it used to be eaten as
// argv[3] — the view name — so `preview-exterior.ts out.png --all` silently
// rendered one default camera and reported success.
const all = process.argv.includes('--all');
const outPath = argv[0] ?? 'exterior-preview.png';
const view = (argv[1] ?? 'three-quarter') as string;
const style = (argv[2] ?? 'modern-farmhouse') as HouseStyle;
const spec: ExteriorSpec = defaultExterior(style);
if (process.env.EMPTY) {
  // the empty-lot path: the analyzer says nothing is standing, and the intake
  // answers describe what should be
  spec.house.present = false;
  spec.detected.inputKind = 'empty-lot';
}
if (process.env.STORIES) spec.house.stories = Number(process.env.STORIES) as 1 | 2 | 3;
if (process.env.ROOF) spec.house.roof.type = process.env.ROOF as ExteriorSpec['house']['roof']['type'];

const L = computeExteriorLayout(spec);
const parts = buildParts(L);
const top = L.blocks.length ? Math.max(...L.blocks.map((b) => b.eaveY + b.roof.rise)) : ft(20);
const frontZ = L.house ? L.house.rect.maxZ : L.envelope.maxZ;
const cams: Record<string, { eye: THREE.Vector3; target: THREE.Vector3; fov: number }> = {
  // standing across the street, square on: the elevation a client photographs.
  // Distance is measured from whatever projects FURTHEST toward the street (a
  // garage wing can stand 22 ft in front of the house), or the wing fills the
  // frame and the elevation behind it is never seen.
  street: (() => {
    const near = Math.max(...L.blocks.map((b) => b.rect.maxZ), L.porch ? L.porch.rect.maxZ : -Infinity);
    return { eye: new THREE.Vector3(0, 1.65, near + ft(78)), target: new THREE.Vector3(0, top * 0.45, near - ft(14)), fov: 40 };
  })(),
  // the money shot: three-quarter from the drive side
  'three-quarter': { eye: new THREE.Vector3(ft(58), top * 0.8, L.lotD / 2 + ft(30)), target: new THREE.Vector3(0, top * 0.42, frontZ - ft(12)), fov: 44 },
  // close on the entry: porch columns, door, steps, sconces
  entry: { eye: new THREE.Vector3(ft(6), 1.7, frontZ + ft(24)), target: new THREE.Vector3(0, ft(6), frontZ - ft(2)), fov: 42 },
  rear: { eye: new THREE.Vector3(ft(-40), top * 0.9, -L.lotD / 2 + ft(6)), target: new THREE.Vector3(0, top * 0.4, L.house ? L.house.rect.minZ : 0), fov: 46 },
  plan: { eye: new THREE.Vector3(0, Math.max(L.lotW, L.lotD) * 0.95, 0.001), target: new THREE.Vector3(0, 0, 0), fov: 50 },
};
for (const v of all ? Object.keys(cams) : [view]) {
  const cam = cams[v] ?? cams['three-quarter'];
  const t0 = Date.now();
  const r = render(parts, cam.eye, cam.target, cam.fov);
  // same suffixing as preview-bathroom: one file per camera, so `--all` cannot
  // overwrite its own output four times
  const file = all ? outPath.replace(/(\.png)?$/, `-${v}.png`) : outPath;
  writePng(file, r.color);
  console.log(`${file} — ${parts.length} parts, ${r.drawn} triangles rasterised in ${Date.now() - t0} ms (${style}${process.env.EMPTY ? ', empty lot' : ''}, ${v})`);
}
