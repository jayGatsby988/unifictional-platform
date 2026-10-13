/**
 * MANHATTAN — headless verification for WALL RECOGNITION.
 *
 *   npx tsx scripts/check-walls.ts
 *
 * No network. The client's complaint: "the fridge is on the right, facing
 * inward, but it just puts it on the back wall" — and with it an L where the
 * kitchen is a U. The photo inventory now reads how each element FACES;
 * reconcile's walls pass (`applyInventoryWalls`) moves the spec's element onto
 * the wall the photo shows it on, at the shared corner, gives that wall a run
 * and re-derives the layout word. Checked here against the real client
 * fixture: the fridge lands on the right wall in a run that starts at the
 * back corner with its surround, the back wall no longer carries it, the
 * layout becomes u-shaped, an empty inventory changes nothing; a synthetic
 * left-wall case mirrors it (facing and the label-at-the-frame-edge fallback);
 * the reverse move (face-on, spec on a side wall); the cases that must NOT
 * move; the accuracy pass's add / remove run ops validate and cap; and the
 * refine prompt spells the disagreement out.
 */
import { readFileSync } from 'node:fs';
import { FrontSide, Group, Matrix3, Mesh, Raycaster, Vector3 } from 'three';
import { applyCorrections, buildRefinePrompt, residualFacts, summarizeCorrections, wallFacts, type ApplyResult, type ModelOutput } from '../src/lib/ai/refine';
import { applyInventoryWalls, inventoryWallConflicts, layoutForRuns, photoWallOf, reconcileSpec } from '../src/lib/ai/reconcile';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { RoomSpecZ } from '../src/lib/spec/schema';
import { computeKitchenLayout } from '../src/components/scene/kitchen/layout';
import { shellParts } from '../src/components/scene/kitchen/shell';
import { wallFrame } from '../src/components/scene/geometry';
import { utilMaterial } from '../src/components/scene/materials';
import type { CabinetRun, KitchenSpec, PhotoElement, RoomSpec, Wall } from '../src/lib/spec/types';

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const check = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));

const loadMarble = (): KitchenSpec => JSON.parse(readFileSync(new URL('./fixtures/client-marble.spec.json', import.meta.url), 'utf8')) as KitchenSpec;
const kitchen = (s: RoomSpec): KitchenSpec => { if (s.roomType !== 'kitchen') throw new Error('not a kitchen'); return s; };
const fridgeOf = (k: KitchenSpec) => k.appliances.find((a) => a.kind === 'fridge')!;
const runsOn = (k: KitchenSpec, wall: Wall) => k.runs.filter((r) => r.wall === wall);
const hasSurround = (r: CabinetRun) => r.tall.some((t) => t.kind === 'fridge-surround');
const moveNotes = (s: RoomSpec) => s.detected.notes.filter((n) => /^inventory: .* moved to the/.test(n));
const el = (kind: PhotoElement['kind'], box: [number, number, number, number], extra: Partial<PhotoElement> = {}): PhotoElement => ({
  id: extra.id ?? `${kind}-${Math.random().toString(36).slice(2, 6)}`,
  kind,
  wall: 'wall' in extra ? (extra.wall ?? null) : 'back',
  facing: 'facing' in extra ? (extra.facing ?? null) : null,
  box: extra.box ?? { x0: box[0], y0: box[1], x1: box[2], y1: box[3] },
  label: extra.label ?? kind,
  confidence: extra.confidence ?? 0.9,
});
const out = (corrections: unknown[]): ModelOutput => ({ corrections, notes: [], match: 0.7, finishes: [] });
const applied = (r: ApplyResult) => r.corrections.filter((c) => c.applied);

// ---------------------------------------------------------------------------
console.log('\n1. The client fixture: what the photo says, what the analyzer wrote');
const marble = loadMarble();
{
  const els = marble.detected.elements;
  const f = (id: string) => els.find((e) => e.id === id)?.facing;
  check(f('fridge-1') === 'left' && f('tall-cabinet-right-1') === 'left', 'the fridge and its surround face LEFT in the frame (they stand on the right wall)');
  check(['wall-back-1', 'range-1', 'hood-1', 'base-cabinet-run-back-1', 'upper-cabinet-run-back-1'].every((id) => f(id) === 'front'), 'back-wall elements are seen face-on');
  check(['base-cabinet-run-left-1', 'window-left-1', 'upper-cabinet-run-left-1'].every((id) => f(id) === 'right'), 'the left wall\'s run and window face right');
  const fridgeEl = els.find((e) => e.id === 'fridge-1')!;
  const read = photoWallOf(fridgeEl);
  check(read?.wall === 'right' && read.by === 'facing' && read.cue.includes('doors are seen turned into the room'), `photoWallOf: doors turned left → the right wall (${read?.cue})`);
  check(photoWallOf({ ...fridgeEl, facing: null })?.by === 'label' && photoWallOf({ ...fridgeEl, facing: null, confidence: 0.6 }) === null && photoWallOf({ ...fridgeEl, facing: null, box: { ...fridgeEl.box, x1: 0.8 } }) === null, 'without a facing: a sure label at the frame edge counts; a middling one, or a box off the edge, does not');
  check(photoWallOf({ ...fridgeEl, facing: 'edge' }) === null && photoWallOf({ ...fridgeEl, confidence: 0.3 }) === null, 'edge-on says nothing; a guessed element moves nothing');
  check(photoWallOf({ ...fridgeEl, facing: 'front' })?.wall === 'back' && photoWallOf({ ...fridgeEl, facing: 'right' })?.wall === 'left', 'face-on → the back wall; turned right → the left wall');
  check(photoWallOf({ ...fridgeEl, facing: 'left' }, 'left')?.wall === 'back', 'a camera looking along the left wall: doors turned left → the wall on its right, i.e. the back wall');
  check(fridgeOf(marble).wall === 'back' && fridgeOf(marble).t > 0.95 && marble.layout === 'l-shaped', `as analysed: the fridge sits at t ${fridgeOf(marble).t.toFixed(2)} of the BACK wall and the kitchen is ${marble.layout}`);
  const conflicts = inventoryWallConflicts(marble);
  check(conflicts.length === 1 && conflicts[0].kind === 'fridge' && conflicts[0].specWall === 'back' && conflicts[0].photoWall === 'right' && conflicts[0].corner, `one conflict: the fridge, back → right, at a corner (${conflicts.map((c) => `${c.what} ${c.specWall}→${c.photoWall}`).join(', ')})`);
  check(JSON.stringify(inventoryWallConflicts(marble)) === JSON.stringify(conflicts) && fridgeOf(marble).wall === 'back', 'inventoryWallConflicts is pure and repeatable');
}

