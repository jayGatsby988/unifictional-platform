import type { Metadata } from "next";

import { PageHeader } from "@/components/sections/page-header";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { BookCall, CtaButton } from "@/components/ui/button";
import { FinalCta } from "@/components/sections/final-cta";
import { principles } from "@/lib/site";
import { ClientPortalSection } from "@/components/sections/client-portal";

export const metadata: Metadata = {
  title: "Studio",
  description:
    "Unifictional is a marketing studio that builds premium websites and complete systems for contractors and remodelers — one team handling the website, the visibility, and the lead flow.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <PageHeader
        dark
        eyebrow="The studio"
        title={
          <>
            We make local builders the{" "}
            <em className="italic text-terracotta">obvious choice.</em>
          </>
        }
        intro="You do premium work in person. We make sure your presence online says so — clearly, instantly, and to the right people."
      >
        <BookCall variant="bone" size="lg" />
        <CtaButton
          href="/work"
          variant="link"
          size="lg"
          icon="up-right"
          className="text-bone/80 hover:text-bone"
        >
          See the work
        </CtaButton>
      </PageHeader>

      {/* Story */}
      <section className="bg-bone py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="min-w-0 lg:col-span-4">
              <Reveal>
                <Eyebrow tone="accent">Why we exist</Eyebrow>
                <h2 className="mt-6 font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
                  Great work shouldn&apos;t lose to a better-looking website.
                </h2>
              </Reveal>
            </div>
            <div className="min-w-0 lg:col-span-8">
              <Reveal delay={80}>
                <div className="space-y-6 text-lg leading-relaxed text-ink-soft">
                  <p>
                    Most contractors and remodelers are excellent at the work and quietly
                    invisible online. So the bigger, better jobs go to whoever{" "}
                    <span className="text-ink">looks</span> the most credible the moment a
                    customer is deciding who to trust with their home.
                  </p>
                  <p>
                    Unifictional exists to close that gap. We build the premium website and the
                    full system around it — search visibility, content, lead capture, booking,
                    and follow-up — so your reputation online finally matches the quality of
                    your work in person.
                  </p>
                  <p>
                    One studio. One system. Built to earn the click, the call, and the booked
                    job.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </section>

      {/* Full-bleed still from the footage */}
      <Reveal>
        <figure className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/frames/unifictional-v3/frame-240.webp"
            alt="A finished custom home at golden hour."
            className="h-[44vh] w-full object-cover sm:h-[60vh]"
            loading="lazy"
          />
          <figcaption className="absolute bottom-4 left-0 w-full">
            <Container>
              <span className="font-mono text-[11px] uppercase tracking-label text-bonefixed/80">
                The finished build — where every project should end up.
              </span>
            </Container>
          </figcaption>
        </figure>
      </Reveal>

      {/* Client portal (formerly its own /portal page) */}
      <ClientPortalSection />

      {/* Principles */}
      <section className="bg-bone py-20 sm:py-24">
        <Container>
          <Reveal>
            <Eyebrow>How we work</Eyebrow>
          </Reveal>
          <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-2">
            {principles.map((p) => (
              <Reveal key={p.index}>
                <div className="h-full bg-bone p-8">
                  <span className="font-display text-5xl font-medium text-terracotta/90">
                    {p.index}
                  </span>
                  <h3 className="mt-4 font-display text-2xl font-medium text-ink">{p.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-ink-soft">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Why no pricing */}
      <section className="border-y border-line bg-sand/60 py-20 sm:py-28">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Why there&apos;s no pricing here</Eyebrow>
            <p className="mt-6 font-display text-3xl font-medium leading-[1.18] text-ink sm:text-4xl">
              Every business is different. We&apos;d rather learn what you actually need and
              recommend the right system — instead of boxing you into a package you&apos;ll
              outgrow or overpay for.
            </p>
            <p className="mt-6 max-w-prose text-base leading-relaxed text-ink-soft">
              Your call is free, specific, and pressure-free. You leave with a clear plan either
              way.
            </p>
            <div className="mt-8">
              <BookCall variant="solid" size="lg" />
            </div>
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
