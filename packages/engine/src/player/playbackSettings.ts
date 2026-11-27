import { type StemType, stemTypes } from '@musetric/audio/es';
import { type Store } from '../common/store.js';
import { type EngineStoreState } from '../ownState.js';
import { type playerChannel } from './protocol.cross.js';
import { type EngineTrackKey } from './settings.js';

const dbToGain = (db: number) => 10 ** (db / 20);

export type PlaybackSettings = {
  sendTempoRatio: () => void;
  sendTranspose: () => void;
  sendVoice: () => void;
  sendMetronome: () => void;
  sendTrackVolume: (track: EngineTrackKey) => void;
  sendTrackVolumes: () => void;
};

export type CreatePlaybackSettingsOptions = {
  port: ReturnType<typeof playerChannel.outbound<MessagePort>>;
  store: Store<EngineStoreState>;
  sampleRate: number;
};

export const createPlaybackSettings = (
  options: CreatePlaybackSettingsOptions,
): PlaybackSettings => {
  const { port, store, sampleRate } = options;

  const sendStemVolume = (stemType: StemType) => {
    const state = store.get();
    port.methods.setTrackVolume({
      stemType,
      volume: state.trackVolumes[stemType] * dbToGain(state.sourceGainDb),
    });
  };
  const sendRecordingVolume = () => {
    port.methods.setRecordingVolume({
      volume: store.get().trackVolumes.recording,
    });
  };

  return {
    sendTempoRatio: () => {
      port.methods.setTempoRatio({ tempoRatio: store.get().tempoRatio });
    },
    sendTranspose: () => {
      port.methods.setTransposeSemitones({
        transposeSemitones: store.get().transposeSemitones,
      });
    },
    sendVoice: () => {
      const { voiceOctave, singerVoice } = store.get();
      port.methods.setVoiceOctave({
        voiceOctave,
        shifted: singerVoice === 'shifted',
      });
    },
    sendMetronome: () => {
      const state = store.get();
      const beatsInSamples = new Int32Array(state.metronomeBeats.length);
      const downbeatMask = new Uint8Array(state.metronomeBeats.length);
      const downbeatSet = new Set(state.metronomeDownbeats);
      for (let i = 0; i < state.metronomeBeats.length; i += 1) {
        const beat = state.metronomeBeats[i];
        beatsInSamples[i] = Math.round(beat * sampleRate);
        downbeatMask[i] = downbeatSet.has(beat) ? 1 : 0;
      }
      port.methods.setMetronome({
        beatsInSamples,
        downbeatMask,
        enabled: state.metronomeEnabled,
        volume: state.metronomeVolume,
      });
    },
    sendTrackVolume: (track) => {
      if (track === 'recording') {
        sendRecordingVolume();
        return;
      }
      sendStemVolume(track);
    },
    sendTrackVolumes: () => {
      for (const stemType of stemTypes) {
        sendStemVolume(stemType);
      }
      sendRecordingVolume();
    },
  };
};
