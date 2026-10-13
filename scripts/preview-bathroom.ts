/**
 * Offscreen preview of the bathroom twin — the bathroom's answer to
 * `scripts/preview-kitchen.ts`, so the geometry can be LOOKED AT without a
 * browser or a GPU.
 *
 *   npx tsx scripts/preview-bathroom.ts [out.png] [view] [--all]
 *   views: wide | vanity | shower | tub | tile | accent | niche | plan | door
 *   FIXTURE=demo-bathroom (scripts/fixtures/<name>.spec.json), default: the demo
 *
 * Not a renderer: no textures, no shadows, no post. It exists to catch the
 * things a headless numeric check cannot — a tile course sunk into the wall,
 * a shower door hung on the wrong stile, a towel through the glass, a niche
 * with no reveal.
 *
 * WHY IT LOOKS THE WAY IT DOES
 * The kitchen previewer can be simple because the kitchen scene is built from
 * a pure `Part[]` (`kitchen/budget.ts`) that the components merely render. The
 * bathroom has no such list: every fixture is JSX. Rebuilding the placements
 * here would be a SECOND implementation, and a preview that agrees with a copy
 * of the scene rather than the scene is worthless — the divergence is exactly
 * the bug class this is meant to catch. So this walks the REAL component tree:
 * it calls the real components with a trivial hook dispatcher (see `withHooks`)
 * and harvests `<Surface/>`, `<Prop/>` and `<InstancedSurface/>` straight off
 * their props, before any material, texture or canvas is touched. What is
 * rasterised is the geometry the browser gets, from the same code path.
 *
 * The run ends with a `skipped:` line naming everything the walk did not
 * rasterise — lights, JSX-declared materials, and any component that could not
 * run headless. One entry there is expected: drei's `<ContactShadows/>` inside
 * the interior rig wants a live renderer, and contributes a shadow plane
 * rather than any geometry. Anything ELSE in that line is a real hole in the
 * picture and should be read as one.
 */
import * as THREE from 'three';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import type { BathroomSpec } from '../src/lib/spec/types';
import { previewContexts } from './preview-react-context';

// ---------------------------------------------------------------------------
// DOM stubs
// ---------------------------------------------------------------------------
/**
 * Enough of a DOM for the scene modules to IMPORT. Nothing here is meant to
 * draw: the walker never reaches a material, so a canvas only has to survive
 * being asked for a context. Installed before the scene modules are loaded,
 * which is why every scene import below is dynamic.
 */
function stubDom() {
  const g = globalThis as unknown as Record<string, unknown>;
  const ctx2d = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 4, height: 4 };
      if (k === 'getImageData' || k === 'createImageData') return (a: unknown, b: unknown) => {
        const wpx = typeof a === 'number' ? a : 4, hpx = typeof b === 'number' ? b : 4;
        return { data: new Uint8ClampedArray(Math.max(1, wpx) * Math.max(1, hpx) * 4), width: wpx, height: hpx };
      };
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 0 });
      return () => undefined;
    },
    set: () => true,
  });
  const makeCanvas = () => ({ width: 4, height: 4, style: {}, getContext: () => ctx2d, toDataURL: () => 'data:,' });
  // react-dom is pulled in by the R3F import chain and probes a live element
  // for event support at module scope, so a plain object is not enough: an
  // element has to answer any method with a no-op.
  const makeEl = () => new Proxy({ style: {}, nodeType: 1, tagName: 'DIV' } as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : typeof k === 'string' ? () => undefined : undefined),
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  if (typeof g.document === 'undefined') {
    g.document = {
      createElement: (t: string) => (t === 'canvas' ? makeCanvas() : makeEl()),
      createElementNS: () => makeEl(),
      documentElement: makeEl(), head: makeEl(), body: makeEl(),
      addEventListener() {}, removeEventListener() {}, querySelector: () => null,
    };
  }
  if (typeof g.navigator === 'undefined') g.navigator = { hardwareConcurrency: 8, userAgent: 'node' };
  if (typeof g.window === 'undefined') g.window = g as unknown as Window;
  if (typeof g.OffscreenCanvas === 'undefined') g.OffscreenCanvas = class { constructor() { return makeCanvas(); } };
}
stubDom();

