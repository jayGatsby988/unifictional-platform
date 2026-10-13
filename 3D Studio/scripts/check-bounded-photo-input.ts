import assert from 'node:assert/strict';
import { z } from 'zod';
import { HttpError, readJson } from '../src/app/api/_lib/http';
import { validatePhotoInputBytes } from '../src/lib/native/photo-input';

function streamed(chunks: Uint8Array[], contentLength?: string) {
  let index = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close(); }, cancel() { cancelled = true; } });
  const req = new Request('http://localhost/api/native/finishes', { method: 'POST', body, duplex: 'half', ...(contentLength ? { headers: { 'content-length': contentLength } } : {}) } as RequestInit);
  return { req, cancelled: () => cancelled };
}
const encoder = new TextEncoder(), schema = z.object({ text: z.string() });
const utf8 = encoder.encode(JSON.stringify({ text: 'cabinet · 木' }));
const split = [...utf8].map(byte => new Uint8Array([byte]));
assert.deepEqual(await readJson(streamed(split).req, schema, { maxBytes: utf8.length }), { text: 'cabinet · 木' });
console.log('PASS chunked UTF-8 JSON stays intact across split multibyte characters');
for (const declared of [undefined, '1']) {
  const request = streamed([encoder.encode('{"text":"'), new Uint8Array(128), new Uint8Array(128)], declared);
  await assert.rejects(readJson(request.req, schema, { maxBytes: 32 }), (error: unknown) => error instanceof HttpError && error.status === 413);
  assert.equal(request.cancelled(), true);
}
console.log('PASS actual body limit rejects and cancels missing or dishonest content-length streams');
for (const bytes of [encoder.encode('{'), new Uint8Array([123, 255, 125])]) {
  await assert.rejects(readJson(streamed([bytes]).req, schema), (error: unknown) => error instanceof HttpError && error.status === 400);
}
await assert.rejects(readJson(streamed([encoder.encode('{"wrong":1}')]).req, schema), (error: unknown) => error instanceof HttpError && error.code === 'validation_error');
console.log('PASS malformed UTF-8, malformed JSON and invalid body shape have bounded client errors');
function png(width: number, height: number) { const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]); bytes.set([73,72,68,82],12); const view = new DataView(bytes.buffer); view.setUint32(16,width); view.setUint32(20,height); return bytes; }
assert.deepEqual(validatePhotoInputBytes(png(4032,3024)), { width:4032,height:3024,mime:'image/png' });
for (const dimensions of [[8064,6048],[8193,64],[64,63],[0,4000]]) assert.throws(() => validatePhotoInputBytes(png(...dimensions as [number,number])));
assert.throws(() => validatePhotoInputBytes(new Uint8Array(20*1024*1024+1)));
assert.throws(() => validatePhotoInputBytes(encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"/>')));
console.log('PASS image headers reject huge decoded allocations, invalid formats and undersized inputs before browser decoding');
