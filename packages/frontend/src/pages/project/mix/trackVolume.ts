import { type StemType } from '@musetric/audio';
import { createPointerDrag } from '@musetric/interaction';
import { type RefObject, useEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { playCrossedTick } from '../haptics.js';

const dragLockDistance = 8;

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
      kind: 'stem';
      stemType: StemType;
    }
  | {
      kind: 'recording';
    };

export const getTrackKey = (target: TrackVolumeTarget) =>
  target.kind === 'recording' ? target.kind : target.stemType;

export const setTrackVolume = (target: TrackVolumeTarget, value: number) => {
  engine.player.setTrackVolume(getTrackKey(target), value);
};

export const toggleTrackMute = (target: TrackVolumeTarget) => {
  engine.player.toggleTrackMute(getTrackKey(target));
};

export const useTrackVolume = (target: TrackVolumeTarget) =>
  useEngineStore((state) => state.trackVolumes[getTrackKey(target)]);

export const useTrackVolumeDrag = (
  elementRef: RefObject<HTMLElement | null>,
  target: TrackVolumeTarget,
  disabled: boolean,
) => {
  const track = getTrackKey(target);
  useEffect(() => {
    const element = elementRef.current;
    if (!element || disabled) return;

    const readPercent = () =>
      Math.round(engine.store.get().trackVolumes[track] * volumeFullPercent);
    const drag = createPointerDrag(element, (press) => {
      const startPercent = readPercent();
      let lockX: number | undefined = undefined;
      return {
        move: (event) => {
          if (lockX === undefined) {
            if (Math.abs(event.clientX - press.clientX) < dragLockDistance) {
              return;
            }
            lockX = event.clientX;
            engine.player.rememberTrackVolume(track);
          }
          const { width } = element.getBoundingClientRect();
          const offset =
            ((2 * (event.clientX - lockX)) / width) * volumeFullPercent;
          const percent = Math.round(
            Math.min(Math.max(startPercent + offset, 0), volumeFullPercent),
          );
          playVolumeTick(readPercent(), percent);
          engine.player.setTrackVolume(track, percent / volumeFullPercent);
        },
        cancel: () => {
          if (lockX !== undefined) {
            engine.player.setTrackVolume(
              track,
              startPercent / volumeFullPercent,
            );
          }
        },
      };
    });
    return drag.dispose;
  }, [elementRef, track, disabled]);
};
