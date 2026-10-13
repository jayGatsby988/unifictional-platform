'use client';
/**
 * Small shared hooks for the Studio UI.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { animate } from 'framer-motion';
import { useProjectStore } from '@/lib/store/project-store';

/** localStorage key the studio persists to (mirrors the store's `name`). */
export const STUDIO_STORAGE_KEY = 'manhattan-project-v1';
/** separate key used while a shared /p/<id> page is mounted so it never clobbers the studio project. */
export const SHARED_STORAGE_KEY = 'manhattan-shared-view-v1';

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

/** True once the persisted zustand store has rehydrated from localStorage. */
const subscribeHydration = (cb: () => void) => useProjectStore.persist.onFinishHydration(cb);
const getHydrated = () => useProjectStore.persist.hasHydrated();
export function useHasHydrated() {
  // useSyncExternalStore is the right primitive here: hydration is external state.
  return useSyncExternalStore(subscribeHydration, getHydrated, () => false);
}

export function useMediaQuery(query: string, initial = false) {
  const [matches, setMatches] = useState(initial);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Elapsed ms since `startedAt`, ticking while `running`. */
export function useElapsed(startedAt: number | null | undefined, running = true, tickMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !startedAt) return;
    // The timer is the external system; it owns every update to `now`.
    const id = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [startedAt, running, tickMs]);
  if (!startedAt) return 0;
  return Math.max(0, now - startedAt);
}

export function fmtClock(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function fmtSeconds(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toString().padStart(2, '0')}s`;
}

/** Smoothly animates a number toward `value` (count-up effect). */
export function useCountUp(value: number, durationMs = 700) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    const controls = animate(from, value, {
      duration: durationMs / 1000,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, durationMs]);
  return display;
}

/** Debounced callback that always sees the latest fn. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delayMs: number) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return useCallback((...args: A) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => fnRef.current(...args), delayMs);
  }, [delayMs]);
}

/** Copies text to the clipboard with a fallback for insecure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Trigger a client-side file download from a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** True when the keyboard event originated in a text field (so shortcuts should be ignored). */
export function isTypingTarget(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') return (err as { message: string }).message;
  return fallback;
}
