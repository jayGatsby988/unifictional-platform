/**
 * Cabinetry — the part of a kitchen a contractor is actually selling, and the
 * part that most obviously reads as a massing model when it is built from
 * boxes.
 *
 * What is modelled here that was not before:
 *  - real CONSTRUCTION. Traditional styles get a face frame (1-1/2" stiles and
 *    rails applied to the box, doors overlaying it, and visible barrel hinges);
 *    modern styles get frameless boxes with full-overlay doors and a 3 mm
 *    reveal. The two look completely different in a photograph and every real
 *    kitchen is one or the other.
 *  - doors and drawers built by `doorPanel()`: stiles, rails, a wider bottom
 *    rail, a recessed or fielded centre, a chamfer on every edge.
 *  - a toe kick that is genuinely RECESSED 3" behind the door face, so it
 *    throws the dark shadow line every base run has.
 *  - crown that mitres around corners and RETURNS to the wall at open ends.
 *  - a light rail under the wall cabinets, scribe fillers, finished end panels.
 *  - shelves, shelf pins and a back panel visible behind glass doors.
 *  - hardware everywhere it belongs, with its screw bosses, chosen by style.
 *
 * Everything returns `Part[]` in the run's wall frame (see `parts.ts`).
 */
import type { CabinetDoorStyle, DesignStyle } from '@/lib/spec/types';
import {
  barPull, cupPull, doorPanel, edgePull, hinge, knob, shelfPin,
  type PanelOptions, type PanelStyle,
} from '@/components/scene/detail';
import { inch } from '@/lib/units';
import { compact, surface, prop, type Part, type Vec3 } from './parts';
import {
  cabinetBox, crownRun, lightRail, panelStrip, shelfBoard, toeBoard, corbel,
} from './helpers';
import {
  DOOR_T, MIN_CAB, REVEAL, SHELF_T, TALL_PANEL, TIER_RAIL_H,
  type KBase, type KitchenLayoutData, type KRun, type KTall, type KUpper,
} from './layout';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export type Construction = 'face-frame' | 'frameless';

/** 3/4" face frame stock, 1-1/2" wide — the American standard. */
const FF_T = inch(0.75);
const FF_W = inch(1.5);
/** 3" toe recess: the dark shadow under every base cabinet. */
const TOE_RECESS = inch(3);
const BACK_T = inch(0.5);

const FRAMELESS_STYLES: ReadonlySet<DesignStyle> = new Set<DesignStyle>([
  'modern', 'contemporary', 'scandinavian', 'industrial', 'mid-century',
]);

/**
 * Face frame or frameless? Decided from the DECLARED style and door style, so
 * it is stable: changing the room size can never flip a kitchen from one
 * construction to the other halfway through a slider drag.
 */
export function constructionFor(style: DesignStyle, doorStyle: CabinetDoorStyle): Construction {
  if (doorStyle === 'raised' || doorStyle === 'beaded') return 'face-frame';
  if (doorStyle === 'slab' || doorStyle === 'flat') return 'frameless';
  return FRAMELESS_STYLES.has(style) ? 'frameless' : 'face-frame';
}

/** Depth of the cabinet BOX, i.e. everything behind the doors. */
function boxDepth(depth: number, ctn: Construction): number {
  return Math.max(0.05, depth - DOOR_T - (ctn === 'face-frame' ? FF_T : 0));
}
/** z of the centre of the door/drawer front slab. */
function frontZ(depth: number): number { return depth - DOOR_T / 2; }


// ---------------------------------------------------------------------------
// Fronts
// ---------------------------------------------------------------------------

export type FrontKind = 'door' | 'drawer' | 'false';
export interface FrontDef {
  kind: FrontKind; x: number; y: number; w: number; h: number; hinge: 'left' | 'right';
  /** where a door pull sits — base doors take it high, wall cabinets take it low */
  pullAt?: 'top' | 'bottom' | 'center';
  /** force a glass front (glass wall cabinets) */
  glass?: boolean;
}

function frontStyle(style: CabinetDoorStyle, kind: FrontKind): PanelStyle {
  if (style === 'open') return 'slab';
  if (style === 'glass' && kind !== 'door') return 'shaker';
  if (style === 'raised' && kind === 'drawer') return 'shaker';
  return style as PanelStyle;
}

/** Real stile / rail widths per style. A drawer front gets narrower rails. */
function panelOpts(style: PanelStyle, kind: FrontKind, h: number): PanelOptions {
  const tall = kind === 'door' && h > inch(20);
  switch (style) {
    case 'raised':
      return { thickness: DOOR_T, stile: inch(2.375), rail: inch(2.375), bottomRail: tall ? inch(2.75) : inch(2.375), chamfer: 0.0016 };
    case 'beaded':
      return { thickness: DOOR_T, stile: inch(2.125), rail: inch(2.125), bottomRail: tall ? inch(2.5) : inch(2.125), panelInset: 0.005, chamfer: 0.0014 };
    case 'glass':
      return { thickness: DOOR_T, stile: inch(2), rail: inch(2), bottomRail: tall ? inch(2.5) : inch(2), muntinsX: h > inch(28) ? 1 : 0, muntinsY: h > inch(28) ? 2 : 1, chamfer: 0.0012 };
    case 'shaker':
      return {
        thickness: DOOR_T,
        stile: Math.min(inch(2.25), Math.max(inch(1.3), h / 3.4)),
        rail: Math.min(inch(2.25), Math.max(inch(1.1), h / 3.6)),
        bottomRail: tall ? inch(2.75) : Math.min(inch(2.25), Math.max(inch(1.1), h / 3.6)),
        panelInset: 0.006,
        chamfer: 0.0014,
      };
    default:
      return { thickness: DOOR_T, chamfer: 0.0018 };
  }
}

