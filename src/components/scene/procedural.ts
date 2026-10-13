'use client';
/**
 * Procedural surface textures.
 *
 * The CC0 photo-texture library has no white Calacatta slab, no clean subway
 * tile and no large-format porcelain at a controllable scale — and a photo of
 * the wrong stone reads instantly as wrong. These generators draw the pattern
 * on a canvas at a size we choose, so the tile module, grout width, vein
 * colour and slab tone are exactly what the catalog says they are.
 *
 * Every generator returns a seamless, tileable canvas plus the physical size
 * that canvas represents, so `materials.ts` can set texture.repeat from the
 * world-space (metre) UVs the geometry carries.
 */
import * as THREE from 'three';

export interface ProceduralResult {
  canvas: HTMLCanvasElement;
  /** metres represented by one canvas edge along u */
  spanM: number;
  /**
   * metres represented by one canvas edge along v, when the drawing is not
   * square in world terms. Absent = square, i.e. `spanM` on both axes, which
   * is what every generator but plank floors and grouted slab tile uses.
   */
  spanVM?: number;
  /**
   * A separate HEIGHT field, in the same layout as `canvas`, for generators
   * whose relief does not follow their colour.
   *
   * Everything downstream of a drawing — the normal map, the roughness map and
   * the cavity/AO map — is derived from luminance, and for most surfaces that
   * is right: a wood pore, a plank groove and a slab vein really are darker
   * AND lower. Tile is the exception, and it is the one people look at from
   * six inches away. White grout against a navy subway tile is LIGHTER than
   * the face, so a luminance-derived normal pushed the joint OUT: every
   * dark-tile-with-white-grout backsplash in the catalog was rendering its
   * grout as a raised ridge, lit on the wrong side, and its roughness map made
   * the grout the glossiest thing on the wall.
   *
   * When a generator sets this, `materials.ts` derives normal / roughness /
   * cavity from it instead, and uses `canvas` for colour only. Absent = the
   * colour drawing is also the heightfield, which is how it always worked.
   */
  height?: HTMLCanvasElement;
}

/**
 * The three greys a height pass is drawn in. They are not physical depths —
 * `normalFromCanvas`'s `strength` and the material's `normalScale` set the
 * amplitude — they only have to be ordered and far enough apart that the
 * derived gradient survives an 8-bit round trip.
 *
 * `RIM` exists so a joint is a RAMP and not a cliff: grout → rim → face over
 * two steps gives the normal map a bevel a couple of texels wide, which is
 * what a glazed tile edge or an eased porcelain edge actually is. A single
 * step produced a one-texel vertical wall that aliased into sparkle as soon as
 * the surface tilted away from the camera.
 */
