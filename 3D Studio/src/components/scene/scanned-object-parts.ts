import * as THREE from 'three';
import { barPull, chamferCylinder, faucetGooseneck, faucetHandle, filletBox } from './detail';
import { applyWorldUVs, worldBox } from './geometry';
import type { utilMaterial } from './materials';
import type { ScannedObjectPresentation } from './scanned-object-layout';
import { measuredCountertopGeometry, scannedCountertopParts } from './scanned-countertop-geometry';
import { capturedIslandLevels, cleanObservedFootprintSurface } from './scanned-object-profile';
import { countertopRingsIntersect, countertopSurfaceIssue, insideCountertopRing } from '@/lib/native/countertop-surfaces';
import { CAPTURED_FURNITURE_SLOT, isCapturedFurnitureRole } from '@/lib/native/captured-furniture';

type Vec3 = [number, number, number];
type Util = Parameters<typeof utilMaterial>[0];
export interface ScannedObjectPart {
  geometry: THREE.BufferGeometry;
  slot: string;
  util?: Util;
  position?: Vec3;
  rotation?: Vec3;
  name: string;
  inference?: 'supported-mesh-shell' | 'completed-captured-height-bands' | 'support-inferred-below-observed-footprint';
}

export interface DetectedSinkCutout {
  sinkId: string;
  /** Bowl opening in the supporting cabinet’s local X/Z frame. */
  polygon: Array<{ x: number; z: number }>;
}

export interface ScannedObjectPartsOptions {
  roomType?: 'kitchen' | 'bathroom';
  detectedSinkCutouts?: DetectedSinkCutout[];
  /** Explicit design preview from captured bounds; does not replace measured source contours. */
  simplifiedSolids?: boolean;
  /** A user-selected representative profile, not a measured footprint or height correction. */
  islandStyle?: 'standard' | 'raised-bar';
  /** Explicit photo-assisted addition; the capture did not establish this sink. */
  sinkInsert?: boolean;
  /** Optional local X offset, clamped to preserve at least 8 cm of countertop at each side. */
  sinkCenterX?: number;
  /** Explicit photo-assisted addition, in the upper cabinet's local X frame. */
  microwaveInsert?: { centerX: number; width: number };
}

// Extra curved fixtures share immutable geometry, just like worldBox/filletBox.
const curves = new Map<string, THREE.BufferGeometry>();
function ovalRing(width: number, depth: number, thickness: number): THREE.BufferGeometry {
  const key = `ring:${width.toFixed(4)}:${depth.toFixed(4)}:${thickness.toFixed(4)}`;
  let geometry = curves.get(key);
  if (!geometry) {
    geometry = new THREE.TorusGeometry(1, thickness / width, 6, 32);
    geometry.rotateX(Math.PI / 2);
    geometry.scale((width - thickness) / 2, width / 2, (depth - thickness) / 2);
    applyWorldUVs(geometry);
    curves.set(key, geometry);
  }
  return geometry;
}

/** Rounded rectangular rim, reused by a bowl and its supporting slab cutout. */
function bowlRing(width: number, depth: number, radius: number) {
  const points: Array<{ x: number; z: number }> = [];
  const r = Math.min(radius, width / 2, depth / 2);
  for (let corner = 0; corner < 4; corner++) {
    const angle = corner * Math.PI / 2;
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - r);
    const cz = (corner < 2 ? 1 : -1) * (depth / 2 - r);
    for (let step = 0; step <= 6; step++) {
      const a = angle + step * Math.PI / 12;
      points.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
    }
  }
  return points;
}
function basinRim(w: number, d: number, tub: boolean) { return Math.min(w * 0.075, d * 0.075, tub ? 0.07 : 0.028); }

/** Associate only a fully contained, horizontal sink whose rim meets a cabinet top.
 * The cutout follows the original relative pose, including rotated sinks; no object moves. */
export function scannedSinkCutouts(objects: ScannedObjectPresentation[]): Map<string, DetectedSinkCutout[]> {
  const result = new Map<string, DetectedSinkCutout[]>();
  const validFrame = (o: ScannedObjectPresentation) => o.transform.length === 16 && o.transform.every(Number.isFinite) && Math.abs(new THREE.Matrix4().fromArray(o.transform).determinant()) > 1e-8 && Object.values(o.dimensions).every(v => Number.isFinite(v) && v > 0);
  const supports = objects.filter(o => (o.role === 'base-cabinet' || o.role === 'island') && validFrame(o)).slice(0, 128);
  for (const sink of objects.filter(o => o.role === 'sink').slice(0, 32)) {
    const { x: w, y: h, z: d } = sink.dimensions;
    if (!validFrame(sink) || ![w, h, d].every(v => Number.isFinite(v) && v > 0) || w < 0.15 || d < 0.12) continue;
    const rim = basinRim(w, d, false);
    const ring = bowlRing(w - 2 * rim, d - 2 * rim, Math.min(w, d) * 0.16);
    let best: { id: string; error: number; polygon: DetectedSinkCutout['polygon'] } | undefined;
    for (const cabinet of supports) {
      const relative = new THREE.Matrix4().fromArray(cabinet.transform).invert().multiply(new THREE.Matrix4().fromArray(sink.transform));
      const up = new THREE.Vector3(0, 1, 0).transformDirection(relative);
      if (up.y < 0.995) continue;
      const points = ring.map(p => new THREE.Vector3(p.x, h / 2, p.z).applyMatrix4(relative));
      const error = Math.max(...points.map(p => Math.abs(p.y - cabinet.dimensions.y / 2)));
      if (error > 0.06 || points.some(p => Math.abs(p.x) > cabinet.dimensions.x / 2 - 0.008 || Math.abs(p.z) > cabinet.dimensions.z / 2 - 0.008)) continue;
      if (!best || error < best.error) best = { id: cabinet.id, error, polygon: points.map(p => ({ x: p.x, z: p.z })) };
    }
    if (best) {
      const openings = result.get(best.id) ?? [];
      if (openings.length < 8) { openings.push({ sinkId: sink.id, polygon: best.polygon }); result.set(best.id, openings); }
    }
  }
  return result;
}

