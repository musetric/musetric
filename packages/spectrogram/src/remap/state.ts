import { createResourceCell, type ResourceCell } from '@musetric/utils';
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
  pipelines: {
    bindGroupLayout: GPUBindGroupLayout;
    compute: GPUComputePipeline;
  };
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
): ResourceCell<
  StateArg & {
    pipelines: {
      bindGroupLayout: GPUBindGroupLayout;
      compute: GPUComputePipeline;
    };
  },
  State
> => {
  const paramsCell = createParamsCell(device);
  type RemapBindGroupArg = {
    spectra: SpectrogramBandSpectrum[];
    texture: GPUTextureView;
    params: StateParams;
    bindGroupLayout: GPUBindGroupLayout;
  };
  const bindGroupCell = createResourceCell({
    create: (arg: RemapBindGroupArg): GPUBindGroup =>
      device.createBindGroup({
        label: 'remap-bind-group',
        layout: arg.bindGroupLayout,
        entries: [
          { binding: 0, resource: arg.texture },
          {
            binding: 1,
            resource: {
              buffer: arg.params.buffer,
              size: arg.params.byteLength,
            },
          },
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
      current.bindGroupLayout === next.bindGroupLayout &&
      current.texture === next.texture &&
      current.params === next.params &&
      areSpectraBuffersEqual(current.spectra, next.spectra),
  });

  return {
    get: (arg) => {
      const { spectra, texture, config, gainDb, pipelines } = arg;
      const params = paramsCell.get({ config, gainDb, spectra });
      const bindGroup = bindGroupCell.get({
        spectra,
        texture,
        params,
        bindGroupLayout: pipelines.bindGroupLayout,
      });

      return {
        pipelines,
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
