/**
 * MANHATTAN — headless verification for the CONTRACT: the strict JSON schema
 * the vision model is handed, the bathroom's own fields, and the guided
 * intake.
 *
 *   npx tsx scripts/check-intake.ts
 *
 * Six things, with no browser, no dev server and no network:
 *
 *  1. STRICT SCHEMA. Every room type's schema is walked for the shapes OpenAI
 *     strict mode rejects — a `prefixItems` (which has silently killed an
 *     analysis twice), an array with no `items`, an object whose `required`
 *     does not list every property, a missing `additionalProperties: false`,
 *     and any of the keywords `stripForStrict` is supposed to delete.
 *  2. DEFAULTS PARSE. Each default spec round-trips through RoomSpecZ, so a
 *     template can never be the thing that 400s /api/refine.
 *  3. THE BATHROOM CONTRACT. The new fields survive the reconciler, the
 *     healer fills them in on a spec written before they existed, and the
 *     rules that keep them consistent actually fire.
 *  4. THE GUIDED INTAKE. Every question's options come from a real enum or
 *     the real catalog, every write path resolves on its room's default spec,
 *     and the answers land where they say they will.
 *  5. THE INTERVIEW'S WIRING. Who gets asked (a room photograph does not),
 *     what the answers do to the project when the client presses Build, and
 *     that they survive a reload and can be edited one at a time afterwards.
 *  6. THE FLOOR PLAN. What a drawing may answer (its own dimension strings,
 *     the wall layout) and what it must refuse (any finish, and a scale
 *     inferred from an assumed door on an undimensioned sheet) — with every
 *     refusal landing as a QUESTION rather than a guess.
 */
// FIRST: the store is persisted, and zustand resolves its storage at import
// time — without this the interview checks below shout over their own output.
import './memory-storage';
import { readFileSync } from 'node:fs';
import { BathroomSpecZ, ExteriorSpecZ, KitchenSpecZ, RoomSpecZ, jsonSchemaFor } from '../src/lib/spec/schema';
import { defaultBathroom, defaultExterior, defaultFloorPlan, defaultKitchen, defaultSpec } from '../src/lib/spec/defaults';
import { healContract } from '../src/lib/fit/contract';
import { reconcileSpec } from '../src/lib/ai/reconcile';
import { migrateProject, emptyProject, PERSIST_VERSION } from '../src/lib/store/project-store';
import {
  INTAKE_QUESTIONS, PLAN_NO_DIMENSIONS, applyIntakeAnswers, defaultAnswers, emptyIntake, healIntake,
  intakeEstimateSettings, intakeFromAnalysis, parseModule, planSizeUnknown, questionGroups, questionsFor,
  setAnswer, specFromIntake,
} from '../src/lib/spec/intake';
// the server-side half of the floor-plan rule (§16). Importing the analyzer
// module is safe headless: the OpenAI client is only built inside the call.
import { applyPlanLimits } from '../src/lib/ai/analyze';
import { PLAN_DIM_NOTE } from '../src/lib/ai/prompt';
import {
  answeredCount, buildFromInterview, changedSlots, completeAnswers, interviewQuestions, shouldOpenInterview,
} from '../src/components/studio/interviewFlow';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { computeBathroomLayout } from '../src/components/scene/bathroom/layout';
import { computeExteriorLayout } from '../src/components/scene/exterior/layout';
import { computeKitchenLayout } from '../src/components/scene/kitchen/layout';
import { getMaterial, materialsForSlot } from '../src/lib/materials/catalog';
import { BATHROOM_ITEM_KINDS, COLOR_WORDS, DEFAULT_MATERIAL, ITEM_KINDS, ITEM_SIZE, colorFromLabel, kindFromLabel, readKind } from '../src/lib/spec/decor-items';
import { useProjectStore } from '../src/lib/store/project-store';
import type { FloorPlanSpec, BathroomSpec, ExteriorSpec, IntakeAnswer, KitchenSpec, Project, RoomSpec, RoomType } from '../src/lib/spec/types';

let failures = 0;
let checks = 0;
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const check = (cond: boolean, m: string) => { checks++; if (cond) ok(m); else fail(m); };

const ctx = () => ({ photoCount: 1, fixes: [] as string[] });

