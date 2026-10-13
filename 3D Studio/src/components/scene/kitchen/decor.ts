/**
 * Décor — what makes a twin read as THEIR kitchen rather than a showroom: the
 * open shelves and what is on them, the fig in the corner, the print on the
 * wall, the runner in front of the sink, the roman shade over the window.
 *
 * Placement belongs to the solver (`L.decor`, see `buildDecor` in layout.ts);
 * this file only turns it into parts. Materials follow the same rule as the
 * rest of the kitchen: a shelf that "matches the cabinets" is a real
 * `surface()` on the cabinet slot so it re-materials with them; a wood shelf
 * gets a stained-wood procedural recipe; everything else is a util prop.
 * Repeated pieces (blind slats, plates, leaves) share cached geometry so
 * `autoInstance` folds them into one draw call each.
 */
import { chamferBox, filletBox, spaceAlong } from '@/components/scene/detail';
import { worldPlane } from '@/components/scene/geometry';
import { inch } from '@/lib/units';
import { shelfPoint } from '../shelf-frame';
import { orientShelfParts } from './shelf-transform';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { compact, prop, surface, textured, type Frame, type Part, type ProceduralPart, type UtilKind } from './parts';
import {
  bookStack, bottle, curtainPanel, curtainRod, fruitBowl, leafCluster, mug, pictureFrame, planter, plateStack,
  rollerTube, romanShade, rosette, roundBinding, roundRug, rugBinding, shelfBracket, trailingStrands, trunk,
} from './helpers';
import type { KArt, KitchenLayoutData, KPlant, KRug, KShelf, KWindowTreatment } from './layout';

const LIGHT_WOOD_STYLES = new Set(['scandinavian', 'coastal', 'modern', 'contemporary', 'mid-century']);

// ---------------------------------------------------------------------------
// Procedural recipes
// ---------------------------------------------------------------------------

/** Stained solid-wood shelf: white oak for the light styles, walnut for the rest. */
function shelfWood(L: KitchenLayoutData, colorHex: string | null): ProceduralPart {
  if (colorHex) {
    const v = parseInt(colorHex.slice(1), 16);
    const shade = (c: number) => Math.round(c * 0.58).toString(16).padStart(2, '0');
    const grain = `#${shade((v >> 16) & 255)}${shade((v >> 8) & 255)}${shade(v & 255)}`;
    return { id: `decor-wood-observed-${colorHex.slice(1)}`, kind: 'wood', tint: colorHex, options: { color: colorHex, colorAlt: lighten(colorHex, 0.14), grain, figure: 'straight', spanM: 1.2, grainDensity: 40, contrast: 0.4, pores: 0.45, seed: 7 }, physical: { roughness: 0.5, clearcoat: 0.16, micro: 'wood' } };
  }
  const light = LIGHT_WOOD_STYLES.has(L.style);
  return light
    ? { id: 'decor-wood-oak', kind: 'wood', tint: '#c9a874', options: { color: '#c9a874', colorAlt: '#dcc39a', grain: '#8a6a3f', figure: 'straight', spanM: 1.2, grainDensity: 44, contrast: 0.5, pores: 0.6, seed: 7 }, physical: { roughness: 0.55, clearcoat: 0.12, micro: 'wood' } }
    : { id: 'decor-wood-walnut', kind: 'wood', tint: '#5a3c28', options: { color: '#5a3c28', colorAlt: '#7a563a', grain: '#2e1c10', figure: 'cathedral', spanM: 1.2, grainDensity: 36, contrast: 0.6, pores: 0.3, seed: 11 }, physical: { roughness: 0.5, clearcoat: 0.2, micro: 'wood' } };
}

/** Flat-woven rug in a palette the style would actually buy. */
function rugWeave(L: KitchenLayoutData): ProceduralPart {
  const s = L.style;
  const [color, alt, id] = s === 'coastal' ? ['#5b7d99', '#dfe3e0', 'coastal']
    : s === 'farmhouse' || s === 'traditional' || s === 'mediterranean' ? ['#a8523c', '#e2d3bd', 'kilim']
      : s === 'scandinavian' ? ['#d9d3c7', '#a8a196', 'wool']
        : ['#4a4b4f', '#8d8e90', 'slate'];
  return { id: `decor-rug-${id}`, kind: 'fabric', tint: color, options: { color, colorAlt: alt, threadM: 0.004, weave: 'basket', slub: 0.35, spanM: 0.5, seed: 3 }, physical: { roughness: 0.96, sheen: 0.35, micro: 'fabric' } };
}

