import { type BlobStorage, createBlobStorage } from '@musetric/utils/node';
import { type FastifyInstance } from 'fastify';
import { envs } from '../common/envs.js';

declare module 'fastify' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyInstance {
    blobStorage: BlobStorage;
  }
}

export const registerBlobStorage = (app: FastifyInstance) => {
  const blobStorage = createBlobStorage(envs.blobsPath);
  app.decorate('blobStorage', blobStorage);
};
