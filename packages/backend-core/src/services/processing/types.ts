import { type api } from '@musetric/api';
import { type Logger, type MessageHandlers } from '@musetric/utils';
import { type FastifyInstance } from 'fastify';

export type ProcessingTask = {
  projectId: number;
  blobId: string;
};

export type ProcessingHandlers = MessageHandlers<
  | { type: 'progress'; progress: number }
  | ({ type: 'download' } & api.project.Download)
>;

export type ProcessingContext = {
  app: FastifyInstance;
  logger: Logger;
  task: ProcessingTask;
  handlers: ProcessingHandlers;
};

export type ProcessingStep = (context: ProcessingContext) => Promise<void>;
