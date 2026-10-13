/**
 * MANHATTAN — headless verification for BATHROOM LAYOUT STABILITY.
 *
 *   npx tsx scripts/check-bath-layout.ts
 *
 * The contract this guards is the user-visible bug "when adjusting the height
 * and widths of things, everything moves and isn't correct":
 *
 *   1. An edit to one dimension changes ONLY that dimension. Every fixture the
 *      edit does not name keeps its wall, its position along that wall, its
 *      width and its depth, to within 1e-9.
 *   2. The edited fixture's own ANCHOR does not move. A corner-snapped stall
 *      grows into the room from its corner; a wall-hung vanity grows about its
 *      declared centre. Neither ever walks along the wall.
 *   3. Derived choices are STICKY — which side the shower door opens, which
 *      corner a corner tub owns, which side the bench takes — because they are
 *      read off the declared spec values rather than the fitted result. A
 *      one-notch slider move can never flip them.
 *
 * Every control the Layout tab exposes is swept across its full range.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBathroomLayout, type BathLayout, type LDecor, type Placed } from '../src/components/scene/bathroom/layout';
import { bathroomElementBoxes } from '../src/lib/fit/boxes';
import { bathroomParams } from '../src/lib/fit/params';
import type { BathroomSpec } from '../src/lib/spec/types';

let failures = 0;
let checks = 0;
function fail(msg: string) { failures++; console.error(`  ✗ ${msg}`); }
function ok(msg: string) { console.log(`  ✓ ${msg}`); }

// --- the spec under test ---------------------------------------------------
function baseSpec(): BathroomSpec {
  return {
    roomType: 'bathroom',
    dims: { widthFt: 14, depthFt: 11, ceilingFt: 9 },
    style: 'transitional',
    layout: 'primary',
    vanity: { present: true, wall: 'left', t: 0.5, widthIn: 60, sinks: 2, style: 'freestanding', mirror: 'double', doorStyle: 'shaker' },
    shower: { present: true, wall: 'back', t: 0.85, widthIn: 48, depthIn: 38, enclosure: 'frameless-glass', niche: true, bench: true, curbless: false, fixtures: 'rain-plus-handheld' },
    tub: { present: true, wall: 'back', t: 0.18, kind: 'alcove', lengthIn: 60 },
    toilet: { present: true, wall: 'right', t: 0.45, style: 'one-piece' },
    wallTile: { height: 'shower-only' },
    openings: [
      { id: 'door', kind: 'door', wall: 'front', t: 0.5, widthFt: 2.67, heightFt: 6.67, sillFt: 0, style: null },
      { id: 'win', kind: 'window', wall: 'right', t: 0.82, widthFt: 2.5, heightFt: 3.33, sillFt: 3.83, style: 'standard' },
    ],
    lighting: { recessedCount: 4, sconces: 2, underCabinet: false, pendants: null, chandelier: false, colorTempK: 3000, naturalLight: 'medium' } as BathroomSpec['lighting'],
    decor: {
      // both hung pieces start on CLEAR wall, so "held position" below is a
      // real assertion and not "was crowded everywhere anyway"
      shelves: [{ wall: 'front', t: 0.2, widthIn: 30, count: 2, bottomFt: 4.8, depthIn: 8, spacingIn: 12, material: 'wood', styled: 'mixed' }],
      plants: [
        { kind: 'floor', wall: 'corner', t: 0.75, sizeFt: 4, form: 'tree' },
        { kind: 'counter', wall: 'left', t: 0.5, sizeFt: 0.8, form: 'succulent' },
        { kind: 'hanging', wall: 'back', t: 0.5, sizeFt: 2, form: 'trailing' },
      ],
      art: [{ wall: 'right', t: 0.5, widthIn: 20, heightIn: 24, centerFt: 5.3, frame: 'black' }],
      rug: { present: true, lengthFt: 5, widthFt: 2, style: 'runner' },
      windowTreatment: 'blinds',
      items: [], cabinetContents: [],
      counterStyling: 'minimal', stools: null,
    },
    materials: {} as BathroomSpec['materials'],
    detected: {} as BathroomSpec['detected'],
  };
}

type Key = 'vanity' | 'shower' | 'tub' | 'toilet';
const KEYS: Key[] = ['vanity', 'shower', 'tub', 'toilet'];

function get(L: BathLayout, k: Key): Placed | null {
  return (k === 'vanity' ? L.vanity : k === 'shower' ? L.shower : k === 'tub' ? L.tub : L.toilet) as Placed | null;
}

/**
 * The quantity that must survive a resize of the fixture itself: distance from
 * the anchored corner, or the declared centre fraction for a free-standing one.
 */
function invariant(p: Placed): number {
  return p.anchor === 'start' ? p.anchorA : p.anchor === 'end' ? p.len - p.anchorA : p.a / p.len;
}

/**
 * Position measured in the WALL's own frame, so that a fixture whose wall got
 * longer (because the room grew) does not read as having moved. A corner stall
 * on a wall that gains a foot has not moved: it is still in the corner.
 */
function relA(p: Placed): number {
  return p.anchor === 'start' ? p.anchorA : p.anchor === 'end' ? p.len - p.anchorA : p.a - p.len / 2;
}

/**
 * Is the brief physically possible at this room size? When the fixtures
 * declared on one wall are collectively wider than the wall, no solver can
 * separate them without discarding something, so the scene is only asked not
 * to crash — continuity is not meaningful there.
 */
function feasible(L: BathLayout): boolean {
  const ps = KEYS.map((k) => get(L, k)).filter((p): p is Placed => !!p);
  const perWall = new Map<string, { sum: number; n: number; len: number }>();
  for (const p of ps) {
    const e = perWall.get(p.wall) ?? { sum: 0, n: 0, len: p.len };
    e.sum += p.wantWidth;
    e.n += 1;
    perWall.set(p.wall, e);
  }
  // + the 50 mm clearance the solver holds between neighbours, so the boundary
  // case "fits exactly, with nothing to spare" counts as infeasible too.
  return [...perWall.values()].every((e) => e.sum + 0.05 * Math.max(0, e.n - 1) <= e.len);
}

