'use client';
/**
 * Tweens a number in place (no React re-render per frame). Renders the final
 * value on the server so there is no layout shift; honours reduced motion.
 */
import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import { fmtUSD } from '@/lib/units';
import { useReducedMotion } from './motion';

export interface AnimatedNumberProps {
  value: number;
  /** Value to count up from on first mount (defaults to `value`, i.e. no intro tween). */
  from?: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}

const defaultFormat = (n: number) => fmtUSD(n);

export function AnimatedNumber({ value, from, format = defaultFormat, duration = 0.9, className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = shown.current ?? from ?? value;
    if (reduced || start === value) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    const obj = { v: start };
    const tween = gsap.to(obj, {
      v: value,
      duration,
      ease: 'power3.out',
      onUpdate: () => {
        el.textContent = format(obj.v);
      },
      onComplete: () => {
        shown.current = value;
      },
    });
    return () => {
      tween.kill();
      shown.current = obj.v;
    };
  }, [value, from, format, duration, reduced]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
