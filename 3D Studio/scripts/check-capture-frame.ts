import assert from 'node:assert/strict';
import { captureRenderedFrame } from '../src/components/scene/capture-frame';
import { useScanView, waitForScanModelFrame } from '../src/components/scene/scan-view-store';

const originalRequest = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
const frames = new Map<number, FrameRequestCallback>(); let sequence = 0, checks = 0;
globalThis.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
globalThis.cancelAnimationFrame = id => { frames.delete(id); };
function frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); }
async function check(name: string, run: () => Promise<void>) { await run(); assert.equal(frames.size, 0); console.log(`PASS ${++checks}: ${name}`); }

async function main() {
  await check('a composed capture waits two frames and encodes once', async () => {
    let encoded = 0; const pending = captureRenderedFrame(async () => { encoded++; return 'image'; }, () => true);
    assert.equal(encoded, 0); frame(); assert.equal(encoded, 0); frame(); assert.equal(await pending, 'image'); assert.equal(encoded, 1);
  });
  await check('pre-canceled work never changes the view or schedules a frame', async () => {
    const signal = AbortSignal.abort(); let encoded = false;
    assert.equal(await captureRenderedFrame(async () => { encoded = true; return 'image'; }, () => true, { signal }), null);
    useScanView.getState().setMode('source'); await assert.rejects(waitForScanModelFrame(100, signal), { name: 'AbortError' });
    assert.equal(useScanView.getState().mode, 'source'); assert.equal(encoded, false);
  });
  for (const afterFrame of [false, true]) await check(`cancel ${afterFrame ? 'between' : 'before'} frames releases queued work`, async () => {
    const controller = new AbortController(); let encoded = 0;
    const pending = captureRenderedFrame(async () => { encoded++; return 'image'; }, () => true, { signal: controller.signal });
    if (afterFrame) frame(); controller.abort(); assert.equal(await pending, null); assert.equal(encoded, 0);
  });
  await check('a late encoder reply cannot publish after cancellation', async () => {
    const controller = new AbortController(); let finish: (value: string) => void = () => {};
    const pending = captureRenderedFrame(() => new Promise<string>(resolve => { finish = resolve; }), () => true, { signal: controller.signal });
    frame(); frame(); await Promise.resolve(); controller.abort(); assert.equal(await pending, null); finish('obsolete image'); await Promise.resolve();
  });
  await check('an inactive background frame times out and releases its callback', async () => {
    assert.equal(await captureRenderedFrame(async () => 'image', () => true, { timeoutMs: 5 }), null);
  });
  await check('context loss while encoding cannot return the old image', async () => {
    let alive = true;
    const pending = captureRenderedFrame(async () => { alive = false; return 'old image'; }, () => alive);
    frame(); frame(); assert.equal(await pending, null);
  });
  await check('an encoder failure resolves without leaving a stuck operation', async () => {
    const pending = captureRenderedFrame(async () => { throw new Error('Canvas was detached'); }, () => true);
    frame(); frame(); assert.equal(await pending, null);
  });
  await check('canceling model readiness unsubscribes without waiting for timeout', async () => {
    useScanView.getState().setReady(null); const controller = new AbortController();
    const pending = waitForScanModelFrame(5000, controller.signal); controller.abort();
    await assert.rejects(pending, { name: 'AbortError' }); useScanView.getState().setReady('model');
  });
  await check('a ready model resolves before capture and tolerates a later abort', async () => {
    useScanView.getState().setReady(null); const controller = new AbortController();
    const pending = waitForScanModelFrame(5000, controller.signal); useScanView.getState().setReady('model');
    await pending; controller.abort();
  });
  console.log(`${checks} capture lifecycle checks passed.`);
}
void main().finally(() => { globalThis.requestAnimationFrame = originalRequest; globalThis.cancelAnimationFrame = originalCancel; });
