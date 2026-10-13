import { Matrix4, Vector3 } from 'three';
import type { ScanDesign, ScanObjectEdit, ScanTakeoff, ScannedElement, SingleRoomSpec, MaterialSlotId } from '@/lib/spec/types';
import { ScanObjectEditZ, ScanTakeoffZ, ScanWorkAllowanceZ } from '@/lib/spec/schema';
import { scannedObjectFeatures } from '@/components/scene/scanned-object-features';
import { scannedObjectLayout, type ScannedObjectRole } from '@/components/scene/scanned-object-layout';
import { scanProposalClearanceIssues, type ScanClearanceIssue } from './scan-proposal-clearance';

export const IDENTITY_SCAN_EDIT: Readonly<ScanObjectEdit> = Object.freeze({ offsetXMeters: 0, offsetZMeters: 0, rotationDegrees: 0, scaleX: 1, scaleZ: 1, hidden: false });
export const emptyScanDesign = (): ScanDesign => ({ version: 1, objects: {}, takeoffs: [] });
export function scanObjectEdit(spec: SingleRoomSpec, id: string): ScanObjectEdit {
  const edits = spec.scanDesign?.objects;
  return edits && Object.hasOwn(edits, id) ? edits[id] : { ...IDENTITY_SCAN_EDIT };
}
/** Delta on already reconstructed WORLD geometry. Scale in captured local X/Z,
 * rotate about the captured center, then translate in studio-world coordinates.
 * Existing curves, holes and countertop levels all share this same delta. */
export function scanObjectDesignMatrix(element: ScannedElement, edit: ScanObjectEdit = { ...IDENTITY_SCAN_EDIT }): number[] {
  if (scanEditIsIdentity(edit) || (edit.hidden && !edit.offsetXMeters && !edit.offsetZMeters && !edit.rotationDegrees && edit.scaleX === 1 && edit.scaleZ === 1)) return new Matrix4().toArray();
  const source = new Matrix4().fromArray(element.transform);
  const center = new Vector3().setFromMatrixPosition(source);
  // Horizontal design scaling preserves measured countertop elevations even
  // when RoomPlan bounding axes contain slight pitch/roll from capture noise.
  const rotation = new Matrix4().makeRotationY(Math.atan2(-element.transform[2], element.transform[0]));
  return new Matrix4().makeTranslation(center.x + edit.offsetXMeters, center.y, center.z + edit.offsetZMeters)
    .multiply(new Matrix4().makeRotationY(edit.rotationDegrees * Math.PI / 180))
    .multiply(rotation).multiply(new Matrix4().makeScale(edit.scaleX, 1, edit.scaleZ))
    .multiply(rotation.clone().invert()).multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z)).toArray();
}
/** Stable bounded parent walk. Bad cycles produce identity instead of doubling
 * transforms. A valid root edit moves every contained object as one assembly. */
