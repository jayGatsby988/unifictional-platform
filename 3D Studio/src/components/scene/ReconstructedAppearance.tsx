'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { capturedAppearanceMaterial, projectedScanMaterial, type CapturedFaceAtlas } from './projected-scan-material';
import type { ObservedMesh } from '@/lib/native/mesh-archive';
import type { ScanTexture } from '@/lib/native/texture-archive';
import type { ScanPlaneTexture, ScanPlaneTexturePlane } from '@/lib/native/plane-texture-archive';
import { deriveReconstructedAppearance, type ReconstructedAppearance, type ReconstructedColor } from '@/lib/native/reconstructed-appearance';
import { deriveReconstructedFloor, type ReconstructedFloor } from '@/lib/native/reconstructed-floor';
import { fillReconstructedAppearance } from '@/lib/native/reconstructed-appearance-fill';
import { deriveReconstructedFloorFinish } from '@/lib/native/reconstructed-floor-finish';
import { neutralScanColor } from '@/lib/native/scan-finishes';
import { objectTextureSourceFor, useObjectAppearance } from '@/lib/native/object-appearance-store';
import { scannedObjectLayout, type ScannedObjectPresentation } from './scanned-object-layout';
import { deriveReconstructedObjectTexture, type ReconstructedObjectTextureSource } from '@/lib/native/reconstructed-object-texture';
import type { ScannedElement, ScannedRoomGeometry } from '@/lib/spec/types';
import { deriveCleanFaceFinish } from '@/lib/native/clean-face-finish';
import { countertopAppearanceFaces } from '@/lib/native/countertop-appearance';
import { CAPTURED_FURNITURE_SLOT } from '@/lib/native/captured-furniture';

export interface AppearancePlane {
  objectId: string; slot: string; origin: [number, number, number]; u: [number, number, number]; v: [number, number, number];
  spanMeters: [number, number]; maxPlaneDistance?: number; sourceTriangleIndices?: Uint32Array;
  orientation?: CapturedFaceAtlas['orientation'];
}

type FloorPatch = Extract<ReconstructedFloor, { status: 'supported' }>;
type AppearanceContext = {
  evidence: ReconstructedAppearance;
  source: ReconstructedObjectTextureSource | null;
  objects: Map<string, ScannedObjectPresentation>;
  projected: Map<string | AppearancePlane, THREE.MeshPhysicalMaterial | null>;
  faceColors: Map<string, number[][]>;
  floors: Map<string, FloorPatch>;
  materials: Map<ReconstructedColor | FloorPatch | string, THREE.MeshPhysicalMaterial>;
  textures: Set<THREE.DataTexture>;
  measuredPlanes: ScanPlaneTexturePlane[];
};
const Context = createContext<AppearanceContext | null>(null);
const evidenceCache = new WeakMap<ObservedMesh, WeakMap<ScannedRoomGeometry, Map<string, ReconstructedAppearance>>>();
const floorCache = new WeakMap<ObservedMesh, WeakMap<ScanTexture, WeakMap<ReconstructedAppearance, Map<ScannedElement, { plane: ScanPlaneTexturePlane | undefined; value: ReconstructedFloor }>>>>();
function appearanceFor(mesh: ObservedMesh, scan: ScannedRoomGeometry, roomType: 'kitchen' | 'bathroom'): ReconstructedAppearance {
  let scans = evidenceCache.get(mesh);
  if (!scans) { scans = new WeakMap(); evidenceCache.set(mesh, scans); }
  let rooms = scans.get(scan);
  if (!rooms) { rooms = new Map(); scans.set(scan, rooms); }
  let evidence = rooms.get(roomType);
  if (!evidence) { evidence = deriveReconstructedAppearance(mesh, scan, roomType); rooms.set(roomType, evidence); }
  return evidence;
}
function floorFor(mesh: ObservedMesh, texture: ScanTexture, floor: ScannedElement, evidence: ReconstructedAppearance, plane: ScanPlaneTexturePlane | undefined): ReconstructedFloor {
  let textures = floorCache.get(mesh);
  if (!textures) { textures = new WeakMap(); floorCache.set(mesh, textures); }
  let appearances = textures.get(texture);
  if (!appearances) { appearances = new WeakMap(); textures.set(texture, appearances); }
  let floors = appearances.get(evidence);
  if (!floors) { floors = new Map(); appearances.set(evidence, floors); }
  let entry = floors.get(floor);
  if (!entry || entry.plane !== plane) {
    entry = { plane, value: deriveReconstructedFloor(mesh, texture, floor, evidence.surfaces[floor.id], plane) };
    floors.set(floor, entry);
  }
  return entry.value;
}

