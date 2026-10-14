'use client';
/** The closing band above the footer, modelled on unifictional.com's final-cta. */
import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { LpHeading } from './LpHeading';
import { Reveal } from './Reveal';
import { FINAL_CTA, opensStudio } from './content';

export function FinalCta() {
  return (
    <section id="start" className="border-t border-border bg-surface">
      <div className="lp-container lp-section">
        <Reveal className="flex flex-col items-start gap-7">
          <LpHeading
            size="lg"
            eyebrow={FINAL_CTA.eyebrow}
            title={
              <>
                {FINAL_CTA.title.lead} <em className="text-brass">{FINAL_CTA.title.em}</em> {FINAL_CTA.title.tail}
              </>
            }
            intro={FINAL_CTA.body}
          />
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
            <Link href={FINAL_CTA.primary.href} {...opensStudio(FINAL_CTA.primary.href)} className="btn btn-primary btn-lg">
              {FINAL_CTA.primary.label} <ArrowRight size={16} />
            </Link>
            <a href={FINAL_CTA.secondary.href} className="btn lp-btn-outline btn-lg">
              {FINAL_CTA.secondary.label} <ArrowRight size={16} />
            </a>
            <a href={FINAL_CTA.link.href} className="inline-flex items-center gap-2 text-[15px] font-medium text-ink transition-colors hover:text-brass sm:ml-2">
              <span className="lp-link">{FINAL_CTA.link.label}</span> <ArrowUpRight size={16} />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
