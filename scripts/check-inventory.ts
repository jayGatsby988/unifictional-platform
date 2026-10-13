/**
 * MANHATTAN — headless verification for the photo inventory.
 *
 *   npx tsx scripts/check-inventory.ts
 *
 * No network. Checks that the inventory's strict JSON schema is built the way
 * OpenAI structured outputs want it (no range keywords, every property
 * required, property NAMES never stripped), that `reconcileElements` keeps
 * good boxes and drops bad ones, that the analysis prompt lists elements when
 * given them and not otherwise, that sanitize repairs a missing inventory to
 * "nothing yet", and that a fake analysis + inventory merge reconciles into a
 * valid RoomSpec carrying "photo shows N …" notes. Then the sampling half:
 * two noisy passes pair up and average to within 1% of the truth, the
 * consistency rules lower (never delete) what contradicts physics, the frame
 * block parses, and reconcile rotates wall LABELS — never the spec — when the
 * inventory's frame is turned against it; a single element the photo shows
 * FACING into the room from a side wall moves the spec's element there (the
 * walls pass, covered in depth by check-walls.ts), while a mere label without
 * a facing stays a note.
 */
import { readFileSync } from 'node:fs';
import {
  INVENTORY_SAMPLES, InventoryResponseZ, SINGLE_SAMPLE_FACTOR, SINGLE_SAMPLE_MIN_CONFIDENCE, VIOLATION_FACTOR, applyConsistencyRules, inventoryFromModelJson, inventoryJsonSchema, mergeInventorySamples, mergeItemPass, pairAgreement,
} from '../src/lib/ai/inventory';
import { buildAnalysisPrompt, buildInventoryPrompt, FINISH_COLOR_DISCIPLINE, inventoryText } from '../src/lib/ai/prompt';
import { analyzeRoomDetailed, inventoryHeadStartMs, inventoryPromptWaitMs, selectAnalysisPhotos, MAX_ANALYSIS_PHOTOS } from '../src/lib/ai/analyze';
import { openaiClient } from '../src/lib/ai/providers/openai';
import { ProviderError } from '../src/lib/ai/providers/types';
import { editSchema } from '../src/lib/ai/refine';
import {
  MAX_ELEMENTS, inventoryDisagreements, reconcileElementWalls, reconcileElements, reconcileFrame, reconcileSolvedCamera, reconcileSpec, rotateWall, type DetectedWithFrame, type PhotoFrame,
} from '../src/lib/ai/reconcile';
import { sanitizeShape, type SanitizeReport } from '../src/lib/ai/sanitize';
import { defaultBathroom, defaultExterior, defaultKitchen } from '../src/lib/spec/defaults';
import { computeKitchenLayout } from '../src/components/scene/kitchen/layout';
import { computeBathroomLayout } from '../src/components/scene/bathroom/layout';
import { tileHeightFor } from '../src/components/scene/bathroom/RoomShell';
import { bathroomElementBoxes, checkBoxes, kitchenElementBoxes, makeCamera, projectElement, tileTopOn } from '../src/lib/fit';
import { ft, inch } from '../src/lib/units';
import { PhotoElementKindZ, RoomSpecZ, jsonSchemaFor } from '../src/lib/spec/schema';
import type { BathroomSpec, KitchenSpec, PhotoElement, RoomSpec, SolvedCamera, Wall } from '../src/lib/spec/types';

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const check = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));

console.log('\nPrimary photograph stays consistent across analysis views');
{
  const photos = [{ url: '/view-a.jpg' }, { url: '/view-b.jpg', primary: true }, { url: '/view-c.jpg', primary: true }];
  const before = JSON.stringify(photos);
  const selected = selectAnalysisPhotos(photos);
  check(selected.primaryIndex === 1 && selected.photos.filter((p) => p.primary).length === 1, 'first user-marked view defines one primary');
  check(JSON.stringify(photos) === before, 'primary normalization does not mutate upload records');
  const fallback = selectAnalysisPhotos([{ url: '/a.jpg' }, { url: '/b.jpg' }]);
  check(fallback.primaryIndex === 0 && fallback.photos[0].primary === true, 'an unmarked request uses and marks the first image');
  const many = Array.from({ length: MAX_ANALYSIS_PHOTOS + 3 }, (_, i) => ({ url: `/view-${i}.jpg`, primary: i === MAX_ANALYSIS_PHOTOS + 2 }));
  const capped = selectAnalysisPhotos(many);
  check(capped.photos.length === MAX_ANALYSIS_PHOTOS && capped.photos[capped.primaryIndex].url === many.at(-1)!.url, 'upload cap preserves the requested primary instead of discarding it');
  const prompt = buildAnalysisPrompt('kitchen', '', 3, { primaryPhotoIndex: 1 });
  check(prompt.includes('set detected.primaryPhotoIndex to 1') && !prompt.includes('Choose the widest'), 'vision is bound to the same primary as the pixel inventory');
  check(prompt.includes('ONE shared coordinate frame') && prompt.includes('ONE cabinet, not three'), 'supporting photographs corroborate geometry without duplicating objects or changing wall frames');
  check(prompt.includes(FINISH_COLOR_DISCIPLINE) && !prompt.includes('report it as white (#F3F1EA)'), 'analysis preserves neutral lightness contrast and independently observes cabinet slots without a near-white default');
}

const el = (kind: PhotoElement['kind'], box: [number, number, number, number], extra: Partial<PhotoElement> = {}): PhotoElement => ({
  id: extra.id ?? `${kind}-${Math.random().toString(36).slice(2, 6)}`,
  kind,
  wall: 'wall' in extra ? (extra.wall ?? null) : 'back',
  facing: extra.facing ?? null,
  box: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] },
  label: extra.label ?? kind,
  confidence: extra.confidence ?? 0.9,
  // truncation, when the case under test is about it (absent = the annotator
  // said nothing, which is what every element before the field looked like)
  ...('open' in extra ? { open: extra.open } : {}),
  ...('openCause' in extra ? { openCause: extra.openCause } : {}),
});

// ---------------------------------------------------------------------------
console.log('\n1. Strict schema for the inventory call');
{
  const schema = inventoryJsonSchema();
  // prefixItems is the tuple keyword strict mode rejects — the failure that has
  // bitten twice and that silently drops the whole call to non-strict. Run over
  // EVERY schema that goes out with strict: true, not just this one.
  const banned = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', 'default', '$schema', 'prefixItems']);
  const strictProblems = (root: unknown): string[] => {
    const problems: string[] = [];
    const walk = (node: unknown, path: string, inProps = false) => {
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (inProps) {
        // keys here are property names — a property called "pattern" must survive
        for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
        return;
      }
      for (const k of Object.keys(o)) if (banned.has(k)) problems.push(`${path}: keyword ${k} left in`);
      if (o.type === 'array' && (o.items === false || o.items === undefined)) problems.push(`${path}: array without an items schema`);
      if (o.type === 'object') {
        if (o.additionalProperties !== false) problems.push(`${path}: additionalProperties not false`);
        const props = Object.keys((o.properties as Record<string, unknown>) ?? {});
        const req = Array.isArray(o.required) ? (o.required as string[]) : [];
        if (props.length !== req.length || props.some((p) => !req.includes(p))) problems.push(`${path}: required ≠ properties`);
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, k === 'properties');
    };
    walk(root, '$');
    return problems;
  };
  const problems = strictProblems(schema);
  check(problems.length === 0, `strict rules hold everywhere${problems.length ? ` — ${problems.slice(0, 3).join('; ')}` : ''}`);
  // the analysis schemas and the refine edit schema go out strict too, and a
  // tuple anywhere in the zod mirror silently drops the whole call to non-strict
  for (const room of ['kitchen', 'bathroom', 'exterior'] as const) {
    const p2 = strictProblems(jsonSchemaFor(room));
    check(p2.length === 0, `${room} analysis schema is strict-clean${p2.length ? ` — ${p2.slice(0, 3).join('; ')}` : ''}`);
  }
  for (const room of ['kitchen', 'bathroom', 'exterior'] as const) {
    const p3 = strictProblems(editSchema(room));
    check(p3.length === 0, `${room} refine edit schema is strict-clean${p3.length ? ` — ${p3.slice(0, 3).join('; ')}` : ''}`);
  }
  const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
  check('aspect' in props && 'elements' in props && 'frame' in props, 'top level has aspect + frame + elements');
  const frameProps = Object.keys((props.frame?.properties as Record<string, unknown>) ?? {});
  check(frameProps.join(',') === 'backWallSpansX,leftWallVisible,rightWallVisible', `frame is {backWallSpansX, leftWallVisible, rightWallVisible} (got ${frameProps.join(',')})`);
  const item = (props.elements?.items as Record<string, unknown>) ?? {};
  const itemProps = (item.properties as Record<string, Record<string, unknown>>) ?? {};
  check(['id', 'kind', 'wall', 'facing', 'box', 'label', 'confidence'].every((k) => k in itemProps), 'element carries id/kind/wall/facing/box/label/confidence');
  const boxProps = Object.keys((itemProps.box?.properties as Record<string, unknown>) ?? {});
  check(boxProps.join(',') === 'x0,y0,x1,y1', `box is an object {x0,y0,x1,y1} (got ${boxProps.join(',')})`);
  const kinds = (itemProps.kind?.enum as string[]) ?? [];
  check(kinds.length === PhotoElementKindZ.options.length && PhotoElementKindZ.options.every((k) => kinds.includes(k)), `kind enum has all ${PhotoElementKindZ.options.length} PhotoElementKinds`);
  const wallSchema = JSON.stringify(itemProps.wall ?? {});
  check(wallSchema.includes('island') && wallSchema.includes('null'), 'wall allows the four walls, island and null');
  // a decoy schema property NAMED "pattern" would be stripped by a naive stripper — make sure ours survives on the real schema too
  const parsed = InventoryResponseZ.safeParse({ aspect: 1.5, frame: { backWallSpansX: [0.2, 0.9], leftWallVisible: true, rightWallVisible: true }, elements: [el('fridge', [0.8, 0.2, 0.95, 0.8])] });
  check(parsed.success, 'InventoryResponseZ accepts a well-formed answer');
}

// ---------------------------------------------------------------------------
console.log('\n2. reconcileElements keeps / drops the right boxes');
{
  const raw: unknown[] = [
    el('fridge', [0.82, 0.15, 0.95, 0.8], { id: 'fridge-1', label: '36in french-door fridge', facing: 'front' }),
    el('window', [0.3, 0.2, 0.45, 0.5], { id: 'win-1', wall: 'left' }),
    el('window', [0.3, 0.2, 0.45, 0.5], { id: 'win-dup', wall: 'left' }), // identical box → dedupe
    el('stool', [0.6, 0.7, 0.5, 0.9], { id: 'inverted' }), // x0 > x1 → drop
    el('stool', [0.6, 0.7, 0.6, 0.9], { id: 'zero-width' }), // degenerate → drop
    el('stool', [0.2, 0.7, 1.4, 0.95], { id: 'overflow' }), // x1 > 1 → clamp
    { id: 'no-kind', wall: 'back', box: { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }, label: '', confidence: 0.5 },
    { id: 'bad-kind', kind: 'spaceship', wall: 'back', box: { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }, label: '', confidence: 0.5 },
    { id: 'tuple-box', kind: 'pendant', wall: null, facing: 'sideways', box: [0.4, 0.05, 0.45, 0.25], label: 'cage pendant', confidence: 2 }, // tuple tolerated, confidence clamped, unknown facing → null
    { id: 'win-1', kind: 'art', wall: 'kitchen', box: { x0: 0.5, y0: 0.3, x1: 0.6, y1: 0.4 }, label: 7, confidence: 'high' }, // dup id → renamed, bad wall → null
    'junk', null, 42,
  ];
  const fixes: string[] = [];
  const out = reconcileElements(raw, { photoCount: 1, fixes });
  const ids = out.map((e) => e.id);
  check(out.length === 5, `5 of ${raw.length} survive (got ${out.length}: ${ids.join(', ')})`);
  check(ids.includes('fridge-1') && ids.includes('win-1'), 'valid ids kept');
  check(!ids.includes('win-dup'), 'identical box deduped');
  check(!ids.includes('inverted') && !ids.includes('zero-width'), 'inverted and degenerate boxes dropped');
  const overflow = out.find((e) => e.id === 'overflow');
  check(overflow?.box.x1 === 1, 'x1 > 1 clamped to 1');
  check(!ids.includes('no-kind') && !ids.includes('bad-kind'), 'missing / unknown kind dropped');
  const tuple = out.find((e) => e.kind === 'pendant');
  check(Boolean(tuple) && tuple!.box.x0 === 0.4 && tuple!.box.y1 === 0.25 && tuple!.confidence === 1 && tuple!.wall === null && tuple!.facing === null, 'tuple box read, confidence clamped, null wall kept, unknown facing → null');
  const fridge = out.find((e) => e.id === 'fridge-1');
  check(fridge?.facing === 'front', 'facing kept when valid');
  const art = out.find((e) => e.kind === 'art');
  check(Boolean(art) && art!.id !== 'win-1' && art!.wall === null && art!.label === '', 'duplicate id renamed, unknown wall → null, non-string label → ""');
  check(fixes.some((f) => f.includes('dropped')) && fixes.some((f) => f.includes('duplicate')), `fixes report drops + dedupes (${fixes.length} lines)`);
  check(new Set(ids).size === ids.length, 'ids unique');

  const many = Array.from({ length: 90 }, (_, i) => el('stool', [i / 100, 0.5, i / 100 + 0.05, 0.6]));
  const capped = reconcileElements(many);
  check(capped.length === MAX_ELEMENTS, `capped at ${MAX_ELEMENTS} (got ${capped.length})`);
  check(reconcileElements(undefined).length === 0 && reconcileElements('nope').length === 0 && reconcileElements({}).length === 0, 'non-arrays → []');
}

