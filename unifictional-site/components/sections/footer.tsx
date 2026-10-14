import Link from "next/link";

import { Container } from "@/components/ui/container";
import { footerNav, siteConfig } from "@/lib/site";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer data-hide-floating-cta="" className="bg-inkfixed text-bonefixed">
      <Container className="py-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-4">
            <Link href="/" className="font-display text-3xl font-medium tracking-tight text-bonefixed">
              {siteConfig.name}
              <span className="text-bonefixed/60">.</span>
            </Link>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-bonefixed/55">
              {siteConfig.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-8 xl:grid-cols-5">
            {footerNav.map((group) => (
              <nav key={group.heading} aria-label={group.heading}>
                <h3 className="font-mono text-[11px] uppercase tracking-label text-bonefixed/40">
                  {group.heading}
                </h3>
                {/* py-2 (tightened on desktop) gives each link a ~36px tap
                    target on phones instead of a 20px sliver. */}
                <ul className="mt-3 space-y-0.5 sm:mt-4 sm:space-y-1.5">
                  {group.links.map((l) => (
                    <li key={`${group.heading}-${l.label}`}>
                      <Link
                        href={l.href}
                        className="inline-block py-2 text-sm text-bonefixed/75 transition-colors hover:text-bonefixed sm:py-1"
                      >
                        <span className="link-underline">{l.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-bonefixed/15 pt-6 text-xs text-bonefixed/40 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {siteConfig.name}. All rights reserved.
          </p>
          <p>Websites and full systems are scoped to your goals on a call. SEO Autopilot is priced in the open.</p>
        </div>
      </Container>

      {/* Oversized brand signature — full-bleed across the bottom of the footer. */}
      <div aria-hidden className="select-none overflow-hidden px-[1.2vw] pb-[1.6vw] pt-[0.4vw]">
        <div
          className="whitespace-nowrap text-center font-display font-semibold leading-none tracking-[-0.01em] text-bonefixed"
          style={{ fontSize: "17.3vw" }}
        >
          {siteConfig.name.toUpperCase()}
        </div>
      </div>
    </footer>
  );
}
