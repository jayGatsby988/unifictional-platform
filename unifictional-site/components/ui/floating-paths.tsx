"use client";

import React, { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** The base swoosh, translated by (ox, oy) so copies spread across the width. */
function swoosh(ox: number, oy: number) {
  return `M${-380 + ox} ${-189 + oy}C${-380 + ox} ${-189 + oy} ${-312 + ox} ${
    216 + oy
  } ${152 + ox} ${343 + oy}C${616 + ox} ${470 + oy} ${684 + ox} ${875 + oy} ${
    684 + ox
  } ${875 + oy}`;
}

/**
 * One single, full-size field of drifting curves spread across the width — not
 * tiled. The SVG stretches (preserveAspectRatio="none") to exactly fill its
 * container, so the lines run the full height of whatever section it backs.
 */
function PathField({ strokeScale }: { strokeScale: number }) {
  const N = 26;
  const paths = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    const ox = -130 + t * 780 + (i % 3) * 14; // distribute left → right
    const oy = (i % 5) * 14 - 28;
    return { key: i, d: swoosh(ox, oy), width: 0.5 + (i % 6) * 0.12 };
  });

  return (
    <svg
      className="h-full w-full text-ink"
      viewBox="0 0 696 316"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* Same drift as before (dash grows 0.3→1 while it slides along the
          curve and back, opacity breathing 0.4→0.7→0.4), now as native CSS
          keyframes (globals.css `fp-drift`) instead of 26 JS-driven
          animations recalculated every frame. */}
      {paths.map((p) => (
        <path
          key={p.key}
          d={p.d}
          pathLength={1}
          className="fp-path"
          stroke="currentColor"
          strokeWidth={p.width * strokeScale}
          strokeOpacity={0.16 + (p.key % 6) * 0.06}
          style={{ animationDuration: `${22 + (p.key % 12)}s` }}
        />
      ))}
    </svg>
  );
}

/**
 * Animated "flowing paths" backdrop rendered behind `children`. Colour follows
 * the theme (`text-ink`).
 */
export function FloatingPathsBackground({
  children,
  className,
  strokeScale = 1,
}: {
  position?: number;
  tiles?: number;
  /** Multiplier on the line thickness (1 = default). */
  strokeScale?: number;
  className?: string;
  children: React.ReactNode;
}) {
  // Only animate while the section is actually on screen.
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setInView(true);
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      rootMargin: "100px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <div
        data-paused={inView ? undefined : ""}
        className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block"
      >
        <PathField strokeScale={strokeScale} />
      </div>
      {children}
    </div>
  );
}
