import { create } from 'zustand';
import type { ObservedMesh } from './mesh-archive';
import type { ScanTexture } from './texture-archive';
import type { ScanPlaneTexture } from './plane-texture-archive';

interface NativeMeshState {
  projectId: string | null;
  token: string | null;
  mesh: ObservedMesh | null;
  error: string | null;
  revision: number;
  texture: ScanTexture | null;
  texturePending: boolean;
  textureError: string | null;
  planeTexture: ScanPlaneTexture | null;
  planeTexturePending: boolean;
  planeTextureError: string | null;
}
const empty: NativeMeshState = { projectId: null, token: null, mesh: null, error: null, revision: 0, texture: null, texturePending: false, textureError: null, planeTexture: null, planeTexturePending: false, planeTextureError: null };
/** Deliberately has no persistence middleware, project fields, or upload path. */
export const useNativeMesh = create<NativeMeshState>(() => ({ ...empty }));
export function beginNativeMesh(projectId: string, token: string): void { useNativeMesh.setState(s => ({ ...empty, projectId, token, revision: s.revision + 1 })); }
export function ownsNativeMesh(projectId: string, token: string): boolean { const state = useNativeMesh.getState(); return state.projectId === projectId && state.token === token; }
export function acceptNativeMesh(projectId: string, token: string, mesh: ObservedMesh): boolean {
  if (!ownsNativeMesh(projectId, token)) return false;
  useNativeMesh.setState(s => ({ mesh, error: null, texture: null, texturePending: false, textureError: null, planeTexture: null, planeTexturePending: false, planeTextureError: null, revision: s.revision + 1 })); return true;
}
export function beginNativeTexture(projectId: string, token: string): void {
  if (ownsNativeMesh(projectId, token)) useNativeMesh.setState({ texturePending: true, textureError: null });
}
export function acceptNativeTexture(projectId: string, token: string, mesh: ObservedMesh, texture: ScanTexture): boolean {
  if (!ownsNativeMesh(projectId, token) || useNativeMesh.getState().mesh !== mesh) return false;
  useNativeMesh.setState(s => ({ texture, texturePending: false, textureError: null, revision: s.revision + 1 })); return true;
}
export function failNativeTexture(projectId: string, token: string, error: string): void {
  if (ownsNativeMesh(projectId, token)) useNativeMesh.setState({ texturePending: false, textureError: error });
}
export function beginNativePlaneTexture(projectId: string, token: string, mesh: ObservedMesh): void {
  if (ownsNativeMesh(projectId, token) && useNativeMesh.getState().mesh === mesh) useNativeMesh.setState({ planeTexturePending: true, planeTextureError: null });
}
export function acceptNativePlaneTexture(projectId: string, token: string, mesh: ObservedMesh, planeTexture: ScanPlaneTexture): boolean {
  if (!ownsNativeMesh(projectId, token) || useNativeMesh.getState().mesh !== mesh) return false;
  useNativeMesh.setState(s => ({ planeTexture, planeTexturePending: false, planeTextureError: null, revision: s.revision + 1 })); return true;
}
export function failNativePlaneTexture(projectId: string, token: string, mesh: ObservedMesh, error: string): void {
  if (ownsNativeMesh(projectId, token) && useNativeMesh.getState().mesh === mesh) useNativeMesh.setState(s => ({ planeTexturePending: false, planeTextureError: error, revision: s.revision + 1 }));
}
export function failNativeMesh(projectId: string, token: string, error: string): void {
  if (ownsNativeMesh(projectId, token)) useNativeMesh.setState(s => ({ error, revision: s.revision + 1 }));
}
export function clearNativeMesh(token: string | null): void {
  if (token && useNativeMesh.getState().token === token) useNativeMesh.setState({ ...empty });
}
