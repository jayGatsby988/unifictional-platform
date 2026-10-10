import Link from "next/link";
import { Clock, Plug, PlayCircle } from "lucide-react";
import type { PortalStatus, SourceKey } from "@/lib/data/types";
import { cn, fmt } from "@/lib/utils";

export const SOURCE_INFO: Record<SourceKey, { name: string; what: string; guide: string | null; request: string }> = {
  site: { name: "Your website address", what: "uptime, speed and the nightly health check", guide: null, request: "website" },
  ga4: { name: "Google Analytics", what: "visits, people and leads from your website", guide: "google-analytics", request: "website" },
  gsc: { name: "Google Search Console", what: "Google clicks, impressions and keyword positions", guide: "search-console", request: "seo" },
  gbp: { name: "Google Business Profile", what: "map views, calls, directions and reviews", guide: "business-profile", request: "seo" },
  meta: { name: "Facebook & Instagram", what: "followers, reach and how each post did", guide: "facebook-instagram", request: "social" },
};

/** Shown in place of numbers when the source behind them isn't connected yet. */
export function NotConnected({ source, className, compact = false }: { source: SourceKey; className?: string; compact?: boolean }) {
  const s = SOURCE_INFO[source];
  return (
    <div className={cn("panel border-dashed p-6 sm:p-8", className)}>
      <div className="flex flex-wrap items-start gap-4">
        <span className="h-11 w-11 rounded-full bg-sand grid place-items-center shrink-0"><Plug className="h-5 w-5" /></span>
        <div className="flex-1 min-w-[14rem]">
          <p className="font-display text-xl sm:text-2xl leading-tight">Connect {s.name} to see this.</p>
          {!compact && <p className="mt-1 text-ink-muted">It gives us {s.what}. It takes a few minutes, and we only ever ask for read-only access.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {s.guide && <Link href={`/guide/${s.guide}`} className="btn btn-ink !py-2 !px-4 text-sm"><PlayCircle className="h-4 w-4" /> Show me how</Link>}
            <Link href={`/requests?type=${s.request}&about=${encodeURIComponent(`Connect ${s.name}`)}`} className="btn btn-ghost !py-2 !px-4 text-sm">Have us do it with you</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Connected, but the first sync hasn't produced numbers yet. */
export function Waiting({ source, status, className }: { source: SourceKey; status: PortalStatus; className?: string }) {
  return (
    <div className={cn("panel p-6 sm:p-8", className)}>
      <div className="flex items-start gap-4">
        <span className="h-11 w-11 rounded-full bg-good-bg text-good grid place-items-center shrink-0"><Clock className="h-5 w-5" /></span>
        <div>
          <p className="font-display text-xl sm:text-2xl leading-tight">{SOURCE_INFO[source].name} is connected.</p>
          <p className="mt-1 text-ink-muted">Your first numbers arrive after the next nightly update. {status.lastSyncAt ? `Last update ${fmt.dateLong(status.lastSyncAt)}.` : "Nothing to do on your side."}</p>
        </div>
      </div>
    </div>
  );
}

/** Render children only when the source is connected and has data; otherwise the right message. */
export function SourceGate({ source, has, status, children, className }: { source: SourceKey; has: boolean; status: PortalStatus; children: React.ReactNode; className?: string }) {
  if (!status.connected[source]) return <NotConnected source={source} className={className} />;
  if (!has) return <Waiting source={source} status={status} className={className} />;
  return <>{children}</>;
}
