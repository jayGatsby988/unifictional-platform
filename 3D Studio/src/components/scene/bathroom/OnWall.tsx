'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import type { Wall } from '@/lib/spec/types';
import { onWall, wallFrame } from '@/components/scene/geometry';

/**
 * Group whose local frame sits on a room wall: +x runs along the wall
 * (left→right as seen from inside facing that wall), +z points into the room,
 * origin on the floor at fraction `t` along the wall (default: wall centre).
 */
export function OnWall({ wall, w, d, t = 0.5, insideOnly = false, children }: { wall: Wall; w: number; d: number; t?: number; insideOnly?: boolean; children?: React.ReactNode }) {
  const group = useRef<Group>(null);
  const eye = useMemo(() => new Vector3(), []);
  const { position, rotation } = useMemo(() => {
    const f = wallFrame(wall, w, d);
    return { position: onWall(wall, w, d, t, 0, 0), rotation: [0, f.yaw, 0] as [number, number, number] };
  }, [wall, w, d, t]);
  // The room shell is single-sided. Its mounted details must disappear with
  // the near wall in an orbit cutaway, instead of hanging across the interior.
  useFrame(({ camera }) => {
    if (!group.current) return;
    if (!insideOnly) { group.current.visible = true; return; }
    camera.getWorldPosition(eye);
    group.current.worldToLocal(eye);
    group.current.visible = eye.z >= -0.01;
  });
  return <group ref={group} position={position} rotation={rotation}>{children}</group>;
}