// ---------------------------------------------------------------------------
console.log('\n3. reconcileSolvedCamera');
{
  const good = { x: 1, y: 1.5, z: 4, yawDeg: -10, pitchDeg: 5, fovDeg: 60, aspect: 1.5, score: 0.7 };
  check(JSON.stringify(reconcileSolvedCamera(good)) === JSON.stringify(good), 'complete camera passes through');
  check(reconcileSolvedCamera(null) === null && reconcileSolvedCamera(undefined) === null, 'null / undefined → null');
  check(reconcileSolvedCamera({ ...good, fovDeg: undefined }) === null, 'missing field → null (never a half camera)');
  check(reconcileSolvedCamera({ ...good, fovDeg: 5 }) === null && reconcileSolvedCamera({ ...good, aspect: 9 }) === null, 'out-of-range fov / aspect → null');
  check(reconcileSolvedCamera({ ...good, score: 3 })?.score === 1, 'score clamped');
}

// ---------------------------------------------------------------------------
console.log('\n4. Prompts');
{
  const elements = [
    el('fridge', [0.82, 0.15, 0.95, 0.8], { id: 'fridge-1', label: '36in stainless french-door fridge' }),
    el('stool', [0.3, 0.7, 0.36, 0.9], { id: 'stool-1', wall: 'island' }),
    el('pendant', [0.5, 0.05, 0.55, 0.25], { id: 'pend-1', wall: null }),
  ];
  const text = inventoryText(elements);
  check(text.startsWith('ELEMENTS SEEN'), 'inventoryText has the header');
  check(text.includes('fridge (fridge-1) on the back wall: x 0.82–0.95, y 0.15–0.80 — 36in stainless french-door fridge'), 'element line carries kind, id, wall, box and label');
  check(text.includes('on the island') && text.includes('no wall'), 'island and null walls worded');
  check(text.includes('COUNTS FROM THE PHOTO: 1 fridge, 1 stool, 1 pendant') || /COUNTS FROM THE PHOTO: .*1 stool/.test(text), 'tally line lists the countable kinds');

  const withList = buildAnalysisPrompt('kitchen', '', 1, { elements });
  const without = buildAnalysisPrompt('kitchen', '', 1);
  const emptyList = buildAnalysisPrompt('kitchen', '', 1, { elements: [] });
  check(withList.includes('ELEMENTS SEEN') && withList.includes('fridge-1'), 'analysis prompt lists the elements when given');
  check(!without.includes('ELEMENTS SEEN') && !emptyList.includes('ELEMENTS SEEN'), 'analysis prompt has no list without elements (or with an empty list)');
  check(withList.includes('SAME wall as "back"'), 'analysis prompt pins the wall frame to the inventory');
  check(without.includes('detected.elements to an empty array') && without.includes('camera.solved to null'), 'analysis prompt tells the model not to fill elements / solved');
  // The delta is the three element lines PLUS the FIXED hand-off paragraph
  // that only appears when there is an inventory (open edges are lower bounds,
  // counts are lower bounds, the frame span bounds dims.widthFt). Raising the
  // whole-block cap 2000 → 3000 to absorb the fixed paragraph made the guard
  // slack against the thing it exists for — PER-ELEMENT bloat — so the two are
  // measured separately: the fixed part once, and the marginal cost of an
  // element against a budget that does not grow with the paragraph.
  const withSix = buildAnalysisPrompt('kitchen', '', 1, { elements: [...elements, ...elements.map((e, i) => ({ ...e, id: `${e.id}-b${i}` })) ] });
  const perElement = (withSix.length - withList.length) / 3;
  const fixed = withList.length - without.length - 3 * perElement;
  check(perElement < 250, `each element costs ${perElement.toFixed(0)} chars of prompt (< 250)`);
  check(fixed < 2600, `the fixed inventory hand-off paragraph costs ${fixed.toFixed(0)} chars (< 2600)`);
  check(withList.length - without.length < 3000, `element list adds ${withList.length - without.length} chars for 3 elements`);

  const inv = buildInventoryPrompt('kitchen', 4 / 3);
  check(inv.includes('1.333 wide for every 1.0 tall') && inv.includes('landscape'), 'inventory prompt states the aspect');
  check(inv.includes('TOP-LEFT') && inv.includes('{x0, y0, x1, y1}') && inv.includes('x0 < x1'), 'inventory prompt defines the box convention');
  for (const must of ['INCLUDING its handles', 'base-cabinet-run: ONE box per wall', 'contiguous tiled', 'EACH ONE gets its own box', 'chimney', 'At most 90']) check(inv.includes(must), `inventory prompt: "${must}"`);
  // the fitter's box conventions (src/lib/fit/boxes.ts) spelled out for the annotator
  for (const must of ['PIXEL-TIGHT', 'ONE box per physical object', "facing 'front' ⇒ wall 'back'", 'toe kick to the underside of the countertop', 'INCLUDING the crown', 'EXCLUDE the stools', 'ceiling canopy / hook down to the bottom of the shade', 'glazing PLUS its frame', 'each open board is its own box', 'backWallSpansX', 'WALL PLANE']) check(inv.includes(must), `inventory prompt: "${must}"`);
  // THE CONTAMINATED ISLAND BOX (reconcile.ts `repairIslandTops`, and the
  // client's "js a square small island"): on client-tan the annotator drew the
  // island's silhouette WITH the vases standing on it, which puts the box's
  // top edge halfway up a vase instead of on the counter's far edge. The rule
  // has to say the top edge is a COUNTER EDGE, name what rises above it, and
  // say the stools are not the island's — a stool running off the bottom of
  // the picture was also making the island read as frame-cut.
  for (const must of ['far edge of the counter surface', 'vases, plants, bowls', 'must cut THROUGH them', 'even when a stool runs off the bottom of the picture']) check(inv.includes(must), `inventory prompt, island box: "${must}"`);
  check(!inv.includes('Annotation pass') && buildInventoryPrompt('kitchen', 4 / 3, { nonce: '1of2-abc123' }).includes('Annotation pass 1of2-abc123'), 'nonce line only with a nonce');
  const invA = buildInventoryPrompt('kitchen', 4 / 3, { nonce: 'a' }), invB = buildInventoryPrompt('kitchen', 4 / 3, { nonce: 'b' });
  check(invA !== invB && invA.replace('pass a', 'pass b') === invB, 'two passes differ by the nonce alone');
  const frame: PhotoFrame = { backWallSpansX: [0.23, 0.886], leftWallVisible: true, rightWallVisible: false };
  const withFrame = inventoryText(elements, frame);
  check(withFrame.includes('FRAME FROM THE PHOTO: the back wall\'s plane spans x 0.23–0.89') && withFrame.includes('left wall is visible') && withFrame.includes('right wall is not visible'), 'inventoryText carries the frame line');
  check(!inventoryText(elements).includes('FRAME FROM'), 'no frame line without a frame');
  const framed = buildAnalysisPrompt('kitchen', '', 1, { elements, frame });
  check(framed.includes('FRAME FROM THE PHOTO') && framed.includes('beyond a corner is a wall hint, not proof'), 'analysis prompt passes the frame through and verifies corner labels using visible orientation');
  check(without.includes('lookingAt is "back"'), 'analysis prompt pins camera.lookingAt to the convention');
  check(buildInventoryPrompt('bathroom', null).includes('Estimate the photo'), 'inventory prompt asks for the aspect when unknown');
  check(buildInventoryPrompt('exterior', 1.5).includes('elevation'), 'exterior inventory prompt talks about elevations');
  check(buildInventoryPrompt('bathroom', 0.75).includes('portrait') && buildInventoryPrompt('bathroom', 0.75).includes('vanity'), 'bathroom inventory prompt: portrait + fixtures');
  // the items-only pass: one kind, its own cap, and none of the main pass's
  // vocabulary to spend its budget on
  const onlyItems = buildInventoryPrompt('kitchen', 1.5, { only: 'items' });
  check(onlyItems.includes('KINDS: item.'), 'items-only prompt asks for one kind');
  check(onlyItems.includes('At most 30 items'), 'items-only prompt caps at 30');
  check(!onlyItems.includes('base-cabinet-run'), 'items-only prompt does not list the main pass\'s kinds');
  check(onlyItems.includes('0.15%') && onlyItems.includes('PIXEL-TIGHT'), 'items-only prompt keeps the pixel discipline and lowers the size floor');
  check(inv.includes('At most 90 elements'), 'the main prompt asks for up to 90 elements — the same cap as reconcile, the schema and the fitter');
  check(inv.includes('item:'), 'the main prompt lists items among its kinds too');
  // every kind the schema allows is one the annotator is told about
  const kinds = PhotoElementKindZ.options as readonly string[];
  const enumInSchema = JSON.stringify(inventoryJsonSchema());
  check(kinds.includes('item') && kinds.every((k) => enumInSchema.includes(`"${k}"`)), `the inventory schema's kind enum carries all ${kinds.length} kinds, 'item' among them`);
}

// ---------------------------------------------------------------------------
console.log('\n5. Model text → inventory');
{
  const fenced = '```json\n{"aspect": 1.5, "frame": {"backWallSpansX": [0.9, 0.2], "leftWallVisible": true, "rightWallVisible": false}, "elements": [{"id":"a","kind":"fridge","wall":"back","box":{"x0":0.8,"y0":0.1,"x1":0.95,"y1":0.9},"label":"fridge","confidence":0.9}, {"id":"b","kind":"stool","wall":"island","box":{"x0":0.5,"y0":0.5,"x1":0.5,"y1":0.9},"label":"","confidence":0.9}]}\n```';
  const r = inventoryFromModelJson(fenced);
  check(r.elements.length === 1 && r.aspect === 1.5, `fenced JSON parsed, degenerate stool dropped (${r.elements.length} kept, aspect ${r.aspect})`);
  check(JSON.stringify(r.frame) === JSON.stringify({ backWallSpansX: [0.2, 0.9], leftWallVisible: true, rightWallVisible: false }), `frame parsed, reversed span put in order (${JSON.stringify(r.frame)})`);
  const noList = inventoryFromModelJson('{"aspect": 99}');
  check(noList.elements.length === 0 && noList.aspect === null && noList.frame === null, 'missing elements → [], absurd aspect → null, missing frame → null');
  let threw = false;
  try { inventoryFromModelJson('not json at all'); } catch { threw = true; }
  check(threw, 'non-JSON throws (caller logs and continues)');
}

// ---------------------------------------------------------------------------
console.log('\n6. sanitize repairs a missing inventory');
{
  const raw = JSON.parse(JSON.stringify(defaultKitchen())) as Record<string, unknown>;
  const det = raw.detected as Record<string, unknown>;
  delete det.elements;
  delete (det.camera as Record<string, unknown>).solved;
  const report: SanitizeReport = { fixes: [] };
  const fallback = defaultKitchen();
  const shaped = sanitizeShape(raw, 'kitchen', fallback, report) as { detected: { elements: unknown; camera: { solved: unknown } } };
  check(Array.isArray(shaped.detected.elements) && shaped.detected.elements.length === 0, 'missing elements → []');
  check(shaped.detected.camera.solved === null, 'missing camera.solved → null');
  check(RoomSpecZ.safeParse(shaped).success, 'repaired spec validates');

  // an older fallback without the fields, and garbage in the fields
  const legacy = JSON.parse(JSON.stringify(defaultKitchen())) as { detected: Record<string, unknown> };
  delete legacy.detected.elements;
  det.elements = 'lots';
  det.camera = { fovDeg: 60, heightFt: 5, position: 'front', lookingAt: 'back', solved: 'yes' };
  const shaped2 = sanitizeShape(raw, 'kitchen', legacy, { fixes: [] }) as { detected: { elements: unknown; camera: { solved: unknown } } };
  check(Array.isArray(shaped2.detected.elements) && shaped2.detected.camera.solved === null, 'garbage elements / solved with a legacy fallback → [] / null');
  check(RoomSpecZ.safeParse(shaped2).success, 'that spec validates too');
}

