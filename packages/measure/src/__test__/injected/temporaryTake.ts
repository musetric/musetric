import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import { createAudioDecoder } from '@musetric/audio/decoder';
import {
  type Engine,
  type EngineState,
  getActiveRecording,
  type SpectrogramViewMode,
} from '@musetric/engine';
import axios from 'axios';
import { createTakeWindow, layTakePiece, type TakeWindow } from '../take.js';
import { epochNow, wait } from './samples.js';

const activePollMs = 100;
const activeTimeoutMs = 5000;
const seekSettleMs = 300;
const streamSettleMs = 2500;
const sliceLeadSeconds = 0.5;
const sliceTailSeconds = 1;

const layPieces = async (
  projectId: number,
  recordingId: number,
  sampleRate: number,
  take: TakeWindow,
): Promise<void> => {
  const { pieces } = await requestWithAxios(
    axios,
    api.audio.recordingPieces.base,
    { params: { projectId, recordingId } },
  );
  const decoder = createAudioDecoder();
  for (const piece of pieces) {
    const content = await requestWithAxios(
      axios,
      api.audio.recordingPiece.base,
      { params: { projectId, recordingId, blobId: piece.blobId } },
    );
    const { channels } = await decoder.decode(content.buffer, {
      extension: 'wav',
      sampleRate,
      keepChannels: true,
    });
    layTakePiece(take, {
      songStartFrame: (piece.songStartFrame * sampleRate) / piece.sampleRate,
      tempo: piece.tempo,
      samples: channels[0],
    });
  }
};

type SavedSettings = Pick<
  EngineState,
  | 'trackVolumes'
  | 'metronomeEnabled'
  | 'metronomeVolume'
  | 'tempoRatio'
  | 'spectrogramView'
>;

const saveSettings = (engine: Engine): SavedSettings => {
  const state = engine.store.get();
  return {
    trackVolumes: { ...state.trackVolumes },
    metronomeEnabled: state.metronomeEnabled,
    metronomeVolume: state.metronomeVolume,
    tempoRatio: state.tempoRatio,
    spectrogramView: state.spectrogramView,
  };
};

const applySettings = (engine: Engine, settings: SavedSettings) => {
  engine.store.update((state) => {
    state.trackVolumes = settings.trackVolumes;
    state.metronomeEnabled = settings.metronomeEnabled;
    state.metronomeVolume = settings.metronomeVolume;
    state.tempoRatio = settings.tempoRatio;
    state.spectrogramView = settings.spectrogramView;
  });
};

const waitForActive = async (engine: Engine, recordingId: number) => {
  for (let waited = 0; waited < activeTimeoutMs; waited += activePollMs) {
    if (getActiveRecording(engine.store.get())?.id === recordingId) {
      return;
    }
    await wait(activePollMs);
  }
  throw new Error('The temporary recording did not become active');
};

const findActive = (list: api.recording.list.Response) => {
  const active = list.recordings.find((recording) => recording.active);
  if (!active) {
    throw new Error('The project has no active recording');
  }
  return active;
};

export type TakeProbe = () => () => void;

export type TemporaryTakeSettings = {
  projectId: number;
  startFrame: number;
  seconds: number;
  tempo: number;
  songVolume: number;
  metronome: boolean;
  view?: SpectrogramViewMode;
};

export type TemporaryTake = {
  firstFrame: number;
  samples: Float32Array;
};

export const recordTemporaryTake = async (
  engine: Engine,
  settings: TemporaryTakeSettings,
  probe?: TakeProbe,
): Promise<TemporaryTake> => {
  const { projectId } = settings;
  if (engine.store.get().playing) {
    await engine.player.stop();
  }
  const original = findActive(
    await requestWithAxios(axios, api.recording.list.base, {
      params: { projectId },
    }),
  );
  const temporary = findActive(
    await requestWithAxios(axios, api.recording.create.base, {
      params: { projectId },
    }),
  );
  const saved = saveSettings(engine);
  try {
    await waitForActive(engine, temporary.id);
    applySettings(engine, {
      trackVolumes: {
        lead: settings.songVolume,
        backing: settings.songVolume,
        instrumental: settings.songVolume,
        recording: 0,
      },
      metronomeEnabled: settings.metronome,
      metronomeVolume: 1,
      tempoRatio: settings.tempo,
      spectrogramView: settings.view ?? saved.spectrogramView,
    });
    engine.player.seek(settings.startFrame, 'player');
    await wait(seekSettleMs);
    let stopProbe: (() => void) | undefined = undefined;
    try {
      await engine.player.record(projectId);
      console.info('[measure]', 'started', epochNow());
      stopProbe = probe?.();
      await wait(settings.seconds * 1000);
    } finally {
      await engine.player.stop();
      stopProbe?.();
    }
    await wait(streamSettleMs);
    const { sampleRate } = engine.context;
    const { frameCount } = engine.store.get();
    if (frameCount === undefined) {
      throw new Error('The project has no frame count');
    }
    const firstFrame = Math.max(
      0,
      settings.startFrame - Math.round(sliceLeadSeconds * sampleRate),
    );
    const lastFrame =
      settings.startFrame +
      Math.round(
        (settings.seconds * settings.tempo + sliceTailSeconds) * sampleRate,
      );
    const take = createTakeWindow(
      firstFrame,
      Math.min(frameCount, lastFrame),
      settings.tempo,
    );
    await layPieces(projectId, temporary.id, sampleRate, take);
    return { firstFrame, samples: take.samples };
  } finally {
    applySettings(engine, saved);
    await requestWithAxios(axios, api.recording.activate.base, {
      params: { projectId, recordingId: original.id },
    });
    await requestWithAxios(axios, api.recording.remove.base, {
      params: { projectId, recordingId: temporary.id },
    });
  }
};
