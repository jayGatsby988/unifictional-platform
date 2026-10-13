import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { services } from "@/lib/site";

/**
 * Services cards. On desktop they flip on hover (pure CSS, no JS) to reveal the
 * detail. Hover doesn't exist on touch, so phones get a clean static card with
 * everything visible. The whole card links to the detail page either way.
 */
export function ServicesGrid() {
  return (
    <div className="mt-12 grid grid-cols-1 gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
      {services.map((s) => {
        const Icon = s.icon;
        return (
          <Link
            key={s.slug}
            href={`/services/${s.slug}`}
            aria-label={`${s.title} — explore`}
            className="block"
          >
            {/* Mobile / touch: static info card, auto height, nothing hidden. */}
            <div className="flex flex-col rounded-xl border border-line bg-paper p-6 lg:hidden">
              <div className="flex items-start justify-between">
                <span className="font-mono text-xs text-ink-muted">{s.index}</span>
                <Icon className="h-5 w-5 text-ink-muted" />
              </div>
              <h3 className="mt-5 font-display text-2xl font-medium leading-[1.05] text-ink">
                {s.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">{s.description}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                Explore
                <ArrowUpRight className="h-4 w-4 text-terracotta" />
              </span>
            </div>

            {/* Desktop: flip card. */}
            <div className="group hidden h-72 [perspective:1400px] lg:block">
              <div className="relative h-full w-full transition-transform duration-700 ease-[cubic-bezier(0.4,0.2,0.2,1)] [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]">
                {/* Front */}
                <div className="absolute inset-0 flex flex-col justify-between rounded-xl border border-line bg-paper p-6 [backface-visibility:hidden]">
                  <div className="flex items-start justify-between">
                    <span className="font-mono text-xs text-ink-muted">{s.index}</span>
                    <Icon className="h-5 w-5 text-ink-muted" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-medium leading-[1.05] text-ink sm:text-2xl">
                      {s.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-ink-soft">{s.tagline}</p>
                  </div>
                </div>

                {/* Back */}
                <div className="absolute inset-0 flex flex-col justify-between rounded-xl bg-ink p-6 text-bone [transform:rotateY(180deg)] [backface-visibility:hidden]">
                  <div>
                    <span className="font-mono text-xs text-bone/50">{s.index}</span>
                    <p className="mt-4 text-sm leading-relaxed text-bone/85">{s.description}</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-bone">
                    Explore
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
