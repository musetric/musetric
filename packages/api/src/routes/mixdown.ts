import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const bitDepthSchema = z.union([z.literal(16), z.literal(24)]);
export type BitDepth = z.infer<typeof bitDepthSchema>;

export const bitrateSchema = z.union([
  z.literal(128),
  z.literal(192),
  z.literal(256),
]);
export type Bitrate = z.infer<typeof bitrateSchema>;

export const formatSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('m4a'), bitrate: bitrateSchema }),
  z.object({ format: z.literal('mp3'), bitrate: bitrateSchema }),
  z.object({ format: z.literal('flac'), bitDepth: bitDepthSchema }),
  z.object({ format: z.literal('wav'), bitDepth: bitDepthSchema }),
]);
export type Format = z.infer<typeof formatSchema>;

const volumeSchema = z.number().min(0).max(1);

export const volumesSchema = z.object({
  lead: volumeSchema,
  backing: volumeSchema,
  instrumental: volumeSchema,
  recording: volumeSchema,
});

export namespace create {
  export const base = createApiRoute({
    method: 'post',
    path: '/api/project/:projectId/mixdown',
    paramsSchema: z.object({ projectId: z.number() }),
    requestSchema: z.intersection(
      formatSchema,
      z.object({ volumes: volumesSchema }),
    ),
    responseSchema: z.object({ mixdownId: z.string() }),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace content {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/mixdown/:mixdownId/content',
    paramsSchema: z.object({ mixdownId: z.string() }),
    requestSchema: z.void(),
    responseSchema: z.instanceof(Uint8Array<ArrayBuffer>),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
