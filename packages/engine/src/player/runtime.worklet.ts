import { type StemType } from '@musetric/audio/es';
import { type InitOutput } from '@musetric/dsp/stretch';
import { createCuts } from './cutFade.worklet.js';
import { createHeardPosition } from './heardPosition.worklet.js';
import { createWorkletLatency } from './latency.worklet.js';
import { createMetronome } from './metronome.worklet.js';
import { createMotion } from './motion.worklet.js';
import {
  createRangeFrames,
  getTakeFrame,
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
  type PlayerOutboundMethods,
} from './protocol.cross.js';
import {
  createRecordingRuntime,
  type RecordingRuntime,
} from './recording.worklet.js';
import { createPlayerRenderer } from './renderer.worklet.js';
import { createStopGlide } from './stopGlide.worklet.js';

type StopMessage = Parameters<PlayerOutboundMethods['stop']>[0];
type SeekMessage = Parameters<PlayerOutboundMethods['seek']>[0];

export type CreatePlayerRuntimeOptions = {
  port: ReturnType<typeof playerChannel.inbound<MessagePort>>;
  dataPort: ReturnType<typeof playerDataChannel.inbound<MessagePort>>;
  playheadPorts: MessagePort[];
  sampleRate: number;
  stretch: InitOutput;
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
    options.getCurrentFrame,
    sampleRate,
  );

  let frameCount = 0;
  let clockOffset: number | undefined = undefined;
  let revision = 0;
  let appliedCommand = 0;
  let playing = false;
  let frozen = false;
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

  const latency = createWorkletLatency(position, () => playing);

  const heard = createHeldPlayheadValue(0, 0);
  const readHeard = () => {
    position.read(heard, revision, clockOffset, frameCount);
    return heard;
  };

  const publishHeld = () => {
    playhead.publishNow(
      createHeldPlayheadValue(position.getFrameIndex(), revision),
    );
  };
  const glide = createStopGlide(playhead, publishHeld);

  const motion = createMotion({
    isPlaying: () => playing,
    isHeld: () => frozen,
    isMounted: () => renderer.mounted(),
  });

  const setPlaying = (positionJump?: true) => {
    port.methods.setPlaying({
      command: appliedCommand,
      playing,
      motion: motion.settle(),
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
    getInputLatencyFrameCount: latency.getInputFrameCount,
    getPendingOutputFrameCount: () =>
      playing
        ? position.getPendingOutputFrameCount()
        : latency.getOutputFrameCount(),
    getTempoRatio: () => tempoRatio,
    getLoop: () => (range?.repeat === 'cycle' ? range.range : undefined),
    applyLatencyFrameCounts: latency.apply,
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

  const applyStop = (message: StopMessage) => () => {
    appliedCommand = message.command;
    revision = message.revision;
    const soundEnd =
      playing && !frozen
        ? glide.start(
            readHeard(),
            position.getRenderFrameIndex(),
            lastContextFrame,
          )
        : undefined;
    playing = false;
    if (soundEnd !== undefined) {
      position.begin(soundEnd);
    } else if (!glide.active()) {
      position.begin(message.frameIndex);
      publishHeld();
    }
    metronome.clear();
    setPlaying();
    renderer.requestWindow(position.getFrameIndex(), true);
  };

  const applySeek = (message: SeekMessage) => () => {
    appliedCommand = message.command;
    revision = message.revision;
    const { frameIndex } = message;
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
    setPlaying();
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
    putPage: renderer.put,
    dropPages: (message) => {
      renderer.drop(message.pages);
    },
    setRecordingPieces: renderer.setPieces,
    beginLiveTake: renderer.beginLiveTake,
    appendLiveTake: renderer.appendLiveTake,
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
        appliedCommand = message.command;
        revision = message.revision;
        glide.clear();
        if (!renderer.mounted()) {
          setPlaying();
          return;
        }

        latency.apply(message);
        metronome.reset(position.getFrameIndex());
        playing = true;
        recordingRuntime.resetInputOffset();
        setPlaying();
      });
    },
    stop: (message) => {
      cuts.cut(applyStop(message));
    },
    setFrozen: (message) => {
      (message.frozen ? cuts.cut : cuts.after)(() => {
        appliedCommand = message.command;
        frozen = message.frozen;
        renderer.reset();
        setPlaying();
      });
    },
    seek: (message) => {
      cuts.cut(applySeek(message));
    },
    setLatency: (message) => {
      latency.apply(message);
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
        appliedCommand = message.command;
        setPlaying();
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
      for (let channel = 0; channel < outputs.length; channel += 1) {
        outputs[channel].fill(0);
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

      if (frozen) {
        recordingRuntime.processDrain(inputs);
        position.hold(contextFrame, outputFrameCount);
        playhead.publish(readHeard());
        return;
      }

      const currentOutputFrameIndex = position.getRenderFrameIndex();
      renderer.requestWindow(currentOutputFrameIndex);
      const ready =
        recordingRuntime.isActive() || renderer.ready(currentOutputFrameIndex);
      if (!ready && cuts.fade.silent()) {
        motion.moveTo('buffering', setPlaying);
        recordingRuntime.processDrain(inputs);
        position.hold(contextFrame, outputFrameCount);
        playhead.publish(readHeard());
        return;
      }
      motion.moveTo('rolling', setPlaying);
      cuts.follow(ready);

      recordingRuntime.processInput(inputs);

      const processedFrameCount = renderer.render(
        outputs,
        currentOutputFrameIndex,
        getTakeFrame(
          range,
          currentOutputFrameIndex,
          recordingRuntime.isActive(),
        ),
      );
      cuts.fade.apply(outputs);

      const nextOutputFrameIndex = position.advance(
        contextFrame,
        outputFrameCount,
        processedFrameCount,
      );
      metronome.process(
        currentOutputFrameIndex,
        nextOutputFrameIndex,
        outputs,
        range,
      );
      const frameIndex = position.getFrameIndex();
      if (range?.repeat === 'once' && frameIndex >= range.endFrame) {
        finishPlayback(range.range.fromFrame);
        return;
      }

      if (frameIndex >= frameCount) {
        finishPlayback(0);
        return;
      }

      playhead.publish(readHeard());
    },
  };
};
