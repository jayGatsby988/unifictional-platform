"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { AuditReport } from "@/lib/audit";
import { ReportView } from "@/components/landing/ReportView";

const STEPS = ["Fetching your homepage", "Running Google's mobile speed test", "Checking the 10 contractor essentials", "Grading and writing your fix list"];

export function AuditForm() {
  const [stage, setStage] = useState<"url" | "details" | "running" | "done">("url");
  const [f, setF] = useState({ url: "", email: "", name: "", phone: "", company: "" });
  const [err, setErr] = useState("");
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<{ id: string | null; report: AuditReport } | null>(null);

  useEffect(() => {
    if (stage !== "running") return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 6000);
    return () => clearInterval(t);
  }, [stage]);

  function toDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!f.url.trim().includes(".")) { setErr("Enter your website, like yourcompany.com"); return; }
    setErr(""); setStage("details");
    setTimeout(() => document.getElementById("email")?.focus(), 50);
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setStep(0); setStage("running"); setErr("");
    const res = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setStage("details"); setErr(j.error ?? "Something went wrong."); return; }
    setResult({ id: j.id ?? null, report: j.report });
    setStage("done");
    setTimeout(() => document.getElementById("report")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  return (
    <>
      <div className="max-w-3xl">
        {stage === "url" && (
          <form onSubmit={toDetails}>
            <label className="label !text-bone/60 block mb-3" htmlFor="url">Enter your website</label>
            <div className="flex items-end gap-4 border-b-2 border-bone/70 pb-3 focus-within:border-bone transition">
              <input id="url" className="hero-input" placeholder="yourcompany.com" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} autoComplete="url" inputMode="url" autoFocus />
              <button className="shrink-0 h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-bone text-ink grid place-items-center hover:scale-105 transition" aria-label="Inspect my site"><ArrowRight className="h-5 w-5" /></button>
            </div>
            {err && <p className="mt-3 text-sm text-bad">{err}</p>}
            <p className="mt-4 text-sm text-bone/55">Free · about 30 seconds · no obligation</p>
          </form>
        )}

        {stage === "details" && (
          <form onSubmit={run} className="rounded-2xl bg-bone text-ink p-5 sm:p-6 shadow-[0_40px_80px_-40px_rgba(0,0,0,.8)]">
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="font-display text-xl truncate">Inspecting {f.url.replace(/^https?:\/\//, "")}</p>
              <button type="button" className="text-xs underline text-ink-muted shrink-0" onClick={() => setStage("url")}>change</button>
            </div>
            <p className="text-sm text-ink-muted mb-4">Where should the report go?</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="label block mb-1.5" htmlFor="email">Email</label><input id="email" type="email" className="input" placeholder="you@yourcompany.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" /></div>
              <div><label className="label block mb-1.5" htmlFor="name">Your name</label><input id="name" className="input" placeholder="First and last" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></div>
              <div><label className="label block mb-1.5" htmlFor="company">Company</label><input id="company" className="input" placeholder="Northline Builders" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} autoComplete="organization" /></div>
              <div><label className="label block mb-1.5" htmlFor="phone">Phone <span className="normal-case tracking-normal">(optional)</span></label><input id="phone" type="tel" className="input" placeholder="(425) 555-0100" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></div>
            </div>
            <button className="btn btn-ink w-full justify-center !py-3.5 text-base mt-4">Run my free inspection <ArrowRight className="h-4 w-4" /></button>
            {err && <p className="mt-3 text-sm text-bad">{err}</p>}
          </form>
        )}

        {stage === "running" && (
          <div className="rounded-2xl border border-bone/20 p-6 sm:p-8">
            <p className="label !text-bone/60 mb-5">Inspecting {f.url.replace(/^https?:\/\//, "")}</p>
            <ol className="space-y-3">
              {STEPS.map((s, i) => (
                <li key={s} className={`flex items-center gap-3 font-display text-xl sm:text-2xl transition ${i < step ? "text-bone/40" : i === step ? "text-bone" : "text-bone/25"}`}>
                  <span className={`h-2 w-2 rounded-full ${i < step ? "bg-bone/40" : i === step ? "bg-bone pulse" : "bg-bone/20"}`} />{s}
                </li>
              ))}
            </ol>
          </div>
        )}

        {stage === "done" && result && (
          <div className="rounded-2xl bg-bone text-ink p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="label mb-1">Your report is ready</p>
              <p className="font-display text-3xl leading-none">Grade {result.report.summary.grade} · {result.report.summary.failed} to fix</p>
            </div>
            <a href="#report" className="btn btn-ink">See the report <ArrowUpRight className="h-4 w-4" /></a>
          </div>
        )}
      </div>

      {result && (
        <div id="report" className="relative z-10 bg-bone text-ink w-screen ml-[calc(50%-50vw)] mt-16 sm:mt-24">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
            <p className="label mb-3">Your inspection report</p>
            <h2 className="font-display text-4xl sm:text-5xl mb-8">Here&apos;s what we found.</h2>
            <ReportView report={result.report} permalink={result.id ? `/report/${result.id}` : null} />
          </div>
        </div>
      )}
    </>
  );
}