function fingerprint(p: Placed | null): string {
  if (!p) return 'absent';
  return [p.wall, p.a.toFixed(9), p.width.toFixed(9), p.depth.toFixed(9), p.anchor].join('|');
}

interface Sweep {
  name: string;
  /** the fixture the control belongs to — everything else must not move */
  owner: Key | null;
  values: unknown[];
  apply: (s: BathroomSpec, v: unknown) => void;
  /** extra invariants read straight off the layout */
  sticky?: (L: BathLayout) => string;
  /** for a room-dimension sweep, only these fixtures keep an ABSOLUTE position */
  absoluteFor?: (L: BathLayout, k: Key) => boolean;
  /** the control changes a fixture's KIND, so its anchoring rule may legitimately change */
  kindChange?: boolean;
}

const range = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
};

const stickyString = (L: BathLayout) =>
  [
    L.shower ? `door:${L.shower.doorSide}` : 'door:-',
    L.shower ? `bench:${L.shower.bench}` : 'bench:-',
    L.tub ? `corner:${L.tub.corner ?? 'none'}` : 'corner:-',
    L.shower ? `lw:${L.shower.leftIsRoomWall}/rw:${L.shower.rightIsRoomWall}` : 'lw:-',
    L.vanity ? `sinks:${L.vanity.sinks}` : 'sinks:-',
  ].join(' ');

const SWEEPS: Sweep[] = [
  {
    name: 'vanity.widthIn 18→120',
    owner: 'vanity',
    values: range(18, 120, 1),
    apply: (s, v) => { s.vanity.widthIn = v as number; },
  },
  {
    name: 'shower.widthIn 30→96',
    owner: 'shower',
    values: range(30, 96, 1),
    apply: (s, v) => { s.shower.widthIn = v as number; },
    sticky: (L) => `${L.shower?.doorSide ?? '-'}/${L.tub?.corner ?? 'none'}`,
  },
  {
    name: 'shower.depthIn 30→72',
    owner: 'shower',
    values: range(30, 72, 1),
    apply: (s, v) => { s.shower.depthIn = v as number; },
    sticky: stickyString,
  },
  {
    name: 'tub.lengthIn 48→84',
    owner: 'tub',
    values: range(48, 84, 1),
    apply: (s, v) => { s.tub.lengthIn = v as number; },
    sticky: (L) => `${L.tub?.corner ?? 'none'}/${L.shower?.doorSide ?? '-'}`,
  },
  {
    name: 'wallTile.height (all 5)',
    owner: null,
    values: ['none', 'wainscot', 'shower-only', 'full', 'accent-wall'],
    apply: (s, v) => { s.wallTile.height = v as BathroomSpec['wallTile']['height']; },
    sticky: stickyString,
  },
  {
    name: 'dims.ceilingFt 7→14',
    owner: null,
    values: range(7, 14, 0.25),
    apply: (s, v) => { s.dims.ceilingFt = v as number; },
    sticky: stickyString,
  },
  {
    name: 'tub.kind (all 5)',
    owner: 'tub',
    values: ['alcove', 'freestanding', 'drop-in', 'clawfoot', 'corner'],
    apply: (s, v) => { s.tub.kind = v as BathroomSpec['tub']['kind']; },
    kindChange: true,
  },
  {
    name: 'toilet.style (all 4)',
    owner: 'toilet',
    values: ['two-piece', 'one-piece', 'wall-hung', 'smart'],
    kindChange: true,
    apply: (s, v) => { s.toilet.style = v as BathroomSpec['toilet']['style']; },
    sticky: (L) => `${L.shower?.doorSide ?? '-'}/${L.tub?.corner ?? 'none'}`,
  },
  {
    name: 'vanity.style (all 5)',
    owner: 'vanity',
    values: ['floating', 'freestanding', 'furniture', 'pedestal', 'console'],
    kindChange: true,
    apply: (s, v) => { s.vanity.style = v as BathroomSpec['vanity']['style']; },
    sticky: (L) => `${L.shower?.doorSide ?? '-'}/${L.tub?.corner ?? 'none'}`,
  },
  {
    name: 'dims.widthFt 8→24 (left/right fixtures hold absolute position)',
    owner: null,
    values: range(8, 24, 0.5),
    apply: (s, v) => { s.dims.widthFt = v as number; },
    sticky: stickyString,
    absoluteFor: (L, k) => { const p = get(L, k); return !!p && (p.wall === 'left' || p.wall === 'right'); },
  },
  {
    name: 'dims.depthFt 8→24 (back/front fixtures hold absolute position)',
    owner: null,
    values: range(8, 24, 0.5),
    apply: (s, v) => { s.dims.depthFt = v as number; },
    sticky: stickyString,
    absoluteFor: (L, k) => { const p = get(L, k); return !!p && (p.wall === 'back' || p.wall === 'front'); },
  },
];

/** Biggest step any one fixture is allowed to take between adjacent slider notches. */
const MAX_STEP = 0.12;

