"use client";

import { Area, AreaChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt } from "@/lib/utils";

type Row = Record<string, number | string>;

type TipProps = {
  active?: boolean;
  label?: string | number;
  payload?: { dataKey?: string | number; name?: string; value?: number }[];
  format?: (v: number, k: string) => string;
};

function TipBox({ active, payload, label, format }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel px-3 py-2 text-xs shadow-lg">
      <p className="label !text-xs mb-1">{fmt.date(String(label))}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex justify-between gap-4">
          <span className="text-ink-muted">{p.name}</span>
          <span className="font-mono">{format ? format(p.value ?? 0, String(p.dataKey)) : fmt.int(p.value ?? 0)}</span>
        </p>
      ))}
    </div>
  );
}

export function Trend({ data, keys, height = 220, format }: {
  data: Row[]; keys: { key: string; name: string; dashed?: boolean }[]; height?: number; format?: (v: number, k: string) => string;
}) {
  const ticks = data.length > 10 ? data.filter((_, i) => i % Math.ceil(data.length / 6) === 0).map((d) => d.date as string) : undefined;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {keys.length === 1 ? (
          <AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--ink))" stopOpacity={0.18} />
                <stop offset="100%" stopColor="rgb(var(--ink))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" ticks={ticks} tickFormatter={fmt.date} tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt.compact(v)} />
            <Tooltip content={<TipBox format={format} />} cursor={{ stroke: "rgb(var(--line))" }} />
            <Area type="monotone" dataKey={keys[0].key} name={keys[0].name} stroke="rgb(var(--ink))" strokeWidth={1.75} fill="url(#ink)" isAnimationActive={false} />
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <XAxis dataKey="date" ticks={ticks} tickFormatter={fmt.date} tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt.compact(v)} />
            <YAxis yAxisId="r" orientation="right" hide />
            <Tooltip content={<TipBox format={format} />} cursor={{ stroke: "rgb(var(--line))" }} />
            {keys.map((k, i) => (
              <Line key={k.key} yAxisId={i === 0 ? "l" : "r"} type="monotone" dataKey={k.key} name={k.name} dot={false} isAnimationActive={false}
                stroke={i === 0 ? "rgb(var(--ink))" : "rgb(var(--ink-muted))"} strokeWidth={i === 0 ? 1.75 : 1.25} strokeDasharray={k.dashed ? "4 4" : undefined} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
