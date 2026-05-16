import { type StemType, stemTypes } from '../../common/stemType.es.js';
import {
  type playerChannel,
  type playerDataChannel,
} from '../protocol.cross.js';
import { createTimePitchProcessor } from '../timePitchProcessor.js';
import { createFrameIndexTracker } from '../trackFrameIndex.js';

export type CreatePlayerRuntimeOptions = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>;
};

export type PlayerRuntime = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  process: (inputs: Float32Array[][], outputs: Float32Array[]) => void;
};

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

const chunkFrameCount = 1024;

export const createPlayerRuntime = async (
  options: CreatePlayerRuntimeOptions,
): Promise<PlayerRuntime> => {
  const { port, dataPort } = options;

  let frameCount = 0;
  let tracks: Record<StemType | 'recording', Float32Array[]> | undefined =
    undefined;
  let frameIndex = 0;
  let playing = false;
  let frozen = false;
  const trackVolumes: Partial<Record<StemType, number>> = {};
  let recordingVolume = 1;
  const frameIndexTracker = createFrameIndexTracker(sampleRate);
  const timePitchProcessor = await createTimePitchProcessor(sampleRate);
  let recordingSamples: Float32Array<SharedArrayBuffer> | undefined = undefined;
  let recordingMetadata: Int32Array<SharedArrayBuffer> | undefined = undefined;
  let recordingOffset = 0;
  let recordingWriteFrameIndex = 0;
  let recordingLatencyFrameCount = 0;
  let recordingBufferFrameIndex = 0;
  let recordingChunkBufferFrameIndex = 0;
  let recordingChunkFrameIndex = 0;
  let recordingSequence = 0;
  let recordingNotificationPort: MessagePort | undefined = undefined;

  const setRecordingWriteFrameIndex = (nextFrameIndex: number) => {
    const compensatedFrameIndex = nextFrameIndex - recordingLatencyFrameCount;
    recordingWriteFrameIndex = compensatedFrameIndex;
    recordingChunkFrameIndex = compensatedFrameIndex;
    recordingChunkBufferFrameIndex = recordingBufferFrameIndex;
  };

  const flushRecordingBuffer = () => {
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

  const pushRecordingSample = (sample: number) => {
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

  const processRecordingInput = (inputs: (Float32Array[] | undefined)[]) => {
    if (!recordingNotificationPort || !playing) {
      return;
    }

    const [input] = inputs;
    const firstChannel = input?.[0];
    const secondChannel = input?.[1];
    if (!firstChannel) {
      return;
    }

    for (let index = 0; index < firstChannel.length; index += 1) {
      const left = firstChannel[index];
      const sample = secondChannel
        ? (left + (index < secondChannel.length ? secondChannel[index] : 0)) *
          0.5
        : left;
      pushRecordingSample(sample);
    }
  };

  dataPort.bindHandlers({
    mount: (message) => {
      frameCount = message.frameCount;
      tracks = message.tracks;
      frameIndex = 0;
      playing = false;
      port.methods.setPlaying({ playing, frameIndex });
    },
    patchRecordingTrack: (message) => {
      const track = tracks?.recording;
      if (!track) {
        return;
      }

      if (message.frameIndex < 0) {
        return;
      }

      for (
        let channelIndex = 0;
        channelIndex < message.channels.length;
        channelIndex += 1
      ) {
        const samples = track[channelIndex];
        const patch = message.channels[channelIndex];
        if (message.frameIndex >= samples.length) {
          continue;
        }

        samples.set(
          patch.subarray(0, samples.length - message.frameIndex),
          message.frameIndex,
        );
      }
    },
    unmount: () => {
      frameCount = 0;
      tracks = undefined;
      frameIndex = 0;
      playing = false;
      frameIndexTracker.reset();
      timePitchProcessor.reset();
      port.methods.setPlaying({ playing, frameIndex });
    },
  });

  port.bindHandlers({
    play: () => {
      if (!tracks) {
        return;
      }

      playing = true;
      port.methods.setPlaying({ playing, frameIndex });
    },
    pause: () => {
      playing = false;
      frameIndexTracker.reset();
      port.methods.setPlaying({ playing, frameIndex });
    },
    setFrozen: (message) => {
      frozen = message.frozen;
      frameIndexTracker.reset();
      timePitchProcessor.reset();
    },
    seek: (message) => {
      frameIndex = message.frameIndex;
      if (recordingNotificationPort) {
        flushRecordingBuffer();
        setRecordingWriteFrameIndex(message.frameIndex);
      }
      frameIndexTracker.reset();
      timePitchProcessor.reset();
      port.methods.setFrameIndex({ frameIndex, positionJump: true });
    },
    setTransposeSemitones: (message) => {
      timePitchProcessor.setTransposeSemitones(message.transposeSemitones);
    },
    setTempoRatio: (message) => {
      timePitchProcessor.setTempoRatio(message.tempoRatio);
    },
    setTrackVolume: (message) => {
      trackVolumes[message.stemType] = message.volume;
    },
    setRecordingVolume: (message) => {
      recordingVolume = message.volume;
    },
    startRecording: (message) => {
      flushRecordingBuffer();
      recordingSamples = message.samples;
      recordingMetadata = message.metadata;
      recordingNotificationPort = message.notificationPort;
      recordingLatencyFrameCount = message.latencyFrameCount;
      recordingBufferFrameIndex = 0;
      recordingOffset = 0;
      recordingSequence = 0;
      setRecordingWriteFrameIndex(message.frameIndex);
      Atomics.store(recordingMetadata, 0, recordingBufferFrameIndex);
    },
    seekRecording: (message) => {
      flushRecordingBuffer();
      setRecordingWriteFrameIndex(message.frameIndex);
    },
    flushRecording: () => {
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
      port.methods.recordingFlushed({
        sequence,
      });
    },
  });

  return {
    port,
    process: (inputs, outputs) => {
      for (const output of outputs) {
        output.fill(0);
      }

      if (!tracks || !playing || frozen) {
        return;
      }

      processRecordingInput(inputs);

      const currentTracks = tracks;
      frameIndex += timePitchProcessor.process(
        outputs,
        (inputBuffers, inputFrameOffset, inputFrameCount) => {
          for (const stemType of stemTypes) {
            const track = currentTracks[stemType];
            const volume = trackVolumes[stemType] ?? 1;

            for (
              let channelIndex = 0;
              channelIndex < outputs.length;
              channelIndex += 1
            ) {
              const input = inputBuffers[channelIndex];
              const samples = track[channelIndex];
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              if (!samples) {
                continue;
              }

              for (let offset = 0; offset < inputFrameCount; offset += 1) {
                const sample =
                  samples[frameIndex + inputFrameOffset + offset] ?? 0;
                input[offset] += sample * volume;
              }
            }
          }

          const recordingTrack = tracks?.recording;
          if (recordingTrack) {
            for (
              let channelIndex = 0;
              channelIndex < outputs.length;
              channelIndex += 1
            ) {
              const input = inputBuffers[channelIndex];
              const samples = recordingTrack[channelIndex];
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              if (!samples) {
                continue;
              }

              for (let offset = 0; offset < inputFrameCount; offset += 1) {
                const sample =
                  samples[frameIndex + inputFrameOffset + offset] ?? 0;
                input[offset] += sample * recordingVolume;
              }
            }
          }
        },
      );

      if (frameIndex >= frameCount) {
        frameIndex = 0;
        playing = false;
        frameIndexTracker.reset();
        timePitchProcessor.reset();
        port.methods.setPlaying({ playing, frameIndex, positionJump: true });
        return;
      }

      if (frameIndexTracker.advance(outputs[0].length)) {
        port.methods.setFrameIndex({ frameIndex });
      }
    },
  };
};
