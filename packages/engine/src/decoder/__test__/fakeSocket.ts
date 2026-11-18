import { vi } from 'vitest';

type Listener = (event: unknown) => void;

export type FakeSocket = {
  readyState: number;
  binaryType: string;
  sent: (string | ArrayBuffer)[];
  addEventListener: (type: string, listener: Listener) => void;
  send: (message: string | ArrayBuffer) => void;
  close: () => void;
  open: () => void;
  receive: (event: object) => void;
  drop: () => void;
};

const createFakeSocket = (): FakeSocket => {
  const listeners = new Map<string, Listener[]>();
  const emit = (type: string, event: object) => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
  };
  const socket: FakeSocket = {
    readyState: WebSocket.CONNECTING,
    binaryType: 'blob',
    sent: [],
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    send: (message) => {
      socket.sent.push(message);
    },
    close: () => {
      socket.readyState = WebSocket.CLOSED;
    },
    open: () => {
      socket.readyState = WebSocket.OPEN;
      emit('open', {});
    },
    receive: (event) => {
      emit('message', { data: JSON.stringify(event) });
    },
    drop: () => {
      socket.readyState = WebSocket.CLOSED;
      emit('close', {});
    },
  };
  return socket;
};

export const stubSockets = (): FakeSocket[] => {
  const created: FakeSocket[] = [];
  const constructor = function createSocket() {
    const socket = createFakeSocket();
    created.push(socket);
    return socket;
  };
  vi.stubGlobal('self', { location: { href: 'http://127.0.0.1:47205/' } });
  vi.stubGlobal('WebSocket', Object.setPrototypeOf(constructor, WebSocket));
  return created;
};
