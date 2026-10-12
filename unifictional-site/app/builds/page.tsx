import type { Metadata } from "next";

import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { BuildsBoard } from "@/components/sections/builds-board";

export const metadata: Metadata = {
  title: "Builds",
  robots: { index: false, follow: false },
};

export default function BuildsPage() {
  return (
    <div className="relative">
      <header className="pb-10 pt-36 sm:pt-44">
        <Container>
          <Eyebrow tone="accent">Studio</Eyebrow>
          <h1 className="mt-7 max-w-4xl text-balance font-display text-5xl font-medium leading-[1.0] tracking-[-0.02em] text-ink sm:text-6xl">
            Sites being <em className="italic text-terracotta">built.</em>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
            Every lead that came through the form, what the AI is doing for it right now, what it cost, and the preview when it is ready. Refreshes on its own.
          </p>
        </Container>
      </header>
      <section className="pb-28">
        <Container>
          <BuildsBoard />
        </Container>
      </section>
    </div>
  );
}
