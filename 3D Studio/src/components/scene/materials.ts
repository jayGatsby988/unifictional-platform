'use client';
/**
 * Material factory + hooks.
 *
 * - One THREE.MeshPhysicalMaterial per catalog material id (cached, shared).
 * - Textures loaded once (cached), sRGB for diffuse, linear for normal/ARM.
 * - Geometry UVs are in meters (see geometry.ts) so texture.repeat = 1/tileM.
 *
 * REALISM LAYERS (added on top of the catalog recipe, see `applyRealism`):
 *  1. A DETAIL NORMAL — a second, high-frequency normal map tiled ~20× smaller
 *     than the base and blended in the shader. Without it every surface goes
 *     glassy the moment the camera gets within a metre, because the base map's
 *     smallest feature is already several centimetres across.
 *  2. CAVITY / edge wear — procedural surfaces derive an aoMap from the same
 *     drawing that produced the colour, so grout channels, plank joints and
 *     panel reveals sit in shadow instead of glowing.
 *  3. ANISOTROPY — brushed nickel and stainless get a stretched highlight, so
 *     they read as brushed rather than as chrome.
 *  4. SHEEN / CLEARCOAT — fabric retro-reflection, and the real lacquer film on
 *     a painted cabinet door.
 */
import * as THREE from 'three';
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { CATALOG_BY_ID, DEFAULT_SELECTIONS, getMaterial, type MaterialDef, type PBRRecipe } from '@/lib/materials/catalog';
import {
  brushedMetal, cavityFromCanvas, fabricWeave, groutedSlab, lapSiding, microNormal, normalFromCanvas,
  onIdle, paintedWall, plankFloor, proceduralQuality, quartzWithSpeckle, roughnessFromCanvas, setProceduralQuality, tiledSurface,
  veinedSlab, woodGrain,
  type MicroSurface, type ProceduralResult,
} from './procedural';
import type { RoomType } from '@/lib/spec/types';
import { useProjectStore } from '@/lib/store/project-store';
import { QUALITY } from './light-math';
import { scanSlotFinish, scanSlotShowsDesign, scanPreviewFinishProject } from '@/lib/native/scan-finishes';
import { useReconstructedMaterial, useReconstructedFloorPatch, useReconstructedObjectFaceColors, type AppearancePlane } from './ReconstructedAppearance';
import { deriveReconstructedFloorFinish } from '@/lib/native/reconstructed-floor-finish';
import { useScanView } from './scan-view-store';
import { photoFinishAgreesWithFaces, scanPhotoFinishFor } from '@/lib/native/photo-finishes';
import { useScanObjectTransform } from './ScanObjectDesign';
import { transformedCapturedMaterial } from './projected-scan-material';
import { photoFloorTextureMatrix } from './photo-floor-registration';

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, Promise<THREE.Texture>>();
const matCache = new Map<string, THREE.MeshPhysicalMaterial>();

/**
 * Anisotropic filtering.
 *
 * `deviceMaxAniso` is what the GPU can do (16 on essentially every desktop and
 * most phones since 2018); `ANISO_FOR_TIER` is what we ASK for. This matters
 * more here than in most scenes because every UV in the app is in METRES: a
 * floor plank repeats every 1.4 m, so at a walking camera the floor is sampled
 * at a grazing angle across the whole lower half of the frame, which is exactly
 * the case trilinear filtering turns to mush. Without aniso the far end of a
 * kitchen floor is a grey smear.
 *
 * It was also being left on the table: the device cap was only read inside
 * `useSlotMaterial`, so every texture built before the first slot mesh mounted
 * — the utility metals, the preloaded selections, the micro-normals — kept the
 * conservative default of 8 for the life of the session. It is read once from
 * the renderer now, in SceneCanvas, before anything is built.
 */
let deviceMaxAniso = 16;
/** every texture we have handed to a material, so a tier change can re-filter them */
const liveTextures = new Set<THREE.Texture>();

export function currentAnisotropy(): number { return Math.max(1, Math.min(deviceMaxAniso, QUALITY[quality].anisotropy)); }

export function setMaxAnisotropy(n: number) {
  const cap = Math.max(1, Math.min(16, Math.round(n)));
  if (cap === deviceMaxAniso) return;
  deviceMaxAniso = cap;
  applyAnisotropy();
}

/**
 * Re-filter every live texture. Called when the device cap is first read and
 * whenever the quality tier changes, which is most of what makes the studio's
 * quality control visibly do something to a scene that is already built.
 */
export function applyAnisotropy() {
  const a = currentAnisotropy();
  let changed = 0;
  for (const t of liveTextures) {
    if (t.anisotropy === a) continue;
    t.anisotropy = a;
    // filtering is a sampler parameter, applied on upload — the texture has to
    // be handed back to the driver for a new value to take
    t.needsUpdate = true;
    changed++;
  }
  if (changed) notify();
}

/** Register a texture for tier-driven re-filtering and give it the current tier's value. */
function track<T extends THREE.Texture>(t: T): T {
  t.anisotropy = currentAnisotropy();
  liveTextures.add(t);
  return t;
}

// ---------------------------------------------------------------------------
// Quality tier — mobile drops the detail-normal pass and halves texture size.
// ---------------------------------------------------------------------------
export type MaterialQuality = 'high' | 'balanced' | 'performance';
let quality: MaterialQuality = 'balanced';
let detailNormalEnabled = true;

/**
 * Call once from the canvas when the device tier is known. Materials already
 * built keep what they have; everything built afterwards follows the new tier.
 */
export function setMaterialQuality(q: MaterialQuality) {
  const next = q === 'high' || q === 'balanced' || q === 'performance' ? q : 'balanced';
  const changed = next !== quality;
  quality = next;
  setProceduralQuality(QUALITY[quality].texturePx);
  detailNormalEnabled = QUALITY[quality].detailNormal;
  // Texture resolution and the detail-normal pass only govern materials built
  // AFTER the switch, but filtering is a per-texture parameter we can change on
  // the spot — so a user who picks "High" on a scene that is already standing
  // sees the floor and the backsplash sharpen up instead of nothing at all.
  if (changed) applyAnisotropy();
}
export function materialQuality(): MaterialQuality { return quality; }

