/**
 * MANHATTAN — whole-tree scene verification.
 *
 *   npx tsx scripts/verify-scenes.mts
 *
 * This is the cross-stream guard. The per-stream scripts (check-kitchen,
 * check-bathroom, check-bath-layout, check-exterior) each verify their own area
 * with a HAND-WRITTEN snapshot of the fields that stream thought mattered. This
 * script deliberately does not: it walks the WHOLE layout object generically, so
 * a field a stream forgot to snapshot is still covered.
 *
 *   1. BUILD      every scene solves and every number in it is finite.
 *   2. CONTAIN    nothing sits outside the room / off the lot / through a ceiling.
 *   3. STABILITY  every Layout-tab slider is swept across its full range and the
 *                 whole layout is diffed. A control may only move what it names
 *                 (user issue 4). Anchors are asserted separately and exactly.
 *   4. BUDGET     draw calls + triangles per scene against 900 / 1.2 M.
 *   5. RENDER     things that will look wrong: zero/negative sizes, props at the
 *                 world origin, empty instanced batches, materials with no map.
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultKitchen, defaultBathroom, defaultExterior } from '../src/lib/spec/defaults';
import type { KitchenSpec, BathroomSpec, ExteriorSpec } from '../src/lib/spec/types';
import { computeKitchenLayout, type KitchenLayoutData } from '../src/components/scene/kitchen/layout';
import { computeBathroomLayout, type BathLayout } from '../src/components/scene/bathroom/layout';
import { tileCourses } from '../src/components/scene/bathroom/helpers';
import { computeExteriorLayout, type ExteriorLayout } from '../src/components/scene/exterior/layout';
import { kitchenGeometryBudget } from '../src/components/scene/kitchen/budget';
import { report as exteriorBudgetReport } from './check-exterior-geometry';
import { CATALOG, DEFAULT_SELECTIONS, getMaterial } from '../src/lib/materials/catalog';
import { defaultFloorPlan } from '../src/lib/spec/defaults';
import type { FloorPlanSpec, Level, PlanStair } from '../src/lib/spec/types';
import { computeFloorPlanLayout, floorPlanBudget, type FloorPlanLayout } from '../src/components/scene/floorplan';
import { healFloorPlan, houseAreaSqft, planBounds } from '../src/lib/spec/floorplan';
import { ft } from '../src/lib/units';

const TRI_BUDGET = 1_200_000;
const CALL_BUDGET = 900;
/** 0.5 mm — below this, a "move" is float noise, not something a user can see. */
const TOL = 5e-4;

// ---------------------------------------------------------------------------
// Result table
// ---------------------------------------------------------------------------
interface Row { section: string; name: string; pass: boolean; detail: string }
const rows: Row[] = [];
const pass = (section: string, name: string, detail = '') => rows.push({ section, name, pass: true, detail });
const fail = (section: string, name: string, detail: string) => rows.push({ section, name, pass: false, detail });
const notes: string[] = [];

// ---------------------------------------------------------------------------
// Generic deep snapshot
// ---------------------------------------------------------------------------
/** An array element with no `id` is compared as an unordered signature. */
interface Sig { nums: Record<string, number>; strs: Record<string, string> }
interface Snap {
  scalars: Map<string, number>;
  strings: Map<string, string>;
  /** array path -> signatures, for arrays whose elements carry no stable id */
  bags: Map<string, Sig[]>;
}

const emptySnap = (): Snap => ({ scalars: new Map(), strings: new Map(), bags: new Map() });

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sigOf(v: unknown, prefix: string, sig: Sig, depth: number): void {
  if (depth > 8 || v === null || v === undefined) return;
  if (typeof v === 'number') { sig.nums[prefix] = v; return; }
  if (typeof v === 'boolean') { sig.nums[prefix] = v ? 1 : 0; return; }
  if (typeof v === 'string') { sig.strs[prefix] = v; return; }
  if (Array.isArray(v)) { v.forEach((e, i) => sigOf(e, `${prefix}[${i}]`, sig, depth + 1)); return; }
  if (isPlain(v)) for (const k of Object.keys(v).sort()) sigOf(v[k], prefix ? `${prefix}.${k}` : k, sig, depth + 1);
}

/**
 * Prose ABOUT the layout, not layout. `ExteriorLayout.warnings` (and the
 * kitchen's / bathroom's décor warnings) say in English what the solver had to
 * assume; they move whenever the thing they describe moves, which is correct
 * and would otherwise read to these sweeps as an unrelated key wandering — a
 * taller house legitimately gets more assumed windows on its wing, and saying
 * so is not the house sliding.
 */
const NOT_GEOMETRY = /(^|\.)warnings(\.|\[|$)/;

function walk(v: unknown, path: string, s: Snap, depth = 0): void {
  if (depth > 10 || v === null || v === undefined || NOT_GEOMETRY.test(path)) return;
  if (typeof v === 'number') { s.scalars.set(path, v); return; }
  if (typeof v === 'boolean') { s.scalars.set(path, v ? 1 : 0); return; }
  if (typeof v === 'string') { s.strings.set(path, v); return; }
  if (Array.isArray(v)) {
    s.scalars.set(`${path}.@count`, v.length);
    const ided = v.length > 0 && v.every((e) => isPlain(e) && typeof e.id === 'string' && e.id.length > 0);
    if (ided) {
      const used = new Map<string, number>();
      for (const e of v as Array<Record<string, unknown>>) {
        const raw = String(e.id);
        const n = (used.get(raw) ?? 0) + 1;
        used.set(raw, n);
        walk(e, `${path}#${raw}${n > 1 ? `~${n}` : ''}`, s, depth + 1);
      }
      return;
    }
    if (v.length > 0 && v.every(isPlain)) {
      s.bags.set(path, v.map((e) => { const sig: Sig = { nums: {}, strs: {} }; sigOf(e, '', sig, 0); return sig; }));
      return;
    }
    v.forEach((e, i) => walk(e, `${path}[${i}]`, s, depth + 1));
    return;
  }
  if (isPlain(v)) for (const k of Object.keys(v).sort()) walk(v[k], path ? `${path}.${k}` : k, s, depth + 1);
}

function snapshot(L: unknown): Snap { const s = emptySnap(); walk(L, '', s); return s; }

/** Every number in the layout, path-tagged — used for the finiteness scan. */
function allNumbers(s: Snap): Array<[string, number]> {
  const out: Array<[string, number]> = [...s.scalars];
  for (const [p, sigs] of s.bags) sigs.forEach((sig, i) => { for (const [k, n] of Object.entries(sig.nums)) out.push([`${p}[${i}].${k}`, n]); });
  return out;
}

/** `a.b` matches `a.b`, `a.b.c`, `a.b[0]`, `a.b#id`.
 *  `*` stands for any run of characters inside ONE path segment, so
 *  `runs*.uppers*.contents` names that one field on every upper of every run
 *  without opening the whole `runs` subtree. A trailing `a.*` therefore still
 *  matches `a.b` and, by the extension rule, `a.b.c`. */
const matchRe = new Map<string, RegExp>();
function matches(pattern: string, path: string): boolean {
  let re = matchRe.get(pattern);
  if (!re) {
    const body = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^.]*');
    re = new RegExp(`^${body}($|\\.|\\[|#)`);
    matchRe.set(pattern, re);
  }
  return re.test(path);
}

function sigEqual(a: Sig, b: Sig, allowed: (field: string) => boolean = () => false): boolean {
  const nk = new Set([...Object.keys(a.nums), ...Object.keys(b.nums)]);
  for (const k of nk) {
    if (allowed(k)) continue;
    const x = a.nums[k], y = b.nums[k];
    if (x === undefined || y === undefined) return false;
    if (!(Math.abs(x - y) <= TOL)) return false;
  }
  const sk = new Set([...Object.keys(a.strs), ...Object.keys(b.strs)]);
  for (const k of sk) if (!allowed(k) && a.strs[k] !== b.strs[k]) return false;
  return true;
}

