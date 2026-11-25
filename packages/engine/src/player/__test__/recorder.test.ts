import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecorderHarness } from './recorderHarness.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('engine recorder', () => {
  it('finishes a take whose worklet never drains', async () => {
    vi.useFakeTimers();
    const harness = createRecorderHarness({
      flushRecording: async () => new Promise(() => undefined),
    });
    await harness.recorder.record({
      projectId: 1,
      takeId: 'first',
      startPlayback: false,
    });
    let stopped = false;
    void harness.recorder.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(stopped).toBe(true);
    expect(harness.finished).toEqual([0]);
    await harness.recorder.record({
      projectId: 1,
      takeId: 'second',
      startPlayback: false,
    });
    expect(harness.started()).toBe(2);
  });
});