const W = 1280, H = 860;

// ---------------------------------------------------------------------------
// A one-shot hook dispatcher
// ---------------------------------------------------------------------------
/**
 * The components are pure render functions: they read the layout, build
 * geometry in `useMemo`, and read a couple of zustand selectors. None of that
 * needs React's scheduler — it needs a dispatcher that is not null. So every
 * hook here is its simplest honest answer for a SINGLE render: `useMemo` calls
 * the factory, `useState` hands back the initial value, effects never run, and
 * `useSyncExternalStore` reads the snapshot (which is how zustand selectors
 * return the real store state).
 */
type Dispatcher = Record<string, (...args: never[]) => unknown>;
function makeDispatcher(readContext: (context: unknown) => unknown): Dispatcher {
  const noop = () => undefined;
  const d: Dispatcher = {
    useMemo: ((fn: () => unknown) => fn()) as never,
    useCallback: ((fn: unknown) => fn) as never,
    useRef: ((init: unknown) => ({ current: init })) as never,
    useState: ((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, noop]) as never,
    useReducer: ((_r: unknown, init: unknown) => [init, noop]) as never,
    useEffect: noop as never,
    useLayoutEffect: noop as never,
    useInsertionEffect: noop as never,
    useImperativeHandle: noop as never,
    useDebugValue: noop as never,
    useId: (() => ':r0:') as never,
    useTransition: (() => [false, noop]) as never,
    useDeferredValue: ((v: unknown) => v) as never,
    useContext: readContext as never,
    useSyncExternalStore: ((_sub: unknown, snap: () => unknown) => snap()) as never,
  };
  return d;
}
const fakeR3FState = {
  gl: { capabilities: { getMaxAnisotropy: () => 8 } }, scene: null, camera: null, size: { width: W, height: H },
  // useFrame reads this method during render, before its subscription effect.
  // The one-shot walker has no animation clock: harvest the complete geometry
  // without applying the browser camera's per-frame wall cutaway visibility.
  internal: { subscribe: () => () => undefined },
};
const fakeR3FStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(fakeR3FState) : fakeR3FState), {
  getState: () => fakeR3FState, setState: () => undefined, subscribe: () => () => undefined,
});

/** Run `fn` with the dispatcher installed, then put back whatever was there. */
function withHooks<T>(react: typeof import('react'), readContext: (context: unknown) => unknown, fn: () => T): T {
  const internals = (react as unknown as Record<string, { H?: unknown }>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
    ?? (react as unknown as Record<string, { H?: unknown }>).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  if (!internals) throw new Error('React internals not found — the dispatcher key changed with the React version');
  const held = internals.H;
  internals.H = makeDispatcher(readContext);
  try { return fn(); } finally { internals.H = held; }
}

// ---------------------------------------------------------------------------
// The harvest
// ---------------------------------------------------------------------------
type Vec3 = [number, number, number];
interface Node { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; color: [number, number, number]; twoSided: boolean; label: string }

const hexRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace('#', ''), 16);
  const lin = (c: number) => Math.pow(c / 255, 2.2);
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)];
};

/** Utility finishes have no catalog entry; these are only far enough apart to read as different objects. */
const UTIL_COLOR: Record<string, string> = {
  glass: '#bcd4dc', 'window-glass': '#c8dfe8', mirror: '#c9d2d6', chrome: '#c8ccd0', stainless: '#a9adb1',
  'brushed-nickel': '#adadad', 'brushed-brass': '#b89a56', 'polished-brass': '#c8a94e', 'oil-rubbed-bronze': '#4a3a2e',
  'matte-black': '#1b1c1e', 'black-metal': '#2a2b2d', anodized: '#8f9295', porcelain: '#f4f4f1', 'white-plastic': '#eeeeea',
  'ceramic-matte': '#ded9d0', 'dark-wood': '#4a3323', 'light-wood': '#c3a074', towel: '#e6e2d8', 'fabric-linen': '#d9d2c3',
  'fabric-grey': '#9a9a96', paper: '#f0eee9', plant: '#3f7a3a', soil: '#3b2b1e', water: '#4aa3c7', rubber: '#212123',
  concrete: '#8c8c88', 'leather-tan': '#8b5a34', 'sky-grey': '#dfe8ef', 'emissive-warm': '#ffe9c4', 'emissive-cool': '#e6f0ff',
  'shadow-catcher': '#202020',
};

