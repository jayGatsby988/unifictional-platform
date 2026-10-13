'use client';
import { useMemo } from 'react';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import type { ReconstructedMirror } from '@/lib/native/reconstructed-mirrors';
import type { ScannedRoomGeometry } from '@/lib/spec/types';
import { scannedWallInteriorSign } from './scanned-geometry';

function Mirror({ mirror, scan, reflect }: { mirror: ReconstructedMirror; scan: ScannedRoomGeometry; reflect: boolean }) {
  const matrix = useMemo(() => {
    const wall = scan.surfaces.find(s => s.id === mirror.wallId)!;
    const sign = scannedWallInteriorSign(wall, scan), t = mirror.transform;
    const result = new THREE.Matrix4().fromArray(t);
    result.setPosition(t[12] + t[8] * sign * .018, t[13] + t[9] * sign * .018, t[14] + t[10] * sign * .018);
    if (sign < 0) result.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    return result;
  }, [mirror, scan]);
  return <group name={mirror.id} matrix={matrix} matrixAutoUpdate={false} userData={{ source: mirror.source, confidence: mirror.confidence, extentVerified: false, evidenceFrames: mirror.evidenceFrames }}>
    <mesh name="inferred-mirror-backing" position={[0, 0, -.005]}>
      <boxGeometry args={[mirror.width + .012, mirror.height + .012, .008]} />
      <meshStandardMaterial color="#999d9c" roughness={.32} metalness={.7} />
    </mesh>
    <mesh name="reconstructed-mirror-glass">
      <planeGeometry args={[mirror.width, mirror.height]} />
      {reflect ? <MeshReflectorMaterial resolution={256} mirror={1} mixStrength={1} color="#ebeeee" roughness={.05} metalness={.05} />
        : <meshPhysicalMaterial color="#d4dbde" roughness={.05} metalness={1} />}
    </mesh>
  </group>;
}
/** Inferred surfaces are separate from immutable captured geometry and costs.
 * One small reflection buffer keeps the portrait mobile view usable. */
export function ReconstructedMirrors({ mirrors, scan }: { mirrors: ReconstructedMirror[]; scan: ScannedRoomGeometry }) {
  const largest = mirrors.reduce<ReconstructedMirror | null>((best, mirror) => !best || mirror.width * mirror.height > best.width * best.height ? mirror : best, null);
  return <group name="camera-inferred-mirrors">{mirrors.map(mirror => <Mirror key={mirror.id} mirror={mirror} scan={scan} reflect={mirror === largest} />)}</group>;
}
