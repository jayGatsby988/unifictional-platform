'use client';
/**
 * Shower — a properly built enclosure rather than a glass box on a tile floor.
 *
 *   - tiled walls with a real 10 mm build-up, courses that stop where they meet
 *     the glass, and a finished outside corner return on every exposed edge;
 *   - a pan that actually falls to the drain, tiled in real mosaic chips
 *     (one InstancedMesh) with a linear or centre waste;
 *   - a sloped-cap curb, or a curbless threshold with a linear drain at it;
 *   - frameless 10 mm glass with polished edges, a header bar, pivot hinges
 *     with cover screws, and a back-to-back ladder handle;
 *   - a niche with a schluter reveal and a stone shelf, a radiused bench;
 *   - a rain head on a real drop arm, a handheld on a slide bar with a hanging
 *     hose, and valve trim with a screwed plate.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { wallFace, wallWithOpenings } from '@/components/scene/geometry';
import { InstancedSurface, Prop, Surface } from '@/components/scene/Surface';
import { chamferBox, filletBox, mergeDetail, transformed } from '@/components/scene/detail';
import { inch } from '@/lib/units';
import { OnWall } from './OnWall';
import {
  bodyJet, caulkBead, ceilingRainHead, curtainGeometry, cupLathe, cupProfile, glassClamp, glassHandle, glassHeader,
  glassHinge, glassPane, glassTrack, linearDrain, mosaicField, nicheShell, showerBench, showerCurb, showerValve,
  slideBarSet, slabWithCutouts, tileCourses, tileCornerReturn, tubApron, tubOverflow,
  wallShowerHead, wallTubTrim, wasteGrate, foldedTowel, soapDispenser,
} from './helpers';
import { clipTileJoint, showerFaces, showerHardwareLayout, showerNicheFrame, TILE_T } from './envelope';
import { TIER_BUDGET, useDetailTier } from './quality';
import { FINISH_UTIL } from './finish';
import type { BathLayout, LShower } from './layout';

const GLASS_TOP = 1.98;
const COURSE_H = inch(12);

export function Shower({ L, s }: { L: BathLayout; s: LShower }) {
  const tier = useDetailTier();
  const budget = TIER_BUDGET[tier];
  const Wi = s.inner;
  const Dp = s.depth - 0.03;
  const xC = s.innerOffset;
  const xl = xC - Wi / 2, xr = xC + Wi / 2;
  const PT = s.partition;
  const tileH = L.h - 0.006;
  // A curb of zero height is not a 1 mm curb, it is no curb — a "curbless"
  // toggle and a curb-height slider that disagree resolve to the threshold.
  const curbH = s.curbHeight;
  const curb = !s.curbless && !s.hasTub && curbH > 0.01;
  const curbD = inch(5);
  const GLASS_T = s.glassThickness;
  const panDrop = 0.016;
  const glassBottom = s.hasTub ? 0.50 : curb ? curbH : 0.004;
  const glassH = Math.max(0.6, GLASS_TOP - glassBottom);
  const modern = ['modern', 'contemporary', 'scandinavian', 'industrial', 'mid-century', 'coastal'].includes(L.style);
  const N = s.nicheAt;
  const headX = s.hasTub ? (s.leftIsRoomWall ? xl + 0.32 : s.rightIsRoomWall ? xr - 0.32 : xC) : xC;
  const benchSide = s.doorSide === 'right' ? 'left' : 'right';
  const framed = s.enclosure === 'framed-glass';
  const showCurtain = s.enclosure === 'curtain';
  const wantBench = s.bench && !s.hasTub && Wi >= inch(40);

  /**
   * What is actually hanging in the opening.
   *
   * `doorType` used to be derived from `enclosure` alone, so "barn" and
   * "sliding" and "walk-in" were words the contract carried and the stall
   * could not honour. A slider and a barn door are two panels on a TRACK with
   * no hinges; a pivot is a single centred leaf; a fixed panel is glass with
   * no door at all; walk-in / none is an open opening.
   */
  const dt = s.doorType;
  const sliding = dt === 'sliding' || dt === 'barn';
  const isGlass = !showCurtain && dt !== 'none' && dt !== 'walk-in';
  const hinged = dt === 'hinged' || dt === 'pivot';

  const doorW = !isGlass ? 0
    : sliding ? Math.max(0.45, Wi / 2 + 0.03)
      : dt === 'fixed-panel' ? Math.min(Wi - 0.016, Math.max(0.5, Wi * 0.62))
        : (Wi < 0.85 ? Wi - 0.016 : Math.min(0.78, Math.max(0.60, Wi * 0.55)));
  const fixedW = !isGlass ? 0
    : sliding ? Math.max(0.45, Wi / 2 + 0.03)
      : dt === 'fixed-panel' ? 0
        : (Wi < 0.85 ? 0 : Wi - doorW - 0.018);
  const doorX = s.doorSide === 'right' ? xr - doorW / 2 - 0.004 : xl + doorW / 2 + 0.004;
  const fixedX = s.doorSide === 'right' ? xl + fixedW / 2 + 0.004 : xr - fixedW / 2 - 0.004;
  const hingeWallX = s.doorSide === 'right' ? xr - 0.004 : xl + 0.004;
  const handleX = s.doorSide === 'right' ? doorX - doorW / 2 + 0.075 : doorX + doorW / 2 - 0.075;
  const zFront = Dp - 0.006;
  const glassY = glassBottom + glassH / 2;
  // A corner bench is the 440 mm block the stall has always had; full-width
  // runs the whole back wall; a floating slab is cantilevered with nothing
  // under it, which is why its body is omitted from the tiled shell.
  const benchW = s.benchStyle === 'full-width' ? Wi - 0.02 : 0.44;
  const benchX = s.benchStyle === 'full-width' ? xC : benchSide === 'left' ? xl + benchW / 2 : xr - benchW / 2;
  const benchD = Math.min(s.benchStyle === 'full-width' ? 0.36 : 0.40, Dp - 0.06);
  const benchH = s.benchStyle === 'floating' ? 0.44 : 0.46;
  const benchZ = s.benchStyle === 'full-width' ? benchD / 2 + TILE_T : Dp / 2 - 0.02;

  // ------------------------------------------------------------- tiled shell
  /**
   * Where the niche is CUT, in the stall's own frame.
   *
   * `nicheAt.face` says which of the three tiled faces; `x` is along that face
   * (wall-local for the back, distance from the stall opening for a side), and
   * the geometry has to be rotated to stand on a side wall rather than always
   * being cut into the back. The transform is worked out once here so the hole,
   * the tiled shell, the shelf, the trim and the toiletries all agree.
   */
  const nicheAt = useMemo(() => showerNicheFrame(s), [s]);
  const faces = useMemo(() => showerFaces(L, s), [L, s]);
  const hardware = useMemo(() => showerHardwareLayout(L, s), [L, s]);

  const tile = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const face of faces) {
      const geometry = face.roomWall
        ? wallFace(face.width, tileH, face.holes)
        : wallWithOpenings(face.width, tileH, PT, face.holes);
      parts.push(transformed(geometry, face));
    }
    // the tiled edges the glass lands against get a real return, so the eye
    // never sees a paper-thin plane end in mid air
    for (const [x, at] of [[xl, s.leftIsRoomWall], [xr, s.rightIsRoomWall]] as Array<[number, boolean]>) {
      if (!at) continue;
      parts.push(transformed(tileCornerReturn(tileH, TILE_T), { position: [x + (x === xl ? TILE_T / 2 : -TILE_T / 2), tileH / 2, Dp - TILE_T / 2] }));
    }
    if (N && nicheAt) {
      const n = nicheShell(N.width, N.height, N.depth, { shelf: N.shelves > 0 });
      parts.push(transformed(n.tile, nicheAt));
    }
    // a floating bench is cantilevered: there is no tiled body under it at all
    if (wantBench && s.benchStyle !== 'floating') {
      const b = showerBench(benchW, benchD, benchH);
      parts.push(transformed(b.body, { position: [benchX, 0, benchZ] }));
    }
    return mergeDetail(parts);
  }, [Dp, PT, tileH, xl, xr, s.leftIsRoomWall, s.rightIsRoomWall, s.benchStyle, N, nicheAt, faces, wantBench, benchX, benchW, benchD, benchH, benchZ]);

  /** Continuous tile courses on all three faces, cut clear of windows and niches. */
  const courses = useMemo(() => {
    if (budget.courses <= 0) return null;
    const pattern = L.tile.showerPattern ?? L.tile.pattern;
    const mod = L.tile.showerModule ?? L.tile.module;
    const transforms: ReturnType<typeof tileCourses>['transforms'] = [];
    let geometry: THREE.BufferGeometry | null = null;
    for (const face of faces) {
      const c = tileCourses(face.width - 0.02, tileH, mod ? inch(mod.h) : COURSE_H, {
        max: budget.courses, pattern, moduleW: mod ? inch(mod.w) : null, joint: L.tile.grout ?? 0.003,
      });
      geometry ??= c.geometry;
      const holes = face.holes.map((h) => ({ x0: h.x - h.w / 2, x1: h.x + h.w / 2, y0: h.y, y1: h.y + h.h }));
      for (const t of c.transforms.flatMap((t) => clipTileJoint(t, holes))) {
        const p = new THREE.Vector3(...(t.position ?? [0, 0, 0]));
        p.z += 0.0011;
        p.applyAxisAngle(new THREE.Vector3(0, 1, 0), face.rotation[1]);
        p.add(new THREE.Vector3(...face.position));
        transforms.push({ ...t, position: [p.x, p.y, p.z], rotation: [0, face.rotation[1], t.rotation?.[2] ?? 0] });
      }
    }
    return geometry ? { geometry, transforms } : null;
  }, [faces, tileH, budget.courses, L.tile.showerPattern, L.tile.pattern, L.tile.showerModule, L.tile.module, L.tile.grout]);

  // ------------------------------------------------------------------- pan
  const mosaic = useMemo(() => {
    if (s.hasTub || budget.mosaic <= 0) return null;
    const drainZ = s.curbless ? Dp - 0.10 : Dp * 0.52;
    return mosaicField(Wi - 0.012, Dp - 0.012, { chip: inch(2), joint: 0.0032, slope: panDrop, drain: [0, drainZ - Dp / 2], max: budget.mosaic });
  }, [s.hasTub, s.curbless, Wi, Dp, budget.mosaic]);
  const mosaicTransforms = useMemo(
    () => (mosaic ? mosaic.transforms.map((t) => ({ ...t, position: [xC + (t.position?.[0] ?? 0), (t.position?.[1] ?? 0) + 0.004, Dp / 2 + (t.position?.[2] ?? 0)] as [number, number, number] })) : []),
    [mosaic, xC, Dp],
  );
  /** Mortar bed under the chips: sloped, so the pan has real fall even bare. */
  const panBed = useMemo(() => {
    if (s.hasTub) return null;
    return transformed(chamferBox(Wi, 0.022, Dp, 0.0015), { position: [xC, -0.006, Dp / 2], rotation: [-0.012, 0, 0] });
  }, [s.hasTub, Wi, Dp, xC]);

  /**
   * The silicone bead where the pan meets each tiled wall. Every wet corner in
   * a real bathroom has one; without it the pan and the walls read as two
   * pieces of folded paper meeting at a knife edge.
   */
  const caulk = useMemo(() => {
    if (s.hasTub) return null;
    return mergeDetail([
      transformed(caulkBead(Wi, 0.006), { position: [xC, 0.002, TILE_T] }),
      transformed(caulkBead(Dp, 0.006), { position: [xl + TILE_T, 0.002, Dp / 2], rotation: [0, Math.PI / 2, 0] }),
      transformed(caulkBead(Dp, 0.006), { position: [xr - TILE_T, 0.002, Dp / 2], rotation: [0, -Math.PI / 2, 0] }),
    ]);
  }, [s.hasTub, Wi, Dp, xC, xl, xr]);

  // ---------------------------------------------------------------- stonework
  const stone = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    if (curb) parts.push(transformed(showerCurb(Wi + (s.leftIsRoomWall ? 0 : PT) + (s.rightIsRoomWall ? 0 : PT), curbH, curbD), { position: [xC, 0, Dp - curbD / 2] }));
    if (N && nicheAt) {
      // one shelf splits the niche in two; more are stacked evenly, which is
      // how a tall shampoo niche is actually built
      const n = nicheShell(N.width, N.height, N.depth, { shelf: N.shelves > 0 });
      if (n.shelf && N.shelves >= 1) {
        for (let i = 1; i <= N.shelves; i++) {
          const y = (i / (N.shelves + 1)) * N.height - N.height * 0.5;
          parts.push(transformed(n.shelf, { ...nicheAt, position: [nicheAt.position[0], nicheAt.position[1] + y, nicheAt.position[2]] }));
        }
      }
    }
    if (wantBench) parts.push(transformed(showerBench(benchW, benchD, benchH).top, { position: [benchX, 0, benchZ] }));
    return parts.length ? mergeDetail(parts) : null;
  }, [curb, Wi, PT, s.leftIsRoomWall, s.rightIsRoomWall, curbH, curbD, xC, Dp, N, nicheAt, wantBench, benchX, benchW, benchD, benchH, benchZ]);

  /**
   * The schluter reveal around the niche. Memoised because `transformed()`
   * CLONES: building it inline in the JSX allocated a fresh BufferGeometry on
   * every React render and never disposed the old one.
   */
  const nicheTrim = useMemo(
    () => (N && nicheAt
      ? transformed(nicheShell(N.width, N.height, N.depth).trim, { ...nicheAt, position: [nicheAt.position[0] - (N.face === 'left' ? TILE_T : N.face === 'right' ? -TILE_T : 0), nicheAt.position[1], nicheAt.position[2] - (N.face === 'back' ? TILE_T : 0)] })
      : null),
    [N, nicheAt],
  );

  // ----------------------------------------------------------------- fixtures
  const trim = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(transformed(showerValve({ round: !modern, diverter: s.fixtures === 'rain-plus-handheld' || s.fixtures === 'body-jets' }), { position: hardware.valve }));
    if (s.hasTub) parts.push(transformed(wallTubTrim({ cross: L.style === 'traditional' || L.style === 'farmhouse' }), { position: [headX, 0.62, TILE_T] }));
    if (s.fixtures === 'single' || s.fixtures === 'body-jets') {
      parts.push(transformed(wallShowerHead({ armLength: 0.32, headMm: modern ? 200 : 140 }), { position: hardware.head }));
    }
    if (s.fixtures === 'rain' || s.fixtures === 'rain-plus-handheld') {
      const drop = Math.min(0.34, Math.max(0.10, L.h - 2.16));
      parts.push(transformed(ceilingRainHead(drop, modern ? 300 : 250, { square: modern }), { position: [headX, L.h - 0.004, Math.min(Dp * 0.5, 0.56)] }));
    }
    if (s.fixtures === 'rain-plus-handheld') {
      parts.push(transformed(slideBarSet(0.66), { position: hardware.handheld }));
    }
    if (s.fixtures === 'body-jets') {
      for (const dy of [-0.25, 0, 0.25]) parts.push(transformed(bodyJet(), { position: [hardware.jets[0], hardware.jets[1] + dy, TILE_T] }));
    }
    // enclosure metalwork lives in the same finish, so it merges here too
    if (isGlass) {
      if (sliding) {
        // a slider and a barn door hang from a TRACK — no hinges at all, and a
        // barn door's rail and wheels are the whole look
        parts.push(transformed(glassTrack(Wi, { barn: dt === 'barn', rollers: 2 }), { position: [xC, GLASS_TOP + (dt === 'barn' ? 0.055 : 0.020), zFront - 0.012] }));
        parts.push(transformed(glassHandle(0.30), { position: [handleX, 1.12, zFront + GLASS_T], rotation: [0, 0, Math.PI / 2] }));
      } else if (hinged) {
        parts.push(transformed(glassHeader(Wi), { position: [xC, GLASS_TOP + 0.013, zFront] }));
        parts.push(transformed(glassHandle(0.30), { position: [handleX, 1.12, zFront - GLASS_T / 2], rotation: [0, 0, Math.PI / 2] }));
      }
      if (hinged) {
        for (const y of [glassBottom + 0.26, GLASS_TOP - 0.24]) {
          parts.push(transformed(glassHinge(), { position: [hingeWallX, y, zFront - 0.026], rotation: [0, s.doorSide === 'right' ? -Math.PI / 2 : Math.PI / 2, 0] }));
        }
      }
      // a fixed panel is CLAMPED, not hung, at top and bottom
      if (fixedW > 0.05 || dt === 'fixed-panel') {
        const w = fixedW > 0.05 ? fixedW : doorW;
        const x = fixedW > 0.05 ? fixedX : doorX;
        for (const y of [glassBottom + 0.12, GLASS_TOP - 0.12]) {
          parts.push(transformed(glassClamp(), { position: [x + (s.doorSide === 'right' ? -w / 2 : w / 2), y, zFront - 0.024], rotation: [0, s.doorSide === 'right' ? Math.PI / 2 : -Math.PI / 2, 0] }));
        }
      }
    }
    if (framed) {
      parts.push(transformed(chamferBox(0.026, glassH, 0.028, 0.0018), { position: [xl + 0.013, glassY, zFront] }));
      parts.push(transformed(chamferBox(0.026, glassH, 0.028, 0.0018), { position: [xr - 0.013, glassY, zFront] }));
      parts.push(transformed(chamferBox(Wi, 0.022, 0.032, 0.0018), { position: [xC, glassBottom + 0.011, zFront] }));
    }
    if (showCurtain) {
      parts.push(transformed(chamferBox(Wi + (s.leftIsRoomWall ? 0 : PT) + (s.rightIsRoomWall ? 0 : PT) - 0.02, 0.024, 0.024, 0.0018), { position: [xC, GLASS_TOP, Dp + 0.02] }));
    }
    if (!s.hasTub) {
      parts.push(transformed(
        s.curbless ? linearDrain(Math.min(Wi - 0.10, 0.9)) : wasteGrate(100, { square: modern }),
        { position: [xC, -panDrop + 0.006, s.curbless ? Dp - 0.10 : Dp * 0.52] },
      ));
    } else {
      parts.push(transformed(wasteGrate(80), { position: [headX, 0.075, Dp / 2] }));
      parts.push(transformed(tubOverflow(), { position: [headX, 0.36, TILE_T + 0.004] }));
    }
    return mergeDetail(parts);
  }, [s.fixtures, s.hasTub, s.curbless, s.doorSide, s.leftIsRoomWall, s.rightIsRoomWall, headX, hardware, Wi, Dp, xC, xl, xr, PT, L.h, L.style, modern, isGlass, sliding, hinged, dt, framed, showCurtain, zFront, glassBottom, glassH, glassY, handleX, hingeWallX, doorW, doorX, fixedW, fixedX, GLASS_T]);

  // -------------------------------------------------------------------- glass
  const glass = useMemo(() => {
    if (!isGlass) return null;
    const parts: THREE.BufferGeometry[] = [];
    // A bypass slider's two panels are in DIFFERENT planes — that offset is
    // what says "these slide past each other" rather than "these are fixed".
    const dz = sliding ? GLASS_T + 0.006 : 0;
    if (doorW > 0.05) parts.push(transformed(glassPane(doorW, glassH, GLASS_T), { position: [doorX, glassY, zFront + dz] }));
    if (fixedW > 0.05) parts.push(transformed(glassPane(fixedW, glassH, GLASS_T), { position: [fixedX, glassY, zFront] }));
    return parts.length ? mergeDetail(parts) : null;
  }, [isGlass, sliding, doorW, fixedW, doorX, fixedX, glassH, glassY, zFront, GLASS_T]);

  const curtain = useMemo(() => (showCurtain ? curtainGeometry(Math.max(0.5, Wi * 0.72), GLASS_TOP - 0.09) : null), [showCurtain, Wi]);

  // ------------------------------------------------------------ combo tub
  const comboTub = useMemo(() => {
    if (!s.hasTub) return null;
    const tw = Wi - 0.012, td = Dp - 0.012;
    const deck = slabWithCutouts(tw, 0.042, td, [{ x: 0, z: 0, w: tw - 0.19, d: td - 0.19, r: 0.11 }], 0.006);
    const { profile, outerIndex } = cupProfile({ height: 0.44, wall: 0.045, floor: 0.03, rim: 0.016, baseInset: 0.08, baseRise: 0.02 });
    const cup = cupLathe(profile, outerIndex, 40);
    return {
      body: mergeDetail([
        transformed(tubApron(tw, td, 0.50), { position: [xC, 0, Dp - td] }),
        transformed(deck, { position: [xC, 0.48, Dp / 2] }),
      ]),
      bowl: transformed(cup, { position: [xC, 0.055, Dp / 2], scale: [(tw - 0.19) / 2 + 0.02, 1, (td - 0.19) / 2 + 0.02] }),
      tw, td,
    };
  }, [s.hasTub, Wi, Dp, xC]);

  return (
    <OnWall wall={s.wall} w={L.w} d={L.d} t={s.t}>
      <Surface slot="shower_wall_tile" geometry={tile} receiveShadow />
      {courses && <InstancedSurface slot="shower_wall_tile" inert geometry={courses.geometry} transforms={courses.transforms} castShadow={false} />}
      {nicheTrim && <Surface slot="fixtures" inert geometry={nicheTrim} castShadow={false} />}

      {panBed && <Surface slot="shower_floor_tile" geometry={panBed} castShadow={false} receiveShadow />}
      {mosaic && mosaicTransforms.length > 0 && (
        <InstancedSurface slot="shower_floor_tile" geometry={mosaic.geometry} transforms={mosaicTransforms} castShadow={false} receiveShadow />
      )}

      {caulk && <Prop util="ceramic-matte" geometry={caulk} castShadow={false} />}
      {stone && <Surface slot="vanity_top" geometry={stone} receiveShadow />}
      {/* a stated door finish overrides the room's fixtures slot for THIS
          metalwork — a matte-black frameless stall in a chrome bathroom is a
          spec a contractor writes every week */}
      <Surface slot="fixtures" geometry={trim} util={s.hardwareFinish ? FINISH_UTIL[s.hardwareFinish] : undefined} />

      {glass && <Prop util="glass" geometry={glass} castShadow={false} receiveShadow={false} />}
      {curtain && (
        <Prop util="fabric-linen" geometry={curtain} position={[s.doorSide === 'right' ? xl + Math.max(0.5, Wi * 0.72) / 2 : xr - Math.max(0.5, Wi * 0.72) / 2, 0.06, Dp + 0.02]} />
      )}

      {comboTub && (
        <>
          <Surface slot="tub" geometry={comboTub.body} />
          <Surface slot="tub" geometry={comboTub.bowl} castShadow={false} />
        </>
      )}

      {/* the two things that are always in a real shower niche */}
      {N && nicheAt && budget.props && (
        <group position={[nicheAt.position[0], nicheAt.position[1] + 0.012, nicheAt.position[2]]} rotation={nicheAt.rotation}>
          <group position={[0, 0, -N.depth / 2]}>
            <Prop util="ceramic-matte" geometry={soapDispenser()} position={[-Math.min(0.075, N.width * 0.3), 0, 0]} scale={[0.95, 0.95, 0.95]} castShadow={false} />
            <Prop util="white-plastic" geometry={filletBox(0.062, Math.min(0.175, N.height - 0.03), 0.062, 0.014, 2)} position={[Math.min(0.055, N.width * 0.22), Math.min(0.088, (N.height - 0.03) / 2), 0]} castShadow={false} />
          </group>
        </group>
      )}
      {wantBench && budget.props && (
        <Prop util="towel" geometry={foldedTowel(Math.min(0.26, benchW - 0.06), Math.min(0.20, benchD - 0.08), 2)} position={[benchX, benchH + 0.014, benchZ]} castShadow={false} />
      )}
    </OnWall>
  );
}
