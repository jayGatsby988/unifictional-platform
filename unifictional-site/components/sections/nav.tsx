"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { navLinks, newTab, siteConfig } from "@/lib/site";
import { BookCall, StudioCta } from "@/components/ui/button";
import { AnimatedThemeToggleButton } from "@/components/ui/animated-theme-toggle-button";

/** Routes that open on a dark header. The nav starts in its light-on-dark
 *  style there, so on a slow phone the logo and menu button are visible from
 *  the first paint instead of black-on-black until the JavaScript arrives
 *  (the scroll check below takes over once it does). "/" is the always-black
 *  cinematic hero. */
const DARK_HEADER_ROUTES = new Set(["/services", "/industries", "/work", "/guides", "/process", "/about"]);
const startsOverDark = (p: string) => p === "/" || DARK_HEADER_ROUTES.has(p);

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname() ?? "/";
  const [scrolled, setScrolled] = useState(false);
  const [overDark, setOverDark] = useState(() => startsOverDark(pathname));
  const [fixedDark, setFixedDark] = useState(() => pathname === "/"); // over an always-black surface
  const [hidden, setHidden] = useState(false); // slides away once scrolled in
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 16);
      const s = document.getElementById("hero-bottom");
      const over = !!s && s.getBoundingClientRect().top > 56;
      setOverDark(over);
      // The cinematic hero is always black (bg-inkfixed) and tags its sentinel
      // `data-fixed-dark`; interior dark headers use bg-ink, which inverts to a
      // light panel in dark mode — there the nav must use inverting tokens.
      setFixedDark(over && s?.dataset.fixedDark != null);
      // Disappear once you scroll into the page so content takes the space; it
      // only returns near the very top (small hysteresis to avoid flicker).
      if (y > 90) setHidden(true);
      else if (y < 40) setHidden(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  // Close the menu when the route changes: state adjusted during render on a
  // changed input, the React-sanctioned shape (no setState inside an effect).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const dark = overDark && !open; // light-on-dark text over a dark surface
  const solid = open || (!overDark && scrolled);

  // Over the always-black hero use fixed-white type; over the theme-flipping
  // bg-ink interior headers use `bone`, which inverts with the surface so it
  // stays readable in dark mode too.
  const dl = fixedDark
    ? {
        // Over the cinematic hero imagery — a soft shadow keeps white type
        // legible even over the bright sunrise sky at the top of the footage.
        fg: "text-bonefixed [text-shadow:0_1px_16px_rgba(0,0,0,0.55)]",
        dot: "text-bonefixed/60",
        linkActive: "text-bonefixed [text-shadow:0_1px_14px_rgba(0,0,0,0.5)]",
        linkIdle: "text-bonefixed/80 hover:text-bonefixed [text-shadow:0_1px_14px_rgba(0,0,0,0.5)]",
        btn: "border-bonefixed/30 bg-bonefixed/10 text-bonefixed",
      }
    : {
        fg: "text-bone",
        dot: "text-bone/60",
        linkActive: "text-bone",
        linkIdle: "text-bone/75 hover:text-bone",
        btn: "border-bone/30 bg-bone/10 text-bone",
      };

  return (
    <>
      <header
      inert={(hidden && !open) || undefined}
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[transform,background-color,border-color] duration-300",
        hidden && !open ? "-translate-y-full" : "translate-y-0",
        // Opaque while the menu is open so the bar and the panel read as one
        // sheet (a 90% tint let the dark header beneath show through as grey).
        open
          ? "border-b border-line bg-bone"
          : solid
            ? "border-b border-line bg-bone/90 backdrop-blur-md"
            : "border-b border-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6 sm:px-8 lg:px-12">
        <Link
          href="/"
          aria-label={`${siteConfig.name} home`}
          className={cn(
            "-my-2 py-2 font-display text-xl font-medium tracking-tight transition-colors",
            dark ? dl.fg : "text-ink"
          )}
        >
          {siteConfig.name}
          <span className={dark ? dl.dot : "text-ink/50"}>.</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex lg:gap-9" aria-label="Primary">
          {navLinks.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                {...newTab(l.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "py-3 font-sans text-sm transition-colors",
                  dark
                    ? active
                      ? dl.linkActive
                      : dl.linkIdle
                    : active
                      ? "text-terracotta"
                      : "text-ink/70 hover:text-ink"
                )}
              >
                <span className="link-underline">{l.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <AnimatedThemeToggleButton
            type="horizontal"
            onDark={dark ? (fixedDark ? "fixed" : "themed") : undefined}
          />
          <div className="hidden items-center gap-2 md:flex">
            {/* The studio is the one accent pill in the header: it stays terracotta over every surface. */}
            <StudioCta label="Try the 3D studio" size="default" />
            {/* Over the always-black hero the pill is fixed white; over the
                theme-flipping interior headers it inverts with the surface. */}
            <BookCall
              variant={dark ? (fixedDark ? "light" : "bone") : "solid"}
              size="default"
              icon={null}
            />
          </div>

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors md:hidden",
              dark ? dl.btn : "border-ink/20 bg-ink/[0.04] text-ink"
            )}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      </header>

      {/* Mobile menu — opaque panel that slides down (no opacity fade, so page
          content never shows through it while opening or navigating away).
          Closed, it must travel its own height PLUS the 4rem header offset —
          `-translate-y-full` alone left its bottom 64px parked behind the
          header as a solid bar that hid the logo/menu over dark heroes and
          covered content while scrolling. `invisible` (flipped after the
          slide, via the visibility transition) guarantees nothing paints. */}
      <div
        inert={!open || undefined}
        aria-hidden={!open || undefined}
        className={cn(
          "fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto overscroll-contain bg-bone transition-[transform,visibility] duration-300 ease-out md:hidden",
          open
            ? "visible translate-y-0"
            : "pointer-events-none invisible -translate-y-[calc(100%+4rem)]"
        )}
      >
        <div className="flex flex-col gap-1 px-6 py-8">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              {...newTab(l.href)}
              onClick={() => setOpen(false)}
              className="border-b border-line py-4 font-display text-3xl text-ink transition-colors hover:text-terracotta"
            >
              {l.label}
            </Link>
          ))}
          <div className="mt-6 flex flex-col gap-3">
            <StudioCta label="Try the 3D studio — free" size="lg" className="w-full" />
            <BookCall variant="solid" size="lg" className="w-full" />
          </div>
        </div>
      </div>
    </>
  );
}
