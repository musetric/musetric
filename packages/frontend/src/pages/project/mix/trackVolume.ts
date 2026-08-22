import { type StemType } from '@musetric/audio';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

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
