import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { type SpectrogramConfig } from '../config.cross.js';
import { type SpectrogramBandSpectrum } from '../lane/index.js';
import { createParamsCell, type StateParams } from './params.js';

export type StateArg = {
  spectra: SpectrogramBandSpectrum[];
  texture: GPUTextureView;
  config: SpectrogramConfig;
  gainDb: number;
};

export type State = {
  pipeline: GPUComputePipeline;
  config: SpectrogramConfig;
  params: StateParams;
  bindGroup: GPUBindGroup;
};

const areSpectraBuffersEqual = (
  current: SpectrogramBandSpectrum[],
  next: SpectrogramBandSpectrum[],
) =>
  current.length === next.length &&
  current.every((spectrum, index) => {
    const nextSpectrum = next[index];
    return (
      spectrum.rawMagnitudeBuffer === nextSpectrum.rawMagnitudeBuffer &&
      spectrum.columnEnergyBuffer === nextSpectrum.columnEnergyBuffer
    );
  });

export const createStateCell = (
  device: GPUDevice,
): ResourceCell<StateArg & { pipeline: GPUComputePipeline }, State> => {
  const paramsCell = createParamsCell(device);
  const bindGroupCell = createResourceCell({
    create: (arg: {
      spectra: SpectrogramBandSpectrum[];
      texture: GPUTextureView;
      params: GPUBuffer;
      pipeline: GPUComputePipeline;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'remap-column-bind-group',
        layout: arg.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: arg.texture },
          { binding: 1, resource: { buffer: arg.params } },
          ...arg.spectra.flatMap((spectrum, index) => [
            {
              binding: 2 + index * 2,
              resource: { buffer: spectrum.rawMagnitudeBuffer },
            },
            {
              binding: 3 + index * 2,
              resource: { buffer: spectrum.columnEnergyBuffer },
            },
          ]),
        ],
      }),
    dispose: () => undefined,
    equals: (current, next) =>
      current.pipeline === next.pipeline &&
      current.texture === next.texture &&
      current.params === next.params &&
      areSpectraBuffersEqual(current.spectra, next.spectra),
  });

  return {
    get: (arg) => {
      const { spectra, texture, config, gainDb, pipeline } = arg;
      const params = paramsCell.get({ config, gainDb, spectra });
      const bindGroup = bindGroupCell.get({
        spectra,
        texture,
        params: params.buffer,
        pipeline,
      });

      return {
        pipeline,
        config,
        params,
        bindGroup,
      };
    },
    dispose: () => {
      bindGroupCell.dispose();
      paramsCell.dispose();
    },
  };
};
