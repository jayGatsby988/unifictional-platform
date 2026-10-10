import { Bookmark, Heart, MessageCircle, Clapperboard, Images, Image as ImageIcon } from "lucide-react";
import { Section, SubHead } from "@/components/Section";
import { Delta, StatusPill } from "@/components/Stat";
import { TrendLazy as Trend } from "@/components/charts/TrendLazy";
import { getPortal } from "@/lib/data/repo";
import { SourceGate } from "@/components/Gate";
import { cn, fmt } from "@/lib/utils";

const KIND = { reel: Clapperboard, carousel: Images, image: ImageIcon, story: ImageIcon } as const;

export default async function SocialPage() {
  const d = await getPortal();
  const s = d.social;
  const published = s.posts.filter((p) => p.status === "published");
  const scheduled = s.posts.filter((p) => p.status === "scheduled").sort((a, b) => a.at.localeCompare(b.at));
  const best = [...published].sort((a, b) => b.reach - a.reach).slice(0, 4);

  return (
    <>
      <Section num="04" label="Social" title="Social & content."
        intro="A consistent, professional feed that makes your business look active. Here is what it reached." />

      <SourceGate source="meta" has={d.status.has.social} status={d.status}>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        {s.accounts.map((a) => (
          <div key={a.platform} className="panel p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="label mb-1">{a.platform}</p>
                <a href={a.url} target="_blank" rel="noreferrer" className="font-display text-xl hover:underline">{a.handle}</a>
              </div>
              <div className="text-right">
                <p className="font-display text-3xl leading-none">{fmt.int(a.followers)}</p>
                <p className="text-xs mt-1"><Delta now={a.followers} prev={a.followers - a.followersDelta30} /> <span className="text-ink-muted">followers · 30d</span></p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[["Reach", fmt.compact(a.reach30)], ["Profile visits", fmt.int(a.profileVisits30)], ["Posts", a.posts30], ["Engagement", `${a.engagementRatePct}%`]].map(([l, v]) => (
                <div key={String(l)} className="rounded-xl bg-paper py-3">
                  <p className="font-mono text-sm">{v}</p>
                  <p className="label !text-[8px] mt-1">{l}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        {s.accounts.length === 0 && <div className="panel p-5 text-sm text-ink-muted">No social accounts connected yet.</div>}
      </div>

      <div className="panel p-5 mb-10">
        <SubHead>Instagram reach, daily · 30d</SubHead>
        <Trend data={s.reachDaily} keys={[{ key: "value", name: "Reach" }]} height={220} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SubHead>Top posts · 30d</SubHead>
          <div className="grid sm:grid-cols-2 gap-4">
            {best.length === 0 && <p className="panel p-5 text-sm text-ink-muted sm:col-span-2">Your best posts of the month show up here.</p>}
            {best.map((p) => {
              const Icon = KIND[p.kind];
              return (
                <article key={p.id} className="panel overflow-hidden">
                  <div className={cn("aspect-[4/3] bg-gradient-to-br relative", p.tone)}>
                    <span className="absolute top-3 left-3 pill !bg-black/40 !text-white inline-flex items-center gap-1"><Icon className="h-3 w-3" />{p.kind}</span>
                    <span className="absolute bottom-3 right-3 font-mono text-[10px] text-white/80">{fmt.compact(p.reach)} reach</span>
                  </div>
                  <div className="p-4">
                    <p className="text-sm leading-snug line-clamp-2">{p.caption}</p>
                    <div className="mt-3 flex items-center gap-4 text-xs text-ink-muted">
                      <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{fmt.int(p.likes)}</span>
                      <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{p.comments}</span>
                      <span className="inline-flex items-center gap-1"><Bookmark className="h-3.5 w-3.5" />{p.saves}</span>
                      <span className="ml-auto label !text-[9px]">{p.platform} · {fmt.date(p.at)}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
        <div>
          <SubHead>Coming up</SubHead>
          <div className="panel divide-y divide-line">
            {scheduled.map((p) => (
              <div key={p.id} className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="label !text-[9px]">{fmt.dateLong(p.at)} · {p.platform}</span>
                  <StatusPill status={p.status} />
                </div>
                <p className="text-sm leading-snug">{p.caption}</p>
              </div>
            ))}
            {scheduled.length === 0 && <p className="p-4 text-sm text-ink-muted">Nothing scheduled yet.</p>}
          </div>
        </div>
      </div>
      </SourceGate>
    </>
  );
}
