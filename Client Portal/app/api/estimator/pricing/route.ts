import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/data/repo";
import type { PricingConfig } from "@/lib/data/types";

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, max = 200) => String(v ?? "").slice(0, max);

/** Validate the contractor's pricing config before it is stored. */
function clean(input: Partial<PricingConfig>): PricingConfig {
  const projectTypes = (Array.isArray(input.projectTypes) ? input.projectTypes : []).slice(0, 40).map((p) => ({
    id: str(p.id, 40) || crypto.randomUUID(),
    name: str(p.name, 80),
    unit: (["sqft", "lf", "each"] as const).includes(p.unit) ? p.unit : "sqft",
    baseRate: Math.max(0, num(p.baseRate)),
    minPrice: Math.max(0, num(p.minPrice)),
    enabled: Boolean(p.enabled),
  })).filter((p) => p.name);
  const ids = new Set(projectTypes.map((p) => p.id));
  const options = (Array.isArray(input.options) ? input.options : []).slice(0, 80).map((o) => ({
    id: str(o.id, 40) || crypto.randomUUID(),
    name: str(o.name, 80),
    appliesTo: (Array.isArray(o.appliesTo) ? o.appliesTo : []).map((x) => str(x, 40)).filter((x) => ids.has(x)),
    priceType: (["flat", "per_unit", "percent"] as const).includes(o.priceType) ? o.priceType : "flat",
    amount: Math.max(0, num(o.amount)),
    enabled: Boolean(o.enabled),
  })).filter((o) => o.name);
  return {
    projectTypes,
    options,
    markupPct: Math.min(100, Math.max(0, num(input.markupPct))),
    rangePct: Math.min(50, Math.max(0, num(input.rangePct, 8))),
    depositPct: Math.min(100, Math.max(0, num(input.depositPct, 10))),
    disclaimer: str(input.disclaimer, 500),
    updatedAt: new Date().toISOString(),
  };
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const config = clean(body);
  if (demoMode) return NextResponse.json({ ok: true, demo: true, config });

  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const supabase = await createClient();
  const { error } = await supabase.from("estimator_settings")
    .upsert({ client_id: session.client.id, config, updated_at: config.updatedAt }, { onConflict: "client_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from("activity").insert({ client_id: session.client.id, area: "estimator", title: "Quote tool pricing updated" });
  return NextResponse.json({ ok: true, config });
}
