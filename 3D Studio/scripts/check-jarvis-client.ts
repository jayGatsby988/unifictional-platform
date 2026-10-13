/** Offline client transport checks, no network, credentials or paid generations. */
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import sample from './fixtures/native-countertop-contours.sample.json';
import { importNativeScan } from '../src/lib/native/scan-import';
import { createWorkspace, finishWorkspace } from '../src/lib/jarvis/tools';
import { designFingerprint, snapshotOf, type JarvisEvent, type JarvisTurnResult } from '../src/lib/jarvis/types';
import { readJarvisStream, jarvisClientDeadline, JarvisClientError, jarvisClientErrorMessage, JARVIS_CLIENT_DEADLINE_MS } from '../src/lib/jarvis/client';
const encoder = new TextEncoder(), pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const project = importNativeScan(structuredClone(sample)).project;
const result: JarvisTurnResult = { ...finishWorkspace(createWorkspace(project)), model: 'gpt-6-astra', reply: 'Saved café finish review.', activities: [], baseFingerprint: designFingerprint(snapshotOf(project)) };
const done = JSON.stringify({ type: 'done', result });
const response = (text: string) => new Response(text, { headers: { 'content-type': 'application/x-ndjson' } });
async function bounded<T>(work: Promise<T>): Promise<T> { let timer: ReturnType<typeof setTimeout>; try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic check hung')), 1000); })]); } finally { clearTimeout(timer!); } }
let passed = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); console.log(`PASS ${name}`); passed++; }
async function main() {
  await check('complete split UTF-8 streams return the exact final response only after closure', async () => {
    const data = encoder.encode(`{\"type\":\"status\",\"message\":\"Working\"}\n${done}`), events: JarvisEvent[] = [], before = JSON.stringify(project);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let at = 0; at < data.length; at += 17) controller.enqueue(data.slice(at, at + 17)); controller.close(); } });
    assert.deepEqual(await readJarvisStream(new Response(stream), event => events.push(event), new AbortController().signal), result); assert.equal(events.length, 2); assert.equal(JSON.stringify(project), before);
  });
  await check('truncated, failed, malformed and oversized responses never return a design commit', async () => {
    for (const text of ['', '{"type":"status","message":"Working"}\n', `${done}\n{"type":"error","code":"timeout","error":"No changes were applied."}`, `${done}\ntruncated`, 'null', 'x'.repeat(4 * 1024 * 1024 + 1)]) {
      await assert.rejects(readJarvisStream(response(text), () => {}, new AbortController().signal));
    }
  });
  await check('existing stalled mobile reader remains pending without a deadline, while Stop cancels it promptly', async () => {
    const controller = new AbortController(); let settled = false, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const reading = readJarvisStream(new Response(stream), () => {}, controller.signal).finally(() => { settled = true; });
    await pause(20); assert.equal(settled, false, 'reproduces old hook waiting on a stalled connection');
    controller.abort(); await assert.rejects(bounded(reading), error => error instanceof DOMException && error.name === 'AbortError'); assert.equal(cancelled, true);
  });
  await check('whole-turn deadline cancels an idle reader, clears pending work and releases listeners', async () => {
    const parent = new AbortController(), budget = jarvisClientDeadline(parent.signal, 15); let cancelled = false, busy = true;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    try { await assert.rejects(bounded(budget.run(readJarvisStream(new Response(stream), () => {}, budget.signal))), error => error instanceof JarvisClientError && error.code === 'timeout'); }
    finally { budget.dispose(); busy = false; }
    assert.equal(busy, false); assert.equal(cancelled, true); assert.equal(getEventListeners(parent.signal, 'abort').length, 0); assert.equal(getEventListeners(budget.signal, 'abort').length, 0);
  });
  await check('a stalled fetch that ignores AbortSignal cannot hold the turn open or publish late events', async () => {
    const parent = new AbortController(), budget = jarvisClientDeadline(parent.signal, 10), events: JarvisEvent[] = []; let release!: (value: Response) => void, committed = false;
    const work = (async () => { const fetched = await new Promise<Response>(resolve => { release = resolve; }); const parsed = await readJarvisStream(fetched, event => { budget.check(); events.push(event); }, budget.signal); budget.check(); committed = !!parsed; })();
    try { await assert.rejects(bounded(budget.run(work)), error => error instanceof JarvisClientError && error.code === 'timeout'); release(response(done)); await pause(0); assert.equal(committed, false); assert.deepEqual(events, []); }
    finally { budget.dispose(); }
  });
  await check('background timer suspension is checked by elapsed time before a late commit', async () => {
    const parent = new AbortController(), now = Date.now, start = now(), budget = jarvisClientDeadline(parent.signal, 1000); let committed = false;
    try { Date.now = () => start + 1001; assert.throws(() => { budget.check(); committed = true; }, error => error instanceof JarvisClientError && error.code === 'timeout'); assert.equal(committed, false); }
    finally { Date.now = now; budget.dispose(); }
  });
  await check('pre-cancelled and actively cancelled turns preserve user-stop semantics and consume late rejections', async () => {
    for (const before of [true, false]) {
      const parent = new AbortController(); if (before) parent.abort(); const budget = jarvisClientDeadline(parent.signal, 1000);
      const work = budget.run(new Promise<never>((_, reject) => setTimeout(() => reject(new Error('late transport failure')), 20))); if (!before) parent.abort();
      try { await assert.rejects(bounded(work), error => error instanceof DOMException && error.name === 'AbortError'); } finally { budget.dispose(); }
      assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
    }
    await pause(25);
  });
  await check('the client deadline grants only a short grace beyond the server budget', () => { assert.equal(JARVIS_CLIENT_DEADLINE_MS, 285000); });
  await check('mobile connectivity and missing server configuration produce actionable nontechnical errors', async () => {
    for (const text of ['Failed to fetch', 'Load failed', 'Network request failed']) assert.match(jarvisClientErrorMessage(new TypeError(text)), /Reconnect and try again/);
    assert.match(jarvisClientErrorMessage(new Error('The selected option is stale.')), /selected option is stale/);
    await assert.rejects(readJarvisStream(new Response(JSON.stringify({ code: 'not_configured', error: 'Configure OPENAI_API_KEY' }), { status: 503 }), () => {}, new AbortController().signal), error => error instanceof Error && /unavailable on the server/.test(error.message) && !error.message.includes('OPENAI_API_KEY'));
    await assert.rejects(readJarvisStream(response('<html>Offline portal</html>'), () => {}, new AbortController().signal), /unreadable Jarvis response/);
  });
  console.log(`\n${passed} Jarvis client recovery checks passed.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