/** Stretched canvas in the room's muted accent. */
function canvasOf(L: KitchenLayoutData): ProceduralPart {
  const c = L.decor.accentHex;
  return { id: `decor-canvas-${c.slice(1)}`, kind: 'fabric', tint: c, options: { color: c, colorAlt: lighten(c, 0.12), threadM: 0.0012, weave: 'plain', slub: 0.15, spanM: 0.25, seed: 5 }, physical: { roughness: 0.92, sheen: 0.15, micro: 'fabric' } };
}

function lighten(hex: string, amt: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (c: number) => Math.round(Math.min(255, c + (255 - c) * amt)).toString(16).padStart(2, '0');
  return `#${ch((v >> 16) & 255)}${ch((v >> 8) & 255)}${ch(v & 255)}`;
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------

function boardPart(L: KitchenLayoutData, s: KShelf, key: string, geometry: Parameters<typeof prop>[3], position: [number, number, number]): Part {
  if (s.finishColorHex && (s.material === 'white' || s.material === 'black')) return textured(key, s.wall, { id: `decor-shelf-paint-${s.finishColorHex.slice(1)}`, kind: 'painted-wall', tint: s.finishColorHex, options: { color: s.finishColorHex }, physical: { roughness: 0.42, clearcoat: 0.1, micro: 'paint' } }, geometry, { position });
  switch (s.material) {
    case 'match-cabinets': return surface(key, s.wall, 'cabinets_upper', geometry, { position });
    case 'match-countertop': return surface(key, s.wall, 'countertop', geometry, { position });
    case 'wood': return textured(key, s.wall, shelfWood(L, s.finishColorHex), geometry, { position });
    case 'black': return prop(key, s.wall, 'matte-black', geometry, { position });
    default: return prop(key, s.wall, 'white-plastic', geometry, { position });
  }
}

/** What sits on one board, laid out left→right in thirds so nothing overlaps. */
function boardContents(s: KShelf, k: number, y: number, headroom: number, out: Part[]) {
  if (s.styled === 'empty') return;
  const key = `${s.id}-b${k}`;
  const z = s.standoff + s.depth / 2;
  const cell = s.width / 3;
  const at = (i: number) => s.x - s.width / 2 + cell * (i + 0.5);
  const plateR = Math.min(0.115, s.depth / 2 - 0.015);
  const clear = Math.max(0.08, headroom - 0.02);
  const plant = (i: number, scale: number) => {
    const potR = Math.min(0.055, s.depth / 2 - 0.02);
    const potH = potR * 1.3;
    const leaf = Math.min(scale, Math.max(0.2, (clear - potH - 0.02) / 0.48));
    out.push(
      prop(`${key}-pot${i}`, s.wall, 'ceramic-matte', planter(potR, potH), { position: [at(i), y, z], castShadow: false }),
      prop(`${key}-leaf${i}`, s.wall, 'plant', leafCluster(leaf), { position: [at(i), y + potH - 0.01, z], castShadow: false }),
    );
  };
  const plates = (i: number) => out.push(prop(`${key}-plates${i}`, s.wall, 'porcelain', plateStack(plateR, 5), { position: [at(i), y, z], castShadow: false }));
  const bowls = (i: number) => {
    out.push(prop(`${key}-bowl${i}`, s.wall, 'porcelain', fruitBowl(Math.min(0.08, s.depth / 2 - 0.02)), { position: [at(i), y, z], castShadow: false }));
    out.push(prop(`${key}-bowl${i}b`, s.wall, 'porcelain', fruitBowl(Math.min(0.08, s.depth / 2 - 0.02)), { position: [at(i), y + 0.045, z], castShadow: false }));
  };
  const mugs = (i: number) => [-1, 1].forEach((sx) => out.push(prop(`${key}-mug${i}${sx}`, s.wall, 'ceramic-matte', mug(), {
    position: [at(i) + sx * 0.055, y, z + sx * 0.01], rotation: [0, sx * 0.6, 0], castShadow: false,
  })));
  const books = (i: number) => out.push(prop(`${key}-books${i}`, s.wall, 'dark-wood', bookStack(), { position: [at(i), y, z], rotation: [0, i % 2 ? 0.2 : -0.15, 0], castShadow: false }));
  const flask = (i: number) => out.push(prop(`${key}-bottle${i}`, s.wall, 'glass', bottle(0.032, Math.min(0.26, clear - 0.03)), { position: [at(i) + 0.03, y, z], castShadow: false }));

  switch (s.styled) {
    case 'dishes': plates(0); bowls(1); mugs(2); return;
    case 'books': books(0); flask(1); books(2); return;
    case 'plants': plant(0, 0.5); plant(2, 0.42); if (s.width > 0.9) plant(1, 0.3); return;
    default:
      // 'mixed': alternate the board's cast so a two-board shelf does not repeat itself
      if (k % 2 === 0) { plates(0); plant(1, 0.42); flask(2); } else { books(0); bowls(1); plant(2, 0.36); }
  }
}

function shelfParts(L: KitchenLayoutData, s: KShelf): Part[] {
  const out: Part[] = [];
  const enclosure = s.enclosure;
  const side = enclosure?.panelThickness ?? 0, rear = enclosure?.backPanel ? side : 0;
  const boardWidth = s.width - side * 2, boardDepth = s.depth - rear;
  const board = chamferBox(boardWidth, s.thickness, boardDepth, 0.003);
  const reveal = !enclosure && s.brackets === 'hidden' ? 0.004 : 0;
  const contentShelf = enclosure ? { ...s, width: boardWidth, depth: boardDepth, standoff: s.standoff + rear } : s;
  if (enclosure) {
    const height = enclosure.top - enclosure.bottom;
    const cy = (enclosure.top + enclosure.bottom) / 2;
    const panel = chamferBox(side, height, s.depth, 0.002);
    for (const sign of [-1, 1]) out.push(boardPart(L, s, `${s.id}-case-${sign < 0 ? 'left' : 'right'}`, panel, [s.x + sign * (s.width - side) / 2, cy, s.standoff + s.depth / 2]));
    if (enclosure.backPanel) out.push(boardPart(L, s, `${s.id}-case-back`, chamferBox(boardWidth, height, rear, 0.002), [s.x, cy, s.standoff + rear / 2]));
    out.push(boardPart(L, s, `${s.id}-case-top`, chamferBox(boardWidth, side, boardDepth, 0.002), [s.x, enclosure.top - side / 2, s.standoff + rear + boardDepth / 2]));
  }
  s.boards.forEach((y, k) => {
    const z = s.standoff + rear + reveal;
    out.push(boardPart(L, s, `${s.id}-board${k}`, board, [s.x, y + s.thickness / 2, z + boardDepth / 2]));
    // The declared sides support enclosed boards: no floating reveals or
    // exposed brackets inside a built-in display case.
    if (!enclosure && s.brackets === 'hidden') {
      // a hidden bracket leaves only its shadow line: the board floats a hair off the tile
      out.push(prop(`${s.id}-reveal${k}`, s.wall, 'matte-black', chamferBox(s.width - 0.01, s.thickness * 0.8, reveal, 0), {
        position: [s.x, y + s.thickness / 2, s.standoff + reveal / 2], castShadow: false, receiveShadow: false,
      }));
    } else if (!enclosure) {
      const drop = Math.min(0.16, Math.max(0.08, s.depth * 0.6));
      const xs = [s.x - s.width / 2 + inch(3), s.x + s.width / 2 - inch(3)];
      if (s.width > 1.1) xs.push(s.x);
      xs.forEach((bx, i) => out.push(prop(`${s.id}-bracket${k}-${i}`, s.wall, 'matte-black', shelfBracket(s.depth, drop), {
        position: [bx, y, s.standoff], castShadow: false,
      })));
    }
    const top = y + s.thickness;
    const next = k + 1 < s.boards.length ? s.boards[k + 1] : enclosure ? enclosure.top - side : L.h - L.ceilingCrown - 0.02;
    // a board the photo furnished (items.ts draws those) does not also get the
    // canned thirds-based cast on top of them
    const furnished = L.decor.items.some((it) => it.on === 'shelf' && it.hostId === s.id && it.shelfIndex === k);
    if (!furnished) {
      const contents: Part[] = [];
      boardContents(contentShelf, k, top, next - top, contents);
      if (enclosure && contents.length) {
        const box = new Box3();
        for (const p of contents) {
          p.geometry.computeBoundingBox();
          const sc = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] as const : p.scale ?? [1, 1, 1] as const;
          const matrix = new Matrix4().compose(new Vector3(...(p.position ?? [0, 0, 0])), new Quaternion().setFromEuler(new Euler(...(p.rotation ?? [0, 0, 0]))), new Vector3(...sc));
          if (p.geometry.boundingBox) box.union(p.geometry.boundingBox.clone().applyMatrix4(matrix));
        }
        const cz = contentShelf.standoff + contentShelf.depth / 2;
        const halfW = Math.max(Math.abs(box.min.x - s.x), Math.abs(box.max.x - s.x));
        const halfD = Math.max(Math.abs(box.min.z - cz), Math.abs(box.max.z - cz));
        const scale = Math.max(0.01, Math.min(1, (boardWidth - 0.02) / (halfW * 2), (boardDepth - 0.02) / (halfD * 2), (next - top - 0.02) / Math.max(0.01, box.max.y - top)));
        if (scale < 1) for (const p of contents) {
          const pos = p.position ?? [0, 0, 0];
          p.position = [s.x + (pos[0] - s.x) * scale, top + (pos[1] - top) * scale, cz + (pos[2] - cz) * scale];
          p.scale = typeof p.scale === 'number' ? p.scale * scale : p.scale ? p.scale.map((n) => n * scale) as [number, number, number] : scale;
        }
      }
      out.push(...contents);
    }
  });
  return orientShelfParts(s, out);
}

