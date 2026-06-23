import {
  createResourceCell,
  type ResourceCell,
} from '@musetric/resource-utils';
import { createPipeline } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 16;
const storageBuffersPerSpectrum = 2;

export type SpectrogramRemap = {
  dispatch: (pass: GPUComputePassEncoder) => void;
};

export const createSpectrogramRemapCell = (
  device: GPUDevice,
): ResourceCell<StateArg, SpectrogramRemap> => {
  const maxSpectrumCount = Math.floor(
    device.limits.maxStorageBuffersPerShaderStage / storageBuffersPerSpectrum,
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
      const pipeline = pipelineCell.get(arg.spectra.length);
      const state = stateCell.get({ ...arg, pipeline });
      const { width, height } = state.params.value;
      const xGroups = Math.ceil(width / workgroupSize);
      const yGroups = Math.ceil(height / workgroupSize);

      return {
        dispatch: (pass) => {
          pass.setPipeline(state.pipeline);
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
