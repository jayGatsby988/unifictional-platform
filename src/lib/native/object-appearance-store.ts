import { create } from 'zustand';
import type { ObservedMesh } from './mesh-archive';
import type { ScanTexture } from './texture-archive';
import type { ScannedRoomGeometry } from '../spec/types';
import { createReconstructedObjectTextureSource, type ReconstructedObjectTextureSource } from './reconstructed-object-texture';
import { refineReconstructedObjectTextureSource } from './reconstructed-object-refinement';

const originals = new WeakMap<ObservedMesh, WeakMap<ScanTexture, WeakMap<ScannedRoomGeometry, Map<string, ReconstructedObjectTextureSource | null>>>>();
export function objectTextureSourceFor(mesh: ObservedMesh, texture: ScanTexture, scan: ScannedRoomGeometry, roomType: 'kitchen' | 'bathroom'): ReconstructedObjectTextureSource | null {
  let textures = originals.get(mesh);
  if (!textures) { textures = new WeakMap(); originals.set(mesh, textures); }
  let scans = textures.get(texture);
  if (!scans) { scans = new WeakMap(); textures.set(texture, scans); }
  let types = scans.get(scan);
  if (!types) { types = new Map(); scans.set(scan, types); }
  if (!types.has(roomType)) types.set(roomType, createReconstructedObjectTextureSource(mesh, texture, scan, roomType));
  return types.get(roomType) ?? null;
}
interface ObjectAppearanceState {
  mesh: ObservedMesh | null; texture: ScanTexture | null; scan: ScannedRoomGeometry | null;
  source: ReconstructedObjectTextureSource | null;
  status: 'idle' | 'refining' | 'ready' | 'unavailable'; changedTriangles: number; limited: boolean;
}
export const useObjectAppearance = create<ObjectAppearanceState>(() => ({ mesh: null, texture: null, scan: null, source: null, status: 'idle', changedTriangles: 0, limited: false }));
const completed = new WeakMap<ReconstructedObjectTextureSource, { source: ReconstructedObjectTextureSource; changedTriangles: number; limited: boolean }>();
let active: AbortController | null = null;

/** Transient display refinement only. Source captures, projects and selected
 * finishes never enter a persistence or upload path here. */
export function startObjectAppearance(mesh: ObservedMesh, texture: ScanTexture, scan: ScannedRoomGeometry, roomType: 'kitchen' | 'bathroom'): () => void {
  active?.abort();
  const controller = new AbortController(); active = controller;
  const original = objectTextureSourceFor(mesh, texture, scan, roomType);
  const cached = original ? completed.get(original) : null;
  const stop = () => { controller.abort(); if (active === controller) active = null; };
  if (!original) { useObjectAppearance.setState({ mesh, texture, scan, source: null, status: 'unavailable', changedTriangles: 0, limited: false }); return stop; }
  if (cached) { useObjectAppearance.setState({ mesh, texture, scan, ...cached, status: 'ready' }); return stop; }
  useObjectAppearance.setState({ mesh, texture, scan, source: original, status: 'refining', changedTriangles: 0, limited: false });
  void refineReconstructedObjectTextureSource(original, { signal: controller.signal }).then(result => {
    if (controller.signal.aborted || active !== controller) return;
    const value = { source: result.source, changedTriangles: result.changedTriangles, limited: result.limited };
    completed.set(original, value);
    useObjectAppearance.setState({ ...value, status: 'ready' });
  }).catch(() => {
    if (controller.signal.aborted || active !== controller) return;
    // Original validated appearance remains usable if refinement cannot finish.
    useObjectAppearance.setState({ source: original, status: 'unavailable' });
  });
  return stop;
}
