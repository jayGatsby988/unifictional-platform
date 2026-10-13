'use client';
/**
 * Décor — what a bathroom photograph shows that is not a fixture, and that
 * makes the twin read as THAT bathroom: floating shelves with what sits on
 * them, plants by form, framed art, the rug, the window treatment.
 *
 * Everything is placed by `layout.ts#solveDecor`; this file only draws. A
 * shelf that matches the vanity is a <Surface/> so it swaps with the finish;
 * the rest are props on fixed or procedural materials. Shelf styling follows
 * the detail tier the way the accessories do — the shelves and the plants
 * themselves are never dropped, because they are the point.
 */
import { useMemo } from 'react';
import type * as THREE from 'three';
import { Box3, Vector3 } from 'three';
import { worldPlane } from '@/components/scene/geometry';
import { InstancedSurface, Prop, Surface } from '@/components/scene/Surface';
import { makeProceduralMaterial, tintedMetal } from '@/components/scene/materials';
import { chamferCylinder, mergeDetail, transformed, type InstanceTransform } from '@/components/scene/detail';
import { OnWall } from './OnWall';
import {
  blinds, bookStack, candle, curtainGeometry, curtainRod, hangingCords, jar, pictureFrame, plantFoliage, plantPot,
  rolledTowel, rollerShade, romanShade, rugSlab, shelfBoards, shelfBrackets, shelfCase, shelfStyling, tumbler, wrappedCanvas,
  type ShelfItem,
} from './helpers';
import { tileOffsetAt } from './tile-height';
import { shelfFootprint } from '../shelf-frame';
import { TIER_BUDGET, useDetailTier } from './quality';
import type { BathLayout, LArt, LPlant, LRug, LShelf, LTreatment } from './layout';

/** Muted prints — nothing that would fight the finishes the contractor is selling. */
const ART_PALETTE = ['#8a9a8b', '#c9b79c', '#5b6770', '#b7a58f', '#7c8c99', '#a58a72'];
const FRAME_HEX: Record<LArt['frame'], string> = { black: '#1f1f1f', wood: '#7a5a3a', white: '#f2f0ea', none: '#f2f0ea' };

function useOak(colorHex: string | null = null, enabled = true) {
  return useMemo(() => enabled ? makeProceduralMaterial(
    colorHex ? `decor-shelf-observed-${colorHex.slice(1)}` : 'decor-shelf-oak', 'wood',
    { color: colorHex ?? '#b98f5e', colorAlt: colorHex ?? '#d2b283', grain: colorHex ? '#30261c' : '#6a4a2c', figure: 'straight', spanM: 1.2, contrast: 0.55, pores: 0.4 },
    { color: colorHex ?? '#b98f5e', roughness: 0.5, micro: 'wood' },
  ) : undefined, [colorHex, enabled]);
}
function useLinen() {
  return useMemo(() => makeProceduralMaterial(
    'decor-shade-linen', 'fabric',
    { color: '#e6e0d4', colorAlt: '#d8d0c2', weave: 'plain', threadM: 0.0016, slub: 0.5 },
    { roughness: 0.9, sheen: 0.4, micro: 'fabric' },
  ), []);
}

