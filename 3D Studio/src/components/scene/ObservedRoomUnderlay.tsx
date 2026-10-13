'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ObservedMesh, MeshBounds } from '@/lib/native/mesh-archive';
import { deriveRoomAppearance, type RoomSurfaceAppearance } from '@/lib/native/room-appearance';
import type { ScannedElement, ScannedRoomGeometry, MaterialSlotId } from '@/lib/spec/types';
import { scannedFloorGeometry, scannedWallGeometry, scannedWallInteriorSign } from './scanned-geometry';
import { applyWorldUVs } from './geometry';
import { useSlotMaterial } from './materials';
import { scanSlotShowsDesign, scanPreviewFinishProject } from '@/lib/native/scan-finishes';
import { useProjectStore } from '@/lib/store/project-store';
import type { ScanPlaneTexture, ScanPlaneTexturePlane } from '@/lib/native/plane-texture-archive';
import { planeTextureUVs } from './plane-texture-mapping';

/** Clip derived room planes only. Original scan polygons and LiDAR vertices
 * remain untouched, and no polygon hole is filled by taking a convex hull. */
function croppedPlane(source: THREE.BufferGeometry, bounds?: MeshBounds): THREE.BufferGeometry {
  if (!bounds) return source;
  const input = source.getAttribute('position'), output: number[] = [];
  for (let i = 0; i < input.count; i += 3) {
    let polygon = [0, 1, 2].map(v => new THREE.Vector3().fromBufferAttribute(input, i + v));
    for (const axis of ['x', 'z'] as const) for (const side of [-1, 1]) {
      const coordinate = axis === 'x' ? 0 : 2, edge = side < 0 ? bounds.min[coordinate] : bounds.max[coordinate];
      const clipped: THREE.Vector3[] = [];
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j], b = polygon[(j + 1) % polygon.length];
        const da = (a[axis] - edge) * side, db = (b[axis] - edge) * side;
        if (da <= 0) clipped.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) clipped.push(a.clone().lerp(b, da / (da - db)));
      }
      polygon = clipped;
    }
    for (let v = 1; v + 1 < polygon.length; v++) for (const point of [polygon[0], polygon[v], polygon[v + 1]]) output.push(point.x, point.y, point.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(output, 3));
  geometry.computeVertexNormals(); source.dispose();
  return applyWorldUVs(geometry);
}

