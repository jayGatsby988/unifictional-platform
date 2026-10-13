import type { NativeRoomFrame } from './scan-import';

export const MAX_MESH_TRIANGLES = 320_000;
export const MAX_MESH_BYTES = 13 + MAX_MESH_TRIANGLES * 48;
export const MAX_MESH_BASE64 = Math.ceil(MAX_MESH_BYTES / 3) * 4;
export type MeshBounds = { min: [number, number, number]; max: [number, number, number] };
export interface ObservedMesh {
  version: 1 | 2;
  triangleCount: number;
  coloredVertexCount: number;
  wasLimited: boolean;
  /** Exact observed triangles in studio coordinates; no inferred surfaces. */
  positions: Float32Array;
  /** Linear RGB; unknown RGB bytes are discarded, not displayed. */
  colors: Float32Array;
  captured: Float32Array;
  bounds: MeshBounds;
  /** Binds optional camera textures to exact source XYZ bytes before normalization. */
  geometryDigest?: Promise<string | null>;
}

export function srgbByteToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const LINEAR_BYTE = Array.from({ length: 256 }, (_, i) => srgbByteToLinear(i));

export function validMeshFrame(value: unknown): value is NativeRoomFrame {
  if (!value || typeof value !== 'object') return false;
  const f = value as NativeRoomFrame;
  const vector = (v: NativeRoomFrame['origin']) => v && [v.x, v.y, v.z].every(n => Number.isFinite(n) && Math.abs(n) <= 1000);
  if (![f.origin, f.widthAxis, f.depthAxis].every(vector)) return false;
  const u = f.widthAxis, v = f.depthAxis;
  return Math.abs(u.y) < 1e-6 && Math.abs(v.y) < 1e-6 && Math.abs(Math.hypot(u.x, u.z) - 1) < 1e-5
    && Math.abs(v.x + u.z) < 1e-5 && Math.abs(v.z - u.x) < 1e-5;
}

export function meshPointInFrame(x: number, y: number, z: number, frame: NativeRoomFrame): [number, number, number] {
  const dx = x - frame.origin.x, dz = z - frame.origin.z;
  return [dx * frame.widthAxis.x + dz * frame.widthAxis.z, y - frame.origin.y, dx * frame.depthAxis.x + dz * frame.depthAxis.z];
}

/** Canonical standard base64 only. Bound allocation before decoding the archive. */
function archiveBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) {
    if (data.byteLength < 13 || data.byteLength > MAX_MESH_BYTES) throw new Error('LiDAR archive size is outside supported limits.');
    return new Uint8Array(data);
  }
  if (typeof data !== 'string' || !data.length || data.length > MAX_MESH_BASE64 || data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data)) throw new Error('Invalid LiDAR archive encoding.');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if (data.slice(0, data.length - padding).includes('=')) throw new Error('Invalid LiDAR archive padding.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const tail = alphabet.indexOf(data[data.length - padding - 1]);
  if ((padding === 2 && (tail & 15) !== 0) || (padding === 1 && (tail & 3) !== 0)) throw new Error('Invalid LiDAR archive padding bits.');
  const decodedLength = data.length / 4 * 3 - padding;
  if (decodedLength < 13 || decodedLength > MAX_MESH_BYTES) throw new Error('LiDAR archive size is outside supported limits.');
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function decodeMeshArchive(data: unknown, frame: NativeRoomFrame): ObservedMesh {
  if (!validMeshFrame(frame)) throw new Error('The LiDAR coordinate frame is unavailable.');
  const bytes = archiveBytes(data), view = new DataView(bytes.buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  const version = magic === 'MNHMESH1' ? 1 : magic === 'MNHMESH2' ? 2 : null;
  if (!version) throw new Error('Unsupported LiDAR archive version.');
  const triangleCount = view.getUint32(8, true), flag = view.getUint8(12), stride = version === 1 ? 36 : 48;
  if (!triangleCount || triangleCount > MAX_MESH_TRIANGLES || flag > 1 || bytes.length !== 13 + triangleCount * stride) throw new Error('Invalid LiDAR archive size or flags.');
  const positions = new Float32Array(triangleCount * 9), colors = new Float32Array(triangleCount * 9), captured = new Float32Array(triangleCount * 3);
  const sourceXYZ = new Uint8Array(triangleCount * 36);
  const bounds: MeshBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const neutral = [163, 163, 163].map(srgbByteToLinear);
  let coloredVertexCount = 0;
  for (let t = 0; t < triangleCount; t++) for (let v = 0; v < 3; v++) {
    if (v === 0) sourceXYZ.set(bytes.subarray(13 + t * stride, 13 + t * stride + 36), t * 36);
    const offset = 13 + t * stride + v * 12, i = t * 9 + v * 3;
    const x = view.getFloat32(offset, true), y = view.getFloat32(offset + 4, true), z = view.getFloat32(offset + 8, true);
    // Matches native archive validation. No coordinate clamping or rescaling
    // changes the mesh, including retained legacy archives.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || Math.abs(x) > 1000 || Math.abs(y) > 1000 || Math.abs(z) > 1000) throw new Error('LiDAR archive contains invalid coordinates.');
    const dx = x - frame.origin.x, dz = z - frame.origin.z;
    positions[i] = dx * frame.widthAxis.x + dz * frame.widthAxis.z;
    positions[i + 1] = y - frame.origin.y;
    positions[i + 2] = dx * frame.depthAxis.x + dz * frame.depthAxis.z;
    for (let axis = 0; axis < 3; axis++) { bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]); bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]); }
    const rgba = 13 + t * stride + 36 + v * 4;
    const alpha = version === 2 ? view.getUint8(rgba + 3) : 0;
    if (alpha !== 0 && alpha !== 255) throw new Error('LiDAR archive has an invalid color flag.');
    captured[t * 3 + v] = alpha === 255 ? 1 : 0;
    if (alpha === 255) coloredVertexCount++;
    for (let channel = 0; channel < 3; channel++) colors[i + channel] = alpha === 255 ? LINEAR_BYTE[view.getUint8(rgba + channel)] : neutral[channel];
  }
  const geometryDigest = globalThis.crypto?.subtle
    ? globalThis.crypto.subtle.digest('SHA-256', sourceXYZ).then(result => Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('')).catch(() => null)
    : Promise.resolve(null);
  return { version, triangleCount, coloredVertexCount, wasLimited: flag === 1, positions, colors, captured, bounds, geometryDigest };
}
