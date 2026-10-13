/**
 * Geometry budget for the exterior twin — called by `check-exterior.ts`.
 *
 * Builds every geometry a full scene needs, at each quality tier, and counts
 * triangles and draw calls against the hard budget (1.2 M tris / 900 calls at
 * High). It also proves each builder actually returns geometry rather than
 * throwing on odd input, which is the only headless way to test this stream.
 */
import * as THREE from 'three';
import { triangleCount } from '../src/components/scene/detail';
import type { ExteriorLayout } from '../src/components/scene/exterior/layout';
import {
  brickmould, chimneyUnit, claddingFor, claddingRelief, columnUnit, controlJoints,
  cornerBoardPair, deckBoards, downspoutRun, dripEdge, entryHardware, fasciaBoard,
  fenceParts, gutterProfile, hedgeGeometry, hoseBib, houseNumbers, louverVent,
  mailboxGeometry, masonrySill, meterBox, mulchBed, paverField, railingParts,
  rakeRuns, ridgeCap, roofCourses, sashUnit, shrubParts, sillApron, soffitPanel,
  soldierCourse, splashBlock, stairUnit, treeParts, ventHood, waterTable,
  acCondenser, bedEdge, beadboardCeiling, doorbellButton, extOutlet, stepFlashing,
  upLightUnit, lanternBody, garageHardware, eaveBracket, shutterPanel, claddingReliefPoly,
  mowStripes,
} from '../src/components/scene/exterior/detail-ext';
import {
  eaveRuns, hipRuns, makeRoofShape, roofSolid, roofUndersideAt, wallTopProfile,
} from '../src/components/scene/exterior/helpers';
import type { RoofType } from '../src/lib/spec/types';

const TRI_BUDGET = 1_200_000;
const CALL_BUDGET = 900;

interface Tally { tris: number; calls: number }
const zero = (): Tally => ({ tris: 0, calls: 0 });
function add(t: Tally, g: THREE.BufferGeometry | null | undefined, calls = 1): Tally {
  if (!g) return t;
  t.tris += triangleCount(g);
  t.calls += calls;
  return t;
}

/** One instanced batch: N copies of a geometry, but a single draw call. */
function addInstanced(t: Tally, g: THREE.BufferGeometry | null | undefined, n: number): Tally {
  if (!g || n <= 0) return t;
  t.tris += triangleCount(g) * n;
  t.calls += 1;
  return t;
}

