import { createResourceCell } from '@musetric/utils';
import { createDynamicUniformParams } from '../common/dynamicUniform.js';
import {
  type ExtSpectrogramConfig,
  floorMod,
  type SpectrogramColumnRange,
} from '../common/extConfig.js';

export const slotOffsetByteOffset = 40;
const columnCountByteOffset = 44;
const screenBaseByteOffset = 48;
const baseSlotByteOffset = 52;
const paramsByteLength = 108;

const minimumVocalFrequency = 55;
const maximumVocalFrequency = 1100;
const candidateStepCents = 20;
const minimumFundamentalIntensity = 0.075;
const minimumScore = 0.145;
const harmonicCount = 10;

const latticeCount = 5;
const jumpCostCents = 0.0009;
const unvoicedCost = 0.12;
const voicedTransitionCost = 0.09;
const peakSeparationCents = 60;

const swipeMixWeight = 0.24;
const swipeNegativeScale = 1.6;
const swipeNormalizeBias = 0.5;
const swipeGate = -1.0;

const twmMixWeight = 0.25;
const twmReverseWeight = 1.0;
const twmReverseSigmaCents = 110;

export const fundamentalTrackWindow = 8;

export type FundamentalFrequencyParams = {
  halfSize: number;
  windowCount: number;
  windowSize: number;
  candidateCount: number;
  sampleRate: number;
  minimumFrequency: number;
  candidateStepCents: number;
  minimumFundamentalIntensity: number;
  minimumScore: number;
  harmonicCount: number;
  latticeCount: number;
  trackWindow: number;
  jumpCostCents: number;
  unvoicedCost: number;
  voicedTransitionCost: number;
  peakSeparationCents: number;
  swipeMixWeight: number;
  swipeNegativeScale: number;
  swipeNormalizeBias: number;
  swipeGate: number;
  twmMixWeight: number;
  twmReverseWeight: number;
  twmReverseSigmaCents: number;
};

const toParams = (config: ExtSpectrogramConfig): FundamentalFrequencyParams => {
  const windowSize = config.windowSize * config.zeroPaddingFactor;
  const halfSize = windowSize / 2;
  const minimumFrequency = minimumVocalFrequency;
  const maximumFrequency = Math.min(
    maximumVocalFrequency,
    config.sampleRate * 0.5,
    config.maxFrequency,
  );
  const candidateCount =
    maximumFrequency > minimumFrequency
      ? Math.ceil(
          (1200 * Math.log2(maximumFrequency / minimumFrequency)) /
            candidateStepCents,
        ) + 1
      : 0;

  return {
    halfSize,
    windowCount: config.windowCount,
    windowSize,
    candidateCount,
    sampleRate: config.sampleRate,
    minimumFrequency,
    candidateStepCents,
    minimumFundamentalIntensity,
    minimumScore,
    harmonicCount,
    latticeCount,
    trackWindow: fundamentalTrackWindow,
    jumpCostCents,
    unvoicedCost,
    voicedTransitionCost,
    peakSeparationCents,
    swipeMixWeight,
    swipeNegativeScale,
    swipeNormalizeBias,
    swipeGate,
    twmMixWeight,
    twmReverseWeight,
    twmReverseSigmaCents,
  };
};

export type StateParams = {
  value: FundamentalFrequencyParams;
  buffer: GPUBuffer;
  byteLength: number;
  writeRange: (range?: SpectrogramColumnRange) => {
    columnCount: number;
    candidateCount: number;
    byteOffset: number;
  };
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: ExtSpectrogramConfig): StateParams => {
      const value = toParams(config);
      const params = createDynamicUniformParams(device, {
        label: 'fundamental-frequency-params-buffer',
        byteLength: paramsByteLength,
        capacity: value.windowCount,
      });

      return {
        value,
        buffer: params.buffer,
        byteLength: params.byteLength,
        writeRange: (range) => {
          const columnCount = range ? range.columnCount : value.windowCount;
          const slotOffset = range ? range.slotOffset : 0;
          const screenBase = range ? range.screenBase : 0;
          const byteOffset = params.write((view) => {
            view.setUint32(0, value.halfSize, true);
            view.setUint32(4, value.windowCount, true);
            view.setUint32(8, value.windowSize, true);
            view.setUint32(12, value.candidateCount, true);
            view.setFloat32(16, value.sampleRate, true);
            view.setFloat32(20, value.minimumFrequency, true);
            view.setFloat32(24, value.candidateStepCents, true);
            view.setFloat32(28, value.minimumFundamentalIntensity, true);
            view.setFloat32(32, value.minimumScore, true);
            view.setUint32(36, value.harmonicCount, true);
            view.setUint32(slotOffsetByteOffset, slotOffset, true);
            view.setUint32(columnCountByteOffset, columnCount, true);
            view.setUint32(screenBaseByteOffset, screenBase, true);
            view.setUint32(
              baseSlotByteOffset,
              floorMod(slotOffset - screenBase, value.windowCount),
              true,
            );
            view.setUint32(56, value.latticeCount, true);
            view.setUint32(60, value.trackWindow, true);
            view.setFloat32(64, value.jumpCostCents, true);
            view.setFloat32(68, value.unvoicedCost, true);
            view.setFloat32(72, value.voicedTransitionCost, true);
            view.setFloat32(76, value.peakSeparationCents, true);
            view.setFloat32(80, value.swipeMixWeight, true);
            view.setFloat32(84, value.swipeNegativeScale, true);
            view.setFloat32(88, value.swipeNormalizeBias, true);
            view.setFloat32(92, value.swipeGate, true);
            view.setFloat32(96, value.twmMixWeight, true);
            view.setFloat32(100, value.twmReverseWeight, true);
            view.setFloat32(104, value.twmReverseSigmaCents, true);
          });
          return {
            columnCount,
            candidateCount: value.candidateCount,
            byteOffset,
          };
        },
      };
    },
    dispose: (params) => {
      params.buffer.destroy();
    },
    equals: (current, next) =>
      current.windowSize === next.windowSize &&
      current.windowCount === next.windowCount &&
      current.sampleRate === next.sampleRate &&
      current.zeroPaddingFactor === next.zeroPaddingFactor &&
      current.maxFrequency === next.maxFrequency,
  });
