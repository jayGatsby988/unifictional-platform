"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Password sign-in first (no email delivery needed); magic link as the alternative. */
export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setErr("");
    const supabase = createClient();
    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setState("error"); setErr(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message); return; }
      router.push(next && next.startsWith("/") ? next : "/overview");
      router.refresh();
      return;
    }
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next || "/overview")}`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: false } });
    if (error) { setState("error"); setErr(error.message); return; }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="panel p-5">
        <p className="font-medium mb-1">Check your email.</p>
        <p className="text-sm text-ink-muted">We sent a sign-in link to <span className="font-mono">{email}</span>. It expires in an hour.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label block mb-2" htmlFor="email">Email</label>
        <input id="email" type="email" className="input" placeholder="you@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </div>
      {mode === "password" && (
        <div>
          <label className="label block mb-2" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
      )}
      {state === "error" && <p className="text-sm text-bad">{err}</p>}
      <button className="btn btn-ink w-full justify-center" disabled={state === "sending"}>
        {state === "sending" ? "Signing in…" : mode === "password" ? "Sign in" : "Email me a sign-in link"}
      </button>
      <button type="button" className="block w-full text-center text-xs text-ink-muted underline" onClick={() => { setMode(mode === "password" ? "link" : "password"); setState("idle"); setErr(""); }}>
        {mode === "password" ? "Sign in with an email link instead" : "Sign in with a password instead"}
      </button>
    </form>
  );
}
