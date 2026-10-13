import type { ObservedMesh } from './mesh-archive';
import type { ScanTexture } from './texture-archive';
import type { ScannedElement } from '../spec/types';

export type CameraPoint = [number, number, number];
export interface CapturedCameraProjection {
  frameIndex: number;
  /** Rows mapping Studio XYZ1 to (u*q, v*q, q), using original image coordinates. */
  rows: [number[], number[], number[]];
  samples: number;
  maximumUVError: number;
}
type Sample = { point: CameraPoint; target: CameraPoint };

function solve(matrix: number[][], values: number[]): number[] | null {
  const n = values.length, a = matrix.map((row, i) => [...row, values[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-8) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const scale = a[column][column];
    for (let j = column; j <= n; j++) a[column][j] /= scale;
    for (let row = 0; row < n; row++) if (row !== column) {
      const factor = a[row][column];
      for (let j = column; j <= n; j++) a[row][j] -= factor * a[column][j];
    }
  }
  const result = a.map(row => row[n]);
  return result.every(Number.isFinite) ? result : null;
}
/** Smallest principal variance, rather than axis-wise spread, detects a thin
 * plane even after the room is rotated. Jacobi operates only on a 3×3 matrix. */
function minimumSpatialVariance(samples: Sample[], center: number[]): number {
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const sample of samples) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) covariance[a][b] += (sample.point[a] - center[a]) * (sample.point[b] - center[b]) / samples.length;
  for (let iteration = 0; iteration < 18; iteration++) {
    let p = 0, q = 1;
    for (const [a, b] of [[0, 2], [1, 2]]) if (Math.abs(covariance[a][b]) > Math.abs(covariance[p][q])) { p = a; q = b; }
    const off = covariance[p][q]; if (Math.abs(off) < 1e-12) break;
    const tau = (covariance[q][q] - covariance[p][p]) / (2 * off);
    const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t), s = t * c;
    covariance[p][p] -= t * off; covariance[q][q] += t * off; covariance[p][q] = covariance[q][p] = 0;
    for (let a = 0; a < 3; a++) if (a !== p && a !== q) {
      const ap = covariance[a][p], aq = covariance[a][q];
      covariance[a][p] = covariance[p][a] = c * ap - s * aq;
      covariance[a][q] = covariance[q][a] = s * ap + c * aq;
    }
  }
  return Math.min(covariance[0][0], covariance[1][1], covariance[2][2]);
}
const dotPoint = (row: number[], point: CameraPoint) => row[0] * point[0] + row[1] * point[1] + row[2] * point[2] + row[3];

export function projectCapturedPoint(camera: CapturedCameraProjection, point: CameraPoint): { u: number; v: number; q: number } | null {
  const q = dotPoint(camera.rows[2], point);
  if (!Number.isFinite(q) || q < .05 || q > 20) return null;
  const u = dotPoint(camera.rows[0], point) / q, v = dotPoint(camera.rows[1], point) / q;
  return Number.isFinite(u) && Number.isFinite(v) ? { u, v, q } : null;
}

/** Recover camera projection from verified correspondences already transferred
 * by native. No camera bytes, images, or coordinate arrays are changed/uploaded.
 * Coplanar/degenerate frames fail closed rather than inventing calibration. */
