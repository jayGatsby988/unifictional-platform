'use client';
/**
 * Room envelope — the part of a bathroom photograph that is not a fixture.
 *
 * Floor (recessed for the shower pan), single-sided walls with real openings,
 * ceiling, wall tile with a REAL thickness and a finished termination
 * (schluter or bullnose, never a paper-thin plane), profiled base and shoe,
 * cased windows with a stool and apron, a stile-and-rail door on a jamb with a
 * threshold and a lever, and the electrical a real room has: a GFCI over the
 * counter, a switch by the door and a vent register.
 */
import { useMemo } from 'react';
import type { Wall } from '@/lib/spec/types';
import { wallFace, wallFrame, worldPlane } from '@/components/scene/geometry';
import { Prop, Surface, InstancedSurface } from '@/components/scene/Surface';
import {
  openingCasing, outletPlate, switchPlate, ventRegister, doorKnob, hinge, chamferBox } from '@/components/scene/detail';
import { inch } from '@/lib/units';
import { OnWall } from './OnWall';
import {
  baseProfileFor, baseRun, casingProfileFor, doorJamb, floorWithHoles, roomDoor, tileCourses, tileEdge,
} from './helpers';
import { TIER_BUDGET, useDetailTier } from './quality';
import { projectRectOnWall, rectOnWall, subtractIntervals, type BathLayout, type LOpening, type LTile, type Rect } from './layout';

import { bathroomWallHoles, clipTileJoint, TILE_T } from './envelope';
export { TILE_T } from './envelope';
import { tileHeightFor, tileOffsetAt } from './tile-height';
export { accentWallOf, tileHeightFor, tileOffsetAt } from './tile-height';

const WALLS: Wall[] = ['back', 'left', 'right', 'front'];
/** Nominal wall-tile course height (a 12×24 field laid horizontally). */
const COURSE_H = inch(12);

/** Wall-local x intervals covered by tiled built-ins (shower stall, alcove tub surround). */
function builtInIntervals(L: BathLayout, wall: Wall): Array<[number, number]> {
  const rects: Rect[] = [];
  if (L.shower) rects.push(L.shower.rect);
  if (L.tub && L.tub.kind === 'alcove') rects.push(L.tub.rect);
  const out: Array<[number, number]> = [];
  for (const r of rects) {
    const p = projectRectOnWall(wall, L.w, L.d, r);
    if (p.perp < 0.05) out.push([p.x0 - 0.012, p.x1 + 0.012]);
  }
  return out;
}

/** The pattern / module / joint a given wall is actually laid in. */
export function tileLayFor(L: BathLayout, wall: Wall): { pattern: LTile['pattern']; module: LTile['module']; grout: number | null; accent: boolean } {
  const a = L.tile.accent;
  if (a && a.wall === wall) return { pattern: a.pattern, module: a.module ?? L.tile.module, grout: L.tile.grout, accent: true };
  return { pattern: L.tile.pattern, module: L.tile.module, grout: L.tile.grout, accent: false };
}

/** The cap at the top of a wainscot run — 'none' means the run simply stops. */
const TRIM_KIND: Record<Exclude<BathLayout['tile']['trim'], 'none'>, 'bullnose' | 'schluter' | 'pencil' | 'chair-rail'> = {
  bullnose: 'bullnose', pencil: 'pencil', 'chair-rail': 'chair-rail', 'metal-edge': 'schluter',
};

/** Shower pan footprint, so the floor tile stops at the curb instead of running under it. */
function showerPanRect(L: BathLayout): Rect | null {
  const s = L.shower;
  if (!s || s.hasTub) return null;
  return rectOnWall(s.wall, L.w, L.d, s.a + s.innerOffset, s.inner, s.depth - 0.03);
}

