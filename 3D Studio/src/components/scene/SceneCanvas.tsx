'use client';
/* eslint-disable react-hooks/immutability -- react-three-fiber is an imperative
   API: the renderer, camera and light objects returned by useThree/refs are
   mutated in effects by design (that is how three.js is configured). The React
   Compiler's immutability rule cannot model that and flags every assignment. */
/**
 * SceneCanvas — the shared R3F canvas: physically-based renderer settings,
 * HDRI environment, post-processing (AO, bloom, SMAA, outline for selection),
 * camera controls (orbit / walk / photo-match) and a screenshot hook.
 */
import * as THREE from 'three';
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, PointerLockControls, AdaptiveDpr, Preload, Bvh } from '@react-three/drei';
import { EffectComposer, N8AO, Bloom, SMAA, Vignette, Outline, Selection, ToneMapping, ChromaticAberration, Noise, BrightnessContrast, HueSaturation } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useProjectStore } from '@/lib/store/project-store';
import { setMaterialQuality, setMaxAnisotropy, setMetalEnvBoost } from './materials';
import { QUALITY, deviceQuality } from './light-math';
import { ft } from '@/lib/units';
import { canOccupyFloorPlan, moveFloorPlanPosition, type FloorPlanNavigation } from './floorplan/navigation';
import { fitCameraRig, type CameraFitBounds } from './camera-fit';
import { useScanView, waitForScanModelFrame } from './scan-view-store';
import { useNativeMesh } from '@/lib/native/mesh-store';
import { captureRenderedFrame } from './capture-frame';

export type EnvPreset = 'interior' | 'exterior' | 'studio';

const HDRI: Record<EnvPreset, string> = {
  interior: '/hdri/photo_studio_loft_hall_1k.hdr',
  studio: '/hdri/studio_small_09_1k.hdr',
  exterior: '/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr',
};

/**
 * Interiors use three's RoomEnvironment instead of a photographic HDRI.
 *
 * Every real-world HDRI has a floor, and a floor lights the UNDERSIDE of
 * things: with the loft HDRI the ceiling, the bottoms of the wall cabinets and
 * the inside of the hood all went the brown of its wooden floor no matter how
 * far the intensity was pulled down. RoomEnvironment is a neutral white studio
 * with soft light panels, so ambient stays neutral and metals reflect
 * something that looks like a bright room rather than a warehouse.
 */
function InteriorEnvironment({ intensity }: { intensity: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    const tex = target.texture;
    scene.environment = tex;
    room.dispose();
    pmrem.dispose();
    return () => {
      if (scene.environment === tex) scene.environment = null;
      target.dispose();
    };
  }, [gl, scene]);
  useEffect(() => { scene.environmentIntensity = intensity; }, [scene, intensity]);
  return null;
}

export interface CameraRig {
  /** initial orbit target + position (meters) */
  target: [number, number, number];
  position: [number, number, number];
  minDistance?: number;
  maxDistance?: number;
  /** clamp orbit so the camera never dips under the floor / above ceiling */
  minPolar?: number;
  maxPolar?: number;
  /** walk-mode eye height (m) and bounds (x/z min/max) */
  eyeHeight?: number;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  fov?: number;
  /** Optional world bounds to frame using the live canvas aspect ratio. */
  fitBounds?: CameraFitBounds;
}

export interface SceneCanvasProps {
  /** undefined = ordinary room; null = floor plan has no safely walkable room. */
  navigation?: FloorPlanNavigation | null;
  env: EnvPreset;
  rig: CameraRig;
  children: React.ReactNode;
  /** lower = darker; ACES exposure. Defaults per `env`. */
  exposure?: number;
  envIntensity?: number;
  background?: boolean;
  className?: string;
  onReady?: () => void;
}

export interface CaptureOptions {
  /** Cancel a view capture when its owning share/render operation closes. */
  signal?: AbortSignal;
  /** default png — lossless, for the photoreal render source */
  format?: 'png' | 'jpeg';
  /** jpeg only, 0..1; default 0.9 */
  quality?: number;
  /** downscale so the longest side is at most this many pixels (0 = as rendered) */
  maxPx?: number;
}
let screenshotFn: ((opts: CaptureOptions) => Promise<Blob | null>) | null = null;
/**
 * Capture the current viewport. Default is a full-size PNG (the photoreal
 * render source). The accuracy pass asks for `{ format: 'jpeg', maxPx: 1600 }`:
 * the vision model reads a 1600 px frame just as well as a 2× retina one, and
 * the upload is a tenth of the size.
 */
