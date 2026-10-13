'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Images, LoaderCircle, Sparkles, X } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import { useNativeDetailPhotos, type NativeDetailPhoto } from '@/lib/native/detail-photos';
import { ownsNativeMesh, useNativeMesh } from '@/lib/native/mesh-store';
import { mergeScanPhotoFinishes, scanPhotoFinishMatches, validateScanPhotoAnalysis, type ScanPhotoAnalysis } from '@/lib/native/photo-finishes';
import { SLOT_META } from '@/lib/materials/catalog';
import type { MaterialSlotId } from '@/lib/spec/types';
import { activeSlotsFor } from '@/components/studio/projectUtils';
import { imageForAnalysis } from '@/lib/native/photo-input';
import { recoverCapturedCameras, capturedCameraUprightRotation } from '@/lib/native/camera-projection';

export function ScanFinishReview() {
  const project = useProjectStore(s => s.project), busy = useProjectStore(s => !!s.ui.jarvisBusy || !!s.ui.jarvisPreview || ['uploading', 'analyzing', 'building'].includes(s.ui.analysisPhase) || s.project.renders.some(r => r.status === 'running' || r.status === 'queued'));
  const mesh = useNativeMesh(s => s.projectId === project.id ? s.mesh : null);
  const token = useNativeMesh(s => s.projectId === project.id ? s.token : null);
  const ownsRoom = () => !!token && ownsNativeMesh(project.id, token) && useProjectStore.getState().project.id === project.id;
  const native = useNativeDetailPhotos(), texture = useNativeMesh(s => s.projectId === project.id ? s.texture : null);
  const [preparing, setPreparing] = useState(false);
  const generation = useRef(0);
  const [open, setOpen] = useState(false), [local, setLocal] = useState<NativeDetailPhoto[]>([]);
  const [selected, setSelected] = useState<string[] | null>(null), [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<ScanPhotoAnalysis | null>(null), [included, setIncluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), files = useRef<HTMLInputElement>(null), work = useRef<AbortController | null>(null);
  const photos = local.length ? local : native.projectId === project.id ? native.photos : [];
  const photoIds = selected ?? photos.slice(0, 3).map(p => p.id);
  const matches = scanPhotoFinishMatches(project);
  const count = (project.overrides.nativeScan as { detailPhotoCount?: number } | undefined)?.detailPhotoCount ?? 0;
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); else if (!open) dialog.current?.close(); }, [open]);
  useEffect(() => () => { generation.current++; work.current?.abort(); }, []);
  const close = () => { generation.current++; work.current?.abort(); work.current = null; setAnalyzing(false); setPreparing(false); setOpen(false); };
  const resetResults = () => { setResult(null); setIncluded([]); setError(null); setNotice(null); setSelected(null); };

  const addFiles = async (input: FileList | null) => {
    if (!input?.length || !ownsRoom()) return;
    const operation = ++generation.current;
    resetResults(); setPreparing(true); setLocal([]);
    try {
      const next: NativeDetailPhoto[] = [];
      for (const file of Array.from(input).slice(0, 6)) {
        if (operation !== generation.current || !ownsRoom()) return;
        next.push({ id: crypto.randomUUID(), url: await imageForAnalysis(file) });
      }
      if (operation === generation.current && ownsRoom()) setLocal(next);
    } catch (e) { if (operation === generation.current) setError(e instanceof Error ? e.message : 'The photos could not be opened.'); }
    finally { if (operation === generation.current) { setPreparing(false); if (files.current) files.current.value = ''; } }
  };
  const scanImages = () => {
    if (!texture || !ownsRoom()) return;
    generation.current++; resetResults();
    const counts = new Uint32Array(texture.images.length); texture.frameIndices.forEach(i => { if (i >= 0) counts[i]++; });
    const ids = Array.from(counts, (count, index) => ({ count, index })).sort((a, b) => b.count - a.count).slice(0, 6);
    const cameras = mesh ? recoverCapturedCameras(mesh, texture) : [];
    const next = ids.map(({ index }) => {
      const image = texture.images[index], canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
      const camera = cameras[index], rotation = camera ? capturedCameraUprightRotation(camera, image) ?? 0 : 0;
      const upright = document.createElement('canvas');
      upright.width = rotation === 90 || rotation === 270 ? image.height : image.width; upright.height = rotation === 90 || rotation === 270 ? image.width : image.height;
      const context = upright.getContext('2d')!; context.translate(upright.width / 2, upright.height / 2); context.rotate(rotation * Math.PI / 180); context.drawImage(canvas, -image.width / 2, -image.height / 2);
      const url = upright.toDataURL('image/jpeg', .92); canvas.width = canvas.height = upright.width = upright.height = 0;
      return { id: `scan-frame-${index}`, url };
    });
    setLocal(next); setNotice('Scan images have limited detail. Clear close-up photos usually give better matches.');
  };
  const analyze = async () => {
    if (!ownsRoom() || preparing || !project.spec || !['kitchen', 'bathroom'].includes(project.roomType) || !photoIds.length || analyzing || busy) return;
    const controller = new AbortController(); work.current?.abort(); work.current = controller;
    const projectId = project.id, operation = ++generation.current;
    setAnalyzing(true); setError(null); setNotice(null); setResult(null);
    const timeout = setTimeout(() => controller.abort(), 165_000);
    try {
      const selectedPhotos: NativeDetailPhoto[] = [];
      for (const p of photos.filter(p => photoIds.includes(p.id)).slice(0, 3)) {
        selectedPhotos.push({ id: p.id, url: await imageForAnalysis(p.url, controller.signal) });
      }
      if (controller.signal.aborted || !ownsRoom()) return;
      const slots = activeSlotsFor(project.spec, project.roomType).filter(slot => !['ceiling', 'appliances'].includes(slot));
      const response = await fetch('/api/native/finishes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomType: project.roomType, slots, photos: selectedPhotos }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Photo matching failed. Please try again.');
      if (operation !== generation.current || controller.signal.aborted || !ownsRoom() || useProjectStore.getState().project.id !== projectId) return;
      const checked = validateScanPhotoAnalysis({ observations: data.observations, warnings: data.warnings }, slots, selectedPhotos.map(p => p.id));
      setResult(checked); setIncluded(checked.observations.filter(item => item.confidence !== 'low' && item.observation.visibility !== 'inferred').map(item => item.observation.slot));
    } catch (e) {
      if (work.current === controller) setError(controller.signal.aborted ? 'Photo analysis stopped. Your model is unchanged.' : e instanceof Error ? e.message : 'Photo analysis failed.');
    } finally { clearTimeout(timeout); if (work.current === controller) { work.current = null; setAnalyzing(false); } }
  };
  const apply = () => {
    const current = useProjectStore.getState();
    if (!result || busy || !ownsRoom() || current.project.id !== project.id) return;
    current.setOverride('scanPhotoFinishes', mergeScanPhotoFinishes(current.project, result.observations.filter(item => included.includes(item.observation.slot))));
    setNotice(`${included.length} finish ${included.length === 1 ? 'match' : 'matches'} applied. Design material choices take precedence; different finishes on the same island stay separate.`); setResult(null);
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} className="flex min-h-10 items-center gap-2 rounded-full px-2 text-[11px] font-medium text-[#e6c782] hover:bg-white/5"><Sparkles size={14} />{matches.length ? `${matches.length} photo-matched finishes` : 'Match finishes from photos'}</button>
    <dialog ref={dialog} onCancel={close} onClose={() => setOpen(false)} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_1.5rem)] max-w-lg overflow-y-auto rounded-3xl border border-white/15 bg-[#202020] p-5 text-white shadow-2xl backdrop:bg-black/70">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.18em] text-[#c9962e]">Existing room appearance</p><h2 className="mt-1 text-xl font-medium">Match your finishes</h2></div><button type="button" aria-label="Close finish matching" onClick={close} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/5"><X size={19} /></button></div>
      <p className="mt-3 text-sm leading-relaxed text-white/65">Use clear photos of your cabinets, floor and countertops. Review the matches before applying them to your model.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={analyzing || preparing} onClick={() => files.current?.click()} className="flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3 text-xs disabled:opacity-40"><Camera size={15} />Add photos</button>
        {count > 0 && <button type="button" disabled={native.pending || analyzing || preparing} onClick={() => { generation.current++; resetResults(); setLocal([]); const reply = window.manhattanNativeRequestDetailPhotos?.(); if (!reply?.ok) setError(reply?.error ?? 'Reopen this room in the updated iPhone app.'); }} className="flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3 text-xs disabled:opacity-40"><Images size={15} />{native.pending ? 'Waiting for iPhone…' : 'Saved detail photos'}</button>}
        {texture && <button type="button" disabled={analyzing || preparing} onClick={scanImages} className="min-h-11 rounded-xl border border-white/15 px-3 text-xs disabled:opacity-40">Use scan images</button>}
      </div>
      <input ref={files} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label="Choose finish reference photos" onChange={e => void addFiles(e.target.files)} />
      {!!photos.length && <><p className="mt-4 text-xs text-white/60">Choose up to 3 photos · {photoIds.length} selected</p><div className="mt-2 grid grid-cols-3 gap-2">{photos.map(p => <button type="button" key={p.id} disabled={analyzing || preparing} aria-label={`Use photo ${photos.indexOf(p) + 1}`} aria-pressed={photoIds.includes(p.id)} onClick={() => { const current = photoIds; setSelected(current.includes(p.id) ? current.filter(id => id !== p.id) : current.length < 3 ? [...current, p.id] : current); setResult(null); }} className={`relative overflow-hidden rounded-xl border-2 ${photoIds.includes(p.id) ? 'border-[#c9962e]' : 'border-transparent'}`}>
        {/* Session-only local images intentionally bypass remote image loaders. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.url} alt={`Room finish reference ${photos.indexOf(p) + 1}`} className="aspect-square w-full object-cover" />{photoIds.includes(p.id) && <span className="absolute right-1 top-1 rounded-full bg-[#c9962e] p-1 text-[#202020]"><Check size={12} /></span>}
      </button>)}</div></>}
      <p className="mt-4 text-[11px] leading-relaxed text-white/50">Analyze sends only the selected photos to the configured AI service. Original scan files stay on your device. Matches describe appearance, not verified products or fabrication measurements.</p>
      {error || (!local.length && native.error) ? <p role="alert" className="mt-3 rounded-xl bg-red-400/10 p-3 text-xs text-red-200">{error ?? native.error}</p> : null}
      {notice && <p role="status" className="mt-3 text-xs leading-relaxed text-[#e5cb93]">{notice}</p>}
      {!result && <button type="button" disabled={analyzing || preparing || busy || photoIds.length < 1} onClick={() => void analyze()} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#c9962e] px-4 text-sm font-medium text-[#202020] disabled:opacity-40">{preparing ? <><LoaderCircle size={17} className="animate-spin" />Preparing photos…</> : analyzing ? <><LoaderCircle size={17} className="animate-spin" />Identifying finishes…</> : <><Sparkles size={17} />Analyze selected photos</>}</button>}
      {result && <div className="mt-4 space-y-3">
        <h3 className="text-sm font-medium">Review the matches</h3>
        {!result.observations.length && <p className="text-sm text-white/65">These photos did not establish a reliable finish match. Try a closer, well-lit photo of the surface.</p>}
        {result.observations.map(item => { const o = item.observation, eligible = item.confidence !== 'low' && o.visibility !== 'inferred'; return <label key={o.slot} className="flex items-start gap-3 rounded-xl bg-white/5 p-3"><input type="checkbox" className="mt-1 h-5 w-5 accent-[#c9962e]" disabled={!eligible} checked={included.includes(o.slot)} onChange={e => setIncluded(e.target.checked ? [...included, o.slot] : included.filter(slot => slot !== o.slot))} /><span className="h-10 w-10 shrink-0 rounded-lg border border-white/10" style={{ backgroundColor: o.baseColorHex }} /><span className="min-w-0 text-xs"><strong className="block text-white">{SLOT_META[o.slot as MaterialSlotId]?.label ?? o.slot}</strong><span className="mt-1 block text-white/65">{o.description}</span><span className="mt-1 block text-[10px] text-[#c9962e]">{item.confidence} confidence · {o.pattern.replaceAll('-', ' ')} · {o.sheen}</span><span className="mt-1 block text-[10px] leading-relaxed text-white/50">{item.note}</span></span></label>; })}
        {result.warnings.map((warning, i) => <p key={i} className="text-xs leading-relaxed text-[#e5cb93]">{warning}</p>)}
        <button type="button" disabled={!included.length || busy} onClick={apply} className="min-h-12 w-full rounded-xl bg-[#c9962e] px-4 text-sm font-medium text-[#202020] disabled:opacity-40">Apply {included.length || ''} selected matches</button>
      </div>}
      {matches.length > 0 && <button type="button" disabled={busy || analyzing} onClick={() => { if (!ownsRoom()) return; useProjectStore.getState().setOverride('scanPhotoFinishes', { version: 1, matches: [] }); setNotice('Photo matches cleared. Captured appearance is restored.'); }} className="mt-3 min-h-11 w-full text-xs text-white/60">Clear photo matches</button>}
    </dialog>
  </>;
}
