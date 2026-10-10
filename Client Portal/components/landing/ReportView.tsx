import Link from "next/link";
import { Check, AlertTriangle, X, Info } from "lucide-react";
import type { AuditReport, Check as CheckT } from "@/lib/audit";
import { Score } from "@/components/Stat";
import { SeoPanel } from "@/components/landing/SeoPanel";
import { cn } from "@/lib/utils";

const ICON = { pass: Check, warn: AlertTriangle, fail: X, info: Info } as const;
const TONE = { pass: "text-good bg-good-bg", warn: "text-warn bg-warn-bg", fail: "text-bad bg-bad-bg", info: "text-ink-muted bg-sand" } as const;
const GROUP: Record<CheckT["group"], string> = { leads: "Turning visitors into calls", seo: "Being found on Google", speed: "Speed on a phone", trust: "Looking trustworthy" };

export function ReportView({ report, permalink }: { report: AuditReport; permalink: string | null }) {
  const host = report.finalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const groups = (Object.keys(GROUP) as CheckT["group"][]).map((g) => ({ g, items: report.checks.filter((c) => c.group === g) })).filter((x) => x.items.length);
  return (
    <section className="space-y-6">
      <div className="rounded-2xl bg-ink text-bone p-6 sm:p-8">
        <p className="label !text-bone/60 mb-2">Inspection report · {host}</p>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="font-display text-7xl sm:text-8xl leading-none">{report.summary.grade}</p>
            <p className="text-sm text-bone/60 mt-1">{report.summary.passed} passed · {report.summary.warned} warnings · {report.summary.failed} failed</p>
          </div>
          <div className="flex-1 min-w-[16rem]">
            <p className="font-display text-2xl sm:text-3xl leading-tight">{report.summary.headline}</p>
            {report.summary.fixFirst.length > 0 && (
              <p className="mt-3 text-sm text-bone/70">Fix first: <span className="text-bone">{report.summary.fixFirst.join(" · ")}</span></p>
            )}
          </div>
        </div>
      </div>

      {report.seo && <SeoPanel seo={report.seo} />}

      {report.scores && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="panel p-4"><Score label="Speed" value={report.scores.performance} /></div>
          <div className="panel p-4"><Score label="SEO" value={report.scores.seo} /></div>
          <div className="panel p-4"><Score label="Accessibility" value={report.scores.accessibility} /></div>
          <div className="panel p-4"><Score label="Best practices" value={report.scores.bestPractices} /></div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {groups.map(({ g, items }) => (
          <div key={g} className="panel p-5">
            <h3 className="label !text-ink-soft mb-3">{GROUP[g]}</h3>
            <ul className="space-y-3">
              {items.map((c) => {
                const Icon = ICON[c.status];
                return (
                  <li key={c.id} className="flex gap-3">
                    <span className={cn("mt-0.5 h-6 w-6 rounded-full grid place-items-center shrink-0", TONE[c.status])}><Icon className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">{c.label}</p>
                      <p className="text-xs text-ink-muted leading-snug">{c.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="panel p-6 sm:p-8 flex flex-wrap items-center justify-between gap-5">
        <div className="max-w-xl">
          <p className="label mb-2">Next step</p>
          <p className="font-display text-2xl sm:text-3xl leading-tight">Want these fixed, and the numbers tracked every month?</p>
          <p className="text-sm text-ink-muted mt-2">A 15-minute call. We&apos;ll walk through this report and show you what the clients in our portal see: leads, rankings, reviews and social, all in one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="https://unifictional.com/contact" className="btn btn-ink">Book a call</a>
          <Link href="/signup" className="btn btn-ghost">Create an account</Link>
        </div>
      </div>
      {permalink && <p className="text-xs text-ink-muted">Permanent link to this report: <Link className="underline" href={permalink}>{permalink}</Link></p>}
    </section>
  );
}
