/**
 * Dependency-free image header parsing: MIME sniffing + pixel dimensions for
 * JPEG (EXIF-orientation aware), PNG, WebP and GIF. HEIC is detected but its
 * dimensions are not parsed (the box structure is not worth a parser here).
 */

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/gif';

export interface ImageDims { width: number; height: number }

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic', 'image/gif': 'gif',
  'model/gltf-binary': 'glb', 'application/json': 'json',
};
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic', gif: 'image/gif',
  glb: 'model/gltf-binary', json: 'application/json', txt: 'text/plain',
};

export function extForMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  return MIME_TO_EXT[mime.toLowerCase().split(';')[0].trim()] ?? null;
}

export function mimeForExt(ext: string | null | undefined): string | null {
  if (!ext) return null;
  return EXT_TO_MIME[ext.toLowerCase().replace(/^\./, '')] ?? null;
}

export function mimeForPath(pathname: string): string | null {
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(pathname);
  return m ? mimeForExt(m[1]) : null;
}

function ascii(buf: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < Math.min(buf.length, start + len); i++) s += String.fromCharCode(buf[i]);
  return s;
}

/** Detects the image type from magic bytes. Returns null when unknown. */
export function sniffImageMime(buf: Uint8Array): ImageMime | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && ascii(buf, 1, 3) === 'PNG') return 'image/png';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(buf, 0, 3) === 'GIF') return 'image/gif';
  if (ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'avif'].includes(brand)) return 'image/heic';
  }
  return null;
}

function readU16(buf: Uint8Array, at: number, little: boolean): number {
  return little ? buf[at] | (buf[at + 1] << 8) : (buf[at] << 8) | buf[at + 1];
}
function readU32(buf: Uint8Array, at: number, little: boolean): number {
  return little
    ? (buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16) | (buf[at + 3] << 24)) >>> 0
    : ((buf[at] << 24) | (buf[at + 1] << 16) | (buf[at + 2] << 8) | buf[at + 3]) >>> 0;
}

/** EXIF orientation tag (1..8) from a JPEG's APP1 segment, or 1 when absent. */
function jpegOrientation(buf: Uint8Array, app1Start: number, app1Len: number): number {
  // app1Start points at the first byte after the segment length.
  if (ascii(buf, app1Start, 6) !== 'Exif\0\0') return 1;
  const tiff = app1Start + 6;
  if (tiff + 8 > buf.length) return 1;
  const little = ascii(buf, tiff, 2) === 'II';
  if (!little && ascii(buf, tiff, 2) !== 'MM') return 1;
  const ifdOffset = readU32(buf, tiff + 4, little);
  const ifd = tiff + ifdOffset;
  if (ifd + 2 > buf.length || ifd > app1Start + app1Len) return 1;
  const count = readU16(buf, ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > buf.length) break;
    const tag = readU16(buf, entry, little);
    if (tag === 0x0112) {
      const value = readU16(buf, entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function jpegDims(buf: Uint8Array): ImageDims | null {
  let i = 2;
  let orientation = 1;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (i + 4 > buf.length) break;
    const len = readU16(buf, i + 2, false);
    if (marker === 0xe1) orientation = jpegOrientation(buf, i + 4, len - 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (i + 9 > buf.length) return null;
      const height = readU16(buf, i + 5, false);
      const width = readU16(buf, i + 7, false);
      if (!width || !height) return null;
      return orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    i += 2 + len;
  }
  return null;
}

function pngDims(buf: Uint8Array): ImageDims | null {
  if (buf.length < 24 || ascii(buf, 12, 4) !== 'IHDR') return null;
  const width = readU32(buf, 16, false);
  const height = readU32(buf, 20, false);
  return width && height ? { width, height } : null;
}

function webpDims(buf: Uint8Array): ImageDims | null {
  if (buf.length < 30) return null;
  const chunk = ascii(buf, 12, 4);
  if (chunk === 'VP8 ') {
    const width = readU16(buf, 26, true) & 0x3fff;
    const height = readU16(buf, 28, true) & 0x3fff;
    return width && height ? { width, height } : null;
  }
  if (chunk === 'VP8L') {
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (chunk === 'VP8X') {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  return null;
}

function gifDims(buf: Uint8Array): ImageDims | null {
  if (buf.length < 10) return null;
  const width = readU16(buf, 6, true);
  const height = readU16(buf, 8, true);
  return width && height ? { width, height } : null;
}

/** Pixel dimensions (display-oriented for JPEG) or null when unsupported/corrupt. */
export function imageDimensions(buf: Uint8Array): ImageDims | null {
  const mime = sniffImageMime(buf);
  switch (mime) {
    case 'image/jpeg': return jpegDims(buf);
    case 'image/png': return pngDims(buf);
    case 'image/webp': return webpDims(buf);
    case 'image/gif': return gifDims(buf);
    default: return null;
  }
}
