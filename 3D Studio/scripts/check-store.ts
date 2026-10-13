/**
 * MANHATTAN — headless verification for the persisted-project migration.
 *
 *   npx tsx scripts/check-store.ts
 *
 * The regression that was missing when 8bf586e shipped nullable spec fields
 * with no migration: every persisted project in a browser kept its old shape,
 * the strict RoomSpecZ on /api/refine, /api/fit and /api/render rejected it,
 * and every one of those routes 400'd until the user cleared localStorage.
 *
 * So this drives `migrateProject()` — the pure half of the persist middleware,
 * which must never touch `window` or `localStorage` — with (a) a v4 payload
 * built from the current default kitchen with every new key deleted and (b) a
 * real v3 localStorage payload captured from a client photo, and asserts both
 * come out valid under the strict schema with the new fields at their "nothing
 * yet" value and an as-found baseline in place.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_ESTIMATE_SETTINGS, migrateProject, PERSIST_VERSION, useProjectStore } from '../src/lib/store/project-store';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { RoomSpecZ } from '../src/lib/spec/schema';
import { DEFAULT_SELECTIONS, getMaterial } from '../src/lib/materials/catalog';
import { deltaE, materialColor } from '../src/lib/materials/color';
import { healContract } from '../src/lib/fit/contract';
import type { KitchenSpec, Project } from '../src/lib/spec/types';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.error(`  ✗ ${msg}`); }
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The v4 shape of today's default kitchen: every field this contract added, deleted. */
function v4Payload(): { project: Project } {
  const spec = clone(defaultKitchen()) as KitchenSpec & { detected: { inventory?: unknown } };
  delete spec.detected.inventory;
  delete (spec.decor as { items?: unknown }).items;
  delete (spec.decor as { cabinetContents?: unknown }).cabinetContents;
  for (const a of spec.appliances) delete (a as { cabinetAbove?: unknown }).cabinetAbove;
  delete (spec.backsplash as { heightIn?: unknown }).heightIn;
  delete (spec.countertop as { overhangIn?: unknown }).overhangIn;
  delete (spec.island as { endPlacement?: unknown }).endPlacement;
  delete (spec.island as { endOverhangIn?: unknown }).endOverhangIn;
  delete (spec.island as { stoolOffsetIn?: unknown }).stoolOffsetIn;
  delete (spec.lighting.pendants as { positions?: unknown }).positions;
  for (const run of spec.runs) {
    for (const u of run.uppers ?? []) delete (u as { heightIn?: unknown }).heightIn;
    for (const t of run.tall) delete (t as { toCeiling?: unknown }).toCeiling;
  }
  const est = { ...DEFAULT_ESTIMATE_SETTINGS } as Partial<typeof DEFAULT_ESTIMATE_SETTINGS>;
  delete est.mode;
  delete est.includeKnockOns;
  const project = {
    id: 'v4test', name: 'v4', roomType: 'kitchen', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z',
    photos: [], description: '', spec, selections: { ...DEFAULT_SELECTIONS.kitchen, ...(spec.materials as unknown as Record<string, string>) },
    overrides: {}, estimateSettings: est, renders: [], scans: [],
  } as unknown as Project;
  return { project };
}

console.log('1. A v4 payload with every new key deleted');
{
  const { project } = migrateProject(v4Payload(), 4);
  const spec = project.spec as KitchenSpec;
  const parsed = RoomSpecZ.safeParse(spec);
  check(parsed.success, `migrated spec validates${parsed.success ? '' : `: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`}`);
  check(spec.detected.inventory === null, 'detected.inventory → null');
  check(Array.isArray(spec.decor.items) && spec.decor.items.length === 0, 'decor.items → []');
  check(Array.isArray(spec.decor.cabinetContents) && spec.decor.cabinetContents.length === 0, 'decor.cabinetContents → []');
  check(spec.appliances.every((a) => a.cabinetAbove === null), 'every appliance cabinetAbove → null (nothing invented above the hood)');
  check(spec.backsplash.heightIn === null && spec.countertop.overhangIn === null, 'backsplash.heightIn and countertop.overhangIn → null');
  check(spec.island.endPlacement === 'auto' && spec.island.endOverhangIn === null && spec.island.stoolOffsetIn === 0, 'island end placement / overhang / stool offset → auto, null, 0');
  check(spec.lighting.pendants?.positions === null, 'lighting.pendants.positions → null');
  check(spec.runs.every((r) => (r.uppers ?? []).every((u) => u.heightIn === null)), 'every upper heightIn → null');
  check(spec.runs.every((r) => r.tall.every((t) => t.toCeiling === null)), 'every tall toCeiling → null');
  check(project.estimateSettings.mode === 'changes' && project.estimateSettings.includeKnockOns === true, 'estimateSettings gains mode "changes" and includeKnockOns');
  check(project.estimateSettings.region === 'seattle' && project.estimateSettings.scope === 'pull-and-replace', 'and the settings that were already there survive');
}

