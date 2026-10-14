'use client';
/**
 * MANHATTAN marketing landing page. Sections are client components (they
 * animate) but render full HTML on the server; heavy WebGL loads lazily.
 *
 * Colour follows unifictional.com: the body is light (`.lp-light`), while the
 * hero, the clip banner, pricing and the footer are black (`.lp-dark`).
 */
import 'lenis/dist/lenis.css';
import './landing.css';
import { ClipTextBanner } from './ClipTextBanner';
import { FAQ } from './FAQ';
import { FinalCta } from './FinalCta';
import { Footer } from './Footer';
import { ForContractors } from './ForContractors';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { LivePriceDemo } from './LivePriceDemo';
import { MaterialsSection } from './Materials';
import { Nav } from './Nav';
import { Pricing } from './Pricing';
import { RoomTypes } from './RoomTypes';
import { SmoothScroll } from './SmoothScroll';

export function Landing() {
  return (
    <SmoothScroll>
      <div className="lp lp-light min-h-screen bg-bg text-ink">
        <Nav />
        <main>
          <Hero />
          <ClipTextBanner />
          <HowItWorks />
          <MaterialsSection />
          <LivePriceDemo />
          <RoomTypes />
          <ForContractors />
          <Pricing />
          <FAQ />
          <FinalCta />
        </main>
        <Footer />
      </div>
    </SmoothScroll>
  );
}
