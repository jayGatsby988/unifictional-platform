/**
 * Google Gemini image adapter ("Nano Banana Pro" class models) via the REST
 * generateContent endpoint. Optional — active only when GOOGLE_API_KEY is set.
 *
 * Request:  POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *           header `x-goog-api-key`, body { contents:[{ parts:[{text},{inline_data:{mime_type,data}}] }], generationConfig:{ responseModalities:['IMAGE'] } }
 * Response: candidates[0].content.parts[].inlineData.data (base64). The shape is
 * handled defensively (inlineData | inline_data); anything else throws a
 * descriptive ProviderError so the router can fall back to OpenAI.
 */
import { fetchBytes } from '@/lib/storage/blob';
import { serverLog } from '@/lib/ai/log';
import { ProviderError, notConfigured, providerFetch, providerHttpError, type RenderMime, type RenderProvider, type RenderRequest, type RenderResult } from './types';

const ID = 'google';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const isGoogleConfigured = () => Boolean(process.env.GOOGLE_API_KEY);
export const googleImageModel = () => process.env.GOOGLE_IMAGE_MODEL ?? 'gemini-3-pro-image';

const SUPPORTED_INPUT = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string; safetyRatings?: unknown }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

function aspectHint(size: RenderRequest['size']): string {
  if (size === '1536x1024') return '3:2 landscape';
  if (size === '1024x1536') return '2:3 portrait';
  return '1:1 square';
}

export const googleRenderProvider: RenderProvider = {
  id: 'google',
  label: 'Google Gemini image',
  isConfigured: isGoogleConfigured,
  async render(req: RenderRequest): Promise<RenderResult> {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw notConfigured(ID, 'Google');
    const model = googleImageModel();
    const started = Date.now();
    req.onProgress?.({ progress: 0.05, message: 'Loading source image' });
    const src = req.sourceBytes ?? (await fetchBytes(req.sourceUrl));
    if (!SUPPORTED_INPUT.has(src.contentType)) {
      throw new ProviderError(ID, `Gemini image edit does not accept ${src.contentType}`, { code: 'unsupported_source', status: 415, retryable: false });
    }
    req.onProgress?.({ progress: 0.15, message: `Rendering with ${model}` });

    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: `${req.prompt}\n\nOutput a single edited image at the same framing as the input (${aspectHint(req.size)}).` },
          { inline_data: { mime_type: src.contentType, data: src.buffer.toString('base64') } },
        ],
      }],
      generationConfig: { responseModalities: ['IMAGE'] },
    };

    // The key travels in a header, never the query string: URLs end up in logs,
    // proxies and error reports.
    const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
    const res = await providerFetch(ID, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    }, 180_000, req.signal);
    if (!res.ok) throw await providerHttpError(ID, res, 'Gemini generateContent');

    let json: GeminiResponse;
    try {
      json = (await res.json()) as GeminiResponse;
    } catch {
      throw new ProviderError(ID, 'Gemini returned a non-JSON response', { code: 'bad_response', retryable: true });
    }
    if (json.error?.message) throw new ProviderError(ID, `Gemini error: ${json.error.message}`, { code: 'bad_response', retryable: true });
    if (json.promptFeedback?.blockReason) {
      throw new ProviderError(ID, `Gemini blocked the request (${json.promptFeedback.blockReason})`, { code: 'blocked', retryable: false });
    }
    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    if (!imagePart) {
      const reason = candidate?.finishReason ? ` (finishReason=${candidate.finishReason})` : '';
      const text = parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200);
      throw new ProviderError(ID, `Gemini response contained no image${reason}${text ? `: ${text}` : ''}`, { code: 'empty_response', retryable: true });
    }
    const data = imagePart.inlineData?.data ?? imagePart.inline_data?.data ?? '';
    const mimeRaw = (imagePart.inlineData?.mimeType ?? imagePart.inline_data?.mime_type ?? 'image/png').toLowerCase();
    const mime: RenderMime = mimeRaw === 'image/jpeg' ? 'image/jpeg' : mimeRaw === 'image/webp' ? 'image/webp' : 'image/png';
    const elapsedMs = Date.now() - started;
    serverLog('render.google', 'generateContent complete', { model, elapsedMs, bytes: data.length });
    return { imageBuffer: Buffer.from(data, 'base64'), mime, elapsedMs, model };
  },
};
