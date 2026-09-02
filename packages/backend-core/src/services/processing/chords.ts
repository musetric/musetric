import { analyzeChords } from '@musetric/ai/node';
import { type ProcessingStep } from './types.js';

export const runChords: ProcessingStep = async (context) => {
  const { app, logger, task, handlers } = context;
  const sourcePath = app.blobStorage.getPath(task.blobId);
  const chords = app.blobStorage.createPath();

  await analyzeChords({
    gpuHost: app.gpuHost,
    sourcePath,
    resultPath: chords.blobPath,
    handlers,
    modelsPath: app.config.modelsPath,
    logger,
  });

  await app.db.processing.applyChordsResult({
    projectId: task.projectId,
    blobId: chords.blobId,
  });
};
