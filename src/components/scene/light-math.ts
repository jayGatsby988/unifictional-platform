/**
 * The arithmetic behind the lighting rigs, with no React and no renderer.
 *
 * `Lighting.tsx` is a client component that pulls in R3F, drei and the
 * reconciler, so nothing headless can import it — which is why the checks that
 * cover it have historically been regexes over its source. Everything in this
 * file is a pure function of numbers, so `scripts/check-3d.ts` can call it and
 * assert the actual values: that a shadow's penumbra is the same width in
 * metres on every quality tier, that the depth bias is a constant world
 * distance rather than a constant fraction of whatever range the camera
 * happens to have, and that an under-cabinet strip is aimed at the backsplash.
 */
import * as THREE from 'three';
import { getMaterial } from '@/lib/materials/catalog';
import { materialColor } from '@/lib/materials/color';

export type LightQuality = 'high' | 'balanced' | 'performance';

/**
 * The device's own tier, measured once from what the browser will tell us.
 *
 * One definition, used by the canvas (which it drives the post chain, the
 * device pixel ratio and the texture budget from) AND by the lighting rigs. It
 * used to live only in SceneCanvas, which is how the rigs ended up not being
 * wired to it at all.
 */
export function deviceQuality(): LightQuality {
  if (typeof navigator === 'undefined') return 'balanced';
  return qualityForDevice(navigator);
}

export function qualityForDevice(device: { userAgent: string; hardwareConcurrency?: number; deviceMemory?: number; maxTouchPoints?: number }): LightQuality {
  const cores = device.hardwareConcurrency ?? 4;
  // WebKit deliberately buckets the reported core count (a six-core iPhone
  // can report four). It cannot identify a slow Apple GPU. Keep the balanced
  // tier on iOS, including iPad's desktop UA; explicit Performance and adaptive
  // resolution remain available. See WebKit's NavigatorBase::hardwareConcurrency.
  const appleMobile = /iPhone|iPad|iPod/i.test(device.userAgent)
    || (/Macintosh/i.test(device.userAgent) && (device.maxTouchPoints ?? 0) > 1);
  if (appleMobile) return 'balanced';
  const mobile = /Mobi|Android/i.test(device.userAgent);
  const memory = device.deviceMemory ?? 4;
  return mobile ? (cores >= 6 && memory >= 4 ? 'balanced' : 'performance') : cores >= 8 ? 'high' : 'balanced';
}

/**
 * WHAT THE QUALITY CONTROL ACTUALLY DOES.
 *
 * One table, read by all three layers — the canvas (pixel ratio, MSAA, AO, the
 * film grade), the material factory (texture resolution, anisotropic
 * filtering, the detail-normal layer) and the lighting rigs (shadow map size,
 * how many window area-lights and shadow-casting cans get built, whether the
 * floor contact pass runs).
 *
 * It is one table because the control was previously three unrelated ones. The
 * canvas knew about dpr and post; `setMaterialQuality` knew about textures;
 * and the rigs knew nothing at all — `KitchenLighting` never passed `quality`,
 * so every interior in the app ran the 'balanced' default no matter what the
 * menu said. A phone still built two rect-area lights and a shadow-casting
 * can, and a desktop on "High" still got a 1024 shadow map. Anything a tier
 * means now has to be written down HERE, where `scripts/check-3d.ts` can read
 * it and assert that the tiers are actually ordered.
 */
export interface QualityTier {
  /** canvas device-pixel-ratio range */
  dpr: [number, number];
  /** procedural texture resolution, px */
  texturePx: 512 | 1024 | 2048;
  /** anisotropic filtering asked for (capped by the GPU) */
  anisotropy: number;
  /** the second, high-frequency normal layer */
  detailNormal: boolean;
  /** MSAA samples on the post composer */
  msaa: number;
  /** screen-space ambient occlusion */
  ao: boolean;
  /** grain, chromatic aberration, contrast and saturation trim */
  grade: boolean;
  /** shadow map edge, texels */
  shadowMap: number;
  /** window rect-area lights the interior rig will build */
  windowRects: number;
  /** recessed cans allowed to cast a shadow */
  castingCans: number;
  /** the floor contact pass (one extra depth traversal, cached) */
  contactShadows: boolean;
}

