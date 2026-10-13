'use client';
/**
 * <BathroomScene spec={BathroomSpec}/> — procedural bathroom twin.
 * Renders three.js content only (no Canvas); the Studio wraps it in
 * <SceneCanvas env="interior" rig={bathroomRig(spec)}>.
 */
import { useMemo } from 'react';
import type { BathroomSpec } from '@/lib/spec/types';
import { interiorRig, type CameraRig } from '@/components/scene/SceneCanvas';
import { computeBathroomLayout } from './layout';
import { RoomShell } from './RoomShell';
import { Vanity } from './Vanity';
import { Shower } from './Shower';
import { Tub } from './Tub';
import { Toilet } from './Toilet';
import { Accessories } from './Accessories';
import { Decor } from './Decor';
import { BathLighting } from './BathLighting';
import { ScannedRoomShell } from '../ScannedRoomShell';
import { scannedRoomRig } from '../scanned-camera';
import { useScanView } from '../scan-view-store';
import { ScannedRoomLighting } from '../ScannedRoomLighting';
import { useLightQuality } from '../Lighting';

export { bathroomSummary } from './summary';
export { computeBathroomLayout } from './layout';
export type { BathLayout, DecorWarning, LDecor } from './layout';

export function BathroomScene({ spec }: { spec: BathroomSpec }) {
  const source = useScanView(s => s.mode === 'source');
  const quality = useLightQuality();
  const L = useMemo(() => computeBathroomLayout(spec), [spec]);
  return (
    <group name="bathroom">
      {spec.scanGeometry ? <ScannedRoomShell geometry={spec.scanGeometry} roomType="bathroom" /> : <RoomShell L={L} />}
      {(!spec.scanGeometry || !source) && <group name="bathroom-design-additions">
      {L.vanity && <Vanity L={L} v={L.vanity} />}
      {L.shower && <Shower L={L} s={L.shower} />}
      {L.tub && <Tub L={L} tub={L.tub} />}
      {L.toilet && <Toilet L={L} t={L.toilet} />}
      <Accessories L={L} measuredRoom={Boolean(spec.scanGeometry)} />
      <Decor L={L} />
      </group>}
      {spec.scanGeometry ? <ScannedRoomLighting geometry={spec.scanGeometry} quality={quality} naturalLight={L.lighting.naturalLight} /> : <BathLighting L={L} />}
    </group>
  );
}

/** Camera rig looking toward the vanity wall (the hero of most bathrooms). */
export function bathroomRig(spec: BathroomSpec | null | undefined): CameraRig {
  if (spec?.scanGeometry) return scannedRoomRig(spec.scanGeometry);
  const L = computeBathroomLayout(spec);
  const lookAt = L.vanity?.wall ?? L.shower?.wall ?? 'back';
  const rig = interiorRig(L.widthFt, L.depthFt, L.ceilingFt, { lookAt: lookAt === 'front' ? 'back' : lookAt });
  if (lookAt === 'front') {
    // mirror the default (front-looking-back) view through the room centre so the camera faces the front wall
    rig.position = [-rig.position[0], rig.position[1], -rig.position[2]];
    rig.target = [rig.target[0], rig.target[1], -rig.target[2]];
  }
  return rig;
}
