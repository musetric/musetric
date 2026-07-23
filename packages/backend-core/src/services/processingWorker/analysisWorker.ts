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

export const createAnalysisWorker = <Task extends { projectId: number }>(
  emitter: EventEmitter<ProcessingWorkerEvent>,
  logger: Logger,
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
        emitter.emit({ type: 'error', projectId: task.projectId, step });
        state = undefined;
        logger.error({ projectId: task.projectId, error }, errorMessage);
      }
    },
    getState: (projectId) =>
      state && state.projectId === projectId ? state : undefined,
  };
};
