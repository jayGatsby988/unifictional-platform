/**
 * Countertops and backsplash.
 *
 * What a real counter has that a slab does not:
 *  - an EDGE PROFILE. Eased, bullnose, bevel, ogee and mitred read completely
 *    differently in a photograph, and the spec already carries which one was
 *    bought. It is swept with `profileMoulding` along the front edge and
 *    RETURNED around any open end, so the profile never dies into thin air.
 *  - a SEAM. Quartz and granite come in ~120" slabs; a longer run has a joint,
 *    and the hairline of colour-matched epoxy catches light.
 *  - a CAULK BEAD where the deck meets the wall or the splash, and the shadow
 *    line under the front edge that comes from the overhang.
 *  - a real SINK REVEAL: the cut-out is in the slab itself, so the polished
 *    edge of the stone is visible above the bowl rim.
 * The backsplash gets its tile field stopped at the right height and finished
 * with a bullnose cap (traditional) or a metal schluter edge (modern).
 *
 * BACKSPLASH SEMANTICS (the solver emits `run.splash`, this file only draws it)
 *  - `spec.backsplash.present` is the room-wide switch; `run.backsplash` is
 *    PER RUN. A photo very often shows tile behind the range wall only and
 *    painted wall behind a side run, so a run with `backsplash: false` gets no
 *    tile, no cap, no bead — and its counter outlets go on the paint instead
 *    (shell.ts).
 *  - 'standard' stops 18" above the deck (or at the wall cabinets if lower);
 *    'ledge' is a 6" upstand.
 *  - 'full-height' runs to the UNDERSIDE OF THE WALL CABINETS where there are
 *    any. Where a run has NO wall cabinets it runs to the CEILING (stopping
 *    under the room crown when the style has one). Behind a hood with nothing
 *    above it the field runs to the ceiling; under a CABINET that sits on the
 *    hood it stops at that cabinet's underside — tile behind a closed box is
 *    tile nobody buys.
 *  - `backsplash.heightIn`, when the photo measured one, overrides the three
 *    category words everywhere the field is drawn, INCLUDING behind the hood.
 *  - a window inside the field splits it: tile continues under the sill and,
 *    when the field reaches the ceiling, resumes above the head (`bottom` on
 *    the piece); no tile ever crosses glass.
 *  - a floating shelf on a tiled wall sits PROUD of the tile: the tile keeps
 *    going behind the boards and the shelf's standoff grows by the tile
 *    thickness (`SPLASH_T`, exported from layout.ts for that reason).
 */
import { PROFILES, profileMoulding, chamferBox, type ProfileName, type Vec3 } from '@/components/scene/detail';
import { slabWithCutouts, type Cutout } from '@/components/scene/bathroom/helpers';
import { inch } from '@/lib/units';
import { compact, prop, surface, type Part } from './parts';
import { bullnoseCap, caulkBead, schluterEdge } from './helpers';
import { SPLASH_T, type KitchenLayoutData, type KRun } from './layout';
/** longest stone slab a fabricator will run without a seam */
const MAX_SLAB = 3.0;

const EDGE_PROFILE: Record<KitchenLayoutData['edge'], ProfileName> = {
  eased: 'counter-eased',
  bullnose: 'counter-bullnose',
  bevel: 'counter-bevel',
  ogee: 'counter-ogee',
  mitered: 'counter-mitered',
};

/** Nominal height each counter profile is drawn at, so scale = real / nominal. */
const EDGE_NOMINAL: Record<KitchenLayoutData['edge'], number> = {
  eased: 0.030, bullnose: 0.030, bevel: 0.030, ogee: 0.030, mitered: 0.050,
};

export interface EdgeSpec { profile: ProfileName; scale: number; out: number }

/** How the spec's edge treatment maps onto a slab of this thickness. */
export function edgeSpec(L: KitchenLayoutData): EdgeSpec {
  const profile = EDGE_PROFILE[L.edge] ?? 'counter-eased';
  // a mitred edge deliberately reads THICKER than the slab it is applied to
  const target = L.edge === 'mitered' ? L.counterT + inch(1.25) : L.counterT;
  const scale = Math.min(3, Math.max(0.3, target / EDGE_NOMINAL[L.edge]));
  let out = 0;
  for (const p of PROFILES[profile]) out = Math.max(out, p[0]);
  return { profile, scale, out: out * scale };
}

