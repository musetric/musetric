import { createCallLatest } from './callLatest.js';
import { createScheduler, type Scheduler } from './scheduler.cross.js';

export type CreateSingleWorkerOptions = {
  intervalMs: number;
  runNext: () => Promise<void>;
};

export const createSingleWorker = (
  options: CreateSingleWorkerOptions,
): Scheduler => {
  const { intervalMs, runNext } = options;

  const run = async () => {
    try {
      await runNext();
    } catch {
      return;
    }
  };

  return createScheduler(createCallLatest(run), intervalMs);
};
