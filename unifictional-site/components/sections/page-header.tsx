import * as React from "react";

import { cn } from "@/lib/utils";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * Interior page hero. Mount-based CSS entrance (animate-rise) so it never
 * depends on scroll-into-view — it's already in view.
 */
export function PageHeader({
  index,
  eyebrow,
  title,
  intro,
  children,
  transparent = false,
  dark = false,
}: {
  index?: string;
  eyebrow?: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  children?: React.ReactNode;
  /** Drop the opaque background so a page-level backdrop shows through. */
  transparent?: boolean;
  /** Black header with light type (inverts in dark mode). */
  dark?: boolean;
}) {
  return (
    <header
      className={cn(
        "relative border-b pb-16 pt-36 sm:pb-20 sm:pt-44",
        dark
          ? "border-bone/15 bg-ink"
          : cn("border-line", transparent ? "bg-transparent" : "bg-bone")
      )}
    >
      {/* Sentinel so the nav switches to light text while over this black header. */}
      {dark ? (
        <span id="hero-bottom" aria-hidden className="pointer-events-none absolute bottom-0 left-0" />
      ) : null}
      <Container>
        <div className="animate-rise">
          {eyebrow ? (
            <Eyebrow index={index} tone={dark ? "bone" : "muted"}>
              {eyebrow}
            </Eyebrow>
          ) : null}
          <h1
            className={cn(
              "mt-7 max-w-5xl text-balance font-display text-5xl font-medium leading-[1.0] tracking-[-0.02em] sm:text-6xl md:text-7xl",
              dark ? "text-bone [&_em]:text-bone" : "text-ink"
            )}
          >
            {title}
          </h1>
          {intro ? (
            <p
              className={cn(
                "mt-7 max-w-2xl text-lg leading-relaxed sm:text-xl",
                dark ? "text-bone/70" : "text-ink-soft"
              )}
            >
              {intro}
            </p>
          ) : null}
          {children ? <div className="mt-9 flex flex-col gap-4 sm:flex-row">{children}</div> : null}
        </div>
      </Container>
    </header>
  );
}
