import { type FastifyInstance } from 'fastify';
import {
  createProcessingWorker,
  type ProcessingWorker,
} from './processingWorker.js';

declare module 'fastify' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyInstance {
    processingWorker: ProcessingWorker;
  }
}

export const registerProcessingWorker = (
  app: FastifyInstance,
  withProcessingWorker: boolean,
) => {
  const processingWorker = createProcessingWorker(app);

  if (withProcessingWorker) {
    app.addHook('onReady', () => {
      processingWorker.start();
    });
  }
  app.addHook('onClose', () => {
    processingWorker.stop();
  });
  app.decorate('processingWorker', processingWorker);
};
