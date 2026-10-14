'use client';
import { ClipboardCheck, FileText, MapPin, Share2, Smartphone, Zap, type LucideIcon } from 'lucide-react';
import { LpHeading } from './LpHeading';
import { Reveal } from './Reveal';
import { SECTIONS, VALUES } from './content';

const ICONS: Record<(typeof VALUES)[number]['icon'], LucideIcon> = {
  zap: Zap,
  clipboard: ClipboardCheck,
  share: Share2,
  map: MapPin,
  file: FileText,
  phone: Smartphone,
};

export function ForContractors() {
  return (
    <section id="contractors" className="lp-section border-t border-border">
      <div className="lp-container">
        <Reveal>
          <LpHeading index={SECTIONS.contractors.index} eyebrow={SECTIONS.contractors.eyebrow} title={SECTIONS.contractors.title} intro={SECTIONS.contractors.intro} />
        </Reveal>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {VALUES.map((v, i) => {
            const Icon = ICONS[v.icon];
            return (
              <li key={v.title}>
                <Reveal delay={i * 60} className="h-full">
                  <div className="panel h-full p-6">
                    <span className="grid h-10 w-10 place-items-center rounded-full border border-border-strong text-brass">
                      <Icon size={17} />
                    </span>
                    <h3 className="font-display mt-4 text-2xl text-ink">{v.title}</h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{v.body}</p>
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