/**
 * Fronts for ONE cabinet, laid out with real 3 mm reveals. Exported so the
 * island builder produces identical millwork on its working side.
 */
export function planCabinetFronts(
  cab: { type: KBase['type']; width: number; drawerCount: number; apronH?: number },
  y0: number, y1: number,
  cornerSide: 'left' | 'right' | null = null,
): FrontDef[] {
  const W = cab.width;
  const H = y1 - y0;
  if (H < inch(6) || W < inch(6)) return [];
  const out: FrontDef[] = [];
  const doorPair = (x: number, w: number, y: number, hgt: number) => {
    if (w > inch(26)) {
      const dw = (w - REVEAL) / 2;
      out.push({ kind: 'door', x: x - (dw + REVEAL) / 2, y, w: dw, h: hgt, hinge: 'left' });
      out.push({ kind: 'door', x: x + (dw + REVEAL) / 2, y, w: dw, h: hgt, hinge: 'right' });
    } else {
      out.push({ kind: 'door', x, y, w, h: hgt, hinge: 'left' });
    }
  };

  if (cab.type === 'drawers') {
    const n = Math.max(1, Math.min(6, cab.drawerCount || 3));
    const usable = H - (n + 1) * REVEAL;
    if (n === 1) {
      out.push({ kind: 'drawer', x: 0, y: y0 + H / 2, w: W - 2 * REVEAL, h: usable, hinge: 'left' });
    } else {
      const top = Math.min(inch(8), Math.max(inch(4.5), usable * 0.2));
      const rest = (usable - top) / (n - 1);
      let y = y1 - REVEAL - top / 2;
      out.push({ kind: 'drawer', x: 0, y, w: W - 2 * REVEAL, h: top, hinge: 'left' });
      y -= top / 2 + REVEAL + rest / 2;
      for (let i = 1; i < n; i++) {
        out.push({ kind: 'drawer', x: 0, y, w: W - 2 * REVEAL, h: rest, hinge: 'left' });
        y -= rest + REVEAL;
      }
    }
    return out;
  }

  if (cab.type === 'sink-base') {
    const apron = cab.apronH ?? 0;
    const tilt = apron > 0 ? apron : Math.min(inch(7), H * 0.22);
    if (apron <= 0) out.push({ kind: 'false', x: 0, y: y1 - REVEAL - tilt / 2, w: W - 2 * REVEAL, h: tilt, hinge: 'left' });
    const dh = H - tilt - 3 * REVEAL;
    if (dh > inch(6)) doorPair(0, W - 2 * REVEAL, y0 + REVEAL + dh / 2, dh);
    return out;
  }

  if (cab.type === 'corner') {
    const doorW = Math.max(inch(12), W * 0.62) - 2 * REVEAL;
    const blank = W - doorW - 3 * REVEAL;
    const sign = cornerSide === 'left' ? 1 : -1;
    out.push({ kind: 'door', x: sign * (W / 2 - doorW / 2 - REVEAL), y: y0 + H / 2, w: doorW, h: H - 2 * REVEAL, hinge: cornerSide === 'left' ? 'right' : 'left' });
    if (blank > inch(2)) {
      out.push({ kind: 'false', x: -sign * (W / 2 - blank / 2 - REVEAL), y: y0 + H / 2, w: blank, h: H - 2 * REVEAL, hinge: 'left' });
    }
    return out;
  }

  const withDrawer = (cab.drawerCount ?? 0) >= 1 && H > inch(24);
  if (withDrawer) {
    const top = Math.min(inch(6.5), H * 0.2);
    out.push({ kind: 'drawer', x: 0, y: y1 - REVEAL - top / 2, w: W - 2 * REVEAL, h: top, hinge: 'left' });
    const dh = H - top - 3 * REVEAL;
    doorPair(0, W - 2 * REVEAL, y0 + REVEAL + dh / 2, dh);
  } else {
    doorPair(0, W - 2 * REVEAL, y0 + H / 2, H - 2 * REVEAL);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

type Hardware = KitchenLayoutData['hardware'];

/** Pull length in mm from a real size ladder — nobody fits a 173 mm pull. */
const PULL_SIZES = [96, 128, 160, 192, 224, 256, 320, 384, 448];
function pullSize(target: number): number {
  let best = PULL_SIZES[0];
  for (const s of PULL_SIZES) if (Math.abs(s - target) < Math.abs(best - target)) best = s;
  return best;
}

/**
 * Hardware for one front, in the front's local frame (origin at its centre,
 * face toward +Z). Traditional styles get cup pulls on drawers and knobs on
 * doors; modern gets long bars; integrated gets a routed edge pull.
 */
function hardwareParts(
  key: string, frame: Part['frame'], f: FrontDef, hw: Hardware, style: DesignStyle, at: Vec3,
): Part[] {
  if (hw === 'none' || f.kind === 'false') return [];
  const faceZ = at[2] + DOOR_T / 2;
  const put = (g: Parameters<typeof prop>[3], dx: number, dy: number, rot?: Vec3, dz = 0): Part =>
    surface(`${key}-hw${dx.toFixed(3)}${dy.toFixed(3)}`, frame, 'hardware', g, {
      position: [at[0] + dx, at[1] + dy, faceZ + dz], rotation: rot, inert: true, castShadow: false,
    });

  if (hw === 'integrated') {
    const low = f.pullAt === 'bottom';
    return [put(edgePull(Math.max(80, (f.w - inch(1.2)) * 1000), { heightMm: 22, depthMm: 16 }),
      0, low ? -(f.h / 2 - inch(0.7)) : f.h / 2 - inch(0.7), low ? [Math.PI, 0, 0] : undefined, -0.0005)];
  }

  const traditional = style === 'traditional' || style === 'farmhouse' || style === 'craftsman' || style === 'mediterranean';
  const useKnob = hw === 'knobs' || (hw === 'mixed' && f.kind === 'door');

  if (f.kind === 'drawer') {
    if (hw === 'mixed' && traditional) {
      const w = Math.min(160, Math.max(64, f.w * 1000 * 0.35));
      return f.w > inch(30)
        ? [put(cupPull(w), -f.w * 0.22, 0), put(cupPull(w), f.w * 0.22, 0)]
        : [put(cupPull(w), 0, 0)];
    }
    if (useKnob) {
      return f.w > inch(30)
        ? [put(knob(32, { style: traditional ? 'mushroom' : 'round' }), -f.w * 0.22, 0), put(knob(32, { style: traditional ? 'mushroom' : 'round' }), f.w * 0.22, 0)]
        : [put(knob(32, { style: traditional ? 'mushroom' : 'round' }), 0, 0)];
    }
    const len = pullSize(Math.min(320, Math.max(96, f.w * 1000 * 0.42)));
    return [put(barPull(len, { square: style === 'modern' || style === 'industrial' }), 0, 0)];
  }

  // door: the pull goes on the LATCH side, opposite the hinges
  const edge = f.hinge === 'left' ? f.w / 2 - inch(1.55) : -f.w / 2 + inch(1.55);
  const off = Math.min(Math.max(0, f.h / 2 - inch(3.5)), f.h * 0.32);
  const anchor = f.pullAt ?? 'top';
  const y = anchor === 'bottom' ? -off : anchor === 'center' ? 0 : off;
  if (useKnob) return [put(knob(32, { style: traditional ? 'mushroom' : 'round' }), edge, y)];
  const len = pullSize(Math.min(224, Math.max(96, f.h * 1000 * 0.26)));
  return [put(barPull(len, { square: style === 'modern' || style === 'industrial' }), edge, y, [0, 0, Math.PI / 2])];
}

/** Visible barrel hinges — only a face-frame job shows them with the door shut. */
function hingeParts(key: string, frame: Part['frame'], f: FrontDef, at: Vec3, ctn: Construction): Part[] {
  if (ctn !== 'face-frame' || f.kind !== 'door' || f.h < inch(10)) return [];
  const g = hinge({ kind: 'barrel' });
  const side = f.hinge === 'left' ? -1 : 1;
  const x = at[0] + side * (f.w / 2 + inch(0.2));
  const z = at[2] - DOOR_T / 2 - inch(0.1);
  const ys = f.h > inch(40)
    ? [-f.h / 2 + inch(3.5), 0, f.h / 2 - inch(3.5)]
    : [-f.h / 2 + inch(3.5), f.h / 2 - inch(3.5)];
  return ys.map((dy, i) => surface(`${key}-hg${i}`, frame, 'hardware', g, {
    position: [x, at[1] + dy, z], inert: true, castShadow: false,
  }));
}

// ---------------------------------------------------------------------------
// One cabinet's fronts (+ their hardware) as parts
// ---------------------------------------------------------------------------

function frontParts(
  key: string, frame: Part['frame'], slot: string, fronts: FrontDef[], L: KitchenLayoutData,
  z: number, ctn: Construction, glassDoors: boolean, xOffset = 0,
): Part[] {
  const out: Part[] = [];
  fronts.forEach((f, i) => {
    const wantGlass = (glassDoors || f.glass) && f.kind === 'door';
    const style = wantGlass ? 'glass' : frontStyle(L.doorStyle, f.kind);
    const parts = doorPanel(style, f.w, f.h, panelOpts(style, f.kind, f.h));
    const at: Vec3 = [f.x + xOffset, f.y, z];
    out.push(surface(`${key}-f${i}`, frame, slot, parts.body, { position: at }));
    if (parts.glass) {
      out.push(prop(`${key}-f${i}-glass`, frame, 'glass', parts.glass, { position: at, castShadow: false, receiveShadow: false }));
    }
    out.push(...hardwareParts(`${key}-f${i}`, frame, f, L.hardware, L.style, at));
    out.push(...hingeParts(`${key}-f${i}`, frame, f, at, ctn));
  });
  return out;
}

/** Face frame applied to the front of a box: two stiles, a top and bottom rail. */
function faceFrameParts(key: string, frame: Part['frame'], slot: string, w: number, y0: number, y1: number, z: number): Part[] {
  const h = y1 - y0;
  if (h < inch(4) || w < inch(4)) return [];
  const st = Math.min(FF_W, w / 2.4);
  const rl = Math.min(FF_W, h / 3);
  const inner = Math.max(0.004, w - st * 2);
  const cy = (y0 + y1) / 2;
  return [
    surface(`${key}-ffL`, frame, slot, panelStrip(st, h, FF_T), { position: [-w / 2 + st / 2, cy, z], castShadow: false }),
    surface(`${key}-ffR`, frame, slot, panelStrip(st, h, FF_T), { position: [w / 2 - st / 2, cy, z], castShadow: false }),
    surface(`${key}-ffT`, frame, slot, panelStrip(inner, rl, FF_T), { position: [0, y1 - rl / 2, z], castShadow: false }),
    surface(`${key}-ffB`, frame, slot, panelStrip(inner, rl, FF_T), { position: [0, y0 + rl / 2, z], castShadow: false }),
  ];
}

/** Shelves + their pins, for a cabinet whose interior is actually visible. */
function shelfParts(key: string, frame: Part['frame'], slot: string, w: number, ys: number[], depth: number, z: number): Part[] {
  const out: Part[] = [];
  const board = shelfBoard(Math.max(0.05, w - inch(1.5)), Math.max(0.05, depth), SHELF_T);
  const pin = shelfPin();
  ys.forEach((y, i) => {
    out.push(surface(`${key}-sh${i}`, frame, slot, board, { position: [0, y, z], castShadow: false }));
    for (const sx of [-1, 1]) {
      for (const dz of [z - depth / 2 + inch(2), z + depth / 2 - inch(2)]) {
        out.push(surface(`${key}-sh${i}p${sx}${dz.toFixed(2)}`, frame, 'hardware', pin, {
          position: [sx * (w / 2 - inch(0.9)), y - SHELF_T / 2, dz],
          rotation: [0, 0, sx > 0 ? Math.PI : 0], inert: true, castShadow: false,
        }));
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Base cabinets
// ---------------------------------------------------------------------------

function baseCabinetParts(L: KitchenLayoutData, run: KRun, cab: KBase, ctn: Construction): Part[] {
  const key = cab.id;
  const frame = run.wall;
  const D = run.baseDepth;
  const bd = boxDepth(D, ctn);
  const y0 = L.toeKick;
  const y1 = L.carcassTop;
  const h = Math.max(0.05, y1 - y0);
  const cx = cab.cx;

  if (cab.type === 'appliance-gap') return [];

  if (cab.type === 'filler') {
    return [surface(key, frame, 'cabinets_base', panelStrip(cab.width, y1, DOOR_T), {
      position: [cx, y1 / 2, D - DOOR_T / 2], inert: true, castShadow: false,
    })];
  }

  const cornerSide: 'left' | 'right' | null = cab.type === 'corner'
    ? (Math.abs(cab.x0 + run.wallLen / 2) < 0.05 ? 'left' : 'right')
    : null;

  if (cab.type === 'open') {
    const shelfYs = [y0 + h * 0.34, y0 + h * 0.68];
    return compact([
      surface(`${key}-l`, frame, 'cabinets_base', panelStrip(inch(0.75), h, bd), { position: [cx - (cab.width / 2 - inch(0.375)), (y0 + y1) / 2, bd / 2] }),
      surface(`${key}-r`, frame, 'cabinets_base', panelStrip(inch(0.75), h, bd), { position: [cx + (cab.width / 2 - inch(0.375)), (y0 + y1) / 2, bd / 2] }),
      surface(`${key}-bk`, frame, 'cabinets_base', panelStrip(cab.width, h, BACK_T), { position: [cx, (y0 + y1) / 2, BACK_T / 2], inert: true, castShadow: false }),
      ...shelfParts(key, frame, 'cabinets_base', cab.width, shelfYs, bd - inch(1), bd / 2).map((p) => ({
        ...p, position: [(p.position?.[0] ?? 0) + cx, p.position?.[1] ?? 0, p.position?.[2] ?? 0] as Vec3,
      })),
    ]);
  }

  const fronts = planCabinetFronts(cab, y0, y1, cornerSide);
  const ffZ = D - DOOR_T - FF_T / 2;
  return compact([
    surface(`${key}-box`, frame, 'cabinets_base', cabinetBox(cab.width, h, bd), { position: [cx, (y0 + y1) / 2, bd / 2] }),
    ...(ctn === 'face-frame' ? faceFrameParts(key, frame, 'cabinets_base', cab.width, y0, y1, ffZ).map((p) => ({
      ...p, position: [(p.position?.[0] ?? 0) + cx, p.position?.[1] ?? 0, p.position?.[2] ?? 0] as Vec3,
    })) : []),
    ...frontParts(key, frame, 'cabinets_base', fronts, L, frontZ(D), ctn, false, cx),
  ]);
}

// ---------------------------------------------------------------------------
// Wall cabinets
// ---------------------------------------------------------------------------

function upperCabinetParts(L: KitchenLayoutData, run: KRun, cab: KUpper, ctn: Construction): Part[] {
  if (cab.type === 'appliance-gap' || cab.type === 'hood-gap') return [];
  const key = cab.id;
  const frame = run.wall;
  const D = run.upperDepth;
  const bd = boxDepth(D, ctn);
  // every wall cabinet hangs from the run's TOP line down to its own underside:
  // the row's for an ordinary cabinet, the canopy's for the box on the hood, and
  // higher than the row's for an upper carrying its own `heightIn`
  const y0 = cab.bottom;
  // every wall cabinet spans from its own underside to its own TOP: the row's
  // top for a single-tier row and for the transom, the rail line for tier 1
  // under one (`KUpper.top`, which defaults to `run.upperTop`)
  const H = Math.max(0.1, cab.top - y0);
  const cy = y0 + H / 2;
  const cx = cab.cx;

  if (cab.type === 'filler') {
    return [surface(key, frame, 'cabinets_upper', panelStrip(cab.width, H, DOOR_T), {
      position: [cx, cy, D - DOOR_T / 2], inert: true, castShadow: false,
    })];
  }

  if (cab.type === 'open-shelf') {
    const n = Math.max(2, Math.min(4, Math.round(H / inch(14))));
    const out: Part[] = [];
    const board = shelfBoard(cab.width, D, SHELF_T);
    for (let i = 0; i <= n; i++) {
      out.push(surface(`${key}-os${i}`, frame, 'cabinets_upper', board, { position: [cx, y0 + (H * i) / n + SHELF_T / 2, D / 2] }));
    }
    for (const sx of [-1, 1]) {
      out.push(surface(`${key}-osE${sx}`, frame, 'cabinets_upper', panelStrip(inch(0.75), H, D), {
        position: [cx + sx * (cab.width / 2 - inch(0.375)), cy, D / 2], castShadow: false,
      }));
    }
    return out;
  }

  // The cabinet that sits ON the hood canopy — the client's "above the vent,
  // there are always cabinets". 'panel' is a plain flat-fronted chase in the
  // cabinet finish: a box, no doors, no hinges, no hardware.
  if (cab.type === 'hood-cabinet' && cab.hood?.front === 'panel') {
    const ffZp = D - DOOR_T - FF_T / 2;
    return compact([
      surface(`${key}-box`, frame, 'cabinets_upper', cabinetBox(cab.width, H, bd), { position: [cx, cy, bd / 2] }),
      ...(ctn === 'face-frame' ? faceFrameParts(key, frame, 'cabinets_upper', cab.width, y0, y0 + H, ffZp).map((p) => ({
        ...p, position: [(p.position?.[0] ?? 0) + cx, p.position?.[1] ?? 0, p.position?.[2] ?? 0] as Vec3,
      })) : []),
      surface(`${key}-panel`, frame, 'cabinets_upper', panelStrip(cab.width - 2 * REVEAL, H - 2 * REVEAL, DOOR_T), { position: [cx, cy, frontZ(D)] }),
    ]);
  }

  const glass = cab.type === 'glass' || L.doorStyle === 'glass' || cab.hood?.front === 'glass';
  const W = cab.width - 2 * REVEAL;
  const hgt = H - 2 * REVEAL;
  const fronts: FrontDef[] = [];
  if (W >= inch(5) && hgt >= inch(5)) {
    if (W > inch(26)) {
      const dw = (W - REVEAL) / 2;
      fronts.push({ kind: 'door', x: -(dw + REVEAL) / 2, y: cy, w: dw, h: hgt, hinge: 'left', pullAt: 'bottom' });
      fronts.push({ kind: 'door', x: (dw + REVEAL) / 2, y: cy, w: dw, h: hgt, hinge: 'right', pullAt: 'bottom' });
    } else {
      fronts.push({ kind: 'door', x: 0, y: cy, w: W, h: hgt, hinge: 'left', pullAt: 'bottom' });
    }
  }

  const shelfN = H > inch(30) ? 3 : H > inch(20) ? 2 : 1;
  const shelfYs = Array.from({ length: shelfN }, (_, i) => y0 + (H * (i + 1)) / (shelfN + 1));
  const ffZ = D - DOOR_T - FF_T / 2;

  return compact([
    surface(`${key}-box`, frame, 'cabinets_upper', cabinetBox(cab.width, H, bd), { position: [cx, cy, bd / 2] }),
    ...(glass ? [
      surface(`${key}-bk`, frame, 'cabinets_upper', panelStrip(cab.width, H, BACK_T), { position: [cx, cy, BACK_T / 2], inert: true, castShadow: false }),
      ...shelfParts(key, frame, 'cabinets_upper', cab.width, shelfYs, bd - inch(0.75), bd / 2).map((p) => ({
        ...p, position: [(p.position?.[0] ?? 0) + cx, p.position?.[1] ?? 0, p.position?.[2] ?? 0] as Vec3,
      })),
    ] : []),
    ...(ctn === 'face-frame' ? faceFrameParts(key, frame, 'cabinets_upper', cab.width, y0, y0 + H, ffZ).map((p) => ({
      ...p, position: [(p.position?.[0] ?? 0) + cx, p.position?.[1] ?? 0, p.position?.[2] ?? 0] as Vec3,
    })) : []),
    ...frontParts(key, frame, 'cabinets_upper', fronts, L, frontZ(D), ctn, glass, cx),
  ]);
}

// ---------------------------------------------------------------------------
// Tall units
// ---------------------------------------------------------------------------

/**
 * Every tall unit — pantry, oven tower, the fridge surround's side panels and
 * the cabinet over the fridge — is drawn in its own slot. The client's photo
 * had a white-painted surround and pantry beside oak bases AND oak uppers,
 * which no base-or-upper rule can express; fronts and hardware follow the
 * same rules as every other cabinet.
 */
const TALL_SLOT = 'cabinets_tall';

function tallUnitParts(L: KitchenLayoutData, run: KRun, tall: KTall, ctn: Construction): Part[] {
  const key = tall.id;
  const frame = run.wall;
  const D = tall.depth;
  const bd = boxDepth(D, ctn);
  const y0 = L.toeKick;
  const top = tall.top;
  const cx = tall.cx;
  const W = tall.width - 2 * REVEAL;
  const out: Part[] = [];

  const pair = (list: FrontDef[], y: number, hgt: number, pullAt: 'top' | 'bottom', w = W) => {
    if (w > inch(26)) {
      const dw = (w - REVEAL) / 2;
      list.push({ kind: 'door', x: -(dw + REVEAL) / 2, y, w: dw, h: hgt, hinge: 'left', pullAt });
      list.push({ kind: 'door', x: (dw + REVEAL) / 2, y, w: dw, h: hgt, hinge: 'right', pullAt });
    } else {
      list.push({ kind: 'door', x: 0, y, w, h: hgt, hinge: 'left', pullAt });
    }
  };

  if (tall.kind === 'fridge-surround') {
    const bridgeH = Math.max(0.05, top - tall.openingH);
    const innerW = Math.max(0.05, tall.width - 2 * TALL_PANEL);
    const fronts: FrontDef[] = [];
    if (bridgeH - 2 * REVEAL > inch(8)) pair(fronts, tall.openingH + REVEAL + (bridgeH - 2 * REVEAL) / 2, bridgeH - 2 * REVEAL, 'bottom', Math.max(inch(6), innerW - 2 * REVEAL));
    out.push(
      surface(`${key}-pl`, frame, TALL_SLOT, panelStrip(TALL_PANEL, top, D), { position: [cx - (tall.width / 2 - TALL_PANEL / 2), top / 2, D / 2] }),
      surface(`${key}-pr`, frame, TALL_SLOT, panelStrip(TALL_PANEL, top, D), { position: [cx + (tall.width / 2 - TALL_PANEL / 2), top / 2, D / 2] }),
      surface(`${key}-bridge`, frame, TALL_SLOT, cabinetBox(innerW, bridgeH, bd), { position: [cx, tall.openingH + bridgeH / 2, bd / 2] }),
    );
    out.push(...frontParts(key, frame, TALL_SLOT, fronts, L, frontZ(D), ctn, false, cx));
    return out;
  }

  const fronts: FrontDef[] = [];
  if (tall.kind === 'pantry') {
    const split = Math.min(y0 + (top - y0) * 0.62, inch(62));
    const lowH = split - y0 - 2 * REVEAL;
    const hiH = top - split - 2 * REVEAL;
    if (lowH > inch(8)) pair(fronts, y0 + REVEAL + lowH / 2, lowH, 'top');
    if (hiH > inch(8)) pair(fronts, split + REVEAL + hiH / 2, hiH, 'bottom');
  } else {
    const cavityBottom = inch(30);
    const cavityTop = Math.min(top - inch(10), cavityBottom + inch(30));
    const lowH = cavityBottom - y0 - 2 * REVEAL;
    const hiH = top - cavityTop - 2 * REVEAL;
    if (lowH > inch(8)) fronts.push({ kind: 'drawer', x: 0, y: y0 + REVEAL + lowH / 2, w: W, h: lowH, hinge: 'left' });
    if (hiH > inch(8)) pair(fronts, cavityTop + REVEAL + hiH / 2, hiH, 'bottom');
  }

  const ffZ = D - DOOR_T - FF_T / 2;
  out.push(surface(`${key}-box`, frame, TALL_SLOT, cabinetBox(tall.width, Math.max(0.05, top - y0), bd), { position: [cx, (y0 + top) / 2, bd / 2] }));
  if (ctn === 'face-frame') {
    out.push(...faceFrameParts(key, frame, TALL_SLOT, tall.width, y0, top, ffZ).map((p) => ({
      ...p, position: [(p.position?.[0] ?? 0) + cx, p.position?.[1] ?? 0, p.position?.[2] ?? 0] as Vec3,
    })));
  }
  out.push(...frontParts(key, frame, TALL_SLOT, fronts, L, frontZ(D), ctn, false, cx));
  return out;
}

// ---------------------------------------------------------------------------
// Trim: toe kick, light rail, crown, end panels
// ---------------------------------------------------------------------------

type Span = [number, number];
function mergeSpans(spans: Span[], gap = 0.006): Span[] {
  const sorted = spans.filter(([a, b]) => b - a > 1e-4).sort((p, q) => p[0] - q[0]);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + gap) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

function trimParts(L: KitchenLayoutData, run: KRun): Part[] {
  const frame = run.wall;
  const out: Part[] = [];

  // --- toe kick: one continuous recessed board per contiguous run of boxes
  if (L.toeKick > 0.005) {
    const spans = mergeSpans([
      ...run.base.filter((b) => b.type !== 'filler').map((b): Span => [b.x0, b.x1]),
      ...run.tall.filter((t) => t.kind !== 'fridge-surround').map((t): Span => [t.x0, t.x1]),
    ]);
    spans.forEach(([a, b], i) => {
      out.push(prop(`${run.id}-toe${i}`, frame, 'matte-black', toeBoard(b - a, L.toeKick, inch(0.5)), {
        position: [(a + b) / 2, L.toeKick / 2, run.baseDepth - TOE_RECESS - inch(0.25)], castShadow: false,
      }));
      // the sub-base the boxes actually stand on, set back in the shadow
      out.push(prop(`${run.id}-toeD${i}`, frame, 'matte-black', toeBoard(b - a, L.toeKick, Math.max(0.02, run.baseDepth - TOE_RECESS - inch(0.6))), {
        position: [(a + b) / 2, L.toeKick / 2, (run.baseDepth - TOE_RECESS - inch(0.6)) / 2], castShadow: false, receiveShadow: true,
      }));
    });
  }

  // --- light rail under the wall cabinets
  // Both filters below are load-bearing and the check script asserts them:
  // nothing hangs under a box that sits on a canopy, so 'hood-cabinet' is out
  // of the rail list — but it IS in the crown list, because the crown runs
  // straight across the hood. That contrast is the whole feature.
  if (run.hasUppers) {
    const bands = new Map<number, Span[]>();
    for (const u of run.uppers.filter((u) => u.tier === 1 && (u.type === 'door' || u.type === 'glass' || u.type === 'corner'))) {
      const y = Math.round(u.bottom * 1e5) / 1e5;
      const spans = bands.get(y) ?? [];
      spans.push([u.x0, u.x1]);
      bands.set(y, spans);
    }
    const rails = [...bands].flatMap(([y, spans]) => mergeSpans(spans).map(([a, b]) => ({ a, b, y })));
    rails.forEach(({ a, b, y }, i) => {
      if (b - a < inch(6)) return;
      const heads = L.openings.filter((o) => o.wall === run.wall && o.x + o.width / 2 > a && o.x - o.width / 2 < b && o.sill + o.height < y);
      const drop = heads.reduce((d, o) => Math.min(d, y - o.sill - o.height - 0.002), inch(1.5));
      if (drop < 0.01) return;
      out.push(surface(`${run.id}-rail${i}`, frame, 'cabinets_upper', lightRail(b - a, drop, inch(0.9)), {
        position: [(a + b) / 2, y, run.upperDepth - inch(0.9)], inert: true, castShadow: false,
      }));
    });
  }

  // --- the rail between two tiers of wall cabinet
  // A stacked run is two rows of doors with a real horizontal band between
  // them; without it the pair reads as ONE tall door with a scratch across it,
  // which is the failure the client already rejected ("the small top cabinets
  // not being registered"). It is trim, not a slot of its own, so it is inert
  // and shares `cabinets_upper` with the boxes each side of it.
  if (run.hasUppers && run.upperSplit !== null) {
    const drawn = (u: KUpper) => u.type !== 'appliance-gap' && u.type !== 'hood-gap';
    // only where BOTH tiers really have a box: no band across a flue
    const under = mergeSpans(run.uppers.filter((u) => u.tier === 1 && drawn(u) && u.top >= run.upperSplit! - TIER_RAIL_H / 2 - 1e-4).map((u): Span => [u.x0, u.x1]));
    const over = mergeSpans(run.uppers.filter((u) => u.tier === 2 && drawn(u)).map((u): Span => [u.x0, u.x1]));
    const bands: Span[] = [];
    for (const [a0, a1] of under) {
      for (const [b0, b1] of over) {
        const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
        if (hi - lo > inch(4)) bands.push([lo, hi]);
      }
    }
    mergeSpans(bands).forEach(([a, b], i) => {
      out.push(surface(`${run.id}-tier${i}`, frame, 'cabinets_upper', panelStrip(b - a, TIER_RAIL_H, DOOR_T * 1.6), {
        // set BACK from the door plane by a door thickness: at
        // `upperDepth - DOOR_T*0.8` the rail's front face and the door fronts
        // were 0.2 mm apart and exactly coplanar on a flush-ended run, which
        // z-fights. A real face frame sits behind its overlay doors anyway.
        position: [(a + b) / 2, run.upperSplit!, frontZ(run.upperDepth) - DOOR_T], inert: true, castShadow: false,
      }));
    });
  }

  // --- crown: mitred along the run, returned to the wall at each end
  if (L.crown && L.crownH > 0.01) {
    // the crown sits on whatever reaches the TOP of the row — tier 2 where there
    // is one, tier 1 where there is not, and the box on the hood either way
    const upperSpans = mergeSpans(run.uppers
      .filter((u) => u.top >= run.upperTop - 1e-4 && u.type !== 'appliance-gap' && u.type !== 'hood-gap')
      .map((u): Span => [u.x0, u.x1]));
    const scale = Math.min(1.4, Math.max(0.5, L.crownH / inch(3.6)));
    const atWall = (x: number) => Math.abs(Math.abs(x) - run.wallLen / 2) < 0.03;
    upperSpans.forEach(([a, b], i) => {
      out.push(surface(`${run.id}-crown${i}`, frame, 'cabinets_upper',
        crownRun(a, b, run.upperTop, run.upperDepth, { scale, returnLo: !atWall(a), returnHi: !atWall(b) }),
        { inert: true, castShadow: false }));
    });
    const tallSpans = mergeSpans(run.tall.map((t): Span => [t.x0, t.x1]));
    tallSpans.forEach(([a, b], i) => {
      out.push(surface(`${run.id}-crownT${i}`, frame, 'cabinets_upper',
        crownRun(a, b, run.tallTop, run.tallDepth, { scale, returnLo: !atWall(a), returnHi: !atWall(b) }),
        { inert: true, castShadow: false }));
    });
  }

  // --- finished end panels where a run stops short of a wall
  const endPanel = (x: number, sign: 1 | -1, key: string) => surface(key, frame, 'cabinets_base',
    panelStrip(inch(0.75), L.carcassTop, run.baseDepth), {
      position: [x + sign * inch(0.375), L.carcassTop / 2, run.baseDepth / 2], castShadow: false,
    });
  if (run.base.length) {
    if (run.x0 > -run.wallLen / 2 + 0.02) out.push(endPanel(run.x0, -1, `${run.id}-endLo`));
    if (run.x1 < run.wallLen / 2 - 0.02) out.push(endPanel(run.x1, 1, `${run.id}-endHi`));
  }
  if (run.hasUppers) {
    const upperEnd = (x: number, side: 'Lo' | 'Hi', sign: -1 | 1) => {
      const boxes = run.uppers.filter((u) => u.type !== 'appliance-gap' && u.type !== 'hood-gap'
        && Math.abs((side === 'Lo' ? u.x0 : u.x1) - x) < 1e-4);
      const bands = mergeSpans(boxes.map((u): Span => [u.bottom, u.top]), TIER_RAIL_H + 1e-4);
      bands.forEach(([bottom, top], i) => out.push(surface(`${run.id}-uend${side}${i ? i : ''}`, frame, 'cabinets_upper', panelStrip(inch(0.75), top - bottom, run.upperDepth), {
        position: [x + sign * inch(0.375), (bottom + top) / 2, run.upperDepth / 2], castShadow: false,
      })));
    };
    if (run.ux0 > -run.wallLen / 2 + 0.02) upperEnd(run.ux0, 'Lo', -1);
    if (run.ux1 < run.wallLen / 2 - 0.02) upperEnd(run.ux1, 'Hi', 1);
  }

  // --- corbels under a long unsupported upper (traditional styles only)
  const traditional = L.style === 'traditional' || L.style === 'craftsman' || L.style === 'farmhouse';
  if (traditional && run.hasUppers) {
    const hood = L.appliances.find((a) => a.kind === 'hood' && a.wall === run.wall && a.hoodStyle === 'custom-insert');
    if (hood) {
      const g = corbel(inch(2), inch(8), inch(5), 'scroll');
      for (const sx of [-1, 1]) {
        out.push(surface(`${run.id}-corb${sx}`, frame, 'cabinets_upper', g, {
          position: [hood.x + sx * (hood.width / 2 + inch(1.5)), run.upperBottom + inch(8), run.upperDepth - inch(5)],
          inert: true, castShadow: false,
        }));
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function cabinetParts(L: KitchenLayoutData): Part[] {
  const ctn = constructionFor(L.style, L.doorStyle);
  const out: Part[] = [];
  for (const run of L.runs) {
    if (run.length <= MIN_CAB) continue;
    for (const cab of run.base) out.push(...baseCabinetParts(L, run, cab, ctn));
    for (const cab of run.uppers) out.push(...upperCabinetParts(L, run, cab, ctn));
    for (const t of run.tall) out.push(...tallUnitParts(L, run, t, ctn));
    out.push(...trimParts(L, run));
  }
  return out;
}
