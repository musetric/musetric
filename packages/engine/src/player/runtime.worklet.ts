import { type StemType } from '@musetric/audio/es';
import { createTimePitchProcessor } from '@musetric/audio/player';
import { createHeardPosition } from './heardPosition.worklet.js';
import { createLeadVoice } from './leadVoice.worklet.js';
import { createMetronome } from './metronome.worklet.js';
import {
  createRangeFrames,
  processRangeMetronome,
  type RangeFrames,
} from './playerRange.worklet.js';
import {
  accompanimentMask,
  allStemsMask,
  createPlayerTracks,
} from './playerTracks.worklet.js';
import { createHeldPlayheadValue } from './playhead.cross.js';
import {
  createPlayheadPublisher,
  type PlayheadPublisher,
} from './playhead.worklet.js';
import {
  type playerChannel,
  type playerDataChannel,
} from './protocol.cross.js';
import {
  createRecordingRuntime,
  type LatencyFrameCounts,
  type RecordingRuntime,
} from './recording.worklet.js';
import { createRecordingTrack } from './recordingTrack.worklet.js';

export type CreatePlayerRuntimeOptions = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>;
  playheadPorts: MessagePort[];
  sampleRate: number;
  stretch: Parameters<typeof createTimePitchProcessor>[0];
  getCurrentTime: () => number;
  getCurrentFrame: () => number;
};

export type PlayerRuntime = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  process: (inputs: Float32Array[][], outputs: Float32Array[]) => void;
};

export const createPlayerRuntime = (
  options: CreatePlayerRuntimeOptions,
): PlayerRuntime => {
  const { port, dataPort, sampleRate, stretch } = options;
  const playhead: PlayheadPublisher = createPlayheadPublisher(
    options.playheadPorts,
    options.getCurrentTime,
  );

  let frameCount = 0;
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
  const timePitchProcessor = createTimePitchProcessor(stretch, sampleRate);
  const leadVoice = createLeadVoice(stretch, sampleRate);
  const recordingTrack = createRecordingTrack(stretch, sampleRate);
  let range: RangeFrames | undefined = undefined;
  const position = createHeardPosition(() => range);
  const tracks = createPlayerTracks(stretch, dataPort, () => range);

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

  const refillTimePitch = () => {
    timePitchProcessor.refill();
    leadVoice.refill();
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
      tracks.mount(message.layouts);
      refillTimePitch();
      recordingTrack.clear();
      recordingTrack.setPieces({ pieces: message.recording });
      position.begin(0);
      playing = false;
      recordingRuntime.resetInputOffset();
      publishHeld();
      setPlaying();
      tracks.requestWindow(0, true);
    },
    putPage: (message) => {
      tracks.put(message);
    },
    dropPages: (message) => {
      tracks.drop(message.pages);
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
      tracks.release();
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
      if (!tracks.mounted()) {
        setPlaying();
        return;
      }

      applyLatencyFrameCounts(message);
      metronome.reset(position.getFrameIndex());
      playing = true;
      recordingRuntime.resetInputOffset();
      setPlaying();
    },
    stop: (message) => {
      revision = message.revision;
      playing = false;
      position.begin(message.frameIndex);
      metronome.clear();
      publishHeld();
      setPlaying();
      tracks.requestWindow(message.frameIndex, true);
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
      tracks.requestWindow(message.frameIndex, true);
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
      refillTimePitch();
    },
    setTempoRatio: (message) => {
      tempoRatio = message.tempoRatio;
      timePitchProcessor.setTempoRatio(message.tempoRatio);
      leadVoice.setTempoRatio(message.tempoRatio);
    },
    setTrackVolume: (message) => {
      trackVolumes[message.stemType] = message.volume;
      tracks.setVolumes(trackVolumes);
      refillTimePitch();
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
      tracks.setRange(range);
      refillTimePitch();
      tracks.requestWindow(position.getFrameIndex(), true);
    },
    startRecording: (message) => {
      revision = message.revision;
      recordingRuntime.start(message);
    },
    flushRecording: () => {
      recordingRuntime.drain();
    },
  });

  return {
    port,
    process: (inputs, outputs) => {
      for (const output of outputs) {
        output.fill(0);
      }

      if (!tracks.mounted() || !playing) {
        recordingRuntime.processDrain(inputs);
        return;
      }

      const contextFrame = options.getCurrentFrame();
      const outputFrameCount = outputs[0].length;
      const getValue = () =>
        position.getValue({ revision, clockOffset, frameCount });

      if (frozen) {
        recordingRuntime.processDrain(inputs);
        position.hold(contextFrame, outputFrameCount);
        playhead.publish(getValue());
        return;
      }

      const currentOutputFrameIndex = position.getRenderFrameIndex();
      tracks.requestWindow(currentOutputFrameIndex);
      if (
        !recordingRuntime.isActive() &&
        !tracks.ready(currentOutputFrameIndex)
      ) {
        recordingRuntime.processDrain(inputs);
        position.hold(contextFrame, outputFrameCount);
        playhead.publish(getValue());
        return;
      }

      recordingRuntime.processInput(inputs);

      const leadApart = getVoiceShiftSemitones() !== 0;
      const processedFrameCount = timePitchProcessor.process(
        outputs,
        currentOutputFrameIndex,
        (inputBuffers, inputFrameOffset, inputFrameCount) => {
          tracks.mixInto(
            inputBuffers,
            currentOutputFrameIndex + inputFrameOffset,
            inputFrameCount,
            leadApart ? accompanimentMask : allStemsMask,
          );
        },
      );
      if (leadApart) {
        leadVoice.mixInto({
          outputs,
          outputFrameIndex: currentOutputFrameIndex,
          tracks,
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
