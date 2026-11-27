import { nextNumber } from '@musetric/utils';

export type EngineSeekOrigin =
  | 'hold'
  | 'playbackEnd'
  | 'player'
  | 'playerProgress'
  | 'playhead'
  | 'spectrogramVisualization'
  | 'subtitle'
  | 'tracksVisualization';

export type EngineSeekEvent = {
  revision: number;
  frameIndex: number;
  origin: EngineSeekOrigin;
};

export type EngineSeekListener = (seekEvent: EngineSeekEvent) => void;

export type EngineSeeks = {
  read: () => EngineSeekEvent;
  subscribe: (listener: EngineSeekListener) => () => void;
};

export type EngineSeeksWriter = EngineSeeks & {
  push: (frameIndex: number, origin: EngineSeekOrigin) => void;
};

export const createEngineSeeks = (): EngineSeeksWriter => {
  let seekEvent: EngineSeekEvent = {
    revision: 0,
    frameIndex: 0,
    origin: 'player',
  };
  const listeners = new Set<EngineSeekListener>();
  return {
    read: () => seekEvent,
    push: (frameIndex, origin) => {
      seekEvent = {
        revision: nextNumber(seekEvent.revision),
        frameIndex,
        origin,
      };
      for (const listener of listeners) {
        listener(seekEvent);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
