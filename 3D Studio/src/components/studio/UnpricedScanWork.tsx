import type { UnpricedScanWork as Work } from '@/lib/spec/types';

export function UnpricedScanWork({ items, comparisonOnly = false }: { items: Work[]; comparisonOnly?: boolean }) {
  if (!items.length) return null;
  return <div role="note" aria-label="Unpriced scanned work" className="my-3 rounded-lg border border-brass/30 bg-brass/5 p-3 text-xs leading-relaxed">
    <p className="font-medium">{comparisonOnly ? 'Full-remodel comparison excludes scanned fixtures' : 'Pricing incomplete · scanned work is unpriced'}</p>
    <p className="mt-1 text-muted">{comparisonOnly ? 'These unchanged items have no construction quantities in the full-remodel comparison.' : 'The displayed subtotal excludes the following work. It is not a complete quote or a confirmed budget.'} Partial LiDAR patches do not establish a complete slab, cutout, cabinet quantity or installation labor.</p>
    <ul className="mt-2 list-disc space-y-1 pl-4">{items.map(item => <li key={`${item.slot}:${item.label}:${item.objectIds.join(',')}`}><span className="font-medium">{item.label} · {item.materialName}</span><span className="text-muted"> — {item.objectIds.length} captured object{item.objectIds.length === 1 ? '' : 's'}; takeoff and contractor pricing required.</span></li>)}</ul>
  </div>;
}