export function effectiveScanObjectDesignMatrix(spec: SingleRoomSpec, id: string): number[] {
  const objects = new Map(spec.scanGeometry?.objects.map(object => [object.id, object]) ?? []);
  const seen = new Set<string>(); const lineage: ScannedElement[] = [];
  let cursor = objects.get(id);
  while (cursor && !seen.has(cursor.id) && lineage.length < 512) {
    seen.add(cursor.id); lineage.push(cursor); cursor = cursor.parentIdentifier ? objects.get(cursor.parentIdentifier) : undefined;
  }
  if (cursor) return new Matrix4().toArray();
  const delta = new Matrix4();
  for (const object of lineage.reverse()) delta.multiply(new Matrix4().fromArray(scanObjectDesignMatrix(object, scanObjectEdit(spec, object.id))));
  return delta.toArray();
}
export function scanAssemblyIds(spec: SingleRoomSpec, id: string): Set<string> {
  const ids = new Set([id]);
  for (let i = 0; i < 512; i++) {
    let found = false;
    for (const object of spec.scanGeometry?.objects ?? []) if (object.parentIdentifier && ids.has(object.parentIdentifier) && !ids.has(object.id)) { ids.add(object.id); found = true; }
    if (!found) break;
  }
  return ids;
}
export function scanObjectIsHidden(spec: SingleRoomSpec, id: string): boolean {
  const byId = new Map(spec.scanGeometry?.objects.map(object => [object.id, object]) ?? []), seen = new Set<string>();
  let cursor = byId.get(id);
  while (cursor && !seen.has(cursor.id)) { if (scanObjectEdit(spec, cursor.id).hidden) return true; seen.add(cursor.id); cursor = cursor.parentIdentifier ? byId.get(cursor.parentIdentifier) : undefined; }
  return false;
}
export function scanEditIsIdentity(edit: ScanObjectEdit): boolean {
  return !edit.hidden && Math.abs(edit.offsetXMeters) < 1e-9 && Math.abs(edit.offsetZMeters) < 1e-9 && Math.abs(edit.rotationDegrees) < 1e-9 && Math.abs(edit.scaleX - 1) < 1e-9 && Math.abs(edit.scaleZ - 1) < 1e-9;
}
const applianceRoles = new Set<ScannedObjectRole>(['refrigerator', 'oven', 'cooktop', 'dishwasher']);
export function scanObjectSlots(role: ScannedObjectRole, roomType: 'kitchen' | 'bathroom'): MaterialSlotId[] {
  if (['base-cabinet', 'upper-cabinet', 'tall-cabinet', 'island'].includes(role)) {
    const cabinet: MaterialSlotId = roomType === 'bathroom' ? 'vanity_cabinet' : role === 'island' ? 'island_cabinets' : role === 'upper-cabinet' ? 'cabinets_upper' : role === 'tall-cabinet' ? 'cabinets_tall' : 'cabinets_base';
    return [cabinet, 'hardware', ...(['base-cabinet', 'island'].includes(role) ? [roomType === 'bathroom' ? 'vanity_top' : role === 'island' ? 'island_countertop' : 'countertop'] as MaterialSlotId[] : [])];
  }
  if (roomType === 'kitchen' && applianceRoles.has(role)) return ['appliances'];
  if (role === 'sink') return roomType === 'bathroom' ? ['fixtures', 'vanity_top'] : ['faucet'];
  if (role === 'bathtub') return ['tub', 'fixtures'];
  if (role === 'toilet') return ['fixtures'];
  return [];
}
export const SCAN_TAKEOFF_UNITS: Partial<Record<MaterialSlotId, ScanTakeoff['unit']>> = {
  cabinets_base: 'lf', cabinets_upper: 'lf', cabinets_tall: 'lf', island_cabinets: 'lf', vanity_cabinet: 'lf',
  countertop: 'sqft', island_countertop: 'sqft', vanity_top: 'sqft', backsplash: 'sqft', flooring: 'sqft', floor_tile: 'sqft', walls: 'sqft', ceiling: 'sqft', wall_tile: 'sqft', shower_wall_tile: 'sqft', shower_floor_tile: 'sqft',
  hardware: 'each', faucet: 'each', fixtures: 'each', tub: 'each', appliances: 'ls', lighting_fixture: 'each', mirror: 'each',
};
/** Sensor evidence compiles to an editable inventory with stable identity. It
 * never silently turns a measured bent footprint into a rectangular cabinet. */
