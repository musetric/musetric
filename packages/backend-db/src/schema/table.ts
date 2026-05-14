import { z } from 'zod';
import { numericIdSchema } from './common.js';

export namespace project {
  export const itemSchema = z.object({
    id: numericIdSchema,
    name: z.string(),
    sampleRate: z.number().int().positive(),
    frameCount: z.number().int().positive(),
  });
  export type Item = z.infer<typeof itemSchema>;
}

export namespace audioAsset {
  export const itemSchema = z.object({
    id: numericIdSchema,
    projectId: numericIdSchema,
    blobId: z.string(),
  });
  export type Item = z.infer<typeof itemSchema>;
}

export namespace audioWavePeaks {
  export const itemSchema = z.object({
    id: numericIdSchema,
    audioAssetId: numericIdSchema,
    blobId: z.string(),
  });
  export type Item = z.infer<typeof itemSchema>;
}

export namespace audioMaster {
  export const typeSchema = z.enum([
    'source',
    'lead',
    'backing',
    'instrumental',
  ]);
  export type Type = z.infer<typeof typeSchema>;

  export const itemSchema = z.object({
    id: numericIdSchema,
    projectId: numericIdSchema,
    type: typeSchema,
    audioAssetId: numericIdSchema,
    blobId: z.string(),
  });
  export type Item = z.infer<typeof itemSchema>;
}

export namespace audioDelivery {
  export const stemTypeSchema = z.enum(['lead', 'backing', 'instrumental']);
  export type StemType = z.infer<typeof stemTypeSchema>;

  export const itemSchema = z.object({
    id: numericIdSchema,
    projectId: numericIdSchema,
    stemType: stemTypeSchema,
    audioAssetId: numericIdSchema,
    blobId: z.string(),
  });
  export type Item = z.infer<typeof itemSchema>;
}

export namespace wavePeaks {
  export const stemTypeSchema = z.enum(['lead', 'backing', 'instrumental']);
  export type StemType = z.infer<typeof stemTypeSchema>;

  export const itemSchema = z.object({
    id: numericIdSchema,
    projectId: numericIdSchema,
    stemType: stemTypeSchema,
    audioAssetId: numericIdSchema,
    blobId: z.string(),
  });
  export type Item = z.infer<typeof itemSchema>;
}

export namespace preview {
  export const itemSchema = z.object({
    id: numericIdSchema,
    projectId: numericIdSchema,
    blobId: z.string(),
    filename: z.string(),
    contentType: z.string(),
  });
  export type Item = z.infer<typeof itemSchema>;
}

export namespace subtitle {
  export const itemSchema = z.object({
    id: numericIdSchema,
    projectId: numericIdSchema,
    blobId: z.string(),
  });
  export type Item = z.infer<typeof itemSchema>;
}
