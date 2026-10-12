import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Check, Search } from "lucide-react";

import { getIndustry, industries } from "@/lib/industries";
import { getService, siteConfig } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { BookCall, CtaButton } from "@/components/ui/button";
import { FinalCta } from "@/components/sections/final-cta";

export function generateStaticParams() {
  return industries.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) return { title: "Industry not found" };

  return {
    title: industry.metaTitle,
    description: industry.description,
    keywords: [industry.targetKeyword, ...industry.secondaryKeywords],
    alternates: { canonical: `/industries/${industry.slug}` },
    openGraph: {
      title: `${industry.metaTitle} — ${siteConfig.name}`,
      description: industry.description,
      url: `/industries/${industry.slug}`,
    },
  };
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) notFound();

  const priority = industry.priorityServices
    .map((s) => getService(s))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const related = industry.related
    .map((s) => getIndustry(s))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));

  const url = `${siteConfig.url}/industries/${industry.slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        "@id": `${url}#service`,
        name: industry.title,
        description: industry.description,
        url,
        serviceType: industry.targetKeyword,
        provider: { "@id": `${siteConfig.url}/#org` },
        areaServed: { "@type": "Country", name: "United States" },
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: `${industry.label} marketing services`,
          itemListElement: priority.map((s) => ({
            "@type": "Offer",
            itemOffered: { "@type": "Service", name: s.title, description: s.description },
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: siteConfig.url },
          {
            "@type": "ListItem",
            position: 2,
            name: "Industries",
            item: `${siteConfig.url}/industries`,
          },
          { "@type": "ListItem", position: 3, name: industry.label, item: url },
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
      <header className="border-b border-line bg-bone pb-16 pt-36 sm:pb-20 sm:pt-44">
        <Container>
          <div className="animate-rise">
            <nav
              aria-label="Breadcrumb"
              className="mb-7 flex items-center gap-2 font-mono text-[11px] uppercase tracking-label text-ink-muted"
            >
              <Link href="/industries" className="-my-2 py-2 transition-colors hover:text-ink">
                Industries
              </Link>
              <span aria-hidden>/</span>
              <span className="text-ink">{industry.index}</span>
            </nav>

            <Eyebrow index={industry.index}>{industry.label}</Eyebrow>
            <h1 className="mt-6 max-w-4xl text-balance font-display text-4xl font-medium leading-[1.05] tracking-[-0.02em] text-ink sm:text-5xl md:text-6xl">
              {industry.title}
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl">
              {industry.intro}
            </p>
            <div className="mt-9 flex flex-col gap-4 sm:flex-row">
              <BookCall variant="solid" size="lg" />
              <CtaButton href="/work" variant="outline" size="lg" icon="up-right">
                See the work
              </CtaButton>
            </div>
          </div>
        </Container>
      </header>

      {/* Quotable summary */}
      <section className="border-b border-line bg-sand/50 py-12 sm:py-14">
        <Container>
          <div className="max-w-[68ch]">
            <Eyebrow tone="accent">In short</Eyebrow>
            <p className="mt-5 font-display text-[1.3rem] font-normal normal-case leading-[1.5] tracking-normal text-ink sm:text-2xl sm:leading-[1.5]">
              {industry.answer}
            </p>
          </div>
        </Container>
      </section>

      {/* What's different about this trade */}
      <section className="bg-bone py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="min-w-0 lg:col-span-4">
              <Eyebrow tone="accent">What&apos;s different here</Eyebrow>
              <h2 className="mt-6 font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
                Why a generic marketing package underperforms in {industry.label.toLowerCase()}.
              </h2>
            </div>
            <div className="min-w-0 lg:col-span-8">
              <div className="border-t border-line">
                {industry.whatMakesItDifferent.map((item) => (
                  <div key={item.title} className="border-b border-line py-6">
                    <h3 className="font-display text-xl font-medium leading-snug text-ink sm:text-2xl">
                      {item.title}
                    </h3>
                    <p className="mt-3 max-w-[68ch] text-base leading-relaxed text-ink-soft">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* What buyers search */}
      <section className="border-y border-line bg-sand/40 py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="min-w-0 lg:col-span-4">
              <Eyebrow tone="accent">What your buyers search</Eyebrow>
              <h2 className="mt-6 font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
                The searches your next job starts with.
              </h2>
              <p className="mt-5 max-w-prose text-base leading-relaxed text-ink-soft">
                We build the pages that answer these, because a single services page can&apos;t rank
                for any of them.
              </p>
            </div>
            <div className="min-w-0 lg:col-span-8">
              <ul className="grid grid-cols-1 gap-x-10 border-t border-line sm:grid-cols-2">
                {industry.buyerSearches.map((q) => (
                  <li
                    key={q}
                    className="flex items-start gap-3 border-b border-line py-4 font-mono text-sm text-ink-soft"
                  >
                    <Search className="mt-0.5 h-4 w-4 shrink-0 text-terracotta" />
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      {/* Priority services */}
      <section className="bg-bone py-20 sm:py-24">
        <Container>
          <Eyebrow tone="accent">Where we&apos;d start</Eyebrow>
          <h2 className="mt-6 max-w-3xl font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
            The parts of the system that matter most in {industry.label.toLowerCase()}.
          </h2>
          <div className="mt-10 border-t border-line">
            {priority.map((s) => (
              <Link
                key={s.slug}
                href={`/services/${s.slug}`}
                className="group grid grid-cols-12 items-baseline gap-x-6 gap-y-2 border-b border-line py-6"
              >
                <span className="col-span-2 font-mono text-xs text-ink-muted sm:col-span-1">
                  {s.index}
                </span>
                <span className="col-span-10 font-display text-xl font-medium text-ink transition-colors group-hover:text-terracotta sm:col-span-5 sm:text-2xl">
                  {s.title}
                </span>
                <span className="col-span-12 text-base leading-relaxed text-ink-soft sm:col-span-5">
                  {s.description}
                </span>
                <span className="col-span-1 hidden justify-self-end text-ink-muted transition-colors group-hover:text-terracotta sm:flex">
                  <ArrowUpRight className="h-5 w-5" />
                </span>
              </Link>
            ))}
          </div>

          <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              "One studio for the website, the search visibility, the content, and the lead flow.",
              "A page for every service and every town you actually want work in.",
              "Reporting in booked jobs and calls — not impressions.",
              "A clear recommendation on the first call, whether or not we work together.",
            ].map((t) => (
              <li key={t} className="flex items-start gap-4 border-t border-line pt-5">
                <Check className="mt-1 h-4 w-4 shrink-0 text-terracotta" />
                <span className="text-base leading-relaxed text-ink-soft">{t}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {related.length > 0 ? (
        <section className="border-t border-line bg-bone py-16 sm:py-20">
          <Container>
            <h2 className="font-display text-2xl font-medium text-ink sm:text-3xl">
              Related industries
            </h2>
            <div className="mt-8 border-t border-line">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/industries/${r.slug}`}
                  className="group flex items-baseline justify-between gap-6 border-b border-line py-5"
                >
                  <span className="font-display text-lg font-medium text-ink transition-colors group-hover:text-terracotta sm:text-xl">
                    {r.title}
                  </span>
                  <ArrowUpRight className="h-5 w-5 shrink-0 text-ink-muted transition-colors group-hover:text-terracotta" />
                </Link>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      <FinalCta />
    </>
  );
}
