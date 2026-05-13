import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const masterTypeSchema = z.enum([
  'source',
  'lead',
  'backing',
  'instrumental',
]);
export type MasterType = z.infer<typeof masterTypeSchema>;

export const deliveryStemTypeSchema = z.enum([
  'lead',
  'backing',
  'instrumental',
]);
export type DeliveryStemType = z.infer<typeof deliveryStemTypeSchema>;

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

export namespace recordingContent {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/audio/project/:projectId/recording/content',
    paramsSchema: recordingParamsSchema,
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
    path: '/api/audio/project/:projectId/recording/wave',
    paramsSchema: recordingParamsSchema,
    requestSchema: z.void(),
    responseSchema: z.instanceof(Float32Array<ArrayBuffer>),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
