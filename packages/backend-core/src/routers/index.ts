import { type FastifyInstance } from 'fastify';
import { audioRouter } from './audio.js';
import { chordsRouter } from './chords.js';
import { gpuRouter } from './gpu.js';
import { keyRouter } from './key.js';
import { previewRouter } from './preview.js';
import { projectRouter } from './project.js';
import { rhythmRouter } from './rhythm.js';
import { subtitleRouter } from './subtitle.js';

export const registerRouters = (app: FastifyInstance) => {
  app.register(audioRouter);
  app.register(gpuRouter);
  app.register(chordsRouter);
  app.register(keyRouter);
  app.register(previewRouter);
  app.register(projectRouter);
  app.register(rhythmRouter);
  app.register(subtitleRouter);
};
