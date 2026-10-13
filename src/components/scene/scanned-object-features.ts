import * as THREE from 'three';
import type { ScannedRoomGeometry } from '@/lib/spec/types';
import type { ScannedObjectPresentation } from './scanned-object-layout';

export interface ScannedObjectFeatureOptions {
  /** Photo-assisted presentation only; neither feature changes captured measurements. */
  sinkUnderWindow?: boolean;
  microwaveOverRange?: boolean;
}
export interface ScannedObjectFeatures {
  objects: ScannedObjectPresentation[];
  sinkObjectId: string | null;
  /** Offset in the selected cabinet's local X frame; the sink remains within its counter. */
  sinkCenterX: number | null;
  microwave: { objectId: string; centerX: number; width: number } | null;
  notices: string[];
}

function corners(object: ScannedObjectPresentation): THREE.Vector3[] {
  const matrix = new THREE.Matrix4().fromArray(object.transform);
  return [-0.5, 0.5].flatMap(x => [-0.5, 0.5].flatMap(y => [-0.5, 0.5].map(z => new THREE.Vector3(x * object.dimensions.x, y * object.dimensions.y, z * object.dimensions.z).applyMatrix4(matrix))));
}
function axis(matrix: number[], index: number) { return new THREE.Vector3(matrix[index], matrix[index + 1], matrix[index + 2]).normalize(); }
function aligned(a: number[], b: number[], toleranceDegrees: number) {
  const limit = Math.cos(THREE.MathUtils.degToRad(toleranceDegrees));
  return [0, 4, 8].every(index => Math.abs(axis(a, index).dot(axis(b, index))) >= limit);
}
function volume(object: ScannedObjectPresentation) { return object.dimensions.x * object.dimensions.y * object.dimensions.z; }
function valid(object: ScannedObjectPresentation) {
  return object.transform.length === 16 && object.transform.every(Number.isFinite) && Object.values(object.dimensions).every(value => Number.isFinite(value) && value > 0);
}

/** Suppress only a redundant render inside a larger low-confidence run detection. */
function containedUpper(small: ScannedObjectPresentation, large: ScannedObjectPresentation): boolean {
  if (small.id === large.id || small.role !== 'upper-cabinet' || large.role !== 'upper-cabinet' || large.confidence !== 'low') return false;
  if (!valid(small) || !valid(large) || volume(large) <= volume(small) * 1.03 || !aligned(small.transform, large.transform, 4)) return false;
  const inverse = new THREE.Matrix4().fromArray(large.transform).invert();
  const tolerance = 0.03;
  const inside = corners(small).filter(corner => {
    corner.applyMatrix4(inverse);
    return Math.abs(corner.x) <= large.dimensions.x / 2 + tolerance && Math.abs(corner.y) <= large.dimensions.y / 2 + tolerance && Math.abs(corner.z) <= large.dimensions.z / 2 + tolerance;
  }).length;
  return inside / 8 >= 0.95;
}