/**
 * Metals have no diffuse term: everything you see on a stainless fridge or a
 * brass pull is the environment map. Interiors run the HDRI at ~0.2 so it does
 * not flatten the room, which would turn every metal near-black — so metals
 * see the environment at a higher multiplier than dielectrics do. The canvas
 * sets this per preset and re-applies it to every material already built.
 */
let metalEnvBoost = 3.0;
const isMetalLike = (m: THREE.MeshPhysicalMaterial) => m.metalness >= 0.5;
function applyMetalEnv(m: THREE.MeshPhysicalMaterial) {
  const base = (m.userData.baseEnvIntensity as number | undefined) ?? m.envMapIntensity;
  m.userData.baseEnvIntensity = base;
  m.envMapIntensity = isMetalLike(m) ? base * metalEnvBoost : base;
}
export function setMetalEnvBoost(n: number) {
  metalEnvBoost = Math.max(0.5, Math.min(8, n));
  for (const cache of [matCache, tintCache, adhocCache]) for (const m of cache.values()) applyMetalEnv(m);
  for (const m of utilCache.values()) if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) applyMetalEnv(m as THREE.MeshPhysicalMaterial);
}
/** Force the detail-normal layer on or off regardless of tier (debugging). */
export function setDetailNormalEnabled(on: boolean) { detailNormalEnabled = on; }

function loadTexture(url: string, opts: { srgb?: boolean; tileM: number; rotate90?: boolean }): Promise<THREE.Texture> {
  const key = `${url}|${opts.tileM}|${opts.rotate90 ? 'r' : ''}|${opts.srgb ? 's' : 'l'}`;
  let p = texCache.get(key);
  if (!p) {
    p = new Promise<THREE.Texture>((resolve, reject) => {
      // TextureLoader starts LoadingManager progress synchronously. Materials
      // may be requested during React render, so start after that stack unwinds.
      // Cache the promise immediately to preserve deduplication in the meantime.
      queueMicrotask(() => {
        try {
          texLoader.load(url, (t) => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(1 / opts.tileM, 1 / opts.tileM);
            if (opts.rotate90) { t.rotation = Math.PI / 2; t.center.set(0.5, 0.5); }
            t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
            t.generateMipmaps = true;
            t.minFilter = THREE.LinearMipmapLinearFilter;
            t.needsUpdate = true;
            resolve(track(t));
          }, undefined, reject);
        } catch (error) { reject(error); }
      });
    });
    texCache.set(key, p);
  }
  return p;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
let pendingMaterialWork = 0;
/** Includes deferred procedural grain/veining, which network loading managers cannot see. */
export const materialWorkPending = () => pendingMaterialWork > 0;
function scheduleMaterialWork(work: () => void) {
  pendingMaterialWork += 1;
  onIdle(() => {
    try { work(); }
    finally { pendingMaterialWork -= 1; notify(); }
  });
}

// ---------------------------------------------------------------------------
// Detail normal layer
// ---------------------------------------------------------------------------
const microCache = new Map<MicroSurface, THREE.CanvasTexture>();
let flatNormal: THREE.DataTexture | null = null;

function flatNormalTexture(): THREE.DataTexture {
  if (!flatNormal) {
    flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
    flatNormal.wrapS = flatNormal.wrapT = THREE.RepeatWrapping;
    flatNormal.needsUpdate = true;
  }
  return flatNormal;
}

function microTexture(kind: MicroSurface): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  let t = microCache.get(kind);
  if (!t) {
    t = track(new THREE.CanvasTexture(microNormal(kind, 256)));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.LinearSRGBColorSpace;
    t.needsUpdate = true;
    microCache.set(kind, t);
  }
  return t;
}

/**
 * Blend a second, much finer normal map on top of whatever normal the material
 * already has.
 *
 * Implemented with `onBeforeCompile` because three has no second normal slot.
 * We append after `#include <normal_fragment_maps>`, where `tbn` and `normal`
 * are both live, and perturb the already-computed normal by the detail map's
 * tangent-space XY. The injection is verified: if the include token is missing
 * (a future three refactor) we leave the material untouched rather than ship a
 * broken shader.
 *
 * `baseTileM` is the world size of one repeat of the BASE map, because
 * `vNormalMapUv` is already divided by it; `detailTileM` is the world size we
 * want one repeat of the detail map to cover.
 */
export function attachDetailNormal(
  m: THREE.MeshPhysicalMaterial,
  opts: { kind: MicroSurface; baseTileM: number; baseTileVM?: number; detailTileM?: number; strength?: number },
): boolean {
  if (!detailNormalEnabled) return false;
  // Mirror-smooth and mirror-metallic surfaces must never take a detail normal.
  // At roughness ~0 every micro-facet becomes a hard specular glint, so a
  // bathroom mirror renders as black speckle instead of a reflection. Polished
  // stone and chrome have the same problem in milder form.
  if (m.roughness <= 0.1 || (m.metalness >= 0.9 && m.roughness <= 0.2)) return false;
  const map = microTexture(opts.kind);
  if (!map) return false;
  const baseTile = Number.isFinite(opts.baseTileM) && opts.baseTileM > 0 ? opts.baseTileM : 1;
  const detailTile = Number.isFinite(opts.detailTileM) && (opts.detailTileM ?? 0) > 0 ? (opts.detailTileM as number) : 0.05;
  const scale = Math.min(200, Math.max(0.5, baseTile / detailTile));
  const scaleV = Math.min(200, Math.max(0.5, (opts.baseTileVM ?? baseTile) / detailTile));
  const strength = Math.min(1.5, Math.max(0, opts.strength ?? 0.35));
  // the injection point only exists when a tangent-space normal map is bound
  if (!m.normalMap) { m.normalMap = flatNormalTexture(); m.normalScale.set(1, 1); }

  m.userData.detailNormal = { kind: opts.kind, scale, scaleV, strength };
  m.onBeforeCompile = (shader) => {
    const token = '#include <normal_fragment_maps>';
    if (!shader.fragmentShader.includes(token)) return;
    shader.uniforms.uDetailNormalMap = { value: map };
    shader.uniforms.uDetailNormalScale = { value: new THREE.Vector2(scale, scaleV) };
    shader.uniforms.uDetailNormalStrength = { value: strength };
    shader.fragmentShader =
      'uniform sampler2D uDetailNormalMap;\nuniform vec2 uDetailNormalScale;\nuniform float uDetailNormalStrength;\n'
      + shader.fragmentShader.replace(
        token,
        `${token}
#if defined( USE_NORMALMAP_TANGENTSPACE )
	{
		vec3 detailN = texture2D( uDetailNormalMap, vNormalMapUv * uDetailNormalScale ).xyz * 2.0 - 1.0;
		normal = normalize( normal + tbn * vec3( detailN.xy * uDetailNormalStrength, 0.0 ) );
	}
#endif`,
      );
  };
  m.customProgramCacheKey = () => `mh-detail-${opts.kind}-${scale.toFixed(2)}-${scaleV.toFixed(2)}-${strength.toFixed(2)}`;
  m.needsUpdate = true;
  return true;
}