// ---------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------

function foliage(key: string, frame: Frame, p: KPlant, x: number, soilY: number, z: number, out: Part[]) {
  const above = Math.max(0.1, p.height - p.potH);
  const leaves: UtilKind = 'plant';
  switch (p.form) {
    case 'tree': {
      const trunkH = above * 0.55;
      const scale = Math.min(2.2, Math.max(0.4, (above - trunkH) / 0.48));
      out.push(prop(`${key}-trunk`, frame, 'dark-wood', trunk(trunkH, p.potR * 0.22, p.potR * 0.11), { position: [x, soilY, z] }));
      const n = above > 1.6 ? 5 : above > 1.0 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n - 1);
        const ang = i * 2.1;
        const r = p.potR * 0.5 * (1 - t);
        out.push(prop(`${key}-canopy${i}`, frame, leaves, leafCluster(scale * (0.75 + 0.25 * (1 - t))), {
          position: [x + Math.cos(ang) * r, soilY + trunkH * (0.55 + 0.45 * t) - 0.05, z + Math.sin(ang) * r], rotation: [0, ang, 0], castShadow: false,
        }));
      }
      return;
    }
    case 'trailing': {
      out.push(prop(`${key}-crown`, frame, leaves, leafCluster(Math.min(0.6, Math.max(0.25, above / 1.2))), { position: [x, soilY, z], castShadow: false }));
      out.push(prop(`${key}-strands`, frame, leaves, trailingStrands(4, Math.min(1.4, Math.max(0.15, above)), p.potR), { position: [x, soilY + 0.01, z], castShadow: false }));
      return;
    }
    case 'succulent':
      out.push(prop(`${key}-rosette`, frame, leaves, rosette(Math.min(p.potR * 0.95, above * 0.9)), { position: [x, soilY, z], castShadow: false }));
      return;
    case 'herb':
      out.push(prop(`${key}-leaves`, frame, leaves, leafCluster(Math.min(0.9, Math.max(0.22, above / 0.48))), { position: [x, soilY, z], castShadow: false }));
      return;
    default:
      out.push(prop(`${key}-leaves`, frame, leaves, leafCluster(Math.min(3, Math.max(0.3, above / 0.48))), { position: [x, soilY, z], castShadow: p.kind === 'floor' }));
  }
}

