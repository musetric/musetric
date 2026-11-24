export type PositionListener = (frameIndex: number) => void;

export type EnginePosition = {
  read: () => number;
  subscribe: (listener: PositionListener) => () => void;
};

export type EnginePositionWriter = EnginePosition & {
  write: (frameIndex: number) => void;
};

export const createEnginePosition = (): EnginePositionWriter => {
  let frameIndex = 0;
  const listeners = new Set<PositionListener>();
  return {
    read: () => frameIndex,
    write: (next) => {
      if (next === frameIndex) {
        return;
      }
      frameIndex = next;
      for (const listener of listeners) {
        listener(next);
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