export async function captureViewport(opts: CaptureOptions = {}): Promise<Blob | null> {
  const project = useProjectStore.getState().project;
  const scan = project.spec && 'scanGeometry' in project.spec && !!project.spec.scanGeometry;
  if (opts.signal?.aborted) return null;
  // First-open local detail recovery can outlast ordinary texture loading.
  if (scan) await waitForScanModelFrame(150_000, opts.signal);
  if (useProjectStore.getState().project.id !== project.id) return null;
  const blob = screenshotFn ? await screenshotFn(opts) : null;
  if (scan && (useScanView.getState().mode !== 'model' || useScanView.getState().ready !== 'model')) return null;
  return useProjectStore.getState().project.id === project.id ? blob : null;
}

/** Encode a WebGL canvas to a blob, optionally downscaled through a 2D canvas. */
function encodeCanvas(src: HTMLCanvasElement, opts: CaptureOptions): Promise<Blob | null> {
  return new Promise((resolve) => {
    const format = opts.format ?? 'png';
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpeg' ? Math.min(1, Math.max(0.1, opts.quality ?? 0.9)) : undefined;
    const longest = Math.max(src.width, src.height);
    const maxPx = opts.maxPx ?? 0;
    if (!maxPx || longest <= maxPx || longest === 0) {
      src.toBlob((b) => resolve(b), mime, quality);
      return;
    }
    const scale = maxPx / longest;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    const ctx = out.getContext('2d');
    if (!ctx) {
      src.toBlob((b) => resolve(b), mime, quality);
      return;
    }
    ctx.drawImage(src, 0, 0, out.width, out.height);
    out.toBlob((b) => resolve(b), mime, quality);
  });
}

function RendererSetup({ exposure: exposureValue0, directToneMapping, onReady, onGraphicsLost }: { exposure: number; directToneMapping: boolean; onReady?: () => void; onGraphicsLost: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onGraphicsLost(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => gl.domElement.removeEventListener('webglcontextlost', lost);
  }, [gl, onGraphicsLost]);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // Dev-only inspection hook: `__manhattanScene()` reports what the builder
      // actually emitted, which is the fastest way to diagnose an empty view.
      // Raw handles for live material / light experiments in the console.
      (window as unknown as Record<string, unknown>).__manhattanThree = { scene, gl, camera, advance };
      (window as unknown as Record<string, unknown>).__manhattanScene = () => {
        let meshes = 0, visible = 0, lights = 0;
        const box = new THREE.Box3();
        const names: string[] = [];
        scene.traverse((o) => {
          const any = o as THREE.Mesh & { isMesh?: boolean; isLight?: boolean };
          if (any.isMesh) {
            meshes++;
            if (any.visible) { visible++; box.expandByObject(any); }
            if (names.length < 24) names.push(`${o.name || o.type}`);
          }
          if (any.isLight) lights++;
        });
        const size = box.isEmpty() ? null : box.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(2));
        const center = box.isEmpty() ? null : box.getCenter(new THREE.Vector3()).toArray().map((n) => +n.toFixed(2));
        const info = gl.info.render;
        return {
          meshes, visible, lights, names, size, center,
          camPos: camera.position.toArray().map((n) => +n.toFixed(2)),
          camFar: (camera as THREE.PerspectiveCamera).far,
          drawCalls: info.calls,
          triangles: info.triangles,
          frame: info.frame,
          overrideMaterial: scene.overrideMaterial ? scene.overrideMaterial.type : null,
          clear: gl.getClearColor(new THREE.Color()).getHexString(),
          clearAlpha: gl.getClearAlpha(),
          xr: gl.xr?.enabled ?? null,
          size2: [gl.domElement.width, gl.domElement.height],
          autoClear: gl.autoClear,
        };
      };
    }
    gl.toneMapping = directToneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = exposureValue0;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    // What this GPU can actually filter, read once and before anything is
    // built. It used to be read inside useSlotMaterial, which meant every
    // texture created before the first slot mesh mounted — the utility metals,
    // the preloaded selections, every micro-normal — kept the conservative
    // default for the rest of the session. Every UV in this app is in metres,
    // so a floor is sampled at a grazing angle across the bottom half of the
    // frame; that is precisely the case anisotropic filtering exists for.
    setMaxAnisotropy(gl.capabilities.getMaxAnisotropy());
    gl.shadowMap.enabled = true;
    // Match the Canvas prop: R3F reapplies it on updates. three 0.185 warns on
    // every PCFSoftShadowMap fallback; PCFShadowMap directly selects the
    // supported filter and honours the rig's shadow.radius settings.
    gl.shadowMap.type = THREE.PCFShadowMap;
    // Capture the COMPOSED frame, not a fresh gl.render(). Tone mapping,
    // ambient occlusion and bloom all live in the post-processing pass, and
    // `gl.toneMapping` is deliberately NoToneMapping here — re-rendering the
    // scene directly would hand the image model a washed-out picture that looks
    // nothing like what the user is looking at, and the render would come back
    // as a different room. `preserveDrawingBuffer: true` keeps the composed
    // buffer readable; we wait one frame so it is guaranteed to be current.
    screenshotFn = (opts) => captureRenderedFrame(() => encodeCanvas(gl.domElement, opts),
      () => !gl.getContext().isContextLost() && gl.domElement.isConnected, { signal: opts.signal });
    onReady?.();
    return () => { screenshotFn = null; };
  }, [gl, scene, camera, advance, exposureValue0, directToneMapping, onReady]);
  return null;
}

