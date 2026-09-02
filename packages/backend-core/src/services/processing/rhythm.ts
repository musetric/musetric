import { analyzeRhythm } from '@musetric/ai/node';
import { type ProcessingStep } from './types.js';

export const runRhythm: ProcessingStep = async (context) => {
  const { app, logger, task, handlers } = context;
  const sourcePath = app.blobStorage.getPath(task.blobId);
  const rhythm = app.blobStorage.createPath();

  await analyzeRhythm({
    gpuHost: app.gpuHost,
    sourcePath,
    resultPath: rhythm.blobPath,
    handlers,
    modelsPath: app.config.modelsPath,
    logger,
  });

  await app.db.processing.applyRhythmResult({
    projectId: task.projectId,
    blobId: rhythm.blobId,
  });
};
