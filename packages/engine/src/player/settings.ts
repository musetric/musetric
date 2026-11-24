import { type StemType } from '@musetric/audio';
import { type Store } from '../common/store.js';
import {
  type EngineState,
  type SingerVoice,
  type VoiceOctave,
} from '../state.js';

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

export const createEnginePlayerSettings = (
  store: Store<EngineState>,
): EnginePlayerSettings => {
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
    },
    setTransposeSemitones: (transposeSemitones) => {
      store.update((state) => {
        state.transposeSemitones = transposeSemitones;
      });
    },
    setVoiceOctave: (voiceOctave) => {
      store.update((state) => {
        state.voiceOctave = voiceOctave;
      });
    },
    setSingerVoice: (singerVoice) => {
      store.update((state) => {
        state.singerVoice = singerVoice;
      });
    },
    setMetronomeEnabled: (enabled) => {
      store.update((state) => {
        state.metronomeEnabled = enabled;
      });
    },
    setMetronomeVolume: (volume) => {
      store.update((state) => {
        state.metronomeVolume = volume;
      });
    },
    setMetronomeBeats: (beats, downbeats) => {
      store.update((state) => {
        state.metronomeBeats = beats;
        state.metronomeDownbeats = downbeats;
      });
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
    },
    setTrackVolume: (track, volume) => {
      store.update((state) => {
        state.trackVolumes[track] = volume;
      });
    },
    rememberTrackVolume,
    toggleTrackMute: (track) => {
      rememberTrackVolume(track);
      store.update((state) => {
        state.trackVolumes[track] =
          state.trackVolumes[track] > 0 ? 0 : state.audibleTrackVolumes[track];
      });
    },
  };
};
