/** Offline transport regressions: no provider calls or uploads leave this process. */
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { ndjsonResponse } from '../src/app/api/_lib/ndjson';
import { POST as refineRoute } from '../src/app/api/refine/route';
import { ApiError, analyzeRoom, uploadPhotos, uploadViewport } from '../src/lib/api-client';
import { openaiClient } from '../src/lib/ai/providers/openai';
import { refineSpec, REFINEMENT_DEADLINE_MS, REFINEMENT_PROVIDER_TIMEOUT_MS } from '../src/lib/ai/refine';
import { ProviderError } from '../src/lib/ai/providers/types';
import { defaultKitchen } from '../src/lib/spec/defaults';
import { captureRefinementEvidence, evidenceMatches, protectedFinishSlots } from '../src/lib/refinement-evidence';

const pause = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('operation hung after cancellation')), 800); });
  try { return await Promise.race([promise, expired]); } finally { clearTimeout(timer!); }
}
async function until(check: () => boolean) {
  await deadline((async () => { while (!check()) await pause(); })());
}
const aborted = (error: unknown) => error instanceof ApiError && error.code === 'aborted';
let passed = 0;
async function test(name: string, check: () => Promise<void>) {
  await check(); passed++; console.log(`  ✓ ${name}`);
}

async function streamChecks() {
  const nativeSet = globalThis.setInterval;
  const nativeClear = globalThis.clearInterval;
  const active = new Set<ReturnType<typeof setInterval>>();
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const timer = nativeSet(...args); active.add(timer); return timer;
  }) as typeof setInterval;
  globalThis.clearInterval = ((timer: ReturnType<typeof setInterval>) => {
    active.delete(timer); nativeClear(timer);
  }) as typeof clearInterval;
  try {
    await test('pre-aborted request starts no producer and closes its response', async () => {
      const request = new AbortController(); request.abort();
      let calls = 0;
      const response = ndjsonResponse(async () => { calls++; }, { signal: request.signal });
      assert.equal(await deadline(response.text()), '');
      assert.equal(calls, 0); assert.equal(active.size, 0);
      assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    });
    for (const source of ['request', 'reader'] as const) {
      await test(`${source} cancellation stops producer, closes pending reads, and releases keep-alive/listener`, async () => {
        const request = new AbortController();
        let producerSignal: AbortSignal | undefined;
        let producerStopped = false;
        const response = ndjsonResponse(async (emit, signal) => {
          producerSignal = signal;
          emit({ phase: 'analyzing', message: 'in progress', progress: 0.1 });
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => { producerStopped = true; resolve(); }, { once: true }));
          emit({ phase: 'done', message: 'stale result', progress: 1 });
        }, { signal: request.signal, keepAliveMs: 10 });
        const reader = response.body!.getReader();
        assert.equal((await deadline(reader.read())).done, false);
        const pending = reader.read();
        const reason = new Error(`${source} stopped`);
        if (source === 'request') request.abort(reason); else await reader.cancel(reason);
        assert.equal((await deadline(pending)).done, true);
        assert.equal(producerSignal?.aborted, true);
        assert.equal(producerSignal?.reason, reason);
        await pause();
        assert.equal(producerStopped, true); assert.equal(active.size, 0);
        assert.equal(getEventListeners(request.signal, 'abort').length, 0);
        reader.releaseLock();
      });
    }
    await test('heartbeats omit the full spec and success releases transport resources', async () => {
      const request = new AbortController();
      const response = ndjsonResponse(async (emit) => {
        emit({ phase: 'building', message: 'building', progress: 0.9, spec: { large: 'payload' } });
        await pause(25);
        emit({ phase: 'done', message: 'done', progress: 1 });
      }, { signal: request.signal, keepAliveMs: 5 });
      const events = (await deadline(response.text())).trim().split('\n').map((line) => JSON.parse(line));
      const heartbeats = events.filter((e) => e.heartbeat);
      assert.ok(heartbeats.length > 0); assert.ok(heartbeats.every((e) => !('spec' in e)));
      assert.equal(events.at(-1).phase, 'done'); assert.equal(active.size, 0);
      assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    });
    await test('synchronous producer and error-mapper failures emit a terminal event and clean up', async () => {
      const request = new AbortController();
      const response = ndjsonResponse(() => { throw new Error('producer failed'); }, {
        signal: request.signal, onError: () => { throw new Error('mapper failed'); },
      });
      const event = JSON.parse(await deadline(response.text()));
      assert.equal(event.phase, 'error'); assert.equal(event.message, 'producer failed');
      assert.equal(active.size, 0); assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    });
  } finally {
    for (const timer of active) nativeClear(timer);
    globalThis.setInterval = nativeSet; globalThis.clearInterval = nativeClear;
  }
}

