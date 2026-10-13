import Link from "next/link";
import { ArrowUpRight, Bot, Calculator, Globe, Search, Share2 } from "lucide-react";
import { Section, SubHead } from "@/components/Section";
import { Delta, Stat, StatusPill } from "@/components/Stat";
import { TrendLazy as Trend } from "@/components/charts/TrendLazy";
import { SetupChecklist } from "@/components/SetupChecklist";
import { SourceGate } from "@/components/Gate";
import { getPortal, getSession } from "@/lib/data/repo";
import { getAutopilot } from "@/lib/data/autopilot";
import { fmt } from "@/lib/utils";

const AREA_ICON = { website: Globe, seo: Search, social: Share2, estimator: Calculator, account: ArrowUpRight } as const;

export default async function OverviewPage() {
  const d = await getPortal();
  const session = await getSession();
  const auto = await getAutopilot(session);
  const autoLive = auto.posts.filter((p) => p.status === "published").length;
  const autoWaiting = auto.posts.filter((p) => p.status === "awaiting_approval").length;
  const st = d.status;
  const traffic = st.connected.ga4 && st.has.traffic;
  const search = st.connected.gsc && st.has.seo;
  const ig = d.social.accounts.find((a) => a.platform === "instagram");
  const social = st.connected.meta && Boolean(ig);
  // Call tracking isn't wired for every site; until a call has ever been counted, leads are form fills only (no fake "0 calls").
  const callsTracked = d.website.last30.calls + d.website.prev30.calls > 0;
  const leads30 = d.website.last30.formSubmissions + (callsTracked ? d.website.last30.calls : 0);
  const leadsPrev = d.website.prev30.formSubmissions + (callsTracked ? d.website.prev30.calls : 0);
  const newQuoteLeads = d.estimator.generations.filter((g) => g.status === "new" && g.contact).length;
  const health = d.website.health;
  const missing = (on: boolean, wait: boolean) => (!on ? "Not connected yet" : wait ? "Arrives after tonight's update" : undefined);
  // Only the services this company actually has (same rule as the menu).
  const shown = shownAreas(d.client.services, session.isAdmin);
  const stale = syncLooksStuck(st.lastSyncAt);
  const headline = summarize({
    leads: traffic ? { now: leads30, prev: leadsPrev } : null,
    visits: traffic ? { now: d.website.last30.sessions, prev: d.website.prev30.sessions } : null,
    posts: autoLive,
  });

  return (
    <>
      <Section num="00" label="Overview" title={`How ${d.client.name} is doing.`}
        intro={st.lastSyncAt ? `Last 30 days across your website, search, social and the quote tool. Updated ${fmt.dateLong(st.lastSyncAt)}.` : "Your website, search, social and quote tool, in one place. Numbers update every night."} />

      {headline && <p className="panel p-5 mb-6 text-lg leading-snug">{headline}</p>}
      {stale && (
        <p className="mb-6 rounded-xl bg-sand px-4 py-3 text-base">
          Your numbers last updated on <b>{fmt.dateLong(st.lastSyncAt!)}</b>. They normally refresh every night, so something may be stuck.{" "}
          <Link href="/requests" className="underline">Tell us and we&apos;ll fix it</Link>.
        </p>
      )}

      <SetupChecklist status={st} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Stat label="Leads, last 30 days" value={traffic ? leads30 : null} sub={missing(st.connected.ga4, !st.has.traffic) ?? (callsTracked ? `${d.website.last30.formSubmissions} forms · ${d.website.last30.calls} calls` : "Contact forms filled out")} delta={<Delta now={leads30} prev={leadsPrev} />} />
        <Stat label="Website visits, last 30 days" value={traffic ? d.website.last30.sessions : null} sub={missing(st.connected.ga4, !st.has.traffic) ?? `${fmt.int(d.website.last30.users)} people`} delta={<Delta now={d.website.last30.sessions} prev={d.website.prev30.sessions} />} />
        <Stat label="Clicks from Google, last 90 days" value={search ? d.seo.totals90.clicks : null} sub={missing(st.connected.gsc, !st.has.seo) ?? `Average spot on Google: #${d.seo.totals90.position}`} delta={<Delta now={d.seo.totals90.clicks} prev={d.seo.prev90.clicks} />} />
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
                    <p className="text-xs text-ink-muted mt-0.5">{fmt.date(a.at)}</p>
                  </div>
                </li>
              );
            })}
            {d.activity.length === 0 && <li className="text-sm text-ink-muted">Everything we do for you shows up here.</li>}
          </ul>
        </div>
      </div>

      <SubHead>Where things stand</SubHead>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {shown.has("/autopilot") && (
        <Link href="/autopilot" className="panel p-5 hover:border-ink transition">
          <div className="flex items-center justify-between mb-4"><Bot className="h-5 w-5" />{!auto.settings.enabled ? <span className="pill pill-warn">Off</span> : autoWaiting ? <span className="pill pill-warn">{autoWaiting} to approve</span> : <span className="pill pill-good">On</span>}</div>
          <p className="font-display text-xl mb-1">SEO Autopilot</p>
          <p className="text-sm text-ink-muted">{auto.settings.enabled ? `${autoLive} post${autoLive === 1 ? "" : "s"} live · next ${auto.settings.nextRunAt ? fmt.date(auto.settings.nextRunAt) : "soon"}` : auto.settings.access ? "A post a week, written and published for you. Two questions to start." : "A post a week, written and published for you. Start your plan here."}</p>
        </Link>
        )}
        {shown.has("/website") && (
        <Link href="/website" className="panel p-5 hover:border-ink transition">
          <div className="flex items-center justify-between mb-4"><Globe className="h-5 w-5" />{health ? <span className="pill pill-neutral">Grade {health.summary.grade}</span> : <StatusPill status={d.website.status} />}</div>
          <p className="font-display text-xl mb-1">Website</p>
          <p className="text-sm text-ink-muted">{d.website.checks.length ? `${d.website.uptimePct}% uptime${d.website.responseMs ? ` · responds in ${(d.website.responseMs / 1000).toFixed(1)}s` : ""}` : "First check runs tonight"}</p>
        </Link>
        )}
        {shown.has("/seo") && (
        <Link href="/seo" className="panel p-5 hover:border-ink transition">
          <div className="flex items-center justify-between mb-4"><Search className="h-5 w-5" />{search ? <span className="pill pill-neutral">{d.seo.keywords.filter((k) => k.position <= 10).length} in top 10</span> : health?.seo ? <span className="pill pill-neutral">Search health {health.seo.score}</span> : <span className="pill pill-warn">Needs access</span>}</div>
          <p className="font-display text-xl mb-1">Search</p>
          <p className="text-sm text-ink-muted">{st.connected.gbp && st.has.gbp ? `${fmt.int(d.seo.gbp.calls)} calls from your Google listing this month` : search ? `${fmt.int(d.seo.totals90.clicks)} Google clicks in 90 days` : "Connect Search Console to see rankings"}</p>
        </Link>
        )}
        {shown.has("/social") && (
        <Link href="/social" className="panel p-5 hover:border-ink transition">
          <div className="flex items-center justify-between mb-4"><Share2 className="h-5 w-5" />{social ? <span className="pill pill-neutral">{d.social.posts.filter((p) => p.status === "scheduled").length} scheduled</span> : <span className="pill pill-warn">Needs access</span>}</div>
          <p className="font-display text-xl mb-1">Social</p>
          <p className="text-sm text-ink-muted">{social ? `${fmt.compact(ig!.reach30)} people reached on Instagram · 30d` : "Connect Facebook to see your reach"}</p>
        </Link>
        )}
        {shown.has("/estimator") && (
        <Link href="/estimator" className="panel p-5 hover:border-ink transition">
          <div className="flex items-center justify-between mb-4"><Calculator className="h-5 w-5" />{newQuoteLeads > 0 ? <span className="pill pill-warn">{newQuoteLeads} new leads</span> : <span className="pill pill-neutral">{d.estimator.embedded ? `${d.estimator.stats30.generated} quotes` : "Not on your site yet"}</span>}</div>
          <p className="font-display text-xl mb-1">Quote tool</p>
          <p className="text-sm text-ink-muted">{d.estimator.embedded ? `${fmt.int(d.estimator.stats30.generated)} 3D quotes · ${fmt.int(d.estimator.stats30.leads)} left details` : "Photo → 3D twin with live pricing. Try it at 3d.unifictional.com: two scans free."}</p>
        </Link>
        )}
      </div>
    </>
  );
}