for (const sw of SWEEPS) {
  console.log(`\n${sw.name}`);
  const layouts = sw.values.map((v) => {
    const spec = baseSpec();
    sw.apply(spec, v);
    return { v, L: computeBathroomLayout(spec) };
  });
  const first = layouts[0];

  // 1 — a fixture the control does not name moves ONLY if the solver reports it
  //     was genuinely crowded. `displaced === 0` has to mean "did not move".
  for (const k of KEYS) {
    if (k === sw.owner) continue;
    checks++;
    const wantAbsolute = !sw.absoluteFor || sw.absoluteFor(first.L, k);
    let ref: Placed | null = null;
    let bad: string | null = null;
    let crowded = 0;
    for (const { v, L } of layouts) {
      const p = get(L, k);
      if (!p) { if (ref) { bad = `${k} vanished at ${String(v)}`; break; } continue; }
      if (p.displaced > 1e-9) { crowded++; ref = null; continue; }   // genuinely blocked here — re-baseline
      if (!ref) { ref = p; continue; }
      if (p.wall !== ref.wall) { bad = `${k}.wall ${ref.wall} → ${p.wall} at ${String(v)} with no collision`; break; }
      const same = wantAbsolute
        ? fingerprint(p) === fingerprint(ref)
        : Math.abs(invariant(p) - invariant(ref)) <= 1e-6 && p.width >= ref.width - 1e-6;
      if (!same) { bad = `${k} ${fingerprint(ref)} → ${fingerprint(p)} at ${String(v)} with displaced=0`; break; }
    }
    if (bad) fail(`${k} moved for no reason during "${sw.name}": ${bad}`);
    else ok(`${k} held ${wantAbsolute ? 'absolute' : 'anchor'} position${crowded ? ` (crowded at ${crowded}/${layouts.length} values)` : ''}`);
  }

  // 2 — the swept fixture's own anchor holds wherever it has clearance
  if (sw.owner) {
    checks++;
    let ref: Placed | null = null;
    let drift: string | null = null;
    for (const { v, L } of layouts) {
      const p = get(L, sw.owner);
      if (!p) continue;
      if (p.displaced > 1e-9) { ref = null; continue; }
      if (!ref) { ref = p; continue; }
      if (!sw.kindChange && p.anchor !== ref.anchor) { drift = `anchor mode ${ref.anchor} → ${p.anchor} at ${String(v)}`; break; }
      if (p.anchor === ref.anchor && Math.abs(invariant(p) - invariant(ref)) > 1e-6) {
        drift = `anchor point ${invariant(ref).toFixed(6)} → ${invariant(p).toFixed(6)} at ${String(v)}`; break;
      }
    }
    if (drift) fail(`${sw.owner} anchor moved during "${sw.name}": ${drift}`);
    else ok(`${sw.owner} kept its own anchor point wherever it fits`);
  }

  // 3 — sticky derived choices never flip
  if (sw.sticky) {
    checks++;
    const ref = sw.sticky(first.L);
    let flip: string | null = null;
    for (const { v, L } of layouts) {
      const got = sw.sticky(L);
      if (got !== ref) { flip = `"${ref}" → "${got}" at ${String(v)}`; break; }
    }
    if (flip) fail(`derived choice flipped during "${sw.name}": ${flip}`); else ok(`derived choices stayed sticky (${ref})`);
  }

  // 4 — CONTINUITY: nothing may jump between adjacent notches, even when the
  //     solver is shoving things around. A jump is what reads as "everything
  //     moved" when the user drags a slider one step.
  if (typeof sw.values[0] === 'number') {
    checks++;
    let jump: string | null = null;
    let skipped = 0;
    for (let i = 1; i < layouts.length && !jump; i++) {
      if (!feasible(layouts[i - 1].L) || !feasible(layouts[i].L)) { skipped++; continue; }
      for (const k of KEYS) {
        const a = get(layouts[i - 1].L, k), b = get(layouts[i].L, k);
        if (!a || !b || a.wall !== b.wall) continue;
        const da = Math.abs(relA(b) - relA(a)), dw = Math.abs(b.width - a.width), dd = Math.abs(b.depth - a.depth);
        const step = Math.max(da, dw, dd);
        if (step > MAX_STEP) { jump = `${k} jumped ${(step * 39.37).toFixed(1)}" between ${String(layouts[i - 1].v)} and ${String(layouts[i].v)}`; break; }
      }
    }
    if (jump) fail(`discontinuity during "${sw.name}": ${jump}`);
    else ok(`no fixture jumped more than ${(MAX_STEP * 39.37).toFixed(1)}" per notch${skipped ? ` (${skipped} infeasible room sizes skipped)` : ''}`);
  }

  // 5 — the swept fixture's own size tracks the control monotonically
  if (sw.owner && typeof sw.values[0] === 'number') {
    checks++;
    let regress: string | null = null;
    let prev = -Infinity;
    for (const { v, L } of layouts) {
      const p = get(L, sw.owner);
      if (!p) continue;
      const size = sw.name.includes('depthIn') ? p.depth : p.width;
      if (size < prev - 1e-9) { regress = `size went backwards at ${String(v)} (${prev.toFixed(4)} → ${size.toFixed(4)})`; break; }
      prev = size;
    }
    if (regress) fail(`${sw.owner} size not monotonic during "${sw.name}": ${regress}`); else ok(`${sw.owner} size tracks the control monotonically`);
  }

  // 6 — the décor follows the fixtures: it may move when they do, but it is
  //     always finite and always inside the room
  checks++;
  {
    let out: string | null = null;
    for (const { v, L } of layouts) {
      const bad = decorInRoom(L);
      if (bad) { out = `${bad} at ${String(v)}`; break; }
    }
    if (out) fail(`décor left the room during "${sw.name}": ${out}`); else ok('décor stayed finite and inside the room');
  }
}

// --- décor controls move ONLY their own piece --------------------------------
/**
 * Décor is placed AFTER the fixtures and reads them as obstacles, so no décor
 * control can move a fixture — that is asserted exactly, to 1e-9, with no
 * "unless crowded" escape. Between décor pieces the fixture rule applies: a
 * piece the control does not name moves only when the solver says it was
 * genuinely crowded (`displaced > 0`), and the swept piece's own declared
 * anchor holds wherever it has clearance.
 */
console.log('\ndécor stability');

type DecorKey = 'shelf0' | 'art0' | 'plant0' | 'plant1' | 'plant2' | 'rug';
const DECOR_KEYS: DecorKey[] = ['shelf0', 'art0', 'plant0', 'plant1', 'plant2', 'rug'];

