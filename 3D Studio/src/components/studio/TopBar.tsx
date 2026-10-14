'use client';
/**
 * Studio top bar: editable project name, room summary chips, camera mode,
 * quality, share, render, new project, "built in" badge.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardList, Focus, Footprints, Images, LoaderCircle, Orbit, PenLine, Plus, Share2, WandSparkles, Zap } from 'lucide-react';
import { useProjectStore, type CameraMode, type RenderQuality } from '@/lib/store/project-store';
import { summaryFor } from './SceneRouter';
import { Segmented, Select } from './controls';
import { cx, fmtSeconds, useMediaQuery } from './hooks';
import { openMatchReport } from './MatchReport';
import { openInterview, useInterviewStatus } from './Interview';

const QUALITY_OPTIONS: Array<{ value: RenderQuality; label: string }> = [
  { value: 'auto', label: 'Auto quality' },
  { value: 'high', label: 'High' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'performance', label: 'Performance' },
];

function ProjectName() {
  const name = useProjectStore((s) => s.project.name);
  const setName = useProjectStore((s) => s.setName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) setName(v);
    setEditing(false);
  };
  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(name); setEditing(false); } }}
        className="input h-8 w-48 max-w-[40vw] text-[13.5px]"
        aria-label="Project name"
        maxLength={80}
      />
    );
  }
  return (
    <button type="button" onClick={() => { setDraft(name); setEditing(true); }} className="group flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-white/5" title="Rename project">
      <span className="truncate font-display text-[19px] leading-none text-ink">{name}</span>
      <PenLine size={12} className="shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export function TopBar({ builtInMs, onRender, onShare, onNewProject, renderBusy, desktop, embedded = false }: {
  builtInMs: number | null;
  onRender: () => void;
  onShare: () => void;
  onNewProject: () => void;
  renderBusy: boolean;
  desktop: boolean;
  embedded?: boolean;
}) {
  const spec = useProjectStore((s) => s.project.spec);
  const selections = useProjectStore((s) => s.project.selections);
  const cameraMode = useProjectStore((s) => s.ui.cameraMode);
  const quality = useProjectStore((s) => s.ui.quality);
  const fitState = useProjectStore((s) => s.ui.fitState);
  const fitScore = useProjectStore((s) => s.ui.fitScore);
  const fitProportions = useProjectStore((s) => s.ui.fitProportions);
  const setUI = useProjectStore((s) => s.setUI);
  const previewing = useProjectStore((s) => Boolean(s.ui.jarvisPreview));
  const hasPhotos = useProjectStore(s => s.project.photos.length > 0);
  const finePointer = useMediaQuery('(pointer: fine)', false);
  const canWalk = desktop && finePointer;
  const chips = useMemo(() => (spec ? summaryFor(spec, selections) : []), [spec, selections]);
  // A twin built from a plan or a lot stands on the client's ANSWERS, so the
  // answers have to stay reachable — changing one is a design decision, not a
  // reason to re-upload anything.
  const interview = useInterviewStatus();
  // mean IoU of the twin's elements against the photo's boxes — the one
  // number that says how literally the twin matches the picture
  const showFit = fitState === 'running' || (fitScore !== null && fitState !== 'error');

  const [showBadge, setShowBadge] = useState(Boolean(builtInMs));
  useEffect(() => {
    if (!builtInMs) return;
    const id = window.setTimeout(() => setShowBadge(false), 14000);
    return () => window.clearTimeout(id);
  }, [builtInMs]);

  const setCamera = (m: CameraMode) => {
    if (m === 'walk' && !window.matchMedia('(pointer: fine)').matches) {
      setUI({ cameraMode: 'orbit', showOriginalPhoto: false });
      return;
    }
    setUI({ cameraMode: m, showOriginalPhoto: m === 'photo', ...(m === 'walk' ? { selectedSlot: null } : {}) });
  };
  useEffect(() => {
    if ((!canWalk && cameraMode === 'walk') || (!hasPhotos && cameraMode === 'photo')) setUI({ cameraMode: 'orbit', showOriginalPhoto: false });
  }, [canWalk, hasPhotos, cameraMode, setUI]);

  return (
    <header inert={previewing} className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-xl sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        {/* the way back to the agency site, and the product's name in the agency's type */}
        <a href="https://unifictional.com" className="hidden shrink-0 items-center gap-1 font-mono text-[10.5px] tracking-[0.22em] text-muted transition-colors hover:text-ink sm:inline-flex" title="Back to unifictional.com">
          ← UNIFICTIONAL
        </a>
        <span className="hidden h-4 w-px bg-border sm:inline" />
        <span className="hidden shrink-0 font-display text-[15px] tracking-tight text-ink sm:inline"><span className="text-brass">3D Studio</span><span className="text-muted">.</span></span>
        <span className="hidden h-4 w-px bg-border sm:inline" />
        <ProjectName />
        <AnimatePresence>
          {showBadge && builtInMs && (
            <motion.span key="badge" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="chip chip-brass hidden md:inline-flex">
              <Zap size={11} /> Twin built in {fmtSeconds(builtInMs)}
            </motion.span>
          )}
        </AnimatePresence>
        {interview.total > 0 && (
          <button
            type="button"
            className={cx('chip hidden shrink-0 cursor-pointer hover:border-brass/50 hover:text-ink md:inline-flex', interview.done ? '' : 'chip-brass')}
            title={interview.done
              ? 'Change an answer — the twin rebuilds from it, with no re-analysis'
              : 'We could not read the finishes off this upload. Answer a few questions and we will build them.'}
            onClick={openInterview}
          >
            <ClipboardList size={11} />
            {interview.done ? `Your answers · ${interview.answered}/${interview.total}` : `Answer ${interview.total} questions`}
          </button>
        )}
        {showFit && (
          // opens the element-by-element report over the viewport
          <button
            type="button"
            className={cx('chip hidden shrink-0 cursor-pointer hover:border-brass/50 hover:text-ink md:inline-flex', fitState === 'running' ? 'chip-brass' : '')}
            title={fitState === 'running'
              ? 'Projecting the twin onto the photo…'
              : `Photo match = mean overlap of the twin\u2019s elements with the photo\u2019s boxes; Proportions = how close their sizes and positions are (100% = exact; we aim for 90%${fitProportions !== null && fitProportions < 0.9 ? ', and this photo is under it' : ''}). Click for the element-by-element report.`}
            onClick={openMatchReport}
          >
            {fitState === 'running' ? <LoaderCircle size={11} className="animate-spin" /> : <Focus size={11} />}
            {fitState === 'running'
              ? 'Fitting to photo…'
              // two numbers, each labelled: proportions alone reads 15–20 points
              // above the overlap, and unlabelled that is a number massage
              : `Photo match ${Math.round((fitScore ?? 0) * 100)}%${fitProportions !== null ? ` · Proportions ${Math.round(fitProportions * 100)}%` : ''}`}
          </button>
        )}
      </div>

      {desktop && chips.length > 0 && (
        <div className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden xl:flex">
          {chips.map((c) => <span key={c} className="chip shrink-0 capitalize">{c}</span>)}
        </div>
      )}
      <div className="flex-1" />

      {(canWalk || hasPhotos) && <Segmented<CameraMode>
        size="sm"
        value={cameraMode}
        onChange={setCamera}
        options={[
          { value: 'orbit', label: <span className="flex items-center gap-1"><Orbit size={13} />{desktop && 'Orbit'}</span>, title: 'Orbit the model' },
          ...(canWalk ? [{ value: 'walk' as const, label: <span className="flex items-center gap-1"><Footprints size={13} />{desktop && 'Walk'}</span>, title: 'First-person walk (desktop)' }] : []),
          ...(hasPhotos ? [{ value: 'photo' as const, label: <span className="flex items-center gap-1"><Images size={13} />{desktop && 'Photo'}</span>, title: 'Show the original photo side by side' }] : []),
        ]}
      />}
      {desktop && (
        <Select<RenderQuality> ariaLabel="Render quality" value={quality} options={QUALITY_OPTIONS} onChange={(q) => setUI({ quality: q })} className="w-[132px]" />
      )}
      <button type="button" className={cx('btn btn-sm', !desktop && 'w-9 px-0')} onClick={onShare} title="Share a read-only link">
        <Share2 size={14} />{desktop && 'Share'}
      </button>
      <button type="button" className="btn btn-sm btn-primary" onClick={onRender} disabled={renderBusy} title="Render photoreal (R)">
        {renderBusy ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />}
        {desktop ? 'Render photoreal' : 'Render'}
      </button>
      {!embedded && <button type="button" className="btn btn-ghost btn-sm w-9 px-0" onClick={onNewProject} title="New project" aria-label="New project"><Plus size={16} /></button>}
    </header>
  );
}
