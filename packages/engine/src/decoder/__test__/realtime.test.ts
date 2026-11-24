import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectRealtime } from '../realtime.worker.js';
import { stubSockets } from './fakeSocket.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project realtime', () => {
  it('drops the queued packets and keeps the queued messages', async () => {
    const sockets = stubSockets();
    let recordingReady = false;
    const realtime = createProjectRealtime({
      isRecordingReady: () => recordingReady,
      onOpen: () => undefined,
      onEvent: () => undefined,
      onClose: () => undefined,
    });
    realtime.open(1);
    const [socket] = sockets;
    const refused = new Uint8Array([1, 2, 3]).buffer;
    const sung = new Uint8Array([4, 5, 6]).buffer;
    const start = { type: 'recording.start', sessionId: 'next' };

    realtime.sendBinary(refused);
    realtime.sendJson(start);
    realtime.dropPackets();
    socket.open();
    await realtime.ready();
    realtime.sendBinary(sung);
    recordingReady = true;
    realtime.flush();

    expect(socket.sent).toEqual([JSON.stringify(start), sung]);
  });
});
