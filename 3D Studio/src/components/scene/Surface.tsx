'use client';
/**
 * <Surface/> — a mesh whose material is driven by a material SLOT
 * (e.g. "countertop"). Handles hover/click → store, and registers itself for
 * the outline pass. Geometry must have world-space UVs (see geometry.ts).
 */
import * as THREE from 'three';
import type { AppearancePlane } from './ReconstructedAppearance';
import { forwardRef, useCallback, useEffect, useMemo } from 'react';
import { Select } from '@react-three/postprocessing';
import type { ThreeEvent } from '@react-three/fiber';
import { useSlotMaterial, useCatalogMaterial, utilMaterial } from './materials';
import { instanced, type InstanceTransform } from './detail';
import { useProjectStore } from '@/lib/store/project-store';
import type { MaterialSlotId } from '@/lib/spec/types';

type Vec3 = [number, number, number];

export interface SurfaceProps {
  slot: MaterialSlotId | string;
  geometry: THREE.BufferGeometry;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3 | number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** disable picking (e.g. tiny trim pieces) */
  inert?: boolean;
  /** override: use a fixed catalog material instead of the slot's selection */
  materialId?: string;
  /** override: a fixed util material */
  util?: Parameters<typeof utilMaterial>[0];
  /** A resolved fixed finish that retains this surface's picking/outline behavior. */
  materialOverride?: THREE.Material;
  /** Local captured object or wall used only to estimate its preview color. */
  appearanceId?: string;
  appearancePlane?: AppearancePlane;
  renderOrder?: number;
  name?: string;
  children?: React.ReactNode;
}

export const Surface = forwardRef<THREE.Mesh, SurfaceProps>(function Surface(
  { slot, geometry, position, rotation, scale, castShadow = true, receiveShadow = true, inert, materialId, util, materialOverride, appearanceId, appearancePlane, renderOrder, name, children }, ref,
) {
  const slotMat = useSlotMaterial(slot, Boolean(materialId || util || materialOverride), appearanceId, appearancePlane);
  const fixedMat = useCatalogMaterial(materialId ?? 'cab-pure-white');
  // Strict source/legacy previews remain neutral. The clean reconstruction
  // context permits representative utility details while labeling them inferred.
  const material = slotMat.userData.finishProvenance === 'neutral-geometry-preview' ? slotMat
    : materialOverride ?? (util ? utilMaterial(util) : materialId ? fixedMat : slotMat);
  const selectSlot = useProjectStore((s) => s.selectSlot);
  const setUI = useProjectStore((s) => s.setUI);
  const isSelected = useProjectStore((s) => s.ui.selectedSlot === slot);
  const isHovered = useProjectStore((s) => s.ui.hoveredSlot === slot);

  const onOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (inert) return;
    e.stopPropagation();
    setUI({ hoveredSlot: slot as MaterialSlotId });
    document.body.style.cursor = 'pointer';
  }, [inert, setUI, slot]);
  const onOut = useCallback(() => {
    if (inert) return;
    setUI({ hoveredSlot: null });
    document.body.style.cursor = 'auto';
  }, [inert, setUI]);
  const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (inert) return;
    e.stopPropagation();
    selectSlot(slot as MaterialSlotId);
  }, [inert, selectSlot, slot]);

  const mesh = (
    <mesh
      ref={ref}
      name={name ?? slot}
      geometry={geometry}
      material={material}
      position={position}
      rotation={rotation}
      scale={scale}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      renderOrder={renderOrder}
      onPointerOver={inert ? undefined : onOver}
      onPointerOut={inert ? undefined : onOut}
      onClick={inert ? undefined : onClick}
      userData={{ slot }}
    >
      {children}
    </mesh>
  );
  if (inert) return mesh;
  return <Select enabled={isSelected || isHovered}>{mesh}</Select>;
});

/** Plain prop mesh (not slot driven) with a util material */
export function Prop({ geometry, util, position, rotation, scale, castShadow = true, receiveShadow = true, renderOrder }: {
  geometry: THREE.BufferGeometry; util: Parameters<typeof utilMaterial>[0]; position?: Vec3; rotation?: Vec3; scale?: Vec3 | number; castShadow?: boolean; receiveShadow?: boolean; renderOrder?: number;
}) {
  const material = useMemo(() => utilMaterial(util), [util]);
  return <mesh geometry={geometry} material={material} position={position} rotation={rotation} scale={scale} castShadow={castShadow} receiveShadow={receiveShadow} renderOrder={renderOrder} />;
}

/**
 * Slot-driven InstancedMesh: 200 balusters, 60 shingles, 40 drawer pulls — one
 * draw call, still hoverable, still clickable, still re-materialled when the
 * user swaps that slot's finish.
 *
 * Use this for ANYTHING repeated more than ~8 times. The transforms are baked
 * once by `instanced()` in detail.ts; there is no per-frame work.
 */
export function InstancedSurface({
  slot, geometry, transforms, materialId, util, materialOverride, appearanceId, appearancePlane, inert, castShadow = true, receiveShadow = true, name,
}: {
  slot: MaterialSlotId | string;
  geometry: THREE.BufferGeometry;
  transforms: InstanceTransform[];
  materialId?: string;
  util?: Parameters<typeof utilMaterial>[0];
  materialOverride?: THREE.Material;
  /** Local captured object or wall used only to estimate its preview color. */
  appearanceId?: string;
  appearancePlane?: AppearancePlane;
  inert?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  name?: string;
}) {
  const slotMat = useSlotMaterial(slot, Boolean(materialId || util || materialOverride), appearanceId, appearancePlane);
  const fixedMat = useCatalogMaterial(materialId ?? 'cab-pure-white');
  const material = slotMat.userData.finishProvenance === 'neutral-geometry-preview' ? slotMat
    : materialOverride ?? (util ? utilMaterial(util) : materialId ? fixedMat : slotMat);
  const selectSlot = useProjectStore((s) => s.selectSlot);
  const setUI = useProjectStore((s) => s.setUI);
  const isSelected = useProjectStore((s) => s.ui.selectedSlot === slot);
  const isHovered = useProjectStore((s) => s.ui.hoveredSlot === slot);

  // Rebuilt when the material changes too: a finish swap is a user gesture that
  // happens a few times a minute, and rebaking a few hundred matrices there is
  // cheaper than the bookkeeping needed to mutate a shared InstancedMesh.
  const mesh = useMemo(() => {
    const im = instanced(geometry, material, transforms);
    im.castShadow = castShadow;
    im.receiveShadow = receiveShadow;
    im.name = name ?? `${slot}-instances`;
    im.userData.slot = slot;
    return im;
  }, [geometry, material, transforms, castShadow, receiveShadow, name, slot]);

  useEffect(() => {
    const held = mesh;
    return () => { held.dispose(); };
  }, [mesh]);

  const onOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (inert) return;
    e.stopPropagation();
    setUI({ hoveredSlot: slot as MaterialSlotId });
    document.body.style.cursor = 'pointer';
  }, [inert, setUI, slot]);
  const onOut = useCallback(() => {
    if (inert) return;
    setUI({ hoveredSlot: null });
    document.body.style.cursor = 'auto';
  }, [inert, setUI]);
  const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (inert) return;
    e.stopPropagation();
    selectSlot(slot as MaterialSlotId);
  }, [inert, selectSlot, slot]);

  const node = (
    <primitive
      object={mesh}
      onPointerOver={inert ? undefined : onOver}
      onPointerOut={inert ? undefined : onOut}
      onClick={inert ? undefined : onClick}
    />
  );
  if (inert) return node;
  return <Select enabled={isSelected || isHovered}>{node}</Select>;
}
