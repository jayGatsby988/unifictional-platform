/** Optional camera texture packet. Pixels and UVs are ephemeral native assets;
 * they are never selections, project JSON, upload inputs or measurement data. */
export const MAX_TEXTURE_BYTES = 34 * 1024 * 1024;
export const MAX_TEXTURE_BASE64 = Math.ceil(MAX_TEXTURE_BYTES / 3) * 4;
export interface ScanTextureImage { width: number; height: number; rgba: Uint8Array }
export interface ScanTexture {
  geometrySHA256: string;
  triangleCount: number;
  texturedTriangleCount: number;
  images: ScanTextureImage[];
  /** -1 means no valid camera observes the whole triangle. */
  frameIndices: Int16Array;
  /** Per observed vertex: normalized source-image u, v and camera-plane depth q. */
  coordinates: Float32Array;
}
function fail(message: string): never { throw new Error(message); }
function bytesOf(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) {
    if (value.byteLength < 50 || value.byteLength > MAX_TEXTURE_BYTES) fail('Camera texture exceeds the supported size.');
    return new Uint8Array(value);
  }
  if (typeof value !== 'string' || !value.length || value.length > MAX_TEXTURE_BASE64 || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) fail('Invalid camera texture encoding.');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.slice(0, value.length - padding).includes('=')) fail('Invalid camera texture padding.');
  const tail = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(value[value.length - padding - 1]);
  if ((padding === 2 && (tail & 15)) || (padding === 1 && (tail & 3))) fail('Invalid camera texture padding bits.');
  const size = value.length / 4 * 3 - padding;
  if (size < 50 || size > MAX_TEXTURE_BYTES) fail('Camera texture exceeds the supported size.');
  const raw = atob(value), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
/** MNHMTEX1: source XYZ SHA256, counts; opaque RGB24 images; sorted triangle
 * assignments with a source camera index and three (u,v,q) coordinates. */
export function decodeTextureArchive(data: unknown, expectedSHA256: string, expectedTriangles: number): ScanTexture {
  if (!/^[a-f0-9]{64}$/.test(expectedSHA256) || !Number.isInteger(expectedTriangles) || expectedTriangles < 1 || expectedTriangles > 320_000) fail('The source mesh could not be verified for camera textures.');
  const bytes = bytesOf(data), view = new DataView(bytes.buffer);
  if (String.fromCharCode(...bytes.subarray(0, 8)) !== 'MNHMTEX1') fail('Unsupported camera texture version.');
  const geometrySHA256 = Array.from(bytes.subarray(8, 40), n => n.toString(16).padStart(2, '0')).join('');
  const triangleCount = view.getUint32(40, true), imageCount = view.getUint16(44, true), assignmentCount = view.getUint32(46, true);
  if (geometrySHA256 !== expectedSHA256 || triangleCount !== expectedTriangles) fail('Camera textures belong to a different captured mesh.');
  if (!imageCount || imageCount > 48 || !assignmentCount || assignmentCount > triangleCount) fail('Invalid camera texture counts.');
  let offset = 50;
  const images: ScanTextureImage[] = [];
  for (let i = 0; i < imageCount; i++) {
    if (offset + 8 > bytes.length) fail('Truncated camera image header.');
    const width = view.getUint16(offset, true), height = view.getUint16(offset + 2, true), length = view.getUint32(offset + 4, true); offset += 8;
    if (width < 2 || height < 2 || width > 384 || height > 384 || length !== width * height * 3 || offset + length > bytes.length) fail('Invalid camera image size.');
    const rgba = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) { rgba[p * 4] = bytes[offset + p * 3]; rgba[p * 4 + 1] = bytes[offset + p * 3 + 1]; rgba[p * 4 + 2] = bytes[offset + p * 3 + 2]; rgba[p * 4 + 3] = 255; }
    images.push({ width, height, rgba }); offset += length;
  }
  if (bytes.length - offset !== assignmentCount * 42) fail('Invalid camera texture assignment size.');
  const frameIndices = new Int16Array(triangleCount).fill(-1), coordinates = new Float32Array(triangleCount * 9);
  const usedImages = new Set<number>();
  let previous = -1;
  for (let i = 0; i < assignmentCount; i++) {
    const triangle = view.getUint32(offset, true), frame = view.getUint16(offset + 4, true); offset += 6;
    if (triangle <= previous || triangle >= triangleCount || frame >= imageCount) fail('Invalid or duplicate camera texture assignment.');
    previous = triangle; frameIndices[triangle] = frame; usedImages.add(frame);
    for (let v = 0; v < 3; v++) {
      const u = view.getFloat32(offset, true), y = view.getFloat32(offset + 4, true), q = view.getFloat32(offset + 8, true); offset += 12;
      if (![u, y, q].every(Number.isFinite) || u < 0 || u > 1 || y < 0 || y > 1 || q < 0.199999 || q > 6.000001) fail('Invalid camera projection coordinates.');
      coordinates.set([u, y, q], triangle * 9 + v * 3);
    }
  }
  if (usedImages.size !== images.length) fail('Camera texture contains unused images.');
  return { geometrySHA256, triangleCount, texturedTriangleCount: assignmentCount, images, frameIndices, coordinates };
}
