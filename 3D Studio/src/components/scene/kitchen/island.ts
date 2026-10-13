/**
 * Island / peninsula / breakfast bar.
 *
 * An island is the piece of a kitchen people walk around, so every face of it
 * is on camera and every face has to be finished:
 *  - the WORKING side carries the same millwork as the wall runs (built once
 *    facing +z and turned with `rotateYParts`, so hardware that carries its own
 *    X or Z rotation lands correctly);
 *  - the SEATING side is a panelled back — real applied stiles and rails, not a
 *    blank slab — with corbels or turned legs under a deep overhang;
 *  - both ENDS get a finished panel, or a mitred waterfall when the spec asks;
 *  - the top carries the spec's edge profile all the way round.
 *
 * Everything is authored in the island frame (see `parts.ts`).
 */
import type * as THREE from 'three';
import { barPull, chamferBox, cupPull, doorPanel, edgePull, knob, type PanelStyle } from '@/components/scene/detail';
import { slabWithCutouts, type Cutout } from '@/components/scene/bathroom/helpers';
import { inch } from '@/lib/units';
import { compact, prop, rotateYParts, surface, textured, type Look, type Part, type PartOpts, type ProceduralPart, type UtilKind, type Vec3 } from './parts';
import { corbel, islandLeg, panelStrip, stoolParts, toeBoard, caulkBead } from './helpers';
import { planCabinetFronts, type FrontDef } from './millwork';
import { islandEdgeParts } from './counters';
import { DOOR_T, REVEAL, stoolPositions, type KIsland, type KStools, type KitchenLayoutData } from './layout';

const TOE_RECESS = inch(3);

/**
 * `KStools` (layout.ts) carries style / frame / seat. The two contract fields
 * that describe the seat PAD — `decor.stools.seatShape` and `.seatColorHex` —
 * are read here structurally, so the stool draws them the moment `resolveStools`
 * forwards them and draws exactly today's stool until then. Both defaults are
 * null, which is the round tan disc, unchanged.
 */
type StoolLook = KStools & { seatShape?: 'round' | 'square' | null; seatColorHex?: string | null };

interface Section { type: 'door' | 'drawers'; cx: number; width: number; drawerCount: number }

function planSections(len: number): Section[] {
  const n = Math.max(1, Math.min(6, Math.round(len / inch(27))));
  const sw = len / n;
  const out: Section[] = [];
  for (let i = 0; i < n; i++) {
    const isEnd = n >= 3 && (i === 0 || i === n - 1);
    out.push({ type: isEnd ? 'drawers' : 'door', cx: -len / 2 + sw * (i + 0.5), width: sw, drawerCount: isEnd ? 3 : 0 });
  }
  return out;
}

/** The seating side: applied stiles and rails, the way a real island back is built. */
function backPanelParts(L: KitchenLayoutData, isl: KIsland, y0: number, y1: number, z: number): Part[] {
  const h = y1 - y0;
  if (h < inch(6)) return [];
  const n = Math.max(1, Math.min(5, Math.round(isl.len / inch(26))));
  const pw = (isl.len - REVEAL * (n + 1)) / n;
  const style: PanelStyle = (L.doorStyle === 'slab' || L.doorStyle === 'flat' || L.doorStyle === 'open')
    ? 'slab'
    : L.doorStyle === 'glass' ? 'shaker' : (L.doorStyle as PanelStyle);
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const cx = -isl.len / 2 + REVEAL + pw / 2 + i * (pw + REVEAL);
    const parts = doorPanel(style, pw, h - 2 * REVEAL, { thickness: DOOR_T, stile: inch(2.25), rail: inch(2.25), bottomRail: inch(2.75) });
    out.push(surface(`isl-back${i}`, 'island', 'island_cabinets', parts.body, {
      position: [cx, (y0 + y1) / 2, z], rotation: [0, isl.seatSide > 0 ? 0 : Math.PI, 0], inert: true,
    }));
  }
  return out;
}