/** Features are opt-in visual interpretations, located using the captured support geometry. */
export function scannedObjectFeatures(input: ScannedObjectPresentation[], geometry: ScannedRoomGeometry, options: ScannedObjectFeatureOptions = {}): ScannedObjectFeatures {
  const objects = input.filter(object => !input.some(other => containedUpper(object, other)));
  const notices: string[] = [];
  const removed = input.length - objects.length;
  if (removed) notices.push(`${removed} overlapping upper-cabinet detection${removed === 1 ? ' is' : 's are'} represented within the larger captured cabinet run. Original scan evidence is retained.`);
  let sinkObjectId: string | null = null;
  let sinkCenterX: number | null = null;
  let microwave: ScannedObjectFeatures['microwave'] = null;
  // Measured contours/holes win over photo-assisted additions. Inserting a
  // rectangular sink into them would manufacture a new, unmeasured cutout.
  const usable = objects.filter(object => valid(object) && !object.countertopSurfaces?.length);

  if (options.sinkUnderWindow === true && !geometry.objects.some(object => object.kind.toLowerCase() === 'sink') && !objects.some(object => object.role === 'sink')) {
    const candidates: { objectId: string; centerX: number; score: number }[] = [];
    const windows = geometry.surfaces.filter(surface => surface.kind === 'window' && surface.transform.length === 16 && surface.transform.every(Number.isFinite) && surface.dimensions.x > 0 && surface.dimensions.y > 0);
    for (const cabinet of usable.filter(object => object.role === 'base-cabinet' && object.dimensions.x >= 0.5 && object.dimensions.y >= 0.55 && object.dimensions.z >= 0.45)) {
      const inverse = new THREE.Matrix4().fromArray(cabinet.transform).invert();
      const top = Math.max(...corners(cabinet).map(point => point.y));
      for (const window of windows) {
        if (Math.abs(axis(cabinet.transform, 8).dot(axis(window.transform, 8))) < Math.cos(THREE.MathUtils.degToRad(15))) continue;
        const frame = new THREE.Matrix4().fromArray(window.transform);
        const center = new THREE.Vector3().setFromMatrixPosition(frame).applyMatrix4(inverse);
        const sill = Math.min(...[-0.5, 0.5].map(x => new THREE.Vector3(x * window.dimensions.x, -window.dimensions.y / 2, 0).applyMatrix4(frame).y));
        const gap = sill - top;
        const windowX = [-0.5, 0.5].flatMap(x => [-0.5, 0.5].map(y => new THREE.Vector3(x * window.dimensions.x, y * window.dimensions.y, 0).applyMatrix4(frame).applyMatrix4(inverse).x));
        const overlap = Math.min(cabinet.dimensions.x / 2, Math.max(...windowX)) - Math.max(-cabinet.dimensions.x / 2, Math.min(...windowX));
        if (gap < -0.03 || gap > 0.4 || overlap < 0.35 - 1e-8 || Math.abs(center.z) > cabinet.dimensions.z / 2 + 0.25) continue;
        const sinkWidth = Math.min(0.72, cabinet.dimensions.x - 0.16);
        const maxCenter = Math.max(0, (cabinet.dimensions.x - sinkWidth) / 2 - 0.08);
        const centerX = THREE.MathUtils.clamp(center.x, -maxCenter, maxCenter);
        candidates.push({ objectId: cabinet.id, centerX, score: Math.abs(center.x) / cabinet.dimensions.x + Math.abs(center.x - centerX) + Math.abs(gap) * 0.5 + Math.abs(Math.abs(center.z) - cabinet.dimensions.z / 2) });
      }
    }
    candidates.sort((a, b) => a.score - b.score || a.objectId.localeCompare(b.objectId));
    if (candidates[0]) { sinkObjectId = candidates[0].objectId; sinkCenterX = candidates[0].centerX; }
    notices.push(sinkObjectId ? 'The photo-assisted sink preview uses the captured base cabinet beneath a measured window; the sink itself is not a LiDAR measurement.' : 'No captured base cabinet sits closely enough beneath a measured window for the sink preview.');
  }

  if (options.microwaveOverRange === true && !geometry.objects.some(object => object.kind.toLowerCase().replace(/[\s_-]/g, '') === 'microwave')) {
    const candidates: { objectId: string; centerX: number; width: number; score: number }[] = [];
    for (const cabinet of usable.filter(object => object.role === 'upper-cabinet' && object.dimensions.x >= 0.5 && object.dimensions.y >= 0.45 && object.dimensions.z >= 0.24)) {
      const inverse = new THREE.Matrix4().fromArray(cabinet.transform).invert();
      const bottom = Math.min(...corners(cabinet).map(point => point.y));
      for (const range of usable.filter(object => object.role === 'oven' || object.role === 'cooktop')) {
        if (!aligned(cabinet.transform, range.transform, 15)) continue;
        const center = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(range.transform)).applyMatrix4(inverse);
        const rangeCorners = corners(range);
        const gap = bottom - Math.max(...rangeCorners.map(point => point.y));
        if (gap < 0.2 || gap > 1.2) continue;
        const localCorners = rangeCorners.map(point => point.applyMatrix4(inverse));
        const rangeWidth = Math.max(...localCorners.map(point => point.x)) - Math.min(...localCorners.map(point => point.x));
        const minZ = Math.min(...localCorners.map(point => point.z)), maxZ = Math.max(...localCorners.map(point => point.z));
        if (minZ > cabinet.dimensions.z / 2 + 0.15 || maxZ < -cabinet.dimensions.z / 2 - 0.15) continue;
        const availableWidth = 2 * (cabinet.dimensions.x / 2 - Math.abs(center.x) - 0.03);
        const width = Math.min(0.85, range.dimensions.x, rangeWidth, availableWidth);
        if (width < 0.45) continue;
        candidates.push({ objectId: cabinet.id, centerX: center.x, width, score: gap + Math.abs(center.x) * 0.1 + (range.role === 'cooktop' ? 0 : 0.05) });
      }
    }
    candidates.sort((a, b) => a.score - b.score || a.objectId.localeCompare(b.objectId));
    const choice = candidates[0];
    if (choice) microwave = { objectId: choice.objectId, centerX: choice.centerX, width: choice.width };
    notices.push(microwave ? 'The photo-assisted microwave preview fits within the captured upper cabinet above the measured range; verify the appliance and clearances in the room.' : 'No captured upper cabinet provides enough measured space above the range for the microwave preview.');
  }
  return { objects, sinkObjectId, sinkCenterX, microwave, notices };
}
