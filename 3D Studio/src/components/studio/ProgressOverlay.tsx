'use client';
/**
 * Cinematic progress overlay shown while photos upload, the analyzer streams
 * events, and the 3D twin is assembled. Also renders the error state.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, RefreshCw, Sparkles, TriangleAlert, Undo2 } from 'lucide-react';
import type { AnalysisPhase } from '@/lib/store/project-store';
import { cx, fmtClock, useElapsed } from './hooks';

const ROTATING: Record<string, string[]> = {
  uploading: ['Optimizing photos for analysis', 'Uploading to secure storage', 'Checking orientation and exposure'],
  analyzing: ['Reading the room geometry', 'Measuring cabinet runs and fixtures', 'Identifying materials and finishes', 'Locating windows and doors', 'Estimating ceiling height from vanishing lines', 'Matching the photo camera'],
  building: ['Assembling the procedural model', 'Streaming PBR textures', 'Placing lights and fixtures', 'Computing the first estimate'],
};

const STEPS: Array<{ id: AnalysisPhase; label: string }> = [
  { id: 'uploading', label: 'Upload' },
  { id: 'analyzing', label: 'Analyze' },
  { id: 'building', label: 'Build' },
];

const PHASE_TITLE: Record<string, string> = {
  uploading: 'Uploading your photos',
  analyzing: 'Reading the space',
  building: 'Building your 3D twin',
};

function creepFor(phase: AnalysisPhase, elapsedMs: number) {
  const t = elapsedMs / 1000;
  if (phase === 'uploading') return 0.24 * (1 - Math.exp(-t / 10));
  if (phase === 'analyzing') return 0.27 + 0.6 * (1 - Math.exp(-Math.max(0, t - 4) / 32));
  if (phase === 'building') return 0.92 + 0.07 * (1 - Math.exp(-t / 3));
  return 0;
}

export function ProgressOverlay({ phase, message, progress, startedAt, photoUrl, photoCount, onRetry, onDemo, onStartOver }: {
  phase: AnalysisPhase;
  message: string;
  progress: number;
  startedAt: number | null;
  photoUrl: string | null;
  photoCount: number;
  onRetry: () => void;
  onDemo: () => void;
  onStartOver: () => void;
}) {
  const isError = phase === 'error';
  const elapsed = useElapsed(startedAt, !isError);
  const lines = ROTATING[phase] ?? ROTATING.analyzing;
  const [lineIdx, setLineIdx] = useState(0);
  useEffect(() => {
    if (isError) return;
    const id = window.setInterval(() => setLineIdx((i) => i + 1), 3200);
    return () => window.clearInterval(id);
  }, [isError, phase]);

  const shown = isError ? progress : Math.min(0.995, Math.max(progress, creepFor(phase, elapsed)));
  const stepIndex = STEPS.findIndex((s) => s.id === phase);
  const primary = message?.trim() || PHASE_TITLE[phase] || 'Working…';
  const secondary = lines[lineIdx % lines.length];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-50 overflow-hidden bg-bg"
      role="dialog"
      aria-live="polite"
      aria-label={isError ? 'Analysis failed' : 'Building your 3D twin'}
    >
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/70 to-bg" />
      <motion.div
        aria-hidden
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: 'linear-gradient(rgba(217,179,107,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(217,179,107,0.10) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(70% 60% at 50% 50%, black 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(70% 60% at 50% 50%, black 30%, transparent 100%)',
        }}
        animate={isError ? { backgroundPosition: '0px 0px' } : { backgroundPosition: ['0px 0px', '48px 48px'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />
      {!isError && (
        <motion.div
          aria-hidden
          className="absolute inset-y-0 w-1/3"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(217,179,107,0.08), transparent)' }}
          animate={{ x: ['-40vw', '140vw'] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <div className="relative flex h-full items-center justify-center px-5">
        <div className="panel w-full max-w-lg px-6 py-7 sm:px-8 sm:py-9">
          {isError ? (
            <div>
              <div className="flex items-center gap-2 text-danger"><TriangleAlert size={16} /><span className="eyebrow !text-danger">Analysis failed</span></div>
              <h2 className="mt-3 font-display text-[30px] leading-tight text-ink">We couldn&apos;t build the twin from those photos.</h2>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted">{message || 'The analyzer returned an error.'}</p>
              <p className="mt-2 text-[12.5px] text-dim">Tips: use wide, well-lit shots taken from the doorway; avoid heavy crops; make sure at least one full wall is visible.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={onRetry}><RefreshCw size={14} /> Retry</button>
                <button type="button" className="btn" onClick={onDemo}><Sparkles size={14} /> Use a demo instead</button>
                <button type="button" className="btn btn-ghost" onClick={onStartOver}><Undo2 size={14} /> Edit photos</button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between">
                <span className="eyebrow">{PHASE_TITLE[phase] ?? 'Working'}</span>
                <span className="chip">{photoCount} photo{photoCount === 1 ? '' : 's'}</span>
              </div>
              <div className="mt-4 flex items-end justify-between gap-4">
                <div className="num font-display text-[64px] leading-none text-ink sm:text-[80px]">{fmtClock(elapsed)}</div>
                <div className="num pb-2 text-[13px] text-muted">{Math.round(shown * 100)}%</div>
              </div>
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full bg-brass" animate={{ width: `${shown * 100}%` }} transition={{ ease: 'easeOut', duration: 0.6 }} />
              </div>
              <div className="mt-5 min-h-[52px]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={primary} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }} className="text-[15px] text-ink">
                    {primary}
                  </motion.div>
                </AnimatePresence>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={secondary} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mt-1 text-[12.5px] text-muted">
                    {secondary}…
                  </motion.div>
                </AnimatePresence>
              </div>
              <ol className="mt-5 flex items-center gap-2">
                {STEPS.map((s, i) => {
                  const done = stepIndex > i;
                  const current = stepIndex === i;
                  return (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className={cx('grid h-5 w-5 place-items-center rounded-full border text-[10px]', done ? 'border-brass bg-brass text-[#141210]' : current ? 'border-brass text-brass' : 'border-border text-dim')}>
                        {done ? <Check size={11} /> : i + 1}
                      </span>
                      <span className={cx('text-[12px]', done || current ? 'text-ink' : 'text-dim')}>{s.label}</span>
                      {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
                    </li>
                  );
                })}
              </ol>
              <div className="mt-5 text-[11.5px] text-dim">Detailed rooms may take several minutes. Keep this tab open — you can start editing materials when the twin appears.</div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