console.log('\n2. The as-found baseline is backfilled');
{
  const { project } = migrateProject(v4Payload(), 4);
  const spec = project.spec as KitchenSpec;
  const b = project.baseline;
  check(!!b && b.source === 'migrated', `baseline.source === 'migrated' (${b?.source})`);
  check(!!b && b.capturedAt === project.updatedAt, 'baseline.capturedAt is the project\'s own updatedAt, not now()');
  const want = { ...DEFAULT_SELECTIONS.kitchen, ...(spec.materials as unknown as Record<string, string>) };
  check(!!b && JSON.stringify(b.selections) === JSON.stringify(want), 'baseline.selections = DEFAULT_SELECTIONS + spec.materials (the photo finishes)');
  check(!!b && b.spec !== spec, 'baseline.spec is a clone, so editing the twin does not edit the room as found');
  check(!!b && RoomSpecZ.safeParse(b.spec).success, 'and the cloned baseline spec is itself valid — the clone happens AFTER the repairs');
}

console.log('\n3. A real v3 localStorage payload migrates in one call');
{
  const raw = JSON.parse(readFileSync(new URL('../public/e2e-marble.json', import.meta.url), 'utf8')) as { state: { project: Project }; version: number };
  check(raw.version === 3, `the fixture is a v${raw.version} payload`);
  const { project } = migrateProject(clone(raw.state), raw.version);
  const spec = project.spec as KitchenSpec;
  const parsed = RoomSpecZ.safeParse(spec);
  check(parsed.success, `v3 → v${PERSIST_VERSION} spec validates${parsed.success ? '' : `: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`}`);
  check(spec.detected.inventory === null && Array.isArray(spec.decor.items), 'the v5 fields are filled through the v4 block');
  check(spec.runs.every((r) => r.upperHeightIn !== undefined) && spec.appliances.every((a) => a.heightIn !== undefined), 'and the v4 fields are filled too (one call walks every version)');
  check(project.baseline?.source === 'migrated' && !!project.baseline.spec, 'a baseline is backfilled from the persisted spec');
  check(project.estimateSettings.mode === 'changes', 'estimateSettings.mode === "changes"');
}

console.log('\n4. A v5 payload is returned unchanged');
{
  const once = migrateProject(v4Payload(), 4);
  const before = JSON.stringify(once);
  const twice = migrateProject(clone(once), PERSIST_VERSION);
  check(JSON.stringify(twice) === before, 'migrating an already-current payload changes nothing (idempotent)');
  check(twice.project.baseline?.capturedAt === once.project.baseline?.capturedAt, 'and the baseline is not re-captured with a new timestamp');
}

console.log('\n5. A project with no spec');
{
  const empty = { project: { ...v4Payload().project, spec: null } };
  const { project } = migrateProject(empty, 4);
  check(project.baseline === null, 'baseline stays null — there is no room to record as found');
  check(project.estimateSettings.mode === 'changes', 'the settings still migrate');
}

console.log('\n6. healContract and the v5 migration agree on every contract field');
{
  // Contract §8: a spec reaches /api/fit, /api/refine and /api/render straight
  // from a persisted project OR straight from a share, so the two repair paths
  // must land on the same values. Where they disagree, one of the two routes
  // 400s on a spec the other accepts — the 8bf586e failure exactly.
  const migrated = migrateProject(v4Payload(), 4).project.spec as KitchenSpec;
  const healed = healContract(clone(v4Payload().project.spec) as KitchenSpec) as KitchenSpec;
  check(RoomSpecZ.safeParse(healed).success, 'the healed v4 spec validates under the strict schema');
  const fields: Array<[string, (s: KitchenSpec) => unknown]> = [
    ['detected.inventory', (x) => x.detected.inventory],
    ['decor.items', (x) => x.decor.items],
    ['decor.cabinetContents', (x) => x.decor.cabinetContents],
    ['appliances[].cabinetAbove', (x) => x.appliances.map((a) => a.cabinetAbove)],
    ['backsplash.heightIn', (x) => x.backsplash.heightIn],
    ['countertop.overhangIn', (x) => x.countertop.overhangIn],
    ['island.endPlacement', (x) => x.island.endPlacement],
    ['island.endOverhangIn', (x) => x.island.endOverhangIn],
    ['island.stoolOffsetIn', (x) => x.island.stoolOffsetIn],
    ['lighting.pendants.positions', (x) => x.lighting.pendants?.positions ?? null],
    ['runs[].uppers[].heightIn', (x) => x.runs.map((r) => (r.uppers ?? []).map((u) => u.heightIn))],
    ['runs[].tall[].toCeiling', (x) => x.runs.map((r) => r.tall.map((t) => t.toCeiling))],
  ];
  for (const [name, get] of fields) {
    const a = JSON.stringify(get(migrated)) ?? 'undefined';
    const b = JSON.stringify(get(healed)) ?? 'undefined';
    check(a === b, `${name}: migration ${a} === healContract ${b}`);
  }
}