function decorPiece(D: LDecor, key: DecorKey): { fp: string; displaced: number; anchor: number | null } | null {
  switch (key) {
    case 'shelf0': { const s = D.shelves[0]; return s ? { fp: [s.wall, s.a.toFixed(9), s.width.toFixed(9), s.bottom.toFixed(9), s.count].join('|'), displaced: s.displaced, anchor: s.anchorA } : null; }
    case 'art0': { const a = D.art[0]; return a ? { fp: [a.wall, a.a.toFixed(9), a.width.toFixed(9), a.centerY.toFixed(9)].join('|'), displaced: a.displaced, anchor: a.anchorA } : null; }
    case 'rug': { const r = D.rug; return r ? { fp: [r.x.toFixed(9), r.z.toFixed(9), r.length.toFixed(9), r.width.toFixed(9), r.yaw.toFixed(6)].join('|'), displaced: r.displaced, anchor: null } : null; }
    default: { const p = D.plants[Number(key.slice(5))]; return p ? { fp: [p.kind, p.x.toFixed(9), p.y.toFixed(9), p.z.toFixed(9), p.size.toFixed(9)].join('|'), displaced: p.displaced, anchor: null } : null; }
  }
}

function fixtureFingerprint(L: BathLayout): string {
  return KEYS.map((k) => { const p = get(L, k); return p ? `${fingerprint(p)}|${p.anchorA.toFixed(9)}` : 'absent'; }).join(' / ');
}

function decorInRoom(L: BathLayout): string | null {
  const D = L.decor;
  const hx = L.w / 2 + 1e-6, hz = L.d / 2 + 1e-6;
  const inRoom = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) => r.minX >= -hx && r.maxX <= hx && r.minZ >= -hz && r.maxZ <= hz;
  for (const [i, s] of D.shelves.entries()) { if (![s.a, s.width, s.bottom, s.spacing].every(Number.isFinite)) return `shelf[${i}] non-finite`; if (!inRoom(s.rect)) return `shelf[${i}] outside the room`; }
  for (const [i, a] of D.art.entries()) { if (![a.a, a.width, a.height, a.centerY].every(Number.isFinite)) return `art[${i}] non-finite`; if (!inRoom(a.rect)) return `art[${i}] outside the room`; }
  for (const [i, p] of D.plants.entries()) { if (![p.x, p.y, p.z, p.size, p.potD].every(Number.isFinite)) return `plant[${i}] non-finite`; if (Math.abs(p.x) > hx || Math.abs(p.z) > hz || p.y < -1e-9 || p.y > L.h) return `plant[${i}] outside the room`; }
  if (D.rug && !inRoom(D.rug.rect)) return 'rug outside the room';
  return null;
}

interface DecorSweep { name: string; owner: DecorKey; values: unknown[]; apply: (s: BathroomSpec, v: unknown) => void }
const DECOR_SWEEPS: DecorSweep[] = [
  { name: 'shelves[0].widthIn 8→72', owner: 'shelf0', values: range(8, 72, 1), apply: (s, v) => { s.decor.shelves[0].widthIn = v as number; } },
  { name: 'shelves[0].t 0→1', owner: 'shelf0', values: range(0, 1, 0.02), apply: (s, v) => { s.decor.shelves[0].t = v as number; } },
  { name: 'shelves[0].bottomFt 3→8', owner: 'shelf0', values: range(3, 8, 0.1), apply: (s, v) => { s.decor.shelves[0].bottomFt = v as number; } },
  { name: 'shelves[0].count 1→5', owner: 'shelf0', values: range(1, 5, 1), apply: (s, v) => { s.decor.shelves[0].count = v as number; } },
  { name: 'shelves[0].wall (all 4)', owner: 'shelf0', values: ['back', 'left', 'right', 'front'], apply: (s, v) => { s.decor.shelves[0].wall = v as BathroomSpec['vanity']['wall']; } },
  { name: 'art[0].widthIn 6→48', owner: 'art0', values: range(6, 48, 1), apply: (s, v) => { s.decor.art[0].widthIn = v as number; } },
  { name: 'art[0].t 0→1', owner: 'art0', values: range(0, 1, 0.02), apply: (s, v) => { s.decor.art[0].t = v as number; } },
  { name: 'art[0].centerFt 3→8', owner: 'art0', values: range(3, 8, 0.1), apply: (s, v) => { s.decor.art[0].centerFt = v as number; } },
  { name: 'plants[0].sizeFt 0.5→8 (floor tree)', owner: 'plant0', values: range(0.5, 8, 0.25), apply: (s, v) => { s.decor.plants[0].sizeFt = v as number; } },
  { name: 'plants[0].t 0→1 (which corner)', owner: 'plant0', values: range(0, 1, 0.05), apply: (s, v) => { s.decor.plants[0].t = v as number; } },
  { name: 'plants[1].t 0→1 (along the vanity)', owner: 'plant1', values: range(0, 1, 0.02), apply: (s, v) => { s.decor.plants[1].t = v as number; } },
  { name: 'plants[2].t 0→1 (hanging)', owner: 'plant2', values: range(0, 1, 0.02), apply: (s, v) => { s.decor.plants[2].t = v as number; } },
  { name: 'rug.lengthFt 1.5→10', owner: 'rug', values: range(1.5, 10, 0.25), apply: (s, v) => { s.decor.rug!.lengthFt = v as number; } },
  { name: 'rug.style (all 3)', owner: 'rug', values: ['runner', 'area', 'round'], apply: (s, v) => { s.decor.rug!.style = v as 'runner'; } },
];

