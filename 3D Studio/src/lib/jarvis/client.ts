import type { JarvisEvent, JarvisTurnResult } from './types';

/** Server work is limited to 270 seconds; transport gets a short final grace.
 * The browser clock also covers a connection that never reaches the server. */
export const JARVIS_CLIENT_DEADLINE_MS = 285_000;
export class JarvisClientError extends Error {
  constructor(public readonly code: 'timeout' | 'connection' | 'response', message: string) { super(message); this.name = 'JarvisClientError'; }
}

export function jarvisClientErrorMessage(error: unknown): string {
  if (error instanceof TypeError && /failed to fetch|load failed|network(?:error| request failed)|fetch failed/i.test(error.message)) return 'The connection to Jarvis was interrupted. Your saved design is intact. Reconnect and try again.';
  return error instanceof Error && error.message ? error.message : 'Jarvis could not complete the request. Your saved design is intact; please try again.';
}

export function jarvisClientDeadline(parent: AbortSignal, durationMs = JARVIS_CLIENT_DEADLINE_MS) {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent.reason);
  const timeout = () => controller.abort(new JarvisClientError('timeout', 'Jarvis took too long to finish over this connection. Your saved design is intact. Try again.'));
  const duration = Math.max(0, Math.min(durationMs, JARVIS_CLIENT_DEADLINE_MS)), deadlineAt = Date.now() + duration;
  const check = () => { if (Date.now() >= deadlineAt && !controller.signal.aborted) timeout(); controller.signal.throwIfAborted(); };
  const timer = setTimeout(timeout, duration);
  parent.addEventListener('abort', cancel, { once: true });
  if (parent.aborted) cancel();
  return {
    signal: controller.signal, check,
    async run<T>(work: PromiseLike<T>): Promise<T> {
      const pending = Promise.resolve(work), signal = controller.signal;
      if (signal.aborted) { void pending.catch(() => {}); throw signal.reason; }
      let abort!: () => void;
      const stopped = new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); });
      try { const result = await Promise.race([pending, stopped]); check(); return result; }
      finally { signal.removeEventListener('abort', abort); }
    },
    dispose() { clearTimeout(timer); parent.removeEventListener('abort', cancel); },
  };
}

export async function jarvisResponseError(response: Response): Promise<Error> {
  try {
    const body = await response.json();
    if (body.code === 'not_configured') return new JarvisClientError('connection', 'Jarvis is unavailable on the server right now. Your saved design is intact; try again later.');
    return new Error(typeof body.error === 'string' ? body.error : `Jarvis could not complete the request (${response.status}). Please try again.`);
  } catch { return new Error(`Jarvis could not complete the request (${response.status}). Please try again.`); }
}

/** An incomplete, failed, cancelled or oversized stream never returns a commit. */
export async function readJarvisStream(response: Response, onEvent: (event: JarvisEvent) => void, signal: AbortSignal): Promise<JarvisTurnResult> {
  if (!response.ok) throw await jarvisResponseError(response);
  if (!response.body) throw new JarvisClientError('response', 'Jarvis returned an empty response. Your saved design is intact; try again.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', received = 0, result: JarvisTurnResult | null = null;
  const line = (raw: string) => {
    if (!raw.trim()) return;
    signal.throwIfAborted();
    let event: JarvisEvent;
    try { event = JSON.parse(raw) as JarvisEvent; }
    catch { throw new JarvisClientError('response', 'The connection returned an unreadable Jarvis response. Your saved design is intact; try again.'); }
    if (!event || typeof event !== 'object') throw new JarvisClientError('response', 'Jarvis returned an unreadable response. Your saved design is intact; try again.');
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'done') result = event.result;
    onEvent(event);
  };
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      received += value.byteLength;
      if (received > 4 * 1024 * 1024) throw new JarvisClientError('response', 'Jarvis returned too much data. No changes were applied.');
      buffer += decoder.decode(value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf('\n')) >= 0) { const next = buffer.slice(0, split); buffer = buffer.slice(split + 1); line(next); }
    }
    buffer += decoder.decode(); line(buffer); signal.throwIfAborted();
    if (!result) throw new JarvisClientError('response', 'The connection ended before Jarvis finished. No changes were applied.');
    return result;
  } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
