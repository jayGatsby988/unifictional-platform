'use client';

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { useNativeMesh } from '@/lib/native/mesh-store';
import { ObservedLiDARMesh } from './ObservedLiDARMesh';
import { startMirrorReconstruction, useMirrorDetails } from '@/lib/native/mirror-store';
import { ReconstructedMirrors } from './ReconstructedMirrors';
import { startObjectAppearance, useObjectAppearance } from '@/lib/native/object-appearance-store';
import { ReconstructedAppearanceProvider, useReconstructedFloorPatch } from './ReconstructedAppearance';
import type { ScannedElement, ScannedRoomGeometry } from '@/lib/spec/types';
import { Surface } from './Surface';
import { worldBox } from './geometry';
import { materialWorkPending } from './materials';
import { useProjectStore } from '@/lib/store/project-store';
import { useScanView } from './scan-view-store';
import { scannedObjectLayout } from './scanned-object-layout';
import { ScannedObjects } from './ScannedObjects';
import { cleanCountertopRing, countertopSurfaceIssue } from '@/lib/native/countertop-surfaces';
import { measuredFrameVisible, scannedOpeningCutawaySign } from './scanned-frame-visibility';
import { scannedFloorGeometry, scannedWallGeometry, scannedWallInteriorSign, scannedWallOutline } from './scanned-geometry';

/** Preserve the measured frame while allowing the near wall to disappear in the orbit view. */
function MeasuredFrame({ element, interiorSign, children }: { element: ScannedElement; interiorSign?: 1 | -1; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const matrix = useMemo(() => new THREE.Matrix4().fromArray(element.transform), [element.transform]);
  const eye = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    if (!group.current) return;
    camera.getWorldPosition(eye);
    group.current.worldToLocal(eye);
    group.current.visible = measuredFrameVisible(eye.z, interiorSign);
  });
  return <group ref={group} name={`scan-${element.kind}-${element.id}`} matrix={matrix} matrixAutoUpdate={false}>{children}</group>;
}

function MeasuredWall({ wall, openings, scan, source }: { wall: ScannedElement; openings: ScannedElement[]; scan: ScannedRoomGeometry; source: boolean }) {
  const geometry = useMemo(() => scannedWallGeometry(wall, openings), [wall, openings]);
  const outline = useMemo(() => new THREE.BufferGeometry().setFromPoints(scannedWallOutline(wall).map((p) => new THREE.Vector3(p.x, p.y, p.z))), [wall]);
  const interiorSign = useMemo(() => scannedWallInteriorSign(wall, scan), [wall, scan]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => outline.dispose(), [outline]);
  const uncertain = wall.confidence === 'low';
  return (
    <group>
      <MeasuredFrame element={wall} interiorSign={interiorSign}>
        <Surface slot="walls" appearanceId={wall.id} name={`measured-wall-${wall.id}`} geometry={geometry} castShadow={false} receiveShadow />
      </MeasuredFrame>
      {source && <MeasuredFrame element={wall}>
        <lineLoop name={`measured-wall-perimeter-${wall.id}`} geometry={outline} renderOrder={5}>
          <lineBasicMaterial color={uncertain ? '#b3823d' : '#59675f'} transparent opacity={uncertain ? 0.72 : 0.32} depthTest={false} depthWrite={false} />
        </lineLoop>
      </MeasuredFrame>}
    </group>
  );
}

function MeasuredFloor({ floor, slot }: { floor: ScannedElement; slot: string }) {
  const patch = useReconstructedFloorPatch(floor.id);
  const geometry = useMemo(() => {
    const value = scannedFloorGeometry(floor);
    if (value && patch) {
      const positions = value.getAttribute('position'), uv = new Float32Array(positions.count * 2);
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i) - patch.origin[0], y = positions.getY(i) - patch.origin[1], z = positions.getZ(i) - patch.origin[2];
        uv[i * 2] = (x * patch.u[0] + y * patch.u[1] + z * patch.u[2]) / patch.spanMeters[0];
        uv[i * 2 + 1] = (x * patch.v[0] + y * patch.v[1] + z * patch.v[2]) / patch.spanMeters[1];
      }
      value.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
    }
    return value;
  }, [floor, patch]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  // Missing or invalid polygon data stays unfilled. A rectangle would misrepresent the scan.
  return geometry ? <Surface name={`measured-floor-${floor.id}`} slot={slot} appearanceId={floor.id} geometry={geometry} castShadow={false} receiveShadow /> : null;
}

