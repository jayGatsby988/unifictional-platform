'use client';
/**
 * "How it works" — a pinned stage where the client's photo card rises,
 * flips over (elastic) to reveal the three step cards fanned behind it, and
 * the steps peel away one by one as you keep scrolling. Adapted from the
 * Awwwards "sticky flip cards" piece (scrub-driven enter/dismiss, tweened
 * flip). On phones and with reduced motion it is a plain vertical stack.
 */
import Image from 'next/image';
import { Box, Paintbrush, Upload, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cx } from './cx';
import { LpHeading } from './LpHeading';
import { ensureGsap } from './motion';
import { DEMO, SECTIONS, STEPS } from './content';

const ENTER_END = 100; // svh of scroll during which the cards rise into place
const FLIP_AT = 165; // svh at which the photo flips to reveal the steps
const DISMISS_START = 240;
const DISMISS_DURATION = 90;
const TAIL = 70;
const DISMISS_COUNT = STEPS.length - 1; // the last step stays on stage
const TOTAL_SVH = DISMISS_START + DISMISS_COUNT * DISMISS_DURATION + TAIL;

const FLIP_TILT = [-3, 5, -7]; // per back card, bottom → top
const DISMISS_TILT = [0, 34, -42];
const ICONS: LucideIcon[] = [Upload, Box, Paintbrush];
// white / black / gold — the site's three surfaces. The black card carries its
// own scope so its text and chips flip with it on the light body.
const TONES = [
  'border-border-strong bg-surface text-ink',
  'lp-dark border-border bg-bg text-ink',
  'border-brass bg-brass text-[#0a0a0a]',
];

const CARD =
  'lp-hw-card lp-card relative flex w-full flex-col justify-between rounded-2xl border p-6 sm:p-7 [order:var(--o)] min-h-[380px] md:absolute md:left-1/2 md:top-1/2 md:order-none md:aspect-[4/5] md:min-h-0 md:w-[min(400px,36vw)]';

