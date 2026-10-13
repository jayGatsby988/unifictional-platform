import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small mono label, like an annotation on an architectural drawing.
 * Optional index ("01") sits in terracotta before a short rule.
 */
export function Eyebrow({
  index,
  children,
  className,
  tone = "muted",
}: {
  index?: string;
  children: React.ReactNode;
  className?: string;
  tone?: "muted" | "accent" | "bone";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-label",
        tone === "accent" && "text-terracotta",
        tone === "muted" && "text-ink-muted",
        tone === "bone" && "text-bone/70",
        className
      )}
    >
      {index ? (
        <>
          <span className={tone === "bone" ? "text-bone" : "text-terracotta"}>{index}</span>
          <span aria-hidden className="h-px w-7 bg-current opacity-30" />
        </>
      ) : null}
      <span>{children}</span>
    </span>
  );
}