// ---------------------------------------------------------------------------
console.log('\n1. The strict JSON schema handed to the vision model');
{
  // Exactly the keywords `stripForStrict` deletes plus the two shapes strict
  // mode rejects outright. A schema that carries any of them makes the API
  // fall back to non-strict WITHOUT an error, which is how an out-of-range
  // block once turned a client's kitchen into the template.
  const BANNED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', 'default', '$schema', 'prefixItems'];
  for (const room of ['kitchen', 'bathroom', 'exterior'] as const) {
    const problems: string[] = [];
    let objects = 0;
    let props = 0;
    const walk = (node: unknown, path: string, inProps = false) => {
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (inProps) { for (const k of Object.keys(o)) walk(o[k], `${path}.${k}`); return; }
      for (const k of BANNED) if (k in o) problems.push(`${path}: carries '${k}'`);
      if (o.type === 'array' && (o.items === undefined || o.items === false)) problems.push(`${path}: array with no items schema`);
      if (o.type === 'object' && o.properties && typeof o.properties === 'object') {
        objects++;
        const keys = Object.keys(o.properties as Record<string, unknown>);
        props += keys.length;
        if (o.additionalProperties !== false) problems.push(`${path}: additionalProperties is not false`);
        const required = Array.isArray(o.required) ? (o.required as string[]) : [];
        const missing = keys.filter((k) => !required.includes(k));
        if (missing.length) problems.push(`${path}: required omits ${missing.join(', ')}`);
      }
      for (const k of Object.keys(o)) walk(o[k], path ? `${path}.${k}` : k, k === 'properties');
    };
    walk(jsonSchemaFor(room), room);
    check(problems.length === 0, `${room}: ${objects} objects / ${props} properties, strict-safe${problems.length ? ` — ${problems.slice(0, 4).join('; ')}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n2. Every default spec parses its own schema');
{
  for (const [name, spec, schema] of [
    ['kitchen', defaultKitchen(), KitchenSpecZ],
    ['bathroom', defaultBathroom(), BathroomSpecZ],
    ['exterior', defaultExterior(), ExteriorSpecZ],
  ] as const) {
    const r = schema.safeParse(spec);
    check(r.success, `default ${name} parses${r.success ? '' : ` — ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`}`);
  }
  // …and through the union, which is what every route actually validates with
  for (const room of ['kitchen', 'bathroom', 'exterior'] as RoomType[]) {
    check(RoomSpecZ.safeParse(defaultSpec(room)).success, `default ${room} parses RoomSpecZ`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n3. A spec written BEFORE the bathroom had a contract still works');
{
  // Exactly what a v6 payload looks like: none of the new keys present at all.
  const legacy = JSON.parse(JSON.stringify(defaultBathroom())) as Record<string, Record<string, unknown>>;
  for (const k of ['drawers', 'doors', 'legStyle', 'counterThicknessIn', 'backsplash', 'heightIn', 'depthIn', 'basin', 'faucetMount', 'hardware', 'openShelf']) delete legacy.vanity[k];
  for (const k of ['glassThicknessIn', 'doorType', 'hardwareFinish', 'nicheAt', 'benchStyle', 'curbHeightIn']) delete legacy.shower[k];
  for (const k of ['material', 'fillerType', 'fillerFinish', 'apron', 'widthIn', 'heightIn']) delete legacy.tub[k];
  delete legacy.toilet.trimFinish;
  for (const k of ['heightIn', 'pattern', 'moduleIn', 'groutWidthIn', 'trim', 'accent', 'showerPattern', 'showerModuleIn']) delete legacy.wallTile[k];
  delete (legacy as unknown as Record<string, unknown>).accessories;
  delete legacy.detected.inputKind;

  check(!BathroomSpecZ.safeParse(structuredClone(legacy)).success === false, 'a v6 bathroom still parses (the defaults do the work, not the healer)');

  const healed = healContract(structuredClone(legacy) as unknown as BathroomSpec);
  check(healed.vanity.drawers === null && healed.vanity.legStyle === null, 'healContract fills the vanity front with null = as before');
  check(healed.shower.nicheAt === null && healed.shower.doorType === null, 'healContract fills the shower glass and niche with null');
  check(healed.tub.material === null && healed.tub.fillerType === null, 'healContract fills the tub with null');
  check(Array.isArray(healed.accessories) && healed.accessories.length === 0, 'healContract gives a bare wall an empty accessories list');
  check(healed.wallTile.pattern === null && healed.wallTile.moduleIn === null, 'healContract fills the wall tile with null');
  check(healed.detected.inputKind === 'room-photo', 'healContract calls an unclassified upload a room photo');
  check(BathroomSpecZ.safeParse(healed).success, 'and the healed spec parses');

  // …and the store's own migration says the same thing about the same payload
  const migrated = migrateProject({ project: { ...emptyProject('bathroom'), spec: structuredClone(legacy) as unknown as RoomSpec, intake: undefined } }, 6);
  const ms = migrated.project.spec as BathroomSpec;
  check(ms.vanity.drawers === null && ms.wallTile.accent === null && Array.isArray(ms.accessories), 'the v6→v7 migration backfills the same fields the healer does');
  check(migrated.project.intake === null, 'and a project that was never asked keeps intake null');
  check(PERSIST_VERSION === 8, `PERSIST_VERSION is ${PERSIST_VERSION}`);
}

// ---------------------------------------------------------------------------
console.log('\n4. The bathroom rules that keep the new fields honest');
{
  const run = (mutate: (b: BathroomSpec) => void) => {
    const b = defaultBathroom();
    mutate(b);
    const c = ctx();
    return reconcileSpec(b, c) as BathroomSpec;
  };

  const floating = run((b) => { b.vanity.style = 'floating'; b.vanity.legStyle = 'turned'; });
  check(floating.vanity.legStyle === 'none', 'a floating vanity loses the legs it cannot have');

  const pedestal = run((b) => { b.vanity.style = 'pedestal'; b.vanity.drawers = 3; b.vanity.doors = 2; });
  check(pedestal.vanity.drawers === 0 && pedestal.vanity.doors === 0, 'a pedestal has no drawers and no doors');

  const narrow = run((b) => { b.vanity.widthIn = 24; b.vanity.drawers = 6; b.vanity.doors = 4; });
  check((narrow.vanity.drawers ?? 0) + (narrow.vanity.doors ?? 0) <= Math.floor(24 / 9), 'ten fronts do not fit a 24in vanity');

  const curtain = run((b) => { b.shower.enclosure = 'curtain'; b.shower.glassThicknessIn = 0.5; });
  check(curtain.shower.glassThicknessIn === null && curtain.shower.doorType === 'none', 'a curtain has no glass and no door');

  const curbless = run((b) => { b.shower.curbless = true; b.shower.curbHeightIn = 6; });
  check(curbless.shower.curbHeightIn === 0, 'a curbless entry has no curb');

  const noNiche = run((b) => { b.shower.niche = false; });
  check(noNiche.shower.nicheAt === null, 'no niche means no niche position');

  const wideNiche = run((b) => { b.shower.niche = true; b.shower.widthIn = 48; b.shower.nicheAt = { face: 'back', t: 0.5, centerIn: 48, widthIn: 60, heightIn: 14, shelves: 1 }; });
  check((wideNiche.shower.nicheAt?.widthIn ?? 0) <= 42, 'a niche cannot be wider than the stall wall it is cut in');

  const freestanding = run((b) => { b.tub.kind = 'freestanding'; b.tub.apron = 'tiled'; });
  check(freestanding.tub.apron === 'integral', 'a freestanding tub has no tiled apron');

  const tallTile = run((b) => { b.wallTile.height = 'wainscot'; b.wallTile.heightIn = 400; });
  check((tallTile.wallTile.heightIn ?? 0) <= tallTile.dims.ceilingFt * 12, 'wall tile stops at the ceiling');
  check(tallTile.wallTile.height === 'full', 'and a wainscot that reaches the ceiling is called full height');

  const slab = run((b) => { b.wallTile.pattern = 'slab'; b.wallTile.moduleIn = { w: 12, h: 24 }; b.wallTile.groutWidthIn = 0.125; });
  check(slab.wallTile.moduleIn === null && slab.wallTile.groutWidthIn === 0, 'a slab has no module and no grout');

  const sameAccent = run((b) => { b.wallTile.pattern = 'stacked'; b.wallTile.accent = { wall: 'left', pattern: 'stacked', moduleIn: null, heightIn: null, colorHex: null }; });
  check(sameAccent.wallTile.accent === null, 'an "accent" in the same tile as the room is not an accent');

  const legacyAccent = run((b) => { b.wallTile.height = 'accent-wall'; b.wallTile.accent = null; });
  check(legacyAccent.wallTile.accent !== null, "the old 'accent-wall' word still produces an accent wall");

  const stray = run((b) => { b.accessories = [{ kind: 'towel-bar', wall: 'left', t: 1.4, heightFt: 40, widthIn: 400, finish: null }]; });
  const a0 = stray.accessories?.[0];
  check(!!a0 && a0.t <= 1 && a0.heightFt <= stray.dims.ceilingFt && (a0.widthIn ?? 0) <= 48, 'an accessory is fitted to the wall it hangs on');

  const kept = run(() => {});
  check(BathroomSpecZ.safeParse(kept).success, 'and every reconciled bathroom still parses');
}

// ---------------------------------------------------------------------------
console.log('\n5. Bathroom décor items');
{
  check(ITEM_KINDS.length === 36 && ITEM_KINDS[ITEM_KINDS.length - 1] === 'other', `${ITEM_KINDS.length} item kinds, 'other' still last`);
  for (const k of ITEM_KINDS) {
    if (!ITEM_SIZE[k]) fail(`${k} has no size row`);
    if (!DEFAULT_MATERIAL[k]) fail(`${k} has no default material`);
  }
  checks += 2;
  ok('every kind has a size range and a default material');
  for (const k of BATHROOM_ITEM_KINDS) if (!ITEM_KINDS.includes(k)) fail(`${k} is offered to bathrooms but is not a kind`);
  checks++;
  ok(`${BATHROOM_ITEM_KINDS.length} kinds offered first in a bathroom, all real`);

  // The label reader has to put the bathroom nouns ahead of the generic ones
  // they collide with, or "folded white towels" draws one flat towel and
  // "toothbrush holder" draws a jar.
  const reads: Array<[string, string]> = [
    ['stack of folded white towels', 'folded-towels'],
    ['white bath towel', 'towel'],
    ['paper towel roll', 'paper-towel'],
    ['grey cotton bath mat', 'bath-mat'],
    ['white ceramic toothbrush holder', 'toothbrush-cup'],
    ['amber glass soap pump', 'soap-pump'],
    ['white bar of soap in a dish', 'soap-set'],
    ['linen bathrobe on a hook', 'robe'],
    ['boutique tissue box', 'tissue-box'],
    // and nothing a kitchen already read changed meaning
    ['blue enamel dutch oven', 'dutch-oven'],
    ['wood serving board', 'cutting-board'],
    ['clear glass vase with green branches', 'vase'],
  ];
  for (const [label, want] of reads) check(kindFromLabel(label) === want, `"${label}" reads as ${want}`);

  // A wall FITTING is an accessory, not an object standing on a surface. The
  // inventory boxes them either way, so the reader has to refuse them the
  // way it refuses the brass pot filler in a kitchen.
  for (const label of ['chrome towel bar', 'matte black robe hook', 'stainless grab bar', 'toilet paper holder', 'rain shower head']) {
    check(readKind(label).kind === null, `"${label}" is a fitting, not an item`);
  }
  check(readKind('white towel on the towel bar').kind === 'towel', 'but a towel ON a towel bar is still a towel');
  // …and the colour still belongs to the towels, not to the stack
  const c = colorFromLabel('stack of folded white towels', readKind('stack of folded white towels').at);
  check(c.hex === COLOR_WORDS.white, 'and "white" is read as the towels\' colour, not skipped');

  // A bathroom's items now survive the reconciler, on the hosts a bathroom has
  const b = defaultBathroom();
  b.decor.items = [
    { kind: 'soap-pump', label: 'glass soap pump', on: 'counter', wall: b.vanity.wall, t: 0.4, depthT: 0.35, shelfIndex: null, burner: null, sizeIn: 8, colorHex: '#c08a45', material: 'glass', count: 1 },
    // hosts a bathroom does NOT have: both must be re-hosted, never dropped
    { kind: 'towel', label: 'white towel', on: 'range', wall: 'back', t: 0.5, depthT: null, shelfIndex: null, burner: 'left-back', sizeIn: 12, colorHex: '#f2f0ec', material: 'fabric', count: 1 },
    { kind: 'tray', label: 'marble tray', on: 'island', wall: 'island', t: 0.5, depthT: null, shelfIndex: null, burner: null, sizeIn: 12, colorHex: '#2b2c2e', material: 'marble', count: 1 },
  ];
  const out = reconcileSpec(b, ctx()) as BathroomSpec;
  check(out.decor.items.length === 3, `a bathroom keeps all three items (${out.decor.items.length})`);
  check(out.decor.items.every((i) => i.on !== 'range' && i.on !== 'island'), 'and re-hosts the range and island ones onto the vanity');
  check(out.decor.items.every((i) => i.burner === null), 'with no burner left on any of them');
  check(out.decor.cabinetContents.length === 0, 'a bathroom still draws nothing behind a cabinet door');
}

// ---------------------------------------------------------------------------
console.log('\n5b. The demo bathroom fixture');
{
  // A frozen bathroom that exercises every field the contract gained, so a
  // consumer stream that ignores one of them shows up as a visible difference
  // rather than a silent default. It is a REAL spec: reconciled, healed and
  // parsed exactly like an analyzed one.
  const raw = JSON.parse(readFileSync(new URL('./fixtures/demo-bathroom.spec.json', import.meta.url), 'utf8')) as BathroomSpec;
  const p = BathroomSpecZ.safeParse(raw);
  check(p.success, `the fixture parses${p.success ? '' : ` — ${p.error.issues.slice(0, 2).map((i) => i.path.join('.')).join(', ')}`}`);
  check(raw.wallTile.pattern === 'vertical-stack' && raw.wallTile.moduleIn?.w === 3 && raw.wallTile.heightIn === 54, 'it declares a 3×12 vertical stack to 54 in — the sentence the old contract could not write');
  check(raw.wallTile.accent?.wall === 'back' && raw.wallTile.accent.pattern === 'herringbone', 'and a herringbone feature wall behind the tub');
  check(raw.vanity.legStyle === 'turned' && raw.vanity.basin === 'vessel' && raw.vanity.faucetMount === 'wall', 'a furniture vanity on turned legs, vessel basin, wall tap');
  check((raw.vanity.drawers ?? 0) + (raw.vanity.doors ?? 0) === 5, 'with five fronts counted off the photo');
  check(raw.shower.glassThicknessIn === 0.375 && raw.shower.doorType === 'barn' && !!raw.shower.nicheAt, 'a 3/8 in frameless barn door and a placed niche');
  check(raw.tub.material === 'cast-iron' && raw.tub.fillerType === 'floor-mount', 'a cast-iron tub with a floor-mount filler');
  check((raw.accessories?.length ?? 0) === 4, `${raw.accessories?.length} wall fittings`);
  check(raw.decor.items.length >= 5, `${raw.decor.items.length} objects on the vanity, the shelf and the floor`);
  // and it survives another trip through the reconciler unchanged in substance
  const again = reconcileSpec(structuredClone(raw), ctx()) as BathroomSpec;
  check(JSON.stringify(again.wallTile) === JSON.stringify(raw.wallTile), 'a second reconcile pass changes nothing about the tile');
  check(JSON.stringify(again.accessories) === JSON.stringify(raw.accessories), 'nor about the fittings');
  check(again.decor.items.length === raw.decor.items.length, 'and drops none of the objects');
}

// ---------------------------------------------------------------------------
console.log('\n6. The guided intake catalogue');
{
  const ids = new Set<string>();
  for (const q of INTAKE_QUESTIONS) {
    if (ids.has(q.id)) fail(`duplicate question id ${q.id}`);
    ids.add(q.id);
    if (!q.rooms.length) fail(`${q.id}: no room types`);
    if (!q.inputs.length) fail(`${q.id}: no input kinds`);
    if ((q.type === 'choice' || q.type === 'multi') && q.options.length < 2) fail(`${q.id}: a picker with ${q.options.length} option(s)`);
    if (q.type === 'choice' && !q.options.some((o) => o.value === q.default)) fail(`${q.id}: default '${q.default}' is not one of its options`);
    if (q.type === 'number' && (q.min === null || q.max === null)) fail(`${q.id}: a number with no range`);
    if (q.type === 'colour' && !/^#[0-9a-f]{6}$/i.test(q.default)) fail(`${q.id}: default '${q.default}' is not a colour`);
    if (!q.prompt.endsWith('?')) fail(`${q.id}: the prompt is not a question`);
    if (q.help.length < 20) fail(`${q.id}: no real help text`);
  }
  checks += 8;
  ok(`${INTAKE_QUESTIONS.length} questions, unique ids, every picker defaulted to one of its own options`);

  // Material options are the REAL catalog, not a hand-typed list that drifts.
  let materialOpts = 0;
  for (const q of INTAKE_QUESTIONS) {
    if (q.writes.kind !== 'material') continue;
    for (const o of q.options) {
      materialOpts++;
      const m = getMaterial(o.value);
      if (!m) fail(`${q.id}: '${o.value}' is not in the catalog`);
      // `materialsForSlot` is what the picker itself offers, and it is wider
      // than `m.slots`: a whole-house slot with no shelf of its own borrows one
      // (SLOT_BORROWS). Asking the catalog row directly would call every legal
      // borrowed option a mistake.
      else if (!materialsForSlot(q.writes.slot).some((x) => x.id === m.id)) fail(`${q.id}: ${m.name} does not fit the ${q.writes.slot} slot`);
    }
  }
  checks++;
  ok(`${materialOpts} material options, every one a real catalog product for its own slot`);

  // Every field write has somewhere to land on its room's default spec.
  const specs: Record<RoomType, RoomSpec> = { kitchen: defaultKitchen(), bathroom: defaultBathroom(), exterior: defaultExterior(), floorplan: defaultFloorPlan() };
  for (const q of INTAKE_QUESTIONS) {
    if (q.writes.kind !== 'field' || q.writes.path === 'detected.notes') continue;
    for (const room of q.rooms) {
      let cur: unknown = specs[room];
      for (const part of q.writes.path.split('.')) {
        if (cur === null || typeof cur !== 'object') { cur = undefined; break; }
        cur = part.endsWith('[]')
          ? (cur as Record<string, unknown[]>)[part.slice(0, -2)]?.[0]
          : (cur as Record<string, unknown>)[part];
      }
      if (cur === undefined) fail(`${q.id}: ${q.writes.path} does not resolve on the default ${room}`);
    }
  }
  checks++;
  ok('every field write resolves on its room\'s default spec');

  check(parseModule('12x24')?.w === 12 && parseModule('3 × 6')?.h === 6, 'a tile module parses from either spelling');
  check(parseModule('subway') === null, 'and a word is not a module');
}

// ---------------------------------------------------------------------------
console.log('\n7. Which questions get asked');
{
  const photo = questionsFor('kitchen', 'room-photo');
  const lot = questionsFor('exterior', 'empty-lot');
  const plan = questionsFor('bathroom', 'floor-plan');
  check(photo.every((q) => q.writes.kind === 'setting'), 'a room photograph is asked only what no photograph can show');
  check(lot.length > 10 && lot.every((q) => q.rooms.includes('exterior')), `an empty lot is asked ${lot.length} exterior questions`);
  check(plan.length > 10 && plan.every((q) => q.rooms.includes('bathroom')), `a bathroom floor plan is asked ${plan.length} questions`);
  check(!plan.some((q) => q.rooms.includes('kitchen') && !q.rooms.includes('bathroom')), 'and none of them is a kitchen question');

  // …and a slot a photograph DID read is not asked about again.
  const seen = defaultBathroom();
  seen.detected.finishes = [{ slot: 'vanity_cabinet', family: 'paint', baseColorHex: '#1F2A36', accentColorHex: null, pattern: 'solid', sheen: 'satin', moduleIn: null, groutColorHex: null, description: 'navy painted vanity', visibility: 'clear', plankRun: null }];
  const after = questionsFor('bathroom', 'floor-plan', seen);
  check(!after.some((q) => (q.writes.kind === 'finish' || q.writes.kind === 'material') && q.writes.slot === 'vanity_cabinet'), 'a slot the photo already read is not asked about');
  check(after.length < plan.length, `and the interview is ${plan.length - after.length} question(s) shorter for it`);
  check(questionsFor('bathroom', 'floor-plan', seen, { includeAnswered: true }).length >= plan.length, 'includeAnswered asks everything anyway');

  const groups = questionGroups(plan);
  check(groups.length > 2 && groups.every(([, qs]) => qs.length > 0), `grouped into ${groups.length} non-empty sections for a paged interview`);
}

// ---------------------------------------------------------------------------
console.log('\n8. The answers land in the spec');
{
  const answers: IntakeAnswer[] = [
    { id: 'style', value: 'farmhouse', values: [] },
    { id: 'budget-tier', value: 'premium', values: [] },
    { id: 'bath.layout', value: 'primary', values: [] },
    { id: 'bath.vanity-sinks', value: '2', values: [] },
    { id: 'bath.vanity-style', value: 'furniture', values: [] },
    { id: 'bath.vanity-material', value: 'stained-wood', values: [] },
    { id: 'bath.vanity-colour', value: '#5A4030', values: [] },
    { id: 'bath.tile-pattern', value: 'herringbone', values: [] },
    { id: 'bath.tile-size', value: '2x8', values: [] },
    { id: 'bath.tile-height', value: '54', values: [] },
    { id: 'bath.fixture-finish', value: 'brushed-gold', values: [] },
    { id: 'bath.tub', value: 'false', values: [] },
    { id: 'notes', value: 'keep the window, the door has to stay where it is', values: [] },
    // things that must NOT land
    { id: 'kitchen.cabinet-door', value: 'shaker', values: [] },
    { id: 'bath.vanity-colour-2', value: '#fff', values: [] },
    { id: 'bath.tile-pattern', value: 'plaid', values: [] },
  ];
  const r = applyIntakeAnswers(defaultBathroom(), answers);
  const b = r.spec as BathroomSpec;
  check(b.style === 'farmhouse' && b.layout === 'primary' && b.vanity.sinks === 2, 'the plain fields land');
  check(b.vanity.style === 'furniture', 'and so does an enum');
  check(b.wallTile.pattern === 'herringbone' && b.wallTile.heightIn === 54, 'the tile pattern and its numeric height land');
  check(b.wallTile.moduleIn?.w === 2 && b.wallTile.moduleIn?.h === 8, 'and the module parses into the spec, not a string');
  check(b.tub.present === false, "a 'no' lands as false, not the string 'false'");
  check(b.shower.hardwareFinish === 'brushed-gold', 'the fixture metal lands');
  check(b.detected.notes.some((n) => n.includes('keep the window')), "the client's own words reach detected.notes");
  const obs = b.detected.finishes.find((f) => f.slot === 'vanity_cabinet');
  check(obs?.family === 'stained-wood' && obs?.baseColorHex === '#5A4030', 'family + colour assemble into ONE finish observation');
  check(obs?.visibility === 'inferred', 'marked inferred, because nobody looked at it');
  check(obs?.pattern === 'wood-grain', 'and the family supplies the pattern nobody was asked for');
  check(r.skipped.some((s) => s.startsWith('kitchen.cabinet-door')), 'a kitchen question aimed at a bathroom is skipped, not applied');
  check(r.skipped.some((s) => s.startsWith('bath.vanity-colour-2')), 'and so is a question that does not exist');
  check(r.skipped.some((s) => s.includes('plaid')), 'and an option that is not on the list');
  check(intakeEstimateSettings(answers).tier === 'premium', 'the budget answer reaches the estimate settings, not the spec');
  check(BathroomSpecZ.safeParse(b).success, 'and the answered spec parses');
  check(JSON.stringify(defaultBathroom().wallTile.pattern) === JSON.stringify('stacked'), 'applyIntakeAnswers did not touch the spec it was given');

  // the whole guided path, and the "client skipped everything" path
  for (const room of ['kitchen', 'bathroom', 'exterior'] as RoomType[]) {
    const intake = { ...emptyIntake('floor-plan'), answers: defaultAnswers(room, 'floor-plan') };
    const built = specFromIntake(defaultSpec(room), intake);
    if (built.skipped.length) fail(`${room}: ${built.skipped.length} default answers did not land — ${built.skipped[0]}`);
    if (!RoomSpecZ.safeParse(built.spec).success) fail(`${room}: the spec built from defaults does not parse`);
    if (built.spec.detected.inputKind !== 'floor-plan') fail(`${room}: the built spec forgot what it was built from`);
  }
  checks += 3;
  ok('every question\'s own default answer lands, in every room, and the result parses');
}

// ---------------------------------------------------------------------------
console.log('\n9. Intake state survives the round trip');
{
  check(healIntake(null) === null, 'never asked stays never asked');
  const messy = healIntake({
    inputKind: 'nonsense',
    answers: [
      { id: 'style', value: 'farmhouse', values: [] },
      { id: 'style', value: 'modern', values: [] },
      { id: 42, value: 'x' },
      null,
      { id: 'notes', value: 7, values: 'nope' },
    ],
    capturedAt: 12,
  });
  check(messy?.inputKind === 'room-photo', 'an unreadable input kind falls back to a room photo');
  check(messy?.answers.length === 2, `junk answers are dropped and duplicates collapse (${messy?.answers.length})`);
  check(messy?.answers[0].value === 'farmhouse', 'and the FIRST answer for an id wins');
  check(messy?.answers[1].value === '' && Array.isArray(messy?.answers[1].values), 'a non-string value heals to an empty answer');
  check(messy?.capturedAt === null, 'and a non-string timestamp to null');
}


// ---------------------------------------------------------------------------
console.log('\n10. Who the studio actually interrupts');
{
  // The client's own rule: a photograph of a room answers its own questions,
  // and everything else does not. A twin that interrogates somebody who just
  // uploaded a picture of their kitchen is the form nobody wants.
  const photo = defaultKitchen();
  const dim = defaultKitchen();
  dim.detected.confidence = 0.2; // a photograph the model could barely read
  const lot = defaultExterior();
  lot.detected.inputKind = 'empty-lot';
  const plan = defaultBathroom();
  plan.detected.inputKind = 'floor-plan';
  const sheet = defaultKitchen();
  sheet.detected.inputKind = 'plans-document';

  const asked = (spec: RoomSpec) => interviewQuestions(spec, intakeFromAnalysis(spec));
  check(asked(photo).length === 1, `a room photograph is asked ${asked(photo).length} question — where to price it`);
  check(!shouldOpenInterview(photo, intakeFromAnalysis(photo)), 'and the interview never opens on it');
  check(!shouldOpenInterview(dim, intakeFromAnalysis(dim)), 'nor on a photo the model read badly: one question is a chip, not a takeover');
  check(asked(lot).length >= 15 && shouldOpenInterview(lot, intakeFromAnalysis(lot)), `an empty lot opens it with ${asked(lot).length} questions`);
  check(asked(plan).length >= 15 && shouldOpenInterview(plan, intakeFromAnalysis(plan)), `a bathroom floor plan opens it with ${asked(plan).length}`);
  check(asked(sheet).length >= 10 && shouldOpenInterview(sheet, intakeFromAnalysis(sheet)), `a kitchen plan set opens it with ${asked(sheet).length}`);
  check(!shouldOpenInterview(null, null), 'and a project with no spec asks nothing at all');

  // `intakeFromAnalysis` is what the studio stores the moment a spec lands.
  check(intakeFromAnalysis(lot).inputKind === 'empty-lot' && intakeFromAnalysis(lot).answers.length === 0, 'the intake a fresh analysis implies remembers the upload and holds no answers');
  check(intakeFromAnalysis(photo).inputKind === 'room-photo', 'and an unclassified analysis is a room photo');

  // Defaults preselected: the client can accept the lot without touching a
  // control, and what gets built is exactly what was on screen.
  const questions = asked(lot);
  check(answeredCount(questions, []) === 0, 'nothing is "answered" before the client touches it');
  const filled = completeAnswers(questions, []);
  check(filled.length === questions.length, `accepting the lot fills all ${filled.length} answers with the shown defaults`);
  check(filled.every((a, i) => a.value === questions[i].default), 'each one exactly the default the question displayed');
  const typed = setAnswer([], 'ext.siding-colour', '#2E3438');
  check(answeredCount(questions, typed) === 1, 'and one answer counts as one');
  check(completeAnswers(questions, typed).find((a) => a.id === 'ext.siding-colour')?.value === '#2E3438', "the client's own answer is never overwritten by its default");
}

// ---------------------------------------------------------------------------
console.log('\n11. The answers build the twin, and stay editable afterwards');
{
  // The whole client path for the case that has no photograph in it at all:
  // an empty lot, through the real store, exactly as the interview drives it.
  useProjectStore.getState().newProject('exterior');
  const lot = defaultExterior('modern-farmhouse');
  lot.detected.inputKind = 'empty-lot';
  useProjectStore.getState().setSpec(lot);
  useProjectStore.getState().setIntake(intakeFromAnalysis(lot));
  const held = useProjectStore.getState().project;
  const questions = interviewQuestions(held.spec, held.intake);
  check(questions.length >= 15, `an empty lot with no photo asks ${questions.length} questions`);

  // A hand-picked material on a surface the interview never asks about: it
  // has to be here afterwards, or every re-answer costs the client their work.
  const otherDriveway = materialsForSlot('driveway').find((m) => m.id !== useProjectStore.getState().project.selections.driveway);
  if (otherDriveway) useProjectStore.getState().setSelection('driveway', otherDriveway.id);

  let answers: IntakeAnswer[] = [];
  answers = setAnswer(answers, 'ext.siding-colour', '#2E3438');
  answers = setAnswer(answers, 'ext.lot-width', '52');
  answers = setAnswer(answers, 'ext.stories', '1');
  answers = setAnswer(answers, 'budget-tier', 'premium');
  useProjectStore.getState().setIntake({ ...useProjectStore.getState().project.intake!, answers });

  const built = buildFromInterview(answers);
  check(built.ok, `Build lands: ${built.wrote.length} wrote, ${built.skipped.length} skipped${built.skipped.length ? ` — ${built.skipped[0]}` : ''}`);
  check(built.skipped.length === 0, 'and nothing the client chose was dropped');
  const after = useProjectStore.getState().project;
  const spec = after.spec as ExteriorSpec;
  check(spec.lot.widthFt === 52 && spec.house.stories === 1, 'the numbers the client gave us land on the spec');
  check(RoomSpecZ.safeParse(spec).success, 'the built spec parses');
  check(computeExteriorLayout(spec).lotWidthFt === 52, 'and it DRAWS: the scene layout builds the lot they measured');
  check(after.estimateSettings.tier === 'premium', 'the budget answer reaches the estimate settings, not the spec');
  check(Boolean(after.intake?.capturedAt), 'the project records when it was asked');
  check(after.intake?.answers.length === questions.length, `and keeps all ${after.intake?.answers.length} answers, defaults included`);
  const siding = spec.detected.finishes.find((f) => f.slot === 'siding_primary');
  check(siding?.baseColorHex === '#2E3438', 'the colour became a finish observation, the same shape a photo reading has');
  check(built.changed.includes('siding_primary'), 'and the siding slot is reported as moved');
  check(after.selections.siding_primary === (spec.materials as unknown as Record<string, string>).siding_primary, 'the twin is wearing the material that observation matched');
  if (otherDriveway) check(after.selections.driveway === otherDriveway.id, 'while a material the client picked by hand on an unasked surface is untouched');

  // A reload: the project through JSON and back, which is all persistence is.
  const persisted = JSON.parse(JSON.stringify(after)) as Project;
  useProjectStore.getState().newProject('kitchen');
  check(useProjectStore.getState().project.intake === null, 'a new project has never been asked');
  useProjectStore.getState().loadProject(persisted);
  const back = useProjectStore.getState().project;
  check(back.intake?.answers.length === questions.length, 'the answers survive the round trip');
  check(back.intake?.answers.find((a) => a.id === 'ext.siding-colour')?.value === '#2E3438', 'with the colour the client typed still on them');
  check(back.intake?.inputKind === 'empty-lot', 'and the project still knows it was built from a bare lot');

  // Change ONE answer months later. No re-analysis, no lost work.
  const before = back.spec as ExteriorSpec;
  const edited = setAnswer(back.intake!.answers, 'ext.roof-colour', '#8B5E3C');
  useProjectStore.getState().setIntake({ ...back.intake!, answers: edited });
  const again = buildFromInterview(edited);
  const now = useProjectStore.getState().project;
  check(again.ok && again.changed.includes('roof'), `re-answering one question moves the roof (${again.changed.join(', ') || 'nothing'})`);
  check(!again.changed.includes('siding_primary'), 'and leaves every other surface exactly where it was');
  check((now.spec as ExteriorSpec).detected.finishes.find((f) => f.slot === 'roof')?.baseColorHex === '#8B5E3C', 'the new roof colour is on the spec');
  check((now.spec as ExteriorSpec).lot.widthFt === before.lot.widthFt, 'the answers that were not touched still hold');
  if (otherDriveway) check(now.selections.driveway === otherDriveway.id, 'and the hand-picked driveway is STILL there after the rebuild');

  check(changedSlots(before, now.spec as ExteriorSpec).length >= 1, 'changedSlots reads the move off the two specs, however it happened');
  check(changedSlots(before, before).length === 0, 'and calls an unchanged spec unchanged');
}

// ---------------------------------------------------------------------------
console.log('\n12. Accepting the defaults builds a room in every case');
{
  // The "client skipped the whole interview" path, end to end, per room type
  // and per upload kind: it has to parse AND it has to draw, because a spec
  // that only parses is a spec nobody can look at.
  const draws: Record<RoomType, (spec: RoomSpec) => boolean> = {
    kitchen: (s) => computeKitchenLayout(s as KitchenSpec).runs.length > 0,
    bathroom: (s) => computeBathroomLayout(s as BathroomSpec).w > 0,
    exterior: (s) => computeExteriorLayout(s as ExteriorSpec).blocks.length > 0,
    // a plan draws when it still has levels, rooms and a stair after healing
    floorplan: (s) => {
      const f = s as FloorPlanSpec;
      return f.levels.length > 0 && f.levels.every((l) => l.rooms.length > 0);
    },
  };
  for (const room of ['kitchen', 'bathroom', 'exterior'] as RoomType[]) {
    for (const kind of ['empty-lot', 'floor-plan', 'plans-document'] as const) {
      const template = defaultSpec(room);
      template.detected.inputKind = kind;
      useProjectStore.getState().newProject(room);
      useProjectStore.getState().setSpec(template);
      useProjectStore.getState().setIntake(intakeFromAnalysis(template));
      const res = buildFromInterview([]); // pressed Build without touching anything
      const spec = useProjectStore.getState().project.spec!;
      if (!res.ok) fail(`${room}/${kind}: ${res.reason}`);
      else if (res.skipped.length) fail(`${room}/${kind}: ${res.skipped.length} default answers did not land — ${res.skipped[0]}`);
      else if (!RoomSpecZ.safeParse(spec).success) fail(`${room}/${kind}: the built spec does not parse`);
      else if (!draws[room](spec)) fail(`${room}/${kind}: the built spec does not draw`);
      else if (spec.detected.inputKind !== kind) fail(`${room}/${kind}: the built spec forgot what it was built from`);
      checks++;
    }
  }
  ok('every room type × every non-photo upload builds, parses and draws from the defaults alone');
}

// ---------------------------------------------------------------------------
console.log('\n13. …and the twin it builds carries a price');
{
  /*
   * "Draws" is only half the deliverable. The client's sentence is a twin AND
   * a live line-item estimate, and an empty lot has no baseline to price
   * changes against — so this is the FULL-mode number a contractor hands over.
   *
   * Two claims. First that it is a real quote and not a shape: priced lines, a
   * positive midpoint, and a low ≤ mid ≤ high band. Second — the one that
   * matters — that an ANSWER moves the money. A material question writes a
   * catalog id onto a slot, and every slot the estimator prices reads its
   * tier and its group off that material, so picking a different product has
   * to change the total. Without this, an interview that wired every answer
   * into the geometry and none into the estimate would still pass §12.
   */
  for (const room of ['kitchen', 'bathroom', 'exterior'] as RoomType[]) {
    const start = (): void => {
      const template = defaultSpec(room);
      template.detected.inputKind = 'empty-lot';
      useProjectStore.getState().newProject(room);
      useProjectStore.getState().setSpec(template);
      useProjectStore.getState().setIntake(intakeFromAnalysis(template));
    };
    const priceOf = (answers: IntakeAnswer[]) => {
      start();
      buildFromInterview(answers);
      const st = useProjectStore.getState().project;
      return calculateEstimate(st.spec, st.selections, st.estimateSettings, st.baseline);
    };

    const est = priceOf([]);
    check(est.lines.length > 5 && est.mid > 1000 && est.totalLow <= est.mid && est.mid <= est.totalHigh && est.mode === 'full',
      `${room} from a bare lot prices out — ${est.lines.length} lines, $${Math.round(est.totalLow).toLocaleString()}–$${Math.round(est.totalHigh).toLocaleString()} (${est.mode})`);

    // the cheapest and the dearest product the catalogue offers for the same
    // slot, through the same question the client is actually asked
    start();
    const qs = interviewQuestions(useProjectStore.getState().project.spec, useProjectStore.getState().project.intake);
    const matQ = qs.find((q) => q.writes.kind === 'material' && q.options.length > 1);
    if (!matQ) fail(`${room}: the interview asks no material question at all`);
    else {
      const prices = matQ.options.map((o) => priceOf([{ id: matQ.id, value: o.value, values: [] }]).mid);
      const spread = Math.max(...prices) - Math.min(...prices);
      check(spread > 0, `${room}: '${matQ.id}' moves the quote across its ${matQ.options.length} options (a $${Math.round(spread).toLocaleString()} spread)`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n14. A product the client picked from the swatches is the product they get');
{
  /*
   * THE GENERAL RULE behind §13's roof line.
   *
   * A slot is asked either for a catalog PRODUCT or for a FINISH (family +
   * colour), and a few get one orthogonal finish question on top of a product
   * — the floor's plank direction, the roof's colour. Assembling an
   * observation to carry that single answer used to fabricate 'paint' /
   * '#EFECE6' for everything it was not told, and `ensureSpecMaterials`
   * believed the fabrication over the product: EVERY roof option and EVERY
   * floor option collapsed onto one synthesised custom material, so a client
   * who chose slate, clay tile or standing-seam metal got the same grey roof
   * and the same quote. The draft is now seeded from the slot's own material
   * (`describeMaterial`), so the observation describes the chosen product
   * rather than replacing it.
   *
   * This walks EVERY product question in the catalogue — not just the two that
   * were broken — because the failure was silent: nothing threw, nothing was
   * skipped, the answer simply did not survive.
   */
  for (const room of ['kitchen', 'bathroom', 'exterior'] as RoomType[]) {
    const start = () => {
      const t = defaultSpec(room);
      t.detected.inputKind = 'empty-lot';
      useProjectStore.getState().newProject(room);
      useProjectStore.getState().setSpec(t);
      useProjectStore.getState().setIntake(intakeFromAnalysis(t));
    };
    start();
    const qs = interviewQuestions(useProjectStore.getState().project.spec, useProjectStore.getState().project.intake);
    for (const q of qs) {
      if (q.writes.kind !== 'material') continue;
      const slot = q.writes.slot;
      const landed = new Map<string, string>();
      for (const o of q.options) {
        start();
        buildFromInterview([{ id: q.id, value: o.value, values: [] }]);
        landed.set(o.value, String(useProjectStore.getState().project.selections[slot]));
      }
      const distinct = new Set(landed.values());
      const collapsed = [...landed].filter(([want, got]) => got !== want);
      /*
       * Byte-for-byte, every one of them. This assertion used to allow a few
       * re-matches, on the theory that an orthogonal finish answer (the
       * roof's colour, the floor's board direction) legitimately re-tints a
       * product onto a near neighbour — and it does, when the CLIENT states
       * it. But the interview fills every untouched question with its own
       * default, and those constants were re-matching 8 of the 12 roofs and 7
       * of the 12 floors onto a neighbour the client never asked for. A
       * default nobody touched now ranks below the product somebody chose
       * (`IntakeAnswer.fromDefault`), so the swatch you click is the material
       * you get, and any drift here is a regression rather than a nuance.
       */
      check(collapsed.length === 0 && distinct.size === q.options.length,
        `${room}/${q.id}: all ${q.options.length} swatches land on themselves${collapsed.length ? ` — ${collapsed.length} did not: ${collapsed.map(([w, g]) => `${w}→${g}`).join(', ')}` : ''}`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n15. A default nobody touched, and an answer somebody gave, are not the same thing');
{
  /*
   * The other half of §14. Ranking a filled-in default below the product is
   * only right if a STATED answer still outranks it — otherwise the fix would
   * have quietly turned the roof-colour and floor-direction questions off,
   * which is the same class of bug (an answer that does nothing) in the
   * opposite direction. So: the same colour, once as the default the client
   * clicked past and once as the colour they chose, must land differently.
   *
   * The flag has to survive the round trips too. `completeAnswers` runs again
   * every time the client reopens the interview to change one thing, and a
   * default promoted to a statement on the second pass would re-tint the
   * product an hour after they picked it.
   */
  const start = () => {
    const t = defaultExterior();
    t.detected.inputKind = 'empty-lot';
    useProjectStore.getState().newProject('exterior');
    useProjectStore.getState().setSpec(t);
    useProjectStore.getState().setIntake(intakeFromAnalysis(t));
  };
  const roofOf = (answers: { id: string; value: string; values: string[] }[]): string => {
    start();
    buildFromInterview(answers);
    return String(useProjectStore.getState().project.selections.roof);
  };
  const clay = [{ id: 'ext.roof-material', value: 'roof-clay-tile', values: [] }];
  const untouched = roofOf(clay);
  const stated = roofOf([...clay, { id: 'ext.roof-colour', value: '#2E3438', values: [] }]);
  check(untouched === 'roof-clay-tile', `a roof colour left at its default keeps the clay tile the client picked (${untouched})`);
  check(stated !== untouched, `and a roof colour they actually chose still re-finishes it (${stated})`);

  const qs = questionsFor('exterior', 'empty-lot');
  const filled = completeAnswers(qs, []);
  check(filled.every((a) => a.fromDefault === true), 'every answer filled in for the client is flagged as theirs-by-default');
  check(defaultAnswers('exterior', 'empty-lot').every((a) => a.fromDefault === true), 'and so is every answer from defaultAnswers');
  const touched = setAnswer(filled, 'ext.roof-colour', '#2E3438');
  check(touched.find((a) => a.id === 'ext.roof-colour')?.fromDefault !== true, 'touching the control makes the answer the client\'s own');
  const again = completeAnswers(qs, touched);
  check(again.find((a) => a.id === 'ext.roof-colour')?.fromDefault !== true, 'and it stays theirs when the interview is completed a second time');
  check(again.find((a) => a.id === 'ext.roof-material')?.fromDefault === true, 'while the ones they never touched stay defaults');
  /*
   * And what the GEOMETRY assumed reaches the same place the client reads the
   * rest: `EstimatePanel` lists `detected.assumptions`, and the exterior
   * solver is the one thing in the twin that invents openings nobody
   * described. Rebuilding must refresh that list, never stack a second copy.
   */
  start();
  buildFromInterview([]);
  const builtSpec = useProjectStore.getState().project.spec!;
  const warned = computeExteriorLayout(builtSpec as never).warnings;
  const declared = builtSpec.detected.assumptions.filter((a) => a.startsWith('Assumed: '));
  check(declared.length === warned.length && declared.every((a, i) => a === warned[i]),
    `the openings the solver invented are declared on the spec (${declared.length})`);
  buildFromInterview([]);
  const twice = useProjectStore.getState().project.spec!.detected.assumptions.filter((a) => a.startsWith('Assumed: '));
  check(twice.length === declared.length, 'and rebuilding refreshes them instead of stacking a second copy');

  const reloaded = healIntake({ inputKind: 'empty-lot', answers: again, capturedAt: null });
  check(reloaded?.answers.find((a) => a.id === 'ext.roof-colour')?.fromDefault !== true
    && reloaded?.answers.find((a) => a.id === 'ext.roof-material')?.fromDefault === true,
    'and the difference survives a reload');
}

// ---------------------------------------------------------------------------
console.log('\n16. A floor plan: what the drawing answers, and what it must ask');
{
  /*
   * The line the exterior pass drew, made executable.
   *
   * FEASIBLE off a plan: the room's size, when the sheet carries its own
   * dimension strings, and the wall layout. NOT feasible, and therefore not
   * faked: any finish (a line drawing has no colour in it), and a scale
   * inferred from an assumed door on an undimensioned sheet. Everything
   * refused has to come back as a QUESTION — the whole point of refusing.
   */
  const observation = (slot: string) => ({
    slot, family: 'paint' as const, baseColorHex: '#1E4620', accentColorHex: null,
    pattern: 'solid' as const, sheen: 'satin' as const, moduleIn: null, groutColorHex: null,
    description: 'a colour no drawing could have shown', visibility: 'clear' as const, plankRun: null,
  });
  const plan = (): KitchenSpec => {
    const k = defaultKitchen();
    k.detected.inputKind = 'floor-plan';
    k.detected.notes = [];
    k.detected.finishes = [observation('cabinets_base')];
    k.detected.confidence = 0.9;
    return k;
  };

  // ---- (a) a drawing is asked MORE than a photograph, because of the finishes
  const photoQs = questionsFor('kitchen', 'room-photo', defaultKitchen());
  // as the studio sees it: the server has already held the line on the spec
  // before the interview is built from it
  const served = plan();
  applyPlanLimits(served, []);
  const planQs = questionsFor('kitchen', 'floor-plan', served);
  check(planQs.length > photoQs.length, `a plan is asked ${planQs.length} questions where a room photo is asked ${photoQs.length}`);
  const FINISH_QS = ['kitchen.cabinet-material', 'kitchen.cabinet-colour', 'kitchen.countertop', 'kitchen.flooring', 'kitchen.wall-colour', 'kitchen.backsplash-size', 'kitchen.hardware'];
  const missing = FINISH_QS.filter((id) => !planQs.some((q) => q.id === id));
  check(missing.length === 0, `and every finish question is on the plan's list${missing.length ? ` — missing ${missing.join(', ')}` : ''}`);
  check(FINISH_QS.every((id) => !photoQs.some((q) => q.id === id)), 'while a photograph is asked none of them, because it showed them');
  // and this is WHY the server strips: `questionsFor` trusts a 'clear'
  // observation and stops asking about that slot, so one invented colour on a
  // drawing silences the very question it should have provoked.
  check(questionsFor('kitchen', 'floor-plan', plan()).length < planQs.length,
    'an invented observation would have silenced its own question — which is what the strip prevents');
  const bathPlanQs = questionsFor('bathroom', 'floor-plan', (() => {
    const b = defaultBathroom();
    b.detected.inputKind = 'floor-plan';
    applyPlanLimits(b, []);
    return b;
  })());
  check(bathPlanQs.length > questionsFor('bathroom', 'room-photo', defaultBathroom()).length, `and the same holds for a bathroom plan (${bathPlanQs.length})`);

  // ---- (b) the refusal itself: a finish a drawing "saw" is dropped server-side
  const lying = plan();
  const lyingFixes: string[] = [];
  applyPlanLimits(lying, lyingFixes);
  check(lying.detected.finishes.length === 0, 'a finish observation on a drawing is dropped before it can mint a material');
  check(lyingFixes.some((f) => f.startsWith('plan: dropped 1 finish observation')), 'and the drop is reported, not silent');
  check(lying.detected.confidence <= 0.4, `confidence is capped at 0.4 however crisp the linework (${lying.detected.confidence})`);
  check(lying.detected.assumptions.some((a) => a.includes('no colour, material or sheen')), 'and the client is told in words why the finishes are placeholders');
  const photoSpec = defaultKitchen();
  photoSpec.detected.finishes = [observation('cabinets_base')];
  photoSpec.detected.confidence = 0.8;
  applyPlanLimits(photoSpec, []);
  check(photoSpec.detected.finishes.length === 1 && photoSpec.detected.confidence === 0.8, 'a photograph\'s readings are left alone — the rule fires on drawings only');

  // ---- (c) a DIMENSIONED plan: the sheet's own numbers stand, and are not re-asked
  const dimensioned = plan();
  dimensioned.dims = { widthFt: 12.5, depthFt: 10, ceilingFt: 9 };
  dimensioned.detected.notes = [`${PLAN_DIM_NOTE} overall width along the sink wall = 12'-6in as drawn`, `${PLAN_DIM_NOTE} depth = 10'-0in as drawn`];
  const dimFixes: string[] = [];
  applyPlanLimits(dimensioned, dimFixes);
  check(!dimensioned.detected.assumptions.includes(PLAN_NO_DIMENSIONS), 'a plan whose dimension strings were read is not declared undimensioned');
  check(dimFixes.some((f) => f === 'plan: 2 dimension strings read off the sheet'), 'and the strings it read are counted in the fixes');
  check(dimensioned.dims.widthFt === 12.5 && dimensioned.dims.depthFt === 10, 'the sizes read off the sheet are left exactly as read');
  check(!planSizeUnknown(dimensioned, 'floor-plan'), 'so the size counts as known');
  const dimQs = questionsFor('kitchen', 'floor-plan', dimensioned);
  check(!dimQs.some((q) => q.id === 'kitchen.room-width' || q.id === 'kitchen.room-depth'), 'and the interview does not ask a size the plan already gave');
  check(dimQs.some((q) => q.id === 'kitchen.ceiling'), 'but it still asks the ceiling height, which is on the elevation sheet, not this one');
  // …and the killer case: a client who clicks straight through the interview
  // must not have a stock 16 ft written over the 12'-6" the sheet says.
  const clickedThrough = applyIntakeAnswers(dimensioned, completeAnswers(dimQs, [])).spec as KitchenSpec;
  check(clickedThrough.dims.widthFt === 12.5 && clickedThrough.dims.depthFt === 10,
    `accepting every default keeps the plan's size (${clickedThrough.dims.widthFt} × ${clickedThrough.dims.depthFt})`);
  // The same must hold through `defaultAnswers`, the other "client skipped the
  // whole interview" door. Handed no spec it cannot see the sheet's numbers,
  // asks the size anyway, and writes the stock 16 × 14 over the 12'-6".
  const skippedAll = applyIntakeAnswers(dimensioned, defaultAnswers('kitchen', 'floor-plan', dimensioned)).spec as KitchenSpec;
  check(skippedAll.dims.widthFt === 12.5 && skippedAll.dims.depthFt === 10,
    `defaultAnswers given the spec keeps the plan's size too (${skippedAll.dims.widthFt} × ${skippedAll.dims.depthFt})`);
  check(!defaultAnswers('kitchen', 'floor-plan', dimensioned).some((a) => a.id === 'kitchen.room-width'),
    'because it asks the size question only when the sheet did not answer it');
  check(defaultAnswers('kitchen', 'floor-plan').some((a) => a.id === 'kitchen.room-width'),
    'and with no spec to consult it still asks — an unknown size is asked, never assumed');

  // ---- (d) an UNDIMENSIONED plan: say so, then ask
  const blind = plan();
  const blindFixes: string[] = [];
  applyPlanLimits(blind, blindFixes);
  check(blind.detected.assumptions.includes(PLAN_NO_DIMENSIONS), 'a plan with no dimension string says so in the assumptions the client reads');
  check(blindFixes.some((f) => f.includes('no dimension strings were read')), 'and in the fixes the studio logs');
  check(planSizeUnknown(blind, 'floor-plan'), 'so the size counts as unknown');
  const blindQs = questionsFor('kitchen', 'floor-plan', blind);
  check(blindQs.some((q) => q.id === 'kitchen.room-width') && blindQs.some((q) => q.id === 'kitchen.room-depth'),
    'and the interview asks how big the room is instead of scaling it off a door');
  const answered = applyIntakeAnswers(blind, [
    { id: 'kitchen.room-width', value: '18.5', values: [] },
    { id: 'kitchen.room-depth', value: '12', values: [] },
    { id: 'kitchen.ceiling', value: '10', values: [] },
  ]);
  check(answered.skipped.length === 0 && (answered.spec as KitchenSpec).dims.widthFt === 18.5
    && (answered.spec as KitchenSpec).dims.depthFt === 12 && (answered.spec as KitchenSpec).dims.ceilingFt === 10,
    'the answers land on dims, and the twin is rebuilt to the client\'s tape measure');
  const blindBath = defaultBathroom();
  blindBath.detected.inputKind = 'floor-plan';
  applyPlanLimits(blindBath, []);
  const blindBathQs = questionsFor('bathroom', 'floor-plan', blindBath);
  check(blindBathQs.some((q) => q.id === 'bath.room-width') && blindBathQs.some((q) => q.id === 'bath.ceiling'),
    'and a bathroom plan asks its own size and ceiling the same way');

  // ---- (e) a bare lot has never been measured either
  check(planSizeUnknown(null, 'empty-lot') && !planSizeUnknown(defaultKitchen(), 'room-photo'),
    'a bare lot is unknown by definition; a photograph is not asked at all');
}

// ---------------------------------------------------------------------------
console.log(`\n${failures === 0 ? 'ALL INTAKE / CONTRACT CHECKS PASSED' : `FAILED (${failures})`} — ${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
