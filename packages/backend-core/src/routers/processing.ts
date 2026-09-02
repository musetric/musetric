import { PassThrough } from 'node:stream';
import { type api } from '@musetric/api';
import { bindLogger } from '@musetric/utils';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  fastifyStepSchema,
  readStepFailure,
  runProcessingStep,
} from '../services/processing/runStep.js';
import { type ProcessingHandlers } from '../services/processing/types.js';

const runSchema = z.object({
  step: fastifyStepSchema,
  projectId: z.number(),
  blobId: z.string(),
});

type RunMessage =
  | { type: 'progress'; progress: number }
  | { type: 'download'; download: api.project.Download }
  | { type: 'done' }
  | { type: 'failed'; error: string };

export const processingRouter: FastifyPluginCallbackZod = (app) => {
  app.route({
    method: 'POST',
    url: '/api/internal/processing/run',
    schema: { body: runSchema, hide: true },
    handler: (request, reply) => {
      const { step, projectId, blobId } = request.body;
      const logger = bindLogger(app.log, app.config.logLevel);
      const stream = new PassThrough();
      stream.on('error', (error) => {
        logger.error({ projectId, step, error }, 'A processing stream broke');
      });
      const send = (message: RunMessage): void => {
        stream.write(`${JSON.stringify(message)}\n`);
      };
      const handlers: ProcessingHandlers = {
        progress: (message) => {
          send({ type: 'progress', progress: message.progress });
        },
        download: (message) => {
          send({
            type: 'download',
            download: {
              label: message.label,
              file: message.file,
              downloaded: message.downloaded,
              total: message.total,
              status: message.status,
            },
          });
        },
      };
      const context = {
        app,
        logger,
        task: { projectId, blobId },
        handlers,
      };
      void runProcessingStep(step, context)
        .then(() => {
          send({ type: 'done' });
        })
        .catch((error: unknown) => {
          logger.error({ projectId, step, error }, 'A processing step failed');
          send({ type: 'failed', error: readStepFailure(step, error) });
        })
        .finally(() => {
          stream.end();
        });
      return reply.type('application/x-ndjson').send(stream);
    },
  });
};
