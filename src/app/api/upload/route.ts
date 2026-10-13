/**
 * /api/upload
 *  GET            → { mode:'client'|'server', maxBytes, accept } so the client picks a path
 *  POST (json)    → Vercel Blob client-upload handshake (handleUpload); needs BLOB_READ_WRITE_TOKEN
 *  POST (multipart) → server-side upload: fields projectId, kind?=photos|viewport, files[]
 *                     (local dev fallback → public/uploads; also works with Blob for small files)
 */
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { nanoid } from 'nanoid';
import { serverLog, serverWarn } from '@/lib/ai/log';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, clientUploadTokenOptions, isBlobConfigured, put, storageMode, uploadPathname } from '@/lib/storage/blob';
import { imageDimensions, mimeForPath, sniffImageMime } from '@/lib/storage/image-meta';
import { HttpError, assertId, guard, json, jsonError } from '../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_FILES = 12;
const VIEWPORT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function uploadConfig() {
  return { mode: isBlobConfigured() ? 'client' : 'server', maxBytes: MAX_UPLOAD_BYTES, accept: ALLOWED_IMAGE_TYPES, maxFiles: MAX_FILES };
}

export async function GET() {
  return guard('upload.config', async () => json(uploadConfig()));
}

export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return guard('upload.handshake', async () => {
      if (!isBlobConfigured()) {
        return jsonError(503, 'not_configured', 'Client uploads require BLOB_READ_WRITE_TOKEN. In local dev, POST multipart/form-data instead.');
      }
      const body = (await req.json()) as HandleUploadBody;
      try {
        const result = await handleUpload({
          request: req,
          body,
          onBeforeGenerateToken: async (pathname, clientPayload) => clientUploadTokenOptions(pathname, clientPayload),
          onUploadCompleted: async ({ blob, tokenPayload }) => {
            serverLog('upload', 'client upload completed', { pathname: blob.pathname, tokenPayload });
          },
        });
        return json(result);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        const message = (err as Error).message ?? 'Upload handshake failed';
        serverWarn('upload', 'handshake rejected', { error: message });
        return jsonError(400, 'upload_handshake_failed', message);
      }
    });
  }

  if (contentType.includes('multipart/form-data')) {
    return guard('upload.multipart', async () => {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw new HttpError(400, 'bad_request', 'Malformed multipart body');
      }
      const projectId = assertId(form.get('projectId'), 'projectId');
      const kind = form.get('kind') === 'viewport' ? 'viewport' : 'photos';
      const files = [...form.getAll('files'), ...form.getAll('file')].filter((v): v is File => typeof v === 'object' && v !== null && 'arrayBuffer' in v);
      if (!files.length) throw new HttpError(400, 'bad_request', 'No files in "files" field');
      if (files.length > MAX_FILES) throw new HttpError(400, 'bad_request', `At most ${MAX_FILES} files per request`);

      const photos: Array<{ url: string; width?: number; height?: number; contentType: string; size: number }> = [];
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'payload_too_large', `${file.name || 'file'} exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
        const buffer = Buffer.from(await file.arrayBuffer());
        const mime = sniffImageMime(buffer) ?? (file.type || mimeForPath(file.name || '') || '');
        const allowed = kind === 'viewport' ? VIEWPORT_TYPES.has(mime) : (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime);
        if (!allowed) throw new HttpError(415, 'unsupported_media_type', `${file.name || 'file'}: only JPEG, PNG, WebP${kind === 'photos' ? ' or HEIC' : ''} images are accepted`);
        const pathname = uploadPathname(kind, projectId, nanoid(12), mime);
        const stored = await put(pathname, buffer, mime, { cacheSeconds: 60 * 60 * 24 * 365 });
        const dims = imageDimensions(buffer);
        photos.push({ url: stored.url, width: dims?.width, height: dims?.height, contentType: mime, size: buffer.byteLength });
      }
      serverLog('upload', 'multipart upload stored', { projectId, kind, count: photos.length, storage: storageMode() });
      return json({ photos, storage: storageMode() }, { status: 201 });
    });
  }

  return jsonError(415, 'unsupported_media_type', 'Send application/json (Blob handshake) or multipart/form-data');
}
