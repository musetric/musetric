import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const downloadSizeSchema = z.object({
  totalBytes: z.number(),
  missingBytes: z.number(),
});

export namespace download {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/models/download',
    paramsSchema: z.void(),
    requestSchema: z.void(),
    responseSchema: downloadSizeSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