checks++;
{
  const D = computeBathroomLayout(baseSpec()).decor;
  const crowded = DECOR_KEYS.filter((k) => (decorPiece(D, k)?.displaced ?? 0) > 1e-9);
  if (crowded.length) fail(`base spec décor is crowded before any sweep (${crowded.join(', ')}) — the sweeps below would prove nothing`);
  else ok('every base-spec décor piece sits exactly where it was declared (displaced = 0)');
}

for (const sw of DECOR_SWEEPS) {
  console.log(`\n${sw.name}`);
  const layouts = sw.values.map((v) => {
    const spec = baseSpec();
    sw.apply(spec, v);
    return { v, L: computeBathroomLayout(spec) };
  });

  // 1 — no fixture moves at all, ever
  checks++;
  const ref = fixtureFingerprint(layouts[0].L);
  const moved = layouts.find(({ L }) => fixtureFingerprint(L) !== ref);
  if (moved) fail(`a fixture moved during "${sw.name}" at ${String(moved.v)}`);
  else ok('vanity / shower / tub / toilet held position and anchor exactly');

  // 2 — other décor pieces move only when genuinely crowded
  for (const key of DECOR_KEYS) {
    if (key === sw.owner) continue;
    checks++;
    let base: string | null = null;
    let bad: string | null = null;
    let crowded = 0;
    for (const { v, L } of layouts) {
      const p = decorPiece(L.decor, key);
      if (!p) { if (base) { bad = `${key} vanished at ${String(v)}`; break; } continue; }
      if (p.displaced > 1e-9) { crowded++; base = null; continue; }
      if (!base) { base = p.fp; continue; }
      if (p.fp !== base) { bad = `${key} ${base} → ${p.fp} at ${String(v)} with displaced=0`; break; }
    }
    if (bad) fail(`${key} moved for no reason during "${sw.name}": ${bad}`);
    else ok(`${key} held position${crowded ? ` (crowded at ${crowded}/${layouts.length} values)` : ''}`);
  }

  // 3 — the swept piece keeps its declared anchor wherever it has clearance
  checks++;
  {
    let base: number | null = null;
    let drift: string | null = null;
    const declaredControl = /\.t 0→1|wall/.test(sw.name);
    for (const { v, L } of layouts) {
      const p = decorPiece(L.decor, sw.owner);
      if (!p || p.anchor === null || declaredControl) continue;
      if (p.displaced > 1e-9) { base = null; continue; }
      if (base === null) { base = p.anchor; continue; }
      if (Math.abs(p.anchor - base) > 1e-6) { drift = `${base.toFixed(6)} → ${p.anchor.toFixed(6)} at ${String(v)}`; break; }
    }
    if (drift) fail(`${sw.owner} anchor moved during "${sw.name}": ${drift}`);
    else ok(`${sw.owner} kept its own anchor${declaredControl ? ' (control names the anchor itself)' : ''}`);
  }

  // 4 — always finite, always inside the room
  checks++;
  {
    let out: string | null = null;
    for (const { v, L } of layouts) { const bad = decorInRoom(L); if (bad) { out = `${bad} at ${String(v)}`; break; } }
    if (out) fail(`décor left the room during "${sw.name}": ${out}`); else ok('every décor piece stayed finite and inside the room');
  }
}

// --- degenerate + hostile specs must never throw ---------------------------
console.log('\nhostile specs');
const hostile: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['empty object', {}],
  ['NaN dims', { dims: { widthFt: NaN, depthFt: NaN, ceilingFt: NaN } }],
  ['negative dims', { dims: { widthFt: -20, depthFt: -3, ceilingFt: -1 } }],
  ['tiny room, huge fixtures', { dims: { widthFt: 4, depthFt: 4, ceilingFt: 7 }, vanity: { present: true, wall: 'left', t: 0.02, widthIn: 120 }, shower: { present: true, wall: 'back', t: 0.99, widthIn: 96, depthIn: 72 }, tub: { present: true, wall: 'back', t: 0.5, kind: 'freestanding', lengthIn: 84 }, toilet: { present: true, wall: 'right', t: 1.4 } }],
  ['garbage strings', { dims: { widthFt: '9' }, style: 'martian', layout: 'sauna', vanity: { present: true, wall: 'ceiling', style: 'hovercraft', t: 'x' }, wallTile: { height: 'lots' } }],
  ['garbage décor', { dims: { widthFt: 8, depthFt: 8, ceilingFt: 8 }, vanity: { present: true, wall: 'left', t: 0.5, widthIn: 48, sinks: 1, style: 'floating' }, decor: { shelves: [null, { wall: 'roof', t: NaN, widthIn: -1, count: 1e9, bottomFt: 99, spacingIn: 0 }], plants: [{ kind: 'shelf', wall: 'island', t: 7, sizeFt: NaN, form: 'cactus' }, { kind: 'counter', wall: 'nowhere', t: -3, sizeFt: 1e9 }, { kind: 'hanging', sizeFt: 0 }], art: 'nope', rug: { present: true, lengthFt: 1e9, widthFt: NaN, style: 'oval' }, windowTreatment: 42, counterStyling: null, items: 'nope', cabinetContents: [null] } }],
  ['décor with no fixtures', { dims: { widthFt: 7, depthFt: 7, ceilingFt: 8 }, decor: { shelves: [{ wall: 'back', t: 0.5, widthIn: 36, count: 2, bottomFt: 5, depthIn: 8, spacingIn: 12, material: 'wood', styled: 'mixed' }], plants: [{ kind: 'counter', wall: 'back', t: 0.5, sizeFt: 1, form: 'herb' }, { kind: 'shelf', wall: 'left', t: 0.5, sizeFt: 1, form: 'trailing' }], art: [], rug: { present: true, lengthFt: 4, widthFt: 3, style: 'runner' }, windowTreatment: 'curtains', counterStyling: 'none' } }],
];
for (const [name, spec] of hostile) {
  checks++;
  try {
    const L = computeBathroomLayout(spec as BathroomSpec);
    const nums = [L.w, L.d, L.h, ...[L.vanity, L.shower, L.tub, L.toilet].flatMap((p) => (p ? [p.a, p.width, p.depth, p.anchorA] : []))];
    const decorBad = decorInRoom(L);
    if (nums.some((n) => !Number.isFinite(n))) fail(`${name}: produced a non-finite number`);
    else if (L.w <= 0 || L.d <= 0 || L.h <= 0) fail(`${name}: non-positive room`);
    else if (decorBad) fail(`${name}: ${decorBad}`);
    else ok(`${name} → ${L.w.toFixed(2)}×${L.d.toFixed(2)}×${L.h.toFixed(2)} m, all finite`);
  } catch (e) {
    fail(`${name}: threw ${(e as Error).message}`);
  }
}

