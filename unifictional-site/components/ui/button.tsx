import * as React from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { BOOKING_URL, CONTACT_PATH, STUDIO_URL } from "@/lib/site";

type Variant = "solid" | "outline" | "link" | "bone" | "light" | "accent";
type Size = "default" | "lg";

const sizeClasses: Record<Size, string> = {
  default: "px-6 py-3 text-sm",
  lg: "px-8 py-4 text-[0.95rem]",
};

/*
 * GLASS BUTTONS — a crisp, near-opaque surface with a glassy top rim and a
 * soft lift. (The earlier SVG-displacement "liquid" layer is gone: iOS Safari
 * ignores `backdrop-filter: url()`, so on phones the primary CTA rendered as a
 * flat 55%-grey pill that read as disabled, and the inset "refractive edge"
 * showed as a black crescent on light buttons.)
 *   • solid   → primary: ink on the page (black in light mode, white in dark)
 *   • bone    → for bg-ink sections/headers: inverts with them, so it always
 *               contrasts with the surface it sits on
 *   • light   → fixed white, for over always-dark photography (the hero)
 *   • outline → secondary: hairline ring, adapts to theme
 */
const textClass: Record<Variant, string> = {
  solid: "text-bone",
  bone: "text-ink",
  light: "text-inkfixed",
  outline: "text-ink",
  link: "text-ink hover:text-terracotta",
  accent: "text-inkfixed",
};

/** Surface layer (tint + rim + lift) per variant. */
const surfaceClass: Record<Variant, string> = {
  solid:
    "bg-ink shadow-btn ring-1 ring-inset ring-bone/15 transition-colors group-hover:bg-ink/90",
  bone: "bg-bone shadow-btn ring-1 ring-inset ring-ink/10 transition-colors group-hover:bg-bone/90",
  light:
    "bg-white/95 shadow-btn-light ring-1 ring-inset ring-black/5 transition-colors group-hover:bg-white",
  outline:
    "bg-bone/40 ring-1 ring-inset ring-ink/20 backdrop-blur-sm transition-colors group-hover:bg-ink/[0.05] group-hover:ring-ink/35",
  link: "",
  // accent → the one coloured pill on the site: the 3D studio's gold, the thing a visitor can use right now
  accent: "bg-studio shadow-btn ring-1 ring-inset ring-black/10 transition-colors group-hover:bg-studio/90",
};

const base =
  "group inline-flex items-center justify-center gap-2 font-sans font-medium transition-transform duration-300";

export interface CtaButtonProps {
  children: React.ReactNode;
  href: string;
  external?: boolean;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon | "arrow" | "up-right" | null;
  className?: string;
  ariaLabel?: string;
}

export function CtaButton({
  children,
  href,
  external = false,
  variant = "solid",
  size = "default",
  icon = "arrow",
  className,
  ariaLabel,
}: CtaButtonProps) {
  const isExternal = external || /^https?:\/\//.test(href);
  const isLink = variant === "link";
  const cls = cn(
    base,
    "outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bone",
    isLink
      ? cn(textClass.link, "-my-2 py-2")
      : cn(
          "relative isolate rounded-full",
          sizeClasses[size],
          textClass[variant]
        ),
    className
  );

  const IconEl =
    icon === null ? null : icon === "arrow" ? (
      <ArrowRight className="size-4 will-change-transform transition-transform duration-300 group-hover:translate-x-0.5" />
    ) : icon === "up-right" ? (
      <ArrowUpRight className="size-4 will-change-transform transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    ) : (
      React.createElement(icon, { className: "size-4" })
    );

  const content = isLink ? (
    <>
      <span>{children}</span>
      {IconEl}
    </>
  ) : (
    <>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 -z-10 rounded-full",
          surfaceClass[variant]
        )}
      />
      <span className="relative inline-flex items-center gap-2">
        {children}
        {IconEl}
      </span>
    </>
  );

  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        className={cls}
      >
        {content}
      </a>
    );
  }
  return (
    <Link href={href} aria-label={ariaLabel} className={cls}>
      {content}
    </Link>
  );
}

/** The studio's primary CTA — external booking URL when set, else /contact. */
export function BookCall({
  label = "Book a call",
  variant = "solid",
  size = "default",
  className,
  icon = "arrow",
}: {
  label?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  icon?: CtaButtonProps["icon"];
}) {
  const hasUrl = BOOKING_URL.length > 0;
  return (
    <CtaButton
      href={hasUrl ? BOOKING_URL : CONTACT_PATH}
      external={hasUrl}
      variant={variant}
      size={size}
      icon={icon}
      className={className}
      ariaLabel={label}
    >
      {label}
    </CtaButton>
  );
}

/** Where the self-serve product lives: the Client Portal's sign-up, which lands on the SEO Autopilot plan builder. */
export const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL || "https://unifictional-client-portal.vercel.app").replace(/\/+$/, "");

/** The 3D Remodel Studio: the one thing on the site a visitor can use this minute, so it gets the accent pill. */
export function StudioCta({
  label = "Try the 3D studio",
  variant = "accent",
  size = "default",
  className,
  icon = "up-right",
}: {
  label?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  icon?: CtaButtonProps["icon"];
}) {
  return (
    <CtaButton href={STUDIO_URL} external variant={variant} size={size} icon={icon} className={className} ariaLabel={label}>
      {label}
    </CtaButton>
  );
}

/** The self-serve CTA: no call, no form, straight into the plan builder. */
export function StartAutopilot({
  label = "Start SEO Autopilot",
  variant = "solid",
  size = "default",
  className,
  icon = "up-right",
}: {
  label?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  icon?: CtaButtonProps["icon"];
}) {
  return (
    <CtaButton href={`${PORTAL_URL}/signup`} external variant={variant} size={size} icon={icon} className={className} ariaLabel={label}>
      {label}
    </CtaButton>
  );
}
