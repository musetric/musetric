import { type StemType } from '@musetric/audio';
import { type Store } from '../common/store.js';
import {
  type EngineState,
  type SingerVoice,
  type VoiceOctave,
} from '../state.js';
import { type EnginePlayback } from './playback.js';

export type EngineTrackKey = StemType | 'recording';

export type EnginePlayerSettings = {
  setTempoRatio: (tempoRatio: number) => void;
  setTransposeSemitones: (transposeSemitones: number) => void;
  setVoiceOctave: (voiceOctave: VoiceOctave) => void;
  setSingerVoice: (singerVoice: SingerVoice) => void;
  setMetronomeEnabled: (enabled: boolean) => void;
  setMetronomeVolume: (volume: number) => void;
  setMetronomeBeats: (beats: number[], downbeats: number[]) => void;
  setRecordingGain: (recordingGain: number) => void;
  setSourceGainDb: (sourceGainDb: number) => void;
  setTrackVolume: (track: EngineTrackKey, volume: number) => void;
  rememberTrackVolume: (track: EngineTrackKey) => void;
  toggleTrackMute: (track: EngineTrackKey) => void;
};

export type CreateEnginePlayerSettingsOptions = {
  store: Store<EngineState>;
  getEnginePlayback: () => EnginePlayback;
};

export const createEnginePlayerSettings = (
  options: CreateEnginePlayerSettingsOptions,
): EnginePlayerSettings => {
  const { store, getEnginePlayback } = options;
  const rememberTrackVolume = (track: EngineTrackKey) => {
    store.update((state) => {
      if (state.trackVolumes[track] > 0) {
        state.audibleTrackVolumes[track] = state.trackVolumes[track];
      }
    });
  };
  return {
    setTempoRatio: (tempoRatio) => {
      store.update((state) => {
        state.tempoRatio = tempoRatio;
      });
      getEnginePlayback().sendTempoRatio();
    },
    setTransposeSemitones: (transposeSemitones) => {
      store.update((state) => {
        state.transposeSemitones = transposeSemitones;
      });
      getEnginePlayback().sendTranspose();
    },
    setVoiceOctave: (voiceOctave) => {
      store.update((state) => {
        state.voiceOctave = voiceOctave;
      });
      getEnginePlayback().sendVoice();
    },
    setSingerVoice: (singerVoice) => {
      store.update((state) => {
        state.singerVoice = singerVoice;
      });
      getEnginePlayback().sendVoice();
    },
    setMetronomeEnabled: (enabled) => {
      store.update((state) => {
        state.metronomeEnabled = enabled;
      });
      getEnginePlayback().sendMetronome();
    },
    setMetronomeVolume: (volume) => {
      store.update((state) => {
        state.metronomeVolume = volume;
      });
      getEnginePlayback().sendMetronome();
    },
    setMetronomeBeats: (beats, downbeats) => {
      store.update((state) => {
        state.metronomeBeats = beats;
        state.metronomeDownbeats = downbeats;
      });
      getEnginePlayback().sendMetronome();
    },
    setRecordingGain: (recordingGain) => {
      store.update((state) => {
        state.recordingGain = recordingGain;
      });
    },
    setSourceGainDb: (sourceGainDb) => {
      store.update((state) => {
        state.sourceGainDb = sourceGainDb;
      });
      getEnginePlayback().sendTrackVolumes();
    },
    setTrackVolume: (track, volume) => {
      store.update((state) => {
        state.trackVolumes[track] = volume;
      });
      getEnginePlayback().sendTrackVolume(track);
    },
    rememberTrackVolume,
    toggleTrackMute: (track) => {
      rememberTrackVolume(track);
      store.update((state) => {
        state.trackVolumes[track] =
          state.trackVolumes[track] > 0 ? 0 : state.audibleTrackVolumes[track];
      });
      getEnginePlayback().sendTrackVolume(track);
    },
  };
};