// ---------------------------------------------------------------------------
// Per-category realism
// ---------------------------------------------------------------------------
const MICRO_FOR_CATEGORY: Partial<Record<MaterialDef['category'], MicroSurface>> = {
  paint: 'paint',
  wood: 'wood', hardwood: 'wood', engineered: 'wood', cedar: 'wood', 'butcher-block': 'wood', lvp: 'wood', composite: 'wood',
  quartz: 'stone', granite: 'stone', marble: 'stone', quartzite: 'stone', stone: 'stone', terrazzo: 'stone',
  'stone-veneer': 'stone', slate: 'stone', brick: 'stone', pavers: 'stone', gravel: 'stone', concrete: 'stone',
  stucco: 'plaster', 'fiber-cement': 'plaster', 'asphalt-shingle': 'plaster', 'clay-tile': 'ceramic',
  porcelain: 'ceramic', ceramic: 'ceramic', 'glass-tile': 'ceramic', acrylic: 'ceramic', 'cast-iron': 'ceramic',
  metal: 'metal', 'metal-roof': 'metal', finish: 'metal', laminate: 'paint', vinyl: 'paint', grass: 'fabric',
};

const DETAIL_TILE_M: Record<MicroSurface, number> = {
  paint: 0.07, plaster: 0.09, wood: 0.05, stone: 0.045, ceramic: 0.03, metal: 0.022, fabric: 0.012,
};
const DETAIL_STRENGTH: Record<MicroSurface, number> = {
  paint: 0.22, plaster: 0.34, wood: 0.30, stone: 0.28, ceramic: 0.18, metal: 0.26, fabric: 0.40,
};

const BRUSHED_RE = /brush|satin|nickel|stainless|pewter|bronze|graphite|champagne/i;
const POLISHED_RE = /polish|chrome|mirror|gloss/i;

/**
 * Draw the brush on a flat-colour metal.
 *
 * Deferred to an idle callback for the same reason every other procedural map
 * is: the material is usable as a colour immediately and gains its grain a
 * frame or two later. The canvas is deliberately small — the brush repeats
 * every 0.25 m, so 512 px is 0.5 mm per texel, finer than the scratches it is
 * drawing — and it is cached per colour+direction so a kitchen's twelve pulls
 * and its faucet share one.
 */
const brushCache = new Map<string, ProceduralResult>();
export function attachBrush(m: THREE.MeshPhysicalMaterial, color: string, direction: 'x' | 'y' | 'radial', seedFrom: string) {
  const grit = m.roughness >= 0.45 ? 0.85 : 0.45;
  const key = `${color}|${direction}|${grit}`;
  const targetRough = m.roughness;
  scheduleMaterialWork(() => {
    let res = brushCache.get(key);
    if (!res) {
      // the brush repeats every 0.25 m, so 512 px is already 0.5 mm a texel —
      // finer than the scratches it is drawing. A phone gets half that.
      const px = Math.min(512, Math.max(256, proceduralQuality() / 2));
      const built = runProcedural('brushed-metal', {
        color, direction, spanM: 0.25, grit, px, seed: hashSeed(seedFrom),
      });
      if (!built) return;
      brushCache.set(key, built);
      res = built;
    }
    const repeat = 1 / Math.max(0.01, res.spanM);
    m.map = canvasTexture(res.canvas, repeat, repeat, true);
    m.color.set('#ffffff');
    // 0.35 is microns of relief: any more and satin steel reads as corrugation
    m.normalMap = canvasTexture(normalFromCanvas(res.canvas, 0.35), repeat, repeat, false);
    m.normalScale.set(0.25, 0.25);
    m.roughnessMap = canvasTexture(roughnessFromCanvas(res.canvas, targetRough, Math.min(1, targetRough * 1.45)), repeat, repeat, false);
    m.roughness = 1; // the map now carries the absolute value
    // re-anchor the micro layer: the base map's repeat changed under it
    attachDetailNormal(m, { kind: 'metal', baseTileM: res.spanM, detailTileM: DETAIL_TILE_M.metal, strength: DETAIL_STRENGTH.metal });
    m.needsUpdate = true;
    notify();
  });
}

/** Stable small integer from an id, so a material's grain is the same every session. */
function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100000;
}

/**
 * Everything that is true of a real surface but is not in the catalog recipe.
 * Kept deliberately conservative: these are multipliers on an already-tuned
 * recipe, not a second opinion about what the material is.
 */
