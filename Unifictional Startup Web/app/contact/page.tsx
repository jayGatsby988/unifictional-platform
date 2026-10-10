import type { Metadata } from "next";
import { ShieldCheck, Clock, CalendarClock } from "lucide-react";

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
    "Book a free, no-pressure call. Tell us about your business and we'll recommend the right website and marketing system for your goals.",
  alternates: { canonical: "/contact" },
};

const reassurances = [
  {
    icon: CalendarClock,
    text: "Pick any open time — you'll get an email confirmation with a calendar invite right after you book.",
  },
  { icon: Clock, text: "Thirty focused minutes. We reply by email the moment you book." },
  {
    icon: ShieldCheck,
    text: "No pressure — just a clear, specific plan for getting more booked jobs.",
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
              Book a <em className="italic text-terracotta">call.</em>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl">
              Thirty minutes, zero pressure. We&apos;ll learn your goals and give you a clear,
              specific plan — whether or not we end up working together.
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
                  Pick a time. We&apos;ll handle the rest.
                </h2>
                <p className="mt-4 max-w-md text-lg leading-relaxed text-ink-soft">
                  Choose a slot that works, share a little about your business, and you&apos;re
                  set — confirmation and calendar invite included.
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
