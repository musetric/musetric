import { type ResourceCell } from '@musetric/resource-utils';
import { type ComplexGpuBuffer } from '@musetric/resource-utils/gpu';
import { type FourierConfig } from './config.es.js';

export type FourierTimestampWrites = {
  reverse?: GPUComputePassTimestampWrites;
  transform?: GPUComputePassTimestampWrites;
};

export type FourierArg = {
  wave: GPUBuffer;
  spectrum: ComplexGpuBuffer;
  config: FourierConfig;
};

export type Fourier = {
  run: (encoder: GPUCommandEncoder) => void;
  dispatch: (pass: GPUComputePassEncoder) => void;
};

export type CreateFourier = (
  device: GPUDevice,
  markers?: FourierTimestampWrites,
) => ResourceCell<FourierArg, Fourier>;