function applyRealism(m: THREE.MeshPhysicalMaterial, def: MaterialDef, baseTileM: number, baseTileVM = baseTileM) {
  const r = def.pbr;
  const text = `${def.id} ${def.name} ${(def.tags ?? []).join(' ')}`;

  // --- brushed metal: a stretched highlight instead of a chrome ball
  if (r.metalness >= 0.55 && BRUSHED_RE.test(text) && !POLISHED_RE.test(text)) {
    m.anisotropy = 0.55;
    // the brush runs along the long axis of a fixture, which is vertical for
    // faucets and horizontal for appliance panels
    const acrossPanel = def.group === 'appliance-finish';
    m.anisotropyRotation = acrossPanel ? 0 : Math.PI / 2;
    m.roughness = Math.min(1, Math.max(m.roughness, 0.22));
    // ...and the brush itself. `anisotropy` alone stretches the HIGHLIGHT but
    // leaves the surface mirror-smooth between highlights, which is why a
    // stainless fridge door and a brushed-nickel pull were both reading as
    // tinted chrome: nothing in the catalog carries a map for them (every
    // `finish(...)` entry and every `app-*` finish is a flat colour and a
    // roughness scalar), and `brushedMetal` had shipped in procedural.ts from
    // the start with no caller. The streaks go into the normal AND the
    // roughness, because what you actually see on satin steel is the roughness
    // varying along the grain.
    if (!r.texture && !r.procedural) attachBrush(m, r.color ?? '#ffffff', acrossPanel ? 'x' : 'y', def.id);
  }

  // --- lacquered cabinet paint has a real clear film over the colour.
  //     The film is smoother than the paint under it — that is what a clear
  //     coat IS — so its roughness follows the substrate down instead of
  //     sitting at a fixed 0.28, which made a gloss-lacquer door and a flat
  //     one carry identical reflections.
  if (def.group === 'cabinet-paint' && (r.clearcoat ?? 0) === 0) {
    m.clearcoat = 0.32;
    m.clearcoatRoughness = THREE.MathUtils.clamp(m.roughness * 0.45, 0.06, 0.3);
  }
  if (def.group === 'exterior-paint' && (r.clearcoat ?? 0) === 0) {
    m.clearcoat = 0.12;
    m.clearcoatRoughness = THREE.MathUtils.clamp(m.roughness * 0.7, 0.25, 0.6);
  }

  // --- glass: transmission needs a thickness or it renders as a flat tint,
  //     and iridescence must stay off (it reads as an oil slick on windows)
  if ((r.transmission ?? 0) > 0) {
    m.thickness = Math.max(m.thickness, 0.006);
    m.iridescence = 0;
    m.specularIntensity = 1;
    // only genuinely see-through glass stops writing depth; a lightly
    // transmissive resin or onyx still needs to occlude what is behind it
    if ((r.transmission ?? 0) > 0.5) m.depthWrite = false;
  }

  // --- fabrics and grass get sheen so they do not read as painted plastic
  if (def.category === 'grass' || /fabric|linen|velvet|wool|jute|sisal/i.test(text)) {
    m.sheen = Math.max(m.sheen, 0.6);
    m.sheenRoughness = 0.85;
    m.sheenColor.set('#ffffff');
  }

  // --- crevices: the ARM/cavity map is already bound; make it actually bite
  if (m.aoMap) m.aoMapIntensity = Math.min(1.4, Math.max(m.aoMapIntensity, 0.85));

  // --- detail normal
  const kind = MICRO_FOR_CATEGORY[def.category] ?? 'plaster';
  attachDetailNormal(m, {
    kind,
    baseTileM,
    baseTileVM,
    detailTileM: DETAIL_TILE_M[kind],
    strength: DETAIL_STRENGTH[kind] * (r.normalScale !== undefined ? Math.min(1.4, 0.6 + r.normalScale) : 1),
  });
}

/** Build (or fetch cached) a physical material for a catalog entry. Maps stream in asynchronously. */
export function buildMaterial(def: MaterialDef): THREE.MeshPhysicalMaterial {
  const cached = matCache.get(def.id);
  if (cached) return cached;
  const r: PBRRecipe = def.pbr;
  // Polished mineral surfaces already reflect through the dielectric BRDF.
  // An additional lacquer lobe adds a coating that bare stone doesn't have.
  // Retain the specified polish
  // (roughness); clearcoat belongs to coated paint/wood, not bare stone.
  const bareMineral = ['quartz', 'granite', 'marble', 'quartzite', 'porcelain', 'stone', 'terrazzo'].includes(def.category);
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(r.color ?? '#ffffff'),
    roughness: r.roughness,
    metalness: r.metalness,
    envMapIntensity: r.envMapIntensity ?? 1.0,
    clearcoat: bareMineral ? 0 : r.clearcoat ?? 0,
    clearcoatRoughness: r.clearcoatRoughness ?? 0.2,
    sheen: r.sheen ?? 0,
    transmission: r.transmission ?? 0,
    ior: r.ior ?? 1.5,
    transparent: (r.transmission ?? 0) > 0,
    emissive: new THREE.Color(r.emissive ?? '#000000'),
    emissiveIntensity: r.emissive ? 1.2 : 0,
    side: THREE.FrontSide,
    dithering: true,
  });
  m.name = def.id;
  m.userData.materialId = def.id;
  applyMetalEnv(m);
  matCache.set(def.id, m);

  if (r.procedural) {
    // Heavy canvas work off the first-paint path: the material is usable
    // immediately as a flat colour and gains its maps a frame or two later.
    scheduleMaterialWork(() => { buildProcedural(m, r, def); });
    return m;
  }

  if (r.texture) {
    const tileM = r.tileM ?? 1;
    const base = `/textures/${r.texture}`;
    const useDiffuse = r.useDiffuse !== false;
    const jobs: Promise<void>[] = [];
    if (useDiffuse) {
      jobs.push(loadTexture(`${base}/diff.webp`, { srgb: true, tileM, rotate90: r.rotate90 }).then((t) => { m.map = t; if (!r.color) m.color.set('#ffffff'); }));
    }
    jobs.push(loadTexture(`${base}/nor.webp`, { tileM, rotate90: r.rotate90 }).then((t) => { m.normalMap = t; const ns = r.normalScale ?? 0.6; m.normalScale.set(ns, ns); }));
    jobs.push(loadTexture(`${base}/arm.webp`, { tileM, rotate90: r.rotate90 }).then((t) => {
      m.aoMap = t; m.aoMapIntensity = useDiffuse ? 0.9 : 0.5;
      m.roughnessMap = t; m.metalnessMap = t;
      // scalar roughness multiplies the map (map values ~0.3–0.9); lift scalar so target roughness lands
      m.roughness = Math.min(1, r.roughness * 1.6);
      m.metalness = r.metalness;
    }));
    Promise.all(jobs)
      .then(() => { applyRealism(m, def, tileM); m.needsUpdate = true; notify(); })
      .catch(() => { applyRealism(m, def, tileM); m.needsUpdate = true; notify(); });
    return m;
  }

  // flat-colour recipes (paint, solid finishes) still deserve micro-structure
  applyRealism(m, def, r.tileM ?? 1);
  m.needsUpdate = true;
  return m;
}

// ---------------------------------------------------------------------------
// Procedural surfaces
// ---------------------------------------------------------------------------
type ProceduralKind = 'slab' | 'tile' | 'plank' | 'siding' | 'wood' | 'quartz' | 'grouted-slab' | 'brushed-metal' | 'fabric' | 'painted-wall';

