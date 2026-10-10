import Link from "next/link";
import { ArrowUpRight, Check, Minus } from "lucide-react";
import { getSession } from "@/lib/data/repo";
import { getCompanies, hostOf } from "@/lib/data/studio";
import { CreateCompany } from "@/components/studio/CreateCompany";
import { LinkLogin } from "@/components/studio/LinkLogin";
import { CreateLogin } from "@/components/studio/CreateLogin";
import { Delta } from "@/components/Stat";
import { ago } from "@/lib/ago";
import { cn, fmt } from "@/lib/utils";

const DOTS = [["site", "Site"], ["ga4", "Analytics"], ["gsc", "Search"], ["gbp", "Maps"], ["meta", "Social"]] as const;
const STATUS = { healthy: ["pill-good", "Healthy"], "needs-setup": ["pill-warn", "Needs setup"], attention: ["pill-bad", "Needs attention"] } as const;

export default async function CompaniesPage() {
  const session = await getSession();
  const rows = await getCompanies(session);
  const needs = rows.filter((r) => r.status !== "healthy").length;
  return (
    <>
      <div className="mb-8">
        <p className="label mb-2">Studio · Companies</p>
        <h1 className="font-display text-3xl sm:text-4xl leading-none">{rows.length} companies{needs ? `, ${needs} need you` : ""}.</h1>
        <p className="mt-2 text-sm text-ink-muted">Open any company to see exactly what they see. Data connections set where its numbers come from.</p>
      </div>

      <div className="space-y-3 mb-12">
        {rows.map((c) => {
          const [tone, label] = STATUS[c.status];
          return (
            <div key={c.id} className="panel p-5">
              <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
                <div className="min-w-[14rem] flex-1">
                  <div className="flex items-center gap-2 mb-1"><p className="font-display text-2xl leading-none">{c.name}</p><span className={cn("pill", tone)}>{label}</span></div>
                  <p className="text-xs text-ink-muted">{[c.industry, c.city, hostOf(c.website)].filter(Boolean).join(" · ") || "No details yet"}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {DOTS.map(([k, l]) => (
                      <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider", c.connections[k] ? "bg-good-bg text-good" : "bg-sand text-ink-muted")}>
                        {c.connections[k] ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />}{l}
                      </span>
                    ))}
                  </div>
                </div>
                <dl className="grid grid-cols-4 gap-4 text-center">
                  <div><dt className="label !text-[8px] mb-1">Visits 30d</dt><dd className="font-display text-xl leading-none">{fmt.int(c.visits30)}</dd><dd className="mt-1">{c.visitsPrev30 ? <Delta now={c.visits30} prev={c.visitsPrev30} /> : <span className="text-[10px] text-ink-muted">—</span>}</dd></div>
                  <div><dt className="label !text-[8px] mb-1">Leads 30d</dt><dd className="font-display text-xl leading-none">{fmt.int(c.leads30)}</dd></div>
                  <div><dt className="label !text-[8px] mb-1">Quote leads</dt><dd className={cn("font-display text-xl leading-none", c.newQuoteLeads && "text-warn")}>{c.newQuoteLeads}</dd></div>
                  <div><dt className="label !text-[8px] mb-1">Open support</dt><dd className={cn("font-display text-xl leading-none", c.openSupport && "text-bad")}>{c.openSupport}</dd></div>
                </dl>
                <div className="flex flex-col gap-2 items-stretch">
                  <Link href={`/api/client/open?slug=${c.slug}`} className="btn btn-ink !py-2 !px-4 text-xs justify-center">Open dashboard <ArrowUpRight className="h-3.5 w-3.5" /></Link>
                  <Link href={`/admin?client=${c.slug}`} className="btn btn-ghost !py-2 !px-4 text-xs justify-center">Data connections</Link>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
                <span>{c.logins.length ? <>Logins: <span className="text-ink">{c.logins.join(", ")}</span></> : "No client login yet"}{c.lastSync ? ` · last sync ${ago(c.lastSync.at)}${c.lastSync.ok ? "" : " (with errors)"}` : " · never synced"}</span>
                <LinkLogin slug={c.slug} />
              </div>
              <details className="mt-3 group">
                <summary className="text-xs font-medium cursor-pointer select-none">{c.logins.length ? "New temporary password / another login →" : "Create their login and text it →"}</summary>
                <div className="mt-3"><CreateLogin slug={c.slug} email={c.logins[0] ?? ""} compact /></div>
              </details>
            </div>
          );
        })}
      </div>

      <div className="max-w-2xl">
        <CreateCompany title="Add a company" initial={{}} />
      </div>
    </>
  );
}
