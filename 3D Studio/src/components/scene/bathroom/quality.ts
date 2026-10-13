'use client';
/**
 * Detail tier for the bathroom builder.
 *
 * The heaviest pieces of realism — mosaic chips as real geometry, per-course
 * grout reveals, extra styling props — are worth it on a desktop and are not
 * worth it on a contractor's phone. This mirrors the tier `SceneCanvas` picks
 * for the post chain and the procedural textures, so one machine gets one
 * consistent answer instead of three components each guessing.
 */
import { useProjectStore } from '@/lib/store/project-store';

export type DetailTier = 'high' | 'balanced' | 'performance';

let measured: DetailTier | null = null;
function deviceTier(): DetailTier {
  if (measured) return measured;
  if (typeof navigator === 'undefined') { measured = 'balanced'; return measured; }
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Mobi|Android/i.test(navigator.userAgent);
  measured = mobile ? 'performance' : cores >= 8 ? 'high' : 'balanced';
  return measured;
}

export function useDetailTier(): DetailTier {
  const pref = useProjectStore((s) => s.ui.quality);
  return pref === 'auto' ? deviceTier() : (pref as DetailTier);
}

/** Instance budgets per tier — the caps that keep a phone under the draw budget. */
export const TIER_BUDGET: Record<DetailTier, { mosaic: number; courses: number; props: boolean; screws: boolean }> = {
  high: { mosaic: 1100, courses: 44, props: true, screws: true },
  balanced: { mosaic: 520, courses: 28, props: true, screws: false },
  performance: { mosaic: 0, courses: 0, props: false, screws: false },
};