// ---------------------------------------------------------------------------
console.log('\n7. Fake analysis + inventory merge → valid RoomSpec with count notes');
{
  const spec: RoomSpec = defaultKitchen(); // island seats 3, 1 window, 2 pendants, 2 shelf units, 2 plants
  const shelfBoards = spec.roomType === 'kitchen' ? spec.decor.shelves.reduce((s, sh) => s + sh.count, 0) : 0;
  spec.detected.elements = [
    el('base-cabinet-run', [0.05, 0.55, 0.95, 0.8], { id: 'base-back' }),
    el('upper-cabinet-run', [0.05, 0.1, 0.7, 0.4], { id: 'upper-back' }),
    el('fridge', [0.82, 0.15, 0.95, 0.8], { id: 'fridge-1' }),
    el('range', [0.55, 0.5, 0.68, 0.8], { id: 'range-1' }),
    el('hood', [0.55, 0.1, 0.68, 0.4], { id: 'hood-1' }),
    el('dishwasher', [0.3, 0.55, 0.4, 0.8], { id: 'dw-1' }),
    el('island', [0.2, 0.6, 0.8, 0.95], { id: 'island-1', wall: 'island' }),
    ...[0, 1, 2, 3].map((i) => el('stool', [0.25 + i * 0.13, 0.75, 0.33 + i * 0.13, 0.98], { id: `stool-${i + 1}`, wall: 'island' })),
    el('window', [0.3, 0.15, 0.45, 0.45], { id: 'win-1' }),
    el('window', [0.02, 0.15, 0.1, 0.45], { id: 'win-2', wall: 'left' }),
    el('pendant', [0.4, 0.02, 0.45, 0.2], { id: 'pend-1', wall: null }),
    el('pendant', [0.6, 0.02, 0.65, 0.2], { id: 'pend-2', wall: null }),
    el('plant', [0.9, 0.5, 0.98, 0.7], { id: 'plant-1', wall: 'right' }),
    el('plant', [0.5, 0.55, 0.53, 0.62], { id: 'plant-2', wall: 'island' }),
    el('plant', [0.05, 0.3, 0.1, 0.38], { id: 'plant-3', wall: 'left' }),
    el('rug', [0.1, 0.85, 0.9, 1], { id: 'rug-1', wall: null }),
    el('wall', [0, 0.05, 1, 0.6], { id: 'wall-back' }),
    el('floor', [0, 0.8, 1, 1], { id: 'floor', wall: null }),
  ];
  const fixes: string[] = [];
  const out = reconcileSpec(spec, { photoCount: 1, fixes });
  const parsed = RoomSpecZ.safeParse(out);
  check(parsed.success, `reconciled spec validates${parsed.success ? '' : `: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`}`);
  check(out.detected.elements.length === spec.detected.elements.length, `all ${spec.detected.elements.length} elements survive reconcile`);
  check(out.detected.camera.solved === null, 'camera.solved stays null (nothing solved yet)');
  const notes = out.detected.notes;
  check(notes.some((n) => n === 'inventory: photo shows 4 stools, spec says 3'), `stool count note written (${JSON.stringify(notes.filter((n) => n.startsWith('inventory:')))})`);
  check(notes.some((n) => n.includes('2 windows, spec says 1')), 'window count note written');
  check(notes.some((n) => n.includes('3 plants, spec says 2')), 'plant count note written');
  check(!notes.some((n) => n.includes('pendant')), 'no note when counts agree (pendants 2 = 2)');
  check(!notes.some((n) => n.includes('shelf')) === (shelfBoards === 0) || notes.some((n) => n.includes('shelf board')), 'shelf boards compared (photo has none)');
  const kitchen = out.roomType === 'kitchen' ? out : null;
  check(kitchen?.island.seating === 3 && kitchen.openings.filter((o) => o.kind === 'window').length === 1, 'spec NOT auto-edited — seating and windows unchanged');
  check(fixes.some((f) => f.includes('differ from the photo')), 'fixes mention the disagreement');
  const disagreements = inventoryDisagreements(out);
  check(disagreements.length >= 3, `inventoryDisagreements is pure and repeatable (${disagreements.length} lines)`);

  // agreeing inventory → no notes
  const agree: RoomSpec = defaultKitchen();
  agree.detected.elements = [
    ...[0, 1, 2].map((i) => el('stool', [0.25 + i * 0.13, 0.75, 0.33 + i * 0.13, 0.98], { id: `stool-${i + 1}`, wall: 'island' })),
    el('island', [0.2, 0.6, 0.8, 0.95], { id: 'island-1', wall: 'island' }),
    el('window', [0.3, 0.15, 0.45, 0.45], { id: 'win-1' }),
    el('pendant', [0.4, 0.02, 0.45, 0.2], { id: 'pend-1', wall: null }),
    el('pendant', [0.6, 0.02, 0.65, 0.2], { id: 'pend-2', wall: null }),
    ...agree.roomType === 'kitchen' ? agree.decor.plants.map((_, i) => el('plant', [0.1 * i, 0.5, 0.1 * i + 0.05, 0.6], { id: `plant-${i}` })) : [],
    ...Array.from({ length: shelfBoards }, (_, i) => el('shelf', [0.1, 0.1 + i * 0.1, 0.3, 0.12 + i * 0.1], { id: `shelf-${i}`, wall: agree.roomType === 'kitchen' ? agree.decor.shelves[0].wall : 'back' })),
    ...agree.roomType === 'kitchen' ? agree.decor.art.map((a, i) => el('art', [0.7, 0.1 + i * 0.1, 0.8, 0.2 + i * 0.1], { id: `art-${i}`, wall: a.wall })) : [],
    // the LABELS matter here: an 'agreeing' inventory is one that names the
    // same objects, and `itemsFromInventory` reads those words to decide which
    // boxes the analysis already described (an unrecognised one becomes a new item)
    ...agree.roomType === 'kitchen' ? (agree.decor.items ?? []).map((it, i) => el('item', [0.3 + i * 0.05, 0.5, 0.33 + i * 0.05, 0.55], { id: `item-${i}`, wall: it.wall, label: it.label })) : [],
    el('rug', [0.1, 0.85, 0.9, 1], { id: 'rug-1', wall: null }),
    el('fridge', [0.82, 0.15, 0.95, 0.8], { id: 'fridge-1' }),
  ];
  const agreed = reconcileSpec(agree, { photoCount: 1 });
  const agreeNotes = agreed.detected.notes.filter((n) => n.startsWith('inventory:'));
  check(agreeNotes.length === 0, `agreeing inventory writes no notes (${JSON.stringify(agreeNotes)})`);

  // the detail layer is counted like everything else: the demo kitchen draws
  // four items, and a photo showing two says so
  {
    const withItems: RoomSpec = defaultKitchen();
    const specItems = withItems.roomType === 'kitchen' ? (withItems.decor.items ?? []).length : 0;
    withItems.detected.elements = [
      // two of the four the demo kitchen draws, in its own words — a box whose
      // label names nothing in the spec is a NEW item (see check-decor §10),
      // and this section is about the count note, not the synthesiser
      el('item', [0.40, 0.50, 0.46, 0.56], { id: 'item-1', label: 'stainless kettle' }),
      el('item', [0.20, 0.51, 0.24, 0.56], { id: 'item-2', label: 'white ceramic canisters' }),
    ];
    const itemNotes = reconcileSpec(withItems, { photoCount: 1 }).detected.notes;
    check(specItems === 4 && itemNotes.some((n) => n === `inventory: photo shows 2 items, spec says ${specItems}`), `item count note written (${JSON.stringify(itemNotes.filter((n) => n.includes('item')))})`);
  }

  // no inventory → no notes, nothing else changes
  const bare = reconcileSpec(defaultKitchen(), { photoCount: 1 });
  check(bare.detected.elements.length === 0 && !bare.detected.notes.some((n) => n.startsWith('inventory:')), 'empty inventory → no notes');

  // bathroom + exterior take the same path
  const bath: RoomSpec = defaultBathroom();
  bath.detected.elements = [el('vanity', [0.2, 0.4, 0.8, 0.9], { id: 'v' }), el('toilet', [0.85, 0.5, 0.98, 0.9], { id: 't', wall: 'right' }), el('window', [0.4, 0.1, 0.6, 0.3], { id: 'w' }), el('window', [0.05, 0.1, 0.15, 0.3], { id: 'w2', wall: 'left' })];
  const bathOut = reconcileSpec(bath, { photoCount: 1 });
  check(RoomSpecZ.safeParse(bathOut).success && bathOut.detected.elements.length === 4, 'bathroom spec with inventory validates');
  check(bathOut.detected.notes.some((n) => n.includes('window')), `bathroom window disagreement noted (${JSON.stringify(bathOut.detected.notes.filter((n) => n.startsWith('inventory:')))})`);
  const ext: RoomSpec = defaultExterior();
  const extWindows = ext.roomType === 'exterior' ? ext.elevations.reduce((s, e) => s + e.windows.length, 0) : 0;
  ext.detected.elements = [
    ...Array.from({ length: extWindows + 2 }, (_, i) => el('window', [0.05 + i * 0.06, 0.3, 0.09 + i * 0.06, 0.45], { id: `w${i}`, wall: 'front' })),
    el('door', [0.45, 0.5, 0.52, 0.75], { id: 'door', wall: 'front', label: 'entry door' }),
    el('ceiling', [0, 0.05, 1, 0.3], { id: 'roof', wall: null, label: 'gable roof' }),
  ];
  const extOut = reconcileSpec(ext, { photoCount: 1 });
  check(RoomSpecZ.safeParse(extOut).success && extOut.detected.elements.length === extWindows + 4, 'exterior spec with inventory validates');
  check(extOut.detected.notes.some((n) => n.includes(`${extWindows + 2} windows`)), 'exterior window disagreement noted across elevations');
}

