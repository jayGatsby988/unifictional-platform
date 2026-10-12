import { randomUUID } from "node:crypto";
import { mapCard, mapPlan, summarize, ymd, type SqCard, type SqInvoice, type SqSubscription, type SqVariation } from "./map";
import type { BillingSummary, StudioBillingRow } from "./types";

/**
 * Square is the source of truth for invoices, plans and cards. The portal stores
 * only each company's Square customer id and reads everything else live.
 * SQUARE_ACCESS_TOKEN lives in Vercel env only; nothing here runs in the browser.
 *   SQUARE_ENVIRONMENT = "sandbox" to test (default: production)
 *   SQUARE_LOCATION_ID = which business location bills (default: first active one)
 */
const VERSION = "2026-09-16";
export const squareConfigured = Boolean(process.env.SQUARE_ACCESS_TOKEN);
export const squareSandbox = process.env.SQUARE_ENVIRONMENT === "sandbox";
const BASE = squareSandbox ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
export const squareDashboard = squareSandbox ? "https://app.squareupsandbox.com/dashboard" : "https://app.squareup.com/dashboard";

async function sq<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<T> {
  if (!process.env.SQUARE_ACCESS_TOKEN) throw new Error("SQUARE_ACCESS_TOKEN is not set");
  const res = await fetch(BASE + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, "Square-Version": VERSION, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { errors?: { detail?: string; code?: string }[] };
  if (!res.ok) throw new Error(json.errors?.[0]?.detail ?? `Square returned ${res.status}`);
  return json;
}

let cachedLocation: string | null = null;
export async function locationId(): Promise<string> {
  if (process.env.SQUARE_LOCATION_ID) return process.env.SQUARE_LOCATION_ID;
  if (cachedLocation) return cachedLocation;
  const { locations = [] } = await sq<{ locations?: { id: string; status?: string }[] }>("/v2/locations");
  const loc = locations.find((l) => l.status === "ACTIVE") ?? locations[0];
  if (!loc) throw new Error("This Square account has no locations.");
  cachedLocation = loc.id;
  return loc.id;
}

async function invoicesFor(customerId: string, loc: string): Promise<SqInvoice[]> {
  const { invoices = [] } = await sq<{ invoices?: SqInvoice[] }>("/v2/invoices/search", {
    query: { filter: { location_ids: [loc], customer_ids: [customerId] }, sort: { field: "INVOICE_SORT_DATE", order: "DESC" } }, limit: 50,
  });
  return invoices;
}

async function subscriptionsFor(customerIds: string[]): Promise<SqSubscription[]> {
  const { subscriptions = [] } = await sq<{ subscriptions?: SqSubscription[] }>("/v2/subscriptions/search", { query: { filter: { customer_ids: customerIds } }, limit: 200 });
  return subscriptions;
}

async function variationsFor(subs: SqSubscription[]): Promise<Record<string, SqVariation>> {
  const ids = [...new Set(subs.map((s) => s.plan_variation_id).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return {};
  const { objects = [] } = await sq<{ objects?: SqVariation[] }>("/v2/catalog/batch-retrieve", { object_ids: ids });
  return Object.fromEntries(objects.filter((o) => o.id).map((o) => [o.id!, o]));
}

export async function getBillingSummary(customerId: string, nowMs: number): Promise<BillingSummary> {
  const loc = await locationId();
  const [cust, cards, invoices, subs] = await Promise.all([
    sq<{ customer?: { email_address?: string } }>(`/v2/customers/${encodeURIComponent(customerId)}`),
    sq<{ cards?: SqCard[] }>(`/v2/cards?customer_id=${encodeURIComponent(customerId)}`),
    invoicesFor(customerId, loc),
    subscriptionsFor([customerId]),
  ]);
  const variations = await variationsFor(subs);
  return summarize({ email: cust.customer?.email_address ?? null, card: mapCard((cards.cards ?? []).find((c) => c.enabled !== false)), subs, invoices, variations, nowMs });
}

/** Reuse the Square customer with this email if one exists (most contractors are already in your Square), otherwise create one. */
export async function findOrCreateCustomer(input: { email: string; name: string; clientId: string }): Promise<{ id: string; existed: boolean }> {
  const found = await sq<{ customers?: { id: string }[] }>("/v2/customers/search", { query: { filter: { email_address: { exact: input.email } } }, limit: 1 });
  if (found.customers?.[0]) return { id: found.customers[0].id, existed: true };
  const created = await sq<{ customer: { id: string } }>("/v2/customers", {
    idempotency_key: randomUUID(), company_name: input.name, email_address: input.email, reference_id: input.clientId,
  });
  return { id: created.customer.id, existed: false };
}

/** One-off invoice (e.g. the website build). Square emails it with a pay link; it also shows in the portal. */
export async function sendInvoice(input: { customerId: string; description: string; amount: number; daysUntilDue: number; nowMs: number }) {
  const loc = await locationId();
  const order = await sq<{ order: { id: string } }>("/v2/orders", {
    idempotency_key: randomUUID(),
    order: { location_id: loc, customer_id: input.customerId, line_items: [{ name: input.description, quantity: "1", base_price_money: { amount: input.amount, currency: "USD" } }] },
  });
  const draft = await sq<{ invoice: { id: string; version: number } }>("/v2/invoices", {
    idempotency_key: randomUUID(),
    invoice: {
      location_id: loc,
      order_id: order.order.id,
      primary_recipient: { customer_id: input.customerId },
      delivery_method: "EMAIL",
      title: input.description,
      payment_requests: [{ request_type: "BALANCE", due_date: ymd(input.nowMs + input.daysUntilDue * 86_400_000), automatic_payment_source: "NONE" }],
      accepted_payment_methods: { card: true, bank_account: true, square_gift_card: false, buy_now_pay_later: false, cash_app_pay: true },
      store_payment_method_enabled: true,
    },
  });
  const published = await sq<{ invoice: { id: string; invoice_number?: string; public_url?: string } }>(`/v2/invoices/${draft.invoice.id}/publish`, { version: draft.invoice.version, idempotency_key: randomUUID() });
  return { id: published.invoice.id, number: published.invoice.invoice_number ?? null, url: published.invoice.public_url ?? null };
}

async function findCatalog(type: "SUBSCRIPTION_PLAN" | "SUBSCRIPTION_PLAN_VARIATION", name: string): Promise<string | null> {
  const { objects = [] } = await sq<{ objects?: { id: string; is_deleted?: boolean }[] }>("/v2/catalog/search", {
    object_types: [type], query: { exact_query: { attribute_name: "name", attribute_value: name } }, limit: 1,
  });
  return objects.find((o) => !o.is_deleted)?.id ?? null;
}

/**
 * Monthly plan (e.g. SEO & care) via Square Subscriptions. With no card on file,
 * Square emails an invoice each month; once the client saves a card while paying,
 * you can switch them to autopay in Square.
 */
export async function startMonthlyPlan(input: { customerId: string; name: string; amount: number; nowMs: number }) {
  const loc = await locationId();
  const { variationId } = await ensurePlanVariation(input.name, input.amount);
  const sub = await sq<{ subscription: { id: string; status?: string } }>("/v2/subscriptions", {
    idempotency_key: randomUUID(), location_id: loc, customer_id: input.customerId, plan_variation_id: variationId,
    start_date: ymd(input.nowMs), timezone: "America/Los_Angeles",
  });
  return { id: sub.subscription.id, status: sub.subscription.status ?? "" };
}

/**
 * Switch a customer's running plans to automatic card payments. Square subscriptions with no
 * card email an invoice each period; once the client has a card on file (e.g. they ticked
 * "save my card" when paying an invoice), attaching it makes Square charge it automatically.
 */
export async function autopayForCustomer(customerId: string): Promise<{ switched: number; pending: number; hasCard: boolean }> {
  const subs = (await subscriptionsFor([customerId])).filter((s) => ["ACTIVE", "PENDING"].includes(s.status ?? "") && !s.card_id);
  if (!subs.length) return { switched: 0, pending: 0, hasCard: true };
  const { cards = [] } = await sq<{ cards?: (SqCard & { id?: string })[] }>(`/v2/cards?customer_id=${encodeURIComponent(customerId)}`);
  const card = cards.find((c) => c.enabled !== false && c.id);
  if (!card?.id) return { switched: 0, pending: subs.length, hasCard: false };
  let switched = 0;
  for (const s of subs) {
    await sq(`/v2/subscriptions/${encodeURIComponent(s.id!)}`, { subscription: { card_id: card.id, ...(s.version ? { version: s.version } : {}) } }, "PUT");
    switched++;
  }
  return { switched, pending: 0, hasCard: true };
}

/** Studio overview: monthly recurring and open balances per linked company. */
export async function studioBilling(customerIds: string[], nowMs: number): Promise<Record<string, StudioBillingRow>> {
  const out: Record<string, StudioBillingRow> = {};
  for (const id of customerIds) out[id] = { monthly: 0, open: 0, overdue: 0, openCount: 0, plans: 0, autopay: 0 };
  if (!customerIds.length) return out;
  const loc = await locationId();
  const subs = await subscriptionsFor(customerIds);
  const variations = await variationsFor(subs);
  for (const s of subs) {
    if (!s.customer_id || !out[s.customer_id] || s.status !== "ACTIVE") continue;
    const p = mapPlan(s, variations);
    out[s.customer_id].plans += 1;
    if (p.autopay) out[s.customer_id].autopay += 1;
    out[s.customer_id].monthly += p.interval === "year" ? Math.round(p.amount / 12) : p.interval === "quarter" ? Math.round(p.amount / 3) : p.amount;
  }
  const lists = await Promise.all(customerIds.map((id) => invoicesFor(id, loc).then((inv) => [id, inv] as const)));
  for (const [id, invoices] of lists) {
    const s = summarize({ email: null, card: null, subs: [], invoices, variations: {}, nowMs });
    out[id].open = s.openTotal;
    out[id].overdue = s.overdueTotal;
    out[id].openCount = s.invoices.filter((i) => i.status === "open").length;
  }
  return out;
}

/** The catalog plan + monthly variation for a named plan at a price, created on first use. */
export async function ensurePlanVariation(name: string, amount: number, label = name): Promise<{ planId: string; variationId: string; variationName: string }> {
  const variationName = `${label} · $${(amount / 100).toLocaleString("en-US")}/mo`;
  let planId = await findCatalog("SUBSCRIPTION_PLAN", name);
  if (!planId) {
    const plan = await sq<{ catalog_object: { id: string } }>("/v2/catalog/object", {
      idempotency_key: randomUUID(), object: { type: "SUBSCRIPTION_PLAN", id: "#plan", subscription_plan_data: { name } },
    });
    planId = plan.catalog_object.id;
  }
  let variationId = await findCatalog("SUBSCRIPTION_PLAN_VARIATION", variationName);
  if (!variationId) {
    const variation = await sq<{ catalog_object: { id: string } }>("/v2/catalog/object", {
      idempotency_key: randomUUID(),
      object: {
        type: "SUBSCRIPTION_PLAN_VARIATION", id: "#variation",
        subscription_plan_variation_data: {
          name: variationName, subscription_plan_id: planId,
          phases: [{ ordinal: 0, cadence: "MONTHLY", pricing: { type: "STATIC", price: { amount, currency: "USD" } } }],
        },
      },
    });
    variationId = variation.catalog_object.id;
  }
  return { planId, variationId, variationName };
}

/**
 * Square-hosted checkout for a monthly plan: the client enters a card on Square's
 * page, Square charges the first month, creates the subscription with the card
 * on file (autopay) and sends them back to `redirectUrl`. Nothing card-related
 * touches the portal.
 */
export async function createPlanCheckout(input: { customerId: string; email: string; planName: string; variationName?: string; amount: number; redirectUrl: string }): Promise<{ url: string; linkId: string }> {
  const loc = await locationId();
  const label = input.variationName ?? input.planName;
  const { planId, variationId } = await ensurePlanVariation(input.planName, input.amount, label);
  const body = (subscriptionPlanId: string) => ({
    idempotency_key: randomUUID(),
    order: { location_id: loc, customer_id: input.customerId, line_items: [{ name: label, quantity: "1", base_price_money: { amount: input.amount, currency: "USD" } }] },
    checkout_options: { subscription_plan_id: subscriptionPlanId, redirect_url: input.redirectUrl, ask_for_shipping_address: false, allow_tipping: false, enable_coupon: false },
    pre_populated_data: { buyer_email: input.email },
    payment_note: `${label} — Unifictional`,
  });
  // Square moved subscription checkout from plan ids to plan-variation ids; accept whichever this account's API version wants.
  let res: { payment_link?: { id?: string; url?: string; long_url?: string } };
  try {
    res = await sq("/v2/online-checkout/payment-links", body(variationId));
  } catch (e) {
    if (!/plan|variation/i.test(e instanceof Error ? e.message : "")) throw e;
    res = await sq("/v2/online-checkout/payment-links", body(planId));
  }
  const url = res.payment_link?.url ?? res.payment_link?.long_url;
  if (!url || !res.payment_link?.id) throw new Error("Square didn't return a checkout link.");
  return { url, linkId: res.payment_link.id };
}

export async function findCustomerByEmail(email: string): Promise<string | null> {
  const found = await sq<{ customers?: { id: string }[] }>("/v2/customers/search", { query: { filter: { email_address: { exact: email } } }, limit: 1 });
  return found.customers?.[0]?.id ?? null;
}

/** The customer's subscription to a named plan, if any (most recent first). */
export async function findPlanSubscription(customerId: string, planName: string): Promise<{ id: string; status: string; variationName: string; cardOnFile: boolean } | null> {
  const subs = await subscriptionsFor([customerId]);
  const variations = await variationsFor(subs);
  const mine = subs
    .map((s) => ({ s, name: s.plan_variation_id ? variations[s.plan_variation_id]?.subscription_plan_variation_data?.name ?? "" : "" }))
    .filter((x) => x.name.toLowerCase().startsWith(planName.toLowerCase()))
    .sort((a, b) => (b.s.start_date ?? "").localeCompare(a.s.start_date ?? ""));
  const live = mine.find((x) => ["ACTIVE", "PENDING"].includes(x.s.status ?? "")) ?? mine[0];
  return live?.s.id ? { id: live.s.id, status: live.s.status ?? "", variationName: live.name, cardOnFile: Boolean(live.s.card_id) } : null;
}
