import { decodeTextureArchive, MAX_TEXTURE_BASE64, MAX_TEXTURE_BYTES, type ScanTexture } from './texture-archive';
/** Bounded work runs outside the render/UI thread. Cancellation terminates
 * both the decoder and its memory when the native room or document changes. */
export async function loadNativeTexture(data: unknown, digest: string, triangles: number, signal: AbortSignal): Promise<ScanTexture> {
  if (!(data instanceof ArrayBuffer ? data.byteLength >= 50 && data.byteLength <= MAX_TEXTURE_BYTES : typeof data === 'string' && data.length > 0 && data.length <= MAX_TEXTURE_BASE64)) throw new Error('Invalid camera texture size.');
  if (signal.aborted) throw new Error('Camera texture transfer cancelled.');
  if (typeof Worker === 'undefined') return decodeTextureArchive(data, digest, triangles);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./texture-worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error, value?: ScanTexture) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else if (value) resolve(value);
    };
    const abort = () => finish(new Error('Camera texture transfer cancelled.'));
    const timeout = setTimeout(() => finish(new Error('Camera texture processing took too long. Captured vertex colors remain available.')), 45000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('Camera texture processing could not start.'));
    worker.onmessage = (event: MessageEvent<{ ok: boolean; error?: string; texture?: ScanTexture }>) => {
      if (!event.data.ok || !event.data.texture) finish(new Error(event.data.error ?? 'Invalid camera texture reply.'));
      else finish(undefined, event.data.texture);
    };
    try { worker.postMessage({ data, digest, triangles }, data instanceof ArrayBuffer ? [data] : []); }
    catch { finish(new Error('Camera textures could not be sent for processing.')); }
  });
}
