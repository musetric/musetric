import { stemTypes } from '@musetric/audio';
import { type TakeVersion } from '@musetric/spectrogram';
import { engine } from '../../../engine/engine.js';

const leadInSeconds = 0.4;
const tailSeconds = 0.4;

export type VocalListenTarget = 'lead' | 'recording';

export type VocalListener = {
  listen: (target: VocalListenTarget, start: number, end: number) => void;
  listenVersion: (version: TakeVersion, start: number, end: number) => void;
  dispose: () => void;
};

export const createVocalListener = (): VocalListener => {
  let restoreVolumes: (() => void) | undefined = undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let versionSource: AudioBufferSourceNode | undefined = undefined;
  let versionRequest = 0;

  const finish = () => {
    clearTimeout(stopTimer);
    stopTimer = undefined;
    restoreVolumes?.();
    restoreVolumes = undefined;
    versionSource?.stop();
    versionSource = undefined;
  };

  const soloVolumes = (target: VocalListenTarget) => {
    const saved = { ...engine.store.get().trackVolumes };
    engine.store.update((state) => {
      for (const stemType of stemTypes) {
        state.trackVolumes[stemType] =
          target === 'lead' && stemType === 'lead' ? saved.lead || 1 : 0;
      }
      state.trackVolumes.recording =
        target === 'recording' ? saved.recording || 1 : 0;
    });
    const unsubscribe = engine.store.subscribe(
      (state) => state.playing,
      (playing) => {
        if (!playing) {
          finish();
        }
      },
    );
    return () => {
      unsubscribe();
      engine.store.update((state) => {
        state.trackVolumes = saved;
      });
    };
  };

  const listen = async (
    target: VocalListenTarget,
    start: number,
    end: number,
  ) => {
    if (engine.store.get().playing) {
      await engine.player.stop();
    }
    finish();
    const { sampleRate } = engine.context;
    const { tempoRatio } = engine.store.get();
    const from = Math.max(0, start - leadInSeconds);
    engine.player.seek(
      Math.round(from * sampleRate),
      'spectrogramVisualization',
    );
    restoreVolumes = soloVolumes(target);
    await engine.player.play();
    const songSeconds = end + tailSeconds - from;
    stopTimer = setTimeout(
      () => {
        void engine.player.stop();
      },
      (songSeconds * 1000) / tempoRatio,
    );
  };

  const listenVersion = async (
    version: TakeVersion,
    start: number,
    end: number,
  ) => {
    if (engine.store.get().playing) {
      await engine.player.stop();
    }
    finish();
    versionRequest += 1;
    const request = versionRequest;
    const samples = await engine.spectrogram.renderTakeVersion(
      start,
      end,
      version,
    );
    if (!samples || request !== versionRequest || samples.length === 0) {
      return;
    }
    const { context } = engine;
    if (context.state === 'suspended') {
      await context.resume();
    }
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(engine.audioOutput.outputNode);
    source.start();
    versionSource = source;
  };

  return {
    listen: (target, start, end) => {
      void listen(target, start, end);
    },
    listenVersion: (version, start, end) => {
      void listenVersion(version, start, end);
    },
    dispose: finish,
  };
};
