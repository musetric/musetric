import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { createPipeline } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 16;
const storageBuffersPerSpectrum = 2;
const storageBuffersPerRemap = 2;

export type SpectrogramRemap = {
  dispatch: (pass: GPUComputePassEncoder) => void;
};

export const createSpectrogramRemapCell = (
  device: GPUDevice,
): ResourceCell<StateArg, SpectrogramRemap> => {
  const maxSpectrumCount = Math.floor(
    (device.limits.maxStorageBuffersPerShaderStage - storageBuffersPerRemap) /
      storageBuffersPerSpectrum,
  );
  const pipelineCell = createResourceCell({
    create: (spectrumCount: number) => createPipeline(device, spectrumCount),
    dispose: () => undefined,
    equals: (current, next) => current === next,
  });
  const stateCell = createStateCell(device);

  return {
    get: (arg) => {
      if (arg.spectra.length > maxSpectrumCount) {
        throw new Error(
          `Spectrogram spectralBands count ${arg.spectra.length} requires ${
            arg.spectra.length * storageBuffersPerSpectrum
          } storage buffers, but this GPU supports ${
            device.limits.maxStorageBuffersPerShaderStage
          } per shader stage.`,
        );
      }
      const pipelines = pipelineCell.get(arg.spectra.length);
      const state = stateCell.get({ ...arg, pipelines });
      const { width, height } = state.params.value;
      const xGroups = Math.ceil(width / workgroupSize);
      const yGroups = Math.ceil(height / workgroupSize);
      const rowStatsGroups = height;

      return {
        dispatch: (pass) => {
          pass.setPipeline(state.pipelines.computeIntensity);
          pass.setBindGroup(0, state.bindGroup);
          pass.dispatchWorkgroups(xGroups, yGroups);
          pass.setPipeline(state.pipelines.stats);
          pass.setBindGroup(0, state.bindGroup);
          pass.dispatchWorkgroups(rowStatsGroups);
          pass.setPipeline(state.pipelines.render);
          pass.setBindGroup(0, state.bindGroup);
          pass.dispatchWorkgroups(xGroups, yGroups);
        },
      };
    },
    dispose: () => {
      stateCell.dispose();
      pipelineCell.dispose();
    },
  };
};
