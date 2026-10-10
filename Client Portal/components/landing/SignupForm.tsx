"use client";

import { useState } from "react";
import { supabaseConfigured } from "@/lib/env";

export function SignupForm() {
  const [f, setF] = useState({ name: "", company: "", email: "", phone: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setErr("");
    const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setState("error"); setErr(j.error ?? "Something went wrong."); return; }
    if (supabaseConfigured) {
      const { createClient } = await import("@/lib/supabase/client");
      await createClient().auth.signInWithOtp({ email: f.email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/overview`, shouldCreateUser: true } }).catch(() => undefined);
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="panel p-6">
        <p className="font-display text-2xl mb-2">You&apos;re on the list.</p>
        <p className="text-sm text-ink-muted">{supabaseConfigured ? "Check your inbox for a sign-in link. " : ""}We&apos;ll connect your company to the portal and email you when your dashboard is ready, usually within one business day.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="panel p-6 space-y-3">
      {[["name", "Your name", "text"], ["company", "Company", "text"], ["email", "Email", "email"], ["phone", "Phone", "tel"], ["website", "Website", "url"]].map(([k, label, type]) => (
        <div key={k}>
          <label className="label block mb-1.5" htmlFor={k}>{label}</label>
          <input id={k} type={type} className="input" value={f[k as keyof typeof f]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={k !== "phone" && k !== "website"} />
        </div>
      ))}
      <button className="btn btn-ink w-full justify-center !py-3" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Create my account"}</button>
      {state === "error" && <p className="text-sm text-bad">{err}</p>}
    </form>
  );
}
