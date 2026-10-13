'use client';
/**
 * Share dialog — saves the project via the projects API and hands out the
 * read-only /p/<id> link; lets contractors add branding for that page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, ExternalLink, LoaderCircle, RefreshCw, Share2, X } from 'lucide-react';
import { saveProject, uploadViewport } from '@/lib/api-client';
import { useProjectStore } from '@/lib/store/project-store';
import { captureViewport } from '@/components/scene/SceneCanvas';
import { useScanView } from '@/components/scene/scan-view-store';
import { useNativeMesh } from '@/lib/native/mesh-store';
import { captureScanShare, isScannedProject, projectForSharing, scanShareRenders } from '@/lib/sharing/project';
import { useToast } from './Toast';
import { copyText, errorMessage } from './hooks';

type Status = 'idle' | 'saving' | 'saved' | 'error';

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const setBranding = useProjectStore((s) => s.setBranding);
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>('idle');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedVersion, setSavedVersion] = useState<string | null>(null);
  const savedVersionRef = useRef<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const branding = project.branding ?? { company: '' };
  const scanned = isScannedProject(project);
  const hasCompletedVisualization = scanned && scanShareRenders(project).length > 0;
  const currentLink = savedProjectId === project.id ? link : null;

  const save = useCallback(async (opts: { copy?: boolean; useRender?: boolean } = {}) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const current = structuredClone(useProjectStore.getState().project);
    const version = `${current.id}:${current.updatedAt}`;
    const mesh = useNativeMesh.getState();
    const assertCurrent = () => {
      controller.signal.throwIfAborted();
      const live = useProjectStore.getState(), assets = useNativeMesh.getState();
      if (live.project.id !== current.id || live.project.updatedAt !== current.updatedAt) throw new Error('The project changed while preparing the link. Share the updated view again.');
      if (isScannedProject(current) && !opts.useRender && (assets.projectId !== current.id || !assets.mesh || assets.mesh !== mesh.mesh || assets.token !== mesh.token || assets.revision !== mesh.revision || assets.texturePending || assets.planeTexturePending || useScanView.getState().mode !== 'model' || useScanView.getState().ready !== 'model' || live.ui.jarvisPreview || live.ui.showOriginalPhoto || live.ui.overlayVisible)) throw new Error('Open the ready 3D model with overlays closed, then share its scan view.');
    };
    setStatus('saving');
    setError(null);
    try {
      assertCurrent();
      const shared = isScannedProject(current) && !opts.useRender
        ? await captureScanShare(current, { assertCurrent, capture: () => captureViewport({ format: 'png', maxPx: 1600, signal: controller.signal }), upload: uploadViewport }, controller.signal)
        : projectForSharing(current);
      assertCurrent();
      const res = await saveProject(shared, controller.signal);
      assertCurrent();
      const id = res?.id ?? current.id;
      const raw = res?.url ?? `/p/${id}`;
      const url = /^https?:\/\//.test(raw) ? raw : `${window.location.origin}${raw.startsWith('/') ? raw : `/${raw}`}`;
      setLink(url);
      setSavedProjectId(current.id);
      savedVersionRef.current = version;
      setSavedVersion(current.updatedAt);
      setStatus('saved');
      if (opts.copy) {
        const ok = await copyText(url);
        setCopied(ok);
        toast({ kind: 'success', title: ok ? 'Link copied' : 'Project saved', description: ok ? isScannedProject(current) ? opts.useRender ? 'The link shows the completed design visualization and project details.' : 'The link shows the saved scan-view image and project details.' : 'Anyone with the link can view the model, estimate and renders.' : url });
      }
    } catch (err) {
      if (controller.signal.aborted || active.current !== controller) return;
      setStatus('error');
      setError(errorMessage(err, 'The share link could not be saved. Please try again.'));
    } finally { if (active.current === controller) active.current = null; }
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const current = useProjectStore.getState().project;
    if (!isScannedProject(current) && savedVersionRef.current !== `${current.id}:${current.updatedAt}`) void save({ copy: true });
    return () => { active.current?.abort(); active.current = null; setStatus('idle'); };
  }, [open, project.id, save]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const stale = currentLink && status === 'saved' && savedVersion !== project.updatedAt;

  const copy = async () => {
    if (!currentLink) return;
    const ok = await copyText(currentLink);
    setCopied(ok);
    if (!ok) toast({ kind: 'error', title: 'Could not copy', description: currentLink });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="share" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Share project"
            className="panel-strong w-full max-w-lg rounded-b-none p-5 sm:rounded-b-[var(--radius)] sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-brass"><Share2 size={15} /><span className="eyebrow !text-brass">Share</span></div>
                <h2 className="mt-1 font-display text-[26px] leading-tight text-ink">Read-only link</h2>
                <p className="mt-1 text-[12.5px] text-muted">{scanned ? 'Share a saved image of this scan view with project details. The original 3D scan stays on your device; the link is not an interactive model.' : 'Clients see the 3D model, materials, estimate and renders — no editing.'}</p>
              </div>
              <button type="button" aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-ink" onClick={onClose}><X size={18} /></button>
            </div>

            <div className="mt-4">
              {scanned && status !== 'saving' && <div className="mb-3 space-y-2">
                <button type="button" className="btn btn-primary w-full" onClick={() => save({ copy: true })}>Create scan-view link</button>
                {hasCompletedVisualization && <button type="button" className="btn w-full" onClick={() => save({ copy: true, useRender: true })}>Share completed visualization</button>}
                <p className="text-[11px] leading-relaxed text-dim">Creating a link uploads one image of the ready model and the shared project details. Camera and depth archives remain on your device.</p>
              </div>}
              {status === 'saving' && (
                <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-bg-elev px-3 py-2.5 text-[13px] text-muted"><LoaderCircle size={14} className="animate-spin text-brass" /> Saving project…</div>
              )}
              {status === 'error' && (
                <div className="rounded-[var(--radius-sm)] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[12.5px] text-danger">
                  {error}
                  <button type="button" className="btn btn-sm mt-2" onClick={() => save({ copy: true })}><RefreshCw size={12} /> Try again</button>
                </div>
              )}
              {(status === 'saved' || (status === 'idle' && currentLink)) && currentLink && (
                <div className="flex items-center gap-2">
                  <input readOnly value={currentLink} onFocus={(e) => e.currentTarget.select()} className="input h-10 min-w-0 flex-1 font-mono text-[12px]" aria-label="Share link" />
                  <button type="button" className="btn" onClick={copy}>{copied ? <Check size={14} className="text-success" /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
                  <a className="btn w-10 px-0" href={currentLink} target="_blank" rel="noopener noreferrer" aria-label="Open link"><ExternalLink size={14} /></a>
                </div>
              )}
              {stale && (
                <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-warn">
                  <span>You changed the project since this link was saved.</span>
                  <button type="button" className="btn btn-sm" onClick={() => save()}><RefreshCw size={12} /> Update link</button>
                </div>
              )}
            </div>

            <div className="mt-5">
              <div className="eyebrow mb-2">Branding on the share page <span className="normal-case tracking-normal text-dim">(optional)</span></div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input value={branding.company} onChange={(e) => setBranding({ ...branding, company: e.target.value })} placeholder="Company name" className="input h-10" aria-label="Company name" />
                <input value={branding.phone ?? ''} onChange={(e) => setBranding({ ...branding, phone: e.target.value })} placeholder="Phone" className="input h-10" aria-label="Phone" inputMode="tel" />
                <input value={branding.email ?? ''} onChange={(e) => setBranding({ ...branding, email: e.target.value })} placeholder="Email" className="input h-10" aria-label="Email" inputMode="email" />
                <div className="flex items-center gap-2">
                  <input type="color" value={branding.accent ?? '#c9962e'} onChange={(e) => setBranding({ ...branding, accent: e.target.value })} className="h-10 w-12 cursor-pointer rounded-md border border-border-strong bg-bg-elev p-1" aria-label="Accent colour" />
                  <span className="text-[12px] text-muted">Accent colour</span>
                </div>
              </div>
              <input value={branding.logoUrl ?? ''} onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })} placeholder="Logo image URL (https://…)" className="input mt-2 h-10 w-full" aria-label="Logo URL" inputMode="url" />
              <div className="mt-1.5 text-[11px] text-dim">Branding is saved with the project — update the link after editing.</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