export function recoverCapturedCameras(mesh: ObservedMesh, texture: ScanTexture): Array<CapturedCameraProjection | null> {
  const output: Array<CapturedCameraProjection | null> = texture.images.map(() => null);
  const count = mesh.triangleCount;
  if (count < 1 || count > 320_000 || texture.triangleCount !== count || mesh.positions.length !== count * 9 || texture.coordinates.length !== count * 9 || texture.frameIndices.length !== count || output.length > 48) return output;
  const candidates: Sample[][] = output.map(() => []), seen = output.map(() => 0), limit = 480;
  for (let triangle = 0; triangle < count; triangle++) {
    const frame = texture.frameIndices[triangle]; if (frame < 0 || frame >= output.length) continue;
    const i = triangle * 9 + (triangle % 3) * 3, q = texture.coordinates[i + 2];
    const point: CameraPoint = [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
    const target: CameraPoint = [texture.coordinates[i] * q, texture.coordinates[i + 1] * q, q];
    if (!point.every(Number.isFinite) || !target.every(Number.isFinite) || q < .1999 || q > 6.0001) continue;
    const n = ++seen[frame];
    // Deterministic reservoir avoids fitting only the first small mesh patch.
    let hash = Math.imul(triangle + 1, 0x45d9f3b); hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b); hash ^= hash >>> 16;
    const index = n <= limit ? n - 1 : (hash >>> 0) % n;
    if (index < limit) candidates[frame][index] = { point, target };
  }
  for (let frame = 0; frame < output.length; frame++) {
    const samples = candidates[frame]; if (samples.length < 24) continue;
    const center = [0, 1, 2].map(axis => samples.reduce((sum, s) => sum + s.point[axis], 0) / samples.length);
    const scale = [0, 1, 2].map(axis => Math.sqrt(samples.reduce((sum, s) => sum + (s.point[axis] - center[axis]) ** 2, 0) / samples.length));
    if (scale.some(n => n < .015) || minimumSpatialVariance(samples, center) < .015 ** 2) continue;
    const normal = Array.from({ length: 4 }, () => [0, 0, 0, 0]), rhs = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
    for (const sample of samples) {
      const p = [...sample.point.map((n, i) => (n - center[i]) / scale[i]), 1];
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) normal[a][b] += p[a] * p[b];
        for (let k = 0; k < 3; k++) rhs[k][a] += p[a] * sample.target[k];
      }
    }
    const fitted = rhs.map(values => solve(normal, values)); if (fitted.some(row => !row)) continue;
    const rows = fitted.map(row => {
      const xyz = row!.slice(0, 3).map((n, i) => n / scale[i]);
      return [...xyz, row![3] - xyz.reduce((sum, n, i) => sum + n * center[i], 0)];
    }) as CapturedCameraProjection['rows'];
    const camera: CapturedCameraProjection = { frameIndex: frame, rows, samples: samples.length, maximumUVError: 0 };
    let valid = true;
    for (const sample of samples) {
      const projected = projectCapturedPoint(camera, sample.point);
      if (!projected || Math.abs(projected.q - sample.target[2]) > .005) { valid = false; break; }
      camera.maximumUVError = Math.max(camera.maximumUVError, Math.hypot(projected.u - sample.target[0] / sample.target[2], projected.v - sample.target[1] / sample.target[2]));
    }
    if (valid && camera.maximumUVError < .002) output[frame] = camera;
  }
  return output;
}

/** Pixel ray intersection with the original plane; never trusts mirror depth. */
export function capturedPixelOnWall(camera: CapturedCameraProjection, u: number, v: number, wall: ScannedElement): CameraPoint | null {
  if (![u, v].every(Number.isFinite) || u < 0 || u > 1 || v < 0 || v > 1 || wall.transform.length !== 16) return null;
  const t = wall.transform, n = [t[8], t[9], t[10]], a = camera.rows[0].map((x, i) => x - u * camera.rows[2][i]), b = camera.rows[1].map((x, i) => x - v * camera.rows[2][i]);
  const point = solve([a.slice(0, 3), b.slice(0, 3), n], [-a[3], -b[3], n[0] * t[12] + n[1] * t[13] + n[2] * t[14]]) as CameraPoint | null;
  if (!point || !projectCapturedPoint(camera, point)) return null;
  return point;
}

export type CapturedImageRotation = 0 | 90 | 180 | 270;
export interface CapturedImageUV { u: number; v: number }

/** Nearest quarter-turn that points projected world +Y toward image top.
 * Camera rows use top-left raw image UV. Pixel scaling matters for a non-square
 * image. Looking directly along gravity has no defined upright direction. */
export function capturedCameraUprightRotation(camera: CapturedCameraProjection, image: { width: number; height: number }): CapturedImageRotation | null {
  if (![image.width, image.height].every(n => Number.isFinite(n) && n > 0) || camera.rows.length !== 3 || camera.rows.some(row => row.length !== 4 || !row.every(Number.isFinite))) return null;
  const depthNormal = camera.rows[2].slice(0, 3);
  const depthLength = Math.hypot(...depthNormal);
  if (depthLength < 1e-8 || Math.hypot(depthNormal[0], depthNormal[2]) / depthLength < 1e-4) return null;
  // Quotient-rule derivative at u=v=.5, up to a positive camera depth factor.
  const dx = (camera.rows[0][1] - .5 * camera.rows[2][1]) * image.width;
  const dy = (camera.rows[1][1] - .5 * camera.rows[2][1]) * image.height;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-6) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 0 : 180;
  return dx > 0 ? 270 : 90;
}

/** Rotate raw top-left UV clockwise for display; do not clamp or interpolate
 * a mask. Its inverse maps every selected/unsupported pixel back identically. */
export function rawToUprightUV(u: number, v: number, rotation: CapturedImageRotation): CapturedImageUV {
  switch (rotation) {
    case 90: return { u: 1 - v, v: u };
    case 180: return { u: 1 - u, v: 1 - v };
    case 270: return { u: v, v: 1 - u };
    default: return { u, v };
  }
}
export function uprightToRawUV(u: number, v: number, rotation: CapturedImageRotation): CapturedImageUV {
  return rawToUprightUV(u, v, rotation === 90 ? 270 : rotation === 270 ? 90 : rotation);
}
