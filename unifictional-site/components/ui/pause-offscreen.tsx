"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wraps always-running CSS animations and pauses them while the block is
 * off screen (`data-paused` + `animation-play-state` in globals.css), so a
 * ticker two screens up is not costing compositor time while someone reads
 * or hovers the content below it.
 */
export function PauseOffscreen({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} data-paused={inView ? undefined : ""} className={className}>
      {children}
    </div>
  );
}
