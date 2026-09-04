import { closeExecutorFrame, openExecutorFrame } from './executorFrames.js';

const socketPath = '/api/pages';
const reconnectDelayMs = 3000;

const asObject = (value: unknown): object | undefined =>
  typeof value === 'object' && value ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export type ExecutorPageRequest =
  | { type: 'open'; id: string; url: string }
  | { type: 'close'; id: string };

const readRequest = (text: string): ExecutorPageRequest | undefined => {
  const object = asObject(parseJson(text));
  if (!object) {
    return undefined;
  }
  const id = asString(Reflect.get(object, 'id'));
  const type = asString(Reflect.get(object, 'type'));
  if (!id || !type) {
    return undefined;
  }
  if (type === 'open') {
    const url = asString(Reflect.get(object, 'url'));
    return url === undefined ? undefined : { type, id, url };
  }
  return type === 'close' ? { type: 'close', id } : undefined;
};

export type ExecutorPageReply =
  | { type: 'opened'; id: string }
  | { type: 'failed'; id: string; message: string };

type ExecutorPageSend = (reply: ExecutorPageReply) => void;

const handleRequest = (
  send: ExecutorPageSend,
  request: ExecutorPageRequest,
): void => {
  if (request.type === 'open') {
    openExecutorFrame({
      id: request.id,
      url: request.url,
      onOpened: (id) => {
        send({ type: 'opened', id });
      },
      onFailed: (id, message) => {
        send({ type: 'failed', id, message });
      },
    });
    return;
  }
  closeExecutorFrame(request.id);
};

const createSocketUrl = (): string => {
  const url = new URL(socketPath, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

export const startExecutorPageSocket = (): void => {
  let socket: WebSocket | undefined = undefined;

  const send = (reply: ExecutorPageReply): void => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(reply));
    }
  };

  const connect = (): void => {
    const current = new WebSocket(createSocketUrl());
    socket = current;
    current.onmessage = (event: MessageEvent<string>) => {
      const request = readRequest(event.data);
      if (request !== undefined) {
        handleRequest(send, request);
      }
    };
    current.onclose = () => {
      if (socket === current) {
        socket = undefined;
      }
      window.setTimeout(connect, reconnectDelayMs);
    };
  };

  connect();
};
