/** Offline admission tests. Optional REDIS_TEST_CLI exercises the actual Lua on a local test Redis. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createScanFinishAdmission, ScanFinishAdmissionError, withScanFinishAdmission, SCAN_FINISH_ADMIT_LUA } from '../src/lib/ai/scan-finish-admission';

let passed = 0;
const check = async (name: string, run: () => void | Promise<void>) => { await run(); console.log(`PASS ${name}`); passed++; };
const request = (headers: Record<string, string> = {}, signal?: AbortSignal, url = 'http://localhost:3000/api/native/finishes') => new Request(url, { method: 'POST', headers, signal });
const hosted = { NODE_ENV: 'production', VERCEL: '1', UPSTASH_REDIS_REST_URL: 'https://redis.example.test/', UPSTASH_REDIS_REST_TOKEN: 'synthetic-server-test-token', SCAN_FINISH_ADMISSION_NAMESPACE: 'test-scan-finishes' };
const response = (result: unknown) => Response.json({ result });
const expectStatus = (status: number) => (error: unknown) => error instanceof ScanFinishAdmissionError && error.status === status;

await check('hosted and production requests fail closed with no paid work and no network when Redis is missing', async () => {
  for (const env of [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { NODE_ENV: 'development' }]) {
    let calls = 0;
    const admit = createScanFinishAdmission({ env: () => env, fetch: async () => { calls++; throw Error('must not fetch'); } });
    await assert.rejects(withScanFinishAdmission(request({}, undefined, 'https://public.example/api/native/finishes'), async () => { calls++; }, admit), expectStatus(503));
    assert.equal(calls, 0);
  }
});
await check('partial, unsafe and malformed server configuration never calls the provider', async () => {
  for (const changes of [{ UPSTASH_REDIS_REST_TOKEN: '' }, { UPSTASH_REDIS_REST_URL: '' }, { UPSTASH_REDIS_REST_URL: 'http://redis.example.test/' }, { UPSTASH_REDIS_REST_URL: 'https://secret@redis.example.test/' }, { UPSTASH_REDIS_REST_URL: 'https://redis.example.test/?token=secret' }, { SCAN_FINISH_ADMISSION_NAMESPACE: 'a}untrusted' }]) {
    const admit = createScanFinishAdmission({ env: () => ({ ...hosted, ...changes }), fetch: async () => { throw Error('must not fetch'); } });
    await assert.rejects(admit(request()), expectStatus(503));
  }
});
await check('local concurrency is bounded and successful release is idempotent', async () => {
  const admit = createScanFinishAdmission({ env: () => ({ NODE_ENV: 'development' }) });
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => admit(request({ 'x-forwarded-for': `192.0.2.${i}` }))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'fulfilled') { await result.value.release(); await result.value.release(); }
  await (await admit(request())).release();
});
await check('provider failures release concurrency but spend hourly allowance; the next hour resets it', async () => {
  let now = Date.UTC(2026, 0, 1, 0, 10), calls = 0;
  const admit = createScanFinishAdmission({ env: () => ({}), now: () => now });
  for (let i = 0; i < 6; i++) await assert.rejects(withScanFinishAdmission(request(), async () => { calls++; throw Error('synthetic provider failure'); }, admit), /synthetic provider/);
  await assert.rejects(withScanFinishAdmission(request(), async () => { calls++; }, admit), expectStatus(429));
  assert.equal(calls, 6);
  now += 3600_000; assert.equal(await withScanFinishAdmission(request(), async () => 'ok', admit), 'ok');
});
await check('client daily count spans hourly resets and resets the next UTC day', async () => {
  let now = Date.UTC(2026, 0, 1, 0, 10);
  const admit = createScanFinishAdmission({ env: () => ({}), now: () => now });
  for (let i = 0; i < 20; i++) { if (i && i % 5 === 0) now += 3600_000; await (await admit(request())).release(); }
  await assert.rejects(admit(request()), expectStatus(429));
  now += 86400_000; await (await admit(request())).release();
});
await check('a crashed local lease expires and an old release cannot clear its replacement', async () => {
  let now = Date.UTC(2026, 0, 1); const admit = createScanFinishAdmission({ env: () => ({}), now: () => now });
  const old = await admit(request()); now += 211_000;
  const fresh = await admit(request()); await old.release();
  await assert.rejects(admit(request()), expectStatus(429)); await fresh.release();
});
await check('Redis failures, oversized replies and malformed decisions fail closed without retries or private error details', async () => {
  for (const makeResponse of [() => { throw Error(hosted.UPSTASH_REDIS_REST_TOKEN); }, () => new Response('unavailable', { status: 503 }), () => response([1]), () => response([1, 1]), () => response([0, 0]), () => response([2, 0]), () => response(['1', 0]), () => response([0, -1]), () => response([0, 86401]), () => new Response('not json'), () => Response.json({ error: 'private configuration data', result: [1, 0] }), () => new Response(' '.repeat(1025))]) {
    let calls = 0;
    const admit = createScanFinishAdmission({ env: () => hosted, fetch: async () => { calls++; return makeResponse(); } });
    await assert.rejects(admit(request()), error => expectStatus(503)(error) && !(error as Error).message.includes(hosted.UPSTASH_REDIS_REST_TOKEN)); assert.equal(calls, 1);
  }
});
await check('denied Redis admission supplies retry timing and never starts paid work', async () => {
  let work = 0; const admit = createScanFinishAdmission({ env: () => hosted, fetch: async () => response([0, 45]) });
  await assert.rejects(withScanFinishAdmission(request(), async () => { work++; }, admit), error => expectStatus(429)(error) && (error as ScanFinishAdmissionError).retryAfter === 45); assert.equal(work, 0);
});
await check('REST uses atomic EVAL, private authorization, no cache, no redirects and a lease-specific finally release', async () => {
  const commands: (string | number)[][] = [];
  const admit = createScanFinishAdmission({ env: () => hosted, fetch: async (url, init) => {
    assert.equal(url, hosted.UPSTASH_REDIS_REST_URL); assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${hosted.UPSTASH_REDIS_REST_TOKEN}`);
    commands.push(JSON.parse(String(init?.body))); return response(commands.length === 1 ? [1, 0] : 1);
  } });
  await assert.rejects(withScanFinishAdmission(request({ 'x-vercel-forwarded-for': '192.0.2.1' }), async () => { throw Error('provider failed'); }, admit), /provider failed/);
  const [reserve, release] = commands; assert.equal(commands.length, 2); assert.equal(reserve[0], 'EVAL'); assert.equal(reserve[1], SCAN_FINISH_ADMIT_LUA); assert.equal(reserve[2], 5);
  assert.deepEqual(reserve.slice(9), [100, 20, 6, 3, 1, 210]);
  assert.equal(release[2], 2); assert.deepEqual(release.slice(3, 5), reserve.slice(6, 8)); assert.equal(release[5], reserve[8]);
  assert.ok(!JSON.stringify(commands).includes('192.0.2.1')); assert.ok(!JSON.stringify(commands).includes(hosted.UPSTASH_REDIS_REST_TOKEN));
});
await check('abort before admission does no network; abort during admission releases without paid work', async () => {
  const controller = new AbortController(); let requests = 0, work = 0;
  const admit = createScanFinishAdmission({ env: () => hosted, fetch: async () => { requests++; controller.abort(); return response(requests === 1 ? [1, 0] : 1); } });
  await assert.rejects(withScanFinishAdmission(request({}, controller.signal), async () => { work++; }, admit), expectStatus(503)); assert.equal(requests, 2); assert.equal(work, 0);
  await assert.rejects(admit(request({}, controller.signal)), expectStatus(503)); assert.equal(requests, 2);
});
await check('release failures cannot replace the successful result and the same lease is released only once', async () => {
  let calls = 0; const admit = createScanFinishAdmission({ env: () => hosted, fetch: async () => { calls++; if (calls > 1) throw Error('Redis offline'); return response([1, 0]); } });
  assert.equal(await withScanFinishAdmission(request(), async () => 'finished', admit), 'finished'); assert.equal(calls, 2); calls = 0;
  const lease = await admit(request()); await Promise.all([lease.release(), lease.release()]); assert.equal(calls, 2);
});
await check('untrusted forwarded headers and IPv6 spelling/address rotation cannot create fresh client buckets', async () => {
  async function key(env: Record<string, string>, headers: Record<string, string>) {
    let result = ''; const admit = createScanFinishAdmission({ env: () => env, fetch: async (_url, init) => { result = JSON.parse(String(init?.body))[4]; return response([1, 0]); } });
    await admit(request(headers)); return result;
  }
  assert.equal(await key({ ...hosted, VERCEL: '' }, { 'x-forwarded-for': '192.0.2.1' }), await key({ ...hosted, VERCEL: '' }, { 'x-vercel-forwarded-for': '192.0.2.2' }));
  assert.equal(await key(hosted, { 'x-vercel-forwarded-for': '2001:db8:abcd:1::1' }), await key(hosted, { 'x-vercel-forwarded-for': '2001:0DB8:ABCD:0001:0000:0000:0000:ffff' }));
  assert.notEqual(await key(hosted, { 'x-vercel-forwarded-for': '192.0.2.1' }), await key(hosted, { 'x-vercel-forwarded-for': '192.0.2.2' }));
});

if (process.env.REDIS_TEST_CLI) {
  const cli = process.env.REDIS_TEST_CLI, socket = process.env.REDIS_TEST_SOCKET;
  assert.ok(socket, 'REDIS_TEST_SOCKET must explicitly identify an isolated local Redis');
  const namespace = `test-${Date.now()}`, base = { ...hosted, SCAN_FINISH_ADMISSION_NAMESPACE: namespace };
  const fetchRedis: typeof fetch = async (_url, init) => {
    const command: (string | number)[] = JSON.parse(String(init?.body));
    const { stdout } = await promisify(execFile)(cli, ['-s', socket, '--json', ...command.map(String)], { encoding: 'utf8' });
    return response(JSON.parse(stdout));
  };
  await check('real Redis EVAL shares atomic global concurrency across independent admission instances', async () => {
    const leases = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => createScanFinishAdmission({ env: () => base, fetch: fetchRedis })(request({ 'x-vercel-forwarded-for': `192.0.2.${i + 1}` }))));
    assert.equal(leases.filter(x => x.status === 'fulfilled').length, 3);
    for (const lease of leases) if (lease.status === 'fulfilled') await lease.value.release();
  });
  await check('real Redis EVAL enforces shared hourly budget and global 100/day under rotating clients', async () => {
    const singleEnv = { ...base, SCAN_FINISH_ADMISSION_NAMESPACE: `${namespace}-hour` };
    for (let i = 0; i < 6; i++) await (await createScanFinishAdmission({ env: () => singleEnv, fetch: fetchRedis })(request({ 'x-vercel-forwarded-for': '192.0.2.1' }))).release();
    await assert.rejects(createScanFinishAdmission({ env: () => singleEnv, fetch: fetchRedis })(request({ 'x-vercel-forwarded-for': '192.0.2.1' })), expectStatus(429));
    const globalEnv = { ...base, SCAN_FINISH_ADMISSION_NAMESPACE: `${namespace}-daily` };
    for (let i = 0; i < 100; i++) await (await createScanFinishAdmission({ env: () => globalEnv, fetch: fetchRedis })(request({ 'x-vercel-forwarded-for': `198.51.100.${i + 1}` }))).release();
    await assert.rejects(createScanFinishAdmission({ env: () => globalEnv, fetch: fetchRedis })(request({ 'x-vercel-forwarded-for': '198.51.100.200' })), expectStatus(429));
  });
} else console.log('SKIP actual Redis Lua integration (set REDIS_TEST_CLI and REDIS_TEST_SOCKET to an isolated local Redis).');
console.log(`${passed} scan finish admission checks passed`);
