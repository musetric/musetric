import { type ResourceCell } from '@musetric/utils';
import { type FourierConfig } from './config.es.js';

export type FourierTimestampWrites = {
  reverse?: GPUComputePassTimestampWrites;
  transform?: GPUComputePassTimestampWrites;
};

export type FourierArg = {
  wave: GPUBuffer;
  spectrum: GPUBuffer;
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