export function islandParts(L: KitchenLayoutData): Part[] {
  const isl = L.island;
  if (!isl) return [];
  const y0 = L.toeKick;
  const y1 = isl.carcassTop;
  const bodyH = Math.max(0.1, y1 - y0);
  const topY = isl.carcassTop + L.counterT / 2;
  const seat = isl.seatSide;
  const work = -seat as 1 | -1;     // the millwork faces away from the stools
  const out: Part[] = [];

  // --- carcass ------------------------------------------------------------
  out.push(surface('isl-body', 'island', 'island_cabinets',
    chamferBox(isl.len, bodyH, Math.max(0.05, isl.wide - DOOR_T), 0.0012),
    { position: [0, y0 + bodyH / 2, work * DOOR_T / 2] }));

  if (L.toeKick > 0.005) {
    out.push(prop('isl-toe', 'island', 'matte-black',
      toeBoard(isl.len - inch(3), L.toeKick, Math.max(0.02, isl.wide - 2 * TOE_RECESS)),
      { position: [0, L.toeKick / 2, 0], castShadow: false }));
  }

  // --- working-side fronts, authored facing +z then turned ---------------
  const sections = planSections(isl.len);
  const fronts: FrontDef[] = [];
  for (const s of sections) {
    for (const f of planCabinetFronts({ type: s.type, width: s.width - REVEAL, drawerCount: s.drawerCount }, y0, y1)) {
      fronts.push({ ...f, x: f.x + s.cx });
    }
  }
  const faceZ = isl.wide / 2 - DOOR_T / 2;
  const authored: Part[] = [];
  fronts.forEach((f, i) => {
    const style: PanelStyle = L.doorStyle === 'glass' || L.doorStyle === 'open'
      ? 'shaker'
      : (L.doorStyle === 'raised' && f.kind === 'drawer' ? 'shaker' : (L.doorStyle as PanelStyle));
    const parts = doorPanel(style, f.w, f.h, { thickness: DOOR_T, stile: inch(2.25), rail: inch(2.25), bottomRail: f.kind === 'door' ? inch(2.75) : inch(2.25) });
    authored.push(surface(`isl-f${i}`, 'island', 'island_cabinets', parts.body, { position: [f.x, f.y, faceZ] }));
  });
  // hardware: same rules as the wall runs, on the island's own slot
  authored.push(...islandHardware(L, fronts, faceZ));
  out.push(...rotateYParts(authored, work > 0 ? 0 : Math.PI, work > 0 ? '' : 'r'));

  // --- seating side + ends ------------------------------------------------
  out.push(...backPanelParts(L, isl, y0 + REVEAL, y1 - REVEAL, seat * (isl.wide / 2 + DOOR_T / 2)));
  for (const sx of [-1, 1] as const) {
    out.push(surface(`isl-end${sx}`, 'island', 'island_cabinets',
      panelStrip(DOOR_T, bodyH, isl.wide),
      { position: [sx * (isl.len / 2 + DOOR_T / 2), y0 + bodyH / 2, 0], castShadow: false }));
  }

  // --- support under a deep overhang -------------------------------------
  const deep = isl.overhang >= inch(11) && isl.seating > 0;
  if (deep) {
    const legStyle = L.style === 'traditional' || L.style === 'farmhouse' || L.style === 'mediterranean';
    if (legStyle && isl.overhang >= inch(14)) {
      const legH = isl.carcassTop;
      const g = islandLeg(legH, inch(3.5), L.style !== 'farmhouse');
      for (const sx of [-1, 1] as const) {
        out.push(surface(`isl-leg${sx}`, 'island', 'island_cabinets', g, {
          position: [sx * (isl.len / 2 - inch(3)), 0, seat * (isl.wide / 2 + isl.overhang - inch(3))],
        }));
      }
    } else {
      const g = corbel(inch(2.5), inch(7), Math.max(inch(4), isl.overhang - inch(2)), L.style === 'modern' ? 'tapered' : 'scroll');
      const n = Math.max(2, Math.min(4, Math.round(isl.len / inch(36))));
      for (let i = 0; i < n; i++) {
        const x = n === 1 ? 0 : -isl.len / 2 + inch(6) + ((isl.len - inch(12)) * i) / (n - 1);
        out.push(surface(`isl-corb${i}`, 'island', 'island_cabinets', g, {
          position: [x, isl.carcassTop, seat * (isl.wide / 2)],
          rotation: [0, seat > 0 ? 0 : Math.PI, 0], inert: true, castShadow: false,
        }));
      }
    }
  }

  // --- top ----------------------------------------------------------------
  const cut: Cutout[] = [];
  if (L.sink && L.sink.where === 'island') {
    const s = L.sink;
    const cw = Math.min(s.width - inch(1.5), isl.topLen - inch(6));
    const cd = Math.min(s.depth - inch(1.5), isl.topWide - inch(6));
    if (cw > 0.1 && cd > 0.1) cut.push({ x: s.x, z: work * isl.wide * 0.16 - isl.topOffset, w: cw, d: cd, r: inch(1.5) });
  }
  const cooktop = L.appliances.find((a) => a.kind === 'cooktop' && a.wall === 'island');
  if (cooktop) {
    const cw = Math.min(cooktop.width - inch(1), isl.topLen - inch(6));
    const cd = Math.min(cooktop.depth, isl.topWide - inch(6));
    if (cw > 0.1 && cd > 0.1) cut.push({ x: cooktop.x, z: work * isl.wide * 0.14 - isl.topOffset, w: cw, d: cd, r: inch(0.5) });
  }
  out.push(surface('isl-top', 'island', 'island_countertop',
    slabWithCutouts(isl.topLen, L.counterT, isl.topWide, cut, 0.0012),
    { position: [0, topY, isl.topOffset] }));
  out.push(...islandEdgeParts(
    L, 'isl-top', -isl.topLen / 2, isl.topLen / 2, L.counterTopY,
    isl.topOffset + isl.topWide / 2, isl.topOffset - isl.topWide / 2,
  ));

  if (isl.waterfall) {
    for (const sx of [-1, 1] as const) {
      out.push(surface(`isl-wf${sx}`, 'island', 'island_countertop',
        chamferBox(L.counterT, isl.carcassTop, isl.topWide, 0.0012),
        { position: [sx * (isl.topLen / 2 - L.counterT / 2), isl.carcassTop / 2, isl.topOffset] }));
      // the mitre line where the waterfall meets the deck
      out.push(prop(`isl-wfs${sx}`, 'island', 'matte-black', chamferBox(0.0012, L.counterT, isl.topWide, 0), {
        position: [sx * (isl.topLen / 2 - L.counterT), topY, isl.topOffset], castShadow: false, receiveShadow: false,
      }));
    }
  }

  // --- stools -------------------------------------------------------------
  out.push(...islandStools(L, isl));

  // caulk / shadow line where the top meets the carcass on the working side
  out.push(prop('isl-caulk', 'island', 'matte-black', caulkBead(isl.len, 0.0016), {
    position: [0, isl.carcassTop, work * (isl.wide / 2 - 0.001)],
    rotation: [0, work > 0 ? 0 : Math.PI, 0], castShadow: false, receiveShadow: false,
  }));

  return compact(out);
}

