/**
 * Human-readable facts about an ExteriorSpec for the UI (pure, no three).
 */
import type { ExteriorSpec } from '@/lib/spec/types';
import { fmtFt } from '@/lib/units';

const n = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const words = (s: unknown) => String(s ?? '').replace(/-/g, ' ');

const STYLE_LABEL: Record<string, string> = {
  craftsman: 'craftsman', 'modern-farmhouse': 'modern farmhouse', modern: 'modern', colonial: 'colonial',
  ranch: 'ranch', 'cape-cod': 'Cape Cod', contemporary: 'contemporary', mediterranean: 'Mediterranean',
  tudor: 'Tudor', victorian: 'Victorian', 'northwest-contemporary': 'NW contemporary',
};

export function exteriorSummary(spec: ExteriorSpec | null | undefined): string[] {
  if (!spec || typeof spec !== 'object') return [];
  const out: string[] = [];
  const lot = spec.lot ?? ({} as ExteriorSpec['lot']);
  const house = spec.house ?? ({} as ExteriorSpec['house']);
  const lotW = n(lot.widthFt, 80), lotD = n(lot.depthFt, 120);
  out.push(`${fmtFt(lotW)} × ${fmtFt(lotD)} lot`);

  const present = house.present !== false;
  if (!present) {
    out.push('Empty lot · template house');
  } else {
    const stories = Math.round(n(house.stories, 2));
    const label = STYLE_LABEL[String(spec.houseStyle)] || words(spec.houseStyle) || 'house';
    out.push(`${stories}-story ${label}`);
    const fp = house.footprint ?? ({} as ExteriorSpec['house']['footprint']);
    const sqft = Math.round((n(fp.widthFt, 40) * n(fp.depthFt, 30) * Math.max(1, stories)) / 10) * 10;
    if (sqft > 0) out.push(`~${sqft.toLocaleString('en-US')} sq ft`);
  }

  const roof = house.roof ?? ({} as ExteriorSpec['house']['roof']);
  if (present) {
    const pitch = Math.round(n(roof.pitch, 8));
    out.push(`${words(roof.type ?? 'gable')} roof${pitch > 0 ? ` · ${pitch}/12` : ''}`);
  }

  const g = house.garage;
  if (present && g && g.present && n(g.bays, 0) > 0) {
    out.push(`${Math.round(n(g.bays, 2))}-car ${g.attached === false ? 'detached ' : ''}garage`);
  }

  const p = house.porch;
  if (present && p && p.present) out.push(p.roofed === false ? 'front stoop' : 'covered porch');
  const d = house.deck;
  if (present && d && d.present) out.push(`${fmtFt(n(d.widthFt, 16))} × ${fmtFt(n(d.depthFt, 12))} deck`);

  const hs = spec.hardscape ?? ({} as ExteriorSpec['hardscape']);
  const extras: string[] = [];
  if (hs.driveway?.present) extras.push(`${words(hs.driveway.side ?? 'left')} driveway`);
  if (hs.patio?.present) extras.push('patio');
  if (hs.pool?.present) extras.push('pool');
  if (lot.fence?.present) extras.push(`${fmtFt(n(lot.fence.heightFt, 6))} fence`);
  const trees = Math.round(n(lot.treesCount, 0));
  if (trees > 0) extras.push(`${trees} tree${trees > 1 ? 's' : ''}`);
  if (extras.length) out.push(extras.join(' · '));

  return out;
}