// ---------------------------------------------------------------------------
console.log('\n8. Three noisy passes cluster and merge by per-edge median');
{
  // deterministic jitter so the check is repeatable
  let seed = 7;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 - 0.5; };
  const truth: PhotoElement[] = [
    el('base-cabinet-run', [0.32, 0.59, 0.86, 0.78], { id: 'base-back' }),
    el('upper-cabinet-run', [0.29, 0.16, 0.83, 0.49], { id: 'upper-back' }),
    el('hood', [0.58, 0.1, 0.7, 0.42], { id: 'hood-1' }),
    el('range', [0.565, 0.575, 0.685, 0.71], { id: 'range-1' }),
    el('fridge', [0.889, 0.165, 0.984, 0.921], { id: 'fridge-1', wall: 'right' }),
    // NOTE the island's top edge, 0.66: BELOW the back run's counter line
    // (0.59), because the island stands in front of that run and a camera above
    // both counters sees the NEARER one LOWER in the frame. An island box
    // drawn above it is the contaminated box `repairIslandTops` trims, and a
    // merge test whose own truth breaks that rule would be measuring the
    // repair instead of the median.
    el('island', [0.28, 0.66, 0.705, 0.957], { id: 'island-1', wall: 'island' }),
    ...[0, 1, 2, 3].map((i) => el('stool', [0.4 + i * 0.13, 0.75, 0.53 + i * 0.13, 0.99], { id: `stool-${i + 1}`, wall: 'island' })),
    el('pendant', [0.451, 0, 0.546, 0.389], { id: 'pend-1', wall: null }),
    el('pendant', [0.753, 0, 0.849, 0.388], { id: 'pend-2', wall: null }),
    el('window', [0.06, 0.173, 0.186, 0.564], { id: 'win-1', wall: 'left' }),
    el('wall', [0.23, 0.086, 0.886, 0.794], { id: 'wall-back' }),
    el('floor', [0, 0.68, 1, 1], { id: 'floor', wall: null }),
  ];
  const jitter = (e: PhotoElement, amp: number, suffix: string): PhotoElement => ({
    ...e,
    id: `${e.id}-${suffix}`,
    box: { x0: e.box.x0 + rnd() * amp, y0: e.box.y0 + rnd() * amp, x1: e.box.x1 + rnd() * amp, y1: e.box.y1 + rnd() * amp },
    confidence: 0.9 + rnd() * 0.1,
  });
  // ±1% noise on every edge, in a different order per pass, one pass calling the range a cooktop
  const a = truth.map((e) => jitter(e, 0.02, 'a'));
  const b = [...truth].reverse().map((e) => jitter(e.kind === 'range' ? { ...e, kind: 'cooktop' } : e, 0.02, 'b'));
  const { elements: merged, stats } = mergeInventorySamples([a, b]);
  check(stats.paired === truth.length && stats.single === 0 && stats.dropped === 0, `every element paired (${stats.paired} pairs, ${stats.single} singles, ${stats.dropped} dropped)`);
  check(merged.length === truth.length, `${merged.length} merged elements for ${truth.length} truths`);
  let maxErr = 0;
  for (const t of truth) {
    const m = merged.find((e) => e.id === `${t.id}-a`)!;
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) maxErr = Math.max(maxErr, Math.abs(m.box[k] - t.box[k]));
  }
  check(maxErr <= 0.01, `averaged boxes within 1% of the truth (max error ${(maxErr * 100).toFixed(2)}%)`);
  check(stats.agreement !== null && stats.agreement > 0.8, `agreement is the mean IoU between passes (${stats.agreement})`);
  const rangeM = merged.find((e) => e.id === 'range-1-a')!;
  check(['range', 'cooktop'].includes(rangeM.kind), `range and cooktop pair as one family (kind ${rangeM.kind})`);
  const fridgeM = merged.find((e) => e.id === 'fridge-1-a')!;
  const fa = a.find((e) => e.id === 'fridge-1-a')!, fb = b.find((e) => e.id === 'fridge-1-b')!;
  const ix = Math.max(0, Math.min(fa.box.x1, fb.box.x1) - Math.max(fa.box.x0, fb.box.x0)), iy = Math.max(0, Math.min(fa.box.y1, fb.box.y1) - Math.max(fa.box.y0, fb.box.y0));
  const inter = ix * iy, union = (fa.box.x1 - fa.box.x0) * (fa.box.y1 - fa.box.y0) + (fb.box.x1 - fb.box.x0) * (fb.box.y1 - fb.box.y0) - inter;
  const expected = ((fa.confidence + fb.confidence) / 2) * (0.5 + 0.5 * pairAgreement(fa.box, fb.box));
  check(Math.abs(fridgeM.confidence - expected) < 0.002 && pairAgreement(fa.box, fb.box) > inter / union, `pair confidence = mean × (0.5 + 0.5 × agreement), agreement ≥ IoU (${fridgeM.confidence} vs ${expected.toFixed(3)})`);
  // a shelf board shifted by its own thickness is still the same board: agreement stays high where IoU collapses
  const board = { x0: 0.23, y0: 0.369, x1: 0.38, y1: 0.408 }, shifted = { x0: 0.232, y0: 0.39, x1: 0.382, y1: 0.43 };
  const boardIoU = (Math.min(board.x1, shifted.x1) - Math.max(board.x0, shifted.x0)) * (Math.min(board.y1, shifted.y1) - Math.max(board.y0, shifted.y0)) / ((board.x1 - board.x0) * (board.y1 - board.y0) * 2 - (Math.min(board.x1, shifted.x1) - Math.max(board.x0, shifted.x0)) * (Math.min(board.y1, shifted.y1) - Math.max(board.y0, shifted.y0)));
  check(boardIoU < 0.4 && pairAgreement(board, shifted) > 0.5, `thin box agreement ${pairAgreement(board, shifted).toFixed(2)} where IoU is ${boardIoU.toFixed(2)}`);
  check(pairAgreement(board, board) === 1 && pairAgreement(board, { x0: 0.6, y0: 0.6, x1: 0.7, y1: 0.7 }) === 0, 'agreement is 1 for identical boxes, 0 for disjoint far ones');
  check(fridgeM.wall === 'right' && fridgeM.box.x0 > 0.85, 'walls and positions carried through');
  const facingA = [el('fridge', [0.85, 0.1, 0.95, 0.9], { id: 'f', wall: 'right', facing: 'left', confidence: 0.9 })];
  const facingB = [el('fridge', [0.85, 0.1, 0.95, 0.9], { id: 'g', wall: 'back', facing: 'front', confidence: 0.7 })];
  const fm = mergeInventorySamples([facingA, facingB]).elements[0];
  check(fm.wall === 'right' && fm.facing === 'left', 'disagreeing wall + facing → the surer pass\'s');
  check(mergeInventorySamples([facingA, [{ ...facingB[0], wall: 'right', facing: 'left' }]]).elements[0].facing === 'left', 'agreeing facing kept');
  check(new Set(merged.map((e) => e.id)).size === merged.length, 'merged ids unique');
  const pairsFirst = merged.findIndex((e) => e.id.endsWith('-b'));
  check(pairsFirst === -1, 'paired elements keep the first pass\'s id');

  // one pass sees a plant the other missed: kept when sure, dropped when not, marked down either way
  const onlyA = [...a, el('plant', [0.9, 0.5, 0.98, 0.7], { id: 'plant-sure', confidence: 0.9 }), el('art', [0.1, 0.1, 0.2, 0.2], { id: 'art-unsure', confidence: 0.6 })];
  const single = mergeInventorySamples([onlyA, b]);
  const sure = single.elements.find((e) => e.id === 'plant-sure');
  check(Boolean(sure) && Math.abs(sure!.confidence - 0.9 * SINGLE_SAMPLE_FACTOR) < 0.002, `a confident single-pass element survives at ×${SINGLE_SAMPLE_FACTOR} (${sure?.confidence})`);
  check(!single.elements.some((e) => e.id === 'art-unsure') && single.stats.dropped === 1 && single.stats.single === 1, 'an unsure single-pass element is dropped');
  // a pendant the second pass put half a frame away is NOT the same pendant: both survive as singles, or drop when unsure
  const far = mergeInventorySamples([[el('pendant', [0.1, 0, 0.15, 0.3], { id: 'p-a', wall: null, confidence: 0.95 })], [el('pendant', [0.7, 0, 0.75, 0.3], { id: 'p-b', wall: null, confidence: 0.95 })]]);
  check(far.stats.paired === 0 && far.elements.length === 2, 'boxes far apart never pair, even of the same kind');
  // a pendant cord 4% off with no overlap still pairs (centre rule)
  const thin = mergeInventorySamples([[el('faucet', [0.15, 0.49, 0.18, 0.64], { id: 'f-a' })], [el('faucet', [0.185, 0.5, 0.215, 0.65], { id: 'f-b' })]]);
  check(thin.stats.paired === 1, 'thin boxes with close centres pair without overlap');
  const empty = mergeInventorySamples([[], b]);
  check(empty.elements.length === b.filter((e) => e.confidence >= 0.8).length && empty.stats.paired === 0, 'an empty pass leaves the other\'s confident elements');
  // cap: 45 + 45 distinct elements → the pairs come first, then the cap
  const many1 = Array.from({ length: 45 }, (_, i) => el('stool', [i / 50, 0.5, i / 50 + 0.015, 0.6], { id: `s${i}`, wall: 'island', confidence: 0.95 }));
  const many2 = Array.from({ length: 45 }, (_, i) => el('stool', [i / 50 + 0.5 / 50, 0.7, i / 50 + 0.5 / 50 + 0.015, 0.8], { id: `t${i}`, wall: 'island', confidence: 0.95 }));
  const capped = mergeInventorySamples([many1, many2]);
  check(capped.elements.length === MAX_ELEMENTS, `merged list capped at ${MAX_ELEMENTS} (${capped.elements.length})`);

  // --- three passes: the default, and the reason for the median
  check(INVENTORY_SAMPLES === 3, `the inventory runs ${INVENTORY_SAMPLES} passes`);
  const c = truth.map((e) => jitter(e, 0.02, 'c'));
  const three = mergeInventorySamples([a, b, c]);
  check(three.stats.paired === truth.length && three.stats.single === 0 && three.stats.dropped === 0, `three passes → one cluster per element (${three.stats.paired} clusters, ${three.stats.single} singles, ${three.stats.dropped} dropped)`);
  let maxErr3 = 0;
  for (const t of truth) {
    const m = three.elements.find((e) => e.id === `${t.id}-a`)!;
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) maxErr3 = Math.max(maxErr3, Math.abs(m.box[k] - t.box[k]));
  }
  check(maxErr3 <= 0.01, `merged boxes within 1% of the truth (max error ${(maxErr3 * 100).toFixed(2)}%)`);
  check(three.stats.agreement !== null && three.stats.agreement > 0.8, `agreement is the mean pairwise agreement inside the clusters (${three.stats.agreement})`);
  check(three.stats.spreadMedian !== null && three.stats.spreadMedian <= 0.02, `the log carries the median per-edge spread (${three.stats.spreadMedian}) — a steady hand is under 0.02`);

  // one pass drags the hood's top edge 0.10 up into the ceiling. A MEAN of
  // three moves the merged edge by a third of that; the median does not move.
  {
    const hoodTruth = el('hood', [0.58, 0.10, 0.70, 0.42], { id: 'h' });
    const p1 = { ...hoodTruth, id: 'h1' };
    const p2 = { ...hoodTruth, id: 'h2', box: { ...hoodTruth.box, y0: hoodTruth.box.y0 + 0.002 } };
    const bad = { ...hoodTruth, id: 'h3', box: { ...hoodTruth.box, y0: hoodTruth.box.y0 - 0.10 } };
    const med = mergeInventorySamples([[p1], [p2], [bad]]).elements[0];
    const mean = (p1.box.y0 + p2.box.y0 + bad.box.y0) / 3;
    const middle = [p1, p2, bad].map((e) => e.box.y0).sort((x, y) => x - y)[1];
    check(Math.abs(med.box.y0 - middle) < 1e-9 && Math.abs(med.box.y0 - mean) > 0.03, `the outlier pass does not move the merged top edge (median ${med.box.y0}, a mean would have been ${mean.toFixed(3)})`);
  }

  // seen by 2 of 3, 1 of 3
  {
    const shared = el('stool', [0.4, 0.75, 0.5, 0.95], { id: 's', wall: 'island', confidence: 0.8 });
    const sure = el('plant', [0.9, 0.5, 0.98, 0.7], { id: 'p-sure', confidence: 0.9 });
    const unsure = el('art', [0.1, 0.1, 0.2, 0.2], { id: 'p-unsure', confidence: 0.6 });
    const r = mergeInventorySamples([[{ ...shared, id: 's1' }, sure, unsure], [{ ...shared, id: 's2' }], []]);
    const twoOfThree = r.elements.find((e) => e.id === 's1')!;
    // identical boxes agree perfectly, so the whole markdown is the √(2/3)
    check(Math.abs(twoOfThree.confidence - 0.8 * Math.sqrt(2 / 3)) < 0.002, `an element 2 of 3 passes saw keeps confidence × √(2/3) (${twoOfThree.confidence})`);
    check(twoOfThree.confidence < SINGLE_SAMPLE_MIN_CONFIDENCE, 'and is kept without meeting the single-pass floor — it was corroborated');
    const one = r.elements.find((e) => e.id === 'p-sure');
    check(!!one && Math.abs(one.confidence - 0.9 * SINGLE_SAMPLE_FACTOR) < 0.002, `an element only one of three saw, at 0.9, survives at ×${SINGLE_SAMPLE_FACTOR} (${one?.confidence})`);
    check(!r.elements.some((e) => e.id === 'p-unsure'), 'the same at 0.6 is dropped — one pass is not evidence');
  }

  // --- the items-only pass merged in
  {
    const main = [
      el('base-cabinet-run', [0.05, 0.55, 0.95, 0.8], { id: 'base' }),
      el('other', [0.40, 0.50, 0.46, 0.56], { id: 'blob' }),      // the main pass's guess at a pot
      el('item', [0.70, 0.50, 0.74, 0.55], { id: 'kettle-main' }),
    ];
    const items = [
      el('item', [0.405, 0.502, 0.462, 0.561], { id: 'item-pot', label: 'blue enamel dutch oven' }),
      el('item', [0.20, 0.51, 0.24, 0.56], { id: 'canister', label: 'ceramic canister' }),
    ];
    const merged2 = mergeItemPass(main, items);
    check(!merged2.some((e) => e.id === 'blob'), 'a main-pass "other" box the items pass corroborates is replaced by the items pass\'s');
    check(merged2.some((e) => e.id === 'item-pot') && merged2.some((e) => e.id === 'item-2-canister'), 'items keep an item- id, or gain one');
    check(merged2[0].id === 'base' && merged2.some((e) => e.id === 'kettle-main'), 'main elements come first, and an item nothing corroborates stays');
    // a cap drops items, never a base run
    const bigMain = Array.from({ length: 88 }, (_, i) => el('stool', [i / 100, 0.5, i / 100 + 0.005, 0.6], { id: `m${i}`, wall: 'island' }));
    const tenItems = Array.from({ length: 10 }, (_, i) => el('item', [i / 100, 0.2, i / 100 + 0.005, 0.25], { id: `item-${i}` }));
    const cappedItems = mergeItemPass(bigMain, tenItems);
    check(cappedItems.length === MAX_ELEMENTS && bigMain.every((e) => cappedItems.some((x) => x.id === e.id)), `${bigMain.length} main + ${tenItems.length} items → ${cappedItems.length}, every main element surviving`);
  }

  // --- detected.inventory: server-owned, survives the round trip, cleaned when the model writes it
  {
    const spec = defaultKitchen();
    spec.detected.inventory = { samples: 3, agreement: 0.84 };
    const out = reconcileSpec(spec, { photoCount: 1 });
    const parsed = RoomSpecZ.safeParse(out);
    const kept = parsed.success && parsed.data.roomType === 'kitchen' ? parsed.data.detected.inventory : null;
    check(!!kept && kept.samples === 3 && kept.agreement === 0.84, `detected.inventory survives reconcile + validation (${JSON.stringify(kept)})`);
    const raw = JSON.parse(JSON.stringify(defaultKitchen())) as { detected: Record<string, unknown> };
    raw.detected.inventory = 'three passes, pretty good';
    const report: SanitizeReport = { fixes: [] };
    const shaped = sanitizeShape(raw, 'kitchen', defaultKitchen(), report) as { detected: { inventory: unknown } };
    check(shaped.detected.inventory === null && report.fixes.some((f) => f.includes('detected.inventory')), 'a model that writes its own agreement is cleaned to null before coercion');
  }
}

