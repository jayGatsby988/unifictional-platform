'use client';
/**
 * The three-region studio layout: top bar, slot rail, viewport, tabbed panel
 * (bottom sheet on mobile). Owns keyboard shortcuts, share dialog, render
 * suggestions and unsaved-work guards.
 */
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Calculator, ChevronUp, Images, Palette, Ruler, ScanLine } from 'lucide-react';
import { useProjectStore, type UIState } from '@/lib/store/project-store';
import { TopBar } from './TopBar';
import { Viewport } from './Viewport';
import { SlotList } from './SlotRail';
import { MaterialPicker } from './MaterialPicker';
import { LayoutPanel } from './LayoutPanel';
import { EstimatePanel } from './EstimatePanel';
import { RendersPanel } from './RendersPanel';
import { ScanPanel } from './ScanPanel';
import { JarvisPanel } from './JarvisPanel';
import { ShareDialog } from './ShareDialog';
import { Kbd } from './controls';
import { useRenders } from './useRenders';
import { useHealth } from './useHealth';
import { useToast } from './Toast';
import { cx, isTypingTarget, useMediaQuery } from './hooks';
import { primaryPhoto } from './projectUtils';
import { isScannedProject } from '@/lib/sharing/project';

type Panel = UIState['panel'];
const TABS: Array<{ id: Panel; label: string; icon: ComponentType<{ size?: number; className?: string }>; key: string }> = [
  { id: 'materials', label: 'Materials', icon: Palette, key: '1' },
  { id: 'layout', label: 'Layout', icon: Ruler, key: '2' },
  { id: 'estimate', label: 'Estimate', icon: Calculator, key: '3' },
  { id: 'renders', label: 'Renders', icon: Images, key: '4' },
  { id: 'scan', label: 'Scan', icon: ScanLine, key: '5' },
  { id: 'jarvis', label: 'Jarvis', icon: Bot, key: '6' },
];

const SUGGEST_COOLDOWN_MS = 150_000;

