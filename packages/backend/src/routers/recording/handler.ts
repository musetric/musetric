import { type WebSocket } from '@fastify/websocket';
import { api } from '@musetric/api';
import { nextNumber } from '@musetric/utils';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  broadcastRealtime,
  claimPlayerMaster,
  type ClientRealtimeMessage,
  isClientRealtimeMessage,
  isRealtimeMessage,
  type PlayerFrameIndexMessage,
  type ProjectRealtimeEvent,
  type RecordingStartMessage,
  sendPlayerSyncState,
  sendRealtimeEvent,
  sendRealtimePacket,
  stopProjectPlayer,
  toBuffer,
  validateRecordingStart,
} from './realtime.js';
import { type RecordingRuntime } from './runtime.js';
import {
  createRecordingChunkPacket,
  createSession,
  finishSession,
  processStreamPacket,
  type RecordingSession,
} from './session.js';

export type RecordingRealtimeContext = {
  runtime: RecordingRuntime;
  socket: WebSocket;
  projectId: number;
  sockets: Set<WebSocket>;
  getActiveSession: () => RecordingSession | undefined;
  setActiveSession: (session: RecordingSession | undefined) => void;
  isSocketClosed: () => boolean;
  setIgnoringRecordingStream: (value: boolean) => void;
  isIgnoringRecordingStream: () => boolean;
  send: (event: ProjectRealtimeEvent) => void;
  closeWithError: (error: unknown, reason: string) => void;
  enqueueSessionAction: (reason: string, action: () => Promise<void>) => void;
};

const finishRealtimeSession = async (
  ctx: RecordingRealtimeContext,
  session: RecordingSession | undefined,
): Promise<void> => {
  if (!session) {
    return;
  }
  await finishSession(ctx.runtime, session);
  broadcastRealtime(ctx.sockets, (socket) => {
    sendRealtimeEvent(socket, { type: 'recording.finished' });
  });
};

const handleRecordingStart = (
  message: RecordingStartMessage,
  ctx: RecordingRealtimeContext,
): void => {
  const start = validateRecordingStart(message);
  if (!start) {
    ctx.socket.close(1008, 'Invalid recording start message');
    return;
  }

  const recordingClaimed = claimPlayerMaster(
    ctx.runtime,
    ctx.projectId,
    ctx.socket,
    true,
  );
  if (!recordingClaimed) {
    ctx.setIgnoringRecordingStream(true);
    ctx.send({ type: 'recording.finished' });
    return;
  }

  const { sampleRate, frameCount } = start;
  ctx.enqueueSessionAction('Failed to start recording session', async () => {
    await finishRealtimeSession(ctx, ctx.getActiveSession());
    ctx.setActiveSession(undefined);
    if (ctx.isSocketClosed()) {
      return;
    }
    const session = await createSession(
      ctx.runtime,
      ctx.projectId,
      sampleRate,
      frameCount,
    );
    if (ctx.isSocketClosed()) {
      await finishRealtimeSession(ctx, session);
      return;
    }
    ctx.setActiveSession(session);
    broadcastRealtime(ctx.sockets, (socket) => {
      sendRealtimeEvent(socket, { type: 'recording.started' });
    });
  });
};

const handleRecordingFinish = (ctx: RecordingRealtimeContext): void => {
  if (ctx.isIgnoringRecordingStream()) {
    ctx.setIgnoringRecordingStream(false);
    ctx.send({ type: 'recording.finished' });
    return;
  }
  ctx.enqueueSessionAction('Failed to finish recording session', async () => {
    const session = ctx.getActiveSession();
    ctx.setActiveSession(undefined);
    await finishRealtimeSession(ctx, session);
  });
};

const handlePlayerPlay = (ctx: RecordingRealtimeContext): void => {
  claimPlayerMaster(ctx.runtime, ctx.projectId, ctx.socket, false);
};

