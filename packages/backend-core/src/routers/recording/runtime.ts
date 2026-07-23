import { bindLogger, type Logger } from '@musetric/utils';
import { type FastifyInstance } from 'fastify';
import { type ProjectRealtime } from './realtime.js';
import { type RecordingSession } from './session.js';

export type RecordingRuntime = ProjectRealtime & {
  app: FastifyInstance;
  logger: Logger;
  sessions: Map<string, RecordingSession>;
  projectSessionIds: Map<number, string>;
};

export const createRecordingRuntime = (
  app: FastifyInstance,
): RecordingRuntime => ({
  app,
  logger: bindLogger(app.log, app.config.logLevel),
  sessions: new Map(),
  projectSessionIds: new Map(),
  projectPlayerStates: new Map(),
  projectRealtimeSockets: new Map(),
});