export function StudioShell({ onNewProject, embedded = false }: { onNewProject: () => void; embedded?: boolean }) {
  const desktop = useMediaQuery('(min-width: 1024px)', true);
  const panel = useProjectStore((s) => s.ui.panel);
  const setUI = useProjectStore((s) => s.setUI);
  const selectSlot = useProjectStore((s) => s.selectSlot);
  const scans = useProjectStore((s) => s.project.scans);
  const jarvisBusy = useProjectStore((s) => s.ui.jarvisBusy);
  const renders = useRenders();
  const health = useHealth();
  const { toast } = useToast();
  const [shareOpen, setShareOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [builtInMs] = useState<number | null>(() => {
    const t = useProjectStore.getState().ui.analysisStartedAt;
    return t ? Math.max(1000, Date.now() - t) : null;
  });
  const lastSuggest = useRef(0);

  const doRender = useCallback(() => {
    if (renders.busy || useProjectStore.getState().ui.jarvisPreview) return;
    const project = useProjectStore.getState().project;
    const photo = primaryPhoto(project);
    if (photo && !isScannedProject(project)) void renders.renderFromPhoto();
    else void renders.renderFromViewport();
  }, [renders]);

  const openPicker = useCallback(() => {
    setUI({ panel: 'materials' });
    setSheetOpen(true);
  }, [setUI]);

  const selectTab = useCallback((id: Panel) => {
    const alreadyActive = id === useProjectStore.getState().ui.panel;
    setUI({ panel: id });
    if (!desktop) setSheetOpen((open) => !(open && alreadyActive));
  }, [desktop, setUI]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
      if (e.key === 'Escape') {
        const st = useProjectStore.getState();
        if (st.ui.activeRenderId) { setUI({ activeRenderId: null }); return; }
        if (shareOpen) { setShareOpen(false); return; }
        if (st.ui.selectedSlot) selectSlot(null);
        return;
      }
      const tab = TABS.find((t) => t.key === e.key);
      if (tab) { e.preventDefault(); selectTab(tab.id); return; }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); doRender(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doRender, selectSlot, selectTab, setUI, shareOpen]);

  // Nudge toward a photoreal render a little after materials change.
  useEffect(() => {
    let timer: number | null = null;
    const unsub = useProjectStore.subscribe((state, prev) => {
      if (state.project.selections === prev.project.selections) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const now = Date.now();
        if (now - lastSuggest.current < SUGGEST_COOLDOWN_MS) return;
        const st = useProjectStore.getState();
        if (st.project.renders.some((r) => r.status === 'queued' || r.status === 'running')) return;
        if (st.ui.panel === 'renders') return;
        lastSuggest.current = now;
        toast({ title: 'Preview your new finishes', description: isScannedProject(st.project) ? 'Create an AI visualization from the current model. Your captured scan stays unchanged.' : primaryPhoto(st.project) ? 'Create a visualization using your original photo.' : 'Create a visualization from the current model.', durationMs: 9000, action: { label: 'Render', onClick: doRender } });
      }, 6000);
    });
    return () => { unsub(); if (timer) window.clearTimeout(timer); };
  }, [toast, doRender]);

  // Guard against closing the tab while jobs are in flight.
  const jobsRunning = jarvisBusy || renders.running.length > 0 || scans.some((s) => s.status === 'queued' || s.status === 'running');
  useEffect(() => {
    if (!jobsRunning) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [jobsRunning]);

  const panelBody = (
    <>
      <div hidden={panel === 'jarvis'} className="h-full overflow-y-auto p-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={panel} id={panel === 'jarvis' ? undefined : `studio-panel-${panel}`} role="tabpanel" aria-labelledby={`studio-tab-${panel}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }} className="h-full">
            {panel === 'materials' && <MaterialPicker onPicked={() => { if (!desktop) setSheetOpen(true); }} />}
            {panel === 'layout' && <LayoutPanel />}
            {panel === 'estimate' && <EstimatePanel />}
            {panel === 'renders' && <RendersPanel renders={renders} health={health} />}
            {panel === 'scan' && <ScanPanel health={health} />}
          </motion.div>
        </AnimatePresence>
      </div>
      {/* Keep the controller alive across tab changes and collapsed sheets. */}
      <div id="studio-panel-jarvis" role="tabpanel" aria-labelledby="studio-tab-jarvis" hidden={panel !== 'jarvis'} className="h-full">
        <JarvisPanel active={panel === 'jarvis' && (desktop || sheetOpen)} />
      </div>
    </>
  );

  const tabBar = (
    <div role="tablist" aria-label="Panels" className={cx('flex shrink-0 items-stretch border-border', desktop ? 'border-b px-2' : 'px-1')}>
      {TABS.map((t, index) => {
        const Icon = t.icon;
        const active = t.id === panel;
        return (
          <button
            key={t.id}
            id={`studio-tab-${t.id}`}
            role="tab"
            aria-selected={active}
            aria-controls={`studio-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            type="button"
            onClick={() => selectTab(t.id)}
            onKeyDown={(e) => {
              const next = e.key === 'ArrowRight' ? (index + 1) % TABS.length : e.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
              if (next === null) return;
              e.preventDefault();
              setUI({ panel: TABS[next].id });
              if (!desktop) setSheetOpen(true);
              document.getElementById(`studio-tab-${TABS[next].id}`)?.focus();
            }}
            title={`${t.label} (${t.key})`}
            className={cx(
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-brass',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            <Icon size={16} />
            <span>{t.label}</span>
            {active && <motion.span layoutId="tab-underline" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brass" />}
          </button>
        );
      })}
    </div>
  );

  return (
    <div data-mobile-panel-open={!desktop && sheetOpen ? 'true' : undefined} className="studio-workspace flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <TopBar builtInMs={builtInMs} onRender={doRender} onShare={() => setShareOpen(true)} onNewProject={onNewProject} renderBusy={renders.busy !== null} desktop={desktop} embedded={embedded} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {desktop && (
          <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-bg-elev/60">
            <div className="eyebrow border-b border-border px-4 py-3">Surfaces</div>
            <div className="min-h-0 flex-1"><SlotList variant="rail" /></div>
            <div className="border-t border-border px-3 py-2 text-[10.5px] text-dim">
              <div className="flex flex-wrap items-center gap-1"><Kbd>Esc</Kbd> clear · <Kbd>1</Kbd>–<Kbd>6</Kbd> tabs · <Kbd>R</Kbd> render</div>
            </div>
          </aside>
        )}
        <main className="relative min-h-0 min-w-0 flex-1">
          <Viewport onOpenPicker={openPicker} compact={!desktop && sheetOpen} />
        </main>
        <motion.aside
          aria-label="Design controls"
          initial={false}
          animate={{ height: desktop ? '100%' : sheetOpen ? '58dvh' : 'calc(72px + env(safe-area-inset-bottom))' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className={cx('relative flex min-h-0 shrink-0 flex-col', desktop ? 'w-[380px] border-l border-border bg-bg-elev/60' : 'panel-strong z-40 w-full rounded-b-none border-x-0 border-b-0')}
          style={{ paddingBottom: desktop ? undefined : 'env(safe-area-inset-bottom)' }}
        >
          {!desktop && <button type="button" aria-label={sheetOpen ? 'Collapse panel' : 'Expand panel'} aria-expanded={sheetOpen} onClick={() => setSheetOpen((o) => !o)} className="flex h-4 shrink-0 w-full items-center justify-center"><ChevronUp size={14} className={cx('text-dim transition-transform', sheetOpen && 'rotate-180')} /></button>}
          {tabBar}
          <div className={cx('min-h-0 flex-1', !desktop && 'border-t border-border', !desktop && !sheetOpen && 'hidden')}>{panelBody}</div>
        </motion.aside>
      </div>

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
