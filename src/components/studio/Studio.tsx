'use client';
/**
 * Studio root — routes between Intake, the progress overlay and the shell
 * based on the store's analysis phase. Client-only (loaded with ssr:false).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useProjectStore } from '@/lib/store/project-store';
import type { RoomType } from '@/lib/spec/types';
import { Intake } from './Intake';
import { Interview } from './Interview';
import { ProgressOverlay } from './ProgressOverlay';
import { UnlockModal, UnlockToast, requestUnlock } from './UnlockModal';
import { StudioShell } from './StudioShell';
import { StudioSkeleton } from './StudioSkeleton';
import { ToastProvider } from './Toast';
import { useAnalysis, type IntakeSubmission } from './useAnalysis';
import { STUDIO_STORAGE_KEY, useHasHydrated } from './hooks';
import { primaryPhoto } from './projectUtils';

const DEMO_TYPES: RoomType[] = ['kitchen', 'bathroom', 'exterior', 'floorplan'];

export default function Studio({ demo, embedded = false }: { demo?: string | null; embedded?: boolean }) {
  return (
    <ToastProvider>
      <StudioInner demo={demo ?? null} embedded={embedded} />
    </ToastProvider>
  );
}

function StudioInner({ demo, embedded }: { demo: string | null; embedded: boolean }) {
  const hydrated = useHasHydrated();
  const phase = useProjectStore((s) => s.ui.analysisPhase);
  const message = useProjectStore((s) => s.ui.analysisMessage);
  const progress = useProjectStore((s) => s.ui.analysisProgress);
  const startedAt = useProjectStore((s) => s.ui.analysisStartedAt);
  const spec = useProjectStore((s) => s.project.spec);
  const photos = useProjectStore((s) => s.project.photos);
  const analysis = useAnalysis();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [unlockToast, setUnlockToast] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  // Back from the $1 checkout (?unlock=<id>): confirm it with the server, which sets the unlock cookie.
  // ?buy=1 (from the Unifictional portal's Plans page) opens the unlock card straight away.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('buy')) {
      url.searchParams.delete('buy');
      window.history.replaceState(null, '', url.pathname + (url.search || ''));
      requestUnlock();
      return;
    }
    const id = url.searchParams.get('unlock');
    if (!id) return;
    url.searchParams.delete('unlock');
    window.history.replaceState(null, '', url.pathname + (url.search || ''));
    let alive = true;
    (async () => {
      let unlocked = false;
      for (let i = 0; i < 5 && !unlocked; i++) {
        const res = await fetch('/api/unlock/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null);
        const j = res ? await res.json().catch(() => ({})) : {};
        unlocked = Boolean(j?.unlocked);
        if (!unlocked) await new Promise((r) => setTimeout(r, 2500));
      }
      if (!alive) return;
      setUnlockToast(unlocked ? 'Unlocked: unlimited scans for 30 days.' : "We couldn't confirm the payment yet. If you paid, try again in a minute.");
      window.setTimeout(() => alive && setUnlockToast(null), 8000);
    })();
    return () => { alive = false; };
  }, []);

  // Make sure we are reading/writing the studio's own storage key (the share
  // page temporarily switches the persisted key so it never clobbers this).
  useEffect(() => {
    const persist = useProjectStore.persist;
    if (persist.getOptions().name !== STUDIO_STORAGE_KEY) {
      persist.setOptions({ name: STUDIO_STORAGE_KEY });
      void persist.rehydrate();
    }
  }, []);

  // Once hydrated: load a demo if requested, else resume a persisted twin.
  useEffect(() => {
    if (!hydrated || bootstrapped.current) return;
    bootstrapped.current = true;
    const wanted = DEMO_TYPES.find((t) => t === demo);
    if (wanted) {
      analysis.useDemo(wanted);
      const url = new URL(window.location.href);
      url.searchParams.delete('demo');
      window.history.replaceState(null, '', url.pathname + (url.search || ''));
      return;
    }
    const st = useProjectStore.getState();
    if (st.project.spec && st.ui.analysisPhase === 'idle') st.setAnalysis('ready', '', 1);
  }, [hydrated, demo, analysis]);

  const onSubmit = useCallback((sub: IntakeSubmission) => {
    setPreviewUrl(sub.previewUrl ?? null);
    void analysis.start(sub);
  }, [analysis]);

  const onDemo = useCallback((roomType: RoomType) => {
    analysis.useDemo(roomType);
  }, [analysis]);

  const onNewProject = useCallback(() => {
    const st = useProjectStore.getState();
    const ok = !st.project.spec || window.confirm('Start a new project? The current twin will be replaced — share it first if you want to keep a link.');
    if (!ok) return;
    st.newProject(st.project.roomType);
    setPreviewUrl(null);
  }, []);

  if (!hydrated) return <StudioSkeleton />;

  const busy = phase === 'uploading' || phase === 'analyzing' || phase === 'building';
  const showOverlay = busy || phase === 'error';
  const overlayPhoto = previewUrl ?? primaryPhoto({ photos })?.url ?? null;

  return (
    <>
      {phase === 'ready' && spec ? (
        <StudioShell onNewProject={onNewProject} embedded={embedded} />
      ) : (
        <Intake onSubmit={onSubmit} onDemo={onDemo} busy={busy} />
      )}
      <AnimatePresence>
        {showOverlay && (
          <ProgressOverlay
            key="progress"
            phase={phase}
            message={message}
            progress={progress}
            startedAt={startedAt}
            photoUrl={overlayPhoto}
            photoCount={photos.length}
            onRetry={analysis.retry}
            onDemo={() => analysis.useDemo(useProjectStore.getState().project.roomType)}
            onStartOver={analysis.cancel}
          />
        )}
      </AnimatePresence>
      {/* The guided interview lives outside the phase switch on purpose: it
          opens over the twin the moment a plan or a lot is analysed, and the
          client can reopen it from the top bar an hour later. It renders
          nothing until it is opened. */}
      <Interview />
      <UnlockModal />
      <UnlockToast text={unlockToast} />
    </>
  );
}