/** A smooth hollow shell, closed underneath but never capped across the bowl. */
function basinShell(w: number, h: number, d: number, tub: boolean): THREE.BufferGeometry {
  const key = `basin:${w}:${h}:${d}:${tub}`;
  const old = curves.get(key); if (old) return old;
  const rim = basinRim(w, d, tub), bottom = Math.min(h * 0.12, 0.045);
  const radius = Math.min(w, d) * (tub ? 0.17 : 0.16);
  const profiles = [
    { w: w * 0.84, d: d * 0.84, y: -h / 2 },
    { w, d, y: h / 2 - Math.min(0.012, h * 0.06) },
    { w: w - 2 * rim, d: d - 2 * rim, y: h / 2 },
    { w: (w - 2 * rim) * 0.79, d: (d - 2 * rim) * 0.72, y: -h / 2 + bottom },
  ];
  const rings = profiles.map(p => bowlRing(p.w, p.d, radius).map(q => new THREE.Vector3(q.x, p.y, q.z)));
  const positions: number[] = [], indices: number[] = [], n = rings[0].length;
  for (const ring of rings) for (const p of ring) positions.push(p.x, p.y, p.z);
  for (let level = 0; level < rings.length - 1; level++) for (let i = 0; i < n; i++) {
    const a = level * n + i, b = level * n + (i + 1) % n, c = (level + 1) * n + i, e = (level + 1) * n + (i + 1) % n;
    indices.push(a, c, b, b, c, e);
  }
  const underside = positions.length / 3; positions.push(0, -h / 2, 0);
  const inside = positions.length / 3; positions.push(0, -h / 2 + bottom, 0);
  for (let i = 0; i < n; i++) {
    indices.push(underside, i, (i + 1) % n);
    indices.push(inside, 3 * n + (i + 1) % n, 3 * n + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); applyWorldUVs(geometry); curves.set(key, geometry); return geometry;
}

/** Explicitly inferred clean support below a sufficiently broad observed perimeter. */
function cleanObservedFootprint(object: ScannedObjectPresentation): ScannedObjectPart[] | null {
  const surface = cleanObservedFootprintSurface(object); if (!surface) return null;
  const h = object.dimensions.y, outer = surface.polygonCorners;
  const thickness = Math.min(0.032, h * 0.05);
  const bodySurface = { ...surface, polygonCorners: outer.map(p => ({ ...p, y: p.y - thickness })), holes: surface.holes.map(ring => ring.map(p => ({ ...p, y: p.y - thickness }))) };
  const top = measuredCountertopGeometry(surface, { depth: thickness });
  const body = measuredCountertopGeometry(bodySurface, { height: -h / 2 });
  if (!top || !body) { top?.dispose(); body?.dispose(); return null; }
  for (const geometry of [top, body]) geometry.userData = { disposableScanGeometry: true, inferredGeometry: true, observedPerimeterRetained: true, inferredSupport: true };
  const island = object.role === 'island';
  return [
    { name: 'clean-observed-perimeter-carcass', geometry: body, slot: island ? 'island_cabinets' : 'cabinets_base', inference: 'support-inferred-below-observed-footprint' },
    { name: 'clean-observed-perimeter-countertop', geometry: top, slot: island ? 'island_countertop' : 'countertop', inference: 'support-inferred-below-observed-footprint' },
  ];
}

/** An observed patch must not z-fight a representative appliance/cabinet lid.
 * Suppress only overlapping, nearly coplanar upward triangles of that display
 * body. This never fills the patch's gaps or changes any captured contour.
 * Source/shared geometries stay immutable; the replacement is object-owned. */
function withoutConflictingRepresentativeTops(parts: ScannedObjectPart[], object: ScannedObjectPresentation): ScannedObjectPart[] {
  const surfaces = (object.countertopSurfaces ?? []).filter(surface => !countertopSurfaceIssue(surface)).map(surface => ({
    outer: surface.polygonCorners, holes: surface.holes ?? [],
    minX: Math.min(...surface.polygonCorners.map(p => p.x)), maxX: Math.max(...surface.polygonCorners.map(p => p.x)),
    minZ: Math.min(...surface.polygonCorners.map(p => p.z)), maxZ: Math.max(...surface.polygonCorners.map(p => p.z)),
    minY: Math.min(...surface.polygonCorners.map(p => p.y)), maxY: Math.max(...surface.polygonCorners.map(p => p.y)),
  }));
  const objectFrame = new THREE.Matrix4().fromArray(object.transform);
  return parts.map(part => {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...(part.position ?? [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
    const world = objectFrame.clone().multiply(local);
    const positions = part.geometry.getAttribute('position'), indices = part.geometry.getIndex();
    const length = indices?.count ?? positions.count, kept: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3(), edge = new THREE.Vector3();
    for (let i = 0; i < length; i += 3) {
      const ids = [0, 1, 2].map(offset => indices ? indices.getX(i + offset) : i + offset);
      a.fromBufferAttribute(positions, ids[0]).applyMatrix4(world); b.fromBufferAttribute(positions, ids[1]).applyMatrix4(world); c.fromBufferAttribute(positions, ids[2]).applyMatrix4(world);
      normal.subVectors(b, a).cross(edge.subVectors(c, a)).normalize();
      const conflict = normal.y > 0.995 && surfaces.some(surface =>
        Math.min(a.y, b.y, c.y) >= surface.minY - 0.003 && Math.max(a.y, b.y, c.y) <= surface.maxY + 0.003
        && Math.max(a.x, b.x, c.x) >= surface.minX && Math.min(a.x, b.x, c.x) <= surface.maxX
        && Math.max(a.z, b.z, c.z) >= surface.minZ && Math.min(a.z, b.z, c.z) <= surface.maxZ
        && ([a, b, c].some(point => insideCountertopRing(point, surface.outer) && !surface.holes.some(hole => insideCountertopRing(point, hole)))
          || surface.outer.some(point => insideCountertopRing(point, [a, b, c]))
          || [surface.outer, ...surface.holes].some(ring => countertopRingsIntersect(ring, [a, b, c]))));
      if (!conflict) kept.push(...ids);
    }
    if (kept.length === length) return part;
    const geometry = part.geometry.clone(); geometry.setIndex(kept); geometry.clearGroups();
    geometry.userData = { ...geometry.userData, disposableScanGeometry: true, representativeTopSuppressed: true };
    return { ...part, geometry };
  });
}

/** Representative objects in the source object's centred, +Z-front frame.
 * These details are display geometry, never a takeoff or proof of cabinet type.
 * Shared detail geometries are immutable. Dispose only geometries marked
 * disposableScanGeometry; those are owned per-object cutouts/reconstructions. */
export function scannedObjectParts(object: ScannedObjectPresentation, options: ScannedObjectPartsOptions = {}): ScannedObjectPart[] {
  const parts = buildScannedObjectParts(object, options);
  if (!isCapturedFurnitureRole(object.role)) return parts;
  // Keep the representative geometry and any measured contours, but never
  // assert a wood/fabric finish from an uncertain furniture classification.
  // Every return path (including measured patches and tiny objects) receives
  // its own evidence channel, isolated from cabinet/countertop design choices.
  return parts.map(part => ({ ...part, slot: CAPTURED_FURNITURE_SLOT, util: undefined }));
}

function buildScannedObjectParts(object: ScannedObjectPresentation, options: ScannedObjectPartsOptions): ScannedObjectPart[] {
  // A RoomPlan dishwasher or merged tall-storage box can own a real countertop
  // patch. Its body remains useful, while the patch retains its measured height
  // and footprint in either preview. Ownership does not establish a full slab.
  const appendObserved = object.role === 'dishwasher' || object.role === 'tall-cabinet';
  const observed = appendObserved ? scannedCountertopParts(object) : null;
  // Partial observed coverage remains the default. Only an explicit design
  // preview may use a representative solid inside the captured object bounds.
  if (options.simplifiedSolids !== true) {
    const measured = scannedCountertopParts(object);
    if (measured !== null && !appendObserved) return measured;
  }
  if (options.simplifiedSolids === true && !options.sinkInsert && !options.detectedSinkCutouts?.length && options.islandStyle !== 'raised-bar') {
    const clean = !appendObserved && cleanObservedFootprint(object);
    if (clean) return clean;
  }
  const { x: w, y: h, z: d } = object.dimensions;
  if (![w, h, d].every(value => Number.isFinite(value) && value > 0)) return [];
  const parts: ScannedObjectPart[] = [];
  const add = (name: string, geometry: THREE.BufferGeometry, slot: string, position: Vec3 = [0, 0, 0], util?: Util, rotation?: Vec3) => {
    parts.push({ name, geometry, slot, position, ...(util ? { util } : {}), ...(rotation ? { rotation } : {}) });
  };
  const box = (name: string, size: Vec3, position: Vec3, slot: string, util?: Util, radius = 0.002) => {
    if (size.some(value => value <= 0)) return;
    add(name, radius ? filletBox(...size, Math.min(radius, ...size.map(value => value / 8)), 1) : worldBox(...size), slot, position, util);
  };
  // Very small detections cannot contain normal joinery or appliance details.
  if (Math.min(w, h, d) < 0.05 || w < 0.15 || d < 0.12 || (h < 0.15 && object.role !== 'cooktop' && object.role !== 'sink')) {
    add('observed-small-object', worldBox(w, h, d), 'cabinets_base', [0, 0, 0], 'ceramic-matte');
    return [...parts, ...(observed ?? [])];
  }
  const pull = (name: string, length: number, position: Vec3, vertical = false, slot = 'hardware') => {
    add(name, barPull(Math.min(0.6, Math.max(0.04, length)) * 1000, { barMm: 8, projectionMm: Math.min(24, d * 250) }), slot, position, undefined, vertical ? [0, 0, Math.PI / 2] : undefined);
  };
  const front = d / 2 - Math.min(0.024, d * 0.3);
  const panelThickness = Math.min(0.017, d * 0.1);
  const reveal = Math.min(0.004, w * 0.01, h * 0.01);

  function door(name: string, width: number, height: number, x: number, y: number, slot: string, handleSide: 1 | -1 = 1) {
    const rail = Math.min(0.052, width * 0.15, height * 0.15);
    box(`${name}-recessed-panel`, [width - 2 * rail, height - 2 * rail, panelThickness * 0.55], [x, y, front - panelThickness * 0.15], slot);
    for (const sign of [-1, 1]) {
      box(`${name}-stile-${sign}`, [rail, height, panelThickness], [x + sign * (width - rail) / 2, y, front], slot);
      box(`${name}-rail-${sign}`, [width - 2 * rail, rail, panelThickness], [x, y + sign * (height - rail) / 2, front], slot);
    }
    if (width > 0.15 && height > 0.2) {
      const length = Math.min(0.16, height * 0.32);
      pull(`${name}-pull`, length, [x + handleSide * (width / 2 - rail / 2), y + Math.min(height * 0.22, height / 2 - length / 2 - 0.025), front + panelThickness / 2], true);
    }
  }

  function cabinet() {
    const island = object.role === 'island', upper = object.role === 'upper-cabinet', tall = object.role === 'tall-cabinet';
    if (upper && microwaveCabinet()) return;
    const levels = options.simplifiedSolids === true ? capturedIslandLevels(object) : null;
    const raisedBar = island && (options.islandStyle === 'raised-bar' || !!levels);
    const detectedCutouts = !upper && !tall ? options.detectedSinkCutouts ?? [] : [];
    const sinkInsert = object.role === 'base-cabinet' && options.sinkInsert === true && w >= 0.5 && h >= 0.55 && d >= 0.45;
    const slot = island ? 'island_cabinets' : upper ? 'cabinets_upper' : tall ? 'cabinets_tall' : 'cabinets_base';
    const counter = !upper && !tall ? Math.min(0.032, h * 0.05) : 0;
    const toe = upper ? 0 : Math.min(0.105, h * 0.13);
    const workingHeight = levels?.workingHeight ?? (raisedBar ? Math.max(h * 0.55, Math.min(0.92, h - 0.12)) : h);
    const barHeight = levels?.barHeight ?? h;
    const barDepth = levels?.barDepth ?? (raisedBar ? Math.min(0.32, d * 0.38) : 0);
    const workingDepth = d - barDepth, workingZ = barDepth / 2;
    const carcassTop = -h / 2 + workingHeight - counter, carcassBottom = -h / 2 + toe;
    const bodyHeight = carcassTop - carcassBottom, bodyY = (carcassTop + carcassBottom) / 2;
    // The body ends behind the doors; dark gaps remain real gaps between fronts.
    const bodyFront = front - panelThickness, bodyBack = -d / 2 + barDepth;
    if (sinkInsert || detectedCutouts.length) {
      // A full carcass box would fill the sink opening from below. Keep only
      // the cabinet shell so the explicitly added basin is actually hollow.
      const thickness = 0.016, bodyDepth = bodyFront - bodyBack;
      const prefix = sinkInsert ? 'reference-sink' : 'detected-sink';
      for (const sign of [-1, 1]) box(`${prefix}-carcass-side-${sign}`, [thickness, bodyHeight, bodyDepth], [sign * (w * 0.995 - thickness) / 2, bodyY, (bodyBack + bodyFront) / 2], slot);
      box(`${prefix}-carcass-back`, [w * 0.995 - 2 * thickness, bodyHeight, thickness], [0, bodyY, bodyBack + thickness / 2], slot);
      box(`${prefix}-carcass-bottom`, [w * 0.995 - 2 * thickness, thickness, bodyDepth - thickness], [0, carcassBottom + thickness / 2, (bodyBack + bodyFront + thickness) / 2], slot);
    } else {
      box(`${object.role}-carcass`, [w * 0.995, bodyHeight, bodyFront - bodyBack], [0, bodyY, (bodyBack + bodyFront) / 2], slot);
    }
    box(`${object.role}-front-reveals`, [w * 0.982, bodyHeight * 0.988, 0.003], [0, bodyY, bodyFront + 0.002], slot, 'dark-wood', 0);
    if (toe) box(`${object.role}-recessed-toe-kick`, [w * 0.93, toe, workingDepth * 0.76], [0, -h / 2 + toe / 2, workingZ - workingDepth * 0.07], slot, 'dark-wood');
    if (sinkInsert) {
      const openingWidth = Math.min(0.72, w - 0.16), openingDepth = Math.min(0.44, d - 0.16);
      const sideMargin = (w - openingWidth) / 2, endMargin = (d - openingDepth) / 2;
      const maximumOffset = Math.max(0, sideMargin - 0.08);
      const sinkX = Math.max(-maximumOffset, Math.min(maximumOffset, Number.isFinite(options.sinkCenterX) ? options.sinkCenterX! : 0));
      const counterY = h / 2 - counter / 2;
      for (const sign of [-1, 1]) {
        const width = sideMargin - sign * sinkX;
        box(`reference-sink-counter-side-${sign}`, [width, counter, d], [sign * (w - width) / 2, counterY, 0], 'countertop', undefined, 0.004);
        box(`reference-sink-counter-end-${sign}`, [openingWidth, counter, endMargin], [sinkX, counterY, sign * (d - endMargin) / 2], 'countertop', undefined, 0.004);
      }
      const basinDepth = Math.min(0.2, bodyHeight * 0.36), wall = 0.008;
      const basinTop = h / 2 - counter, basinBottom = basinTop - basinDepth;
      box('reference-sink-basin-bottom', [openingWidth - 2 * wall, wall, openingDepth - 2 * wall], [sinkX, basinBottom + wall / 2, 0], 'appliances', 'stainless', 0.003);
      for (const sign of [-1, 1]) {
        box(`reference-sink-basin-side-${sign}`, [wall, basinDepth, openingDepth], [sinkX + sign * (openingWidth - wall) / 2, basinTop - basinDepth / 2, 0], 'appliances', 'stainless', 0.003);
        box(`reference-sink-basin-end-${sign}`, [openingWidth - 2 * wall, basinDepth, wall], [sinkX, basinTop - basinDepth / 2, sign * (openingDepth - wall) / 2], 'appliances', 'stainless', 0.003);
      }
      add('reference-sink-drain', chamferCylinder(Math.min(0.024, openingWidth * 0.08), 0.005, 0.0005, 20), 'appliances', [sinkX, basinBottom + wall + 0.0025, 0], 'chrome');
      const faucetZ = -openingDepth / 2 - Math.min(0.045, endMargin / 2);
      // This is the only photo-assisted addition allowed beyond the source box:
      // the spout stays under 32 cm above its top and inside its plan footprint.
      add('reference-faucet-spout', faucetGooseneck({ heightM: 0.285, reachM: Math.min(0.19, openingDepth * 0.6), tubeMm: 18, pulldown: false, segments: 10 }), 'faucet', [sinkX, h / 2, faucetZ]);
      add('reference-faucet-lever', faucetHandle({ kind: 'lever', lengthM: 0.05 }), 'faucet', [sinkX + 0.065, h / 2, faucetZ]);
    } else if (counter && detectedCutouts.length) {
      const top = -h / 2 + workingHeight;
      const surface = { polygonCorners: [{ x: -w / 2, y: top, z: -d / 2 }, { x: w / 2, y: top, z: -d / 2 }, { x: w / 2, y: top, z: d / 2 }, { x: -w / 2, y: top, z: d / 2 }],
        holes: detectedCutouts.map(c => c.polygon.map(p => ({ ...p, y: top }))), source: 'lidar-mesh' as const, resolutionMeters: 0.03 };
      const geometry = measuredCountertopGeometry(surface, { depth: counter });
      if (geometry) {
        geometry.userData = { disposableScanGeometry: true, inferredGeometry: true, detectedSinkIds: detectedCutouts.map(c => c.sinkId) };
        add('detected-sink-cutout-countertop', geometry, island ? 'island_countertop' : 'countertop');
      } else {
        // Inconsistent/overlapping detections cannot erase the entire slab.
        box(`${object.role}-countertop`, [w, counter, workingDepth], [0, top - counter / 2, workingZ], island ? 'island_countertop' : 'countertop', undefined, 0.004);
      }
    } else if (counter) {
      box(raisedBar ? 'island-working-countertop' : `${object.role}-countertop`, [w, counter, workingDepth], [0, -h / 2 + workingHeight - counter / 2, workingZ], island ? 'island_countertop' : 'countertop', undefined, 0.004);
    }
    if (raisedBar) {
      // Separate working and bar slabs explain the two levels while leaving the
      // captured box unchanged. Their rectangular edges are representative: the
      // scan does not establish any real chamfer or L-shaped peninsula outline.
      box('island-raised-bar-countertop', [w, counter, barDepth], [0, -h / 2 + barHeight - counter / 2, -d / 2 + barDepth / 2], 'island_countertop', undefined, 0.004);
      const supportDepth = barDepth * 0.68;
      box('island-raised-bar-support-wall', [w * 0.97, barHeight - counter, supportDepth], [0, -h / 2 + (barHeight - counter) / 2, -d / 2 + barDepth * 0.04 + supportDepth / 2], 'walls');
      if (levels) for (const part of parts) part.inference = 'completed-captured-height-bands';
    }
    if (upper) box('upper-cabinet-top-lip', [w, Math.min(0.025, h * 0.04), d * 0.985], [0, h / 2 - Math.min(0.025, h * 0.04) / 2, 0], slot);
    const columns = Math.max(1, Math.min(tall ? 3 : 4, Math.ceil(w / 0.62)));
    const unitWidth = w * 0.98 / columns, doorWidth = unitWidth - reveal;
    const drawerH = !upper && !tall ? Math.min(0.18, bodyHeight * 0.24) : 0;
    const doorHeight = bodyHeight - drawerH - 2 * reveal;
    for (let i = 0; i < columns; i++) {
      const x = (i - (columns - 1) / 2) * unitWidth;
      if (tall && doorHeight > 1.5) {
        const lowerH = doorHeight * 0.64, upperH = doorHeight - lowerH - reveal;
        door(`tall-door-${i}-lower`, doorWidth, lowerH, x, carcassBottom + reveal + lowerH / 2, slot, i % 2 ? -1 : 1);
        door(`tall-door-${i}-upper`, doorWidth, upperH, x, carcassTop - reveal - upperH / 2, slot, i % 2 ? -1 : 1);
      } else {
        door(`cabinet-door-${i}`, doorWidth, doorHeight, x, carcassBottom + reveal + doorHeight / 2, slot, i % 2 ? -1 : 1);
      }
      if (drawerH) {
        const y = carcassTop - reveal - drawerH / 2;
        box(`drawer-front-${i}`, [doorWidth, drawerH - reveal, panelThickness], [x, y, front], slot);
        if (doorWidth > 0.13) pull(`drawer-pull-${i}`, Math.min(0.16, doorWidth * 0.55), [x, y, front + panelThickness / 2]);
      }
    }
    if (island) {
      // The far side stays a plain end panel. No stools, sink, utilities or
      // waterfall treatment are inferred from the mere existence of an island.
      if (!raisedBar) box('island-back-panel', [w * 0.97, bodyHeight * 0.96, 0.012], [0, bodyY, -d / 2 + 0.009], slot);
      for (const sign of [-1, 1]) box(`island-end-reveal-${sign}`, [0.012, bodyHeight * 0.96, workingDepth * 0.95], [sign * (w / 2 - 0.009), bodyY, workingZ], slot);
    }
  }

  function applianceBody(name: string) {
    box(`${name}-body`, [w * 0.992, h * 0.99, d - 0.045], [0, 0, -0.0225], 'appliances', undefined, 0.005);
    box(`${name}-door-gasket`, [w * 0.974, h * 0.97, 0.01], [0, 0, d / 2 - 0.036], 'appliances', 'rubber');
  }
  function applianceFace(name: string, width: number, height: number, x: number, y: number) {
    box(name, [width, height, 0.022], [x, y, front - 0.003], 'appliances', undefined, 0.004);
  }
  function glassFace(name: string, width: number, height: number, x: number, y: number) {
    box(`${name}-black-backing`, [width, height, 0.007], [x, y, front + 0.009], 'appliances', 'black-metal', 0.006);
    box(`${name}-glass`, [width * 0.985, height * 0.985, 0.002], [x, y, front + 0.014], 'appliances', 'glass', 0.004);
  }
  function microwaveCabinet(): boolean {
    const insert = options.microwaveInsert;
    if (!insert || !Number.isFinite(insert.centerX) || !Number.isFinite(insert.width) || insert.width <= 0 || w < 0.5 || h < 0.45 || d < 0.24) return false;
    const microwaveWidth = Math.min(w - 0.024, Math.max(0.45, insert.width));
    const centerX = Math.max(-w / 2 + microwaveWidth / 2 + 0.012, Math.min(w / 2 - microwaveWidth / 2 - 0.012, insert.centerX));
    const microwaveHeight = Math.min(0.38, h - 0.12), microwaveY = -h / 2 + microwaveHeight / 2;
    const upperHeight = h - microwaveHeight, upperY = microwaveHeight / 2;
    const bodyFront = front - panelThickness, bodyDepth = d / 2 + bodyFront;
    const slot = 'cabinets_upper';
    function cabinetRegion(name: string, width: number, height: number, x: number, y: number, columns: number) {
      if (width <= reveal || height <= reveal) return;
      box(`${name}-carcass`, [width, height, bodyDepth], [x, y, (-d / 2 + bodyFront) / 2], slot);
      box(`${name}-reveals`, [width * 0.995, height * 0.985, 0.003], [x, y, bodyFront + 0.002], slot, 'dark-wood', 0);
      if (width > 0.12 && height > 0.12) for (let i = 0; i < columns; i++) {
        const unit = width / columns;
        door(`${name}-door-${i}`, unit - reveal, height - 2 * reveal, x + (i - (columns - 1) / 2) * unit, y, slot, i % 2 ? -1 : 1);
      }
    }
    // Cabinet fronts are partitioned around the selected opening. None crosses
    // its lower centre or continues as a full slab behind the microwave.
    cabinetRegion('reference-microwave-cabinet-above', w * 0.995, upperHeight - reveal, 0, upperY + reveal / 2, Math.min(3, Math.max(1, Math.ceil(w / 0.75))));
    const leftWidth = centerX - microwaveWidth / 2 + w / 2 - reveal;
    const rightWidth = w / 2 - centerX - microwaveWidth / 2 - reveal;
    cabinetRegion('reference-microwave-cabinet-left', leftWidth, microwaveHeight, -w / 2 + leftWidth / 2, microwaveY, 1);
    cabinetRegion('reference-microwave-cabinet-right', rightWidth, microwaveHeight, w / 2 - rightWidth / 2, microwaveY, 1);
    box('reference-microwave-body', [microwaveWidth * 0.99, microwaveHeight * 0.985, d - 0.045], [centerX, microwaveY, -0.0225], 'appliances');
    for (const sign of [-1, 1]) {
      box(`reference-microwave-frame-rail-${sign}`, [microwaveWidth * 0.985, microwaveHeight * 0.075, 0.022], [centerX, microwaveY + sign * microwaveHeight * 0.455, front - 0.003], 'appliances');
      box(`reference-microwave-frame-stile-${sign}`, [microwaveWidth * 0.035, microwaveHeight * 0.835, 0.022], [centerX + sign * microwaveWidth * 0.476, microwaveY, front - 0.003], 'appliances');
    }
    glassFace('reference-microwave-window', microwaveWidth * 0.72, microwaveHeight * 0.765, centerX - microwaveWidth * 0.08, microwaveY);
    box('reference-microwave-control-panel', [microwaveWidth * 0.165, microwaveHeight * 0.83, 0.018], [centerX + microwaveWidth * 0.38, microwaveY, front], 'appliances', 'black-metal');
    pull('reference-microwave-handle', Math.min(0.22, microwaveHeight * 0.6), [centerX + microwaveWidth * 0.275, microwaveY, front], true, 'appliances');
    box('reference-microwave-control-display', [microwaveWidth * 0.12, microwaveHeight * 0.18, 0.002], [centerX + microwaveWidth * 0.38, microwaveY + microwaveHeight * 0.23, front + 0.011], 'appliances', 'glass');
    for (let row = 0; row < 3; row++) box(`reference-microwave-control-row-${row}`, [microwaveWidth * 0.105, microwaveHeight * 0.018, 0.002], [centerX + microwaveWidth * 0.38, microwaveY - row * microwaveHeight * 0.1, front + 0.011], 'appliances', 'brushed-nickel');
    return true;
  }
  function cooktop() {
    const plateH = Math.min(0.024, h * 0.36);
    const plateTop = h / 2 - Math.min(0.012, h * 0.2);
    box('cooktop-inset-body', [w * 0.99, h * 0.7, d * 0.98], [0, -h * 0.13, 0], 'appliances');
    box('cooktop-black-surface', [w * 0.975, plateH, d * 0.955], [0, plateTop - plateH / 2, 0], 'appliances', 'black-metal');
    const radius = Math.min(w * 0.12, d * 0.12, 0.088), burnerH = Math.min(0.01, h * 0.12);
    for (const xSign of [-1, 1]) for (const zSign of [-1, 1]) {
      const x = xSign * w * 0.235, z = zSign * d * 0.22;
      add(`cooktop-burner-${xSign}-${zSign}`, chamferCylinder(radius, burnerH, 0.001, 20), 'appliances', [x, plateTop + burnerH / 2, z], 'matte-black');
      const grateY = Math.min(h / 2 - 0.004, plateTop + burnerH);
      box(`cooktop-grate-x-${xSign}-${zSign}`, [radius * 2.8, 0.007, 0.009], [x, grateY, z], 'appliances', 'black-metal');
      box(`cooktop-grate-z-${xSign}-${zSign}`, [0.009, 0.007, radius * 2.8], [x, grateY, z], 'appliances', 'black-metal');
    }
  }

  switch (object.role) {
    case 'base-cabinet': case 'upper-cabinet': case 'tall-cabinet': case 'island': cabinet(); break;
    case 'refrigerator': {
      applianceBody('refrigerator');
      const upperH = h * 0.64, upperY = h / 2 - upperH / 2 - h * 0.015;
      for (const sign of [-1, 1]) {
        applianceFace(`refrigerator-french-door-${sign}`, w * 0.484, upperH, sign * w * 0.246, upperY);
        pull(`refrigerator-door-pull-${sign}`, Math.min(0.42, upperH * 0.55), [sign * w * 0.058, upperY - upperH * 0.12, front + 0.008], true, 'appliances');
      }
      applianceFace('refrigerator-freezer-drawer', w * 0.978, h * 0.31, 0, -h * 0.324);
      pull('refrigerator-freezer-pull', w * 0.63, [0, -h * 0.24, front + 0.008], false, 'appliances');
      glassFace('refrigerator-dispenser', w * 0.23, h * 0.15, -w * 0.24, h * 0.075);
      box('refrigerator-bottom-vent', [w * 0.9, h * 0.025, 0.005], [0, -h * 0.48, front], 'appliances', 'black-metal');
      break;
    }
    case 'oven': {
      applianceBody('oven');
      applianceFace('oven-front-door', w * 0.974, h * 0.69, 0, -h * 0.02);
      glassFace('oven-window', w * 0.77, h * 0.43, 0, -h * 0.02);
      box('oven-controls', [w * 0.968, h * 0.16, 0.025], [0, h * 0.4, front - 0.003], 'appliances', 'stainless');
      glassFace('oven-display', w * 0.25, h * 0.065, 0, h * 0.405);
      for (const sign of [-1, 1]) add(`oven-knob-${sign}`, chamferCylinder(Math.min(w * 0.032, h * 0.04), 0.012, 0.001, 16), 'appliances', [sign * w * 0.32, h * 0.405, front + 0.014], 'black-metal', [Math.PI / 2, 0, 0]);
      pull('oven-door-pull', w * 0.67, [0, h * 0.255, front + 0.008], false, 'appliances');
      applianceFace('oven-lower-drawer', w * 0.974, h * 0.1, 0, -h * 0.42);
      break;
    }
    case 'cooktop': cooktop(); break;
    case 'dishwasher': {
      applianceBody('dishwasher');
      applianceFace('dishwasher-door', w * 0.973, h * 0.83, 0, h * 0.035);
      box('dishwasher-control-strip', [w * 0.94, h * 0.057, 0.008], [0, h * 0.435, front + 0.011], 'appliances', 'black-metal');
      pull('dishwasher-door-pull', w * 0.68, [0, h * 0.32, front + 0.008], false, 'appliances');
      box('dishwasher-plinth', [w * 0.9, h * 0.095, d * 0.83], [0, -h * 0.447, -d * 0.07], 'appliances', 'rubber');
      break;
    }
    case 'sink': case 'bathtub': {
      const tub = object.role === 'bathtub', name = tub ? 'tub' : 'sink';
      const slot = tub ? 'tub' : options.roomType === 'bathroom' ? 'fixtures' : 'appliances';
      const base = Math.min(h * 0.12, 0.045);
      add(`${name}-open-basin-shell`, basinShell(w, h, d, tub), slot, [0, 0, 0], tub ? undefined : options.roomType === 'bathroom' ? 'porcelain' : 'stainless');
      add(`${name}-drain`, chamferCylinder(Math.min(0.025, w * 0.05, d * 0.05), Math.min(0.006, base / 2), 0.0006, 20), 'fixtures', [0, -h / 2 + base + 0.003, 0], 'chrome');
      break;
    }
    case 'toilet': {
      box('toilet-pedestal', [w * 0.59, h * 0.36, d * 0.48], [0, -h * 0.32, d * 0.04], 'fixtures', 'porcelain', 0.07);
      add('toilet-open-bowl', basinShell(w * 0.94, h * 0.22, d * 0.7, false), 'fixtures', [0, -h * 0.03, d * 0.13], 'porcelain');
      add('toilet-seat-rim', ovalRing(w * 0.92, d * 0.65, Math.min(w * 0.09, 0.038)), 'fixtures', [0, h * 0.092, d * 0.13], 'porcelain');
      box('toilet-tank', [w * 0.91, h * 0.51, d * 0.245], [0, h * 0.22, -d * 0.36], 'fixtures', 'porcelain', 0.045);
      box('toilet-tank-lid', [w * 0.96, h * 0.04, d * 0.28], [0, h * 0.48, -d * 0.35], 'fixtures', 'porcelain', 0.014);
      add('toilet-flush-button', chamferCylinder(Math.min(0.018, w * 0.04), h * 0.01, 0.0005, 16), 'fixtures', [0, h * 0.493, -d * 0.35], 'chrome');
      break;
    }
    case 'table': {
      const top = Math.min(h * 0.08, 0.045), leg = Math.min(w, d) * 0.075;
      box('table-top', [w, top, d], [0, h / 2 - top / 2, 0], 'cabinets_base', 'light-wood', 0.008);
      for (const x of [-1, 1]) for (const z of [-1, 1]) box(`table-leg-${x}-${z}`, [leg, h - top, leg], [x * (w / 2 - leg), -top / 2, z * (d / 2 - leg)], 'cabinets_base', 'dark-wood');
      break;
    }
    case 'chair': {
      const seatH = h * 0.075, seatY = -h * 0.06, leg = Math.min(w, d) * 0.075;
      box('chair-seat', [w * 0.98, seatH, d * 0.9], [0, seatY, d * 0.025], 'cabinets_base', 'fabric-linen', 0.025);
      box('chair-backrest', [w * 0.95, h * 0.47, d * 0.13], [0, h * 0.26, -d * 0.41], 'cabinets_base', 'fabric-linen', 0.035);
      const legH = h / 2 + seatY - seatH / 2;
      for (const x of [-1, 1]) for (const z of [-1, 1]) box(`chair-leg-${x}-${z}`, [leg, legH, leg], [x * w * 0.38, -h / 2 + legH / 2, z * d * 0.34], 'cabinets_base', 'dark-wood');
      break;
    }
    case 'sofa': case 'bed': {
      const bed = object.role === 'bed', slot = 'cabinets_base';
      box(`${object.role}-base`, [w * 0.99, h * 0.28, d * 0.99], [0, -h * 0.34, 0], slot, 'dark-wood', 0.02);
      if (bed) {
        box('bed-mattress', [w * 0.95, h * 0.33, d * 0.93], [0, -h * 0.035, d * 0.03], slot, 'fabric-linen', 0.04);
        box('bed-headboard', [w, h * 0.78, d * 0.06], [0, h * 0.1, -d * 0.465], slot, 'fabric-grey', 0.035);
      } else {
        box('sofa-back', [w * 0.99, h * 0.69, d * 0.22], [0, h * 0.15, -d * 0.38], slot, 'fabric-grey', 0.05);
        for (const sign of [-1, 1]) box(`sofa-arm-${sign}`, [w * 0.105, h * 0.58, d * 0.93], [sign * w * 0.442, 0, d * 0.02], slot, 'fabric-grey', 0.045);
        const columns = Math.max(1, Math.min(3, Math.round(w / 0.7))), width = w * 0.76 / columns;
        for (let i = 0; i < columns; i++) box(`sofa-seat-${i}`, [width - 0.006, h * 0.22, d * 0.72], [(i - (columns - 1) / 2) * width, -h * 0.08, d * 0.1], slot, 'fabric-linen', 0.035);
      }
      break;
    }
    default: box('unclassified-observed-object', [w, h, d], [0, 0, 0], 'cabinets_base', 'ceramic-matte', 0.007);
  }
  if (!observed?.length) return parts;
  return [...withoutConflictingRepresentativeTops(parts, object), ...observed];
}
