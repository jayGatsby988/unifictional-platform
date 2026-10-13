import { decodePlaneTextureArchive, type PlaneTextureExpectation } from './plane-texture-archive';

self.onmessage = (event: MessageEvent<{ data: string | ArrayBuffer; expected: PlaneTextureExpectation }>) => {
  try {
    const texture = decodePlaneTextureArchive(event.data.data, event.data.expected);
    self.postMessage({ ok: true, texture }, { transfer: texture.planes.map(plane => plane.rgba.buffer) });
  } catch (cause) {
    self.postMessage({ ok: false, error: cause instanceof Error ? cause.message : 'Measured-plane images could not be decoded.' });
  }
};
