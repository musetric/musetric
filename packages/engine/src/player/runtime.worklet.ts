import { type StemType, stemTypes } from '@musetric/audio/es';
import { createTimePitchProcessor } from '@musetric/audio/player';
import { createMetronome } from './metronome.worklet.js';
import { type Playhead, writePlayhead } from './playhead.cross.js';
import {
  type playerChannel,
  type playerDataChannel,
} from './protocol.cross.js';
import {
  createRecordingRuntime,
  type LatencyFrameCounts,
  type RecordingRuntime,
} from './recording.worklet.js';

export type CreatePlayerRuntimeOptions = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>;
  playhead: Playhead;
};

export type PlayerRuntime = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  process: (inputs: Float32Array[][], outputs: Float32Array[]) => void;
};

export const createPlayerRuntime = async (
  options: CreatePlayerRuntimeOptions,
): Promise<PlayerRuntime> => {
  const { port, dataPort, playhead } = options;

  let frameCount = 0;
  let tracks: Record<StemType | 'recording', Float32Array[]> | undefined =
    undefined;
  let frameIndex = 0;
  let revision = 0;
  let playing = false;
  let frozen = false;
  let latencyFrameCount = 0;
  let inputLatencyFrameCount = 0;
  let outputLatencyFrameCount = 0;
  let outputOffsetFrameIndex = 0;
  const trackVolumes: Partial<Record<StemType, number>> = {};
  let recordingVolume = 1;
  const metronome = createMetronome(sampleRate);
  const timePitchProcessor = await createTimePitchProcessor(sampleRate);

  const applyLatencyFrameCounts = (counts: LatencyFrameCounts) => {
    latencyFrameCount = Math.max(0, counts.latencyFrameCount);
    inputLatencyFrameCount = Math.max(0, counts.inputLatencyFrameCount);
    outputLatencyFrameCount = Math.max(
      0,
      latencyFrameCount - inputLatencyFrameCount,
    );
  };

  const recordingRuntime: RecordingRuntime = createRecordingRuntime({
    port,
    getPlaying: () => playing,
    getInputLatencyFrameCount: () => inputLatencyFrameCount,
    getOutputLatencyFrameCount: () => outputLatencyFrameCount,
    applyLatencyFrameCounts,
  });

  const advanceOffsetFrameIndex = (
    offsetFrameIndex: number,
    limitFrameCount: number,
    advanceFrameCount: number,
  ) => {
    if (offsetFrameIndex >= limitFrameCount) {
      return {
        offsetFrameIndex: limitFrameCount,
        remainingFrameCount: advanceFrameCount,
      };
    }

    const offsetRemainingFrameCount = limitFrameCount - offsetFrameIndex;
    if (advanceFrameCount <= offsetRemainingFrameCount) {
      return {
        offsetFrameIndex: offsetFrameIndex + advanceFrameCount,
        remainingFrameCount: 0,
      };
    }

    return {
      offsetFrameIndex: limitFrameCount,
      remainingFrameCount: advanceFrameCount - offsetRemainingFrameCount,
    };
  };

  const getAdvancedFrameCount = (
    processedFrameCount: number,
    outputFrameCount: number,
    remainingOutputFrameCount: number,
  ) => {
    if (remainingOutputFrameCount === outputFrameCount) {
      return processedFrameCount;
    }
    if (remainingOutputFrameCount === 0 || outputFrameCount === 0) {
      return 0;
    }
    return Math.round(
      (processedFrameCount * remainingOutputFrameCount) / outputFrameCount,
    );
  };

  const getCurrentOutputFrameIndex = () => {
    return frameIndex + outputOffsetFrameIndex;
  };

  dataPort.bindHandlers({
    mount: (message) => {
      frameCount = message.frameCount;
      tracks = message.tracks;
      frameIndex = 0;
      outputOffsetFrameIndex = 0;
      playing = false;
      recordingRuntime.resetInputOffset();
      writePlayhead(playhead, frameIndex, revision);
      port.methods.setPlaying({ playing, frameIndex, revision });
    },
    unmount: () => {
      frameCount = 0;
      tracks = undefined;
      frameIndex = 0;
      outputOffsetFrameIndex = 0;
      playing = false;
      recordingRuntime.resetInputOffset();
      timePitchProcessor.reset();
      writePlayhead(playhead, frameIndex, revision);
      port.methods.setPlaying({ playing, frameIndex, revision });
    },
  });

  port.bindHandlers({
    play: (message) => {
      revision = message.revision;
      if (!tracks) {
        port.methods.setPlaying({ playing, frameIndex, revision });
        return;
      }

      applyLatencyFrameCounts(message);
      outputOffsetFrameIndex = 0;
      playing = true;
      recordingRuntime.resetInputOffset();
      port.methods.setPlaying({ playing, frameIndex, revision });
    },
    stop: (message) => {
      revision = message.revision;
      playing = false;
      metronome.clear();
      writePlayhead(playhead, frameIndex, revision);
      port.methods.setPlaying({ playing, frameIndex, revision });
    },
    setFrozen: (message) => {
      frozen = message.frozen;
      timePitchProcessor.reset();
    },
    seek: (message) => {
      revision = message.revision;
      frameIndex = message.frameIndex;
      outputOffsetFrameIndex = 0;
      if (recordingRuntime.isActive()) {
        recordingRuntime.handleSeek(message.frameIndex);
      }
      timePitchProcessor.reset();
      metronome.reset(message.frameIndex);
      metronome.clear();
      writePlayhead(playhead, frameIndex, revision);
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
    setMetronome: (message) => {
      metronome.setConfig(message, frameIndex);
    },
    startRecording: (message) => {
      revision = message.revision;
      recordingRuntime.start(message);
    },
    flushRecording: () => {
      recordingRuntime.flush();
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

      recordingRuntime.processInput(inputs);

      const currentTracks = tracks;
      const outputFrameCount = outputs[0].length;
      const currentOutputFrameIndex = getCurrentOutputFrameIndex();
      const oldFrameIndex = frameIndex;
      const processedFrameCount = timePitchProcessor.process(
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
                  samples[
                    currentOutputFrameIndex + inputFrameOffset + offset
                  ] ?? 0;
                input[offset] += sample * volume;
              }
            }
          }

          const recordingTrack = recordingRuntime.isActive()
            ? undefined
            : tracks?.recording;
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
                  samples[
                    currentOutputFrameIndex + inputFrameOffset + offset
                  ] ?? 0;
                input[offset] += sample * recordingVolume;
              }
            }
          }
        },
      );

      const outputAdvance = advanceOffsetFrameIndex(
        outputOffsetFrameIndex,
        outputLatencyFrameCount,
        outputFrameCount,
      );
      outputOffsetFrameIndex = outputAdvance.offsetFrameIndex;
      frameIndex += getAdvancedFrameCount(
        processedFrameCount,
        outputFrameCount,
        outputAdvance.remainingFrameCount,
      );

      metronome.process({
        oldFrameIndex,
        newFrameIndex: frameIndex,
        outputs,
        outputFrameCount,
      });

      if (frameIndex >= frameCount) {
        frameIndex = 0;
        outputOffsetFrameIndex = 0;
        playing = false;
        recordingRuntime.resetInputOffset();
        timePitchProcessor.reset();
        metronome.reset(0);
        metronome.clear();
        writePlayhead(playhead, frameIndex, revision);
        port.methods.setPlaying({
          playing,
          frameIndex,
          revision,
          positionJump: true,
        });
        return;
      }

      writePlayhead(playhead, frameIndex, revision);
    },
  };
};