// ---------------------------------------------------------------------------
console.log('\n2. reconcileSpec moves the fridge to the right wall and makes the U');
const fixes: string[] = [];
const moved = kitchen(reconcileSpec(marble, { photoCount: 1, fixes }));
{
  const parsed = RoomSpecZ.safeParse(moved);
  check(parsed.success, `reconciled spec validates${parsed.success ? '' : `: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`}`);
  const fr = fridgeOf(moved);
  check(fr.wall === 'right', `the fridge is on the ${fr.wall} wall`);
  const right = runsOn(moved, 'right');
  check(right.length === 1 && right[0].start === 0 && hasSurround(right[0]), `one run on the right wall, starting at the back corner (start ${right[0]?.start}), with a fridge-surround`);
  check(right[0]?.id === 'run-right' && right[0].tall[0].t === 0 && right[0].tall[0].widthIn === 42 && right[0].base.some((b) => b.type === 'appliance-gap' && b.widthIn === 36) && right[0].lengthFt === 3.5, 'run-right: 36in appliance gap + 42in surround (3in panels) at the corner, 3.5 ft long');
  check(Math.abs(fr.t - 21 / 12 / 14) < 0.005, `the fridge sits half its surround from the back corner (t ${fr.t.toFixed(3)})`);
  check(!runsOn(moved, 'back').some(hasSurround) && !moved.runs.some((r) => r.id === 'run-back-fridge'), 'the back wall carries no fridge surround; the run that only held the fridge is gone');
  check(runsOn(moved, 'back').every((r) => r.start + r.lengthFt / moved.dims.widthFt <= 0.85), 'the back run stops short of the right corner');
  check(moved.layout === 'u-shaped', `layout ${moved.layout} (left sink run + back range run + right fridge wall)`);
  check(moved.detected.notes.includes('inventory: fridge moved to the right wall: its doors are seen turned into the room, toward the left of the frame'), 'a note explains the move by how the fridge faces');
  check(moved.detected.notes.some((n) => /^inventory: layout l-shaped → u-shaped/.test(n)), 'a note records the layout change');
  check(fixes.some((f) => /^runs\.run-right: created at the back corner of the right wall/.test(f)) && fixes.some((f) => /^runs\.run-back-fridge: removed/.test(f)), 'the fixes list the created and the removed run');
  check(!moved.detected.notes.some((n) => n.startsWith('inventory: fridge labelled')), 'no wall disagreement is left for the fridge');
  check(moved.appliances.find((a) => a.kind === 'range')!.wall === 'back' && moved.appliances.find((a) => a.kind === 'hood')!.wall === 'back' && moved.sink.wall === 'left' && moved.appliances.find((a) => a.kind === 'dishwasher')!.wall === 'left', 'range, hood, sink and dishwasher stay where they were');
  check(moved.detected.elements.find((e) => e.id === 'fridge-1')?.wall === 'right' && moved.detected.elements.length === marble.detected.elements.length, 'the inventory is untouched');
  check(fridgeOf(marble).wall === 'back' && marble.runs.length === 3, 'the input spec is not mutated');
  const again = kitchen(reconcileSpec(moved, { photoCount: 1 }));
  check(again.runs.length === moved.runs.length && fridgeOf(again).wall === 'right' && again.layout === 'u-shaped' && moveNotes(again).length === moveNotes(moved).length, 'reconciling the result again moves nothing more');
  check(JSON.stringify(kitchen(reconcileSpec(loadMarble(), { photoCount: 1 }))) === JSON.stringify(kitchen(reconcileSpec(loadMarble(), { photoCount: 1 }))), 'deterministic');
}