function plantParts(L: KitchenLayoutData, p: KPlant): Part[] {
  const out: Part[] = [];
  const key = p.id;
  if (p.kind === 'hanging') {
    // canopy at the ceiling, a cord, the pot, and whatever spills over its rim
    const potTop = p.y - p.drop;
    out.push(
      prop(`${key}-canopy`, p.frame, 'matte-black', chamferBox(0.06, 0.012, 0.06, 0.001), { position: [p.x, p.y - 0.006, p.z], castShadow: false }),
      prop(`${key}-cord`, p.frame, 'matte-black', chamferBox(0.004, p.drop, 0.004, 0), { position: [p.x, p.y - p.drop / 2, p.z], castShadow: false, receiveShadow: false }),
      prop(`${key}-pot`, p.frame, 'ceramic-matte', planter(p.potR, p.potH), { position: [p.x, potTop - p.potH, p.z] }),
      prop(`${key}-soil`, p.frame, 'soil', planter(p.potR * 0.86, 0.012), { position: [p.x, potTop - 0.02, p.z], castShadow: false }),
    );
    foliage(key, p.frame, { ...p, form: p.form === 'tree' ? 'leafy' : p.form, height: p.height + p.potH }, p.x, potTop - 0.01, p.z, out);
    return out;
  }
  out.push(
    prop(`${key}-pot`, p.frame, 'ceramic-matte', planter(p.potR, p.potH), { position: [p.x, p.y, p.z] }),
    prop(`${key}-soil`, p.frame, 'soil', planter(p.potR * 0.86, 0.012), { position: [p.x, p.y + p.potH - 0.02, p.z], castShadow: false }),
  );
  foliage(key, p.frame, p, p.x, p.y + p.potH - 0.01, p.z, out);
  return out;
}

