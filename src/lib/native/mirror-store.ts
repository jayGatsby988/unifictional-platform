'use client';
import { create } from 'zustand';
import type { ObservedMesh } from './mesh-archive';
import type { ScanTexture } from './texture-archive';
import type { ScannedRoomGeometry } from '../spec/types';
import { recoverCapturedCameras, capturedCameraUprightRotation } from './camera-projection';
import { type ReconstructedMirror } from './reconstructed-mirrors';

type Result = { status: 'ready' | 'partial' | 'unavailable'; mirrors: ReconstructedMirror[] };
type State = { scan: ScannedRoomGeometry | null; texture: ScanTexture | null; status: 'idle' | 'loading' | 'detecting' | Result['status']; completed: number; total: number; mirrors: ReconstructedMirror[] };
export const useMirrorDetails = create<State>(() => ({ scan: null, texture: null, status: 'idle', completed: 0, total: 0, mirrors: [] }));
const cache = new WeakMap<ScanTexture, WeakMap<ScannedRoomGeometry, Result>>();
let activeCleanup: (() => void) | null = null;

/** Bound to the same validated mesh/camera packet as the source view. Workers
 * terminate on project/asset replacement; their late results cannot cross rooms. */
export function startMirrorReconstruction(mesh: ObservedMesh, texture: ScanTexture, scan: ScannedRoomGeometry): () => void {
  // State identity alone cannot distinguish A→B→A or a same-room retry.
  // Stop the preceding operation even when this start can use the cache.
  activeCleanup?.();
  const cached = cache.get(texture)?.get(scan);
  if (cached) { useMirrorDetails.setState({ scan, texture, ...cached, completed: 0, total: 0 }); return () => {}; }
  const cameras = recoverCapturedCameras(mesh, texture);
  const frames = texture.images.flatMap((image, frameIndex) => {
    const camera = cameras[frameIndex], rotation = camera ? capturedCameraUprightRotation(camera, image) : null;
    return rotation === null ? [] : [{ frameIndex, rotation, image }];
  });
  useMirrorDetails.setState({ scan, texture, status: 'loading', mirrors: [], completed: 0, total: frames.length });
  let worker: Worker | undefined, stopped = false, completed = 0;
  let recovered: ReconstructedMirror[] = [];
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); worker?.terminate();
    if (activeCleanup === stop) activeCleanup = null;
  };
  activeCleanup = stop;
  const finish = (result: Result) => {
    if (stopped) return;
    stop();
    if (result.status === 'ready') {
      let scans = cache.get(texture); if (!scans) { scans = new WeakMap(); cache.set(texture, scans); } scans.set(scan, result);
    }
    if (useMirrorDetails.getState().scan === scan && useMirrorDetails.getState().texture === texture) useMirrorDetails.setState(result);
  };
  const interrupted = () => finish({ status: completed > 0 ? 'partial' : 'unavailable', mirrors: recovered });
  const timer = setTimeout(interrupted, 120_000);
  if (frames.length < 2) finish({ status: 'ready', mirrors: [] });
  else try {
    worker = new Worker(new URL('./mirror-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ type: string; completed: number; total: number; mirrors: ReconstructedMirror[] }>) => {
      if (stopped || useMirrorDetails.getState().scan !== scan || useMirrorDetails.getState().texture !== texture) return;
      const message = event.data;
      if (message.type === 'progress') {
        if (!Number.isInteger(message.completed) || message.completed < completed || message.completed > frames.length || message.total !== frames.length) return;
        completed = message.completed;
        if (Array.isArray(message.mirrors)) recovered = message.mirrors;
        useMirrorDetails.setState({ status: 'detecting', completed, total: frames.length, mirrors: recovered });
      }
      else if (message.type === 'complete') finish({ status: 'ready', mirrors: message.mirrors });
      else if (message.type === 'error') interrupted();
    };
    worker.onerror = interrupted;
    worker.postMessage({ frames, scan, cameras });
  } catch { interrupted(); }
  return stop;
}
