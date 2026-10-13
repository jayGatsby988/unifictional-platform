'use client';
/**
 * Lighting rigs.
 *
 * A room lit by one HDRI plus a lamp reads flat, because every real interior
 * photograph has THREE things a naive rig does not:
 *   1. a genuine KEY with direction and falloff — the window, sized to the real
 *      opening (a RectAreaLight) with a matching directional that throws the
 *      one crisp shadow the eye uses to read depth;
 *   2. BOUNCE — a large, dim, slightly warm source standing in for the light
 *      the floor and opposite wall kick back, which is what fills the underside
 *      of a counter and stops shadows going black;
 *   3. PRACTICALS at a different colour temperature from the daylight. The
 *      cool/warm split across a room is most of what makes an interior photo
 *      look photographed rather than rendered.
 *
 * Exteriors get a real sun angle derived from the elevation's compass
 * orientation and the time of day, with the sky model driven off the SAME
 * vector so the ambient and the shadows agree.
 *
 * Every rig takes a `quality` input: `performance` drops the rect-area lights,
 * the floor contact pass and the extra shadow maps, which is the difference
 * between 30 fps and 12 on a contractor's phone. It DEFAULTS to the studio's
 * quality control (`useLightQuality`) rather than to a hard-coded tier — it
 * used to default to 'balanced', so the control in the toolbar changed the
 * post chain and the textures and left every light in the room alone.
 *
 * The arithmetic — penumbra widths, shadow bias, the floor's bounce colour,
 * where an under-cabinet strip points — lives in `light-math.ts`, which has no
 * React in it so `scripts/check-3d.ts` can assert the actual numbers.
 */
import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RectAreaLightUniformsLib } from 'three-stdlib';
import { ContactShadows, Sky } from '@react-three/drei';
import { useProjectStore } from '@/lib/store/project-store';
import { ceilingCan } from './detail';
import {
  FLOOR_SLOTS, PENUMBRA_M, QUALITY, deviceQuality, floorBounce, groundTint, orthoBias, practicalBlend,
  shadowSettings, underCabRotation, type LightQuality,
} from './light-math';

export type { LightQuality } from './light-math';
export { deviceQuality, floorBounce, shadowSettings, UNDERCAB_TILT, underCabAim } from './light-math';
export type InteriorMood = 'daylight' | 'golden-hour' | 'overcast' | 'evening';
export type Orientation = 'north' | 'south' | 'east' | 'west';
export type TimeOfDay = 'morning' | 'noon' | 'golden-hour' | 'dusk';

// The LTC lookup tables must exist BEFORE any material that receives a rect
// area light is compiled. drei's <Preload all/> compiles every material in a
// layout effect, which runs before the rig's effects, so the init happens at
// module load (client-only module) and the hook is only a belt-and-braces.
let rectInit = false;
function initRectArea() { if (!rectInit) { RectAreaLightUniformsLib.init(); rectInit = true; } }
if (typeof window !== 'undefined') initRectArea();
function useRectAreaInit() {
  useEffect(() => { initRectArea(); }, []);
}

const clampN = (v: unknown, min: number, max: number, fb: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
};

/**
 * The tier the LIGHTS should run at: the user's explicit choice, or the
 * device's if they left it on Auto.
 *
 * This exists because the rigs were not wired to the quality control at all.
 * `KitchenLighting` never passed `quality`, so every interior in the app ran
 * the `'balanced'` default: a phone still built two rect-area lights and a
 * shadow-casting can it could not afford, and a desktop on "High" still got a
 * 1024 shadow map. The prop still wins where a caller passes one; the hook is
 * only the default.
 */
export function useLightQuality(): LightQuality {
  const pref = useProjectStore((s) => s.ui.quality);
  const [auto] = useState(deviceQuality);
  return pref === 'high' || pref === 'balanced' || pref === 'performance' ? pref : auto;
}


// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Soft daylight coming through a window opening.
 *
 * ORIENTATION: a three.js RectAreaLight emits along its local NEGATIVE Z (the
 * LTC evaluation in lights_physical_pars_fragment returns zero for any point on
 * the +Z side of the panel). Every rotation in this file is written for that
 * convention. Getting it backwards is silent: the panel lights the wall it is
 * mounted on to blinding white and the room gets nothing.
 */
export function WindowLight({ position, rotation, width, height, intensity = 1.2, color = '#f6f9ff' }: {
  position: [number, number, number]; rotation: [number, number, number]; width: number; height: number; intensity?: number; color?: string;
}) {
  useRectAreaInit();
  return <rectAreaLight position={position} rotation={rotation} width={Math.max(0.05, width)} height={Math.max(0.05, height)} intensity={Math.max(0, intensity)} color={color} />;
}

/**
 * Key directional "sun" for interiors: casts the one high-quality shadow.
 *
 * `softness` scales the PCF radius. Note the renderer must use PCFShadowMap —
 * three 0.185 deprecates PCFSoftShadowMap and warns on every fallback.
 */
