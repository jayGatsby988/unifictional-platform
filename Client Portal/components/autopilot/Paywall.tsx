"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Loader2, Lock } from "lucide-react";
import type { PlanOffer } from "@/lib/autopilot/access";
import { money } from "@/lib/billing/types";

/** The plan card and the Square checkout button. Admins viewing a client also get "include it in their plan". */
export function Paywall({ offer, slug, demo, admin }: { offer: PlanOffer; slug: string; demo: boolean; admin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "pay" | "comp">("");
  const [msg, setMsg] = useState("");

  async function pay() {
    if (demo) { setMsg("Demo mode: this is where Square's checkout opens."); return; }
    setBusy("pay"); setMsg("");
    const res = await fetch("/api/autopilot/checkout", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(""); setMsg(j.error ?? "Couldn't start the checkout."); return; }
    if (j.demo || !j.url) { setBusy(""); setMsg("Demo mode: this is where Square's checkout opens."); return; }
    window.location.href = j.url;
  }

  async function comp() {
    setBusy("comp"); setMsg("");
    const res = await fetch("/api/studio/autopilot", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, comped: true }) });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setMsg(j.error ?? "Couldn't save."); return; }
    router.refresh();
  }

  return (
    <div className="panel p-6 sm:p-8 !bg-ink !text-bone !border-ink">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label !text-bone/60 mb-2">{offer.name}</p>
          <p className="font-display text-4xl sm:text-5xl leading-none">{money(offer.amount)}<span className="text-base text-bone/70"> / month</span></p>
          <p className="mt-3 text-bone/70 max-w-md">{offer.tagline}</p>
        </div>
        <span className="h-10 w-10 rounded-full bg-bone/10 grid place-items-center shrink-0"><Lock className="h-4 w-4" /></span>
      </div>
      <ul className="mt-6 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {offer.features.map((f) => <li key={f} className="flex items-start gap-2"><Check className="h-4 w-4 mt-0.5 shrink-0" />{f}</li>)}
      </ul>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button type="button" className="btn bg-bone text-ink hover:opacity-90 !py-3 !px-6" disabled={busy !== ""} onClick={pay}>
          {busy === "pay" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy === "pay" ? "Opening Square…" : `Start for ${money(offer.amount)}/month`}
        </button>
        <p className="text-xs text-bone/60">Secure checkout by Square. Your first post is written minutes after you pay. Cancel any time from Billing.</p>
      </div>
      {admin && (
        <div className="mt-5 pt-5 border-t border-bone/15 flex flex-wrap items-center gap-3">
          <p className="text-xs text-bone/60">Studio: this company hasn&apos;t subscribed. Include it in their plan instead?</p>
          <button type="button" className="btn btn-ghost !border-bone/30 !text-bone !py-1.5 !px-3 text-xs" disabled={busy !== ""} onClick={comp}>{busy === "comp" ? "Saving…" : "Give access without a subscription"}</button>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-bone/80">{msg}</p>}
    </div>
  );
}

/** Back from Square: confirm the subscription, then the page re-renders unlocked. */
export function ConfirmPayment() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ok" | "unsure">("checking");
  useEffect(() => {
    let tries = 0, alive = true;
    const tick = async () => {
      tries++;
      const res = await fetch("/api/autopilot/subscription", { method: "POST" }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      if (!alive) return;
      if (j.access) { setState("ok"); router.refresh(); return; }
      if (tries < 8) setTimeout(tick, 3000); else setState("unsure");
    };
    tick();
    return () => { alive = false; };
  }, [router]);
  return (
    <div className="panel p-5 mb-6 flex items-start gap-3">
      {state === "checking" ? <Loader2 className="h-5 w-5 animate-spin shrink-0 mt-0.5" /> : <Check className="h-5 w-5 shrink-0 mt-0.5 text-good" />}
      <div>
        <p className="font-medium">{state === "checking" ? "Confirming your payment with Square…" : state === "ok" ? "You're in. Unlocking SEO Autopilot." : "We couldn't confirm it yet."}</p>
        <p className="text-sm text-ink-muted">{state === "unsure" ? "If you paid, it shows up within a minute or two: refresh this page. If you didn't finish, start again below." : "This takes a few seconds."}</p>
      </div>
    </div>
  );
}
