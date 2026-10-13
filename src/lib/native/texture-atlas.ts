import type { ScanTexture, ScanTextureImage } from './texture-archive';
export interface ScanTextureAtlases { images: ScanTextureImage[]; triangleAtlas: Int16Array; projected: Float32Array }
/** Sixteen camera images per atlas limit mobile draw calls. A replicated pixel
 * gutter and no mipmaps prevent color leaking from an adjacent camera image. */
export function buildTextureAtlases(texture: ScanTexture): ScanTextureAtlases {
  const images: ScanTextureImage[] = [];
  const locations: Array<{ atlas: number; x: number; y: number; width: number; height: number }> = [];
  for (let start = 0; start < texture.images.length; start += 16) {
    const source = texture.images.slice(start, start + 16), columns = Math.min(4, source.length), rows = Math.ceil(source.length / columns);
    const cellWidth = Math.max(...source.map(image => image.width)) + 2, cellHeight = Math.max(...source.map(image => image.height)) + 2;
    const width = columns * cellWidth, height = rows * cellHeight, rgba = new Uint8Array(width * height * 4);
    source.forEach((image, local) => {
      const x = (local % columns) * cellWidth + 1, y = Math.floor(local / columns) * cellHeight + 1;
      locations.push({ atlas: images.length, x, y, width: image.width, height: image.height });
      for (let iy = -1; iy <= image.height; iy++) for (let ix = -1; ix <= image.width; ix++) {
        const from = (Math.max(0, Math.min(image.height - 1, iy)) * image.width + Math.max(0, Math.min(image.width - 1, ix))) * 4;
        const to = ((y + iy) * width + x + ix) * 4;
        rgba[to] = image.rgba[from]; rgba[to + 1] = image.rgba[from + 1]; rgba[to + 2] = image.rgba[from + 2]; rgba[to + 3] = 255;
      }
    });
    images.push({ width, height, rgba });
  }
  const triangleAtlas = new Int16Array(texture.triangleCount).fill(-1), projected = new Float32Array(texture.triangleCount * 9);
  for (let triangle = 0; triangle < texture.triangleCount; triangle++) {
    const frame = texture.frameIndices[triangle]; if (frame < 0) continue;
    const location = locations[frame], atlas = images[location.atlas]; triangleAtlas[triangle] = location.atlas;
    for (let vertex = 0; vertex < 3; vertex++) {
      const i = triangle * 9 + vertex * 3, q = texture.coordinates[i + 2];
      projected[i] = (location.x + texture.coordinates[i] * location.width) / atlas.width * q;
      projected[i + 1] = (location.y + texture.coordinates[i + 1] * location.height) / atlas.height * q;
      projected[i + 2] = q;
    }
  }
  return { images, triangleAtlas, projected };
}
