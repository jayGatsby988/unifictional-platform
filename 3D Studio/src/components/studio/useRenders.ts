'use client';
/**
 * Photoreal render jobs: start (from photo or from the live viewport), poll,
 * persist into the project store, and notify the user.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRenderJob, startRender, uploadViewport } from '@/lib/api-client';
import { captureViewport } from '@/components/scene/SceneCanvas';
import { useProjectStore } from '@/lib/store/project-store';
import type { JobStatus, RenderJob, Project } from '@/lib/spec/types';
import { designFingerprint, snapshotOf } from '@/lib/jarvis/types';
import { isScannedProject, publicImageUrl, scanShareAppearance } from '@/lib/sharing/project';
import { useNativeMesh } from '@/lib/native/mesh-store';
import { scanSlotShowsDesign } from '@/lib/native/scan-finishes';
import { useToast } from './Toast';
import { errorMessage } from './hooks';
import { activeSlotsFor, primaryPhoto } from './projectUtils';
import type { RenderProvider } from './useHealth';

export const RENDER_ETA_MS = 55_000;
const STALE_AFTER_MS = 15 * 60 * 1000;

/** Generic job poller (kept local so it works regardless of the api-client's poll helper shape). */
export async function pollJob<T extends { status: JobStatus }>(
  fetcher: () => Promise<T>,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (job: T) => void; isAlive?: () => boolean } = {},
): Promise<T> {
  const interval = opts.intervalMs ?? 2500;
  const deadline = Date.now() + (opts.timeoutMs ?? 6 * 60 * 1000);
  let failures = 0;
  for (;;) {
    if (opts.isAlive && !opts.isAlive()) throw new Error('Polling cancelled');
    let job: T | null = null;
    try {
      job = await fetcher();
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures >= 4) throw err;
    }
    if (opts.isAlive && !opts.isAlive()) throw new Error('Polling cancelled');
    if (job) {
      opts.onTick?.(job);
      if (job.status === 'completed' || job.status === 'failed') return job;
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for the job to finish.');
    await new Promise<void>((r) => window.setTimeout(r, interval));
  }
}

const isActive = (r: RenderJob) => r.status === 'queued' || r.status === 'running';
const polling = new Set<string>();
export function checkedRenderJob(job: RenderJob): RenderJob {
  return job.status === 'completed' && !publicImageUrl(job.resultUrl)
    ? { ...job, status: 'failed', error: 'The image provider finished without a usable image. Try generating the visualization again.' }
    : job;
}

export interface RendersController {
  renders: RenderJob[];
  running: RenderJob[];
  busy: 'photo' | 'viewport' | null;
  renderFromPhoto: (provider?: RenderProvider) => Promise<void>;
  renderFromViewport: (provider?: RenderProvider) => Promise<void>;
  remove: (id: string) => void;
}

