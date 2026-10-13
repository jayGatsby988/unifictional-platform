import Link from "next/link";
import { Box, Check, MessageSquare } from "lucide-react";
import { UNLOCK_CENTS } from "@/lib/billing/platform";
import { Section, SubHead } from "@/components/Section";
import { ChoosePlan } from "@/components/plans/ChoosePlan";
import { PlanBuilder } from "@/components/plans/PlanBuilder";
import { getSession } from "@/lib/data/repo";
import { getAutopilot } from "@/lib/data/autopilot";
import { isCurrentPlan } from "@/lib/data/plans";
import { loadBilling } from "@/lib/billing/load";
import { loadBuilder } from "@/lib/billing/builder";
import { money } from "@/lib/billing/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const session = await getSession();
  const [{ plans, catalog, rec }, billing, auto] = await Promise.all([loadBuilder(session), loadBilling(session), getAutopilot(session)]);
  const billed = billing.kind === "ok" ? billing.summary.plans.map((p) => p.name) : [];
  const s = auto.settings;
  const current = s.access ? { label: s.comped ? "SEO Autopilot, included by Unifictional" : s.subscription?.plan ?? s.package?.name ?? "SEO Autopilot", comped: s.comped } : null;
  const custom = plans.filter((p) => !p.role);

  return (
    <>
      <Section num="09" label="Plans" title="Build your plan."
        intro={current ? `You're on ${current.label}. Build a different mix below and we'll switch you over.` : "Pick how many posts a month, add what you need, and start on Square. Change or cancel any time."} />

      {catalog
        ? <div className="mb-12"><PlanBuilder catalog={catalog} rec={rec} company={{ name: session.client?.name ?? "you" }} slug={session.client?.slug ?? ""} demo={session.isDemo} admin={session.isAdmin} current={current} mode="plans" /></div>
        : <div className="panel p-6 max-w-2xl text-sm text-ink-muted mb-12">Plans are being set up. Ask us anytime about what&apos;s included.</div>}

      <section className="mb-10">
        <SubHead right={<span className="label !text-xs">Pay once · no subscription</span>}>Tools</SubHead>
        <div className="panel p-6 grid md:grid-cols-5 gap-6 items-center">
          <div className="md:col-span-3">
            <div className="flex items-center gap-2 mb-2"><Box className="h-4 w-4" /><h2 className="font-display text-3xl uppercase leading-none">3D Remodel Studio</h2></div>
            <p className="text-sm text-ink-muted">Upload photos of a kitchen, bath or lot and get an explorable 3D twin in about a minute. Swap materials and the price updates live; render photoreal images from your own photo; share a link clients can spin on their phone.</p>
            <ul className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {["2 scans free, no card", `${money(UNLOCK_CENTS)} unlocks unlimited scans for 30 days`, "250+ real materials, live line-item pricing", "Photoreal renders and share links"].map((f) => <li key={f} className="flex items-start gap-2"><Check className="h-4 w-4 mt-0.5 shrink-0 text-good" />{f}</li>)}
            </ul>
          </div>
          <div className="md:col-span-2 md:border-l md:border-line md:pl-6">
            <p className="font-display text-5xl leading-none">{money(UNLOCK_CENTS)}<span className="text-sm text-ink-muted font-sans"> / 30 days</span></p>
            <p className="text-xs text-ink-muted mt-1">Launch price. Billed once on Square.</p>
            <div className="mt-4 flex flex-col gap-2">
              <a className="btn btn-ink justify-center" href="https://3d.unifictional.com/studio?buy=1" target="_blank" rel="noreferrer">Unlock for {money(UNLOCK_CENTS)}</a>
              <a className="btn btn-ghost justify-center" href="https://3d.unifictional.com/studio" target="_blank" rel="noreferrer">Try 2 scans free</a>
            </div>
          </div>
        </div>
      </section>

      {custom.length > 0 && (
        <section className="mb-10">
          <SubHead>More from the studio</SubHead>
          <div className={cn("grid gap-4", custom.length >= 3 ? "lg:grid-cols-3" : custom.length === 2 ? "md:grid-cols-2" : "max-w-md")}>
            {custom.map((p) => {
              const mine = isCurrentPlan(p, billed);
              return (
                <div key={p.id} className={cn("panel p-6 flex flex-col", mine && "border-ink")}>
                  <div className="flex items-center justify-between gap-3 mb-4 min-h-6">{mine ? <span className="pill pill-good">Your plan</span> : <span />}</div>
                  <h2 className="font-display text-3xl uppercase leading-none">{p.name}</h2>
                  {p.tagline && <p className="text-sm mt-2 text-ink-muted">{p.tagline}</p>}
                  <p className="mt-5">
                    <span className="font-display text-5xl leading-none">{p.priceCents === null ? "Custom" : money(p.priceCents)}</span>
                    {p.priceCents !== null && <span className="text-sm text-ink-muted"> / {p.interval}</span>}
                  </p>
                  {p.priceCents === null && <p className="text-xs mt-1 text-ink-muted">Priced to your scope.</p>}
                  <ul className="mt-6 space-y-2.5 text-sm flex-1">
                    {p.features.map((f) => <li key={f} className="flex items-start gap-2.5"><Check className="h-4 w-4 mt-0.5 shrink-0 text-good" />{f}</li>)}
                  </ul>
                  <div className="mt-6">{mine ? <p className="text-sm text-ink-muted">You&apos;re on this plan.</p> : <ChoosePlan name={p.name} current={billed[0]} />}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="panel p-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Not sure which fits? We&apos;ll look at your numbers and tell you straight.</p>
        <Link href={`/requests?type=billing&about=${encodeURIComponent("Which plan fits us?")}`} className="btn btn-ghost !py-2 !px-4 text-xs"><MessageSquare className="h-3.5 w-3.5" />Ask us</Link>
      </div>
    </>
  );
}
