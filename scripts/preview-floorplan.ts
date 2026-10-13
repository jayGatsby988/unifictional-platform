/**
 * Offscreen preview of the whole HOUSE — the floor plan's answer to
 * `scripts/preview-kitchen.ts` and `scripts/preview-bathroom.ts`, so a
 * two-storey twin can be LOOKED AT without a browser or a GPU.
 *
 *   npx tsx scripts/preview-floorplan.ts [out.png] [view] [--all]
 *   views: dollhouse | plan | level=N | eye | eye=<room id or name> | stair
 *   FIXTURE=<name> (scripts/fixtures/<name>.spec.json), default: the demo house
 *
 * Not a renderer: no textures, no shadows, no post. It exists to catch the
 * things a headless numeric check cannot — a floor facing down, a stair
 * climbing into a ceiling, a door leaf through its jamb, a wall that stops an
 * inch short of the corner it was supposed to close.
 *
 * WHY IT WALKS THE COMPONENTS
 * Same reason `preview-bathroom.ts` does, and more so here: the house has no
 * `Part[]` to read. Rebuilding the placements in this file would test a COPY
 * of the geometry rather than the geometry, and the divergence between the two
 * is exactly the bug class a preview exists to catch. So this calls the real
 * components with a trivial hook dispatcher (`withHooks`) and harvests
 * `<Surface/>`, `<Prop/>` and `<InstancedSurface/>` straight off their props,
 * before any material, texture or canvas is touched.
 *
 * It enters through `<SceneRouter/>` rather than naming a scene module, so it
 * measures whatever the studio actually renders for a plan — no path to keep
 * in step, and the day the scene stream wires the builder in, this and the
 * geometric assertions in `check-floorplan.ts` start reading it with no edit
 * here. Until then the harvest comes back EMPTY and says so.
 *
 * The harvest is exported because `check-floorplan.ts` §6 asserts against the
 * same parts: one walk, one set of triangles, so a check and a picture cannot
 * disagree about what was built. Importing this file therefore must not draw
 * anything — `main()` runs only when it is the entry point.
 */
import * as THREE from 'three';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { ft, mToFt } from '../src/lib/units';
import {
  planBounds, planOrigin, planPolygonCentroid, stairFootprintCorners,
} from '../src/lib/spec/floorplan';
import type { FloorPlanSpec, Level, PlanPoint, PlanRoom, PlanStair } from '../src/lib/spec/types';
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
 * The components are pure render functions: they read the spec, build geometry
 * in `useMemo`, and read a couple of zustand selectors. None of that needs
 * React's scheduler — it needs a dispatcher that is not null. So every hook
 * here is its simplest honest answer for a SINGLE render: `useMemo` calls the
 * factory, `useState` hands back the initial value, effects never run, and
 * `useSyncExternalStore` reads the snapshot (which is how zustand selectors
 * return the real store state).
 */
