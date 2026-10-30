import { createGpuBufferReader } from '@musetric/utils/gpu';
import { type TrackKey } from '../common/trackKeys.es.js';
import { type SpectrogramRuntime } from '../configurator.js';

export type SpectrogramFundamentalFrames = {
  hopSeconds: number;
  firstFrame: number;
  values: Float32Array;
  confidence: Float32Array;
};

export type FundamentalFramesRequest = {
  device: GPUDevice;
  runtime: SpectrogramRuntime;
  trackKey: TrackKey;
  firstFrame: number;
  frameCount: number;
};

export const readLaneFundamentalFrames = async (
  request: FundamentalFramesRequest,
): Promise<SpectrogramFundamentalFrames> => {
  const { device, runtime, trackKey, firstFrame, frameCount } = request;
  const { lane } = runtime.tracks[trackKey];
  const { ringFrames, hop, sampleRate } = lane.pitchSettings;
  const reader = createGpuBufferReader({
    device,
    typeSize: Int32Array.BYTES_PER_ELEMENT,
    size: ringFrames * 4,
  });
  try {
    const bytes = await reader.read(lane.fundamentalDecodedBuffer);
    const floats = new Float32Array(bytes);
    const ints = new Int32Array(bytes);
    const values = new Float32Array(frameCount);
    const confidence = new Float32Array(frameCount);
    for (let index = 0; index < frameCount; index += 1) {
      const frame = firstFrame + index;
      const slot = ((frame % ringFrames) + ringFrames) % ringFrames;
      if (ints[slot * 4 + 2] === frame) {
        values[index] = floats[slot * 4];
        confidence[index] = floats[slot * 4 + 1];
      }
    }
    return { hopSeconds: hop / sampleRate, firstFrame, values, confidence };
  } finally {
    reader.destroy();
  }
};

export const fundamentalSpanFrames = (
  hop: number,
  startSample: number,
  sampleCount: number,
) => {
  const firstFrame = Math.max(0, Math.floor(startSample / hop) - 1);
  const frameCount =
    Math.ceil((startSample + sampleCount) / hop) + 2 - firstFrame;
  return { firstFrame, frameCount };
};
