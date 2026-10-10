"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Liquid-glass button — a transparent surface that refracts the background
 * through an SVG turbulence/displacement backdrop filter, framed by a finely
 * tuned refractive edge shadow. Adapted from the supplied component for this
 * project's tokens (the unused shadcn-token `Button`/`MetalButton` exports were
 * trimmed). The reusable bits — `GlassFilter` + the layered structure — also
 * power every CTA via components/ui/button.tsx.
 *
 * Render <GlassFilter /> once in the app (we do it in the root layout) so the
 * "#container-glass" filter exists for every glass surface to reference.
 */
const liquidbuttonVariants = cva(
  "relative inline-flex items-center justify-center cursor-pointer gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-transform duration-300 disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-[3px] focus-visible:ring-terracotta/40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 hover:scale-[1.03] active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-transparent text-ink",
        dark: "bg-[#0d0d10]/55 text-white",
        light: "bg-white/55 text-inkfixed",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-xs",
        lg: "h-12 px-8 text-[0.95rem]",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export type LiquidButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof liquidbuttonVariants> & { asChild?: boolean };

function LiquidButton({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}: LiquidButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="liquid-button"
      className={cn("isolate overflow-hidden", liquidbuttonVariants({ variant, size, className }))}
      {...props}
    >
      {/* refractive edge */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 rounded-full shadow-liquid-edge dark:shadow-liquid-edge-dark"
      />
      {/* liquid distortion of whatever is behind the button */}
      <span
        aria-hidden
        className="absolute inset-0 -z-10 rounded-full"
        style={{
          backdropFilter: 'url("#container-glass")',
          WebkitBackdropFilter: 'url("#container-glass")',
        }}
      />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </Comp>
  );
}

/** The SVG filter that warps the backdrop. Render once, app-wide. */
function GlassFilter() {
  return (
    <svg aria-hidden className="pointer-events-none absolute h-0 w-0">
      <defs>
        <filter id="container-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves={1} seed={1} result="turbulence" />
          <feGaussianBlur in="turbulence" stdDeviation={2} result="blurredNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="blurredNoise"
            scale={70}
            xChannelSelector="R"
            yChannelSelector="B"
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation={4} result="finalBlur" />
          <feComposite in="finalBlur" in2="finalBlur" operator="over" />
        </filter>
      </defs>
    </svg>
  );
}

export { LiquidButton, GlassFilter, liquidbuttonVariants };