const handlePlayerRecord = (ctx: RecordingRealtimeContext): void => {
  claimPlayerMaster(ctx.runtime, ctx.projectId, ctx.socket, true);
};

const handlePlayerStop = (ctx: RecordingRealtimeContext): void => {
  stopProjectPlayer(ctx.runtime, ctx.projectId);
};

const handlePlayerFrameIndex = (
  message: PlayerFrameIndexMessage,
  ctx: RecordingRealtimeContext,
): void => {
  const playerState = ctx.runtime.projectPlayerStates.get(ctx.projectId);
  if (!playerState) {
    return;
  }
  const frameIndex =
    typeof message.frameIndex === 'number' ? message.frameIndex : 0;
  const frozen = typeof message.frozen === 'boolean' ? message.frozen : false;
  const revision = typeof message.revision === 'number' ? message.revision : 0;
  const source: 'playback' | 'user' =
    message.source === 'user' ? 'user' : 'playback';

  if (source === 'user') {
    playerState.revision = nextNumber(playerState.revision);
    playerState.frameIndex = frameIndex;
    playerState.frozen = frozen;
    ctx.send({ type: 'player.revision', revision: playerState.revision });
    broadcastRealtime(
      ctx.sockets,
      (socket) => {
        sendRealtimeEvent(socket, {
          type: 'player.frameIndex',
          frameIndex: playerState.frameIndex,
          frozen: playerState.frozen,
          revision: playerState.revision,
          source: 'user',
        });
      },
      ctx.socket,
    );
    return;
  }

  if (!playerState.active || playerState.masterSocket !== ctx.socket) {
    sendPlayerSyncState(ctx.socket, playerState);
    return;
  }
  if (revision !== playerState.revision) {
    return;
  }
  playerState.frameIndex = frameIndex;
  playerState.frozen = frozen;
  broadcastRealtime(
    ctx.sockets,
    (socket) => {
      sendRealtimeEvent(socket, {
        type: 'player.frameIndex',
        frameIndex: playerState.frameIndex,
        frozen: playerState.frozen,
        revision: playerState.revision,
        source: 'playback',
      });
    },
    ctx.socket,
  );
};

const handlePlayerSyncRequest = (ctx: RecordingRealtimeContext): void => {
  const playerState = ctx.runtime.projectPlayerStates.get(ctx.projectId);
  if (!playerState) {
    return;
  }
  sendPlayerSyncState(ctx.socket, playerState);
};

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

const tryParseTextMessage = (
  data: unknown,
): { ok: true; value: unknown } | { ok: false; error: unknown } => {
  try {
    const buffer = toBuffer(data);
    return { ok: true, value: JSON.parse(buffer?.toString() ?? '') };
  } catch (error) {
    return { ok: false, error };
  }
};

const handleBinaryPacket = (
  data: unknown,
  ctx: RecordingRealtimeContext,
): void => {
  if (ctx.isIgnoringRecordingStream()) {
    return;
  }
  const packet = toBuffer(data);
  const session = ctx.getActiveSession();
  if (!packet || !session) {
    ctx.socket.close(1003, 'Recording packet must follow recording start');
    return;
  }
  ctx.enqueueSessionAction('Failed to write recording packet', async () => {
    if (ctx.getActiveSession() !== session) {
      return;
    }
    const result = await processStreamPacket(session, packet);
    if (!result) {
      return;
    }
    const chunkPacket = createRecordingChunkPacket(
      result.frameIndex,
      result.chunk,
    );
    broadcastRealtime(
      ctx.sockets,
      (socket) => {
        sendRealtimePacket(socket, chunkPacket);
      },
      ctx.socket,
    );
    if (result.peakPatch) {
      const { startPeakIndex, peaks } = result.peakPatch;
      broadcastRealtime(ctx.sockets, (socket) => {
        sendRealtimeEvent(socket, {
          type: 'recording.peaksChanged',
          startPeakIndex,
          peaks: Array.from(peaks),
        });
      });
    }
  });
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