/** The frame material for each stool frame word. */
const STOOL_FRAME_UTIL: Record<KStools['frame'], UtilKind> = {
  'light-wood': 'light-wood', 'dark-wood': 'dark-wood', 'black-metal': 'matte-black', brass: 'brushed-brass', white: 'white-plastic',
};

/** A woven rattan / rope seat in a wheat tone: the one seat that needs a weave, not a colour. */
const WOVEN: ProceduralPart = {
  id: 'stool-woven-wheat', kind: 'fabric', tint: '#c8a97a',
  options: { color: '#c8a97a', colorAlt: '#a9875b', threadM: 0.005, weave: 'basket', slub: 0.3, spanM: 0.3, seed: 9 },
  physical: { roughness: 0.9, sheen: 0.2, micro: 'fabric' },
};

/**
 * The stools the layout resolved (`decor.stools`): style, frame and seat from
 * the photo or the room style. Long-side stools sit under the overhang; when
 * the layout found the short end clear, `endSeats` of them go round the end
 * facing the island, the way three or four stools are really arranged.
 */
function islandStools(L: KitchenLayoutData, isl: KIsland): Part[] {
  if (isl.seating <= 0) return [];
  const st = L.decor.stools as StoolLook;
  const metal = st.frame === 'black-metal' || st.frame === 'brass';
  const { seat: seatG, frame: frameG, back: backG } = stoolParts(Math.max(inch(16), isl.seatY), st.style, metal, st.seatShape ?? null);
  const frameUtil = STOOL_FRAME_UTIL[st.frame];
  const seatUtil: UtilKind | null = st.seat === 'woven' ? null
    : st.seat === 'upholstered' ? 'fabric-linen'
      : st.seat === 'leather' ? 'leather-tan'
        : st.seat === 'metal' ? (metal ? frameUtil : 'brushed-nickel')
          : (st.frame === 'light-wood' || st.frame === 'dark-wood' ? frameUtil : 'light-wood');
  // The photo's own leather. `seat: 'leather'` maps to the fixed util
  // 'leather-tan' (#8b5a34) and there is no FinishObservation slot for stools,
  // so `seatColorHex` is the ONLY route a chocolate seat has into the twin.
  // It has met `parseHex` in both normalisers, so it is '#RRGGBB' or null —
  // never a colour word. null keeps the stock util, byte for byte.
  const seatLook: Look | null = st.seatColorHex
    ? { metal: { hex: st.seatColorHex, roughness: st.seat === 'woven' || st.seat === 'upholstered' ? 0.85 : 0.55, metalness: 0 } }
    : seatUtil ? { util: seatUtil } : null;
  const out: Part[] = [];
  const seatPart = (key: string, g: THREE.BufferGeometry, o: PartOpts): Part => (
    seatLook === null ? textured(key, 'island', WOVEN, g, o)
      : 'util' in seatLook ? prop(key, 'island', seatLook.util, g, o)
        : { key, frame: 'island', metal: seatLook.metal, geometry: g, ...o }
  );
  const place = (i: number, x: number, z: number, rotY: number) => {
    const rot: Vec3 = [0, rotY, 0];
    out.push(prop(`isl-stoolF${i}`, 'island', frameUtil, frameG, { position: [x, 0, z], rotation: rot }));
    out.push(seatPart(`isl-stoolS${i}`, seatG, { position: [x, 0, z], rotation: rot }));
    if (backG) out.push(seatPart(`isl-stoolB${i}`, backG, { position: [x, 0, z], rotation: rot, castShadow: false }));
  };
  // positions come from the layout (`stoolPositions` — the same points the
  // photo fitter boxes); side stools first, then the ones round the end.
  // A stool's back is at its local +z, so +z has to point away from the island.
  const seat = isl.seatSide;
  const onSide = Math.max(0, isl.seating - isl.endSeats);
  stoolPositions(isl).forEach(([x, z], i) => {
    const rotY = i < onSide ? (seat > 0 ? 0 : Math.PI) : (isl.endSide > 0 ? Math.PI / 2 : -Math.PI / 2);
    place(i, x, z, rotY);
  });
  return out;
}