// ---------------------------------------------------------------------------
console.log('\n9. Consistency rules lower confidence, never delete');
{
  const clean: PhotoElement[] = [
    el('floor', [0, 0.68, 1, 1], { id: 'floor', wall: null }),
    el('wall', [0.23, 0.086, 0.886, 0.794], { id: 'wall-back' }),
    el('wall', [0, 0.047, 0.319, 0.799], { id: 'wall-left', wall: 'left' }),
    el('base-cabinet-run', [0.32, 0.59, 0.86, 0.78], { id: 'base-back' }),
    el('upper-cabinet-run', [0.29, 0.16, 0.83, 0.49], { id: 'upper-back' }),
    el('hood', [0.58, 0.1, 0.7, 0.42], { id: 'hood-1' }),
    el('range', [0.565, 0.575, 0.685, 0.71], { id: 'range-1' }),
    el('island', [0.28, 0.556, 0.705, 0.957], { id: 'island-1', wall: 'island' }),
    el('pendant', [0.451, 0, 0.546, 0.389], { id: 'pend-1', wall: null }),
    el('plant', [0.42, 0.405, 0.609, 0.723], { id: 'plant-1', wall: 'island' }),
    el('window', [0.06, 0.173, 0.186, 0.564], { id: 'win-1', wall: 'left' }),
  ];
  const ok1 = applyConsistencyRules(clean);
  check(ok1.violations.length === 0 && ok1.elements === clean, 'a consistent inventory passes untouched (same array back)');

  const broken: PhotoElement[] = [
    el('floor', [0, 0.68, 1, 1], { id: 'floor', wall: null }),
    el('wall', [0.23, 0.086, 0.886, 0.794], { id: 'wall-back' }),
    el('wall', [0, 0.047, 0.319, 0.799], { id: 'wall-left', wall: 'left' }),
    el('base-cabinet-run', [0.32, 0.4, 0.86, 0.55], { id: 'base-floating' }),         // ends 13% above the floor
    el('upper-cabinet-run', [0.29, 0.3, 0.83, 0.62], { id: 'upper-low' }),            // reaches into the base run
    el('hood', [0.58, 0.5, 0.7, 0.8], { id: 'hood-low' }),                            // below the range top
    el('range', [0.565, 0.575, 0.685, 0.71], { id: 'range-1' }),
    el('island', [0.28, 0.556, 0.705, 0.957], { id: 'island-1', wall: 'island' }),
    el('pendant', [0.451, 0.6, 0.546, 0.99], { id: 'pend-low' }),                     // hangs below the island
    el('plant', [0.42, 0.7, 0.609, 0.99], { id: 'plant-floor', wall: 'island' }),     // "on the island" but reaches the floor
    el('window', [0.5, 0.173, 0.7, 0.564], { id: 'win-off', wall: 'left' }),          // outside the left wall's box
    el('hood', [0.05, 0.1, 0.15, 0.42], { id: 'hood-aside' }),                        // above, but not over, the range
  ];
  const r = applyConsistencyRules(broken);
  check(r.elements.length === broken.length, 'nothing deleted');
  const conf = (id: string) => r.elements.find((e) => e.id === id)!.confidence;
  const orig = (id: string) => broken.find((e) => e.id === id)!.confidence;
  for (const [id, why] of [['base-floating', 'floats above the floor'], ['upper-low', 'not above the base run'], ['hood-low', 'not above the range'], ['pend-low', 'hangs below the island'], ['plant-floor', 'not standing on the island'], ['win-off', 'outside its wall'], ['hood-aside', 'not over the range']]) {
    check(Math.abs(conf(id) - orig(id) * VIOLATION_FACTOR) < 0.002 && r.violations.some((v) => v.startsWith(`${id}:`) && v.includes(why)), `${id}: ×${VIOLATION_FACTOR} and "${why}" reported (${conf(id)})`);
  }
  for (const id of ['floor', 'wall-back', 'wall-left', 'range-1', 'island-1']) check(conf(id) === orig(id), `${id} untouched`);
  check(r.violations.length === 7, `${r.violations.length} violations in all`);
  // rules need their reference element: no floor, no wall box, no range → nothing to say
  const lonely = applyConsistencyRules([el('base-cabinet-run', [0.3, 0.2, 0.8, 0.3], { id: 'b' }), el('hood', [0.5, 0.5, 0.6, 0.9], { id: 'h' }), el('window', [0.1, 0.1, 0.2, 0.3], { id: 'w', wall: 'left' })]);
  check(lonely.violations.length === 0, 'no reference element → no violation');
  // an item on the island stands ON the top: its BASE lies inside the island's box
  {
    const island = el('island', [0.28, 0.556, 0.705, 0.957], { id: 'island-1', wall: 'island' });
    const standing = el('item', [0.45, 0.50, 0.50, 0.60], { id: 'bowl-ok', wall: 'island' });
    const floating = el('item', [0.45, 0.20, 0.50, 0.30], { id: 'bowl-air', wall: 'island' });
    const rr = applyConsistencyRules([island, standing, floating]);
    check(rr.violations.length === 1 && rr.violations[0].startsWith('bowl-air:'), `an item floating above the island is flagged, one standing on it is not (${JSON.stringify(rr.violations)})`);
    const lowered = rr.elements.find((e) => e.id === 'bowl-air')!;
    check(Math.abs(lowered.confidence - 0.9 * VIOLATION_FACTOR) < 0.002 && rr.elements.find((e) => e.id === 'bowl-ok')!.confidence === 0.9, 'its confidence is lowered, never its box, and never the one that is fine');
  }
  check(applyConsistencyRules([]).elements.length === 0, 'empty in, empty out');
}

// ---------------------------------------------------------------------------
console.log('\n10. Frame block');
{
  const f = reconcileFrame({ backWallSpansX: [0.886, 0.23], leftWallVisible: 'true', rightWallVisible: 0 });
  check(JSON.stringify(f) === JSON.stringify({ backWallSpansX: [0.23, 0.886], leftWallVisible: true, rightWallVisible: false }), `span ordered, flags coerced (${JSON.stringify(f)})`);
  check(reconcileFrame(null) === null && reconcileFrame('x') === null && reconcileFrame({ backWallSpansX: [0.5] }) === null && reconcileFrame({ backWallSpansX: ['a', 'b'] }) === null, 'missing / short / non-numeric span → null');
  check(reconcileFrame({ backWallSpansX: [0.5, 0.52] }) === null, 'a 2% back wall is a guess → null');
  const guessed = reconcileFrame({ backWallSpansX: [-1, 0.6] })!;
  check(guessed.backWallSpansX[0] === 0 && guessed.leftWallVisible === false && guessed.rightWallVisible === true, 'clamped span; missing flags follow the span (runs out of frame left, stops short right)');
  // the frame rides through reconcileSpec on detected (until the spec types carry it)
  const spec: RoomSpec = defaultKitchen();
  (spec.detected as DetectedWithFrame).frame = { backWallSpansX: [0.9, 0.2], leftWallVisible: true, rightWallVisible: true };
  const out = reconcileSpec(spec, { photoCount: 1 });
  check(JSON.stringify((out.detected as DetectedWithFrame).frame) === JSON.stringify({ backWallSpansX: [0.2, 0.9], leftWallVisible: true, rightWallVisible: true }), 'reconcileSpec keeps (and validates) detected.frame');
  check((reconcileSpec(defaultKitchen(), { photoCount: 1 }).detected as DetectedWithFrame).frame === null, 'no frame → null, never undefined');
  check(RoomSpecZ.safeParse(out).success, 'a spec with a frame still validates (zod strips the extra key)');
}

