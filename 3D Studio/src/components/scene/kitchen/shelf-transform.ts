import { Euler, Quaternion, Vector3 } from 'three';
import { shelfFootprint, shelfPoint, type ShelfFrame } from '../shelf-frame';
import type { Part, Vec3 } from './parts';

/** Transform entire authored assemblies, including explicit instance transforms. */
export function orientShelfParts(s: ShelfFrame, parts: Part[]): Part[] {
  const { yaw } = shelfFootprint(s);
  if (!yaw) return parts;
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const position = (p: Vec3 = [0, 0, 0]): Vec3 => {
    const [x, z] = shelfPoint(s, p[0], p[2]);
    return [x, p[1], z];
  };
  const rotation = (r: Vec3 = [0, 0, 0]): Vec3 => {
    const q = new Quaternion().setFromEuler(new Euler(...r)).premultiply(turn);
    const e = new Euler().setFromQuaternion(q);
    return [e.x, e.y, e.z];
  };
  return parts.map((p) => p.instances ? { ...p, instances: p.instances.map((it) => ({ ...it, position: position(it.position), rotation: rotation(it.rotation) })) }
    : { ...p, position: position(p.position), rotation: rotation(p.rotation) });
}