export async function harvestBathroom(specOverride?: BathroomSpec) {
  const react = await import('react');
  const { context } = await import('@react-three/fiber');
  const contexts = previewContexts(context, fakeR3FStore);
  const { Surface, Prop, InstancedSurface } = await import('../src/components/scene/Surface');
  const { getMaterial, DEFAULT_SELECTIONS } = await import('../src/lib/materials/catalog');
  const selections: Record<string, string> = DEFAULT_SELECTIONS.bathroom;

  // A procedural material has no single colour of its own; its `swatch` is the
  // hex the material picker shows for it, which is the closest honest answer.
  const HEX = /^#[0-9a-f]{6}$/i;
  const swatchOf = (m: { pbr: { color?: string }; swatch: string } | undefined): string | null =>
    (m?.pbr.color && HEX.test(m.pbr.color) ? m.pbr.color : m && HEX.test(m.swatch) ? m.swatch : null);
  const slotColor = (slot: string): string => swatchOf(getMaterial(selections[slot])) ?? '#b0aca6';
  const colorFor = (props: Record<string, unknown>): string => {
    if (typeof props.util === 'string') return UTIL_COLOR[props.util] ?? '#ff00ff';
    if (typeof props.materialId === 'string') {
      const m = swatchOf(getMaterial(props.materialId));
      if (m) return m;
    }
    return slotColor(String(props.slot ?? ''));
  };

  const nodes: Node[] = [];
  const compose = (p: Record<string, unknown>): THREE.Matrix4 => {
    const pos = (p.position as Vec3 | undefined) ?? [0, 0, 0];
    const rot = (p.rotation as Vec3 | undefined) ?? [0, 0, 0];
    const s = p.scale;
    const sc: Vec3 = typeof s === 'number' ? [s, s, s] : ((s as Vec3 | undefined) ?? [1, 1, 1]);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0)),
      new THREE.Vector3(sc[0], sc[1], sc[2]),
    );
  };

  const FRAGMENT = Symbol.for('react.fragment');
  const skipped = new Map<string, number>();
  const note = (k: string) => skipped.set(k, (skipped.get(k) ?? 0) + 1);

  function walk(el: unknown, parent: THREE.Matrix4, depth: number) {
    if (el == null || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return;
    if (Array.isArray(el)) { for (const c of el) walk(c, parent, depth); return; }
    if (depth > 60) return;
    const e = el as { type?: unknown; props?: Record<string, unknown> };
    if (!e.type) return;
    const props = e.props ?? {};
    const type = e.type as unknown;

    // --- the three leaves we actually want ---------------------------------
    if (type === Surface || type === Prop) {
      const g = props.geometry as THREE.BufferGeometry | undefined;
      if (g && g.getAttribute('position')) {
        nodes.push({
          geometry: g, matrix: parent.clone().multiply(compose(props)),
          color: hexRgb(colorFor(props)),
          twoSided: props.util === 'plant' || props.util === 'sky-grey',
          label: String(props.slot ?? props.util ?? 'prop'),
        });
      }
      walk(props.children, parent.clone().multiply(compose(props)), depth + 1);
      return;
    }
    if (type === InstancedSurface) {
      const g = props.geometry as THREE.BufferGeometry | undefined;
      const transforms = (props.transforms as Array<Record<string, unknown>> | undefined) ?? [];
      if (g && g.getAttribute('position')) {
        const color = hexRgb(colorFor(props));
        for (const t of transforms) {
          nodes.push({ geometry: g, matrix: parent.clone().multiply(compose(t)), color, twoSided: false, label: `${String(props.slot ?? props.util)}·i` });
        }
      }
      return;
    }

    // --- intrinsics ---------------------------------------------------------
    if (typeof type === 'string') {
      if (type === 'group') { walk(props.children, parent.clone().multiply(compose(props)), depth + 1); return; }
      if (type === 'mesh') {
        const g = props.geometry as THREE.BufferGeometry | undefined;
        const m = parent.clone().multiply(compose(props));
        const material = props.material as THREE.Material & { color?: THREE.Color } | undefined;
        if (g && g.getAttribute('position')) nodes.push({ geometry: g, matrix: m, color: hexRgb(material?.color ? `#${material.color.getHexString()}` : '#b0aca6'), twoSided: false, label: String(props.name ?? 'mesh') });
        walk(props.children, m, depth + 1);
        return;
      }
      if (type === 'primitive') {
        const o = props.object as THREE.Object3D | undefined;
        if (o) {
          o.updateMatrixWorld(true);
          o.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh || !mesh.geometry) return;
            const m = parent.clone().multiply(mesh.matrixWorld);
            const im = mesh as unknown as THREE.InstancedMesh;
            if (im.isInstancedMesh) {
              const one = new THREE.Matrix4();
              for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, one); nodes.push({ geometry: mesh.geometry, matrix: m.clone().multiply(one), color: hexRgb(slotColor(String(mesh.userData.slot ?? ''))), twoSided: false, label: 'instanced' }); }
            } else {
              nodes.push({ geometry: mesh.geometry, matrix: m, color: hexRgb(slotColor(String(mesh.userData.slot ?? ''))), twoSided: false, label: mesh.name || 'primitive' });
            }
          });
        }
        return;
      }
      // lights, geometries declared as JSX, materials: nothing to rasterise
      note(type);
      return;
    }

    if (type === FRAGMENT) { walk(props.children, parent, depth + 1); return; }
    if (contexts.provider(type, props.value, () => walk(props.children, parent, depth + 1))) return;

    // --- a component: render it -------------------------------------------
    const fn = (type as { render?: unknown }).render ?? type; // forwardRef unwraps to `render`
    if (typeof fn !== 'function') { note('exotic'); walk(props.children, parent, depth + 1); return; }
    let out: unknown;
    try {
      out = (fn as (p: unknown, r?: unknown) => unknown)(props, null);
    } catch (err) {
      const named = (type as { name?: string; displayName?: string });
      note(`throw:${named.displayName || named.name || (fn as { name?: string }).name || `props(${Object.keys(props).join('/')})`}:${(err as Error).message.slice(0, 60)}`);
      return;
    }
    walk(out, parent, depth + 1);
  }

  const { BathroomScene } = await import('../src/components/scene/bathroom/BathroomScene');
  const { defaultBathroom } = await import('../src/lib/spec/defaults');
  const name = process.env.FIXTURE ?? 'demo-bathroom';
  const file = path.join(__dirname, 'fixtures', `${name}.spec.json`);
  const spec: BathroomSpec = specOverride ?? (fs.existsSync(file)
    ? ((raw: { spec?: BathroomSpec } & BathroomSpec) => raw.spec ?? raw)(JSON.parse(fs.readFileSync(file, 'utf8')))
    : defaultBathroom());

  withHooks(react, contexts.read, () => walk(react.createElement(BathroomScene, { spec }), new THREE.Matrix4(), 0));
  return { nodes, spec, skipped };
}

