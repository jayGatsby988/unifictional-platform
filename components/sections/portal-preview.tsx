import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Reveal } from "@/components/ui/reveal";
import { BookCall, CtaButton } from "@/components/ui/button";
import { PortalMock } from "@/components/ui/portal-mock";
import { PORTAL_PREVIEW_URL } from "@/lib/site";

/** The portal, with the preview button. Dark section (bg-ink flips with the theme). */
export function PortalPreview() {
  return (
    <section id="portal" className="scroll-mt-16 border-t border-line bg-ink py-24 sm:py-32">
      <Container>
        <Reveal>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading
              onDark
              eyebrow="The portal"
              title={
                <>
                  See what your marketing is doing. Every day,{" "}
                  <em className="italic">not every month.</em>
                </>
              }
              intro="Leads, visits, Google clicks, Instagram reach, uptime, and every quote a homeowner generated — with its status, and your pricing editor beside it. Open to every client from day one."
            />
            <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-center">
              <CtaButton href={PORTAL_PREVIEW_URL} external variant="bone" size="lg" icon="up-right">
                Preview the portal
              </CtaButton>
              <BookCall
                variant="link"
                icon="arrow"
                className="text-bone/80 hover:text-bone"
              />
            </div>
          </div>
        </Reveal>

        <Reveal delay={120} className="mt-16">
          <PortalMock className="mx-auto max-w-5xl" />
        </Reveal>
      </Container>
    </section>
  );
}
