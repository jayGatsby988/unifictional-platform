"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** First sign-in with a studio-issued password: pick your own, right here. */
export function SetPassword() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "error" | "done">("idle");
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setState("error"); setMsg("Use at least 8 characters."); return; }
    setState("busy");
    const { error } = await createClient().auth.updateUser({ password: pw, data: { must_change_password: false, welcome_nonce: null } }); // also retires the welcome email's one-tap link
    if (error) { setState("error"); setMsg(error.message); return; }
    setState("done");
    router.refresh();
  }

  if (state === "done") return null;
  return (
    <div className="panel p-5 mb-8 border-ink">
      <div className="flex items-start gap-3">
        <span className="grid place-items-center h-9 w-9 rounded-full bg-sand shrink-0"><KeyRound className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl uppercase leading-tight">Welcome. Pick your own password.</h2>
          <p className="text-sm text-ink-muted mt-1">You signed in with a temporary one. Choose something you&apos;ll remember. You&apos;ll use it with your email from now on.</p>
          <form onSubmit={save} className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <input className="input !py-2.5 !pr-10" type={show ? "text" : "password"} autoComplete="new-password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="New password" />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </div>
            <button className="btn btn-ink" disabled={state === "busy"}>{state === "busy" ? "Saving…" : "Save password"}</button>
          </form>
          {state === "error" && <p className="text-sm text-bad mt-2">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
