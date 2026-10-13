/**
 * Minimal structured server logger. Every line is one JSON object so Vercel's
 * log drain can index it. Secrets are redacted defensively (API keys, `key=`
 * query params) so a provider error message can never leak credentials.
 */
type Fields = Record<string, unknown>;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [/([?&]key=)[^&\s"']+/gi, '$1***'],
  [/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1***'],
  [/(vercel_blob_rw_)[A-Za-z0-9_-]+/gi, '$1***'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Best-effort human message from any thrown value, redacted. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return redact(err.message || err.name);
  if (typeof err === 'string') return redact(err);
  try {
    return redact(JSON.stringify(err));
  } catch {
    return 'Unknown error';
  }
}

function emit(level: 'info' | 'warn' | 'error', scope: string, message: string, fields: Fields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope, message: redact(message), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function serverLog(scope: string, message: string, fields: Fields = {}) {
  emit('info', scope, message, fields);
}

export function serverWarn(scope: string, message: string, fields: Fields = {}) {
  emit('warn', scope, message, fields);
}

export function serverError(scope: string, message: string, err?: unknown, fields: Fields = {}) {
  const detail: Fields = {};
  if (err !== undefined) {
    detail.error = errorMessage(err);
    if (err instanceof Error && err.name && err.name !== 'Error') detail.errorName = err.name;
    const status = (err as { status?: unknown })?.status;
    if (typeof status === 'number') detail.status = status;
  }
  emit('error', scope, message, { ...detail, ...fields });
}

/** `const done = startTimer(); ... done()` → elapsed ms. */
export function startTimer(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}
