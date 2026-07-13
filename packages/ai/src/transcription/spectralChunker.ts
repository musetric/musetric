export const sampleRate = 16000;

const hop = 256;
const win = 1024;
const bandHz: [number, number] = [100, 8000];

const flatnessBreath = 0.12;
const flatnessTonal = 0.08;
const silenceEnergyRatio = 0.15;
const minPauseSeconds = 0.1;
const minVoiceSeconds = 0.4;
const regionBreakSeconds = 1.2;
const defaultMaxMinRatio = 0.5;
const silenceMajority = 0.5;

const reverseBits = (value: number, bits: number): number => {
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | ((value >> i) & 1);
  }
  return result;
};

export const fftInPlace = (re: Float64Array, im: Float64Array): void => {
  const n = re.length;
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    const j = reverseBits(i, bits);
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = start + k;
        const b = a + half;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
};

export const hanningWindow = (size: number): Float64Array => {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
};

const bandBins = (): { lo: number; hi: number } => {
  const binHz = sampleRate / win;
  let lo = Math.ceil(bandHz[0] / binHz);
  let hi = Math.floor(bandHz[1] / binHz);
  lo = Math.max(0, lo);
  hi = Math.min(win / 2, hi);
  return { lo, hi };
};

export type Features = {
  energy: Float32Array;
  flatness: Float32Array;
};

export const computeFeatures = (audio: Float32Array): Features => {
  const frameCount = Math.max(0, Math.floor((audio.length - win) / hop) + 1);
  if (frameCount === 0) {
    return { energy: new Float32Array(0), flatness: new Float32Array(0) };
  }
  const window = hanningWindow(win);
  const { lo, hi } = bandBins();
  const energy = new Float32Array(frameCount);
  const flatness = new Float32Array(frameCount);
  const re = new Float64Array(win);
  const im = new Float64Array(win);

  for (let frame = 0; frame < frameCount; frame++) {
    const offset = frame * hop;
    let sumSquares = 0;
    for (let i = 0; i < win; i++) {
      const sample = audio[offset + i];
      sumSquares += sample * sample;
      re[i] = sample * window[i];
      im[i] = 0;
    }
    energy[frame] = Math.sqrt(sumSquares / win);

    fftInPlace(re, im);
    let logSum = 0;
    let meanSum = 0;
    const count = hi - lo + 1;
    for (let k = lo; k <= hi; k++) {
      const power = re[k] * re[k] + im[k] * im[k] + 1e-12;
      logSum += Math.log(power);
      meanSum += power;
    }
    const geoMean = Math.exp(logSum / count);
    const arithMean = meanSum / count;
    flatness[frame] = arithMean > 0 ? geoMean / arithMean : 0;
  }
  return { energy, flatness };
};

const frameToSeconds = (frame: number): number => (frame * hop) / sampleRate;
const secondsToFrame = (seconds: number): number =>
  Math.round((seconds * sampleRate) / hop);

const isAnchor = (
  energy: Float32Array,
  flatness: Float32Array,
  frame: number,
  energyMedian: number,
): boolean =>
  flatness[frame] < flatnessTonal ||
  energy[frame] >= silenceEnergyRatio * energyMedian;

const positiveMedian = (energy: Float32Array): number => {
  const positives: number[] = [];
  for (const value of energy) {
    if (value > 0) {
      positives.push(value);
    }
  }
  if (positives.length === 0) {
    return 1e-6;
  }
  positives.sort((a, b) => a - b);
  const mid = Math.floor(positives.length / 2);
  const value =
    positives.length % 2 === 0
      ? (positives[mid - 1] + positives[mid]) / 2
      : positives[mid];
  return value || 1e-6;
};

const argMinIndex = (
  values: Float32Array,
  from: number,
  to: number,
): number => {
  let best = from;
  for (let i = from + 1; i < to; i++) {
    if (values[i] < values[best]) {
      best = i;
    }
  }
  return best;
};

const argMaxIndex = (
  values: Float32Array,
  from: number,
  to: number,
): number => {
  let best = from;
  for (let i = from + 1; i < to; i++) {
    if (values[i] > values[best]) {
      best = i;
    }
  }
  return best;
};

type Frames = {
  energy: Float32Array;
  flatness: Float32Array;
  silence: Uint8Array;
};

type Pause = {
  center: number;
  score: number;
  isRegionBreak: boolean;
};

