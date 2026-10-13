'use client';
/**
 * <FloorPlanScene spec={FloorPlanSpec}/> — the house.
 *
 * Renders three content only (no Canvas); the studio wraps it in
 * <SceneCanvas env="interior" rig={floorPlanRig(spec)}>.
 *
 * Everything the client asked for is here: the walls follow the sheet, the
 * rooms are empty rooms with floors, ceilings, base and cased openings, and
 * the stair actually climbs from one floor to the other. The rooms hold no
 * furniture on purpose — "the rooms should be empty but rooms and stairs shud
 * be there".
 *
 * One group per storey, and every storey's geometry is merged per SLOT, so a
 * two-storey house costs about twenty draw calls instead of a thousand.
 */
import { useEffect, useMemo } from 'react';
import type * as THREE from 'three';
import type { FloorPlanSpec } from '@/lib/spec/types';
import { Surface, InstancedSurface, Prop } from '@/components/scene/Surface';
import { InteriorKey, RecessedLight, WindowLight, useLightQuality } from '@/components/scene/Lighting';
import { useIsWalking } from '@/components/scene/SceneCanvas';
import { useProjectStore } from '@/lib/store/project-store';
import { computeFloorPlanLayout, visibleFloorPlanLevels, type FPLevel, type FloorPlanLayout } from './layout';
import { levelParts, type LevelParts } from './parts';

export { computeFloorPlanLayout } from './layout';
export type { FloorPlanLayout, FPLevel } from './layout';
export { floorPlanBudget } from './budget';

export function FloorPlanScene({ spec }: { spec: FloorPlanSpec }) {
  const L = useMemo(() => computeFloorPlanLayout(spec), [spec]);
  // The dollhouse orbit looks down into the house, so the top storey's ceiling
  // is drawn only when the camera is INSIDE it. Every lower ceiling stays: it
  // is the underside of the floor above, which a walk-through sees.
  const walking = useIsWalking();
  const selectedLevel = useProjectStore((s) => s.ui.floorPlanLevel);
  const visible = useMemo(() => visibleFloorPlanLevels(L, selectedLevel, walking), [L, selectedLevel, walking]);
  return (
    <group name="floorplan">
      {visible.map((level) => (
        <LevelShell key={level.index} level={level} ceiling={walking || (!level.isTop && level.index !== selectedLevel)} />
      ))}
      <FloorPlanLighting L={{ ...L, levels: visible }} />
    </group>
  );
}

function LevelShell({ level, ceiling }: { level: FPLevel; ceiling: boolean }) {
  const parts = useMemo(() => levelParts(level, { ceiling }), [level, ceiling]);
  useDisposal(parts);
  return (
    <group name={`level-${level.index}`}>
      {parts.walls && <Surface slot="walls" geometry={parts.walls} name={`walls-${level.index}`} />}
      {parts.floors.map((f) => (
        <Surface key={f.slot} slot={f.slot} geometry={f.geometry} castShadow={false} name={`${f.slot}-${level.index}`} />
      ))}
      {parts.ceiling && <Surface slot="ceiling" geometry={parts.ceiling} castShadow={false} name={`ceiling-${level.index}`} />}
      {parts.trim && <Surface slot="interior_trim" geometry={parts.trim} name={`trim-${level.index}`} />}
      {parts.doors && <Surface slot="interior_doors" geometry={parts.doors} name={`doors-${level.index}`} />}
      {parts.glass && <Prop util="glass" geometry={parts.glass} castShadow={false} />}
      {parts.treads && <Surface slot="stair_treads" geometry={parts.treads} name={`treads-${level.index}`} />}
      {parts.railing && <Surface slot="stair_railing" geometry={parts.railing} name={`railing-${level.index}`} />}
      {parts.balusters && (
        <InstancedSurface
          slot="stair_railing"
          geometry={parts.balusters.geometry}
          transforms={parts.balusters.transforms}
          name={`balusters-${level.index}`}
        />
      )}
    </group>
  );
}

/**
 * A house is rebuilt whenever the spec changes, and every merged buffer here
 * is a fresh allocation — without this the GPU keeps every version of the
 * house the user has ever edited.
 */
function useDisposal(parts: LevelParts) {
  useEffect(() => {
    const held: Array<THREE.BufferGeometry | null> = [
      parts.walls, parts.ceiling, parts.trim, parts.doors, parts.glass, parts.treads, parts.railing,
      ...parts.floors.map((f) => f.geometry),
    ];
    return () => { for (const g of held) g?.dispose(); };
  }, [parts]);
}

/**
 * Daylight plus practicals. One shadow-casting key for the whole house (a
 * shadow map per storey is a second full scene traversal for a house that is
 * lit by the same sun), a rect at the biggest windows, and a can over the
 * middle of the rooms that earn one.
 */
function FloorPlanLighting({ L }: { L: FloorPlanLayout }) {
  const quality = useLightQuality();
  const { w, d, h } = L.extentM;
  const span = Math.max(w, d);
  const cans = L.levels.flatMap((lv) => lv.lights.filter((x) => x.kind === 'can'));
  const windows = L.levels.flatMap((lv) => lv.lights.filter((x) => x.kind === 'window'));
  // performance tier drops the rects entirely and thins the practicals, the
  // same trade the single-room rigs make
  const perf = quality === 'performance';
  return (
    <group name="floorplan-lighting">
      <hemisphereLight args={['#cfe0ff', '#4a4136', 0.55]} position={[0, h * 1.2, 0]} />
      <InteriorKey
        from={[span * 0.8, h * 1.9, span * 0.7]}
        to={[0, h * 0.35, 0]}
        intensity={1.15}
        shadowSize={span * 1.5 + h}
        quality={quality}
        softness={1.2}
      />
      {!perf && windows.map((win, i) => (
        <WindowLight
          key={`w${i}`}
          position={win.position}
          rotation={win.rotation ?? [0, 0, 0]}
          width={win.widthM ?? 1}
          height={win.heightM ?? 1}
          intensity={1.2}
        />
      ))}
      {cans.slice(0, perf ? 6 : 12).map((can, i) => (
        <RecessedLight key={`c${i}`} position={can.position} intensity={4.5} colorTempK={3000} angle={0.95} castShadow={false} quality={quality} />
      ))}
    </group>
  );
}