/** The swept front edge (and, where asked, the returns around the open ends). */
function edgeParts(
  key: string, frame: Part['frame'], e: EdgeSpec, x0: number, x1: number, y: number, frontZ: number,
  backZ: number, capLo: boolean, capHi: boolean,
): Part[] {
  const out: Part[] = [];
  const run = (path: Vec3[], suffix: string) => {
    out.push(surface(`${key}-edge${suffix}`, frame, 'countertop',
      profileMoulding(path, e.profile, { scale: e.scale, up: [0, 1, 0] }),
      { inert: true, castShadow: false }));
  };
  // front edge: profile +X maps to +Z when the path runs along +X
  run([[x0, y, frontZ], [x1, y, frontZ]], 'F');
  // ends: sweeping along +Z sends the profile out to -X, so the low end runs
  // forwards and the high end runs backwards
  if (capLo) run([[x0 + e.out, y, backZ], [x0 + e.out, y, frontZ]], 'L');
  if (capHi) run([[x1 - e.out, y, frontZ], [x1 - e.out, y, backZ]], 'H');
  return out;
}

function counterSlabParts(L: KitchenLayoutData, run: KRun, x0: number, x1: number, index: number): Part[] {
  const e = edgeSpec(L);
  const width = x1 - x0;
  const cx = (x0 + x1) / 2;
  const D = run.counterDepth;
  const slabD = Math.max(0.05, D - e.out);
  const key = `${run.id}-ct${index}`;
  const y = L.carcassTop + L.counterT / 2;

  // cut-outs, expressed relative to the (shortened) slab's centre
  const cutouts: Cutout[] = [];
  const s = L.sink;
  if (s && s.where === 'wall' && s.runId === run.id && s.x > x0 && s.x < x1) {
    const inset = s.kind === 'drop-in' ? inch(3) : inch(1.5);
    const cw = Math.min(s.width - inset, width - inch(3));
    const cd = Math.min(s.depth - inset, slabD - inch(4));
    if (cw > 0.1 && cd > 0.1) cutouts.push({ x: s.x - cx, z: s.z - slabD / 2, w: cw, d: cd, r: inch(1.5) });
  }
  for (const a of L.appliances) {
    if (a.kind !== 'cooktop' || a.wall !== run.wall) continue;
    if (a.x <= x0 || a.x >= x1) continue;
    const cw = Math.min(a.width - inch(2), width - inch(3));
    const cd = Math.min(a.depth - inch(1), slabD - inch(4));
    if (cw > 0.1 && cd > 0.1) cutouts.push({ x: a.x - cx, z: run.baseDepth / 2 - slabD / 2, w: cw, d: cd, r: inch(0.5) });
  }

  const slab = cutouts.length
    ? slabWithCutouts(width, L.counterT, slabD, cutouts, 0.0012)
    : chamferBox(width, L.counterT, slabD, 0.0012);

  const capLo = x0 > run.x0 - 0.001 && run.x0 > -run.wallLen / 2 + 0.02 && index === 0;
  const capHi = x1 < run.x1 + 0.001 && run.x1 < run.wallLen / 2 - 0.02;

  const out: Part[] = [
    surface(key, run.wall, 'countertop', slab, { position: [cx, y, slabD / 2] }),
    ...edgeParts(key, run.wall, e, x0, x1, L.counterTopY, slabD, 0.0, capLo, capHi),
  ];

  // hairline seam every full slab length
  const seams = Math.max(0, Math.ceil(width / MAX_SLAB) - 1);
  for (let i = 1; i <= seams; i++) {
    const sx = x0 + (width * i) / (seams + 1);
    out.push(prop(`${key}-seam${i}`, run.wall, 'matte-black', chamferBox(0.0014, L.counterT * 0.9, slabD, 0), {
      position: [sx, y, slabD / 2], castShadow: false, receiveShadow: false,
    }));
  }

  // caulk where the deck dies into the wall
  out.push(prop(`${key}-caulk`, run.wall, 'white-plastic', caulkBead(width, 0.003), {
    position: [cx, L.counterTopY, 0.003], rotation: [0, 0, 0], castShadow: false, receiveShadow: false,
  }));

  return out;
}

