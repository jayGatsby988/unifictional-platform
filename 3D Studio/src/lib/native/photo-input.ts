import { imageDimensions, sniffImageMime } from '@/lib/storage/image-meta';

export const MAX_PHOTO_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_DECODE_PIXELS = 16_000_000;

/** Check compressed headers before asking the browser to allocate a decoded image. */
export function validatePhotoInputBytes(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_PHOTO_FILE_BYTES) throw new Error('Choose photos smaller than 20 MB.');
  const mime = sniffImageMime(bytes), dimensions = imageDimensions(bytes);
  if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !dimensions) {
    throw new Error('Choose a JPEG, PNG or WebP photo. Saved detail photos in the iPhone app are converted automatically.');
  }
  const { width, height } = dimensions;
  if (Math.min(width, height) < 64 || width * height > MAX_PHOTO_DECODE_PIXELS || Math.max(width, height) > 8192) {
    throw new Error('Use a photo between 64 pixels and 16 megapixels, or choose Saved detail photos for automatic resizing.');
  }
  return { ...dimensions, mime };
}

export async function imageForAnalysis(input: Blob | string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (typeof input === 'string' && !/^data:image\/(jpeg|png|webp);base64,/.test(input)) throw new Error('Choose a local photo.');
  const blob = typeof input === 'string' ? await (await fetch(input, { signal })).blob() : input;
  if (blob.size > MAX_PHOTO_FILE_BYTES) throw new Error('Choose photos smaller than 20 MB.');
  validatePhotoInputBytes(new Uint8Array(await blob.arrayBuffer()));
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob), img = new Image();
  const canvas = document.createElement('canvas');
  try {
    img.src = url; await img.decode(); signal?.throwIfAborted();
    // Also validate the decoder's dimensions; headers and orientation can disagree.
    if (img.naturalWidth * img.naturalHeight > MAX_PHOTO_DECODE_PIXELS) throw new Error('Choose a smaller photo.');
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('The photo could not be prepared.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let encoded = canvas.toDataURL('image/jpeg', .9);
    if (encoded.length > 1_300_000) encoded = canvas.toDataURL('image/jpeg', .7);
    if (encoded.length > 1_300_000) throw new Error('This photo is too large. Choose a smaller image.');
    return encoded;
  } finally { canvas.width = canvas.height = 0; img.src = ''; URL.revokeObjectURL(url); }
}
