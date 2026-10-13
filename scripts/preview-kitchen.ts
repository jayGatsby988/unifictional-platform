/**
 * Offscreen preview of the kitchen twin — a tiny software rasteriser so the
 * geometry can be LOOKED AT without a browser or a GPU.
 *
 *   npx tsx scripts/preview-kitchen.ts [out.png]
 *
 * Not a renderer: no textures, no shadows, no post. It exists to catch the
 * things a headless numeric check cannot — trim swept inside a wall, a crown
 * upside down, a door facing backwards, a stool floating.
 */
import * as THREE from 'three';
import * as zlib from 'zlib';
import * as fs from 'fs';
import { defaultKitchen } from '../src/lib/spec/defaults';
import type { KitchenSpec } from '../src/lib/spec/types';
import { computeKitchenLayout, pendantDrop, pendantPositions, type KitchenLayoutData } from '../src/components/scene/kitchen/layout';
import { buildKitchenPartsRaw } from '../src/components/scene/kitchen/budget';
import { wallFrame } from '../src/components/scene/geometry';
import { prop, type Part } from '../src/components/scene/kitchen/parts';

const W = 1280, H = 860;

// --- flat colours per slot, only so shapes read apart -----------------------
const COLOR: Record<string, [number, number, number]> = {
  flooring: [0.42, 0.30, 0.20], walls: [0.86, 0.84, 0.80], ceiling: [0.94, 0.93, 0.91],
  cabinets_base: [0.90, 0.89, 0.86], cabinets_upper: [0.90, 0.89, 0.86],
  island_cabinets: [0.26, 0.30, 0.32], countertop: [0.80, 0.79, 0.76],
  island_countertop: [0.80, 0.79, 0.76], backsplash: [0.74, 0.76, 0.75],
  hardware: [0.55, 0.56, 0.58], faucet: [0.62, 0.63, 0.65], appliances: [0.60, 0.62, 0.65],
};
const UTIL_COLOR: Record<string, [number, number, number]> = {
  'white-plastic': [0.95, 0.95, 0.93], 'matte-black': [0.10, 0.10, 0.11],
  'window-glass': [0.70, 0.82, 0.88], 'sky-grey': [0.90, 0.94, 0.98], glass: [0.78, 0.85, 0.88],
  chrome: [0.72, 0.74, 0.76], stainless: [0.66, 0.68, 0.70], 'brushed-nickel': [0.68, 0.68, 0.68],
  'dark-wood': [0.28, 0.19, 0.12], 'fabric-linen': [0.78, 0.73, 0.63], porcelain: [0.95, 0.95, 0.94],
  'ceramic-matte': [0.88, 0.86, 0.82], plant: [0.20, 0.42, 0.20], soil: [0.18, 0.13, 0.09],
  rubber: [0.12, 0.12, 0.12], 'leather-tan': [0.55, 0.35, 0.20], towel: [0.90, 0.89, 0.85],
  'brushed-brass': [0.72, 0.60, 0.34], concrete: [0.55, 0.55, 0.53],
  'fabric-grey': [0.58, 0.58, 0.56], paper: [0.95, 0.94, 0.91], 'light-wood': [0.78, 0.66, 0.50],
};
/** a procedural part is painted its recipe's tint — the colour it has until the map arrives */
const hexRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c: number) => Math.pow(c / 255, 2.2);
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)];
};
const colorOf = (p: Part): [number, number, number] =>
  (p.procedural ? hexRgb(p.procedural.tint) : p.metal ? hexRgb(p.metal.hex) : p.util ? UTIL_COLOR[p.util] : COLOR[String(p.slot)]) ?? [0.7, 0.7, 0.7];

function frameMatrix(frame: Part['frame'], L: KitchenLayoutData): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  if (frame === 'world') return m;
  if (frame === 'island') {
    if (!L.island) return m;
    return m.compose(new THREE.Vector3(L.island.cx, 0, L.island.cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, L.island.yaw, 0)), new THREE.Vector3(1, 1, 1));
  }
  const f = wallFrame(frame, L.w, L.d);
  const c = f.origin.clone().addScaledVector(f.along, f.length / 2);
  return m.compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.yaw, 0)), new THREE.Vector3(1, 1, 1));
}

