'use client';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { LpHeading } from './LpHeading';
import { Reveal } from './Reveal';
import { cx } from './cx';
import { FAQ_ITEMS, SECTIONS } from './content';

export function FAQ() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="lp-section border-t border-border">
      <div className="lp-container grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <Reveal>
          <LpHeading index={SECTIONS.faq.index} eyebrow={SECTIONS.faq.eyebrow} title={SECTIONS.faq.title} intro={SECTIONS.faq.intro} />
        </Reveal>

        <div>
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i;
            const id = `lp-faq-${i}`;
            return (
              <div key={item.q} className="border-b border-border first:border-t">
                <h3>
                  <button
                    type="button"
                    id={`${id}-button`}
                    aria-expanded={isOpen}
                    aria-controls={`${id}-panel`}
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    className={cx(
                      'flex w-full items-center justify-between gap-4 py-5 text-left text-[15px] transition-colors hover:text-brass focus:outline-none focus-visible:text-brass sm:text-base',
                      isOpen ? 'text-ink' : 'text-ink/90',
                    )}
                  >
                    <span>{item.q}</span>
                    <Plus size={18} className={cx('shrink-0 transition-transform duration-300', isOpen && 'rotate-45 text-brass')} />
                  </button>
                </h3>
                <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-button`} className="lp-acc-body" data-open={isOpen}>
                  <div>
                    <p className="max-w-2xl pb-6 text-[14px] leading-relaxed text-muted">{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
