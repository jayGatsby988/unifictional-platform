"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, KeyRound, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type Result = { email: string; password: string; reset: boolean; loginUrl: string; company: string };

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function inviteText(r: Result, name: string) {
  const hi = firstName(name) ? `Hi ${firstName(name)}` : "Hi";
  return `${hi}, it's Trishank from Unifictional. Your client portal for ${r.company} is ready. It shows how your website, Google and socials are doing.\n\nSign in: ${r.loginUrl}\nEmail: ${r.email}\nTemporary password: ${r.password}\n\nYou'll pick your own password right after you sign in. Text me if anything looks off.`;
}

/**
 * Creates (or resets) a client login with a temporary password and links it to
 * the company. Shows the password once with a ready-to-send text message.
 */
export function CreateLogin({ slug, email: initialEmail = "", name = "", phone = "", compact = false }:
  { slug: string; email?: string; name?: string; phone?: string; compact?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState<"" | "text" | "pw">("");

  async function create() {
    setState("busy"); setMsg(""); setResult(null);
    const res = await fetch("/api/studio/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, email, name }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setState("error"); setMsg(j.error ?? "Could not create the login."); setNeedsKey(Boolean(j.needsKey)); return; }
    // Don't refresh yet: the page would re-render and hide the one-time password.
    setState("idle"); setResult(j);
  }

  async function copy(what: "text" | "pw", value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(what); setTimeout(() => setCopied(""), 1800); } catch { /* clipboard blocked */ }
  }

  const text = result ? inviteText(result, name) : "";
  const smsHref = result && phone ? `sms:${phone.replace(/[^\d+]/g, "")}${/iPhone|iPad|Mac/.test(typeof navigator === "undefined" ? "" : navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(text)}` : "";

  return (
    <div className={cn(!compact && "panel p-5")}>
      {!compact && (
        <>
          <p className="label mb-1">Their login</p>
          <h2 className="font-display text-2xl leading-tight mb-1">Create a login and text it to them</h2>
          <p className="text-sm text-ink-muted mb-4">No email needed. You get a temporary password to send; they choose their own after signing in.</p>
        </>
      )}
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <input className={cn("input min-w-0", compact ? "!w-56 !py-1.5 text-xs" : "!py-2 flex-1")} type="email" placeholder="their email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Client email" />
        <button className={cn("btn btn-ink", compact && "!py-1.5 !px-3 text-xs")} disabled={state === "busy"}>
          <KeyRound className="h-3.5 w-3.5" />{state === "busy" ? "Creating…" : "Create login"}
        </button>
      </form>

      {state === "error" && (
        <div className="mt-3 text-xs">
          <p className="text-bad">{msg}</p>
          {needsKey && (
            <ol className="mt-2 list-decimal pl-4 space-y-1 text-ink-muted">
              <li>Supabase → Project Settings → API keys → copy the <span className="font-mono text-ink">service_role</span> secret.</li>
              <li>Vercel → unifictional-client-portal → Settings → Environment Variables → add <span className="font-mono text-ink">SUPABASE_SERVICE_ROLE_KEY</span> (Production, Sensitive).</li>
              <li>Redeploy. This button and the nightly update both start working.</li>
            </ol>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-ink p-4 space-y-3 text-left">
          <div className="flex items-center gap-2 text-sm font-medium"><Check className="h-4 w-4 text-good" />{result.reset ? "Password reset and access given." : "Login created and linked."}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Email</dt><dd className="font-mono break-all">{result.email}</dd>
            <dt className="text-ink-muted">Password</dt>
            <dd className="flex items-center gap-2"><span className="font-mono">{result.password}</span>
              <button type="button" className="text-ink-muted hover:text-ink" aria-label="Copy password" onClick={() => copy("pw", result.password)}>{copied === "pw" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button>
            </dd>
          </dl>
          <textarea readOnly className="input !py-2 text-xs min-h-36 w-full" value={text} aria-label="Text message to send" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ink !py-2 !px-4 text-xs" onClick={() => copy("text", text)}>{copied === "text" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied === "text" ? "Copied" : "Copy text message"}</button>
            {smsHref && <a className="btn btn-ghost !py-2 !px-4 text-xs" href={smsHref}><MessageSquare className="h-3.5 w-3.5" />Open in Messages</a>}
          </div>
          <p className="text-[11px] text-ink-muted">Shown once and never stored. If it gets lost, press Create login again for a new one.</p>
          <button type="button" className="btn btn-ghost !py-2 !px-4 text-xs" onClick={() => { setResult(null); router.refresh(); }}>I&apos;ve sent it, done</button>
        </div>
      )}
    </div>
  );
}