/** Run the generator named by a recipe. Unknown kinds return null (never throw). */
export function runProcedural(kind: string, options: Record<string, unknown>): ProceduralResult | null {
  if (typeof document === 'undefined') return null;
  try {
    switch (kind as ProceduralKind) {
      case 'slab': return veinedSlab(options as unknown as Parameters<typeof veinedSlab>[0]);
      case 'tile': return tiledSurface(options as unknown as Parameters<typeof tiledSurface>[0]);
      case 'plank': return plankFloor(options as unknown as Parameters<typeof plankFloor>[0]);
      case 'siding': return lapSiding(options as unknown as Parameters<typeof lapSiding>[0]);
      case 'wood': return woodGrain(options as unknown as Parameters<typeof woodGrain>[0]);
      case 'quartz': return quartzWithSpeckle(options as unknown as Parameters<typeof quartzWithSpeckle>[0]);
      case 'grouted-slab': return groutedSlab(options as unknown as Parameters<typeof groutedSlab>[0]);
      case 'brushed-metal': return brushedMetal(options as unknown as Parameters<typeof brushedMetal>[0]);
      case 'fabric': return fabricWeave(options as unknown as Parameters<typeof fabricWeave>[0]);
      case 'painted-wall': return paintedWall(options as unknown as Parameters<typeof paintedWall>[0]);
      default: return null;
    }
  } catch {
    return null;
  }
}

/**
 * `repeatU` / `repeatV` are 1 / the metres the canvas represents on each axis.
 * They differ for a plank floor, whose drawing is a few boards wide and a
 * couple of board-LENGTHS long. Rotation composes correctly with an uneven
 * repeat: three builds the UV matrix as scale ∘ rotate, so a quarter turn
 * swaps which world axis each repeat applies to — exactly what turning the
 * boards means.
 */
function canvasTexture(canvas: HTMLCanvasElement, repeatU: number, repeatV: number, srgb: boolean, rotate90?: boolean): THREE.CanvasTexture {
  const t = track(new THREE.CanvasTexture(canvas));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  t.repeat.set(repeatU, repeatV);
  if (rotate90) { t.rotation = Math.PI / 2; t.center.set(0.5, 0.5); }
  t.needsUpdate = true;
  return t;
}

/**
 * Build the canvas-generated maps for a procedural recipe. Colour, normal,
 * roughness and cavity all come from the same drawing, so grout lines and plank
 * joints catch light AND sit in shadow instead of being painted-on lines.
 */
function buildProcedural(m: THREE.MeshPhysicalMaterial, r: PBRRecipe, def?: MaterialDef) {
  const spec = r.procedural;
  if (!spec) return;
  const res = runProcedural(spec.kind, spec.options);
  if (!res) return;
  const repeatU = 1 / Math.max(0.01, res.spanM);
  const repeatV = 1 / Math.max(0.01, res.spanVM ?? res.spanM);

  m.map = canvasTexture(res.canvas, repeatU, repeatV, true, r.rotate90);
  m.color.set('#ffffff');

  // Relief, roughness and cavity come from the HEIGHT drawing when the
  // generator made one, and from the colour drawing when it did not. For wood,
  // stone and siding the two are the same thing — a pore, a vein and a lap
  // shadow really are darker and lower. Tile is where they part company: white
  // grout on a navy subway tile is LIGHTER than the face, so deriving relief
  // from colour pushed the joint out into a ridge and made the grout the
  // glossiest thing on the wall. (Measured over the catalog: 9 of the 17 tile
  // recipes have grout lighter than their tile.)
  const relief = res.height ?? res.canvas;
  // Honing and polishing level a slab's minerals into a single surface.
  // Dark veins/flecks are pigmentation, not trenches. A one-texel flat base
  // normal keeps the fine finish layer without manufacturing ridges from
  // every black vein, and saves a full normal-map allocation for each slab.
  const levelledStone = (spec.kind === 'slab' || spec.kind === 'quartz') && def?.category !== 'concrete';
  m.normalMap = levelledStone ? flatNormalTexture()
    : canvasTexture(normalFromCanvas(relief, spec.reliefStrength ?? 2.2), repeatU, repeatV, false, r.rotate90);
  // A polished slab is FLAT: its veins are colour, not relief. Any bump on a
  // low-roughness surface turns every light in the room into a streak of
  // white along the vein, which is what made dark counters look broken.
  const polishedSlab = spec.kind === 'slab' && r.roughness < 0.3;
  const ns = polishedSlab ? Math.min(r.normalScale ?? 0.5, 0.08) : (r.normalScale ?? 0.5);
  m.normalScale.set(ns, ns);

  if (spec.jointRoughness !== undefined && !levelledStone) {
    m.roughnessMap = canvasTexture(roughnessFromCanvas(relief, r.roughness, spec.jointRoughness), repeatU, repeatV, false, r.rotate90);
    m.roughness = 1;
    // the same drawing gives us free contact darkening in every joint
    m.aoMap = canvasTexture(cavityFromCanvas(relief, 0.7), repeatU, repeatV, false, r.rotate90);
    m.aoMapIntensity = 1;
  } else if (spec.kind === 'brushed-metal') {
    // A photo-matched metal is drawn by the same generator the catalog metals
    // now use, but its recipe carries no `jointRoughness` — so it was getting
    // the brush in its COLOUR and its normal and nothing in its roughness,
    // and a custom stainless fridge ended up glossier and flatter than the
    // catalog stainless standing next to it. What you actually see on satin
    // steel is the roughness varying along the grain, so derive it here from
    // the same drawing, the way attachBrush does for the catalog entries.
    m.roughnessMap = canvasTexture(roughnessFromCanvas(res.canvas, r.roughness, Math.min(1, r.roughness * 1.45)), repeatU, repeatV, false, r.rotate90);
    m.roughness = 1;
  }
  if (def) applyRealism(m, def, levelledStone ? 1 : res.spanM, levelledStone ? 1 : (res.spanVM ?? res.spanM));
  else attachDetailNormal(m, { kind: 'stone', baseTileM: res.spanM });
  m.needsUpdate = true;
  notify();
}

/**
 * Ad-hoc procedural material for scene props that are not catalog entries
 * (a fabric roman shade, a brushed-metal appliance panel, a painted soffit).
 * Cached by `id`; generation happens in an idle callback.
 */