export function InteriorKey({ from, to, intensity = 1.2, shadowSize = 14, color = '#fff4e0', quality = 'balanced', softness = 1, castShadow = true }: {
  from: [number, number, number]; to: [number, number, number]; intensity?: number; shadowSize?: number; color?: string;
  quality?: LightQuality; softness?: number; castShadow?: boolean;
}) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(...to); return o; }, [to]);
  useEffect(() => { if (ref.current) { ref.current.target = target; ref.current.target.updateMatrixWorld(); } }, [target]);
  const extent = Math.max(1, shadowSize);
  const s = shadowSettings(quality, softness, extent);
  const half = extent / 2;
  // The shadow camera is wrapped around the room instead of being left at
  // 0.5 → 4× the room. An orthographic depth buffer is linear, so a 40 m range
  // spent 34 m of its precision on empty air behind a 4 m kitchen and left the
  // reveal under a counter fighting for the last few bits.
  const dist = Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);
  const near = Math.max(0.1, dist - extent);
  const far = dist + extent;
  return (
    <directionalLight
      ref={ref}
      position={from}
      intensity={Math.max(0, intensity)}
      color={color}
      castShadow={castShadow}
      shadow-mapSize={[s.size, s.size]}
      shadow-radius={s.radius}
      shadow-blurSamples={s.samples}
      shadow-bias={orthoBias(far - near)}
      shadow-normalBias={s.normalBias}
      shadow-camera-left={-half}
      shadow-camera-right={half}
      shadow-camera-top={half}
      shadow-camera-bottom={-half}
      shadow-camera-near={near}
      shadow-camera-far={far}
    />
  );
}

/**
 * Bounce fill: a big, dim rect light standing in for the floor and the wall
 * behind the camera. Without it every downward-facing surface (counter
 * undersides, the inside of an upper cabinet, the underside of a hood) goes to
 * black and the room reads as a maquette.
 */
export function BounceFill({ w, d, h, intensity = 1.6, color = '#ffeedd', from = 'floor' }: {
  w: number; d: number; h: number; intensity?: number; color?: string; from?: 'floor' | 'camera' | 'ceiling';
}) {
  useRectAreaInit();
  // -Z emitter: Rx(+90°) turns -Z into +Y (up), Rx(-90°) into -Y (down).
  if (from === 'floor') {
    return <rectAreaLight position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]} width={Math.max(0.5, w * 0.9)} height={Math.max(0.5, d * 0.9)} intensity={Math.max(0, intensity)} color={color} />;
  }
  if (from === 'ceiling') {
    return <rectAreaLight position={[0, h - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} width={Math.max(0.5, w * 0.9)} height={Math.max(0.5, d * 0.9)} intensity={Math.max(0, intensity)} color={color} />;
  }
  // behind the camera on the front wall, emitting -Z into the room
  return <rectAreaLight position={[0, h * 0.55, d / 2 - 0.05]} rotation={[0, 0, 0]} width={Math.max(0.5, w * 0.9)} height={Math.max(0.5, h * 0.8)} intensity={Math.max(0, intensity)} color={color} />;
}

