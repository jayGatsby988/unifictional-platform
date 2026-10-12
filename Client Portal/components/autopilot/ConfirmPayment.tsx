"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

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
      {state === "checking" ? <Loader2 className="h-5 w-5 animate-spin shrink-0 mt-0.5" /> : state === "ok" ? <Check className="h-5 w-5 shrink-0 mt-0.5 text-good" /> : <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-warn" />}
      <div>
        <p className="font-medium">{state === "checking" ? "Confirming your payment with Square…" : state === "ok" ? "You're in. Unlocking SEO Autopilot." : "We couldn't confirm it yet."}</p>
        <p className="text-sm text-ink-muted">{state === "unsure" ? "If you paid, it shows up within a minute or two: refresh this page. If you didn't finish, start again below." : "This takes a few seconds."}</p>
      </div>
    </div>
  );
}
