/**
 * MANHATTAN — headless verification for the photo fitter.
 *
 *   npx tsx scripts/check-fit.ts
 *
 * No network. Synthetic ground truth: take the default kitchen (and
 * bathroom), stand a camera in it, project its own element boxes and call
 * those the "photo" inventory. Then perturb the camera and a handful of spec
 * fields and assert the fitter recovers them within tolerance, inside its
 * time and evaluation budget, deterministically — and that garbage in
 * (no elements, junk boxes, kinds the twin cannot draw) never throws.
 * Section 7 holds the review's findings: the gate, the correction loop's
 * adoption rules (driven here with a fake fitter), the residual names, the
 * facing cue, honesty and the cabinet slide.
 */
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { computeBathroomLayout } from '../src/components/scene/bathroom/layout';
import { computeKitchenLayout, hoodExtents, type KitchenLayoutData } from '../src/components/scene/kitchen/layout';
import { reconcileSpec } from '../src/lib/ai/reconcile';
import { measuredGapsFor, residualFromBoxes, residualsOf, runMatchLoop, specToAdopt, type FitResponse, type MatchRoundOutcome } from '../src/lib/api-client';
import {
  bathroomElementBoxes, checkBoxes, cleanElements, drawnEndSeats, drawnFacts, facingTurn, facingWallsSeen, fitToPhoto, fromEstimate, healContract, hintPenalty, honesty,
  integerScan, jointParams, kitchenElementBoxes, kitchenParams, labelHypotheses, legacyEndSeats, lookAngles, makeCamera, pendantDrop, pendantPositions,
  measureAt, projectElement, projectElementRaw, proportionError, readFrame, repairOpen, restoreFitted, stoolPositions, tidy, toEstimate, toRig, turnLabels, wallFromFacing, CABINET_MIN_IN, DEFAULT_EVALUATIONS, SCALE_TOL, type Box4, type TwinElement,
} from '../src/lib/fit';
import { ensureSpecMaterials } from '../src/lib/materials/match';
import { defaultBathroom, defaultKitchen } from '../src/lib/spec/defaults';
import { RoomSpecZ } from '../src/lib/spec/schema';
import { NO_OPEN_EDGES } from '../src/lib/spec/photo-box';
import { applyMeasurements } from '../src/lib/spec/measurements';
import { scaleRoom } from '../src/lib/fit/params';
import type { BathroomSpec, BoxOpenEdges, KitchenSpec, PhotoElement, PhotoElementKind, RoomSpec, SolvedCamera } from '../src/lib/spec/types';
import { ft, inch } from '../src/lib/units';

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const check = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The fixed point the fitter's own reconcile lands on, so "recovered" is judged against what a real spec looks like. */
const settle = <T extends RoomSpec>(spec: T): T => reconcileSpec(reconcileSpec(spec, { photoCount: 1, fixes: [] }), { photoCount: 1, fixes: [] }) as T;

/** The photo inventory a perfect vision model would produce for `spec` seen from `cam`. */
function inventory(spec: RoomSpec, cam: SolvedCamera, elements: TwinElement[]): PhotoElement[] {
  const pin = makeCamera(cam);
  const out: PhotoElement[] = [];
  elements.forEach((e, i) => {
    if (e.kind === 'other') return;
    // the box a photo outlines (a floor-standing cabinet's top and back face, not its front-bottom corners) — the same projection the fitter judges by
    const b = projectElement(pin, e);
    if (!b) return;
    // the inventory reports what is visibly in frame — a sliver clipped at the edge is not an element
    if ((b[2] - b[0]) * (b[3] - b[1]) < 0.0004) return;
    out.push({ id: `p-${i}`, kind: e.kind, wall: e.wall, box: { x0: b[0], y0: b[1], x1: b[2], y1: b[3] }, facing: null, label: e.kind, confidence: 0.9 });
  });
  void spec;
  return out;
}

/** A client fixture as it enters the app: healed onto the contract, materials ensured. */
function loadFixture(name: string): RoomSpec {
  const spec = healContract(JSON.parse(readFileSync(new URL(`./fixtures/${name}.spec.json`, import.meta.url), 'utf8')) as KitchenSpec);
  ensureSpecMaterials(spec);
  return spec;
}

/** Plain IoU of two frame boxes, for the truncation assertions in §9. */
function iou4(a: Box4, b: Box4): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 1e-12 ? inter / union : 0;
}

const withElements = <T extends RoomSpec>(spec: T, elements: PhotoElement[], camera: SolvedCamera | null = null): T =>
  ({ ...spec, detected: { ...spec.detected, elements, camera: { ...spec.detected.camera, solved: camera } } }) as T;

const fridgeOf = (s: KitchenSpec) => s.appliances.find((a) => a.kind === 'fridge')!;
const fridgeX = (s: KitchenSpec) => computeKitchenLayout(s).appliances.find((a) => a.kind === 'fridge')!.x;

// ---------------------------------------------------------------------------
console.log('\n1. Camera model');
{
  const cam: SolvedCamera = { x: 0, y: 1.5, z: 3, yawDeg: 0, pitchDeg: 0, fovDeg: 60, aspect: 4 / 3, score: 0 };
  const pin = makeCamera(cam);
  const ahead = pin.project([0, 1.5, -2]);
  check(!!ahead && Math.abs(ahead[0] - 0.5) < 1e-9 && Math.abs(ahead[1] - 0.5) < 1e-9, 'a point straight ahead lands at the frame centre');
  const right = pin.project([1, 1.5, -2]);
  const up = pin.project([0, 2.5, -2]);
  check(!!right && right[0] > 0.5 && Math.abs(right[1] - 0.5) < 1e-9, 'yaw 0: +x is to the right of the frame');
  check(!!up && up[1] < 0.5, '+y is toward the top of the frame');
  check(pin.project([0, 1.5, 4]) === null, 'a point behind the lens projects to null');
  // vertical fov: a point exactly on the top edge of the frame
  const edge = pin.project([0, 1.5 + Math.tan(30 * Math.PI / 180) * 2, 1]);
  check(!!edge && Math.abs(edge[1]) < 1e-6, 'fovDeg is the VERTICAL field of view');
  const yawed = makeCamera({ ...cam, yawDeg: 90 }).project([3, 1.5, 3]);
  check(!!yawed && Math.abs(yawed[0] - 0.5) < 1e-9, 'yaw 90 looks toward +x');
  const pitched = makeCamera({ ...cam, pitchDeg: 45 }).project([0, 1.5 - 3, 0]);
  check(!!pitched && Math.abs(pitched[0] - 0.5) < 1e-9 && Math.abs(pitched[1] - 0.5) < 1e-9, 'positive pitch looks down');
  const angles = lookAngles([0, 1.5, 3], [2, 0.5, 1]);
  check(angles.yawDeg > 0 && angles.yawDeg < 90 && angles.pitchDeg > 0, `lookAngles: toward +x/-z and downward → yaw ${angles.yawDeg.toFixed(1)}, pitch ${angles.pitchDeg.toFixed(1)}`);

  const straddle = pin.projectBox({ min: [-1, 0, -4], max: [1, 0.01, 4] });
  check(!!straddle && straddle[3] === 1 && straddle[1] < 1, 'a floor box the camera stands over is clipped at the near plane, not dropped');
  check(pin.projectBox({ min: [-1, 0, 4], max: [1, 1, 5] }) === null, 'a box entirely behind the lens projects to null');
  check(pin.projectBox({ min: [40, 0, -2], max: [41, 1, -1] }) === null, 'a box entirely out of frame projects to null');

  const k = defaultKitchen();
  const est = fromEstimate(k, 4 / 3);
  check(Math.abs(est.yawDeg) < 1e-6 && est.z > 0 && est.pitchDeg > 0, `fromEstimate: "front, looking at back" stands at +z facing -z, slightly down (yaw ${est.yawDeg.toFixed(1)}, pitch ${est.pitchDeg.toFixed(1)})`);
  check(Math.abs(fromEstimate(k, 4 / 3, { position: 'side-left', lookingAt: 'right' }).yawDeg - 90) < 25, 'facing the right wall → yaw near +90');
  check(est.fovDeg < k.detected.camera.fovDeg, `horizontal ${k.detected.camera.fovDeg}° became vertical ${est.fovDeg.toFixed(1)}° for a 4:3 frame`);
  const rig = toRig(est, k);
  check(rig.position[0] === est.x && rig.position[1] === est.y && rig.position[2] === est.z && rig.fov === est.fovDeg, 'toRig stands exactly at the solved camera');
  const back = lookAngles(rig.position, rig.target);
  check(Math.abs(back.yawDeg - est.yawDeg) < 1e-6 && Math.abs(back.pitchDeg - est.pitchDeg) < 1e-6, 'toRig aims along the solved yaw / pitch');
  const words = toEstimate(est, k);
  check(words.position === 'front' && words.lookingAt === 'back' && Math.abs(words.fovDeg - k.detected.camera.fovDeg) < 0.5, `toEstimate round-trips to "${words.position}, looking at ${words.lookingAt}, ${words.fovDeg.toFixed(1)}°"`);

  // A low camera pitched steeply at the floor: the forward ray meets the
  // floor within a metre, and toRig must keep the bearing rather than lift
  // the target off the floor on its own (which used to bend the pitch).
  // Checked against three.js itself — the studio's PerspectiveCamera looking
  // at the rig's target must project the room's points where the fitter's
  // pinhole put them.
  const steep: SolvedCamera = { x: 0.4, y: 0.5, z: 1.2, yawDeg: 12, pitchDeg: 60, fovDeg: 55, aspect: 1.5, score: 0 };
  const steepRig = toRig(steep, k);
  const steepBack = lookAngles(steepRig.position, steepRig.target);
  check(Math.abs(steepBack.pitchDeg - steep.pitchDeg) < 1e-6 && Math.abs(steepBack.yawDeg - steep.yawDeg) < 1e-6 && steepRig.target[1] >= 0.05 - 1e-9, `toRig keeps a steep pitch (${steepBack.pitchDeg.toFixed(2)}° for ${steep.pitchDeg}°) with the target on the ray, above the floor (y ${steepRig.target[1].toFixed(3)})`);
  const lookUp: SolvedCamera = { ...steep, y: 2.4, pitchDeg: -55 };
  const upRig = toRig(lookUp, k);
  const upBack = lookAngles(upRig.position, upRig.target);
  check(Math.abs(upBack.pitchDeg - lookUp.pitchDeg) < 1e-6 && upRig.target[1] <= ft(k.dims.ceilingFt) - 0.05 + 1e-9, `toRig keeps a steep upward pitch (${upBack.pitchDeg.toFixed(2)}°) with the target under the ceiling`);
  const three = new PerspectiveCamera(steepRig.fov, steep.aspect, 0.01, 100);
  three.position.set(...steepRig.position);
  three.up.set(0, 1, 0);
  three.lookAt(new Vector3(...steepRig.target));
  three.updateMatrixWorld(true);
  three.updateProjectionMatrix();
  const pin2 = makeCamera(steep);
  let worst = 0;
  for (const pt of [[0.6, 0.0, 0.2], [-0.5, 0.0, -0.3], [1.2, 0.9, -1.0], [0.0, 0.3, 0.4], [-1.5, 0.0, 0.0]] as Array<[number, number, number]>) {
    const ours = pin2.project(pt);
    const ndc = new Vector3(...pt).project(three);
    if (!ours) { worst = Infinity; continue; }
    worst = Math.max(worst, Math.abs(ours[0] - (0.5 + ndc.x / 2)), Math.abs(ours[1] - (0.5 - ndc.y / 2)));
  }
  check(worst < 1e-6, `toRig ↔ three.PerspectiveCamera: the studio projects the room where the fitter's pinhole does (max diff ${worst.toExponential(2)})`);
}

// ---------------------------------------------------------------------------
console.log('\n2. Element boxes');
{
  const k = defaultKitchen();
  const L = computeKitchenLayout(k);
  const els = kitchenElementBoxes(L);
  const problems = checkBoxes(els, L.w, L.d, L.h);
  check(problems.length === 0, `kitchen: ${els.length} boxes, all finite and inside the room${problems.length ? ` — ${problems.join('; ')}` : ''}`);
  const count = (kind: string, wall?: string) => els.filter((e) => e.kind === kind && (wall === undefined || e.wall === wall)).length;
  // the back wall's uppers are split by the window over the sink: two boxes there, one on the left, the way a photo outlines them
  check(count('base-cabinet-run') === 2 && count('upper-cabinet-run') === 3 && count('upper-cabinet-run', 'back') === 2 && count('tall-cabinet', 'back') === 1, 'two base runs, three upper-run stretches (the window splits the back row), one tall unit');
  check(count('fridge', 'back') === 1 && count('range', 'back') === 1 && count('hood', 'back') === 1 && count('dishwasher', 'back') === 1, 'fridge, range, hood, dishwasher on the back wall');
  check(count('island') === 1 && count('stool', 'island') === 3 && count('pendant') === 2, 'island, 3 stools, 2 pendants');
  check(count('window', 'back') === 1 && count('door', 'right') === 1 && count('sink', 'back') === 1 && count('faucet', 'back') === 1, 'window, door, sink, faucet');
  check(count('shelf', 'right') === 2 && count('plant') === 2 && count('art', 'right') === 1 && count('rug') === 1 && count('backsplash') === 2, 'a 2-board shelf run → 2 shelf boxes (one per board), 2 plants, art, rug, 2 backsplash fields');
  const hoodBox = els.find((e) => e.kind === 'hood')!;
  // the demo hood carries a cabinet ('doors'), so its box stops at the
  // canopy's top — the cabinet above belongs to the upper run's box
  const backRun = L.runs.find((r) => r.wall === 'back')!;
  check(Math.abs(hoodBox.box.max[1] - hoodExtents(L.appliances.find((a) => a.kind === 'hood')!).canopyTop) < 1e-9 && hoodBox.box.max[1] < backRun.upperTop - 0.05,
    'a hood with a cabinet on it is boxed to the canopy top, under the wall-cabinet row');
  // and the box is the canopy's FRONT face, not its 24 in depth
  check(Math.abs((hoodBox.box.max[2] - hoodBox.box.min[2]) - 0.05) < 1e-9, `the hood's box has the depth of its front face (${(hoodBox.box.max[2] - hoodBox.box.min[2]).toFixed(3)} m)`);
  {
    // a bare chimney hood still runs up to the ceiling with its duct cover
    const bare = structuredClone(k);
    bare.appliances.find((a) => a.kind === 'hood')!.cabinetAbove = 'none';
    const Lb = computeKitchenLayout(bare);
    const hb = kitchenElementBoxes(Lb).find((e) => e.kind === 'hood')!;
    check(hb.box.max[1] >= Lb.h - 0.02, 'a chimney hood with nothing on it runs up to the ceiling with its duct cover');
  }
  const pendBoxes = els.filter((e) => e.kind === 'pendant');
  check(pendBoxes.every((p) => Math.abs(p.box.max[1] - L.h) < 1e-9), 'a pendant\'s box runs from the ceiling hook to the shade');
  check(count('wall') === 4 && count('floor') === 1 && count('ceiling') === 1, 'four walls, floor, ceiling');

  const fridge = els.find((e) => e.kind === 'fridge')!;
  const surround = els.find((e) => e.kind === 'tall-cabinet')!;
  check(fridge.box.min[0] >= surround.box.min[0] - 0.01 && fridge.box.max[0] <= surround.box.max[0] + 0.01 && fridge.box.max[2] < -L.d / 2 + 1, 'the fridge sits inside its surround against the back wall');
  const range = els.find((e) => e.kind === 'range')!;
  const hood = els.find((e) => e.kind === 'hood')!;
  check(Math.abs((range.box.min[0] + range.box.max[0]) / 2 - (hood.box.min[0] + hood.box.max[0]) / 2) < 0.01 && hood.box.min[1] > range.box.max[1], 'the hood is centred over the range');
  const win = els.find((e) => e.kind === 'window')!;
  check(Math.abs(win.box.min[1] - inch(42)) < 0.01 && win.box.min[2] < -L.d / 2 + 0.05, 'the window sits on the back wall plane at its sill');
  const island = els.find((e) => e.kind === 'island')!;
  check(Math.abs(island.box.max[1] - L.counterTopY) < 0.02 && island.box.min[1] === 0, 'the island box runs floor to counter');
  const stools = els.filter((e) => e.kind === 'stool');
  check(stools.every((s) => s.box.min[2] > island.box.max[2] - 0.6 || s.box.max[2] < island.box.min[2] + 0.6), 'stools sit along one long face of the island');
  const range0 = els.find((e) => e.kind === 'range')!;
  check(!!range0.faces && range0.faces.length === 2 && !!range0.alt && range0.alt.kind === 'cooktop' && range0.alt.box.min[1] > range0.box.min[1] + 0.5, 'a range carries its outline faces and the top-strip box a photo\'s "cooktop" means');
  const shade = pendantDrop(L);
  const pend = els.filter((e) => e.kind === 'pendant');
  check(pend.every((p) => Math.abs(p.box.min[1] - (L.h - shade - 0.03)) < 1e-6), 'pendant boxes reach down to the shade');
  const pp = pendantPositions(L);
  check(pp.length === 2 && pp.every((p) => Math.abs(p[2] - (L.island!.cz + L.island!.topOffset)) < 1e-9), 'pendants spread along the island top (KitchenLighting rule)');
  const sp = stoolPositions(L.island!);
  check(sp.length === 3 && Math.abs(sp[1][0]) < 1e-9 && sp.every((s) => s[1] === sp[0][1]), 'stools are pitched symmetrically about the island centre (island.ts rule)');

  // rotated island: boxes turn with it
  const rot = { ...k, island: { ...k.island, rotationDeg: 90 as const, offset: { x: 2, z: 0 } } };
  const Lr = computeKitchenLayout(rot);
  const elsR = kitchenElementBoxes(Lr);
  const islR = elsR.find((e) => e.kind === 'island')!;
  const rectR = Lr.island!.rect;
  check(checkBoxes(elsR, Lr.w, Lr.d, Lr.h).length === 0 && rectR.maxZ - rectR.minZ > rectR.maxX - rectR.minX && islR.box.min[0] <= rectR.minX + 1e-9 && islR.box.max[0] >= rectR.maxX - 1e-9 && islR.box.min[2] <= rectR.minZ + 1e-9 && islR.box.max[2] >= rectR.maxZ - 1e-9, 'a rotated island (and its stools) stays inside the room, runs along z, and its box covers the top');

  const b = defaultBathroom();
  const B = computeBathroomLayout(b);
  const bels = bathroomElementBoxes(B);
  const bproblems = checkBoxes(bels, B.w, B.d, B.h);
  check(bproblems.length === 0, `bathroom: ${bels.length} boxes, all finite and inside the room${bproblems.length ? ` — ${bproblems.join('; ')}` : ''}`);
  const bcount = (kind: string) => bels.filter((e) => e.kind === kind).length;
  check(bcount('vanity') === 1 && bcount('mirror') === 1 && bcount('sink') === 2 && bcount('faucet') === 2, 'vanity, mirror, two basins with taps');
  check(bcount('shower') === 1 && bcount('tub') === 1 && bcount('toilet') === 1 && bcount('window') === 1 && bcount('door') === 1, 'shower, tub, toilet, window, door');
  // `shelf` is three things in a bathroom now — a décor board, the shower's
  // recessed niche and its tiled curb, which is the convention the inventory
  // prompt asks the annotator for — so the count is read off what the layout
  // actually solved rather than off the décor alone.
  const stall = B.shower;
  const stallShelves = (stall?.nicheAt ? 1 : 0) + (stall && !stall.curbless && !stall.hasTub && stall.curbHeight > 0.01 ? 1 : 0);
  check(bcount('shelf') === 2 + stallShelves && bcount('art') === 1 && bcount('plant') === 2 && bcount('rug') === 1, `2 shelf boards + ${stallShelves} stall shelf box(es) (niche / curb), art, 2 plants, rug`);
  check(bcount('backsplash') >= 1 && bcount('towel-bar') === B.accessories.filter((a) => a.kind !== 'corner-shelf').length, `the tile field is boxed (${bcount('backsplash')}) and every fitting with it (${bcount('towel-bar')})`);

  // garbage specs still produce sane boxes
  const junk = { ...k, dims: { widthFt: NaN, depthFt: -3, ceilingFt: 'tall' }, runs: [null, {}], island: { present: true, lengthFt: 99 }, appliances: [{}, null, { kind: 'toaster' }], decor: null } as unknown as KitchenSpec;
  try {
    const Lj = computeKitchenLayout(junk);
    const ej = kitchenElementBoxes(Lj);
    check(checkBoxes(ej, Lj.w, Lj.d, Lj.h).length === 0 && ej.length >= 6, `junk kitchen spec → ${ej.length} finite boxes`);
  } catch (err) { fail(`junk kitchen spec threw: ${(err as Error).message}`); }
}

