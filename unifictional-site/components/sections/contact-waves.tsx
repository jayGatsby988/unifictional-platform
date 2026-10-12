"use client";

import { useEffect, useState } from "react";

import { Waves } from "@/components/ui/waves";

/**
 * Full-viewport animated wave background for the booking page. Re-colours to
 * match the active theme (it re-mounts the canvas on theme change so the new
 * stroke/background take effect). pointer-events-none so the form stays usable.
 */
export function ContactWaves() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const read = () => setDark(document.documentElement.getAttribute("data-theme") === "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <Waves
        key={dark ? "dark" : "light"}
        backgroundColor={dark ? "#15120E" : "#F4F1EA"}
        strokeColor={dark ? "rgba(237,230,218,0.13)" : "rgba(26,23,20,0.13)"}
        pointerSize={0.4}
      />
      {/* fade the waves into the page edges so the content reads cleanly */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 30%, transparent 40%, rgb(var(--bone)) 100%)",
        }}
      />
    </div>
  );
}
