'use client';
/**
 * Renders tab — start photoreal renders (from the photo or the live 3D view),
 * show progress, gallery, and a before/after lightbox.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Download, ExternalLink, Images, LoaderCircle, Trash, TriangleAlert, WandSparkles, X } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import type { RenderJob } from '@/lib/spec/types';
import { CompareSlider } from './CompareSlider';
import { EmptyState, Select } from './controls';
import { useToast } from './Toast';
import { cx, downloadBlob, errorMessage, fmtClock, useElapsed } from './hooks';
import { primaryPhoto, selectionsSummary, slotsForRoom } from './projectUtils';
import { PROVIDER_LABEL, type Health, type RenderProvider } from './useHealth';
import { RENDER_ETA_MS, type RendersController } from './useRenders';
import { isScannedProject, publicImageUrl } from '@/lib/sharing/project';

export function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function RunningCard({ job }: { job: RenderJob }) {
  const startedAt = useMemo(() => { const t = new Date(job.createdAt).getTime(); return Number.isFinite(t) ? t : 0; }, [job.createdAt]);
  const elapsed = useElapsed(startedAt, true, 500);
  const pct = Math.min(0.96, elapsed / RENDER_ETA_MS);
  return (
    <div className="rounded-[var(--radius-sm)] border border-brass/40 bg-brass-soft/40 p-3">
      <div className="flex items-center gap-2">
        <LoaderCircle size={14} className="animate-spin text-brass" />
        <div className="min-w-0 flex-1 text-[12.5px] text-ink">Rendering {job.sourceKind === 'viewport' ? 'this 3D view' : 'from your photo'}…</div>
        <div className="num text-[12px] text-muted">{fmtClock(elapsed)}</div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-brass transition-[width] duration-500" style={{ width: `${pct * 100}%` }} /></div>
      <div className="mt-1.5 text-[11px] text-dim">{elapsed > RENDER_ETA_MS * 1.3 ? 'Taking longer than usual — still working.' : 'Usually 45–60 seconds. You can keep editing.'}</div>
    </div>
  );
}

export function RenderCard({ job, onOpen, slotsSummary }: { job: RenderJob; onOpen: () => void; slotsSummary: string }) {
  const failed = job.status === 'failed' || (job.status === 'completed' && !publicImageUrl(job.resultUrl));
  const thumb = failed ? job.sourceUrl : job.resultUrl ?? job.sourceUrl;
  return (
    <button type="button" onClick={onOpen} disabled={failed || !job.resultUrl} className={cx('group overflow-hidden rounded-[var(--radius-sm)] border border-border bg-surface/50 text-left transition-colors', !failed && 'hover:border-border-strong', failed && 'cursor-default')}>
      <div className="relative aspect-[4/3] w-full bg-black">
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className={cx('h-full w-full object-cover', failed && 'opacity-40 grayscale')} loading="lazy" />
        )}
        {failed ? (
          <span className="chip absolute left-2 top-2 border-danger/40 bg-danger/20 text-danger"><TriangleAlert size={11} /> Failed</span>
        ) : (
          <span className="chip absolute left-2 top-2 bg-black/60 text-white/90">AI visualization</span>
        )}
      </div>
      <div className="p-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-dim">
          <span>{timeAgo(job.createdAt)}</span>
          <span>{PROVIDER_LABEL[job.provider] ?? job.provider}{job.elapsedMs ? ` · ${Math.round(job.elapsedMs / 1000)}s` : ''}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{failed ? job.error || 'The render provider returned an error.' : slotsSummary || 'Detected materials'}</div>
      </div>
    </button>
  );
}

export function RenderLightbox({ job, onClose, onDelete, slotsSummary }: { job: RenderJob; onClose: () => void; onDelete?: () => void; slotsSummary: string }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const download = async () => {
    if (!job.resultUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(job.resultUrl);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      downloadBlob(blob, `manhattan-render-${job.id}.${blob.type.includes('png') ? 'png' : 'jpg'}`);
    } catch (err) {
      window.open(job.resultUrl, '_blank', 'noopener');
      toast({ title: 'Opened in a new tab', description: errorMessage(err, 'Direct download was blocked by the image host.') });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="fixed inset-0 z-[90] flex flex-col bg-black/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Render comparison">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] text-ink">AI visualization · {job.sourceKind === 'viewport' ? 'from saved 3D view' : 'from photo'}</div>
          <div className="truncate text-[11.5px] text-muted">{PROVIDER_LABEL[job.provider] ?? job.provider} · {timeAgo(job.createdAt)}{slotsSummary ? ` · ${slotsSummary}` : ''}</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={download} disabled={downloading || !job.resultUrl}>{downloading ? <LoaderCircle size={13} className="animate-spin" /> : <Download size={13} />} Download</button>
        {job.resultUrl && <a className="btn btn-sm hidden sm:inline-flex" href={job.resultUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Open</a>}
        {onDelete && <button type="button" className="btn btn-sm text-danger" onClick={() => { if (window.confirm('Delete this render?')) { onDelete(); onClose(); } }}><Trash size={13} /> Delete</button>}
        <button type="button" aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-ink" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {job.resultUrl ? (
          <CompareSlider before={job.sourceUrl} after={job.resultUrl} beforeLabel={job.sourceKind === 'viewport' ? 'Saved 3D view' : 'Source photo'} afterLabel="AI visualization" className="w-full" maxHeightClass="max-h-[calc(100vh-140px)]" />
        ) : (
          <EmptyState title="No image for this render" body={job.error} />
        )}
      </div>
      <div className="px-4 pb-3 text-center text-[11px] text-dim">Generated images can change shapes, colors and details. Use the source view and on-site measurements for verification. Drag the divider or use ← → · Esc to close</div>
    </motion.div>
  );
}

export function RendersPanel({ renders, health }: { renders: RendersController; health: Health }) {
  const project = useProjectStore((s) => s.project);
  const activeRenderId = useProjectStore((s) => s.ui.activeRenderId);
  const setUI = useProjectStore((s) => s.setUI);
  const [provider, setProvider] = useState<RenderProvider | ''>('');
  const photo = primaryPhoto(project);
  const slots = useMemo(() => slotsForRoom(project.roomType), [project.roomType]);
  const providers = health.renderProviders;
  const chosen: RenderProvider | undefined = (provider || providers[0] || undefined) as RenderProvider | undefined;
  const finished = useMemo(() => renders.renders.filter((r) => r.status === 'completed' || r.status === 'failed'), [renders.renders]);
  const active = finished.find((r) => r.id === activeRenderId && r.status === 'completed' && publicImageUrl(r.resultUrl));

  return (
    <div className="pb-6">
      <div className="mb-3">
        <div className="font-display text-[19px] leading-tight text-ink">Photoreal renders</div>
        <div className="text-[11.5px] text-muted">{isScannedProject(project) ? 'Generate a design visualization from the saved scan view. Image generation may alter geometry and details; it does not produce a verified reconstruction.' : 'Generate design visualizations from your photo or 3D view. Shapes and details may vary.'}</div>
      </div>

      {providers.length > 1 && (
        <div className="mb-3">
          <Select<RenderProvider | ''> ariaLabel="Render provider" value={provider || providers[0]} options={providers.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))} onChange={(v) => setProvider(v)} className="w-full" />
        </div>
      )}
      {!health.loading && providers.length === 0 && (
        <div className="mb-3 rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 p-3 text-[12px] text-warn">No image provider is configured. Set OPENAI_API_KEY (or GOOGLE_API_KEY / HIGGSFIELD keys) on the server to enable renders.</div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" className="btn btn-primary justify-start" disabled={!photo || renders.busy !== null} onClick={() => renders.renderFromPhoto(chosen)} title={photo ? 'Apply your selections to the original photo' : 'This project has no photo'}>
          {renders.busy === 'photo' ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />} Render from photo
        </button>
        <button type="button" className="btn justify-start" disabled={renders.busy !== null} onClick={() => renders.renderFromViewport(chosen)} title="Capture the current 3D camera and render it photoreal">
          {renders.busy === 'viewport' ? <LoaderCircle size={14} className="animate-spin" /> : <Camera size={14} />} Render this 3D view
        </button>
      </div>
      {!photo && <div className="mt-2 text-[11px] text-dim">No source photo in this project — render the 3D view instead.</div>}

      {renders.running.length > 0 && (
        <div className="mt-4 space-y-2">
          {renders.running.map((j) => <RunningCard key={j.id} job={j} />)}
        </div>
      )}

      <div className="mt-5">
        <div className="eyebrow mb-2">Gallery · {finished.length}</div>
        {finished.length === 0 ? (
          <EmptyState icon={<Images size={22} />} title="No renders yet" body="Change a few materials, then render to see them photoreal on your photo." />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {finished.map((job) => (
              <RenderCard key={job.id} job={job} onOpen={() => setUI({ activeRenderId: job.id })} slotsSummary={selectionsSummary(job.selections ?? {}, slots, 2)} />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {active && (
          <RenderLightbox key={active.id} job={active} onClose={() => setUI({ activeRenderId: null })} onDelete={() => renders.remove(active.id)} slotsSummary={selectionsSummary(active.selections ?? {}, slots, 3)} />
        )}
      </AnimatePresence>
    </div>
  );
}