console.log('\n7. loadProject leaves the share page reading the same materials as the studio');
{
  // The share page (/p/[id]) is the ONLY caller of `loadProject`, and the scene
  // renders and the estimator prices from `selections`, not `spec.materials`.
  // `ensureSpecMaterials` step 2a rewrites a CATALOG id on the spec without
  // recording it in `remap` (a finish the client picked by hand is not a stale
  // id), so `healSelections` alone cannot follow that move: measured on
  // client-tan, spec.materials said backsplash tile-quartz-slab / flooring
  // custom-flooring-c3d04f50 / hardware fin-antique-brass while the share
  // rendered and priced tile-marble-slab / floor-white-oak-plank /
  // fin-brushed-brass. `followSpecMaterials` — which the studio has run on
  // rehydrate all along — closes it, and only for slots the client never
  // changed by hand (that is what the baseline comparison inside it is for).
  const tan = healContract(JSON.parse(readFileSync(new URL('./fixtures/client-tan.spec.json', import.meta.url), 'utf8')) as KitchenSpec) as KitchenSpec;
  const saved: Record<string, string> = { ...DEFAULT_SELECTIONS.kitchen, ...(tan.materials as unknown as Record<string, string>) };
  const shared = {
    ...v4Payload().project,
    spec: tan,
    selections: { ...saved },
    baseline: { spec: clone(tan) as unknown as KitchenSpec, selections: { ...saved }, capturedAt: 0 },
  } as unknown as Project;
  useProjectStore.getState().loadProject(shared);
  const sel = useProjectStore.getState().project.selections as Record<string, string>;
  const want = useProjectStore.getState().project.spec!.materials as unknown as Record<string, string>;
  const adrift = Object.keys(want).filter((k) => want[k] && sel[k] !== want[k]);
  check(adrift.length === 0, `every slot the spec names is the slot the share renders and prices${adrift.length ? `: adrift ${adrift.map((k) => `${k} ${sel[k]} vs ${want[k]}`).join(', ')}` : ` (${Object.keys(want).length} slots)`}`);

  // …and a slot the client DID change by hand still stays theirs.
  const picked = { ...saved, countertop: 'ct-black-granite' };
  useProjectStore.getState().loadProject({
    ...shared, selections: picked,
    baseline: { spec: clone(tan) as unknown as KitchenSpec, selections: { ...saved }, capturedAt: 0 },
  } as unknown as Project);
  check(useProjectStore.getState().project.selections.countertop === 'ct-black-granite', 'a finish the client picked by hand is not overwritten by the spec');
}

// Reopen a project from the old sibling unification: one persisted custom id
// must split by slot, including the as-found map, without changing a manual pick.
{
  const spec = defaultKitchen();
  const colors = { cabinets_base: '#D9D9D3', cabinets_upper: '#C7C8C2', cabinets_tall: '#D0D0CA' };
  spec.detected.finishes = Object.entries(colors).map(([slot, baseColorHex]) => ({
    slot, family: 'paint', baseColorHex, accentColorHex: null, pattern: 'solid', sheen: 'satin',
    moduleIn: null, groutColorHex: null, description: 'observed gray paint', visibility: 'clear', plankRun: null,
  }));
  for (const slot of Object.keys(colors) as Array<keyof typeof colors>) spec.materials[slot] = 'custom-cabinets_base-oldsharedgrey';
  const saved = { ...spec.materials };
  const project = {
    ...v4Payload().project, spec, selections: { ...saved, cabinets_upper: 'cab-hale-navy' },
    baseline: { spec: clone(spec), selections: saved, capturedAt: 0 },
  } as unknown as Project;
  useProjectStore.getState().loadProject(project);
  const restored = useProjectStore.getState().project;
  for (const [slot, want] of Object.entries(colors)) {
    const id = restored.baseline!.selections[slot];
    const hex = materialColor(getMaterial(id)!);
    check(!!hex && deltaE(hex, want) < 0.01, `${slot} saved baseline preserves its distinct observed gray`);
    check(slot === 'cabinets_upper' ? restored.selections[slot] === 'cab-hale-navy' : restored.selections[slot] === id, `${slot} reload follows its own repair and preserves manual paint`);
  }
}

console.log(failures ? `\n${failures} store check(s) FAILED` : '\nAll store checks passed');
process.exit(failures ? 1 : 0);