// ---------------------------------------------------------------------------
console.log('\n11. Wall labels: rotated when the frame is turned, noted when one element disagrees, spec never edited');
{
  check(rotateWall('back', 1) === 'right' && rotateWall('right', 1) === 'front' && rotateWall('front', 1) === 'left' && rotateWall('left', 1) === 'back' && rotateWall('back', 4) === 'back' && rotateWall('back', -1) === 'left', 'rotateWall walks the ring');
  // defaultKitchen: runs on back + left, fridge/range/hood/dishwasher/sink/window on back, passage right, shelves + art right
  const agreeing = (): PhotoElement[] => [
    el('base-cabinet-run', [0.3, 0.6, 0.9, 0.8], { id: 'base-back' }),
    el('base-cabinet-run', [0, 0.6, 0.3, 0.9], { id: 'base-left', wall: 'left' }),
    el('upper-cabinet-run', [0.3, 0.15, 0.9, 0.45], { id: 'upper-back' }),
    el('upper-cabinet-run', [0, 0.05, 0.3, 0.45], { id: 'upper-left', wall: 'left' }),
    el('fridge', [0.85, 0.15, 0.95, 0.8], { id: 'fridge-1' }),
    el('range', [0.55, 0.55, 0.65, 0.8], { id: 'range-1' }),
    el('hood', [0.55, 0.1, 0.65, 0.4], { id: 'hood-1' }),
    el('window', [0.35, 0.15, 0.45, 0.45], { id: 'win-1' }),
    el('sink', [0.35, 0.55, 0.45, 0.62], { id: 'sink-1' }),
    el('shelf', [0.92, 0.3, 0.99, 0.33], { id: 'shelf-1', wall: 'right' }),
    el('wall', [0.3, 0.05, 0.9, 0.8], { id: 'wall-back' }),
    el('wall', [0, 0.05, 0.3, 0.85], { id: 'wall-left', wall: 'left' }),
    el('island', [0.3, 0.6, 0.7, 0.95], { id: 'island-1', wall: 'island' }),
    el('pendant', [0.5, 0, 0.55, 0.3], { id: 'pend-1', wall: null }),
  ];
  const withEls = (elements: PhotoElement[]): RoomSpec => { const s = defaultKitchen(); s.detected.elements = elements; return s; };
  const agreed = reconcileSpec(withEls(agreeing()), { photoCount: 1 });
  check(!agreed.detected.notes.some((n) => /labelled on|turned/.test(n)), `agreeing labels → no wall notes (${JSON.stringify(agreed.detected.notes.filter((n) => n.startsWith('inventory:')))})`);
  check(agreed.detected.elements.every((e, i) => e.wall === agreeing()[i].wall), 'agreeing labels untouched');

  // the whole inventory turned one quarter: the annotator called the spec's LEFT wall "back"
  const turned = agreeing().map((e) => (e.wall && e.wall !== 'island' ? { ...e, wall: rotateWall(e.wall, -1) } : e));
  const fixes: string[] = [];
  const spun = reconcileSpec(withEls(turned), { photoCount: 1, fixes });
  const spunSpec = spun.roomType === 'kitchen' ? spun : null;
  check(spun.detected.elements.every((e, i) => e.wall === agreeing()[i].wall), 'labels rotated back onto the spec\'s frame');
  check(spun.detected.notes.some((n) => n.includes('turned 1 quarter-turn')), `rotation noted (${JSON.stringify(spun.detected.notes.filter((n) => n.includes('turned')))})`);
  check(fixes.some((f) => f.includes('turned 1 quarter-turn')), 'rotation in the fixes list');
  check(spunSpec?.runs.map((r) => r.wall).join(',') === 'back,left' && spunSpec.appliances.every((a) => a.wall === 'back'), 'the SPEC is not rotated');
  check(spun.detected.elements.find((e) => e.id === 'wall-back')?.wall === 'back' && spun.detected.elements.find((e) => e.id === 'wall-left')?.wall === 'left', 'wall-kind boxes turn with the rest (the fitter never pairs a wall box across names)');
  // pure + repeatable
  const direct = reconcileElementWalls(withEls(turned), null);
  check(direct.rotation === 1 && direct.elements.every((e, i) => e.wall === agreeing()[i].wall), 'reconcileElementWalls: rotation 1, elements rotated');
  check(JSON.stringify(reconcileElementWalls(withEls(turned), null)) === JSON.stringify(direct), 'deterministic');

  // one element on another wall, FACING into the room: the fridge at the far right labelled 'right' with its doors turned
  // left while the spec has it at t 0.93 on the back wall → the spec's fridge MOVES (the walls pass; check-walls.ts goes deeper)
  const corner = agreeing().map((e) => (e.id === 'fridge-1' ? { ...e, wall: 'right' as const, facing: 'left' as const, box: { x0: 0.9, y0: 0.15, x1: 0.99, y1: 0.85 } } : e));
  const cornerSpec = withEls(corner);
  (cornerSpec.detected as DetectedWithFrame).frame = { backWallSpansX: [0.25, 0.88], leftWallVisible: true, rightWallVisible: true };
  const movedSpec = reconcileSpec(cornerSpec, { photoCount: 1 });
  const moveNote = movedSpec.detected.notes.find((n) => n.startsWith('inventory: fridge moved to the right wall'));
  check(Boolean(moveNote) && moveNote!.includes('turned into the room'), `a fridge facing into the room from the right wall moves the spec's fridge there (${moveNote})`);
  check(movedSpec.roomType === 'kitchen' && movedSpec.appliances.find((a) => a.kind === 'fridge')?.wall === 'right' && movedSpec.runs.some((r) => r.wall === 'right'), 'the spec\'s fridge is on the right wall, in a run on that wall');
  check(!movedSpec.detected.notes.some((n) => n.startsWith('inventory: fridge labelled')), 'no disagreement note once the spec agrees');
  check(!movedSpec.detected.notes.some((n) => n.includes('quarter-turn')), 'no rotation for one element');
  check(movedSpec.detected.elements.find((e) => e.id === 'fridge-1')?.wall === 'right', 'the label stays as the photo said');
  // the same box with NO facing and only middling confidence is a note, never a move: the spec's fridge stays
  const unsure = agreeing().map((e) => (e.id === 'fridge-1' ? { ...e, wall: 'right' as const, confidence: 0.6, box: { x0: 0.9, y0: 0.15, x1: 0.99, y1: 0.85 } } : e));
  const unsureSpec = withEls(unsure);
  (unsureSpec.detected as DetectedWithFrame).frame = { backWallSpansX: [0.25, 0.88], leftWallVisible: true, rightWallVisible: true };
  const noted = reconcileSpec(unsureSpec, { photoCount: 1 });
  const fridgeNote = noted.detected.notes.find((n) => n.startsWith('inventory: fridge labelled on the right wall'));
  check(Boolean(fridgeNote), `single disagreement without a facing is noted (${fridgeNote})`);
  check(Boolean(fridgeNote?.includes('a corner')) && Boolean(fridgeNote?.includes('agrees with the label')), 'note says it is a corner and that the frame agrees with the label');
  check(!noted.detected.notes.some((n) => n.includes('turned')), 'no rotation for one element');
  check(noted.detected.elements.find((e) => e.id === 'fridge-1')?.wall === 'right', 'the label stays as the photo said');
  check(noted.roomType === 'kitchen' && noted.appliances.find((a) => a.kind === 'fridge')?.wall === 'back', 'the spec\'s fridge stays on the back wall (no facing, confidence below the label threshold)');
  // a disagreement that is not a corner reads as such
  const mid = agreeing().map((e) => (e.id === 'range-1' ? { ...e, wall: 'left' as const } : e));
  const midNote = reconcileSpec(withEls(mid), { photoCount: 1 }).detected.notes.find((n) => n.startsWith('inventory: range labelled on the left wall'));
  check(Boolean(midNote) && midNote!.includes('spec draws it on the back wall') && !midNote!.includes('corner'), `mid-wall disagreement (${midNote})`);
  // two elements out of many never spin the room
  const two = agreeing().map((e) => (e.id === 'fridge-1' || e.id === 'range-1' ? { ...e, wall: 'right' as const } : e));
  check(reconcileElementWalls(withEls(two), null).rotation === 0, 'two of eleven disagreeing → no rotation');
  // exteriors and bare inventories are left alone
  const ext = defaultExterior();
  ext.detected.elements = [el('window', [0.1, 0.3, 0.2, 0.5], { id: 'w', wall: 'left' }), el('door', [0.4, 0.5, 0.5, 0.8], { id: 'd', wall: 'left' })];
  const extOut = reconcileElementWalls(ext, null);
  check(extOut.rotation === 0 && extOut.notes.length === 0 && extOut.elements === ext.detected.elements, 'exterior: untouched');
  check(reconcileElementWalls(defaultKitchen(), null).elements.length === 0, 'no elements → nothing');
}

// ---------------------------------------------------------------------------
// Truncation: `open` / `openCause` merged per EDGE by majority (brief-FIT §4)
// ---------------------------------------------------------------------------
{
  console.log('\ntruncation: open edges merge by majority');
  const NONE = { left: false, right: false, top: false, bottom: false };
  // a box the frame cannot have cut, so `resolveOpen`'s frame inference cannot
  // supply the answer and only the merge can
  const at = (id: string, open: Partial<typeof NONE>, cause: PhotoElement['openCause'], confidence = 0.8): PhotoElement =>
    el('island', [0.2, 0.5, 0.6, 0.9], { id, wall: 'island', confidence, open: { ...NONE, ...open }, openCause: cause });

  const twoOfThree = mergeInventorySamples([[at('i-a', { left: true }, 'occluded')], [at('i-b', { left: true }, 'occluded')], [at('i-c', {}, null)]]).elements[0];
  check(twoOfThree.open?.left === true, 'two passes of three saying the left edge is cut → cut');
  check(twoOfThree.openCause === 'occluded', `and the cause comes from the surest member that named one (${twoOfThree.openCause})`);

  const oneOfThree = mergeInventorySamples([[at('j-a', { left: true }, 'occluded')], [at('j-b', {}, null)], [at('j-c', {}, null)]]).elements[0];
  check(oneOfThree.open?.left === false, 'one pass of three → not cut');
  check(oneOfThree.openCause === null, 'and with nothing open the cause is null — "nothing is cut" keeps one spelling');

  // per EDGE, not per element: the passes agree about the left and disagree about the right
  const perEdge = mergeInventorySamples([
    [at('k-a', { left: true, right: true }, 'occluded')],
    [at('k-b', { left: true }, 'occluded')],
    [at('k-c', { left: true }, 'occluded')],
  ]).elements[0];
  check(perEdge.open?.left === true && perEdge.open?.right === false, `each edge votes on its own (${JSON.stringify(perEdge.open)})`);

  // 'both' is the union of two facts and survives any member carrying it
  const both = mergeInventorySamples([[at('l-a', { left: true }, 'occluded', 0.9)], [at('l-b', { left: true }, 'both', 0.5)]]).elements[0];
  check(both.openCause === 'both', "a member saying 'both' wins over a surer one saying 'occluded' — it is the union, not a rival reading");

  // a cluster only one pass saw keeps its own flags
  const solo = mergeInventorySamples([[at('m-a', { right: true }, 'occluded', 0.95)], []]).elements[0];
  check(solo.open?.right === true && solo.openCause === 'occluded', 'a single-pass element carries its truncation through unchanged');

  // the items pass carries them too
  {
    const main = [el('other', [0.40, 0.50, 0.46, 0.56], { id: 'blob' })];
    const items = [el('item', [0.405, 0.502, 0.462, 0.561], { id: 'item-pot', label: 'pot', open: { ...NONE, left: true }, openCause: 'occluded' })];
    const m = mergeItemPass(main, items).find((e) => e.id === 'item-pot');
    check(m?.open?.left === true && m?.openCause === 'occluded', 'mergeItemPass carries open / openCause through');
  }

  // and an open edge is not a consistency violation: a half-visible run is not a wrong run
  {
    const floor = el('floor', [0, 0.6, 1, 1], { id: 'floor', wall: null });
    const base = el('base-cabinet-run', [0.1, 0.3, 0.5, 0.5], { id: 'base', wall: 'back' });
    const cut = { ...base, open: { ...NONE, bottom: true }, openCause: 'occluded' as const };
    const plain = applyConsistencyRules([floor, base]);
    const open = applyConsistencyRules([floor, cut]);
    check(plain.violations.some((v) => /floats above the floor/.test(v)), 'a run floating above the floor is still flagged');
    check(open.violations.length === 0, 'the same run whose bottom edge is CUT is not — the box stops where the view does');
  }
}