type Pair = { now: number; prev: number } | null;
const n = (x: number) => x.toLocaleString("en-US");
const vsLast = (x: NonNullable<Pair>) => {
  const diff = x.now - x.prev;
  return x.prev === 0 || diff === 0 ? "" : ` (${n(Math.abs(diff))} ${diff > 0 ? "more" : "fewer"} than the month before)`;
};

/** One plain sentence for the top of Overview, built only from numbers we actually have. */
function summarize(o: { leads: Pair; visits: Pair; posts: number }): string | null {
  const parts: string[] = [];
  if (o.leads) parts.push(`${n(o.leads.now)} lead${o.leads.now === 1 ? "" : "s"} came in through your website${vsLast(o.leads)}`);
  if (o.visits) parts.push(`your site had ${n(o.visits.now)} visit${o.visits.now === 1 ? "" : "s"}${vsLast(o.visits)}`);
  if (o.posts) parts.push(`${o.posts} SEO article${o.posts === 1 ? " is" : "s are"} live and working for you`);
  if (!parts.length) return null;
  const last = parts.pop()!;
  return `In the last 30 days, ${parts.length ? `${parts.join(", ")}, and ${last}` : last}.`;
}

/** The nightly sync normally lands every ~24h; a day and a half without one means something is stuck. */
function syncLooksStuck(lastSyncAt: string | null | undefined): boolean {
  return lastSyncAt ? Date.now() - new Date(lastSyncAt).getTime() > 36 * 3_600_000 : false;
}

/** Same rule as the menu (components/Sidebar.tsx navFor, a client module): paid add-ons only show when bought. */
const NEEDS: Record<string, string[]> = { "/social": ["social"], "/estimator": ["quote", "estimat", "3d"] };
function shownAreas(services: string[] | undefined, admin: boolean): Set<string> {
  const have = (services ?? []).map((s) => s.toLowerCase());
  const all = ["/autopilot", "/website", "/seo", "/social", "/estimator"];
  return new Set(all.filter((href) => admin || !NEEDS[href] || have.length === 0 || NEEDS[href].some((n) => have.some((s) => s.includes(n)))));
}
