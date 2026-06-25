import { analyzeRhythm } from '@musetric/toolkit';
import { type EventEmitter, type Logger } from '@musetric/utils';
import { type FastifyInstance } from 'fastify';
import { envs } from '../../common/envs.js';
import {
  type ProcessingWorkerEvent,
  type ProcessingWorkerProgressEvent,
} from './processingSummary.js';

export type RhythmTask = {
  projectId: number;
  blobId: string;
};

export type RhythmWorker = {
  run: (task: RhythmTask) => Promise<void>;
  getState: (projectId: number) => ProcessingWorkerProgressEvent | undefined;
};

export const createRhythmWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): RhythmWorker => {
  let state: ProcessingWorkerProgressEvent | undefined = undefined;

  return {
    run: async (task) => {
      try {
        state = {
          type: 'progress',
          projectId: task.projectId,
          step: 'rhythm',
          progress: 0,
        };
        emitter.emit(state);

        const sourcePath = app.blobStorage.getPath(task.blobId);
        const rhythm = app.blobStorage.createPath();

        await analyzeRhythm({
          sourcePath,
          resultPath: rhythm.blobPath,
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

        await app.db.processing.applyRhythmResult({
          projectId: task.projectId,
          blobId: rhythm.blobId,
        });

        emitter.emit({
          type: 'complete',
          projectId: task.projectId,
          step: 'rhythm',
        });
        state = undefined;
      } catch (error) {
        emitter.emit({
          type: 'error',
          projectId: task.projectId,
          step: 'rhythm',
        });
        state = undefined;
        logger.error(
          { projectId: task.projectId, error },
          'Rhythm analysis failed',
        );
      }
    },
    getState: (projectId) =>
      state && state.projectId === projectId ? state : undefined,
  };
};
