import { transcribeAudio } from '@musetric/ai/node';
import { type ProcessingStep } from './types.js';

export const runTranscription: ProcessingStep = async (context) => {
  const { app, logger, task, handlers } = context;
  const sourcePath = app.blobStorage.getPath(task.blobId);
  const transcription = app.blobStorage.createPath();

  await transcribeAudio({
    gpuHost: app.gpuHost,
    sourcePath,
    resultPath: transcription.blobPath,
    handlers,
    modelsPath: app.config.modelsPath,
    logger,
  });

  await app.db.processing.applyTranscriptionResult({
    projectId: task.projectId,
    blobId: transcription.blobId,
  });
};
