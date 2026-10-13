'use client';
/**
 * The paywall after the free scans: one card, one button. Opened by the
 * analysis hook when the server answers 402 `limit_reached`; the button starts
 * a Square checkout hosted by the Unifictional portal and comes back to
 * /studio?unlock=<id>, where Studio claims it.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, Sparkles, X } from 'lucide-react';

type UnlockState = { open: boolean; used: number; free: number };
let state: UnlockState = { open: false, used: 0, free: 2 };
const listeners = new Set<() => void>();
const publish = (next: UnlockState) => { state = next; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Called by the analysis hook when the server refuses a scan. */
export function requestUnlock(details?: { used?: number; free?: number }) {
  publish({ open: true, used: details?.used ?? state.used, free: details?.free ?? state.free });
}
export const closeUnlock = () => publish({ ...state, open: false });
const useUnlockState = () => useSyncExternalStore(subscribe, () => state, () => state);

export function UnlockModal() {
  const s = useUnlockState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState('$1');

  useEffect(() => {
    if (!s.open) return;
    fetch('/api/unlock/status', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j?.price) setPrice(j.price); }).catch(() => {});
  }, [s.open]);

  async function unlock() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/unlock/start', { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) throw new Error(j.error || 'Could not start the checkout.');
      window.location.href = j.url;
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not start the checkout.');
    }
  }

  return (
    <AnimatePresence>
      {s.open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Unlock unlimited scans">
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }} className="relative w-full max-w-md rounded-3xl border border-white/10 bg-neutral-950 p-7 text-white shadow-2xl">
            <button type="button" onClick={closeUnlock} aria-label="Close" className="absolute right-4 top-4 rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"><X size={16} /></button>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-400/15 text-amber-300"><Lock size={18} /></div>
            <h2 className="mt-5 text-2xl font-semibold leading-tight">You&apos;ve used your {s.free} free scans</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/70">Unlock <span className="text-white">unlimited scans for 30 days</span> for {price}. Pay once on Square; no account, no subscription. Everything you&apos;ve made so far stays.</p>
            <ul className="mt-5 space-y-2 text-sm text-white/80">
              {['Unlimited photo-to-3D scans', 'Every material, every render, live pricing', 'Works on this connection and this browser'].map((t) => (
                <li key={t} className="flex items-start gap-2"><Sparkles size={14} className="mt-0.5 shrink-0 text-amber-300" />{t}</li>
              ))}
            </ul>
            <button type="button" onClick={unlock} disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-amber-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:opacity-60">
              {busy ? 'Opening Square…' : `Unlock for ${price}`}
            </button>
            <button type="button" onClick={closeUnlock} className="mt-3 w-full text-xs text-white/50 hover:text-white">Not now</button>
            {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A quiet confirmation after coming back from Square. */
export function UnlockToast({ text }: { text: string | null }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-white/10 bg-neutral-950 px-5 py-2.5 text-sm text-white shadow-xl">
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
