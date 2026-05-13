import websocket from '@fastify/websocket';
import { fastify, type FastifyInstance } from 'fastify';
import { FastifySSEPlugin } from 'fastify-sse-v2';
import { registerRouters } from './routers/index.js';
import {
  disableRequestLogging,
  registerApiLogger,
} from './services/apiLogger.js';
import { registerBlobGarbageCollector } from './services/blobGarbageCollector.js';
import { registerBlobStorage } from './services/blobStorage.js';
import { registerDb } from './services/db.js';
import { registerFrontend } from './services/frontend.js';
import { getHttps } from './services/https.js';
import { logger } from './services/logger.js';
import { registerMultipart } from './services/multipart.js';
import { registerProcessingWorker } from './services/processingWorker/registerProcessingWorker.js';
import { registerSchemaCompiler } from './services/schemaCompiler.js';
import { registerSwagger } from './services/swagger.js';

export const createServerApp = async (): Promise<FastifyInstance> => {
  const https = await getHttps();
  const app: FastifyInstance = fastify({
    logger,
    disableRequestLogging,
    https,
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
