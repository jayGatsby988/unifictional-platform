import type { Metadata } from "next";

import { PageHeader } from "@/components/sections/page-header";
import { Container } from "@/components/ui/container";
import { ServicesGrid } from "@/components/sections/services-grid";
import { FinalCta } from "@/components/sections/final-cta";
import { BookCall, CtaButton } from "@/components/ui/button";
import { FloatingPathsBackground } from "@/components/ui/floating-paths";

export const metadata: Metadata = {
  title: "Contractor Marketing Services — Websites, SEO & Social",
  description:
    "Contractor marketing services under one roof: website design, SEO, Google Business Profile, social media marketing, short-form video, lead generation, booking, AI lead handling, and reporting.",
  keywords: [
    "contractor marketing services",
    "construction marketing agency",
    "digital marketing for construction companies",
    "contractor website design",
    "SEO for contractors",
    "social media marketing for contractors",
  ],
  alternates: { canonical: "/services" },
  openGraph: {
    title: "Contractor Marketing Services — Unifictional",
    description:
      "Website design, SEO, Google Business Profile, social media, video, lead generation, booking, AI lead handling, and reporting — one studio, one system.",
    url: "/services",
  },
};

export default function ServicesPage() {
  return (
    <>
      <PageHeader
        dark
        eyebrow="Services"
        title={
          <>
            The whole system, <em className="italic text-terracotta">under one roof.</em>
          </>
        }
        intro="A website is only the beginning. We build the visibility, content, and lead flow around it — so the pieces work together instead of fighting each other."
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

      {/* Animated paths behind the cards only — nothing above, nothing below. */}
      <section className="bg-bone">
        <FloatingPathsBackground strokeScale={1.6} className="overflow-hidden pb-24 pt-16 sm:pb-32">
          <Container className="relative z-10">
            <ServicesGrid />
          </Container>
        </FloatingPathsBackground>
      </section>

      <FinalCta />
    </>
  );
}
