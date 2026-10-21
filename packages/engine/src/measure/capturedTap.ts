import { type CapturedChunkListener } from '../audioSession/timedMicrophone.js';

export type CapturedTap = {
  push: CapturedChunkListener;
  listen: (listener: CapturedChunkListener) => () => void;
};

export const createCapturedTap = (): CapturedTap => {
  const listeners = new Set<CapturedChunkListener>();
  return {
    push: (chunk) => {
      for (const listener of listeners) {
        listener(chunk);
      }
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
