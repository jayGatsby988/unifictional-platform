/**
 * Human-readable facts about a BathroomSpec for the UI (pure, no three).
 */
import type { BathroomSpec } from '@/lib/spec/types';
import { fmtFt } from '@/lib/units';

const n = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const inches = (v: number) => `${Math.round(v)}"`;
const words = (s: string) => s.replace(/-/g, ' ');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const LAYOUT_LABEL: Record<string, string> = {
  powder: 'Powder room', full: 'Full bath', 'three-quarter': '¾ bath', primary: 'Primary bath', 'jack-and-jill': 'Jack-and-Jill bath',
};
const FIXTURE_LABEL: Record<string, string> = {
  single: 'wall shower head', rain: 'rain head', 'rain-plus-handheld': 'rain head + handheld', 'body-jets': 'body jets',
};
const TILE_LABEL: Record<string, string> = {
  none: 'Painted walls', wainscot: '42" tile wainscot', 'shower-only': 'Tile in the shower only', full: 'Floor-to-ceiling wall tile', 'accent-wall': 'Tiled vanity accent wall',
};

export function bathroomSummary(spec: BathroomSpec | null | undefined): string[] {
  if (!spec || typeof spec !== 'object') return [];
  const out: string[] = [];
  const dims = spec.dims ?? ({} as BathroomSpec['dims']);
  const wFt = n(dims.widthFt, 8), dFt = n(dims.depthFt, 8), cFt = n(dims.ceilingFt, 8);
  const layoutLabel = LAYOUT_LABEL[String(spec.layout)] ?? 'Bathroom';
  out.push(`${layoutLabel} · ${fmtFt(wFt)} × ${fmtFt(dFt)}${Math.abs(cFt - 8) > 0.05 ? ` · ${fmtFt(cFt)} ceiling` : ''}`);

  const v = spec.vanity;
  if (v && v.present) {
    const sinks = v.sinks === 2 ? 'double' : 'single';
    const style = typeof v.style === 'string' ? v.style : 'freestanding';
    const mirror = typeof v.mirror === 'string' && v.mirror !== 'none' ? ` · ${words(v.mirror)} mirror` : '';
    out.push(`${inches(n(v.widthIn, 36))} ${style} ${sinks} vanity${mirror}`);
  }

  const s = spec.shower;
  if (s && s.present) {
    const enc = typeof s.enclosure === 'string' ? s.enclosure : 'frameless-glass';
    if (enc === 'tub-shower') {
      out.push(`Tub-shower combo · ${FIXTURE_LABEL[String(s.fixtures)] ?? 'shower head'}`);
    } else {
      const bits = [`${inches(n(s.widthIn, 42))} × ${inches(n(s.depthIn, 36))}${s.curbless ? ' curbless' : ''} shower`, words(enc)];
      const f = FIXTURE_LABEL[String(s.fixtures)];
      if (f) bits.push(f);
      const extras = [s.niche ? 'niche' : null, s.bench ? 'bench' : null].filter(Boolean);
      if (extras.length) bits.push(extras.join(' + '));
      out.push(bits.join(' · '));
    }
  }

  const t = spec.tub;
  if (t && t.present && !(s && s.present && s.enclosure === 'tub-shower' && t.kind === 'alcove')) {
    out.push(`${inches(n(t.lengthIn, 60))} ${words(String(t.kind ?? 'alcove'))} tub`);
  }

  const toilet = spec.toilet;
  if (toilet && toilet.present) out.push(`${cap(words(String(toilet.style ?? 'one-piece')))} toilet`);

  const tile = TILE_LABEL[String(spec.wallTile?.height)];
  if (tile) out.push(tile);

  const l = spec.lighting;
  if (l) {
    const bits: string[] = [];
    const rc = Math.round(n(l.recessedCount, 0));
    if (rc > 0) bits.push(`${rc} recessed`);
    const sc = Math.round(n(l.sconces, 0));
    if (sc > 0) bits.push(`${sc} sconce${sc > 1 ? 's' : ''}`);
    if (l.pendants && n(l.pendants.count, 0) > 0) bits.push(`${Math.round(n(l.pendants.count, 1))} pendant${n(l.pendants.count, 1) > 1 ? 's' : ''}`);
    if (l.chandelier) bits.push('chandelier');
    if (bits.length) out.push(bits.join(' · '));
  }

  const win = Array.isArray(spec.openings) ? spec.openings.filter((o) => o && o.kind === 'window').length : 0;
  if (win > 0) out.push(`${win} window${win > 1 ? 's' : ''}`);

  const dc = spec.decor;
  if (dc && typeof dc === 'object') {
    const bits: string[] = [];
    const shelves = Array.isArray(dc.shelves) ? dc.shelves.length : 0;
    const plants = Array.isArray(dc.plants) ? dc.plants.length : 0;
    const art = Array.isArray(dc.art) ? dc.art.length : 0;
    if (shelves) bits.push(`${shelves} open shel${shelves > 1 ? 'ves' : 'f'}`);
    if (plants) bits.push(`${plants} plant${plants > 1 ? 's' : ''}`);
    if (art) bits.push(`${art} picture${art > 1 ? 's' : ''}`);
    if (dc.rug && dc.rug.present) bits.push(`${words(String(dc.rug.style ?? 'area'))} rug`);
    if (typeof dc.windowTreatment === 'string' && dc.windowTreatment !== 'none' && win > 0) bits.push(words(dc.windowTreatment) + (dc.windowTreatment.endsWith('s') ? '' : 's'));
    if (bits.length) out.push(bits.join(' · '));
  }
  return out;
}
