import { describe, expect, it } from 'vitest';
import { analyzeDelay, type DelayTake } from './analysis/delay.js';
import { analyzeHoles, analyzeSound } from './analysis/sound.js';
import { analyzeTiming } from './analysis/timing.js';
import { decodeSamples, type PageLatency, type TimingRun } from './runs.js';
import { createSibilantTest } from './signals.js';
import { createTakeWindow, layTakePiece } from './take.js';

const sampleRate = 48000;
const beatSeconds = 0.5;

const latency: PageLatency = {
  sampleRate,
  latencySource: 'calibrated',
  reportedOutputFrameCount: 2400,
  outputFrameCount: 3840,
  recordingFrameCount: 4800,
  timedRoundTripFrameCount: 11520,
  outputKind: 'builtIn',
};

const addClick = (samples: Float32Array, start: number) => {
  for (let index = 0; index < 0.05 * sampleRate; index += 1) {
    samples[start + index] +=
      0.5 *
      Math.exp(-index / (0.015 * sampleRate)) *
      Math.sin((2 * Math.PI * 880 * index) / sampleRate);
  }
};

type TimingScene = {
  tempo: number;
  playheadAheadMs: number;
  takeLateMs: number;
};

const createTimingRun = (scene: TimingScene): TimingRun => {
  const { tempo, playheadAheadMs, takeLateMs } = scene;
  const beatFrames = Array.from({ length: 40 }, (_, index) =>
    Math.round((10 + index * beatSeconds) * sampleRate),
  );
  const startFrame = beatFrames[0] - 0.15 * sampleRate;
  const playEpoch = 1_000_000;
  const heardFrame = (frame: number) => (frame - startFrame) / tempo;
  const heardSeconds = Math.ceil(11 / tempo);
  const captured = new Float32Array(heardSeconds * sampleRate);
  for (const beat of beatFrames.slice(0, 20)) {
    addClick(captured, Math.round(heardFrame(beat)));
  }
  const chunkFrames = 480;
  const chunks: [number, number][] = Array.from(
    { length: captured.length / chunkFrames },
    (_, index) => [
      index * chunkFrames,
      playEpoch + ((index * chunkFrames) / sampleRate) * 1000,
    ],
  );
  const playhead: [number, number, number][] = Array.from(
    { length: heardSeconds * 60 },
    (_, index) => {
      const epochMs = playEpoch + (index * 1000) / 60;
      const frame =
        startFrame +
        ((epochMs - playEpoch + playheadAheadMs) / 1000) * sampleRate * tempo;
      return [epochMs, frame, 1];
    },
  );
  const firstFrame = startFrame - 0.5 * sampleRate;
  const sung = new Float32Array(Math.ceil(heardFrame(beatFrames[20])));
  for (const beat of beatFrames.slice(0, 20)) {
    addClick(
      sung,
      Math.round(heardFrame(beat) + (takeLateMs / 1000) * sampleRate),
    );
  }
  const take = createTakeWindow(firstFrame, beatFrames[21], tempo);
  layTakePiece(take, { songStartFrame: startFrame, tempo, samples: sung });
  return {
    sampleRate,
    tempo,
    startFrame,
    beatFrames,
    playhead,
    captured: { sampleRate, samples: captured, chunks },
    take: { firstFrame, samples: take.samples },
    latency,
  };
};

describe('timing analysis', () => {
  it.each([0.3, 0.5, 0.75, 1, 1.25, 1.5, 2])(
    'reads how far the playhead and a take sung at tempo %f sit from the beats',
    (tempo) => {
      const result = analyzeTiming(
        createTimingRun({ tempo, playheadAheadMs: 12, takeLateMs: -4 }),
      );
      expect(result.heardClickCount).toBe(20);
      expect(result.playhead.count).toBe(20);
      expect(result.playhead.median).toBeCloseTo(12, 0);
      expect(result.take.count).toBe(20);
      expect(result.take.median).toBeCloseTo(-4, 0);
    },
  );
});

