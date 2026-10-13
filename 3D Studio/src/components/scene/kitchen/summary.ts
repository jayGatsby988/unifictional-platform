/**
 * Human-readable facts about a KitchenSpec for the UI (pure, no three).
 * Everything is defensive: a half-built spec still produces sensible chips.
 */
import type { KitchenSpec } from '@/lib/spec/types';
import { resolveCabinetAbove, runForHood } from '@/lib/spec/hood';
import { fmtFt } from '@/lib/units';

const n = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const inches = (v: number) => `${Math.round(v)}"`;
const words = (s: string) => s.replace(/-/g, ' ');

const LAYOUT_LABEL: Record<string, string> = {
  'single-wall': 'Single-wall',
  galley: 'Galley',
  'l-shaped': 'L-shaped',
  'u-shaped': 'U-shaped',
  peninsula: 'Peninsula',
  'g-shaped': 'G-shaped',
};
const HOOD_LABEL: Record<string, string> = {
  chimney: 'chimney hood', 'under-cabinet': 'under-cabinet hood', 'custom-insert': 'custom hood', island: 'island hood',
};
const SPLASH_LABEL: Record<string, string> = {
  standard: '18" backsplash', 'full-height': 'full-height backsplash', ledge: '6" splash ledge',
};

export function kitchenSummary(spec: KitchenSpec | null | undefined): string[] {
  if (!spec || typeof spec !== 'object') return [];
  const out: string[] = [];
  const dims = spec.dims ?? ({} as KitchenSpec['dims']);
  const wFt = n(dims.widthFt, 14), dFt = n(dims.depthFt, 12), cFt = n(dims.ceilingFt, 9);
  out.push(`${fmtFt(wFt)} × ${fmtFt(dFt)}`);
  out.push(`${LAYOUT_LABEL[String(spec.layout)] ?? 'Kitchen'} layout`);

  const isl = spec.island;
  if (isl && isl.present) {
    const seats = Math.round(n(isl.seating, 0));
    const kind = typeof isl.kind === 'string' ? words(isl.kind) : 'island';
    out.push(`${fmtFt(n(isl.lengthFt, 6))} ${kind}${seats > 0 ? ` · ${seats} seat${seats > 1 ? 's' : ''}` : ''}`);
  }

  out.push(`${fmtFt(cFt)} ceilings`);

  const cab = spec.cabinets;
  if (cab && typeof cab.doorStyle === 'string') {
    const bits = [`${words(cab.doorStyle)} cabinets`];
    if (cab.twoTone) bits.push('two-tone');
    if (cab.crown) bits.push('crown');
    out.push(bits.join(' · '));
  }

  const apps = Array.isArray(spec.appliances) ? spec.appliances : [];
  const range = apps.find((a) => a && a.kind === 'range');
  if (range) out.push(`${inches(n(range.widthIn, 30))} range`);
  else {
    const cooktop = apps.find((a) => a && a.kind === 'cooktop');
    if (cooktop) out.push(`${inches(n(cooktop.widthIn, 30))} cooktop`);
  }
  const hood = apps.find((a) => a && a.kind === 'hood' && a.hoodStyle && a.hoodStyle !== 'none');
  if (hood && hood.hoodStyle) {
    const label = HOOD_LABEL[String(hood.hoodStyle)];
    // the cabinet on the canopy is the thing the client kept asking for — say
    // so on the chip, derived from the same pure rule the layout draws with
    if (label) {
      const hasRow = Array.isArray(spec.runs) ? runForHood(spec, hood) !== null : false;
      out.push(resolveCabinetAbove(hood, hasRow) !== 'none' ? `${label} · cabinet above` : label);
    }
  }
  const fridge = apps.find((a) => a && a.kind === 'fridge');
  if (fridge && fridge.fridgeStyle) out.push(`${words(String(fridge.fridgeStyle))} fridge`);

  const sink = spec.sink;
  if (sink && typeof sink.kind === 'string') out.push(`${inches(n(sink.widthIn, 33))} ${words(sink.kind)} sink`);

  const bs = spec.backsplash;
  if (bs && bs.present !== false) {
    const label = SPLASH_LABEL[String(bs.height)];
    if (label) out.push(label);
  }

  const l = spec.lighting;
  if (l) {
    const bits: string[] = [];
    const rc = Math.round(n(l.recessedCount, 0));
    if (rc > 0) bits.push(`${rc} recessed`);
    if (l.pendants && n(l.pendants.count, 0) > 0) {
      const pc = Math.round(n(l.pendants.count, 1));
      bits.push(`${pc} pendant${pc > 1 ? 's' : ''}`);
    }
    if (l.underCabinet) bits.push('under-cabinet LED');
    if (bits.length) out.push(bits.join(' · '));
  }

  const win = Array.isArray(spec.openings) ? spec.openings.filter((o) => o && o.kind === 'window').length : 0;
  if (win > 0) out.push(`${win} window${win > 1 ? 's' : ''}`);
  return out;
}
