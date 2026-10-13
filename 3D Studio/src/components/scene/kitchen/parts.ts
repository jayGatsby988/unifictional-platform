/**
 * The kitchen's part list — one flat, declarative description of everything the
 * twin draws.
 *
 * WHY A PART LIST AND NOT JSX
 *  - Draw calls are the budget that matters on a contractor's laptop, and you
 *    cannot count them from JSX. A part list can be measured headlessly
 *    (`budget.ts`), which is the only way to keep the 900-call / 1.2M-triangle
 *    promise honest as detail is added.
 *  - It lets `autoInstance()` collapse EVERY repeated piece in the room —
 *    pulls, hinges, shelf pins, screws, tile bullnose, stool stretchers — into
 *    one InstancedMesh each, automatically, without every builder having to
 *    think about it.
 *  - Builders stay pure functions of the layout, so they are trivially testable.
 *
 * FRAMES
 *  Parts are authored in the frame that makes them easy to write:
 *    'world'                 room coordinates (floor y = 0, origin at centre)
 *    'back' | 'left' | ...   wall-local: +x along the wall as seen from inside,
 *                            +z into the room, origin on the floor at the wall's
 *                            centre (exactly what <OnWall/> sets up)
 *    'island'               island-local: +x along its long axis, +z toward the
 *                            seating side's positive direction, origin on the
 *                            floor at the island's anchor
 *  The renderer groups by frame; the budget ignores frames entirely.
 *
 * NEVER MUTATE a geometry handed to a Part — they are shared cache entries.
 */
import * as THREE from 'three';
import type { Wall, MaterialSlotId } from '@/lib/spec/types';
import type { InstanceTransform } from '@/components/scene/detail';
import { triangleCount } from '@/components/scene/detail';
import type { utilMaterial } from '@/components/scene/materials';

export type Frame = 'world' | 'island' | Wall;
export type UtilKind = Parameters<typeof utilMaterial>[0];
export type Vec3 = [number, number, number];

/**
 * A procedural material RECIPE rather than a material: builders run headlessly
 * (the check script, the offscreen preview) and must not touch three's
 * material factory, so they describe the surface and `KitchenParts` resolves
 * it through `makeProceduralMaterial` on the client. `tint` is what the
 * software rasteriser paints it, and the base colour until the map arrives.
 */
export interface ProceduralPart {
  /** cache key — identical recipes share one GPU material */
  id: string;
  kind: 'wood' | 'fabric' | 'painted-wall';
  options: Record<string, unknown>;
  physical?: Partial<{ roughness: number; metalness: number; reliefStrength: number; normalScale: number; sheen: number; clearcoat: number; micro: 'paint' | 'stone' | 'wood' | 'metal' | 'ceramic' | 'fabric' | 'plaster' }>;
  tint: string;
}

/** A tinted metal (resolved through `tintedMetal` on the client) — black stainless, gloss black. */
export interface MetalLook { hex: string; roughness: number; metalness: number }

/**
 * How a FIXED-finish surface looks. An appliance whose own body finish differs
 * from the room's appliance finish (a matte-black hood over stainless) keeps
 * its `slot` so a click still opens the appliances line in the estimate, but
 * is drawn with this instead of the slot's material.
 */
export type Look = { util: UtilKind } | { metal: MetalLook };