const H_GROUT = 0x38;
const H_RIM = 0x9a;
const H_FACE = 0xd6;
const greyHex = (v: number) => {
  const c = Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c}${c}${c}`;
};

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Deterministic value noise (seeded) — no per-frame cost, generated once.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic value-noise grid so the result tiles seamlessly. */
function noiseGrid(size: number, rnd: () => number): number[] {
  const g = new Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return g;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function sampleGrid(g: number[], size: number, x: number, y: number): number {
  // x,y in [0,1); wraps for seamlessness
  const fx = x * size, fy = y * size;
  const x0 = Math.floor(fx) % size, y0 = Math.floor(fy) % size;
  const x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
  const tx = smooth(fx - Math.floor(fx)), ty = smooth(fy - Math.floor(fy));
  const a = g[y0 * size + x0], b = g[y0 * size + x1], c = g[y1 * size + x0], d = g[y1 * size + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** Seamless fractal noise in [0,1]. */
function fbm(grids: Array<{ g: number[]; size: number }>, x: number, y: number): number {
  let v = 0, amp = 0.5, norm = 0;
  for (const { g, size } of grids) {
    v += amp * sampleGrid(g, size, x, y);
    norm += amp;
    amp *= 0.5;
  }
  return v / norm;
}

function makeCanvas(px: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = px;
  // These canvases are read back with getImageData to derive normal and
  // roughness maps, so ask for a CPU-backed surface up front.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d canvas unavailable');
  return { canvas, ctx };
}

// ---------------------------------------------------------------------------
// Veined stone slab (Calacatta, Carrara, quartzite, soapstone…)
// ---------------------------------------------------------------------------
export interface SlabOptions {
  base: string;
  vein: string;
  /** secondary, softer vein colour */
  vein2?: string;
  /** how many primary veins across the slab */
  veinCount?: number;
  /** 0 = no veining (solid quartz), 1 = heavily veined marble */
  intensity?: number;
  /** metres represented by one canvas edge (a slab is big: 2.4 m reads well) */
  spanM?: number;
  seed?: number;
  px?: number;
  /** subtle speckle, for granite/terrazzo-ish stone */
  speckle?: number;
  speckleColor?: string;
  /** chip radius in METRES (granite ~0.0015, terrazzo ~0.006) */
  speckleRadiusM?: number;
  /** second and third chip colours (terrazzo is multi-coloured) */
  speckleColor2?: string;
  speckleColor3?: string;
}

/**
 * Draws directional veining: a set of wandering strokes that cross the slab at
 * a shallow angle, plus a soft cloudy underlay — the two features that make
 * marble read as marble rather than as noise.
 */
export function veinedSlab(opts: SlabOptions): ProceduralResult {
  const px = qpx(opts.px);
  const spanM = opts.spanM ?? 2.4;
  const intensity = opts.intensity ?? 0.7;
  const veinCount = opts.veinCount ?? 5;
  const seed = opts.seed ?? 7;
  const rnd = mulberry32(seed);
  const { canvas, ctx } = makeCanvas(px);

  ctx.fillStyle = opts.base;
  ctx.fillRect(0, 0, px, px);

  // Cloudy underlay — very low contrast tonal drift.
  const grids = [
    { g: noiseGrid(4, rnd), size: 4 },
    { g: noiseGrid(8, rnd), size: 8 },
    { g: noiseGrid(16, rnd), size: 16 },
  ];
  const cloud = ctx.createImageData(px, px);
  // ImageData is sRGB, while THREE.Color stores linear-light channels.
  // Writing those channels directly double-decodes them when the sRGB map
  // uploads: mid-grey #808080 became #373737 before any light touched it.
  const baseCol = new THREE.Color(opts.base).convertLinearToSRGB();
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const n = fbm(grids, x / px, y / px);
      const t = (n - 0.5) * 0.16 * (0.4 + intensity);
      const i = (y * px + x) * 4;
      cloud.data[i] = Math.round(255 * THREE.MathUtils.clamp(baseCol.r + t, 0, 1));
      cloud.data[i + 1] = Math.round(255 * THREE.MathUtils.clamp(baseCol.g + t, 0, 1));
      cloud.data[i + 2] = Math.round(255 * THREE.MathUtils.clamp(baseCol.b + t, 0, 1));
      cloud.data[i + 3] = 255;
    }
  }
  ctx.putImageData(cloud, 0, 0);

  if (intensity > 0.02) {
    // Real marble veins are FEW, DIAGONAL and BRANCHING: a thin dark core
    // inside a soft grey halo, running clear across the slab at a shallow
    // angle, with side branches that taper off. The previous drawing was rows
    // of horizontal wobbles, which is what a client saw as "tan squiggles"
    // where their photo had Calacatta. Every stroke is drawn at the 9 wrap
    // offsets so the texture still tiles seamlessly in both axes.
    const angle = (rnd() * 0.5 - 0.25) + (seed % 2 === 0 ? 0.42 : -0.42);
    const dirX = Math.cos(angle), dirY = Math.sin(angle);
    const perpX = -dirY, perpY = dirX;

    /** A wandering path along `dir`, offset `off` along the perpendicular. */
    const veinPath = (off: number, length: number, wobble: number, steps = 44, startT = -0.5): Array<[number, number]> => {
      const pts: Array<[number, number]> = [];
      let drift = 0, vel = 0;
      const cx = px / 2 + perpX * off, cy = px / 2 + perpY * off;
      for (let s = 0; s <= steps; s++) {
        const t = (startT + s / steps) * length;
        vel += (rnd() - 0.5) * wobble * 0.55;
        vel *= 0.82;
        drift += vel;
        pts.push([cx + dirX * t + perpX * drift, cy + dirY * t + perpY * drift]);
      }
      return pts;
    };
    /** Stroke a path at the 9 wrap offsets, optionally tapering along its length. */
    const strokePath = (pts: Array<[number, number]>, width: number, color: string, alpha: number, blur: number, taper = false) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (blur > 0) { ctx.shadowBlur = blur; ctx.shadowColor = color; }
      const segs = taper ? 4 : 1;
      for (let k = 0; k < segs; k++) {
        const a = Math.floor((pts.length - 1) * (k / segs)), b = Math.floor((pts.length - 1) * ((k + 1) / segs));
        ctx.lineWidth = taper ? width * (1 - k / segs) : width;
        for (const ox of [-px, 0, px]) {
          for (const oy of [-px, 0, px]) {
            ctx.beginPath();
            ctx.moveTo(pts[a][0] + ox, pts[a][1] + oy);
            for (let i = a + 1; i < b; i++) {
              const mx = (pts[i][0] + pts[i + 1][0]) / 2 + ox, my = (pts[i][1] + pts[i + 1][1]) / 2 + oy;
              ctx.quadraticCurveTo(pts[i][0] + ox, pts[i][1] + oy, mx, my);
            }
            ctx.lineTo(pts[b][0] + ox, pts[b][1] + oy);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    };
    const halo = opts.vein2 ?? opts.vein;
    const n = Math.max(1, Math.round(veinCount));
    for (let i = 0; i < n; i++) {
      // spread the primaries across the slab with jitter, so two never sit together
      const off = ((i + 0.5) / n - 0.5) * px * 1.35 + (rnd() - 0.5) * (px / n) * 0.5;
      const core = px * (0.0012 + rnd() * 0.0026) * (0.6 + intensity * 0.6);
      const wobble = px * 0.02 * (0.5 + rnd());
      const main = veinPath(off, px * 1.9, wobble);
      strokePath(main, core * 11, halo, 0.16 * intensity, px * 0.014);
      strokePath(main, core * 3.2, halo, 0.42 * intensity, px * 0.003);
      strokePath(main, core, opts.vein, 0.88 * intensity, 0);
      // branches leave the main vein at 25–55° and die out
      const branches = 1 + Math.floor(rnd() * 3);
      for (let b = 0; b < branches; b++) {
        const at = main[Math.floor(main.length * (0.15 + rnd() * 0.7))];
        const side = rnd() > 0.5 ? 1 : -1;
        const ba = angle + side * (0.45 + rnd() * 0.55);
        const len = px * (0.12 + rnd() * 0.25);
        const bx = Math.cos(ba), by = Math.sin(ba);
        const pts: Array<[number, number]> = [];
        let d = 0, v = 0;
        for (let s = 0; s <= 18; s++) {
          const t = (s / 18) * len;
          v += (rnd() - 0.5) * wobble * 0.3; v *= 0.8; d += v;
          pts.push([at[0] + bx * t - by * d, at[1] + by * t + bx * d]);
        }
        strokePath(pts, core * 5, halo, 0.3 * intensity, px * 0.006, true);
        strokePath(pts, core * 0.8, opts.vein, 0.7 * intensity, 0, true);
      }
    }
    // a few hairlines at a second angle give the cross-veining Calacatta has
    const hair = Math.round(n * 0.6);
    for (let i = 0; i < hair; i++) {
      const off = (rnd() - 0.5) * px * 1.3;
      const pts = veinPath(off, px * 1.6, px * 0.012 * (0.5 + rnd()), 30);
      strokePath(pts, px * 0.0009, opts.vein, 0.32 * intensity, 0);
    }
  }

  if (opts.speckle && opts.speckle > 0) {
    // Chip size is physical, so granite grain and terrazzo chips stay the right
    // size no matter what span the slab is drawn at.
    const pxPerM = px / spanM;
    const rM = opts.speckleRadiusM ?? 0.0018;
    const rPx = Math.max(0.7, rM * pxPerM);
    const area = Math.PI * rPx * rPx;
    const coverage = 0.4 * opts.speckle;
    // hard cap: at 2048px with fine granite grain the uncapped count is >200k
    // polygons, which stalls the tab for seconds on first paint
    const n = Math.min(60000, Math.round((px * px * coverage) / area));
    const palette = [opts.speckleColor ?? opts.vein, opts.speckleColor2 ?? opts.speckleColor ?? opts.vein, opts.speckleColor3 ?? opts.base];
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = palette[Math.floor(rnd() * palette.length)];
      ctx.globalAlpha = 0.35 + rnd() * 0.55;
      const r = rPx * (0.45 + rnd() * 1.1);
      const x = rnd() * px, y = rnd() * px;
      ctx.beginPath();
      // slightly irregular chips read better than perfect circles
      const pts = 6;
      for (let k = 0; k <= pts; k++) {
        const a = (TAU * k) / pts;
        const rr = r * (0.75 + rnd() * 0.5);
        const cxp = x + rr * Math.cos(a), cyp = y + rr * Math.sin(a);
        if (k === 0) ctx.moveTo(cxp, cyp); else ctx.lineTo(cxp, cyp);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  return { canvas, spanM };
}

// ---------------------------------------------------------------------------
// Tiled walls / floors (subway, stacked, large format, hex, herringbone)
// ---------------------------------------------------------------------------
export type TilePattern = 'running-bond' | 'stacked' | 'herringbone' | 'hex' | 'basketweave';

export interface TileOptions {
  /** tile face size in METRES (e.g. subway = 0.152 × 0.076) */
  tileW: number;
  tileH: number;
  color: string;
  /** second colour, blended per tile for natural variation */
  colorAlt?: string;
  grout: string;
  /** grout joint width in metres (2–5 mm typical) */
  groutM?: number;
  pattern?: TilePattern;
  /** 0 = perfectly uniform (porcelain), 1 = handmade zellige */
  variation?: number;
  /** alternate `color` and `colorAlt` in a checkerboard instead of blending randomly */
  checker?: boolean;
  /** glossy tiles get a slight per-tile sheen gradient */
  gloss?: number;
  seed?: number;
  px?: number;
  /** how many tiles across the canvas (drives spanM) */
  cols?: number;
}

export function tiledSurface(opts: TileOptions): ProceduralResult {
  const px = qpx(opts.px);
  const pattern = opts.pattern ?? 'running-bond';
  const variation = opts.variation ?? 0.12;
  const groutM = opts.groutM ?? 0.003;
  const seed = opts.seed ?? 11;
  const cols = opts.cols ?? Math.max(2, Math.round(Math.min(16, Math.max(4, 1.6 / opts.tileW))));
  const spanM = cols * (opts.tileW + groutM);
  const scale = px / spanM; // px per metre
  const tw = opts.tileW * scale, th = opts.tileH * scale, gap = groutM * scale;

  const base = new THREE.Color(opts.color);
  const alt = opts.colorAlt ? new THREE.Color(opts.colorAlt) : null;

  /**
   * One drawing, run twice: once in colour and once as a heightfield.
   *
   * Both passes reseed the same generator and walk the same loops in the same
   * order, so tile n gets the same jitter in both and the height field lines up
   * with the colour it belongs to, texel for texel. Drawing the height pass
   * separately is the only way to get the grout DOWN when it is lighter than
   * the tile (white grout, dark tile), which is most of the catalog's subway.
   */
  const drawPass = (ctx: CanvasRenderingContext2D, height: boolean) => {
    const rnd = mulberry32(seed);
    ctx.fillStyle = height ? greyHex(H_GROUT) : opts.grout;
    ctx.fillRect(0, 0, px, px);

    /** The rounded-rect path a tile face occupies, inset by `inset` px. */
    const facePath = (x: number, y: number, w: number, h: number, inset: number) => {
      const X = x + inset, Y = y + inset, W = Math.max(0.5, w - inset * 2), H = Math.max(0.5, h - inset * 2);
      const r = Math.min(W, H) * 0.06;
      ctx.beginPath();
      ctx.moveTo(X + r, Y);
      ctx.lineTo(X + W - r, Y); ctx.quadraticCurveTo(X + W, Y, X + W, Y + r);
      ctx.lineTo(X + W, Y + H - r); ctx.quadraticCurveTo(X + W, Y + H, X + W - r, Y + H);
      ctx.lineTo(X + r, Y + H); ctx.quadraticCurveTo(X, Y + H, X, Y + H - r);
      ctx.lineTo(X, Y + r); ctx.quadraticCurveTo(X, Y, X + r, Y);
      ctx.closePath();
    };
    // The eased edge, ~0.8 mm of it, and never under TWO texels: the derived
    // normal is a central difference over ±1 texel, so a one-texel rim is
    // straddled in a single sample and the joint comes back as one vertical
    // cliff that aliases into sparkle as the surface tilts away. Two texels
    // give it the grout → rim → face ramp H_RIM exists for.
    const bevelPx = Math.max(2, 0.0008 * scale);

    const paintTile = (x: number, y: number, w: number, h: number, checkerIndex?: number) => {
      const mix = rnd();
      const c = base.clone();
      if (alt) {
        if (opts.checker) { if ((checkerIndex ?? 0) % 2 === 1) c.copy(alt); }
        else c.lerp(alt, mix * 0.85);
      }
      const shade = 1 + (rnd() - 0.5) * variation;
      c.multiplyScalar(shade);
      if (height) {
        // Handmade tile is not coplanar; porcelain is. `variation` is the same
        // knob that drives colour spread, so zellige gets a lippage the eye
        // reads as handmade and a rectified 24×48 stays dead flat.
        const lip = (shade - 1) * 90 * Math.min(1, variation * 3);
        facePath(x, y, w, h, 0); ctx.fillStyle = greyHex(H_RIM); ctx.fill();
        facePath(x, y, w, h, bevelPx); ctx.fillStyle = greyHex(H_FACE + lip); ctx.fill();
        return;
      }
      const hex = `#${c.getHexString()}`;
      if (opts.gloss && opts.gloss > 0) {
        const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
        const hi = c.clone().multiplyScalar(1 + 0.16 * opts.gloss);
        g.addColorStop(0, `#${hi.getHexString()}`);
        g.addColorStop(0.55, hex);
        g.addColorStop(1, `#${c.clone().multiplyScalar(1 - 0.06 * opts.gloss).getHexString()}`);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = hex;
      }
      facePath(x, y, w, h, 0);
      ctx.fill();
    };

    if (pattern === 'hex') {
      const R = (opts.tileW * scale) / 2;
      const hStep = R * 1.5, vStep = R * Math.sqrt(3);
      for (let row = -1; row * hStep < px + R * 2; row++) {
        for (let col = -1; col * vStep < px + R * 2; col++) {
          const cx = row * hStep;
          const cy = col * vStep + (row % 2 ? vStep / 2 : 0);
          const c = base.clone();
          if (alt) c.lerp(alt, rnd() * 0.8);
          const shade = 1 + (rnd() - 0.5) * variation;
          c.multiplyScalar(shade);
          const hexPath = (inset: number) => {
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const a = (Math.PI / 3) * i;
              const px2 = cx + (R - gap / 2 - inset) * Math.cos(a);
              const py2 = cy + (R - gap / 2 - inset) * Math.sin(a);
              if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
            }
            ctx.closePath();
          };
          if (height) {
            hexPath(0); ctx.fillStyle = greyHex(H_RIM); ctx.fill();
            hexPath(bevelPx); ctx.fillStyle = greyHex(H_FACE + (shade - 1) * 90 * Math.min(1, variation * 3)); ctx.fill();
          } else {
            ctx.fillStyle = `#${c.getHexString()}`;
            hexPath(0);
            ctx.fill();
          }
        }
      }
    } else if (pattern === 'herringbone') {
      const L = opts.tileW * scale, W = opts.tileH * scale;
      for (let y = -L; y < px + L; y += W * 2) {
        for (let x = -L; x < px + L; x += W * 2) {
          for (const [dx, dy, rot] of [[0, 0, 0], [W, L - W, Math.PI / 2]] as const) {
            ctx.save();
            ctx.translate(x + dx, y + dy);
            ctx.rotate(rot);
            paintTile(gap / 2, gap / 2, L - gap, W - gap);
            ctx.restore();
          }
        }
      }
    } else {
      const rows = Math.ceil(px / (th + gap)) + 1;
      for (let r = 0; r < rows; r++) {
        const y = r * (th + gap);
        const offset = pattern === 'running-bond' ? (r % 2 ? (tw + gap) / 2 : 0) : 0;
        let col = 0;
        for (let x = -tw; x < px + tw; x += tw + gap) {
          paintTile(x + offset, y, tw, th, r + col);
          col++;
        }
      }
    }
  };

  const { canvas, ctx } = makeCanvas(px);
  drawPass(ctx, false);
  const h = makeCanvas(px);
  drawPass(h.ctx, true);
  return { canvas, spanM, height: h.canvas };
}

