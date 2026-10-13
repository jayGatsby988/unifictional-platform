'use client';
/**
 * One building elevation, built the way a real wall is assembled rather than as
 * a painted rectangle:
 *
 *   field panel (openings cut out)  →  the priced siding surface
 *   cladding relief                 →  a shadow line under every lap course, or
 *                                      real battens, shake butts, standing
 *                                      seams, masonry joints — chosen from the
 *                                      MATERIAL the user has selected, so a
 *                                      finish swap re-details the wall
 *   exposed foundation + water table with a sloped wash and a drip kerf
 *   frieze band at each storey line and under the eave
 *   corner boards with a caulk bead against the field
 *   gable / shed infill up to the roof underside
 *   openings, then the wall-mounted fittings (hose bib, meter, vent, numbers)
 *
 * The face is built with `wallFace()`, which is single sided. Exterior walls
 * face OUTWARD, so the camera always sees the near walls of the house and never
 * the inside — the opposite of the interior "dollhouse" rooms.
 */
import { useMemo } from 'react';
import { wallFace } from '@/components/scene/geometry';
import { Prop, Surface } from '@/components/scene/Surface';
import { ft } from '@/lib/units';
import { polyPanel, solid } from './helpers';
import {
  claddingRelief, claddingReliefPoly, cornerBoardPair, waterTable, soldierCourse, louverVent,
  type Hole,
} from './detail-ext';
import { useCladding, useDetailTier } from './context';
import { DoorUnit, WindowUnit } from './Openings';
import type { LBlock, LElevation } from './layout';

/** Where a door starts in world y: garage doors sit on the slab at grade. */
export function doorBaseY(kind: string, floorY: number): number {
  return kind === 'garage' ? 0 : floorY;
}

export function Elevation({ block, elev, trimW, accentFace = false }: {
  block: LBlock; elev: LElevation; trimW: number;
  /** render the field siding in `siding_accent` (wing faces read as a second volume) */
  accentFace?: boolean;
}) {
  const { floorY, eaveY } = block;
  const wallH = eaveY - floorY;
  const tier = useDetailTier();
  const fieldSlot = accentFace && !elev.sidingId ? 'siding_accent' : 'siding_primary';
  const clad = useCladding(fieldSlot, elev.sidingId);

  const holes = useMemo<Hole[]>(() => {
    const out: Hole[] = [];
    for (const w of elev.windows) out.push({ x: w.x, y: w.y, w: w.w + trimW * 2, h: w.h + trimW * 2 });
    for (const d of elev.doors) {
      const base = doorBaseY(d.kind, floorY);
      const y = Math.max(0, base - floorY);
      const h = Math.max(0.3, base + d.h - floorY - y);
      out.push({ x: d.x, y, w: d.w + trimW * 2, h: h + trimW });
    }
    return out;
  }, [elev.windows, elev.doors, floorY, trimW]);

  const geo = useMemo(() => {
    const sidingHoles: Hole[] = [];
    const foundationHoles: Hole[] = [];
    for (const w of elev.windows) sidingHoles.push({ x: w.x, y: w.y, w: w.w, h: w.h });
    for (const d of elev.doors) {
      const base = doorBaseY(d.kind, floorY);
      const top = base + d.h;
      const y = Math.max(0, base - floorY);
      const h = Math.max(0.3, top - floorY - y);
      sidingHoles.push({ x: d.x, y, w: d.w, h });
      if (floorY > 0.02) foundationHoles.push({ x: d.x, y: 0, w: d.w, h: floorY + 0.05 });
    }
    return {
      siding: wallFace(elev.len, Math.max(0.3, wallH), sidingHoles),
      foundation: floorY > 0.02 ? wallFace(elev.len, floorY, foundationHoles) : null,
      top: elev.top ? polyPanel(elev.top) : null,
      frieze: solid(elev.len, ft(0.62), 0.038),
      friezeBed: solid(elev.len, 0.035, 0.06),
      water: floorY > 0.02 ? waterTable(elev.len + 0.02) : null,
    };
  }, [elev, floorY, wallH]);

  // The cladding relief for the field, and again for the gable infill above the
  // eave (a gable end with no courses on it is the classic giveaway).
  const relief = useMemo(
    () => claddingRelief(clad, elev.len, Math.max(0.3, wallH), holes, tier),
    [clad, elev.len, wallH, holes, tier],
  );
  const gableRelief = useMemo(() => {
    if (!elev.top) return null;
    const h = Math.max(...elev.top.map((p) => p[1]));
    if (h < 0.4) return null;
    // clipped to the outline, so no course runs out past the rake board
    return claddingReliefPoly(clad, elev.top, tier === 'high' ? 'balanced' : tier);
  }, [clad, elev.top, tier]);

  const friezeYs = useMemo(() => {
    const out: number[] = [];
    for (let s = 1; s < block.stories; s++) out.push(floorY + block.storyH * s);
    return out;
  }, [block.stories, block.storyH, floorY]);

  // Masonry walls get a soldier course over every opening — the detail that
  // says "brick" louder than any texture does.
  const soldiers = useMemo(() => {
    if (clad.kind !== 'masonry') return [];
    const out: Array<{ key: string; x: number; y: number; w: number }> = [];
    for (const w of elev.windows) out.push({ key: w.id, x: w.x, y: floorY + w.y + w.h + trimW * 0.5, w: w.w + trimW * 2 });
    for (const d of elev.doors) out.push({ key: d.id, x: d.x, y: doorBaseY(d.kind, floorY) + d.h + trimW * 0.5, w: d.w + trimW * 2 });
    return out;
  }, [clad.kind, elev.windows, elev.doors, floorY, trimW]);

  // Gable vent: real houses have one, and it breaks up an otherwise blank
  // triangle. Only where the infill is tall enough to take it.
  const gableVent = useMemo(() => {
    if (!elev.gable || !elev.top) return null;
    const h = Math.max(...elev.top.map((p) => p[1]));
    return h > ft(4) ? { y: eaveY + h * 0.42 } : null;
  }, [elev.gable, elev.top, eaveY]);
  const ventGeo = useMemo(() => (gableVent ? louverVent(ft(1.4), ft(1.1)) : null), [gableVent]);

  const sidingProps = elev.sidingId ? { materialId: elev.sidingId } : {};

  return (
    <group position={[elev.frame.cx, 0, elev.frame.cz]} rotation={[0, elev.frame.yaw, 0]}>
      <Surface slot={fieldSlot} geometry={geo.siding} position={[0, floorY, 0]} {...sidingProps} receiveShadow />
      {relief && (
        <Surface slot={fieldSlot} inert geometry={relief} position={[0, floorY, 0.002]} {...sidingProps} castShadow receiveShadow />
      )}
      {geo.foundation && <Surface slot="foundation" geometry={geo.foundation} position={[0, 0, 0.018]} receiveShadow />}
      {geo.water && <Surface slot="trim" inert geometry={geo.water} position={[0, floorY, 0.03]} castShadow />}
      {geo.top && (
        <Surface
          slot={elev.gable ? 'siding_accent' : fieldSlot}
          geometry={geo.top}
          position={[0, eaveY, 0]}
          receiveShadow
        />
      )}
      {geo.top && gableRelief && (
        <Surface slot={elev.gable ? 'siding_accent' : fieldSlot} inert geometry={gableRelief} position={[0, eaveY, 0.002]} receiveShadow />
      )}
      {gableVent && ventGeo && (
        <Surface slot="trim" geometry={ventGeo} position={[0, gableVent.y, 0.01]} castShadow />
      )}
      {friezeYs.map((y, i) => (
        <group key={`frieze-${i}`}>
          <Surface slot="trim" inert geometry={geo.frieze} position={[0, y, 0.026]} castShadow />
          <Surface slot="trim" inert geometry={geo.friezeBed} position={[0, y - ft(0.33), 0.038]} />
        </group>
      ))}
      <Surface slot="trim" inert geometry={geo.frieze} position={[0, eaveY - ft(0.31), 0.026]} castShadow />
      <Surface slot="trim" inert geometry={geo.friezeBed} position={[0, eaveY - ft(0.63), 0.038]} />
      {soldiers.map((s) => (
        <Surface key={`sold-${s.key}`} slot={fieldSlot} inert geometry={soldierCourse(s.w)} position={[s.x, s.y, 0.006]} {...sidingProps} castShadow />
      ))}
      {elev.windows.map((w) => <WindowUnit key={w.id} w={w} baseY={floorY} trimW={trimW} masonry={clad.kind === 'masonry'} />)}
      {elev.doors.map((d) => <DoorUnit key={d.id} d={d} floorY={floorY} trimW={trimW} />)}
    </group>
  );
}

