import type { Project } from '@/lib/spec/types';
import { createNativeAssetTransfer } from './asset-transfer';
import { clearNativeDetailPhotos, NativeDetailPhotoReplyZ, useNativeDetailPhotos } from './detail-photos';
import { assertNativeDocument, importNativeScan, nativeRoomFrame, NativeScanPayloadZ, NativeStudioProjectZ, type NativeImportResult, type NativeRoomFrame } from './scan-import';
import { decodeMeshArchive, meshPointInFrame, validMeshFrame, type ObservedMesh } from './mesh-archive';
import { acceptNativeMesh, beginNativeMesh, clearNativeMesh, failNativeMesh, ownsNativeMesh, useNativeMesh, beginNativeTexture, acceptNativeTexture, failNativeTexture, beginNativePlaneTexture, acceptNativePlaneTexture, failNativePlaneTexture } from './mesh-store';
import { loadNativeTexture } from './texture-loader';
import { loadNativePlaneTexture } from './plane-texture-loader';
import { roomAppearanceGeometryDigest, roomSurfaceGeometryDigest, type RawRoomObject, type RawRoomSurface } from './room-geometry-digest';

export type NativeEvent = { type: 'ready' } | { type: 'imported' } | { type: 'error'; message: string } | { type: 'projectChanged'; project: Project }
  | { type: 'requestDetailPhotos'; projectId: string; token: string; requestId: string };
export type NativeImportReply = { ok: true; projectId: string; assetToken: string } | { ok: false; error: string };
export type NativeMeshReply = { ok: true } | { ok: false; error: string };
export interface NativeBridgeHost {
  manhattanNativeReady?: boolean;
  manhattanNativeFlush?: () => Project | null;
  manhattanNativeImport?: (payload: unknown) => NativeImportReply;
  manhattanNativeMesh?: (payload: unknown) => NativeMeshReply;
  manhattanNativeTexture?: (payload: unknown) => Promise<NativeMeshReply>;
  manhattanNativePlaneTexture?: (payload: unknown) => Promise<NativeMeshReply>;
  manhattanNativeAssetState?: (payload: unknown) => NativeMeshReply;
  manhattanNativeAssetTransfer?: ReturnType<typeof createNativeAssetTransfer>['receive'];
  manhattanNativeRequestDetailPhotos?: () => NativeMeshReply;
  manhattanNativeDetailPhotos?: (payload: unknown) => NativeMeshReply;
}
type AssetStage = 'texture' | 'planeTexture';
type AssetPreparation = { requestId: string; mesh: ObservedMesh; timer?: ReturnType<typeof setTimeout> };
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Native appearance preparation cancelled.'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** Restore the original mapping, not a design camera or a second normalization. */
function importedMeshFrame(payload: unknown, result: NativeImportResult): NativeRoomFrame | null {
  try {
    const parsed = NativeScanPayloadZ.parse(payload);
    const native = result.project.overrides.nativeScan as { frame?: unknown } | undefined;
    const frame = result.frame ?? (validMeshFrame(native?.frame) ? native.frame : nativeRoomFrame(parsed));
    if (!validMeshFrame(frame)) return null;
    const spec = result.project.baseline?.spec ?? result.project.spec;
    const geometry = spec && 'scanGeometry' in spec ? spec.scanGeometry : undefined;
    if (!geometry) return null;
    // A saved snapshot can carry a legacy frame. Only use it if its retained
    // element centers agree with the raw room supplied by the native host.
    const saved = new Map([...geometry.surfaces, ...geometry.objects].map(e => [e.id, e]));
    for (const element of [...parsed.room.surfaces, ...parsed.room.objects]) {
      const match = saved.get(element.id);
      const point = meshPointInFrame(element.position.x, element.position.y, element.position.z, frame);
      if (!match || point.some((n, i) => Math.abs(n - match.transform[12 + i]) > 0.005)) return null;
    }
    return frame;
  } catch { return null; }
}
export interface NativeBridgeStore {
  getProject(): Project;
  loadProject(project: Project): void;
  subscribe(listener: () => void): () => void;
  isBusy?(): boolean;
}

