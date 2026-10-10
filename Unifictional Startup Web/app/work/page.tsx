import type { Metadata } from "next";

import { PageHeader } from "@/components/sections/page-header";
import ThumbnailCarousel from "@/components/ui/thumbnail-carousel";
import { FinalCta } from "@/components/sections/final-cta";
import { BookCall, CtaButton } from "@/components/ui/button";
import { showcaseSites } from "@/lib/showcase";
import { siteConfig } from "@/lib/site";

/**
 * "contractor website examples" was the single highest-demand phrase in the
 * whole keyword set — and this page is a genuine answer to it: eight live
 * sites, all ours, all openable. Retargeting it here rather than writing a
 * separate page avoids competing with ourselves.
 */
export const metadata: Metadata = {
  title: "Contractor Website Examples — Real Sites We Built",
  description:
    "Eight live contractor website examples — general contracting, remodeling, custom homes, siding, excavation, and pools. Open any one and see the real, running site.",
  keywords: [
    "contractor website examples",
    "construction website examples",
    "general contractor website examples",
    "contractor website design",
    "best contractor website design",
  ],
  alternates: { canonical: "/work" },
  openGraph: {
    title: "Contractor Website Examples — Unifictional",
    description:
      "Eight live contractor website examples across general contracting, remodeling, custom homes, siding, excavation, and pools.",
    url: "/work",
  },
};

const workJsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": `${siteConfig.url}/work#page`,
  url: `${siteConfig.url}/work`,
  name: "Contractor Website Examples",
  description:
    "Live websites designed and built by Unifictional for contractors, remodelers, and builders.",
  isPartOf: { "@id": `${siteConfig.url}/#website` },
  publisher: { "@id": `${siteConfig.url}/#org` },
  mainEntity: {
    "@type": "ItemList",
    name: "Contractor website examples",
    itemListElement: showcaseSites.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: s.name,
      description: s.meta,
      ...(s.url ? { url: s.url } : {}),
    })),
  },
};

const items = showcaseSites.map((s) => ({
  title: s.name,
  meta: s.meta,
  url: s.url,
  image: s.image,
}));

export default function WorkPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(workJsonLd).replace(/</g, "\\u003c") }}
      />

      <PageHeader
        dark
        eyebrow="Selected work"
        title={
          <>
            Contractor website examples.{" "}
            <em className="italic text-terracotta">All of them live.</em>
          </>
        }
        intro="Eight real sites we designed and built — general contracting, remodeling, custom homes, siding, excavation, and pools. Drag, swipe, or use the thumbnails, then open any one and see the running site. We never show work we didn't do."
      >
        <BookCall variant="bone" size="lg" />
        <CtaButton
          href="/process"
          variant="link"
          size="lg"
          icon="up-right"
          className="text-bone/80 hover:text-bone"
        >
          How we work
        </CtaButton>
      </PageHeader>

      <section className="bg-bone pb-20 pt-6 sm:pb-24 sm:pt-10">
        <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-10">
          <ThumbnailCarousel items={items} />
        </div>
      </section>

      <FinalCta />
    </>
  );
}
