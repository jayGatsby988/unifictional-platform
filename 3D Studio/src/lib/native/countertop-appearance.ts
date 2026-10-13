import type { ScanPlaneTexturePlane } from './plane-texture-archive';
import type { ReconstructedObjectPlane } from './reconstructed-object-texture';

type Vec = [number, number, number];
export interface CountertopAppearanceFace {
  width: number; height: number; rgba: Uint8Array;
  origin: Vec; u: Vec; v: Vec; spanMeters: [number, number];
  fillColorLinear: null; coverageFraction: number; orientation: 'top';
  preserveSurfaceDetail: true;
}
const dot = (a: Vec, b: Vec) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const sub = (a: Vec, b: Vec): Vec => a.map((n, i) => n - b[i]) as Vec;
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Combine only coplanar, same-object, validated camera patches. Unknown cells
 * stay transparent; no RGB crosses an object ID, level, gap or hole. These
 * grids affect appearance only, never the captured contour or its dimensions. */
export function countertopAppearanceFaces(planes: ScanPlaneTexturePlane[], objectId: string, requested?: ReconstructedObjectPlane): CountertopAppearanceFace[] {
  const candidates = planes.filter(p => p.kind === 'countertop' && p.objectId === objectId);
  if (!candidates.length || candidates.length > 8) return [];
  const groups: ScanPlaneTexturePlane[][] = [];
  for (const p of candidates) {
    if (p.rgba.length !== p.width * p.height * 4 || p.width < 1 || p.height < 1 || p.width > 1024 || p.height > 1024
      || !Number.isFinite(p.metersPerTexel) || p.metersPerTexel < .005 || p.metersPerTexel > .25) return [];
    if (requested) {
      const normal = cross(requested.u, requested.v);
      if (Math.abs(dot(normal, cross(p.u, p.v))) < .99 || Math.abs(dot(sub(p.origin, requested.origin), normal)) > .025) continue;
    }
    const group = groups.find(g => {
      const a = g[0];
      return dot(a.u, p.u) > .999999 && dot(a.v, p.v) > .999999 && Math.abs(dot(sub(p.origin, a.origin), cross(a.u, a.v))) <= .005;
    });
    if (group) group.push(p); else groups.push([p]);
  }
  // The material supports six independently projected planes. Never flatten
  // a seventh level onto a different surface to fit that rendering limit.
  if (groups.length > 6) return [];
  return groups.flatMap(group => {
    const base = group[0], local = group.map(p => ({ p, x: dot(sub(p.origin, base.origin), base.u), y: dot(sub(p.origin, base.origin), base.v) }));
    const left = Math.min(...local.map(p => p.x)), bottom = Math.min(...local.map(p => p.y));
    const spanX = Math.max(...local.map(({ p, x }) => x + p.width * p.metersPerTexel)) - left;
    const spanY = Math.max(...local.map(({ p, y }) => y + p.height * p.metersPerTexel)) - bottom;
    if (![spanX, spanY].every(n => Number.isFinite(n) && n > 0 && n <= 12)) return [];
    const pitch = Math.max(Math.min(...group.map(p => p.metersPerTexel)), Math.max(spanX, spanY) / 256);
    const width = Math.ceil(spanX / pitch), height = Math.ceil(spanY / pitch), rgba = new Uint8Array(width * height * 4);
    let observed = 0;
    const ordered = [...local].sort((a, b) => a.p.metersPerTexel - b.p.metersPerTexel || a.p.id.localeCompare(b.p.id)).map(entry => {
      const { p } = entry, stride = p.width + 1, support = new Uint32Array(stride * (p.height + 1));
      for (let y = 0; y < p.height; y++) {
        let row = 0;
        for (let x = 0; x < p.width; x++) { row += p.rgba[(y * p.width + x) * 4 + 3] === 255 ? 1 : 0; support[(y + 1) * stride + x + 1] = support[y * stride + x + 1] + row; }
      }
      return { ...entry, support, stride };
    });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = left + (x + .5) * spanX / width, py = bottom + (y + .5) * spanY / height;
      for (const { p, x: ox, y: oy, support, stride } of ordered) {
        const sx = Math.floor((px - ox) / p.metersPerTexel), sy = Math.floor((py - oy) / p.metersPerTexel);
        if (sx < 0 || sy < 0 || sx >= p.width || sy >= p.height) continue;
        // A larger display texel may cover an unobserved source cell even if
        // its center is observed. Keep that footprint unknown; otherwise a
        // narrow gap disappears and coverage is falsely reported as complete.
        const x0 = Math.floor((left + x * spanX / width - ox) / p.metersPerTexel + 1e-8);
        const y0 = Math.floor((bottom + y * spanY / height - oy) / p.metersPerTexel + 1e-8);
        const x1 = Math.ceil((left + (x + 1) * spanX / width - ox) / p.metersPerTexel - 1e-8);
        const y1 = Math.ceil((bottom + (y + 1) * spanY / height - oy) / p.metersPerTexel - 1e-8);
        if (x0 < 0 || y0 < 0 || x1 > p.width || y1 > p.height || x1 <= x0 || y1 <= y0) continue;
        const supported = support[y1 * stride + x1] - support[y0 * stride + x1] - support[y1 * stride + x0] + support[y0 * stride + x0];
        if (supported !== (x1 - x0) * (y1 - y0)) continue;
        const at = (sy * p.width + sx) * 4;
        if (p.rgba[at + 3] !== 255) continue;
        rgba.set(p.rgba.subarray(at, at + 4), (y * width + x) * 4); observed++; break;
      }
    }
    if (!observed) return [];
    return [{ width, height, rgba, origin: base.origin.map((n, i) => n + base.u[i] * left + base.v[i] * bottom) as Vec,
      u: [...base.u] as Vec, v: [...base.v] as Vec, spanMeters: [spanX, spanY] as [number, number], fillColorLinear: null,
      coverageFraction: observed / (width * height), orientation: 'top' as const, preserveSurfaceDetail: true as const }];
  });
}
