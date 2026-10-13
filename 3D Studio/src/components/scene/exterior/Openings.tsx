'use client';
/**
 * Openings for an exterior elevation. Everything is expressed in the wall's
 * local frame (x along the elevation, y from grade, +z outward), so the parent
 * <Elevation/> only has to place one group.
 *
 * What a real opening has, and what is modelled here:
 *   jamb + head returning into the wall thickness (so the glass is set BACK)
 *   brickmould casing with a mitred head and a drip cap over it
 *   a projecting stool with a drip kerf, and an apron with scribed ears
 *   sash with real stile/rail widths, a meeting rail and the style's muntins
 *   glass set behind the sash, with a dark interior so it reads as a room
 *   shutters hinged outside the casing, with their pintles
 * and for doors: panels with real reveals, a handleset with screws, a deadbolt,
 * a kick plate, a threshold and a sill pan.
 */
import * as THREE from 'three';
import { useMemo } from 'react';
import { worldPlane } from '@/components/scene/geometry';
import { Prop, Surface } from '@/components/scene/Surface';
import { doorPanel, transformed, screwHead } from '@/components/scene/detail';
import { ft } from '@/lib/units';
import { box, merged } from './helpers';
import {
  brickmould, cbox, sillApron, sashUnit, masonrySill, entryHardware, garageHardware, shutterPanel,
} from './detail-ext';
import type { LDoor, LWindow } from './layout';

const GLASS_Z = -0.006;
const BACKING_Z = -0.1;
/**
 * Openings are kept at least `trimW + 0.35 ft` (~0.23 m) from a wall's ends by
 * the layout solver, so a 0.2 m margin can never poke out through the adjoining
 * elevation — which would read as a black slab growing out of the house.
 */
const BACKING_MARGIN = 0.4;

