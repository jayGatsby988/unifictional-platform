import Image from "next/image";

import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { CtaButton } from "@/components/ui/button";
import { STUDIO_HOME, STUDIO_URL } from "@/lib/site";

/**
 * The 3D Remodel Studio, front and centre: the one thing on the home page a
 * visitor can use right now without talking to anyone. Sits straight after
 * the hero so nobody has to scroll to find it.
 */
export function StudioFeature() {
  return (
    <section id="studio" className="relative overflow-hidden border-t border-line bg-ink text-bone">
      {/* soft terracotta glow behind the frame */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/2 size-[42rem] -translate-y-1/2 rounded-full bg-studio/20 blur-3xl"
      />
      <Container className="relative z-10 py-24 sm:py-32">
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
          <Reveal className="flex flex-col items-start gap-7 lg:col-span-6">
            <Eyebrow tone="bone" className="text-studio">
              New · Free to try
            </Eyebrow>
            <h2 className="font-display text-5xl font-medium leading-[1.02] tracking-[-0.015em] sm:text-6xl md:text-7xl">
              See the remodel{" "}
              <em className="italic text-studio">before</em> you build it.
            </h2>
            <p className="max-w-prose text-lg leading-relaxed text-bone/75">
              Upload one photo of a kitchen, bathroom or exterior. The 3D Remodel Studio turns it
              into a 3D twin, redesigns it live, and prices the work as you change it. Two free scans,
              no account, no call.
            </p>
            <ul className="flex flex-wrap gap-2 text-sm text-bone/80">
              {["2 free scans", "Kitchen · Bath · Exterior · Floor plan", "Priced line by line", "Photoreal render"].map((t) => (
                <li key={t} className="rounded-full border border-bone/20 bg-bone/5 px-3.5 py-1.5">
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
              <CtaButton href={STUDIO_URL} external variant="accent" size="lg" icon="up-right">
                Open the 3D studio
              </CtaButton>
              <CtaButton href={STUDIO_HOME} variant="link" size="lg" icon="arrow" className="text-bone hover:text-studio">
                How it works
              </CtaButton>
            </div>
          </Reveal>

          <Reveal className="lg:col-span-6">
            <a
              href={STUDIO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the 3D Remodel Studio"
              className="group block"
            >
              <div className="relative overflow-hidden rounded-2xl border border-bone/15 bg-bone/5 shadow-2xl shadow-black/40 transition-transform duration-500 will-change-transform group-hover:-translate-y-1 lg:rotate-[-1.5deg] lg:group-hover:rotate-0">
                <Image
                  src="/studio-preview.png"
                  alt="The 3D Remodel Studio: a kitchen photo turned into a 3D model with a live estimate beside it"
                  width={1600}
                  height={1000}
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  className="block h-auto w-full"
                  priority={false}
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-ink/90 to-transparent px-5 py-4 text-sm">
                  <span className="font-medium">3d.unifictional.com</span>
                  <span className="rounded-full bg-studio px-3 py-1 text-xs font-medium text-inkfixed">Try it free →</span>
                </div>
              </div>
            </a>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