export function report(L: ExteriorLayout): boolean {
  const tiers: Array<'high' | 'balanced' | 'performance'> = ['high', 'balanced', 'performance'];
  let ok = true;
  const rows: string[] = [];

  for (const tier of tiers) {
    const t = zero();

    // ---- masses -----------------------------------------------------------
    for (const b of L.blocks) {
      const wallH = Math.max(0.3, b.eaveY - b.floorY);
      for (const e of b.elevations) {
        const clad = claddingFor('sid-hardie-lap-white');
        const holes = [
          ...e.windows.map((w) => ({ x: w.x, y: w.y, w: w.w + 0.2, h: w.h + 0.2 })),
          ...e.doors.map((d) => ({ x: d.x, y: 0, w: d.w + 0.2, h: d.h })),
        ];
        add(t, claddingRelief(clad, e.len, wallH, holes, tier));      // relief
        if (e.top) add(t, claddingReliefPoly(clad, e.top, tier === 'high' ? 'balanced' : tier));
        t.calls += 3; t.tris += 12;                                    // field + foundation + gable panel
        add(t, waterTable(e.len));
        add(t, cornerBoardPair(wallH, L.trimW), 0);                    // counted per corner below
        // openings
        for (const w of e.windows) {
          add(t, sashUnit(w.w, w.h, w.style));
          add(t, brickmould(w.w, w.h, L.trimW, { profile: 'brickmould', dripCap: true }));
          add(t, sillApron(w.w + L.trimW * 2, L.trimW));
          t.calls += 2; t.tris += 4;                                   // glass + backing
        }
        for (const d of e.doors) {
          add(t, brickmould(d.w, d.h, L.trimW, { profile: 'brickmould', dripCap: true }));
          if (d.kind === 'garage') { add(t, garageHardware(d.w, 4)); t.tris += 900; t.calls += 3; }
          else { const hw = entryHardware(); add(t, hw.lock); add(t, hw.kick(d.w)); t.tris += 600; t.calls += 2; }
        }
        add(t, shutterPanel(0.5, 1.4), 0);
        add(t, soldierCourse(e.len * 0.2), 0);
        add(t, masonrySill(1.2), 0);
      }
      // 4 corner boards
      addInstanced(t, cornerBoardPair(Math.max(0.4, b.eaveY - b.floorY), L.trimW), 4);
      // roof
      add(t, roofSolid(b.roof));
      add(t, roofCourses(b.roof, tier));
      add(t, ridgeCap(b.roof.along));
      for (const e of eaveRuns(b.roof)) {
        add(t, fasciaBoard(e.length));
        add(t, dripEdge(e.length));
        add(t, gutterProfile(e.length));
        add(t, soffitPanel(e.length, b.roof.overhang));
      }
      for (const r of rakeRuns(b.roof)) add(t, fasciaBoard(r.length, 0.2));
      // hip caps: four of them on a hip roof, none on anything else
      for (const h of hipRuns(b.roof)) add(t, ridgeCap(h.length));
      if (b.roof.overhang >= 0.3 && b.roof.type !== 'flat') {
        const brk = eaveBracket(b.roof.overhang * 0.85, b.roof.overhang * 2.1, 'craftsman');
        for (const e of eaveRuns(b.roof)) addInstanced(t, brk, Math.max(2, Math.min(24, Math.round(e.length / 1.55))));
      }
      for (let i = 0; i < 4; i++) { add(t, downspoutRun(b.eaveY, Math.max(0, b.roof.overhang - 0.14))); add(t, splashBlock()); }
      add(t, stepFlashing(3, 0.5), 0);
    }
    if (L.chimney) add(t, chimneyUnit(L.chimney.height));

    // ---- porch ------------------------------------------------------------
    if (L.porch) {
      const colH = Math.max(2, L.porch.roofY - L.porch.floorY);
      addInstanced(t, columnUnit(colH, L.porch.columnKind), Math.max(1, L.porch.columns));
      add(t, beadboardCeiling(L.porch.w, L.porch.depth));
      add(t, stairUnit(1.5, L.porch.floorY, Math.max(1, L.porch.steps)));
      const rail = railingParts(2.4, 0.92, 'baluster');
      add(t, rail.frame);
      addInstanced(t, rail.baluster, rail.transforms.length);
      if (L.porch.roof) {
        // the porch roof is a full <RoofMass/> now, not a bare slab
        const pr = L.porch.roof;
        add(t, roofSolid(pr));
        add(t, roofCourses(pr, tier));
        add(t, ridgeCap(pr.along));
        for (const e of eaveRuns(pr)) {
          add(t, fasciaBoard(e.length));
          add(t, dripEdge(e.length));
          add(t, gutterProfile(e.length));
          add(t, soffitPanel(e.length, pr.overhang));
        }
        for (const r of rakeRuns(pr)) add(t, fasciaBoard(r.length, 0.2));
        for (const h of hipRuns(pr)) add(t, ridgeCap(h.length));
      }
      t.calls += 6;
    }

    // ---- deck -------------------------------------------------------------
    if (L.deck) {
      const f = deckBoards(L.deck.w, L.deck.depth, L.deck.boardsAlong);
      addInstanced(t, f.board, f.transforms.length);
      add(t, f.rim);
      add(t, stairUnit(1.4, L.deck.floorY, L.deck.steps));
      const rail = railingParts(L.deck.depth, 0.92, 'baluster');
      add(t, rail.frame, 2);
      addInstanced(t, rail.baluster, rail.transforms.length * 2);
      t.calls += 8;
    }

    // ---- site -------------------------------------------------------------
    for (const p of L.driveway) { add(t, controlJoints(p.w, p.d)); t.calls += 1; t.tris += 2; }
    for (const p of L.walkway) {
      const f = paverField(p.w, p.d);
      addInstanced(t, f.paver, f.transforms.length);
      t.calls += 1;
    }
    for (const f of L.fence) {
      const parts = fenceParts(f.length, f.height);
      add(t, parts.frame);
      addInstanced(t, parts.picket, parts.transforms.length);
    }
    for (const b of L.beds) { add(t, mulchBed(b.w, b.d)); add(t, bedEdge(b.w, b.d)); }
    for (const tr of L.trees) { const g = treeParts(tr.variant, tier); add(t, g.trunk); add(t, g.canopy); }
    {
      const byVariant = new Map<number, number>();
      for (const tr of L.treeline) byVariant.set(tr.variant, (byVariant.get(tr.variant) ?? 0) + 1);
      for (const [v, n] of byVariant) {
        const g = treeParts(v, tier === 'high' ? 'balanced' : 'performance');
        addInstanced(t, g.trunk, n);
        addInstanced(t, g.canopy, n);
      }
    }
    {
      const buckets = new Map<string, number>();
      for (const s of L.shrubs) {
        const key = (Math.round(s.scale * 10) / 10).toFixed(1);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      for (const [key, n] of buckets) addInstanced(t, shrubParts(Number(key)), n);
    }
    for (const h of L.hedges) add(t, hedgeGeometry(h.length, h.height));
    if (L.mailbox) add(t, mailboxGeometry());
    for (const u of L.utilities) {
      const g = u.kind === 'hose-bib' ? hoseBib()
        : u.kind === 'meter' ? meterBox()
          : u.kind === 'dryer-vent' ? ventHood()
            : u.kind === 'outlet' ? extOutlet()
              : u.kind === 'doorbell' ? doorbellButton()
                : u.kind === 'numbers' ? houseNumbers()
                  : u.kind === 'vent-louver' ? louverVent()
                    : acCondenser();
      add(t, g);
    }
    for (let i = 0; i < L.sconces.length; i++) { add(t, lanternBody()); t.calls += 1; t.tris += 12; }
    for (let i = 0; i < L.upLights.length; i++) add(t, upLightUnit());
    add(t, mowStripes(L.lotW, L.lotD));
    t.calls += 6; t.tris += 40; // ground, street, curb, sidewalk, context plane

    const okTier = t.tris <= TRI_BUDGET && t.calls <= CALL_BUDGET;
    if (!okTier) ok = false;
    rows.push(`  ${okTier ? '✓' : '✗'} ${tier.padEnd(12)} ${t.tris.toLocaleString('en-US').padStart(10)} tris   ${String(t.calls).padStart(4)} draw calls   (budget ${TRI_BUDGET.toLocaleString('en-US')} / ${CALL_BUDGET})`);
  }

  rows.forEach((r) => console.log(r));

  // Every builder must survive garbage input rather than throwing.
  const junk = [NaN, -1, 0, Infinity, 1e9];
  let robust = true;
  for (const v of junk) {
    try {
      claddingRelief(claddingFor('sid-board-batten-white'), v, v, [{ x: v, y: v, w: v, h: v }], 'high');
      sashUnit(v, v, 'double-hung');
      brickmould(v, v, v, {});
      columnUnit(v, 'round');
      railingParts(v, v, 'baluster');
      deckBoards(v, v, 'x');
      paverField(v, v);
      fenceParts(v, v);
      stairUnit(v, v, v);
      treeParts(v, 'high');
      chimneyUnit(v);
      controlJoints(v, v);
      hedgeGeometry(v, v);
      soffitPanel(v, v);
      gutterProfile(v);
      downspoutRun(v);
      ridgeCap(v);
      dripEdge(v);
      fasciaBoard(v);
      waterTable(v);
      cornerBoardPair(v, v);
      soldierCourse(v);
      masonrySill(v);
      sillApron(v, v);
      beadboardCeiling(v, v);
      mulchBed(v, v);
      bedEdge(v, v);
      shrubParts(v);
      stepFlashing(v, v);
      garageHardware(v, v);
      eaveBracket(v, v, 'scroll');
      shutterPanel(v, v);
      claddingReliefPoly(claddingFor('sid-hardie-lap-grey'), [[v, v], [v, v], [v, v]], 'high');
      downspoutRun(v, v);
      mowStripes(v, v);
      hipRuns(makeRoofShape('hip', v, v, 'x', v, v));
    } catch (e) {
      robust = false;
      console.log(`  ✗ a builder threw on input ${v}: ${String(e)}`);
    }
  }
  if (robust) console.log('  ✓ 35 builders survive NaN / negative / zero / Infinity / 1e9 input');
  else ok = false;

  // No geometry may carry a non-finite vertex: NaN propagates into the bounding
  // sphere and can take the whole canvas down.
  let finite = true;
  const probeGeos: THREE.BufferGeometry[] = [];
  for (const b of L.blocks) { probeGeos.push(roofSolid(b.roof)); const c = roofCourses(b.roof, 'high'); if (c) probeGeos.push(c); }
  probeGeos.push(gutterProfile(8), downspoutRun(6), ridgeCap(9), sashUnit(1.2, 1.5, 'colonial'),
    brickmould(1.2, 1.5, 0.13, {}), columnUnit(2.6, 'round'), eaveBracket(0.45, 0.9, 'scroll'),
    railingParts(2.4, 0.92, 'baluster').frame, treeParts(2, 'high').canopy, mailboxGeometry());
  for (const g of probeGeos) {
    const a = g.getAttribute('position').array as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i])) { finite = false; break; }
    }
    if (!finite) break;
  }
  if (finite) console.log(`  ✓ ${probeGeos.length} representative geometries carry only finite vertices`);
  else { console.log('  ✗ a geometry contains NaN / Infinity vertices'); ok = false; }

  // Roof invariant introduced with the eave-drop fix: at the WALL LINE the roof
  // underside must land exactly on the plate, and at the overhang edge it must
  // have fallen by slope × overhang. If this drifts, every fascia, soffit,
  // gutter and gable-end panel is placed against the wrong datum.
  let roofOk = true;
  for (const type of ['gable', 'hip', 'shed', 'gambrel'] as RoofType[]) {
    for (const pitch of [3, 6, 9, 12]) {
      for (const oh of [0, 0.3, 0.9]) {
        const sh = makeRoofShape(type, pitch, oh, 'x', 13, 9);
        const atWall = roofUndersideAt(sh, sh.structAcross / 2) + sh.tv;
        const atEdge = roofUndersideAt(sh, sh.across / 2) + sh.tv + sh.eaveDrop;
        const tol = type === 'gambrel' ? 0.2 : 1e-9;
        if (Math.abs(atWall) > tol || Math.abs(atEdge) > tol) {
          roofOk = false;
          console.log(`  ✗ ${type} ${pitch}/12 oh=${oh}: plate off by ${atWall.toFixed(4)}, edge off by ${atEdge.toFixed(4)}`);
        }
        // the ridge must not care about the overhang
        const noOh = makeRoofShape(type, pitch, 0, 'x', 13, 9);
        if (Math.abs(sh.rise - noOh.rise) > 1e-9) {
          roofOk = false;
          console.log(`  ✗ ${type} ${pitch}/12: overhang moved the ridge by ${(sh.rise - noOh.rise).toFixed(4)} m`);
        }
        const top = wallTopProfile(sh, 'left', sh.structAcross, false);
        if (top && top.some((pt) => !Number.isFinite(pt[0]) || !Number.isFinite(pt[1]))) {
          roofOk = false;
          console.log(`  ✗ ${type} ${pitch}/12: gable-end profile has a non-finite point`);
        }
      }
    }
  }
  if (roofOk) console.log('  ✓ roof datum holds for 4 types × 4 pitches × 3 overhangs (ridge independent of overhang)');
  else ok = false;

  /*
   * HIP CAPS. A hip roof used to get the ridge cap and nothing on the four
   * corners the light actually catches, which is what made it read as a folded
   * sheet. `hipRuns` must produce exactly four runs on a hip and none anywhere
   * else, each starting on the EAVE EDGE (y = -eaveDrop) at an eave corner and
   * ending on the RIDGE (y = rise) — if either endpoint drifts off those datums
   * the cap floats above the shingles or sinks into them.
   */
  let hipOk = true;
  for (const type of ['gable', 'hip', 'shed', 'flat', 'gambrel'] as RoofType[]) {
    for (const ridge of ['x', 'z'] as const) {
      for (const [W, D] of [[13, 9], [9, 13], [11, 11]] as Array<[number, number]>) {
        const sh = makeRoofShape(type, 7, 0.6, ridge, W, D);
        const hips = hipRuns(sh);
        if (type !== 'hip') {
          if (hips.length) { hipOk = false; console.log(`  ✗ ${type} produced ${hips.length} hip runs`); }
          continue;
        }
        if (hips.length !== 4) { hipOk = false; console.log(`  ✗ hip ${ridge} ${W}x${D}: ${hips.length} hip runs, expected 4`); continue; }
        const hw = (sh.W + sh.overhang * 2) / 2, hd = (sh.D + sh.overhang * 2) / 2;
        for (const h of hips) {
          if (Math.abs(h.from[1] + sh.eaveDrop) > 1e-9) { hipOk = false; console.log('  x hip run does not start on the eave edge'); }
          if (Math.abs(h.to[1] - sh.rise) > 1e-9) { hipOk = false; console.log('  x hip run does not end on the ridge'); }
          if (Math.abs(Math.abs(h.from[0]) - hw) > 1e-9 || Math.abs(Math.abs(h.from[2]) - hd) > 1e-9) {
            hipOk = false; console.log('  x hip run does not start at an eave corner');
          }
          if (!(h.length > 0.1) || !Number.isFinite(h.length)) { hipOk = false; console.log('  x hip run has no usable length'); }
        }
      }
    }
  }
  if (hipOk) console.log('  ✓ hip caps: 4 runs per hip roof, eave corner → ridge; none on gable/shed/flat/gambrel');
  else ok = false;

  /*
   * DOWNSPOUTS HANG ON THE WALL. The tube sits at local z ~ +d/2 with the wall
   * at z = 0, and the offset run at the top has to cover the whole overhang.
   * Assert the geometry actually grows in +z by `reach` — a spout built without
   * it, placed at the wall, would end its top elbow in mid-air.
   */
  let spoutOk = true;
  /** How far out the TOP of the spout gets — the kick-out at grade is ignored. */
  const topReach = (reach: number): number => {
    const a = downspoutRun(4, reach).getAttribute('position').array as ArrayLike<number>;
    let z = -Infinity;
    for (let i = 0; i < a.length; i += 3) if (a[i + 1] > 3) z = Math.max(z, a[i + 2]);
    return z;
  };
  for (const reach of [0.2, 0.45, 0.9]) {
    const got = topReach(reach);
    if (got < reach * 0.9) {
      spoutOk = false;
      console.log(`  ✗ downspout reach ${reach}: the top elbow only gets to z=${got.toFixed(3)}`);
    }
  }
  if (topReach(0) > 0.12) {
    spoutOk = false;
    console.log(`  ✗ a flush eave's spout should stay on the wall, not reach z=${topReach(0).toFixed(3)}`);
  }
  if (spoutOk) console.log('  ✓ downspouts reach from the wall out to the gutter (4 overhangs)');
  else ok = false;

  return ok;
}
