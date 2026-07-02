import { assertNever } from '@musetric/utils';
import {
  type DecoderRecordingChunkMessage,
  type DecoderRecordingMessage,
} from './protocol.cross.js';

export const recordingPacketHeaderByteLength = 8;

type RecordingChunkMessage = DecoderRecordingChunkMessage;
type ChunkSamples = { frameIndex: number; samples: Float32Array };

export type RecordingStreamOptions = {
  port: MessagePort;
  samples: Float32Array<SharedArrayBuffer>;
  metadata: Int32Array<SharedArrayBuffer>;
  onChunk: (chunk: ChunkSamples) => void;
  onError: (error: unknown) => void;
};

export type RecordingStream = {
  start: Promise<void>;
  finish: Promise<void>;
  notifyStarted: () => void;
  notifyFinished: () => void;
  waitForFlush: (sequence: number) => Promise<void>;
  close: () => void;
};

type FlushWaiter = {
  sequence: number;
  resolve: () => void;
};

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

const readSamplesFromRingBuffer = (
  buffer: Float32Array<SharedArrayBuffer>,
  metadata: Int32Array<SharedArrayBuffer>,
  message: RecordingChunkMessage,
): Float32Array => {
  const currentBufferFrameIndex = Atomics.load(metadata, 0);
  if (currentBufferFrameIndex - message.bufferFrameIndex > buffer.length) {
    throw new Error('Recording ring buffer overflow');
  }
  const samples = new Float32Array(message.frameCount);
  const firstFrameCount = Math.min(
    message.frameCount,
    buffer.length - message.bufferOffset,
  );
  samples.set(
    buffer.subarray(
      message.bufferOffset,
      message.bufferOffset + firstFrameCount,
    ),
  );
  if (firstFrameCount < message.frameCount) {
    samples.set(
      buffer.subarray(0, message.frameCount - firstFrameCount),
      firstFrameCount,
    );
  }
  return samples;
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

export const createRecordingStream = (
  options: RecordingStreamOptions,
): RecordingStream => {
  const { port, samples: sampleBuffer, metadata, onChunk, onError } = options;
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
    port.close();
    start.resolve();
    finish.resolve();
    for (const waiter of flushWaiters) {
      waiter.resolve();
    }
    flushWaiters = [];
  };

  port.onmessage = (event: MessageEvent<DecoderRecordingMessage>) => {
    try {
      const message = event.data;
      if (message.type === 'flush') {
        processedFlushSequence = Math.max(
          processedFlushSequence,
          message.sequence,
        );
        flushWaiters = resolveFlushWaiters(
          processedFlushSequence,
          flushWaiters,
        );
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (message.type === 'chunk') {
        const samples = readSamplesFromRingBuffer(
          sampleBuffer,
          metadata,
          message,
        );
        const skippedFrameCount = Math.max(0, -message.frameIndex);
        const alignedSamples = samples.subarray(skippedFrameCount);
        if (alignedSamples.length === 0) {
          return;
        }
        onChunk({
          frameIndex: Math.max(0, message.frameIndex),
          samples: alignedSamples,
        });
        return;
      }
      assertNever(message, 'Unhandled decoder recording message');
    } catch (error) {
      onError(error);
    }
  };
  port.start();

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