/** Recessed can — trim ring + lens + a small spot pointing down. */
export function RecessedLight({ position, intensity = 6, castShadow = false, colorTempK = 3000, angle = 0.75, apertureIn = 4, quality = 'balanced' }: {
  position: [number, number, number]; intensity?: number; castShadow?: boolean; colorTempK?: number; angle?: number; apertureIn?: number; quality?: LightQuality;
}) {
  const color = kelvinToHex(colorTempK);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(position[0], 0, position[2]); return o; }, [position]);
  const ref = useRef<THREE.SpotLight>(null);
  useEffect(() => { if (ref.current) { ref.current.target = target; target.updateMatrixWorld(); } }, [target]);
  const can = useMemo(() => ceilingCan({ apertureIn }), [apertureIn]);
  const beam = clampN(angle, 0.1, 1.4, 0.75);
  const throwM = 9;
  // the shadow camera's footprint where the beam lands on the floor
  const s = shadowSettings(quality === 'high' ? 'balanced' : 'performance', 1.4, 2 * throwM * Math.tan(beam));
  return (
    <group position={position}>
      <spotLight
        ref={ref}
        intensity={Math.max(0, intensity)}
        color={color}
        angle={beam}
        penumbra={0.7}
        decay={2}
        distance={throwM}
        castShadow={castShadow}
        shadow-mapSize={[s.size, s.size]}
        shadow-radius={s.radius}
        shadow-bias={-0.00025}
        shadow-normalBias={s.normalBias}
        // A spot's shadow camera is PERSPECTIVE, so its depth precision is
        // spent almost entirely between `near` and a few times `near`. It was
        // left at three's defaults — 0.5 to 500 — which puts a 2.5 m ceiling
        // and the floor under it inside the first thousandth of the buffer.
        // That is why the cans' shadows needed a bias big enough to detach
        // them. Bounded by the light's own throw, the range is 0.3 → 9.
        shadow-camera-near={0.3}
        shadow-camera-far={throwM}
      />
      <mesh geometry={can.trim} castShadow={false} receiveShadow={false}>
        <meshStandardMaterial color="#f2f1ee" roughness={0.55} metalness={0.1} />
      </mesh>
      {/* the lens tracks the light: a can dimmed to 0 must not stay a bright
          white disc in the ceiling */}
      <mesh geometry={can.lens} castShadow={false} receiveShadow={false}>
        <meshStandardMaterial color="#fff6e5" emissive={color} emissiveIntensity={THREE.MathUtils.clamp(intensity * 0.8, 0, 2.6)} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** the seeded-glass globe's radius, and the height its crown is flattened at */
const GLOBE_R = 0.14;
const GLOBE_CROWN = 0.118;

/**
 * Flatten a sphere's crown so the socket cap sits ON glass instead of balancing
 * on a tangent point — which is how a hand-blown globe is actually collared.
 */
function flattenCrown(g: THREE.SphereGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > GLOBE_CROWN) p.setY(i, GLOBE_CROWN);
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Pendant: cord + shade + warm point light. */
/** Metal colour for a pendant's canopy, cord and socket from the spec's finish word. */
export function pendantFinishHex(finish: string | null | undefined): string {
  const f = (finish ?? '').toLowerCase();
  if (/brass|gold|champagne/.test(f)) return '#b8924a';
  if (/nickel|chrome|silver|steel|polished/.test(f)) return '#c9cacc';
  if (/bronze|copper/.test(f)) return '#6b4a2e';
  if (/white|cream/.test(f)) return '#eeece6';
  if (/wood|rattan|oak/.test(f)) return '#b58f5a';
  return '#1c1c1e';
}

/**
 * A pendant drawn the way a lighting catalogue draws it: a bell or dome shade
 * with a real lip, a socket and a visible bulb, hung on a cord (or a chain of
 * links for traditional styles) from a canopy in the fixture's metal finish.
 * `style` and `finish` both come from the spec, so a photo of glass bells on
 * brass chains produces glass bells on brass chains.
 */
export function PendantLight({ position, dropM = 0.9, style = 'globe', shadeMaterial, colorTempK = 2700, intensity = 4, castShadow = false, finish }: {
  position: [number, number, number]; dropM?: number; style?: 'globe' | 'cone' | 'dome' | 'drum' | 'lantern' | 'linear' | 'cage' | 'glass'; shadeMaterial: THREE.Material; colorTempK?: number; intensity?: number; castShadow?: boolean;
  /** metal finish word from the spec ('brass', 'matte black', 'brushed nickel'…) */
  finish?: string | null;
}) {
  const color = kelvinToHex(colorTempK);
  const y = position[1] - Math.max(0.05, dropM);
  const metalHex = pendantFinishHex(finish);
  const shade = useMemo(() => {
    const lathe = (pts: Array<[number, number]>, seg = 40) => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg);
    switch (style) {
      // a metal cone with a rolled lip and a flat top
      case 'cone': return lathe([[0.012, 0.22], [0.03, 0.215], [0.11, 0.06], [0.165, 0.012], [0.17, 0.0], [0.16, 0.004], [0.108, 0.058], [0.028, 0.208]]);
      case 'dome': return lathe([[0.012, 0.18], [0.06, 0.17], [0.13, 0.12], [0.165, 0.05], [0.17, 0.0], [0.16, 0.006], [0.128, 0.114], [0.058, 0.162]]);
      case 'drum': return new THREE.CylinderGeometry(0.2, 0.2, 0.22, 40, 1, true);
      case 'linear': return new THREE.BoxGeometry(1.2, 0.05, 0.08);
      case 'lantern': case 'cage': return new THREE.CylinderGeometry(0.13, 0.16, 0.3, 6, 1, true);
      // 'glass' and 'globe' are ONE silhouette: a seeded-glass globe with a
      // flattened crown, so the socket cap sits on glass instead of balancing
      // on a tangent point. 'glass' used to draw a blown bell — an opaque
      // teardrop 0.29 m across — which is what the client meant by "the lights
      // arent the same"; the word the analyzer chose is 'glass', and a glass
      // pendant in a kitchen photograph is a globe. What separates the two
      // members now is the MATERIAL (clear and transmissive vs an opaque
      // painted shade), not the shape.
      case 'glass': return flattenCrown(new THREE.SphereGeometry(GLOBE_R, 48, 32));
      case 'globe':
      default: return flattenCrown(new THREE.SphereGeometry(GLOBE_R, 48, 32));
    }
  }, [style]);
  const globe = style === 'glass' || style === 'globe';
  // `y` is the DROP LINE: `pendantDrop` defines it as where the shade's BOTTOM
  // sits (`aboveCounter` over the finished counter) and `boxes.ts` builds the
  // photo fitter's pendant box from exactly that, so the fitter's box and the
  // shade on screen have to be the same thing. A globe's geometry is centred on
  // its own middle, so its centre goes a radius ABOVE the drop line — pushing it
  // down by a radius instead put the drawn globe 0.25 m under the box it is
  // scored against (measured: 26.2 in of clearance over the counter on
  // client-tan for a declared 37.3 in).
  const shadeY = globe ? y + GLOBE_R : style === 'cone' ? y - 0.11 : style === 'dome' ? y - 0.09 : y;
  const chain = style === 'lantern' || style === 'cage';
  // the cord stops at the crown the cap grips, not at the drop line: it must not
  // run visibly through clear glass, and it must not leave a gap above the cap
  // (the cap is 30 mm tall centred on the crown, so the cord lands 15 mm inside it)
  const cordEnd = globe ? shadeY + GLOBE_CROWN : y;
  const dropLen = Math.max(0.05, position[1] - cordEnd);
  const links = chain ? Math.max(1, Math.round(dropLen / 0.05)) : 0;
  return (
    <group>
      {chain ? (
        // a chain reads as links, not a rod: alternate link orientations
        Array.from({ length: links }, (_, i) => (
          <mesh key={i} position={[position[0], position[1] - 0.025 - i * 0.05, position[2]]} rotation={[Math.PI / 2, i % 2 ? Math.PI / 2 : 0, 0]} castShadow={false}>
            <torusGeometry args={[0.014, 0.0028, 8, 14]} />
            <meshStandardMaterial color={metalHex} roughness={0.35} metalness={0.9} />
          </mesh>
        ))
      ) : (
        <mesh position={[position[0], (position[1] + cordEnd) / 2, position[2]]} castShadow={false}>
          <cylinderGeometry args={[0.004, 0.004, dropLen, 8]} />
          <meshStandardMaterial color={metalHex} roughness={0.5} metalness={0.6} />
        </mesh>
      )}
      {/* canopy on the ceiling */}
      <mesh position={[position[0], position[1] - 0.01, position[2]]}>
        <cylinderGeometry args={[0.05, 0.058, 0.02, 24]} />
        <meshStandardMaterial color={metalHex} roughness={0.4} metalness={0.8} />
      </mesh>
      {/* The cap. On a globe it is the only OPAQUE part of the fixture — in the
          photo the glass is clear and it is the cap that reads as a shadow — so
          it is the one that casts, and it grips the flattened crown rather than
          perching on a tangent point. */}
      {globe ? (
        <>
          <mesh position={[position[0], shadeY + GLOBE_CROWN, position[2]]} castShadow>
            <cylinderGeometry args={[0.045, 0.052, 0.030, 24]} />
            <meshStandardMaterial color={metalHex} roughness={0.42} metalness={0.85} />
          </mesh>
          <mesh position={[position[0], shadeY + GLOBE_CROWN - 0.014, position[2]]} rotation={[Math.PI / 2, 0, 0]} castShadow={false}>
            <torusGeometry args={[0.045, 0.005, 8, 24]} />
            <meshStandardMaterial color={metalHex} roughness={0.42} metalness={0.85} />
          </mesh>
        </>
      ) : (
        <mesh position={[position[0], shadeY + (style === 'cone' ? 0.22 : style === 'dome' ? 0.18 : 0.13), position[2]]}>
          <cylinderGeometry args={[0.02, 0.026, 0.045, 20]} />
          <meshStandardMaterial color={metalHex} roughness={0.4} metalness={0.85} />
        </mesh>
      )}
      <mesh position={[position[0], shadeY, position[2]]} geometry={shade} material={shadeMaterial} castShadow={!globe} />
      {/* the bulb: a warm emissive teardrop, visible through glass */}
      <mesh position={[position[0], shadeY + (globe ? 0.02 : style === 'cone' ? 0.12 : style === 'dome' ? 0.1 : 0), position[2]]}>
        <sphereGeometry args={[0.028, 16, 12]} />
        <meshStandardMaterial color="#fff0d2" emissive={color} emissiveIntensity={2.6} toneMapped={false} />
      </mesh>
      {/*
        A shaded pendant throws light DOWN. A bare point light a metre below the
        ceiling washed it warm-orange, which was the single biggest reason the
        room read as amber instead of daylit. A downward spot does the work; the
        small point light is only the glow around the shade itself.
      */}
      <spotLight
        position={[position[0], y - 0.03, position[2]]}
        target-position={[position[0], 0, position[2]]}
        intensity={Math.max(0, intensity) * 2.4}
        color={color}
        angle={1.02}
        penumbra={0.85}
        decay={2}
        distance={7}
        castShadow={castShadow}
        shadow-mapSize={[1024, 1024]}
        shadow-radius={2}
        shadow-bias={-0.00025}
        shadow-normalBias={0.01}
        shadow-camera-near={0.2}
        shadow-camera-far={7}
      />
      <pointLight position={[position[0], y - 0.02, position[2]]} intensity={Math.max(0, intensity) * 0.2} color={color} decay={2} distance={2.2} />
    </group>
  );
}

