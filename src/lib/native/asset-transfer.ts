/** Bounded native packets avoid materializing an entire base64 archive in the
 * WebKit argument dictionary. Only a completed, token-owned binary reaches a
 * decoder. The original archive validators remain authoritative. */
export const NATIVE_CHUNK_BYTES = 262_144;
const LIMITS = { mesh: 15_360_013, texture: 34 * 1024 * 1024, planeTexture: 8 * 1024 * 1024 };
export type NativeAssetStage = keyof typeof LIMITS;
type Reply = { ok: true; complete: boolean } | { ok: false; error: string };
type Chunk = {
  projectId: string; token: string; stage: NativeAssetStage; transferId: string;
  partIndex: number; partCount: number; byteLength: number; data: string;
  preparationId?: string; cameraSHA256?: string;
};
type Packet = { projectId: string; token: string; data: ArrayBuffer; preparationId?: string; cameraSHA256?: string };
type Assembly = { header: Chunk; bytes: Uint8Array<ArrayBuffer>; next: number; timer: ReturnType<typeof setTimeout> };
type Completion = { partIndex: number; lastChunk: string; settled: boolean; reply: Promise<Reply> };
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(v);
const signature = (c: Chunk) => JSON.stringify([c.projectId, c.token, c.stage, c.transferId, c.partCount, c.byteLength, c.preparationId, c.cameraSHA256]);

function parse(value: unknown): Chunk {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Invalid native asset packet.');
  const c = value as Chunk;
  const required = ['projectId', 'token', 'stage', 'transferId', 'partIndex', 'partCount', 'byteLength', 'data'];
  if (required.some(k => !Object.hasOwn(c, k)) || Object.keys(c).some(k => ![...required, 'preparationId', 'cameraSHA256'].includes(k))) throw new Error('Invalid native asset fields.');
  if (!id(c.projectId) || !id(c.token) || !id(c.transferId) || !Object.hasOwn(LIMITS, c.stage)
    || !Number.isSafeInteger(c.byteLength) || c.byteLength < 13 || c.byteLength > LIMITS[c.stage]
    || c.partCount !== Math.ceil(c.byteLength / NATIVE_CHUNK_BYTES) || !Number.isSafeInteger(c.partIndex) || c.partIndex < 0 || c.partIndex >= c.partCount
    || (c.preparationId !== undefined && !id(c.preparationId))
    || (c.cameraSHA256 !== undefined && (typeof c.cameraSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(c.cameraSHA256)))) throw new Error('Invalid native asset bounds.');
  const length = Math.min(NATIVE_CHUNK_BYTES, c.byteLength - c.partIndex * NATIVE_CHUNK_BYTES);
  if (typeof c.data !== 'string' || c.data.length !== Math.ceil(length / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(c.data)) throw new Error('Invalid native chunk encoding.');
  return c;
}

export function createNativeAssetTransfer(owns: (projectId: string, token: string) => boolean,
  receive: (stage: NativeAssetStage, packet: Packet) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string }) {
  let assembly: Assembly | null = null;
  let generation = 0;
  const completed = new Map<string, Completion>();
  const clear = () => { generation++; if (assembly) clearTimeout(assembly.timer); assembly = null; completed.clear(); };
  const receiveChunk = async (value: unknown): Promise<Reply> => {
    try {
      const c = parse(value);
      if (!owns(c.projectId, c.token)) throw new Error('This asset transfer belongs to an inactive room.');
      const key = signature(c);
      // Bound every decode, including duplicate packets, before allocating the archive.
      const raw = atob(c.data), expected = Math.min(NATIVE_CHUNK_BYTES, c.byteLength - c.partIndex * NATIVE_CHUNK_BYTES);
      if (raw.length !== expected || btoa(raw) !== c.data) throw new Error('Invalid native chunk padding.');
      const previous = completed.get(key);
      if (previous) {
        // Only the final packet can retry a completion acknowledgement. Retain
        // at most four bounded chunks, never the complete decoded archives.
        if (previous.partIndex !== c.partIndex || previous.lastChunk !== raw) throw new Error('A completed native asset was retried with different contents.');
        return previous.reply;
      }
      if (c.partIndex === 0 && [...completed.values()].filter(item => !item.settled).length >= 4) throw new Error('Wait for the current native assets to finish processing.');
      if (assembly && c.partIndex === 0 && signature(assembly.header) !== key) { clearTimeout(assembly.timer); assembly = null; }
      if (!assembly) {
        if (c.partIndex !== 0) throw new Error('The native asset must start with its first packet.');
        const timer = setTimeout(() => { assembly = null; }, 60_000);
        assembly = { header: c, bytes: new Uint8Array(c.byteLength), next: 0, timer };
      }
      const a = assembly;
      if (signature(a.header) !== key) throw new Error('Another native asset transfer is still in progress.');
      if (c.partIndex > a.next) throw new Error('A native asset packet is missing.');
      const offset = c.partIndex * NATIVE_CHUNK_BYTES;
      if (c.partIndex < a.next) {
        for (let i = 0; i < raw.length; i++) if (a.bytes[offset + i] !== raw.charCodeAt(i)) throw new Error('A repeated native packet changed its contents.');
        return { ok: true, complete: false };
      }
      for (let i = 0; i < raw.length; i++) a.bytes[offset + i] = raw.charCodeAt(i);
      a.next++;
      clearTimeout(a.timer);
      if (a.next < c.partCount) { a.timer = setTimeout(() => { assembly = null; }, 60_000); return { ok: true, complete: false }; }
      assembly = null;
      const packet: Packet = { projectId: c.projectId, token: c.token, data: a.bytes.buffer,
        ...(c.preparationId !== undefined ? { preparationId: c.preparationId } : {}), ...(c.cameraSHA256 !== undefined ? { cameraSHA256: c.cameraSHA256 } : {}) };
      const started = generation;
      const isCurrent = () => started === generation && owns(c.projectId, c.token);
      const pending = Promise.resolve().then(() => {
        if (!isCurrent()) throw new Error('The native asset transfer was cancelled.');
        return receive(c.stage, packet);
      }).then((reply): Reply => {
        if (!isCurrent()) return { ok: false, error: 'The room changed while its asset was processing.' };
        return reply.ok ? { ok: true, complete: true } : { ok: false, error: reply.error ?? 'The native archive could not be opened.' };
      }).catch((error): Reply => ({ ok: false, error: error instanceof Error ? error.message : 'Native asset processing failed.' }));
      const completion: Completion = { partIndex: c.partIndex, lastChunk: raw, settled: false, reply: pending };
      completed.set(key, completion);
      if (completed.size > 4) {
        const oldest = [...completed].find(([, item]) => item.settled);
        if (oldest) completed.delete(oldest[0]);
      }
      const reply = await pending;
      completion.settled = true;
      // An old failure must not delete a same-ID retry after clear().
      if (!reply.ok && completed.get(key) === completion) completed.delete(key);
      return reply;
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Native asset transfer failed.' }; }
  };
  return { receive: receiveChunk, clear };
}
