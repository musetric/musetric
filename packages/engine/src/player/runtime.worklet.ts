import { type StemType, stemTypes } from '@musetric/audio/es';
import { createTimePitchProcessor } from '@musetric/audio/player';
import { createMetronome } from './metronome.worklet.js';
import {
  createPlayheadPublisher,
  type PlayheadPublisher,
} from './playhead.worklet.js';
import {
  type playerChannel,
  type playerDataChannel,
  type PlayerTracks,
} from './protocol.cross.js';
import {
  createRecordingRuntime,
  type LatencyFrameCounts,
  type RecordingRuntime,
} from './recording.worklet.js';
import { createRecordingTrack } from './recordingTrack.worklet.js';

type MixTrackIntoBuffersOptions = {
  inputBuffers: Float32Array[];
  outputFrameIndex: number;
  inputFrameOffset: number;
  inputFrameCount: number;
  channelCount: number;
  track: Float32Array[] | undefined;
  volume: number;
};

const mixTrackIntoBuffers = (options: MixTrackIntoBuffersOptions) => {
  const {
    inputBuffers,
    outputFrameIndex,
    inputFrameOffset,
    inputFrameCount,
    channelCount,
    track,
    volume,
  } = options;
  if (!track) {
    return;
  }

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const input = inputBuffers[channelIndex];

    const samples = track[channelIndex] ?? track[0];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!samples) {
      continue;
    }

    const frameBase = outputFrameIndex + inputFrameOffset;
    for (let offset = 0; offset < inputFrameCount; offset += 1) {
      const sample = samples[frameBase + offset] ?? 0;
      input[offset] += sample * volume;
    }
  }
};

export type CreatePlayerRuntimeOptions = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>;
  playheadPorts: MessagePort[];
  sampleRate: number;
  getCurrentTime: () => number;
};

export type PlayerRuntime = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  process: (inputs: Float32Array[][], outputs: Float32Array[]) => void;
};

export const createPlayerRuntime = async (
  options: CreatePlayerRuntimeOptions,
): Promise<PlayerRuntime> => {
  const { port, dataPort, sampleRate } = options;
  const playhead: PlayheadPublisher = createPlayheadPublisher(
    options.playheadPorts,
    options.getCurrentTime,
  );

  let frameCount = 0;
  let tracks: PlayerTracks | undefined = undefined;
  let frameIndex = 0;
  let revision = 0;
  let playing = false;
  let frozen = false;
  let latencyFrameCount = 0;
  let inputLatencyFrameCount = 0;
  let outputLatencyFrameCount = 0;
  let outputOffsetFrameIndex = 0;
  let tempoRatio = 1;
  let transposeSemitones = 0;
  const trackVolumes: Partial<Record<StemType, number>> = {};
  let recordingVolume = 1;
  const metronome = createMetronome(sampleRate);
  const timePitchProcessor = await createTimePitchProcessor(sampleRate);
  const recordingTrack = await createRecordingTrack(sampleRate);

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
    getTempoRatio: () => tempoRatio,
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

  const getCurrentOutputFrameIndex = () =>
    frameIndex + Math.round(outputOffsetFrameIndex * tempoRatio);

  dataPort.bindHandlers({
    mount: (message) => {
      frameCount = message.frameCount;
      tracks = message.tracks;
      recordingTrack.clear();
      recordingTrack.setPieces(message.recording);
      frameIndex = 0;
      outputOffsetFrameIndex = 0;
      playing = false;
      recordingRuntime.resetInputOffset();
      playhead.publishNow({ frameIndex, revision });
      port.methods.setPlaying({ playing, frameIndex, revision });
    },
    setRecordingPieces: (message) => {
      recordingTrack.setPieces(message.pieces, message.finishedTakeId);
    },
    beginLiveTake: (message) => {
      recordingTrack.beginLiveTake(message);
    },
    appendLiveTake: (message) => {
      recordingTrack.appendLiveTake(message.frameIndex, message.samples);
    },
    unmount: () => {
      frameCount = 0;
      tracks = undefined;
      recordingTrack.clear();
      frameIndex = 0;
      outputOffsetFrameIndex = 0;
      playing = false;
      recordingRuntime.resetInputOffset();
      timePitchProcessor.reset();
      playhead.publishNow({ frameIndex, revision });
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
      playhead.publishNow({ frameIndex, revision });
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
      playhead.publishNow({ frameIndex, revision });
    },
    setTransposeSemitones: (message) => {
      transposeSemitones = message.transposeSemitones;
      timePitchProcessor.setTransposeSemitones(message.transposeSemitones);
    },
    setTempoRatio: (message) => {
      tempoRatio = message.tempoRatio;
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
          const channelCount = outputs.length;
          const baseOptions = {
            inputBuffers,
            outputFrameIndex: currentOutputFrameIndex,
            inputFrameOffset,
            inputFrameCount,
            channelCount,
          };

          for (const stemType of stemTypes) {
            mixTrackIntoBuffers({
              ...baseOptions,
              track: currentTracks[stemType],
              volume: trackVolumes[stemType] ?? 1,
            });
          }
        },
      );
      if (!recordingRuntime.isActive()) {
        recordingTrack.mixInto({
          outputs,
          songFrame: currentOutputFrameIndex,
          tempoRatio,
          transposeSemitones,
          volume: recordingVolume,
        });
      }

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
        playhead.publishNow({ frameIndex, revision });
        port.methods.setPlaying({
          playing,
          frameIndex,
          revision,
          positionJump: true,
        });
        return;
      }

      playhead.publish({ frameIndex, revision });
    },
  };
};
