"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

type Row = {
  id: string; createdAt: string; updatedAt: string; status: string; stage: "building" | "done" | "failed" | "stalled" | "cancelled"; minutes: number;
  name: string; email: string; phone: string; businessName: string; website: string; companyDetails: string; services: string[]; message: string;
  previewUrl?: string; publishedUrl?: string; publishNote?: string; debugNotes?: string[]; pages?: string[]; score?: number; error?: string; cost?: number; log: string[];
  usage?: { calls: number; input: number; output: number; searches: number };
  weight?: { images: { count: number; before: number; after: number; skipped: number }; html: { before: number; after: number } };
  video?: { mode?: string; count?: number; seconds?: number };
  hook?: { claim?: string; flagship?: string; ask?: string };
  needsLook?: string[];
  qa?: { rounds?: number; passed?: boolean; score?: number; verdict?: string; errors?: string[]; issues?: { page: string; section?: number | null; severity: string; problem: string; instruction?: string }[]; shots?: { page: string; viewport: string; name: string; url: string }[] };
};
type Summary = { building: number; stalled: number; doneToday: number; failed: number; total: number; spend: number; spendToday: number };

const STEP_LABEL: Record<string, string> = {
  debug: "Debugging every page",
  publish: "Publishing to Vercel",
  queued: "Queued", research: "Reading their site + research pass 1", "research-b": "Reviews, competitors, keywords", plan: "Planning the pages",
  home: "Home page: write, look, judge, fix", write: "Writing the inner pages", review: "Reviewing against the research", finish: "Whole site: look, judge, fix, deliver", done: "Done", failed: "Failed",
};
const STEP_ORDER = ["queued", "research", "research-b", "plan", "home", "write", "review", "finish", "done"];
const inputCls = "w-full rounded-sm border border-line bg-paper px-4 py-3 text-sm text-ink placeholder:text-ink-muted outline-none transition focus:border-terracotta focus:ring-1 focus:ring-terracotta/30";

