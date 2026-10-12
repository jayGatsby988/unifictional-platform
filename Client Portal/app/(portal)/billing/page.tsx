import Link from "next/link";
import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, FileText, Lock, MessageSquare } from "lucide-react";
import { Section, SubHead } from "@/components/Section";
import { getSession } from "@/lib/data/repo";
import { loadBilling } from "@/lib/billing/load";
import { money, type BillingInvoice } from "@/lib/billing/types";
import { cn, fmt } from "@/lib/utils";

export const dynamic = "force-dynamic";

const BRAND: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", discover_diners: "Diners", jcb: "JCB" };

function Status({ inv }: { inv: BillingInvoice }) {
  if (inv.status === "paid") return <span className="pill pill-good">Paid</span>;
  if (inv.status === "open") return <span className={cn("pill", inv.overdue ? "pill-bad" : "pill-warn")}>{inv.overdue ? "Overdue" : "Due"}</span>;
  if (inv.status === "void") return <span className="pill pill-neutral">Cancelled</span>;
  return <span className="pill pill-neutral">{inv.status}</span>;
}

function InvoiceActions({ inv, compact = false }: { inv: BillingInvoice; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2 justify-end">
      {inv.payUrl && <a href={inv.payUrl} target="_blank" rel="noreferrer" className="btn btn-ink !py-1.5 !px-3 text-xs whitespace-nowrap">Pay now</a>}
      {inv.viewUrl && !inv.payUrl && (
        <a href={inv.viewUrl} target="_blank" rel="noreferrer" title="View or print" aria-label={`View invoice ${inv.number ?? ""}`}
          className={cn("btn btn-ghost !py-1.5 text-xs whitespace-nowrap", compact ? "!px-2" : "!px-3")}>
          <ExternalLink className="h-3.5 w-3.5" />{!compact && (inv.status === "paid" ? "Receipt" : "View")}
        </a>
      )}
    </div>
  );
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  const state = await loadBilling(session, { preview: sp.preview === "1" });
  const askHref = (about: string) => `/requests?type=billing&about=${encodeURIComponent(about)}`;

  const intro = "Your plan, what's due, and every receipt. Payments go through Square, so we never see your card number.";

  if (state.kind !== "ok") {
    const copy = state.kind === "error"
      ? { h: "Billing didn't load just now.", p: "Square didn't answer. Refresh in a minute; if it keeps happening, let us know." }
      : { h: "Your invoices will show up here.", p: "Once we set up billing for your account, you'll see your plan, pay invoices in one tap and download receipts here." };
    return (
      <>
        <Section num="08" label="Billing" title="Billing." intro={intro} />
        <div className="panel p-6 max-w-2xl flex items-start gap-4">
          <span className="grid place-items-center h-10 w-10 rounded-full bg-sand shrink-0"><FileText className="h-4 w-4" /></span>
          <div>
            <h2 className="font-display text-2xl uppercase leading-tight">{copy.h}</h2>
            <p className="text-sm text-ink-muted mt-1">{copy.p}</p>
            <Link href={askHref("Question about billing")} className="btn btn-ghost !py-2 !px-4 text-xs mt-4"><MessageSquare className="h-3.5 w-3.5" />Ask about billing</Link>
          </div>
        </div>
      </>
    );
  }

  const b = state.summary;
  const open = b.invoices.filter((i) => i.status === "open").sort((x, y) => (x.dueAt ?? x.createdAt).localeCompare(y.dueAt ?? y.createdAt));
  const next = open[0];
  const plan = b.plans[0];

  return (
    <>
      <Section num="08" label="Billing" title="Billing." intro={intro} />

      {(state.sample || state.testMode) && (
        <p className="mb-6 text-xs font-mono uppercase tracking-wider text-ink-muted">{state.sample ? "Sample data · preview only" : "Square sandbox · no real charges"}</p>
      )}

      <div className="grid md:grid-cols-3 gap-4 mb-10">
        <div className={cn("panel p-5 flex flex-col", b.overdueTotal > 0 && "border-bad")}>
          <p className="label mb-3">Amount due</p>
          {open.length ? (
            <>
              <p className="font-display text-5xl leading-none">{money(b.openTotal, b.currency)}</p>
              <p className={cn("text-sm mt-2 flex items-center gap-1.5", b.overdueTotal > 0 ? "text-bad" : "text-ink-muted")}>
                {b.overdueTotal > 0 && <AlertTriangle className="h-4 w-4" />}
                {b.overdueTotal > 0 ? `${money(b.overdueTotal, b.currency)} is past due` : next?.dueAt ? `Due ${fmt.dateLong(next.dueAt)}` : "Due now"}
              </p>
              {next?.payUrl && <a href={next.payUrl} target="_blank" rel="noreferrer" className="btn btn-ink mt-5 justify-center">{open.length > 1 ? `Pay oldest · ${money(next.amountRemaining, next.currency)}` : `Pay ${money(next.amountRemaining, next.currency)}`}</a>}
            </>
          ) : (
            <>
              <p className="font-display text-5xl leading-none">$0</p>
              <p className="text-sm mt-2 text-good flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />You&apos;re all paid up.</p>
            </>
          )}
        </div>

        <div className="panel p-5">
          <p className="label mb-3">Your plan</p>
          {plan ? (
            <>
              <p className="font-display text-2xl uppercase leading-tight">{plan.name}</p>
              <p className="mt-1"><span className="font-display text-3xl">{money(plan.amount, plan.currency)}</span><span className="text-sm text-ink-muted"> / {plan.interval}</span></p>
              <p className="text-sm text-ink-muted mt-2">
                {plan.cancelAt ? `Ends ${fmt.dateLong(plan.cancelAt)}` : plan.nextChargeAt ? `Next invoice ${fmt.dateLong(plan.nextChargeAt)}` : plan.status === "past_due" ? "Payment past due" : "Active"}
              </p>
              <p className={cn("text-sm mt-2 font-medium", plan.autopay ? "text-good" : "text-ink")}>
                {plan.autopay ? "Autopay is on: charged to your saved card each month." : "Autopay is off: pay your next invoice and tick \u201cSave my card\u201d to switch to automatic payments."}
              </p>
              {b.plans.length > 1 && <p className="text-xs text-ink-muted mt-2">+ {b.plans.length - 1} more: {b.plans.slice(1).map((p) => `${p.name} (${money(p.amount, p.currency)}/${p.interval})`).join(", ")}</p>}
            </>
          ) : (
            <p className="text-sm text-ink-muted">No monthly plan. One-off work is billed by invoice below.</p>
          )}
        </div>

        <div className="panel p-5 flex flex-col">
          <p className="label mb-3">Payment method</p>
          {b.card ? (
            <div className="flex items-center gap-3">
              <span className="grid place-items-center h-10 w-14 rounded-lg border border-line"><CreditCard className="h-5 w-5" /></span>
              <div>
                <p className="font-medium">{BRAND[b.card.brand] ?? b.card.brand} •••• {b.card.last4}</p>
                <p className="text-xs text-ink-muted">Expires {String(b.card.expMonth).padStart(2, "0")}/{String(b.card.expYear).slice(-2)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No card saved yet.</p>
          )}
          <p className="text-xs text-ink-muted mt-auto pt-4">Pay by card, bank transfer or Cash App on Square&apos;s secure page. Tick &quot;save card&quot; there to pay future invoices faster.</p>
        </div>
      </div>

      <SubHead right={<span className="label !text-[9px] flex items-center gap-1"><Lock className="h-3 w-3" />Secured by Square</span>}>Invoices &amp; receipts</SubHead>
      {b.invoices.length === 0 ? (
        <div className="panel p-5 text-sm text-ink-muted mb-10">No invoices yet.</div>
      ) : (
        <>
          <div className="panel p-5 mb-10 hidden lg:block overflow-x-auto">
            <table className="table w-full">
              <thead><tr><th>Date</th><th>Invoice</th><th>For</th><th className="text-right">Amount</th><th>Status</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {b.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="whitespace-nowrap">{fmt.dateLong(inv.createdAt)}</td>
                    <td className="font-mono text-xs whitespace-nowrap">{inv.number ?? "—"}</td>
                    <td className="max-w-[220px] truncate" title={inv.description}>{inv.description}</td>
                    <td className="text-right font-mono text-sm whitespace-nowrap">{money(inv.amountDue, inv.currency)}</td>
                    <td><Status inv={inv} /></td>
                    <td className="w-px"><InvoiceActions inv={inv} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="lg:hidden space-y-3 mb-10">
            {b.invoices.map((inv) => (
              <li key={inv.id} className="panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{inv.description}</p>
                    <p className="text-xs text-ink-muted">{fmt.dateLong(inv.createdAt)}{inv.number ? ` · ${inv.number}` : ""}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm">{money(inv.amountDue, inv.currency)}</p>
                    <Status inv={inv} />
                  </div>
                </div>
                {(inv.payUrl || inv.viewUrl) && <div className="mt-3"><InvoiceActions inv={inv} /></div>}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="panel p-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Question about a charge or need a receipt sent somewhere else?</p>
        <Link href={askHref("Question about an invoice")} className="btn btn-ghost !py-2 !px-4 text-xs"><MessageSquare className="h-3.5 w-3.5" />Ask us</Link>
      </div>
    </>
  );
}