export interface Part {
  key: string;
  frame: Frame;
  geometry: THREE.BufferGeometry;
  /** material slot (clickable + swappable). Exactly one of slot / util / materialId / procedural / metal —
   *  except a `slot` paired with a `util` or `metal`, which is a fixed-finish surface (see `Look`). */
  slot?: MaterialSlotId | string;
  util?: UtilKind;
  materialId?: string;
  procedural?: ProceduralPart;
  metal?: MetalLook;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3 | number;
  /** tiny trim: not pickable, does not join the outline pass */
  inert?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** pre-instanced by the builder (transforms are in the part's frame) */
  instances?: InstanceTransform[];
  /** opt out of auto-instancing (needed when the mesh must stay individually pickable) */
  solo?: boolean;
}

// ---------------------------------------------------------------------------
// Authoring helpers — keep the builders terse
// ---------------------------------------------------------------------------

export interface PartOpts {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3 | number;
  inert?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  instances?: InstanceTransform[];
  solo?: boolean;
}

/** A surface driven by a material slot — the user can click and re-material it. */
export function surface(key: string, frame: Frame, slot: MaterialSlotId | string, geometry: THREE.BufferGeometry, o: PartOpts = {}): Part {
  return { key, frame, slot, geometry, ...o };
}

/** A fixed prop (glass, stainless, plant…) that is not part of the estimate. */
export function prop(key: string, frame: Frame, util: UtilKind, geometry: THREE.BufferGeometry, o: PartOpts = {}): Part {
  return { key, frame, util, geometry, ...o };
}

/** A prop with a procedural surface (a rug's weave, a stained shelf, a canvas). */
export function textured(key: string, frame: Frame, procedural: ProceduralPart, geometry: THREE.BufferGeometry, o: PartOpts = {}): Part {
  return { key, frame, procedural, geometry, ...o };
}

/** A slot surface drawn in a fixed finish (see `Look`): still labelled, not re-materialled by the slot. */
export function finished(key: string, frame: Frame, slot: MaterialSlotId | string, look: Look, geometry: THREE.BufferGeometry, o: PartOpts = {}): Part {
  return 'util' in look
    ? { key, frame, slot, util: look.util, geometry, ...o }
    : { key, frame, slot, metal: look.metal, geometry, ...o };
}

/** Drop null / undefined and flatten, so builders can write `[cond && part]`. */
export function compact(list: Array<Part | Part[] | null | undefined | false>): Part[] {
  const out: Part[] = [];
  for (const p of list) {
    if (!p) continue;
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return out;
}

/** Move a whole sub-assembly. Used when a builder authors around its own origin. */
export function offsetParts(parts: Part[], dx: number, dy: number, dz: number, keyPrefix = ''): Part[] {
  return parts.map((p) => ({
    ...p,
    key: keyPrefix ? `${keyPrefix}${p.key}` : p.key,
    position: [(p.position?.[0] ?? 0) + dx, (p.position?.[1] ?? 0) + dy, (p.position?.[2] ?? 0) + dz],
    instances: p.instances?.map((t) => ({
      ...t,
      position: [(t.position?.[0] ?? 0) + dx, (t.position?.[1] ?? 0) + dy, (t.position?.[2] ?? 0) + dz] as Vec3,
    })),
  }));
}

/**
 * Bake a rotation about the frame's Y axis into a whole sub-assembly.
 *
 * The island's working side faces AWAY from the stools, so its millwork is
 * authored once facing +z and then turned. Composing the parent rotation
 * through a quaternion (rather than adding to the euler's Y) keeps hardware
 * that carries its own X or Z rotation — a vertical bar pull, a tilted
 * dispenser paddle — exactly where it belongs.
 */
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
export function rotateYParts(parts: Part[], angleY: number, keyPrefix = ''): Part[] {
  if (Math.abs(angleY) < 1e-9) return keyPrefix ? parts.map((p) => ({ ...p, key: keyPrefix + p.key })) : parts;
  _qp.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleY);
  const xf = (position?: Vec3, rotation?: Vec3): { position: Vec3; rotation: Vec3 } => {
    _v.set(position?.[0] ?? 0, position?.[1] ?? 0, position?.[2] ?? 0).applyQuaternion(_qp);
    _e.set(rotation?.[0] ?? 0, rotation?.[1] ?? 0, rotation?.[2] ?? 0, 'XYZ');
    _q.setFromEuler(_e).premultiply(_qp);
    _e.setFromQuaternion(_q, 'XYZ');
    return { position: [_v.x, _v.y, _v.z], rotation: [_e.x, _e.y, _e.z] };
  };
  return parts.map((p) => {
    const t = xf(p.position, p.rotation);
    return {
      ...p,
      key: keyPrefix ? keyPrefix + p.key : p.key,
      position: t.position,
      rotation: t.rotation,
      instances: p.instances?.map((i) => {
        const it = xf(i.position, i.rotation);
        return { ...i, position: it.position, rotation: it.rotation };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Auto-instancing
// ---------------------------------------------------------------------------

/** Parts sharing this signature are the same draw call if instanced. */
function signature(p: Part): string {
  return [
    p.frame,
    p.slot ?? '',
    p.util ?? '',
    p.materialId ?? '',
    p.procedural?.id ?? '',
    p.metal ? `${p.metal.hex}|${p.metal.roughness}|${p.metal.metalness}` : '',
    p.geometry.uuid,
    p.inert ? 1 : 0,
    p.castShadow === false ? 0 : 1,
    p.receiveShadow === false ? 0 : 1,
  ].join('|');
}

/**
 * Collapse every group of ≥ `threshold` identical-geometry parts into one
 * InstancedMesh. A kitchen has 40–90 pulls, 60–120 hinges and a few hundred
 * screws and shelf pins; without this they would be that many draw calls.
 *
 * Geometry identity is the cache identity — this only ever fires on geometries
 * that came back from a cached builder, which is exactly the intent.
 */
export function autoInstance(parts: Part[], threshold = 6): Part[] {
  const groups = new Map<string, Part[]>();
  const passthrough: Part[] = [];
  for (const p of parts) {
    if (p.solo || p.instances) { passthrough.push(p); continue; }
    const sig = signature(p);
    const g = groups.get(sig);
    if (g) g.push(p); else groups.set(sig, [p]);
  }
  const out: Part[] = passthrough;
  for (const group of groups.values()) {
    if (group.length < threshold) { out.push(...group); continue; }
    const first = group[0];
    out.push({
      key: `${first.key}×${group.length}`,
      frame: first.frame,
      geometry: first.geometry,
      slot: first.slot,
      util: first.util,
      materialId: first.materialId,
      procedural: first.procedural,
      metal: first.metal,
      inert: first.inert,
      castShadow: first.castShadow,
      receiveShadow: first.receiveShadow,
      instances: group.map((p) => ({ position: p.position, rotation: p.rotation, scale: p.scale })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export interface PartsCost {
  drawCalls: number;
  triangles: number;
  uniqueGeometries: number;
  parts: number;
  instanced: number;
}

export function costOf(parts: Part[]): PartsCost {
  const unique = new Set<string>();
  let drawCalls = 0, triangles = 0, instancedMeshes = 0;
  for (const p of parts) {
    const n = p.instances ? Math.max(1, p.instances.length) : 1;
    drawCalls += 1;
    if (p.instances) instancedMeshes += 1;
    triangles += triangleCount(p.geometry) * n;
    unique.add(p.geometry.uuid);
  }
  return { drawCalls, triangles: Math.round(triangles), uniqueGeometries: unique.size, parts: parts.length, instanced: instancedMeshes };
}