// ---------------------------------------------------------------------------
console.log('\n3. Nothing moves without an inventory; a sure label at the frame edge is enough without a facing');
{
  const bare = loadMarble();
  bare.detected.elements = [];
  const bareOut = kitchen(reconcileSpec(bare, { photoCount: 1 }));
  check(fridgeOf(bareOut).wall === 'back' && bareOut.layout === 'l-shaped' && bareOut.runs.map((r) => r.id).join() === marble.runs.map((r) => r.id).join() && moveNotes(bareOut).length === 0, 'empty inventory → the fridge stays on the back wall, the runs and layout are as analysed');
  const direct = applyInventoryWalls(bare);
  check(direct.spec === bare && direct.moved.length === 0 && direct.notes.length === 0, 'applyInventoryWalls hands back the same object when there is nothing to do');
  check(inventoryWallConflicts(bare).length === 0, 'no conflicts without elements');

  // the pre-facing inventory: every facing null — the fridge's label 'right' at 0.98 confidence with its box at the frame edge still moves it
  const labelled = loadMarble();
  labelled.detected.elements = labelled.detected.elements.map((e) => ({ ...e, facing: null }));
  const byLabel = kitchen(reconcileSpec(labelled, { photoCount: 1 }));
  check(fridgeOf(byLabel).wall === 'right' && byLabel.layout === 'u-shaped', 'label-only inventory: the fridge still moves (sure label, box at the right edge of the frame)');
  check(byLabel.detected.notes.some((n) => n === 'inventory: fridge moved to the right wall: the photo labels it on the right wall, at the right edge of the frame'), 'and the note says it was the label');
  // …but not when the annotator was unsure of it
  const unsure = loadMarble();
  unsure.detected.elements = unsure.detected.elements.map((e) => (e.id === 'fridge-1' ? { ...e, facing: null, confidence: 0.7 } : { ...e, facing: null }));
  const stays = kitchen(reconcileSpec(unsure, { photoCount: 1 }));
  check(fridgeOf(stays).wall === 'back' && stays.layout === 'l-shaped' && moveNotes(stays).length === 0, 'a 0.70 label alone does not move it');
  check(stays.detected.notes.some((n) => n.startsWith('inventory: fridge labelled on the right wall')), 'the disagreement stays a note');
}