function WalkControls({ rig, navigation }: { rig: CameraRig; navigation?: FloorPlanNavigation | null }) {
  const camera = useThree((s) => s.camera);
  const keys = useRef<Record<string, boolean>>({});
  const locked = useRef(false);
  const vel = useRef(new THREE.Vector3());
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!locked.current) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      keys.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    const resetKeys = () => { keys.current = {}; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    window.addEventListener('blur', resetKeys);
    camera.position.y = rig.eyeHeight ?? 1.6;
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', resetKeys); };
  }, [camera, rig.eyeHeight]);
  const currentLevel = useRef<number | null>(null);
  useEffect(() => {
    if (!navigation) return;
    if (currentLevel.current !== navigation.levelIndex || !canOccupyFloorPlan(navigation, camera.position.x, camera.position.z)) {
      camera.position.set(navigation.spawn[0], navigation.floorY + ft(5.4), navigation.spawn[1]);
      // Start with a horizontal gaze inside the room, not the orbit's downward pitch.
      camera.lookAt(navigation.spawn[0], navigation.floorY + ft(5.4), navigation.spawn[1] - 1);
    }
    currentLevel.current = navigation.levelIndex;
  }, [camera, navigation]);
  useFrame((_, dt) => {
    if (!locked.current || navigation === null) return;
    const k = keys.current;
    const speed = (k.ShiftLeft ? 2.6 : 1.4) * Math.min(dt, 0.05);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    vel.current.set(0, 0, 0);
    if (k.KeyW || k.ArrowUp) vel.current.add(dir);
    if (k.KeyS || k.ArrowDown) vel.current.sub(dir);
    if (k.KeyD || k.ArrowRight) vel.current.add(right);
    if (k.KeyA || k.ArrowLeft) vel.current.sub(right);
    if (vel.current.lengthSq() > 0) {
      vel.current.normalize().multiplyScalar(speed);
      if (navigation) {
        const [x, z] = moveFloorPlanPosition(navigation, [camera.position.x, camera.position.z], [camera.position.x + vel.current.x, camera.position.z + vel.current.z]);
        camera.position.x = x; camera.position.z = z;
      } else camera.position.add(vel.current);
    }
    const b = rig.bounds;
    if (b) {
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, b.minX, b.maxX);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, b.minZ, b.maxZ);
    }
    camera.position.y = navigation ? navigation.floorY + ft(5.4) : rig.eyeHeight ?? 1.6;
  });
  return navigation === null ? null : <PointerLockControls selector="#walk-hint" onLock={() => { locked.current = true; }} onUnlock={() => { locked.current = false; keys.current = {}; }} />;
}

