import { assertDefined } from '@musetric/utils';
import { describe, expect, it } from 'vitest';
import { defaultSpectrogramConfig } from '../defaultConfig.cross.js';
import { trackPitch } from '../pitchTrack.js';
import { createTone } from './common.js';

const { sampleRate } = defaultSpectrogramConfig;
const toneSeconds = 30;
const toneFrequency = 220;

const requestAdapter = async (): Promise<GPUAdapter> =>
  assertDefined(
    await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }),
    'WebGPU adapter not available',
  );

describe('pitch track', () => {
  it('runs within the default limits of a device and tracks the same line', async () => {
    const samples = createTone(
      sampleRate * toneSeconds,
      toneFrequency,
      sampleRate,
      0.5,
    );
    const limited = await (await requestAdapter()).requestDevice();
    const adapter = await requestAdapter();
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      },
    });
    try {
      limited.pushErrorScope('validation');
      const track = await trackPitch({ device: limited, samples });
      const failure = await limited.popErrorScope();
      const reference = await trackPitch({ device, samples });

      expect(failure?.message).toBeUndefined();
      expect(track.values).toHaveLength(6000);
      expect(track.values).toEqual(reference.values);
      expect(track.confidence).toEqual(reference.confidence);
    } finally {
      limited.destroy();
      device.destroy();
    }
  });
});
