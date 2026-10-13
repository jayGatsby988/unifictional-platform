import * as THREE from 'three';
import { fillReconstructedAppearance } from '@/lib/native/reconstructed-appearance-fill';
import { deriveCleanFaceFinish, type CleanFaceFinish } from '@/lib/native/clean-face-finish';
import { completeSameCabinetFinishes, type CabinetFinishFace } from '@/lib/native/complete-cabinet-finishes';

type Vec = [number, number, number];
type MaterialShader = Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
export interface CapturedFaceAtlas {
  rgba: Uint8Array; width: number; height: number; origin: Vec; u: Vec; v: Vec;
  spanMeters: [number, number]; fillColorLinear: Vec | null; coverageFraction: number;
  orientation?: CabinetFinishFace['orientation'];
  evidenceFailure?: 'invalid-input' | 'no-face-evidence' | 'resource-limit';
  /** Only direct depth-checked measured surfaces can retain fine appearance. */
  preserveSurfaceDetail?: boolean;
}

/** A display of exposed camera RGB, not a guessed physical reflectance. */
export function capturedAppearanceMaterial(color: THREE.Color, map: THREE.Texture | null = null, cleanShading = false): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x000000, emissive: color, emissiveMap: map, emissiveIntensity: 1,
    specularIntensity: 0, envMapIntensity: 0, metalness: 0, roughness: 1,
    side: THREE.DoubleSide, toneMapped: false,
  });
  if (cleanShading) {
    material.customProgramCacheKey = () => 'scan-clean-surface-v1';
    material.onBeforeCompile = shader => addCleanSurfaceShading(shader, 0.04);
  }
  return material;
}

/** Estimated finish colors have already been exposed by a camera. A bounded,
 * neutral shape/contact shade reveals joinery without exposing them again or
 * changing their hue. This applies only to the clean model, never Source. */