// ---------------------------------------------------------------------------
console.log('\n3. Synthetic ground truth — kitchen');
{
  // the default kitchen's fridge surround overflows its run and is clamped to
  // the end (any t past ~0.81 draws the same thing); pull it in so the fridge
  // position is a real degree of freedom the fit has to recover
  const base = defaultKitchen();
  base.runs[0].tall[0].t = 0.7;
  fridgeOf(base).t = 0.79;
  const truth = settle(base);
  const truthCam = fromEstimate(truth, 4 / 3, { position: 'corner-right', lookingAt: 'back', fovDeg: 70, heightFt: 5 });
  const L = computeKitchenLayout(truth);
  const photo = inventory(truth, truthCam, kitchenElementBoxes(L));
  check(photo.length >= 18, `${photo.length} elements visible from the truth camera`);

  // the perturbed twin: the analyzer got the room roughly right and the details wrong
  const wrong = structuredClone(truth);
  wrong.island.lengthFt = truth.island.lengthFt + 1.5;
  wrong.runs[1].lengthFt = truth.runs[1].lengthFt - 2;
  wrong.runs[0].tall[0].t = truth.runs[0].tall[0].t - 0.15;
  fridgeOf(wrong).t = fridgeOf(truth).t - 0.15;
  wrong.openings[0].widthFt = truth.openings[0].widthFt + 1;
  const wrongCam: SolvedCamera = { ...truthCam, x: truthCam.x - 0.5, z: truthCam.z + 0.3, yawDeg: truthCam.yawDeg + 8, fovDeg: truthCam.fovDeg - 10 };
  const start = withElements(wrong, photo);

  const t0 = Date.now();
  const r = fitToPhoto(start, { aspect: 4 / 3, camera: wrongCam });
  const ms = Date.now() - t0;
  const s = r.spec as KitchenSpec;
  console.log(`    loss ${r.lossBefore?.toFixed(3)} → ${r.lossAfter?.toFixed(3)}, score ${r.score?.toFixed(3)}, ${r.iterations} rounds, ${r.evaluations} layout evals, ${r.ms} ms, matched ${r.matched.length}, unmatched photo ${r.unmatchedPhoto.length}, twin ${r.unmatchedTwin.length}`);
  for (const n of r.notes) console.log(`      note: ${n}`);
  check(ms <= 8000 && r.evaluations <= DEFAULT_EVALUATIONS, `inside the budget (${ms} ms, ${r.evaluations} evaluations)`);
  check(RoomSpecZ.safeParse(r.spec).success, 'fitted spec is a valid RoomSpec');
  check(r.score !== null && r.score >= 0.9, `mean IoU ${r.score?.toFixed(3)} ≥ 0.9`);
  check(r.proportions !== null && r.proportions >= 0.95, `proportions ${r.proportions?.toFixed(3)} ≥ 0.95 — the optimiser is not the limit; the detector is`);
  check(r.lossAfter !== null && r.lossBefore !== null && r.lossAfter < r.lossBefore, 'loss went down');
  // The island's left end is out of frame from this camera, so the picture can
  // only check the drawn RIGHT end — and it must land on the truth.
  //
  // The 1.25 ft clause below was deleted for a round with the argument that no
  // camera here measures the off-frame length, and that it had only ever passed
  // because `buildIsland` REFUSED to draw an island longer than twice its
  // shorter half — a refusal that moved the visible end and so manufactured a
  // gradient out of a clamp. Lifting the clamp (it drew client-marble-items'
  // declared 5.5 ft island as a 2.51 ft stub) did remove that gradient, and the
  // fit then sat at 8.45 ft for a truth of 7 — which the deleted clause would
  // have FAILED. That was the last red assertion on the client's island
  // complaint, so it is back, with the mechanism that makes it honest: the
  // lifted clamp made (offset.x, lengthFt) degenerate — park the anchor
  // anywhere and let the body slide back — and `honesty` now charges the slide,
  // so the only spec the search can settle on is one that describes its own
  // island. With that, the fit lands 7.3 ft for a truth of 7 from a start of
  // 8.5: the length is recovered from the visible end plus the anchor, not from
  // a clamp. Both clauses are asserted, and the no-regression clause is kept
  // beside them.
  const islandEnd = (sp: KitchenSpec) => computeKitchenLayout(sp).island!.rect.maxX;
  const drift = Math.abs(s.island.lengthFt - truth.island.lengthFt);
  const started = Math.abs(wrong.island.lengthFt - truth.island.lengthFt);
  check(Math.abs(islandEnd(s) - islandEnd(truth)) <= 0.15, `island's visible end drawn within 15 cm of the truth (${Math.abs(islandEnd(s) - islandEnd(truth)).toFixed(3)} m)`);
  check(drift <= 1.25, `and the off-frame LENGTH is recovered to 1.25 ft (${s.island.lengthFt} ft for a truth of ${truth.island.lengthFt}, started at ${wrong.island.lengthFt})`);
  check(drift <= started + 1e-6, `the off-frame end is never pushed further from the truth than the ${wrong.island.lengthFt} ft it started at (drift ${drift.toFixed(2)} ≤ ${started.toFixed(2)})`);
  check(r.matched.filter((m) => m.kind === 'pendant').every((m) => m.iou >= 0.75), `pendants land on the photo (IoU ${r.matched.filter((m) => m.kind === 'pendant').map((m) => m.iou.toFixed(2)).join(', ')})`);
  check(Math.abs(s.runs[1].lengthFt - truth.runs[1].lengthFt) <= 0.5, `left run ${s.runs[1].lengthFt} ft recovered within 6 in of ${truth.runs[1].lengthFt}`);
  // judged on where the fridge is DRAWN, not on its `t`: the layout snaps it
  // into its surround, so any t across that plateau draws the same fridge and
  // the search keeps the middle of the plateau by design (fit.ts's scan rule)
  check(Math.abs(fridgeX(s) - fridgeX(truth)) <= 0.15, `fridge drawn within 15 cm of the truth (off by ${Math.abs(fridgeX(s) - fridgeX(truth)).toFixed(3)} m; t ${r3(fridgeOf(s).t)} for ${r3(fridgeOf(truth).t)}, mid-plateau)`);
  check(Math.abs(s.openings[0].widthFt - truth.openings[0].widthFt) <= 0.5, `window width ${s.openings[0].widthFt} ft within 6 in of ${truth.openings[0].widthFt}`);
  const cam = r.camera;
  check(Math.hypot(cam.x - truthCam.x, cam.y - truthCam.y, cam.z - truthCam.z) <= 0.35, `camera position within 35 cm (off by ${Math.hypot(cam.x - truthCam.x, cam.y - truthCam.y, cam.z - truthCam.z).toFixed(2)} m)`);
  check(Math.abs(cam.yawDeg - truthCam.yawDeg) <= 3 && Math.abs(cam.fovDeg - truthCam.fovDeg) <= 5, `camera yaw within 3° (off ${Math.abs(cam.yawDeg - truthCam.yawDeg).toFixed(1)}°), fov within 5° (off ${Math.abs(cam.fovDeg - truthCam.fovDeg).toFixed(1)}°)`);
  check(r.spec.detected.camera.solved !== null && r.spec.detected.camera.solved!.score === r.score, 'solved camera stored on detected.camera.solved with the score');
  check(r.spec.detected.camera.position === 'corner-right' && r.spec.detected.camera.lookingAt === 'back', `detected.camera words follow the solve (${r.spec.detected.camera.position}, ${r.spec.detected.camera.lookingAt})`);
  check(start.island.lengthFt === truth.island.lengthFt + 1.5 && start.detected.camera.solved === null, 'input spec was not mutated');
  check(r.matched.every((m) => m.iou >= 0 && m.iou <= 1 && m.twin.every((v) => v >= 0 && v <= 1)), 'every match reports a normalised twin box and an IoU in 0..1');

  // determinism
  const r2 = fitToPhoto(start, { aspect: 4 / 3, camera: wrongCam });
  const strip = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'ms' ? undefined : v));
  check(strip(r) === strip(r2), 'same input → byte-identical result (ms aside)');

  // a fit that starts right stays right
  const already = fitToPhoto(withElements(truth, photo), { aspect: 4 / 3, camera: truthCam });
  check(already.score !== null && already.score >= 0.97 && already.spec_unchanged === 'gated' && Math.abs((already.spec as KitchenSpec).island.lengthFt - truth.island.lengthFt) < 0.05, `a correct twin is left alone and gated (IoU ${already.score?.toFixed(3)}, spec ${already.spec_unchanged})`);

  // --- the new gate clause: a mean IoU can rise by DROPPING the pairings it
  // was doing worst on. Take the truth's own inventory, hand the fitter a twin
  // with one fewer stool, and the fitted spec — however well it scores — must
  // not be adopted when it matches fewer elements than the original did.
  {
    const short = structuredClone(truth);
    short.island.seating = Math.max(0, short.island.seating - 1);
    const rShort = fitToPhoto(withElements(short, photo), { aspect: 4 / 3, camera: truthCam });
    const fewer = rShort.notes.find((n) => n.includes('matched fewer elements'));
    check(rShort.spec_unchanged === 'gated' || (rShort.spec as KitchenSpec).island.seating === short.island.seating,
      `a twin missing a stool is never "improved" into matching less (${rShort.spec_unchanged ?? 'ungated'}${fewer ? `: ${fewer}` : ''})`);
  }

  // no starting camera at all: the analyzer's words (wrong corner on purpose) are only a hint
  const noCam = withElements({ ...wrong, detected: { ...wrong.detected, camera: { ...wrong.detected.camera, position: 'corner-left' as const, fovDeg: 62 } } }, photo);
  const r3x = fitToPhoto(noCam, { aspect: 4 / 3 });
  check(r3x.score !== null && r3x.score >= 0.85 && r3x.camera.x > 0, `from the wrong standpoint word the fit still finds the right corner (IoU ${r3x.score?.toFixed(3)}, x ${r3x.camera.x.toFixed(2)})`);
  check(['converged', 'rounds', 'evaluations', 'time'].includes(r.endedBy) && r.endedBy !== 'time', `the fit reports what ended it (${r.endedBy}) — never the wall clock on a healthy run`);
  check(r.spec_unchanged === null && r.originalScore !== null && r.score! > r.originalScore, `the gate let the edits through (fitted ${r.score?.toFixed(3)} vs original ${r.originalScore?.toFixed(3)} through the solved camera)`);

  // --- room size: the analyzer read the whole room 20% too big (then 20% too
  // small). No single field move can fix that (each wall pushes the near
  // elements across the frame), so the scale scan + camera-relative dims
  // moves + the joint scale coordinate must recover it. The truth here has a
  // back run a couple of feet short of its wall: a run that exactly fills
  // its wall sits on the layout's corner-ownership knife edge, where a 2%
  // wider wall flips which run owns the corner and slides the whole run by
  // a counter depth — no room size could be recovered through that.
  {
    const roomBase = defaultKitchen();
    roomBase.runs[0].lengthFt = 14;
    roomBase.runs[0].tall[0].t = 0.7;
    fridgeOf(roomBase).t = 0.79;
    const roomTruth = settle(roomBase);
    const roomCam = fromEstimate(roomTruth, 4 / 3, { position: 'corner-right', lookingAt: 'back', fovDeg: 70, heightFt: 5 });
    const roomPhoto = inventory(roomTruth, roomCam, kitchenElementBoxes(computeKitchenLayout(roomTruth)));
    for (const factor of [1.2, 0.8]) {
      const off = structuredClone(roomTruth);
      off.dims.widthFt = roomTruth.dims.widthFt * factor;
      off.dims.depthFt = roomTruth.dims.depthFt * factor;
      const offCam = fromEstimate(off, 4 / 3, { position: 'corner-right', lookingAt: 'back', fovDeg: 70, heightFt: 5 });
      const rb = fitToPhoto(withElements(off, roomPhoto), { aspect: 4 / 3, camera: offCam });
      const sb = rb.spec as KitchenSpec;
      const offW = Math.abs(sb.dims.widthFt - roomTruth.dims.widthFt) / roomTruth.dims.widthFt, offD = Math.abs(sb.dims.depthFt - roomTruth.dims.depthFt) / roomTruth.dims.depthFt;
      console.log(`    room ${factor > 1 ? '20% too big' : '20% too small'}: ${off.dims.widthFt.toFixed(1)}×${off.dims.depthFt.toFixed(1)} → ${sb.dims.widthFt}×${sb.dims.depthFt} (truth ${roomTruth.dims.widthFt}×${roomTruth.dims.depthFt}), IoU ${rb.score?.toFixed(3)}, ${rb.evaluations} evals, ${rb.notes.join(' | ')}`);
      check(offW <= 0.06 && offD <= 0.06, `room ${factor > 1 ? 'too big' : 'too small'}: width / depth recovered within 6% (off ${(offW * 100).toFixed(1)}% / ${(offD * 100).toFixed(1)}%)`);
      check(rb.score !== null && rb.score >= 0.93, `and the twin lands on the photo (IoU ${rb.score?.toFixed(3)} ≥ 0.93)`);
    }
  }

  // --- matching rules
  {
    // the inventory's wall is a hint: a fridge labelled 'right' (it sits at the
    // right edge of the frame) still pairs with the twin's back-wall fridge
    // a photo that says "cooktop" outlines the range's top and control strip, not the whole body
    const rangeEl = kitchenElementBoxes(L).find((e) => e.kind === 'range')!;
    const cooktopBox = makeCamera(truthCam).projectBox(rangeEl.alt!.box)!;
    const relabelled = photo.map((p) => (p.kind === 'fridge' ? { ...p, wall: 'right' as const } : p.kind === 'range' ? { ...p, kind: 'cooktop' as const, box: { x0: cooktopBox[0], y0: cooktopBox[1], x1: cooktopBox[2], y1: cooktopBox[3] } } : p));
    const rw = fitToPhoto(withElements(wrong, relabelled), { aspect: 4 / 3, camera: wrongCam });
    check(rw.matched.some((m) => m.kind === 'fridge' && m.wall === 'back' && m.iou > 0.5), `a fridge labelled 'right' still matches the back-wall fridge (IoU ${rw.matched.find((m) => m.kind === 'fridge')?.iou.toFixed(2)})`);
    check(rw.matched.some((m) => m.kind === 'cooktop' && m.iou > 0.5), `a photo 'cooktop' matches the twin's range by kind family (IoU ${rw.matched.find((m) => m.kind === 'cooktop')?.iou.toFixed(2)})`);
    check(rw.score !== null && rw.score >= 0.9, `and the fit is as good as with the right labels (IoU ${rw.score?.toFixed(3)})`);
    // but a wall IS its label: the photo's 'right' wall never pairs with the twin's front wall
    check(rw.matched.filter((m) => m.kind === 'wall').every((m) => relabelled.find((p) => p.id === m.photoId)?.wall === m.wall), 'wall boxes only ever pair with the wall of the same name');

    // more of a kind than the twin draws at all (three stools): the extras
    // beyond the count are surplus, not "out of frame", and cost nothing —
    // so they cannot pull the camera or the island toward them
    const stool = photo.find((p) => p.kind === 'stool')!;
    const extras = [0.02, 0.62, 0.86].map((x0, i) => ({ ...stool, id: `stool-extra-${i}`, box: { x0, y0: 0.62, x1: x0 + 0.08, y1: 0.85 }, confidence: 0.4 }));
    const extra = [...photo, ...extras, { id: 'bowl', kind: 'other' as PhotoElementKind, wall: 'island' as const, box: { x0: 0.4, y0: 0.5, x1: 0.5, y1: 0.6 }, facing: null, label: 'fruit bowl', confidence: 0.9 }];
    const re = fitToPhoto(withElements(wrong, extra), { aspect: 4 / 3, camera: wrongCam });
    check(re.unmatchedPhoto.some((u) => u.id.startsWith('stool-extra') && u.reason === 'twin has fewer of this kind'), `a fourth stool for a three-stool island is reported as "twin has fewer of this kind"`);
    check(re.unmatchedPhoto.some((u) => u.id === 'bowl' && u.reason === 'kind not scored'), `kind 'other' is reported as "kind not scored"`);
    const camOff = Math.hypot(re.camera.x - cam.x, re.camera.y - cam.y, re.camera.z - cam.z);
    const endOff = Math.abs(computeKitchenLayout(re.spec as KitchenSpec).island!.rect.maxX - computeKitchenLayout(s).island!.rect.maxX);
    check(camOff < 0.25 && Math.abs(re.camera.yawDeg - cam.yawDeg) < 1.5 && endOff < 0.15 && Math.abs((re.spec as KitchenSpec).runs[1].lengthFt - s.runs[1].lengthFt) < 0.3, `and neither drives the fit (camera off by ${camOff.toFixed(2)} m / ${Math.abs(re.camera.yawDeg - cam.yawDeg).toFixed(1)}°, island end off by ${endOff.toFixed(2)} m)`);
  }

  // --- an inventory answered in bottom-left-origin coordinates (floor above the ceiling) is flipped, fitted and written back the right way up
  {
    const flipped = photo.map((p) => ({ ...p, box: { x0: p.box.x0, y0: 1 - p.box.y1, x1: p.box.x1, y1: 1 - p.box.y0 } }));
    check(flipped.some((p) => p.kind === 'floor') && flipped.some((p) => p.kind === 'ceiling'), 'the synthetic inventory has both a floor and a ceiling box');
    const notes: string[] = [];
    const cleaned = cleanElements(withElements(wrong, flipped), notes);
    check(notes.length === 1 && /flipped/.test(notes[0]) && cleaned.every((c) => { const o = photo.find((p) => p.id === c.id)!; return Math.abs(c.box.y0 - o.box.y0) < 1e-9 && Math.abs(c.box.y1 - o.box.y1) < 1e-9; }), `cleanElements flips a bottom-left-origin inventory and says so ("${notes[0]}")`);
    const rf = fitToPhoto(withElements(wrong, flipped), { aspect: 4 / 3, camera: wrongCam });
    check(rf.score !== null && rf.score >= 0.9 && rf.notes.some((n) => /flipped/.test(n)), `the fit on the flipped inventory is as good as on the original (IoU ${rf.score?.toFixed(3)}) and notes the flip`);
    const back = rf.spec.detected.elements.find((e) => e.kind === 'floor')!;
    check(back.box.y1 > 0.5 && rf.spec.detected.elements.find((e) => e.kind === 'ceiling')!.box.y0 < 0.5, 'the fitted spec carries the inventory the right way up');
  }
}