function partMatrix(p: Part): THREE.Matrix4 {
  const sc = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : (p.scale ?? [1, 1, 1]);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(p.position?.[0] ?? 0, p.position?.[1] ?? 0, p.position?.[2] ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation?.[0] ?? 0, p.rotation?.[1] ?? 0, p.rotation?.[2] ?? 0)),
    new THREE.Vector3(sc[0], sc[1], sc[2]),
  );
}

function render(spec: KitchenSpec, eye: THREE.Vector3, target: THREE.Vector3, fovDeg: number) {
  const L = computeKitchenLayout(spec);
  const parts = buildKitchenPartsRaw(L);
  // the pendants are lights, not parts (KitchenLighting draws them), so stand
  // a brass ball on a cord where each shade hangs — the spread, offset and
  // height the layout resolved are what this preview is for
  const drop = pendantDrop(L);
  pendantPositions(L).forEach(([x, y, z], i) => {
    parts.push(prop(`preview-pendant${i}`, 'world', 'brushed-brass', new THREE.SphereGeometry(0.14, 24, 16), { position: [x, y - drop, z] }));
    parts.push(prop(`preview-cord${i}`, 'world', 'matte-black', new THREE.CylinderGeometry(0.004, 0.004, Math.max(0.05, drop - 0.14), 8), { position: [x, y - (drop - 0.14) / 2, z] }));
  });

  const view = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
  const rot = new THREE.Matrix4().extractRotation(view).transpose();
  const proj = new THREE.Matrix4().makePerspective(-1, 1, 1, -1, 1, 1); // replaced below
  void proj;
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const aspect = W / H;

  const color = new Float32Array(W * H * 3);
  // 1/z, so the depth test is perspective-correct: interpolating z linearly in
  // screen space makes a big triangle win over a small one that is genuinely
  // in front of it, which showed up as the island top vanishing under its box.
  const invDepth = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { color[i * 3] = 0.05; color[i * 3 + 1] = 0.06; color[i * 3 + 2] = 0.07; }

  const light = new THREE.Vector3(0.4, 0.85, 0.35).normalize();
  const v = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const sa = [0, 0, 0], sb = [0, 0, 0], sc = [0, 0, 0];

  const toScreen = (p: THREE.Vector3, out: number[]) => {
    v.copy(p).sub(eye).applyMatrix4(rot);
    const z = -v.z;
    out[0] = (v.x / z) * f / aspect;
    out[1] = (v.y / z) * f;
    out[2] = 1 / z;
    out[0] = (out[0] * 0.5 + 0.5) * W;
    out[1] = (0.5 - out[1] * 0.5) * H;
  };

  let drawn = 0;
  for (const p of parts) {
    const m = frameMatrix(p.frame, L).multiply(partMatrix(p));
    const instances = p.instances ?? [{ position: [0, 0, 0] as [number, number, number] }];
    for (const inst of instances) {
      const im = p.instances
        ? frameMatrix(p.frame, L).multiply(new THREE.Matrix4().compose(
          new THREE.Vector3(inst.position?.[0] ?? 0, inst.position?.[1] ?? 0, inst.position?.[2] ?? 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(...(inst.rotation ?? [0, 0, 0]))),
          new THREE.Vector3(1, 1, 1)))
        : m;
      const g = p.geometry;
      const pos = g.getAttribute('position');
      const idx = g.getIndex();
      const n = idx ? idx.count : pos.count;
      const [cr, cg, cb] = colorOf(p);
      const twoSided = p.util === 'plant' || p.util === 'sky-grey';
      for (let t = 0; t < n; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        a.fromBufferAttribute(pos as THREE.BufferAttribute, i0).applyMatrix4(im);
        b.fromBufferAttribute(pos as THREE.BufferAttribute, i1).applyMatrix4(im);
        c.fromBufferAttribute(pos as THREE.BufferAttribute, i2).applyMatrix4(im);
        // back-face cull exactly as the renderer does (materials are FrontSide),
        // which is what makes the single-sided walls a dollhouse
        const enx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
        const eny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        const enz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const facing = enx * (eye.x - a.x) + eny * (eye.y - a.y) + enz * (eye.z - a.z);
        if (facing < 0 && !twoSided) continue;
        toScreen(a, sa); toScreen(b, sb); toScreen(c, sc);
        if (sa[2] <= 0 || sb[2] <= 0 || sc[2] <= 0 || sa[2] > 20 || sb[2] > 20 || sc[2] > 20) continue;
        const minX = Math.max(0, Math.floor(Math.min(sa[0], sb[0], sc[0])));
        const maxX = Math.min(W - 1, Math.ceil(Math.max(sa[0], sb[0], sc[0])));
        const minY = Math.max(0, Math.floor(Math.min(sa[1], sb[1], sc[1])));
        const maxY = Math.min(H - 1, Math.ceil(Math.max(sa[1], sb[1], sc[1])));
        if (maxX < minX || maxY < minY) continue;
        const area = (sb[0] - sa[0]) * (sc[1] - sa[1]) - (sc[0] - sa[0]) * (sb[1] - sa[1]);
        if (Math.abs(area) < 1e-9) continue;
        // world normal for shading (two-sided: single-sided walls face inward)
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
  }
  return { color, drawn, parts: parts.length };
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
function writePng(path: string, color: Float32Array) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const lin = Math.max(0, Math.min(1, color[i + ch]));
        raw[o++] = Math.round(255 * Math.pow(lin, 1 / 2.2));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// --- go ---------------------------------------------------------------------
const out = process.argv[2] ?? 'kitchen-preview.png';
// a client fixture instead of the demo: FIXTURE=client-marble (scripts/fixtures/<name>.spec.json)
const spec: KitchenSpec = process.env.FIXTURE
  ? ((raw: { spec?: KitchenSpec } & KitchenSpec) => raw.spec ?? raw)(JSON.parse(fs.readFileSync(`${__dirname}/fixtures/${process.env.FIXTURE}.spec.json`, "utf8")))
  : defaultKitchen();
// optional overrides so a style / door style can be eyeballed without editing
if (process.argv[4]) (spec as { style: KitchenSpec['style'] }).style = process.argv[4] as KitchenSpec['style'];
if (process.argv[5]) spec.cabinets.doorStyle = process.argv[5] as KitchenSpec['cabinets']['doorStyle'];
if (process.argv[6] === 'crown') spec.cabinets.crown = true;
// a window treatment to eyeball (roman-shade | roller | curtains | blinds | cafe-curtain | none)
if (process.argv[7]) spec.decor.windowTreatment = process.argv[7] as KitchenSpec['decor']['windowTreatment'];
// appliance / stool fidelity, by environment so the positional args stay stable:
//   HOOD=curved FINISH=matte-black HOOD_CAB=doors FRIDGE=built-in BEHIND=full-height STOOLS=low-back:light-wood:woven WIDTH=22
type Ap = KitchenSpec['appliances'][number];
if (process.env.HOOD) spec.appliances = spec.appliances.map((a) => (a.kind === 'hood' ? { ...a, hoodShape: process.env.HOOD as Ap['hoodShape'] } : a));
if (process.env.FINISH) spec.appliances = spec.appliances.map((a) => (a.kind === 'hood' ? { ...a, bodyFinish: process.env.FINISH as Ap['bodyFinish'] } : a));
// what sits on the canopy: doors | glass | panel | none (unset = by hood style)
if (process.env.HOOD_CAB) spec.appliances = spec.appliances.map((a) => (a.kind === 'hood' ? { ...a, cabinetAbove: process.env.HOOD_CAB as Ap['cabinetAbove'] } : a));
if (process.env.FRIDGE) spec.appliances = spec.appliances.map((a) => (a.kind === 'fridge' ? { ...a, fridgeStyle: process.env.FRIDGE as Ap['fridgeStyle'] } : a));
if (process.env.BEHIND) spec.backsplash.behindRange = process.env.BEHIND as KitchenSpec['backsplash']['behindRange'];
if (process.env.STOOLS) {
  const [style, frame, seat] = process.env.STOOLS.split(':');
  type St = NonNullable<KitchenSpec['decor']['stools']>;
  spec.decor.stools = { style: style as St['style'], frame: frame as St['frame'], seat: seat as St['seat'] };
}
if (process.env.WIDTH) { spec.dims.widthFt = Number(process.env.WIDTH); spec.island.seating = 4; spec.island.offset = { x: 0, z: 1.5 }; }
// the photo-fit fields (check-kitchen.ts 1c), so their effect can be looked at:
//   PENDANTS=spread:offset:above (ft, ft, in; 0 = auto)  STOOL_PITCH=24  END_SEATS=1  HOOD_ABOVE=30  HOOD_H=40  FRIDGE_H=84  UPPERS=run-back:42
if (process.env.PENDANTS && spec.lighting.pendants) {
  const [spreadFt = 0, offsetFt = 0, aboveCounterIn = 0] = process.env.PENDANTS.split(':').map(Number);
  spec.lighting.pendants = { ...spec.lighting.pendants, spreadFt, offsetFt, aboveCounterIn };
}
if (process.env.STOOL_PITCH) spec.island.stoolPitchIn = Number(process.env.STOOL_PITCH);
if (process.env.END_SEATS) spec.island.endSeats = Number(process.env.END_SEATS);
if (process.env.HOOD_ABOVE) spec.appliances = spec.appliances.map((a) => (a.kind === 'hood' ? { ...a, aboveCounterIn: Number(process.env.HOOD_ABOVE) } : a));
if (process.env.HOOD_H) spec.appliances = spec.appliances.map((a) => (a.kind === 'hood' ? { ...a, heightIn: Number(process.env.HOOD_H) } : a));
if (process.env.FRIDGE_H) spec.appliances = spec.appliances.map((a) => (a.kind === 'fridge' ? { ...a, heightIn: Number(process.env.FRIDGE_H) } : a));
if (process.env.UPPERS) {
  const [id, h] = process.env.UPPERS.split(':');
  spec.runs = spec.runs.map((r) => (r.id === id ? { ...r, upperHeightIn: Number(h) } : r));
}
const w = spec.dims.widthFt * 0.3048, d = spec.dims.depthFt * 0.3048, h = spec.dims.ceilingFt * 0.3048;
const view = (process.argv[3] ?? 'wide') as 'wide' | 'close' | 'island' | 'right' | 'corner' | 'plan' | 'hood' | 'stools';
// where the layout actually put the hood on the back wall (a declared `t`
// can land in a different gap once the run is solved)
const rangeX = (() => {
  const hood = computeKitchenLayout(spec).appliances.find((a) => a.kind === 'hood' && a.wall === 'back');
  if (hood) return hood.x;
  const r = spec.appliances.find((a) => a.kind === 'range');
  return r && r.wall === 'back' ? (r.t - 0.5) * w : 0;
})();
const cams: Record<string, { eye: THREE.Vector3; target: THREE.Vector3; fov: number }> = {
  wide: { eye: new THREE.Vector3(w * 0.15, h * 0.6, d * 0.5 + Math.max(w, d) * 0.52), target: new THREE.Vector3(0, h * 0.42, -d * 0.1), fov: 58 },
  // square on to the range wall: the hood's silhouette and the splash behind it
  hood: { eye: new THREE.Vector3(rangeX - 0.3, 1.55, d * 0.12), target: new THREE.Vector3(rangeX, 1.55, -d / 2), fov: 50 },
  // low and from the island's end: the stools, their backs and the L round the end
  stools: { eye: new THREE.Vector3(w * 0.36, 1.35, d * 0.46), target: new THREE.Vector3(-w * 0.05, 0.85, 0.05), fov: 50 },
  close: { eye: new THREE.Vector3(-w * 0.05, 1.45, d * 0.05), target: new THREE.Vector3(0.2, 1.05, -d / 2), fov: 42 },
  island: { eye: new THREE.Vector3(w * 0.42, 1.55, d * 0.42), target: new THREE.Vector3(0.2, 0.95, 0.1), fov: 48 },
  // the right wall carries the demo shelves and art; the corner view sees the fig and the runner
  right: { eye: new THREE.Vector3(-w * 0.25, 1.5, d * 0.1), target: new THREE.Vector3(w / 2, 1.35, -d * 0.15), fov: 50 },
  corner: { eye: new THREE.Vector3(-w * 0.35, 1.6, -d * 0.3), target: new THREE.Vector3(w * 0.45, 0.9, d * 0.45), fov: 55 },
  // straight down: where the rug and the floor plants actually landed
  plan: { eye: new THREE.Vector3(0, Math.max(w, d) * 1.35, 0.001), target: new THREE.Vector3(0, 0, 0), fov: 50 },
};
const cam = cams[view] ?? cams.wide;
const t0 = Date.now();
const r = render(spec, cam.eye, cam.target, cam.fov);
writePng(out, r.color);
console.log(`${out} — ${r.parts} parts, ${r.drawn} triangles rasterised in ${Date.now() - t0} ms`);
