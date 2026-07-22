import { createGpuContext } from '@musetric/utils/gpu';
import { runBenchmark } from './runBenchmarks.js';
import { useProcessingStore } from './store.js';

const { device } = await createGpuContext(true);

let canvas: OffscreenCanvas | undefined = undefined;
let running = false;

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

useProcessingStore.subscribe(
  (state) => state.epoch,
  () => {
    void drain();
  },
);