type Dispatcher = Record<string, (...args: never[]) => unknown>;
function makeDispatcher(readContext: (context: unknown) => unknown): Dispatcher {
  const noop = () => undefined;
  return {
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
}
const fakeR3FState = { gl: { capabilities: { getMaxAnisotropy: () => 8 } }, scene: null, camera: null, size: { width: W, height: H } };
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
// The harvest — shared with check-floorplan.ts
// ---------------------------------------------------------------------------
type Vec3 = [number, number, number];

/** One mesh the component tree emitted, with its world transform. */
export interface PlanPart {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  /** the material slot it is driven by — `flooring`, `walls`, `stair_treads`… */
  slot: string;
  /** a fixed utility finish (glass, chrome…) instead of a slot, when it has one */
  util: string | null;
  /** one instance of an `<InstancedSurface/>` batch rather than its own draw call */
  instanced: boolean;
  label: string;
}

export interface PlanHarvest {
  parts: PlanPart[];
  /** `<Surface/>`/`<Prop/>` = 1 each, an instanced batch = 1 whatever its count. */
  drawCalls: number;
  triangles: number;
  /** everything the walk did not rasterise, by intrinsic/component name */
  skipped: Map<string, number>;
  /** true when the scene builder has not landed yet, so there is nothing to look at */
  empty: boolean;
}

const FRAGMENT = Symbol.for('react.fragment');

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

/**
 * Walk `<SceneRouter spec={plan}/>` and collect every mesh it emits.
 *
 * The entry point is the router, not a scene module, because the router is
 * what the studio renders: whatever it returns for a plan is what a user sees,
 * and a harvest that named the builder directly could keep passing after the
 * router stopped routing to it.
 */
export async function harvestFloorPlan(spec: FloorPlanSpec, opts: { walking?: boolean } = {}): Promise<PlanHarvest> {
  const { context } = await import('@react-three/fiber');
  const contexts = previewContexts(context, fakeR3FStore);
  const react = await import('react');
  const { Surface, Prop, InstancedSurface } = await import('../src/components/scene/Surface');
  const { SceneRouter } = await import('../src/components/studio/SceneRouter');
  // The scene asks the store which camera mode it is in and draws the top
  // storey's CEILING only while walking — the dollhouse orbit looks down into
  // the house and a lid over it would show the client a roof. So the harvest
  // has to say which of the two houses it wants: harvesting in the default
  // orbit and then rendering an eye-height view is a picture of a storey with
  // no ceiling, which is not what the walker sees and not what §6 should audit.
  const { useProjectStore } = await import('../src/lib/store/project-store');
  const heldMode = useProjectStore.getState().ui.cameraMode;
  useProjectStore.setState((s) => ({ ui: { ...s.ui, cameraMode: opts.walking ? 'walk' : 'orbit' } }));

  const parts: PlanPart[] = [];
  const skipped = new Map<string, number>();
  const note = (k: string) => skipped.set(k, (skipped.get(k) ?? 0) + 1);
  let drawCalls = 0;

  const push = (geometry: THREE.BufferGeometry | undefined, matrix: THREE.Matrix4, props: Record<string, unknown>, instanced: boolean, label?: string) => {
    if (!geometry || !geometry.getAttribute('position')) return false;
    parts.push({
      geometry,
      matrix,
      slot: String(props.slot ?? ''),
      util: typeof props.util === 'string' ? props.util : null,
      instanced,
      label: label ?? String(props.slot ?? props.util ?? 'part'),
    });
    return true;
  };

  function walk(el: unknown, parent: THREE.Matrix4, depth: number) {
    if (el == null || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') return;
    if (Array.isArray(el)) { for (const c of el) walk(c, parent, depth); return; }
    if (depth > 80) return;
    const e = el as { type?: unknown; props?: Record<string, unknown> };
    if (!e.type) return;
    const props = e.props ?? {};
    const type = e.type as unknown;

    // --- the three leaves we actually want ---------------------------------
    if (type === Surface || type === Prop) {
      const here = parent.clone().multiply(compose(props));
      if (push(props.geometry as THREE.BufferGeometry | undefined, here, props, false)) drawCalls++;
      walk(props.children, here, depth + 1);
      return;
    }
    if (type === InstancedSurface) {
      const g = props.geometry as THREE.BufferGeometry | undefined;
      const transforms = (props.transforms as Array<Record<string, unknown>> | undefined) ?? [];
      if (g && g.getAttribute('position')) {
        drawCalls++; // one batch, one call, however many balusters are in it
        for (const t of transforms) push(g, parent.clone().multiply(compose(t)), props, true, `${String(props.slot ?? props.util)}·i`);
      }
      return;
    }

    // --- intrinsics ---------------------------------------------------------
    if (typeof type === 'string') {
      if (type === 'group') { walk(props.children, parent.clone().multiply(compose(props)), depth + 1); return; }
      if (type === 'mesh') {
        const m = parent.clone().multiply(compose(props));
        const ud = (props.userData ?? {}) as Record<string, unknown>;
        if (push(props.geometry as THREE.BufferGeometry | undefined, m, { slot: ud.slot ?? '' }, false, 'mesh')) drawCalls++;
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
            const slot = { slot: String(mesh.userData.slot ?? '') };
            const im = mesh as unknown as THREE.InstancedMesh;
            if (im.isInstancedMesh) {
              drawCalls++;
              const one = new THREE.Matrix4();
              for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, one); push(mesh.geometry, m.clone().multiply(one), slot, true, 'instanced'); }
            } else if (push(mesh.geometry, m, slot, false, mesh.name || 'primitive')) drawCalls++;
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

  try {
    withHooks(react, contexts.read, () => walk(react.createElement(SceneRouter, { spec }), new THREE.Matrix4(), 0));
  } finally {
    useProjectStore.setState((s) => ({ ui: { ...s.ui, cameraMode: heldMode } }));
  }

  const triangles = parts.reduce((n, p) => n + (p.geometry.getIndex()?.count ?? p.geometry.getAttribute('position').count) / 3, 0);
  return { parts, drawCalls, triangles: Math.round(triangles), skipped, empty: parts.length === 0 };
}

// ---------------------------------------------------------------------------
// World-space triangles — what the assertions measure
// ---------------------------------------------------------------------------
export interface WorldTri {
  a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3;
  /** unit face normal, right-hand wound like the renderer reads it */
  n: THREE.Vector3;
  /** centroid, the point most assertions test for containment */
  mid: THREE.Vector3;
  /** square metres */
  area: number;
  slot: string;
  util: string | null;
}

/**
 * Every triangle of the harvest in world space, optionally only those from the
 * named slots. This is deliberately the LOWEST level the parts can be read at:
 * a scene stream is free to merge every wall on a level into one geometry, and
 * an assertion that worked per-mesh would stop working the day it did.
 */
export function worldTriangles(h: PlanHarvest, slots?: readonly string[]): WorldTri[] {
  const want = slots ? new Set(slots) : null;
  const out: WorldTri[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (const p of h.parts) {
    if (want && !want.has(p.slot)) continue;
    const pos = p.geometry.getAttribute('position') as THREE.BufferAttribute;
    const idx = p.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(p.matrix);
      b.fromBufferAttribute(pos, i1).applyMatrix4(p.matrix);
      c.fromBufferAttribute(pos, i2).applyMatrix4(p.matrix);
      ab.subVectors(b, a); ac.subVectors(c, a);
      const cross = new THREE.Vector3().crossVectors(ab, ac);
      const len = cross.length();
      if (!(len > 1e-12)) continue; // a degenerate triangle has no face to face anywhere
      out.push({
        a: a.clone(), b: b.clone(), c: c.clone(),
        n: cross.multiplyScalar(1 / len),
        mid: new THREE.Vector3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3),
        area: len / 2,
        slot: p.slot,
        util: p.util,
      });
    }
  }
  return out;
}

/**
 * Scene metres → plan feet, the exact inverse of `planToScene`. Assertions
 * live in plan space because that is where the spec's polygons, wall centre
 * lines and stair footprints are; going the other way (projecting the spec
 * into the scene) would mean writing the mapping a second time.
 */
export const sceneToPlan = (v: { x: number; z: number }, origin: PlanPoint): PlanPoint =>
  ({ x: origin.x + mToFt(v.x), y: origin.y - mToFt(v.z) });

/** The finished-floor height of a level in scene metres. */
export const levelFloorY = (level: Level): number => ft(level.elevationFt);

// ---------------------------------------------------------------------------
// Colour — only far enough apart to read as different objects
// ---------------------------------------------------------------------------
const hexRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace('#', ''), 16);
  const lin = (c: number) => Math.pow(c / 255, 2.2);
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)];
};

