import { createResourceCell } from '@musetric/utils';
import {
  type ExtSpectrogramConfig,
  floorMod,
  type SpectrogramSampleRange,
  windowStartForColumn,
} from '../common/extConfig.js';

export type StateSamplesWriteResult = {
  baseWindowStart: number;
  ringStart: number;
};

export type StateSamples = {
  buffer: GPUBuffer;
  array: Float32Array;

  write: (options: {
    samples: Float32Array;
    baseColumn: number;
    config: ExtSpectrogramConfig;
    truncateAfterPlayhead: boolean;
    forceFullUpload: boolean;
    invalidations: readonly SpectrogramSampleRange[];
  }) => StateSamplesWriteResult;
};

type ResidentState = {
  valid: boolean;
  windowStart: number;
  sampleLength: number;
  limit: number;
  samples: Float32Array | undefined;
};

export const createStateSamplesCell = (device: GPUDevice) =>
  createResourceCell({
    create: (visibleSamples: number): StateSamples => {
      const ringLength = visibleSamples;
      const array = new Float32Array(ringLength);
      const buffer = device.createBuffer({
        label: 'pipeline-samples-buffer',
        size: array.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const resident: ResidentState = {
        valid: false,
        windowStart: 0,
        sampleLength: 0,
        limit: 0,
        samples: undefined,
      };

      return {
        buffer,
        array,
        write: (options) => {
          const {
            samples,
            baseColumn,
            config,
            truncateAfterPlayhead,
            forceFullUpload,
            invalidations,
          } = options;
          const { windowSize, playheadRatio, sampleRate, visibleTime } = config;
          const beforeSamples =
            visibleTime * playheadRatio * sampleRate + windowSize;
          const windowStart = windowStartForColumn(
            config,
            windowSize,
            baseColumn,
          );
          const limit = truncateAfterPlayhead
            ? Math.min(ringLength, Math.floor(beforeSamples))
            : ringLength;
          const ringStart = floorMod(windowStart, ringLength);

          const writeRange = (from: number, count: number): void => {
            if (count <= 0) {
              return;
            }
            const dataEnd = Math.min(samples.length, windowStart + limit);
            const inStart = Math.max(from, 0);
            const inEnd = Math.min(from + count, dataEnd);
            const localInStart = inStart - from;
            const localInEnd = inEnd - from;
            const reused = count === ringLength;
            const scratch = reused ? array : new Float32Array(count);
            if (reused) {
              if (localInStart > 0) {
                scratch.fill(0, 0, localInStart);
              }
              if (localInEnd < count) {
                scratch.fill(0, localInEnd, count);
              }
            }
            if (localInEnd > localInStart) {
              scratch.set(samples.subarray(inStart, inEnd), localInStart);
            }
            const startSlot = floorMod(from, ringLength);
            const firstCount = Math.min(count, ringLength - startSlot);
            device.queue.writeBuffer(
              buffer,
              startSlot * 4,
              scratch,
              0,
              firstCount,
            );
            if (count > firstCount) {
              device.queue.writeBuffer(
                buffer,
                0,
                scratch,
                firstCount,
                count - firstCount,
              );
            }
          };

          const full =
            !resident.valid ||
            forceFullUpload ||
            resident.samples !== samples ||
            resident.sampleLength !== samples.length ||
            Math.abs(windowStart - resident.windowStart) >= ringLength;

          if (full) {
            writeRange(windowStart, ringLength);
          } else {
            const shift = windowStart - resident.windowStart;
            if (shift > 0) {
              writeRange(resident.windowStart + ringLength, shift);
            } else if (shift < 0) {
              writeRange(windowStart, -shift);
            }
            const currentTruncation = windowStart + limit;
            const previousTruncation = resident.windowStart + resident.limit;
            const lo = Math.max(
              Math.min(currentTruncation, previousTruncation),
              windowStart,
            );
            const hi = Math.min(
              Math.max(currentTruncation, previousTruncation),
              windowStart + ringLength,
            );
            writeRange(lo, hi - lo);
            for (const invalidation of invalidations) {
              const from = Math.max(invalidation.frameIndex, windowStart);
              const to = Math.min(
                invalidation.frameIndex + invalidation.frameCount,
                windowStart + ringLength,
              );
              writeRange(from, to - from);
            }
          }

          resident.valid = true;
          resident.windowStart = windowStart;
          resident.sampleLength = samples.length;
          resident.limit = limit;
          resident.samples = samples;

          return {
            baseWindowStart: windowStart,
            ringStart,
          };
        },
      };
    },
    dispose: (stateSamples) => {
      stateSamples.buffer.destroy();
    },
    equals: (current, next) => current === next,
  });
