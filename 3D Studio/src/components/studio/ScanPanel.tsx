'use client';
/**
 * Scan tab — optional AI image-to-3D scan (Meshy / Higgsfield), 3–5 minutes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cuboid, Download, LoaderCircle, RefreshCw, ScanLine, TriangleAlert } from 'lucide-react';
import { getScanJob, startScan } from '@/lib/api-client';
import { useProjectStore } from '@/lib/store/project-store';
import type { ScanJob } from '@/lib/spec/types';
import { EmptyState, Select } from './controls';
import { ScanViewer } from './ScanViewer';
import { useToast } from './Toast';
import { cx, errorMessage, fmtClock, useElapsed } from './hooks';
import { primaryPhoto } from './projectUtils';
import { PROVIDER_LABEL, type Health, type ScanProvider } from './useHealth';
import { pollJob } from './useRenders';
import { timeAgo } from './RendersPanel';

const SCAN_ETA_MS = 4 * 60 * 1000;
const STALE_AFTER_MS = 30 * 60 * 1000;
const polling = new Set<string>();
const isActive = (s: ScanJob) => s.status === 'queued' || s.status === 'running';
const normProgress = (p: unknown) => { const n = typeof p === 'number' && Number.isFinite(p) ? p : 0; return Math.max(0, Math.min(1, n > 1 ? n / 100 : n)); };

function RunningScan({ job }: { job: ScanJob }) {
  const startedAt = useMemo(() => { const t = new Date(job.createdAt).getTime(); return Number.isFinite(t) ? t : 0; }, [job.createdAt]);
  const elapsed = useElapsed(startedAt, true, 1000);
  const pct = Math.max(normProgress(job.progress), Math.min(0.95, elapsed / SCAN_ETA_MS));
  return (
    <div className="rounded-[var(--radius-sm)] border border-brass/40 bg-brass-soft/40 p-3">
      <div className="flex items-center gap-2">
        <LoaderCircle size={14} className="animate-spin text-brass" />
        <div className="min-w-0 flex-1 text-[12.5px] text-ink">Scanning with {PROVIDER_LABEL[job.provider] ?? job.provider}…</div>
        <div className="num text-[12px] text-muted">{fmtClock(elapsed)}</div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-brass transition-[width] duration-700" style={{ width: `${pct * 100}%` }} /></div>
      <div className="mt-1.5 text-[11px] text-dim">Image-to-3D usually takes 3–5 minutes. Keep this tab open; progress is saved.</div>
    </div>
  );
}

export function ScanPanel({ health }: { health: Health }) {
  const project = useProjectStore((s) => s.project);
  const scans = useProjectStore((s) => s.project.scans);
  const upsertScan = useProjectStore((s) => s.upsertScan);
  const { toast } = useToast();
  const [provider, setProvider] = useState<ScanProvider | ''>('');
  const [starting, setStarting] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const photo = primaryPhoto(project);
  const providers = health.scanProviders;
  const chosen = (provider || providers[0] || undefined) as ScanProvider | undefined;

  const track = useCallback((id: string) => {
    if (polling.has(id)) return;
    polling.add(id);
    void (async () => {
      try {
        const final = await pollJob(() => getScanJob(id), { intervalMs: 5000, timeoutMs: 20 * 60 * 1000, onTick: (j) => upsertScan({ ...j, id }) });
        upsertScan({ ...final, id });
        if (final.status === 'completed') toast({ kind: 'success', title: '3D scan ready', description: 'Open the Scan tab to orbit it.' });
        else toast({ kind: 'error', title: 'Scan failed', description: final.error || 'The scan provider returned an error.' });
      } catch (err) {
        const existing = useProjectStore.getState().project.scans.find((s) => s.id === id);
        if (existing) upsertScan({ ...existing, status: 'failed', error: errorMessage(err, 'Lost contact with the scan job.') });
      } finally {
        polling.delete(id);
      }
    })();
  }, [upsertScan, toast]);

  useEffect(() => {
    for (const s of scans) {
      if (!isActive(s) || polling.has(s.id)) continue;
      const age = Date.now() - new Date(s.createdAt).getTime();
      if (Number.isFinite(age) && age > STALE_AFTER_MS) upsertScan({ ...s, status: 'failed', error: 'This scan was started in a session that closed before it finished.' });
      else track(s.id);
    }
  }, [scans, track, upsertScan]);

  const start = async () => {
    if (!photo) return;
    setStarting(true);
    try {
      const job: ScanJob = await startScan({ projectId: project.id, imageUrl: photo.url, provider: chosen });
      if (!job || typeof job.id !== 'string') throw new Error('The scan service did not return a job.');
      upsertScan({ ...job, createdAt: job.createdAt ?? new Date().toISOString(), status: job.status ?? 'queued', sourceUrl: job.sourceUrl ?? photo.url });
      if (isActive(job) || !job.status) track(job.id);
      toast({ title: 'Scan started', description: 'Building a textured mesh from your photo — 3 to 5 minutes.' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not start scan', description: errorMessage(err) });
    } finally {
      setStarting(false);
    }
  };

  const running = scans.filter(isActive);
  const done = scans.filter((s) => !isActive(s));
  const completed = done.filter((s) => s.status === 'completed' && s.resultUrl);
  const shown = completed.find((s) => s.id === viewing) ?? completed[0] ?? null;
  const noProvider = !health.loading && providers.length === 0;

  return (
    <div className="pb-6">
      <div className="mb-3">
        <div className="font-display text-[19px] leading-tight text-ink">AI 3D scan</div>
        <div className="text-[11.5px] text-muted">Optional: an image-to-3D model lifts a textured mesh straight from your photo — handy for existing furniture, odd geometry or a quick client walkthrough. The procedural twin stays the editable, priced model.</div>
      </div>

      {noProvider ? (
        <div className="rounded-[var(--radius)] border border-border bg-surface/60 p-4">
          <div className="flex items-center gap-2 text-[13px] text-ink"><ScanLine size={15} className="text-brass" /> Scanning is not enabled on this deployment</div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">Add <code className="rounded bg-white/5 px-1 font-mono text-[11px] text-ink">MESHY_API_KEY</code> or <code className="rounded bg-white/5 px-1 font-mono text-[11px] text-ink">HIGGSFIELD_API_KEY</code> + <code className="rounded bg-white/5 px-1 font-mono text-[11px] text-ink">HIGGSFIELD_API_SECRET</code> to the server environment and restart. Everything else in the studio works without it.</p>
        </div>
      ) : (
        <>
          {providers.length > 1 && (
            <div className="mb-3"><Select<ScanProvider | ''> ariaLabel="Scan provider" value={provider || providers[0]} options={providers.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))} onChange={setProvider} className="w-full" /></div>
          )}
          <button type="button" className="btn btn-primary w-full justify-center" disabled={!photo || starting || running.length > 0 || health.loading} onClick={start}>
            {starting ? <LoaderCircle size={14} className="animate-spin" /> : <Cuboid size={14} />} {running.length > 0 ? 'Scan in progress' : 'Start 3D scan'}
          </button>
          {!photo && <div className="mt-2 text-[11px] text-dim">A scan needs a source photo — this project has none.</div>}
          {photo && <div className="mt-2 text-[11px] text-dim">Uses your primary photo · 3–5 minutes · result is a GLB you can download.</div>}
        </>
      )}

      {running.length > 0 && <div className="mt-4 space-y-2">{running.map((s) => <RunningScan key={s.id} job={s} />)}</div>}

      {shown && (
        <div className="mt-5">
          <div className="eyebrow mb-2">Scan · {timeAgo(shown.createdAt)} · {PROVIDER_LABEL[shown.provider] ?? shown.provider}</div>
          <ScanViewer key={shown.id} url={shown.resultUrl as string} className="aspect-[4/3] w-full" />
          <div className="mt-2 flex flex-wrap gap-2">
            <a className="btn btn-sm" href={shown.resultUrl} target="_blank" rel="noopener noreferrer" download><Download size={13} /> Download GLB</a>
            {completed.length > 1 && completed.map((s) => (
              <button key={s.id} type="button" className={cx('btn btn-sm', s.id === shown.id && 'border-brass text-brass')} onClick={() => setViewing(s.id)}>{timeAgo(s.createdAt)}</button>
            ))}
          </div>
        </div>
      )}

      {done.some((s) => s.status === 'failed') && (
        <div className="mt-4 space-y-2">
          {done.filter((s) => s.status === 'failed').slice(0, 3).map((s) => (
            <div key={s.id} className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-danger/30 bg-danger/10 p-3 text-[12px]">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <div className="text-ink">Scan failed · {timeAgo(s.createdAt)}</div>
                <div className="text-muted">{s.error || 'The provider returned an error.'}</div>
              </div>
              {!noProvider && photo && running.length === 0 && <button type="button" className="btn btn-sm" onClick={start}><RefreshCw size={12} /> Retry</button>}
            </div>
          ))}
        </div>
      )}

      {!shown && running.length === 0 && !noProvider && done.length === 0 && (
        <div className="mt-5"><EmptyState icon={<Cuboid size={22} />} title="No scans yet" body="Start a scan to get a photoreal mesh of the existing space." /></div>
      )}
    </div>
  );
}
