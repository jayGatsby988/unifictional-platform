'use client';
import Link from 'next/link';
import { ArrowUpRight, Check } from 'lucide-react';
import { Reveal } from './Reveal';
import { cx } from './cx';
import { TIERS } from './content';

function Cta({ href, label, primary }: { href: string; label: string; primary: boolean }) {
  const className = cx('btn mt-7 w-full', primary && 'btn-primary');
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {label} <ArrowUpRight size={14} />
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {label} <ArrowUpRight size={14} />
    </a>
  );
}

export function Pricing() {
  return (
    <section id="pricing" className="lp-section border-t border-border">
      <div className="lp-container">
        <Reveal className="max-w-2xl">
          <span className="chip chip-brass">Founding pricing</span>
          <h2 className="font-display mt-5 text-[clamp(2.2rem,4.6vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-ink">
            Simple plans.
            <br />
            Real output on every one.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-muted">
            Prices in USD, billed monthly. Every plan includes the full material catalog, live line-item estimates and share links.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {TIERS.map((tier, i) => (
            <Reveal key={tier.id} delay={i * 70} className="h-full">
              <article
                className={cx(
                  'relative flex h-full flex-col rounded-[var(--radius)] border p-6 sm:p-7',
                  tier.highlight ? 'border-brass bg-[linear-gradient(180deg,rgba(201,150,46,0.10),rgba(201,150,46,0.02))]' : 'border-border bg-surface',
                )}
                aria-label={`${tier.name} plan`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-3xl text-ink">{tier.name}</h3>
                  {tier.highlight ? <span className="chip chip-brass">Founding</span> : null}
                </div>
                <p className="mt-2 text-[13px] text-muted">{tier.blurb}</p>
                <p className="mt-6 flex items-baseline gap-1">
                  <span className="num font-display text-5xl text-ink">{tier.price}</span>
                  {tier.period ? <span className="text-sm text-muted">{tier.period}</span> : null}
                </p>
                <ul className="mt-6 space-y-2.5 text-[13.5px] text-muted">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check size={15} className="mt-0.5 shrink-0 text-brass" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <Cta href={tier.href} label={tier.cta} primary={tier.highlight} />
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <p className="mt-6 text-[12px] text-dim">Estimates on every plan are planning-grade (±15–20%) and are not bids.</p>
      </div>
    </section>
  );
}
