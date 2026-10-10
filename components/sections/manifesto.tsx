import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { CtaButton } from "@/components/ui/button";
import ThreeDMarquee from "@/components/ui/3d-marquee";
import { marqueeItems, showcaseSites } from "@/lib/showcase";

/** The first words after the cinematic open — editorial, human, confident. */
export function Manifesto() {
  return (
    <section className="overflow-hidden bg-bone py-24 sm:py-32">
      <Container>
        <div className="grid grid-cols-12 items-center gap-y-10 lg:gap-x-12">
          {/* Left — the statement. */}
          <div className="col-span-12 lg:col-span-7">
            <Reveal>
              <Eyebrow index="00">From studio to platform</Eyebrow>
            </Reveal>
            <Reveal>
              <p className="mt-6 font-display text-3xl font-medium leading-[1.18] tracking-[-0.01em] text-ink sm:text-4xl sm:leading-[1.14] md:text-[2.9rem]">
                Contractors rarely lose the job to a better builder. They lose it to whoever
                answered first{" "}
                <em className="italic text-terracotta">with a number.</em>
              </p>
            </Reveal>
            <Reveal delay={80}>
              <p className="mt-8 max-w-prose text-lg leading-relaxed text-ink-soft">
                Unifictional started as the studio that made builders look like the obvious
                choice online. Now the website does more than look good: a homeowner sizes the
                project in 3D, gets a real price range, and leaves their details — and you see
                every quote, lead, ranking, and post in one portal. The studio still runs the
                search, content, and lead systems around it.
              </p>
            </Reveal>
            <Reveal delay={140}>
              <div className="mt-8">
                <CtaButton href="/about" variant="link" icon="up-right">
                  More about the studio
                </CtaButton>
              </div>
            </Reveal>
          </div>

          {/* Right — a 3D marquee of websites we've built, feathered so it
              dissolves into the page rather than sitting in a hard box. */}
          <div className="col-span-12 hidden lg:col-span-5 lg:block">
            <Reveal>
              <ThreeDMarquee items={marqueeItems} />
            </Reveal>
          </div>

          {/* Mobile — the marquee is desktop-only, so phones get a swipeable
              proof strip of real client sites instead of no work at all. */}
          <div className="col-span-12 lg:hidden">
            <Reveal>
              <div className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none]">
                {showcaseSites.slice(0, 4).map((s) => (
                  <figure key={s.name} className="w-[240px] shrink-0 snap-start">
                    <div className="overflow-hidden rounded-lg border border-line bg-sand shadow-[0_18px_36px_-20px_rgba(26,23,20,0.45)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.image}
                        alt={`${s.name} — website by Unifictional`}
                        loading="lazy"
                        draggable={false}
                        className="aspect-[16/10] w-full select-none object-cover object-top"
                      />
                    </div>
                    <figcaption className="mt-2.5">
                      <span className="block text-sm font-medium text-ink">{s.name}</span>
                      <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-label text-ink-muted">
                        {s.meta}
                      </span>
                    </figcaption>
                  </figure>
                ))}
                <Link
                  href="/work"
                  className="flex w-[160px] shrink-0 snap-start items-center justify-center gap-1.5 rounded-lg border border-line bg-paper text-sm font-medium text-ink transition-colors hover:text-terracotta"
                >
                  See all work
                  <ArrowUpRight className="h-4 w-4 text-terracotta" />
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </Container>
    </section>
  );
}
