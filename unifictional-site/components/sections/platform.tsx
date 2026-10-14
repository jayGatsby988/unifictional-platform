import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { BookCall, CtaButton, StartAutopilot, StudioCta } from "@/components/ui/button";
import { STUDIO_HOME } from "@/lib/site";

/**
 * The platform, in one place: the three things a client gets, each with the
 * way in. Sits straight after the hero so nobody has to hunt for them.
 */
const PRODUCTS = [
  {
    index: "01",
    eyebrow: "Website",
    title: "A new site, built before we meet.",
    body: "Book a call and the builder researches your business, writes every page, uses your photos and logo, and checks itself in a real browser. You see the finished site on the call.",
    points: ["Researched from your site, reviews and market", "Every page written and photographed", "Checked on desktop and phone before you see it"],
    image: { src: "/showcase/go-far-construction-v2.webp", alt: "A contractor website built by Unifictional, shown on a desktop screen" },
    primary: <BookCall label="Book a call" variant="solid" />,
    secondary: { label: "How the build works", href: "/process" },
  },
  {
    index: "02",
    eyebrow: "Search",
    title: "SEO Autopilot: posts that write and publish themselves.",
    body: "Pick how many posts a month, pay by card, and the autopilot researches your towns and trade, writes, checks and publishes on a schedule. Talk to the strategist to change direction any time.",
    points: ["Live in minutes, no call needed", "Published to your site, WordPress or a hosted blog", "A strategist you can message about keywords and plans"],
    image: { src: "/platform-autopilot.png", alt: "The SEO Autopilot page in the Unifictional client portal, with the calendar of posts and the strategist" },
    primary: <StartAutopilot label="Start SEO Autopilot" variant="solid" />,
    secondary: { label: "What it does", href: "/services/seo" },
  },
  {
    index: "03",
    eyebrow: "Sales tool",
    title: "The 3D Remodel Studio your customers can use.",
    body: "One photo of a kitchen, bathroom or exterior becomes a 3D twin that is redesigned live and priced line by line. Two free scans, no account, no call.",
    points: ["Photo to 3D twin in about a minute", "250+ real materials with a live estimate", "Photoreal renders and share links"],
    image: { src: "/studio-preview.png", alt: "The 3D Remodel Studio: a kitchen photo turned into a 3D model with a live estimate" },
    primary: <StudioCta label="Open the 3D studio" />,
    secondary: { label: "Two free scans", href: STUDIO_HOME },
  },
];

export function Platform() {
  return (
    <section id="platform" className="scroll-mt-24 border-t border-line bg-bone py-24 sm:py-32">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="The platform"
            title={
              <>
                One platform. <em className="italic text-terracotta">Three ways in.</em>
              </>
            }
            intro="Every Unifictional client gets the same three tools in one portal: a website we build before we even meet, search content that writes and publishes itself, and a 3D studio their customers can use. Start with whichever you need first."
          />
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {PRODUCTS.map((p, i) => (
            <Reveal key={p.index} className="flex" delay={i * 90}>
              <article className="group flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-paper">
                <div className="relative aspect-[16/10] overflow-hidden border-b border-line bg-sand">
                  <Image
                    src={p.image.src}
                    alt={p.image.alt}
                    fill
                    sizes="(min-width: 1024px) 33vw, 100vw"
                    className="object-cover object-top transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-5 p-7 sm:p-8">
                  <Eyebrow index={p.index} tone="muted">
                    {p.eyebrow}
                  </Eyebrow>
                  <h3 className="font-display text-3xl font-medium leading-[1.05] tracking-[-0.01em] text-ink">{p.title}</h3>
                  <p className="text-base leading-relaxed text-ink-soft">{p.body}</p>
                  <ul className="space-y-2 text-sm text-ink-soft">
                    {p.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto flex flex-wrap items-center gap-4 pt-3">
                    {p.primary}
                    {/^https?:\/\//.test(p.secondary.href) ? (
                      <CtaButton href={p.secondary.href} external variant="link" icon="up-right">
                        {p.secondary.label}
                      </CtaButton>
                    ) : (
                      <Link href={p.secondary.href} className="link-underline text-sm font-medium text-ink hover:text-terracotta">
                        {p.secondary.label}
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-10">
          <p className="max-w-prose text-sm text-ink-muted">
            All three live in the client portal, where you also see your site&apos;s health, your Google and social numbers, every post, every quote and your billing.{" "}
            <Link href="/about#client-portal" className="link-underline text-ink">
              See the portal
            </Link>
            .
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
