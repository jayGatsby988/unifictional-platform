import Link from "next/link";
import { Section, SubHead } from "@/components/Section";
import { Stat } from "@/components/Stat";
import { AutopilotForm } from "@/components/autopilot/AutopilotForm";
import { Calendar, type CalendarEntry } from "@/components/autopilot/Calendar";
import { Fixes } from "@/components/autopilot/Fixes";
import { PostCard } from "@/components/autopilot/PostCard";
import { Upcoming } from "@/components/autopilot/Upcoming";
import { WriteNow } from "@/components/autopilot/WriteNow";
import { getSession } from "@/lib/data/repo";
import { getAutopilot } from "@/lib/data/autopilot";
import { AUTO_PUBLISH_BAR } from "@/lib/autopilot/quality";
import { cadenceLabel, projectSchedule } from "@/lib/autopilot/schedule";
import { fmt } from "@/lib/utils";

const HOW = [
  ["Pick the search", "We look at what your site ranks for, what it doesn't, and what homeowners near you actually type into Google."],
  ["Write and check", "900–1,400 words in your voice, linked to your own pages, with the questions people ask — then scored against a 10-point SEO checklist and fixed before you see it."],
  ["Publish and improve", "It goes on your site (or waits for your OK), and we list the on-page fixes that matter most, with a checklist to work through."],
];

