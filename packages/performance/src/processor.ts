import { createGpuContext } from '@musetric/utils/gpu';
import { runBenchmark } from './runBenchmarks.js';
import { useProcessingStore } from './store.js';

const { device } = await createGpuContext(true);

let canvas: OffscreenCanvas | undefined = undefined;
let running = false;

/**
 * Drains the toDo queue one task at a time. Stale tasks (whose epoch no
 * longer matches the store) are rejected atomically inside the reducer, so
 * the only thing the loop has to remember is which epoch its task belonged
 * to. After a stale-rejection the next iteration re-reads the store and
 * picks up the new queue head.
 */
const drain = async () => {
  if (running) return;
  running = true;
  try {
    while (canvas !== undefined) {
      const state = useProcessingStore.getState();
      const [task] = state.toDo;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!task) break;

      const taskEpoch = state.epoch;
      const { params } = state;

      const metrics = await runBenchmark({
        device,
        canvas,
        fourierMode: task.fourierMode,
        windowSize: task.windowSize,
        params,
      });

      // Reducer atomically validates epoch + queue head. If anything changed
      // (param click, queue reset) it returns state unchanged and the next
      // iteration reads the latest state.
      useProcessingStore.getState().recordResult(task, taskEpoch, metrics);
    }
  } finally {
    running = false;
  }
};

export const attachCanvas = (next: OffscreenCanvas) => {
  canvas = next;
  void drain();
};

export const detachCanvas = () => {
  canvas = undefined;
};

// Kick the loop whenever the queue is rebuilt. The reducer already discards
// in-flight results that belong to the previous epoch, so the only extra
// concern is making sure the loop is actively running.
useProcessingStore.subscribe(
  (state) => state.epoch,
  () => {
    void drain();
  },
);
