import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const executorSchema = z.object({
  url: z.string(),
});

export namespace get {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/executor',
    paramsSchema: z.void(),
    requestSchema: z.void(),
    responseSchema: executorSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
