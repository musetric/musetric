import { type LiveTakeChunk } from '../player/protocol.cross.js';
import { type recordingStreamChannel } from '../player/recordingStream.cross.js';

const recordingPacketHeaderByteLength = 12;

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

export const createRecordingPacket = (chunk: LiveTakeChunk): ArrayBuffer => {
  const { samples } = chunk;
  const packet = new ArrayBuffer(
    recordingPacketHeaderByteLength + samples.byteLength,
  );
  const view = new DataView(packet);
  view.setUint32(0, chunk.startFrame, true);
  view.setUint32(4, chunk.offset, true);
  view.setUint32(8, samples.length, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setFloat32(
      recordingPacketHeaderByteLength + index * Float32Array.BYTES_PER_ELEMENT,
      samples[index],
      true,
    );
  }
  return packet;
};

export const readRecordingPacket = (data: ArrayBuffer): LiveTakeChunk => {
  if (data.byteLength < recordingPacketHeaderByteLength) {
    throw new Error('Project realtime packet is missing a header');
  }
  const view = new DataView(data);
  const frameCount = view.getUint32(8, true);
  const byteLength = frameCount * Float32Array.BYTES_PER_ELEMENT;
  if (data.byteLength !== recordingPacketHeaderByteLength + byteLength) {
    throw new Error('Project realtime packet has invalid byte length');
  }
  return {
    startFrame: view.getUint32(0, true),
    offset: view.getUint32(4, true),
    samples: new Float32Array(
      data,
      recordingPacketHeaderByteLength,
      frameCount,
    ),
  };
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

export type RecordingStreamOptions = {
  port: ReturnType<typeof recordingStreamChannel.outbound<MessagePort>>;
  onChunk: (chunk: LiveTakeChunk) => void;
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
      onChunk({
        startFrame: message.startFrame,
        offset: message.offset,
        samples: message.samples,
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
