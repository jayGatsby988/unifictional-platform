'use client';
/** Fade-up once the element scrolls into view (CSS transition, IntersectionObserver). */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from './cx';

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={cx('lp-reveal', className)} data-in={inView} style={{ '--lp-delay': `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  );
}
