const sampleIntervalMs = 100;
const sampleWindow = 15;
const startupSampleDelaysMs = [0, 20, 40, 60, 80];
const renderAheadStepSeconds = 0.001;
const clockOffsetStepSeconds = 0.0005;
const staleTimestampMs = 100;
const settleMs = 1000;

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const readHeard = (context: AudioContext, nowMs: number) => {
  const timestamp = context.getOutputTimestamp();
  const { contextTime = 0, performanceTime = 0 } = timestamp;
  if (
    contextTime > 0 &&
    performanceTime > 0 &&
    nowMs - performanceTime < staleTimestampMs
  ) {
    return { contextTime, performanceMs: performanceTime };
  }
  return {
    contextTime:
      context.currentTime - (context.outputLatency || 0) - context.baseLatency,
    performanceMs: nowMs,
  };
};

export type OutputClockReading = {
  renderAhead: number;
  clockOffset: number;
};

export type EngineOutputClock = {
  read: () => OutputClockReading | undefined;
  subscribe: (listener: (reading: OutputClockReading) => void) => () => void;
  whenSettled: () => Promise<void>;
};

export const createEngineOutputClock = (
  context: AudioContext,
): EngineOutputClock => {
  const renderAheads: number[] = [];
  const clockOffsets: number[] = [];
  const listeners = new Set<(reading: OutputClockReading) => void>();
  let published: OutputClockReading | undefined = undefined;
  let runningSinceMs =
    context.state === 'running' ? performance.now() : undefined;

  const sample = () => {
    if (context.state !== 'running') {
      return;
    }
    const nowMs = performance.now();
    const heard = readHeard(context, nowMs);
    renderAheads.push(
      context.currentTime -
        (heard.contextTime + (nowMs - heard.performanceMs) / 1000),
    );
    clockOffsets.push(
      heard.contextTime - (performance.timeOrigin + heard.performanceMs) / 1000,
    );
    if (renderAheads.length > sampleWindow) {
      renderAheads.shift();
      clockOffsets.shift();
    }
    const reading: OutputClockReading = {
      renderAhead: Math.max(0, median(renderAheads)),
      clockOffset: median(clockOffsets),
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

  setInterval(sample, sampleIntervalMs);
  context.addEventListener('statechange', () => {
    runningSinceMs =
      context.state === 'running' ? performance.now() : undefined;
    for (const delay of startupSampleDelaysMs) {
      setTimeout(sample, delay);
    }
  });

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
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
