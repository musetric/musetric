import { roundDuration } from './roundDuration.js';

export type GpuMarkers<Label extends string> = Record<
  Label,
  GPUComputePassTimestampWrites
>;

export type GpuTimer<Label extends string> = {
  markers: GpuMarkers<Label>;
  resolve: (encoder: GPUCommandEncoder) => void;
  read: () => Promise<Record<Label, number>>;
  dispose: () => void;
};

export const createGpuTimer = <Labels extends readonly string[]>(
  device: GPUDevice,
  labels: readonly [...Labels],
): GpuTimer<Labels[number]> => {
  type Label = Labels[number];

  const count = labels.length * 2;
  const size = count * BigUint64Array.BYTES_PER_ELEMENT;

  const querySet = device.createQuerySet({ type: 'timestamp', count });
  const resolveBuffer = device.createBuffer({
    label: 'timer-resolve-buffer',
    size,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const readBuffer = device.createBuffer({
    label: 'timer-read-buffer',
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const markers = labels.reduce(
    (acc, label, i) => {
      const base = i * 2;
      acc[label] = {
        querySet,
        beginningOfPassWriteIndex: base,
        endOfPassWriteIndex: base + 1,
      };
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as GpuMarkers<Label>,
  );

  return {
    markers,
    resolve: (encoder) => {
      encoder.resolveQuerySet(querySet, 0, count, resolveBuffer, 0);
      encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, size);
    },
    read: async () => {
      await readBuffer.mapAsync(GPUMapMode.READ);
      const times = new BigUint64Array(readBuffer.getMappedRange());
      const result = labels.reduce(
        (acc, label, i) => {
          const start = times[i * 2];
          const end = times[i * 2 + 1];
          const duration = Number(end - start) / 1e6;
          acc[label] = roundDuration(duration);
          return acc;
        },
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        {} as Record<Label, number>,
      );
      readBuffer.unmap();
      return result;
    },
    dispose: () => {
      querySet.destroy();
      resolveBuffer.destroy();
      readBuffer.destroy();
    },
  };
};
