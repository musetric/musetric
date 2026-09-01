import { type api } from '@musetric/api';
import {
  type EventEmitter,
  type Logger,
  type MessageHandlers,
} from '@musetric/utils';
import {
  type ProcessingStepKind,
  type ProcessingWorkerEvent,
  type ProcessingWorkerProgressEvent,
} from './processingSummary.js';

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  return fallback;
};

export type AnalysisHandlers = MessageHandlers<
  | { type: 'progress'; progress: number }
  | ({ type: 'download' } & api.project.Download)
>;

export type AnalysisWorker<Task> = {
  run: (task: Task) => Promise<void>;
  getState: (projectId: number) => ProcessingWorkerProgressEvent | undefined;
};

export type AnalysisWorkerConfig<Task> = {
  step: ProcessingStepKind;
  errorMessage: string;
  process: (task: Task, handlers: AnalysisHandlers) => Promise<void>;
};

export type ProcessingErrorStore = {
  recordError: (arg: {
    projectId: number;
    step: ProcessingStepKind;
    message: string;
  }) => Promise<void>;
};

export const createAnalysisWorker = <Task extends { projectId: number }>(
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
  processingErrors: ProcessingErrorStore,
  config: AnalysisWorkerConfig<Task>,
): AnalysisWorker<Task> => {
  const { step, errorMessage, process } = config;
  let state: ProcessingWorkerProgressEvent | undefined = undefined;

  const handlers: AnalysisHandlers = {
    progress: (message) => {
      if (!state) {
        return;
      }
      state = { ...state, progress: message.progress };
      emitter.emit(state);
    },
    download: (message) => {
      if (!state) {
        return;
      }
      state = { ...state, download: message };
      emitter.emit(state);
    },
  };

  return {
    run: async (task) => {
      try {
        state = {
          type: 'progress',
          projectId: task.projectId,
          step,
          progress: 0,
        };
        emitter.emit(state);

        await process(task, handlers);

        emitter.emit({ type: 'complete', projectId: task.projectId, step });
        state = undefined;
      } catch (error) {
        const message = getErrorMessage(error, errorMessage);
        try {
          await processingErrors.recordError({
            projectId: task.projectId,
            step,
            message,
          });
        } catch (recordError) {
          logger.error(
            { projectId: task.projectId, error: recordError },
            'Failed to record processing error',
          );
        }
        emitter.emit({
          type: 'error',
          projectId: task.projectId,
          step,
          error: message,
        });
        state = undefined;
        logger.error({ projectId: task.projectId, error }, errorMessage);
      }
    },
    getState: (projectId) =>
      state && state.projectId === projectId ? state : undefined,
  };
};