const createDelayTake = (behindMs: number, view: 'notes' | 'spectrum') => {
  const startedAt = 2_000_000;
  const behind = (behindMs / 1000) * sampleRate;
  const edges = Array.from({ length: 300 }, (_, index) => {
    const at = startedAt + index * 50;
    const playheadFrame = sampleRate * (30 + index * 0.05);
    return {
      startedAt: at,
      playheadFrame,
      renderedAt: at + 4,
      pitchEdge: playheadFrame - behind,
      energyEdge: playheadFrame - behind / 2,
      writtenEnd: playheadFrame - behind / 4,
      level: 0.1,
    };
  });
  const arrivals: [number, number, number, number][] = Array.from(
    { length: 1000 },
    (_, index) => {
      const captureMs = startedAt + index * 10;
      return [
        captureMs,
        captureMs + 10 + (index % 10 === 0 ? 5 : 1),
        480,
        sampleRate,
      ];
    },
  );
  const take: DelayTake = {
    run: {
      sampleRate,
      view,
      startedAt,
      stoppedAt: startedAt + 15_000,
      arrivals,
      latency,
      latencyDuring: latency,
    },
    edges,
  };
  return take;
};

describe('delay analysis', () => {
  it('reads the drawn edges and the chunk arrivals', () => {
    const result = analyzeDelay(
      createDelayTake(40, 'notes'),
      createDelayTake(40, 'spectrum'),
    );
    expect(result.line.median).toBeCloseTo(40);
    expect(result.spectrum.median).toBeCloseTo(20);
    expect(result.audio.median).toBeCloseTo(10);
    expect(result.renderMs.median).toBeCloseTo(4);
    expect(result.arrivals.p50).toBeCloseTo(1);
    expect(result.arrivals.max).toBeCloseTo(5);
    expect(result.roundTripMs).toBeCloseTo(240);
    expect(result.reportedOutputMs).toBeCloseTo(50);
    expect(result.outputMs).toBeCloseTo(80);
  });
});

const embed = (reference: Float32Array, leadSeconds: number, gain: number) => {
  const samples = new Float32Array(reference.length + 4 * sampleRate);
  const lead = Math.round(leadSeconds * sampleRate);
  reference.forEach((value, index) => {
    samples[lead + index] = value * gain;
  });
  return { sampleRate, samples };
};

describe('sound analysis', () => {
  const reference = {
    sampleRate,
    samples: createSibilantTest(sampleRate),
  };

  it('compares the app against the browser path', () => {
    const result = analyzeSound(
      reference,
      embed(reference.samples, 1.23, 0.5),
      embed(reference.samples, 2.05, 1),
    );
    expect(result.browser.correlation).toBeGreaterThan(0.99);
    for (const difference of result.bandDifference) {
      expect(difference).toBeCloseTo(6.02, 1);
    }
    expect(result.app.peak - result.browser.peak).toBeCloseTo(6.02, 1);
    expect(
      result.app.sibilantOverVowel - result.browser.sibilantOverVowel,
    ).toBeCloseTo(0, 1);
  });

  it('counts gaps of exact zeros', () => {
    const take = new Float32Array(10 * sampleRate).fill(0.01);
    take.fill(0, 0, sampleRate / 2);
    take.fill(0, 9 * sampleRate);
    take.fill(0, 3 * sampleRate, 3 * sampleRate + 96);
    take.fill(0, 5 * sampleRate, 5 * sampleRate + 10);
    const result = analyzeHoles({ sampleRate, samples: take });
    expect(result.holeCount).toBe(1);
    expect(result.longestMs).toBeCloseTo(2);
    expect(result.rms).toBeCloseTo(-40, 0);
  });
});

describe('page samples', () => {
  it('decodes base64 floats', () => {
    const samples = Float32Array.from([0.5, -0.25, 1e-7, 3]);
    const text = Buffer.from(samples.buffer).toString('base64');
    expect([...decodeSamples(text)]).toEqual([...samples]);
  });
});
