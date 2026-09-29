import { type WindowFunctionName, windowFunctions } from '@musetric/fft';

const hopSeconds = 0.005;
const windowSeconds = 2048 / 48000;
const zeroPaddingFactor = 2;
const windowName: WindowFunctionName = 'hann';
const spectrumMaxFrequency = 12000;
const phaseMaxFrequency = 8000;

const minimumFrequency = 55;
const maximumFrequency = 1100;
const candidateStepCents = 20;
const harmonicCount = 10;
const peakSeparationCents = 240;
const loudnessExponent = 0.6;
const fundamentalWeight = 0.4;
const antiWeight = 0.9;
const envelopeHalfOctaves = 1 / 6;
const envelopeMinHalfFrequency = 100;
const levelFloorDb = -61;
const levelRangeDb = 20;
const periodicityFloor = 0.3;
const agreementBoostCap = 1.25;
const refineHarmonics = 40;
const refineTolerance = 0.02;
const refineSearchBins = 2;
const refineRangeDb = 70;
const coarseRefineHarmonics = 3;
const coarseRefineTolerance = 0.06;

const voicingBias = -1.05;
const voicingPeriodicity = 5.2802;
const voicingSalience = 0.465;
const voicingShare = 4.6998;
const voicingLevel = 0.1008;

const historyFrames = 72;
const lookaheadFrames = 8;
const jumpCostCents = 0.006;
const jumpCapCents = 1200;
const unvoicedCost = 0.9;
const voicedTransitionCost = 1.8;
const voicingScale = 0.5;
const confidenceScale = 4;
const smoothBackFrames = 3;
const smoothAheadFrames = 2;
const smoothLimitCents = 150;
const foldMaxFrames = 20;
const foldGapFrames = 5;
const foldAnchorFrames = 10;
const foldToleranceCents = 150;
const foldSplitCents = 600;
const fillGapFrames = 12;
const fillBaseCents = 50;
const fillSlopeCents = 50;
const fillCapCents = 250;
const echoMaxFrames = 40;
const echoGapFrames = 10;
const echoWindowFrames = 150;
const echoHeldFrames = 40;
const echoToleranceCents = 50;
const echoSplitCents = 200;
const echoDropDb = 15;
const echoOffsetDb = 3;
const spikeLimitCents = 80;
const spikeAloneFrames = 1;
const spikeMajorityFrames = 4;

const ringFrames = 16384;
const batchSlots = 1024;
const maxRuns = 16;

export const pitchLatticeCount = 5;

export type PitchSettings = {
  sampleRate: number;
  windowName: WindowFunctionName;
  hop: number;
  windowSize: number;
  fftSize: number;
  halfSize: number;
  spectrumBins: number;
  phaseBins: number;
  support: number;
  windowOffset: number;
  levelOffsetDb: number;
  minimumFrequency: number;
  candidateCount: number;
  candidateStepCents: number;
  harmonicCount: number;
  peakSeparationCents: number;
  loudnessExponent: number;
  fundamentalWeight: number;
  antiWeight: number;
  envelopeHalfOctaves: number;
  envelopeMinHalfBins: number;
  levelFloorDb: number;
  levelRangeDb: number;
  minimumLag: number;
  lagCount: number;
  periodicityFloor: number;
  agreementBoostCap: number;
  refineHarmonics: number;
  refineTolerance: number;
  refineSearchBins: number;
  refineRangeDb: number;
  coarseRefineHarmonics: number;
  coarseRefineTolerance: number;
  voicingBias: number;
  voicingPeriodicity: number;
  voicingSalience: number;
  voicingShare: number;
  voicingLevel: number;
  historyFrames: number;
  lookaheadFrames: number;
  jumpCostCents: number;
  jumpCapCents: number;
  unvoicedCost: number;
  voicedTransitionCost: number;
  voicingScale: number;
  confidenceScale: number;
  smoothBackFrames: number;
  smoothAheadFrames: number;
  smoothLimitCents: number;
  foldMaxFrames: number;
  foldGapFrames: number;
  foldAnchorFrames: number;
  foldToleranceCents: number;
  foldSplitCents: number;
  fillGapFrames: number;
  fillBaseCents: number;
  fillSlopeCents: number;
  fillCapCents: number;
  echoMaxFrames: number;
  echoGapFrames: number;
  echoWindowFrames: number;
  echoHeldFrames: number;
  echoToleranceCents: number;
  echoSplitCents: number;
  echoDropDb: number;
  echoOffsetDb: number;
  spikeLimitCents: number;
  spikeAloneFrames: number;
  spikeMajorityFrames: number;
  repairBackFrames: number;
  repairAheadFrames: number;
  ringFrames: number;
  batchSlots: number;
  maxRuns: number;
  spanCapacity: number;
};

