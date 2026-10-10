import Link from "next/link";
import { Check, MessageSquare } from "lucide-react";
import { Section } from "@/components/Section";
import { ChoosePlan } from "@/components/plans/ChoosePlan";
import { getSession } from "@/lib/data/repo";
import { getPlans, isCurrentPlan } from "@/lib/data/plans";
import { loadBilling } from "@/lib/billing/load";
import { money } from "@/lib/billing/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const session = await getSession();
  const [plans, billing] = await Promise.all([getPlans(), loadBilling(session)]);
  const current = billing.kind === "ok" ? billing.summary.plans.map((p) => p.name) : [];

  return (
    <>
      <Section num="08" label="Plans" title="Plans." intro="What each plan includes. Tap I'm interested and we'll reach out to walk you through it and price it to your business." />

      {plans.length === 0 ? (
        <div className="panel p-6 max-w-2xl text-sm text-ink-muted">Plans are being set up. Ask us anytime about what&apos;s included.</div>
      ) : (
        <div className={cn("grid gap-4 mb-10", plans.length >= 3 ? "lg:grid-cols-3" : plans.length === 2 ? "md:grid-cols-2" : "max-w-md")}>
          {plans.map((p) => {
            const mine = isCurrentPlan(p, current);
            const dark = p.highlight && !mine;
            const price = p.priceCents === null ? "Custom" : money(p.priceCents);
            return (
              <div key={p.id} className={cn("panel p-6 flex flex-col", dark && "!bg-ink !text-bone !border-ink", mine && "border-ink")}>
                <div className="flex items-center justify-between gap-3 mb-4 min-h-6">
                  {mine ? <span className="pill pill-good">Your plan</span> : p.highlight ? <span className="label !text-bone/70">Most popular</span> : <span />}
                </div>
                <h2 className="font-display text-3xl uppercase leading-none">{p.name}</h2>
                {p.tagline && <p className={cn("text-sm mt-2", dark ? "text-bone/70" : "text-ink-muted")}>{p.tagline}</p>}
                <p className="mt-5">
                  <span className="font-display text-5xl leading-none">{price}</span>
                  {p.priceCents !== null && <span className={cn("text-sm", dark ? "text-bone/70" : "text-ink-muted")}> / {p.interval}</span>}
                </p>
                {p.priceCents === null && <p className={cn("text-xs mt-1", dark ? "text-bone/60" : "text-ink-muted")}>Priced to your scope.</p>}
                <ul className="mt-6 space-y-2.5 text-sm flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5"><Check className={cn("h-4 w-4 mt-0.5 shrink-0", dark ? "text-bone" : "text-good")} />{f}</li>
                  ))}
                </ul>
                <div className="mt-6">
                  {mine ? <p className="text-sm text-ink-muted">You&apos;re on this plan.</p> : <ChoosePlan name={p.name} current={current[0]} dark={dark} />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="panel p-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Not sure which fits? We&apos;ll look at your numbers and tell you straight.</p>
        <Link href={`/requests?type=billing&about=${encodeURIComponent("Which plan fits us?")}`} className="btn btn-ghost !py-2 !px-4 text-xs"><MessageSquare className="h-3.5 w-3.5" />Ask us</Link>
      </div>
    </>
  );
}