export function compileScanDesign(spec: SingleRoomSpec) {
  if (!spec.scanGeometry) return [];
  const sources = new Map(spec.scanGeometry.objects.map(object => [object.id, object]));
  const takeoffs = validScanTakeoffs(spec);
  const layout = scannedObjectLayout(spec.scanGeometry, spec.roomType);
  const rendered = new Set(scannedObjectFeatures(layout.objects, spec.scanGeometry).objects.map(item => item.id));
  return layout.objects.map((object, index) => {
    const source = sources.get(object.id)!;
    const edit = scanObjectEdit(spec, object.id);
    const slots = scanObjectSlots(object.role, spec.roomType);
    if (object.countertopSurfaces?.length && !slots.some(slot => ['countertop', 'island_countertop', 'vanity_top'].includes(slot))) slots.push(spec.roomType === 'bathroom' ? 'vanity_top' : 'countertop');
    return { id: object.id, label: `${object.role === 'other' ? object.kind : object.role.replaceAll('-', ' ')} ${index + 1}`, role: object.role, source, edit, slots,
      parentId: source.parentIdentifier ?? null, renderedInModel: rendered.has(object.id), geometryBasis: source.countertopSurfaces?.length ? 'observed-surface-and-detected-bounds' : 'detected-bounds',
      confidence: object.confidence, proposedWidthMeters: source.dimensions.x * edit.scaleX, proposedDepthMeters: source.dimensions.z * edit.scaleZ,
      takeoffs: takeoffs.filter(takeoff => takeoff.objectIds.includes(object.id)), modified: !scanEditIsIdentity(edit) };
  });
}
const roomIds = new Set(['room-floor', 'room-ceiling', 'room-walls', 'unmeasured-scan-surface']);
/** Invalid imports remain unpriced, even if a caller bypassed UI validation. */
export function validScanTakeoffs(spec: SingleRoomSpec): ScanTakeoff[] {
  if (!spec.scanGeometry) return [];
  const ids = new Set([...spec.scanGeometry.objects, ...spec.scanGeometry.surfaces].map(object => object.id));
  const used = new Set<string>();
  const applianceIds = scannedObjectLayout(spec.scanGeometry, spec.roomType).objects.filter(item => applianceRoles.has(item.role) && !scanObjectIsHidden(spec, item.id)).map(item => item.id);
  return (spec.scanDesign?.takeoffs ?? []).filter(takeoff => {
    if (!ScanTakeoffZ.safeParse(takeoff).success || !Object.hasOwn(spec.materials, takeoff.slot) || SCAN_TAKEOFF_UNITS[takeoff.slot as MaterialSlotId] !== takeoff.unit) return false;
    const roomScope = takeoff.slot === 'walls' ? 'room-walls' : takeoff.slot === 'ceiling' ? 'room-ceiling' : ['flooring', 'floor_tile'].includes(takeoff.slot) ? 'room-floor' : null;
    if (takeoff.slot === 'appliances' && (takeoff.objectIds.length !== applianceIds.length || !applianceIds.every(id => takeoff.objectIds.includes(id)))) return false;
    if (roomScope && (takeoff.objectIds.length !== 1 || takeoff.objectIds[0] !== roomScope)) return false;
    if (!takeoff.objectIds.every(id => ids.has(id) || roomIds.has(id)) || new Set(takeoff.objectIds).size !== takeoff.objectIds.length) return false;
    if (takeoff.objectIds.some(id => scanObjectIsHidden(spec, id))) return false;
    const keys = takeoff.objectIds.map(id => `${takeoff.slot}:${id}`);
    if (keys.some(key => used.has(key))) return false;
    keys.forEach(key => used.add(key)); return true;
  });
}
export function validScanWorkAllowances(spec: SingleRoomSpec) {
  const ids = new Set(spec.scanGeometry?.objects.map(item => item.id) ?? []), seen = new Set<string>();
  return (spec.scanDesign?.workAllowances ?? []).filter(item => {
    if (!ScanWorkAllowanceZ.safeParse(item).success || !ids.has(item.objectId) || seen.has(item.objectId)) return false;
    seen.add(item.objectId); return true;
  });
}
/** A move/rotation does not buy new material. Size changes anywhere in a
 * supporting assembly invalidate adoption of its proposed quantity as as-found. */
export function scanObjectSizeChanged(spec: SingleRoomSpec, id: string): boolean {
  const objects = new Map(spec.scanGeometry?.objects.map(item => [item.id, item]) ?? []), seen = new Set<string>();
  let cursor = objects.get(id);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id); const edit = scanObjectEdit(spec, cursor.id);
    if (edit.hidden || Math.abs(edit.scaleX - 1) > 1e-9 || Math.abs(edit.scaleZ - 1) > 1e-9) return true;
    cursor = cursor.parentIdentifier ? objects.get(cursor.parentIdentifier) : undefined;
  }
  return false;
}
export function assertScanDesign(spec: SingleRoomSpec): void {
  if (!spec.scanDesign) return;
  if (!spec.scanGeometry) throw new Error('Object changes require an original captured room.');
  const ids = new Set(spec.scanGeometry.objects.map(object => object.id));
  if (Object.keys(spec.scanDesign.objects).some(id => !ids.has(id))) throw new Error('A proposed object no longer belongs to this scan.');
  if (spec.scanDesign.workAllowances && validScanWorkAllowances(spec).length !== spec.scanDesign.workAllowances.length) throw new Error('A work allowance has missing or repeated objects.');
  if (validScanTakeoffs(spec).length !== spec.scanDesign.takeoffs.length) throw new Error('A measured takeoff has an invalid unit, missing object, duplicate coverage or hidden object.');
}
/** Detect a possible connection only to pause unsafe independent movement.
 * Overlap is never promoted into a fabricated parent relationship. */
