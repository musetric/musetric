import { createResourceCell } from '@musetric/resource-utils';
import { type ExtSpectrogramConfig } from '../common/extConfig.js';

export type StateSamples = {
  buffer: GPUBuffer;
  array: Float32Array;
  /**
   * Uploads the visible samples into the GPU ring buffer and returns the
   * `ringStart` rotation (= absolute window start modulo ring length) that the
   * slice shader uses to read the buffer. Only the samples that actually
   * changed since the previous frame are uploaded: the window edge exposed by
   * the playhead movement plus the region whose truncation flipped.
   */
  write: (
    samples: Float32Array,
    trackProgress: number,
    config: ExtSpectrogramConfig,
    truncateAfterPlayhead: boolean,
    sampleOffset: number,
    contentChanged: boolean,
  ) => number;
};

type ResidentState = {
  valid: boolean;
  windowStart: number;
  sampleLength: number;
  limit: number;
  samples: Float32Array | undefined;
};

const floorMod = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

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
        write: (
          samples,
          trackProgress,
          config,
          truncateAfterPlayhead,
          sampleOffset,
          contentChanged,
        ) => {
          const { windowSize, playheadRatio, sampleRate, visibleTime } = config;
          const beforeSamples =
            visibleTime * playheadRatio * sampleRate + windowSize;
          const totalVisibleSamples = visibleTime * sampleRate + windowSize;
          const windowStart = Math.floor(
            trackProgress * samples.length - beforeSamples + sampleOffset,
          );
          const limit = truncateAfterPlayhead
            ? Math.min(totalVisibleSamples, Math.floor(beforeSamples))
            : totalVisibleSamples;
          const ringStart = floorMod(windowStart, ringLength);

          // Writes effective(windowStart + i) for i in [0, count) into the ring
          // slots ((windowStart + i) mod ringLength), splitting at the wrap.
          const writeRange = (from: number, count: number): void => {
            if (count <= 0) {
              return;
            }
            const scratch =
              count === ringLength ? array : new Float32Array(count);
            for (let i = 0; i < count; i += 1) {
              const sampleIndex = from + i;
              const local = sampleIndex - windowStart;
              const inside =
                sampleIndex >= 0 &&
                sampleIndex < samples.length &&
                local < limit;
              scratch[i] = inside ? samples[sampleIndex] : 0;
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
            contentChanged ||
            resident.samples !== samples ||
            resident.sampleLength !== samples.length ||
            Math.abs(windowStart - resident.windowStart) >= ringLength;

          if (full) {
            writeRange(windowStart, ringLength);
          } else {
            const shift = windowStart - resident.windowStart;
            if (shift > 0) {
              // New samples exposed on the leading (right) edge.
              writeRange(resident.windowStart + ringLength, shift);
            } else if (shift < 0) {
              // New samples exposed on the trailing (left) edge (rewind/drag).
              writeRange(windowStart, -shift);
            }
            // Region whose truncation gate flipped between frames.
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
          }

          resident.valid = true;
          resident.windowStart = windowStart;
          resident.sampleLength = samples.length;
          resident.limit = limit;
          resident.samples = samples;

          return ringStart;
        },
      };
    },
    dispose: (stateSamples) => {
      stateSamples.buffer.destroy();
    },
    equals: (current, next) => current === next,
  });
