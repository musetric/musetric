import { type EngineRange } from '@musetric/engine';
import { engine } from '../../../engine/engine.js';

type EngineSnapshot = ReturnType<typeof engine.store.get>;

const waitUntil = async (check: (state: EngineSnapshot) => boolean) =>
  new Promise<void>((resolve) => {
    if (check(engine.store.get())) {
      resolve();
      return;
    }
    const unsubscribe = engine.store.subscribe(check, (done) => {
      if (done) {
        unsubscribe();
        resolve();
      }
    });
  });

export const recordRangeOnce = async (
  projectId: number,
  range: EngineRange,
): Promise<boolean> => {
  const tries = engine.store.get().loopTries.length;
  engine.player.openLoop(range);
  engine.player.lockLoop();
  try {
    await engine.player.recordTry(projectId);
    await waitUntil(
      (state) =>
        state.loopTries.length > tries || state.loopStage === undefined,
    );
    if (engine.store.get().playing) {
      await engine.player.stop();
    }
    const { loopSelectedTryId } = engine.store.get();
    if (loopSelectedTryId === undefined) {
      return false;
    }
    return await engine.player.insertTry(projectId, loopSelectedTryId);
  } finally {
    if (engine.store.get().loopStage !== undefined) {
      engine.player.closeLoop();
    }
  }
};
