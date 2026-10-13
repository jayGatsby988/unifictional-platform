/** Synthetic evidence and local-only storage checks. All captures/uploads and
 * providers are mocked; no private room data or network publication is used. */
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sample from './fixtures/native-countertop-contours.sample.json';
import { importNativeScan } from '../src/lib/native/scan-import';
import { activeSlotsFor } from '../src/components/studio/projectUtils';
import { scanPreviewFinishProject, scanSlotShowsDesign, recordScanFinishChoices } from '../src/lib/native/scan-finishes';
import { designFingerprint, snapshotOf, emptyJarvisState, type DesignOption } from '../src/lib/jarvis/types';
import { buildJarvisProposal } from '../src/lib/jarvis/proposal';
import { estimateSnapshot } from '../src/lib/jarvis/savings';
import { budgetFor, validateDesign } from '../src/lib/jarvis/validation';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { materialsForSlot, CATALOG_BY_ID } from '../src/lib/materials/catalog';
import type { Project, RenderJob } from '../src/lib/spec/types';
import { buildRenderPrompt } from '../src/lib/ai/prompt';
import { captureScanShare, isScannedProject, projectForSharing, publicImageUrl, scanShareAppearance, scanShareRenders, scanShareSnapshot, sharedScanPresentation } from '../src/lib/sharing/project';
import { SharedScanProjectView } from '../src/components/studio/SharedScanProjectView';
import { JarvisProposalView } from '../src/components/studio/JarvisProposalView';
import { RenderCard, RenderLightbox } from '../src/components/studio/RendersPanel';
import { checkedRenderJob, pollJob } from '../src/components/studio/useRenders';
import { ShareDialog } from '../src/components/studio/ShareDialog';
import { ToastProvider } from '../src/components/studio/Toast';
import { useProjectStore } from '../src/lib/store/project-store';
import { PUT } from '../src/app/api/projects/[id]/route';
import { LOCAL_UPLOADS_DIR } from '../src/lib/storage/blob';

const fresh = () => importNativeScan(structuredClone(sample)).project;
const image = () => new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
const imageUrl = '/uploads/viewport/synthetic-room/synthetic-view.png';
const generatedUrl = 'https://example.com/synthetic-generated.png';
const serialize = (project: Project) => JSON.stringify(project);
async function captured(project = fresh()) { return captureScanShare(project, { assertCurrent() {}, capture: async () => image(), upload: async () => imageUrl }, new AbortController().signal); }
function renderFor(project: Project, patch: Partial<RenderJob> = {}): RenderJob {
  return { id: 'synthetic-render', provider: 'openai', status: 'completed', createdAt: project.createdAt, selections: { ...project.selections }, sourceUrl: imageUrl, sourceKind: 'viewport', resultUrl: generatedUrl, prompt: 'Synthetic test only', designFingerprint: designFingerprint(snapshotOf(project)), scanAppearanceToken: scanShareAppearance(project), ...patch };
}
const html = (project: Project) => renderToStaticMarkup(createElement(SharedScanProjectView, { project }));
let passed = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`PASS ${name}`); }

