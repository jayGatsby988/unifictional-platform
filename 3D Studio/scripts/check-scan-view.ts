import assert from 'node:assert/strict';
import { useScanView, waitForScanModelFrame } from '../src/components/scene/scan-view-store';

async function main() {
  useScanView.setState({ mode: 'model', ready: 'model', focus: 'fixtures' });
  useScanView.getState().setMode('model');
  assert.equal(useScanView.getState().ready, 'model', 'reselecting the current view must not strand readiness');
  await waitForScanModelFrame(50);
  useScanView.getState().setMode('source');
  assert.equal(useScanView.getState().ready, null);
  useScanView.getState().setReady('source');
  let finished = false;
  const job = waitForScanModelFrame(100).then(() => { finished = true; });
  assert.equal(useScanView.getState().mode, 'model');
  await Promise.resolve();
  assert.equal(finished, false, 'render must wait for an actual model frame');
  useScanView.getState().setReady('source');
  await Promise.resolve();
  assert.equal(finished, false, 'a stale source frame cannot satisfy model capture');
  useScanView.getState().setReady('model');
  await job;
  assert.equal(finished, true);
  useScanView.getState().setFocus('room');
  assert.equal(useScanView.getState().ready, null, 'camera refitting needs fresh frames');
  await assert.rejects(waitForScanModelFrame(5), /still loading/, 'stalled scenes cannot create wireframe render jobs');
  useScanView.getState().setReady('model');
  await waitForScanModelFrame(50);
  console.log('PASS scan view switching, fresh-frame capture, stale-frame rejection, timeout and recovery');
}
void main();
