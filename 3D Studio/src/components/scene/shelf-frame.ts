/** Quarter-turn case orientation in its mounting wall's local XZ frame. */
export type ShelfRotation = -90 | 0 | 90 | 180;

export interface ShelfFrame {
  x: number;
  width: number;
  depth: number;
  standoff?: number;
  enclosure: { rotationDeg?: number | null } | null;
}

export function shelfRotation(value: unknown): ShelfRotation {
  return value === -90 || value === 90 || value === 180 ? value : 0;
}

/** A quarter turn exchanges the along-wall and into-room dimensions. */
export function shelfFootprint(s: Pick<ShelfFrame, 'width' | 'depth' | 'enclosure'>) {
  const rotationDeg = shelfRotation(s.enclosure?.rotationDeg);
  const quarter = Math.abs(rotationDeg) === 90;
  return { span: quarter ? s.depth : s.width, projection: quarter ? s.width : s.depth, rotationDeg, yaw: rotationDeg * Math.PI / 180 };
}

/** Rotate about the case centre, then keep its rearmost edge on the finished wall. */
export function shelfPoint(s: ShelfFrame, x: number, z: number, inverse = false): [number, number] {
  const { rotationDeg, projection } = shelfFootprint(s);
  const c = rotationDeg === 180 ? -1 : rotationDeg === 0 ? 1 : 0;
  const sin = rotationDeg === 90 ? 1 : rotationDeg === -90 ? -1 : 0;
  const oldZ = (s.standoff ?? 0) + s.depth / 2;
  const newZ = (s.standoff ?? 0) + projection / 2;
  const dx = x - s.x, dz = z - (inverse ? newZ : oldZ);
  return inverse ? [s.x + c * dx - sin * dz, oldZ + sin * dx + c * dz]
    : [s.x + c * dx + sin * dz, newZ - sin * dx + c * dz];
}
