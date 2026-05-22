import type { ExtSpectrogramConfig } from './common/extConfig.js';
import { applySpectrogramPatchConfig } from './common/patchConfig.js';
import { type SpectrogramMarkers } from './common/processorTimer.js';
import {
  buildSpectrogramConfig,
  type SpectrogramConfig,
} from './config.cross.js';
import {
  createSpectrogramDecibelifyCell,
  type SpectrogramDecibelify,
} from './decibelify/index.js';
import {
  createSpectrogramDrawCell,
  type SpectrogramDraw,
} from './draw/index.js';
import { createFourierCell } from './fourier/cell.js';
import type { Fourier } from './fourier/types.js';
import {
  createSpectrogramMagnitudifyCell,
  type SpectrogramMagnitudify,
} from './magnitudify/index.js';
import {
  createSpectrogramRemapCell,
  type SpectrogramRemap,
} from './remap/index.js';
import {
  createSpectrogramSliceSamplesCell,
  type SpectrogramSliceSamples,
} from './sliceSamples/index.js';
import {
  createSpectrogramStateCell,
  type SpectrogramState,
} from './state/index.js';
import {
  createSpectrogramWindowingCell,
  type SpectrogramWindowing,
} from './windowing/index.js';

export type SpectrogramRuntime = {
  state: SpectrogramState;
  sliceSamples: SpectrogramSliceSamples;
  windowing: SpectrogramWindowing;
  fourier: Fourier;
  magnitudify: SpectrogramMagnitudify;
  decibelify: SpectrogramDecibelify;
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
    sliceSamples: createSpectrogramSliceSamplesCell(
      device,
      markers.sliceSamples,
    ),
    windowing: createSpectrogramWindowingCell(device, markers.windowing),
    fourier: createFourierCell(device, {
      reverse: markers.fourierReverse,
      transform: markers.fourierTransform,
    }),
    magnitudify: createSpectrogramMagnitudifyCell(device, markers.magnitudify),
    decibelify: createSpectrogramDecibelifyCell(device, markers.decibelify),
    remap: createSpectrogramRemapCell(device, markers.remap),
    draw: createSpectrogramDrawCell(device, markers.draw),
  };

  const buildConfig = (): ExtSpectrogramConfig | undefined => {
    const baseConfig = buildSpectrogramConfig(config, draftConfig);
    if (!baseConfig) {
      return undefined;
    }
    draftConfig = undefined;
    const totalFactor =
      1 + baseConfig.paddingLeftFactor + baseConfig.paddingRightFactor;
    const paddedViewSize = {
      width: Math.round(baseConfig.viewSize.width * totalFactor),
      height: baseConfig.viewSize.height,
    };
    return {
      ...baseConfig,
      viewSize: paddedViewSize,
      windowCount: paddedViewSize.width,
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
      const { signal, texture } = state;
      const sliceSamples = cells.sliceSamples.get({ out: signal.real, config });
      const windowing = cells.windowing.get({ signal: signal.real, config });
      const fourier = cells.fourier.get({ signal, config });
      const magnitudify = cells.magnitudify.get({ signal, config });
      const decibelify = cells.decibelify.get({ signal: signal.real, config });
      const remap = cells.remap.get({
        signal: signal.real,
        texture: texture.view,
        config,
      });
      const draw = cells.draw.get({ view: texture.view, config });

      runtime = {
        state,
        sliceSamples,
        windowing,
        fourier,
        magnitudify,
        decibelify,
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
      cells.sliceSamples.dispose();
      cells.windowing.dispose();
      cells.fourier.dispose();
      cells.magnitudify.dispose();
      cells.decibelify.dispose();
      cells.remap.dispose();
      cells.draw.dispose();
    },
  };
};
