/**
 * Pure helpers over Project / RoomSpec / selections used by several panels.
 */
import type { Estimate, MaterialSlotId, Photo, Project, RoomSpec, RoomType } from '@/lib/spec/types';
import { BATHROOM_SLOTS, EXTERIOR_SLOTS, FLOORPLAN_SLOTS, KITCHEN_SLOTS, SLOT_META, getMaterial } from '@/lib/materials/catalog';
import { isCustomMaterialId } from '@/lib/materials/match';
import { groupLines } from '@/lib/estimate/estimator';
import { scannedWorkScope } from '@/lib/estimate/scan-scope';
import { applicableSlots, kitchenHasTallUnits } from '@/lib/ai/prompt';
import { REGION_BY_ID } from '@/lib/estimate/pricebook';
import { fmtRange, fmtUSD } from '@/lib/units';
import { scanSlotFinish, scanSlotShowsDesign, type ScanFinishProject } from '@/lib/native/scan-finishes';
import { scannedObjectLayout } from '@/components/scene/scanned-object-layout';
import { scanPhotoFinishFor } from '@/lib/native/photo-finishes';
import { scannedObjectHasHardware } from '@/components/scene/scanned-object-profile';

export function primaryPhoto(project: Pick<Project, 'photos'>): Photo | null {
  if (!project.photos.length) return null;
  return project.photos.find((p) => p.primary) ?? project.photos[0];
}

export function slotsForRoom(roomType: RoomType): MaterialSlotId[] {
  if (roomType === 'kitchen') return KITCHEN_SLOTS;
  if (roomType === 'bathroom') return BATHROOM_SLOTS;
  if (roomType === 'floorplan') return FLOORPLAN_SLOTS;
  return EXTERIOR_SLOTS;
}