export function unresolvedScanSupports(spec: SingleRoomSpec, objectId: string): Array<{ supportId: string; fixtureId: string; message: string }> {
  if (!spec.scanGeometry) return [];
  const objects = scannedObjectLayout(spec.scanGeometry, spec.roomType).objects;
  const source = new Map(spec.scanGeometry.objects.map(item => [item.id, item]));
  const supports = objects.filter(item => ['base-cabinet', 'island', 'tall-cabinet'].includes(item.role));
  const fixtures = objects.filter(item => ['sink', 'cooktop', 'oven', 'dishwasher'].includes(item.role));
  const pairs: Array<{ supportId: string; fixtureId: string; message: string }> = [];
  for (const support of supports) {
    const contained = scanAssemblyIds(spec, support.id), inverse = new Matrix4().fromArray(support.transform).invert();
    for (const fixture of fixtures) {
      if ((objectId !== support.id && objectId !== fixture.id) || contained.has(fixture.id)) continue;
      // A parent that exists in the scan has explicit ownership already.
      const parent = source.get(fixture.id)?.parentIdentifier;
      if (parent && source.has(parent)) continue;
      const local = new Vector3(fixture.position.x, fixture.position.y, fixture.position.z).applyMatrix4(inverse);
      if (Math.abs(local.x) > support.dimensions.x / 2 - .03 || Math.abs(local.z) > support.dimensions.z / 2 - .03) continue;
      const atTop = ['sink', 'cooktop'].includes(fixture.role);
      const sameVerticalRegion = atTop ? Math.abs(local.y + fixture.dimensions.y / 2 - support.dimensions.y / 2) <= .15
        : Math.abs(local.y) + Math.min(fixture.dimensions.y, support.dimensions.y) * .2 < support.dimensions.y / 2;
      if (!sameVerticalRegion) continue;
      pairs.push({ supportId: support.id, fixtureId: fixture.id, message: `A detected ${fixture.role.replaceAll('-', ' ')} overlaps this ${support.role.replaceAll('-', ' ')}, but the capture did not record its attachment. Keep them in place until their connection is reviewed; moving one could leave a fixture or cutout behind.` });
    }
  }
  return pairs;
}
export function updateScanObject(spec: SingleRoomSpec, id: string, patch: Partial<ScanObjectEdit>, keepAppliances = false): SingleRoomSpec {
  const object = spec.scanGeometry?.objects.find(object => object.id === id);
  if (!object || ['__proto__', 'prototype', 'constructor'].includes(id)) throw new Error('Choose an object with a supported identifier from this scan.');
  const next = ScanObjectEditZ.parse({ ...scanObjectEdit(spec, id), ...patch });
  const before = scanObjectEdit(spec, id);
  if (JSON.stringify(before) === JSON.stringify(next)) return spec;
  const layout = scannedObjectLayout(spec.scanGeometry!, spec.roomType);
  if (!scannedObjectFeatures(layout.objects, spec.scanGeometry!).objects.some(item => item.id === id)) throw new Error('This detection is represented by a larger captured cabinet. Edit that cabinet in the clean model.');
  // Only root assemblies are edited. All linked children inherit the same
  // world delta, preserving the captured relationship to their supporting slab.
  if (object.parentIdentifier && spec.scanGeometry!.objects.some(item => item.id === object.parentIdentifier)) throw new Error('Edit the supporting assembly to keep this linked fixture attached.');
  const unresolved = unresolvedScanSupports(spec, id).find(pair => pair.supportId === id || !next.hidden);
  if (unresolved && !scanEditIsIdentity(next)) throw new Error(unresolved.message);
  const affected = scanAssemblyIds(spec, id);
  if (keepAppliances && layout.objects.some(item => affected.has(item.id) && applianceRoles.has(item.role))) throw new Error('Existing appliances and their supporting assemblies are retained in their captured positions.');
  const dimensionsChanged = before.scaleX !== next.scaleX || before.scaleZ !== next.scaleZ || next.hidden;
  const design = structuredClone(spec.scanDesign ?? emptyScanDesign());
  if (scanEditIsIdentity(next)) delete design.objects[id]; else design.objects[id] = next;
  if (dimensionsChanged) design.takeoffs = design.takeoffs.filter(takeoff => !takeoff.objectIds.some(objectId => affected.has(objectId)));
  design.workAllowances = (design.workAllowances ?? []).filter(item => !affected.has(item.objectId));
  return { ...spec, scanDesign: design };
}
export function confirmScanTakeoff(spec: SingleRoomSpec, input: ScanTakeoff): SingleRoomSpec {
  const takeoff = ScanTakeoffZ.parse(input);
  const design = structuredClone(spec.scanDesign ?? emptyScanDesign());
  design.takeoffs = design.takeoffs.filter(existing => existing.id !== takeoff.id && !(existing.slot === takeoff.slot && existing.objectIds.some(id => takeoff.objectIds.includes(id))));
  design.takeoffs.push(takeoff);
  const next = { ...spec, scanDesign: design };
  assertScanDesign(next); return next;
}