// ---------------------------------------------------------------------------
// THE CONTAMINATED ISLAND BOX — the client's "js a square small island".
// `repairIslandTops` (reconcile.ts) trims an island box whose top edge is
// above the back run's counter line: the island stands in FRONT of that run,
// and a camera above both counters sees the nearer one LOWER in the frame, so
// such a box has swallowed the vases and bowls standing on the island.
// ---------------------------------------------------------------------------
{
  console.log('\nisland boxes: a top edge above the back run\'s counter is the vases, not the island');
  // eye height, in feet: every call has to state one, because the whole rule
  // reverses below the counters. 5 ft is a standing photographer.
  const STANDING = 5;
  const run = el('base-cabinet-run', [0.32, 0.59, 0.86, 0.78], { id: 'base-back', wall: 'back' });
  const trimTo = (box: [number, number, number, number], eyeFt: number | null = STANDING) => {
    const notes: string[] = [];
    const out = reconcileElements([run, el('island', box, { id: 'island-1', wall: 'island' })], { photoCount: 1, fixes: notes }, eyeFt);
    return { y0: out.find((e) => e.kind === 'island')!.box.y0, notes };
  };
  // one counter slab above the run's box top is the LIMIT: the run's box stops
  // at the counter's underside, the island's at the top of its slab
  const limit = 0.59 - (0.78 - 0.59) * (1.5 / 34.5);
  const swallowed = trimTo([0.28, 0.5, 0.705, 0.957]);
  check(Math.abs(swallowed.y0 - limit) < 5e-4, `a box drawn up over the island's styling is trimmed to the counter line (0.5 → ${swallowed.y0}, limit ${limit.toFixed(3)})`);
  check(swallowed.notes.some((n) => n.includes('trimmed the island-1 box') && n.includes('back run')), `and says why, in a note the studio can show (${swallowed.notes.find((n) => n.includes('trimmed')) ?? 'none'})`);
  const legal = trimTo([0.28, 0.66, 0.705, 0.957]);
  check(legal.y0 === 0.66 && legal.notes.length === 0, `a box already below the counter line is left exactly alone (${legal.y0})`);
  // the premise has to be VISIBLE in the boxes: an "island" whose floor line is
  // no lower than the run's is not demonstrably in front of it, so say nothing
  const behind = trimTo([0.28, 0.5, 0.705, 0.7]);
  check(behind.y0 === 0.5 && behind.notes.length === 0, 'and a box that is not visibly nearer than the run is never touched — the bound assumes an aisle it can see');
  // …and with no back run to measure against there is no bound at all
  const alone = reconcileElements([el('island', [0.28, 0.5, 0.705, 0.957], { id: 'island-1', wall: 'island' })], undefined, STANDING);
  check(alone[0].box.y0 === 0.5, 'no back run in the inventory → nothing to compare with, box untouched');

  // THE PREMISE ITSELF, asserted rather than assumed. "A camera above them
  // sees the nearer plane lower in the frame" is only true above them: at an
  // eye height BELOW the counters the two planes are seen from underneath and
  // the ordering reverses, so a perfectly drawn island box sits above the
  // run's counter line and the trim above would eat it.
  {
    const spec = defaultKitchen() as KitchenSpec;
    spec.dims = { ...spec.dims, widthFt: 16, depthFt: 16 };
    spec.island = { ...spec.island, present: true, lengthFt: 8, widthFt: 3.4, offset: { x: 0, z: 1.5 }, seating: 0, endSeats: 0 };
    const els = kitchenElementBoxes(computeKitchenLayout(spec));
    // at the front wall, pitched a little down so BOTH floor lines stay in
    // frame at every height — the boxes below are ground truth, not guesses
    const shot = (eyeFt: number): PhotoElement[] => {
      const cam: SolvedCamera = { x: 0, y: ft(eyeFt), z: ft(spec.dims.depthFt) / 2 - 0.3, yawDeg: 0, pitchDeg: 4, fovDeg: 62, aspect: 4 / 3, score: 0 };
      const pin = makeCamera(cam);
      const out: PhotoElement[] = [];
      els.forEach((e) => {
        if (e.kind !== 'island' && !(e.kind === 'base-cabinet-run' && e.wall === 'back')) return;
        const b = projectElement(pin, e);
        if (!b) return;
        out.push({ id: e.kind === 'island' ? 'island-1' : 'base-back', kind: e.kind, wall: e.wall, box: { x0: b[0], y0: b[1], x1: b[2], y1: b[3] }, facing: null, label: e.kind, confidence: 0.9 });
      });
      return out;
    };
    const islandY0 = (v: PhotoElement[]) => v.find((e) => e.kind === 'island')!.box.y0;
    for (const eyeFt of [1.6, 2, 2.4, 2.8]) {
      const truth = shot(eyeFt);
      const drawn = islandY0(truth);
      const ref = truth.find((e) => e.kind === 'base-cabinet-run')!;
      const above = drawn < ref.box.y0 - (ref.box.y1 - ref.box.y0) * (1.5 / 34.5);
      // compared against the SAME inventory with the repair refused outright,
      // so the only difference either way is the repair — never the rounding
      // and clamping every box gets on the way through
      const asDrawn = islandY0(reconcileElements(structuredClone(truth), undefined, null));
      const kept = islandY0(reconcileElements(structuredClone(truth), undefined, eyeFt));
      const unguarded = islandY0(reconcileElements(structuredClone(truth), undefined, STANDING));
      console.log(`    eye ${eyeFt} ft: truth island y0 ${drawn.toFixed(3)}, breaks the bound ${above}, kept ${kept.toFixed(3)} (a 5 ft eye would have written ${unguarded.toFixed(3)})`);
      check(above, `at ${eyeFt} ft the ordering is REVERSED — a CORRECT island box sits above the run's counter line (${drawn.toFixed(3)})`);
      check(kept === asDrawn, `and the repair refuses to touch it, because the eye is below the counters (${kept.toFixed(3)})`);
      check(unguarded > asDrawn, `while an unchecked premise would have thrown ${((unguarded - asDrawn) * 100).toFixed(1)}% of the frame away`);
    }
    // …and from a standing height the same scene is drawn the other way round,
    // so the guard costs the repair nothing where it belongs
    const high = shot(5);
    const ref = high.find((e) => e.kind === 'base-cabinet-run')!;
    check(islandY0(high) > ref.box.y0, `from 5 ft the same island's correct box is BELOW the run's box top (${islandY0(high).toFixed(3)} > ${ref.box.y0.toFixed(3)})`);
    check(islandY0(reconcileElements(structuredClone(high), undefined, 5)) === islandY0(reconcileElements(structuredClone(high), undefined, null)), 'and is left alone there too — the bound only ever bites a box that broke it');
  }
  // an eye nobody measured is not evidence either
  check(trimTo([0.28, 0.5, 0.705, 0.957], null).y0 === 0.5, 'no camera height in the spec → no repair, because the premise cannot be checked');
  check(trimTo([0.28, 0.5, 0.705, 0.957], 3.4).y0 === 0.5, 'and an eye within half a foot of the counters is refused too — there both planes sit on the horizon');

  // the fixture the client complained about. Its island box runs from a vase
  // standing on the counter (0.504) to the bottom of the picture; the counter's
  // far edge measures 0.603 on the photo's own pixels. The bound is the weakest
  // safe one, so it recovers a third of that — every part the boxes prove.
  const tan = JSON.parse(readFileSync(new URL('./fixtures/client-tan.spec.json', import.meta.url), 'utf8')) as RoomSpec;
  const tanIsland = (els: PhotoElement[]) => els.find((e) => e.kind === 'island')!.box.y0;
  const before = tanIsland(tan.detected.elements as PhotoElement[]);
  const tanEyeFt = (tan.detected.camera.solved?.y ?? 0) / ft(1);
  const after = tanIsland(reconcileElements(structuredClone(tan.detected.elements), undefined, tanEyeFt));
  console.log(`    client-tan island top: boxed ${before}, repaired ${after}, measured on the photo 0.603 (eye ${tanEyeFt.toFixed(1)} ft)`);
  check(tanEyeFt >= 3.5, `and the photographer really did stand above the counters (${tanEyeFt.toFixed(1)} ft), which is what lets the repair read this box at all`);
  check(before === 0.504 && after > before, `client-tan's island box is trimmed toward the counter (${before} → ${after})`);
  check(after <= 0.603 + 1e-9, 'never past the edge the pixels measure — the bound only ever gives back what it can prove');
  check(after - before > 0.02, `and it is worth having: ${Math.round(((after - before) / (0.603 - before)) * 100)}% of the error, from the boxes alone`);
  // …and the whole spec path agrees, since that is what the studio runs
  const viaSpec = reconcileSpec(structuredClone(tan), { photoCount: 1, fixes: [] }) as RoomSpec;
  check(tanIsland(viaSpec.detected.elements) === after, `reconcileSpec finds the same camera and makes the same repair (${tanIsland(viaSpec.detected.elements)})`);
}

// ---------------------------------------------------------------------------
// BATHROOM BOXES — every convention the inventory prompt asks for has a box on
// the twin, drawn off the SOLVED layout. The bathroom's fit levers were dead
// weight while these were missing: a lever that cannot move a projected box is
// a search dimension with no gradient, so each one is asserted here as "this
// spec field moves this box", not merely "this box exists".
// ---------------------------------------------------------------------------
{
  console.log('\nbathroom boxes: the conventions the prompt asks for are the boxes the twin draws');
  const WALLS: Wall[] = ['back', 'left', 'right', 'front'];
  const bath = (mutate: (b: BathroomSpec) => void = () => {}): BathroomSpec => {
    const b = defaultBathroom() as BathroomSpec;
    mutate(b);
    return b;
  };
  const boxesOf = (b: BathroomSpec) => bathroomElementBoxes(computeBathroomLayout(b));
  const of = (b: BathroomSpec, kind: PhotoElement['kind']) => boxesOf(b).filter((e) => e.kind === kind);

  // 1. THE TILE STOP LINE. `boxes.ts` cannot import RoomShell (a 'use client'
  //    module would drag @react-three/fiber into /api/fit), so it carries a
  //    copy — and a copy is a lie the moment one side moves. Assert them equal
  //    over every category, with and without a measured stop.
  {
    let worst = 0;
    let cases = 0;
    for (const height of ['none', 'wainscot', 'shower-only', 'full', 'accent-wall'] as const) {
      for (const heightIn of [null, 30, 54, 200]) {
        for (const accent of [null, { wall: 'right' as Wall, pattern: 'hex' as const, moduleIn: null, heightIn: 72, colorHex: null }]) {
          const b = bath((x) => { x.wallTile = { ...x.wallTile, height, heightIn, accent }; });
          const L = computeBathroomLayout(b);
          for (const wall of WALLS) { worst = Math.max(worst, Math.abs(tileTopOn(L, wall) - tileHeightFor(L, wall))); cases++; }
        }
      }
    }
    check(worst < 1e-12, `the twin's tile stop line equals RoomShell's on all ${cases} (category × measured stop × accent × wall) cases (worst ${worst})`);
  }

  // 2. THE TILE FIELD. Its top edge is where the TILE stops, never where the
  //    wall does — the whole point of the box — and an opening standing in the
  //    band breaks it in two, exactly as the prompt tells the annotator.
  {
    const b = bath((x) => {
      x.wallTile = { ...x.wallTile, height: 'wainscot', heightIn: 54, accent: null };
      x.openings = [{ ...x.openings[0], kind: 'door', wall: 'front', t: 0.5, widthFt: 2.6, heightFt: 6.8, sillFt: 0, style: x.openings[0].style }];
    });
    const L = computeBathroomLayout(b);
    const field = of(b, 'backsplash');
    const top = Math.max(...field.map((e) => e.box.max[1]));
    check(field.length > 0 && Math.abs(top - inch(54)) < 1e-9, `a 54" wainscot's field boxes stop at 54", not at the ${(L.h / inch(1)).toFixed(0)}" ceiling (${(top / inch(1)).toFixed(1)}")`);
    check(field.every((e) => e.box.min[1] < 0.01), 'and every field box starts at the floor line');
    const front = field.filter((e) => e.wall === 'front');
    check(front.length === 2, `a door standing in the band breaks the front wall's field into two boxes (${front.length})`);
    const taller = of(bath((x) => { x.wallTile = { ...x.wallTile, height: 'wainscot', heightIn: 72, accent: null }; }), 'backsplash');
    check(Math.max(...taller.map((e) => e.box.max[1])) > top + 0.4, 'wallTile.heightIn moves that top edge — the lever the field box exists for');
    check(of(bath((x) => { x.wallTile = { ...x.wallTile, height: 'none', accent: null }; }), 'backsplash').length === 0, 'an untiled bathroom has no field box at all');
  }

  // 3. THE NICHE and 4. THE CURB, both inside the stall, both off the layout.
  {
    const withStall = (mut: (b: BathroomSpec) => void = () => {}) => bath((x) => {
      x.shower = { ...x.shower, present: true, curbless: false, curbHeightIn: 4, niche: true, nicheAt: { face: 'back', t: 0.5, centerIn: 48, widthIn: 24, heightIn: 14, shelves: 1 } };
      mut(x);
    });
    const b = withStall();
    const L = computeBathroomLayout(b);
    const stall = L.shower!;
    const shelves = of(b, 'shelf');
    const niche = shelves.find((e) => Math.abs(e.box.max[1] - e.box.min[1] - inch(14)) < 1e-6);
    check(!!niche, `the niche is a shelf box of its own (${shelves.length} shelf boxes in the room)`);
    if (niche) {
      const across = Math.max(niche.box.max[0] - niche.box.min[0], niche.box.max[2] - niche.box.min[2]);
      check(Math.abs(across - inch(24)) < 1e-6, `and it is nicheAt.widthIn wide (${(across / inch(1)).toFixed(1)}" of 24")`);
      const centre = (niche.box.min[1] + niche.box.max[1]) / 2;
      check(Math.abs(centre - inch(48)) < 1e-6, `and centred at nicheAt.centerIn (${(centre / inch(1)).toFixed(1)}" of 48")`);
    }
    const curb = shelves.find((e) => e.box.min[1] < 0.001 && e.box.max[1] < 0.3);
    check(!!curb && Math.abs(curb.box.max[1] - stall.curbHeight) < 1e-9, `the curb is a shelf box from the floor to the SOLVED curb height (${curb ? (curb.box.max[1] / inch(1)).toFixed(1) : 'missing'}" of ${(stall.curbHeight / inch(1)).toFixed(1)}")`);
    const curbless = of(withStall((x) => { x.shower = { ...x.shower, curbless: true }; }), 'shelf');
    check(!curbless.some((e) => e.box.min[1] < 0.001 && e.box.max[1] < 0.3), 'a curbless threshold draws no curb box — the same condition Shower.tsx draws on');
    const taller = of(withStall((x) => { x.shower = { ...x.shower, curbHeightIn: 8 }; }), 'shelf').find((e) => e.box.min[1] < 0.001 && e.box.max[1] < 0.3);
    check(!!taller && !!curb && taller.box.max[1] > curb.box.max[1] + 0.05, 'and shower.curbHeightIn moves its top edge');
  }

  // 5. THE FITTINGS. One box per accessory, of the METAL: the run along the
  //    wall is its width, the box is at the height it is screwed up at, and a
  //    ring hangs BELOW its rose (which is the shape of a ring).
  {
    const b = bath((x) => {
      x.accessories = [
        { kind: 'towel-bar', wall: 'back', t: 0.3, heightFt: 4, widthIn: 24, finish: null },
        { kind: 'towel-ring', wall: 'back', t: 0.7, heightFt: 4.2, widthIn: 6, finish: null },
        { kind: 'corner-shelf', wall: 'left', t: 0.8, heightFt: 4.5, widthIn: 10, finish: null },
      ];
    });
    const bars = of(b, 'towel-bar');
    check(bars.length === 2, `a bar and a ring are two towel-bar boxes; the corner shelf is a shelf (${bars.length})`);
    const bar = bars.find((e) => Math.abs(e.box.max[0] - e.box.min[0] - inch(24)) < 1e-6);
    check(!!bar, 'the bar box is as long as the bar');
    check(!!bar && Math.abs((bar.box.min[1] + bar.box.max[1]) / 2 - ft(4)) < 1e-6, 'and centred on the height it is mounted at');
    const ring = bars.find((e) => e !== bar);
    check(!!ring && ring.box.min[1] < ft(4.2) - 0.1 && ring.box.max[1] < ft(4.2) + 0.05, 'the ring hangs below its rose rather than being centred on it');
    const higher = of(bath((x) => { x.accessories = [{ kind: 'towel-bar', wall: 'back', t: 0.3, heightFt: 5.5, widthIn: 24, finish: null }]; }), 'towel-bar')[0];
    check(!!bar && higher.box.min[1] > bar.box.max[1], 'and moving accessories[].heightFt moves the box');
  }

  // 6. THE TUB. Its top is the rim the layout SOLVED, not a per-kind constant:
  //    that constant is what made `tub.heightIn` unmeasurable.
  {
    for (const kind of ['alcove', 'freestanding', 'clawfoot'] as const) {
      const b = bath((x) => { x.tub = { ...x.tub, present: true, kind, heightIn: null }; });
      const L = computeBathroomLayout(b);
      const tub = of(b, 'tub')[0];
      check(!!tub && Math.abs(tub.box.max[1] - L.tub!.rimHeight) < 1e-9, `a ${kind} tub's box top is its drawn rim (${(tub.box.max[1] / inch(1)).toFixed(1)}" = rimHeight)`);
    }
    const low = of(bath((x) => { x.tub = { ...x.tub, present: true, kind: 'alcove', heightIn: 16 }; }), 'tub')[0];
    const high = of(bath((x) => { x.tub = { ...x.tub, present: true, kind: 'alcove', heightIn: 28 }; }), 'tub')[0];
    check(high.box.max[1] > low.box.max[1] + 0.25, `and tub.heightIn moves it (${(low.box.max[1] / inch(1)).toFixed(1)}" → ${(high.box.max[1] / inch(1)).toFixed(1)}")`);
  }

  // 7. THE VANITY'S COUNTER. The slab is its own face, at the thickness the
  //    layout solved — the outline a photo draws is the TOP's footprint with
  //    the carcase standing back from it.
  {
    const b = bath((x) => { x.vanity = { ...x.vanity, present: true, counterThicknessIn: 3 }; });
    const L = computeBathroomLayout(b);
    const v = of(b, 'vanity')[0];
    check(!!v && !!v.faces && v.faces.length === 2, 'the vanity carries its counter and its carcase as two faces');
    const slab = v.faces![0];
    check(Math.abs(slab.max[1] - slab.min[1] - inch(3)) < 1e-9, `the counter face is counterThicknessIn thick (${((slab.max[1] - slab.min[1]) / inch(1)).toFixed(2)}" of 3")`);
    check(Math.abs(slab.max[1] - L.vanity!.topH) < 1e-9, 'and its top is the finished counter height');
    const body = v.faces![1];
    const slabD = Math.max(slab.max[0] - slab.min[0], slab.max[2] - slab.min[2]);
    const bodyD = Math.max(body.max[0] - body.min[0], body.max[2] - body.min[2]);
    check(bodyD < slabD, 'the carcase stands back from the slab it is under');
  }

  // 8. EVERY BOX STILL INSIDE THE ROOM, on the demo fixture (the spec that
  //    sets every bathroom field) as well as the default.
  {
    const demo = JSON.parse(readFileSync(new URL('./fixtures/demo-bathroom.spec.json', import.meta.url), 'utf8')) as BathroomSpec;
    for (const [name, spec] of [['default', defaultBathroom() as BathroomSpec], ['demo fixture', demo]] as const) {
      const L = computeBathroomLayout(spec);
      const els = bathroomElementBoxes(L);
      const problems = checkBoxes(els, L.w, L.d, L.h);
      check(problems.length === 0, `${name}: ${els.length} boxes, all finite and inside the room${problems.length ? ` — ${problems.join('; ')}` : ''}`);
    }
  }

  // 9. THE PROMPT asks for exactly these, and the KITCHEN's prompt is
  //    untouched — the bathroom block is appended, never woven in.
  {
    const bp = buildInventoryPrompt('bathroom', 4 / 3, {});
    const kp = buildInventoryPrompt('kitchen', 4 / 3, {});
    check(bp.includes('BATHROOM BOXES'), 'the bathroom inventory prompt carries the bathroom box conventions');
    check(/backsplash \(the wall TILE field\)/.test(bp), 'and lists the tile field among the kinds it may use');
    for (const phrase of ['where the TILE STOPS', 'recessed shampoo niche', 'tiled shower curb', 'EVERY wall-mounted fitting']) {
      check(bp.includes(phrase), `the tile field / niche / curb / fitting convention is spelled out ("${phrase}")`);
    }
    check(!kp.includes('BATHROOM BOXES') && !kp.includes('tiled shower curb'), 'and the kitchen prompt does not carry one word of it');
  }
}

