import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import type { PortalStatus, SourceKey } from "@/lib/data/types";
import { SOURCE_INFO } from "./Gate";
import { cn } from "@/lib/utils";

const ORDER: SourceKey[] = ["site", "ga4", "gsc", "gbp", "meta"];

/** First thing a new client sees: what's connected, what isn't, and the one-click guide for each. */
export function SetupChecklist({ status }: { status: PortalStatus }) {
  const done = ORDER.filter((k) => status.connected[k]).length;
  if (done === ORDER.length) return null;
  return (
    <section className="panel p-5 sm:p-7 mb-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="label mb-2">Getting set up</p>
          <h2 className="font-display text-2xl sm:text-3xl leading-none">{done} of {ORDER.length} connected. Let&apos;s finish.</h2>
          <p className="mt-2 text-ink-muted max-w-xl">Each one fills in part of this page. Tap one to see a one-minute walkthrough, or ask us to do it with you.</p>
        </div>
        <span className="font-display text-4xl">{Math.round((done / ORDER.length) * 100)}%</span>
      </div>
      <div className="h-2 rounded-full bg-sand overflow-hidden mb-5"><div className="h-full bg-ink rounded-full transition-all" style={{ width: `${(done / ORDER.length) * 100}%` }} /></div>
      <ul className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {ORDER.map((k) => {
          const on = status.connected[k];
          const s = SOURCE_INFO[k];
          const href = s.guide ? `/guide/${s.guide}` : `/requests?type=website&about=${encodeURIComponent("Add our website address")}`;
          const inner = (
            <>
              <span className={cn("h-7 w-7 rounded-full grid place-items-center shrink-0", on ? "bg-ink text-bone" : "border-2 border-line")}>{on && <Check className="h-4 w-4" />}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium leading-snug", on && "text-ink-muted line-through decoration-1")}>{s.name}</span>
                <span className="block text-xs text-ink-muted">{on ? "Connected" : "Needs access"}</span>
              </span>
              {!on && <ChevronRight className="h-4 w-4 text-ink-muted shrink-0" />}
            </>
          );
          return (
            <li key={k}>
              {on ? <div className="flex items-center gap-3 rounded-xl border border-line p-3 h-full">{inner}</div>
                : <Link href={href} className="flex items-center gap-3 rounded-xl border border-ink/20 p-3 h-full hover:border-ink hover:bg-paper transition">{inner}</Link>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