export function useRenders(): RendersController {
  const projectId = useProjectStore(s => s.project.id);
  const renders = useProjectStore((s) => s.project.renders);
  const upsertRender = useProjectStore((s) => s.upsertRender);
  const removeRender = useProjectStore((s) => s.removeRender);
  const setUI = useProjectStore((s) => s.setUI);
  const { toast } = useToast();
  const [busy, setBusy] = useState<'photo' | 'viewport' | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; setBusy(null); }, [projectId]);

  const track = useCallback((id: string) => {
    const owner = useProjectStore.getState().project.id, key = `${owner}/${id}`;
    if (polling.has(key)) return;
    const isAlive = () => { const current = useProjectStore.getState().project; return current.id === owner && current.renders.some(render => render.id === id); };
    polling.add(key);
    void (async () => {
      try {
        const final = checkedRenderJob(await pollJob(() => getRenderJob(id), { intervalMs: 2500, timeoutMs: 6 * 60 * 1000, isAlive, onTick: (j) => upsertRender({ ...checkedRenderJob(j), id }) }));
        if (!isAlive()) return;
        upsertRender({ ...final, id });
        if (final.status === 'completed') {
          toast({ kind: 'success', title: 'Photoreal render ready', description: 'Open it to compare before and after.', action: { label: 'View', onClick: () => setUI({ panel: 'renders', activeRenderId: id }) } });
        } else {
          toast({ kind: 'error', title: 'Render failed', description: final.error || 'The image model returned an error. Try again or switch provider.' });
        }
      } catch (err) {
        if (!isAlive()) return;
        const existing = useProjectStore.getState().project.renders.find((r) => r.id === id);
        if (existing) upsertRender({ ...existing, status: 'failed', error: errorMessage(err, 'Lost contact with the render job.') });
        toast({ kind: 'error', title: 'Render failed', description: errorMessage(err, 'Lost contact with the render job.') });
      } finally {
        polling.delete(key);
      }
    })();
  }, [upsertRender, setUI, toast]);

  // Resume polling for jobs that were in flight when the page was last closed.
  useEffect(() => {
    for (const r of renders) {
      if (!isActive(r) || polling.has(`${projectId}/${r.id}`)) continue;
      const age = Date.now() - new Date(r.createdAt).getTime();
      if (Number.isFinite(age) && age > STALE_AFTER_MS) {
        upsertRender({ ...r, status: 'failed', error: 'This render was started in a session that closed before it finished.' });
      } else {
        track(r.id);
      }
    }
  }, [renders, projectId, track, upsertRender]);

  const startWith = useCallback(async (project: Project, sourceUrl: string, sourceKind: 'photo' | 'viewport', signal: AbortSignal, provider?: RenderProvider) => {
    signal.throwIfAborted();
    if (!project.spec) throw new Error('Build the 3D model before rendering.');
    if (useProjectStore.getState().project.id !== project.id) throw new Error('The active project changed.');
    const response = await startRender({ projectId: project.id, spec: project.spec, selections: project.selections, sourceUrl, sourceKind, provider,
      ...(isScannedProject(project) ? { changedSlots: activeSlotsFor(project.spec, project.roomType, true).filter(slot => scanSlotShowsDesign(project, slot)) } : {}) }, signal);
    signal.throwIfAborted();
    if (useProjectStore.getState().project.id !== project.id) throw new Error('The render belongs to a project that is no longer open.');
    if (!response || typeof response.id !== 'string') throw new Error('The render service did not return a job.');
    const job = checkedRenderJob({ ...response, selections: response.selections ?? { ...project.selections }, sourceUrl: response.sourceUrl ?? sourceUrl, sourceKind: response.sourceKind ?? sourceKind, createdAt: response.createdAt ?? new Date().toISOString(), status: response.status ?? 'queued', designFingerprint: designFingerprint(snapshotOf(project)), ...(isScannedProject(project) ? { scanAppearanceToken: scanShareAppearance(project) } : {}) });
    upsertRender(job);
    setUI({ panel: 'renders' });
    if (job.status === 'failed') throw new Error(job.error || 'The image provider could not complete the visualization.');
    if (isActive(job) || !job.status) track(job.id);
    else if (job.status === 'completed') toast({ kind: 'success', title: 'Photoreal render ready', action: { label: 'View', onClick: () => setUI({ panel: 'renders', activeRenderId: job.id }) } });
    return job;
  }, [upsertRender, setUI, track, toast]);

  const renderFromPhoto = useCallback(async (provider?: RenderProvider) => {
    if (active.current) return;
    const project = structuredClone(useProjectStore.getState().project), photo = primaryPhoto(project);
    if (!photo) {
      toast({ kind: 'error', title: 'No photo to render from', description: 'Use “Render this 3D view” instead, or start a project with photos.' });
      return;
    }
    const controller = new AbortController(); active.current = controller;
    setBusy('photo');
    try {
      const job = await startWith(project, photo.url, 'photo', controller.signal, provider);
      if (isActive(job)) toast({ title: 'Visualization started', description: 'Image generation is in progress. You can keep editing.' });
    } catch (err) {
      if (!controller.signal.aborted) toast({ kind: 'error', title: 'Could not create visualization', description: errorMessage(err) });
    } finally {
      if (active.current === controller) { active.current = null; setBusy(null); }
    }
  }, [startWith, toast]);

  const renderFromViewport = useCallback(async (provider?: RenderProvider) => {
    if (active.current) return;
    const project = structuredClone(useProjectStore.getState().project), fingerprint = project.spec ? designFingerprint(snapshotOf(project)) : null, assets = useNativeMesh.getState();
    const controller = new AbortController(); active.current = controller;
    const assertCurrent = () => {
      controller.signal.throwIfAborted();
      const state = useProjectStore.getState(), live = state.project, mesh = useNativeMesh.getState();
      if (state.ui.jarvisPreview || state.ui.showOriginalPhoto || state.ui.overlayVisible) throw new Error('Open the current design without a staged option or photo overlay before generating its visualization.');
      if (live.id !== project.id || !live.spec || designFingerprint(snapshotOf(live)) !== fingerprint || scanShareAppearance(live) !== scanShareAppearance(project)) throw new Error('The design changed during capture. Generate a visualization from the updated view.');
      if (isScannedProject(project) && (mesh.projectId !== project.id || !mesh.mesh || mesh.mesh !== assets.mesh || mesh.token !== assets.token || mesh.revision !== assets.revision || mesh.texturePending || mesh.planeTexturePending)) throw new Error('The captured scan is still loading. Generate the visualization when its view is ready.');
    };
    setBusy('viewport');
    try {
      assertCurrent();
      const blob = await captureViewport({ signal: controller.signal });
      assertCurrent();
      if (!blob) throw new Error('The 3D viewport is not ready yet — wait for it to finish loading.');
      const url = await uploadViewport(blob, project.id, controller.signal);
      assertCurrent();
      if (typeof url !== 'string' || !url) throw new Error('Viewport upload failed.');
      const job = await startWith(project, url, 'viewport', controller.signal, provider);
      if (isActive(job)) toast({ title: 'Visualization started', description: 'Generating an image from the saved 3D view. Shapes and details may vary.' });
    } catch (err) {
      if (!controller.signal.aborted) toast({ kind: 'error', title: 'Could not create visualization', description: errorMessage(err) });
    } finally {
      if (active.current === controller) { active.current = null; setBusy(null); }
    }
  }, [startWith, toast]);

  const remove = useCallback((id: string) => {
    removeRender(id);
    if (useProjectStore.getState().ui.activeRenderId === id) setUI({ activeRenderId: null });
  }, [removeRender, setUI]);

  const running = useMemo(() => renders.filter(isActive), [renders]);

  return useMemo(() => ({ renders, running, busy, renderFromPhoto, renderFromViewport, remove }), [renders, running, busy, renderFromPhoto, renderFromViewport, remove]);
}