export function Decor({ L }: { L: BathLayout }) {
  const tier = useDetailTier();
  const budget = TIER_BUDGET[tier];
  const D = L.decor;
  return (
    <group name="decor">
      {D.shelves.map((s, i) => <Shelf key={`shelf-${i}`} L={L} s={s} index={i} styled={budget.props} />)}
      {D.art.map((a, i) => <Art key={`art-${i}`} L={L} a={a} index={i} />)}
      {D.plants.map((p, i) => <PlantMesh key={`plant-${i}`} L={L} p={p} />)}
      {D.rug && <Rug r={D.rug} />}
      {D.treatments.map((t) => <Treatment key={t.openingId} L={L} t={t} slats={budget.courses > 0 ? 60 : 24} />)}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------
function Shelf({ L, s, index, styled }: { L: BathLayout; s: LShelf; index: number; styled: boolean }) {
  const oak = useOak(s.finishColorHex, s.material === 'wood');
  const observedPaint = useMemo(() => s.finishColorHex && (s.material === 'white' || s.material === 'black') ? makeProceduralMaterial(`decor-shelf-paint-${s.finishColorHex.slice(1)}`, 'painted-wall', { color: s.finishColorHex }, { color: s.finishColorHex, roughness: 0.42, micro: 'paint' }) : null, [s.finishColorHex, s.material]);
  const z = s.standoff;
  const orientation = shelfFootprint(s);
  const enclosure = s.enclosure;
  const side = enclosure?.panelThickness ?? 0, rear = enclosure?.backPanel ? side : 0;
  const innerWidth = s.width - side * 2, innerDepth = s.depth - rear;
  const geo = useMemo(() => ({
    boards: enclosure ? shelfCase(s.width, s.depth, s.count, s.spacing, s.thickness, enclosure.top - enclosure.bottom, enclosure.backPanel) : shelfBoards(s.width, s.depth, s.count, s.spacing, s.thickness),
    brackets: !enclosure && s.material === 'black' ? shelfBrackets(s.width, s.depth, s.count, s.spacing) : null,
  }), [s.width, s.depth, s.count, s.spacing, s.material, s.thickness, enclosure]);
  const items = useMemo(() => (styled ? shelfStyling(innerWidth, s.count, s.styled, index) : []), [styled, innerWidth, s.count, s.styled, index]);
  const boards = s.material === 'match-cabinets' ? <Surface slot="vanity_cabinet" geometry={geo.boards} />
    : s.material === 'match-countertop' ? <Surface slot="vanity_top" geometry={geo.boards} />
    : s.material === 'wood' ? <mesh name={enclosure ? `shelf-case-${index}` : `shelf-boards-${index}`} geometry={geo.boards} material={oak} castShadow receiveShadow />
    : observedPaint ? <mesh name={enclosure ? `shelf-case-${index}` : `shelf-boards-${index}`} geometry={geo.boards} material={observedPaint} castShadow receiveShadow />
    : <Prop util={s.material === 'black' ? 'matte-black' : 'white-plastic'} geometry={geo.boards} />;
  return (
    <OnWall insideOnly wall={s.wall} w={L.w} d={L.d} t={s.t}>
      <group position={[0, s.bottom, z + orientation.projection / 2]} rotation={[0, orientation.yaw, 0]}>
      <group position={[0, 0, -s.depth / 2]}>
        {boards}
        {geo.brackets && <Prop util="matte-black" geometry={geo.brackets} castShadow={false} />}
        {items.map((it, i) => (
          <ShelfItemMesh key={i} item={it.item} position={[it.x, it.board * s.spacing + s.thickness, rear + innerDepth / 2]} depth={innerDepth} fit={enclosure ? {
            width: Math.max(0.01, innerWidth - Math.abs(it.x) * 2 - 0.02), depth: innerDepth - 0.02,
            height: (it.board + 1 < s.count ? s.spacing : enclosure.top - s.bottom - it.board * s.spacing - side) - s.thickness - 0.02,
          } : undefined} />
        ))}
      </group>
      </group>
    </OnWall>
  );
}

type ShelfItemGeo =
  | { kind: 'jar'; body: THREE.BufferGeometry; lid: THREE.BufferGeometry }
  | { kind: 'solid'; util: 'ceramic-matte' | 'leather-tan' | 'towel'; geometry: THREE.BufferGeometry }
  | { kind: 'plant'; pot: THREE.BufferGeometry; soil: THREE.BufferGeometry; foliage: THREE.BufferGeometry; potH: number };

function ShelfItemMesh({ item, position, depth, fit }: { item: ShelfItem; position: [number, number, number]; depth: number; fit?: { width: number; height: number; depth: number } }) {
  const g = useMemo<ShelfItemGeo>(() => {
    const potD = Math.min(0.11, depth - 0.04);
    switch (item) {
      case 'jar': { const j = jar(0.085, 0.14); return { kind: 'jar', body: j.body, lid: j.lid }; }
      case 'candle': return { kind: 'solid', util: 'ceramic-matte', geometry: candle(0.07, 0.09) };
      case 'books': return { kind: 'solid', util: 'leather-tan', geometry: bookStack(3, Math.min(0.17, depth + 0.02), Math.min(0.12, depth - 0.03)) };
      case 'tumbler': return { kind: 'solid', util: 'ceramic-matte', geometry: tumbler() };
      case 'plant': return { kind: 'plant', pot: plantPot(potD, potD * 0.85), soil: chamferCylinder(potD * 0.43, 0.008, 0.001, 20), foliage: plantFoliage('succulent', 0.16, { potD }).foliage, potH: potD * 0.85 };
      default: return {
        kind: 'solid', util: 'towel',
        // two rolled towels, one propped on the other, across the board
        geometry: mergeDetail([
          transformed(rolledTowel(Math.min(0.24, depth + 0.04), 0.09), { position: [0, 0.045, 0], rotation: [0, Math.PI / 2, 0] }),
          transformed(rolledTowel(Math.min(0.24, depth + 0.04), 0.09), { position: [0.085, 0.045, 0.004], rotation: [0, Math.PI / 2 + 0.08, 0] }),
        ]),
      };
    }
  }, [item, depth]);
  const scale = useMemo(() => {
    if (!fit) return 1;
    const box = new Box3();
    const add = (geometry: THREE.BufferGeometry, y = 0) => {
      geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox.clone().translate(new Vector3(0, y, 0)));
    };
    if (g.kind === 'jar') { add(g.body); add(g.lid); }
    else if (g.kind === 'plant') { add(g.pot); add(g.soil, g.potH - 0.005); add(g.foliage, g.potH); }
    else add(g.geometry);
    const halfW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
    const halfD = Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
    return Math.max(0.01, Math.min(1, fit.width / Math.max(0.01, halfW * 2), fit.depth / Math.max(0.01, halfD * 2), fit.height / Math.max(0.01, box.max.y)));
  }, [g, fit]);
  return (
    <group position={position} scale={scale}>
      {g.kind === 'jar' && <><Prop util="glass" geometry={g.body} castShadow={false} /><Prop util="light-wood" geometry={g.lid} /></>}
      {g.kind === 'solid' && <Prop util={g.util} geometry={g.geometry} />}
      {g.kind === 'plant' && (
        <>
          <Prop util="ceramic-matte" geometry={g.pot} />
          <Prop util="soil" geometry={g.soil} position={[0, g.potH - 0.012, 0]} castShadow={false} />
          <Prop util="plant" geometry={g.foliage} position={[0, g.potH - 0.01, 0]} castShadow={false} />
        </>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------
function PlantMesh({ L, p }: { L: BathLayout; p: LPlant }) {
  const potH = p.kind === 'floor' ? p.potD * 1.0 : p.potD * 0.85;
  const cordLen = p.kind === 'hanging' ? Math.max(0.1, L.h - 0.03 - (p.y + potH)) : 0;
  const geo = useMemo(() => {
    const f = plantFoliage(p.form, Math.max(0.08, p.size - potH), { potD: p.potD, drop: p.drop });
    return {
      pot: plantPot(p.potD, potH),
      soil: chamferCylinder(p.potD / 2 * 0.86, 0.008, 0.001, 24),
      foliage: f.foliage,
      trunk: f.trunk,
      cords: p.kind === 'hanging' ? hangingCords(p.potD, cordLen) : null,
    };
  }, [p.form, p.size, p.potD, p.drop, p.kind, potH, cordLen]);
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, p.yaw, 0]}>
      <Prop util="ceramic-matte" geometry={geo.pot} />
      <Prop util="soil" geometry={geo.soil} position={[0, potH - 0.012, 0]} castShadow={false} />
      {geo.trunk && <Prop util="dark-wood" geometry={geo.trunk} position={[0, potH - 0.01, 0]} />}
      <Prop util="plant" geometry={geo.foliage} position={[0, potH - 0.01, 0]} castShadow={p.kind === 'floor'} />
      {geo.cords && <Prop util="fabric-linen" geometry={geo.cords} position={[0, potH, 0]} castShadow={false} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------
function Art({ L, a, index }: { L: BathLayout; a: LArt; index: number }) {
  const z = tileOffsetAt(L, a.wall, a.centerY) + 0.001;
  const frameW = a.frame === 'none' ? 0 : 0.03;
  const geo = useMemo(() => ({
    frame: a.frame === 'none' ? null : pictureFrame(a.width, a.height, frameW, 0.03),
    canvas: a.frame === 'none' ? wrappedCanvas(a.width, a.height) : null,
    // a mat inside the frame, and the print inside the mat
    mat: worldPlane(Math.max(0.04, a.width - 2 * frameW - 0.004), Math.max(0.04, a.height - 2 * frameW - 0.004)),
    image: worldPlane(Math.max(0.03, a.width - 2 * frameW - 0.10), Math.max(0.03, a.height - 2 * frameW - 0.10)),
  }), [a.width, a.height, a.frame, frameW]);
  const frameMat = useMemo(() => tintedMetal(FRAME_HEX[a.frame], a.frame === 'black' ? 0.5 : 0.6, a.frame === 'black' ? 0.2 : 0), [a.frame]);
  const imageMat = useMemo(() => tintedMetal(ART_PALETTE[index % ART_PALETTE.length], 0.9, 0), [index]);
  return (
    <OnWall insideOnly wall={a.wall} w={L.w} d={L.d} t={a.t}>
      <group position={[0, a.centerY, z]}>
        {geo.frame && <mesh geometry={geo.frame} material={frameMat} castShadow receiveShadow />}
        {geo.frame && <Prop util="paper" geometry={geo.mat} position={[0, 0, 0.022]} castShadow={false} />}
        {geo.canvas && <mesh geometry={geo.canvas} material={imageMat} castShadow receiveShadow />}
        <mesh geometry={geo.image} material={imageMat} position={[0, 0, geo.frame ? 0.0225 : 0.0355]} castShadow={false} receiveShadow />
      </group>
    </OnWall>
  );
}

// ---------------------------------------------------------------------------
// Rug
// ---------------------------------------------------------------------------
function Rug({ r }: { r: LRug }) {
  const geo = useMemo(() => rugSlab(r.length, r.width, r.style === 'round'), [r.length, r.width, r.style]);
  // a runner by the vanity is a terry bath rug; an area rug is a flat weave
  const mat = useMemo(() => (r.style === 'runner'
    ? makeProceduralMaterial('decor-rug-bath', 'fabric', { color: '#d9d3c7', colorAlt: '#c8c0b2', weave: 'terry', threadM: 0.0035 }, { roughness: 0.97, sheen: 0.5, micro: 'fabric' })
    : makeProceduralMaterial('decor-rug-woven', 'fabric', { color: '#b9ab98', colorAlt: '#8f826f', weave: 'basket', threadM: 0.006 }, { roughness: 0.95, sheen: 0.35, micro: 'fabric' })), [r.style]);
  return <mesh geometry={geo} material={mat} position={[r.x, 0.0005, r.z]} rotation={[0, r.yaw, 0]} castShadow={false} receiveShadow />;
}

// ---------------------------------------------------------------------------
// Window treatments
// ---------------------------------------------------------------------------
type TreatmentGeo =
  | { kind: 'roman'; fabric: THREE.BufferGeometry; rail: THREE.BufferGeometry }
  | { kind: 'roller'; fabric: THREE.BufferGeometry; hardware: THREE.BufferGeometry }
  | { kind: 'blinds'; rail: THREE.BufferGeometry; slat: THREE.BufferGeometry; transforms: InstanceTransform[] }
  | { kind: 'cafe'; rod: THREE.BufferGeometry; panel: THREE.BufferGeometry; rodY: number }
  | { kind: 'curtains'; rod: THREE.BufferGeometry; panels: THREE.BufferGeometry };

function Treatment({ L, t, slats }: { L: BathLayout; t: LTreatment; slats: number }) {
  const linen = useLinen();
  const roller = useMemo(() => makeProceduralMaterial('decor-shade-roller', 'fabric', { color: '#f1efe9', colorAlt: '#e9e6df', weave: 'plain', threadM: 0.0008 }, { roughness: 0.8, micro: 'fabric' }), []);
  // outside mount: the head sits above the casing and everything stands off it
  const head = t.sill + t.height + 0.10;
  const z = tileOffsetAt(L, t.wall, head) + 0.024;
  const outer = t.width + 0.16;
  const g = useMemo<TreatmentGeo>(() => {
    switch (t.kind) {
      case 'roman-shade': return { kind: 'roman', ...romanShade(outer, t.height * 0.45 + 0.12) };
      case 'roller': return { kind: 'roller', ...rollerShade(outer, t.height * 0.4 + 0.10) };
      case 'blinds': return { kind: 'blinds', ...blinds(outer, t.height * 0.7 + 0.10, { max: slats }) };
      case 'cafe-curtain': {
        const rodY = t.sill + t.height * 0.55;
        return { kind: 'cafe', rod: curtainRod(t.width + 0.12), panel: curtainGeometry(t.width + 0.08, Math.max(0.15, rodY - t.sill - 0.01), 0.006, Math.max(3, Math.round(t.width / 0.11)), 0.022), rodY };
      }
      default: {
        const bottom = t.sill > 1.2 ? t.sill - 0.15 : 0.02;
        const panelW = Math.max(0.25, t.width * 0.35);
        const panelH = Math.max(0.3, head + 0.08 - 0.02 - bottom);
        const panel = curtainGeometry(panelW, panelH, 0.008, Math.max(3, Math.round(panelW / 0.10)), 0.03);
        return {
          kind: 'curtains',
          rod: curtainRod(t.width + 0.6),
          panels: mergeDetail([-1, 1].map((sx) => transformed(panel, { position: [sx * (t.width / 2 + 0.02 + panelW / 2), bottom, 0] }))),
        };
      }
    }
  }, [t.kind, t.width, t.height, t.sill, head, outer, slats]);
  return (
    <OnWall insideOnly wall={t.wall} w={L.w} d={L.d} t={t.t}>
      {g.kind === 'roman' && (
        <group position={[0, head, z]}>
          <mesh geometry={g.fabric} material={linen} castShadow receiveShadow />
          <Prop util="white-plastic" geometry={g.rail} castShadow={false} />
        </group>
      )}
      {g.kind === 'roller' && (
        <group position={[0, head, z]}>
          <mesh geometry={g.fabric} material={roller} castShadow receiveShadow />
          <Prop util="white-plastic" geometry={g.hardware} castShadow={false} />
        </group>
      )}
      {g.kind === 'blinds' && (
        <group position={[0, head, z]}>
          <Prop util="white-plastic" geometry={g.rail} castShadow={false} />
          <InstancedSurface slot="hardware" util="white-plastic" inert geometry={g.slat} transforms={g.transforms} castShadow={false} />
        </group>
      )}
      {g.kind === 'cafe' && (
        <group position={[0, 0, z + 0.02]}>
          <Surface slot="hardware" inert geometry={g.rod} position={[0, g.rodY, 0.03]} />
          <mesh geometry={g.panel} material={linen} position={[0, t.sill + 0.01, 0.03]} castShadow receiveShadow />
        </group>
      )}
      {g.kind === 'curtains' && (
        <group position={[0, 0, z + 0.04]}>
          <Surface slot="hardware" inert geometry={g.rod} position={[0, head + 0.08, 0.06]} />
          <mesh geometry={g.panels} material={linen} position={[0, 0, 0.06]} castShadow receiveShadow />
        </group>
      )}
    </OnWall>
  );
}