/** Under-cabinet LED strip: thin emissive bar + gentle rect light down onto the counter. */
export function UnderCabinetStrip({ position, rotation = [0, 0, 0], length, colorTempK = 3000, intensity = 1.6 }: {
  position: [number, number, number]; rotation?: [number, number, number]; length: number; colorTempK?: number; intensity?: number;
}) {
  useRectAreaInit();
  const color = kelvinToHex(colorTempK);
  const L = Math.max(0.1, length);
  return (
    <group position={position} rotation={rotation}>
      {/* The bar is a fixture, not the light. At emissive 2.5 it was the
          brightest thing in the room by a factor of two and read as a hard
          white rule under the cabinets; a real LED channel behind a diffuser
          is a soft warm line you can look at. 1.45 keeps it just over the
          bloom threshold, so it glows instead of clipping. */}
      <mesh>
        <boxGeometry args={[L, 0.008, 0.02]} />
        <meshStandardMaterial color="#fff5e6" emissive={color} emissiveIntensity={1.45} toneMapped={false} />
      </mesh>
      {/*
        Aimed DOWN AND BACK, not straight down.
        Rx(-π/2) sends the emitter's -Z to -Y, i.e. exactly at the counter and
        exactly PARALLEL to the backsplash — so the one surface under-cabinet
        lighting exists to wash got nothing from it, and all the strip did was
        put a hot band on the countertop. Rotating by less than a quarter turn
        (a = -(π/2 - tilt)) sends -Z to (0, -cos t, -sin t): still mostly down,
        but with a component into the wall. At 25° roughly 42% of the flux
        lands on the splash, which is what makes a tiled backsplash glow at
        night instead of the counter glaring.
      */}
      <rectAreaLight
        width={L}
        height={0.12}
        intensity={Math.max(0, intensity)}
        color={color}
        rotation={underCabRotation()}
        position={[0, -0.01, 0.05]}
      />
    </group>
  );
}