async function clientChecks() {
  const nativeFetch = globalThis.fetch;
  const input = { roomType: 'kitchen' as const, photos: [{ url: '/photo.jpg', primary: true }] };
  try {
    await test('client cancellation closes a pending response and releases its reader', async () => {
      let cancelled = false;
      const request = new AbortController();
      const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }));
      globalThis.fetch = async (_path, init) => { assert.equal(init?.signal, request.signal); return response; };
      const result = analyzeRoom(input, undefined, request.signal);
      const rejects = assert.rejects(deadline(result), aborted);
      await until(() => response.body!.locked);
      request.abort(); await rejects;
      assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
      assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    });
    await test('a progress consumer failure cancels upstream work instead of leaking the stream', async () => {
      let cancelled = false;
      const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"phase":"analyzing","message":"x","progress":0.1}\n')); },
        cancel() { cancelled = true; },
      }));
      globalThis.fetch = async () => response;
      await assert.rejects(deadline(analyzeRoom(input, () => { throw new Error('consumer failed'); })), /consumer failed/);
      assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
    });
    await test('NDJSON chunks and a final unterminated line still return the exact completed spec', async () => {
      const spec = defaultKitchen();
      const content = new TextEncoder().encode(JSON.stringify({ phase: 'done', message: 'Prêt — ready', progress: 1, spec }));
      const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
        for (let i = 0; i < content.length; i += 7) controller.enqueue(content.slice(i, i + 7));
        controller.close();
      } }));
      globalThis.fetch = async () => response;
      assert.deepEqual(await deadline(analyzeRoom(input)), spec);
      assert.equal(response.body!.locked, false);
    });
  } finally { globalThis.fetch = nativeFetch; }
}

class MockXHR {
  static sent: MockXHR[] = [];
  static throwOnSend = false;
  responseType = ''; response: unknown = null; status = 200; aborted = false;
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onloadend: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) { assert.equal(method, 'POST'); assert.equal(url, '/api/upload'); }
  send() { if (MockXHR.throwOnSend) throw new Error('send failed'); MockXHR.sent.push(this); }
  abort() { this.aborted = true; this.onabort?.(); this.onloadend?.(); }
  succeed(dimensions = true) {
    this.response = { photos: [{ url: '/uploaded.jpg', ...(dimensions ? { width: 100, height: 100 } : {}) }] };
    this.onload?.(); this.onloadend?.();
  }
}

async function uploadChecks() {
  const nativeFetch = globalThis.fetch;
  const nativeXHR = globalThis.XMLHttpRequest;
  const nativeBitmap = globalThis.createImageBitmap;
  const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
  globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;
  try {
    await test('cancelling a config wait returns promptly while another upload can use the shared config', async () => {
      const config = deferred<Response>();
      let configCalls = 0;
      globalThis.fetch = async () => { configCalls++; return config.promise; };
      const request = new AbortController();
      const first = uploadPhotos([file], 'test', undefined, request.signal);
      const rejected = assert.rejects(deadline(first), aborted);
      const second = uploadPhotos([file], 'test');
      request.abort(); await rejected;
      assert.equal(MockXHR.sent.length, 0);
      config.resolve(Response.json({ mode: 'server', maxBytes: 2000, accept: ['image/jpeg'] }));
      await until(() => MockXHR.sent.length === 1);
      MockXHR.sent[0].succeed();
      assert.equal((await deadline(second))[0].url, '/uploaded.jpg');
      assert.equal(configCalls, 1); assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    });
    await test('photo cancellation aborts its XHR, suppresses progress, and never starts the next file', async () => {
      MockXHR.sent = [];
      const request = new AbortController(); let progress = 0;
      const result = uploadPhotos([file, file], 'test', () => { progress++; }, request.signal);
      const rejected = assert.rejects(deadline(result), aborted);
      await until(() => MockXHR.sent.length === 1);
      const xhr = MockXHR.sent[0]; request.abort();
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 5 });
      await rejected;
      assert.equal(xhr.aborted, true); assert.equal(MockXHR.sent.length, 1); assert.equal(progress, 0);
      assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    });
    await test('viewport captures propagate cancellation through the public upload API', async () => {
      MockXHR.sent = [];
      const request = new AbortController();
      const result = uploadViewport(new Blob(['capture'], { type: 'image/jpeg' }), 'test', request.signal);
      const rejected = assert.rejects(deadline(result), aborted);
      await until(() => MockXHR.sent.length === 1);
      request.abort(); await rejected;
      assert.equal(MockXHR.sent[0].aborted, true);
      assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    });
    await test('cancellation during image decoding cannot publish a stale completed upload', async () => {
      MockXHR.sent = [];
      const bitmap = deferred<ImageBitmap>(); let decoding = false; let closed = false;
      globalThis.createImageBitmap = (async () => { decoding = true; return bitmap.promise; }) as typeof createImageBitmap;
      const request = new AbortController();
      const result = uploadPhotos([file], 'test', undefined, request.signal);
      const rejected = assert.rejects(deadline(result), aborted);
      await until(() => MockXHR.sent.length === 1);
      MockXHR.sent[0].succeed(false); await until(() => decoding);
      request.abort(); await rejected;
      bitmap.resolve({ width: 100, height: 100, close() { closed = true; } } as ImageBitmap);
      await until(() => closed);
      assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    });
    await test('synchronous upload transport errors release cancellation listeners', async () => {
      const request = new AbortController(); MockXHR.throwOnSend = true;
      await assert.rejects(deadline(uploadPhotos([file], 'test', undefined, request.signal)), /send failed/);
      assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    });
  } finally {
    globalThis.fetch = nativeFetch; globalThis.XMLHttpRequest = nativeXHR; globalThis.createImageBitmap = nativeBitmap;
    MockXHR.throwOnSend = false;
  }
}

