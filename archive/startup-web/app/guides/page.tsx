import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { PageHeader } from "@/components/sections/page-header";
import { Container } from "@/components/ui/container";
import { FinalCta } from "@/components/sections/final-cta";
import { BookCall, CtaButton } from "@/components/ui/button";
import { guides } from "@/lib/guides";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contractor Marketing Guides",
  description:
    "Straight answers on contractor websites, SEO costs, Google Business Profile, social media, and lead generation for construction companies — written for builders, not marketers.",
  alternates: { canonical: "/guides" },
  openGraph: {
    title: "Contractor Marketing Guides — Unifictional",
    description:
      "Straight answers on contractor websites, SEO costs, Google Business Profile, social media, and lead generation for construction companies.",
    url: "/guides",
  },
};

// CollectionPage + ItemList so the hub is understood as a guide index rather
// than a generic page, and each guide is discoverable from the structured data.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": `${siteConfig.url}/guides#page`,
  url: `${siteConfig.url}/guides`,
  name: "Contractor Marketing Guides",
  description:
    "Guides on websites, SEO, Google Business Profile, social media, and lead generation for contractors and construction companies.",
  isPartOf: { "@id": `${siteConfig.url}/#website` },
  publisher: { "@id": `${siteConfig.url}/#org` },
  mainEntity: {
    "@type": "ItemList",
    itemListElement: guides.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${siteConfig.url}/guides/${g.slug}`,
      name: g.title,
    })),
  },
};

export default function GuidesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <PageHeader
        dark
        eyebrow="Guides"
        title={
          <>
            Straight answers, <em className="italic text-terracotta">no sales pitch.</em>
          </>
        }
        intro="What a contractor website costs. What SEO actually costs. How to rank in the map pack, how to stop losing calls, and how to tell whether an agency is worth hiring — including when the honest answer is not yet."
      >
        <BookCall variant="bone" size="lg" />
        <CtaButton
          href="/services"
          variant="link"
          size="lg"
          icon="up-right"
          className="text-bone/80 hover:text-bone"
        >
          What we do
        </CtaButton>
      </PageHeader>

      <section className="bg-bone py-16 sm:py-20">
        <Container>
          <div className="border-t border-line">
            {guides.map((g, i) => (
              <Link
                key={g.slug}
                href={`/guides/${g.slug}`}
                className="group grid grid-cols-12 items-baseline gap-x-6 gap-y-2 border-b border-line py-7"
              >
                <span className="col-span-2 font-mono text-xs text-ink-muted sm:col-span-1">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="col-span-10 font-display text-2xl font-medium leading-tight text-ink transition-colors group-hover:text-terracotta sm:col-span-6 sm:text-3xl">
                  {g.title}
                </h2>
                <p className="col-span-12 max-w-prose text-base leading-relaxed text-ink-soft sm:col-span-4">
                  {g.description}
                </p>
                <span className="col-span-1 hidden justify-self-end text-ink-muted transition-colors group-hover:text-terracotta sm:flex">
                  <ArrowUpRight className="h-5 w-5" />
                </span>
                <span className="col-span-12 font-mono text-[11px] uppercase tracking-label text-ink-muted sm:col-start-2 sm:col-end-7">
                  {g.readMinutes} min read
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