const UTIL_COLOR: Record<string, string> = {
  glass: '#bcd4dc', 'window-glass': '#c8dfe8', mirror: '#c9d2d6', chrome: '#c8ccd0', stainless: '#a9adb1',
  'brushed-nickel': '#adadad', 'brushed-brass': '#b89a56', 'polished-brass': '#c8a94e', 'oil-rubbed-bronze': '#4a3a2e',
  'matte-black': '#1b1c1e', 'black-metal': '#2a2b2d', anodized: '#8f9295', porcelain: '#f4f4f1', 'white-plastic': '#eeeeea',
  'ceramic-matte': '#ded9d0', 'dark-wood': '#4a3323', 'light-wood': '#c3a074', towel: '#e6e2d8', 'fabric-linen': '#d9d2c3',
  'fabric-grey': '#9a9a96', paper: '#f0eee9', plant: '#3f7a3a', soil: '#3b2b1e', water: '#4aa3c7', rubber: '#212123',
  concrete: '#8c8c88', 'leather-tan': '#8b5a34', 'sky-grey': '#dfe8ef', 'emissive-warm': '#ffe9c4', 'emissive-cool': '#e6f0ff',
  'shadow-catcher': '#202020',
};

// ---------------------------------------------------------------------------
// Software rasteriser (the same one the kitchen and bathroom previewers use)
// ---------------------------------------------------------------------------
interface Node { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; color: [number, number, number]; twoSided: boolean }

