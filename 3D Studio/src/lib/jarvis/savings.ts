import { recordScanEstimateChoices } from '@/lib/estimate/scan-finish-intent';
import { calculateEstimate } from '@/lib/estimate/estimator';
import { CATALOG_BY_ID, materialsForSlot, type MaterialDef } from '@/lib/materials/catalog';
import type { Estimate, MaterialSlotId } from '@/lib/spec/types';
import { budgetFor, validateDesign } from './validation';
import type { DesignSnapshot, JarvisConstraints } from './types';

export function estimateSnapshot(snapshot: DesignSnapshot): Estimate {
  return calculateEstimate(snapshot.spec, snapshot.selections, snapshot.estimateSettings, snapshot.baseline);
}
/** Rounded line components and explicit rounding remainder reconcile exactly. */
export function compareEstimates(before: Estimate, after: Estimate) {
  const amounts = (e: Estimate, bound: 'Low' | 'High') => ({ material: e.lines.reduce((n, l) => n + l[`material${bound}`], 0), labor: e.lines.reduce((n, l) => n + l[`labor${bound}`], 0), contingency: e[`contingency${bound}`], markup: e[`markup${bound}`], tax: e[`tax${bound}`], total: e[`total${bound}`] });
  const delta = (bound: 'Low' | 'High') => {
    const a = amounts(before, bound), b = amounts(after, bound);
    const d = { material: b.material - a.material, labor: b.labor - a.labor, contingency: b.contingency - a.contingency, markup: b.markup - a.markup, tax: b.tax - a.tax, rounding: 0, total: b.total - a.total };
    d.rounding = d.total - d.material - d.labor - d.contingency - d.markup - d.tax;
    return d;
  };
  const ids = [...new Set([...before.lines, ...after.lines].map((l) => l.id))];
  return { ...((before.unpriced?.length || after.unpriced?.length) ? { complete: false, note: 'Comparison covers priced work only; unpriced scanned work is excluded, so this is not the full project cost difference.', unpricedBefore: before.unpriced ?? [], unpricedAfter: after.unpriced ?? [] } : {}), low: delta('Low'), high: delta('High'), quantities: Object.fromEntries([...new Set([...Object.keys(before.quantities), ...Object.keys(after.quantities)])].map((k) => [k, (after.quantities[k] ?? 0) - (before.quantities[k] ?? 0)])), lines: ids.map((id) => {
    const a = before.lines.find((l) => l.id === id), b = after.lines.find((l) => l.id === id);
    return { id, label: b?.label ?? a?.label, quantityBefore: a?.qty ?? 0, quantityAfter: b?.qty ?? 0, materialLow: (b?.materialLow ?? 0) - (a?.materialLow ?? 0), materialHigh: (b?.materialHigh ?? 0) - (a?.materialHigh ?? 0), laborLow: (b?.laborLow ?? 0) - (a?.laborLow ?? 0), laborHigh: (b?.laborHigh ?? 0) - (a?.laborHigh ?? 0), totalLow: (b?.totalLow ?? 0) - (a?.totalLow ?? 0), totalHigh: (b?.totalHigh ?? 0) - (a?.totalHigh ?? 0) };
  }).filter((l) => l.totalLow || l.totalHigh || l.quantityBefore !== l.quantityAfter) };
}
function rgb(material: MaterialDef): number[] | null {
  const color = material.pbr.color;
  if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) return null;
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
}
export function materialSimilarity(a: MaterialDef, b: MaterialDef): number {
  const ac = rgb(a), bc = rgb(b);
  const color = ac && bc ? 1 - Math.hypot(...ac.map((n, i) => n - bc[i])) / Math.sqrt(3) : 0.5;
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2));
  const aa = tokens(`${a.name} ${a.prompt}`), bb = tokens(`${b.name} ${b.prompt}`);
  const text = [...aa].filter((s) => bb.has(s)).length / Math.max(1, new Set([...aa, ...bb]).size);
  return (a.group === b.group ? 0.3 : 0) + (a.category === b.category ? 0.25 : 0) + color * 0.3 + text * 0.15;
}
/** Catalog-only, bounded greedy search. No geometry, scope or reserve cuts. */
export function findSavings(snapshot: DesignSnapshot, constraints: JarvisConstraints, limit = 6, targetSavings: number | null = null) {
  const original = structuredClone(snapshot), before = estimateSnapshot(original);
  if (before.unpriced?.length) throw new Error(`Savings cannot be verified while scanned work is unpriced: ${before.unpriced.map(item => item.label).join(', ')}. Complete its takeoff and pricing first.`);
  let best = structuredClone(snapshot), current = before;
  const recommendations: Array<{ slot: string; from: string; to: string; similarity: number; savingsHigh: number }> = [];
  let evaluated = 0;
  for (let step = 0; step < Math.min(6, limit); step++) {
    let winner: { snapshot: DesignSnapshot; estimate: Estimate; slot: string; from: string; to: string; similarity: number; savingsHigh: number } | null = null;
    for (const slot of Object.keys(best.spec.materials).sort()) {
      if (constraints.lockedSlots.includes(slot) || (constraints.keepAppliances && slot === 'appliances')) continue;
      const source = CATALOG_BY_ID[best.selections[slot]];
      if (!source) continue;
      const candidates = materialsForSlot(slot as MaterialSlotId).filter((m) => m.id !== source.id && m.group === source.group).map((m) => ({ m, similarity: materialSimilarity(source, m) })).sort((a, b) => b.similarity - a.similarity || a.m.id.localeCompare(b.m.id)).slice(0, 8);
      for (const { m, similarity } of candidates) {
        if (++evaluated > 240) break;
        const candidate = structuredClone(best); candidate.selections[slot] = m.id;
        candidate.estimateSettings = recordScanEstimateChoices(candidate.spec, candidate.estimateSettings, candidate.selections, [slot]);
        const estimate = estimateSnapshot(candidate), saving = current.totalHigh - estimate.totalHigh;
        if (estimate.unpriced?.length) continue;
        if (saving > 0 && (!winner || saving * (0.4 + similarity) > winner.savingsHigh * (0.4 + winner.similarity))) winner = { snapshot: candidate, estimate, slot, from: source.id, to: m.id, similarity, savingsHigh: saving };
      }
      if (evaluated > 240) break;
    }
    if (!winner) break;
    best = winner.snapshot; current = winner.estimate;
    recommendations.push({ slot: winner.slot, from: winner.from, to: winner.to, similarity: Math.round(winner.similarity * 1000) / 1000, savingsHigh: winner.savingsHigh });
    if ((constraints.budgetMax === null || current.totalHigh <= constraints.budgetMax) && targetSavings !== null && before.totalHigh - current.totalHigh >= targetSavings) break;
    if (evaluated > 240) break;
  }
  const validation = validateDesign(best, constraints), budget = budgetFor(current, constraints);
  return { snapshot: best, estimate: current, validation, budget, recommendations, targetSavings, remainingSavings: targetSavings === null ? 0 : Math.max(0, targetSavings - (before.totalHigh - current.totalHigh)), evaluated: Math.min(evaluated, 240), savingsHigh: before.totalHigh - current.totalHigh, shortfallHigh: constraints.budgetMax === null ? 0 : Math.max(0, current.totalHigh - constraints.budgetMax), comparison: compareEstimates(before, current), note: 'Bounded catalog search, not a guarantee of the cheapest available design. Similarity is a deterministic color/category/text score; confirm the sample visually. Dimensions, labor rates, contingency, markup and scope were preserved.' };
}
