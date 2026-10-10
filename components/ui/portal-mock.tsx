import { cn } from "@/lib/utils";

/**
 * A decorative, hand-built picture of the client portal's overview screen —
 * stat tiles, a daily-visits chart, and the latest homeowner quotes. Pure
 * markup (no data fetching) so it paints instantly and never breaks.
 *
 * `fixed` renders with the always-light "window" palette for use over the
 * always-black hero; otherwise it uses the themed tokens, so on a `bg-ink`
 * section it reads as a light window in light mode and a dark one in dark.
 *
 * The numbers are the portal's demo account, labelled as such.
 */
const STATS = [
  { label: "Leads · 30d", value: "41", sub: "29 forms · 12 calls", delta: "+18%" },
  { label: "Visits · 30d", value: "2,318", sub: "1,904 people", delta: "+11%" },
  { label: "Google clicks · 90d", value: "1,204", sub: "avg. position 6.8", delta: "+26%" },
  { label: "3D quotes · 30d", value: "27", sub: "9 left their details", delta: "+9" },
];

const BARS = [38, 44, 41, 52, 48, 57, 61, 55, 66, 72, 64, 78, 83, 76, 88, 94];

const QUOTES = [
  { project: "Detached ADU", size: "768 sq ft", range: "$302K – $355K", who: "Mill Creek", status: "New" },
  { project: "Kitchen remodel", size: "336 sq ft", range: "$109K – $128K", who: "Lake Stevens", status: "Contacted" },
  { project: "Deck", size: "420 sq ft", range: "$29K – $34K", who: "Everett", status: "Won" },
];

