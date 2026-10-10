"use client";

import Script from "next/script";

import { siteConfig } from "@/lib/site";

/**
 * Calendly inline scheduler. Booking, confirmation emails, reminders, and
 * two-way Google Calendar sync are all handled by Calendly once the owner
 * connects their calendar — so a confirmed slot lands on the calendar with no
 * manual step. The link is env-driven (NEXT_PUBLIC_CALENDLY_URL).
 */
export function CalendlyEmbed() {
  const url = siteConfig.calendlyUrl;

  // Graceful fallback before the scheduler link is wired up.
  if (!url) {
    return (
      <div className="flex min-h-[480px] flex-col items-center justify-center rounded-2xl border border-line bg-paper/75 p-10 text-center shadow-[0_30px_60px_-30px_rgba(26,23,20,0.4)] backdrop-blur-xl">
        <p className="font-display text-2xl font-medium text-ink">Booking opens shortly.</p>
        <p className="mt-3 max-w-sm text-base leading-relaxed text-ink-soft">
          Our scheduler is being connected. In the meantime, email{" "}
          <a
            href={`mailto:${siteConfig.bookingEmail}`}
            className="font-medium text-ink underline underline-offset-4"
          >
            {siteConfig.bookingEmail}
          </a>{" "}
          and we&apos;ll set up a time.
        </p>
      </div>
    );
  }

  // Theme the widget to the site's monochrome light palette.
  const themed = `${url}${url.includes("?") ? "&" : "?"}hide_gdpr_banner=1&background_color=ffffff&text_color=1a1714&primary_color=1a1714`;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_30px_60px_-30px_rgba(26,23,20,0.4)]">
      <div
        className="calendly-inline-widget"
        data-url={themed}
        style={{ minWidth: "320px", height: "720px" }}
      />
      <Script
        src="https://assets.calendly.com/assets/external/widget.js"
        strategy="afterInteractive"
      />
    </div>
  );
}
