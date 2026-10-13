import type { Config } from "tailwindcss";

/**
 * Unifictional Studio — monochrome / architectural theme.
 * Gallery white, near-black ink, no colour accent. Condensed grotesque display.
 * A black-and-white, luxury-architecture-monograph feel.
 */
const config: Config = {
  // dark: variants follow our data-theme attribute (used by the liquid edge).
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        // Themed tokens — flip between light/dark via CSS vars (see globals.css).
        bone: "rgb(var(--bone) / <alpha-value>)", // page background
        paper: "rgb(var(--paper) / <alpha-value>)", // raised / alternate surface
        sand: "rgb(var(--sand) / <alpha-value>)", // tints, fills
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)", // primary text + solid buttons
          soft: "rgb(var(--ink-soft) / <alpha-value>)", // secondary text
          muted: "rgb(var(--ink-muted) / <alpha-value>)", // captions / meta
        },
        line: "rgb(var(--line) / <alpha-value>)", // hairlines
        terracotta: {
          DEFAULT: "rgb(var(--terracotta) / <alpha-value>)", // the single accent
          soft: "rgb(var(--terracotta-soft) / <alpha-value>)",
        },
        // The 3D Remodel Studio's gold: the one real colour on the site, used only
        // for the studio's buttons and section so it reads as "the thing to try".
        studio: "rgb(var(--studio) / <alpha-value>)",
        // Fixed tokens — never flip. Used by the always-dark hero/nav-over-hero/
        // footer so their light-on-dark content stays readable in both themes.
        bonefixed: "rgb(255 255 255 / <alpha-value>)",
        inkfixed: "rgb(10 10 10 / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Oswald", "Impact", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        label: "0.22em",
      },
      boxShadow: {
        // Liquid-glass buttons: bright top rim + inner sheen + soft outer glow.
        liquid:
          "inset 0 1px 0 0 rgb(255 255 255 / 0.22), inset 0 0 0 1px rgb(255 255 255 / 0.04), inset 0 -10px 18px -10px rgb(0 0 0 / 0.75), 0 2px 4px rgb(0 0 0 / 0.3), 0 14px 34px -10px rgb(0 0 0 / 0.55)",
        "liquid-hover":
          "inset 0 1px 0 0 rgb(255 255 255 / 0.34), inset 0 0 0 1px rgb(255 255 255 / 0.07), inset 0 -10px 18px -10px rgb(0 0 0 / 0.7), 0 3px 6px rgb(0 0 0 / 0.35), 0 18px 44px -10px rgb(0 0 0 / 0.65)",
        "liquid-light":
          "inset 0 1px 0 0 rgb(255 255 255 / 0.9), inset 0 0 0 1px rgb(255 255 255 / 0.5), inset 0 -8px 14px -8px rgb(0 0 0 / 0.12), 0 2px 4px rgb(0 0 0 / 0.16), 0 14px 34px -10px rgb(0 0 0 / 0.4)",
        // CTA buttons: glassy top rim + soft two-step lift.
        btn: "inset 0 1px 0 0 rgb(255 255 255 / 0.16), 0 1px 2px rgb(0 0 0 / 0.16), 0 10px 24px -12px rgb(0 0 0 / 0.5)",
        "btn-light":
          "inset 0 1px 0 0 rgb(255 255 255 / 0.9), inset 0 -1px 0 0 rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.14), 0 10px 24px -12px rgb(0 0 0 / 0.45)",
        // Soft frosted shadow (secondary / small controls).
        "glass-soft": "inset 0 1px 0 0 rgb(255 255 255 / 0.22)",
        // Refractive "liquid glass" edge (from the liquid-glass-button).
        // Dark-ink insets for light glass surfaces:
        "liquid-edge":
          "0 0 6px rgba(0,0,0,0.03),0 2px 6px rgba(0,0,0,0.08),inset 3px 3px 0.5px -3px rgba(0,0,0,0.9),inset -3px -3px 0.5px -3px rgba(0,0,0,0.85),inset 1px 1px 1px -0.5px rgba(0,0,0,0.6),inset -1px -1px 1px -0.5px rgba(0,0,0,0.6),inset 0 0 6px 6px rgba(0,0,0,0.12),inset 0 0 2px 2px rgba(0,0,0,0.06),0 0 12px rgba(255,255,255,0.15)",
        // White insets for dark glass surfaces:
        "liquid-edge-dark":
          "0 0 8px rgba(0,0,0,0.03),0 2px 6px rgba(0,0,0,0.08),inset 3px 3px 0.5px -3.5px rgba(255,255,255,0.09),inset -3px -3px 0.5px -3.5px rgba(255,255,255,0.85),inset 1px 1px 1px -0.5px rgba(255,255,255,0.6),inset -1px -1px 1px -0.5px rgba(255,255,255,0.6),inset 0 0 6px 6px rgba(255,255,255,0.12),inset 0 0 2px 2px rgba(255,255,255,0.06),0 0 12px rgba(0,0,0,0.15)",
      },
      maxWidth: {
        prose: "38rem",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "draw-line": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
      },
      animation: {
        rise: "rise 0.9s cubic-bezier(0.22,1,0.36,1) both",
        "fade-in": "fade-in 1.2s ease-out both",
        "draw-line": "draw-line 1s cubic-bezier(0.22,1,0.36,1) both",
        marquee: "marquee 38s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
