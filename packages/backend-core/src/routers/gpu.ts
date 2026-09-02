import { randomUUID } from 'node:crypto';
import { type OpenedPage } from '@musetric/ai/node';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const openSchema = z.object({ url: z.string() });
const pageParamsSchema = z.object({ pageId: z.string() });

export const gpuRouter: FastifyPluginCallbackZod = (app) => {
  const pages = new Map<string, OpenedPage>();

  app.addHook('onClose', async () => {
    const opened = [...pages.values()];
    pages.clear();
    await Promise.all(opened.map(async (page) => page.close()));
  });

  app.route({
    method: 'POST',
    url: '/api/internal/gpu/page',
    schema: { body: openSchema, hide: true },
    handler: async (request) => {
      const page = await app.gpuHost.openPage(request.body.url);
      const pageId = randomUUID();
      pages.set(pageId, page);
      return { pageId };
    },
  });

  app.route({
    method: 'DELETE',
    url: '/api/internal/gpu/page/:pageId',
    schema: { params: pageParamsSchema, hide: true },
    handler: async (request, reply) => {
      const page = pages.get(request.params.pageId);
      pages.delete(request.params.pageId);
      await page?.close();
      reply.status(200).send();
    },
  });
};
