'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useProgress } from '@react-three/drei';
import { useProjectStore } from '@/lib/store/project-store';
import { startRender, uploadViewport } from '@/lib/api-client';
import { captureViewport } from '@/components/scene/SceneCanvas';
import { materialWorkPending, preloadSelections } from '@/components/scene/materials';
import { ensureSpecMaterials } from '@/lib/materials/match';
import { assertSnapshotFresh } from '@/lib/jarvis/project';
import { designFingerprint, emptyJarvisState, snapshotOf, type JarvisActivity, type JarvisMessage, type JarvisProposalLink } from '@/lib/jarvis/types';
import { errorMessage } from './hooks';
import { useToast } from './Toast';
import { scanPreviewFinishProject, scanSlotShowsDesign } from '@/lib/native/scan-finishes';
import { isScannedProject, scanShareAppearance } from '@/lib/sharing/project';
import { useNativeMesh } from '@/lib/native/mesh-store';
import { activeSlotsFor } from './projectUtils';
import { checkedRenderJob } from './useRenders';
import { jarvisClientDeadline, JarvisClientError, jarvisClientErrorMessage, jarvisResponseError, readJarvisStream } from '@/lib/jarvis/client';
export { readJarvisStream } from '@/lib/jarvis/client';

function waitForPreview(id: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const finish = (error?: Error) => { clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('The option’s 3D view did not finish loading. Try rendering it again.')), 25000);
    unsubscribe = useProjectStore.subscribe((s) => { if (s.ui.jarvisPreviewReady === id) finish(); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else if (useProjectStore.getState().ui.jarvisPreviewReady === id) finish();
  });
}

