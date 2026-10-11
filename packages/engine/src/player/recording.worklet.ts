import { type playerChannel } from './protocol.cross.js';
import { recordingStreamChannel } from './recordingStream.cross.js';

export const chunkFrameCount = 256;

export type LatencyFrameCounts = {
  latencyFrameCount: number;
  inputLatencyFrameCount: number;
};

export type StartRecordingMessage = {
  frameIndex: number;
  revision: number;
  latencyFrameCount: number;
  inputLatencyFrameCount: number;
  notificationPort: MessagePort;
};

export type RecordingStreamPort = ReturnType<
  typeof recordingStreamChannel.inbound<MessagePort>
>;

export type RecordingRuntimePort = ReturnType<
  typeof playerChannel.inbound<MessagePort>
>;

export type CreateRecordingRuntimeOptions = {
  port: RecordingRuntimePort;
  getPlaying: () => boolean;
  getInputLatencyFrameCount: () => number;
  getOutputLatencyFrameCount: () => number;
  getTempoRatio: () => number;
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
    getTempoRatio,
    applyLatencyFrameCounts,
  } = options;

  const chunkSamples = new Float32Array(chunkFrameCount);
  let recordingOffset = 0;
  let runStartFrame = 0;
  let runWriteOffset = 0;
  let runChunkOffset = 0;
  let recordingSequence = 0;
  let recordingNotificationPort: RecordingStreamPort | undefined = undefined;
  let inputOffsetFrameIndex = 0;
  let leadInFrameCount = 0;

  const startRun = (nextFrameIndex: number) => {
    const outputLatencyFrameCount = getOutputLatencyFrameCount();
    leadInFrameCount = Math.ceil(outputLatencyFrameCount);
    runStartFrame = Math.round(
      nextFrameIndex +
        (leadInFrameCount - outputLatencyFrameCount) * getTempoRatio(),
    );
    runWriteOffset = 0;
    runChunkOffset = 0;
  };

  const flushRecordingBuffer = (): number => {
    if (recordingOffset === 0) {
      return recordingSequence;
    }

    recordingSequence += 1;
    recordingNotificationPort?.methods.chunk({
      sequence: recordingSequence,
      startFrame: runStartFrame,
      offset: runChunkOffset,
      samples: chunkSamples.slice(0, recordingOffset),
    });
    recordingOffset = 0;
    runChunkOffset = runWriteOffset;
    return recordingSequence;
  };

  const pushRecordingSample = (sample: number): void => {
    if (leadInFrameCount > 0) {
      leadInFrameCount -= 1;
      return;
    }
    chunkSamples[recordingOffset] = Math.max(-1, Math.min(1, sample));
    recordingOffset += 1;
    runWriteOffset += 1;

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
      recordingNotificationPort = recordingStreamChannel.inbound(
        message.notificationPort,
      );
      applyLatencyFrameCounts(message);
      recordingOffset = 0;
      recordingSequence = 0;
      inputOffsetFrameIndex = 0;
      startRun(message.frameIndex);
    },
    flush: (): number => {
      const sequence = flushRecordingBuffer() + 1;
      recordingSequence = sequence;
      recordingNotificationPort?.methods.flush({ sequence });
      recordingNotificationPort = undefined;
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
      startRun(frameIndex);
    },
    resetInputOffset: () => {
      inputOffsetFrameIndex = 0;
    },
    isActive: () => recordingNotificationPort !== undefined,
  };
};
