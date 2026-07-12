import { transcribeAudio } from '@musetric/ai/node';
import { type EventEmitter, type Logger } from '@musetric/utils';
import { type FastifyInstance } from 'fastify';
import { envs } from '../../common/envs.js';
import {
  type ProcessingWorkerEvent,
  type ProcessingWorkerProgressEvent,
} from './processingSummary.js';

export type TranscriptionTask = {
  projectId: number;
  blobId: string;
};

export type TranscriptionWorker = {
  run: (task: TranscriptionTask) => Promise<void>;
  getState: (projectId: number) => ProcessingWorkerProgressEvent | undefined;
};

export const createTranscriptionWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): TranscriptionWorker => {
  let state: ProcessingWorkerProgressEvent | undefined = undefined;

  return {
    run: async (task) => {
      try {
        state = {
          type: 'progress',
          projectId: task.projectId,
          step: 'transcription',
          progress: 0,
        };
        emitter.emit(state);

        const sourcePath = app.blobStorage.getPath(task.blobId);
        const transcription = app.blobStorage.createPath();

        await transcribeAudio({
          sourcePath,
          resultPath: transcription.blobPath,
          handlers: {
            progress: (message) => {
              if (!state) {
                return;
              }
              state = {
                ...state,
                progress: message.progress,
              };
              emitter.emit(state);
            },
            download: (message) => {
              if (!state) {
                return;
              }
              state = {
                ...state,
                download: message,
              };
              emitter.emit(state);
            },
          },
          modelsPath: envs.modelsPath,
          logger,
        });

        await app.db.processing.applyTranscriptionResult({
          projectId: task.projectId,
          blobId: transcription.blobId,
        });

        emitter.emit({
          type: 'complete',
          projectId: task.projectId,
          step: 'transcription',
        });
        state = undefined;
      } catch (error) {
        emitter.emit({
          type: 'error',
          projectId: task.projectId,
          step: 'transcription',
        });
        state = undefined;
        logger.error(
          { projectId: task.projectId, error },
          'Transcription failed',
        );
      }
    },
    getState: (projectId) =>
      state && state.projectId === projectId ? state : undefined,
  };
};
