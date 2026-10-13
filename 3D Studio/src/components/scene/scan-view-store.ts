'use client';
import { create } from 'zustand';

export type ScanViewMode = 'model' | 'source';
/** Presentation only. Original RoomPlan data and estimate quantities never read this store. */
export const useScanView = create<{
  mode: ScanViewMode;
  ready: ScanViewMode | null;
  focus: 'fixtures' | 'room';
  partialRaisedCountertopProjectId: string | null;
  setFocus: (focus: 'fixtures' | 'room') => void;
  setMode: (mode: ScanViewMode) => void;
  setReady: (ready: ScanViewMode | null) => void;
}>((set) => ({
  mode: 'model', ready: null, focus: 'fixtures', partialRaisedCountertopProjectId: null,
  setFocus: (focus) => set(state => state.focus === focus ? state : { focus, ready: null }),
  setMode: (mode) => set(state => state.mode === mode ? state : { mode, ready: null }),
  setReady: (ready) => set({ ready }),
}));

/** Photoreal jobs capture finished fixtures, never the diagnostic wire bounds. */
export function waitForScanModelFrame(timeoutMs = 15000, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Capture canceled.', 'AbortError'));
  useScanView.getState().setMode('model');
  if (useScanView.getState().ready === 'model') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); stop(); reject(signal?.reason ?? new DOMException('Capture canceled.', 'AbortError')); };
    const stop = useScanView.subscribe(state => {
      if (state.mode === 'model' && state.ready === 'model') { clearTimeout(timer); stop(); signal?.removeEventListener('abort', abort); resolve(); }
    });
    const timer = setTimeout(() => { stop(); signal?.removeEventListener('abort', abort); reject(new Error('The reconstructed 3D model is still loading. Try rendering again when the view is ready.')); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
