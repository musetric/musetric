import { type StemType } from '@musetric/audio/es';
import { type InitOutput } from '@musetric/dsp/stretch';
import { createCuts } from './cutFade.worklet.js';
import { createHeardPosition } from './heardPosition.worklet.js';
import { createMetronome } from './metronome.worklet.js';
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
} from './protocol.cross.js';
import {
  createRecordingRuntime,
  type LatencyFrameCounts,
  type RecordingRuntime,
} from './recording.worklet.js';
import { createPlayerRenderer } from './renderer.worklet.js';
import { createStopGlide } from './stopGlide.worklet.js';

export type CreatePlayerRuntimeOptions = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>;
  playheadPorts: MessagePort[];
  sampleRate: number;
  stretch: InitOutput;
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
  const trackVolumes: Partial<Record<StemType, number>> = {};
  const metronome = createMetronome(sampleRate);
  let range: RangeFrames | undefined = undefined;
  const position = createHeardPosition(() => range);
  let lastContextFrame = 0;
  const renderer = createPlayerRenderer({
    stretch,
    sampleRate,
    dataPort,
    getRange: () => range,
  });
  const cuts = createCuts(() => playing && !frozen && renderer.mounted());

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
  const glide = createStopGlide(playhead, publishHeld);

  const setPlaying = (positionJump?: true) => {
    port.methods.setPlaying({
      playing,
      frameIndex: position.getFrameIndex(),
      revision,
      positionJump,
      glide: glide.active() ? true : undefined,
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
    cuts.fade.mute();
    recordingRuntime.resetInputOffset();
    renderer.reset();
    metronome.reset(nextFrameIndex);
    metronome.clear();
    publishHeld();
    setPlaying(true);
  };

  const applyStop = (stopRevision: number, frameIndex: number) => () => {
    revision = stopRevision;
    const soundEnd =
      playing && !frozen
        ? glide.start(
            position.getValue({ revision, clockOffset, frameCount }),
            position.getRenderFrameIndex(),
            lastContextFrame,
          )
        : undefined;
    playing = false;
    if (soundEnd !== undefined) {
      position.begin(soundEnd);
    } else if (!glide.active()) {
      position.begin(frameIndex);
      publishHeld();
    }
    metronome.clear();
    setPlaying();
    renderer.requestWindow(position.getFrameIndex(), true);
  };

  const applySeek = (seekRevision: number, frameIndex: number) => () => {
    revision = seekRevision;
    glide.clear();
    position.begin(frameIndex);
    if (recordingRuntime.isActive()) {
      recordingRuntime.handleSeek(frameIndex);
    }
    renderer.reset();
    metronome.reset(frameIndex);
    metronome.clear();
    publishHeld();
    renderer.requestWindow(frameIndex, true);
  };

  const getTakeFrame = (currentOutputFrameIndex: number) => {
    const songFrame = range
      ? range.songFrame(currentOutputFrameIndex)
      : currentOutputFrameIndex;
    if (recordingRuntime.isActive() || (range && songFrame >= range.endFrame)) {
      return undefined;
    }
    return songFrame;
  };

  dataPort.bindHandlers({
    mount: (message) => {
      cuts.flush();
      glide.clear();
      frameCount = message.frameCount;
      renderer.mount(message.layouts, message.residentPageLimit);
      renderer.refill();
      renderer.clearTakes();
      renderer.setPieces({ pieces: message.recording });
      position.begin(0);
      playing = false;
      recordingRuntime.resetInputOffset();
      publishHeld();
      setPlaying();
      renderer.requestWindow(0, true);
    },
    putPage: (message) => {
      renderer.put(message);
    },
    dropPages: (message) => {
      renderer.drop(message.pages);
    },
    setRecordingPieces: (message) => {
      renderer.setPieces(message);
    },
    beginLiveTake: (message) => {
      renderer.beginLiveTake(message);
    },
    appendLiveTake: (message) => {
      renderer.appendLiveTake(message);
    },
    unmount: () => {
      cuts.flush();
      glide.clear();
      frameCount = 0;
      renderer.release();
      renderer.clearTakes();
      position.begin(0);
      playing = false;
      recordingRuntime.resetInputOffset();
      renderer.reset();
      publishHeld();
      setPlaying();
    },
  });

  port.bindHandlers({
    play: (message) => {
      cuts.after(() => {
        revision = message.revision;
        glide.clear();
        if (!renderer.mounted()) {
          setPlaying();
          return;
        }

        applyLatencyFrameCounts(message);
        metronome.reset(position.getFrameIndex());
        playing = true;
        recordingRuntime.resetInputOffset();
        setPlaying();
      });
    },
    stop: (message) => {
      cuts.cut(applyStop(message.revision, message.frameIndex));
    },
    setFrozen: (message) => {
      (message.frozen ? cuts.cut : cuts.after)(() => {
        frozen = message.frozen;
        renderer.reset();
      });
    },
    seek: (message) => {
      cuts.cut(applySeek(message.revision, message.frameIndex));
    },
    setLatency: (message) => {
      applyLatencyFrameCounts(message);
    },
    setOutputClock: (message) => {
      clockOffset = message.clockOffset;
    },
    setTransposeSemitones: (message) => {
      renderer.setTransposeSemitones(message.transposeSemitones);
    },
    setVoiceOctave: (message) => {
      renderer.setVoice(message.voiceOctave, message.shifted);
      renderer.refill();
    },
    setTempoRatio: (message) => {
      tempoRatio = message.tempoRatio;
      renderer.setTempoRatio(message.tempoRatio);
    },
    setTrackVolume: (message) => {
      trackVolumes[message.stemType] = message.volume;
      renderer.setVolumes(trackVolumes);
      renderer.refill();
    },
    setRecordingVolume: (message) => {
      renderer.setRecordingVolume(message.volume);
    },
    setMetronome: (message) => {
      metronome.setConfig(message, position.getFrameIndex());
    },
    setRange: (message) => {
      cuts.after(() => {
        glide.clear();
        range = message.range
          ? createRangeFrames(message.range, message.repeat, message.stopFrame)
          : undefined;
        renderer.setRange(range);
        renderer.refill();
        renderer.requestWindow(position.getFrameIndex(), true);
      });
    },
    startRecording: (message) => {
      cuts.after(() => {
        revision = message.revision;
        recordingRuntime.start(message);
      });
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

      cuts.settle();
      const contextFrame = options.getCurrentFrame();
      if (!renderer.mounted() || !playing) {
        recordingRuntime.processDrain(inputs);
        glide.advance(contextFrame);
        return;
      }
      lastContextFrame = contextFrame;
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
      renderer.requestWindow(currentOutputFrameIndex);
      const ready =
        recordingRuntime.isActive() || renderer.ready(currentOutputFrameIndex);
      if (!ready && cuts.fade.silent()) {
        recordingRuntime.processDrain(inputs);
        position.hold(contextFrame, outputFrameCount);
        playhead.publish(getValue());
        return;
      }
      cuts.follow(ready);

      recordingRuntime.processInput(inputs);

      const processedFrameCount = renderer.render(
        outputs,
        currentOutputFrameIndex,
        getTakeFrame(currentOutputFrameIndex),
      );
      cuts.fade.apply(outputs);

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
