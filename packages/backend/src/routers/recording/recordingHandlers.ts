import { type WebSocket } from '@fastify/websocket';
import {
  broadcastRealtime,
  claimPlayerMaster,
  type ProjectRealtimeEvent,
  type RecordingStartMessage,
  sendRealtimeEvent,
  sendRealtimePacket,
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

export const finishRealtimeSession = async (
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

export const handleRecordingStart = (
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

export const handleRecordingFinish = (ctx: RecordingRealtimeContext): void => {
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

export const tryParseTextMessage = (
  data: unknown,
): { ok: true; value: unknown } | { ok: false; error: unknown } => {
  try {
    const buffer = toBuffer(data);
    return { ok: true, value: JSON.parse(buffer?.toString() ?? '') };
  } catch (error) {
    return { ok: false, error };
  }
};

export const handleBinaryPacket = (
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
