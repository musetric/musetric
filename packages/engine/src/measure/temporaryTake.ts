import { api } from '@musetric/api';
import { requestWithAxios } from '@musetric/api/dom';
import axios from 'axios';
import { type Engine } from '../engine.js';
import { type TakeTarget } from '../player/takeShift.cross.js';
import { getActiveRecording, type SpectrogramViewMode } from '../state.js';
import { epochNow, wait } from './samples.js';

const activePollMs = 100;
const activeTimeoutMs = 5000;
const seekSettleMs = 300;
const streamSettleMs = 2500;
const sliceLeadSeconds = 0.5;
const sliceTailSeconds = 1;

const exportTarget: TakeTarget = {
  tempoRatio: 1,
  transposeSemitones: 0,
  voiceOctave: 0,
  voiceShifted: false,
};

type SavedSettings = Pick<
  ReturnType<Engine['store']['get']>,
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
    const song = await engine.decoder.exportRecording(exportTarget);
    const firstFrame = Math.max(
      0,
      settings.startFrame - Math.round(sliceLeadSeconds * sampleRate),
    );
    const lastFrame =
      settings.startFrame +
      Math.round(
        (settings.seconds * settings.tempo + sliceTailSeconds) * sampleRate,
      );
    return { firstFrame, samples: song.slice(firstFrame, lastFrame) };
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
