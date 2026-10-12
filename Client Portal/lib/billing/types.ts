export type BillingCard = { brand: string; last4: string; expMonth: number; expYear: number };

export type BillingPlan = {
  id: string;
  name: string;
  amount: number;        // cents per interval
  currency: string;
  interval: string;      // "month" | "year" | ...
  status: string;        // Square subscription status
  nextChargeAt: string | null;
  cancelAt: string | null;
  /** True when Square charges a saved card automatically each period (no invoice emails). */
  autopay: boolean;
};

export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

export type BillingInvoice = {
  id: string;
  number: string | null;
  description: string;
  amountDue: number;     // cents
  amountPaid: number;
  amountRemaining: number;
  currency: string;
  status: InvoiceStatus;
  createdAt: string;
  dueAt: string | null;
  overdue: boolean;
  payUrl: string | null;
  viewUrl: string | null;  // Square-hosted invoice page (printable receipt once paid)
};

export type BillingSummary = {
  email: string | null;
  card: BillingCard | null;
  plans: BillingPlan[];
  invoices: BillingInvoice[];
  openTotal: number;
  overdueTotal: number;
  currency: string;
};

/** Per-company numbers for the studio billing table. */
export type StudioBillingRow = { monthly: number; open: number; overdue: number; openCount: number; plans: number; autopay: number };

export function money(cents: number, currency = "usd"): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}

/** Dollars typed by a person ("1,500", "$2000.50") to cents. Returns null when it isn't a positive amount. */
export function toCents(input: string): number | null {
  const n = Number(String(input).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.round(n * 100);
}