/**
 * Puts the camera exactly where the rig says, every time the rig changes.
 * `rig.fov` is the VERTICAL field of view (three's convention); a rig built
 * from the fitter's solved camera therefore lands pixel-for-pixel on the
 * photo, provided the canvas is letterboxed to the photo's aspect — which the
 * Viewport does in photo mode. Nothing here nudges, eases or clamps the pose.
 */
function CameraRigApplier({ rig, mode }: { rig: CameraRig; mode: string }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3; update?: () => void; enableDamping?: boolean } | null;
  useEffect(() => {
    camera.fov = rig.fov ?? 55;
    camera.near = 0.05;
    camera.far = Math.max(400, (rig.maxDistance ?? 25) * 2);
    camera.updateProjectionMatrix();
    if (mode !== 'walk') {
      camera.position.set(...rig.position);
      camera.lookAt(...rig.target);
      camera.updateMatrixWorld();
      if (controls?.target) {
        // Consume residual orbit damping before applying a new floor pose.
        // Otherwise an old drag can keep shifting the freshly fitted camera.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update?.();
        camera.position.set(...rig.position);
        controls.target.set(...rig.target);
        controls.update?.();
        controls.enableDamping = damping;
      }
    }
  }, [camera, controls, rig, mode]);
  return null;
}

function SceneCameraControls({ rig, mode, navigation }: { rig: CameraRig; mode: string; navigation?: FloorPlanNavigation | null }) {
  const size = useThree((s) => s.size);
  const fitted = useMemo(() => fitCameraRig(rig, size.width / Math.max(1, size.height)), [rig, size.width, size.height]);
  return <>
    {mode === 'walk' ? <WalkControls rig={fitted} navigation={navigation} /> : <OrbitControls
      target={fitted.target}
      enableDamping
      dampingFactor={0.08}
      minDistance={fitted.minDistance ?? 0.8}
      maxDistance={fitted.maxDistance ?? 25}
      minPolarAngle={fitted.minPolar ?? 0.15}
      maxPolarAngle={fitted.maxPolar ?? Math.PI / 2 - 0.02}
      makeDefault
    />}
    <CameraRigApplier rig={fitted} mode={mode} />
  </>;
}

/**
 * Per-environment ambient-occlusion tuning. AO radius is a WORLD-SPACE
 * distance: a kitchen wants ~0.5 m so it darkens the reveal under a counter
 * and the corner behind a cabinet, while an exterior at 20 m wants metres or
 * the whole façade goes muddy.
 */
interface AOTuning { radius: number; intensity: number; distanceFalloff: number; color: string }
const AO_TUNING: Record<EnvPreset, AOTuning> = {
  // 3.4 crushed every dark surface (a black island top, a walnut stool) to
  // solid black; real contact shadows are a lot subtler than that.
  //
  // Now that the interior rig throws a real geometric contact shadow where
  // things meet the floor (Lighting.tsx), the AO no longer has to fake one. It
  // is doing the job it is actually good at instead — the corner behind a
  // cabinet, the reveal under a counter nose, the gap between a fridge and its
  // surround — so the radius went UP (a wider, softer bowl rather than a dark
  // line hugging every silhouette, which is the single most render-looking
  // artefact SSAO has) and the intensity came DOWN. The colour is a near-
  // neutral warm-black: a blue-black AO tints every crevice in the room the
  // colour of a moonlit night, which is what "CG" looks like.
  interior: { radius: 0.62, intensity: 1.15, distanceFalloff: 0.8, color: '#0d0a08' },
  studio: { radius: 0.70, intensity: 1.15, distanceFalloff: 0.85, color: '#0d0c0c' },
  exterior: { radius: 2.60, intensity: 1.35, distanceFalloff: 1.0, color: '#0f0e12' },
};