// --- fixtures never overlap after solving -----------------------------------
console.log('\ncollision resolution');
{
  checks++;
  let worst = 0;
  let worstAt = '';
  for (let wf = 8; wf <= 18; wf += 0.5) {
    for (let vw = 24; vw <= 96; vw += 6) {
      const spec = baseSpec();
      spec.dims.widthFt = wf;
      spec.vanity.widthIn = vw;
      spec.vanity.wall = 'back';
      spec.vanity.t = 0.5;
      const L = computeBathroomLayout(spec);
      const rs = KEYS.map((key) => get(L, key)).filter((p): p is Placed => p !== null);
      // Skip physically impossible briefs: if the fixtures declared on one wall
      // are wider than that wall, no solver can separate them and the scene is
      // only asked not to crash.
      const perWall = new Map<string, number>();
      for (const r of rs) perWall.set(r.wall, (perWall.get(r.wall) ?? 0) + r.wantWidth);
      if ([...perWall.entries()].some(([wall, sum]) => sum > (rs.find((r) => r.wall === wall)?.len ?? 0))) continue;
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i].rect, b = rs[j].rect;
        const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        const o = Math.min(ox, oz);
        if (o > worst) { worst = o; worstAt = `w=${wf}ft vanity=${vw}in`; }
      }
    }
  }
  if (worst > 0.06) fail(`fixtures overlap by ${(worst * 39.37).toFixed(1)}" at ${worstAt}`);
  else ok(`no fixture overlap beyond ${(worst * 39.37).toFixed(2)}" across every feasible room/vanity combination`);
}

// --- cross-corner collision --------------------------------------------------
/**
 * A fixture on one wall meets a fixture on the ADJACENT wall at the corner: a
 * vanity centred on the left wall and a tub along the back wall from the left
 * corner, whose 36" footprint reaches 3 ft up the left wall. Same-wall
 * neighbours were always pulled apart; these two used to be left inside each
 * other. The contract: the less movable fixture (the tub, anchored in its
 * corner) does not move at all, the vanity slides along its own wall away
 * from the corner by the minimum, keeps its full width while there is room,
 * gives up width only once the far wall stops it, and never gets NARROWER as
 * its own slider goes up.
 */
