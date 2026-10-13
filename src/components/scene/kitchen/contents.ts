/**
 * Everything that stands INSIDE a glass-front or open wall cabinet.
 *
 * These are props, not cabinetry: `millwork.ts` builds the box, the shelves,
 * the pins and the glass; this file only fills them. Keeping the two apart is
 * what lets a cabinet's PRICE stay a function of the cabinet while its
 * CONTENTS stay a function of the photo — nothing here carries a material slot,
 * so a stack of plates can never move an estimate line.
 *
 * Before this, a glass-front upper was drawn as a lit empty box, which is the
 * single loudest "3D model" tell in a kitchen render: real glass doors always
 * have something behind them.
 *
 * WHAT DECIDES WHAT
 *  `decor.cabinetContents` (one entry per glass / open cabinet, from the photo)
 *  is resolved by the layout onto the wall cabinet it names; the layout writes
 *  the answer to `KUpper.contents` / `KUpper.density`. An eligible cabinet the
 *  analyzer said nothing about gets 'mixed' / 'sparse' — in a lived-in photo an
 *  EMPTY glass cabinet is the rarer case, so that is the safer default.
 *
 * THE INTERIOR ARITHMETIC BELOW MIRRORS `millwork.upperCabinetParts`. It has to:
 * a plate that floats 8 mm above the shelf that millwork drew is worse than no
 * plate at all. Those constants are private to millwork (H's file), so they are
 * restated here with this comment rather than exported — if that file's shelf
 * spacing changes, this one changes with it.
 */
import { chamferBox } from '@/components/scene/detail';
import { inch } from '@/lib/units';
import { compact, prop, type Part, type UtilKind } from './parts';
import { bookStack, bottle, fruitBowl, jar, mug, plateStack, tumbler } from './helpers';
import { constructionFor, type Construction } from './millwork';
import { contentsFor, type KitchenLayoutData, type KRun, type KUpper } from './layout';

// --- restated from millwork.ts (see the header) ------------------------------
/** 3/4" door / drawer front thickness */
const DOOR_T = 0.019;
/** 3/4" face frame stock */
const FF_T = inch(0.75);
/** 1/2" cabinet back */
const BACK_T = inch(0.5);
/** 3/4" shelf */
const SHELF_T = inch(0.75);
/** the box behind the doors */
function boxDepth(depth: number, ctn: Construction): number {
  return Math.max(0.05, depth - DOOR_T - (ctn === 'face-frame' ? FF_T : 0));
}

/** one horizontal surface inside a cabinet that something can stand on */
interface Level {
  /** the surface the things sit on */
  y: number;
  /** clear height above it */
  headroom: number;
  /** usable left→right span, wall-local */
  x0: number;
  x1: number;
  /** usable front→back span */
  zBack: number;
  zFront: number;
}

/** Quantise a height so cabinets on one wall share one cached geometry — which
 *  is what lets `autoInstance` fold a whole wall of glasses into one draw call. */
function step(v: number, cap: number): number {
  return Math.max(0.04, Math.floor(Math.min(cap, v) / 0.02) * 0.02);
}

function levelsFor(L: KitchenLayoutData, run: KRun, cab: KUpper, ctn: Construction): Level[] {
  const y0 = cab.bottom;
  const H = Math.max(0.1, run.upperTop - y0);
  const innerW = Math.max(0.08, cab.width - inch(1.5));
  const x0 = cab.cx - innerW / 2 + 0.02;
  const x1 = cab.cx + innerW / 2 - 0.02;

  if (cab.type === 'open-shelf') {
    // millwork draws n+1 boards; the top one is the cabinet's own top, so only
    // the lower n are surfaces anything stands on
    const n = Math.max(2, Math.min(4, Math.round(H / inch(14))));
    const pitch = H / n;
    const out: Level[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        y: y0 + pitch * i + SHELF_T, headroom: Math.max(0.05, pitch - SHELF_T),
        x0, x1, zBack: 0.01, zFront: run.upperDepth - 0.02,
      });
    }
    return out;
  }

  const bd = boxDepth(run.upperDepth, ctn);
  const shelfN = H > inch(30) ? 3 : H > inch(20) ? 2 : 1;
  const ys = [y0 + SHELF_T];
  for (let i = 0; i < shelfN; i++) ys.push(y0 + (H * (i + 1)) / (shelfN + 1) + SHELF_T / 2);
  return ys.map((y, i) => ({
    y,
    headroom: Math.max(0.05, (i + 1 < ys.length ? ys[i + 1] - SHELF_T / 2 : y0 + H) - y),
    x0, x1,
    zBack: BACK_T + 0.02,
    // the door slab lives at bd + DOOR_T/2 — stop well short of it so nothing
    // pokes through the glass
    zFront: Math.max(BACK_T + 0.05, bd - 0.03),
  }));
}

/** Evenly spaced x positions for `n` things across a level. */
function spread(lv: Level, n: number): number[] {
  if (n <= 0) return [];
  const span = lv.x1 - lv.x0;
  return Array.from({ length: n }, (_, i) => lv.x0 + (span * (i + 0.5)) / n);
}

/** How many things of a given pitch fit, at this density. */
function howMany(lv: Level, pitch: number, density: 'sparse' | 'full'): number {
  const slots = Math.floor(Math.max(0, lv.x1 - lv.x0) / pitch);
  return Math.max(1, Math.round(slots * (density === 'full' ? 0.9 : 0.5)));
}

