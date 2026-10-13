import { create } from 'zustand';
import { z } from 'zod';

/** Match the native thumbnail derivative: canonical JPEG, <= 1 MiB and a
 * <= 2048-pixel frame. Inspect headers before an image element can allocate it. */
function boundedJPEG(value: string): boolean {
  if (value.length > 1_400_000 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const bytes = atob(value), byte = (index: number) => bytes.charCodeAt(index);
    if (bytes.length < 32 || bytes.length > 1024 * 1024 || btoa(bytes) !== value
      || byte(0) !== 0xff || byte(1) !== 0xd8 || byte(bytes.length - 2) !== 0xff || byte(bytes.length - 1) !== 0xd9) return false;
    let offset = 2, hasFrame = false;
    while (offset < bytes.length - 2) {
      if (byte(offset++) !== 0xff) return false;
      while (byte(offset) === 0xff) offset++;
      const marker = byte(offset++);
      if (marker === 0 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) return false;
      const length = byte(offset) * 256 + byte(offset + 1);
      if (!Number.isInteger(length) || length < 2 || offset + length > bytes.length - 2) return false;
      if (marker === 0xda) return hasFrame && length >= 6;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const height = byte(offset + 3) * 256 + byte(offset + 4), width = byte(offset + 5) * 256 + byte(offset + 6), channels = byte(offset + 7);
        if (hasFrame || byte(offset + 2) !== 8 || width < 1 || height < 1 || width > 2048 || height > 2048
          || ![1, 3, 4].includes(channels) || length !== 8 + 3 * channels) return false;
        hasFrame = true;
      }
      offset += length;
    }
    return false;
  } catch { return false; }
}

export const NativeDetailPhotoReplyZ = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/), token: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/), requestId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  photos: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/), mimeType: z.literal('image/jpeg'), data: z.string().max(1_400_000).refine(boundedJPEG, 'Invalid native JPEG thumbnail.') }).strict()).max(6),
  error: z.string().max(1000).optional(),
}).strict();
export type NativeDetailPhoto = { id: string; url: string };
export const useNativeDetailPhotos = create<{
  projectId: string | null; token: string | null; requestId: string | null; pending: boolean; photos: NativeDetailPhoto[]; error: string | null;
}>(() => ({ projectId: null, token: null, requestId: null, pending: false, photos: [], error: null }));

/** Session-only images never enter project JSON, sharing or automatic uploads. */
export function clearNativeDetailPhotos(projectId?: string) {
  if (projectId && useNativeDetailPhotos.getState().projectId !== projectId) return;
  useNativeDetailPhotos.setState({ projectId: null, token: null, requestId: null, pending: false, photos: [], error: null });
}
