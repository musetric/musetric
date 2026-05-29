import { api } from '@musetric/api';
import { fastifyRoute } from '@musetric/api/node';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { assertFound } from '../common/assertFound.js';
import { handleCachedFile } from '../common/cachedFile.js';

export const chordsRouter: FastifyPluginCallbackZod = (app) => {
  app.addHook('onRoute', (opts) => {
    if (opts.schema) opts.schema.tags = ['chords'];
  });

  app.route({
    ...fastifyRoute(api.chords.get.base),
    handler: async (request, reply) => {
      const { projectId } = request.params;

      const chords = await app.db.chords.getByProject(projectId);
      assertFound(chords, `Chords for project ${projectId} not found`);

      const project = await app.db.project.get(projectId);
      assertFound(project, `Project with id ${projectId} not found`);

      const stat = await app.blobStorage.getStat(chords.blobId);
      assertFound(stat, `Chords blob for project ${projectId} not found`);

      const isNotModified = handleCachedFile(request, reply, {
        filename: `${project.name}_chords.json`,
        contentType: 'application/json',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });

      if (isNotModified) {
        return;
      }

      const stream = app.blobStorage.getStream(chords.blobId);
      return reply.send(stream);
    },
  });
};
