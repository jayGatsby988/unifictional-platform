"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Mail } from "lucide-react";

const FIELDS = [
  { k: "name", label: "Your name", type: "text", auto: "name", hint: "", required: true },
  { k: "company", label: "Company name", type: "text", auto: "organization", hint: "", required: true },
  { k: "email", label: "Email", type: "email", auto: "email", hint: "We'll email your login here.", required: true },
  { k: "phone", label: "Phone (optional)", type: "tel", auto: "tel", hint: "Only so we can call if something needs a quick answer.", required: false },
  { k: "website", label: "Website (optional)", type: "text", auto: "url", hint: "We'll run a free check on it for you, like yourcompany.com", required: false },
] as const;

export function SignupForm() {
  const [f, setF] = useState({ name: "", company: "", email: "", phone: "", website: "", fax: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [result, setResult] = useState<{ emailed: boolean; existing: boolean; email: string } | null>(null);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setErr("");
    const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setState("error"); setErr(j.error ?? "Something went wrong. Please try again."); return; }
    setResult({ emailed: Boolean(j.emailed), existing: Boolean(j.existing), email: j.email ?? f.email });
    setState("sent");
  }

  if (state === "sent" && result) {
    return (
      <div className="panel p-6 sm:p-8 space-y-4">
        <span className="grid place-items-center h-12 w-12 rounded-full bg-sand">{result.emailed ? <Mail className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}</span>
        <p className="font-display text-3xl uppercase leading-tight">{result.emailed ? "Check your email." : "You're all set."}</p>
        {result.emailed ? (
          <>
            <p className="text-base">
              {result.existing
                ? <>You already have an account, so we emailed a one-tap sign-in link to <b>{result.email}</b>.</>
                : <>Thanks for choosing Unifictional. We emailed your login and a temporary password to <b>{result.email}</b>.</>}
            </p>
            <ol className="text-base space-y-2 list-decimal pl-5">
              <li>Open the email from <b>Unifictional</b>.</li>
              <li>{result.existing ? "Tap the sign-in button." : "Tap \"Sign in\" and type the temporary password."}</li>
              <li>Pick your own password when we ask.</li>
            </ol>
            <p className="text-sm text-ink-muted">Not there in two minutes? Check Spam or Promotions. Still nothing? Email unifictional@gmail.com and we&apos;ll sort it out.</p>
            <Link href={`/login?email=${encodeURIComponent(result.email)}`} className="btn btn-ink w-full justify-center !py-3.5 !text-base">Go to sign in</Link>
          </>
        ) : (
          <p className="text-base">We got your details. We&apos;ll email your login to <b>{result.email}</b> within one business day.</p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="panel p-6 space-y-4" noValidate={false}>
      {FIELDS.map(({ k, label, type, auto, hint, required }) => (
        <div key={k}>
          <label className="label block mb-1.5" htmlFor={k}>{label}</label>
          <input id={k} type={type} autoComplete={auto} inputMode={type === "email" ? "email" : type === "tel" ? "tel" : undefined}
            autoCapitalize={type === "email" || k === "website" ? "none" : undefined}
            className="input !py-3.5 !text-base" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={required} />
          {hint && <p className="text-xs text-ink-muted mt-1.5">{hint}</p>}
        </div>
      ))}
      {/* Honeypot: hidden from people, bots fill it in. */}
      <input type="text" name="fax" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.fax} onChange={(e) => setF({ ...f, fax: e.target.value })} />
      <button className="btn btn-ink w-full justify-center !py-3.5 !text-base" disabled={state === "sending"}>{state === "sending" ? "Creating your account…" : "Create my account"}</button>
      {state === "error" && <p className="text-sm text-bad">{err}</p>}
      <p className="text-xs text-ink-muted text-center">Free to create. No card needed.</p>
    </form>
  );
}
