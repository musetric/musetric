import { z } from 'zod';
import { createApiEvent } from '../common/apiEvent.js';
import { createApiRoute } from '../common/apiRoute.js';
import { preview } from './index.js';

export const downloadStatusSchema = z.enum(['processing', 'cached', 'done']);
export type DownloadStatus = z.infer<typeof downloadStatusSchema>;

export const downloadSchema = z.object({
  label: z.string(),
  file: z.string().optional(),
  downloaded: z.number(),
  total: z.number().optional(),
  status: downloadStatusSchema.optional(),
});
export type Download = z.infer<typeof downloadSchema>;

export const processingStepStatusSchema = z.enum([
  'pending',
  'processing',
  'done',
]);
export type ProcessingStepStatus = z.infer<typeof processingStepStatusSchema>;

export const processingStepSchema = z.object({
  status: processingStepStatusSchema,
  progress: z.number().optional(),
  download: downloadSchema.optional(),
});
export type ProcessingStep = z.infer<typeof processingStepSchema>;

export const processingSchema = z.object({
  done: z.boolean().optional(),
  steps: z.object({
    separation: processingStepSchema,
    transcription: processingStepSchema,
  }),
});
export type Processing = z.infer<typeof processingSchema>;

export const itemSchema = z.object({
  id: z.number(),
  name: z.string().min(3),
  sampleRate: z.number().int().positive(),
  frameCount: z.number().int().positive(),
  previewUrl: z.string().optional(),
  processing: processingSchema,
});
export type Item = z.infer<typeof itemSchema>;

export namespace list {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/project/list',
    paramsSchema: z.void(),
    requestSchema: z.void(),
    responseSchema: z.array(itemSchema),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace get {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/project/:projectId',
    paramsSchema: z.object({ projectId: z.number() }),
    requestSchema: z.void(),
    responseSchema: itemSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace status {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/project/status/stream',
    paramsSchema: z.void(),
    requestSchema: z.void(),
    responseSchema: z
      .string()
      .describe(
        'Server-Sent Events stream (text/event-stream) with JSON encoded project status updates and heartbeat events.',
      ),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;

  export const event = createApiEvent({
    path: '/api/project/status/stream',
    schema: z.object({
      projectId: z.number(),
      processing: processingSchema,
    }),
  });
  export type Event = z.infer<typeof event.schema>;
}

export namespace realtime {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/project/:projectId/realtime',
    paramsSchema: z.object({ projectId: z.coerce.number() }),
    requestSchema: z.void(),
    responseSchema: z.void(),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace create {
  export const base = createApiRoute({
    method: 'post',
    path: '/api/project/create',
    paramsSchema: z.void(),
    requestSchema: z.object({
      song: z.file(),
      name: itemSchema.shape.name,
      preview: preview.itemSchema.optional(),
    }),
    responseSchema: itemSchema,
    isMultipart: true,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace edit {
  export const base = createApiRoute({
    method: 'patch',
    path: '/api/project/:projectId/edit',
    paramsSchema: z.object({ projectId: z.number() }),
    requestSchema: z
      .object({
        name: itemSchema.shape.name,
        preview: preview.itemSchema,
        withoutPreview: z.boolean(),
      })
      .partial(),
    responseSchema: itemSchema,
    isMultipart: true,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace remove {
  export const base = createApiRoute({
    method: 'delete',
    path: '/api/project/:projectId/remove',
    paramsSchema: z.object({ projectId: z.number() }),
    requestSchema: z.void(),
    responseSchema: z.void(),
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