// ---------------------------------------------------------------------------
// Wood planks (floors, ceilings, decks) — real plank widths and end joints
// ---------------------------------------------------------------------------
export interface PlankOptions {
  /** plank width in metres (0.13–0.23 typical) */
  widthM: number;
  /** plank length in metres */
  lengthM?: number;
  color: string;
  colorAlt?: string;
  grain?: string;
  variation?: number;
  seed?: number;
  px?: number;
  /** how many boards the canvas covers ACROSS (its u span) */
  planks?: number;
  /** how many board LENGTHS the canvas covers ALONG (its v span) */
  rows?: number;
}

/** The dark line at the bottom of the joint between two boards, in metres. */
const PLANK_JOINT_M = 0.0012;
/** The micro-bevel each board is milled with, in metres — this is what makes the joint a V and not a painted line. */
const PLANK_BEVEL_M = 0.0035;

/**
 * A wood floor.
 *
 * The canvas is RECTANGULAR in world terms: `spanM` metres across the boards
 * and `spanVM` along them. It has to be. A square tile forces the repeat to be
 * the same in both axes, and at six 0.19 m boards that is 1.14 m — so every
 * butt joint, every cathedral arch and every board colour landed on the same
 * 1.14 m lattice, four times across a normal kitchen. From the camera that is
 * a grid of 45" squares, not a plank floor. Eight boards by two board-lengths
 * puts the repeat at roughly 1.4 m × 3.7 m and staggers the joints over a
 * whole board length, which is what a real floor does.
 *
 * Joints and bevels are drawn in METRES (via the per-axis scale), not in
 * pixels: the two axes no longer share a scale, so a fixed pixel inset would
 * make the butt joints several times wider than the side joints.
 */
/**
 * The world size of one plank canvas, separated out so the span rule can be
 * asserted (and reasoned about) without a DOM. `plM` is the board length the
 * drawing actually uses, which is what the joints stagger over.
 */
export function plankSpans(opts: Pick<PlankOptions, 'widthM' | 'lengthM' | 'planks' | 'rows'>): { spanM: number; spanVM: number; planks: number; rows: number; widthM: number; lengthM: number } {
  const planks = Math.max(2, Math.round(opts.planks ?? 8));
  const rows = Math.max(1, Math.round(opts.rows ?? 2));
  const widthM = Math.max(0.02, opts.widthM);
  const lengthM = Math.max(0.2, opts.lengthM ?? widthM * 8);
  return { spanM: planks * widthM, spanVM: rows * lengthM, planks, rows, widthM, lengthM };
}

