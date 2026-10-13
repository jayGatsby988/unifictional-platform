import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/ui/reveal";
import { CtaButton } from "@/components/ui/button";
import { QuoteMock } from "@/components/ui/portal-mock";
import { PORTAL_PREVIEW_URL, quoteSteps } from "@/lib/site";

/** How the instant-quote tool works — the homeowner's three steps, and who sets the numbers. */
export function QuoteFlow() {
  return (
    <section id="quote-tool" className="scroll-mt-16 border-t border-line bg-paper py-24 sm:py-32">
      <Container>
        <div className="grid grid-cols-12 gap-y-14 lg:gap-x-12">
          <div className="col-span-12 lg:col-span-5">
            <Reveal>
              <SectionHeading
                eyebrow="The quote tool"
                title={
                  <>
                    A homeowner prices the job in three minutes.{" "}
                    <em className="italic text-terracotta">You set every number.</em>
                  </>
                }
              />
            </Reveal>

            <div className="mt-12 border-t border-line">
              {quoteSteps.map((s, i) => (
                <Reveal key={s.index} delay={i * 70}>
                  <div className="grid grid-cols-12 gap-4 border-b border-line py-6">
                    <span className="col-span-2 font-mono text-xs text-terracotta sm:col-span-1">{s.index}</span>
                    <div className="col-span-10 sm:col-span-11">
                      <h3 className="font-display text-xl font-medium text-ink sm:text-2xl">{s.title}</h3>
                      <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-soft">{s.body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={240}>
              <p className="mt-8 max-w-prose text-sm leading-relaxed text-ink-muted">
                Rates per unit, minimums, add-ons, markup, the plus-or-minus range, and deposit
                terms all live in your portal&apos;s pricing editor. Change a number and the tool on
                your site updates instantly.
              </p>
              <div className="mt-6">
                <CtaButton href={PORTAL_PREVIEW_URL} external variant="link" icon="up-right">
                  See the pricing editor in the portal
                </CtaButton>
              </div>
            </Reveal>
          </div>

          <div className="col-span-12 lg:col-span-7 lg:self-center">
            <Reveal delay={120}>
              <QuoteMock />
            </Reveal>
          </div>
        </div>
      </Container>
    </section>
  );
}
