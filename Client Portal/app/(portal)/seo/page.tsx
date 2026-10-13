import { ArrowDown, ArrowUp, Minus, Star } from "lucide-react";
import { Section, SubHead } from "@/components/Section";
import { Delta, Stat } from "@/components/Stat";
import { TrendLazy as Trend } from "@/components/charts/TrendLazy";
import { getPortal } from "@/lib/data/repo";
import { NotConnected, SourceGate } from "@/components/Gate";
import { cn, fmt } from "@/lib/utils";

function Move({ now, prev }: { now: number; prev: number | null }) {
  if (prev === null) return <span className="pill pill-good">new</span>;
  const diff = prev - now;
  if (diff === 0) return <span className="inline-flex items-center gap-1 text-xs text-ink-muted"><Minus className="h-3 w-3" />0</span>;
  const up = diff > 0;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", up ? "text-good" : "text-bad")}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(diff)}
    </span>
  );
}

export default async function SeoPage() {
  const d = await getPortal();
  const s = d.seo;
  const top3 = s.keywords.filter((k) => k.position <= 3).length;
  const top10 = s.keywords.filter((k) => k.position <= 10).length;
  const local = (d.website.health?.seo?.rankings ?? []).filter((r) => r.checked);

  return (
    <>
      <Section num="02" label="Search" title="Search visibility."
        intro="How often you show up on Google, how often people click, and what we did about it." />

      {!d.status.connected.gsc && d.website.health?.seo && (
        <div className="rounded-2xl bg-ink text-bone p-6 sm:p-8 mb-6 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div><p className="font-display text-6xl leading-none">{d.website.health.seo.score}<span className="text-xl">/100</span></p><p className="label !text-bone/50 mt-1">Search health, from our nightly check</p></div>
          <div className="flex-1 min-w-[15rem]">
            <p className="font-display text-xl sm:text-2xl leading-tight">{d.website.health.seo.verdict}</p>
            <p className="text-sm text-bone/60 mt-2">{d.website.health.seo.issues.length} things to improve. Exact Google clicks and rankings appear once Search Console is connected.</p>
          </div>
        </div>
      )}

      <SourceGate source="gsc" has={d.status.has.seo} status={d.status} className="mb-10">

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Clicks from Google" value={s.totals90.clicks} delta={<Delta now={s.totals90.clicks} prev={s.prev90.clicks} />} sub="last 90 days, vs. the 90 before" />
        <Stat label="Times you showed up on Google" value={fmt.compact(s.totals90.impressions)} delta={<Delta now={s.totals90.impressions} prev={s.prev90.impressions} />} sub="last 90 days" />
        <Stat label="Average spot on Google" value={s.totals90.position} delta={<Delta now={s.totals90.position} prev={s.prev90.position} invert />} sub="1 = top of the page. Lower is better." />
        <Stat label="Searches on page one" value={top10} sub={`top 10 results. ${top3} in the top 3.`} />
      </div>

      <div className="panel p-5 mb-10">
        <SubHead>Clicks and times shown, daily · last 90 days</SubHead>
        <Trend data={s.daily} keys={[{ key: "clicks", name: "Clicks" }, { key: "impressions", name: "Times shown", dashed: true }]} height={260} />
      </div>
      </SourceGate>

      <div className="grid lg:grid-cols-3 gap-4 mb-10">
        {d.status.connected.gsc && s.keywords.length > 0 ? (
        <div className="panel p-5 lg:col-span-2">
          <SubHead right={<span className="label !text-xs hidden sm:inline">Spot on Google · change vs. last month</span>}>Keywords we track</SubHead>
          <div className="hidden sm:block overflow-x-auto">
          <table className="table w-full min-w-[560px]">
            <thead><tr><th>Keyword</th><th className="text-right">Spot</th><th className="text-right">Change</th><th className="text-right">Clicks</th><th>Page</th></tr></thead>
            <tbody>
              {s.keywords.map((k) => (
                <tr key={k.keyword}>
                  <td>{k.keyword}</td>
                  <td className="text-right"><span className={cn("font-display text-lg", k.position <= 3 && "text-good")}>{k.position}</span></td>
                  <td className="text-right"><Move now={k.position} prev={k.prevPosition} /></td>
                  <td className="text-right font-mono text-xs">{fmt.int(k.clicks)}</td>
                  <td className="font-mono text-xs text-ink-muted truncate max-w-[180px]">{k.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {/* Phones: one card per keyword instead of a sideways-scrolling table. */}
          <ul className="sm:hidden divide-y divide-line">
            {s.keywords.map((k) => (
              <li key={k.keyword} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium min-w-0">{k.keyword}</p>
                  <span className={cn("font-display text-lg leading-none shrink-0", k.position <= 3 && "text-good")}>#{k.position}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                  <span className="inline-flex items-center gap-1.5">vs. last month <Move now={k.position} prev={k.prevPosition} /></span>
                  <span>{fmt.int(k.clicks)} clicks</span>
                </div>
                <p className="mt-1 font-mono text-xs text-ink-muted truncate">{k.url}</p>
              </li>
            ))}
          </ul>
        </div>
        ) : (
          <div className="panel p-5 lg:col-span-2">
            <SubHead right={local.length ? <span className="text-sm text-ink-muted">Checked {d.website.healthAt ? fmt.date(d.website.healthAt) : "nightly"}</span> : undefined}>
              {local.length ? "Local searches we check" : "Keywords we track"}
            </SubHead>
            {local.length > 0 && (
              <ul className="divide-y divide-line mb-4">
                {local.map((r) => (
                  <li key={r.query} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm">{r.query}</span>
                    {r.position !== null && r.position <= 10
                      ? <span className="pill pill-good shrink-0">#{r.position} on Google</span>
                      : <span className="pill pill-bad shrink-0">Not on page one</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-ink-muted">{d.status.connected.gsc ? "Your full keyword list with clicks appears after the next nightly update." : local.length ? "These are the searches homeowners near you type. Once Search Console is connected, every search you show up for is listed here with clicks and how it moved." : "Once Search Console is connected, every search you show up for is listed here with its position and how it moved."}</p>
          </div>
        )}

        {!d.status.connected.gbp ? <NotConnected source="gbp" compact /> : !d.status.has.gbp ? (
          <div className="panel p-5"><SubHead>Google Business Profile</SubHead><p className="text-sm text-ink-muted">Connected. Your listing&apos;s numbers arrive after the next nightly update.</p></div>
        ) : (
        <div className="panel p-5">
          <SubHead>Google Business Profile · last 30 days</SubHead>
          <div className="flex items-center gap-2 mb-5">
            <span className="font-display text-4xl leading-none">{s.gbp.rating.toFixed(1)}</span>
            <div className="flex text-ink">{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn("h-4 w-4", i <= Math.round(s.gbp.rating) ? "fill-current" : "text-line")} />)}</div>
            <span className="text-xs text-ink-muted ml-1">{s.gbp.reviews} reviews · +{s.gbp.newReviews30} this month</span>
          </div>
          <dl className="space-y-3">
            {[
              ["Profile views", s.gbp.views, s.gbp.prev.views],
              ["Calls", s.gbp.calls, s.gbp.prev.calls],
              ["Direction requests", s.gbp.directions, s.gbp.prev.directions],
              ["Website clicks", s.gbp.websiteClicks, s.gbp.prev.websiteClicks],
            ].map(([label, now, prev]) => (
              <div key={String(label)} className="flex items-center justify-between border-b border-line pb-2 last:border-0">
                <dt className="text-sm">{label}</dt>
                <dd className="flex items-center gap-2"><span className="font-mono text-sm">{fmt.int(Number(now))}</span><Delta now={Number(now)} prev={Number(prev)} /></dd>
              </div>
            ))}
          </dl>
        </div>
        )}
      </div>

      <div className="panel p-5">
        <SubHead>What we did</SubHead>
        <ol className="relative border-l border-line ml-2 space-y-5">
          {s.workLog.map((w, i) => (
            <li key={i} className="pl-5">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-ink" />
              <p className="text-sm text-ink-muted mb-1">{fmt.dateLong(w.at)}</p>
              <p className="font-medium text-sm">{w.title}</p>
              <p className="text-sm text-ink-muted">{w.detail}</p>
            </li>
          ))}
          {s.workLog.length === 0 && <li className="pl-5 text-sm text-ink-muted">Work log starts once our first round of Google improvements is done.</li>}
        </ol>
      </div>
    </>
  );
}
