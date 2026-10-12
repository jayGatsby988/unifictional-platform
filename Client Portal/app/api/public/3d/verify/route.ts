import { NextResponse } from "next/server";
import { orderPaid, squareConfigured } from "@/lib/billing/square";
import { platformAuthorized } from "@/lib/billing/platform";

/** The 3D studio asks whether the Square order behind an unlock checkout was paid. Body: { orderId }. */
export async function POST(request: Request) {
  if (!platformAuthorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!squareConfigured) return NextResponse.json({ error: "Square isn't configured" }, { status: 503 });
  const b = await request.json().catch(() => ({}));
  const orderId = String(b.orderId ?? "").trim();
  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, paid: await orderPaid(orderId) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Square error" }, { status: 502 });
  }
}
