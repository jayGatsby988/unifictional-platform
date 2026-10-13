import type { Estimate, EstimateSettings, MaterialSlotId, ProjectBaseline, RoomSpec, UnpricedScanWork } from '@/lib/spec/types';
import { CATALOG_BY_ID, DEFAULT_SELECTIONS, SLOT_META } from '@/lib/materials/catalog';
import { scanReplacementSlots } from './scan-finish-intent';
import { scannedRoomQuantities } from '@/lib/native/scan-geometry';
import { validScanTakeoffs, scanObjectIsHidden, compileScanDesign, validScanWorkAllowances } from '@/lib/native/scan-design';
import { scannedObjectLayout } from '@/components/scene/scanned-object-layout';

/** Coverage is separate from money: zero priced work must never mean a free remodel. */
export function scannedWorkScope(spec: RoomSpec | null, selections: Record<string, string>, settings: EstimateSettings, baseline?: ProjectBaseline | null) {
  const fullUnpriced: UnpricedScanWork[] = [];
  if (!spec || (spec.roomType !== 'kitchen' && spec.roomType !== 'bathroom') || !spec.scanGeometry) return { unpriced: fullUnpriced, fullUnpriced };
  const bySlot = new Map<MaterialSlotId, string[]>();
  const add = (slot: MaterialSlotId, objectId: string) => {
    const ids = bySlot.get(slot) ?? [];
    if (!ids.includes(objectId)) ids.push(objectId);
    bySlot.set(slot, ids);
  };
  for (const object of scannedObjectLayout(spec.scanGeometry, spec.roomType).objects) {
    const { role, id } = object;
    if (scanObjectIsHidden(spec, id)) continue;
    if (object.countertopSurfaces?.length && ['island', 'base-cabinet', 'table', 'other', 'dishwasher', 'tall-cabinet'].includes(role)) {
      add(spec.roomType === 'bathroom' ? 'vanity_top' : role === 'island' ? 'island_countertop' : 'countertop', id);
    }
    if (['base-cabinet', 'upper-cabinet', 'tall-cabinet', 'island'].includes(role)) {
      add(spec.roomType === 'bathroom' ? 'vanity_cabinet' : role === 'island' ? 'island_cabinets' : role === 'upper-cabinet' ? 'cabinets_upper' : role === 'tall-cabinet' ? 'cabinets_tall' : 'cabinets_base', id);
      add('hardware', id);
      if (role === 'base-cabinet' || role === 'island') add(spec.roomType === 'bathroom' ? 'vanity_top' : role === 'island' ? 'island_countertop' : 'countertop', id);
    }
    if (spec.roomType === 'kitchen') {
      if (['refrigerator', 'oven', 'cooktop', 'dishwasher'].includes(role) && !settings.keepExistingAppliances) add('appliances', id);
      if (role === 'sink') add('faucet', id);
    } else {
      if (role === 'bathtub') add('tub', id);
      if (['sink', 'bathtub', 'toilet'].includes(role)) add('fixtures', id);
      if (role === 'sink') add('vanity_top', id);
    }
  }
  const measured = scannedRoomQuantities(spec.scanGeometry);
  if (!measured.floorAreaSquareMeters) {
    add(spec.roomType === 'bathroom' ? 'floor_tile' : 'flooring', 'room-floor');
    add('ceiling', 'room-ceiling');
  }
  if (!measured.netWallAreaSquareMeters || measured.incompleteWallCoverage) add('walls', 'room-walls');
  const replacements = scanReplacementSlots(spec, settings, selections);
  // Explicitly selected slots with no measured takeoff must also be visible
  // as excluded work, even when RoomPlan could not classify their fixtures.
  for (const slot of replacements) if (!bySlot.has(slot as MaterialSlotId) && !['flooring', 'floor_tile', 'walls', 'ceiling'].includes(slot)) add(slot as MaterialSlotId, 'unmeasured-scan-surface');
  const selected = (values: Record<string, string>, slot: string) => CATALOG_BY_ID[values[slot]]?.id ?? values[slot] ?? DEFAULT_SELECTIONS[spec.roomType]?.[slot];
  const takeoffs = validScanTakeoffs(spec);
  for (const [slot, candidates] of bySlot) {
    const covered = new Set(takeoffs.filter(item => item.slot === slot).flatMap(item => item.objectIds));
    const objectIds = candidates.filter(id => !covered.has(id));
    if (!objectIds.length) continue;
    const materialId = selected(selections, slot);
    const chosen = replacements.has(slot) || (baseline && selected(selections, slot) !== selected(baseline.selections, slot));
    fullUnpriced.push({ slot, label: SLOT_META[slot].label, materialId: materialId ?? '', materialName: chosen ? (materialId ? CATALOG_BY_ID[materialId]?.name : undefined) ?? 'Selected finish' : 'Finish specification unverified', objectIds,
      reason: 'Scanned bounds and partial surface coverage do not establish the complete construction quantity or installation labor. A measured takeoff and contractor pricing are required; this work is excluded from the priced subtotal.' });
  }
  // Moving/removing a captured fixture has costs independent of its finish.
  // Measured quantities cannot silently stand in for relocation or demolition.
  const layoutWork: UnpricedScanWork[] = compileScanDesign(spec).filter(item => item.modified && !validScanWorkAllowances(spec).some(allowance => allowance.objectId === item.id)).map(item => {
    const slot = item.slots[0] ?? (spec.roomType === 'bathroom' ? 'fixtures' : 'cabinets_base');
    return { slot, label: `${item.label} · ${item.edit.hidden ? 'removal' : 'layout change'}`, materialId: selections[slot] ?? '', materialName: 'Contractor labor allowance needed', objectIds: [item.id], reason: 'This proposed layout changes an existing fixture. Enter a contractor-reviewed modification or relocation allowance; unmeasured connections and fabrication are not priced automatically.' };
  });
  fullUnpriced.push(...layoutWork);
  const changes = settings.mode !== 'full'  && baseline?.spec.roomType === spec.roomType;
  const unpriced = changes ? fullUnpriced.filter(item => layoutWork.includes(item) || replacements.has(item.slot) || selected(selections, item.slot) !== selected(baseline.selections, item.slot)) : fullUnpriced;
  return { unpriced, fullUnpriced };
}

export function estimateHasUnpricedWork(estimate: Pick<Estimate, 'unpriced'>): boolean {
  return (estimate.unpriced?.length ?? 0) > 0;
}
