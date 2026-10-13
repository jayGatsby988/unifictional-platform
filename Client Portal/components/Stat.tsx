import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn, fmt } from "@/lib/utils";

export function Delta({ now, prev, invert = false, suffix = "" }: { now: number; prev: number; invert?: boolean; suffix?: string }) {
  if (!prev) return <span className="text-xs text-ink-muted">new</span>;
  const pct = ((now - prev) / prev) * 100;
  const up = pct > 0.5;
  const down = pct < -0.5;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good && "text-good", bad && "text-bad", !good && !bad && "text-ink-muted")}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(pct).toFixed(0)}%{suffix}
    </span>
  );
}

/** A headline number. Pass value={null} when the source isn't connected or has no data yet. */
export function Stat({ label, value, sub, delta, className }: {
  label: string; value: string | number | null; sub?: React.ReactNode; delta?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("panel p-5", className)}>
      <p className="label mb-3">{label}</p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={cn("font-display text-3xl sm:text-4xl leading-none", value === null && "text-ink-muted/50")}>{value === null ? "—" : typeof value === "number" ? fmt.int(value) : value}</span>
        {value !== null && delta}
      </div>
      {sub && <p className="mt-2 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

/** `hint`: a few plain words under the label for non-technical readers. */
export function Score({ label, hint, value }: { label: string; hint?: string; value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const tone = value >= 90 ? "text-good" : value >= 50 ? "text-warn" : "text-bad";
  return (
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
      <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} className="stroke-line" strokeWidth="5" fill="none" />
        <circle cx="32" cy="32" r={r} className={cn("stroke-current", tone)} strokeWidth="5" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * value) / 100} />
      </svg>
      <div>
        <p className="font-display text-2xl leading-none">{value}</p>
        <p className="label !text-xs mt-1">{label}</p>
        {hint && <p className="text-xs text-ink-muted mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; text: string }> = {
    live: { cls: "pill-good", text: "Live" },
    building: { cls: "pill-warn", text: "In build" },
    maintenance: { cls: "pill-warn", text: "Maintenance" },
    delivered: { cls: "pill-good", text: "Delivered" },
    review: { cls: "pill-warn", text: "Your review" },
    modeling: { cls: "pill-neutral", text: "Modeling" },
    requested: { cls: "pill-neutral", text: "Requested" },
    open: { cls: "pill-neutral", text: "Open" },
    in_progress: { cls: "pill-warn", text: "In progress" },
    done: { cls: "pill-good", text: "Done" },
    published: { cls: "pill-good", text: "Published" },
    scheduled: { cls: "pill-neutral", text: "Scheduled" },
  };
  const m = map[status] ?? { cls: "pill-neutral", text: status };
  return <span className={cn("pill", m.cls)}>{m.text}</span>;
}
