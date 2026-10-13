import { decodePlaneTextureArchive, MAX_PLANE_TEXTURE_BASE64, MAX_PLANE_TEXTURE_BYTES, type PlaneTextureExpectation, type ScanPlaneTexture } from './plane-texture-archive';

/** Image parsing and validation stay off the main thread. Closing/replacing
 * the room terminates the worker and its owned buffers. */
export async function loadNativePlaneTexture(data: unknown, expected: PlaneTextureExpectation, signal: AbortSignal): Promise<ScanPlaneTexture> {
  if (!(data instanceof ArrayBuffer ? data.byteLength >= 107 && data.byteLength <= MAX_PLANE_TEXTURE_BYTES : typeof data === 'string' && data.length > 0 && data.length <= MAX_PLANE_TEXTURE_BASE64)) throw new Error('Invalid measured-plane image size.');
  if (signal.aborted) throw new Error('Measured-plane image transfer cancelled.');
  if (typeof Worker === 'undefined') return decodePlaneTextureArchive(data, expected);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./plane-texture-worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error, value?: ScanPlaneTexture) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else if (value) resolve(value);
    };
    const abort = () => finish(new Error('Measured-plane image transfer cancelled.'));
    const timeout = setTimeout(() => finish(new Error('Measured-plane image processing took too long. Original scan appearance remains available.')), 45000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('Measured-plane image processing could not start.'));
    worker.onmessage = (event: MessageEvent<{ ok: boolean; error?: string; texture?: ScanPlaneTexture }>) => {
      if (!event.data.ok || !event.data.texture) finish(new Error(event.data.error ?? 'Invalid measured-plane image reply.'));
      else finish(undefined, event.data.texture);
    };
    try { worker.postMessage({ data, expected }, data instanceof ArrayBuffer ? [data] : []); }
    catch { finish(new Error('Measured-plane images could not be sent for processing.')); }
  });
}
