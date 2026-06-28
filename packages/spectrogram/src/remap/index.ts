import { createResourceCell, type ResourceCell } from '@musetric/utils';
import { type SpectrogramColumnRange } from '../common/extConfig.js';
import { createPipeline } from './pipeline.js';
import { createStateCell, type StateArg } from './state.js';

const workgroupSize = 16;
const storageBuffersPerSpectrum = 2;

export type SpectrogramRemap = {
  dispatch: (
    pass: GPUComputePassEncoder,
    range?: Pick<SpectrogramColumnRange, 'slotOffset' | 'columnCount'>,
  ) => void;
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
      const pipelines = pipelineCell.get(arg.spectra.length);
      const state = stateCell.get({ ...arg, pipelines });
      const { height } = state.params.value;
      const yGroups = Math.ceil(height / workgroupSize);

      return {
        dispatch: (pass, range) => {
          const { columnCount, byteOffset } = state.params.writeRange(range);
          if (columnCount <= 0) {
            return;
          }
          const xGroups = Math.ceil(columnCount / workgroupSize);
          pass.setPipeline(state.pipelines.compute);
          pass.setBindGroup(0, state.bindGroup, [byteOffset]);
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