function splashParts(L: KitchenLayoutData, run: KRun): Part[] {
  if (!L.backsplash.present || !run.backsplash) return [];
  const modern = L.style === 'modern' || L.style === 'contemporary' || L.style === 'industrial' || L.style === 'scandinavian';
  // A stone SLAB splash is one piece of stone: no chamfered arris along every
  // edge (which reads as a panel joint wherever two spans meet) and no bullnose
  // or schluter cap where it stops — a slab has a polished edge, not a trim.
  // Tile keeps both, because tile really does have them.
  const slab = L.backsplash.pattern === 'slab';
  const ceiling = L.h - L.ceilingCrown - 0.02;
  const out: Part[] = [];
  run.splash.forEach((sp, i) => {
    const h = sp.top - sp.bottom;
    if (h < 0.02) return;
    const w = sp.x1 - sp.x0;
    const cx = (sp.x0 + sp.x1) / 2;
    const key = `${run.id}-sp${i}`;
    out.push(surface(key, run.wall, 'backsplash', chamferBox(w, h, SPLASH_T, slab ? 0 : 0.0008), {
      position: [cx, sp.bottom + h / 2, SPLASH_T / 2], castShadow: false,
    }));
    // the tile field only gets a finished top edge where it stops in mid-wall —
    // not under a cabinet, not at the ceiling
    const capped = !slab && (!run.hasUppers || sp.top < run.upperBottom - 0.01) && sp.top < ceiling;
    if (capped) {
      out.push(modern
        ? prop(`${key}-schluter`, run.wall, 'brushed-nickel', schluterEdge(w, SPLASH_T), {
          position: [cx, sp.top, 0], castShadow: false,
        })
        : surface(`${key}-bull`, run.wall, 'backsplash', bullnoseCap(w, SPLASH_T), {
          position: [cx, sp.top - inch(2), 0], inert: true, castShadow: false,
        }));
    }
    // the bead is where tile meets deck; a piece over a window head has none
    if (sp.bottom < L.counterTopY + 0.002) {
      out.push(prop(`${key}-caulk`, run.wall, 'white-plastic', caulkBead(w, 0.0028), {
        position: [cx, L.counterTopY + 0.0005, SPLASH_T], castShadow: false, receiveShadow: false,
      }));
    }
  });
  return out;
}

export function counterParts(L: KitchenLayoutData): Part[] {
  const out: Part[] = [];
  for (const run of L.runs) {
    run.counters.forEach(([x0, x1], i) => {
      if (x1 - x0 < 0.05) return;
      out.push(...counterSlabParts(L, run, x0, x1, i));
    });
    out.push(...splashParts(L, run));
  }
  return compact(out);
}

/** Exposed for the island builder, which needs the same edge treatment. */
export function islandEdgeParts(
  L: KitchenLayoutData, key: string, x0: number, x1: number, y: number, zFront: number, zBack: number,
): Part[] {
  const e = edgeSpec(L);
  const out: Part[] = [];
  const push = (path: Vec3[], suffix: string) => out.push(surface(`${key}${suffix}`, 'island', 'island_countertop',
    profileMoulding(path, e.profile, { scale: e.scale, up: [0, 1, 0] }), { inert: true, castShadow: false }));
  push([[x0, y, zFront], [x1, y, zFront]], '-eF');
  push([[x1, y, zBack], [x0, y, zBack]], '-eB');
  push([[x0 + e.out, y, zBack - e.out], [x0 + e.out, y, zFront - e.out]], '-eL');
  push([[x1 - e.out, y, zFront - e.out], [x1 - e.out, y, zBack - e.out]], '-eH');
  return out;
}