// ---------------------------------------------------------------------------
async function verifyAnalysisLifecycle() {
  console.log('\nAnalysis lifecycle: one photo frame, no model-authored measurements, no orphan annotation calls');
  const savedKey = process.env.OPENAI_API_KEY;
  const savedHeadStart = process.env.INVENTORY_HEAD_START_MS;
  process.env.OPENAI_API_KEY = 'offline-test-no-network';
  process.env.INVENTORY_HEAD_START_MS = '0';
  const client = openaiClient();
  const create = client.responses.create;
  const photos = [
    { url: 'data:image/png;base64,aQ==', width: 1000, height: 1000 },
    { url: 'data:image/png;base64,ag==', width: 1200, height: 800, primary: true },
  ];
  type RequestBody = { text?: { format?: { name?: string } }; input?: unknown };
  try {
    let mainPrompt = '';
    const modelSpec = defaultKitchen();
    modelSpec.detected.primaryPhotoIndex = 0;
    modelSpec.detected.measurements = { widthFt: 79, depthFt: 79, ceilingFt: 19, confirmedAt: '2026-09-09T12:00:00Z' };
    client.responses.create = (async (body: RequestBody) => {
      const isInventory = body.text?.format?.name === 'photo_inventory';
      if (!isInventory) mainPrompt = JSON.stringify(body.input);
      return { status: 'completed', output_text: JSON.stringify(isInventory ? { aspect: 1.5, elements: [], frame: null } : modelSpec) };
    }) as unknown as typeof create;
    const result = await analyzeRoomDetailed({ roomType: 'kitchen', photos });
    check(mainPrompt.includes('set detected.primaryPhotoIndex to 1'), 'the actual model request selects the user primary view');
    check(result.spec.detected.primaryPhotoIndex === 1 && result.inventory.photoIndex === 1 && result.inventory.aspect === 1.5, 'returned spec, inventory frame and aspect refer to the same user-selected image');
    check(result.photos.filter((p) => p.primary).length === 1 && result.photos[1].primary === true, 'analysis returns one matching primary upload record');
    check(result.spec.detected.measurements === null, 'model-generated measurement claims cannot establish human confirmation locks');

    // The real inventory took42.5s: with the old default0, its correct two
    // cases never reached the reconstruction model. Delay the mock so this
    // proves ordering, not merely that a pre-resolved promise can be read.
    delete process.env.INVENTORY_HEAD_START_MS;
    check(inventoryHeadStartMs() === 60_000, 'semantic inventory gets a bounded60-second handoff by default');
    check(inventoryPromptWaitMs(10_000) === 50_000 && inventoryPromptWaitMs(70_000) === 0, 'preparation time reduces the wait to reserve210seconds of the shared270-second budget');
    const caseElements: PhotoElement[] = [
      {id: 'wood-case', kind: 'shelf', wall: 'left', facing: 'right', box: {x0:0.05,y0:0.12,x1:0.18,y1:0.7}, confidence:0.95, label:'wood enclosed display case'},
      {id: 'white-case', kind: 'shelf', wall: 'back', facing: 'front', box: {x0:0.72,y0:0.28,x1:0.88,y1:0.5}, confidence:0.95, label:'white enclosed display case'},
    ];
    let annotationsDone = 0, mainSawAnnotations = false;
    client.responses.create = (async (body: RequestBody) => {
      if (body.text?.format?.name === 'photo_inventory') {
        await new Promise(resolve => setTimeout(resolve, 15));
        annotationsDone++;
        return {status:'completed', output_text:JSON.stringify({aspect:1.5, elements:caseElements, frame:null})};
      }
      mainSawAnnotations = annotationsDone >= 3;
      mainPrompt = JSON.stringify(body.input);
      return {status:'completed', output_text:JSON.stringify(modelSpec)};
    }) as unknown as typeof create;
    const informed = await analyzeRoomDetailed({roomType:'kitchen', photos});
    check(mainSawAnnotations && informed.inventory.inPrompt && mainPrompt.includes('white enclosed display case') && mainPrompt.includes('wood enclosed display case') && mainPrompt.includes('2 shelf'), 'a delayed successful inventory supplies both semantic case observations and their count to the actual main request');

    let mainAfterFailure = 0;
    client.responses.create = (async (body: RequestBody) => {
      if (body.text?.format?.name === 'photo_inventory') throw new Error('offline inventory unavailable');
      mainAfterFailure++;
      return {status:'completed', output_text:JSON.stringify(modelSpec)};
    }) as unknown as typeof create;
    const failureStarted = Date.now();
    const unassisted = await analyzeRoomDetailed({roomType:'kitchen', photos});
    check(mainAfterFailure === 1 && !unassisted.inventory.inPrompt && Date.now() - failureStarted < 2000, 'failed inventory starts the ordinary reconstruction promptly instead of consuming its60-second wait');

    const waitingCancel = new AbortController();
    let cancelledAnnotations = 0, mainAfterCancel = 0, waitingStarted = 0;
    client.responses.create = (async (body: RequestBody, options?: {signal?:AbortSignal}) => {
      if (body.text?.format?.name !== 'photo_inventory') { mainAfterCancel++; throw new Error('main must not start after cancellation'); }
      waitingStarted++;
      return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => {cancelledAnnotations++; reject(new DOMException('Cancelled', 'AbortError'));}, {once:true}));
    }) as unknown as typeof create;
    const waiting = analyzeRoomDetailed({roomType:'kitchen', photos, signal:waitingCancel.signal}).then(() => false, () => true);
    while (waitingStarted < 5) await new Promise(resolve => setTimeout(resolve, 0));
    waitingCancel.abort();
    check(await waiting, 'client cancellation interrupts the semantic inventory handoff');
    check(mainAfterCancel === 0 && cancelledAnnotations === 5, 'cancelling the inventory wait aborts all annotations and starts no main provider call');
    process.env.INVENTORY_HEAD_START_MS = '0';
    check(inventoryHeadStartMs() === 0 && inventoryPromptWaitMs(0) === 0, 'explicit zero preserves the parallel speed escape hatch');

    let started = 0, aborted = 0;
    client.responses.create = (async (body: RequestBody, options?: { signal?: AbortSignal }) => {
      if (body.text?.format?.name !== 'photo_inventory') throw new Error('offline injected analysis failure');
      started++;
      return new Promise((_, reject) => {
        const cancel = () => { aborted++; reject(new Error('offline annotation aborted')); };
        if (options?.signal?.aborted) cancel();
        else options?.signal?.addEventListener('abort', cancel, { once: true });
      });
    }) as unknown as typeof create;
    let failed = false;
    try { await analyzeRoomDetailed({ roomType: 'kitchen', photos }); } catch { failed = true; }
    await new Promise((resolve) => setTimeout(resolve, 0));
    check(failed && started === 5 && aborted === started, 'a failed main analysis cancels all five in-flight annotation calls');

    const timeout = new AbortController();
    client.responses.create = (async (body: RequestBody) => {
      if (body.text?.format?.name === 'photo_inventory') return { status: 'completed', output_text: '{"elements":[]}' };
      timeout.abort(new DOMException('offline deadline reached', 'TimeoutError'));
      // Match the real SDK behavior: it hides the timeout reason behind a
      // generic APIUserAbortError with "Request was aborted" as its message.
      throw new Error('Request was aborted.');
    }) as unknown as typeof create;
    let deadlineError: unknown;
    try { await analyzeRoomDetailed({ roomType: 'kitchen', photos, signal: timeout.signal }); } catch (error) { deadlineError = error; }
    check(deadlineError instanceof ProviderError && deadlineError.code === 'timeout' && deadlineError.retryable && deadlineError.status === 504,
      'a hosting deadline survives SDK abort wrapping as a specific retryable timeout');
  } finally {
    client.responses.create = create;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
    if (savedHeadStart === undefined) delete process.env.INVENTORY_HEAD_START_MS; else process.env.INVENTORY_HEAD_START_MS = savedHeadStart;
  }
}

void verifyAnalysisLifecycle().then(() => {
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll inventory checks passed');
  process.exit(failures ? 1 : 0);
}).catch((error) => { console.error(error); process.exit(1); });
