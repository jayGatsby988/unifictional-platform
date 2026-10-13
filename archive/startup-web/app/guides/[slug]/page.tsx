import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { getGuide, guides } from "@/lib/guides";
import { siteConfig } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { BookCall, CtaButton } from "@/components/ui/button";
import { FinalCta } from "@/components/sections/final-cta";
import { Prose, slugifyHeading } from "@/components/sections/prose";

export function generateStaticParams() {
  return guides.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return { title: "Guide not found" };

  return {
    title: guide.metaTitle,
    description: guide.description,
    keywords: [guide.targetKeyword, ...guide.secondaryKeywords],
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: {
      type: "article",
      title: `${guide.metaTitle} — ${siteConfig.name}`,
      description: guide.description,
      url: `/guides/${guide.slug}`,
      publishedTime: guide.updated,
      modifiedTime: guide.updated,
    },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const related = guide.related
    .map((s) => getGuide(s))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  const sections = guide.blocks.filter((b) => b.type === "h2") as { type: "h2"; text: string }[];

  const url = `${siteConfig.url}/guides/${guide.slug}`;

  // Article + FAQPage + BreadcrumbList in one graph. The FAQ entries mirror
  // what's rendered on the page — never schema-only content.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        headline: guide.title,
        description: guide.description,
        abstract: guide.answer,
        url,
        datePublished: guide.updated,
        dateModified: guide.updated,
        inLanguage: "en-US",
        author: { "@id": `${siteConfig.url}/#org` },
        publisher: { "@id": `${siteConfig.url}/#org` },
        isPartOf: { "@id": `${siteConfig.url}/#website` },
        mainEntityOfPage: url,
        about: [guide.targetKeyword, ...guide.secondaryKeywords].map((k) => ({
          "@type": "Thing",
          name: k,
        })),
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: guide.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: siteConfig.url },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${siteConfig.url}/guides` },
          { "@type": "ListItem", position: 3, name: guide.title, item: url },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      {/* Hero */}
      <header className="border-b border-line bg-bone pb-14 pt-36 sm:pb-16 sm:pt-44">
        <Container>
          <div className="animate-rise">
            <nav
              aria-label="Breadcrumb"
              className="mb-7 flex items-center gap-2 font-mono text-[11px] uppercase tracking-label text-ink-muted"
            >
              <Link href="/guides" className="-my-2 py-2 transition-colors hover:text-ink">
                Guides
              </Link>
              <span aria-hidden>/</span>
              <span className="text-ink">{guide.readMinutes} min read</span>
            </nav>

            <Eyebrow tone="accent">{guide.eyebrow}</Eyebrow>
            <h1 className="mt-6 max-w-4xl text-balance font-display text-4xl font-medium leading-[1.05] tracking-[-0.02em] text-ink sm:text-5xl md:text-6xl">
              {guide.title}
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl">
              {guide.intro}
            </p>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-label text-ink-muted">
              Updated{" "}
              {new Date(guide.updated).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}
            </p>
          </div>
        </Container>
      </header>

      {/* The short answer — quotable, and the thing assistants tend to lift. */}
      <section className="border-b border-line bg-sand/50 py-12 sm:py-14">
        <Container>
          <div className="max-w-[68ch]">
            <Eyebrow tone="accent">The short answer</Eyebrow>
            <p className="mt-5 font-display text-[1.3rem] font-normal normal-case leading-[1.5] tracking-normal text-ink sm:text-2xl sm:leading-[1.5]">
              {guide.answer}
            </p>
          </div>
        </Container>
      </section>

      {/* Body + sticky contents */}
      <section className="bg-bone py-16 sm:py-20">
        <Container>
          {/* Single column until lg. A 12-track grid at mobile still lays out
              11 × 48px column gaps even when every child spans all 12, which
              alone is wider than a phone viewport. */}
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-x-12">
            {/* min-w-0 on both grid children: grid items default to
                min-width:auto, which lets the widest table force the whole
                document wider than the viewport instead of scrolling inside
                its own container. */}
            <aside className="min-w-0 lg:col-span-3">
              <div className="lg:sticky lg:top-28">
                <p className="font-mono text-[11px] uppercase tracking-label text-ink-muted">
                  Contents
                </p>
                <nav aria-label="Contents" className="mt-4 space-y-0.5 border-t border-line pt-3 lg:space-y-1">
                  {sections.map((s) => (
                    <a
                      key={s.text}
                      href={`#${slugifyHeading(s.text)}`}
                      className="block py-2 text-sm leading-snug text-ink-soft transition-colors hover:text-terracotta lg:py-1"
                    >
                      {s.text}
                    </a>
                  ))}
                </nav>
                <div className="mt-8 border-t border-line pt-6">
                  <BookCall label="Book a call" variant="solid" />
                </div>
              </div>
            </aside>

            <article className="min-w-0 lg:col-span-9">
              <Prose blocks={guide.blocks} />

              {/* FAQs — rendered, then mirrored into FAQPage schema above. */}
              <div className="mt-16 border-t border-line pt-12">
                <h2
                  id="frequently-asked-questions"
                  className="scroll-mt-28 font-display text-3xl font-medium text-ink sm:text-4xl"
                >
                  Frequently asked questions
                </h2>
                <dl className="mt-8 border-t border-line">
                  {guide.faqs.map((f) => (
                    <div key={f.q} className="border-b border-line py-6">
                      <dt className="font-display text-xl font-medium leading-snug text-ink">
                        {f.q}
                      </dt>
                      <dd className="mt-3 max-w-[68ch] text-base leading-relaxed text-ink-soft">
                        {f.a}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {related.length > 0 ? (
                <div className="mt-16 border-t border-line pt-12">
                  <h2 className="font-display text-2xl font-medium text-ink sm:text-3xl">
                    Keep reading
                  </h2>
                  <div className="mt-6 border-t border-line">
                    {related.map((r) => (
                      <Link
                        key={r.slug}
                        href={`/guides/${r.slug}`}
                        className="group flex items-baseline justify-between gap-6 border-b border-line py-5"
                      >
                        <span className="font-display text-lg font-medium text-ink transition-colors group-hover:text-terracotta sm:text-xl">
                          {r.title}
                        </span>
                        <ArrowUpRight className="h-5 w-5 shrink-0 text-ink-muted transition-colors group-hover:text-terracotta" />
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-14 flex flex-col gap-4 sm:flex-row">
                <BookCall variant="solid" size="lg" />
                <CtaButton href="/guides" variant="outline" size="lg" icon={null}>
                  All guides
                </CtaButton>
              </div>
            </article>
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