export default async function AutopilotPage() {
  const session = await getSession();
  if (!session.client) return null;
  const c = session.client;
  const a = await getAutopilot(session);
  const s = a.settings;
  const awaiting = a.posts.filter((p) => p.status === "awaiting_approval");
  const others = a.posts.filter((p) => p.status !== "awaiting_approval");
  const published = a.posts.filter((p) => p.status === "published");
  const latest = a.runs.find((r) => r.fixes.length);
  const allFixes = a.runs.flatMap((r) => r.fixes);
  const fixesDone = allFixes.filter((f) => f.done).length;
  const clicks = published.reduce((n, p) => n + (p.performance?.clicks ?? 0), 0);
  const upcoming = s.plan.filter((p) => p.status === "planned").length;
  const schedule = projectSchedule(s.plan, s.nextRunAt, s.cadence);
  const dates = Object.fromEntries(schedule.map((x) => [x.id, x.date]));
  const titles = new Map(s.plan.map((p) => [p.id, p.title]));
  const entries: CalendarEntry[] = [
    ...published.map((p) => ({ date: p.publishedAt ?? p.createdAt, kind: "published" as const, title: p.title, href: p.publishedUrl ?? undefined })),
    ...awaiting.map((p) => ({ date: p.createdAt, kind: "awaiting" as const, title: p.title })),
    ...schedule.map((x) => ({ date: x.date, kind: "scheduled" as const, title: titles.get(x.id) ?? "Planned post" })),
  ];

  if (!s.enabled) {
    return (
      <>
        <Section num="03" label="SEO Autopilot" title="Your SEO, on autopilot."
          intro="Every week we write and publish a blog post aimed at a search homeowners near you actually type, check it against an SEO checklist, and list the fixes that move your site up. Answer two questions once; we handle the rest." />
        <div className="grid lg:grid-cols-5 gap-4 mb-10">
          <div className="lg:col-span-3"><AutopilotForm settings={s} demo={session.isDemo} /></div>
          <div className="lg:col-span-2 space-y-4">
            <div className="panel p-5">
              <SubHead>What we already know</SubHead>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-ink-muted">Company</dt><dd className="text-right">{c.name}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-muted">Trade</dt><dd className="text-right">{c.industry || "Read from your website"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-muted">Area</dt><dd className="text-right">{c.city || "Read from your website"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-muted">Website</dt><dd className="text-right font-mono text-xs">{c.websiteUrl.replace(/^https?:\/\//, "") || "—"}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-ink-muted">Plus your Google search data and the nightly health check once they&apos;re connected. That&apos;s why there&apos;s no questionnaire.</p>
            </div>
            <div className="panel p-5">
              <SubHead>How it works</SubHead>
              <ol className="space-y-3 text-sm">
                {HOW.map(([t, d], i) => (
                  <li key={t} className="flex gap-3"><span className="font-mono text-xs text-ink-muted mt-0.5">0{i + 1}</span><div><p className="font-medium">{t}</p><p className="text-ink-muted">{d}</p></div></li>
                ))}
              </ol>
            </div>
          </div>
        </div>
        {a.posts.length > 0 && (
          <>
            <SubHead>Posts so far</SubHead>
            <div className="grid lg:grid-cols-2 gap-4">{a.posts.map((p) => <PostCard key={p.id} post={p} />)}</div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <Section num="03" label="SEO Autopilot" title="Your SEO, on autopilot."
        intro={`On. ${cadenceLabel(s.cadence)}. ${s.mode === "approve" ? "Each post waits for your OK before it goes live." : `Reviewed automatically: a post that passes the SEO checklist (${AUTO_PUBLISH_BAR}+) goes live on its own; anything under that waits for you.`}`}
        action={a.posts.length > 0 ? <WriteNow demo={session.isDemo} /> : undefined} />

      {a.posts.length === 0 && <div className="mb-10"><WriteNow big demo={session.isDemo} /></div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Stat label="Posts live on your site" value={published.length} sub={clicks ? `${fmt.int(clicks)} Google clicks so far` : "each written for a search near you"} />
        <Stat label="Waiting for your OK" value={awaiting.length} sub={awaiting.length ? "read, edit if you like, publish" : "nothing to do"} />
        <Stat label="Fixes done" value={allFixes.length ? `${fixesDone}/${allFixes.length}` : "—"} sub={allFixes.length ? "from the on-page checklist" : "arrive with the first post"} />
        <Stat label="Next post" value={s.nextRunAt ? fmt.date(s.nextRunAt) : "soon"} sub={upcoming ? `${upcoming} topics planned` : s.lastRunAt ? `last one ${fmt.date(s.lastRunAt)}` : "the first one is on its way"} />
      </div>

      {awaiting.length > 0 && (
        <section className="mb-10">
          <SubHead>Needs your OK</SubHead>
          <div className="space-y-4">{awaiting.map((p) => <PostCard key={p.id} post={p} open />)}</div>
        </section>
      )}

      <section className="mb-10">
        <SubHead right={<span className="label !text-[9px]">{published.length} live · {awaiting.length} waiting · {upcoming} scheduled</span>}>Calendar</SubHead>
        <Calendar entries={entries} />
      </section>

      <div className="grid lg:grid-cols-3 gap-4 mb-10">
        <div className="lg:col-span-2 space-y-8">
          <div>
            <SubHead>Posts</SubHead>
            <div className="space-y-4">
              {others.map((p) => <PostCard key={p.id} post={p} />)}
              {others.length === 0 && <div className="panel p-5 text-sm text-ink-muted">Nothing here yet. Your first post shows up {s.mode === "approve" ? "for your OK " : ""}after the next daily run — or hit Write a post now.</div>}
            </div>
          </div>
        </div>
        <div className="space-y-8">
          <div>
            <SubHead right={latest ? <span className="label !text-[9px]">{fmt.date(latest.ranAt)}</span> : undefined}>Fixes for your site</SubHead>
            {latest ? <Fixes runId={latest.id} fixes={latest.fixes} when={fmt.date(latest.ranAt)} /> : <div className="panel p-4 text-sm text-ink-muted">The first list of fixes arrives with your first post.</div>}
            <p className="mt-2 text-xs text-ink-muted">Your studio works through these as part of your plan. Want one done sooner? <Link className="underline" href="/requests?type=seo">Ask here</Link>.</p>
          </div>
          <div>
            <SubHead right={upcoming ? <span className="label !text-[9px]">{upcoming} planned</span> : undefined}>Coming up</SubHead>
            <Upcoming plan={s.plan} dates={dates} />
          </div>
        </div>
      </div>

      <details className="panel p-5">
        <summary className="text-sm font-medium cursor-pointer select-none">Settings: where it publishes, how often, what to push</summary>
        <div className="mt-4"><AutopilotForm settings={s} demo={session.isDemo} /></div>
      </details>
    </>
  );
}
