import { createClockStall } from './clockStall.cross.js';

const sampleIntervalMs = 100;
const refillIntervalMs = 20;
const refillCount = 6;
const restObserveMs = 500;
const sampleWindow = 15;
const contextOffsetWindow = 30;
const startupSampleDelaysMs = [0, 20, 40, 60, 80];
const timestampMoveSeconds = 0.005;
const renderAheadStepSeconds = 0.001;
const clockOffsetStepSeconds = 0.0005;
const staleTimestampMs = 100;
const settleMs = 1000;
const stallMs = 500;
const heldAgreementSeconds = 0.002;
const heldAgreementWindow = 30;
const trimmedShare = 0.2;

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const trimmedMean = (values: readonly number[]) => {
  const sorted = values.toSorted((left, right) => left - right);
  const cut = Math.floor(sorted.length * trimmedShare);
  const kept = sorted.slice(cut, sorted.length - cut);
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
};

const pushWithin = (values: number[], value: number, size: number) => {
  values.push(value);
  if (values.length > size) {
    values.shift();
  }
};

const readHeard = (context: AudioContext, nowMs: number) => {
  const { currentTime } = context;
  const timestamp = context.getOutputTimestamp();
  const { contextTime = 0, performanceTime = 0 } = timestamp;
  if (
    contextTime > 0 &&
    contextTime < currentTime &&
    performanceTime > 0 &&
    nowMs - performanceTime < staleTimestampMs
  ) {
    return { contextTime, performanceMs: performanceTime, reported: true };
  }
  return {
    contextTime:
      context.currentTime - (context.outputLatency || 0) - context.baseLatency,
    performanceMs: nowMs,
    reported: false,
  };
};

const readClockOffset = (heard: ReturnType<typeof readHeard>) =>
  heard.contextTime - (performance.timeOrigin + heard.performanceMs) / 1000;

export type OutputClockReading = {
  renderAhead: number;
  clockOffset: number;
};

type HeldReading = {
  renderAhead: number;
  heardShift: number;
};

export type EngineOutputClock = {
  read: () => OutputClockReading | undefined;
  subscribe: (listener: (reading: OutputClockReading) => void) => () => void;
  whenSettled: () => Promise<void>;
  wake: () => Promise<void>;
  setActive: (active: boolean) => void;
  attach: (context: AudioContext) => void;
};

