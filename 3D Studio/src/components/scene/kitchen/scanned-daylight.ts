import * as THREE from 'three';
import type { ScannedRoomGeometry } from '@/lib/spec/types';
import { openingOnScannedWall, scannedWallInteriorSign } from '../scanned-geometry';
import { scannedRoomRig } from '../scanned-camera';

type Vec3 = [number, number, number];
export interface ScannedDaylightWindow {
  id: string;
  center: Vec3;
  position: Vec3;
  rotation: Vec3;
  inward: Vec3;
  width: number;
  height: number;
}
export interface ScannedDaylightPlan {
  windows: ScannedDaylightWindow[];
  keyFrom: Vec3;
  keyTo: Vec3;
  fillFrom: Vec3;
  fillTo: Vec3;
  shadowSize: number;
}

/** Source geometry stays untouched; only the presentation lights are derived. */
export function scannedDaylightPlan(scan: ScannedRoomGeometry): ScannedDaylightPlan {
  const rig = scannedRoomRig(scan);
  const { min, max } = rig.fitBounds!;
  const center = new THREE.Vector3(...rig.target);
  const span = Math.max(1, max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const walls = scan.surfaces.filter((surface) => surface.kind === 'wall');
  const windows = scan.surfaces.filter((surface) => surface.kind === 'window' && surface.dimensions.x > 0.05 && surface.dimensions.y > 0.05).map((window): ScannedDaylightWindow => {
    const matrix = new THREE.Matrix4().fromArray(window.transform);
    const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
    const normal = new THREE.Vector3().setFromMatrixColumn(matrix, 2).normalize();
    const wall = walls.find((candidate) => openingOnScannedWall(candidate, window));
    let sign: number;
    if (wall) {
      const wallNormal = new THREE.Vector3(wall.transform[8], wall.transform[9], wall.transform[10]);
      sign = scannedWallInteriorSign(wall, scan) * (wallNormal.dot(normal) < 0 ? -1 : 1);
    } else {
      // A partial capture can contain a window before its supporting wall.
      // Keep its exact frame and choose the side facing the measured content.
      sign = normal.dot(center.clone().sub(origin)) >= 0 ? 1 : -1;
    }
    const inward = normal.multiplyScalar(sign);
    const rotationMatrix = new THREE.Matrix4().extractRotation(matrix);
    // RectAreaLight emits along -Z. Flip its LOCAL frame when the captured
    // window's +Z points inside; retain the measured tilt and roll either way.
    if (sign > 0) rotationMatrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    const rotation = new THREE.Euler().setFromRotationMatrix(rotationMatrix);
    return {
      id: window.id,
      center: origin.toArray(),
      position: origin.clone().addScaledVector(inward, 0.04).toArray(),
      rotation: [rotation.x, rotation.y, rotation.z],
      inward: inward.toArray(),
      width: window.dimensions.x,
      height: window.dimensions.y,
    };
  }).sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id));
  const reach = span * 0.65 + 1;
  const direction = new THREE.Vector3(...rig.position).sub(center).setY(0).normalize();
  const target = new THREE.Vector3(center.x, min[1] + Math.min(1, (max[1] - min[1]) * 0.38), center.z);
  let keyFrom = target.clone().addScaledVector(direction, reach).setY(max[1] + span * 0.35);
  let keyTo = target.clone();
  const main = windows[0];
  if (main) {
    const origin = new THREE.Vector3(...main.center);
    const inward = new THREE.Vector3(...main.inward);
    keyTo = origin.clone().addScaledVector(inward, reach);
    keyTo.y = Math.min(target.y, Math.max(min[1] + 0.02, origin.y - 0.2));
    // The key ray passes through the measured window center, rather than
    // pretending a concave or rotated room has a window on its bounding box.
    keyFrom = origin.clone().multiplyScalar(2).sub(keyTo);
  }
  return {
    windows,
    keyFrom: keyFrom.toArray(),
    keyTo: keyTo.toArray(),
    fillFrom: target.clone().addScaledVector(direction, reach * 0.8).setY(max[1] + 0.4).toArray(),
    fillTo: target.toArray(),
    shadowSize: span * 1.65,
  };
}
