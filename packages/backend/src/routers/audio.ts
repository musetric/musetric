import { Readable } from 'node:stream';
import { api } from '@musetric/api';
import { fastifyRoute } from '@musetric/api/node';
import {
  emptyWavePeaksBuffer,
  flacAudioOutput,
  fmp4AudioOutput,
} from '@musetric/toolkit';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { assertFound } from '../common/assertFound.js';
import { handleCachedFile } from '../common/cachedFile.js';
import {
  createEmptyWavBuffer,
  wavContentType,
} from '../services/recordingWav.js';

type SendCachedBlobArg = {
  request: FastifyRequest;
  reply: FastifyReply;
  blobId: string;
  notFoundMessage: string;
  filename: string;
  contentType: string;
};

export const audioRouter: FastifyPluginCallbackZod = (app) => {
  app.addHook('onRoute', (opts) => {
    if (opts.schema) opts.schema.tags = ['audio'];
  });

  const sendCachedBlob = async (arg: SendCachedBlobArg) => {
    const stat = await app.blobStorage.getStat(arg.blobId);
    assertFound(stat, arg.notFoundMessage);

    const isNotModified = handleCachedFile(arg.request, arg.reply, {
      filename: arg.filename,
      contentType: arg.contentType,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });

    if (isNotModified) {
      return undefined;
    }

    return arg.reply.send(app.blobStorage.getStream(arg.blobId));
  };

  app.route({
    ...fastifyRoute(api.audio.masterContent.base),
    handler: async (request, reply) => {
      const { projectId, type } = request.params;
      const audio = await app.db.audioMaster.get(projectId, type);
      assertFound(
        audio,
        `Audio master for project ${projectId} and type ${type} not found`,
      );

      const project = await app.db.project.get(projectId);
      assertFound(project, `Project with id ${projectId} not found`);

      const suffix = type === 'source' ? '' : `_${type}`;
      return await sendCachedBlob({
        request,
        reply,
        blobId: audio.blobId,
        notFoundMessage: `Audio master blob for id ${audio.blobId} not found`,
        filename: `${project.name}${suffix}.${flacAudioOutput.format}`,
        contentType: flacAudioOutput.contentType,
      });
    },
  });

  app.route({
    ...fastifyRoute(api.audio.deliveryContent.base),
    handler: async (request, reply) => {
      const { projectId, stemType } = request.params;
      const audio = await app.db.audioDelivery.get(projectId, stemType);
      assertFound(
        audio,
        `Audio delivery for project ${projectId} and stem type ${stemType} not found`,
      );

      const project = await app.db.project.get(projectId);
      assertFound(project, `Project with id ${projectId} not found`);

      return await sendCachedBlob({
        request,
        reply,
        blobId: audio.blobId,
        notFoundMessage: `Audio delivery blob for id ${audio.blobId} not found`,
        filename: `${project.name}_${stemType}.${fmp4AudioOutput.format}`,
        contentType: fmp4AudioOutput.contentType,
      });
    },
  });

  app.route({
    ...fastifyRoute(api.audio.deliveryWave.base),
    handler: async (request, reply) => {
      const { projectId, stemType } = request.params;
      const wavePeaks = await app.db.wavePeaks.get(projectId, stemType);
      assertFound(
        wavePeaks,
        `Wave peaks for project ${projectId} and stem type ${stemType} not found`,
      );

      return await sendCachedBlob({
        request,
        reply,
        blobId: wavePeaks.blobId,
        notFoundMessage: `Wave peaks blob for id ${wavePeaks.blobId} not found`,
        filename: 'waveform.bin',
        contentType: 'application/octet-stream',
      });
    },
  });

  app.route({
    ...fastifyRoute(api.audio.recordingContent.base),
    handler: async (request, reply) => {
      const { projectId } = request.params;
      const recording = await app.db.recording.get(projectId);
      if (!recording) {
        reply.headers({
          'Content-Type': wavContentType,
          'Cache-Control': 'no-store',
        });
        return reply.send(Readable.from([createEmptyWavBuffer()]));
      }

      const stat = await app.blobStorage.getStat(recording.blobId);
      assertFound(
        stat,
        `Recording audio blob for id ${recording.blobId} not found`,
      );
      reply.headers({
        'Content-Type': wavContentType,
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
      });
      return reply.send(app.blobStorage.getStream(recording.blobId));
    },
  });

  app.route({
    ...fastifyRoute(api.audio.recordingWave.base),
    handler: async (request, reply) => {
      const { projectId } = request.params;
      const recording = await app.db.recording.get(projectId);
      if (!recording) {
        reply.headers({
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        return reply.send(Readable.from([emptyWavePeaksBuffer]));
      }

      const stat = await app.blobStorage.getStat(recording.waveBlobId);
      assertFound(
        stat,
        `Recording wave blob for id ${recording.waveBlobId} not found`,
      );
      reply.headers({
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
      });
      return reply.send(app.blobStorage.getStream(recording.waveBlobId));
    },
  });
};