type Cast = 'plates' | 'bowls' | 'glasses' | 'mugs' | 'jars' | 'cookbooks' | 'bottles';

/**
 * One level's worth of crockery. Each piece is its OWN part on a shared cached
 * geometry rather than a pre-instanced group, so `autoInstance` can fold every
 * glass on a whole wall — across cabinets and across shelves — into a single
 * InstancedMesh. Pre-instancing per level would cost one draw call per shelf.
 */
function castLevel(key: string, frame: Part['frame'], lv: Level, cast: Cast, density: 'sparse' | 'full', out: Part[]) {
  const depth = lv.zFront - lv.zBack;
  const zMid = lv.zBack + depth / 2;
  const p = (n: string, util: UtilKind, geometry: Part['geometry'], x: number, z: number, dy = 0, rotation?: [number, number, number]) => {
    out.push(prop(`${key}-${n}`, frame, util, geometry, {
      position: [x, lv.y + dy, z], rotation, castShadow: false, receiveShadow: false,
    }));
  };

  switch (cast) {
    case 'plates': {
      const g = plateStack(Math.min(0.115, depth / 2 - 0.02), density === 'full' ? 8 : 4);
      spread(lv, howMany(lv, 0.26, density)).forEach((x, i) => p(`pl${i}`, 'porcelain', g, x, zMid));
      return;
    }
    case 'bowls': {
      const g = fruitBowl(Math.min(0.08, depth / 2 - 0.02));
      spread(lv, howMany(lv, 0.26, density)).forEach((x, i) => {
        p(`bo${i}`, 'porcelain', g, x, zMid);
        p(`bo${i}b`, 'porcelain', g, x, zMid, 0.045);
      });
      return;
    }
    case 'glasses': {
      const g = tumbler(0.038, step(lv.headroom - 0.02, 0.12));
      // a deep cabinet holds two rows; a shallow one holds one
      const rows = depth >= 0.25 ? [zMid - 0.055, zMid + 0.055] : [zMid];
      const xs = spread(lv, howMany(lv, 0.11, density));
      rows.forEach((z, r) => xs.forEach((x, i) => p(`gl${r}${i}`, 'glass', g, x, z)));
      return;
    }
    case 'mugs': {
      const g = mug();
      spread(lv, howMany(lv, 0.11, density)).forEach((x, i) => p(`mu${i}`, 'ceramic-matte', g, x, zMid, 0, [0, i % 2 ? 0.6 : -0.6, 0]));
      return;
    }
    case 'jars': {
      const { body, lid } = jar(0.04, step(lv.headroom - 0.02, 0.14), 'metal');
      spread(lv, howMany(lv, 0.11, density)).forEach((x, i) => {
        p(`ja${i}`, 'glass', body, x, zMid);
        p(`ja${i}l`, 'brushed-nickel', lid, x, zMid);
      });
      return;
    }
    case 'cookbooks': {
      const stack = bookStack();
      const upright = chamferBox(0.035, step(lv.headroom - 0.02, 0.24), 0.17, 0.002);
      const xs = spread(lv, howMany(lv, 0.26, density));
      xs.forEach((x, i) => {
        p(`cb${i}`, 'dark-wood', stack, x - 0.05, zMid);
        // spines leaning against the stack, the way books actually stand
        p(`cb${i}u`, 'leather-tan', upright, x + 0.06, zMid, 0, [0, 0, 0.12]);
        p(`cb${i}v`, 'leather-tan', upright, x + 0.10, zMid, 0, [0, 0, 0.12]);
      });
      return;
    }
    case 'bottles': {
      const g = bottle(0.032, step(lv.headroom - 0.02, 0.25));
      spread(lv, howMany(lv, 0.11, density)).forEach((x, i) => p(`bt${i}`, 'glass', g, x, zMid));
      return;
    }
  }
}

/** 'mixed' rotates through three casts so a three-shelf cabinet does not repeat. */
const MIXED: Cast[] = ['plates', 'glasses', 'bowls'];

/** Everything behind the glass, for every wall cabinet in the room. */
export function contentsParts(L: KitchenLayoutData): Part[] {
  const ctn = constructionFor(L.style, L.doorStyle);
  const out: Part[] = [];
  for (const run of L.runs) {
    for (const cab of run.uppers) {
      const kind = cab.contents;
      // contentsFor is the layout's own eligibility test — the same one that
      // decided whether to write `contents` at all
      if (!kind || kind === 'empty' || !contentsFor(cab, L.doorStyle)) continue;
      const density = cab.density ?? 'sparse';
      levelsFor(L, run, cab, ctn).forEach((lv, i) => {
        if (lv.headroom < 0.06 || lv.x1 - lv.x0 < 0.06) return;
        const cast = kind === 'mixed' ? MIXED[i % MIXED.length] : kind;
        if (kind === 'mixed' && cast === 'bowls') {
          // the bowls shelf shares with mugs — the shelf a real kitchen crowds
          // most. Split the lane so the two casts cannot land on each other.
          const split = lv.x0 + (lv.x1 - lv.x0) * 0.55;
          castLevel(`${cab.id}-c${i}`, run.wall, { ...lv, x1: split - 0.02 }, 'bowls', density, out);
          castLevel(`${cab.id}-c${i}m`, run.wall, { ...lv, x0: split }, 'mugs', density, out);
          return;
        }
        castLevel(`${cab.id}-c${i}`, run.wall, lv, cast, density, out);
      });
    }
  }
  return compact(out);
}
