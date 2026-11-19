import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeRecording,
  createTakeHost,
  flushPorts,
  takeRate,
} from './takeHost.js';

vi.mock('../../audioRequest/audioRequest.worker.js', () => ({
  getRecordingList: async () =>
    Promise.resolve({ recordings: [activeRecording] }),
  getRecordingPieces: async () => new Promise(() => undefined),
  getRecordingPiece: async () => new Promise(() => undefined),
}));

const started = (sessionId: string) => ({
  type: 'recording.started',
  sessionId,
  recordingId: activeRecording.id,
  tempo: 1,
  transpose: 0,
  octave: 0,
});

const finished = (sessionId: string) => ({
  type: 'recording.finished',
  sessionId,
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('take delivery', () => {
  it('delivers a take the host accepts at once', async () => {
    const host = await createTakeHost();
    const sessionId = await host.record();
    host.socket().receive(started(sessionId));
    host.sing(0, takeRate / 10);
    await host.stop();
    host.socket().receive(finished(sessionId));
    await flushPorts();

    expect(host.delivered()).toBe(takeRate / 10);
    expect(host.sent().at(-1)).toBe('recording.finish');
    expect(host.received).toContain('recordingStreamFinished');
  });

  it('keeps a take until the host accepts it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const host = await createTakeHost();
    const sessionId = await host.record();
    host.sing(0, takeRate / 10);
    await host.stop();
    await vi.advanceTimersByTimeAsync(10000);
    host.socket().receive(started(sessionId));
    await flushPorts();
    host.socket().receive(finished(sessionId));
    await flushPorts();

    expect(host.delivered()).toBe(takeRate / 10);
    expect(host.sent().at(-1)).toBe('recording.finish');
    expect(host.received).not.toContain('recordingStreamFailed');
  });

  it('sends the frames it holds when the worklet never drains', async () => {
    const host = await createTakeHost();
    const sessionId = await host.record();
    host.socket().receive(started(sessionId));
    host.sing(0, takeRate / 16);
    await flushPorts();
    await host.finish();
    host.socket().receive(finished(sessionId));
    await flushPorts();

    expect(host.delivered()).toBe(takeRate / 16);
    expect(host.sent().at(-1)).toBe('recording.finish');
  });
});
