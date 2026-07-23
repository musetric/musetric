import websocket from '@fastify/websocket';
import {
  defaultGpuPageHostFactory,
  type GpuHost,
  type GpuPageHostFactory,
} from '@musetric/ai/node';
import { fastify, type FastifyInstance } from 'fastify';
import { FastifySSEPlugin } from 'fastify-sse-v2';
import { type AppConfig } from './common/config.js';
import { registerRouters } from './routers/index.js';
import {
  disableRequestLogging,
  registerApiLogger,
} from './services/apiLogger.js';
import { registerBlobGarbageCollector } from './services/blobGarbageCollector.js';
import { registerBlobStorage } from './services/blobStorage.js';
import { registerDb } from './services/db.js';
import { registerFrontend } from './services/frontend.js';
import { createLoggerOptions } from './services/logger.js';
import { registerMultipart } from './services/multipart.js';
import { registerProcessingWorker } from './services/processingWorker/registerProcessingWorker.js';
import { registerSchemaCompiler } from './services/schemaCompiler.js';
import { registerSwagger } from './services/swagger.js';

declare module 'fastify' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyInstance {
    config: AppConfig;
    gpuHost: GpuHost;
  }
}

export type CreateServerAppOptions = {
  gpuPageHostFactory?: GpuPageHostFactory;
};

export const createServerApp = async (
  config: AppConfig,
  options: CreateServerAppOptions = {},
): Promise<FastifyInstance> => {
  const app: FastifyInstance = fastify({
    logger: createLoggerOptions(config.logLevel),
    disableRequestLogging,
    // eslint-disable-next-line musetric/no-null-literal
    https: config.https ?? null,
  });
  app.decorate('config', config);
  app.decorate('gpuHost', {
    createGpuPage: options.gpuPageHostFactory ?? defaultGpuPageHostFactory,
    browserBundlePath: config.browserBundlePath,
  });
  registerApiLogger(app);
  await registerDb(app);
  registerBlobStorage(app);
  registerBlobGarbageCollector(app);
  registerProcessingWorker(app);
  registerMultipart(app);
  app.register(FastifySSEPlugin);
  await app.register(websocket);
  registerSchemaCompiler(app);
  registerSwagger(app);
  registerFrontend(app);
  registerRouters(app);
  return app;
};
