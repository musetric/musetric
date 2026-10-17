import { type StemType, stemTypes } from '@musetric/audio/es';
import { createTimePitchProcessor } from '@musetric/audio/player';
import { createHeardPosition } from './heardPosition.worklet.js';
import { createLeadVoice } from './leadVoice.worklet.js';
import { createMetronome } from './metronome.worklet.js';
import { mixTrackIntoBuffers } from './mixTrack.worklet.js';
import {
  createRangeFrames,
  processRangeMetronome,
  type RangeFrames,
} from './playerRange.worklet.js';
import { createHeldPlayheadValue } from './playhead.cross.js';
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

const accompanimentStemTypes = stemTypes.filter(
  (stemType) => stemType !== 'lead',
);

export type CreatePlayerRuntimeOptions = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>;
  playheadPorts: MessagePort[];
  sampleRate: number;
  getCurrentTime: () => number;
  getCurrentFrame: () => number;
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
  let clockOffset: number | undefined = undefined;
  let revision = 0;
  let playing = false;
  let frozen = false;
  let latencyFrameCount = 0;
  let inputLatencyFrameCount = 0;
  let outputLatencyFrameCount = 0;
  let tempoRatio = 1;
  let transposeSemitones = 0;
  let voiceOctave = 0;
  let voiceShifted = false;
  const trackVolumes: Partial<Record<StemType, number>> = {};
  let recordingVolume = 1;
  const metronome = createMetronome(sampleRate);
  const timePitchProcessor = await createTimePitchProcessor(sampleRate);
  const leadVoice = await createLeadVoice(sampleRate);
  const recordingTrack = await createRecordingTrack(sampleRate);
  let range: RangeFrames | undefined = undefined;
  const position = createHeardPosition(() => range);

  const getVoiceShiftSemitones = () => (voiceShifted ? 12 * voiceOctave : 0);

  const applyLeadTranspose = () => {
    leadVoice.setTransposeSemitones(
      transposeSemitones + getVoiceShiftSemitones(),
    );
  };

  const resetTimePitch = () => {
    timePitchProcessor.reset();
    leadVoice.reset();
  };

  const applyLatencyFrameCounts = (counts: LatencyFrameCounts) => {
    latencyFrameCount = Math.max(0, counts.latencyFrameCount);
    inputLatencyFrameCount = Math.max(0, counts.inputLatencyFrameCount);
    outputLatencyFrameCount = Math.max(
      0,
      latencyFrameCount - inputLatencyFrameCount,
    );
    position.setOutputLatency(outputLatencyFrameCount);
    if (playing) {
      position.refresh();
    }
  };

  const publishHeld = () => {
    playhead.publishNow(
      createHeldPlayheadValue(position.getFrameIndex(), revision),
    );
  };

  const setPlaying = (positionJump?: true) => {
    port.methods.setPlaying({
      playing,
      frameIndex: position.getFrameIndex(),
      revision,
      positionJump,
    });
  };

  const recordingRuntime: RecordingRuntime = createRecordingRuntime({
    port,
    getPlaying: () => playing,
    getFrameIndex: () => position.getFrameIndex(),
    getInputLatencyFrameCount: () => inputLatencyFrameCount,
    getPendingOutputFrameCount: () =>
      playing ? position.getPendingOutputFrameCount() : outputLatencyFrameCount,
    getTempoRatio: () => tempoRatio,
    getLoop: () => (range?.repeat === 'cycle' ? range.range : undefined),
    applyLatencyFrameCounts,
  });

  const finishPlayback = (nextFrameIndex: number) => {
    position.begin(nextFrameIndex);
    playing = false;
    recordingRuntime.resetInputOffset();
    resetTimePitch();
    metronome.reset(nextFrameIndex);
    metronome.clear();
    publishHeld();
    setPlaying(true);
  };

  const mixRecording = (
    outputs: Float32Array[],
    currentOutputFrameIndex: number,
  ) => {
    const songFrame = range
      ? range.songFrame(currentOutputFrameIndex)
      : currentOutputFrameIndex;
    if (recordingRuntime.isActive() || (range && songFrame >= range.endFrame)) {
      return;
    }
    recordingTrack.mixInto({
      outputs,
      songFrame,
      tempoRatio,
      transposeSemitones,
      voiceOctave,
      voiceShifted,
      volume: recordingVolume,
    });
  };

  dataPort.bindHandlers({
    mount: (message) => {
      frameCount = message.frameCount;
      tracks = message.tracks;
      recordingTrack.clear();
      recordingTrack.setPieces({ pieces: message.recording });
      position.begin(0);
      playing = false;
      recordingRuntime.resetInputOffset();
      publishHeld();
      setPlaying();
    },
    setRecordingPieces: (message) => {
      recordingTrack.setPieces(message);
    },
    beginLiveTake: (message) => {
      recordingTrack.beginLiveTake(message);
    },
    appendLiveTake: (message) => {
      recordingTrack.appendLiveTake(message);
    },
    unmount: () => {
      frameCount = 0;
      tracks = undefined;
      recordingTrack.clear();
      position.begin(0);
      playing = false;
      recordingRuntime.resetInputOffset();
      resetTimePitch();
      publishHeld();
      setPlaying();
    },
  });

  port.bindHandlers({
    play: (message) => {
      revision = message.revision;
      if (!tracks) {
        setPlaying();
        return;
      }

      applyLatencyFrameCounts(message);
      position.begin(position.getFrameIndex());
      metronome.reset(position.getFrameIndex());
      playing = true;
      recordingRuntime.resetInputOffset();
      setPlaying();
    },
    stop: (message) => {
      revision = message.revision;
      playing = false;
      metronome.clear();
      publishHeld();
      setPlaying();
    },
    setFrozen: (message) => {
      frozen = message.frozen;
      resetTimePitch();
    },
    seek: (message) => {
      revision = message.revision;
      position.begin(message.frameIndex);
      if (recordingRuntime.isActive()) {
        recordingRuntime.handleSeek(message.frameIndex);
      }
      resetTimePitch();
      metronome.reset(message.frameIndex);
      metronome.clear();
      publishHeld();
    },
    setLatency: (message) => {
      applyLatencyFrameCounts(message);
    },
    setOutputClock: (message) => {
      clockOffset = message.clockOffset;
    },
    setTransposeSemitones: (message) => {
      transposeSemitones = message.transposeSemitones;
      timePitchProcessor.setTransposeSemitones(message.transposeSemitones);
      applyLeadTranspose();
    },
    setVoiceOctave: (message) => {
      voiceOctave = message.voiceOctave;
      voiceShifted = message.shifted;
      applyLeadTranspose();
    },
    setTempoRatio: (message) => {
      tempoRatio = message.tempoRatio;
      timePitchProcessor.setTempoRatio(message.tempoRatio);
      leadVoice.setTempoRatio(message.tempoRatio);
    },
    setTrackVolume: (message) => {
      trackVolumes[message.stemType] = message.volume;
    },
    setRecordingVolume: (message) => {
      recordingVolume = message.volume;
    },
    setMetronome: (message) => {
      metronome.setConfig(message, position.getFrameIndex());
    },
    setRange: (message) => {
      range = message.range
        ? createRangeFrames(message.range, message.repeat, message.stopFrame)
        : undefined;
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

      if (!tracks || !playing) {
        return;
      }

      const contextFrame = options.getCurrentFrame();
      const outputFrameCount = outputs[0].length;
      const getValue = () =>
        position.getValue({ revision, clockOffset, frameCount });

      if (frozen) {
        position.hold(contextFrame, outputFrameCount);
        playhead.publish(getValue());
        return;
      }

      recordingRuntime.processInput(inputs);

      const currentTracks = tracks;
      const currentOutputFrameIndex = position.getRenderFrameIndex();
      const leadApart = getVoiceShiftSemitones() !== 0;
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

          for (const stemType of leadApart
            ? accompanimentStemTypes
            : stemTypes) {
            mixTrackIntoBuffers({
              ...baseOptions,
              track: currentTracks[stemType],
              volume: trackVolumes[stemType] ?? 1,
              frames: range,
            });
          }
        },
      );
      if (leadApart) {
        leadVoice.mixInto({
          outputs,
          outputFrameIndex: currentOutputFrameIndex,
          track: currentTracks.lead,
          volume: trackVolumes.lead ?? 1,
          frames: range,
        });
      }
      mixRecording(outputs, currentOutputFrameIndex);

      const nextOutputFrameIndex = position.advance(
        contextFrame,
        outputFrameCount,
        processedFrameCount,
      );
      processRangeMetronome({
        metronome,
        range,
        currentFrameIndex: currentOutputFrameIndex,
        nextFrameIndex: nextOutputFrameIndex,
        outputs,
      });
      const frameIndex = position.getFrameIndex();
      if (range?.repeat === 'once' && frameIndex >= range.endFrame) {
        finishPlayback(range.range.fromFrame);
        return;
      }

      if (frameIndex >= frameCount) {
        finishPlayback(0);
        return;
      }

      playhead.publish(getValue());
    },
  };
};
