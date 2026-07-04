import { api } from '@musetric/api';

const createWebSocketUrl = (projectId: number) => {
  const url = new URL(
    api.project.realtime.base.endpoint({ projectId }),
    self.location.href,
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

type InternalRealtime = {
  projectId: number;
  socket: WebSocket;
  pendingMessages: (string | ArrayBuffer)[];
  openPromise: Promise<void>;
  closed: boolean;
};

const closeSocket = (realtime: InternalRealtime) => {
  if (
    realtime.socket.readyState === WebSocket.CLOSED ||
    realtime.socket.readyState === WebSocket.CLOSING
  ) {
    return;
  }
  if (realtime.socket.readyState === WebSocket.CONNECTING) {
    void realtime.openPromise.finally(() => {
      closeSocket(realtime);
    });
    return;
  }
  realtime.socket.close();
};

export type ProjectRealtimeEvent =
  | {
      type: 'recording.peaksChanged';
      startPeakIndex: number;
      peaks: number[];
    }
  | { type: 'recording.finished' }
  | { type: 'recording.started' }
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

export type ProjectRealtimeOptions = {
  isRecordingReady: () => boolean;
  onOpen: () => void;
  onEvent: (event: ProjectRealtimeEvent) => void;
  onPacket: (data: ArrayBuffer) => void;
  onClose: (error: Error) => void;
};

export type ProjectRealtime = {
  open: (projectId: number) => void;
  close: () => void;
  ready: () => Promise<void>;
  sendJson: (message: object) => void;
  sendBinary: (packet: ArrayBuffer) => void;
  flush: () => void;
};

export const createProjectRealtime = (
  options: ProjectRealtimeOptions,
): ProjectRealtime => {
  const { isRecordingReady, onOpen, onEvent, onPacket, onClose } = options;
  let realtime: InternalRealtime | undefined = undefined;

  const flush = () => {
    if (!realtime || realtime.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const deferred: (string | ArrayBuffer)[] = [];
    for (const message of realtime.pendingMessages) {
      if (typeof message !== 'string' && !isRecordingReady()) {
        deferred.push(message);
        continue;
      }
      realtime.socket.send(message);
    }
    realtime.pendingMessages = deferred;
  };

  return {
    open: (projectId) => {
      if (realtime && realtime.projectId === projectId && !realtime.closed) {
        return;
      }
      if (realtime) {
        realtime.closed = true;
        closeSocket(realtime);
      }
      const socket = new WebSocket(createWebSocketUrl(projectId));
      socket.binaryType = 'arraybuffer';
      const created: InternalRealtime = {
        projectId,
        socket,
        pendingMessages: [],
        openPromise: new Promise<void>((resolve, reject) => {
          socket.addEventListener('open', () => {
            onOpen();
            flush();
            resolve();
          });
          socket.addEventListener('error', () => {
            reject(new Error('Project realtime WebSocket failed'));
          });
        }),
        closed: false,
      };
      socket.addEventListener(
        'message',
        (event: MessageEvent<string | ArrayBuffer>) => {
          if (typeof event.data !== 'string') {
            try {
              onPacket(event.data);
            } catch (error) {
              console.error('Failed to process project realtime packet', error);
            }
            return;
          }
          try {
            onEvent(JSON.parse(event.data));
          } catch (error) {
            console.error('Failed to process project realtime event', error);
          }
        },
      );
      socket.addEventListener('close', () => {
        if (realtime === created) {
          realtime = undefined;
        }
        if (!created.closed) {
          onClose(new Error('Project realtime WebSocket closed'));
        }
      });
      created.openPromise.catch((error: Error) => {
        onClose(error);
      });
      realtime = created;
    },
    close: () => {
      if (!realtime) {
        return;
      }
      const current = realtime;
      realtime = undefined;
      current.closed = true;
      closeSocket(current);
    },
    ready: async () => {
      return realtime ? realtime.openPromise : Promise.resolve();
    },
    sendJson: (message) => {
      if (!realtime || realtime.closed) {
        return;
      }
      const json = JSON.stringify(message);
      if (realtime.socket.readyState === WebSocket.OPEN) {
        flush();
        realtime.socket.send(json);
        return;
      }
      realtime.pendingMessages.push(json);
    },
    sendBinary: (packet) => {
      if (!realtime || realtime.closed) {
        throw new Error('Project realtime socket is not open');
      }
      if (realtime.socket.readyState === WebSocket.OPEN && isRecordingReady()) {
        flush();
        realtime.socket.send(packet);
        return;
      }
      realtime.pendingMessages.push(packet);
    },
    flush,
  };
};