export const QUALITY: Record<LightQuality, QualityTier> = {
  high: { dpr: [1, 2], texturePx: 2048, anisotropy: 16, detailNormal: true, msaa: 4, ao: true, grade: true, shadowMap: 2048, windowRects: 3, castingCans: 2, contactShadows: true },
  balanced: { dpr: [1, 1.5], texturePx: 1024, anisotropy: 8, detailNormal: true, msaa: 2, ao: true, grade: true, shadowMap: 1024, windowRects: 2, castingCans: 1, contactShadows: true },
  // An honest low tier: no area lights, no AO, no grade, no contact pass, no
  // detail normal, half-resolution textures and 2× filtering. This is the
  // difference between 30 fps and 12 on a contractor's phone, and it has to
  // actually be reachable — 'auto' resolves to it on lower-capacity phones.
  performance: { dpr: [0.75, 1], texturePx: 512, anisotropy: 2, detailNormal: false, msaa: 0, ao: false, grade: false, shadowMap: 512, windowRects: 0, castingCans: 0, contactShadows: false },
};

/** ~14 mm of penumbra at softness 1 — a window edge over a metre of counter. */
export const PENUMBRA_M = 0.014;

/** Shadow map resolution per tier. */
export function shadowMapSize(quality: LightQuality): number { return QUALITY[quality].shadowMap; }

export interface ShadowSettings {
  size: number;
  /** PCF radius, in TEXELS — three's unit */
  radius: number;
  samples: number;
  /** offset along the surface normal, in metres */
  normalBias: number;
  /** how much world space one shadow-map texel covers, in metres (0 = unknown) */
  texelM: number;
}

/**
 * Shadow map resolution, and the PCF radius that puts a CONSTANT world-space
 * penumbra on it.
 *
 * three's `shadow.radius` is measured in TEXELS of the shadow map, so one
 * number means different things at 512 and at 2048. The old table asked for
 * 3.2 texels at high and 1.6 at performance which, over a 6.4 m shadow camera,
 * is a 10 mm blur at high and a 20 mm blur at performance — the softness of
 * every shadow in the room changed when the quality menu did, and the low tier
 * was the SOFTER one. Penumbra is a property of the light (how big the source
 * is), not of the renderer, so it is asked for in metres here and converted
 * through the texel footprint.
 *
 * `normalBias` follows the same logic: shadow acne is a function of how much
 * world space one texel covers, so the offset that cures it is ~1.5 texels. A
 * fixed 20 mm was both too much at 2048 (visible peter-panning — contact
 * shadows floating off the thing casting them) and too little at 512.
 *
 * `extentM` is the width of the shadow camera's frustum where it matters. Pass
 * 0 when there isn't one and the old per-tier constants are used.
 */
export function shadowSettings(quality: LightQuality, softness = 1, extentM = 0): ShadowSettings {
  const size = shadowMapSize(quality);
  const samples = quality === 'high' ? 8 : quality === 'performance' ? 4 : 6;
  const texelM = extentM > 0 ? extentM / size : 0;
  const radius = texelM > 0
    ? THREE.MathUtils.clamp((PENUMBRA_M * softness) / texelM, 0.6, 6)
    : (quality === 'high' ? 3.2 : quality === 'performance' ? 1.6 : 2.4) * softness;
  const normalBias = texelM > 0 ? THREE.MathUtils.clamp(texelM * 1.5, 0.002, 0.03) : 0.02;
  return { size, radius, samples, normalBias, texelM };
}

/** The world-space width of the blur a given setting actually produces, in metres. */
export function penumbraWidthM(s: ShadowSettings): number { return s.radius * s.texelM; }

/**
 * Depth bias for an ORTHOGRAPHIC shadow camera, expressed as a constant world
 * distance. Ortho depth is linear in [0,1] across (far − near), so a fixed
 * `bias` means a different number of millimetres for every shadow camera we
 * build. 0.6 mm is under the thickness of anything we draw.
 */
export const orthoBias = (rangeM: number) => -0.0006 / Math.max(1, rangeM);

/**
 * How far back from straight-down an under-cabinet wash is aimed, in radians.
 *
 * A three RectAreaLight emits along its LOCAL −Z, and the strip's group frame
 * (see `OnWall`) has +z pointing INTO the room. `Rx(-π/2)` therefore sent the
 * light straight at the counter and exactly PARALLEL to the backsplash — the
 * one surface under-cabinet lighting exists to wash got nothing at all, and
 * the whole fixture did was put a hot band on the countertop.
 */
export const UNDERCAB_TILT = 0.44;

/** The rotation an under-cabinet strip's rect light takes, as `[x, y, z]` euler. */
export const underCabRotation = (): [number, number, number] => [-(Math.PI / 2 - UNDERCAB_TILT), 0, 0];

