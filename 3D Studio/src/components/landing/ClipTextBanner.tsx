'use client';
/**
 * Giant serif type used as an SVG clip-path over the demo render; the two
 * lines slide in opposite directions as you scroll and the image parallaxes
 * underneath. Adapted from the Awwwards "TextClipScroll" piece (SVG
 * <clipPath> text + scrubbed transforms), trimmed to one poster.
 */
import Image from 'next/image';
import { useEffect, useId, useRef } from 'react';
import { ensureGsap, useReducedMotion } from './motion';
import { DEMO } from './content';

export function ClipTextBanner() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const clipId = `lp-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    const { gsap } = ensureGsap();
    const ctx = gsap.context(() => {
      const l1 = root.querySelector('.lp-clip-l1');
      const l2 = root.querySelector('.lp-clip-l2');
      const inner = root.querySelector('.lp-clip-inner');
      if (!l1 || !l2 || !inner) return;
      const w = () => root.clientWidth;
      gsap
        .timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: root, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true },
        })
        .fromTo(l1, { x: () => w() * 0.16 }, { x: () => -w() * 0.16 }, 0)
        .fromTo(l2, { x: () => -w() * 0.16 }, { x: () => w() * 0.16 }, 0)
        .fromTo(inner, { yPercent: -7, scale: 1.18 }, { yPercent: 7, scale: 1.18 }, 0);
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section
      ref={ref}
      aria-label="From upload to explorable 3D twin in about sixty seconds"
      className="lp-dark relative h-[64vh] max-h-[820px] min-h-[380px] overflow-hidden border-y border-border bg-bg text-ink"
    >
      <svg className="lp-clip-svg" aria-hidden focusable="false">
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <text className="lp-clip-text lp-clip-l1" x="50%" y="36%" textAnchor="middle" dominantBaseline="central">
              SIXTY
            </text>
            <text className="lp-clip-text lp-clip-l2" x="50%" y="70%" textAnchor="middle" dominantBaseline="central">
              SECONDS.
            </text>
          </clipPath>
        </defs>
      </svg>

      <div className="absolute inset-0" style={{ clipPath: `url(#${clipId})`, WebkitClipPath: `url(#${clipId})` }}>
        <div className="lp-clip-inner absolute inset-0">
          <Image src={DEMO.after.src} alt="" fill sizes="100vw" className="object-cover" />
        </div>
      </div>

      <div className="lp-container pointer-events-none absolute inset-x-0 bottom-6 flex flex-col gap-1 sm:bottom-8 sm:flex-row sm:items-end sm:justify-between">
        <p className="eyebrow">From upload to explorable 3D twin</p>
        <p className="max-w-md text-[12.5px] text-muted sm:text-right">The render behind these letters is the demo kitchen above — same camera, new finishes.</p>
      </div>
    </section>
  );
}