function OpeningMarker({ opening, walls, scan, source }: { opening: ScannedElement; walls: ScannedElement[]; scan: ScannedRoomGeometry; source: boolean }) {
  const frame = useMemo(() => {
    const box = new THREE.BoxGeometry(opening.dimensions.x, opening.dimensions.y, 0.012);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [opening.dimensions.x, opening.dimensions.y]);
  const sign = useMemo(() => scannedOpeningCutawaySign(opening, walls, scan, source), [opening, walls, scan, source]);
  useEffect(() => () => frame.dispose(), [frame]);
  const color = opening.kind === 'window' ? '#7097aa' : opening.kind === 'door' ? '#a08058' : '#4b8678';
  return (
    <MeasuredFrame element={opening} interiorSign={sign}>
      {source && <lineSegments geometry={frame} name={`observed-${opening.kind}-outline`}>
        <lineBasicMaterial color={color} transparent opacity={0.9} />
      </lineSegments>}
      {!source && opening.kind === 'window' && <group name="representative-window-trim">
        {[-1, 1].map(side => <Surface key={`jamb-${side}`} slot="walls" util="white-plastic" inert geometry={worldBox(0.035, opening.dimensions.y, 0.065)} position={[side * (opening.dimensions.x / 2 - 0.0175), 0, 0]} />)}
        {[-1, 1].map(side => <Surface key={`sill-${side}`} slot="walls" util="white-plastic" inert geometry={worldBox(opening.dimensions.x, 0.035, 0.065)} position={[0, side * (opening.dimensions.y / 2 - 0.0175), 0]} />)}
      </group>}
      {opening.kind === 'window' && (
        <mesh name="observed-window-plane" receiveShadow={false}>
          <planeGeometry args={[opening.dimensions.x, opening.dimensions.y]} />
          <meshPhysicalMaterial color="#bdd4df" roughness={0.3} transparent opacity={source ? 0.18 : 0.7} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </MeasuredFrame>
  );
}

/** RoomPlan supplies bounds, not detailed object meshes. Batch them so a busy room remains usable on a phone. */
function CapturedObjects({ objects }: { objects: ScannedElement[] }) {
  const batches = useMemo(() => {
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const unitEdges = new THREE.EdgesGeometry(unit);
    const edgePositions = unitEdges.getAttribute('position');
    const result = [false, true].flatMap((lowConfidence) => [false, true].map((hasContour) => {
      const members = objects.filter((object) => (object.confidence === 'low') === lowConfidence && Boolean(object.countertopSurfaces?.length) === hasContour);
      if (!members.length) return null;
      const color = lowConfidence ? '#aa906b' : '#78968b';
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true, opacity: hasContour ? 0.04 : 0.28, depthWrite: false });
      const mesh = new THREE.InstancedMesh(unit, material, members.length);
      const positions: number[] = [], point = new THREE.Vector3();
      const scale = new THREE.Vector3();
      members.forEach((object, i) => {
        const matrix = new THREE.Matrix4().fromArray(object.transform).scale(scale.set(object.dimensions.x, object.dimensions.y, object.dimensions.z));
        mesh.setMatrixAt(i, matrix);
        for (let j = 0; j < edgePositions.count; j++) {
          point.fromBufferAttribute(edgePositions, j).applyMatrix4(matrix);
          positions.push(point.x, point.y, point.z);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = 'captured-object-bounds';
      mesh.userData = { representation: 'observed-bounds', objects: members.map(({ id, kind, confidence }) => ({ id, kind, confidence })) };
      const edges = new THREE.BufferGeometry();
      edges.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return { mesh, edges, material, color, hasContour };
    })).filter((batch) => batch !== null);
    unitEdges.dispose();
    return { result, unit };
  }, [objects]);
  useEffect(() => () => {
    batches.result.forEach(({ mesh, edges, material }) => { mesh.dispose(); edges.dispose(); material.dispose(); });
    batches.unit.dispose();
  }, [batches]);
  return <group name="captured-object-bounds">{batches.result.map(({ mesh, edges, color, hasContour }) => (
    <group key={`${color}-${hasContour}`}>
      <primitive object={mesh} />
      <lineSegments geometry={edges}><lineBasicMaterial color={color} transparent opacity={hasContour ? 0.24 : 0.85} /></lineSegments>
    </group>
  ))}</group>;
}

/** Exact world-space mesh boundaries, including cutouts, remain visible in Source scan mode. */
function CapturedCountertopContours({ objects }: { objects: ScannedElement[] }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    for (const object of objects) for (const surface of object.countertopSurfaces ?? []) {
      if (countertopSurfaceIssue(surface)) continue;
      for (const points of [surface.polygonCorners, ...(surface.holes ?? [])]) {
        const ring = cleanCountertopRing(points);
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return result;
  }, [objects]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments name="measured-countertop-boundaries" geometry={geometry} renderOrder={12}>
    <lineBasicMaterial color="#39b995" transparent opacity={0.98} depthTest={false} depthWrite={false} />
  </lineSegments>;
}

export function ScannedRoomShell({ geometry, roomType }: { geometry: ScannedRoomGeometry; roomType: 'kitchen' | 'bathroom' }) {
  const mode = useScanView(s => s.mode);
  const projectId = useProjectStore(s => s.project.id);
  const observedMesh = useNativeMesh(s => s.projectId === projectId ? s.mesh : null);
  const observedTexture = useNativeMesh(s => s.projectId === projectId ? s.texture : null);
  const texturePending = useNativeMesh(s => s.projectId === projectId && s.texturePending);
  const planeTexture = useNativeMesh(s => s.projectId === projectId ? s.planeTexture : null);
  const planeTexturePending = useNativeMesh(s => s.projectId === projectId && s.planeTexturePending);
  const meshRevision = useNativeMesh(s => s.projectId === projectId ? s.revision : 0);
  const rawSource = mode === 'source' && !!observedMesh;
  const mirrorDetails = useMirrorDetails();
  const colorDetails = useObjectAppearance();
  const ownColorDetails = colorDetails.mesh === observedMesh && colorDetails.texture === observedTexture && colorDetails.scan === geometry;
  const colorsPending = !!observedMesh && !!observedTexture && (!ownColorDetails || colorDetails.status === 'refining');
  useEffect(() => {
    if (observedMesh && observedTexture) return startObjectAppearance(observedMesh, observedTexture, geometry, roomType);
  }, [observedMesh, observedTexture, geometry, roomType]);
  const ownMirrorDetails = mirrorDetails.scan === geometry && mirrorDetails.texture === observedTexture;
  const detailsPending = !!observedMesh && !!observedTexture && (!ownMirrorDetails || mirrorDetails.status === 'loading' || mirrorDetails.status === 'detecting');
  useEffect(() => {
    if (observedMesh && observedTexture) return startMirrorReconstruction(observedMesh, observedTexture, geometry);
  }, [observedMesh, observedTexture, geometry]);
  const focus = useScanView(s => s.focus);
  const appearanceMode = useProjectStore(s => s.project.overrides.scanAppearanceMode);
  const displayedSlots = useProjectStore(s => s.project.overrides.scanPreviewSlots);
  const reviewedFinishes = useProjectStore(s => s.project.overrides.scanReviewedFinishes);
  const optionPreview = useProjectStore(s => !!s.ui.jarvisPreview);
  const previewFinishes = useProjectStore(s => s.ui.jarvisPreview?.finishChoices);
  const selections = useProjectStore(s => s.ui.jarvisPreview?.snapshot.selections ?? s.project.selections);
  const layout = useMemo(() => scannedObjectLayout(geometry, roomType), [geometry, roomType]);
  const loading = useProgress(s => s.active);
  const settling = useRef({ elapsed: 0, frames: 0, sent: false });
  // Readiness is emitted by the rendered scene, after textures and real frames settle.
  useEffect(() => { settling.current = { elapsed: 0, frames: 0, sent: false }; useScanView.getState().setReady(null); }, [geometry, mode, focus, selections, appearanceMode, displayedSlots, reviewedFinishes, optionPreview, previewFinishes, observedMesh, meshRevision, texturePending, planeTexture, planeTexturePending, detailsPending, colorsPending]);
  useFrame((_, delta) => {
    const state = settling.current;
    if (state.sent) return;
    if (texturePending || (mode === 'model' && (planeTexturePending || detailsPending || colorsPending)) || ((!rawSource || appearanceMode === 'design' || optionPreview) && (loading || materialWorkPending()))) { state.elapsed = 0; state.frames = 0; return; }
    state.elapsed += Math.min(delta, 0.1); state.frames++;
    if (state.elapsed > 0.6 && state.frames >= 8) {
      state.sent = true;
      useScanView.getState().setReady(mode);
    }
  });
  const { walls, floors, openings } = useMemo(() => ({
    walls: geometry.surfaces.filter((s) => s.kind === 'wall' && s.dimensions.x > 0 && s.dimensions.y > 0),
    floors: geometry.surfaces.filter((s) => s.kind === 'floor'),
    openings: geometry.surfaces.filter((s) => ['door', 'window', 'opening'].includes(s.kind) && s.dimensions.x > 0 && s.dimensions.y > 0),
  }), [geometry]);
  if (rawSource && observedMesh) return <ObservedLiDARMesh mesh={observedMesh} texture={observedTexture} scan={geometry} roomType={roomType} design={false} />;
  return (
    <ReconstructedAppearanceProvider mesh={mode === 'model' ? observedMesh : null} texture={mode === 'model' ? observedTexture : null} planeTexture={mode === 'model' ? planeTexture : null} scan={geometry} roomType={roomType}>
    <group name="measured-room-shell">
      {floors.map((floor) => <MeasuredFloor key={floor.id} floor={floor} slot={roomType === 'kitchen' ? 'flooring' : 'floor_tile'} />)}
      {walls.map((wall) => <MeasuredWall key={wall.id} wall={wall} openings={openings} scan={geometry} source={mode === 'source'} />)}
      {openings.map((opening) => <OpeningMarker key={opening.id} opening={opening} walls={walls} scan={geometry} source={mode === 'source'} />)}
      {mode === 'source' ? <><CapturedObjects objects={geometry.objects} /><CapturedCountertopContours objects={geometry.objects} /></> : <>
        <ScannedObjects objects={layout.objects} geometry={geometry} roomType={roomType} clean />
        {ownMirrorDetails && <ReconstructedMirrors mirrors={mirrorDetails.mirrors} scan={geometry} />}
      </>}
    </group>
    </ReconstructedAppearanceProvider>
  );
}
