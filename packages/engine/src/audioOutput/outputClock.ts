import { createClockStall } from './clockStall.cross.js';

const sampleIntervalMs = 100;
const sampleWindow = 15;
const contextOffsetWindow = 30;
const startupSampleDelaysMs = [0, 20, 40, 60, 80];
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
  let reported = true;
  let pausedReading: HeldReading | undefined = undefined;
  let held: HeldReading | undefined = undefined;
  let runningSinceMs =
    context.state === 'running' ? performance.now() : undefined;
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
    reportedWhileHeld.length = 0;
    clearSamples();
  };

  const sample = () => {
    if (context.state !== 'running') {
      return;
    }
    const nowMs = performance.now();
    stall.observe(context.currentTime, nowMs);
    contextOffsets.push(
      context.currentTime - (performance.timeOrigin + nowMs) / 1000,
    );
    if (contextOffsets.length > contextOffsetWindow) {
      contextOffsets.shift();
    }
    const heard = readHeard(context, nowMs);
    if (heard.reported !== reported) {
      reported = heard.reported;
      clearSamples();
    }
    const renderAhead =
      context.currentTime -
      (heard.contextTime + (nowMs - heard.performanceMs) / 1000);
    const clockOffset =
      heard.contextTime - (performance.timeOrigin + heard.performanceMs) / 1000;
    if (held) {
      reportedWhileHeld.push(renderAhead);
      if (reportedWhileHeld.length > heldAgreementWindow) {
        reportedWhileHeld.shift();
      }
      if (
        reportedWhileHeld.length === heldAgreementWindow &&
        Math.abs(median(reportedWhileHeld) - held.renderAhead) <
          heldAgreementSeconds
      ) {
        releaseHeld();
      }
    }
    renderAheads.push(held ? held.renderAhead : renderAhead);
    clockOffsets.push(clockOffset);
    if (renderAheads.length > sampleWindow) {
      renderAheads.shift();
      clockOffsets.shift();
    }
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

  setInterval(sample, sampleIntervalMs);
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
