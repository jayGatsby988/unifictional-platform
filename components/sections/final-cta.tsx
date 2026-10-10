import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { BookCall, CtaButton } from "@/components/ui/button";

/** The closing prompt above the footer on every page. */
export function FinalCta({
  eyebrow = "Start here",
  title = (
    <>
      Let&apos;s make your website the one that{" "}
      <em className="italic text-terracotta">quotes the job.</em>
    </>
  ),
  body = "Book a short, no-pressure call. We'll look at your site, your market, and what an instant-quote tool would do for your pipeline — whether or not we end up working together.",
}: {
  eyebrow?: string;
  title?: React.ReactNode;
  body?: React.ReactNode;
}) {
  return (
    <section data-hide-floating-cta="" className="border-t border-line bg-sand/60">
      <Container className="py-24 sm:py-32">
        <Reveal className="flex flex-col items-start gap-7">
          <Eyebrow tone="accent">{eyebrow}</Eyebrow>
          <h2 className="max-w-3xl font-display text-4xl font-medium leading-[1.04] tracking-[-0.01em] text-ink sm:text-5xl md:text-6xl">
            {title}
          </h2>
          <p className="max-w-prose text-lg leading-relaxed text-ink-soft">{body}</p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row">
            <BookCall variant="solid" size="lg" />
            <CtaButton href="/work" variant="outline" size="lg" icon="up-right">
              See the work
            </CtaButton>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