// ---------------------------------------------------------------------------
// Art, rug, window treatments
// ---------------------------------------------------------------------------

function artParts(L: KitchenLayoutData, a: KArt): Part[] {
  const out: Part[] = [];
  const canvas = canvasOf(L);
  if (a.frame === 'none') {
    // gallery wrap: the canvas turns the corner, so the whole block is canvas
    out.push(textured(`${a.id}-canvas`, a.wall, canvas, chamferBox(a.width, a.height, a.depth, 0.002), { position: [a.x, a.y, 0.004 + a.depth / 2], castShadow: false }));
    return out;
  }
  const rail = Math.min(inch(1.1), a.width / 6);
  const railUtil: UtilKind = a.frame === 'black' ? 'matte-black' : a.frame === 'wood' ? 'dark-wood' : 'white-plastic';
  const mat = Math.min(inch(2), a.width / 6);
  out.push(
    prop(`${a.id}-frame`, a.wall, railUtil, pictureFrame(a.width, a.height, rail, a.depth), { position: [a.x, a.y, 0.004], castShadow: false }),
    prop(`${a.id}-mat`, a.wall, 'paper', chamferBox(a.width - 2 * rail, a.height - 2 * rail, 0.003, 0), { position: [a.x, a.y, 0.004 + a.depth * 0.35], castShadow: false, receiveShadow: false }),
    textured(`${a.id}-canvas`, a.wall, canvas, worldPlane(Math.max(0.02, a.width - 2 * rail - 2 * mat), Math.max(0.02, a.height - 2 * rail - 2 * mat)), { position: [a.x, a.y, 0.004 + a.depth * 0.35 + 0.002], castShadow: false, receiveShadow: false }),
  );
  return out;
}

function rugParts(L: KitchenLayoutData, r: KRug): Part[] {
  const weave = rugWeave(L);
  if (r.style === 'round') {
    const rad = Math.min(r.len, r.wide) / 2;
    return [
      textured('rug', 'world', weave, roundRug(rad, 0.006), { position: [r.cx, 0.0005, r.cz], castShadow: false }),
      prop('rug-binding', 'world', 'fabric-grey', roundBinding(rad + 0.005, 0.03, 0.008), { position: [r.cx, 0.0005, r.cz], castShadow: false, receiveShadow: false }),
    ];
  }
  return [
    // XYZ order: the in-plane yaw is applied first, then the plane is laid flat
    textured('rug', 'world', weave, worldPlane(r.len, r.wide), { position: [r.cx, 0.006, r.cz], rotation: [-Math.PI / 2, 0, -r.yaw], castShadow: false }),
    prop('rug-binding', 'world', 'fabric-grey', rugBinding(r.len, r.wide, 0.03, 0.008), { position: [r.cx, 0.0005, r.cz], rotation: [0, r.yaw, 0], castShadow: false, receiveShadow: false }),
  ];
}

