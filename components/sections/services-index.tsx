import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { services } from "@/lib/site";

/** Editorial numbered index of services — each row links to its detail page. */
export function ServicesIndex() {
  return (
    <div className="mt-14 border-t border-line">
      {services.map((s) => (
        <Link
          key={s.slug}
          href={`/services/${s.slug}`}
          className="group grid grid-cols-12 items-baseline gap-3 border-b border-line py-6 transition-colors sm:py-7"
        >
          <span className="col-span-2 font-mono text-xs text-ink-muted sm:col-span-1">
            {s.index}
          </span>
          <span className="col-span-9 font-display text-2xl font-medium text-ink transition-colors duration-300 group-hover:text-terracotta sm:col-span-6 sm:text-3xl">
            {s.title}
          </span>
          <span className="col-span-12 mt-1 text-sm text-ink-soft sm:col-span-4 sm:mt-0">
            {s.tagline}
          </span>
          <span className="col-span-1 hidden justify-self-end text-ink-muted transition-colors group-hover:text-terracotta sm:flex">
            <ArrowUpRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </Link>
      ))}
    </div>
  );
}
