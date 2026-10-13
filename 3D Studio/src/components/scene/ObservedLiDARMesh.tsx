'use client';
import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ObservedMesh, MeshBounds } from '@/lib/native/mesh-archive';
import type { ScanTexture } from '@/lib/native/texture-archive';
import { buildTextureAtlases } from '@/lib/native/texture-atlas';
import type { ScannedRoomGeometry, MaterialSlotId } from '@/lib/spec/types';
import { observedMeshLayout, type ObservedSceneGroup } from './observed-mesh-layout';
import { useProjectStore } from '@/lib/store/project-store';
import { scanSlotShowsDesign, scanPreviewFinishProject } from '@/lib/native/scan-finishes';
import { CAPTURED_FURNITURE_SLOT } from '@/lib/native/captured-furniture';
import { useSlotMaterial } from './materials';
import { applyWorldUVs } from './geometry';

function cameraMaterial(map: THREE.DataTexture | null): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, toneMapped: false,
    uniforms: { cameraMap: { value: map }, hasMap: { value: Boolean(map) } },
    vertexShader: `attribute vec3 color; attribute float captured; attribute vec3 cameraProjection;
      varying vec3 vColor; varying float vCaptured; varying vec3 vNormal; varying vec3 vProjection;
      void main() { vColor=color; vCaptured=captured; vNormal=normalize(normalMatrix*normal); vProjection=cameraProjection;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D cameraMap; uniform bool hasMap;
      varying vec3 vColor; varying float vCaptured; varying vec3 vNormal; varying vec3 vProjection;
      void main() { vec3 n=normalize(vNormal)*(gl_FrontFacing?1.0:-1.0);
        float shade=0.52+0.48*max(dot(n,normalize(vec3(-0.35,0.65,0.7))),0.0);
        vec3 appearance=vColor*mix(shade,1.0,clamp(vCaptured,0.0,1.0));
        if(hasMap && vProjection.z>0.0) appearance=texture2D(cameraMap,vProjection.xy/vProjection.z).rgb;
        gl_FragColor=vec4(appearance,1.0);
        #include <colorspace_fragment>
      }`,
  });
}
interface Batch { key: string; geometry: THREE.BufferGeometry; material: THREE.Material; slot: string | null; wallPlane?: ObservedSceneGroup['wallPlane'] }
function ObservedBatch({ batch, editable, designFinishes }: { batch: Batch; editable: boolean; designFinishes: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const project = useProjectStore(s => s.project);
  const preview = useProjectStore(s => s.ui.jarvisPreview);
  const finishSlot = batch.slot && batch.slot !== CAPTURED_FURNITURE_SLOT ? batch.slot : null;
  const chosen = !!finishSlot && designFinishes && scanSlotShowsDesign(scanPreviewFinishProject(project, preview?.snapshot, preview?.finishChoices), finishSlot);
  const finish = useSlotMaterial(batch.slot ?? '__unused__', !chosen);
  const selectSlot = useProjectStore(s => s.selectSlot);
  const eye = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    if (!ref.current || !batch.wallPlane) return;
    camera.getWorldPosition(eye);
    const p = batch.wallPlane;
    ref.current.visible = p[0] * eye.x + p[1] * eye.y + p[2] * eye.z + p[3] >= -0.015;
  });
  const choose = useCallback((event: ThreeEvent<MouseEvent>) => {
    if (!editable || !finishSlot) return;
    event.stopPropagation(); selectSlot(finishSlot as MaterialSlotId);
  }, [finishSlot, editable, selectSlot]);
  return <mesh ref={ref} name={`captured-${batch.key}`} geometry={batch.geometry} material={chosen ? finish : batch.material}
    onClick={editable && finishSlot ? choose : undefined} userData={{ slot: finishSlot, representation: 'observed-lidar' }} />;
}

/** Source positions remain immutable. Model view only adds semantic picking,
 * an architectural cutaway and optional deliberate finish edits to that mesh. */
export function ObservedLiDARMesh({ mesh, texture, scan, roomType = 'kitchen', design = false, focusBounds }: {
  mesh: ObservedMesh; texture?: ScanTexture | null; scan?: ScannedRoomGeometry; roomType?: 'kitchen' | 'bathroom'; design?: boolean; focusBounds?: MeshBounds;
}) {
  const designFinishes = useProjectStore(s => !!s.ui.jarvisPreview || s.project.overrides.scanAppearanceMode === 'design');
  const textureResources = useMemo(() => {
    const atlases = texture ? buildTextureAtlases(texture) : null;
    const maps = (atlases?.images ?? []).map(image => {
      const map = new THREE.DataTexture(image.rgba, image.width, image.height, THREE.RGBAFormat);
      map.colorSpace = THREE.SRGBColorSpace; map.flipY = false; map.generateMipmaps = false;
      map.minFilter = THREE.LinearFilter; map.magFilter = THREE.LinearFilter; map.needsUpdate = true;
      return map;
    });
    const materials = [cameraMaterial(null), ...maps.map(map => cameraMaterial(map))];
    return { atlases, maps, materials };
  }, [texture]);
  useEffect(() => () => {
    textureResources.maps.forEach(map => map.dispose()); textureResources.materials.forEach(material => material.dispose());
  }, [textureResources]);
  const base = useMemo(() => {
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    base.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
    base.setAttribute('captured', new THREE.BufferAttribute(mesh.captured, 1));
    base.setAttribute('cameraProjection', new THREE.BufferAttribute(textureResources.atlases?.projected ?? new Float32Array(mesh.triangleCount * 9), 3));
    base.computeVertexNormals();
    base.computeBoundingBox(); base.computeBoundingSphere();
    applyWorldUVs(base);
    return base;
  }, [mesh, textureResources]);
  useEffect(() => () => base.dispose(), [base]);
  const batches = useMemo(() => {
    const { atlases, materials } = textureResources;
    const groups = design && scan ? observedMeshLayout(mesh, scan, roomType, focusBounds).groups : [{ key: 'source', slot: null, indices: Uint32Array.from({ length: mesh.triangleCount * 3 }, (_, i) => i) } as ObservedSceneGroup];
    const batches: Batch[] = [];
    for (const group of groups) {
      const split = new Map<number, number[]>();
      for (let i = 0; i < group.indices.length; i += 3) {
        const vertex = group.indices[i], atlas = atlases?.triangleAtlas[vertex / 3] ?? -1;
        const indices = split.get(atlas) ?? []; indices.push(vertex, vertex + 1, vertex + 2); split.set(atlas, indices);
      }
      for (const [atlas, indices] of split) {
        const geometry = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(base.attributes)) geometry.setAttribute(name, attribute);
        geometry.setIndex(indices); geometry.boundingBox = base.boundingBox?.clone() ?? null; geometry.boundingSphere = base.boundingSphere?.clone() ?? null;
        batches.push({ key: `${group.key}:${atlas}`, geometry, material: materials[atlas + 1], slot: group.slot, ...(group.wallPlane ? { wallPlane: group.wallPlane } : {}) });
      }
    }
    return batches;
  }, [mesh, textureResources, base, scan, roomType, design, focusBounds]);
  useEffect(() => () => batches.forEach(batch => batch.geometry.dispose()), [batches]);
  return <group name={design ? 'captured-design-model' : 'observed-lidar-mesh'}
    userData={{ representation: 'observed-lidar', triangles: mesh.triangleCount, coloredVertices: mesh.coloredVertexCount, texturedTriangles: texture?.texturedTriangleCount ?? 0 }}>
    {batches.map(batch => <ObservedBatch key={batch.key} batch={batch} editable={design} designFinishes={design && designFinishes} />)}
  </group>;
}
