import { api } from '@musetric/api';
import { fastifyRoute } from '@musetric/api/node';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { assertFound } from '../common/assertFound.js';
import { handleCachedFile } from '../common/cachedFile.js';

export const keyRouter: FastifyPluginCallbackZod = (app) => {
  app.addHook('onRoute', (opts) => {
    if (opts.schema) opts.schema.tags = ['key'];
  });

  app.route({
    ...fastifyRoute(api.key.get.base),
    handler: async (request, reply) => {
      const { projectId } = request.params;

      const key = await app.db.key.getByProject(projectId);
      assertFound(key, `Key for project ${projectId} not found`);

      const project = await app.db.project.get(projectId);
      assertFound(project, `Project with id ${projectId} not found`);

      const stat = await app.blobStorage.getStat(key.blobId);
      assertFound(stat, `Key blob for project ${projectId} not found`);

      const isNotModified = handleCachedFile(request, reply, {
        filename: `${project.name}_key.json`,
        contentType: 'application/json',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });

      if (isNotModified) {
        return;
      }

      const stream = app.blobStorage.getStream(key.blobId);
      return reply.send(stream);
    },
  });
};
