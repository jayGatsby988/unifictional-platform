'use client';
/**
 * Material swatches trail the cursor across the wrapped content. Adapted from
 * the Awwwards "image trail" mouse effect (distance threshold → next image,
 * lerped spawn point, gsap fade/scale out). Pointer positions are measured
 * relative to this container, the rAF loop only runs while the pointer is
 * inside, and the effect is skipped on touch devices and with reduced motion.
 */
import Image from 'next/image';
import { useEffect, useRef, type ReactNode } from 'react';
import type { MaterialDef } from '@/lib/materials/catalog';
import { cx } from './cx';
import { ensureGsap, hasFinePointer, useReducedMotion } from './motion';

const THRESHOLD = 90;

export function ImageTrail({ materials, children, className }: { materials: MaterialDef[]; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = ref.current;
    if (!root || reduced || !hasFinePointer()) return;
    const imgs = Array.from(root.querySelectorAll<HTMLElement>('.lp-trail-img'));
    if (imgs.length === 0) return;
    const { gsap } = ensureGsap();

    const mouse = { x: 0, y: 0 };
    const last = { x: 0, y: 0 };
    const cache = { x: 0, y: 0 };
    let idx = 0;
    let z = 1;
    let raf = 0;
    let inside = false;
    let idleTimer = 0;

    const show = () => {
      const el = imgs[idx];
      idx = (idx + 1) % imgs.length;
      z += 1;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      gsap.killTweensOf(el);
      gsap
        .timeline()
        .set(el, { opacity: 1, scale: 1, zIndex: z, x: cache.x - w / 2, y: cache.y - h / 2, rotation: gsap.utils.random(-9, 9) }, 0)
        .to(el, { duration: 0.9, ease: 'expo.out', x: mouse.x - w / 2, y: mouse.y - h / 2 }, 0)
        .to(el, { duration: 1, ease: 'power1.out', opacity: 0 }, 0.4)
        .to(el, { duration: 1, ease: 'power4.out', scale: 0.3 }, 0.4);
    };

    const loop = () => {
      cache.x += (mouse.x - cache.x) * 0.1;
      cache.y += (mouse.y - cache.y) * 0.1;
      if (inside && Math.hypot(mouse.x - last.x, mouse.y - last.y) > THRESHOLD) {
        show();
        last.x = mouse.x;
        last.y = mouse.y;
      }
      raf = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const startLoop = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      if (!inside) {
        inside = true;
        cache.x = mouse.x;
        cache.y = mouse.y;
        last.x = mouse.x;
        last.y = mouse.y;
      }
      window.clearTimeout(idleTimer);
      startLoop();
    };
    const onLeave = () => {
      inside = false;
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(stopLoop, 1600);
    };

    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    return () => {
      stopLoop();
      window.clearTimeout(idleTimer);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      imgs.forEach((el) => {
        gsap.killTweensOf(el);
        gsap.set(el, { clearProps: 'all' });
      });
    };
  }, [reduced, materials]);

  return (
    <div ref={ref} className={cx('relative', className)}>
      {children}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {materials.map((m) => (
          <div
            key={m.id}
            className="lp-trail-img absolute left-0 top-0 h-[112px] w-[112px] overflow-hidden rounded-xl border border-border opacity-0 shadow-lg sm:h-[140px] sm:w-[140px]"
          >
            <Image src={m.swatch} alt="" fill sizes="140px" className="object-cover" />
          </div>
        ))}
      </div>
    </div>
  );
}
