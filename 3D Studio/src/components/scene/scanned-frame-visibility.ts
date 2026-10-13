import type { ScannedElement, ScannedRoomGeometry } from '@/lib/spec/types';
import { openingOnScannedWall, scannedWallInteriorSign } from './scanned-geometry';

/** Windows remain architectural landmarks when the near wall is cut away in
 * the clean model. Source fallback retains its existing measured-wall policy. */
export function scannedOpeningCutawaySign(opening: ScannedElement, walls: ScannedElement[], scan: ScannedRoomGeometry, source: boolean): 1 | -1 | undefined {
  if (!source && opening.kind === 'window') return undefined;
  const wall = walls.find(candidate => openingOnScannedWall(candidate, opening));
  if (!wall) return undefined;
  const dot = wall.transform[8] * opening.transform[8] + wall.transform[9] * opening.transform[9] + wall.transform[10] * opening.transform[10];
  return (scannedWallInteriorSign(wall, scan) * (dot < 0 ? -1 : 1)) as 1 | -1;
}

/** Recompute even after cutaway is disabled: an existing hidden group must
 * become visible again when reused for a clean opening or uncropped source. */
export function measuredFrameVisible(localEyeZ: number, interiorSign?: 1 | -1): boolean {
  return interiorSign === undefined || localEyeZ * interiorSign >= -0.01;
}