const adhocCache = new Map<string, THREE.MeshPhysicalMaterial>();
export function makeProceduralMaterial(
  id: string,
  kind: ProceduralKind,
  options: Record<string, unknown>,
  physical: Partial<{ roughness: number; metalness: number; reliefStrength: number; jointRoughness: number; normalScale: number; color: string; micro: MicroSurface; sheen: number; clearcoat: number }> = {},
): THREE.MeshPhysicalMaterial {
  const hit = adhocCache.get(id);
  if (hit) return hit;
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(physical.color ?? '#ffffff'),
    roughness: physical.roughness ?? 0.6,
    metalness: physical.metalness ?? 0,
    sheen: physical.sheen ?? 0,
    clearcoat: physical.clearcoat ?? 0,
    side: THREE.FrontSide,
    dithering: true,
  });
  m.name = id;
  adhocCache.set(id, m);
  scheduleMaterialWork(() => {
    const res = runProcedural(kind, options);
    if (!res) return;
    const repeatU = 1 / Math.max(0.01, res.spanM);
    const repeatV = 1 / Math.max(0.01, res.spanVM ?? res.spanM);
    m.map = canvasTexture(res.canvas, repeatU, repeatV, true);
    m.color.set('#ffffff');
    const relief = res.height ?? res.canvas;
    m.normalMap = canvasTexture(normalFromCanvas(relief, physical.reliefStrength ?? 2.0), repeatU, repeatV, false);
    const ns = physical.normalScale ?? 0.5;
    m.normalScale.set(ns, ns);
    if (physical.jointRoughness !== undefined) {
      m.roughnessMap = canvasTexture(roughnessFromCanvas(relief, m.roughness, physical.jointRoughness), repeatU, repeatV, false);
      m.roughness = 1;
    }
    m.aoMap = canvasTexture(cavityFromCanvas(relief, 0.6), repeatU, repeatV, false);
    m.aoMapIntensity = 0.9;
    attachDetailNormal(m, { kind: physical.micro ?? 'plaster', baseTileM: res.spanM });
    m.needsUpdate = true;
    notify();
  });
  return m;
}

/**
 * Resolve a material id, falling back to the room type's default for that slot
 * before the last-resort white. Without the slot-aware step an unset selection
 * turns every surface the same white, which reads as a broken scene.
 */
export function materialFor(id: string | undefined, slot?: string, roomType?: RoomType): THREE.MeshPhysicalMaterial {
  let def = getMaterial(id);
  // A selection that does not resolve is not a cosmetic miss: the surface
  // silently becomes the room's DEFAULT, which is a different material with a
  // different colour and a different price. A photo-matched walnut island
  // whose `custom-…` id was never registered drew as `cab-hale-navy`, and
  // nothing anywhere said so — the client saw a navy island and had no way to
  // know the twin had quietly stopped representing their kitchen. Say it out
  // loud, once per id, so it is visible in the console instead of only in the
  // picture.
  if (!def && id) warnUnresolved(id, slot);
  if (!def && slot) {
    const order: RoomType[] = roomType ? [roomType, 'kitchen', 'bathroom', 'exterior', 'floorplan'] : ['kitchen', 'bathroom', 'exterior', 'floorplan'];
    for (const rt of order) {
      const fallbackId = (DEFAULT_SELECTIONS[rt] as Record<string, string>)[slot];
      if (fallbackId) { def = getMaterial(fallbackId); if (def) break; }
    }
  }
  return buildMaterial(def ?? CATALOG_BY_ID['cab-pure-white']);
}

/** Every id we have already complained about, so a per-frame redraw stays quiet. */
const warned = new Set<string>();
function warnUnresolved(id: string, slot?: string) {
  const key = `${slot ?? '-'}:${id}`;
  if (warned.has(key)) return;
  warned.add(key);
  const where = slot ? ` for slot "${slot}"` : '';
  const hint = id.startsWith('custom-')
    ? ' — a photo-matched material whose definition was never registered in this session; re-analysing the photo rebuilds it'
    : '';
  console.warn(`[materials] "${id}"${where} did not resolve; drawing the room default instead${hint}`);
}

/** Ids that failed to resolve this session, for tests and diagnostics. */
export function unresolvedMaterialIds(): string[] { return [...warned]; }

/** Subscribe to "textures arrived" so React re-renders meshes whose material just got maps. */
export function useMaterialTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return tick;
}

