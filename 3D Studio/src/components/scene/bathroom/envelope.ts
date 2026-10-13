/** Shared wall and opening coordinates for the room shell and wet-area tile. */
import * as THREE from 'three';
import type { Wall } from '@/lib/spec/types';
import { wallFrame } from '@/components/scene/geometry';
import type { InstanceTransform } from '@/components/scene/detail';
import type { BathLayout, LShower } from './layout';

export const TILE_T = 0.010;
export interface WallHole { x: number; y: number; w: number; h: number }
export interface ShowerFace {
  kind: 'back' | 'left' | 'right';
  width: number;
  position: [number, number, number];
  rotation: [number, number, number];
  roomWall: Wall | null;
  holes: WallHole[];
}

const LEFT: Record<Wall, Wall> = { back: 'left', left: 'front', front: 'right', right: 'back' };
const RIGHT: Record<Wall, Wall> = { back: 'right', right: 'front', front: 'left', left: 'back' };

/** The niche and the hole use one transform, including niches in side partitions. */
export function showerNicheFrame(s: LShower): { position: [number, number, number]; rotation: [number, number, number] } | null {
  const n = s.nicheAt;
  if (!n) return null;
  if (n.face === 'back') return { position: [n.x, n.bottom, TILE_T], rotation: [0, 0, 0] };
  const z = n.face === 'left' ? s.depth - 0.03 - n.x : n.x;
  return {
    position: [s.innerOffset + (n.face === 'left' ? -s.inner / 2 + TILE_T : s.inner / 2 - TILE_T), n.bottom, z],
    rotation: [0, n.face === 'left' ? Math.PI / 2 : -Math.PI / 2, 0],
  };
}

function intoRoom(L: BathLayout, s: LShower, p: [number, number, number]): THREE.Vector3 {
  const f = wallFrame(s.wall, L.w, L.d);
  return f.origin.clone().addScaledVector(f.along, s.a + p[0]).addScaledVector(f.normal, p[2]).setY(p[1]);
}

/** Real window/door openings continue through the shower tile covering that wall. */
export function showerFaces(L: BathLayout, s: LShower): ShowerFace[] {
  const D = s.depth - 0.03, x = s.innerOffset, W = s.inner;
  const faces: ShowerFace[] = [
    { kind: 'back', width: W, position: [x, 0, TILE_T], rotation: [0, 0, 0], roomWall: s.wall, holes: [] },
    { kind: 'left', width: D, position: [x - W / 2 + (s.leftIsRoomWall ? TILE_T : 0), 0, D / 2], rotation: [0, Math.PI / 2, 0], roomWall: s.leftIsRoomWall ? LEFT[s.wall] : null, holes: [] },
    { kind: 'right', width: D, position: [x + W / 2 - (s.rightIsRoomWall ? TILE_T : 0), 0, D / 2], rotation: [0, -Math.PI / 2, 0], roomWall: s.rightIsRoomWall ? RIGHT[s.wall] : null, holes: [] },
  ];
  const host = wallFrame(s.wall, L.w, L.d);
  for (const face of faces) {
    const centre = intoRoom(L, s, face.position);
    const along = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), host.yaw + face.rotation[1]);
    for (const o of L.openings.filter((o) => o.wall === face.roomWall)) {
      const f = wallFrame(o.wall, L.w, L.d);
      const p = f.origin.clone().addScaledVector(f.along, o.t * f.length);
      const ox = p.sub(centre).dot(along);
      const x0 = Math.max(-face.width / 2 + 0.01, ox - o.width / 2);
      const x1 = Math.min(face.width / 2 - 0.01, ox + o.width / 2);
      if (x1 - x0 > 0.05) face.holes.push({ x: (x0 + x1) / 2, y: o.sill, w: x1 - x0, h: o.height });
    }
    const n = s.nicheAt;
    if (n?.face === face.kind) face.holes.push({ x: n.face === 'back' ? n.x - x : n.x - D / 2, y: n.bottom, w: n.width, h: n.height });
  }
  return faces;
}

/** Cut the substrate too: an intact room wall otherwise plugs the entire niche. */
export function bathroomWallHoles(L: BathLayout, wall: Wall): WallHole[] {
  const holes = L.openings.filter((o) => o.wall === wall).map((o) => ({ x: o.x, y: o.sill, w: o.width, h: o.height }));
  const s = L.shower, n = s?.nicheAt;
  if (!s || !n) return holes;
  const face = showerFaces(L, s).find((f) => f.kind === n.face);
  if (face?.roomWall !== wall) return holes;
  const frame = showerNicheFrame(s)!;
  const p = intoRoom(L, s, frame.position);
  const f = wallFrame(wall, L.w, L.d);
  holes.push({ x: p.sub(f.origin).dot(f.along) - f.length / 2, y: n.bottom, w: n.width, h: n.height });
  return holes;
}