async function main() {
  await check('native JSON alone cannot be published as the original captured 3D model', () => {
    const project = fresh(); assert.equal(isScannedProject(project), true); assert.throws(() => projectForSharing(project), /Capture a ready scan-view image/);
    const page = html(project); assert.match(page, /Scan image not included/); assert.match(page, /original 3D scan is stored/);
    assert.doesNotMatch(page, /<canvas|Drag to orbit|scroll to zoom|3D twin|explorable 3D/i);
  });
  await check('a successful viewport capture binds a saved image without changing the source project or publishing private chat', async () => {
    const project = fresh(); project.jarvis = emptyJarvisState(); project.jarvis.messages.push({ id: 'private', role: 'user', text: 'PRIVATE CONVERSATION', createdAt: project.createdAt });
    project.overrides.privateNativeAsset = 'PRIVATE CAMERA ARCHIVE';
    const original = serialize(project), events: string[] = [];
    const share = await captureScanShare(project, { assertCurrent: () => { events.push('check'); }, capture: async () => { events.push('capture'); return image(); }, upload: async (blob, id) => { events.push('upload'); assert.equal(id, project.id); assert.equal(blob.type, 'image/png'); return imageUrl; } }, new AbortController().signal);
    assert.deepEqual(events, ['check', 'capture', 'check', 'upload', 'check']); assert.equal(serialize(project), original);
    assert.equal(scanShareSnapshot(share)?.designFingerprint, designFingerprint(snapshotOf(project))); assert.equal(scanShareSnapshot(share)?.imageUrl, imageUrl);
    assert.equal(share.jarvis, undefined); assert.equal(share.overrides.nativeScan, undefined); assert.equal(share.overrides.privateNativeAsset, undefined);
    assert.ok(!serialize(share).includes('PRIVATE')); assert.deepEqual(share.spec, project.spec); assert.deepEqual(share.baseline, project.baseline);
    const page = html(share); assert.match(page, /Saved image of the scan view/); assert.ok(page.includes(imageUrl)); assert.doesNotMatch(page, /<canvas|Drag to orbit|3D twin/);
  });
  await check('replacing a material or scan appearance invalidates a saved image instead of relabeling it', async () => {
    const share = await captured();
    for (const change of ['selection', 'appearance', 'geometry'] as const) {
      const later = structuredClone(share);
      if (change === 'selection') later.selections.flooring = 'different-floor';
      else if (change === 'appearance') later.overrides = recordScanFinishChoices(later, later.selections, ['walls']);
      else if (later.spec?.roomType === 'kitchen') later.spec.scanGeometry!.objects[0].transform[12] += 0.01;
      assert.equal(scanShareSnapshot(later), null); assert.equal(sharedScanPresentation(later).kind, 'unavailable');
      assert.throws(() => projectForSharing(later), /Capture a ready/);
    }
  });
  await check('old raw-mesh captures are not relabeled as the current clean reconstruction', async () => {
    const project = await captured();
    const oldToken = JSON.stringify({ mode: 'captured', finishes: {} });
    (project.overrides.sharedScanView as { appearanceToken: string }).appearanceToken = oldToken;
    project.renders = [renderFor(project, { scanAppearanceToken: oldToken })];
    assert.equal(scanShareSnapshot(project), null);
    assert.equal(scanShareRenders(project).length, 0);
    assert.equal(sharedScanPresentation(project).kind, 'unavailable');
  });
  await check('malformed or unsafe image metadata never becomes a visible captured-view image', async () => {
    const share = await captured();
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///private/scan.png', '//foreign.example/photo.png', 'https://user:password@example.com/p.png', '/uploads/viewport/../private.png']) {
      assert.equal(publicImageUrl(url), false, url);
      const changed = structuredClone(share); (changed.overrides.sharedScanView as { imageUrl: string }).imageUrl = url;
      assert.equal(scanShareSnapshot(changed), null);
    }
    const alias = structuredClone(share); (alias.overrides.sharedScanView as object & { extra?: boolean }).extra = true; assert.equal(scanShareSnapshot(alias), null);
    assert.equal(publicImageUrl(imageUrl), true); assert.equal(publicImageUrl(generatedUrl), true);
  });
  await check('cancellation and stale ownership stop each capture stage before publishing a substitute', async () => {
    for (const stage of ['before', 'capture', 'upload', 'stale'] as const) {
      const project = fresh(), controller = new AbortController(), events: string[] = []; let stale = false;
      if (stage === 'before') controller.abort();
      await assert.rejects(captureScanShare(project, {
        assertCurrent() { if (stale) throw new Error('project switched'); },
        capture: async () => { events.push('capture'); if (stage === 'capture') controller.abort(); if (stage === 'stale') stale = true; return image(); },
        upload: async () => { events.push('upload'); if (stage === 'upload') controller.abort(); return imageUrl; },
      }, controller.signal));
      assert.deepEqual(events, stage === 'before' ? [] : stage === 'upload' ? ['capture', 'upload'] : ['capture']);
      assert.equal(project.overrides.sharedScanView, undefined);
    }
  });
  await check('missing, empty, oversized and nonimage captures never call upload', async () => {
    for (const blob of [null, new Blob([], { type: 'image/png' }), new Blob(['not an image'], { type: 'text/html' }), new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/png' })]) {
      let uploaded = false;
      await assert.rejects(captureScanShare(fresh(), { assertCurrent() {}, capture: async () => blob, upload: async () => { uploaded = true; return imageUrl; } }, new AbortController().signal), /could not be captured/);
      assert.equal(uploaded, false);
    }
    await assert.rejects(captureScanShare(fresh(), { assertCurrent() {}, capture: async () => image(), upload: async () => { throw new Error('synthetic upload failure'); } }, new AbortController().signal), /upload failure/);
  });
  await check('only completed design-bound render results can serve as clearly labeled generated visualizations', () => {
    const project = fresh(); project.renders = [renderFor(project, { status: 'running', id: 'running' }), renderFor(project, { status: 'failed', id: 'failed' }), renderFor(project, { designFingerprint: 'stale', id: 'stale' }), renderFor(project, { resultUrl: undefined, id: 'missing-image' }), renderFor(project)];
    assert.deepEqual(scanShareRenders(project).map(render => render.id), ['synthetic-render']);
    const shared = projectForSharing(project); assert.equal(sharedScanPresentation(shared).kind, 'render');
    const page = html(shared); assert.match(page, /AI-generated design visualization/); assert.match(page, /not a measured reconstruction/); assert.doesNotMatch(page, /Saved image of the scan view/);
  });
  await check('native render images are bound to displayed finish intent even when the catalog ID is unchanged', () => {
    const project = fresh(); project.renders = [renderFor(project)]; assert.equal(scanShareRenders(project).length, 1);
    const sameView = structuredClone(project); sameView.overrides.scanReviewedFinishes = { ...project.selections };
    assert.equal(scanShareRenders(sameView).length, 1, 'dormant legacy choices do not change camera appearance');
    const explicit = structuredClone(project); explicit.overrides = recordScanFinishChoices(project, project.selections, ['walls']);
    assert.equal(designFingerprint(snapshotOf(explicit)), designFingerprint(snapshotOf(project)));
    assert.equal(scanShareRenders(explicit).length, 0); assert.throws(() => projectForSharing(explicit), /Capture a ready/);
    explicit.renders = [renderFor(explicit)]; assert.equal(scanShareRenders(explicit).length, 1);
    delete explicit.renders[0].scanAppearanceToken; assert.equal(scanShareRenders(explicit).length, 0, 'legacy unbound generated image is not asserted to depict this view');
  });
  await check('native share pages keep unpriced scan work out of a supposedly complete budget', async () => {
    const project = fresh(); project.selections.island_countertop = materialsForSlot('island_countertop').find(material => material.id !== project.selections.island_countertop)!.id;
    const page = html(await captured(project)); assert.match(page, /Pricing needed/); assert.match(page, /Pricing incomplete/); assert.match(page, /cannot confirm the total project budget/);
    assert.doesNotMatch(page, /No changes from the room as found/);
  });
  await check('ordinary 3D sharing remains available while excluding assistant conversation history', () => {
    const project = fresh(); project.spec = defaultKitchen(); project.jarvis = emptyJarvisState(); const before = serialize(project);
    const shared = projectForSharing(project); assert.equal(isScannedProject(shared), false); assert.deepEqual(shared.spec, project.spec); assert.deepEqual(shared.overrides, project.overrides); assert.equal(shared.jarvis, undefined); assert.equal(serialize(project), before);
  });
  await check('share dialog explains the native image contract and offers an explicit snapshot action', () => {
    const project = fresh(), initial = useProjectStore.getInitialState(), previous = initial.project;
    initial.project = project;
    let markup: string;
    try { markup = renderToStaticMarkup(createElement(ToastProvider, null, createElement(ShareDialog, { open: true, onClose() {} }))); } finally { initial.project = previous; }
    assert.match(markup, /Create scan-view link/); assert.match(markup, /not an interactive model/); assert.match(markup, /Camera and depth archives remain/);
    assert.doesNotMatch(markup, /Clients see the 3D twin/);
  });
  await check('native proposal option links disclose local assets and include only current generated images', () => {
    const project = fresh(), snapshot = snapshotOf(project), estimate = estimateSnapshot(snapshot), constraints = emptyJarvisState().constraints;
    const option: DesignOption = { id: 'native-option', name: 'Retain room', description: 'Original scan retained', createdAt: project.createdAt, snapshot, estimate, validation: validateDesign(snapshot), budget: budgetFor(estimate, constraints) };
    project.jarvis = { ...emptyJarvisState(), options: [option] }; project.renders = [renderFor(project, { optionId: option.id })];
    const { proposal, projects } = buildJarvisProposal({ project, optionIds: [option.id], title: 'Native option' });
    const markup = renderToStaticMarkup(createElement(JarvisProposalView, { proposal }));
    assert.match(markup, /View option details/); assert.match(markup, /original 3D scan remains/); assert.match(markup, /AI-generated visualization/); assert.doesNotMatch(markup, /Explore this 3D design/);
    assert.equal(sharedScanPresentation(projects[0]).kind, 'render');
    assert.doesNotMatch(markup, /Base Cabinets:|White Oak Plank/);
    const explicit = structuredClone(project); explicit.jarvis!.options[0].finishChoices = { walls: explicit.selections.walls };
    const stale = buildJarvisProposal({ project: explicit, optionIds: [option.id], title: 'Explicit paint' }); assert.equal(stale.proposal.renders.length, 0);
    explicit.renders[0].designFingerprint = designFingerprint(stale.proposal.options[0].snapshot);
    explicit.renders[0].scanAppearanceToken = scanShareAppearance(scanPreviewFinishProject(explicit, snapshot, { walls: explicit.selections.walls }));
    const updated = buildJarvisProposal({ project: explicit, optionIds: [option.id], title: 'Explicit paint' }); assert.equal(updated.proposal.renders.length, 1);
    assert.equal(sharedScanPresentation(updated.projects[0]).kind, 'render');
    const old = structuredClone(proposal); old.renders[0].designFingerprint = 'stale';
    assert.ok(!renderToStaticMarkup(createElement(JarvisProposalView, { proposal: old })).includes(generatedUrl));
  });
  await check('captured native render prompts never introduce seeded materials or phantom procedural fixture counts', () => {
    const project = fresh(); assert.ok(project.spec?.roomType === 'kitchen'); assert.equal(project.spec.island.present, false, 'the real scanned island is not a procedural island');
    for (const slots of [undefined, []]) {
      const prompt = buildRenderPrompt(project.spec, project.selections, slots, 'viewport');
      assert.match(prompt, /sole geometry and camera reference/); assert.match(prompt, /curves, bends, raised sections/); assert.match(prompt, /No finish changes are requested/);
      assert.doesNotMatch(prompt, /THE SPACE|EXACT MATERIALS|cabinet runs?\b|CAMERA:|Island:|Flooring:/);
      for (const id of Object.values(project.selections)) if (CATALOG_BY_ID[id]) assert.ok(!prompt.includes(CATALOG_BY_ID[id].prompt), id);
    }
  });
  await check('one explicit native finish cannot repaint the legacy palette or lose the captured island slot', () => {
    const project = fresh(); project.overrides.scanReviewedFinishes = { ...project.selections };
    const selections = { ...project.selections, island_countertop: materialsForSlot('island_countertop').find(material => material.id !== project.selections.island_countertop)!.id };
    project.overrides = recordScanFinishChoices(project, selections); project.selections = selections;
    const slots = Object.keys(selections).filter(slot => scanSlotShowsDesign(project, slot)); assert.deepEqual(slots, ['island_countertop']);
    const prompt = buildRenderPrompt(project.spec!, selections, slots, 'viewport'); assert.match(prompt, /Island Top:/); assert.ok(prompt.includes(CATALOG_BY_ID[selections.island_countertop].prompt));
    assert.doesNotMatch(prompt, /Flooring:|Base Cabinets:|Wall Paint:|with [0-9]+ seats/);
  });
  await check('explicit whole-palette and staged Jarvis option prompts follow the displayed finish mask', () => {
    const project = fresh(); project.overrides.scanReviewedFinishes = { ...project.selections }; project.overrides.scanAppearanceMode = 'design';
    const all = activeSlotsFor(project.spec, project.roomType, true).filter(slot => scanSlotShowsDesign(project, slot));
    assert.ok(all.length > 3); const allPrompt = buildRenderPrompt(project.spec!, project.selections, all, 'viewport');
    for (const slot of all) if (CATALOG_BY_ID[project.selections[slot]]) assert.ok(allPrompt.includes(CATALOG_BY_ID[project.selections[slot]].prompt), slot);
    project.overrides.scanAppearanceMode = 'captured'; const staged = snapshotOf(project); staged.selections.walls = materialsForSlot('walls').find(material => material.id !== project.selections.walls)!.id;
    const preview = scanPreviewFinishProject(project, staged), slots = Object.keys(staged.selections).filter(slot => scanSlotShowsDesign(preview, slot)); assert.deepEqual(slots, ['walls']);
    const prompt = buildRenderPrompt(staged.spec, staged.selections, slots, 'viewport'); assert.ok(prompt.includes(CATALOG_BY_ID[staged.selections.walls].prompt)); assert.doesNotMatch(prompt, /Flooring:|Island Top:/);
    const same = snapshotOf(project), samePreview = scanPreviewFinishProject(project, same, { walls: same.selections.walls });
    const sameSlots = activeSlotsFor(same.spec, project.roomType, true).filter(slot => scanSlotShowsDesign(samePreview, slot));
    assert.deepEqual(sameSlots, ['walls']); assert.ok(buildRenderPrompt(same.spec, same.selections, sameSlots, 'viewport').includes(CATALOG_BY_ID[same.selections.walls].prompt));
    assert.ok(all.includes('hardware'), 'representative clean cabinet pulls support a visible hardware finish edit');
    assert.equal(project.overrides.scanAppearanceMode, 'captured');
    const normal = defaultKitchen(); assert.match(buildRenderPrompt(normal, { ...normal.materials }, undefined, 'viewport'), /THE SPACE/);
  });
  await check('completed render without an image becomes a failure and output labels distinguish AI from source', () => {
    const project = fresh(), response = renderFor(project, { resultUrl: undefined }), original = JSON.stringify(response), checked = checkedRenderJob(response);
    assert.equal(checked.status, 'failed'); assert.equal(JSON.stringify(response), original); assert.match(checked.error!, /without a usable image/);
    const card = renderToStaticMarkup(createElement(RenderCard, { job: response, onOpen() {}, slotsSummary: '' })); assert.match(card, /Failed/); assert.match(card, /disabled/);
    const view = renderToStaticMarkup(createElement(ToastProvider, null, createElement(RenderLightbox, { job: renderFor(project), onClose() {}, slotsSummary: '' })));
    assert.match(view, /Saved 3D view/); assert.match(view, /AI visualization/); assert.match(view, /Generated images can change shapes/);
  });
  await check('an in-flight render poll cannot publish its result after project ownership changes', async () => {
    let active = true, ticks = 0;
    await assert.rejects(pollJob(async () => { active = false; return { status: 'completed' as const }; }, { isAlive: () => active, onTick: () => { ticks++; } }), /Polling cancelled/);
    assert.equal(ticks, 0);
  });
  await check('project API rejects asset-less/stale native shares and persists only synthetic bound images locally', async () => {
    const keys = ['BLOB_READ_WRITE_TOKEN', 'VERCEL'] as const, environment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    keys.forEach(key => { delete process.env[key]; });
    const project = fresh(); project.id = `sharecheck-${randomUUID().slice(0, 16)}`;
    const location = path.join(LOCAL_UPLOADS_DIR, 'projects', `${project.id}.json`);
    const request = (body: Project, signal?: AbortSignal) => new Request(`http://localhost/api/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, signal });
    try {
      const rejected = await PUT(request(project), { params: Promise.resolve({ id: project.id }) }); assert.equal(rejected.status, 400); assert.equal((await rejected.json()).code, 'share_image_required');
      await assert.rejects(readFile(location), { code: 'ENOENT' });
      const share = await captured(project); share.jarvis = emptyJarvisState(); share.jarvis.messages.push({ id: 'secret', role: 'user', text: 'PRIVATE TEST MESSAGE', createdAt: project.createdAt });
      const controller = new AbortController(); controller.abort(); const aborted = await PUT(request(share, controller.signal), { params: Promise.resolve({ id: project.id }) }); assert.equal(aborted.status, 499);
      await assert.rejects(readFile(location), { code: 'ENOENT' });
      const saved = await PUT(request(share), { params: Promise.resolve({ id: project.id }) }); assert.equal(saved.status, 200);
      const bytes = await readFile(location, 'utf8'), stored = JSON.parse(bytes) as Project;
      assert.ok(!bytes.includes('PRIVATE TEST MESSAGE')); assert.equal(scanShareSnapshot(stored)?.imageUrl, imageUrl); assert.deepEqual(stored.spec, project.spec);
      const stale = structuredClone(share); stale.selections.flooring = 'changed-after-image'; assert.equal((await PUT(request(stale), { params: Promise.resolve({ id: project.id }) })).status, 400);
      assert.equal(await readFile(location, 'utf8'), bytes, 'rejected update leaves the previous good share intact');
    } finally {
      await unlink(location).catch(error => { if (error.code !== 'ENOENT') throw error; });
      for (const key of keys) { const value = environment[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
  console.log(`\n${passed} native sharing/render fidelity checks passed.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
