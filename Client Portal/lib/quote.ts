import type { PricingConfig } from "@/lib/data/types";

/** The same math the embedded estimator runs, so the admin preview matches the site. */
export function quote(config: PricingConfig, projectTypeId: string, size: number, optionIds: string[]) {
  const pt = config.projectTypes.find((p) => p.id === projectTypeId);
  if (!pt) return null;
  const base = size * pt.baseRate;
  let flat = 0, perUnit = 0, pct = 0;
  const lines: { name: string; amount: number }[] = [{ name: `${pt.name} · ${size.toLocaleString()} ${pt.unit} × $${pt.baseRate}`, amount: base }];
  for (const id of optionIds) {
    const o = config.options.find((x) => x.id === id && x.enabled);
    if (!o) continue;
    if (o.appliesTo.length && !o.appliesTo.includes(pt.id)) continue;
    let amt = 0;
    if (o.priceType === "flat") { flat += o.amount; amt = o.amount; }
    if (o.priceType === "per_unit") { perUnit += o.amount * size; amt = o.amount * size; }
    if (o.priceType === "percent") { pct += o.amount; amt = (base * o.amount) / 100; }
    lines.push({ name: o.name, amount: amt });
  }
  let subtotal = base + flat + perUnit + (base * pct) / 100;
  subtotal = Math.max(subtotal, pt.minPrice);
  const total = Math.round(subtotal * (1 + config.markupPct / 100));
  const low = Math.round((total * (1 - config.rangePct / 100)) / 500) * 500;
  const high = Math.round((total * (1 + config.rangePct / 100)) / 500) * 500;
  return { lines, subtotal, total, low, high, deposit: Math.round((total * config.depositPct) / 100) };
}
