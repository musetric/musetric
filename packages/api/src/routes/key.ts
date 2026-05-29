import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const keyModeSchema = z.enum(['major', 'minor']);
export type KeyMode = z.infer<typeof keyModeSchema>;

export const keySchema = z.object({
  root: z.string(),
  mode: keyModeSchema,
  confidence: z.number(),
});
export type Key = z.infer<typeof keySchema>;

export namespace get {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/key/project/:projectId',
    paramsSchema: z.object({
      projectId: z.number(),
    }),
    requestSchema: z.void(),
    responseSchema: keySchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
