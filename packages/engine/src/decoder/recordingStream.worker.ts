import { type recordingStreamChannel } from '../player/recordingStream.cross.js';

export const recordingPacketHeaderByteLength = 8;

type ControlledPromise = {
  promise: Promise<void>;
  resolve: () => void;
};

const createControlledPromise = (): ControlledPromise => {
  const { promise, resolve: resolveFn } = Promise.withResolvers<void>();
  return {
    promise,
    resolve: () => resolveFn(),
  };
};

export const createRecordingPacket = (
  frameIndex: number,
  samples: Float32Array,
): ArrayBuffer => {
  const packet = new ArrayBuffer(
    recordingPacketHeaderByteLength + samples.byteLength,
  );
  const view = new DataView(packet);
  view.setUint32(0, frameIndex, true);
  view.setUint32(4, samples.length, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setFloat32(
      recordingPacketHeaderByteLength + index * Float32Array.BYTES_PER_ELEMENT,
      samples[index],
      true,
    );
  }
  return packet;
};

type FlushWaiter = {
  sequence: number;
  resolve: () => void;
};

const resolveFlushWaiters = (
  processedFlushSequence: number,
  waiters: FlushWaiter[],
): FlushWaiter[] => {
  const remaining: FlushWaiter[] = [];
  for (const waiter of waiters) {
    if (processedFlushSequence >= waiter.sequence) {
      waiter.resolve();
      continue;
    }
    remaining.push(waiter);
  }
  return remaining;
};

type ChunkSamples = { frameIndex: number; samples: Float32Array };

export type RecordingStreamOptions = {
  port: ReturnType<typeof recordingStreamChannel.outbound<MessagePort>>;
  onChunk: (chunk: ChunkSamples) => void;
};

export type RecordingStream = {
  start: Promise<void>;
  finish: Promise<void>;
  notifyStarted: () => void;
  notifyFinished: () => void;
  waitForFlush: (sequence: number) => Promise<void>;
  close: () => void;
};

export const createRecordingStream = (
  options: RecordingStreamOptions,
): RecordingStream => {
  const { port, onChunk } = options;
  const start = createControlledPromise();
  const finish = createControlledPromise();
  let processedFlushSequence = 0;
  let flushWaiters: FlushWaiter[] = [];
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    port.instance.close();
    start.resolve();
    finish.resolve();
    for (const waiter of flushWaiters) {
      waiter.resolve();
    }
    flushWaiters = [];
  };

  port.bindHandlers({
    flush: (message) => {
      processedFlushSequence = Math.max(
        processedFlushSequence,
        message.sequence,
      );
      flushWaiters = resolveFlushWaiters(processedFlushSequence, flushWaiters);
    },
    chunk: (message) => {
      const skippedFrameCount = Math.max(0, -message.frameIndex);
      const alignedSamples = message.samples.subarray(skippedFrameCount);
      if (alignedSamples.length === 0) {
        return;
      }
      onChunk({
        frameIndex: Math.max(0, message.frameIndex),
        samples: alignedSamples,
      });
    },
  });

  port.instance.start();

  return {
    start: start.promise,
    finish: finish.promise,
    notifyStarted: () => {
      start.resolve();
    },
    notifyFinished: () => {
      finish.resolve();
    },
    waitForFlush: async (sequence) => {
      if (processedFlushSequence >= sequence) {
        return;
      }
      await new Promise<void>((resolve) => {
        flushWaiters.push({ sequence, resolve });
      });
    },
    close,
  };
};