function treatmentParts(L: KitchenLayoutData, t: KWindowTreatment): Part[] {
  const out: Part[] = [];
  const modern = L.style === 'modern' || L.style === 'contemporary' || L.style === 'industrial' || L.style === 'scandinavian';
  const metal: UtilKind = modern ? 'matte-black' : 'brushed-brass';
  // the shell's jambs run from 0.6" proud of the wall back into it; the glass
  // is at z = 0, so an inside mount lives in that 0.6" in front of the glass
  const reveal = inch(0.3);
  switch (t.kind) {
    case 'roman-shade':
      out.push(prop(`${t.id}-shade`, t.wall, 'fabric-linen', romanShade(t.width + inch(4), 4, Math.min(0.08, t.height * 0.07), 0.045), {
        position: [t.x, t.head, inch(1.2)], castShadow: false,
      }));
      return out;
    case 'roller': {
      const drop = Math.max(0.05, t.height * 0.25);
      out.push(
        prop(`${t.id}-tube`, t.wall, 'white-plastic', rollerTube(t.width - 0.02, 0.02), { position: [t.x, t.head, reveal], castShadow: false }),
        prop(`${t.id}-panel`, t.wall, 'fabric-grey', chamferBox(t.width - 0.04, drop, 0.002, 0), { position: [t.x, t.head - 0.02 - drop / 2, reveal + 0.018], castShadow: false, receiveShadow: false }),
        prop(`${t.id}-hem`, t.wall, 'white-plastic', chamferBox(t.width - 0.04, 0.012, 0.008, 0.001), { position: [t.x, t.head - 0.02 - drop, reveal + 0.018], castShadow: false, receiveShadow: false }),
      );
      return out;
    }
    case 'curtains': {
      // panels stack off the glass; floor length unless a counter is in the way
      const overRun = L.runs.some((r) => r.wall === t.wall && t.x - t.width / 2 < r.x1 && t.x + t.width / 2 > r.x0);
      const bottom = overRun ? L.counterTopY + 0.03 : 0.012;
      const panelH = Math.max(0.3, t.head - 0.012 - bottom);
      const panelW = Math.min(0.7, Math.max(0.3, t.width * 0.32));
      const rodLen = t.width + 2 * panelW + 0.1;
      out.push(prop(`${t.id}-rod`, t.wall, metal, curtainRod(rodLen, 0.012, inch(3.5)), { position: [t.x, t.head, inch(3.5)], castShadow: false }));
      for (const sx of [-1, 1]) {
        out.push(prop(`${t.id}-panel${sx}`, t.wall, 'fabric-linen', curtainPanel(panelW, panelH), {
          position: [t.x + sx * (t.width / 2 + panelW / 2 - 0.06), bottom, inch(3.5) + 0.02], castShadow: false,
        }));
      }
      return out;
    }
    case 'blinds': {
      const pitch = inch(1.75);
      const span = t.height - inch(2.5);
      const n = Math.min(80, Math.max(2, Math.floor(span / pitch)));
      out.push(prop(`${t.id}-rail`, t.wall, 'white-plastic', chamferBox(t.width - 0.02, inch(1.2), inch(1.4), 0.001), { position: [t.x, t.head, reveal], castShadow: false }));
      out.push(prop(`${t.id}-slats`, t.wall, 'white-plastic', filletBox(t.width - 0.035, 0.0015, inch(2), 0.0006, 1), {
        instances: spaceAlong([t.x, t.head - inch(1.5), reveal], [t.x, t.sill + inch(1.2), reveal], n, { rotation: [0.5, 0, 0] }),
        castShadow: false, receiveShadow: false,
      }));
      return out;
    }
    default: {
      // cafe: a rod across the middle of the glass and a gathered lower panel
      const panelH = Math.max(0.15, t.head - t.sill - 0.02);
      out.push(
        prop(`${t.id}-rod`, t.wall, modern ? 'brushed-nickel' : 'brushed-brass', chamferBox(t.width - 0.01, 0.012, 0.012, 0.002), { position: [t.x, t.head, reveal], castShadow: false }),
        prop(`${t.id}-panel`, t.wall, 'fabric-linen', curtainPanel(t.width - 0.04, panelH), { position: [t.x, t.sill + 0.012, reveal + 0.012], castShadow: false }),
      );
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function decorParts(L: KitchenLayoutData): Part[] {
  const D = L.decor;
  const out: Part[] = [];
  for (const s of D.shelves) out.push(...shelfParts(L, s));
  for (const p of D.plants) {
    const host = p.hostId ? D.shelves.find((s) => s.id === p.hostId) : null;
    if (host?.enclosure?.rotationDeg) {
      const [x, z] = shelfPoint(host, p.x, p.z, true);
      out.push(...orientShelfParts(host, plantParts(L, { ...p, x, z })));
    } else out.push(...plantParts(L, p));
  }
  for (const a of D.art) out.push(...artParts(L, a));
  if (D.rug) out.push(...rugParts(L, D.rug));
  for (const t of D.treatments) out.push(...treatmentParts(L, t));
  return compact(out);
}
