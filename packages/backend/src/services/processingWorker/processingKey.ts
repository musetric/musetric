import { type EventEmitter, type Logger } from '@musetric/resource-utils';
import { analyzeKey } from '@musetric/toolkit';
import { type FastifyInstance } from 'fastify';
import { envs } from '../../common/envs.js';
import {
  type ProcessingWorkerEvent,
  type ProcessingWorkerProgressEvent,
} from './processingSummary.js';

export type KeyTask = {
  projectId: number;
  blobId: string;
};

export type KeyWorker = {
  run: (task: KeyTask) => Promise<void>;
  getState: (projectId: number) => ProcessingWorkerProgressEvent | undefined;
};

export const createKeyWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): KeyWorker => {
  let state: ProcessingWorkerProgressEvent | undefined = undefined;

  return {
    run: async (task) => {
      try {
        state = {
          type: 'progress',
          projectId: task.projectId,
          step: 'key',
          progress: 0,
        };
        emitter.emit(state);

        const sourcePath = app.blobStorage.getPath(task.blobId);
        const key = app.blobStorage.createPath();

        await analyzeKey({
          sourcePath,
          resultPath: key.blobPath,
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

        await app.db.processing.applyKeyResult({
          projectId: task.projectId,
          blobId: key.blobId,
        });

        emitter.emit({
          type: 'complete',
          projectId: task.projectId,
          step: 'key',
        });
        state = undefined;
      } catch (error) {
        emitter.emit({
          type: 'error',
          projectId: task.projectId,
          step: 'key',
        });
        state = undefined;
        logger.error(
          { projectId: task.projectId, error },
          'Key detection failed',
        );
      }
    },
    getState: (projectId) =>
      state && state.projectId === projectId ? state : undefined,
  };
};
