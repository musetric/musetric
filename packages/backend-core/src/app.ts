import { fastify, type FastifyInstance, LogController } from 'fastify';
import { FastifySSEPlugin } from 'fastify-sse-v2';
import { type AppConfig } from './common/config.js';
import { registerRouters } from './routers/index.js';
import {
  disableRequestLogging,
  registerApiLogger,
} from './services/apiLogger.js';
import { registerBlobStorage } from './services/blobStorage.js';
import { registerDb } from './services/db.js';
import { createLoggerOptions } from './services/logger.js';
import { registerMultipart } from './services/multipart.js';
import { registerSchemaCompiler } from './services/schemaCompiler.js';

declare module 'fastify' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyInstance {
    config: AppConfig;
  }
}

export const createServerApp = async (
  config: AppConfig,
): Promise<FastifyInstance> => {
  const app: FastifyInstance = fastify({
    logger: createLoggerOptions(config.logLevel, config.logDestination),
    logController: new LogController({ disableRequestLogging }),
    // eslint-disable-next-line musetric/no-null-literal
    https: config.https ?? null,
  });
  app.decorate('config', config);
  registerApiLogger(app);
  await registerDb(app);
  registerBlobStorage(app);
  registerMultipart(app);
  app.register(FastifySSEPlugin);
  registerSchemaCompiler(app);
  registerRouters(app);
  return app;
};