/**
 * Post chain.
 *
 * Deliberately NO depth of field: a blurred background on an architectural
 * render reads as a tabletop miniature, which is the opposite of the job.
 * What we do add is the cheap end of the photographic stack — a touch of
 * lateral chromatic aberration at the frame edge, a filmic contrast curve, a
 * hint of extra saturation and a fine grain — which together are most of the
 * difference between "3D render" and "photo".
 *
 * Screen-space reflections are NOT included: @react-three/postprocessing 3.1.1
 * exports no SSR/SSGI effect (checked against node_modules — the effects folder
 * has Bloom, SSAO, N8AO, DoF, ... and no reflection pass), and the environment
 * map already carries the specular response for flat surfaces.
 */
function Effects({ quality, env }: { quality: 'high' | 'balanced' | 'performance'; env: EnvPreset }) {
  if (process.env.NEXT_PUBLIC_NO_POST === '1') return null;
  const tier = QUALITY[quality];
  const ao = tier.ao;
  const grade = tier.grade;
  const tune = AO_TUNING[env] ?? AO_TUNING.interior;
  return (
    // Balanced gets 2× MSAA. It cost nothing measurable on any WebGL2 GPU made
    // this decade and it is the difference between a cabinet stile with a clean
    // edge and one that crawls when the camera orbits — SMAA alone cannot
    // recover an edge the raster already threw away.
    <EffectComposer multisampling={tier.msaa} enableNormalPass={false} autoClear={false}>
      {ao ? (
        <N8AO
          aoRadius={tune.radius}
          intensity={quality === 'high' ? tune.intensity : tune.intensity * 0.8}
          distanceFalloff={tune.distanceFalloff}
          quality={quality === 'high' ? 'high' : 'medium'}
          halfRes={quality !== 'high'}
          color={tune.color}
        />
      ) : <></>}
      {/*
        Highlight rolloff, not a glow effect. A photograph does not clip a
        window or a filament to a flat white disc — the highlight spills a
        little into what surrounds it, and the eye reads that spill as
        brightness the display cannot actually reach. The threshold sits just
        over the emissive fixtures (the can lenses and the LED channel run at
        ~1.45) with a wide smoothing knee, so they bloom softly while a
        specular glint on a polished counter stays a glint.
      */}
      <Bloom luminanceThreshold={1.15} luminanceSmoothing={0.42} intensity={0.19} mipmapBlur radius={0.72} />
      <Outline blur edgeStrength={5} visibleEdgeColor={0xf5d68a} hiddenEdgeColor={0x9a7a3a} width={1200} xRay={false} blendFunction={BlendFunction.SCREEN} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {/* filmic curve: lift contrast a touch and let colour breathe, the way a
          camera profile does after the tone curve. Both numbers came down: the
          AO is no longer fighting them for the shadows, and a contrast push on
          top of ACES's own toe is what was turning the corners of a room to
          mud. */}
      {grade ? <BrightnessContrast brightness={env === 'exterior' ? 0.0 : 0.004} contrast={env === 'exterior' ? 0.04 : 0.042} /> : <></>}
      {grade ? <HueSaturation hue={0} saturation={env === 'exterior' ? 0.035 : 0.05} /> : <></>}
      {/* lateral CA: zero in the centre, a fraction of a pixel at the corners */}
      {grade ? (
        <ChromaticAberration
          offset={CA_OFFSET}
          radialModulation
          modulationOffset={0.35}
          blendFunction={BlendFunction.NORMAL}
        />
      ) : <></>}
      {/* a lens falls off toward the corners; it does not put a black ring
          round the picture. 0.52 was closing the corners of a wide interior
          hard enough to lose the toe kick in them. */}
      <Vignette eskil={false} offset={0.3} darkness={0.4} />
      {/* fine grain last, so it sits on the graded image like real sensor noise */}
      {grade ? <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.028} /> : <></>}
      <SMAA />
    </EffectComposer>
  );
}

const CA_OFFSET = new THREE.Vector2(0.00035, 0.00035);

/**
 * Interiors read flat when the HDRI fills every shadow, so the environment is
 * dialled back indoors and the window/key lights carry the direction. Exteriors
 * want the full sky.
 */
