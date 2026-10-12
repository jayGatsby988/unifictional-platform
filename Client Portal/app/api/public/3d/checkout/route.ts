import { NextResponse } from "next/server";
import { createQuickPay, squareConfigured } from "@/lib/billing/square";
import { UNLOCK_CENTS, platformAuthorized } from "@/lib/billing/platform";

/**
 * Billing for the 3D remodel studio (a separate app) lives here so Square's
 * key stays in one place. The studio calls this with the shared PLATFORM_KEY
 * to start a one-off unlock checkout. Body: { returnUrl, reference }.
 */

export async function POST(request: Request) {
  if (!platformAuthorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!squareConfigured) return NextResponse.json({ error: "Square isn't configured" }, { status: 503 });
  const b = await request.json().catch(() => ({}));
  const returnUrl = String(b.returnUrl ?? "");
  if (!/^https?:\/\/\S+$/.test(returnUrl)) return NextResponse.json({ error: "returnUrl must be an absolute URL" }, { status: 400 });
  try {
    const r = await createQuickPay({ name: "3D remodel studio · unlimited scans, 30 days", amount: UNLOCK_CENTS, redirectUrl: returnUrl, note: `3D studio unlock ${String(b.reference ?? "")}`.trim() });
    return NextResponse.json({ ok: true, url: r.url, orderId: r.orderId, amount: UNLOCK_CENTS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Square error" }, { status: 502 });
  }
}
