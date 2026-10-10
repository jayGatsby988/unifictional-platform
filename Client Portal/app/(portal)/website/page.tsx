import { ExternalLink, Phone, FileText } from "lucide-react";
import { Section, SubHead } from "@/components/Section";
import { Delta, Score, Stat, StatusPill } from "@/components/Stat";
import { TrendLazy as Trend } from "@/components/charts/TrendLazy";
import { Bars } from "@/components/Bars";
import { HealthPanel } from "@/components/HealthPanel";
import { NotConnected, SourceGate } from "@/components/Gate";
import { getPortal } from "@/lib/data/repo";
import { cn, fmt } from "@/lib/utils";

export default async function WebsitePage() {
  const d = await getPortal();
  const w = d.website;
  const st = d.status;
  const host = d.client.websiteUrl ? d.client.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
  const checked = w.checks.length > 0;
  const avgMs = checked ? Math.round(w.checks.reduce((a, c) => a + c.ms, 0) / w.checks.length) : null;

  return (
    <>
      <Section num="01" label="Website" title="Your website."
        intro="Is it up, is it fast, is it set up to win jobs, and who is visiting."
        action={host ? <a href={d.client.websiteUrl} target="_blank" rel="noreferrer" className="btn btn-ghost"><ExternalLink className="h-4 w-4" />{host}</a> : undefined}
      />

      {!st.connected.site ? <NotConnected source="site" className="mb-10" /> : (
        <div className="panel p-5 mb-10">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-3">
              <StatusPill status={checked ? w.status : "building"} />
              <span className="text-sm text-ink-muted">{checked ? `Checked ${fmt.dateLong(w.lastCheckedAt)}` : "First check runs tonight"}</span>
            </div>
            {checked && <div className="text-sm"><span className="label mr-2">Uptime</span><span className="font-mono">{w.uptimePct}%</span></div>}
            {avgMs !== null && <div className="text-sm"><span className="label mr-2">Responds in</span><span className="font-mono">{(avgMs / 1000).toFixed(2)}s</span></div>}
            {d.client.launchedAt && <div className="text-sm"><span className="label mr-2">Launched</span><span className="font-mono">{fmt.dateLong(d.client.launchedAt)}</span></div>}
          </div>
          {checked && (
            <div className="mt-4">
              <div className="flex items-end gap-1 h-10" aria-label="Recent uptime checks">
                {w.checks.map((c, i) => (
                  <span key={i} title={`${fmt.dateLong(c.at)} · ${c.ok ? `up, ${c.ms} ms` : "down"}`} className={cn("flex-1 max-w-3 rounded-sm", c.ok ? "bg-good/70" : "bg-bad")} style={{ height: `${Math.max(25, Math.min(100, (c.ms / Math.max(avgMs ?? 1, 1)) * 55))}%` }} />
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-muted">Each bar is one check. Taller means slower to respond, red means the site was down.</p>
            </div>
          )}
        </div>
      )}

      <SubHead>Health check</SubHead>
      {w.health ? <div className="mb-10"><HealthPanel report={w.health} at={w.healthAt} /></div> : (
        <div className="panel p-6 sm:p-8 mb-10">
          <p className="font-display text-xl sm:text-2xl leading-tight">Your first health check runs tonight.</p>
          <p className="mt-1 text-ink-muted">Every night we check that your site loads fast on a phone, shows up properly on Google, and makes it easy to call you. The results and what we&apos;re fixing show up here.</p>
        </div>
      )}

      {st.has.scores && (
        <>
          <SubHead>Google speed test</SubHead>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            <div className="panel p-5"><Score label="Speed" value={w.scores.performance} /></div>
            <div className="panel p-5"><Score label="SEO" value={w.scores.seo} /></div>
            <div className="panel p-5"><Score label="Accessibility" value={w.scores.accessibility} /></div>
            <div className="panel p-5"><Score label="Best practices" value={w.scores.bestPractices} /></div>
          </div>
        </>
      )}

      <SubHead>Visitors &amp; leads</SubHead>
      <SourceGate source="ga4" has={st.has.traffic} status={st}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <Stat label="Visits" value={w.last30.sessions} delta={<Delta now={w.last30.sessions} prev={w.prev30.sessions} />} sub="last 30 days" />
          <Stat label="People" value={w.last30.users} delta={<Delta now={w.last30.users} prev={w.prev30.users} />} sub="unique visitors" />
          <Stat label="Form leads" value={w.last30.formSubmissions} delta={<Delta now={w.last30.formSubmissions} prev={w.prev30.formSubmissions} />} sub="estimate + contact forms" />
          <Stat label="Calls" value={w.last30.calls} delta={<Delta now={w.last30.calls} prev={w.prev30.calls} />} sub="tracked phone calls" />
        </div>
        <div className="grid lg:grid-cols-3 gap-4 mb-10">
          <div className="panel p-5 lg:col-span-2">
            <SubHead>Visits, daily</SubHead>
            <Trend data={w.sessionsDaily} keys={[{ key: "value", name: "Visits" }]} height={240} />
          </div>
          <div className="panel p-5">
            <SubHead>Where visitors come from</SubHead>
            {w.sources.length ? <Bars rows={w.sources.map((s) => ({ label: s.name, value: s.sharePct, sub: `${s.sharePct}%` }))} max={100} /> : <p className="text-sm text-ink-muted">Not enough visits yet to split by source.</p>}
          </div>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="panel p-5">
            <SubHead>Top pages · 30d</SubHead>
            {w.topPages.length ? (
              <table className="table w-full">
                <thead><tr><th>Page</th><th className="text-right">Views</th><th className="text-right">Leads</th></tr></thead>
                <tbody>{w.topPages.map((p) => <tr key={p.path}><td className="font-mono text-xs">{p.path}</td><td className="text-right font-mono text-xs">{fmt.int(p.views)}</td><td className="text-right font-mono text-xs">{p.conversions}</td></tr>)}</tbody>
              </table>
            ) : <p className="text-sm text-ink-muted">Page-by-page numbers show up after a few days of visits.</p>}
          </div>
          <div className="panel p-5">
            <SubHead>Latest leads</SubHead>
            <ul className="divide-y divide-line">
              {w.recentLeads.map((l, i) => (
                <li key={i} className="flex items-center gap-3 py-3 text-sm">
                  <span className="h-7 w-7 rounded-full bg-sand grid place-items-center shrink-0">{l.type === "call" ? <Phone className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}</span>
                  <span className="flex-1 min-w-0 truncate">{l.detail}</span>
                  <span className="label !text-[9px] shrink-0">{fmt.date(l.at)}</span>
                </li>
              ))}
              {w.recentLeads.length === 0 && <li className="py-3 text-sm text-ink-muted">No leads recorded yet. Form submissions and tracked calls show up here as they come in.</li>}
            </ul>
          </div>
        </div>
      </SourceGate>
    </>
  );
}
