import type { BillingCard, BillingInvoice, BillingPlan, BillingSummary, InvoiceStatus } from "./types";

/** The slices of Square's JSON we read (Square-Version 2026-09-16). */
export type SqMoney = { amount?: number; currency?: string };
export type SqInvoice = {
  id?: string; invoice_number?: string; title?: string; description?: string; status?: string;
  public_url?: string; created_at?: string; order_id?: string;
  payment_requests?: { due_date?: string; computed_amount_money?: SqMoney; total_completed_amount_money?: SqMoney }[];
};
export type SqCard = { card_brand?: string; last_4?: string; exp_month?: number; exp_year?: number; enabled?: boolean };
export type SqSubscription = {
  id?: string; status?: string; plan_variation_id?: string; start_date?: string; charged_through_date?: string;
  canceled_date?: string; price_override_money?: SqMoney; customer_id?: string; card_id?: string; version?: number;
};
export type SqVariation = { id?: string; subscription_plan_variation_data?: { name?: string; phases?: { cadence?: string; pricing?: { price?: SqMoney; price_money?: SqMoney }; recurring_price_money?: SqMoney }[] } };

const OPEN = new Set(["UNPAID", "SCHEDULED", "PARTIALLY_PAID", "PAYMENT_PENDING", "FAILED"]);
const PAID = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);
const CADENCE: Record<string, string> = { DAILY: "day", WEEKLY: "week", EVERY_TWO_WEEKS: "2 weeks", MONTHLY: "month", EVERY_TWO_MONTHS: "2 months", QUARTERLY: "quarter", ANNUAL: "year" };

/** "2026-10-08" style date in UTC, for comparing against Square's due dates. */
export const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dateIso = (d?: string | null) => (d ? `${d}T12:00:00.000Z` : null);

export function mapCard(c: SqCard | undefined | null): BillingCard | null {
  if (!c || c.enabled === false || !c.last_4) return null;
  return { brand: (c.card_brand ?? "card").toLowerCase().replace("american_express", "amex"), last4: c.last_4, expMonth: c.exp_month ?? 0, expYear: c.exp_year ?? 0 };
}

export function mapInvoice(inv: SqInvoice, nowMs: number): BillingInvoice | null {
  if (!inv.id || !inv.status || inv.status === "DRAFT") return null;
  const req = inv.payment_requests?.[0];
  const due = req?.computed_amount_money?.amount ?? 0;
  const paid = req?.total_completed_amount_money?.amount ?? 0;
  const status: InvoiceStatus = PAID.has(inv.status) ? "paid" : OPEN.has(inv.status) ? "open" : inv.status === "CANCELED" ? "void" : "uncollectible";
  const dueDate = req?.due_date ?? null;
  return {
    id: inv.id,
    number: inv.invoice_number ?? null,
    description: inv.title || inv.description || "Invoice",
    amountDue: due,
    amountPaid: paid,
    amountRemaining: status === "open" ? Math.max(0, due - paid) : 0,
    currency: (req?.computed_amount_money?.currency ?? "USD").toLowerCase(),
    status,
    createdAt: inv.created_at ?? new Date(nowMs).toISOString(),
    dueAt: dateIso(dueDate),
    overdue: status === "open" && Boolean(dueDate && dueDate < ymd(nowMs)),
    payUrl: status === "open" ? inv.public_url ?? null : null,
    viewUrl: inv.public_url ?? null,
  };
}

export function mapPlan(sub: SqSubscription, variations: Record<string, SqVariation>): BillingPlan {
  const v = sub.plan_variation_id ? variations[sub.plan_variation_id] : undefined;
  const phase = v?.subscription_plan_variation_data?.phases?.[0];
  const price = sub.price_override_money ?? phase?.pricing?.price ?? phase?.pricing?.price_money ?? phase?.recurring_price_money;
  const active = sub.status === "ACTIVE" || sub.status === "PENDING";
  return {
    id: sub.id ?? "",
    name: v?.subscription_plan_variation_data?.name ?? "Monthly plan",
    amount: price?.amount ?? 0,
    currency: (price?.currency ?? "USD").toLowerCase(),
    interval: CADENCE[phase?.cadence ?? "MONTHLY"] ?? "month",
    status: (sub.status ?? "").toLowerCase(),
    nextChargeAt: active && !sub.canceled_date ? dateIso(sub.charged_through_date ?? sub.start_date) : null,
    cancelAt: dateIso(sub.canceled_date),
    autopay: Boolean(sub.card_id),
  };
}

export function summarize(input: {
  email: string | null; card: BillingCard | null; subs: SqSubscription[]; invoices: SqInvoice[];
  variations: Record<string, SqVariation>; nowMs: number;
}): BillingSummary {
  const invoices = input.invoices.map((i) => mapInvoice(i, input.nowMs)).filter((i): i is BillingInvoice => i !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const plans = input.subs.filter((s) => ["ACTIVE", "PENDING", "PAUSED"].includes(s.status ?? "")).map((s) => mapPlan(s, input.variations));
  const open = invoices.filter((i) => i.status === "open");
  return {
    email: input.email,
    card: input.card,
    plans,
    invoices,
    openTotal: open.reduce((a, i) => a + i.amountRemaining, 0),
    overdueTotal: open.filter((i) => i.overdue).reduce((a, i) => a + i.amountRemaining, 0),
    currency: invoices[0]?.currency ?? plans[0]?.currency ?? "usd",
  };
}
