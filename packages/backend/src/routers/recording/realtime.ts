import { type WebSocket } from '@fastify/websocket';

export type PlayerRuntimeState = {
  masterSocket: WebSocket | undefined;
  active: boolean;
  recording: boolean;
  frozen: boolean;
  frameIndex: number;
  revision: number;
};

export type ProjectRealtimeEvent =
  | { type: 'recording.started' }
  | {
      type: 'recording.peaksChanged';
      startPeakIndex: number;
      peaks: number[];
    }
  | { type: 'recording.finished' }
  | { type: 'error'; error: string }
  | { type: 'player.play' }
  | { type: 'player.record' }
  | { type: 'player.stop' }
  | {
      type: 'player.frameIndex';
      frameIndex: number;
      frozen: boolean;
      revision: number;
      source: 'playback' | 'user';
    }
  | { type: 'player.revision'; revision: number }
  | {
      type: 'player.sync.state';
      active: boolean;
      recording: boolean;
      frozen: boolean;
      frameIndex: number;
      revision: number;
    };

export type RecordingStartMessage = {
  type: 'recording.start';
  sampleRate?: unknown;
  frameCount?: unknown;
  latencyFrameCount?: unknown;
};

export type PlayerFrameIndexMessage = {
  type: 'player.frameIndex';
  frameIndex?: unknown;
  frozen?: unknown;
  revision?: unknown;
  source?: unknown;
};

export type ClientRealtimeMessage =
  | RecordingStartMessage
  | { type: 'recording.finish' }
  | { type: 'player.play' }
  | { type: 'player.record' }
  | { type: 'player.stop' }
  | PlayerFrameIndexMessage
  | { type: 'player.sync.request' };

export type ProjectRealtime = {
  projectPlayerStates: Map<number, PlayerRuntimeState>;
  projectRealtimeSockets: Map<number, Set<WebSocket>>;
};

export const isClientRealtimeMessage = (
  message: Record<string, unknown>,
): message is ClientRealtimeMessage => {
  const { type } = message;
  return (
    type === 'recording.start' ||
    type === 'recording.finish' ||
    type === 'player.play' ||
    type === 'player.record' ||
    type === 'player.stop' ||
    type === 'player.frameIndex' ||
    type === 'player.sync.request'
  );
};

const readNonZeroInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value !== 0;

const readNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export const validateRecordingStart = (
  message: RecordingStartMessage,
):
  | { sampleRate: number; frameCount: number; latencyFrameCount: number }
  | undefined => {
  const { sampleRate, frameCount, latencyFrameCount } = message;
  if (
    !readNonZeroInteger(sampleRate) ||
    !readNonNegativeInteger(frameCount) ||
    !readNonNegativeInteger(latencyFrameCount)
  ) {
    return undefined;
  }
  return { sampleRate, frameCount, latencyFrameCount };
};

export const toBuffer = (data: unknown): Buffer | undefined => {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (Array.isArray(data) && data.every(Buffer.isBuffer)) {
    return Buffer.concat(data);
  }
  return undefined;
};

export const isRealtimeMessage = (
  message: unknown,
): message is Record<string, unknown> =>
  typeof message === 'object' && Boolean(message);

export const sendRealtimeEvent = (
  socket: WebSocket,
  event: ProjectRealtimeEvent,
): void => {
  if (socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(event));
};

export const sendRealtimePacket = (socket: WebSocket, packet: Buffer): void => {
  if (socket.readyState !== 1) {
    return;
  }
  socket.send(packet);
};

export const broadcastRealtime = (
  sockets: Set<WebSocket> | undefined,
  sender: (socket: WebSocket) => void,
  excludeSocket?: WebSocket,
): void => {
  if (!sockets) {
    return;
  }
  for (const socket of sockets) {
    if (socket !== excludeSocket) {
      sender(socket);
    }
  }
};

export const createPlayerState = (): PlayerRuntimeState => ({
  masterSocket: undefined,
  active: false,
  recording: false,
  frozen: false,
  frameIndex: 0,
  revision: 0,
});

export const getProjectPlayerState = (
  states: Map<number, PlayerRuntimeState>,
  projectId: number,
): PlayerRuntimeState => {
  const existing = states.get(projectId);
  if (existing) {
    return existing;
  }
  const state = createPlayerState();
  states.set(projectId, state);
  return state;
};

export const sendPlayerSyncState = (
  socket: WebSocket,
  state: PlayerRuntimeState | undefined,
): void => {
  sendRealtimeEvent(socket, {
    type: 'player.sync.state',
    active: state?.active ?? false,
    recording: state?.recording ?? false,
    frozen: state?.frozen ?? false,
    frameIndex: state?.frameIndex ?? 0,
    revision: state?.revision ?? 0,
  });
};

export const claimPlayerMaster = (
  realtime: ProjectRealtime,
  projectId: number,
  socket: WebSocket,
  recording: boolean,
): boolean => {
  const state = getProjectPlayerState(realtime.projectPlayerStates, projectId);
  if (!state.active) {
    state.masterSocket = socket;
    state.active = true;
    state.recording = recording;
    broadcastRealtime(
      realtime.projectRealtimeSockets.get(projectId),
      (target) => {
        sendRealtimeEvent(target, {
          type: recording ? 'player.record' : 'player.play',
        });
      },
      socket,
    );
    return true;
  }
  if (state.masterSocket === socket && state.recording === recording) {
    return true;
  }
  sendPlayerSyncState(socket, state);
  return false;
};

export const stopProjectPlayer = (
  realtime: ProjectRealtime,
  projectId: number,
): void => {
  const state = realtime.projectPlayerStates.get(projectId);
  if (state) {
    state.masterSocket = undefined;
    state.active = false;
    state.recording = false;
  }
  broadcastRealtime(
    realtime.projectRealtimeSockets.get(projectId),
    (socket) => {
      sendRealtimeEvent(socket, { type: 'player.stop' });
    },
  );
};
