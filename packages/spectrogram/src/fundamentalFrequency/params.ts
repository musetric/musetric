import { createResourceCell } from '@musetric/utils';
import { createDynamicUniformParams } from '../common/dynamicUniform.js';
import {
  type ExtSpectrogramConfig,
  floorMod,
  type SpectrogramColumnRange,
} from '../common/extConfig.js';

export const slotOffsetByteOffset = 32;
const columnCountByteOffset = 36;
const screenBaseByteOffset = 40;
const baseSlotByteOffset = 44;
const paramsByteLength = 128;

const minimumVocalFrequency = 55;
const maximumVocalFrequency = 1100;
const candidateStepCents = 20;
const harmonicCount = 10;
const autocorrMaxLagCount = 384;
const autocorrBinStride = 4;

export const fundamentalLatticeCount = 5;
const peakSeparationCents = 240;

const loudnessExponent = 0.35;
const fundamentalWeight = 0.4;
const antiWeight = 0.9;
const periodicityGain = 2.0;
const periodicityFloor = 0.3;
const agreementPower = 1.0;
const agreementBoostCap = 1.25;

const jumpCostCents = 0.006;
const jumpCapCents = 500;
const unvoicedCost = 0.54;
const voicedTransitionCost = 1.8;
const unvoicedEvidenceCost = 0;

export const fundamentalTrackWindow = 72;

export type FundamentalFrequencyParams = {
  halfSize: number;
  windowCount: number;
  windowSize: number;
  candidateCount: number;
  sampleRate: number;
  minimumFrequency: number;
  candidateStepCents: number;
  harmonicCount: number;
  latticeCount: number;
  trackWindow: number;
  peakSeparationCents: number;
  loudnessExponent: number;
  fundamentalWeight: number;
  antiWeight: number;
  jumpCostCents: number;
  jumpCapCents: number;
  unvoicedCost: number;
  voicedTransitionCost: number;
  unvoicedEvidenceCost: number;
  lagCount: number;
  minimumLag: number;
  lagStep: number;
  autocorrBinStride: number;
  autocorrMaxBin: number;
  periodicityGain: number;
  periodicityFloor: number;
  agreementPower: number;
  agreementBoostCap: number;
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
  const minimumLag = config.sampleRate / maximumFrequency;
  const maximumLag = config.sampleRate / minimumFrequency;
  const lagSpan = Math.max(0, maximumLag - minimumLag);
  const lagCount =
    candidateCount === 0
      ? 0
      : Math.min(autocorrMaxLagCount, Math.floor(lagSpan) + 1);
  const lagStep =
    lagCount > 1 ? lagSpan / Math.max(1, lagCount - 1) : Math.max(1, lagSpan);
  const autocorrMaxBin = Math.max(
    1,
    Math.min(
      halfSize - 1,
      Math.ceil(
        ((maximumFrequency * harmonicCount) / config.sampleRate) * windowSize,
      ),
    ),
  );

  return {
    halfSize,
    windowCount: config.windowCount,
    windowSize,
    candidateCount,
    sampleRate: config.sampleRate,
    minimumFrequency,
    candidateStepCents,
    harmonicCount,
    latticeCount: fundamentalLatticeCount,
    trackWindow: fundamentalTrackWindow,
    peakSeparationCents,
    loudnessExponent,
    fundamentalWeight,
    antiWeight,
    jumpCostCents,
    jumpCapCents,
    unvoicedCost,
    voicedTransitionCost,
    unvoicedEvidenceCost,
    lagCount,
    minimumLag,
    lagStep,
    autocorrBinStride,
    autocorrMaxBin,
    periodicityGain,
    periodicityFloor,
    agreementPower,
    agreementBoostCap,
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
            view.setUint32(28, value.harmonicCount, true);
            view.setUint32(slotOffsetByteOffset, slotOffset, true);
            view.setUint32(columnCountByteOffset, columnCount, true);
            view.setUint32(screenBaseByteOffset, screenBase, true);
            view.setUint32(
              baseSlotByteOffset,
              floorMod(slotOffset - screenBase, value.windowCount),
              true,
            );
            view.setUint32(48, value.latticeCount, true);
            view.setUint32(52, value.trackWindow, true);
            view.setFloat32(56, value.peakSeparationCents, true);
            view.setFloat32(60, value.loudnessExponent, true);
            view.setFloat32(64, value.fundamentalWeight, true);
            view.setFloat32(68, value.antiWeight, true);
            view.setFloat32(72, value.jumpCostCents, true);
            view.setFloat32(76, value.jumpCapCents, true);
            view.setFloat32(80, value.unvoicedCost, true);
            view.setFloat32(84, value.voicedTransitionCost, true);
            view.setFloat32(88, value.unvoicedEvidenceCost, true);
            view.setUint32(92, value.lagCount, true);
            view.setFloat32(96, value.minimumLag, true);
            view.setFloat32(100, value.lagStep, true);
            view.setUint32(104, value.autocorrBinStride, true);
            view.setUint32(108, value.autocorrMaxBin, true);
            view.setFloat32(112, value.periodicityGain, true);
            view.setFloat32(116, value.periodicityFloor, true);
            view.setFloat32(120, value.agreementPower, true);
            view.setFloat32(124, value.agreementBoostCap, true);
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