/** Material for a slot, driven by the project's current selections. */
export function useSlotMaterial(slot: string, skipCatalog = false, appearanceId?: string, appearancePlane?: AppearancePlane): THREE.MeshPhysicalMaterial {
  const id = useProjectStore((s) => (s.ui.jarvisPreview?.snapshot.selections ?? s.project.selections)[slot]);
  const roomType = useProjectStore((s) => s.ui.jarvisPreview?.snapshot.spec.roomType ?? s.project.roomType);
  const mode = useScanView(s => s.mode);
  const capturedMaterial = useReconstructedMaterial(slot, appearanceId, appearancePlane);
  const objectTransform = useScanObjectTransform();
  const reconstructed = useMemo(() => capturedMaterial ? transformedCapturedMaterial(capturedMaterial, objectTransform.delta, objectTransform.inverse) : null, [capturedMaterial, objectTransform]);
  useEffect(() => () => { if (reconstructed && reconstructed !== capturedMaterial) reconstructed.dispose(); }, [reconstructed, capturedMaterial]);
  const photoObservations = useProjectStore(s => s.project.overrides.scanPhotoFinishes);
  const sourceSpec = useProjectStore(s => s.project.spec);
  const photoFinish = useMemo(() => {
    const project = useProjectStore.getState().project;
    return scanPhotoFinishFor({ ...project, spec: sourceSpec, overrides: { ...project.overrides, scanPhotoFinishes: photoObservations } }, slot);
  }, [photoObservations, slot, sourceSpec]);
  const objectColors = useReconstructedObjectFaceColors(slot, appearanceId, !!photoFinish && slot === 'island_cabinets');
  const floorPatch = useReconstructedFloorPatch(appearanceId ?? '');
  const floorFrame = useMemo(() => floorPatch ? deriveReconstructedFloorFinish(floorPatch) : null, [floorPatch]);
  const materialTick = useMaterialTick();
  const photoMaterial = useMemo(() => {
    // Async catalog maps arrive through this external material notification.
    void materialTick;
    if (!photoFinish || mode !== 'model' || skipCatalog) return null;
    const faces: number[][] = Array.isArray(reconstructed?.userData.faces) ? reconstructed.userData.faces.filter((f: { status?: string; color?: unknown }) => f.status === 'supported' && Array.isArray(f.color)).map((f: { color: number[] }) => f.color) : [];
    if (!photoFinishAgreesWithFaces(photoFinish.observation, faces, { objectColors })) return null;
    const original = materialFor(photoFinish.id, slot, roomType);
    if (!floorPatch || !['flooring', 'floor_tile'].includes(slot)) return { material: original, textures: [] as THREE.Texture[], owned: false };
    // Photos have no registered pose. Keep the observed floor grain/frame while
    // replacing its appearance; photo-relative "left to right" cannot rotate it.
    const material = original.clone(), textures: THREE.Texture[] = [];
    material.onBeforeCompile = original.onBeforeCompile; material.customProgramCacheKey = original.customProgramCacheKey;
    for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap', 'bumpMap'] as const) {
      const base = original[key]; if (!base) continue;
      const map = base.clone(); map.matrix.copy(photoFloorTextureMatrix(base, floorPatch, floorFrame, getMaterial(photoFinish.id)?.pbr));
      map.matrixAutoUpdate = false; map.channel = 1; map.needsUpdate = true;
      material[key] = map; textures.push(map);
    }
    return { material, textures, owned: true };
  }, [photoFinish, mode, skipCatalog, reconstructed, slot, roomType, objectColors, floorPatch, floorFrame, materialTick]);
  useEffect(() => () => { if (photoMaterial?.owned) { photoMaterial.material.dispose(); photoMaterial.textures.forEach(t => t.dispose()); } }, [photoMaterial]);
  const showsDesign = useProjectStore(s => scanSlotShowsDesign(scanPreviewFinishProject(s.project, s.ui.jarvisPreview?.snapshot, s.ui.jarvisPreview?.finishChoices), slot));
  const neutralColor = useProjectStore(s => {
    const finish = scanSlotFinish(scanPreviewFinishProject(s.project, s.ui.jarvisPreview?.snapshot, s.ui.jarvisPreview?.finishChoices), slot, mode);
    return finish.kind === 'neutral' ? finish.color : null;
  });
  const gl = useThree((s) => s.gl);
  // belt and braces: SceneCanvas reads the cap before anything is built, but a
  // material hook can also run inside a canvas that was mounted some other way
  useEffect(() => { setMaxAnisotropy(gl.capabilities.getMaxAnisotropy()); }, [gl]);
  return useMemo(() => !showsDesign && photoMaterial ? photoMaterial.material : reconstructed && mode === 'model' && !showsDesign ? reconstructed : neutralColor ? neutralScanMaterial(neutralColor) : skipCatalog ? materialFor(undefined) : materialFor(id, slot, roomType), [id, slot, roomType, neutralColor, skipCatalog, reconstructed, mode, showsDesign, photoMaterial]);
}

const neutralScanMaterials = new Map<string, THREE.MeshPhysicalMaterial>();
/** Fresh, texture-free geometry materials: never clone a demo finish, since
 * its wood grain, quartz veining, bump or metallic response would remain. */
export function neutralScanMaterial(color: string): THREE.MeshPhysicalMaterial {
  let material = neutralScanMaterials.get(color);
  if (!material) {
    material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.9, metalness: 0, clearcoat: 0, reflectivity: 0.15, side: THREE.DoubleSide });
    material.name = 'scan-unmeasured-finish';
    material.userData.finishProvenance = 'neutral-geometry-preview';
    neutralScanMaterials.set(color, material);
  }
  return material;
}

/** Material by explicit catalog id (for fixed props: stainless, glass, chrome, etc.) */
export function useCatalogMaterial(id: string): THREE.MeshPhysicalMaterial {
  useMaterialTick();
  return useMemo(() => materialFor(id), [id]);
}

