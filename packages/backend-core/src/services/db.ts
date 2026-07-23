import { DB } from '@musetric/backend-db';
import { type FastifyInstance } from 'fastify';

declare module 'fastify' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface FastifyInstance {
    db: DB.Instance;
  }
}

export const registerDb = async (app: FastifyInstance) => {
  const db = await DB.createInstance(app.config.databasePath);
  app.addHook('onClose', async () => {
    await db.disconnect();
  });
  app.decorate('db', db);
};
