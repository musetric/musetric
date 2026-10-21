import { getMaximum } from './stats.js';

const clickFrequencies = [880, 1320];
const clickSeconds = 0.05;
const clickTauSeconds = 0.015;
const thresholdShare = 0.25;
const clickGapSeconds = 0.25;

const matchFrequency = (
  samples: ArrayLike<number>,
  sampleRate: number,
  frequency: number,
  score: Float64Array,
) => {
  const length = Math.round(clickSeconds * sampleRate);
  const decay = Math.exp(-1 / (clickTauSeconds * sampleRate));
  const angle = (2 * Math.PI * frequency) / sampleRate;
  const stepRe = decay * Math.cos(angle);
  const stepIm = decay * Math.sin(angle);
  const tailMagnitude = decay ** length;
  const tailRe = tailMagnitude * Math.cos(angle * length);
  const tailIm = tailMagnitude * Math.sin(angle * length);
  const sumRe = new Float64Array(samples.length + 1);
  const sumIm = new Float64Array(samples.length + 1);
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const nextRe = sumRe[index + 1];
    const nextIm = sumIm[index + 1];
    sumRe[index] = samples[index] + stepRe * nextRe - stepIm * nextIm;
    sumIm[index] = stepRe * nextIm + stepIm * nextRe;
  }
  for (let index = 0; index < score.length; index += 1) {
    const laterRe = sumRe[index + length];
    const laterIm = sumIm[index + length];
    const re = sumRe[index] - (tailRe * laterRe - tailIm * laterIm);
    const im = sumIm[index] - (tailRe * laterIm + tailIm * laterRe);
    score[index] = Math.max(score[index], Math.hypot(re, im));
  }
};

export const getClickScore = (
  samples: ArrayLike<number>,
  sampleRate: number,
): Float64Array => {
  const length = Math.round(clickSeconds * sampleRate);
  const score = new Float64Array(Math.max(0, samples.length - length + 1));
  for (const frequency of clickFrequencies) {
    matchFrequency(samples, sampleRate, frequency, score);
  }
  return score;
};

export const findClicks = (
  samples: ArrayLike<number>,
  sampleRate: number,
): number[] => {
  const score = getClickScore(samples, sampleRate);
  const threshold = thresholdShare * getMaximum(score);
  const gap = Math.round(clickGapSeconds * sampleRate);
  const clicks: number[] = [];
  let index = 0;
  while (index < score.length) {
    if (score[index] < threshold) {
      index += 1;
      continue;
    }
    let peak = index;
    for (
      let candidate = index;
      candidate < Math.min(score.length, index + gap);
      candidate += 1
    ) {
      if (score[candidate] > score[peak]) {
        peak = candidate;
      }
    }
    clicks.push(peak);
    index = peak + gap;
  }
  return clicks;
};