// ---------------------------------------------------------------------------
console.log('\n4. Synthetic LEFT-wall case: the fridge in the back-left corner, doors turned right');
/** the default kitchen with only its back run, the fridge (and its surround) at the LEFT end of it, and a given inventory */
function leftCase(elements: PhotoElement[], mutate: (k: KitchenSpec) => void = () => {}): KitchenSpec {
  const k = defaultKitchen();
  k.runs = k.runs.filter((r) => r.wall === 'back');
  k.layout = 'single-wall';
  k.runs[0].tall = [{ t: 0, widthIn: 36, kind: 'fridge-surround' }];
  fridgeOf(k).t = 0.09;
  k.detected.elements = elements;
  mutate(k);
  return k;
}
const leftEls = (fridge: Partial<PhotoElement>): PhotoElement[] => [
  el('fridge', [0.02, 0.15, 0.12, 0.85], { id: 'fridge-1', wall: 'left', facing: 'right', ...fridge }),
  el('base-cabinet-run', [0.15, 0.6, 0.95, 0.8], { id: 'base-back', facing: 'front' }),
  el('range', [0.6, 0.55, 0.7, 0.8], { id: 'range-1', facing: 'front' }),
  el('wall', [0.12, 0.05, 0.95, 0.8], { id: 'wall-back' }),
];
{
  const L = kitchen(reconcileSpec(leftCase(leftEls({})), { photoCount: 1 }));
  check(RoomSpecZ.safeParse(L).success, 'valid spec');
  check(fridgeOf(L).wall === 'left', `the fridge is on the ${fridgeOf(L).wall} wall`);
  const left = runsOn(L, 'left');
  check(left.length === 1 && left[0].id === 'run-left' && hasSurround(left[0]) && left[0].lengthFt === 3.5 && Math.abs(left[0].start - (1 - 3.5 / 14)) < 0.005, `run-left ends at the back corner: start ${left[0]?.start} of a 14 ft wall, 3.5 ft long, with the surround`);
  check(Math.abs(fridgeOf(L).t - (1 - 21 / 12 / 14)) < 0.005, `left wall: t runs 1 at the back, so the fridge sits at ${fridgeOf(L).t.toFixed(3)}`);
  const back = runsOn(L, 'back')[0];
  check(!hasSurround(back) && back.start >= 0.12 && back.lengthFt <= 14, `the back run lost its surround and was pulled back from the left corner (start ${back.start}, ${back.lengthFt} ft)`);
  check(L.layout === 'l-shaped' && L.detected.notes.some((n) => /^inventory: layout single-wall → l-shaped/.test(n)), 'single-wall → l-shaped');
  check(L.detected.notes.includes('inventory: fridge moved to the left wall: its doors are seen turned into the room, toward the right of the frame'), 'the note names the cue');

  // the label fallback and its limits
  check(fridgeOf(kitchen(reconcileSpec(leftCase(leftEls({ facing: null, confidence: 0.9 })), { photoCount: 1 }))).wall === 'left', 'no facing, sure label, box at the left edge → moves');
  check(fridgeOf(kitchen(reconcileSpec(leftCase(leftEls({ facing: null, confidence: 0.6 })), { photoCount: 1 }))).wall === 'back', 'no facing, 0.6 label → stays');
  check(fridgeOf(kitchen(reconcileSpec(leftCase(leftEls({ facing: null, box: { x0: 0.3, y0: 0.15, x1: 0.4, y1: 0.85 } })), { photoCount: 1 }))).wall === 'back', 'no facing, label but the box is not at the frame edge → stays');
  check(fridgeOf(kitchen(reconcileSpec(leftCase(leftEls({ facing: 'edge' })), { photoCount: 1 }))).wall === 'back', 'seen edge-on → stays');
  check(fridgeOf(kitchen(reconcileSpec(leftCase(leftEls({ confidence: 0.3 })), { photoCount: 1 }))).wall === 'back', 'a guessed box (0.3) → stays, whatever it faces');
  // not a corner: the spec's fridge in the middle of the back wall while the photo says left wall → a conflict, but no move
  const mid = leftCase(leftEls({}), (k) => { fridgeOf(k).t = 0.5; k.runs[0].tall = [{ t: 0.45, widthIn: 36, kind: 'fridge-surround' }]; });
  const midConflicts = inventoryWallConflicts(mid);
  const midOut = kitchen(reconcileSpec(mid, { photoCount: 1 }));
  check(midConflicts.length === 1 && !midConflicts[0].corner && fridgeOf(midOut).wall === 'back' && moveNotes(midOut).length === 0, 'mid-wall disagreement: reported, not acted on');
  check(midOut.detected.notes.some((n) => n.startsWith('inventory: fridge labelled on the left wall') && n.includes('front faces right')), 'and noted with the facing hint for the fitter');
  // the left wall already has a run that reaches the back corner: the fridge joins it at that end
  const hosted = leftCase(leftEls({}), (k) => { k.runs.push({ id: 'run-left', wall: 'left', start: 0.5, lengthFt: 7, base: [{ widthIn: 36, type: 'door', drawerCount: 1 }, { widthIn: 24, type: 'drawers', drawerCount: 3 }, { widthIn: 24, type: 'door', drawerCount: 1 }], uppers: null, tall: [], hasUppers: false, uppersToCeiling: false, backsplash: false, upperHeightIn: null }); });
  const H = kitchen(reconcileSpec(hosted, { photoCount: 1 }));
  const hostRun = runsOn(H, 'left');
  check(hostRun.length === 1 && hasSurround(hostRun[0]) && hostRun[0].base[hostRun[0].base.length - 1].type === 'appliance-gap' && Math.abs(hostRun[0].start + hostRun[0].lengthFt / 14 - 1) < 0.01, `an existing run reaching the corner takes the fridge at its back end (${hostRun[0]?.base.map((b) => b.type[0] + b.widthIn).join(' ')}, surround at t ${hostRun[0]?.tall[0]?.t.toFixed(2)})`);
  check(fridgeOf(H).wall === 'left' && Math.abs(fridgeOf(H).t - (1 - 21 / 12 / 14)) < 0.01, 'and the fridge sits at the corner of it');
  // the left wall has a run that stops short of the corner but blocks it: nothing moves, the note says why
  const blocked = leftCase(leftEls({}), (k) => { k.runs.push({ id: 'run-left', wall: 'left', start: 0.6, lengthFt: 4, base: [{ widthIn: 24, type: 'door', drawerCount: 1 }, { widthIn: 24, type: 'door', drawerCount: 1 }], uppers: null, tall: [], hasUppers: false, uppersToCeiling: false, backsplash: false, upperHeightIn: null }); });
  const B = kitchen(reconcileSpec(blocked, { photoCount: 1 }));
  check(fridgeOf(B).wall === 'back' && B.detected.notes.some((n) => /^inventory: fridge: the photo shows it on the left wall, but that wall's run leaves no room at the back corner/.test(n)), 'no room at the corner → left where it was, with a note');
}

// ---------------------------------------------------------------------------
console.log('\n5. The reverse mistake: a face-on fridge the spec put on a side wall');
{
  const rev = defaultKitchen();
  rev.runs[0].tall = [];
  rev.runs.push({ id: 'run-right', wall: 'right', start: 0, lengthFt: 3.5, base: [{ widthIn: 36, type: 'appliance-gap', drawerCount: 0 }], uppers: null, tall: [{ t: 0, widthIn: 42, kind: 'fridge-surround' }], hasUppers: false, uppersToCeiling: false, backsplash: false, upperHeightIn: null });
  fridgeOf(rev).wall = 'right';
  fridgeOf(rev).t = 0.125;
  rev.layout = 'u-shaped';
  rev.detected.elements = [
    el('fridge', [0.85, 0.15, 0.95, 0.85], { id: 'fridge-1', wall: 'back', facing: 'front' }),
    el('range', [0.55, 0.55, 0.65, 0.8], { id: 'range-1', facing: 'front' }),
    el('base-cabinet-run', [0.1, 0.6, 0.85, 0.8], { id: 'base-back', facing: 'front' }),
    el('wall', [0.05, 0.05, 0.95, 0.8], { id: 'wall-back' }),
  ];
  const R = kitchen(reconcileSpec(rev, { photoCount: 1 }));
  check(RoomSpecZ.safeParse(R).success, 'valid spec');
  check(fridgeOf(R).wall === 'back' && fridgeOf(R).t > 0.85, `a face-on fridge goes back to the back wall, at its right corner (t ${fridgeOf(R).t.toFixed(3)})`);
  check(runsOn(R, 'right').length === 0, 'the right-wall run that only held it is gone');
  const back = runsOn(R, 'back')[0];
  check(hasSurround(back) && back.tall[0].t > 0.7 && back.base[back.base.length - 1].type === 'appliance-gap', 'the back run, which reaches that corner, took the surround and the gap at its right end');
  check(R.layout === 'l-shaped' && R.detected.notes.includes('inventory: fridge moved to the back wall: it is seen face-on in the photo'), `u-shaped → ${R.layout}, with the note`);
}

// ---------------------------------------------------------------------------
console.log('\n5b. Same wall, wrong end: the live analyzer put the fridge on the right wall by the CAMERA (t 0.998)');
{
  // as the running server answered the client photo: run-right holds only the fridge, at the front end of the wall
  const flip = (fridgeBox: [number, number, number, number], frame: { backWallSpansX: [number, number]; leftWallVisible: boolean; rightWallVisible: boolean } | null, t = 0.998, runStart = 0.77): KitchenSpec => {
    const k = defaultKitchen();
    k.runs[0].tall = [];
    k.runs.push({ id: 'run-right', wall: 'right', start: runStart, lengthFt: 3.3, base: [{ widthIn: 39, type: 'open', drawerCount: 0 }], uppers: null, tall: [], hasUppers: false, uppersToCeiling: true, backsplash: false, upperHeightIn: null });
    fridgeOf(k).wall = 'right';
    fridgeOf(k).t = t;
    k.layout = 'u-shaped';
    (k.detected as { frame?: unknown }).frame = frame;
    k.detected.elements = [
      el('fridge', fridgeBox, { id: 'fridge-1', wall: 'right', facing: 'left', label: 'stainless built-in french-door fridge' }),
      el('range', [0.5, 0.57, 0.64, 0.71], { id: 'range-1', facing: 'front' }),
      el('base-cabinet-run', [0.3, 0.6, 0.85, 0.8], { id: 'base-back', facing: 'front' }),
      el('wall', [0.23, 0.05, 0.92, 0.8], { id: 'wall-back' }),
    ];
    return k;
  };
  const live = { backWallSpansX: [0.23, 0.92] as [number, number], leftWallVisible: true, rightWallVisible: true };
  const F = kitchen(reconcileSpec(flip([0.86, 0.23, 0.98, 0.88], live), { photoCount: 1 }));
  const fr = fridgeOf(F);
  const rr = runsOn(F, 'right')[0];
  check(fr.wall === 'right' && fr.t < 0.2 && rr.start === 0, `the fridge's box adjoins the back wall's span → it moves to the BACK end of the right wall (t ${fr.t.toFixed(3)}, run start ${rr.start})`);
  check(F.detected.notes.some((n) => /^inventory: fridge moved to the back end of the right wall: its box adjoins the back wall/.test(n)), 'with a note saying why');
  check(F.layout === 'u-shaped' && F.runs.length === 3 && RoomSpecZ.safeParse(F).success, 'nothing else changes; the spec validates');
  check(fridgeOf(kitchen(reconcileSpec(flip([0.96, 0.23, 1, 0.88], { ...live, backWallSpansX: [0.23, 0.85] }), { photoCount: 1 }))).t > 0.8, 'a box clear of the back wall\'s span (a unit by the camera) stays at the front end');
  check(fridgeOf(kitchen(reconcileSpec(flip([0.86, 0.23, 0.98, 0.88], null), { photoCount: 1 }))).t > 0.8, 'no frame block → no opinion, nothing moves');
  const already = kitchen(reconcileSpec(flip([0.86, 0.23, 0.98, 0.88], live, 0.12, 0), { photoCount: 1 }));
  check(fridgeOf(already).t < 0.2 && moveNotes(already).length === 0, 'already at the back end (run and fridge) → untouched, no note');
  // the third live answer: the run is the fridge plus a 12in filler (36d 12d, 4 ft) — still the unit's own run, still turned round
  const filler = flip([0.91, 0.21, 0.99, 0.87], { ...live, backWallSpansX: [0.24, 0.89] }, 0.973);
  filler.runs[2] = { ...filler.runs[2], lengthFt: 4, start: 0.714, base: [{ widthIn: 36, type: 'door', drawerCount: 1 }, { widthIn: 12, type: 'door', drawerCount: 1 }], tall: [{ t: 0, widthIn: 42, kind: 'fridge-surround' }] };
  const Fl = kitchen(reconcileSpec(filler, { photoCount: 1 }));
  check(fridgeOf(Fl).t < 0.2 && runsOn(Fl, 'right')[0].start === 0 && RoomSpecZ.safeParse(Fl).success, `a fridge + filler run (36d 12d) is turned round too (t ${fridgeOf(Fl).t.toFixed(3)}, run start ${runsOn(Fl, 'right')[0].start})`);
  // the fourth live answer, to the digit: back wall to x 0.87, the fridge body from x 0.903 (its surround panel and the perspective
  // put it a little past the wall's edge), run-right 3.3 ft of one 36d cabinet from 0.78, fridge at t 0.998
  const fourth = flip([0.903, 0.25, 0.99, 0.94], { ...live, backWallSpansX: [0.21, 0.87] }, 0.998, 0.78);
  fourth.runs[2] = { ...fourth.runs[2], base: [{ widthIn: 36, type: 'door', drawerCount: 1 }], tall: [{ t: 0, widthIn: 42, kind: 'fridge-surround' }] };
  fourth.detected.elements[0] = { ...fourth.detected.elements[0], facing: null };
  const F4 = kitchen(reconcileSpec(fourth, { photoCount: 1 }));
  check(fridgeOf(F4).t < 0.2 && runsOn(F4, 'right')[0].start === 0 && moveNotes(F4).length === 1, `the live answer's fridge (3% past the wall's edge, label only) is turned round (t ${fridgeOf(F4).t.toFixed(3)})`);
  // …but a long run along the wall is left to the fitter
  const long = flip([0.91, 0.21, 0.99, 0.87], { ...live, backWallSpansX: [0.24, 0.89] }, 0.9);
  long.runs[2] = { ...long.runs[2], lengthFt: 10.5, start: 0.25, base: [{ widthIn: 36, type: 'door', drawerCount: 1 }, { widthIn: 24, type: 'drawers', drawerCount: 3 }, { widthIn: 30, type: 'door', drawerCount: 1 }, { widthIn: 36, type: 'appliance-gap', drawerCount: 0 }] };
  const Lg = kitchen(reconcileSpec(long, { photoCount: 1 }));
  check(fridgeOf(Lg).t > 0.5 && moveNotes(Lg).length === 0, 'along a long run the unit stays where the analyzer put it (the fitter decides)');
}

// ---------------------------------------------------------------------------
console.log('\n6. layoutForRuns');
{
  const w = (...walls: Wall[]) => walls.map((wall) => ({ wall }));
  check(layoutForRuns(w('back')) === 'single-wall' && layoutForRuns(w('back', 'back')) === 'single-wall', '1 wall → single-wall (two runs on one wall are still one wall)');
  check(layoutForRuns(w('back', 'front')) === 'galley' && layoutForRuns(w('left', 'right')) === 'galley', '2 opposite → galley');
  check(layoutForRuns(w('back', 'left')) === 'l-shaped' && layoutForRuns(w('right', 'front')) === 'l-shaped', '2 adjacent → l-shaped');
  check(layoutForRuns(w('back', 'left', 'right')) === 'u-shaped' && layoutForRuns(w('back', 'left', 'right', 'front')) === 'u-shaped', '3+ → u-shaped');
  // the fifth live answer: runs on three walls, fridge already at the back corner of the right wall — and the word "l-shaped"
  const three = defaultKitchen();
  three.runs[0].tall = [];
  three.runs.push({ id: 'run-right', wall: 'right', start: 0.02, lengthFt: 3.3, base: [{ widthIn: 36, type: 'door', drawerCount: 1 }], uppers: null, tall: [{ t: 0, widthIn: 42, kind: 'fridge-surround' }], hasUppers: false, uppersToCeiling: true, backsplash: false, upperHeightIn: null });
  fridgeOf(three).wall = 'right';
  fridgeOf(three).t = 0.254;
  three.layout = 'l-shaped';
  const fixes3: string[] = [];
  const T = kitchen(reconcileSpec(three, { photoCount: 1, fixes: fixes3 }));
  check(T.layout === 'u-shaped' && fixes3.some((f) => /^layout: l-shaped → u-shaped \(cabinets on the back, left, right walls\)/.test(f)), `runs on three walls make the word u-shaped even with nothing to move, and say so (${fixes3.find((f) => f.startsWith('layout:'))})`);
  const pen = defaultKitchen();
  pen.layout = 'peninsula';
  check(kitchen(reconcileSpec(pen, { photoCount: 1 })).layout === 'peninsula', 'a peninsula keeps its word (walls cannot decide it)');
  check(kitchen(reconcileSpec(defaultKitchen(), { photoCount: 1 })).layout === 'l-shaped', 'the default kitchen (back + left) stays l-shaped');
}

// ---------------------------------------------------------------------------
console.log('\n7. Accuracy pass: runs can be added and removed, validated and capped');
{
  const k = defaultKitchen(); // runs on back + left
  const run = (wall: Wall, extra: Partial<CabinetRun> = {}): CabinetRun => ({ id: '', wall, start: 0, lengthFt: 4, base: [{ widthIn: 36, type: 'appliance-gap', drawerCount: 0 }], uppers: null, tall: [{ t: 0, widthIn: 42, kind: 'fridge-surround', toCeiling: null }], hasUppers: false, uppersToCeiling: false, backsplash: false, upperHeightIn: null, ...extra });
  const add = (value_element: unknown, confidence = 0.9) => ({ op: 'add', field: 'runs', index: null, value_element, reason: 'the fridge wall', confidence });
  const rm = (index: number | null) => ({ op: 'remove', field: 'runs', index, reason: '', confidence: 0.9 });
  const r1 = applyCorrections(k, out([add(run('right'))]));
  const s1 = r1.spec as KitchenSpec;
  check(applied(r1).length === 1 && s1.runs.length === 3 && s1.runs[2].wall === 'right' && s1.runs[2].id === 'run-right' && hasSurround(s1.runs[2]), 'a run on a free wall is added, with a generated id');
  check(RoomSpecZ.safeParse(r1.spec).success && k.runs.length === 2, 'valid, input untouched');
  check(summarizeCorrections(r1.corrections)[0] === 'added cabinet run: 4 ft run on right wall with fridge surround', `summary: "${summarizeCorrections(r1.corrections)[0]}"`);
  const named = applyCorrections(k, out([add(run('right', { id: 'run-fridge' }))]));
  check((named.spec as KitchenSpec).runs[2]?.id === 'run-fridge', 'the model\'s own id is kept when it is new');
  const r2 = applyCorrections(k, out([add(run('back'))]));
  check(applied(r2).length === 0 && /a run already sits on the back wall/.test(r2.corrections[0].rejected ?? ''), 'a second run on an occupied wall is refused');
  const r3 = applyCorrections(k, out([add({ wall: 'right' })]));
  check(applied(r3).length === 0 && /not a valid runs entry/.test(r3.corrections[0].rejected ?? ''), 'an incomplete run is rejected by CabinetRunZ');
  const r4 = applyCorrections(k, out([add(run('right', { lengthFt: 99 }))]));
  check(applied(r4).length === 0 && /not a valid runs entry/.test(r4.corrections[0].rejected ?? ''), 'a run longer than CabinetRunZ allows is rejected');
  const r5 = applyCorrections(k, out([add(run('right'), 0.3)]));
  check(/confidence 0.30 below/.test(r5.corrections[0].rejected ?? ''), 'a low-confidence add is refused');
  const r6 = applyCorrections(k, out([add(run('right')), add(run('front')), add(run('right'))]));
  check(applied(r6).length === 2 && (r6.spec as KitchenSpec).runs.length === 4 && /full \(max 4\)/.test(r6.corrections[2].rejected ?? ''), 'runs cap at 4 (all four walls)');
  const r7 = applyCorrections(k, out([rm(1)]));
  check(applied(r7).length === 1 && (r7.spec as KitchenSpec).runs.length === 1 && (r7.spec as KitchenSpec).runs[0].wall === 'back', 'a run can be removed');
  check(summarizeCorrections(r7.corrections)[0] === 'removed cabinet run 2', `summary: "${summarizeCorrections(r7.corrections)[0]}"`);
  const single = { ...k, runs: [k.runs[0]] } as KitchenSpec;
  const r8 = applyCorrections(single, out([rm(0)]));
  check(applied(r8).length === 0 && /the last cabinet run cannot be removed/.test(r8.corrections[0].rejected ?? ''), 'the last run cannot be removed');
  const r9 = applyCorrections(k, out([rm(5), rm(null)]));
  check(applied(r9).length === 0 && /no runs element at index 5/.test(r9.corrections[0].rejected ?? '') && /at index null/.test(r9.corrections[1].rejected ?? ''), 'a missing index is refused');
  // the whole client move, as the model would emit it: add the right run, move the fridge, shorten the back fridge run
  const m = loadMarble();
  m.detected.elements = [];
  const fridgeIdx = m.appliances.findIndex((a) => a.kind === 'fridge');
  const rMove = applyCorrections(m, out([
    add(run('right', { lengthFt: 3.5 })),
    { op: 'set', field: 'appliances[].wall', index: fridgeIdx, value_number: null, value_string: 'right', value_boolean: null, value_element: null, reason: 'its doors face into the room', confidence: 0.9 },
    { op: 'set', field: 'appliances[].t', index: fridgeIdx, value_number: 0.125, value_string: null, value_boolean: null, value_element: null, reason: '', confidence: 0.9 },
    rm(m.runs.findIndex((r) => r.id === 'run-back-fridge')),
    { op: 'set', field: 'layout', index: null, value_number: null, value_string: 'u-shaped', value_boolean: null, value_element: null, reason: '', confidence: 0.9 },
  ]));
  const sMove = rMove.spec as KitchenSpec;
  check(applied(rMove).length === 5 && fridgeOf(sMove).wall === 'right' && Math.abs(fridgeOf(sMove).t - 0.125) < 0.01 && sMove.layout === 'u-shaped' && !sMove.runs.some((r) => r.id === 'run-back-fridge'), `the model can express the whole move by hand (${applied(rMove).length} of 5 applied; ${rMove.corrections.filter((c) => !c.applied).map((c) => `${c.field}: ${c.rejected}`).join('; ') || 'none rejected'})`);
}

// ---------------------------------------------------------------------------
console.log('\n8. The refine prompt spells the wall disagreement out');
{
  const lines = wallFacts(marble);
  check(lines.length === 2 && lines[0].startsWith("  - fridge: the photo's fridge faces INTO the room from the RIGHT wall (its doors are seen turned into the room, toward the left of the frame); the twin has it on the back wall at its right corner — move it to the right wall (appliances[0].wall = \"right\", appliances[0].t ≈ 0.13) and give that wall a run (op \"add\" on runs: an appliance-gap of the fridge width with a fridge-surround tall unit, 3.5 ft long, starting at the back corner), then shorten the back run"), `wallFacts: ${lines[0].trim().slice(0, 160)}…`);
  check(/1 wall = single-wall, 2 opposite walls = galley, 2 adjacent = l-shaped, 3 = u-shaped/.test(lines[1]), 'and lists the layout rule');
  const facts = residualFacts(marble, [], []);
  check(facts.some((l) => l.startsWith('  Walls the photo disagrees on')) && facts.some((l) => l.includes("the photo's fridge faces INTO the room")), 'residualFacts carries the block');
  const prompt = buildRefinePrompt(marble, ['geometry'], null);
  check(prompt.includes("the photo's fridge faces INTO the room from the RIGHT wall") && prompt.includes('give that wall a run'), 'the geometry prompt without measured gaps carries it too');
  check(prompt.includes('  runs — a cabinet run on a wall that has none yet') && prompt.includes('An appliance whose doors are seen turned into the room stands on a SIDE wall'), 'runs are an addable array and the rule is stated');
  const measured = buildRefinePrompt(marble, ['geometry'], { residuals: [], hints: [], score: 0.5 });
  check(measured.split("the photo's fridge faces INTO").length === 2, 'with measured gaps the block appears exactly once');
  check(wallFacts(moved).length === 0 && !buildRefinePrompt(moved, ['geometry'], null).includes('faces INTO the room'), 'no block once the spec agrees with the photo');
  check(!buildRefinePrompt(marble, ['finishes'], null).includes('faces INTO the room'), 'a finishes-only pass carries none of it');
  const face = { ...marble, detected: { ...marble.detected, elements: marble.detected.elements.map((e) => (e.id === 'fridge-1' ? { ...e, wall: 'back' as const, facing: 'front' as const } : e)) } } as KitchenSpec;
  fridgeOf(face).wall = 'back';
  check(wallFacts(face).length === 0, 'a face-on fridge on the back wall is no conflict');
}

// ---------------------------------------------------------------------------
console.log('\nPassage backdrops remain open to outside cameras on every wall');
{
  const k = defaultKitchen();
  k.openings = (['back', 'left', 'right', 'front'] as const).map((wall) => ({
    id: `passage-${wall}`, kind: 'passage' as const, wall, style: 'standard' as const,
    t: 0.4, widthFt: 3, heightFt: 7, sillFt: 0,
  }));
  const L = computeKitchenLayout(k);
  const parts = shellParts(L);
  const material = utilMaterial('sky-grey');
  check(material.side === FrontSide, 'actual passage material is one-sided');
  check(L.openings.length === 4 && L.openings.every((o) => o.kind === 'passage'), 'all passage observations remain in the layout');
  for (const opening of L.openings) {
    const p = parts.find((part) => part.key === `${opening.id}-beyond`)!;
    check(!!p && p.frame === opening.wall && p.util === 'sky-grey', `${opening.wall}: passage retains its backdrop finish and wall frame`);
    const frame = wallFrame(opening.wall, L.w, L.d);
    const group = new Group();
    group.position.copy(frame.origin).addScaledVector(frame.along, frame.length / 2);
    group.rotation.y = frame.yaw;
    const mesh = new Mesh(p.geometry, material);
    mesh.position.fromArray(p.position ?? [0, 0, 0]);
    group.add(mesh);
    group.updateMatrixWorld(true);
    const centre = mesh.getWorldPosition(new Vector3());
    const normal = new Vector3().fromBufferAttribute(p.geometry.getAttribute('normal'), 0)
      .applyNormalMatrix(new Matrix3().getNormalMatrix(mesh.matrixWorld));
    check(normal.dot(frame.normal) > 0.999999, `${opening.wall}: transformed backdrop faces into the room`);
    const inside = new Raycaster(centre.clone().addScaledVector(frame.normal, 1), frame.normal.clone().negate());
    const outside = new Raycaster(centre.clone().addScaledVector(frame.normal, -1), frame.normal.clone());
    check(inside.intersectObject(mesh).length > 0, `${opening.wall}: an inside camera sees the adjoining-space color`);
    check(outside.intersectObject(mesh).length === 0, `${opening.wall}: an outside camera sees through the passage backdrop`);
    const wallPart = parts.find((part) => part.key === `wall-${opening.wall}`)!;
    const wall = new Mesh(wallPart.geometry, material);
    group.add(wall);
    group.updateMatrixWorld(true);
    check(inside.intersectObject(wall).length === 0, `${opening.wall}: actual wall opening remains clear`);
    check(p.castShadow === false && p.receiveShadow === false, `${opening.wall}: backdrop cannot create an artificial blocking shadow`);
  }
  new Set(parts.map((p) => p.geometry)).forEach((geometry) => geometry.dispose());
}

console.log(failures ? `\n${failures} wall check(s) FAILED` : '\nAll wall checks passed');
process.exit(failures ? 1 : 0);
