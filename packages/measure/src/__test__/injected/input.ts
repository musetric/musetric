import { type MeasureInput } from '../measureInput.js';

export type InputBridge = {
  send: (input: MeasureInput) => Promise<void>;
  finish: (id: number) => void;
};

export const createInputBridge = (): InputBridge => {
  const waiting = new Map<number, () => void>();
  let lastId = 0;
  return {
    send: async (input) => {
      lastId += 1;
      const id = lastId;
      const done = new Promise<void>((resolve) => {
        waiting.set(id, resolve);
      });
      console.info('[measure]', 'input', id, JSON.stringify(input));
      await done;
    },
    finish: (id) => {
      waiting.get(id)?.();
      waiting.delete(id);
    },
  };
};
