import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const processingStateSchema = z.object({
  paused: z.boolean(),
});

export namespace get {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/processing',
    paramsSchema: z.void(),
    requestSchema: z.void(),
    responseSchema: processingStateSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace pause {
  export const base = createApiRoute({
    method: 'post',
    path: '/api/processing/pause',
    paramsSchema: z.void(),
    requestSchema: processingStateSchema,
    responseSchema: z.void(),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace order {
  export const base = createApiRoute({
    method: 'post',
    path: '/api/processing/order',
    paramsSchema: z.void(),
    requestSchema: z.object({ projectIds: z.array(z.number().int()) }),
    responseSchema: z.void(),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