export function useJarvis() {
  const projectId = useProjectStore((s) => s.project.id);
  const savedState = useProjectStore((s) => s.project.jarvis);
  const empty = useMemo(() => emptyJarvisState(), []);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [activity, setActivity] = useState<JarvisActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<JarvisMessage | null>(null);
  const [contextProjectId, setContextProjectId] = useState(projectId);
  const active = useRef<AbortController | null>(null);
  const { toast } = useToast();

  useEffect(() => () => { active.current?.abort(); }, [projectId]);
  const state = useMemo(() => pending && contextProjectId === projectId ? { ...(savedState ?? empty), messages: [...(savedState ?? empty).messages, pending] } : savedState ?? empty, [savedState, empty, pending, contextProjectId, projectId]);

  const renderOne = useCallback(async (optionId: string, signal: AbortSignal, expectedProjectId: string, check = () => signal.throwIfAborted()) => {
    const store = useProjectStore.getState();
    if (store.project.id !== expectedProjectId) throw new Error('The active project changed.');
    const option = store.project.jarvis?.options.find((o) => o.id === optionId);
    if (!option) throw new Error('That option is no longer available.');
    if (!option.validation.valid) throw new Error('Resolve this option’s geometry errors before rendering it.');
    const snapshot = structuredClone(option.snapshot);
    const appearance = scanPreviewFinishProject(store.project, snapshot, option.finishChoices), assets = useNativeMesh.getState();
    const changedSlots = isScannedProject(store.project) ? activeSlotsFor(snapshot.spec, store.project.roomType, true).filter(slot => scanSlotShowsDesign(appearance, slot)) : undefined;
    assertSnapshotFresh(snapshotOf(store.project), snapshot);
    ensureSpecMaterials(structuredClone(snapshot.spec));
    preloadSelections(snapshot.selections);
    const id = nanoid(), previous = { cameraMode: store.ui.cameraMode, showOriginalPhoto: store.ui.showOriginalPhoto, overlayVisible: store.ui.overlayVisible, floorPlanLevel: store.ui.floorPlanLevel };
    setStatus(`Preparing ${option.name} in 3D…`);
    store.setUI({ jarvisPreview: { id, name: option.name, snapshot, finishChoices: option.finishChoices }, jarvisPreviewReady: null, cameraMode: 'orbit', showOriginalPhoto: false, overlayVisible: false, floorPlanLevel: null });
    let sourceUrl: string;
    const assertCaptureContext = () => {
      check();
      const live = useProjectStore.getState();
      if (live.project.id !== expectedProjectId || live.ui.jarvisPreview?.id !== id || live.ui.cameraMode !== 'orbit' || live.ui.floorPlanLevel !== null || live.ui.showOriginalPhoto || live.ui.overlayVisible) throw new Error('The view changed during capture. Render the option again.');
      if (materialWorkPending() || useProgress.getState().active) throw new Error('Materials are still loading. Render the option again after they finish.');
      if (isScannedProject(live.project)) {
        const currentAssets = useNativeMesh.getState();
        if (currentAssets.projectId !== expectedProjectId || !currentAssets.mesh || currentAssets.mesh !== assets.mesh || currentAssets.token !== assets.token || currentAssets.revision !== assets.revision || currentAssets.texturePending || currentAssets.planeTexturePending || scanShareAppearance(scanPreviewFinishProject(live.project, snapshot, option.finishChoices)) !== scanShareAppearance(appearance)) throw new Error('The captured scan or finish preview changed. Render this option again from its ready view.');
        assertSnapshotFresh(snapshotOf(live.project), snapshot);
      }
    };
    try {
      await waitForPreview(id, signal);
      signal.throwIfAborted();
      assertCaptureContext();
      const blob = await captureViewport({ format: 'png', maxPx: 1600, signal });
      if (!blob) throw new Error('The 3D viewport is not ready to capture.');
      signal.throwIfAborted();
      assertCaptureContext();
      sourceUrl = await uploadViewport(blob, expectedProjectId, signal);
      signal.throwIfAborted();
      assertCaptureContext();
    } finally {
      const live = useProjectStore.getState();
      if (live.ui.jarvisPreview?.id === id) live.setUI({ jarvisPreview: null, jarvisPreviewReady: null, ...(live.project.id === expectedProjectId ? previous : {}) });
    }
    setStatus(`Rendering ${option.name} from its 3D model…`);
    const job = await startRender({ projectId: expectedProjectId, spec: snapshot.spec, selections: snapshot.selections, sourceUrl, sourceKind: 'viewport', changedSlots }, signal);
    check();
    if (useProjectStore.getState().project.id !== expectedProjectId) throw new Error('The render finished for a project that is no longer open.');
    const checked = checkedRenderJob({ ...job, optionId, designFingerprint: designFingerprint(snapshot), ...(isScannedProject(store.project) ? { scanAppearanceToken: scanShareAppearance(appearance) } : {}) });
    useProjectStore.getState().upsertRender(checked);
    if (checked.status !== 'completed' || !checked.resultUrl) throw new Error(checked.error || 'The image provider did not finish this render.');
  }, []);

  const proposalFor = useCallback(async (optionIds: string[] | undefined, title: string | undefined, signal: AbortSignal, expectedProjectId: string, check = () => signal.throwIfAborted()) => {
    const project = useProjectStore.getState().project;
    if (project.id !== expectedProjectId) throw new Error('The active project changed.');
    const ids = optionIds?.length ? optionIds : project.jarvis?.options.map((o) => o.id) ?? [];
    if (!ids.length) throw new Error('Create a design option before generating a proposal.');
    setStatus('Preparing the client proposal and option pages…');
    // Only proposal fields go to this endpoint; chat messages are private to the studio.
    const body = { project: { ...snapshotOf(project), id: project.id, name: project.name, branding: project.branding, client: project.client, photos: project.photos, renders: project.renders, overrides: Object.fromEntries(['scanAppearanceMode', 'scanPreviewSlots', 'scanReviewedFinishes'].filter(key => project.overrides[key] !== undefined).map(key => [key, project.overrides[key]])), jarvis: { options: project.jarvis?.options, constraints: project.jarvis?.constraints } }, optionIds: ids, title: (title ?? `${project.name} · Design options`).slice(0, 160) };
    const response = await fetch('/api/jarvis/proposal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) throw await jarvisResponseError(response);
    const link = await response.json() as JarvisProposalLink;
    check();
    if (useProjectStore.getState().project.id !== expectedProjectId) return;
    useProjectStore.getState().addJarvisProposal(link);
    toast({ kind: 'success', title: 'Client proposal ready', description: project.spec && 'scanGeometry' in project.spec && project.spec.scanGeometry ? 'The proposal includes priced option details and completed visualizations. The original 3D scan stays on your device.' : 'The proposal includes priced options and a 3D view for each.', action: { label: 'Open', onClick: () => window.open(link.url, '_blank', 'noopener,noreferrer') } });
  }, [toast]);

  const run = useCallback(async (work: (signal: AbortSignal, id: string, saved: () => void, check: () => void) => Promise<void>) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const deadline = jarvisClientDeadline(controller.signal);
    let responseSaved = false;
    const id = useProjectStore.getState().project.id;
    setContextProjectId(id);
    setBusy(true); setError(null);
    useProjectStore.getState().setUI({ jarvisBusy: true });
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new JarvisClientError('connection', 'You’re offline. Your saved design is available; reconnect to use Jarvis.');
      deadline.check();
      await deadline.run(work(deadline.signal, id, () => { responseSaved = true; }, deadline.check));
      deadline.signal.throwIfAborted(); setStatus('Done');
    } catch (err) {
      if (controller.signal.aborted) setStatus('Stopped');
      else { setError(`${responseSaved ? 'Your completed design response was saved. ' : ''}${jarvisClientErrorMessage(err)}`); setStatus('Needs attention'); }
    } finally {
      deadline.dispose();
      if (active.current === controller) {
        active.current = null; setPending(null); setBusy(false);
        if (useProjectStore.getState().project.id === id) useProjectStore.getState().setUI({ jarvisBusy: false });
      }
    }
  }, []);

  const send = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text || active.current) return;
    await run(async (signal, id, saved, check) => {
      const project = structuredClone(useProjectStore.getState().project);
      if (!project.spec) throw new Error('Build your 3D project first.');
      setActivity([]);
      setPending({ id: nanoid(), role: 'user', text, createdAt: new Date().toISOString() });
      setStatus('Jarvis is reading your project…');
      const response = await fetch('/api/jarvis', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify({ project, message: text }), signal });
      const result = await readJarvisStream(response, (event) => {
        check();
        if (useProjectStore.getState().project.id !== id) return;
        if (event.type === 'status') setStatus(event.message);
        if (event.type === 'activity') setActivity((current) => [...current.filter((a) => a.id !== event.activity.id), event.activity].slice(-40));
      }, signal);
      signal.throwIfAborted();
      check();
      useProjectStore.getState().commitJarvis(id, result, text);
      saved();
      setPending(null);
      const failures: string[] = [];
      for (const request of result.renderRequests) {
        signal.throwIfAborted();
        try { await renderOne(request.optionId, signal, id, check); }
        catch (err) { signal.throwIfAborted(); failures.push(errorMessage(err)); }
      }
      if (result.proposalRequest) {
        signal.throwIfAborted();
        try { await proposalFor(result.proposalRequest.optionIds, result.proposalRequest.title, signal, id, check); }
        catch (err) { signal.throwIfAborted(); failures.push(errorMessage(err)); }
      }
      if (failures.length) throw new Error(failures.join(' '));
    });
  }, [run, renderOne, proposalFor]);

  const applyOption = useCallback((id: string) => {
    if (active.current) return;
    try { useProjectStore.getState().applyJarvisOption(id); setError(null); toast({ kind: 'success', title: 'Option applied to the 3D model', description: 'Materials, quantities and the estimate now follow this design.' }); }
    catch (err) { setError(errorMessage(err)); }
  }, [toast]);
  const undo = useCallback(() => {
    if (active.current) return;
    try { useProjectStore.getState().undoJarvis(); setError(null); toast({ title: 'Previous design restored' }); }
    catch (err) { setError(errorMessage(err)); }
  }, [toast]);
  const renderOption = useCallback((id: string) => run((signal, project, _saved, check) => renderOne(id, signal, project, check)), [run, renderOne]);
  const generateProposal = useCallback((ids?: string[]) => run((signal, project, _saved, check) => proposalFor(ids, undefined, signal, project, check)), [run, proposalFor]);
  const cancel = useCallback(() => { active.current?.abort(); }, []);
  const removeOption = useCallback((id: string) => { if (!active.current) useProjectStore.getState().removeJarvisOption(id); }, []);
  return { state, busy: busy && contextProjectId === projectId, status: contextProjectId === projectId ? status : '', activity: contextProjectId === projectId ? activity : [], error: contextProjectId === projectId ? error : null, send, cancel, applyOption, renderOption, generateProposal, undo, removeOption };
}