/** Slots that actually exist in the current spec (e.g. no island → no island slots). */
export function activeSlotsFor(spec: RoomSpec | null, roomType: RoomType, _hasObservedMesh = false): MaterialSlotId[] {
  // Legacy callers pass mesh availability; reconstructed slots are independent of it.
  void _hasObservedMesh;
  const all = slotsForRoom(roomType);
  if (!spec) return all;
  if ((spec.roomType === 'kitchen' || spec.roomType === 'bathroom') && spec.scanGeometry) {
    // Native imports deliberately leave procedural fixture flags empty. The
    // measured renderer still contains these cabinets and fixtures, so use
    // its same role classification to expose their material controls.
    const objects = scannedObjectLayout(spec.scanGeometry, spec.roomType).objects;
    const measuredTops = objects.filter(object => object.countertopSurfaces?.length && ['island', 'base-cabinet', 'table', 'other', 'dishwasher', 'tall-cabinet'].includes(object.role));
    const roles = new Set(objects.map(object => object.role));
    const shown = new Set<MaterialSlotId>();
    const hasPulls = objects.some(object => scannedObjectHasHardware(object));
    const hasBase = roles.has('base-cabinet'), hasUpper = roles.has('upper-cabinet'), hasTall = roles.has('tall-cabinet');
    const hasFloor = spec.scanGeometry.surfaces.some(surface => surface.kind === 'floor' && (surface.polygonCorners?.length ?? 0) >= 3);
    if (hasFloor) shown.add(spec.roomType === 'kitchen' ? 'flooring' : 'floor_tile');
    if (spec.scanGeometry.surfaces.some(surface => surface.kind === 'wall' && surface.dimensions.x > 0 && surface.dimensions.y > 0)) shown.add('walls');
    if (spec.scanGeometry.surfaces.some(surface => surface.kind === 'ceiling')) shown.add('ceiling');
    if ((spec.lighting.pendants?.count ?? 0) > 0 || spec.lighting.chandelier || spec.lighting.sconces > 0) shown.add('lighting_fixture');
    if (spec.roomType === 'kitchen') {
      const proposedBase = spec.runs.some(run => run.base.some(base => base.type !== 'appliance-gap'));
      const proposedUpper = spec.runs.some(run => run.hasUppers);
      const proposedTall = kitchenHasTallUnits(spec);
      if (hasBase || proposedBase) { shown.add('cabinets_base'); shown.add('countertop'); }
      if (measuredTops.some(object => object.role !== 'island')) shown.add('countertop');
      if (measuredTops.some(object => object.role === 'island')) shown.add('island_countertop');
      if (hasUpper || proposedUpper) shown.add('cabinets_upper');
      if (hasTall || proposedTall) shown.add('cabinets_tall');
      if (roles.has('island') || (spec.island.present)) { shown.add('island_cabinets'); shown.add('island_countertop'); }
      if (hasPulls || ((proposedBase || proposedUpper || proposedTall || spec.island.present) && spec.cabinets.hardware !== 'none')) shown.add('hardware');
      if (roles.has('refrigerator') || roles.has('oven') || roles.has('cooktop') || roles.has('dishwasher') || (spec.appliances.length > 0)) shown.add('appliances');
      if ((spec.sink.widthIn > 0 && (spec.runs.some(run => run.base.some(base => base.type === 'sink-base')) || (spec.island.present && spec.island.hasSink)))) shown.add('faucet');
      if (spec.backsplash.present && spec.runs.some(run => run.backsplash)) shown.add('backsplash');
    } else {
      if (hasBase || hasUpper || hasTall || (spec.vanity.present)) shown.add('vanity_cabinet');
      if (hasBase || spec.vanity.present || measuredTops.length) shown.add('vanity_top');
      if (hasPulls || spec.vanity.present || (spec.accessories?.length ?? 0) > 0) shown.add('hardware');
      if (roles.has('bathtub') || (spec.tub.present)) shown.add('tub');
      if (spec.vanity.present || spec.tub.present || spec.shower.present) shown.add('fixtures');
      if (spec.vanity.present && spec.vanity.mirror !== 'none') shown.add('mirror');
      if (spec.shower.present) { shown.add('shower_wall_tile'); shown.add('shower_floor_tile'); }
    }
    return all.filter(slot => shown.has(slot));
  }
  const hidden = new Set<MaterialSlotId>();
  if (spec.roomType === 'kitchen') {
    if (!spec.island.present) { hidden.add('island_cabinets'); hidden.add('island_countertop'); }
    if (!kitchenHasTallUnits(spec)) hidden.add('cabinets_tall');
    if (!spec.backsplash.present) hidden.add('backsplash');
    if (!spec.lighting.pendants && !spec.lighting.chandelier && spec.lighting.sconces === 0) hidden.add('lighting_fixture');
  } else if (spec.roomType === 'bathroom') {
    if (!spec.tub.present) hidden.add('tub');
    if (!spec.shower.present) { hidden.add('shower_wall_tile'); hidden.add('shower_floor_tile'); }
    if (!spec.vanity.present) { hidden.add('vanity_cabinet'); hidden.add('vanity_top'); hidden.add('mirror'); }
    if (spec.wallTile.height === 'none' || spec.wallTile.height === 'shower-only') hidden.add('wall_tile');
  } else if (spec.roomType === 'floorplan') {
    // the plan's own rule for which whole-house slots exist, so the rail and
    // the render prompt cannot disagree about what is swappable
    const shown = new Set(applicableSlots(spec));
    for (const s of all) if (!shown.has(s)) hidden.add(s);
  } else {
    if (!spec.house.garage.present || spec.house.garage.bays === 0) hidden.add('garage_door');
    if (!spec.house.deck.present) { hidden.add('deck'); if (!spec.house.porch.present) hidden.add('railing'); }
    if (!spec.house.porch.present) hidden.add('porch_columns');
    if (!spec.hardscape.driveway.present) hidden.add('driveway');
    if (!spec.hardscape.walkway.present) hidden.add('walkway');
    if (!spec.hardscape.patio.present) hidden.add('patio');
    if (!spec.lot.fence.present) hidden.add('fence');
    if (spec.house.foundationExposedFt <= 0) hidden.add('foundation');
  }
  return all.filter((s) => !hidden.has(s));
}

export function groupSlots(slots: MaterialSlotId[]): Array<{ group: string; slots: MaterialSlotId[] }> {
  const map = new Map<string, MaterialSlotId[]>();
  for (const s of slots) {
    const g = SLOT_META[s]?.group ?? 'Other';
    map.set(g, [...(map.get(g) ?? []), s]);
  }
  return [...map.entries()].map(([group, list]) => ({ group, slots: list }));
}

export function slotLabel(slot: string): string {
  return SLOT_META[slot as MaterialSlotId]?.label ?? slot.replace(/_/g, ' ');
}