const ENV_DEFAULTS: Record<EnvPreset, { exposure: number; envIntensity: number }> = {
  // Interiors were reading flat and overexposed: white cabinets clipped, the
  // ceiling glowed, and the countertop picked up so much bounce that a white
  // quartz slab looked tan. Pulling exposure and the HDRI ambient down lets the
  // window carry the light, which is what gives a real interior its falloff.
  // envIntensity is low because the loft HDRI's wooden floor tints every
  // downward-facing surface (ceilings, cabinet undersides) brown.
  interior: { exposure: 0.72, envIntensity: 0.28 },
  studio: { exposure: 0.95, envIntensity: 0.5 },
  exterior: { exposure: 0.92, envIntensity: 0.85 },
};

export function SceneCanvas({ env, rig, children, exposure, envIntensity, background = false, className, onReady, navigation }: SceneCanvasProps) {
  const [rendererKey, setRendererKey] = useState(0);
  const [graphicsPaused, setGraphicsPaused] = useState(false);
  const recoveryAttempts = useRef<number[]>([]);
  const graphicsLost = useCallback(() => {
    const now = Date.now();
    recoveryAttempts.current = [...recoveryAttempts.current.filter(at => now - at < 60000), now];
    useScanView.getState().setReady(null);
    setGraphicsPaused(true);
  }, []);
  const recoverGraphics = useCallback(() => {
    setGraphicsPaused(false);
    setRendererKey(key => key + 1);
  }, []);
  useEffect(() => {
    if (!graphicsPaused || recoveryAttempts.current.length > 2) return;
    const timer = setTimeout(recoverGraphics, 1200);
    return () => clearTimeout(timer);
  }, [graphicsPaused, recoverGraphics]);
  const scan = useProjectStore((s) => s.project.spec && 'scanGeometry' in s.project.spec ? s.project.spec.scanGeometry : null);
  const projectId = useProjectStore(s => s.project.id);
  const hasObservedMesh = useNativeMesh(s => s.projectId === projectId && !!s.mesh);
  const scanMode = useScanView(s => s.mode);
  const rawSource = !!scan && hasObservedMesh && scanMode === 'source';
  const capturedModel = !!scan && hasObservedMesh && scanMode === 'model';
  const defaults = ENV_DEFAULTS[env];
  const exposureValue = exposure ?? defaults.exposure;
  const envIntensityValue = envIntensity ?? (scan && env === 'interior' ? 0.65 : defaults.envIntensity);
  const cameraMode = useProjectStore((s) => s.ui.cameraMode);
  const qualityPref = useProjectStore((s) => s.ui.quality);
  const measured = !!scan;
  // Device tier is measured once, lazily; the user's explicit choice overrides
  // it. `deviceQuality` is shared with the lighting rigs (light-math.ts) so the
  // lights and the post chain can never disagree about what machine this is.
  const [autoQuality] = useState<'high' | 'balanced' | 'performance'>(deviceQuality);
  const quality = qualityPref === 'auto' ? autoQuality : qualityPref;
  // Texture resolution and the detail-normal pass follow the same tier the post
  // chain uses, so a phone never pays for 2048px procedural slabs.
  useEffect(() => { setMaterialQuality(quality); }, [quality]);
  // metals read the environment at full strength even when the room's ambient
  // HDRI is dialled down (see setMetalEnvBoost)
  useEffect(() => { setMetalEnvBoost(env === 'exterior' ? 1.15 : env === 'studio' ? 1.4 : 3.2); }, [env]);
  // Camera textures need enough pixels to retain cabinet grain and floor seams.
  // The direct scan pass avoids the heavy effects that required the old low DPR.
  const dpr = useMemo<[number, number]>(() => capturedModel ? [1.25, 2] : QUALITY[quality].dpr, [quality, capturedModel]);

  return (
    <div className={className ?? 'absolute inset-0'}>
      <Canvas
        key={rendererKey}
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={dpr}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false, preserveDrawingBuffer: true }}
        camera={{ fov: rig.fov ?? 55, near: 0.05, far: 400, position: rig.position }}
        style={{ background: env === 'exterior' ? '#cfe0ee' : '#090909' }}
      >
        <RendererSetup exposure={exposureValue} directToneMapping={capturedModel} onReady={onReady} onGraphicsLost={graphicsLost} />
        {measured && env !== 'exterior' && <color attach="background" args={['#e7e5df']} />}
        <Suspense fallback={null}>
          {env === 'exterior'
            ? <Environment files={HDRI[env]} background={background} environmentIntensity={envIntensityValue} />
            : <InteriorEnvironment intensity={envIntensityValue} />}
          <Selection>
            {rawSource ? children : <Bvh firstHitOnly>{children}</Bvh>}
            {/* Camera RGB is already exposed imagery. Filmic grading, AO and
                bloom would change recorded colors across the entire frame. Clean
                camera materials bypass tone mapping individually; catalog
                finishes still use the renderer’s physical tone mapping. */}
            {!rawSource && !capturedModel && <Effects quality={quality} env={env} />}
          </Selection>
          <Preload all />
        </Suspense>
        <SceneCameraControls rig={rig} mode={cameraMode} navigation={navigation} />
        {/* No `pixelated`: when the frame rate dips, AdaptiveDpr drops the
            render resolution, and `pixelated` asks the browser to scale that
            smaller buffer back up with nearest-neighbour. On a game that reads
            as a stylistic choice; on a photoreal interior it reads as the app
            breaking. Smooth upscaling costs nothing and just looks softer for
            the moment the camera is moving. */}
        <AdaptiveDpr />
      </Canvas>
      {graphicsPaused && <div role="status" className="absolute inset-0 z-30 flex items-center justify-center bg-[#e7e5df]/95 p-6">
        <div className="max-w-xs rounded-2xl bg-white p-5 text-center text-[#252b29] shadow-lg">
          <p className="font-medium">Restoring the 3D view</p>
          <p className="mt-2 text-sm leading-relaxed text-[#646b66]">The graphics session paused. Your design and scan are still open.</p>
          <button type="button" onClick={() => { recoveryAttempts.current = []; recoverGraphics(); }} className="mt-4 min-h-11 rounded-full bg-[#252b29] px-5 text-sm font-medium text-white">Restore 3D view</button>
        </div>
      </div>}
    </div>
  );
}

