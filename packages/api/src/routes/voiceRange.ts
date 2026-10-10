import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const voicePitchRangeSchema = z.object({
  minFrequency: z.number(),
  maxFrequency: z.number(),
});

export const voiceSpectrumBandSchema = z.object({
  minFrequency: z.number(),
  maxFrequency: z.number(),
  levelDb: z.number(),
});

export const voiceRangeSchema = z.object({
  pitch: voicePitchRangeSchema.optional(),
  bands: z.array(voiceSpectrumBandSchema),
});

export namespace get {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/voice-range/project/:projectId',
    paramsSchema: z.object({
      projectId: z.number(),
    }),
    requestSchema: z.void(),
    responseSchema: voiceRangeSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
