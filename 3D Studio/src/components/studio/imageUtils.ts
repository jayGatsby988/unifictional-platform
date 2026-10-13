'use client';
/**
 * Client-side image preparation: downscale to max 2048px JPEG before upload.
 * HEIC/HEIF decode only works where the browser supports it (Safari); when
 * decoding fails we upload the original bytes and let the server handle it.
 */

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp';
export const MAX_UPLOAD_PX = 2048;

export function isHeic(file: File) {
  const name = file.name.toLowerCase();
  return file.type === 'image/heic' || file.type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif');
}

export function isAcceptedImage(file: File) {
  if (ACCEPTED_IMAGE_TYPES.includes(file.type)) return true;
  if (isHeic(file)) return true;
  const name = file.name.toLowerCase();
  return /\.(jpe?g|png|webp)$/.test(name);
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      // fall through to <img> decoding
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    img.src = url;
  });
}

/**
 * Returns a JPEG File no larger than `maxPx` on its longest edge. Falls back
 * to the original file if the browser cannot decode it (e.g. HEIC on Chrome).
 */
export async function prepareImageForUpload(file: File, maxPx = MAX_UPLOAD_PX, quality = 0.86): Promise<{ file: File; width?: number; height?: number; downscaled: boolean }> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    return { file, downscaled: false };
  }
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!sw || !sh) return { file, downscaled: false };
  const scale = Math.min(1, maxPx / Math.max(sw, sh));
  const alreadySmallJpeg = scale === 1 && file.type === 'image/jpeg' && file.size < 2.5 * 1024 * 1024;
  if (alreadySmallJpeg) {
    if ('close' in source) source.close();
    return { file, width: sw, height: sh, downscaled: false };
  }
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { file, width: sw, height: sh, downscaled: false };
  ctx.drawImage(source, 0, 0, w, h);
  if ('close' in source) source.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) return { file, width: sw, height: sh, downscaled: false };
  const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return { file: new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }), width: w, height: h, downscaled: true };
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
