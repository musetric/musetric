import { type EventEmitter, type Logger } from '@musetric/resource-utils';
import { analyzeChords } from '@musetric/toolkit';
import { type FastifyInstance } from 'fastify';
import { envs } from '../../common/envs.js';
import {
  type ProcessingWorkerEvent,
  type ProcessingWorkerProgressEvent,
} from './processingSummary.js';

export type ChordsTask = {
  projectId: number;
  blobId: string;
};

export type ChordsWorker = {
  run: (task: ChordsTask) => Promise<void>;
  getState: (projectId: number) => ProcessingWorkerProgressEvent | undefined;
};

export const createChordsWorker = (
  app: FastifyInstance,
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
): ChordsWorker => {
  let state: ProcessingWorkerProgressEvent | undefined = undefined;

  return {
    run: async (task) => {
      try {
        state = {
          type: 'progress',
          projectId: task.projectId,
          step: 'chords',
          progress: 0,
        };
        emitter.emit(state);

        const sourcePath = app.blobStorage.getPath(task.blobId);
        const chords = app.blobStorage.createPath();

        await analyzeChords({
          sourcePath,
          resultPath: chords.blobPath,
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

        await app.db.processing.applyChordsResult({
          projectId: task.projectId,
          blobId: chords.blobId,
        });

        emitter.emit({
          type: 'complete',
          projectId: task.projectId,
          step: 'chords',
        });
        state = undefined;
      } catch (error) {
        emitter.emit({
          type: 'error',
          projectId: task.projectId,
          step: 'chords',
        });
        state = undefined;
        logger.error(
          { projectId: task.projectId, error },
          'Chord detection failed',
        );
      }
    },
    getState: (projectId) =>
      state && state.projectId === projectId ? state : undefined,
  };
};
