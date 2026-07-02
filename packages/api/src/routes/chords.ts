import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const chordSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  label: z.string(),
  root: z.string(),
  quality: z.string().nullable(),
});
export type ChordSegment = z.infer<typeof chordSegmentSchema>;

export const chordsSchema = z.object({
  segments: z.array(chordSegmentSchema),
});

export namespace get {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/chords/project/:projectId',
    paramsSchema: z.object({
      projectId: z.number(),
    }),
    requestSchema: z.void(),
    responseSchema: chordsSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
