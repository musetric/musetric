import { z } from 'zod';
import { createApiRoute } from '../common/apiRoute.js';

export const nameMaxLength = 64;

export const nameSchema = z.string().trim().min(1).max(nameMaxLength);

export const itemSchema = z.object({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  empty: z.boolean(),
});
export type Item = z.infer<typeof itemSchema>;

export const listSchema = z.object({ recordings: z.array(itemSchema) });

const projectParamsSchema = z.object({ projectId: z.number() });

const recordingParamsSchema = z.object({
  projectId: z.number(),
  recordingId: z.number(),
});

export namespace list {
  export const base = createApiRoute({
    method: 'get',
    path: '/api/project/:projectId/recording/list',
    paramsSchema: projectParamsSchema,
    requestSchema: z.void(),
    responseSchema: listSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace create {
  export const base = createApiRoute({
    method: 'post',
    path: '/api/project/:projectId/recording/create',
    paramsSchema: projectParamsSchema,
    requestSchema: z.void(),
    responseSchema: listSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace edit {
  export const base = createApiRoute({
    method: 'patch',
    path: '/api/project/:projectId/recording/:recordingId/edit',
    paramsSchema: recordingParamsSchema,
    requestSchema: z.object({ name: nameSchema }),
    responseSchema: listSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace activate {
  export const base = createApiRoute({
    method: 'post',
    path: '/api/project/:projectId/recording/:recordingId/activate',
    paramsSchema: recordingParamsSchema,
    requestSchema: z.void(),
    responseSchema: listSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}

export namespace remove {
  export const base = createApiRoute({
    method: 'delete',
    path: '/api/project/:projectId/recording/:recordingId/remove',
    paramsSchema: recordingParamsSchema,
    requestSchema: z.void(),
    responseSchema: listSchema,
  });
  export type Params = z.infer<typeof base.paramsSchema>;
  export type Request = z.infer<typeof base.requestSchema>;
  export type Response = z.infer<typeof base.responseSchema>;
}
