import { cn, fmt } from "@/lib/utils";

export type CalendarEntry = { date: string; kind: "published" | "awaiting" | "scheduled" | "fixed"; title: string; href?: string };

const KIND: Record<CalendarEntry["kind"], { chip: string; dot: string; label: string }> = {
  published: { chip: "bg-good-bg text-good", dot: "bg-good", label: "Published" },
  awaiting: { chip: "bg-warn-bg text-warn", dot: "bg-warn", label: "Waiting for you" },
  scheduled: { chip: "border border-dashed border-line text-ink-muted", dot: "border border-ink-muted", label: "Scheduled" },
  fixed: { chip: "bg-sand text-ink-soft", dot: "bg-ink-muted", label: "Fix done" },
};

const dayKey = (iso: string) => iso.slice(0, 10);

function Month({ year, month, entries, today }: { year: number; month: number; entries: Map<string, CalendarEntry[]>; today: string }) {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <div>
      <p className="label mb-2">{first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
      <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden border border-line bg-line">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="bg-paper py-1 text-center font-mono text-[9px] text-ink-muted">{d}</div>)}
        {cells.map((d, i) => {
          const key = d ? `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
          const list = d ? entries.get(key) ?? [] : [];
          return (
            <div key={i} className={cn("bg-bone min-h-[4.5rem] p-1", !d && "bg-paper/60", key === today && "bg-paper")}>
              {d && <p className={cn("font-mono text-[10px] mb-1", key === today ? "text-ink font-medium" : "text-ink-muted")}>{d}</p>}
              {list.slice(0, 2).map((e, j) => {
                const chip = <span className={cn("block truncate rounded px-1 py-0.5 text-[10px] leading-tight", KIND[e.kind].chip)} title={e.title}>{e.title}</span>;
                return e.href ? <a key={j} href={e.href} target="_blank" rel="noreferrer" className="block mb-0.5">{chip}</a> : <div key={j} className="mb-0.5">{chip}</div>;
              })}
              {list.length > 2 && <p className="text-[9px] text-ink-muted">+{list.length - 2} more</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * This month and next: what went live, what's waiting, and when the next
 * planned posts land. Scheduled dates are projected from the cadence, so
 * they're "about": the daily run can land a day later.
 */
export function Calendar({ entries, now = new Date() }: { entries: CalendarEntry[]; now?: Date }) {
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of entries) byDay.set(dayKey(e.date), [...(byDay.get(dayKey(e.date)) ?? []), e]);
  const today = now.toISOString().slice(0, 10);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const upcoming = entries.filter((e) => e.kind === "scheduled" && e.date >= now.toISOString()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  return (
    <div className="panel p-5">
      <div className="hidden md:grid md:grid-cols-2 gap-5">
        <Month year={y} month={m} entries={byDay} today={today} />
        <Month year={m === 11 ? y + 1 : y} month={(m + 1) % 12} entries={byDay} today={today} />
      </div>
      <div className="md:hidden">
        <p className="label mb-2">Next up</p>
        <ul className="divide-y divide-line">
          {upcoming.map((e, i) => <li key={i} className="py-2 flex gap-3 text-sm"><span className="font-mono text-xs text-ink-muted w-14 shrink-0">{fmt.date(e.date)}</span><span className="truncate">{e.title}</span></li>)}
          {upcoming.length === 0 && <li className="py-2 text-sm text-ink-muted">Nothing scheduled yet.</li>}
        </ul>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
        {(Object.keys(KIND) as CalendarEntry["kind"][]).map((k) => <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted"><span className={cn("h-2 w-2 rounded-full", KIND[k].dot)} />{KIND[k].label}</span>)}
        <span className="text-[11px] text-ink-muted">· scheduled dates are approximate</span>
      </div>
    </div>
  );
}