/** Island hardware, authored facing +z (turned with the fronts). */
function islandHardware(L: KitchenLayoutData, fronts: FrontDef[], faceZ: number): Part[] {
  if (L.hardware === 'none') return [];
  const out: Part[] = [];
  const traditional = L.style === 'traditional' || L.style === 'farmhouse' || L.style === 'craftsman' || L.style === 'mediterranean';
  const knobStyle = traditional ? 'mushroom' as const : 'round' as const;
  const square = L.style === 'modern' || L.style === 'industrial';
  fronts.forEach((f, i) => {
    if (f.kind === 'false') return;
    const z = faceZ + DOOR_T / 2;
    const key = `isl-hw${i}`;
    if (L.hardware === 'integrated') {
      out.push(surface(key, 'island', 'hardware', edgePull(Math.max(80, (f.w - inch(1.2)) * 1000), { heightMm: 22, depthMm: 16 }), {
        position: [f.x, f.y + f.h / 2 - inch(0.7), z - 0.0005], inert: true, castShadow: false,
      }));
      return;
    }
    if (f.kind === 'drawer') {
      if (L.hardware === 'mixed' && traditional) {
        out.push(surface(key, 'island', 'hardware', cupPull(Math.min(160, Math.max(64, f.w * 1000 * 0.35))), { position: [f.x, f.y, z], inert: true, castShadow: false }));
      } else if (L.hardware === 'knobs') {
        out.push(surface(key, 'island', 'hardware', knob(32, { style: knobStyle }), { position: [f.x, f.y, z], inert: true, castShadow: false }));
      } else {
        out.push(surface(key, 'island', 'hardware', barPull(Math.min(320, Math.max(96, Math.round((f.w * 1000 * 0.42) / 32) * 32)), { square }), { position: [f.x, f.y, z], inert: true, castShadow: false }));
      }
      return;
    }
    const edge = f.hinge === 'left' ? f.w / 2 - inch(1.55) : -f.w / 2 + inch(1.55);
    const off = Math.min(Math.max(0, f.h / 2 - inch(3.5)), f.h * 0.32);
    if (L.hardware === 'knobs' || L.hardware === 'mixed') {
      out.push(surface(key, 'island', 'hardware', knob(32, { style: knobStyle }), { position: [f.x + edge, f.y + off, z], inert: true, castShadow: false }));
    } else {
      out.push(surface(key, 'island', 'hardware', barPull(Math.min(224, Math.max(96, Math.round((f.h * 1000 * 0.26) / 32) * 32)), { square }), {
        position: [f.x + edge, f.y + off, z], rotation: [0, 0, Math.PI / 2], inert: true, castShadow: false,
      }));
    }
  });
  return out;
}