/** Wall sconce: a small warm practical that puts a soft pool on the wall. */
export function SconceLight({ position, rotation = [0, 0, 0], colorTempK = 2700, intensity = 2.4, shadeColor = '#f3efe6' }: {
  position: [number, number, number]; rotation?: [number, number, number]; colorTempK?: number; intensity?: number; shadeColor?: string;
}) {
  const color = kelvinToHex(colorTempK);
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0, 0.02]}>
        <cylinderGeometry args={[0.035, 0.035, 0.04, 20]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.4} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.09, 0.05]}>
        <cylinderGeometry args={[0.06, 0.075, 0.13, 24, 1, true]} />
        <meshStandardMaterial color={shadeColor} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <pointLight position={[0, 0.09, 0.06]} intensity={Math.max(0, intensity)} color={color} decay={2} distance={4} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Interior rig
// ---------------------------------------------------------------------------

interface MoodSpec {
  /** key colour temperature (daylight is cool, golden hour is warm) */
  keyK: number;
  keyMul: number;
  /** sky/ambient */
  skyColor: string;
  groundColor: string;
  ambient: number;
  /** bounce */
  bounceColor: string;
  bounceMul: number;
  /** how much the practicals contribute (they carry an evening scene) */
  practicalMul: number;
  /** how low the key sits — golden hour rakes across the room */
  keyElevation: number;
}

const MOODS: Record<InteriorMood, MoodSpec> = {
  // groundColor lights every DOWNWARD-facing surface — a brown ground colour
  // is a brown ceiling. Keep it a neutral floor-bounce grey.
  daylight: { keyK: 6200, keyMul: 1.0, skyColor: '#e8eef7', groundColor: '#a9a49d', ambient: 0.26, bounceColor: '#fbfaf7', bounceMul: 0.9, practicalMul: 0.6, keyElevation: 1.6 },
  overcast: { keyK: 7000, keyMul: 0.55, skyColor: '#e2e8ee', groundColor: '#3d3830', ambient: 0.2, bounceColor: '#f0f2f5', bounceMul: 1.25, practicalMul: 1.0, keyElevation: 2.4 },
  'golden-hour': { keyK: 2900, keyMul: 1.35, skyColor: '#f0d9c0', groundColor: '#4a3222', ambient: 0.13, bounceColor: '#ffd9a8', bounceMul: 1.15, practicalMul: 1.0, keyElevation: 0.28 },
  evening: { keyK: 8200, keyMul: 0.18, skyColor: '#26344a', groundColor: '#241d18', ambient: 0.08, bounceColor: '#ffd8a2', bounceMul: 0.5, practicalMul: 1.9, keyElevation: 1.0 },
};

export interface InteriorRigProps {
  w: number; d: number; h: number;
  windows: Array<{ wall: 'back' | 'left' | 'right' | 'front'; t: number; width: number; height: number; sill: number; transmission?: number }>;
  recessed?: number;
  /** practical colour temperature from the spec (2700 warm → 4000 neutral) */
  colorTempK?: number;
  naturalLight?: 'low' | 'medium' | 'high';
  castingCans?: number;
  /** omit to follow the studio's quality control (see `useLightQuality`) */
  quality?: LightQuality;
  /** 'golden-hour' is the money shot; 'evening' sells the under-cabinet lights */
  mood?: InteriorMood;
  /** master exposure multiplier for the whole rig */
  exposure?: number;
  /** turn the floor-bounce rect off if a builder supplies its own */
  bounce?: boolean;
  /** darkening where things meet the floor — off for a rig with no floor */
  contactShadows?: boolean;
  /**
   * A signature of everything that TOUCHES the floor. The contact pass is
   * rendered once and cached (rendering it every frame would double the scene
   * traversal), so it has to be told when what it captured has moved — an
   * island slid along its wall, a run made longer, a vanity swapped. Anything
   * stable-per-layout works; the room's own dimensions are the fallback.
   */
  contactKey?: string | number;
}

/** The current project's floor material id, whichever slot its room type uses. */
function useFloorMaterialId(): string | undefined {
  return useProjectStore((st) => {
    for (const slot of FLOOR_SLOTS) { const id = (st.ui.jarvisPreview?.snapshot.selections ?? st.project.selections)[slot]; if (id) return id; }
    return undefined;
  });
}

/**
 * Complete interior rig: key + fill + kicker + practicals.
 *
 * Light budget by tier — this is a hard perf constraint, every extra shadow map
 * is a full extra scene traversal per frame:
 *   high        1 shadowed key, up to 3 window rects, 2 bounce rects, N cans (≤2 shadowed)
 *   balanced    1 shadowed key, up to 2 window rects, 1 bounce rect, N cans (≤1 shadowed)
 *   performance 1 shadowed key, no rects at all, N cans (0 shadowed)
 */
