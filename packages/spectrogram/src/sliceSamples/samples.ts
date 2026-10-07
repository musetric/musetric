import { createResourceCell } from '@musetric/utils';
import {
  type ExtSpectrogramConfig,
  floorMod,
  type SpectrogramSampleRange,
} from '../common/extConfig.js';
import { type SpectrogramSource } from '../common/source.js';

type ColumnOffsetsWrite = {
  source: SpectrogramSource;
  config: ExtSpectrogramConfig;
  baseColumn: number;
  windowStart: number;
  ringLength: number;
};

const writeColumnOffsets = (
  device: GPUDevice,
  target: GPUBuffer,
  options: ColumnOffsetsWrite,
): void => {
  const { source, config, baseColumn, windowStart, ringLength } = options;
  const { windowCount, windowSize, columnStep } = config;
  const offsets = new Int32Array(windowCount);
  for (let column = 0; column < windowCount; column += 1) {
    const start = Math.round(
      source.position((baseColumn + column) * columnStep) - windowSize / 2,
    );
    const offset = start - windowStart;
    offsets[column] = offset + windowSize <= ringLength ? offset : -1;
  }
  device.queue.writeBuffer(target, 0, offsets);
};

export type StateSamplesWriteResult = {
  baseWindowStart: number;
  ringStart: number;
};

export type StateSamples = {
  buffer: GPUBuffer;
  columnOffsets: GPUBuffer;
  array: Float32Array;

  write: (options: {
    source: SpectrogramSource;
    baseColumn: number;
    config: ExtSpectrogramConfig;
    playheadRatio: number;
    truncateAfterPlayhead: boolean;
    forceFullUpload: boolean;
    invalidations: readonly SpectrogramSampleRange[];
  }) => StateSamplesWriteResult;
};

export type StateSamplesArg = {
  ringLength: number;
  windowCount: number;
};

type ResidentState = {
  valid: boolean;
  windowStart: number;
  sampleLength: number;
  limit: number;
  source: SpectrogramSource | undefined;
};

export const createStateSamplesCell = (device: GPUDevice) =>
  createResourceCell({
    create: (arg: StateSamplesArg): StateSamples => {
      const { ringLength, windowCount } = arg;
      const array = new Float32Array(ringLength);
      const buffer = device.createBuffer({
        label: 'pipeline-samples-buffer',
        size: array.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const columnOffsets = device.createBuffer({
        label: 'pipeline-column-offsets-buffer',
        size: windowCount * Int32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const resident: ResidentState = {
        valid: false,
        windowStart: 0,
        sampleLength: 0,
        limit: 0,
        source: undefined,
      };

      return {
        buffer,
        columnOffsets,
        array,
        write: (options) => {
          const {
            source,
            baseColumn,
            config,
            playheadRatio,
            truncateAfterPlayhead,
            forceFullUpload,
            invalidations,
          } = options;
          const { windowSize, sampleRate, visibleTime, columnStep } = config;
          const baseCenter = baseColumn * columnStep;
          const playheadSong =
            baseCenter +
            visibleTime * playheadRatio * sampleRate +
            windowSize / 2;
          const windowStart = Math.round(
            source.position(baseCenter) - windowSize / 2,
          );
          const beforeSamples =
            source.position(playheadSong) -
            source.position(baseCenter) +
            windowSize / 2;
          const limit = truncateAfterPlayhead
            ? Math.min(ringLength, Math.floor(beforeSamples))
            : ringLength;
          const ringStart = floorMod(windowStart, ringLength);

          const writeRange = (from: number, count: number): void => {
            if (count <= 0) {
              return;
            }
            const dataEnd = Math.min(source.length, windowStart + limit);
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
              source.read(scratch, localInStart, inStart, inEnd - inStart);
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
            resident.source !== source ||
            resident.sampleLength !== source.length ||
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
              const from = Math.max(
                Math.floor(source.position(invalidation.frameIndex)),
                windowStart,
              );
              const to = Math.min(
                Math.ceil(
                  source.position(
                    invalidation.frameIndex + invalidation.frameCount,
                  ),
                ),
                windowStart + ringLength,
              );
              writeRange(from, to - from);
            }
          }

          if (source.mapped) {
            writeColumnOffsets(device, columnOffsets, {
              source,
              config,
              baseColumn,
              windowStart,
              ringLength,
            });
          }

          resident.valid = true;
          resident.windowStart = windowStart;
          resident.sampleLength = source.length;
          resident.limit = limit;
          resident.source = source;

          return {
            baseWindowStart: windowStart,
            ringStart,
          };
        },
      };
    },
    dispose: (stateSamples) => {
      stateSamples.buffer.destroy();
      stateSamples.columnOffsets.destroy();
    },
    equals: (current, next) =>
      current.ringLength === next.ringLength &&
      current.windowCount === next.windowCount,
  });
