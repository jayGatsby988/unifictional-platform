import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { getSession } from "@/lib/data/repo";
import { getStudioAutopilot } from "@/lib/data/autopilot";
import { cadenceLabel } from "@/lib/autopilot/schedule";
import { RunAutopilot } from "@/components/studio/RunAutopilot";
import { ago } from "@/lib/ago";
import { cn, fmt } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KEYS = [
  ["ANTHROPIC_API_KEY", "writes the posts"],
  ["GITHUB_TOKEN", "publishes to sites we host from GitHub"],
  ["SUPABASE_SERVICE_ROLE_KEY", "lets the daily run write"],
  ["CRON_SECRET", "protects the daily run"],
] as const;

export default async function StudioAutopilotPage() {
  const session = await getSession();
  const rows = await getStudioAutopilot(session);
  const on = rows.filter((r) => r.settings.enabled).length;
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const awaiting = sum((r) => r.awaiting);
  const keys = KEYS.map(([key, what]) => ({ key, what, set: Boolean(process.env[key]) }));
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label mb-2">Studio · SEO Autopilot</p>
          <h1 className="font-display text-3xl sm:text-4xl leading-none">{on} of {rows.length} companies on autopilot{awaiting ? `, ${awaiting} post${awaiting === 1 ? "" : "s"} waiting on clients` : ""}.</h1>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl">Clients switch it on themselves from their SEO Autopilot page. The daily run (7am Pacific) publishes what was approved, writes each due post from the company&apos;s content plan, scores it, and suggests fixes.</p>
        </div>
        <RunAutopilot demo={session.isDemo} label="Run everything due now" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {[
          ["Companies on", `${on}/${rows.length}`],
          ["Posts live", fmt.int(sum((r) => r.published))],
          ["Awaiting OK", fmt.int(awaiting)],
          ["Fixes done", `${sum((r) => r.fixesDone)}/${sum((r) => r.fixesTotal)}`],
          ["Topics planned", fmt.int(sum((r) => r.upcoming))],
        ].map(([l, v]) => (
          <div key={l} className="panel p-4"><p className="label mb-2">{l}</p><p className="font-display text-2xl leading-none">{v}</p></div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {keys.map((k) => (
          <span key={k.key} className={cn("pill inline-flex items-center gap-1 font-mono", k.set ? "pill-good" : "pill-bad")}>{k.set ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{k.key} · {k.what}</span>
        ))}
        {keys.some((k) => !k.set) && <Link href="/admin/setup" className="text-xs underline">Setup &amp; keys</Link>}
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.slug} className="panel p-5">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
              <div className="min-w-[14rem] flex-1">
                <div className="flex items-center gap-2 mb-1"><p className="font-display text-2xl leading-none">{r.name}</p><span className={cn("pill", r.settings.enabled ? "pill-good" : "pill-neutral")}>{r.settings.enabled ? "On" : "Off"}</span></div>
                <p className="text-xs text-ink-muted">{r.website.replace(/^https?:\/\//, "") || "No website yet"}{r.settings.enabled ? ` · ${cadenceLabel(r.settings.cadence)} · ${r.settings.mode === "approve" ? "client OKs each post" : "publishes on its own"}` : ""}</p>
                <div className="mt-2">
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider", r.publishing.ready ? "bg-good-bg text-good" : "bg-sand text-ink-muted")}>{r.publishing.ready ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{r.publishing.note}</span>
                </div>
                {r.settings.notes && <p className="mt-2 text-xs text-ink-muted italic">“{r.settings.notes}”</p>}
              </div>
              <dl className="grid grid-cols-5 gap-4 text-center">
                <div><dt className="label !text-[8px] mb-1">Live</dt><dd className="font-display text-xl leading-none">{r.published}</dd></div>
                <div><dt className="label !text-[8px] mb-1">Awaiting</dt><dd className={cn("font-display text-xl leading-none", r.awaiting && "text-warn")}>{r.awaiting}</dd></div>
                <div><dt className="label !text-[8px] mb-1">Fixes</dt><dd className="font-display text-xl leading-none">{r.fixesTotal ? `${r.fixesDone}/${r.fixesTotal}` : "—"}</dd></div>
                <div><dt className="label !text-[8px] mb-1">Planned</dt><dd className="font-display text-xl leading-none">{r.upcoming}</dd></div>
                <div><dt className="label !text-[8px] mb-1">Next</dt><dd className="font-display text-xl leading-none">{r.settings.enabled && r.settings.nextRunAt ? fmt.date(r.settings.nextRunAt) : "—"}</dd></div>
              </dl>
              <div className="flex flex-col gap-2 items-stretch">
                <RunAutopilot slug={r.slug} enabled={r.settings.enabled} demo={session.isDemo} />
                <Link href={`/api/client/open?slug=${r.slug}&next=${encodeURIComponent("/autopilot")}`} className="btn btn-ghost !py-2 !px-4 text-xs justify-center">Their page <ArrowUpRight className="h-3.5 w-3.5" /></Link>
                <Link href={`/admin?client=${r.slug}`} className="btn btn-ghost !py-2 !px-4 text-xs justify-center">Data connections</Link>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-line text-xs text-ink-muted">
              {r.lastRun ? <span><span className={r.lastRun.ok ? "text-good" : "text-bad"}>{r.lastRun.ok ? "OK" : "Failed"}</span> · {ago(r.lastRun.at)} · {r.lastRun.summary}</span> : "Never run"}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-ink-muted">No companies yet.</p>}
      </div>
    </>
  );
}
