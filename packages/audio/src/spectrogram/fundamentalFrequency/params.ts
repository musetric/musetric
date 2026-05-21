import { createResourceCell } from '@musetric/resource-utils';
import type { ExtSpectrogramConfig } from '../common/extConfig.js';

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
};

const minimumVocalFrequency = 55;
const maximumVocalFrequency = 1100;
const candidateStepCents = 10;
const minimumFundamentalIntensity = 0.12;
const minimumScore = 0.22;
const harmonicCount = 12;

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
  };
};

export type StateParams = {
  value: FundamentalFrequencyParams;
  buffer: GPUBuffer;
};

export const createParamsCell = (device: GPUDevice) =>
  createResourceCell({
    create: (config: ExtSpectrogramConfig): StateParams => {
      const value = toParams(config);
      const array = new DataView(new ArrayBuffer(48));
      array.setUint32(0, value.halfSize, true);
      array.setUint32(4, value.windowCount, true);
      array.setUint32(8, value.windowSize, true);
      array.setUint32(12, value.candidateCount, true);
      array.setFloat32(16, value.sampleRate, true);
      array.setFloat32(20, value.minimumFrequency, true);
      array.setFloat32(24, value.candidateStepCents, true);
      array.setFloat32(28, value.minimumFundamentalIntensity, true);
      array.setFloat32(32, value.minimumScore, true);
      array.setUint32(36, value.harmonicCount, true);

      const buffer = device.createBuffer({
        label: 'fundamental-frequency-params-buffer',
        size: array.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, array.buffer);

      return {
        value,
        buffer,
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