/** Proposals share the renderer's captured profile qualification and assembly
 * transforms. Other shapes remain bounds-based risks, never surveyed aisles. */
export function scanDesignIssues(spec: SingleRoomSpec): ScanClearanceIssue[] {
  const issues: ScanClearanceIssue[] = [];
  try { assertScanDesign(spec); } catch (error) { return [{ severity: 'error', code: 'invalid-scan-design', message: error instanceof Error ? error.message : 'Invalid scan design.' }]; }
  const inventory = compileScanDesign(spec);
  const changed = inventory.filter(item => item.modified);
  if (changed.some(item => !item.renderedInModel)) issues.push({ severity: 'error', code: 'unrendered-scan-object', message: 'A changed detection is represented within another cabinet. Edit the visible cabinet instead.' });
  if (!changed.length) return issues;
  for (const item of changed) {
    const unresolved = unresolvedScanSupports(spec, item.id).find(pair => pair.supportId === item.id || !item.edit.hidden);
    if (unresolved) issues.push({ severity: 'error', code: 'unreviewed-scan-attachment', message: unresolved.message });
  }
  if (spec.scanGeometry) {
    const source = new Map(spec.scanGeometry.objects.map(item => [item.id, item])), entries = new Map(inventory.map(item => [item.id, item]));
    const assemblyId = (id: string) => {
      let cursor = source.get(id); const seen = new Set<string>();
      while (cursor?.parentIdentifier && source.has(cursor.parentIdentifier) && !seen.has(cursor.id)) { seen.add(cursor.id); cursor = source.get(cursor.parentIdentifier); }
      return cursor?.id ?? id;
    };
    const rendered = scannedObjectFeatures(scannedObjectLayout(spec.scanGeometry, spec.roomType).objects, spec.scanGeometry).objects;
    issues.push(...scanProposalClearanceIssues(spec.scanGeometry, rendered.map(object => ({ object, label: entries.get(object.id)?.label ?? object.kind, delta: effectiveScanObjectDesignMatrix(spec, object.id), hidden: scanObjectIsHidden(spec, object.id), assemblyId: assemblyId(object.id) })), { width: spec.dims.widthFt * .3048, depth: spec.dims.depthFt * .3048 }));
  }
  issues.push({ severity: 'warning', code: 'scan-proposed-layout', message: 'Proposed fixture changes preserve the source scan. Curved-edge clearances, attachment points and relocation work require site review.' });
  return issues;
}

export function scanRetainedAppliancesChanged(before: SingleRoomSpec, after: SingleRoomSpec): boolean {
  if (!before.scanGeometry || !after.scanGeometry) return false;
  return scannedObjectLayout(before.scanGeometry, before.roomType).objects.filter(item => applianceRoles.has(item.role)).some(item =>
    scanObjectIsHidden(before, item.id) !== scanObjectIsHidden(after, item.id)
    || effectiveScanObjectDesignMatrix(before, item.id).some((value, index) => Math.abs(value - effectiveScanObjectDesignMatrix(after, item.id)[index]) > 1e-8));
}