export const createEngineOutputClock = (
  initialContext: AudioContext,
): EngineOutputClock => {
  let context = initialContext;
  const renderAheads: number[] = [];
  const clockOffsets: number[] = [];
  const contextOffsets: number[] = [];
  const reportedWhileHeld: number[] = [];
  const listeners = new Set<(reading: OutputClockReading) => void>();
  let published: OutputClockReading | undefined = undefined;
  let refilling = false;
  let offsetHeardMs = 0;
  let reported = true;
  let pausedReading: HeldReading | undefined = undefined;
  let held: HeldReading | undefined = undefined;
  let runningSinceMs =
    context.state === 'running' ? performance.now() : undefined;
  let active = true;
  let timer: ReturnType<typeof setInterval> | undefined = undefined;
  let timerMs = 0;
  const stall = createClockStall(
    stallMs,
    context.currentTime,
    performance.now(),
  );

  const clearSamples = () => {
    renderAheads.length = 0;
    clockOffsets.length = 0;
  };

  const releaseHeld = () => {
    held = undefined;
    refilling = false;
    reportedWhileHeld.length = 0;
    clearSamples();
  };

  const pushClockOffset = (heard: ReturnType<typeof readHeard>) => {
    if (clockOffsets.length > 0 && heard.performanceMs === offsetHeardMs) {
      return;
    }
    const clockOffset = readClockOffset(heard);
    if (
      heard.reported &&
      clockOffsets.length > 0 &&
      Math.abs(clockOffset - median(clockOffsets)) > timestampMoveSeconds
    ) {
      clockOffsets.length = 0;
      refilling = true;
    }
    pushWithin(clockOffsets, clockOffset, sampleWindow);
    offsetHeardMs = heard.performanceMs;
    if (clockOffsets.length >= refillCount) {
      refilling = false;
    }
  };

  const sample = () => {
    if (context.state !== 'running') {
      return;
    }
    const nowMs = performance.now();
    stall.observe(context.currentTime, nowMs);
    pushWithin(
      contextOffsets,
      context.currentTime - (performance.timeOrigin + nowMs) / 1000,
      contextOffsetWindow,
    );
    const heard = readHeard(context, nowMs);
    if (heard.reported !== reported) {
      reported = heard.reported;
      refilling = reported;
      clearSamples();
    }
    const renderAhead =
      context.currentTime -
      (heard.contextTime + (nowMs - heard.performanceMs) / 1000);
    if (held) {
      pushWithin(reportedWhileHeld, renderAhead, heldAgreementWindow);
      if (
        reportedWhileHeld.length === heldAgreementWindow &&
        Math.abs(median(reportedWhileHeld) - held.renderAhead) <
          heldAgreementSeconds
      ) {
        releaseHeld();
      }
    }
    pushWithin(
      renderAheads,
      held ? held.renderAhead : renderAhead,
      sampleWindow,
    );
    pushClockOffset(heard);
    const reading: OutputClockReading = {
      renderAhead: Math.max(0, median(renderAheads)),
      clockOffset: held
        ? trimmedMean(contextOffsets) + held.heardShift
        : median(clockOffsets),
    };
    const changed =
      published === undefined ||
      Math.abs(reading.renderAhead - published.renderAhead) >=
        renderAheadStepSeconds ||
      Math.abs(reading.clockOffset - published.clockOffset) >=
        clockOffsetStepSeconds;
    if (!changed) {
      return;
    }
    published = reading;
    for (const listener of listeners) {
      listener(reading);
    }
  };

  const isResting = () => !active && renderAheads.length >= sampleWindow;

  const hasDrifted = () => {
    const offset = readClockOffset(readHeard(context, performance.now()));
    const spread = Math.max(...clockOffsets) - Math.min(...clockOffsets);
    return Math.abs(offset - median(clockOffsets)) > spread;
  };

  const observeStall = () => {
    if (context.state === 'running') {
      stall.observe(context.currentTime, performance.now());
    }
  };

  const readIntervalMs = () => {
    if (isResting()) {
      return restObserveMs;
    }
    return refilling && !held ? refillIntervalMs : sampleIntervalMs;
  };

  const schedule = () => {
    const ms = readIntervalMs();
    if (timer !== undefined && timerMs === ms) {
      return;
    }
    clearInterval(timer);
    timerMs = ms;
    timer = setInterval(() => {
      if (isResting()) {
        observeStall();
      } else {
        sample();
      }
      schedule();
    }, ms);
  };

  const applyState = () => {
    const running = context.state === 'running';
    if (!running && !pausedReading && published && contextOffsets.length > 0) {
      pausedReading = {
        renderAhead: published.renderAhead,
        heardShift: published.clockOffset - trimmedMean(contextOffsets),
      };
    }
    if (running && pausedReading) {
      releaseHeld();
      held = pausedReading;
      pausedReading = undefined;
    }
    contextOffsets.length = 0;
    runningSinceMs = running ? performance.now() : undefined;
    stall.restart(performance.now());
    for (const delay of startupSampleDelaysMs) {
      setTimeout(sample, delay);
    }
  };

  const listen = (target: AudioContext) => {
    target.addEventListener('statechange', () => {
      if (target === context) {
        applyState();
      }
    });
    target.addEventListener('sinkchange', () => {
      if (target === context) {
        releaseHeld();
      }
    });
  };

  schedule();
  listen(context);

  return {
    read: () => published,
    whenSettled: async () => {
      const elapsedMs =
        runningSinceMs === undefined ? 0 : performance.now() - runningSinceMs;
      if (elapsedMs < settleMs) {
        await new Promise((resolve) => {
          setTimeout(resolve, settleMs - elapsedMs);
        });
      }
      sample();
    },
    wake: async () => {
      if (context.state !== 'running') {
        await context.resume();
        return;
      }
      const nowMs = performance.now();
      stall.observe(context.currentTime, nowMs);
      if (!stall.isStalled(nowMs)) {
        return;
      }
      await context.suspend();
      await context.resume();
    },
    setActive: (next) => {
      if (active === next) {
        return;
      }
      active = next;
      if (active) {
        if (hasDrifted()) {
          clockOffsets.length = 0;
          contextOffsets.length = 0;
          for (const delay of startupSampleDelaysMs) {
            setTimeout(sample, delay);
          }
        }
        sample();
      }
      schedule();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach: (next) => {
      context = next;
      published = undefined;
      pausedReading = undefined;
      releaseHeld();
      listen(next);
      applyState();
    },
  };
};