console.log('\ncross-corner collision');
{
  const cornerSpec = (tubKind: BathroomSpec['tub']['kind'] = 'freestanding'): BathroomSpec => {
    const s = baseSpec();
    s.dims = { widthFt: 10, depthFt: 10, ceilingFt: 9 };
    s.vanity = { ...s.vanity, wall: 'left', t: 0.5, widthIn: 60 };
    s.tub = { present: true, wall: 'back', t: 0.25, kind: tubKind, lengthIn: 66 };
    s.shower = { ...s.shower, t: 0.85 };          // back-right corner, clear of the tub
    s.toilet = { ...s.toilet, wall: 'right', t: 0.55 }; // forward of the stall's footprint
    return s;
  };
  const sep = (a: Placed, b: Placed) => {
    const ox = Math.min(a.rect.maxX, b.rect.maxX) - Math.max(a.rect.minX, b.rect.minX);
    const oz = Math.min(a.rect.maxZ, b.rect.maxZ) - Math.max(a.rect.minZ, b.rect.minZ);
    return -Math.min(ox, oz); // > 0 = clear by that much on at least one axis
  };
  const inRoom = (L: BathLayout, p: Placed) => p.rect.minX >= -L.w / 2 - 1e-6 && p.rect.maxX <= L.w / 2 + 1e-6 && p.rect.minZ >= -L.d / 2 - 1e-6 && p.rect.maxZ <= L.d / 2 + 1e-6;

  // 1 — the vanity yields, the corner-anchored tub does not
  checks++;
  {
    const both = computeBathroomLayout(cornerSpec());
    const solo = cornerSpec(); solo.vanity.present = false;
    const tubAlone = computeBathroomLayout(solo).tub!;
    const v = both.vanity!, t = both.tub!;
    const declaredA = 0.5 * v.len;
    const problems: string[] = [];
    if (fingerprint(t) !== fingerprint(tubAlone) || t.displaced > 1e-9) problems.push(`tub moved (${fingerprint(tubAlone)} → ${fingerprint(t)}, displaced ${t.displaced.toFixed(3)})`);
    if (sep(v, t) < 0.04) problems.push(`vanity still inside the tub (clear by ${(sep(v, t) * 1000).toFixed(0)} mm)`);
    if (v.displaced <= 1e-9) problems.push('vanity reports displaced = 0 although it had to move');
    if (v.width < v.wantWidth - 1e-9) problems.push(`vanity lost width it had room for (${v.width.toFixed(3)} < ${v.wantWidth.toFixed(3)})`);
    if (v.wall !== 'left' || !inRoom(both, v)) problems.push('vanity left its wall or the room');
    if (!(v.a < declaredA)) problems.push(`vanity did not slide away from the corner (a ${v.a.toFixed(3)} vs declared ${declaredA.toFixed(3)})`);
    // the minimum: declared back edge (z = -width/2, the wall is centred on z = 0) to the tub's front edge, plus the 50 mm the solver holds
    const minimum = t.rect.maxZ + 0.05 + v.width / 2;
    if (Math.abs((declaredA - v.a) - minimum) > 0.006) problems.push(`vanity slid ${((declaredA - v.a) * 1000).toFixed(0)} mm, the minimum is ${(minimum * 1000).toFixed(0)} mm`);
    if (problems.length) fail(`vanity ∩ tub at the back-left corner: ${problems.join('; ')}`);
    else ok(`vanity slid ${((declaredA - v.a) * 39.37).toFixed(1)}" along the left wall, full width kept, tub untouched, clear by ${(sep(v, t) * 1000).toFixed(0)} mm`);
  }

  // 2 — under the vanity's own width slider: the tub never moves, the vanity's
  //     anchor holds while it has clearance, its width never goes backwards,
  //     nothing jumps, and nothing ever overlaps
  checks++;
  {
    const layouts = range(18, 120, 1).map((v) => { const s = cornerSpec(); s.vanity.widthIn = v; return { v, L: computeBathroomLayout(s) }; });
    const tubRef = fingerprint(layouts[0].L.tub);
    let bad: string | null = null;
    let prevW = -Infinity;
    let clearAt = 0;
    for (let i = 0; i < layouts.length && !bad; i++) {
      const { v, L } = layouts[i];
      const vanity = L.vanity!, tub = L.tub!;
      if (fingerprint(tub) !== tubRef || tub.displaced > 1e-9) { bad = `tub moved at ${v}"`; break; }
      const overlap = KEYS.flatMap((k, i) => KEYS.slice(i + 1).map((j) => [k, j] as const)).find(([k, j]) => { const a = get(L, k), b = get(L, j); return !!a && !!b && sep(a, b) < 0; });
      if (overlap) { bad = `${overlap[0]} ∩ ${overlap[1]} overlap by ${(-sep(get(L, overlap[0])!, get(L, overlap[1])!) * 1000).toFixed(0)} mm at ${v}"`; break; }
      if (vanity.displaced <= 1e-9) { clearAt++; if (Math.abs(vanity.anchorA - 0.5 * vanity.len) > 1e-6) { bad = `vanity anchor moved with displaced = 0 at ${v}"`; break; } }
      if (vanity.width < prevW - 1e-9) { bad = `vanity got narrower as its slider went up (${prevW.toFixed(4)} → ${vanity.width.toFixed(4)} at ${v}")`; break; }
      prevW = vanity.width;
      if (i > 0) {
        const p = layouts[i - 1].L.vanity!;
        const step = Math.max(Math.abs(relA(vanity) - relA(p)), Math.abs(vanity.width - p.width));
        if (step > MAX_STEP) { bad = `vanity jumped ${(step * 39.37).toFixed(1)}" between ${layouts[i - 1].v} and ${v}"`; break; }
      }
    }
    if (bad) fail(`vanity.widthIn 18→120 against the corner tub: ${bad}`);
    else ok(`vanity.widthIn 18→120 against the corner tub: tub never moved, no overlap, anchor held at ${clearAt}/${layouts.length} clear widths, width monotonic, no jumps`);
  }

  // 3 — the same corner from the other side: a stall in the back-left corner
  //     (start-anchored) and the vanity on the left wall. The stall is the least
  //     movable fixture of all, so again only the vanity moves.
  checks++;
  {
    const s = cornerSpec();
    s.tub.present = false;
    s.shower = { ...s.shower, t: 0.1, widthIn: 48, depthIn: 42 };
    const L = computeBathroomLayout(s);
    const solo = { ...s, vanity: { ...s.vanity, present: false } };
    const stallAlone = computeBathroomLayout(solo).shower!;
    const v = L.vanity!, st = L.shower!;
    const problems: string[] = [];
    if (fingerprint(st) !== fingerprint(stallAlone) || st.displaced > 1e-9) problems.push('stall moved');
    if (sep(v, st) < 0.04) problems.push(`vanity inside the stall (clear by ${(sep(v, st) * 1000).toFixed(0)} mm)`);
    if (v.displaced <= 1e-9 || v.width < v.wantWidth - 1e-9 || !inRoom(L, v)) problems.push('vanity did not simply slide clear');
    if (problems.length) fail(`vanity ∩ stall at the back-left corner: ${problems.join('; ')}`);
    else ok('vanity ∩ stall at the back-left corner: vanity slid clear, stall untouched');
  }

  // 4 — last resort: a 66" corner tub reaches so far up the left wall that a
  //     full-width vanity cannot slide clear of it before the front wall stops
  //     it. It must then give up width — and still not overlap, still not
  //     move the tub, still be inside the room.
  checks++;
  {
    const L = computeBathroomLayout(cornerSpec('corner'));
    const solo = cornerSpec('corner'); solo.vanity.present = false;
    const tubAlone = computeBathroomLayout(solo).tub!;
    const v = L.vanity!, t = L.tub!;
    const problems: string[] = [];
    if (fingerprint(t) !== fingerprint(tubAlone) || t.displaced > 1e-9) problems.push('corner tub moved');
    if (sep(v, t) < 0.04) problems.push(`vanity inside the corner tub (clear by ${(sep(v, t) * 1000).toFixed(0)} mm)`);
    if (!(v.width < v.wantWidth) || v.width < 0.5) problems.push(`vanity width ${v.width.toFixed(3)} (wanted ${v.wantWidth.toFixed(3)})`);
    if (v.a - v.width / 2 > 0.02) problems.push('vanity was shrunk before it had reached the front wall');
    if (!inRoom(L, v)) problems.push('vanity left the room');
    if (problems.length) fail(`vanity ∩ 66" corner tub: ${problems.join('; ')}`);
    else ok(`vanity ∩ 66" corner tub: vanity pushed to the front wall and shortened to ${(v.width * 39.37).toFixed(1)}", tub untouched, no overlap`);
  }
}


