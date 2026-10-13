'use client';
/**
 * WebGL ripple crossfade between two images. Adapted from the Awwwards
 * "Ripple Displacement Slider" (ortho camera + full-quad ShaderMaterial; a
 * radial wave displaces UVs and crossfades to the next texture behind its
 * trailing edge). Changes for MANHATTAN: cover-fits the host element instead
 * of a fixed centre box, loads once and self-disposes, renders only while the
 * tween runs, and reports completion / failure so the DOM slider can take over.
 *
 * Client-only: always load through next/dynamic({ ssr: false }).
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { cx } from './cx';

export interface RippleRevealProps {
  before: string;
  after: string;
  /** Start the ripple as soon as textures are ready. */
  play: boolean;
  /** Fade the canvas out (the parent unmounts it afterwards). */
  fadeOut: boolean;
  onComplete: () => void;
  onError: () => void;
  className?: string;
}

const WAVE_WIDTH = 0.5;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uTexCurrent;
  uniform sampler2D uTexNext;
  uniform float uProgress;
  uniform vec2 uResolution;
  uniform vec2 uImageResA;
  uniform vec2 uImageResB;
  uniform float uWaveFreq;
  uniform float uWavePow;
  uniform float uFalloff;
  uniform float uBoostStrength;
  uniform float uCrossfadeWidth;
  varying vec2 vUv;

  vec2 coverUv(vec2 uv, vec2 res, vec2 img) {
    float ra = res.x / res.y;
    float ia = img.x / img.y;
    vec2 s = vec2(1.0);
    if (ra > ia) { s.y = ia / ra; } else { s.x = ra / ia; }
    return clamp((uv - 0.5) * s + 0.5, 0.0, 1.0);
  }

  void main() {
    float aspect = uResolution.y / uResolution.x;
    vec2 coord = vec2(vUv.x, vUv.y * aspect);
    vec2 center = vec2(0.5, 0.5 * aspect);
    float dist = distance(coord, center);

    vec2 displaced = coord;
    float brightness = 0.0;
    float blend = 0.0;

    if (uProgress > 0.001) {
      float trailing = dist - uProgress;
      if (trailing < 0.0) {
        float age = -trailing;
        float decay = exp(-age * uFalloff);
        float wave = sin(age * uWaveFreq) * decay;
        vec2 dir = normalize(coord - center + vec2(0.00001));
        displaced += dir * wave * uWavePow;
        brightness = abs(wave) * uBoostStrength * decay;
      }
      blend = smoothstep(0.0, uCrossfadeWidth, -trailing);
    }

    vec2 finalUv = vec2(displaced.x, displaced.y / aspect);
    vec4 a = texture2D(uTexCurrent, coverUv(finalUv, uResolution, uImageResA));
    vec4 b = texture2D(uTexNext, coverUv(finalUv, uResolution, uImageResB));
    vec4 color = mix(a, b, blend);
    color.rgb += color.rgb * brightness;
    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;

/** Ask Next's image optimizer for a 1080px version first (shares the browser cache with <Image>), fall back to the raw file. */
function optimizedUrl(src: string) {
  return `/_next/image?url=${encodeURIComponent(src)}&w=1080&q=75`;
}

function loadOne(loader: THREE.TextureLoader, url: string) {
  return new Promise<THREE.Texture>((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

async function loadTexture(src: string): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader();
  let tex: THREE.Texture;
  try {
    tex = await loadOne(loader, optimizedUrl(src));
  } catch {
    tex = await loadOne(loader, src);
  }
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // keep the image bytes untouched (no colour-space conversion) so the canvas matches the DOM <img> exactly
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface Rig {
  progress: { value: number };
  render: () => void;
  endValue: number;
  duration: number;
}

export default function RippleReveal({ before, after, play, fadeOut, onComplete, onError, className }: RippleRevealProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<Rig | null>(null);
  const cbRef = useRef({ onComplete, onError });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    cbRef.current = { onComplete, onError };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    } catch {
      cbRef.current.onError();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    host.appendChild(canvas);
    const onLost = (e: Event) => {
      e.preventDefault();
      cbRef.current.onError();
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.01, 10);
    camera.position.z = 1;

    const uniforms = {
      uTexCurrent: { value: null as THREE.Texture | null },
      uTexNext: { value: null as THREE.Texture | null },
      uProgress: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uImageResA: { value: new THREE.Vector2(1, 1) },
      uImageResB: { value: new THREE.Vector2(1, 1) },
      uWaveFreq: { value: 25 },
      uWavePow: { value: 0.035 },
      uFalloff: { value: 10 },
      uBoostStrength: { value: 0.45 },
      uCrossfadeWidth: { value: 0.05 },
    };
    const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, depthTest: false, depthWrite: false });
    const geometry = new THREE.PlaneGeometry(1, 1);
    scene.add(new THREE.Mesh(geometry, material));

    const rig: Rig = { progress: uniforms.uProgress, render: () => renderer.render(scene, camera), endValue: 1, duration: 2.4 };
    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      uniforms.uResolution.value.set(w, h);
      const ratio = h / w;
      rig.endValue = Math.hypot(0.5, 0.5 * ratio) + WAVE_WIDTH;
      rig.duration = w < 640 ? 1.7 : 2.6;
      if (uniforms.uTexCurrent.value) rig.render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    rigRef.current = rig;

    Promise.all([loadTexture(before), loadTexture(after)])
      .then(([a, b]) => {
        if (disposed) {
          a.dispose();
          b.dispose();
          return;
        }
        uniforms.uTexCurrent.value = a;
        uniforms.uTexNext.value = b;
        const ia = a.image as { width: number; height: number };
        const ib = b.image as { width: number; height: number };
        uniforms.uImageResA.value.set(ia.width, ia.height);
        uniforms.uImageResB.value.set(ib.width, ib.height);
        rig.render();
        setReady(true);
      })
      .catch(() => {
        if (!disposed) cbRef.current.onError();
      });

    return () => {
      disposed = true;
      ro.disconnect();
      rigRef.current = null;
      canvas.removeEventListener('webglcontextlost', onLost);
      uniforms.uTexCurrent.value?.dispose();
      uniforms.uTexNext.value?.dispose();
      material.dispose();
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [before, after]);

  useEffect(() => {
    if (!play || !ready) return;
    const rig = rigRef.current;
    if (!rig) return;
    const tween = gsap.to(rig.progress, {
      value: rig.endValue,
      duration: rig.duration,
      ease: 'power2.out',
      delay: 0.4,
      onUpdate: rig.render,
      onComplete: () => cbRef.current.onComplete(),
    });
    return () => {
      tween.kill();
    };
  }, [play, ready]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={cx('absolute inset-0 transition-opacity duration-500', ready && !fadeOut ? 'opacity-100' : 'opacity-0', className)}
    />
  );
}
