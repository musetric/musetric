import { type playerChannel } from './protocol.cross.js';

export const chunkFrameCount = 256;

type RecordingStreamMessage =
  | {
      type: 'chunk';
      sequence: number;
      frameIndex: number;
      bufferFrameIndex: number;
      bufferOffset: number;
      frameCount: number;
    }
  | { type: 'flush'; sequence: number };

export type LatencyFrameCounts = {
  latencyFrameCount: number;
  inputLatencyFrameCount: number;
};

export type StartRecordingMessage = {
  frameIndex: number;
  revision: number;
  latencyFrameCount: number;
  inputLatencyFrameCount: number;
  samples: Float32Array<SharedArrayBuffer>;
  metadata: Int32Array<SharedArrayBuffer>;
  notificationPort: MessagePort;
};

export type RecordingRuntimePort = ReturnType<
  typeof playerChannel.inbound<MessagePort>
>;

export type CreateRecordingRuntimeOptions = {
  port: RecordingRuntimePort;
  getPlaying: () => boolean;
  getInputLatencyFrameCount: () => number;
  getOutputLatencyFrameCount: () => number;
  applyLatencyFrameCounts: (counts: LatencyFrameCounts) => void;
};

export type RecordingRuntime = {
  processInput: (inputs: (Float32Array[] | undefined)[]) => void;
  start: (message: StartRecordingMessage) => void;
  flush: () => number;
  handleSeek: (frameIndex: number) => void;
  resetInputOffset: () => void;
  isActive: () => boolean;
};

export const createRecordingRuntime = (
  options: CreateRecordingRuntimeOptions,
): RecordingRuntime => {
  const {
    port,
    getPlaying,
    getInputLatencyFrameCount,
    getOutputLatencyFrameCount,
    applyLatencyFrameCounts,
  } = options;

  let recordingSamples: Float32Array<SharedArrayBuffer> | undefined = undefined;
  let recordingMetadata: Int32Array<SharedArrayBuffer> | undefined = undefined;
  let recordingOffset = 0;
  let recordingWriteFrameIndex = 0;
  let recordingBufferFrameIndex = 0;
  let recordingChunkBufferFrameIndex = 0;
  let recordingChunkFrameIndex = 0;
  let recordingSequence = 0;
  let recordingNotificationPort: MessagePort | undefined = undefined;
  let inputOffsetFrameIndex = 0;

  const setRecordingWriteFrameIndex = (nextFrameIndex: number) => {
    const compensatedFrameIndex = nextFrameIndex - getOutputLatencyFrameCount();
    recordingWriteFrameIndex = compensatedFrameIndex;
    recordingChunkFrameIndex = compensatedFrameIndex;
    recordingChunkBufferFrameIndex = recordingBufferFrameIndex;
  };

  const flushRecordingBuffer = (): number => {
    if (recordingOffset === 0) {
      return recordingSequence;
    }

    recordingSequence += 1;
    recordingNotificationPort?.postMessage({
      type: 'chunk',
      sequence: recordingSequence,
      frameIndex: recordingChunkFrameIndex,
      bufferFrameIndex: recordingChunkBufferFrameIndex,
      bufferOffset:
        recordingSamples && recordingSamples.length > 0
          ? recordingChunkBufferFrameIndex % recordingSamples.length
          : 0,
      frameCount: recordingOffset,
    } satisfies RecordingStreamMessage);
    recordingOffset = 0;
    recordingChunkFrameIndex = recordingWriteFrameIndex;
    recordingChunkBufferFrameIndex = recordingBufferFrameIndex;
    return recordingSequence;
  };

  const pushRecordingSample = (sample: number): void => {
    if (!recordingSamples || !recordingMetadata) {
      return;
    }

    const clamped = Math.max(-1, Math.min(1, sample));
    recordingSamples[recordingBufferFrameIndex % recordingSamples.length] =
      clamped;
    recordingOffset += 1;
    recordingWriteFrameIndex += 1;
    recordingBufferFrameIndex += 1;
    Atomics.store(recordingMetadata, 0, recordingBufferFrameIndex);

    if (recordingOffset === chunkFrameCount) {
      flushRecordingBuffer();
    }
  };

  const processRecordingInput = (
    inputs: (Float32Array[] | undefined)[],
  ): void => {
    if (!recordingNotificationPort || !getPlaying()) {
      return;
    }

    const [input] = inputs;
    const firstChannel = input?.[0];
    const secondChannel = input?.[1];
    if (!firstChannel) {
      return;
    }

    const skippedFrameCount = Math.min(
      firstChannel.length,
      Math.max(0, getInputLatencyFrameCount() - inputOffsetFrameIndex),
    );
    inputOffsetFrameIndex += skippedFrameCount;

    for (
      let index = skippedFrameCount;
      index < firstChannel.length;
      index += 1
    ) {
      const left = firstChannel[index];
      const sample = secondChannel
        ? (left + (index < secondChannel.length ? secondChannel[index] : 0)) *
          0.5
        : left;
      pushRecordingSample(sample);
    }
  };

  return {
    processInput: processRecordingInput,
    start: (message) => {
      flushRecordingBuffer();
      recordingSamples = message.samples;
      recordingMetadata = message.metadata;
      recordingNotificationPort = message.notificationPort;
      applyLatencyFrameCounts(message);
      recordingBufferFrameIndex = 0;
      recordingOffset = 0;
      recordingSequence = 0;
      inputOffsetFrameIndex = 0;
      setRecordingWriteFrameIndex(message.frameIndex);
      Atomics.store(recordingMetadata, 0, recordingBufferFrameIndex);
    },
    flush: (): number => {
      const sequence = flushRecordingBuffer() + 1;
      recordingSequence = sequence;
      recordingNotificationPort?.postMessage({
        type: 'flush',
        sequence,
      } satisfies RecordingStreamMessage);
      recordingNotificationPort = undefined;
      recordingSamples = undefined;
      recordingMetadata = undefined;
      recordingOffset = 0;
      inputOffsetFrameIndex = 0;
      port.methods.recordingFlushed({
        sequence,
      });
      return sequence;
    },
    handleSeek: (frameIndex) => {
      flushRecordingBuffer();
      inputOffsetFrameIndex = 0;
      setRecordingWriteFrameIndex(frameIndex);
    },
    resetInputOffset: () => {
      inputOffsetFrameIndex = 0;
    },
    isActive: () => recordingNotificationPort !== undefined,
  };
};
