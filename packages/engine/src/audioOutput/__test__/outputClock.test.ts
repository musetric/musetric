import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineOutputClock } from '../outputClock.js';

const heardDelay = 0.07;

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const fake = <Type>(value: object): Type => value as Type;

type ReportContextTime = (currentTime: number, nowMs: number) => number;

const createFakeContext = (quantum = 0) => {
  const listeners = new Map<string, (() => void)[]>();
  let state: AudioContextState = 'running';
  let frozenTime = 10;
  let runStartMs = performance.now();
  let reportContextTime: ReportContextTime | undefined = undefined;
  const readElapsed = () =>
    state === 'running' ? (performance.now() - runStartMs) / 1000 : 0;
  const readRenderedTime = () => frozenTime + readElapsed();
  const readCurrentTime = () =>
    quantum > 0
      ? frozenTime + Math.ceil(readElapsed() / quantum) * quantum
      : readRenderedTime();
  const emit = (type: string) => {
    for (const listener of listeners.get(type) ?? []) {
      listener();
    }
  };
  const context = fake<AudioContext>({
    get state() {
      return state;
    },
    get currentTime() {
      return readCurrentTime();
    },
    outputLatency: 0.05,
    baseLatency: 0.02,
    getOutputTimestamp: () => ({
      contextTime: reportContextTime
        ? reportContextTime(readRenderedTime(), performance.now())
        : readRenderedTime() - heardDelay,
      performanceTime: performance.now(),
    }),
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  });
  return {
    context,
    suspend: () => {
      frozenTime = readCurrentTime();
      state = 'suspended';
      emit('statechange');
    },
    resume: () => {
      runStartMs = performance.now();
      state = 'running';
      emit('statechange');
    },
    report: (next: ReportContextTime) => {
      reportContextTime = next;
    },
    changeSink: () => {
      emit('sinkchange');
    },
    heardClockOffset: (delay: number) =>
      readRenderedTime() -
      delay -
      (performance.timeOrigin + performance.now()) / 1000,
  };
};

const expectHeard = (
  fakeContext: ReturnType<typeof createFakeContext>,
  reading: { renderAhead: number; clockOffset: number } | undefined,
  delay: number,
) => {
  expect(reading?.renderAhead).toBeCloseTo(delay, 3);
  expect(reading?.clockOffset).toBeCloseTo(
    fakeContext.heardClockOffset(delay),
    3,
  );
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'performance'] });
  vi.advanceTimersByTime(1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('engine output clock', () => {
  it('keeps the delay from before a suspend while the timestamp after the resume is short', () => {
    const fakeContext = createFakeContext();
    const clock = createEngineOutputClock(fakeContext.context);
    vi.advanceTimersByTime(3000);
    expectHeard(fakeContext, clock.read(), heardDelay);

    fakeContext.suspend();
    vi.advanceTimersByTime(4500);
    fakeContext.report((currentTime) => currentTime - heardDelay + 0.035);
    fakeContext.resume();
    vi.advanceTimersByTime(20000);

    expectHeard(fakeContext, clock.read(), heardDelay);
  });

  it('follows the timestamp again once it agrees with the delay it keeps', () => {
    const fakeContext = createFakeContext();
    const clock = createEngineOutputClock(fakeContext.context);
    vi.advanceTimersByTime(3000);
    fakeContext.suspend();
    vi.advanceTimersByTime(4500);
    const resumedAtMs = performance.now();
    fakeContext.report((currentTime, nowMs) =>
      Math.min((2 * (nowMs - resumedAtMs)) / 1000, currentTime - heardDelay),
    );
    fakeContext.resume();
    vi.advanceTimersByTime(3000);
    expectHeard(fakeContext, clock.read(), heardDelay);

    vi.advanceTimersByTime(20000);
    expectHeard(fakeContext, clock.read(), heardDelay);

    fakeContext.report((currentTime) => currentTime - 0.2);
    vi.advanceTimersByTime(3000);
    expectHeard(fakeContext, clock.read(), 0.2);
  });

  it('follows a resume whose timestamp is right', () => {
    const fakeContext = createFakeContext();
    const clock = createEngineOutputClock(fakeContext.context);
    vi.advanceTimersByTime(3000);
    fakeContext.suspend();
    vi.advanceTimersByTime(4500);
    fakeContext.resume();
    vi.advanceTimersByTime(3000);

    expectHeard(fakeContext, clock.read(), heardDelay);
  });

  it('follows a new output while it keeps the delay', () => {
    const fakeContext = createFakeContext();
    const clock = createEngineOutputClock(fakeContext.context);
    vi.advanceTimersByTime(3000);
    fakeContext.suspend();
    vi.advanceTimersByTime(4500);
    fakeContext.report((currentTime) => currentTime - heardDelay + 0.035);
    fakeContext.resume();
    vi.advanceTimersByTime(3000);
    expectHeard(fakeContext, clock.read(), heardDelay);

    fakeContext.report((currentTime) => currentTime - 0.25);
    fakeContext.changeSink();
    vi.advanceTimersByTime(3000);

    expectHeard(fakeContext, clock.read(), 0.25);
  });

  it('keeps the heard position within 2 ms once its window refills when currentTime moves by render quanta', () => {
    const fakeContext = createFakeContext(1024 / 48000);
    const clock = createEngineOutputClock(fakeContext.context);
    vi.advanceTimersByTime(3000);
    const before = clock.read();
    expect(before?.clockOffset).toBeCloseTo(
      fakeContext.heardClockOffset(heardDelay),
      3,
    );

    fakeContext.suspend();
    vi.advanceTimersByTime(4500);
    fakeContext.report((renderedTime) => renderedTime - heardDelay + 0.035);
    fakeContext.resume();
    vi.advanceTimersByTime(1000);

    for (let step = 0; step < 40; step += 1) {
      vi.advanceTimersByTime(500);
      const reading = clock.read();
      expect(reading?.renderAhead).toBe(before?.renderAhead);
      expect(
        Math.abs(
          (reading?.clockOffset ?? 0) -
            fakeContext.heardClockOffset(heardDelay),
        ),
      ).toBeLessThan(0.002);
    }
  });
});