/** Clip each joint along its actual axis, including vertical and woven joints. */
export function clipTileJoint(t: InstanceTransform, rects: Array<{ x0: number; x1: number; y0: number; y1: number }>): InstanceTransform[] {
  if (!rects.length) return [t];
  const [x, y, z] = t.position ?? [0, 0, 0];
  const scale = Array.isArray(t.scale) ? t.scale : [t.scale ?? 1, t.scale ?? 1, t.scale ?? 1];
  const length = scale[0], angle = t.rotation?.[2] ?? 0;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  let spans: Array<[number, number]> = [[-length / 2, length / 2]];
  for (const r of rects) {
    let lo = -Infinity, hi = Infinity;
    for (const [origin, direction, min, max] of [[x, ux, r.x0, r.x1], [y, uy, r.y0, r.y1]]) {
      if (Math.abs(direction) < 1e-9) {
        if (origin <= min || origin >= max) { lo = Infinity; break; }
      } else {
        const a = (min - origin) / direction, b = (max - origin) / direction;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
    }
    if (lo >= hi) continue;
    spans = spans.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b] as [number, number]]
      : [...(lo > a ? [[a, lo] as [number, number]] : []), ...(hi < b ? [[hi, b] as [number, number]] : [])]);
  }
  return spans.filter(([a, b]) => b - a > 0.006).map(([a, b]) => ({
    ...t, position: [x + ux * (a + b) / 2, y + uy * (a + b) / 2, z], scale: [b - a, scale[1], scale[2]],
  }));
}

/** Locations are inferred only for hardware whose coordinates the spec does not carry. */
export function showerHardwareLayout(L: BathLayout, s: LShower): {
  valve: [number, number, number]; head: [number, number, number]; handheld: [number, number, number];
  jets: [number, number, number]; warnings: string[];
} {
  const face = showerFaces(L, s)[0];
  const occupied = face.holes.map((h) => ({ x0: s.innerOffset + h.x - h.w / 2, x1: s.innerOffset + h.x + h.w / 2, y0: h.y, y1: h.y + h.h }));
  const warnings: string[] = [];
  const xl = s.innerOffset - s.inner / 2, xr = s.innerOffset + s.inner / 2;
  const headX = s.hasTub ? (s.leftIsRoomWall ? xl + 0.32 : s.rightIsRoomWall ? xr - 0.32 : s.innerOffset) : s.innerOffset;
  const place = (name: string, x: number, y: number, w: number, h: number, minY: number, maxY: number): [number, number, number] => {
    const gap = 0.025, halfW = w / 2, halfH = h / 2;
    const cx = (v: number) => Math.max(xl + halfW + gap, Math.min(xr - halfW - gap, v));
    const cy = (v: number) => Math.max(minY, Math.min(Math.min(maxY, L.h - halfH - gap), v));
    const xs = [cx(x), ...occupied.flatMap((o) => [cx(o.x0 - halfW - gap), cx(o.x1 + halfW + gap)])];
    const ys = [cy(y), ...occupied.flatMap((o) => [cy(o.y0 - halfH - gap), cy(o.y1 + halfH + gap)])];
    const candidates = xs.flatMap((xx) => ys.map((yy) => ({ x: xx, y: yy }))).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    const clear = (p: { x: number; y: number }) => !occupied.some((o) => p.x + halfW > o.x0 - gap + 1e-8 && p.x - halfW < o.x1 + gap - 1e-8 && p.y + halfH > o.y0 - gap + 1e-8 && p.y - halfH < o.y1 + gap - 1e-8);
    const found = candidates.find(clear);
    const p = found ?? candidates[0];
    if (!found) warnings.push(`The shower ${name} has no clear mounting space around the stated niche/window. Confirm the hardware wall and mounting location.`);
    occupied.push({ x0: p.x - halfW, x1: p.x + halfW, y0: p.y - halfH, y1: p.y + halfH });
    return [p.x, p.y, TILE_T];
  };
  const valve = place('valve', headX, s.hasTub ? 0.80 : 1.14, 0.18, 0.20, s.hasTub ? 0.65 : 0.8, 1.45);
  const head = s.fixtures === 'single' || s.fixtures === 'body-jets'
    ? place('head', headX, 1.98, 0.10, 0.10, 1.8, 2.15) : [headX, 1.98, TILE_T] as [number, number, number];
  const handCentre = s.fixtures === 'rain-plus-handheld'
    ? place('handheld rail', headX + (s.inner >= 0.9 ? 0.30 : 0.17), 1.35, 0.09, 0.74, 1.20, 1.55)
    : [headX + 0.30, 1.35, TILE_T] as [number, number, number];
  const jets = s.fixtures === 'body-jets'
    ? place('body jets', headX + 0.28, 1.2, 0.07, 0.57, 1.0, 1.4)
    : [headX + 0.28, 1.2, TILE_T] as [number, number, number];
  return { valve, head, handheld: [handCentre[0], handCentre[1] - 0.33, TILE_T], jets, warnings };
}