function render(nodes: Node[], eye: THREE.Vector3, target: THREE.Vector3, fovDeg: number, far: number) {
  const view = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
  const rot = new THREE.Matrix4().extractRotation(view).transpose();
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const aspect = W / H;
  const color = new Float32Array(W * H * 3);
  // 1/z, so the depth test is perspective correct
  const invDepth = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { color[i * 3] = 0.05; color[i * 3 + 1] = 0.06; color[i * 3 + 2] = 0.07; }
  const light = new THREE.Vector3(0.4, 0.85, 0.35).normalize();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const sa = [0, 0, 0], sb = [0, 0, 0], sc = [0, 0, 0];
  const toView = (p: THREE.Vector3) => p.clone().sub(eye).applyMatrix4(rot);
  const project = (v: THREE.Vector3, out: number[]) => {
    const z = -v.z;
    out[0] = ((((v.x / z) * f) / aspect) * 0.5 + 0.5) * W;
    out[1] = (0.5 - ((v.y / z) * f) * 0.5) * H;
    out[2] = 1 / z;
  };
  /**
   * Sutherland–Hodgman against the near plane, in view space.
   *
   * Dropping any triangle with a vertex behind the eye — which is what the
   * kitchen and bathroom previewers do — is fine in a 10 ft room and useless
   * in a house: a whole storey's floor is two big triangles, and standing on
   * it puts a vertex behind you, so the floor you are standing on vanishes and
   * the picture lies about the one thing an interior view is for.
   */
  const NEAR = 0.05;
  const clipNear = (poly: THREE.Vector3[]): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
      const dc = -cur.z - NEAR, dp = -prev.z - NEAR;
      if ((dp < 0) !== (dc < 0)) out.push(new THREE.Vector3().lerpVectors(prev, cur, dp / (dp - dc)));
      if (dc >= 0) out.push(cur);
    }
    return out;
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
      const poly = clipNear([toView(a), toView(b), toView(c)]);
      if (poly.length < 3) continue;
      const nl = Math.hypot(enx, eny, enz) || 1;
      const lam = Math.abs((enx / nl) * light.x + (eny / nl) * light.y + (enz / nl) * light.z);
      const sh = 0.24 + 0.76 * lam;
      // a clipped triangle comes back as a quad or a pentagon: fan it
      for (let k = 1; k + 1 < poly.length; k++) {
        project(poly[0], sa); project(poly[k], sb); project(poly[k + 1], sc);
        if (1 / sa[2] > far && 1 / sb[2] > far && 1 / sc[2] > far) continue;
        const minX = Math.max(0, Math.floor(Math.min(sa[0], sb[0], sc[0])));
        const maxX = Math.min(W - 1, Math.ceil(Math.max(sa[0], sb[0], sc[0])));
        const minY = Math.max(0, Math.floor(Math.min(sa[1], sb[1], sc[1])));
        const maxY = Math.min(H - 1, Math.ceil(Math.max(sa[1], sb[1], sc[1])));
        if (maxX < minX || maxY < minY) continue;
        const area = (sb[0] - sa[0]) * (sc[1] - sa[1]) - (sc[0] - sa[0]) * (sb[1] - sa[1]);
        if (Math.abs(area) < 1e-9) continue;
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

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------
interface Cam { eye: THREE.Vector3; target: THREE.Vector3; fov: number }

const scenePoint = (p: PlanPoint, o: PlanPoint, elevFt: number) =>
  new THREE.Vector3(ft(p.x - o.x), ft(elevFt), ft(o.y - p.y));

/**
 * The room the `eye` view stands in when none is named: the biggest room on
 * the ground floor that a person would actually stand in the middle of. A
 * closet is technically a room and is a useless picture.
 */
function defaultEyeRoom(level: Level): PlanRoom | null {
  const usable = level.rooms.filter((r) => r.kind !== 'closet' && r.kind !== 'mechanical');
  const pool = usable.length ? usable : level.rooms;
  let best: PlanRoom | null = null, bestA = -1;
  for (const r of pool) {
    const a = Math.abs(r.polygon.reduce((s, p, i, arr) => { const q = arr[(i + 1) % arr.length]; return s + (p.x * q.y - q.x * p.y); }, 0) / 2);
    if (a > bestA) { bestA = a; best = r; }
  }
  return best;
}

/**
 * Stand inside a room at eye height and look ACROSS it — down its longest
 * axis, from a quarter of the way in to three quarters. That framing is the
 * client's sentence ("if I go inside the house, the rooms should be empty but
 * rooms and stairs shud be there") turned into a picture: it shows the far
 * wall, both side walls and the floor–wall junction all at once.
 */
function eyeCam(room: PlanRoom, level: Level, o: PlanPoint): Cam {
  const xs = room.polygon.map((p) => p.x), ys = room.polygon.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
  const c = planPolygonCentroid(room.polygon);
  const long = Math.max(w, d);
  const from: PlanPoint = w >= d ? { x: c.x - long * 0.3, y: c.y } : { x: c.x, y: c.y - long * 0.3 };
  const to: PlanPoint = w >= d ? { x: c.x + long * 0.5, y: c.y } : { x: c.x, y: c.y + long * 0.5 };
  const eye = scenePoint(from, o, level.elevationFt);
  const target = scenePoint(to, o, level.elevationFt);
  eye.y += ft(5.4);
  target.y += ft(5.0);
  return { eye, target, fov: 65 };
}

/**
 * At the foot of the flight, looking up it. The bottom edge of the footprint
 * is corners 0→1 (`widthFt` runs along +x before the rotation), so its midpoint
 * is where a person steps on, and corners 2→3 is the head.
 */
function stairCam(stair: PlanStair, level: Level, upper: Level | undefined, o: PlanPoint, bounds?: { minX: number; minY: number; maxX: number; maxY: number }): Cam {
  const c = stairFootprintCorners(stair);
  const foot: PlanPoint = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
  const head: PlanPoint = { x: (c[2].x + c[3].x) / 2, y: (c[2].y + c[3].y) / 2 };
  const len = Math.hypot(head.x - foot.x, head.y - foot.y) || 1;
  const ux = (head.x - foot.x) / len, uy = (head.y - foot.y) / len;
  // Stand back off the bottom riser — but a stair hall is usually the depth of
  // the flight and no more, so backing off a fixed 5 ft puts the camera inside
  // the exterior wall behind it and the picture is a grey rectangle. Take the
  // furthest stand-off that is still inside the footprint; going NEGATIVE (a
  // step or two up the flight itself) is the honest answer when the foot of
  // the stair is against a wall.
  const b = bounds ?? { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };
  const inside = (p: PlanPoint) => p.x > b.minX + 0.75 && p.x < b.maxX - 0.75 && p.y > b.minY + 0.75 && p.y < b.maxY - 0.75;
  let back = -2;
  for (let v = 5; v >= -2; v -= 0.25) {
    if (inside({ x: foot.x - ux * v, y: foot.y - uy * v })) { back = v; break; }
  }
  const from: PlanPoint = { x: foot.x - ux * back, y: foot.y - uy * back };
  const eye = scenePoint(from, o, level.elevationFt);
  eye.y += ft(5.4);
  const target = scenePoint({ x: head.x, y: head.y }, o, upper?.elevationFt ?? level.elevationFt);
  return { eye, target, fov: 62 };
}

// --- go ---------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--all');
  const out = args[0] ?? 'floorplan-preview.png';
  const wanted = args[1] ?? 'dollhouse';
  const all = process.argv.includes('--all');

  const { defaultFloorPlan } = await import('../src/lib/spec/defaults');
  const { healFloorPlan } = await import('../src/lib/spec/floorplan');
  const name = process.env.FIXTURE ?? '';
  const file = name ? path.join(__dirname, 'fixtures', `${name}.spec.json`) : '';
  let spec: FloorPlanSpec = defaultFloorPlan();
  if (file && fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { spec?: FloorPlanSpec } & FloorPlanSpec;
    const loaded = raw.spec ?? raw;
    // a fixture is a client's drawing, so it goes through the healer the way
    // the store and every route do — a preview of an unhealed plan is a
    // preview of something the app will never render
    spec = { ...loaded, levels: healFloorPlan(loaded.levels) };
  } else if (name) {
    console.log(`(no fixture ${name}.spec.json — using the demo house)`);
  }

  // Two houses, because there are two: the dollhouse the orbit sees (no lid on
  // the top storey) and the one a walker is inside (every ceiling). A view
  // that stands at eye height has to be rendered from the walked one or the
  // client is shown a top floor open to the sky.
  const h = await harvestFloorPlan(spec);
  const walked = await harvestFloorPlan(spec, { walking: true });
  const { getMaterial } = await import('../src/lib/materials/catalog');
  const { DEFAULT_SELECTIONS } = await import('../src/lib/materials/catalog');
  const selections = DEFAULT_SELECTIONS.floorplan as Record<string, string>;
  const HEX = /^#[0-9a-f]{6}$/i;
  // A procedural material has no single colour of its own; its `swatch` is the
  // hex the material picker shows for it, which is the closest honest answer.
  const swatchOf = (m: { pbr: { color?: string }; swatch: string } | undefined): string | null =>
    (m?.pbr.color && HEX.test(m.pbr.color) ? m.pbr.color : m && HEX.test(m.swatch) ? m.swatch : null);
  const colorFor = (p: PlanPart): string => {
    if (p.util) return UTIL_COLOR[p.util] ?? '#ff00ff';
    const id = spec.materials?.[p.slot as keyof typeof spec.materials] ?? selections[p.slot];
    return (id ? swatchOf(getMaterial(id)) : null) ?? '#b0aca6';
  };
  const nodesOf = (harvest: PlanHarvest): Node[] => harvest.parts.map((p) => ({
    geometry: p.geometry, matrix: p.matrix, color: hexRgb(colorFor(p)),
    twoSided: p.util === 'plant' || p.util === 'sky-grey',
  }));
  const orbitNodes = nodesOf(h), walkNodes = nodesOf(walked);

  const b = planBounds(spec);
  const o = planOrigin(spec);
  const spanFt = Math.max(b.maxX - b.minX, b.maxY - b.minY, 4);
  const span = ft(spanFt);
  const dM = ft(Math.max(4, b.maxY - b.minY));
  const topFt = spec.levels.reduce((t, l) => Math.max(t, l.elevationFt + l.ceilingFt), 9);

  // the dollhouse IS the studio's opening frame — imported, not re-derived, so
  // the picture and the app cannot disagree about where the camera stands
  const { floorPlanRig } = await import('../src/components/studio/SceneRouter');
  const rig = floorPlanRig(spec);
  const cams: Record<string, Cam> = {
    dollhouse: {
      eye: new THREE.Vector3(rig.position[0], rig.position[1], rig.position[2]),
      target: new THREE.Vector3(rig.target[0], rig.target[1], rig.target[2]),
      fov: 45,
    },
    plan: { eye: new THREE.Vector3(0, ft(topFt) + span * 1.5, 0.001), target: new THREE.Vector3(0, 0, 0), fov: 50 },
    stair: { eye: new THREE.Vector3(0, ft(5.4), dM), target: new THREE.Vector3(0, ft(5), 0), fov: 62 },
  };
  for (const level of spec.levels) {
    // a level from above and just outside its own storey: the walls are
    // single-sided, so looking down into them is the dollhouse cutaway
    cams[`level=${level.index}`] = {
      eye: new THREE.Vector3(span * 0.32, ft(level.elevationFt + level.ceilingFt) + span * 0.62, dM * 0.42 + span * 0.34),
      target: new THREE.Vector3(0, ft(level.elevationFt), 0),
      fov: 52,
    };
    const room = defaultEyeRoom(level);
    if (room) {
      cams[`eye=${level.index}`] = eyeCam(room, level, o);
      for (const r of level.rooms) cams[`eye=${r.id}`] = eyeCam(r, level, o);
    }
  }
  const ground = spec.levels[0];
  const flight = spec.levels.flatMap((l) => l.stairs.map((s) => ({ s, l })))[0];
  if (flight) cams.stair = stairCam(flight.s, flight.l, spec.levels.find((l) => l.index === flight.s.connects.toLevel), o, b);
  if (ground) {
    const room = defaultEyeRoom(ground);
    if (room) cams.eye = eyeCam(room, ground, o);
  }

  // WHAT THE HOUSE COSTS. The harvest is the whole component tree, so this is
  // the real total the 900-call / 1.2 M-triangle budget is spent against — and
  // the number `verify-scenes.mts` budgets a plan against from the spec alone.
  console.log(`${h.parts.length} meshes + instances / ${h.drawCalls} draw calls / ${h.triangles.toLocaleString('en-US')} triangles in the whole house`);
  console.log(`  walking (every ceiling drawn): ${walked.parts.length} meshes + instances / ${walked.drawCalls} draw calls / ${walked.triangles.toLocaleString('en-US')} triangles`);
  const bySlot = new Map<string, number>();
  for (const p of walked.parts) {
    const key = p.util ? `util:${p.util}` : p.slot || '(no slot)';
    const tris = (p.geometry.getIndex()?.count ?? p.geometry.getAttribute('position').count) / 3;
    bySlot.set(key, (bySlot.get(key) ?? 0) + tris);
  }
  if (bySlot.size) {
    console.log(`  by slot: ${[...bySlot].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${Math.round(n).toLocaleString('en-US')}`).join(', ')}`);
  }
  if (h.empty) {
    console.log('NOTHING TO DRAW — <SceneRouter/> returns no geometry for a floor plan yet.');
    console.log('The scene builder has not landed; every view below will render an empty frame.');
  }

  const far = span * 6;
  const views = all ? ['dollhouse', 'plan', ...spec.levels.map((l) => `level=${l.index}`), 'eye', 'stair'] : [wanted];
  for (const view of views) {
    const cam = cams[view] ?? cams.dollhouse;
    if (!cams[view]) console.log(`(no view "${view}" — falling back to dollhouse; have: ${Object.keys(cams).filter((k) => !k.startsWith('eye=')).join(', ')}, eye=<room id>)`);
    // eye and stair are the views that exist to show what a WALKER sees, so
    // they are rendered from the walked house; dollhouse, plan and the level
    // cutaways look down into it and want the lid off
    const walking = view === 'eye' || view === 'stair' || view.startsWith('eye=');
    const nodes = walking ? walkNodes : orbitNodes;
    const t0 = Date.now();
    const r = render(nodes, cam.eye, cam.target, cam.fov, far);
    const fileOut = all ? out.replace(/(\.png)?$/, `-${view.replace('=', '')}.png`) : out;
    writePng(fileOut, r.color);
    console.log(`${fileOut} — ${nodes.length} nodes${walking ? ' (walking)' : ''}, ${r.drawn} triangles in ${Date.now() - t0} ms`);
  }
  if (h.skipped.size) console.log(`skipped: ${[...h.skipped].map(([k, n]) => `${k}×${n}`).join(', ')}`);
  // The material factory defers its procedural texture bakes onto a timer
  // (`onIdle`). Every PNG is already written and none of that work can change
  // one, so leave before a stub canvas is asked to do real drawing.
  process.exit(0);
}

// Only when this file IS the command. `check-floorplan.ts` imports the harvest
// above, and a suite that started rendering PNGs on import would be a suite
// nobody runs.
if (require.main === module) void main();
