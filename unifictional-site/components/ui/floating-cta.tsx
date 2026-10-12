"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { BookCall } from "@/components/ui/button";

/** Any element carrying this attribute hides the pill while it's on screen.
 *  (Server components write the literal attribute — importing a constant from
 *  a "use client" module into them would yield a client reference, not a
 *  string.) */
const HIDE_FLOATING_CTA = "data-hide-floating-cta";

/**
 * Floating "Book a call" pill. The header (and its CTA) deliberately slides
 * away once you scroll, so this keeps the one conversion action reachable
 * mid-page without bringing the header back. Hidden at the top (the header has
 * it), on /contact (you're already there), under the mobile menu (z-30), and
 * whenever a section with its own Book-a-call (the closing CTA) or the footer
 * is on screen — so it never stacks on a duplicate button or covers the
 * footer links.
 */
export function FloatingCta() {
  const pathname = usePathname() ?? "/";
  const [scrolled, setScrolled] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      // Same hysteresis band as the header hide, so they hand off cleanly.
      setScrolled((s) => (y > 90 ? true : y < 40 ? false : s));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        setBlocked(visible.size > 0);
      },
      // Start hiding a little before the section reaches the pill's spot.
      { rootMargin: "0px 0px -40px 0px" }
    );
    // Wait a frame so the new route's sections are in the DOM.
    const raf = requestAnimationFrame(() => {
      document.querySelectorAll(`[${HIDE_FLOATING_CTA}]`).forEach((el) => io.observe(el));
    });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      setBlocked(false);
    };
  }, [pathname]);

  if (pathname.startsWith("/contact") || pathname.startsWith("/builds") || pathname.startsWith("/preview")) return null;

  const shown = scrolled && !blocked;

  return (
    <div
      inert={!shown || undefined}
      aria-hidden={!shown || undefined}
      className={cn(
        "fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 transition-all duration-300 ease-out sm:bottom-7 sm:right-7",
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-5 opacity-0"
      )}
    >
      <BookCall variant="solid" size="default" className="shadow-[0_12px_32px_-10px_rgba(0,0,0,0.55)]" />
    </div>
  );
}
