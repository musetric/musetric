import { createResourceCell } from '@musetric/resource-utils';
import type { ExtSpectrogramConfig } from '../common/extConfig.js';

export type StateSamples = {
  buffer: GPUBuffer;
  array: Float32Array;
  write: (
    samples: Float32Array,
    trackProgress: number,
    config: ExtSpectrogramConfig,
  ) => void;
};

export const createStateSamplesCell = (device: GPUDevice) =>
  createResourceCell({
    create: (visibleSamples: number): StateSamples => {
      const array = new Float32Array(visibleSamples);
      const buffer = device.createBuffer({
        label: 'pipeline-samples-buffer',
        size: array.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      return {
        buffer,
        array,
        write: (samples, trackProgress, config) => {
          const { windowSize, playheadRatio, sampleRate, visibleTime } = config;
          const beforeSamples =
            visibleTime * playheadRatio * sampleRate + windowSize;
          const totalVisibleSamples = visibleTime * sampleRate + windowSize;
          const startIndex = Math.floor(
            trackProgress * samples.length - beforeSamples,
          );

          const from = Math.max(0, -startIndex);
          const to = Math.min(totalVisibleSamples, samples.length - startIndex);

          if (from > 0) {
            array.fill(0, 0, from);
          }
          if (to > from) {
            const slice = samples.subarray(startIndex + from, startIndex + to);
            array.set(slice, from);
          }
          if (to < array.length) {
            array.fill(0, to, array.length);
          }
          device.queue.writeBuffer(buffer, 0, array);
        },
      };
    },
    dispose: (stateSamples) => {
      stateSamples.buffer.destroy();
    },
    equals: (current, next) => current === next,
  });