async function routeChecks() {
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-no-network';
  const client = openaiClient(); const create = client.responses.create;
  try {
    let calls = 0;
    client.responses.create = (async () => {
      calls++;
      return { status: 'completed', output_text: JSON.stringify({ corrections: [], notes: [], finishes: [], match: 0.7 }) };
    }) as unknown as typeof create;
    const spec = defaultKitchen(); spec.detected.elements = [];
    const residuals = Array.from({ length: 90 }, (_, index) => ({
      kind: 'fridge', wall: 'back', index, iou: 0.5, dx: 0.1, dy: 0, dw: 0.1, dh: 0,
      err: 0.2, open: { left: true, right: false, top: false, bottom: false }, openCause: 'frame',
    }));
    const request = (gaps: unknown[], signal?: AbortSignal) => new Request('http://localhost/api/refine', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ spec, photoUrl: 'data:image/jpeg;base64,AA==', viewportUrl: 'data:image/jpeg;base64,AA==', passes: ['geometry'], residuals: gaps, hints: Array.from({ length: 90 }, () => 'missing item') }),
    });
    await test('refine accepts the full 90-element residual contract and rejects 91 before calling a provider', async () => {
      const accepted = await deadline(refineRoute(request(residuals)));
      assert.equal(accepted.status, 200, await accepted.text()); assert.equal(calls, 1);
      const rejected = await deadline(refineRoute(request([...residuals, residuals[0]])));
      assert.equal(rejected.status, 400); assert.equal(calls, 1);
    });
    await test('refine propagates request cancellation to the active provider', async () => {
      let providerSignal: AbortSignal | undefined;
      client.responses.create = (async (_body: unknown, options?: { signal?: AbortSignal }) => {
        providerSignal = options?.signal;
        return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
      }) as unknown as typeof create;
      const controller = new AbortController();
      const pending = refineRoute(request([], controller.signal));
      await until(() => !!providerSignal);
      controller.abort(); await deadline(pending);
      assert.equal(providerSignal?.aborted, true);
    });
    await test('refine gives detailed vision a bounded240-second call with no SDK retries and maps provider timeout to504', async () => {
      let count = 0;
      client.responses.create = (async (_body: unknown, options?: { timeout?: number; maxRetries?: number }) => {
        count++;
        assert.equal(options?.timeout, REFINEMENT_PROVIDER_TIMEOUT_MS);
        assert.equal(options?.maxRetries, 0);
        throw new Error('Request timed out.');
      }) as unknown as typeof create;
      await assert.rejects(refineSpec({spec, photoUrl: '/photo', viewportUrl: '/viewport', passes: ['finishes']}),
        e => e instanceof ProviderError && e.status === 504 && e.code === 'timeout' && e.retryable);
      assert.equal(count, 1);
      const response = await deadline(refineRoute(request([])));
      assert.equal(response.status, 504); assert.equal(count, 2);
    });
    await test('refine overall deadline aborts vision and clears its timer on timeout and success', async () => {
      const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
      const active = new Set<ReturnType<typeof setTimeout>>();
      globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
        const own = args[1] === REFINEMENT_DEADLINE_MS;
        if (own) args[1] = 10;
        const timer = nativeSet(...args);
        if (own) active.add(timer);
        return timer;
      }) as typeof setTimeout;
      globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
        active.delete(timer); nativeClear(timer);
      }) as typeof clearTimeout;
      try {
        let count = 0, providerSignal: AbortSignal | undefined;
        client.responses.create = (async (_body: unknown, options?: { signal?: AbortSignal }) => {
          count++; providerSignal = options?.signal;
          return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')), { once: true }));
        }) as unknown as typeof create;
        await assert.rejects(deadline(refineSpec({spec, photoUrl: '/photo', viewportUrl: '/viewport', passes: ['finishes']})),
          e => e instanceof ProviderError && e.status === 504 && e.code === 'timeout' && e.retryable);
        assert.equal(count, 1); assert.equal(providerSignal?.aborted, true); assert.equal(active.size, 0);
        providerSignal = undefined;
        const cancel = new AbortController();
        const cancelled = refineSpec({spec, photoUrl: '/photo', viewportUrl: '/viewport', passes: ['finishes'], signal: cancel.signal});
        const cancellation = assert.rejects(cancelled, e => e instanceof DOMException && e.name === 'AbortError');
        await until(() => !!providerSignal);
        cancel.abort(); await cancellation;
        assert.equal(active.size, 0);
        client.responses.create = (async () => ({status: 'completed', output_text: JSON.stringify({corrections: [], notes: [], finishes: [], match: 0.7})})) as unknown as typeof create;
        await deadline(refineSpec({spec, photoUrl: '/photo', viewportUrl: '/viewport', passes: ['finishes']}));
        assert.equal(active.size, 0);
      } finally { globalThis.setTimeout = nativeSet; globalThis.clearTimeout = nativeClear; }
    });
  } finally {
    client.responses.create = create;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
}

