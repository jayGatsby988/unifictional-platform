import type { Metadata } from "next";

import { PageHeader } from "@/components/sections/page-header";
import { Container } from "@/components/ui/container";
import { Faq } from "@/components/sections/faq";
import { FinalCta } from "@/components/sections/final-cta";
import { faqs } from "@/lib/site";

export const metadata: Metadata = {
  title: "Questions",
  description:
    "Answers about how Unifictional works — how pricing works, who we work with, what we build, and how to get started.",
  alternates: { canonical: "/faq" },
};

// FAQPage rich-result schema, built from the same data the page renders.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
      />
      <PageHeader
        eyebrow="Questions"
        title={
          <>
            Questions, <em className="italic text-terracotta">answered.</em>
          </>
        }
        intro="The things builders ask us most — including the big one: how pricing works."
      />

      <section className="bg-bone py-16 sm:py-20">
        <Container>
          <div className="max-w-3xl">
            <Faq />
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
