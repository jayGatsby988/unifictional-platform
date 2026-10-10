import { test } from "node:test";
import assert from "node:assert/strict";
import { mapCard, mapInvoice, mapPlan, summarize } from "../lib/billing/map.ts";
import { money, toCents } from "../lib/billing/types.ts";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const inv = (o = {}, req = {}) => ({
  id: "inv_x", invoice_number: "000007", title: "SEO & website care", status: "UNPAID", public_url: "https://squareup.com/pay-invoice/x",
  created_at: "2026-10-01T00:00:00Z",
  payment_requests: [{ due_date: "2026-10-08", computed_amount_money: { amount: 150000, currency: "USD" }, total_completed_amount_money: { amount: 0, currency: "USD" }, ...req }],
  ...o,
});

test("money and toCents", () => {
  assert.equal(money(150000), "$1,500");
  assert.equal(money(199), "$1.99");
  assert.equal(toCents("$1,500"), 150000);
  assert.equal(toCents("2000.5"), 200050);
  assert.equal(toCents("0"), null);
  assert.equal(toCents("abc"), null);
});

test("unpaid invoice past its due date is overdue and payable", () => {
  const m = mapInvoice(inv(), NOW);
  assert.equal(m.status, "open");
  assert.equal(m.overdue, true);
  assert.equal(m.amountRemaining, 150000);
  assert.equal(m.payUrl, "https://squareup.com/pay-invoice/x");
});

test("due today is not overdue; partial payment leaves the remainder", () => {
  const m = mapInvoice(inv({ status: "PARTIALLY_PAID" }, { due_date: "2026-10-09", total_completed_amount_money: { amount: 50000 } }), NOW);
  assert.equal(m.overdue, false);
  assert.equal(m.amountRemaining, 100000);
});

test("paid invoice keeps a receipt link but no pay link; drafts are hidden; canceled is void", () => {
  const m = mapInvoice(inv({ status: "PAID" }, { total_completed_amount_money: { amount: 150000 } }), NOW);
  assert.equal(m.status, "paid");
  assert.equal(m.payUrl, null);
  assert.equal(m.viewUrl, "https://squareup.com/pay-invoice/x");
  assert.equal(mapInvoice(inv({ status: "DRAFT" }), NOW), null);
  assert.equal(mapInvoice(inv({ status: "CANCELED" }), NOW).status, "void");
});

test("plan reads name, monthly price and next charge from the catalog variation", () => {
  const variations = { var_1: { id: "var_1", subscription_plan_variation_data: { name: "SEO & website care · $1,500/mo", phases: [{ cadence: "MONTHLY", pricing: { type: "STATIC", price: { amount: 150000, currency: "USD" } } }] } } };
  const p = mapPlan({ id: "sub_1", status: "ACTIVE", plan_variation_id: "var_1", start_date: "2026-09-21", charged_through_date: "2026-10-21" }, variations);
  assert.equal(p.amount, 150000);
  assert.equal(p.interval, "month");
  assert.equal(p.nextChargeAt, "2026-10-21T12:00:00.000Z");
  assert.equal(p.name, "SEO & website care · $1,500/mo");
});

test("card mapping skips disabled cards", () => {
  assert.deepEqual(mapCard({ card_brand: "VISA", last_4: "4242", exp_month: 8, exp_year: 2028 }), { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 });
  assert.equal(mapCard({ card_brand: "VISA", last_4: "4242", enabled: false }), null);
});

test("summary totals open and overdue, ignores canceled plans", () => {
  const s = summarize({ email: "a@b.co", card: null, nowMs: NOW, variations: {},
    subs: [{ id: "s", status: "CANCELED" }],
    invoices: [inv({ id: "a" }), inv({ id: "b" }, { due_date: "2026-10-20", computed_amount_money: { amount: 50000 } }), inv({ id: "c", status: "PAID" }, { total_completed_amount_money: { amount: 150000 } })] });
  assert.equal(s.openTotal, 200000);
  assert.equal(s.overdueTotal, 150000);
  assert.equal(s.plans.length, 0);
  assert.equal(s.invoices.length, 3);
});
