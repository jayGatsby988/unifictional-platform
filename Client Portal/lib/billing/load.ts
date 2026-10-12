import type { Session } from "@/lib/data/repo";
import { getBillingSummary, squareConfigured, squareSandbox } from "./square";
import type { BillingSummary } from "./types";

export type BillingState =
  | { kind: "off" }                       // Square not set up yet
  | { kind: "unlinked" }                  // this company has no Square customer yet
  | { kind: "error"; message: string }
  | { kind: "ok"; summary: BillingSummary; sample: boolean; testMode: boolean };

const day = 86_400_000;

/** Realistic sample for demo mode and local design preview. Never shown to a real client in production. */
export function sampleBilling(now: number): BillingSummary {
  const at = (d: number) => new Date(now + d * day).toISOString();
  return {
    email: "owner@example.com",
    card: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 },
    plans: [{ id: "sub_demo", name: "SEO & website care", amount: 150000, currency: "usd", interval: "month", status: "active", nextChargeAt: at(12), cancelAt: null, autopay: true }],
    invoices: [
      { id: "in_3", number: "UNI-0007", description: "SEO & website care (October)", amountDue: 150000, amountPaid: 0, amountRemaining: 150000, currency: "usd", status: "open", createdAt: at(-9), dueAt: at(-2), overdue: true, payUrl: "#", viewUrl: "#" },
      { id: "in_2", number: "UNI-0004", description: "SEO & website care (September)", amountDue: 150000, amountPaid: 150000, amountRemaining: 0, currency: "usd", status: "paid", createdAt: at(-39), dueAt: at(-32), overdue: false, payUrl: null, viewUrl: "#" },
      { id: "in_1", number: "UNI-0001", description: "Website build", amountDue: 200000, amountPaid: 200000, amountRemaining: 0, currency: "usd", status: "paid", createdAt: at(-70), dueAt: at(-63), overdue: false, payUrl: null, viewUrl: "#" },
    ],
    openTotal: 150000,
    overdueTotal: 150000,
    currency: "usd",
  };
}

export async function loadBilling(session: Session, opts: { preview?: boolean } = {}): Promise<BillingState> {
  const now = Date.now();
  const previewAllowed = opts.preview && process.env.NODE_ENV !== "production";
  if (session.isDemo || previewAllowed) return { kind: "ok", summary: sampleBilling(now), sample: true, testMode: false };
  if (!squareConfigured) return { kind: "off" };
  const customerId = session.client?.billingCustomerId;
  if (!customerId) return { kind: "unlinked" };
  try {
    return { kind: "ok", summary: await getBillingSummary(customerId, now), sample: false, testMode: squareSandbox };
  } catch (e) {
    console.error("[billing]", e);
    return { kind: "error", message: e instanceof Error ? e.message : "Square didn't respond." };
  }
}