export function plankFloor(opts: PlankOptions): ProceduralResult {
  const px = qpx(opts.px);
  const { spanM, spanVM, planks, widthM, lengthM: plM } = plankSpans(opts);
  const sx = px / spanM, sy = px / spanVM;
  const pw = widthM * sx;
  const pl = plM * sy;
  // half-widths of the joint and of the chamfer, per axis, never below a pixel
  // (a sub-pixel bevel is a grey line, not a ramp) nor above a quarter board
  const jx = Math.min(pw / 8, Math.max(1, (PLANK_JOINT_M / 2) * sx));
  const jy = Math.min(pl / 8, Math.max(1, (PLANK_JOINT_M / 2) * sy));
  const bx = Math.min(pw / 6, Math.max(1, PLANK_BEVEL_M * sx));
  const by = Math.min(pl / 6, Math.max(1, PLANK_BEVEL_M * sy));
  const rnd = mulberry32(opts.seed ?? 3);
  const { canvas, ctx } = makeCanvas(px);
  const base = new THREE.Color(opts.color);
  const alt = opts.colorAlt ? new THREE.Color(opts.colorAlt) : base.clone().multiplyScalar(0.86);
  const grain = new THREE.Color(opts.grain ?? '#000000');
  const variation = opts.variation ?? 0.16;

  // the bottom of the groove: everything else ramps up out of it
  ctx.fillStyle = `#${base.clone().multiplyScalar(0.42).getHexString()}`;
  ctx.fillRect(0, 0, px, px);

  for (let i = 0; i < planks + 1; i++) {
    const x = i * pw;
    let y = -pl * rnd();
    while (y < px) {
      const h = pl * (0.7 + rnd() * 0.6);
      const c = base.clone().lerp(alt, rnd()).multiplyScalar(1 + (rnd() - 0.5) * variation);
      // the chamfer: one step between the groove and the face, so the normal
      // map derived from this luminance sees a ramp down into the joint on
      // both sides instead of a cliff
      ctx.fillStyle = `#${c.clone().multiplyScalar(0.72).getHexString()}`;
      ctx.fillRect(x + jx, y + jy, pw - 2 * jx, h - 2 * jy);
      const fx = x + jx + bx, fy = y + jy + by, fw = pw - 2 * (jx + bx), fh = h - 2 * (jy + by);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(fx, fy, fw, fh);
      ctx.save();
      // clip to the board FACE so arches, pores and sheen never bleed across a joint
      ctx.beginPath();
      ctx.rect(fx, fy, fw, fh);
      ctx.clip();
      // grain: long thin strokes along the plank
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = `#${grain.getHexString()}`;
      const lines = Math.max(3, Math.round(pw / 6));
      for (let g = 0; g < lines; g++) {
        const gx = fx + rnd() * fw;
        ctx.lineWidth = 0.6 + rnd() * 1.6;
        ctx.beginPath();
        ctx.moveTo(gx, fy);
        const mid = fy + fh * (0.3 + rnd() * 0.4);
        ctx.quadraticCurveTo(gx + (rnd() - 0.5) * pw * 0.25, mid, gx + (rnd() - 0.5) * pw * 0.12, fy + fh);
        ctx.stroke();
      }
      // cathedral figure: nested parabolas where the saw crossed a growth ring.
      // Real flatsawn boards have one or two per board — without them a plank
      // floor reads as striped paper.
      const arches = 1 + Math.floor(rnd() * 2);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let a = 0; a < arches; a++) {
        const acx = fx + fw * (0.2 + rnd() * 0.6);
        const acy = fy + fh * (0.15 + rnd() * 0.7);
        const halfW = fw * (0.16 + rnd() * 0.22);
        const tall = fh * (0.16 + rnd() * 0.22);
        const rings = 4 + Math.floor(rnd() * 5);
        for (let r = 0; r < rings; r++) {
          const w = halfW * (1 + r * 0.16);
          const hh = tall * (1 + r * 0.12);
          ctx.globalAlpha = 0.05 + rnd() * 0.09;
          ctx.lineWidth = 0.7 + rnd() * 1.6;
          ctx.beginPath();
          for (let st = 0; st <= 20; st++) {
            const t = -1 + (2 * st) / 20;
            const gx = acx + t * w;
            const gy = acy + hh * t * t - hh * 0.5 + r * fh * 0.012;
            if (st === 0) ctx.moveTo(gx, gy); else ctx.lineTo(gx, gy);
          }
          ctx.stroke();
        }
      }
      // open pores
      const pores = Math.max(2, Math.round((fw * fh) / 2600));
      ctx.strokeStyle = `#${grain.clone().multiplyScalar(0.8).getHexString()}`;
      for (let pI = 0; pI < pores; pI++) {
        ctx.globalAlpha = 0.06 + rnd() * 0.14;
        ctx.lineWidth = 0.5 + rnd() * 0.9;
        const gx = fx + rnd() * fw, gy = fy + rnd() * fh;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + (rnd() - 0.5) * 2, gy + 2 + rnd() * 8);
        ctx.stroke();
      }
      // Per-board sheen. The roughness map is derived from THIS drawing's
      // luminance (roughnessFromCanvas), so gloss variation has to be drawn:
      // a lengthwise ramp, direction and strength random per board, is what an
      // oiled floor looks like from a low camera and is what stops a plank
      // floor reading as one printed sheet.
      const up = rnd() < 0.5;
      const sheen = ctx.createLinearGradient(0, up ? fy : fy + fh, 0, up ? fy + fh : fy);
      const amp = 0.03 + rnd() * 0.05;
      sheen.addColorStop(0, `rgba(255,255,255,${amp.toFixed(3)})`);
      sheen.addColorStop(1, `rgba(0,0,0,${(amp * 0.8).toFixed(3)})`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = sheen;
      ctx.fillRect(fx, fy, fw, fh);
      ctx.restore();
      y += h;
    }
  }
  return { canvas, spanM, spanVM };
}

// ---------------------------------------------------------------------------
// Lap siding / board-and-batten — the exterior workhorses
// ---------------------------------------------------------------------------
export function lapSiding(opts: { exposureM: number; color: string; shadow?: string; rows?: number; px?: number; seed?: number; batten?: boolean; battenSpacingM?: number }): ProceduralResult {
  const px = qpx(opts.px);
  const rows = opts.rows ?? 8;
  const spanM = rows * opts.exposureM;
  const scale = px / spanM;
  const h = opts.exposureM * scale;
  const rnd = mulberry32(opts.seed ?? 5);
  const { canvas, ctx } = makeCanvas(px);
  const base = new THREE.Color(opts.color);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, px, px);

  if (opts.batten) {
    const spacing = (opts.battenSpacingM ?? 0.4) * scale;
    const bw = Math.max(3, 0.038 * scale);
    for (let x = 0; x < px + spacing; x += spacing) {
      // shadow to the right of each batten
      ctx.fillStyle = `#${base.clone().multiplyScalar(0.72).getHexString()}`;
      ctx.fillRect(x + bw, 0, Math.max(2, bw * 0.5), px);
      ctx.fillStyle = `#${base.clone().multiplyScalar(1.06).getHexString()}`;
      ctx.fillRect(x, 0, bw, px);
    }
    return { canvas, spanM: rows * (opts.battenSpacingM ?? 0.4) };
  }

  for (let r = 0; r < rows + 1; r++) {
    const y = r * h;
    const c = base.clone().multiplyScalar(1 + (rnd() - 0.5) * 0.05);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.fillRect(0, y, px, h);
    // drop shadow under each course butt
    const g = ctx.createLinearGradient(0, y, 0, y + Math.max(3, h * 0.14));
    g.addColorStop(0, 'rgba(0,0,0,0.34)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, px, Math.max(3, h * 0.14));
  }
  return { canvas, spanM };
}

