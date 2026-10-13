import type { ScanPlaneTexturePlane } from '@/lib/native/plane-texture-archive';

/** Source plane coordinates are already in the Studio frame. Pixel rows grow
 * along V; output UVs address pixel centers without a second image flip. */
export function planeTextureUVs(positions: ArrayLike<number>, plane: Pick<ScanPlaneTexturePlane, 'origin' | 'u' | 'v' | 'width' | 'height' | 'metersPerTexel'>): Float32Array {
  const coordinates = new Float32Array(Math.floor(positions.length / 3) * 2);
  const widthMeters = plane.width * plane.metersPerTexel, heightMeters = plane.height * plane.metersPerTexel;
  for (let vertex = 0; vertex < coordinates.length / 2; vertex++) {
    const p = vertex * 3, x = positions[p] - plane.origin[0], y = positions[p + 1] - plane.origin[1], z = positions[p + 2] - plane.origin[2];
    coordinates[vertex * 2] = (x * plane.u[0] + y * plane.u[1] + z * plane.u[2]) / widthMeters;
    coordinates[vertex * 2 + 1] = (x * plane.v[0] + y * plane.v[1] + z * plane.v[2]) / heightMeters;
  }
  return coordinates;
}
