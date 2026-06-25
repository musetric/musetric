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
    computeIntensity: GPUComputePipeline;
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
      computeIntensity: GPUComputePipeline;
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
  const intensityCacheCell = createResourceCell({
    create: (arg: { width: number; height: number }): GPUBuffer =>
      device.createBuffer({
        label: 'remap-intensity-cache-buffer',
        size:
          Math.max(1, arg.width) *
          Math.max(1, arg.height) *
          Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE,
      }),
    dispose: (buffer) => {
      buffer.destroy();
    },
    equals: (current, next) =>
      current.width === next.width && current.height === next.height,
  });
  const bindGroupCell = createResourceCell({
    create: (arg: {
      spectra: SpectrogramBandSpectrum[];
      texture: GPUTextureView;
      params: GPUBuffer;
      rowStats: GPUBuffer;
      intensityCache: GPUBuffer;
      bindGroupLayout: GPUBindGroupLayout;
    }): GPUBindGroup =>
      device.createBindGroup({
        label: 'remap-column-bind-group',
        layout: arg.bindGroupLayout,
        entries: [
          { binding: 0, resource: arg.texture },
          { binding: 1, resource: { buffer: arg.params } },
          { binding: 2, resource: { buffer: arg.rowStats } },
          { binding: 3, resource: { buffer: arg.intensityCache } },
          ...arg.spectra.flatMap((spectrum, index) => [
            {
              binding: 4 + index * 2,
              resource: { buffer: spectrum.rawMagnitudeBuffer },
            },
            {
              binding: 5 + index * 2,
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
      current.intensityCache === next.intensityCache &&
      areSpectraBuffersEqual(current.spectra, next.spectra),
  });

  return {
    get: (arg) => {
      const { spectra, texture, config, gainDb, pipelines } = arg;
      const params = paramsCell.get({ config, gainDb, spectra });
      const rowStats = rowStatsCell.get(params.value.height);
      const intensityCache = intensityCacheCell.get({
        width: params.value.width,
        height: params.value.height,
      });
      const bindGroup = bindGroupCell.get({
        spectra,
        texture,
        params: params.buffer,
        rowStats,
        intensityCache,
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
      intensityCacheCell.dispose();
      rowStatsCell.dispose();
      paramsCell.dispose();
    },
  };
};
