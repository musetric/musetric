import { type Logger } from '@musetric/resource-utils';
import { analyzeLoudness, type LoudnessAnalysis } from './analyzeLoudness.js';
import { readPcm } from './generateWavePeaks/readPcm.js';

export type LeadVisualLoudnessAnalysis = LoudnessAnalysis & {
  p95RmsDb: number;
};

export type AnalyzeLeadVisualLoudnessOptions = {
  fromPath: string;
  sampleRate: number;
  logger: Logger;
};

const epsilon = 1e-12;
const windowSeconds = 0.1;
const hopSeconds = 0.025;
const minimumActivePeakDb = -55;
const minimumActiveDb = -70;

const amplitudeToDb = (value: number) => 20 * Math.log10(value + epsilon);

const percentile = (values: number[], ratio: number): number | undefined => {
  if (!values.length) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
};

export const analyzeLeadVisualLoudness = async (
  options: AnalyzeLeadVisualLoudnessOptions,
): Promise<LeadVisualLoudnessAnalysis> => {
  const { fromPath, sampleRate, logger } = options;
  const loudness = await analyzeLoudness({ fromPath, logger });
  const windowFrameCount = Math.max(1, Math.round(windowSeconds * sampleRate));
  const hopFrameCount = Math.max(1, Math.round(hopSeconds * sampleRate));
  const activeThresholdDb = Math.max(
    minimumActiveDb,
    loudness.integratedLoudnessDb - 20,
  );
  const activeRmsValues: number[] = [];
  const windowSamples = new Float32Array(windowFrameCount);

  let writeIndex = 0;
  let filledFrameCount = 0;
  let nextWindowStart = 0;

  const analyzeWindow = () => {
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < windowFrameCount; i += 1) {
      const value = windowSamples[(writeIndex + i) % windowFrameCount];
      sumSquares += value * value;
      peak = Math.max(peak, Math.abs(value));
    }

    const rmsDb = amplitudeToDb(Math.sqrt(sumSquares / windowFrameCount));
    const peakDb = amplitudeToDb(peak);
    if (rmsDb >= activeThresholdDb && peakDb >= minimumActivePeakDb) {
      activeRmsValues.push(rmsDb);
    }
  };

  await readPcm({
    fromPath,
    sampleRate,
    logger,
    onSample: (left, right, sampleIndex) => {
      windowSamples[writeIndex] = (left + right) * 0.5;
      writeIndex = (writeIndex + 1) % windowFrameCount;
      filledFrameCount = Math.min(windowFrameCount, filledFrameCount + 1);

      if (
        filledFrameCount === windowFrameCount &&
        sampleIndex >= nextWindowStart + windowFrameCount - 1
      ) {
        analyzeWindow();
        nextWindowStart += hopFrameCount;
      }
    },
  });

  return {
    ...loudness,
    p95RmsDb:
      percentile(activeRmsValues, 0.95) ?? loudness.integratedLoudnessDb,
  };
};