/** Display-only reconstruction. No catalog IDs, prices or source coordinates
 * are changed when camera evidence arrives or a view is switched. */
export function ReconstructedAppearanceProvider({ mesh, texture = null, planeTexture = null, scan, roomType, children }: {
  mesh: ObservedMesh | null; texture?: ScanTexture | null; planeTexture?: ScanPlaneTexture | null; scan: ScannedRoomGeometry; roomType: 'kitchen' | 'bathroom'; children: ReactNode;
}) {
  const refinedSource = useObjectAppearance(s => s.mesh === mesh && s.texture === texture && s.scan === scan ? s.source : null);
  const value = useMemo<AppearanceContext>(() => {
    const evidence = mesh ? appearanceFor(mesh, scan, roomType) : { slots: {}, objects: {}, surfaces: {} };
    const floors = new Map<string, FloorPatch>();
    if (mesh && texture) for (const floor of scan.surfaces) if (floor.kind === 'floor') {
      const patch = floorFor(mesh, texture, floor, evidence, planeTexture?.planes.find(plane => plane.id === floor.id && plane.kind === 'floor'));
      if (patch.status === 'supported') floors.set(floor.id, patch);
    }
    return { evidence, floors, source: mesh && texture ? refinedSource ?? objectTextureSourceFor(mesh, texture, scan, roomType) : null,
      objects: new Map(scannedObjectLayout(scan, roomType).objects.map(object => [object.id, object])), projected: new Map(), faceColors: new Map(), materials: new Map(), textures: new Set(), measuredPlanes: planeTexture?.planes ?? [] };
  }, [mesh, texture, planeTexture, scan, roomType, refinedSource]);
  useEffect(() => () => {
    value.materials.forEach(material => material.dispose());
    value.projected.forEach(material => material?.dispose());
    value.textures.forEach(texture => texture.dispose());
  }, [value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Separate UV channel for the observed atlas: catalog finishes must retain
 * the original meter-based UVs when the contractor changes the flooring. */
export function useReconstructedFloorPatch(appearanceId: string): FloorPatch | null {
  return useContext(Context)?.floors.get(appearanceId) ?? null;
}

/** Separate face evidence prevents a front-only photo from repainting a mixed island. */
export function useReconstructedObjectFaceColors(slot: string, appearanceId: string | undefined, enabled: boolean): number[][] | undefined {
  const context = useContext(Context);
  if (!enabled || !context?.source || !appearanceId) return undefined;
  const key = `${appearanceId}/${slot}`;
  if (!context.faceColors.has(key)) {
    const object = context.objects.get(appearanceId);
    const colors = (object ? objectFacePlanes(object, slot) : []).flatMap(plane => {
      const face = deriveReconstructedObjectTexture(context.source!, plane);
      if (face.status !== 'supported') return [];
      const clean = deriveCleanFaceFinish({ ...face, slot });
      return clean.status === 'supported' ? [clean.cleanColorSRGB] : [];
    });
    context.faceColors.set(key, colors);
  }
  return context.faceColors.get(key);
}

export function useReconstructedMaterial(slot: string, appearanceId?: string, plane?: AppearancePlane): THREE.MeshPhysicalMaterial | null {
  const context = useContext(Context);
  if (!context) return null;
  if (appearanceId && /^(countertop|island_countertop|vanity_top)$/.test(slot)) {
    const key = plane ?? `measured/${appearanceId}/${slot}`;
    if (!context.projected.has(key)) {
      const faces = countertopAppearanceFaces(context.measuredPlanes, appearanceId, plane);
      if (faces.length) {
        const { material, texture } = projectedScanMaterial(faces, new THREE.Color(neutralScanColor(slot)), slot);
        material.name = 'scan-measured-countertop-finishes';
        material.userData.cameraProjection = 'depth-checked-measured-countertop';
        context.projected.set(key, material); context.textures.add(texture);
      } else if (!plane) context.projected.set(key, null);
    }
    const measured = context.projected.get(key);
    if (measured) return measured;
  }
  if (context.source && appearanceId && (slot === CAPTURED_FURNITURE_SLOT || /^(cabinets_(base|upper|tall)|island_cabinets|countertop|island_countertop|vanity_cabinet|vanity_top|appliances)$/.test(slot))) {
    const key = plane ?? `${appearanceId}/${slot}`;
    if (!context.projected.has(key)) {
      const object = context.objects.get(appearanceId);
      const planes = plane ? [plane] : object ? objectFacePlanes(object, slot) : [];
      const observed = planes.map(face => deriveReconstructedObjectTexture(context.source!, face));
      if (observed.some(face => face.status === 'supported')) {
        const faces: CapturedFaceAtlas[] = observed.map((face, i) => face.status === 'supported' ? { ...face, orientation: planes[i].orientation } : { ...planes[i], width: 8, height: 8, rgba: new Uint8Array(256), fillColorLinear: null, coverageFraction: 0, evidenceFailure: face.reason });
        const { material, texture } = projectedScanMaterial(faces, new THREE.Color(neutralScanColor(slot)), slot, object ? { objectId: object.id, role: object.role } : undefined);
        context.projected.set(key, material); context.textures.add(texture);
      } else context.projected.set(key, null);
    }
    const material = context.projected.get(key);
    if (material) return material;
  }
  const patch = appearanceId && (slot === 'flooring' || slot === 'floor_tile') ? context.floors.get(appearanceId) : undefined;
  if (patch) {
    let material = context.materials.get(patch);
    if (!material) {
      const clean = deriveReconstructedFloorFinish(patch);
      const map = new THREE.DataTexture(clean?.rgba ?? filledFloorPixels(patch), clean?.width ?? patch.width, clean?.height ?? patch.height, THREE.RGBAFormat);
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false; map.channel = 1;
      map.wrapS = map.wrapT = clean ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      if (clean) {
        // uv1 is in the captured floor frame. The inferred grain can have a
        // different direction; rotate its display texture without moving the
        // floor, atlas, catalog UVs, or saved scan frame.
        const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0);
        const offset = patch.origin.map((n, i) => n - clean.origin[i]);
        map.matrixAutoUpdate = false;
        map.matrix.set(
          dot(patch.u, clean.u) * patch.spanMeters[0] / clean.repeatMeters[0], dot(patch.v, clean.u) * patch.spanMeters[1] / clean.repeatMeters[0], dot(offset, clean.u) / clean.repeatMeters[0],
          dot(patch.u, clean.v) * patch.spanMeters[0] / clean.repeatMeters[1], dot(patch.v, clean.v) * patch.spanMeters[1] / clean.repeatMeters[1], dot(offset, clean.v) / clean.repeatMeters[1],
          0, 0, 1,
        );
      }
      map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
      map.generateMipmaps = true; map.needsUpdate = true;
      material = capturedAppearanceMaterial(new THREE.Color('#ffffff'), map, true);
      material.name = clean ? 'scan-clean-floor-finish' : 'scan-world-registered-floor';
      material.userData = { finishProvenance: clean?.source ?? 'observed-floor-atlas', layout: clean ? 'estimated-pattern-in-captured-frame' : 'world-registered', confidence: 'low', coverageFraction: patch.coverageFraction, estimatedFillRequired: true,
        ...(clean ? { appearance: clean.appearance, pattern: clean.pattern, jointSpacingMeters: clean.jointSpacingMeters, colorSRGB: clean.colorSRGB } : {}) };
      context.materials.set(patch, material); context.textures.add(map);
    }
    return material;
  }
  const evidence = plane ? undefined : appearanceId
    ? context.evidence.objects[appearanceId]?.[slot] ?? context.evidence.surfaces[appearanceId]
    : context.evidence.slots[slot];
  // An unknown local surface must not borrow another object's finish.
  const supported = evidence?.status === 'supported' && evidence.colorLinear;
  const key = supported ? evidence : neutralScanColor(slot);
  let material = context.materials.get(key);
  if (!material) {
    material = supported
      ? capturedAppearanceMaterial(new THREE.Color().setRGB(...supported, THREE.LinearSRGBColorSpace))
      : new THREE.MeshPhysicalMaterial({ color: neutralScanColor(slot), roughness: .65, metalness: 0, reflectivity: .15, side: THREE.DoubleSide });
    material.name = supported ? 'scan-estimated-finish' : 'scan-reconstruction-unknown-finish';
    material.userData = { finishProvenance: supported ? 'camera-sampled-inference' : 'reconstruction-unknown', confidence: evidence?.confidence ?? 'low' };
    context.materials.set(key, material);
  }
  return material;
}

function filledFloorPixels(floor: FloorPatch): Uint8Array {
  return fillReconstructedAppearance({ rgba: floor.rgba, width: floor.width, height: floor.height,
    spanMeters: floor.spanMeters, fillColorSRGB: floor.fillColorSRGB }).rgba;
}

/** Bounding-box directions only select where camera evidence may be projected.
 * They do not create or move object geometry. Derived island panels supply
 * their own measured plane frames instead. */
function objectFacePlanes(object: ScannedObjectPresentation, slot: string): AppearancePlane[] {
  type Vec = [number, number, number];
  const t = object.transform, w = object.dimensions.x, h = object.dimensions.y, d = object.dimensions.z;
  const point = ([x, y, z]: Vec): Vec => [t[0] * x + t[4] * y + t[8] * z + t[12], t[1] * x + t[5] * y + t[9] * z + t[13], t[2] * x + t[6] * y + t[10] * z + t[14]];
  const axis = ([x, y, z]: Vec): Vec => [t[0] * x + t[4] * y + t[8] * z, t[1] * x + t[5] * y + t[9] * z, t[2] * x + t[6] * y + t[10] * z];
  const plane = (origin: Vec, u: Vec, v: Vec, spanMeters: [number, number], orientation?: AppearancePlane['orientation']): AppearancePlane => ({ objectId: object.id, slot, origin: point(origin), u: axis(u), v: axis(v), spanMeters, maxPlaneDistance: .1, orientation });
  if (slot === 'countertop' || slot === 'island_countertop' || slot === 'vanity_top') return [plane([-w / 2, h / 2, -d / 2], [1, 0, 0], [0, 0, 1], [w, d])];
  return [
    plane([-w / 2, -h / 2, d / 2], [1, 0, 0], [0, 1, 0], [w, h], 'front'),
    plane([w / 2, -h / 2, -d / 2], [-1, 0, 0], [0, 1, 0], [w, h], 'back'),
    plane([w / 2, -h / 2, d / 2], [0, 0, -1], [0, 1, 0], [d, h], 'side'),
    plane([-w / 2, -h / 2, -d / 2], [0, 0, 1], [0, 1, 0], [d, h], 'side'),
    plane([-w / 2, h / 2, -d / 2], [1, 0, 0], [0, 0, 1], [w, d], 'top'),
  ];
}
