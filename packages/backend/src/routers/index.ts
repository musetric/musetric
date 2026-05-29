import { type FastifyInstance } from 'fastify';
import { audioRouter } from './audio.js';
import { keyRouter } from './key.js';
import { previewRouter } from './preview.js';
import { projectRouter } from './project.js';
import { recordingRouter } from './recording.js';
import { rhythmRouter } from './rhythm.js';
import { subtitleRouter } from './subtitle.js';

export const registerRouters = (app: FastifyInstance) => {
  app.register(audioRouter);
  app.register(keyRouter);
  app.register(previewRouter);
  app.register(projectRouter);
  app.register(recordingRouter);
  app.register(rhythmRouter);
  app.register(subtitleRouter);
};
