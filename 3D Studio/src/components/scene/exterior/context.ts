'use client';
/**
 * Small hooks the exterior components share: the detail tier (how much
 * geometry we are allowed to spend on this device) and the cladding assembly
 * implied by whatever siding the user has currently selected.
 *
 * The tier mirrors `SceneCanvas`'s own quality resolution — an explicit user
 * choice wins, otherwise the device is probed once at module load — so the
 * geometry budget and the post/texture budget always agree.
 */
import { useMemo } from 'react';
import { useProjectStore } from '@/lib/store/project-store';
import { claddingFor, type CladdingSpec } from './detail-ext';

export type DetailTier = 'high' | 'balanced' | 'performance';

let probed: DetailTier | null = null;
function deviceTier(): DetailTier {
  if (probed) return probed;
  if (typeof navigator === 'undefined') { probed = 'balanced'; return probed; }
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Mobi|Android/i.test(navigator.userAgent);
  probed = mobile ? 'performance' : cores >= 8 ? 'high' : 'balanced';
  return probed;
}

export function useDetailTier(): DetailTier {
  const pref = useProjectStore((s) => s.ui.quality);
  return pref === 'auto' ? deviceTier() : (pref as DetailTier);
}

/**
 * How the wall in this slot is actually built (lap courses, battens, shakes,
 * masonry…). Reading it from the live selection means a finish swap re-details
 * the elevation: choose board-and-batten and real battens grow on the wall.
 */
export function useCladding(slot: string, overrideId?: string | null): CladdingSpec {
  const selected = useProjectStore((s) => (s.ui.jarvisPreview?.snapshot.selections ?? s.project.selections)[slot]);
  const id = overrideId || selected;
  return useMemo(() => claddingFor(id), [id]);
}
