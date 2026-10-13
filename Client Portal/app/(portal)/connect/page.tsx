import Link from "next/link";
import { ArrowUpRight, Check, Circle } from "lucide-react";
import { Section } from "@/components/Section";
import { getConnectionStatus, getSession } from "@/lib/data/repo";
import { STUDIO_EMAIL } from "@/lib/guides";

const SOURCES = [
  { key: "site", name: "Website", what: "Uptime and speed checks", guide: null },
  { key: "ga4", name: "Google Analytics", what: "Visits, people, leads", guide: "google-analytics" },
  { key: "gsc", name: "Google Search Console", what: "Google clicks and keyword positions", guide: "search-console" },
  { key: "gbp", name: "Google Business Profile", what: "Map views, calls, directions, reviews", guide: "business-profile" },
  { key: "meta", name: "Facebook & Instagram", what: "Followers, reach, post performance", guide: "facebook-instagram" },
] as const;

export default async function ConnectPage() {
  const session = await getSession();
  const status = await getConnectionStatus(session);
  const missing = SOURCES.filter((s) => !status[s.key]);
  return (
    <>
      <Section num="07" label="Connections" title="Where your numbers come from."
        intro={missing.length ? `${missing.length} of ${SOURCES.length} sources still need access. Each one takes a few clicks on your side; we handle everything else.` : "Every source is connected. Your pages update daily."} />
      <div className="grid md:grid-cols-2 gap-4">
        {SOURCES.map((s) => {
          const on = status[s.key];
          return (
            <div key={s.key} className="panel p-5 flex gap-4">
              <span className={`mt-0.5 h-7 w-7 rounded-full grid place-items-center shrink-0 ${on ? "bg-good-bg text-good" : "bg-sand text-ink-muted"}`}>{on ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display text-xl">{s.name}</p>
                  <span className={`pill ${on ? "pill-good" : "pill-neutral"}`}>{on ? "connected" : "needs access"}</span>
                </div>
                <p className="text-sm text-ink-muted mt-0.5">{s.what}</p>
                {!on && s.guide && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/guide/${s.guide}?for=${encodeURIComponent(session.client?.name ?? "")}`} className="btn btn-ink min-h-11 !px-4 text-sm">How to give us access <ArrowUpRight className="h-4 w-4" /></Link>
                    <a href={`mailto:${STUDIO_EMAIL}?subject=${encodeURIComponent(`Help connecting ${s.name}`)}`} className="btn btn-ghost min-h-11 !px-4 text-sm">Do it with me on a call</a>
                  </div>
                )}
                {!on && !s.guide && <p className="mt-2 text-xs text-ink-muted">We just need your website address on file. Email {STUDIO_EMAIL}.</p>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-8 text-xs text-ink-muted max-w-2xl">We only ever ask for read-only or manager access, never your passwords, and you can remove us from any account at any time. New data appears within one business day of access being granted.</p>
    </>
  );
}
