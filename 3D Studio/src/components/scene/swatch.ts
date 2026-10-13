'use client';
/**
 * Swatch previews for procedural materials.
 *
 * A procedural material has no texture file to show in the picker, and showing
 * an unrelated stock photo would mislead — the swatch has to be the same
 * drawing the 3D view uses. These helpers render a small crop of that drawing
 * once per material and cache it as a data URL.
 */
import {
  brushedMetal, fabricWeave, groutedSlab, lapSiding, paintedWall, plankFloor, quartzWithSpeckle, tiledSurface, veinedSlab, woodGrain,
  type ProceduralResult,
} from './procedural';
import type { MaterialDef } from '@/lib/materials/catalog';
import { useEffect, useState } from 'react';

const cache = new Map<string, string>();

/** Physical width (metres) a swatch tile should show, so the pattern reads at a sensible zoom. */
const SWATCH_SPAN_M: Record<string, number> = { slab: 1.1, tile: 0.62, plank: 0.85, siding: 0.85, wood: 0.6, quartz: 0.8, 'grouted-slab': 1.1, 'brushed-metal': 0.25, fabric: 0.2, 'painted-wall': 0.6 };

type Opts<F extends (o: never) => ProceduralResult> = Parameters<F>[0];

/**
 * Every generator kind a recipe can name (mirrors runProcedural in
 * materials.ts). Custom materials matched from a photo use the wood, metal
 * and fabric generators that the static catalog never did, so the picker has
 * to be able to draw those too.
 */
function generate(def: MaterialDef): string | null {
  const spec = def.pbr.procedural;
  if (!spec || typeof document === 'undefined') return null;
  const o = { ...spec.options, px: 512 };
  let res: ProceduralResult;
  try {
    switch (spec.kind as string) {
      case 'slab': res = veinedSlab(o as unknown as Opts<typeof veinedSlab>); break;
      case 'tile': res = tiledSurface(o as unknown as Opts<typeof tiledSurface>); break;
      case 'plank': res = plankFloor(o as unknown as Opts<typeof plankFloor>); break;
      case 'siding': res = lapSiding(o as unknown as Opts<typeof lapSiding>); break;
      case 'wood': res = woodGrain(o as unknown as Opts<typeof woodGrain>); break;
      case 'quartz': res = quartzWithSpeckle(o as unknown as Opts<typeof quartzWithSpeckle>); break;
      case 'grouted-slab': res = groutedSlab(o as unknown as Opts<typeof groutedSlab>); break;
      case 'brushed-metal': res = brushedMetal(o as unknown as Opts<typeof brushedMetal>); break;
      case 'fabric': res = fabricWeave(o as unknown as Opts<typeof fabricWeave>); break;
      case 'painted-wall': res = paintedWall(o as unknown as Opts<typeof paintedWall>); break;
      default: return null;
    }
  } catch {
    return null;
  }
  // Crop to the span that reads best for this pattern, tiling if the source is smaller.
  const wantM = SWATCH_SPAN_M[spec.kind] ?? 1;
  const out = document.createElement('canvas');
  out.width = 256; out.height = 256;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  // The canvas is square in PIXELS but not always in WORLD terms: a plank
  // recipe returns `spanVM` metres along the boards against `spanM` across
  // them (1.42 m x 3.66 m on the client's floor), so scaling both axes by
  // `spanM` drew the boards ~2.6x short in the picker thumbnail.
  const spanVM = res.spanVM ?? res.spanM;
  const stepX = Math.max(1, 256 * (res.spanM / wantM));
  const stepY = Math.max(1, 256 * (spanVM / wantM));
  for (let y = 0; y < 256; y += stepY) {
    for (let x = 0; x < 256; x += stepX) {
      ctx.drawImage(res.canvas, x, y, stepX, stepY);
    }
  }
  try {
    return out.toDataURL('image/webp', 0.86);
  } catch {
    return null;
  }
}

/** Data URL for a procedural material's swatch, generated once and cached. */
export function swatchDataURL(def: MaterialDef): string | null {
  if (!def.pbr.procedural) return null;
  const hit = cache.get(def.id);
  if (hit !== undefined) return hit;
  const url = generate(def);
  if (url) cache.set(def.id, url);
  return url;
}

/**
 * The image source for any material's swatch: the catalog path for photo
 * textures, a generated data URL for procedural ones, or null when the swatch
 * is a flat colour. Generation happens after mount so it never blocks paint.
 */
export function useSwatchSrc(def: MaterialDef | undefined): string | null {
  const isProcedural = !!def?.pbr.procedural;
  // The cache is read during render and the effect only ever writes from its
  // async callback, so switching material never needs a synchronous setState.
  const [entry, setEntry] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!def || !isProcedural || cache.has(def.id)) return;
    let alive = true;
    // Defer to idle time: a picker can mount 60 swatches at once.
    const run = () => { if (!alive) return; const url = swatchDataURL(def); if (alive) setEntry({ id: def.id, url }); };
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 400 }) : window.setTimeout(run, 0);
    return () => {
      alive = false;
      if (w.requestIdleCallback && typeof id === 'number') (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(id);
      else window.clearTimeout(id as number);
    };
  }, [def, isProcedural]);

  if (!def) return null;
  if (isProcedural) return cache.get(def.id) ?? (entry && entry.id === def.id ? entry.url : null);
  return def.swatch.startsWith('/') ? def.swatch : null;
}

/** Flat colour to paint under (or instead of) the swatch image. */
export function swatchColor(def: MaterialDef | undefined): string {
  if (!def) return '#2a2c30';
  if (!def.swatch.startsWith('/')) return def.swatch;
  const p = def.pbr.procedural?.options as { base?: string; color?: string } | undefined;
  return p?.base ?? p?.color ?? def.pbr.color ?? '#2a2c30';
}
