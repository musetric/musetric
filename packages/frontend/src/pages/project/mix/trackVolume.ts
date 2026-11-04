import { type StemType } from '@musetric/audio';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { playCrossedTick } from '../haptics.js';

export const volumeFullPercent = 100;
export const volumeTickEvery = 10;
const volumeMajorTickEvery = 50;
export const volumeMajorNotchIndex = volumeMajorTickEvery / volumeTickEvery - 1;

export const playVolumeTick = (from: number, to: number) => {
  playCrossedTick(
    from,
    to,
    volumeTickEvery,
    (tick) => tick % volumeMajorTickEvery === 0,
  );
};

export type TrackVolumeTarget =
  | {
      kind: 'delivery';
      stemType: StemType;
    }
  | {
      kind: 'recording';
    };

export const getTrackKey = (target: TrackVolumeTarget) =>
  target.kind === 'recording' ? target.kind : target.stemType;

export const setTrackVolume = (target: TrackVolumeTarget, value: number) => {
  engine.store.update((state) => {
    state.trackVolumes[getTrackKey(target)] = value;
  });
};

export const rememberTrackVolume = (target: TrackVolumeTarget) => {
  const key = getTrackKey(target);
  engine.store.update((state) => {
    if (state.trackVolumes[key] > 0) {
      state.audibleTrackVolumes[key] = state.trackVolumes[key];
    }
  });
};

export const toggleTrackMute = (target: TrackVolumeTarget) => {
  rememberTrackVolume(target);
  const key = getTrackKey(target);
  engine.store.update((state) => {
    state.trackVolumes[key] =
      state.trackVolumes[key] > 0 ? 0 : state.audibleTrackVolumes[key];
  });
};

export const useTrackVolume = (target: TrackVolumeTarget) =>
  useEngineStore((state) => state.trackVolumes[getTrackKey(target)]);
