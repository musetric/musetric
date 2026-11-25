import { api } from '@musetric/api';

const reconnectDelayMs = (attempt: number) =>
  Math.min(500 * 2 ** attempt, 2000);

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
  pendingMessages: string[];
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

export type ProjectRealtimeOptions = {
  onOpen: (projectId: number, reopened: boolean) => void;
  onEvent: (event: api.project.realtime.Event) => void;
  onClose: (error: Error) => void;
};

export type ProjectRealtime = {
  open: (projectId: number) => void;
  reconnect: () => void;
  drop: () => void;
  close: () => void;
  isOpen: () => boolean;
  sendJson: (message: object) => void;
  sendBinary: (packet: ArrayBuffer) => void;
};

export const createProjectRealtime = (
  options: ProjectRealtimeOptions,
): ProjectRealtime => {
  const { onOpen, onEvent, onClose } = options;
  let realtime: InternalRealtime | undefined = undefined;
  let wantedProjectId: number | undefined = undefined;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined = undefined;

  const flush = () => {
    if (!realtime || realtime.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    for (const message of realtime.pendingMessages) {
      realtime.socket.send(message);
    }
    realtime.pendingMessages = [];
  };

  const isOpen = () =>
    realtime !== undefined &&
    !realtime.closed &&
    realtime.socket.readyState === WebSocket.OPEN;

  const cancelRetry = () => {
    clearTimeout(retry);
    retry = undefined;
  };

  const connect = (projectId: number) => {
    cancelRetry();
    const socket = new WebSocket(createWebSocketUrl(projectId));
    socket.binaryType = 'arraybuffer';
    const created: InternalRealtime = {
      projectId,
      socket,
      pendingMessages: [],
      openPromise: new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => {
          if (!created.closed) {
            const reopened = attempt > 0;
            attempt = 0;
            onOpen(projectId, reopened);
            flush();
          }
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
      if (created.closed) {
        return;
      }
      retry = setTimeout(() => {
        connect(projectId);
      }, reconnectDelayMs(attempt));
      attempt += 1;
      onClose(new Error('Project realtime WebSocket closed'));
    });
    created.openPromise.catch(() => undefined);
    realtime = created;
  };

  return {
    open: (projectId) => {
      if (realtime && realtime.projectId === projectId && !realtime.closed) {
        return;
      }
      if (wantedProjectId !== projectId) {
        attempt = 0;
      }
      wantedProjectId = projectId;
      if (realtime) {
        realtime.closed = true;
        closeSocket(realtime);
      }
      connect(projectId);
    },
    reconnect: () => {
      if (realtime || wantedProjectId === undefined) {
        return;
      }
      connect(wantedProjectId);
    },
    drop: () => {
      realtime?.socket.close();
    },
    close: () => {
      wantedProjectId = undefined;
      attempt = 0;
      cancelRetry();
      if (!realtime) {
        return;
      }
      const current = realtime;
      realtime = undefined;
      current.closed = true;
      closeSocket(current);
    },
    isOpen,
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
      if (!realtime || !isOpen()) {
        throw new Error('Project realtime socket is not open');
      }
      flush();
      realtime.socket.send(packet);
    },
  };
};
