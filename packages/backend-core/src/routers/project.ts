import { api } from '@musetric/api';
import { fastifyRoute } from '@musetric/api/node';
import { bindLogger } from '@musetric/utils';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { assertFound } from '../common/assertFound.js';
import {
  resolveProcessing,
  resolveProcessingEvent,
} from '../services/processingWorker/processingSummary.js';
import { createProjectSource } from '../services/projectSource.js';

export const projectRouter: FastifyPluginCallbackZod = (app) => {
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.schema) {
      routeOptions.schema.tags = ['project'];
    }
  });

  const resolveAudioAnalysis = async (
    projectId: number,
  ): Promise<api.project.AudioAnalysis | undefined> => {
    const analysis = await app.db.projectAudioAnalysis.get(projectId);
    if (!analysis) {
      return undefined;
    }
    return {
      sourceGainDb: analysis.sourceGainDb,
      leadSpectrogramGainDb: analysis.leadSpectrogramGainDb,
    };
  };

  app.route({
    ...fastifyRoute(api.project.list.base),
    handler: async () => {
      const all = await app.db.project.list();
      return await Promise.all(
        all.map(async (project): Promise<api.project.list.Response[number]> => {
          const [processing, audioAnalysis] = await Promise.all([
            resolveProcessing(app, project.id),
            resolveAudioAnalysis(project.id),
          ]);
          return {
            ...project,
            previewUrl: api.preview.get.url(project.preview?.id),
            audioAnalysis,
            processing,
          };
        }),
      );
    },
  });

  app.route({
    ...fastifyRoute(api.project.get.base),
    handler: async (request) => {
      const { projectId } = request.params;
      const found = await app.db.project.get(projectId);
      assertFound(found, `Project with id ${projectId} not found`);
      const [processing, audioAnalysis] = await Promise.all([
        resolveProcessing(app, projectId),
        resolveAudioAnalysis(projectId),
      ]);
      const result: api.project.get.Response = {
        ...found,
        previewUrl: api.preview.get.url(found.preview?.id),
        audioAnalysis,
        processing,
      };
      return result;
    },
  });

  app.route({
    ...fastifyRoute(api.project.status.base),
    handler: (request, reply) => {
      const unsubscribe = app.processingWorker.emitter.subscribe((event) => {
        reply.sse({
          data: api.project.status.event.stringify({
            projectId: event.projectId,
            processing: resolveProcessingEvent(event),
          }),
        });
      });
      const heartbeat = setInterval(() => {
        reply.sse({ event: 'ping' });
      }, 30_000);

      request.socket.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      reply.sse({ comment: 'connected' });
    },
  });

  app.route({
    ...fastifyRoute(api.project.create.base),
    handler: async (request) => {
      const { song, name, preview } = request.body;

      const blobSong = await createProjectSource({
        blobStorage: app.blobStorage,
        file: song,
        logger: bindLogger(app.log, app.config.logLevel),
      });
      const blobPreview = preview
        ? await app.blobStorage.addFile(preview)
        : undefined;

      const created = await app.db.project.create({
        name,
        song: blobSong,
        sampleRate: blobSong.sampleRate,
        frameCount: blobSong.frameCount,
        preview: blobPreview,
      });

      const processing = await resolveProcessing(app, created.project.id);
      const result: api.project.create.Response = {
        ...created.project,
        previewUrl: api.preview.get.url(created.preview?.id),
        audioAnalysis: undefined,
        processing,
      };

      return result;
    },
  });

  app.route({
    ...fastifyRoute(api.project.edit.base),
    handler: async (request) => {
      const { projectId } = request.params;
      const { name, preview, withoutPreview } = request.body;

      const blobPreview = preview
        ? await app.blobStorage.addFile(preview)
        : undefined;

      const updated = await app.db.project.update({
        projectId,
        name,
        preview: blobPreview,
        withoutPreview,
      });

      assertFound(updated, `Project with id ${projectId} not found`);

      const processing = await resolveProcessing(app, projectId);
      const audioAnalysis = await resolveAudioAnalysis(projectId);
      const result: api.project.edit.Response = {
        ...updated.project,
        previewUrl: api.preview.get.url(updated.preview?.id),
        audioAnalysis,
        processing,
      };

      return result;
    },
  });

  app.route({
    ...fastifyRoute(api.project.remove.base),
    handler: async (request, reply) => {
      const { projectId } = request.params;
      const isRemoved = await app.db.project.remove(projectId);
      assertFound(
        isRemoved || undefined,
        `Project with id ${projectId} not found`,
      );
      reply.status(200).send();
    },
  });
};
