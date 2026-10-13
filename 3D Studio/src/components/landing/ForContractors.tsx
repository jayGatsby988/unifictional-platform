'use client';
import { ClipboardCheck, FileText, MapPin, Share2, Smartphone, Zap, type LucideIcon } from 'lucide-react';
import { Reveal } from './Reveal';
import { VALUES } from './content';

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
        <Reveal className="max-w-2xl">
          <p className="eyebrow">For contractors, remodelers, designers, DADU/ADU builders</p>
          <h2 className="font-display mt-4 text-[clamp(2.2rem,4.6vw,3.9rem)] leading-[1.02] tracking-[-0.015em] text-ink">
            Built for the people
            <br />
            who actually build.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-muted">
            MANHATTAN is a scoping and selling tool. It is not trying to replace your drawings or your subs — it gets a client to “yes” with a picture of
            their own room and a number they can plan around.
          </p>
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
