import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmt = {
  int: (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n)),
  pct: (n: number, d = 1) => `${n.toFixed(d)}%`,
  compact: (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n),
  delta: (n: number) => (n > 0 ? `+${fmt.int(n)}` : fmt.int(n)),
  date: (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  dateLong: (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
};
