import { createResourceCell } from '@musetric/utils';
import { floorMod } from '../common/extConfig.js';
import { type SpectrogramSource } from '../common/source.js';

export type ColumnScaleWrite = {
  source: SpectrogramSource;
  baseColumn: number;
  columnStep: number;
  transposeSemitones: number;
};

type Written = ColumnScaleWrite & {
  length: number;
};

const isWritten = (
  written: Written | undefined,
  next: ColumnScaleWrite,
): boolean =>
  written !== undefined &&
  written.source === next.source &&
  written.length === next.source.length &&
  written.baseColumn === next.baseColumn &&
  written.columnStep === next.columnStep &&
  written.transposeSemitones === next.transposeSemitones;

export type ColumnScale = {
  buffer: GPUBuffer;
  write: (write: ColumnScaleWrite) => void;
};

export const createColumnScaleCell = (device: GPUDevice) =>
  createResourceCell({
    create: (windowCount: number): ColumnScale => {
      const scales = new Float32Array(Math.max(1, windowCount)).fill(1);
      const buffer = device.createBuffer({
        label: 'spectrogram-column-scale-buffer',
        size: scales.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, scales);
      let written: Written | undefined = undefined;

      return {
        buffer,
        write: (next) => {
          if (isWritten(written, next)) {
            return;
          }
          written = { ...next, length: next.source.length };
          for (let index = 0; index < windowCount; index += 1) {
            const column = next.baseColumn + index;
            const shift =
              next.transposeSemitones -
              next.source.transposeAt(column * next.columnStep);
            scales[floorMod(column, windowCount)] = 2 ** (shift / 12);
          }
          device.queue.writeBuffer(buffer, 0, scales);
        },
      };
    },
    dispose: (scale) => {
      scale.buffer.destroy();
    },
    equals: (current, next) => current === next,
  });
