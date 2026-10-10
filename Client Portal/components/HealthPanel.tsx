import { AlertTriangle, Check, Info, X } from "lucide-react";
import type { AuditReport, Check as CheckT } from "@/lib/audit";
import { cn, fmt } from "@/lib/utils";

const ICON = { pass: Check, warn: AlertTriangle, fail: X, info: Info } as const;
const TONE = { pass: "text-good bg-good-bg", warn: "text-warn bg-warn-bg", fail: "text-bad bg-bad-bg", info: "text-ink-muted bg-sand" } as const;
const GROUP: Record<CheckT["group"], string> = { leads: "Turning visitors into calls", seo: "Being found on Google", speed: "Speed on a phone", trust: "Looking trustworthy" };

/** The nightly health check of the client's own site, from the same engine as the free inspection. */
export function HealthPanel({ report, at }: { report: AuditReport; at: string | null }) {
  const groups = (Object.keys(GROUP) as CheckT["group"][]).map((g) => ({ g, items: report.checks.filter((c) => c.group === g) })).filter((x) => x.items.length);
  const toFix = report.checks.filter((c) => c.status === "fail" || c.status === "warn");
  return (
    <section className="space-y-4">
      <div className="rounded-2xl bg-ink text-bone p-6 sm:p-8 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <p className="font-display text-7xl leading-none">{report.summary.grade}</p>
          <p className="label !text-bone/50 mt-1">Health grade</p>
        </div>
        {report.seo && (
          <div>
            <p className="font-display text-5xl leading-none">{report.seo.score}<span className="text-xl">/100</span></p>
            <p className="label !text-bone/50 mt-1">Search health</p>
          </div>
        )}
        <div className="flex-1 min-w-[15rem]">
          <p className="font-display text-xl sm:text-2xl leading-tight">{report.summary.headline}</p>
          <p className="text-sm text-bone/60 mt-2">{report.summary.passed} checks passed · {report.summary.warned} to improve · {report.summary.failed} to fix{at ? ` · checked ${fmt.dateLong(at)}` : ""}</p>
        </div>
      </div>

      {toFix.length > 0 && (
        <div className="panel p-5 sm:p-6">
          <p className="label mb-3">What we&apos;re working on</p>
          <ul className="space-y-3">
            {toFix.slice(0, 5).map((c) => {
              const I = ICON[c.status];
              return (
                <li key={c.id} className="flex gap-3">
                  <span className={cn("mt-0.5 h-7 w-7 rounded-full grid place-items-center shrink-0", TONE[c.status])}><I className="h-4 w-4" /></span>
                  <div><p className="font-medium leading-snug">{c.label}</p><p className="text-sm text-ink-muted leading-snug">{c.detail}</p></div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <details className="panel p-5 sm:p-6 group">
        <summary className="cursor-pointer list-none flex items-center justify-between">
          <span className="label">All {report.checks.length} checks</span>
          <span className="text-sm text-ink-muted group-open:hidden">Show</span><span className="text-sm text-ink-muted hidden group-open:inline">Hide</span>
        </summary>
        <div className="mt-5 grid md:grid-cols-2 gap-6">
          {groups.map(({ g, items }) => (
            <div key={g}>
              <p className="label !text-ink-soft mb-3">{GROUP[g]}</p>
              <ul className="space-y-2.5">
                {items.map((c) => {
                  const I = ICON[c.status];
                  return (
                    <li key={c.id} className="flex gap-3">
                      <span className={cn("mt-0.5 h-6 w-6 rounded-full grid place-items-center shrink-0", TONE[c.status])}><I className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0"><p className="text-sm font-medium leading-snug">{c.label}</p><p className="text-xs text-ink-muted leading-snug">{c.detail}</p></div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
