import type { Metadata } from "next";
import {
  Activity, BarChart3, Box, CreditCard, FileSearch, MessageSquare, Search, Sparkles,
} from "lucide-react";

import { PageHeader } from "@/components/sections/page-header";
import { PortalMock } from "@/components/sections/portal-mock";
import { FinalCta } from "@/components/sections/final-cta";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { BookCall, CtaButton, PORTAL_URL } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Client Portal",
  description:
    "Every Unifictional client gets a private portal: website health, Google rankings, social, SEO Autopilot, 3D quote requests and billing, all in one place, updated nightly.",
  alternates: { canonical: "/portal" },
};

const FEATURES = [
  { icon: Activity, title: "Website health", body: "A grade for your site, uptime and speed, and the exact fixes we're working on this month." },
  { icon: Search, title: "Google & search", body: "The local searches you show up for, where you rank, and how many people clicked through." },
  { icon: BarChart3, title: "Social", body: "Followers, reach and your best posts on Facebook and Instagram, without logging into either." },
  { icon: Sparkles, title: "SEO Autopilot", body: "Fresh, local articles written for your trade and your towns, published to your site on a schedule." },
  { icon: Box, title: "3D quote tool", body: "Homeowners price their project in 3D on your website. Every quote lands here as a lead with their details." },
  { icon: CreditCard, title: "Billing", body: "Your plan, every invoice and receipt, and autopay through Square. Card numbers never touch us." },
  { icon: MessageSquare, title: "Requests", body: "Need a photo swapped or a page changed? Ask here and see our reply in the same place." },
  { icon: FileSearch, title: "Free website check", body: "The moment you sign up, we run a full check of your site so you know where you stand on day one." },
];

const STEPS = [
  { n: "01", title: "Create your free account", body: "Two minutes. Your login and a temporary password arrive by email." },
  { n: "02", title: "We connect everything", body: "Your website, Google and social accounts, usually within one business day. Nothing technical for you to do." },
  { n: "03", title: "Watch it work", body: "Your numbers update every night, and we email you when something needs your attention." },
];

const FAQS = [
  { q: "Do I have to set anything up?", a: "No. You create an account, and we connect your website, Google and social media for you. If we ever need access to something, we walk you through it step by step." },
  { q: "Is it hard to use?", a: "It's built for busy owners: big text, plain English, one screen per topic. Forget your password? Tap one button and we email you a sign-in link." },
  { q: "What does it cost?", a: "The portal comes with every Unifictional plan, and creating an account is free. Plans are priced to your business; tap “I'm interested” on any plan inside and we'll walk you through it." },
  { q: "Who sees my data?", a: "Only you, the people you add, and the Unifictional team working on your account. We only ever ask Google and Meta for read-only access." },
];

export default function PortalPage() {
  return (
    <>
      <PageHeader
        dark
        eyebrow="The client portal"
        title={
          <>
            Your whole business,{" "}
            <em className="italic text-terracotta">one dashboard.</em>
          </>
        }
        intro="Website, Google, social, quotes and billing, in one private place that updates every night. Built for owners, not marketers."
      >
        <CtaButton href={`${PORTAL_URL}/signup`} external variant="bone" size="lg" icon="up-right">
          Create free account
        </CtaButton>
        <CtaButton href={`${PORTAL_URL}/login`} external variant="link" size="lg" icon="up-right" className="text-bone/80 hover:text-bone">
          Sign in
        </CtaButton>
      </PageHeader>

      {/* Dashboard preview */}
      <section className="bg-bone py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-5">
              <Reveal>
                <Eyebrow tone="accent">What you see</Eyebrow>
                <h2 className="mt-6 font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
                  Know what&apos;s working without asking.
                </h2>
                <p className="mt-6 text-lg leading-relaxed text-ink-soft">
                  Open it on your phone between jobs. Visits, calls, leads and rankings are right there,
                  with plain-English notes on what changed and what we&apos;re doing about it.
                </p>
              </Reveal>
            </div>
            <div className="min-w-0 lg:col-span-7">
              <Reveal delay={80}>
                <PortalMock />
              </Reveal>
            </div>
          </div>
        </Container>
      </section>

      {/* Features */}
      <section className="border-y border-line bg-sand/60 py-20 sm:py-28">
        <Container>
          <Reveal>
            <Eyebrow>Everything in one place</Eyebrow>
            <h2 className="mt-6 max-w-3xl font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
              Eight things you&apos;d otherwise chase across eight logins.
            </h2>
          </Reveal>
          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 4) * 60}>
                <div className="h-full bg-bone p-7">
                  <f.icon className="h-6 w-6 text-terracotta" aria-hidden />
                  <h3 className="mt-5 font-display text-xl font-medium text-ink">{f.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-ink-soft">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* How it works */}
      <section className="bg-bone py-20 sm:py-24">
        <Container>
          <Reveal>
            <Eyebrow tone="accent">How it works</Eyebrow>
          </Reveal>
          <ol className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 80}>
                <li>
                  <span className="font-display text-5xl font-medium text-terracotta/90">{s.n}</span>
                  <h3 className="mt-4 font-display text-2xl font-medium text-ink">{s.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-ink-soft">{s.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
          <div className="mt-12 flex flex-wrap items-center gap-4">
            <CtaButton href={`${PORTAL_URL}/signup`} external variant="solid" size="lg" icon="up-right">
              Create free account
            </CtaButton>
            <BookCall variant="outline" size="lg" />
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="border-t border-line bg-sand/60 py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Reveal>
                <Eyebrow>Questions</Eyebrow>
                <h2 className="mt-6 font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">The short answers.</h2>
              </Reveal>
            </div>
            <dl className="divide-y divide-line border-y border-line lg:col-span-8">
              {FAQS.map((f) => (
                <div key={f.q} className="py-6">
                  <dt className="font-display text-xl font-medium text-ink">{f.q}</dt>
                  <dd className="mt-2 text-base leading-relaxed text-ink-soft">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
