"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Printer, Type } from "lucide-react";
import type { Guide } from "@/lib/guides";
import type { Demo } from "@/lib/walkthroughs";
import { Walkthrough } from "@/components/walkthrough/Walkthrough";
import { cn } from "@/lib/utils";

/** Player + written steps kept in sync, with tick-boxes, bigger text and print. */
export function GuideInteractive({ guide, demo, info }: { guide: Guide; demo: Demo | null; info: React.ReactNode }) {
  const [cur, setCur] = useState<[number, number] | null>(null);
  const [goto, setGoto] = useState<{ i: number; n: number } | undefined>();
  const [done, setDone] = useState<string[]>([]);
  const [big, setBig] = useState(false);
  const key = `guide:${guide.slug}`;

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setDone(JSON.parse(localStorage.getItem(`${key}:done`) ?? "[]"));
        setBig(localStorage.getItem("guide:big") === "1");
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, [key]);

  const toggleDone = (id: string) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next);
    try { localStorage.setItem(`${key}:done`, JSON.stringify(next)); } catch {}
  };
  const toggleBig = () => { setBig(!big); try { localStorage.setItem("guide:big", big ? "0" : "1"); } catch {} };

  const onStep = useCallback((i: number) => { setCur(demo?.steps[i]?.ref ?? null); }, [demo]);
  const jump = (t: number, s: number) => {
    if (!demo) return;
    const idx = demo.steps.findIndex((d) => d.ref?.[0] === t && d.ref?.[1] === s);
    if (idx < 0) return;
    setGoto((g) => ({ i: idx, n: (g?.n ?? 0) + 1 }));
    document.getElementById("watch")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const total = useMemo(() => guide.tracks.reduce((a, t) => a + t.steps.length, 0), [guide]);

  return (
    <div className={cn(big && "guide-lg")}>
      <div className="no-print sticky top-0 z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 bg-bone/90 backdrop-blur border-b border-line flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-muted mr-auto hidden sm:inline">{done.length ? `${done.length} of ${total} steps ticked` : "Tick each step as you go"}</span>
        <button type="button" onClick={toggleBig} className={cn("wt-btn !min-h-[40px] !text-sm", big && "wt-btn-on")} aria-pressed={big}><Type className="h-4 w-4" /> Bigger text</button>
        <button type="button" onClick={() => window.print()} className="wt-btn !min-h-[40px] !text-sm !hidden sm:!inline-flex"><Printer className="h-4 w-4" /> Print</button>
      </div>

      {demo && (
        <section id="watch" className="no-print mt-8 scroll-mt-24">
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <h2 className="font-display text-2xl sm:text-3xl">Watch it first</h2>
            <span className="text-sm text-ink-muted">{demo.steps.length} steps · under a minute · tap “Turn on voice” to hear it</span>
          </div>
          <Walkthrough demo={demo} slug={guide.slug} goto={goto} onStep={onStep} />
        </section>
      )}

      <div className="mt-10">{info}</div>

      {guide.tracks.map((t, ti) => (
        <section key={t.title} className="mt-14">
          <h2 className="font-display text-3xl sm:text-4xl leading-none">{t.title}</h2>
          {t.intro && <p className="mt-3 text-ink-muted max-w-2xl gbody">{t.intro}</p>}
          <ol className="mt-6 space-y-3">
            {t.steps.map((s, si) => {
              const id = `${ti}-${si}`;
              const isDone = done.includes(id);
              const live = cur?.[0] === ti && cur?.[1] === si;
              const watchable = demo?.steps.some((d) => d.ref?.[0] === ti && d.ref?.[1] === si);
              return (
                <li key={id} className={cn("gstep rounded-2xl border transition-colors flex gap-4 p-4 sm:p-5", live ? "border-[#f59e0b] bg-[#fffbeb] dark:bg-transparent" : "border-line bg-bone", isDone && !live && "opacity-60")}>
                  <button type="button" onClick={() => toggleDone(id)} aria-pressed={isDone} aria-label={isDone ? "Mark step as not done" : "Mark step as done"}
                    className={cn("no-print shrink-0 h-11 w-11 rounded-full border-2 grid place-items-center transition", isDone ? "bg-ink border-ink text-bone" : "border-line hover:border-ink")}>
                    {isDone ? <Check className="h-5 w-5" /> : <span className="font-display text-lg text-ink-soft">{si + 1}</span>}
                  </button>
                  <span className="hidden print:block font-display text-xl w-8">{si + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("gstep-text text-lg sm:text-xl leading-snug", isDone && "line-through decoration-1")}>{s.do}</p>
                    {s.where && <p className="mt-1.5 font-mono text-xs sm:text-sm text-ink-muted break-words">{s.where}</p>}
                    {s.note && <p className="gstep-note mt-2 text-sm sm:text-base text-ink-muted border-l-2 border-line pl-3">{s.note}</p>}
                    {watchable && <button type="button" onClick={() => jump(ti, si)} className="no-print mt-3 text-sm underline text-ink-soft">Show me this step</button>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