export function RoomShell({ L }: { L: BathLayout }) {
  const floorGeo = useMemo(() => {
    const pan = showerPanRect(L);
    return floorWithHoles(L.w, L.d, pan ? [pan] : []);
  }, [L]);
  const ceilingGeo = useMemo(() => worldPlane(L.w, L.d), [L.w, L.d]);
  return (
    <group name="shell">
      <Surface slot="floor_tile" geometry={floorGeo} castShadow={false} receiveShadow />
      <Surface slot="ceiling" geometry={ceilingGeo} position={[0, L.h, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow={false} receiveShadow={false} />
      {WALLS.map((wall) => <WallPanel key={wall} L={L} wall={wall} />)}
      {L.openings.map((o) => (o.kind === 'window' ? <Window key={o.id} L={L} o={o} /> : <Doorway key={o.id} L={L} o={o} />))}
      <Electrical L={L} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------
function WallPanel({ L, wall }: { L: BathLayout; wall: Wall }) {
  const tier = useDetailTier();
  const budget = TIER_BUDGET[tier];
  const data = useMemo(() => {
    const len = wallFrame(wall, L.w, L.d).length;
    const holes = bathroomWallHoles(L, wall);
    const wallGeo = wallFace(len, L.h, holes);
    const tileH = tileHeightFor(L, wall);
    const builtIns = builtInIntervals(L, wall);
    const doorCuts: Array<[number, number]> = L.openings
      .filter((o) => o.wall === wall && o.kind !== 'window')
      .map((o) => [o.x - o.width / 2 - 0.1, o.x + o.width / 2 + 0.1]);
    const windowCuts: Array<[number, number]> = L.openings
      .filter((o) => o.wall === wall && o.kind === 'window')
      .map((o) => [o.x - o.width / 2 - 0.05, o.x + o.width / 2 + 0.05]);

    let tileGeo: THREE_Geo | null = null;
    // Where the tile STOPS it gets a finished edge — a cap on a wainscot, a
    // schluter reveal at a full-height termination. A tiled plane that just
    // ends is the loudest "this is a render" tell in a bathroom.
    let capSegs: Array<[number, number]> = [];
    let courses: { geometry: THREE_Geo; transforms: ReturnType<typeof tileCourses>['transforms'] } | null = null;
    if (tileH > 0) {
      tileGeo = wallFace(len, tileH, [...holes.filter((h) => !builtIns.some(([a, b]) => h.x - h.w / 2 >= a && h.x + h.w / 2 <= b)), ...builtIns.map(([x0, x1]) => ({ x: (x0 + x1) / 2, y: 0, w: x1 - x0, h: tileH + 0.02 }))]);
      const stops = L.wallTile === 'full' || L.wallTile === 'accent-wall'
        ? [] as Array<[number, number]>
        : [...builtIns, ...doorCuts, ...windowCuts];
      capSegs = L.wallTile === 'wainscot' ? subtractIntervals(-len / 2, len / 2, stops) : [];
      /**
       * EVERY clear stretch of the wall, not just the widest one. The joints
       * used to be drawn on the largest span alone, so on a wall a window and
       * a tub cut into three the tile was jointed in one strip and blank
       * either side of it — most visible on exactly the wall a feature tile
       * is chosen for. Each span is laid on its own (its cut tiles fall at its
       * own ends, which is what an installer does) and they share one batch,
       * because `tileCourses` returns the same cached bar for all of them.
       */
      /**
       * A WINDOW does not take the wall over, it sits in it: the field is
       * tiled above its head and below its sill, and the coursing runs
       * straight past it. Cutting it out of the span like a shower wall left a
       * bare column the full height of the wall — on the accent wall, a blank
       * stripe through the middle of the feature tile. So openings are clipped
       * out of the JOINTS afterwards (`clipTileJoint`), in two dimensions,
       * and only the fixtures that genuinely own their piece of wall cut the
       * span. Door openings still cut: a cased door reaches the ceiling.
       */
      const spans = subtractIntervals(-len / 2 + 0.01, len / 2 - 0.01, [...doorCuts, ...builtIns])
        .filter((sp) => sp[1] - sp[0] > 0.3)
        .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
      // the window openings on this wall, as rectangles with the casing's margin
      const windowRects = L.openings
        .filter((o) => o.wall === wall && o.kind === 'window')
        .map((o) => ({ x0: o.x - o.width / 2 - 0.05, x1: o.x + o.width / 2 + 0.05, y0: o.sill - 0.05, y1: o.sill + o.height + 0.05 }));
      if (budget.courses > 0 && spans.length) {
        // How this wall is actually laid — the accent wall gets its OWN pattern
        // and module, which is the entire point of a feature wall.
        const lay = tileLayFor(L, wall);
        /*
         * The ACCENT wall may weave at full size — it is one wall, chosen to
         * be looked at; the field's three share the standard batch. The cap is
         * the WALL's, so three spans of it cannot cost three times as much.
         *
         * Raised from 720/3600: at 720 an 11 ft field wall in a 4" herringbone
         * (828 bars) fell back to plain courses, which is the wrong tile on a
         * wall the client chose. A bar is 60 triangles, so the worst case here
         * is 3 × 1600 + 6000 = 10.8 k bars = 648 k of the 1.2 M scene budget —
         * and only on the top tier, because a phone that is already dropping
         * mosaic chips has no business spending it.
         */
        const weaveBudget = budget.courses >= 44 ? { field: 1600, accent: 6000 } : { field: 720, accent: 3600 };
        let weaveLeft = lay.accent ? weaveBudget.accent : weaveBudget.field;
        let geometry: THREE_Geo | null = null;
        const transforms: ReturnType<typeof tileCourses>['transforms'] = [];
        for (const sp of spans) {
          const c = tileCourses(sp[1] - sp[0], tileH, lay.module ? inch(lay.module.h) : COURSE_H, {
            max: budget.courses,
            pattern: lay.pattern,
            moduleW: lay.module ? inch(lay.module.w) : null,
            joint: lay.grout ?? 0.003,
            weaveCap: weaveLeft,
          });
          weaveLeft = Math.max(0, weaveLeft - c.transforms.length);
          geometry ??= c.geometry;
          // the courses sit a hair proud of the field so raking light finds the
          // lippage at every joint — that shadow line is what says "tile"
          const cx = (sp[0] + sp[1]) / 2;
          for (const t of c.transforms) {
            for (const q of clipTileJoint({ ...t, position: [cx + (t.position?.[0] ?? 0), t.position?.[1] ?? 0, TILE_T + 0.0011] }, windowRects)) transforms.push(q);
          }
        }
        if (geometry && transforms.length) courses = { geometry, transforms };
      }
    }
    // Base runs on every stretch of wall the tile does not already cover.
    const baseCuts = tileH > 0 && L.wallTile !== 'wainscot' ? [[-len, len]] as Array<[number, number]> : [...builtIns, ...doorCuts];
    const baseSegs = subtractIntervals(-len / 2 + 0.002, len / 2 - 0.002, baseCuts);
    return { wallGeo, tileGeo, tileH, capSegs, baseSegs, courses, trim: TRIM_KIND[L.tile.trim === 'none' ? 'bullnose' : L.tile.trim], noTrim: L.tile.trim === 'none' };
  }, [L, wall, budget.courses]);

  const baseProfile = baseProfileFor(L.style);

  return (
    <OnWall insideOnly wall={wall} w={L.w} d={L.d}>
      <Surface slot="walls" geometry={data.wallGeo} castShadow={false} receiveShadow />
      {data.tileGeo && (
        <Surface slot="wall_tile" geometry={data.tileGeo} position={[0, 0, TILE_T]} castShadow={false} receiveShadow />
      )}
      {data.courses && (
        <InstancedSurface
          slot="wall_tile"
          inert
          geometry={data.courses.geometry}
          transforms={data.courses.transforms}
          castShadow={false}
        />
      )}
      {/* the cap's profile is drawn from the substrate outward, so its origin
          sits on the wall and its face lands exactly on the tile face */}
      {!data.noTrim && data.capSegs.map(([x0, x1], i) => (
        <Surface key={`cap-${i}`} slot="wall_tile" inert geometry={tileEdge(x1 - x0, TILE_T, data.trim)} position={[(x0 + x1) / 2, data.tileH, 0]} castShadow={false} />
      ))}
      {/* base runs in front of a tile wainscot, flat on the wall otherwise */}
      {data.baseSegs.map(([x0, x1], i) => (
        <Prop key={`base-${i}`} util="white-plastic" geometry={baseRun(x1 - x0, baseProfile)} position={[(x0 + x1) / 2, 0, data.tileH > 0 ? TILE_T : 0.0005]} castShadow={false} />
      ))}
    </OnWall>
  );
}
type THREE_Geo = ReturnType<typeof wallFace>;

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------
function Window({ L, o }: { L: BathLayout; o: LOpening }) {
  const style = o.style ?? 'standard';
  const casing = casingProfileFor(L.style);
  const g = useMemo(() => {
    const jambT = 0.115;
    return {
      jambL: chamferBox(0.019, o.height + 0.038, jambT, 0.001),
      head: chamferBox(o.width + 0.038, 0.019, jambT, 0.001),
      // stool (the inside sill) noses past the casing and gets an apron under it
      stool: chamferBox(o.width + 0.115, 0.026, jambT + 0.035, 0.0025),
      casing: openingCasing(o.width, o.height, casing, { reveal: 0.005 }),
      apron: chamferBox(o.width + 0.06, 0.070, 0.016, 0.0015),
      glass: worldPlane(o.width - 0.05, o.height - 0.05),
      backdrop: worldPlane(o.width * 2.6 + 0.6, o.height * 2.6 + 0.6),
      sashRail: chamferBox(o.width - 0.04, 0.048, 0.030, 0.0012),
      sashStile: chamferBox(0.042, o.height - 0.04, 0.030, 0.0012),
      muntinH: chamferBox(o.width - 0.06, 0.022, 0.020, 0.0008),
      muntinV: chamferBox(0.022, o.height - 0.06, 0.020, 0.0008),
      lock: chamferBox(0.052, 0.020, 0.026, 0.002),
    };
  }, [o.width, o.height, casing]);
  const midBar = style === 'standard' || style === 'double-hung' || style === 'french';
  const vBar = style === 'slider' || (style === 'casement' && o.width > 0.9) || ((style === 'standard' || style === 'double-hung') && o.width > 1.1);
  const yc = o.sill + o.height / 2;
  return (
    <OnWall insideOnly wall={o.wall} w={L.w} d={L.d} t={o.t}>
      {/* jamb + head */}
      <Prop util="white-plastic" geometry={g.jambL} position={[-(o.width / 2 + 0.0095), yc, 0]} />
      <Prop util="white-plastic" geometry={g.jambL} position={[o.width / 2 + 0.0095, yc, 0]} />
      <Prop util="white-plastic" geometry={g.head} position={[0, o.sill + o.height + 0.0095, 0]} />
      <Prop util="white-plastic" geometry={g.stool} position={[0, o.sill - 0.013, 0.0175]} />
      <Prop util="white-plastic" geometry={g.apron} position={[0, o.sill - 0.061, 0.008]} />
      {/* real profiled casing, three legs mitred at the corners */}
      <Prop util="white-plastic" geometry={g.casing} position={[0, o.sill, 0.001]} castShadow={false} />
      {/* sash */}
      <Prop util="white-plastic" geometry={g.sashStile} position={[-(o.width / 2 - 0.031), yc, -0.020]} />
      <Prop util="white-plastic" geometry={g.sashStile} position={[o.width / 2 - 0.031, yc, -0.020]} />
      <Prop util="white-plastic" geometry={g.sashRail} position={[0, o.sill + 0.034, -0.020]} />
      <Prop util="white-plastic" geometry={g.sashRail} position={[0, o.sill + o.height - 0.034, -0.020]} />
      {midBar && <Prop util="white-plastic" geometry={g.sashRail} position={[0, yc, -0.020]} />}
      {midBar && <Prop util="chrome" geometry={g.lock} position={[0, yc + 0.030, -0.004]} />}
      {vBar && <Prop util="white-plastic" geometry={g.muntinV} position={[0, yc, -0.024]} />}
      <Prop util="window-glass" geometry={g.glass} position={[0, yc, -0.030]} castShadow={false} receiveShadow={false} />
      <Prop util="sky-grey" geometry={g.backdrop} position={[0, yc, -0.44]} castShadow={false} receiveShadow={false} />
    </OnWall>
  );
}

function Doorway({ L, o }: { L: BathLayout; o: LOpening }) {
  const casing = casingProfileFor(L.style);
  const panels = L.style === 'modern' || L.style === 'contemporary' || L.style === 'scandinavian' ? 0
    : L.style === 'craftsman' || L.style === 'farmhouse' ? 3 : 2;
  const g = useMemo(() => {
    const slabW = Math.max(0.4, o.width - 0.010);
    const slabH = Math.max(1.4, o.height - 0.016);
    return {
      jamb: doorJamb(o.width, o.height, 0.115, { threshold: true }),
      casing: openingCasing(o.width + 0.038, o.height + 0.019, casing, { reveal: 0.006 }),
      door: o.kind === 'door' ? roomDoor(slabW, slabH, 0.042, panels as 0 | 2 | 3) : null,
      slabW, slabH,
    };
  }, [o.width, o.height, o.kind, casing, panels]);
  const hingeGeo = useMemo(() => hinge({ kind: 'barrel' }), []);
  return (
    <OnWall insideOnly wall={o.wall} w={L.w} d={L.d} t={o.t}>
      <Prop util="white-plastic" geometry={g.jamb} />
      <Prop util="white-plastic" geometry={g.casing} position={[0, 0, 0.001]} castShadow={false} />
      {g.door && (
        <group position={[-(g.slabW / 2 - 0.006), 0, 0.030]} rotation={[0, -0.52, 0]}>
          <group position={[g.slabW / 2, g.slabH / 2 + 0.010, 0]}>
            <Prop util="white-plastic" geometry={g.door.body} />
            <Surface slot="hardware" inert geometry={doorKnob({ lever: true })} position={[g.slabW / 2 - 0.070, 1.02 - g.slabH / 2, 0.021]} />
            <Surface slot="hardware" inert geometry={doorKnob({ lever: true })} position={[g.slabW / 2 - 0.070, 1.02 - g.slabH / 2, -0.021]} rotation={[0, Math.PI, 0]} />
            {[0.28, 0.5, 0.78].map((f) => (
              <Surface key={f} slot="hardware" inert geometry={hingeGeo} position={[-g.slabW / 2 + 0.004, -g.slabH / 2 + g.slabH * f, 0]} castShadow={false} />
            ))}
          </group>
        </group>
      )}
    </OnWall>
  );
}

// ---------------------------------------------------------------------------
// Electrical + mechanical
// ---------------------------------------------------------------------------
/**
 * The small things a photograph always contains and a model never does. Placed
 * off the layout, not hard-coded: the GFCI goes above the vanity counter on the
 * vanity wall, the switch beside the door on the latch side, the return air
 * register on the wall furthest from any wet fixture.
 */
function Electrical({ L }: { L: BathLayout }) {
  const tier = useDetailTier();
  const gfci = useMemo(() => outletPlate({ kind: 'gfci' }), []);
  const sw = useMemo(() => switchPlate({ gangs: L.lighting.sconces > 0 ? 2 : 1, kind: 'decora' }), [L.lighting.sconces]);
  const reg = useMemo(() => ventRegister(10, 4), []);
  const door = L.openings.find((o) => o.kind !== 'window') ?? null;
  const v = L.vanity;
  const gfciY = v ? v.topH + 0.24 : 1.2;
  const gfciZ = (v ? tileOffsetAt(L, v.wall, gfciY) : 0) + 0.001;
  const swZ = (door ? tileOffsetAt(L, door.wall, 1.22) : 0) + 0.001;
  // the biggest free stretch of wall carries the register
  const reg1 = useMemo(() => {
    const best = [...L.free].sort((a, b) => (b.a1 - b.a0) - (a.a1 - a.a0))[0];
    if (!best || best.a1 - best.a0 < 0.4) return null;
    const len = best.wall === 'back' || best.wall === 'front' ? L.w : L.d;
    return { wall: best.wall, t: ((best.a0 + best.a1) / 2) / len };
  }, [L.free, L.w, L.d]);

  return (
    <group name="electrical">
      {v && (
        <OnWall insideOnly wall={v.wall} w={L.w} d={L.d} t={v.t}>
          <Prop util="white-plastic" geometry={gfci} position={[Math.min(v.width / 2 - 0.14, 0.62), gfciY, gfciZ]} castShadow={false} />
        </OnWall>
      )}
      {door && (
        <OnWall insideOnly wall={door.wall} w={L.w} d={L.d} t={door.t}>
          <Prop util="white-plastic" geometry={sw} position={[door.width / 2 + 0.15, 1.22, swZ]} castShadow={false} />
        </OnWall>
      )}
      {reg1 && tier !== 'performance' && (
        <OnWall insideOnly wall={reg1.wall} w={L.w} d={L.d} t={reg1.t}>
          <Prop util="white-plastic" geometry={reg} position={[0, L.h - 0.30, tileOffsetAt(L, reg1.wall, L.h - 0.30) + 0.002]} castShadow={false} />
        </OnWall>
      )}
    </group>
  );
}
