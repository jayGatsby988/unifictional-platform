'use client';
/**
 * Exterior lighting: the shared sun/sky rig for the spec's time of day, warm
 * lantern sconces flanking the entry and over each garage bay, and in-grade
 * uplights washing the facade after dark.
 */
import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { ExteriorRig, kelvinToHex } from '@/components/scene/Lighting';
import { Prop, Surface } from '@/components/scene/Surface';
import { solid } from './helpers';
import { lanternBody, upLightUnit } from './detail-ext';
import type { ExteriorLayout, LSconce, LUpLight } from './layout';

const WARM = kelvinToHex(2700);

/** How hard the practicals push, given the sun. */
function practicalGain(timeOfDay: ExteriorLayout['timeOfDay']): number {
  switch (timeOfDay) {
    case 'noon': return 0.15;
    case 'morning': return 0.3;
    case 'golden-hour': return 0.65;
    default: return 1;
  }
}

function Sconce({ s, gain }: { s: LSconce; gain: number }) {
  const geo = useMemo(() => ({ body: lanternBody(), lens: solid(0.105, 0.2, 0.105) }), []);
  return (
    <group position={s.position} rotation={[0, s.yaw, 0]}>
      <Surface slot="gutters" inert geometry={geo.body} castShadow />
      <mesh geometry={geo.lens} position={[0, 0.025, 0.115]}>
        <meshStandardMaterial color="#fff1d4" emissive={WARM} emissiveIntensity={0.4 + gain * 3.4} toneMapped={false} transparent opacity={0.65} />
      </mesh>
      <pointLight position={[0, 0.025, 0.18]} intensity={gain * 7} color={WARM} distance={7} decay={2} />
    </group>
  );
}

function UpLight({ u, gain }: { u: LUpLight; gain: number }) {
  const ref = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(...u.target); return o; }, [u.target]);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.target = target;
    target.updateMatrixWorld();
  }, [target]);
  const geo = useMemo(() => upLightUnit(), []);
  return (
    <group>
      <Prop util="black-metal" geometry={geo} position={[u.position[0], 0, u.position[2]]} castShadow={false} />
      <primitive object={target} />
      <spotLight
        ref={ref}
        position={u.position}
        intensity={0.6 + gain * 10}
        color="#ffe6bd"
        angle={0.5}
        penumbra={0.75}
        distance={16}
        decay={2}
      />
    </group>
  );
}

export function ExteriorLighting({ L }: { L: ExteriorLayout }) {
  const gain = practicalGain(L.timeOfDay);
  // Size the sun's shadow frustum around the BUILDING. Spanning a 700 ft lot
  // would spread 4096 shadow texels over 200 m and turn every eave line to mush.
  const span = L.house
    ? Math.max(L.house.w, L.house.d, L.house.eaveY + L.house.roof.rise)
    : Math.max(L.buildable.maxX - L.buildable.minX, L.buildable.maxZ - L.buildable.minZ);
  const size = Math.min(120, Math.max(26, span * 2.6 + 12));
  return (
    <group name="exterior-lighting">
      <ExteriorRig timeOfDay={L.timeOfDay} size={size} />
      {L.sconces.map((s, i) => <Sconce key={`sconce-${i}`} s={s} gain={gain} />)}
      {L.landscapeLighting && L.upLights.map((u, i) => <UpLight key={`up-${i}`} u={u} gain={gain} />)}
    </group>
  );
}
