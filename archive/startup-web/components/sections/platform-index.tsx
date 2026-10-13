import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { platformParts } from "@/lib/site";

/** Editorial numbered index of the four parts of the platform. */
export function PlatformIndex() {
  return (
    <div className="mt-14 border-t border-line">
      {platformParts.map((p) => {
        const cls =
          "group grid grid-cols-12 items-baseline gap-3 border-b border-line py-7 transition-colors sm:py-8";
        const inner = (
          <>
            <span className="col-span-2 font-mono text-xs text-ink-muted sm:col-span-1">{p.index}</span>
            <span className="col-span-9 sm:col-span-4">
              <span className="block font-display text-2xl font-medium text-ink transition-colors duration-300 group-hover:text-terracotta sm:text-3xl">
                {p.title}
              </span>
              <span className="mt-1 block text-sm text-ink-soft">{p.tagline}</span>
            </span>
            <span className="col-span-12 mt-2 text-base leading-relaxed text-ink-soft sm:col-span-6 sm:mt-0">
              {p.body}
            </span>
            <span className="col-span-1 hidden justify-self-end text-ink-muted transition-colors group-hover:text-terracotta sm:flex">
              <ArrowUpRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </>
        );
        return p.external ? (
          <a key={p.index} href={p.href} target="_blank" rel="noopener noreferrer" className={cls}>
            {inner}
          </a>
        ) : (
          <Link key={p.index} href={p.href} className={cls}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