/** Helpers for builders to derive a rig from room dimensions (feet in, meters out). */
export function interiorRig(widthFt: number, depthFt: number, ceilingFt: number, opts: { lookAt?: 'back' | 'left' | 'right' } = {}): CameraRig {
  const w = ft(widthFt), d = ft(depthFt), h = ft(ceilingFt);
  const target: [number, number, number] = [0, h * 0.42, -d * 0.1];
  const dist = Math.max(w, d) * 0.95;
  const position: [number, number, number] = opts.lookAt === 'left' ? [dist * 0.9, h * 0.58, d * 0.35] : opts.lookAt === 'right' ? [-dist * 0.9, h * 0.58, d * 0.35] : [w * 0.15, h * 0.6, d * 0.5 + dist * 0.55];
  return {
    target, position,
    minDistance: 0.6, maxDistance: Math.max(w, d) * 1.6,
    minPolar: 0.2, maxPolar: Math.PI / 2 - 0.03,
    eyeHeight: 1.6,
    bounds: { minX: -w / 2 + 0.4, maxX: w / 2 - 0.4, minZ: -d / 2 + 0.4, maxZ: d / 2 - 0.2 },
    fov: 58,
  };
}

export function exteriorRig(lotWidthFt: number, lotDepthFt: number, houseDepthFt: number, storeys: number): CameraRig {
  const w = ft(lotWidthFt), d = ft(lotDepthFt), hd = ft(houseDepthFt);
  const height = ft(storeys * 10 + 8);
  return {
    target: [0, height * 0.35, 0],
    position: [w * 0.35, height * 0.55, hd / 2 + Math.max(w, d) * 0.55],
    minDistance: 3, maxDistance: Math.max(w, d) * 2.2,
    minPolar: 0.15, maxPolar: Math.PI / 2 - 0.04,
    eyeHeight: 1.7,
    bounds: { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 },
    fov: 50,
  };
}

/** Small hook: is the canvas currently in walk mode (for HUD hints) */
export function useIsWalking() { return useProjectStore((s) => s.ui.cameraMode === 'walk'); }
export const useSetCameraMode = () => {
  const setUI = useProjectStore((s) => s.setUI);
  return useCallback((m: 'orbit' | 'walk' | 'photo') => setUI({ cameraMode: m }), [setUI]);
};
