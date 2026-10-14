import type { Metadata } from "next";

import { ScrubHero } from "@/components/sections/scrub-hero";
import { Manifesto } from "@/components/sections/manifesto";
import { Sectors } from "@/components/sections/sectors";
import { StoryFrames } from "@/components/sections/story-frames";
import { ServicesIndex } from "@/components/sections/services-index";
import { WorkList } from "@/components/sections/work-list";
import { ProcessList } from "@/components/sections/process-list";
import { FinalCta } from "@/components/sections/final-cta";

import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/ui/reveal";
import { BookCall, CtaButton } from "@/components/ui/button";
import { FloatingPathsBackground } from "@/components/ui/floating-paths";

export const metadata: Metadata = {
  // Uses the layout's default title (the one term-loaded enough to be the
  // site's front door) but gets its own description and canonical.
  description:
    "Unifictional is a contractor marketing agency building custom websites, local SEO, Google Business Profile, social media, and lead systems for contractors, remodelers, and custom home builders across the US.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

export default function Home() {
  return (
    <>
      {/* The opening act — scroll-scrubbed drone footage. */}
      <ScrubHero />

      {/* Editorial promise. */}
      <Manifesto />

      {/* Who we build for. */}
      <Sectors />

      {/* Services index. */}
      <section className="bg-bone py-24 sm:py-32">
        <Container>
          <Reveal>
            <SectionHeading
              eyebrow="What we do"
              title={
                <>
                  Everything your business needs to look{" "}
                  <em className="italic text-terracotta">bigger online.</em>
                </>
              }
              intro="One studio handling the website, the visibility, the content, and the lead flow — so the pieces work together instead of fighting each other."
            />
          </Reveal>
          <ServicesIndex />
          <Reveal className="mt-12">
            <CtaButton href="/services" variant="outline" icon="up-right">
              All services
            </CtaButton>
          </Reveal>
        </Container>
      </section>

      {/* Before / after, from the real footage. */}
      <StoryFrames />

      {/* Selected work. */}
      <section className="border-t border-line bg-bone">
        <FloatingPathsBackground position={1} className="overflow-hidden py-24 sm:py-32">
          <Container className="relative z-10">
            <Reveal>
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <SectionHeading
                  eyebrow="Selected work"
                  title="Sites that make a serious buyer feel safe."
                />
                <CtaButton href="/work" variant="link" icon="up-right" className="shrink-0 self-start md:self-auto">
                  View all work
                </CtaButton>
              </div>
            </Reveal>
            <WorkList limit={3} />
            {/* Mid-page conversion point — right after the proof. */}
            <Reveal className="mt-12">
              <BookCall variant="solid" size="lg" />
            </Reveal>
          </Container>
        </FloatingPathsBackground>
      </section>

      {/* Process. */}
      <section className="border-t border-line bg-ink py-24 sm:py-32">
        <Container>
          <Reveal>
            <SectionHeading
              onDark
              eyebrow="How we work"
              title="A calm path from first call to fully booked."
              intro="Four steps that turn your business into a premium online brand — and keep getting better after launch."
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
