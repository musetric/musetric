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

export const playbackSchema = z.object({
  tempoRatio: z.number().min(0.2).max(2),
  transposeSemitones: z.number().int().min(-6).max(6),
  leadOctave: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export namespace create {
  export const base = createApiRoute({
    method: 'post',
    path: '/api/project/:projectId/mixdown',
    paramsSchema: z.object({ projectId: z.number() }),
    requestSchema: z.object({
      format: formatSchema,
      volumes: volumesSchema,
      playback: playbackSchema,
      label: z.string().min(1),
      recording: z.file().optional(),
    }),
    responseSchema: z.object({ mixdownId: z.string() }),
    isMultipart: true,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export const stageSchema = z.enum(['mixing', 'stretching', 'encoding']);
export type Stage = z.infer<typeof stageSchema>;

export const statusSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('running'),
    stage: stageSchema,
    done: z.number().min(0).max(1).optional(),
  }),
  z.object({ state: z.literal('ready') }),
  z.object({ state: z.literal('failed'), error: z.string() }),
]);

const mixdownParamsSchema = z.object({ mixdownId: z.string() });

export namespace get {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/mixdown/:mixdownId',
    paramsSchema: mixdownParamsSchema,
    requestSchema: z.void(),
    responseSchema: statusSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace remove {
  export const base = createApiRoute({
    method: 'delete',
    path: '/api/mixdown/:mixdownId',
    paramsSchema: mixdownParamsSchema,
    requestSchema: z.void(),
    responseSchema: z.void(),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace content {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/mixdown/:mixdownId/content',
    paramsSchema: mixdownParamsSchema,
    requestSchema: z.void(),
    responseSchema: z.instanceof(Uint8Array<ArrayBuffer>),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
