import { engine } from '../../../engine/engine.js';
import { recordRangeOnce } from '../loop/recordRangeOnce.js';

const prerollSeconds = 1;
const tailSeconds = 0.4;

export type PracticeTryOptions = {
  projectId: number;
  start: number;
  end: number;
  onFinish: () => void;
};

export const tryPracticeFragment = async (options: PracticeTryOptions) => {
  const { projectId, start, end, onFinish } = options;
  if (engine.store.get().playing) {
    await engine.player.stop();
  }
  const { sampleRate } = engine.context;
  try {
    await recordRangeOnce(projectId, {
      fromFrame: Math.round(Math.max(0, start) * sampleRate),
      toFrame: Math.round((end + tailSeconds) * sampleRate),
    });
  } finally {
    onFinish();
  }
};

export const showPracticePlace = (start: number) => {
  if (engine.store.get().playing) {
    return;
  }
  const { sampleRate } = engine.context;
  engine.player.seek(
    Math.round(Math.max(0, start - prerollSeconds) * sampleRate),
    'spectrogramVisualization',
  );
};