// ---------------------------------------------------------------------------
// Software rasteriser (same one the kitchen previewer uses)
// ---------------------------------------------------------------------------
function render(nodes: Node[], eye: THREE.Vector3, target: THREE.Vector3, fovDeg: number) {
  const view = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
  const rot = new THREE.Matrix4().extractRotation(view).transpose();
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const aspect = W / H;
  const color = new Float32Array(W * H * 3);
  // 1/z, so the depth test is perspective correct
  const invDepth = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { color[i * 3] = 0.05; color[i * 3 + 1] = 0.06; color[i * 3 + 2] = 0.07; }
  const light = new THREE.Vector3(0.4, 0.85, 0.35).normalize();
  const v = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const sa = [0, 0, 0], sb = [0, 0, 0], sc = [0, 0, 0];
  const toScreen = (p: THREE.Vector3, out: number[]) => {
    v.copy(p).sub(eye).applyMatrix4(rot);
    const z = -v.z;
    out[0] = ((((v.x / z) * f) / aspect) * 0.5 + 0.5) * W;
    out[1] = (0.5 - ((v.y / z) * f) * 0.5) * H;
    out[2] = 1 / z;
  };
  let drawn = 0;
  for (const n of nodes) {
    const pos = n.geometry.getAttribute('position') as THREE.BufferAttribute;
    const idx = n.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    const [cr, cg, cb] = n.color;
    for (let t = 0; t + 2 < count; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(n.matrix);
      b.fromBufferAttribute(pos, i1).applyMatrix4(n.matrix);
      c.fromBufferAttribute(pos, i2).applyMatrix4(n.matrix);
      // back-face cull exactly as the renderer does (FrontSide), which is what
      // makes the single-sided walls a dollhouse
      const enx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      const eny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      const enz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const facing = enx * (eye.x - a.x) + eny * (eye.y - a.y) + enz * (eye.z - a.z);
      if (facing < 0 && !n.twoSided) continue;
      toScreen(a, sa); toScreen(b, sb); toScreen(c, sc);
      if (sa[2] <= 0 || sb[2] <= 0 || sc[2] <= 0 || sa[2] > 40 || sb[2] > 40 || sc[2] > 40) continue;
      const minX = Math.max(0, Math.floor(Math.min(sa[0], sb[0], sc[0])));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(sa[0], sb[0], sc[0])));
      const minY = Math.max(0, Math.floor(Math.min(sa[1], sb[1], sc[1])));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(sa[1], sb[1], sc[1])));
      if (maxX < minX || maxY < minY) continue;
      const area = (sb[0] - sa[0]) * (sc[1] - sa[1]) - (sc[0] - sa[0]) * (sb[1] - sa[1]);
      if (Math.abs(area) < 1e-9) continue;
      const nl = Math.hypot(enx, eny, enz) || 1;
      const lam = Math.abs((enx / nl) * light.x + (eny / nl) * light.y + (enz / nl) * light.z);
      const sh = 0.24 + 0.76 * lam;
      drawn++;
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const x = px + 0.5, y = py + 0.5;
          let w0 = (sb[0] - sa[0]) * (y - sa[1]) - (x - sa[0]) * (sb[1] - sa[1]);
          let w1 = (sc[0] - sb[0]) * (y - sb[1]) - (x - sb[0]) * (sc[1] - sb[1]);
          let w2 = (sa[0] - sc[0]) * (y - sc[1]) - (x - sc[0]) * (sa[1] - sc[1]);
          if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const sum = w0 + w1 + w2 || 1;
          const iz = (w1 * sa[2] + w2 * sb[2] + w0 * sc[2]) / sum;
          const o = py * W + px;
          if (iz <= invDepth[o]) continue;
          invDepth[o] = iz;
          color[o * 3] = cr * sh; color[o * 3 + 1] = cg * sh; color[o * 3 + 2] = cb * sh;
        }
      }
    }
  }
  return { color, drawn };
}

