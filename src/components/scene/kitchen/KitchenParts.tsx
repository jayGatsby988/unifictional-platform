'use client';
/**
 * Renderer for the kitchen's part list.
 *
 * The builders in this folder are pure functions of the layout that return
 * `Part[]` (see `parts.ts`); this component is the only place that turns them
 * into three.js objects. Parts are grouped by frame so a wall's contents live
 * under one `<OnWall/>` and the island's under one transform — which is also
 * what keeps the scene graph shallow enough for the picker to stay fast.
 */
import { useEffect, useMemo } from 'react';
import { Prop, Surface, InstancedSurface } from '@/components/scene/Surface';
import { OnWall } from '@/components/scene/bathroom/OnWall';
import { makeProceduralMaterial, tintedMetal } from '@/components/scene/materials';
import { instanced } from '@/components/scene/detail';
import type { MaterialSlotId, Wall } from '@/lib/spec/types';
import type { MetalLook, Part, ProceduralPart } from './parts';
import type { KitchenLayoutData } from './layout';

const WALLS: Wall[] = ['back', 'left', 'right', 'front'];

/**
 * A part carrying a procedural RECIPE (see `ProceduralPart`): the builders run
 * headlessly and cannot build materials, so the recipe is resolved here, once
 * per id, and the mesh is a plain prop — never pickable, never a slot.
 */
function ProceduralNode({ p, recipe }: { p: Part; recipe: ProceduralPart }) {
  const material = useMemo(
    () => makeProceduralMaterial(recipe.id, recipe.kind, recipe.options, { color: recipe.tint, ...recipe.physical }),
    [recipe],
  );
  const mesh = useMemo(() => {
    if (!p.instances) return null;
    const im = instanced(p.geometry, material, p.instances);
    im.castShadow = p.castShadow !== false;
    im.receiveShadow = p.receiveShadow !== false;
    im.name = p.key;
    return im;
  }, [p, material]);
  useEffect(() => {
    const held = mesh;
    return () => { held?.dispose(); };
  }, [mesh]);
  if (mesh) return <primitive object={mesh} />;
  return (
    <mesh
      name={p.key}
      geometry={p.geometry}
      material={material}
      position={p.position}
      rotation={p.rotation}
      scale={p.scale}
      castShadow={p.castShadow !== false}
      receiveShadow={p.receiveShadow !== false}
    />
  );
}

/** A fixed metal finish with the same picking and outline behavior as every surface. */
function MetalNode({ p, look }: { p: Part; look: MetalLook }) {
  const material = useMemo(() => tintedMetal(look.hex, look.roughness, look.metalness), [look.hex, look.roughness, look.metalness]);
  const slot = p.slot ?? '__prop__';
  const inert = !p.slot || p.inert;
  if (p.instances) return (
    <InstancedSurface
      name={p.key}
      slot={slot}
      geometry={p.geometry}
      materialOverride={material}
      transforms={p.instances}
      inert={inert}
      castShadow={p.castShadow !== false}
      receiveShadow={p.receiveShadow !== false}
    />
  );
  return (
    <Surface
      name={p.key}
      slot={slot}
      geometry={p.geometry}
      materialOverride={material}
      position={p.position}
      rotation={p.rotation}
      scale={p.scale}
      inert={inert}
      castShadow={p.castShadow !== false}
      receiveShadow={p.receiveShadow !== false}
    />
  );
}

function PartNode({ p }: { p: Part }) {
  const pickable = !!p.slot && !p.inert;
  if (p.procedural) return <ProceduralNode p={p} recipe={p.procedural} />;
  if (p.metal) return <MetalNode p={p} look={p.metal} />;
  if (p.instances) {
    return (
      <InstancedSurface
        slot={(p.slot ?? '__prop__') as MaterialSlotId | string}
        util={p.util}
        materialId={p.materialId}
        geometry={p.geometry}
        transforms={p.instances}
        inert={!pickable}
        castShadow={p.castShadow !== false}
        receiveShadow={p.receiveShadow !== false}
        name={p.key}
      />
    );
  }
  // a fixed-finish SURFACE (slot + util): drawn in the util, still clickable
  if (p.util && !p.slot) {
    return (
      <Prop
        util={p.util}
        geometry={p.geometry}
        position={p.position}
        rotation={p.rotation}
        scale={p.scale}
        castShadow={p.castShadow !== false}
        receiveShadow={p.receiveShadow !== false}
      />
    );
  }
  return (
    <Surface
      slot={(p.slot ?? 'walls') as MaterialSlotId | string}
      materialId={p.materialId}
      util={p.util}
      geometry={p.geometry}
      position={p.position}
      rotation={p.rotation}
      scale={p.scale}
      inert={p.inert}
      castShadow={p.castShadow !== false}
      receiveShadow={p.receiveShadow !== false}
      name={p.key}
    />
  );
}

export function KitchenParts({ L, parts }: { L: KitchenLayoutData; parts: Part[] }) {
  const byFrame = useMemo(() => {
    const map = new Map<Part['frame'], Part[]>();
    for (const p of parts) {
      const list = map.get(p.frame);
      if (list) list.push(p); else map.set(p.frame, [p]);
    }
    return map;
  }, [parts]);

  const isl = L.island;
  return (
    <>
      <group name="kitchen-world">
        {(byFrame.get('world') ?? []).map((p) => <PartNode key={p.key} p={p} />)}
      </group>
      {WALLS.map((wall) => {
        const list = byFrame.get(wall);
        if (!list || !list.length) return null;
        return (
          <OnWall key={wall} wall={wall} w={L.w} d={L.d}>
            {list.map((p) => <PartNode key={p.key} p={p} />)}
          </OnWall>
        );
      })}
      {isl && (byFrame.get('island')?.length ?? 0) > 0 && (
        <group name="kitchen-island" position={[isl.cx, 0, isl.cz]} rotation={[0, isl.yaw, 0]}>
          {byFrame.get('island')!.map((p) => <PartNode key={p.key} p={p} />)}
        </group>
      )}
    </>
  );
}