export function PortalMock({ fixed = false, className }: { fixed?: boolean; className?: string }) {
  const t = fixed
    ? {
        window: "border-bonefixed/20 bg-bonefixed text-inkfixed shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)]",
        bar: "border-inkfixed/10",
        dot: "bg-inkfixed/15",
        muted: "text-inkfixed/55",
        faint: "text-inkfixed/40",
        tile: "border-inkfixed/10 bg-inkfixed/[0.03]",
        pill: "bg-inkfixed/[0.06] text-inkfixed/70",
        barFill: "bg-inkfixed",
        barGhost: "bg-inkfixed/15",
        row: "border-inkfixed/10",
        chip: "bg-inkfixed text-bonefixed",
        chipSoft: "bg-inkfixed/[0.08] text-inkfixed/75",
      }
    : {
        window: "border-line bg-bone text-ink shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)]",
        bar: "border-line",
        dot: "bg-ink/15",
        muted: "text-ink-muted",
        faint: "text-ink-muted/70",
        tile: "border-line bg-paper",
        pill: "bg-sand text-ink-soft",
        barFill: "bg-ink",
        barGhost: "bg-ink/15",
        row: "border-line",
        chip: "bg-ink text-bone",
        chipSoft: "bg-sand text-ink-soft",
      };

  return (
    <div
      aria-hidden
      className={cn("w-full select-none overflow-hidden rounded-xl border", t.window, className)}
    >
      {/* Title bar */}
      <div className={cn("flex items-center justify-between border-b px-4 py-2.5", t.bar)}>
        <div className="flex items-center gap-3">
          <span className="flex gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", t.dot)} />
            <span className={cn("h-2 w-2 rounded-full", t.dot)} />
            <span className={cn("h-2 w-2 rounded-full", t.dot)} />
          </span>
          <span className={cn("font-mono text-[10px] uppercase tracking-label", t.muted)}>
            Northline Builders · Overview
          </span>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-label", t.pill)}>
          Demo account
        </span>
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className={cn("rounded-lg border p-3", t.tile)}>
              <p className={cn("font-mono text-[9px] uppercase tracking-label", t.muted)}>{s.label}</p>
              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <span className="font-display text-2xl font-medium leading-none">{s.value}</span>
                <span className={cn("rounded-full px-1.5 py-0.5 font-mono text-[9px]", t.chipSoft)}>
                  {s.delta}
                </span>
              </div>
              <p className={cn("mt-1.5 text-[10px]", t.faint)}>{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-5">
          {/* Daily visits */}
          <div className={cn("rounded-lg border p-3 sm:col-span-3", t.tile)}>
            <div className="flex items-center justify-between">
              <p className={cn("font-mono text-[9px] uppercase tracking-label", t.muted)}>
                Website visits, daily
              </p>
              <p className={cn("font-mono text-[9px] uppercase tracking-label", t.faint)}>Last 16 days</p>
            </div>
            <div className="mt-3 flex h-20 items-end gap-1">
              {BARS.map((h, i) => (
                <span
                  key={i}
                  style={{ height: `${h}%` }}
                  className={cn(
                    "flex-1 rounded-[2px]",
                    i >= BARS.length - 4 ? t.barFill : t.barGhost
                  )}
                />
              ))}
            </div>
          </div>

          {/* Status */}
          <div className={cn("rounded-lg border p-3 sm:col-span-2", t.tile)}>
            <p className={cn("font-mono text-[9px] uppercase tracking-label", t.muted)}>Where things stand</p>
            <ul className="mt-2.5 space-y-2 text-[11px]">
              {[
                ["Website", "99.98% uptime · speed 96"],
                ["Search", "14 keywords in top 10"],
                ["Social", "12.4K reach · 3 scheduled"],
                ["Quote tool", "4 new leads to call"],
              ].map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-3">
                  <span className="font-medium">{k}</span>
                  <span className={cn("truncate text-right", t.faint)}>{v}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Latest quotes */}
        <div className={cn("rounded-lg border", t.tile)}>
          <div className={cn("flex items-center justify-between border-b px-3 py-2", t.row)}>
            <p className={cn("font-mono text-[9px] uppercase tracking-label", t.muted)}>
              Quotes homeowners generated
            </p>
            <p className={cn("font-mono text-[9px] uppercase tracking-label", t.faint)}>Status</p>
          </div>
          <ul>
            {QUOTES.map((q, i) => (
              <li
                key={q.project}
                className={cn(
                  "grid grid-cols-12 items-center gap-2 px-3 py-2 text-[11px]",
                  i < QUOTES.length - 1 && cn("border-b", t.row)
                )}
              >
                <span className="col-span-5 truncate font-medium sm:col-span-4">{q.project}</span>
                <span className={cn("col-span-3 hidden sm:block", t.faint)}>{q.size} · {q.who}</span>
                <span className="col-span-4 font-mono sm:col-span-3">{q.range}</span>
                <span className="col-span-3 flex justify-end sm:col-span-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-label",
                      q.status === "New" ? t.chip : t.chipSoft
                    )}
                  >
                    {q.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * The homeowner's side — what the instant-quote embed looks like on a client
 * site after they've sized a deck in 3D. Decorative, same rules as above.
 */
export function QuoteMock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "w-full select-none overflow-hidden rounded-xl border border-line bg-bone text-ink shadow-[0_40px_90px_-30px_rgba(0,0,0,0.45)]",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-label text-ink-muted">
          Get a quote · Northline Builders
        </span>
        <span className="font-mono text-[9px] uppercase tracking-label text-ink-muted/70">Step 3 of 3</span>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-5">
        {/* The 3D stage — an isometric deck drawn in strokes. */}
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-line bg-paper sm:col-span-3 sm:aspect-auto">
          <div
            className="absolute inset-0 opacity-60 [background-image:linear-gradient(rgb(var(--line))_1px,transparent_1px),linear-gradient(90deg,rgb(var(--line))_1px,transparent_1px)] [background-size:22px_22px]"
          />
          <svg viewBox="0 0 320 220" className="relative h-full w-full">
            <g fill="none" stroke="rgb(var(--ink))" strokeWidth="1.5" strokeLinejoin="round">
              {/* deck slab */}
              <path d="M60 130 L170 75 L280 130 L170 185 Z" fill="rgb(var(--bone))" />
              <path d="M60 130 L60 144 L170 199 L280 144 L280 130" />
              <path d="M170 185 L170 199" />
              {/* boards */}
              <g stroke="rgb(var(--ink))" strokeOpacity="0.35" strokeWidth="1">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <path key={i} d={`M${60 + i * 13.75} ${130 - i * 6.9} L${170 + i * 13.75} ${185 - i * 6.9}`} />
                ))}
              </g>
              {/* railing posts */}
              {[[60, 130], [115, 102], [170, 75], [225, 102], [280, 130]].map(([x, y]) => (
                <path key={`${x}-${y}`} d={`M${x} ${y} L${x} ${y - 34}`} />
              ))}
              <path d="M60 96 L170 41 L280 96" />
              {/* pergola */}
              <g strokeOpacity="0.7">
                <path d="M100 110 L100 30 M240 110 L240 30 M170 75 L170 -5" />
                <path d="M100 30 L170 -5 L240 30" />
              </g>
              {/* dimension */}
              <g stroke="rgb(var(--ink))" strokeOpacity="0.5" strokeDasharray="3 3">
                <path d="M52 140 L162 195" />
              </g>
            </g>
            <text x="92" y="186" fontFamily="var(--font-mono)" fontSize="9" fill="rgb(var(--ink))" fillOpacity="0.7">
              28 ft
            </text>
            <text x="218" y="182" fontFamily="var(--font-mono)" fontSize="9" fill="rgb(var(--ink))" fillOpacity="0.7">
              15 ft
            </text>
          </svg>
          <span className="absolute left-3 top-3 rounded-full bg-ink px-2 py-0.5 font-mono text-[9px] uppercase tracking-label text-bone">
            Deck · 420 sq ft
          </span>
        </div>

        {/* Options + result */}
        <div className="flex flex-col justify-between gap-4 sm:col-span-2">
          <ul className="space-y-2 text-[11px]">
            {[
              ["Composite decking upgrade", true],
              ["Cedar pergola", true],
              ["Built-in bench seating", false],
              ["Permit handling", true],
            ].map(([label, on]) => (
              <li key={String(label)} className="flex items-center gap-2">
                <span
                  className={cn(
                    "grid h-3.5 w-3.5 place-items-center rounded-[3px] border border-ink/40",
                    on && "bg-ink"
                  )}
                >
                  {on ? <span className="h-1.5 w-1.5 rounded-[1px] bg-bone" /> : null}
                </span>
                <span className={on ? "text-ink" : "text-ink-muted"}>{label}</span>
              </li>
            ))}
          </ul>
          <div className="rounded-lg border border-line bg-paper p-3">
            <p className="font-mono text-[9px] uppercase tracking-label text-ink-muted">Estimated range</p>
            <p className="mt-1 font-display text-2xl font-medium leading-none">$29,400 – $34,200</p>
            <p className="mt-1.5 text-[10px] text-ink-muted">±8% · 10% deposit to schedule · set by the contractor</p>
            <span className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-ink px-3 py-2 text-[11px] font-medium text-bone">
              Book a site visit →
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
