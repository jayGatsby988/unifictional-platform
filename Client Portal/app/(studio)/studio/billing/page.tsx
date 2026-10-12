import { AlertTriangle } from "lucide-react";
import { getSession } from "@/lib/data/repo";
import { getStudioBilling } from "@/lib/billing/studio";
import { money } from "@/lib/billing/types";
import { BillingActions } from "@/components/studio/BillingActions";
import { getPlans } from "@/lib/data/plans";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StudioBillingPage() {
  const session = await getSession();
  const [d, plans] = await Promise.all([getStudioBilling(session), getPlans()]);
  const presets = plans.filter((p) => p.priceCents !== null).map((p) => ({ name: p.name, dollars: String(p.priceCents! / 100) }));

  return (
    <>
      <div className="mb-8">
        <p className="label mb-2">Studio · Billing</p>
        <h1 className="font-display text-3xl sm:text-4xl leading-none">
          {d.configured ? `${money(d.totals.monthly)}/mo recurring.` : "Get paid through the portal."}
        </h1>
        <p className="mt-2 text-sm text-ink-muted max-w-2xl">
          Link each company to Square once. Then send the build invoice and start the monthly plan from here. Clients pay, save a card and download receipts on their own Billing page.
        </p>
        {d.testMode && <p className="mt-3 text-xs font-mono uppercase tracking-wider text-warn">Square sandbox · no real charges</p>}
      </div>

      {!d.configured ? (
        <div className="panel p-6 max-w-2xl mb-8">
          <p className="label mb-2">Turn on billing · about 5 minutes</p>
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            <li>Open <span className="font-mono">developer.squareup.com/apps</span> signed in to your Square account and create an application (any name, e.g. &quot;Client Portal&quot;).</li>
            <li>Switch the app to <span className="font-mono">Production</span> and copy its <span className="font-mono">Access token</span>.</li>
            <li>Add it to Vercel as <span className="font-mono">SQUARE_ACCESS_TOKEN</span> (Production, Sensitive) and redeploy. If you bill from more than one Square location, also add <span className="font-mono">SQUARE_LOCATION_ID</span>.</li>
            <li>Come back here and link your first company. Clients already in your Square customer list are matched by email.</li>
          </ol>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="panel p-4"><p className="label !text-[9px] mb-1">Monthly recurring</p><p className="font-display text-3xl">{money(d.totals.monthly)}</p></div>
            <div className="panel p-4"><p className="label !text-[9px] mb-1">Waiting to be paid</p><p className="font-display text-3xl">{money(d.totals.open)}</p></div>
            <div className={cn("panel p-4", d.totals.overdue > 0 && "border-bad")}><p className="label !text-[9px] mb-1">Overdue</p><p className={cn("font-display text-3xl", d.totals.overdue > 0 && "text-bad")}>{money(d.totals.overdue)}</p></div>
            <div className="panel p-4"><p className="label !text-[9px] mb-1">Linked to Square</p><p className="font-display text-3xl">{d.totals.linked}<span className="text-ink-muted text-xl">/{d.companies.length}</span></p></div>
          </div>
          {d.error && <p className="panel p-4 mb-6 text-sm text-bad flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Square didn&apos;t answer: {d.error}</p>}
        </>
      )}

      <div className="space-y-3">
        {d.companies.map((c) => (
          <div key={c.id} className={cn("panel p-5", c.billing && c.billing.overdue > 0 && "border-bad")}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-display text-xl uppercase leading-tight">{c.name}</p>
                <p className="text-xs text-ink-muted mt-0.5">{c.customerId ? "Linked to Square" : "Not linked to Square"}</p>
              </div>
              {c.billing && (
                <dl className="grid grid-cols-4 gap-5 text-center">
                  <div><dt className="label !text-[8px] mb-1">Monthly</dt><dd className="font-display text-lg">{money(c.billing.monthly)}</dd></div>
                  <div><dt className="label !text-[8px] mb-1">Open</dt><dd className="font-display text-lg">{money(c.billing.open)}</dd></div>
                  <div><dt className="label !text-[8px] mb-1">Overdue</dt><dd className={cn("font-display text-lg", c.billing.overdue > 0 && "text-bad")}>{money(c.billing.overdue)}</dd></div>
                  <div><dt className="label !text-[8px] mb-1">Autopay</dt><dd className={cn("font-display text-lg", c.billing.plans > 0 && c.billing.autopay < c.billing.plans && "text-warn")}>{c.billing.plans ? (c.billing.autopay === c.billing.plans ? "On" : "Off") : "—"}</dd></div>
                </dl>
              )}
            </div>
            {d.configured && (
              <div className="mt-4 pt-4 border-t border-line">
                <BillingActions slug={c.slug} name={c.name} customerId={c.customerId} defaultEmail={c.logins[0] ?? ""} dashboard={d.dashboard} presets={presets} needsAutopay={Boolean(c.billing && c.billing.plans > c.billing.autopay)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