// --- minimal PNG writer -----------------------------------------------------
function crc32(buf: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePng(file: string, color: Float32Array) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      for (let ch = 0; ch < 3; ch++) raw[o++] = Math.round(255 * Math.pow(Math.max(0, Math.min(1, color[i + ch])), 1 / 2.2));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

// --- go ---------------------------------------------------------------------
async function main() {
  const out = process.argv[2] ?? 'bathroom-preview.png';
  const wanted = process.argv[3] ?? 'wide';
  const all = process.argv.includes('--all');
  const { nodes, spec, skipped } = await harvestBathroom();
  const { computeBathroomLayout } = await import('../src/components/scene/bathroom/layout');
  const L = computeBathroomLayout(spec);
  const { w, d, h } = L;
  // aim the detail views at what the layout actually solved, not at the spec's
  // declared `t` — a fixture can be slid by the collision pass
  const at = (r: { minX: number; maxX: number; minZ: number; maxZ: number } | undefined) =>
    (r ? new THREE.Vector3((r.minX + r.maxX) / 2, 1.1, (r.minZ + r.maxZ) / 2) : new THREE.Vector3(0, 1.1, 0));
  const vanityC = at(L.vanity?.rect), showerC = at(L.shower?.rect), tubC = at(L.tub?.rect);
  const back = (p: THREE.Vector3, k: number) => new THREE.Vector3(p.x * (1 - k), 1.55, p.z * (1 - k) + (p.z < 0 ? k * d * 0.45 : -k * d * 0.45));
  const cams: Record<string, { eye: THREE.Vector3; target: THREE.Vector3; fov: number }> = {
    wide: { eye: new THREE.Vector3(w * 0.42, h * 0.62, d * 0.48), target: new THREE.Vector3(-w * 0.05, h * 0.36, -d * 0.05), fov: 62 },
    vanity: { eye: back(vanityC, 0.75), target: new THREE.Vector3(vanityC.x, 1.15, vanityC.z), fov: 52 },
    shower: { eye: back(showerC, 0.8), target: new THREE.Vector3(showerC.x, 1.15, showerC.z), fov: 55 },
    tub: { eye: back(tubC, 0.8), target: new THREE.Vector3(tubC.x, 0.7, tubC.z), fov: 52 },
    // close on the niche wall: the reveals and the shelf
    niche: { eye: new THREE.Vector3(showerC.x, 1.35, showerC.z + Math.min(1.1, d * 0.35)), target: new THREE.Vector3(showerC.x, 1.35, showerC.z - 0.6), fov: 42 },
    // square on to a wall from a metre out: the tile MODULE, its courses, the
    // grout reveal and where the field stops. `tile` is the field wall the
    // vanity stands on, `accent` the feature wall.
    tile: { eye: new THREE.Vector3(-w / 2 + 1.15, 1.25, vanityC.z), target: new THREE.Vector3(-w / 2, 1.15, vanityC.z), fov: 55 },
    accent: { eye: new THREE.Vector3(0, 1.35, -d / 2 + 1.5), target: new THREE.Vector3(0, 1.3, -d / 2), fov: 60 },
    plan: { eye: new THREE.Vector3(0, Math.max(w, d) * 1.4, 0.001), target: new THREE.Vector3(0, 0, 0), fov: 50 },
    door: { eye: new THREE.Vector3(0, 1.6, d * 0.46), target: new THREE.Vector3(0, 1.1, -d / 2), fov: 60 },
  };
  // What this room COSTS. The harvest is the whole component tree, so this is
  // the real scene total the 1.2 M budget is spent against — worth printing
  // next to a fixture that turns a feature wall on (a woven accent is the
  // single most expensive thing a bathroom spec can ask for).
  const tris = nodes.reduce((n, x) => n + (x.geometry.getIndex()?.count ?? x.geometry.getAttribute('position').count) / 3, 0);
  // NB: each INSTANCE counts as a node here (the walk flattens the batches),
  // so this is a triangle total, not a draw-call count — `check-bathroom.ts`
  // is where draw calls are budgeted.
  console.log(`${nodes.length} meshes + instances / ${Math.round(tris).toLocaleString()} triangles in the whole room`);
  const views = all ? Object.keys(cams) : [wanted];
  for (const view of views) {
    const cam = cams[view] ?? cams.wide;
    const t0 = Date.now();
    // This rasterizer has no transmission. Hide front glazing for a niche
    // inspection so an opaque stand-in pane cannot conceal the recess being checked.
    const inspection = view === 'niche' ? nodes.filter((n) => n.label !== 'glass') : nodes;
    const r = render(inspection, cam.eye, cam.target, cam.fov);
    const file = all ? out.replace(/(\.png)?$/, `-${view}.png`) : out;
    writePng(file, r.color);
    console.log(`${file} — ${nodes.length} nodes, ${r.drawn} triangles in ${Date.now() - t0} ms`);
  }
  if (skipped.size) console.log(`skipped: ${[...skipped].map(([k, n]) => `${k}×${n}`).join(', ')}`);
  // The material factory defers its procedural texture bakes onto a timer
  // (`onIdle`). Every PNG is already written and none of that work can change
  // one, so leave before a stub canvas is asked to do real drawing.
  process.exit(0);
}
if (require.main === module) void main();
