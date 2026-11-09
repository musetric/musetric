import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectRealtime } from '../realtime.worker.js';

type Listener = (event: unknown) => void;

type FakeSocket = {
  readyState: number;
  binaryType: string;
  sent: (string | ArrayBuffer)[];
  addEventListener: (type: string, listener: Listener) => void;
  send: (message: string | ArrayBuffer) => void;
  close: () => void;
  open: () => void;
};

const createFakeSocket = (): FakeSocket => {
  const listeners = new Map<string, Listener[]>();
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
      for (const listener of listeners.get('open') ?? []) {
        listener({});
      }
    },
  };
  return socket;
};

const stubSockets = (): FakeSocket[] => {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project realtime', () => {
  it('sends no packet of an earlier take when the next take starts', async () => {
    const sockets = stubSockets();
    let recordingReady = false;
    const realtime = createProjectRealtime({
      isRecordingReady: () => recordingReady,
      onOpen: () => undefined,
      onEvent: () => undefined,
      onPacket: () => undefined,
      onClose: () => undefined,
    });
    realtime.open(1);
    const [socket] = sockets;
    socket.open();
    await realtime.ready();
    const refused = new Uint8Array([1, 2, 3]).buffer;
    const sung = new Uint8Array([4, 5, 6]).buffer;

    realtime.sendJson({ type: 'recording.start', sessionId: 'refused' });
    realtime.sendBinary(refused);
    realtime.sendJson({ type: 'recording.start', sessionId: 'next' });
    realtime.sendBinary(sung);
    recordingReady = true;
    realtime.flush();

    expect(
      socket.sent.filter((message) => typeof message !== 'string'),
    ).toEqual([sung]);
    expect(
      socket.sent.filter((message) => typeof message === 'string'),
    ).toHaveLength(2);
  });
});