// ---------------------------------------------------------------------------
// Normal map derived from a luminance heightfield (so grout lines catch light)
// ---------------------------------------------------------------------------
export function normalFromCanvas(src: HTMLCanvasElement, strength = 2.2): HTMLCanvasElement {
  const px = src.width;
  const sctx = src.getContext('2d');
  const { canvas, ctx } = makeCanvas(px);
  if (!sctx) return canvas;
  const s = sctx.getImageData(0, 0, px, px).data;
  const out = ctx.createImageData(px, px);
  const lum = (i: number) => (s[i] * 0.299 + s[i + 1] * 0.587 + s[i + 2] * 0.114) / 255;
  const at = (x: number, y: number) => lum(((((y % px) + px) % px) * px + (((x % px) + px) % px)) * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * px + x) * 4;
      out.data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127);
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Roughness map: grout/joints are rougher than the tile face. */
export function roughnessFromCanvas(src: HTMLCanvasElement, faceRough: number, jointRough: number): HTMLCanvasElement {
  const px = src.width;
  const sctx = src.getContext('2d');
  const { canvas, ctx } = makeCanvas(px);
  if (!sctx) return canvas;
  const s = sctx.getImageData(0, 0, px, px).data;
  const out = ctx.createImageData(px, px);
  let min = 1, max = 0;
  const l = new Float32Array(px * px);
  for (let i = 0, j = 0; i < s.length; i += 4, j++) {
    const v = (s[i] * 0.299 + s[i + 1] * 0.587 + s[i + 2] * 0.114) / 255;
    l[j] = v; if (v < min) min = v; if (v > max) max = v;
  }
  const range = Math.max(1e-3, max - min);
  for (let j = 0; j < l.length; j++) {
    // darker (grout, joints) → rougher
    const t = (l[j] - min) / range;
    const r = jointRough + (faceRough - jointRough) * t;
    const v = Math.round(THREE.MathUtils.clamp(r, 0, 1) * 255);
    const i = j * 4;
    out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

// ===========================================================================
// QUALITY KNOB
// ===========================================================================
/**
 * Texture resolution for every generator that does not pass `px` explicitly.
 * 1024 keeps first paint fast on a contractor's laptop; 2048 is for the hero
 * "render this view" frame, 512 for phones.
 */
let QUALITY_PX = 1024;
export function setProceduralQuality(px: 512 | 1024 | 2048): void {
  QUALITY_PX = px === 512 || px === 1024 || px === 2048 ? px : 1024;
}
export function proceduralQuality(): number { return QUALITY_PX; }
function qpx(px: number | undefined): number {
  const n = px ?? QUALITY_PX;
  return Number.isFinite(n) ? Math.max(128, Math.min(2048, Math.round(n))) : 1024;
}

/**
 * Run heavy canvas work off the first-paint critical path. Falls back to a
 * macrotask where requestIdleCallback is missing (Safari < 17, jsdom, SSR).
 */
export function onIdle(fn: () => void, timeout = 400): void {
  if (typeof window === 'undefined') { fn(); return; }
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(() => fn(), { timeout });
  else setTimeout(fn, 0);
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const num = (v: unknown, min: number, max: number, fb: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
};

// ===========================================================================
// WOOD — cathedral figure, straight/rift grain, and end grain for butcher block
// ===========================================================================
export type WoodFigure = 'cathedral' | 'straight' | 'rift' | 'end-grain';

export interface WoodOptions {
  /** heartwood colour */
  color: string;
  /** sapwood / lighter streak colour */
  colorAlt?: string;
  /** grain-line colour (near-black for oak, warm brown for walnut) */
  grain?: string;
  figure?: WoodFigure;
  /** metres represented by one canvas edge */
  spanM?: number;
  /** grain lines per metre across the board */
  grainDensity?: number;
  /** 0 = bleached, 1 = strongly figured */
  contrast?: number;
  /** open-pore species (oak, ash) get visible flecks */
  pores?: number;
  /** butcher block: strip width in metres */
  stripM?: number;
  seed?: number;
  px?: number;
}

/**
 * The three things that make wood read as wood: long directional grain lines,
 * cathedral arches where the saw crossed a growth ring, and open pores. A flat
 * brown with a noise bump has none of them and always reads as plastic.
 */
export function woodGrain(opts: WoodOptions): ProceduralResult {
  const px = qpx(opts.px);
  const spanM = num(opts.spanM, 0.05, 8, 1.2);
  const figure = opts.figure ?? 'cathedral';
  const contrast = num(opts.contrast, 0, 1, 0.6);
  const density = num(opts.grainDensity, 4, 400, 46);
  const pores = num(opts.pores, 0, 1, 0.35);
  const rnd = mulberry32(num(opts.seed, 0, 1e9, 21));
  const { canvas, ctx } = makeCanvas(px);
  const base = new THREE.Color(opts.color);
  const alt = opts.colorAlt ? new THREE.Color(opts.colorAlt) : base.clone().multiplyScalar(1.14);
  const grain = new THREE.Color(opts.grain ?? '#3a2416');

  if (figure === 'end-grain') {
    drawEndGrain(ctx, px, spanM, base, alt, grain, contrast, num(opts.stripM, 0.02, 0.3, 0.05), rnd);
    return { canvas, spanM };
  }

  // 1. tonal underlay: slow drift between heartwood and sapwood
  const grids = [
    { g: noiseGrid(3, rnd), size: 3 },
    { g: noiseGrid(6, rnd), size: 6 },
    { g: noiseGrid(12, rnd), size: 12 },
  ];
  const img = ctx.createImageData(px, px);
  const c = new THREE.Color();
  // Convert the endpoints once, not three channels for every one of the
  // 4 million texels in a high-quality map. This is a pigment-colour drawing
  // in an sRGB canvas; the renderer linearizes it exactly once on sampling.
  const canvasBase = base.clone().convertLinearToSRGB();
  const canvasAlt = alt.clone().convertLinearToSRGB();
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const n = fbm(grids, x / px, y / px);
      c.copy(canvasBase).lerp(canvasAlt, clamp01((n - 0.35) * 1.5) * (0.35 + contrast * 0.4));
      const i = (y * px + x) * 4;
      img.data[i] = Math.round(255 * clamp01(c.r));
      img.data[i + 1] = Math.round(255 * clamp01(c.g));
      img.data[i + 2] = Math.round(255 * clamp01(c.b));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 2. grain lines: run along the board (vertical), wandering with periodic noise
  const warp = [{ g: noiseGrid(8, rnd), size: 8 }, { g: noiseGrid(16, rnd), size: 16 }];
  const lines = Math.max(6, Math.round(density * spanM));
  const amp = px * (figure === 'rift' ? 0.008 : 0.022);
  ctx.save();
  ctx.strokeStyle = `#${grain.getHexString()}`;
  ctx.lineCap = 'round';
  for (let i = 0; i < lines; i++) {
    const x0 = (px * i) / lines + rnd() * (px / lines) * 0.6;
    ctx.globalAlpha = (0.05 + rnd() * 0.16) * (0.4 + contrast);
    ctx.lineWidth = 0.5 + rnd() * (figure === 'straight' ? 1.1 : 2.2);
    ctx.beginPath();
    for (let s = 0; s <= 32; s++) {
      const t = s / 32;
      const y = t * px;
      const w = (fbm(warp, (x0 / px + 0.13) % 1, t) - 0.5) * amp;
      const x = x0 + w;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 3. cathedral arches — nested parabolas, drawn three times so they wrap
  if (figure === 'cathedral') {
    const clusters = Math.max(1, Math.round(1.6 * spanM + rnd()));
    ctx.save();
    ctx.strokeStyle = `#${grain.getHexString()}`;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let cN = 0; cN < clusters; cN++) {
      const cx = rnd() * px;
      const cy = rnd() * px;
      const halfW = px * (0.05 + rnd() * 0.07);
      const rings = 5 + Math.floor(rnd() * 6);
      const step = px * (0.010 + rnd() * 0.012);
      const tall = px * (0.22 + rnd() * 0.26);
      for (let r = 0; r < rings; r++) {
        const w = halfW * (1 + r * 0.14);
        const h = tall * (1 + r * 0.10);
        ctx.globalAlpha = (0.10 + rnd() * 0.22) * (0.4 + contrast);
        ctx.lineWidth = 0.8 + rnd() * 2.0;
        for (const off of [-px, 0, px]) {
          ctx.beginPath();
          for (let s = 0; s <= 26; s++) {
            const t = -1 + (2 * s) / 26;
            const x = cx + t * w;
            const y = cy + off + h * (t * t) - h * 0.5 + r * step;
            if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // 4. open pores — short dark flecks aligned with the grain
  if (pores > 0.01) {
    const n = Math.min(30000, Math.round(px * px * 0.00016 * pores));
    ctx.save();
    ctx.strokeStyle = `#${grain.clone().multiplyScalar(0.7).getHexString()}`;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const x = rnd() * px, y = rnd() * px;
      const len = px * (0.002 + rnd() * 0.008);
      ctx.globalAlpha = 0.10 + rnd() * 0.30;
      ctx.lineWidth = 0.5 + rnd() * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 2, y + len);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  return { canvas, spanM };
}

/** End-grain butcher block: square strips of concentric rings + radial checks. */
function drawEndGrain(
  ctx: CanvasRenderingContext2D, px: number, spanM: number,
  base: THREE.Color, alt: THREE.Color, grain: THREE.Color, contrast: number, stripM: number, rnd: () => number,
) {
  const cells = Math.min(14, Math.max(2, Math.round(spanM / stripM)));
  const cw = px / cells;
  ctx.fillStyle = `#${grain.clone().multiplyScalar(0.5).getHexString()}`;
  ctx.fillRect(0, 0, px, px);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const x = i * cw, y = j * cw;
      const c = base.clone().lerp(alt, rnd() * 0.7);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(x + 1, y + 1, cw - 2, cw - 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 1, y + 1, cw - 2, cw - 2);
      ctx.clip();
      // growth rings around a pith somewhere off the strip
      const pxc = x + cw * (rnd() * 2.4 - 0.7);
      const pyc = y + cw * (rnd() * 2.4 - 0.7);
      const ringStep = cw * (0.055 + rnd() * 0.05);
      ctx.strokeStyle = `#${grain.getHexString()}`;
      for (let r = 1; r < 34; r++) {
        ctx.globalAlpha = (0.10 + (r % 2) * 0.14) * (0.4 + contrast);
        ctx.lineWidth = 0.6 + (r % 2) * 1.2;
        ctx.beginPath();
        ctx.arc(pxc, pyc, r * ringStep, 0, TAU);
        ctx.stroke();
      }
      // radial checks
      ctx.globalAlpha = 0.16 * (0.4 + contrast);
      const rays = 2 + Math.floor(rnd() * 3);
      for (let a = 0; a < rays; a++) {
        const ang = rnd() * TAU;
        ctx.lineWidth = 0.6 + rnd();
        ctx.beginPath();
        ctx.moveTo(pxc, pyc);
        ctx.lineTo(pxc + Math.cos(ang) * cw * 2, pyc + Math.sin(ang) * cw * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

// ===========================================================================
// BRUSHED METAL — directional micro-scratches (feed the anisotropy too)
// ===========================================================================
export interface BrushedMetalOptions {
  color: string;
  /** 'x' = brushed horizontally, 'y' = vertically, 'radial' = a spun disc */
  direction?: 'x' | 'y' | 'radial';
  /** metres per canvas edge — brushed nickel reads right around 0.25 m */
  spanM?: number;
  /** 0 = mirror polish, 1 = coarse satin */
  grit?: number;
  seed?: number;
  px?: number;
}

export function brushedMetal(opts: BrushedMetalOptions): ProceduralResult {
  const px = qpx(opts.px);
  const spanM = num(opts.spanM, 0.02, 4, 0.25);
  const dir = opts.direction ?? 'x';
  const grit = num(opts.grit, 0, 1, 0.5);
  const rnd = mulberry32(num(opts.seed, 0, 1e9, 33));
  const { canvas, ctx } = makeCanvas(px);
  const base = new THREE.Color(opts.color);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, px, px);

  // broad tonal bands first (a rolled sheet is never perfectly even)
  const bands = 8 + Math.floor(grit * 10);
  for (let i = 0; i < bands; i++) {
    const t = rnd();
    const c = base.clone().multiplyScalar(1 + (rnd() - 0.5) * 0.06);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.globalAlpha = 0.35;
    if (dir === 'y') ctx.fillRect(t * px, 0, px / bands, px);
    else ctx.fillRect(0, t * px, px, px / bands);
  }

  const strokes = Math.min(6000, Math.round(px * (2.2 + grit * 5)));
  ctx.lineCap = 'butt';
  for (let i = 0; i < strokes; i++) {
    const lighten = rnd() > 0.5;
    const amt = (0.03 + rnd() * 0.10) * (0.4 + grit);
    const c = base.clone().multiplyScalar(lighten ? 1 + amt : 1 - amt);
    ctx.strokeStyle = `#${c.getHexString()}`;
    ctx.globalAlpha = 0.10 + rnd() * 0.22;
    ctx.lineWidth = 0.4 + rnd() * (0.6 + grit * 2);
    ctx.beginPath();
    if (dir === 'radial') {
      const r = rnd() * px * 0.72;
      ctx.arc(px / 2, px / 2, r, rnd() * TAU, rnd() * TAU + 0.4 + rnd());
    } else if (dir === 'y') {
      const x = rnd() * px;
      ctx.moveTo(x, -px * 0.1); ctx.lineTo(x + (rnd() - 0.5) * 3, px * 1.1);
    } else {
      const y = rnd() * px;
      ctx.moveTo(-px * 0.1, y); ctx.lineTo(px * 1.1, y + (rnd() - 0.5) * 3);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return { canvas, spanM };
}

// ===========================================================================
// ENGINEERED QUARTZ — near-solid field, fine speckle, faint sparkle
// ===========================================================================
export interface QuartzOptions {
  base: string;
  /** speckle colours; quartz is a resin field with crushed stone in it */
  speckle?: string;
  speckle2?: string;
  /** 0 = solid white, 1 = heavy movement */
  density?: number;
  /** chip radius in metres (0.0006 fine, 0.004 coarse) */
  chipM?: number;
  /** subtle vein sweep for the "marble-look" quartzes */
  vein?: string;
  veinCount?: number;
  veinIntensity?: number;
  /** flecks of mica that catch the light */
  sparkle?: number;
  spanM?: number;
  seed?: number;
  px?: number;
}

export function quartzWithSpeckle(opts: QuartzOptions): ProceduralResult {
  const px = qpx(opts.px);
  const spanM = num(opts.spanM, 0.2, 6, 2.4);
  const density = num(opts.density, 0, 1, 0.5);
  const chipM = num(opts.chipM, 0.0002, 0.02, 0.0011);
  const sparkle = num(opts.sparkle, 0, 1, 0.25);
  const seed = num(opts.seed, 0, 1e9, 91);
  const veinIntensity = num(opts.veinIntensity, 0, 1, opts.vein ? 0.35 : 0);
  const res = veinedSlab({
    base: opts.base,
    vein: opts.vein ?? opts.base,
    veinCount: Math.round(num(opts.veinCount, 0, 20, 3)),
    intensity: veinIntensity,
    spanM, seed, px,
  });
  const ctx = res.canvas.getContext('2d');
  if (!ctx) return res;
  const rnd = mulberry32(seed + 7);
  const pxPerM = px / spanM;
  const rPx = Math.max(0.6, chipM * pxPerM);
  const n = Math.min(45000, Math.round((px * px * 0.30 * density) / (Math.PI * rPx * rPx)));
  const cols = [opts.speckle ?? '#c8c4bc', opts.speckle2 ?? opts.speckle ?? '#8f8b84'];
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cols[rnd() < 0.65 ? 0 : 1];
    ctx.globalAlpha = 0.18 + rnd() * 0.42;
    const r = rPx * (0.5 + rnd() * 1.0);
    ctx.beginPath();
    ctx.ellipse(rnd() * px, rnd() * px, r, r * (0.6 + rnd() * 0.8), rnd() * TAU, 0, TAU);
    ctx.fill();
  }
  if (sparkle > 0.01) {
    const s = Math.round(px * px * 0.00007 * sparkle);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < s; i++) {
      ctx.globalAlpha = 0.25 + rnd() * 0.6;
      ctx.fillRect(rnd() * px, rnd() * px, 1 + rnd(), 1 + rnd());
    }
  }
  ctx.globalAlpha = 1;
  return res;
}

// ===========================================================================
// GROUTED LARGE-FORMAT SLAB TILE — a real recessed grout channel
// ===========================================================================
export interface GroutedSlabOptions {
  /** face size in metres (24×48 porcelain = 0.61 × 1.22) */
  tileW: number;
  tileH: number;
  base: string;
  vein?: string;
  vein2?: string;
  veinIntensity?: number;
  grout: string;
  /** joint width in metres — large format runs 1.5–3 mm */
  groutM?: number;
  /** rectified tiles are dead-square; pressed tiles get a soft eased edge */
  eased?: number;
  /** slabs are book-matched or randomly rotated; 0 = all identical */
  variation?: number;
  spanM?: number;
  seed?: number;
  px?: number;
}

/** Whole modules on each repeat axis; never stretch a tile to make a square. */
export function groutedSlabSpans(opts: Pick<GroutedSlabOptions, 'tileW' | 'tileH' | 'groutM' | 'spanM'>) {
  const tileW = num(opts.tileW, 0.05, 3.2, 0.61);
  const tileH = num(opts.tileH, 0.05, 3.2, 1.22);
  const groutM = num(opts.groutM, 0.0005, 0.02, 0.002);
  const cols = Math.min(10, Math.max(1, Math.round(num(opts.spanM, tileW, 12, tileW * 2) / (tileW + groutM))));
  const spanM = cols * (tileW + groutM);
  const rows = Math.min(14, Math.max(1, Math.round(spanM / (tileH + groutM))));
  return { tileW, tileH, groutM, cols, rows, spanM, spanVM: rows * (tileH + groutM) };
}

/**
 * Large-format tile is NOT the same generator as subway tile: the module is so
 * big that each face needs its own stone movement, and the grout is a narrow
 * recessed CHANNEL rather than a wide band. Getting the channel right is what
 * makes a 24×48 porcelain floor read as tile instead of as a printed sheet.
 */
export function groutedSlab(opts: GroutedSlabOptions): ProceduralResult {
  const px = qpx(opts.px);
  const { tileW, tileH, groutM, cols, rows, spanM, spanVM } = groutedSlabSpans(opts);
  const eased = num(opts.eased, 0, 1, 0.35);
  const variation = num(opts.variation, 0, 1, 0.5);
  const seed = num(opts.seed, 0, 1e9, 55);
  // Each tile costs four drawImage calls, so cap the module count: a caller
  // asking for a 12 m span of 2" mosaic would otherwise queue 200k blits.
  const scaleX = px / spanM, scaleY = px / spanVM;
  const tw = tileW * scaleX, th = tileH * scaleY;
  const gapX = groutM * scaleX, gapY = groutM * scaleY;
  const rnd = mulberry32(seed);
  const { canvas, ctx } = makeCanvas(px);

  ctx.fillStyle = opts.grout;
  ctx.fillRect(0, 0, px, px);

  // one shared stone field, sampled at a different offset per tile so faces
  // differ without paying for N slab generations
  const field = veinedSlab({
    base: opts.base,
    vein: opts.vein ?? opts.base,
    vein2: opts.vein2,
    veinCount: 6,
    intensity: num(opts.veinIntensity, 0, 1, opts.vein ? 0.55 : 0.06),
    spanM, seed: seed + 3, px,
  }).canvas;

  const easePx = Math.max(0, eased * Math.min(tw, th) * 0.012);
  for (let r = 0; r < rows; r++) {
    for (let c2 = 0; c2 < cols; c2++) {
      const x = c2 * (tw + gapX);
      const y = r * (th + gapY);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, tw, th);
      ctx.clip();
      const ox = variation > 0 ? Math.floor(rnd() * px) : 0;
      const oy = variation > 0 ? Math.floor(rnd() * px) : 0;
      // The sampled source starts left/above the tile at -offset, so its
      // neighbours must repeat right/down to fill the clipped tile face.
      for (const dx of [0, px]) {
        for (const dy of [0, px]) {
          ctx.drawImage(field, x - ox + dx, y - oy + dy);
        }
      }
      // eased edge: a faint highlight top/left, shadow bottom/right
      if (easePx > 0.3) {
        const g1 = ctx.createLinearGradient(x, y, x, y + easePx * 3);
        g1.addColorStop(0, 'rgba(255,255,255,0.16)');
        g1.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g1; ctx.fillRect(x, y, tw, easePx * 3);
        const g2 = ctx.createLinearGradient(x, y + th - easePx * 3, x, y + th);
        g2.addColorStop(0, 'rgba(0,0,0,0)');
        g2.addColorStop(1, 'rgba(0,0,0,0.20)');
        ctx.fillStyle = g2; ctx.fillRect(x, y + th - easePx * 3, tw, easePx * 3);
      }
      ctx.restore();
    }
  }

  // the grout CHANNEL: darkened at the joint centre so the joint reads as a
  // shadow line in the COLOUR too, the way a photograph of it does
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#000000';
  for (let c2 = 1; c2 <= cols; c2++) {
    const x = c2 * (tw + gapX) - gapX;
    ctx.fillRect(x, 0, gapX, px);
  }
  for (let r = 1; r <= rows; r++) {
    const y = r * (th + gapY) - gapY;
    ctx.fillRect(0, y, px, gapY);
  }
  ctx.restore();

  // The heightfield. Large-format porcelain is FLAT — its stone movement is
  // printed, not carved — so deriving relief from the colour drawing embossed
  // every vein and made a polished slab floor look like sandstone. The only
  // real geometry here is the joint, so that is the only thing this draws.
  const H = makeCanvas(px);
  H.ctx.fillStyle = greyHex(H_GROUT);
  H.ctx.fillRect(0, 0, px, px);
  const rimPx = Math.max(2, easePx);
  for (let r = 0; r < rows; r++) {
    for (let c2 = 0; c2 < cols; c2++) {
      const x = c2 * (tw + gapX), y = r * (th + gapY);
      H.ctx.fillStyle = greyHex(H_RIM);
      H.ctx.fillRect(x, y, tw, th);
      H.ctx.fillStyle = greyHex(H_FACE);
      H.ctx.fillRect(x + rimPx, y + rimPx, Math.max(1, tw - rimPx * 2), Math.max(1, th - rimPx * 2));
    }
  }
  return { canvas, spanM, spanVM, height: H.canvas };
}

// ===========================================================================
// FABRIC WEAVE — upholstery, roman shades, towels, rugs
// ===========================================================================
export interface FabricOptions {
  color: string;
  colorAlt?: string;
  /** thread pitch in metres (1.5 mm plain weave, 6 mm basketweave) */
  threadM?: number;
  weave?: 'plain' | 'basket' | 'twill' | 'terry';
  slub?: number;
  spanM?: number;
  seed?: number;
  px?: number;
}

export function fabricWeave(opts: FabricOptions): ProceduralResult {
  const px = qpx(opts.px);
  const threadM = num(opts.threadM, 0.0004, 0.03, 0.0018);
  const weave = opts.weave ?? 'plain';
  const slub = num(opts.slub, 0, 1, 0.35);
  const rnd = mulberry32(num(opts.seed, 0, 1e9, 71));
  const group = weave === 'basket' ? 2 : 1;
  const threads = Math.max(8, Math.min(256, Math.round(px / 6)));
  const spanM = threads * threadM;
  const { canvas, ctx } = makeCanvas(px);
  const base = new THREE.Color(opts.color);
  const alt = opts.colorAlt ? new THREE.Color(opts.colorAlt) : base.clone().multiplyScalar(0.88);
  ctx.fillStyle = `#${base.clone().multiplyScalar(0.55).getHexString()}`;
  ctx.fillRect(0, 0, px, px);
  const t = px / threads;
  const over = (i: number, j: number) => {
    if (weave === 'twill') return ((i + j) % 3) === 0;
    if (weave === 'basket') return (Math.floor(i / group) + Math.floor(j / group)) % 2 === 0;
    return (i + j) % 2 === 0;
  };
  for (let j = 0; j < threads; j++) {
    for (let i = 0; i < threads; i++) {
      const up = over(i, j);
      const c = (up ? base : alt).clone().multiplyScalar(1 + (rnd() - 0.5) * 0.12 * (0.4 + slub));
      ctx.fillStyle = `#${c.getHexString()}`;
      const pad = t * 0.08;
      if (up) ctx.fillRect(i * t + pad, j * t - pad * 0.5, t - pad * 2, t + pad);
      else ctx.fillRect(i * t - pad * 0.5, j * t + pad, t + pad, t - pad * 2);
      if (weave === 'terry' && rnd() > 0.72) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = `#${base.clone().multiplyScalar(1.18).getHexString()}`;
        ctx.beginPath();
        ctx.arc(i * t + t / 2, j * t + t / 2, t * 0.42, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  return { canvas, spanM };
}

// ===========================================================================
// PAINTED WALL — roller stipple, lap marks, the faintest orange peel
// ===========================================================================
export interface PaintedWallOptions {
  color: string;
  /** 'flat' | 'eggshell' | 'satin' | 'semi-gloss' — drives stipple contrast */
  sheen?: 'flat' | 'eggshell' | 'satin' | 'semi-gloss';
  /** 0 = sprayed dead flat, 1 = heavy roller nap */
  stipple?: number;
  /** faint vertical roller laps */
  laps?: number;
  spanM?: number;
  seed?: number;
  px?: number;
}

/**
 * A painted wall is the surface a viewer stares at longest, and a perfectly
 * even colour is the loudest "this is CG" cue in the frame. Roller nap leaves
 * a fine stipple and a lap every ~450 mm; both are barely visible and both are
 * why a photographed wall never looks like a fill.
 */
export function paintedWall(opts: PaintedWallOptions): ProceduralResult {
  const px = qpx(opts.px);
  const spanM = num(opts.spanM, 0.2, 8, 1.6);
  const sheen = opts.sheen ?? 'eggshell';
  const stipple = num(opts.stipple, 0, 1, sheen === 'flat' ? 0.75 : sheen === 'semi-gloss' ? 0.3 : 0.5);
  const laps = num(opts.laps, 0, 1, 0.4);
  const rnd = mulberry32(num(opts.seed, 0, 1e9, 17));
  const { canvas, ctx } = makeCanvas(px);
  const base = new THREE.Color(opts.color);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, px, px);

  // roller laps: very slightly different sheen every roller width
  if (laps > 0.01) {
    const lapPx = (0.45 / spanM) * px;
    for (let x = 0; x < px + lapPx; x += lapPx) {
      const c = base.clone().multiplyScalar(1 + (rnd() - 0.5) * 0.020 * laps);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(x, 0, lapPx, px);
      ctx.globalAlpha = 0.10 * laps;
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, 0, Math.max(1, lapPx * 0.012), px);
      ctx.globalAlpha = 1;
    }
  }

  // nap stipple: fine periodic noise so it tiles
  if (stipple > 0.01) {
    const grids = [
      { g: noiseGrid(64, rnd), size: 64 },
      { g: noiseGrid(128, rnd), size: 128 },
    ];
    const img = ctx.getImageData(0, 0, px, px);
    const amp = 10 * stipple;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const n = (fbm(grids, x / px, y / px) - 0.5) * amp;
        const i = (y * px + x) * 4;
        img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
        img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
        img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  return { canvas, spanM };
}

// ===========================================================================
// DETAIL NORMAL — the high-frequency second normal layer
// ===========================================================================
export type MicroSurface = 'paint' | 'stone' | 'wood' | 'metal' | 'ceramic' | 'fabric' | 'plaster';

/**
 * A tangent-space normal map of pure micro-structure, meant to be tiled ~20×
 * smaller than the base map and added on top of it (see materials.ts). Without
 * it every surface goes glassy the moment the camera gets close, because the
 * base map's smallest feature is already several centimetres across.
 */
export function microNormal(kind: MicroSurface, px = 256, seed = 5): HTMLCanvasElement {
  const P = Math.max(64, Math.min(512, Math.round(px)));
  const rnd = mulberry32(seed + kind.length * 13);
  const { canvas, ctx } = makeCanvas(P);
  const mid = new THREE.Color('#808080');
  ctx.fillStyle = `#${mid.getHexString()}`;
  ctx.fillRect(0, 0, P, P);

  // draw a HEIGHT field first, then convert — same path the surface maps use
  const grids = kind === 'metal'
    ? [{ g: noiseGrid(P / 2, rnd), size: P / 2 }]
    : [
      { g: noiseGrid(16, rnd), size: 16 },
      { g: noiseGrid(48, rnd), size: 48 },
      { g: noiseGrid(P / 2, rnd), size: Math.max(8, Math.round(P / 2)) },
    ];
  const img = ctx.createImageData(P, P);
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      let v = fbm(grids, x / P, y / P);
      if (kind === 'metal') v = 0.5 + (v - 0.5) * 0.35 + Math.sin((y / P) * Math.PI * 2 * 64 + v * 6) * 0.06;
      else if (kind === 'ceramic') v = 0.5 + (v - 0.5) * 0.22;
      else if (kind === 'fabric') v = 0.5 + Math.sin((x / P) * Math.PI * 2 * 48) * 0.12 + Math.sin((y / P) * Math.PI * 2 * 48) * 0.12 + (v - 0.5) * 0.3;
      else if (kind === 'wood') v = 0.5 + (v - 0.5) * 0.5 + Math.sin((x / P) * Math.PI * 2 * 24 + v * 8) * 0.07;
      else if (kind === 'stone') v = 0.5 + (v - 0.5) * 0.85;
      else if (kind === 'plaster') v = 0.5 + (v - 0.5) * 0.95;
      const g = Math.round(255 * clamp01(v));
      const i = (y * P + x) * 4;
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return normalFromCanvas(canvas, kind === 'metal' ? 1.4 : kind === 'ceramic' ? 0.9 : 2.0);
}

/**
 * Edge-wear / crevice map: the darker a pixel is in the source drawing, the
 * more occluded it is (grout channels, plank joints, panel reveals). Feeding
 * this to `aoMap` costs nothing and is what stops joints from glowing.
 */
export function cavityFromCanvas(src: HTMLCanvasElement, strength = 0.75): HTMLCanvasElement {
  const px = src.width;
  const sctx = src.getContext('2d');
  const { canvas, ctx } = makeCanvas(px);
  if (!sctx) return canvas;
  const s = sctx.getImageData(0, 0, px, px).data;
  const out = ctx.createImageData(px, px);
  const l = new Float32Array(px * px);
  let min = 1, max = 0;
  for (let i = 0, j = 0; i < s.length; i += 4, j++) {
    const v = (s[i] * 0.299 + s[i + 1] * 0.587 + s[i + 2] * 0.114) / 255;
    l[j] = v; if (v < min) min = v; if (v > max) max = v;
  }
  const range = Math.max(1e-3, max - min);
  const k = clamp01(strength);
  for (let j = 0; j < l.length; j++) {
    const t = (l[j] - min) / range;
    // only the darkest quarter occludes; everything else stays open
    const ao = 1 - k * Math.pow(1 - Math.min(1, t * 1.35), 2.2);
    const v = Math.round(clamp01(ao) * 255);
    const i = j * 4;
    out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