export function HowItWorks() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0); // 0 = photo, 1..n = step

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap, ScrollTrigger } = ensureGsap();
    const mm = gsap.matchMedia();

    mm.add({ desktop: '(min-width: 768px)', reduce: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      const conditions = (ctx.conditions ?? {}) as { desktop?: boolean; reduce?: boolean };
      if (!conditions.desktop || conditions.reduce) return;

      const cards = gsap.utils.toArray<HTMLElement>('.lp-hw-card', el);
      const front = el.querySelector<HTMLElement>('.lp-hw-front');
      const backs = gsap.utils.toArray<HTMLElement>('.lp-hw-back', el); // DOM order: last step (bottom) … first step (top)
      if (!front || backs.length === 0) return;

      const n = backs.length;
      const p = (svh: number) => svh / TOTAL_SVH;
      const ranges = backs.map((_, i) => {
        const order = n - 1 - i; // top-most dismisses first
        return [p(DISMISS_START + order * DISMISS_DURATION), p(DISMISS_START + (order + 1) * DISMISS_DURATION)] as const;
      });

      gsap.set(cards, { xPercent: -50, yPercent: 50, rotationY: 0, rotation: 0, transformOrigin: '50% 50%' });
      gsap.set(backs, { rotationY: -180 });

      const ease = 'elastic.out(1, 0.6)';
      let flipped = false;
      const reveal = () => {
        gsap.to(front, { rotationY: 180, duration: 1, ease, overwrite: 'auto' });
        backs.forEach((c, i) => gsap.to(c, { rotationY: 0, rotation: FLIP_TILT[i % FLIP_TILT.length], duration: 1, ease, overwrite: 'auto' }));
      };
      const conceal = () => {
        gsap.to(front, { rotationY: 0, duration: 1, ease, overwrite: 'auto' });
        backs.forEach((c) => gsap.to(c, { rotationY: -180, rotation: 0, duration: 1, ease, overwrite: 'auto' }));
      };

      let lastActive = -1;
      ScrollTrigger.create({
        trigger: el,
        start: 'top top',
        end: () => `+=${Math.round(window.innerHeight * (TOTAL_SVH / 100))}`,
        pin: true,
        pinSpacing: true,
        scrub: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const pr = self.progress;
          const enter = gsap.utils.clamp(0, 1, gsap.utils.mapRange(0, p(ENTER_END), 0, 1, pr));
          gsap.set(cards, { yPercent: gsap.utils.mapRange(0, 1, 50, -50, enter) });

          if (pr > p(FLIP_AT) && !flipped) {
            reveal();
            flipped = true;
          } else if (pr <= p(FLIP_AT) && flipped) {
            conceal();
            flipped = false;
          }

          let dismissed = 0;
          backs.forEach((card, i) => {
            if (i === 0) return; // the bottom card (last step) never leaves
            const [s, e] = ranges[i];
            const d = gsap.utils.clamp(0, 1, gsap.utils.mapRange(s, e, 0, 1, pr));
            if (d >= 1) dismissed += 1;
            gsap.set(card, {
              yPercent: gsap.utils.mapRange(0, 1, -50, -260, d),
              ...(d > 0 ? { rotation: gsap.utils.mapRange(0, 1, FLIP_TILT[i % FLIP_TILT.length], DISMISS_TILT[i % DISMISS_TILT.length], d) } : {}),
            });
          });

          const next = flipped ? 1 + dismissed : 0;
          if (next !== lastActive) {
            lastActive = next;
            setActive(next);
          }
        },
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section id="how" ref={root} className="relative bg-bg md:h-[100svh] md:overflow-hidden">
      <div className="lp-container py-20 md:grid md:h-full md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-center md:gap-10 md:py-0">
        <div className="lp-hw-copy">
          <LpHeading size="sm" index={SECTIONS.how.index} eyebrow={SECTIONS.how.eyebrow} title={SECTIONS.how.title} intro={SECTIONS.how.intro} />

          <ol className="mt-8 hidden md:block" aria-label="Steps">
            {STEPS.map((s, i) => {
              const on = active === i + 1;
              return (
                <li
                  key={s.n}
                  className={cx('flex items-baseline gap-4 border-t border-border py-3 transition-colors duration-300', on ? 'text-ink' : 'text-dim')}
                >
                  <span className={cx('num font-mono text-[11px] tracking-[0.18em]', on ? 'text-brass' : 'text-dim')}>{s.n}</span>
                  <span className="font-display text-2xl">{s.title}</span>
                  <span className="ml-auto text-[11px] uppercase tracking-[0.14em] opacity-70">{s.detail}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-6 hidden text-[11px] uppercase tracking-[0.18em] text-dim md:block">Keep scrolling</p>
        </div>

        <div className="lp-stage relative mt-10 grid gap-4 md:mt-0 md:block md:h-full">
          <article
            className={cx(CARD, 'lp-hw-front lp-dark overflow-hidden border-border-strong bg-surface p-0 text-ink sm:p-0')}
            style={{ '--o': 0 } as CSSProperties}
            aria-label="Your client's photo"
          >
            <Image src={DEMO.before.src} alt={DEMO.before.alt} fill sizes="(min-width: 768px) 400px, 100vw" className="object-cover" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg/90 via-bg/50 to-transparent p-6 sm:p-7">
              <p className="eyebrow">Start here</p>
              <h3 className="font-display mt-2 text-3xl text-ink">The client&apos;s photo</h3>
              <p className="mt-2 text-[13.5px] text-muted">One photo from a phone is enough to start. This one becomes the twin on the right.</p>
            </div>
          </article>

          {[...STEPS].reverse().map((step, ri) => {
            const stepIndex = STEPS.length - 1 - ri;
            const Icon = ICONS[stepIndex];
            return (
              <article
                key={step.n}
                className={cx(CARD, 'lp-hw-back', TONES[stepIndex])}
                style={{ '--o': stepIndex + 1 } as CSSProperties}
                aria-label={`Step ${step.n}: ${step.title}`}
              >
                <div className="flex items-start justify-between">
                  <span className="font-display text-5xl leading-none">{step.n}</span>
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-current/30">
                    <Icon size={18} />
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-3xl leading-tight sm:text-4xl">{step.title}</h3>
                  <p className="mt-3 text-[14px] leading-relaxed opacity-90">{step.body}</p>
                </div>
                <p className="mt-6 text-[10.5px] uppercase tracking-[0.16em] opacity-70">{step.detail}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
