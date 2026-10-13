import { isOpenAIConfigured } from '@/lib/ai/providers/openai';
import { JarvisRequestZ } from '@/lib/jarvis/schemas';
import { JarvisError, jarvisAbortable, jarvisDeadline, runJarvis } from '@/lib/jarvis/runner';
import type { JarvisEvent } from '@/lib/jarvis/types';
import type { Project } from '@/lib/spec/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function bodyJson(req: Request, signal: AbortSignal): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new JarvisError('payload_too_large', 'Jarvis accepts at most 2 MB per request.', 413);
  if (!req.body) throw new JarvisError('bad_request', 'A JSON request body is required.', 400);
  const reader = req.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await jarvisAbortable(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new JarvisError('payload_too_large', 'Jarvis accepts at most 2 MB per request.', 413);
      chunks.push(chunk.value);
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new JarvisError('bad_request', 'Body must be valid UTF-8 JSON.', 400); }
  } finally {
    // Do not await an uncooperative upload producer's cancel callback.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function publicError(error: unknown): JarvisError {
  return error instanceof JarvisError ? error : new JarvisError('internal_error', 'Jarvis could not complete this turn. No changes were applied.', 500);
}

export async function POST(req: Request): Promise<Response> {
  const cancelled = new AbortController();
  const onAbort = () => cancelled.abort(req.signal.reason);
  req.signal.addEventListener('abort', onAbort, { once: true });
  if (req.signal.aborted) onAbort();
  const budget = jarvisDeadline(cancelled.signal);
  const cleanup = () => { budget.dispose(); req.signal.removeEventListener('abort', onAbort); };
  try {
    budget.check();
    const raw = await bodyJson(req, budget.signal);
    const parsed = JarvisRequestZ.safeParse(raw);
    if (!parsed.success) {
      const message = parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
      throw new JarvisError('validation_error', message, 400);
    }
    if (!isOpenAIConfigured()) throw new JarvisError('not_configured', 'Configure OPENAI_API_KEY on the server to use Jarvis.', 503);
    budget.check();
    const encoder = new TextEncoder();
    let closed = false;
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const finish = () => {
      clearInterval(heartbeat); cleanup();
      if (closed) return;
      closed = true;
      try { output?.close(); } catch { /* consumer already cancelled */ }
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller;
        const emit = (event: JarvisEvent) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
          catch { cancelled.abort(); finish(); }
        };
        heartbeat = setInterval(() => emit({ type: 'status', message: 'Jarvis is still working.' }), 5_000);
        Promise.resolve().then(async () => {
          // Zod may insert schema defaults. The concurrency token must refer to
          // the original browser snapshot, before workspace normalization.
          const project = (raw as { project: Project }).project;
          const result = await runJarvis({ project, message: parsed.data.message, signal: budget.signal, deadlineAt: budget.deadlineAt, onEvent: emit });
          budget.check();
          emit({ type: 'done', result });
        }).catch((error: unknown) => {
          const e = publicError(error);
          emit({ type: 'error', error: e.message, code: e.code });
        }).finally(finish);
      },
      cancel(reason) { cancelled.abort(reason); finish(); },
    });
    return new Response(stream, { headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-cache, no-transform',
      'x-accel-buffering': 'no',
    } });
  } catch (error) {
    cleanup();
    const e = publicError(error);
    return Response.json({ error: e.message, code: e.code }, { status: e.status, headers: { 'cache-control': 'no-store' } });
  }
}
