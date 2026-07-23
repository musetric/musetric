import { type WebSocket } from '@fastify/websocket';
import { api } from '@musetric/api';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  handlePlayerFrameIndex,
  handlePlayerPlay,
  handlePlayerRecord,
  handlePlayerStop,
  handlePlayerSyncRequest,
} from './playerHandlers.js';
import {
  type ClientRealtimeMessage,
  isClientRealtimeMessage,
  isRealtimeMessage,
  sendRealtimeEvent,
  stopProjectPlayer,
} from './realtime.js';
import {
  finishRealtimeSession,
  handleBinaryPacket,
  handleRecordingFinish,
  handleRecordingStart,
  type RecordingRealtimeContext,
  tryParseTextMessage,
} from './recordingHandlers.js';
import { type RecordingRuntime } from './runtime.js';
import { type RecordingSession } from './session.js';

const dispatchClientMessage = (
  message: ClientRealtimeMessage,
  ctx: RecordingRealtimeContext,
): void => {
  if (message.type === 'recording.start') {
    handleRecordingStart(message, ctx);
    return;
  }
  if (message.type === 'recording.finish') {
    handleRecordingFinish(ctx);
    return;
  }
  if (message.type === 'player.play') {
    handlePlayerPlay(ctx);
    return;
  }
  if (message.type === 'player.record') {
    handlePlayerRecord(ctx);
    return;
  }
  if (message.type === 'player.stop') {
    handlePlayerStop(ctx);
    return;
  }
  if (message.type === 'player.frameIndex') {
    handlePlayerFrameIndex(message, ctx);
    return;
  }
  handlePlayerSyncRequest(ctx);
};

const handleTextPacket = (
  data: unknown,
  ctx: RecordingRealtimeContext,
): void => {
  const parsed = tryParseTextMessage(data);
  if (!parsed.ok) {
    ctx.closeWithError(parsed.error, 'Invalid project realtime message');
    return;
  }
  if (
    !isRealtimeMessage(parsed.value) ||
    !isClientRealtimeMessage(parsed.value)
  ) {
    return;
  }
  dispatchClientMessage(parsed.value, ctx);
};

export const createProjectRealtimeHandler =
  (app: FastifyInstance, runtime: RecordingRuntime) =>
  (socket: WebSocket, request: FastifyRequest): void => {
    const { projectId } = api.project.realtime.base.paramsSchema.parse(
      request.params,
    );

    let socketClosed = false;
    let activeSession: RecordingSession | undefined = undefined;
    let ignoringRecordingStream = false;
    let sessionAction: Promise<void> = Promise.resolve();

    const sockets =
      runtime.projectRealtimeSockets.get(projectId) ?? new Set<WebSocket>();
    sockets.add(socket);
    runtime.projectRealtimeSockets.set(projectId, sockets);

    const closeWithError = (error: unknown, reason: string): void => {
      runtime.logger.error({ error }, reason);
      sendRealtimeEvent(socket, { type: 'error', error: reason });
      socket.close(1011, reason);
    };

    const enqueueSessionAction = (
      reason: string,
      action: () => Promise<void>,
    ): void => {
      sessionAction = sessionAction.then(action).catch((error) => {
        if (socketClosed) {
          runtime.logger.error({ error }, reason);
          return;
        }
        closeWithError(error, reason);
      });
    };

    const ctx: RecordingRealtimeContext = {
      runtime,
      socket,
      projectId,
      sockets,
      getActiveSession: () => activeSession,
      setActiveSession: (session) => {
        activeSession = session;
      },
      isSocketClosed: () => socketClosed,
      setIgnoringRecordingStream: (value) => {
        ignoringRecordingStream = value;
      },
      isIgnoringRecordingStream: () => ignoringRecordingStream,
      send: (event) => sendRealtimeEvent(socket, event),
      closeWithError,
      enqueueSessionAction,
    };

    void app.db.project.get(projectId).then((project) => {
      if (!project) {
        socket.close(1008, `Project with id ${projectId} not found`);
      }
    });

    socket.on(
      'message',
      (data: ArrayBuffer | Buffer | Buffer[], isBinary: boolean) => {
        if (isBinary) {
          handleBinaryPacket(data, ctx);
          return;
        }
        handleTextPacket(data, ctx);
      },
    );

    socket.on('close', () => {
      socketClosed = true;
      sockets.delete(socket);
      const playerState = runtime.projectPlayerStates.get(projectId);
      if (playerState && playerState.masterSocket === socket) {
        stopProjectPlayer(runtime, projectId);
      }
      if (!sockets.size) {
        runtime.projectRealtimeSockets.delete(projectId);
        runtime.projectPlayerStates.delete(projectId);
      }
      enqueueSessionAction(
        'Failed to finish recording session after realtime disconnect',
        async () => {
          const session = activeSession;
          activeSession = undefined;
          await finishRealtimeSession(ctx, session);
        },
      );
    });
  };