export function scanFinishPresentation(project: ScanFinishProject, slot: string, mode: 'model' | 'source' = 'model') {
  const scanned = Boolean(project.spec && 'scanGeometry' in project.spec && project.spec.scanGeometry);
  if (scanned && mode === 'source') return { kind: 'source' as const, name: 'Original scan appearance' };
  if (scanned && !scanSlotShowsDesign(project, slot)) {
    const photo = scanPhotoFinishFor(project, slot);
    return photo ? { kind: 'estimated' as const, name: 'Reviewed photo match' } : { kind: 'estimated' as const, name: 'Estimated from scan' };
  }
  const finish = scanSlotFinish(project, slot);
  return finish.kind === 'catalog'
    ? { kind: 'catalog' as const, name: materialName(project.selections[slot]), materialId: project.selections[slot] }
    : { kind: 'estimated' as const, name: 'Estimated from scan' };
}

export function materialName(id?: string | null): string {
  if (!id) return 'Not set';
  // a photo-matched id whose definition has not been rebuilt yet is still a
  // real material, not a broken reference — never show the hash to a client
  return getMaterial(id)?.name ?? (isCustomMaterialId(id) ? 'Matched from photo' : id);
}

/** Slots whose selection differs between two selection maps. */
export function selectionsDiff(from: Record<string, string>, to: Record<string, string>): Array<{ slot: string; from?: string; to?: string }> {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  const out: Array<{ slot: string; from?: string; to?: string }> = [];
  for (const k of keys) if (from[k] !== to[k]) out.push({ slot: k, from: from[k], to: to[k] });
  return out;
}

/** "Base Cabinets: Hale Navy · Countertop: Calacatta Quartz" — favouring the most visible slots. */
export function selectionsSummary(sel: Record<string, string>, slots: MaterialSlotId[], max = 3): string {
  const preferred: MaterialSlotId[] = ['cabinets_base', 'countertop', 'backsplash', 'flooring', 'vanity_cabinet', 'floor_tile', 'shower_wall_tile', 'siding_primary', 'roof', 'front_door'];
  const ordered = [...preferred.filter((s) => slots.includes(s)), ...slots.filter((s) => !preferred.includes(s))];
  return ordered
    .filter((s) => sel[s])
    .slice(0, max)
    .map((s) => `${slotLabel(s)}: ${materialName(sel[s])}`)
    .join(' · ');
}