// ---------------------------------------------------------------------------
console.log('\n4. Synthetic ground truth — bathroom');
{
  const truth = settle(defaultBathroom());
  // shot from the doorway corner toward the vanity wall: vanity, mirror, tub, shower and window in frame
  const truthCam = fromEstimate(truth, 4 / 3, { position: 'corner-right', lookingAt: 'left', fovDeg: 80, heightFt: 5 });
  const photo = inventory(truth, truthCam, bathroomElementBoxes(computeBathroomLayout(truth)));
  check(photo.some((p) => p.kind === 'vanity') && photo.some((p) => p.kind === 'tub'), `${photo.length} elements visible, vanity and tub among them`);
  // (the tub shares its wall with the shower and has no room to slide, so its
  // position is not a free variable — its length is)
  const wrong = structuredClone(truth);
  wrong.vanity.widthIn = truth.vanity.widthIn - 12;
  wrong.vanity.t = truth.vanity.t + 0.1;
  wrong.tub.lengthIn = truth.tub.lengthIn - 12;
  wrong.openings[0].widthFt = truth.openings[0].widthFt + 1;
  const wrongCam: SolvedCamera = { ...truthCam, x: truthCam.x - 0.4, yawDeg: truthCam.yawDeg - 6, fovDeg: truthCam.fovDeg + 8 };
  const r = fitToPhoto(withElements(wrong, photo), { aspect: 4 / 3, camera: wrongCam });
  const s = r.spec as BathroomSpec;
  console.log(`    loss ${r.lossBefore?.toFixed(3)} → ${r.lossAfter?.toFixed(3)}, score ${r.score?.toFixed(3)}, ${r.iterations} rounds, ${r.evaluations} layout evals, ${r.ms} ms`);
  check(r.ms <= 8000 && r.evaluations <= DEFAULT_EVALUATIONS, `inside the budget (${r.ms} ms, ${r.evaluations} evaluations)`);
  check(RoomSpecZ.safeParse(r.spec).success, 'fitted spec is a valid RoomSpec');
  check(r.score !== null && r.score >= 0.85, `mean IoU ${r.score?.toFixed(3)} ≥ 0.85`);
  check(Math.abs(s.vanity.widthIn - truth.vanity.widthIn) <= 6, `vanity width ${s.vanity.widthIn}" within 6 in of ${truth.vanity.widthIn}`);
  // the vanity wall is crowded (the tub reaches into its corner), so a band of
  // `t` values draws the same vanity — judge where it is DRAWN, not the number
  const vanityX = (sp: BathroomSpec) => computeBathroomLayout(sp).vanity!.x;
  check(Math.abs(vanityX(s) - vanityX(truth)) <= 0.1, `vanity drawn within 10 cm of the truth (${Math.abs(vanityX(s) - vanityX(truth)).toFixed(3)} m, t ${r3(s.vanity.t)} vs ${r3(truth.vanity.t)})`);
  check(Math.abs(s.tub.lengthIn - truth.tub.lengthIn) <= 6, `tub length ${s.tub.lengthIn}" within 6 in of ${truth.tub.lengthIn}`);
  const tubX = (sp: BathroomSpec) => computeBathroomLayout(sp).tub!.x;
  check(Math.abs(tubX(s) - tubX(truth)) <= 0.1, `tub drawn within 10 cm of the truth (${Math.abs(tubX(s) - tubX(truth)).toFixed(3)} m)`);
  check(Math.abs(r.camera.yawDeg - truthCam.yawDeg) <= 4 && Math.hypot(r.camera.x - truthCam.x, r.camera.z - truthCam.z) <= 0.35, `camera yaw within 4° (off ${Math.abs(r.camera.yawDeg - truthCam.yawDeg).toFixed(1)}°), position within 35 cm (off ${Math.hypot(r.camera.x - truthCam.x, r.camera.z - truthCam.z).toFixed(2)} m)`);
}

// ---------------------------------------------------------------------------
console.log('\n5. Robustness');
{
  const k = defaultKitchen();
  const none = fitToPhoto(k);
  check(none.spec === k && none.score === null && none.matched.length === 0 && none.iterations === 0, 'no elements → input spec returned, score null');
  check(Number.isFinite(none.camera.x) && Number.isFinite(none.camera.yawDeg), 'no elements → still a usable starting camera');
  const ext = fitToPhoto({ roomType: 'exterior' } as unknown as RoomSpec);
  check(ext.score === null, 'exterior spec → score null, no throw');

  const garbage = {
    ...k,
    detected: {
      ...k.detected,
      elements: [
        null, 42, 'fridge',
        { id: 'a', kind: 'fridge', wall: 'back', box: { x0: NaN, y0: 0, x1: 1, y1: 1 }, label: '', confidence: 0.9 },
        { id: 'b', kind: 'fridge', wall: 'back', box: { x0: 'left', y0: 0, x1: 1, y1: 1 }, label: '', confidence: 0.9 },
        { id: 'c', kind: 'island', wall: 'nowhere', box: { x0: 0.9, y0: 0.9, x1: 0.2, y1: 0.4 }, label: '', confidence: 7 },       // reversed, bad wall, silly confidence
        { id: 'c', kind: 'window', wall: 'back', box: { x0: -5, y0: -5, x1: 9, y1: 9 }, label: '', confidence: -1 },               // duplicate id, out of range
        { id: 'd', kind: 'window', wall: 'back', box: { x0: 0.3, y0: 0.3, x1: 0.3001, y1: 0.5 }, label: '', confidence: 0.9 },     // sliver
        { id: 'e', kind: 'unicorn', wall: 'back', box: { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }, label: '', confidence: 0.9 },       // unknown kind
        { id: 'f', kind: 'towel-bar', wall: 'right', box: { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }, label: '', confidence: 0.9 },    // no kitchen counterpart
      ],
    },
  } as unknown as KitchenSpec;
  try {
    const cleaned = cleanElements(garbage);
    check(cleaned.length === 4 && cleaned.every((e) => e.box.x1 > e.box.x0 && e.box.y1 > e.box.y0 && e.confidence >= 0 && e.confidence <= 1), `garbage inventory cleaned to ${cleaned.length} usable elements`);
    check(cleaned.find((e) => e.kind === 'other') !== undefined && cleaned.filter((e) => e.id.startsWith('c')).length === 2 && cleaned.find((e) => e.kind === 'island')?.wall === null, 'unknown kind → other, duplicate id disambiguated, bad wall → null');
    const r = fitToPhoto(garbage, { aspect: 4 / 3, maxMs: 1500 });
    check(RoomSpecZ.safeParse(r.spec).success, 'garbage inventory → fit does not throw and returns a valid spec');
    check(r.unmatchedPhoto.some((u) => u.kind === 'towel-bar' && u.reason === 'no twin counterpart') && r.unmatchedPhoto.some((u) => u.kind === 'other' && u.reason === 'kind not scored'), 'kinds the twin cannot draw are reported as unmatched, not penalised');
  } catch (err) { fail(`garbage inventory threw: ${(err as Error).message}`); }

  // an inventory with only things the twin cannot draw → nothing to fit
  const onlyOther = { ...k, detected: { ...k.detected, elements: [{ id: 'x', kind: 'towel-bar', wall: null, box: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 }, label: '', confidence: 1 }] } } as KitchenSpec;
  const ro = fitToPhoto(onlyOther);
  check(ro.score === null && ro.spec === onlyOther, 'inventory with no drawable kinds → input spec, score null');

  // a spec the layout cannot make sense of still comes back valid
  const broken = { ...k, runs: 'nope', island: null, detected: { ...k.detected, elements: [{ id: 'w', kind: 'wall', wall: 'back', box: { x0: 0, y0: 0, x1: 1, y1: 0.6 }, label: '', confidence: 1 }] } } as unknown as KitchenSpec;
  try {
    const rb = fitToPhoto(broken, { maxMs: 800 });
    check(Number.isFinite(rb.camera.yawDeg), 'broken spec → no throw');
  } catch (err) { fail(`broken spec threw: ${(err as Error).message}`); }

  // budget knobs are honoured
  const truth = settle(defaultKitchen());
  const cam = fromEstimate(truth, 4 / 3);
  const photo = inventory(truth, cam, kitchenElementBoxes(computeKitchenLayout(truth)));
  const wrong = { ...truth, island: { ...truth.island, lengthFt: truth.island.lengthFt + 2 } };
  const tight = fitToPhoto(withElements(wrong, photo), { aspect: 4 / 3, maxEvaluations: 60, maxMs: 300 });
  check(tight.evaluations <= 60 + 45 && tight.ms <= 900, `evaluation / time caps honoured (${tight.evaluations} evals, ${tight.ms} ms)`);
  check(tight.endedBy === 'evaluations', `the evaluation cap is what ended it (${tight.endedBy})`);
  const clock = fitToPhoto(withElements(wrong, photo), { aspect: 4 / 3, maxEvaluations: 20000, maxMs: 50 });
  check(clock.endedBy === 'time' && clock.ms < 400, `the wall clock is only a safety net, and is named when it fires (${clock.endedBy}, ${clock.ms} ms)`);
  void (undefined as unknown as KitchenLayoutData);
}

// ---------------------------------------------------------------------------
console.log('\n6. Client photos (regression fixtures)');
{
  // Two real analyzer specs with their photo inventories. Before the review
  // fixes the fitter DISTORTED both (a 6 ft wide island; a 10.5 ft island
  // shrunk to 5 ft) and never moved the range. The targets below are the
  // review's — physical plausibility first, then the score.
  // the fixtures predate the per-element contract and the tall-cabinet slot:
  // healed the way a stored project is on its way into the fit route
  const load = (name: string): KitchenSpec => {
    const spec = healContract(JSON.parse(readFileSync(new URL(`./fixtures/${name}.spec.json`, import.meta.url), 'utf8')) as KitchenSpec);
    ensureSpecMaterials(spec);
    return spec;
  };
  const iouOf = (r: ReturnType<typeof fitToPhoto>, kind: string, wall?: string) => r.matched.find((m) => m.kind === kind && (wall === undefined || m.wall === wall))?.iou ?? 0;
  const report = (label: string, r: ReturnType<typeof fitToPhoto>) => {
    for (const n of r.notes) console.log(`      note: ${n}`);
    const worst = [...r.matched].sort((a, b) => a.iou - b.iou).slice(0, 6);
    // dx / dy: photo centre − twin centre as a fraction of the frame; dw / dh: photo size ÷ twin size − 1, said as "+18% wider"
    const pctDiff = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
    console.log(`      ${label}: coverage ${r.coverage === null ? '–' : (r.coverage * 100).toFixed(0)}%; worst matches: ${worst.map((m) => `${m.kind}${m.wall ? `@${m.wall}` : ''} ${m.iou.toFixed(2)} (dx ${m.dx.toFixed(2)}, dy ${m.dy.toFixed(2)}, ${pctDiff(m.dw)} wide, ${pctDiff(m.dh)} tall)`).join('; ')}`);
    for (const u of r.unmatchedPhoto) console.log(`      unmatched: ${u.hint}`);
  };
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

  const marble = load('client-marble');
  const rm = fitToPhoto(marble, { aspect: 1.784 });
  const sm = rm.spec as KitchenSpec;
  const range = sm.appliances.find((a) => a.kind === 'range' || a.kind === 'cooktop')!;
  const hood = sm.appliances.find((a) => a.kind === 'hood')!;
  const fridgeIoU = rm.matched.find((m) => m.kind === 'fridge')?.iou ?? 0;
  console.log(`    marble: score ${rm.score?.toFixed(3)} / proportions ${rm.proportions?.toFixed(3)} (original ${rm.originalScore?.toFixed(3)}), ${rm.iterations} rounds, ${rm.evaluations} evals, ${rm.ms} ms, ended by ${rm.endedBy}${rm.spec_unchanged ? `, spec ${rm.spec_unchanged}` : ''}; island ${sm.island.lengthFt}×${sm.island.widthFt} ft, range t ${range.t}, hood t ${hood.t}, fridge IoU ${fridgeIoU.toFixed(2)}`);
  report('marble', rm);
  check(RoomSpecZ.safeParse(rm.spec).success, 'marble: fitted spec is valid');
  // 6.0, not the old 6.5: that floor assumed the analyzer's 8 ft guess, and
  // the fit now lands 6.24 × 3.12 with the end stools tucked on the right
  check(sm.island.lengthFt >= 6 && sm.island.lengthFt <= 9.5 && sm.island.widthFt >= 3 && sm.island.widthFt <= 5, `marble: island stays a real island (${sm.island.lengthFt}×${sm.island.widthFt} ft; was fitted to 6.2×6 before)`);
  // the range's `t` alone says little (the layout snaps it into whichever gap the cabinet list puts within reach; the fit moves the gap): judge where it is DRAWN
  const rangeIoU = rm.matched.find((m) => m.kind === 'range' || m.kind === 'cooktop')?.iou ?? 0;
  const hoodIoU = rm.matched.find((m) => m.kind === 'hood')?.iou ?? 0;
  check(near(range.t, hood.t, 0.08) && rangeIoU >= 0.3 && hoodIoU >= 0.3, `marble: the range is drawn on the photo's (IoU ${rangeIoU.toFixed(2)}) with the hood over it (IoU ${hoodIoU.toFixed(2)}, t ${range.t.toFixed(3)} / ${hood.t.toFixed(3)})`);
  check(fridgeIoU > 0.3, `marble: the fridge (inventory said wall 'right') is matched (IoU ${fridgeIoU.toFixed(2)})`);
  // The review asked for ≥ 0.6. What is left below that is not the fitter's
  // to fix: the photo's fridge stands on the RIGHT wall (it fills 75% of the
  // frame at the right edge) while the analyzer put it on the back wall; the
  // range can only be drawn in the main run's gap (t 0.39) or free past
  // t 0.69, because the layout snaps an appliance to any gap within 1.6 m;
  // and the island's end stools sit on whichever end the layout finds
  // clearer. The floor here guards against regressing what the fit does reach.
  // The floors sit ~2 points under what the tree measures, the way the old
  // 0.66 sat under 0.68. They are valid for exactly this configuration — the
  // 0.25 proportion term in the loss, the box conventions in boxes.ts and the
  // scan order in params.ts. Change any of those and re-derive them; NEVER
  // loosen one to make a run pass.
  check(rm.score !== null && rm.score >= 0.73, `marble: score ${rm.score?.toFixed(3)} ≥ 0.73 (was 0.682 before the box conventions and the new degrees of freedom)`);
  // Pinned just under what the converged search reaches, not three points
  // below it: a gate at 0.86 against a client who asked for 0.90 hides the gap
  // instead of guarding it.
  // RE-DERIVED TWICE, per the paragraph above ("change any of those and
  // re-derive them"). Every number, so nothing is hidden:
  //   0.8913  the plain loss;
  //   0.8876  + the truncation term. The 0.004 is paid on the island pair
  //           (err 0.201, detector-limited) and bought back on mean IoU
  //           (0.7547 → 0.7551); the term is what pushes client-marble's
  //           frame-cut LEFT WALL out to the edge instead of stopping 3% of
  //           the picture inside it.
  //   0.8836  + `implausibility` flooring a run at the boxes it cannot shrink.
  //           This one is a DELIBERATE trade, not a drift: without it the fit
  //           bought 0.004 of proportions by shrinking `run-back-fridge` to
  //           34.7 in around a 39 in fridge surround and a 36 in void — a run
  //           nobody can build, whose entire base list the layout then drew as
  //           nothing, and which ACCEPTANCE §1 ("base widths must still sum to
  //           the run length within 10%") reads as 24.5% off. It is now 8.2%
  //           off and buildable. A tenth of a point of proportions on a
  //           fixture that misses the client's 90% either way is worth less
  //           than a bid whose cabinet run is real.
  // DISCLOSURE, because the number moved and the size of the move matters: this
  // gate was 0.89 before the truncation round, so it fell 0.009, and the
  // comment it replaced said the number should RISE to 0.895. It did not. The
  // three steps above are the whole of the fall and each is a deliberate trade
  // written down. Measured today: 0.8836 — the derivation exactly, with 0.0026
  // of headroom against the gate.
  check(rm.proportions !== null && rm.proportions >= 0.881, `marble: proportions ${rm.proportions?.toFixed(4)} ≥ 0.881 (was 0.89 before truncation: 0.8913 plain → 0.8876 + truncation → 0.8836 + the buildable-run floor — re-derived, and the 0.009 fall disclosed)`);
  // ...and it is still SHORT of the 0.90 the client named, on this photo, for
  // reasons the optimiser cannot reach: the inventory boxes the back base run
  // and the range THROUGH the island (dh −41% / −47%), it puts the fridge on
  // the right wall where the twin draws none, and the two far stools and the
  // second pendant sit where an evenly spaced row cannot reach. The shelves
  // fixture clears 0.90 with the same code. The studio reports the number the
  // fit measured and says which residuals it is short on — it is never
  // rounded up, and this gate exists to keep it from being quietly lowered.
  check(rm.proportions !== null && rm.proportions < 0.90, `marble: and honestly BELOW 0.90 (${rm.proportions?.toFixed(3)}) — detector-limited, reported as measured; raise this check the day the residuals close`);
  check(rm.coverage !== null && rm.coverage >= 0.90, `marble: coverage ${rm.coverage === null ? '–' : (rm.coverage * 100).toFixed(0)}% ≥ 90%`);
  // the ceiling stays where the analyzer read it: the `uppersToCeiling` trap
  // is closed, so the search lowers the UPPERS rather than the room
  const backRunM = sm.runs.find((r) => r.wall === 'back' && r.hasUppers !== false);
  check(Math.abs(sm.dims.ceilingFt - 9) <= 0.5, `marble: the ceiling stays near 9 ft (${sm.dims.ceilingFt}) — the fit lowers the uppers, not the room`);
  check(!!backRunM && (backRunM.uppersToCeiling === false || (backRunM.upperHeightIn ?? 0) >= 24), `marble: the back run's uppers carry their own height (toCeiling ${backRunM?.uppersToCeiling}, ${backRunM?.upperHeightIn ?? 'room default'} in)`);
  check(iouOf(rm, 'island') >= 0.75, `marble: the island lands on the photo (IoU ${iouOf(rm, 'island').toFixed(3)}; 0.579 before the tucked-stool convention)`);
  check(iouOf(rm, 'ceiling') >= 0.9, `marble: the ceiling lands (IoU ${iouOf(rm, 'ceiling').toFixed(3)}; 0.696 when the search was crushing it)`);
  check(iouOf(rm, 'upper-cabinet-run', 'back') >= 0.7, `marble: the back uppers land (IoU ${iouOf(rm, 'upper-cabinet-run', 'back').toFixed(3)})`);
  // an explicit cabinetAbove in the fixture is a measurement: neither the fit
  // nor the reconciler may rewrite it
  check(hood.cabinetAbove === 'none', `marble: the fixture's explicit hood cabinetAbove survives the fit ('${hood.cabinetAbove}')`);
  // the detail layer against a real photo: the fixture's bowl of limes is an
  // 'item' box in its own inventory, and the twin has to put one where the
  // photo does. Without this the item kind is exercised only by the demo.
  const bowl = rm.matched.find((m) => m.kind === 'item');
  check(!!bowl && bowl.iou >= 0.3, `marble: the bowl of limes on the island is drawn where the photo has it (IoU ${bowl?.iou.toFixed(3) ?? '–'})`);
  check(sm.decor.items.length === 1 && sm.decor.cabinetContents.length === 1, `marble: the fit carries the detail layer through untouched (${sm.decor.items.length} item, ${sm.decor.cabinetContents.length} cabinet)`);
  // still open, and deliberately so: the inventory boxes the base runs THROUGH
  // the island, so the range and the base runs read too tall (a first-order
  // occlusion clip was measured at −2.7 / −12.4 points and rejected)
  check(iouOf(rm, 'range') >= 0.25 || iouOf(rm, 'cooktop') >= 0.25, `marble: the range is matched at all (IoU ${Math.max(iouOf(rm, 'range'), iouOf(rm, 'cooktop')).toFixed(3)} — the base-run/range occlusion residual is documented, not fixed)`);
  // the search is deterministic: it runs until the evaluation budget is spent
  // or a full spec + camera round changes NOTHING (another round would repeat it)
  // converged, not cut off: the budget is now large enough that the search
  // stops when it stops improving. That is the difference between the 0.887 a
  // 6000-evaluation cap left on the table and the 0.895 the optimiser reaches.
  check(rm.evaluations <= DEFAULT_EVALUATIONS && rm.endedBy === 'converged', `marble: ${rm.iterations} rounds, ${rm.evaluations} of ${DEFAULT_EVALUATIONS} evaluations, ended by ${rm.endedBy} — converged, never the wall clock, never a loose tolerance`);
  // the result carries the gaps under the names the client reads, and they
  // are the same numbers the client would derive from the matched boxes
  {
    const derived = rm.matched.map((m) => residualFromBoxes({ kind: m.kind, wall: m.wall, index: m.twinIndex, iou: m.iou, twin: m.twin, photo: m.photo }));
    const read = residualsOf(rm, rm.spec.detected.elements);
    let worstDiff = 0;
    read.forEach((a, i) => {
      const b = derived[i];
      if (!b || a.kind !== b.kind || a.wall !== b.wall || a.index !== b.index) { worstDiff = Infinity; return; }
      worstDiff = Math.max(worstDiff, Math.abs(a.dx - b.dx), Math.abs(a.dy - b.dy), Math.abs(a.dw - b.dw), Math.abs(a.dh - b.dh), Math.abs(a.iou - b.iou));
    });
    check(rm.residuals.length === rm.matched.length && read === rm.residuals, `marble: the fit reports ${rm.residuals.length} residuals, one per matched pair, and residualsOf reads them as they are`);
    check(read.length === derived.length && worstDiff < 1e-9, `marble: residualsOf(fit) equals residualFromBoxes over the matched pairs (worst difference ${worstDiff.toExponential(1)})`);
    const said = rm.unmatchedPhoto.filter((u) => u.reason !== 'kind not scored');
    check(rm.hints.length === said.length && rm.hints.every((h, i) => h === said[i].hint), `marble: the fit reports ${rm.hints.length} hints — one per unmatched photo element the twin could draw`);
    const withLabel = rm.residuals.find((x) => x.kind === 'fridge');
    check(!!withLabel && withLabel.label === 'stainless french-door fridge', `marble: residuals carry the inventory's label ("${withLabel?.label}")`);
  }

  const shelves = load('client-shelves');
  const rsh = fitToPhoto(shelves, { aspect: 1.499 });
  const ssh = rsh.spec as KitchenSpec;
  const shelfMatches = rsh.matched.filter((m) => m.kind === 'shelf' && m.iou > 0.1).length;
  const stoolMatches = rsh.matched.filter((m) => m.kind === 'stool' && m.iou > 0.1).length;
  console.log(`    shelves: score ${rsh.score?.toFixed(3)} / proportions ${rsh.proportions?.toFixed(3)} (original ${rsh.originalScore?.toFixed(3)}), ${rsh.iterations} rounds, ${rsh.evaluations} evals, ${rsh.ms} ms, ended by ${rsh.endedBy}${rsh.spec_unchanged ? `, spec ${rsh.spec_unchanged}` : ''}; island ${ssh.island.lengthFt}×${ssh.island.widthFt} ft, dims ${ssh.dims.widthFt}×${ssh.dims.depthFt}×${ssh.dims.ceilingFt}, ${shelfMatches} shelf boards + ${stoolMatches} stools matched`);
  report('shelves', rsh);
  check(RoomSpecZ.safeParse(rsh.spec).success, 'shelves: fitted spec is valid');
  check(ssh.island.lengthFt >= 9, `shelves: the island stays big (${ssh.island.lengthFt} ft; the photo's island box spans 78% of the frame — it was shrunk to 5.2 ft before)`);
  check(rsh.matched.some((m) => m.kind === 'cooktop'), `shelves: the photo's cooktop is matched to the spec's range by kind family`);
  check(shelfMatches === 4, `shelves: all 4 shelf boards matched (${shelfMatches})`);
  check(stoolMatches === 5, `shelves: all 5 stools matched (${stoolMatches})`);
  // Before the fixes the score was 0.57 — bought with a 5 ft island and a
  // shrunken room. With the island kept big and the room near the analyzer's
  // size the mean IoU is a little lower; what holds it under the review's
  // 0.6 is the scene's rules rather than the search: pendants spread over
  // 62% of the island top (the photo's hang 0.55 m apart on an 11 ft
  // island), five stools at a 28" pitch with one round the end, a
  // full-height backsplash in the spec where the photo's stops at the
  // shelves, and a 48" range boxed against a photo of a cooktop.
  check(rsh.score !== null && rsh.score >= 0.76, `shelves: score ${rsh.score?.toFixed(3)} ≥ 0.76 (was 0.724)`);
  check(rsh.proportions !== null && rsh.proportions >= 0.90, `shelves: proportions ${rsh.proportions?.toFixed(3)} ≥ 0.90 — above 90% on the number the client asked about (was 0.907)`);
  check(rsh.coverage !== null && rsh.coverage >= 0.95, `shelves: coverage ${rsh.coverage === null ? '–' : (rsh.coverage * 100).toFixed(0)}% ≥ 95%`);
  // the splash stops under the clerestory sills: a height in INCHES, which the
  // old three-way category could never express
  check(typeof ssh.backsplash.heightIn === 'number' && ssh.backsplash.heightIn >= 30 && ssh.backsplash.heightIn <= 50, `shelves: backsplash.heightIn fitted to ${ssh.backsplash.heightIn} in (30–50; it stops under the clerestory windows)`);
  check(iouOf(rsh, 'backsplash') >= 0.5, `shelves: the splash lands (IoU ${iouOf(rsh, 'backsplash').toFixed(3)}; 0.283 under the category scan)`);
  const boards = rsh.matched.filter((m) => m.kind === 'shelf').map((m) => m.iou);
  check(boards.length === 4 && boards.every((v) => v >= 0.6), `shelves: every board lands (${boards.map((v) => v.toFixed(2)).join(', ')}; 0.36–0.49 before the board box took what stands on it)`);
  check(Math.max(iouOf(rsh, 'cooktop'), iouOf(rsh, 'range')) >= 0.5, `shelves: the cooktop lands (IoU ${Math.max(iouOf(rsh, 'cooktop'), iouOf(rsh, 'range')).toFixed(3)}; 0.459 before the strip was widened — a 48 in range boxed against a photo of a cooktop is the rest)`);
  const shHood = ssh.appliances.find((a) => a.kind === 'hood');
  check(!!shHood && (shHood.aboveCounterIn ?? 30) >= 20 && (shHood.aboveCounterIn ?? 30) < 24, `shelves: the hood mouth fits below the old 24 in scan floor (${shHood?.aboveCounterIn} in)`);
  check(Math.abs(ssh.dims.widthFt - shelves.dims.widthFt) / shelves.dims.widthFt <= 0.3 && Math.abs(ssh.dims.ceilingFt - shelves.dims.ceilingFt) <= 1, `shelves: room stays near the analyzer's size (${ssh.dims.widthFt}×${ssh.dims.depthFt}×${ssh.dims.ceilingFt})`);
  // determinism on real data
  const again = fitToPhoto(shelves, { aspect: 1.499 });
  const strip = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'ms' ? undefined : v));
  check(strip(again) === strip(rsh), 'shelves: same input → byte-identical result');
  const againM = fitToPhoto(marble, { aspect: 1.784 });
  check(strip(againM) === strip(rm), 'marble: same input → byte-identical result');
  for (const [label, r] of [['marble', rm], ['shelves', rsh]] as Array<[string, ReturnType<typeof fitToPhoto>]>) {
    check(r.evaluations <= DEFAULT_EVALUATIONS && ['evaluations', 'converged', 'rounds'].includes(r.endedBy), `${label}: ${r.evaluations} of ${DEFAULT_EVALUATIONS} evaluations, ended by ${r.endedBy} — never the wall clock`);
  }
  // the contract fields arrive as arrays on a fixture that predates them
  check(Array.isArray(marble.decor.items) && Array.isArray(marble.decor.cabinetContents), 'marble: healContract gives the fixture its decor.items / cabinetContents arrays');
  check(RoomSpecZ.safeParse(marble).success && RoomSpecZ.safeParse(shelves).success, 'both healed fixtures are valid RoomSpecs');
}

