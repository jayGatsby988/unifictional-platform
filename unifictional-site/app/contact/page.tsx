import type { Metadata } from "next";
import { ShieldCheck, Clock, CalendarClock, Sparkles } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { BookingFlow } from "@/components/sections/booking-flow";
import { CalendlyEmbed } from "@/components/sections/calendly-embed";
import { Faq } from "@/components/sections/faq";
import { ContactWaves } from "@/components/sections/contact-waves";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Book a Call",
  description:
    "Book a free call and we build your new website before we meet. Real pages, your photos and branding, SEO done. You see it live on the call.",
  alternates: { canonical: "/contact" },
};

const reassurances = [
  {
    icon: Sparkles,
    text: "Your new website is built before the call: every page written, your photos, your logo, SEO done. We walk through it together.",
  },
  {
    icon: CalendarClock,
    text: "Pick any open time. The confirmation and calendar invite land in your inbox right after you book.",
  },
  { icon: Clock, text: "Thirty focused minutes: your new site, what it changes, and a clear next step." },
  {
    icon: ShieldCheck,
    text: "No pressure and nothing to prepare. If it's not for you, you still leave with a site plan.",
  },
];

export default function ContactPage() {
  return (
    <div className="relative">
      {/* Full-page animated wave background. */}
      <ContactWaves />

      {/* Header */}
      <header className="pb-12 pt-36 sm:pt-44">
        <Container>
          <div className="animate-rise">
            <Eyebrow tone="accent">Start</Eyebrow>
            <h1 className="mt-7 max-w-4xl text-balance font-display text-5xl font-medium leading-[1.0] tracking-[-0.02em] text-ink sm:text-6xl md:text-7xl">
              Book a call. Your new website will be{" "}
              <em className="italic text-terracotta">waiting.</em>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl">
              Pick a time and tell us a little about your business. By the time we meet, we&apos;ll
              have built your new website: real pages, your photos and branding, written and
              optimised for search. We walk through it live on the call, and you decide.
            </p>
          </div>
        </Container>
      </header>

      {/* Booking */}
      <section className="pb-20">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            {/* On mobile the booking widget comes FIRST (it's what they came
                for); on desktop the reassurance column stays on the left. */}
            <div className="order-last lg:order-none lg:col-span-5">
              <div className="lg:sticky lg:top-28">
                <Eyebrow tone="accent">Book in two minutes</Eyebrow>
                <h2 className="mt-6 font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
                  Pick a time. We build your site before we meet.
                </h2>
                <p className="mt-4 max-w-md text-lg leading-relaxed text-ink-soft">
                  Choose a slot, paste your current website (or tell us about the company if you
                  don&apos;t have one), and we get to work. On the call you see the finished
                  site, not a pitch.
                </p>
                <ul className="mt-9 space-y-5">
                  {reassurances.map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-start gap-4">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-paper/70 backdrop-blur-sm">
                        <Icon className="h-4 w-4 text-terracotta" />
                      </span>
                      <span className="text-base leading-relaxed text-ink-soft">{text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="lg:col-span-7">
              {/* Calendly once its link is set (NEXT_PUBLIC_CALENDLY_URL); until
                  then, keep the working custom booking flow live. */}
              {siteConfig.calendlyUrl ? <CalendlyEmbed /> : <BookingFlow />}
            </div>
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="border-t border-line pb-24 pt-16">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Before you ask</Eyebrow>
            <h2 className="mt-6 font-display text-3xl font-medium text-ink sm:text-4xl">
              A few common questions.
            </h2>
            <div className="mt-10">
              <Faq />
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
