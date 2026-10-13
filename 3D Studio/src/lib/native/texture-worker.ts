import { decodeTextureArchive } from './texture-archive';
self.onmessage = (event: MessageEvent<{ data: string | ArrayBuffer; digest: string; triangles: number }>) => {
  try {
    const texture = decodeTextureArchive(event.data.data, event.data.digest, event.data.triangles);
    self.postMessage({ ok: true, texture }, { transfer: [texture.frameIndices.buffer, texture.coordinates.buffer, ...texture.images.map(image => image.rgba.buffer)] });
  } catch (cause) { self.postMessage({ ok: false, error: cause instanceof Error ? cause.message : 'Camera textures could not be decoded.' }); }
};
