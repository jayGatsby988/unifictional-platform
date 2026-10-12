"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Moon, Sun } from "lucide-react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";

export type ThemeTransitionType = "horizontal" | "vertical";

type AnimatedThemeToggleButtonProps = {
  type: ThemeTransitionType;
  className?: string;
  /**
   * Sitting on a dark surface (the nav over a hero): "fixed" = the always-black
   * cinematic hero (white glyph in both themes); "themed" = a bg-ink header that
   * inverts with the theme. Matches the adjacent menu button's treatment.
   */
  onDark?: "fixed" | "themed";
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> };
};

function isDarkNow() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark"
  );
}

function useThemeState() {
  // Start deterministically (false) so SSR and the first client render agree —
  // the real value is read from the DOM in the mount effect below.
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    // Apply the saved theme on mount (guarantees persistence across reloads,
    // even if the pre-paint head script didn't run in this environment).
    try {
      // Default to light — only switch to dark if the user explicitly chose it.
      const isDark = localStorage.getItem("theme") === "dark";
      document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
      setDarkMode(isDark);
    } catch {
      setDarkMode(isDarkNow());
    }
    const sync = () => setDarkMode(isDarkNow());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return [darkMode, setDarkMode] as const;
}

function triggerThemeTransition(type: ThemeTransitionType) {
  const clipPath =
    type === "horizontal"
      ? ["inset(50% 0 50% 0)", "inset(0 0 0 0)"]
      : ["inset(0 50% 0 50%)", "inset(0 0 0 0)"];
  document.documentElement.animate(
    { clipPath },
    {
      duration: 700,
      easing: "ease-in-out",
      pseudoElement: "::view-transition-new(root)",
    }
  );
}

export const AnimatedThemeToggleButton = ({
  type,
  className,
  onDark,
}: AnimatedThemeToggleButtonProps) => {
  const glyph =
    onDark === "fixed" ? "text-bonefixed" : onDark === "themed" ? "text-bone" : undefined;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [darkMode, setDarkMode] = useThemeState();

  const handleToggle = useCallback(async () => {
    if (!buttonRef.current) return;

    const apply = () => {
      flushSync(() => {
        const toggled = !darkMode;
        setDarkMode(toggled);
        document.documentElement.setAttribute("data-theme", toggled ? "dark" : "light");
        try {
          localStorage.setItem("theme", toggled ? "dark" : "light");
        } catch {
          /* ignore */
        }
      });
    };

    const doc = document as DocumentWithViewTransition;
    // Fall back gracefully where the View Transitions API isn't available.
    if (typeof doc.startViewTransition !== "function") {
      apply();
      return;
    }

    try {
      await doc.startViewTransition(apply).ready;
      triggerThemeTransition(type);
    } catch {
      // A rapid re-toggle can abort the transition — the state still applied.
    }
  }, [darkMode, type, setDarkMode]);

  return (
    <button
      ref={buttonRef}
      onClick={handleToggle}
      aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={darkMode}
      type="button"
      className={cn(
        "flex items-center justify-center rounded-full border p-2 outline-none backdrop-blur-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 active:scale-95 active:outline-none",
        onDark === "fixed"
          ? "border-bonefixed/30 bg-bonefixed/10"
          : onDark === "themed"
            ? "border-bone/30 bg-bone/10"
            : "border-line bg-paper/60 shadow-glass-soft",
        className
      )}
      style={{ width: 40, height: 40 }}
    >
      {/* Icon swap: pure CSS (both glyphs stacked, cross-faded + rotated) —
          same motion as before without shipping an animation library on
          every page just for this button. */}
      <span className="relative block h-[18px] w-[18px]">
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 transition-[opacity,transform] duration-300 ease-out",
            darkMode ? "rotate-0 scale-100 opacity-100" : "rotate-[25deg] scale-[0.55] opacity-0",
            glyph ?? "text-terracotta"
          )}
        >
          <Sun className="h-[18px] w-[18px]" />
        </span>
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 transition-[opacity,transform] duration-300 ease-out",
            darkMode ? "-rotate-[25deg] scale-[0.55] opacity-0" : "rotate-0 scale-100 opacity-100",
            glyph ?? "text-ink"
          )}
        >
          <Moon className="h-[18px] w-[18px]" />
        </span>
      </span>
    </button>
  );
};
