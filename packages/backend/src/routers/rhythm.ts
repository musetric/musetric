import { api } from '@musetric/api';
import { fastifyRoute } from '@musetric/api/node';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { assertFound } from '../common/assertFound.js';
import { handleCachedFile } from '../common/cachedFile.js';

export const rhythmRouter: FastifyPluginCallbackZod = (app) => {
  app.addHook('onRoute', (opts) => {
    if (opts.schema) opts.schema.tags = ['rhythm'];
  });

  app.route({
    ...fastifyRoute(api.rhythm.get.base),
    handler: async (request, reply) => {
      const { projectId } = request.params;

      const rhythm = await app.db.rhythm.getByProject(projectId);
      assertFound(rhythm, `Rhythm for project ${projectId} not found`);

      const project = await app.db.project.get(projectId);
      assertFound(project, `Project with id ${projectId} not found`);

      const stat = await app.blobStorage.getStat(rhythm.blobId);
      assertFound(stat, `Rhythm blob for project ${projectId} not found`);

      const isNotModified = handleCachedFile(request, reply, {
        filename: `${project.name}_rhythm.json`,
        contentType: 'application/json',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });

      if (isNotModified) {
        return;
      }

      const stream = app.blobStorage.getStream(rhythm.blobId);
      return reply.send(stream);
    },
  });
};
