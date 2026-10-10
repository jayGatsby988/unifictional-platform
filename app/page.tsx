import type { Metadata } from "next";

import { PlatformHero } from "@/components/sections/platform-hero";
import { Manifesto } from "@/components/sections/manifesto";
import { Sectors } from "@/components/sections/sectors";
import { PlatformIndex } from "@/components/sections/platform-index";
import { QuoteFlow } from "@/components/sections/quote-flow";
import { PortalPreview } from "@/components/sections/portal-preview";
import { WorkStrip } from "@/components/sections/work-strip";
import { ProcessList } from "@/components/sections/process-list";
import { FinalCta } from "@/components/sections/final-cta";

import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/ui/reveal";
import { BookCall, CtaButton } from "@/components/ui/button";

export const metadata: Metadata = {
  // Uses the layout's default title (the one term-loaded enough to be the
  // site's front door) but gets its own description and canonical.
  description:
    "Unifictional is the growth platform for contractors: a premium website with a 3D instant-quote tool built in, local SEO, Google Business Profile and social run by the studio, and one client portal that shows every lead, ranking, post, and quote.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

export default function Home() {
  return (
    <>
      {/* The opening act — product-led, with the portal in frame. */}
      <PlatformHero />

      {/* Editorial statement: from studio to platform. */}
      <Manifesto />

      {/* Who we build for. */}
      <Sectors />

      {/* The four parts of the platform. */}
      <section id="platform" className="scroll-mt-16 bg-bone py-24 sm:py-32">
        <Container>
          <Reveal>
            <SectionHeading
              eyebrow="What you get"
              title={
                <>
                  One system, from first click to{" "}
                  <em className="italic text-terracotta">signed job.</em>
                </>
              }
              intro="The website, the quote tool, the portal, and the studio that runs the search and social around them — built to work as one thing instead of five vendors."
            />
          </Reveal>
          <PlatformIndex />
          <Reveal className="mt-12">
            <CtaButton href="/services" variant="outline" icon="up-right">
              Everything the studio does
            </CtaButton>
          </Reveal>
        </Container>
      </section>

      {/* How the quote tool works. */}
      <QuoteFlow />

      {/* The portal + preview button. */}
      <PortalPreview />

      {/* Selected work. */}
      {/* No animated backdrop here on purpose: the wide horizontal rail and the
          floating-paths SVG fought over repaints in Chrome (desktop went blank). */}
      <section className="overflow-hidden border-t border-line bg-bone py-24 sm:py-32">
          <Container>
            <Reveal>
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <SectionHeading
                  eyebrow="Selected work"
                  title="Built for the trades. Live on real sites."
                  intro="Eight sites we designed and built — every one of them running right now. Open any of them."
                />
                <CtaButton href="/work" variant="link" icon="up-right" className="shrink-0">
                  View all work
                </CtaButton>
              </div>
            </Reveal>
            <WorkStrip />
            {/* Mid-page conversion point — right after the proof. */}
            <Reveal className="mt-12">
              <BookCall variant="solid" size="lg" />
            </Reveal>
          </Container>
      </section>

      {/* Process. */}
      <section className="border-t border-line bg-ink py-24 sm:py-32">
        <Container>
          <Reveal>
            <SectionHeading
              onDark
              eyebrow="How we work"
              title="A calm path from first call to fully booked."
              intro="Four steps that put the platform under your business — and keep it improving after launch."
            />
          </Reveal>
          <ProcessList />
          <Reveal className="mt-12">
            <CtaButton href="/process" variant="bone" icon="up-right">
              The full process
            </CtaButton>
          </Reveal>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
