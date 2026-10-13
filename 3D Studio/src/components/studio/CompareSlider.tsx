'use client';
/**
 * Before/after compare with a draggable divider (pointer + keyboard).
 */
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from './hooks';

export function CompareSlider({ before, after, beforeLabel = 'Before', afterLabel = 'After', className, initial = 0.5, maxHeightClass = 'max-h-[70vh]' }: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
  initial?: number;
  maxHeightClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(initial);
  const [dragging, setDragging] = useState(false);

  const update = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    setPos(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  }, []);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setDragging(true);
    update(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => { if (dragging) update(e.clientX); };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPos((p) => Math.max(0, p - step)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setPos((p) => Math.min(1, p + step)); }
    if (e.key === 'Home') { e.preventDefault(); setPos(0); }
    if (e.key === 'End') { e.preventDefault(); setPos(1); }
  };

  return (
    <div className={cx('flex justify-center', className)}>
      <div
        ref={ref}
        className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded-[var(--radius)] bg-black"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ cursor: dragging ? 'grabbing' : 'col-resize' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt={beforeLabel} className={cx('block h-auto w-auto max-w-full', maxHeightClass)} draggable={false} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${(1 - pos) * 100}% 0 0)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={after} alt={afterLabel} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        </div>
        <span className="chip absolute left-3 top-3 bg-black/60 text-white/90">{beforeLabel}</span>
        <span className="chip absolute right-3 top-3 bg-brass/90 text-[#0a0a0a]">{afterLabel}</span>
        <div className="pointer-events-none absolute inset-y-0 w-px bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.35)]" style={{ left: `${pos * 100}%` }} />
        <button
          type="button"
          role="slider"
          aria-label="Compare before and after"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos * 100)}
          onKeyDown={onKey}
          className="absolute top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-black/60 text-white shadow-lg backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          style={{ left: `${pos * 100}%` }}
        >
          <svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 1 1 6l4 5M13 1l4 5-4 5" /></svg>
        </button>
      </div>
    </div>
  );
}
