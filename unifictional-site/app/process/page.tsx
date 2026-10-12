import type { Metadata } from "next";

import { PageHeader } from "@/components/sections/page-header";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { ProcessList } from "@/components/sections/process-list";
import { FinalCta } from "@/components/sections/final-cta";
import { BookCall } from "@/components/ui/button";
import { ProcessInkBackground } from "@/components/sections/process-ink-background";

export const metadata: Metadata = {
  title: "Process",
  description:
    "A clear, low-pressure path from first call to a system that keeps getting better: the conversation, the build, the system, and the refinement.",
  alternates: { canonical: "/process" },
};

const expectations = [
  "A clear recommendation on your first call — whether or not we work together.",
  "One studio and one point of contact, not four vendors pointing fingers.",
  "Plain-English updates. No jargon, no vanity metrics, no surprises.",
  "No pricing games — we scope the right system to your goals, not a package.",
];

export default function ProcessPage() {
  return (
    <>
      {/* Cursor-revealed architectural backdrop behind the header + content. */}
      <div className="relative">
        <ProcessInkBackground />

        <div className="relative z-10">
          <PageHeader
            dark
            eyebrow="The process"
            title={
              <>
                From first call to <em className="italic text-terracotta">fully booked.</em>
              </>
            }
            intro="A calm, four-step path that turns your business into a premium online brand — and keeps getting better after launch."
          >
            <BookCall variant="bone" size="lg" />
          </PageHeader>

          <section className="pb-16 pt-8 sm:pb-20">
            <Container>
              <ProcessList detailed />
            </Container>
          </section>

          <section className="border-t border-line py-20 sm:py-24">
            <Container>
              <Reveal>
                <Eyebrow tone="accent">What to expect</Eyebrow>
                <div className="mt-10 grid grid-cols-1 gap-x-12 gap-y-6 sm:grid-cols-2">
                  {expectations.map((e) => (
                    <div key={e} className="flex items-start gap-4 border-t border-line pt-5">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-terracotta" />
                      <p className="text-lg leading-relaxed text-ink-soft">{e}</p>
                    </div>
                  ))}
                </div>
              </Reveal>
            </Container>
          </section>
        </div>
      </div>

      <FinalCta />
    </>
  );
}
