import { type playerChannel, type PlayerRange } from './protocol.cross.js';
import { recordingStreamChannel } from './recordingStream.cross.js';

export const chunkFrameCount = 256;
const renderQuantumFrameCount = 128;

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
  pass?: boolean;
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
  getFrameIndex: () => number;
  getInputLatencyFrameCount: () => number;
  getPendingOutputFrameCount: () => number;
  getTempoRatio: () => number;
  getLoop: () => PlayerRange | undefined;
  applyLatencyFrameCounts: (counts: LatencyFrameCounts) => void;
};

export type RecordingRuntime = {
  processInput: (inputs: (Float32Array[] | undefined)[]) => void;
  processDrain: (inputs: (Float32Array[] | undefined)[]) => void;
  start: (message: StartRecordingMessage) => void;
  drain: () => void;
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
    getFrameIndex,
    getInputLatencyFrameCount,
    getPendingOutputFrameCount,
    getTempoRatio,
    getLoop,
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
  let inputSkipFrameCount = 0;
  let leadInFrameCount = 0;
  let pass = false;
  let passShift = 0;
  let passState: 'waiting' | 'writing' | 'ended' = 'waiting';
  let runEndOffset = Number.POSITIVE_INFINITY;
  let drainFrameCount: number | undefined = undefined;

  const resetInputOffset = () => {
    inputOffsetFrameIndex = 0;
    inputSkipFrameCount = getInputLatencyFrameCount();
  };

  const findPass = (nextFrameIndex: number) => {
    const loop = getLoop();
    if (!loop) {
      return undefined;
    }
    const length = loop.toFrame - loop.fromFrame;
    if (length <= 0) {
      return undefined;
    }
    let shift = 0;
    while (loop.fromFrame + shift < nextFrameIndex) {
      shift += length;
    }
    return {
      fromFrame: loop.fromFrame + shift,
      toFrame: loop.toFrame + shift,
      shift,
    };
  };

  const startRun = (nextFrameIndex: number) => {
    const pendingOutputFrameCount = getPendingOutputFrameCount();
    const tempoRatio = getTempoRatio();
    const target = pass ? findPass(nextFrameIndex) : undefined;
    const punchInFrameCount = target
      ? Math.max(0, Math.ceil((target.fromFrame - nextFrameIndex) / tempoRatio))
      : 0;
    leadInFrameCount = Math.ceil(pendingOutputFrameCount) + punchInFrameCount;
    runStartFrame = Math.round(
      nextFrameIndex +
        (leadInFrameCount - pendingOutputFrameCount) * tempoRatio,
    );
    runWriteOffset = 0;
    runChunkOffset = 0;
    passShift = target?.shift ?? 0;
    runEndOffset = target
      ? Math.max(0, Math.floor((target.toFrame - runStartFrame) / tempoRatio))
      : Number.POSITIVE_INFINITY;
  };

  const flushRecordingBuffer = (): number => {
    if (recordingOffset === 0) {
      return recordingSequence;
    }

    recordingSequence += 1;
    recordingNotificationPort?.methods.chunk({
      sequence: recordingSequence,
      startFrame: runStartFrame - passShift,
      offset: runChunkOffset,
      samples: chunkSamples.slice(0, recordingOffset),
    });
    recordingOffset = 0;
    runChunkOffset = runWriteOffset;
    return recordingSequence;
  };

  const endPass = (complete: boolean) => {
    if (!pass || passState === 'ended') {
      return;
    }
    passState = 'ended';
    flushRecordingBuffer();
    port.methods.recordingPassEnded({ complete });
  };

  const pushRecordingSample = (sample: number): void => {
    if (leadInFrameCount > 0) {
      leadInFrameCount -= 1;
      return;
    }
    if (passState === 'ended') {
      return;
    }
    if (runWriteOffset >= runEndOffset) {
      endPass(true);
      return;
    }
    if (pass && passState === 'waiting') {
      passState = 'writing';
      port.methods.recordingPassStarted();
    }
    chunkSamples[recordingOffset] = Math.max(-1, Math.min(1, sample));
    recordingOffset += 1;
    runWriteOffset += 1;

    if (recordingOffset === chunkFrameCount) {
      flushRecordingBuffer();
    }
  };

  const writeInput = (inputs: (Float32Array[] | undefined)[]): void => {
    const [input] = inputs;
    const firstChannel = input?.[0];
    const secondChannel = input?.[1];
    if (!firstChannel) {
      return;
    }

    const skippedFrameCount = Math.min(
      firstChannel.length,
      Math.max(0, inputSkipFrameCount - inputOffsetFrameIndex),
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

  const flush = (): void => {
    const sequence = flushRecordingBuffer() + 1;
    recordingSequence = sequence;
    recordingNotificationPort?.methods.flush({ sequence });
    recordingNotificationPort = undefined;
    recordingOffset = 0;
    inputOffsetFrameIndex = 0;
    pass = false;
    passShift = 0;
    runEndOffset = Number.POSITIVE_INFINITY;
    drainFrameCount = undefined;
    port.methods.recordingFlushed({
      sequence,
    });
  };

  const countDrain = (inputs: (Float32Array[] | undefined)[]): void => {
    if (drainFrameCount === undefined) {
      return;
    }
    drainFrameCount -= inputs[0]?.[0]?.length ?? renderQuantumFrameCount;
    if (drainFrameCount <= 0) {
      flush();
    }
  };

  return {
    processInput: (inputs) => {
      if (!recordingNotificationPort || !getPlaying()) {
        return;
      }
      writeInput(inputs);
      countDrain(inputs);
    },
    processDrain: (inputs) => {
      if (drainFrameCount === undefined) {
        return;
      }
      writeInput(inputs);
      countDrain(inputs);
    },
    start: (message) => {
      if (drainFrameCount !== undefined) {
        flush();
      }
      flushRecordingBuffer();
      recordingNotificationPort = recordingStreamChannel.inbound(
        message.notificationPort,
      );
      applyLatencyFrameCounts(message);
      recordingOffset = 0;
      recordingSequence = 0;
      resetInputOffset();
      pass = message.pass === true;
      passState = 'waiting';
      startRun(getPlaying() ? getFrameIndex() : message.frameIndex);
    },
    drain: () => {
      if (!recordingNotificationPort) {
        flush();
        return;
      }
      drainFrameCount ??= getInputLatencyFrameCount();
      if (drainFrameCount <= 0) {
        flush();
      }
    },
    handleSeek: (frameIndex) => {
      if (drainFrameCount !== undefined) {
        flush();
        return;
      }
      if (pass) {
        endPass(false);
        return;
      }
      flushRecordingBuffer();
      resetInputOffset();
      startRun(frameIndex);
    },
    resetInputOffset,
    isActive: () => recordingNotificationPort !== undefined,
  };
};
