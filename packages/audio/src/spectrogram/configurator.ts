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

export type SpectrogramTrack = {
  lane: SpectrogramLane;
  remap: SpectrogramRemap;
};

export type SpectrogramRuntime = {
  state: SpectrogramState;
  tracks: {
    lead: SpectrogramTrack;
    recording: SpectrogramTrack;
  };
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
    leadRemap: createSpectrogramRemapCell(device, markers.remap),
    recordingRemap: createSpectrogramRemapCell(device),
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
      const leadRemap = cells.leadRemap.get({
        signal: leadLane.signal.real,
        texture: texture.layerViews[0],
        config,
      });
      const recordingRemap = cells.recordingRemap.get({
        signal: recordingLane.signal.real,
        texture: texture.layerViews[1],
        config,
      });
      const draw = cells.draw.get({
        arrayView: texture.arrayView,
        leadFundamentalFrequencies: leadLane.fundamentalFrequencyBuffer,
        recordingFundamentalFrequencies:
          recordingLane.fundamentalFrequencyBuffer,
        config,
      });

      runtime = {
        state,
        tracks: {
          lead: { lane: leadLane, remap: leadRemap },
          recording: { lane: recordingLane, remap: recordingRemap },
        },
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
      cells.leadRemap.dispose();
      cells.recordingRemap.dispose();
      cells.draw.dispose();
    },
  };
};