function addCleanSurfaceShading(shader: MaterialShader, contactStrength = 0.2) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
    .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', `
      vec3 cleanWorldNormal = inverseTransformDirection(normal, viewMatrix);
      float cleanShapeShade = 0.82 + 0.18 * max(0.0, dot(cleanWorldNormal, normalize(vec3(-0.3, 0.85, 0.45))));
      totalEmissiveRadiance *= cleanShapeShade * (${(1 - contactStrength).toFixed(2)} + ${contactStrength.toFixed(2)} * getShadowMask());
      vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;`);
}

/** Pack separately supported faces. World projection works on cabinet doors,
 * trim and instanced bodies without changing their catalog-material UVs. */
export function projectedScanMaterial(faces: CapturedFaceAtlas[], unknown: THREE.Color, cleanSlot?: string, object?: { objectId: string; role: string }): { material: THREE.MeshPhysicalMaterial; texture: THREE.DataTexture } {
  if (!faces.length || faces.length > 6) throw new Error('A captured material requires one to six supported faces.');
  const cellWidth = Math.max(...faces.map(f => f.width)) + 4, cellHeight = Math.max(...faces.map(f => f.height)) + 4;
  const columns = Math.min(3, faces.length), rows = Math.ceil(faces.length / columns), width = columns * cellWidth, height = rows * cellHeight;
  const pixels = new Uint8Array(width * height * 4);
  const finishes: CleanFaceFinish[] | null = cleanSlot ? faces.map(face => face.evidenceFailure && face.evidenceFailure !== 'no-face-evidence'
    ? { status: 'unknown', reason: 'invalid-input', confidence: 'low', provenance: 'same-face-camera-finish-estimate', estimated: true }
    : deriveCleanFaceFinish({ ...face, slot: cleanSlot })) : null;
  const completions = finishes && cleanSlot && object ? completeSameCabinetFinishes({ ...object, faces: finishes.map((finish, i) => ({ id: String(i), objectId: object.objectId, slot: cleanSlot, orientation: faces[i].orientation ?? 'back', finish })) }) : [];
  const origins: THREE.Vector3[] = [], us: THREE.Vector3[] = [], vs: THREE.Vector3[] = [], normals: THREE.Vector3[] = [], spans: THREE.Vector2[] = [], rects: THREE.Vector4[] = [];
  faces.forEach((face, index) => {
    const left = index % columns * cellWidth + 2, bottom = Math.floor(index / columns) * cellHeight + 2;
    const fill = (face.fillColorLinear ? new THREE.Color().setRGB(...face.fillColorLinear, THREE.LinearSRGBColorSpace) : unknown.clone()).convertLinearToSRGB();
    const rgb = [fill.r, fill.g, fill.b].map(n => Math.round(255 * Math.max(0, Math.min(1, n))));
    const finish = finishes?.[index];
    const completion = completions.find(f => f.faceId === String(index));
    const filled = finish?.status === 'supported' ? finish.rgba : cleanSlot ? solidPixels(face.width, face.height, completion ? new THREE.Color().setRGB(...completion.cleanColorLinear, THREE.LinearSRGBColorSpace) : unknown) : fillReconstructedAppearance({ rgba: face.rgba, width: face.width, height: face.height, spanMeters: face.spanMeters, fillColorSRGB: rgb as Vec }).rgba;
    // Duplicate a two-pixel border only for filtering; no observation is moved.
    for (let y = -2; y < face.height + 2; y++) for (let x = -2; x < face.width + 2; x++) {
      const source = (Math.max(0, Math.min(face.height - 1, y)) * face.width + Math.max(0, Math.min(face.width - 1, x))) * 4;
      const target = ((bottom + y) * width + left + x) * 4;
      pixels.set(filled.subarray(source, source + 3), target); pixels[target + 3] = 255;
    }
    origins.push(new THREE.Vector3(...face.origin)); us.push(new THREE.Vector3(...face.u)); vs.push(new THREE.Vector3(...face.v));
    normals.push(new THREE.Vector3(...face.u).cross(new THREE.Vector3(...face.v)).normalize());
    spans.push(new THREE.Vector2(...face.spanMeters));
    rects.push(new THREE.Vector4(left / width, bottom / height, face.width / width, face.height / height));
  });
  while (origins.length < 6) { origins.push(new THREE.Vector3()); us.push(new THREE.Vector3()); vs.push(new THREE.Vector3()); normals.push(new THREE.Vector3()); spans.push(new THREE.Vector2(1, 1)); rects.push(new THREE.Vector4()); }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  // The custom sampler decodes sRGB explicitly. Do not decode it twice.
  texture.colorSpace = THREE.NoColorSpace; texture.flipY = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
  const material = capturedAppearanceMaterial(unknown);
  material.name = cleanSlot ? 'scan-clean-face-finishes' : 'scan-camera-projected-faces';
  material.userData = { scanWorldProjection: true, finishProvenance: cleanSlot ? 'same-face-camera-finish-estimate' : 'camera-projected-face', confidence: 'low', faceCount: faces.length, coverage: faces.map(f => f.coverageFraction), estimatedFillRequired: true,
    ...(finishes ? { completions, evidenceFailures: faces.map(f => f.evidenceFailure ?? null), faces: finishes.map(f => f.status === 'supported' ? { status: f.status, color: f.cleanColorSRGB, kind: f.finishKind, supportFraction: f.supportFraction, textureTreatment: f.textureTreatment } : { status: f.status, reason: f.reason }) } : {}) };
  material.customProgramCacheKey = () => cleanSlot ? 'scan-clean-world-face-v1' : 'scan-world-face-v1';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      scanFaceMap: { value: texture }, scanFaceCount: { value: faces.length }, scanOrigins: { value: origins },
      scanDesignInverse: { value: new THREE.Matrix4() }, scanDesignDelta: { value: new THREE.Matrix4() },
      scanUs: { value: us }, scanVs: { value: vs }, scanNormals: { value: normals }, scanSpans: { value: spans }, scanRects: { value: rects },
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 scanWorldPosition;\nvarying vec3 scanWorldNormal;\nuniform mat4 scanDesignInverse;\nuniform mat4 scanDesignDelta;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vec3 designedNormal = inverseTransformDirection(transformedNormal, viewMatrix);
        scanWorldNormal = normalize(vec3(dot(scanDesignDelta[0].xyz, designedNormal), dot(scanDesignDelta[1].xyz, designedNormal), dot(scanDesignDelta[2].xyz, designedNormal)));`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 scanPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          scanPosition = instanceMatrix * scanPosition;
        #endif
        scanWorldPosition = (scanDesignInverse * modelMatrix * scanPosition).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 scanWorldPosition; varying vec3 scanWorldNormal;
      uniform sampler2D scanFaceMap; uniform int scanFaceCount;
      uniform vec3 scanOrigins[6]; uniform vec3 scanUs[6]; uniform vec3 scanVs[6]; uniform vec3 scanNormals[6];
      uniform vec2 scanSpans[6]; uniform vec4 scanRects[6];
      vec3 scanLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float scanBestScore = 1e5;
        for (int face = 0; face < 6; face++) {
          if (face >= scanFaceCount) break;
          vec3 offset = scanWorldPosition - scanOrigins[face];
          float distanceToPlane = abs(dot(offset, scanNormals[face]));
          float alignment = abs(dot(normalize(scanWorldNormal), scanNormals[face]));
          vec2 uv = vec2(dot(offset, scanUs[face]), dot(offset, scanVs[face])) / scanSpans[face];
          float score = distanceToPlane + (1.0 - alignment) * ${cleanSlot ? '0.02' : '0.2'};
          // A representative door rail's recessed side inherits its nearest
          // clean face finish. Camera-image projection still requires normals
          // to agree, since copying those pixels onto a bevel would distort it.
          if (alignment >= ${cleanSlot ? '0.0' : '0.70'} && distanceToPlane <= 0.13 && all(greaterThanEqual(uv, vec2(-0.03))) && all(lessThanEqual(uv, vec2(1.03))) && score < scanBestScore) {
            scanBestScore = score;
            vec2 packedUV = scanRects[face].xy + clamp(uv, vec2(0.0), vec2(1.0)) * scanRects[face].zw;
            totalEmissiveRadiance = scanLinear(texture2D(scanFaceMap, packedUV).rgb);
          }
        }`);
    if (cleanSlot) addCleanSurfaceShading(shader);
  };
  return { material, texture };
}

function solidPixels(width: number, height: number, color: THREE.Color): Uint8Array {
  const rgb = color.clone().convertLinearToSRGB().toArray().map(c => Math.round(255 * Math.max(0, Math.min(1, c))));
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([...rgb, 255], i);
  return rgba;
}

/** Keep recorded surface coordinates attached to a proposed object transform.
 * Projection capability is explicit: display names are free to describe the
 * evidence source and must not control whether an edited fixture keeps color.
 * The caller owns only a returned clone, never the original or its textures. */
export function transformedCapturedMaterial(material: THREE.MeshPhysicalMaterial, delta: THREE.Matrix4, inverse: THREE.Matrix4): THREE.MeshPhysicalMaterial {
  if (material.userData.scanWorldProjection !== true || delta.equals(new THREE.Matrix4())) return material;
  const moved = material.clone();
  moved.customProgramCacheKey = () => `${material.customProgramCacheKey()}:proposed-transform`;
  moved.onBeforeCompile = (shader, renderer) => {
    material.onBeforeCompile(shader, renderer);
    shader.uniforms.scanDesignInverse = { value: inverse };
    shader.uniforms.scanDesignDelta = { value: delta };
  };
  return moved;
}