function RoomPlane({ surface, scan, appearance, roomType, focusBounds, cameraPlane }: {
  surface: ScannedElement; scan: ScannedRoomGeometry; appearance?: RoomSurfaceAppearance;
  roomType: 'kitchen' | 'bathroom'; focusBounds?: MeshBounds; cameraPlane?: ScanPlaneTexturePlane;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const floor = surface.kind === 'floor';
  const slot: MaterialSlotId = floor ? roomType === 'kitchen' ? 'flooring' : 'floor_tile' : 'walls';
  const project = useProjectStore(s => s.project);
  const preview = useProjectStore(s => s.ui.jarvisPreview);
  const chosen = scanSlotShowsDesign(scanPreviewFinishProject(project, preview?.snapshot, preview?.finishChoices), slot);
  const selectedMaterial = useSlotMaterial(slot, !chosen);
  const selectSlot = useProjectStore(s => s.selectSlot);
  const interiorSign = useMemo(() => scannedWallInteriorSign(surface, scan), [surface, scan]);
  const geometry = useMemo(() => {
    const geometry = floor ? scannedFloorGeometry(surface) : scannedWallGeometry(surface, scan.surfaces.filter(s => ['door', 'window', 'opening'].includes(s.kind)));
    if (!geometry) return null;
    if (!floor) geometry.applyMatrix4(new THREE.Matrix4().fromArray(surface.transform));
    // A thin display underlay sits behind observed facets. This never alters
    // the measured room frame, fixture footprint, source mesh or quantities.
    if (floor) geometry.translate(0, -0.025, 0);
    else geometry.translate(-surface.transform[8] * interiorSign * 0.025, -surface.transform[9] * interiorSign * 0.025, -surface.transform[10] * interiorSign * 0.025);
    const cropped = croppedPlane(geometry, focusBounds);
    const position = cropped.getAttribute('position');
    if (cameraPlane) cropped.setAttribute('planeCameraUV', new THREE.BufferAttribute(planeTextureUVs(position.array, cameraPlane), 2));
    return cropped;
  }, [surface, scan.surfaces, floor, interiorSign, focusBounds, cameraPlane]);
  const cameraMap = useMemo(() => {
    if (!cameraPlane?.observedTexels) return null;
    const map = new THREE.DataTexture(cameraPlane.rgba, cameraPlane.width, cameraPlane.height, THREE.RGBAFormat);
    // Support is binary, so filtering must never bleed camera color into an
    // unsupported cell. Recorded RGB is sRGB; the fallback tint is linear.
    map.colorSpace = THREE.SRGBColorSpace; map.flipY = false; map.generateMipmaps = false;
    map.minFilter = THREE.NearestFilter; map.magFilter = THREE.NearestFilter; map.needsUpdate = true;
    return map;
  }, [cameraPlane]);
  const material = useMemo(() => {
    const color = appearance?.status === 'supported' && appearance.colorLinear
      ? new THREE.Color().setRGB(...appearance.colorLinear) : new THREE.Color('#aaa9a4');
    if (cameraMap) return new THREE.ShaderMaterial({
      side: THREE.DoubleSide, toneMapped: false,
      uniforms: { cameraMap: { value: cameraMap }, fallbackColor: { value: color } },
      vertexShader: `attribute vec2 planeCameraUV; varying vec2 vPlaneUV;
        void main(){ vPlaneUV=planeCameraUV; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D cameraMap; uniform vec3 fallbackColor; varying vec2 vPlaneUV;
        void main(){ vec3 color=fallbackColor;
          if(all(greaterThanEqual(vPlaneUV,vec2(0.0))) && all(lessThan(vPlaneUV,vec2(1.0)))){
            vec4 recorded=texture2D(cameraMap,vPlaneUV); if(recorded.a>0.5) color=recorded.rgb;
          }
          gl_FragColor=vec4(color,1.0);
          #include <colorspace_fragment>
        }`,
    });
    return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
  }, [appearance, cameraMap]);
  const eye = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    if (!ref.current || floor) return;
    camera.getWorldPosition(eye);
    const t = surface.transform;
    ref.current.visible = ((eye.x - t[12]) * t[8] + (eye.y - t[13]) * t[9] + (eye.z - t[14]) * t[10]) * interiorSign >= -0.015;
  });
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => cameraMap?.dispose(), [cameraMap]);
  if (!geometry) return null;
  return <mesh ref={ref} name={`derived-room-plane-${surface.id}`} geometry={geometry} material={chosen ? selectedMaterial : material}
    userData={{ slot, representation: 'measured-plane-underlay', appearance: cameraMap ? 'camera-supported' : appearance?.status ?? 'unknown', observedTexels: cameraPlane?.observedTexels ?? 0 }}
    onClick={event => { event.stopPropagation(); selectSlot(slot); }} />;
}

/** Clean architectural context below observed camera detail; never used in
 * Source scan or as replacement geometry for cabinets or an island. */
export function ObservedRoomUnderlay({ mesh, scan, roomType, focusBounds, planeTexture }: {
  mesh: ObservedMesh; scan: ScannedRoomGeometry; roomType: 'kitchen' | 'bathroom'; focusBounds?: MeshBounds; planeTexture?: ScanPlaneTexture | null;
}) {
  const appearance = useMemo(() => deriveRoomAppearance(mesh, scan), [mesh, scan]);
  const planes = useMemo(() => new Map(planeTexture?.planes.map(plane => [plane.id, plane])), [planeTexture]);
  return <group name="measured-room-underlay">{scan.surfaces.filter(s => s.kind === 'wall' || s.kind === 'floor').map(surface =>
    <RoomPlane key={surface.id} surface={surface} scan={scan} appearance={appearance[surface.id]} roomType={roomType} focusBounds={focusBounds} cameraPlane={planes.get(surface.id)} />
  )}</group>;
}