// --- fit levers: every searchable field must actually be searchable ---------
/**
 * `bathroomParams` is what the photo fit is allowed to change. A lever that
 * moves nothing the fitter can SEE is worse than no lever: it costs a search
 * axis, it lets the gate wave through a number nobody measured, and it makes
 * "the fit corrected the bathroom" a claim about a field the score never
 * touched. So each bathroom lever is asserted three ways:
 *
 *   1. it MOVES a projected element box (`bathroomElementBoxes` is the fit's
 *      own view of the twin — if a change is invisible there, it is invisible
 *      to the fit);
 *   2. its bounds are the LAYOUT's bounds — driven to either end, the layout
 *      gives the value back rather than clamping it, so the search never
 *      scores a spec that is not the spec it asked for;
 *   3. `get` reads back what `set` wrote, so a coordinate-descent step of a
 *      known size is a step of that size.
 */
console.log('\nfit levers');
{
  const demo = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'demo-bathroom.spec.json'), 'utf8')) as { spec?: BathroomSpec } & BathroomSpec;
  const base = (demo.spec ?? demo) as BathroomSpec;
  const clone = () => JSON.parse(JSON.stringify(base)) as BathroomSpec;
  const boxSig = (sp: BathroomSpec) => bathroomElementBoxes(computeBathroomLayout(sp))
    .map((e) => `${e.kind}@${e.wall}#${e.index}:${e.box.min.map((n) => n.toFixed(4))}|${e.box.max.map((n) => n.toFixed(4))}`).join('\n');
  const at0 = boxSig(base);
  const params = bathroomParams(base);
  /** the levers this stream owns; the room, its openings and its décor are shared */
  const mine = params.filter((p) => /^(vanity|shower|tub|toilet)\./.test(p.label));

  checks++;
  if (mine.length < 11) fail(`only ${mine.length} bathroom fit levers — a bathroom cannot be corrected from a photo with fewer`);
  else ok(`${mine.length} bathroom fit levers (${params.length} with the room, its openings and its décor)`);

  const dead: string[] = [];
  const unbounded: string[] = [];
  const lossy: string[] = [];
  for (const p of mine) {
    const from = p.get(base);
    // A nudge a fifth of the way to each end: big enough to clear float noise,
    // small enough that the layout cannot refuse it. BOTH directions, because
    // a fixture that already fills its wall cannot grow — that is the room
    // talking, not a dead lever, and the same lever shrinks perfectly well.
    const tries = [from + (p.dim.max - from) / 5, from - (from - p.dim.min) / 5].filter((v) => Math.abs(v - from) > 1e-9);
    let moved = false;
    for (const to of tries) {
      const sp = clone();
      p.set(sp, to);
      if (boxSig(sp) !== at0) moved = true;
      if (Math.abs(p.get(sp) - to) > 1e-6) lossy.push(`${p.label}: set ${to.toFixed(2)}, get ${p.get(sp)}`);
    }
    if (!moved) dead.push(`${p.label} (from ${from}, tried ${tries.map((v) => v.toFixed(2)).join(' and ')})`);
    /**
     * The two ENDS of the search range must be different rooms. This is the
     * honest form of "the range is searchable": a range the layout clamps at
     * one end is fine — a 120" vanity does not fit a 10 ft wall, and refusing
     * to draw one is right — but a range whose ends are indistinguishable is a
     * coordinate the fit can slide along for free, which is how a gate lets
     * through a number the picture never constrained.
     */
    const lo = clone(); p.set(lo, p.dim.min);
    const hi = clone(); p.set(hi, p.dim.max);
    if (!Number.isFinite(computeBathroomLayout(lo).w) || !Number.isFinite(computeBathroomLayout(hi).w)) unbounded.push(`${p.label}: the layout failed at an end of the range`);
    else if (boxSig(lo) === boxSig(hi)) unbounded.push(`${p.label}: ${p.dim.min} and ${p.dim.max} build the identical room`);
  }
  checks++;
  if (dead.length) fail(`fit levers that move no projected box: ${dead.join('; ')}`);
  else ok(`every bathroom lever moves the twin where the fit can see it (${mine.map((p) => p.label).join(', ')})`);
  checks++;
  if (lossy.length) fail(`a lever did not read back what it wrote: ${lossy.join('; ')}`);
  else ok('every lever reads back exactly what it wrote');
  checks++;
  if (unbounded.length) fail(`a lever's range is not searchable: ${unbounded.join('; ')}`);
  else ok('every lever’s range spans two genuinely different rooms');

  // The new levers are MONOTONIC where a photo measures them: taller vanity =
  // higher counter, deeper vanity = further into the room, wider tub = deeper
  // footprint. Coordinate descent needs the gradient to point one way.
  const monotone: Array<[string, (s: BathroomSpec, v: number) => void, (L: BathLayout) => number]> = [
    ['vanity.heightIn', (sp, v) => { sp.vanity.heightIn = v; }, (L) => L.vanity!.topH],
    ['vanity.depthIn', (sp, v) => { sp.vanity.depthIn = v; }, (L) => L.vanity!.bodyDepth],
    ['tub.widthIn', (sp, v) => { sp.tub.widthIn = v; }, (L) => L.tub!.across],
  ];
  for (const [label, apply, read] of monotone) {
    checks++;
    const seen: number[] = [];
    for (let v = 24; v <= 40; v += 1) { const sp = clone(); apply(sp, v); seen.push(read(computeBathroomLayout(sp))); }
    const rising = seen.every((n, i) => i === 0 || n >= seen[i - 1] - 1e-9);
    const moved = seen[seen.length - 1] - seen[0];
    if (rising && moved > 0.05) ok(`${label} is monotonic over its useful range (${(moved * 1000).toFixed(0)} mm of travel)`);
    else fail(`${label} is not monotonic: ${seen.map((n) => n.toFixed(3)).join(' ')}`);
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
