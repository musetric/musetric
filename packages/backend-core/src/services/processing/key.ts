import { analyzeKey } from '@musetric/ai/node';
import { type ProcessingStep } from './types.js';

export const runKey: ProcessingStep = async (context) => {
  const { app, logger, task, handlers } = context;
  const sourcePath = app.blobStorage.getPath(task.blobId);
  const key = app.blobStorage.createPath();

  await analyzeKey({
    sourcePath,
    resultPath: key.blobPath,
    handlers,
    modelsPath: app.config.modelsPath,
    logger,
  });

  await app.db.processing.applyKeyResult({
    projectId: task.projectId,
    blobId: key.blobId,
  });
};
