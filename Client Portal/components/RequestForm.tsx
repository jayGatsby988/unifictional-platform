"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TYPES = ["website", "seo", "social", "estimator", "billing", "other"];

export function RequestForm({ initialType, initialTitle }: { initialType?: string; initialTitle?: string }) {
  const router = useRouter();
  const [type, setType] = useState(initialType && TYPES.includes(initialType) ? initialType : "website");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, title, body }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setState("error"); setMsg(json.error ?? "Something went wrong."); return; }
    setState("sent");
    setMsg(json.demo ? "Demo mode: the request was not saved, but this is where it would go." : "Sent. We'll pick it up and reply by email.");
    setTitle(""); setBody("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="panel p-5 space-y-4">
      <div className="grid sm:grid-cols-[180px_1fr] gap-3">
        <label className="block">
          <span className="label block mb-1">About</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="website">Website</option>
            <option value="seo">Search / SEO</option>
            <option value="social">Social</option>
            <option value="estimator">Quote tool / pricing</option>
            <option value="billing">Billing</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block">
          <span className="label block mb-1">What do you need?</span>
          <input className="input" placeholder="e.g. New photos on the home page" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} />
        </label>
      </div>
      <label className="block">
        <span className="label block mb-1">Details (optional)</span>
        <textarea className="input min-h-28" placeholder="Links, addresses, anything that helps." value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
      </label>
      <div className="flex items-center gap-4 flex-wrap">
        <button className="btn btn-ink" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send request"}</button>
        {msg && <p className={`text-sm ${state === "error" ? "text-bad" : "text-ink-muted"}`}>{msg}</p>}
      </div>
    </form>
  );
}
