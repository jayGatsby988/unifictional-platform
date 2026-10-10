import Link from "next/link";
import { ArrowUpRight, Calculator, Globe, Search, Share2 } from "lucide-react";
import { Section, SubHead } from "@/components/Section";
import { Delta, Stat, StatusPill } from "@/components/Stat";
import { TrendLazy as Trend } from "@/components/charts/TrendLazy";
import { SetupChecklist } from "@/components/SetupChecklist";
import { SourceGate } from "@/components/Gate";
import { getPortal } from "@/lib/data/repo";
import { fmt } from "@/lib/utils";

const AREA_ICON = { website: Globe, seo: Search, social: Share2, estimator: Calculator, account: ArrowUpRight } as const;

export default async function OverviewPage() {
  const d = await getPortal();
  const st = d.status;
  const traffic = st.connected.ga4 && st.has.traffic;
  const search = st.connected.gsc && st.has.seo;
  const ig = d.social.accounts.find((a) => a.platform === "instagram");
  const social = st.connected.meta && Boolean(ig);
  const leads30 = d.website.last30.formSubmissions + d.website.last30.calls;
  const leadsPrev = d.website.prev30.formSubmissions + d.website.prev30.calls;
  const newQuoteLeads = d.estimator.generations.filter((g) => g.status === "new" && g.contact).length;
  const health = d.website.health;
  const missing = (on: boolean, wait: boolean) => (!on ? "Not connected yet" : wait ? "Arrives after tonight's update" : undefined);

  return (
    <>
      <Section num="00" label="Overview" title={`How ${d.client.name} is doing.`}
        intro={st.lastSyncAt ? `Last 30 days across your website, search, social and the quote tool. Updated ${fmt.dateLong(st.lastSyncAt)}.` : "Your website, search, social and quote tool, in one place. Numbers update every night."} />

      <SetupChecklist status={st} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Stat label="Leads · 30d" value={traffic ? leads30 : null} sub={missing(st.connected.ga4, !st.has.traffic) ?? `${d.website.last30.formSubmissions} forms · ${d.website.last30.calls} calls`} delta={<Delta now={leads30} prev={leadsPrev} />} />
        <Stat label="Website visits · 30d" value={traffic ? d.website.last30.sessions : null} sub={missing(st.connected.ga4, !st.has.traffic) ?? `${fmt.int(d.website.last30.users)} people`} delta={<Delta now={d.website.last30.sessions} prev={d.website.prev30.sessions} />} />
        <Stat label="Google clicks · 90d" value={search ? d.seo.totals90.clicks : null} sub={missing(st.connected.gsc, !st.has.seo) ?? `avg. position ${d.seo.totals90.position}`} delta={<Delta now={d.seo.totals90.clicks} prev={d.seo.prev90.clicks} />} />
        <Stat label="Instagram followers" value={social ? ig!.followers : null} sub={missing(st.connected.meta, !ig) ?? `${fmt.delta(ig!.followersDelta30)} this month`} delta={ig ? <Delta now={ig.followers} prev={ig.followers - ig.followersDelta30} /> : undefined} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-10">
        <div className="lg:col-span-2">
          <SourceGate source="ga4" has={st.has.traffic} status={st} className="h-full">
            <div className="panel p-5 h-full">
              <SubHead right={<Link href="/website" className="text-xs underline">Website →</Link>}>Website visits, daily</SubHead>
              <Trend data={d.website.sessionsDaily} keys={[{ key: "value", name: "Visits" }]} />
            </div>
          </SourceGate>
        </div>
        <div className="panel p-5">
          <SubHead>Recent activity</SubHead>
          <ul className="space-y-3">
            {d.activity.slice(0, 7).map((a, i) => {
              const Icon = AREA_ICON[a.area];
              return (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="mt-0.5 h-6 w-6 rounded-full bg-sand grid place-items-center shrink-0"><Icon className="h-3 w-3" /></span>
                  <div className="min-w-0">
                    <p className="leading-snug">{a.title}</p>
                    <p className="label !text-[9px] mt-0.5">{fmt.date(a.at)}</p>
                  </div>
                </li>
              );
            })}
            {d.activity.length === 0 && <li className="text-sm text-ink-muted">Everything we do for you shows up here.</li>}
          </ul>
        </div>
      </div>

      <SubHead>Where things stand</SubHead>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/website" className="panel p-5 hover:border-ink transition">
          <div className="flex items-center justify-between mb-4"><Globe className="h-5 w-5" />{health ? <span className="pill pill-neutral">Grade {health.summary.grade}</span> : <StatusPill status={d.website.status} />}</div>
          <p className="font-display text-xl mb-1">Website</p>
          <p className="text-sm text-ink-muted">{d.website.checks.length ? `${d.website.uptimePct}% uptime${d.website.responseMs ? ` · responds in ${(d.website.responseMs / 1000).toFixed(1)}s` : ""}` : "First check runs tonight"}</p>
        </Link>
        <Link href="/seo" className="panel p-5 hover:border-ink transition">
          <div className="flex items-center justify-between mb-4"><Search className="h-5 w-5" />{search ? <span className="pill pill-neutral">{d.seo.keywords.filter((k) => k.position <= 10).length} in top 10</span> : health?.seo ? <span className="pill pill-neutral">Search health {health.seo.score}</span> : <span className="pill pill-warn">Needs access</span>}</div>
          <p className="font-display text-xl mb-1">Search</p>
          <p className="text-sm text-ink-muted">{st.connected.gbp && st.has.gbp ? `${fmt.int(d.seo.gbp.calls)} calls from your Google listing this month` : search ? `${fmt.int(d.seo.totals90.clicks)} Google clicks in 90 days` : "Connect Search Console to see rankings"}</p>
        </Link>
        <Link href="/social" className="panel p-5 hover:border-ink transition">
          <div className="flex items-center justify-between mb-4"><Share2 className="h-5 w-5" />{social ? <span className="pill pill-neutral">{d.social.posts.filter((p) => p.status === "scheduled").length} scheduled</span> : <span className="pill pill-warn">Needs access</span>}</div>
          <p className="font-display text-xl mb-1">Social</p>
          <p className="text-sm text-ink-muted">{social ? `${fmt.compact(ig!.reach30)} people reached on Instagram · 30d` : "Connect Facebook to see your reach"}</p>
        </Link>
        <Link href="/estimator" className="panel p-5 hover:border-ink transition">
          <div className="flex items-center justify-between mb-4"><Calculator className="h-5 w-5" />{newQuoteLeads > 0 ? <span className="pill pill-warn">{newQuoteLeads} new leads</span> : <span className="pill pill-neutral">{d.estimator.embedded ? `${d.estimator.stats30.generated} quotes` : "Not on your site yet"}</span>}</div>
          <p className="font-display text-xl mb-1">Quote tool</p>
          <p className="text-sm text-ink-muted">{d.estimator.embedded ? `${fmt.int(d.estimator.stats30.generated)} 3D quotes · ${fmt.int(d.estimator.stats30.leads)} left details` : "Instant 3D quotes for homeowners. Ask us to add it."}</p>
        </Link>
      </div>
    </>
  );
}