export const createPitchSettings = (sampleRate: number): PitchSettings => {
  const hop = Math.round(hopSeconds * sampleRate);
  const windowSize = 2 * Math.round((windowSeconds * sampleRate) / 2);
  const fftSize = 2 ** Math.ceil(Math.log2(windowSize * zeroPaddingFactor));
  const halfSize = fftSize / 2;
  const binFrequency = sampleRate / fftSize;
  const top = Math.min(maximumFrequency, sampleRate / 2);
  const minimumLag = Math.ceil(sampleRate / top);
  const maximumLag = Math.floor(sampleRate / minimumFrequency);
  const windowOffset = Math.floor(hop / 2);
  const foldReach = foldMaxFrames + foldGapFrames + foldAnchorFrames;
  const support = windowSize / 2 + windowOffset;
  const windowEnergy = windowFunctions[windowName](windowSize).reduce(
    (sum, value) => sum + value * value,
    0,
  );
  return {
    sampleRate,
    windowName,
    hop,
    windowSize,
    fftSize,
    halfSize,
    spectrumBins: Math.min(
      halfSize,
      Math.ceil(spectrumMaxFrequency / binFrequency),
    ),
    phaseBins: Math.min(halfSize, Math.ceil(phaseMaxFrequency / binFrequency)),
    support,
    windowOffset,
    levelOffsetDb: 10 * Math.log10(halfSize * windowEnergy),
    minimumFrequency,
    candidateCount:
      Math.ceil(
        (1200 * Math.log2(top / minimumFrequency)) / candidateStepCents,
      ) + 1,
    candidateStepCents,
    harmonicCount,
    peakSeparationCents,
    loudnessExponent,
    fundamentalWeight,
    antiWeight,
    envelopeHalfOctaves,
    envelopeMinHalfBins: envelopeMinHalfFrequency / binFrequency,
    levelFloorDb,
    levelRangeDb,
    minimumLag,
    lagCount: maximumLag - minimumLag + 1,
    periodicityFloor,
    agreementBoostCap,
    refineHarmonics,
    refineTolerance,
    refineSearchBins,
    refineRangeDb,
    coarseRefineHarmonics,
    coarseRefineTolerance,
    voicingBias,
    voicingPeriodicity,
    voicingSalience,
    voicingShare,
    voicingLevel,
    historyFrames,
    lookaheadFrames,
    jumpCostCents,
    jumpCapCents,
    unvoicedCost,
    voicedTransitionCost,
    voicingScale,
    confidenceScale,
    smoothBackFrames,
    smoothAheadFrames,
    smoothLimitCents,
    foldMaxFrames,
    foldGapFrames,
    foldAnchorFrames,
    foldToleranceCents,
    foldSplitCents,
    fillGapFrames,
    fillBaseCents,
    fillSlopeCents,
    fillCapCents,
    echoMaxFrames,
    echoGapFrames,
    echoWindowFrames,
    echoHeldFrames,
    echoToleranceCents,
    echoSplitCents,
    echoDropDb,
    echoOffsetDb,
    spikeLimitCents,
    spikeAloneFrames,
    spikeMajorityFrames,
    repairBackFrames:
      Math.max(foldReach, echoMaxFrames + echoWindowFrames) + fillGapFrames + 1,
    repairAheadFrames:
      Math.max(foldReach, echoMaxFrames + echoGapFrames) + fillGapFrames + 1,
    ringFrames,
    batchSlots,
    maxRuns,
    spanCapacity: batchSlots * hop + maxRuns * (hop + 2 * support),
  };
};