// ---------------------------------------------------------------------------
// (an async block: the correction loop is driven with a fake fitter; tsx runs
// this file as CommonJS, so the wait happens inside a function)
void (async () => {
  console.log('\n7. Review findings');
  const k0 = defaultKitchen();
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  const rangeX = (s: KitchenSpec) => computeKitchenLayout(s).appliances.find((a) => a.kind === 'range')!.x;

  // --- 1. A gated fit hands back the spec it was given, not a re-reconciled
  // one that draws differently. The range here sits where the layout draws
  // it free (t 0.25, no gap within reach); the reconciler would snap it
  // into the main run's gap two feet to the right. The inventory is that
  // spec's own drawing, so the fit has nothing to improve and is gated.
  {
    const free = structuredClone(k0);
    for (const a of free.appliances) if (a.kind === 'range' || a.kind === 'hood') a.t = 0.25;
    const rec = settle(structuredClone(free));
    check(Math.abs(rangeX(rec) - rangeX(free)) > 0.4, `the reconciler moves this spec's range by ${Math.abs(rangeX(rec) - rangeX(free)).toFixed(2)} m (into its gap) — the case the gate must not hand back`);
    const cam = fromEstimate(free, 4 / 3, { position: 'front', lookingAt: 'back', fovDeg: 70, heightFt: 5 });
    const photo = inventory(free, cam, kitchenElementBoxes(computeKitchenLayout(free)));
    const input = withElements(free, photo);
    const g = fitToPhoto(input, { aspect: 4 / 3, camera: cam });
    console.log(`    gated case: score ${g.score?.toFixed(3)} (original ${g.originalScore?.toFixed(3)}), ${g.evaluations} evals, ${g.ms} ms, spec ${g.spec_unchanged}; range drawn at x ${rangeX(input).toFixed(2)} → ${rangeX(g.spec as KitchenSpec).toFixed(2)}`);
    check(g.spec_unchanged === 'gated' && g.originalScore !== null && g.originalScore >= 0.97, `a twin that already lands on its photo is gated (original ${g.originalScore?.toFixed(3)})`);
    check(near(rangeX(g.spec as KitchenSpec), rangeX(input), 0.01) && (g.spec as KitchenSpec).appliances.find((a) => a.kind === 'range')!.t === 0.25, `the gated result draws the range where the input did (x ${rangeX(g.spec as KitchenSpec).toFixed(2)}), not where the reconciler would`);
    check(g.score !== null && g.originalScore !== null && g.score >= g.originalScore - 1e-6, `and scores no worse than the input through the solved camera (${g.score?.toFixed(3)} vs ${g.originalScore?.toFixed(3)})`);
    check(g.spec.detected.camera.solved !== null && RoomSpecZ.safeParse(g.spec).success, 'the gated spec carries the solved camera and is valid');

    // the client adopts ONLY the camera from a gated result
    const held = input;
    const adopted = specToAdopt(held, g) as KitchenSpec;
    check(adopted !== held && adopted.island === held.island && adopted.runs === held.runs && adopted.appliances === held.appliances, 'specToAdopt on a gated fit keeps the spec the client holds (same island / runs / appliances objects) in a new wrapper');
    check(adopted.detected.camera.solved === g.camera && adopted.detected.camera.position === g.spec.detected.camera.position, 'and attaches the solved camera with its words');
    const notGated = { spec: g.spec, camera: g.camera, spec_unchanged: null } as Pick<FitResponse, 'spec' | 'camera' | 'spec_unchanged'>;
    check(specToAdopt(held, notGated) === g.spec, 'specToAdopt on an ungated fit takes the fitted spec');
  }

  // --- 2. The correction loop judges every round against the ADOPTED twin's score
  {
    const drive = async (start: number | null, outcomes: MatchRoundOutcome[], opts = {}) => {
      const adoptedRounds: number[] = [];
      const res = await runMatchLoop(start, { alive: () => true, round: async (n) => outcomes[n - 1] ?? null, adopt: (n) => { adoptedRounds.push(n); return true; } }, { maxRounds: outcomes.length, target: 0.99, ...opts });
      return { res, adoptedRounds };
    };
    const a = await drive(0.6, [{ score: 0.7, changed: true }, { score: 0.69, changed: true }, { score: 0.71, changed: true }]);
    check(a.adoptedRounds.join(',') === '1,3' && a.res.rejected === 1 && a.res.score === 0.71, `a round below the adopted score is refused even inside the old 0.02 margin (adopted rounds ${a.adoptedRounds.join(', ')}; score ${a.res.score})`);
    const b = await drive(0.6, [{ score: 0.75, changed: true }, { score: 0.74, changed: true }]);
    check(b.adoptedRounds.join(',') === '1' && b.res.score === 0.75 && b.res.history[1].adopted === false, `a worse twin is never adopted (0.74 after 0.75 refused; score ${b.res.score})`);
    const c = await drive(0.6, [{ score: 0.8, changed: false, gated: true }, { score: 0.8, changed: true }]);
    check(c.adoptedRounds.join(',') === '2' && c.res.history[0].adopted === false && c.res.score === 0.8, 'a round that applied no corrections and whose fit was gated adopts nothing; the next real round does');
    const d = await drive(null, [{ score: 0.5, changed: true }, { score: 0.45, changed: true }]);
    check(d.adoptedRounds.join(',') === '1' && d.res.score === 0.5, 'with no start score the first measured round is adopted and then defended');
    let monotone = true;
    let last = 0.6;
    for (const h of a.res.history) { if (h.adopted && h.score !== null) { if (h.score < last) monotone = false; last = h.score; } }
    check(monotone, 'the adopted score never goes down');
  }

  // --- 3. FitMatch.dw/dh are differences (photo ÷ twin − 1), like FitResidual
  {
    const truth = settle(defaultKitchen());
    const cam = fromEstimate(truth, 4 / 3);
    const photo = inventory(truth, cam, kitchenElementBoxes(computeKitchenLayout(truth)));
    // a photo box twice as wide as the twin's must read as +100% wide, not ×2
    const wider = photo.map((p) => (p.kind === 'window' ? { ...p, box: { ...p.box, x0: Math.max(0, p.box.x0 - (p.box.x1 - p.box.x0) / 2), x1: Math.min(1, p.box.x1 + (p.box.x1 - p.box.x0) / 2) } } : p));
    const r = fitToPhoto(withElements(truth, wider), { aspect: 4 / 3, camera: cam, maxEvaluations: 10, maxMs: 300 });
    const win = r.matched.find((m) => m.kind === 'window');
    const same = r.matched.find((m) => m.kind === 'floor');
    check(!!win && win.dw > 0.5 && win.dw < 1.2, `a photo window twice the twin's width reads dw ${win?.dw.toFixed(2)} (a difference: ~+1.0, not a ratio of ~2)`);
    check(!!same && Math.abs(same.dw) < 0.05 && Math.abs(same.dh) < 0.05, `a box that lands reads dw / dh ≈ 0 (${same?.dw.toFixed(3)} / ${same?.dh.toFixed(3)})`);
    const viaBoxes = r.matched.map((m) => residualFromBoxes({ kind: m.kind, wall: m.wall, index: m.twinIndex, iou: m.iou, twin: m.twin, photo: m.photo }));
    check(r.matched.every((m, i) => Math.abs(m.dw - viaBoxes[i].dw) < 1e-9 && Math.abs(m.dh - viaBoxes[i].dh) < 1e-9 && Math.abs(m.dx - viaBoxes[i].dx) < 1e-9 && Math.abs(m.dy - viaBoxes[i].dy) < 1e-9), 'every match\'s dx / dy / dw / dh equal residualFromBoxes on its boxes');
    check(r.residuals.length === r.matched.length && r.residuals.every((x, i) => x.dw === r.matched[i].dw && x.index === r.matched[i].twinIndex), 'the result\'s residuals mirror the matches, index = twinIndex');
  }

  // --- 4. Round-one residuals are reused only for the very spec they were measured on
  {
    const specA = structuredClone(k0);
    const specB = structuredClone(k0);
    const report = { projectId: 'p1', spec: specA, residuals: [{ kind: 'fridge', wall: 'back', iou: 0.5, dx: 0.1, dy: 0, dw: 0, dh: 0 }], hints: ['a hint'] };
    const same = measuredGapsFor(report, 'p1', specA);
    const other = measuredGapsFor(report, 'p1', specB);
    const otherProject = measuredGapsFor(report, 'p2', specA);
    check(same.residuals?.length === 1 && same.hints?.length === 1, 'gaps measured on this spec object are reused');
    check(other.residuals === undefined && other.hints === undefined && otherProject.residuals === undefined, 'an equal-looking but different spec object (an edit since the fit), or another project, gets none — the route measures for itself');
  }

  // --- 5. Honesty holds explicit contract values to what the scene draws; the joint round evolves the counts
  {
    const honest = structuredClone(k0);
    honest.island.endSeats = 0;
    const L = computeKitchenLayout(honest);
    const drawn = drawnFacts(L);
    check(drawn.pendants !== null && drawn.hood !== null && drawn.island !== null, `drawnFacts reads the pendant row (${drawn.pendants?.spreadM.toFixed(2)} m), the hood (${drawn.hood?.heightM.toFixed(2)} m) and the island (${drawn.island?.endSeats} end seats) off the layout`);
    check(honesty(honest, drawn) === 0, 'a spec whose contract fields are auto (0 / null) is honest by definition');
    const spread = structuredClone(honest);
    spread.lighting.pendants!.spreadFt = 12; // a 7 ft island: the row is clamped inside its top
    const spreadDrawn = drawnFacts(computeKitchenLayout(spread));
    check(spreadDrawn.pendants!.spreadM < 12 * 0.3048 - 0.5 && honesty(spread, spreadDrawn) > 0.05, `a 12 ft pendant spread the scene clamps to ${spreadDrawn.pendants!.spreadM.toFixed(2)} m is charged (${honesty(spread, spreadDrawn).toFixed(3)})`);
    const offset = structuredClone(honest);
    offset.lighting.pendants!.offsetFt = 6;
    check(honesty(offset, drawnFacts(computeKitchenLayout(offset))) > 0.05, 'a pendant offset the row cannot make is charged');
    const seats = structuredClone(honest);
    seats.island.seating = 4; seats.island.endSeats = 3;
    check(computeKitchenLayout(seats).island!.endSeats < 3 && honesty(seats, drawnFacts(computeKitchenLayout(seats))) > 0, 'end seats the island does not draw are charged');
    const tall = structuredClone(honest);
    tall.appliances.find((a) => a.kind === 'hood')!.heightIn = 90; // taller than the ceiling leaves room for
    check(honesty(tall, drawnFacts(computeKitchenLayout(tall))) > 0.05, 'a hood height the ceiling cuts short is charged');
    const joint = jointParams(kitchenParams(honest, honest));
    check(joint.some((p) => p.label === 'island.endLayout' && integerScan(p)) && joint.some((p) => p.label === 'backsplash.heightIn'), 'the joint round takes the scan-only end-seat layout as a rounded coordinate, and the splash height as a stepped one');
    check(!joint.some((p) => /gap\[/.test(p.label)), 'but not a gap\'s index — a list position, not a quantity');
  }

  // --- 6. A cabinet slide keeps every plain cabinet at 12" or more and is charged in the prior
  {
    const spec = structuredClone(k0);
    spec.runs[0].base = [{ widthIn: 15, type: 'door' }, { widthIn: 30, type: 'appliance-gap' }, { widthIn: 15, type: 'door' }, { widthIn: 24, type: 'door' }];
    spec.runs[0].lengthFt = 7;
    const params = kitchenParams(spec, spec);
    const slide = params.find((p) => p.label === 'runs[0].base[1].slide');
    check(!!slide && typeof slide.prior === 'function', 'the gap\'s slide is a search coordinate with a prior');
    if (slide) {
      const slid = structuredClone(spec);
      slide.set(slid, 20);
      const widths = slid.runs[0].base.map((c) => c.widthIn);
      check(widths[0] === CABINET_MIN_IN && widths.every((w, i) => i === 1 || w >= CABINET_MIN_IN), `a 20" slide takes what the 15" door can give down to ${CABINET_MIN_IN}" and no further (${widths.join(', ')})`);
      check(near(widths.reduce((a, b) => a + b, 0), 84, 1e-6) && widths[1] === 30, 'the row\'s total and the gap\'s own width stay');
      check(slide.prior!(spec) === 0 && slide.prior!(slid) > 0.9, `the prior reads the slide off the widths: 0 before, ${slide.prior!(slid).toFixed(2)} after`);
    }
  }

  // --- 7. Hints for unmatched elements speak the INVENTORY's walls, even when the fit read the labels turned
  {
    const truth = settle(defaultKitchen());
    const cam = fromEstimate(truth, 4 / 3, { position: 'corner-right', lookingAt: 'back', fovDeg: 70, heightFt: 5 });
    const photo = inventory(truth, cam, kitchenElementBoxes(computeKitchenLayout(truth)));
    // every label a quarter-turn off (the inventory model called the back wall 'right'), plus a towel bar it labelled 'right' that the twin cannot draw
    const turned = [...turnLabels(photo, 1), { id: 'towel', kind: 'towel-bar' as PhotoElementKind, wall: 'right' as const, box: { x0: 0.1, y0: 0.3, x1: 0.2, y1: 0.35 }, facing: null, label: 'towel bar', confidence: 0.8 }];
    const r = fitToPhoto(withElements(truth, turned), { aspect: 4 / 3, camera: cam, maxEvaluations: 400 });
    check(r.notes.some((n) => /turned/.test(n)), `the fit read the labels turned ("${r.notes.find((n) => /turned/.test(n))}")`);
    const towel = r.unmatchedPhoto.find((u) => u.id === 'towel');
    check(!!towel && towel.wall === 'right' && /on the right wall/.test(towel.hint), `the unmatched towel bar is reported on the inventory's 'right' wall, not the turned 'back' ("${towel?.hint}")`);
    check(r.hints.includes(towel?.hint ?? ''), 'and the same words are in the result\'s hints');
  }

  // --- 8. healContract fills endSeats from what the layout draws, not the old guess
  {
    // a spec written before `endSeats` existed
    const island: Partial<KitchenSpec['island']> = { ...k0.island, seating: 4, offset: { x: 0, z: 0 } };
    delete island.endSeats;
    const legacy = { ...structuredClone(k0), island } as unknown as KitchenSpec;
    const guess = legacyEndSeats(island);
    const drawn = drawnEndSeats(legacy);
    check(guess === 2 && drawn === 0, `for a 4-seat island with no clear end the old guess says ${guess} end seats, the layout draws ${drawn}`);
    const healed = healContract(structuredClone(legacy));
    check(healed.island.endSeats === drawn, `healContract writes the drawn count (${healed.island.endSeats})`);
    check(computeKitchenLayout(healed).island!.endSeats === computeKitchenLayout(legacy).island!.endSeats, 'so the healed spec draws the island it drew');
  }

  // --- 9. The facing cue is a strong wall hint
  {
    check(hintPenalty({ kind: 'fridge', wall: null, facing: null }, 'back') === 0 && hintPenalty({ kind: 'fridge', wall: 'back', facing: 'front' }, 'back') === 0, 'no hint, or a cue that agrees, costs nothing');
    const label = hintPenalty({ kind: 'fridge', wall: 'right', facing: null }, 'back');
    const facing = hintPenalty({ kind: 'fridge', wall: 'right', facing: 'left' }, 'back');
    check(label > 0 && facing > label && Number.isFinite(facing), `a front turned left (right wall) against a back-wall twin costs ${facing} — more than the label's ${label}, never an exclusion`);
    check(hintPenalty({ kind: 'fridge', wall: 'right', facing: 'left' }, 'right') === 0 && hintPenalty({ kind: 'fridge', wall: 'back', facing: 'right' }, 'left') === 0, "facing 'left' pairs freely with the right wall, 'right' with the left");
    check(hintPenalty({ kind: 'fridge', wall: 'right', facing: 'edge' }, 'back') === label, 'edge-on says nothing: the label decides');
    check(hintPenalty({ kind: 'wall', wall: 'right', facing: null }, 'back') === Infinity, 'a wall box is still its label');
    check(wallFromFacing('left', -1) === 'back' && hintPenalty({ kind: 'fridge', wall: 'right', facing: 'left' }, 'back', -1) === 0, 'under a turned labelling the cue turns with the labels');

    // the client-marble fixture with the fridge's cue set (the other engineer is adding cues to the fixture; set here in a copy when it has none)
    const raw = JSON.parse(readFileSync(new URL('./fixtures/client-marble.spec.json', import.meta.url), 'utf8')) as KitchenSpec;
    const marble = healContract({ ...raw, detected: { ...raw.detected, elements: raw.detected.elements.map((e) => (e.kind === 'fridge' && !e.facing ? { ...e, facing: 'left' as const } : e)) } });
    ensureSpecMaterials(marble);
    const cleaned = cleanElements(marble);
    check(cleaned.find((e) => e.kind === 'fridge')?.facing === 'left', "marble: the fridge carries facing 'left' (its front turned to the left of the frame: it stands on the right wall)");
    const twin = kitchenElementBoxes(computeKitchenLayout(marble));
    const frame = readFrame(marble, cleaned);
    // (the fixture may carry cues on other elements too — a front turned right puts something on the left wall, which is then in the picture as well)
    const seen = facingWallsSeen(cleaned);
    check(marble.detected.frame === null && frame.rightWallVisible === true && frame.leftWallVisible === (seen.has('left') ? true : null), `marble: with no frame block the cues say which side walls are in the picture (right${seen.has('left') ? ' and left' : ''})`);
    const hyps = labelHypotheses(cleaned, twin);
    check(facingTurn(cleaned, twin) === -1 && hyps.length === 3 && hyps[1].turns === -1 && hyps[1].seeded && !hyps[2].seeded, `marble: the cue (right wall) against the twin's back-wall fridge seeds the anticlockwise turn first (${hyps.map((h) => `${h.turns}${h.seeded ? '*' : ''}`).join(', ')})`);
    const rf = fitToPhoto(marble, { aspect: 1.784 });
    const fridge = rf.matched.find((m) => m.kind === 'fridge');
    console.log(`    marble + facing: score ${rf.score?.toFixed(3)} (original ${rf.originalScore?.toFixed(3)}), coverage ${rf.coverage === null ? '–' : (rf.coverage * 100).toFixed(0)}%, fridge IoU ${fridge?.iou.toFixed(2)} on the twin's ${fridge?.wall} wall, ${rf.evaluations} evals, ${rf.ms} ms`);
    check(!!fridge && fridge.iou > 0.3, `marble + facing: the fridge is still matched (penalty, not exclusion — the twin draws none on the right wall; IoU ${fridge?.iou.toFixed(2)})`);
    check(rf.score !== null && rf.score >= 0.6 && rf.coverage !== null && rf.coverage >= 0.85, `marble + facing: score ${rf.score?.toFixed(3)} ≥ 0.6, coverage ≥ 85%`);
    check(RoomSpecZ.safeParse(rf.spec).success && rf.spec.detected.elements.find((e) => e.kind === 'fridge')?.facing === 'left', 'marble + facing: the cue survives into the fitted spec');
  }

  // --- 10. The fit route's result exposes residuals and hints at the top level (a fit with nothing to fit has empty ones)
  {
    const none = fitToPhoto(k0);
    check(Array.isArray(none.residuals) && none.residuals.length === 0 && Array.isArray(none.hints) && none.hints.length === 0, 'nothing to fit → residuals [] and hints [], never undefined');
  }

  // -------------------------------------------------------------------------
  console.log('\n8. Proportions — the metric, the loss and the box conventions');

  // --- 8.1 the metric itself
  {
    const P: Box4 = [0.2, 0.3, 0.6, 0.5];
    check(proportionError(P, P).err === 0, 'a twin box on the photo\'s has zero proportion error');
    // 5% bigger on both axes and shifted 5% of its own size on both
    const pw = 0.4, ph = 0.2;
    const tw = pw * 1.05, th = ph * 1.05;
    const cx = 0.4 + 0.05 * tw, cy = 0.4 + 0.05 * th;
    const bigger: Box4 = [cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2];
    const e1 = proportionError(P, bigger);
    check(Math.abs(e1.err - 0.05) <= 0.001, `5% bigger and 5% shifted reads as err ${e1.err.toFixed(4)} — the metric degrades to the plain fraction`);
    const twice: Box4 = [0.4 - pw, 0.4 - ph, 0.4 + pw, 0.4 + ph];
    check(Math.abs(proportionError(P, twice).eSize - Math.log(2)) < 1e-9, 'a 2× box costs ln 2 in size — and so does a ½× box');
    const halved: Box4 = [0.4 - pw / 4, 0.4 - ph / 4, 0.4 + pw / 4, 0.4 + ph / 4];
    check(Math.abs(proportionError(P, halved).eSize - proportionError(P, twice).eSize) < 1e-9, 'the size term is symmetric in scale: 2× and ½× cost the same');
    // a thin shelf board shifted by its own size on both axes
    const board: Box4 = [0.30, 0.40, 0.45, 0.44];
    const slid: Box4 = [0.45, 0.44, 0.60, 0.48];
    const e2 = proportionError(board, slid);
    check(Math.abs(e2.ePos - 1) < 1e-9 && e2.err <= 1, `a board slid by its own size reads ePos ${e2.ePos.toFixed(3)} and err ${e2.err.toFixed(3)} — clamped at 1`);
    const wild = proportionError(board, [0.0, 0.0, 0.99, 0.99]);
    check(wild.err === 1, 'a hopeless pair is clamped at 1 and cannot swamp the mean');
  }

  // --- 8.2 the metric a fit reports is the weighted mean of its pairs'
  {
    const base = defaultKitchen();
    const truth = settle(base);
    const cam = fromEstimate(truth, 4 / 3, { position: 'corner-right', lookingAt: 'back', fovDeg: 70, heightFt: 5 });
    const photo = inventory(truth, cam, kitchenElementBoxes(computeKitchenLayout(truth)));
    const off = structuredClone(truth);
    off.island.lengthFt = truth.island.lengthFt + 1;
    const r = fitToPhoto(withElements(off, photo), { aspect: 4 / 3, camera: { ...cam, yawDeg: cam.yawDeg + 5 } });
    let sw = 0, se = 0, plain = 0;
    for (const m of r.matched) { sw += m.weight; se += m.weight * m.err; plain += m.weight * ((1 - m.iou) + 0.5 * Math.hypot((m.photo[0] + m.photo[2] - m.twin[0] - m.twin[2]) / 2, (m.photo[1] + m.photo[3] - m.twin[1] - m.twin[3]) / 2)); }
    check(r.proportions !== null && Math.abs(r.proportions - (1 - se / sw)) < 1e-9, `FitResult.proportions is 1 − Σw·err / Σw over the matched pairs (${r.proportions?.toFixed(6)})`);
    check(r.residuals.length === r.matched.length && r.residuals.every((x, i) => x.err === r.matched[i].err), 'every residual carries the same err as its match');
    const derived = r.matched.map((m) => residualFromBoxes({ kind: m.kind, wall: m.wall, index: m.twinIndex, iou: m.iou, twin: m.twin, photo: m.photo }));
    const worstErr = Math.max(...derived.map((b, i) => Math.abs((b.err ?? 0) - r.residuals[i].err!)));
    check(worstErr < 1e-9, `api-client's residualFromBoxes computes the same err as the fitter (worst difference ${worstErr.toExponential(1)})`);
    // the LOSS carries 0.25 × err; every pair matched, so nothing else is in it
    const unpaired = r.unmatchedPhoto.filter((u) => u.reason !== 'kind not scored').length;
    if (unpaired === 0) {
      check(Math.abs((r.lossAfter! - plain / sw) - 0.25 * (se / sw)) < 1e-9, `the loss is (1 − IoU) + 0.5·centre + 0.25·err (λ recovered: ${((r.lossAfter! - plain / sw) / (se / sw)).toFixed(6)})`);
    } else {
      check(r.lossAfter !== null && r.lossAfter > plain / sw, `the loss carries more than (1 − IoU) + 0.5·centre (${unpaired} unpaired terms in it too)`);
    }
  }

  // --- 8.3 the PAIRING cost does not carry it: a pair whose only candidate is
  // far off is still paired, because the drop column is denominated in IoU +
  // centre distance alone (MAX_COST 1.5)
  {
    const k = defaultKitchen();
    const cam = fromEstimate(k, 4 / 3, { position: 'front', lookingAt: 'back', fovDeg: 70, heightFt: 5 });
    const els = kitchenElementBoxes(computeKitchenLayout(k));
    const pin = makeCamera(cam);
    const rangeEl = els.find((e) => e.kind === 'range')!;
    const rb = projectElement(pin, rangeEl)!;
    // the same size, slid 0.3 of the frame right and 0.2 down: IoU 0, centre distance 0.36
    const slid = { x0: rb[0] + 0.3, y0: rb[1] + 0.2, x1: rb[2] + 0.3, y1: rb[3] + 0.2 };
    const one: PhotoElement[] = [{ id: 'r1', kind: 'range', wall: 'back', box: slid, facing: null, label: 'range', confidence: 0.9 }];
    const r = fitToPhoto(withElements(k, one, cam), { aspect: 4 / 3, camera: cam, maxEvaluations: 200 });
    check(r.matched.some((m) => m.kind === 'range'), 'a hopeless-looking pair is still paired: the proportion term is in the loss, never in the pairing cost');
  }

  // --- 8.4 the box conventions, on the default kitchen
  {
    const k = defaultKitchen();
    const L = computeKitchenLayout(k);
    const els = kitchenElementBoxes(L);
    // a tall unit hides the wall behind it whatever its height
    const short = structuredClone(k);
    short.runs[0].hasUppers = false;
    short.runs[0].tall = [{ t: 0.5, widthIn: 30, kind: 'pantry', toCeiling: false }];
    const Ls = computeKitchenLayout(short);
    const pantry = Ls.runs[0].tall[0];
    const wallBack = kitchenElementBoxes(Ls).find((e) => e.kind === 'wall' && e.wall === 'back')!;
    check(pantry.top < Ls.h - 0.25 && !!wallBack.faces && wallBack.faces.length >= 2, `a ${(pantry.top / 0.3048).toFixed(1)} ft pantry a foot short of the ceiling still hides its stretch of wall (${wallBack.faces?.length ?? 0} visible stretches)`);
    // the island grows by the stools tucked under it, never by one standing clear of the end
    const islBoxOf = (sp: KitchenSpec) => {
      const Lx = computeKitchenLayout(sp);
      return { el: kitchenElementBoxes(Lx).find((e) => e.kind === 'island')!, isl: Lx.island! };
    };
    const flush = structuredClone(k);
    flush.island.seating = 4; flush.island.endSeats = 1; flush.island.endPlacement = 'right'; flush.island.endOverhangIn = 1.5;
    const a = islBoxOf(flush);
    check(a.el.box.max[0] <= a.isl.rect.maxX + 0.01, `a stool standing clear past a flush end is its own box, not part of the island's (${(a.el.box.max[0] - a.isl.rect.maxX).toFixed(3)} m past the rect)`);
    const tucked = structuredClone(flush);
    tucked.island.endOverhangIn = 12;
    const b2 = islBoxOf(tucked);
    check(b2.el.box.max[0] - b2.el.box.min[0] >= a.el.box.max[0] - a.el.box.min[0] - 1e-9, 'a 12 in end overhang tucks the end stool under the top, and the island box takes it in');
    // the side stools widen the outline from SEAT level, not from their legs
    const islEl = els.find((e) => e.kind === 'island')!;
    // faces[0] is the top slab and faces[1] the far floor line; the rest are the tucked stools
    const stoolFaces = (islEl.faces ?? []).slice(2);
    check(stoolFaces.length > 0 && stoolFaces.every((f) => Math.abs(f.min[1] - L.island!.seatY) < 1e-9), `the stool faces of the island's outline start at seat level (${L.island!.seatY.toFixed(3)} m), not below it`);
    // a shelf board's box is its thickness plus a hand above it
    const sh = L.decor.shelves[0];
    const board = els.find((e) => e.kind === 'shelf')!;
    check(Math.abs((board.box.max[1] - board.box.min[1]) - (sh.thickness + 0.16)) < 1e-9, `a shelf board's box is its thickness + 0.16 m (${(board.box.max[1] - board.box.min[1]).toFixed(3)} m) — the model boxes the board with the feet of what stands on it`);
    // a range's alt cooktop box is the top plus the control strip
    const rangeEl = els.find((e) => e.kind === 'range')!;
    check(!!rangeEl.alt && Math.abs((rangeEl.alt.box.max[1] - rangeEl.alt.box.min[1]) - (0.22 + inch(1))) < 1e-9, `a range's "cooktop" box is 0.22 m of front plus an inch of proud burner (${((rangeEl.alt!.box.max[1] - rangeEl.alt!.box.min[1])).toFixed(3)} m)`);
  }

  // --- 8.5 checkBoxes stays clean across every new degree of freedom
  {
    const variants: Array<[string, (sp: KitchenSpec) => void]> = [
      ['endPlacement both, 12 in overhang', (sp) => { sp.island.seating = 5; sp.island.endSeats = 4; sp.island.endPlacement = 'both'; sp.island.endOverhangIn = 12; }],
      ['endPlacement left, flush end', (sp) => { sp.island.seating = 3; sp.island.endSeats = 2; sp.island.endPlacement = 'left'; sp.island.endOverhangIn = 1.5; }],
      ['endPlacement right, stools pushed +24 in', (sp) => { sp.island.endPlacement = 'right'; sp.island.stoolOffsetIn = 24; }],
      ['stools pushed −24 in', (sp) => { sp.island.stoolOffsetIn = -24; }],
      ['a 6 in splash', (sp) => { sp.backsplash.heightIn = 6; }],
      ['a 48 in splash', (sp) => { sp.backsplash.heightIn = 48; }],
      ['a 96 in splash', (sp) => { sp.backsplash.heightIn = 96; }],
      ['pendants hung past the island end', (sp) => { sp.lighting.pendants!.positions = [{ alongFt: -6, acrossFt: 0 }, { alongFt: 6, acrossFt: 1 }]; sp.lighting.pendants!.count = 2; }],
      ['a pantry to the ceiling', (sp) => { sp.runs[0].tall[0].toCeiling = true; }],
      ['a cabinet on the hood', (sp) => { sp.appliances.find((a) => a.kind === 'hood')!.cabinetAbove = 'doors'; }],
      ['nothing on the hood', (sp) => { sp.appliances.find((a) => a.kind === 'hood')!.cabinetAbove = 'none'; }],
      ['a 3 in counter overhang', (sp) => { sp.countertop.overhangIn = 3; }],
    ];
    let bad = 0;
    for (const [label, mutate] of variants) {
      const sp = defaultKitchen();
      mutate(sp);
      try {
        const Lx = computeKitchenLayout(sp);
        const problems = checkBoxes(kitchenElementBoxes(Lx), Lx.w, Lx.d, Lx.h);
        if (problems.length) { bad++; fail(`checkBoxes on "${label}": ${problems.slice(0, 3).join('; ')}`); }
      } catch (err) { bad++; fail(`"${label}" threw: ${(err as Error).message}`); }
    }
    check(bad === 0, `every box stays inside the room across ${variants.length} variants of the new spec fields`);
  }

  // --- 8.6 the hood cabinet is searched only where nobody measured it
  {
    const withHood = (over: Partial<KitchenSpec['appliances'][number]>): KitchenSpec => {
      const sp = defaultKitchen();
      // the demo island declares an end seat the layout does not draw (see §7),
      // which honesty charges on its own — drop it so only the hood is under test
      sp.island.endSeats = 0;
      Object.assign(sp.appliances.find((a) => a.kind === 'hood')!, over);
      return sp;
    };
    const nulled = withHood({ cabinetAbove: null });
    const params = kitchenParams(nulled, nulled);
    const p = params.find((x) => /^appliances\[\d+\]\.cabinetAbove$/.test(x.label));
    check(!!p && p.dim.min === 0 && p.dim.max === 1 && integerScan(p), `a null cabinetAbove is a scan-only 0/1 the joint round can move (${p?.label})`);
    for (const word of ['doors', 'none'] as const) {
      const explicitSpec = withHood({ cabinetAbove: word });
      const ps = kitchenParams(explicitSpec, explicitSpec);
      check(!ps.some((x) => /cabinetAbove/.test(x.label)), `an explicit '${word}' is a measurement: no param for it`);
    }
    // and neither tidy nor restoreFitted turns the enum into a number
    const kept = withHood({ cabinetAbove: 'glass' });
    const tidied = tidy(structuredClone(kept)) as KitchenSpec;
    check(tidied.appliances.find((a) => a.kind === 'hood')!.cabinetAbove === 'glass', 'tidy leaves the cabinetAbove word alone');
    const restored = structuredClone(kept);
    restoreFitted(restored, nulled, kept, kitchenParams(kept, kept));
    check(restored.appliances.find((a) => a.kind === 'hood')!.cabinetAbove === 'glass', 'restoreFitted leaves it alone too');
    // a hood height the cabinet above it clamps is charged by honesty
    const clamped = withHood({ cabinetAbove: 'doors', heightIn: 60 });
    check(honesty(clamped, drawnFacts(computeKitchenLayout(clamped))) > 0.05, `a 60 in hood under a cabinet is charged (${honesty(clamped, drawnFacts(computeKitchenLayout(clamped))).toFixed(3)})`);
    const auto = withHood({ cabinetAbove: 'doors', heightIn: null });
    check(honesty(auto, drawnFacts(computeKitchenLayout(auto))) === 0, 'the same hood with no declared height is honest by definition');
  }

  // --- 8.7 counter items: drawn, boxed, and unable to steer the camera
  {
    const k = defaultKitchen();
    const L = computeKitchenLayout(k);
    const els = kitchenElementBoxes(L);
    const items = els.filter((e) => e.kind === 'item');
    check(items.length === (k.decor.items ?? []).length && items.length === 4, `the demo kitchen's ${items.length} items each get a box`);
    check(checkBoxes(els, L.w, L.d, L.h).length === 0, 'and every one is inside the room');
    const isl = L.island!;
    const onIsland = items.find((e) => e.wall === 'island');
    check(!!onIsland && onIsland.box.min[1] >= isl.carcassTop + isl.topT - 0.01 && onIsland.box.min[0] >= isl.rect.minX - 0.01 && onIsland.box.max[0] <= isl.rect.maxX + 0.01,
      'the island item stands on the island top, inside its footprint');
    const rangeTop = (() => { const a = L.appliances.find((x) => x.kind === 'range')!; return a.y + a.height; })();
    const onRange = items.find((e) => Math.abs(e.box.min[1] - rangeTop) < 0.05);
    check(!!onRange, `the range item stands on the burners (base ${onRange?.box.min[1].toFixed(3)} m, range top ${rangeTop.toFixed(3)} m)`);

    // items with badly drawn boxes must not move the camera
    const truth = settle(defaultKitchen());
    const cam = fromEstimate(truth, 4 / 3, { position: 'corner-right', lookingAt: 'back', fovDeg: 70, heightFt: 5 });
    const exact = inventory(truth, cam, kitchenElementBoxes(computeKitchenLayout(truth)));
    const shifted = exact.map((e) => (e.kind === 'item'
      ? { ...e, box: { x0: e.box.x0 + 0.1, y0: e.box.y0 + 0.1, x1: e.box.x1 + 0.1, y1: e.box.y1 + 0.1 } }
      : e));
    const nItems = shifted.filter((e) => e.kind === 'item').length;
    const rr = fitToPhoto(withElements(truth, shifted), { aspect: 4 / 3, camera: cam });
    const drift = Math.hypot(rr.camera.x - cam.x, rr.camera.y - cam.y, rr.camera.z - cam.z);
    check(nItems >= 3 && drift <= 0.35, `${nItems} items drawn 10% of the frame off leave the camera where it was (${drift.toFixed(3)} m) — items are worth a tenth of a stool`);

    // and an item the twin does not draw is reported in words a model can act on
    const bare = structuredClone(truth);
    bare.decor.items = [];
    const rb = fitToPhoto(withElements(bare, exact), { aspect: 4 / 3, camera: cam });
    const itemHints = rb.unmatchedPhoto.filter((u) => u.kind === 'item');
    check(itemHints.length > 0 && itemHints.every((u) => /the twin draws no item at all/.test(u.hint)), `a twin with no items reports each one: "${itemHints[0]?.hint ?? ''}"`);
  }

  // -------------------------------------------------------------------------
  // 9. Truncation — an open edge is a LOWER BOUND, not a size
  //    (brief-FIT §6; the client's "the island is js a square small island")
  // -------------------------------------------------------------------------
  console.log('\n9. truncation: a cut box is a lower bound');
  {
    const open = (o: Partial<BoxOpenEdges>): BoxOpenEdges => ({ ...NO_OPEN_EDGES, ...o });

    // --- 9.1 the repair is ONE-SIDED
    {
      const photo: Box4 = [0, 0.5, 0.4, 0.9];
      // the same box grown 30% on the LEFT — the side the photo says is cut
      const wider: Box4 = [-0.12, 0.5, 0.4, 0.9];
      const rep = repairOpen(photo, wider, open({ left: true }));
      check(rep[0] === wider[0] && rep[1] === photo[1] && rep[2] === photo[2] && rep[3] === photo[3],
        `an open left edge is pushed out to the twin's (${rep[0].toFixed(3)}), the other three untouched`);
      check(iou4(rep, wider) === 1 && proportionError(rep, wider).err === 0,
        'a twin 30% wider on a cut edge is a perfect pair: IoU 1.000, proportion error 0');
      // …and the SAME twin 30% narrower pays in full, exactly as it did before
      const narrower: Box4 = [0.12, 0.5, 0.4, 0.9];
      const repN = repairOpen(photo, narrower, open({ left: true }));
      check(repN[0] === photo[0] && repN[2] === photo[2],
        'a twin that stops SHORT of a cut edge is not repaired — the box is a lower bound, not a range');
      check(Math.abs(iou4(repN, narrower) - iou4(photo, narrower)) < 1e-12 && Math.abs(proportionError(repN, narrower).err - proportionError(photo, narrower).err) < 1e-12,
        `and scores exactly what it scored before the field existed (IoU ${iou4(photo, narrower).toFixed(4)}, propErr ${proportionError(photo, narrower).err.toFixed(4)})`);
      check(repairOpen(photo, wider, null) === photo && repairOpen(photo, wider, NO_OPEN_EDGES) === photo,
        'nothing open, nothing repaired (the same object back)');
    }

    // --- 9.2 an OCCLUDED edge does not license overhang past the frame
    {
      const k = settle(defaultKitchen());
      const cam = fromEstimate(k, 4 / 3, { position: 'front', lookingAt: 'back', fovDeg: 70, heightFt: 5 });
      const els = kitchenElementBoxes(computeKitchenLayout(k));
      const exact = inventory(k, cam, els);
      // an element the twin draws WELL INSIDE the frame — the case the term
      // exists for, where the twin stops short of an edge the photo says it
      // runs off. (The demo island already overhangs the frame, so it would
      // score 0 either way and prove nothing.)
      const pin0 = makeCamera(cam);
      const inside = els.find((e) => {
        const b = projectElementRaw(pin0, e);
        // wholly inside on every edge: a wall or a floor stretched to the
        // border would come back open on BOTH sides of an axis, which the
        // shell rule (§9.4) cancels — a different case, asserted there
        return !!b && e.kind !== 'other' && b[0] > 0.15 && b[2] < 0.9 && b[1] > 0.02 && b[3] < 0.98;
      });
      const target = inside ? exact.find((e) => e.kind === inside.kind && e.wall === inside.wall) : undefined;
      if (!inside || !target) fail('9.2 needs an element wholly inside the frame');
      else {
        // …and a photo box for it whose left edge is a cut. Twice: once cut by
        // the FRAME (the box runs to the border), once by something standing
        // in front (the box stops well inside it). The twin stops inside the
        // frame on the left in both.
        const rawX0 = projectElementRaw(pin0, inside)![0];
        const cut = (x0: number, cause: PhotoElement['openCause']) => exact.map((e) => (e.id === target.id
          ? { ...e, box: { ...e.box, x0 }, open: open({ left: true }), openCause: cause }
          : e));
        const same = (m: NonNullable<ReturnType<typeof measureAt>>) => m.matched.find((x) => x.kind === inside.kind && x.wall === inside.wall);
        const byFrame = measureAt(withElements(k, cut(0, 'frame')), cam);
        const byOcclusion = measureAt(withElements(k, cut(Math.min(0.9, rawX0 + 0.1), 'occluded')), cam);
        const frameOne = byFrame ? same(byFrame) : undefined;
        const occOne = byOcclusion ? same(byOcclusion) : undefined;
        check(!!occOne && occOne.offFrame === 0,
          `an occluded edge never charges the truncation term — nothing about the twin running off the picture (offFrame ${occOne?.offFrame.toFixed(3)}, ${inside.kind} whose twin stops at x0 ${rawX0.toFixed(3)})`);
        check(!!occOne && occOne.open !== null && occOne.photo[0] <= occOne.twin[0] + 1e-9,
          `but it IS repaired: the photo box is pushed out to the twin's (${occOne?.photo[0].toFixed(3)} ≤ ${occOne?.twin[0].toFixed(3)})`);
        check(!!frameOne && frameOne.offFrame > 0,
          `the same edge cut by the FRAME does charge it (offFrame ${frameOne?.offFrame.toFixed(3)})`);
        // and the union rule: an 'occluded' box that also touches the border
        // is 'both', and the frame half of it charges (resolveOpen's contract)
        const bothOne = (() => { const m = measureAt(withElements(k, cut(0, 'occluded')), cam); return m ? same(m) : undefined; })();
        check(!!bothOne && bothOne.offFrame > 0,
          `an 'occluded' box that also runs to the border is 'both', and its frame half charges (offFrame ${bothOne?.offFrame.toFixed(3)})`);
      }
    }

    // --- 9.3 the term has the right SIGN on the client's own photo:
    //     a room the photo proves is wider scores better
    {
      const tan = loadFixture('client-tan') as KitchenSpec;
      const cam = tan.detected.camera.solved;
      if (!cam) fail('9.3 needs client-tan\'s solved camera');
      else {
        const wide = structuredClone(tan);
        wide.dims.widthFt = 17;
        const at15 = measureAt(tan, cam)!;
        const at17 = measureAt(wide, cam)!;
        const wall15 = at15.matched.find((m) => m.kind === 'wall' && m.wall === 'back');
        const wall17 = at17.matched.find((m) => m.kind === 'wall' && m.wall === 'back');
        check(!!wall15 && wall15.offFrame > 0,
          `at the analyzer's 15.03 ft the back wall stops inside the frame edge the photo says it runs off (offFrame ${wall15?.offFrame.toFixed(3)})`);
        check(!!wall17 && wall17.offFrame < (wall15?.offFrame ?? 0),
          `at 17 ft it reaches further out (offFrame ${wall17?.offFrame.toFixed(3)})`);
        check(at17.gateScore! > at15.gateScore!,
          `and 17 ft scores strictly better than 15.03 with everything else held (${at17.gateScore!.toFixed(5)} vs ${at15.gateScore!.toFixed(5)})`);
      }
    }

    // --- 9.3b the residual carries ITS OWN pair's truncation
    //     The match report puts a "Cut off ←" chip on a row and tells the
    //     contractor the twin was allowed to run past that box. It used to find
    //     the element by kind and take the first open one, so on a fixture with
    //     several elements per kind a CLOSED pair wore an open sibling's chip.
    {
      const tan = loadFixture('client-tan') as KitchenSpec;
      const r = fitToPhoto(tan, { aspect: tan.detected.camera.solved?.aspect ?? 4 / 3 });
      const byId = new Map(tan.detected.elements.map((e) => [e.id, e]));
      const openMatches = r.matched.filter((m) => m.open && (m.open.left || m.open.right || m.open.top || m.open.bottom));
      const openResiduals = r.residuals.filter((x) => x.open && (x.open.left || x.open.right || x.open.top || x.open.bottom));
      check(r.residuals.length === r.matched.length && openResiduals.length === openMatches.length,
        `client-tan: ${openResiduals.length} of ${r.residuals.length} residuals carry an open edge, matching the ${openMatches.length} matched pairs that have one`);
      // and every one of them is the truncation of the element it was paired to
      const wrong = r.matched.filter((m, i) => JSON.stringify(r.residuals[i].open ?? null) !== JSON.stringify(m.open ?? null));
      check(wrong.length === 0, `every residual's open edges are its own pair's, not a sibling's (${wrong.length} mismatched)`);
      const causes = openResiduals.filter((x) => !x.openCause).length;
      check(causes === 0, `and each carries the cause the inventory gave it (${openResiduals.map((x) => x.openCause).filter((c, i, a) => a.indexOf(c) === i).join(', ')})`);
      void byId;
    }

    // --- 9.4 the shell-plane decision, written down and asserted
    //     (contract §9.4): a box open on BOTH sides of an axis is excluded on
    //     that axis. client-tan's floor is open left AND right and its ceiling
    //     open left AND right — charging those would be an unbounded
    //     room-widening gradient present in every interior photo ever taken.
    {
      const tan = loadFixture('client-tan') as KitchenSpec;
      const cam = tan.detected.camera.solved!;
      const m = measureAt(tan, cam)!;
      const floor = tan.detected.elements.find((e) => e.kind === 'floor');
      const ceiling = tan.detected.elements.find((e) => e.kind === 'ceiling');
      check(!!floor?.open?.left && !!floor?.open?.right, `client-tan's floor really is cut on both sides (${JSON.stringify(floor?.open)})`);
      check(!!ceiling?.open?.left && !!ceiling?.open?.right, `and its ceiling too (${JSON.stringify(ceiling?.open)})`);
      const shell = m.matched.filter((x) => x.kind === 'floor' || x.kind === 'ceiling');
      check(shell.length > 0 && shell.every((x) => x.offFrame === 0),
        `neither is charged (${shell.map((x) => `${x.kind} ${x.offFrame.toFixed(3)}`).join(', ')})`);
      const wall = m.matched.find((x) => x.kind === 'wall' && x.wall === 'back');
      check(!!wall && wall.offFrame > 0, 'while the back wall, cut on ONE side, still is — one-sided evidence is real');

      // --- 9.4b THE CENSUS, so nobody reads OFF_FRAME as the island mechanism.
      //     Over both fixtures with a solved camera the term charges EXACTLY
      //     the shell walls and nothing else: client-tan 45 pairs / 18 open /
      //     1 charged (wall back 0.639), client-marble-items 32 / 10 / 1
      //     (wall right 0.793). The ISLAND pair is charged 0.000 — not because
      //     the term is inert on it, but because the constraint is already
      //     SATISFIED: the twin's raw island box runs to x = -0.341, past the
      //     frame edge the photo says it runs off (asserted below in 9.8), and
      //     the term only charges a twin that stops INSIDE a cut edge. What
      //     recovers the island's off-frame length is the visible end plus the
      //     anchor — with `honesty` charging the body's slide so the length and
      //     the anchor are not degenerate — NOT this term. Assert the census so
      //     the claim cannot rot.
      const census = (name: string) => {
        const sp = loadFixture(name) as KitchenSpec;
        const c = sp.detected.camera.solved;
        if (!c) return null;
        const mm = measureAt(sp, c)!;
        const charged = mm.matched.filter((x) => x.offFrame > 0);
        return { pairs: mm.matched.length, open: mm.matched.filter((x) => x.open && (x.open.left || x.open.right || x.open.top || x.open.bottom)).length, charged, island: mm.matched.find((x) => x.kind === 'island') ?? null };
      };
      for (const name of ['client-tan', 'client-marble-items']) {
        const c = census(name);
        if (!c) { check(false, `${name}: no solved camera to run the OFF_FRAME census through`); continue; }
        const nonShell = c.charged.filter((x) => x.kind !== 'wall' && x.kind !== 'floor' && x.kind !== 'ceiling');
        check(nonShell.length === 0,
          `${name}: OFF_FRAME charges ${c.charged.length} of ${c.pairs} pairs (${c.open} open) — ${c.charged.map((x) => `${x.kind}/${x.wall ?? '-'} ${x.offFrame.toFixed(3)}`).join(', ') || 'none'}; all shell planes, no cabinetry or island`);
        if (c.island) {
          const cutSide = !!c.island.open && (c.island.open.left || c.island.open.right);
          check(c.island.offFrame === 0, `${name}: and the island pair is charged 0.000 — ${cutSide ? 'the twin already runs off the cut edge' : 'the photo cut neither end, so there is nothing to charge'} (IoU ${c.island.iou.toFixed(3)})`);
        }
      }
    }

    // --- 9.5 nothing regresses: the four client fixtures within 0.01 mean IoU
    //     of the same fit with truncation removed, and every fitted spec valid
    {
      const stripped = (spec: KitchenSpec): KitchenSpec => ({
        ...spec,
        // `resolveOpen` re-infers frame edges from the box, so the only way to
        // measure "no truncation" is to move the boxes a hair off the border
        detected: {
          ...spec.detected,
          elements: spec.detected.elements.map((e) => ({
            ...e,
            box: { x0: Math.max(0.005, e.box.x0), y0: Math.max(0.005, e.box.y0), x1: Math.min(0.995, e.box.x1), y1: Math.min(0.995, e.box.y1) },
            open: NO_OPEN_EDGES,
            openCause: null,
          })),
        },
      }) as KitchenSpec;
      for (const [name, aspect] of [['client-tan', null], ['client-marble', 1.784], ['client-marble-items', null], ['client-shelves', 1.499]] as Array<[string, number | null]>) {
        const spec = loadFixture(name) as KitchenSpec;
        const a = aspect ?? spec.detected.camera.solved?.aspect ?? 4 / 3;
        const on = fitToPhoto(spec, { aspect: a });
        const off = fitToPhoto(stripped(spec), { aspect: a });
        const cut = spec.detected.elements.filter((e) => e.open && (e.open.left || e.open.right || e.open.top || e.open.bottom)).length;
        check(RoomSpecZ.safeParse(on.spec).success, `${name}: the fitted spec still parses (${cut} of ${spec.detected.elements.length} boxes cut)`);
        check(on.score !== null && off.score !== null && on.score >= off.score - 0.01,
          `${name}: mean IoU ${on.score?.toFixed(4)} vs ${off.score?.toFixed(4)} with truncation removed (within 0.01)`);
      }
    }

    // --- 9.6 the fitter CONSUMES the open edges rather than re-deriving zero
    {
      const tan = loadFixture('client-tan') as KitchenSpec;
      const cleaned = cleanElements(tan);
      const cut = cleaned.filter((e) => e.open && (e.open.left || e.open.right || e.open.top || e.open.bottom));
      check(cut.length === 18, `cleanElements carries all 18 of client-tan's cut boxes through (${cut.length})`);
      check(cut.every((e) => e.openCause !== null), 'each with a cause');
      const island = cleaned.find((e) => e.kind === 'island');
      check(!!island?.open?.left && island?.openCause === 'frame', "including the client's island, open on the left by the frame");
    }

    // --- 9.7 healContract's inference is idempotent in VALUE, not only shape
    {
      const tan = loadFixture('client-tan') as KitchenSpec;
      const once = healContract(structuredClone(tan)) as KitchenSpec;
      const twice = healContract(structuredClone(once)) as KitchenSpec;
      const key = (s: KitchenSpec) => JSON.stringify(s.detected.elements.map((e) => [e.id, e.open, e.openCause]));
      check(key(once) === key(twice), 'healContract twice === once, value for value, over every element');
    }

    // --- 9.8 projectBoxRaw sees past the frame where projectBox cannot
    {
      const tan = loadFixture('client-tan') as KitchenSpec;
      const pin = makeCamera(tan.detected.camera.solved!);
      const els = kitchenElementBoxes(computeKitchenLayout(tan));
      const isl = els.find((e) => e.kind === 'island')!;
      const clamped = projectElement(pin, isl)!;
      const raw = projectElementRaw(pin, isl)!;
      check(clamped[0] === 0 && raw[0] < 0,
        `the twin's island clamps to x0 ${clamped[0].toFixed(3)} and really runs to ${raw[0].toFixed(3)} — the fact the clamp destroys`);
      const inFrame = els.find((e) => e.kind === 'range')!;
      const cb = projectElement(pin, inFrame)!, rb = projectElementRaw(pin, inFrame)!;
      check(cb.every((v, i) => Math.abs(v - rb[i]) < 1e-9), 'and an element wholly in frame projects identically either way');
    }
  }

  // -------------------------------------------------------------------------
  console.log('\n10. Partial adoption: a gated fit keeps the size the photo could not measure');
  {
    /**
     * The two specs the gated path chooses between (`fit.ts`: the original
     * tidied, or the reconciler's version of it when that draws no worse) —
     * rebuilt here so partial adoption can be judged against the spec it is
     * supposed to be a narrow edit OF, rather than against the raw input. The
     * inventory has to be attached before healing: the reconciler synthesises
     * decor items from `detected.elements`, and those items are exactly where
     * the first version of this code leaked.
     */
    const fallbacksOf = (input: KitchenSpec): KitchenSpec[] => {
      const heal = healContract(structuredClone(input)) as KitchenSpec;
      ensureSpecMaterials(heal);
      const plain = tidy(structuredClone(heal)) as KitchenSpec;
      const rec = healContract(reconcileSpec(structuredClone(plain), { photoCount: 1, fixes: [] })) as KitchenSpec;
      if (rec.island && Number.isFinite(plain.island.seating)) rec.island.seating = plain.island.seating;
      return [plain, rec];
    };
    /** every leaf of a spec EXCEPT the island's length and offset — what partial adoption is allowed to touch, and nothing else */
    const frozen = (k: KitchenSpec) => {
      const c = structuredClone(k) as Omit<KitchenSpec, 'detected'> & { detected?: unknown };
      delete c.detected;
      c.island = { ...c.island, lengthFt: 0, offset: { x: 0, z: 0 } };
      return JSON.stringify(c);
    };
    /** a kitchen whose island runs off the left of the frame, with the analyzer's stub in place of its real length */
    const cutCase = (o: { w?: number; d?: number; fovDeg: number; heightFt: number; truthLen?: number; widthFt?: number; offX?: number; stub: number }) => {
      const base = defaultKitchen();
      // the room and the island are the default kitchen's unless a case names
      // its own — `settle` clamps an island to the aisles it leaves, so a
      // length written here is a request, and `truth` is what came back
      if (o.w) base.dims.widthFt = o.w;
      if (o.d) base.dims.depthFt = o.d;
      base.runs[0].tall[0].t = 0.7; fridgeOf(base).t = 0.79;
      if (o.truthLen) base.island.lengthFt = o.truthLen;
      if (o.widthFt) base.island.widthFt = o.widthFt;
      if (o.offX !== undefined) base.island.offset.x = o.offX;
      const truth = settle(base);
      const cam = fromEstimate(truth, 4 / 3, { position: 'corner-right', lookingAt: 'back', fovDeg: o.fovDeg, heightFt: o.heightFt });
      const photo = inventory(truth, cam, kitchenElementBoxes(computeKitchenLayout(truth)));
      // shortened with the drawn end the camera CAN see held exactly where the
      // truth puts it: the analyzer measured the visible stub and guessed the rest
      const short = structuredClone(truth);
      short.island.lengthFt = o.stub;
      short.island.offset.x = truth.island.offset.x + (truth.island.lengthFt - o.stub) / 2;
      return { truth, cam, photo, input: withElements(short, photo) };
    };
    const islandEndM = (sp: KitchenSpec) => computeKitchenLayout(sp).island!.rect.maxX;

    // --- (a) the client's shape: the gate fires, and the island's length is
    // the one thing that survives it.
    {
      const c = cutCase({ fovDeg: 70, heightFt: 5, stub: 5 });
      const islandBox = cleanElements(c.input).find((e) => e.kind === 'island');
      check(!!islandBox?.open?.left && islandBox?.openCause === 'frame', `the island's box is cut by the left of the frame (${JSON.stringify(islandBox?.box)})`);
      const short = c.input as KitchenSpec;
      check(Math.abs(islandEndM(short) - islandEndM(c.truth)) < 1e-9, 'the short island draws its visible end in exactly the truth\'s place');

      const rp = fitToPhoto(c.input, { aspect: 4 / 3, camera: c.cam });
      const sp = rp.spec as KitchenSpec;
      console.log(`    gated + cut island: island ${short.island.lengthFt} → ${sp.island.lengthFt} ft (truth ${c.truth.island.lengthFt}), score ${rp.score?.toFixed(4)} vs original ${rp.originalScore?.toFixed(4)}, spec ${rp.spec_unchanged}`);
      for (const n of rp.notes) console.log(`      note: ${n}`);
      check(rp.notes.some((n) => n.includes('did not beat the original')), 'the aggregate really was gated (the discard note is there)');
      check(rp.spec_unchanged === 'partial', `and the result says so: spec_unchanged ${JSON.stringify(rp.spec_unchanged)}`);
      check(sp.island.lengthFt > short.island.lengthFt + 0.1, `the fitted island length survived the gate (${sp.island.lengthFt} ft, started at ${short.island.lengthFt})`);
      check(sp.island.lengthFt <= c.truth.island.lengthFt + 1e-9, `and never past the truth (${sp.island.lengthFt} ≤ ${c.truth.island.lengthFt})`);
      check(rp.notes.some((n) => n.includes('kept the fitted island.lengthFt')), 'and says WHY in a note the studio can show');
      // the safety property the gate is actually for: never further from the photo
      check(rp.score !== null && rp.originalScore !== null && rp.score >= rp.originalScore - 1e-9,
        `the partial spec draws no worse than the original (${rp.score?.toFixed(4)} ≥ ${rp.originalScore?.toFixed(4)})`);
      check(RoomSpecZ.safeParse(rp.spec).success, 'the partial spec is a valid RoomSpec');
      // NARROW: every other leaf — the room, the runs, the appliances, the
      // sink, the openings, the DECOR ITEMS and the island's SEATING — is
      // still whichever spec the gated path had already settled on.
      check(fallbacksOf(short).some((f) => frozen(f) === frozen(sp)), 'nothing outside the island\'s length and offset moved: every other leaf is the gated fallback\'s');
      // and the end the photo COULD see stayed where the photo put it: the
      // length grew off the cut edge, which is the whole point of pairing the
      // offset with it (`fit.ts adoptUnmeasured`, "why there are three candidates")
      check(Math.abs(islandEndM(sp) - islandEndM(short)) < ft(0.05),
        `the island grew off the CUT end — its visible end held at ${islandEndM(sp).toFixed(3)} m (was ${islandEndM(short).toFixed(3)})`);
      const rp2 = fitToPhoto(c.input, { aspect: 4 / 3, camera: c.cam });
      check(JSON.stringify(rp.spec) === JSON.stringify(rp2.spec), 'and the same input gives the same partial spec, every run');
    }

    // --- (b) the same narrowness, over rooms whose gated fallback lands on
    // EITHER branch — the plain tidied original, or the reconciler's version
    // of it. Building the candidate from the analyzer's spec and reconciling
    // it afresh, instead of writing onto the spec the fallback already chose,
    // let three decor items the analyzer never saw, un-rounded appliance and
    // sink positions and an extra island seat ride back in on the island edit.
    // Every one of those prices a line; none of them is a size the photo
    // could not measure.
    for (const o of [
      { w: 15, d: 12, fovDeg: 66, heightFt: 4.9, truthLen: 8, widthFt: 3.4, offX: -1.5, stub: 4.5 },
      { w: 14, d: 11, fovDeg: 70, heightFt: 4.9, truthLen: 8, widthFt: 3.4, offX: -1.3, stub: 5 },
      { w: 13, d: 11, fovDeg: 62, heightFt: 4.9, truthLen: 8, widthFt: 3.4, offX: -1.3, stub: 4 },
    ]) {
      const c = cutCase(o);
      const short = c.input as KitchenSpec;
      const rp = fitToPhoto(c.input, { aspect: 4 / 3, camera: c.cam });
      const sp = rp.spec as KitchenSpec;
      const [plain, rec] = fallbacksOf(short);
      const took = rp.notes.some((n) => n.includes('kept the original spec un-reconciled')) ? plain : rec;
      const branch = took === plain ? 'plain' : 'reconciled';
      const room = `${o.w}×${o.d} (${branch} fallback)`;
      console.log(`    ${room}: island ${short.island.lengthFt} → ${sp.island.lengthFt} ft (truth ${c.truth.island.lengthFt}), spec ${rp.spec_unchanged}, decor.items ${sp.decor.items.length}, seating ${sp.island.seating}`);
      check(rp.spec_unchanged === 'partial', `${room}: partial adoption fires (${JSON.stringify(rp.spec_unchanged)})`);
      check(sp.island.lengthFt > short.island.lengthFt + 1e-9, `${room}: the island grew (${short.island.lengthFt} → ${sp.island.lengthFt} ft, truth ${c.truth.island.lengthFt})`);
      check(frozen(sp) === frozen(took), `${room}: every leaf outside the island is the ${branch} fallback's, to the last decimal`);
      check(sp.decor.items.length === took.decor.items.length, `${room}: decor.items is the fallback's, not the reconciler's second opinion (${sp.decor.items.length})`);
      check(sp.island.seating === took.island.seating, `${room}: island.seating is the fallback's — it prices a line (${sp.island.seating} seats)`);
    }

    // --- (c) a cut axis is a LOWER bound, so partial adoption may only GROW.
    // Here the search's best island is SHORTER than the visible stub, by a
    // margin too small to redraw anything (the island stays cut on that edge
    // either way) — the one direction the photo positively contradicts, and
    // one that moves islandLF and islandTopSqft on a priced line.
    {
      const c = cutCase({ w: 13, d: 12, fovDeg: 66, heightFt: 4.9, truthLen: 8, widthFt: 3.4, offX: -1.3, stub: 4.5 });
      const short = c.input as KitchenSpec;
      const rp = fitToPhoto(c.input, { aspect: 4 / 3, camera: c.cam });
      const sp = rp.spec as KitchenSpec;
      console.log(`    shrink refused: island ${short.island.lengthFt} → ${sp.island.lengthFt} ft, spec ${rp.spec_unchanged}`);
      check(sp.island.lengthFt >= short.island.lengthFt - 1e-9, `the island is never shorter than the stub the photo shows (${sp.island.lengthFt} ≥ ${short.island.lengthFt})`);
      check(rp.spec_unchanged === 'gated', `and with only a shrink on offer nothing is adopted at all (${JSON.stringify(rp.spec_unchanged)})`);
      check(!rp.notes.some((n) => n.includes('kept the fitted island.lengthFt')), 'so no note claims the analyzer guessed');
      check(fallbacksOf(short).some((f) => frozen(f) === frozen(sp)), 'and the spec is the gated fallback, untouched');
    }

    // --- (d) the other half: with NO cut boxes there is nothing the photo
    // failed to measure, so a gated fit still discards everything. Same truth,
    // seen from far enough back that the island is wholly inside the frame.
    {
      const base = defaultKitchen();
      base.runs[0].tall[0].t = 0.7; fridgeOf(base).t = 0.79;
      const truth = settle(base);
      const wideCam: SolvedCamera = { x: 0, y: 1.6, z: 4.5, yawDeg: 0, pitchDeg: 6, fovDeg: 70, aspect: 4 / 3, score: 0 };
      const widePhoto = inventory(truth, wideCam, kitchenElementBoxes(computeKitchenLayout(truth)));
      const wideIsland = cleanElements(withElements(truth, widePhoto)).find((e) => e.kind === 'island');
      check(!wideIsland?.open?.left && !wideIsland?.open?.right, `from this camera the island is wholly in frame (${JSON.stringify(wideIsland?.box)})`);
      const rw = fitToPhoto(withElements(truth, widePhoto), { aspect: 4 / 3, camera: wideCam });
      const sw = rw.spec as KitchenSpec;
      console.log(`    gated, nothing cut: island ${sw.island.lengthFt} ft, score ${rw.score?.toFixed(4)}, spec ${rw.spec_unchanged}`);
      check(rw.spec_unchanged === 'gated', `a gated fit with no cut boxes discards everything (spec_unchanged ${JSON.stringify(rw.spec_unchanged)})`);
      check(!rw.notes.some((n) => n.includes('kept the fitted island.lengthFt')), 'and keeps nothing back — no partial-adoption note');
      check(Math.abs(sw.island.lengthFt - truth.island.lengthFt) < 1e-9, `the island comes back exactly as it went in (${sw.island.lengthFt} ft)`);
    }
  }

  // -------------------------------------------------------------------------
  // The near field and the far field have to agree about the lens. Stepping
  // back and lengthening the lens redraws a far wall almost exactly, so the
  // far field alone cannot say where the photographer stood — and by the time
  // a near element is 2x out of scale its IoU is nearly nothing at every
  // wrong scale alike, so it has stopped voting. `FitMatch.scale` is each
  // pair's implied lens in log size and `Scored.scale` their spread; the
  // perspective round chooses along that direction when it is free to.
  console.log('\n11. Perspective: one photograph, one lens');
  {
    const truth = settle(defaultKitchen());
    const els = kitchenElementBoxes(computeKitchenLayout(truth));
    const cam: SolvedCamera = { x: 0.6, y: 1.55, z: ft(truth.dims.depthFt) / 2 - 0.5, yawDeg: -4, pitchDeg: 6, fovDeg: 50, aspect: 4 / 3, score: 0 };
    const photo = inventory(truth, cam, els);
    const input = withElements(truth, photo);

    // (a) the truth is perfectly consistent — every pair implies the same lens
    {
      const m = measureAt(input, cam)!;
      const measured = m.matched.filter((x) => x.scale !== null);
      check(m.scale < 1e-9, `at the truth camera the perspective spread is zero (${m.scale.toExponential(1)})`);
      check(measured.length >= 8, `${measured.length} of ${m.matched.length} pairs are size measurements`);
      check(measured.every((x) => Math.abs(x.scale as number) < 1e-9), 'and every one of them implies the same lens');
      // …and every pair that is NOT a measurement is excluded for a REASON,
      // which is what to assert — not a list of kinds. `SCALE_KINDS` really is
      // a kind rule (a shell box is as tall as the picture; an item, a plant,
      // a faucet, a pendant, a backsplash are boxes whose height is not the
      // object's), so naming those kinds is fair. The OTHER rule is not:
      // `!open.top && !open.bottom`, because a box the frame cut top or
      // bottom is a lower bound rather than a height. `base-cabinet-run` and
      // `island` are measuring kinds on any other camera and land here only
      // because THIS one crops them at the bottom of the picture — an
      // allow-list of kinds would have to name them and would then be blind
      // to a genuine regression that stopped measuring a run in frame.
      const outlinesAnObject = (k: PhotoElementKind) =>
        !(k === 'wall' || k === 'floor' || k === 'ceiling' || k === 'item' || k === 'plant' || k === 'art' || k === 'rug' || k === 'faucet' || k === 'pendant' || k === 'backsplash');
      const notMeasured = m.matched.filter((x) => x.scale === null);
      const cutOpen = (x: (typeof notMeasured)[number]) => Boolean(x.open?.top || x.open?.bottom);
      const [byKind, byCut] = [notMeasured.filter((x) => !outlinesAnObject(x.kind)), notMeasured.filter((x) => outlinesAnObject(x.kind))];
      console.log(`    not measurements — box does not outline an object: ${[...new Set(byKind.map((x) => x.kind))].join(', ') || 'none'}; frame-cut top or bottom: ${byCut.map((x) => x.kind).join(', ') || 'none'}`);
      check(byKind.every((x) => !outlinesAnObject(x.kind)), `the pairs whose box does not outline an object are excluded by kind (${[...new Set(byKind.map((x) => x.kind))].join(', ') || 'none'})`);
      check(byCut.length > 0 && byCut.every(cutOpen),
        `and every OTHER unmeasured pair is one the frame cut top or bottom, so its height is a lower bound (${byCut.map((x) => `${x.kind} ${x.open?.top ? 'top' : ''}${x.open?.bottom ? 'bottom' : ''}`).join(', ')})`);
      // the converse, so the rule cannot be satisfied by measuring nothing:
      // nothing whole and in frame is sitting out
      check(measured.every((x) => outlinesAnObject(x.kind) && !cutOpen(x)), 'and everything that IS measured outlines an object and is whole top-to-bottom');
    }

    // (b) walking the ambiguity's own direction — back, with the lens
    //     lengthened to hold the wall the camera faces — raises the spread
    //     monotonically. This is the signal an IoU has to share the job with.
    {
      const DEGR = Math.PI / 180;
      const mate = (back: number): SolvedCamera => {
        const fz = -Math.cos(cam.yawDeg * DEGR), fx = Math.sin(cam.yawDeg * DEGR);
        const dist = Math.abs((-ft(truth.dims.depthFt) / 2 - cam.z) / fz);
        return { ...cam, x: cam.x - fx * back, z: cam.z - fz * back, fovDeg: (2 * Math.atan(Math.tan((cam.fovDeg * DEGR) / 2) * (dist / (dist + back)))) / DEGR };
      };
      const spreads = [0, 0.25, 0.5, 1].map((b) => measureAt(input, mate(b))!.scale);
      console.log(`    dolly-zoom mates: spread ${spreads.map((x) => x.toFixed(4)).join(' → ')}`);
      check(spreads.every((v, i) => i === 0 || v > spreads[i - 1] + 1e-6), 'stepping back with a longer lens raises the perspective spread every time');
    }

    // (c) …but it is BLIND to the gauge freedom of a single photograph: scale
    //     the room and the standoff together and the picture does not change,
    //     which is exactly what `scaleRoom` + `scaleCamera` do at 13 scales on
    //     every fit. Asserted on the projection itself, where it is exact.
    //
    //     IT IS EXACT ONLY BECAUSE THE NEAR GUARD IS A FRACTION, and that is
    //     worth spelling out because it was not. A box the camera stands
    //     INSIDE has no bounded silhouette at all: its projection wraps
    //     through infinity, so `makeCamera` resamples every box EDGE that
    //     crosses the lens plane at a near depth, and the huge number
    //     `projectBoxRaw` then returns stands in for that infinity rather
    //     than measuring anything. Placed at an ABSOLUTE depth (0.05 m, as it
    //     was) the stand-in does not scale with the room, and exactly those
    //     boxes moved under `s` — 18 frame widths for the floor at s = 1.37,
    //     on the shells that wrap the photographer in nearly every photo, and
    //     `rawKindsOf` asks for a wall's unclamped box whenever the frame cut
    //     it. Nothing downstream could SEE it (every edge that moved was off
    //     the picture on both sides, so the clamped box and `offFrameCost`'s
    //     hinges were identical either way) — but a projection with a length
    //     in it is not a similarity, and `SCALE_WEIGHT`'s variance is
    //     documented as invariant under this very search to the last bit.
    //     `NEAR_FRACTION` (camera.ts) makes the resample one per cent of the
    //     box's own reach from the lens, which scales with the scene. So the
    //     wrapping boxes are still separated below by the public test for
    //     them (a corner the camera cannot see is one `project` returns null
    //     for) and held to BOTH properties: the weak one that survived the
    //     absolute guard, and the exact equality that only a fraction buys.
    {
      const s = 1.37;
      const scaledCam: SolvedCamera = { ...cam, x: cam.x * s, y: cam.y * s, z: cam.z * s };
      const a = makeCamera(cam), b = makeCamera(scaledCam);
      const cornersOf = (bx: { min: [number, number, number]; max: [number, number, number] }): [number, number, number][] => {
        const out: [number, number, number][] = [];
        for (let i = 0; i < 8; i++) out.push([i & 1 ? bx.max[0] : bx.min[0], i & 2 ? bx.max[1] : bx.min[1], i & 4 ? bx.max[2] : bx.min[2]]);
        return out;
      };
      let worst = 0, bounded = 0, wrapping = 0, worstWrapping = 0, worstClamped = 0, allOffFrame = true, existTogether = true;
      for (const e of els) {
        const sb = { min: [e.box.min[0] * s, e.box.min[1] * s, e.box.min[2] * s] as [number, number, number], max: [e.box.max[0] * s, e.box.max[1] * s, e.box.max[2] * s] as [number, number, number] };
        const p = a.projectBoxRaw(e.box), q = b.projectBoxRaw(sb);
        // the clamped box is what the loss is built from — invariant either way
        const cp = a.projectBox(e.box), cq = b.projectBox(sb);
        // a box scales in and out of the frame together, raw and clamped alike
        if (!p !== !q || !cp !== !cq) existTogether = false;
        if (!p || !q) continue;
        if (cp && cq) for (let i = 0; i < 4; i++) worstClamped = Math.max(worstClamped, Math.abs(cp[i] - cq[i]));
        if (cornersOf(e.box).some((c) => a.project(c) === null)) {
          // the camera is inside this box: its silhouette is unbounded, and
          // every raw edge that moved has to have moved OUTSIDE the picture
          wrapping++;
          for (let i = 0; i < 4; i++) {
            worstWrapping = Math.max(worstWrapping, Math.abs(p[i] - q[i]));
            if (Math.abs(p[i] - q[i]) < 1e-12) continue;
            if (!(i < 2 ? p[i] < 0 && q[i] < 0 : p[i] > 1 && q[i] > 1)) allOffFrame = false;
          }
          continue;
        }
        bounded++;
        for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(p[i] - q[i]));
      }
      console.log(`    gauge: ${bounded} boxes wholly in front of the lens (worst ${worst.toExponential(1)}), ${wrapping} wrapping it (worst ${worstWrapping.toExponential(1)}); clamped worst ${worstClamped.toExponential(1)}`);
      check(bounded >= 20 && wrapping > 0, `${bounded} boxes project to a bounded silhouette and ${wrapping} wrap the lens plane`);
      check(existTogether, 'every box scales in and out of the frame together, raw and clamped alike');
      check(worst < 1e-12, `scaling the room and the camera together redraws every bounded box identically (worst ${worst.toExponential(1)}) — so the spread, which is a variance, cannot see the room's scale`);
      check(allOffFrame, 'and where a box wraps the lens, any edge that moved would be off the picture on both sides — the near resample is a stand-in for infinity, not a size');
      check(worstWrapping < 1e-12, `and in fact none of them moves at all (worst ${worstWrapping.toExponential(1)}): the resample sits at a fraction of the box's own reach, so it scales with the room instead of pinning a length to it`);
      check(worstClamped < 1e-12, `so the box the loss actually reads is identical for every element (worst ${worstClamped.toExponential(1)})`);
    }
  }

  // (e) THE CEILING A CORRECT TWIN CAN REACH — which is what `SCALE_TOL` is,
  //     and it has to be a measurement rather than a reading off four
  //     fixtures. Walk the ambiguity's own direction from the truth camera as
  //     far as it goes: the spread rises, peaks, and comes back to zero,
  //     because past a point every element is far away and they agree again.
  //     Then add annotation noise on top of the worst step. Whatever that sum
  //     is, the deadband has to stand above it — otherwise the perspective
  //     round can fire on a twin that is RIGHT and buy consistency by
  //     distorting it. Everything above it is an inventory no camera
  //     reproduces, which is what the round actually repairs.
  {
    const DEGR = Math.PI / 180;
    let worstWalk = 0, worstNoisy = 0;
    // a deterministic annotator: each edge off by up to 3.5% of its box's own
    // side, EXCEPT an edge the frame cut, which a real annotator draws to the
    // border (moving it turns a lower bound into a "whole" box, which is not
    // annotation noise but a different fact)
    let seed = 1;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const jitter = (els: PhotoElement[]): PhotoElement[] => els.map((p) => {
      const hw = p.box.x1 - p.box.x0, hh = p.box.y1 - p.box.y0;
      const cl = (v: number) => Math.min(1, Math.max(0, v));
      const mv = (v: number, span: number, atFrame: boolean) => (atFrame ? v : cl(v + (rnd() - 0.5) * 2 * 0.035 * span));
      return { ...p, box: {
        x0: mv(p.box.x0, hw, p.box.x0 <= 0.002), y0: mv(p.box.y0, hh, p.box.y0 <= 0.002),
        x1: mv(p.box.x1, hw, p.box.x1 >= 0.998), y1: mv(p.box.y1, hh, p.box.y1 >= 0.998),
      } };
    });
    for (const [len, fovDeg, heightFt] of [[7, 50, 5.2], [8, 62, 4.9], [6, 70, 5.5]] as const) {
      const k = defaultKitchen(); k.island.lengthFt = len;
      const t = settle(k);
      const c0 = fromEstimate(t, 4 / 3, { position: 'front', lookingAt: 'back', fovDeg, heightFt });
      const inv = inventory(t, c0, kitchenElementBoxes(computeKitchenLayout(t)));
      const inp = withElements(t, inv);
      const dist = Math.abs(-ft(t.dims.depthFt) / 2 - c0.z);
      const backAt = (back: number): SolvedCamera => ({ ...c0, z: c0.z + back, fovDeg: (2 * Math.atan(Math.tan((c0.fovDeg * DEGR) / 2) * (dist / (dist + back)))) / DEGR });
      const walk: number[] = [];
      let peak = { spread: 0, back: 0 };
      for (const back of [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256]) {
        const sp = measureAt(inp, backAt(back))!.scale;
        walk.push(sp);
        if (sp > peak.spread) peak = { spread: sp, back };
      }
      worstWalk = Math.max(worstWalk, peak.spread);
      for (let n = 0; n < 40; n++) worstNoisy = Math.max(worstNoisy, measureAt(withElements(t, jitter(inv)), backAt(peak.back))!.scale);
      console.log(`    ${t.dims.widthFt}×${t.dims.depthFt} ft, ${fovDeg}° lens: spread peaks at ${peak.spread.toFixed(4)} ${peak.back} m back, back to ${walk[walk.length - 1].toFixed(4)} at 256 m`);
      check(walk[0] < 1e-9, `at the truth camera it is zero (${walk[0].toExponential(1)})`);
      check(walk[walk.length - 1] < 1e-3, `and it returns to zero far away, so it is a peak and not a ramp (${walk[walk.length - 1].toFixed(4)} at 256 m)`);
    }
    console.log(`    ceiling on a CORRECT twin: ${worstWalk.toFixed(4)} over the whole ambiguity, ${worstNoisy.toFixed(4)} with ±3.5% annotation noise on top — deadband ${SCALE_TOL}`);
    check(worstWalk < 0.09, `no camera error can push a correct twin past ${worstWalk.toFixed(3)} of spread (whatever the fixtures read)`);
    check(worstNoisy < 0.12, `nor can a mis-drawn annotator on top of it: ${worstNoisy.toFixed(3)}`);
    check(SCALE_TOL > worstNoisy * 2, `so the deadband (${SCALE_TOL}) stands ${(SCALE_TOL / worstNoisy).toFixed(1)}× above everything a correct twin can produce — the round cannot fire on one, at any camera, which is what it is for`);
  }

  // (d) client-tan, the fixture the client complained about: the far field is
  //     right and the near field is not, and it is the inventory's ISLAND BOX
  //     that does it — the annotator drew it from a vase standing on the
  //     counter (frame 0.504, measured 0.605) down to the bottom of the
  //     picture (1.000, measured 0.95), against the contract at prompt.ts:158.
  //
  //     WHERE THE REPAIR RUNS, AND WHERE IT DOES NOT. `repairIslandTops`
  //     (reconcile.ts) gives back the part of that the boxes themselves prove,
  //     and it runs inside `reconcileSpec` — so the analyzer's output, the
  //     refine pass's output and the fit's own settle all carry the repaired
  //     box, and the pass that fits NEXT reads it. It is deliberately NOT
  //     applied inside `cleanElements`, where the fit reads its boxes: tried
  //     that way and measured, it moves client-marble's fitted ceiling from
  //     9.38 to 9.59 ft (past the ±0.5 gate above, which is what closes the
  //     `uppersToCeiling` trap) and takes client-shelves from 0.779 to 0.743
  //     with the room scaled ×1.05 and the island 11 → 10.4 ft, while
  //     client-marble gains 0.005 and client-tan 0.004. A wash bought with
  //     two regressions on gates that exist to catch exactly this, so the
  //     search keeps reading the annotator's boxes and the repair reaches it
  //     one pass later. What this block pins is that the repair is worth
  //     having when the fit does see it — and how much of the box's error it
  //     still cannot prove.
  {
    const tan = loadFixture('client-tan') as KitchenSpec;
    const aspect = tan.detected.camera.solved?.aspect ?? 4 / 3;
    const asIs = fitToPhoto(tan, { aspect });
    const spreadOf = (r: ReturnType<typeof fitToPhoto>) => measureAt(r.spec, r.camera)?.scale ?? NaN;
    const seen = cleanElements(tan).find((e) => e.kind === 'island')!;
    check(seen.box.y0 === 0.504, `the search reads the box the annotator drew (y0 ${seen.box.y0})`);

    // the same inventory as the reconciler leaves it — what analyze stores,
    // and therefore what the next pass fits against
    const rec = reconcileSpec(structuredClone(tan), { photoCount: 1, fixes: [] }) as KitchenSpec;
    const recBox = (rec.detected.elements as PhotoElement[]).find((e) => e.kind === 'island')!;
    check(recBox.box.y0 > seen.box.y0 + 0.02, `and reconcileSpec repairs it for the pass that comes after (${seen.box.y0} → ${recBox.box.y0})`);
    const next = fitToPhoto({ ...tan, detected: { ...tan.detected, elements: rec.detected.elements } } as KitchenSpec, { aspect });
    console.log(`    client-tan as the search reads it: fov ${asIs.camera.fovDeg.toFixed(2)}° z ${asIs.camera.z.toFixed(2)} score ${asIs.score?.toFixed(4)} prop ${asIs.proportions?.toFixed(4)} spread ${spreadOf(asIs).toFixed(3)}`);
    console.log(`    …reconciled, as the NEXT pass reads it: score ${next.score?.toFixed(4)} prop ${next.proportions?.toFixed(4)} spread ${spreadOf(next).toFixed(3)}`);
    check((next.score ?? 0) > (asIs.score ?? 0) && (next.proportions ?? 0) > (asIs.proportions ?? 0),
      `the repaired inventory fits BETTER, which is the whole claim (score ${asIs.score?.toFixed(4)} → ${next.score?.toFixed(4)}, proportions ${asIs.proportions?.toFixed(4)} → ${next.proportions?.toFixed(4)})`);

    // …and the REST of that box's error, which only the photo's pixels can
    // see: its floor line is boxed at 1.000 against a measured 0.95, because
    // the stools in front of it run off the bottom of the picture. No rule
    // over the boxes alone can prove that, so it is measured here rather than
    // repaired — and it is what still stands between this fit and the photo.
    const repaired = loadFixture('client-tan') as KitchenSpec;
    const box = (repaired.detected.elements as PhotoElement[]).find((e) => e.kind === 'island');
    if (!box) fail('11(d) needs client-tan\'s island box');
    else {
      box.box = { ...box.box, y0: 0.605, y1: 0.95 };
      if (box.open) box.open = { ...box.open, bottom: false };
    }
    const fixed = fitToPhoto(repaired, { aspect });
    console.log(`    …box measured on the pixels:  fov ${fixed.camera.fovDeg.toFixed(2)}° z ${fixed.camera.z.toFixed(2)} score ${fixed.score?.toFixed(4)} prop ${fixed.proportions?.toFixed(4)} spread ${spreadOf(fixed).toFixed(3)}`);
    check(fixed.camera.fovDeg < asIs.camera.fovDeg - 3, `measuring the whole box on the pixels lengthens the solved lens (${asIs.camera.fovDeg.toFixed(1)}° → ${fixed.camera.fovDeg.toFixed(1)}°)`);
    check(fixed.camera.z > asIs.camera.z + 0.15, `and stands the camera further back (z ${asIs.camera.z.toFixed(2)} → ${fixed.camera.z.toFixed(2)})`);
    check((fixed.score ?? 0) > (asIs.score ?? 0) && (fixed.proportions ?? 0) > (asIs.proportions ?? 0), `and it costs nothing: score ${asIs.score?.toFixed(4)} → ${fixed.score?.toFixed(4)}, proportions ${asIs.proportions?.toFixed(4)} → ${fixed.proportions?.toFixed(4)}`);
    check(spreadOf(fixed) < spreadOf(asIs) - 0.05, `and the near field stops disagreeing with the far field (spread ${spreadOf(asIs).toFixed(3)} → ${spreadOf(fixed).toFixed(3)})`);
    const again = fitToPhoto(repaired, { aspect });
    check(again.camera.fovDeg === fixed.camera.fovDeg && again.score === fixed.score, 'and the perspective round leaves the fit deterministic');
  }

  console.log('\n14. Human measurements constrain every optimizer path');
  {
    const truth = settle(defaultKitchen());
    const camera = fromEstimate(truth, 1.5);
    const elements = inventory(truth, camera, kitchenElementBoxes(computeKitchenLayout(truth)));
    const measured = applyMeasurements(withElements(truth, elements) as KitchenSpec,
      { widthFt: truth.dims.widthFt + 7 / 12, depthFt: truth.dims.depthFt + 1 / 12, ceilingFt: truth.dims.ceilingFt + 1 / 12 },
      '2026-09-09T12:00:00Z');
    measured.detected.primaryPhotoIndex = 2;
    const original = JSON.stringify(measured);
    const params = kitchenParams(measured, measured);
    check(!params.some((p) => p.label.startsWith('dims.')), 'confirmed dimension axes have no optimizer parameters');
    const scaled = scaleRoom(measured, 1.2);
    const tidied = tidy(structuredClone(measured));
    check(scaled.roomType === 'kitchen' && JSON.stringify(scaled.dims) === JSON.stringify(measured.dims), 'global room scale cannot move a confirmed width or depth');
    check(tidied.roomType === 'kitchen' && JSON.stringify(tidied.dims) === JSON.stringify(measured.dims), 'tidying preserves exact fractional-inch measurements');
    const fitted = fitToPhoto(measured, { aspect: 1.5, maxEvaluations: 1500 });
    check(fitted.spec.roomType === 'kitchen' && JSON.stringify(fitted.spec.dims) === JSON.stringify(measured.dims), 'camera/spec/joint fitting all preserve measured dimensions even when photo boxes disagree');
    check(fitted.spec.detected.primaryPhotoIndex === 2, 'photo fitting preserves a non-first primary image');
    check(JSON.stringify(measured) === original, 'a constrained solve leaves its input unchanged');
    check(fitted.notes.some((n) => n.includes('measured dimensions held fixed')), 'fit audit explains that confirmed measurements constrained the result');
    const partlyMeasured = applyMeasurements(truth, { widthFt: truth.dims.widthFt }, '2026-09-09T12:00:00Z');
    const partly = kitchenParams(partlyMeasured, partlyMeasured);
    check(!partly.some((p) => p.label === 'dims.widthFt') && partly.some((p) => p.label === 'dims.depthFt'), 'one measured axis leaves the unknown axis available to fit');
  }

  console.log(failures ? `\nFAILED (${failures})\n` : '\nALL FIT CHECKS PASSED\n');
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
