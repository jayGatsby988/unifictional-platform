'use client';
/**
 * Center viewport: SceneCanvas + the room builder for the current spec, plus
 * the HUD (selection pill, hover label, reset view, before-photo thumbnail,
 * walk-mode hint, texture loading bar) and the optional side-by-side photo.
 *
 * In photo mode the canvas is letterboxed to the client photo's aspect ratio,
 * so the frame the accuracy pass screenshots has the same edges as the
 * photograph it is compared with — and the photo itself is laid over the twin
 * at an adjustable opacity, which is how a contractor sees at a glance where
 * the twin still disagrees with the picture.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useFrame, useThree } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import type { PerspectiveCamera } from 'three';
import { Crosshair, Eye, EyeOff, Focus, Footprints, ListChecks, LoaderCircle, MousePointerClick, Palette, ScanLine, TriangleAlert, X } from 'lucide-react';
import { SceneCanvas, type CameraRig } from '@/components/scene/SceneCanvas';
import { materialWorkPending, useMaterialTick } from '@/components/scene/materials';
import { useProjectStore } from '@/lib/store/project-store';
import { getMaterial } from '@/lib/materials/catalog';
import type { Photo } from '@/lib/spec/types';
import { SceneRouter, envFor, useStableRig } from './SceneRouter';
import { primaryPhoto, scanFinishPresentation, slotLabel } from './projectUtils';
import { useAccuracyReport, useCapturePending, useFitToPhoto } from './useAnalysis';
import { MatchReport, toggleMatchReport, useMatchReportOpen } from './MatchReport';
import { RESET_VIEW_EVENT, probePhotoSize, requestResetView, solvedCameraFor } from './photoMatch';
import { useToast } from './Toast';
import { EmptyState, Swatch } from './controls';
import { cx, isTypingTarget } from './hooks';
import { FloorLevelPicker } from './FloorPlanControls';
import { SceneBoundary } from './SceneBoundary';
import { buildFloorPlanNavigation, type FloorPlanNavigation } from '@/components/scene/floorplan/navigation';
import { fitCameraRig } from '@/components/scene/camera-fit';
import { ft } from '@/lib/units';
import { scanPreviewFinishProject } from '@/lib/native/scan-finishes';
import { useScanView } from '@/components/scene/scan-view-store';

export { RESET_VIEW_EVENT, requestResetView };

interface OrbitLike { target: { set: (x: number, y: number, z: number) => void }; update: () => void; enableDamping?: boolean }

/** Lives inside the Canvas; snaps the camera back to the rig on demand (photo mode: back to the photographer's spot and lens). */
function ViewResetter({ rig, navigation }: { rig: CameraRig; navigation?: FloorPlanNavigation | null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const mode = useProjectStore((s) => s.ui.cameraMode);
  useEffect(() => {
    const handler = () => {
      if (mode === 'walk' && navigation !== undefined) {
        if (navigation) {
          const y = navigation.floorY + ft(5.4);
          camera.position.set(navigation.spawn[0], y, navigation.spawn[1]);
          camera.lookAt(navigation.spawn[0], y, navigation.spawn[1] - 1);
        }
        return;
      }
      const persp = camera as PerspectiveCamera;
      const fitted = fitCameraRig(rig, persp.aspect);
      camera.position.set(...fitted.position);
      if (rig.fov && persp.isPerspectiveCamera && persp.fov !== rig.fov) {
        persp.fov = rig.fov;
        persp.updateProjectionMatrix();
      }
      if (controls && typeof controls.update === 'function' && controls.target) {
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        camera.position.set(...fitted.position);
        controls.target.set(...fitted.target);
        controls.update();
        controls.enableDamping = damping;
      } else {
        camera.lookAt(...fitted.target);
      }
    };
    window.addEventListener(RESET_VIEW_EVENT, handler);
    return () => window.removeEventListener(RESET_VIEW_EVENT, handler);
  }, [camera, controls, rig, navigation, mode]);
  return null;
}

/**
 * The photo's width ÷ height. Uploads record pixel size; the demo photo and
 * older projects do not, so the image is decoded once to read it. Null until
 * known — the caller falls back to the default frame rather than guessing.
 */
function usePhotoAspect(photo: Photo | null): number | null {
  const known = photo?.width && photo?.height ? photo.width / photo.height : null;
  const url = photo?.url ?? null;
  const [probed, setProbed] = useState<{ url: string; aspect: number } | null>(null);
  useEffect(() => {
    if (!url || known) return;
    let alive = true;
    // the same probe the fit and the accuracy pass use, so all three agree on the frame
    void probePhotoSize(url).then((size) => {
      if (alive && size) setProbed({ url, aspect: size.width / size.height });
    });
    return () => { alive = false; };
  }, [url, known]);
  return known ?? (probed && probed.url === url ? probed.aspect : null);
}

/** Live width ÷ height of an element (ResizeObserver); null until measured or while inactive. */
function useBoxAspect(ref: RefObject<HTMLDivElement | null>, active: boolean): number | null {
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setAspect(r.width > 0 && r.height > 0 ? r.width / r.height : null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return active ? aspect : null;
}

/** The canvas and the fit disagree on the frame by more than this (2%): the overlay will visibly not line up. */
const ASPECT_MISMATCH = 0.02;

/** Thin brass bar at the top of the viewport while textures / HDRIs stream in. */
function LoadingBar() {
  const { active, progress } = useProgress();
  useMaterialTick();
  return (
    <div className={cx('pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 transition-opacity duration-500', active ? 'opacity-100' : 'opacity-0')} aria-hidden>
      <div className="h-full bg-brass transition-[width] duration-300" style={{ width: `${active ? Math.max(8, progress) : 100}%` }} />
    </div>
  );
}

/**
 * Tells the user the twin is being checked against their photo, and what came
 * of it. The pass runs after the twin is already on screen, so without this it
 * would look like the model silently changed their room.
 */
function AccuracyBadge() {
  const state = useProjectStore((s) => s.ui.accuracyPass);
  const report = useAccuracyReport();
  // Track which pass + phase we dismissed rather than a bare boolean, so a
  // second pass in the same session (same terminal phase as the first) shows
  // its badge again without needing a synchronous reset inside an effect.
  const shown = `${report.pass}:${state}`;
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  useEffect(() => {
    if (state !== 'applied' && state !== 'clean') return;
    const id = window.setTimeout(() => setDismissedFor(shown), 9000);
    return () => window.clearTimeout(id);
  }, [state, shown]);
  if (state === 'idle' || dismissedFor === shown) return null;
  let text: string;
  if (state === 'running') {
    // the loop's own words: which round, and the best score so far
    if (report.phase === 'finishes') text = 'Matching finishes to your photo…';
    else if (report.round === 0) text = 'Checking the twin against your photo…';
    else text = `Matching photo · round ${report.round}${report.score !== null ? ` · ${Math.round(report.score * 100)}%` : ''}`;
  } else if (state === 'applied') {
    const parts: string[] = [];
    if (report.applied) parts.push(`corrected ${report.applied} detail${report.applied === 1 ? '' : 's'}`);
    if (report.finishes) parts.push(`matched ${report.finishes} finish${report.finishes === 1 ? '' : 'es'}`);
    text = `Matched to your photo · ${parts.join(' · ') || 'updated'}`;
  } else {
    text = 'Photo check complete · no further corrections found';
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2"
    >
      <span className={cx('chip whitespace-nowrap backdrop-blur', state === 'running' ? 'chip-brass' : 'bg-black/60 text-white/90')}>
        {state === 'running' && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brass" />}
        {text}
      </span>
    </motion.div>
  );
}

/** Click target for PointerLockControls (selector="#walk-hint"). Hidden while locked. */
function WalkHint() {
  const [locked, setLocked] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const h = () => { setLocked(Boolean(document.pointerLockElement)); if (document.pointerLockElement) setUnavailable(false); };
    const fail = () => setUnavailable(true);
    document.addEventListener('pointerlockchange', h);
    document.addEventListener('pointerlockerror', fail);
    return () => { document.removeEventListener('pointerlockchange', h); document.removeEventListener('pointerlockerror', fail); };
  }, []);
  return (
    <div id="walk-hint" className={cx('absolute inset-0 z-10 flex cursor-pointer items-center justify-center transition-opacity', locked ? 'pointer-events-none opacity-0' : 'opacity-100')}>
      <div className="panel mx-4 flex max-w-sm items-center gap-3 px-4 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-brass text-[#0a0a0a]"><Footprints size={16} /></span>
        <div>
          <div className="text-[13.5px] text-ink" role={unavailable ? 'status' : undefined}>{unavailable ? 'This browser could not start walk controls' : 'Click to look around'}</div>
          <div className="text-[12px] text-muted">{unavailable ? 'Use Orbit here, or open the studio in a desktop browser that supports pointer lock.' : 'W A S D to move · Shift to hurry · Esc to release'}</div>
          {unavailable && <button className="btn btn-sm mt-2" onClick={(e) => { e.stopPropagation(); useProjectStore.getState().setUI({ cameraMode: 'orbit' }); }}>Return to Orbit</button>}
        </div>
      </div>
    </div>
  );
}

/**
 * Photo-mode HUD: the fit button and the overlay crossfade. The overlay is a
 * plain opacity blend of the client's photo over the twin — that is the
 * comparison a contractor reads at a glance ("the fridge is a foot too far
 * left"), and it needs no explanation the way a difference image would.
 */
function PhotoModeControls({ readOnly }: { readOnly: boolean }) {
  const overlayOpacity = useProjectStore((s) => s.ui.overlayOpacity);
  const overlayVisible = useProjectStore((s) => s.ui.overlayVisible);
  const setUI = useProjectStore((s) => s.setUI);
  const { fit, busy, score, canFit } = useFitToPhoto();
  const reportOpen = useMatchReportOpen();
  const { toast } = useToast();
  const pct = Math.round(overlayOpacity * 100);
  const onFit = async () => {
    const r = await fit();
    // the fit writes both numbers to the store; the toast repeats them under
    // their own names, the same way the chip and the report do
    const proportions = useProjectStore.getState().ui.fitProportions;
    const title = r.score !== null
      ? `Photo match ${Math.round(r.score * 100)}%${proportions !== null ? ` · Proportions ${Math.round(proportions * 100)}%` : ''}`
      : 'Fitted to your photo';
    if (r.ok) toast({ kind: 'success', title, description: 'Camera and layout adjusted so the twin lands on the photo.' });
    else if (!r.cancelled) toast({ kind: 'error', title: 'Could not fit to photo', description: r.error });
  };
  return (
    <div className="absolute right-3 top-14 z-10 flex flex-col items-end gap-2">
      {!readOnly && (
        <button
          type="button"
          className="btn btn-sm bg-black/50 backdrop-blur"
          onClick={() => { void onFit(); }}
          disabled={busy || !canFit}
          title={canFit ? 'Adjust camera + layout until the twin lands on the photo' : 'Re-analyze the photo to build an inventory first'}
        >
          {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Focus size={13} />}
          {busy ? 'Fitting…' : 'Fit to photo'}
          {!busy && score !== null && <span className="num text-brass">{Math.round(score * 100)}%</span>}
        </button>
      )}
      <button
        type="button"
        className={cx('btn btn-sm bg-black/50 backdrop-blur', reportOpen && 'text-brass')}
        onClick={toggleMatchReport}
        aria-pressed={reportOpen}
        title="Element-by-element match report"
      >
        <ListChecks size={13} /> Match report
      </button>
      <div className="panel flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          aria-label={overlayVisible ? 'Hide photo overlay (O)' : 'Show photo overlay (O)'}
          title={overlayVisible ? 'Hide photo overlay (O)' : 'Show photo overlay (O)'}
          aria-pressed={overlayVisible}
          onClick={() => setUI({ overlayVisible: !overlayVisible })}
          className={cx('grid h-7 w-7 place-items-center rounded-full hover:bg-white/5', overlayVisible ? 'text-brass' : 'text-muted')}
        >
          {overlayVisible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          aria-label="Photo overlay opacity"
          onChange={(e) => setUI({ overlayOpacity: Number(e.target.value) / 100, overlayVisible: true })}
          className="h-1 w-20 cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brass/40 sm:w-24"
          style={{ background: `linear-gradient(90deg, var(--brass) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`, accentColor: 'var(--brass)' }}
        />
        <span className="num w-8 text-right text-[11px] text-muted">{pct}%</span>
      </div>
    </div>
  );
}

function BeforeThumb({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.button
      type="button"
      aria-label={open ? 'Shrink original photo' : 'Show original photo'}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
      animate={{ width: open ? 320 : 104 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="absolute bottom-4 left-4 z-10 overflow-hidden rounded-[var(--radius-sm)] border border-border-strong bg-black shadow-[var(--shadow-lg)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Original photo" className="block aspect-[4/3] w-full object-cover" draggable={false} />
      <span className="absolute left-2 top-2 chip h-5 bg-black/60 px-1.5 text-[10px] text-white/90">Before</span>
    </motion.button>
  );
}

function JarvisFrameReady({ id }: { id: string | null }) {
  const loading = useProgress((s) => s.active);
  const frames = useRef(0);
  useEffect(() => { frames.current = 0; }, [id, loading]);
  useFrame(() => {
    if (!id) return;
    if (loading || materialWorkPending()) { frames.current = 0; return; }
    if (frames.current >= 4) return;
    frames.current += 1;
    if (frames.current === 4) {
      const store = useProjectStore.getState();
      if (store.ui.jarvisPreview?.id === id) store.setUI({ jarvisPreviewReady: id });
    }
  });
  return null;
}

export function Viewport({ readOnly: readOnlyProp = false, onOpenPicker, className, mobileInset = false, compact = false }: {
  readOnly?: boolean;
  onOpenPicker?: () => void;
  className?: string;
  /** leave room for the mobile bottom sheet */
  mobileInset?: boolean;
  compact?: boolean;
}) {
  const preview = useProjectStore((s) => s.ui.jarvisPreview);
  const project = useProjectStore((s) => s.project);
  const projectId = project.id;
  const finishProject = scanPreviewFinishProject(project, preview?.snapshot, preview?.finishChoices);
  const spec = useProjectStore((s) => s.ui.jarvisPreview?.snapshot.spec ?? s.project.spec);
  const photos = useProjectStore((s) => s.project.photos);
  const scanMode = useScanView((s) => s.mode);
  const observedSource = scanMode === 'source' && Boolean(spec && 'scanGeometry' in spec && spec.scanGeometry);
  const readOnly = readOnlyProp || Boolean(preview) || observedSource;
  const selectedSlot = useProjectStore((s) => s.ui.selectedSlot);
  const hoveredSlot = useProjectStore((s) => s.ui.hoveredSlot);
  const cameraMode = useProjectStore((s) => s.ui.cameraMode);
  const floorPlanLevel = useProjectStore((s) => s.ui.floorPlanLevel);
  const navigation = useMemo(() => spec?.roomType === 'floorplan' ? buildFloorPlanNavigation(spec, floorPlanLevel) : undefined, [spec, floorPlanLevel]);
  const showOriginalPhoto = useProjectStore((s) => s.ui.showOriginalPhoto);
  const overlayOpacity = useProjectStore((s) => s.ui.overlayOpacity);
  const overlayVisible = useProjectStore((s) => s.ui.overlayVisible);
  const selectSlot = useProjectStore((s) => s.selectSlot);
  const capturePending = useCapturePending();
  const photo = primaryPhoto({ photos });
  const photoAspect = usePhotoAspect(photo);
  // 'Photo' mode stands the camera where the client's photo was taken (the
  // fitter's solved camera when there is one, else the analyzer's estimate)
  // and crops the canvas to the photo's frame, so the twin and the photograph
  // can be compared edge to edge. It is also the view the accuracy pass
  // screenshots. Orbit still works there; "Reset to photo view" snaps back.
  const framed = cameraMode === 'photo' && photoAspect !== null;
  const rig = useStableRig(spec, cameraMode === 'photo', photoAspect ?? undefined);

  // The fitter solved its camera against one frame (solved.aspect). If the
  // canvas is letterboxed to a different one — the photo record carried no
  // size when the fit ran and the guess was wrong — the twin is drawn with
  // a lens the fit never scored and the overlay cannot line up. Say so.
  const frameRef = useRef<HTMLDivElement | null>(null);
  const solvedAspect = cameraMode === 'photo' ? solvedCameraFor(spec)?.aspect ?? null : null;
  const canvasAspect = useBoxAspect(frameRef, solvedAspect !== null);
  const aspectMismatch = solvedAspect !== null && canvasAspect !== null && Math.abs(canvasAspect / solvedAspect - 1) > ASPECT_MISMATCH
    ? { canvas: canvasAspect, solved: solvedAspect }
    : null;
  const mismatchKey = aspectMismatch ? `${aspectMismatch.canvas.toFixed(3)}/${aspectMismatch.solved.toFixed(3)}` : null;
  useEffect(() => {
    if (!mismatchKey) return;
    const [canvas, solved] = mismatchKey.split('/');
    console.warn(`[photo view] the canvas frame is ${canvas}:1 but the fit was solved at ${solved}:1 — the photo overlay will not line up; refit to photo`);
  }, [mismatchKey]);

  // O toggles the photo overlay in photo mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
      if (e.key !== 'o' && e.key !== 'O') return;
      const st = useProjectStore.getState();
      if (st.ui.cameraMode !== 'photo') return;
      e.preventDefault();
      st.setUI({ overlayVisible: !st.ui.overlayVisible });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!spec || !rig) {
    return (
      <div className={cx('flex h-full w-full items-center justify-center p-6', className)}>
        <EmptyState title="No 3D twin yet" body="Upload photos or load a demo to build one." />
      </div>
    );
  }

  const showPhotoPane = showOriginalPhoto && Boolean(photo);
  const focusSlot = observedSource ? null : selectedSlot ?? null;
  const hoverFinish = hoveredSlot ? scanFinishPresentation(finishProject, hoveredSlot, scanMode) : null;
  const hoverLabel = !observedSource && hoveredSlot && hoveredSlot !== selectedSlot ? `${slotLabel(hoveredSlot)} · ${hoverFinish?.name ?? ''}` : null;
  const focusFinish = focusSlot ? scanFinishPresentation(finishProject, focusSlot, scanMode) : null;
  const focusMat = focusFinish?.kind === 'catalog' ? getMaterial(focusFinish.materialId) : undefined;
  const focusFinishName = focusFinish?.name ?? '';

  return (
    <div className={cx('relative h-full w-full overflow-hidden bg-bg', className)}>
      {preview && <div className="absolute inset-0 z-50 cursor-progress" aria-label={`Capturing ${preview.name}`} />}
      <div className={cx('absolute inset-0 flex', showPhotoPane ? 'flex-col lg:flex-row' : '')}>
        {showPhotoPane && photo && (
          <div className="relative min-h-0 flex-1 border-b border-border bg-black lg:border-b-0 lg:border-r">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="Original photo" className="h-full w-full object-contain" draggable={false} />
            <span className="chip absolute left-3 top-3 bg-black/60 text-white/90">Original photo</span>
          </div>
        )}
        {/* container-query units size the letterboxed canvas from this box's
            height, so the frame fits whichever way the pane is constrained */}
        <div className="relative min-h-0 flex-1" style={framed ? { containerType: 'size' } : undefined}>
          {/* pointer events are blocked while the accuracy pass is grabbing a
              frame, so a drag cannot move the camera off the photo view
              between the snap and the shot */}
          <div className={cx('absolute inset-0', framed && 'flex items-center justify-center bg-black', (capturePending || preview) && 'pointer-events-none')}>
            <div
              ref={frameRef}
              className={cx(framed ? 'relative' : 'absolute inset-0')}
              style={framed && photoAspect ? { aspectRatio: `${photoAspect}`, width: `min(100%, calc(100cqh * ${photoAspect}))` } : undefined}
            >
              <SceneBoundary key={`${projectId}:${spec.roomType}`}><SceneCanvas env={envFor(spec.roomType)} rig={rig} navigation={navigation} className="absolute inset-0">
                <SceneRouter spec={spec} />
                <ViewResetter rig={rig} navigation={navigation} />
                <JarvisFrameReady id={preview?.id ?? null} />
              </SceneCanvas></SceneBoundary>
              {preview && <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-md border border-brass/30 bg-black/80 px-3 py-2 text-[12px] text-brass">Preparing render · {preview.name}</div>}
              {/* the photo laid over the twin, in the same letterboxed box so
                  the two line up edge for edge; never intercepts the pointer */}
              {framed && photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.url}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill transition-opacity duration-200"
                  style={{ opacity: overlayVisible && !capturePending ? overlayOpacity : 0 }}
                />
              )}
            </div>
          </div>
          {showPhotoPane && <span className="chip absolute left-3 top-3 z-10 bg-black/60 text-white/90">3D twin</span>}
          <AccuracyBadge />
          {spec.roomType === 'floorplan' && <FloorLevelPicker spec={spec} className="absolute left-3 top-3 z-10 max-w-[calc(100%-76px)] rounded-xl border border-border bg-bg/90 px-2 py-1 shadow-lg backdrop-blur" />}
          {capturePending && (
            <span className={cx('chip pointer-events-none absolute z-10 top-3 bg-black/60 text-white/90', showPhotoPane ? 'left-24' : 'left-3')}>
              <LoaderCircle size={12} className="animate-spin text-brass" /> Capturing the photo view…
            </span>
          )}
          {aspectMismatch && !capturePending && (
            <span
              className={cx('chip pointer-events-none absolute z-10 top-12 bg-black/60 text-white/90', showPhotoPane ? 'left-24' : 'left-3')}
              title={`The canvas frame is ${aspectMismatch.canvas.toFixed(2)}:1 but the fit was solved at ${aspectMismatch.solved.toFixed(2)}:1`}
            >
              <TriangleAlert size={12} className="text-brass" /> Frame {aspectMismatch.canvas.toFixed(2)}:1 ≠ fitted {aspectMismatch.solved.toFixed(2)}:1 · refit to photo
            </span>
          )}
          {cameraMode === 'walk' && navigation !== null && <WalkHint />}
          {cameraMode === 'walk' && spec.roomType === 'floorplan' && <div className="pointer-events-none absolute bottom-20 left-1/2 z-10 w-max max-w-[90%] -translate-x-1/2 rounded-xl border border-border bg-bg/90 px-3 py-2 text-center text-[11px] text-muted">{navigation ? 'Use the floor selector to move between levels.' : 'No clear floor area is available to walk on. Choose another floor or return to Orbit.'}</div>}
          {cameraMode === 'photo' && photo && <PhotoModeControls readOnly={readOnly} />}
          {/* the element-by-element match report, docked under the photo-mode controls (or the reset button) */}
          <MatchReport readOnly={readOnly} className={cx('absolute right-3 z-10 w-[300px] max-w-[calc(100%-24px)]', cameraMode === 'photo' && photo ? 'top-[152px]' : 'top-14', mobileInset ? 'bottom-[84px] lg:bottom-16' : 'bottom-16')} />

          {/* hover label */}
          <AnimatePresence>
            {hoverLabel && cameraMode !== 'walk' && (
              <motion.div key="hover" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className={cx('pointer-events-none absolute z-10 top-3', showPhotoPane ? 'left-24' : 'left-3')}>
                <span className="chip bg-black/60 text-white/90">{hoverLabel}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* reset view */}
          <button
            type="button"
            title={cameraMode === 'photo' ? 'Reset to photo view' : 'Reset view'}
            aria-label={cameraMode === 'photo' ? 'Reset to photo view' : 'Reset view'}
            onClick={requestResetView}
            className="absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full border border-border bg-black/50 text-muted backdrop-blur hover:text-ink"
          >
            <Crosshair size={15} />
          </button>

          {/* before thumbnail */}
          {photo && !showPhotoPane && cameraMode === 'orbit' && <BeforeThumb url={photo.url} />}

          {/* selection pill / hint */}
          <div hidden={compact} className={cx('pointer-events-none absolute inset-x-0 z-10 justify-center px-4', compact ? 'hidden' : 'flex', mobileInset ? 'bottom-[76px] lg:bottom-4' : 'bottom-4')}>
            <AnimatePresence mode="wait" initial={false}>
              {focusSlot ? (
                <motion.div key={`sel-${focusSlot}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18 }} className="panel pointer-events-auto flex max-w-full items-center gap-3 py-1.5 pl-2 pr-1.5">
                  {focusFinish?.kind !== 'catalog' ? <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 text-muted"><ScanLine size={18} /></span> : <Swatch material={focusMat} size={28} rounded="rounded-full" />}
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] text-ink">{slotLabel(focusSlot)}</div>
                    <div className="truncate text-[11.5px] text-muted" data-testid="selected-surface-finish">{focusFinishName}</div>
                  </div>
                  {!readOnly && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={onOpenPicker}><Palette size={13} /> Change</button>
                  )}
                  <button type="button" aria-label="Clear selection" className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-ink" onClick={() => selectSlot(null)}><X size={14} /></button>
                </motion.div>
              ) : cameraMode !== 'walk' ? (
                <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="chip bg-black/55 text-white/80">
                  <MousePointerClick size={12} />
                  <span className="lg:hidden">{observedSource ? 'Captured surface · Drag to orbit · Pinch to zoom' : readOnly ? 'Tap a surface · Drag to orbit · Pinch to zoom' : cameraMode === 'photo' ? 'Framed like your photo · Drag to look around' : 'Tap to edit · Drag to orbit · Pinch to zoom'}</span>
                  <span className="hidden lg:inline">{observedSource ? 'Captured surface · drag to orbit · scroll to zoom' : readOnly ? 'Hover any surface to see its material · drag to orbit' : cameraMode === 'photo' ? 'Framed like your photo · drag to look around · ⌖ returns to the photo view · O toggles the overlay' : 'Click any surface to edit · drag to orbit · scroll to zoom'}</span>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <LoadingBar />
    </div>
  );
}
