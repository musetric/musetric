import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const rhythmSchema = z.object({
  bpm: z.number(),
  beats: z.array(z.number()),
  downbeats: z.array(z.number()),
  meter: z.number().int(),
});
export type Rhythm = z.infer<typeof rhythmSchema>;

export namespace get {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/rhythm/project/:projectId',
    paramsSchema: z.object({
      projectId: z.number(),
    }),
    requestSchema: z.void(),
    responseSchema: rhythmSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
