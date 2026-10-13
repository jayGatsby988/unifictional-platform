import { Container } from "@/components/ui/container";
import { BookCall, CtaButton } from "@/components/ui/button";
import { PortalMock } from "@/components/ui/portal-mock";
import { PORTAL_PREVIEW_URL, siteConfig } from "@/lib/site";

/**
 * The opening act — product-led. Always black (bg-inkfixed) like the old
 * cinematic hero so the nav keeps fixed-white type over it; a faint drafting
 * grid stands in for the drone footage. Above-the-fold entrances are CSS
 * mount animations (animate-rise), not scroll-driven.
 */
export function PlatformHero() {
  return (
    <section className="relative overflow-hidden bg-inkfixed text-bonefixed" aria-label="Introduction">
      {/* Drafting grid, faded toward the edges. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:radial-gradient(ellipse_at_70%_40%,black_20%,transparent_72%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-inkfixed via-transparent to-inkfixed/60"
      />

      <div className="relative flex min-h-[100svh] flex-col justify-between pb-10 pt-24 sm:pb-12 sm:pt-28">
        <Container className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-label text-bonefixed/70">
            {siteConfig.name} · Platform
          </span>
          <span className="hidden font-mono text-[11px] uppercase tracking-label text-bonefixed/50 sm:inline">
            Built for contractors
          </span>
        </Container>

        <Container className="py-12 lg:py-16">
          <div className="grid grid-cols-12 items-center gap-y-12 lg:gap-x-10">
            <div className="col-span-12 lg:col-span-6">
              <span className="block animate-rise font-mono text-[11px] uppercase tracking-label text-bonefixed/70">
                {siteConfig.discipline}
              </span>
              <h1 className="anim-delay-1 mt-6 animate-rise font-display text-[2.9rem] font-medium leading-[1.0] tracking-[-0.015em] text-bonefixed sm:text-6xl md:text-7xl">
                The website that quotes the job.
              </h1>
              <p className="anim-delay-2 mt-6 max-w-xl animate-rise text-base leading-relaxed text-bonefixed/80 sm:text-lg">
                A premium contractor site with a 3D instant-quote tool built in, the search and
                social that feed it, and one portal where you watch all of it turn into booked work.
              </p>
              <div className="anim-delay-3 mt-9 flex animate-rise flex-col gap-4 sm:flex-row sm:items-center">
                <BookCall variant="bone" size="lg" />
                <CtaButton
                  href={PORTAL_PREVIEW_URL}
                  external
                  variant="link"
                  icon="up-right"
                  className="text-bonefixed/85 hover:text-bonefixed"
                >
                  Preview the portal
                </CtaButton>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-6">
              <div className="anim-delay-2 animate-rise lg:[perspective:1600px]">
                <PortalMock
                  fixed
                  className="lg:[transform:rotateY(-7deg)_rotateX(2deg)] lg:transition-transform lg:duration-700 lg:hover:[transform:rotateY(0deg)_rotateX(0deg)]"
                />
              </div>
            </div>
          </div>
        </Container>

        <Container className="flex items-end justify-between">
          <span className="font-mono text-[11px] uppercase tracking-label text-bonefixed/60">
            Scroll ↓
          </span>
          <span className="hidden font-mono text-[11px] uppercase tracking-label text-bonefixed/40 sm:inline">
            Quote → Lead → Booked job
          </span>
        </Container>
      </div>

      {/* Sentinel: where the black hero hands off to the page (the nav reads it).
          data-fixed-dark = always black, so the nav keeps fixed-white type. */}
      <div id="hero-bottom" aria-hidden data-fixed-dark="" className="absolute left-0" style={{ top: "86%" }} />
    </section>
  );
}
