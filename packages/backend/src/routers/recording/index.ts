import { api } from '@musetric/api';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { createProjectRealtimeHandler } from './handler.js';
import { createRecordingRuntime } from './runtime.js';

export const recordingRouter: FastifyPluginCallbackZod = (app) => {
  app.addHook('onRoute', (opts) => {
    if (opts.schema) opts.schema.tags = ['recording'];
  });

  const runtime = createRecordingRuntime(app);

  app.get(
    api.project.realtime.base.path,
    { websocket: true },
    createProjectRealtimeHandler(app, runtime),
  );
};
