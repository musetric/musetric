import { assertDefined } from '@musetric/utils';
import { createGpuContext } from '@musetric/utils/gpu';
import { describe, expect, it } from 'vitest';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { trackPitch } from '../pitchTrack.js';

const { sampleRate } = defaultSpectrogramConfig;
const toneSeconds = 30;
const toneFrequency = 220;

const createTone = (): Float32Array =>
  Float32Array.from(
    { length: sampleRate * toneSeconds },
    (_, index) =>
      0.5 * Math.sin((2 * Math.PI * toneFrequency * index) / sampleRate),
  );

describe('pitch track', () => {
  it('runs within the default limits of a device and tracks the same line', async () => {
    const samples = createTone();
    const adapter = assertDefined(
      await navigator.gpu.requestAdapter(),
      'WebGPU adapter not available',
    );
    const limited = await adapter.requestDevice();
    const { device } = await createGpuContext();

    limited.pushErrorScope('validation');
    const track = await trackPitch({ device: limited, samples });
    const failure = await limited.popErrorScope();
    const reference = await trackPitch({ device, samples });
    limited.destroy();
    device.destroy();

    expect(failure?.message).toBeUndefined();
    expect(track.values).toHaveLength(6000);
    expect(track.values).toEqual(reference.values);
    expect(track.confidence).toEqual(reference.confidence);
  });
});
