'use client';
/**
 * Drag-to-compare slider between the client's photo and the 3D Studio's render.
 * On first view it plays a WebGL ripple reveal (photo → render), then the
 * divider sweeps in and the visitor can drag, or use the keyboard.
 *
 * `t` = position of the divider (1 = only the photo, 0 = only the render).
 */
import Image from 'next/image';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { ChevronsLeftRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from './cx';
import { prefersReducedMotion } from './motion';

const RippleReveal = dynamic(() => import('./RippleReveal'), { ssr: false });

export interface BeforeAfterImage {
  src: string;
  alt: string;
}

export interface BeforeAfterProps {
  before: BeforeAfterImage;
  after: BeforeAfterImage;
  /** Called with the divider position (0..1) whenever it moves. */
  onChange?: (t: number) => void;
  /** Play the WebGL ripple intro when possible (default true). */
  ripple?: boolean;
  sizes?: string;
  className?: string;
  /** Overlays (badges) rendered above the images and the ripple canvas. */
  children?: ReactNode;
}

type Phase = 'pending' | 'ripple' | 'fade' | 'slider';

function canRunRipple(): boolean {
  if (window.innerWidth < 640) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function BeforeAfter({
  before,
  after,
  onChange,
  ripple = true,
  sizes = '(min-width: 1024px) 600px, 100vw',
  className,
  children,
}: BeforeAfterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [t, setTState] = useState(1);
  const [phase, setPhase] = useState<Phase>('pending');
  const [dragging, setDragging] = useState(false);
  const tRef = useRef(1);
  const draggingRef = useRef(false);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const setT = useCallback((v: number) => {
    const c = Math.min(1, Math.max(0, v));
    tRef.current = c;
    setTState(c);
    onChangeRef.current?.(c);
  }, []);

  const sweep = useCallback(
    (target: number, duration: number, delay = 0) => {
      tweenRef.current?.kill();
      const obj = { v: tRef.current };
      tweenRef.current = gsap.to(obj, { v: target, duration, delay, ease: 'power3.inOut', onUpdate: () => setT(obj.v) });
    },
    [setT],
  );

  useEffect(
    () => () => {
      tweenRef.current?.kill();
    },
    [],
  );

  // Intro once the block is in view: WebGL ripple → sweep, a plain sweep, or instant with reduced motion.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (prefersReducedMotion()) {
          setT(0.5);
          setPhase('slider');
          return;
        }
        if (ripple && canRunRipple()) {
          setPhase('ripple');
          return;
        }
        setPhase('slider');
        sweep(0.5, 1.4, 0.2);
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ripple, setT, sweep]);

  const onRippleComplete = useCallback(() => {
    setT(0);
    setPhase('fade');
    sweep(0.5, 1.3, 0.35);
  }, [setT, sweep]);

  const onRippleError = useCallback(() => {
    setPhase('slider');
    sweep(0.5, 1.2);
  }, [sweep]);

  useEffect(() => {
    if (phase !== 'fade') return;
    const id = window.setTimeout(() => setPhase('slider'), 600);
    return () => window.clearTimeout(id);
  }, [phase]);

  const fromClientX = (clientX: number) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setT((clientX - r.left) / r.width);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (phase === 'ripple') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    tweenRef.current?.kill();
    draggingRef.current = true;
    setDragging(true);
    fromClientX(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    fromClientX(e.clientX);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = tRef.current - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = tRef.current + step;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    tweenRef.current?.kill();
    setT(next);
  };

  const pct = t * 100;
  const redesigned = Math.round((1 - t) * 100);
  const showCanvas = phase === 'ripple' || phase === 'fade';

  return (
    <div
      ref={rootRef}
      className={cx('lp-ba relative overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-[var(--shadow-lg)]', className)}
      style={{ cursor: phase === 'ripple' ? 'default' : dragging ? 'grabbing' : 'ew-resize' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="relative aspect-square w-full">
        <Image src={before.src} alt={before.alt} fill sizes={sizes} preload className="object-cover" draggable={false} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pct}%)` }}>
          <Image src={after.src} alt={after.alt} fill sizes={sizes} className="object-cover" draggable={false} />
        </div>

        {/* divider + handle */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-white/90 mix-blend-difference" style={{ left: `${pct}%` }} />
        <button
          type="button"
          role="slider"
          aria-label="Compare the client's photo with the 3D Studio render"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={redesigned}
          aria-valuetext={`${redesigned}% of the frame shows the render`}
          onKeyDown={onKeyDown}
          className="absolute top-1/2 z-10 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-bg/70 text-ink shadow-lg backdrop-blur transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          style={{ left: `${pct}%`, transform: `translate(-50%, -50%) scale(${dragging ? 1.08 : 1})` }}
        >
          <ChevronsLeftRight size={18} />
        </button>

        {/* corner labels */}
        <span
          className="chip pointer-events-none absolute bottom-3 left-3 bg-bg/70 backdrop-blur transition-opacity duration-300"
          style={{ opacity: t > 0.12 ? 1 : 0 }}
        >
          Before · client photo
        </span>
        <span
          className="chip chip-brass pointer-events-none absolute bottom-3 right-3 backdrop-blur transition-opacity duration-300"
          style={{ opacity: t < 0.88 ? 1 : 0 }}
        >
          After · 3D Studio render
        </span>

        {showCanvas ? (
          <RippleReveal
            before={before.src}
            after={after.src}
            play={phase === 'ripple'}
            fadeOut={phase === 'fade'}
            onComplete={onRippleComplete}
            onError={onRippleError}
            className="z-20"
          />
        ) : null}

        {children ? <div className="pointer-events-none absolute inset-0 z-30">{children}</div> : null}
      </div>
    </div>
  );
}
