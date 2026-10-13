/**
 * NDJSON streaming response with keep-alives. Each event is one JSON line.
 * The first chunk is flushed as soon as the producer emits it, so the client
 * sees progress well before a long model call finishes.
 */
import { errorMessage } from '@/lib/ai/log';

export interface NdjsonEvent {
  phase: string;
  message: string;
  progress: number;
  [key: string]: unknown;
}

export interface NdjsonOptions {
  signal?: AbortSignal;
  keepAliveMs?: number;
  /** maps a thrown error to the terminal event */
  onError?: (err: unknown) => NdjsonEvent;
}

export function ndjsonResponse(run: (emit: (e: NdjsonEvent) => void, signal: AbortSignal) => Promise<void>, opts: NdjsonOptions = {}): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let last: NdjsonEvent | null = null;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  const cleanup = () => {
    clearInterval(timer);
    opts.signal?.removeEventListener('abort', onRequestAbort);
  };
  const finish = () => {
    cleanup();
    if (closed) return;
    closed = true;
    try { output?.close(); } catch { /* consumer already cancelled */ }
  };
  const cancel = (reason?: unknown) => {
    finish();
    abort.abort(reason);
  };
  const onRequestAbort = () => cancel(opts.signal?.reason);
  opts.signal?.addEventListener('abort', onRequestAbort, { once: true });
  if (opts.signal?.aborted) onRequestAbort();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      if (closed) { controller.close(); return; }
      const write = (e: NdjsonEvent) => {
        if (closed) return;
        last = e;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          cancel();
        }
      };
      timer = setInterval(() => {
        if (closed || !last) return;
        const { spec: _spec, ...rest } = last as NdjsonEvent & { spec?: unknown };
        void _spec;
        write({ ...rest, heartbeat: true, at: Date.now() });
      }, opts.keepAliveMs ?? 5000);
      // A producer may throw before returning its Promise. Keep that failure
      // on the same cleanup path as async rejections and transport aborts.
      Promise.resolve().then(() => { if (!closed) return run(write, abort.signal); })
        .catch((err: unknown) => {
          if (closed) return;
          try {
            write(opts.onError?.(err) ?? { phase: 'error', message: errorMessage(err), progress: 0 });
          } catch {
            write({ phase: 'error', message: errorMessage(err), progress: 0 });
          }
        })
        .finally(finish);
    },
    cancel(reason) {
      cancel(reason);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
