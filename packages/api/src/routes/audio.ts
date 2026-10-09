import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const masterTypeSchema = z.enum([
  'source',
  'vocals',
  'lead',
  'backing',
  'instrumental',
]);

export const deliveryStemTypeSchema = z.enum([
  'lead',
  'backing',
  'instrumental',
]);

const masterParamsSchema = z.object({
  projectId: z.number(),
  type: masterTypeSchema,
});

const deliveryParamsSchema = z.object({
  projectId: z.number(),
  stemType: deliveryStemTypeSchema,
});

const recordingParamsSchema = z.object({
  projectId: z.number(),
  recordingId: z.number(),
});

const recordingPieceParamsSchema = z.object({
  projectId: z.number(),
  recordingId: z.number(),
  blobId: z.string(),
});

export const recordingPieceSchema = z.object({
  blobId: z.string(),
  sampleRate: z.number(),
  songStartFrame: z.number(),
  frameCount: z.number(),
  tempo: z.number(),
});

export namespace masterContent {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/audio/project/:projectId/master/:type/content',
    paramsSchema: masterParamsSchema,
    requestSchema: z.void(),
    responseSchema: z.instanceof(Uint8Array<ArrayBuffer>),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace deliveryContent {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/audio/project/:projectId/delivery/:stemType/content',
    paramsSchema: deliveryParamsSchema,
    requestSchema: z.void(),
    responseSchema: z.instanceof(Uint8Array<ArrayBuffer>),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace deliveryWave {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/audio/project/:projectId/delivery/:stemType/wave',
    paramsSchema: deliveryParamsSchema,
    requestSchema: z.void(),
    responseSchema: z.instanceof(Float32Array<ArrayBuffer>),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace recordingPieces {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/audio/project/:projectId/recording/:recordingId/pieces',
    paramsSchema: recordingParamsSchema,
    requestSchema: z.void(),
    responseSchema: z.object({ pieces: z.array(recordingPieceSchema) }),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace recordingPiece {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/audio/project/:projectId/recording/:recordingId/piece/:blobId',
    paramsSchema: recordingPieceParamsSchema,
    requestSchema: z.void(),
    responseSchema: z.instanceof(Uint8Array<ArrayBuffer>),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace recordingWave {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/audio/project/:projectId/recording/:recordingId/wave',
    paramsSchema: recordingParamsSchema,
    requestSchema: z.void(),
    responseSchema: z.instanceof(Float32Array<ArrayBuffer>),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
