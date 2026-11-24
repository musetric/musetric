import { type Store } from '../common/store.js';
import { type EngineState, isTransportBusy } from '../state.js';

type TransportCommand = () => Promise<void>;

type WaitingCommand = {
  command: TransportCommand;
  settle: (done: Promise<void>) => void;
};

export type EngineCommandQueue = {
  run: (command: TransportCommand) => Promise<void>;
  runStop: (command: TransportCommand) => Promise<void>;
};

export const createEngineCommandQueue = (
  store: Store<EngineState>,
): EngineCommandQueue => {
  const waiting: WaitingCommand[] = [];
  const free = () => !isTransportBusy(store.get());

  const drain = () => {
    while (free()) {
      const next = waiting.shift();
      if (!next) {
        return;
      }
      next.settle(next.command());
    }
  };

  store.subscribe(isTransportBusy, (busy) => {
    if (!busy) {
      queueMicrotask(drain);
    }
  });

  const run = async (command: TransportCommand): Promise<void> => {
    if (waiting.length === 0 && free()) {
      return command();
    }
    return new Promise<void>((resolve) => {
      waiting.push({ command, settle: resolve });
    });
  };

  return {
    run,
    runStop: async (command) => {
      for (const dropped of waiting.splice(0)) {
        dropped.settle(Promise.resolve());
      }
      return run(command);
    },
  };
};
