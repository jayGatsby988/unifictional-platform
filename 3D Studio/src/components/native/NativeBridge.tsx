'use client';
import { useEffect, useState } from 'react';
import { useProjectStore } from '@/lib/store/project-store';
import { installNativeBridge, type NativeBridgeHost, type NativeEvent } from '@/lib/native/bridge';
import StudioLoader from '@/components/studio/StudioLoader';
import { STUDIO_STORAGE_KEY } from '@/components/studio/hooks';
import { useScanView } from '@/components/scene/scan-view-store';
import { activeSlotsFor } from '@/components/studio/projectUtils';
import { scanPreviewFinishProject, scanSlotShowsDesign } from '@/lib/native/scan-finishes';
import { useObjectAppearance } from '@/lib/native/object-appearance-store';
import { useMirrorDetails } from '@/lib/native/mirror-store';
import { useNativeMesh } from '@/lib/native/mesh-store';
import { ScanFinishReview } from './ScanFinishReview';

declare global {
  interface Window extends NativeBridgeHost {
    webkit?: { messageHandlers?: { manhattan?: { postMessage(event: NativeEvent): void } } };
  }
}

export function NativeBridge() {
  const [imported, setImported] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mode = useScanView(s => s.mode);
  const ready = useScanView(s => s.ready);
  const setMode = useScanView(s => s.setMode);
  const focus = useScanView(s => s.focus);
  const setFocus = useScanView(s => s.setFocus);
  const project = useProjectStore(s => s.project);
  const partialRaisedCountertop = useScanView(s => s.partialRaisedCountertopProjectId === project.id);
  const preview = useProjectStore(s => s.ui.jarvisPreview);
  const finishProject = scanPreviewFinishProject(project, preview?.snapshot, preview?.finishChoices);
  const hasSelectedFinishes = activeSlotsFor(finishProject.spec, project.roomType).some(slot => scanSlotShowsDesign(finishProject, slot));
  const mesh = useNativeMesh(s => s.projectId === project.id ? s.mesh : null);
  const nativeToken = useNativeMesh(s => s.projectId === project.id ? s.token : null);
  const meshError = useNativeMesh(s => s.projectId === project.id ? s.error : null);
  const texture = useNativeMesh(s => s.projectId === project.id ? s.texture : null);
  const mirrorDetails = useMirrorDetails();
  const colorDetails = useObjectAppearance();
  const refiningColors = colorDetails.mesh === mesh && colorDetails.texture === texture && colorDetails.status === 'refining';
  const ownDetails = !!project.spec && 'scanGeometry' in project.spec && mirrorDetails.scan === project.spec.scanGeometry && mirrorDetails.texture === texture;
  const detectingDetails = ownDetails && (mirrorDetails.status === 'loading' || mirrorDetails.status === 'detecting');
  const texturePending = useNativeMesh(s => s.projectId === project.id && s.texturePending);
  const textureError = useNativeMesh(s => s.projectId === project.id ? s.textureError : null);
  const planeTexture = useNativeMesh(s => s.projectId === project.id ? s.planeTexture : null);
  const planeTexturePending = useNativeMesh(s => s.projectId === project.id && s.planeTexturePending);
  const planeTextureError = useNativeMesh(s => s.projectId === project.id ? s.planeTextureError : null);
  const colorCoverage = mesh ? mesh.coloredVertexCount === mesh.triangleCount * 3 ? '100' : (Math.floor(mesh.coloredVertexCount / (mesh.triangleCount * 3) * 1000) / 10).toFixed(1) : '0';
  useEffect(() => {
    let cancelled = false;
    let bridge: ReturnType<typeof installNativeBridge> | undefined;
    const install = () => {
      if (cancelled || bridge) return;
      bridge = installNativeBridge(window, {
        getProject: () => useProjectStore.getState().project,
        loadProject: (project) => useProjectStore.getState().loadProject(project),
        subscribe: (listener) => useProjectStore.subscribe((state, previous) => { if (state.project !== previous.project) listener(); }),
        isBusy: () => { const state = useProjectStore.getState(); return !!state.ui.jarvisBusy || ['uploading', 'analyzing', 'building'].includes(state.ui.analysisPhase) || state.project.renders.some(r => r.status === 'running' || r.status === 'queued'); },
      }, (event) => window.webkit?.messageHandlers?.manhattan?.postMessage(event), {
        onImported: (result) => {
          // Design this space opens the editable model. The original measured
          // mesh remains available through the separate Source scan control.
          useScanView.getState().setMode('model');
          setImported(true); setError(null); setNotices(result.notices);
        },
        onError: setError,
        onMeshChanged: () => useScanView.getState().setReady(null),
      });
    };
    // Native is authoritative, but let local hydration settle BEFORE exposing the
    // callable importer so an old persisted web project cannot race a native import.
    const unsubscribe = useProjectStore.persist.onFinishHydration(install);
    if (useProjectStore.persist.getOptions().name !== STUDIO_STORAGE_KEY) {
      // A same-origin shared design can temporarily switch the store key.
      // Settle the studio key now, before Studio's own mount effect can reload it.
      useProjectStore.persist.setOptions({ name: STUDIO_STORAGE_KEY });
      void useProjectStore.persist.rehydrate();
    } else if (useProjectStore.persist.hasHydrated()) install();
    const flush = () => bridge?.flush();
    window.addEventListener('pagehide', flush);
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { cancelled = true; unsubscribe(); bridge?.dispose(); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  if (!imported) return <main className="flex min-h-dvh shrink-0 items-center justify-center bg-bg p-6 text-ink"><div className="max-w-md text-center"><p className="text-xs uppercase tracking-[.18em] text-brass">MANHATTAN · Native studio</p><h1 className="mt-4 font-display text-3xl">{error ? 'This design could not be opened' : 'Ready for your room'}</h1><p role={error ? 'alert' : 'status'} className="mt-3 text-sm leading-relaxed text-muted">{error ?? 'Open a scanned room from the Manhattan app to design it here. Your original scan stays on your device.'}</p>{error && <p className="mt-3 text-xs text-dim">Your original scan and saved design are preserved. Close Studio and try reopening this space.</p>}</div></main>;
  return <div className="studio-workspace relative h-dvh min-h-0 shrink-0"><StudioLoader embedded />
    <aside data-testid="scan-view-controls" className="absolute left-3 right-3 top-16 z-20 max-h-[calc(100dvh-10rem)] max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-[#252b29]/95 px-3 py-2 text-xs text-white/75 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2">
        <div className="flex rounded-full bg-black/25 p-0.5">
          <button type="button" aria-pressed={mode === 'model'} onClick={() => setMode('model')} className={`min-h-11 rounded-full px-3 font-medium ${mode === 'model' ? 'bg-[#d9b66f] text-[#242822]' : 'text-white/75'}`}>3D model</button>
          <button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')} className={`min-h-11 rounded-full px-3 font-medium ${mode === 'source' ? 'bg-white/15 text-white' : 'text-white/75'}`}>Source scan</button>
        </div>
        <p role="status" className="ml-auto min-w-0 text-right text-[10px] leading-tight">{mode === 'model' && detectingDetails ? mirrorDetails.status === 'loading' ? 'Loading detail recovery…' : `Recovering details ${mirrorDetails.completed}/${mirrorDetails.total}…` : mode === 'model' && refiningColors ? 'Matching scan colors…' : mode === 'source' && texturePending ? 'Applying camera detail…' : ready === mode ? mode === 'model' ? 'Reconstructed model ready' : mesh ? 'Original scan ready' : 'Scan geometry ready' : 'Preparing view…'}</p>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        {mode === 'model' ? <ScanFinishReview key={`${project.id}:${nativeToken ?? 'pending'}`} /> : <span className="text-[11px] text-white/60">Original recorded room</span>}
        <button type="button" onClick={() => setFocus(focus === 'fixtures' ? 'room' : 'fixtures')} className="min-h-11 shrink-0 rounded-full border border-white/15 px-3 text-[11px]">{focus === 'fixtures' ? 'Whole room' : 'Focus fixtures'}</button>
      </div>
      {error ? <p role="alert" className="mt-2">{error}</p> : <details className="mt-0.5">
        <summary className="cursor-pointer py-1 text-[11px] text-white/60">Scan details{mode === 'model' && partialRaisedCountertop && <span data-testid="incomplete-raised-countertop" className="ml-1 text-[#c9962e]"> · Raised edge incomplete</span>}</summary>
        <p data-testid="scan-finish-status" className="mt-2 text-[11px] leading-relaxed text-white/90">{mode === 'model'
          ? hasSelectedFinishes ? 'Selected + estimated finishes · editable model' : 'Estimated finishes · editable model'
          : mesh ? texture ? 'Original camera textures · recorded geometry' : mesh.coloredVertexCount ? 'Original camera colors · recorded geometry' : 'Recorded geometry · colors unavailable' : 'Captured bounds · detailed mesh unavailable'}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-[#c9962e]">{mode === 'model' ? 'Reconstructed edges and finishes are approximate. Confirm dimensions on site.' : 'Read-only original scan · partial coverage includes gaps.'}</p>
        {mode === 'model' && partialRaisedCountertop && <p className="mt-2 text-[11px] leading-relaxed text-[#c9962e]">Raised countertop edge incomplete · scan the unobstructed return and ends to capture its full shape.</p>}
        {mode === 'model' ? <>
          <p className="mt-2 leading-relaxed">The editable model combines captured walls and openings with fitted LiDAR surfaces and object bounds. Cabinet doors, pulls, fixtures and other small details are representative; missing edges and construction details are not verified.</p>
          <p className="mt-2 leading-relaxed">Unchosen finishes estimate each surface’s color from supported camera samples. The clean model removes photographed clutter and glare; Source scan retains the original images. Measured floor imagery stays in its captured position; when its material is established, a simplified finish can estimate unclear grain and joints. Rugs in ambiguous floor imagery remain local to the observed area. Neutral areas lack enough evidence. Choose a material to preview a design finish. The scan cannot verify material brands, exact colors or hidden surfaces.</p>
          {colorDetails.mesh === mesh && colorDetails.texture === texture && colorDetails.changedTriangles > 0 && <p data-testid="camera-color-match-status" data-refined-faces={colorDetails.changedTriangles} className="mt-2 leading-relaxed">Colors were compared across agreeing camera views to reduce glare. Recorded lighting and reflections can still affect their appearance.</p>}
          {ownDetails && <p data-testid="inferred-mirror-status" data-mirrors={mirrorDetails.mirrors.length} className="mt-2 leading-relaxed">{mirrorDetails.status === 'unavailable' ? 'Extra camera details could not load. Reopen Studio to retry.' : `${mirrorDetails.mirrors.length} mirror${mirrorDetails.mirrors.length === 1 ? '' : 's'} recovered from agreeing camera views. Mirror edges are estimated; hidden or undetected mirrors may be missing.`}{mirrorDetails.status === 'partial' && ` Detail recovery stopped after ${mirrorDetails.completed} of ${mirrorDetails.total} images; recovered details were kept. Reopen Studio to retry the remaining views.`} Images are processed on your device.</p>}
          <p className="mt-2 leading-relaxed">Source scan shows the original retained mesh and camera appearance. Switching views does not change saved geometry, finishes or quantities.</p>
        </> : <p className="mt-2 leading-relaxed">{mesh ? 'This is the original retained LiDAR mesh. Camera appearance is shown where image and depth agree; missing or inconsistent samples remain neutral. Lighting, shadows and reflections are part of the recording.' : 'This view shows captured RoomPlan bounds and available countertop patches. The original detailed mesh is unavailable in this session.'} Return to 3D model to edit reconstructed surfaces.</p>}
        {mesh && <p data-testid="observed-mesh-status" data-triangles={mesh.triangleCount} data-colored-vertices={mesh.coloredVertexCount} className="mt-2 text-[11px]">Original scan evidence: {mesh.triangleCount.toLocaleString()} triangles · {colorCoverage}% of retained vertices have camera color{texture ? ` · ${texture.texturedTriangleCount.toLocaleString()} faces have camera texture` : ''}. These counts do not verify whole-room coverage.</p>}
        {planeTexture && <p data-testid="plane-camera-status" data-observed-texels={planeTexture.observedTexels} className="mt-2 leading-relaxed">Additional depth-supported wall, floor{planeTexture.planes.some(plane => plane.kind === 'countertop') ? ' and countertop' : ''} camera samples are retained locally as appearance evidence.</p>}
        {meshError && <p className="mt-2 text-[#c9962e]">Detailed LiDAR data could not be refreshed. The reconstructed model and saved scan remain available.</p>}
        {mode === 'source' && textureError && <p className="mt-2 text-[#c9962e]">Camera textures could not load. Available recorded vertex colors remain visible.</p>}
        {mode === 'source' && planeTextureError && <p className="mt-2 text-[#c9962e]">Additional surface camera evidence could not load.</p>}
        {mode === 'source' && planeTexturePending && <p className="mt-2 text-white/55">Preparing additional camera evidence…</p>}
        {!mesh && <p className="mt-2 leading-relaxed">Detailed LiDAR triangles are unavailable in this session. Open the saved room from the iPhone app to transfer its original scan.</p>}
        <ul className="mt-2 list-disc space-y-1 pl-4">{notices.map(notice => <li key={notice}>{notice}</li>)}</ul>
      </details>}
    </aside>
  </div>;
}