const pauseForRun = (
  frames: Frames,
  from: number,
  to: number,
): Pause | undefined => {
  const duration = frameToSeconds(to - from);
  if (duration < minPauseSeconds) {
    return undefined;
  }
  const { energy, flatness, silence } = frames;
  let silenceCount = 0;
  let flatnessSum = 0;
  for (let i = from; i < to; i++) {
    silenceCount += silence[i];
    flatnessSum += flatness[i];
  }
  const silenceFraction = silenceCount / (to - from);
  const flatnessMean = flatnessSum / (to - from);
  const silent = silenceFraction > silenceMajority;
  const center = silent
    ? argMinIndex(energy, from, to)
    : argMaxIndex(flatness, from, to);
  const isRegionBreak = silent && duration >= regionBreakSeconds;
  return {
    center: frameToSeconds(center),
    score: flatnessMean * Math.min(duration, 0.5) + silenceFraction,
    isRegionBreak,
  };
};

const findPauses = (
  energy: Float32Array,
  flatness: Float32Array,
  energyMedian: number,
): Pause[] => {
  const total = flatness.length;
  const silence = new Uint8Array(total);
  const cuttable = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    silence[i] = energy[i] < silenceEnergyRatio * energyMedian ? 1 : 0;
    cuttable[i] = flatness[i] >= flatnessBreath || silence[i] ? 1 : 0;
  }
  const frames: Frames = { energy, flatness, silence };
  const pauses: Pause[] = [];
  let index = 0;
  while (index < total) {
    if (!cuttable[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < total && cuttable[end]) {
      end += 1;
    }
    const pause = pauseForRun(frames, index, end);
    if (pause) {
      pauses.push(pause);
    }
    index = end;
  }
  return pauses;
};

type CutWindow = { start: number; low: number; high: number };

const chooseCut = (
  pauses: Pause[],
  flatness: Float32Array,
  window: CutWindow,
): number => {
  const { start, low, high } = window;
  const regionBreaks = pauses.filter(
    (p) => start < p.center && p.center <= high && p.isRegionBreak,
  );
  if (regionBreaks.length > 0) {
    return regionBreaks.reduce(
      (a, b) => (a.center <= b.center ? a : b),
      regionBreaks[0],
    ).center;
  }
  const inWindow = pauses.filter((p) => low <= p.center && p.center <= high);
  if (inWindow.length > 0) {
    return inWindow.reduce((a, b) => (a.score >= b.score ? a : b), inWindow[0])
      .center;
  }
  const loFrame = secondsToFrame(low);
  const hiFrame = secondsToFrame(high);
  if (hiFrame > loFrame) {
    return frameToSeconds(argMaxIndex(flatness, loFrame, hiFrame));
  }
  return high;
};

export type Span = [number, number];

export const computeChunks = (
  audio: Float32Array,
  chunkSize: number,
  minChunkArg?: number,
): Span[] => {
  const { energy, flatness } = computeFeatures(audio);
  if (flatness.length === 0) {
    return [];
  }
  const energyMedian = positiveMedian(energy);
  const voicedEnd = audio.length / sampleRate;
  const minChunk =
    minChunkArg ?? Math.min(15.0, chunkSize * defaultMaxMinRatio);
  const pauses = findPauses(energy, flatness, energyMedian);
  const minVoice = Math.max(1, secondsToFrame(minVoiceSeconds));
  const total = flatness.length;

  const nextAnchor = (fromFrame: number): number => {
    let frame = fromFrame;
    while (frame < total) {
      if (!isAnchor(energy, flatness, frame, energyMedian)) {
        frame += 1;
        continue;
      }
      let run = frame;
      while (run < total && isAnchor(energy, flatness, run, energyMedian)) {
        run += 1;
      }
      if (run - frame >= minVoice) {
        return frameToSeconds(frame);
      }
      frame = run;
    }
    return frameToSeconds(total - 1);
  };

  const round3 = (value: number): number => Math.round(value * 1000) / 1000;

  const chunks: Span[] = [];
  let start = nextAnchor(0);
  while (start < voicedEnd - 0.5) {
    const low = start + minChunk;
    const high = Math.min(start + chunkSize, voicedEnd);
    const cut = chooseCut(pauses, flatness, { start, low, high });
    chunks.push([round3(start), round3(cut)]);
    start = Math.max(nextAnchor(secondsToFrame(cut)), cut + 0.1);
  }
  return chunks;
};