/** Dark plane just inside the opening so the glass reads as a real room. */
function Backing({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const geo = useMemo(() => worldPlane(w + BACKING_MARGIN, h + BACKING_MARGIN), [w, h]);
  return <Prop util="rubber" geometry={geo} position={[x, y, BACKING_Z]} castShadow={false} receiveShadow={false} />;
}

/** Jamb + head returns, so an opening has real depth instead of being a decal. */
function Returns({ x, y, w, h, depth = 0.13 }: { x: number; y: number; w: number; h: number; depth?: number }) {
  const g = useMemo(() => {
    const side = cbox(0.02, h, depth, 0.0015);
    const head = cbox(w, 0.02, depth, 0.0015);
    const l = side.clone(); l.translate(-w / 2 + 0.01, 0, -depth / 2);
    const r = side.clone(); r.translate(w / 2 - 0.01, 0, -depth / 2);
    const t = head.clone(); t.translate(0, h / 2 - 0.01, -depth / 2);
    const b = head.clone(); b.translate(0, -h / 2 + 0.01, -depth / 2);
    return merged([l, r, t, b]);
  }, [w, h, depth]);
  return <Surface slot="window_frames" inert geometry={g} position={[x, y, 0]} receiveShadow />;
}

export function WindowUnit({ w: win, baseY, trimW, masonry = false }: {
  w: LWindow; baseY: number; trimW: number; masonry?: boolean;
}) {
  const yc = baseY + win.y + win.h / 2;
  const g = useMemo(() => ({
    sash: sashUnit(win.w, win.h, win.style),
    casing: masonry ? null : brickmould(win.w, win.h, trimW, { profile: 'brickmould', dripCap: true }),
    sill: masonry ? masonrySill(win.w + trimW * 2 + 0.06) : sillApron(win.w + trimW * 2 + 0.06, trimW),
    glass: worldPlane(win.w - 0.11, win.h - 0.11),
    shutter: win.shutters ? shutterPanel(Math.max(0.24, win.w * 0.52), win.h) : null,
  }), [win.w, win.h, win.style, win.shutters, trimW, masonry]);

  // shutters hang outside the casing, the way they would be hinged in reality
  const shutterW = Math.max(0.24, win.w * 0.52);
  const shutterX = win.w / 2 + trimW + shutterW / 2 + 0.02;
  const pintle = useMemo(() => {
    if (!win.shutters) return null;
    const parts: THREE.BufferGeometry[] = [];
    for (const y of [win.h * 0.34, -win.h * 0.34]) {
      const p = box(0.05, 0.014, 0.03); p.translate(0, y, 0.015);
      parts.push(p);
      parts.push(transformed(screwHead(6), { position: [-0.018, y, 0.03], rotation: [Math.PI / 2, 0, 0] }));
    }
    return merged(parts);
  }, [win.shutters, win.h]);

  return (
    <group>
      <Returns x={win.x} y={yc} w={win.w} h={win.h} />
      {g.casing && <Surface slot="trim" inert geometry={g.casing} position={[win.x, baseY + win.y, 0.004]} castShadow />}
      <Surface slot="trim" inert geometry={g.sill} position={[win.x, baseY + win.y - 0.01, 0.006]} castShadow />
      <Surface slot="window_frames" geometry={g.sash} position={[win.x, yc, 0.004]} castShadow />
      <Prop util="window-glass" geometry={g.glass} position={[win.x, yc, GLASS_Z]} castShadow={false} receiveShadow={false} />
      <Backing x={win.x} y={yc} w={win.w} h={win.h} />
      {g.shutter && (
        <>
          <Surface slot="siding_accent" inert geometry={g.shutter} position={[win.x - shutterX, yc, 0.032]} castShadow />
          <Surface slot="siding_accent" inert geometry={g.shutter} position={[win.x + shutterX, yc, 0.032]} castShadow />
          {pintle && (
            <>
              <Prop util="black-metal" geometry={pintle} position={[win.x - win.w / 2 - trimW, yc, 0.03]} castShadow={false} />
              <Prop util="black-metal" geometry={pintle} position={[win.x + win.w / 2 + trimW, yc, 0.03]} castShadow={false} />
            </>
          )}
        </>
      )}
    </group>
  );
}

/**
 * Entry / side door: a real raised-panel slab with stiles, rails and reveals
 * (from the engine's `doorPanel`), a handleset with a deadbolt, a kick plate,
 * a threshold with a sill pan, and jamb returns.
 */
function EntryDoor({ d, baseY, trimW }: { d: LDoor; baseY: number; trimW: number }) {
  const slabW = d.w - 0.055, slabH = d.h - 0.04;
  const hw = useMemo(() => entryHardware(), []);
  const g = useMemo(() => ({
    panel: doorPanel('raised', slabW, slabH, { thickness: 0.045, rail: 0.14, stile: 0.13 }),
    casing: brickmould(d.w, d.h, trimW, { profile: 'brickmould', dripCap: true }),
    threshold: (() => {
      const sill = cbox(d.w + 0.11, 0.032, 0.2, 0.003);
      sill.rotateX(-0.06); sill.translate(0, 0.016, 0.06);
      const pan = cbox(d.w + 0.13, 0.018, 0.22, 0.002); pan.translate(0, 0.002, 0.06);
      return merged([sill, pan]);
    })(),
    kick: hw.kick(slabW),
  }), [d.w, d.h, slabW, slabH, trimW, hw]);
  const yc = baseY + d.h / 2;

  return (
    <group>
      <Returns x={d.x} y={yc} w={d.w} h={d.h} depth={0.15} />
      <Surface slot="trim" inert geometry={g.casing} position={[d.x, baseY, 0.004]} castShadow />
      <Surface slot="trim" inert geometry={g.threshold} position={[d.x, baseY - 0.01, 0.02]} castShadow />
      <Surface slot="front_door" geometry={g.panel.body} position={[d.x, yc, -0.012]} castShadow />
      {g.panel.glass && (
        <Prop util="window-glass" geometry={g.panel.glass} position={[d.x, yc, -0.012]} castShadow={false} receiveShadow={false} />
      )}
      <Prop util="matte-black" geometry={g.kick} position={[d.x, baseY + 0.15, 0.014]} castShadow={false} />
      <Prop util="oil-rubbed-bronze" geometry={hw.lock} position={[d.x + slabW / 2 - 0.1, baseY + Math.min(1.06, d.h * 0.44), 0.012]} />
      <Backing x={d.x} y={yc} w={d.w} h={d.h} />
    </group>
  );
}

/** Patio / french door: glazed leaves in a frame with a centre stile. */
function GlazedDoor({ d, baseY, trimW }: { d: LDoor; baseY: number; trimW: number }) {
  const leaves = d.w > ft(7) ? 3 : 2;
  const g = useMemo(() => {
    const rail = 0.075, leafW = d.w / leaves, z = 0.026;
    const parts: THREE.BufferGeometry[] = [];
    const add = (bw: number, bh: number, bd: number, x: number, y: number) => {
      const b = cbox(bw, bh, bd, 0.0016); b.translate(x, y, z); parts.push(b);
    };
    add(d.w, rail, 0.07, 0, d.h - rail / 2);                    // head
    add(d.w, rail * 1.5, 0.07, 0, rail * 0.75);                 // bottom rail
    for (let i = 0; i <= leaves; i++) {
      const stile = i === 0 || i === leaves ? rail : rail * 0.9;
      add(stile, d.h, 0.07, -d.w / 2 + leafW * i, d.h / 2);     // jambs + centre stile
    }
    for (let i = 0; i < leaves; i++) {
      add(leafW - rail, rail * 0.62, 0.05, -d.w / 2 + leafW * (i + 0.5), d.h * 0.44);
    }
    const pull = (() => {
      const bar = cbox(0.026, 0.4, 0.026, 0.002);
      const a = cbox(0.03, 0.05, 0.05, 0.002); a.translate(0, 0.2, -0.03);
      const b = a.clone(); b.translate(0, -0.4, 0);
      return merged([bar, a, b]);
    })();
    return {
      sash: merged(parts),
      casing: brickmould(d.w, d.h, trimW, { profile: 'brickmould', dripCap: true }),
      glass: worldPlane(d.w - 0.12, d.h - 0.18),
      pull,
      threshold: (() => {
        const s = cbox(d.w + 0.1, 0.03, 0.19, 0.003); s.rotateX(-0.05); s.translate(0, 0.015, 0.06);
        return s;
      })(),
    };
  }, [d.w, d.h, leaves, trimW]);
  const yc = baseY + d.h / 2;
  return (
    <group>
      <Returns x={d.x} y={yc} w={d.w} h={d.h} depth={0.15} />
      <Surface slot="trim" inert geometry={g.casing} position={[d.x, baseY, 0.004]} castShadow />
      <Surface slot="trim" inert geometry={g.threshold} position={[d.x, baseY - 0.008, 0.02]} />
      <Surface slot="window_frames" geometry={g.sash} position={[d.x, baseY, 0]} castShadow />
      <Prop util="window-glass" geometry={g.glass} position={[d.x, yc + 0.02, GLASS_Z + 0.01]} castShadow={false} receiveShadow={false} />
      <Prop util="matte-black" geometry={g.pull} position={[d.x + d.w / (leaves * 2) - 0.07, baseY + d.h * 0.46, 0.07]} />
      <Backing x={d.x} y={yc} w={d.w} h={d.h} />
    </group>
  );
}

/**
 * Sectional garage door: embossed panels with a real reveal between sections,
 * a row of lites in the top section, hinges at every joint and a lift handle.
 */
export function GarageDoorUnit({ d, trimW }: { d: LDoor; trimW: number }) {
  const rows = Math.max(3, Math.round(d.h / 0.53));
  const g = useMemo(() => {
    const rowH = d.h / rows;
    const cols = Math.max(2, Math.round(d.w / 0.95));
    const slabParts: THREE.BufferGeometry[] = [];
    const emboss: THREE.BufferGeometry[] = [];
    const t = 0.05;
    for (let i = 0; i < rows; i++) {
      const y = rowH * (i + 0.5);
      // the section itself, chamfered so each joint catches a highlight
      const p = cbox(d.w, rowH - 0.014, t, 0.0022);
      p.translate(0, y, t / 2);
      slabParts.push(p);
      // raised panel field inside each section, with a bevelled surround
      for (let c = 0; c < cols; c++) {
        const cw = (d.w - 0.1 * (cols + 1)) / cols;
        if (cw < 0.14) break;
        const cx = -d.w / 2 + 0.1 * (c + 1) + cw * (c + 0.5);
        if (i === rows - 1) continue; // the top row carries the lites instead
        const surround = cbox(cw + 0.03, rowH - 0.14, 0.008, 0.002);
        surround.translate(cx, y, t + 0.004);
        const field = cbox(cw, rowH - 0.18, 0.014, 0.003);
        field.translate(cx, y, t + 0.008);
        emboss.push(surround, field);
      }
    }
    // jambs and the header stop the door reading as a sticker on the wall
    const jambL = cbox(0.055, d.h, 0.075, 0.0025); jambL.translate(-d.w / 2 - 0.027, d.h / 2, 0.037);
    const jambR = jambL.clone(); jambR.translate(d.w + 0.055, 0, 0);
    const header = cbox(d.w + 0.11, 0.055, 0.075, 0.0025); header.translate(0, d.h + 0.027, 0.037);
    slabParts.push(jambL, jambR, header);

    // lites in the top section
    const y = d.h - rowH / 2;
    const glassParts: THREE.BufferGeometry[] = [];
    const frameParts: THREE.BufferGeometry[] = [];
    for (let c = 0; c < cols; c++) {
      const cw = (d.w - 0.1 * (cols + 1)) / cols;
      if (cw < 0.14) break;
      const cx = -d.w / 2 + 0.1 * (c + 1) + cw * (c + 0.5);
      const gh = Math.min(rowH - 0.2, 0.36);
      const gl = new THREE.PlaneGeometry(cw - 0.07, gh);
      gl.translate(cx, 0, 0.056);
      glassParts.push(gl);
      const ring = brickmould(cw - 0.07, gh, 0.032, { profile: 'modern-casing', dripCap: false }).clone();
      ring.translate(cx, -gh / 2, 0.05);
      frameParts.push(ring);
    }

    // hinges and rollers at every panel joint
    const hwParts: THREE.BufferGeometry[] = [];
    for (let i = 1; i < rows; i++) {
      const jy = rowH * i;
      for (const sx of [-1, 1]) {
        const plate = cbox(0.09, 0.075, 0.01, 0.0015);
        plate.translate(sx * (d.w / 2 - 0.07), jy, t + 0.005);
        hwParts.push(plate);
        hwParts.push(transformed(screwHead(6), { position: [sx * (d.w / 2 - 0.07), jy + 0.024, t + 0.011], rotation: [Math.PI / 2, 0, 0] }));
      }
    }

    return {
      slab: merged(slabParts),
      emboss: emboss.length ? merged(emboss) : null,
      casing: brickmould(d.w + 0.11, d.h + 0.03, trimW, { profile: 'brickmould', dripCap: true }),
      lites: { glass: glassParts.length ? merged(glassParts) : null, frames: frameParts.length ? merged(frameParts) : null, y },
      hinges: hwParts.length ? merged(hwParts) : null,
      handle: garageHardware(d.w, rows),
    };
  }, [d.w, d.h, rows, trimW]);

  return (
    <group>
      <Surface slot="trim" inert geometry={g.casing} position={[d.x, 0, 0.004]} castShadow />
      <Surface slot="garage_door" geometry={g.slab} position={[d.x, 0, 0.006]} castShadow />
      {g.emboss && <Surface slot="garage_door" inert geometry={g.emboss} position={[d.x, 0, 0.006]} castShadow />}
      {g.lites.frames && <Surface slot="window_frames" inert geometry={g.lites.frames} position={[d.x, g.lites.y, 0.006]} />}
      {g.lites.glass && <Prop util="window-glass" geometry={g.lites.glass} position={[d.x, g.lites.y, 0.008]} castShadow={false} receiveShadow={false} />}
      {g.hinges && <Prop util="anodized" geometry={g.hinges} position={[d.x, 0, 0.006]} castShadow={false} />}
      <Prop util="matte-black" geometry={g.handle} position={[d.x, d.h * 0.22, 0.056]} />
      <Backing x={d.x} y={d.h * 0.55} w={d.w} h={d.h} />
    </group>
  );
}

export function DoorUnit({ d, floorY, trimW }: { d: LDoor; floorY: number; trimW: number }) {
  if (d.kind === 'garage') return <GarageDoorUnit d={d} trimW={trimW} />;
  if (d.kind === 'patio' || d.kind === 'french') return <GlazedDoor d={d} baseY={floorY} trimW={trimW} />;
  return <EntryDoor d={d} baseY={floorY} trimW={trimW} />;
}

