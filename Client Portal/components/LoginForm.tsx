"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Sign-in built for people who don't live on screens: big fields, show-password,
 * plain-English errors, and a one-tap emailed link for "I forgot my password".
 */
export function LoginForm({ next, initialEmail = "" }: { next?: string; initialEmail?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setErr("");
    if (mode === "password") {
      const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password: password.trim() });
      if (error) {
        setState("error");
        setErr(error.message === "Invalid login credentials"
          ? "That email and password don't match. Check for typos, or tap \"Forgot your password?\" below and we'll email you a sign-in link."
          : error.message);
        return;
      }
      router.push(next && next.startsWith("/") ? next : "/overview");
      router.refresh();
      return;
    }
    const res = await fetch("/api/auth/email-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setState("error"); setErr(j.error ?? "Couldn't send the link. Try again."); return; }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="panel p-6 space-y-3">
        <span className="grid place-items-center h-12 w-12 rounded-full bg-sand"><Mail className="h-5 w-5" /></span>
        <p className="font-display text-2xl uppercase leading-tight">Check your email.</p>
        <p className="text-base text-ink-muted">If <b className="text-ink">{email}</b> has an account, a sign-in link is on its way from <b className="text-ink">Unifictional</b>. Tap the button in that email and you&apos;re in.</p>
        <p className="text-sm text-ink-muted">Not there in two minutes? Look in Spam or Promotions.</p>
        <button type="button" className="text-sm underline" onClick={() => { setMode("password"); setState("idle"); }}>Back to sign in</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="label block mb-2" htmlFor="email">Email</label>
        <input id="email" type="email" inputMode="email" className="input !py-3.5 !text-base" placeholder="you@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoCapitalize="none" />
      </div>
      {mode === "password" && (
        <div>
          <label className="label block mb-2" htmlFor="password">Password</label>
          <div className="relative">
            <input id="password" type={show ? "text" : "password"} className="input !py-3.5 !pr-12 !text-base" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ink-muted" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
          </div>
          <p className="text-xs text-ink-muted mt-2">First time? Use the temporary password from your welcome email.</p>
        </div>
      )}
      {state === "error" && <p className="text-sm text-bad leading-snug">{err}</p>}
      <button className="btn btn-ink w-full justify-center !py-3.5 !text-base" disabled={state === "sending"}>
        {state === "sending" ? (mode === "password" ? "Signing in…" : "Sending…") : mode === "password" ? "Sign in" : "Email me a sign-in link"}
      </button>
      <button type="button" className="block w-full text-center text-sm underline" onClick={() => { setMode(mode === "password" ? "link" : "password"); setState("idle"); setErr(""); }}>
        {mode === "password" ? "Forgot your password? Email me a sign-in link" : "I know my password, sign in with it"}
      </button>
    </form>
  );
}
