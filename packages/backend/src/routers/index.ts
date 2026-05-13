import { type FastifyInstance } from 'fastify';
import { audioRouter } from './audio.js';
import { previewRouter } from './preview.js';
import { projectRouter } from './project.js';
import { subtitleRouter } from './subtitle.js';

export const registerRouters = (app: FastifyInstance) => {
  app.register(audioRouter);
  app.register(previewRouter);
  app.register(projectRouter);
  app.register(subtitleRouter);
};
