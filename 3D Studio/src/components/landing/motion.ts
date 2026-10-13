'use client';
/**
 * Motion helpers shared by the landing sections: a single GSAP/ScrollTrigger
 * registration and SSR-safe media-query hooks (reduced motion, pointer type,
 * scroll position) built on useSyncExternalStore so they never cause
 * hydration mismatches or setState-in-effect churn.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

let registered = false;
export function ensureGsap() {
  if (!registered) {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
  return { gsap, ScrollTrigger };
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const FINE_POINTER_QUERY = '(pointer: fine)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function hasFinePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(FINE_POINTER_QUERY).matches;
}

const serverFalse = () => false;

function subscribeMedia(query: string) {
  return (cb: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
  };
}

/** `true` when the media query matches. Always `false` during SSR / hydration. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useMemo(() => subscribeMedia(query), [query]);
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, serverFalse);
}

export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

function subscribeScroll(cb: () => void) {
  window.addEventListener('scroll', cb, { passive: true });
  return () => window.removeEventListener('scroll', cb);
}

/** `true` once the window has scrolled past `px`. */
export function useScrolledPast(px: number): boolean {
  const getSnapshot = useCallback(() => window.scrollY > px, [px]);
  return useSyncExternalStore(subscribeScroll, getSnapshot, serverFalse);
}