/** Everything that differs between two layouts, minus what `allowed` permits. */
function diff(base: Snap, next: Snap, allowed: string[]): string[] {
  const ok = (p: string) => allowed.some((a) => matches(a, p));
  const out: string[] = [];
  for (const k of new Set([...base.scalars.keys(), ...next.scalars.keys()])) {
    if (ok(k)) continue;
    const a = base.scalars.get(k), b = next.scalars.get(k);
    if (a === undefined || b === undefined) { out.push(`${k}: ${a === undefined ? 'appeared' : 'disappeared'}`); continue; }
    if (Math.abs(a - b) > TOL) out.push(`${k}: ${a.toFixed(4)} → ${b.toFixed(4)}`);
  }
  for (const k of new Set([...base.strings.keys(), ...next.strings.keys()])) {
    if (ok(k)) continue;
    const a = base.strings.get(k), b = next.strings.get(k);
    if (a !== b) out.push(`${k}: ${a ?? '—'} → ${b ?? '—'}`);
  }
  for (const k of new Set([...base.bags.keys(), ...next.bags.keys()])) {
    if (ok(k)) continue;
    const a = base.bags.get(k) ?? [], b = next.bags.get(k) ?? [];
    if (a.length !== b.length) { out.push(`${k}: ${a.length} → ${b.length} items`); continue; }
    const taken = new Set<number>();
    for (const eb of b) {
      // Unkeyed object arrays need the same field-level exclusions as keyed
      // arrays; permitting one derived field must not permit an entire bag.
      const i = a.findIndex((ea, idx) => !taken.has(idx) && sigEqual(ea, eb, (field) => ok(`${k}.${field}`)));
      if (i < 0) { out.push(`${k}: an element moved`); break; }
      taken.add(i);
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Sweep runner
// ---------------------------------------------------------------------------
interface Sweep<S> {
  name: string;
  values: Array<number | string | boolean>;
  apply: (s: S, v: never) => void;
  /** paths this control is allowed to change */
  mayMove: string[];
  /** must hold EXACTLY (to TOL) across the whole sweep — the anchor contract */
  anchors?: Array<{ label: string; get: (L: never) => number | null }>;
  /**
   * The Layout-tab controls this sweep exercises, BY THEIR `ariaLabel`.
   *
   * `bathroomControlLabels()` reads those labels straight out of LayoutPanel.tsx
   * and every one of them must be claimed here or listed in `EXEMPT_CONTROLS`,
   * so a new control cannot ship without entering the sweep. That is the hole
   * 26 dead bathroom controls walked through: the sweep asserted "a control may
   * only move what it names", which a control that moves NOTHING passes.
   */
  controls?: string[];
  /**
   * Set only where a control legitimately cannot move the layout on its own —
   * with the reason. Everything else MUST move something: see `mustMove` below.
   */
  movesNothing?: string;
}

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const range = (a: number, b: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
};

/** Every `ariaLabel` any sweep claims to exercise, so the coverage gate can check them off. */
const claimedControls = new Set<string>();

function runSweeps<S, L>(section: string, base: S, solve: (s: S) => L, sweeps: Array<Sweep<S>>): void {
  for (const sw of sweeps) {
    for (const c of sw.controls ?? []) claimedControls.add(c);
    let baseSnap: Snap | null = null;
    let baseV: unknown = null;
    const bad = new Map<string, string>();
    const drift = new Map<string, number>();
    let threw = '';
    let nonFinite = '';
    let moved = false;
    for (const v of sw.values) {
      const spec = clone(base);
      let L: L;
      try { sw.apply(spec, v as never); L = solve(spec); }
      catch (e) { threw = `threw at ${String(v)} — ${(e as Error).message}`; break; }
      const snap = snapshot(L);
      for (const [p, n] of allNumbers(snap)) {
        if (!Number.isFinite(n)) { nonFinite ||= `${p} = ${n} at ${String(v)}`; break; }
      }
      for (const a of sw.anchors ?? []) {
        const cur = a.get(L as never);
        if (cur === null || !Number.isFinite(cur)) continue;
        const ref = drift.has(`__ref:${a.label}`) ? drift.get(`__ref:${a.label}`)! : (drift.set(`__ref:${a.label}`, cur), cur);
        drift.set(a.label, Math.max(drift.get(a.label) ?? 0, Math.abs(cur - ref)));
      }
      if (baseSnap === null) { baseSnap = snap; baseV = v; continue; }
      // The INVERSE assertion. `mayMove` only says what a control is allowed to
      // touch, so a control wired to nothing satisfies it trivially — which is
      // exactly how a Layout tab full of dead sliders stayed green.
      if (!moved && diff(baseSnap, snap, []).length > 0) moved = true;
      for (const d of diff(baseSnap, snap, sw.mayMove)) {
        const key = d.split(':')[0];
        if (!bad.has(key)) bad.set(key, `${String(baseV)}→${String(v)}  ${d}`);
      }
    }
    const anchorBad = [...drift].filter(([k, v]) => !k.startsWith('__ref:') && v > TOL);
    if (threw) fail(section, sw.name, threw);
    else if (nonFinite) fail(section, sw.name, `non-finite ${nonFinite}`);
    else if (anchorBad.length) fail(section, sw.name, `ANCHOR MOVED — ${anchorBad.map(([k, v]) => `${k} by ${v.toFixed(4)} m`).join(', ')}`);
    else if (bad.size) fail(section, sw.name, `${bad.size} unrelated key(s) moved — ${[...bad.values()].slice(0, 4).join(' | ')}${bad.size > 4 ? ` …+${bad.size - 4}` : ''}`);
    else if (!moved && !sw.movesNothing) fail(section, sw.name, `DEAD CONTROL — ${sw.values.length} distinct values leave the layout byte-identical, so nothing it says can reach a triangle`);
    else {
      const anchorNote = (sw.anchors ?? []).length
        ? `, anchors held (max drift ${Math.max(0, ...[...drift].filter(([k]) => !k.startsWith('__ref:')).map(([, v]) => v)).toExponential(1)} m)`
        : '';
      pass(section, sw.name, `${sw.values.length} steps${anchorNote}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. BUILD + finiteness
// ---------------------------------------------------------------------------
const EXT_STYLES: Array<ExteriorSpec['houseStyle']> =
  ['modern-farmhouse', 'craftsman', 'northwest-contemporary', 'modern', 'ranch', 'colonial', 'mediterranean'];

const kitchenL = computeKitchenLayout(defaultKitchen());
const bathL = computeBathroomLayout(defaultBathroom());
const extL = new Map<string, ExteriorLayout>();
for (const st of EXT_STYLES) extL.set(st, computeExteriorLayout(defaultExterior(st)));

const planL = computeFloorPlanLayout(defaultFloorPlan());

const scenes: Array<[string, unknown]> = [
  ['kitchen (default)', kitchenL],
  ['bathroom (default)', bathL],
  ['floorplan (demo house)', planL],
  ...[...extL].map(([k, v]) => [`exterior ${k}`, v] as [string, unknown]),
];

for (const [name, L] of scenes) {
  const bad = allNumbers(snapshot(L)).filter(([, n]) => !Number.isFinite(n));
  if (bad.length) fail('1 BUILD', `${name}: finite`, `${bad.length} non-finite — ${bad.slice(0, 5).map(([p, n]) => `${p}=${n}`).join(', ')}`);
  else pass('1 BUILD', `${name}: finite`, `${allNumbers(snapshot(L)).length} numbers`);
}

// ---------------------------------------------------------------------------
// 2. CONTAINMENT
// ---------------------------------------------------------------------------
interface R { minX: number; maxX: number; minZ: number; maxZ: number }
const inside = (r: R, hw: number, hd: number, tol = 2e-3) =>
  r.minX >= -hw - tol && r.maxX <= hw + tol && r.minZ >= -hd - tol && r.maxZ <= hd + tol;
const overflow = (r: R, hw: number, hd: number) =>
  Math.max(-hw - r.minX, r.maxX - hw, -hd - r.minZ, r.maxZ - hd);

function containKitchen(name: string, L: KitchenLayoutData): void {
  const hw = L.w / 2, hd = L.d / 2;
  const out: string[] = [];
  const check = (label: string, r: R | null | undefined) => { if (r && !inside(r, hw, hd)) out.push(`${label} by ${overflow(r, hw, hd).toFixed(3)} m`); };
  L.rects.forEach((r, i) => check(`rects[${i}]`, r));
  L.runs.forEach((r) => check(`run ${r.id}`, r.rect));
  L.appliances.forEach((a) => check(`appliance ${a.id}`, a.rect));
  check('island', L.island?.rect);
  const tall: string[] = [];
  const top = (label: string, y: number) => { if (y > L.h + 2e-3) tall.push(`${label} ${y.toFixed(3)} > ${L.h.toFixed(3)}`); };
  top('counter', L.counterTopY);
  for (const r of L.runs) {
    if (r.hasUppers) top(`${r.id} uppers${L.crown ? ' + crown' : ''}`, r.upperTop + (L.crown ? L.crownH : 0));
    for (const t of r.tall) top(`${r.id} tall ${t.id}`, t.top + (L.crown ? L.crownH : 0));
  }
  for (const a of L.appliances) top(`appliance ${a.id}`, a.y + a.height);
  if (L.island) top('island top', L.island.carcassTop + L.island.topT);
  const openBad: string[] = [];
  for (const o of L.openings) {
    const wl = o.wall === 'back' || o.wall === 'front' ? L.w : L.d;
    if (Math.abs(o.x) + o.width / 2 > wl / 2 + 2e-3) openBad.push(`${o.id} off the ${o.wall} wall`);
    if (o.sill + o.height > L.h + 2e-3) openBad.push(`${o.id} through the ceiling`);
  }
  const all = [...out, ...tall, ...openBad];
  if (all.length) fail('2 CONTAIN', name, all.slice(0, 5).join('; '));
  else pass('2 CONTAIN', name, `${L.rects.length} footprints in room, ${L.openings.length} openings in wall, nothing above ${L.h.toFixed(2)} m`);
}

function containBath(name: string, L: BathLayout): void {
  const hw = L.w / 2, hd = L.d / 2;
  const out: string[] = [];
  const check = (label: string, r: R | null | undefined) => { if (r && !inside(r, hw, hd)) out.push(`${label} by ${overflow(r, hw, hd).toFixed(3)} m`); };
  L.rects.forEach((r, i) => check(`rects[${i}]`, r));
  check('vanity', L.vanity?.rect); check('shower', L.shower?.rect);
  check('tub', L.tub?.rect); check('toilet', L.toilet?.rect);
  for (const o of L.openings) {
    const wl = o.wall === 'back' || o.wall === 'front' ? L.w : L.d;
    if (Math.abs(o.x) + o.width / 2 > wl / 2 + 2e-3) out.push(`${o.id} off the ${o.wall} wall`);
    if (o.sill + o.height > L.h + 2e-3) out.push(`${o.id} through the ceiling`);
  }
  if (L.vanity && L.vanity.topH > L.h) out.push('vanity top above the ceiling');
  if (out.length) fail('2 CONTAIN', name, out.slice(0, 5).join('; '));
  else pass('2 CONTAIN', name, `${L.rects.length} fixtures in room, ${L.openings.length} openings in wall`);
}

function containExterior(name: string, L: ExteriorLayout): void {
  const hw = L.lotW / 2, hd = L.lotD / 2;
  const built: string[] = [];
  const check = (label: string, r: R | null | undefined) => { if (r && !inside(r, hw, hd)) built.push(`${label} off the lot by ${overflow(r, hw, hd).toFixed(2)} m`); };
  for (const b of L.blocks) check(b.key, b.rect);
  check('porch', L.porch?.rect); check('deck', L.deck?.rect);
  if (L.patio) check('patio', { minX: L.patio.cx - L.patio.w / 2, maxX: L.patio.cx + L.patio.w / 2, minZ: L.patio.cz - L.patio.d / 2, maxZ: L.patio.cz + L.patio.d / 2 });
  if (L.pool) check('pool', { minX: L.pool.cx - L.pool.w / 2, maxX: L.pool.cx + L.pool.w / 2, minZ: L.pool.cz - L.pool.d / 2, maxZ: L.pool.cz + L.pool.d / 2 });
  // Site work legitimately reaches the street; it must still sit on the context plane.
  const g = L.groundHalf;
  const world: string[] = [];
  const onGround = (label: string, x: number, z: number) => { if (Math.abs(x) > g || Math.abs(z) > g) world.push(`${label} beyond the ground plane`); };
  for (const p of [...L.driveway, ...L.walkway]) onGround('paving', p.cx, p.cz);
  L.trees.forEach((t, i) => onGround(`tree ${i}`, t.x, t.z));
  L.treeline.forEach((t, i) => onGround(`treeline ${i}`, t.x, t.z));
  L.hedges.forEach((h, i) => onGround(`hedge ${i}`, h.x, h.z));
  L.fence.forEach((f, i) => onGround(`fence ${i}`, f.cx, f.cz));
  if (L.mailbox) onGround('mailbox', L.mailbox.x, L.mailbox.z);
  // lot trees must be on the lot; the treeline is deliberately outside it
  L.trees.forEach((t, i) => { if (Math.abs(t.x) > hw + 0.5 || Math.abs(t.z) > hd + 0.5) built.push(`tree ${i} off the lot`); });
  // nothing may float above or below its own roof/grade datum
  for (const b of L.blocks) {
    if (b.eaveY <= b.floorY) built.push(`${b.key} has no wall height`);
    if (b.roof.rise < 0) built.push(`${b.key} roof rise negative`);
  }
  const all = [...built, ...world];
  if (all.length) fail('2 CONTAIN', name, all.slice(0, 5).join('; '));
  else pass('2 CONTAIN', name, `${L.blocks.length} masses on lot, ${L.trees.length} trees, ground ±${g.toFixed(0)} m`);
}

/**
 * Two solid fixtures may not occupy the same cubic foot. The layout solver is
 * allowed to shrink or slide things apart; what it may never do is give up and
 * let them interpenetrate, because that renders as one box through another.
 */
function overlapArea(a: R, b: R): number {
  return Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
       * Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
}
function noOverlap(section: string, name: string, items: Array<[string, R]>, limit = 0.01): void {
  const clashes: string[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = overlapArea(items[i][1], items[j][1]);
    if (a > limit) clashes.push(`${items[i][0]} ∩ ${items[j][0]} = ${a.toFixed(3)} m²`);
  }
  if (clashes.length) fail(section, name, `${clashes.length} — ${clashes.slice(0, 4).join('; ')}`);
  else pass(section, name, `${items.length} fixtures, no interpenetration`);
}
const bathFixtures = (L: BathLayout): Array<[string, R]> =>
  (['vanity', 'shower', 'tub', 'toilet'] as const).flatMap((k) => (L[k] ? [[k, L[k]!.rect] as [string, R]] : []));

// Kitchen: runs and the island are solid bodies. Appliances are deliberately
// left out — a fridge lives INSIDE its surround, so it shares that run's rect.
{
  const worstK = { area: 0, at: '' };
  for (const len of range(4, 12, 0.5)) for (const wid of range(2, 5, 0.25)) {
    const sp = defaultKitchen();
    sp.island = { ...sp.island, lengthFt: len, widthFt: wid };
    const L = computeKitchenLayout(sp);
    const items: Array<[string, R]> = L.runs.map((r) => [`run ${r.id}`, r.rect] as [string, R]);
    if (L.island) items.push(['island', L.island.rect]);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = overlapArea(items[i][1], items[j][1]);
      if (a > worstK.area) { worstK.area = a; worstK.at = `island ${len}×${wid} ft: ${items[i][0]} ∩ ${items[j][0]}`; }
    }
  }
  if (worstK.area > 0.01) fail('2 CONTAIN', 'kitchen runs + island never interpenetrate', `${worstK.area.toFixed(3)} m² — ${worstK.at}`);
  else pass('2 CONTAIN', 'kitchen runs + island never interpenetrate', '17 × 13 island sizes, max overlap 0 m²');
}

noOverlap('2 CONTAIN', 'bathroom (default): fixtures do not interpenetrate', bathFixtures(bathL));
{
  // the shower-width slider is the one that makes the solver give up
  const worst: string[] = [];
  for (const [label, edit] of [
    ['shower width 30 → 84 in', (s2: BathroomSpec, v: number) => { s2.shower.widthIn = v; }],
    ['tub length 48 → 84 in', (s2: BathroomSpec, v: number) => { s2.tub.lengthIn = v; }],
    ['vanity width 24 → 96 in', (s2: BathroomSpec, v: number) => { s2.vanity.widthIn = v; }],
  ] as Array<[string, (s: BathroomSpec, v: number) => void]>) {
    for (const v of range(24, 96, 2)) {
      const sp = defaultBathroom(); edit(sp, v);
      const L = computeBathroomLayout(sp);
      const f = bathFixtures(L);
      for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) {
        const a = overlapArea(f[i][1], f[j][1]);
        if (a > 0.01) { worst.push(`${label} at ${v}: ${f[i][0]} ∩ ${f[j][0]} = ${a.toFixed(3)} m²`); i = f.length; break; }
      }
    }
  }
  if (worst.length) fail('2 CONTAIN', 'bathroom sliders never make fixtures interpenetrate', `${worst.length} bad values — ${worst.slice(0, 3).join('; ')}`);
  else pass('2 CONTAIN', 'bathroom sliders never make fixtures interpenetrate', '3 sliders × 37 notches');
}

/**
 * A house is contained by its own footprint and its own storeys. Everything
 * here is measured against `planBounds` put through the SAME mapping the scene
 * uses, so a wall that wandered, a room whose floor is not on its level, or an
 * opening whose head is in the joists shows up as a number rather than as a
 * strange picture.
 *
 * The slack is one wall thickness plus a foot: a mitred corner legitimately
 * runs half a neighbour past the bounds, and a stair's guard rail stands proud
 * of the shaft.
 */
function containPlan(name: string, spec: FloorPlanSpec, L: FloorPlanLayout): void {
  const b = planBounds(spec);
  const hw = ft(b.maxX - b.minX) / 2 + 1, hd = ft(b.maxY - b.minY) / 2 + 1;
  const top = ft(Math.max(...spec.levels.map((l) => l.elevationFt + l.ceilingFt)));
  const out: string[] = [];
  const at = (label: string, p: [number, number, number]) => {
    if (Math.abs(p[0]) > hw || Math.abs(p[2]) > hd) out.push(`${label} off the footprint at ${p[0].toFixed(2)},${p[2].toFixed(2)}`);
    if (p[1] > top + 0.5 || p[1] < -0.5) out.push(`${label} at y ${p[1].toFixed(2)}, outside 0…${top.toFixed(2)}`);
  };
  for (const level of L.levels) {
    for (const w of level.walls) at(`${level.name} wall ${w.id}`, w.centre);
    for (const r of level.rooms) {
      at(`${level.name} room ${r.id}`, r.centre);
      // a room's floor is its level's finished floor, not a number of its own
      if (Math.abs(r.floorY - level.elevationM) > 5e-3) out.push(`room ${r.id} floor at ${r.floorY.toFixed(3)} m, level at ${level.elevationM.toFixed(3)} m`);
      if (r.ceilingY <= r.floorY) out.push(`room ${r.id} ceiling at or below its floor`);
    }
    for (const op of level.openings) {
      at(`${level.name} opening ${op.id}`, op.centre);
      // a head above the storey is a hole with nothing over it
      if (op.sillM + op.heightM > level.ceilingM + 5e-3) out.push(`opening ${op.id} head ${(op.sillM + op.heightM).toFixed(2)} m through a ${level.ceilingM.toFixed(2)} m storey`);
    }
    for (const st of level.stairs) at(`${level.name} stair ${st.id}`, st.origin);
  }
  if (out.length) fail('2 CONTAIN', name, `${out.length} — ${out.slice(0, 4).join('; ')}`);
  else {
    const walls = L.levels.reduce((n, l) => n + l.walls.length, 0);
    const rooms = L.levels.reduce((n, l) => n + l.rooms.length, 0);
    pass('2 CONTAIN', name, `${L.levels.length} levels, ${walls} walls, ${rooms} rooms, ${L.levels.reduce((n, l) => n + l.openings.length, 0)} openings — all inside the footprint and under ${top.toFixed(2)} m`);
  }
}

containKitchen('kitchen (default)', kitchenL);
containBath('bathroom (default)', bathL);
containPlan('floorplan (demo house)', defaultFloorPlan(), planL);
for (const [st, L] of extL) containExterior(`exterior ${st}`, L);
{
  // A FLIGHT ALWAYS CLIMBS ITS STOREY. `solvedRiserIn` is the riser the
  // geometry has to build, and the one thing the scene must never do is build
  // the sheet's number instead — so every ceiling height from a crawlspace to
  // a loft is checked against the steps that come out.
  const bad: string[] = [];
  for (let ceil = 7; ceil <= 20 && bad.length < 4; ceil += 0.25) {
    const spec = defaultFloorPlan();
    // through the healer, the way every spec reaches the scene: 15 treads
    // under a 20 ft storey is an unclimbable riser, and re-treading it is the
    // healer's job, not the builder's
    spec.levels = healFloorPlan(spec.levels.map((l, i) => ({ ...l, ceilingFt: ceil, elevationFt: i === 0 ? 0 : ceil + 1 })));
    const L = computeFloorPlanLayout(spec);
    for (const level of L.levels) {
      for (const st of level.stairs) {
        const rise = st.steps.length ? st.steps[st.steps.length - 1].position[1] + st.riserM : 0;
        if (Math.abs(rise - st.riseM) > 0.0254) bad.push(`${ceil} ft: the top step is ${rise.toFixed(3)} m up a ${st.riseM.toFixed(3)} m flight`);
        if (st.riserM < ft(4 / 12) - 1e-6 || st.riserM > ft(9 / 12) + 1e-6) bad.push(`${ceil} ft: a ${(st.riserM / ft(1 / 12)).toFixed(2)}" riser is not a stair`);
      }
    }
  }
  if (bad.length) fail('2 CONTAIN', 'floorplan storey 7 → 20 ft: the flight climbs it', bad.slice(0, 3).join('; '));
  else pass('2 CONTAIN', 'floorplan storey 7 → 20 ft: the flight climbs it', '53 storey heights, every flight reaches the floor above at a walkable riser');
}

// resize sweeps — nothing may leave the room at any size the sliders allow
{
  let worst = '';
  for (let wf = 8; wf <= 30 && !worst; wf += 1) for (let df = 8; df <= 30; df += 1) {
    const s = defaultKitchen();
    s.dims = { ...s.dims, widthFt: wf, depthFt: df };
    s.runs = s.runs.map((r) => ({ ...r, lengthFt: Math.min(r.lengthFt, r.wall === 'back' || r.wall === 'front' ? wf : df) }));
    const L = computeKitchenLayout(s);
    const hw = L.w / 2, hd = L.d / 2;
    for (const r of L.rects) if (!inside(r, hw, hd)) { worst = `${wf}×${df} ft: a footprint leaves the room by ${overflow(r, hw, hd).toFixed(3)} m`; break; }
  }
  if (worst) fail('2 CONTAIN', 'kitchen 8→30 ft × 8→30 ft', worst);
  else pass('2 CONTAIN', 'kitchen 8→30 ft × 8→30 ft', '529 room sizes, everything stays inside');
}
{
  let worst = '';
  for (let wf = 4; wf <= 18 && !worst; wf += 0.5) for (let df = 4; df <= 18; df += 0.5) {
    const s = defaultBathroom();
    s.dims = { ...s.dims, widthFt: wf, depthFt: df };
    const L = computeBathroomLayout(s);
    const hw = L.w / 2, hd = L.d / 2;
    for (const r of L.rects) if (!inside(r, hw, hd)) { worst = `${wf}×${df} ft: a fixture leaves the room by ${overflow(r, hw, hd).toFixed(3)} m`; break; }
  }
  if (worst) fail('2 CONTAIN', 'bathroom 4→18 ft × 4→18 ft', worst);
  else pass('2 CONTAIN', 'bathroom 4→18 ft × 4→18 ft', '841 room sizes, everything stays inside');
}
{
  const bad: string[] = [];
  for (const st of EXT_STYLES) for (let lw = 30; lw <= 200; lw += 10) for (let ld = 40; ld <= 300; ld += 20) {
    const s = defaultExterior(st);
    s.lot = { ...s.lot, widthFt: lw, depthFt: ld };
    const L = computeExteriorLayout(s);
    const hw = L.lotW / 2, hd = L.lotD / 2;
    for (const b of L.blocks) if (!inside(b.rect, hw, hd)) { bad.push(`${st} ${lw}×${ld} ft: ${b.key} off the lot by ${overflow(b.rect, hw, hd).toFixed(2)} m`); break; }
  }
  if (bad.length) fail('2 CONTAIN', 'exterior lot 30→200 ft × 40→300 ft', `${bad.length} cases — ${bad.slice(0, 3).join('; ')}`);
  else pass('2 CONTAIN', 'exterior lot 30→200 ft × 40→300 ft', '1,008 lots × 7 styles, every mass on the lot');
}

// ---------------------------------------------------------------------------
// 3. LAYOUT STABILITY — the user's issue 4
// ---------------------------------------------------------------------------
const kBase = defaultKitchen();
const kDims = (p: Partial<KitchenSpec['dims']>) => (s: KitchenSpec) => {
  s.dims = { ...s.dims, ...p };
  // LayoutPanel rescales run lengths with the room; mirror that here
  s.runs = s.runs.map((r) => ({ ...r, lengthFt: Math.min(r.lengthFt, r.wall === 'back' || r.wall === 'front' ? s.dims.widthFt : s.dims.depthFt) }));
};

runSweeps<KitchenSpec, KitchenLayoutData>('3 STABILITY · kitchen', kBase, computeKitchenLayout, [
  {
    // decor.items#item-2 is the demo's fruit bowl, which stands ON the island
    // top; resizing the island legitimately re-seats it and nothing else.
    // A length that outgrows the anchor's shorter side slides the BODY along
    // its long axis on purpose (contract §9.5 — a 9 ft island parked off-centre
    // was capped at twice its short half and came out a stub). The declared
    // centre is `island.anchorX` / `anchorZ`, and THAT is what may not move.
    name: 'island length 4 → 12 ft',
    values: range(4, 12, 0.5), mayMove: ['island', 'rects', 'sink', 'appliances', 'decor.items#item-2'],
    apply: (s, v: number) => { s.island.lengthFt = v; },
    anchors: [{ label: 'island.anchorX', get: (L: KitchenLayoutData) => L.island?.anchorX ?? null }, { label: 'island.anchorZ', get: (L: KitchenLayoutData) => L.island?.anchorZ ?? null }],
  },
  {
    name: 'island width 2 → 5 ft',
    values: range(2, 5, 0.25), mayMove: ['island', 'rects', 'sink', 'appliances', 'decor.items#item-2'],
    apply: (s, v: number) => { s.island.widthFt = v; },
    anchors: [{ label: 'island.cx', get: (L: KitchenLayoutData) => L.island?.cx ?? null }, { label: 'island.cz', get: (L: KitchenLayoutData) => L.island?.cz ?? null }],
  },
  {
    name: 'island seating 0 → 6',
    values: range(0, 6, 1), mayMove: ['island.seating', 'island.seatSide'],
    apply: (s, v: number) => { s.island.seating = v; if (v > 0) s.island.overhangIn = Math.max(s.island.overhangIn, 12); },
    anchors: [{ label: 'island.cx', get: (L: KitchenLayoutData) => L.island?.cx ?? null }, { label: 'island.cz', get: (L: KitchenLayoutData) => L.island?.cz ?? null }],
  },
  {
    name: 'island waterfall off/on',
    values: [false, true], mayMove: ['island.waterfall', 'island.topLen'],
    apply: (s, v: boolean) => { s.island.waterfall = v; },
  },
  {
    // the canopy hood's duct cover telescopes to the ceiling (KAppliance.top),
    // so a ceiling change legitimately moves that one key.
    // 8 ft is the lowest ceiling a 30" upper + 18" splash + 34.5" base fits under,
    // so above it NOTHING may move; below it the uppers are legitimately clamped.
    name: 'ceiling 8 → 14 ft (nothing may move)',
    values: range(8, 14, 0.25), mayMove: ['h', 'ceilingFt', 'lighting', 'appliances#app-3-hood.top'],
    apply: (s, v: number) => { s.dims = { ...s.dims, ceilingFt: v }; },
    anchors: [{ label: 'counterTopY', get: (L: KitchenLayoutData) => L.counterTopY }, { label: 'upperBottom', get: (L: KitchenLayoutData) => L.upperBottom }],
  },
  {
    name: 'ceiling 7.5 → 8 ft (uppers may clamp only)',
    values: range(7.5, 8, 0.25),
    // the band between the canopy top and the crown grows with the ceiling, so
    // it crosses the 9" line under which a hood cabinet is drawn as a plain panel
    // …and every wall cabinet now carries its own `top` (the rail line under a
    // transom, the row's top otherwise), which follows `upperTop` exactly as it
    // always implicitly did
    mayMove: ['h', 'ceilingFt', 'lighting', 'appliances#app-3-hood.top', 'appliances#app-3-hood.cabinetAbove', 'runs#run-back.upperTop', 'runs#run-back.tallTop', 'runs#run-left.upperTop', 'runs#run-left.tallTop', 'runs#run-back.tall', 'runs#run-left.tall', 'runs#run-back.uppers#run-back-hood', 'runs#run-back.uppers#run-back-u0.top', 'runs#run-back.uppers#run-back-u1.top', 'runs#run-back.uppers#run-back-u2.top', 'runs#run-back.uppers#run-back-u3.top', 'runs#run-back.uppers#run-back-u4.top', 'runs#run-left.uppers#run-left-u0.top', 'runs#run-left.uppers#run-left-u1.top', 'runs#run-left.uppers#run-left-u2.top', 'runs#run-left.uppers#run-left-u3.top'],
    apply: (s, v: number) => { s.dims = { ...s.dims, ceilingFt: v }; },
    anchors: [{ label: 'counterTopY', get: (L: KitchenLayoutData) => L.counterTopY }, { label: 'upperBottom', get: (L: KitchenLayoutData) => L.upperBottom }],
  },
  {
    name: 'ceiling 7.5 → 14 ft, uppers to ceiling',
    values: range(7.5, 14, 0.25), mayMove: ['h', 'ceilingFt', 'lighting', 'appliances#app-3-hood.top', 'appliances#app-3-hood.cabinetAbove', 'runs'],
    apply: (s, v: number) => { s.dims = { ...s.dims, ceilingFt: v }; s.runs = s.runs.map((r) => ({ ...r, uppersToCeiling: true })); },
    anchors: [{ label: 'counterTopY', get: (L: KitchenLayoutData) => L.counterTopY }, { label: 'upperBottom', get: (L: KitchenLayoutData) => L.upperBottom }],
  },
  {
    // décor is solved against the walls, runs and openings, so a room resize
    // legitimately re-seats every shelf, plant, rug and treatment
    name: 'room width 8 → 30 ft',
    values: range(8, 30, 0.5),
    mayMove: ['w', 'widthFt', 'runs', 'rects', 'island', 'appliances', 'sink', 'openings', 'inset', 'decor'],
    apply: (s, v: number) => kDims({ widthFt: v })(s),
  },
  {
    name: 'room depth 8 → 30 ft',
    values: range(8, 30, 0.5),
    mayMove: ['d', 'depthFt', 'runs', 'rects', 'island', 'appliances', 'sink', 'openings', 'inset', 'decor'],
    apply: (s, v: number) => kDims({ depthFt: v })(s),
  },
  {
    name: 'door style × 7',
    // doorStyle 'glass' / 'open' makes every wall cabinet a display case, so the
    // contents layer legitimately appears on uppers that had none. Nothing about
    // the boxes themselves may move.
    values: ['shaker', 'flat', 'raised', 'slab', 'beaded', 'glass', 'open'],
    mayMove: ['doorStyle', 'runs*.uppers*.contents', 'runs*.uppers*.density'],
    apply: (s, v: KitchenSpec['cabinets']['doorStyle']) => { s.cabinets.doorStyle = v; },
  },
  {
    name: 'crown off/on',
    values: [false, true], mayMove: ['crown', 'crownH'],
    apply: (s, v: boolean) => { s.cabinets.crown = v; },
  },
  {
    name: 'backsplash height × 3',
    values: ['standard', 'full-height', 'ledge'],
    mayMove: ['backsplash', 'runs'],
    apply: (s, v: KitchenSpec['backsplash']['height']) => { s.backsplash.height = v; },
  },
  {
    name: 'pendants 0 → 6',
    values: range(0, 6, 1), mayMove: ['lighting.pendants'],
    apply: (s, v: number) => { s.lighting.pendants = v > 0 ? { count: v, style: 'globe', finish: 'brass', spreadFt: 0, offsetFt: 0, aboveCounterIn: 0 } : null; },
  },
  {
    name: 'recessed cans 0 → 16',
    values: range(0, 16, 1), mayMove: ['lighting.recessed'],
    apply: (s, v: number) => { s.lighting.recessedCount = v; },
  },
  {
    name: 'under-cabinet lighting off/on',
    values: [false, true], mayMove: ['lighting.underCabinet'],
    apply: (s, v: boolean) => { s.lighting.underCabinet = v; },
  },
]);

const bBase = defaultBathroom();
// Décor (shelves, art, plants, rug) is solved AFTER the fixtures, against them
// as obstacles — a fixture that grows or changes shape may push a picture along
// the wall or slide the rug. So every control that names a fixture also names
// `decor`; check-bath-layout proves the finer rule that décor only moves when
// its `displaced` is non-zero. The mirror band is clamped under the ceiling.
const anchorA = (k: 'vanity' | 'shower' | 'tub' | 'toilet') => ({ label: `${k}.anchorA`, get: (L: BathLayout) => L[k]?.anchorA ?? null });
/** The niche / accent the Layout tab creates when the user first turns one on. */
const NICHE: NonNullable<BathroomSpec['shower']['nicheAt']> = { face: 'back', t: 0.5, centerIn: 48, widthIn: 24, heightIn: 14, shelves: 1 };
const ACCENT: NonNullable<BathroomSpec['wallTile']['accent']> = { wall: 'back', pattern: 'herringbone', moduleIn: null, heightIn: null, colorHex: null };
// Tile moves the finished mounting plane out from the wall. Only that depth
// offset and its derived world footprint may follow it; local mounting and
// orientation anchors stay fixed. check-shelving separately compares actual
// tiled-wall meshes with fitting bounds for all four case rotations.
const shelfFinishDepth = ['decor.shelves.standoff', 'decor.shelves.rect'];
const shelfMountingAnchors = computeBathroomLayout(bBase).decor.shelves.flatMap((_, i) => [
  ...(['x', 'bottom', 'width', 'depth', 'count', 'anchorA'] as const).map((key) => ({
    label: `shelf${i}.${key}`, get: (L: BathLayout) => L.decor.shelves[i]?.[key] ?? null,
  })),
  { label: `shelf${i}.rotation`, get: (L: BathLayout) => L.decor.shelves[i]?.enclosure?.rotationDeg ?? 0 },
]);

runSweeps<BathroomSpec, BathLayout>('3 STABILITY · bathroom', bBase, computeBathroomLayout, [
  {
    name: 'vanity width 24 → 96 in',
    values: range(24, 96, 6), mayMove: ['vanity', 'rects', 'free', 'decor'],
    apply: (s, v: number) => { s.vanity.widthIn = v; s.vanity.sinks = v < 48 ? 1 : s.vanity.sinks; },
    anchors: [anchorA('vanity')],
    controls: ['Vanity width'],
  },
  {
    name: 'shower width 30 → 84 in',
    values: range(30, 84, 2), mayMove: ['shower', 'tub', 'rects', 'free', 'decor'],
    apply: (s, v: number) => { s.shower.widthIn = v; },
    anchors: [anchorA('shower')],
    controls: ['Shower width'],
  },
  {
    name: 'shower depth 30 → 60 in',
    values: range(30, 60, 2), mayMove: ['shower', 'toilet', 'rects', 'free', 'decor'],
    apply: (s, v: number) => { s.shower.depthIn = v; },
    anchors: [anchorA('shower')],
    controls: ['Shower depth'],
  },
  {
    name: 'tub length 48 → 84 in',
    values: range(48, 84, 2), mayMove: ['tub', 'rects', 'free', 'decor'],
    apply: (s, v: number) => { s.tub.lengthIn = v; },
    anchors: [anchorA('tub')],
    controls: ['Tub length'],
  },
  {
    name: 'tub kind × 5',
    values: ['freestanding', 'alcove', 'drop-in', 'clawfoot', 'corner'],
    mayMove: ['tub', 'rects', 'free', 'shower', 'decor'],
    apply: (s, v: BathroomSpec['tub']['kind']) => { s.tub.kind = v; },
    controls: ['Tub type'],
  },
  {
    name: 'vanity style × 5',
    values: ['floating', 'freestanding', 'furniture', 'console', 'pedestal'],
    mayMove: ['vanity', 'rects', 'free', 'decor'],
    apply: (s, v: BathroomSpec['vanity']['style']) => { s.vanity.style = v; },
    anchors: [anchorA('vanity')],
    controls: ['Vanity style'],
  },
  {
    name: 'toilet style × 4',
    values: ['two-piece', 'one-piece', 'wall-hung', 'smart'],
    mayMove: ['toilet', 'rects', 'free', 'decor'],
    apply: (s, v: BathroomSpec['toilet']['style']) => { s.toilet.style = v; },
    anchors: [anchorA('toilet')],
    controls: ['Toilet style'],
  },
  {
    name: 'wall tile × 5',
    values: ['none', 'shower-only', 'wainscot', 'accent-wall', 'full'],
    mayMove: ['wallTile', 'tile', ...shelfFinishDepth],
    anchors: shelfMountingAnchors,
    apply: (s, v: BathroomSpec['wallTile']['height']) => { s.wallTile = { height: v }; },
    controls: ['Wall tile height'],
  },
  {
    name: 'shower enclosure × 5',
    values: ['frameless-glass', 'framed-glass', 'curtain', 'open', 'tub-shower'],
    mayMove: ['shower', 'tub', 'rects', 'free', 'decor'],
    apply: (s, v: BathroomSpec['shower']['enclosure']) => { s.shower.enclosure = v; },
    controls: ['Shower enclosure'],
  },
  {
    name: 'ceiling 7.5 → 12 ft',
    values: range(7.5, 12, 0.25), mayMove: ['h', 'ceilingFt', 'lighting', 'vanity.mirrorBand', 'accessories'],
    apply: (s, v: number) => { s.dims = { ...s.dims, ceilingFt: v }; },
    controls: ['Ceiling height'],
    anchors: [anchorA('vanity'), anchorA('shower'), anchorA('tub'), anchorA('toilet')],
  },
  {
    name: 'room width 4 → 18 ft',
    values: range(4, 18, 0.5),
    mayMove: ['w', 'widthFt', 'vanity', 'shower', 'tub', 'toilet', 'rects', 'free', 'openings', 'decor', 'accessories'],
    apply: (s, v: number) => { s.dims = { ...s.dims, widthFt: v }; },
    controls: ['Room width'],
  },
  {
    name: 'room depth 4 → 18 ft',
    values: range(4, 18, 0.5),
    mayMove: ['d', 'depthFt', 'vanity', 'shower', 'tub', 'toilet', 'rects', 'free', 'openings', 'decor', 'accessories'],
    apply: (s, v: number) => { s.dims = { ...s.dims, depthFt: v }; },
    controls: ['Room depth'],
  },
  {
    name: 'shower niche off/on',
    values: [false, true], mayMove: ['shower.niche', 'shower.nicheAt'],
    apply: (s, v: boolean) => { s.shower.niche = v; },
    controls: ['Niche'],
  },
  {
    name: 'shower bench off/on',
    values: [false, true], mayMove: ['shower.bench'],
    apply: (s, v: boolean) => { s.shower.bench = v; },
    controls: ['Bench'],
  },
  {
    name: 'curbless off/on',
    values: [false, true], mayMove: ['shower.curbless', 'shower.curbHeight'],
    apply: (s, v: boolean) => { s.shower.curbless = v; },
    controls: ['Curbless'],
  },

  // ---- the detail controls. Every one of these shipped as a live slider or
  // picker against a spec field the layout never read, so each sweep here is
  // an assertion that the control now reaches geometry AND that it only
  // touches what it names.
  {
    name: 'vanity present off/on',
    values: [false, true], mayMove: ['vanity', 'rects', 'free', 'decor', 'accessories'],
    apply: (s, v: boolean) => { s.vanity.present = v; },
    controls: ['Vanity'],
  },
  {
    name: 'vanity sinks 1 / 2',
    values: [1, 2], mayMove: ['vanity', 'rects', 'free', 'decor'],
    apply: (s, v: number) => { s.vanity.sinks = v === 2 ? 2 : 1; s.vanity.widthIn = v === 2 ? Math.max(s.vanity.widthIn, 60) : s.vanity.widthIn; },
    controls: ['Vanity sinks'],
  },
  {
    name: 'mirror × 5',
    values: ['single', 'double', 'full-width', 'medicine-cabinet', 'none'],
    mayMove: ['vanity.mirror', 'vanity.mirrorBand', 'decor'],
    apply: (s, v: BathroomSpec['vanity']['mirror']) => { s.vanity.mirror = v; },
    controls: ['Mirror'],
  },
  {
    name: 'vanity drawers auto → 0…8',
    values: [0, 1, 2, 3, 4, 5, 6, 7, 8], mayMove: ['vanity.drawers'],
    apply: (s, v: number) => { s.vanity.drawers = v; },
    controls: ['Vanity drawers'],
  },
  {
    name: 'vanity doors auto → 0…6',
    values: [0, 1, 2, 3, 4, 5, 6], mayMove: ['vanity.doors'],
    apply: (s, v: number) => { s.vanity.doors = v; },
    controls: ['Vanity doors'],
  },
  {
    // a floating vanity has nothing to stand on, so the leg sweep runs on the
    // freestanding box the control is actually offered for
    name: 'vanity legs × 6 (freestanding)',
    values: ['none', 'tapered', 'turned', 'square', 'hairpin', 'plinth'],
    mayMove: ['vanity'],
    apply: (s, v: NonNullable<BathroomSpec['vanity']['legStyle']>) => { s.vanity.style = 'freestanding'; s.vanity.legStyle = v; },
    controls: ['Vanity leg style'],
  },
  {
    name: 'basin × 5',
    values: ['undermount', 'integrated', 'vessel', 'semi-recessed', 'drop-in'],
    mayMove: ['vanity.basin'],
    apply: (s, v: NonNullable<BathroomSpec['vanity']['basin']>) => { s.vanity.basin = v; },
    controls: ['Basin type'],
  },
  {
    name: 'tap mount × 5',
    values: ['deck', 'wall', 'widespread', 'centerset', 'single-hole'],
    // A WALL tap comes out of the wall the mirror hangs on, so switching to it
    // lifts the glass clear of the spout and its handles: `tapY` appears and
    // `mirrorBottom` (with the band derived from it) rises. That is the mount
    // doing its job, not the mirror drifting.
    mayMove: ['vanity.faucetMount', 'vanity.tapY', 'vanity.mirrorBottom', 'vanity.mirrorBand'],
    apply: (s, v: NonNullable<BathroomSpec['vanity']['faucetMount']>) => { s.vanity.faucetMount = v; },
    controls: ['Faucet mount'],
  },
  {
    name: 'vanity top thickness 0.5 → 4 in',
    values: range(0.5, 4, 0.25), mayMove: ['vanity.topThickness'],
    apply: (s, v: number) => { s.vanity.counterThicknessIn = v; },
    anchors: [anchorA('vanity')],
    controls: ['Vanity top thickness'],
  },
  {
    name: 'vanity top height 28 → 40 in',
    // décor that stands ON the vanity top rides up and down with it
    values: range(28, 40, 0.5), mayMove: ['vanity.topH', 'vanity.mirrorBand', 'vanity.mirrorBottom', 'vanity.tapY', 'decor'],
    apply: (s, v: number) => { s.vanity.heightIn = v; },
    anchors: [anchorA('vanity')],
    controls: ['Vanity top height'],
  },
  {
    name: 'vanity depth 14 → 26 in',
    values: range(14, 26, 1), mayMove: ['vanity', 'rects', 'free', 'decor'],
    apply: (s, v: number) => { s.vanity.depthIn = v; },
    anchors: [anchorA('vanity')],
    controls: ['Vanity depth'],
  },
  {
    name: 'vanity splash × 4',
    values: ['none', 'standard', 'full-height', 'integrated'],
    mayMove: ['vanity.splash'],
    apply: (s, v: NonNullable<BathroomSpec['vanity']['backsplash']>) => { s.vanity.backsplash = v; },
    controls: ['Vanity backsplash'],
  },
  {
    name: 'vanity hardware × 5',
    values: ['pulls', 'knobs', 'mixed', 'integrated', 'none'],
    mayMove: ['vanity.hardware'],
    apply: (s, v: NonNullable<BathroomSpec['vanity']['hardware']>) => { s.vanity.hardware = v; },
    controls: ['Vanity hardware'],
  },
  {
    name: 'open shelf off/on (floating)',
    values: [false, true], mayMove: ['vanity.openShelf'],
    apply: (s, v: boolean) => { s.vanity.style = 'floating'; s.vanity.openShelf = v; },
    controls: ['Open shelf'],
  },
  {
    name: 'shower present off/on',
    values: [false, true], mayMove: ['shower', 'tub', 'rects', 'free', 'decor', 'accessories'],
    apply: (s, v: boolean) => { s.shower.present = v; },
    controls: ['Shower'],
  },
  {
    name: 'shower door × 7',
    values: ['hinged', 'sliding', 'barn', 'pivot', 'fixed-panel', 'walk-in', 'none'],
    mayMove: ['shower.doorType'],
    apply: (s, v: NonNullable<BathroomSpec['shower']['doorType']>) => { s.shower.doorType = v; },
    controls: ['Shower door type'],
  },
  {
    name: 'glass 1/8 → 5/8 in',
    values: range(0.125, 0.625, 0.0625), mayMove: ['shower.glassThickness'],
    apply: (s, v: number) => { s.shower.glassThicknessIn = v; },
    controls: ['Shower glass thickness'],
  },
  {
    name: 'shower hardware finish × 10',
    values: ['chrome', 'brushed-nickel', 'polished-nickel', 'matte-black', 'brushed-gold', 'polished-brass', 'oil-rubbed-bronze', 'stainless', 'white', 'black'],
    mayMove: ['shower.hardwareFinish'],
    apply: (s, v: NonNullable<BathroomSpec['shower']['hardwareFinish']>) => { s.shower.hardwareFinish = v; },
    controls: ['Shower hardware finish'],
  },
  {
    name: 'curb height 0 → 10 in',
    values: range(0, 10, 0.5), mayMove: ['shower.curbHeight'],
    apply: (s, v: number) => { s.shower.curbless = false; s.shower.curbHeightIn = v; },
    controls: ['Shower curb height'],
  },
  {
    name: 'bench shape × 3',
    values: ['corner', 'full-width', 'floating'],
    mayMove: ['shower.benchStyle'],
    apply: (s, v: NonNullable<BathroomSpec['shower']['benchStyle']>) => { s.shower.bench = true; s.shower.benchStyle = v; },
    controls: ['Shower bench style'],
  },
  {
    name: 'niche face × 3',
    values: ['back', 'left', 'right'],
    mayMove: ['shower.nicheAt'],
    apply: (s, v: 'back' | 'left' | 'right') => { s.shower.niche = true; s.shower.nicheAt = { ...NICHE, face: v }; },
    controls: ['Niche face'],
  },
  {
    name: 'niche width 8 → 48 in',
    values: range(8, 48, 2), mayMove: ['shower.nicheAt'],
    apply: (s, v: number) => { s.shower.niche = true; s.shower.nicheAt = { ...NICHE, widthIn: v }; },
    controls: ['Niche width'],
  },
  {
    name: 'niche height 8 → 48 in',
    values: range(8, 48, 2), mayMove: ['shower.nicheAt'],
    apply: (s, v: number) => { s.shower.niche = true; s.shower.nicheAt = { ...NICHE, heightIn: v }; },
    controls: ['Niche height'],
  },
  {
    name: 'niche centre 24 → 72 in',
    values: range(24, 72, 2), mayMove: ['shower.nicheAt'],
    apply: (s, v: number) => { s.shower.niche = true; s.shower.nicheAt = { ...NICHE, centerIn: v }; },
    controls: ['Niche centre height'],
  },
  {
    name: 'niche shelves 0 → 4',
    values: [0, 1, 2, 3, 4], mayMove: ['shower.nicheAt.shelves'],
    apply: (s, v: number) => { s.shower.niche = true; s.shower.nicheAt = { ...NICHE, shelves: v }; },
    controls: ['Niche shelves'],
  },
  {
    name: 'tub present off/on',
    values: [false, true], mayMove: ['tub', 'shower', 'rects', 'free', 'decor', 'accessories'],
    apply: (s, v: boolean) => { s.tub.present = v; },
    controls: ['Tub'],
  },
  {
    name: 'tub material × 8',
    values: ['acrylic', 'cast-iron', 'stone-resin', 'solid-surface', 'copper', 'fiberglass', 'steel', 'wood'],
    mayMove: ['tub.material'],
    apply: (s, v: NonNullable<BathroomSpec['tub']['material']>) => { s.tub.material = v; },
    controls: ['Tub material'],
  },
  {
    name: 'tub filler × 6',
    values: ['deck-mount', 'wall-mount', 'floor-mount', 'roman', 'tub-shower-diverter', 'none'],
    mayMove: ['tub.filler'],
    apply: (s, v: NonNullable<BathroomSpec['tub']['fillerType']>) => { s.tub.fillerType = v; },
    controls: ['Tub filler'],
  },
  {
    name: 'tub width 24 → 48 in',
    values: range(24, 48, 1), mayMove: ['tub', 'rects', 'free', 'decor', 'shower'],
    apply: (s, v: number) => { s.tub.widthIn = v; },
    anchors: [anchorA('tub')],
    controls: ['Tub width'],
  },
  {
    name: 'tub rim 14 → 30 in',
    values: range(14, 30, 0.5), mayMove: ['tub.rimHeight'],
    apply: (s, v: number) => { s.tub.heightIn = v; },
    anchors: [anchorA('tub')],
    controls: ['Tub rim height'],
  },
  {
    name: 'tile pattern × 11',
    values: ['stacked', 'running-bond', 'vertical-stack', 'herringbone', 'chevron', 'basketweave', 'hex', 'penny', 'mosaic', 'large-format', 'slab'],
    mayMove: ['tile.pattern'],
    apply: (s, v: NonNullable<BathroomSpec['wallTile']['pattern']>) => { s.wallTile = { ...s.wallTile, pattern: v }; },
    controls: ['Wall tile pattern'],
  },
  {
    name: 'tile module × 6',
    values: ['3x6', '4x12', '2x8', '12x24', '24x48', '4x4'],
    mayMove: ['tile.module'],
    apply: (s, v: string) => { const [w, h] = v.split('x').map(Number); s.wallTile = { ...s.wallTile, moduleIn: { w, h } }; },
    controls: ['Wall tile size'],
  },
  {
    name: 'tile stop 12 → 102 in',
    values: range(12, 102, 6), mayMove: ['tile.stopH', ...shelfFinishDepth],
    anchors: shelfMountingAnchors,
    apply: (s, v: number) => { s.wallTile = { ...s.wallTile, height: 'wainscot', heightIn: v }; },
    controls: ['Wall tile height in inches'],
  },
  {
    name: 'grout 0 → 1/2 in',
    values: range(0, 0.5, 0.0625), mayMove: ['tile.grout'],
    apply: (s, v: number) => { s.wallTile = { ...s.wallTile, groutWidthIn: v }; },
    controls: ['Grout joint width'],
  },
  {
    name: 'tile cap × 5',
    values: ['none', 'bullnose', 'pencil', 'chair-rail', 'metal-edge'],
    mayMove: ['tile.trim'],
    apply: (s, v: NonNullable<BathroomSpec['wallTile']['trim']>) => { s.wallTile = { ...s.wallTile, trim: v }; },
    controls: ['Wall tile trim'],
  },
  {
    name: 'feature wall × 4',
    values: ['back', 'left', 'right', 'front'],
    mayMove: ['tile.accent', ...shelfFinishDepth],
    anchors: shelfMountingAnchors,
    apply: (s, v: BathroomSpec['vanity']['wall']) => { s.wallTile = { ...s.wallTile, accent: { ...ACCENT, wall: v } }; },
    controls: ['Feature wall'],
  },
  {
    name: 'feature pattern × 11',
    values: ['stacked', 'running-bond', 'vertical-stack', 'herringbone', 'chevron', 'basketweave', 'hex', 'penny', 'mosaic', 'large-format', 'slab'],
    mayMove: ['tile.accent.pattern'],
    apply: (s, v: NonNullable<BathroomSpec['wallTile']['pattern']>) => { s.wallTile = { ...s.wallTile, accent: { ...ACCENT, pattern: v } }; },
    controls: ['Feature wall pattern'],
  },
  {
    // one sweep for the whole per-fitting card: kind, wall, position, height,
    // length and finish all live on the same array element
    name: 'accessory kind × 9',
    values: ['towel-bar', 'towel-ring', 'hook', 'robe-hook', 'grab-bar', 'toilet-paper-holder', 'towel-warmer', 'shower-caddy', 'corner-shelf'],
    mayMove: ['accessories', 'free'],
    apply: (s, v: string) => { s.accessories = [{ kind: v as never, wall: 'front', t: 0.5, heightFt: 4, widthIn: 24, finish: 'chrome' }]; },
    controls: ['Fitting '],
  },
  {
    name: 'accessory position 0.02 → 0.98',
    values: range(0.02, 0.98, 0.04), mayMove: ['accessories', 'free'],
    apply: (s, v: number) => { s.accessories = [{ kind: 'towel-bar', wall: 'front', t: v, heightFt: 4, widthIn: 24, finish: null }]; },
  },
  {
    name: 'accessory height 1 → 6.5 ft',
    values: range(1, 6.5, 0.25), mayMove: ['accessories', 'free'],
    apply: (s, v: number) => { s.accessories = [{ kind: 'towel-bar', wall: 'front', t: 0.5, heightFt: v, widthIn: 24, finish: null }]; },
  },
  {
    name: 'accessory length 4 → 42 in',
    values: range(4, 42, 2), mayMove: ['accessories', 'free'],
    apply: (s, v: number) => { s.accessories = [{ kind: 'towel-bar', wall: 'front', t: 0.5, heightFt: 4, widthIn: v, finish: null }]; },
  },
]);

/**
 * CONTROL COVERAGE — the gate that would have caught 26 dead sliders.
 *
 * The Layout tab's bathroom section is the single list; each control's own
 * `ariaLabel` (and a `<Toggle>`'s label) is its name in it. Every one must be
 * claimed by a sweep above, and every claim must still exist in the panel. Add
 * a control without a sweep and this fails; rename one and this fails; delete
 * one whose sweep is still here and this fails. It is deliberately read off the
 * SOURCE rather than a duplicated list, because a duplicated list is the thing
 * that goes stale.
 */
function bathroomControlLabels(): string[] {
  const src = readFileSync(join(process.cwd(), 'src/components/studio/LayoutPanel.tsx'), 'utf8');
  const a = src.indexOf('function BathroomControls(');
  const b = src.indexOf('const ACCESSORY_LABEL', a);
  if (a < 0 || b < 0) return [];
  const seg = src.slice(a, b);
  const out = new Set<string>();
  for (const m of seg.matchAll(/ariaLabel=\{?["'`]([^"'`{}]+)["'`]/g)) out.add(m[1]);
  // a Toggle's user-facing name is its `label`
  for (const m of seg.matchAll(/<Toggle[\s\S]{0,600}?label="([^"]+)"/g)) out.add(m[1]);
  // a per-card control is named once for the whole card: `Fitting ${i} kind`
  for (const m of seg.matchAll(/ariaLabel=\{`([^$`]*)\$\{/g)) out.add(m[1]);
  return [...out];
}

/**
 * Controls a layout sweep genuinely cannot exercise. Each needs a reason, and
 * "it does not do anything" is not one of them.
 */
const EXEMPT_CONTROLS: Record<string, string> = {
  // these three place a fixture along its wall; check-bath-layout owns the
  // anchor contract for them and sweeps them far more finely than this file
  'Vanity position': 'position sweeps live in check-bath-layout',
  'Shower position': 'position sweeps live in check-bath-layout',
  'Tub position': 'position sweeps live in check-bath-layout',
};

{
  const labels = bathroomControlLabels();
  if (labels.length < 20) {
    fail('3 STABILITY · bathroom', 'control coverage', `could not read the Layout tab's bathroom controls (found ${labels.length})`);
  } else {
    const unswept = labels.filter((l) => !claimedControls.has(l) && !(l in EXEMPT_CONTROLS));
    const stale = [...claimedControls].filter((c) => !labels.includes(c));
    if (unswept.length) fail('3 STABILITY · bathroom', 'control coverage', `${unswept.length} Layout-tab control(s) never swept — ${unswept.join(', ')}`);
    else if (stale.length) fail('3 STABILITY · bathroom', 'control coverage', `${stale.length} sweep(s) name a control the panel no longer has — ${stale.join(', ')}`);
    else pass('3 STABILITY · bathroom', 'control coverage', `all ${labels.length} Layout-tab controls swept, and every sweep must move something`);
  }
}

const eBase = defaultExterior('modern-farmhouse');
const frontWall = { label: 'house front wall z', get: (L: ExteriorLayout) => L.house?.rect.maxZ ?? null };
const houseCx = { label: 'house centre x', get: (L: ExteriorLayout) => L.house?.cx ?? null };

runSweeps<ExteriorSpec, ExteriorLayout>('3 STABILITY · exterior', eBase, computeExteriorLayout, [
  {
    name: 'roof pitch 1 → 14',
    values: range(1, 14, 1), mayMove: ['house.roof', 'house.elevations', 'wing.roof', 'wing.elevations', 'garage.roof', 'garage.elevations', 'blocks', 'porch.roofY', 'porch.roof'],
    apply: (s, v: number) => { s.house.roof.pitch = v; },
    anchors: [frontWall, houseCx, { label: 'house eave y', get: (L: ExteriorLayout) => L.house?.eaveY ?? null }],
  },
  {
    name: 'roof overhang 0 → 4 ft (ridge must not rise)',
    values: range(0, 4, 0.25), mayMove: ['house.roof', 'wing.roof', 'garage.roof', 'blocks', 'porch.roof'],
    apply: (s, v: number) => { s.house.roof.overhangFt = v; },
    anchors: [frontWall, { label: 'house roof rise', get: (L: ExteriorLayout) => L.house?.roof.rise ?? null }],
  },
  {
    name: 'roof type × 6',
    values: ['gable', 'hip', 'shed', 'flat', 'gambrel', 'mansard'],
    mayMove: ['house.roof', 'house.elevations', 'wing.roof', 'wing.elevations', 'garage.roof', 'garage.elevations', 'blocks', 'porch.roof', 'porch.roofY', 'chimney'],
    apply: (s, v: ExteriorSpec['house']['roof']['type']) => { s.house.roof.type = v; s.house.roof.pitch = v === 'flat' ? 0 : 8; },
    anchors: [frontWall, houseCx],
  },
  {
    name: 'garage bays 0 → 3 (house must not slide)',
    values: [0, 1, 2, 3],
    mayMove: ['garage', 'blocks', 'driveway', 'walkway', 'wing', 'house.elevations', 'mailbox', 'utilities', 'beds', 'trees', 'shrubs', 'sconces', 'upLights'],
    apply: (s, v: number) => { s.house.garage = { ...s.house.garage, present: v > 0, bays: v as 0 | 1 | 2 | 3 }; },
    anchors: [frontWall, houseCx],
  },
  {
    name: 'porch width 6 → 40 ft',
    values: range(6, 40, 2), mayMove: ['porch', 'trees', 'shrubs', 'beds', 'utilities', 'sconces', 'upLights'],
    apply: (s, v: number) => { s.house.porch.widthFt = v; },
    anchors: [frontWall, houseCx, { label: 'porch centre x', get: (L: ExteriorLayout) => L.porch?.x ?? null }],
  },
  {
    name: 'porch depth 3 → 26 ft (house must not slide)',
    values: range(3, 26, 1), mayMove: ['porch', 'walkway', 'trees', 'shrubs', 'beds', 'utilities', 'sconces', 'upLights'],
    apply: (s, v: number) => { s.house.porch.depthFt = v; },
    anchors: [frontWall, houseCx],
  },
  {
    name: 'deck width 6 → 44 ft',
    values: range(6, 44, 2), mayMove: ['deck', 'trees', 'shrubs', 'beds', 'patio'],
    apply: (s, v: number) => { s.house.deck.widthFt = v; },
    anchors: [frontWall, { label: 'deck ledger z', get: (L: ExteriorLayout) => L.deck?.rect.minZ ?? null }],
  },
  {
    name: 'deck depth 5 → 40 ft (boards must not pivot)',
    values: range(5, 40, 2), mayMove: ['deck.depth', 'deck.rect.minZ', 'deck.steps', 'trees', 'shrubs'],
    apply: (s, v: number) => { s.house.deck.depthFt = v; },
    anchors: [frontWall, { label: 'deck ledger z', get: (L: ExteriorLayout) => L.deck?.rect.maxZ ?? null }],
  },
  {
    name: 'footprint width 24 → 70 ft',
    values: range(24, 70, 2),
    mayMove: ['house', 'wing', 'garage', 'blocks', 'buildable', 'porch', 'deck', 'driveway', 'walkway', 'patio', 'trees', 'shrubs', 'beds', 'utilities', 'sconces', 'upLights', 'mailbox', 'chimney'],
    apply: (s, v: number) => { s.house.footprint.widthFt = v; },
    anchors: [frontWall, houseCx],
  },
  {
    name: 'footprint depth 18 → 60 ft (front wall must not move)',
    values: range(18, 60, 2),
    mayMove: ['house', 'wing', 'garage', 'blocks', 'buildable', 'deck', 'patio', 'trees', 'shrubs', 'beds', 'utilities', 'chimney'],
    apply: (s, v: number) => { s.house.footprint.depthFt = v; },
    anchors: [frontWall, houseCx],
  },
  {
    name: 'setback 5 → 80 ft',
    values: range(5, 80, 2.5),
    mayMove: ['house', 'wing', 'garage', 'blocks', 'buildable', 'envelope', 'porch', 'deck', 'driveway', 'walkway', 'patio', 'trees', 'shrubs', 'beds', 'utilities', 'sconces', 'upLights', 'mailbox', 'chimney'],
    apply: (s, v: number) => { s.lot.setbackFrontFt = v; },
    anchors: [houseCx],
  },
  {
    name: 'lot width 30 → 200 ft',
    values: range(30, 200, 5),
    mayMove: ['lotW', 'lotWidthFt', 'buildable', 'envelope', 'house', 'wing', 'garage', 'blocks', 'porch', 'deck', 'driveway', 'walkway', 'patio', 'fence', 'trees', 'shrubs', 'treeline', 'hedges', 'beds', 'utilities', 'sconces', 'upLights', 'mailbox', 'street', 'groundHalf', 'chimney'],
    apply: (s, v: number) => { s.lot.widthFt = v; },
  },
  {
    name: 'lot depth 40 → 300 ft',
    values: range(40, 300, 10),
    mayMove: ['lotD', 'lotDepthFt', 'buildable', 'envelope', 'house', 'wing', 'garage', 'blocks', 'porch', 'deck', 'driveway', 'walkway', 'patio', 'fence', 'trees', 'shrubs', 'treeline', 'hedges', 'beds', 'utilities', 'sconces', 'upLights', 'mailbox', 'street', 'groundHalf', 'chimney'],
    apply: (s, v: number) => { s.lot.depthFt = v; },
  },
  {
    name: 'trees 0 → 12 (placed trees must not shuffle)',
    values: range(0, 12, 1), mayMove: ['trees'],
    apply: (s, v: number) => { s.lot.treesCount = v; },
  },
  {
    name: 'driveway width 8 → 30 ft',
    values: range(8, 30, 1), mayMove: ['driveway', 'walkway', 'trees', 'shrubs', 'mailbox'],
    apply: (s, v: number) => { s.hardscape.driveway.widthFt = v; },
    anchors: [frontWall, houseCx],
  },
  {
    name: 'fence height 3 → 8 ft',
    values: range(3, 8, 0.5), mayMove: ['fence'],
    apply: (s, v: number) => { s.lot.fence = { ...s.lot.fence, present: true, heightFt: v }; },
  },
  {
    name: 'stories 1 → 3',
    values: [1, 2, 3],
    mayMove: ['house', 'wing', 'garage', 'blocks', 'porch', 'walkway', 'chimney', 'utilities', 'sconces', 'upLights', 'beds'],
    apply: (s, v: number) => { s.house.stories = v as 1 | 2 | 3; s.elevations = s.elevations.map((e) => ({ ...e, windows: e.windows.filter((w) => w.floor < v) })); },
    anchors: [frontWall, houseCx],
  },
  {
    name: 'story height 8 → 14 ft',
    values: range(8, 14, 0.5),
    mayMove: ['house', 'wing', 'garage', 'blocks', 'porch.roofY', 'porch.roof', 'chimney', 'utilities', 'sconces', 'upLights', 'beds'],
    apply: (s, v: number) => { s.house.storyHeightFt = v; },
    anchors: [frontWall, houseCx],
  },
]);

// every style variant must be stable under its own headline slider too
{
  const bad: string[] = [];
  for (const st of EXT_STYLES) {
    const s0 = defaultExterior(st);
    const ref = computeExteriorLayout(s0);
    const refFront = ref.house?.rect.maxZ ?? 0;
    for (const v of range(1, 14, 1)) {
      const s = clone(s0);
      if (s.house.roof.type === 'flat') break;
      s.house.roof.pitch = v;
      const L = computeExteriorLayout(s);
      if (Math.abs((L.house?.rect.maxZ ?? 0) - refFront) > TOL) { bad.push(`${st}: front wall moved with roof pitch`); break; }
    }
    for (const v of range(0, 4, 0.5)) {
      const s = clone(s0); s.house.roof.overhangFt = v;
      const L = computeExteriorLayout(s);
      if (Math.abs((L.house?.roof.rise ?? 0) - (ref.house?.roof.rise ?? 0)) > TOL) { bad.push(`${st}: ridge rose with the eave overhang`); break; }
    }
  }
  if (bad.length) fail('3 STABILITY · exterior', 'all 7 styles: pitch + overhang', bad.join('; '));
  else pass('3 STABILITY · exterior', 'all 7 styles: pitch + overhang', 'front wall and ridge height independent of both');
}

/**
 * The house sweeps. `FPLevel` carries an `index`, not an `id`, and
 * `snapshot()` only opens an array into per-entity paths when every element
 * has a string one — so without this projection every sweep here could say
 * nothing more useful than "an element moved" about the whole building.
 * With it a sweep names the storey it is allowed to touch.
 */
const idKeyed = (L: FloorPlanLayout) => ({ ...L, levels: L.levels.map((l) => ({ ...l, id: `L${l.index}` })) });
/** Through the healer, which is how every spec reaches the scene. */
const solvePlan = (spec: FloorPlanSpec) => idKeyed(computeFloorPlanLayout({ ...spec, levels: healFloorPlan(spec.levels) }));
type PlanSnap = ReturnType<typeof solvePlan>;

const groundFloorY = { label: 'ground floor y', get: (L: PlanSnap) => L.levels[0]?.elevationM ?? null };
const footprintW = { label: 'footprint w', get: (L: PlanSnap) => L.extentM.w };
const footprintD = { label: 'footprint d', get: (L: PlanSnap) => L.extentM.d };
const groundWalls = { label: 'ground wall count', get: (L: PlanSnap) => L.levels[0]?.walls.length ?? null };
const groundRooms = { label: 'ground room count', get: (L: PlanSnap) => L.levels[0]?.rooms.length ?? null };

/** A level cloned onto a new storey, ids prefixed so two storeys cannot collide. */
function storey(src: Level, index: number, elevationFt: number): Level {
  const tag = <T extends { id: string }>(x: T): T => ({ ...x, id: `s${index}-${x.id}` });
  return {
    ...src, id: `level-${index}`, name: `Level ${index + 1}`, index, elevationFt,
    rooms: src.rooms.map(tag), walls: src.walls.map(tag),
    doors: src.doors.map((d) => ({ ...tag(d), wallId: `s${index}-${d.wallId}`, swingsInto: d.swingsInto ? `s${index}-${d.swingsInto}` : null })),
    windows: src.windows.map((w) => ({ ...tag(w), wallId: `s${index}-${w.wallId}` })),
    stairs: [],
  };
}

runSweeps<FloorPlanSpec, PlanSnap>('3 STABILITY · floorplan', defaultFloorPlan(), solvePlan, [
  {
    // A taller ground storey lifts the floor above it and everything standing
    // on that floor — that is the storey below doing its job, not the house
    // sliding. What may NOT move is the ground floor itself, the footprint,
    // the area, or the saddles in the ground-floor doorways.
    name: 'storey height 8 → 13 ft',
    values: range(8, 13, 0.5),
    apply: (s, v: number) => { s.levels = s.levels.map((l) => ({ ...l, ceilingFt: v })); },
    // the rim band spans ceiling → next floor, so a taller ground storey
    // shortens it and lifts it: it belongs to the storey being swept
    mayMove: ['levels#L0.ceilingM', 'levels#L0.walls', 'levels#L0.rims', 'levels#L0.rooms', 'levels#L0.openings', 'levels#L0.lights', 'levels#L0.stairs', 'levels#L1', 'extentM.h', 'warnings'],
    anchors: [groundFloorY, footprintW, footprintD, groundWalls, groundRooms, { label: 'house area', get: (L: PlanSnap) => L.areaSqft }],
  },
  {
    // The shape of the flight is the flight's business. A U-turn does not move
    // a bedroom — but it does move the SHAFT, and the shaft is a cut in the
    // floor above and in the ceiling below: a flight that turns has to be open
    // over where it actually goes, not over the rectangle it was drawn in. So
    // the holes may move (and appear in a room the straight run never reached)
    // while the rooms themselves hold.
    name: 'stair kind: straight → spiral',
    values: ['straight', 'l-shaped', 'u-shaped', 'winder', 'spiral'],
    apply: (s, v: PlanStair['kind']) => {
      s.levels[0].stairs = s.levels[0].stairs.map((st) => ({
        ...st, kind: v,
        landing: v === 'straight' ? null : { atTread: Math.ceil(st.treads / 2), widthFt: st.footprint.widthFt, depthFt: st.footprint.widthFt, turn: v === 'u-shaped' ? 'u-turn' : 'left' },
      }));
    },
    mayMove: ['levels#L0.stairs', 'levels#L0.rooms*.holesZ', 'levels#L1.rooms*.holes', 'warnings'],
    anchors: [groundFloorY, footprintW, footprintD, groundWalls, groundRooms, { label: 'house area', get: (L: PlanSnap) => L.areaSqft }],
  },
  {
    // Rooms are labels on a floor. Losing one upstairs cannot reach down and
    // move a wall on the storey below, and it cannot move the walls on its
    // own storey either — a wall is drawn, not derived from the rooms it
    // happens to divide.
    name: 'upper room count 8 → 4',
    values: [8, 7, 6, 5, 4],
    apply: (s, v: number) => { s.levels[1].rooms = s.levels[1].rooms.slice(0, v); },
    mayMove: ['levels#L1.rooms', 'levels#L1.thresholds', 'levels#L1.lights', 'levels#L1.openings', 'levels#L1.stairs', 'levels#L0.stairs', 'areaSqft', 'warnings'],
    anchors: [groundFloorY, footprintW, footprintD, groundWalls, groundRooms],
  },
  {
    // Adding a storey is the one edit that legitimately reaches every storey —
    // the ground floor's ceiling gains a stairwell, its flight appears, and
    // `isTop` moves up the building. So this sweep is carried by its anchors:
    // the footprint and the ground floor stay exactly where they were.
    name: 'level count 1 → 3',
    values: [1, 2, 3],
    apply: (s, v: number) => {
      const base = defaultFloorPlan().levels;
      const out: Level[] = [base[0]];
      for (let i = 1; i < v; i++) out.push(storey(base[1], i, 10 * i));
      // the flight only exists if there is somewhere to climb to
      out[0] = { ...out[0], stairs: v > 1 ? base[0].stairs : [] };
      s.levels = out;
    },
    // a storey appearing above the ground floor gives it a rim band to close
    // the joist space, which a one-storey house has nothing to close
    mayMove: ['levels.@count', 'levels#L1', 'levels#L2', 'levels#L0.stairs', 'levels#L0.isTop', 'levels#L0.rims', 'levels#L0.rooms', 'levels#L0.lights', 'extentM.h', 'areaSqft', 'warnings'],
    anchors: [groundFloorY, footprintW, footprintD, groundWalls, groundRooms],
  },
]);

// ---------------------------------------------------------------------------
// 3b. TRAVEL — how far does each object actually slide while you drag one size
//     slider? This is the user's complaint stated as a number: drag the island
//     wider and nothing, including the island, should travel more than a
//     hairline. 1 inch is the fail line.
// ---------------------------------------------------------------------------
const TRAVEL_LIMIT = 0.0254; // 1 inch

interface Probe<L> { label: string; get: (L: L) => [number, number] | null }
function travel<S, L>(section: string, base: S, solve: (s: S) => L, cases: Array<{
  name: string; edits: string; values: number[]; apply: (s: S, v: number) => void; probes: Array<Probe<L>>;
}>): void {
  for (const c of cases) {
    const span = new Map<string, { lo: [number, number]; hi: [number, number] }>();
    for (const v of c.values) {
      const spec = clone(base);
      c.apply(spec, v);
      const L = solve(spec);
      for (const pr of c.probes) {
        const p = pr.get(L);
        if (!p) continue;
        const e = span.get(pr.label);
        if (!e) { span.set(pr.label, { lo: [...p] as [number, number], hi: [...p] as [number, number] }); continue; }
        e.lo[0] = Math.min(e.lo[0], p[0]); e.lo[1] = Math.min(e.lo[1], p[1]);
        e.hi[0] = Math.max(e.hi[0], p[0]); e.hi[1] = Math.max(e.hi[1], p[1]);
      }
    }
    const moved: string[] = [];
    const held: string[] = [];
    for (const [label, e] of span) {
      const t = Math.hypot(e.hi[0] - e.lo[0], e.hi[1] - e.lo[1]);
      if (t > TRAVEL_LIMIT) moved.push(`${label} travels ${(t * 39.3701).toFixed(1)}"`);
      else held.push(label);
    }
    if (moved.length) fail(section, `${c.name} — nothing may travel`, `${moved.join(', ')} (edits: ${c.edits})`);
    else pass(section, `${c.name} — nothing may travel`, `${held.length} objects held within ${(TRAVEL_LIMIT * 39.3701).toFixed(0)}"`);
  }
}

const kProbe = (label: string, get: (L: KitchenLayoutData) => [number, number] | null): Probe<KitchenLayoutData> => ({ label, get });
const kProbes: Array<Probe<KitchenLayoutData>> = [
  kProbe('island', (L) => (L.island ? [L.island.cx, L.island.cz] : null)),
  kProbe('sink', (L) => (L.sink ? [L.sink.x, L.sink.z] : null)),
  ...['run-back', 'run-left'].map((id) => kProbe(`run ${id}`, (L) => { const r = L.runs.find((x) => x.id === id); return r ? [(r.x0 + r.x1) / 2, r.rect.minZ] : null; })),
  ...['fridge', 'range', 'hood', 'dishwasher'].map((k) => kProbe(k, (L) => { const a = L.appliances.find((x) => x.kind === k); return a ? [a.x, a.y] : null; })),
];

travel<KitchenSpec, KitchenLayoutData>('3b TRAVEL · kitchen', defaultKitchen(), computeKitchenLayout, [
  { name: 'island length 4 → 12 ft', edits: 'island size only', values: range(4, 12, 0.5), apply: (s, v) => { s.island.lengthFt = v; }, probes: kProbes },
  { name: 'island width 2 → 5 ft', edits: 'island size only', values: range(2, 5, 0.25), apply: (s, v) => { s.island.widthFt = v; }, probes: kProbes },
  { name: 'island seating 0 → 6', edits: 'stool count only', values: range(0, 6, 1), apply: (s, v) => { s.island.seating = v; if (v > 0) s.island.overhangIn = Math.max(s.island.overhangIn, 12); }, probes: kProbes },
  { name: 'ceiling 8 → 14 ft', edits: 'ceiling height only', values: range(8, 14, 0.25), apply: (s, v) => { s.dims = { ...s.dims, ceilingFt: v }; }, probes: kProbes },
]);

/**
 * `anchorA` — the wall-local position of the edge the fixture is pinned by — is
 * the quantity `layout.ts` documents as invariant under a resize of that
 * fixture. A corner stall's CENTRE necessarily moves when it grows; its
 * anchored edge must not. So that is what we track.
 */
const bProbe = (k: 'vanity' | 'shower' | 'tub' | 'toilet'): Probe<BathLayout> => ({
  label: k,
  get: (L) => { const p = L[k]; return p ? [p.anchorA, 0] : null; },
});
const bProbes = [bProbe('vanity'), bProbe('shower'), bProbe('tub'), bProbe('toilet')];

travel<BathroomSpec, BathLayout>('3b TRAVEL · bathroom', defaultBathroom(), computeBathroomLayout, [
  { name: 'vanity width 24 → 96 in', edits: 'vanity size only', values: range(24, 96, 6), apply: (s, v) => { s.vanity.widthIn = v; }, probes: bProbes },
  { name: 'shower width 30 → 84 in', edits: 'shower size only', values: range(30, 84, 2), apply: (s, v) => { s.shower.widthIn = v; }, probes: bProbes },
  { name: 'shower depth 30 → 60 in', edits: 'shower size only', values: range(30, 60, 2), apply: (s, v) => { s.shower.depthIn = v; }, probes: bProbes },
  { name: 'tub length 48 → 84 in', edits: 'tub size only', values: range(48, 84, 2), apply: (s, v) => { s.tub.lengthIn = v; }, probes: bProbes },
  { name: 'ceiling 7.5 → 12 ft', edits: 'ceiling height only', values: range(7.5, 12, 0.25), apply: (s, v) => { s.dims = { ...s.dims, ceilingFt: v }; }, probes: bProbes },
]);

const eProbes: Array<Probe<ExteriorLayout>> = [
  { label: 'house', get: (L) => (L.house ? [L.house.cx, L.house.rect.maxZ] : null) },
  { label: 'wing', get: (L) => (L.wing ? [L.wing.cx, L.wing.rect.maxZ] : null) },
  { label: 'garage', get: (L) => (L.garage ? [L.garage.cx, L.garage.rect.maxZ] : null) },
  { label: 'porch', get: (L) => (L.porch ? [L.porch.x, L.porch.rect.maxZ] : null) },
  { label: 'deck ledger', get: (L) => (L.deck ? [L.deck.x, L.deck.rect.minZ] : null) },
];

travel<ExteriorSpec, ExteriorLayout>('3b TRAVEL · exterior', defaultExterior('modern-farmhouse'), computeExteriorLayout, [
  { name: 'porch width 6 → 40 ft', edits: 'porch size only', values: range(6, 40, 2), apply: (s, v) => { s.house.porch.widthFt = v; }, probes: eProbes.filter((p) => p.label !== 'porch') },
  { name: 'porch depth 3 → 26 ft', edits: 'porch size only', values: range(3, 26, 1), apply: (s, v) => { s.house.porch.depthFt = v; }, probes: eProbes.filter((p) => p.label !== 'porch') },
  { name: 'deck width 6 → 44 ft', edits: 'deck size only', values: range(6, 44, 2), apply: (s, v) => { s.house.deck.widthFt = v; }, probes: eProbes.filter((p) => p.label !== 'deck ledger') },
  { name: 'deck depth 5 → 40 ft', edits: 'deck size only', values: range(5, 40, 2), apply: (s, v) => { s.house.deck.depthFt = v; }, probes: eProbes.filter((p) => p.label !== 'deck ledger') },
  { name: 'roof overhang 0 → 4 ft', edits: 'eave overhang only', values: range(0, 4, 0.25), apply: (s, v) => { s.house.roof.overhangFt = v; }, probes: eProbes },
  { name: 'roof pitch 1 → 14', edits: 'roof pitch only', values: range(1, 14, 1), apply: (s, v) => { s.house.roof.pitch = v; }, probes: eProbes },
]);

// ---------------------------------------------------------------------------
// 4. GEOMETRY BUDGET
// ---------------------------------------------------------------------------
interface BudgetRow { scene: string; calls: number; tris: number; note: string }
const budgets: BudgetRow[] = [];

function kitchenBudget(label: string, s: KitchenSpec): void {
  const b = kitchenGeometryBudget(computeKitchenLayout(s));
  budgets.push({ scene: label, calls: b.drawCalls, tris: b.triangles, note: `${b.parts} parts → ${b.uniqueGeometries} geos, ${b.instanced} instanced batches, lighting ${b.lightingDrawCalls} calls` });
}
kitchenBudget('kitchen · default', defaultKitchen());
{
  const s = defaultKitchen();
  s.cabinets.doorStyle = 'glass'; s.cabinets.crown = true;
  s.dims = { widthFt: 30, depthFt: 30, ceilingFt: 14 };
  s.runs = s.runs.map((r) => ({ ...r, lengthFt: 30, uppersToCeiling: true }));
  s.lighting = { ...s.lighting, recessedCount: 16, pendants: { count: 6, style: 'globe', finish: 'brass', spreadFt: 0, offsetFt: 0, aboveCounterIn: 0, positions: null } };
  s.island = { ...s.island, lengthFt: 12, widthFt: 5, seating: 6, waterfall: true, hasSink: true, hasCooktop: true, stoolPitchIn: 0, endSeats: 0 };
  kitchenBudget('kitchen · worst case (30 ft, glass, crown, 6 pendants)', s);
}

// the exterior budget model belongs to that stream; run it for every style
{
  const captured: string[] = [];
  const realLog = console.log;
  for (const st of EXT_STYLES) {
    captured.length = 0;
    console.log = (...a: unknown[]) => { captured.push(a.map(String).join(' ')); };
    let okTier = false;
    try { okTier = exteriorBudgetReport(extL.get(st)!); } finally { console.log = realLog; }
    const high = captured.find((l) => l.includes('high'));
    const m = high?.match(/([\d,]+)\s+tris\s+(\d+)\s+draw calls/);
    budgets.push({
      scene: `exterior · ${st}`,
      calls: m ? Number(m[2]) : NaN,
      tris: m ? Number(m[1].replace(/,/g, '')) : NaN,
      note: okTier ? 'high tier; balanced + performance also within budget' : 'BUDGET REPORT FAILED',
    });
    if (!okTier) fail('4 BUDGET', `exterior ${st}`, 'geometry report returned failure');
  }
}

// the bathroom's geometry lives inside its React components, so its authoritative
// numbers come from the stream's own script; re-measured here from the layout.
function bathBudgetEstimate(L: BathLayout): BudgetRow {
  let calls = 0, tris = 0;
  const add = (c: number, t: number) => { calls += c; tris += t; };
  add(2, 4);                                                   // floor + ceiling planes
  add(4, 8);                                                   // four wall faces
  /*
   * WALL BY WALL, because the walls are not alike.
   *
   * This used to lay one 3 m sample in the FIELD's pattern and multiply it by
   * four, which cannot see a feature wall at all: the accent wall carries its
   * own pattern and module, is tiled to the ceiling even when the field stops
   * at a wainscot, and is allowed five times the weave budget (`WEAVE_CAP` in
   * RoomShell — one wall chosen to be looked at is worth more than each of
   * the three around it). The demo fixture's herringbone accent therefore
   * rendered 211,160 triangles through the real component tree against a
   * declared "worst case" of 119,868 — the model could not see the single
   * most expensive thing a bathroom spec can ask for.
   *
   * Still a model of RoomShell.tsx rather than a reading of it (importing the
   * component would drag R3F into a headless check), so it mirrors that
   * file's `tileHeightFor` / `tileLayFor` / weave caps deliberately.
   */
  const accentWall = L.tile.accent ? L.tile.accent.wall : L.wallTile === 'accent-wall' ? (L.vanity?.wall ?? 'back') : null;
  const fieldH = L.wallTile === 'full' ? Math.min(L.tile.stopH ?? L.h - 0.004, L.h - 0.004)
    : L.wallTile === 'wainscot' ? Math.min(L.tile.stopH ?? 1.067, L.h - 0.3)
      : 0;
  for (const wall of ['back', 'front', 'left', 'right'] as const) {
    const isAccent = accentWall === wall;
    const tileH = isAccent ? Math.min(L.tile.accent?.stopH ?? L.h - 0.004, L.h - 0.004) : fieldH;
    if (tileH <= 0) continue;
    add(1, 2);                                                 // the tile face itself
    // the joints are ONE instanced batch per wall whatever the pattern, but a
    // 3×6 running bond is a great many more bars than a 12×24 stack, so the
    // triangle count is read off the real transform list rather than assumed
    const lay = isAccent && L.tile.accent
      ? { pattern: L.tile.accent.pattern, module: L.tile.accent.module ?? L.tile.module }
      : { pattern: L.tile.pattern, module: L.tile.module };
    const c = tileCourses(wall === 'back' || wall === 'front' ? L.w : L.d, tileH, lay.module ? lay.module.h * 0.0254 : 0.3048, {
      max: 44,
      pattern: lay.pattern,
      moduleW: lay.module ? lay.module.w * 0.0254 : null,
      joint: L.tile.grout,
      weaveCap: isAccent ? 3600 : 720,
    });
    add(1, c.transforms.length * 12);
  }
  add(4, 4 * 96);                                              // base runs
  for (const o of L.openings) add(o.kind === 'window' ? 12 : 6, o.kind === 'window' ? 900 : 600);
  add(1, 20_400);                                              // instanced mosaic floor
  if (L.vanity) add(14 + L.vanity.sinks * 6, 9_000 + L.vanity.sinks * 3_500);
  if (L.shower) add(16 + (L.shower.niche ? 4 : 0) + (L.shower.bench ? 3 : 0), 14_000 + (L.shower.nicheAt ? 1_200 * (1 + L.shower.nicheAt.shelves) : 0));
  if (L.tub) add(L.tub.kind === 'clawfoot' ? 12 : 7, L.tub.kind === 'freestanding' ? 12_000 : 6_000);
  if (L.toilet) add(9, 9_500);
  add(10, 3_000);                                              // auto-placed fillers: bar, ring, holder, hook
  // every fitting the spec itself carries: the piece, plus its towel where it has one
  add(L.accessories.length * 2, L.accessories.length * 900);
  add(L.lighting.recessed * 2 + L.lighting.sconces * 3, L.lighting.recessed * 140 + L.lighting.sconces * 400);
  /*
   * WHAT THE ENUMERATION ABOVE STILL DOES NOT COUNT, counted anyway.
   *
   * The list ends at the fixtures. A real bathroom also carries the door with
   * its jamb and casing, the mirrors, the shower glass, and everything in
   * `L.decor` — plants especially, which are the most expensive small objects
   * in the room. Measured on the demo fixture (`npx tsx
   * scripts/preview-bathroom.ts out.png`, which walks the REAL component
   * tree): 2,651 meshes + instances / 211,160 triangles, against 130,112 from
   * the enumeration alone. So the enumeration sees about 62% of the room.
   *
   * A budget ceiling that is 38% low is not a ceiling, and modelling each
   * remaining part by eye would be inventing numbers. The measured ratio is
   * applied instead, named and reproducible: re-run that command after
   * changing what a bathroom draws and update the constant if it moves.
   */
  const TREE_FACTOR = 211_160 / 130_112;
  return {
    scene: 'bathroom · (layout-derived estimate)',
    calls,
    tris: Math.round(tris * TREE_FACTOR),
    note: `enumerated ${Math.round(tris).toLocaleString('en-US')} tris ×${TREE_FACTOR.toFixed(2)} measured tree factor — see notes`,
  };
}
budgets.push(bathBudgetEstimate(bathL));
{
  const s = defaultBathroom();
  s.dims = { widthFt: 18, depthFt: 18, ceilingFt: 12 };
  // the genuinely heaviest tile there is: a 3×6 running bond to a 12 ft
  // ceiling on 18 ft walls, which is where the joint instancing has to hold
  s.wallTile = { height: 'full', pattern: 'running-bond', moduleIn: { w: 3, h: 6 }, groutWidthIn: 0.0625, trim: 'bullnose', heightIn: null, accent: { wall: 'left', pattern: 'herringbone', moduleIn: { w: 4, h: 12 }, heightIn: null, colorHex: null }, showerPattern: 'hex', showerModuleIn: { w: 4, h: 4 } };
  s.shower = { ...s.shower, widthIn: 84, depthIn: 60, niche: true, bench: true, curbless: false, nicheAt: { face: 'back', t: 0.5, centerIn: 48, widthIn: 36, heightIn: 36, shelves: 4 } };
  s.accessories = Array.from({ length: 10 }, (_, i) => ({ kind: 'towel-bar' as const, wall: 'front' as const, t: 0.05 + i * 0.09, heightFt: 4, widthIn: 24, finish: null }));
  s.lighting = { ...s.lighting, recessedCount: 8, sconces: 4 };
  const r = bathBudgetEstimate(computeBathroomLayout(s));
  budgets.push({ ...r, scene: 'bathroom · worst case (18 ft, full tile)' });
}
{
  /*
   * The heaviest spec we actually ship, not a constructed one: the demo
   * fixture sets every field the expanded bathroom contract added, including
   * the herringbone feature wall. Its real cost through the component tree is
   * known — `npx tsx scripts/preview-bathroom.ts out.png --all` prints the
   * mesh and triangle totals — so this row is the one that can be checked
   * against reality rather than only against the budget.
   */
  const f = join(process.cwd(), 'scripts', 'fixtures', 'demo-bathroom.spec.json');
  if (existsSync(f)) {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as { spec?: BathroomSpec } & BathroomSpec;
    const r = bathBudgetEstimate(computeBathroomLayout(raw.spec ?? raw));
    budgets.push({ ...r, scene: 'bathroom · demo fixture (herringbone feature wall)' });
  }
}

{
  /*
   * The house. Unlike the kitchen's and the exterior's, this row is MEASURED:
   * `floorPlanBudget` counts triangles off the same buffers `parts.ts` hands
   * the scene, so it cannot drift from the builder. `npx tsx
   * scripts/preview-floorplan.ts out.png --all` prints the same totals from
   * the other end — the harvested component tree — and the two agreeing is
   * the check that the budget is measuring the house that gets drawn.
   */
  const demo = floorPlanBudget(defaultFloorPlan());
  budgets.push({
    scene: 'floorplan · demo house (2 levels, walking)',
    calls: demo.drawCalls, tris: demo.triangles,
    note: `${demo.meshes} merged buffers + ${demo.instanced} instanced (${demo.balusters} balusters), lighting ${demo.lightingDrawCalls} calls`,
  });
  // The worst house the contract allows: four storeys is the healer's cap, and
  // a turned flight on every one of them is the most geometry a plan can ask
  // for. If this fits, no client drawing can blow the budget.
  const big = defaultFloorPlan();
  const base = defaultFloorPlan().levels;
  const many: Level[] = [{ ...base[0], ceilingFt: 12 }];
  for (let i = 1; i < 4; i++) many.push({ ...storey(base[1], i, 13 * i), ceilingFt: 12 });
  for (let i = 0; i < 3; i++) {
    const src = base[0].stairs[0];
    many[i] = {
      ...many[i],
      stairs: [{
        ...src, id: `s${i}-stair`, kind: 'u-shaped' as const,
        connects: { fromLevel: i, toLevel: i + 1 },
        handrail: 'both' as const,
        landing: { atTread: 8, widthFt: src.footprint.widthFt, depthFt: src.footprint.widthFt, turn: 'u-turn' as const },
      }],
    };
  }
  big.levels = healFloorPlan(many);
  const worst = floorPlanBudget(big);
  budgets.push({
    scene: 'floorplan · 4 storeys, 12 ft, u-shaped flights',
    calls: worst.drawCalls, tris: worst.triangles,
    note: `${Math.round(houseAreaSqft(big)).toLocaleString('en-US')} sq ft, ${worst.balusters} balusters, ${worst.perLevel.map((l) => l.calls).join('+')} calls by storey`,
  });
}

for (const b of budgets) {
  const okB = Number.isFinite(b.calls) && Number.isFinite(b.tris) && b.calls <= CALL_BUDGET && b.tris <= TRI_BUDGET;
  if (okB) pass('4 BUDGET', b.scene, `${b.calls} calls / ${b.tris.toLocaleString('en-US')} tris — ${((b.calls / CALL_BUDGET) * 100).toFixed(0)}% calls, ${((b.tris / TRI_BUDGET) * 100).toFixed(0)}% tris · ${b.note}`);
  else fail('4 BUDGET', b.scene, `${b.calls} calls / ${b.tris.toLocaleString('en-US')} tris exceeds ${CALL_BUDGET} / ${TRI_BUDGET.toLocaleString('en-US')}`);
}

// ---------------------------------------------------------------------------
// 5. THINGS THAT WILL RENDER WRONG
// ---------------------------------------------------------------------------
/** Fields that name a real size and must be strictly positive wherever they appear. */
const MUST_BE_POSITIVE = /(^|[.#\]])(w|d|h|len|length|width|depth|height|wide|topLen|topWide|inner|storyH|counterT|topT|baseDepth|upperDepth|lotW|lotD|groundHalf|scale)$/;
/** These legitimately reach zero (a flat roof has no rise, an absent porch no columns…). */
const MAY_BE_ZERO = new Set(['crownH', 'rise', 'pitch', 'slope', 'overhang', 'eaveDrop', 'eaveSlope', 'foundation', 'apronH', 'displaced', 'partition', 'gap', 'innerOffset', 'topOffset', 'seating', 'steps', 'stepRise', 'sconces', 'columns', 'depth', 'bays', 'trimW']);

for (const [name, L] of scenes) {
  const s = snapshot(L);
  const zero: string[] = [], neg: string[] = [];
  for (const [p, n] of allNumbers(s)) {
    const leaf = p.split(/[.#[]/).pop()!.replace(/\]$/, '');
    if (p.endsWith('.@count') || !MUST_BE_POSITIVE.test(p) || MAY_BE_ZERO.has(leaf)) continue;
    if (n < 0) neg.push(`${p} = ${n.toFixed(4)}`);
    else if (n === 0) zero.push(p);
  }
  const bad = [...neg, ...zero.map((z) => `${z} = 0`)];
  if (bad.length) fail('5 RENDER', `${name}: no zero/negative sizes`, `${bad.length} — ${bad.slice(0, 5).join(', ')}`);
  else pass('5 RENDER', `${name}: no zero/negative sizes`, '');
}

// props stranded at the world origin
for (const [st, L] of extL) {
  const atOrigin: string[] = [];
  L.utilities.forEach((u, i) => { if (u.position.every((c) => c === 0)) atOrigin.push(`utility ${i} (${u.kind})`); });
  L.sconces.forEach((c, i) => { if (c.position.every((v) => v === 0)) atOrigin.push(`sconce ${i}`); });
  L.upLights.forEach((c, i) => { if (c.position.every((v) => v === 0)) atOrigin.push(`uplight ${i}`); });
  L.trees.forEach((t, i) => { if (t.x === 0 && t.z === 0) atOrigin.push(`tree ${i}`); });
  if (atOrigin.length) fail('5 RENDER', `exterior ${st}: nothing at the origin`, atOrigin.join(', '));
  else pass('5 RENDER', `exterior ${st}: nothing at the origin`, `${L.utilities.length} utilities, ${L.sconces.length} sconces, ${L.upLights.length} uplights placed`);
}

// instanced fields whose count collapsed to zero would draw an empty batch
{
  const empties: string[] = [];
  for (const [st, L] of extL) {
    if (L.treeline.length === 0) empties.push(`${st}: treeline empty (the lot ends in a void)`);
    if (L.house && L.house.elevations.length === 0) empties.push(`${st}: house has no elevations`);
    for (const b of L.blocks) for (const e of b.elevations) if (e.len <= 0) empties.push(`${st}: ${b.key} ${e.wall} elevation has zero length`);
  }
  if (kitchenL.runs.some((r) => r.base.length === 0 && r.uppers.length === 0 && r.tall.length === 0)) empties.push('kitchen: a run resolved to no cabinets');
  if (empties.length) fail('5 RENDER', 'no empty instanced batches', empties.slice(0, 5).join('; '));
  else pass('5 RENDER', 'no empty instanced batches', 'every treeline, elevation and cabinet run is non-empty');
}

// materials: every default selection resolves, and every textured recipe has its files
{
  const missing: string[] = [];
  for (const [room, sel] of Object.entries(DEFAULT_SELECTIONS)) {
    for (const [slot, id] of Object.entries(sel)) if (!getMaterial(id)) missing.push(`${room}.${slot} → "${id}" is not in the catalog`);
  }
  if (missing.length) fail('5 RENDER', 'default material selections resolve', missing.join('; '));
  else pass('5 RENDER', 'default material selections resolve', `${Object.values(DEFAULT_SELECTIONS).reduce((n, s) => n + Object.keys(s).length, 0)} slot defaults`);

  const texDir = join(process.cwd(), 'public', 'textures');
  const have = new Set(existsSync(texDir) ? readdirSync(texDir) : []);
  const brokenTex: string[] = [], noMap: string[] = [];
  for (const m of CATALOG) {
    const tex = m.pbr.texture;
    if (!tex) { if (!m.pbr.procedural && !m.pbr.color) noMap.push(m.id); continue; }
    if (!have.has(tex)) { brokenTex.push(`${m.id} → textures/${tex}`); continue; }
    for (const f of ['diff.webp', 'nor.webp', 'arm.webp']) {
      if (!existsSync(join(texDir, tex, f))) { brokenTex.push(`${m.id} → textures/${tex}/${f}`); break; }
    }
  }
  if (brokenTex.length) fail('5 RENDER', 'every textured material has its files', `${brokenTex.length} — ${brokenTex.slice(0, 6).join(', ')}`);
  else pass('5 RENDER', 'every textured material has its files', `${CATALOG.length} materials, ${have.size} texture sets on disk`);
  if (noMap.length) fail('5 RENDER', 'no material renders untextured and uncoloured', `${noMap.length} — ${noMap.slice(0, 8).join(', ')}`);
  else pass('5 RENDER', 'no material renders untextured and uncoloured', 'every recipe has a texture, a procedural or a colour');
  const flat = CATALOG.filter((m) => !m.pbr.texture && !m.pbr.procedural);
  if (flat.length) notes.push(`${flat.length}/${CATALOG.length} catalog materials are flat colour with no map or procedural: ${flat.slice(0, 10).map((m) => m.id).join(', ')}${flat.length > 10 ? ' …' : ''}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const W = Math.min(64, Math.max(...rows.map((r) => r.name.length)) + 1);
let section = '';
for (const r of rows) {
  if (r.section !== section) { section = r.section; console.log(`\n${section}`); }
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name.padEnd(W)} ${r.detail}`);
}

console.log('\nBUDGET TABLE  (limit 900 draw calls / 1,200,000 triangles)');
console.log(`  ${'scene'.padEnd(52)} ${'calls'.padStart(6)} ${'tris'.padStart(11)}`);
for (const b of budgets) {
  console.log(`  ${b.scene.padEnd(52)} ${String(b.calls).padStart(6)} ${b.tris.toLocaleString('en-US').padStart(11)}`);
}

if (notes.length) { console.log('\nNOTES'); notes.forEach((n) => console.log(`  · ${n}`)); }

const failed = rows.filter((r) => !r.pass);
console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} — ${rows.length - failed.length}/${rows.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
