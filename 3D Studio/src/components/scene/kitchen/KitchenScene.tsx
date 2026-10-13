'use client';
/**
 * <KitchenScene spec={KitchenSpec}/> — the procedural kitchen twin.
 * Renders three.js content only (no Canvas); the Studio wraps it in
 * <SceneCanvas env="interior" rig={kitchenRig(spec)}>.
 *
 * The geometry itself is built by the pure builders in this folder
 * (`build.ts` → `parts.ts`) and rendered by <KitchenParts/>, so the same list
 * the browser draws is the one `npx tsx scripts/check-kitchen.ts` measures.
 */
import { useMemo } from 'react';
import type { KitchenSpec } from '@/lib/spec/types';
import { interiorRig, type CameraRig } from '@/components/scene/SceneCanvas';
import { computeKitchenLayout } from './layout';
import { buildKitchenParts } from './build';
import { KitchenParts } from './KitchenParts';
import { KitchenLighting } from './KitchenLighting';
import { ScannedRoomShell } from '../ScannedRoomShell';
import { scannedRoomRig } from '../scanned-camera';
import { useScanView } from '../scan-view-store';

export { kitchenSummary } from './summary';
export { computeKitchenLayout } from './layout';
export type { KitchenLayoutData } from './layout';

export function KitchenScene({ spec }: { spec: KitchenSpec }) {
  const source = useScanView(s => s.mode === 'source');
  const L = useMemo(() => computeKitchenLayout(spec), [spec]);
  const parts = useMemo(() => buildKitchenParts(L), [L]);
  return (
    <group name="kitchen">
      {spec.scanGeometry && <ScannedRoomShell geometry={spec.scanGeometry} roomType="kitchen" />}
      {(!spec.scanGeometry || !source) && <KitchenParts L={L} parts={parts} />}
      <KitchenLighting L={L} />
    </group>
  );
}

/**
 * Camera rig for the kitchen: an orbit view sized to the room, aimed along the
 * axis the analyzer said the photo was looking down. Tolerates a null spec.
 */
export function kitchenRig(spec: KitchenSpec | null | undefined): CameraRig {
  if (spec?.scanGeometry) return scannedRoomRig(spec.scanGeometry);
  const dims = spec && typeof spec === 'object' ? spec.dims : null;
  const widthFt = typeof dims?.widthFt === 'number' && Number.isFinite(dims.widthFt) ? Math.min(Math.max(dims.widthFt, 5), 60) : 14;
  const depthFt = typeof dims?.depthFt === 'number' && Number.isFinite(dims.depthFt) ? Math.min(Math.max(dims.depthFt, 5), 60) : 12;
  const ceilingFt = typeof dims?.ceilingFt === 'number' && Number.isFinite(dims.ceilingFt) ? Math.min(Math.max(dims.ceilingFt, 7), 20) : 9;
  const looking = spec?.detected?.camera?.lookingAt;
  const lookAt: 'back' | 'left' | 'right' = looking === 'left' || looking === 'right' ? looking : 'back';
  return interiorRig(widthFt, depthFt, ceilingFt, { lookAt });
}
