import { createBlobGarbageCollector } from '@musetric/utils/node';
import { type FastifyInstance } from 'fastify';
import { envs } from '../common/envs.js';

export const registerBlobGarbageCollector = (app: FastifyInstance) => {
  const blobGarbageCollector = createBlobGarbageCollector({
    blobStorage: app.blobStorage,
    gcIntervalMs: envs.gcIntervalMs,
    blobRetentionMs: envs.blobRetentionMs,
    getReferencedBlobIds: async () => await app.db.blob.list(),
  });

  app.addHook('onReady', () => {
    blobGarbageCollector.start();
  });

  app.addHook('onClose', () => {
    blobGarbageCollector.stop();
  });
};
