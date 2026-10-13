'use client';
/**
 * Toilet — a believable silhouette per style rather than a stack of boxes.
 *
 * The bowl is a lathed oval shell with a rolled rim, the skirt is filleted and
 * meets the floor on a real foot, and the tank carries a lid that OVERHANGS on
 * every side (that shadow line is what the eye reads as a toilet). Every style
 * gets a seat and closed lid with hinges and bumpers, its flush control — trip
 * lever, top button or a wall flush plate — and a supply line running down to
 * an angle stop.
 */
import { useMemo } from 'react';
import { Prop, Surface } from '@/components/scene/Surface';
import { chamferCylinder, filletBox, mergeDetail, transformed } from '@/components/scene/detail';
import { OnWall } from './OnWall';
import { FINISH_UTIL } from './finish';
import { flushPlate, toiletBody, toiletSeat, toiletSupply, tripLever } from './helpers';
import { tileOffsetAt } from './RoomShell';
import type { BathLayout, LToilet } from './layout';

export function Toilet({ L, t }: { L: BathLayout; t: LToilet }) {
  const z0 = t.style === 'wall-hung' ? 0.0 : 0.022;
  const wallZ = tileOffsetAt(L, t.wall, 0.35);
  const body = useMemo(() => toiletBody(t.style), [t.style]);
  const seat = useMemo(() => toiletSeat(t.style), [t.style]);
  const trim = useMemo(() => {
    const parts = [] as ReturnType<typeof mergeDetail>[];
    if (t.style === 'two-piece') {
      parts.push(transformed(tripLever(), { position: [-0.170, 0.720, 0.205], rotation: [0, Math.PI / 2, 0] }));
      parts.push(transformed(toiletSupply(), { position: [0.150, 0.560, -z0 + 0.002] }));
    } else if (t.style === 'one-piece') {
      parts.push(transformed(chamferCylinder(0.026, 0.010, 0.0012, 20), { position: [0.100, 0.722, 0.100] }));
      parts.push(transformed(chamferCylinder(0.018, 0.007, 0.0010, 18), { position: [0.100, 0.727, 0.100] }));
      parts.push(transformed(toiletSupply(), { position: [0.150, 0.470, -z0 + 0.002] }));
    } else if (t.style === 'smart') {
      parts.push(transformed(chamferCylinder(0.021, 0.008, 0.0010, 18), { position: [0, 0.612, 0.100] }));
      parts.push(transformed(toiletSupply(), { position: [0.150, 0.400, -z0 + 0.002] }));
    }
    return parts.length ? mergeDetail(parts) : null;
  }, [t.style, z0]);
  const panel = useMemo(() => (t.style === 'smart'
    ? mergeDetail([
      transformed(filletBox(0.030, 0.070, 0.140, 0.008, 2), { position: [0.196, 0.372, 0.230] }),
      transformed(filletBox(0.006, 0.048, 0.100, 0.003, 2), { position: [0.213, 0.372, 0.230] }),
    ])
    : null), [t.style]);

  // The trip lever, the seat hinges and a wall-hung flush plate are the only
  // metal on a toilet, and the contract lets the client call them out as a
  // different metal from the room's `fixtures` slot (an oil-rubbed lever on a
  // matte-black bathroom is a real thing people specify). Null = follow the
  // slot, exactly as the shower's hardware and the tub's filler do.
  const finish = t.trimFinish ? FINISH_UTIL[t.trimFinish] : undefined;

  return (
    <OnWall wall={t.wall} w={L.w} d={L.d} t={t.t}>
      <group position={[0, 0, z0 + wallZ]}>
        <Prop util="porcelain" geometry={body} />
        <Prop util="white-plastic" geometry={seat.seat} castShadow={false} />
        <Surface slot="fixtures" inert geometry={seat.hinges} util={finish} castShadow={false} />
        {trim && <Surface slot="fixtures" inert geometry={trim} util={finish} />}
        {panel && <Prop util="matte-black" geometry={panel} castShadow={false} />}
        {t.style === 'wall-hung' && (
          <Surface slot="fixtures" inert geometry={flushPlate()} util={finish} position={[0, 1.05, 0]} />
        )}
      </group>
    </OnWall>
  );
}
