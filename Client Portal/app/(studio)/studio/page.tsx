import Link from "next/link";
import { ArrowUpRight, FileSearch, LifeBuoy, UserPlus, Calculator } from "lucide-react";
import { getSession } from "@/lib/data/repo";
import { getInbox, newLeadsSince, type ItemKind } from "@/lib/data/studio";
import { ago } from "@/lib/ago";
import { cn } from "@/lib/utils";

const KIND: Record<ItemKind, { label: string; icon: typeof FileSearch }> = {
  inspection: { label: "Inspection lead", icon: FileSearch },
  signup: { label: "Account request", icon: UserPlus },
  support: { label: "Support", icon: LifeBuoy },
  quote: { label: "Quote lead", icon: Calculator },
};
const TABS: { key: string; label: string; kinds: ItemKind[] }[] = [
  { key: "all", label: "Everything", kinds: ["inspection", "signup", "support", "quote"] },
  { key: "leads", label: "Leads for us", kinds: ["inspection", "signup"] },
  { key: "support", label: "Client support", kinds: ["support"] },
  { key: "quotes", label: "Clients' quote leads", kinds: ["quote"] },
];
const STATUS_TONE: Record<string, string> = {
  new: "pill-warn", open: "pill-warn", contacted: "pill-neutral", in_progress: "pill-neutral", qualified: "pill-neutral",
  won: "pill-good", done: "pill-good", lost: "pill-bad", quoted: "pill-neutral",
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string; show?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  const all = await getInbox(session);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const showAll = sp.show === "all";
  const items = all.filter((i) => tab.kinds.includes(i.kind) && (showAll || i.open));
  const stat = (k: ItemKind[], openOnly = true) => all.filter((i) => k.includes(i.kind) && (!openOnly || i.open)).length;
  const newThisWeek = newLeadsSince(all, 7);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="label mb-2">Studio · Inbox</p>
          <h1 className="font-display text-3xl sm:text-4xl leading-none">What needs you today.</h1>
        </div>
        <Link href="/" className="btn btn-ghost !py-2 !px-4 text-xs" target="_blank">Landing page <ArrowUpRight className="h-3.5 w-3.5" /></Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[
          ["New leads this week", newThisWeek, "inspections + account requests"],
          ["Leads to work", stat(["inspection", "signup"]), "new, contacted or qualified"],
          ["Open support", stat(["support"]), "from clients' Requests page"],
          ["Clients' new quote leads", stat(["quote"]), "homeowners waiting on a call"],
        ].map(([l, v, s]) => (
          <div key={String(l)} className="panel p-4">
            <p className="label !text-[9px] mb-2">{l}</p>
            <p className="font-display text-3xl leading-none">{v}</p>
            <p className="text-[11px] text-ink-muted mt-1.5">{s}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const n = stat(t.kinds);
            return (
              <Link key={t.key} href={`/studio?tab=${t.key}${showAll ? "&show=all" : ""}`} className={cn("rounded-full px-3.5 py-1.5 text-xs border transition", t.key === tab.key ? "bg-ink text-bone border-ink" : "border-line hover:border-ink")}>
                {t.label} <span className="font-mono opacity-60">{n}</span>
              </Link>
            );
          })}
        </div>
        <Link href={`/studio?tab=${tab.key}${showAll ? "" : "&show=all"}`} className="text-xs text-ink-muted underline">{showAll ? "Show only open" : "Include closed"}</Link>
      </div>

      <div className="panel divide-y divide-line overflow-hidden">
        {items.length === 0 && (
          <div className="p-10 text-center">
            <p className="font-display text-2xl mb-1">Inbox zero.</p>
            <p className="text-sm text-ink-muted">New inspection leads, account requests and client support requests land here the moment they come in.</p>
          </div>
        )}
        {items.map((i) => {
          const K = KIND[i.kind];
          return (
            <Link key={`${i.kind}-${i.id}`} href={i.href} className="flex items-center gap-4 p-4 hover:bg-paper transition">
              <span className="h-9 w-9 rounded-full bg-sand grid place-items-center shrink-0"><K.icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="font-medium truncate">{i.title}</p>
                  {i.company && <span className="text-xs text-ink-muted truncate hidden sm:inline">· {i.company.name}</span>}
                </div>
                <p className="text-xs text-ink-muted truncate">{i.subtitle}{i.who ? ` · ${i.who}` : ""}</p>
              </div>
              <span className="label !text-[9px] hidden md:inline whitespace-nowrap">{K.label}</span>
              <span className={cn("pill shrink-0", STATUS_TONE[i.status] ?? "pill-neutral")}>{i.status.replace("_", " ")}</span>
              <span className="text-xs text-ink-muted w-16 text-right shrink-0">{ago(i.at)}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