/**
 * Where an under-cabinet strip's light actually goes, in the strip's own frame
 * (+z into the room, −y down). Returns the unit emission direction.
 */
export function underCabAim(tilt = UNDERCAB_TILT): { x: number; y: number; z: number; towardSplash: number } {
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(-(Math.PI / 2 - tilt), 0, 0));
  // fraction of the flux heading at the wall rather than at the counter
  return { x: dir.x, y: dir.y, z: dir.z, towardSplash: Math.abs(dir.z) };
}

/** The slot each room type calls its floor, for the bounce colour. */
export const FLOOR_SLOTS = ['flooring', 'floor_tile', 'floor'];

/**
 * The colour and strength of the floor's bounce, read from the material the
 * user actually chose.
 *
 * Bounce light is the floor's albedo times the light falling on it, and the
 * rig had it as a fixed warm white — so a room over near-black slate lifted
 * its cabinet undersides exactly as much as one over white oak, and lifted
 * them the same colour. A dark walnut floor returns maybe a fifth of what a
 * pale one does, and it returns it BROWN; that difference is most of why two
 * kitchens with the same cabinets photograph differently.
 *
 * The reflectance model is deliberately crude — sRGB luminance standing in for
 * albedo — but the ordering it produces is right, and the gain is bounded so a
 * black floor cannot kill the fill outright (a real room still has walls).
 */
export interface FloorBounce {
  /** the colour the floor kicks back */
  color: string;
  /** how much of it there is, relative to a mid floor (0.35 … 1.3) */
  gain: number;
  /** the floor's own colour, for the hemisphere's ground term */
  floorColor: string | null;
}

export function floorBounce(materialId: string | undefined, moodColor: string): FloorBounce {
  const def = materialId ? getMaterial(materialId) : undefined;
  // `materialColor` is the matcher's own accessor and the only thing that
  // knows where a given kind of entry keeps its colour: inside a procedural
  // recipe's options, at the top of the PBR block, in the swatch, or — for a
  // photographed texture, which is most of the flooring catalog — in the
  // measured TEXTURE_COLORS table. A `swatch` alone is a hex for a drawn
  // material and a texture PATH for a photographed one, and handing that path
  // to THREE.Color logs a warning and silently leaves the colour WHITE, i.e.
  // tells the rig every real-wood floor in the catalog is a mirror.
  const hex = def ? materialColor(def) : null;
  // no readable colour = no opinion: leave the mood's own bounce alone
  if (!hex) return { color: moodColor, gain: 1, floorColor: null };
  const floor = new THREE.Color(hex);
  const lum = 0.2126 * floor.r + 0.7152 * floor.g + 0.0722 * floor.b;
  // half the mood's own colour, half the floor's — the bounce a real room gets
  // off its floor is already mixed with what came off its walls
  const color = new THREE.Color(moodColor).lerp(floor, 0.45);
  return { color: `#${color.getHexString()}`, gain: THREE.MathUtils.clamp(0.35 + lum * 0.95, 0.35, 1.3), floorColor: `#${floor.getHexString()}` };
}

/**
 * The hemisphere light's ground term, tinted by the floor.
 *
 * `groundColor` is the colour of everything facing DOWN — the ceiling, the
 * undersides of the wall cabinets, the inside of the hood — so it is the same
 * physical quantity as the bounce and has to agree with it. The mix is kept to
 * 40% and the mood's own value keeps its lightness: this is the exact knob
 * that, cranked, gave the app its brown-ceiling bug when interiors were lit by
 * a photographic HDRI with a wooden floor.
 */
export function groundTint(moodGround: string, floorColor: string | null, amount = 0.4): string {
  if (!floorColor) return moodGround;
  const c = new THREE.Color(moodGround).lerp(new THREE.Color(floorColor), THREE.MathUtils.clamp(amount, 0, 1));
  return `#${c.getHexString()}`;
}

/**
 * How far the bounce colour moves toward the practicals' colour temperature.
 *
 * The warm/cool split across a room is most of what makes an interior photo
 * read as photographed, and it is not a constant: the more of the scene the
 * lamps are carrying, the more the light coming back off the floor is THEIR
 * colour rather than the sky's. Daylight with the cans on lands about a
 * quarter of the way over; an evening scene is almost all practical.
 */
export const practicalBlend = (practicalMul: number) => Math.min(0.75, practicalMul * 0.4);
