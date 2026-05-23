import type { ExtSpectrogramConfig } from './common/extConfig.js';
import { applySpectrogramPatchConfig } from './common/patchConfig.js';
import { type SpectrogramMarkers } from './common/processorTimer.js';
import {
  buildSpectrogramConfig,
  type SpectrogramConfig,
} from './config.cross.js';
import {
  createSpectrogramDrawCell,
  type SpectrogramDraw,
} from './draw/index.js';
import {
  createSpectrogramLaneCell,
  type SpectrogramLane,
} from './lane/index.js';
import {
  createSpectrogramRemapCell,
  type SpectrogramRemap,
} from './remap/index.js';
import {
  createSpectrogramStateCell,
  type SpectrogramState,
} from './state/index.js';

export type SpectrogramRuntime = {
  state: SpectrogramState;
  leadLane: SpectrogramLane;
  recordingLane: SpectrogramLane;
  remap: SpectrogramRemap;
  draw: SpectrogramDraw;
};

export type SpectrogramConfigurator = {
  configure: () => SpectrogramRuntime | undefined;
  updateConfig: (config?: Partial<SpectrogramConfig>) => void;
  dispose: () => void;
};
export const createSpectrogramConfigurator = (
  device: GPUDevice,
  markers: SpectrogramMarkers,
): SpectrogramConfigurator => {
  let draftConfig: Partial<SpectrogramConfig> | undefined = undefined;
  let config: ExtSpectrogramConfig | undefined = undefined;
  let runtime: SpectrogramRuntime | undefined = undefined;

  const cells = {
    state: createSpectrogramStateCell(device),
    leadLane: createSpectrogramLaneCell(device, {
      mode: 'granular',
      label: 'lead',
      markers: {
        sliceSamples: markers.sliceSamples,
        windowing: markers.windowing,
        fourierReverse: markers.fourierReverse,
        fourierTransform: markers.fourierTransform,
        magnitudify: markers.magnitudify,
        decibelify: markers.decibelify,
        fundamentalFrequency: markers.fundamentalFrequency,
      },
    }),
    recordingLane: createSpectrogramLaneCell(device, {
      mode: 'bulk',
      label: 'recording',
      marker: markers.recordingFundamentalFrequency,
    }),
    remap: createSpectrogramRemapCell(device, markers.remap),
    draw: createSpectrogramDrawCell(device, markers.draw),
  };

  const buildConfig = (): ExtSpectrogramConfig | undefined => {
    const baseConfig = buildSpectrogramConfig(config, draftConfig);
    if (!baseConfig) {
      return undefined;
    }
    draftConfig = undefined;
    return {
      ...baseConfig,
      windowCount: baseConfig.viewSize.width,
    };
  };

  return {
    configure: markers.configure(() => {
      if (!draftConfig) {
        return runtime;
      }

      config = buildConfig();
      if (!config) {
        return undefined;
      }
      draftConfig = undefined;
      const state = cells.state.get(config);
      const { texture } = state;
      const leadLane = cells.leadLane.get(config);
      const recordingLane = cells.recordingLane.get(config);
      const remap = cells.remap.get({
        signal: leadLane.signal.real,
        texture: texture.view,
        config,
      });
      const draw = cells.draw.get({
        view: texture.view,
        fundamentalFrequencies: leadLane.fundamentalFrequencyBuffer,
        recordingFrequencies: recordingLane.fundamentalFrequencyBuffer,
        config,
      });

      runtime = {
        state,
        leadLane,
        recordingLane,
        remap,
        draw,
      };
      return runtime;
    }),
    updateConfig: (patchConfig) => {
      draftConfig = applySpectrogramPatchConfig({
        base: config,
        draft: draftConfig,
        patch: patchConfig,
      });
    },
    dispose: () => {
      cells.state.dispose();
      cells.leadLane.dispose();
      cells.recordingLane.dispose();
      cells.remap.dispose();
      cells.draw.dispose();
    },
  };
};
