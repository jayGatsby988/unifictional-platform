/**
 * OpenAI adapter — gpt-image-2 image edits (photoreal renders) and the shared
 * client used by the vision analyzer.
 *
 * Verified (Sept 2026): POST /v1/images/edits multipart, model=gpt-image-2,
 * image[] file, prompt, size 1024x1024|1536x1024|1024x1536, quality
 * low|medium|high. gpt-image-2 rejects `input_fidelity` (400) — never send it.
 * Result arrives as data[0].b64_json (~45 s at medium/1024).
 */
import OpenAI, { toFile } from 'openai';
import { fetchBytes } from '@/lib/storage/blob';
import { extForMime } from '@/lib/storage/image-meta';
import { serverLog } from '@/lib/ai/log';
import { ProviderError, notConfigured, type RenderProvider, type RenderQuality, type RenderRequest, type RenderResult } from './types';

const ID = 'openai';

export const isOpenAIConfigured = () => Boolean(process.env.OPENAI_API_KEY);
export const openaiImageModel = () => process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
export const openaiVisionModel = () => process.env.OPENAI_VISION_MODEL ?? 'gpt-5.4';

let client: OpenAI | null = null;
let clientKey: string | undefined;

/** Lazily constructed singleton (re-created if the key changes between invocations). */
export function openaiClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw notConfigured(ID, 'OpenAI');
  if (!client || clientKey !== key) {
    client = new OpenAI({ apiKey: key, maxRetries: 1 });
    clientKey = key;
  }
  return client;
}

const EDITABLE: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function defaultQuality(): RenderQuality {
  const q = process.env.OPENAI_IMAGE_QUALITY;
  return q === 'low' || q === 'medium' || q === 'high' ? q : 'medium';
}

function mapError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const status = (err as { status?: number }).status;
  const message = (err as Error).message ?? 'OpenAI request failed';
  if (status === 401) return new ProviderError(ID, 'OpenAI rejected the API key', { code: 'unauthorized', status: 502, retryable: false, cause: err });
  if (status === 400) return new ProviderError(ID, `OpenAI rejected the edit request: ${message}`, { code: 'bad_request', status: 502, retryable: false, cause: err });
  if (status === 429 && /insufficient_quota|credit_balance|no credits|billing/i.test(message)) return new ProviderError(ID, 'The OpenAI account has no credits left — add credits at platform.openai.com/settings/organization/billing.', { code: 'no_credits', status: 402, retryable: false, cause: err });
  if (status === 429) return new ProviderError(ID, 'OpenAI rate limit reached', { code: 'rate_limited', status: 502, retryable: true, cause: err });
  if ((err as Error).name === 'AbortError' || /timed? ?out/i.test(message)) return new ProviderError(ID, 'OpenAI image edit timed out', { code: 'timeout', status: 504, retryable: true, cause: err });
  return new ProviderError(ID, `OpenAI: ${message}`, { status: 502, retryable: true, cause: err });
}

export const openaiRenderProvider: RenderProvider = {
  id: 'openai',
  label: 'OpenAI gpt-image-2',
  isConfigured: isOpenAIConfigured,
  async render(req: RenderRequest): Promise<RenderResult> {
    const started = Date.now();
    const api = openaiClient();
    const model = openaiImageModel();
    req.onProgress?.({ progress: 0.05, message: 'Loading source image' });
    const src = req.sourceBytes ?? (await fetchBytes(req.sourceUrl));
    const ext = EDITABLE[src.contentType];
    if (!ext) {
      throw new ProviderError(ID, `gpt-image edits accept PNG, JPEG or WebP sources; got ${src.contentType}${extForMime(src.contentType) === 'heic' ? ' — re-export the photo as JPEG' : ''}`, { code: 'unsupported_source', status: 415, retryable: false });
    }
    const file = await toFile(src.buffer, `source.${ext}`, { type: src.contentType });
    req.onProgress?.({ progress: 0.15, message: `Rendering with ${model} (${req.quality ?? defaultQuality()} quality)` });
    try {
      const res = await api.images.edit(
        { model, image: [file], prompt: req.prompt, size: req.size, quality: req.quality ?? defaultQuality(), n: 1 },
        { signal: req.signal, timeout: 240_000 },
      );
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError(ID, 'OpenAI returned no image data', { code: 'empty_response', retryable: true });
      const elapsedMs = Date.now() - started;
      serverLog('render.openai', 'image edit complete', { model, size: req.size, elapsedMs, bytes: b64.length });
      return { imageBuffer: Buffer.from(b64, 'base64'), mime: 'image/png', elapsedMs, model };
    } catch (err) {
      throw mapError(err);
    }
  },
};
