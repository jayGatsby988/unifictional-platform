'use client';
/**
 * Display headline whose letters are pushed away from the cursor and ease
 * back (adapted from the Awwwards "MenuXL text displacement" piece: per-letter
 * spans, radius/force field, lerp loop). The loop only runs while letters are
 * displaced, the effect is skipped on touch devices and with reduced motion,
 * and the heading keeps a plain-text `aria-label`.
 */
import { useEffect, useRef } from 'react';
import { cx } from './cx';
import { hasFinePointer, useReducedMotion } from './motion';

export interface HeadlineLine {
  text: string;
  italic?: boolean;
}

interface Item {
  el: HTMLElement;
  cx: number;
  cy: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
}

const RADIUS = 170;
const MAX_PUSH = 56;
const LERP = 0.11;

export function DisplaceHeadline({ lines, className, id }: { lines: readonly HeadlineLine[]; className?: string; id?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = ref.current;
    if (!root || reduced || !hasFinePointer()) return;

    const items: Item[] = Array.from(root.querySelectorAll<HTMLElement>('.lp-letter')).map((el) => ({ el, cx: 0, cy: 0, x: 0, y: 0, tx: 0, ty: 0 }));
    if (items.length === 0) return;

    let measuredScrollY = -1;
    const measure = () => {
      for (const it of items) {
        const r = it.el.getBoundingClientRect();
        // subtract the current offset so we always store the resting centre
        it.cx = r.left + r.width / 2 - it.x;
        it.cy = r.top + r.height / 2 - it.y;
      }
      measuredScrollY = window.scrollY;
    };

    let raf = 0;
    let running = false;
    const tick = () => {
      let active = false;
      for (const it of items) {
        it.x += (it.tx - it.x) * LERP;
        it.y += (it.ty - it.y) * LERP;
        if (Math.abs(it.x) + Math.abs(it.y) > 0.08 || it.tx !== 0 || it.ty !== 0) active = true;
        it.el.style.transform = `translate3d(${it.x.toFixed(2)}px, ${it.y.toFixed(2)}px, 0)`;
      }
      if (active) {
        raf = requestAnimationFrame(tick);
      } else {
        running = false;
        for (const it of items) {
          it.x = 0;
          it.y = 0;
          it.el.style.transform = '';
        }
      }
    };
    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };

    const release = () => {
      for (const it of items) {
        it.tx = 0;
        it.ty = 0;
      }
      start();
    };

    const onMove = (e: PointerEvent) => {
      const box = root.getBoundingClientRect();
      if (box.bottom < -RADIUS || box.top > window.innerHeight + RADIUS) return;
      if (window.scrollY !== measuredScrollY) measure();
      let any = false;
      for (const it of items) {
        const dx = it.cx - e.clientX;
        const dy = it.cy - e.clientY;
        const d = Math.hypot(dx, dy);
        if (d < RADIUS && d > 0.001) {
          const f = 1 - d / RADIUS;
          const force = f * f * MAX_PUSH;
          it.tx = (dx / d) * force;
          it.ty = (dy / d) * force;
          any = true;
        } else {
          it.tx = 0;
          it.ty = 0;
        }
      }
      if (any || running) start();
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => undefined);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', release);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', release);
      for (const it of items) it.el.style.transform = '';
    };
  }, [reduced, lines]);

  return (
    <h1 ref={ref} id={id} className={className} aria-label={lines.map((l) => l.text).join(' ')}>
      {lines.map((line, li) => {
        const words = line.text.split(' ');
        return (
          <span key={li} aria-hidden className={cx('block', line.italic && 'italic text-brass')}>
            {words.map((word, wi) => (
              <span key={wi}>
                <span className="lp-word">
                  {Array.from(word).map((ch, ci) => (
                    <span key={ci} className="lp-letter">
                      {ch}
                    </span>
                  ))}
                </span>
                {wi < words.length - 1 ? ' ' : null}
              </span>
            ))}
          </span>
        );
      })}
    </h1>
  );
}
