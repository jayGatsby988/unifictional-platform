import * as React from "react";

import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/eyebrow";

/** Eyebrow + big serif title + optional intro. The recurring section opener. */
export function SectionHeading({
  index,
  eyebrow,
  title,
  intro,
  align = "left",
  onDark = false,
  className,
}: {
  index?: string;
  eyebrow?: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  align?: "left" | "center";
  /** Light text for use on a dark/black section. */
  onDark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6",
        align === "center" && "items-center text-center",
        className
      )}
    >
      {eyebrow ? (
        <Eyebrow index={index} tone={onDark ? "bone" : "muted"}>
          {eyebrow}
        </Eyebrow>
      ) : null}
      <h2
        className={cn(
          "max-w-3xl font-display text-4xl font-medium leading-[1.04] tracking-[-0.01em] sm:text-5xl md:text-[3.4rem]",
          onDark ? "text-bone" : "text-ink"
        )}
      >
        {title}
      </h2>
      {intro ? (
        <p
          className={cn(
            "max-w-prose text-lg leading-relaxed",
            onDark ? "text-bone/70" : "text-ink-soft",
            align === "center" && "mx-auto"
          )}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}