async function evidenceChecks() {
  await test('a camera-only fit invalidates the earlier screenshot even with zero model corrections', async () => {
    const spec = defaultKitchen();
    const selections = { ...spec.materials };
    const evidence = { spec, selections, viewportUrl: '/before-fit.jpg' };
    const fitted = { ...spec, detected: { ...spec.detected, camera: { ...spec.detected.camera, solved: {
      x: 1, y: 1.5, z: 4, yawDeg: 12, pitchDeg: -4, fovDeg: 60, aspect: 1.5, score: 0.91,
    } } } };
    assert.equal(evidenceMatches(evidence, spec, { ...selections }), true);
    assert.equal(evidenceMatches(evidence, fitted, selections), false);
    assert.equal(evidenceMatches(evidence, spec, { ...selections, cabinets_base: 'wood-black-walnut' }), false);
  });
  await test('material changes during canvas encoding discard the ambiguous frame before upload', async () => {
    const spec = defaultKitchen();
    let selections = { ...spec.materials };
    let uploads = 0;
    const result = await captureRefinementEvidence({
      read: () => ({ spec, selections }), alive: () => true,
      capture: async () => { selections = { ...selections, cabinets_base: 'wood-black-walnut' }; return new Blob(['frame']); },
      upload: async () => { uploads++; return '/never-uploaded.jpg'; },
    });
    assert.equal(result, null); assert.equal(uploads, 0);
  });
  await test('upload latency cannot relabel the screenshot with a later material selection', async () => {
    const spec = defaultKitchen();
    const atCapture = { ...spec.materials };
    let selections = { ...atCapture };
    const upload = deferred<string>(); let uploading = false;
    const pending = captureRefinementEvidence({
      read: () => ({ spec, selections }), alive: () => true,
      capture: async () => new Blob(['frame']),
      upload: () => { uploading = true; return upload.promise; },
    });
    await until(() => uploading);
    selections = { ...selections, cabinets_base: 'wood-black-walnut' };
    upload.resolve('/captured.jpg');
    const evidence = await deadline(pending);
    assert.equal(evidence?.spec, spec); assert.deepEqual(evidence?.selections, atCapture);
    assert.equal(evidence?.viewportUrl, '/captured.jpg');
    assert.equal(evidenceMatches(evidence!, spec, selections), false);
  });
  await test('finish adoption protects choices made both before capture and during the model request', async () => {
    const spec = defaultKitchen();
    const atCapture = { ...spec.materials, cabinets_base: 'wood-black-walnut' };
    const current = { ...atCapture, flooring: 'floor-walnut-plank' };
    const protectedSlots = protectedFinishSlots(spec, atCapture, current);
    assert.ok(protectedSlots.has('cabinets_base')); assert.ok(protectedSlots.has('flooring'));
    assert.equal(protectedSlots.has('backsplash'), false);
  });
}

async function main() {
  await streamChecks(); await clientChecks(); await uploadChecks(); await routeChecks(); await evidenceChecks();
  console.log(`\nALL ${passed} STREAM/UPLOAD CHECKS PASSED`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
