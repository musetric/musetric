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
  pipelines: {
    bindGroupLayout: GPUBindGroupLayout;
    stats: GPUComputePipeline;
    render: GPUComputePipeline;
  };
  config: SpectrogramConfig;
  params: StateParams;
  rowStats: GPUBuffer;
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
      stats: GPUComputePipeline;
      render: GPUComputePipeline;
    };
  },
  State
> => {
  const paramsCell = createParamsCell(device);
  const rowStatsCell = createResourceCell({
    create: (height: number): GPUBuffer =>
      device.createBuffer({
        label: 'remap-row-stats-buffer',
        size: Math.max(1, height) * 4 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) => current === next,
  });
  const bindGroupCell = createResourceCell({
    create: (arg: {
      spectra: SpectrogramBandSpectrum[];
      texture: GPUTextureView;
      params: GPUBuffer;
      rowStats: GPUBuffer;
      bindGroupLayout: GPUBindGroupLayout;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'remap-column-bind-group',
        layout: arg.bindGroupLayout,
        entries: [
          { binding: 0, resource: arg.texture },
          { binding: 1, resource: { buffer: arg.params } },
          { binding: 2, resource: { buffer: arg.rowStats } },
          ...arg.spectra.flatMap((spectrum, index) => [
            {
              binding: 3 + index * 2,
              resource: { buffer: spectrum.rawMagnitudeBuffer },
            },
            {
              binding: 4 + index * 2,
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
      current.rowStats === next.rowStats &&
      areSpectraBuffersEqual(current.spectra, next.spectra),
  });

  return {
    get: (arg) => {
      const { spectra, texture, config, gainDb, pipelines } = arg;
      const params = paramsCell.get({ config, gainDb, spectra });
      const rowStats = rowStatsCell.get(params.value.height);
      const bindGroup = bindGroupCell.get({
        spectra,
        texture,
        params: params.buffer,
        rowStats,
        bindGroupLayout: pipelines.bindGroupLayout,
      });

      return {
        pipelines,
        config,
        params,
        rowStats,
        bindGroup,
      };
    },
    dispose: () => {
      bindGroupCell.dispose();
      rowStatsCell.dispose();
      paramsCell.dispose();
    },
  };
};
