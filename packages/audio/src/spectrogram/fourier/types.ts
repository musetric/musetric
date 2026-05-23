import { type ResourceCell } from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '../common/complexArray.js';
import { type FourierConfig } from './config.js';

export type FourierArg = {
  signal: ComplexGpuBuffer;
  config: FourierConfig;
};

export type Fourier = {
  forward: (encoder: GPUCommandEncoder) => void;
  forwardDispatch: (pass: GPUComputePassEncoder) => void;
};

export type FourierTimestampWrites = {
  reverse?: GPUComputePassTimestampWrites;
  transform?: GPUComputePassTimestampWrites;
};

export type CreateFourier = (
  device: GPUDevice,
  markers?: FourierTimestampWrites,
) => ResourceCell<FourierArg, Fourier>;
