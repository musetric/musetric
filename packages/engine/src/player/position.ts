export type PositionListener = (frameIndex: number) => void;

export type EnginePosition = {
  read: () => number;
  subscribe: (listener: PositionListener) => () => void;
};

export type EnginePositionWriter = EnginePosition & {
  write: (frameIndex: number) => void;
  show: (frameIndex: number) => void;
  setStage: (stage: PositionListener) => void;
};

export const createEnginePosition = (): EnginePositionWriter => {
  let frameIndex = 0;
  const listeners = new Set<PositionListener>();
  const show = (next: number) => {
    if (next === frameIndex) {
      return;
    }
    frameIndex = next;
    for (const listener of listeners) {
      listener(next);
    }
  };
  let stage: PositionListener = show;
  return {
    read: () => frameIndex,
    write: (next) => {
      stage(next);
    },
    show,
    setStage: (next) => {
      stage = next;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