export function roomTypeLabel(roomType: RoomType): string {
  if (roomType === 'kitchen') return 'Kitchen';
  if (roomType === 'bathroom') return 'Bathroom';
  if (roomType === 'floorplan') return 'Floor Plan';
  return 'Lot & Exterior';
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const asFound = (project: Project) => (project.baseline ? new Date(project.baseline.capturedAt).toLocaleDateString() : null);
const modeLabel = (est: Estimate) => (est.mode === 'changes' ? 'Changes only' : 'Full remodel');

const CSV_COLUMNS = ['Category', 'Item', 'Slot', 'Scope', 'Qty', 'Baseline qty', 'Unit', 'Material low', 'Material high', 'Labor low', 'Labor high', 'Total low', 'Total high', 'Full low', 'Full high', 'Note'];
/** a fixed row (Subtotal, Total…) padded out to the line columns so the numbers land under Total low/high */
const totalsRow = (label: string, low: number, high?: number): Array<string | number> => {
  const row: Array<string | number> = [label];
  while (row.length < CSV_COLUMNS.length - 5) row.push('');
  row.push(low);
  if (high !== undefined) row.push(high);
  return row;
};

export function estimateToCSV(est: Estimate, project: Project): string {
  const settings = project.estimateSettings;
  const coverage = scannedWorkScope(project.spec, project.selections, settings, project.baseline);
  const incomplete = coverage.unpriced.length > 0;
  const rows: Array<Array<string | number>> = [];
  rows.push(['Project', project.name]);
  rows.push(['Room', roomTypeLabel(project.roomType)]);
  rows.push(['Region', REGION_BY_ID[settings.region]?.name ?? settings.region]);
  rows.push(['Scope', settings.scope]);
  rows.push(['Mode', modeLabel(est)]);
  rows.push(['As found', asFound(project) ?? 'none']);
  rows.push(['Generated', new Date().toISOString()]);
  if (incomplete) rows.push(['Estimate status', 'INCOMPLETE — priced subtotal only; unpriced scanned work excluded. Budget not verified.']);
  for (const item of coverage.unpriced) rows.push(['Unpriced scanned work', item.label, item.materialName, item.objectIds.length, 'captured objects', item.reason]);
  if (coverage.fullUnpriced.length) for (const item of coverage.fullUnpriced) rows.push(['Full-remodel exclusion', item.label, item.materialName, item.reason]);
  rows.push([]);
  rows.push(CSV_COLUMNS);
  for (const l of est.lines) {
    rows.push([
      l.category, l.label, l.slot ?? '', l.scope, l.qty, l.baselineQty ?? '', l.unit,
      l.materialLow, l.materialHigh, l.laborLow, l.laborHigh, l.totalLow, l.totalHigh,
      l.fullTotalLow, l.fullTotalHigh, [l.reason, l.note].filter(Boolean).join(' · '),
    ]);
  }
  rows.push([]);
  rows.push(totalsRow('Subtotal', est.subtotalLow, est.subtotalHigh));
  rows.push(totalsRow(`Contingency (${Math.round(settings.contingencyPct * 100)}%)`, est.contingencyLow, est.contingencyHigh));
  rows.push(totalsRow(`Overhead & profit (${Math.round(settings.markupPct * 100)}%)`, est.markupLow, est.markupHigh));
  // the sales tax was silently missing from the export while the panel showed it
  if (est.salesTaxPct > 0) rows.push(totalsRow(`Sales tax (${(est.salesTaxPct * 100).toFixed(2)}%)`, est.taxLow, est.taxHigh));
  rows.push(totalsRow(incomplete ? 'Priced subtotal including allowances/tax — excludes unpriced work' : 'Total', est.totalLow, est.totalHigh));
  rows.push(totalsRow('Midpoint', est.mid));
  rows.push(totalsRow('Timeline (weeks)', est.timelineWeeksLow, est.timelineWeeksHigh));
  if (est.mode === 'changes') {
    rows.push(totalsRow(coverage.fullUnpriced.length ? 'Partial full-remodel subtotal' : 'Full remodel total', est.full.totalLow, est.full.totalHigh));
    rows.push(totalsRow(coverage.fullUnpriced.length ? 'Partial full-remodel midpoint' : 'Full remodel midpoint', est.full.mid));
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export function estimateSummaryText(est: Estimate, project: Project): string {
  const settings = project.estimateSettings;
  const region = REGION_BY_ID[settings.region]?.name ?? settings.region;
  const changes = est.mode === 'changes';
  const coverage = scannedWorkScope(project.spec, project.selections, settings, project.baseline);
  const incomplete = coverage.unpriced.length > 0;
  const date = asFound(project);
  const groups = groupLines(est.lines).filter((g) => !changes || g.high > 0);
  const lines = [
    `${project.name} — ${roomTypeLabel(project.roomType)} remodel estimate`,
    `${incomplete ? 'INCOMPLETE — priced subtotal: ' : changes ? 'Your changes: ' : 'Range: '}${fmtRange(est.totalLow, est.totalHigh)} (midpoint ${fmtUSD(est.mid)})`,
    ...(changes ? [`${coverage.fullUnpriced.length ? 'Partial full-remodel subtotal' : 'Full remodel'}: ${fmtRange(est.full.totalLow, est.full.totalHigh)} (midpoint ${fmtUSD(est.full.mid)})`] : []),
    [
      ...(est.timelineWeeksHigh > 0 ? [`Timeline: ${est.timelineWeeksLow}–${est.timelineWeeksHigh} weeks`] : []),
      `Scope: ${settings.scope}`,
      `Region: ${region}`,
      ...(changes ? [`Mode: Changes only${date ? ` · as found ${date}` : ''}`] : []),
    ].join(' · '),
    '',
    ...groups.map((g) => `${g.category}: ${fmtRange(g.low, g.high)}`),
    ...(incomplete ? ['Budget unverified. Complete takeoff and contractor pricing for the excluded work:', ...coverage.unpriced.map(item => `UNPRICED: ${item.label} · ${item.materialName} (${item.objectIds.length} captured objects). ${item.reason}`)] : []),
    ...(coverage.fullUnpriced.length ? [`Full-remodel subtotal excludes: ${coverage.fullUnpriced.map(item => item.label).join(', ')}.`] : []),
    '',
    `Contingency ${Math.round(settings.contingencyPct * 100)}% · Overhead & profit ${Math.round(settings.markupPct * 100)}%`,
    changes && date
      ? `Prices only what differs from the room as found on ${date}. Preliminary budget from modeled quantities. Verify scope and measurements on site before contracting.`
      : 'Preliminary budget from modeled quantities. Verify scope and measurements on site before contracting.',
  ];
  return lines.join('\n');
}
