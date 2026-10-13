import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Check } from "lucide-react";

import { getService, services, siteConfig } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { BookCall, CtaButton } from "@/components/ui/button";
import { FinalCta } from "@/components/sections/final-cta";

export function generateStaticParams() {
  return services.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const service = getService(slug);
  if (!service) return { title: "Service not found" };
  return {
    title: service.metaTitle,
    description: service.metaDescription,
    keywords: [service.targetKeyword, ...service.secondaryKeywords],
    alternates: { canonical: `/services/${service.slug}` },
    openGraph: {
      title: `${service.metaTitle} — ${siteConfig.name}`,
      description: service.metaDescription,
      url: `/services/${service.slug}`,
    },
  };
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const service = getService(slug);
  if (!service) notFound();

  const related = services.filter((s) => s.slug !== service.slug).slice(0, 3);

  const url = `${siteConfig.url}/services/${service.slug}`;

  // Service + FAQPage + BreadcrumbList. `serviceType` carries the target
  // keyword so the offering is machine-readable as the thing people search
  // for, not just as our internal product name.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        "@id": `${url}#service`,
        name: service.heading,
        alternateName: service.title,
        serviceType: service.targetKeyword,
        description: service.metaDescription,
        url,
        provider: { "@id": `${siteConfig.url}/#org` },
        areaServed: { "@type": "Country", name: "United States" },
        audience: {
          "@type": "BusinessAudience",
          name: "Contractors, remodelers, and custom home builders",
        },
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: `${service.title} — what's included`,
          itemListElement: service.details.map((d) => ({
            "@type": "Offer",
            itemOffered: { "@type": "Service", name: d },
          })),
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: service.faqs.map((f) => ({
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
          { "@type": "ListItem", position: 2, name: "Services", item: `${siteConfig.url}/services` },
          { "@type": "ListItem", position: 3, name: service.title, item: url },
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
            <nav className="mb-7 flex items-center gap-2 font-mono text-[11px] uppercase tracking-label text-ink-muted" aria-label="Breadcrumb">
              <Link href="/services" className="-my-2 py-2 transition-colors hover:text-ink">
                Services
              </Link>
              <span aria-hidden>/</span>
              <span className="text-ink">{service.index}</span>
            </nav>

            <Eyebrow index={service.index}>{service.title}</Eyebrow>
            <h1 className="mt-6 max-w-4xl text-balance font-display text-4xl font-medium leading-[1.05] tracking-[-0.02em] text-ink sm:text-5xl md:text-6xl">
              {service.heading}
            </h1>
            <p className="mt-6 max-w-2xl font-display text-2xl italic text-ink-soft">
              {service.tagline}
            </p>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft">
              {service.description}
            </p>
            <div className="mt-9 flex flex-col gap-4 sm:flex-row">
              <BookCall variant="solid" size="lg" />
              <CtaButton href="/services" variant="outline" size="lg" icon={null}>
                All services
              </CtaButton>
            </div>
          </div>
        </Container>
      </header>

      {/* What's included */}
      <section className="bg-bone py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="min-w-0 lg:col-span-5">
              <Eyebrow tone="accent">What&apos;s included</Eyebrow>
              <h2 className="mt-6 font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
                Done properly, done for you.
              </h2>
            </div>
            <div className="min-w-0 lg:col-span-7">
              <ul className="border-t border-line">
                {service.details.map((d) => (
                  <li key={d} className="flex items-start gap-4 border-b border-line py-5">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-terracotta" />
                    <span className="text-base leading-relaxed text-ink-soft">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      {/* Outcome */}
      <section className="border-y border-line bg-sand/60 py-20 sm:py-28">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>The outcome</Eyebrow>
            <p className="mt-6 font-display text-3xl font-medium leading-[1.2] text-ink sm:text-4xl">
              {service.outcome}
            </p>
            <p className="mt-6 max-w-prose text-base leading-relaxed text-ink-soft">
              Every business is different. We&apos;ll recommend the right version of this after
              learning about your goals — no pricing guesswork, no packages you&apos;ll outgrow.
            </p>
            <div className="mt-8">
              <BookCall variant="solid" size="lg" />
            </div>
          </div>
        </Container>
      </section>

      {/* FAQs — rendered content that backs the FAQPage schema above. */}
      <section className="bg-bone py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="min-w-0 lg:col-span-4">
              <Eyebrow tone="accent">Common questions</Eyebrow>
              <h2 className="mt-6 font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
                What contractors ask us about this.
              </h2>
            </div>
            <div className="min-w-0 lg:col-span-8">
              <dl className="border-t border-line">
                {service.faqs.map((f) => (
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
          </div>
        </Container>
      </section>

      {/* Pairs well with */}
      <section className="border-t border-line bg-bone py-20 sm:py-24">
        <Container>
          <h2 className="font-display text-2xl font-medium text-ink sm:text-3xl">Pairs well with</h2>
          <div className="mt-8 border-t border-line">
            {related.map((s) => (
              <Link
                key={s.slug}
                href={`/services/${s.slug}`}
                className="group grid grid-cols-12 items-baseline gap-3 border-b border-line py-5"
              >
                <span className="col-span-2 font-mono text-xs text-ink-muted sm:col-span-1">
                  {s.index}
                </span>
                <span className="col-span-9 font-display text-xl font-medium text-ink transition-colors group-hover:text-terracotta sm:col-span-6 sm:text-2xl">
                  {s.title}
                </span>
                <span className="col-span-12 mt-1 text-sm text-ink-soft sm:col-span-4 sm:mt-0">
                  {s.tagline}
                </span>
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
