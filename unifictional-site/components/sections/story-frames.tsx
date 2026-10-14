import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";

const frame = (i: number) => `/frames/unifictional-v4/frame-${String(i).padStart(3, "0")}.webp`;

/** Last frame of the hero footage — the finished home. */
const LAST_FRAME = 240;

/**
 * Before/after built from the actual hero footage (raw site → finished home).
 * The same arc we build for a brand: from invisible to the obvious choice.
 */
export function StoryFrames() {
  return (
    <section className="bg-ink py-24 sm:py-32">
      <Container>
        <Reveal>
          <Eyebrow index="—" tone="bone">The arc</Eyebrow>
          <h2 className="mt-7 max-w-3xl font-display text-4xl font-medium leading-[1.04] tracking-[-0.01em] text-bone sm:text-5xl md:text-[3.2rem]">
            From the ground up to grand opening.
          </h2>
          <p className="mt-6 max-w-prose text-lg leading-relaxed text-bone/70">
            It&apos;s the same arc we build for your brand — from quietly invisible to the name a
            customer trusts the moment they land on your site.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
          <Reveal>
            <figure>
              <div className="overflow-hidden rounded-sm border border-bone/15">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frame(0)}
                  alt="A raw construction site at sunrise — foundation poured, framing yet to come."
                  className="aspect-[16/10] w-full object-cover"
                  loading="lazy"
                />
              </div>
              <figcaption className="mt-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-label text-bone/50">
                <span><span className="text-bone">01</span> &nbsp;Groundwork</span>
                <span>Sunrise</span>
              </figcaption>
            </figure>
          </Reveal>

          <Reveal delay={120}>
            <figure className="md:mt-16">
              <div className="overflow-hidden rounded-sm border border-bone/15">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frame(LAST_FRAME)}
                  alt="The finished custom home at golden hour, lit and complete."
                  className="aspect-[16/10] w-full object-cover"
                  loading="lazy"
                />
              </div>
              <figcaption className="mt-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-label text-bone/50">
                <span><span className="text-bone">02</span> &nbsp;Grand opening</span>
                <span>Golden hour</span>
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