export function InteriorRig({
  w, d, h, windows, recessed = 6, colorTempK = 3000, naturalLight = 'medium', castingCans = 2,
  quality: qualityProp, mood = 'daylight', exposure = 1, bounce = true, contactShadows = true, contactKey,
}: InteriorRigProps) {
  const auto = useLightQuality();
  const quality = qualityProp ?? auto;
  const floorId = useFloorMaterialId();
  const W = clampN(w, 0.5, 60, 4), D = clampN(d, 0.5, 60, 4), H = clampN(h, 1.4, 12, 2.6);
  const m = MOODS[mood] ?? MOODS.daylight;
  const nat = (naturalLight === 'high' ? 1.4 : naturalLight === 'low' ? 0.55 : 1) * clampN(exposure, 0.1, 4, 1);
  const tier = QUALITY[quality];
  const perf = quality === 'performance';
  const maxRects = tier.windowRects;
  const practicalK = clampN(colorTempK, 2000, 6500, 3000);

  // Warm/cool balance. The bounce is not a fixed colour: it is what the room's
  // own light sources leave on the floor, so the more the practicals carry the
  // scene (they carry an evening outright, `practicalMul` 1.9) the closer the
  // bounce sits to their colour temperature — and then the floor's own colour
  // is mixed in on top. Daylight blends only a quarter of the way, which is
  // the amount of warm fill a room with its lights on actually has.
  const bounceLight = useMemo(() => {
    const toPractical = practicalBlend(m.practicalMul);
    const tinted = new THREE.Color(m.bounceColor).lerp(new THREE.Color(kelvinToHex(practicalK)), toPractical);
    return floorBounce(floorId, `#${tinted.getHexString()}`);
  }, [m.bounceColor, m.practicalMul, practicalK, floorId]);

  const cans = useMemo(() => {
    const n = Math.round(clampN(recessed, 0, 40, 6));
    const out: [number, number, number][] = [];
    if (n <= 0) return out;
    const cols = Math.max(1, Math.round(Math.sqrt(n * (W / Math.max(D, 0.1)))));
    const rows = Math.max(1, Math.ceil(n / cols));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (out.length >= n) break;
        out.push([-W / 2 + (W / (cols + 1)) * (c + 1), H, -D / 2 + (D / (rows + 1)) * (r + 1)]);
      }
    }
    return out;
  }, [recessed, W, D, H]);

  // the biggest window is the key; everything else is secondary daylight
  const ranked = useMemo(() => {
    return windows
      .filter((win) => win && Number.isFinite(win.width) && Number.isFinite(win.height) && win.width > 0.05 && win.height > 0.05)
      .map((win) => ({ ...win, t: clampN(win.t, 0, 1, 0.5), area: win.width * win.height }))
      .sort((a, b) => b.area - a.area);
  }, [windows]);

  const key = ranked[0];
  const keyColor = kelvinToHex(m.keyK);
  const keyDist = Math.max(W, D) * 0.8 + 2.5;
  // the key comes from OUTSIDE the window, at the mood's elevation, aimed at
  // the middle of the room a little above counter height
  const keyFrom = useMemo<[number, number, number]>(() => {
    const lift = H * m.keyElevation + 0.5;
    if (!key) return [-W * 0.45 - 2, lift, D * 0.5 + 2];
    const x = (key.t - 0.5) * W, z = (key.t - 0.5) * D;
    switch (key.wall) {
      case 'back': return [x + W * 0.18, lift, -D / 2 - keyDist];
      case 'front': return [x - W * 0.18, lift, D / 2 + keyDist];
      case 'left': return [-W / 2 - keyDist, lift, z + D * 0.18];
      default: return [W / 2 + keyDist, lift, z - D * 0.18];
    }
  }, [key, W, D, H, keyDist, m.keyElevation]);

  const rects = ranked.slice(0, maxRects);

  return (
    <group name="interior-rig">
      {/* Sky/ground ambient — cool from above, warm from the floor.
          `groundColor` is what lights every DOWNWARD-facing surface (the
          ceiling, the undersides of the wall cabinets, the inside of the
          hood), which is the same physical quantity as the floor bounce below
          it, so it follows the floor too — 40% of the way, keeping the mood's
          own lightness, because this is the exact knob that gave the app its
          brown-ceiling bug when interiors were lit by a photographic HDRI. */}
      <hemisphereLight intensity={m.ambient * nat} color={m.skyColor} groundColor={groundTint(m.groundColor, bounceLight.floorColor)} />

      {/* KEY: the one shadow that gives the room its depth */}
      <InteriorKey
        from={keyFrom}
        to={[0, Math.min(1.0, H * 0.38), 0]}
        intensity={1.7 * m.keyMul * nat}
        color={keyColor}
        shadowSize={Math.max(W, D) * 1.5}
        quality={quality}
        softness={mood === 'golden-hour' ? 0.7 : mood === 'overcast' ? 2.2 : 1}
      />

      {/* Equal sky luminance at each opening: area already scales its energy.
          The previous primary-window boost clipped polished counters into a
          white rectangle on top of the separate sun, sky and bounce terms. */}
      {rects.map((win, i) => {
        const y = clampN(win.sill + win.height / 2, 0.1, H, H * 0.5);
        const pos: [number, number, number] = win.wall === 'back' ? [(win.t - 0.5) * W, y, -D / 2 + 0.05]
          : win.wall === 'front' ? [(win.t - 0.5) * W, y, D / 2 - 0.05]
            : win.wall === 'left' ? [-W / 2 + 0.05, y, (win.t - 0.5) * D]
              : [W / 2 - 0.05, y, (win.t - 0.5) * D];
        // -Z emitter: back wall needs +Z (yaw π), front needs -Z (yaw 0),
        // left wall needs +X (yaw -π/2), right wall needs -X (yaw +π/2)
        const rot: [number, number, number] = win.wall === 'back' ? [0, Math.PI, 0] : win.wall === 'front' ? [0, 0, 0] : win.wall === 'left' ? [0, -Math.PI / 2, 0] : [0, Math.PI / 2, 0];
        return (
          <WindowLight
            key={`win-${i}`}
            position={pos}
            rotation={rot}
            width={win.width}
            height={win.height}
            intensity={1.2 * m.keyMul * nat * clampN(win.transmission, 0, 1, 1)}
            color={kelvinToHex(m.keyK + 200)}
          />
        );
      })}

      {/* BOUNCE: floor kick, and (high only) a soft fill from behind the camera */}
      {bounce && !perf ? <BounceFill w={W} d={D} h={H} intensity={1.05 * m.bounceMul * nat * bounceLight.gain} color={bounceLight.color} from="floor" /> : null}
      {bounce && quality === 'high' ? <BounceFill w={W} d={D} h={H} intensity={0.45 * m.bounceMul * nat} color="#eef2f8" from="camera" /> : null}
      {perf ? <ambientLight intensity={0.10 * nat * bounceLight.gain} color={bounceLight.color} /> : null}

      {/*
        CONTACT. Screen-space AO cannot draw this: N8AO only knows about
        surfaces the camera can already see, so the darkening where a toe kick
        meets the floor disappears the moment the kick itself is out of frame,
        and the island's footprint on the floor was never there at all — the
        island reads as a box hovering on a bright floor. `far` is 0.45 m, so
        the pass only sees the bottom of things: base cabinets, the island
        plinth, stool and table feet. Nothing above knee height contributes,
        which is what keeps it a contact shadow instead of a second key.
        `frames={1}` renders it once — a per-frame contact pass is a second
        traversal of the whole scene — so `contactKey` is what tells it the
        thing it captured has moved.
      */}
      {contactShadows && tier.contactShadows ? (
        <ContactShadows
          key={`cs-${contactKey ?? `${W.toFixed(2)}x${D.toFixed(2)}`}`}
          position={[0, 0.004, 0]}
          scale={Math.max(W, D) * 1.15}
          opacity={0.55}
          blur={2.6}
          far={0.45}
          resolution={quality === 'high' ? 1024 : 512}
          frames={1}
          color="#14100c"
        />
      ) : null}

      {/* KICKER: a dim cool back-light that separates cabinet fronts from the
          wall behind them. Costs one unshadowed directional. */}
      <directionalLight
        position={[W * 0.5 + 1.5, H * 0.9, -D * 0.5 - 1.5]}
        intensity={0.18 * nat}
        color="#cfe0f2"
      />

      {/* PRACTICALS — warm, and deliberately a different temperature */}
      {cans.map((p, i) => (
        <RecessedLight
          key={`can-${i}`}
          position={p}
          castShadow={i < clampN(castingCans, 0, tier.castingCans, tier.castingCans)}
          colorTempK={practicalK}
          intensity={2.2 * m.practicalMul}
          quality={quality}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Exterior rig
// ---------------------------------------------------------------------------

/** Compass azimuth (° from north, clockwise) and elevation (°) per time of day. */
const SUN_TABLE: Record<TimeOfDay, { az: number; el: number; k: number; intensity: number; turbidity: number; rayleigh: number }> = {
  morning: { az: 100, el: 22, k: 4200, intensity: 2.3, turbidity: 3.2, rayleigh: 1.4 },
  noon: { az: 180, el: 66, k: 5600, intensity: 3.3, turbidity: 2.4, rayleigh: 0.9 },
  'golden-hour': { az: 256, el: 11, k: 3100, intensity: 2.6, turbidity: 4.2, rayleigh: 1.8 },
  dusk: { az: 276, el: 3.5, k: 2400, intensity: 1.3, turbidity: 6.5, rayleigh: 2.6 },
};

const FRONT_AZIMUTH: Record<Orientation, number> = { north: 0, east: 90, south: 180, west: 270 };

/**
 * Where the sun actually is, given which way the front elevation faces.
 *
 * The scene's +Z is the direction the FRONT elevation faces, so a house facing
 * west at golden hour gets the sun straight down the front, and the same house
 * facing east gets a fully shaded façade — which is exactly the difference a
 * contractor notices in a real listing photo.
 */
export function sunVector(timeOfDay: TimeOfDay, orientation: Orientation = 'south', distance = 100): { position: [number, number, number]; elevationDeg: number; color: string; intensity: number; sky: { turbidity: number; rayleigh: number } } {
  const s = SUN_TABLE[timeOfDay] ?? SUN_TABLE['golden-hour'];
  const theta = ((s.az - (FRONT_AZIMUTH[orientation] ?? 180)) * Math.PI) / 180;
  const phi = (s.el * Math.PI) / 180;
  const r = Math.max(10, distance);
  return {
    position: [r * Math.cos(phi) * Math.sin(theta), r * Math.sin(phi), r * Math.cos(phi) * Math.cos(theta)],
    elevationDeg: s.el,
    color: kelvinToHex(s.k),
    intensity: s.intensity,
    sky: { turbidity: s.turbidity, rayleigh: s.rayleigh },
  };
}

export interface ExteriorRigProps {
  timeOfDay?: TimeOfDay;
  /** which way the FRONT elevation faces */
  orientation?: Orientation;
  /** the scene's footprint in metres — drives the shadow camera */
  size?: number;
  quality?: LightQuality;
  exposure?: number;
  /** draw the sky dome (off when the canvas supplies an HDRI background) */
  sky?: boolean;
  contactShadows?: boolean;
}

/**
 * Exterior rig: a sun placed by real compass angle, a sky model driven off the
 * SAME vector, and ambient tinted to match. Low sun = long, soft, warm shadows
 * and a strongly blue ambient in the shade — the two cues that read as "shot
 * in the late afternoon" instead of "rendered at noon".
 */
export function ExteriorRig({
  timeOfDay = 'golden-hour', orientation = 'south', size = 60, quality: qualityProp, exposure = 1, sky = true, contactShadows = true,
}: ExteriorRigProps) {
  const auto = useLightQuality();
  const quality = qualityProp ?? auto;
  const S = clampN(size, 6, 400, 60);
  const ex = clampN(exposure, 0.1, 4, 1);
  const sun = useMemo(() => sunVector(timeOfDay, orientation, Math.max(80, S * 2)), [timeOfDay, orientation, S]);
  const perf = quality === 'performance';
  // long sun = wide penumbra; the shadow of a gable at 11° is metres of soft edge
  const softness = THREE.MathUtils.clamp(2.4 - sun.elevationDeg / 30, 0.6, 2.4);
  const mapSize = quality === 'high' ? 4096 : quality === 'performance' ? 1024 : 2048;
  // The sun's penumbra is a real width — about 30 mm per metre of standoff at
  // a low elevation — and the shadow camera here is tens of metres across, so
  // the texel footprint is what decides the radius. Asked for in metres for
  // the same reason the interior key is (see shadowSettings).
  const s = shadowSettings(quality === 'high' ? 'high' : quality, softness * 3, S);
  const sunRadius = THREE.MathUtils.clamp((PENUMBRA_M * softness * 3) / (S / mapSize), 0.6, 6);

  // ambient consistent with the sky model: bluer and dimmer as the sun drops
  const skyLift = THREE.MathUtils.clamp(sun.elevationDeg / 60, 0.05, 1);
  const skyColor = new THREE.Color().setHSL(0.58, 0.42 - skyLift * 0.12, 0.55 + skyLift * 0.18).getStyle();
  const groundColor = new THREE.Color().setHSL(0.09, 0.30, 0.20 + skyLift * 0.10).getStyle();

  return (
    <group name="exterior-rig">
      {sky ? (
        <Sky
          sunPosition={sun.position}
          turbidity={sun.sky.turbidity}
          rayleigh={sun.sky.rayleigh}
          mieCoefficient={0.005}
          mieDirectionalG={0.86}
          distance={4000}
        />
      ) : null}
      <hemisphereLight intensity={(0.32 + skyLift * 0.35) * ex} color={skyColor} groundColor={groundColor} />
      <directionalLight
        position={sun.position}
        intensity={sun.intensity * ex}
        color={sun.color}
        castShadow
        shadow-mapSize={[mapSize, mapSize]}
        shadow-radius={sunRadius}
        shadow-blurSamples={s.samples}
        shadow-bias={orthoBias(Math.max(220, S * 5) - 1)}
        shadow-normalBias={THREE.MathUtils.clamp((S / mapSize) * 1.5, 0.004, 0.06)}
        shadow-camera-left={-S / 2}
        shadow-camera-right={S / 2}
        shadow-camera-top={S / 2}
        shadow-camera-bottom={-S / 2}
        shadow-camera-near={1}
        shadow-camera-far={Math.max(220, S * 5)}
      />
      {/* sky fill from the opposite side so the shaded elevation is not black */}
      {!perf ? (
        <directionalLight
          position={[-sun.position[0] * 0.4, Math.max(12, S * 0.4), -sun.position[2] * 0.4]}
          intensity={0.30 * ex}
          color={skyColor}
        />
      ) : null}
      {contactShadows && !perf ? (
        <ContactShadows position={[0, 0.005, 0]} opacity={0.42} scale={S} blur={2.4} far={7} resolution={quality === 'high' ? 1024 : 512} frames={1} />
      ) : null}
    </group>
  );
}

export function kelvinToHex(k: number): string {
  // approximation (Tanner Helland)
  const kk = Number.isFinite(k) ? Math.min(15000, Math.max(1000, k)) : 3000;
  const t = kk / 100;
  let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Kelvin → THREE.Color (for code that wants the object rather than a hex). */
export function kelvinColor(k: number): THREE.Color { return new THREE.Color(kelvinToHex(k)); }
