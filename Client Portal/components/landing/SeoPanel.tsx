import { Check, X, Minus, AlertTriangle } from "lucide-react";
import type { SeoReport } from "@/lib/seo-check";
import { cn } from "@/lib/utils";

/** The "where you show up on Google" block of the free inspection. */
export function SeoPanel({ seo }: { seo: SeoReport }) {
  const checked = seo.rankings.filter((r) => r.checked);
  const bad = seo.score < 50;
  const mid = seo.score >= 50 && seo.score < 75;
  return (
    <section className="rounded-2xl border border-line overflow-hidden">
      <div className={cn("p-6 sm:p-8", bad ? "bg-bad-bg" : mid ? "bg-warn-bg" : "bg-good-bg")}>
        <p className="label mb-2">Where you show up on Google</p>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className={cn("font-display text-6xl sm:text-7xl leading-none", bad ? "text-bad" : mid ? "text-warn" : "text-good")}>{seo.score}<span className="text-2xl align-top">/100</span></p>
            <p className="label !text-[9px] mt-1">SEO score</p>
          </div>
          <div className="flex-1 min-w-[16rem]">
            <p className="font-display text-2xl sm:text-3xl leading-tight">{seo.verdict}</p>
            <p className="mt-2 text-sm text-ink-soft">We read your site as a <span className="font-medium">{seo.trade}</span>{seo.city ? <> in <span className="font-medium">{seo.city}</span></> : null}{seo.inferred ? " (our best guess from the page)" : ""} and tested the searches a homeowner there would type.</p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-px bg-line">
        <div className="bg-bone p-5 sm:p-6">
          <h3 className="label !text-ink-soft mb-3">Page one of Google?</h3>
          {checked.length === 0 ? (
            <p className="text-sm text-ink-muted">We couldn&apos;t run live searches just now. The on-page findings on the right still apply; we&apos;ll include rankings in the emailed report.</p>
          ) : (
            <ul className="divide-y divide-line">
              {seo.rankings.map((r) => {
                const on = r.checked && r.position !== null && r.position <= 10;
                return (
                  <li key={r.query} className="flex items-center gap-3 py-2.5">
                    <span className={cn("h-6 w-6 rounded-full grid place-items-center shrink-0", !r.checked ? "bg-sand text-ink-muted" : on ? "bg-good-bg text-good" : "bg-bad-bg text-bad")}>
                      {!r.checked ? <Minus className="h-3.5 w-3.5" /> : on ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    </span>
                    <span className="flex-1 text-sm">“{r.query}”</span>
                    <span className="font-mono text-xs text-ink-muted shrink-0">{!r.checked ? "not checked" : on ? `#${r.position}` : "not on page 1"}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-ink-muted">{seo.provider === "google" ? "Checked live against Google's organic results (US). The map pack and ads vary by location." : seo.provider ? "Checked live against web search results; Google's map pack and ads vary by location." : "Live ranking checks are being set up; the emailed report will include them."}</p>
        </div>
        <div className="bg-bone p-5 sm:p-6">
          <h3 className="label !text-ink-soft mb-3">Why {seo.pageOneCount === 0 && checked.length ? "you're not there" : "it's not better"}</h3>
          {seo.issues.length === 0 ? (
            <p className="text-sm text-ink-muted">No on-page SEO problems found. Nice.</p>
          ) : (
            <ul className="space-y-3">
              {seo.issues.map((i) => (
                <li key={i.label} className="flex gap-3">
                  <span className={cn("mt-0.5 h-6 w-6 rounded-full grid place-items-center shrink-0", i.severity === "fail" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn")}>
                    {i.severity === "fail" ? <X className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  </span>
                  <div><p className="text-sm font-medium leading-snug">{i.label}</p><p className="text-xs text-ink-muted leading-snug">{i.detail}</p></div>
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-ink-muted border-t border-line pt-4">
            <dt>Pages in sitemap</dt><dd className="font-mono text-ink">{seo.facts.sitemapPages ?? "none"}</dd>
            <dt>Service pages linked</dt><dd className="font-mono text-ink">{seo.facts.servicePages}</dd>
            <dt>Title length</dt><dd className="font-mono text-ink">{seo.facts.titleLength} chars</dd>
            <dt>Description length</dt><dd className="font-mono text-ink">{seo.facts.descriptionLength} chars</dd>
            <dt>Images without alt</dt><dd className="font-mono text-ink">{seo.facts.altMissingPct}%</dd>
            <dt>Address on page</dt><dd className="font-mono text-ink">{seo.facts.hasAddress ? "yes" : "no"}</dd>
          </dl>
        </div>
      </div>
    </section>
  );
}
