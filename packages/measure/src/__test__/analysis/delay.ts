import { getPercentile, getSpread, type Spread } from '../dsp/stats.js';
import { type DelayRun, type EdgeLog } from '../runs.js';

const settleMs = 2000;
const tailMs = 500;

export type DelayTake = {
  run: DelayRun;
  edges: EdgeLog[];
};

const getSteadyEdges = (take: DelayTake) =>
  take.edges.filter(
    (edge) =>
      edge.startedAt > take.run.startedAt + settleMs &&
      edge.startedAt < take.run.stoppedAt - tailMs,
  );

const getBehindMs = (
  edges: readonly EdgeLog[],
  sampleRate: number,
  readEdge: (edge: EdgeLog) => number,
) =>
  edges.flatMap((edge) => {
    const frame = readEdge(edge);
    return frame < 0
      ? []
      : [((edge.playheadFrame - frame) / sampleRate) * 1000];
  });

export type ArrivalSpread = {
  count: number;
  p50: number;
  p99: number;
  max: number;
};

const getArrivals = (run: DelayRun): ArrivalSpread => {
  const delays = run.arrivals
    .filter(
      (arrival) =>
        arrival[0] > run.startedAt + settleMs && arrival[0] < run.stoppedAt,
    )
    .map((arrival) => {
      const [captureMs, arrivalMs, frameCount, sampleRate] = arrival;
      return arrivalMs - (captureMs + (frameCount / sampleRate) * 1000);
    });
  return {
    count: delays.length,
    p50: getPercentile(delays, 50),
    p99: getPercentile(delays, 99),
    max: getPercentile(delays, 100),
  };
};

const toMs = (frameCount: number, sampleRate: number) =>
  (frameCount / sampleRate) * 1000;

export type DelayResult = {
  renderCount: number;
  line: Spread;
  spectrum: Spread;
  audio: Spread;
  renderMs: Spread;
  arrivals: ArrivalSpread;
  roundTripMs?: number;
  reportedOutputMs: number;
  outputMs: number;
  latencySource: string;
};

export const analyzeDelay = (
  notes: DelayTake,
  spectrum: DelayTake,
): DelayResult => {
  const { sampleRate } = notes.run;
  const noteEdges = getSteadyEdges(notes);
  const spectrumEdges = getSteadyEdges(spectrum);
  const { latency } = notes.run;
  const roundTrip = notes.run.latencyDuring?.timedRoundTripFrameCount;
  return {
    renderCount: noteEdges.length,
    line: getSpread(
      getBehindMs(noteEdges, sampleRate, (edge) => edge.pitchEdge),
    ),
    spectrum: getSpread(
      getBehindMs(spectrumEdges, sampleRate, (edge) => edge.energyEdge),
    ),
    audio: getSpread(
      getBehindMs(noteEdges, sampleRate, (edge) => edge.writtenEnd),
    ),
    renderMs: getSpread(
      noteEdges.map((edge) => edge.renderedAt - edge.startedAt),
    ),
    arrivals: getArrivals(notes.run),
    roundTripMs:
      roundTrip === undefined ? undefined : toMs(roundTrip, sampleRate),
    reportedOutputMs: toMs(latency.reportedOutputFrameCount, sampleRate),
    outputMs: toMs(latency.outputFrameCount, sampleRate),
    latencySource: latency.latencySource,
  };
};