/**
 * Vertical corner boards at each exposed corner of a mass. Chamfered, with the
 * bead that reads as the caulk joint where the siding dies into them.
 *
 * The board's THICKNESS is derived from the cladding, not fixed: a corner board
 * has to stand proud of whatever it terminates, and a 28 mm board against a
 * 40 mm shake wall leaves the course butts poking through the trim at every
 * grazing angle — which reads as a striped post rather than a corner.
 */
export function CornerTrim({ block, trimW }: { block: LBlock; trimW: number }) {
  const h = block.eaveY - block.floorY;
  const clad = useCladding('siding_primary');
  const thick = Math.max(0.028, clad.relief + 0.012);
  const geo = useMemo(() => cornerBoardPair(h, trimW, thick), [h, trimW, thick]);
  const corners = useMemo(() => {
    const hw = block.w / 2, hd = block.d / 2;
    // yaw maps the L's two boards onto the pair of inward directions at each
    // corner (the pair order is chosen so a rotation — not a reflection — works)
    const all: Array<{ x: number; z: number; yaw: number; walls: string[] }> = [
      { x: -hw, z: hd, yaw: Math.PI / 2, walls: ['front', 'left'] },
      { x: hw, z: hd, yaw: Math.PI, walls: ['front', 'right'] },
      { x: hw, z: -hd, yaw: -Math.PI / 2, walls: ['back', 'right'] },
      { x: -hw, z: -hd, yaw: 0, walls: ['back', 'left'] },
    ];
    return all.filter((c) => !block.hidden || !c.walls.includes(block.hidden));
  }, [block.w, block.d, block.hidden]);
  return (
    <group position={[block.cx, block.floorY, block.cz]}>
      {corners.map((c, i) => (
        <Surface key={i} slot="trim" geometry={geo} position={[c.x, 0, c.z]} rotation={[0, c.yaw, 0]} castShadow />
      ))}
    </group>
  );
}

/**
 * The exposed foundation's continuous shadow: a thin recess where the sill
 * plate meets the wall. Cheap, and it stops the mass reading as one extruded
 * block from grade to eave.
 */
export function SillShadow({ block }: { block: LBlock }) {
  const geo = useMemo(
    () => (block.foundation > 0.05 ? solid(block.w + 0.02, 0.02, block.d + 0.02) : null),
    [block.w, block.d, block.foundation],
  );
  if (!geo) return null;
  return <Prop util="rubber" geometry={geo} position={[block.cx, block.floorY - 0.012, block.cz]} castShadow={false} receiveShadow={false} />;
}
