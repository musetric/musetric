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

export const setTrackVolume = (target: TrackVolumeTarget, value: number) => {
  engine.store.update((state) => {
    if (target.kind === 'recording') {
      state.trackVolumes.recording = value;
      return;
    }
    state.trackVolumes[target.stemType] = value;
  });
};

export const useTrackVolume = (target: TrackVolumeTarget) =>
  useEngineStore((state) =>
    target.kind === 'recording'
      ? state.trackVolumes.recording
      : state.trackVolumes[target.stemType],
  );
