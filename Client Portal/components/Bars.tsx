import { fmt } from "@/lib/utils";

export function Bars({ rows, max }: { rows: { label: string; value: number; sub?: string }[]; max?: number }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="truncate">{r.label}</span>
            <span className="font-mono text-xs text-ink-muted shrink-0 ml-3">{r.sub ?? fmt.int(r.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-sand overflow-hidden">
            <div className="h-full bg-ink rounded-full" style={{ width: `${(r.value / top) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
