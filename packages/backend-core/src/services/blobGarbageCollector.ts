import { createBlobGarbageCollector } from '@musetric/utils/node';
import { type FastifyInstance } from 'fastify';
import { blobRetentionMs, gcIntervalMs } from '../common/config.js';

export const registerBlobGarbageCollector = (app: FastifyInstance) => {
  const blobGarbageCollector = createBlobGarbageCollector({
    blobStorage: app.blobStorage,
    gcIntervalMs,
    blobRetentionMs,
    getReferencedBlobIds: async () => await app.db.blob.list(),
  });

  app.addHook('onReady', () => {
    blobGarbageCollector.start();
  });

  app.addHook('onClose', () => {
    blobGarbageCollector.stop();
  });
};
