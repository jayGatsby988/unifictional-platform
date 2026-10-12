"use client";

import { useEffect, useState } from "react";

import InkReveal from "@/components/ui/ink-reveal";

/** Mask colour matches the page background per theme, so the un-revealed state
 *  reads as the normal page. Light = gallery white, dark = near-black. */
const MASK: Record<"light" | "dark", [number, number, number]> = {
  light: [255, 255, 255],
  dark: [9, 9, 9],
};

function useTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const read = () =>
      setTheme(
        document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
      );
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/**
 * Full-page background for /process: two architectural images veiled by an ink
 * mask that the visitor wipes away with the cursor. Fixed + pointer-events-none
 * so it sits behind the (transparent) page content without blocking it.
 */
export function ProcessInkBackground() {
  const theme = useTheme();

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-bone"
    >
      {/* the two images, filling the viewport (stacked on mobile, split on desktop) */}
      <div className="absolute inset-0 flex flex-col sm:flex-row">
        {/* WebP copies (generated at build, ~70% smaller) with the JPEGs as
            fallback. */}
        {["bg-1", "bg-2"].map((n) => (
          <picture key={n} className="contents">
            <source srcSet={`/process/${n}.webp`} type="image/webp" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/process/${n}.jpg`}
              alt=""
              decoding="async"
              className="h-1/2 w-full object-cover contrast-[1.03] sm:h-full sm:w-1/2"
            />
          </picture>
        ))}
      </div>

      {/* readability scrim (themed) so revealed areas stay legible under text —
          keeps the photo in colour but light enough for the near-black copy. */}
      <div className="absolute inset-0 bg-bone/55" />

      {/* the ink veil — remounts on theme change so it refills with the new colour */}
      <InkReveal
        key={theme}
        eventSource="window"
        maskColor={MASK[theme]}
        brushSize={150}
        lifetime={750}
        rStart={12}
        stampStep={12}
        maxStamps={120}
      />
    </div>
  );
}
