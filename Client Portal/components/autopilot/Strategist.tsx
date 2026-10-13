"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bot, Check, Loader2, Send } from "lucide-react";
import type { StrategistMessage } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/**
 * The chat with the SEO strategist. It answers from the company's records and
 * changes the plan as the owner talks; every change shows as a chip under the
 * reply and the page refreshes so the plan and calendar follow.
 */
export function Strategist({ initial, demo, suggestions }: { initial: StrategistMessage[]; demo: boolean; suggestions: string[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState<StrategistMessage[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy]);

  async function send(msg: string) {
    const m = msg.trim();
    if (!m || busy) return;
    setBusy(true); setError(""); setText("");
    setMessages((cur) => [...cur, { role: "user", content: m, at: new Date().toISOString() }]);
    const res = await fetch("/api/autopilot/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: m }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? "The strategist didn't answer. Try again."); return; }
    setMessages((cur) => [...cur, { role: "assistant", content: j.reply, at: j.at ?? new Date().toISOString(), actions: j.actions ?? [] }]);
    if (Array.isArray(j.actions) && j.actions.length) router.refresh();
  }

  return (
    <div className="panel flex flex-col overflow-hidden" style={{ height: "28rem" }}>
      <div className="px-5 py-3 border-b border-line flex items-center gap-2">
        <span className="h-7 w-7 rounded-full bg-ink text-bone grid place-items-center"><Bot className="h-3.5 w-3.5" /></span>
        <div><p className="text-sm font-medium leading-tight">Your SEO strategist</p><p className="text-[11px] text-ink-muted">Knows your plan, posts and Google numbers. Tell it what you want more of; it changes the plan.</p></div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-ink-muted">
            <p>Ask how things are going, or point it somewhere: a service, a product line, a town, a kind of customer. It updates your direction, adds the searches to go after and puts new topics at the front of the plan.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("max-w-[92%]", m.role === "user" ? "ml-auto" : "")}>
            <div className={cn("rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed", m.role === "user" ? "bg-ink text-bone" : "bg-paper border border-line")}>{m.content}</div>
            {m.actions && m.actions.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {m.actions.map((a) => <li key={a} className="inline-flex items-start gap-1 rounded-full bg-good-bg text-good px-2.5 py-1 text-[11px] leading-snug"><Check className="h-3 w-3 mt-0.5 shrink-0" />{a}</li>)}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading your records…</div>}
        {error && <p className="text-xs text-bad">{error}</p>}
        <div ref={endRef} />
      </div>
      {messages.length === 0 && (
        <div className="px-5 pb-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => <button key={s} type="button" className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink" onClick={() => send(s)}>{s}</button>)}
        </div>
      )}
      <form className="border-t border-line p-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input className="input !py-2 text-sm flex-1" placeholder={demo ? "Demo mode: replies are canned" : "e.g. I want more kitchen remodels in Lynnwood"} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} disabled={busy} />
        <button className="btn btn-ink !py-2 !px-3" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
