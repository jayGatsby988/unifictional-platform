'use client';
import { useMemo } from 'react';
import { InteriorKey, WindowLight, type LightQuality } from './Lighting';
import { QUALITY } from './light-math';
import type { ScannedRoomGeometry } from '@/lib/spec/types';
import { scannedDaylightPlan } from './kitchen/scanned-daylight';

export function ScannedRoomLighting({ geometry, quality, naturalLight }: { geometry: ScannedRoomGeometry; quality: LightQuality; naturalLight: 'low' | 'medium' | 'high' }) {
  const plan = useMemo(() => scannedDaylightPlan(geometry), [geometry]);
  const strength = naturalLight === 'high' ? 1.25 : naturalLight === 'low' ? 0.75 : 1;
  return <group name="measured-room-lighting">
    <hemisphereLight intensity={0.38 * strength} color="#edf1f5" groundColor="#c4beb2" />
    <InteriorKey from={plan.keyFrom} to={plan.keyTo} shadowSize={plan.shadowSize} intensity={1.7 * strength} color="#fffaf2" quality={quality} softness={1.3} />
    {plan.windows.slice(0, QUALITY[quality].windowRects).map((window) => <WindowLight key={window.id} position={window.position} rotation={window.rotation} width={window.width} height={window.height} intensity={1.15 * strength} color="#edf2fa" />)}
    <InteriorKey from={plan.fillFrom} to={plan.fillTo} intensity={0.32 * strength} color="#fffaf2" castShadow={false} />
    {/* The shared key's real shadow map lands on measured floor geometry.
        No rectangular contact-shadow plane or unobserved ceiling fixtures. */}
  </group>;
}