/** One WK document owns one scan. Imports are transactional; persistence starts only after success. */
export function installNativeBridge(host: NativeBridgeHost, store: NativeBridgeStore, post: (event: NativeEvent) => void, options: {
  onImported?: (result: NativeImportResult) => void;
  onError?: (message: string) => void;
  onMeshChanged?: () => void;
  debounceMs?: number;
} = {}): { dispose(): void; flush(): void } {
  let activeId: string | null = null, lastSent = '', lastImport = '', timer: ReturnType<typeof setTimeout> | undefined, disposed = false, importing = false;
  let assetToken: string | null = null, meshFrame: NativeRoomFrame | null = null;
  let textureWork: AbortController | null = null;
  let planeTextureWork: AbortController | null = null;
  let rawSurfaces: RawRoomSurface[] = [], roomGeometryDigest: Promise<string | null> = Promise.resolve(null);
  let rawObjects: RawRoomObject[] = [], roomAppearanceDigest: Promise<string | null> = Promise.resolve(null);
  const preparations = new Map<AssetStage, AssetPreparation>();
  let photoTimer: ReturnType<typeof setTimeout> | undefined;
  const clearPhotos = () => { clearTimeout(photoTimer); if (assetToken && useNativeDetailPhotos.getState().token === assetToken) clearNativeDetailPhotos(activeId ?? undefined); };
  const clearPreparations = () => { for (const prep of preparations.values()) clearTimeout(prep.timer); preparations.clear(); };
  const preparationMatches = (stage: AssetStage, id: unknown, mesh: ObservedMesh) => id === undefined || (typeof id === 'string' && preparations.get(stage)?.requestId === id && preparations.get(stage)?.mesh === mesh);
  const finishPreparation = (stage: AssetStage, id: unknown, mesh: ObservedMesh) => {
    const prep = preparations.get(stage);
    if (prep && prep.mesh === mesh && (id === undefined || prep.requestId === id)) { clearTimeout(prep.timer); preparations.delete(stage); }
  };
  const send = (event: NativeEvent): boolean => {
    if (disposed) return false;
    try { post(event); return true; }
    catch { options.onError?.('The native app could not receive the studio update. Keep this screen open and try again.'); return false; }
  };
  const error = (message: string) => { options.onError?.(message); send({ type: 'error', message }); };
  const flush = (force = false): Project | null => {
    clearTimeout(timer); timer = undefined;
    if (disposed || importing || !activeId) return null;
    const current = store.getProject();
    if (current.id !== activeId || !current.spec) return null;
    try {
      // JSON is the actual native persistence representation; no live store references cross the bridge.
      const serialized = JSON.stringify(current);
      if (new TextEncoder().encode(serialized).byteLength > 20 * 1024 * 1024) throw new Error('The native snapshot exceeds 20 MiB.');
      if (!force && serialized === lastSent) return null;
      const project = JSON.parse(serialized) as Project;
      assertNativeDocument(project);
      NativeStudioProjectZ.parse(project);
      if (send({ type: 'projectChanged', project })) lastSent = serialized;
      return project;
    } catch { error('The edited studio project could not be saved to the native app. Keep this screen open and undo the last invalid edit.'); return null; }
  };
  const schedule = () => {
    if (!importing && activeId && store.getProject().id !== activeId) {
      textureWork?.abort(); textureWork = null;
      planeTextureWork?.abort(); planeTextureWork = null;
      clearPreparations();
      assetTransfer.clear();
      clearPhotos();
      clearNativeMesh(assetToken);
    }
    if (disposed || importing || !activeId || store.getProject().id !== activeId || !store.getProject().spec) return;
    clearTimeout(timer); timer = setTimeout(flush, options.debounceMs ?? 300);
  };
  const unsubscribe = store.subscribe(schedule);
  const receive = (payload: unknown): NativeImportReply => {
    if (disposed) return { ok: false, error: 'The studio bridge is closed.' };
    if (activeId && store.isBusy?.()) { const message = 'Wait for the current design or render operation to finish before opening another room.'; error(message); return { ok: false, error: message }; }
    try {
      const result = importNativeScan(payload);
      const signature = JSON.stringify(payload);
      if (signature === lastImport && activeId === result.project.id && store.getProject().id === activeId && assetToken && ownsNativeMesh(activeId, assetToken)) { send({ type: 'imported' }); flush(); return { ok: true, projectId: activeId, assetToken }; }
      const previous = structuredClone(store.getProject()), previousId = activeId;
      importing = true; clearTimeout(timer);
      try {
        store.loadProject(structuredClone(result.project));
        const loaded = store.getProject();
        if (loaded.id !== result.project.id || JSON.stringify(loaded.baseline?.spec.detected.measurements ?? null) !== JSON.stringify(result.project.baseline?.spec.detected.measurements ?? null)
          || JSON.stringify(loaded.spec?.detected.measurements ?? null) !== JSON.stringify(result.project.spec?.detected.measurements ?? null)) throw new Error('Saved measurement confirmations changed during loading.');
      } catch (cause) {
        store.loadProject(previous); activeId = previousId; throw cause;
      } finally { importing = false; }
      clearPhotos();
      activeId = result.project.id; lastSent = ''; lastImport = signature;
      assetTransfer.clear();
      textureWork?.abort(); textureWork = null;
      planeTextureWork?.abort(); planeTextureWork = null;
      clearPreparations();
      meshFrame = importedMeshFrame(payload, result);
      // Parsing makes private copies of both raw arrays before normalization or
      // subsequent edits. An asset must stay bound to its original capture.
      const rawRoom = NativeScanPayloadZ.parse(payload).room;
      rawSurfaces = rawRoom.surfaces; rawObjects = rawRoom.objects;
      roomGeometryDigest = roomSurfaceGeometryDigest(rawSurfaces).catch(() => null);
      roomAppearanceDigest = roomAppearanceGeometryDigest(rawSurfaces, rawObjects).catch(() => null);
      assetToken = crypto.randomUUID();
      clearNativeDetailPhotos();
      options.onMeshChanged?.();
      beginNativeMesh(activeId, assetToken);
      options.onImported?.(result);
      send({ type: 'imported' });
      // Also save the successfully imported shell once. This establishes the native
      // snapshot even if the user simply inspects the room and closes the sheet.
      flush();
      return { ok: true, projectId: activeId, assetToken };
    } catch (cause) { const message = cause instanceof Error ? cause.message : 'The native scan could not be imported.'; error(message); return { ok: false, error: message }; }
  };
  const receiveMesh = (payload: unknown): NativeMeshReply => {
    if (disposed) return { ok: false, error: 'The studio bridge is closed.' };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype
      || Object.keys(payload).sort().join(',') !== 'data,projectId,token') return { ok: false, error: 'Invalid LiDAR transfer.' };
    const { projectId, token, data } = payload as Record<string, unknown>;
    if (typeof projectId !== 'string' || typeof token !== 'string' || !activeId || projectId !== activeId || token !== assetToken
      || store.getProject().id !== activeId || !ownsNativeMesh(projectId, token)) return { ok: false, error: 'This LiDAR transfer belongs to an inactive room.' };
    try {
      if (!meshFrame) throw new Error('The saved room coordinate frame could not be verified.');
      const mesh = decodeMeshArchive(data, meshFrame);
      textureWork?.abort(); textureWork = null;
      planeTextureWork?.abort(); planeTextureWork = null;
      clearPreparations();
      options.onMeshChanged?.();
      if (!acceptNativeMesh(projectId, token, mesh)) throw new Error('This LiDAR transfer is no longer active.');
      return { ok: true };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The LiDAR archive could not be opened.';
      options.onMeshChanged?.();
      failNativeMesh(projectId, token, message);
      return { ok: false, error: message };
    }
  };
  const receiveTexture = async (payload: unknown): Promise<NativeMeshReply> => {
    if (disposed) return { ok: false, error: 'The studio bridge is closed.' };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype
      || !['data,projectId,token', 'data,preparationId,projectId,token'].includes(Object.keys(payload).sort().join(','))) return { ok: false, error: 'Invalid camera texture transfer.' };
    const { projectId, token, preparationId, data } = payload as Record<string, unknown>;
    const mesh = useNativeMesh.getState().mesh;
    if (!mesh || typeof projectId !== 'string' || typeof token !== 'string' || projectId !== activeId || token !== assetToken
      || store.getProject().id !== activeId || !ownsNativeMesh(projectId, token)) return { ok: false, error: 'Camera textures belong to an inactive room.' };
    if (!preparationMatches('texture', preparationId, mesh)) return { ok: false, error: 'Camera textures belong to an obsolete preparation.' };
    textureWork?.abort();
    const controller = new AbortController(); textureWork = controller;
    beginNativeTexture(projectId, token);
    try {
      const digest = await abortable(Promise.resolve(mesh.geometryDigest), controller.signal);
      if (controller.signal.aborted || disposed || !digest) throw new Error('The captured mesh could not be verified for camera textures.');
      const prep = preparations.get('texture'); if (prep?.mesh === mesh) clearTimeout(prep.timer);
      const texture = await loadNativeTexture(data, digest, mesh.triangleCount, controller.signal);
      if (controller.signal.aborted || disposed || textureWork !== controller || store.getProject().id !== projectId
        || !acceptNativeTexture(projectId, token, mesh, texture)) throw new Error('Camera textures belong to an inactive room.');
      options.onMeshChanged?.();
      return { ok: true };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Camera textures could not be loaded.';
      if (textureWork === controller && !controller.signal.aborted && !disposed) failNativeTexture(projectId, token, message);
      return { ok: false, error: message };
    } finally { if (textureWork === controller) { textureWork = null; finishPreparation('texture', preparationId, mesh); } }
  };
  const receivePlaneTexture = async (payload: unknown): Promise<NativeMeshReply> => {
    if (disposed) return { ok: false, error: 'The studio bridge is closed.' };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype
      || !['cameraSHA256,data,projectId,token', 'cameraSHA256,data,preparationId,projectId,token'].includes(Object.keys(payload).sort().join(','))) return { ok: false, error: 'Invalid measured-plane image transfer.' };
    const { projectId, token, preparationId, cameraSHA256, data } = payload as Record<string, unknown>;
    const mesh = useNativeMesh.getState().mesh;
    if (!mesh || !meshFrame || typeof projectId !== 'string' || typeof token !== 'string' || projectId !== activeId || token !== assetToken
      || store.getProject().id !== activeId || !ownsNativeMesh(projectId, token)) return { ok: false, error: 'Measured-plane images belong to an inactive room.' };
    if (typeof cameraSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(cameraSHA256)) return { ok: false, error: 'Invalid native camera evidence provenance.' };
    if (!preparationMatches('planeTexture', preparationId, mesh)) return { ok: false, error: 'Measured-plane images belong to an obsolete preparation.' };
    planeTextureWork?.abort();
    const controller = new AbortController(); planeTextureWork = controller;
    const frame = meshFrame, surfaces = rawSurfaces, objects = rawObjects, sourceGeometry = roomGeometryDigest, sourceAppearance = roomAppearanceDigest;
    beginNativePlaneTexture(projectId, token, mesh);
    try {
      const [roomGeometrySHA256, roomAppearanceSHA256, meshXYZSHA256] = await abortable(Promise.all([sourceGeometry, sourceAppearance, mesh.geometryDigest]), controller.signal);
      if (controller.signal.aborted || disposed || !roomGeometrySHA256 || !meshXYZSHA256 || !ownsNativeMesh(projectId, token)
        || useNativeMesh.getState().mesh !== mesh) throw new Error('Captured evidence could not be verified for measured-plane images.');
      // cameraSHA256 is native cache provenance, bound to this token-owned
      // message. Camera pixels/archives never cross this bridge for JS hashing.
      const prep = preparations.get('planeTexture'); if (prep?.mesh === mesh) clearTimeout(prep.timer);
      const texture = await loadNativePlaneTexture(data, { roomGeometrySHA256, ...(roomAppearanceSHA256 ? { roomAppearanceSHA256 } : {}), meshXYZSHA256, cameraSHA256, surfaces, objects, frame }, controller.signal);
      if (controller.signal.aborted || disposed || planeTextureWork !== controller || store.getProject().id !== projectId
        || !acceptNativePlaneTexture(projectId, token, mesh, texture)) throw new Error('Measured-plane images belong to an inactive room.');
      options.onMeshChanged?.();
      return { ok: true };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Measured-plane images could not be loaded.';
      if (planeTextureWork === controller && !controller.signal.aborted && !disposed) failNativePlaneTexture(projectId, token, mesh, message);
      return { ok: false, error: message };
    } finally { if (planeTextureWork === controller) { planeTextureWork = null; finishPreparation('planeTexture', preparationId, mesh); } }
  };
  const receiveAssetState = (payload: unknown): NativeMeshReply => {
    if (disposed) return { ok: false, error: 'The studio bridge is closed.' };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype
      || !['projectId,requestId,stage,state,token', 'message,projectId,requestId,stage,state,token'].includes(Object.keys(payload).sort().join(','))) return { ok: false, error: 'Invalid native appearance preparation status.' };
    const { projectId, token, stage, requestId, state, message } = payload as Record<string, unknown>;
    const mesh = useNativeMesh.getState().mesh;
    if (!mesh || typeof projectId !== 'string' || typeof token !== 'string' || projectId !== activeId || token !== assetToken || store.getProject().id !== activeId
      || !ownsNativeMesh(projectId, token)) return { ok: false, error: 'Appearance preparation belongs to an inactive room.' };
    if ((stage !== 'texture' && stage !== 'planeTexture') || (state !== 'pending' && state !== 'failed' && state !== 'unavailable')
      || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId) || (message !== undefined && (typeof message !== 'string' || message.length > 1000))) return { ok: false, error: 'Invalid native appearance preparation state.' };
    const previous = preparations.get(stage);
    const abortWork = () => { if (stage === 'texture') { textureWork?.abort(); textureWork = null; } else { planeTextureWork?.abort(); planeTextureWork = null; } };
    const failStage = (text: string) => { if (stage === 'texture') failNativeTexture(projectId, token, text); else failNativePlaneTexture(projectId, token, mesh, text); };
    if (state === 'pending') {
      if (previous?.requestId === requestId && previous.mesh === mesh) return { ok: true };
      abortWork(); clearTimeout(previous?.timer);
      const prep: AssetPreparation = { requestId, mesh };
      preparations.set(stage, prep);
      if (stage === 'texture') beginNativeTexture(projectId, token); else beginNativePlaneTexture(projectId, token, mesh);
      prep.timer = setTimeout(() => {
        if (disposed || preparations.get(stage) !== prep || !ownsNativeMesh(projectId, token) || useNativeMesh.getState().mesh !== mesh) return;
        abortWork(); preparations.delete(stage);
        failStage('Native appearance preparation took too long. Original scan appearance remains available.');
      }, 90000);
    } else {
      if (!previous || previous.requestId !== requestId || previous.mesh !== mesh) return { ok: false, error: 'Appearance status belongs to an obsolete preparation.' };
      abortWork(); clearTimeout(previous.timer); preparations.delete(stage);
      failStage(typeof message === 'string' && message.length ? message : 'No additional camera appearance is available for this capture.');
    }
    return { ok: true };
  };
  const nativeFlush = () => flush(true);
  const requestDetailPhotos = (): NativeMeshReply => {
    if (disposed || !activeId || !assetToken || store.getProject().id !== activeId || !ownsNativeMesh(activeId, assetToken)) return { ok: false, error: 'Open a native scanned room first.' };
    if (useNativeDetailPhotos.getState().pending) return { ok: false, error: 'A photo request is already open on your iPhone.' };
    const requestId = crypto.randomUUID(), projectId = activeId;
    useNativeDetailPhotos.setState({ projectId, token: assetToken, requestId, pending: true, photos: [], error: null });
    clearTimeout(photoTimer);
    photoTimer = setTimeout(() => {
      if (useNativeDetailPhotos.getState().requestId === requestId) useNativeDetailPhotos.setState({ pending: false, requestId: null, error: 'The photo request expired. Try again when the app is active.' });
    }, 180_000);
    if (!send({ type: 'requestDetailPhotos', projectId, token: assetToken, requestId })) {
      clearTimeout(photoTimer); useNativeDetailPhotos.setState({ pending: false, requestId: null, error: 'The native app could not receive the photo request.' });
      return { ok: false, error: 'Could not request saved photos.' };
    }
    return { ok: true };
  };
  const receiveDetailPhotos = (payload: unknown): NativeMeshReply => {
    const parsed = NativeDetailPhotoReplyZ.safeParse(payload), current = useNativeDetailPhotos.getState();
    if (!parsed.success) return { ok: false, error: 'Invalid saved photo transfer.' };
    const reply = parsed.data;
    if (disposed || !current.pending || reply.projectId !== activeId || reply.token !== assetToken || reply.requestId !== current.requestId
      || current.projectId !== activeId || current.token !== assetToken || store.getProject().id !== activeId || !ownsNativeMesh(reply.projectId, reply.token)) return { ok: false, error: 'Saved photos belong to an inactive request.' };
    if (new Set(reply.photos.map(p => p.id)).size !== reply.photos.length) return { ok: false, error: 'Duplicate saved photo identifiers.' };
    clearTimeout(photoTimer);
    useNativeDetailPhotos.setState({ pending: false, requestId: null, photos: reply.error ? [] : reply.photos.map(p => ({ id: p.id, url: `data:image/jpeg;base64,${p.data}` })), error: reply.error ?? null });
    return { ok: true };
  };
  const assetTransfer = createNativeAssetTransfer(
    (projectId, token) => !disposed && projectId === activeId && token === assetToken && store.getProject().id === activeId && ownsNativeMesh(projectId, token),
    (stage, packet) => stage === 'mesh' ? receiveMesh(packet) : stage === 'texture' ? receiveTexture(packet) : receivePlaneTexture(packet),
  );
  host.manhattanNativeFlush = nativeFlush;
  host.manhattanNativeImport = receive;
  host.manhattanNativeMesh = receiveMesh;
  host.manhattanNativeTexture = receiveTexture;
  host.manhattanNativePlaneTexture = receivePlaneTexture;
  host.manhattanNativeAssetState = receiveAssetState;
  host.manhattanNativeAssetTransfer = assetTransfer.receive;
  host.manhattanNativeRequestDetailPhotos = requestDetailPhotos;
  host.manhattanNativeDetailPhotos = receiveDetailPhotos;
  host.manhattanNativeReady = true;
  send({ type: 'ready' });
  return { flush, dispose() {
    flush(); disposed = true; clearTimeout(timer); unsubscribe();
    assetTransfer.clear();
    clearPhotos();
    textureWork?.abort(); textureWork = null;
    planeTextureWork?.abort(); planeTextureWork = null;
    clearPreparations();
    clearNativeMesh(assetToken);
    if (host.manhattanNativeMesh === receiveMesh) delete host.manhattanNativeMesh;
    if (host.manhattanNativeAssetTransfer === assetTransfer.receive) delete host.manhattanNativeAssetTransfer;
    if (host.manhattanNativeRequestDetailPhotos === requestDetailPhotos) delete host.manhattanNativeRequestDetailPhotos;
    if (host.manhattanNativeDetailPhotos === receiveDetailPhotos) delete host.manhattanNativeDetailPhotos;
    if (host.manhattanNativeTexture === receiveTexture) delete host.manhattanNativeTexture;
    if (host.manhattanNativePlaneTexture === receivePlaneTexture) delete host.manhattanNativePlaneTexture;
    if (host.manhattanNativeAssetState === receiveAssetState) delete host.manhattanNativeAssetState;
    if (host.manhattanNativeImport === receive) { delete host.manhattanNativeImport; delete host.manhattanNativeFlush; host.manhattanNativeReady = false; }
  } };
}