// ---------------------------------------------------------------------------
// Fixed utility materials (not in catalog): glass, chrome, fabric, plants...
// ---------------------------------------------------------------------------
const utilCache = new Map<string, THREE.Material>();
export function utilMaterial(kind: 'glass' | 'window-glass' | 'chrome' | 'black-metal' | 'white-plastic' | 'fabric-grey' | 'fabric-linen' | 'leather-tan' | 'plant' | 'soil' | 'water' | 'porcelain' | 'dark-wood' | 'light-wood' | 'rubber' | 'shadow-catcher' | 'sky-grey' | 'emissive-warm' | 'emissive-cool' | 'concrete' | 'mirror' | 'brushed-nickel' | 'brushed-brass' | 'matte-black' | 'stainless' | 'oil-rubbed-bronze' | 'anodized' | 'towel' | 'paper' | 'ceramic-matte'): THREE.Material {
  const c = utilCache.get(kind);
  if (c) return c;
  let m: THREE.Material;
  switch (kind) {
    case 'glass': m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0, transmission: 0.95, thickness: 0.01, ior: 1.5, transparent: true, opacity: 1, envMapIntensity: 1.2, depthWrite: false }); break;
    // envMapIntensity was 1.5: the pane reflected the HDRI's bright patches on
    // top of the sky plane behind it and every window rendered as a white slab.
    case 'window-glass': m = new THREE.MeshPhysicalMaterial({ color: '#dbe9f1', roughness: 0.04, metalness: 0, transmission: 0.92, thickness: 0.004, ior: 1.5, transparent: true, envMapIntensity: 0.35, depthWrite: false }); break;
    case 'chrome': m = new THREE.MeshPhysicalMaterial({ color: '#e6e8ea', roughness: 0.08, metalness: 1, envMapIntensity: 1.3 }); break;
    case 'black-metal': m = new THREE.MeshPhysicalMaterial({ color: '#1c1d1f', roughness: 0.45, metalness: 0.8 }); break;
    case 'white-plastic': m = new THREE.MeshPhysicalMaterial({ color: '#f4f4f1', roughness: 0.4, metalness: 0 }); break;
    case 'fabric-grey': m = new THREE.MeshPhysicalMaterial({ color: '#9a9a96', roughness: 0.95, metalness: 0, sheen: 0.7, sheenRoughness: 0.85, sheenColor: new THREE.Color('#ffffff') }); break;
    case 'fabric-linen': m = new THREE.MeshPhysicalMaterial({ color: '#d9d2c3', roughness: 0.95, metalness: 0, sheen: 0.7, sheenRoughness: 0.8, sheenColor: new THREE.Color('#fff8ec') }); break;
    case 'towel': m = new THREE.MeshPhysicalMaterial({ color: '#eceae4', roughness: 1, metalness: 0, sheen: 0.9, sheenRoughness: 0.95, sheenColor: new THREE.Color('#ffffff') }); break;
    case 'leather-tan': m = new THREE.MeshPhysicalMaterial({ color: '#8b5a34', roughness: 0.55, metalness: 0, clearcoat: 0.2 }); break;
    case 'plant': m = new THREE.MeshPhysicalMaterial({ color: '#3f7a3a', roughness: 0.7, metalness: 0, side: THREE.DoubleSide, sheen: 0.3, sheenRoughness: 0.6 }); break;
    case 'soil': m = new THREE.MeshPhysicalMaterial({ color: '#3b2b1e', roughness: 1, metalness: 0 }); break;
    case 'water': m = new THREE.MeshPhysicalMaterial({ color: '#4aa3c7', roughness: 0.05, metalness: 0.1, transmission: 0.6, transparent: true, ior: 1.33 }); break;
    case 'porcelain': m = new THREE.MeshPhysicalMaterial({ color: '#f7f7f4', roughness: 0.12, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.08 }); break;
    case 'ceramic-matte': m = new THREE.MeshPhysicalMaterial({ color: '#efece6', roughness: 0.62, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.5 }); break;
    case 'dark-wood': m = new THREE.MeshPhysicalMaterial({ color: '#4a3526', roughness: 0.55, metalness: 0 }); break;
    case 'light-wood': m = new THREE.MeshPhysicalMaterial({ color: '#c9ad85', roughness: 0.6, metalness: 0 }); break;
    case 'rubber': m = new THREE.MeshPhysicalMaterial({ color: '#222', roughness: 0.9, metalness: 0 }); break;
    case 'paper': m = new THREE.MeshPhysicalMaterial({ color: '#f6f4ef', roughness: 0.92, metalness: 0, sheen: 0.2 }); break;
    case 'shadow-catcher': m = new THREE.ShadowMaterial({ opacity: 0.35 }); break;
    case 'sky-grey': m = new THREE.MeshBasicMaterial({ color: '#dfe6ec' }); break;
    case 'emissive-warm': m = new THREE.MeshPhysicalMaterial({ color: '#fff3dc', emissive: '#ffd9a0', emissiveIntensity: 3, roughness: 0.6 }); break;
    case 'emissive-cool': m = new THREE.MeshPhysicalMaterial({ color: '#f5f8ff', emissive: '#e8f0ff', emissiveIntensity: 2.5, roughness: 0.6 }); break;
    case 'concrete': m = new THREE.MeshPhysicalMaterial({ color: '#8f8f8a', roughness: 0.9, metalness: 0 }); break;
    case 'mirror': m = new THREE.MeshPhysicalMaterial({ color: '#dfe7ec', roughness: 0.09, metalness: 0.5, envMapIntensity: 3.2 }); break;
    // brushed finishes: anisotropy is what separates "brushed" from "chrome"
    case 'brushed-nickel': m = anisotropicMetal('#c9c8c4', 0.30, 0.6, Math.PI / 2); break;
    case 'brushed-brass': m = anisotropicMetal('#c2a15e', 0.32, 0.6, Math.PI / 2); break;
    case 'stainless': m = anisotropicMetal('#b9bcc0', 0.28, 0.55, 0, 'x'); break;
    case 'anodized': m = anisotropicMetal('#8e9295', 0.42, 0.45, Math.PI / 2); break;
    case 'oil-rubbed-bronze': m = anisotropicMetal('#41352c', 0.44, 0.35, Math.PI / 2); break;
    case 'matte-black': m = new THREE.MeshPhysicalMaterial({ color: '#1a1a1c', roughness: 0.62, metalness: 0.35, clearcoat: 0.1, clearcoatRoughness: 0.7 }); break;
  }
  if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) applyMetalEnv(m as THREE.MeshPhysicalMaterial);
  utilCache.set(kind, m);
  return m;
}

/** A metal whose highlight is stretched along one axis, i.e. actually brushed. */
export function anisotropicMetal(hex: string, roughness = 0.3, anisotropy = 0.6, rotation = Math.PI / 2, brush: 'x' | 'y' | 'radial' | null = 'y'): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: hex, roughness, metalness: 1, envMapIntensity: 1.15 });
  m.anisotropy = Math.min(1, Math.max(0, anisotropy));
  m.anisotropyRotation = rotation;
  attachDetailNormal(m, { kind: 'metal', baseTileM: 0.25, detailTileM: DETAIL_TILE_M.metal, strength: DETAIL_STRENGTH.metal });
  // the utility metals are what faucets, pulls and appliance panels are drawn
  // in, so they get the same real grain the catalog finishes now get
  if (brush) attachBrush(m, hex, brush, `util-${hex}-${brush}`);
  applyMetalEnv(m);
  return m;
}

/** Tinted variant of a utility material (e.g. appliance body colour) */
const tintCache = new Map<string, THREE.MeshPhysicalMaterial>();
export function tintedMetal(hex: string, roughness = 0.3, metalness = 1): THREE.MeshPhysicalMaterial {
  const key = `${hex}|${roughness}|${metalness}`;
  let m = tintCache.get(key);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: hex, roughness, metalness, envMapIntensity: 1.1 });
    if (metalness > 0.5 && roughness > 0.15) { m.anisotropy = 0.35; m.anisotropyRotation = 0; }
    attachDetailNormal(m, { kind: metalness > 0.5 ? 'metal' : 'paint', baseTileM: 0.4, detailTileM: 0.03, strength: 0.22 });
    applyMetalEnv(m);
    tintCache.set(key, m);
  }
  return m;
}

/** Warm up: pre-build materials for a set of selections so first paint has maps. */
export function preloadSelections(selections: Record<string, string>) {
  Object.values(selections).forEach((id) => { const d = getMaterial(id); if (d) buildMaterial(d); });
}

/** Diagnostics: how many distinct GPU materials are live. */
export function materialCacheSize(): number { return matCache.size + utilCache.size + tintCache.size + adhocCache.size; }
