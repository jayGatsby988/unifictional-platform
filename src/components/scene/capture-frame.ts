/** Wait for a composed frame without retaining a canceled or backgrounded
 * capture indefinitely. Encoders can finish late; only the active result wins. */
export function captureRenderedFrame<T>(encode: () => Promise<T | null>, available: () => boolean, options: {
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<T | null> {
  const { signal, timeoutMs = 15000 } = options;
  return new Promise(resolve => {
    let settled = false, first: number | undefined, second: number | undefined;
    const finish = (result: T | null) => {
      if (settled) return;
      settled = true;
      if (first !== undefined) cancelAnimationFrame(first);
      if (second !== undefined) cancelAnimationFrame(second);
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => finish(null);
    const timer = setTimeout(abort, Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : 15000));
    const current = () => {
      if (settled || signal?.aborted) return false;
      try { return available(); } catch { return false; }
    };
    if (!current()) { finish(null); return; }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      first = requestAnimationFrame(() => {
        first = undefined;
        if (!current()) { finish(null); return; }
        try {
          second = requestAnimationFrame(() => {
            second = undefined;
            if (!current()) { finish(null); return; }
            void Promise.resolve().then(() => current() ? encode() : null)
              .then(result => finish(current() ? result : null), () => finish(null));
          });
        } catch { finish(null); }
      });
    } catch { finish(null); }
  });
}
