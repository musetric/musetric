import { type FourierTimestampWrites } from '@musetric/fft/gpu';
import { type CqtPlan } from './plan.es.js';

export type CqtTimestampWrites = {
  downsample?: GPUComputePassTimestampWrites;
  frame?: GPUComputePassTimestampWrites;
  fft?: FourierTimestampWrites;
  projection?: GPUComputePassTimestampWrites;
};

export type CqtArg = {
  input: GPUBuffer;
  output: GPUBuffer;
  sampleCount: number;
  plan: CqtPlan;
};

export type Cqt = {
  frameCount: number;
  run: (encoder: GPUCommandEncoder) => void;
};
