import type { Metadata } from "next";

import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { BookCall, CtaButton } from "@/components/ui/button";

// Without this the 404 inherited the homepage title (and was indexable).
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  // A <section>, not <main> — the root layout already wraps pages in <main>.
  return (
    <section className="flex min-h-[82vh] items-center bg-bone pb-16 pt-28">
      <Container>
        <div className="max-w-2xl animate-rise">
          <Eyebrow tone="accent">404 — Not found</Eyebrow>
          <h1 className="mt-6 font-display text-5xl font-medium leading-[1.02] tracking-[-0.02em] text-ink sm:text-6xl md:text-7xl">
            This one&apos;s still <em className="italic text-terracotta">under construction.</em>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
            The page you&apos;re looking for moved or never existed. Let&apos;s get you back on
            solid ground.
          </p>
          <div className="mt-9 flex flex-col gap-4 sm:flex-row">
            <CtaButton href="/" variant="solid" size="lg" icon="arrow">
              Back home
            </CtaButton>
            <BookCall variant="outline" size="lg" />
          </div>
        </div>
      </Container>
    </section>
  );
}
