/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import type { CapturedImageRotation } from './camera-projection';
import { mirrorModelPixels as pixels } from './mirror-image';
import type { ScanTextureImage } from './texture-archive';
import type { ScannedRoomGeometry } from '../spec/types';
import { reconstructMirrors, type ReconstructedMirror } from './reconstructed-mirrors';
import type { CapturedCameraProjection } from './camera-projection';

/** Dedicated local worker: only static model/runtime files are fetched. Camera
 * pixels never leave this device, and neural inference cannot block gestures. */
const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async (event: MessageEvent<{ scan: ScannedRoomGeometry; cameras: Array<CapturedCameraProjection | null>; frames: { frameIndex: number; image: ScanTextureImage; rotation: CapturedImageRotation }[] }>) => {
  let session: ort.InferenceSession | undefined;
  try {
    const frames = event.data.frames;
    if (!frames?.length || frames.length > 48 || frames.some(f => ![0, 90, 180, 270].includes(f.rotation) || f.image.width > 384 || f.image.height > 384 || f.image.rgba.length !== f.image.width * f.image.height * 4)) throw new Error('Invalid local frame batch.');
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = `${worker.location.origin}/models/mirror/runtime/`;
    const configResponse = await fetch('/models/mirror/config.json');
    if (!configResponse.ok) throw new Error('Detail model unavailable.');
    const config = await configResponse.json() as { defaultInputWidth: number; defaultInputHeight: number; inputName: string; outputName: string; mirrorClassId: number };
    if (!Number.isInteger(config.defaultInputWidth) || !Number.isInteger(config.defaultInputHeight) || config.defaultInputWidth < 128 || config.defaultInputWidth > 512 || config.defaultInputHeight < 128 || config.defaultInputHeight > 512 || config.mirrorClassId !== 27) throw new Error('Invalid detail model configuration.');
    session = await ort.InferenceSession.create('/models/mirror/model.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const masks = [];
    let recovered: ReconstructedMirror[] = [];
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index], input = new ort.Tensor('float32', pixels(frame.image, frame.rotation, config.defaultInputWidth, config.defaultInputHeight), [1, 3, config.defaultInputHeight, config.defaultInputWidth]);
      const outputs = await session.run({ [config.inputName]: input }), logits = outputs[config.outputName]; input.dispose();
      if (!logits || logits.dims.length !== 4 || logits.dims[1] !== 150) throw new Error('Invalid detail model result.');
      const height = logits.dims[2], width = logits.dims[3], count = width * height, values = logits.data as Float32Array;
      if (count > 262144) throw new Error('Detail model result exceeds limits.');
      const probabilities = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const mirror = values[config.mirrorClassId * count + i]; let best = -Infinity, sum = 0;
        for (let c = 0; c < 150; c++) best = Math.max(best, values[c * count + i]);
        if (mirror !== best) continue;
        for (let c = 0; c < 150; c++) sum += Math.exp(values[c * count + i] - best);
        const probability = 1 / sum; if (probability >= .6) probabilities[i] = probability;
      }
      Object.values(outputs).forEach(output => output.dispose());
      masks.push({ frameIndex: frame.frameIndex, rotation: frame.rotation, width, height, probabilities });
      // Publish only independently agreeing views. A slow later inference or
      // timeout must not erase a mirror already supported by earlier frames.
      // Batching avoids repeating the wall-ray pass for every camera image.
      if (index % 4 === 3 || index === 1) recovered = reconstructMirrors(event.data.scan, event.data.cameras, masks);
      worker.postMessage({ type: 'progress', completed: index + 1, total: frames.length, mirrors: recovered });
    }
    const mirrors = reconstructMirrors(event.data.scan, event.data.cameras, masks);
    worker.postMessage({ type: 'complete', mirrors });
  } catch {
    worker.postMessage({ type: 'error', message: 'Extra camera details could not be recovered on this device. The captured room remains available.' });
  } finally { await session?.release(); }
};