function progress(status: string) {
  const i = STEP_ORDER.indexOf(status);
  return i < 0 ? 0 : Math.round((i / (STEP_ORDER.length - 1)) * 100);
}
function when(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function BuildsBoard() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [data, setData] = useState<{ at: string; summary: Summary; builds: Row[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/build/list", { cache: "no-store" });
      if (r.status === 403) { setAuthed(false); return; }
      const j = await r.json();
      if (j.ok) { setData(j); setAuthed(true); }
    } catch { /* keep the last data */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20000);
    return () => clearInterval(t);
  }, [authed, load]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setKeyError("");
    const r = await fetch("/api/build/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
    if (r.ok) { setKey(""); void load(); } else setKeyError("That key is not right.");
  }
  async function cancel(id: string) {
    if (!window.confirm("Stop this build? Every running step is cancelled and it is marked cancelled on the board.")) return;
    setCancelling(id);
    try { await fetch("/api/build/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }); await load(); }
    finally { setCancelling(null); }
  }
  async function retry(id: string) {
    if (!confirm("Start a fresh build for this lead? It costs about $10 in API usage.")) return;
    setRetrying(id);
    try { await fetch("/api/build/retry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }); await load(); }
    finally { setRetrying(null); }
  }

  if (authed === false) {
    return (
      <form onSubmit={signIn} className="max-w-md rounded-2xl border border-line bg-paper/75 p-8 backdrop-blur-xl">
        <h2 className="font-display text-2xl font-medium text-ink">Dashboard key</h2>
        <p className="mt-2 text-sm text-ink-soft">This page is private. Enter the builds key once; it stays signed in on this browser for 60 days.</p>
        <input className={cn(inputCls, "mt-5")} type="password" autoComplete="current-password" placeholder="Key" value={key} onChange={(e) => setKey(e.target.value)} />
        {keyError && <p role="alert" className="mt-3 text-sm text-terracotta">{keyError}</p>}
        <button type="submit" className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-medium text-white">Open the dashboard</button>
      </form>
    );
  }
  if (!data) return <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading builds…</p>;

  const s = data.summary;
  const building = data.builds.filter((b) => b.stage === "building" || b.stage === "stalled");
  const finished = data.builds.filter((b) => b.stage === "done" || b.stage === "failed" || b.stage === "cancelled");

  return (
    <div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Building now", s.building, "accent"], ["Stalled", s.stalled, s.stalled ? "accent" : ""], ["Done today", s.doneToday, ""],
          ["Failed", s.failed, s.failed ? "accent" : ""], ["Spent today", `$${s.spendToday.toFixed(2)}`, ""], ["Spent, all time", `$${s.spend.toFixed(2)}`, ""],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="bg-paper px-5 py-5">
            <div className="font-mono text-[11px] uppercase tracking-label text-ink-muted">{label}</div>
            <div className={cn("mt-2 font-display text-3xl font-medium", tone === "accent" ? "text-terracotta" : "text-ink")}>{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
        <span>{data.builds.length} builds · updated {when(data.at)}</span>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 hover:text-ink"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh</button>
      </div>

      <Section title="Building right now" count={building.length} empty="Nothing is building. The next lead who confirms a call starts one.">
        {building.map((b) => <BuildCard key={b.id} b={b} open={open === b.id} onToggle={() => setOpen(open === b.id ? null : b.id)} onRetry={retry} retrying={retrying === b.id} onCancel={cancel} cancelling={cancelling === b.id} />)}
      </Section>
      <Section title="Finished" count={finished.length} empty="No finished builds yet.">
        {finished.map((b) => <BuildCard key={b.id} b={b} open={open === b.id} onToggle={() => setOpen(open === b.id ? null : b.id)} onRetry={retry} retrying={retrying === b.id} onCancel={cancel} cancelling={cancelling === b.id} />)}
      </Section>
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="mt-12">
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <h2 className="font-display text-2xl font-medium text-ink">{title}</h2>
        <span className="font-mono text-[11px] uppercase tracking-label text-ink-muted">{count}</span>
      </div>
      {count ? <ul className="divide-y divide-line">{children}</ul> : <p className="py-6 text-sm text-ink-muted">{empty}</p>}
    </div>
  );
}

function BuildCard({ b, open, onToggle, onRetry, retrying, onCancel, cancelling }: { b: Row; open: boolean; onToggle: () => void; onRetry: (id: string) => void; retrying: boolean; onCancel: (id: string) => void; cancelling: boolean }) {
  const pct = b.stage === "done" ? 100 : b.stage === "cancelled" ? 0 : progress(b.status);
  const tone = b.stage === "done" ? "text-ink" : b.stage === "failed" || b.stage === "cancelled" ? "text-terracotta" : b.stage === "stalled" ? "text-terracotta" : "text-ink";
  const stageLabel = b.stage === "stalled" ? "Stalled (no update in 25 min)" : b.stage === "cancelled" ? "Cancelled" : b.stage === "building" ? STEP_LABEL[b.status] || b.status : STEP_LABEL[b.stage];
  return (
    <li className="py-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-center md:gap-6">
        <div className="md:col-span-4">
          <button type="button" onClick={onToggle} className="text-left">
            <div className="font-display text-xl font-medium text-ink">{b.businessName || b.name}</div>
            <div className="mt-0.5 text-sm text-ink-muted">{b.name} · {when(b.createdAt)}{b.website ? <> · <a href={b.website} target="_blank" rel="noopener" className="underline-offset-2 hover:underline">{b.website.replace(/^https?:\/\/(www\.)?/, "")}</a></> : " · no website yet"}</div>
          </button>
        </div>
        <div className="md:col-span-4">
          <div className={cn("flex items-center gap-2 text-sm", tone)}>
            {b.stage === "building" && <Loader2 className="h-3.5 w-3.5 animate-spin text-terracotta" />}
            <span>{stageLabel}</span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line"><div className={cn("h-full rounded-full", b.stage === "failed" || b.stage === "cancelled" ? "bg-terracotta" : "bg-ink")} style={{ width: `${pct}%` }} /></div>
          {b.error && <p className="mt-2 whitespace-pre-line text-xs text-terracotta">{b.error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-soft md:col-span-4 md:justify-end">
          <span title="elapsed">{b.minutes} min</span>
          <span title="cost">${(Number(b.cost) || 0).toFixed(2)}</span>
          {b.pages?.length ? <span>{b.pages.length} pages</span> : null}
          {typeof b.score === "number" ? <span>SEO {b.score}</span> : null}
          {b.publishedUrl && <a href={b.publishedUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs text-paper">Live site</a>}
          {b.previewUrl && <a href={b.previewUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-ink hover:border-ink">Preview <ArrowUpRight className="h-3 w-3" /></a>}
          {(b.stage === "failed" || b.stage === "stalled" || b.stage === "done") && (
            <button type="button" onClick={() => onRetry(b.id)} disabled={retrying} className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft hover:border-ink hover:text-ink disabled:opacity-50">{retrying ? "Starting…" : "Rebuild"}</button>
          )}
            {(b.stage === "building" || b.stage === "stalled") && <button type="button" onClick={() => onCancel(b.id)} disabled={cancelling} className="rounded-full border border-terracotta/60 px-3 py-1 text-xs text-terracotta hover:border-terracotta hover:bg-terracotta/10 disabled:opacity-50">{cancelling ? "Stopping…" : "Cancel build"}</button>}
        </div>
      </div>
      {open && (
        <div className="mt-4 grid gap-4 rounded-xl border border-line bg-paper/60 p-5 text-sm md:grid-cols-2">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-label text-ink-muted">Lead</div>
            <p className="mt-1 text-ink">{b.name} · <a className="underline-offset-2 hover:underline" href={`mailto:${b.email}`}>{b.email}</a>{b.phone ? ` · ${b.phone}` : ""}</p>
            {b.services?.length ? <p className="mt-1 text-ink-soft">Interested in: {b.services.join(", ")}</p> : null}
            {b.message && <p className="mt-2 whitespace-pre-wrap text-ink-soft">{b.message}</p>}
            {b.companyDetails && <p className="mt-2 whitespace-pre-wrap text-ink-soft">{b.companyDetails}</p>}
            {b.hook?.claim && <p className="mt-3 text-sm text-ink"><span className="font-mono text-[11px] uppercase tracking-label text-ink-muted">Hook</span><br />{b.hook.claim}{b.hook.flagship ? <span className="text-ink-soft"> · flagship: {b.hook.flagship}</span> : null}</p>}
            {b.video && <p className="mt-3 text-xs text-ink-muted">Hero video: {b.video.mode === "frames" ? `${b.video.count} frames, scroll-scrubbed` : b.video.mode === "video" ? "mp4, scroll-scrubbed" : "not generated"}{b.video.seconds ? ` · ${Math.round(b.video.seconds / 60)} min to generate` : ""}</p>}
            {b.publishNote && !b.publishedUrl ? <p className="mt-3 text-xs text-terracotta">Not live yet: {b.publishNote}</p> : null}
            {b.debugNotes?.length ? <p className="mt-3 whitespace-pre-line text-xs text-ink/70"><span className="font-mono text-[11px] uppercase tracking-label">Debugger fixed</span><br />{b.debugNotes.slice(0, 6).join("\n")}</p> : null}
            {b.needsLook?.length ? <p className="mt-3 whitespace-pre-line text-xs text-terracotta"><span className="font-mono text-[11px] uppercase tracking-label">Needs a look</span><br />{b.needsLook.slice(0, 6).join("\n")}</p> : null}
            {b.qa?.rounds ? (
              <div className="mt-3 text-xs text-ink-muted">
                <p><span className="font-mono text-[11px] uppercase tracking-label">Quality gate</span> · {b.qa.passed ? `passed in round ${b.qa.rounds}` : `not passed after ${b.qa.rounds} round${b.qa.rounds > 1 ? "s" : ""}`}{typeof b.qa.score === "number" ? ` · ${b.qa.score}/100` : ""}{b.qa.verdict ? <span className="text-ink-soft"> · {b.qa.verdict}</span> : null}</p>
                {b.qa.issues?.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4">{b.qa.issues.slice(0, 8).map((i, k) => <li key={k}><span className="text-ink">{i.page}{i.section ? ` §${i.section}` : ""}</span> ({i.severity}): {i.problem}</li>)}</ul> : null}
                {b.qa.shots?.length ? <p className="mt-2 flex flex-wrap gap-1">{b.qa.shots.slice(0, 12).map((s) => <a key={s.name} href={s.url} target="_blank" rel="noopener" title={s.name}><img src={s.url} alt={s.name} className="h-14 w-auto rounded border border-line" loading="lazy" /></a>)}</p> : null}
              </div>
            ) : null}
            {b.weight && <p className="mt-3 text-xs text-ink-muted">Lighter: {b.weight.images.count} photos {(b.weight.images.before / 1048576).toFixed(1)} MB → {(b.weight.images.after / 1048576).toFixed(1)} MB · markup {Math.round(b.weight.html.before / 1024)} KB → {Math.round(b.weight.html.after / 1024)} KB</p>}
            {b.usage && <p className="mt-3 text-xs text-ink-muted">{b.usage.calls} model calls · {b.usage.searches} searches · {Math.round(b.usage.input / 1000)}k in / {Math.round(b.usage.output / 1000)}k out tokens</p>}
            {b.pages?.length ? <p className="mt-2 text-xs text-ink-muted">Pages: {b.pages.map((p) => <a key={p} className="mr-2 underline-offset-2 hover:underline" href={`${b.previewUrl}${p === "index" ? "" : "/" + p}`} target="_blank" rel="noopener">{p}</a>)}</p> : null}
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-label text-ink-muted">Build log</div>
            <ol className="mt-1 space-y-1 font-mono text-[11px] leading-relaxed text-ink-soft">{b.log.map((l, i) => <li key={i}>{l}</li>)}</ol>
          </div>
        </div>
      )}
    </li>
  );
}
