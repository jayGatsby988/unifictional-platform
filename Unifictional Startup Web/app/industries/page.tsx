import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { PageHeader } from "@/components/sections/page-header";
import { Container } from "@/components/ui/container";
import { FinalCta } from "@/components/sections/final-cta";
import { BookCall, CtaButton } from "@/components/ui/button";
import { industries } from "@/lib/industries";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Industries We Market",
  description:
    "Marketing built for the way each trade actually sells — roofing, remodeling, custom homes, general contracting, kitchen and bath, landscaping, concrete, and pools.",
  alternates: { canonical: "/industries" },
  openGraph: {
    title: "Industries We Market — Unifictional",
    description:
      "Marketing built for the way each trade actually sells — roofing, remodeling, custom homes, general contracting, kitchen and bath, landscaping, concrete, and pools.",
    url: "/industries",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": `${siteConfig.url}/industries#page`,
  url: `${siteConfig.url}/industries`,
  name: "Industries We Market",
  isPartOf: { "@id": `${siteConfig.url}/#website` },
  publisher: { "@id": `${siteConfig.url}/#org` },
  mainEntity: {
    "@type": "ItemList",
    itemListElement: industries.map((ind, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${siteConfig.url}/industries/${ind.slug}`,
      name: ind.title,
    })),
  },
};

export default function IndustriesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <PageHeader
        dark
        eyebrow="Industries"
        title={
          <>
            Every trade sells <em className="italic text-terracotta">differently.</em>
          </>
        }
        intro="A roofer wins on speed. A custom builder wins on credibility across eighteen months. A remodeler wins on photographs. The same marketing template can't serve all three — so we don't use one."
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

      <section className="bg-bone py-16 sm:py-20">
        <Container>
          <div className="border-t border-line">
            {industries.map((ind) => (
              <Link
                key={ind.slug}
                href={`/industries/${ind.slug}`}
                className="group grid grid-cols-12 items-baseline gap-x-6 gap-y-2 border-b border-line py-7"
              >
                <span className="col-span-2 font-mono text-xs text-ink-muted sm:col-span-1">
                  {ind.index}
                </span>
                <h2 className="col-span-10 font-display text-2xl font-medium leading-tight text-ink transition-colors group-hover:text-terracotta sm:col-span-5 sm:text-3xl">
                  {ind.label}
                </h2>
                <p className="col-span-12 max-w-prose text-base leading-relaxed text-ink-soft sm:col-span-5">
                  {ind.intro}
                </p>
                <span className="col-span-1 hidden justify-self-end text-ink-muted transition-colors group-hover:text-terracotta sm:flex">
                  <ArrowUpRight className="h-5 w-5" />
                </span>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
